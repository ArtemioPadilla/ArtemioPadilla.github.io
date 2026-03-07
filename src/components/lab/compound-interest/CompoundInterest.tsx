import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

type CompoundFreq = "daily" | "monthly" | "annually";

interface ScenarioParams {
  principal: number;
  monthly: number;
  rate: number;
  years: number;
  frequency: CompoundFreq;
}

interface YearBreakdown {
  year: number;
  totalContributions: number;
  totalInterest: number;
  balance: number;
}

interface ScenarioResult {
  breakdowns: YearBreakdown[];
  finalBalance: number;
  totalContributions: number;
  totalInterest: number;
  effectiveRate: number;
}

/* ══════════════════════════════════════════════════════════
   Constants
   ══════════════════════════════════════════════════════════ */

const FREQ_MAP: Record<CompoundFreq, { label: string; n: number }> = {
  daily: { label: "Daily", n: 365 },
  monthly: { label: "Monthly", n: 12 },
  annually: { label: "Annually", n: 1 },
};

const COLORS = {
  contributions: "#4f8ff7",
  interest: "#34d399",
  contributions2: "#a855f7",
  interest2: "#f59e0b",
  grid: "rgba(100,100,120,0.15)",
  axis: "rgba(160,160,180,0.6)",
};

const DEFAULT_S1: ScenarioParams = {
  principal: 10000,
  monthly: 300,
  rate: 7,
  years: 20,
  frequency: "monthly",
};

const DEFAULT_S2: ScenarioParams = {
  principal: 10000,
  monthly: 500,
  rate: 5,
  years: 20,
  frequency: "monthly",
};

/* ══════════════════════════════════════════════════════════
   Calculation
   ══════════════════════════════════════════════════════════ */

function computeScenario(params: ScenarioParams): ScenarioResult {
  const { principal, monthly, rate, years, frequency } = params;
  const n = FREQ_MAP[frequency].n;
  const ratePerPeriod = (rate / 100) / n;
  const periodsPerMonth = n / 12;

  const breakdowns: YearBreakdown[] = [];
  let balance = principal;
  let totalContributions = principal;

  for (let y = 1; y <= years; y++) {
    for (let month = 0; month < 12; month++) {
      for (let p = 0; p < periodsPerMonth; p++) {
        balance *= (1 + ratePerPeriod);
      }
      balance += monthly;
      totalContributions += monthly;
    }
    breakdowns.push({
      year: y,
      totalContributions,
      totalInterest: balance - totalContributions,
      balance,
    });
  }

  const effectiveRate = Math.pow(1 + (rate / 100) / n, n) - 1;

  return {
    breakdowns,
    finalBalance: balance,
    totalContributions,
    totalInterest: balance - totalContributions,
    effectiveRate,
  };
}

/* ══════════════════════════════════════════════════════════
   Canvas Drawing — Stacked Bar Chart
   ══════════════════════════════════════════════════════════ */

function drawStackedBars(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  result1: ScenarioResult,
  result2: ScenarioResult | null,
  animProgress: number,
  dpr: number,
): void {
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const pad = { top: 20, right: 20, bottom: 40, left: 70 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  const b1 = result1.breakdowns;
  const b2 = result2?.breakdowns;
  const numYears = b1.length;

  let maxVal = 0;
  for (const b of b1) {
    if (b.balance > maxVal) maxVal = b.balance;
  }
  if (b2) {
    for (const b of b2) {
      if (b.balance > maxVal) maxVal = b.balance;
    }
  }
  maxVal = maxVal * 1.1 || 1;

  const yScale = (v: number) => pad.top + chartH - (v / maxVal) * chartH;
  const barGroupWidth = chartW / numYears;
  const gap = Math.max(1, barGroupWidth * 0.15);
  const totalBarWidth = barGroupWidth - gap;
  const singleBarWidth = result2 ? totalBarWidth / 2 : totalBarWidth;

  // Grid
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 0.5;
  const yTicks = niceAxisTicks(0, maxVal, 5);
  for (const tick of yTicks) {
    const y = yScale(tick);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + chartW, y);
    ctx.stroke();
  }

  // Bars
  for (let i = 0; i < numYears; i++) {
    const groupX = pad.left + i * barGroupWidth + gap / 2;
    const anim = Math.min(1, animProgress * (numYears / (i + 1)));

    // Scenario 1
    const contrib1 = b1[i].totalContributions * anim;
    const interest1 = b1[i].totalInterest * anim;
    drawBar(ctx, groupX, singleBarWidth, contrib1, interest1, maxVal, chartH, pad.top, COLORS.contributions, COLORS.interest);

    // Scenario 2
    if (b2 && b2[i]) {
      const x2 = groupX + singleBarWidth;
      const contrib2 = b2[i].totalContributions * anim;
      const interest2 = b2[i].totalInterest * anim;
      drawBar(ctx, x2, singleBarWidth, contrib2, interest2, maxVal, chartH, pad.top, COLORS.contributions2, COLORS.interest2);
    }
  }

  // Axes
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + chartH);
  ctx.lineTo(pad.left + chartW, pad.top + chartH);
  ctx.stroke();

  // Y-axis labels
  const textColor = getComputedTextColor();
  ctx.fillStyle = textColor;
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const tick of yTicks) {
    ctx.fillText(formatCurrency(tick), pad.left - 8, yScale(tick));
  }

  // X-axis labels
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const labelStep = numYears > 20 ? 5 : numYears > 10 ? 2 : 1;
  for (let i = 0; i < numYears; i += labelStep) {
    ctx.fillText(`Y${b1[i].year}`, pad.left + (i + 0.5) * barGroupWidth, pad.top + chartH + 8);
  }

  // Legend
  ctx.font = "10px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  const ly = pad.top + 4;
  let lx = pad.left + 8;
  const legendItems = [
    { label: "Contributions", color: COLORS.contributions },
    { label: "Interest", color: COLORS.interest },
  ];
  if (result2) {
    legendItems.push(
      { label: "Contributions (B)", color: COLORS.contributions2 },
      { label: "Interest (B)", color: COLORS.interest2 },
    );
  }
  for (const item of legendItems) {
    ctx.fillStyle = item.color;
    ctx.fillRect(lx, ly, 10, 8);
    ctx.fillStyle = textColor;
    ctx.fillText(item.label, lx + 14, ly + 1);
    lx += ctx.measureText(item.label).width + 26;
  }

  ctx.restore();
}

function drawBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  width: number,
  contributions: number,
  interest: number,
  maxVal: number,
  chartH: number,
  topPad: number,
  contribColor: string,
  interestColor: string,
): void {
  const total = contributions + interest;
  const totalHeight = (total / maxVal) * chartH;
  const contribHeight = (contributions / maxVal) * chartH;
  const baseY = topPad + chartH;

  ctx.fillStyle = contribColor;
  ctx.fillRect(x, baseY - totalHeight, width, contribHeight);

  ctx.fillStyle = interestColor;
  ctx.fillRect(x, baseY - totalHeight, width, totalHeight - contribHeight);
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
        {prefix && <span class="px-2 text-xs text-[var(--color-text-muted)]">{prefix}</span>}
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step ?? 1}
          onInput={(e) => onChange(parseFloat((e.target as HTMLInputElement).value) || 0)}
          class="flex-1 bg-transparent px-2 py-1.5 text-sm text-[var(--color-heading)] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        {suffix && <span class="px-2 text-xs text-[var(--color-text-muted)]">{suffix}</span>}
      </div>
    </label>
  );
}

function FreqSelect({ value, onChange }: {
  value: CompoundFreq;
  onChange: (v: CompoundFreq) => void;
}): preact.JSX.Element {
  return (
    <label class="block">
      <span class="text-[11px] text-[var(--color-text-muted)]">Compounding</span>
      <select
        value={value}
        onChange={(e) => onChange((e.target as HTMLSelectElement).value as CompoundFreq)}
        class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm text-[var(--color-heading)] outline-none"
      >
        {(Object.keys(FREQ_MAP) as CompoundFreq[]).map((f) => (
          <option key={f} value={f}>{FREQ_MAP[f].label}</option>
        ))}
      </select>
    </label>
  );
}

function StatCard({ label, value, color }: {
  label: string;
  value: string;
  color?: string;
}): preact.JSX.Element {
  return (
    <div class="rounded-lg border border-[var(--color-border)] p-3 text-center">
      <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">{label}</div>
      <div class="mt-1 text-lg font-bold" style={{ color: color ?? "var(--color-heading)" }}>{value}</div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Scenario Panel
   ══════════════════════════════════════════════════════════ */

function ScenarioPanel({ title, params, onChange, accentColor }: {
  title: string;
  params: ScenarioParams;
  onChange: (p: ScenarioParams) => void;
  accentColor: string;
}): preact.JSX.Element {
  const update = <K extends keyof ScenarioParams>(key: K, value: ScenarioParams[K]) =>
    onChange({ ...params, [key]: value });

  return (
    <div class="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
      <h3 class="text-xs font-bold" style={{ color: accentColor }}>{title}</h3>
      <div class="grid grid-cols-2 gap-2">
        <InputField label="Principal" value={params.principal} onChange={(v) => update("principal", v)} min={0} step={1000} prefix="$" />
        <InputField label="Monthly" value={params.monthly} onChange={(v) => update("monthly", v)} min={0} step={100} prefix="$" />
        <InputField label="Annual Rate" value={params.rate} onChange={(v) => update("rate", v)} min={0} max={30} step={0.5} suffix="%" />
        <InputField label="Years" value={params.years} onChange={(v) => update("years", Math.max(1, Math.min(50, Math.round(v))))} min={1} max={50} />
        <FreqSelect value={params.frequency} onChange={(v) => update("frequency", v)} />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════ */

export default function CompoundInterest(): preact.JSX.Element {
  const [scenario1, setScenario1] = useState<ScenarioParams>({ ...DEFAULT_S1 });
  const [scenario2, setScenario2] = useState<ScenarioParams>({ ...DEFAULT_S2 });
  const [compareMode, setCompareMode] = useState(false);
  const [animProgress, setAnimProgress] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(700);
  const animRef = useRef(0);

  const canvasHeight = Math.round(canvasWidth * 0.5);

  const result1 = computeScenario(scenario1);
  const result2 = compareMode ? computeScenario(scenario2) : null;

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

  // Animate bars on param change
  useEffect(() => {
    setAnimProgress(0);
    const start = performance.now();
    const duration = 600;

    const step = (time: number) => {
      const elapsed = time - start;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimProgress(eased);
      if (progress < 1) animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animRef.current);
  }, [scenario1, scenario2, compareMode]);

  // Draw chart
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawStackedBars(ctx, canvasWidth, canvasHeight, result1, result2, animProgress, dpr);
  }, [result1, result2, animProgress, canvasWidth, canvasHeight]);

  return (
    <div class="space-y-6">
      {/* Comparison toggle */}
      <div class="flex items-center gap-3">
        <button
          onClick={() => setCompareMode(!compareMode)}
          class={`rounded-lg border px-4 py-2 text-xs font-medium transition-colors ${
            compareMode
              ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
              : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-heading)]"
          }`}
        >
          {compareMode ? "Comparison ON" : "Compare Scenarios"}
        </button>
      </div>

      {/* Scenario panels */}
      <div class={`grid gap-4 ${compareMode ? "lg:grid-cols-2" : ""}`}>
        <ScenarioPanel
          title={compareMode ? "Scenario A" : "Parameters"}
          params={scenario1}
          onChange={setScenario1}
          accentColor={COLORS.contributions}
        />
        {compareMode && (
          <ScenarioPanel
            title="Scenario B"
            params={scenario2}
            onChange={setScenario2}
            accentColor={COLORS.contributions2}
          />
        )}
      </div>

      {/* Stacked Bar Chart */}
      <div ref={containerRef} class="overflow-hidden rounded-xl border border-[var(--color-border)]">
        <canvas
          ref={canvasRef}
          class="w-full"
          style={{ background: "var(--color-surface)", aspectRatio: "2/1" }}
        />
      </div>

      {/* Stats */}
      <div class={`grid gap-3 ${compareMode ? "grid-cols-2 sm:grid-cols-4 lg:grid-cols-8" : "grid-cols-2 sm:grid-cols-4"}`}>
        <StatCard label="Final Balance" value={formatFullCurrency(result1.finalBalance)} color={COLORS.contributions} />
        <StatCard label="Contributions" value={formatFullCurrency(result1.totalContributions)} />
        <StatCard label="Interest Earned" value={formatFullCurrency(result1.totalInterest)} color={COLORS.interest} />
        <StatCard label="Effective Rate" value={`${(result1.effectiveRate * 100).toFixed(2)}%`} />
        {result2 && (
          <>
            <StatCard label="Final Balance (B)" value={formatFullCurrency(result2.finalBalance)} color={COLORS.contributions2} />
            <StatCard label="Contributions (B)" value={formatFullCurrency(result2.totalContributions)} />
            <StatCard label="Interest (B)" value={formatFullCurrency(result2.totalInterest)} color={COLORS.interest2} />
            <StatCard label="Eff. Rate (B)" value={`${(result2.effectiveRate * 100).toFixed(2)}%`} />
          </>
        )}
      </div>

      <p class="text-[11px] text-[var(--color-text-muted)]">
        Stacked bars show cumulative contributions (bottom) and compound interest (top) per year.
        {compareMode ? " Scenarios A and B are shown side by side for comparison." : " Toggle comparison mode to add a second scenario."}
      </p>
    </div>
  );
}
