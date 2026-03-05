import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import {
  computePCA,
  initTSNE,
  stepTSNE,
  findKNN,
  euclideanDistance,
} from "./math";
import type { TSNEState, TSNEParams, PCAResult } from "./math";
import {
  createWordEmbeddings,
  createMNISTDigits,
  createRandomClusters,
  createIrisDataset,
  parseEmbeddingData,
  CATEGORY_LABELS,
} from "./datasets";
import type { Dataset, EmbeddingPoint } from "./datasets";

// -----------------------------------------------------------------
// Constants
// -----------------------------------------------------------------

const POINT_COLORS = [
  "#4f8ff7", "#34d399", "#f59e0b", "#ef4444", "#a855f7",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
];

const MAX_POINTS = 500;
const TSNE_STEPS_PER_FRAME = 5;

type ReductionMethod = "pca" | "tsne";
type ViewMode = "2d" | "3d";
type DataSource = "words" | "mnist" | "clusters" | "iris" | "paste";

// -----------------------------------------------------------------
// 3D Rotation Helpers
// -----------------------------------------------------------------

function rotateY(point: number[], angle: number): number[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    point[0] * cos + point[2] * sin,
    point[1],
    -point[0] * sin + point[2] * cos,
  ];
}

function rotateX(point: number[], angle: number): number[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    point[0],
    point[1] * cos - point[2] * sin,
    point[1] * sin + point[2] * cos,
  ];
}

function project3Dto2D(
  point3d: number[],
  rotX: number,
  rotY: number
): { x: number; y: number; z: number } {
  let p = rotateY(point3d, rotY);
  p = rotateX(p, rotX);
  return { x: p[0], y: p[1], z: p[2] };
}

// -----------------------------------------------------------------
// Canvas Drawing
// -----------------------------------------------------------------

interface DrawParams {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  positions: number[][];
  points: EmbeddingPoint[];
  pointSize: number;
  showLabels: boolean;
  hoveredIdx: number;
  selectedIdx: number;
  knnIndices: number[];
  searchHighlight: Set<number>;
  viewMode: ViewMode;
  rotX: number;
  rotY: number;
  panX: number;
  panY: number;
  zoom: number;
}

function drawCanvas(params: DrawParams): void {
  const {
    ctx, width, height, positions, points,
    pointSize, showLabels, hoveredIdx, selectedIdx,
    knnIndices, searchHighlight, viewMode,
    rotX, rotY, panX, panY, zoom,
  } = params;

  ctx.clearRect(0, 0, width, height);

  // Background
  ctx.fillStyle = "rgba(0,0,0,0.02)";
  ctx.fillRect(0, 0, width, height);

  if (positions.length === 0) {
    ctx.fillStyle = getComputedStyleProp("--color-text-muted") || "#888";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No data loaded", width / 2, height / 2);
    return;
  }

  // Compute bounds for scaling
  const projected = computeProjectedPositions(
    positions, viewMode, rotX, rotY
  );

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const p of projected) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const margin = 60;
  const plotW = width - 2 * margin;
  const plotH = height - 2 * margin;
  const scale = Math.min(plotW / rangeX, plotH / rangeY) * 0.9 * zoom;
  const cx = width / 2 + panX;
  const cy = height / 2 + panY;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  const toScreenX = (x: number) => cx + (x - midX) * scale;
  const toScreenY = (y: number) => cy + (y - midY) * scale;

  // Draw 3D axes if in 3D mode
  if (viewMode === "3d") {
    drawAxes3D(ctx, cx, cy, scale, rotX, rotY);
  }

  // Sort by depth for 3D (back to front)
  const indices = Array.from({ length: projected.length }, (_, i) => i);
  if (viewMode === "3d") {
    indices.sort((a, b) => projected[a].z - projected[b].z);
  }

  // Draw KNN lines first (behind points)
  if (selectedIdx >= 0 && knnIndices.length > 0) {
    const sx = toScreenX(projected[selectedIdx].x);
    const sy = toScreenY(projected[selectedIdx].y);
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1;
    for (const ki of knnIndices) {
      const kx = toScreenX(projected[ki].x);
      const ky = toScreenY(projected[ki].y);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(kx, ky);
      ctx.stroke();
    }
  }

  // Draw points
  for (const i of indices) {
    const px = toScreenX(projected[i].x);
    const py = toScreenY(projected[i].y);
    const point = points[i];
    const color = POINT_COLORS[point.category % POINT_COLORS.length];

    let size = pointSize;
    let alpha = 1.0;

    // Depth cuing for 3D
    if (viewMode === "3d") {
      const normalizedZ =
        (projected[i].z - projected[indices[0]].z) /
        (projected[indices[indices.length - 1]].z - projected[indices[0]].z || 1);
      alpha = 0.3 + normalizedZ * 0.7;
      size = pointSize * (0.5 + normalizedZ * 0.5);
    }

    // Highlight search matches
    const isSearchMatch = searchHighlight.size > 0 && searchHighlight.has(i);
    const isSearchDimmed = searchHighlight.size > 0 && !searchHighlight.has(i);
    const isKNN = knnIndices.includes(i);
    const isSelected = i === selectedIdx;
    const isHovered = i === hoveredIdx;

    if (isSearchDimmed) {
      alpha *= 0.15;
    }

    ctx.globalAlpha = alpha;

    // Draw point
    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);

    if (isSelected) {
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (isKNN) {
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (isHovered || isSearchMatch) {
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }

    // Draw labels
    if (showLabels || isHovered || isSelected || isSearchMatch) {
      ctx.globalAlpha = isSearchDimmed ? 0.15 : 1;
      ctx.fillStyle = getComputedStyleProp("--color-text") || "#e4e4e7";
      ctx.font = `${isSelected || isHovered ? "bold " : ""}10px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(point.label, px, py - size - 4);
    }
  }

  ctx.globalAlpha = 1;

  // Draw hover tooltip
  if (hoveredIdx >= 0 && hoveredIdx < points.length) {
    drawTooltip(
      ctx, width, height,
      toScreenX(projected[hoveredIdx].x),
      toScreenY(projected[hoveredIdx].y),
      points[hoveredIdx]
    );
  }
}

function computeProjectedPositions(
  positions: number[][],
  viewMode: ViewMode,
  rotX: number,
  rotY: number
): { x: number; y: number; z: number }[] {
  if (viewMode === "2d") {
    return positions.map((p) => ({ x: p[0], y: p[1], z: 0 }));
  }
  return positions.map((p) => {
    const p3 = [p[0] || 0, p[1] || 0, p[2] || 0];
    return project3Dto2D(p3, rotX, rotY);
  });
}

function drawAxes3D(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  rotX: number,
  rotY: number
): void {
  const axisLen = 2;
  const axes = [
    { dir: [axisLen, 0, 0], label: "PC1", color: "#ef4444" },
    { dir: [0, axisLen, 0], label: "PC2", color: "#34d399" },
    { dir: [0, 0, axisLen], label: "PC3", color: "#4f8ff7" },
  ];

  ctx.globalAlpha = 0.4;
  for (const axis of axes) {
    const projected = project3Dto2D(axis.dir, rotX, rotY);
    const ex = cx + projected.x * scale * 0.3;
    const ey = cy + projected.y * scale * 0.3;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ex, ey);
    ctx.strokeStyle = axis.color;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = axis.color;
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(axis.label, ex + (ex - cx) * 0.15, ey + (ey - cy) * 0.15);
  }
  ctx.globalAlpha = 1;
}

function drawTooltip(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  _canvasH: number,
  px: number,
  py: number,
  point: EmbeddingPoint
): void {
  const vecStr =
    point.vector.length <= 6
      ? `[${point.vector.map((v) => v.toFixed(2)).join(", ")}]`
      : `[${point.vector.slice(0, 4).map((v) => v.toFixed(2)).join(", ")}, ... (${point.vector.length}d)]`;

  const text = `${point.label}: ${vecStr}`;
  ctx.font = "11px monospace";
  const metrics = ctx.measureText(text);
  const tw = metrics.width + 16;
  const th = 24;

  let tx = px - tw / 2;
  let ty = py - 20;
  if (tx < 4) tx = 4;
  if (tx + tw > canvasW - 4) tx = canvasW - tw - 4;
  if (ty < 4) ty = py + 20;

  ctx.fillStyle = "rgba(0,0,0,0.85)";
  ctx.beginPath();
  roundRect(ctx, tx, ty, tw, th, 4);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.fillText(text, tx + 8, ty + 16);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function getComputedStyleProp(prop: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement)
    .getPropertyValue(prop)
    .trim();
}

// -----------------------------------------------------------------
// Main Component
// -----------------------------------------------------------------

export default function EmbeddingExplorer() {
  // Data state
  const [dataSource, setDataSource] = useState<DataSource>("words");
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState("");

  // Reduction state
  const [method, setMethod] = useState<ReductionMethod>("pca");
  const [viewMode, setViewMode] = useState<ViewMode>("2d");
  const [perplexity, setPerplexity] = useState(30);
  const [learningRate, setLearningRate] = useState(50);

  // Visualization state
  const [pointSize, setPointSize] = useState(4);
  const [showLabels, setShowLabels] = useState(false);
  const [kValue, setKValue] = useState(5);
  const [searchQuery, setSearchQuery] = useState("");

  // Computed state
  const [positions, setPositions] = useState<number[][]>([]);
  const [hoveredIdx, setHoveredIdx] = useState(-1);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [knnIndices, setKnnIndices] = useState<number[]>([]);
  const [pcaResult, setPcaResult] = useState<PCAResult | null>(null);

  // t-SNE animation state
  const [tsneRunning, setTsneRunning] = useState(false);
  const [tsneIteration, setTsneIteration] = useState(0);
  const [tsneKL, setTsneKL] = useState(0);

  // View state for pan/zoom/rotate
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [rotX, setRotX] = useState(0.4);
  const [rotY, setRotY] = useState(0.6);

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tsneStateRef = useRef<TSNEState | null>(null);
  const tsneAffinitiesRef = useRef<number[][] | null>(null);
  const tsneMomentumRef = useRef<number[][] | null>(null);
  const tsneRunningRef = useRef(false);
  const perplexityRef = useRef(perplexity);
  const learningRateRef = useRef(learningRate);
  const autoRotateRef = useRef(true);
  const isDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const isPanningRef = useRef(false);

  // Keep refs in sync
  useEffect(() => { perplexityRef.current = perplexity; }, [perplexity]);
  useEffect(() => { learningRateRef.current = learningRate; }, [learningRate]);

  // -----------------------------------------------------------------
  // Load Dataset
  // -----------------------------------------------------------------

  const loadDataset = useCallback((source: DataSource) => {
    let ds: Dataset | null = null;
    switch (source) {
      case "words":
        ds = createWordEmbeddings();
        break;
      case "mnist":
        ds = createMNISTDigits();
        break;
      case "clusters":
        ds = createRandomClusters();
        break;
      case "iris":
        ds = createIrisDataset();
        break;
      case "paste":
        return; // Handled separately
    }
    if (ds) {
      setDataset(ds);
      setPasteError("");
    }
  }, []);

  // Load initial dataset
  useEffect(() => {
    loadDataset("words");
  }, [loadDataset]);

  // Handle data source change
  useEffect(() => {
    if (dataSource !== "paste") {
      loadDataset(dataSource);
    }
  }, [dataSource, loadDataset]);

  // -----------------------------------------------------------------
  // Compute Reduction
  // -----------------------------------------------------------------

  const runPCA = useCallback(() => {
    if (!dataset) return;
    const nComp = viewMode === "3d" ? 3 : 2;
    const data = dataset.points.map((p) => p.vector);
    const result = computePCA(data, nComp);
    setPcaResult(result);
    setPositions(result.projected);
  }, [dataset, viewMode]);

  const startTSNE = useCallback(() => {
    if (!dataset) return;
    const data = dataset.points.map((p) => p.vector);
    const nComp = viewMode === "3d" ? 3 : 2;
    const params: TSNEParams = {
      perplexity: perplexityRef.current,
      learningRate: learningRateRef.current,
      nComponents: nComp,
    };
    const { state, affinities } = initTSNE(data, params);
    tsneStateRef.current = state;
    tsneAffinitiesRef.current = affinities;
    tsneMomentumRef.current = Array.from({ length: data.length }, () =>
      new Array(nComp).fill(0)
    );
    setPositions(state.positions);
    setTsneIteration(0);
    setTsneKL(0);
    setTsneRunning(true);
    tsneRunningRef.current = true;
  }, [dataset, viewMode]);

  const pauseTSNE = useCallback(() => {
    setTsneRunning(false);
    tsneRunningRef.current = false;
  }, []);

  const resumeTSNE = useCallback(() => {
    if (tsneStateRef.current) {
      setTsneRunning(true);
      tsneRunningRef.current = true;
    }
  }, []);

  const resetReduction = useCallback(() => {
    pauseTSNE();
    tsneStateRef.current = null;
    tsneAffinitiesRef.current = null;
    tsneMomentumRef.current = null;
    setPositions([]);
    setPcaResult(null);
    setTsneIteration(0);
    setTsneKL(0);
    setSelectedIdx(-1);
    setKnnIndices([]);
    setPanX(0);
    setPanY(0);
    setZoom(1);
  }, [pauseTSNE]);

  // Run PCA when method is PCA and dataset changes
  useEffect(() => {
    if (method === "pca" && dataset) {
      resetReduction();
      // Small delay to let state clear
      const timer = setTimeout(() => runPCA(), 10);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [method, dataset, viewMode, runPCA, resetReduction]);

  // Start t-SNE when method is tsne (perplexity/learningRate only apply on restart)
  useEffect(() => {
    if (method === "tsne" && dataset) {
      resetReduction();
      const timer = setTimeout(() => startTSNE(), 10);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [method, dataset, viewMode, startTSNE, resetReduction]);

  // -----------------------------------------------------------------
  // t-SNE Animation Loop
  // -----------------------------------------------------------------

  useEffect(() => {
    if (!tsneRunning) return undefined;

    const nComp = viewMode === "3d" ? 3 : 2;
    let frameId = 0;

    const animate = () => {
      if (
        !tsneRunningRef.current ||
        !tsneStateRef.current ||
        !tsneAffinitiesRef.current ||
        !tsneMomentumRef.current
      ) {
        return;
      }

      const params: TSNEParams = {
        perplexity: perplexityRef.current,
        learningRate: learningRateRef.current,
        nComponents: nComp,
      };

      let currentState = tsneStateRef.current;
      let currentMomentum = tsneMomentumRef.current;

      for (let i = 0; i < TSNE_STEPS_PER_FRAME; i++) {
        const result = stepTSNE(
          currentState,
          tsneAffinitiesRef.current,
          params,
          currentMomentum
        );
        currentState = result.state;
        currentMomentum = result.momentum;
      }

      tsneStateRef.current = currentState;
      tsneMomentumRef.current = currentMomentum;
      setPositions([...currentState.positions]);
      setTsneIteration(currentState.iteration);
      setTsneKL(currentState.klDivergence);

      // Auto-stop after 1000 iterations
      if (currentState.iteration >= 1000) {
        setTsneRunning(false);
        tsneRunningRef.current = false;
        return;
      }

      frameId = requestAnimationFrame(animate);
    };

    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [tsneRunning, viewMode]);

  // -----------------------------------------------------------------
  // 3D Auto-rotation
  // -----------------------------------------------------------------

  useEffect(() => {
    if (viewMode !== "3d") return undefined;
    let frameId = 0;

    const rotate = () => {
      if (autoRotateRef.current && !isDraggingRef.current) {
        setRotY((prev) => prev + 0.005);
      }
      frameId = requestAnimationFrame(rotate);
    };

    frameId = requestAnimationFrame(rotate);
    return () => cancelAnimationFrame(frameId);
  }, [viewMode]);

  // -----------------------------------------------------------------
  // KNN Computation
  // -----------------------------------------------------------------

  useEffect(() => {
    if (selectedIdx >= 0 && dataset && dataset.points.length > 0) {
      const data = dataset.points.map((p) => p.vector);
      const neighbors = findKNN(data, selectedIdx, kValue);
      setKnnIndices(neighbors);
    } else {
      setKnnIndices([]);
    }
  }, [selectedIdx, kValue, dataset]);

  // -----------------------------------------------------------------
  // Search Highlight
  // -----------------------------------------------------------------

  const searchHighlight = new Set<number>();
  if (searchQuery.trim() && dataset) {
    const q = searchQuery.toLowerCase();
    dataset.points.forEach((p, i) => {
      if (p.label.toLowerCase().includes(q)) {
        searchHighlight.add(i);
      }
    });
  }

  // -----------------------------------------------------------------
  // Canvas Drawing
  // -----------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    drawCanvas({
      ctx,
      width: rect.width,
      height: rect.height,
      positions,
      points: dataset?.points || [],
      pointSize,
      showLabels,
      hoveredIdx,
      selectedIdx,
      knnIndices,
      searchHighlight,
      viewMode,
      rotX,
      rotY,
      panX,
      panY,
      zoom,
    });
  }, [
    positions, dataset, pointSize, showLabels,
    hoveredIdx, selectedIdx, knnIndices,
    viewMode, rotX, rotY, panX, panY, zoom, searchQuery,
  ]);

  // -----------------------------------------------------------------
  // Canvas Interaction Handlers
  // -----------------------------------------------------------------

  const getCanvasPoint = useCallback(
    (e: MouseEvent): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    []
  );

  const findPointAtPosition = useCallback(
    (mx: number, my: number): number => {
      if (!dataset || positions.length === 0) return -1;

      const canvas = canvasRef.current;
      if (!canvas) return -1;
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      const projected = computeProjectedPositions(
        positions, viewMode, rotX, rotY
      );

      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      for (const p of projected) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }

      const rangeX = maxX - minX || 1;
      const rangeY = maxY - minY || 1;
      const margin = 60;
      const plotW = width - 2 * margin;
      const plotH = height - 2 * margin;
      const scale = Math.min(plotW / rangeX, plotH / rangeY) * 0.9 * zoom;
      const cx = width / 2 + panX;
      const cy = height / 2 + panY;
      const midPX = (minX + maxX) / 2;
      const midPY = (minY + maxY) / 2;

      let closest = -1;
      let closestDist = Infinity;

      for (let i = 0; i < projected.length; i++) {
        const sx = cx + (projected[i].x - midPX) * scale;
        const sy = cy + (projected[i].y - midPY) * scale;
        const dx = mx - sx;
        const dy = my - sy;
        const dist = dx * dx + dy * dy;
        const hitRadius = (pointSize + 4) * (pointSize + 4);
        if (dist < hitRadius && dist < closestDist) {
          closest = i;
          closestDist = dist;
        }
      }

      return closest;
    },
    [dataset, positions, viewMode, rotX, rotY, panX, panY, zoom, pointSize]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      const { x, y } = getCanvasPoint(e);

      if (isDraggingRef.current && viewMode === "3d") {
        const dx = x - lastMouseRef.current.x;
        const dy = y - lastMouseRef.current.y;
        setRotY((prev) => prev + dx * 0.01);
        setRotX((prev) => prev + dy * 0.01);
        lastMouseRef.current = { x, y };
        autoRotateRef.current = false;
        return;
      }

      if (isPanningRef.current) {
        const dx = x - lastMouseRef.current.x;
        const dy = y - lastMouseRef.current.y;
        setPanX((prev) => prev + dx);
        setPanY((prev) => prev + dy);
        lastMouseRef.current = { x, y };
        return;
      }

      const idx = findPointAtPosition(x, y);
      setHoveredIdx(idx);
    },
    [getCanvasPoint, viewMode, findPointAtPosition]
  );

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      const { x, y } = getCanvasPoint(e);
      lastMouseRef.current = { x, y };

      if (viewMode === "3d" && e.button === 0) {
        isDraggingRef.current = true;
        return;
      }

      if (e.button === 0 && viewMode === "2d") {
        // Check if clicking a point first
        const idx = findPointAtPosition(x, y);
        if (idx >= 0) {
          setSelectedIdx((prev) => (prev === idx ? -1 : idx));
        } else {
          isPanningRef.current = true;
        }
      }
    },
    [getCanvasPoint, viewMode, findPointAtPosition]
  );

  const handleMouseUp = useCallback(
    (e: MouseEvent) => {
      if (isDraggingRef.current && viewMode === "3d") {
        // Check if it was a click (not a drag)
        const { x, y } = getCanvasPoint(e);
        const dx = x - lastMouseRef.current.x;
        const dy = y - lastMouseRef.current.y;
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
          const idx = findPointAtPosition(x, y);
          if (idx >= 0) {
            setSelectedIdx((prev) => (prev === idx ? -1 : idx));
          }
        }
      }
      isDraggingRef.current = false;
      isPanningRef.current = false;
    },
    [getCanvasPoint, viewMode, findPointAtPosition]
  );

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((prev) => Math.max(0.1, Math.min(10, prev * delta)));
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredIdx(-1);
    isDraggingRef.current = false;
    isPanningRef.current = false;
  }, []);

  // -----------------------------------------------------------------
  // Handle paste data
  // -----------------------------------------------------------------

  const handlePasteData = useCallback(() => {
    const parsed = parseEmbeddingData(pasteText);
    if (!parsed) {
      setPasteError("Could not parse data. Provide CSV/TSV with numeric values.");
      return;
    }
    if (parsed.points.length > MAX_POINTS) {
      setPasteError(`Max ${MAX_POINTS} points. Got ${parsed.points.length}.`);
      return;
    }
    setPasteError("");
    setDataset(parsed);
  }, [pasteText]);

  // -----------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------

  const stats = {
    points: dataset?.points.length || 0,
    dimensions: dataset?.dimensions || 0,
    explainedVariance:
      pcaResult?.explainedVariance
        .map((v) => (v * 100).toFixed(1) + "%")
        .join(" + ") || "--",
    totalExplained:
      pcaResult?.explainedVariance
        ? (pcaResult.explainedVariance.reduce((a, b) => a + b, 0) * 100).toFixed(1) + "%"
        : "--",
  };

  // -----------------------------------------------------------------
  // Selected point info
  // -----------------------------------------------------------------

  const selectedPoint =
    selectedIdx >= 0 && dataset ? dataset.points[selectedIdx] : null;
  const knnPoints =
    dataset && knnIndices.length > 0
      ? knnIndices.map((i) => ({
          label: dataset.points[i].label,
          distance: euclideanDistance(
            dataset.points[selectedIdx].vector,
            dataset.points[i].vector
          ),
        }))
      : [];

  // -----------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------

  return (
    <div
      class="rounded-lg border"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-surface)",
      }}
    >
      {/* Top Bar: Data Source + Method + View */}
      <div
        class="flex flex-wrap items-center gap-3 border-b px-4 py-3"
        style={{ borderColor: "var(--color-border)" }}
      >
        {/* Data Source */}
        <div class="flex items-center gap-2">
          <span
            class="text-xs font-medium"
            style={{ color: "var(--color-text-muted)" }}
          >
            Data:
          </span>
          <select
            value={dataSource}
            onChange={(e) => {
              const val = (e.target as HTMLSelectElement).value as DataSource;
              setDataSource(val);
              setSelectedIdx(-1);
              setKnnIndices([]);
              resetReduction();
            }}
            class="rounded border px-2 py-1 text-xs"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-bg)",
              color: "var(--color-text)",
            }}
          >
            <option value="words">Word Embeddings</option>
            <option value="mnist">MNIST Digits</option>
            <option value="clusters">Random Clusters</option>
            <option value="iris">Iris Dataset</option>
            <option value="paste">Paste Data</option>
          </select>
        </div>

        {/* Method */}
        <div class="flex items-center gap-2">
          <span
            class="text-xs font-medium"
            style={{ color: "var(--color-text-muted)" }}
          >
            Method:
          </span>
          <div class="flex gap-1">
            <button
              onClick={() => setMethod("pca")}
              class="rounded px-2 py-1 text-xs font-medium transition-colors"
              style={{
                background:
                  method === "pca"
                    ? "var(--color-primary)"
                    : "var(--color-bg)",
                color:
                  method === "pca" ? "#ffffff" : "var(--color-text-muted)",
                border: "1px solid var(--color-border)",
              }}
            >
              PCA
            </button>
            <button
              onClick={() => setMethod("tsne")}
              class="rounded px-2 py-1 text-xs font-medium transition-colors"
              style={{
                background:
                  method === "tsne"
                    ? "var(--color-primary)"
                    : "var(--color-bg)",
                color:
                  method === "tsne" ? "#ffffff" : "var(--color-text-muted)",
                border: "1px solid var(--color-border)",
              }}
            >
              t-SNE
            </button>
          </div>
        </div>

        {/* View */}
        <div class="flex items-center gap-2">
          <span
            class="text-xs font-medium"
            style={{ color: "var(--color-text-muted)" }}
          >
            View:
          </span>
          <div class="flex gap-1">
            <button
              onClick={() => setViewMode("2d")}
              class="rounded px-2 py-1 text-xs font-medium transition-colors"
              style={{
                background:
                  viewMode === "2d"
                    ? "var(--color-accent)"
                    : "var(--color-bg)",
                color:
                  viewMode === "2d" ? "#ffffff" : "var(--color-text-muted)",
                border: "1px solid var(--color-border)",
              }}
            >
              2D
            </button>
            <button
              onClick={() => {
                setViewMode("3d");
                autoRotateRef.current = true;
              }}
              class="rounded px-2 py-1 text-xs font-medium transition-colors"
              style={{
                background:
                  viewMode === "3d"
                    ? "var(--color-accent)"
                    : "var(--color-bg)",
                color:
                  viewMode === "3d" ? "#ffffff" : "var(--color-text-muted)",
                border: "1px solid var(--color-border)",
              }}
            >
              3D
            </button>
          </div>
        </div>

        {/* t-SNE Controls */}
        {method === "tsne" && (
          <div class="flex items-center gap-2">
            <button
              onClick={() =>
                tsneRunning ? pauseTSNE() : tsneStateRef.current ? resumeTSNE() : startTSNE()
              }
              class="rounded px-2 py-1 text-xs font-medium"
              style={{
                background: tsneRunning
                  ? "var(--color-accent)"
                  : "var(--color-primary)",
                color: "#ffffff",
              }}
            >
              {tsneRunning ? "Pause" : tsneStateRef.current ? "Resume" : "Run"}
            </button>
            <button
              onClick={() => {
                resetReduction();
                setTimeout(() => startTSNE(), 50);
              }}
              class="rounded px-2 py-1 text-xs font-medium"
              style={{
                background: "var(--color-bg)",
                color: "var(--color-text-muted)",
                border: "1px solid var(--color-border)",
              }}
            >
              Reset
            </button>
          </div>
        )}
      </div>

      {/* Paste Area (shown when paste mode is selected) */}
      {dataSource === "paste" && (
        <div class="border-b px-4 py-3" style={{ borderColor: "var(--color-border)" }}>
          <textarea
            value={pasteText}
            onInput={(e) =>
              setPasteText((e.target as HTMLTextAreaElement).value)
            }
            placeholder={
              "Paste CSV/TSV data (one vector per line, optional label column)\nExample:\n0.1, 0.5, 0.3, cat\n0.2, 0.4, 0.6, dog\n0.8, 0.1, 0.2, bird"
            }
            class="w-full rounded border p-2 font-mono text-xs"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-bg)",
              color: "var(--color-text)",
              minHeight: "80px",
              maxHeight: "150px",
              resize: "vertical",
            }}
          />
          <div class="mt-2 flex items-center gap-2">
            <button
              onClick={handlePasteData}
              class="rounded px-3 py-1 text-xs font-medium"
              style={{
                background: "var(--color-primary)",
                color: "#ffffff",
              }}
            >
              Load Data
            </button>
            {pasteError && (
              <span class="text-xs" style={{ color: "#ef4444" }}>
                {pasteError}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Main Content: Canvas + Controls */}
      <div class="flex flex-col lg:flex-row">
        {/* Canvas */}
        <div class="relative min-h-[400px] flex-1 lg:min-h-[500px]">
          <canvas
            ref={canvasRef}
            class="h-full w-full cursor-crosshair"
            style={{ display: "block" }}
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onWheel={handleWheel}
          />

          {/* t-SNE iteration overlay */}
          {method === "tsne" && (
            <div
              class="absolute left-3 top-3 rounded px-2 py-1 text-xs font-mono"
              style={{
                background: "rgba(0,0,0,0.6)",
                color: "#ffffff",
              }}
            >
              Iter: {tsneIteration}
              {tsneRunning && (
                <span
                  class="ml-2 inline-block h-2 w-2 rounded-full"
                  style={{ background: "var(--color-accent)" }}
                />
              )}
            </div>
          )}
        </div>

        {/* Side Panel */}
        <div
          class="w-full border-t lg:w-64 lg:border-l lg:border-t-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          {/* Controls Section */}
          <div class="space-y-3 p-4">
            <h3
              class="text-xs font-bold uppercase tracking-wider"
              style={{ color: "var(--color-text-muted)" }}
            >
              Controls
            </h3>

            {/* t-SNE Perplexity */}
            {method === "tsne" && (
              <div>
                <label
                  class="mb-1 block text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Perplexity: {perplexity}
                </label>
                <input
                  type="range"
                  min="5"
                  max="50"
                  value={perplexity}
                  onInput={(e) =>
                    setPerplexity(
                      parseInt((e.target as HTMLInputElement).value, 10)
                    )
                  }
                  class="w-full accent-[var(--color-primary)]"
                />
              </div>
            )}

            {/* t-SNE Learning Rate */}
            {method === "tsne" && (
              <div>
                <label
                  class="mb-1 block text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Learning Rate: {learningRate}
                </label>
                <input
                  type="range"
                  min="10"
                  max="200"
                  value={learningRate}
                  onInput={(e) =>
                    setLearningRate(
                      parseInt((e.target as HTMLInputElement).value, 10)
                    )
                  }
                  class="w-full accent-[var(--color-primary)]"
                />
              </div>
            )}

            {/* Point Size */}
            <div>
              <label
                class="mb-1 block text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                Point Size: {pointSize}
              </label>
              <input
                type="range"
                min="2"
                max="10"
                value={pointSize}
                onInput={(e) =>
                  setPointSize(
                    parseInt((e.target as HTMLInputElement).value, 10)
                  )
                }
                class="w-full accent-[var(--color-primary)]"
              />
            </div>

            {/* K for KNN */}
            <div>
              <label
                class="mb-1 block text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                Nearest Neighbors (K): {kValue}
              </label>
              <input
                type="range"
                min="1"
                max="10"
                value={kValue}
                onInput={(e) =>
                  setKValue(
                    parseInt((e.target as HTMLInputElement).value, 10)
                  )
                }
                class="w-full accent-[var(--color-primary)]"
              />
            </div>

            {/* Show Labels */}
            <label
              class="flex cursor-pointer items-center gap-2 text-xs"
              style={{ color: "var(--color-text)" }}
            >
              <input
                type="checkbox"
                checked={showLabels}
                onChange={(e) =>
                  setShowLabels((e.target as HTMLInputElement).checked)
                }
                class="accent-[var(--color-primary)]"
              />
              Show Labels
            </label>

            {/* Search */}
            <div>
              <label
                class="mb-1 block text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                Search:
              </label>
              <input
                type="text"
                value={searchQuery}
                onInput={(e) =>
                  setSearchQuery((e.target as HTMLInputElement).value)
                }
                placeholder="Find points..."
                class="w-full rounded border px-2 py-1 text-xs"
                style={{
                  borderColor: "var(--color-border)",
                  background: "var(--color-bg)",
                  color: "var(--color-text)",
                }}
              />
              {searchHighlight.size > 0 && (
                <span
                  class="mt-1 block text-xs"
                  style={{ color: "var(--color-accent)" }}
                >
                  {searchHighlight.size} match
                  {searchHighlight.size !== 1 ? "es" : ""}
                </span>
              )}
            </div>
          </div>

          {/* Stats Section */}
          <div
            class="border-t p-4"
            style={{ borderColor: "var(--color-border)" }}
          >
            <h3
              class="mb-2 text-xs font-bold uppercase tracking-wider"
              style={{ color: "var(--color-text-muted)" }}
            >
              Stats
            </h3>
            <div class="space-y-1 font-mono text-xs">
              <div style={{ color: "var(--color-text)" }}>
                Points: {stats.points}
              </div>
              <div style={{ color: "var(--color-text)" }}>
                Dims: {stats.dimensions}
              </div>
              {method === "pca" && (
                <div style={{ color: "var(--color-text)" }}>
                  Explained: {stats.totalExplained}
                </div>
              )}
              {method === "tsne" && (
                <>
                  <div style={{ color: "var(--color-text)" }}>
                    Iteration: {tsneIteration}
                  </div>
                  <div style={{ color: "var(--color-text)" }}>
                    KL Div: {tsneKL.toFixed(4)}
                  </div>
                </>
              )}
            </div>

            {/* Legend */}
            {dataset && (
              <div class="mt-3">
                <h4
                  class="mb-1 text-xs font-bold uppercase tracking-wider"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Legend
                </h4>
                <div class="space-y-1">
                  {getUniqueCategoryLabels(dataset).map(
                    ({ category, label }) => (
                      <div
                        key={category}
                        class="flex items-center gap-2 text-xs"
                      >
                        <span
                          class="inline-block h-2.5 w-2.5 rounded-full"
                          style={{
                            background:
                              POINT_COLORS[category % POINT_COLORS.length],
                          }}
                        />
                        <span style={{ color: "var(--color-text)" }}>
                          {label}
                        </span>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Selected Point Info */}
          {selectedPoint && (
            <div
              class="border-t p-4"
              style={{ borderColor: "var(--color-border)" }}
            >
              <h3
                class="mb-2 text-xs font-bold uppercase tracking-wider"
                style={{ color: "var(--color-text-muted)" }}
              >
                Selected
              </h3>
              <div
                class="mb-1 text-sm font-bold"
                style={{ color: "var(--color-heading)" }}
              >
                {selectedPoint.label}
              </div>
              <div
                class="mb-2 break-all font-mono text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                {selectedPoint.vector.length <= 8
                  ? `[${selectedPoint.vector.map((v) => v.toFixed(2)).join(", ")}]`
                  : `[${selectedPoint.vector
                      .slice(0, 6)
                      .map((v) => v.toFixed(2))
                      .join(", ")}, ...] (${selectedPoint.vector.length}d)`}
              </div>

              {knnPoints.length > 0 && (
                <>
                  <h4
                    class="mb-1 text-xs font-bold"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    {kValue} Nearest:
                  </h4>
                  <div class="space-y-0.5">
                    {knnPoints.map(({ label, distance }, i) => (
                      <div
                        key={i}
                        class="flex items-center justify-between text-xs"
                      >
                        <span style={{ color: "var(--color-text)" }}>
                          {label}
                        </span>
                        <span
                          class="font-mono"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          d={distance.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Interaction Hints */}
      <div
        class="border-t px-4 py-2 text-xs"
        style={{
          borderColor: "var(--color-border)",
          color: "var(--color-text-muted)",
        }}
      >
        {viewMode === "2d"
          ? "Click a point to select. Drag to pan. Scroll to zoom."
          : "Click a point to select. Drag to rotate. Scroll to zoom."}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

function getUniqueCategoryLabels(
  dataset: Dataset
): { category: number; label: string }[] {
  const seen = new Set<number>();
  const result: { category: number; label: string }[] = [];
  const categoryLabels = CATEGORY_LABELS[dataset.name];

  for (const point of dataset.points) {
    if (!seen.has(point.category)) {
      seen.add(point.category);
      result.push({
        category: point.category,
        label: categoryLabels?.[point.category] || `Group ${point.category}`,
      });
    }
  }
  return result.sort((a, b) => a.category - b.category);
}
