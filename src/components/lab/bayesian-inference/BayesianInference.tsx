import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

interface ScenarioDef {
  id: string;
  label: string;
  description: string;
  priorAlpha: number;
  priorBeta: number;
}

interface BayesState {
  alpha: number;
  beta: number;
  successes: number;
  failures: number;
  history: Array<{ alpha: number; beta: number }>;
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const CANVAS_HEIGHT = 300;
const PLOT_PADDING = { top: 20, right: 20, bottom: 40, left: 50 };
const ANIMATION_FRAMES = 20;
const CURVE_SAMPLES = 300;

const COLORS = {
  prior: "#4f8ff7",
  likelihood: "#34d399",
  posterior: "#f59e0b",
  credible: "rgba(245, 158, 11, 0.15)",
  grid: "rgba(161, 161, 170, 0.15)",
  axis: "rgba(161, 161, 170, 0.5)",
  text: "rgba(228, 228, 231, 0.9)",
};

const SCENARIOS: ScenarioDef[] = [
  {
    id: "coin",
    label: "Coin Fairness",
    description: "Is this coin fair? Start with a uniform prior and flip to find out.",
    priorAlpha: 1,
    priorBeta: 1,
  },
  {
    id: "medical",
    label: "Medical Test",
    description: "Estimate the true positive rate of a diagnostic test.",
    priorAlpha: 2,
    priorBeta: 5,
  },
  {
    id: "ab",
    label: "A/B Test",
    description: "Which variant converts better? Update beliefs with each visitor.",
    priorAlpha: 1,
    priorBeta: 1,
  },
];

// ─────────────────────────────────────────────────────────
// Beta distribution math
// ─────────────────────────────────────────────────────────

function logGamma(z: number): number {
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  let x = c[0];
  for (let i = 1; i < g + 2; i++) {
    x += c[i] / (z + i);
  }
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function logBetaFn(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

function betaPdf(x: number, a: number, b: number): number {
  if (x <= 0 || x >= 1) return 0;
  if (a <= 0 || b <= 0) return 0;
  const logVal = (a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - logBetaFn(a, b);
  return Math.exp(logVal);
}

function betaMean(a: number, b: number): number {
  return a / (a + b);
}

function betaMode(a: number, b: number): number {
  if (a > 1 && b > 1) return (a - 1) / (a + b - 2);
  if (a <= 1 && b <= 1) return 0.5;
  if (a <= 1) return 0;
  return 1;
}

function betaVariance(a: number, b: number): number {
  return (a * b) / ((a + b) * (a + b) * (a + b + 1));
}

function betaQuantile(p: number, a: number, b: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const cdf = betaCdf(mid, a, b);
    if (cdf < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function betaCdf(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return regularizedBeta(x, a, b);
}

function regularizedBeta(x: number, a: number, b: number): number {
  const maxIter = 200;
  const eps = 1e-14;
  const lbeta = logBetaFn(a, b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;
  let f = 1;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  f = d;

  for (let m = 1; m <= maxIter; m++) {
    let numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    f *= d * c;

    numerator = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    f *= delta;
    if (Math.abs(delta - 1) < eps) break;
  }

  return front * f;
}

function sampleCurve(
  a: number,
  b: number,
  samples: number,
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= samples; i++) {
    const x = i / samples;
    points.push({ x, y: betaPdf(x, a, b) });
  }
  return points;
}

// ─────────────────────────────────────────────────────────
// Likelihood helper (binomial scaled)
// ─────────────────────────────────────────────────────────

function likelihoodCurve(
  successes: number,
  failures: number,
  samples: number,
): Array<{ x: number; y: number }> {
  if (successes === 0 && failures === 0) return [];
  const points: Array<{ x: number; y: number }> = [];
  let maxVal = 0;
  for (let i = 0; i <= samples; i++) {
    const x = i / samples;
    const y =
      x <= 0 || x >= 1
        ? 0
        : Math.pow(x, successes) * Math.pow(1 - x, failures);
    points.push({ x, y });
    if (y > maxVal) maxVal = y;
  }
  if (maxVal > 0) {
    for (const p of points) p.y /= maxVal;
  }
  return points;
}

// ─────────────────────────────────────────────────────────
// Interpolation for animation
// ─────────────────────────────────────────────────────────

function interpolateCurves(
  from: Array<{ x: number; y: number }>,
  to: Array<{ x: number; y: number }>,
  t: number,
): Array<{ x: number; y: number }> {
  return from.map((p, i) => ({
    x: p.x,
    y: p.y + (to[i].y - p.y) * t,
  }));
}

// ─────────────────────────────────────────────────────────
// Canvas drawing
// ─────────────────────────────────────────────────────────

function drawDistributions(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  priorCurve: Array<{ x: number; y: number }>,
  likCurve: Array<{ x: number; y: number }>,
  posteriorCurve: Array<{ x: number; y: number }>,
  credibleLow: number,
  credibleHigh: number,
): void {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const plotW = width - PLOT_PADDING.left - PLOT_PADDING.right;
  const plotH = height - PLOT_PADDING.top - PLOT_PADDING.bottom;

  const allPoints = [...priorCurve, ...likCurve, ...posteriorCurve];
  let maxY = 0;
  for (const p of allPoints) {
    if (p.y > maxY) maxY = p.y;
  }
  if (maxY < 0.1) maxY = 1;
  maxY *= 1.1;

  const toCanvasX = (x: number) => PLOT_PADDING.left + x * plotW;
  const toCanvasY = (y: number) => PLOT_PADDING.top + plotH - (y / maxY) * plotH;

  // Grid
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const x = toCanvasX(i / 5);
    ctx.beginPath();
    ctx.moveTo(x, PLOT_PADDING.top);
    ctx.lineTo(x, PLOT_PADDING.top + plotH);
    ctx.stroke();
  }
  for (let i = 0; i <= 4; i++) {
    const yVal = (maxY * i) / 4;
    const y = toCanvasY(yVal);
    ctx.beginPath();
    ctx.moveTo(PLOT_PADDING.left, y);
    ctx.lineTo(PLOT_PADDING.left + plotW, y);
    ctx.stroke();

    ctx.fillStyle = COLORS.text;
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(yVal.toFixed(1), PLOT_PADDING.left - 6, y + 4);
  }

  // X-axis labels
  ctx.textAlign = "center";
  for (let i = 0; i <= 5; i++) {
    const xVal = i / 5;
    ctx.fillText(xVal.toFixed(1), toCanvasX(xVal), height - PLOT_PADDING.bottom + 18);
  }

  // Axes
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(PLOT_PADDING.left, PLOT_PADDING.top);
  ctx.lineTo(PLOT_PADDING.left, PLOT_PADDING.top + plotH);
  ctx.lineTo(PLOT_PADDING.left + plotW, PLOT_PADDING.top + plotH);
  ctx.stroke();

  // Credible interval shading
  if (credibleLow >= 0 && credibleHigh >= 0) {
    ctx.fillStyle = COLORS.credible;
    ctx.beginPath();
    const startX = toCanvasX(credibleLow);
    const endX = toCanvasX(credibleHigh);
    ctx.rect(startX, PLOT_PADDING.top, endX - startX, plotH);
    ctx.fill();
  }

  // Draw curve helper
  const drawCurve = (
    points: Array<{ x: number; y: number }>,
    color: string,
    lineWidth: number,
    dashed: boolean = false,
  ) => {
    if (points.length === 0) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(dashed ? [6, 4] : []);
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const cx = toCanvasX(points[i].x);
      const cy = toCanvasY(points[i].y);
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };

  drawCurve(priorCurve, COLORS.prior, 2, true);
  if (likCurve.length > 0) {
    const scaledLik = likCurve.map((p) => ({ x: p.x, y: p.y * maxY * 0.5 }));
    drawCurve(scaledLik, COLORS.likelihood, 1.5, false);
  }
  drawCurve(posteriorCurve, COLORS.posterior, 2.5, false);

  // Axis title
  ctx.fillStyle = COLORS.text;
  ctx.font = "12px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Probability (p)", width / 2, height - 4);
}

// ─────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────

export default function BayesianInference() {
  const [scenarioId, setScenarioId] = useState("coin");
  const [customAlpha, setCustomAlpha] = useState(1);
  const [customBeta, setCustomBeta] = useState(1);
  const [state, setState] = useState<BayesState>({
    alpha: 1,
    beta: 1,
    successes: 0,
    failures: 0,
    history: [{ alpha: 1, beta: 1 }],
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(600);
  const animRef = useRef<number>(0);
  const animCurveRef = useRef<Array<{ x: number; y: number }> | null>(null);
  const [displayCurve, setDisplayCurve] = useState<Array<{ x: number; y: number }>>([]);

  const scenario = useMemo(
    () => SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0],
    [scenarioId],
  );

  // Prior curve (original, before observations)
  const priorCurve = useMemo(
    () => sampleCurve(scenario.priorAlpha + customAlpha - 1, scenario.priorBeta + customBeta - 1, CURVE_SAMPLES),
    [scenario, customAlpha, customBeta],
  );

  // Current posterior curve
  const posteriorCurve = useMemo(
    () => sampleCurve(state.alpha, state.beta, CURVE_SAMPLES),
    [state.alpha, state.beta],
  );

  // Likelihood curve
  const likCurve = useMemo(
    () => likelihoodCurve(state.successes, state.failures, CURVE_SAMPLES),
    [state.successes, state.failures],
  );

  // Credible interval (95%)
  const credibleLow = useMemo(() => betaQuantile(0.025, state.alpha, state.beta), [state.alpha, state.beta]);
  const credibleHigh = useMemo(() => betaQuantile(0.975, state.alpha, state.beta), [state.alpha, state.beta]);

  // Initialize on scenario change
  useEffect(() => {
    const s = SCENARIOS.find((sc) => sc.id === scenarioId) ?? SCENARIOS[0];
    const a = s.priorAlpha + customAlpha - 1;
    const b = s.priorBeta + customBeta - 1;
    setState({
      alpha: a,
      beta: b,
      successes: 0,
      failures: 0,
      history: [{ alpha: a, beta: b }],
    });
    animCurveRef.current = null;
  }, [scenarioId, customAlpha, customBeta]);

  // Responsive canvas
  useEffect(() => {
    function handleResize() {
      if (containerRef.current) {
        setCanvasWidth(containerRef.current.clientWidth);
      }
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Animation when posterior updates
  useEffect(() => {
    const prev = animCurveRef.current;
    if (!prev) {
      animCurveRef.current = posteriorCurve;
      setDisplayCurve(posteriorCurve);
      return;
    }

    let frame = 0;
    const animate = () => {
      frame++;
      const t = Math.min(frame / ANIMATION_FRAMES, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const interpolated = interpolateCurves(prev, posteriorCurve, eased);
      setDisplayCurve(interpolated);
      if (t < 1) {
        animRef.current = requestAnimationFrame(animate);
      } else {
        animCurveRef.current = posteriorCurve;
      }
    };
    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [posteriorCurve]);

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = CANVAS_HEIGHT * dpr;

    drawDistributions(
      ctx,
      canvasWidth,
      CANVAS_HEIGHT,
      priorCurve,
      likCurve,
      displayCurve.length > 0 ? displayCurve : posteriorCurve,
      credibleLow,
      credibleHigh,
    );
  }, [canvasWidth, priorCurve, likCurve, displayCurve, posteriorCurve, credibleLow, credibleHigh]);

  const observe = useCallback(
    (success: boolean) => {
      setState((prev) => {
        const newAlpha = prev.alpha + (success ? 1 : 0);
        const newBeta = prev.beta + (success ? 0 : 1);
        return {
          alpha: newAlpha,
          beta: newBeta,
          successes: prev.successes + (success ? 1 : 0),
          failures: prev.failures + (success ? 0 : 1),
          history: [...prev.history, { alpha: newAlpha, beta: newBeta }],
        };
      });
    },
    [],
  );

  const observeBatch = useCallback(
    (count: number, successRate: number) => {
      const successes = Math.round(count * successRate);
      const failures = count - successes;
      setState((prev) => {
        const newAlpha = prev.alpha + successes;
        const newBeta = prev.beta + failures;
        return {
          alpha: newAlpha,
          beta: newBeta,
          successes: prev.successes + successes,
          failures: prev.failures + failures,
          history: [...prev.history, { alpha: newAlpha, beta: newBeta }],
        };
      });
    },
    [],
  );

  const reset = useCallback(() => {
    const s = SCENARIOS.find((sc) => sc.id === scenarioId) ?? SCENARIOS[0];
    const a = s.priorAlpha + customAlpha - 1;
    const b = s.priorBeta + customBeta - 1;
    animCurveRef.current = null;
    setState({
      alpha: a,
      beta: b,
      successes: 0,
      failures: 0,
      history: [{ alpha: a, beta: b }],
    });
  }, [scenarioId, customAlpha, customBeta]);

  const mean = betaMean(state.alpha, state.beta);
  const mode = betaMode(state.alpha, state.beta);
  const variance = betaVariance(state.alpha, state.beta);
  const totalObs = state.successes + state.failures;

  return (
    <div class="space-y-4">
      {/* Scenario tabs */}
      <div class="flex flex-wrap gap-2">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            onClick={() => setScenarioId(s.id)}
            class={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              scenarioId === s.id
                ? "bg-[var(--color-primary)] text-white"
                : "bg-[var(--color-surface)] text-[var(--color-text-muted)] border border-[var(--color-border)] hover:text-[var(--color-text)]"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <p class="text-sm text-[var(--color-text-muted)]">{scenario.description}</p>

      {/* Prior parameter sliders */}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div>
          <label class="block text-xs text-[var(--color-text-muted)] mb-1">
            Prior Alpha: {customAlpha.toFixed(1)}
          </label>
          <input
            type="range"
            min="0.5"
            max="20"
            step="0.5"
            value={customAlpha}
            onInput={(e) => setCustomAlpha(parseFloat((e.target as HTMLInputElement).value))}
            class="w-full accent-[var(--color-primary)]"
          />
        </div>
        <div>
          <label class="block text-xs text-[var(--color-text-muted)] mb-1">
            Prior Beta: {customBeta.toFixed(1)}
          </label>
          <input
            type="range"
            min="0.5"
            max="20"
            step="0.5"
            value={customBeta}
            onInput={(e) => setCustomBeta(parseFloat((e.target as HTMLInputElement).value))}
            class="w-full accent-[var(--color-primary)]"
          />
        </div>
      </div>

      {/* Canvas */}
      <div ref={containerRef} class="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden">
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={CANVAS_HEIGHT}
          style={{ width: `${canvasWidth}px`, height: `${CANVAS_HEIGHT}px` }}
        />
      </div>

      {/* Legend */}
      <div class="flex flex-wrap gap-4 text-xs">
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-5 h-0.5 border-t-2 border-dashed" style={{ borderColor: COLORS.prior }} />
          Prior
        </span>
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-5 h-0.5" style={{ backgroundColor: COLORS.likelihood }} />
          Likelihood (scaled)
        </span>
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-5 h-0.5" style={{ backgroundColor: COLORS.posterior }} />
          Posterior
        </span>
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-4 h-3 rounded-sm" style={{ backgroundColor: COLORS.credible }} />
          95% Credible
        </span>
      </div>

      {/* Observation buttons */}
      <div class="flex flex-wrap gap-2">
        <button
          onClick={() => observe(true)}
          class="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-sm font-medium text-white transition-colors"
        >
          {scenarioId === "coin" ? "Heads (Success)" : scenarioId === "medical" ? "True Positive" : "Converted"}
        </button>
        <button
          onClick={() => observe(false)}
          class="rounded-lg bg-red-600 hover:bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors"
        >
          {scenarioId === "coin" ? "Tails (Failure)" : scenarioId === "medical" ? "False Negative" : "Bounced"}
        </button>
        <button
          onClick={() => observeBatch(10, 0.7)}
          class="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-primary)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          +10 (70% success)
        </button>
        <button
          onClick={() => observeBatch(50, 0.5)}
          class="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-primary)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          +50 (50% success)
        </button>
        <button
          onClick={reset}
          class="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-red-500 px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-red-400 transition-colors"
        >
          Reset
        </button>
      </div>

      {/* Stats panel */}
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Posterior Alpha" value={state.alpha.toFixed(2)} />
        <StatCard label="Posterior Beta" value={state.beta.toFixed(2)} />
        <StatCard label="Mean" value={mean.toFixed(4)} />
        <StatCard label="Mode" value={mode.toFixed(4)} />
        <StatCard label="Variance" value={variance.toFixed(6)} />
        <StatCard label="Std Dev" value={Math.sqrt(variance).toFixed(4)} />
        <StatCard label="95% CI" value={`[${credibleLow.toFixed(3)}, ${credibleHigh.toFixed(3)}]`} />
        <StatCard label="Observations" value={`${state.successes}S / ${state.failures}F (${totalObs})`} />
      </div>

      {/* History timeline */}
      {state.history.length > 1 && (
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h3 class="text-sm font-semibold text-[var(--color-heading)] mb-2">
            Update History
          </h3>
          <div class="flex flex-wrap gap-1 text-xs text-[var(--color-text-muted)]">
            {state.history.slice(-20).map((h, i) => (
              <span
                key={i}
                class="rounded bg-[var(--color-bg)] px-2 py-0.5 border border-[var(--color-border)]"
              >
                Beta({h.alpha.toFixed(1)}, {h.beta.toFixed(1)})
              </span>
            ))}
            {state.history.length > 20 && (
              <span class="px-2 py-0.5 text-[var(--color-text-muted)]">
                ... ({state.history.length - 20} more)
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Stat card sub-component
// ─────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div class="text-xs text-[var(--color-text-muted)]">{label}</div>
      <div class="text-sm font-mono font-semibold text-[var(--color-heading)] mt-0.5">
        {value}
      </div>
    </div>
  );
}
