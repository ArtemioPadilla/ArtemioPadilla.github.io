import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ==================================================================
   Types
   ================================================================== */

type TestTail = "two" | "one";
type SignificanceLevel = 0.1 | 0.05 | 0.01;
type ActiveTab = "frequentist" | "bayesian" | "power" | "sequential";

interface GroupInput {
  visitors: number;
  conversions: number;
}

interface FrequentistResult {
  controlRate: number;
  variantRate: number;
  relativeUplift: number;
  zStatistic: number;
  pValue: number;
  chiSquared: number;
  chiPValue: number;
  significant: boolean;
  ciLower: number;
  ciUpper: number;
  effectSize: number;
  ciWidth: number;
  mde: number;
}

interface BayesianResult {
  probBbeatsA: number;
  expectedLossA: number;
  expectedLossB: number;
  posteriorAlphaA: number;
  posteriorBetaA: number;
  posteriorAlphaB: number;
  posteriorBetaB: number;
}

interface PowerResult {
  requiredSampleSize: number;
  powerCurve: Array<{ n: number; power: number }>;
}

interface SequentialPoint {
  fraction: number;
  pValue: number;
  significant: boolean;
  controlRate: number;
  variantRate: number;
}

interface Preset {
  name: string;
  description: string;
  control: GroupInput;
  variant: GroupInput;
}

/* ==================================================================
   Constants
   ================================================================== */

const CANVAS_W = 600;
const CANVAS_H = 260;
const POWER_CANVAS_H = 220;

const PRESETS: Preset[] = [
  {
    name: "Clear winner",
    description: "Large effect size, easily significant",
    control: { visitors: 5000, conversions: 250 },
    variant: { visitors: 5000, conversions: 375 },
  },
  {
    name: "Marginal",
    description: "Small effect, borderline significance",
    control: { visitors: 10000, conversions: 500 },
    variant: { visitors: 10000, conversions: 545 },
  },
  {
    name: "No difference",
    description: "Same conversion rate on both sides",
    control: { visitors: 8000, conversions: 400 },
    variant: { visitors: 8000, conversions: 396 },
  },
  {
    name: "Negative result",
    description: "Variant performs worse than control",
    control: { visitors: 6000, conversions: 360 },
    variant: { visitors: 6000, conversions: 270 },
  },
];

/* ==================================================================
   Pure Math — Error Function (Abramowitz & Stegun 7.1.26)
   ================================================================== */

function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const poly =
    t *
    (0.254829592 +
      t *
        (-0.284496736 +
          t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - poly * Math.exp(-a * a));
}

/* ==================================================================
   Pure Math — Normal Distribution
   ================================================================== */

function normalCDF(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Inverse normal CDF (probit) via rational approximation (Peter Acklam) */
function inverseCDF(p: number): number {
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
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0,
    3.754408661907416e0,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  let q: number, r: number;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }

  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }

  q = Math.sqrt(-2 * Math.log(1 - p));
  return (
    -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    )
  );
}

/* ==================================================================
   Pure Math — Beta Distribution
   ================================================================== */

/** Log-gamma (Lanczos approximation) */
function logGamma(z: number): number {
  const g = 7;
  const coefs = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return (
      Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z)
    );
  }
  z -= 1;
  let x = coefs[0];
  for (let i = 1; i < g + 2; i++) {
    x += coefs[i] / (z + i);
  }
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

function betaPDF(x: number, alpha: number, beta: number): number {
  if (x <= 0 || x >= 1) return 0;
  return Math.exp(
    (alpha - 1) * Math.log(x) +
      (beta - 1) * Math.log(1 - x) -
      logBeta(alpha, beta)
  );
}

/* ==================================================================
   Pure Math — Statistical Tests
   ================================================================== */

function computeFrequentist(
  control: GroupInput,
  variant: GroupInput,
  alpha: SignificanceLevel,
  tail: TestTail
): FrequentistResult {
  const pA = control.conversions / control.visitors;
  const pB = variant.conversions / variant.visitors;

  // Pooled proportion for z-test
  const pooled =
    (control.conversions + variant.conversions) /
    (control.visitors + variant.visitors);
  const se = Math.sqrt(
    pooled * (1 - pooled) * (1 / control.visitors + 1 / variant.visitors)
  );

  const z = se > 0 ? (pB - pA) / se : 0;

  // p-value
  let pValue: number;
  if (tail === "two") {
    pValue = 2 * (1 - normalCDF(Math.abs(z)));
  } else {
    pValue = 1 - normalCDF(z);
  }

  // Chi-squared test
  const total = control.visitors + variant.visitors;
  const totalConv = control.conversions + variant.conversions;
  const totalNonConv = total - totalConv;
  const expectedAConv = (control.visitors * totalConv) / total;
  const expectedANon = (control.visitors * totalNonConv) / total;
  const expectedBConv = (variant.visitors * totalConv) / total;
  const expectedBNon = (variant.visitors * totalNonConv) / total;

  let chi2 = 0;
  if (expectedAConv > 0)
    chi2 += Math.pow(control.conversions - expectedAConv, 2) / expectedAConv;
  if (expectedANon > 0)
    chi2 +=
      Math.pow(control.visitors - control.conversions - expectedANon, 2) /
      expectedANon;
  if (expectedBConv > 0)
    chi2 += Math.pow(variant.conversions - expectedBConv, 2) / expectedBConv;
  if (expectedBNon > 0)
    chi2 +=
      Math.pow(variant.visitors - variant.conversions - expectedBNon, 2) /
      expectedBNon;

  // Chi-squared p-value (1 df): for chi2 with 1df, p = 2*(1 - Phi(sqrt(chi2)))
  const chiP = 2 * (1 - normalCDF(Math.sqrt(chi2)));

  // Confidence interval for difference (pB - pA)
  const seDiff = Math.sqrt(
    (pA * (1 - pA)) / control.visitors + (pB * (1 - pB)) / variant.visitors
  );
  const zCrit = tail === "two" ? inverseCDF(1 - alpha / 2) : inverseCDF(1 - alpha);
  const diff = pB - pA;
  const ciLower = diff - zCrit * seDiff;
  const ciUpper = diff + zCrit * seDiff;

  // Relative uplift
  const relativeUplift = pA > 0 ? ((pB - pA) / pA) * 100 : 0;

  // Cohen's h (effect size for proportions)
  const h =
    2 * Math.asin(Math.sqrt(pB)) - 2 * Math.asin(Math.sqrt(pA));
  const effectSize = Math.abs(h);

  // Confidence interval width
  const ciWidth = ciUpper - ciLower;

  // Minimum detectable effect at current sample size
  const mde = zCrit * seDiff;

  return {
    controlRate: pA,
    variantRate: pB,
    relativeUplift,
    zStatistic: z,
    pValue: Math.max(0, Math.min(1, pValue)),
    chiSquared: chi2,
    chiPValue: Math.max(0, Math.min(1, chiP)),
    significant: pValue < alpha,
    ciLower,
    ciUpper,
    effectSize,
    ciWidth,
    mde,
  };
}

function computeBayesian(
  control: GroupInput,
  variant: GroupInput
): BayesianResult {
  // Uniform prior: Beta(1,1)
  const alphaA = 1 + control.conversions;
  const betaA = 1 + control.visitors - control.conversions;
  const alphaB = 1 + variant.conversions;
  const betaB = 1 + variant.visitors - variant.conversions;

  // Monte Carlo estimation of P(B > A)
  // Use numerical integration instead for deterministic results
  const steps = 1000;
  let probBbeatsA = 0;
  let expectedLossA = 0;
  let expectedLossB = 0;

  // For each x in [0,1] for B, compute P(A < x) * pdf_B(x)
  for (let i = 0; i < steps; i++) {
    const x = (i + 0.5) / steps;
    const pdfB = betaPDF(x, alphaB, betaB);

    // CDF of Beta(alphaA, betaA) at x via numerical integration
    let cdfA = 0;
    const subSteps = 200;
    for (let j = 0; j < subSteps; j++) {
      const y = (j + 0.5) / subSteps;
      if (y < x) {
        cdfA += betaPDF(y, alphaA, betaA) / subSteps;
      }
    }

    probBbeatsA += pdfB * cdfA / steps;
  }

  // Expected loss: E[max(A-B, 0)] for choosing B, and E[max(B-A, 0)] for choosing A
  // Approximate via grid integration
  const gridN = 200;
  for (let i = 0; i < gridN; i++) {
    const xA = (i + 0.5) / gridN;
    const pdfA = betaPDF(xA, alphaA, betaA);
    for (let j = 0; j < gridN; j++) {
      const xB = (j + 0.5) / gridN;
      const pdfBVal = betaPDF(xB, alphaB, betaB);
      const jointDensity = pdfA * pdfBVal / (gridN * gridN);

      if (xA > xB) expectedLossB += (xA - xB) * jointDensity;
      if (xB > xA) expectedLossA += (xB - xA) * jointDensity;
    }
  }

  return {
    probBbeatsA,
    expectedLossA,
    expectedLossB,
    posteriorAlphaA: alphaA,
    posteriorBetaA: betaA,
    posteriorAlphaB: alphaB,
    posteriorBetaB: betaB,
  };
}

function computePowerAnalysis(
  baselineRate: number,
  mde: number,
  alpha: SignificanceLevel,
  tail: TestTail
): PowerResult {
  const p1 = baselineRate;
  const p2 = baselineRate + mde;

  const zAlpha = tail === "two" ? inverseCDF(1 - alpha / 2) : inverseCDF(1 - alpha);
  const zBeta = inverseCDF(0.8); // 80% power

  // Sample size formula for comparing two proportions
  const pBar = (p1 + p2) / 2;
  const num =
    Math.pow(
      zAlpha * Math.sqrt(2 * pBar * (1 - pBar)) +
        zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)),
      2
    );
  const denom = Math.pow(p2 - p1, 2);
  const requiredSampleSize = denom > 0 ? Math.ceil(num / denom) : Infinity;

  // Power curve: for various n, compute power
  const powerCurve: Array<{ n: number; power: number }> = [];
  const maxN = Math.min(Math.max(requiredSampleSize * 3, 500), 200000);
  const step = Math.max(1, Math.floor(maxN / 100));

  for (let n = step; n <= maxN; n += step) {
    const sePooled = Math.sqrt(pBar * (1 - pBar) * (2 / n));
    const seUnpooled = Math.sqrt(
      (p1 * (1 - p1)) / n + (p2 * (1 - p2)) / n
    );
    if (sePooled <= 0 || seUnpooled <= 0) {
      powerCurve.push({ n, power: 1 });
      continue;
    }
    const criticalValue = zAlpha * sePooled;
    const power = 1 - normalCDF((criticalValue - Math.abs(p2 - p1)) / seUnpooled);
    powerCurve.push({ n, power: Math.min(1, Math.max(0, power)) });
  }

  return { requiredSampleSize, powerCurve };
}

function computeSequential(
  control: GroupInput,
  variant: GroupInput,
  alpha: SignificanceLevel,
  tail: TestTail,
  steps: number
): SequentialPoint[] {
  const points: SequentialPoint[] = [];
  const totalSamples = Math.min(control.visitors, variant.visitors);

  for (let i = 1; i <= steps; i++) {
    const fraction = i / steps;
    const nA = Math.max(1, Math.round(control.visitors * fraction));
    const nB = Math.max(1, Math.round(variant.visitors * fraction));

    // Scale conversions proportionally
    const cA = Math.round(control.conversions * (nA / control.visitors));
    const cB = Math.round(variant.conversions * (nB / variant.visitors));

    const pA = cA / nA;
    const pB = cB / nB;
    const pooled = (cA + cB) / (nA + nB);
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));
    const z = se > 0 ? (pB - pA) / se : 0;

    let pValue: number;
    if (tail === "two") {
      pValue = 2 * (1 - normalCDF(Math.abs(z)));
    } else {
      pValue = 1 - normalCDF(z);
    }

    points.push({
      fraction,
      pValue: Math.max(0, Math.min(1, pValue)),
      significant: pValue < alpha,
      controlRate: pA,
      variantRate: pB,
    });
  }

  return points;
}

/* ==================================================================
   Canvas Drawing — Distribution Curves
   ================================================================== */

function drawDistributions(
  canvas: HTMLCanvasElement,
  result: FrequentistResult,
  control: GroupInput,
  variant: GroupInput,
  alpha: SignificanceLevel,
  tail: TestTail
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = CANVAS_W * dpr;
  canvas.height = CANVAS_H * dpr;
  canvas.style.width = `${CANVAS_W}px`;
  canvas.style.height = `${CANVAS_H}px`;
  ctx.scale(dpr, dpr);

  const pA = result.controlRate;
  const pB = result.variantRate;
  const seA = Math.sqrt((pA * (1 - pA)) / control.visitors);
  const seB = Math.sqrt((pB * (1 - pB)) / variant.visitors);

  if (seA <= 0 && seB <= 0) {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue("--color-text-muted").trim() || "#a1a1aa";
    ctx.font = "14px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Enter data to see distributions", CANVAS_W / 2, CANVAS_H / 2);
    return;
  }

  // Determine plot range
  const minX = Math.min(pA - 4 * Math.max(seA, 0.001), pB - 4 * Math.max(seB, 0.001));
  const maxX = Math.max(pA + 4 * Math.max(seA, 0.001), pB + 4 * Math.max(seB, 0.001));
  const rangeX = maxX - minX || 0.01;

  const pad = { top: 20, bottom: 35, left: 50, right: 20 };
  const plotW = CANVAS_W - pad.left - pad.right;
  const plotH = CANVAS_H - pad.top - pad.bottom;

  const toCanvasX = (val: number) =>
    pad.left + ((val - minX) / rangeX) * plotW;
  const steps = 200;

  // Compute curves
  const curveA: Array<{ x: number; y: number }> = [];
  const curveB: Array<{ x: number; y: number }> = [];
  let maxY = 0;

  for (let i = 0; i <= steps; i++) {
    const x = minX + (i / steps) * rangeX;
    const yA = seA > 0 ? normalPDF((x - pA) / seA) / seA : 0;
    const yB = seB > 0 ? normalPDF((x - pB) / seB) / seB : 0;
    curveA.push({ x, y: yA });
    curveB.push({ x, y: yB });
    maxY = Math.max(maxY, yA, yB);
  }

  if (maxY <= 0) maxY = 1;
  const toCanvasY = (val: number) =>
    pad.top + plotH - (val / maxY) * plotH;

  // Clear
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // Grid lines
  const textMuted = getComputedStyle(canvas).getPropertyValue("--color-text-muted").trim() || "#a1a1aa";
  const borderColor = getComputedStyle(canvas).getPropertyValue("--color-border").trim() || "#27272a";

  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (i / 4) * plotH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(CANVAS_W - pad.right, y);
    ctx.stroke();
  }

  // Rejection regions shading
  const zCrit = tail === "two" ? inverseCDF(1 - alpha / 2) : inverseCDF(1 - alpha);
  const critLow = pA - zCrit * (seA > 0 ? seA : 0.001);
  const critHigh = pA + zCrit * (seA > 0 ? seA : 0.001);

  // Shade rejection region for control distribution
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "#ef4444";

  if (tail === "two") {
    // Left rejection region
    ctx.beginPath();
    ctx.moveTo(toCanvasX(minX), toCanvasY(0));
    for (const pt of curveA) {
      if (pt.x <= critLow) {
        ctx.lineTo(toCanvasX(pt.x), toCanvasY(pt.y));
      }
    }
    ctx.lineTo(toCanvasX(critLow), toCanvasY(0));
    ctx.closePath();
    ctx.fill();

    // Right rejection region
    ctx.beginPath();
    ctx.moveTo(toCanvasX(critHigh), toCanvasY(0));
    for (const pt of curveA) {
      if (pt.x >= critHigh) {
        ctx.lineTo(toCanvasX(pt.x), toCanvasY(pt.y));
      }
    }
    ctx.lineTo(toCanvasX(maxX), toCanvasY(0));
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(toCanvasX(critHigh), toCanvasY(0));
    for (const pt of curveA) {
      if (pt.x >= critHigh) {
        ctx.lineTo(toCanvasX(pt.x), toCanvasY(pt.y));
      }
    }
    ctx.lineTo(toCanvasX(maxX), toCanvasY(0));
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Draw Control curve (A)
  ctx.strokeStyle = "#4f8ff7";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < curveA.length; i++) {
    const cx = toCanvasX(curveA[i].x);
    const cy = toCanvasY(curveA[i].y);
    if (i === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
  }
  ctx.stroke();

  // Fill under control curve
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = "#4f8ff7";
  ctx.beginPath();
  ctx.moveTo(toCanvasX(curveA[0].x), toCanvasY(0));
  for (const pt of curveA) {
    ctx.lineTo(toCanvasX(pt.x), toCanvasY(pt.y));
  }
  ctx.lineTo(toCanvasX(curveA[curveA.length - 1].x), toCanvasY(0));
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // Draw Variant curve (B)
  ctx.strokeStyle = "#34d399";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < curveB.length; i++) {
    const cx = toCanvasX(curveB[i].x);
    const cy = toCanvasY(curveB[i].y);
    if (i === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
  }
  ctx.stroke();

  // Fill under variant curve
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = "#34d399";
  ctx.beginPath();
  ctx.moveTo(toCanvasX(curveB[0].x), toCanvasY(0));
  for (const pt of curveB) {
    ctx.lineTo(toCanvasX(pt.x), toCanvasY(pt.y));
  }
  ctx.lineTo(toCanvasX(curveB[curveB.length - 1].x), toCanvasY(0));
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // Mean lines
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;

  ctx.strokeStyle = "#4f8ff7";
  ctx.beginPath();
  ctx.moveTo(toCanvasX(pA), pad.top);
  ctx.lineTo(toCanvasX(pA), pad.top + plotH);
  ctx.stroke();

  ctx.strokeStyle = "#34d399";
  ctx.beginPath();
  ctx.moveTo(toCanvasX(pB), pad.top);
  ctx.lineTo(toCanvasX(pB), pad.top + plotH);
  ctx.stroke();

  ctx.setLineDash([]);

  // Axes
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top + plotH);
  ctx.lineTo(CANVAS_W - pad.right, pad.top + plotH);
  ctx.stroke();

  // X axis labels
  ctx.fillStyle = textMuted;
  ctx.font = "11px Inter, sans-serif";
  ctx.textAlign = "center";
  for (let i = 0; i <= 5; i++) {
    const val = minX + (i / 5) * rangeX;
    ctx.fillText((val * 100).toFixed(1) + "%", toCanvasX(val), pad.top + plotH + 16);
  }

  // Legend
  ctx.font = "12px Inter, sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = "#4f8ff7";
  ctx.fillRect(pad.left, 4, 12, 12);
  ctx.fillText("Control (A)", pad.left + 16, 14);

  ctx.fillStyle = "#34d399";
  ctx.fillRect(pad.left + 120, 4, 12, 12);
  ctx.fillText("Variant (B)", pad.left + 136, 14);
}

/* ==================================================================
   Canvas Drawing — Confidence Interval
   ================================================================== */

function drawConfidenceInterval(
  canvas: HTMLCanvasElement,
  result: FrequentistResult
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const W = CANVAS_W;
  const H = 80;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  ctx.scale(dpr, dpr);

  const diff = result.variantRate - result.controlRate;
  const pad = { left: 50, right: 20 };
  const plotW = W - pad.left - pad.right;

  const absMax = Math.max(
    Math.abs(result.ciLower),
    Math.abs(result.ciUpper),
    0.001
  ) * 1.5;

  const toX = (val: number) => pad.left + ((val + absMax) / (2 * absMax)) * plotW;
  const midY = H / 2;

  const borderColor = getComputedStyle(canvas).getPropertyValue("--color-border").trim() || "#27272a";
  const textMuted = getComputedStyle(canvas).getPropertyValue("--color-text-muted").trim() || "#a1a1aa";

  ctx.clearRect(0, 0, W, H);

  // Zero line
  ctx.strokeStyle = borderColor;
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(toX(0), 10);
  ctx.lineTo(toX(0), H - 10);
  ctx.stroke();
  ctx.setLineDash([]);

  // CI bar
  const ciColor = result.significant ? "#34d399" : "#a1a1aa";
  ctx.strokeStyle = ciColor;
  ctx.lineWidth = 2;

  // Horizontal line
  ctx.beginPath();
  ctx.moveTo(toX(result.ciLower), midY);
  ctx.lineTo(toX(result.ciUpper), midY);
  ctx.stroke();

  // Error bars (caps)
  ctx.beginPath();
  ctx.moveTo(toX(result.ciLower), midY - 8);
  ctx.lineTo(toX(result.ciLower), midY + 8);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(toX(result.ciUpper), midY - 8);
  ctx.lineTo(toX(result.ciUpper), midY + 8);
  ctx.stroke();

  // Point estimate
  ctx.fillStyle = ciColor;
  ctx.beginPath();
  ctx.arc(toX(diff), midY, 5, 0, Math.PI * 2);
  ctx.fill();

  // Labels
  ctx.fillStyle = textMuted;
  ctx.font = "10px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText((result.ciLower * 100).toFixed(2) + "%", toX(result.ciLower), midY + 22);
  ctx.fillText((result.ciUpper * 100).toFixed(2) + "%", toX(result.ciUpper), midY + 22);
  ctx.fillText("0", toX(0), H - 2);

  ctx.fillStyle = ciColor;
  ctx.font = "11px Inter, sans-serif";
  ctx.fillText((diff * 100).toFixed(2) + "%", toX(diff), midY - 14);
}

/* ==================================================================
   Canvas Drawing — Bayesian Posteriors
   ================================================================== */

function drawBayesianPosteriors(
  canvas: HTMLCanvasElement,
  bayesian: BayesianResult
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = CANVAS_W * dpr;
  canvas.height = CANVAS_H * dpr;
  canvas.style.width = `${CANVAS_W}px`;
  canvas.style.height = `${CANVAS_H}px`;
  ctx.scale(dpr, dpr);

  const { posteriorAlphaA: aA, posteriorBetaA: bA, posteriorAlphaB: aB, posteriorBetaB: bB } = bayesian;

  // Find a good range to plot
  const meanA = aA / (aA + bA);
  const meanB = aB / (aB + bB);
  const varA = (aA * bA) / ((aA + bA) * (aA + bA) * (aA + bA + 1));
  const varB = (aB * bB) / ((aB + bB) * (aB + bB) * (aB + bB + 1));
  const sdA = Math.sqrt(varA);
  const sdB = Math.sqrt(varB);

  const minX = Math.max(0, Math.min(meanA - 5 * sdA, meanB - 5 * sdB));
  const maxX = Math.min(1, Math.max(meanA + 5 * sdA, meanB + 5 * sdB));
  const rangeX = maxX - minX || 0.01;

  const pad = { top: 20, bottom: 35, left: 50, right: 20 };
  const plotW = CANVAS_W - pad.left - pad.right;
  const plotH = CANVAS_H - pad.top - pad.bottom;

  const steps = 200;
  const curveA: Array<{ x: number; y: number }> = [];
  const curveB: Array<{ x: number; y: number }> = [];
  let maxY = 0;

  for (let i = 0; i <= steps; i++) {
    const x = minX + (i / steps) * rangeX;
    const yA = betaPDF(x, aA, bA);
    const yB = betaPDF(x, aB, bB);
    curveA.push({ x, y: isFinite(yA) ? yA : 0 });
    curveB.push({ x, y: isFinite(yB) ? yB : 0 });
    maxY = Math.max(maxY, isFinite(yA) ? yA : 0, isFinite(yB) ? yB : 0);
  }

  if (maxY <= 0) maxY = 1;

  const toCanvasX = (val: number) =>
    pad.left + ((val - minX) / rangeX) * plotW;
  const toCanvasY = (val: number) =>
    pad.top + plotH - (val / maxY) * plotH;

  const borderColor = getComputedStyle(canvas).getPropertyValue("--color-border").trim() || "#27272a";
  const textMuted = getComputedStyle(canvas).getPropertyValue("--color-text-muted").trim() || "#a1a1aa";

  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // Grid
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (i / 4) * plotH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(CANVAS_W - pad.right, y);
    ctx.stroke();
  }

  // Fill under A
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = "#4f8ff7";
  ctx.beginPath();
  ctx.moveTo(toCanvasX(curveA[0].x), toCanvasY(0));
  for (const pt of curveA) ctx.lineTo(toCanvasX(pt.x), toCanvasY(pt.y));
  ctx.lineTo(toCanvasX(curveA[curveA.length - 1].x), toCanvasY(0));
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // Curve A
  ctx.strokeStyle = "#4f8ff7";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < curveA.length; i++) {
    const cx = toCanvasX(curveA[i].x);
    const cy = toCanvasY(curveA[i].y);
    if (i === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
  }
  ctx.stroke();

  // Fill under B
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = "#34d399";
  ctx.beginPath();
  ctx.moveTo(toCanvasX(curveB[0].x), toCanvasY(0));
  for (const pt of curveB) ctx.lineTo(toCanvasX(pt.x), toCanvasY(pt.y));
  ctx.lineTo(toCanvasX(curveB[curveB.length - 1].x), toCanvasY(0));
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // Curve B
  ctx.strokeStyle = "#34d399";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < curveB.length; i++) {
    const cx = toCanvasX(curveB[i].x);
    const cy = toCanvasY(curveB[i].y);
    if (i === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
  }
  ctx.stroke();

  // Axis
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top + plotH);
  ctx.lineTo(CANVAS_W - pad.right, pad.top + plotH);
  ctx.stroke();

  // X labels
  ctx.fillStyle = textMuted;
  ctx.font = "11px Inter, sans-serif";
  ctx.textAlign = "center";
  for (let i = 0; i <= 5; i++) {
    const val = minX + (i / 5) * rangeX;
    ctx.fillText((val * 100).toFixed(1) + "%", toCanvasX(val), pad.top + plotH + 16);
  }

  // Legend
  ctx.font = "12px Inter, sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = "#4f8ff7";
  ctx.fillRect(pad.left, 4, 12, 12);
  ctx.fillText(`Posterior A (Beta(${aA}, ${bA}))`, pad.left + 16, 14);

  ctx.fillStyle = "#34d399";
  ctx.fillRect(pad.left + 240, 4, 12, 12);
  ctx.fillText(`Posterior B (Beta(${aB}, ${bB}))`, pad.left + 256, 14);
}

/* ==================================================================
   Canvas Drawing — Power Curve
   ================================================================== */

function drawPowerCurve(
  canvas: HTMLCanvasElement,
  power: PowerResult,
  targetPower: number
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = CANVAS_W * dpr;
  canvas.height = POWER_CANVAS_H * dpr;
  canvas.style.width = `${CANVAS_W}px`;
  canvas.style.height = `${POWER_CANVAS_H}px`;
  ctx.scale(dpr, dpr);

  const pad = { top: 20, bottom: 35, left: 50, right: 20 };
  const plotW = CANVAS_W - pad.left - pad.right;
  const plotH = POWER_CANVAS_H - pad.top - pad.bottom;

  const { powerCurve } = power;
  if (powerCurve.length === 0) return;

  const maxN = powerCurve[powerCurve.length - 1].n;
  const toX = (n: number) => pad.left + (n / maxN) * plotW;
  const toY = (p: number) => pad.top + plotH - p * plotH;

  const borderColor = getComputedStyle(canvas).getPropertyValue("--color-border").trim() || "#27272a";
  const textMuted = getComputedStyle(canvas).getPropertyValue("--color-text-muted").trim() || "#a1a1aa";

  ctx.clearRect(0, 0, CANVAS_W, POWER_CANVAS_H);

  // Grid
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (i / 4) * plotH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(CANVAS_W - pad.right, y);
    ctx.stroke();
  }

  // Target power line
  ctx.strokeStyle = "#fbbf24";
  ctx.setLineDash([6, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, toY(targetPower));
  ctx.lineTo(CANVAS_W - pad.right, toY(targetPower));
  ctx.stroke();
  ctx.setLineDash([]);

  // Required sample size line
  if (isFinite(power.requiredSampleSize) && power.requiredSampleSize <= maxN) {
    ctx.strokeStyle = "#ef4444";
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(toX(power.requiredSampleSize), pad.top);
    ctx.lineTo(toX(power.requiredSampleSize), pad.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Power curve
  ctx.strokeStyle = "#4f8ff7";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < powerCurve.length; i++) {
    const cx = toX(powerCurve[i].n);
    const cy = toY(powerCurve[i].power);
    if (i === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
  }
  ctx.stroke();

  // Fill under
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = "#4f8ff7";
  ctx.beginPath();
  ctx.moveTo(toX(powerCurve[0].n), toY(0));
  for (const pt of powerCurve) ctx.lineTo(toX(pt.n), toY(pt.power));
  ctx.lineTo(toX(powerCurve[powerCurve.length - 1].n), toY(0));
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // Axes
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top + plotH);
  ctx.lineTo(CANVAS_W - pad.right, pad.top + plotH);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + plotH);
  ctx.stroke();

  // X labels
  ctx.fillStyle = textMuted;
  ctx.font = "11px Inter, sans-serif";
  ctx.textAlign = "center";
  for (let i = 0; i <= 5; i++) {
    const n = Math.round((i / 5) * maxN);
    const label = n >= 1000 ? (n / 1000).toFixed(0) + "k" : String(n);
    ctx.fillText(label, toX(n), pad.top + plotH + 16);
  }
  ctx.fillText("Sample size per group", pad.left + plotW / 2, pad.top + plotH + 30);

  // Y labels
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const val = i / 4;
    ctx.fillText((val * 100).toFixed(0) + "%", pad.left - 6, toY(val) + 4);
  }

  // Legend
  ctx.font = "11px Inter, sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = "#fbbf24";
  ctx.fillText(`Target: ${(targetPower * 100).toFixed(0)}%`, pad.left + plotW - 180, 14);
  ctx.fillStyle = "#ef4444";
  if (isFinite(power.requiredSampleSize)) {
    ctx.fillText(
      `n = ${power.requiredSampleSize.toLocaleString()}`,
      pad.left + plotW - 80,
      14
    );
  }
}

/* ==================================================================
   Canvas Drawing — Sequential Testing
   ================================================================== */

function drawSequential(
  canvas: HTMLCanvasElement,
  points: SequentialPoint[],
  alpha: SignificanceLevel
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = CANVAS_W * dpr;
  canvas.height = CANVAS_H * dpr;
  canvas.style.width = `${CANVAS_W}px`;
  canvas.style.height = `${CANVAS_H}px`;
  ctx.scale(dpr, dpr);

  const pad = { top: 20, bottom: 35, left: 50, right: 20 };
  const plotW = CANVAS_W - pad.left - pad.right;
  const plotH = CANVAS_H - pad.top - pad.bottom;

  const toX = (f: number) => pad.left + f * plotW;
  // p-value on log scale capped at 1
  const minP = 0.001;
  const maxP = 1;
  const toY = (p: number) => {
    const clamped = Math.max(minP, Math.min(maxP, p));
    const logMin = Math.log10(minP);
    const logMax = Math.log10(maxP);
    const logVal = Math.log10(clamped);
    return pad.top + ((logMax - logVal) / (logMax - logMin)) * plotH;
  };

  const borderColor = getComputedStyle(canvas).getPropertyValue("--color-border").trim() || "#27272a";
  const textMuted = getComputedStyle(canvas).getPropertyValue("--color-text-muted").trim() || "#a1a1aa";

  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // Grid
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 0.5;
  for (const p of [1, 0.1, 0.01, 0.001]) {
    const y = toY(p);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(CANVAS_W - pad.right, y);
    ctx.stroke();
  }

  // Significance threshold line
  ctx.strokeStyle = "#ef4444";
  ctx.setLineDash([6, 3]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pad.left, toY(alpha));
  ctx.lineTo(CANVAS_W - pad.right, toY(alpha));
  ctx.stroke();
  ctx.setLineDash([]);

  // Shade significant region
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = "#34d399";
  ctx.fillRect(pad.left, toY(minP), plotW, toY(alpha) - toY(minP));
  ctx.globalAlpha = 1;

  // p-value curve
  ctx.strokeStyle = "#4f8ff7";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const cx = toX(points[i].fraction);
    const cy = toY(points[i].pValue);
    if (i === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
  }
  ctx.stroke();

  // Mark significant points
  for (const pt of points) {
    if (pt.significant) {
      ctx.fillStyle = "#34d399";
      ctx.beginPath();
      ctx.arc(toX(pt.fraction), toY(pt.pValue), 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Axes
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top + plotH);
  ctx.lineTo(CANVAS_W - pad.right, pad.top + plotH);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + plotH);
  ctx.stroke();

  // X labels
  ctx.fillStyle = textMuted;
  ctx.font = "11px Inter, sans-serif";
  ctx.textAlign = "center";
  for (let i = 0; i <= 5; i++) {
    const f = i / 5;
    ctx.fillText((f * 100).toFixed(0) + "%", toX(f), pad.top + plotH + 16);
  }
  ctx.fillText("% of data observed", pad.left + plotW / 2, pad.top + plotH + 30);

  // Y labels (log scale)
  ctx.textAlign = "right";
  for (const p of [1, 0.1, 0.01, 0.001]) {
    ctx.fillText(String(p), pad.left - 6, toY(p) + 4);
  }

  // Legend
  ctx.font = "11px Inter, sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = "#ef4444";
  ctx.fillText(`alpha = ${alpha}`, CANVAS_W - pad.right - 80, 14);
}

/* ==================================================================
   Utility: Input component
   ================================================================== */

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label class="flex flex-col gap-1">
      <span class="text-xs text-[var(--color-text-muted)]">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onInput={(e) => {
          const v = parseFloat((e.target as HTMLInputElement).value);
          if (!isNaN(v)) onChange(v);
        }}
        class="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
      />
    </label>
  );
}

/* ==================================================================
   Main Component
   ================================================================== */

export default function AbTestCalc() {
  // State: Inputs
  const [control, setControl] = useState<GroupInput>({ visitors: 5000, conversions: 250 });
  const [variant, setVariant] = useState<GroupInput>({ visitors: 5000, conversions: 375 });
  const [alpha, setAlpha] = useState<SignificanceLevel>(0.05);
  const [tail, setTail] = useState<TestTail>("two");
  const [activeTab, setActiveTab] = useState<ActiveTab>("frequentist");

  // Power analysis inputs
  const [baselineRate, setBaselineRate] = useState(5);
  const [mdeInput, setMdeInput] = useState(1);

  // Sequential slider
  const [seqSlider, setSeqSlider] = useState(100);

  // Canvas refs
  const distCanvasRef = useRef<HTMLCanvasElement>(null);
  const ciCanvasRef = useRef<HTMLCanvasElement>(null);
  const bayesCanvasRef = useRef<HTMLCanvasElement>(null);
  const powerCanvasRef = useRef<HTMLCanvasElement>(null);
  const seqCanvasRef = useRef<HTMLCanvasElement>(null);

  // Validate inputs
  const validControl =
    control.visitors > 0 &&
    control.conversions >= 0 &&
    control.conversions <= control.visitors;
  const validVariant =
    variant.visitors > 0 &&
    variant.conversions >= 0 &&
    variant.conversions <= variant.visitors;
  const validInputs = validControl && validVariant;

  // Compute results
  const freqResult = validInputs
    ? computeFrequentist(control, variant, alpha, tail)
    : null;

  const bayesResult = validInputs
    ? computeBayesian(control, variant)
    : null;

  const powerResult = computePowerAnalysis(
    baselineRate / 100,
    mdeInput / 100,
    alpha,
    tail
  );

  const seqPoints = validInputs
    ? computeSequential(control, variant, alpha, tail, seqSlider)
    : [];

  // Draw canvases on data change
  useEffect(() => {
    if (activeTab === "frequentist" && freqResult) {
      if (distCanvasRef.current) {
        drawDistributions(distCanvasRef.current, freqResult, control, variant, alpha, tail);
      }
      if (ciCanvasRef.current) {
        drawConfidenceInterval(ciCanvasRef.current, freqResult);
      }
    }
  }, [activeTab, freqResult, control, variant, alpha, tail]);

  useEffect(() => {
    if (activeTab === "bayesian" && bayesResult && bayesCanvasRef.current) {
      drawBayesianPosteriors(bayesCanvasRef.current, bayesResult);
    }
  }, [activeTab, bayesResult]);

  useEffect(() => {
    if (activeTab === "power" && powerCanvasRef.current) {
      drawPowerCurve(powerCanvasRef.current, powerResult, 0.8);
    }
  }, [activeTab, powerResult]);

  useEffect(() => {
    if (activeTab === "sequential" && seqCanvasRef.current && seqPoints.length > 0) {
      drawSequential(seqCanvasRef.current, seqPoints, alpha);
    }
  }, [activeTab, seqPoints, alpha]);

  // Preset handler
  const applyPreset = useCallback((preset: Preset) => {
    setControl(preset.control);
    setVariant(preset.variant);
  }, []);

  const tabs: Array<{ id: ActiveTab; label: string }> = [
    { id: "frequentist", label: "Frequentist" },
    { id: "bayesian", label: "Bayesian" },
    { id: "power", label: "Power Analysis" },
    { id: "sequential", label: "Sequential" },
  ];

  return (
    <div class="space-y-6">
      {/* Preset buttons */}
      <div class="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.name}
            onClick={() => applyPreset(p)}
            class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
            title={p.description}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* Input panel */}
      <div class="grid gap-6 sm:grid-cols-2">
        {/* Control (A) */}
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--color-heading)]">
            <span class="inline-block h-3 w-3 rounded-full" style="background:#4f8ff7" />
            Control (A)
          </h3>
          <div class="grid grid-cols-2 gap-3">
            <NumberInput
              label="Visitors"
              value={control.visitors}
              onChange={(v) => setControl({ ...control, visitors: Math.max(1, Math.round(v)) })}
              min={1}
            />
            <NumberInput
              label="Conversions"
              value={control.conversions}
              onChange={(v) =>
                setControl({ ...control, conversions: Math.max(0, Math.min(control.visitors, Math.round(v))) })
              }
              min={0}
              max={control.visitors}
            />
          </div>
          {validControl && (
            <p class="mt-2 text-xs text-[var(--color-text-muted)]">
              Rate: {((control.conversions / control.visitors) * 100).toFixed(2)}%
            </p>
          )}
        </div>

        {/* Variant (B) */}
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--color-heading)]">
            <span class="inline-block h-3 w-3 rounded-full" style="background:#34d399" />
            Variant (B)
          </h3>
          <div class="grid grid-cols-2 gap-3">
            <NumberInput
              label="Visitors"
              value={variant.visitors}
              onChange={(v) => setVariant({ ...variant, visitors: Math.max(1, Math.round(v)) })}
              min={1}
            />
            <NumberInput
              label="Conversions"
              value={variant.conversions}
              onChange={(v) =>
                setVariant({ ...variant, conversions: Math.max(0, Math.min(variant.visitors, Math.round(v))) })
              }
              min={0}
              max={variant.visitors}
            />
          </div>
          {validVariant && (
            <p class="mt-2 text-xs text-[var(--color-text-muted)]">
              Rate: {((variant.conversions / variant.visitors) * 100).toFixed(2)}%
            </p>
          )}
        </div>
      </div>

      {/* Parameters */}
      <div class="flex flex-wrap items-end gap-4">
        <label class="flex flex-col gap-1">
          <span class="text-xs text-[var(--color-text-muted)]">Significance level</span>
          <select
            value={alpha}
            onChange={(e) => setAlpha(parseFloat((e.target as HTMLSelectElement).value) as SignificanceLevel)}
            class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          >
            <option value={0.1}>90% (alpha = 0.10)</option>
            <option value={0.05}>95% (alpha = 0.05)</option>
            <option value={0.01}>99% (alpha = 0.01)</option>
          </select>
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-xs text-[var(--color-text-muted)]">Tail</span>
          <select
            value={tail}
            onChange={(e) => setTail((e.target as HTMLSelectElement).value as TestTail)}
            class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          >
            <option value="two">Two-tailed</option>
            <option value="one">One-tailed</option>
          </select>
        </label>
      </div>

      {/* Tab navigation */}
      <div class="flex gap-1 border-b border-[var(--color-border)]">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            class={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === t.id
                ? "border-b-2 border-[var(--color-primary)] text-[var(--color-heading)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-heading)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "frequentist" && freqResult && (
        <div class="space-y-6">
          {/* Significance badge */}
          <div class="flex items-center gap-3">
            <span
              class={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${
                freqResult.significant
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-zinc-500/15 text-zinc-400"
              }`}
            >
              {freqResult.significant ? "Statistically Significant" : "Not Significant"}
            </span>
            <span class="text-sm text-[var(--color-text-muted)]">
              at {((1 - alpha) * 100).toFixed(0)}% confidence
            </span>
          </div>

          {/* Results grid */}
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ResultCard label="p-value (Z-test)" value={freqResult.pValue.toFixed(4)} highlight={freqResult.significant} />
            <ResultCard label="Z-statistic" value={freqResult.zStatistic.toFixed(3)} />
            <ResultCard label="Relative uplift" value={`${freqResult.relativeUplift >= 0 ? "+" : ""}${freqResult.relativeUplift.toFixed(2)}%`} highlight={freqResult.relativeUplift > 0 && freqResult.significant} />
            <ResultCard label="Chi-squared" value={freqResult.chiSquared.toFixed(3)} />
            <ResultCard label="Chi-squared p-value" value={freqResult.chiPValue.toFixed(4)} />
            <ResultCard label="Effect size (Cohen's h)" value={freqResult.effectSize.toFixed(4)} />
            <ResultCard label="CI width" value={`${(freqResult.ciWidth * 100).toFixed(3)}pp`} />
            <ResultCard label="Min. detectable effect" value={`${(freqResult.mde * 100).toFixed(3)}pp`} />
          </div>

          {/* Distribution chart */}
          <div class="space-y-2">
            <h3 class="text-sm font-semibold text-[var(--color-heading)]">
              Sampling Distributions
            </h3>
            <div class="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
              <canvas
                ref={distCanvasRef}
                style={`width:${CANVAS_W}px;height:${CANVAS_H}px`}
              />
            </div>
          </div>

          {/* CI visualization */}
          <div class="space-y-2">
            <h3 class="text-sm font-semibold text-[var(--color-heading)]">
              Confidence Interval (B - A)
            </h3>
            <div class="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
              <canvas
                ref={ciCanvasRef}
                style={`width:${CANVAS_W}px;height:80px`}
              />
            </div>
            <p class="text-xs text-[var(--color-text-muted)]">
              {(freqResult.ciLower * 100).toFixed(3)}% to {(freqResult.ciUpper * 100).toFixed(3)}%
              {freqResult.ciLower > 0
                ? " — interval excludes zero, difference is significant"
                : freqResult.ciUpper < 0
                  ? " — interval is entirely negative"
                  : " — interval includes zero"}
            </p>
          </div>
        </div>
      )}

      {activeTab === "bayesian" && bayesResult && (
        <div class="space-y-6">
          {/* Bayesian summary */}
          <div class="grid gap-4 sm:grid-cols-3">
            <ResultCard
              label="P(B > A)"
              value={`${(bayesResult.probBbeatsA * 100).toFixed(1)}%`}
              highlight={bayesResult.probBbeatsA > 0.95}
            />
            <ResultCard
              label="Expected loss (choose A)"
              value={`${(bayesResult.expectedLossA * 100).toFixed(4)}pp`}
            />
            <ResultCard
              label="Expected loss (choose B)"
              value={`${(bayesResult.expectedLossB * 100).toFixed(4)}pp`}
            />
          </div>

          <div class="space-y-2">
            <h3 class="text-sm font-semibold text-[var(--color-heading)]">
              Posterior Beta Distributions
            </h3>
            <div class="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
              <canvas
                ref={bayesCanvasRef}
                style={`width:${CANVAS_W}px;height:${CANVAS_H}px`}
              />
            </div>
            <p class="text-xs text-[var(--color-text-muted)]">
              Using uniform prior Beta(1, 1). Posteriors: A = Beta({bayesResult.posteriorAlphaA}, {bayesResult.posteriorBetaA}), B = Beta({bayesResult.posteriorAlphaB}, {bayesResult.posteriorBetaB})
            </p>
          </div>

          {/* Recommendation */}
          <div
            class={`rounded-lg border p-4 ${
              bayesResult.probBbeatsA > 0.95
                ? "border-emerald-500/30 bg-emerald-500/5"
                : bayesResult.probBbeatsA < 0.05
                  ? "border-red-500/30 bg-red-500/5"
                  : "border-[var(--color-border)] bg-[var(--color-surface)]"
            }`}
          >
            <p class="text-sm text-[var(--color-text)]">
              {bayesResult.probBbeatsA > 0.95
                ? `Strong evidence that Variant B is better. There is a ${(bayesResult.probBbeatsA * 100).toFixed(1)}% probability that B outperforms A.`
                : bayesResult.probBbeatsA < 0.05
                  ? `Strong evidence that Control A is better. There is only a ${(bayesResult.probBbeatsA * 100).toFixed(1)}% probability that B outperforms A.`
                  : `Inconclusive. P(B > A) = ${(bayesResult.probBbeatsA * 100).toFixed(1)}%. Consider collecting more data.`}
            </p>
          </div>
        </div>
      )}

      {activeTab === "power" && (
        <div class="space-y-6">
          <div class="grid gap-4 sm:grid-cols-3">
            <NumberInput
              label="Baseline rate (%)"
              value={baselineRate}
              onChange={(v) => setBaselineRate(Math.max(0.1, Math.min(99.9, v)))}
              min={0.1}
              max={99.9}
              step={0.1}
            />
            <NumberInput
              label="Minimum detectable effect (pp)"
              value={mdeInput}
              onChange={(v) => setMdeInput(Math.max(0.01, v))}
              min={0.01}
              step={0.1}
            />
            <div class="flex flex-col justify-end">
              <p class="text-xs text-[var(--color-text-muted)]">Required sample size per group</p>
              <p class="text-xl font-bold text-[var(--color-heading)]">
                {isFinite(powerResult.requiredSampleSize)
                  ? powerResult.requiredSampleSize.toLocaleString()
                  : "N/A"}
              </p>
            </div>
          </div>

          <div class="space-y-2">
            <h3 class="text-sm font-semibold text-[var(--color-heading)]">
              Power Curve (80% target)
            </h3>
            <div class="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
              <canvas
                ref={powerCanvasRef}
                style={`width:${CANVAS_W}px;height:${POWER_CANVAS_H}px`}
              />
            </div>
            <p class="text-xs text-[var(--color-text-muted)]">
              To detect a {mdeInput}pp change from a {baselineRate}% baseline at{" "}
              {((1 - alpha) * 100).toFixed(0)}% confidence with 80% power, you need{" "}
              {isFinite(powerResult.requiredSampleSize)
                ? powerResult.requiredSampleSize.toLocaleString()
                : "more"}{" "}
              visitors per group ({isFinite(powerResult.requiredSampleSize)
                ? (powerResult.requiredSampleSize * 2).toLocaleString()
                : "more"}{" "}
              total).
            </p>
          </div>
        </div>
      )}

      {activeTab === "sequential" && (
        <div class="space-y-6">
          <div class="space-y-2">
            <label class="flex items-center gap-3">
              <span class="text-sm text-[var(--color-text-muted)]">Data observed:</span>
              <input
                type="range"
                min={5}
                max={100}
                value={seqSlider}
                onInput={(e) => setSeqSlider(parseInt((e.target as HTMLInputElement).value, 10))}
                class="flex-1"
              />
              <span class="w-12 text-right text-sm font-medium text-[var(--color-heading)]">
                {seqSlider}%
              </span>
            </label>
          </div>

          <div class="space-y-2">
            <h3 class="text-sm font-semibold text-[var(--color-heading)]">
              p-value Evolution (Log Scale)
            </h3>
            <div class="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
              <canvas
                ref={seqCanvasRef}
                style={`width:${CANVAS_W}px;height:${CANVAS_H}px`}
              />
            </div>
            {seqPoints.length > 0 && (
              <div class="flex flex-wrap gap-4 text-xs text-[var(--color-text-muted)]">
                <span>
                  Current p-value: <strong class="text-[var(--color-heading)]">{seqPoints[seqPoints.length - 1].pValue.toFixed(4)}</strong>
                </span>
                <span>
                  First significant at:{" "}
                  <strong class="text-[var(--color-heading)]">
                    {(() => {
                      const first = seqPoints.find((p) => p.significant);
                      return first
                        ? `${(first.fraction * 100).toFixed(0)}% of data`
                        : "not reached";
                    })()}
                  </strong>
                </span>
              </div>
            )}
          </div>

          <div class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
            <p class="text-xs text-[var(--color-text-muted)]">
              <strong class="text-amber-400">Warning:</strong> Repeatedly checking significance as data accumulates inflates false positive rates (peeking problem). Use this view for exploration only. For rigorous sequential analysis, apply methods like O'Brien-Fleming or alpha-spending functions.
            </p>
          </div>
        </div>
      )}

      {!validInputs && (
        <div class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-[var(--color-text-muted)]">
          Please enter valid data: visitors must be positive, and conversions must be between 0 and the number of visitors.
        </div>
      )}
    </div>
  );
}

/* ==================================================================
   Result Card subcomponent
   ================================================================== */

function ResultCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <p class="text-xs text-[var(--color-text-muted)]">{label}</p>
      <p
        class={`mt-1 text-lg font-bold ${
          highlight ? "text-emerald-400" : "text-[var(--color-heading)]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
