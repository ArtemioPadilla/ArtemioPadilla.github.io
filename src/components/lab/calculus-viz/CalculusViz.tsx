import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";

/* ================================================================
   Types & Constants
   ================================================================ */

type FunctionId = "sin" | "x2" | "x3" | "1/x" | "exp" | "abs" | "custom";
type RiemannMode = "left" | "right" | "midpoint" | "trapezoidal";

interface FunctionDef {
  id: FunctionId;
  label: string;
  fn: (x: number) => number;
  defaultRange: [number, number];
}

interface ViewState {
  centerX: number;
  centerY: number;
  scale: number;
}

const PANEL_HEIGHT = 180;
const DERIVATIVE_H = 1e-6;
const MIN_SCALE = 5;
const MAX_SCALE = 500;
const INTEGRAL_STEPS = 600;

const COLORS = {
  grid: "rgba(161,161,170,0.12)",
  axis: "rgba(161,161,170,0.45)",
  axisLabel: "rgba(228,228,231,0.6)",
  curve: "#4f8ff7",
  derivative: "#34d399",
  integral: "#a855f7",
  tangent: "#f59e0b",
  riemannPos: "rgba(52,211,153,0.2)",
  riemannNeg: "rgba(239,68,68,0.2)",
  riemannStroke: "rgba(161,161,170,0.35)",
  cursor: "#ef4444",
  coordBg: "rgba(17,17,17,0.88)",
  coordText: "rgba(228,228,231,0.9)",
  taylor: "#f472b6",
  integralFill: "rgba(168,85,247,0.12)",
};

/* ================================================================
   Function Definitions
   ================================================================ */

const FUNCTIONS: FunctionDef[] = [
  { id: "sin", label: "sin(x)", fn: Math.sin, defaultRange: [-2 * Math.PI, 2 * Math.PI] },
  { id: "x2", label: "x^2", fn: (x) => x * x, defaultRange: [-4, 4] },
  { id: "x3", label: "x^3", fn: (x) => x * x * x, defaultRange: [-3, 3] },
  { id: "1/x", label: "1/x", fn: (x) => (Math.abs(x) < 0.01 ? NaN : 1 / x), defaultRange: [-5, 5] },
  { id: "exp", label: "e^x", fn: Math.exp, defaultRange: [-3, 3] },
  { id: "abs", label: "|x|", fn: Math.abs, defaultRange: [-4, 4] },
];

/* ================================================================
   Math Helpers
   ================================================================ */

function numericalDerivative(fn: (x: number) => number, x: number): number {
  return (fn(x + DERIVATIVE_H) - fn(x - DERIVATIVE_H)) / (2 * DERIVATIVE_H);
}

function numericalIntegral(fn: (x: number) => number, a: number, b: number, n: number = INTEGRAL_STEPS): number {
  if (a >= b) return 0;
  const dx = (b - a) / n;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const y = fn(a + (i + 0.5) * dx);
    if (Number.isFinite(y)) sum += y * dx;
  }
  return sum;
}

function riemannSum(fn: (x: number) => number, a: number, b: number, n: number, mode: RiemannMode): number {
  if (n <= 0 || a >= b) return 0;
  const dx = (b - a) / n;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const xl = a + i * dx;
    if (mode === "trapezoidal") {
      const yl = fn(xl);
      const yr = fn(xl + dx);
      if (Number.isFinite(yl) && Number.isFinite(yr)) sum += (yl + yr) / 2 * dx;
    } else {
      let sx: number;
      if (mode === "left") sx = xl;
      else if (mode === "right") sx = xl + dx;
      else sx = xl + dx / 2;
      const y = fn(sx);
      if (Number.isFinite(y)) sum += y * dx;
    }
  }
  return sum;
}

function taylorApproximation(fn: (x: number) => number, center: number, terms: number, x: number): number {
  let result = 0;
  let factorial = 1;
  for (let n = 0; n < terms; n++) {
    if (n > 0) factorial *= n;
    const h = 0.001;
    let deriv = 0;
    // Compute nth derivative numerically using finite differences
    if (n === 0) {
      deriv = fn(center);
    } else {
      // Central difference for nth derivative
      let coeffs: number[] = [1];
      for (let k = 0; k < n; k++) {
        const newCoeffs: number[] = [];
        for (let j = 0; j <= coeffs.length; j++) {
          const prev = j > 0 ? coeffs[j - 1] : 0;
          const curr = j < coeffs.length ? coeffs[j] : 0;
          newCoeffs.push(curr - prev);
        }
        coeffs = newCoeffs;
      }
      for (let j = 0; j < coeffs.length; j++) {
        const val = fn(center + (j - n / 2) * h);
        if (Number.isFinite(val)) deriv += coeffs[j] * val;
      }
      deriv /= Math.pow(h, n);
    }
    if (!Number.isFinite(deriv)) continue;
    result += (deriv / factorial) * Math.pow(x - center, n);
  }
  return result;
}

function parseCustomFn(expr: string): ((x: number) => number) | null {
  try {
    const sanitized = expr
      .replace(/\^/g, "**")
      .replace(/sin/g, "Math.sin")
      .replace(/cos/g, "Math.cos")
      .replace(/tan/g, "Math.tan")
      .replace(/log/g, "Math.log")
      .replace(/abs/g, "Math.abs")
      .replace(/sqrt/g, "Math.sqrt")
      .replace(/exp/g, "Math.exp")
      .replace(/pi/gi, "Math.PI")
      .replace(/e(?![xp])/g, "Math.E");
    const fn = new Function("x", `"use strict"; return (${sanitized});`) as (x: number) => number;
    fn(1);
    return fn;
  } catch {
    return null;
  }
}

function gridStep(scale: number): number {
  const raw = 80 / scale;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  if (norm < 2) return mag;
  if (norm < 5) return 2 * mag;
  return 5 * mag;
}

function formatTick(value: number): string {
  if (Math.abs(value) < 1e-10) return "0";
  if (Math.abs(value) >= 1000) return value.toExponential(0);
  if (Math.abs(value) < 0.01) return value.toExponential(1);
  return String(Math.round(value * 1000) / 1000);
}

/* ================================================================
   Canvas Drawing
   ================================================================ */

function drawPanel(
  ctx: CanvasRenderingContext2D,
  fn: (x: number) => number,
  view: ViewState,
  w: number,
  h: number,
  curveColor: string,
  label: string,
  mouseX: number | null,
  options?: {
    showTangent?: boolean;
    riemannFn?: (x: number) => number;
    riemannN?: number;
    riemannMode?: RiemannMode;
    integralA?: number;
    integralB?: number;
    showIntegralFill?: boolean;
    taylorFn?: ((x: number) => number) | null;
  },
): void {
  const toCanvasX = (x: number) => w / 2 + (x - view.centerX) * view.scale;
  const toCanvasY = (y: number) => h / 2 - (y - view.centerY) * view.scale;
  const toMathX = (px: number) => (px - w / 2) / view.scale + view.centerX;

  const xMin = toMathX(0);
  const xMax = toMathX(w);

  // Background
  ctx.fillStyle = "#09090b";
  ctx.fillRect(0, 0, w, h);

  // Grid
  const gs = gridStep(view.scale);
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let gx = Math.floor(xMin / gs) * gs; gx <= xMax; gx += gs) {
    const px = toCanvasX(gx);
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
  }
  const yMin = (h / 2) / view.scale + view.centerY;
  const yMax = -(h / 2) / view.scale + view.centerY;
  for (let gy = Math.floor(Math.min(yMin, yMax) / gs) * gs; gy <= Math.max(yMin, yMax); gy += gs) {
    const py = toCanvasY(gy);
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
  }

  // Axes
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 1.5;
  const ox = toCanvasX(0);
  const oy = toCanvasY(0);
  if (ox >= 0 && ox <= w) { ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, h); ctx.stroke(); }
  if (oy >= 0 && oy <= h) { ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(w, oy); ctx.stroke(); }

  // Tick labels
  ctx.fillStyle = COLORS.axisLabel;
  ctx.font = "9px Inter, sans-serif";
  ctx.textAlign = "center";
  for (let gx = Math.floor(xMin / gs) * gs; gx <= xMax; gx += gs) {
    if (Math.abs(gx) < gs * 0.1) continue;
    ctx.fillText(formatTick(gx), toCanvasX(gx), Math.min(h - 3, Math.max(10, oy + 12)));
  }

  // Riemann sum rectangles
  if (options?.riemannFn && options?.riemannN && options.integralA !== undefined && options.integralB !== undefined) {
    const rFn = options.riemannFn;
    const n = options.riemannN;
    const a = options.integralA;
    const b = options.integralB;
    const dx = (b - a) / n;
    const mode = options.riemannMode || "midpoint";

    for (let i = 0; i < n; i++) {
      const xl = a + i * dx;
      const xr = xl + dx;
      let yVal: number;

      if (mode === "trapezoidal") {
        const yl = rFn(xl);
        const yr = rFn(xr);
        if (!Number.isFinite(yl) || !Number.isFinite(yr)) continue;
        // Draw trapezoid
        const pxl = toCanvasX(xl);
        const pxr = toCanvasX(xr);
        const pyl = toCanvasY(yl);
        const pyr = toCanvasY(yr);
        const py0 = toCanvasY(0);
        ctx.fillStyle = yl + yr >= 0 ? COLORS.riemannPos : COLORS.riemannNeg;
        ctx.beginPath();
        ctx.moveTo(pxl, py0); ctx.lineTo(pxl, pyl); ctx.lineTo(pxr, pyr); ctx.lineTo(pxr, py0);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = COLORS.riemannStroke; ctx.lineWidth = 0.5; ctx.stroke();
        continue;
      }

      if (mode === "left") yVal = rFn(xl);
      else if (mode === "right") yVal = rFn(xr);
      else yVal = rFn((xl + xr) / 2);
      if (!Number.isFinite(yVal)) continue;

      const pxl = toCanvasX(xl);
      const pxr = toCanvasX(xr);
      const pyTop = toCanvasY(Math.max(0, yVal));
      const pyBot = toCanvasY(Math.min(0, yVal));

      ctx.fillStyle = yVal >= 0 ? COLORS.riemannPos : COLORS.riemannNeg;
      ctx.strokeStyle = COLORS.riemannStroke;
      ctx.lineWidth = 0.5;
      ctx.fillRect(pxl, pyTop, pxr - pxl, pyBot - pyTop);
      ctx.strokeRect(pxl, pyTop, pxr - pxl, pyBot - pyTop);
    }
  }

  // Integral fill
  if (options?.showIntegralFill && options.integralA !== undefined && options.integralB !== undefined) {
    const a = Math.max(xMin, options.integralA);
    const b = Math.min(xMax, options.integralB);
    if (b > a) {
      ctx.fillStyle = COLORS.integralFill;
      ctx.beginPath();
      ctx.moveTo(toCanvasX(a), toCanvasY(0));
      const steps = Math.ceil((b - a) * view.scale);
      for (let i = 0; i <= steps; i++) {
        const x = a + (i / steps) * (b - a);
        const y = fn(x);
        if (Number.isFinite(y)) ctx.lineTo(toCanvasX(x), toCanvasY(y));
      }
      ctx.lineTo(toCanvasX(b), toCanvasY(0));
      ctx.closePath();
      ctx.fill();
    }
  }

  // Main curve
  ctx.strokeStyle = curveColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  let started = false;
  for (let px = 0; px < w; px += 1.5) {
    const x = toMathX(px);
    const y = fn(x);
    if (!Number.isFinite(y)) { started = false; continue; }
    const cy = toCanvasY(y);
    if (cy < -500 || cy > h + 500) { started = false; continue; }
    if (!started) { ctx.moveTo(px, cy); started = true; } else { ctx.lineTo(px, cy); }
  }
  ctx.stroke();

  // Taylor approximation overlay
  if (options?.taylorFn) {
    ctx.strokeStyle = COLORS.taylor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    started = false;
    for (let px = 0; px < w; px += 2) {
      const x = toMathX(px);
      const y = options.taylorFn(x);
      if (!Number.isFinite(y)) { started = false; continue; }
      const cy = toCanvasY(y);
      if (cy < -500 || cy > h + 500) { started = false; continue; }
      if (!started) { ctx.moveTo(px, cy); started = true; } else { ctx.lineTo(px, cy); }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Tangent line at cursor
  if (options?.showTangent && mouseX !== null) {
    const mx = toMathX(mouseX);
    const my = fn(mx);
    if (Number.isFinite(my)) {
      const slope = numericalDerivative(fn, mx);
      if (Number.isFinite(slope)) {
        const range = (xMax - xMin) * 0.3;
        ctx.strokeStyle = COLORS.tangent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(toCanvasX(mx - range), toCanvasY(my - slope * range));
        ctx.lineTo(toCanvasX(mx + range), toCanvasY(my + slope * range));
        ctx.stroke();

        // Point dot
        ctx.fillStyle = COLORS.cursor;
        ctx.beginPath();
        ctx.arc(toCanvasX(mx), toCanvasY(my), 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Cursor crosshair + tooltip (only for f(x) panel)
  if (mouseX !== null && options?.showTangent) {
    const mx = toMathX(mouseX);
    const my = fn(mx);
    if (Number.isFinite(my)) {
      const slope = numericalDerivative(fn, mx);
      ctx.font = "10px monospace";
      const line1 = `(${mx.toFixed(3)}, ${my.toFixed(3)})`;
      const line2 = `f'(x) = ${Number.isFinite(slope) ? slope.toFixed(3) : "undef"}`;
      const tw = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 12;
      const tx = mouseX + 15 + tw > w ? mouseX - tw - 15 : mouseX + 15;
      const ty = Math.max(4, Math.min(h - 42, toCanvasY(my) - 20));

      ctx.fillStyle = COLORS.coordBg;
      ctx.beginPath();
      ctx.roundRect(tx, ty, tw, 34, 4);
      ctx.fill();
      ctx.fillStyle = COLORS.coordText;
      ctx.fillText(line1, tx + 6, ty + 13);
      ctx.fillText(line2, tx + 6, ty + 27);
    }
  }

  // Panel label
  ctx.fillStyle = curveColor;
  ctx.globalAlpha = 0.6;
  ctx.font = "bold 11px Inter, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(label, 8, 16);
  ctx.globalAlpha = 1;
}

/* ================================================================
   Component
   ================================================================ */

export default function CalculusViz() {
  const [funcId, setFuncId] = useState<FunctionId>("sin");
  const [customExpr, setCustomExpr] = useState("x^2 + sin(x)");
  const [customFn, setCustomFn] = useState<((x: number) => number) | null>(null);

  const [showRiemann, setShowRiemann] = useState(false);
  const [riemannN, setRiemannN] = useState(20);
  const [riemannMode, setRiemannMode] = useState<RiemannMode>("midpoint");
  const [integralA, setIntegralA] = useState(-2);
  const [integralB, setIntegralB] = useState(2);

  const [showTaylor, setShowTaylor] = useState(false);
  const [taylorTerms, setTaylorTerms] = useState(4);
  const [taylorCenter, setTaylorCenter] = useState(0);

  const [view, setView] = useState<ViewState>({ centerX: 0, centerY: 0, scale: 60 });
  const [mouseX, setMouseX] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<{ mx: number; my: number; cx: number; cy: number } | null>(null);

  const canvasRefs = [useRef<HTMLCanvasElement>(null), useRef<HTMLCanvasElement>(null), useRef<HTMLCanvasElement>(null)];
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(700);

  const activeFn = useCallback((x: number): number => {
    if (funcId === "custom" && customFn) return customFn(x);
    const def = FUNCTIONS.find((f) => f.id === funcId);
    return def ? def.fn(x) : 0;
  }, [funcId, customFn]);

  const derivFn = useCallback((x: number): number => numericalDerivative(activeFn, x), [activeFn]);

  const integralFn = useCallback((x: number): number => numericalIntegral(activeFn, 0, x, 300), [activeFn]);

  const taylorFn = useMemo(() => {
    if (!showTaylor) return null;
    return (x: number) => taylorApproximation(activeFn, taylorCenter, taylorTerms, x);
  }, [showTaylor, taylorTerms, taylorCenter, activeFn]);

  // Parse custom expression
  useEffect(() => {
    if (funcId === "custom") setCustomFn(() => parseCustomFn(customExpr));
  }, [customExpr, funcId]);

  // Reset view on function change
  useEffect(() => {
    if (funcId === "custom") {
      setView({ centerX: 0, centerY: 0, scale: 60 });
      return;
    }
    const def = FUNCTIONS.find((f) => f.id === funcId);
    if (def) {
      const rangeW = def.defaultRange[1] - def.defaultRange[0];
      const newScale = (canvasWidth * 0.7) / rangeW;
      setView({ centerX: 0, centerY: 0, scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale)) });
    }
  }, [funcId, canvasWidth]);

  // Responsive
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) setCanvasWidth(containerRef.current.clientWidth);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Draw all three panels
  useEffect(() => {
    const panels = [
      { ref: canvasRefs[0], fn: activeFn, color: COLORS.curve, label: "f(x)", tangent: true, taylor: taylorFn },
      { ref: canvasRefs[1], fn: derivFn, color: COLORS.derivative, label: "f'(x)", tangent: false, taylor: null },
      { ref: canvasRefs[2], fn: integralFn, color: COLORS.integral, label: "\u222Bf(x)dx", tangent: false, taylor: null },
    ];

    for (let i = 0; i < panels.length; i++) {
      const canvas = panels[i].ref.current;
      if (!canvas) continue;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvasWidth * dpr;
      canvas.height = PANEL_HEIGHT * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      drawPanel(ctx, panels[i].fn, view, canvasWidth, PANEL_HEIGHT, panels[i].color, panels[i].label, mouseX, {
        showTangent: panels[i].tangent,
        riemannFn: i === 0 && showRiemann ? activeFn : undefined,
        riemannN: showRiemann ? riemannN : undefined,
        riemannMode: riemannMode,
        integralA,
        integralB,
        showIntegralFill: i === 0 && !showRiemann,
        taylorFn: panels[i].taylor,
      });
    }
  }, [canvasWidth, view, funcId, customFn, showRiemann, riemannN, riemannMode,
      integralA, integralB, mouseX, activeFn, derivFn, integralFn, taylorFn, showTaylor]);

  // Mouse handlers
  const handleMouseMove = useCallback((e: MouseEvent) => {
    const canvas = canvasRefs[0].current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    setMouseX(e.clientX - rect.left);
    if (isDragging && dragStart.current) {
      const dx = (e.clientX - dragStart.current.mx) / view.scale;
      const dy = -(e.clientY - dragStart.current.my) / view.scale;
      setView((v) => ({ ...v, centerX: dragStart.current!.cx - dx, centerY: dragStart.current!.cy - dy }));
    }
  }, [isDragging, view.scale]);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    setIsDragging(true);
    dragStart.current = { mx: e.clientX, my: e.clientY, cx: view.centerX, cy: view.centerY };
  }, [view.centerX, view.centerY]);

  const handleMouseUp = useCallback(() => { setIsDragging(false); dragStart.current = null; }, []);

  const handleMouseLeave = useCallback(() => {
    setMouseX(null); setIsDragging(false); dragStart.current = null;
  }, []);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setView((v) => ({ ...v, scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor)) }));
  }, []);

  // Computed values
  const exactIntegral = numericalIntegral(activeFn, integralA, integralB);
  const riemannVal = showRiemann ? riemannSum(activeFn, integralA, integralB, riemannN, riemannMode) : 0;
  const error = Math.abs(exactIntegral - riemannVal);

  const btn = (active: boolean, color = "var(--color-primary)") => ({
    padding: "6px 12px", borderRadius: "8px",
    border: `1px solid ${active ? color : "var(--color-border)"}`,
    backgroundColor: active ? `color-mix(in srgb, ${color} 12%, transparent)` : "var(--color-surface)",
    color: active ? color : "var(--color-text-muted)",
    fontSize: "11px", fontWeight: 500 as const, cursor: "pointer" as const,
  });

  const riemannModes: RiemannMode[] = ["left", "right", "midpoint", "trapezoidal"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Function selector */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
        <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>f(x) =</span>
        <select
          value={funcId}
          onChange={(e) => setFuncId((e.target as HTMLSelectElement).value as FunctionId)}
          style={{
            padding: "6px 10px", borderRadius: "8px",
            border: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)",
            color: "var(--color-text)", fontSize: "12px",
          }}
        >
          {FUNCTIONS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          <option value="custom">Custom...</option>
        </select>
        {funcId === "custom" && (
          <input
            type="text" value={customExpr}
            onInput={(e) => setCustomExpr((e.target as HTMLInputElement).value)}
            placeholder="e.g. x^2 + sin(x)"
            style={{
              flex: 1, minWidth: "160px", padding: "6px 10px", borderRadius: "8px",
              border: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)",
              color: "var(--color-text)", fontSize: "12px", fontFamily: "monospace",
            }}
          />
        )}
      </div>

      {/* Toggle controls */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        <button onClick={() => setShowRiemann((v) => !v)} style={btn(showRiemann, "#34d399")}>
          Riemann Sum
        </button>
        <button onClick={() => setShowTaylor((v) => !v)} style={btn(showTaylor, COLORS.taylor)}>
          Taylor Series
        </button>
      </div>

      {/* Riemann controls */}
      {showRiemann && (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px",
          padding: "12px 14px", borderRadius: "12px",
          border: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)",
        }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>Lower (a): {integralA.toFixed(2)}</span>
            <input type="range" min="-10" max="10" step="0.1" value={integralA}
              onInput={(e) => setIntegralA(parseFloat((e.target as HTMLInputElement).value))}
              style={{ width: "100%", accentColor: "var(--color-primary)" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>Upper (b): {integralB.toFixed(2)}</span>
            <input type="range" min="-10" max="10" step="0.1" value={integralB}
              onInput={(e) => setIntegralB(parseFloat((e.target as HTMLInputElement).value))}
              style={{ width: "100%", accentColor: "var(--color-primary)" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>Rectangles: {riemannN}</span>
            <input type="range" min="1" max="200" step="1" value={riemannN}
              onInput={(e) => setRiemannN(parseInt((e.target as HTMLInputElement).value))}
              style={{ width: "100%", accentColor: "var(--color-primary)" }} />
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>Sample point</span>
            <div style={{ display: "flex", gap: "3px" }}>
              {riemannModes.map((m) => (
                <button
                  key={m} onClick={() => setRiemannMode(m)}
                  style={{
                    flex: 1, padding: "4px 2px", borderRadius: "4px", fontSize: "9px",
                    border: "none", cursor: "pointer",
                    backgroundColor: riemannMode === m ? "var(--color-primary)" : "var(--color-bg)",
                    color: riemannMode === m ? "#fff" : "var(--color-text-muted)",
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Taylor controls */}
      {showTaylor && (
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px",
          padding: "12px 14px", borderRadius: "12px",
          border: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)",
        }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>Terms: {taylorTerms}</span>
            <input type="range" min="1" max="10" step="1" value={taylorTerms}
              onInput={(e) => setTaylorTerms(parseInt((e.target as HTMLInputElement).value))}
              style={{ width: "100%", accentColor: COLORS.taylor }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>Center: {taylorCenter.toFixed(2)}</span>
            <input type="range" min="-5" max="5" step="0.1" value={taylorCenter}
              onInput={(e) => setTaylorCenter(parseFloat((e.target as HTMLInputElement).value))}
              style={{ width: "100%", accentColor: COLORS.taylor }} />
          </label>
        </div>
      )}

      {/* THREE linked canvas panels */}
      <div ref={containerRef} style={{
        borderRadius: "12px", border: "1px solid var(--color-border)",
        overflow: "hidden", cursor: "crosshair",
      }}>
        {["f(x)", "f'(x)", "\u222Bf(x)dx"].map((_, i) => (
          <canvas
            key={i}
            ref={canvasRefs[i]}
            width={canvasWidth} height={PANEL_HEIGHT}
            style={{
              display: "block", width: `${canvasWidth}px`, height: `${PANEL_HEIGHT}px`,
              borderBottom: i < 2 ? "1px solid var(--color-border)" : "none",
            }}
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onWheel={handleWheel}
          />
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "14px", fontSize: "10px", color: "var(--color-text-muted)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ display: "inline-block", width: "16px", height: "2px", backgroundColor: COLORS.curve }} /> f(x)
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ display: "inline-block", width: "16px", height: "2px", backgroundColor: COLORS.derivative }} /> f'(x)
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ display: "inline-block", width: "16px", height: "2px", backgroundColor: COLORS.integral }} /> integral
        </span>
        {showTaylor && (
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ display: "inline-block", width: "16px", height: "2px", borderTop: `2px dashed ${COLORS.taylor}` }} /> Taylor ({taylorTerms} terms)
          </span>
        )}
        {mouseX !== null && (
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ display: "inline-block", width: "16px", height: "2px", backgroundColor: COLORS.tangent }} /> Tangent
          </span>
        )}
      </div>

      {/* Integral results */}
      {showRiemann && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "8px" }}>
          <ResultCard label="Exact Integral" value={exactIntegral.toFixed(6)} color="#a855f7" />
          <ResultCard label={`Riemann (${riemannMode}, n=${riemannN})`} value={riemannVal.toFixed(6)} color="#34d399" />
          <ResultCard label="Error" value={error.toFixed(6)} color="#ef4444" />
        </div>
      )}

      {/* Instructions */}
      <div style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>
        Hover to see tangent line and coordinates. Drag to pan. Scroll to zoom. All three views share the same coordinate system.
      </div>
    </div>
  );
}

/* ================================================================
   Sub-components
   ================================================================ */

function ResultCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      padding: "8px 12px", borderRadius: "10px",
      border: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)",
    }}>
      <div style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>{label}</div>
      <div style={{ fontSize: "13px", fontWeight: 700, fontFamily: "monospace", color, marginTop: "2px" }}>
        {value}
      </div>
    </div>
  );
}
