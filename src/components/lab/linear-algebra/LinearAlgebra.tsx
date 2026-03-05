import { useState, useEffect, useRef, useCallback } from "preact/hooks";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

type Mat2 = [number, number, number, number]; // [a, b, c, d] row-major: [[a,b],[c,d]]
type Vec2 = [number, number];

interface Preset {
  name: string;
  label: string;
  matrix: Mat2;
  hasSlider?: boolean;
  sliderLabel?: string;
  sliderRange?: [number, number];
  sliderDefault?: number;
  matrixFromSlider?: (v: number) => Mat2;
}

interface EigenResult {
  values: [number | null, number | null];
  vectors: [Vec2 | null, Vec2 | null];
  isComplex: boolean;
}

interface CompositionEntry {
  name: string;
  matrix: Mat2;
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const IDENTITY: Mat2 = [1, 0, 0, 1];

const COLORS = {
  iHat: "#ef4444",
  jHat: "#4f8ff7",
  iHatLight: "#fca5a5",
  jHatLight: "#93c5fd",
  eigen1: "#f59e0b",
  eigen2: "#a855f7",
  unitSquare: "rgba(52, 211, 153, 0.15)",
  unitSquareStroke: "rgba(52, 211, 153, 0.5)",
  detNegative: "rgba(239, 68, 68, 0.12)",
};

const ANIMATION_DURATION = 500;

const PRESETS: Preset[] = [
  { name: "identity", label: "Identity", matrix: [1, 0, 0, 1] },
  {
    name: "rotation",
    label: "Rotation",
    matrix: [1, 0, 0, 1],
    hasSlider: true,
    sliderLabel: "Angle",
    sliderRange: [0, 360],
    sliderDefault: 45,
    matrixFromSlider: (deg: number) => {
      const r = (deg * Math.PI) / 180;
      return [Math.cos(r), -Math.sin(r), Math.sin(r), Math.cos(r)];
    },
  },
  {
    name: "scale",
    label: "Scale",
    matrix: [2, 0, 0, 2],
    hasSlider: true,
    sliderLabel: "Factor",
    sliderRange: [-3, 3],
    sliderDefault: 2,
    matrixFromSlider: (v: number) => [v, 0, 0, v],
  },
  {
    name: "scaleXY",
    label: "Scale X/Y",
    matrix: [2, 0, 0, 0.5],
  },
  {
    name: "shearX",
    label: "Shear X",
    matrix: [1, 1, 0, 1],
    hasSlider: true,
    sliderLabel: "Amount",
    sliderRange: [-3, 3],
    sliderDefault: 1,
    matrixFromSlider: (v: number) => [1, v, 0, 1],
  },
  {
    name: "shearY",
    label: "Shear Y",
    matrix: [1, 0, 1, 1],
    hasSlider: true,
    sliderLabel: "Amount",
    sliderRange: [-3, 3],
    sliderDefault: 1,
    matrixFromSlider: (v: number) => [1, 0, v, 1],
  },
  { name: "reflectX", label: "Reflect X", matrix: [1, 0, 0, -1] },
  { name: "reflectY", label: "Reflect Y", matrix: [-1, 0, 0, 1] },
  { name: "reflectYeqX", label: "Reflect y=x", matrix: [0, 1, 1, 0] },
  {
    name: "rotate90",
    label: "90\u00b0 Rot",
    matrix: [0, -1, 1, 0],
  },
  {
    name: "projection",
    label: "Project",
    matrix: [1, 0, 0, 0],
    hasSlider: true,
    sliderLabel: "Angle",
    sliderRange: [0, 180],
    sliderDefault: 0,
    matrixFromSlider: (deg: number) => {
      const r = (deg * Math.PI) / 180;
      const c = Math.cos(r);
      const s = Math.sin(r);
      return [c * c, c * s, c * s, s * s];
    },
  },
  { name: "singular", label: "Singular", matrix: [1, 2, 0.5, 1] },
];

// ─────────────────────────────────────────────────────────
// Matrix Math (pure functions)
// ─────────────────────────────────────────────────────────

function matMul(a: Mat2, b: Mat2): Mat2 {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
  ];
}

function matVec(m: Mat2, v: Vec2): Vec2 {
  return [m[0] * v[0] + m[1] * v[1], m[2] * v[0] + m[3] * v[1]];
}

function det(m: Mat2): number {
  return m[0] * m[3] - m[1] * m[2];
}

function trace(m: Mat2): number {
  return m[0] + m[3];
}

function lerpMat(from: Mat2, to: Mat2, t: number): Mat2 {
  const s = 1 - t;
  return [
    s * from[0] + t * to[0],
    s * from[1] + t * to[1],
    s * from[2] + t * to[2],
    s * from[3] + t * to[3],
  ];
}

function computeEigen(m: Mat2): EigenResult {
  const tr = trace(m);
  const d = det(m);
  const disc = tr * tr - 4 * d;

  if (disc < -1e-10) {
    return { values: [null, null], vectors: [null, null], isComplex: true };
  }

  const sqrtDisc = Math.sqrt(Math.max(0, disc));
  const lambda1 = (tr + sqrtDisc) / 2;
  const lambda2 = (tr - sqrtDisc) / 2;

  const findEigenvector = (lambda: number): Vec2 | null => {
    const a = m[0] - lambda;
    const b = m[1];
    const c = m[2];
    const dd = m[3] - lambda;

    if (Math.abs(b) > 1e-10) {
      const len = Math.sqrt(b * b + (lambda - m[0]) * (lambda - m[0]));
      return len > 1e-10 ? [b / len, (lambda - m[0]) / len] : null;
    }
    if (Math.abs(a) > 1e-10) {
      return [0, 1];
    }
    if (Math.abs(c) > 1e-10) {
      const len = Math.sqrt((lambda - m[3]) * (lambda - m[3]) + c * c);
      return len > 1e-10 ? [(lambda - dd) / len, c / len] : null;
    }
    return [1, 0];
  };

  return {
    values: [lambda1, lambda2],
    vectors: [findEigenvector(lambda1), findEigenvector(lambda2)],
    isComplex: false,
  };
}

function computeSVD(m: Mat2): { U: Mat2; sigma: Vec2; Vt: Mat2 } | null {
  // M^T M
  const mtm: Mat2 = [
    m[0] * m[0] + m[2] * m[2],
    m[0] * m[1] + m[2] * m[3],
    m[1] * m[0] + m[3] * m[2],
    m[1] * m[1] + m[3] * m[3],
  ];

  const eigen = computeEigen(mtm);
  if (eigen.isComplex || eigen.values[0] === null || eigen.values[1] === null) {
    return null;
  }

  const s1 = Math.sqrt(Math.max(0, eigen.values[0]));
  const s2 = Math.sqrt(Math.max(0, eigen.values[1]));

  if (s1 < 1e-10) return null;

  const v1 = eigen.vectors[0];
  const v2 = eigen.vectors[1];
  if (!v1 || !v2) return null;

  const Vt: Mat2 = [v1[0], v1[1], v2[0], v2[1]];

  const u1 = matVec(m, v1);
  const u1Len = Math.sqrt(u1[0] * u1[0] + u1[1] * u1[1]);

  let U: Mat2;
  if (u1Len > 1e-10) {
    const u1n: Vec2 = [u1[0] / u1Len, u1[1] / u1Len];
    const u2n: Vec2 = [-u1n[1], u1n[0]];
    U = [u1n[0], u2n[0], u1n[1], u2n[1]];
  } else {
    U = [1, 0, 0, 1];
  }

  return { U, sigma: [s1, s2], Vt };
}

// ─────────────────────────────────────────────────────────
// Canvas Drawing (pure functions)
// ─────────────────────────────────────────────────────────

function getCanvasStyles(): {
  gridColor: string;
  axisColor: string;
  textColor: string;
  transformedGridColor: string;
} {
  if (typeof document === "undefined") {
    return {
      gridColor: "rgba(39, 39, 42, 0.6)",
      axisColor: "rgba(228, 228, 231, 0.5)",
      textColor: "rgba(228, 228, 231, 0.7)",
      transformedGridColor: "rgba(79, 143, 247, 0.15)",
    };
  }
  const style = getComputedStyle(document.documentElement);
  const border = style.getPropertyValue("--color-border").trim() || "#27272a";
  const textMuted =
    style.getPropertyValue("--color-text-muted").trim() || "#a1a1aa";
  const primary =
    style.getPropertyValue("--color-primary").trim() || "#4f8ff7";

  return {
    gridColor: border,
    axisColor: textMuted,
    textColor: textMuted,
    transformedGridColor: primary,
  };
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  scale: number,
  colors: ReturnType<typeof getCanvasStyles>
): void {
  const cx = w / 2;
  const cy = h / 2;
  const range = Math.ceil(Math.max(w, h) / (2 * scale)) + 1;

  ctx.strokeStyle = colors.gridColor;
  ctx.lineWidth = 0.5;
  ctx.globalAlpha = 0.4;

  for (let i = -range; i <= range; i++) {
    if (i === 0) continue;
    const x = cx + i * scale;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();

    const y = cy - i * scale;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  scale: number,
  colors: ReturnType<typeof getCanvasStyles>
): void {
  const cx = w / 2;
  const cy = h / 2;

  ctx.strokeStyle = colors.axisColor;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.6;

  ctx.beginPath();
  ctx.moveTo(0, cy);
  ctx.lineTo(w, cy);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, h);
  ctx.stroke();

  ctx.globalAlpha = 0.4;
  ctx.fillStyle = colors.textColor;
  ctx.font = "10px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const range = Math.ceil(Math.max(w, h) / (2 * scale));
  for (let i = -range; i <= range; i++) {
    if (i === 0) continue;
    ctx.fillText(String(i), cx + i * scale, cy + 4);
  }

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = -range; i <= range; i++) {
    if (i === 0) continue;
    ctx.fillText(String(i), cx - 6, cy - i * scale);
  }

  ctx.globalAlpha = 1;
}

function drawTransformedGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  scale: number,
  matrix: Mat2,
  colors: ReturnType<typeof getCanvasStyles>
): void {
  const cx = w / 2;
  const cy = h / 2;
  const range = Math.ceil(Math.max(w, h) / (2 * scale)) + 2;

  ctx.strokeStyle = colors.transformedGridColor;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.2;

  for (let i = -range; i <= range; i++) {
    ctx.beginPath();
    const startV = matVec(matrix, [i, -range]);
    const endV = matVec(matrix, [i, range]);
    ctx.moveTo(cx + startV[0] * scale, cy - startV[1] * scale);
    ctx.lineTo(cx + endV[0] * scale, cy - endV[1] * scale);
    ctx.stroke();

    ctx.beginPath();
    const startH = matVec(matrix, [-range, i]);
    const endH = matVec(matrix, [range, i]);
    ctx.moveTo(cx + startH[0] * scale, cy - startH[1] * scale);
    ctx.lineTo(cx + endH[0] * scale, cy - endH[1] * scale);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  vec: Vec2,
  color: string,
  lineWidth: number,
  dashed: boolean = false,
  label?: string
): void {
  const ex = cx + vec[0] * scale;
  const ey = cy - vec[1] * scale;
  const len = Math.sqrt(
    (ex - cx) * (ex - cx) + (ey - cy) * (ey - cy)
  );

  if (len < 2) return;

  const angle = Math.atan2(ey - cy, ex - cx);
  const headSize = Math.min(12, len * 0.25);

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(dashed ? [6, 4] : []);

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(ex, ey);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(
    ex - headSize * Math.cos(angle - Math.PI / 6),
    ey - headSize * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    ex - headSize * Math.cos(angle + Math.PI / 6),
    ey - headSize * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();

  if (label) {
    const offset = 14;
    const lx = ex + offset * Math.cos(angle);
    const ly = ey + offset * Math.sin(angle);
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, lx, ly);
  }
}

function drawUnitSquare(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  matrix: Mat2,
  determinant: number
): void {
  const corners: Vec2[] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const transformed = corners.map((c) => matVec(matrix, c));

  ctx.beginPath();
  ctx.moveTo(
    cx + transformed[0][0] * scale,
    cy - transformed[0][1] * scale
  );
  for (let i = 1; i < transformed.length; i++) {
    ctx.lineTo(
      cx + transformed[i][0] * scale,
      cy - transformed[i][1] * scale
    );
  }
  ctx.closePath();

  ctx.fillStyle =
    determinant < 0 ? COLORS.detNegative : COLORS.unitSquare;
  ctx.fill();
  ctx.strokeStyle = COLORS.unitSquareStroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawHouseShape(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  matrix: Mat2
): void {
  const house: Vec2[] = [
    [0, 0],
    [1, 0],
    [1, 0.6],
    [0.5, 1],
    [0, 0.6],
  ];
  const transformed = house.map((c) => matVec(matrix, c));

  ctx.beginPath();
  ctx.moveTo(
    cx + transformed[0][0] * scale,
    cy - transformed[0][1] * scale
  );
  for (let i = 1; i < transformed.length; i++) {
    ctx.lineTo(
      cx + transformed[i][0] * scale,
      cy - transformed[i][1] * scale
    );
  }
  ctx.closePath();

  ctx.fillStyle = "rgba(52, 211, 153, 0.08)";
  ctx.fill();
  ctx.strokeStyle = "rgba(52, 211, 153, 0.4)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawEigenvectors(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  eigen: EigenResult
): void {
  if (eigen.isComplex) return;

  const eigenColors = [COLORS.eigen1, COLORS.eigen2];

  for (let i = 0; i < 2; i++) {
    const vec = eigen.vectors[i];
    const val = eigen.values[i];
    if (!vec || val === null) continue;

    const extendedLen = 5;
    const extended: Vec2 = [vec[0] * extendedLen, vec[1] * extendedLen];
    const negExtended: Vec2 = [-vec[0] * extendedLen, -vec[1] * extendedLen];

    ctx.strokeStyle = eigenColors[i];
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(
      cx + negExtended[0] * scale,
      cy - negExtended[1] * scale
    );
    ctx.lineTo(cx + extended[0] * scale, cy - extended[1] * scale);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    drawArrow(
      ctx,
      cx,
      cy,
      scale,
      [vec[0] * 1.5, vec[1] * 1.5],
      eigenColors[i],
      2,
      true,
      `\u03bb=${val.toFixed(2)}`
    );
  }
}

// ─────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────

export default function LinearAlgebra() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [matrixInput, setMatrixInput] = useState<[string, string, string, string]>(["1", "0", "0", "1"]);
  const [currentMatrix, setCurrentMatrix] = useState<Mat2>(IDENTITY);
  const [displayMatrix, setDisplayMatrix] = useState<Mat2>(IDENTITY);
  const [activePreset, setActivePreset] = useState<string>("identity");
  const [sliderValue, setSliderValue] = useState(45);
  const [showGrid, setShowGrid] = useState(true);
  const [showEigen, setShowEigen] = useState(true);
  const [showHouse, setShowHouse] = useState(true);
  const [showSVD, setShowSVD] = useState(false);
  const [svdStep, setSvdStep] = useState<number>(0);
  const [canvasSize, setCanvasSize] = useState({ w: 600, h: 500 });

  const [composition, setComposition] = useState<CompositionEntry[]>([]);
  const [showComposition, setShowComposition] = useState(false);

  const animRef = useRef<{
    from: Mat2;
    to: Mat2;
    start: number;
    active: boolean;
  }>({ from: IDENTITY, to: IDENTITY, start: 0, active: false });
  const rafRef = useRef<number>(0);

  const scaleRef = useRef(80);

  const activePresetDef = PRESETS.find((p) => p.name === activePreset);

  // ─────────────────────────────────────────────
  // Resize handling
  // ─────────────────────────────────────────────

  useEffect(() => {
    const updateSize = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const w = Math.floor(rect.width);
      const h = Math.min(Math.max(380, Math.floor(w * 0.7)), 600);
      setCanvasSize({ w, h });
      scaleRef.current = Math.min(w, h) / 8;
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // ─────────────────────────────────────────────
  // Animation loop
  // ─────────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w, h } = canvasSize;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const scale = scaleRef.current;
    const colors = getCanvasStyles();

    ctx.clearRect(0, 0, w, h);

    let mat = displayMatrix;

    if (showSVD) {
      const svd = computeSVD(currentMatrix);
      if (svd) {
        const t = svdStep / 3;
        if (t <= 1 / 3) {
          const p = t * 3;
          mat = lerpMat(IDENTITY, svd.Vt, p);
        } else if (t <= 2 / 3) {
          const p = (t - 1 / 3) * 3;
          const sigmaM: Mat2 = [
            1 + p * (svd.sigma[0] - 1),
            0,
            0,
            1 + p * (svd.sigma[1] - 1),
          ];
          mat = matMul(sigmaM, svd.Vt);
        } else {
          const p = (t - 2 / 3) * 3;
          const sigmaM: Mat2 = [svd.sigma[0], 0, 0, svd.sigma[1]];
          const sv = matMul(sigmaM, svd.Vt);
          mat = lerpMat(sv, matMul(svd.U, sv), p);
        }
      }
    }

    // Background grid
    drawGrid(ctx, w, h, scale, colors);
    drawAxes(ctx, w, h, scale, colors);

    // Transformed grid
    if (showGrid) {
      drawTransformedGrid(ctx, w, h, scale, mat, colors);
    }

    const cx = w / 2;
    const cy = h / 2;
    const d = det(mat);

    // Unit square
    drawUnitSquare(ctx, cx, cy, scale, mat, d);

    // House shape
    if (showHouse) {
      drawHouseShape(ctx, cx, cy, scale, mat);
    }

    // Original basis vectors (faded)
    drawArrow(ctx, cx, cy, scale, [1, 0], COLORS.iHatLight, 1.5, false);
    drawArrow(ctx, cx, cy, scale, [0, 1], COLORS.jHatLight, 1.5, false);

    // Transformed basis vectors
    const ti = matVec(mat, [1, 0]);
    const tj = matVec(mat, [0, 1]);
    drawArrow(ctx, cx, cy, scale, ti, COLORS.iHat, 3, false, "i\u0302");
    drawArrow(ctx, cx, cy, scale, tj, COLORS.jHat, 3, false, "j\u0302");

    // Eigenvectors
    if (showEigen && !showSVD) {
      const eigen = computeEigen(mat);
      drawEigenvectors(ctx, cx, cy, scale, eigen);
    }

    // Determinant label on canvas
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = colors.textColor;
    ctx.globalAlpha = 0.7;
    ctx.fillText(`det = ${d.toFixed(3)}`, 10, 10);
    if (d < 0) {
      ctx.fillStyle = "#ef4444";
      ctx.fillText("(orientation flipped)", 10, 26);
    }
    ctx.globalAlpha = 1;
  }, [
    canvasSize,
    displayMatrix,
    currentMatrix,
    showGrid,
    showEigen,
    showHouse,
    showSVD,
    svdStep,
  ]);

  // ─────────────────────────────────────────────
  // Render loop with animation
  // ─────────────────────────────────────────────

  useEffect(() => {
    let running = true;

    const tick = (now: number) => {
      if (!running) return;

      const anim = animRef.current;
      if (anim.active) {
        const elapsed = now - anim.start;
        const t = Math.min(elapsed / ANIMATION_DURATION, 1);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const interpolated = lerpMat(anim.from, anim.to, eased);
        setDisplayMatrix(interpolated);
        if (t >= 1) {
          anim.active = false;
          setDisplayMatrix(anim.to);
        }
      }

      draw();
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [draw]);

  // ─────────────────────────────────────────────
  // Matrix transition
  // ─────────────────────────────────────────────

  const animateTo = useCallback(
    (target: Mat2) => {
      animRef.current = {
        from: displayMatrix,
        to: target,
        start: performance.now(),
        active: true,
      };
      setCurrentMatrix(target);
    },
    [displayMatrix]
  );

  // ─────────────────────────────────────────────
  // Input handlers
  // ─────────────────────────────────────────────

  const handleMatrixInput = useCallback(
    (index: number, value: string) => {
      const next = [...matrixInput] as [string, string, string, string];
      next[index] = value;
      setMatrixInput(next);
      setActivePreset("");

      const nums = next.map((s) => parseFloat(s));
      if (nums.every((n) => !isNaN(n) && isFinite(n))) {
        const mat: Mat2 = [nums[0], nums[1], nums[2], nums[3]];
        animateTo(mat);
      }
    },
    [matrixInput, animateTo]
  );

  const applyPreset = useCallback(
    (preset: Preset, sliderVal?: number) => {
      setActivePreset(preset.name);
      setShowSVD(false);

      let mat: Mat2;
      if (preset.matrixFromSlider && sliderVal !== undefined) {
        mat = preset.matrixFromSlider(sliderVal);
      } else if (preset.matrixFromSlider && preset.sliderDefault !== undefined) {
        mat = preset.matrixFromSlider(preset.sliderDefault);
        setSliderValue(preset.sliderDefault);
      } else {
        mat = preset.matrix;
      }

      setMatrixInput([
        mat[0].toFixed(3),
        mat[1].toFixed(3),
        mat[2].toFixed(3),
        mat[3].toFixed(3),
      ]);
      animateTo(mat);
    },
    [animateTo]
  );

  const handleSlider = useCallback(
    (val: number) => {
      setSliderValue(val);
      if (activePresetDef?.matrixFromSlider) {
        const mat = activePresetDef.matrixFromSlider(val);
        setMatrixInput([
          mat[0].toFixed(3),
          mat[1].toFixed(3),
          mat[2].toFixed(3),
          mat[3].toFixed(3),
        ]);
        animateTo(mat);
      }
    },
    [activePresetDef, animateTo]
  );

  const addToComposition = useCallback(() => {
    const name =
      activePresetDef?.label || `Custom [${currentMatrix.map((v) => v.toFixed(1)).join(",")}]`;
    setComposition((prev) => [...prev, { name, matrix: [...currentMatrix] as Mat2 }]);
  }, [currentMatrix, activePresetDef]);

  const applyComposition = useCallback(() => {
    if (composition.length === 0) return;
    const result = composition.reduce<Mat2>(
      (acc, entry) => matMul(entry.matrix, acc),
      IDENTITY
    );
    setMatrixInput([
      result[0].toFixed(3),
      result[1].toFixed(3),
      result[2].toFixed(3),
      result[3].toFixed(3),
    ]);
    setActivePreset("");
    animateTo(result);
  }, [composition, animateTo]);

  // ─────────────────────────────────────────────
  // Eigenvalue display
  // ─────────────────────────────────────────────

  const eigen = computeEigen(currentMatrix);
  const determinant = det(currentMatrix);
  const traceVal = trace(currentMatrix);

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────

  return (
    <div
      class="rounded-xl border p-4 sm:p-6"
      style="border-color: var(--color-border); background: var(--color-surface)"
    >
      <div class="flex flex-col lg:flex-row gap-4 lg:gap-6">
        {/* Canvas */}
        <div class="flex-1 min-w-0" ref={containerRef}>
          <canvas
            ref={canvasRef}
            style={{
              width: `${canvasSize.w}px`,
              height: `${canvasSize.h}px`,
              borderRadius: "8px",
              border: "1px solid var(--color-border)",
              background: "var(--color-bg)",
            }}
          />
          {/* Legend */}
          <div
            class="mt-2 flex flex-wrap gap-4 text-xs"
            style="color: var(--color-text-muted)"
          >
            <span>
              <span style={{ color: COLORS.iHat }}>{"\u2588"}</span> i-hat (1,0)
            </span>
            <span>
              <span style={{ color: COLORS.jHat }}>{"\u2588"}</span> j-hat (0,1)
            </span>
            {showEigen && !eigen.isComplex && (
              <>
                <span>
                  <span style={{ color: COLORS.eigen1 }}>{"\u2588"}</span> eigen 1
                </span>
                <span>
                  <span style={{ color: COLORS.eigen2 }}>{"\u2588"}</span> eigen 2
                </span>
              </>
            )}
          </div>
        </div>

        {/* Controls panel */}
        <div class="w-full lg:w-72 flex-shrink-0 space-y-5">
          {/* Matrix input */}
          <div>
            <label
              class="block text-xs font-bold uppercase tracking-wider mb-2"
              style="color: var(--color-text-muted)"
            >
              Matrix
            </label>
            <div class="grid grid-cols-2 gap-2">
              {[0, 1, 2, 3].map((i) => (
                <input
                  key={i}
                  type="text"
                  inputMode="decimal"
                  value={matrixInput[i]}
                  onInput={(e) =>
                    handleMatrixInput(i, (e.target as HTMLInputElement).value)
                  }
                  class="rounded-md border px-3 py-2 text-center font-mono text-sm w-full"
                  style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)"
                />
              ))}
            </div>
            <div
              class="mt-2 flex justify-between text-xs font-mono"
              style="color: var(--color-text-muted)"
            >
              <span>
                det ={" "}
                <span
                  style={{
                    color:
                      Math.abs(determinant) < 0.001
                        ? "#ef4444"
                        : determinant < 0
                          ? "#f59e0b"
                          : "var(--color-accent)",
                  }}
                >
                  {determinant.toFixed(3)}
                </span>
              </span>
              <span>tr = {traceVal.toFixed(3)}</span>
            </div>
            <div
              class="mt-1 text-xs"
              style="color: var(--color-text-muted)"
            >
              {Math.abs(determinant) < 0.001
                ? "Singular (collapses space)"
                : determinant < 0
                  ? `Area scale: ${Math.abs(determinant).toFixed(3)} (flipped)`
                  : `Area scale: ${determinant.toFixed(3)}`}
            </div>
          </div>

          {/* Presets */}
          <div>
            <label
              class="block text-xs font-bold uppercase tracking-wider mb-2"
              style="color: var(--color-text-muted)"
            >
              Presets
            </label>
            <div class="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => applyPreset(p)}
                  class="rounded-md border px-2 py-1 text-xs font-mono transition-colors"
                  style={{
                    borderColor:
                      activePreset === p.name
                        ? "var(--color-primary)"
                        : "var(--color-border)",
                    background:
                      activePreset === p.name
                        ? "color-mix(in srgb, var(--color-primary) 15%, transparent)"
                        : "var(--color-bg)",
                    color:
                      activePreset === p.name
                        ? "var(--color-primary)"
                        : "var(--color-text-muted)",
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Slider */}
          {activePresetDef?.hasSlider && (
            <div>
              <label
                class="block text-xs font-bold uppercase tracking-wider mb-1"
                style="color: var(--color-text-muted)"
              >
                {activePresetDef.sliderLabel}: {sliderValue.toFixed(1)}
              </label>
              <input
                type="range"
                min={activePresetDef.sliderRange?.[0] ?? 0}
                max={activePresetDef.sliderRange?.[1] ?? 100}
                step={0.1}
                value={sliderValue}
                onInput={(e) =>
                  handleSlider(
                    parseFloat((e.target as HTMLInputElement).value)
                  )
                }
                class="w-full accent-[var(--color-primary)]"
              />
            </div>
          )}

          {/* Eigenvalues */}
          <div>
            <label
              class="block text-xs font-bold uppercase tracking-wider mb-2"
              style="color: var(--color-text-muted)"
            >
              Eigenvalues
            </label>
            {eigen.isComplex ? (
              <div class="text-xs font-mono" style="color: var(--color-text-muted)">
                Complex eigenvalues (rotation)
              </div>
            ) : (
              <div class="space-y-1">
                {[0, 1].map((i) => (
                  <div key={i} class="flex items-center gap-2 text-xs font-mono">
                    <span
                      style={{
                        color: i === 0 ? COLORS.eigen1 : COLORS.eigen2,
                      }}
                    >
                      {"\u25cf"}
                    </span>
                    <span style="color: var(--color-text)">
                      {"\u03bb"}
                      {i + 1} = {eigen.values[i]?.toFixed(3) ?? "N/A"}
                    </span>
                    {eigen.vectors[i] && (
                      <span style="color: var(--color-text-muted)">
                        ({eigen.vectors[i]![0].toFixed(2)},{" "}
                        {eigen.vectors[i]![1].toFixed(2)})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Display toggles */}
          <div class="space-y-2">
            <label
              class="block text-xs font-bold uppercase tracking-wider mb-1"
              style="color: var(--color-text-muted)"
            >
              Display
            </label>
            {[
              { label: "Transformed grid", value: showGrid, set: setShowGrid },
              { label: "Eigenvectors", value: showEigen, set: setShowEigen },
              { label: "House shape", value: showHouse, set: setShowHouse },
            ].map(({ label, value, set }) => (
              <label
                key={label}
                class="flex items-center gap-2 text-xs cursor-pointer"
                style="color: var(--color-text)"
              >
                <input
                  type="checkbox"
                  checked={value}
                  onChange={() => set(!value)}
                  class="accent-[var(--color-primary)]"
                />
                {label}
              </label>
            ))}
          </div>

          {/* SVD */}
          <div>
            <label
              class="block text-xs font-bold uppercase tracking-wider mb-2"
              style="color: var(--color-text-muted)"
            >
              SVD Decomposition
            </label>
            <div class="flex items-center gap-2 mb-2">
              <label
                class="flex items-center gap-2 text-xs cursor-pointer"
                style="color: var(--color-text)"
              >
                <input
                  type="checkbox"
                  checked={showSVD}
                  onChange={() => {
                    setShowSVD(!showSVD);
                    setSvdStep(0);
                  }}
                  class="accent-[var(--color-primary)]"
                />
                Show SVD steps
              </label>
            </div>
            {showSVD && (
              <div>
                <input
                  type="range"
                  min={0}
                  max={3}
                  step={0.02}
                  value={svdStep}
                  onInput={(e) =>
                    setSvdStep(
                      parseFloat((e.target as HTMLInputElement).value)
                    )
                  }
                  class="w-full accent-[var(--color-primary)]"
                />
                <div
                  class="flex justify-between text-xs mt-1"
                  style="color: var(--color-text-muted)"
                >
                  <span style={{ fontWeight: svdStep < 1 ? "bold" : "normal" }}>
                    V{"\u1d40"}
                  </span>
                  <span
                    style={{
                      fontWeight: svdStep >= 1 && svdStep < 2 ? "bold" : "normal",
                    }}
                  >
                    {"\u03a3"}
                  </span>
                  <span style={{ fontWeight: svdStep >= 2 ? "bold" : "normal" }}>
                    U
                  </span>
                </div>
                <div
                  class="text-xs mt-1 font-mono"
                  style="color: var(--color-text-muted)"
                >
                  M = U{"\u03a3"}V{"\u1d40"} ({svdStep < 1
                    ? "Rotate (V\u1d40)"
                    : svdStep < 2
                      ? "Scale (\u03a3)"
                      : "Rotate (U)"})
                </div>
              </div>
            )}
          </div>

          {/* Composition */}
          <div>
            <label
              class="block text-xs font-bold uppercase tracking-wider mb-2"
              style="color: var(--color-text-muted)"
            >
              Composition
            </label>
            <div class="flex gap-2 mb-2">
              <button
                onClick={addToComposition}
                class="rounded-md border px-3 py-1.5 text-xs font-mono transition-colors hover:border-[var(--color-primary)]"
                style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)"
              >
                + Add current
              </button>
              {composition.length > 0 && (
                <>
                  <button
                    onClick={applyComposition}
                    class="rounded-md border px-3 py-1.5 text-xs font-mono transition-colors"
                    style="background: color-mix(in srgb, var(--color-primary) 15%, transparent); border-color: var(--color-primary); color: var(--color-primary)"
                  >
                    Apply
                  </button>
                  <button
                    onClick={() => setComposition([])}
                    class="rounded-md border px-3 py-1.5 text-xs font-mono transition-colors"
                    style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text-muted)"
                  >
                    Clear
                  </button>
                </>
              )}
            </div>
            {composition.length > 0 && (
              <div class="space-y-1">
                {composition.map((entry, idx) => (
                  <div
                    key={idx}
                    class="flex items-center gap-2 text-xs font-mono rounded-md px-2 py-1"
                    style="background: var(--color-bg); color: var(--color-text-muted)"
                  >
                    <span style="color: var(--color-text)">{idx + 1}.</span>
                    <span>{entry.name}</span>
                    <span style="color: var(--color-border)">
                      [{entry.matrix.map((v) => v.toFixed(1)).join(", ")}]
                    </span>
                    <button
                      onClick={() =>
                        setComposition((prev) =>
                          prev.filter((_, i) => i !== idx)
                        )
                      }
                      style="color: var(--color-text-muted)"
                      class="ml-auto hover:text-[var(--color-primary)] text-xs"
                    >
                      {"\u00d7"}
                    </button>
                  </div>
                ))}
                {composition.length >= 2 && (
                  <div
                    class="text-xs font-mono mt-1 pt-1"
                    style="color: var(--color-text-muted); border-top: 1px solid var(--color-border)"
                  >
                    Result: [
                    {composition
                      .reduce<Mat2>(
                        (acc, entry) => matMul(entry.matrix, acc),
                        IDENTITY
                      )
                      .map((v) => v.toFixed(2))
                      .join(", ")}
                    ]
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
