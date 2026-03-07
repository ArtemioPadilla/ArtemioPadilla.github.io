import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

interface LoanParams {
  principal: number;
  annualRate: number;
  termYears: number;
}

interface Strategy {
  id: string;
  name: string;
  description: string;
  color: string;
  getMonthlyPayment: (basePayment: number, month: number) => number;
}

interface StrategySnapshot {
  balance: number;
  totalInterest: number;
  totalPaid: number;
  monthsElapsed: number;
  paidOff: boolean;
  paidOffMonth: number | null;
}

type PlayState = "idle" | "playing" | "paused" | "finished";
type SpeedMode = 1 | 2 | 5 | 10;

/* ══════════════════════════════════════════════════════════
   Constants
   ══════════════════════════════════════════════════════════ */

const STRATEGY_COLORS = ["#4f8ff7", "#34d399", "#f59e0b", "#a855f7"];
const CANVAS_PAD = { top: 30, right: 30, bottom: 20, left: 100 };
const BAR_GAP = 8;

const DEFAULT_LOAN: LoanParams = {
  principal: 300000,
  annualRate: 6.5,
  termYears: 30,
};

const REFI_RATE = 4.5;

/* ══════════════════════════════════════════════════════════
   Pure Math
   ══════════════════════════════════════════════════════════ */

function computeBasePayment(principal: number, monthlyRate: number, totalMonths: number): number {
  if (monthlyRate === 0) return principal / totalMonths;
  return (
    (principal * monthlyRate * Math.pow(1 + monthlyRate, totalMonths)) /
    (Math.pow(1 + monthlyRate, totalMonths) - 1)
  );
}

function buildStrategies(loan: LoanParams, basePayment: number): Strategy[] {
  const refiMonthlyRate = REFI_RATE / 100 / 12;
  const refiPayment = computeBasePayment(loan.principal, refiMonthlyRate, loan.termYears * 12);

  return [
    {
      id: "minimum",
      name: "Minimum Payment",
      description: `$${basePayment.toFixed(0)}/mo`,
      color: STRATEGY_COLORS[0],
      getMonthlyPayment: () => basePayment,
    },
    {
      id: "extra-500",
      name: "Extra $500/mo",
      description: `$${(basePayment + 500).toFixed(0)}/mo`,
      color: STRATEGY_COLORS[1],
      getMonthlyPayment: () => basePayment + 500,
    },
    {
      id: "biweekly",
      name: "Biweekly",
      description: `$${(basePayment / 2).toFixed(0)} every 2 wks`,
      color: STRATEGY_COLORS[2],
      getMonthlyPayment: (_bp, month) => {
        const biweeklyPayment = basePayment / 2;
        const paymentsInMonth = month % 6 === 0 ? 3 : 2;
        return biweeklyPayment * paymentsInMonth;
      },
    },
    {
      id: "refinance",
      name: `Refi at ${REFI_RATE}%`,
      description: `$${refiPayment.toFixed(0)}/mo`,
      color: STRATEGY_COLORS[3],
      getMonthlyPayment: () => refiPayment,
    },
  ];
}

function simulateMonth(
  snapshot: StrategySnapshot,
  strategy: Strategy,
  monthlyRate: number,
  basePayment: number,
  month: number,
  isRefi: boolean,
  refiMonthlyRate: number,
): StrategySnapshot {
  if (snapshot.paidOff) return snapshot;

  const rate = isRefi ? refiMonthlyRate : monthlyRate;
  const interest = snapshot.balance * rate;
  const payment = Math.min(
    strategy.getMonthlyPayment(basePayment, month),
    snapshot.balance + interest,
  );
  const principalPayment = payment - interest;
  const newBalance = Math.max(0, snapshot.balance - principalPayment);

  return {
    balance: newBalance,
    totalInterest: snapshot.totalInterest + interest,
    totalPaid: snapshot.totalPaid + payment,
    monthsElapsed: snapshot.monthsElapsed + 1,
    paidOff: newBalance <= 0.01,
    paidOffMonth: newBalance <= 0.01 ? month : null,
  };
}

function precomputeFullRace(
  loan: LoanParams,
  strategies: Strategy[],
  basePayment: number,
): Map<string, StrategySnapshot>[] {
  const monthlyRate = loan.annualRate / 100 / 12;
  const refiMonthlyRate = REFI_RATE / 100 / 12;
  const maxMonths = loan.termYears * 12 + 120;

  const initial = new Map<string, StrategySnapshot>();
  for (const s of strategies) {
    initial.set(s.id, {
      balance: loan.principal,
      totalInterest: 0,
      totalPaid: 0,
      monthsElapsed: 0,
      paidOff: false,
      paidOffMonth: null,
    });
  }

  const history: Map<string, StrategySnapshot>[] = [initial];
  let current = initial;

  for (let m = 1; m <= maxMonths; m++) {
    const next = new Map<string, StrategySnapshot>();
    let allDone = true;
    for (const s of strategies) {
      const prev = current.get(s.id)!;
      const isRefi = s.id === "refinance";
      next.set(s.id, simulateMonth(prev, s, monthlyRate, basePayment, m, isRefi, refiMonthlyRate));
      if (!next.get(s.id)!.paidOff) allDone = false;
    }
    history.push(next);
    current = next;
    if (allDone) break;
  }

  return history;
}

/* ══════════════════════════════════════════════════════════
   Canvas Drawing
   ══════════════════════════════════════════════════════════ */

function drawRace(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  loan: LoanParams,
  strategies: Strategy[],
  snapshots: Map<string, StrategySnapshot>,
  month: number,
  dpr: number,
): void {
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const chartW = w - CANVAS_PAD.left - CANVAS_PAD.right;
  const chartH = h - CANVAS_PAD.top - CANVAS_PAD.bottom;
  const barHeight = (chartH - BAR_GAP * (strategies.length - 1)) / strategies.length;

  const textColor = getComputedCSSVar("--color-text-muted", "#a1a1aa");
  const headingColor = getComputedCSSVar("--color-heading", "#ffffff");

  // Month counter
  ctx.font = "bold 14px Inter, system-ui, sans-serif";
  ctx.fillStyle = headingColor;
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  const years = Math.floor(month / 12);
  const months = month % 12;
  ctx.fillText(`Month ${month} (${years}y ${months}m)`, CANVAS_PAD.left + chartW, 4);

  // Draw bars
  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    const snapshot = snapshots.get(strategy.id);
    if (!snapshot) continue;

    const y = CANVAS_PAD.top + i * (barHeight + BAR_GAP);
    const ratio = snapshot.balance / loan.principal;
    const barW = Math.max(0, ratio * chartW);

    // Strategy label
    ctx.font = "bold 11px Inter, system-ui, sans-serif";
    ctx.fillStyle = strategy.color;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(strategy.name, CANVAS_PAD.left - 8, y + barHeight / 2);

    // Background track
    ctx.fillStyle = "rgba(100,100,120,0.08)";
    roundRect(ctx, CANVAS_PAD.left, y, chartW, barHeight, 4);
    ctx.fill();

    // Balance bar
    if (barW > 0) {
      ctx.fillStyle = snapshot.paidOff ? "rgba(52,211,153,0.3)" : strategy.color;
      roundRect(ctx, CANVAS_PAD.left, y, barW, barHeight, 4);
      ctx.fill();

      const grad = ctx.createLinearGradient(CANVAS_PAD.left, y, CANVAS_PAD.left + barW, y);
      grad.addColorStop(0, "rgba(255,255,255,0.15)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      roundRect(ctx, CANVAS_PAD.left, y, barW, barHeight, 4);
      ctx.fill();
    }

    // Balance / Paid off text
    ctx.font = "11px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    if (snapshot.paidOff) {
      ctx.fillStyle = "#34d399";
      ctx.fillText(
        `PAID OFF (month ${snapshot.paidOffMonth ?? snapshot.monthsElapsed})`,
        CANVAS_PAD.left + barW + 8,
        y + barHeight / 2,
      );
    } else {
      ctx.fillStyle = textColor;
      ctx.fillText(formatCurrency(snapshot.balance), CANVAS_PAD.left + barW + 8, y + barHeight / 2);
    }
  }

  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/* ══════════════════════════════════════════════════════════
   Helpers
   ══════════════════════════════════════════════════════════ */

function getComputedCSSVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMonths(m: number): string {
  const years = Math.floor(m / 12);
  const months = m % 12;
  if (years === 0) return `${months}mo`;
  if (months === 0) return `${years}y`;
  return `${years}y ${months}mo`;
}

/* ══════════════════════════════════════════════════════════
   Sub-Components
   ══════════════════════════════════════════════════════════ */

function InputField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  prefix,
  suffix,
}: {
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

/* ══════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════ */

export default function AmortizationRace(): preact.JSX.Element {
  const [loan, setLoan] = useState<LoanParams>({ ...DEFAULT_LOAN });
  const [playState, setPlayState] = useState<PlayState>("idle");
  const [speed, setSpeed] = useState<SpeedMode>(2);
  const [currentMonth, setCurrentMonth] = useState(0);
  const [enabledStrategies, setEnabledStrategies] = useState<Set<string>>(
    new Set(["minimum", "extra-500", "biweekly", "refinance"]),
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(700);
  const animRef = useRef(0);
  const lastFrameRef = useRef(0);

  const canvasHeight = Math.round(canvasWidth * 0.4);

  const monthlyRate = loan.annualRate / 100 / 12;
  const totalMonths = loan.termYears * 12;
  const basePayment = computeBasePayment(loan.principal, monthlyRate, totalMonths);
  const allStrategies = buildStrategies(loan, basePayment);
  const activeStrategies = allStrategies.filter((s) => enabledStrategies.has(s.id));

  const historyRef = useRef<Map<string, StrategySnapshot>[]>([]);

  // Precompute full race when loan or strategies change
  useEffect(() => {
    historyRef.current = precomputeFullRace(loan, activeStrategies, basePayment);
    setCurrentMonth(0);
    setPlayState("idle");
  }, [loan, enabledStrategies]);

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

  // Animation loop
  useEffect(() => {
    if (playState !== "playing") return;

    const interval = 1000 / (30 * speed);
    let running = true;

    const step = (time: number) => {
      if (!running) return;
      if (time - lastFrameRef.current >= interval) {
        lastFrameRef.current = time;
        setCurrentMonth((prev) => {
          const next = prev + 1;
          const maxMonth = historyRef.current.length - 1;
          if (next >= maxMonth) {
            setPlayState("finished");
            return maxMonth;
          }
          return next;
        });
      }
      animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
    };
  }, [playState, speed]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const history = historyRef.current;
    if (history.length === 0) return;

    const month = Math.min(currentMonth, history.length - 1);
    const snapshots = history[month];

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawRace(ctx, canvasWidth, canvasHeight, loan, activeStrategies, snapshots, month, dpr);
  }, [currentMonth, canvasWidth, canvasHeight, activeStrategies, loan]);

  const updateLoan = useCallback(<K extends keyof LoanParams>(key: K, value: LoanParams[K]) => {
    setLoan((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleStrategy = useCallback((id: string) => {
    setEnabledStrategies((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size > 2) next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handlePlayPause = useCallback(() => {
    if (playState === "idle" || playState === "finished") {
      setCurrentMonth(0);
      setPlayState("playing");
    } else if (playState === "playing") {
      setPlayState("paused");
    } else {
      setPlayState("playing");
    }
  }, [playState]);

  const handleReset = useCallback(() => {
    setPlayState("idle");
    setCurrentMonth(0);
  }, []);

  // Progress slider
  const maxMonth = historyRef.current.length > 0 ? historyRef.current.length - 1 : 0;

  const handleScrub = useCallback((e: Event) => {
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    setCurrentMonth(val);
    if (playState === "playing") setPlayState("paused");
  }, [playState]);

  // Get final summary
  const history = historyRef.current;
  const finalSnapshots = history.length > 0 ? history[history.length - 1] : null;

  return (
    <div class="space-y-6">
      {/* Loan params */}
      <div class="grid grid-cols-3 gap-3">
        <InputField
          label="Loan Amount"
          value={loan.principal}
          onChange={(v) => updateLoan("principal", v)}
          min={10000}
          step={10000}
          prefix="$"
        />
        <InputField
          label="Annual Rate"
          value={loan.annualRate}
          onChange={(v) => updateLoan("annualRate", v)}
          min={0.1}
          max={20}
          step={0.25}
          suffix="%"
        />
        <InputField
          label="Term (years)"
          value={loan.termYears}
          onChange={(v) => updateLoan("termYears", Math.max(1, Math.min(40, Math.round(v))))}
          min={1}
          max={40}
        />
      </div>

      {/* Strategy toggles */}
      <div class="flex flex-wrap gap-2">
        {allStrategies.map((s) => (
          <button
            key={s.id}
            onClick={() => toggleStrategy(s.id)}
            class={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              enabledStrategies.has(s.id)
                ? "text-white"
                : "border-[var(--color-border)] text-[var(--color-text-muted)] opacity-50"
            }`}
            style={
              enabledStrategies.has(s.id)
                ? { borderColor: s.color, background: s.color }
                : undefined
            }
          >
            {s.name}
            <span class="ml-1 opacity-70">({s.description})</span>
          </button>
        ))}
      </div>

      {/* Controls */}
      <div class="flex items-center gap-3">
        <button
          onClick={handlePlayPause}
          class="rounded-lg bg-[var(--color-primary)] px-5 py-2 text-sm font-medium text-white transition-colors hover:brightness-110"
        >
          {playState === "idle" || playState === "finished"
            ? "Play"
            : playState === "playing"
              ? "Pause"
              : "Resume"}
        </button>
        <button
          onClick={handleReset}
          class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-heading)]"
        >
          Reset
        </button>
        <div class="ml-auto flex items-center gap-1">
          <span class="text-[11px] text-[var(--color-text-muted)]">Speed:</span>
          {([1, 2, 5, 10] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              class={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                speed === s
                  ? "bg-[var(--color-primary)] text-white"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-heading)]"
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      {/* Timeline scrubber */}
      {maxMonth > 0 && (
        <div class="flex items-center gap-3">
          <span class="text-[11px] font-mono text-[var(--color-text-muted)]">
            {formatMonths(currentMonth)}
          </span>
          <input
            type="range"
            min={0}
            max={maxMonth}
            value={currentMonth}
            onInput={handleScrub}
            class="flex-1"
            style={{ accentColor: "var(--color-primary)" }}
          />
          <span class="text-[11px] font-mono text-[var(--color-text-muted)]">
            {formatMonths(maxMonth)}
          </span>
        </div>
      )}

      {/* Race Canvas */}
      <div ref={containerRef} class="overflow-hidden rounded-xl border border-[var(--color-border)]">
        <canvas
          ref={canvasRef}
          class="w-full"
          style={{ background: "var(--color-surface)", aspectRatio: "5/2" }}
        />
      </div>

      {/* Summary Table */}
      {finalSnapshots && (
        <div class="overflow-hidden rounded-lg border border-[var(--color-border)]">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
                <th class="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                  Strategy
                </th>
                <th class="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                  Time to Payoff
                </th>
                <th class="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                  Total Interest
                </th>
                <th class="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                  Total Paid
                </th>
                <th class="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                  Interest Saved
                </th>
              </tr>
            </thead>
            <tbody>
              {activeStrategies.map((s) => {
                const snap = finalSnapshots.get(s.id);
                if (!snap) return null;
                const minimumSnap = finalSnapshots.get("minimum");
                const saved = minimumSnap ? minimumSnap.totalInterest - snap.totalInterest : 0;
                return (
                  <tr key={s.id} class="border-b border-[var(--color-border)] last:border-0">
                    <td class="px-3 py-2">
                      <span class="font-medium" style={{ color: s.color }}>
                        {s.name}
                      </span>
                    </td>
                    <td class="px-3 py-2 text-right font-mono text-[var(--color-heading)]">
                      {formatMonths(snap.monthsElapsed)}
                    </td>
                    <td class="px-3 py-2 text-right font-mono text-[var(--color-heading)]">
                      {formatCurrency(snap.totalInterest)}
                    </td>
                    <td class="px-3 py-2 text-right font-mono text-[var(--color-heading)]">
                      {formatCurrency(snap.totalPaid)}
                    </td>
                    <td
                      class="px-3 py-2 text-right font-mono"
                      style={{ color: saved > 0 ? "#34d399" : "var(--color-text-muted)" }}
                    >
                      {saved > 0 ? formatCurrency(saved) : "--"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p class="text-[11px] text-[var(--color-text-muted)]">
        Watch different repayment strategies race to pay off a {formatCurrency(loan.principal)} loan
        at {loan.annualRate}%. Base payment: {formatCurrency(basePayment)}/mo. Toggle strategies and
        adjust speed to compare outcomes. Scrub the timeline to jump to any point.
      </p>
    </div>
  );
}
