import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

interface SurfaceDef {
  id: string;
  name: string;
  fn: (x: number, y: number) => number;
  xRange: [number, number];
  yRange: [number, number];
}

interface OptimizerDef {
  id: string;
  name: string;
  color: string;
}

interface OptimizerPath {
  optimizerId: string;
  color: string;
  trail: Array<{ x: number; y: number; loss: number }>;
  vx: number;
  vy: number;
  mx: number;
  my: number;
  adamVx: number;
  adamVy: number;
  t: number;
  cacheX: number;
  cacheY: number;
  converged: boolean;
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const CANVAS_W = 600;
const CANVAS_H = 500;
const GRID_RES = 150;
const GRADIENT_H = 1e-5;
const MAX_STEPS = 2000;
const CONVERGENCE_THRESHOLD = 1e-10;

const SURFACES: SurfaceDef[] = [
  {
    id: "rosenbrock",
    name: "Rosenbrock",
    fn: (x, y) => (1 - x) ** 2 + 100 * (y - x * x) ** 2,
    xRange: [-2, 2],
    yRange: [-1, 3],
  },
  {
    id: "rastrigin",
    name: "Rastrigin",
    fn: (x, y) =>
      20 + x * x - 10 * Math.cos(2 * Math.PI * x) + y * y - 10 * Math.cos(2 * Math.PI * y),
    xRange: [-5.12, 5.12],
    yRange: [-5.12, 5.12],
  },
  {
    id: "beale",
    name: "Beale",
    fn: (x, y) =>
      (1.5 - x + x * y) ** 2 +
      (2.25 - x + x * y * y) ** 2 +
      (2.625 - x + x * y * y * y) ** 2,
    xRange: [-4.5, 4.5],
    yRange: [-4.5, 4.5],
  },
  {
    id: "himmelblau",
    name: "Himmelblau",
    fn: (x, y) => (x * x + y - 11) ** 2 + (x + y * y - 7) ** 2,
    xRange: [-5, 5],
    yRange: [-5, 5],
  },
  {
    id: "bowl",
    name: "Bowl + Local Minima",
    fn: (x, y) =>
      0.5 * (x * x + y * y) +
      3 * Math.exp(-((x + 2) ** 2 + (y + 2) ** 2)) * -2 +
      2 * Math.exp(-((x - 2) ** 2 + (y - 1) ** 2)) * -1.5,
    xRange: [-5, 5],
    yRange: [-5, 5],
  },
];

const OPTIMIZERS: OptimizerDef[] = [
  { id: "sgd", name: "SGD", color: "#4f8ff7" },
  { id: "momentum", name: "SGD+Momentum", color: "#34d399" },
  { id: "adam", name: "Adam", color: "#f59e0b" },
  { id: "rmsprop", name: "RMSProp", color: "#a855f7" },
];

// Viridis-like color palette for contour
const CONTOUR_COLORS = [
  [68, 1, 84],
  [72, 35, 116],
  [64, 67, 135],
  [52, 94, 141],
  [41, 120, 142],
  [32, 144, 140],
  [34, 167, 132],
  [68, 190, 112],
  [121, 209, 81],
  [189, 222, 38],
  [253, 231, 37],
];

// ─────────────────────────────────────────────────────────
// Numerical Gradient
// ─────────────────────────────────────────────────────────

function computeGradient(
  fn: (x: number, y: number) => number,
  x: number,
  y: number
): [number, number] {
  const gx = (fn(x + GRADIENT_H, y) - fn(x - GRADIENT_H, y)) / (2 * GRADIENT_H);
  const gy = (fn(x, y + GRADIENT_H) - fn(x, y - GRADIENT_H)) / (2 * GRADIENT_H);
  return [
    Number.isFinite(gx) ? gx : 0,
    Number.isFinite(gy) ? gy : 0,
  ];
}

// ─────────────────────────────────────────────────────────
// Optimizer Step
// ─────────────────────────────────────────────────────────

function stepOptimizer(
  path: OptimizerPath,
  fn: (x: number, y: number) => number,
  lr: number
): OptimizerPath {
  if (path.converged || path.trail.length === 0) return path;

  const cur = path.trail[path.trail.length - 1];
  const [gx, gy] = computeGradient(fn, cur.x, cur.y);

  if (!Number.isFinite(gx) || !Number.isFinite(gy)) {
    return { ...path, converged: true };
  }

  let newX = cur.x;
  let newY = cur.y;
  let newVx = path.vx;
  let newVy = path.vy;
  let newMx = path.mx;
  let newMy = path.my;
  let newAdamVx = path.adamVx;
  let newAdamVy = path.adamVy;
  let newT = path.t;
  let newCacheX = path.cacheX;
  let newCacheY = path.cacheY;

  const beta1 = 0.9;
  const beta2 = 0.999;
  const decay = 0.99;
  const eps = 1e-8;

  switch (path.optimizerId) {
    case "sgd":
      newX -= lr * gx;
      newY -= lr * gy;
      break;

    case "momentum":
      newVx = 0.9 * path.vx - lr * gx;
      newVy = 0.9 * path.vy - lr * gy;
      newX += newVx;
      newY += newVy;
      break;

    case "adam": {
      newT = path.t + 1;
      newMx = beta1 * path.mx + (1 - beta1) * gx;
      newMy = beta1 * path.my + (1 - beta1) * gy;
      newAdamVx = beta2 * path.adamVx + (1 - beta2) * gx * gx;
      newAdamVy = beta2 * path.adamVy + (1 - beta2) * gy * gy;
      const mxHat = newMx / (1 - Math.pow(beta1, newT));
      const myHat = newMy / (1 - Math.pow(beta1, newT));
      const vxHat = newAdamVx / (1 - Math.pow(beta2, newT));
      const vyHat = newAdamVy / (1 - Math.pow(beta2, newT));
      newX -= lr * mxHat / (Math.sqrt(vxHat) + eps);
      newY -= lr * myHat / (Math.sqrt(vyHat) + eps);
      break;
    }

    case "rmsprop": {
      newCacheX = decay * path.cacheX + (1 - decay) * gx * gx;
      newCacheY = decay * path.cacheY + (1 - decay) * gy * gy;
      newX -= lr * gx / (Math.sqrt(newCacheX) + eps);
      newY -= lr * gy / (Math.sqrt(newCacheY) + eps);
      break;
    }
  }

  // Check convergence
  const dx = newX - cur.x;
  const dy = newY - cur.y;
  const converged = dx * dx + dy * dy < CONVERGENCE_THRESHOLD;

  // Clamp to surface bounds (handled externally)
  const newLoss = fn(newX, newY);

  return {
    ...path,
    trail: [...path.trail, { x: newX, y: newY, loss: Number.isFinite(newLoss) ? newLoss : cur.loss }],
    vx: newVx,
    vy: newVy,
    mx: newMx,
    my: newMy,
    adamVx: newAdamVx,
    adamVy: newAdamVy,
    t: newT,
    cacheX: newCacheX,
    cacheY: newCacheY,
    converged,
  };
}

function createPath(optimizerId: string, color: string, x: number, y: number, loss: number): OptimizerPath {
  return {
    optimizerId,
    color,
    trail: [{ x, y, loss }],
    vx: 0,
    vy: 0,
    mx: 0,
    my: 0,
    adamVx: 0,
    adamVy: 0,
    t: 0,
    cacheX: 0,
    cacheY: 0,
    converged: false,
  };
}

// ─────────────────────────────────────────────────────────
// Contour Rendering
// ─────────────────────────────────────────────────────────

function interpolateColor(t: number): [number, number, number] {
  const idx = t * (CONTOUR_COLORS.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, CONTOUR_COLORS.length - 1);
  const frac = idx - lo;
  return [
    CONTOUR_COLORS[lo][0] + (CONTOUR_COLORS[hi][0] - CONTOUR_COLORS[lo][0]) * frac,
    CONTOUR_COLORS[lo][1] + (CONTOUR_COLORS[hi][1] - CONTOUR_COLORS[lo][1]) * frac,
    CONTOUR_COLORS[lo][2] + (CONTOUR_COLORS[hi][2] - CONTOUR_COLORS[lo][2]) * frac,
  ];
}

function computeContourData(surface: SurfaceDef): { imageData: Float64Array; logMin: number; logMax: number } {
  const data = new Float64Array(GRID_RES * GRID_RES);
  let min = Infinity;
  let max = -Infinity;

  for (let iy = 0; iy < GRID_RES; iy++) {
    for (let ix = 0; ix < GRID_RES; ix++) {
      const x = surface.xRange[0] + (ix / (GRID_RES - 1)) * (surface.xRange[1] - surface.xRange[0]);
      const y = surface.yRange[0] + (iy / (GRID_RES - 1)) * (surface.yRange[1] - surface.yRange[0]);
      let val = surface.fn(x, y);
      if (!Number.isFinite(val)) val = 1e6;
      // Use log scale for better visualization
      val = Math.log(Math.abs(val) + 1);
      data[iy * GRID_RES + ix] = val;
      if (val < min) min = val;
      if (val > max) max = val;
    }
  }

  return { imageData: data, logMin: min, logMax: max };
}

function drawContour(
  canvas: HTMLCanvasElement,
  contour: { imageData: Float64Array; logMin: number; logMax: number },
  paths: OptimizerPath[],
  surface: SurfaceDef,
  hoverPos: { x: number; y: number } | null
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const { imageData, logMin, logMax } = contour;
  const range = logMax - logMin || 1;

  // Draw contour as colored grid
  const cellW = w / GRID_RES;
  const cellH = h / GRID_RES;

  const imgData = ctx.createImageData(GRID_RES, GRID_RES);
  for (let iy = 0; iy < GRID_RES; iy++) {
    for (let ix = 0; ix < GRID_RES; ix++) {
      const val = imageData[iy * GRID_RES + ix];
      const t = (val - logMin) / range;
      const [r, g, b] = interpolateColor(t);
      const idx = (iy * GRID_RES + ix) * 4;
      imgData.data[idx] = r;
      imgData.data[idx + 1] = g;
      imgData.data[idx + 2] = b;
      imgData.data[idx + 3] = 255;
    }
  }

  // Scale up the small image
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = GRID_RES;
  tempCanvas.height = GRID_RES;
  const tempCtx = tempCanvas.getContext("2d");
  if (tempCtx) {
    tempCtx.putImageData(imgData, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tempCanvas, 0, 0, w, h);
  }

  // Draw contour lines
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 0.5;
  const nLevels = 15;
  for (let level = 0; level < nLevels; level++) {
    const threshold = logMin + (level / nLevels) * range;
    for (let iy = 0; iy < GRID_RES - 1; iy++) {
      for (let ix = 0; ix < GRID_RES - 1; ix++) {
        const v00 = imageData[iy * GRID_RES + ix];
        const v10 = imageData[iy * GRID_RES + ix + 1];
        const v01 = imageData[(iy + 1) * GRID_RES + ix];
        // Simple marching: draw segment if threshold crosses edge
        if ((v00 < threshold) !== (v10 < threshold) || (v00 < threshold) !== (v01 < threshold)) {
          const cx = (ix / GRID_RES) * w;
          const cy = (iy / GRID_RES) * h;
          ctx.beginPath();
          ctx.arc(cx, cy, 0.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  }

  // Helper to convert surface coords to canvas coords
  const toCanvasX = (x: number) => ((x - surface.xRange[0]) / (surface.xRange[1] - surface.xRange[0])) * w;
  const toCanvasY = (y: number) => ((y - surface.yRange[0]) / (surface.yRange[1] - surface.yRange[0])) * h;

  // Draw optimizer paths
  for (const path of paths) {
    if (path.trail.length < 2) continue;

    // Trail line
    ctx.beginPath();
    ctx.strokeStyle = path.color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9;
    for (let i = 0; i < path.trail.length; i++) {
      const cx = toCanvasX(path.trail[i].x);
      const cy = toCanvasY(path.trail[i].y);
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Start point
    const start = path.trail[0];
    ctx.beginPath();
    ctx.arc(toCanvasX(start.x), toCanvasY(start.y), 4, 0, Math.PI * 2);
    ctx.fillStyle = path.color;
    ctx.globalAlpha = 0.5;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Current point
    const cur = path.trail[path.trail.length - 1];
    ctx.beginPath();
    ctx.arc(toCanvasX(cur.x), toCanvasY(cur.y), 5, 0, Math.PI * 2);
    ctx.fillStyle = path.color;
    ctx.fill();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Hover crosshair
  if (hoverPos) {
    const cx = toCanvasX(hoverPos.x);
    const cy = toCanvasY(hoverPos.y);
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// ─────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────

const btnBase =
  "px-3 py-1.5 text-xs font-medium rounded border transition-colors cursor-pointer";
const btnPrimary = `${btnBase} bg-[var(--color-primary)] text-white border-transparent hover:opacity-90`;
const btnSecondary = `${btnBase} bg-transparent text-[var(--color-text-muted)] border-[var(--color-border)] hover:text-[var(--color-heading)] hover:border-[var(--color-text-muted)]`;
const btnActive = `${btnBase} bg-[var(--color-primary)] text-white border-[var(--color-primary)]`;
const labelStyle = "block text-[10px] font-medium text-[var(--color-text-muted)] mb-1";
const statLabel = "text-[10px] text-[var(--color-text-muted)]";
const statValue = "text-sm font-semibold text-[var(--color-heading)]";

// ─────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────

export default function LossLandscape() {
  const [surfaceIdx, setSurfaceIdx] = useState(0);
  const [selectedOptimizer, setSelectedOptimizer] = useState("sgd");
  const [lr, setLr] = useState(0.01);
  const [paths, setPaths] = useState<OptimizerPath[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const pathsRef = useRef<OptimizerPath[]>([]);

  const surface = SURFACES[surfaceIdx];

  const contourData = useMemo(() => computeContourData(surface), [surfaceIdx]);

  // Keep ref in sync
  useEffect(() => {
    pathsRef.current = paths;
  }, [paths]);

  // Draw
  useEffect(() => {
    if (canvasRef.current) {
      drawContour(canvasRef.current, contourData, paths, surface, hoverPos);
    }
  }, [contourData, paths, surface, hoverPos]);

  // Animation loop
  useEffect(() => {
    if (!isRunning) return;

    let running = true;
    const animate = () => {
      if (!running) return;

      setPaths((prev) => {
        const anyActive = prev.some((p) => !p.converged && p.trail.length < MAX_STEPS);
        if (!anyActive) {
          setIsRunning(false);
          return prev;
        }
        return prev.map((p) => {
          if (p.converged || p.trail.length >= MAX_STEPS) return p;
          // Take multiple steps per frame for smoothness
          let updated = p;
          for (let i = 0; i < 3; i++) {
            updated = stepOptimizer(updated, surface.fn, lr);
          }
          return updated;
        });
      });

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);

    return () => {
      running = false;
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [isRunning, surface, lr]);

  // Handle canvas click
  const handleCanvasClick = useCallback(
    (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;

      const x = surface.xRange[0] + (cx / canvas.width) * (surface.xRange[1] - surface.xRange[0]);
      const y = surface.yRange[0] + (cy / canvas.height) * (surface.yRange[1] - surface.yRange[0]);

      const loss = surface.fn(x, y);
      const opt = OPTIMIZERS.find((o) => o.id === selectedOptimizer)!;
      const newPath = createPath(opt.id, opt.color, x, y, loss);

      setPaths((prev) => [...prev, newPath]);
      setIsRunning(true);
    },
    [surface, selectedOptimizer]
  );

  // Handle mouse move
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;

      const x = surface.xRange[0] + (cx / canvas.width) * (surface.xRange[1] - surface.xRange[0]);
      const y = surface.yRange[0] + (cy / canvas.height) * (surface.yRange[1] - surface.yRange[0]);
      setHoverPos({ x, y });
    },
    [surface]
  );

  const handleMouseLeave = useCallback(() => setHoverPos(null), []);

  const handleClearPaths = useCallback(() => {
    setPaths([]);
    setIsRunning(false);
    if (animRef.current) cancelAnimationFrame(animRef.current);
  }, []);

  const handleChangeSurface = useCallback((idx: number) => {
    setSurfaceIdx(idx);
    setPaths([]);
    setIsRunning(false);
  }, []);

  // Get latest loss values per path
  const pathStats = paths.map((p) => {
    const last = p.trail[p.trail.length - 1];
    return {
      optimizer: OPTIMIZERS.find((o) => o.id === p.optimizerId)?.name ?? p.optimizerId,
      color: p.color,
      loss: last.loss,
      steps: p.trail.length,
      converged: p.converged,
    };
  });

  return (
    <div class="space-y-4">
      {/* Surface selector */}
      <div class="flex flex-wrap gap-2">
        {SURFACES.map((s, i) => (
          <button
            key={s.id}
            class={i === surfaceIdx ? btnActive : btnSecondary}
            onClick={() => handleChangeSurface(i)}
          >
            {s.name}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div class="flex flex-wrap gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div>
          <label class={labelStyle}>Optimizer</label>
          <div class="flex gap-1">
            {OPTIMIZERS.map((o) => (
              <button
                key={o.id}
                class={selectedOptimizer === o.id ? btnActive : btnSecondary}
                onClick={() => setSelectedOptimizer(o.id)}
                style={{
                  borderColor: selectedOptimizer === o.id ? o.color : undefined,
                  background: selectedOptimizer === o.id ? o.color : undefined,
                }}
              >
                {o.name}
              </button>
            ))}
          </div>
        </div>
        <div class="flex-1 min-w-[150px]">
          <label class={labelStyle}>
            Learning Rate: {lr.toFixed(4)}
          </label>
          <input
            type="range"
            min="0.0001"
            max="0.1"
            step="0.0001"
            value={lr}
            onInput={(e) => setLr(parseFloat((e.target as HTMLInputElement).value))}
            class="w-full accent-[var(--color-primary)]"
          />
        </div>
        <div class="flex items-end">
          <button class={btnSecondary} onClick={handleClearPaths}>
            Clear Paths
          </button>
        </div>
      </div>

      <div class="text-xs text-[var(--color-text-muted)] -mt-2">
        Click anywhere on the surface to place a starting point. The selected optimizer will trace a path.
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Canvas */}
        <div class="lg:col-span-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            class="w-full cursor-crosshair"
            style={{ imageRendering: "auto" }}
            onClick={handleCanvasClick}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          />
          {/* Hover info */}
          {hoverPos && (
            <div class="text-[10px] text-[var(--color-text-muted)] px-1 mt-1">
              ({hoverPos.x.toFixed(2)}, {hoverPos.y.toFixed(2)}) | Loss: {surface.fn(hoverPos.x, hoverPos.y).toFixed(4)}
            </div>
          )}
        </div>

        {/* Side panel */}
        <div class="space-y-3">
          {/* Legend */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div class={statLabel}>Optimizer Legend</div>
            <div class="space-y-1.5 mt-1">
              {OPTIMIZERS.map((o) => (
                <div key={o.id} class="flex items-center gap-2">
                  <span
                    class="inline-block w-3 h-3 rounded-full"
                    style={{ background: o.color }}
                  />
                  <span class="text-xs text-[var(--color-text)]">{o.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Active paths */}
          {pathStats.length > 0 && (
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <div class={statLabel}>Active Paths</div>
              <div class="space-y-2 mt-1">
                {pathStats.map((ps, i) => (
                  <div key={i} class="flex items-center gap-2">
                    <span
                      class="inline-block w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: ps.color }}
                    />
                    <div class="flex-1 min-w-0">
                      <div class="text-[10px] text-[var(--color-heading)] truncate">
                        {ps.optimizer}
                      </div>
                      <div class="text-[10px] text-[var(--color-text-muted)]">
                        Loss: {ps.loss.toFixed(4)} | Steps: {ps.steps}
                        {ps.converged && " (converged)"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Surface info */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div class={statLabel}>Surface</div>
            <div class={statValue}>{surface.name}</div>
            <div class="text-[10px] text-[var(--color-text-muted)] mt-0.5">
              x: [{surface.xRange[0]}, {surface.xRange[1]}]<br />
              y: [{surface.yRange[0]}, {surface.yRange[1]}]
            </div>
          </div>

          {/* Loss chart for active paths */}
          {paths.length > 0 && (
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <div class={statLabel}>Loss Over Steps</div>
              <div class="h-20 mt-1 relative">
                <canvas
                  width={200}
                  height={80}
                  class="w-full h-full"
                  ref={(el) => {
                    if (!el) return;
                    const ctx = el.getContext("2d");
                    if (!ctx) return;
                    ctx.clearRect(0, 0, 200, 80);

                    const allLosses = paths.flatMap((p) => p.trail.map((t) => t.loss));
                    const maxLoss = Math.max(...allLosses.filter(Number.isFinite));
                    const minLoss = Math.min(...allLosses.filter(Number.isFinite));
                    const range = maxLoss - minLoss || 1;
                    const maxSteps = Math.max(...paths.map((p) => p.trail.length));

                    for (const path of paths) {
                      ctx.beginPath();
                      ctx.strokeStyle = path.color;
                      ctx.lineWidth = 1.5;
                      ctx.globalAlpha = 0.8;
                      for (let i = 0; i < path.trail.length; i++) {
                        const x = (i / Math.max(maxSteps - 1, 1)) * 200;
                        const y = 80 - ((path.trail[i].loss - minLoss) / range) * 75 - 2;
                        if (i === 0) ctx.moveTo(x, y);
                        else ctx.lineTo(x, y);
                      }
                      ctx.stroke();
                      ctx.globalAlpha = 1;
                    }
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Info */}
      <div class="text-xs text-[var(--color-text-muted)] leading-relaxed">
        Explore how different optimization algorithms navigate loss surfaces. SGD follows
        the raw gradient. Momentum adds velocity to escape saddle points. Adam adapts
        learning rates per-parameter. RMSProp scales gradients by running average of
        squared gradients. Try placing multiple starting points with different optimizers
        to compare convergence behavior.
      </div>
    </div>
  );
}
