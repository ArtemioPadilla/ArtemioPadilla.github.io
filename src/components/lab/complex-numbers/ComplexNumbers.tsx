import { useState, useEffect, useRef, useCallback } from "preact/hooks";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

interface Complex {
  re: number;
  im: number;
}

interface PlacedPoint {
  z: Complex;
  label: string;
  color: string;
}

type MappingId = "none" | "z2" | "1/z" | "ez" | "conj" | "sqrt";
type OperationId = "add" | "mul" | "div" | "conj" | "inv";

interface ViewState {
  centerX: number;
  centerY: number;
  scale: number;
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const CANVAS_HEIGHT = 450;
const POINT_RADIUS = 6;
const MAX_POINTS = 10;
const GRID_LINES = 10;
const CONFORMAL_GRID_RES = 20;
const MIN_SCALE = 20;
const MAX_SCALE = 300;

const COLORS = {
  grid: "rgba(161, 161, 170, 0.12)",
  axis: "rgba(161, 161, 170, 0.5)",
  axisLabel: "rgba(228, 228, 231, 0.6)",
  unitCircle: "rgba(79, 143, 247, 0.3)",
  unitCircleStroke: "rgba(79, 143, 247, 0.6)",
  conformalOriginal: "rgba(79, 143, 247, 0.2)",
  conformalMapped: "rgba(245, 158, 11, 0.35)",
  rootsOfUnity: "#a855f7",
  result: "#ef4444",
  arc: "#f59e0b",
  text: "rgba(228, 228, 231, 0.9)",
};

const POINT_COLORS = [
  "#4f8ff7", "#34d399", "#f59e0b", "#ef4444", "#a855f7",
  "#ec4899", "#06b6d4", "#f97316", "#84cc16", "#6366f1",
];

const MAPPINGS: Array<{ id: MappingId; label: string; fn: (z: Complex) => Complex }> = [
  { id: "none", label: "None", fn: (z) => z },
  { id: "z2", label: "z^2", fn: (z) => cMul(z, z) },
  { id: "1/z", label: "1/z", fn: (z) => cInv(z) },
  { id: "ez", label: "e^z", fn: (z) => cExp(z) },
  { id: "conj", label: "conj(z)", fn: (z) => ({ re: z.re, im: -z.im }) },
  { id: "sqrt", label: "sqrt(z)", fn: (z) => cSqrt(z) },
];

// ─────────────────────────────────────────────────────────
// Complex arithmetic
// ─────────────────────────────────────────────────────────

function cAdd(a: Complex, b: Complex): Complex {
  return { re: a.re + b.re, im: a.im + b.im };
}

function cSub(a: Complex, b: Complex): Complex {
  return { re: a.re - b.re, im: a.im - b.im };
}

function cMul(a: Complex, b: Complex): Complex {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

function cDiv(a: Complex, b: Complex): Complex {
  const denom = b.re * b.re + b.im * b.im;
  if (denom < 1e-14) return { re: Infinity, im: Infinity };
  return { re: (a.re * b.re + a.im * b.im) / denom, im: (a.im * b.re - a.re * b.im) / denom };
}

function cInv(z: Complex): Complex {
  return cDiv({ re: 1, im: 0 }, z);
}

function cConj(z: Complex): Complex {
  return { re: z.re, im: -z.im };
}

function cExp(z: Complex): Complex {
  const r = Math.exp(z.re);
  return { re: r * Math.cos(z.im), im: r * Math.sin(z.im) };
}

function cSqrt(z: Complex): Complex {
  const r = cAbs(z);
  const theta = cArg(z);
  const sqrtR = Math.sqrt(r);
  return { re: sqrtR * Math.cos(theta / 2), im: sqrtR * Math.sin(theta / 2) };
}

function cAbs(z: Complex): number {
  return Math.sqrt(z.re * z.re + z.im * z.im);
}

function cArg(z: Complex): number {
  return Math.atan2(z.im, z.re);
}

function formatComplex(z: Complex): string {
  const re = z.re.toFixed(3);
  const im = Math.abs(z.im).toFixed(3);
  if (Math.abs(z.im) < 0.0005) return re;
  if (Math.abs(z.re) < 0.0005) return z.im >= 0 ? `${im}i` : `-${im}i`;
  return z.im >= 0 ? `${re} + ${im}i` : `${re} - ${im}i`;
}

function formatPolar(z: Complex): string {
  const r = cAbs(z).toFixed(3);
  const theta = cArg(z);
  const deg = ((theta * 180) / Math.PI).toFixed(1);
  return `${r} * e^(i * ${deg}\u00B0)`;
}

// ─────────────────────────────────────────────────────────
// Drawing helpers
// ─────────────────────────────────────────────────────────

function drawComplexPlane(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  view: ViewState,
  points: PlacedPoint[],
  resultPoints: PlacedPoint[],
  rootsN: number,
  mappingId: MappingId,
  animArc: { from: Complex; to: Complex; t: number } | null,
): void {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const toX = (re: number) => width / 2 + (re - view.centerX) * view.scale;
  const toY = (im: number) => height / 2 - (im - view.centerY) * view.scale;

  const xMin = -width / 2 / view.scale + view.centerX;
  const xMax = width / 2 / view.scale + view.centerX;
  const yMin = -height / 2 / view.scale + view.centerY;
  const yMax = height / 2 / view.scale + view.centerY;

  // Grid
  const gridStep = computeGridStep(view.scale);
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let gx = Math.floor(xMin / gridStep) * gridStep; gx <= xMax; gx += gridStep) {
    ctx.beginPath();
    ctx.moveTo(toX(gx), 0);
    ctx.lineTo(toX(gx), height);
    ctx.stroke();
  }
  for (let gy = Math.floor(yMin / gridStep) * gridStep; gy <= yMax; gy += gridStep) {
    ctx.beginPath();
    ctx.moveTo(0, toY(gy));
    ctx.lineTo(width, toY(gy));
    ctx.stroke();
  }

  // Axes
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 1.5;
  const originX = toX(0);
  const originY = toY(0);
  ctx.beginPath();
  ctx.moveTo(originX, 0);
  ctx.lineTo(originX, height);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, originY);
  ctx.lineTo(width, originY);
  ctx.stroke();

  // Axis labels
  ctx.fillStyle = COLORS.axisLabel;
  ctx.font = "10px Inter, sans-serif";
  ctx.textAlign = "center";
  for (let gx = Math.floor(xMin / gridStep) * gridStep; gx <= xMax; gx += gridStep) {
    if (Math.abs(gx) < gridStep * 0.1) continue;
    ctx.fillText(formatTick(gx), toX(gx), Math.min(height - 4, Math.max(12, originY + 14)));
  }
  ctx.textAlign = "right";
  for (let gy = Math.floor(yMin / gridStep) * gridStep; gy <= yMax; gy += gridStep) {
    if (Math.abs(gy) < gridStep * 0.1) continue;
    ctx.fillText(formatTick(gy) + "i", Math.min(width - 4, Math.max(30, originX - 6)), toY(gy) + 4);
  }

  // "Re" and "Im" axis labels
  ctx.fillStyle = COLORS.axisLabel;
  ctx.font = "12px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Re", width - 16, originY - 8);
  ctx.fillText("Im", originX + 14, 14);

  // Unit circle
  ctx.strokeStyle = COLORS.unitCircleStroke;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(toX(0), toY(0), view.scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Conformal mapping grid
  if (mappingId !== "none") {
    const mapping = MAPPINGS.find((m) => m.id === mappingId);
    if (mapping) {
      drawConformalGrid(ctx, width, height, view, mapping.fn, toX, toY);
    }
  }

  // Roots of unity
  if (rootsN > 0) {
    for (let k = 0; k < rootsN; k++) {
      const angle = (2 * Math.PI * k) / rootsN;
      const rx = Math.cos(angle);
      const ry = Math.sin(angle);
      ctx.fillStyle = COLORS.rootsOfUnity;
      ctx.beginPath();
      ctx.arc(toX(rx), toY(ry), 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Label
      ctx.fillStyle = COLORS.text;
      ctx.font = "10px monospace";
      ctx.textAlign = "left";
      ctx.fillText(`w${k}`, toX(rx) + 8, toY(ry) - 4);
    }

    // Connect roots with lines
    if (rootsN > 1) {
      ctx.strokeStyle = "rgba(168, 85, 247, 0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k <= rootsN; k++) {
        const angle = (2 * Math.PI * (k % rootsN)) / rootsN;
        const rx = Math.cos(angle);
        const ry = Math.sin(angle);
        if (k === 0) ctx.moveTo(toX(rx), toY(ry));
        else ctx.lineTo(toX(rx), toY(ry));
      }
      ctx.stroke();
    }
  }

  // Animation arc
  if (animArc && animArc.t > 0) {
    const fromR = cAbs(animArc.from);
    const toR = cAbs(animArc.to);
    const fromAngle = cArg(animArc.from);
    const toAngle = cArg(animArc.to);

    const currentR = fromR + (toR - fromR) * animArc.t;
    const currentAngle = fromAngle + (toAngle - fromAngle) * animArc.t;

    // Draw arc path
    ctx.strokeStyle = COLORS.arc;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    const steps = 50;
    for (let i = 0; i <= steps * animArc.t; i++) {
      const tStep = i / steps;
      const r = fromR + (toR - fromR) * tStep;
      const a = fromAngle + (toAngle - fromAngle) * tStep;
      const px = toX(r * Math.cos(a));
      const py = toY(r * Math.sin(a));
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Current animated point
    const cx = currentR * Math.cos(currentAngle);
    const cy = currentR * Math.sin(currentAngle);
    ctx.fillStyle = COLORS.arc;
    ctx.beginPath();
    ctx.arc(toX(cx), toY(cy), 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Result points
  for (const p of resultPoints) {
    if (!Number.isFinite(p.z.re) || !Number.isFinite(p.z.im)) continue;
    ctx.fillStyle = COLORS.result;
    ctx.beginPath();
    ctx.arc(toX(p.z.re), toY(p.z.im), POINT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = COLORS.text;
    ctx.font = "11px monospace";
    ctx.textAlign = "left";
    ctx.fillText(p.label, toX(p.z.re) + 10, toY(p.z.im) - 6);
  }

  // Placed points
  for (const p of points) {
    // Line from origin
    ctx.strokeStyle = p.color + "40";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(0));
    ctx.lineTo(toX(p.z.re), toY(p.z.im));
    ctx.stroke();

    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(toX(p.z.re), toY(p.z.im), POINT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = COLORS.text;
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "left";
    ctx.fillText(p.label, toX(p.z.re) + 10, toY(p.z.im) - 6);
  }
}

function drawConformalGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  view: ViewState,
  fn: (z: Complex) => Complex,
  toX: (re: number) => number,
  toY: (im: number) => number,
): void {
  const range = 2;
  const step = (range * 2) / CONFORMAL_GRID_RES;
  const res = 40;

  // Draw original grid (faint)
  ctx.strokeStyle = COLORS.conformalOriginal;
  ctx.lineWidth = 0.5;
  for (let i = -CONFORMAL_GRID_RES; i <= CONFORMAL_GRID_RES; i++) {
    const v = i * step;
    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(toX(-range), toY(v));
    ctx.lineTo(toX(range), toY(v));
    ctx.stroke();
    // Vertical line
    ctx.beginPath();
    ctx.moveTo(toX(v), toY(-range));
    ctx.lineTo(toX(v), toY(range));
    ctx.stroke();
  }

  // Draw mapped grid
  ctx.strokeStyle = COLORS.conformalMapped;
  ctx.lineWidth = 1;

  for (let i = -CONFORMAL_GRID_RES; i <= CONFORMAL_GRID_RES; i++) {
    const v = i * step;

    // Map horizontal line (fixed im = v, varying re)
    ctx.beginPath();
    let started = false;
    for (let j = 0; j <= res; j++) {
      const re = -range + (j / res) * 2 * range;
      const w = fn({ re, im: v });
      if (!Number.isFinite(w.re) || !Number.isFinite(w.im) || cAbs(w) > 20) {
        started = false;
        continue;
      }
      if (!started) {
        ctx.moveTo(toX(w.re), toY(w.im));
        started = true;
      } else {
        ctx.lineTo(toX(w.re), toY(w.im));
      }
    }
    ctx.stroke();

    // Map vertical line (fixed re = v, varying im)
    ctx.beginPath();
    started = false;
    for (let j = 0; j <= res; j++) {
      const im = -range + (j / res) * 2 * range;
      const w = fn({ re: v, im });
      if (!Number.isFinite(w.re) || !Number.isFinite(w.im) || cAbs(w) > 20) {
        started = false;
        continue;
      }
      if (!started) {
        ctx.moveTo(toX(w.re), toY(w.im));
        started = true;
      } else {
        ctx.lineTo(toX(w.re), toY(w.im));
      }
    }
    ctx.stroke();
  }
}

function computeGridStep(scale: number): number {
  const rawStep = 80 / scale;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  if (normalized < 2) return magnitude;
  if (normalized < 5) return 2 * magnitude;
  return 5 * magnitude;
}

function formatTick(v: number): string {
  if (Math.abs(v) < 1e-10) return "0";
  const rounded = Math.round(v * 1000) / 1000;
  return String(rounded);
}

// ─────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────

export default function ComplexNumbers() {
  const [points, setPoints] = useState<PlacedPoint[]>([]);
  const [resultPoints, setResultPoints] = useState<PlacedPoint[]>([]);
  const [rootsN, setRootsN] = useState(0);
  const [mappingId, setMappingId] = useState<MappingId>("none");
  const [view, setView] = useState<ViewState>({ centerX: 0, centerY: 0, scale: 80 });
  const [animArc, setAnimArc] = useState<{ from: Complex; to: Complex; t: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(700);
  const animFrameRef = useRef<number>(0);
  const dragRef = useRef<{ mx: number; my: number; cx: number; cy: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

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

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = CANVAS_HEIGHT * dpr;

    drawComplexPlane(ctx, canvasWidth, CANVAS_HEIGHT, view, points, resultPoints, rootsN, mappingId, animArc);
  }, [canvasWidth, view, points, resultPoints, rootsN, mappingId, animArc]);

  // Canvas to math coordinates
  const toMath = useCallback(
    (px: number, py: number): Complex => ({
      re: (px - canvasWidth / 2) / view.scale + view.centerX,
      im: -(py - CANVAS_HEIGHT / 2) / view.scale + view.centerY,
    }),
    [canvasWidth, view],
  );

  // Click to place point
  const handleClick = useCallback(
    (e: MouseEvent) => {
      if (isDragging) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const z = toMath(px, py);

      setPoints((prev) => {
        if (prev.length >= MAX_POINTS) return prev;
        const idx = prev.length;
        return [...prev, {
          z,
          label: `z${idx + 1}`,
          color: POINT_COLORS[idx % POINT_COLORS.length],
        }];
      });
    },
    [toMath, isDragging],
  );

  // Drag to pan
  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (e.button === 2 || e.shiftKey) {
        setIsDragging(true);
        dragRef.current = { mx: e.clientX, my: e.clientY, cx: view.centerX, cy: view.centerY };
        e.preventDefault();
      }
    },
    [view.centerX, view.centerY],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (isDragging && dragRef.current) {
        const dx = (e.clientX - dragRef.current.mx) / view.scale;
        const dy = -(e.clientY - dragRef.current.my) / view.scale;
        setView((v) => ({
          ...v,
          centerX: dragRef.current!.cx - dx,
          centerY: dragRef.current!.cy - dy,
        }));
      }
    },
    [isDragging, view.scale],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    dragRef.current = null;
  }, []);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    setView((v) => ({
      ...v,
      scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor)),
    }));
  }, []);

  const handleContextMenu = useCallback((e: Event) => {
    e.preventDefault();
  }, []);

  // Operations
  const applyOperation = useCallback(
    (op: OperationId) => {
      if (op === "conj" && points.length >= 1) {
        const z1 = points[0].z;
        const result = cConj(z1);
        setResultPoints([{ z: result, label: `conj(z1)`, color: COLORS.result }]);
        return;
      }
      if (op === "inv" && points.length >= 1) {
        const z1 = points[0].z;
        const result = cInv(z1);
        setResultPoints([{ z: result, label: `1/z1`, color: COLORS.result }]);
        return;
      }
      if (points.length < 2) return;
      const z1 = points[0].z;
      const z2 = points[1].z;
      let result: Complex;
      let label: string;

      switch (op) {
        case "add":
          result = cAdd(z1, z2);
          label = "z1+z2";
          break;
        case "mul":
          result = cMul(z1, z2);
          label = "z1*z2";
          animateArc(z1, result);
          break;
        case "div":
          result = cDiv(z1, z2);
          label = "z1/z2";
          break;
        default:
          return;
      }
      setResultPoints([{ z: result, label, color: COLORS.result }]);
    },
    [points],
  );

  const animateArc = useCallback((from: Complex, to: Complex) => {
    cancelAnimationFrame(animFrameRef.current);
    let t = 0;
    const animate = () => {
      t += 0.025;
      if (t >= 1) {
        setAnimArc({ from, to, t: 1 });
        return;
      }
      setAnimArc({ from, to, t });
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
  }, []);

  const clearPoints = useCallback(() => {
    setPoints([]);
    setResultPoints([]);
    setAnimArc(null);
    cancelAnimationFrame(animFrameRef.current);
  }, []);

  const removeLastPoint = useCallback(() => {
    setPoints((prev) => prev.slice(0, -1));
    setResultPoints([]);
    setAnimArc(null);
  }, []);

  const hasEnoughPoints = (n: number) => points.length >= n;

  return (
    <div class="space-y-4">
      {/* Canvas */}
      <div ref={containerRef} class="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden cursor-crosshair">
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={CANVAS_HEIGHT}
          style={{ width: `${canvasWidth}px`, height: `${CANVAS_HEIGHT}px` }}
          onClick={handleClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          onContextMenu={handleContextMenu}
        />
      </div>

      <p class="text-xs text-[var(--color-text-muted)]">
        Click to place complex numbers. Shift+drag or right-drag to pan. Scroll to zoom.
      </p>

      {/* Point management */}
      <div class="flex flex-wrap gap-2">
        <button
          onClick={removeLastPoint}
          disabled={points.length === 0}
          class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-40"
        >
          Undo Last
        </button>
        <button
          onClick={clearPoints}
          class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:text-red-400 hover:border-red-500 transition-colors"
        >
          Clear All
        </button>
      </div>

      {/* Points display */}
      {points.length > 0 && (
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h3 class="text-sm font-semibold text-[var(--color-heading)] mb-2">Placed Points</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
            {points.map((p) => (
              <div key={p.label} class="flex items-center gap-2 rounded bg-[var(--color-bg)] px-3 py-1.5 border border-[var(--color-border)]">
                <span class="inline-block w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                <span class="text-[var(--color-heading)] font-bold">{p.label}</span>
                <span class="text-[var(--color-text-muted)]">=</span>
                <span class="text-[var(--color-text)]">{formatComplex(p.z)}</span>
                <span class="text-[var(--color-text-muted)] ml-auto">{formatPolar(p.z)}</span>
              </div>
            ))}
            {resultPoints.map((p) => (
              <div key={p.label} class="flex items-center gap-2 rounded bg-[var(--color-bg)] px-3 py-1.5 border border-red-500/30">
                <span class="inline-block w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS.result }} />
                <span class="text-red-400 font-bold">{p.label}</span>
                <span class="text-[var(--color-text-muted)]">=</span>
                <span class="text-[var(--color-text)]">{formatComplex(p.z)}</span>
                <span class="text-[var(--color-text-muted)] ml-auto">{formatPolar(p.z)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Operations */}
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
        <h3 class="text-sm font-semibold text-[var(--color-heading)]">Operations</h3>
        <div class="flex flex-wrap gap-2">
          <OpButton
            label="z1 + z2"
            disabled={!hasEnoughPoints(2)}
            onClick={() => applyOperation("add")}
          />
          <OpButton
            label="z1 * z2"
            disabled={!hasEnoughPoints(2)}
            onClick={() => applyOperation("mul")}
          />
          <OpButton
            label="z1 / z2"
            disabled={!hasEnoughPoints(2)}
            onClick={() => applyOperation("div")}
          />
          <OpButton
            label="conj(z1)"
            disabled={!hasEnoughPoints(1)}
            onClick={() => applyOperation("conj")}
          />
          <OpButton
            label="1 / z1"
            disabled={!hasEnoughPoints(1)}
            onClick={() => applyOperation("inv")}
          />
        </div>
      </div>

      {/* Roots of Unity */}
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
        <h3 class="text-sm font-semibold text-[var(--color-heading)]">Roots of Unity</h3>
        <div class="flex items-center gap-3">
          <label class="text-sm text-[var(--color-text-muted)]">n =</label>
          <input
            type="range"
            min="0"
            max="12"
            step="1"
            value={rootsN}
            onInput={(e) => setRootsN(parseInt((e.target as HTMLInputElement).value))}
            class="flex-1 accent-[var(--color-primary)]"
          />
          <span class="text-sm font-mono text-[var(--color-heading)] w-6 text-right">{rootsN}</span>
        </div>
        {rootsN > 0 && (
          <p class="text-xs text-[var(--color-text-muted)]">
            Showing {rootsN}-th roots of unity: z^{rootsN} = 1
          </p>
        )}
      </div>

      {/* Conformal Mapping */}
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
        <h3 class="text-sm font-semibold text-[var(--color-heading)]">Conformal Mapping</h3>
        <div class="flex flex-wrap gap-2">
          {MAPPINGS.map((m) => (
            <button
              key={m.id}
              onClick={() => setMappingId(m.id)}
              class={`rounded-lg px-3 py-1.5 text-sm font-mono transition-colors ${
                mappingId === m.id
                  ? "bg-[var(--color-primary)] text-white"
                  : "bg-[var(--color-bg)] text-[var(--color-text-muted)] border border-[var(--color-border)] hover:text-[var(--color-text)]"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {mappingId !== "none" && (
          <p class="text-xs text-[var(--color-text-muted)]">
            Blue grid: original. Orange grid: image under w = {MAPPINGS.find((m) => m.id === mappingId)?.label}.
          </p>
        )}
      </div>

      {/* Legend */}
      <div class="flex flex-wrap gap-4 text-xs text-[var(--color-text-muted)]">
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-4 h-0.5 border-t border-dashed" style={{ borderColor: COLORS.unitCircleStroke }} />
          Unit circle
        </span>
        {rootsN > 0 && (
          <span class="flex items-center gap-1.5">
            <span class="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.rootsOfUnity }} />
            Roots of unity
          </span>
        )}
        {resultPoints.length > 0 && (
          <span class="flex items-center gap-1.5">
            <span class="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.result }} />
            Result
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────

function OpButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm font-mono text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-primary)] transition-colors disabled:opacity-40 disabled:hover:border-[var(--color-border)] disabled:hover:text-[var(--color-text-muted)]"
    >
      {label}
    </button>
  );
}
