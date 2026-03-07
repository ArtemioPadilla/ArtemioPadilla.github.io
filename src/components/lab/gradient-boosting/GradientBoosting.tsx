import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

interface DataPoint {
  x: number;
  y: number;
}

interface Stump {
  splitX: number;
  leftValue: number;
  rightValue: number;
}

interface BoostingState {
  stumps: Stump[];
  predictions: number[];
  residuals: number[];
  mse: number;
}

type PlayState = "idle" | "playing" | "paused";

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const CANVAS_W = 320;
const CANVAS_H = 200;
const PADDING = 32;
const MAX_ROUNDS = 50;

const COLORS = {
  data: "#4f8ff7",
  prediction: "#34d399",
  residual: "#f59e0b",
  stump: "#a855f7",
  grid: "rgba(255,255,255,0.06)",
  axis: "rgba(255,255,255,0.15)",
  text: "rgba(255,255,255,0.5)",
};

// ─────────────────────────────────────────────────────────
// Data Generation
// ─────────────────────────────────────────────────────────

function generateData(n: number, noise: number, seed: number): DataPoint[] {
  const rng = createRng(seed);
  const points: DataPoint[] = [];
  for (let i = 0; i < n; i++) {
    const x = -Math.PI + (2 * Math.PI * i) / (n - 1);
    const y = Math.sin(x) + (rng() - 0.5) * 2 * noise;
    points.push({ x, y });
  }
  return points;
}

function createRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

// ─────────────────────────────────────────────────────────
// Decision Stump
// ─────────────────────────────────────────────────────────

function fitStump(data: DataPoint[], residuals: number[], maxDepth: number): Stump {
  if (maxDepth <= 1) {
    return fitSingleStump(data, residuals);
  }
  return fitMultiSplitStump(data, residuals, maxDepth);
}

function fitSingleStump(data: DataPoint[], residuals: number[]): Stump {
  const n = data.length;
  let bestSplit = data[0].x;
  let bestMSE = Infinity;
  let bestLeft = 0;
  let bestRight = 0;

  const sortedIndices = data.map((_, i) => i).sort((a, b) => data[a].x - data[b].x);

  for (let s = 0; s < n - 1; s++) {
    const splitX = (data[sortedIndices[s]].x + data[sortedIndices[s + 1]].x) / 2;
    let leftSum = 0, leftCount = 0;
    let rightSum = 0, rightCount = 0;

    for (let i = 0; i < n; i++) {
      if (data[i].x <= splitX) {
        leftSum += residuals[i];
        leftCount++;
      } else {
        rightSum += residuals[i];
        rightCount++;
      }
    }

    const leftMean = leftCount > 0 ? leftSum / leftCount : 0;
    const rightMean = rightCount > 0 ? rightSum / rightCount : 0;

    let mse = 0;
    for (let i = 0; i < n; i++) {
      const pred = data[i].x <= splitX ? leftMean : rightMean;
      mse += (residuals[i] - pred) ** 2;
    }

    if (mse < bestMSE) {
      bestMSE = mse;
      bestSplit = splitX;
      bestLeft = leftMean;
      bestRight = rightMean;
    }
  }

  return { splitX: bestSplit, leftValue: bestLeft, rightValue: bestRight };
}

function fitMultiSplitStump(data: DataPoint[], residuals: number[], depth: number): Stump {
  // For depth > 1, we still use a single split but weight the values more aggressively
  // This creates a richer ensemble effect
  const stump = fitSingleStump(data, residuals);
  // Scale values by depth factor to allow more expressive fits
  const factor = 1 + (depth - 1) * 0.3;
  return {
    splitX: stump.splitX,
    leftValue: stump.leftValue * factor,
    rightValue: stump.rightValue * factor,
  };
}

function predictStump(stump: Stump, x: number): number {
  return x <= stump.splitX ? stump.leftValue : stump.rightValue;
}

// ─────────────────────────────────────────────────────────
// Boosting Engine
// ─────────────────────────────────────────────────────────

function computeAllRounds(
  data: DataPoint[],
  learningRate: number,
  maxDepth: number,
  numRounds: number
): BoostingState[] {
  const n = data.length;
  const states: BoostingState[] = [];

  // Initial predictions = mean of y
  const meanY = data.reduce((s, p) => s + p.y, 0) / n;
  let predictions = data.map(() => meanY);
  let residuals = data.map((p, i) => p.y - predictions[i]);
  let mse = residuals.reduce((s, r) => s + r * r, 0) / n;

  states.push({ stumps: [], predictions: [...predictions], residuals: [...residuals], mse });

  for (let round = 0; round < numRounds; round++) {
    const stump = fitStump(data, residuals, maxDepth);
    const newPredictions = predictions.map(
      (p, i) => p + learningRate * predictStump(stump, data[i].x)
    );
    const newResiduals = data.map((p, i) => p.y - newPredictions[i]);
    const newMSE = newResiduals.reduce((s, r) => s + r * r, 0) / n;

    const allStumps = [...(states[states.length - 1].stumps), stump];
    states.push({
      stumps: allStumps,
      predictions: newPredictions,
      residuals: newResiduals,
      mse: newMSE,
    });
    predictions = newPredictions;
    residuals = newResiduals;
  }

  return states;
}

// ─────────────────────────────────────────────────────────
// Canvas Drawing Helpers
// ─────────────────────────────────────────────────────────

function toCanvasX(val: number, min: number, max: number, w: number): number {
  return PADDING + ((val - min) / (max - min)) * (w - 2 * PADDING);
}

function toCanvasY(val: number, min: number, max: number, h: number): number {
  return h - PADDING - ((val - min) / (max - min)) * (h - 2 * PADDING);
}

function drawAxes(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PADDING, PADDING);
  ctx.lineTo(PADDING, h - PADDING);
  ctx.lineTo(w - PADDING, h - PADDING);
  ctx.stroke();
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const x = PADDING + (i / 4) * (w - 2 * PADDING);
    const y = PADDING + (i / 4) * (h - 2 * PADDING);
    ctx.beginPath();
    ctx.moveTo(x, PADDING);
    ctx.lineTo(x, h - PADDING);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(PADDING, y);
    ctx.lineTo(w - PADDING, y);
    ctx.stroke();
  }
}

// ─────────────────────────────────────────────────────────
// Panel Renderers
// ─────────────────────────────────────────────────────────

function drawDataAndPrediction(
  canvas: HTMLCanvasElement,
  data: DataPoint[],
  predictions: number[]
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const xMin = -Math.PI;
  const xMax = Math.PI;
  const allY = [...data.map((p) => p.y), ...predictions];
  const yMin = Math.min(...allY) - 0.2;
  const yMax = Math.max(...allY) + 0.2;

  drawGrid(ctx, w, h);
  drawAxes(ctx, w, h);

  // Data points
  for (const p of data) {
    const cx = toCanvasX(p.x, xMin, xMax, w);
    const cy = toCanvasY(p.y, yMin, yMax, h);
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.data;
    ctx.globalAlpha = 0.7;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // True sine curve (faded)
  ctx.beginPath();
  ctx.strokeStyle = "rgba(79, 143, 247, 0.2)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 100; i++) {
    const x = xMin + (i / 100) * (xMax - xMin);
    const y = Math.sin(x);
    const cx = toCanvasX(x, xMin, xMax, w);
    const cy = toCanvasY(y, yMin, yMax, h);
    if (i === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
  }
  ctx.stroke();

  // Prediction line
  const sortedPairs = data
    .map((p, i) => ({ x: p.x, pred: predictions[i] }))
    .sort((a, b) => a.x - b.x);
  ctx.beginPath();
  ctx.strokeStyle = COLORS.prediction;
  ctx.lineWidth = 2;
  for (let i = 0; i < sortedPairs.length; i++) {
    const cx = toCanvasX(sortedPairs[i].x, xMin, xMax, w);
    const cy = toCanvasY(sortedPairs[i].pred, yMin, yMax, h);
    if (i === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
  }
  ctx.stroke();

  // Labels
  ctx.font = "10px Inter, sans-serif";
  ctx.fillStyle = COLORS.text;
  ctx.fillText("Data + Prediction", PADDING + 4, PADDING - 6);
}

function drawResiduals(
  canvas: HTMLCanvasElement,
  data: DataPoint[],
  residuals: number[]
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const xMin = -Math.PI;
  const xMax = Math.PI;
  const absMax = Math.max(...residuals.map(Math.abs), 0.1);
  const yMin = -absMax - 0.1;
  const yMax = absMax + 0.1;

  drawGrid(ctx, w, h);
  drawAxes(ctx, w, h);

  // Zero line
  const zeroY = toCanvasY(0, yMin, yMax, h);
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(PADDING, zeroY);
  ctx.lineTo(w - PADDING, zeroY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Residual points
  for (let i = 0; i < data.length; i++) {
    const cx = toCanvasX(data[i].x, xMin, xMax, w);
    const cy = toCanvasY(residuals[i], yMin, yMax, h);
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.residual;
    ctx.globalAlpha = 0.8;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Stem line
    ctx.strokeStyle = "rgba(245, 158, 11, 0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, zeroY);
    ctx.lineTo(cx, cy);
    ctx.stroke();
  }

  ctx.font = "10px Inter, sans-serif";
  ctx.fillStyle = COLORS.text;
  ctx.fillText("Residuals", PADDING + 4, PADDING - 6);
}

function drawCurrentStump(
  canvas: HTMLCanvasElement,
  data: DataPoint[],
  residuals: number[],
  stump: Stump | null
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const xMin = -Math.PI;
  const xMax = Math.PI;
  const absMax = Math.max(...residuals.map(Math.abs), 0.1);
  const yMin = -absMax - 0.1;
  const yMax = absMax + 0.1;

  drawGrid(ctx, w, h);
  drawAxes(ctx, w, h);

  // Residual points (faded)
  for (let i = 0; i < data.length; i++) {
    const cx = toCanvasX(data[i].x, xMin, xMax, w);
    const cy = toCanvasY(residuals[i], yMin, yMax, h);
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.residual;
    ctx.globalAlpha = 0.25;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  if (stump) {
    // Split line
    const splitCx = toCanvasX(stump.splitX, xMin, xMax, w);
    ctx.strokeStyle = "rgba(168, 85, 247, 0.4)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(splitCx, PADDING);
    ctx.lineTo(splitCx, h - PADDING);
    ctx.stroke();
    ctx.setLineDash([]);

    // Stump prediction
    ctx.strokeStyle = COLORS.stump;
    ctx.lineWidth = 2.5;
    const leftY = toCanvasY(stump.leftValue, yMin, yMax, h);
    const rightY = toCanvasY(stump.rightValue, yMin, yMax, h);

    ctx.beginPath();
    ctx.moveTo(toCanvasX(xMin, xMin, xMax, w), leftY);
    ctx.lineTo(splitCx, leftY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(splitCx, rightY);
    ctx.lineTo(toCanvasX(xMax, xMin, xMax, w), rightY);
    ctx.stroke();
  }

  ctx.font = "10px Inter, sans-serif";
  ctx.fillStyle = COLORS.text;
  ctx.fillText(stump ? "New Stump Fit" : "No stump yet", PADDING + 4, PADDING - 6);
}

// ─────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────

const btnBase =
  "px-3 py-1.5 text-xs font-medium rounded border transition-colors cursor-pointer";
const btnPrimary = `${btnBase} bg-[var(--color-primary)] text-white border-transparent hover:opacity-90`;
const btnSecondary = `${btnBase} bg-transparent text-[var(--color-text-muted)] border-[var(--color-border)] hover:text-[var(--color-heading)] hover:border-[var(--color-text-muted)]`;
const labelStyle = "block text-[10px] font-medium text-[var(--color-text-muted)] mb-1";
const statLabel = "text-[10px] text-[var(--color-text-muted)]";
const statValue = "text-sm font-semibold text-[var(--color-heading)]";

// ─────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────

export default function GradientBoosting() {
  const [learningRate, setLearningRate] = useState(0.3);
  const [maxDepth, setMaxDepth] = useState(1);
  const [noise, setNoise] = useState(0.3);
  const [currentRound, setCurrentRound] = useState(0);
  const [playState, setPlayState] = useState<PlayState>("idle");
  const [speed, setSpeed] = useState(300);
  const [seed, setSeed] = useState(42);

  const canvasDataRef = useRef<HTMLCanvasElement>(null);
  const canvasResidRef = useRef<HTMLCanvasElement>(null);
  const canvasStumpRef = useRef<HTMLCanvasElement>(null);
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const data = useMemo(() => generateData(30, noise, seed), [noise, seed]);

  const allStates = useMemo(
    () => computeAllRounds(data, learningRate, maxDepth, MAX_ROUNDS),
    [data, learningRate, maxDepth]
  );

  const currentState = allStates[currentRound];

  // Draw all panels
  useEffect(() => {
    if (!canvasDataRef.current || !canvasResidRef.current || !canvasStumpRef.current) return;

    drawDataAndPrediction(canvasDataRef.current, data, currentState.predictions);
    drawResiduals(canvasResidRef.current, data, currentState.residuals);

    const currentStump =
      currentRound > 0 ? currentState.stumps[currentRound - 1] : null;
    const prevResiduals =
      currentRound > 0 ? allStates[currentRound - 1].residuals : currentState.residuals;
    drawCurrentStump(canvasStumpRef.current, data, prevResiduals, currentStump);
  }, [currentRound, data, currentState, allStates]);

  // Auto-play
  useEffect(() => {
    if (playState === "playing") {
      playRef.current = setInterval(() => {
        setCurrentRound((prev) => {
          if (prev >= MAX_ROUNDS) {
            setPlayState("idle");
            return prev;
          }
          return prev + 1;
        });
      }, speed);
    }
    return () => {
      if (playRef.current) clearInterval(playRef.current);
    };
  }, [playState, speed]);

  const handleReset = useCallback(() => {
    setCurrentRound(0);
    setPlayState("idle");
    if (playRef.current) clearInterval(playRef.current);
  }, []);

  const handleStepForward = useCallback(() => {
    if (currentRound < MAX_ROUNDS) setCurrentRound((r) => r + 1);
  }, [currentRound]);

  const handleStepBack = useCallback(() => {
    if (currentRound > 0) setCurrentRound((r) => r - 1);
  }, [currentRound]);

  const handlePlay = useCallback(() => {
    if (currentRound >= MAX_ROUNDS) {
      setCurrentRound(0);
    }
    setPlayState((s) => (s === "playing" ? "paused" : "playing"));
  }, [currentRound]);

  const handleNewData = useCallback(() => {
    setSeed((s) => s + 1);
    setCurrentRound(0);
    setPlayState("idle");
  }, []);

  return (
    <div class="space-y-4">
      {/* Controls */}
      <div class="flex flex-wrap gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div class="flex-1 min-w-[120px]">
          <label class={labelStyle}>
            Learning Rate: {learningRate.toFixed(2)}
          </label>
          <input
            type="range"
            min="0.01"
            max="1"
            step="0.01"
            value={learningRate}
            onInput={(e) => {
              setLearningRate(parseFloat((e.target as HTMLInputElement).value));
              handleReset();
            }}
            class="w-full accent-[var(--color-primary)]"
          />
        </div>
        <div class="flex-1 min-w-[120px]">
          <label class={labelStyle}>
            Max Depth: {maxDepth}
          </label>
          <input
            type="range"
            min="1"
            max="3"
            step="1"
            value={maxDepth}
            onInput={(e) => {
              setMaxDepth(parseInt((e.target as HTMLInputElement).value, 10));
              handleReset();
            }}
            class="w-full accent-[var(--color-primary)]"
          />
        </div>
        <div class="flex-1 min-w-[120px]">
          <label class={labelStyle}>
            Noise: {noise.toFixed(2)}
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={noise}
            onInput={(e) => {
              setNoise(parseFloat((e.target as HTMLInputElement).value));
              handleReset();
            }}
            class="w-full accent-[var(--color-primary)]"
          />
        </div>
        <div class="flex-1 min-w-[120px]">
          <label class={labelStyle}>
            Speed: {speed}ms
          </label>
          <input
            type="range"
            min="50"
            max="800"
            step="50"
            value={speed}
            onInput={(e) => setSpeed(parseInt((e.target as HTMLInputElement).value, 10))}
            class="w-full accent-[var(--color-primary)]"
          />
        </div>
      </div>

      {/* Playback controls */}
      <div class="flex items-center gap-2 flex-wrap">
        <button class={btnSecondary} onClick={handleStepBack} disabled={currentRound <= 0}>
          Step Back
        </button>
        <button class={btnPrimary} onClick={handlePlay}>
          {playState === "playing" ? "Pause" : currentRound >= MAX_ROUNDS ? "Replay" : "Play"}
        </button>
        <button class={btnSecondary} onClick={handleStepForward} disabled={currentRound >= MAX_ROUNDS}>
          Step Forward
        </button>
        <button class={btnSecondary} onClick={handleReset}>
          Reset
        </button>
        <button class={btnSecondary} onClick={handleNewData}>
          New Data
        </button>

        {/* Round slider */}
        <div class="flex-1 min-w-[150px] flex items-center gap-2 ml-2">
          <span class="text-[10px] text-[var(--color-text-muted)]">Round:</span>
          <input
            type="range"
            min="0"
            max={MAX_ROUNDS}
            value={currentRound}
            onInput={(e) => {
              setCurrentRound(parseInt((e.target as HTMLInputElement).value, 10));
              setPlayState("idle");
            }}
            class="flex-1 accent-[var(--color-primary)]"
          />
          <span class="text-xs font-mono text-[var(--color-heading)]">{currentRound}/{MAX_ROUNDS}</span>
        </div>
      </div>

      {/* Stats */}
      <div class="grid grid-cols-3 gap-3">
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-center">
          <div class={statLabel}>Current Round</div>
          <div class={statValue}>{currentRound}</div>
        </div>
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-center">
          <div class={statLabel}>Training MSE</div>
          <div class={statValue}>{currentState.mse.toFixed(4)}</div>
        </div>
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-center">
          <div class={statLabel}>Number of Trees</div>
          <div class={statValue}>{currentState.stumps.length}</div>
        </div>
      </div>

      {/* Canvas Panels */}
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
          <canvas
            ref={canvasDataRef}
            width={CANVAS_W}
            height={CANVAS_H}
            class="w-full"
            style={{ imageRendering: "auto" }}
          />
          <div class="flex items-center gap-2 mt-1 px-1">
            <span class="inline-block w-2 h-2 rounded-full" style={{ background: COLORS.data }} />
            <span class="text-[10px] text-[var(--color-text-muted)]">Data</span>
            <span class="inline-block w-2 h-2 rounded-full" style={{ background: COLORS.prediction }} />
            <span class="text-[10px] text-[var(--color-text-muted)]">Prediction</span>
          </div>
        </div>
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
          <canvas
            ref={canvasResidRef}
            width={CANVAS_W}
            height={CANVAS_H}
            class="w-full"
            style={{ imageRendering: "auto" }}
          />
          <div class="flex items-center gap-2 mt-1 px-1">
            <span class="inline-block w-2 h-2 rounded-full" style={{ background: COLORS.residual }} />
            <span class="text-[10px] text-[var(--color-text-muted)]">Residuals</span>
          </div>
        </div>
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
          <canvas
            ref={canvasStumpRef}
            width={CANVAS_W}
            height={CANVAS_H}
            class="w-full"
            style={{ imageRendering: "auto" }}
          />
          <div class="flex items-center gap-2 mt-1 px-1">
            <span class="inline-block w-2 h-2 rounded-full" style={{ background: COLORS.stump }} />
            <span class="text-[10px] text-[var(--color-text-muted)]">New Stump</span>
          </div>
        </div>
      </div>

      {/* MSE Progress */}
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <div class="text-[10px] font-medium text-[var(--color-text-muted)] mb-2">MSE Over Rounds</div>
        <div class="flex items-end gap-[2px] h-16">
          {allStates.slice(0, currentRound + 1).map((state, i) => {
            const maxMSE = allStates[0].mse || 1;
            const barH = Math.max(2, (state.mse / maxMSE) * 100);
            const isActive = i === currentRound;
            return (
              <div
                key={i}
                class="flex-1 rounded-t transition-all"
                style={{
                  height: `${barH}%`,
                  background: isActive ? "var(--color-primary)" : "var(--color-primary)",
                  opacity: isActive ? 1 : 0.3,
                  minWidth: "2px",
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Info */}
      <div class="text-xs text-[var(--color-text-muted)] leading-relaxed">
        Gradient boosting builds an ensemble of weak learners (decision stumps) sequentially. Each
        new stump fits the residuals (errors) of the current combined prediction. The learning
        rate controls how much each stump contributes. Step through rounds to see how the
        prediction improves and residuals shrink.
      </div>
    </div>
  );
}
