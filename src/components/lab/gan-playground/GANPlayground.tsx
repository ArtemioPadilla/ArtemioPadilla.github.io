import {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "preact/hooks";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

type DistributionId = "circle" | "two-moons" | "spiral" | "grid" | "gaussian-mixture";
type PresetId = "normal" | "mode-collapse" | "d-dominance";

interface TrainingConfig {
  lrG: number;
  lrD: number;
  batchSize: number;
  noiseDim: number;
  speed: number;
}

interface Matrix {
  data: Float64Array;
  rows: number;
  cols: number;
}

interface Layer {
  W: Matrix;
  b: Float64Array;
  z: Matrix;
  a: Matrix;
}

interface MLP {
  layers: Layer[];
  hasSigmoidOutput: boolean;
}

interface LossRecord {
  step: number;
  gLoss: number;
  dLoss: number;
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const DISTRIBUTIONS: { id: DistributionId; label: string }[] = [
  { id: "circle", label: "Circle" },
  { id: "two-moons", label: "Two Moons" },
  { id: "spiral", label: "Spiral" },
  { id: "grid", label: "Grid" },
  { id: "gaussian-mixture", label: "Gaussian Mixture" },
];

const PRESETS: { id: PresetId; label: string; config: Partial<TrainingConfig> }[] = [
  { id: "normal", label: "Normal Training", config: { lrG: 0.01, lrD: 0.01, batchSize: 64, noiseDim: 2 } },
  { id: "mode-collapse", label: "Mode Collapse", config: { lrG: 0.05, lrD: 0.001, batchSize: 32, noiseDim: 2 } },
  { id: "d-dominance", label: "D Dominance", config: { lrG: 0.001, lrD: 0.05, batchSize: 64, noiseDim: 2 } },
];

const HEATMAP_RES = 50;
const MAX_LOSS_HISTORY = 500;
const NUM_TARGET_POINTS = 512;
const NUM_DISPLAY_GENERATED = 256;
const COVERAGE_THRESHOLD = 0.3;

const COLOR_REAL = "#4f8ff7";
const COLOR_FAKE = "#f59e0b";
const COLOR_G_LOSS = "#34d399";
const COLOR_D_LOSS = "#f87171";

// ─────────────────────────────────────────────────────────
// Matrix operations
// ─────────────────────────────────────────────────────────

function matCreate(rows: number, cols: number): Matrix {
  return { data: new Float64Array(rows * cols), rows, cols };
}

function matGet(m: Matrix, r: number, c: number): number {
  return m.data[r * m.cols + c];
}

function matSet(m: Matrix, r: number, c: number, v: number): void {
  m.data[r * m.cols + c] = v;
}

function matMul(a: Matrix, b: Matrix): Matrix {
  const out = matCreate(a.rows, b.cols);
  for (let i = 0; i < a.rows; i++) {
    for (let j = 0; j < b.cols; j++) {
      let sum = 0;
      for (let k = 0; k < a.cols; k++) {
        sum += matGet(a, i, k) * matGet(b, k, j);
      }
      matSet(out, i, j, sum);
    }
  }
  return out;
}

function matTranspose(m: Matrix): Matrix {
  const out = matCreate(m.cols, m.rows);
  for (let i = 0; i < m.rows; i++) {
    for (let j = 0; j < m.cols; j++) {
      matSet(out, j, i, matGet(m, i, j));
    }
  }
  return out;
}

function matAddBias(m: Matrix, bias: Float64Array): Matrix {
  const out = matCreate(m.rows, m.cols);
  for (let i = 0; i < m.rows; i++) {
    for (let j = 0; j < m.cols; j++) {
      matSet(out, i, j, matGet(m, i, j) + bias[j]);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────
// Activation functions
// ─────────────────────────────────────────────────────────

function leakyRelu(x: number): number {
  return x > 0 ? x : 0.2 * x;
}

function leakyReluDeriv(x: number): number {
  return x > 0 ? 1 : 0.2;
}

function sigmoid(x: number): number {
  if (x > 15) return 1;
  if (x < -15) return 0;
  return 1 / (1 + Math.exp(-x));
}

// ─────────────────────────────────────────────────────────
// MLP (from scratch)
// ─────────────────────────────────────────────────────────

function createMLP(layerSizes: number[], sigmoidOutput: boolean): MLP {
  const layers: Layer[] = [];
  for (let i = 0; i < layerSizes.length - 1; i++) {
    const fanIn = layerSizes[i];
    const fanOut = layerSizes[i + 1];
    const scale = Math.sqrt(2 / fanIn);
    const W = matCreate(fanIn, fanOut);
    for (let j = 0; j < W.data.length; j++) {
      W.data[j] = randn() * scale;
    }
    const b = new Float64Array(fanOut);
    layers.push({
      W,
      b,
      z: matCreate(0, 0),
      a: matCreate(0, 0),
    });
  }
  return { layers, hasSigmoidOutput: sigmoidOutput };
}

function forwardMLP(mlp: MLP, input: Matrix): Matrix {
  let current = input;
  for (let i = 0; i < mlp.layers.length; i++) {
    const layer = mlp.layers[i];
    const z = matAddBias(matMul(current, layer.W), layer.b);
    layer.z = z;

    const isLast = i === mlp.layers.length - 1;
    const a = matCreate(z.rows, z.cols);

    if (isLast && mlp.hasSigmoidOutput) {
      for (let j = 0; j < z.data.length; j++) {
        a.data[j] = sigmoid(z.data[j]);
      }
    } else if (isLast && !mlp.hasSigmoidOutput) {
      // Linear output for generator
      a.data.set(z.data);
    } else {
      for (let j = 0; j < z.data.length; j++) {
        a.data[j] = leakyRelu(z.data[j]);
      }
    }
    layer.a = a;
    current = a;
  }
  return current;
}

function backwardMLP(
  mlp: MLP,
  input: Matrix,
  dOutput: Matrix,
  lr: number,
): void {
  let delta = dOutput;

  for (let i = mlp.layers.length - 1; i >= 0; i--) {
    const layer = mlp.layers[i];
    const isLast = i === mlp.layers.length - 1;

    // Apply activation derivative to delta
    if (!isLast || !mlp.hasSigmoidOutput) {
      if (!isLast) {
        // LeakyReLU derivative
        const dAct = matCreate(delta.rows, delta.cols);
        for (let j = 0; j < delta.data.length; j++) {
          dAct.data[j] = delta.data[j] * leakyReluDeriv(layer.z.data[j]);
        }
        delta = dAct;
      }
      // For last layer: linear output means derivative is 1, so delta stays the same
      // For last layer with sigmoid: delta already includes sigmoid derivative from the loss
    }

    // Gradient for weights: prevActivation^T * delta
    const prevA = i > 0 ? mlp.layers[i - 1].a : input;
    const prevAT = matTranspose(prevA);
    const dW = matMul(prevAT, delta);

    // Gradient for biases: sum of delta rows
    const db = new Float64Array(layer.b.length);
    for (let r = 0; r < delta.rows; r++) {
      for (let c = 0; c < delta.cols; c++) {
        db[c] += matGet(delta, r, c);
      }
    }

    // Propagate delta to previous layer
    if (i > 0) {
      delta = matMul(delta, matTranspose(layer.W));
    }

    // Update parameters with gradient clipping
    const clipVal = 1.0;
    for (let j = 0; j < layer.W.data.length; j++) {
      const g = Math.max(-clipVal, Math.min(clipVal, dW.data[j] / delta.rows));
      layer.W.data[j] -= lr * g;
    }
    for (let j = 0; j < layer.b.length; j++) {
      const g = Math.max(-clipVal, Math.min(clipVal, db[j] / delta.rows));
      layer.b[j] -= lr * g;
    }
  }
}

// Return gradients w.r.t. the input (for training generator through discriminator)
function backwardMLPReturnInputGrad(
  mlp: MLP,
  input: Matrix,
  dOutput: Matrix,
): Matrix {
  let delta = dOutput;

  for (let i = mlp.layers.length - 1; i >= 0; i--) {
    const layer = mlp.layers[i];
    const isLast = i === mlp.layers.length - 1;

    if (!isLast) {
      const dAct = matCreate(delta.rows, delta.cols);
      for (let j = 0; j < delta.data.length; j++) {
        dAct.data[j] = delta.data[j] * leakyReluDeriv(layer.z.data[j]);
      }
      delta = dAct;
    }

    // Propagate delta
    delta = matMul(delta, matTranspose(layer.W));

    if (i === 0) {
      return delta;
    }
  }
  return delta;
}

// ─────────────────────────────────────────────────────────
// Random number generation
// ─────────────────────────────────────────────────────────

function randn(): number {
  // Box-Muller transform
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
}

function randnMatrix(rows: number, cols: number): Matrix {
  const m = matCreate(rows, cols);
  for (let i = 0; i < m.data.length; i++) {
    m.data[i] = randn();
  }
  return m;
}

// ─────────────────────────────────────────────────────────
// Distribution generators
// ─────────────────────────────────────────────────────────

function generateCircle(n: number): number[][] {
  const points: number[][] = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n + randn() * 0.05;
    const r = 0.7 + randn() * 0.05;
    points.push([r * Math.cos(angle), r * Math.sin(angle)]);
  }
  return points;
}

function generateTwoMoons(n: number): number[][] {
  const points: number[][] = [];
  const half = Math.floor(n / 2);
  for (let i = 0; i < half; i++) {
    const angle = (Math.PI * i) / half;
    points.push([
      Math.cos(angle) + randn() * 0.08,
      Math.sin(angle) + randn() * 0.08,
    ]);
  }
  for (let i = 0; i < n - half; i++) {
    const angle = (Math.PI * i) / (n - half);
    points.push([
      1 - Math.cos(angle) + randn() * 0.08,
      0.5 - Math.sin(angle) + randn() * 0.08,
    ]);
  }
  // Center the distribution
  let cx = 0, cy = 0;
  for (const p of points) { cx += p[0]; cy += p[1]; }
  cx /= points.length; cy /= points.length;
  for (const p of points) { p[0] -= cx; p[1] -= cy; }
  // Scale to ~[-1, 1]
  let maxAbs = 0;
  for (const p of points) { maxAbs = Math.max(maxAbs, Math.abs(p[0]), Math.abs(p[1])); }
  const scale = 0.9 / (maxAbs + 1e-6);
  for (const p of points) { p[0] *= scale; p[1] *= scale; }
  return points;
}

function generateSpiral(n: number): number[][] {
  const points: number[][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 3 * Math.PI;
    const r = (0.1 + 0.8 * (i / n));
    points.push([
      r * Math.cos(t) + randn() * 0.04,
      r * Math.sin(t) + randn() * 0.04,
    ]);
  }
  return points;
}

function generateGrid(n: number): number[][] {
  const points: number[][] = [];
  const side = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < side; i++) {
    for (let j = 0; j < side; j++) {
      if (points.length >= n) break;
      const x = -0.8 + (1.6 * i) / (side - 1) + randn() * 0.03;
      const y = -0.8 + (1.6 * j) / (side - 1) + randn() * 0.03;
      points.push([x, y]);
    }
  }
  return points;
}

function generateGaussianMixture(n: number): number[][] {
  const points: number[][] = [];
  const centers = [
    [-0.5, -0.5],
    [-0.5, 0.5],
    [0.5, -0.5],
    [0.5, 0.5],
  ];
  const perCluster = Math.ceil(n / centers.length);
  for (const [cx, cy] of centers) {
    for (let i = 0; i < perCluster && points.length < n; i++) {
      points.push([cx + randn() * 0.12, cy + randn() * 0.12]);
    }
  }
  return points;
}

function generateDistribution(id: DistributionId, n: number): number[][] {
  switch (id) {
    case "circle": return generateCircle(n);
    case "two-moons": return generateTwoMoons(n);
    case "spiral": return generateSpiral(n);
    case "grid": return generateGrid(n);
    case "gaussian-mixture": return generateGaussianMixture(n);
  }
}

// ─────────────────────────────────────────────────────────
// Training logic
// ─────────────────────────────────────────────────────────

function sampleBatch(data: number[][], size: number): Matrix {
  const batch = matCreate(size, 2);
  for (let i = 0; i < size; i++) {
    const idx = Math.floor(Math.random() * data.length);
    matSet(batch, i, 0, data[idx][0]);
    matSet(batch, i, 1, data[idx][1]);
  }
  return batch;
}

function binaryCrossEntropy(predictions: Matrix, target: number): number {
  let loss = 0;
  const eps = 1e-7;
  for (let i = 0; i < predictions.data.length; i++) {
    const p = Math.max(eps, Math.min(1 - eps, predictions.data[i]));
    loss += target * Math.log(p) + (1 - target) * Math.log(1 - p);
  }
  return -loss / predictions.data.length;
}

function bceDeriv(predictions: Matrix, target: number): Matrix {
  const out = matCreate(predictions.rows, predictions.cols);
  const eps = 1e-7;
  for (let i = 0; i < predictions.data.length; i++) {
    const p = Math.max(eps, Math.min(1 - eps, predictions.data[i]));
    // d(BCE)/d(p) = -(target/p - (1-target)/(1-p))
    // Since last layer is sigmoid, and we're passing gradient through it:
    // d(BCE)/d(z) = p - target (combined sigmoid+BCE derivative)
    out.data[i] = p - target;
  }
  return out;
}

function trainStepGAN(
  generator: MLP,
  discriminator: MLP,
  realData: number[][],
  config: TrainingConfig,
): { gLoss: number; dLoss: number } {
  const { batchSize, noiseDim, lrG, lrD } = config;

  // ── Train Discriminator ──
  // 1. Real data: D should output 1
  const realBatch = sampleBatch(realData, batchSize);
  const dRealOut = forwardMLP(discriminator, realBatch);
  const dRealLoss = binaryCrossEntropy(dRealOut, 1);
  const dRealGrad = bceDeriv(dRealOut, 1);
  backwardMLP(discriminator, realBatch, dRealGrad, lrD);

  // 2. Fake data: D should output 0
  const noiseD = randnMatrix(batchSize, noiseDim);
  const fakeDataD = forwardMLP(generator, noiseD);
  const dFakeOut = forwardMLP(discriminator, fakeDataD);
  const dFakeLoss = binaryCrossEntropy(dFakeOut, 0);
  const dFakeGrad = bceDeriv(dFakeOut, 0);
  backwardMLP(discriminator, fakeDataD, dFakeGrad, lrD);

  const dLoss = dRealLoss + dFakeLoss;

  // ── Train Generator ──
  // Generate fake data, pass through discriminator, want D to output 1
  const noiseG = randnMatrix(batchSize, noiseDim);
  const fakeDataG = forwardMLP(generator, noiseG);
  const dOutForG = forwardMLP(discriminator, fakeDataG);
  const gLoss = binaryCrossEntropy(dOutForG, 1);

  // Backprop through discriminator to get gradient w.r.t. fake data
  const gTargetGrad = bceDeriv(dOutForG, 1);
  const dInputGrad = backwardMLPReturnInputGrad(discriminator, fakeDataG, gTargetGrad);

  // Backprop through generator
  backwardMLP(generator, noiseG, dInputGrad, lrG);

  return { gLoss, dLoss };
}

// ─────────────────────────────────────────────────────────
// Coverage metric
// ─────────────────────────────────────────────────────────

function computeCoverage(
  generated: number[][],
  target: number[][],
  threshold: number,
): number {
  if (target.length === 0) return 0;
  let covered = 0;
  for (const t of target) {
    for (const g of generated) {
      const dx = t[0] - g[0];
      const dy = t[1] - g[1];
      if (dx * dx + dy * dy < threshold * threshold) {
        covered++;
        break;
      }
    }
  }
  return covered / target.length;
}

// ─────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────

function getColor(el: HTMLElement | null, varName: string, fallback: string): string {
  if (!el) return fallback;
  return getComputedStyle(el).getPropertyValue(varName).trim() || fallback;
}

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

export default function GANPlayground() {
  // Distribution
  const [distribution, setDistribution] = useState<DistributionId>("circle");

  // Training config
  const [config, setConfig] = useState<TrainingConfig>({
    lrG: 0.01,
    lrD: 0.01,
    batchSize: 64,
    noiseDim: 2,
    speed: 5,
  });

  // State
  const [isTraining, setIsTraining] = useState(false);
  const [step, setStep] = useState(0);
  const [gLoss, setGLoss] = useState(0);
  const [dLoss, setDLoss] = useState(0);
  const [coverage, setCoverage] = useState(0);
  const [modeCollapse, setModeCollapse] = useState(false);

  // Refs
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const chartCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const generatorRef = useRef<MLP | null>(null);
  const discriminatorRef = useRef<MLP | null>(null);
  const targetDataRef = useRef<number[][]>([]);
  const lossHistoryRef = useRef<LossRecord[]>([]);
  const stepRef = useRef(0);
  const isTrainingRef = useRef(false);
  const configRef = useRef(config);
  const animFrameRef = useRef(0);

  // Keep configRef in sync
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // ── Initialize ──
  const initialize = useCallback(() => {
    const noiseDim = configRef.current.noiseDim;
    generatorRef.current = createMLP([noiseDim, 16, 16, 2], false);
    discriminatorRef.current = createMLP([2, 16, 16, 1], true);
    targetDataRef.current = generateDistribution(distribution, NUM_TARGET_POINTS);
    lossHistoryRef.current = [];
    stepRef.current = 0;
    setStep(0);
    setGLoss(0);
    setDLoss(0);
    setCoverage(0);
    setModeCollapse(false);
    setIsTraining(false);
    isTrainingRef.current = false;
    drawMain();
    drawChart();
  }, [distribution]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  // ── Drawing: main canvas ──
  const drawMain = useCallback(() => {
    const canvas = mainCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    const bg = getColor(containerRef.current, "--color-bg", "#09090b");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const disc = discriminatorRef.current;
    const gen = generatorRef.current;
    if (!disc) return;

    // Draw decision boundary heatmap
    const cellW = w / HEATMAP_RES;
    const cellH = h / HEATMAP_RES;

    for (let row = 0; row < HEATMAP_RES; row++) {
      for (let col = 0; col < HEATMAP_RES; col++) {
        const x = -1.2 + (2.4 * col) / (HEATMAP_RES - 1);
        const y = -1.2 + (2.4 * row) / (HEATMAP_RES - 1);
        const input = matCreate(1, 2);
        matSet(input, 0, 0, x);
        matSet(input, 0, 1, y);
        const out = forwardMLP(disc, input);
        const p = out.data[0]; // probability "real"

        // Blue = real (high p), Red/orange = fake (low p)
        const rr = Math.round(70 + (1 - p) * 185);
        const gg = Math.round(70 + p * 100);
        const bb = Math.round(70 + p * 177);
        const alpha = 0.1 + Math.abs(p - 0.5) * 0.3;

        ctx.fillStyle = `rgba(${rr}, ${gg}, ${bb}, ${alpha})`;
        ctx.fillRect(col * cellW, row * cellH, cellW + 1, cellH + 1);
      }
    }

    const toX = (v: number): number => ((v + 1.2) / 2.4) * w;
    const toY = (v: number): number => ((v + 1.2) / 2.4) * h;

    // Draw target data points (blue)
    const target = targetDataRef.current;
    ctx.fillStyle = COLOR_REAL;
    for (const [x, y] of target) {
      ctx.beginPath();
      ctx.arc(toX(x), toY(y), 2.5, 0, 2 * Math.PI);
      ctx.fill();
    }

    // Draw generated points (orange)
    if (gen) {
      const noise = randnMatrix(NUM_DISPLAY_GENERATED, configRef.current.noiseDim);
      const generated = forwardMLP(gen, noise);
      ctx.fillStyle = COLOR_FAKE;
      for (let i = 0; i < generated.rows; i++) {
        const gx = matGet(generated, i, 0);
        const gy = matGet(generated, i, 1);
        ctx.beginPath();
        ctx.arc(toX(gx), toY(gy), 2.5, 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    // Legend
    const legendY = h - 12;
    ctx.font = "11px Inter, sans-serif";

    ctx.fillStyle = COLOR_REAL;
    ctx.beginPath();
    ctx.arc(12, legendY, 4, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = getColor(containerRef.current, "--color-text-muted", "#a1a1aa");
    ctx.fillText("Target", 22, legendY + 4);

    ctx.fillStyle = COLOR_FAKE;
    ctx.beginPath();
    ctx.arc(80, legendY, 4, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = getColor(containerRef.current, "--color-text-muted", "#a1a1aa");
    ctx.fillText("Generated", 90, legendY + 4);
  }, []);

  // ── Drawing: loss chart ──
  const drawChart = useCallback(() => {
    const canvas = chartCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const pad = { top: 16, right: 12, bottom: 24, left: 44 };

    const surfaceColor = getColor(containerRef.current, "--color-surface", "#111111");
    ctx.fillStyle = surfaceColor;
    ctx.fillRect(0, 0, w, h);

    const history = lossHistoryRef.current;
    if (history.length < 2) {
      ctx.fillStyle = "rgba(161, 161, 170, 0.3)";
      ctx.font = "12px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Loss curves will appear here", w / 2, h / 2);
      return;
    }

    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    // Find y range
    let maxLoss = 0;
    for (const rec of history) {
      maxLoss = Math.max(maxLoss, rec.gLoss, rec.dLoss);
    }
    maxLoss = Math.min(maxLoss * 1.1, 10);
    if (maxLoss < 0.1) maxLoss = 0.1;

    // Draw grid lines
    const mutedColor = getColor(containerRef.current, "--color-text-muted", "#a1a1aa");
    ctx.strokeStyle = "rgba(161, 161, 170, 0.15)";
    ctx.lineWidth = 1;
    const numGridLines = 4;
    ctx.font = "10px Inter, sans-serif";
    ctx.fillStyle = mutedColor;
    ctx.textAlign = "right";

    for (let i = 0; i <= numGridLines; i++) {
      const y = pad.top + (plotH * i) / numGridLines;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      const val = maxLoss * (1 - i / numGridLines);
      ctx.fillText(val.toFixed(1), pad.left - 6, y + 4);
    }

    // Draw loss curves
    const drawCurve = (key: "gLoss" | "dLoss", color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const x = pad.left + (plotW * i) / (history.length - 1);
        const val = Math.min(history[i][key], maxLoss);
        const y = pad.top + plotH * (1 - val / maxLoss);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    drawCurve("gLoss", COLOR_G_LOSS);
    drawCurve("dLoss", COLOR_D_LOSS);

    // Legend
    ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "left";
    const lx = pad.left + 8;
    ctx.fillStyle = COLOR_G_LOSS;
    ctx.fillRect(lx, pad.top + 4, 12, 3);
    ctx.fillStyle = mutedColor;
    ctx.fillText("G Loss", lx + 16, pad.top + 10);

    ctx.fillStyle = COLOR_D_LOSS;
    ctx.fillRect(lx + 70, pad.top + 4, 12, 3);
    ctx.fillStyle = mutedColor;
    ctx.fillText("D Loss", lx + 86, pad.top + 10);

    // Step label
    ctx.textAlign = "center";
    ctx.fillStyle = mutedColor;
    ctx.fillText(`Step ${history[history.length - 1]?.step ?? 0}`, w / 2, h - 4);
  }, []);

  // ── Training loop ──
  const trainingLoop = useCallback(() => {
    if (!isTrainingRef.current) return;

    const gen = generatorRef.current;
    const disc = discriminatorRef.current;
    const target = targetDataRef.current;
    if (!gen || !disc || target.length === 0) return;

    const stepsPerFrame = configRef.current.speed;

    for (let s = 0; s < stepsPerFrame; s++) {
      const result = trainStepGAN(gen, disc, target, configRef.current);
      stepRef.current++;

      lossHistoryRef.current.push({
        step: stepRef.current,
        gLoss: result.gLoss,
        dLoss: result.dLoss,
      });

      if (lossHistoryRef.current.length > MAX_LOSS_HISTORY) {
        lossHistoryRef.current.shift();
      }
    }

    // Update coverage metric every 10 frames
    const lastRecord = lossHistoryRef.current[lossHistoryRef.current.length - 1];
    if (stepRef.current % 20 === 0) {
      const noise = randnMatrix(256, configRef.current.noiseDim);
      const generated = forwardMLP(gen, noise);
      const genPoints: number[][] = [];
      for (let i = 0; i < generated.rows; i++) {
        genPoints.push([matGet(generated, i, 0), matGet(generated, i, 1)]);
      }
      const cov = computeCoverage(genPoints, target, COVERAGE_THRESHOLD);
      setCoverage(cov);
      setModeCollapse(cov < 0.3);
    }

    setStep(stepRef.current);
    setGLoss(lastRecord?.gLoss ?? 0);
    setDLoss(lastRecord?.dLoss ?? 0);

    drawMain();
    drawChart();

    animFrameRef.current = requestAnimationFrame(trainingLoop);
  }, [drawMain, drawChart]);

  // Start/stop training
  const toggleTraining = useCallback(() => {
    if (isTrainingRef.current) {
      isTrainingRef.current = false;
      setIsTraining(false);
      cancelAnimationFrame(animFrameRef.current);
    } else {
      isTrainingRef.current = true;
      setIsTraining(true);
      animFrameRef.current = requestAnimationFrame(trainingLoop);
    }
  }, [trainingLoop]);

  // Single step
  const singleStep = useCallback(() => {
    if (isTrainingRef.current) return;

    const gen = generatorRef.current;
    const disc = discriminatorRef.current;
    const target = targetDataRef.current;
    if (!gen || !disc || target.length === 0) return;

    const result = trainStepGAN(gen, disc, target, configRef.current);
    stepRef.current++;

    lossHistoryRef.current.push({
      step: stepRef.current,
      gLoss: result.gLoss,
      dLoss: result.dLoss,
    });

    if (lossHistoryRef.current.length > MAX_LOSS_HISTORY) {
      lossHistoryRef.current.shift();
    }

    setStep(stepRef.current);
    setGLoss(result.gLoss);
    setDLoss(result.dLoss);

    // Update coverage
    const noise = randnMatrix(256, configRef.current.noiseDim);
    const generated = forwardMLP(gen, noise);
    const genPoints: number[][] = [];
    for (let i = 0; i < generated.rows; i++) {
      genPoints.push([matGet(generated, i, 0), matGet(generated, i, 1)]);
    }
    const cov = computeCoverage(genPoints, target, COVERAGE_THRESHOLD);
    setCoverage(cov);
    setModeCollapse(cov < 0.3);

    drawMain();
    drawChart();
  }, [drawMain, drawChart]);

  // Apply preset
  const applyPreset = useCallback((presetId: PresetId) => {
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setConfig((prev) => ({ ...prev, ...preset.config }));
    configRef.current = { ...configRef.current, ...preset.config };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      isTrainingRef.current = false;
    };
  }, []);

  // Redraw on theme change
  useEffect(() => {
    const observer = new MutationObserver(() => {
      drawMain();
      drawChart();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [drawMain, drawChart]);

  // ── UI Panel Styles ──
  const panelStyle = "rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4";
  const labelStyle = "block text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)] mb-1";
  const selectStyle =
    "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none";
  const btnPrimary =
    "rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40";
  const btnSecondary =
    "rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)]";
  const sliderStyle = "w-full accent-[var(--color-primary)]";

  return (
    <div ref={containerRef} class="space-y-4">
      {/* Controls Row */}
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Distribution */}
        <div class={panelStyle}>
          <label class={labelStyle}>Target Distribution</label>
          <select
            class={selectStyle}
            value={distribution}
            onChange={(e) => {
              const val = (e.target as HTMLSelectElement).value as DistributionId;
              setDistribution(val);
            }}
            disabled={isTraining}
          >
            {DISTRIBUTIONS.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
        </div>

        {/* Presets */}
        <div class={panelStyle}>
          <label class={labelStyle}>Presets</label>
          <select
            class={selectStyle}
            onChange={(e) => {
              const val = (e.target as HTMLSelectElement).value as PresetId;
              if (val) applyPreset(val);
            }}
          >
            <option value="">Select preset...</option>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>

        {/* Batch Size */}
        <div class={panelStyle}>
          <label class={labelStyle}>Batch Size: {config.batchSize}</label>
          <input
            type="range"
            class={sliderStyle}
            min={16}
            max={128}
            step={16}
            value={config.batchSize}
            onInput={(e) => {
              const v = parseInt((e.target as HTMLInputElement).value);
              setConfig((c) => ({ ...c, batchSize: v }));
            }}
          />
        </div>

        {/* Noise Dimension */}
        <div class={panelStyle}>
          <label class={labelStyle}>Noise Dim: {config.noiseDim}</label>
          <input
            type="range"
            class={sliderStyle}
            min={2}
            max={16}
            step={2}
            value={config.noiseDim}
            onInput={(e) => {
              const v = parseInt((e.target as HTMLInputElement).value);
              setConfig((c) => ({ ...c, noiseDim: v }));
            }}
            disabled={isTraining}
          />
        </div>
      </div>

      {/* Learning Rates & Speed */}
      <div class="grid gap-4 sm:grid-cols-3">
        <div class={panelStyle}>
          <label class={labelStyle}>Generator LR: {config.lrG.toFixed(3)}</label>
          <input
            type="range"
            class={sliderStyle}
            min={0.001}
            max={0.1}
            step={0.001}
            value={config.lrG}
            onInput={(e) => {
              const v = parseFloat((e.target as HTMLInputElement).value);
              setConfig((c) => ({ ...c, lrG: v }));
            }}
          />
        </div>

        <div class={panelStyle}>
          <label class={labelStyle}>Discriminator LR: {config.lrD.toFixed(3)}</label>
          <input
            type="range"
            class={sliderStyle}
            min={0.001}
            max={0.1}
            step={0.001}
            value={config.lrD}
            onInput={(e) => {
              const v = parseFloat((e.target as HTMLInputElement).value);
              setConfig((c) => ({ ...c, lrD: v }));
            }}
          />
        </div>

        <div class={panelStyle}>
          <label class={labelStyle}>Speed: {config.speed} steps/frame</label>
          <input
            type="range"
            class={sliderStyle}
            min={1}
            max={20}
            step={1}
            value={config.speed}
            onInput={(e) => {
              const v = parseInt((e.target as HTMLInputElement).value);
              setConfig((c) => ({ ...c, speed: v }));
            }}
          />
        </div>
      </div>

      {/* Action Buttons */}
      <div class="flex flex-wrap items-center gap-3">
        <button class={btnPrimary} onClick={toggleTraining}>
          {isTraining ? "Pause" : step > 0 ? "Resume" : "Train"}
        </button>
        <button class={btnSecondary} onClick={singleStep} disabled={isTraining}>
          Step
        </button>
        <button class={btnSecondary} onClick={initialize}>
          Reset
        </button>

        {/* Metrics */}
        <div class="ml-auto flex flex-wrap items-center gap-4 text-xs text-[var(--color-text-muted)]">
          <span>Step: <strong class="text-[var(--color-heading)]">{step}</strong></span>
          <span>G Loss: <strong style={{ color: COLOR_G_LOSS }}>{gLoss.toFixed(3)}</strong></span>
          <span>D Loss: <strong style={{ color: COLOR_D_LOSS }}>{dLoss.toFixed(3)}</strong></span>
          <span>
            Coverage: <strong class="text-[var(--color-heading)]">{(coverage * 100).toFixed(0)}%</strong>
            {modeCollapse && step > 50 && (
              <span class="ml-1 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-400">
                MODE COLLAPSE
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Visualizations */}
      <div class="grid gap-4 lg:grid-cols-5">
        {/* Main Canvas (decision boundary + points) */}
        <div class={"lg:col-span-3 " + panelStyle}>
          <div class="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Decision Boundary & Points
          </div>
          <canvas
            ref={mainCanvasRef}
            width={500}
            height={500}
            class="w-full rounded-lg"
            style={{ aspectRatio: "1", imageRendering: "auto" }}
          />
        </div>

        {/* Loss Chart */}
        <div class={"lg:col-span-2 " + panelStyle}>
          <div class="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Loss Curves
          </div>
          <canvas
            ref={chartCanvasRef}
            width={400}
            height={250}
            class="w-full rounded-lg"
          />

          {/* Coverage Bar */}
          <div class="mt-4">
            <div class="mb-1 flex items-center justify-between text-xs text-[var(--color-text-muted)]">
              <span>Target Coverage</span>
              <span class="font-semibold text-[var(--color-heading)]">{(coverage * 100).toFixed(0)}%</span>
            </div>
            <div class="h-2 w-full overflow-hidden rounded-full bg-[var(--color-bg)]">
              <div
                class="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${coverage * 100}%`,
                  backgroundColor: coverage > 0.6 ? COLOR_G_LOSS : coverage > 0.3 ? COLOR_FAKE : COLOR_D_LOSS,
                }}
              />
            </div>
          </div>

          {/* Info */}
          <div class="mt-4 space-y-2 text-xs text-[var(--color-text-muted)]">
            <div class="flex items-start gap-2">
              <span class="mt-0.5 inline-block h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: COLOR_REAL }} />
              <span><strong>Blue</strong> in heatmap = discriminator thinks "real"</span>
            </div>
            <div class="flex items-start gap-2">
              <span class="mt-0.5 inline-block h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: "#c44" }} />
              <span><strong>Red</strong> in heatmap = discriminator thinks "fake"</span>
            </div>
            <p class="mt-2 text-[var(--color-text-muted)] opacity-70">
              Try the "Mode Collapse" preset to see the generator fixate on a single mode.
              "D Dominance" shows what happens when the discriminator learns too fast.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
