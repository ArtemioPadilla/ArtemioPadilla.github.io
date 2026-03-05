import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "preact/hooks";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

interface LossSurface {
  name: string;
  fn: (x: number, y: number) => number;
  xRange: [number, number];
  yRange: [number, number];
  defaultStart: [number, number];
}

interface OptimizerDef {
  id: string;
  name: string;
  color: string;
}

interface OptimizerState {
  id: string;
  x: number;
  y: number;
  loss: number;
  trail: Array<[number, number]>;
  // Momentum state
  vx: number;
  vy: number;
  // Adam state
  mx: number;
  my: number;
  adamVx: number;
  adamVy: number;
  t: number;
  // AdaGrad / RMSProp state
  cacheX: number;
  cacheY: number;
  converged: boolean;
}

// ─────────────────────────────────────────────────────────
// Loss Surface Functions
// ─────────────────────────────────────────────────────────

const LOSS_SURFACES: LossSurface[] = [
  {
    name: "Himmelblau",
    fn: (x, y) => (x * x + y - 11) ** 2 + (x + y * y - 7) ** 2,
    xRange: [-5, 5],
    yRange: [-5, 5],
    defaultStart: [-4, -4],
  },
  {
    name: "Rosenbrock",
    fn: (x, y) => (1 - x) ** 2 + 100 * (y - x * x) ** 2,
    xRange: [-2, 2],
    yRange: [-1, 3],
    defaultStart: [-1.5, 2],
  },
  {
    name: "Beale",
    fn: (x, y) =>
      (1.5 - x + x * y) ** 2 +
      (2.25 - x + x * y * y) ** 2 +
      (2.625 - x + x * y * y * y) ** 2,
    xRange: [-4.5, 4.5],
    yRange: [-4.5, 4.5],
    defaultStart: [-3, -3],
  },
  {
    name: "Saddle Point",
    fn: (x, y) => x * x - y * y,
    xRange: [-3, 3],
    yRange: [-3, 3],
    defaultStart: [0.5, 0.05],
  },
  {
    name: "Bowl (Quadratic)",
    fn: (x, y) => x * x + y * y,
    xRange: [-4, 4],
    yRange: [-4, 4],
    defaultStart: [3, 3],
  },
  {
    name: "Rastrigin",
    fn: (x, y) =>
      20 +
      x * x -
      10 * Math.cos(2 * Math.PI * x) +
      y * y -
      10 * Math.cos(2 * Math.PI * y),
    xRange: [-5.12, 5.12],
    yRange: [-5.12, 5.12],
    defaultStart: [4, 4],
  },
];

// ─────────────────────────────────────────────────────────
// Optimizer Definitions
// ─────────────────────────────────────────────────────────

const OPTIMIZERS: OptimizerDef[] = [
  { id: "sgd", name: "SGD", color: "#4f8ff7" },
  { id: "momentum", name: "Momentum", color: "#34d399" },
  { id: "adam", name: "Adam", color: "#f59e0b" },
  { id: "adagrad", name: "AdaGrad", color: "#ef4444" },
  { id: "rmsprop", name: "RMSProp", color: "#a855f7" },
];

const TRAIL_LENGTH = 50;
const GRID_SIZE = 200;
const GRADIENT_H = 1e-5;
const POSITION_CAP = 1e6;
const CONVERGENCE_THRESHOLD = 1e-10;

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
// Optimizer Step Functions
// ─────────────────────────────────────────────────────────

function stepOptimizer(
  state: OptimizerState,
  fn: (x: number, y: number) => number,
  lr: number,
  momentum: number,
  beta1: number,
  beta2: number,
  decay: number
): OptimizerState {
  if (state.converged) return state;

  const [gx, gy] = computeGradient(fn, state.x, state.y);

  if (!Number.isFinite(gx) || !Number.isFinite(gy)) {
    return { ...state, converged: true };
  }

  let newX = state.x;
  let newY = state.y;
  let newVx = state.vx;
  let newVy = state.vy;
  let newMx = state.mx;
  let newMy = state.my;
  let newAdamVx = state.adamVx;
  let newAdamVy = state.adamVy;
  let newT = state.t;
  let newCacheX = state.cacheX;
  let newCacheY = state.cacheY;

  switch (state.id) {
    case "sgd":
      newX -= lr * gx;
      newY -= lr * gy;
      break;

    case "momentum":
      newVx = momentum * state.vx - lr * gx;
      newVy = momentum * state.vy - lr * gy;
      newX += newVx;
      newY += newVy;
      break;

    case "adam": {
      newT = state.t + 1;
      newMx = beta1 * state.mx + (1 - beta1) * gx;
      newMy = beta1 * state.my + (1 - beta1) * gy;
      newAdamVx = beta2 * state.adamVx + (1 - beta2) * gx * gx;
      newAdamVy = beta2 * state.adamVy + (1 - beta2) * gy * gy;
      const mxHat = newMx / (1 - Math.pow(beta1, newT));
      const myHat = newMy / (1 - Math.pow(beta1, newT));
      const vxHat = newAdamVx / (1 - Math.pow(beta2, newT));
      const vyHat = newAdamVy / (1 - Math.pow(beta2, newT));
      newX -= lr * mxHat / (Math.sqrt(vxHat) + 1e-8);
      newY -= lr * myHat / (Math.sqrt(vyHat) + 1e-8);
      break;
    }

    case "adagrad":
      newCacheX = state.cacheX + gx * gx;
      newCacheY = state.cacheY + gy * gy;
      newX -= lr * gx / (Math.sqrt(newCacheX) + 1e-8);
      newY -= lr * gy / (Math.sqrt(newCacheY) + 1e-8);
      break;

    case "rmsprop":
      newCacheX = decay * state.cacheX + (1 - decay) * gx * gx;
      newCacheY = decay * state.cacheY + (1 - decay) * gy * gy;
      newX -= lr * gx / (Math.sqrt(newCacheX) + 1e-8);
      newY -= lr * gy / (Math.sqrt(newCacheY) + 1e-8);
      break;
  }

  // Cap positions to prevent divergence
  newX = Math.max(-POSITION_CAP, Math.min(POSITION_CAP, newX));
  newY = Math.max(-POSITION_CAP, Math.min(POSITION_CAP, newY));

  if (!Number.isFinite(newX) || !Number.isFinite(newY)) {
    return { ...state, converged: true };
  }

  const newLoss = fn(newX, newY);
  const converged =
    Math.abs(newX - state.x) < CONVERGENCE_THRESHOLD &&
    Math.abs(newY - state.y) < CONVERGENCE_THRESHOLD;

  const newTrail = [...state.trail, [state.x, state.y] as [number, number]];
  if (newTrail.length > TRAIL_LENGTH) {
    newTrail.shift();
  }

  return {
    ...state,
    x: newX,
    y: newY,
    loss: Number.isFinite(newLoss) ? newLoss : state.loss,
    trail: newTrail,
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

// ─────────────────────────────────────────────────────────
// Color Ramp (blue -> cyan -> green -> yellow -> red)
// ─────────────────────────────────────────────────────────

function valueToColor(t: number): [number, number, number] {
  // t is normalized 0..1
  const clamped = Math.max(0, Math.min(1, t));

  // 5-stop gradient
  const stops = [
    { pos: 0.0, r: 15, g: 32, b: 80 },    // deep blue
    { pos: 0.25, r: 20, g: 120, b: 180 },  // cyan-blue
    { pos: 0.5, r: 30, g: 180, b: 100 },   // green
    { pos: 0.75, r: 240, g: 200, b: 40 },  // yellow
    { pos: 1.0, r: 200, g: 30, b: 30 },    // red
  ];

  let lower = stops[0];
  let upper = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (clamped >= stops[i].pos && clamped <= stops[i + 1].pos) {
      lower = stops[i];
      upper = stops[i + 1];
      break;
    }
  }

  const range = upper.pos - lower.pos;
  const f = range === 0 ? 0 : (clamped - lower.pos) / range;
  return [
    Math.round(lower.r + f * (upper.r - lower.r)),
    Math.round(lower.g + f * (upper.g - lower.g)),
    Math.round(lower.b + f * (upper.b - lower.b)),
  ];
}

// ─────────────────────────────────────────────────────────
// Heatmap Computation (cached)
// ─────────────────────────────────────────────────────────

function computeHeatmapData(
  fn: (x: number, y: number) => number,
  xRange: [number, number],
  yRange: [number, number],
  width: number,
  height: number
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  const values: number[] = new Array(width * height);

  // Compute raw values
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const x = xRange[0] + (px / (width - 1)) * (xRange[1] - xRange[0]);
      const y = yRange[0] + (py / (height - 1)) * (yRange[1] - yRange[0]);
      const val = fn(x, y);
      values[py * width + px] = Number.isFinite(val) ? val : 0;
    }
  }

  // Use log scale for normalization
  let minVal = values[0];
  let maxVal = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] < minVal) minVal = values[i];
    if (values[i] > maxVal) maxVal = values[i];
  }
  const logMin = Math.log1p(0);
  const logMax = Math.log1p(Math.max(0, maxVal - minVal));
  const logRange = logMax - logMin || 1;

  for (let i = 0; i < values.length; i++) {
    const logVal = Math.log1p(Math.max(0, values[i] - minVal));
    const t = (logVal - logMin) / logRange;
    const [r, g, b] = valueToColor(t);
    const idx = i * 4;
    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = 255;
  }

  return data;
}

// ─────────────────────────────────────────────────────────
// Contour Lines
// ─────────────────────────────────────────────────────────

function drawContourLines(
  ctx: CanvasRenderingContext2D,
  fn: (x: number, y: number) => number,
  xRange: [number, number],
  yRange: [number, number],
  canvasWidth: number,
  canvasHeight: number,
  numLevels: number
) {
  const gridW = 100;
  const gridH = 100;
  const vals: number[][] = [];

  for (let j = 0; j <= gridH; j++) {
    vals[j] = [];
    for (let i = 0; i <= gridW; i++) {
      const x = xRange[0] + (i / gridW) * (xRange[1] - xRange[0]);
      const y = yRange[0] + (j / gridH) * (yRange[1] - yRange[0]);
      const v = fn(x, y);
      vals[j][i] = Number.isFinite(v) ? v : 0;
    }
  }

  // Compute levels using log spacing
  const allVals: number[] = [];
  for (let j = 0; j <= gridH; j++) {
    for (let i = 0; i <= gridW; i++) {
      allVals.push(vals[j][i]);
    }
  }
  allVals.sort((a, b) => a - b);

  const levels: number[] = [];
  for (let k = 1; k <= numLevels; k++) {
    const idx = Math.floor((k / (numLevels + 1)) * allVals.length);
    levels.push(allVals[Math.min(idx, allVals.length - 1)]);
  }

  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 0.5;

  for (const level of levels) {
    for (let j = 0; j < gridH; j++) {
      for (let i = 0; i < gridW; i++) {
        const v00 = vals[j][i];
        const v10 = vals[j][i + 1];
        const v01 = vals[j + 1][i];
        const v11 = vals[j + 1][i + 1];

        const points: Array<[number, number]> = [];

        // Check each edge for crossing
        if ((v00 - level) * (v10 - level) < 0) {
          const t = (level - v00) / (v10 - v00);
          points.push([i + t, j]);
        }
        if ((v10 - level) * (v11 - level) < 0) {
          const t = (level - v10) / (v11 - v10);
          points.push([i + 1, j + t]);
        }
        if ((v01 - level) * (v11 - level) < 0) {
          const t = (level - v01) / (v11 - v01);
          points.push([i + t, j + 1]);
        }
        if ((v00 - level) * (v01 - level) < 0) {
          const t = (level - v00) / (v01 - v00);
          points.push([i, j + t]);
        }

        if (points.length >= 2) {
          const px1 = (points[0][0] / gridW) * canvasWidth;
          const py1 = (points[0][1] / gridH) * canvasHeight;
          const px2 = (points[1][0] / gridW) * canvasWidth;
          const py2 = (points[1][1] / gridH) * canvasHeight;

          ctx.beginPath();
          ctx.moveTo(px1, py1);
          ctx.lineTo(px2, py2);
          ctx.stroke();
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────
// Gradient Arrows
// ─────────────────────────────────────────────────────────

function drawGradientArrows(
  ctx: CanvasRenderingContext2D,
  fn: (x: number, y: number) => number,
  xRange: [number, number],
  yRange: [number, number],
  canvasWidth: number,
  canvasHeight: number
) {
  const spacing = 8;
  const arrowLen = 12;

  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 0.8;

  for (let gj = 1; gj < spacing; gj++) {
    for (let gi = 1; gi < spacing; gi++) {
      const px = (gi / spacing) * canvasWidth;
      const py = (gj / spacing) * canvasHeight;
      const x = xRange[0] + (gi / spacing) * (xRange[1] - xRange[0]);
      const y = yRange[0] + (gj / spacing) * (yRange[1] - yRange[0]);

      const [gx, gy] = computeGradient(fn, x, y);
      const mag = Math.sqrt(gx * gx + gy * gy);

      if (mag < 1e-10 || !Number.isFinite(mag)) continue;

      // Normalized direction (pointing downhill = negative gradient)
      const dx = (-gx / mag) * arrowLen;
      const dy = (-gy / mag) * arrowLen;

      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + dx, py + dy);
      ctx.stroke();

      // Arrowhead
      const headLen = 3;
      const angle = Math.atan2(dy, dx);
      ctx.beginPath();
      ctx.moveTo(px + dx, py + dy);
      ctx.lineTo(
        px + dx - headLen * Math.cos(angle - Math.PI / 6),
        py + dy - headLen * Math.sin(angle - Math.PI / 6)
      );
      ctx.moveTo(px + dx, py + dy);
      ctx.lineTo(
        px + dx - headLen * Math.cos(angle + Math.PI / 6),
        py + dy - headLen * Math.sin(angle + Math.PI / 6)
      );
      ctx.stroke();
    }
  }
}

// ─────────────────────────────────────────────────────────
// Create Initial Optimizer State
// ─────────────────────────────────────────────────────────

function createOptimizerState(
  id: string,
  x: number,
  y: number,
  fn: (x: number, y: number) => number
): OptimizerState {
  return {
    id,
    x,
    y,
    loss: fn(x, y),
    trail: [],
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
// Main Component
// ─────────────────────────────────────────────────────────

const CANVAS_ASPECT = 1;
const DEFAULT_ACTIVE = ["sgd", "momentum", "adam"];

export default function GradientDescent() {
  // --- State ---
  const [surfaceIndex, setSurfaceIndex] = useState(0);
  const [activeOptimizers, setActiveOptimizers] = useState<string[]>(DEFAULT_ACTIVE);
  const [lr, setLr] = useState(0.01);
  const [momentumVal, setMomentumVal] = useState(0.9);
  const [beta1, setBeta1] = useState(0.9);
  const [beta2, setBeta2] = useState(0.999);
  const [rmspropDecay] = useState(0.9);
  const [stepsPerFrame, setStepsPerFrame] = useState(1);
  const [showContours, setShowContours] = useState(true);
  const [showArrows, setShowArrows] = useState(false);
  const [running, setRunning] = useState(false);
  const [stepCount, setStepCount] = useState(0);
  const [optimizerStates, setOptimizerStates] = useState<OptimizerState[]>([]);
  const [canvasSize, setCanvasSize] = useState(500);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const heatmapCacheRef = useRef<{ key: string; data: Uint8ClampedArray } | null>(null);
  const animFrameRef = useRef<number>(0);
  const runningRef = useRef(false);
  const statesRef = useRef<OptimizerState[]>([]);
  const stepCountRef = useRef(0);

  const surface = LOSS_SURFACES[surfaceIndex];

  // Keep refs in sync with state
  useEffect(() => {
    runningRef.current = running;
  }, [running]);
  useEffect(() => {
    statesRef.current = optimizerStates;
  }, [optimizerStates]);
  useEffect(() => {
    stepCountRef.current = stepCount;
  }, [stepCount]);

  // --- Responsive canvas sizing ---
  useEffect(() => {
    function handleResize() {
      if (containerRef.current) {
        const width = containerRef.current.clientWidth;
        setCanvasSize(width);
      }
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // --- Initialize optimizer states on surface/start change ---
  const initializeOptimizers = useCallback(
    (startX?: number, startY?: number) => {
      const sx = startX ?? surface.defaultStart[0];
      const sy = startY ?? surface.defaultStart[1];
      const states = activeOptimizers.map((id) =>
        createOptimizerState(id, sx, sy, surface.fn)
      );
      setOptimizerStates(states);
      statesRef.current = states;
      setStepCount(0);
      stepCountRef.current = 0;
    },
    [activeOptimizers, surface]
  );

  // Re-initialize when surface or active optimizers change
  useEffect(() => {
    setRunning(false);
    initializeOptimizers();
  }, [surfaceIndex, activeOptimizers]);

  // --- Heatmap cache (returns raw pixel data, SSR-safe) ---
  const getHeatmapData = useCallback((): Uint8ClampedArray => {
    const key = `${surface.name}-${GRID_SIZE}`;
    if (heatmapCacheRef.current?.key === key) {
      return heatmapCacheRef.current.data;
    }
    const data = computeHeatmapData(
      surface.fn,
      surface.xRange,
      surface.yRange,
      GRID_SIZE,
      GRID_SIZE
    );
    heatmapCacheRef.current = { key, data };
    return data;
  }, [surface]);

  // --- Canvas rendering ---
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Draw heatmap (scaled from GRID_SIZE to canvas size)
    const heatmapPixels = getHeatmapData();
    const offscreen = document.createElement("canvas");
    offscreen.width = GRID_SIZE;
    offscreen.height = GRID_SIZE;
    const offCtx = offscreen.getContext("2d");
    if (offCtx) {
      const imageData = offCtx.createImageData(GRID_SIZE, GRID_SIZE);
      imageData.data.set(heatmapPixels);
      offCtx.putImageData(imageData, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(offscreen, 0, 0, w, h);
    }

    // Draw contour lines
    if (showContours) {
      drawContourLines(ctx, surface.fn, surface.xRange, surface.yRange, w, h, 15);
    }

    // Draw gradient arrows
    if (showArrows) {
      drawGradientArrows(ctx, surface.fn, surface.xRange, surface.yRange, w, h);
    }

    // Helper: world coords to canvas pixels
    const toCanvas = (wx: number, wy: number): [number, number] => [
      ((wx - surface.xRange[0]) / (surface.xRange[1] - surface.xRange[0])) * w,
      ((wy - surface.yRange[0]) / (surface.yRange[1] - surface.yRange[0])) * h,
    ];

    // Draw optimizer trails and particles
    const states = statesRef.current;
    for (const state of states) {
      const opt = OPTIMIZERS.find((o) => o.id === state.id);
      if (!opt) continue;

      // Trail
      if (state.trail.length > 1) {
        for (let i = 1; i < state.trail.length; i++) {
          const alpha = (i / state.trail.length) * 0.8;
          ctx.strokeStyle = opt.color + Math.round(alpha * 255).toString(16).padStart(2, "0");
          ctx.lineWidth = 2;
          ctx.beginPath();
          const [px1, py1] = toCanvas(state.trail[i - 1][0], state.trail[i - 1][1]);
          const [px2, py2] = toCanvas(state.trail[i][0], state.trail[i][1]);
          ctx.moveTo(px1, py1);
          ctx.lineTo(px2, py2);
          ctx.stroke();
        }

        // Line from last trail point to current position
        if (state.trail.length > 0) {
          const lastTrail = state.trail[state.trail.length - 1];
          ctx.strokeStyle = opt.color + "cc";
          ctx.lineWidth = 2;
          ctx.beginPath();
          const [px1, py1] = toCanvas(lastTrail[0], lastTrail[1]);
          const [px2, py2] = toCanvas(state.x, state.y);
          ctx.moveTo(px1, py1);
          ctx.lineTo(px2, py2);
          ctx.stroke();
        }
      }

      // Current position (particle dot)
      const [cx, cy] = toCanvas(state.x, state.y);
      // Outer glow
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.fillStyle = opt.color + "40";
      ctx.fill();
      // Inner dot
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fillStyle = opt.color;
      ctx.fill();
      // White outline
      ctx.strokeStyle = "#ffffff88";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Axis labels
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`x: ${surface.xRange[0]}`, 4, h - 4);
    ctx.textAlign = "right";
    ctx.fillText(`x: ${surface.xRange[1]}`, w - 4, h - 4);
    ctx.textAlign = "left";
    ctx.fillText(`y: ${surface.yRange[0]}`, 4, 14);
    ctx.textAlign = "left";
    ctx.fillText(`y: ${surface.yRange[1]}`, 4, h - 16);
  }, [getHeatmapData, surface, showContours, showArrows]);

  // --- Animation loop ---
  useEffect(() => {
    let lastTimestamp = 0;
    const TARGET_INTERVAL = 1000 / 60; // 60fps

    function animate(timestamp: number) {
      if (!runningRef.current) {
        renderCanvas();
        return;
      }

      if (timestamp - lastTimestamp >= TARGET_INTERVAL) {
        lastTimestamp = timestamp;

        // Perform steps
        let states = statesRef.current;
        let count = stepCountRef.current;

        for (let s = 0; s < stepsPerFrame; s++) {
          states = states.map((st) =>
            stepOptimizer(st, surface.fn, lr, momentumVal, beta1, beta2, rmspropDecay)
          );
          count++;
        }

        statesRef.current = states;
        stepCountRef.current = count;
        setOptimizerStates(states);
        setStepCount(count);

        renderCanvas();

        // Stop if all converged
        if (states.every((s) => s.converged)) {
          setRunning(false);
          return;
        }
      }

      animFrameRef.current = requestAnimationFrame(animate);
    }

    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [running, stepsPerFrame, surface, lr, momentumVal, beta1, beta2, rmspropDecay, renderCanvas]);

  // Re-render when not running but state changes (contours, arrows)
  useEffect(() => {
    if (!running) {
      renderCanvas();
    }
  }, [showContours, showArrows, canvasSize, optimizerStates, renderCanvas, running]);

  // --- Canvas click handler ---
  const handleCanvasClick = useCallback(
    (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      const x =
        surface.xRange[0] +
        ((px * scaleX) / canvas.width) * (surface.xRange[1] - surface.xRange[0]);
      const y =
        surface.yRange[0] +
        ((py * scaleY) / canvas.height) * (surface.yRange[1] - surface.yRange[0]);

      setRunning(false);
      initializeOptimizers(x, y);
    },
    [surface, initializeOptimizers]
  );

  // --- Optimizer toggle ---
  const toggleOptimizer = useCallback(
    (id: string) => {
      setActiveOptimizers((prev) => {
        if (prev.includes(id)) {
          if (prev.length <= 1) return prev; // Keep at least one
          return prev.filter((o) => o !== id);
        }
        return [...prev, id];
      });
    },
    []
  );

  // --- Log scale slider conversion ---
  const lrToSlider = (val: number) =>
    ((Math.log10(val) - Math.log10(0.0001)) /
      (Math.log10(1.0) - Math.log10(0.0001))) *
    100;
  const sliderToLr = (val: number) =>
    Math.pow(
      10,
      Math.log10(0.0001) +
        (val / 100) * (Math.log10(1.0) - Math.log10(0.0001))
    );

  // --- Find best optimizer ---
  const bestOptimizer = useMemo(() => {
    if (optimizerStates.length === 0) return null;
    return optimizerStates.reduce((best, s) =>
      s.loss < best.loss ? s : best
    );
  }, [optimizerStates]);

  const canvasPixelSize = Math.round(canvasSize * CANVAS_ASPECT);

  return (
    <div class="gd-root overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Toolbar */}
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-[var(--color-text-muted)]">
            Gradient Descent Animator
          </span>
          <span class="rounded-full border border-[var(--color-primary)]/30 px-2 py-0.5 text-[10px] font-semibold text-[var(--color-primary)]">
            beta
          </span>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-xs text-[var(--color-text-muted)]">Surface:</label>
          <select
            class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-text)] outline-none"
            value={surfaceIndex}
            onChange={(e) => setSurfaceIndex(Number((e.target as HTMLSelectElement).value))}
          >
            {LOSS_SURFACES.map((s, i) => (
              <option key={s.name} value={i}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Optimizer toggles */}
      <div class="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
        <span class="text-xs text-[var(--color-text-muted)]">Optimizers:</span>
        {OPTIMIZERS.map((opt) => {
          const isActive = activeOptimizers.includes(opt.id);
          return (
            <button
              key={opt.id}
              onClick={() => toggleOptimizer(opt.id)}
              class="gd-opt-toggle flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all"
              style={{
                background: isActive ? opt.color + "20" : "transparent",
                border: `1px solid ${isActive ? opt.color + "60" : "var(--color-border)"}`,
                color: isActive ? opt.color : "var(--color-text-muted)",
              }}
            >
              <span
                class="inline-block h-2.5 w-2.5 rounded-full"
                style={{
                  background: isActive ? opt.color : "var(--color-border)",
                }}
              />
              {opt.name}
            </button>
          );
        })}
      </div>

      {/* Main layout: canvas + controls */}
      <div class="grid grid-cols-1 md:grid-cols-[1fr_280px]">
        {/* Canvas */}
        <div
          ref={containerRef}
          class="relative border-b border-[var(--color-border)] md:border-b-0 md:border-r"
        >
          <canvas
            ref={canvasRef}
            width={canvasPixelSize}
            height={canvasPixelSize}
            onClick={handleCanvasClick}
            class="gd-canvas block w-full cursor-crosshair"
            style={{ aspectRatio: "1 / 1" }}
          />
          {/* Click hint overlay */}
          {stepCount === 0 && !running && (
            <div class="pointer-events-none absolute bottom-3 left-0 right-0 text-center">
              <span class="rounded-full bg-black/60 px-3 py-1 text-[10px] text-white/70">
                Click to set starting position
              </span>
            </div>
          )}
        </div>

        {/* Controls sidebar */}
        <div class="flex flex-col gap-0">
          {/* Controls */}
          <div class="border-b border-[var(--color-border)] p-4">
            <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
              Controls
            </h3>

            {/* Learning Rate */}
            <div class="mb-3">
              <div class="mb-1 flex items-center justify-between">
                <label class="text-[11px] text-[var(--color-text-muted)]">Learning Rate</label>
                <span class="font-mono text-[11px] text-[var(--color-heading)]">
                  {lr < 0.001 ? lr.toExponential(1) : lr.toFixed(4)}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="0.5"
                value={lrToSlider(lr)}
                onInput={(e) => setLr(sliderToLr(Number((e.target as HTMLInputElement).value)))}
                class="gd-slider w-full"
              />
            </div>

            {/* Momentum (conditional) */}
            {activeOptimizers.includes("momentum") && (
              <div class="mb-3">
                <div class="mb-1 flex items-center justify-between">
                  <label class="text-[11px] text-[var(--color-text-muted)]">Momentum</label>
                  <span class="font-mono text-[11px] text-[var(--color-heading)]">
                    {momentumVal.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="99"
                  step="1"
                  value={Math.round(momentumVal * 100)}
                  onInput={(e) =>
                    setMomentumVal(Number((e.target as HTMLInputElement).value) / 100)
                  }
                  class="gd-slider w-full"
                />
              </div>
            )}

            {/* Beta1 (Adam) */}
            {activeOptimizers.includes("adam") && (
              <div class="mb-3">
                <div class="mb-1 flex items-center justify-between">
                  <label class="text-[11px] text-[var(--color-text-muted)]">
                    Beta1 <span class="text-[9px] opacity-50">(Adam)</span>
                  </label>
                  <span class="font-mono text-[11px] text-[var(--color-heading)]">
                    {beta1.toFixed(3)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="999"
                  step="1"
                  value={Math.round(beta1 * 1000)}
                  onInput={(e) =>
                    setBeta1(Number((e.target as HTMLInputElement).value) / 1000)
                  }
                  class="gd-slider w-full"
                />
              </div>
            )}

            {/* Beta2 (Adam) */}
            {activeOptimizers.includes("adam") && (
              <div class="mb-3">
                <div class="mb-1 flex items-center justify-between">
                  <label class="text-[11px] text-[var(--color-text-muted)]">
                    Beta2 <span class="text-[9px] opacity-50">(Adam)</span>
                  </label>
                  <span class="font-mono text-[11px] text-[var(--color-heading)]">
                    {beta2.toFixed(3)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="999"
                  step="1"
                  value={Math.round(beta2 * 1000)}
                  onInput={(e) =>
                    setBeta2(Number((e.target as HTMLInputElement).value) / 1000)
                  }
                  class="gd-slider w-full"
                />
              </div>
            )}

            {/* Steps per frame */}
            <div class="mb-3">
              <div class="mb-1 flex items-center justify-between">
                <label class="text-[11px] text-[var(--color-text-muted)]">Steps / Frame</label>
                <span class="font-mono text-[11px] text-[var(--color-heading)]">
                  {stepsPerFrame}
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                step="1"
                value={stepsPerFrame}
                onInput={(e) =>
                  setStepsPerFrame(Number((e.target as HTMLInputElement).value))
                }
                class="gd-slider w-full"
              />
            </div>

            {/* Toggles */}
            <div class="mb-4 flex flex-wrap gap-3">
              <label class="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                <input
                  type="checkbox"
                  checked={showContours}
                  onChange={() => setShowContours((p) => !p)}
                  class="gd-checkbox"
                />
                Contours
              </label>
              <label class="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                <input
                  type="checkbox"
                  checked={showArrows}
                  onChange={() => setShowArrows((p) => !p)}
                  class="gd-checkbox"
                />
                Gradient arrows
              </label>
            </div>

            {/* Action buttons */}
            <div class="flex items-center gap-2">
              <button
                onClick={() => setRunning((p) => !p)}
                class="gd-btn-primary flex-1 rounded-lg px-4 py-2 text-xs font-semibold text-white transition-all"
              >
                {running ? "Pause" : stepCount > 0 ? "Resume" : "Start"}
              </button>
              <button
                onClick={() => {
                  setRunning(false);
                  initializeOptimizers();
                }}
                class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)]/30 hover:text-[var(--color-heading)]"
              >
                Reset
              </button>
            </div>

            {/* Step counter */}
            <div class="mt-3 text-center text-[11px] text-[var(--color-text-muted)]">
              Step: <span class="font-mono text-[var(--color-heading)]">{stepCount}</span>
            </div>
          </div>

          {/* Legend */}
          <div class="p-4">
            <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
              Legend
            </h3>
            <div class="space-y-2">
              {optimizerStates.map((state) => {
                const opt = OPTIMIZERS.find((o) => o.id === state.id);
                if (!opt) return null;
                const isBest = bestOptimizer?.id === state.id && optimizerStates.length > 1;
                return (
                  <div
                    key={state.id}
                    class="rounded-lg px-2.5 py-1.5 transition-colors"
                    style={{
                      background: isBest ? opt.color + "15" : "transparent",
                      border: `1px solid ${isBest ? opt.color + "40" : "transparent"}`,
                    }}
                  >
                    <div class="flex items-center gap-2">
                      <span
                        class="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: opt.color }}
                      />
                      <span class="text-[11px] font-medium" style={{ color: opt.color }}>
                        {opt.name}
                      </span>
                      {isBest && (
                        <span class="ml-auto text-[9px] font-semibold uppercase tracking-wider text-[var(--color-accent)]">
                          best
                        </span>
                      )}
                      {state.converged && (
                        <span class="ml-auto text-[9px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                          converged
                        </span>
                      )}
                    </div>
                    <div class="mt-0.5 pl-[18px] font-mono text-[10px] text-[var(--color-text-muted)]">
                      ({state.x.toFixed(3)}, {state.y.toFixed(3)})
                      <span class="mx-1 opacity-40">|</span>
                      loss: {formatLoss(state.loss)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .gd-canvas {
          image-rendering: auto;
        }
        .gd-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          border-radius: 2px;
          background: var(--color-border);
          outline: none;
        }
        .gd-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--color-primary);
          cursor: pointer;
          border: 2px solid var(--color-surface);
          box-shadow: 0 0 4px rgba(79, 143, 247, 0.3);
        }
        .gd-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--color-primary);
          cursor: pointer;
          border: 2px solid var(--color-surface);
        }
        .gd-checkbox {
          accent-color: var(--color-primary);
          cursor: pointer;
        }
        .gd-btn-primary {
          background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
        }
        .gd-btn-primary:hover {
          filter: brightness(1.1);
          box-shadow: 0 0 20px color-mix(in srgb, var(--color-primary) 40%, transparent);
        }
        .gd-opt-toggle:hover {
          filter: brightness(1.1);
        }
        .gd-root:focus {
          outline: none;
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function formatLoss(val: number): string {
  if (!Number.isFinite(val)) return "NaN";
  if (Math.abs(val) > 1e6) return val.toExponential(2);
  if (Math.abs(val) < 0.001 && val !== 0) return val.toExponential(2);
  return val.toFixed(3);
}
