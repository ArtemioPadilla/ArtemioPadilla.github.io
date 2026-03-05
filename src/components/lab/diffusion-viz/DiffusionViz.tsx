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

interface Point {
  x: number;
  y: number;
  /** Preserved color index (0-1) based on original position */
  colorIndex: number;
}

type ShapeId = "circle" | "two-moons" | "swiss-roll" | "grid" | "smiley" | "heart";

interface ShapePreset {
  id: ShapeId;
  name: string;
  generate: (n: number) => Point[];
}

type NoiseSchedule = "linear" | "cosine" | "squared";

type PlayDirection = "forward" | "reverse" | "paused";

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const DEFAULT_TIMESTEPS = 100;
const DEFAULT_NUM_POINTS = 300;
const MIN_POINTS = 100;
const MAX_POINTS = 1000;

// ─────────────────────────────────────────────────────────
// Colormap (Viridis-like)
// ─────────────────────────────────────────────────────────

const COLORMAP_STOPS = [
  { pos: 0.0, r: 68, g: 1, b: 84 },
  { pos: 0.13, r: 72, g: 36, b: 117 },
  { pos: 0.25, r: 56, g: 88, b: 140 },
  { pos: 0.38, r: 39, g: 130, b: 142 },
  { pos: 0.5, r: 31, g: 158, b: 137 },
  { pos: 0.63, r: 53, g: 183, b: 121 },
  { pos: 0.75, r: 110, g: 206, b: 88 },
  { pos: 0.88, r: 181, g: 222, b: 43 },
  { pos: 1.0, r: 253, g: 231, b: 37 },
];

function colormapToRgb(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  let lower = COLORMAP_STOPS[0];
  let upper = COLORMAP_STOPS[COLORMAP_STOPS.length - 1];

  for (let i = 0; i < COLORMAP_STOPS.length - 1; i++) {
    if (clamped >= COLORMAP_STOPS[i].pos && clamped <= COLORMAP_STOPS[i + 1].pos) {
      lower = COLORMAP_STOPS[i];
      upper = COLORMAP_STOPS[i + 1];
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

function colormapToCss(t: number, alpha = 1): string {
  const [r, g, b] = colormapToRgb(t);
  return alpha < 1 ? `rgba(${r},${g},${b},${alpha})` : `rgb(${r},${g},${b})`;
}

// ─────────────────────────────────────────────────────────
// Shape Generators
// ─────────────────────────────────────────────────────────

function generateCircle(n: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    const r = 1.0 + (Math.random() - 0.5) * 0.1;
    points.push({
      x: r * Math.cos(angle),
      y: r * Math.sin(angle),
      colorIndex: i / n,
    });
  }
  return points;
}

function generateTwoMoons(n: number): Point[] {
  const points: Point[] = [];
  const half = Math.floor(n / 2);
  for (let i = 0; i < half; i++) {
    const angle = (Math.PI * i) / half;
    const noise = (Math.random() - 0.5) * 0.15;
    points.push({
      x: Math.cos(angle) + noise,
      y: Math.sin(angle) + noise,
      colorIndex: i / n,
    });
  }
  for (let i = 0; i < n - half; i++) {
    const angle = (Math.PI * i) / (n - half);
    const noise = (Math.random() - 0.5) * 0.15;
    points.push({
      x: 1 - Math.cos(angle) + noise,
      y: 0.5 - Math.sin(angle) + noise,
      colorIndex: (half + i) / n,
    });
  }
  return points;
}

function generateSwissRoll(n: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = 1.5 * Math.PI * (1 + 2 * i / n);
    const noise = (Math.random() - 0.5) * 0.1;
    points.push({
      x: (t * Math.cos(t)) / (3 * Math.PI) + noise,
      y: (t * Math.sin(t)) / (3 * Math.PI) + noise,
      colorIndex: i / n,
    });
  }
  return points;
}

function generateGrid(n: number): Point[] {
  const points: Point[] = [];
  const side = Math.round(Math.sqrt(n));
  const actualN = side * side;
  for (let i = 0; i < side; i++) {
    for (let j = 0; j < side; j++) {
      const idx = i * side + j;
      points.push({
        x: (i / (side - 1)) * 2 - 1 + (Math.random() - 0.5) * 0.05,
        y: (j / (side - 1)) * 2 - 1 + (Math.random() - 0.5) * 0.05,
        colorIndex: idx / actualN,
      });
    }
  }
  return points;
}

function generateSmiley(n: number): Point[] {
  const points: Point[] = [];
  let idx = 0;

  // Face outline (~40%)
  const faceCount = Math.floor(n * 0.4);
  for (let i = 0; i < faceCount; i++) {
    const angle = (2 * Math.PI * i) / faceCount;
    const noise = (Math.random() - 0.5) * 0.06;
    points.push({
      x: 1.2 * Math.cos(angle) + noise,
      y: 1.2 * Math.sin(angle) + noise,
      colorIndex: idx / n,
    });
    idx++;
  }

  // Left eye (~10%)
  const eyeCount = Math.floor(n * 0.1);
  for (let i = 0; i < eyeCount; i++) {
    const angle = (2 * Math.PI * i) / eyeCount;
    const noise = (Math.random() - 0.5) * 0.04;
    points.push({
      x: -0.4 + 0.15 * Math.cos(angle) + noise,
      y: 0.4 + 0.15 * Math.sin(angle) + noise,
      colorIndex: idx / n,
    });
    idx++;
  }

  // Right eye (~10%)
  for (let i = 0; i < eyeCount; i++) {
    const angle = (2 * Math.PI * i) / eyeCount;
    const noise = (Math.random() - 0.5) * 0.04;
    points.push({
      x: 0.4 + 0.15 * Math.cos(angle) + noise,
      y: 0.4 + 0.15 * Math.sin(angle) + noise,
      colorIndex: idx / n,
    });
    idx++;
  }

  // Smile (~40%) - arc from -120deg to -60deg
  const smileCount = n - points.length;
  for (let i = 0; i < smileCount; i++) {
    const angle = -Math.PI * 0.75 + (Math.PI * 0.5 * i) / smileCount;
    const noise = (Math.random() - 0.5) * 0.06;
    points.push({
      x: 0.7 * Math.cos(angle) + noise,
      y: 0.7 * Math.sin(angle) + noise - 0.1,
      colorIndex: idx / n,
    });
    idx++;
  }

  return points;
}

function generateHeart(n: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    const noise = (Math.random() - 0.5) * 0.06;
    // Heart parametric equation
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y =
      13 * Math.cos(t) -
      5 * Math.cos(2 * t) -
      2 * Math.cos(3 * t) -
      Math.cos(4 * t);
    points.push({
      x: x / 16 + noise,
      y: y / 16 + noise,
      colorIndex: i / n,
    });
  }
  return points;
}

const SHAPES: ShapePreset[] = [
  { id: "circle", name: "Circle", generate: generateCircle },
  { id: "two-moons", name: "Two Moons", generate: generateTwoMoons },
  { id: "swiss-roll", name: "Swiss Roll", generate: generateSwissRoll },
  { id: "grid", name: "Grid", generate: generateGrid },
  { id: "smiley", name: "Smiley", generate: generateSmiley },
  { id: "heart", name: "Heart", generate: generateHeart },
];

// ─────────────────────────────────────────────────────────
// Noise Schedules
// ─────────────────────────────────────────────────────────

/** Compute alpha_bar (cumulative product of alphas) for timestep t in [0, T] */
function computeAlphaBar(t: number, totalT: number, schedule: NoiseSchedule): number {
  if (t <= 0) return 1;
  if (t >= totalT) return 0.0001;

  const s = t / totalT; // normalized [0, 1]

  switch (schedule) {
    case "linear": {
      // beta goes from 0.0001 to 0.02 linearly
      const betaStart = 0.0001;
      const betaEnd = 0.02;
      let alphaBar = 1;
      for (let i = 1; i <= t; i++) {
        const beta = betaStart + (betaEnd - betaStart) * (i / totalT);
        alphaBar *= (1 - beta);
      }
      return Math.max(0.0001, alphaBar);
    }
    case "cosine": {
      // Cosine schedule from "Improved Denoising Diffusion Probabilistic Models"
      const fT = Math.cos(((s + 0.008) / 1.008) * (Math.PI / 2));
      const f0 = Math.cos((0.008 / 1.008) * (Math.PI / 2));
      return Math.max(0.0001, (fT * fT) / (f0 * f0));
    }
    case "squared": {
      // Quadratic decay
      const val = 1 - s * s;
      return Math.max(0.0001, val * val);
    }
  }
}

/** Compute alpha_t (not cumulative) from alpha_bar values */
function computeAlpha(t: number, totalT: number, schedule: NoiseSchedule): number {
  if (t <= 0) return 1;
  const alphaBarT = computeAlphaBar(t, totalT, schedule);
  const alphaBarPrev = computeAlphaBar(t - 1, totalT, schedule);
  return Math.max(0.0001, alphaBarT / alphaBarPrev);
}

// ─────────────────────────────────────────────────────────
// Forward Diffusion
// ─────────────────────────────────────────────────────────

/** Apply forward diffusion: x_t = sqrt(alpha_bar) * x_0 + sqrt(1 - alpha_bar) * epsilon */
function forwardDiffuse(
  originalPoints: Point[],
  noiseVectors: Array<{ ex: number; ey: number }>,
  alphaBar: number,
): Point[] {
  const sqrtAlphaBar = Math.sqrt(alphaBar);
  const sqrtOneMinusAlphaBar = Math.sqrt(1 - alphaBar);

  return originalPoints.map((p, i) => ({
    x: sqrtAlphaBar * p.x + sqrtOneMinusAlphaBar * noiseVectors[i].ex,
    y: sqrtAlphaBar * p.y + sqrtOneMinusAlphaBar * noiseVectors[i].ey,
    colorIndex: p.colorIndex,
  }));
}

// ─────────────────────────────────────────────────────────
// Reverse Diffusion (simplified score estimation)
// ─────────────────────────────────────────────────────────

/**
 * Estimate the noise (epsilon) for the reverse process.
 * Since we know the original data distribution, we estimate the score
 * as the direction from current position toward the nearest original point,
 * scaled by the noise level.
 */
function estimateNoise(
  currentPoints: Point[],
  originalPoints: Point[],
  alphaBar: number,
): Array<{ ex: number; ey: number }> {
  const sqrtAlphaBar = Math.sqrt(alphaBar);
  const sqrtOneMinusAlphaBar = Math.sqrt(1 - alphaBar);

  if (sqrtOneMinusAlphaBar < 1e-8) {
    return currentPoints.map(() => ({ ex: 0, ey: 0 }));
  }

  return currentPoints.map((p, i) => {
    // Since x_t = sqrt(abar) * x_0 + sqrt(1-abar) * eps
    // eps = (x_t - sqrt(abar) * x_0) / sqrt(1-abar)
    const orig = originalPoints[i];
    return {
      ex: (p.x - sqrtAlphaBar * orig.x) / sqrtOneMinusAlphaBar,
      ey: (p.y - sqrtAlphaBar * orig.y) / sqrtOneMinusAlphaBar,
    };
  });
}

/**
 * Perform one reverse diffusion step:
 * x_{t-1} = (1/sqrt(alpha_t)) * (x_t - (1-alpha_t)/sqrt(1-alpha_bar_t) * eps) + sigma_t * z
 */
function reverseDiffuseStep(
  currentPoints: Point[],
  originalPoints: Point[],
  t: number,
  totalT: number,
  schedule: NoiseSchedule,
): Point[] {
  if (t <= 0) return currentPoints;

  const alphaT = computeAlpha(t, totalT, schedule);
  const alphaBarT = computeAlphaBar(t, totalT, schedule);
  const sqrtAlphaT = Math.sqrt(alphaT);
  const sqrtOneMinusAlphaBarT = Math.sqrt(1 - alphaBarT);

  // Posterior variance
  const alphaBarPrev = computeAlphaBar(t - 1, totalT, schedule);
  const betaT = 1 - alphaT;
  const sigma = Math.sqrt((betaT * (1 - alphaBarPrev)) / (1 - alphaBarT));

  const estimatedNoise = estimateNoise(currentPoints, originalPoints, alphaBarT);

  return currentPoints.map((p, i) => {
    const eps = estimatedNoise[i];
    const coeff = sqrtOneMinusAlphaBarT > 1e-8 ? betaT / sqrtOneMinusAlphaBarT : 0;

    const meanX = (1 / sqrtAlphaT) * (p.x - coeff * eps.ex);
    const meanY = (1 / sqrtAlphaT) * (p.y - coeff * eps.ey);

    // Add noise z (except at t=1, where we return the mean)
    const z = t > 1 ? sigma : 0;
    return {
      x: meanX + z * gaussianRandom(),
      y: meanY + z * gaussianRandom(),
      colorIndex: p.colorIndex,
    };
  });
}

// ─────────────────────────────────────────────────────────
// Random Utilities
// ─────────────────────────────────────────────────────────

function gaussianRandom(): number {
  // Box-Muller transform
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
}

function generateNoiseVectors(n: number): Array<{ ex: number; ey: number }> {
  return Array.from({ length: n }, () => ({
    ex: gaussianRandom(),
    ey: gaussianRandom(),
  }));
}

// ─────────────────────────────────────────────────────────
// Canvas Rendering
// ─────────────────────────────────────────────────────────

function computeViewBounds(points: Point[], padding: number): {
  xMin: number; xMax: number; yMin: number; yMax: number;
} {
  if (points.length === 0) return { xMin: -2, xMax: 2, yMin: -2, yMax: 2 };

  let xMin = points[0].x;
  let xMax = points[0].x;
  let yMin = points[0].y;
  let yMax = points[0].y;

  for (const p of points) {
    if (p.x < xMin) xMin = p.x;
    if (p.x > xMax) xMax = p.x;
    if (p.y < yMin) yMin = p.y;
    if (p.y > yMax) yMax = p.y;
  }

  // Add padding proportional to range
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  const pad = Math.max(xRange, yRange) * (padding / 100);

  return {
    xMin: xMin - pad,
    xMax: xMax + pad,
    yMin: yMin - pad,
    yMax: yMax + pad,
  };
}

function renderPoints(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  canvasWidth: number,
  canvasHeight: number,
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  pointRadius: number,
) {
  const xRange = bounds.xMax - bounds.xMin;
  const yRange = bounds.yMax - bounds.yMin;

  for (const p of points) {
    const px = ((p.x - bounds.xMin) / xRange) * canvasWidth;
    const py = canvasHeight - ((p.y - bounds.yMin) / yRange) * canvasHeight;

    ctx.beginPath();
    ctx.arc(px, py, pointRadius, 0, Math.PI * 2);
    ctx.fillStyle = colormapToCss(p.colorIndex, 0.85);
    ctx.fill();

    // Subtle glow
    ctx.beginPath();
    ctx.arc(px, py, pointRadius + 1.5, 0, Math.PI * 2);
    ctx.fillStyle = colormapToCss(p.colorIndex, 0.15);
    ctx.fill();
  }
}

function renderDensityHeatmap(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  canvasWidth: number,
  canvasHeight: number,
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
) {
  const gridSize = 40;
  const cellW = canvasWidth / gridSize;
  const cellH = canvasHeight / gridSize;
  const xRange = bounds.xMax - bounds.xMin;
  const yRange = bounds.yMax - bounds.yMin;

  // Compute density on grid using kernel density estimation
  const density = new Float32Array(gridSize * gridSize);
  const bandwidth = Math.max(xRange, yRange) / 15;
  const bw2 = bandwidth * bandwidth;

  for (const p of points) {
    const gx = ((p.x - bounds.xMin) / xRange) * gridSize;
    const gy = ((p.y - bounds.yMin) / yRange) * gridSize;

    const kernelRadius = Math.ceil(bandwidth / (xRange / gridSize) * 2);

    const iMin = Math.max(0, Math.floor(gx - kernelRadius));
    const iMax = Math.min(gridSize - 1, Math.ceil(gx + kernelRadius));
    const jMin = Math.max(0, Math.floor(gy - kernelRadius));
    const jMax = Math.min(gridSize - 1, Math.ceil(gy + kernelRadius));

    for (let j = jMin; j <= jMax; j++) {
      for (let i = iMin; i <= iMax; i++) {
        const dx = (i - gx) * (xRange / gridSize);
        const dy = (j - gy) * (yRange / gridSize);
        const dist2 = dx * dx + dy * dy;
        density[j * gridSize + i] += Math.exp(-dist2 / (2 * bw2));
      }
    }
  }

  // Find max density
  let maxDensity = 0;
  for (let i = 0; i < density.length; i++) {
    if (density[i] > maxDensity) maxDensity = density[i];
  }

  if (maxDensity <= 0) return;

  // Draw heatmap cells
  for (let j = 0; j < gridSize; j++) {
    for (let i = 0; i < gridSize; i++) {
      const d = density[j * gridSize + i] / maxDensity;
      if (d < 0.02) continue;

      const alpha = d * 0.25;
      const [r, g, b] = colormapToRgb(d);
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.fillRect(
        i * cellW,
        canvasHeight - (j + 1) * cellH,
        cellW + 0.5,
        cellH + 0.5,
      );
    }
  }
}

// ─────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────

export default function DiffusionViz() {
  // --- State ---
  const [shapeIndex, setShapeIndex] = useState(0);
  const [numPoints, setNumPoints] = useState(DEFAULT_NUM_POINTS);
  const [totalTimesteps, setTotalTimesteps] = useState(DEFAULT_TIMESTEPS);
  const [currentTimestep, setCurrentTimestep] = useState(0);
  const [schedule, setSchedule] = useState<NoiseSchedule>("linear");
  const [playDirection, setPlayDirection] = useState<PlayDirection>("paused");
  const [speed, setSpeed] = useState(1);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showSideBySide, setShowSideBySide] = useState(false);
  const [isReversing, setIsReversing] = useState(false);
  const [canvasSize, setCanvasSize] = useState(500);

  // Refs for animation
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sideCanvas1Ref = useRef<HTMLCanvasElement>(null);
  const sideCanvas2Ref = useRef<HTMLCanvasElement>(null);
  const sideCanvas3Ref = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const playDirectionRef = useRef<PlayDirection>("paused");
  const currentTimestepRef = useRef(0);

  // Data refs (avoid re-render on every frame)
  const originalPointsRef = useRef<Point[]>([]);
  const noiseVectorsRef = useRef<Array<{ ex: number; ey: number }>>([]);
  const reversePointsRef = useRef<Map<number, Point[]>>(new Map());
  const isReverseMode = useRef(false);

  const shape = SHAPES[shapeIndex];

  // Keep refs in sync
  useEffect(() => { playDirectionRef.current = playDirection; }, [playDirection]);
  useEffect(() => { currentTimestepRef.current = currentTimestep; }, [currentTimestep]);

  // --- Generate points when shape or numPoints changes ---
  const regeneratePoints = useCallback(() => {
    const pts = shape.generate(numPoints);
    originalPointsRef.current = pts;
    noiseVectorsRef.current = generateNoiseVectors(pts.length);
    reversePointsRef.current = new Map();
    isReverseMode.current = false;
    setIsReversing(false);
    setCurrentTimestep(0);
    currentTimestepRef.current = 0;
    setPlayDirection("paused");
    playDirectionRef.current = "paused";
  }, [shape, numPoints]);

  useEffect(() => {
    regeneratePoints();
  }, [regeneratePoints]);

  // --- Responsive canvas sizing ---
  useEffect(() => {
    function handleResize() {
      if (containerRef.current) {
        setCanvasSize(containerRef.current.clientWidth);
      }
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // --- Compute current points for a given timestep ---
  const getPointsAtTimestep = useCallback((t: number): Point[] => {
    const original = originalPointsRef.current;
    if (original.length === 0) return [];

    if (isReverseMode.current) {
      // In reverse mode, check cache
      const cached = reversePointsRef.current.get(t);
      if (cached) return cached;

      // Must compute sequentially from highest cached timestep
      let startT = totalTimesteps;
      let pts = reversePointsRef.current.get(totalTimesteps);

      if (!pts) {
        // Start from pure noise (t=T)
        const alphaBarT = computeAlphaBar(totalTimesteps, totalTimesteps, schedule);
        pts = forwardDiffuse(original, noiseVectorsRef.current, alphaBarT);
        reversePointsRef.current.set(totalTimesteps, pts);
      }

      // Find closest cached step above t
      for (let s = totalTimesteps - 1; s > t; s--) {
        const c = reversePointsRef.current.get(s);
        if (c) {
          pts = c;
          startT = s;
          break;
        }
      }

      // Compute steps from startT down to t
      for (let s = startT; s > t; s--) {
        pts = reverseDiffuseStep(pts, original, s, totalTimesteps, schedule);
        reversePointsRef.current.set(s - 1, pts);
      }

      return reversePointsRef.current.get(t) ?? pts;
    }

    // Forward mode: deterministic given original + noise
    const alphaBar = computeAlphaBar(t, totalTimesteps, schedule);
    return forwardDiffuse(original, noiseVectorsRef.current, alphaBar);
  }, [totalTimesteps, schedule]);

  // --- Compute values for display ---
  const alphaBar = useMemo(
    () => computeAlphaBar(currentTimestep, totalTimesteps, schedule),
    [currentTimestep, totalTimesteps, schedule],
  );

  const snrDb = useMemo(() => {
    if (alphaBar <= 0.0001) return -Infinity;
    const snr = alphaBar / (1 - alphaBar);
    return 10 * Math.log10(snr);
  }, [alphaBar]);

  // --- View bounds (fixed to accommodate full diffusion range) ---
  const viewBounds = useMemo(() => {
    const original = originalPointsRef.current;
    if (original.length === 0) return { xMin: -2, xMax: 2, yMin: -2, yMax: 2 };

    // Compute bounds that encompass both original data and noise
    const origBounds = computeViewBounds(original, 0);
    const range = Math.max(
      origBounds.xMax - origBounds.xMin,
      origBounds.yMax - origBounds.yMin,
    );

    // Use a fixed bound that accounts for noise spread (3 sigma)
    const noisePad = Math.max(range * 0.5, 3);
    const cx = (origBounds.xMin + origBounds.xMax) / 2;
    const cy = (origBounds.yMin + origBounds.yMax) / 2;
    const halfSize = Math.max(range / 2, 1) + noisePad;

    return {
      xMin: cx - halfSize,
      xMax: cx + halfSize,
      yMin: cy - halfSize,
      yMax: cy + halfSize,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeIndex, numPoints]);

  // --- Rendering ---
  const renderMainCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Clear with background
    ctx.fillStyle = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-bg").trim() || "#09090b";
    ctx.fillRect(0, 0, w, h);

    const points = getPointsAtTimestep(currentTimestepRef.current);

    // Density heatmap
    if (showHeatmap) {
      renderDensityHeatmap(ctx, points, w, h, viewBounds);
    }

    // Grid lines
    drawGrid(ctx, w, h, viewBounds);

    // Points
    const radius = numPoints <= 200 ? 3.5 : numPoints <= 500 ? 2.5 : 2;
    renderPoints(ctx, points, w, h, viewBounds, radius);
  }, [getPointsAtTimestep, showHeatmap, viewBounds, numPoints]);

  const renderSideCanvases = useCallback(() => {
    const canvases = [sideCanvas1Ref.current, sideCanvas2Ref.current, sideCanvas3Ref.current];
    const labels = ["Original (t=0)", `Current (t=${currentTimestepRef.current})`, `Noise (t=${totalTimesteps})`];
    const timesteps = [0, currentTimestepRef.current, totalTimesteps];

    for (let ci = 0; ci < 3; ci++) {
      const canvas = canvases[ci];
      if (!canvas) continue;

      const ctx = canvas.getContext("2d");
      if (!ctx) continue;

      const w = canvas.width;
      const h = canvas.height;

      ctx.fillStyle = getComputedStyle(document.documentElement)
        .getPropertyValue("--color-bg").trim() || "#09090b";
      ctx.fillRect(0, 0, w, h);

      const pts = getPointsAtTimestep(timesteps[ci]);
      const radius = numPoints <= 200 ? 2.5 : 2;
      renderPoints(ctx, pts, w, h, viewBounds, radius);

      // Label
      ctx.fillStyle = getComputedStyle(document.documentElement)
        .getPropertyValue("--color-text-muted").trim() || "#a1a1aa";
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(labels[ci], w / 2, h - 6);
    }
  }, [getPointsAtTimestep, totalTimesteps, viewBounds, numPoints]);

  // --- Animation loop ---
  useEffect(() => {
    let lastTimestamp = 0;
    const frameInterval = 1000 / 30; // 30fps base

    function animate(timestamp: number) {
      const dir = playDirectionRef.current;

      if (dir === "paused") {
        renderMainCanvas();
        if (showSideBySide) renderSideCanvases();
        return;
      }

      const adjustedInterval = frameInterval / speed;

      if (timestamp - lastTimestamp >= adjustedInterval) {
        lastTimestamp = timestamp;

        let t = currentTimestepRef.current;

        if (dir === "forward") {
          t = Math.min(t + 1, totalTimesteps);
          if (t >= totalTimesteps) {
            setPlayDirection("paused");
            playDirectionRef.current = "paused";
          }
        } else if (dir === "reverse") {
          t = Math.max(t - 1, 0);
          if (t <= 0) {
            setPlayDirection("paused");
            playDirectionRef.current = "paused";
          }
        }

        currentTimestepRef.current = t;
        setCurrentTimestep(t);

        renderMainCanvas();
        if (showSideBySide) renderSideCanvases();
      }

      animFrameRef.current = requestAnimationFrame(animate);
    }

    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [playDirection, speed, totalTimesteps, renderMainCanvas, renderSideCanvases, showSideBySide]);

  // Re-render when static settings change
  useEffect(() => {
    if (playDirectionRef.current === "paused") {
      renderMainCanvas();
      if (showSideBySide) renderSideCanvases();
    }
  }, [showHeatmap, canvasSize, schedule, renderMainCanvas, showSideBySide, renderSideCanvases]);

  // --- Handlers ---
  const handleTimestepChange = useCallback((t: number) => {
    setCurrentTimestep(t);
    currentTimestepRef.current = t;
    setPlayDirection("paused");
    playDirectionRef.current = "paused";
  }, []);

  const handlePlayForward = useCallback(() => {
    isReverseMode.current = false;
    setIsReversing(false);
    reversePointsRef.current = new Map();
    if (currentTimestepRef.current >= totalTimesteps) {
      setCurrentTimestep(0);
      currentTimestepRef.current = 0;
    }
    setPlayDirection("forward");
  }, [totalTimesteps]);

  const handlePlayReverse = useCallback(() => {
    // Start reverse mode from current position
    isReverseMode.current = true;
    setIsReversing(true);
    reversePointsRef.current = new Map();

    // Seed the reverse cache with current noisy points at current timestep
    const alphaBarCurrent = computeAlphaBar(
      currentTimestepRef.current, totalTimesteps, schedule,
    );
    const noisyPoints = forwardDiffuse(
      originalPointsRef.current, noiseVectorsRef.current, alphaBarCurrent,
    );
    reversePointsRef.current.set(currentTimestepRef.current, noisyPoints);

    if (currentTimestepRef.current <= 0) {
      setCurrentTimestep(totalTimesteps);
      currentTimestepRef.current = totalTimesteps;
      // Re-seed at T
      const alphaBarT = computeAlphaBar(totalTimesteps, totalTimesteps, schedule);
      const noisyPts = forwardDiffuse(
        originalPointsRef.current, noiseVectorsRef.current, alphaBarT,
      );
      reversePointsRef.current.set(totalTimesteps, noisyPts);
    }

    setPlayDirection("reverse");
  }, [totalTimesteps, schedule]);

  const handlePause = useCallback(() => {
    setPlayDirection("paused");
    playDirectionRef.current = "paused";
  }, []);

  const handleScheduleChange = useCallback((newSchedule: NoiseSchedule) => {
    setSchedule(newSchedule);
    reversePointsRef.current = new Map();
    isReverseMode.current = false;
    setIsReversing(false);
  }, []);

  const handleShapeChange = useCallback((idx: number) => {
    setShapeIndex(idx);
  }, []);

  const canvasPixelSize = Math.round(canvasSize);
  const sideCanvasSize = Math.round(canvasSize / 3 - 8);

  // --- Explanation text ---
  const explanationText = useMemo(() => {
    const t = currentTimestep;
    if (t === 0) return "Original data distribution. No noise has been added yet.";
    if (t < totalTimesteps * 0.25)
      return "Early noising: structure is mostly preserved with slight perturbations.";
    if (t < totalTimesteps * 0.5)
      return "Moderate noise: the original shape is becoming harder to discern.";
    if (t < totalTimesteps * 0.75)
      return "Heavy noise: most structure is destroyed, approaching Gaussian.";
    if (t < totalTimesteps) return "Near-pure noise: almost indistinguishable from random Gaussian.";
    return "Pure Gaussian noise. All original structure has been destroyed.";
  }, [currentTimestep, totalTimesteps]);

  return (
    <div class="dv-root overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Top toolbar */}
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-2.5">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-[var(--color-text-muted)]">
            Diffusion Visualizer
          </span>
          <span class="rounded-full border border-[var(--color-primary)]/30 px-2 py-0.5 text-[10px] font-semibold text-[var(--color-primary)]">
            alpha
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <div class="flex items-center gap-1.5">
            <label class="text-xs text-[var(--color-text-muted)]">Shape:</label>
            <select
              class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-text)] outline-none"
              value={shapeIndex}
              onChange={(e) => handleShapeChange(Number((e.target as HTMLSelectElement).value))}
            >
              {SHAPES.map((s, i) => (
                <option key={s.id} value={i}>{s.name}</option>
              ))}
            </select>
          </div>
          <div class="flex items-center gap-1.5">
            <label class="text-xs text-[var(--color-text-muted)]">Points:</label>
            <input
              type="range"
              min={MIN_POINTS}
              max={MAX_POINTS}
              step={50}
              value={numPoints}
              onInput={(e) => setNumPoints(Number((e.target as HTMLInputElement).value))}
              class="dv-slider w-20"
            />
            <span class="font-mono text-[11px] text-[var(--color-heading)] w-8 text-right">{numPoints}</span>
          </div>
        </div>
      </div>

      {/* Schedule selector */}
      <div class="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-4 py-2">
        <span class="text-xs text-[var(--color-text-muted)]">Schedule:</span>
        {(["linear", "cosine", "squared"] as NoiseSchedule[]).map((s) => (
          <button
            key={s}
            onClick={() => handleScheduleChange(s)}
            class="rounded-lg px-3 py-1 text-xs font-medium capitalize transition-all"
            style={{
              background: schedule === s ? "var(--color-primary)" : "transparent",
              border: `1px solid ${schedule === s ? "var(--color-primary)" : "var(--color-border)"}`,
              color: schedule === s ? "#ffffff" : "var(--color-text-muted)",
            }}
          >
            {s}
          </button>
        ))}

        <div class="ml-auto flex items-center gap-3">
          <label class="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
            <input
              type="checkbox"
              checked={showHeatmap}
              onChange={() => setShowHeatmap((p) => !p)}
              class="dv-checkbox"
            />
            Density
          </label>
          <label class="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
            <input
              type="checkbox"
              checked={showSideBySide}
              onChange={() => setShowSideBySide((p) => !p)}
              class="dv-checkbox"
            />
            Side-by-side
          </label>
        </div>
      </div>

      {/* Main canvas */}
      <div ref={containerRef} class="relative border-b border-[var(--color-border)]">
        <canvas
          ref={canvasRef}
          width={canvasPixelSize}
          height={canvasPixelSize}
          class="dv-canvas block w-full"
          style={{ aspectRatio: "1 / 1" }}
        />
        {/* Timestep overlay */}
        <div class="pointer-events-none absolute top-3 left-3">
          <span class="rounded-md bg-black/50 px-2.5 py-1 font-mono text-xs text-white/80">
            t = {currentTimestep} / {totalTimesteps}
          </span>
        </div>
        {isReversing && (
          <div class="pointer-events-none absolute top-3 right-3">
            <span class="rounded-md bg-[var(--color-accent)]/20 px-2.5 py-1 text-[10px] font-semibold text-[var(--color-accent)]">
              REVERSE
            </span>
          </div>
        )}
      </div>

      {/* Side-by-side canvases */}
      {showSideBySide && (
        <div class="grid grid-cols-3 gap-2 border-b border-[var(--color-border)] p-2">
          <canvas
            ref={sideCanvas1Ref}
            width={sideCanvasSize}
            height={sideCanvasSize}
            class="dv-canvas block w-full rounded-lg border border-[var(--color-border)]"
            style={{ aspectRatio: "1 / 1" }}
          />
          <canvas
            ref={sideCanvas2Ref}
            width={sideCanvasSize}
            height={sideCanvasSize}
            class="dv-canvas block w-full rounded-lg border border-[var(--color-border)]"
            style={{ aspectRatio: "1 / 1" }}
          />
          <canvas
            ref={sideCanvas3Ref}
            width={sideCanvasSize}
            height={sideCanvasSize}
            class="dv-canvas block w-full rounded-lg border border-[var(--color-border)]"
            style={{ aspectRatio: "1 / 1" }}
          />
        </div>
      )}

      {/* Controls: timestep slider + buttons */}
      <div class="border-b border-[var(--color-border)] px-4 py-3">
        {/* Timestep slider */}
        <div class="mb-3">
          <div class="mb-1 flex items-center justify-between">
            <label class="text-[11px] text-[var(--color-text-muted)]">Timestep</label>
            <span class="font-mono text-[11px] text-[var(--color-heading)]">
              {currentTimestep} / {totalTimesteps}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={totalTimesteps}
            step={1}
            value={currentTimestep}
            onInput={(e) => handleTimestepChange(Number((e.target as HTMLInputElement).value))}
            class="dv-slider w-full"
          />
        </div>

        {/* Playback controls */}
        <div class="flex items-center justify-center gap-3">
          <button
            onClick={handlePlayReverse}
            class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)]/30 hover:text-[var(--color-heading)]"
            title="Play reverse (denoising)"
          >
            Reverse
          </button>
          <button
            onClick={playDirection !== "paused" ? handlePause : handlePlayForward}
            class="dv-btn-primary rounded-lg px-6 py-2 text-xs font-semibold text-white transition-all"
          >
            {playDirection !== "paused" ? "Pause" : "Play"}
          </button>
          <button
            onClick={handlePlayForward}
            class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)]/30 hover:text-[var(--color-heading)]"
            title="Play forward (noising)"
          >
            Forward
          </button>
        </div>

        {/* Speed */}
        <div class="mt-3 flex items-center justify-center gap-2">
          <label class="text-[11px] text-[var(--color-text-muted)]">Speed:</label>
          {[0.5, 1, 2, 4].map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              class="rounded-md px-2 py-0.5 text-[10px] font-medium transition-all"
              style={{
                background: speed === s ? "var(--color-primary)" : "transparent",
                border: `1px solid ${speed === s ? "var(--color-primary)" : "var(--color-border)"}`,
                color: speed === s ? "#ffffff" : "var(--color-text-muted)",
              }}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      {/* Info panel */}
      <div class="px-4 py-3">
        <div class="grid grid-cols-3 gap-4 text-center">
          <div>
            <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Alpha Bar
            </div>
            <div class="font-mono text-sm font-semibold text-[var(--color-heading)]">
              {alphaBar.toFixed(4)}
            </div>
          </div>
          <div>
            <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              SNR
            </div>
            <div class="font-mono text-sm font-semibold text-[var(--color-heading)]">
              {Number.isFinite(snrDb) ? `${snrDb.toFixed(1)} dB` : "-inf"}
            </div>
          </div>
          <div>
            <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Noise Level
            </div>
            <div class="font-mono text-sm font-semibold text-[var(--color-heading)]">
              {(Math.sqrt(1 - alphaBar)).toFixed(4)}
            </div>
          </div>
        </div>

        {/* Formula */}
        <div class="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-center">
          {isReversing ? (
            <div class="font-mono text-[11px] text-[var(--color-text-muted)]">
              x<sub>t-1</sub> = (1/&#8730;&#945;<sub>t</sub>)(x<sub>t</sub> - (1-&#945;<sub>t</sub>)/&#8730;(1-&#257;<sub>t</sub>) &#183; &#949;<sub>&#952;</sub>) + &#963;<sub>t</sub> &#183; z
            </div>
          ) : (
            <div class="font-mono text-[11px] text-[var(--color-text-muted)]">
              x<sub>t</sub> = &#8730;&#257;<sub>t</sub> &#183; x<sub>0</sub> + &#8730;(1-&#257;<sub>t</sub>) &#183; &#949;
            </div>
          )}
        </div>

        {/* Explanation */}
        <p class="mt-2 text-center text-[11px] leading-relaxed text-[var(--color-text-muted)]">
          {explanationText}
        </p>
      </div>

      <style>{`
        .dv-canvas {
          image-rendering: auto;
        }
        .dv-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          border-radius: 2px;
          background: var(--color-border);
          outline: none;
        }
        .dv-slider::-webkit-slider-thumb {
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
        .dv-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--color-primary);
          cursor: pointer;
          border: 2px solid var(--color-surface);
        }
        .dv-checkbox {
          accent-color: var(--color-primary);
          cursor: pointer;
        }
        .dv-btn-primary {
          background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
        }
        .dv-btn-primary:hover {
          filter: brightness(1.1);
          box-shadow: 0 0 20px color-mix(in srgb, var(--color-primary) 40%, transparent);
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Grid Drawing Helper
// ─────────────────────────────────────────────────────────

function drawGrid(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
) {
  const xRange = bounds.xMax - bounds.xMin;
  const yRange = bounds.yMax - bounds.yMin;

  // Subtle grid
  ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
  ctx.lineWidth = 0.5;

  const gridStep = computeGridStep(Math.max(xRange, yRange));

  // Vertical lines
  const xStart = Math.ceil(bounds.xMin / gridStep) * gridStep;
  for (let x = xStart; x <= bounds.xMax; x += gridStep) {
    const px = ((x - bounds.xMin) / xRange) * canvasWidth;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, canvasHeight);
    ctx.stroke();
  }

  // Horizontal lines
  const yStart = Math.ceil(bounds.yMin / gridStep) * gridStep;
  for (let y = yStart; y <= bounds.yMax; y += gridStep) {
    const py = canvasHeight - ((y - bounds.yMin) / yRange) * canvasHeight;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(canvasWidth, py);
    ctx.stroke();
  }

  // Axes (if visible)
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1;

  if (bounds.xMin <= 0 && bounds.xMax >= 0) {
    const px = ((0 - bounds.xMin) / xRange) * canvasWidth;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, canvasHeight);
    ctx.stroke();
  }

  if (bounds.yMin <= 0 && bounds.yMax >= 0) {
    const py = canvasHeight - ((0 - bounds.yMin) / yRange) * canvasHeight;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(canvasWidth, py);
    ctx.stroke();
  }
}

function computeGridStep(range: number): number {
  const rawStep = range / 8;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / mag;

  if (normalized < 1.5) return mag;
  if (normalized < 3.5) return 2 * mag;
  if (normalized < 7.5) return 5 * mag;
  return 10 * mag;
}
