import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ──────────────────────────────────────
   Types
   ────────────────────────────────────── */

interface Point {
  x: number;
  y: number;
}

type CurveType = "linear" | "quadratic" | "cubic" | "higher";

interface BezierCurve {
  id: number;
  points: Point[];
}

interface DragState {
  curveId: number;
  pointIndex: number;
}

interface AnimationState {
  running: boolean;
  t: number;
  speed: number;
}

interface PresetDef {
  name: string;
  curves: Point[][];
}

/* ──────────────────────────────────────
   Constants
   ────────────────────────────────────── */

const POINT_RADIUS = 12;
const HANDLE_RADIUS = 8;
const GRID_SIZE = 20;
const CURVE_WIDTH = 3;
const CONSTRUCTION_WIDTH = 1.5;

const LEVEL_COLORS = [
  "#4f8ff7",
  "#34d399",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

const TANGENT_COLOR = "#f59e0b";
const NORMAL_COLOR = "#ef4444";

/* ──────────────────────────────────────
   Pure math functions
   ────────────────────────────────────── */

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

function deCasteljauLevels(points: Point[], t: number): Point[][] {
  const levels: Point[][] = [points];
  let current = points;
  while (current.length > 1) {
    const next: Point[] = [];
    for (let i = 0; i < current.length - 1; i++) {
      next.push(lerpPoint(current[i], current[i + 1], t));
    }
    levels.push(next);
    current = next;
  }
  return levels;
}

function evaluateBezier(points: Point[], t: number): Point {
  const levels = deCasteljauLevels(points, t);
  const last = levels[levels.length - 1];
  return last[0];
}

function bezierDerivative(points: Point[], t: number): Point {
  const n = points.length - 1;
  if (n < 1) return { x: 0, y: 0 };

  const derivPoints: Point[] = [];
  for (let i = 0; i < n; i++) {
    derivPoints.push({
      x: n * (points[i + 1].x - points[i].x),
      y: n * (points[i + 1].y - points[i].y),
    });
  }

  if (derivPoints.length === 1) return derivPoints[0];
  return evaluateBezier(derivPoints, t);
}

function normalize(v: Point, length: number): Point {
  const mag = Math.sqrt(v.x * v.x + v.y * v.y);
  if (mag < 1e-10) return { x: 0, y: 0 };
  return { x: (v.x / mag) * length, y: (v.y / mag) * length };
}

function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function snapToGrid(p: Point, gridSize: number): Point {
  return {
    x: Math.round(p.x / gridSize) * gridSize,
    y: Math.round(p.y / gridSize) * gridSize,
  };
}

function convexHull(points: Point[]): Point[] {
  if (points.length < 3) return [...points];

  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);

  const cross = (o: Point, a: Point, b: Point): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function curveTypeName(numPoints: number): string {
  if (numPoints <= 2) return "Linear";
  if (numPoints === 3) return "Quadratic";
  if (numPoints === 4) return "Cubic";
  return `Order ${numPoints - 1}`;
}

function pointCountForType(type: CurveType): number {
  switch (type) {
    case "linear": return 2;
    case "quadratic": return 3;
    case "cubic": return 4;
    case "higher": return 5;
  }
}

/* ──────────────────────────────────────
   Presets
   ────────────────────────────────────── */

function makePresets(cx: number, cy: number, scale: number): PresetDef[] {
  const s = scale;
  return [
    {
      name: "Heart",
      curves: [
        [
          { x: cx, y: cy + s * 0.6 },
          { x: cx - s * 0.1, y: cy + s * 0.8 },
          { x: cx - s * 0.7, y: cy + s * 0.5 },
          { x: cx - s * 0.7, y: cy },
        ],
        [
          { x: cx - s * 0.7, y: cy },
          { x: cx - s * 0.7, y: cy - s * 0.5 },
          { x: cx, y: cy - s * 0.5 },
          { x: cx, y: cy - s * 0.1 },
        ],
        [
          { x: cx, y: cy - s * 0.1 },
          { x: cx, y: cy - s * 0.5 },
          { x: cx + s * 0.7, y: cy - s * 0.5 },
          { x: cx + s * 0.7, y: cy },
        ],
        [
          { x: cx + s * 0.7, y: cy },
          { x: cx + s * 0.7, y: cy + s * 0.5 },
          { x: cx + s * 0.1, y: cy + s * 0.8 },
          { x: cx, y: cy + s * 0.6 },
        ],
      ],
    },
    {
      name: "Figure-8",
      curves: [
        [
          { x: cx, y: cy },
          { x: cx + s * 0.8, y: cy - s * 0.8 },
          { x: cx + s * 0.8, y: cy + s * 0.8 },
          { x: cx, y: cy },
        ],
        [
          { x: cx, y: cy },
          { x: cx - s * 0.8, y: cy - s * 0.8 },
          { x: cx - s * 0.8, y: cy + s * 0.8 },
          { x: cx, y: cy },
        ],
      ],
    },
    {
      name: "Wave",
      curves: [
        [
          { x: cx - s, y: cy },
          { x: cx - s * 0.66, y: cy - s * 0.6 },
          { x: cx - s * 0.33, y: cy - s * 0.6 },
          { x: cx, y: cy },
        ],
        [
          { x: cx, y: cy },
          { x: cx + s * 0.33, y: cy + s * 0.6 },
          { x: cx + s * 0.66, y: cy + s * 0.6 },
          { x: cx + s, y: cy },
        ],
      ],
    },
    {
      name: "Spiral",
      curves: [
        [
          { x: cx, y: cy },
          { x: cx + s * 0.2, y: cy - s * 0.2 },
          { x: cx + s * 0.3, y: cy + s * 0.1 },
          { x: cx + s * 0.1, y: cy + s * 0.3 },
        ],
        [
          { x: cx + s * 0.1, y: cy + s * 0.3 },
          { x: cx - s * 0.2, y: cy + s * 0.5 },
          { x: cx - s * 0.6, y: cy + s * 0.1 },
          { x: cx - s * 0.4, y: cy - s * 0.3 },
        ],
        [
          { x: cx - s * 0.4, y: cy - s * 0.3 },
          { x: cx - s * 0.1, y: cy - s * 0.7 },
          { x: cx + s * 0.6, y: cy - s * 0.6 },
          { x: cx + s * 0.7, y: cy + s * 0.1 },
        ],
      ],
    },
    {
      name: "Letter S",
      curves: [
        [
          { x: cx + s * 0.4, y: cy - s * 0.6 },
          { x: cx - s * 0.2, y: cy - s * 0.8 },
          { x: cx - s * 0.5, y: cy - s * 0.3 },
          { x: cx, y: cy - s * 0.05 },
        ],
        [
          { x: cx, y: cy - s * 0.05 },
          { x: cx + s * 0.5, y: cy + s * 0.2 },
          { x: cx + s * 0.2, y: cy + s * 0.8 },
          { x: cx - s * 0.4, y: cy + s * 0.6 },
        ],
      ],
    },
  ];
}

/* ──────────────────────────────────────
   SVG / JSON export
   ────────────────────────────────────── */

function curvesToSvgPath(curves: BezierCurve[]): string {
  if (curves.length === 0) return "";

  const parts: string[] = [];
  for (let ci = 0; ci < curves.length; ci++) {
    const pts = curves[ci].points;
    if (pts.length < 2) continue;

    const r = (n: number) => Math.round(n * 100) / 100;

    if (ci === 0) {
      parts.push(`M ${r(pts[0].x)} ${r(pts[0].y)}`);
    } else {
      const prev = curves[ci - 1].points;
      const lastPrev = prev[prev.length - 1];
      if (distance(lastPrev, pts[0]) > 1) {
        parts.push(`M ${r(pts[0].x)} ${r(pts[0].y)}`);
      }
    }

    if (pts.length === 2) {
      parts.push(`L ${r(pts[1].x)} ${r(pts[1].y)}`);
    } else if (pts.length === 3) {
      parts.push(`Q ${r(pts[1].x)} ${r(pts[1].y)} ${r(pts[2].x)} ${r(pts[2].y)}`);
    } else if (pts.length === 4) {
      parts.push(
        `C ${r(pts[1].x)} ${r(pts[1].y)} ${r(pts[2].x)} ${r(pts[2].y)} ${r(pts[3].x)} ${r(pts[3].y)}`
      );
    } else {
      const steps = 60;
      for (let i = 1; i <= steps; i++) {
        const p = evaluateBezier(pts, i / steps);
        parts.push(`L ${r(p.x)} ${r(p.y)}`);
      }
    }
  }

  return parts.join(" ");
}

function curvesToJson(curves: BezierCurve[]): string {
  const data = curves.map((c) => ({
    id: c.id,
    type: curveTypeName(c.points.length),
    points: c.points.map((p) => ({
      x: Math.round(p.x * 100) / 100,
      y: Math.round(p.y * 100) / 100,
    })),
  }));
  return JSON.stringify(data, null, 2);
}

/* ──────────────────────────────────────
   Canvas drawing helpers
   ────────────────────────────────────── */

function getComputedColor(varName: string): string {
  if (typeof document === "undefined") return "#ffffff";
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || "#ffffff";
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, gridSize: number): void {
  const borderColor = getComputedColor("--color-border");
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let x = 0; x <= w; x += gridSize) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = 0; y <= h; y += gridSize) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
}

function drawCurvePath(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  color: string,
  width: number
): void {
  if (points.length < 2) return;

  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();

  const steps = Math.max(100, points.length * 30);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = evaluateBezier(points, t);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

function drawConstructionLines(
  ctx: CanvasRenderingContext2D,
  levels: Point[][],
  showLabels: boolean
): void {
  for (let li = 1; li < levels.length; li++) {
    const level = levels[li];
    const color = LEVEL_COLORS[(li - 1) % LEVEL_COLORS.length];
    const alpha = Math.max(0.3, 1 - li * 0.1);

    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = CONSTRUCTION_WIDTH;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    for (let i = 0; i < level.length; i++) {
      if (i === 0) ctx.moveTo(level[i].x, level[i].y);
      else ctx.lineTo(level[i].x, level[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    for (const p of level) {
      ctx.fillStyle = color;
      const r = Math.max(3, 6 - li);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (showLabels && li === levels.length - 1 && level.length === 1) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(level[0].x, level[0].y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 9px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("P", level[0].x, level[0].y);
    }

    ctx.globalAlpha = 1;
  }
}

function drawControlPoints(
  ctx: CanvasRenderingContext2D,
  curves: BezierCurve[],
  selectedCurveId: number | null,
  accentColor: string
): void {
  const textMuted = getComputedColor("--color-text-muted");

  for (const curve of curves) {
    const pts = curve.points;
    const isSelected = curve.id === selectedCurveId;

    ctx.strokeStyle = textMuted;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) ctx.moveTo(pts[i].x, pts[i].y);
      else ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    for (let i = 0; i < pts.length; i++) {
      const isAnchor = i === 0 || i === pts.length - 1;
      const radius = isAnchor ? POINT_RADIUS : HANDLE_RADIUS;

      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, radius, 0, Math.PI * 2);

      if (isAnchor) {
        ctx.fillStyle = accentColor;
        ctx.fill();
        if (isSelected) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = "rgba(79, 143, 247, 0.3)";
        ctx.fill();
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.fillStyle = isAnchor ? "#ffffff" : accentColor;
      ctx.font = `bold ${isAnchor ? 10 : 9}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${i}`, pts[i].x, pts[i].y);
    }
  }
}

function drawTangentNormal(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  t: number,
  showTangent: boolean,
  showNormal: boolean
): void {
  if (!showTangent && !showNormal) return;
  if (points.length < 2) return;

  const pos = evaluateBezier(points, t);
  const deriv = bezierDerivative(points, t);
  const arrowLen = 60;

  if (showTangent) {
    const tangent = normalize(deriv, arrowLen);
    ctx.strokeStyle = TANGENT_COLOR;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(pos.x - tangent.x, pos.y - tangent.y);
    ctx.lineTo(pos.x + tangent.x, pos.y + tangent.y);
    ctx.stroke();

    drawArrowHead(ctx, pos.x + tangent.x, pos.y + tangent.y, Math.atan2(tangent.y, tangent.x), TANGENT_COLOR);
  }

  if (showNormal) {
    const normal = normalize({ x: -deriv.y, y: deriv.x }, arrowLen * 0.7);
    ctx.strokeStyle = NORMAL_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineTo(pos.x + normal.x, pos.y + normal.y);
    ctx.stroke();

    drawArrowHead(ctx, pos.x + normal.x, pos.y + normal.y, Math.atan2(normal.y, normal.x), NORMAL_COLOR);
  }
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  color: string
): void {
  const size = 8;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(
    x - size * Math.cos(angle - Math.PI / 6),
    y - size * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    x - size * Math.cos(angle + Math.PI / 6),
    y - size * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
}

function drawConvexHull(ctx: CanvasRenderingContext2D, points: Point[]): void {
  if (points.length < 3) return;
  const hull = convexHull(points);
  if (hull.length < 3) return;

  ctx.strokeStyle = "rgba(168, 85, 247, 0.6)";
  ctx.fillStyle = "rgba(168, 85, 247, 0.08)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(hull[0].x, hull[0].y);
  for (let i = 1; i < hull.length; i++) {
    ctx.lineTo(hull[i].x, hull[i].y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawTracedCurve(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  t: number,
  color: string
): void {
  if (points.length < 2 || t <= 0) return;

  const steps = Math.max(60, Math.ceil(t * 120));
  ctx.strokeStyle = color;
  ctx.lineWidth = CURVE_WIDTH;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();

  for (let i = 0; i <= steps; i++) {
    const ct = (i / steps) * t;
    const p = evaluateBezier(points, ct);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

/* ──────────────────────────────────────
   Component
   ────────────────────────────────────── */

let nextCurveId = 1;

export default function BezierEditor(): preact.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);

  const [canvasSize, setCanvasSize] = useState({ w: 700, h: 500 });
  const [curves, setCurves] = useState<BezierCurve[]>(() => {
    const id = nextCurveId++;
    return [
      {
        id,
        points: [
          { x: 120, y: 360 },
          { x: 200, y: 100 },
          { x: 500, y: 100 },
          { x: 580, y: 360 },
        ],
      },
    ];
  });
  const [selectedCurveId, setSelectedCurveId] = useState<number | null>(null);
  const [newCurveType, setNewCurveType] = useState<CurveType>("cubic");
  const [tParam, setTParam] = useState(0.5);
  const [showConstruction, setShowConstruction] = useState(true);
  const [showTangent, setShowTangent] = useState(false);
  const [showNormal, setShowNormal] = useState(false);
  const [showHull, setShowHull] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [animation, setAnimation] = useState<AnimationState>({
    running: false,
    t: 0,
    speed: 0.5,
  });
  const [copyFeedback, setCopyFeedback] = useState("");
  const [continuityMode, setContinuityMode] = useState<"none" | "c0" | "c1">("c0");

  const dragRef = useRef<DragState | null>(null);
  const isDraggingRef = useRef(false);

  const selectedCurve = curves.find((c) => c.id === selectedCurveId) ?? curves[0] ?? null;

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = (): void => {
      const rect = container.getBoundingClientRect();
      const w = Math.floor(rect.width);
      const h = Math.max(400, Math.min(600, Math.floor(w * 0.65)));
      setCanvasSize({ w, h });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Draw
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const bgColor = getComputedColor("--color-bg");
    const primaryColor = getComputedColor("--color-primary");
    const accentColor = getComputedColor("--color-accent");

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    if (showGrid) {
      drawGrid(ctx, w, h, GRID_SIZE);
    }

    const currentT = animation.running ? animation.t : tParam;

    // Draw all curves
    for (const curve of curves) {
      const isActive = curve === selectedCurve;

      // Convex hull
      if (showHull && isActive) {
        drawConvexHull(ctx, curve.points);
      }

      // Curve path
      if (animation.running && isActive) {
        // Animated: draw only up to current t
        drawTracedCurve(ctx, curve.points, currentT, primaryColor);
      } else {
        drawCurvePath(ctx, curve.points, isActive ? primaryColor : "rgba(79, 143, 247, 0.4)", CURVE_WIDTH);
      }

      // Construction lines for active curve
      if (showConstruction && isActive && curve.points.length > 2) {
        const levels = deCasteljauLevels(curve.points, currentT);
        drawConstructionLines(ctx, levels, true);
      }

      // Tangent / Normal for active curve
      if (isActive) {
        drawTangentNormal(ctx, curve.points, currentT, showTangent, showNormal);
      }

      // Evaluation point marker on active curve
      if (isActive && curve.points.length >= 2) {
        const pos = evaluateBezier(curve.points, currentT);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = primaryColor;
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // Control points (draw last so they are on top)
    drawControlPoints(ctx, curves, selectedCurve?.id ?? null, accentColor);
  }, [curves, selectedCurve, tParam, showConstruction, showTangent, showNormal, showHull, showGrid, animation]);

  useEffect(() => {
    draw();
  }, [draw, canvasSize]);

  // Animation loop
  useEffect(() => {
    if (!animation.running) return;

    let lastTime: number | null = null;

    const tick = (time: number): void => {
      if (lastTime === null) lastTime = time;
      const dt = (time - lastTime) / 1000;
      lastTime = time;

      setAnimation((prev) => {
        if (!prev.running) return prev;
        let newT = prev.t + dt * prev.speed;
        if (newT >= 1) newT = 0;
        return { ...prev, t: newT };
      });

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [animation.running, animation.speed]);

  // Redraw when animation.t changes
  useEffect(() => {
    if (animation.running) draw();
  }, [animation.t, animation.running, draw]);

  // Mouse interaction
  const getCanvasPoint = useCallback(
    (e: MouseEvent): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    },
    []
  );

  const findNearestPoint = useCallback(
    (pos: Point): DragState | null => {
      let best: DragState | null = null;
      let bestDist = POINT_RADIUS + 4;

      for (const curve of curves) {
        for (let i = 0; i < curve.points.length; i++) {
          const d = distance(pos, curve.points[i]);
          if (d < bestDist) {
            bestDist = d;
            best = { curveId: curve.id, pointIndex: i };
          }
        }
      }

      return best;
    },
    [curves]
  );

  const enforceContinuity = useCallback(
    (updatedCurves: BezierCurve[], movedCurveId: number, movedPointIndex: number): BezierCurve[] => {
      if (continuityMode === "none") return updatedCurves;

      const movedCurve = updatedCurves.find((c) => c.id === movedCurveId);
      if (!movedCurve) return updatedCurves;

      const movedPts = movedCurve.points;
      const result = updatedCurves.map((c) => ({ ...c, points: [...c.points] }));

      // Check if moved point is endpoint
      const isStart = movedPointIndex === 0;
      const isEnd = movedPointIndex === movedPts.length - 1;

      if (!isStart && !isEnd) return result;

      for (const curve of result) {
        if (curve.id === movedCurveId) continue;

        const cPts = curve.points;
        const movedPos = movedPts[movedPointIndex];

        // C0: snap endpoints
        if (isEnd) {
          if (distance(cPts[0], movedPos) < 30) {
            cPts[0] = { ...movedPos };

            // C1: also mirror the handle
            if (continuityMode === "c1" && cPts.length >= 3 && movedPts.length >= 3) {
              const handleBefore = movedPts[movedPts.length - 2];
              const dx = movedPos.x - handleBefore.x;
              const dy = movedPos.y - handleBefore.y;
              cPts[1] = { x: movedPos.x + dx, y: movedPos.y + dy };
            }
          }
        }

        if (isStart) {
          const lastIdx = cPts.length - 1;
          if (distance(cPts[lastIdx], movedPos) < 30) {
            cPts[lastIdx] = { ...movedPos };

            if (continuityMode === "c1" && cPts.length >= 3 && movedPts.length >= 3) {
              const handleAfter = movedPts[1];
              const dx = movedPos.x - handleAfter.x;
              const dy = movedPos.y - handleAfter.y;
              cPts[lastIdx - 1] = { x: movedPos.x + dx, y: movedPos.y + dy };
            }
          }
        }
      }

      return result;
    },
    [continuityMode]
  );

  const handleMouseDown = useCallback(
    (e: MouseEvent): void => {
      const pos = getCanvasPoint(e);
      const hit = findNearestPoint(pos);

      if (hit) {
        dragRef.current = hit;
        isDraggingRef.current = true;
        setSelectedCurveId(hit.curveId);
      } else {
        setSelectedCurveId(null);
      }
    },
    [getCanvasPoint, findNearestPoint]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent): void => {
      if (!isDraggingRef.current || !dragRef.current) return;

      let pos = getCanvasPoint(e);
      if (snapEnabled) pos = snapToGrid(pos, GRID_SIZE);

      const { curveId, pointIndex } = dragRef.current;

      setCurves((prev) => {
        const updated = prev.map((c) => {
          if (c.id !== curveId) return c;
          const newPoints = [...c.points];
          newPoints[pointIndex] = pos;
          return { ...c, points: newPoints };
        });
        return enforceContinuity(updated, curveId, pointIndex);
      });
    },
    [getCanvasPoint, snapEnabled, enforceContinuity]
  );

  const handleMouseUp = useCallback((): void => {
    dragRef.current = null;
    isDraggingRef.current = false;
  }, []);

  // Touch support
  const handleTouchStart = useCallback(
    (e: TouchEvent): void => {
      e.preventDefault();
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      handleMouseDown(touch as unknown as MouseEvent);
    },
    [handleMouseDown]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent): void => {
      e.preventDefault();
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      handleMouseMove(touch as unknown as MouseEvent);
    },
    [handleMouseMove]
  );

  const handleTouchEnd = useCallback(
    (e: TouchEvent): void => {
      e.preventDefault();
      handleMouseUp();
    },
    [handleMouseUp]
  );

  // Actions
  const addCurve = useCallback((): void => {
    const numPoints = pointCountForType(newCurveType);
    const cx = canvasSize.w / 2;
    const cy = canvasSize.h / 2;
    const spread = 100;

    const points: Point[] = [];
    for (let i = 0; i < numPoints; i++) {
      const frac = i / (numPoints - 1);
      points.push({
        x: cx - spread + frac * spread * 2 + (Math.random() - 0.5) * 40,
        y: cy + (i % 2 === 0 ? -1 : 1) * (40 + Math.random() * 40),
      });
    }

    const id = nextCurveId++;
    setCurves((prev) => [...prev, { id, points }]);
    setSelectedCurveId(id);
  }, [newCurveType, canvasSize]);

  const removeSelectedCurve = useCallback((): void => {
    if (!selectedCurveId) return;
    setCurves((prev) => prev.filter((c) => c.id !== selectedCurveId));
    setSelectedCurveId(null);
  }, [selectedCurveId]);

  const addPointToSelected = useCallback((): void => {
    if (!selectedCurve) return;
    if (selectedCurve.points.length >= 8) return;

    const pts = selectedCurve.points;
    const last = pts[pts.length - 1];
    const secondLast = pts[pts.length - 2];
    const dx = last.x - secondLast.x;
    const dy = last.y - secondLast.y;

    const newPoint = { x: last.x + dx * 0.5, y: last.y + dy * 0.5 };

    setCurves((prev) =>
      prev.map((c) =>
        c.id === selectedCurve.id
          ? { ...c, points: [...c.points, newPoint] }
          : c
      )
    );
  }, [selectedCurve]);

  const removePointFromSelected = useCallback((): void => {
    if (!selectedCurve) return;
    if (selectedCurve.points.length <= 2) return;

    setCurves((prev) =>
      prev.map((c) =>
        c.id === selectedCurve.id
          ? { ...c, points: c.points.slice(0, -1) }
          : c
      )
    );
  }, [selectedCurve]);

  const clearAll = useCallback((): void => {
    setCurves([]);
    setSelectedCurveId(null);
  }, []);

  const loadPreset = useCallback(
    (preset: PresetDef): void => {
      const newCurves: BezierCurve[] = preset.curves.map((pts) => ({
        id: nextCurveId++,
        points: pts.map((p) => ({ ...p })),
      }));
      setCurves(newCurves);
      setSelectedCurveId(newCurves[0]?.id ?? null);
      setContinuityMode("c0");
    },
    []
  );

  const toggleAnimation = useCallback((): void => {
    setAnimation((prev) => ({
      ...prev,
      running: !prev.running,
      t: prev.running ? prev.t : 0,
    }));
  }, []);

  const copyToClipboard = useCallback(
    async (text: string, label: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(text);
        setCopyFeedback(label);
        setTimeout(() => setCopyFeedback(""), 2000);
      } catch {
        setCopyFeedback("Failed to copy");
        setTimeout(() => setCopyFeedback(""), 2000);
      }
    },
    []
  );

  const presets = makePresets(canvasSize.w / 2, canvasSize.h / 2, Math.min(canvasSize.w, canvasSize.h) * 0.35);
  const currentT = animation.running ? animation.t : tParam;

  const evalPoint = selectedCurve && selectedCurve.points.length >= 2
    ? evaluateBezier(selectedCurve.points, currentT)
    : null;

  /* ──────── Render ──────── */

  return (
    <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      <div class="flex flex-col lg:flex-row">
        {/* Canvas */}
        <div class="flex-1 relative" ref={containerRef}>
          <canvas
            ref={canvasRef}
            width={canvasSize.w}
            height={canvasSize.h}
            class="w-full cursor-crosshair touch-none"
            style={{ display: "block" }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          />

          {/* Coordinates overlay */}
          {evalPoint && (
            <div
              class="absolute bottom-2 left-2 rounded px-2 py-1 text-xs font-mono"
              style={{
                background: "color-mix(in srgb, var(--color-surface) 90%, transparent)",
                color: "var(--color-text-muted)",
              }}
            >
              t={currentT.toFixed(3)} | x={evalPoint.x.toFixed(1)} y={evalPoint.y.toFixed(1)}
            </div>
          )}
        </div>

        {/* Controls Panel */}
        <div
          class="w-full lg:w-72 border-t lg:border-t-0 lg:border-l border-[var(--color-border)] p-4 overflow-y-auto"
          style={{ maxHeight: `${canvasSize.h}px` }}
        >
          {/* Curve Info */}
          <Section title="Curve">
            {selectedCurve ? (
              <div class="text-xs text-[var(--color-text-muted)] mb-2">
                {curveTypeName(selectedCurve.points.length)} ({selectedCurve.points.length} pts)
              </div>
            ) : (
              <div class="text-xs text-[var(--color-text-muted)] mb-2">
                {curves.length} curve{curves.length !== 1 ? "s" : ""} total
              </div>
            )}

            <div class="flex gap-1 mb-2">
              <select
                class="flex-1 rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text)] text-xs px-2 py-1"
                value={newCurveType}
                onChange={(e) =>
                  setNewCurveType((e.target as HTMLSelectElement).value as CurveType)
                }
              >
                <option value="linear">Linear (2)</option>
                <option value="quadratic">Quadratic (3)</option>
                <option value="cubic">Cubic (4)</option>
                <option value="higher">Order 4 (5)</option>
              </select>
              <Btn onClick={addCurve} title="Add curve">+</Btn>
            </div>

            <div class="flex gap-1">
              <Btn onClick={addPointToSelected} disabled={!selectedCurve || (selectedCurve?.points.length ?? 0) >= 8} title="Add point">
                +Pt
              </Btn>
              <Btn onClick={removePointFromSelected} disabled={!selectedCurve || (selectedCurve?.points.length ?? 0) <= 2} title="Remove point">
                -Pt
              </Btn>
              <Btn onClick={removeSelectedCurve} disabled={!selectedCurveId} title="Delete selected curve">
                Del
              </Btn>
              <Btn onClick={clearAll} title="Clear all curves">
                Clear
              </Btn>
            </div>
          </Section>

          {/* Parameter t */}
          <Section title="Parameter t">
            <input
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={animation.running ? animation.t : tParam}
              onInput={(e) => {
                if (!animation.running) {
                  setTParam(parseFloat((e.target as HTMLInputElement).value));
                }
              }}
              class="w-full accent-[var(--color-primary)]"
              disabled={animation.running}
            />
            <div class="flex items-center justify-between mt-1">
              <span class="text-xs font-mono text-[var(--color-text-muted)]">
                t = {currentT.toFixed(3)}
              </span>
              <Btn onClick={toggleAnimation}>
                {animation.running ? "Stop" : "Animate"}
              </Btn>
            </div>
            {animation.running && (
              <div class="mt-2">
                <label class="text-xs text-[var(--color-text-muted)]">Speed</label>
                <input
                  type="range"
                  min={0.1}
                  max={2}
                  step={0.1}
                  value={animation.speed}
                  onInput={(e) =>
                    setAnimation((prev) => ({
                      ...prev,
                      speed: parseFloat((e.target as HTMLInputElement).value),
                    }))
                  }
                  class="w-full accent-[var(--color-primary)]"
                />
                <span class="text-xs font-mono text-[var(--color-text-muted)]">
                  {animation.speed.toFixed(1)}x
                </span>
              </div>
            )}
          </Section>

          {/* Display Options */}
          <Section title="Display">
            <Toggle label="Construction lines" checked={showConstruction} onChange={setShowConstruction} />
            <Toggle label="Tangent vector" checked={showTangent} onChange={setShowTangent} />
            <Toggle label="Normal vector" checked={showNormal} onChange={setShowNormal} />
            <Toggle label="Convex hull" checked={showHull} onChange={setShowHull} />
            <Toggle label="Grid" checked={showGrid} onChange={setShowGrid} />
            <Toggle label="Snap to grid" checked={snapEnabled} onChange={setSnapEnabled} />
          </Section>

          {/* Continuity */}
          <Section title="Continuity">
            <div class="flex gap-1">
              {(["none", "c0", "c1"] as const).map((mode) => (
                <button
                  key={mode}
                  class="flex-1 rounded px-2 py-1 text-xs font-mono transition-colors border"
                  style={{
                    background:
                      continuityMode === mode
                        ? "var(--color-primary)"
                        : "var(--color-bg)",
                    color:
                      continuityMode === mode
                        ? "#ffffff"
                        : "var(--color-text-muted)",
                    borderColor:
                      continuityMode === mode
                        ? "var(--color-primary)"
                        : "var(--color-border)",
                  }}
                  onClick={() => setContinuityMode(mode)}
                >
                  {mode === "none" ? "Off" : mode.toUpperCase()}
                </button>
              ))}
            </div>
            <p class="text-xs text-[var(--color-text-muted)] mt-1">
              {continuityMode === "none" && "Endpoints are independent."}
              {continuityMode === "c0" && "Snap nearby endpoints together."}
              {continuityMode === "c1" && "Match tangents at shared endpoints."}
            </p>
          </Section>

          {/* Presets */}
          <Section title="Presets">
            <div class="flex flex-wrap gap-1">
              {presets.map((p) => (
                <Btn key={p.name} onClick={() => loadPreset(p)}>
                  {p.name}
                </Btn>
              ))}
            </div>
          </Section>

          {/* Export */}
          <Section title="Export">
            <div class="flex flex-col gap-1">
              <Btn
                onClick={() => copyToClipboard(curvesToSvgPath(curves), "SVG path")}
                full
              >
                Copy SVG Path
              </Btn>
              <Btn
                onClick={() => copyToClipboard(curvesToJson(curves), "JSON")}
                full
              >
                Copy JSON
              </Btn>
            </div>
            {copyFeedback && (
              <div class="mt-1 text-xs text-[var(--color-accent)]">
                Copied {copyFeedback}!
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────
   Sub-components
   ────────────────────────────────────── */

function Section({
  title,
  children,
}: {
  title: string;
  children: preact.ComponentChildren;
}): preact.JSX.Element {
  return (
    <div class="mb-4">
      <h3
        class="text-xs font-bold uppercase tracking-wider mb-2"
        style={{ color: "var(--color-heading)" }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): preact.JSX.Element {
  return (
    <label class="flex items-center gap-2 py-0.5 cursor-pointer text-xs text-[var(--color-text)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
        class="accent-[var(--color-primary)]"
      />
      {label}
    </label>
  );
}

function Btn({
  onClick,
  children,
  disabled,
  full,
  title,
}: {
  onClick: () => void;
  children: preact.ComponentChildren;
  disabled?: boolean;
  full?: boolean;
  title?: string;
}): preact.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      class={`rounded px-2 py-1 text-xs font-medium transition-colors border border-[var(--color-border)] hover:border-[var(--color-primary)] ${
        full ? "w-full" : ""
      }`}
      style={{
        background: "var(--color-bg)",
        color: disabled ? "var(--color-text-muted)" : "var(--color-text)",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}
