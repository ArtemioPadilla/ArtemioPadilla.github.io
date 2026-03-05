import {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "preact/hooks";

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

interface Point {
  x: number;
  y: number;
  cluster: number;
  label: "core" | "border" | "noise" | "none";
}

interface Centroid {
  x: number;
  y: number;
  trail: Array<{ x: number; y: number }>;
}

interface AlgorithmStep {
  type:
    | "assign"
    | "update-centroids"
    | "classify-point"
    | "merge"
    | "shift"
    | "done";
  points: Point[];
  centroids?: Centroid[];
  mergeIndices?: [number, number];
  dendrogramLinks?: DendrogramLink[];
  highlightIndex?: number;
  epsilonCircle?: { x: number; y: number; r: number };
  shiftWindows?: Array<{ cx: number; cy: number; r: number }>;
}

interface DendrogramLink {
  left: number;
  right: number;
  distance: number;
  merged: number;
}

type AlgorithmId = "kmeans" | "dbscan" | "hierarchical" | "meanshift";
type DatasetId = "blobs" | "circles" | "moons" | "anisotropic" | "varied";
type LinkageType = "single" | "complete" | "average";
type PlayState = "idle" | "running" | "paused" | "done";

/* ══════════════════════════════════════════════════════════
   Constants
   ══════════════════════════════════════════════════════════ */

const CANVAS_W = 600;
const CANVAS_H = 450;
const POINT_RADIUS = 4;
const CENTROID_RADIUS = 8;

const CLUSTER_COLORS = [
  "#4f8ff7",
  "#34d399",
  "#f59e0b",
  "#a855f7",
  "#ef4444",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#f97316",
  "#6366f1",
];
const NOISE_COLOR = "#71717a";
const UNASSIGNED_COLOR = "#a1a1aa";

const ALGORITHM_INFO: Record<AlgorithmId, { name: string; description: string }> = {
  kmeans: {
    name: "K-Means",
    description: "Assign points to nearest centroid, then update centroids to cluster means.",
  },
  dbscan: {
    name: "DBSCAN",
    description: "Density-based clustering: finds core, border, and noise points.",
  },
  hierarchical: {
    name: "Hierarchical",
    description: "Agglomerative: merge closest clusters until cut distance.",
  },
  meanshift: {
    name: "Mean Shift",
    description: "Shift kernel windows toward density peaks until convergence.",
  },
};

const DATASET_INFO: Record<DatasetId, string> = {
  blobs: "Gaussian Blobs",
  circles: "Concentric Circles",
  moons: "Two Moons",
  anisotropic: "Anisotropic",
  varied: "Varied Density",
};

/* ══════════════════════════════════════════════════════════
   Seeded Random (for reproducible datasets)
   ══════════════════════════════════════════════════════════ */

function createRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function gaussianRandom(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/* ══════════════════════════════════════════════════════════
   Dataset Generators
   ══════════════════════════════════════════════════════════ */

function generateBlobs(
  n: number,
  k: number,
  spread: number,
  rng: () => number,
): Point[] {
  const points: Point[] = [];
  const margin = 60;
  const centers: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < k; i++) {
    centers.push({
      x: margin + rng() * (CANVAS_W - 2 * margin),
      y: margin + rng() * (CANVAS_H - 2 * margin),
    });
  }
  for (let i = 0; i < n; i++) {
    const ci = Math.floor(rng() * k);
    const c = centers[ci];
    points.push({
      x: c.x + gaussianRandom(rng) * spread,
      y: c.y + gaussianRandom(rng) * spread,
      cluster: -1,
      label: "none",
    });
  }
  return clampPoints(points);
}

function generateCircles(n: number, rng: () => number): Point[] {
  const points: Point[] = [];
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;
  const rOuter = Math.min(CANVAS_W, CANVAS_H) * 0.35;
  const rInner = rOuter * 0.45;
  for (let i = 0; i < n; i++) {
    const angle = rng() * 2 * Math.PI;
    const isOuter = i < n / 2;
    const r = isOuter
      ? rOuter + gaussianRandom(rng) * 12
      : rInner + gaussianRandom(rng) * 10;
    points.push({
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
      cluster: -1,
      label: "none",
    });
  }
  return clampPoints(points);
}

function generateMoons(n: number, rng: () => number): Point[] {
  const points: Point[] = [];
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;
  const r = Math.min(CANVAS_W, CANVAS_H) * 0.25;
  const half = Math.floor(n / 2);
  for (let i = 0; i < half; i++) {
    const angle = (Math.PI * i) / half;
    points.push({
      x: cx + Math.cos(angle) * r + gaussianRandom(rng) * 10,
      y: cy - Math.sin(angle) * r + gaussianRandom(rng) * 10,
      cluster: -1,
      label: "none",
    });
  }
  for (let i = 0; i < n - half; i++) {
    const angle = (Math.PI * i) / (n - half);
    points.push({
      x: cx + r * 0.5 + Math.cos(angle + Math.PI) * r + gaussianRandom(rng) * 10,
      y: cy + r * 0.3 - Math.sin(angle + Math.PI) * r + gaussianRandom(rng) * 10,
      cluster: -1,
      label: "none",
    });
  }
  return clampPoints(points);
}

function generateAnisotropic(n: number, rng: () => number): Point[] {
  const points: Point[] = [];
  const margin = 80;
  const centers = [
    { x: CANVAS_W * 0.3, y: CANVAS_H * 0.35, sx: 50, sy: 15, angle: 0.5 },
    { x: CANVAS_W * 0.7, y: CANVAS_H * 0.5, sx: 15, sy: 50, angle: -0.3 },
    { x: CANVAS_W * 0.45, y: CANVAS_H * 0.75, sx: 40, sy: 10, angle: 1.2 },
  ];
  const perCluster = Math.floor(n / centers.length);
  for (const c of centers) {
    for (let i = 0; i < perCluster; i++) {
      const gx = gaussianRandom(rng) * c.sx;
      const gy = gaussianRandom(rng) * c.sy;
      const cos = Math.cos(c.angle);
      const sin = Math.sin(c.angle);
      points.push({
        x: c.x + gx * cos - gy * sin,
        y: c.y + gx * sin + gy * cos,
        cluster: -1,
        label: "none",
      });
    }
  }
  return clampPoints(points);
}

function generateVariedDensity(n: number, rng: () => number): Point[] {
  const points: Point[] = [];
  const configs = [
    { x: CANVAS_W * 0.25, y: CANVAS_H * 0.35, spread: 20, count: Math.floor(n * 0.5) },
    { x: CANVAS_W * 0.7, y: CANVAS_H * 0.4, spread: 45, count: Math.floor(n * 0.3) },
    { x: CANVAS_W * 0.5, y: CANVAS_H * 0.75, spread: 30, count: Math.floor(n * 0.2) },
  ];
  for (const c of configs) {
    for (let i = 0; i < c.count; i++) {
      points.push({
        x: c.x + gaussianRandom(rng) * c.spread,
        y: c.y + gaussianRandom(rng) * c.spread,
        cluster: -1,
        label: "none",
      });
    }
  }
  return clampPoints(points);
}

function clampPoints(points: Point[]): Point[] {
  const pad = 10;
  return points.map((p) => ({
    ...p,
    x: Math.max(pad, Math.min(CANVAS_W - pad, p.x)),
    y: Math.max(pad, Math.min(CANVAS_H - pad, p.y)),
  }));
}

function generateDataset(
  id: DatasetId,
  n: number,
  k: number,
  spread: number,
  seed: number,
): Point[] {
  const rng = createRng(seed);
  switch (id) {
    case "blobs":
      return generateBlobs(n, k, spread, rng);
    case "circles":
      return generateCircles(n, rng);
    case "moons":
      return generateMoons(n, rng);
    case "anisotropic":
      return generateAnisotropic(n, rng);
    case "varied":
      return generateVariedDensity(n, rng);
  }
}

/* ══════════════════════════════════════════════════════════
   Distance Utilities
   ══════════════════════════════════════════════════════════ */

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/* ══════════════════════════════════════════════════════════
   K-Means Algorithm (Generator)
   ══════════════════════════════════════════════════════════ */

function* kmeansGenerator(
  inputPoints: Point[],
  k: number,
): Generator<AlgorithmStep> {
  const points: Point[] = inputPoints.map((p) => ({ ...p, cluster: -1, label: "none" }));
  const centroids: Centroid[] = [];

  // Initialize centroids via k-means++ style
  const usedIndices = new Set<number>();
  const firstIdx = Math.floor(Math.random() * points.length);
  usedIndices.add(firstIdx);
  centroids.push({ x: points[firstIdx].x, y: points[firstIdx].y, trail: [] });

  for (let c = 1; c < k; c++) {
    let maxDist = -1;
    let bestIdx = 0;
    for (let i = 0; i < points.length; i++) {
      if (usedIndices.has(i)) continue;
      const minDist = Math.min(...centroids.map((ct) => dist(points[i], ct)));
      if (minDist > maxDist) {
        maxDist = minDist;
        bestIdx = i;
      }
    }
    usedIndices.add(bestIdx);
    centroids.push({ x: points[bestIdx].x, y: points[bestIdx].y, trail: [] });
  }

  let changed = true;
  let maxIter = 100;

  while (changed && maxIter-- > 0) {
    changed = false;

    // Assignment step
    for (let i = 0; i < points.length; i++) {
      let bestC = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = dist(points[i], centroids[c]);
        if (d < bestD) {
          bestD = d;
          bestC = c;
        }
      }
      if (points[i].cluster !== bestC) {
        points[i].cluster = bestC;
        changed = true;
      }
    }

    yield {
      type: "assign",
      points: points.map((p) => ({ ...p })),
      centroids: centroids.map((c) => ({ ...c, trail: [...c.trail] })),
    };

    // Update step
    for (let c = 0; c < k; c++) {
      const members = points.filter((p) => p.cluster === c);
      if (members.length === 0) continue;
      const oldX = centroids[c].x;
      const oldY = centroids[c].y;
      centroids[c].trail.push({ x: oldX, y: oldY });
      centroids[c].x = members.reduce((s, p) => s + p.x, 0) / members.length;
      centroids[c].y = members.reduce((s, p) => s + p.y, 0) / members.length;
    }

    yield {
      type: "update-centroids",
      points: points.map((p) => ({ ...p })),
      centroids: centroids.map((c) => ({ ...c, trail: [...c.trail] })),
    };
  }

  yield {
    type: "done",
    points: points.map((p) => ({ ...p })),
    centroids: centroids.map((c) => ({ ...c, trail: [...c.trail] })),
  };
}

/* ══════════════════════════════════════════════════════════
   DBSCAN Algorithm (Generator)
   ══════════════════════════════════════════════════════════ */

function* dbscanGenerator(
  inputPoints: Point[],
  epsilon: number,
  minPts: number,
): Generator<AlgorithmStep> {
  const points: Point[] = inputPoints.map((p) => ({
    ...p,
    cluster: -1,
    label: "none",
  }));

  const visited = new Set<number>();
  let clusterId = 0;

  function rangeQuery(idx: number): number[] {
    const neighbors: number[] = [];
    for (let i = 0; i < points.length; i++) {
      if (dist(points[idx], points[i]) <= epsilon) {
        neighbors.push(i);
      }
    }
    return neighbors;
  }

  for (let i = 0; i < points.length; i++) {
    if (visited.has(i)) continue;
    visited.add(i);

    const neighbors = rangeQuery(i);

    yield {
      type: "classify-point",
      points: points.map((p) => ({ ...p })),
      highlightIndex: i,
      epsilonCircle: { x: points[i].x, y: points[i].y, r: epsilon },
    };

    if (neighbors.length < minPts) {
      points[i].label = "noise";
      points[i].cluster = -1;
      continue;
    }

    points[i].label = "core";
    points[i].cluster = clusterId;

    const seedSet = [...neighbors];
    const inSeed = new Set(neighbors);
    let j = 0;

    while (j < seedSet.length) {
      const qi = seedSet[j];
      j++;

      if (points[qi].label === "noise") {
        points[qi].label = "border";
        points[qi].cluster = clusterId;
      }

      if (visited.has(qi)) continue;
      visited.add(qi);

      points[qi].cluster = clusterId;
      const qNeighbors = rangeQuery(qi);

      yield {
        type: "classify-point",
        points: points.map((p) => ({ ...p })),
        highlightIndex: qi,
        epsilonCircle: { x: points[qi].x, y: points[qi].y, r: epsilon },
      };

      if (qNeighbors.length >= minPts) {
        points[qi].label = "core";
        for (const ni of qNeighbors) {
          if (!inSeed.has(ni)) {
            seedSet.push(ni);
            inSeed.add(ni);
          }
        }
      } else {
        if (points[qi].label === "none") {
          points[qi].label = "border";
        }
      }
    }

    clusterId++;
  }

  yield {
    type: "done",
    points: points.map((p) => ({ ...p })),
  };
}

/* ══════════════════════════════════════════════════════════
   Hierarchical Clustering (Generator)
   ══════════════════════════════════════════════════════════ */

function clusterDistance(
  a: number[],
  b: number[],
  points: Point[],
  linkage: LinkageType,
): number {
  let result: number;
  switch (linkage) {
    case "single": {
      result = Infinity;
      for (const ai of a) {
        for (const bi of b) {
          const d = dist(points[ai], points[bi]);
          if (d < result) result = d;
        }
      }
      return result;
    }
    case "complete": {
      result = -Infinity;
      for (const ai of a) {
        for (const bi of b) {
          const d = dist(points[ai], points[bi]);
          if (d > result) result = d;
        }
      }
      return result;
    }
    case "average": {
      let sum = 0;
      let count = 0;
      for (const ai of a) {
        for (const bi of b) {
          sum += dist(points[ai], points[bi]);
          count++;
        }
      }
      return sum / count;
    }
  }
}

function* hierarchicalGenerator(
  inputPoints: Point[],
  linkage: LinkageType,
): Generator<AlgorithmStep> {
  const points: Point[] = inputPoints.map((p) => ({
    ...p,
    cluster: -1,
    label: "none",
  }));

  const n = points.length;
  let clusters: number[][] = points.map((_, i) => [i]);
  let clusterNodeIds: number[] = points.map((_, i) => i);
  const links: DendrogramLink[] = [];
  let nextId = n;

  // Assign initial cluster IDs
  for (let i = 0; i < n; i++) {
    points[i].cluster = i;
  }

  yield {
    type: "assign",
    points: points.map((p) => ({ ...p })),
    dendrogramLinks: [...links],
  };

  while (clusters.length > 1) {
    // Find closest pair
    let minDist = Infinity;
    let mergeA = 0;
    let mergeB = 1;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = clusterDistance(clusters[i], clusters[j], points, linkage);
        if (d < minDist) {
          minDist = d;
          mergeA = i;
          mergeB = j;
        }
      }
    }

    // Record merge using node IDs (not array indices)
    const mergedNodeId = nextId++;
    links.push({
      left: clusterNodeIds[mergeA],
      right: clusterNodeIds[mergeB],
      distance: minDist,
      merged: mergedNodeId,
    });

    // Merge clusters
    const merged = [...clusters[mergeA], ...clusters[mergeB]];
    const newClusters: number[][] = [];
    const newNodeIds: number[] = [];
    for (let i = 0; i < clusters.length; i++) {
      if (i !== mergeA && i !== mergeB) {
        newClusters.push(clusters[i]);
        newNodeIds.push(clusterNodeIds[i]);
      }
    }
    newClusters.push(merged);
    newNodeIds.push(mergedNodeId);
    clusters = newClusters;
    clusterNodeIds = newNodeIds;

    // Reassign cluster IDs
    for (let ci = 0; ci < clusters.length; ci++) {
      for (const pi of clusters[ci]) {
        points[pi].cluster = ci;
      }
    }

    yield {
      type: "merge",
      points: points.map((p) => ({ ...p })),
      mergeIndices: [mergeA, mergeB],
      dendrogramLinks: [...links],
    };
  }

  yield {
    type: "done",
    points: points.map((p) => ({ ...p })),
    dendrogramLinks: [...links],
  };
}

/* ══════════════════════════════════════════════════════════
   Mean Shift Algorithm (Generator)
   ══════════════════════════════════════════════════════════ */

function* meanShiftGenerator(
  inputPoints: Point[],
  bandwidth: number,
): Generator<AlgorithmStep> {
  const points: Point[] = inputPoints.map((p) => ({
    ...p,
    cluster: -1,
    label: "none",
  }));

  // Each point starts as its own kernel window center
  const windowCenters = points.map((p) => ({ x: p.x, y: p.y }));
  const converged = new Array(points.length).fill(false);
  const convergenceThreshold = 1.0;
  let allConverged = false;
  let maxIter = 80;

  while (!allConverged && maxIter-- > 0) {
    allConverged = true;

    for (let i = 0; i < windowCenters.length; i++) {
      if (converged[i]) continue;

      const wc = windowCenters[i];
      let sumX = 0;
      let sumY = 0;
      let totalWeight = 0;

      for (const p of points) {
        const d = dist(wc, p);
        if (d <= bandwidth) {
          // Flat kernel
          sumX += p.x;
          sumY += p.y;
          totalWeight++;
        }
      }

      if (totalWeight > 0) {
        const newX = sumX / totalWeight;
        const newY = sumY / totalWeight;
        const shift = dist(wc, { x: newX, y: newY });

        windowCenters[i] = { x: newX, y: newY };

        if (shift < convergenceThreshold) {
          converged[i] = true;
        } else {
          allConverged = false;
        }
      } else {
        converged[i] = true;
      }
    }

    if (!allConverged) {
      allConverged = converged.every(Boolean);
    }

    // Build shift windows for display
    const shiftWindows = windowCenters
      .filter((_, i) => !converged[i])
      .slice(0, 20)
      .map((wc) => ({
        cx: wc.x,
        cy: wc.y,
        r: bandwidth,
      }));

    yield {
      type: "shift",
      points: points.map((p) => ({ ...p })),
      shiftWindows,
    };
  }

  // Merge converged windows into clusters
  const clusterCenters: Array<{ x: number; y: number }> = [];
  const mergeRadius = bandwidth * 0.5;

  for (const wc of windowCenters) {
    let found = false;
    for (const cc of clusterCenters) {
      if (dist(wc, cc) < mergeRadius) {
        found = true;
        break;
      }
    }
    if (!found) {
      clusterCenters.push({ x: wc.x, y: wc.y });
    }
  }

  // Assign each point to nearest merged center
  for (let i = 0; i < points.length; i++) {
    let bestC = 0;
    let bestD = Infinity;
    for (let c = 0; c < clusterCenters.length; c++) {
      const d = dist(windowCenters[i], clusterCenters[c]);
      if (d < bestD) {
        bestD = d;
        bestC = c;
      }
    }
    points[i].cluster = bestC;
  }

  yield {
    type: "done",
    points: points.map((p) => ({ ...p })),
    centroids: clusterCenters.map((c) => ({ x: c.x, y: c.y, trail: [] })),
  };
}

/* ══════════════════════════════════════════════════════════
   Silhouette Score
   ══════════════════════════════════════════════════════════ */

function computeSilhouette(points: Point[]): number {
  const clustered = points.filter((p) => p.cluster >= 0);
  if (clustered.length < 2) return 0;

  const clusterIds = [...new Set(clustered.map((p) => p.cluster))];
  if (clusterIds.length < 2) return 0;

  let totalSilhouette = 0;

  for (const p of clustered) {
    // a(i) = average distance to same cluster
    const sameCluster = clustered.filter(
      (q) => q.cluster === p.cluster && q !== p,
    );
    if (sameCluster.length === 0) continue;

    const a =
      sameCluster.reduce((s, q) => s + dist(p, q), 0) / sameCluster.length;

    // b(i) = minimum average distance to other clusters
    let b = Infinity;
    for (const cid of clusterIds) {
      if (cid === p.cluster) continue;
      const otherCluster = clustered.filter((q) => q.cluster === cid);
      if (otherCluster.length === 0) continue;
      const avgDist =
        otherCluster.reduce((s, q) => s + dist(p, q), 0) / otherCluster.length;
      if (avgDist < b) b = avgDist;
    }

    const silhouette = (b - a) / Math.max(a, b);
    totalSilhouette += silhouette;
  }

  return totalSilhouette / clustered.length;
}

/* ══════════════════════════════════════════════════════════
   Voronoi Region Drawing (for K-Means)
   ══════════════════════════════════════════════════════════ */

function drawVoronoiRegions(
  ctx: CanvasRenderingContext2D,
  centroids: Centroid[],
  w: number,
  h: number,
): void {
  const step = 4;
  for (let px = 0; px < w; px += step) {
    for (let py = 0; py < h; py += step) {
      let bestC = 0;
      let bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = dist({ x: px, y: py }, centroids[c]);
        if (d < bestD) {
          bestD = d;
          bestC = c;
        }
      }
      const color = CLUSTER_COLORS[bestC % CLUSTER_COLORS.length];
      ctx.fillStyle = color + "15";
      ctx.fillRect(px, py, step, step);
    }
  }

  // Draw Voronoi boundaries
  ctx.strokeStyle = CLUSTER_COLORS[0] + "40";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);

  for (let px = 0; px < w; px += step) {
    for (let py = 0; py < h; py += step) {
      let bestC = 0;
      let bestD = Infinity;
      let secondD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = dist({ x: px, y: py }, centroids[c]);
        if (d < bestD) {
          secondD = bestD;
          bestD = d;
          bestC = c;
        } else if (d < secondD) {
          secondD = d;
        }
      }
      if (Math.abs(bestD - secondD) < step * 2) {
        ctx.strokeStyle = CLUSTER_COLORS[bestC % CLUSTER_COLORS.length] + "60";
        ctx.strokeRect(px, py, step, step);
      }
    }
  }
  ctx.setLineDash([]);
}

/* ══════════════════════════════════════════════════════════
   Canvas Rendering
   ══════════════════════════════════════════════════════════ */

function renderCanvas(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  step: AlgorithmStep | null,
  algorithm: AlgorithmId,
  isDarkMode: boolean,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  // Background
  ctx.fillStyle = isDarkMode ? "#0a0a0a" : "#f5f5f5";
  ctx.fillRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = isDarkMode ? "#1a1a1a" : "#e0e0e0";
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 50) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Algorithm-specific overlays
  if (step) {
    if (algorithm === "kmeans" && step.centroids && step.centroids.length > 0) {
      drawVoronoiRegions(ctx, step.centroids, w, h);
    }

    if (step.epsilonCircle) {
      const ec = step.epsilonCircle;
      ctx.beginPath();
      ctx.arc(ec.x, ec.y, ec.r, 0, Math.PI * 2);
      ctx.strokeStyle = isDarkMode ? "#ffffff40" : "#00000030";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = isDarkMode ? "#ffffff08" : "#00000008";
      ctx.fill();
    }

    if (step.shiftWindows) {
      for (const sw of step.shiftWindows) {
        ctx.beginPath();
        ctx.arc(sw.cx, sw.cy, sw.r, 0, Math.PI * 2);
        ctx.strokeStyle = isDarkMode ? "#4f8ff740" : "#2563eb30";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  // Draw points
  const drawPoints = step ? step.points : points;
  for (let i = 0; i < drawPoints.length; i++) {
    const p = drawPoints[i];
    let color: string;

    if (p.cluster >= 0) {
      color = CLUSTER_COLORS[p.cluster % CLUSTER_COLORS.length];
    } else if (p.label === "noise") {
      color = NOISE_COLOR;
    } else {
      color = UNASSIGNED_COLOR;
    }

    const isHighlighted = step?.highlightIndex === i;
    const radius = isHighlighted ? POINT_RADIUS + 3 : POINT_RADIUS;

    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Core/border/noise indicator for DBSCAN
    if (algorithm === "dbscan" && p.label !== "none") {
      ctx.strokeStyle = isDarkMode ? "#ffffff60" : "#00000040";
      ctx.lineWidth = p.label === "core" ? 2 : 1;
      if (p.label === "noise") {
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (isHighlighted) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius + 4, 0, Math.PI * 2);
      ctx.strokeStyle = isDarkMode ? "#ffffff" : "#000000";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // Draw centroids (K-Means, Mean Shift)
  if (step?.centroids) {
    for (let c = 0; c < step.centroids.length; c++) {
      const ct = step.centroids[c];
      const color = CLUSTER_COLORS[c % CLUSTER_COLORS.length];

      // Trail
      if (ct.trail.length > 0) {
        ctx.beginPath();
        ctx.moveTo(ct.trail[0].x, ct.trail[0].y);
        for (let t = 1; t < ct.trail.length; t++) {
          ctx.lineTo(ct.trail[t].x, ct.trail[t].y);
        }
        ctx.lineTo(ct.x, ct.y);
        ctx.strokeStyle = color + "60";
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Centroid marker (diamond)
      ctx.save();
      ctx.translate(ct.x, ct.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = color;
      ctx.fillRect(
        -CENTROID_RADIUS / 2,
        -CENTROID_RADIUS / 2,
        CENTROID_RADIUS,
        CENTROID_RADIUS,
      );
      ctx.strokeStyle = isDarkMode ? "#ffffff" : "#000000";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        -CENTROID_RADIUS / 2,
        -CENTROID_RADIUS / 2,
        CENTROID_RADIUS,
        CENTROID_RADIUS,
      );
      ctx.restore();
    }
  }
}

/* ══════════════════════════════════════════════════════════
   Dendrogram Rendering
   ══════════════════════════════════════════════════════════ */

function renderDendrogram(
  ctx: CanvasRenderingContext2D,
  links: DendrogramLink[],
  numPoints: number,
  cutDistance: number,
  isDarkMode: boolean,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  ctx.fillStyle = isDarkMode ? "#0a0a0a" : "#f5f5f5";
  ctx.fillRect(0, 0, w, h);

  if (links.length === 0) return;

  const maxDist = Math.max(...links.map((l) => l.distance), 1);
  const padding = { top: 20, bottom: 30, left: 10, right: 10 };
  const plotW = w - padding.left - padding.right;
  const plotH = h - padding.top - padding.bottom;

  // Build node positions
  const nodeX = new Map<number, number>();
  const nodeY = new Map<number, number>();

  // Leaf nodes spread evenly across the bottom
  const leafSpacing = plotW / (numPoints + 1);
  const leafOrder = computeLeafOrder(links, numPoints);
  for (let i = 0; i < leafOrder.length; i++) {
    nodeX.set(leafOrder[i], padding.left + (i + 1) * leafSpacing);
    nodeY.set(leafOrder[i], padding.top + plotH);
  }

  // Internal nodes
  for (const link of links) {
    const lx = nodeX.get(link.left) ?? w / 2;
    const rx = nodeX.get(link.right) ?? w / 2;
    const my = padding.top + plotH * (1 - link.distance / maxDist);
    nodeX.set(link.merged, (lx + rx) / 2);
    nodeY.set(link.merged, my);

    const ly = nodeY.get(link.left) ?? padding.top + plotH;
    const ry = nodeY.get(link.right) ?? padding.top + plotH;

    // Determine color based on cut
    const aboveCut = link.distance > cutDistance;
    ctx.strokeStyle = aboveCut
      ? (isDarkMode ? "#71717a" : "#a1a1aa")
      : CLUSTER_COLORS[link.merged % CLUSTER_COLORS.length];
    ctx.lineWidth = 1.5;

    // U-shape connection
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(lx, my);
    ctx.lineTo(rx, my);
    ctx.lineTo(rx, ry);
    ctx.stroke();
  }

  // Cut line
  const cutY = padding.top + plotH * (1 - cutDistance / maxDist);
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(0, cutY);
  ctx.lineTo(w, cutY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Cut line label
  ctx.fillStyle = "#ef4444";
  ctx.font = "11px Inter, sans-serif";
  ctx.fillText(`cut: ${cutDistance.toFixed(1)}`, w - 70, cutY - 5);
}

function computeLeafOrder(links: DendrogramLink[], n: number): number[] {
  if (links.length === 0) return Array.from({ length: n }, (_, i) => i);

  const children = new Map<number, [number, number]>();
  for (const link of links) {
    children.set(link.merged, [link.left, link.right]);
  }

  const root = links[links.length - 1].merged;
  const order: number[] = [];

  function traverse(node: number): void {
    const ch = children.get(node);
    if (ch) {
      traverse(ch[0]);
      traverse(ch[1]);
    } else {
      order.push(node);
    }
  }

  traverse(root);
  return order;
}

/* ══════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════ */

export default function ClusteringViz() {
  // Algorithm
  const [algorithm, setAlgorithm] = useState<AlgorithmId>("kmeans");

  // Dataset
  const [datasetId, setDatasetId] = useState<DatasetId>("blobs");
  const [numPoints, setNumPoints] = useState(120);
  const [numClusters, setNumClusters] = useState(3);
  const [spread, setSpread] = useState(35);

  // Algorithm parameters
  const [k, setK] = useState(3);
  const [epsilon, setEpsilon] = useState(35);
  const [minPts, setMinPts] = useState(4);
  const [linkage, setLinkage] = useState<LinkageType>("single");
  const [bandwidth, setBandwidth] = useState(60);
  const [cutDistance, setCutDistance] = useState(100);

  // Playback
  const [playState, setPlayState] = useState<PlayState>("idle");
  const [speed, setSpeed] = useState(300);

  // Data
  const [points, setPoints] = useState<Point[]>([]);
  const [currentStep, setCurrentStep] = useState<AlgorithmStep | null>(null);
  const [iteration, setIteration] = useState(0);
  const [seed, setSeed] = useState(42);

  // Stats
  const [silhouette, setSilhouette] = useState<number | null>(null);
  const [numClustersFound, setNumClustersFound] = useState(0);

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dendrogramRef = useRef<HTMLCanvasElement>(null);
  const generatorRef = useRef<Generator<AlgorithmStep> | null>(null);
  const timerRef = useRef<number>(0);
  const playStateRef = useRef<PlayState>("idle");
  const stepsRef = useRef<AlgorithmStep[]>([]);
  const stepIndexRef = useRef(0);

  // Theme detection
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const checkTheme = () => {
      setIsDark(!document.documentElement.classList.contains("light"));
    };
    checkTheme();
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  // Generate initial dataset
  useEffect(() => {
    const pts = generateDataset(datasetId, numPoints, numClusters, spread, seed);
    setPoints(pts);
    setCurrentStep(null);
    setIteration(0);
    setSilhouette(null);
    setNumClustersFound(0);
    generatorRef.current = null;
    stepsRef.current = [];
    stepIndexRef.current = 0;
    if (playState !== "idle") {
      setPlayState("idle");
      playStateRef.current = "idle";
    }
  }, [datasetId, numPoints, numClusters, spread, seed]);

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    renderCanvas(ctx, points, currentStep, algorithm, isDark);
  }, [points, currentStep, algorithm, isDark]);

  // Render dendrogram
  useEffect(() => {
    if (algorithm !== "hierarchical") return;
    const canvas = dendrogramRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const links = currentStep?.dendrogramLinks ?? [];
    renderDendrogram(ctx, links, points.length, cutDistance, isDark);
  }, [algorithm, currentStep, cutDistance, isDark, points.length]);

  // Apply cut distance to hierarchical clustering
  useEffect(() => {
    if (algorithm !== "hierarchical") return;
    if (!currentStep?.dendrogramLinks || currentStep.dendrogramLinks.length === 0) return;

    const links = currentStep.dendrogramLinks;
    const n = points.length;

    // Rebuild cluster assignments from dendrogram at the cut distance
    const clusterMembers = new Map<number, number[]>();

    // Initialize each point as its own cluster
    for (let i = 0; i < n; i++) {
      clusterMembers.set(i, [i]);
    }

    // Apply merges up to cut distance
    for (const link of links) {
      if (link.distance > cutDistance) break;
      const leftMembers = clusterMembers.get(link.left) ?? [];
      const rightMembers = clusterMembers.get(link.right) ?? [];
      clusterMembers.set(link.merged, [...leftMembers, ...rightMembers]);
      clusterMembers.delete(link.left);
      clusterMembers.delete(link.right);
    }

    // Assign cluster IDs
    const updatedPoints: Point[] = points.map((p) => ({ ...p, cluster: -1, label: "none" }));
    let cid = 0;
    for (const [, members] of clusterMembers) {
      for (const mi of members) {
        if (mi < n) {
          updatedPoints[mi].cluster = cid;
        }
      }
      cid++;
    }

    // Update stats
    const uniqueClusters = new Set(updatedPoints.filter((p) => p.cluster >= 0).map((p) => p.cluster));
    setNumClustersFound(uniqueClusters.size);
    setSilhouette(computeSilhouette(updatedPoints));

    // Update current step with new assignments but keep the dendrogram
    setCurrentStep((prev) => prev ? { ...prev, points: updatedPoints } : null);
  }, [cutDistance]);

  // Update stats when step changes (non-hierarchical)
  useEffect(() => {
    if (!currentStep || algorithm === "hierarchical") return;
    const clustered = currentStep.points.filter((p) => p.cluster >= 0);
    const uniqueClusters = new Set(clustered.map((p) => p.cluster));
    setNumClustersFound(uniqueClusters.size);
    if (currentStep.type === "done" || uniqueClusters.size >= 2) {
      setSilhouette(computeSilhouette(currentStep.points));
    }
  }, [currentStep, algorithm]);

  // Playback timer
  useEffect(() => {
    if (playState !== "running") {
      clearInterval(timerRef.current);
      return;
    }

    timerRef.current = window.setInterval(() => {
      if (playStateRef.current !== "running") return;
      advanceStep();
    }, speed);

    return () => clearInterval(timerRef.current);
  }, [playState, speed]);

  // Sync playState ref
  useEffect(() => {
    playStateRef.current = playState;
  }, [playState]);

  const initializeGenerator = useCallback(() => {
    const pts: Point[] = points.map((p) => ({ ...p, cluster: -1, label: "none" }));
    switch (algorithm) {
      case "kmeans":
        return kmeansGenerator(pts, k);
      case "dbscan":
        return dbscanGenerator(pts, epsilon, minPts);
      case "hierarchical":
        return hierarchicalGenerator(pts, linkage);
      case "meanshift":
        return meanShiftGenerator(pts, bandwidth);
    }
  }, [points, algorithm, k, epsilon, minPts, linkage, bandwidth]);

  const advanceStep = useCallback(() => {
    if (!generatorRef.current) {
      generatorRef.current = initializeGenerator();
      stepsRef.current = [];
      stepIndexRef.current = 0;
    }

    // If we have cached steps ahead, use them
    if (stepIndexRef.current < stepsRef.current.length) {
      const step = stepsRef.current[stepIndexRef.current];
      stepIndexRef.current++;
      setCurrentStep(step);
      setIteration(stepIndexRef.current);
      if (step.type === "done") {
        setPlayState("done");
        playStateRef.current = "done";
      }
      return;
    }

    const result = generatorRef.current.next();
    if (result.done) {
      setPlayState("done");
      playStateRef.current = "done";
      return;
    }

    stepsRef.current.push(result.value);
    stepIndexRef.current = stepsRef.current.length;
    setCurrentStep(result.value);
    setIteration(stepIndexRef.current);

    if (result.value.type === "done") {
      setPlayState("done");
      playStateRef.current = "done";
    }
  }, [initializeGenerator]);

  const handleStep = useCallback(() => {
    if (playState === "done") return;
    if (playState === "running") {
      setPlayState("paused");
      playStateRef.current = "paused";
    }
    advanceStep();
    if (playState === "idle") {
      setPlayState("paused");
      playStateRef.current = "paused";
    }
  }, [playState, advanceStep]);

  const handleRun = useCallback(() => {
    if (playState === "done") return;
    setPlayState("running");
    playStateRef.current = "running";
  }, [playState]);

  const handlePause = useCallback(() => {
    setPlayState("paused");
    playStateRef.current = "paused";
  }, []);

  const handleReset = useCallback(() => {
    clearInterval(timerRef.current);
    generatorRef.current = null;
    stepsRef.current = [];
    stepIndexRef.current = 0;
    setPlayState("idle");
    playStateRef.current = "idle";
    setCurrentStep(null);
    setIteration(0);
    setSilhouette(null);
    setNumClustersFound(0);
    // Re-generate points to reset cluster assignments
    const pts = generateDataset(datasetId, numPoints, numClusters, spread, seed);
    setPoints(pts);
  }, [datasetId, numPoints, numClusters, spread, seed]);

  const handleCanvasClick = useCallback(
    (e: MouseEvent) => {
      if (playState !== "idle") return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = CANVAS_W / rect.width;
      const scaleY = CANVAS_H / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      setPoints((prev) => [
        ...prev,
        { x, y, cluster: -1, label: "none" },
      ]);
    },
    [playState],
  );

  const handleRandomize = useCallback(() => {
    const newSeed = Math.floor(Math.random() * 100000);
    setSeed(newSeed);
  }, []);

  // Dendrogram max distance for cut slider
  const maxDendrogramDist = currentStep?.dendrogramLinks
    ? Math.max(...currentStep.dendrogramLinks.map((l) => l.distance), 1)
    : 200;

  /* ── Render ─────────────────────────────────── */

  const selectStyle: Record<string, string> = {
    background: "var(--color-surface)",
    color: "var(--color-text)",
    border: "1px solid var(--color-border)",
    borderRadius: "6px",
    padding: "6px 8px",
    fontSize: "13px",
    outline: "none",
    width: "100%",
  };

  const buttonStyle = (active?: boolean): Record<string, string> => ({
    background: active ? "var(--color-primary)" : "var(--color-surface)",
    color: active ? "#ffffff" : "var(--color-text)",
    border: "1px solid var(--color-border)",
    borderRadius: "6px",
    padding: "6px 12px",
    fontSize: "13px",
    cursor: "pointer",
    outline: "none",
    fontFamily: "var(--font-sans)",
  });

  const labelStyle: Record<string, string> = {
    fontSize: "11px",
    color: "var(--color-text-muted)",
    marginBottom: "4px",
    display: "block",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    fontWeight: "600",
  };

  const statBoxStyle: Record<string, string> = {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "6px",
    padding: "8px 12px",
    textAlign: "center",
  };

  return (
    <div style={{ fontFamily: "var(--font-sans)" }}>
      {/* Stats Row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "8px",
          marginBottom: "12px",
        }}
      >
        <div style={statBoxStyle}>
          <div style={{ ...labelStyle, marginBottom: "2px" }}>Clusters Found</div>
          <div
            style={{
              fontSize: "20px",
              fontWeight: "700",
              color: "var(--color-heading)",
            }}
          >
            {numClustersFound || "—"}
          </div>
        </div>
        <div style={statBoxStyle}>
          <div style={{ ...labelStyle, marginBottom: "2px" }}>Iteration</div>
          <div
            style={{
              fontSize: "20px",
              fontWeight: "700",
              color: "var(--color-heading)",
            }}
          >
            {iteration || "—"}
          </div>
        </div>
        <div style={statBoxStyle}>
          <div style={{ ...labelStyle, marginBottom: "2px" }}>Silhouette</div>
          <div
            style={{
              fontSize: "20px",
              fontWeight: "700",
              color:
                silhouette !== null
                  ? silhouette > 0.5
                    ? "var(--color-accent)"
                    : silhouette > 0.25
                      ? "var(--color-primary)"
                      : "#f59e0b"
                  : "var(--color-heading)",
            }}
          >
            {silhouette !== null ? silhouette.toFixed(3) : "—"}
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "8px",
          overflow: "hidden",
          marginBottom: "12px",
        }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          onClick={handleCanvasClick}
          style={{
            width: "100%",
            height: "auto",
            display: "block",
            cursor: playState === "idle" ? "crosshair" : "default",
          }}
        />
      </div>

      {/* Dendrogram (Hierarchical only) */}
      {algorithm === "hierarchical" && currentStep?.dendrogramLinks && currentStep.dendrogramLinks.length > 0 && (
        <div style={{ marginBottom: "12px" }}>
          <div style={{ ...labelStyle, marginBottom: "6px" }}>
            DENDROGRAM — drag cut line to choose cluster count
          </div>
          <div
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: "8px",
              overflow: "hidden",
              marginBottom: "8px",
            }}
          >
            <canvas
              ref={dendrogramRef}
              width={CANVAS_W}
              height={200}
              style={{ width: "100%", height: "auto", display: "block" }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ ...labelStyle, marginBottom: "0" }}>Cut Distance</span>
            <input
              type="range"
              min={0}
              max={maxDendrogramDist}
              step={maxDendrogramDist / 100}
              value={cutDistance}
              onInput={(e) => setCutDistance(Number((e.target as HTMLInputElement).value))}
              style={{ flex: 1 }}
            />
            <span
              style={{
                fontSize: "12px",
                color: "var(--color-text-muted)",
                minWidth: "50px",
                textAlign: "right",
              }}
            >
              {cutDistance.toFixed(1)}
            </span>
          </div>
        </div>
      )}

      {/* Controls */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "12px",
        }}
      >
        {/* Left: Algorithm + Parameters */}
        <div
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "8px",
            padding: "12px",
          }}
        >
          <div style={{ ...labelStyle, marginBottom: "8px" }}>Algorithm</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px", marginBottom: "12px" }}>
            {(["kmeans", "dbscan", "hierarchical", "meanshift"] as AlgorithmId[]).map(
              (alg) => (
                <button
                  key={alg}
                  style={buttonStyle(algorithm === alg)}
                  onClick={() => {
                    setAlgorithm(alg);
                    handleReset();
                  }}
                >
                  {ALGORITHM_INFO[alg].name}
                </button>
              ),
            )}
          </div>

          <div
            style={{
              fontSize: "11px",
              color: "var(--color-text-muted)",
              marginBottom: "12px",
              lineHeight: "1.5",
            }}
          >
            {ALGORITHM_INFO[algorithm].description}
          </div>

          {/* Algorithm-specific parameters */}
          {algorithm === "kmeans" && (
            <div>
              <label style={labelStyle}>K (clusters): {k}</label>
              <input
                type="range"
                min={2}
                max={10}
                value={k}
                onInput={(e) => setK(Number((e.target as HTMLInputElement).value))}
                style={{ width: "100%" }}
              />
            </div>
          )}

          {algorithm === "dbscan" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div>
                <label style={labelStyle}>Epsilon (radius): {epsilon}</label>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={epsilon}
                  onInput={(e) =>
                    setEpsilon(Number((e.target as HTMLInputElement).value))
                  }
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label style={labelStyle}>Min Points: {minPts}</label>
                <input
                  type="range"
                  min={2}
                  max={15}
                  value={minPts}
                  onInput={(e) =>
                    setMinPts(Number((e.target as HTMLInputElement).value))
                  }
                  style={{ width: "100%" }}
                />
              </div>
            </div>
          )}

          {algorithm === "hierarchical" && (
            <div>
              <label style={labelStyle}>Linkage</label>
              <select
                value={linkage}
                onChange={(e) =>
                  setLinkage((e.target as HTMLSelectElement).value as LinkageType)
                }
                style={selectStyle}
              >
                <option value="single">Single</option>
                <option value="complete">Complete</option>
                <option value="average">Average</option>
              </select>
            </div>
          )}

          {algorithm === "meanshift" && (
            <div>
              <label style={labelStyle}>Bandwidth: {bandwidth}</label>
              <input
                type="range"
                min={20}
                max={150}
                value={bandwidth}
                onInput={(e) =>
                  setBandwidth(Number((e.target as HTMLInputElement).value))
                }
                style={{ width: "100%" }}
              />
            </div>
          )}
        </div>

        {/* Right: Dataset + Playback */}
        <div
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "8px",
            padding: "12px",
          }}
        >
          <div style={{ ...labelStyle, marginBottom: "8px" }}>Dataset</div>
          <select
            value={datasetId}
            onChange={(e) => setDatasetId((e.target as HTMLSelectElement).value as DatasetId)}
            style={{ ...selectStyle, marginBottom: "8px" }}
          >
            {(Object.keys(DATASET_INFO) as DatasetId[]).map((id) => (
              <option key={id} value={id}>
                {DATASET_INFO[id]}
              </option>
            ))}
          </select>

          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
            <div>
              <label style={labelStyle}>Points: {numPoints}</label>
              <input
                type="range"
                min={20}
                max={300}
                step={10}
                value={numPoints}
                onInput={(e) =>
                  setNumPoints(Number((e.target as HTMLInputElement).value))
                }
                style={{ width: "100%" }}
              />
            </div>

            {datasetId === "blobs" && (
              <>
                <div>
                  <label style={labelStyle}>Blob Centers: {numClusters}</label>
                  <input
                    type="range"
                    min={2}
                    max={8}
                    value={numClusters}
                    onInput={(e) =>
                      setNumClusters(Number((e.target as HTMLInputElement).value))
                    }
                    style={{ width: "100%" }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Spread: {spread}</label>
                  <input
                    type="range"
                    min={10}
                    max={80}
                    value={spread}
                    onInput={(e) =>
                      setSpread(Number((e.target as HTMLInputElement).value))
                    }
                    style={{ width: "100%" }}
                  />
                </div>
              </>
            )}
          </div>

          <button
            style={{ ...buttonStyle(), width: "100%", marginBottom: "12px" }}
            onClick={handleRandomize}
          >
            Randomize
          </button>

          {/* Playback Controls */}
          <div style={{ ...labelStyle, marginBottom: "8px" }}>Playback</div>
          <div style={{ display: "flex", gap: "4px", marginBottom: "8px" }}>
            <button
              style={buttonStyle()}
              onClick={handleStep}
              disabled={playState === "done"}
            >
              Step
            </button>
            {playState === "running" ? (
              <button style={buttonStyle()} onClick={handlePause}>
                Pause
              </button>
            ) : (
              <button
                style={buttonStyle()}
                onClick={handleRun}
                disabled={playState === "done"}
              >
                Run
              </button>
            )}
            <button style={buttonStyle()} onClick={handleReset}>
              Reset
            </button>
          </div>

          <div>
            <label style={labelStyle}>Speed: {speed}ms</label>
            <input
              type="range"
              min={50}
              max={800}
              step={50}
              value={speed}
              onInput={(e) =>
                setSpeed(Number((e.target as HTMLInputElement).value))
              }
              style={{ width: "100%" }}
            />
          </div>
        </div>
      </div>

      {/* Click-to-add hint */}
      {playState === "idle" && (
        <div
          style={{
            marginTop: "8px",
            fontSize: "11px",
            color: "var(--color-text-muted)",
            textAlign: "center",
          }}
        >
          Click on the canvas to add individual points
        </div>
      )}
    </div>
  );
}
