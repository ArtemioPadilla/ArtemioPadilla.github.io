import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

type TestType = "z-one" | "t-one" | "t-two" | "chi-sq";
type TailType = "two" | "left" | "right";
type TabId = "test" | "power";

interface TestParams {
  sampleMean: number;
  sampleStd: number;
  sampleSize: number;
  hypMean: number;
  sampleMean2: number;
  sampleStd2: number;
  sampleSize2: number;
  observed: number[];
  expected: number[];
}

interface TestResult {
  statistic: number;
  pValue: number;
  criticalLow: number | null;
  criticalHigh: number | null;
  reject: boolean;
  ci: [number, number] | null;
  df: number | null;
}

interface PresetDef {
  label: string;
  testType: TestType;
  tail: TailType;
  alpha: number;
  params: Partial<TestParams>;
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const CANVAS_H = 300;
const PAD = { top: 30, right: 30, bottom: 45, left: 55 };
const CURVE_PTS = 400;

const COLORS = {
  curve: "#4f8ff7",
  reject: "rgba(239, 68, 68, 0.35)",
  rejectStroke: "#ef4444",
  pValue: "rgba(79, 143, 247, 0.30)",
  pStroke: "#4f8ff7",
  statLine: "#f59e0b",
  grid: "rgba(161, 161, 170, 0.12)",
  axis: "rgba(161, 161, 170, 0.5)",
  nullDist: "#4f8ff7",
  altDist: "#34d399",
  typeI: "rgba(239, 68, 68, 0.3)",
  typeII: "rgba(251, 191, 36, 0.3)",
  power: "rgba(52, 211, 153, 0.25)",
  powerStroke: "#34d399",
};

const DEFAULT_PARAMS: TestParams = {
  sampleMean: 52,
  sampleStd: 10,
  sampleSize: 30,
  hypMean: 50,
  sampleMean2: 48,
  sampleStd2: 12,
  sampleSize2: 35,
  observed: [18, 22, 15, 20, 25],
  expected: [20, 20, 20, 20, 20],
};

const PRESETS: PresetDef[] = [
  {
    label: "Coin fairness",
    testType: "z-one",
    tail: "two",
    alpha: 0.05,
    params: { sampleMean: 0.54, sampleStd: 0.5, sampleSize: 100, hypMean: 0.5 },
  },
  {
    label: "Drug efficacy",
    testType: "t-one",
    tail: "right",
    alpha: 0.05,
    params: { sampleMean: 5.2, sampleStd: 2.1, sampleSize: 25, hypMean: 4.0 },
  },
  {
    label: "A/B conversion",
    testType: "t-two",
    tail: "two",
    alpha: 0.05,
    params: {
      sampleMean: 0.032, sampleStd: 0.018, sampleSize: 500,
      sampleMean2: 0.028, sampleStd2: 0.016, sampleSize2: 480,
    },
  },
  {
    label: "Die fairness",
    testType: "chi-sq",
    tail: "right",
    alpha: 0.05,
    params: { observed: [18, 22, 15, 20, 25, 20], expected: [20, 20, 20, 20, 20, 20] },
  },
];

// ─────────────────────────────────────────────────────────
// Math helpers
// ─────────────────────────────────────────────────────────

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

function gamma(z: number): number {
  return Math.exp(logGamma(z));
}

function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
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

function tPdf(x: number, df: number): number {
  const coeff = gamma((df + 1) / 2) / (Math.sqrt(df * Math.PI) * gamma(df / 2));
  return coeff * Math.pow(1 + (x * x) / df, -(df + 1) / 2);
}

function tCdf(x: number, df: number): number {
  if (df <= 0) return 0;
  const v = df;
  const t2 = x * x;
  const bx = v / (v + t2);
  const ib = incompleteBeta(bx, v / 2, 0.5);
  return x >= 0 ? 1 - 0.5 * ib : 0.5 * ib;
}

function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;
  let result = front * betaCf(x, a, b);
  return Math.min(1, Math.max(0, result));
}

function betaCf(x: number, a: number, b: number): number {
  const maxIter = 200;
  const eps = 3e-12;
  let qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIter; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
    c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
    c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < eps) break;
  }
  return h;
}

function tQuantile(p: number, df: number): number {
  if (df >= 100) return normalQuantile(p);
  let lo = -20, hi = 20;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function chiSquaredPdf(x: number, k: number): number {
  if (x <= 0 || k <= 0) return 0;
  const halfK = k / 2;
  return Math.exp((halfK - 1) * Math.log(x) - x / 2 - halfK * Math.log(2) - logGamma(halfK));
}

function chiSquaredCdf(x: number, k: number): number {
  if (x <= 0) return 0;
  return regularizedGammaP(k / 2, x / 2);
}

function regularizedGammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a, term = 1 / a;
    for (let n = 1; n < 200; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < 1e-12 * Math.abs(sum)) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  } else {
    let b2 = x + 1 - a, c2 = 1e30, d2 = 1 / b2, h2 = d2;
    for (let i = 1; i < 200; i++) {
      const an = -i * (i - a);
      b2 += 2;
      d2 = an * d2 + b2; if (Math.abs(d2) < 1e-30) d2 = 1e-30; d2 = 1 / d2;
      c2 = b2 + an / c2; if (Math.abs(c2) < 1e-30) c2 = 1e-30;
      const del = d2 * c2;
      h2 *= del;
      if (Math.abs(del - 1) < 1e-12) break;
    }
    return 1 - h2 * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
}

function chiSquaredQuantile(p: number, df: number): number {
  let lo = 0, hi = df + 10 * Math.sqrt(2 * df);
  if (hi < 10) hi = 40;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (chiSquaredCdf(mid, df) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ─────────────────────────────────────────────────────────
// Test computations
// ─────────────────────────────────────────────────────────

function computeTest(
  testType: TestType, tail: TailType, alpha: number, params: TestParams
): TestResult {
  let stat = 0, pVal = 0, df: number | null = null;
  let critLow: number | null = null, critHigh: number | null = null;
  let ci: [number, number] | null = null;

  if (testType === "z-one") {
    const se = params.sampleStd / Math.sqrt(params.sampleSize);
    stat = (params.sampleMean - params.hypMean) / se;
    if (tail === "two") {
      pVal = 2 * (1 - normalCdf(Math.abs(stat)));
      critLow = normalQuantile(alpha / 2);
      critHigh = -critLow;
      const zc = normalQuantile(1 - alpha / 2);
      ci = [params.sampleMean - zc * se, params.sampleMean + zc * se];
    } else if (tail === "left") {
      pVal = normalCdf(stat);
      critLow = normalQuantile(alpha);
      ci = [-Infinity, params.sampleMean - normalQuantile(alpha) * se];
    } else {
      pVal = 1 - normalCdf(stat);
      critHigh = normalQuantile(1 - alpha);
      ci = [params.sampleMean + normalQuantile(alpha) * se, Infinity];
    }
  } else if (testType === "t-one") {
    df = params.sampleSize - 1;
    const se = params.sampleStd / Math.sqrt(params.sampleSize);
    stat = (params.sampleMean - params.hypMean) / se;
    if (tail === "two") {
      pVal = 2 * (1 - tCdf(Math.abs(stat), df));
      critLow = tQuantile(alpha / 2, df);
      critHigh = -critLow;
      const tc = tQuantile(1 - alpha / 2, df);
      ci = [params.sampleMean - tc * se, params.sampleMean + tc * se];
    } else if (tail === "left") {
      pVal = tCdf(stat, df);
      critLow = tQuantile(alpha, df);
      ci = [-Infinity, params.sampleMean - tQuantile(alpha, df) * se];
    } else {
      pVal = 1 - tCdf(stat, df);
      critHigh = tQuantile(1 - alpha, df);
      ci = [params.sampleMean + tQuantile(alpha, df) * se, Infinity];
    }
  } else if (testType === "t-two") {
    const se1sq = (params.sampleStd * params.sampleStd) / params.sampleSize;
    const se2sq = (params.sampleStd2 * params.sampleStd2) / params.sampleSize2;
    const se = Math.sqrt(se1sq + se2sq);
    stat = (params.sampleMean - params.sampleMean2) / se;
    const num = (se1sq + se2sq) * (se1sq + se2sq);
    const den = (se1sq * se1sq) / (params.sampleSize - 1) + (se2sq * se2sq) / (params.sampleSize2 - 1);
    df = Math.floor(num / den);
    if (tail === "two") {
      pVal = 2 * (1 - tCdf(Math.abs(stat), df));
      critLow = tQuantile(alpha / 2, df);
      critHigh = -critLow;
      const tc = tQuantile(1 - alpha / 2, df);
      const diff = params.sampleMean - params.sampleMean2;
      ci = [diff - tc * se, diff + tc * se];
    } else if (tail === "left") {
      pVal = tCdf(stat, df);
      critLow = tQuantile(alpha, df);
    } else {
      pVal = 1 - tCdf(stat, df);
      critHigh = tQuantile(1 - alpha, df);
    }
  } else {
    const obs = params.observed;
    const exp = params.expected;
    const k = Math.min(obs.length, exp.length);
    df = k - 1;
    stat = 0;
    for (let i = 0; i < k; i++) {
      const e = exp[i] || 1;
      stat += ((obs[i] - e) * (obs[i] - e)) / e;
    }
    pVal = 1 - chiSquaredCdf(stat, df);
    critHigh = chiSquaredQuantile(1 - alpha, df);
    ci = null;
  }

  pVal = Math.max(0, Math.min(1, pVal));
  const reject = pVal < alpha;

  return { statistic: stat, pValue: pVal, criticalLow: critLow, criticalHigh: critHigh, reject, ci, df };
}

// ─────────────────────────────────────────────────────────
// Power computation
// ─────────────────────────────────────────────────────────

function computePower(
  alpha: number, effectSize: number, n: number, tail: TailType
): number {
  const se = 1 / Math.sqrt(n);
  const ncp = effectSize / se;
  if (tail === "two") {
    const zAlpha = normalQuantile(1 - alpha / 2);
    return 1 - normalCdf(zAlpha - ncp) + normalCdf(-zAlpha - ncp);
  } else if (tail === "right") {
    const zAlpha = normalQuantile(1 - alpha);
    return 1 - normalCdf(zAlpha - ncp);
  } else {
    const zAlpha = normalQuantile(alpha);
    return normalCdf(zAlpha - ncp);
  }
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

function drawTestCanvas(
  canvas: HTMLCanvasElement,
  testType: TestType,
  tail: TailType,
  result: TestResult
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
  const plotW = w - PAD.left - PAD.right;
  const plotH = h - PAD.top - PAD.bottom;
  const isChiSq = testType === "chi-sq";
  const df = result.df ?? 1;

  const xMin = isChiSq ? 0 : -4.5;
  const xMax = isChiSq ? Math.max(df + 4 * Math.sqrt(2 * df), result.statistic + 3, 20) : 4.5;

  const pdfFn = isChiSq
    ? (x: number) => chiSquaredPdf(x, df)
    : testType === "z-one"
      ? normalPdf
      : (x: number) => tPdf(x, df);

  const toX = (v: number) => PAD.left + ((v - xMin) / (xMax - xMin)) * plotW;
  const pts: Array<{ x: number; y: number }> = [];
  let yMax = 0;
  for (let i = 0; i <= CURVE_PTS; i++) {
    const xv = xMin + (i / CURVE_PTS) * (xMax - xMin);
    const yv = pdfFn(xv);
    pts.push({ x: xv, y: yv });
    if (yv > yMax) yMax = yv;
  }
  yMax *= 1.15;
  const toY = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

  // Grid
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  const xTicks = isChiSq ? 6 : 9;
  for (let i = 0; i <= xTicks; i++) {
    const xv = xMin + (i / xTicks) * (xMax - xMin);
    const px = toX(xv);
    ctx.beginPath(); ctx.moveTo(px, PAD.top); ctx.lineTo(px, PAD.top + plotH); ctx.stroke();
  }
  for (let i = 0; i <= 4; i++) {
    const yv = (i / 4) * yMax;
    const py = toY(yv);
    ctx.beginPath(); ctx.moveTo(PAD.left, py); ctx.lineTo(PAD.left + plotW, py); ctx.stroke();
  }

  // Axes
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(PAD.left, PAD.top + plotH); ctx.lineTo(PAD.left + plotW, PAD.top + plotH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(PAD.left, PAD.top); ctx.lineTo(PAD.left, PAD.top + plotH); ctx.stroke();

  // Tick labels
  ctx.fillStyle = cl.muted;
  ctx.font = "11px Inter, sans-serif";
  ctx.textAlign = "center";
  for (let i = 0; i <= xTicks; i++) {
    const xv = xMin + (i / xTicks) * (xMax - xMin);
    ctx.fillText(xv.toFixed(1), toX(xv), PAD.top + plotH + 16);
  }

  // Fill rejection region
  function fillRegion(from: number, to: number, color: string) {
    ctx.fillStyle = color;
    ctx.beginPath();
    const steps = 100;
    ctx.moveTo(toX(from), toY(0));
    for (let i = 0; i <= steps; i++) {
      const xv = from + (i / steps) * (to - from);
      ctx.lineTo(toX(xv), toY(pdfFn(xv)));
    }
    ctx.lineTo(toX(to), toY(0));
    ctx.closePath();
    ctx.fill();
  }

  // Rejection regions
  if (tail === "two" || tail === "left") {
    const critL = result.criticalLow ?? xMin;
    fillRegion(Math.max(xMin, critL - 1), critL, COLORS.reject);
    // Draw critical line
    ctx.strokeStyle = COLORS.rejectStroke;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(toX(critL), PAD.top); ctx.lineTo(toX(critL), PAD.top + plotH); ctx.stroke();
    ctx.setLineDash([]);
  }
  if (tail === "two" || tail === "right") {
    const critH = result.criticalHigh ?? xMax;
    fillRegion(critH, Math.min(xMax, critH + 1), COLORS.reject);
    ctx.strokeStyle = COLORS.rejectStroke;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(toX(critH), PAD.top); ctx.lineTo(toX(critH), PAD.top + plotH); ctx.stroke();
    ctx.setLineDash([]);
  }

  // p-value shading
  const stat = result.statistic;
  if (tail === "two") {
    fillRegion(Math.max(xMin, -Math.abs(stat) - 0.5), -Math.abs(stat), COLORS.pValue);
    fillRegion(Math.abs(stat), Math.min(xMax, Math.abs(stat) + 0.5), COLORS.pValue);
  } else if (tail === "left") {
    fillRegion(xMin, Math.min(stat, xMax), COLORS.pValue);
  } else {
    fillRegion(Math.max(stat, xMin), xMax, COLORS.pValue);
  }

  // Curve
  ctx.strokeStyle = COLORS.curve;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const px = toX(pts[i].x);
    const py = toY(pts[i].y);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Test statistic line
  if (stat >= xMin && stat <= xMax) {
    ctx.strokeStyle = COLORS.statLine;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(toX(stat), PAD.top);
    ctx.lineTo(toX(stat), PAD.top + plotH);
    ctx.stroke();

    ctx.fillStyle = COLORS.statLine;
    ctx.font = "bold 12px Inter, sans-serif";
    ctx.textAlign = stat > (xMin + xMax) / 2 ? "right" : "left";
    const offset = stat > (xMin + xMax) / 2 ? -6 : 6;
    ctx.fillText(`t = ${stat.toFixed(3)}`, toX(stat) + offset, PAD.top + 14);
  }

  // Decision label
  ctx.textAlign = "center";
  ctx.font = "bold 16px Inter, sans-serif";
  if (result.reject) {
    ctx.fillStyle = COLORS.rejectStroke;
    ctx.fillText("REJECT H\u2080", w / 2, PAD.top + plotH - 12);
  } else {
    ctx.fillStyle = cl.text;
    ctx.fillText("FAIL TO REJECT H\u2080", w / 2, PAD.top + plotH - 12);
  }

  // Legend
  ctx.font = "11px Inter, sans-serif";
  const lx = PAD.left + 10;
  const ly = PAD.top + 14;
  const legendItems: Array<{ color: string; label: string }> = [
    { color: COLORS.reject, label: "Rejection region (\u03B1)" },
    { color: COLORS.pValue, label: "p-value area" },
    { color: COLORS.statLine, label: "Test statistic" },
  ];
  legendItems.forEach((item, i) => {
    ctx.fillStyle = item.color;
    ctx.fillRect(lx, ly + i * 16 - 8, 12, 10);
    ctx.fillStyle = cl.muted;
    ctx.fillText(item.label, lx + 18, ly + i * 16);
  });
  ctx.textAlign = "start";
}

function drawPowerCanvas(
  canvas: HTMLCanvasElement,
  alpha: number,
  effectSize: number,
  sampleSize: number,
  tail: TailType
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

  const plotW = w - PAD.left - PAD.right;
  const plotH = h - PAD.top - PAD.bottom;

  const se = 1 / Math.sqrt(sampleSize);
  const ncp = effectSize / se;
  const xMin = -4.5;
  const xMax = Math.max(4.5, ncp + 3.5);
  const toX = (v: number) => PAD.left + ((v - xMin) / (xMax - xMin)) * plotW;

  let yMax = 0;
  for (let i = 0; i <= CURVE_PTS; i++) {
    const xv = xMin + (i / CURVE_PTS) * (xMax - xMin);
    const y0 = normalPdf(xv);
    const y1 = normalPdf(xv - ncp);
    if (y0 > yMax) yMax = y0;
    if (y1 > yMax) yMax = y1;
  }
  yMax *= 1.15;
  const toY = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

  // Grid
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 8; i++) {
    const xv = xMin + (i / 8) * (xMax - xMin);
    const px = toX(xv);
    ctx.beginPath(); ctx.moveTo(px, PAD.top); ctx.lineTo(px, PAD.top + plotH); ctx.stroke();
  }

  // Axes
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(PAD.left, PAD.top + plotH); ctx.lineTo(PAD.left + plotW, PAD.top + plotH); ctx.stroke();

  // Critical value for visualization (using right-tail for simplicity in power plot)
  const zCrit = tail === "two" ? normalQuantile(1 - alpha / 2) : normalQuantile(1 - alpha);

  // Type I error shading (on null dist, right of critical value)
  function fillArea(from: number, to: number, distMean: number, color: string) {
    ctx.fillStyle = color;
    ctx.beginPath();
    const steps = 100;
    ctx.moveTo(toX(from), toY(0));
    for (let i = 0; i <= steps; i++) {
      const xv = from + (i / steps) * (to - from);
      ctx.lineTo(toX(xv), toY(normalPdf(xv - distMean)));
    }
    ctx.lineTo(toX(to), toY(0));
    ctx.closePath();
    ctx.fill();
  }

  // Type I (alpha) on null
  fillArea(zCrit, Math.min(xMax, zCrit + 5), 0, COLORS.typeI);
  if (tail === "two") fillArea(Math.max(xMin, -zCrit - 5), -zCrit, 0, COLORS.typeI);

  // Type II (beta) on alternative: area below critical value
  fillArea(Math.max(xMin, ncp - 5), zCrit, ncp, COLORS.typeII);

  // Power on alternative: area above critical value
  fillArea(zCrit, Math.min(xMax, ncp + 5), ncp, COLORS.power);

  // Null distribution curve
  ctx.strokeStyle = COLORS.nullDist;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= CURVE_PTS; i++) {
    const xv = xMin + (i / CURVE_PTS) * (xMax - xMin);
    const px = toX(xv); const py = toY(normalPdf(xv));
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Alternative distribution curve
  ctx.strokeStyle = COLORS.altDist;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= CURVE_PTS; i++) {
    const xv = xMin + (i / CURVE_PTS) * (xMax - xMin);
    const px = toX(xv); const py = toY(normalPdf(xv - ncp));
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Critical value line
  ctx.strokeStyle = COLORS.rejectStroke;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  ctx.beginPath(); ctx.moveTo(toX(zCrit), PAD.top); ctx.lineTo(toX(zCrit), PAD.top + plotH); ctx.stroke();
  if (tail === "two") {
    ctx.beginPath(); ctx.moveTo(toX(-zCrit), PAD.top); ctx.lineTo(toX(-zCrit), PAD.top + plotH); ctx.stroke();
  }
  ctx.setLineDash([]);

  // Legend
  const lx = w - PAD.right - 170;
  const ly = PAD.top + 14;
  ctx.font = "11px Inter, sans-serif";
  const items: Array<{ color: string; label: string }> = [
    { color: COLORS.nullDist, label: "Null distribution (H\u2080)" },
    { color: COLORS.altDist, label: "Alternative (H\u2081)" },
    { color: COLORS.typeI, label: `Type I error (\u03B1 = ${alpha})` },
    { color: COLORS.typeII, label: "Type II error (\u03B2)" },
    { color: COLORS.power, label: `Power (1-\u03B2)` },
  ];
  items.forEach((item, i) => {
    ctx.fillStyle = item.color;
    ctx.fillRect(lx, ly + i * 16 - 8, 12, 10);
    ctx.fillStyle = cl.muted;
    ctx.textAlign = "left";
    ctx.fillText(item.label, lx + 18, ly + i * 16);
  });

  // Labels
  ctx.fillStyle = cl.muted;
  ctx.textAlign = "center";
  for (let i = 0; i <= 8; i++) {
    const xv = xMin + (i / 8) * (xMax - xMin);
    ctx.fillText(xv.toFixed(1), toX(xv), PAD.top + plotH + 16);
  }

  // Power value display
  const pwr = computePower(alpha, effectSize, sampleSize, tail);
  ctx.fillStyle = COLORS.powerStroke;
  ctx.font = "bold 14px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`Power = ${(pwr * 100).toFixed(1)}%`, w / 2, PAD.top + plotH - 8);
}

function drawPowerCurve(
  canvas: HTMLCanvasElement,
  alpha: number,
  effectSize: number,
  tail: TailType
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

  const plotW = w - PAD.left - PAD.right;
  const plotH = h - PAD.top - PAD.bottom;

  const nMin = 5, nMax = 500;
  const toX = (n: number) => PAD.left + ((n - nMin) / (nMax - nMin)) * plotW;
  const toY = (p: number) => PAD.top + plotH - p * plotH;

  // Grid
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let p = 0; p <= 1; p += 0.2) {
    const py = toY(p);
    ctx.beginPath(); ctx.moveTo(PAD.left, py); ctx.lineTo(PAD.left + plotW, py); ctx.stroke();
    ctx.fillStyle = cl.muted;
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText((p * 100).toFixed(0) + "%", PAD.left - 6, py + 4);
  }

  // Axis
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(PAD.left, PAD.top + plotH); ctx.lineTo(PAD.left + plotW, PAD.top + plotH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(PAD.left, PAD.top); ctx.lineTo(PAD.left, PAD.top + plotH); ctx.stroke();

  // X labels
  ctx.textAlign = "center";
  ctx.fillStyle = cl.muted;
  for (const n of [10, 50, 100, 200, 300, 400, 500]) {
    ctx.fillText(String(n), toX(n), PAD.top + plotH + 16);
  }
  ctx.fillText("Sample size (n)", w / 2, PAD.top + plotH + 36);

  // 80% power line
  ctx.strokeStyle = "rgba(161, 161, 170, 0.3)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(PAD.left, toY(0.8)); ctx.lineTo(PAD.left + plotW, toY(0.8)); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = cl.muted;
  ctx.textAlign = "left";
  ctx.fillText("80%", PAD.left + 4, toY(0.8) - 4);

  // Power curve
  ctx.strokeStyle = COLORS.powerStroke;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let n = nMin; n <= nMax; n += 2) {
    const pwr = computePower(alpha, effectSize, n, tail);
    const px = toX(n); const py = toY(pwr);
    if (n === nMin) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Fill under curve
  ctx.fillStyle = "rgba(52, 211, 153, 0.08)";
  ctx.beginPath();
  ctx.moveTo(toX(nMin), toY(0));
  for (let n = nMin; n <= nMax; n += 2) {
    ctx.lineTo(toX(n), toY(computePower(alpha, effectSize, n, tail)));
  }
  ctx.lineTo(toX(nMax), toY(0));
  ctx.closePath();
  ctx.fill();

  // Title
  ctx.fillStyle = cl.text;
  ctx.font = "bold 13px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`Power curve (d = ${effectSize.toFixed(2)}, \u03B1 = ${alpha})`, w / 2, PAD.top - 6);
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

export default function HypothesisTesting() {
  const [tab, setTab] = useState<TabId>("test");
  const [testType, setTestType] = useState<TestType>("z-one");
  const [tail, setTail] = useState<TailType>("two");
  const [alpha, setAlpha] = useState(0.05);
  const [params, setParams] = useState<TestParams>({ ...DEFAULT_PARAMS });

  // Power tab
  const [effectSize, setEffectSize] = useState(0.5);
  const [powerN, setPowerN] = useState(30);

  // Canvas refs
  const testCanvasRef = useRef<HTMLCanvasElement>(null);
  const powerCanvasRef = useRef<HTMLCanvasElement>(null);
  const powerCurveRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasW, setCanvasW] = useState(600);

  // Responsive
  useEffect(() => {
    function resize() {
      if (containerRef.current) setCanvasW(containerRef.current.clientWidth);
    }
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // Compute result
  const result = useMemo(
    () => computeTest(testType, tail, alpha, params),
    [testType, tail, alpha, params]
  );

  // Draw test canvas
  useEffect(() => {
    if (tab === "test" && testCanvasRef.current) {
      drawTestCanvas(testCanvasRef.current, testType, tail, result);
    }
  }, [tab, testType, tail, result, canvasW]);

  // Draw power canvases
  useEffect(() => {
    if (tab === "power" && powerCanvasRef.current) {
      drawPowerCanvas(powerCanvasRef.current, alpha, effectSize, powerN, tail);
    }
    if (tab === "power" && powerCurveRef.current) {
      drawPowerCurve(powerCurveRef.current, alpha, effectSize, tail);
    }
  }, [tab, alpha, effectSize, powerN, tail, canvasW]);

  const updateParam = useCallback((key: keyof TestParams, value: number) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  const applyPreset = useCallback((preset: PresetDef) => {
    setTestType(preset.testType);
    setTail(preset.tail);
    setAlpha(preset.alpha);
    setParams((prev) => ({ ...prev, ...preset.params }));
  }, []);

  const updateObserved = useCallback((text: string) => {
    const nums = text.split(",").map(Number).filter((n) => !isNaN(n));
    setParams((prev) => ({ ...prev, observed: nums }));
  }, []);

  const updateExpected = useCallback((text: string) => {
    const nums = text.split(",").map(Number).filter((n) => !isNaN(n));
    setParams((prev) => ({ ...prev, expected: nums }));
  }, []);

  const power = useMemo(
    () => computePower(alpha, effectSize, powerN, tail),
    [alpha, effectSize, powerN, tail]
  );

  const testTypeLabels: Record<TestType, string> = {
    "z-one": "One-sample z-test",
    "t-one": "One-sample t-test",
    "t-two": "Two-sample t-test",
    "chi-sq": "Chi-squared (\u03C7\u00B2)",
  };

  const tailLabels: Record<TailType, string> = {
    two: "Two-tailed (H\u2081: \u03BC \u2260 \u03BC\u2080)",
    left: "Left-tailed (H\u2081: \u03BC < \u03BC\u2080)",
    right: "Right-tailed (H\u2081: \u03BC > \u03BC\u2080)",
  };

  return (
    <div ref={containerRef} style={{ color: "var(--color-text)", fontFamily: "Inter, sans-serif" }}>
      {/* Tabs */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        {(["test", "power"] as TabId[]).map((t) => (
          <button
            key={t}
            style={tab === t ? btnActive : btnBase}
            onClick={() => setTab(t)}
          >
            {t === "test" ? "Hypothesis Test" : "Power Analysis"}
          </button>
        ))}
      </div>

      {/* Presets */}
      <div style={panelStyle}>
        <span style={{ ...labelStyle, marginBottom: "8px" }}>Presets</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {PRESETS.map((p) => (
            <button key={p.label} style={btnBase} onClick={() => applyPreset(p)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "test" && (
        <>
          {/* Config panel */}
          <div style={panelStyle}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
              {/* Test type */}
              <div>
                <label style={labelStyle}>Test Type</label>
                <select
                  style={inputStyle}
                  value={testType}
                  onInput={(e) => setTestType((e.target as HTMLSelectElement).value as TestType)}
                >
                  {(Object.keys(testTypeLabels) as TestType[]).map((t) => (
                    <option key={t} value={t}>{testTypeLabels[t]}</option>
                  ))}
                </select>
              </div>

              {/* Tail */}
              {testType !== "chi-sq" && (
                <div>
                  <label style={labelStyle}>Alternative Hypothesis</label>
                  <select
                    style={inputStyle}
                    value={tail}
                    onInput={(e) => setTail((e.target as HTMLSelectElement).value as TailType)}
                  >
                    {(Object.keys(tailLabels) as TailType[]).map((t) => (
                      <option key={t} value={t}>{tailLabels[t]}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Alpha */}
              <div>
                <label style={labelStyle}>Significance Level (\u03B1 = {alpha.toFixed(3)})</label>
                <input
                  type="range"
                  min="0.001"
                  max="0.20"
                  step="0.001"
                  value={alpha}
                  onInput={(e) => setAlpha(Number((e.target as HTMLInputElement).value))}
                  style={{ width: "100%" }}
                />
              </div>
            </div>

            {/* Parameters based on test type */}
            {testType !== "chi-sq" && (
              <div style={{ marginTop: "16px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px" }}>
                <div>
                  <label style={labelStyle}>Sample Mean (\u0078\u0304)</label>
                  <input
                    type="number"
                    step="any"
                    value={params.sampleMean}
                    onInput={(e) => updateParam("sampleMean", Number((e.target as HTMLInputElement).value))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Sample Std Dev (s)</label>
                  <input
                    type="number"
                    step="any"
                    min="0.001"
                    value={params.sampleStd}
                    onInput={(e) => updateParam("sampleStd", Math.max(0.001, Number((e.target as HTMLInputElement).value)))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Sample Size (n)</label>
                  <input
                    type="number"
                    min="2"
                    step="1"
                    value={params.sampleSize}
                    onInput={(e) => updateParam("sampleSize", Math.max(2, Number((e.target as HTMLInputElement).value)))}
                    style={inputStyle}
                  />
                </div>
                {testType !== "t-two" && (
                  <div>
                    <label style={labelStyle}>Hypothesized Mean (\u03BC\u2080)</label>
                    <input
                      type="number"
                      step="any"
                      value={params.hypMean}
                      onInput={(e) => updateParam("hypMean", Number((e.target as HTMLInputElement).value))}
                      style={inputStyle}
                    />
                  </div>
                )}
                {testType === "t-two" && (
                  <>
                    <div style={{ gridColumn: "1 / -1", borderTop: "1px solid var(--color-border)", paddingTop: "12px", marginTop: "4px" }}>
                      <span style={{ ...labelStyle, fontSize: "11px" }}>Sample 2</span>
                    </div>
                    <div>
                      <label style={labelStyle}>Mean 2 (\u0078\u0304\u2082)</label>
                      <input
                        type="number"
                        step="any"
                        value={params.sampleMean2}
                        onInput={(e) => updateParam("sampleMean2", Number((e.target as HTMLInputElement).value))}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Std Dev 2 (s\u2082)</label>
                      <input
                        type="number"
                        step="any"
                        min="0.001"
                        value={params.sampleStd2}
                        onInput={(e) => updateParam("sampleStd2", Math.max(0.001, Number((e.target as HTMLInputElement).value)))}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Size 2 (n\u2082)</label>
                      <input
                        type="number"
                        min="2"
                        step="1"
                        value={params.sampleSize2}
                        onInput={(e) => updateParam("sampleSize2", Math.max(2, Number((e.target as HTMLInputElement).value)))}
                        style={inputStyle}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {testType === "chi-sq" && (
              <div style={{ marginTop: "16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={labelStyle}>Observed (comma-separated)</label>
                  <input
                    type="text"
                    value={params.observed.join(",")}
                    onInput={(e) => updateObserved((e.target as HTMLInputElement).value)}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Expected (comma-separated)</label>
                  <input
                    type="text"
                    value={params.expected.join(",")}
                    onInput={(e) => updateExpected((e.target as HTMLInputElement).value)}
                    style={inputStyle}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Canvas */}
          <div style={{ ...panelStyle, padding: "0", overflow: "hidden" }}>
            <canvas
              ref={testCanvasRef}
              style={{ width: "100%", height: `${CANVAS_H}px`, display: "block" }}
            />
          </div>

          {/* Results panel */}
          <div style={panelStyle}>
            <span style={{ ...labelStyle, marginBottom: "12px" }}>Results</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px" }}>
              <div style={statCardStyle}>
                <div style={{ color: "var(--color-text-muted)", fontSize: "11px", marginBottom: "4px" }}>Test Statistic</div>
                <div style={{ color: "var(--color-heading)", fontSize: "18px", fontWeight: "700", fontFamily: "JetBrains Mono, monospace" }}>
                  {result.statistic.toFixed(4)}
                </div>
              </div>
              <div style={statCardStyle}>
                <div style={{ color: "var(--color-text-muted)", fontSize: "11px", marginBottom: "4px" }}>p-value</div>
                <div style={{
                  color: result.pValue < alpha ? "#ef4444" : "var(--color-accent)",
                  fontSize: "18px", fontWeight: "700", fontFamily: "JetBrains Mono, monospace",
                }}>
                  {result.pValue < 0.0001 ? result.pValue.toExponential(2) : result.pValue.toFixed(4)}
                </div>
              </div>
              <div style={statCardStyle}>
                <div style={{ color: "var(--color-text-muted)", fontSize: "11px", marginBottom: "4px" }}>Critical Value(s)</div>
                <div style={{ color: "var(--color-heading)", fontSize: "14px", fontWeight: "600", fontFamily: "JetBrains Mono, monospace" }}>
                  {result.criticalLow !== null && result.criticalHigh !== null
                    ? `${result.criticalLow.toFixed(3)}, ${result.criticalHigh.toFixed(3)}`
                    : result.criticalLow !== null
                      ? result.criticalLow.toFixed(3)
                      : result.criticalHigh !== null
                        ? result.criticalHigh.toFixed(3)
                        : "\u2014"}
                </div>
              </div>
              {result.df !== null && (
                <div style={statCardStyle}>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "11px", marginBottom: "4px" }}>Degrees of Freedom</div>
                  <div style={{ color: "var(--color-heading)", fontSize: "18px", fontWeight: "700", fontFamily: "JetBrains Mono, monospace" }}>
                    {result.df}
                  </div>
                </div>
              )}
              <div style={{
                ...statCardStyle,
                background: result.reject ? "rgba(239, 68, 68, 0.1)" : "rgba(52, 211, 153, 0.1)",
                border: `1px solid ${result.reject ? "rgba(239, 68, 68, 0.3)" : "rgba(52, 211, 153, 0.3)"}`,
              }}>
                <div style={{ color: "var(--color-text-muted)", fontSize: "11px", marginBottom: "4px" }}>Decision (\u03B1 = {alpha})</div>
                <div style={{
                  color: result.reject ? "#ef4444" : "var(--color-accent)",
                  fontSize: "14px", fontWeight: "700",
                }}>
                  {result.reject ? "Reject H\u2080" : "Fail to reject H\u2080"}
                </div>
              </div>
              {result.ci && (
                <div style={statCardStyle}>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "11px", marginBottom: "4px" }}>
                    {((1 - alpha) * 100).toFixed(0)}% CI
                  </div>
                  <div style={{ color: "var(--color-heading)", fontSize: "13px", fontWeight: "600", fontFamily: "JetBrains Mono, monospace" }}>
                    [{isFinite(result.ci[0]) ? result.ci[0].toFixed(4) : "-\u221E"},
                    {" "}{isFinite(result.ci[1]) ? result.ci[1].toFixed(4) : "+\u221E"}]
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Interpretation */}
          <div style={{ ...panelStyle, fontSize: "13px", lineHeight: "1.7", color: "var(--color-text-muted)" }}>
            <span style={{ ...labelStyle, marginBottom: "8px" }}>Interpretation</span>
            <p>
              The <strong style={{ color: "var(--color-heading)" }}>{testTypeLabels[testType]}</strong> yields a
              test statistic of <strong style={{ color: COLORS.statLine }}>{result.statistic.toFixed(4)}</strong>.
              {" "}The p-value is <strong style={{ color: result.pValue < alpha ? "#ef4444" : "var(--color-accent)" }}>{result.pValue.toFixed(4)}</strong>,
              which is {result.pValue < alpha ? "less" : "greater"} than
              {" "}\u03B1 = {alpha}.
              {" "}{result.reject
                ? "We reject the null hypothesis \u2014 there is statistically significant evidence against H\u2080."
                : "We fail to reject the null hypothesis \u2014 there is not enough evidence against H\u2080 at this significance level."}
            </p>
          </div>
        </>
      )}

      {tab === "power" && (
        <>
          {/* Power controls */}
          <div style={panelStyle}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
              <div>
                <label style={labelStyle}>Effect Size (Cohen's d = {effectSize.toFixed(2)})</label>
                <input
                  type="range"
                  min="0.1"
                  max="2.0"
                  step="0.01"
                  value={effectSize}
                  onInput={(e) => setEffectSize(Number((e.target as HTMLInputElement).value))}
                  style={{ width: "100%" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--color-text-muted)", marginTop: "2px" }}>
                  <span>Small (0.2)</span>
                  <span>Medium (0.5)</span>
                  <span>Large (0.8)</span>
                </div>
              </div>
              <div>
                <label style={labelStyle}>Sample Size (n = {powerN})</label>
                <input
                  type="range"
                  min="5"
                  max="500"
                  step="1"
                  value={powerN}
                  onInput={(e) => setPowerN(Number((e.target as HTMLInputElement).value))}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label style={labelStyle}>Significance Level (\u03B1 = {alpha.toFixed(3)})</label>
                <input
                  type="range"
                  min="0.001"
                  max="0.20"
                  step="0.001"
                  value={alpha}
                  onInput={(e) => setAlpha(Number((e.target as HTMLInputElement).value))}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label style={labelStyle}>Tail Type</label>
                <select
                  style={inputStyle}
                  value={tail}
                  onInput={(e) => setTail((e.target as HTMLSelectElement).value as TailType)}
                >
                  <option value="two">Two-tailed</option>
                  <option value="left">Left-tailed</option>
                  <option value="right">Right-tailed</option>
                </select>
              </div>
            </div>
          </div>

          {/* Power stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "10px", marginBottom: "12px" }}>
            <div style={{ ...statCardStyle, background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
              <div style={{ color: "var(--color-text-muted)", fontSize: "11px", marginBottom: "4px" }}>Power (1 - \u03B2)</div>
              <div style={{ color: COLORS.powerStroke, fontSize: "20px", fontWeight: "700", fontFamily: "JetBrains Mono, monospace" }}>
                {(power * 100).toFixed(1)}%
              </div>
            </div>
            <div style={{ ...statCardStyle, background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
              <div style={{ color: "var(--color-text-muted)", fontSize: "11px", marginBottom: "4px" }}>Type II Error (\u03B2)</div>
              <div style={{ color: "#fbbf24", fontSize: "20px", fontWeight: "700", fontFamily: "JetBrains Mono, monospace" }}>
                {((1 - power) * 100).toFixed(1)}%
              </div>
            </div>
            <div style={{ ...statCardStyle, background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
              <div style={{ color: "var(--color-text-muted)", fontSize: "11px", marginBottom: "4px" }}>Type I Error (\u03B1)</div>
              <div style={{ color: "#ef4444", fontSize: "20px", fontWeight: "700", fontFamily: "JetBrains Mono, monospace" }}>
                {(alpha * 100).toFixed(1)}%
              </div>
            </div>
            <div style={{ ...statCardStyle, background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
              <div style={{ color: "var(--color-text-muted)", fontSize: "11px", marginBottom: "4px" }}>Adequate?</div>
              <div style={{ color: power >= 0.8 ? "var(--color-accent)" : "#ef4444", fontSize: "16px", fontWeight: "700" }}>
                {power >= 0.8 ? "Yes (\u2265 80%)" : "No (< 80%)"}
              </div>
            </div>
          </div>

          {/* Distributions canvas */}
          <div style={{ ...panelStyle, padding: "0", overflow: "hidden" }}>
            <canvas
              ref={powerCanvasRef}
              style={{ width: "100%", height: `${CANVAS_H}px`, display: "block" }}
            />
          </div>

          {/* Power curve canvas */}
          <div style={{ ...panelStyle, padding: "0", overflow: "hidden" }}>
            <canvas
              ref={powerCurveRef}
              style={{ width: "100%", height: "240px", display: "block" }}
            />
          </div>

          {/* Explanation */}
          <div style={{ ...panelStyle, fontSize: "13px", lineHeight: "1.7", color: "var(--color-text-muted)" }}>
            <span style={{ ...labelStyle, marginBottom: "8px" }}>Understanding Power</span>
            <p style={{ marginBottom: "8px" }}>
              <strong style={{ color: "var(--color-heading)" }}>Statistical power</strong> is the probability of correctly
              rejecting a false null hypothesis. It depends on three factors:
            </p>
            <ul style={{ paddingLeft: "20px", margin: "0" }}>
              <li><strong style={{ color: COLORS.powerStroke }}>Effect size (d)</strong>: larger effects are easier to detect.</li>
              <li><strong style={{ color: "var(--color-primary)" }}>Sample size (n)</strong>: more data means more power.</li>
              <li><strong style={{ color: "#ef4444" }}>Significance level (\u03B1)</strong>: a larger \u03B1 gives more power but more false positives.</li>
            </ul>
            <p style={{ marginTop: "8px" }}>
              The conventional target is <strong style={{ color: "var(--color-heading)" }}>80% power</strong>. Below that,
              your study may fail to detect a real effect even if one exists.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
