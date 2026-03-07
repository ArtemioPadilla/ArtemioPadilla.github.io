import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ================================================================
   Types & Constants
   ================================================================ */

type ElementType = "convex-lens" | "concave-lens" | "flat-mirror" | "curved-mirror" | "prism";
type SourceType = "parallel" | "point" | "divergent";

interface OpticalElement {
  id: number;
  type: ElementType;
  x: number;
  y: number;
  focalLength: number;
}

interface Ray {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

interface RaySegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

interface DragState {
  elementId: number | null;
  offsetX: number;
  offsetY: number;
}

const ELEMENT_HEIGHT = 80;
const RAY_COUNT = 9;
const MAX_BOUNCES = 14;
const RAY_MAX_LENGTH = 3000;

const ELEMENT_LABELS: Record<ElementType, string> = {
  "convex-lens": "Convex Lens",
  "concave-lens": "Concave Lens",
  "flat-mirror": "Flat Mirror",
  "curved-mirror": "Curved Mirror",
  prism: "Prism",
};

const FOCAL_DEFAULTS: Record<ElementType, number> = {
  "convex-lens": 80,
  "concave-lens": -80,
  "flat-mirror": 0,
  "curved-mirror": 100,
  prism: 0,
};

let nextElemId = 1;

/* ================================================================
   Ray Tracing Engine
   ================================================================ */

function intersectVerticalLine(
  ray: Ray,
  lineX: number,
  yMin: number,
  yMax: number,
): { t: number; y: number } | null {
  if (Math.abs(ray.dx) < 1e-9) return null;
  const t = (lineX - ray.x) / ray.dx;
  if (t < 0.5) return null;
  const y = ray.y + ray.dy * t;
  if (y < yMin || y > yMax) return null;
  return { t, y };
}

function refractThinLens(ray: Ray, elem: OpticalElement, hitY: number): Ray | null {
  const f = elem.focalLength;
  if (Math.abs(f) < 1) return null;
  const relY = hitY - elem.y;
  const deflection = -relY / f;
  const inDy = ray.dy / Math.sqrt(ray.dx * ray.dx + ray.dy * ray.dy);
  const newDy = inDy + deflection;
  const mag = Math.sqrt(1 + newDy * newDy);
  return { x: elem.x, y: hitY, dx: 1 / mag, dy: newDy / mag };
}

function reflectFlat(ray: Ray, elem: OpticalElement, hitY: number): Ray {
  return { x: elem.x, y: hitY, dx: -ray.dx, dy: ray.dy };
}

function reflectCurved(ray: Ray, elem: OpticalElement, hitY: number): Ray {
  const relY = hitY - elem.y;
  const f = elem.focalLength;
  const normalAngle = Math.atan2(relY, f);
  const nx = Math.cos(normalAngle);
  const ny = Math.sin(normalAngle);
  const dot = ray.dx * nx + ray.dy * ny;
  return {
    x: elem.x,
    y: hitY,
    dx: ray.dx - 2 * dot * nx,
    dy: ray.dy - 2 * dot * ny,
  };
}

function refractPrism(ray: Ray, elem: OpticalElement, hitY: number, wavelength: number): Ray {
  const n = 1.5 + (wavelength - 0.5) * 0.12;
  const prismAngle = 0.52;
  const deflection = (n - 1) * prismAngle;
  return {
    x: elem.x + 15,
    y: hitY,
    dx: ray.dx,
    dy: ray.dy + deflection * (wavelength - 0.5),
  };
}

function traceRay(
  startRay: Ray,
  elements: OpticalElement[],
  wavelength: number,
  hasPrism: boolean,
): RaySegment[] {
  const segments: RaySegment[] = [];
  let currentRay = { ...startRay };

  for (let bounce = 0; bounce < MAX_BOUNCES; bounce++) {
    let closestT = RAY_MAX_LENGTH;
    let closestElem: OpticalElement | null = null;
    let closestHitY = 0;

    for (const elem of elements) {
      const halfH = ELEMENT_HEIGHT / 2;
      const hit = intersectVerticalLine(currentRay, elem.x, elem.y - halfH, elem.y + halfH);
      if (hit && hit.t < closestT) {
        closestT = hit.t;
        closestElem = elem;
        closestHitY = hit.y;
      }
    }

    const endX = currentRay.x + currentRay.dx * closestT;
    const endY = currentRay.y + currentRay.dy * closestT;
    const hue = (1 - wavelength) * 270;
    const color = hasPrism ? `hsl(${hue}, 90%, 55%)` : "rgba(250,204,21,0.6)";

    segments.push({
      x1: currentRay.x,
      y1: currentRay.y,
      x2: closestElem ? closestElem.x : endX,
      y2: closestElem ? closestHitY : endY,
      color,
    });

    if (!closestElem) break;

    let newRay: Ray | null = null;
    switch (closestElem.type) {
      case "convex-lens":
      case "concave-lens":
        newRay = refractThinLens(currentRay, closestElem, closestHitY);
        break;
      case "flat-mirror":
        newRay = reflectFlat(currentRay, closestElem, closestHitY);
        break;
      case "curved-mirror":
        newRay = reflectCurved(currentRay, closestElem, closestHitY);
        break;
      case "prism":
        newRay = refractPrism(currentRay, closestElem, closestHitY, wavelength);
        break;
    }

    if (!newRay) break;
    currentRay = newRay;
  }
  return segments;
}

function generateRays(sourceType: SourceType, sourceX: number, sourceY: number): Ray[] {
  const rays: Ray[] = [];
  const spread = ELEMENT_HEIGHT * 0.8;

  for (let i = 0; i < RAY_COUNT; i++) {
    const t = i / (RAY_COUNT - 1) - 0.5;
    switch (sourceType) {
      case "parallel":
        rays.push({ x: sourceX, y: sourceY + t * spread, dx: 1, dy: 0 });
        break;
      case "point": {
        const angle = t * 0.5;
        rays.push({ x: sourceX, y: sourceY, dx: Math.cos(angle), dy: Math.sin(angle) });
        break;
      }
      case "divergent": {
        const angle = t * 0.35;
        rays.push({ x: sourceX, y: sourceY, dx: Math.cos(angle), dy: Math.sin(angle) });
        break;
      }
    }
  }
  return rays;
}

/* ================================================================
   Drawing
   ================================================================ */

function drawElement(ctx: CanvasRenderingContext2D, elem: OpticalElement, selected: boolean): void {
  const halfH = ELEMENT_HEIGHT / 2;
  ctx.save();

  switch (elem.type) {
    case "convex-lens": {
      ctx.strokeStyle = "rgba(79,143,247,0.8)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(elem.x, elem.y, 8, halfH, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(79,143,247,0.08)";
      ctx.fill();
      drawArrows(ctx, elem.x, elem.y, halfH);
      drawFocalDots(ctx, elem);
      break;
    }
    case "concave-lens": {
      ctx.strokeStyle = "rgba(239,68,68,0.8)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(elem.x - 4, elem.y - halfH);
      ctx.quadraticCurveTo(elem.x + 6, elem.y, elem.x - 4, elem.y + halfH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(elem.x + 4, elem.y - halfH);
      ctx.quadraticCurveTo(elem.x - 6, elem.y, elem.x + 4, elem.y + halfH);
      ctx.stroke();
      drawFocalDots(ctx, elem);
      break;
    }
    case "flat-mirror": {
      ctx.strokeStyle = "rgba(200,200,200,0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(elem.x, elem.y - halfH);
      ctx.lineTo(elem.x, elem.y + halfH);
      ctx.stroke();
      for (let i = -halfH; i < halfH; i += 8) {
        ctx.beginPath();
        ctx.moveTo(elem.x + 2, elem.y + i);
        ctx.lineTo(elem.x + 8, elem.y + i - 6);
        ctx.strokeStyle = "rgba(200,200,200,0.3)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      break;
    }
    case "curved-mirror": {
      ctx.strokeStyle = "rgba(200,200,200,0.9)";
      ctx.lineWidth = 3;
      const curve = elem.focalLength > 0 ? -20 : 20;
      ctx.beginPath();
      ctx.moveTo(elem.x, elem.y - halfH);
      ctx.quadraticCurveTo(elem.x + curve, elem.y, elem.x, elem.y + halfH);
      ctx.stroke();
      ctx.fillStyle = "#34d399";
      ctx.beginPath();
      ctx.arc(elem.x - elem.focalLength / 2, elem.y, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "prism": {
      const sz = 25;
      ctx.strokeStyle = "rgba(168,85,247,0.8)";
      ctx.lineWidth = 2;
      ctx.fillStyle = "rgba(168,85,247,0.08)";
      ctx.beginPath();
      ctx.moveTo(elem.x, elem.y - sz);
      ctx.lineTo(elem.x + sz, elem.y + sz);
      ctx.lineTo(elem.x - sz, elem.y + sz);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
  }

  if (selected) {
    ctx.strokeStyle = "#34d399";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(elem.x - 22, elem.y - halfH - 5, 44, ELEMENT_HEIGHT + 10);
    ctx.setLineDash([]);
  }

  ctx.fillStyle = "rgba(228,228,231,0.4)";
  ctx.font = "9px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(ELEMENT_LABELS[elem.type], elem.x, elem.y + halfH + 16);
  ctx.restore();
}

function drawArrows(ctx: CanvasRenderingContext2D, x: number, y: number, halfH: number): void {
  ctx.strokeStyle = "rgba(79,143,247,0.5)";
  ctx.lineWidth = 1.5;
  for (const dir of [-1, 1]) {
    const tipY = y + dir * halfH;
    ctx.beginPath();
    ctx.moveTo(x - 5, tipY + dir * 5);
    ctx.lineTo(x, tipY);
    ctx.lineTo(x + 5, tipY + dir * 5);
    ctx.stroke();
  }
}

function drawFocalDots(ctx: CanvasRenderingContext2D, elem: OpticalElement): void {
  ctx.fillStyle = "#34d399";
  const absF = Math.abs(elem.focalLength);
  for (const sign of [1, -1]) {
    ctx.beginPath();
    ctx.arc(elem.x + sign * absF, elem.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(52,211,153,0.5)";
  ctx.font = "8px monospace";
  ctx.textAlign = "center";
  ctx.fillText("F", elem.x + absF, elem.y - 8);
  ctx.fillText("F", elem.x - absF, elem.y - 8);
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  elements: OpticalElement[],
  sourceType: SourceType,
  selectedId: number | null,
  w: number,
  h: number,
): void {
  ctx.fillStyle = "#09090b";
  ctx.fillRect(0, 0, w, h);

  // Optical axis
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Bench ruler
  const rulerY = h / 2 + ELEMENT_HEIGHT / 2 + 20;
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, rulerY);
  ctx.lineTo(w, rulerY);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.font = "7px monospace";
  ctx.textAlign = "center";
  for (let px = 50; px < w; px += 50) {
    ctx.beginPath();
    ctx.moveTo(px, rulerY - 3);
    ctx.lineTo(px, rulerY + 3);
    ctx.stroke();
    ctx.fillText(`${px}`, px, rulerY + 12);
  }

  // Light source with glow
  const sourceX = 30;
  const sourceY = h / 2;
  const grad = ctx.createRadialGradient(sourceX, sourceY, 0, sourceX, sourceY, 20);
  grad.addColorStop(0, "rgba(250,204,21,0.5)");
  grad.addColorStop(1, "rgba(250,204,21,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(sourceX - 20, sourceY - 20, 40, 40);
  ctx.beginPath();
  ctx.arc(sourceX, sourceY, 8, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(250,204,21,0.9)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sourceX, sourceY, 12, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(250,204,21,0.3)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "rgba(250,204,21,0.5)";
  ctx.font = "8px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(sourceType, sourceX, sourceY + 22);

  // Trace rays
  const hasPrism = elements.some((e) => e.type === "prism");
  const rays = generateRays(sourceType, sourceX + 12, sourceY);
  for (let ri = 0; ri < rays.length; ri++) {
    const wavelength = hasPrism ? ri / Math.max(1, rays.length - 1) : 0.5;
    const segments = traceRay(rays[ri], elements, wavelength, hasPrism);
    for (const seg of segments) {
      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
      ctx.strokeStyle = seg.color;
      ctx.lineWidth = hasPrism ? 1.5 : 1.2;
      ctx.globalAlpha = 0.8;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // Draw elements
  for (const elem of elements) {
    drawElement(ctx, elem, elem.id === selectedId);
  }

  // Snell's law info panel for selected lens
  const selected = elements.find((e) => e.id === selectedId);
  if (selected && (selected.type === "convex-lens" || selected.type === "concave-lens")) {
    const theta1 = 0.3;
    const sinTheta2 = Math.sin(theta1) / 1.5;
    const theta2 = Math.asin(sinTheta2);
    const infoX = w - 170;
    ctx.fillStyle = "rgba(17,17,17,0.88)";
    ctx.beginPath();
    ctx.roundRect(infoX, 12, 158, 56, 6);
    ctx.fill();
    ctx.strokeStyle = "rgba(79,143,247,0.3)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "rgba(228,228,231,0.8)";
    ctx.font = "9px monospace";
    ctx.textAlign = "left";
    ctx.fillText("Snell: n1 sin(i) = n2 sin(r)", infoX + 8, 28);
    ctx.fillText(`i = ${(theta1 * 180 / Math.PI).toFixed(1)} deg  n1=1.0  n2=1.5`, infoX + 8, 42);
    ctx.fillStyle = "#34d399";
    ctx.fillText(`r = ${(theta2 * 180 / Math.PI).toFixed(1)} deg`, infoX + 8, 56);
  }
}

/* ================================================================
   Presets
   ================================================================ */

function buildPreset(key: string, w: number, h: number): OpticalElement[] {
  const cy = h / 2;
  switch (key) {
    case "telescope":
      return [
        { id: nextElemId++, type: "convex-lens", x: w * 0.3, y: cy, focalLength: 120 },
        { id: nextElemId++, type: "convex-lens", x: w * 0.65, y: cy, focalLength: 50 },
      ];
    case "microscope":
      return [
        { id: nextElemId++, type: "convex-lens", x: w * 0.25, y: cy, focalLength: 40 },
        { id: nextElemId++, type: "convex-lens", x: w * 0.6, y: cy, focalLength: 100 },
      ];
    case "periscope":
      return [
        { id: nextElemId++, type: "flat-mirror", x: w * 0.35, y: cy - 50, focalLength: 0 },
        { id: nextElemId++, type: "flat-mirror", x: w * 0.55, y: cy + 50, focalLength: 0 },
      ];
    case "dispersion":
      return [{ id: nextElemId++, type: "prism", x: w * 0.4, y: cy, focalLength: 0 }];
    default:
      return [];
  }
}

/* ================================================================
   Component
   ================================================================ */

export default function OpticsBench() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const elemsRef = useRef<OpticalElement[]>([]);
  const dragRef = useRef<DragState>({ elementId: null, offsetX: 0, offsetY: 0 });
  const sizeRef = useRef({ w: 800, h: 400 });

  const [elements, setElements] = useState<OpticalElement[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sourceType, setSourceType] = useState<SourceType>("parallel");

  const selectedElem = elements.find((e) => e.id === selectedId) ?? null;

  const sync = useCallback((elems: OpticalElement[]) => {
    elemsRef.current = elems;
    setElements([...elems]);
  }, []);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(rect.width);
    const h = Math.min(Math.floor(rect.width * 0.45), 420);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);
    sizeRef.current = { w, h };
  }, []);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { w, h } = sizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScene(ctx, elemsRef.current, sourceType, selectedId, w, h);
  }, [sourceType, selectedId]);

  useEffect(() => {
    resizeCanvas();
    const { w, h } = sizeRef.current;
    sync([{ id: nextElemId++, type: "convex-lens", x: w * 0.4, y: h / 2, focalLength: 80 }]);
    const onResize = () => { resizeCanvas(); render(); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [resizeCanvas, render, sync]);

  useEffect(() => { render(); }, [elements, sourceType, selectedId, render]);

  const coords = useCallback((e: MouseEvent) => {
    const r = canvasRef.current?.getBoundingClientRect();
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: 0, y: 0 };
  }, []);

  const hitTest = useCallback((x: number, y: number): OpticalElement | null => {
    for (const el of elemsRef.current) {
      if (Math.abs(x - el.x) < 25 && Math.abs(y - el.y) < ELEMENT_HEIGHT / 2 + 10) return el;
    }
    return null;
  }, []);

  const onDown = useCallback((e: MouseEvent) => {
    const c = coords(e);
    const hit = hitTest(c.x, c.y);
    if (hit) {
      dragRef.current = { elementId: hit.id, offsetX: c.x - hit.x, offsetY: c.y - hit.y };
      setSelectedId(hit.id);
    } else {
      setSelectedId(null);
    }
  }, [coords, hitTest]);

  const onMove = useCallback((e: MouseEvent) => {
    if (dragRef.current.elementId === null) return;
    const c = coords(e);
    const updated = elemsRef.current.map((el) =>
      el.id === dragRef.current.elementId
        ? {
            ...el,
            x: Math.max(60, Math.min(sizeRef.current.w - 20, c.x - dragRef.current.offsetX)),
            y: Math.max(50, Math.min(sizeRef.current.h - 50, c.y - dragRef.current.offsetY)),
          }
        : el,
    );
    sync(updated);
  }, [coords, sync]);

  const onUp = useCallback(() => {
    dragRef.current = { elementId: null, offsetX: 0, offsetY: 0 };
  }, []);

  const addElement = useCallback((type: ElementType) => {
    const { w, h } = sizeRef.current;
    const xs = elemsRef.current.map((e) => e.x);
    let x = w * 0.5;
    while (xs.some((ex) => Math.abs(ex - x) < 40)) x += 50;
    const el: OpticalElement = {
      id: nextElemId++,
      type,
      x: Math.min(x, w - 30),
      y: h / 2,
      focalLength: FOCAL_DEFAULTS[type],
    };
    sync([...elemsRef.current, el]);
    setSelectedId(el.id);
  }, [sync]);

  const removeSelected = useCallback(() => {
    if (selectedId === null) return;
    sync(elemsRef.current.filter((e) => e.id !== selectedId));
    setSelectedId(null);
  }, [selectedId, sync]);

  const updateFocal = useCallback((value: number) => {
    if (selectedId === null) return;
    sync(elemsRef.current.map((el) => (el.id === selectedId ? { ...el, focalLength: value } : el)));
  }, [selectedId, sync]);

  const loadPreset = useCallback((key: string) => {
    const { w, h } = sizeRef.current;
    sync(buildPreset(key, w, h));
    setSelectedId(null);
  }, [sync]);

  const clearAll = useCallback(() => { sync([]); setSelectedId(null); }, [sync]);

  // Styles
  const btn = (active: boolean, activeColor = "var(--color-primary)") => ({
    padding: "6px 12px",
    borderRadius: "8px",
    border: `1px solid ${active ? activeColor : "var(--color-border)"}`,
    backgroundColor: active ? `color-mix(in srgb, ${activeColor} 12%, transparent)` : "var(--color-surface)",
    color: active ? activeColor : "var(--color-text)",
    fontSize: "11px",
    fontWeight: 500 as const,
    cursor: "pointer" as const,
    transition: "all 0.15s",
  });

  const sourceTypes: { key: SourceType; label: string }[] = [
    { key: "parallel", label: "Parallel Beam" },
    { key: "point", label: "Point Source" },
    { key: "divergent", label: "Divergent" },
  ];

  const presets = [
    { key: "telescope", label: "Telescope" },
    { key: "microscope", label: "Microscope" },
    { key: "periscope", label: "Periscope" },
    { key: "dispersion", label: "Prism Dispersion" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Add elements toolbar */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
        <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-muted)" }}>Add:</span>
        {(Object.keys(ELEMENT_LABELS) as ElementType[]).map((type) => (
          <button key={type} onClick={() => addElement(type)} style={btn(false)}>
            {ELEMENT_LABELS[type]}
          </button>
        ))}
      </div>

      {/* Source type + presets */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
        <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-muted)" }}>Source:</span>
        {sourceTypes.map((s) => (
          <button key={s.key} onClick={() => setSourceType(s.key)} style={btn(sourceType === s.key, "#facc15")}>
            {s.label}
          </button>
        ))}
        <span style={{ width: "1px", height: "18px", backgroundColor: "var(--color-border)", margin: "0 4px" }} />
        <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-muted)" }}>Presets:</span>
        {presets.map((p) => (
          <button key={p.key} onClick={() => loadPreset(p.key)} style={btn(false)}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Selected element controls */}
      {selectedElem && (
        <div style={{
          display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px",
          padding: "10px 14px", borderRadius: "12px",
          border: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)",
        }}>
          <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-heading)" }}>
            {ELEMENT_LABELS[selectedElem.type]}
          </span>
          {(selectedElem.type === "convex-lens" || selectedElem.type === "concave-lens" || selectedElem.type === "curved-mirror") && (
            <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                Focal: {Math.abs(selectedElem.focalLength).toFixed(0)}px
              </span>
              <input
                type="range" min="20" max="200"
                value={Math.abs(selectedElem.focalLength)}
                onInput={(e) => {
                  const val = parseInt((e.target as HTMLInputElement).value, 10);
                  const sign = selectedElem.type === "concave-lens" ? -1 : 1;
                  updateFocal(val * sign);
                }}
                style={{ width: "100px", accentColor: "var(--color-primary)" }}
              />
            </label>
          )}
          <button onClick={removeSelected} style={{
            marginLeft: "auto", padding: "4px 12px", borderRadius: "8px",
            border: "1px solid rgba(239,68,68,0.3)", backgroundColor: "rgba(239,68,68,0.1)",
            color: "#f87171", fontSize: "11px", fontWeight: 500, cursor: "pointer",
          }}>
            Remove
          </button>
        </div>
      )}

      {/* Clear + count */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <button onClick={clearAll} style={btn(false)}>Clear Bench</button>
        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
          {elements.length} element{elements.length !== 1 ? "s" : ""} on bench
        </span>
      </div>

      {/* Canvas */}
      <div ref={containerRef} style={{
        position: "relative", overflow: "hidden", borderRadius: "12px",
        border: "1px solid var(--color-border)",
      }}>
        <canvas
          ref={canvasRef}
          style={{ display: "block", width: "100%", cursor: "grab" }}
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={onUp}
        />
        <div style={{
          position: "absolute", bottom: "6px", left: "10px",
          fontSize: "9px", color: "var(--color-text-muted)", opacity: 0.6,
        }}>
          Drag elements to reposition | Click to select | Adjust focal length with slider
        </div>
      </div>
    </div>
  );
}
