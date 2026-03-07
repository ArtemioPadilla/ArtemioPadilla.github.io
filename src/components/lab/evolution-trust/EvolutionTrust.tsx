import { useState, useEffect, useRef, useCallback } from "preact/hooks";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

type StrategyId = "always-c" | "always-d" | "tit-for-tat" | "random" | "grudger";
type PlayState = "idle" | "running" | "paused";
type Move = "C" | "D";

interface StrategyInfo {
  id: StrategyId;
  name: string;
  color: string;
  description: string;
}

interface PopSnapshot {
  generation: number;
  counts: Record<StrategyId, number>;
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const GRID_SIZE = 20;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;
const ROUNDS_PER_MATCH = 5;
const CANVAS_SIZE = 400;
const CHART_W = 580;
const CHART_H = 180;
const MAX_HISTORY = 300;

const R = 3; // Reward (both cooperate)
const T = 5; // Temptation (defect vs cooperate)
const S = 0; // Sucker (cooperate vs defect)
const P = 1; // Punishment (both defect)

const STRATEGIES: StrategyInfo[] = [
  { id: "always-c", name: "Always Cooperate", color: "#3b82f6", description: "Always plays C" },
  { id: "always-d", name: "Always Defect", color: "#ef4444", description: "Always plays D" },
  { id: "tit-for-tat", name: "Tit-for-Tat", color: "#22c55e", description: "Cooperates first, then copies opponent" },
  { id: "random", name: "Random", color: "#eab308", description: "50/50 random each round" },
  { id: "grudger", name: "Grudger", color: "#a855f7", description: "Cooperates until betrayed, then always D" },
];

const STRATEGY_MAP = new Map(STRATEGIES.map((s) => [s.id, s]));

// ─────────────────────────────────────────────────────────
// Strategy Logic
// ─────────────────────────────────────────────────────────

function playMove(strategy: StrategyId, round: number, opponentHistory: Move[]): Move {
  switch (strategy) {
    case "always-c":
      return "C";
    case "always-d":
      return "D";
    case "tit-for-tat":
      return round === 0 ? "C" : opponentHistory[round - 1];
    case "random":
      return Math.random() < 0.5 ? "C" : "D";
    case "grudger": {
      const betrayed = opponentHistory.some((m) => m === "D");
      return betrayed ? "D" : "C";
    }
  }
}

function playMatch(a: StrategyId, b: StrategyId): [number, number] {
  const historyA: Move[] = [];
  const historyB: Move[] = [];
  let scoreA = 0;
  let scoreB = 0;

  for (let round = 0; round < ROUNDS_PER_MATCH; round++) {
    const moveA = playMove(a, round, historyB);
    const moveB = playMove(b, round, historyA);
    historyA.push(moveA);
    historyB.push(moveB);

    if (moveA === "C" && moveB === "C") {
      scoreA += R;
      scoreB += R;
    } else if (moveA === "C" && moveB === "D") {
      scoreA += S;
      scoreB += T;
    } else if (moveA === "D" && moveB === "C") {
      scoreA += T;
      scoreB += S;
    } else {
      scoreA += P;
      scoreB += P;
    }
  }

  return [scoreA, scoreB];
}

// ─────────────────────────────────────────────────────────
// Grid helpers
// ─────────────────────────────────────────────────────────

function idx(r: number, c: number): number {
  return r * GRID_SIZE + c;
}

function neighbors(i: number): number[] {
  const r = Math.floor(i / GRID_SIZE);
  const c = i % GRID_SIZE;
  const ns: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = (r + dr + GRID_SIZE) % GRID_SIZE;
      const nc = (c + dc + GRID_SIZE) % GRID_SIZE;
      ns.push(idx(nr, nc));
    }
  }
  return ns;
}

function createInitialGrid(): StrategyId[] {
  const grid: StrategyId[] = new Array(CELL_COUNT);
  const ids = STRATEGIES.map((s) => s.id);
  for (let i = 0; i < CELL_COUNT; i++) {
    grid[i] = ids[Math.floor(Math.random() * ids.length)];
  }
  return grid;
}

function countStrategies(grid: StrategyId[]): Record<StrategyId, number> {
  const counts: Record<StrategyId, number> = {
    "always-c": 0,
    "always-d": 0,
    "tit-for-tat": 0,
    random: 0,
    grudger: 0,
  };
  for (const s of grid) counts[s]++;
  return counts;
}

// ─────────────────────────────────────────────────────────
// Simulation step
// ─────────────────────────────────────────────────────────

function stepGeneration(grid: StrategyId[]): StrategyId[] {
  const scores = new Float64Array(CELL_COUNT);

  // Each agent plays with all 8 neighbors
  for (let i = 0; i < CELL_COUNT; i++) {
    const ns = neighbors(i);
    for (const j of ns) {
      const [sa] = playMatch(grid[i], grid[j]);
      scores[i] += sa;
    }
  }

  // Reproduction: each cell adopts strategy of highest-scoring neighbor (or keeps own)
  const next: StrategyId[] = new Array(CELL_COUNT);
  for (let i = 0; i < CELL_COUNT; i++) {
    let bestIdx = i;
    let bestScore = scores[i];
    const ns = neighbors(i);
    for (const j of ns) {
      if (scores[j] > bestScore) {
        bestScore = scores[j];
        bestIdx = j;
      }
    }
    next[i] = grid[bestIdx];
  }

  // Small mutation chance (1%)
  for (let i = 0; i < CELL_COUNT; i++) {
    if (Math.random() < 0.01) {
      const ids = STRATEGIES.map((s) => s.id);
      next[i] = ids[Math.floor(Math.random() * ids.length)];
    }
  }

  return next;
}

// ─────────────────────────────────────────────────────────
// Canvas drawing
// ─────────────────────────────────────────────────────────

function drawGrid(ctx: CanvasRenderingContext2D, grid: StrategyId[], size: number): void {
  const cellSize = size / GRID_SIZE;
  for (let i = 0; i < CELL_COUNT; i++) {
    const r = Math.floor(i / GRID_SIZE);
    const c = i % GRID_SIZE;
    const info = STRATEGY_MAP.get(grid[i]);
    ctx.fillStyle = info?.color ?? "#666";
    ctx.fillRect(c * cellSize, r * cellSize, cellSize - 0.5, cellSize - 0.5);
  }
}

function drawChart(
  ctx: CanvasRenderingContext2D,
  history: PopSnapshot[],
  w: number,
  h: number,
): void {
  ctx.clearRect(0, 0, w, h);

  if (history.length < 2) return;

  const padding = { top: 10, right: 10, bottom: 25, left: 40 };
  const plotW = w - padding.left - padding.right;
  const plotH = h - padding.top - padding.bottom;

  // Axes
  ctx.strokeStyle = "var(--color-border)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, h - padding.bottom);
  ctx.lineTo(w - padding.right, h - padding.bottom);
  ctx.stroke();

  // Y-axis labels
  ctx.fillStyle = "var(--color-text-muted)";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("100%", padding.left - 4, padding.top + 10);
  ctx.fillText("50%", padding.left - 4, padding.top + plotH / 2);
  ctx.fillText("0%", padding.left - 4, h - padding.bottom);

  // X-axis label
  ctx.textAlign = "center";
  ctx.fillText(`Gen ${history[history.length - 1].generation}`, w / 2, h - 4);

  // Draw stacked area
  const n = history.length;
  const strategyIds = STRATEGIES.map((s) => s.id);

  for (let si = strategyIds.length - 1; si >= 0; si--) {
    const id = strategyIds[si];
    const info = STRATEGY_MAP.get(id)!;
    ctx.fillStyle = info.color + "66";
    ctx.strokeStyle = info.color;
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = padding.left + (i / Math.max(n - 1, 1)) * plotW;
      let cumulative = 0;
      for (let k = 0; k <= si; k++) {
        cumulative += history[i].counts[strategyIds[k]];
      }
      const pct = cumulative / CELL_COUNT;
      const y = padding.top + plotH * (1 - pct);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    // Close area: go back along the lower boundary
    for (let i = n - 1; i >= 0; i--) {
      const x = padding.left + (i / Math.max(n - 1, 1)) * plotW;
      let cumulative = 0;
      for (let k = 0; k < si; k++) {
        cumulative += history[i].counts[strategyIds[k]];
      }
      const pct = cumulative / CELL_COUNT;
      const y = padding.top + plotH * (1 - pct);
      ctx.lineTo(x, y);
    }

    ctx.closePath();
    ctx.fill();

    // Draw line on top
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = padding.left + (i / Math.max(n - 1, 1)) * plotW;
      let cumulative = 0;
      for (let k = 0; k <= si; k++) {
        cumulative += history[i].counts[strategyIds[k]];
      }
      const pct = cumulative / CELL_COUNT;
      const y = padding.top + plotH * (1 - pct);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

export default function EvolutionTrust() {
  const gridCanvasRef = useRef<HTMLCanvasElement>(null);
  const chartCanvasRef = useRef<HTMLCanvasElement>(null);

  const gridRef = useRef<StrategyId[]>(createInitialGrid());
  const historyRef = useRef<PopSnapshot[]>([]);
  const generationRef = useRef(0);
  const rafRef = useRef(0);

  const [playState, setPlayState] = useState<PlayState>("idle");
  const [speed, setSpeed] = useState(8);
  const [generation, setGeneration] = useState(0);
  const [counts, setCounts] = useState<Record<StrategyId, number>>(
    countStrategies(gridRef.current),
  );

  const redraw = useCallback(() => {
    const gridCanvas = gridCanvasRef.current;
    const chartCanvas = chartCanvasRef.current;
    if (!gridCanvas || !chartCanvas) return;

    const gridCtx = gridCanvas.getContext("2d");
    const chartCtx = chartCanvas.getContext("2d");
    if (!gridCtx || !chartCtx) return;

    drawGrid(gridCtx, gridRef.current, gridCanvas.width);
    drawChart(chartCtx, historyRef.current, chartCanvas.width, chartCanvas.height);
  }, []);

  const recordSnapshot = useCallback(() => {
    const c = countStrategies(gridRef.current);
    setCounts(c);
    const snap: PopSnapshot = { generation: generationRef.current, counts: c };
    historyRef.current.push(snap);
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift();
    }
  }, []);

  const doStep = useCallback(() => {
    gridRef.current = stepGeneration(gridRef.current);
    generationRef.current++;
    setGeneration(generationRef.current);
    recordSnapshot();
    redraw();
  }, [recordSnapshot, redraw]);

  // Animation loop
  useEffect(() => {
    if (playState !== "running") return;

    let frameCount = 0;
    const interval = Math.max(1, 20 - speed);

    const tick = () => {
      frameCount++;
      if (frameCount >= interval) {
        frameCount = 0;
        doStep();
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playState, speed, doStep]);

  // Initial draw
  useEffect(() => {
    recordSnapshot();
    redraw();
  }, [recordSnapshot, redraw]);

  const handleReset = useCallback(() => {
    setPlayState("idle");
    cancelAnimationFrame(rafRef.current);
    gridRef.current = createInitialGrid();
    historyRef.current = [];
    generationRef.current = 0;
    setGeneration(0);
    recordSnapshot();
    redraw();
  }, [recordSnapshot, redraw]);

  const handlePlayPause = useCallback(() => {
    setPlayState((prev) => (prev === "running" ? "paused" : "running"));
  }, []);

  const handleStep = useCallback(() => {
    setPlayState("paused");
    doStep();
  }, [doStep]);

  return (
    <div class="space-y-4">
      {/* Header */}
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h3 class="mb-2 text-lg font-bold text-[var(--color-heading)]">
          Evolution of Cooperation
        </h3>
        <p class="text-sm text-[var(--color-text-muted)]">
          A {GRID_SIZE}x{GRID_SIZE} population of agents play the iterated Prisoner's Dilemma
          ({ROUNDS_PER_MATCH} rounds) with their neighbors. After each generation, agents adopt the
          strategy of their most successful neighbor. Watch which strategies survive.
        </p>
      </div>

      <div class="flex flex-col gap-4 lg:flex-row">
        {/* Left: Grid + Controls */}
        <div class="space-y-3">
          {/* Grid Canvas */}
          <div class="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <canvas
              ref={gridCanvasRef}
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              class="block"
              style={{ width: CANVAS_SIZE, height: CANVAS_SIZE, background: "var(--color-bg)" }}
            />
          </div>

          {/* Controls */}
          <div class="flex flex-wrap items-center gap-2">
            <button
              onClick={handlePlayPause}
              class="rounded-lg px-4 py-1.5 text-sm font-medium text-white"
              style={{ background: playState === "running" ? "#ef4444" : "var(--color-primary)" }}
            >
              {playState === "running" ? "Pause" : "Play"}
            </button>
            <button
              onClick={handleStep}
              class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-1.5 text-sm font-medium text-[var(--color-text)]"
            >
              Step
            </button>
            <button
              onClick={handleReset}
              class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-1.5 text-sm font-medium text-[var(--color-text)]"
            >
              Reset
            </button>
            <span class="ml-2 text-sm text-[var(--color-text-muted)]">
              Generation: <span class="font-mono font-bold text-[var(--color-heading)]">{generation}</span>
            </span>
          </div>

          {/* Speed slider */}
          <div class="flex items-center gap-3">
            <label class="text-xs text-[var(--color-text-muted)]">Speed</label>
            <input
              type="range"
              min={1}
              max={19}
              value={speed}
              onInput={(e) => setSpeed(parseInt((e.target as HTMLInputElement).value, 10))}
              class="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--color-border)]"
            />
            <span class="w-6 text-right text-xs font-mono text-[var(--color-text-muted)]">{speed}</span>
          </div>
        </div>

        {/* Right: Info panels */}
        <div class="flex-1 space-y-3">
          {/* Strategy Legend + Counts */}
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <h4 class="mb-2 text-sm font-semibold text-[var(--color-heading)]">Strategies</h4>
            <div class="space-y-1.5">
              {STRATEGIES.map((s) => {
                const pct = ((counts[s.id] / CELL_COUNT) * 100).toFixed(1);
                return (
                  <div key={s.id} class="flex items-center gap-2">
                    <div
                      class="h-3 w-3 rounded-sm flex-shrink-0"
                      style={{ background: s.color }}
                    />
                    <span class="text-xs font-medium text-[var(--color-text)]" style={{ minWidth: 120 }}>
                      {s.name}
                    </span>
                    <div
                      class="h-2 rounded-full"
                      style={{
                        width: `${Math.max(2, parseFloat(pct))}%`,
                        maxWidth: "100%",
                        background: s.color,
                        opacity: 0.7,
                      }}
                    />
                    <span class="text-xs font-mono text-[var(--color-text-muted)] flex-shrink-0" style={{ minWidth: 42 }}>
                      {pct}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Payoff Matrix */}
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <h4 class="mb-2 text-sm font-semibold text-[var(--color-heading)]">Payoff Matrix</h4>
            <table class="w-full text-center text-xs">
              <thead>
                <tr>
                  <th class="p-1 text-[var(--color-text-muted)]"></th>
                  <th class="p-1 text-[var(--color-text-muted)]">Opp. C</th>
                  <th class="p-1 text-[var(--color-text-muted)]">Opp. D</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td class="p-1 font-medium text-[var(--color-text)]">You C</td>
                  <td class="p-1 font-mono text-[var(--color-accent)]">R={R},{R}</td>
                  <td class="p-1 font-mono text-red-400">S={S},T={T}</td>
                </tr>
                <tr>
                  <td class="p-1 font-medium text-[var(--color-text)]">You D</td>
                  <td class="p-1 font-mono text-red-400">T={T},S={S}</td>
                  <td class="p-1 font-mono text-[var(--color-text-muted)]">P={P},{P}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Strategy descriptions */}
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <h4 class="mb-2 text-sm font-semibold text-[var(--color-heading)]">How It Works</h4>
            <ul class="space-y-1 text-xs text-[var(--color-text-muted)]">
              {STRATEGIES.map((s) => (
                <li key={s.id}>
                  <span class="font-medium" style={{ color: s.color }}>
                    {s.name}
                  </span>
                  : {s.description}
                </li>
              ))}
              <li class="pt-1 border-t border-[var(--color-border)]">
                Each generation, agents adopt the strategy of their highest-scoring neighbor. 1%
                mutation rate introduces variety.
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Population Chart */}
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <h4 class="mb-2 text-sm font-semibold text-[var(--color-heading)]">
          Population Over Time (stacked)
        </h4>
        <canvas
          ref={chartCanvasRef}
          width={CHART_W}
          height={CHART_H}
          class="w-full"
          style={{ height: CHART_H, background: "transparent" }}
        />
      </div>
    </div>
  );
}
