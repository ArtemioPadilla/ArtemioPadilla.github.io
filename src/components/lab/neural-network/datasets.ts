/**
 * Toy 2D datasets for binary classification.
 *
 * Each generator produces ~200-300 data points in the range [-1, 1].
 * All points include a noise parameter for adjustable difficulty.
 */

export interface DataPoint {
  x: number;
  y: number;
  label: number; // 0 or 1
}

export type DatasetName =
  | "circle"
  | "xor"
  | "spiral"
  | "gaussian"
  | "moon"
  | "linear";

export const DATASET_LABELS: Record<DatasetName, string> = {
  circle: "Circle",
  xor: "XOR",
  spiral: "Spiral",
  gaussian: "Gaussian",
  moon: "Moon",
  linear: "Linear",
};

/* ──────────────────────────────────────
   Helpers
   ────────────────────────────────────── */

function gaussianRandom(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function addNoise(value: number, noise: number): number {
  return value + gaussianRandom() * noise;
}

/* ──────────────────────────────────────
   Dataset generators
   ────────────────────────────────────── */

function generateCircle(noise: number): DataPoint[] {
  const points: DataPoint[] = [];
  const n = 250;
  const radius = 0.5;

  for (let i = 0; i < n; i++) {
    const angle = Math.random() * 2 * Math.PI;
    const r = Math.random() * 1.2;
    const x = addNoise(r * Math.cos(angle), noise * 0.1);
    const y = addNoise(r * Math.sin(angle), noise * 0.1);
    const label = r < radius ? 1 : 0;
    points.push({ x, y, label });
  }

  return points;
}

function generateXor(noise: number): DataPoint[] {
  const points: DataPoint[] = [];
  const n = 250;

  for (let i = 0; i < n; i++) {
    const x = addNoise(Math.random() * 2 - 1, noise * 0.15);
    const y = addNoise(Math.random() * 2 - 1, noise * 0.15);
    const label = (x > 0) === (y > 0) ? 0 : 1;
    points.push({ x, y, label });
  }

  return points;
}

function generateSpiral(noise: number): DataPoint[] {
  const points: DataPoint[] = [];
  const n = 150; // Per class

  for (let classIdx = 0; classIdx < 2; classIdx++) {
    for (let i = 0; i < n; i++) {
      const t = (i / n) * 2 * Math.PI + classIdx * Math.PI;
      const r = (i / n) * 0.8 + 0.1;
      const x = addNoise(r * Math.cos(t), noise * 0.12);
      const y = addNoise(r * Math.sin(t), noise * 0.12);
      points.push({ x, y, label: classIdx });
    }
  }

  return points;
}

function generateGaussian(noise: number): DataPoint[] {
  const points: DataPoint[] = [];
  const n = 125; // Per class
  const spread = 0.3 + noise * 0.5;

  // Cluster 0: centered at (-0.4, -0.4)
  for (let i = 0; i < n; i++) {
    points.push({
      x: -0.4 + gaussianRandom() * spread,
      y: -0.4 + gaussianRandom() * spread,
      label: 0,
    });
  }

  // Cluster 1: centered at (0.4, 0.4)
  for (let i = 0; i < n; i++) {
    points.push({
      x: 0.4 + gaussianRandom() * spread,
      y: 0.4 + gaussianRandom() * spread,
      label: 1,
    });
  }

  return points;
}

function generateMoon(noise: number): DataPoint[] {
  const points: DataPoint[] = [];
  const n = 150; // Per class

  // Upper moon (class 0)
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI;
    const x = addNoise(Math.cos(angle), noise * 0.15);
    const y = addNoise(Math.sin(angle), noise * 0.15);
    points.push({ x: x * 0.7, y: y * 0.7 - 0.1, label: 0 });
  }

  // Lower moon (class 1)
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI;
    const x = addNoise(1 - Math.cos(angle), noise * 0.15);
    const y = addNoise(-Math.sin(angle) + 0.5, noise * 0.15);
    points.push({ x: x * 0.7 - 0.35, y: y * 0.7 - 0.25, label: 1 });
  }

  return points;
}

function generateLinear(noise: number): DataPoint[] {
  const points: DataPoint[] = [];
  const n = 250;

  for (let i = 0; i < n; i++) {
    const x = Math.random() * 2 - 1;
    const y = Math.random() * 2 - 1;
    const boundary = 0.3 * x + 0.1;
    const noisyY = y + gaussianRandom() * noise * 0.2;
    const label = noisyY > boundary ? 1 : 0;
    points.push({ x, y, label });
  }

  return points;
}

/* ──────────────────────────────────────
   Public API
   ────────────────────────────────────── */

const GENERATORS: Record<DatasetName, (noise: number) => DataPoint[]> = {
  circle: generateCircle,
  xor: generateXor,
  spiral: generateSpiral,
  gaussian: generateGaussian,
  moon: generateMoon,
  linear: generateLinear,
};

export function generateDataset(name: DatasetName, noise: number): DataPoint[] {
  const generator = GENERATORS[name];
  return generator(noise);
}

export function splitTrainTest(
  data: DataPoint[],
  trainRatio: number,
): { train: DataPoint[]; test: DataPoint[] } {
  const shuffled = [...data].sort(() => Math.random() - 0.5);
  const splitIndex = Math.floor(shuffled.length * trainRatio);
  return {
    train: shuffled.slice(0, splitIndex),
    test: shuffled.slice(splitIndex),
  };
}

export function toTuples(data: DataPoint[]): [number, number, number][] {
  return data.map((d) => [d.x, d.y, d.label]);
}
