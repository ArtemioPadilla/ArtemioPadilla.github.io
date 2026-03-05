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

type VisualizationMode = "curve" | "interactive";

interface LossFunctionDef {
  id: string;
  name: string;
  color: string;
  /** Compute loss given true value y and predicted value yHat */
  fn: (y: number, yHat: number, params: LossParams) => number;
  /** Compute gradient dL/dYhat */
  gradient: (y: number, yHat: number, params: LossParams) => number;
  symmetric: boolean;
  robustToOutliers: boolean;
  differentiableEverywhere: boolean;
  useCase: "regression" | "classification";
  gradientBehavior: string;
  /** Domain type: "regression" supports full range, "binary" requires yHat in (0,1) */
  domain: "regression" | "binary" | "hinge";
}

interface LossParams {
  huberDelta: number;
  focalAlpha: number;
  focalGamma: number;
}

interface DataPoint {
  x: number;
  yTrue: number;
  yPred: number;
}

// ─────────────────────────────────────────────────────────
// Numeric Safety
// ─────────────────────────────────────────────────────────

const EPSILON = 1e-15;

function safeLog(v: number): number {
  return Math.log(Math.max(v, EPSILON));
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function safeDivide(num: number, den: number): number {
  if (Math.abs(den) < EPSILON) return num >= 0 ? 1e6 : -1e6;
  return num / den;
}

// ─────────────────────────────────────────────────────────
// Loss Function Definitions
// ─────────────────────────────────────────────────────────

const LOSS_FUNCTIONS: LossFunctionDef[] = [
  {
    id: "mse",
    name: "MSE",
    color: "#4f8ff7",
    fn: (y, yHat) => (y - yHat) ** 2,
    gradient: (y, yHat) => -2 * (y - yHat),
    symmetric: true,
    robustToOutliers: false,
    differentiableEverywhere: true,
    useCase: "regression",
    gradientBehavior: "Linear (grows with error)",
    domain: "regression",
  },
  {
    id: "mae",
    name: "MAE",
    color: "#34d399",
    fn: (y, yHat) => Math.abs(y - yHat),
    gradient: (y, yHat) => {
      const diff = yHat - y;
      if (Math.abs(diff) < EPSILON) return 0;
      return diff > 0 ? 1 : -1;
    },
    symmetric: true,
    robustToOutliers: true,
    differentiableEverywhere: false,
    useCase: "regression",
    gradientBehavior: "Constant (always +/-1)",
    domain: "regression",
  },
  {
    id: "huber",
    name: "Huber",
    color: "#f59e0b",
    fn: (y, yHat, params) => {
      const a = Math.abs(y - yHat);
      const d = params.huberDelta;
      return a <= d ? 0.5 * a * a : d * (a - 0.5 * d);
    },
    gradient: (y, yHat, params) => {
      const diff = yHat - y;
      const a = Math.abs(diff);
      const d = params.huberDelta;
      if (a <= d) return diff;
      return diff > 0 ? d : -d;
    },
    symmetric: true,
    robustToOutliers: true,
    differentiableEverywhere: true,
    useCase: "regression",
    gradientBehavior: "Linear near 0, constant for large errors",
    domain: "regression",
  },
  {
    id: "bce",
    name: "Binary CE",
    color: "#ef4444",
    fn: (y, yHat) => {
      const p = clamp(yHat, EPSILON, 1 - EPSILON);
      return -(y * safeLog(p) + (1 - y) * safeLog(1 - p));
    },
    gradient: (y, yHat) => {
      const p = clamp(yHat, EPSILON, 1 - EPSILON);
      return safeDivide(-y, p) + safeDivide(1 - y, 1 - p);
    },
    symmetric: false,
    robustToOutliers: false,
    differentiableEverywhere: true,
    useCase: "classification",
    gradientBehavior: "Varies (steep near 0 and 1)",
    domain: "binary",
  },
  {
    id: "cce",
    name: "Categorical CE",
    color: "#a855f7",
    fn: (y, yHat) => {
      // Single-class: -y * log(yHat) for the true class
      const p = clamp(yHat, EPSILON, 1 - EPSILON);
      return -y * safeLog(p);
    },
    gradient: (y, yHat) => {
      const p = clamp(yHat, EPSILON, 1 - EPSILON);
      return safeDivide(-y, p);
    },
    symmetric: false,
    robustToOutliers: false,
    differentiableEverywhere: true,
    useCase: "classification",
    gradientBehavior: "Varies (steep near 0)",
    domain: "binary",
  },
  {
    id: "hinge",
    name: "Hinge",
    color: "#ec4899",
    fn: (y, yHat) => {
      // y should be +1 or -1. For visualization, map y from {0,1} to {-1,+1}
      const yMapped = y > 0.5 ? 1 : -1;
      return Math.max(0, 1 - yMapped * yHat);
    },
    gradient: (y, yHat) => {
      const yMapped = y > 0.5 ? 1 : -1;
      return yMapped * yHat < 1 ? -yMapped : 0;
    },
    symmetric: false,
    robustToOutliers: false,
    differentiableEverywhere: false,
    useCase: "classification",
    gradientBehavior: "Constant when active, zero otherwise",
    domain: "hinge",
  },
  {
    id: "focal",
    name: "Focal",
    color: "#14b8a6",
    fn: (y, yHat, params) => {
      const p = clamp(yHat, EPSILON, 1 - EPSILON);
      const pt = y > 0.5 ? p : 1 - p;
      return -params.focalAlpha * Math.pow(1 - pt, params.focalGamma) * safeLog(pt);
    },
    gradient: (y, yHat, params) => {
      const p = clamp(yHat, EPSILON, 1 - EPSILON);
      const pt = y > 0.5 ? p : 1 - p;
      const sign = y > 0.5 ? 1 : -1;
      const { focalAlpha: alpha, focalGamma: gamma } = params;
      // d/dp [-alpha * (1-pt)^gamma * log(pt)] via chain rule
      const term1 = gamma * Math.pow(1 - pt, gamma - 1) * safeLog(pt);
      const term2 = -Math.pow(1 - pt, gamma) * safeDivide(1, pt);
      return -alpha * (term1 + term2) * sign;
    },
    symmetric: false,
    robustToOutliers: true,
    differentiableEverywhere: true,
    useCase: "classification",
    gradientBehavior: "Down-weights easy examples",
    domain: "binary",
  },
  {
    id: "logcosh",
    name: "Log-Cosh",
    color: "#f97316",
    fn: (y, yHat) => {
      const diff = y - yHat;
      // log(cosh(x)) = |x| + log(1 + e^(-2|x|)) - log(2) for stability
      const absDiff = Math.abs(diff);
      if (absDiff > 20) return absDiff - Math.LN2; // numerical stability
      return Math.log(Math.cosh(diff));
    },
    gradient: (y, yHat) => {
      const diff = yHat - y;
      return Math.tanh(diff);
    },
    symmetric: true,
    robustToOutliers: true,
    differentiableEverywhere: true,
    useCase: "regression",
    gradientBehavior: "Smooth (tanh transition)",
    domain: "regression",
  },
];

// ─────────────────────────────────────────────────────────
// Default Data Points for Interactive Mode
// ─────────────────────────────────────────────────────────

const DEFAULT_DATA_POINTS: DataPoint[] = [
  { x: 0.5, yTrue: 2.0, yPred: 2.3 },
  { x: 1.0, yTrue: 3.1, yPred: 2.8 },
  { x: 1.5, yTrue: 1.5, yPred: 1.8 },
  { x: 2.0, yTrue: 4.2, yPred: 3.5 },
  { x: 2.5, yTrue: 2.8, yPred: 3.2 },
  { x: 3.0, yTrue: 5.0, yPred: 4.0 },
  { x: 3.5, yTrue: 1.0, yPred: 2.5 },
];

// Defaults for classification mode
const DEFAULT_CLASSIFICATION_POINTS: DataPoint[] = [
  { x: 0.5, yTrue: 1, yPred: 0.8 },
  { x: 1.0, yTrue: 0, yPred: 0.3 },
  { x: 1.5, yTrue: 1, yPred: 0.6 },
  { x: 2.0, yTrue: 0, yPred: 0.1 },
  { x: 2.5, yTrue: 1, yPred: 0.9 },
  { x: 3.0, yTrue: 0, yPred: 0.7 },
  { x: 3.5, yTrue: 1, yPred: 0.4 },
];

const DEFAULT_ACTIVE_LOSSES = ["mse", "mae", "huber"];

// ─────────────────────────────────────────────────────────
// Canvas Drawing Helpers
// ─────────────────────────────────────────────────────────

function getTextColor(): string {
  if (typeof document === "undefined") return "#e4e4e7";
  return document.documentElement.classList.contains("light")
    ? "#3f3f46"
    : "#e4e4e7";
}

function getMutedColor(): string {
  if (typeof document === "undefined") return "#a1a1aa";
  return document.documentElement.classList.contains("light")
    ? "#71717a"
    : "#a1a1aa";
}

function getGridColor(): string {
  if (typeof document === "undefined") return "rgba(255,255,255,0.06)";
  return document.documentElement.classList.contains("light")
    ? "rgba(0,0,0,0.06)"
    : "rgba(255,255,255,0.06)";
}

function getAxisColor(): string {
  if (typeof document === "undefined") return "rgba(255,255,255,0.2)";
  return document.documentElement.classList.contains("light")
    ? "rgba(0,0,0,0.2)"
    : "rgba(255,255,255,0.2)";
}

function getCrosshairColor(): string {
  if (typeof document === "undefined") return "rgba(255,255,255,0.3)";
  return document.documentElement.classList.contains("light")
    ? "rgba(0,0,0,0.3)"
    : "rgba(255,255,255,0.3)";
}

function getSurfaceColor(): string {
  if (typeof document === "undefined") return "#111111";
  return document.documentElement.classList.contains("light")
    ? "#ffffff"
    : "#111111";
}

// ─────────────────────────────────────────────────────────
// Curve-Mode Rendering
// ─────────────────────────────────────────────────────────

interface CurvePlotConfig {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  padding: { top: number; right: number; bottom: number; left: number };
}

function createCurvePlotConfig(
  activeLosses: LossFunctionDef[],
  trueValue: number,
  showGradients: boolean,
  params: LossParams
): CurvePlotConfig {
  const xMin = -2;
  const xMax = 3;
  const padding = { top: 20, right: 20, bottom: 40, left: 55 };

  // Compute y range from active losses
  let yMin = 0;
  let yMax = 2;
  const sampleCount = 200;

  for (const loss of activeLosses) {
    for (let i = 0; i <= sampleCount; i++) {
      const yHat = xMin + (i / sampleCount) * (xMax - xMin);
      const yHatClamped =
        loss.domain === "binary" ? clamp(yHat, 0.001, 0.999) : yHat;
      const val = showGradients
        ? loss.gradient(trueValue, yHatClamped, params)
        : loss.fn(trueValue, yHatClamped, params);
      if (Number.isFinite(val)) {
        yMax = Math.max(yMax, val);
        yMin = Math.min(yMin, val);
      }
    }
  }

  // Add padding to y range
  const yRange = yMax - yMin;
  yMax += yRange * 0.1;
  yMin -= yRange * 0.1;

  // Cap for readability
  yMax = Math.min(yMax, 15);
  yMin = Math.max(yMin, showGradients ? -15 : -1);

  return { xMin, xMax, yMin, yMax, padding };
}

function drawCurveMode(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  activeLosses: LossFunctionDef[],
  trueValue: number,
  showGradients: boolean,
  params: LossParams,
  dragX: number | null,
  hoverX: number | null,
  hoverY: number | null
): void {
  const config = createCurvePlotConfig(activeLosses, trueValue, showGradients, params);
  const { xMin, xMax, yMin, yMax, padding } = config;

  const plotW = w - padding.left - padding.right;
  const plotH = h - padding.top - padding.bottom;

  const toCanvasX = (x: number) =>
    padding.left + ((x - xMin) / (xMax - xMin)) * plotW;
  const toCanvasY = (y: number) =>
    padding.top + ((yMax - y) / (yMax - yMin)) * plotH;

  // Clear
  ctx.fillStyle = getSurfaceColor();
  ctx.fillRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = getGridColor();
  ctx.lineWidth = 1;

  const xStep = computeNiceStep(xMin, xMax, 8);
  const yStep = computeNiceStep(yMin, yMax, 6);

  ctx.font = "11px system-ui, sans-serif";
  ctx.fillStyle = getMutedColor();

  // Vertical grid
  for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax; x += xStep) {
    const cx = toCanvasX(x);
    ctx.beginPath();
    ctx.moveTo(cx, padding.top);
    ctx.lineTo(cx, h - padding.bottom);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillText(formatTickLabel(x), cx, h - padding.bottom + 16);
  }

  // Horizontal grid
  for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax; y += yStep) {
    const cy = toCanvasY(y);
    ctx.beginPath();
    ctx.moveTo(padding.left, cy);
    ctx.lineTo(w - padding.right, cy);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(formatTickLabel(y), padding.left - 8, cy + 4);
  }

  // Zero axis
  if (yMin <= 0 && yMax >= 0) {
    ctx.strokeStyle = getAxisColor();
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const zeroY = toCanvasY(0);
    ctx.moveTo(padding.left, zeroY);
    ctx.lineTo(w - padding.right, zeroY);
    ctx.stroke();
  }

  // Mark true value with a vertical dashed line
  ctx.strokeStyle = getAxisColor();
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  const trueX = toCanvasX(trueValue);
  ctx.beginPath();
  ctx.moveTo(trueX, padding.top);
  ctx.lineTo(trueX, h - padding.bottom);
  ctx.stroke();
  ctx.setLineDash([]);

  // Label for true value
  ctx.fillStyle = getMutedColor();
  ctx.textAlign = "center";
  ctx.font = "10px system-ui, sans-serif";
  ctx.fillText(`y=${trueValue}`, trueX, padding.top - 6);

  // Axis labels
  ctx.fillStyle = getMutedColor();
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Predicted (y\u0302)", padding.left + plotW / 2, h - 4);

  ctx.save();
  ctx.translate(14, padding.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText(showGradients ? "Gradient (dL/dy\u0302)" : "Loss", 0, 0);
  ctx.restore();

  // Plot each loss function
  const sampleCount = Math.max(400, plotW * 2);
  for (const loss of activeLosses) {
    ctx.strokeStyle = loss.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;

    for (let i = 0; i <= sampleCount; i++) {
      const xVal = xMin + (i / sampleCount) * (xMax - xMin);
      let yHatInput = xVal;
      if (loss.domain === "binary") {
        yHatInput = clamp(xVal, 0.001, 0.999);
        // Skip rendering outside [0, 1] for binary losses
        if (xVal < -0.05 || xVal > 1.05) {
          started = false;
          continue;
        }
      }
      if (loss.domain === "hinge") {
        // Hinge uses full range
        yHatInput = xVal;
      }

      const val = showGradients
        ? loss.gradient(trueValue, yHatInput, params)
        : loss.fn(trueValue, yHatInput, params);

      if (!Number.isFinite(val) || val > yMax + 5 || val < yMin - 5) {
        started = false;
        continue;
      }

      const cx = toCanvasX(xVal);
      const cy = toCanvasY(clamp(val, yMin - 1, yMax + 1));

      if (!started) {
        ctx.moveTo(cx, cy);
        started = true;
      } else {
        ctx.lineTo(cx, cy);
      }
    }
    ctx.stroke();
  }

  // Draggable vertical line
  if (dragX !== null) {
    const dragCanvasX = toCanvasX(dragX);

    ctx.strokeStyle = getCrosshairColor();
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(dragCanvasX, padding.top);
    ctx.lineTo(dragCanvasX, h - padding.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    // Show values for each active loss at dragX
    let tooltipY = padding.top + 16;
    for (const loss of activeLosses) {
      let yHatInput = dragX;
      if (loss.domain === "binary") yHatInput = clamp(dragX, 0.001, 0.999);

      const val = showGradients
        ? loss.gradient(trueValue, yHatInput, params)
        : loss.fn(trueValue, yHatInput, params);

      if (!Number.isFinite(val)) continue;

      const valY = toCanvasY(clamp(val, yMin, yMax));

      // Dot on curve
      ctx.beginPath();
      ctx.arc(dragCanvasX, valY, 4, 0, Math.PI * 2);
      ctx.fillStyle = loss.color;
      ctx.fill();
      ctx.strokeStyle = getSurfaceColor();
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Text label
      ctx.fillStyle = loss.color;
      ctx.font = "bold 10px system-ui, sans-serif";
      ctx.textAlign = "left";
      const labelX = dragCanvasX + 10;
      ctx.fillText(`${loss.name}: ${formatValue(val)}`, labelX, tooltipY);
      tooltipY += 14;
    }
  }

  // Hover crosshair
  if (hoverX !== null && hoverY !== null && dragX === null) {
    const hoverCanvasX = hoverX;
    const hoverCanvasY = hoverY;

    ctx.strokeStyle = getCrosshairColor();
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(hoverCanvasX, padding.top);
    ctx.lineTo(hoverCanvasX, h - padding.bottom);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(padding.left, hoverCanvasY);
    ctx.lineTo(w - padding.right, hoverCanvasY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Show x value in plot coords
    const plotX = xMin + ((hoverCanvasX - padding.left) / plotW) * (xMax - xMin);
    ctx.fillStyle = getMutedColor();
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`y\u0302=${plotX.toFixed(2)}`, hoverCanvasX, h - padding.bottom + 30);
  }
}

// ─────────────────────────────────────────────────────────
// Interactive-Mode Rendering
// ─────────────────────────────────────────────────────────

function drawInteractiveMode(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  dataPoints: DataPoint[],
  activeLosses: LossFunctionDef[],
  params: LossParams,
  showGradients: boolean,
  dragIndex: number | null
): void {
  // Split canvas: left 60% for scatter, right 40% for bar chart
  const scatterW = Math.floor(w * 0.58);
  const barW = w - scatterW;
  const padding = { top: 30, right: 15, bottom: 40, left: 50 };

  ctx.fillStyle = getSurfaceColor();
  ctx.fillRect(0, 0, w, h);

  // Determine data ranges
  const allYValues = dataPoints.flatMap((p) => [p.yTrue, p.yPred]);
  let yMin = Math.min(...allYValues) - 0.5;
  let yMax = Math.max(...allYValues) + 0.5;
  yMin = Math.floor(yMin);
  yMax = Math.ceil(yMax);

  const xMinData = Math.min(...dataPoints.map((p) => p.x)) - 0.3;
  const xMaxData = Math.max(...dataPoints.map((p) => p.x)) + 0.3;

  const scatterPlotW = scatterW - padding.left - padding.right;
  const scatterPlotH = h - padding.top - padding.bottom;

  const toSX = (x: number) =>
    padding.left + ((x - xMinData) / (xMaxData - xMinData)) * scatterPlotW;
  const toSY = (y: number) =>
    padding.top + ((yMax - y) / (yMax - yMin)) * scatterPlotH;

  // Draw scatter grid
  ctx.strokeStyle = getGridColor();
  ctx.lineWidth = 1;
  const xStep = computeNiceStep(xMinData, xMaxData, 6);
  const yStep = computeNiceStep(yMin, yMax, 6);

  ctx.font = "10px system-ui, sans-serif";
  ctx.fillStyle = getMutedColor();

  for (let x = Math.ceil(xMinData / xStep) * xStep; x <= xMaxData; x += xStep) {
    const cx = toSX(x);
    ctx.beginPath();
    ctx.moveTo(cx, padding.top);
    ctx.lineTo(cx, h - padding.bottom);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillText(formatTickLabel(x), cx, h - padding.bottom + 14);
  }

  for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax; y += yStep) {
    const cy = toSY(y);
    ctx.beginPath();
    ctx.moveTo(padding.left, cy);
    ctx.lineTo(scatterW - padding.right, cy);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(formatTickLabel(y), padding.left - 6, cy + 4);
  }

  // Axis labels
  ctx.fillStyle = getMutedColor();
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("x", padding.left + scatterPlotW / 2, h - 4);

  ctx.save();
  ctx.translate(12, padding.top + scatterPlotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText("Value", 0, 0);
  ctx.restore();

  // Draw error lines and data points
  for (let i = 0; i < dataPoints.length; i++) {
    const p = dataPoints[i];
    const sx = toSX(p.x);
    const syTrue = toSY(p.yTrue);
    const syPred = toSY(p.yPred);

    // Error line
    ctx.strokeStyle = getAxisColor();
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(sx, syTrue);
    ctx.lineTo(sx, syPred);
    ctx.stroke();
    ctx.setLineDash([]);

    // True value (filled circle)
    ctx.beginPath();
    ctx.arc(sx, syTrue, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#4f8ff7";
    ctx.fill();
    ctx.strokeStyle = getSurfaceColor();
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Predicted value (draggable diamond)
    const isDragging = dragIndex === i;
    const diamondSize = isDragging ? 9 : 7;
    ctx.beginPath();
    ctx.moveTo(sx, syPred - diamondSize);
    ctx.lineTo(sx + diamondSize, syPred);
    ctx.lineTo(sx, syPred + diamondSize);
    ctx.lineTo(sx - diamondSize, syPred);
    ctx.closePath();
    ctx.fillStyle = isDragging ? "#f59e0b" : "#ef4444";
    ctx.fill();
    ctx.strokeStyle = getSurfaceColor();
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Legend for scatter
  ctx.font = "10px system-ui, sans-serif";
  ctx.textAlign = "left";
  const legendX = padding.left + 4;
  const legendY = padding.top + 14;
  ctx.fillStyle = "#4f8ff7";
  ctx.beginPath();
  ctx.arc(legendX, legendY - 3, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = getTextColor();
  ctx.fillText("True (y)", legendX + 10, legendY);

  ctx.fillStyle = "#ef4444";
  const predLegendY = legendY + 16;
  // Diamond icon
  ctx.beginPath();
  ctx.moveTo(legendX, predLegendY - 7);
  ctx.lineTo(legendX + 4, predLegendY - 3);
  ctx.lineTo(legendX, predLegendY + 1);
  ctx.lineTo(legendX - 4, predLegendY - 3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = getTextColor();
  ctx.fillText("Predicted (y\u0302) — drag to move", legendX + 10, predLegendY);

  // ─── Bar chart section ───
  const barPadding = { top: 30, right: 15, bottom: 40, left: 12 };
  const barPlotW = barW - barPadding.left - barPadding.right;
  const barPlotH = h - barPadding.top - barPadding.bottom;

  // Divider line
  ctx.strokeStyle = getGridColor();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(scatterW, 0);
  ctx.lineTo(scatterW, h);
  ctx.stroke();

  // Title for bar chart
  ctx.fillStyle = getTextColor();
  ctx.font = "bold 11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(
    showGradients ? "Per-Point Gradient" : "Per-Point Loss",
    scatterW + barW / 2,
    18
  );

  // Compute per-point losses for each active loss function
  const numPoints = dataPoints.length;
  const numLosses = activeLosses.length;
  if (numLosses === 0 || numPoints === 0) return;

  const barData: number[][] = []; // [lossIdx][pointIdx]
  let maxBarVal = 0;
  let minBarVal = 0;

  for (const loss of activeLosses) {
    const vals: number[] = [];
    for (const p of dataPoints) {
      const yVal = loss.domain === "binary" ? clamp(p.yPred, 0.001, 0.999) : p.yPred;
      const yTrueVal = loss.domain === "binary" ? clamp(p.yTrue, 0, 1) : p.yTrue;
      const v = showGradients
        ? loss.gradient(yTrueVal, yVal, params)
        : loss.fn(yTrueVal, yVal, params);
      const safe = Number.isFinite(v) ? v : 0;
      vals.push(safe);
      maxBarVal = Math.max(maxBarVal, safe);
      minBarVal = Math.min(minBarVal, safe);
    }
    barData.push(vals);
  }

  maxBarVal = Math.max(maxBarVal, 0.1);
  if (showGradients) {
    const absMax = Math.max(Math.abs(maxBarVal), Math.abs(minBarVal), 0.1);
    maxBarVal = absMax;
    minBarVal = -absMax;
  }

  const groupWidth = barPlotW / numPoints;
  const barWidth = Math.max(2, (groupWidth * 0.7) / numLosses);
  const groupGap = groupWidth * 0.3;

  // Zero line for gradients
  const zeroY = showGradients
    ? barPadding.top + (maxBarVal / (maxBarVal - minBarVal)) * barPlotH
    : barPadding.top + barPlotH;

  // Draw bars
  for (let pi = 0; pi < numPoints; pi++) {
    const groupX = scatterW + barPadding.left + pi * groupWidth + groupGap / 2;

    for (let li = 0; li < numLosses; li++) {
      const val = barData[li][pi];
      const barX = groupX + li * barWidth;

      let barTop: number;
      let barHeight: number;
      if (showGradients) {
        const totalRange = maxBarVal - minBarVal;
        const barY = barPadding.top + ((maxBarVal - val) / totalRange) * barPlotH;
        barTop = Math.min(barY, zeroY);
        barHeight = Math.abs(barY - zeroY);
      } else {
        barHeight = (val / maxBarVal) * barPlotH;
        barTop = barPadding.top + barPlotH - barHeight;
      }

      ctx.fillStyle = activeLosses[li].color + "cc";
      ctx.fillRect(barX, barTop, barWidth - 1, Math.max(barHeight, 1));
    }

    // Point label
    ctx.fillStyle = getMutedColor();
    ctx.font = "9px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      `P${pi + 1}`,
      groupX + (numLosses * barWidth) / 2,
      h - barPadding.bottom + 14
    );
  }

  // Draw zero line for gradient view
  if (showGradients) {
    ctx.strokeStyle = getAxisColor();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(scatterW + barPadding.left, zeroY);
    ctx.lineTo(scatterW + barW - barPadding.right, zeroY);
    ctx.stroke();
  }
}

// ─────────────────────────────────────────────────────────
// Utility Helpers
// ─────────────────────────────────────────────────────────

function computeNiceStep(min: number, max: number, targetTicks: number): number {
  const rawStep = (max - min) / targetTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;

  let niceStep: number;
  if (normalized < 1.5) niceStep = 1;
  else if (normalized < 3.5) niceStep = 2;
  else if (normalized < 7.5) niceStep = 5;
  else niceStep = 10;

  return niceStep * magnitude;
}

function formatTickLabel(v: number): string {
  if (Math.abs(v) < 1e-10) return "0";
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

function formatValue(v: number): string {
  if (!Number.isFinite(v)) return "NaN";
  if (Math.abs(v) > 1e4) return v.toExponential(2);
  if (Math.abs(v) < 0.001 && v !== 0) return v.toExponential(2);
  return v.toFixed(4);
}

function formatTotalLoss(v: number): string {
  if (!Number.isFinite(v)) return "NaN";
  if (Math.abs(v) > 1e4) return v.toExponential(2);
  return v.toFixed(3);
}

// ─────────────────────────────────────────────────────────
// Hit testing for interactive mode
// ─────────────────────────────────────────────────────────

function findDragTarget(
  canvasX: number,
  canvasY: number,
  dataPoints: DataPoint[],
  w: number,
  h: number
): number | null {
  const padding = { top: 30, right: 15, bottom: 40, left: 50 };
  const scatterW = Math.floor(w * 0.58);
  const scatterPlotW = scatterW - padding.left - padding.right;
  const scatterPlotH = h - padding.top - padding.bottom;

  const allYValues = dataPoints.flatMap((p) => [p.yTrue, p.yPred]);
  let yMin = Math.min(...allYValues) - 0.5;
  let yMax = Math.max(...allYValues) + 0.5;
  yMin = Math.floor(yMin);
  yMax = Math.ceil(yMax);
  const xMinData = Math.min(...dataPoints.map((p) => p.x)) - 0.3;
  const xMaxData = Math.max(...dataPoints.map((p) => p.x)) + 0.3;

  const toSX = (x: number) =>
    padding.left + ((x - xMinData) / (xMaxData - xMinData)) * scatterPlotW;
  const toSY = (y: number) =>
    padding.top + ((yMax - y) / (yMax - yMin)) * scatterPlotH;

  const hitRadius = 14;
  for (let i = 0; i < dataPoints.length; i++) {
    const p = dataPoints[i];
    const sx = toSX(p.x);
    const sy = toSY(p.yPred);
    const dist = Math.sqrt((canvasX - sx) ** 2 + (canvasY - sy) ** 2);
    if (dist < hitRadius) return i;
  }
  return null;
}

function canvasYToDataY(
  canvasY: number,
  dataPoints: DataPoint[],
  h: number
): number {
  const padding = { top: 30, bottom: 40 };
  const scatterPlotH = h - padding.top - padding.bottom;

  const allYValues = dataPoints.flatMap((p) => [p.yTrue, p.yPred]);
  let yMin = Math.min(...allYValues) - 0.5;
  let yMax = Math.max(...allYValues) + 0.5;
  yMin = Math.floor(yMin);
  yMax = Math.ceil(yMax);

  const normalizedY = (canvasY - padding.top) / scatterPlotH;
  return yMax - normalizedY * (yMax - yMin);
}

// ─────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────

export default function LossExplorer() {
  // State
  const [mode, setMode] = useState<VisualizationMode>("curve");
  const [activeLossIds, setActiveLossIds] = useState<string[]>(DEFAULT_ACTIVE_LOSSES);
  const [showGradients, setShowGradients] = useState(false);
  const [huberDelta, setHuberDelta] = useState(1.0);
  const [focalAlpha, setFocalAlpha] = useState(0.25);
  const [focalGamma, setFocalGamma] = useState(2.0);
  const [trueValue, setTrueValue] = useState(1.0);

  // Curve mode state
  const [dragX, setDragX] = useState<number | null>(null);
  const [isDraggingLine, setIsDraggingLine] = useState(false);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  // Interactive mode state
  const [dataPoints, setDataPoints] = useState<DataPoint[]>(DEFAULT_DATA_POINTS);
  const [dragPointIndex, setDragPointIndex] = useState<number | null>(null);

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(800);

  const params: LossParams = useMemo(
    () => ({ huberDelta, focalAlpha, focalGamma }),
    [huberDelta, focalAlpha, focalGamma]
  );

  const activeLosses = useMemo(
    () => LOSS_FUNCTIONS.filter((l) => activeLossIds.includes(l.id)),
    [activeLossIds]
  );

  // Check if any active loss is classification-only
  const hasClassificationLoss = useMemo(
    () => activeLosses.some((l) => l.domain === "binary" || l.domain === "hinge"),
    [activeLosses]
  );

  const hasRegressionLoss = useMemo(
    () => activeLosses.some((l) => l.domain === "regression"),
    [activeLosses]
  );

  // Auto-switch data points when switching between regression and classification
  useEffect(() => {
    if (mode !== "interactive") return;
    if (hasClassificationLoss && !hasRegressionLoss) {
      setDataPoints(DEFAULT_CLASSIFICATION_POINTS);
    } else if (hasRegressionLoss && !hasClassificationLoss) {
      setDataPoints(DEFAULT_DATA_POINTS);
    }
  }, [hasClassificationLoss, hasRegressionLoss, mode]);

  // Responsive sizing
  useEffect(() => {
    function handleResize() {
      if (containerRef.current) {
        setCanvasWidth(containerRef.current.clientWidth);
      }
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const canvasHeight = useMemo(() => {
    return Math.round(canvasWidth * 0.55);
  }, [canvasWidth]);

  // DPR-aware rendering
  const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;

  // ─── Render canvas ───
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const displayW = canvasWidth;
    const displayH = canvasHeight;
    canvas.width = displayW * dpr;
    canvas.height = displayH * dpr;
    canvas.style.width = displayW + "px";
    canvas.style.height = displayH + "px";
    ctx.scale(dpr, dpr);

    if (mode === "curve") {
      drawCurveMode(
        ctx,
        displayW,
        displayH,
        activeLosses,
        trueValue,
        showGradients,
        params,
        dragX,
        hoverPos?.x ?? null,
        hoverPos?.y ?? null
      );
    } else {
      drawInteractiveMode(
        ctx,
        displayW,
        displayH,
        dataPoints,
        activeLosses,
        params,
        showGradients,
        dragPointIndex
      );
    }
  }, [
    canvasWidth,
    canvasHeight,
    mode,
    activeLosses,
    trueValue,
    showGradients,
    params,
    dragX,
    hoverPos,
    dataPoints,
    dragPointIndex,
    dpr,
  ]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // ─── Mouse handlers for curve mode ───
  const handleCurveMouseDown = useCallback(
    (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas || mode !== "curve") return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvasWidth / rect.width;
      const px = (e.clientX - rect.left) * scaleX;

      const config = createCurvePlotConfig(activeLosses, trueValue, showGradients, params);
      const plotW = canvasWidth - config.padding.left - config.padding.right;
      const plotX = config.xMin + ((px - config.padding.left) / plotW) * (config.xMax - config.xMin);

      if (plotX >= config.xMin && plotX <= config.xMax) {
        setDragX(clamp(plotX, config.xMin, config.xMax));
        setIsDraggingLine(true);
      }
    },
    [mode, activeLosses, trueValue, showGradients, params, canvasWidth]
  );

  const handleCurveMouseMove = useCallback(
    (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas || mode !== "curve") return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvasWidth / rect.width;
      const scaleY = canvasHeight / rect.height;
      const px = (e.clientX - rect.left) * scaleX;
      const py = (e.clientY - rect.top) * scaleY;

      if (isDraggingLine) {
        const config = createCurvePlotConfig(activeLosses, trueValue, showGradients, params);
        const plotW = canvasWidth - config.padding.left - config.padding.right;
        const plotX =
          config.xMin +
          ((px - config.padding.left) / plotW) * (config.xMax - config.xMin);
        setDragX(clamp(plotX, config.xMin, config.xMax));
      } else {
        setHoverPos({ x: px, y: py });
      }
    },
    [mode, isDraggingLine, activeLosses, trueValue, showGradients, params, canvasWidth, canvasHeight]
  );

  const handleCurveMouseUp = useCallback(() => {
    setIsDraggingLine(false);
  }, []);

  const handleCurveMouseLeave = useCallback(() => {
    setIsDraggingLine(false);
    setHoverPos(null);
  }, []);

  // ─── Mouse handlers for interactive mode ───
  const handleInteractiveMouseDown = useCallback(
    (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas || mode !== "interactive") return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvasWidth / rect.width;
      const scaleY = canvasHeight / rect.height;
      const px = (e.clientX - rect.left) * scaleX;
      const py = (e.clientY - rect.top) * scaleY;

      const target = findDragTarget(px, py, dataPoints, canvasWidth, canvasHeight);
      if (target !== null) {
        setDragPointIndex(target);
      }
    },
    [mode, dataPoints, canvasWidth, canvasHeight]
  );

  const handleInteractiveMouseMove = useCallback(
    (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas || mode !== "interactive" || dragPointIndex === null) return;

      const rect = canvas.getBoundingClientRect();
      const scaleY = canvasHeight / rect.height;
      const py = (e.clientY - rect.top) * scaleY;

      const newYPred = canvasYToDataY(py, dataPoints, canvasHeight);
      setDataPoints((prev) => {
        const updated = [...prev];
        updated[dragPointIndex] = {
          ...updated[dragPointIndex],
          yPred: Math.round(newYPred * 100) / 100,
        };
        return updated;
      });
    },
    [mode, dragPointIndex, dataPoints, canvasHeight]
  );

  const handleInteractiveMouseUp = useCallback(() => {
    setDragPointIndex(null);
  }, []);

  // ─── Unified mouse handler ───
  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (mode === "curve") handleCurveMouseDown(e);
      else handleInteractiveMouseDown(e);
    },
    [mode, handleCurveMouseDown, handleInteractiveMouseDown]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (mode === "curve") handleCurveMouseMove(e);
      else handleInteractiveMouseMove(e);
    },
    [mode, handleCurveMouseMove, handleInteractiveMouseMove]
  );

  const handleMouseUp = useCallback(() => {
    if (mode === "curve") handleCurveMouseUp();
    else handleInteractiveMouseUp();
  }, [mode, handleCurveMouseUp, handleInteractiveMouseUp]);

  // ─── Touch handlers for mobile ───
  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      const touch = e.touches[0];
      const syntheticEvent = { clientX: touch.clientX, clientY: touch.clientY } as MouseEvent;
      handleMouseDown(syntheticEvent);
    },
    [handleMouseDown]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      const touch = e.touches[0];
      const syntheticEvent = { clientX: touch.clientX, clientY: touch.clientY } as MouseEvent;
      handleMouseMove(syntheticEvent);
    },
    [handleMouseMove]
  );

  const handleTouchEnd = useCallback(() => {
    handleMouseUp();
  }, [handleMouseUp]);

  // ─── Toggle loss function ───
  const toggleLoss = useCallback((id: string) => {
    setActiveLossIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 1) return prev;
        return prev.filter((l) => l !== id);
      }
      return [...prev, id];
    });
  }, []);

  // ─── Compute totals for interactive mode ───
  const totalLosses = useMemo(() => {
    if (mode !== "interactive") return [];
    return activeLosses.map((loss) => {
      let total = 0;
      for (const p of dataPoints) {
        const yVal =
          loss.domain === "binary" ? clamp(p.yPred, 0.001, 0.999) : p.yPred;
        const yTrueVal =
          loss.domain === "binary" ? clamp(p.yTrue, 0, 1) : p.yTrue;
        const v = loss.fn(yTrueVal, yVal, params);
        total += Number.isFinite(v) ? v : 0;
      }
      return { id: loss.id, name: loss.name, color: loss.color, total: total / dataPoints.length };
    });
  }, [mode, activeLosses, dataPoints, params]);

  // ─── Reset interactive mode ───
  const resetDataPoints = useCallback(() => {
    if (hasClassificationLoss && !hasRegressionLoss) {
      setDataPoints(DEFAULT_CLASSIFICATION_POINTS);
    } else {
      setDataPoints(DEFAULT_DATA_POINTS);
    }
  }, [hasClassificationLoss, hasRegressionLoss]);

  // ─── Check which param sliders to show ───
  const showHuberParam = activeLossIds.includes("huber");
  const showFocalParams = activeLossIds.includes("focal");

  return (
    <div class="le-root overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Top toolbar: Mode + Loss toggles */}
      <div class="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
        {/* Mode switcher */}
        <div class="flex items-center gap-1 rounded-lg border border-[var(--color-border)] p-0.5">
          <button
            onClick={() => setMode("curve")}
            class="rounded-md px-3 py-1 text-xs font-medium transition-all"
            style={{
              background: mode === "curve" ? "var(--color-primary)" : "transparent",
              color: mode === "curve" ? "#ffffff" : "var(--color-text-muted)",
            }}
          >
            Curve
          </button>
          <button
            onClick={() => setMode("interactive")}
            class="rounded-md px-3 py-1 text-xs font-medium transition-all"
            style={{
              background: mode === "interactive" ? "var(--color-primary)" : "transparent",
              color: mode === "interactive" ? "#ffffff" : "var(--color-text-muted)",
            }}
          >
            Interactive
          </button>
        </div>

        <span class="text-[10px] text-[var(--color-text-muted)]">|</span>

        {/* Loss function toggles */}
        <div class="flex flex-wrap items-center gap-1.5">
          {LOSS_FUNCTIONS.map((loss) => {
            const isActive = activeLossIds.includes(loss.id);
            return (
              <button
                key={loss.id}
                onClick={() => toggleLoss(loss.id)}
                class="le-loss-toggle flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-all"
                style={{
                  background: isActive ? loss.color + "20" : "transparent",
                  border: `1px solid ${isActive ? loss.color + "60" : "var(--color-border)"}`,
                  color: isActive ? loss.color : "var(--color-text-muted)",
                }}
              >
                <span
                  class="inline-block h-2 w-2 rounded-full"
                  style={{
                    background: isActive ? loss.color : "var(--color-border)",
                  }}
                />
                {loss.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Canvas */}
      <div ref={containerRef} class="relative border-b border-[var(--color-border)]">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleCurveMouseLeave}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          class="le-canvas block w-full cursor-crosshair"
          style={{
            width: canvasWidth + "px",
            height: canvasHeight + "px",
            touchAction: "none",
          }}
        />
        {/* Hint overlay */}
        {mode === "curve" && dragX === null && (
          <div class="pointer-events-none absolute bottom-3 left-0 right-0 text-center">
            <span class="rounded-full bg-black/50 px-3 py-1 text-[10px] text-white/70">
              Click and drag to explore loss values
            </span>
          </div>
        )}
        {mode === "interactive" && dragPointIndex === null && (
          <div class="pointer-events-none absolute bottom-3 left-0 right-0 text-center">
            <span class="rounded-full bg-black/50 px-3 py-1 text-[10px] text-white/70">
              Drag the red diamonds to change predictions
            </span>
          </div>
        )}
      </div>

      {/* Controls + Info */}
      <div class="grid grid-cols-1 md:grid-cols-[1fr_1fr]">
        {/* Left: Parameters + Controls */}
        <div class="border-b border-[var(--color-border)] p-4 md:border-b-0 md:border-r">
          <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
            Controls
          </h3>

          {/* Gradient toggle */}
          <label class="mb-3 flex cursor-pointer items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
            <input
              type="checkbox"
              checked={showGradients}
              onChange={() => setShowGradients((p) => !p)}
              class="le-checkbox"
            />
            Show Gradients (dL/dy&#770;)
          </label>

          {/* True value (curve mode) */}
          {mode === "curve" && (
            <div class="mb-3">
              <div class="mb-1 flex items-center justify-between">
                <label class="text-[11px] text-[var(--color-text-muted)]">True value (y)</label>
                <span class="font-mono text-[11px] text-[var(--color-heading)]">
                  {trueValue.toFixed(1)}
                </span>
              </div>
              <input
                type="range"
                min="-1"
                max="2"
                step="0.1"
                value={trueValue}
                onInput={(e) => setTrueValue(Number((e.target as HTMLInputElement).value))}
                class="le-slider w-full"
              />
            </div>
          )}

          {/* Huber delta */}
          {showHuberParam && (
            <div class="mb-3">
              <div class="mb-1 flex items-center justify-between">
                <label class="text-[11px] text-[var(--color-text-muted)]">
                  Huber delta
                </label>
                <span class="font-mono text-[11px] text-[var(--color-heading)]">
                  {huberDelta.toFixed(1)}
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="50"
                step="1"
                value={Math.round(huberDelta * 10)}
                onInput={(e) =>
                  setHuberDelta(Number((e.target as HTMLInputElement).value) / 10)
                }
                class="le-slider w-full"
              />
            </div>
          )}

          {/* Focal alpha */}
          {showFocalParams && (
            <>
              <div class="mb-3">
                <div class="mb-1 flex items-center justify-between">
                  <label class="text-[11px] text-[var(--color-text-muted)]">
                    Focal alpha
                  </label>
                  <span class="font-mono text-[11px] text-[var(--color-heading)]">
                    {focalAlpha.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="1"
                  value={Math.round(focalAlpha * 10)}
                  onInput={(e) =>
                    setFocalAlpha(Number((e.target as HTMLInputElement).value) / 10)
                  }
                  class="le-slider w-full"
                />
              </div>
              <div class="mb-3">
                <div class="mb-1 flex items-center justify-between">
                  <label class="text-[11px] text-[var(--color-text-muted)]">
                    Focal gamma
                  </label>
                  <span class="font-mono text-[11px] text-[var(--color-heading)]">
                    {focalGamma.toFixed(1)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  step="1"
                  value={Math.round(focalGamma * 10)}
                  onInput={(e) =>
                    setFocalGamma(Number((e.target as HTMLInputElement).value) / 10)
                  }
                  class="le-slider w-full"
                />
              </div>
            </>
          )}

          {/* Interactive mode total losses */}
          {mode === "interactive" && totalLosses.length > 0 && (
            <div class="mt-3 rounded-lg border border-[var(--color-border)] p-3">
              <h4 class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-heading)]">
                Average Loss
              </h4>
              <div class="space-y-1.5">
                {totalLosses.map((tl) => (
                  <div key={tl.id} class="flex items-center justify-between">
                    <span class="flex items-center gap-1.5">
                      <span
                        class="inline-block h-2 w-2 rounded-full"
                        style={{ background: tl.color }}
                      />
                      <span class="text-[11px] font-medium" style={{ color: tl.color }}>
                        {tl.name}
                      </span>
                    </span>
                    <span class="font-mono text-[11px] text-[var(--color-heading)]">
                      {formatTotalLoss(tl.total)}
                    </span>
                  </div>
                ))}
              </div>
              <button
                onClick={resetDataPoints}
                class="mt-3 w-full rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[11px] font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)]/30 hover:text-[var(--color-heading)]"
              >
                Reset Points
              </button>
            </div>
          )}

          {/* Drag value display (curve mode) */}
          {mode === "curve" && dragX !== null && (
            <div class="mt-3 rounded-lg border border-[var(--color-border)] p-3">
              <h4 class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-heading)]">
                At y&#770; = {dragX.toFixed(2)}
              </h4>
              <div class="space-y-1">
                {activeLosses.map((loss) => {
                  let yHatInput = dragX;
                  if (loss.domain === "binary") yHatInput = clamp(dragX, 0.001, 0.999);
                  const val = showGradients
                    ? loss.gradient(trueValue, yHatInput, params)
                    : loss.fn(trueValue, yHatInput, params);
                  return (
                    <div key={loss.id} class="flex items-center justify-between">
                      <span class="text-[11px]" style={{ color: loss.color }}>
                        {loss.name}
                      </span>
                      <span class="font-mono text-[11px] text-[var(--color-heading)]">
                        {formatValue(val)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right: Properties table */}
        <div class="p-4">
          <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
            Properties
          </h3>
          <div class="le-properties-scroll overflow-x-auto">
            <table class="w-full text-[10px] sm:text-[11px]">
              <thead>
                <tr class="border-b border-[var(--color-border)]">
                  <th class="pb-2 pr-2 text-left font-medium text-[var(--color-text-muted)]">
                    Function
                  </th>
                  <th class="pb-2 px-1 text-center font-medium text-[var(--color-text-muted)]">
                    Sym.
                  </th>
                  <th class="pb-2 px-1 text-center font-medium text-[var(--color-text-muted)]">
                    Robust
                  </th>
                  <th class="pb-2 px-1 text-center font-medium text-[var(--color-text-muted)]">
                    Diff.
                  </th>
                  <th class="pb-2 px-1 text-center font-medium text-[var(--color-text-muted)]">
                    Type
                  </th>
                  <th class="pb-2 pl-1 text-left font-medium text-[var(--color-text-muted)]">
                    Gradient
                  </th>
                </tr>
              </thead>
              <tbody>
                {activeLosses.map((loss) => (
                  <tr
                    key={loss.id}
                    class="border-b border-[var(--color-border)]/50"
                  >
                    <td class="py-1.5 pr-2">
                      <span class="flex items-center gap-1.5">
                        <span
                          class="inline-block h-2 w-2 rounded-full"
                          style={{ background: loss.color }}
                        />
                        <span class="font-medium" style={{ color: loss.color }}>
                          {loss.name}
                        </span>
                      </span>
                    </td>
                    <td class="py-1.5 px-1 text-center">
                      {loss.symmetric ? (
                        <span class="text-[var(--color-accent)]">Yes</span>
                      ) : (
                        <span class="text-[var(--color-text-muted)]">No</span>
                      )}
                    </td>
                    <td class="py-1.5 px-1 text-center">
                      {loss.robustToOutliers ? (
                        <span class="text-[var(--color-accent)]">Yes</span>
                      ) : (
                        <span class="text-[var(--color-text-muted)]">No</span>
                      )}
                    </td>
                    <td class="py-1.5 px-1 text-center">
                      {loss.differentiableEverywhere ? (
                        <span class="text-[var(--color-accent)]">Yes</span>
                      ) : (
                        <span class="text-[var(--color-text-muted)]">No</span>
                      )}
                    </td>
                    <td class="py-1.5 px-1 text-center">
                      <span
                        class="rounded px-1 py-0.5 text-[9px] font-semibold uppercase"
                        style={{
                          background:
                            loss.useCase === "regression"
                              ? "var(--color-primary)" + "20"
                              : "var(--color-accent)" + "20",
                          color:
                            loss.useCase === "regression"
                              ? "var(--color-primary)"
                              : "var(--color-accent)",
                        }}
                      >
                        {loss.useCase === "regression" ? "Reg" : "Cls"}
                      </span>
                    </td>
                    <td class="py-1.5 pl-1 text-[var(--color-text-muted)]">
                      {loss.gradientBehavior}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {activeLosses.length === 0 && (
            <p class="text-center text-[11px] text-[var(--color-text-muted)]">
              Select at least one loss function above.
            </p>
          )}
        </div>
      </div>

      {/* Formula reference */}
      <div class="border-t border-[var(--color-border)] px-4 py-3">
        <details class="text-[11px] text-[var(--color-text-muted)]">
          <summary class="cursor-pointer font-medium text-[var(--color-heading)] hover:text-[var(--color-primary)]">
            Formulas Reference
          </summary>
          <div class="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 md:grid-cols-4">
            <div>
              <span class="font-medium" style={{ color: "#4f8ff7" }}>MSE</span>:{" "}
              <span class="font-mono">(y - y&#770;)&#178;</span>
            </div>
            <div>
              <span class="font-medium" style={{ color: "#34d399" }}>MAE</span>:{" "}
              <span class="font-mono">|y - y&#770;|</span>
            </div>
            <div>
              <span class="font-medium" style={{ color: "#f59e0b" }}>Huber</span>:{" "}
              <span class="font-mono">
                &#189;a&#178; if a&#8804;&#948;, else &#948;(a-&#189;&#948;)
              </span>
            </div>
            <div>
              <span class="font-medium" style={{ color: "#ef4444" }}>BCE</span>:{" "}
              <span class="font-mono">-[y&#183;log(p)+(1-y)&#183;log(1-p)]</span>
            </div>
            <div>
              <span class="font-medium" style={{ color: "#a855f7" }}>CCE</span>:{" "}
              <span class="font-mono">-y&#183;log(p)</span>
            </div>
            <div>
              <span class="font-medium" style={{ color: "#ec4899" }}>Hinge</span>:{" "}
              <span class="font-mono">max(0, 1-y&#183;y&#770;)</span>
            </div>
            <div>
              <span class="font-medium" style={{ color: "#14b8a6" }}>Focal</span>:{" "}
              <span class="font-mono">-&#945;(1-p)&#x02b8;&#183;log(p)</span>
            </div>
            <div>
              <span class="font-medium" style={{ color: "#f97316" }}>Log-Cosh</span>:{" "}
              <span class="font-mono">log(cosh(y-y&#770;))</span>
            </div>
          </div>
        </details>
      </div>

      <style>{`
        .le-canvas {
          image-rendering: auto;
        }
        .le-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          border-radius: 2px;
          background: var(--color-border);
          outline: none;
        }
        .le-slider::-webkit-slider-thumb {
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
        .le-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--color-primary);
          cursor: pointer;
          border: 2px solid var(--color-surface);
        }
        .le-checkbox {
          accent-color: var(--color-primary);
          cursor: pointer;
        }
        .le-loss-toggle:hover {
          filter: brightness(1.1);
        }
        .le-root:focus {
          outline: none;
        }
        .le-properties-scroll::-webkit-scrollbar {
          height: 4px;
        }
        .le-properties-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .le-properties-scroll::-webkit-scrollbar-thumb {
          background: var(--color-border);
          border-radius: 2px;
        }
      `}</style>
    </div>
  );
}
