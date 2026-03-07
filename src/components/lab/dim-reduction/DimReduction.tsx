import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

interface Point {
  features: number[];
  label: number;
}

interface Point2D {
  x: number;
  y: number;
  label: number;
}

interface DatasetDef {
  id: string;
  name: string;
  description: string;
  generate: () => Point[];
  numClasses: number;
}

type MethodId = "pca" | "tsne" | "force";

interface MethodDef {
  id: MethodId;
  name: string;
  description: string;
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const CANVAS_W = 500;
const CANVAS_H = 400;
const POINT_RADIUS = 3.5;

const CLASS_COLORS = [
  "#4f8ff7", "#34d399", "#f59e0b", "#ef4444", "#a855f7",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

const METHODS: MethodDef[] = [
  { id: "pca", name: "PCA", description: "Principal Component Analysis (linear projection)" },
  { id: "tsne", name: "t-SNE", description: "t-Distributed Stochastic Neighbor Embedding" },
  { id: "force", name: "Force-Directed", description: "UMAP-like force-directed layout" },
];

// ─────────────────────────────────────────────────────────
// Pseudorandom Number Generator
// ─────────────────────────────────────────────────────────

function createRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

function gaussianRng(rng: () => number): number {
  const u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
}

// ─────────────────────────────────────────────────────────
// Synthetic Datasets
// ─────────────────────────────────────────────────────────

function generateIris(): Point[] {
  const rng = createRng(42);
  const gauss = () => gaussianRng(rng);
  const points: Point[] = [];
  // 3 classes, 4 features each
  const centers = [
    [5.0, 3.4, 1.5, 0.2],
    [5.9, 2.8, 4.3, 1.3],
    [6.6, 3.0, 5.6, 2.0],
  ];
  const spreads = [
    [0.35, 0.38, 0.17, 0.1],
    [0.52, 0.31, 0.47, 0.2],
    [0.64, 0.32, 0.55, 0.27],
  ];
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < 50; i++) {
      points.push({
        features: centers[c].map((m, d) => m + gauss() * spreads[c][d]),
        label: c,
      });
    }
  }
  return points;
}

function generateBlobs(): Point[] {
  const rng = createRng(123);
  const gauss = () => gaussianRng(rng);
  const points: Point[] = [];
  const centers = [
    [2, 3, 1, -1, 0],
    [-2, -1, 3, 2, 1],
    [0, -3, -2, 3, -1],
    [3, 1, -3, -2, 2],
  ];
  for (let c = 0; c < 4; c++) {
    for (let i = 0; i < 40; i++) {
      points.push({
        features: centers[c].map((m) => m + gauss() * 0.7),
        label: c,
      });
    }
  }
  return points;
}

function generateSwissRoll(): Point[] {
  const rng = createRng(77);
  const points: Point[] = [];
  for (let i = 0; i < 150; i++) {
    const t = 1.5 * Math.PI * (1 + 2 * rng());
    const x = t * Math.cos(t);
    const y = 10 * rng();
    const z = t * Math.sin(t);
    const label = t < 7 ? 0 : t < 11 ? 1 : 2;
    points.push({ features: [x, y, z], label });
  }
  return points;
}

function generateCircles(): Point[] {
  const rng = createRng(99);
  const points: Point[] = [];
  for (let i = 0; i < 100; i++) {
    const angle = rng() * 2 * Math.PI;
    const r = 1.0 + gaussianRng(rng) * 0.1;
    points.push({
      features: [r * Math.cos(angle), r * Math.sin(angle)],
      label: 0,
    });
  }
  for (let i = 0; i < 100; i++) {
    const angle = rng() * 2 * Math.PI;
    const r = 3.0 + gaussianRng(rng) * 0.15;
    points.push({
      features: [r * Math.cos(angle), r * Math.sin(angle)],
      label: 1,
    });
  }
  return points;
}

const DATASETS: DatasetDef[] = [
  { id: "iris", name: "Iris (4D)", description: "3 classes, 4 features", generate: generateIris, numClasses: 3 },
  { id: "blobs", name: "Blobs (5D)", description: "4 clusters, 5 features", generate: generateBlobs, numClasses: 4 },
  { id: "swiss", name: "Swiss Roll (3D)", description: "3D manifold, 3 classes", generate: generateSwissRoll, numClasses: 3 },
  { id: "circles", name: "Circles (2D)", description: "2 concentric rings", generate: generateCircles, numClasses: 2 },
];

// ─────────────────────────────────────────────────────────
// PCA
// ─────────────────────────────────────────────────────────

function runPCA(points: Point[]): { projected: Point2D[]; varianceRatio: number[] } {
  const n = points.length;
  const d = points[0].features.length;

  // Center data
  const mean = new Array(d).fill(0);
  for (const p of points) {
    for (let j = 0; j < d; j++) mean[j] += p.features[j];
  }
  for (let j = 0; j < d; j++) mean[j] /= n;

  const centered = points.map((p) => p.features.map((f, j) => f - mean[j]));

  // Covariance matrix
  const cov: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < d; a++) {
      for (let b = a; b < d; b++) {
        const v = centered[i][a] * centered[i][b];
        cov[a][b] += v;
        if (a !== b) cov[b][a] += v;
      }
    }
  }
  for (let a = 0; a < d; a++) {
    for (let b = 0; b < d; b++) {
      cov[a][b] /= n - 1;
    }
  }

  // Power iteration for top 2 eigenvectors
  const eigenvectors: number[][] = [];
  const eigenvalues: number[] = [];
  const covCopy = cov.map((row) => [...row]);

  for (let ev = 0; ev < Math.min(2, d); ev++) {
    let vec: number[] = new Array(d).fill(0).map((_, i) => (i === ev ? 1 : 0.1));
    let eigenvalue = 0;

    for (let iter = 0; iter < 200; iter++) {
      // Matrix-vector multiply
      const newVec = new Array(d).fill(0);
      for (let i = 0; i < d; i++) {
        for (let j = 0; j < d; j++) {
          newVec[i] += covCopy[i][j] * vec[j];
        }
      }

      // Normalize
      const norm = Math.sqrt(newVec.reduce((s, v) => s + v * v, 0)) || 1;
      eigenvalue = norm;
      vec = newVec.map((v) => v / norm);
    }

    eigenvectors.push(vec);
    eigenvalues.push(eigenvalue);

    // Deflate: subtract out this component
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) {
        covCopy[i][j] -= eigenvalue * vec[i] * vec[j];
      }
    }
  }

  // Project
  const totalVariance = eigenvalues.reduce((s, v) => s + v, 0) || 1;
  const varianceRatio = eigenvalues.map((v) => v / totalVariance);

  const projected: Point2D[] = points.map((p, idx) => {
    const c = centered[idx];
    const x = c.reduce((s, v, j) => s + v * eigenvectors[0][j], 0);
    const y = eigenvectors.length > 1
      ? c.reduce((s, v, j) => s + v * eigenvectors[1][j], 0)
      : 0;
    return { x, y, label: p.label };
  });

  return { projected, varianceRatio };
}

// ─────────────────────────────────────────────────────────
// t-SNE (simplified)
// ─────────────────────────────────────────────────────────

function euclideanDist(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function runTSNEStep(
  points: Point[],
  positions: Point2D[],
  perplexity: number,
  pairwiseP: number[][] | null,
  iteration: number
): { positions: Point2D[]; pairwiseP: number[][] } {
  const n = points.length;
  const lr = 10;
  const momentum = iteration < 250 ? 0.5 : 0.8;

  // Compute pairwise P if not cached
  if (!pairwiseP) {
    pairwiseP = computePairwiseP(points, perplexity);
  }

  // Compute Q (student-t in low dimensions)
  const qNum: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  let qSum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = positions[i].x - positions[j].x;
      const dy = positions[i].y - positions[j].y;
      const val = 1 / (1 + dx * dx + dy * dy);
      qNum[i][j] = val;
      qNum[j][i] = val;
      qSum += 2 * val;
    }
  }
  qSum = Math.max(qSum, 1e-10);

  // Compute gradients
  const gradX = new Array(n).fill(0);
  const gradY = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const pij = pairwiseP[i][j];
      const qij = qNum[i][j] / qSum;
      const mult = 4 * (pij - qij) * qNum[i][j];
      gradX[i] += mult * (positions[i].x - positions[j].x);
      gradY[i] += mult * (positions[i].y - positions[j].y);
    }
  }

  // Update positions
  const newPositions = positions.map((p, i) => ({
    x: p.x - lr * gradX[i] + momentum * (p.x - (positions[i].x || 0)) * 0.01,
    y: p.y - lr * gradY[i] + momentum * (p.y - (positions[i].y || 0)) * 0.01,
    label: p.label,
  }));

  return { positions: newPositions, pairwiseP };
}

function computePairwiseP(points: Point[], perplexity: number): number[][] {
  const n = points.length;
  const dists: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = euclideanDist(points[i].features, points[j].features);
      dists[i][j] = d;
      dists[j][i] = d;
    }
  }

  // Compute conditional probabilities with binary search for sigma
  const P: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const targetEntropy = Math.log(perplexity);

  for (let i = 0; i < n; i++) {
    let sigmaLow = 1e-10;
    let sigmaHigh = 1e4;
    let sigma = 1;

    for (let iter = 0; iter < 50; iter++) {
      sigma = (sigmaLow + sigmaHigh) / 2;
      let sumExp = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        sumExp += Math.exp(-dists[i][j] * dists[i][j] / (2 * sigma * sigma));
      }
      sumExp = Math.max(sumExp, 1e-10);

      let entropy = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const pj = Math.exp(-dists[i][j] * dists[i][j] / (2 * sigma * sigma)) / sumExp;
        if (pj > 1e-10) entropy -= pj * Math.log(pj);
      }

      if (entropy > targetEntropy) sigmaHigh = sigma;
      else sigmaLow = sigma;
    }

    let sumExp = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      sumExp += Math.exp(-dists[i][j] * dists[i][j] / (2 * sigma * sigma));
    }
    sumExp = Math.max(sumExp, 1e-10);

    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      P[i][j] = Math.exp(-dists[i][j] * dists[i][j] / (2 * sigma * sigma)) / sumExp;
    }
  }

  // Symmetrize
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sym = (P[i][j] + P[j][i]) / (2 * n);
      P[i][j] = Math.max(sym, 1e-12);
      P[j][i] = Math.max(sym, 1e-12);
    }
  }

  return P;
}

// ─────────────────────────────────────────────────────────
// Force-Directed (UMAP-like)
// ─────────────────────────────────────────────────────────

function runForceStep(
  points: Point[],
  positions: Point2D[],
  kNeighbors: number
): Point2D[] {
  const n = points.length;

  // Compute k-nearest neighbors in high-dim
  const neighbors: number[][] = [];
  for (let i = 0; i < n; i++) {
    const dists = points.map((p, j) => ({
      j,
      d: euclideanDist(points[i].features, p.features),
    }));
    dists.sort((a, b) => a.d - b.d);
    neighbors.push(dists.slice(1, kNeighbors + 1).map((x) => x.j));
  }

  // Attractive forces (neighbors pull together)
  const fx = new Array(n).fill(0);
  const fy = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    for (const j of neighbors[i]) {
      const dx = positions[j].x - positions[i].x;
      const dy = positions[j].y - positions[i].y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 1e-6;
      const force = 0.05 * Math.log(dist + 1);
      fx[i] += force * dx / dist;
      fy[i] += force * dy / dist;
    }
  }

  // Repulsive forces (all pairs push apart, approximated with nearby non-neighbors)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = positions[j].x - positions[i].x;
      const dy = positions[j].y - positions[i].y;
      const distSq = dx * dx + dy * dy + 0.01;
      const force = -0.5 / distSq;
      fx[i] += force * dx;
      fy[i] += force * dy;
      fx[j] -= force * dx;
      fy[j] -= force * dy;
    }
  }

  return positions.map((p, i) => ({
    x: p.x + fx[i] * 0.5,
    y: p.y + fy[i] * 0.5,
    label: p.label,
  }));
}

// ─────────────────────────────────────────────────────────
// Silhouette Score (approximation)
// ─────────────────────────────────────────────────────────

function computeSilhouette(projected: Point2D[]): number {
  const n = projected.length;
  if (n < 3) return 0;

  const labels = [...new Set(projected.map((p) => p.label))];
  if (labels.length < 2) return 0;

  let totalSilhouette = 0;
  const sampleSize = Math.min(n, 80);
  const step = Math.max(1, Math.floor(n / sampleSize));

  for (let idx = 0; idx < n; idx += step) {
    const p = projected[idx];
    const intraDistances: number[] = [];
    const interDistances: Map<number, number[]> = new Map();

    for (let j = 0; j < n; j++) {
      if (j === idx) continue;
      const d = Math.sqrt((p.x - projected[j].x) ** 2 + (p.y - projected[j].y) ** 2);
      if (projected[j].label === p.label) {
        intraDistances.push(d);
      } else {
        if (!interDistances.has(projected[j].label)) {
          interDistances.set(projected[j].label, []);
        }
        interDistances.get(projected[j].label)!.push(d);
      }
    }

    const a = intraDistances.length > 0
      ? intraDistances.reduce((s, v) => s + v, 0) / intraDistances.length
      : 0;

    let minB = Infinity;
    for (const [, dists] of interDistances) {
      const avgDist = dists.reduce((s, v) => s + v, 0) / dists.length;
      if (avgDist < minB) minB = avgDist;
    }
    if (!Number.isFinite(minB)) minB = 0;

    const maxAB = Math.max(a, minB);
    const silhouette = maxAB > 0 ? (minB - a) / maxAB : 0;
    totalSilhouette += silhouette;
  }

  return totalSilhouette / Math.ceil(n / step);
}

// ─────────────────────────────────────────────────────────
// Canvas Drawing
// ─────────────────────────────────────────────────────────

function drawScatter(
  canvas: HTMLCanvasElement,
  projected: Point2D[],
  numClasses: number
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (projected.length === 0) return;

  // Find bounds
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const p of projected) {
    if (p.x < xMin) xMin = p.x;
    if (p.x > xMax) xMax = p.x;
    if (p.y < yMin) yMin = p.y;
    if (p.y > yMax) yMax = p.y;
  }

  const pad = 30;
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  const margin = 0.1;
  xMin -= xRange * margin;
  xMax += xRange * margin;
  yMin -= yRange * margin;
  yMax += yRange * margin;

  // Grid
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 8; i++) {
    const x = pad + (i / 8) * (w - 2 * pad);
    const y = pad + (i / 8) * (h - 2 * pad);
    ctx.beginPath();
    ctx.moveTo(x, pad);
    ctx.lineTo(x, h - pad);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(w - pad, y);
    ctx.stroke();
  }

  // Points
  for (const p of projected) {
    const cx = pad + ((p.x - xMin) / (xMax - xMin)) * (w - 2 * pad);
    const cy = h - pad - ((p.y - yMin) / (yMax - yMin)) * (h - 2 * pad);
    const color = CLASS_COLORS[p.label % CLASS_COLORS.length];

    ctx.beginPath();
    ctx.arc(cx, cy, POINT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.8;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
}

// ─────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────

const btnBase =
  "px-3 py-1.5 text-xs font-medium rounded border transition-colors cursor-pointer";
const btnActive = `${btnBase} bg-[var(--color-primary)] text-white border-[var(--color-primary)]`;
const btnInactive = `${btnBase} bg-transparent text-[var(--color-text-muted)] border-[var(--color-border)] hover:text-[var(--color-heading)] hover:border-[var(--color-text-muted)]`;
const labelStyle = "block text-[10px] font-medium text-[var(--color-text-muted)] mb-1";
const statLabel = "text-[10px] text-[var(--color-text-muted)]";
const statValue = "text-sm font-semibold text-[var(--color-heading)]";

// ─────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────

export default function DimReduction() {
  const [datasetIdx, setDatasetIdx] = useState(0);
  const [method, setMethod] = useState<MethodId>("pca");
  const [perplexity, setPerplexity] = useState(20);
  const [projected, setProjected] = useState<Point2D[]>([]);
  const [isAnimating, setIsAnimating] = useState(false);
  const [iteration, setIteration] = useState(0);
  const [varianceRatio, setVarianceRatio] = useState<number[]>([]);
  const [runtime, setRuntime] = useState(0);
  const [silhouette, setSilhouette] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const tsneStateRef = useRef<{ positions: Point2D[]; pairwiseP: number[][] | null }>({
    positions: [],
    pairwiseP: null,
  });

  const dataset = DATASETS[datasetIdx];
  const data = useMemo(() => dataset.generate(), [datasetIdx]);

  // Initial random positions for iterative methods
  const initPositions = useCallback((): Point2D[] => {
    const rng = createRng(42);
    return data.map((p) => ({
      x: (rng() - 0.5) * 2,
      y: (rng() - 0.5) * 2,
      label: p.label,
    }));
  }, [data]);

  // Run PCA (instant)
  const runPCAMethod = useCallback(() => {
    const start = performance.now();
    const result = runPCA(data);
    const elapsed = performance.now() - start;
    setProjected(result.projected);
    setVarianceRatio(result.varianceRatio);
    setRuntime(elapsed);
    setSilhouette(computeSilhouette(result.projected));
    setIteration(0);
    setIsAnimating(false);
  }, [data]);

  // Run t-SNE (animated)
  const startTSNE = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const positions = initPositions();
    tsneStateRef.current = { positions, pairwiseP: null };
    setProjected(positions);
    setIteration(0);
    setIsAnimating(true);

    const startTime = performance.now();
    let iter = 0;

    const step = () => {
      const result = runTSNEStep(
        data,
        tsneStateRef.current.positions,
        perplexity,
        tsneStateRef.current.pairwiseP,
        iter
      );
      tsneStateRef.current = { positions: result.positions, pairwiseP: result.pairwiseP };
      setProjected([...result.positions]);
      iter++;
      setIteration(iter);
      setRuntime(performance.now() - startTime);

      if (iter < 300) {
        animRef.current = requestAnimationFrame(step);
      } else {
        setIsAnimating(false);
        setSilhouette(computeSilhouette(result.positions));
      }
    };

    animRef.current = requestAnimationFrame(step);
  }, [data, perplexity, initPositions]);

  // Run Force-directed (animated)
  const startForce = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    let positions = initPositions();
    setProjected(positions);
    setIteration(0);
    setIsAnimating(true);

    const startTime = performance.now();
    let iter = 0;

    const step = () => {
      positions = runForceStep(data, positions, 10);
      setProjected([...positions]);
      iter++;
      setIteration(iter);
      setRuntime(performance.now() - startTime);

      if (iter < 200) {
        animRef.current = requestAnimationFrame(step);
      } else {
        setIsAnimating(false);
        setSilhouette(computeSilhouette(positions));
      }
    };

    animRef.current = requestAnimationFrame(step);
  }, [data, initPositions]);

  // Run the selected method
  const runMethod = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    setIsAnimating(false);

    switch (method) {
      case "pca":
        runPCAMethod();
        break;
      case "tsne":
        startTSNE();
        break;
      case "force":
        startForce();
        break;
    }
  }, [method, runPCAMethod, startTSNE, startForce]);

  // Auto-run on changes
  useEffect(() => {
    runMethod();
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [method, datasetIdx, perplexity]);

  // Draw
  useEffect(() => {
    if (canvasRef.current) {
      drawScatter(canvasRef.current, projected, dataset.numClasses);
    }
  }, [projected, dataset.numClasses]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  const handleStop = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    setIsAnimating(false);
    setSilhouette(computeSilhouette(projected));
  }, [projected]);

  return (
    <div class="space-y-4">
      {/* Dataset selector */}
      <div class="flex flex-wrap gap-2">
        {DATASETS.map((ds, i) => (
          <button
            key={ds.id}
            class={i === datasetIdx ? btnActive : btnInactive}
            onClick={() => setDatasetIdx(i)}
          >
            {ds.name}
          </button>
        ))}
      </div>

      {/* Method tabs */}
      <div class="flex flex-wrap gap-2">
        {METHODS.map((m) => (
          <button
            key={m.id}
            class={method === m.id ? btnActive : btnInactive}
            onClick={() => setMethod(m.id)}
          >
            {m.name}
          </button>
        ))}
        {isAnimating && (
          <button class={btnInactive} onClick={handleStop}>
            Stop
          </button>
        )}
      </div>

      {/* Method-specific controls */}
      {method === "tsne" && (
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <label class={labelStyle}>
            Perplexity: {perplexity}
          </label>
          <input
            type="range"
            min="5"
            max="50"
            step="1"
            value={perplexity}
            onInput={(e) => setPerplexity(parseInt((e.target as HTMLInputElement).value, 10))}
            class="w-full max-w-xs accent-[var(--color-primary)]"
          />
          <p class="text-[10px] text-[var(--color-text-muted)] mt-1">
            Higher perplexity considers more neighbors. Typical: 5-50.
          </p>
        </div>
      )}

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Canvas */}
        <div class="lg:col-span-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            class="w-full"
            style={{ imageRendering: "auto" }}
          />
          {/* Legend */}
          <div class="flex flex-wrap gap-3 mt-2 px-1">
            {Array.from({ length: dataset.numClasses }, (_, i) => (
              <div key={i} class="flex items-center gap-1">
                <span
                  class="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ background: CLASS_COLORS[i % CLASS_COLORS.length] }}
                />
                <span class="text-[10px] text-[var(--color-text-muted)]">Class {i}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Stats panel */}
        <div class="space-y-3">
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div class={statLabel}>Method</div>
            <div class={statValue}>{METHODS.find((m) => m.id === method)?.name}</div>
            <div class="text-[10px] text-[var(--color-text-muted)] mt-1">
              {METHODS.find((m) => m.id === method)?.description}
            </div>
          </div>

          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div class={statLabel}>Silhouette Score</div>
            <div class={statValue}>{silhouette.toFixed(3)}</div>
          </div>

          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div class={statLabel}>Runtime</div>
            <div class={statValue}>{runtime.toFixed(0)} ms</div>
          </div>

          {(method === "tsne" || method === "force") && (
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <div class={statLabel}>Iteration</div>
              <div class={statValue}>
                {iteration}{isAnimating && <span class="text-[var(--color-accent)] ml-1">running</span>}
              </div>
            </div>
          )}

          {method === "pca" && varianceRatio.length > 0 && (
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <div class={statLabel}>Explained Variance</div>
              <div class="space-y-1.5 mt-1">
                {varianceRatio.map((v, i) => (
                  <div key={i}>
                    <div class="flex justify-between text-[10px] text-[var(--color-text-muted)]">
                      <span>PC{i + 1}</span>
                      <span>{(v * 100).toFixed(1)}%</span>
                    </div>
                    <div class="h-1.5 rounded-full bg-[var(--color-border)] mt-0.5">
                      <div
                        class="h-full rounded-full"
                        style={{
                          width: `${v * 100}%`,
                          background: CLASS_COLORS[i],
                        }}
                      />
                    </div>
                  </div>
                ))}
                <div class="flex justify-between text-[10px] font-medium text-[var(--color-heading)] mt-1">
                  <span>Total</span>
                  <span>{(varianceRatio.reduce((s, v) => s + v, 0) * 100).toFixed(1)}%</span>
                </div>
              </div>
            </div>
          )}

          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div class={statLabel}>Dataset</div>
            <div class="text-xs text-[var(--color-heading)]">{dataset.name}</div>
            <div class="text-[10px] text-[var(--color-text-muted)] mt-0.5">
              {data.length} points, {data[0].features.length}D
            </div>
            <div class="text-[10px] text-[var(--color-text-muted)]">
              {dataset.description}
            </div>
          </div>
        </div>
      </div>

      {/* Info */}
      <div class="text-xs text-[var(--color-text-muted)] leading-relaxed">
        Dimensionality reduction projects high-dimensional data into 2D for visualization.
        PCA finds linear projections maximizing variance. t-SNE preserves local neighborhood
        structure using probabilistic distances. Force-directed layout uses attractive forces
        between neighbors and repulsive forces between all points, similar to UMAP.
      </div>
    </div>
  );
}
