import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

interface SimParams {
  initial: number;
  monthly: number;
  returnPct: number;
  volatility: number;
  inflation: number;
  years: number;
  goal: number;
}

interface SimResults {
  percentiles: Float64Array[];
  median: number;
  best: number;
  worst: number;
  goalProb: number;
  months: number;
}

/* ══════════════════════════════════════════════════════════
   Constants
   ══════════════════════════════════════════════════════════ */

const NUM_SIMS = 500;
const PERCENTILE_KEYS = [10, 25, 50, 75, 90] as const;

const BAND_COLORS = [
  "rgba(79,143,247,0.10)",
  "rgba(79,143,247,0.18)",
  "rgba(79,143,247,0.28)",
  "rgba(79,143,247,0.18)",
  "rgba(79,143,247,0.10)",
];

const MEDIAN_COLOR = "#4f8ff7";
const GRID_COLOR = "rgba(100,100,120,0.15)";
const AXIS_COLOR = "rgba(160,160,180,0.6)";

const DEFAULT_PARAMS: SimParams = {
  initial: 10000,
  monthly: 500,
  returnPct: 8,
  volatility: 15,
  inflation: 3,
  years: 20,
  goal: 500000,
};

/* ══════════════════════════════════════════════════════════
   Pure Math — Box-Muller Normal RNG
   ══════════════════════════════════════════════════════════ */

function randomNormal(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1 || 1e-15)) * Math.cos(2 * Math.PI * u2);
}

/* ══════════════════════════════════════════════════════════
   Simulation — Geometric Brownian Motion
   ══════════════════════════════════════════════════════════ */

function runMonteCarlo(params: SimParams): SimResults {
  const { initial, monthly, returnPct, volatility, inflation, years, goal } = params;
  const months = years * 12;
  const monthlyReturn = (returnPct - inflation) / 100 / 12;
  const monthlySigma = (volatility / 100) / Math.sqrt(12);
  const drift = monthlyReturn - 0.5 * monthlySigma * monthlySigma;

  const paths = new Array<Float64Array>(NUM_SIMS);
  for (let s = 0; s < NUM_SIMS; s++) {
    const path = new Float64Array(months + 1);
    path[0] = initial;
    for (let m = 1; m <= months; m++) {
      const shock = drift + monthlySigma * randomNormal();
      path[m] = Math.max(0, path[m - 1] * Math.exp(shock) + monthly);
    }
    paths[s] = path;
  }

  const percentiles = PERCENTILE_KEYS.map(() => new Float64Array(months + 1));

  const sortBuf = new Float64Array(NUM_SIMS);
  for (let m = 0; m <= months; m++) {
    for (let s = 0; s < NUM_SIMS; s++) sortBuf[s] = paths[s][m];
    sortBuf.sort();
    for (let pi = 0; pi < PERCENTILE_KEYS.length; pi++) {
      const idx = Math.floor((PERCENTILE_KEYS[pi] / 100) * (NUM_SIMS - 1));
      percentiles[pi][m] = sortBuf[idx];
    }
  }

  const finals = new Float64Array(NUM_SIMS);
  for (let s = 0; s < NUM_SIMS; s++) finals[s] = paths[s][months];
  finals.sort();

  const medianIdx = Math.floor(0.5 * (NUM_SIMS - 1));
  let goalCount = 0;
  for (let s = 0; s < NUM_SIMS; s++) {
    if (finals[s] >= goal) goalCount++;
  }

  return {
    percentiles,
    median: finals[medianIdx],
    best: finals[NUM_SIMS - 1],
    worst: finals[0],
    goalProb: goalCount / NUM_SIMS,
    months,
  };
}

/* ══════════════════════════════════════════════════════════
   Canvas Drawing — Fan Chart
   ══════════════════════════════════════════════════════════ */

function drawFanChart(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  results: SimResults,
  dpr: number,
): void {
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const pad = { top: 20, right: 20, bottom: 40, left: 70 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  const { percentiles, months } = results;
  let maxVal = 0;
  for (const p of percentiles) {
    for (let i = 0; i <= months; i++) {
      if (p[i] > maxVal) maxVal = p[i];
    }
  }
  maxVal = maxVal * 1.1 || 1;

  const xScale = (m: number) => pad.left + (m / months) * chartW;
  const yScale = (v: number) => pad.top + chartH - (v / maxVal) * chartH;

  // Grid lines
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 0.5;
  const yTicks = niceAxisTicks(0, maxVal, 5);
  for (const tick of yTicks) {
    const y = yScale(tick);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + chartW, y);
    ctx.stroke();
  }

  const xTickStep = Math.max(1, Math.round(months / 12 / 5)) * 12;
  for (let m = 0; m <= months; m += xTickStep) {
    const x = xScale(m);
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + chartH);
    ctx.stroke();
  }

  // Fan bands (outer to inner)
  const bandPairs = [
    [0, 4],
    [1, 3],
  ];
  for (let bi = 0; bi < bandPairs.length; bi++) {
    const [lo, hi] = bandPairs[bi];
    ctx.beginPath();
    for (let m = 0; m <= months; m++) {
      const x = xScale(m);
      const y = yScale(percentiles[hi][m]);
      m === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    for (let m = months; m >= 0; m--) {
      ctx.lineTo(xScale(m), yScale(percentiles[lo][m]));
    }
    ctx.closePath();
    ctx.fillStyle = BAND_COLORS[bi];
    ctx.fill();
  }

  // Median line
  ctx.beginPath();
  ctx.strokeStyle = MEDIAN_COLOR;
  ctx.lineWidth = 2;
  for (let m = 0; m <= months; m++) {
    const x = xScale(m);
    const y = yScale(percentiles[2][m]);
    m === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Axes
  ctx.strokeStyle = AXIS_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + chartH);
  ctx.lineTo(pad.left + chartW, pad.top + chartH);
  ctx.stroke();

  // Labels
  ctx.fillStyle = getComputedTextColor();
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const tick of yTicks) {
    ctx.fillText(formatCurrency(tick), pad.left - 8, yScale(tick));
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let m = 0; m <= months; m += xTickStep) {
    ctx.fillText(`Y${Math.round(m / 12)}`, xScale(m), pad.top + chartH + 8);
  }

  // Legend
  ctx.font = "10px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  const legendY = pad.top + 4;
  const labels = ["90th", "75th", "Median", "25th", "10th"];
  const colors = ["rgba(79,143,247,0.30)", "rgba(79,143,247,0.50)", MEDIAN_COLOR, "rgba(79,143,247,0.50)", "rgba(79,143,247,0.30)"];
  let legendX = pad.left + 8;
  for (let i = 0; i < labels.length; i++) {
    ctx.fillStyle = colors[i];
    ctx.fillRect(legendX, legendY, 12, 8);
    ctx.fillStyle = getComputedTextColor();
    ctx.fillText(labels[i], legendX + 16, legendY + 1);
    legendX += ctx.measureText(labels[i]).width + 28;
  }

  ctx.restore();
}

/* ══════════════════════════════════════════════════════════
   Helpers
   ══════════════════════════════════════════════════════════ */

function getComputedTextColor(): string {
  if (typeof document === "undefined") return "#a1a1aa";
  return getComputedStyle(document.documentElement)
    .getPropertyValue("--color-text-muted")
    .trim() || "#a1a1aa";
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function formatFullCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function niceAxisTicks(min: number, max: number, count: number): number[] {
  const range = max - min || 1;
  const rawStep = range / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / magnitude;
  const niceStep =
    residual <= 1.5 ? magnitude :
    residual <= 3 ? 2 * magnitude :
    residual <= 7 ? 5 * magnitude :
    10 * magnitude;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / niceStep) * niceStep; v <= max; v += niceStep) {
    ticks.push(v);
  }
  return ticks;
}

/* ══════════════════════════════════════════════════════════
   Sub-Components
   ══════════════════════════════════════════════════════════ */

function InputField({ label, value, onChange, min, max, step, prefix, suffix }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  prefix?: string;
  suffix?: string;
}): preact.JSX.Element {
  return (
    <label class="block">
      <span class="text-[11px] text-[var(--color-text-muted)]">{label}</span>
      <div class="mt-1 flex items-center overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
        {prefix && (
          <span class="px-2 text-xs text-[var(--color-text-muted)]">{prefix}</span>
        )}
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step ?? 1}
          onInput={(e) => onChange(parseFloat((e.target as HTMLInputElement).value) || 0)}
          class="flex-1 bg-transparent px-2 py-1.5 text-sm text-[var(--color-heading)] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        {suffix && (
          <span class="px-2 text-xs text-[var(--color-text-muted)]">{suffix}</span>
        )}
      </div>
    </label>
  );
}

function StatCard({ label, value, color, sub }: {
  label: string;
  value: string;
  color?: string;
  sub?: string;
}): preact.JSX.Element {
  return (
    <div class="rounded-lg border border-[var(--color-border)] p-3 text-center">
      <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">{label}</div>
      <div class="mt-1 text-lg font-bold" style={{ color: color ?? "var(--color-heading)" }}>{value}</div>
      {sub && <div class="mt-0.5 text-[10px] text-[var(--color-text-muted)]">{sub}</div>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════ */

export default function InvestmentSim(): preact.JSX.Element {
  const [params, setParams] = useState<SimParams>({ ...DEFAULT_PARAMS });
  const [results, setResults] = useState<SimResults | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(700);

  const canvasHeight = Math.round(canvasWidth * 0.5);

  const updateParam = useCallback(<K extends keyof SimParams>(key: K, value: SimParams[K]) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  const runSim = useCallback(() => {
    setResults(runMonteCarlo(params));
  }, [params]);

  // Responsive canvas
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 100) setCanvasWidth(Math.floor(w));
    });
    obs.observe(container);
    return () => obs.disconnect();
  }, []);

  // Draw chart
  useEffect(() => {
    if (!results) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawFanChart(ctx, canvasWidth, canvasHeight, results, dpr);
  }, [results, canvasWidth, canvasHeight]);

  // Auto-run on mount
  useEffect(() => {
    setResults(runMonteCarlo(DEFAULT_PARAMS));
  }, []);

  return (
    <div class="space-y-6">
      {/* Controls */}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <InputField
          label="Initial Investment"
          value={params.initial}
          onChange={(v) => updateParam("initial", v)}
          min={0}
          step={1000}
          prefix="$"
        />
        <InputField
          label="Monthly Contribution"
          value={params.monthly}
          onChange={(v) => updateParam("monthly", v)}
          min={0}
          step={100}
          prefix="$"
        />
        <InputField
          label="Expected Return"
          value={params.returnPct}
          onChange={(v) => updateParam("returnPct", v)}
          min={0}
          max={30}
          step={0.5}
          suffix="%"
        />
        <InputField
          label="Volatility"
          value={params.volatility}
          onChange={(v) => updateParam("volatility", v)}
          min={1}
          max={50}
          step={1}
          suffix="%"
        />
        <InputField
          label="Inflation"
          value={params.inflation}
          onChange={(v) => updateParam("inflation", v)}
          min={0}
          max={15}
          step={0.5}
          suffix="%"
        />
        <InputField
          label="Years"
          value={params.years}
          onChange={(v) => updateParam("years", Math.max(1, Math.min(40, Math.round(v))))}
          min={1}
          max={40}
          step={1}
        />
        <InputField
          label="Goal Amount"
          value={params.goal}
          onChange={(v) => updateParam("goal", v)}
          min={0}
          step={10000}
          prefix="$"
        />
        <div class="flex items-end">
          <button
            onClick={runSim}
            class="w-full rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white transition-colors hover:brightness-110"
          >
            Run Simulation
          </button>
        </div>
      </div>

      {/* Fan Chart */}
      <div ref={containerRef} class="overflow-hidden rounded-xl border border-[var(--color-border)]">
        <canvas
          ref={canvasRef}
          class="w-full"
          style={{ background: "var(--color-surface)", aspectRatio: "2/1" }}
        />
      </div>

      {/* Summary Stats */}
      {results && (
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Median Final Value"
            value={formatFullCurrency(results.median)}
            color={MEDIAN_COLOR}
          />
          <StatCard
            label="Best Case (90th)"
            value={formatFullCurrency(results.best)}
            color="#34d399"
            sub="Top simulation"
          />
          <StatCard
            label="Worst Case (10th)"
            value={formatFullCurrency(results.worst)}
            color="#ef4444"
            sub="Bottom simulation"
          />
          <StatCard
            label="Goal Probability"
            value={`${(results.goalProb * 100).toFixed(0)}%`}
            color={results.goalProb >= 0.5 ? "#34d399" : "#f59e0b"}
            sub={`Reach ${formatCurrency(params.goal)}`}
          />
        </div>
      )}

      {/* Info */}
      <p class="text-[11px] text-[var(--color-text-muted)]">
        {NUM_SIMS} Monte Carlo paths using geometric Brownian motion. Returns are inflation-adjusted.
        Fan chart shows 10th-90th percentile bands with median highlighted.
      </p>
    </div>
  );
}
