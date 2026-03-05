// ─────────────────────────────────────────────────────────
// Canvas Rendering for Decision Tree Visualization
// All functions take canvas context — SSR-safe (never called during SSR)
// ─────────────────────────────────────────────────────────

import type {
  TreeNode,
  NodeLayout,
  FeatureImportance,
  PredictionPath,
} from "./tree-engine";

// ─────────────────────────────────────────────────────────
// Color Utilities
// ─────────────────────────────────────────────────────────

const CLASS_COLORS = [
  "#4f8ff7", // blue
  "#34d399", // green
  "#f59e0b", // amber
  "#ef4444", // red
  "#a78bfa", // purple
  "#f472b6", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#fb923c", // orange
  "#64748b", // slate
];

export function getClassColor(classIndex: number): string {
  return CLASS_COLORS[classIndex % CLASS_COLORS.length];
}

function getClassColorAlpha(classIndex: number, alpha: number): string {
  const hex = CLASS_COLORS[classIndex % CLASS_COLORS.length];
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function regressionColor(value: number, min: number, max: number): string {
  const t = max > min ? (value - min) / (max - min) : 0.5;
  const r = Math.round(79 + t * 176); // 4f -> ff
  const g = Math.round(143 - t * 80); // 8f -> 3f
  const b = Math.round(247 - t * 178); // f7 -> 45
  return `rgb(${r},${g},${b})`;
}

function regressionColorAlpha(
  value: number,
  min: number,
  max: number,
  alpha: number,
): string {
  const t = max > min ? (value - min) / (max - min) : 0.5;
  const r = Math.round(79 + t * 176);
  const g = Math.round(143 - t * 80);
  const b = Math.round(247 - t * 178);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─────────────────────────────────────────────────────────
// Tree Diagram Renderer
// ─────────────────────────────────────────────────────────

export function renderTreeDiagram(
  ctx: CanvasRenderingContext2D,
  layouts: NodeLayout[],
  classes: string[],
  taskType: "classification" | "regression",
  selectedNodeId: number | null,
  highlightPath: PredictionPath[] | null,
  dpr: number,
): void {
  const w = ctx.canvas.width / dpr;
  const h = ctx.canvas.height / dpr;
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const highlightNodeIds = new Set(highlightPath?.map((p) => p.nodeId) ?? []);

  // Collect regression range
  let regMin = Infinity;
  let regMax = -Infinity;
  if (taskType === "regression") {
    for (const l of layouts) {
      const v = l.node.prediction as number;
      if (v < regMin) regMin = v;
      if (v > regMax) regMax = v;
    }
  }

  // Draw edges first
  for (const layout of layouts) {
    if (layout.parentX !== null && layout.parentY !== null) {
      const isHighlighted = highlightNodeIds.has(layout.node.id);
      ctx.beginPath();
      ctx.moveTo(layout.parentX, layout.parentY);
      ctx.lineTo(layout.x, layout.y);
      ctx.strokeStyle = isHighlighted ? "#f59e0b" : "rgba(160,160,160,0.3)";
      ctx.lineWidth = isHighlighted ? 2.5 : 1;
      ctx.stroke();
    }
  }

  // Draw nodes
  for (const layout of layouts) {
    const { node, x, y } = layout;
    const isSelected = node.id === selectedNodeId;
    const isHighlighted = highlightNodeIds.has(node.id);
    const radius = 24;

    // Node circle
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);

    if (taskType === "classification") {
      const maxClass = Object.entries(node.classCounts).sort(
        (a, b) => b[1] - a[1],
      )[0];
      const classIdx = maxClass ? classes.indexOf(maxClass[0]) : 0;
      ctx.fillStyle = getClassColorAlpha(classIdx, node.isLeaf ? 0.85 : 0.4);
    } else {
      const v = node.prediction as number;
      ctx.fillStyle = node.isLeaf
        ? regressionColorAlpha(v, regMin, regMax, 0.85)
        : regressionColorAlpha(v, regMin, regMax, 0.4);
    }
    ctx.fill();

    if (isSelected) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.stroke();
    } else if (isHighlighted) {
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2.5;
      ctx.stroke();
    } else {
      ctx.strokeStyle = "rgba(160,160,160,0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Node text
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 9px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (node.isLeaf) {
      const pred =
        taskType === "regression" && typeof node.prediction === "number"
          ? node.prediction.toFixed(1)
          : String(node.prediction);
      ctx.fillText(pred, x, y - 4);
      ctx.font = "8px Inter, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fillText(`n=${node.samples}`, x, y + 8);
    } else if (node.split) {
      const label = node.split.isNumeric
        ? `${truncateLabel(node.split.feature, 8)}`
        : `${truncateLabel(node.split.feature, 8)}`;
      ctx.fillText(label, x, y - 8);

      ctx.font = "8px Inter, sans-serif";
      const thresh = node.split.isNumeric
        ? `<= ${(node.split.threshold as number).toFixed(1)}`
        : `= ${truncateLabel(String(node.split.threshold), 6)}`;
      ctx.fillText(thresh, x, y + 2);

      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = "7px Inter, sans-serif";
      ctx.fillText(`n=${node.samples}`, x, y + 12);
    }
  }

  ctx.restore();
}

function truncateLabel(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 1) + "\u2026" : s;
}

// ─────────────────────────────────────────────────────────
// Scatter Plot with Decision Boundaries
// ─────────────────────────────────────────────────────────

export function renderScatterPlot(
  ctx: CanvasRenderingContext2D,
  data: Array<Record<string, number | string>>,
  feature1: string,
  feature2: string,
  target: string,
  classes: string[],
  taskType: "classification" | "regression",
  boundary: Array<{ x: number; y: number; prediction: string | number }> | null,
  x1Range: [number, number],
  x2Range: [number, number],
  resolution: number,
  dpr: number,
): void {
  const w = ctx.canvas.width / dpr;
  const h = ctx.canvas.height / dpr;
  const pad = 40;
  const plotW = w - pad * 2;
  const plotH = h - pad * 2;

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  // Regression color range
  let regMin = Infinity;
  let regMax = -Infinity;
  if (taskType === "regression" && boundary) {
    for (const b of boundary) {
      const v = b.prediction as number;
      if (v < regMin) regMin = v;
      if (v > regMax) regMax = v;
    }
  }

  // Draw boundary
  if (boundary) {
    const cellW = plotW / resolution;
    const cellH = plotH / resolution;

    for (const b of boundary) {
      const px =
        pad + ((b.x - x1Range[0]) / (x1Range[1] - x1Range[0])) * plotW;
      const py =
        pad +
        plotH -
        ((b.y - x2Range[0]) / (x2Range[1] - x2Range[0])) * plotH;

      if (taskType === "classification") {
        const classIdx = classes.indexOf(String(b.prediction));
        ctx.fillStyle = getClassColorAlpha(
          classIdx >= 0 ? classIdx : 0,
          0.15,
        );
      } else {
        ctx.fillStyle = regressionColorAlpha(
          b.prediction as number,
          regMin,
          regMax,
          0.2,
        );
      }

      ctx.fillRect(
        px - cellW / 2,
        py - cellH / 2,
        cellW + 0.5,
        cellH + 0.5,
      );
    }
  }

  // Draw axes
  ctx.strokeStyle = "rgba(160,160,160,0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, pad + plotH);
  ctx.lineTo(pad + plotW, pad + plotH);
  ctx.stroke();

  // Axis labels
  ctx.fillStyle = "rgba(200,200,200,0.8)";
  ctx.font = "10px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(feature1, pad + plotW / 2, h - 5);

  ctx.save();
  ctx.translate(10, pad + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(feature2, 0, 0);
  ctx.restore();

  // Axis ticks
  ctx.font = "8px Inter, sans-serif";
  ctx.fillStyle = "rgba(160,160,160,0.6)";
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const valX = x1Range[0] + t * (x1Range[1] - x1Range[0]);
    const valY = x2Range[0] + t * (x2Range[1] - x2Range[0]);
    const px = pad + t * plotW;
    const py = pad + plotH - t * plotH;

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(valX.toFixed(1), px, pad + plotH + 4);

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(valY.toFixed(1), pad - 4, py);
  }

  // Draw data points
  for (const row of data) {
    const xVal = row[feature1] as number;
    const yVal = row[feature2] as number;
    if (typeof xVal !== "number" || typeof yVal !== "number") continue;

    const px = pad + ((xVal - x1Range[0]) / (x1Range[1] - x1Range[0])) * plotW;
    const py =
      pad + plotH - ((yVal - x2Range[0]) / (x2Range[1] - x2Range[0])) * plotH;

    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);

    if (taskType === "classification") {
      const classIdx = classes.indexOf(String(row[target]));
      ctx.fillStyle = getClassColor(classIdx >= 0 ? classIdx : 0);
    } else {
      ctx.fillStyle = regressionColor(
        row[target] as number,
        regMin,
        regMax,
      );
    }

    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.restore();
}

// ─────────────────────────────────────────────────────────
// Feature Importance Bar Chart
// ─────────────────────────────────────────────────────────

export function renderFeatureImportance(
  ctx: CanvasRenderingContext2D,
  importance: FeatureImportance[],
  dpr: number,
): void {
  const w = ctx.canvas.width / dpr;
  const h = ctx.canvas.height / dpr;

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  if (importance.length === 0) {
    ctx.fillStyle = "rgba(160,160,160,0.5)";
    ctx.font = "12px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No feature importance data", w / 2, h / 2);
    ctx.restore();
    return;
  }

  const padLeft = 90;
  const padRight = 50;
  const padTop = 10;
  const padBottom = 10;
  const barH = Math.min(
    24,
    (h - padTop - padBottom) / importance.length - 4,
  );
  const maxBarW = w - padLeft - padRight;

  const maxImportance = Math.max(...importance.map((f) => f.importance), 0.01);

  for (let i = 0; i < importance.length; i++) {
    const fi = importance[i];
    const y = padTop + i * (barH + 4);
    const barW = (fi.importance / maxImportance) * maxBarW;

    // Label
    ctx.fillStyle = "rgba(200,200,200,0.9)";
    ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(
      truncateLabel(fi.feature, 12),
      padLeft - 6,
      y + barH / 2,
    );

    // Bar
    ctx.fillStyle = getClassColorAlpha(i, 0.7);
    ctx.fillRect(padLeft, y, barW, barH);

    // Value
    ctx.fillStyle = "rgba(200,200,200,0.7)";
    ctx.font = "9px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(
      `${(fi.importance * 100).toFixed(1)}%`,
      padLeft + barW + 4,
      y + barH / 2,
    );
  }

  ctx.restore();
}

// ─────────────────────────────────────────────────────────
// Hit Testing (which node was clicked)
// ─────────────────────────────────────────────────────────

export function hitTestNode(
  layouts: NodeLayout[],
  clickX: number,
  clickY: number,
  dpr: number,
): TreeNode | null {
  const radius = 24;
  for (const layout of layouts) {
    const dx = clickX / dpr - layout.x;
    const dy = clickY / dpr - layout.y;
    if (dx * dx + dy * dy <= radius * radius) {
      return layout.node;
    }
  }
  return null;
}
