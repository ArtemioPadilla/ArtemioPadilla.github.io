import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";

/* ══════════════════════════════════════════════════════════
   Types & Constants
   ══════════════════════════════════════════════════════════ */

type TabId = "pi" | "integration" | "rejection" | "importance";

interface Point {
  x: number;
  y: number;
  inside: boolean;
}

interface IntegrationPoint {
  x: number;
  y: number;
  below: boolean;
}

interface RejectionPoint {
  x: number;
  y: number;
  accepted: boolean;
  alpha: number;
}

interface IntegralFunc {
  id: string;
  label: string;
  fn: (x: number) => number;
  domain: [number, number];
  trueValue: number;
  yMax: number;
}

interface TargetDist {
  id: string;
  label: string;
  pdf: (x: number) => number;
  domain: [number, number];
  maxPdf: number;
}

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "pi", label: "Estimate Pi", icon: "π" },
  { id: "integration", label: "Integration", icon: "∫" },
  { id: "rejection", label: "Rejection", icon: "✓" },
  { id: "importance", label: "Importance", icon: "w" },
];

const SPEEDS = [1, 10, 100, 1000];

/* ── Math Helpers ────────────────────────────────────────── */

function betaPdf(x: number, a: number, b: number): number {
  if (x <= 0 || x >= 1) return 0;
  const B = (gamma(a) * gamma(b)) / gamma(a + b);
  return Math.pow(x, a - 1) * Math.pow(1 - x, b - 1) / B;
}

function gammaPdf(x: number, k: number, theta: number): number {
  if (x <= 0) return 0;
  return (Math.pow(x, k - 1) * Math.exp(-x / theta)) / (Math.pow(theta, k) * gamma(k));
}

function gamma(z: number): number {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

function gaussianPdf(x: number, mu: number, sigma: number): number {
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

function mixtureGaussianPdf(x: number): number {
  return 0.3 * gaussianPdf(x, -2, 0.7) + 0.5 * gaussianPdf(x, 1, 1.0) + 0.2 * gaussianPdf(x, 4, 0.5);
}

/* ── Integral Functions ──────────────────────────────────── */

const INTEGRAL_FUNCS: IntegralFunc[] = [
  {
    id: "sinx",
    label: "sin(x) on [0, π]",
    fn: (x: number) => Math.sin(x),
    domain: [0, Math.PI],
    trueValue: 2.0,
    yMax: 1.05,
  },
  {
    id: "expx2",
    label: "e^(-x²) on [-2, 2]",
    fn: (x: number) => Math.exp(-x * x),
    domain: [-2, 2],
    trueValue: 1.7724538509,
    yMax: 1.05,
  },
  {
    id: "x2",
    label: "x² on [0, 1]",
    fn: (x: number) => x * x,
    domain: [0, 1],
    trueValue: 1 / 3,
    yMax: 1.05,
  },
  {
    id: "sincos",
    label: "|sin(x)cos(x)| on [0, 2π]",
    fn: (x: number) => Math.abs(Math.sin(x) * Math.cos(x)),
    domain: [0, 2 * Math.PI],
    trueValue: 2.0,
    yMax: 0.55,
  },
];

/* ── Target Distributions for Rejection ──────────────────── */

const TARGET_DISTS: TargetDist[] = [
  {
    id: "beta25",
    label: "Beta(2, 5)",
    pdf: (x: number) => betaPdf(x, 2, 5),
    domain: [0, 1],
    maxPdf: 2.6,
  },
  {
    id: "gamma21",
    label: "Gamma(2, 1)",
    pdf: (x: number) => gammaPdf(x, 2, 1),
    domain: [0, 8],
    maxPdf: 0.38,
  },
  {
    id: "mixture",
    label: "Mixture of Gaussians",
    pdf: mixtureGaussianPdf,
    domain: [-5, 7],
    maxPdf: 0.45,
  },
];

/* ── Shared Styles ───────────────────────────────────────── */

const panelStyle: Record<string, string> = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "12px",
  padding: "16px",
};

const btnStyle: Record<string, string> = {
  padding: "6px 14px",
  borderRadius: "6px",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  cursor: "pointer",
  fontSize: "13px",
  fontFamily: "var(--font-sans)",
};

const activeBtnStyle: Record<string, string> = {
  ...btnStyle,
  background: "var(--color-primary)",
  color: "#fff",
  borderColor: "var(--color-primary)",
};

const labelStyle: Record<string, string> = {
  fontSize: "12px",
  color: "var(--color-text-muted)",
  fontFamily: "var(--font-sans)",
};

const statStyle: Record<string, string> = {
  fontSize: "14px",
  color: "var(--color-heading)",
  fontFamily: "var(--font-mono)",
  fontWeight: "600",
};

/* ══════════════════════════════════════════════════════════
   Helper: resolve CSS variable
   ══════════════════════════════════════════════════════════ */

function resolveColor(canvas: HTMLCanvasElement, varName: string, fallback: string): string {
  return getComputedStyle(canvas).getPropertyValue(varName).trim() || fallback;
}

/* ══════════════════════════════════════════════════════════
   TAB 1: Estimate Pi
   ══════════════════════════════════════════════════════════ */

function EstimatePi() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [running, setRunning] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const runRef = useRef(false);
  const pointsRef = useRef<Point[]>([]);
  const historyRef = useRef<{ n: number; estimate: number }[]>([]);

  const inside = useMemo(() => points.filter((p) => p.inside).length, [points]);
  const estimate = points.length > 0 ? (4 * inside) / points.length : 0;
  const error = points.length > 0 ? Math.abs(estimate - Math.PI) : 0;

  const reset = useCallback(() => {
    setRunning(false);
    runRef.current = false;
    setPoints([]);
    pointsRef.current = [];
    historyRef.current = [];
  }, []);

  const drawMain = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    const bg = resolveColor(canvas, "--color-bg", "#09090b");
    const border = resolveColor(canvas, "--color-border", "#27272a");
    const primary = resolveColor(canvas, "--color-primary", "#4f8ff7");
    const accent = resolveColor(canvas, "--color-accent", "#34d399");

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Draw circle arc
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, w, h);

    ctx.beginPath();
    ctx.arc(0, h, w, -Math.PI / 2, 0);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw points
    const pts = pointsRef.current;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      ctx.fillStyle = p.inside ? primary : "#ef4444";
      ctx.globalAlpha = 0.6;
      ctx.fillRect(p.x * w, (1 - p.y) * h, 2, 2);
    }
    ctx.globalAlpha = 1.0;
  }, []);

  const drawChart = useCallback(() => {
    const canvas = chartRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    const bg = resolveColor(canvas, "--color-bg", "#09090b");
    const textMuted = resolveColor(canvas, "--color-text-muted", "#a1a1aa");
    const primary = resolveColor(canvas, "--color-primary", "#4f8ff7");
    const accent = resolveColor(canvas, "--color-accent", "#34d399");

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const history = historyRef.current;
    if (history.length < 2) return;

    const pad = { l: 50, r: 10, t: 10, b: 30 };
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;

    const maxN = history[history.length - 1].n;
    let yMin = Math.PI - 0.5;
    let yMax = Math.PI + 0.5;
    for (const h2 of history) {
      if (h2.estimate < yMin) yMin = h2.estimate - 0.1;
      if (h2.estimate > yMax) yMax = h2.estimate + 0.1;
    }

    // Axes
    ctx.strokeStyle = textMuted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t);
    ctx.lineTo(pad.l, h - pad.b);
    ctx.lineTo(w - pad.r, h - pad.b);
    ctx.stroke();

    // True pi line
    const piY = pad.t + ph * (1 - (Math.PI - yMin) / (yMax - yMin));
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = accent;
    ctx.beginPath();
    ctx.moveTo(pad.l, piY);
    ctx.lineTo(w - pad.r, piY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = accent;
    ctx.font = "11px var(--font-mono)";
    ctx.textAlign = "right";
    ctx.fillText("π", pad.l - 5, piY + 4);

    // Estimate line
    ctx.strokeStyle = primary;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < history.length; i++) {
      const hh = history[i];
      const x = pad.l + (hh.n / maxN) * pw;
      const y = pad.t + ph * (1 - (hh.estimate - yMin) / (yMax - yMin));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Labels
    ctx.fillStyle = textMuted;
    ctx.font = "10px var(--font-sans)";
    ctx.textAlign = "center";
    ctx.fillText("Darts thrown", w / 2, h - 4);
    ctx.textAlign = "left";
    ctx.fillText("0", pad.l, h - pad.b + 14);
    ctx.textAlign = "right";
    ctx.fillText(maxN.toLocaleString(), w - pad.r, h - pad.b + 14);
  }, []);

  useEffect(() => {
    if (!running) return;
    runRef.current = true;
    let raf: number;

    const step = () => {
      if (!runRef.current) return;
      const speed = SPEEDS[speedIdx];
      const newPts: Point[] = [];
      for (let i = 0; i < speed; i++) {
        const x = Math.random();
        const y = Math.random();
        const inside = x * x + y * y <= 1;
        newPts.push({ x, y, inside });
      }
      pointsRef.current = [...pointsRef.current, ...newPts];

      const allPts = pointsRef.current;
      const insideCount = allPts.filter((p) => p.inside).length;
      const est = (4 * insideCount) / allPts.length;

      if (allPts.length % Math.max(1, Math.floor(speed)) === 0 || historyRef.current.length < 5) {
        historyRef.current.push({ n: allPts.length, estimate: est });
        if (historyRef.current.length > 500) {
          historyRef.current = historyRef.current.filter(
            (_, i) => i % 2 === 0 || i === historyRef.current.length - 1
          );
        }
      }

      setPoints([...pointsRef.current]);
      drawMain();
      drawChart();
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => {
      runRef.current = false;
      cancelAnimationFrame(raf);
    };
  }, [running, speedIdx, drawMain, drawChart]);

  useEffect(() => {
    drawMain();
    drawChart();
  }, [drawMain, drawChart]);

  return (
    <div>
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 300px", minWidth: "280px" }}>
          <canvas
            ref={canvasRef}
            width={400}
            height={400}
            style={{ width: "100%", aspectRatio: "1", borderRadius: "8px", border: "1px solid var(--color-border)" }}
          />
        </div>
        <div style={{ flex: "1 1 300px", minWidth: "280px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "12px" }}>
            <div style={panelStyle}>
              <div style={labelStyle}>Darts</div>
              <div style={statStyle}>{points.length.toLocaleString()}</div>
            </div>
            <div style={panelStyle}>
              <div style={labelStyle}>Estimate</div>
              <div style={statStyle}>{estimate.toFixed(6)}</div>
            </div>
            <div style={panelStyle}>
              <div style={labelStyle}>Error</div>
              <div style={{ ...statStyle, color: "#ef4444" }}>{error.toFixed(6)}</div>
            </div>
          </div>
          <canvas
            ref={chartRef}
            width={500}
            height={200}
            style={{ width: "100%", height: "160px", borderRadius: "8px", border: "1px solid var(--color-border)" }}
          />
          <div style={{ display: "flex", gap: "8px", marginTop: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <button style={running ? activeBtnStyle : btnStyle} onClick={() => setRunning(!running)}>
              {running ? "Pause" : "Start"}
            </button>
            <button style={btnStyle} onClick={reset}>Reset</button>
            <span style={labelStyle}>Speed:</span>
            {SPEEDS.map((s, i) => (
              <button
                key={s}
                style={i === speedIdx ? activeBtnStyle : btnStyle}
                onClick={() => setSpeedIdx(i)}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   TAB 2: Monte Carlo Integration
   ══════════════════════════════════════════════════════════ */

function MCIntegration() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const [funcIdx, setFuncIdx] = useState(0);
  const [points, setPoints] = useState<IntegrationPoint[]>([]);
  const [running, setRunning] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const runRef = useRef(false);
  const pointsRef = useRef<IntegrationPoint[]>([]);
  const historyRef = useRef<{ n: number; estimate: number }[]>([]);

  const func = INTEGRAL_FUNCS[funcIdx];
  const belowCount = useMemo(() => points.filter((p) => p.below).length, [points]);
  const rectArea = (func.domain[1] - func.domain[0]) * func.yMax;
  const estimate = points.length > 0 ? (belowCount / points.length) * rectArea : 0;
  const error = points.length > 0 ? Math.abs(estimate - func.trueValue) : 0;

  const reset = useCallback(() => {
    setRunning(false);
    runRef.current = false;
    setPoints([]);
    pointsRef.current = [];
    historyRef.current = [];
  }, []);

  useEffect(() => {
    reset();
  }, [funcIdx, reset]);

  const drawMain = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    const bg = resolveColor(canvas, "--color-bg", "#09090b");
    const border = resolveColor(canvas, "--color-border", "#27272a");
    const primary = resolveColor(canvas, "--color-primary", "#4f8ff7");
    const accent = resolveColor(canvas, "--color-accent", "#34d399");

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const pad = { l: 40, r: 10, t: 10, b: 30 };
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;

    const [xMin, xMax] = func.domain;
    const yMaxVal = func.yMax;

    const toCanvasX = (x: number) => pad.l + ((x - xMin) / (xMax - xMin)) * pw;
    const toCanvasY = (y: number) => pad.t + ph * (1 - y / yMaxVal);

    // Axes
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t);
    ctx.lineTo(pad.l, h - pad.b);
    ctx.lineTo(w - pad.r, h - pad.b);
    ctx.stroke();

    // Draw function curve
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const steps = 200;
    for (let i = 0; i <= steps; i++) {
      const x = xMin + (i / steps) * (xMax - xMin);
      const y = func.fn(x);
      const cx = toCanvasX(x);
      const cy = toCanvasY(y);
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.stroke();

    // Draw points
    const pts = pointsRef.current;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      ctx.fillStyle = p.below ? primary : "#ef4444";
      ctx.globalAlpha = 0.5;
      const cx = toCanvasX(p.x);
      const cy = toCanvasY(p.y);
      ctx.fillRect(cx - 1, cy - 1, 2, 2);
    }
    ctx.globalAlpha = 1.0;
  }, [func]);

  const drawChart = useCallback(() => {
    const canvas = chartRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    const bg = resolveColor(canvas, "--color-bg", "#09090b");
    const textMuted = resolveColor(canvas, "--color-text-muted", "#a1a1aa");
    const primary = resolveColor(canvas, "--color-primary", "#4f8ff7");
    const accent = resolveColor(canvas, "--color-accent", "#34d399");

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const history = historyRef.current;
    if (history.length < 2) return;

    const pad = { l: 50, r: 10, t: 10, b: 30 };
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;

    const maxN = history[history.length - 1].n;
    let yMin = func.trueValue - 0.5;
    let yMax = func.trueValue + 0.5;
    for (const hh of history) {
      if (hh.estimate < yMin) yMin = hh.estimate - 0.1;
      if (hh.estimate > yMax) yMax = hh.estimate + 0.1;
    }

    ctx.strokeStyle = textMuted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t);
    ctx.lineTo(pad.l, h - pad.b);
    ctx.lineTo(w - pad.r, h - pad.b);
    ctx.stroke();

    // True value line
    const trueY = pad.t + ph * (1 - (func.trueValue - yMin) / (yMax - yMin));
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = accent;
    ctx.beginPath();
    ctx.moveTo(pad.l, trueY);
    ctx.lineTo(w - pad.r, trueY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = accent;
    ctx.font = "10px var(--font-mono)";
    ctx.textAlign = "right";
    ctx.fillText("true", pad.l - 5, trueY + 4);

    // Estimate line
    ctx.strokeStyle = primary;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < history.length; i++) {
      const hh = history[i];
      const x = pad.l + (hh.n / maxN) * pw;
      const y = pad.t + ph * (1 - (hh.estimate - yMin) / (yMax - yMin));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.fillStyle = textMuted;
    ctx.font = "10px var(--font-sans)";
    ctx.textAlign = "center";
    ctx.fillText("Samples", w / 2, h - 4);
  }, [func]);

  useEffect(() => {
    if (!running) return;
    runRef.current = true;
    let raf: number;

    const step = () => {
      if (!runRef.current) return;
      const speed = SPEEDS[speedIdx];
      const [xMin, xMax] = func.domain;
      const newPts: IntegrationPoint[] = [];
      for (let i = 0; i < speed; i++) {
        const x = xMin + Math.random() * (xMax - xMin);
        const y = Math.random() * func.yMax;
        const below = y <= func.fn(x);
        newPts.push({ x, y, below });
      }
      pointsRef.current = [...pointsRef.current, ...newPts];

      const allPts = pointsRef.current;
      const belowC = allPts.filter((p) => p.below).length;
      const est = (belowC / allPts.length) * rectArea;

      historyRef.current.push({ n: allPts.length, estimate: est });
      if (historyRef.current.length > 500) {
        historyRef.current = historyRef.current.filter(
          (_, i) => i % 2 === 0 || i === historyRef.current.length - 1
        );
      }

      setPoints([...pointsRef.current]);
      drawMain();
      drawChart();
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => {
      runRef.current = false;
      cancelAnimationFrame(raf);
    };
  }, [running, speedIdx, func, rectArea, drawMain, drawChart]);

  useEffect(() => {
    drawMain();
    drawChart();
  }, [drawMain, drawChart]);

  return (
    <div>
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
        {INTEGRAL_FUNCS.map((f, i) => (
          <button key={f.id} style={i === funcIdx ? activeBtnStyle : btnStyle} onClick={() => setFuncIdx(i)}>
            {f.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 300px", minWidth: "280px" }}>
          <canvas
            ref={canvasRef}
            width={500}
            height={400}
            style={{ width: "100%", height: "auto", borderRadius: "8px", border: "1px solid var(--color-border)" }}
          />
        </div>
        <div style={{ flex: "1 1 300px", minWidth: "280px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
            <div style={panelStyle}>
              <div style={labelStyle}>Samples</div>
              <div style={statStyle}>{points.length.toLocaleString()}</div>
            </div>
            <div style={panelStyle}>
              <div style={labelStyle}>Estimate</div>
              <div style={statStyle}>{estimate.toFixed(6)}</div>
            </div>
            <div style={panelStyle}>
              <div style={labelStyle}>True Value</div>
              <div style={{ ...statStyle, color: "var(--color-accent)" }}>{func.trueValue.toFixed(6)}</div>
            </div>
            <div style={panelStyle}>
              <div style={labelStyle}>Error</div>
              <div style={{ ...statStyle, color: "#ef4444" }}>{error.toFixed(6)}</div>
            </div>
          </div>
          <canvas
            ref={chartRef}
            width={500}
            height={180}
            style={{ width: "100%", height: "140px", borderRadius: "8px", border: "1px solid var(--color-border)" }}
          />
          <div style={{ display: "flex", gap: "8px", marginTop: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <button style={running ? activeBtnStyle : btnStyle} onClick={() => setRunning(!running)}>
              {running ? "Pause" : "Start"}
            </button>
            <button style={btnStyle} onClick={reset}>Reset</button>
            <span style={labelStyle}>Speed:</span>
            {SPEEDS.map((s, i) => (
              <button key={s} style={i === speedIdx ? activeBtnStyle : btnStyle} onClick={() => setSpeedIdx(i)}>
                {s}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   TAB 3: Rejection Sampling
   ══════════════════════════════════════════════════════════ */

function RejectionSampling() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const histRef = useRef<HTMLCanvasElement>(null);
  const [distIdx, setDistIdx] = useState(0);
  const [mScale, setMScale] = useState(1.2);
  const [running, setRunning] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const runRef = useRef(false);
  const [accepted, setAccepted] = useState(0);
  const [total, setTotal] = useState(0);
  const acceptedRef = useRef(0);
  const totalRef = useRef(0);
  const pointsRef = useRef<RejectionPoint[]>([]);
  const samplesRef = useRef<number[]>([]);

  const dist = TARGET_DISTS[distIdx];
  const acceptanceRate = total > 0 ? (accepted / total) * 100 : 0;

  const reset = useCallback(() => {
    setRunning(false);
    runRef.current = false;
    setAccepted(0);
    setTotal(0);
    acceptedRef.current = 0;
    totalRef.current = 0;
    pointsRef.current = [];
    samplesRef.current = [];
  }, []);

  useEffect(() => {
    reset();
  }, [distIdx, reset]);

  const drawMain = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    const bg = resolveColor(canvas, "--color-bg", "#09090b");
    const border = resolveColor(canvas, "--color-border", "#27272a");
    const primary = resolveColor(canvas, "--color-primary", "#4f8ff7");
    const textMuted = resolveColor(canvas, "--color-text-muted", "#a1a1aa");

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const pad = { l: 40, r: 10, t: 10, b: 30 };
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;

    const [xMin, xMax] = dist.domain;
    const yMaxVal = dist.maxPdf * mScale * 1.1;

    const toCanvasX = (x: number) => pad.l + ((x - xMin) / (xMax - xMin)) * pw;
    const toCanvasY = (y: number) => pad.t + ph * (1 - y / yMaxVal);

    // Axes
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t);
    ctx.lineTo(pad.l, h - pad.b);
    ctx.lineTo(w - pad.r, h - pad.b);
    ctx.stroke();

    // Proposal envelope (M * uniform)
    const uniformDensity = 1 / (xMax - xMin);
    const mUniform = dist.maxPdf * mScale;
    const envY = toCanvasY(mUniform);
    ctx.fillStyle = textMuted;
    ctx.globalAlpha = 0.1;
    ctx.fillRect(pad.l, envY, pw, h - pad.b - envY);
    ctx.globalAlpha = 1.0;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = textMuted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, envY);
    ctx.lineTo(w - pad.r, envY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = textMuted;
    ctx.font = "10px var(--font-mono)";
    ctx.textAlign = "left";
    ctx.fillText("M*g(x)", pad.l + 4, envY - 4);

    // Target distribution
    ctx.strokeStyle = primary;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const steps = 200;
    for (let i = 0; i <= steps; i++) {
      const x = xMin + (i / steps) * (xMax - xMin);
      const y = dist.pdf(x);
      const cx = toCanvasX(x);
      const cy = toCanvasY(y);
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.stroke();

    // Draw recent points with fade
    const pts = pointsRef.current;
    const maxShow = 2000;
    const start = Math.max(0, pts.length - maxShow);
    for (let i = start; i < pts.length; i++) {
      const p = pts[i];
      const a = p.alpha * (0.3 + 0.7 * ((i - start) / (pts.length - start)));
      ctx.globalAlpha = Math.max(0.1, a);
      ctx.fillStyle = p.accepted ? "#34d399" : "#ef4444";
      const cx = toCanvasX(p.x);
      const cy = toCanvasY(p.y);
      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;
  }, [dist, mScale]);

  const drawHist = useCallback(() => {
    const canvas = histRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    const bg = resolveColor(canvas, "--color-bg", "#09090b");
    const primary = resolveColor(canvas, "--color-primary", "#4f8ff7");
    const accent = resolveColor(canvas, "--color-accent", "#34d399");
    const textMuted = resolveColor(canvas, "--color-text-muted", "#a1a1aa");

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const samples = samplesRef.current;
    if (samples.length < 10) {
      ctx.fillStyle = textMuted;
      ctx.font = "12px var(--font-sans)";
      ctx.textAlign = "center";
      ctx.fillText("Collecting samples...", w / 2, h / 2);
      return;
    }

    const pad = { l: 10, r: 10, t: 10, b: 20 };
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;

    const [xMin, xMax] = dist.domain;
    const nBins = 50;
    const binWidth = (xMax - xMin) / nBins;
    const bins = new Array(nBins).fill(0);

    for (const s of samples) {
      const idx = Math.floor((s - xMin) / binWidth);
      if (idx >= 0 && idx < nBins) bins[idx]++;
    }

    const maxBin = Math.max(...bins);
    if (maxBin === 0) return;

    // Normalize bins to compare with pdf
    const maxPdfVal = dist.maxPdf;
    const scale = maxPdfVal / (maxBin / (samples.length * binWidth));

    // Draw histogram bars
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < nBins; i++) {
      const barH = (bins[i] / maxBin) * ph;
      const x = pad.l + (i / nBins) * pw;
      const bw = pw / nBins;
      ctx.fillRect(x, pad.t + ph - barH, bw - 1, barH);
    }
    ctx.globalAlpha = 1.0;

    // Overlay target pdf
    ctx.strokeStyle = primary;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const steps = 200;
    for (let i = 0; i <= steps; i++) {
      const x = xMin + (i / steps) * (xMax - xMin);
      const y = dist.pdf(x) / maxPdfVal;
      const cx = pad.l + ((x - xMin) / (xMax - xMin)) * pw;
      const cy = pad.t + ph * (1 - y);
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.stroke();

    ctx.fillStyle = textMuted;
    ctx.font = "10px var(--font-sans)";
    ctx.textAlign = "center";
    ctx.fillText("Accepted samples histogram vs target PDF", w / 2, h - 4);
  }, [dist]);

  useEffect(() => {
    if (!running) return;
    runRef.current = true;
    let raf: number;

    const step = () => {
      if (!runRef.current) return;
      const speed = SPEEDS[speedIdx];
      const [xMin, xMax] = dist.domain;
      const mUniform = dist.maxPdf * mScale;

      for (let i = 0; i < speed; i++) {
        const x = xMin + Math.random() * (xMax - xMin);
        const u = Math.random() * mUniform;
        const fx = dist.pdf(x);
        const isAccepted = u <= fx;

        pointsRef.current.push({ x, y: u, accepted: isAccepted, alpha: 1.0 });
        totalRef.current++;

        if (isAccepted) {
          acceptedRef.current++;
          samplesRef.current.push(x);
        }
      }

      if (pointsRef.current.length > 5000) {
        pointsRef.current = pointsRef.current.slice(-3000);
      }

      setAccepted(acceptedRef.current);
      setTotal(totalRef.current);
      drawMain();
      drawHist();
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => {
      runRef.current = false;
      cancelAnimationFrame(raf);
    };
  }, [running, speedIdx, dist, mScale, drawMain, drawHist]);

  useEffect(() => {
    drawMain();
    drawHist();
  }, [drawMain, drawHist]);

  return (
    <div>
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
        {TARGET_DISTS.map((d, i) => (
          <button key={d.id} style={i === distIdx ? activeBtnStyle : btnStyle} onClick={() => setDistIdx(i)}>
            {d.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 300px", minWidth: "280px" }}>
          <canvas
            ref={canvasRef}
            width={500}
            height={400}
            style={{ width: "100%", height: "auto", borderRadius: "8px", border: "1px solid var(--color-border)" }}
          />
          <div style={{ marginTop: "8px" }}>
            <label style={labelStyle}>
              M scale: {mScale.toFixed(1)}
            </label>
            <input
              type="range"
              min="1.0"
              max="3.0"
              step="0.1"
              value={mScale}
              onInput={(e) => setMScale(parseFloat((e.target as HTMLInputElement).value))}
              style={{ width: "100%" }}
            />
          </div>
        </div>
        <div style={{ flex: "1 1 300px", minWidth: "280px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "12px" }}>
            <div style={panelStyle}>
              <div style={labelStyle}>Total</div>
              <div style={statStyle}>{total.toLocaleString()}</div>
            </div>
            <div style={panelStyle}>
              <div style={labelStyle}>Accepted</div>
              <div style={{ ...statStyle, color: "var(--color-accent)" }}>{accepted.toLocaleString()}</div>
            </div>
            <div style={panelStyle}>
              <div style={labelStyle}>Rate</div>
              <div style={statStyle}>{acceptanceRate.toFixed(1)}%</div>
            </div>
          </div>
          <canvas
            ref={histRef}
            width={500}
            height={200}
            style={{ width: "100%", height: "160px", borderRadius: "8px", border: "1px solid var(--color-border)" }}
          />
          <div style={{ display: "flex", gap: "8px", marginTop: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <button style={running ? activeBtnStyle : btnStyle} onClick={() => setRunning(!running)}>
              {running ? "Pause" : "Start"}
            </button>
            <button style={btnStyle} onClick={reset}>Reset</button>
            <span style={labelStyle}>Speed:</span>
            {SPEEDS.map((s, i) => (
              <button key={s} style={i === speedIdx ? activeBtnStyle : btnStyle} onClick={() => setSpeedIdx(i)}>
                {s}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   TAB 4: Importance Sampling
   ══════════════════════════════════════════════════════════ */

function ImportanceSampling() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const histRef = useRef<HTMLCanvasElement>(null);
  const [nSamples, setNSamples] = useState(500);
  const [proposalShift, setProposalShift] = useState(4.0);
  const [proposalSigma, setProposalSigma] = useState(1.0);
  const [results, setResults] = useState<{
    naiveEst: number;
    isEst: number;
    naiveVar: number;
    isVar: number;
    ess: number;
    trueValue: number;
    weights: number[];
    naiveSamples: number[];
    isSamples: number[];
  } | null>(null);

  const run = useCallback(() => {
    const threshold = 4;
    const trueValue = 0.00003167; // P(X > 4) for N(0,1) approx

    // Naive MC: sample from N(0,1)
    const naiveSamples: number[] = [];
    const naiveIndicators: number[] = [];
    for (let i = 0; i < nSamples; i++) {
      const z = randn();
      naiveSamples.push(z);
      naiveIndicators.push(z > threshold ? 1 : 0);
    }
    const naiveMean = naiveIndicators.reduce((a, b) => a + b, 0) / nSamples;
    const naiveVar =
      naiveIndicators.reduce((a, b) => a + (b - naiveMean) ** 2, 0) / (nSamples - 1) / nSamples;

    // Importance sampling: sample from N(shift, sigma)
    const isSamples: number[] = [];
    const weights: number[] = [];
    const weightedValues: number[] = [];

    for (let i = 0; i < nSamples; i++) {
      const x = proposalShift + proposalSigma * randn();
      isSamples.push(x);
      const w = gaussianPdf(x, 0, 1) / gaussianPdf(x, proposalShift, proposalSigma);
      weights.push(w);
      weightedValues.push(x > threshold ? w : 0);
    }

    const isMean = weightedValues.reduce((a, b) => a + b, 0) / nSamples;
    const isVar = weightedValues.reduce((a, b) => a + (b - isMean) ** 2, 0) / (nSamples - 1) / nSamples;

    const wSum = weights.reduce((a, b) => a + b, 0);
    const wSqSum = weights.reduce((a, b) => a + b * b, 0);
    const ess = (wSum * wSum) / wSqSum;

    setResults({
      naiveEst: naiveMean,
      isEst: isMean,
      naiveVar,
      isVar: Math.max(isVar, 1e-20),
      ess,
      trueValue,
      weights,
      naiveSamples,
      isSamples,
    });
  }, [nSamples, proposalShift, proposalSigma]);

  function randn(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  useEffect(() => {
    run();
  }, [run]);

  const drawMain = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    const bg = resolveColor(canvas, "--color-bg", "#09090b");
    const border = resolveColor(canvas, "--color-border", "#27272a");
    const primary = resolveColor(canvas, "--color-primary", "#4f8ff7");
    const accent = resolveColor(canvas, "--color-accent", "#34d399");
    const textMuted = resolveColor(canvas, "--color-text-muted", "#a1a1aa");

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const pad = { l: 40, r: 10, t: 20, b: 30 };
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;

    const xMin = -4;
    const xMax = 8;
    const toCanvasX = (x: number) => pad.l + ((x - xMin) / (xMax - xMin)) * pw;

    // Find max y for scaling
    let yMaxVal = 0;
    for (let i = 0; i <= 200; i++) {
      const x = xMin + (i / 200) * (xMax - xMin);
      yMaxVal = Math.max(yMaxVal, gaussianPdf(x, 0, 1), gaussianPdf(x, proposalShift, proposalSigma));
    }
    yMaxVal *= 1.1;

    const toCanvasY = (y: number) => pad.t + ph * (1 - y / yMaxVal);

    // Axes
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t);
    ctx.lineTo(pad.l, h - pad.b);
    ctx.lineTo(w - pad.r, h - pad.b);
    ctx.stroke();

    // Threshold line
    const thX = toCanvasX(4);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "#ef4444";
    ctx.beginPath();
    ctx.moveTo(thX, pad.t);
    ctx.lineTo(thX, h - pad.b);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#ef4444";
    ctx.font = "10px var(--font-mono)";
    ctx.textAlign = "center";
    ctx.fillText("x=4", thX, pad.t - 4);

    // Shade tail area
    ctx.fillStyle = "#ef4444";
    ctx.globalAlpha = 0.15;
    ctx.beginPath();
    ctx.moveTo(thX, h - pad.b);
    for (let i = 0; i <= 50; i++) {
      const x = 4 + (i / 50) * (xMax - 4);
      const y = gaussianPdf(x, 0, 1);
      ctx.lineTo(toCanvasX(x), toCanvasY(y));
    }
    ctx.lineTo(w - pad.r, h - pad.b);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1.0;

    // Target p(x) = N(0,1)
    ctx.strokeStyle = primary;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 200; i++) {
      const x = xMin + (i / 200) * (xMax - xMin);
      const y = gaussianPdf(x, 0, 1);
      const cx = toCanvasX(x);
      const cy = toCanvasY(y);
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.stroke();

    // Proposal q(x) = N(shift, sigma)
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 200; i++) {
      const x = xMin + (i / 200) * (xMax - xMin);
      const y = gaussianPdf(x, proposalShift, proposalSigma);
      const cx = toCanvasX(x);
      const cy = toCanvasY(y);
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.stroke();

    // Legend
    ctx.font = "11px var(--font-sans)";
    ctx.fillStyle = primary;
    ctx.fillText("p(x) = N(0,1)", pad.l + 10, pad.t + 14);
    ctx.fillStyle = accent;
    ctx.fillText(`q(x) = N(${proposalShift.toFixed(1)}, ${proposalSigma.toFixed(1)})`, pad.l + 10, pad.t + 28);
  }, [proposalShift, proposalSigma]);

  const drawHist = useCallback(() => {
    const canvas = histRef.current;
    if (!canvas || !results) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    const bg = resolveColor(canvas, "--color-bg", "#09090b");
    const primary = resolveColor(canvas, "--color-primary", "#4f8ff7");
    const accent = resolveColor(canvas, "--color-accent", "#34d399");
    const textMuted = resolveColor(canvas, "--color-text-muted", "#a1a1aa");

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const pad = { l: 10, r: 10, t: 15, b: 25 };
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;

    // Draw weight histogram
    const wts = results.weights;
    const maxW = Math.max(...wts);
    const nBins = 40;
    const bins = new Array(nBins).fill(0);
    for (const ww of wts) {
      const idx = Math.min(nBins - 1, Math.floor((ww / (maxW * 1.01)) * nBins));
      bins[idx]++;
    }
    const maxBin = Math.max(...bins);

    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.6;
    for (let i = 0; i < nBins; i++) {
      const barH = (bins[i] / maxBin) * ph;
      const x = pad.l + (i / nBins) * pw;
      ctx.fillRect(x, pad.t + ph - barH, pw / nBins - 1, barH);
    }
    ctx.globalAlpha = 1.0;

    ctx.fillStyle = textMuted;
    ctx.font = "10px var(--font-sans)";
    ctx.textAlign = "center";
    ctx.fillText("Importance weights w(x) = p(x)/q(x)", w / 2, h - 4);

    ctx.textAlign = "left";
    ctx.fillText("0", pad.l, h - pad.b + 12);
    ctx.textAlign = "right";
    ctx.fillText(maxW.toFixed(2), w - pad.r, h - pad.b + 12);
  }, [results]);

  useEffect(() => {
    drawMain();
    drawHist();
  }, [drawMain, drawHist, results]);

  const vrFactor = results && results.isVar > 0 ? results.naiveVar / results.isVar : 0;

  return (
    <div>
      <div style={{ ...panelStyle, marginBottom: "12px", padding: "12px" }}>
        <div style={{ ...labelStyle, marginBottom: "4px" }}>
          Goal: Estimate P(X {">"} 4) where X ~ N(0,1). True value: 3.167 x 10⁻⁵
        </div>
        <div style={labelStyle}>
          The naive approach rarely samples from the tail. Importance sampling shifts the proposal to sample where it matters.
        </div>
      </div>
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 320px", minWidth: "280px" }}>
          <canvas
            ref={canvasRef}
            width={500}
            height={350}
            style={{ width: "100%", height: "auto", borderRadius: "8px", border: "1px solid var(--color-border)" }}
          />
          <div style={{ display: "flex", gap: "16px", marginTop: "8px", flexWrap: "wrap" }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Proposal mean: {proposalShift.toFixed(1)}</label>
              <input
                type="range"
                min="0"
                max="7"
                step="0.1"
                value={proposalShift}
                onInput={(e) => setProposalShift(parseFloat((e.target as HTMLInputElement).value))}
                style={{ width: "100%" }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Proposal sigma: {proposalSigma.toFixed(1)}</label>
              <input
                type="range"
                min="0.3"
                max="3.0"
                step="0.1"
                value={proposalSigma}
                onInput={(e) => setProposalSigma(parseFloat((e.target as HTMLInputElement).value))}
                style={{ width: "100%" }}
              />
            </div>
          </div>
          <div style={{ marginTop: "8px" }}>
            <label style={labelStyle}>Samples: {nSamples}</label>
            <input
              type="range"
              min="100"
              max="10000"
              step="100"
              value={nSamples}
              onInput={(e) => setNSamples(parseInt((e.target as HTMLInputElement).value))}
              style={{ width: "100%" }}
            />
          </div>
          <button style={{ ...btnStyle, marginTop: "8px" }} onClick={run}>Re-sample</button>
        </div>
        <div style={{ flex: "1 1 320px", minWidth: "280px" }}>
          {results && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
              <div style={panelStyle}>
                <div style={labelStyle}>Naive MC est.</div>
                <div style={statStyle}>{results.naiveEst.toExponential(3)}</div>
              </div>
              <div style={panelStyle}>
                <div style={labelStyle}>IS estimate</div>
                <div style={{ ...statStyle, color: "var(--color-accent)" }}>{results.isEst.toExponential(3)}</div>
              </div>
              <div style={panelStyle}>
                <div style={labelStyle}>Naive variance</div>
                <div style={statStyle}>{results.naiveVar.toExponential(3)}</div>
              </div>
              <div style={panelStyle}>
                <div style={labelStyle}>IS variance</div>
                <div style={{ ...statStyle, color: "var(--color-accent)" }}>{results.isVar.toExponential(3)}</div>
              </div>
              <div style={panelStyle}>
                <div style={labelStyle}>ESS</div>
                <div style={statStyle}>{results.ess.toFixed(1)}</div>
              </div>
              <div style={panelStyle}>
                <div style={labelStyle}>VR factor</div>
                <div style={{ ...statStyle, color: Number.isFinite(vrFactor) && vrFactor > 1 ? "var(--color-accent)" : "#ef4444" }}>
                  {Number.isFinite(vrFactor) ? vrFactor.toFixed(1) + "x" : "N/A"}
                </div>
              </div>
            </div>
          )}
          <canvas
            ref={histRef}
            width={500}
            height={180}
            style={{ width: "100%", height: "150px", borderRadius: "8px", border: "1px solid var(--color-border)" }}
          />
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════ */

export default function MonteCarlo() {
  const [activeTab, setActiveTab] = useState<TabId>("pi");

  return (
    <div style={{ fontFamily: "var(--font-sans)", color: "var(--color-text)" }}>
      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          gap: "4px",
          marginBottom: "20px",
          borderBottom: "1px solid var(--color-border)",
          paddingBottom: "0",
          overflowX: "auto",
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "10px 18px",
              border: "none",
              borderBottom: activeTab === tab.id ? "2px solid var(--color-primary)" : "2px solid transparent",
              background: "transparent",
              color: activeTab === tab.id ? "var(--color-heading)" : "var(--color-text-muted)",
              cursor: "pointer",
              fontSize: "14px",
              fontFamily: "var(--font-sans)",
              fontWeight: activeTab === tab.id ? "600" : "400",
              whiteSpace: "nowrap",
              transition: "color 0.2s, border-color 0.2s",
            }}
          >
            <span style={{ marginRight: "6px", fontSize: "16px" }}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "pi" && <EstimatePi />}
      {activeTab === "integration" && <MCIntegration />}
      {activeTab === "rejection" && <RejectionSampling />}
      {activeTab === "importance" && <ImportanceSampling />}
    </div>
  );
}
