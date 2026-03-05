// ─────────────────────────────────────────────────────────
// Canvas rendering for probability distribution plots.
// Handles grid, axes, curves, bars, shading, and samples.
// ─────────────────────────────────────────────────────────

import type { DistributionDef, ViewMode, SampleData, OverlayEntry } from "./types";
import { getDistribution } from "./distributions-config";

interface PlotConfig {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
}

const DEFAULT_PADDING = { top: 20, right: 20, bottom: 40, left: 55 };

function getPlotArea(config: PlotConfig) {
  return {
    x: config.padding.left,
    y: config.padding.top,
    w: config.width - config.padding.left - config.padding.right,
    h: config.height - config.padding.top - config.padding.bottom,
  };
}

// ─────────────────────────────────────────────────────────
// Compute nice axis ticks
// ─────────────────────────────────────────────────────────

function niceStep(range: number, targetTicks: number): number {
  const rough = range / targetTicks;
  const pow10 = Math.pow(10, Math.floor(Math.log10(rough)));
  const frac = rough / pow10;
  let nice: number;
  if (frac <= 1.5) nice = 1;
  else if (frac <= 3.5) nice = 2;
  else if (frac <= 7.5) nice = 5;
  else nice = 10;
  return nice * pow10;
}

function generateTicks(min: number, max: number, targetTicks: number): number[] {
  const range = max - min;
  if (range === 0) return [min];
  const step = niceStep(range, targetTicks);
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.01; v += step) {
    ticks.push(v);
  }
  return ticks;
}

// ─────────────────────────────────────────────────────────
// Format axis label
// ─────────────────────────────────────────────────────────

function formatTick(value: number): string {
  if (Math.abs(value) >= 1000) return value.toExponential(0);
  if (Math.abs(value) < 0.01 && value !== 0) return value.toExponential(1);
  const decimals = Math.abs(value) < 1 ? 2 : (Math.abs(value) < 10 ? 1 : 0);
  return value.toFixed(decimals);
}

// ─────────────────────────────────────────────────────────
// Get computed CSS variable colors (with fallbacks)
// ─────────────────────────────────────────────────────────

function getThemeColors() {
  if (typeof document === "undefined") {
    return {
      text: "#a1a1aa",
      textMuted: "#71717a",
      border: "#27272a",
      heading: "#ffffff",
      bg: "#09090b",
      surface: "#111111",
    };
  }
  const style = getComputedStyle(document.documentElement);
  return {
    text: style.getPropertyValue("--color-text").trim() || "#e4e4e7",
    textMuted: style.getPropertyValue("--color-text-muted").trim() || "#a1a1aa",
    border: style.getPropertyValue("--color-border").trim() || "#27272a",
    heading: style.getPropertyValue("--color-heading").trim() || "#ffffff",
    bg: style.getPropertyValue("--color-bg").trim() || "#09090b",
    surface: style.getPropertyValue("--color-surface").trim() || "#111111",
  };
}

// ─────────────────────────────────────────────────────────
// Main render function
// ─────────────────────────────────────────────────────────

export interface RenderOptions {
  distribution: DistributionDef;
  params: number[];
  viewMode: ViewMode;
  overlays: OverlayEntry[];
  sampleData: SampleData | null;
  shadedRange: [number, number] | null;
  highlightX: number | null;
}

export function renderPlot(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  options: RenderOptions
): void {
  const { distribution, params, viewMode, overlays, sampleData, shadedRange, highlightX } = options;
  const colors = getThemeColors();

  const config: PlotConfig = {
    width: canvasWidth,
    height: canvasHeight,
    padding: { ...DEFAULT_PADDING },
  };
  const plot = getPlotArea(config);

  // Clear canvas
  ctx.fillStyle = colors.surface;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Compute x range
  const xRange = distribution.xRange(params);
  const xMin = xRange[0];
  const xMax = xRange[1];

  // Compute y values for auto-scaling
  const evalFn = viewMode === "pdf" ? distribution.pdf : distribution.cdf;
  const numPoints = 500;
  const xStep = (xMax - xMin) / numPoints;

  let yMax = 0;
  const points: Array<{ x: number; y: number }> = [];

  if (distribution.type === "continuous") {
    for (let i = 0; i <= numPoints; i++) {
      const x = xMin + i * xStep;
      const y = evalFn(x, params);
      if (Number.isFinite(y) && y >= 0) {
        points.push({ x, y });
        if (y > yMax) yMax = y;
      }
    }
  } else {
    // Discrete: evaluate at integer points
    const kMin = Math.max(0, Math.floor(xMin));
    const kMax = Math.ceil(xMax);
    for (let k = kMin; k <= kMax; k++) {
      const y = evalFn(k, params);
      if (Number.isFinite(y) && y >= 0) {
        points.push({ x: k, y });
        if (y > yMax) yMax = y;
      }
    }
  }

  // Include overlay y values in auto-scaling
  for (const overlay of overlays) {
    const overlayDist = getDistribution(overlay.distributionId);
    if (!overlayDist) continue;
    const overlayFn = viewMode === "pdf" ? overlayDist.pdf : overlayDist.cdf;
    const overlayRange = overlayDist.xRange(overlay.params);
    const oXMin = Math.min(xMin, overlayRange[0]);
    const oXMax = Math.max(xMax, overlayRange[1]);

    if (overlayDist.type === "continuous") {
      const oStep = (oXMax - oXMin) / numPoints;
      for (let i = 0; i <= numPoints; i++) {
        const x = oXMin + i * oStep;
        const y = overlayFn(x, overlay.params);
        if (Number.isFinite(y) && y > yMax) yMax = y;
      }
    } else {
      const kMin = Math.max(0, Math.floor(oXMin));
      const kMax = Math.ceil(oXMax);
      for (let k = kMin; k <= kMax; k++) {
        const y = overlayFn(k, overlay.params);
        if (Number.isFinite(y) && y > yMax) yMax = y;
      }
    }
  }

  if (viewMode === "cdf") yMax = 1.05;
  else yMax *= 1.1;
  if (yMax === 0) yMax = 1;

  const yMin = 0;

  // Coordinate transforms
  const toCanvasX = (x: number) => plot.x + ((x - xMin) / (xMax - xMin)) * plot.w;
  const toCanvasY = (y: number) => plot.y + plot.h - ((y - yMin) / (yMax - yMin)) * plot.h;

  // ─── Grid Lines ───
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 0.5;
  ctx.setLineDash([2, 4]);

  const xTicks = generateTicks(xMin, xMax, 8);
  for (const tick of xTicks) {
    const cx = toCanvasX(tick);
    if (cx >= plot.x && cx <= plot.x + plot.w) {
      ctx.beginPath();
      ctx.moveTo(cx, plot.y);
      ctx.lineTo(cx, plot.y + plot.h);
      ctx.stroke();
    }
  }

  const yTicks = generateTicks(yMin, yMax, 6);
  for (const tick of yTicks) {
    const cy = toCanvasY(tick);
    if (cy >= plot.y && cy <= plot.y + plot.h) {
      ctx.beginPath();
      ctx.moveTo(plot.x, cy);
      ctx.lineTo(plot.x + plot.w, cy);
      ctx.stroke();
    }
  }

  ctx.setLineDash([]);

  // ─── Sample histogram (behind curve) ───
  if (sampleData && sampleData.bins.length > 1) {
    renderHistogram(ctx, sampleData, toCanvasX, toCanvasY, distribution.color);
  }

  // ─── Shaded area ───
  if (shadedRange && distribution.type === "continuous") {
    renderShadedArea(ctx, distribution, params, viewMode, shadedRange, xMin, xMax, toCanvasX, toCanvasY, distribution.color);
  }

  // ─── Overlay distributions ───
  for (const overlay of overlays) {
    const overlayDist = getDistribution(overlay.distributionId);
    if (!overlayDist) continue;
    renderDistributionCurve(ctx, overlayDist, overlay.params, viewMode, xMin, xMax, toCanvasX, toCanvasY, overlay.color, 1.5, true);
  }

  // ─── Main distribution curve ───
  renderDistributionCurve(ctx, distribution, params, viewMode, xMin, xMax, toCanvasX, toCanvasY, distribution.color, 2.5, false);

  // ─── Highlight X line ───
  if (highlightX !== null && highlightX >= xMin && highlightX <= xMax) {
    const hx = toCanvasX(highlightX);
    ctx.strokeStyle = colors.heading;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(hx, plot.y);
    ctx.lineTo(hx, plot.y + plot.h);
    ctx.stroke();
    ctx.setLineDash([]);

    // Label
    ctx.fillStyle = colors.heading;
    ctx.font = `${11}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(`x = ${highlightX.toFixed(2)}`, hx, plot.y - 4);
  }

  // ─── Axes ───
  ctx.strokeStyle = colors.textMuted;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plot.x, plot.y);
  ctx.lineTo(plot.x, plot.y + plot.h);
  ctx.lineTo(plot.x + plot.w, plot.y + plot.h);
  ctx.stroke();

  // ─── Axis labels ───
  ctx.fillStyle = colors.textMuted;
  ctx.font = `${10}px system-ui, sans-serif`;
  ctx.textAlign = "center";

  for (const tick of xTicks) {
    const cx = toCanvasX(tick);
    if (cx >= plot.x && cx <= plot.x + plot.w) {
      ctx.fillText(formatTick(tick), cx, plot.y + plot.h + 14);
      // Small tick mark
      ctx.beginPath();
      ctx.moveTo(cx, plot.y + plot.h);
      ctx.lineTo(cx, plot.y + plot.h + 4);
      ctx.stroke();
    }
  }

  ctx.textAlign = "right";
  for (const tick of yTicks) {
    const cy = toCanvasY(tick);
    if (cy >= plot.y && cy <= plot.y + plot.h) {
      ctx.fillText(formatTick(tick), plot.x - 6, cy + 3);
      ctx.beginPath();
      ctx.moveTo(plot.x - 3, cy);
      ctx.lineTo(plot.x, cy);
      ctx.stroke();
    }
  }

  // Y axis label
  ctx.save();
  ctx.translate(12, plot.y + plot.h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillStyle = colors.textMuted;
  ctx.font = `${11}px system-ui, sans-serif`;
  ctx.fillText(viewMode === "pdf" ? (distribution.type === "discrete" ? "P(X = k)" : "f(x)") : "F(x)", 0, 0);
  ctx.restore();

  // X axis label
  ctx.fillStyle = colors.textMuted;
  ctx.font = `${11}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(distribution.type === "discrete" ? "k" : "x", plot.x + plot.w / 2, canvasHeight - 4);
}

// ─────────────────────────────────────────────────────────
// Render a distribution curve (continuous or discrete bars)
// ─────────────────────────────────────────────────────────

function renderDistributionCurve(
  ctx: CanvasRenderingContext2D,
  dist: DistributionDef,
  params: number[],
  viewMode: ViewMode,
  xMin: number,
  xMax: number,
  toCanvasX: (x: number) => number,
  toCanvasY: (y: number) => number,
  color: string,
  lineWidth: number,
  isDashed: boolean
): void {
  const evalFn = viewMode === "pdf" ? dist.pdf : dist.cdf;

  if (dist.type === "continuous") {
    const numPoints = 500;
    const step = (xMax - xMin) / numPoints;

    // Fill area under curve (semi-transparent)
    if (!isDashed) {
      ctx.beginPath();
      ctx.moveTo(toCanvasX(xMin), toCanvasY(0));
      for (let i = 0; i <= numPoints; i++) {
        const x = xMin + i * step;
        let y = evalFn(x, params);
        if (!Number.isFinite(y) || y < 0) y = 0;
        ctx.lineTo(toCanvasX(x), toCanvasY(y));
      }
      ctx.lineTo(toCanvasX(xMax), toCanvasY(0));
      ctx.closePath();
      ctx.fillStyle = color + "18";
      ctx.fill();
    }

    // Curve line
    ctx.beginPath();
    if (isDashed) ctx.setLineDash([6, 4]);
    let started = false;
    for (let i = 0; i <= numPoints; i++) {
      const x = xMin + i * step;
      let y = evalFn(x, params);
      if (!Number.isFinite(y) || y < 0) y = 0;
      const cx = toCanvasX(x);
      const cy = toCanvasY(y);
      if (!started) {
        ctx.moveTo(cx, cy);
        started = true;
      } else {
        ctx.lineTo(cx, cy);
      }
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    if (isDashed) ctx.setLineDash([]);
  } else {
    // Discrete: bar chart
    const kMin = Math.max(0, Math.floor(xMin));
    const kMax = Math.ceil(xMax);
    const barWidth = Math.max(2, Math.min(30, (toCanvasX(1) - toCanvasX(0)) * 0.7));

    for (let k = kMin; k <= kMax; k++) {
      let y = evalFn(k, params);
      if (!Number.isFinite(y) || y < 0) y = 0;
      if (y === 0) continue;

      const cx = toCanvasX(k);
      const cy = toCanvasY(y);
      const baseY = toCanvasY(0);

      // Filled bar
      ctx.fillStyle = color + (isDashed ? "30" : "40");
      ctx.fillRect(cx - barWidth / 2, cy, barWidth, baseY - cy);

      // Bar outline
      ctx.strokeStyle = color;
      ctx.lineWidth = isDashed ? 1 : 1.5;
      if (isDashed) ctx.setLineDash([3, 3]);
      ctx.strokeRect(cx - barWidth / 2, cy, barWidth, baseY - cy);
      if (isDashed) ctx.setLineDash([]);

      // Dot at top center
      if (!isDashed) {
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
    }
  }
}

// ─────────────────────────────────────────────────────────
// Render shaded probability area
// ─────────────────────────────────────────────────────────

function renderShadedArea(
  ctx: CanvasRenderingContext2D,
  dist: DistributionDef,
  params: number[],
  viewMode: ViewMode,
  range: [number, number],
  xMin: number,
  xMax: number,
  toCanvasX: (x: number) => number,
  toCanvasY: (y: number) => number,
  color: string
): void {
  const evalFn = viewMode === "pdf" ? dist.pdf : dist.cdf;
  const a = Math.max(range[0], xMin);
  const b = Math.min(range[1], xMax);
  if (a >= b) return;

  const numPoints = 200;
  const step = (b - a) / numPoints;

  ctx.beginPath();
  ctx.moveTo(toCanvasX(a), toCanvasY(0));
  for (let i = 0; i <= numPoints; i++) {
    const x = a + i * step;
    let y = evalFn(x, params);
    if (!Number.isFinite(y) || y < 0) y = 0;
    ctx.lineTo(toCanvasX(x), toCanvasY(y));
  }
  ctx.lineTo(toCanvasX(b), toCanvasY(0));
  ctx.closePath();
  ctx.fillStyle = color + "50";
  ctx.fill();
}

// ─────────────────────────────────────────────────────────
// Render sample histogram
// ─────────────────────────────────────────────────────────

function renderHistogram(
  ctx: CanvasRenderingContext2D,
  sampleData: SampleData,
  toCanvasX: (x: number) => number,
  toCanvasY: (y: number) => number,
  color: string
): void {
  const { bins, counts, maxCount, values } = sampleData;
  if (bins.length < 2 || maxCount === 0) return;

  // Normalize histogram to match PDF scale
  const binWidth = bins[1] - bins[0];
  const totalSamples = values.length;
  const scaleFactor = totalSamples * binWidth;

  for (let i = 0; i < counts.length; i++) {
    const density = counts[i] / scaleFactor;
    if (density === 0) continue;

    const x1 = toCanvasX(bins[i]);
    const x2 = toCanvasX(bins[i + 1]);
    const y = toCanvasY(density);
    const baseY = toCanvasY(0);

    ctx.fillStyle = color + "25";
    ctx.fillRect(x1, y, x2 - x1, baseY - y);
    ctx.strokeStyle = color + "60";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(x1, y, x2 - x1, baseY - y);
  }
}

// ─────────────────────────────────────────────────────────
// Generate sample data with binning
// ─────────────────────────────────────────────────────────

export function computeSampleData(values: number[], numBins: number): SampleData {
  if (values.length === 0) {
    return { values: [], bins: [], counts: [], maxCount: 0 };
  }

  let min = values[0];
  let max = values[0];
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }

  // Handle edge case where all values are the same
  if (min === max) {
    max = min + 1;
    min = min - 1;
  }

  const range = max - min;
  const binWidth = range / numBins;
  const bins: number[] = [];
  const counts: number[] = new Array(numBins).fill(0);

  for (let i = 0; i <= numBins; i++) {
    bins.push(min + i * binWidth);
  }

  for (const v of values) {
    let idx = Math.floor((v - min) / binWidth);
    if (idx >= numBins) idx = numBins - 1;
    if (idx < 0) idx = 0;
    counts[idx]++;
  }

  const maxCount = Math.max(...counts);
  return { values, bins, counts, maxCount };
}
