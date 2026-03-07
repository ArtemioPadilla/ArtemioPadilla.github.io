import { useState, useEffect, useRef, useCallback } from "preact/hooks";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

type CellType = 0 | 1 | 2; // 0=empty, 1=blue, 2=orange
type PlayState = "idle" | "running" | "paused";

interface Stats {
  happyPct: number;
  segregationIndex: number;
  step: number;
}

interface StatsSnapshot {
  step: number;
  happyPct: number;
  segregationIndex: number;
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const GRID_SIZE = 40;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;
const CANVAS_SIZE = 440;
const CHART_W = 580;
const CHART_H = 160;
const MAX_HISTORY = 400;

const EMPTY_RATIO = 0.3;
const COLOR_BLUE = "#3b82f6";
const COLOR_ORANGE = "#f97316";
const COLOR_EMPTY = "var(--color-bg)";
const COLOR_UNHAPPY_RING = "#ef4444";

// ─────────────────────────────────────────────────────────
// Grid helpers
// ─────────────────────────────────────────────────────────

function createGrid(): CellType[] {
  const grid: CellType[] = new Array(CELL_COUNT);
  for (let i = 0; i < CELL_COUNT; i++) {
    const r = Math.random();
    if (r < EMPTY_RATIO) grid[i] = 0;
    else if (r < EMPTY_RATIO + (1 - EMPTY_RATIO) / 2) grid[i] = 1;
    else grid[i] = 2;
  }
  return grid;
}

function getNeighborCoords(i: number): number[] {
  const row = Math.floor(i / GRID_SIZE);
  const col = i % GRID_SIZE;
  const result: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = row + dr;
      const nc = col + dc;
      if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) {
        result.push(nr * GRID_SIZE + nc);
      }
    }
  }
  return result;
}

function isHappy(grid: CellType[], i: number, tolerance: number): boolean {
  const type = grid[i];
  if (type === 0) return true;

  const nbrs = getNeighborCoords(i);
  let same = 0;
  let total = 0;
  for (const n of nbrs) {
    if (grid[n] !== 0) {
      total++;
      if (grid[n] === type) same++;
    }
  }

  if (total === 0) return true;
  return same / total >= tolerance;
}

function computeStats(grid: CellType[], tolerance: number, step: number): Stats {
  let happyCount = 0;
  let occupiedCount = 0;
  let totalSameRatio = 0;

  for (let i = 0; i < CELL_COUNT; i++) {
    if (grid[i] === 0) continue;
    occupiedCount++;

    if (isHappy(grid, i, tolerance)) happyCount++;

    const nbrs = getNeighborCoords(i);
    let same = 0;
    let total = 0;
    for (const n of nbrs) {
      if (grid[n] !== 0) {
        total++;
        if (grid[n] === grid[i]) same++;
      }
    }
    if (total > 0) totalSameRatio += same / total;
  }

  const happyPct = occupiedCount > 0 ? happyCount / occupiedCount : 1;
  const segregationIndex = occupiedCount > 0 ? totalSameRatio / occupiedCount : 0;

  return { happyPct, segregationIndex, step };
}

function simulateStep(grid: CellType[], tolerance: number): CellType[] {
  const next = [...grid] as CellType[];

  // Find all unhappy agents and empty cells
  const unhappy: number[] = [];
  const empty: number[] = [];

  for (let i = 0; i < CELL_COUNT; i++) {
    if (next[i] === 0) {
      empty.push(i);
    } else if (!isHappy(next, i, tolerance)) {
      unhappy.push(i);
    }
  }

  // Shuffle unhappy for random ordering
  for (let i = unhappy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unhappy[i], unhappy[j]] = [unhappy[j], unhappy[i]];
  }

  // Move each unhappy agent to a random empty cell
  for (const ui of unhappy) {
    if (empty.length === 0) break;
    const ei = Math.floor(Math.random() * empty.length);
    const emptyIdx = empty[ei];

    next[emptyIdx] = next[ui];
    next[ui] = 0;

    // Update empty list: remove the used cell, add the newly vacated cell
    empty[ei] = ui;
  }

  return next;
}

// ─────────────────────────────────────────────────────────
// Canvas drawing
// ─────────────────────────────────────────────────────────

function drawGrid(
  ctx: CanvasRenderingContext2D,
  grid: CellType[],
  happyMap: boolean[],
  size: number,
): void {
  const cellSize = size / GRID_SIZE;

  ctx.clearRect(0, 0, size, size);

  for (let i = 0; i < CELL_COUNT; i++) {
    const row = Math.floor(i / GRID_SIZE);
    const col = i % GRID_SIZE;
    const x = col * cellSize;
    const y = row * cellSize;

    if (grid[i] === 0) {
      ctx.fillStyle = "#18181b";
      ctx.fillRect(x, y, cellSize - 0.3, cellSize - 0.3);
    } else {
      ctx.fillStyle = grid[i] === 1 ? COLOR_BLUE : COLOR_ORANGE;
      ctx.fillRect(x, y, cellSize - 0.3, cellSize - 0.3);

      // Unhappy indicator: red border
      if (!happyMap[i]) {
        ctx.strokeStyle = COLOR_UNHAPPY_RING;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 1, y + 1, cellSize - 2.3, cellSize - 2.3);
      }
    }
  }
}

function drawChart(ctx: CanvasRenderingContext2D, history: StatsSnapshot[], w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);

  if (history.length < 2) return;

  const pad = { top: 10, right: 10, bottom: 22, left: 45 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  // Axes
  ctx.strokeStyle = "#3f3f46";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, h - pad.bottom);
  ctx.lineTo(w - pad.right, h - pad.bottom);
  ctx.stroke();

  ctx.fillStyle = "#a1a1aa";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("100%", pad.left - 4, pad.top + 10);
  ctx.fillText("50%", pad.left - 4, pad.top + plotH / 2);
  ctx.fillText("0%", pad.left - 4, h - pad.bottom);

  ctx.textAlign = "center";
  ctx.fillText(`Step ${history[history.length - 1].step}`, w / 2, h - 4);

  const n = history.length;

  // Happy % line (green)
  ctx.strokeStyle = "#22c55e";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = pad.left + (i / (n - 1)) * plotW;
    const y = pad.top + plotH * (1 - history[i].happyPct);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Segregation index line (orange)
  ctx.strokeStyle = "#f97316";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = pad.left + (i / (n - 1)) * plotW;
    const y = pad.top + plotH * (1 - history[i].segregationIndex);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

export default function SegregationSim() {
  const gridCanvasRef = useRef<HTMLCanvasElement>(null);
  const chartCanvasRef = useRef<HTMLCanvasElement>(null);

  const gridRef = useRef<CellType[]>(createGrid());
  const historyRef = useRef<StatsSnapshot[]>([]);
  const stepCountRef = useRef(0);
  const rafRef = useRef(0);

  const [playState, setPlayState] = useState<PlayState>("idle");
  const [tolerance, setTolerance] = useState(0.33);
  const [speed, setSpeed] = useState(10);
  const [stats, setStats] = useState<Stats>({ happyPct: 0, segregationIndex: 0, step: 0 });

  const buildHappyMap = useCallback(
    (grid: CellType[], tol: number): boolean[] => {
      const map = new Array<boolean>(CELL_COUNT);
      for (let i = 0; i < CELL_COUNT; i++) {
        map[i] = grid[i] === 0 || isHappy(grid, i, tol);
      }
      return map;
    },
    [],
  );

  const redraw = useCallback(
    (tol: number) => {
      const gridCanvas = gridCanvasRef.current;
      const chartCanvas = chartCanvasRef.current;
      if (!gridCanvas || !chartCanvas) return;

      const gridCtx = gridCanvas.getContext("2d");
      const chartCtx = chartCanvas.getContext("2d");
      if (!gridCtx || !chartCtx) return;

      const happyMap = buildHappyMap(gridRef.current, tol);
      drawGrid(gridCtx, gridRef.current, happyMap, gridCanvas.width);
      drawChart(chartCtx, historyRef.current, chartCanvas.width, chartCanvas.height);
    },
    [buildHappyMap],
  );

  const recordSnapshot = useCallback(
    (tol: number) => {
      const s = computeStats(gridRef.current, tol, stepCountRef.current);
      setStats(s);
      historyRef.current.push({
        step: s.step,
        happyPct: s.happyPct,
        segregationIndex: s.segregationIndex,
      });
      if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    },
    [],
  );

  const doStep = useCallback(
    (tol: number) => {
      gridRef.current = simulateStep(gridRef.current, tol);
      stepCountRef.current++;
      recordSnapshot(tol);
      redraw(tol);
    },
    [recordSnapshot, redraw],
  );

  // Animation loop
  useEffect(() => {
    if (playState !== "running") return;

    let frameCount = 0;
    const interval = Math.max(1, 20 - speed);

    const tick = () => {
      frameCount++;
      if (frameCount >= interval) {
        frameCount = 0;
        doStep(tolerance);
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playState, speed, tolerance, doStep]);

  // Initial draw
  useEffect(() => {
    recordSnapshot(tolerance);
    redraw(tolerance);
  }, []);

  const handleReset = useCallback(() => {
    setPlayState("idle");
    cancelAnimationFrame(rafRef.current);
    gridRef.current = createGrid();
    historyRef.current = [];
    stepCountRef.current = 0;
    recordSnapshot(tolerance);
    redraw(tolerance);
  }, [tolerance, recordSnapshot, redraw]);

  const handlePlayPause = useCallback(() => {
    setPlayState((prev) => (prev === "running" ? "paused" : "running"));
  }, []);

  const handleStepBtn = useCallback(() => {
    setPlayState("paused");
    doStep(tolerance);
  }, [tolerance, doStep]);

  const handleToleranceChange = useCallback(
    (newTol: number) => {
      setTolerance(newTol);
      // Recompute happiness with new tolerance and redraw
      const s = computeStats(gridRef.current, newTol, stepCountRef.current);
      setStats(s);
      redraw(newTol);
    },
    [redraw],
  );

  return (
    <div class="space-y-4">
      {/* Header */}
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h3 class="mb-2 text-lg font-bold text-[var(--color-heading)]">
          Schelling Segregation Model
        </h3>
        <p class="text-sm text-[var(--color-text-muted)]">
          Even mild preferences for same-type neighbors can produce dramatic segregation. Adjust the
          tolerance threshold and watch agents self-sort. Cells with red borders are "unhappy" and
          will move.
        </p>
      </div>

      <div class="flex flex-col gap-4 lg:flex-row">
        {/* Grid */}
        <div class="space-y-3">
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
              onClick={handleStepBtn}
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
              Step: <span class="font-mono font-bold text-[var(--color-heading)]">{stats.step}</span>
            </span>
          </div>

          {/* Speed */}
          <div class="flex items-center gap-3">
            <label class="text-xs text-[var(--color-text-muted)]" style={{ minWidth: 65 }}>Speed</label>
            <input
              type="range"
              min={1}
              max={19}
              value={speed}
              onInput={(e) => setSpeed(parseInt((e.target as HTMLInputElement).value, 10))}
              class="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--color-border)]"
            />
          </div>
        </div>

        {/* Right panel */}
        <div class="flex-1 space-y-3">
          {/* Tolerance */}
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <h4 class="mb-2 text-sm font-semibold text-[var(--color-heading)]">
              Tolerance Threshold
            </h4>
            <p class="mb-2 text-xs text-[var(--color-text-muted)]">
              An agent is "happy" if at least this percentage of its occupied neighbors are the same
              type.
            </p>
            <div class="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(tolerance * 100)}
                onInput={(e) =>
                  handleToleranceChange(parseInt((e.target as HTMLInputElement).value, 10) / 100)
                }
                class="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--color-border)]"
              />
              <span class="w-12 text-right text-sm font-mono font-bold text-[var(--color-heading)]">
                {Math.round(tolerance * 100)}%
              </span>
            </div>
            <div class="mt-2 flex gap-2">
              {[10, 25, 33, 50, 75].map((v) => (
                <button
                  key={v}
                  onClick={() => handleToleranceChange(v / 100)}
                  class="rounded px-2 py-0.5 text-xs font-mono border"
                  style={{
                    borderColor:
                      Math.round(tolerance * 100) === v ? "var(--color-primary)" : "var(--color-border)",
                    color:
                      Math.round(tolerance * 100) === v ? "var(--color-primary)" : "var(--color-text-muted)",
                    background: "var(--color-surface)",
                  }}
                >
                  {v}%
                </button>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <h4 class="mb-2 text-sm font-semibold text-[var(--color-heading)]">Statistics</h4>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <div class="text-xs text-[var(--color-text-muted)]">Happy Agents</div>
                <div class="text-xl font-mono font-bold" style={{ color: "#22c55e" }}>
                  {(stats.happyPct * 100).toFixed(1)}%
                </div>
              </div>
              <div>
                <div class="text-xs text-[var(--color-text-muted)]">Segregation Index</div>
                <div class="text-xl font-mono font-bold" style={{ color: "#f97316" }}>
                  {(stats.segregationIndex * 100).toFixed(1)}%
                </div>
              </div>
            </div>
            <p class="mt-2 text-xs text-[var(--color-text-muted)]">
              Segregation index = average % of same-type neighbors. 50% means random mixing; higher
              means more segregated.
            </p>
          </div>

          {/* Legend */}
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <h4 class="mb-2 text-sm font-semibold text-[var(--color-heading)]">Legend</h4>
            <div class="flex flex-wrap gap-4 text-xs">
              <div class="flex items-center gap-1.5">
                <div class="h-3 w-3 rounded-sm" style={{ background: COLOR_BLUE }} />
                <span class="text-[var(--color-text)]">Group A</span>
              </div>
              <div class="flex items-center gap-1.5">
                <div class="h-3 w-3 rounded-sm" style={{ background: COLOR_ORANGE }} />
                <span class="text-[var(--color-text)]">Group B</span>
              </div>
              <div class="flex items-center gap-1.5">
                <div class="h-3 w-3 rounded-sm" style={{ background: "#18181b", border: "1px solid #3f3f46" }} />
                <span class="text-[var(--color-text)]">Empty</span>
              </div>
              <div class="flex items-center gap-1.5">
                <div
                  class="h-3 w-3 rounded-sm"
                  style={{ background: COLOR_BLUE, border: `2px solid ${COLOR_UNHAPPY_RING}` }}
                />
                <span class="text-[var(--color-text)]">Unhappy</span>
              </div>
            </div>
          </div>

          {/* Explanation */}
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <h4 class="mb-1 text-sm font-semibold text-[var(--color-heading)]">Key Insight</h4>
            <p class="text-xs text-[var(--color-text-muted)]">
              Thomas Schelling (Nobel 2005) showed that even when agents only want 33% same-type
              neighbors, the system self-organizes into highly segregated clusters. Individual
              tolerance does not map linearly to collective integration.
            </p>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <div class="mb-2 flex items-center gap-4">
          <h4 class="text-sm font-semibold text-[var(--color-heading)]">Metrics Over Time</h4>
          <div class="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
            <span class="flex items-center gap-1">
              <div class="h-0.5 w-4 rounded" style={{ background: "#22c55e" }} />
              Happy %
            </span>
            <span class="flex items-center gap-1">
              <div class="h-0.5 w-4 rounded" style={{ background: "#f97316" }} />
              Segregation
            </span>
          </div>
        </div>
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
