import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

type StatisticType = "mean" | "median" | "stddev" | "trimmed";
type CiMethod = "percentile" | "bca" | "normal";

interface BootstrapResult {
  stats: number[];
  originalStat: number;
  mean: number;
  se: number;
  bias: number;
}

interface CiResult {
  lower: number;
  upper: number;
  method: string;
}

interface PresetDef {
  label: string;
  data: number[];
  description: string;
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const CANVAS_H = 280;
const DOT_H = 100;
const PAD = { top: 25, right: 25, bottom: 40, left: 50 };
const HIST_BINS = 50;

const COLORS = {
  hist: "rgba(79, 143, 247, 0.4)",
  histStroke: "#4f8ff7",
  original: "#f59e0b",
  ciPercentile: "#34d399",
  ciBca: "#a78bfa",
  ciNormal: "#fb923c",
  dot: "#4f8ff7",
  dotHighlight: "#f59e0b",
  dotDuplicate: "#ef4444",
  grid: "rgba(161, 161, 170, 0.12)",
  axis: "rgba(161, 161, 170, 0.5)",
  classical: "#ef4444",
  bootstrap: "#4f8ff7",
  buildUp: "rgba(79, 143, 247, 0.25)",
};

const PRESETS: PresetDef[] = [
  {
    label: "Exam scores",
    data: [72, 85, 90, 68, 78, 88, 91, 76, 82, 73, 95, 69, 87, 80, 74, 83, 79, 86, 92, 71],
    description: "20 exam scores (roughly normal)",
  },
  {
    label: "Income data",
    data: [
      32000, 35000, 38000, 40000, 41000, 42000, 44000, 45000, 46000, 47000,
      48000, 50000, 52000, 54000, 56000, 58000, 62000, 68000, 75000, 82000,
      95000, 110000, 125000, 150000, 180000, 220000, 280000, 350000, 420000, 500000,
    ],
    description: "30 incomes (right-skewed)",
  },
  {
    label: "Reaction times",
    data: [215, 228, 234, 241, 245, 252, 258, 263, 270, 285, 298, 312, 345, 378, 425],
    description: "15 reaction times in ms (slightly skewed)",
  },
];

// ─────────────────────────────────────────────────────────
// Math helpers
// ─────────────────────────────────────────────────────────

function mean(data: number[]): number {
  if (data.length === 0) return 0;
  return data.reduce((s, v) => s + v, 0) / data.length;
}

function median(data: number[]): number {
  if (data.length === 0) return 0;
  const sorted = [...data].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stddev(data: number[]): number {
  if (data.length < 2) return 0;
  const m = mean(data);
  const variance = data.reduce((s, v) => s + (v - m) * (v - m), 0) / (data.length - 1);
  return Math.sqrt(variance);
}

function trimmedMean(data: number[], trimFraction: number): number {
  if (data.length === 0) return 0;
  const sorted = [...data].sort((a, b) => a - b);
  const trimCount = Math.floor(sorted.length * trimFraction);
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
  return trimmed.length > 0 ? mean(trimmed) : mean(sorted);
}

function computeStatistic(data: number[], type: StatisticType): number {
  switch (type) {
    case "mean": return mean(data);
    case "median": return median(data);
    case "stddev": return stddev(data);
    case "trimmed": return trimmedMean(data, 0.1);
  }
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

function normalCdf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0,
    -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0,
  ];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= pHigh) {
    q = p - 0.5; r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
            ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
}

function tQuantile(p: number, df: number): number {
  if (df >= 100) return normalQuantile(p);
  let lo = -20, hi = 20;
  const tCdfLocal = (x: number): number => {
    if (df <= 0) return 0;
    const bx = df / (df + x * x);
    const ib = incompleteBetaLocal(bx, df / 2, 0.5);
    return x >= 0 ? 1 - 0.5 * ib : 0.5 * ib;
  };
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (tCdfLocal(mid) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function logGamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  let x = c[0];
  for (let i = 1; i < 9; i++) x += c[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function incompleteBetaLocal(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;
  let d2 = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d2) < 1e-30) d2 = 1e-30;
  d2 = 1 / d2;
  let h = d2;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((a - 1 + m2) * (a + m2));
    d2 = 1 + aa * d2; if (Math.abs(d2) < 1e-30) d2 = 1e-30; d2 = 1 / d2;
    let c2 = 1 + aa / 1; if (Math.abs(c2) < 1e-30) c2 = 1e-30;
    h *= d2 * c2;
    aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + 1 + m2));
    d2 = 1 + aa * d2; if (Math.abs(d2) < 1e-30) d2 = 1e-30; d2 = 1 / d2;
    c2 = 1 + aa / c2; if (Math.abs(c2) < 1e-30) c2 = 1e-30;
    h *= d2 * c2;
    if (Math.abs(d2 * c2 - 1) < 1e-12) break;
  }
  return Math.min(1, Math.max(0, front * h));
}

// ─────────────────────────────────────────────────────────
// Bootstrap engine
// ─────────────────────────────────────────────────────────

function resample(data: number[]): number[] {
  const n = data.length;
  const result = new Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = data[Math.floor(Math.random() * n)];
  }
  return result;
}

function runBootstrap(
  data: number[],
  statType: StatisticType,
  nResamples: number
): BootstrapResult {
  const originalStat = computeStatistic(data, statType);
  const stats: number[] = [];
  for (let i = 0; i < nResamples; i++) {
    const sample = resample(data);
    stats.push(computeStatistic(sample, statType));
  }
  stats.sort((a, b) => a - b);
  const m = mean(stats);
  const se = stddev(stats);
  const bias = m - originalStat;
  return { stats, originalStat, mean: m, se, bias };
}

function computePercentileCi(stats: number[], level: number): CiResult {
  const alpha = (1 - level) / 2;
  const lower = quantile(stats, alpha);
  const upper = quantile(stats, 1 - alpha);
  return { lower, upper, method: "Percentile" };
}

function computeNormalCi(result: BootstrapResult, level: number): CiResult {
  const z = normalQuantile(1 - (1 - level) / 2);
  return {
    lower: result.originalStat - z * result.se,
    upper: result.originalStat + z * result.se,
    method: "Normal approx.",
  };
}

function computeBcaCi(
  data: number[],
  statType: StatisticType,
  result: BootstrapResult,
  level: number
): CiResult {
  const { stats, originalStat } = result;
  const n = stats.length;
  const propLess = stats.filter((s) => s < originalStat).length / n;
  const z0 = normalQuantile(Math.max(0.001, Math.min(0.999, propLess)));

  const thetaDot = mean(
    data.map((_, i) => {
      const jackknife = [...data.slice(0, i), ...data.slice(i + 1)];
      return computeStatistic(jackknife, statType);
    })
  );
  const diffs = data.map((_, i) => {
    const jackknife = [...data.slice(0, i), ...data.slice(i + 1)];
    return thetaDot - computeStatistic(jackknife, statType);
  });
  const sumCubed = diffs.reduce((s, d) => s + d * d * d, 0);
  const sumSquared = diffs.reduce((s, d) => s + d * d, 0);
  const a = sumCubed / (6 * Math.pow(sumSquared, 1.5) + 1e-30);

  const alphaLo = (1 - level) / 2;
  const alphaHi = 1 - alphaLo;
  const zAlphaLo = normalQuantile(alphaLo);
  const zAlphaHi = normalQuantile(alphaHi);

  const adj1 = normalCdf(z0 + (z0 + zAlphaLo) / (1 - a * (z0 + zAlphaLo)));
  const adj2 = normalCdf(z0 + (z0 + zAlphaHi) / (1 - a * (z0 + zAlphaHi)));

  return {
    lower: quantile(stats, Math.max(0.001, Math.min(0.999, adj1))),
    upper: quantile(stats, Math.max(0.001, Math.min(0.999, adj2))),
    method: "BCa",
  };
}

function classicalCi(data: number[], level: number): CiResult {
  const n = data.length;
  const m = mean(data);
  const s = stddev(data);
  const df = n - 1;
  const t = tQuantile(1 - (1 - level) / 2, df);
  return {
    lower: m - t * s / Math.sqrt(n),
    upper: m + t * s / Math.sqrt(n),
    method: "Classical (t)",
  };
}

// ─────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────

function getColors(canvas: HTMLCanvasElement): { text: string; muted: string } {
  const cs = getComputedStyle(canvas);
  return {
    text: cs.getPropertyValue("--color-text").trim() || "#e4e4e7",
    muted: cs.getPropertyValue("--color-text-muted").trim() || "#a1a1aa",
  };
}

function drawDotPlot(canvas: HTMLCanvasElement, data: number[], highlighted: number[] | null) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const cl = getColors(canvas);

  if (data.length === 0) return;

  const sorted = [...data].sort((a, b) => a - b);
  const dMin = sorted[0];
  const dMax = sorted[sorted.length - 1];
  const range = dMax - dMin || 1;
  const plotW = w - PAD.left - PAD.right;
  const toX = (v: number) => PAD.left + ((v - dMin + range * 0.05) / (range * 1.1)) * plotW;

  // Axis
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD.left, h - PAD.bottom);
  ctx.lineTo(PAD.left + plotW, h - PAD.bottom);
  ctx.stroke();

  // Tick labels
  ctx.fillStyle = cl.muted;
  ctx.font = "10px Inter, sans-serif";
  ctx.textAlign = "center";
  const tickCount = Math.min(8, data.length);
  for (let i = 0; i <= tickCount; i++) {
    const v = dMin + (i / tickCount) * range;
    ctx.fillText(v.toFixed(1), toX(v), h - PAD.bottom + 14);
  }

  // Count duplicates for stacking
  const countMap = new Map<number, number>();
  const highlightCountMap = new Map<number, number>();
  if (highlighted) {
    for (const v of highlighted) {
      highlightCountMap.set(v, (highlightCountMap.get(v) || 0) + 1);
    }
  }

  const radius = Math.min(6, Math.max(3, plotW / data.length / 2.5));
  const dotY = h - PAD.bottom - radius - 4;
  const stackMap = new Map<string, number>();

  for (const v of sorted) {
    const bucket = Math.round(toX(v));
    const key = String(bucket);
    const stack = stackMap.get(key) || 0;
    stackMap.set(key, stack + 1);
    const px = toX(v);
    const py = dotY - stack * (radius * 2.2);

    let isHighlighted = false;
    let isDuplicate = false;
    if (highlighted) {
      const hCount = highlightCountMap.get(v) || 0;
      if (hCount > 0) {
        isHighlighted = true;
        isDuplicate = hCount > 1;
        highlightCountMap.set(v, hCount - 1);
      }
    }

    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    if (isHighlighted) {
      ctx.fillStyle = isDuplicate ? COLORS.dotDuplicate : COLORS.dotHighlight;
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = COLORS.dot;
      ctx.globalAlpha = highlighted ? 0.25 : 0.7;
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawHistogram(
  canvas: HTMLCanvasElement,
  stats: number[],
  originalStat: number,
  ci: CiResult | null,
  ciMethod: CiMethod,
  builtCount: number,
  singleResampleStat: number | null
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const cl = getColors(canvas);

  const visibleStats = stats.slice(0, builtCount);
  if (visibleStats.length === 0) return;

  const allVals = [...visibleStats, originalStat];
  const sMin = Math.min(...allVals);
  const sMax = Math.max(...allVals);
  const range = sMax - sMin || 1;
  const binWidth = (range * 1.1) / HIST_BINS;
  const plotW = w - PAD.left - PAD.right;
  const plotH = h - PAD.top - PAD.bottom;
  const xStart = sMin - range * 0.05;

  const bins = new Array(HIST_BINS).fill(0);
  for (const s of visibleStats) {
    const idx = Math.min(HIST_BINS - 1, Math.max(0, Math.floor((s - xStart) / binWidth)));
    bins[idx]++;
  }
  const maxBin = Math.max(...bins, 1);

  const toX = (v: number) => PAD.left + ((v - xStart) / (range * 1.1)) * plotW;
  const toY = (count: number) => PAD.top + plotH - (count / maxBin) * plotH;

  // Grid
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const py = PAD.top + (i / 4) * plotH;
    ctx.beginPath(); ctx.moveTo(PAD.left, py); ctx.lineTo(PAD.left + plotW, py); ctx.stroke();
  }

  // Axes
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(PAD.left, PAD.top + plotH); ctx.lineTo(PAD.left + plotW, PAD.top + plotH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(PAD.left, PAD.top); ctx.lineTo(PAD.left, PAD.top + plotH); ctx.stroke();

  // Histogram bars
  for (let i = 0; i < HIST_BINS; i++) {
    if (bins[i] === 0) continue;
    const bx = toX(xStart + i * binWidth);
    const bw = (binWidth / (range * 1.1)) * plotW;
    const by = toY(bins[i]);
    const bh = PAD.top + plotH - by;

    ctx.fillStyle = COLORS.hist;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = COLORS.histStroke;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(bx, by, bw, bh);
  }

  // CI shading
  if (ci) {
    const ciColor = ciMethod === "percentile" ? COLORS.ciPercentile
      : ciMethod === "bca" ? COLORS.ciBca
      : COLORS.ciNormal;
    const ciX1 = Math.max(PAD.left, toX(ci.lower));
    const ciX2 = Math.min(PAD.left + plotW, toX(ci.upper));

    ctx.fillStyle = ciColor.replace(")", ", 0.12)").replace("rgb", "rgba").replace("rgba", "rgba");
    // Simple semi-transparent fill
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = ciColor;
    ctx.fillRect(ciX1, PAD.top, ciX2 - ciX1, plotH);
    ctx.restore();

    // CI boundary lines
    ctx.strokeStyle = ciColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.beginPath(); ctx.moveTo(ciX1, PAD.top); ctx.lineTo(ciX1, PAD.top + plotH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ciX2, PAD.top); ctx.lineTo(ciX2, PAD.top + plotH); ctx.stroke();
    ctx.setLineDash([]);

    // CI labels
    ctx.fillStyle = ciColor;
    ctx.font = "bold 11px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText(ci.lower.toFixed(2), ciX1, PAD.top - 4);
    ctx.fillText(ci.upper.toFixed(2), ciX2, PAD.top - 4);
  }

  // Original statistic line
  const origX = toX(originalStat);
  ctx.strokeStyle = COLORS.original;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(origX, PAD.top); ctx.lineTo(origX, PAD.top + plotH); ctx.stroke();
  ctx.fillStyle = COLORS.original;
  ctx.font = "bold 11px Inter, sans-serif";
  ctx.textAlign = origX > w / 2 ? "right" : "left";
  const origOffset = origX > w / 2 ? -6 : 6;
  ctx.fillText(`Original: ${originalStat.toFixed(2)}`, origX + origOffset, PAD.top + 14);

  // Single resample stat indicator
  if (singleResampleStat !== null) {
    const srX = toX(singleResampleStat);
    ctx.fillStyle = COLORS.dotHighlight;
    ctx.beginPath();
    ctx.arc(srX, PAD.top + plotH + 8, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(singleResampleStat.toFixed(2), srX, PAD.top + plotH + 24);
  }

  // X-axis labels
  ctx.fillStyle = cl.muted;
  ctx.font = "10px Inter, sans-serif";
  ctx.textAlign = "center";
  const xTicks = 6;
  for (let i = 0; i <= xTicks; i++) {
    const v = xStart + (i / xTicks) * range * 1.1;
    ctx.fillText(v.toFixed(1), toX(v), PAD.top + plotH + 16);
  }

  // Count label
  ctx.fillStyle = cl.muted;
  ctx.textAlign = "right";
  ctx.fillText(`n = ${builtCount}`, PAD.left + plotW, PAD.top + 14);
}

function drawComparisonBars(
  canvas: HTMLCanvasElement,
  bootstrapCi: CiResult | null,
  classicalCiResult: CiResult | null,
  originalStat: number
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const cl = getColors(canvas);

  if (!bootstrapCi || !classicalCiResult) return;

  const allVals = [
    bootstrapCi.lower, bootstrapCi.upper,
    classicalCiResult.lower, classicalCiResult.upper,
    originalStat,
  ];
  const vMin = Math.min(...allVals);
  const vMax = Math.max(...allVals);
  const range = vMax - vMin || 1;
  const plotW = w - PAD.left - PAD.right;
  const toX = (v: number) => PAD.left + ((v - vMin + range * 0.1) / (range * 1.2)) * plotW;

  const barH = 24;
  const gap = 20;
  const y1 = 30;
  const y2 = y1 + barH + gap;

  // Classical CI bar
  ctx.fillStyle = "rgba(239, 68, 68, 0.2)";
  const cx1 = toX(classicalCiResult.lower);
  const cx2 = toX(classicalCiResult.upper);
  ctx.fillRect(cx1, y1, cx2 - cx1, barH);
  ctx.strokeStyle = COLORS.classical;
  ctx.lineWidth = 2;
  ctx.strokeRect(cx1, y1, cx2 - cx1, barH);
  ctx.fillStyle = cl.text;
  ctx.font = "12px Inter, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Classical (t)", PAD.left, y1 - 6);
  ctx.font = "10px JetBrains Mono, monospace";
  ctx.fillStyle = cl.muted;
  ctx.textAlign = "center";
  ctx.fillText(classicalCiResult.lower.toFixed(2), cx1, y1 + barH + 14);
  ctx.fillText(classicalCiResult.upper.toFixed(2), cx2, y1 + barH + 14);

  // Bootstrap CI bar
  ctx.fillStyle = "rgba(79, 143, 247, 0.2)";
  const bx1 = toX(bootstrapCi.lower);
  const bx2 = toX(bootstrapCi.upper);
  ctx.fillRect(bx1, y2, bx2 - bx1, barH);
  ctx.strokeStyle = COLORS.bootstrap;
  ctx.lineWidth = 2;
  ctx.strokeRect(bx1, y2, bx2 - bx1, barH);
  ctx.fillStyle = cl.text;
  ctx.font = "12px Inter, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`Bootstrap (${bootstrapCi.method})`, PAD.left, y2 - 6);
  ctx.font = "10px JetBrains Mono, monospace";
  ctx.fillStyle = cl.muted;
  ctx.textAlign = "center";
  ctx.fillText(bootstrapCi.lower.toFixed(2), bx1, y2 + barH + 14);
  ctx.fillText(bootstrapCi.upper.toFixed(2), bx2, y2 + barH + 14);

  // Original stat marker
  const origX = toX(originalStat);
  ctx.strokeStyle = COLORS.original;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(origX, y1 - 10); ctx.lineTo(origX, y2 + barH + 18); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = COLORS.original;
  ctx.font = "10px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`\u0078\u0304 = ${originalStat.toFixed(2)}`, origX, y1 - 14);
}

// ─────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────

const panelStyle: Record<string, string> = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "12px",
  padding: "16px",
  marginBottom: "12px",
};

const labelStyle: Record<string, string> = {
  color: "var(--color-text-muted)",
  fontSize: "12px",
  fontWeight: "600",
  display: "block",
  marginBottom: "4px",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const inputStyle: Record<string, string> = {
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: "6px",
  color: "var(--color-text)",
  padding: "6px 10px",
  fontSize: "14px",
  width: "100%",
  outline: "none",
  fontFamily: "JetBrains Mono, monospace",
};

const btnBase: Record<string, string> = {
  padding: "6px 14px",
  borderRadius: "6px",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  fontSize: "13px",
  cursor: "pointer",
  fontWeight: "500",
  transition: "all 0.15s",
};

const btnPrimary: Record<string, string> = {
  ...btnBase,
  background: "var(--color-primary)",
  color: "#fff",
  borderColor: "var(--color-primary)",
};

const btnActive: Record<string, string> = {
  ...btnBase,
  background: "var(--color-primary)",
  color: "#fff",
  borderColor: "var(--color-primary)",
};

const statCardStyle: Record<string, string> = {
  background: "var(--color-bg)",
  borderRadius: "8px",
  padding: "10px 14px",
  textAlign: "center",
};

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

export default function BootstrapResampling() {
  const [rawInput, setRawInput] = useState(PRESETS[0].data.join(", "));
  const [statType, setStatType] = useState<StatisticType>("mean");
  const [nResamples, setNResamples] = useState(1000);
  const [ciLevel, setCiLevel] = useState(0.95);
  const [ciMethod, setCiMethod] = useState<CiMethod>("percentile");

  const [bootstrapResult, setBootstrapResult] = useState<BootstrapResult | null>(null);
  const [builtCount, setBuiltCount] = useState(0);
  const [running, setRunning] = useState(false);
  const [animSpeed, setAnimSpeed] = useState(50);

  const [singleResample, setSingleResample] = useState<number[] | null>(null);
  const [singleResampleStat, setSingleResampleStat] = useState<number | null>(null);

  const dotCanvasRef = useRef<HTMLCanvasElement>(null);
  const histCanvasRef = useRef<HTMLCanvasElement>(null);
  const compCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasW, setCanvasW] = useState(600);
  const animFrameRef = useRef(0);
  const runningRef = useRef(false);

  const data = useMemo(() => {
    return rawInput
      .split(/[,\s]+/)
      .map(Number)
      .filter((n) => !isNaN(n) && isFinite(n));
  }, [rawInput]);

  const originalStats = useMemo(() => {
    if (data.length === 0) return { n: 0, mean: 0, median: 0, stddev: 0 };
    return {
      n: data.length,
      mean: mean(data),
      median: median(data),
      stddev: stddev(data),
    };
  }, [data]);

  // Responsive
  useEffect(() => {
    function resize() {
      if (containerRef.current) setCanvasW(containerRef.current.clientWidth);
    }
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // Draw dot plot
  useEffect(() => {
    if (dotCanvasRef.current) {
      drawDotPlot(dotCanvasRef.current, data, singleResample);
    }
  }, [data, singleResample, canvasW]);

  // Compute CI
  const ci = useMemo((): CiResult | null => {
    if (!bootstrapResult || bootstrapResult.stats.length === 0) return null;
    const visibleStats = bootstrapResult.stats.slice(0, builtCount);
    if (visibleStats.length < 10) return null;
    const sorted = [...visibleStats].sort((a, b) => a - b);
    switch (ciMethod) {
      case "percentile":
        return computePercentileCi(sorted, ciLevel);
      case "bca":
        return computeBcaCi(data, statType, { ...bootstrapResult, stats: sorted }, ciLevel);
      case "normal":
        return computeNormalCi({ ...bootstrapResult, stats: sorted, se: stddev(sorted), mean: mean(sorted) }, ciLevel);
    }
  }, [bootstrapResult, builtCount, ciMethod, ciLevel, data, statType]);

  const classicalCiResult = useMemo((): CiResult | null => {
    if (data.length < 3) return null;
    return classicalCi(data, ciLevel);
  }, [data, ciLevel]);

  // Draw histogram
  useEffect(() => {
    if (histCanvasRef.current && bootstrapResult) {
      drawHistogram(
        histCanvasRef.current,
        bootstrapResult.stats,
        bootstrapResult.originalStat,
        ci,
        ciMethod,
        builtCount,
        singleResampleStat
      );
    }
  }, [bootstrapResult, builtCount, ci, ciMethod, singleResampleStat, canvasW]);

  // Draw comparison
  useEffect(() => {
    if (compCanvasRef.current && ci && classicalCiResult) {
      drawComparisonBars(compCanvasRef.current, ci, classicalCiResult, bootstrapResult?.originalStat ?? mean(data));
    }
  }, [ci, classicalCiResult, bootstrapResult, data, canvasW]);

  const runBootstrapAnimated = useCallback(() => {
    if (data.length < 2) return;
    runningRef.current = true;
    setRunning(true);
    setSingleResample(null);
    setSingleResampleStat(null);

    const result = runBootstrap(data, statType, nResamples);
    setBootstrapResult(result);
    setBuiltCount(0);

    let count = 0;
    const batchSize = Math.max(1, Math.floor(animSpeed));

    function step() {
      if (!runningRef.current) return;
      count = Math.min(count + batchSize, result.stats.length);
      setBuiltCount(count);
      if (count < result.stats.length) {
        animFrameRef.current = requestAnimationFrame(step);
      } else {
        setRunning(false);
        runningRef.current = false;
      }
    }
    animFrameRef.current = requestAnimationFrame(step);
  }, [data, statType, nResamples, animSpeed]);

  const stopBootstrap = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    cancelAnimationFrame(animFrameRef.current);
    if (bootstrapResult) {
      setBuiltCount(bootstrapResult.stats.length);
    }
  }, [bootstrapResult]);

  const showOneResample = useCallback(() => {
    if (data.length < 2) return;
    const sample = resample(data);
    const stat = computeStatistic(sample, statType);
    setSingleResample(sample);
    setSingleResampleStat(stat);
  }, [data, statType]);

  const applyPreset = useCallback((preset: PresetDef) => {
    setRawInput(preset.data.join(", "));
    setBootstrapResult(null);
    setBuiltCount(0);
    setSingleResample(null);
    setSingleResampleStat(null);
  }, []);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      runningRef.current = false;
    };
  }, []);

  const statLabels: Record<StatisticType, string> = {
    mean: "Mean",
    median: "Median",
    stddev: "Std Dev",
    trimmed: "Trimmed Mean (10%)",
  };

  const ciMethodLabels: Record<CiMethod, string> = {
    percentile: "Percentile",
    bca: "BCa",
    normal: "Normal approx.",
  };

  const progressPct = bootstrapResult ? Math.round((builtCount / bootstrapResult.stats.length) * 100) : 0;

  return (
    <div ref={containerRef} style={{ color: "var(--color-text)", fontFamily: "Inter, sans-serif" }}>
      {/* Presets */}
      <div style={panelStyle}>
        <span style={{ ...labelStyle, marginBottom: "8px" }}>Preset Datasets</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {PRESETS.map((p) => (
            <button key={p.label} style={btnBase} onClick={() => applyPreset(p)} title={p.description}>
              {p.label}
            </button>
          ))}
          <button
            style={btnBase}
            onClick={() => { setRawInput(""); setBootstrapResult(null); setBuiltCount(0); }}
          >
            Custom
          </button>
        </div>
      </div>

      {/* Data input */}
      <div style={panelStyle}>
        <label style={labelStyle}>Data (comma-separated numbers)</label>
        <textarea
          style={{ ...inputStyle, minHeight: "60px", resize: "vertical" }}
          value={rawInput}
          onInput={(e) => {
            setRawInput((e.target as HTMLTextAreaElement).value);
            setBootstrapResult(null);
            setBuiltCount(0);
          }}
          placeholder="Enter numbers separated by commas..."
        />
        {data.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "8px", marginTop: "10px" }}>
            <div style={statCardStyle}>
              <div style={{ color: "var(--color-text-muted)", fontSize: "10px" }}>n</div>
              <div style={{ color: "var(--color-heading)", fontWeight: "700", fontFamily: "JetBrains Mono, monospace" }}>{originalStats.n}</div>
            </div>
            <div style={statCardStyle}>
              <div style={{ color: "var(--color-text-muted)", fontSize: "10px" }}>Mean</div>
              <div style={{ color: "var(--color-heading)", fontWeight: "700", fontFamily: "JetBrains Mono, monospace" }}>{originalStats.mean.toFixed(2)}</div>
            </div>
            <div style={statCardStyle}>
              <div style={{ color: "var(--color-text-muted)", fontSize: "10px" }}>Median</div>
              <div style={{ color: "var(--color-heading)", fontWeight: "700", fontFamily: "JetBrains Mono, monospace" }}>{originalStats.median.toFixed(2)}</div>
            </div>
            <div style={statCardStyle}>
              <div style={{ color: "var(--color-text-muted)", fontSize: "10px" }}>Std Dev</div>
              <div style={{ color: "var(--color-heading)", fontWeight: "700", fontFamily: "JetBrains Mono, monospace" }}>{originalStats.stddev.toFixed(2)}</div>
            </div>
          </div>
        )}
      </div>

      {/* Dot plot */}
      {data.length > 0 && (
        <div style={{ ...panelStyle, padding: "0", overflow: "hidden" }}>
          <canvas
            ref={dotCanvasRef}
            style={{ width: "100%", height: `${DOT_H}px`, display: "block" }}
          />
        </div>
      )}

      {/* Bootstrap controls */}
      <div style={panelStyle}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px" }}>
          <div>
            <label style={labelStyle}>Statistic</label>
            <select
              style={inputStyle}
              value={statType}
              onInput={(e) => {
                setStatType((e.target as HTMLSelectElement).value as StatisticType);
                setBootstrapResult(null);
                setBuiltCount(0);
              }}
            >
              {(Object.keys(statLabels) as StatisticType[]).map((s) => (
                <option key={s} value={s}>{statLabels[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Resamples: {nResamples.toLocaleString()}</label>
            <input
              type="range"
              min="100"
              max="10000"
              step="100"
              value={nResamples}
              onInput={(e) => setNResamples(Number((e.target as HTMLInputElement).value))}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={labelStyle}>Animation speed: {animSpeed}</label>
            <input
              type="range"
              min="1"
              max="200"
              step="1"
              value={animSpeed}
              onInput={(e) => setAnimSpeed(Number((e.target as HTMLInputElement).value))}
              style={{ width: "100%" }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", marginTop: "16px", flexWrap: "wrap" }}>
          {!running ? (
            <button
              style={data.length < 2 ? { ...btnPrimary, opacity: "0.5", cursor: "not-allowed" } : btnPrimary}
              onClick={runBootstrapAnimated}
              disabled={data.length < 2}
            >
              Run Bootstrap
            </button>
          ) : (
            <button style={{ ...btnBase, borderColor: "#ef4444", color: "#ef4444" }} onClick={stopBootstrap}>
              Stop (show all)
            </button>
          )}
          <button
            style={data.length < 2 ? { ...btnBase, opacity: "0.5", cursor: "not-allowed" } : btnBase}
            onClick={showOneResample}
            disabled={data.length < 2}
          >
            Show one resample
          </button>
        </div>

        {/* Progress bar */}
        {running && (
          <div style={{ marginTop: "12px" }}>
            <div style={{
              background: "var(--color-bg)",
              borderRadius: "4px",
              height: "8px",
              overflow: "hidden",
            }}>
              <div style={{
                background: "var(--color-primary)",
                height: "100%",
                width: `${progressPct}%`,
                borderRadius: "4px",
                transition: "width 0.1s",
              }} />
            </div>
            <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: "4px" }}>
              {builtCount.toLocaleString()} / {nResamples.toLocaleString()} resamples ({progressPct}%)
            </div>
          </div>
        )}
      </div>

      {/* Single resample viewer */}
      {singleResample && (
        <div style={{ ...panelStyle, borderColor: COLORS.dotHighlight }}>
          <span style={{ ...labelStyle, color: COLORS.dotHighlight }}>Single Resample</span>
          <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginBottom: "8px" }}>
            Data points highlighted on the dot plot above. <span style={{ color: COLORS.dotDuplicate }}>Red</span> dots appear more than once (duplicates from sampling with replacement).
          </div>
          <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "var(--color-text)", wordBreak: "break-all" }}>
            [{singleResample.map((v) => v.toFixed(1)).join(", ")}]
          </div>
          <div style={{ marginTop: "8px", display: "flex", gap: "16px" }}>
            <span style={{ fontSize: "13px" }}>
              <strong style={{ color: "var(--color-heading)" }}>{statLabels[statType]}:</strong>{" "}
              <span style={{ color: COLORS.dotHighlight, fontFamily: "JetBrains Mono, monospace" }}>{singleResampleStat?.toFixed(4)}</span>
            </span>
            <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
              Original: {computeStatistic(data, statType).toFixed(4)}
            </span>
          </div>
        </div>
      )}

      {/* Bootstrap distribution histogram */}
      {bootstrapResult && (
        <>
          <div style={panelStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "10px" }}>
              <span style={labelStyle}>Bootstrap Distribution</span>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: "11px", color: "var(--color-text-muted)", marginRight: "4px" }}>CI Method:</span>
                {(Object.keys(ciMethodLabels) as CiMethod[]).map((m) => (
                  <button
                    key={m}
                    style={ciMethod === m ? btnActive : btnBase}
                    onClick={() => setCiMethod(m)}
                  >
                    {ciMethodLabels[m]}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: "10px" }}>
              <label style={{ ...labelStyle, display: "inline" }}>
                CI Level: {(ciLevel * 100).toFixed(0)}%
              </label>
              <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                {[0.80, 0.90, 0.95, 0.99].map((lv) => (
                  <button
                    key={lv}
                    style={ciLevel === lv ? btnActive : btnBase}
                    onClick={() => setCiLevel(lv)}
                  >
                    {(lv * 100).toFixed(0)}%
                  </button>
                ))}
              </div>
            </div>
            <div style={{ overflow: "hidden", borderRadius: "8px" }}>
              <canvas
                ref={histCanvasRef}
                style={{ width: "100%", height: `${CANVAS_H}px`, display: "block" }}
              />
            </div>
          </div>

          {/* Bootstrap stats */}
          {builtCount > 10 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px", marginBottom: "12px" }}>
              <div style={{ ...statCardStyle, background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
                <div style={{ color: "var(--color-text-muted)", fontSize: "10px" }}>Boot. Mean</div>
                <div style={{ color: "var(--color-heading)", fontSize: "16px", fontWeight: "700", fontFamily: "JetBrains Mono, monospace" }}>
                  {mean(bootstrapResult.stats.slice(0, builtCount)).toFixed(4)}
                </div>
              </div>
              <div style={{ ...statCardStyle, background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
                <div style={{ color: "var(--color-text-muted)", fontSize: "10px" }}>Boot. SE</div>
                <div style={{ color: "var(--color-heading)", fontSize: "16px", fontWeight: "700", fontFamily: "JetBrains Mono, monospace" }}>
                  {stddev(bootstrapResult.stats.slice(0, builtCount)).toFixed(4)}
                </div>
              </div>
              <div style={{ ...statCardStyle, background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
                <div style={{ color: "var(--color-text-muted)", fontSize: "10px" }}>Bias</div>
                <div style={{ color: "var(--color-heading)", fontSize: "16px", fontWeight: "700", fontFamily: "JetBrains Mono, monospace" }}>
                  {(mean(bootstrapResult.stats.slice(0, builtCount)) - bootstrapResult.originalStat).toFixed(4)}
                </div>
              </div>
              {ci && (
                <div style={{ ...statCardStyle, background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "10px" }}>{(ciLevel * 100).toFixed(0)}% CI ({ci.method})</div>
                  <div style={{ color: "var(--color-accent)", fontSize: "13px", fontWeight: "700", fontFamily: "JetBrains Mono, monospace" }}>
                    [{ci.lower.toFixed(2)}, {ci.upper.toFixed(2)}]
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Comparison panel */}
          {builtCount > 10 && classicalCiResult && statType === "mean" && (
            <div style={panelStyle}>
              <span style={{ ...labelStyle, marginBottom: "8px" }}>Bootstrap vs. Classical CI</span>
              <canvas
                ref={compCanvasRef}
                style={{ width: "100%", height: "130px", display: "block" }}
              />
              <div style={{ marginTop: "12px", fontSize: "13px", lineHeight: "1.7", color: "var(--color-text-muted)" }}>
                <p style={{ marginBottom: "6px" }}>
                  <strong style={{ color: COLORS.classical }}>Classical (t-based)</strong>: Assumes the sampling distribution of the mean is approximately normal. Works well for large samples from symmetric distributions.
                </p>
                <p>
                  <strong style={{ color: COLORS.bootstrap }}>Bootstrap</strong>: Makes no distributional assumptions. Outperforms classical when data is skewed, sample size is small, or you are estimating a statistic other than the mean (e.g., median, trimmed mean).
                </p>
              </div>
            </div>
          )}

          {statType !== "mean" && builtCount > 10 && (
            <div style={{ ...panelStyle, fontSize: "13px", lineHeight: "1.7", color: "var(--color-text-muted)" }}>
              <span style={{ ...labelStyle, marginBottom: "8px" }}>Why Bootstrap?</span>
              <p>
                Classical confidence intervals assume a specific sampling distribution and are typically derived for the <strong style={{ color: "var(--color-heading)" }}>mean</strong>.
                For statistics like the <strong style={{ color: "var(--color-primary)" }}>{statLabels[statType].toLowerCase()}</strong>,
                there is no simple closed-form CI. Bootstrap provides a distribution-free way to estimate
                confidence intervals for <em>any</em> statistic, making it especially valuable for medians, trimmed means, ratios, and other non-standard estimators.
              </p>
            </div>
          )}
        </>
      )}

      {/* Educational footer */}
      <div style={{ ...panelStyle, fontSize: "13px", lineHeight: "1.7", color: "var(--color-text-muted)" }}>
        <span style={{ ...labelStyle, marginBottom: "8px" }}>How Bootstrap Works</span>
        <ol style={{ paddingLeft: "20px", margin: "0" }}>
          <li style={{ marginBottom: "6px" }}>
            <strong style={{ color: "var(--color-heading)" }}>Start with your sample</strong> of n observations.
          </li>
          <li style={{ marginBottom: "6px" }}>
            <strong style={{ color: "var(--color-heading)" }}>Resample with replacement</strong>: draw n values from your sample, allowing repeats. Some points appear multiple times, some not at all.
          </li>
          <li style={{ marginBottom: "6px" }}>
            <strong style={{ color: "var(--color-heading)" }}>Compute your statistic</strong> (mean, median, etc.) on the resample.
          </li>
          <li style={{ marginBottom: "6px" }}>
            <strong style={{ color: "var(--color-heading)" }}>Repeat B times</strong> (typically 1,000-10,000) to build the bootstrap distribution.
          </li>
          <li>
            <strong style={{ color: "var(--color-heading)" }}>Extract the CI</strong> from the bootstrap distribution using percentiles, BCa, or normal approximation.
          </li>
        </ol>
      </div>
    </div>
  );
}
