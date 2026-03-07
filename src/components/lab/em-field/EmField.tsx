import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ================================================================
   Types & Constants
   ================================================================ */

interface Charge {
  x: number;
  y: number;
  q: number; // positive or negative magnitude
  id: number;
}

type ViewMode = "field-lines" | "arrows" | "potential";

interface DragState {
  chargeId: number | null;
  offsetX: number;
  offsetY: number;
}

const K_COULOMB = 500;
const ARROW_GRID = 25;
const FIELD_LINE_STEPS = 300;
const FIELD_LINE_DT = 3;
const LINES_PER_CHARGE = 16;

let nextId = 1;

/* ================================================================
   Physics Engine
   ================================================================ */

function electricField(
  x: number,
  y: number,
  charges: Charge[],
): { ex: number; ey: number } {
  let ex = 0;
  let ey = 0;
  for (const c of charges) {
    const dx = x - c.x;
    const dy = y - c.y;
    const r2 = dx * dx + dy * dy;
    if (r2 < 25) continue;
    const r = Math.sqrt(r2);
    const e = (K_COULOMB * c.q) / r2;
    ex += (e * dx) / r;
    ey += (e * dy) / r;
  }
  return { ex, ey };
}

function electricPotential(x: number, y: number, charges: Charge[]): number {
  let v = 0;
  for (const c of charges) {
    const dx = x - c.x;
    const dy = y - c.y;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r < 5) continue;
    v += (K_COULOMB * c.q) / r;
  }
  return v;
}

function traceFieldLine(
  startX: number,
  startY: number,
  charges: Charge[],
  direction: number,
  w: number,
  h: number,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [{ x: startX, y: startY }];
  let x = startX;
  let y = startY;

  for (let i = 0; i < FIELD_LINE_STEPS; i++) {
    const { ex, ey } = electricField(x, y, charges);
    const mag = Math.sqrt(ex * ex + ey * ey);
    if (mag < 0.01) break;

    const dx = (direction * ex * FIELD_LINE_DT) / mag;
    const dy = (direction * ey * FIELD_LINE_DT) / mag;
    x += dx;
    y += dy;

    if (x < 0 || x > w || y < 0 || y > h) break;

    // Stop if too close to a charge
    let tooClose = false;
    for (const c of charges) {
      const cd = Math.sqrt((x - c.x) ** 2 + (y - c.y) ** 2);
      if (cd < 8) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) break;

    points.push({ x, y });
  }

  return points;
}

/* ================================================================
   Rendering
   ================================================================ */

function resolveColor(el: HTMLCanvasElement, varName: string, fallback: string): string {
  const val = getComputedStyle(el).getPropertyValue(varName).trim();
  return val || fallback;
}

function drawFieldLines(
  ctx: CanvasRenderingContext2D,
  charges: Charge[],
  w: number,
  h: number,
): void {
  for (const c of charges) {
    const direction = c.q > 0 ? 1 : -1;
    for (let i = 0; i < LINES_PER_CHARGE; i++) {
      const angle = (i / LINES_PER_CHARGE) * Math.PI * 2;
      const startX = c.x + Math.cos(angle) * 10;
      const startY = c.y + Math.sin(angle) * 10;
      const points = traceFieldLine(startX, startY, charges, direction, w, h);

      if (points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let j = 1; j < points.length; j++) {
        ctx.lineTo(points[j].x, points[j].y);
      }
      ctx.strokeStyle = c.q > 0 ? "rgba(79,143,247,0.5)" : "rgba(239,68,68,0.5)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
}

function drawArrows(
  ctx: CanvasRenderingContext2D,
  charges: Charge[],
  w: number,
  h: number,
): void {
  const spacing = ARROW_GRID;
  for (let x = spacing; x < w; x += spacing) {
    for (let y = spacing; y < h; y += spacing) {
      const { ex, ey } = electricField(x, y, charges);
      const mag = Math.sqrt(ex * ex + ey * ey);
      if (mag < 0.001) continue;

      const maxLen = spacing * 0.4;
      const len = Math.min(maxLen, mag * 0.3);
      const angle = Math.atan2(ey, ex);

      const intensity = Math.min(1, mag / 20);
      const r = Math.round(79 + intensity * 160);
      const g = Math.round(143 - intensity * 75);
      const b = Math.round(247 - intensity * 180);
      ctx.strokeStyle = `rgba(${r},${g},${b},${0.4 + intensity * 0.5})`;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 1;

      const endX = x + Math.cos(angle) * len;
      const endY = y + Math.sin(angle) * len;

      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      // Arrowhead
      const headSize = 3;
      ctx.beginPath();
      ctx.moveTo(endX, endY);
      ctx.lineTo(
        endX - Math.cos(angle - 0.5) * headSize,
        endY - Math.sin(angle - 0.5) * headSize,
      );
      ctx.lineTo(
        endX - Math.cos(angle + 0.5) * headSize,
        endY - Math.sin(angle + 0.5) * headSize,
      );
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawPotentialMap(
  ctx: CanvasRenderingContext2D,
  charges: Charge[],
  w: number,
  h: number,
): void {
  const resolution = 4;
  const imgData = ctx.createImageData(Math.ceil(w / resolution), Math.ceil(h / resolution));
  const data = imgData.data;

  let maxV = 0;
  const potentials: number[] = [];

  for (let py = 0; py < imgData.height; py++) {
    for (let px = 0; px < imgData.width; px++) {
      const v = electricPotential(px * resolution, py * resolution, charges);
      potentials.push(v);
      maxV = Math.max(maxV, Math.abs(v));
    }
  }

  if (maxV === 0) maxV = 1;

  for (let i = 0; i < potentials.length; i++) {
    const t = potentials[i] / maxV;
    const idx = i * 4;

    if (t > 0) {
      data[idx] = Math.round(40 + t * 200);
      data[idx + 1] = Math.round(60 + t * 80);
      data[idx + 2] = Math.round(200 - t * 150);
    } else {
      const at = Math.abs(t);
      data[idx] = Math.round(200 - at * 150);
      data[idx + 1] = Math.round(60 + at * 60);
      data[idx + 2] = Math.round(40 + at * 200);
    }
    data[idx + 3] = Math.round(80 + Math.abs(t) * 175);
  }

  const offscreen = document.createElement("canvas");
  offscreen.width = imgData.width;
  offscreen.height = imgData.height;
  const offCtx = offscreen.getContext("2d")!;
  offCtx.putImageData(imgData, 0, 0);

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(offscreen, 0, 0, w, h);
}

function drawCharges(
  ctx: CanvasRenderingContext2D,
  charges: Charge[],
  selectedId: number | null,
): void {
  for (const c of charges) {
    const radius = 8 + Math.abs(c.q) * 2;

    // Glow
    ctx.beginPath();
    ctx.arc(c.x, c.y, radius + 4, 0, Math.PI * 2);
    ctx.fillStyle = c.q > 0
      ? "rgba(79,143,247,0.2)"
      : "rgba(239,68,68,0.2)";
    ctx.fill();

    // Body
    ctx.beginPath();
    ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = c.q > 0 ? "#4f8ff7" : "#ef4444";
    ctx.fill();

    if (c.id === selectedId) {
      ctx.strokeStyle = "#34d399";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Sign
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(c.q > 0 ? "+" : "-", c.x, c.y);

    // Magnitude label
    ctx.font = "9px monospace";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText(Math.abs(c.q).toFixed(1), c.x, c.y + radius + 10);
  }
}

/* ================================================================
   Presets
   ================================================================ */

function createDipole(w: number, h: number): Charge[] {
  const cx = w / 2;
  const cy = h / 2;
  return [
    { x: cx - 80, y: cy, q: 3, id: nextId++ },
    { x: cx + 80, y: cy, q: -3, id: nextId++ },
  ];
}

function createQuadrupole(w: number, h: number): Charge[] {
  const cx = w / 2;
  const cy = h / 2;
  const d = 70;
  return [
    { x: cx - d, y: cy - d, q: 3, id: nextId++ },
    { x: cx + d, y: cy - d, q: -3, id: nextId++ },
    { x: cx - d, y: cy + d, q: -3, id: nextId++ },
    { x: cx + d, y: cy + d, q: 3, id: nextId++ },
  ];
}

function createParallelPlate(w: number, h: number): Charge[] {
  const cx = w / 2;
  const cy = h / 2;
  const charges: Charge[] = [];
  const plateHeight = 160;
  const count = 6;
  const gap = 100;

  for (let i = 0; i < count; i++) {
    const y = cy - plateHeight / 2 + (i / (count - 1)) * plateHeight;
    charges.push({ x: cx - gap, y, q: 2, id: nextId++ });
    charges.push({ x: cx + gap, y, q: -2, id: nextId++ });
  }
  return charges;
}

/* ================================================================
   Component
   ================================================================ */

export default function EmField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chargesRef = useRef<Charge[]>([]);
  const dragRef = useRef<DragState>({ chargeId: null, offsetX: 0, offsetY: 0 });
  const sizeRef = useRef({ w: 800, h: 500 });

  const [viewMode, setViewMode] = useState<ViewMode>("field-lines");
  const [charges, setCharges] = useState<Charge[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showControls, setShowControls] = useState(true);

  const syncCharges = useCallback((newCharges: Charge[]) => {
    chargesRef.current = newCharges;
    setCharges([...newCharges]);
  }, []);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(rect.width);
    const h = Math.min(Math.floor(rect.width * 0.6), 500);

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

    const bg = resolveColor(canvas, "--color-bg", "#09090b");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const currentCharges = chargesRef.current;
    if (currentCharges.length === 0) {
      ctx.fillStyle = resolveColor(canvas, "--color-text-muted", "#a1a1aa");
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Click to add positive charge, Shift+Click for negative", w / 2, h / 2);
      return;
    }

    if (viewMode === "potential") {
      drawPotentialMap(ctx, currentCharges, w, h);
    } else if (viewMode === "arrows") {
      drawArrows(ctx, currentCharges, w, h);
    } else {
      drawFieldLines(ctx, currentCharges, w, h);
    }

    drawCharges(ctx, currentCharges, selectedId);
  }, [viewMode, selectedId]);

  useEffect(() => {
    resizeCanvas();
    const onResize = () => {
      resizeCanvas();
      render();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [resizeCanvas, render]);

  useEffect(() => {
    render();
  }, [charges, viewMode, selectedId, render]);

  const getCanvasCoords = useCallback((e: MouseEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const findChargeAt = useCallback(
    (x: number, y: number): Charge | null => {
      for (const c of chargesRef.current) {
        const dist = Math.sqrt((c.x - x) ** 2 + (c.y - y) ** 2);
        if (dist < 15 + Math.abs(c.q) * 2) return c;
      }
      return null;
    },
    [],
  );

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      const coords = getCanvasCoords(e);
      const hit = findChargeAt(coords.x, coords.y);

      if (hit) {
        dragRef.current = {
          chargeId: hit.id,
          offsetX: coords.x - hit.x,
          offsetY: coords.y - hit.y,
        };
        setSelectedId(hit.id);
      } else {
        const q = e.shiftKey ? -3 : 3;
        const newCharge: Charge = {
          x: coords.x,
          y: coords.y,
          q,
          id: nextId++,
        };
        const updated = [...chargesRef.current, newCharge];
        syncCharges(updated);
        setSelectedId(newCharge.id);
      }
    },
    [getCanvasCoords, findChargeAt, syncCharges],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (dragRef.current.chargeId === null) return;
      const coords = getCanvasCoords(e);
      const updated = chargesRef.current.map((c) =>
        c.id === dragRef.current.chargeId
          ? { ...c, x: coords.x - dragRef.current.offsetX, y: coords.y - dragRef.current.offsetY }
          : c,
      );
      syncCharges(updated);
    },
    [getCanvasCoords, syncCharges],
  );

  const handleMouseUp = useCallback(() => {
    dragRef.current = { chargeId: null, offsetX: 0, offsetY: 0 };
  }, []);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      if (selectedId === null) return;
      const delta = e.deltaY > 0 ? -0.5 : 0.5;
      const updated = chargesRef.current.map((c) => {
        if (c.id !== selectedId) return c;
        const newQ = c.q + delta * Math.sign(c.q);
        const clampedQ = c.q > 0
          ? Math.max(0.5, Math.min(10, newQ))
          : Math.min(-0.5, Math.max(-10, newQ));
        return { ...c, q: clampedQ };
      });
      syncCharges(updated);
    },
    [selectedId, syncCharges],
  );

  const handleClear = useCallback(() => {
    syncCharges([]);
    setSelectedId(null);
  }, [syncCharges]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedId === null) return;
    const updated = chargesRef.current.filter((c) => c.id !== selectedId);
    syncCharges(updated);
    setSelectedId(null);
  }, [selectedId, syncCharges]);

  const loadPreset = useCallback(
    (factory: (w: number, h: number) => Charge[]) => {
      const { w, h } = sizeRef.current;
      const preset = factory(w, h);
      syncCharges(preset);
      setSelectedId(null);
    },
    [syncCharges],
  );

  const viewModes: { key: ViewMode; label: string }[] = [
    { key: "field-lines", label: "Field Lines" },
    { key: "arrows", label: "Arrows" },
    { key: "potential", label: "Potential Map" },
  ];

  return (
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap gap-2">
          {viewModes.map((m) => (
            <button
              key={m.key}
              onClick={() => setViewMode(m.key)}
              class={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === m.key
                  ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)]"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowControls((v) => !v)}
          class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)]"
        >
          {showControls ? "Hide" : "Show"} Controls
        </button>
      </div>

      {showControls && (
        <div class="flex flex-wrap gap-2">
          <span class="text-xs font-medium text-[var(--color-text-muted)] self-center">
            Presets:
          </span>
          <button
            onClick={() => loadPreset(createDipole)}
            class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)]"
          >
            Dipole
          </button>
          <button
            onClick={() => loadPreset(createQuadrupole)}
            class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)]"
          >
            Quadrupole
          </button>
          <button
            onClick={() => loadPreset(createParallelPlate)}
            class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)]"
          >
            Parallel Plates
          </button>
          <div class="flex-1" />
          {selectedId !== null && (
            <button
              onClick={handleDeleteSelected}
              class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:border-red-500"
            >
              Delete Selected
            </button>
          )}
          <button
            onClick={handleClear}
            class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors hover:border-red-500 hover:text-red-400"
          >
            Clear All
          </button>
        </div>
      )}

      <div ref={containerRef} class="relative overflow-hidden rounded-xl border border-[var(--color-border)]">
        <canvas
          ref={canvasRef}
          class="block w-full cursor-crosshair"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        />
        <div class="absolute bottom-2 left-3 text-[10px] text-[var(--color-text-muted)] opacity-60">
          Click: +charge | Shift+Click: -charge | Drag to move | Scroll to resize
        </div>
        {charges.length > 0 && (
          <div class="absolute right-3 top-2 rounded-lg bg-[var(--color-surface)]/80 px-2 py-1 text-[10px] text-[var(--color-text-muted)] backdrop-blur">
            {charges.length} charge{charges.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>
    </div>
  );
}
