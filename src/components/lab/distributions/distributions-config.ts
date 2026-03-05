// ─────────────────────────────────────────────────────────
// Distribution definitions — all 15 distributions with
// parameter configs, PDF/CDF functions, x-ranges, and stats.
// ─────────────────────────────────────────────────────────

import type { DistributionDef, PresetComparison } from "./types";
import {
  normalPdf,
  normalCdf,
  logNormalPdf,
  logNormalCdf,
  exponentialPdf,
  exponentialCdf,
  uniformPdf,
  uniformCdf,
  betaPdf,
  betaCdf,
  gammaPdf,
  gammaCdf,
  chiSquaredPdf,
  chiSquaredCdf,
  studentTPdf,
  studentTCdf,
  cauchyPdf,
  cauchyCdf,
  weibullPdf,
  weibullCdf,
  bernoulliPmf,
  bernoulliCdf,
  binomialPmf,
  binomialCdf,
  poissonPmf,
  poissonCdf,
  geometricPmf,
  geometricCdf,
  negativeBinomialPmf,
  negativeBinomialCdf,
  gamma as gammaFn,
} from "./math";

// ─────────────────────────────────────────────────────────
// Continuous Distributions
// ─────────────────────────────────────────────────────────

const normal: DistributionDef = {
  id: "normal",
  name: "Normal",
  color: "#4f8ff7",
  type: "continuous",
  parameters: [
    { name: "mu", label: "\u03BC (mean)", min: -5, max: 5, step: 0.1, defaultValue: 0 },
    { name: "sigma", label: "\u03C3 (std dev)", min: 0.1, max: 5, step: 0.1, defaultValue: 1 },
  ],
  pdf: (x, p) => normalPdf(x, p[0], p[1]),
  cdf: (x, p) => normalCdf(x, p[0], p[1]),
  xRange: (p) => [p[0] - 4 * p[1], p[0] + 4 * p[1]],
  stats: (p) => ({
    mean: p[0],
    variance: p[1] * p[1],
    stdDev: p[1],
    skewness: 0,
    kurtosis: 3,
    mode: p[0],
    median: p[0],
  }),
};

const logNormal: DistributionDef = {
  id: "log-normal",
  name: "Log-Normal",
  color: "#06b6d4",
  type: "continuous",
  parameters: [
    { name: "mu", label: "\u03BC", min: -2, max: 2, step: 0.1, defaultValue: 0 },
    { name: "sigma", label: "\u03C3", min: 0.1, max: 2, step: 0.1, defaultValue: 0.5 },
  ],
  pdf: (x, p) => logNormalPdf(x, p[0], p[1]),
  cdf: (x, p) => logNormalCdf(x, p[0], p[1]),
  xRange: (p) => [0, Math.exp(p[0] + 3 * p[1])],
  stats: (p) => {
    const mu = p[0];
    const s = p[1];
    const s2 = s * s;
    const meanVal = Math.exp(mu + s2 / 2);
    const varianceVal = (Math.exp(s2) - 1) * Math.exp(2 * mu + s2);
    return {
      mean: meanVal,
      variance: varianceVal,
      stdDev: Math.sqrt(varianceVal),
      skewness: (Math.exp(s2) + 2) * Math.sqrt(Math.exp(s2) - 1),
      kurtosis: Math.exp(4 * s2) + 2 * Math.exp(3 * s2) + 3 * Math.exp(2 * s2) - 6,
      mode: Math.exp(mu - s2),
      median: Math.exp(mu),
    };
  },
};

const exponential: DistributionDef = {
  id: "exponential",
  name: "Exponential",
  color: "#ec4899",
  type: "continuous",
  parameters: [
    { name: "lambda", label: "\u03BB (rate)", min: 0.1, max: 5, step: 0.1, defaultValue: 1 },
  ],
  pdf: (x, p) => exponentialPdf(x, p[0]),
  cdf: (x, p) => exponentialCdf(x, p[0]),
  xRange: (p) => [0, 5 / p[0]],
  stats: (p) => ({
    mean: 1 / p[0],
    variance: 1 / (p[0] * p[0]),
    stdDev: 1 / p[0],
    skewness: 2,
    kurtosis: 9,
    mode: 0,
    median: Math.log(2) / p[0],
  }),
};

const uniform: DistributionDef = {
  id: "uniform",
  name: "Uniform",
  color: "#84cc16",
  type: "continuous",
  parameters: [
    { name: "a", label: "a (min)", min: -5, max: 4, step: 0.1, defaultValue: 0 },
    { name: "b", label: "b (max)", min: -4, max: 5, step: 0.1, defaultValue: 1 },
  ],
  pdf: (x, p) => uniformPdf(x, Math.min(p[0], p[1]), Math.max(p[0], p[1]) === p[0] ? p[0] + 0.1 : Math.max(p[0], p[1])),
  cdf: (x, p) => uniformCdf(x, Math.min(p[0], p[1]), Math.max(p[0], p[1]) === p[0] ? p[0] + 0.1 : Math.max(p[0], p[1])),
  xRange: (p) => {
    const a = Math.min(p[0], p[1]);
    const b = Math.max(p[0], p[1]) === a ? a + 0.1 : Math.max(p[0], p[1]);
    const margin = (b - a) * 0.3;
    return [a - margin, b + margin];
  },
  stats: (p) => {
    const a = Math.min(p[0], p[1]);
    const b = Math.max(p[0], p[1]) === a ? a + 0.1 : Math.max(p[0], p[1]);
    const range = b - a;
    return {
      mean: (a + b) / 2,
      variance: (range * range) / 12,
      stdDev: range / Math.sqrt(12),
      skewness: 0,
      kurtosis: 1.8,
      mode: "Any value in [a, b]",
      median: (a + b) / 2,
    };
  },
};

const betaDist: DistributionDef = {
  id: "beta",
  name: "Beta",
  color: "#34d399",
  type: "continuous",
  parameters: [
    { name: "alpha", label: "\u03B1", min: 0.1, max: 10, step: 0.1, defaultValue: 2 },
    { name: "beta", label: "\u03B2", min: 0.1, max: 10, step: 0.1, defaultValue: 5 },
  ],
  pdf: (x, p) => betaPdf(x, p[0], p[1]),
  cdf: (x, p) => betaCdf(x, p[0], p[1]),
  xRange: () => [0, 1],
  stats: (p) => {
    const a = p[0];
    const b = p[1];
    const meanVal = a / (a + b);
    const varianceVal = (a * b) / ((a + b) ** 2 * (a + b + 1));
    const modeVal = a > 1 && b > 1 ? (a - 1) / (a + b - 2) : (a <= 1 && b <= 1 ? "Bimodal at 0, 1" : (a <= 1 ? 0 : 1));
    return {
      mean: meanVal,
      variance: varianceVal,
      stdDev: Math.sqrt(varianceVal),
      skewness: (2 * (b - a) * Math.sqrt(a + b + 1)) / ((a + b + 2) * Math.sqrt(a * b)),
      kurtosis: 3 + (6 * ((a - b) ** 2 * (a + b + 1) - a * b * (a + b + 2))) / (a * b * (a + b + 2) * (a + b + 3)),
      mode: modeVal,
      median: "~" + meanVal.toFixed(4),
    };
  },
};

const gammaDist: DistributionDef = {
  id: "gamma",
  name: "Gamma",
  color: "#f59e0b",
  type: "continuous",
  parameters: [
    { name: "k", label: "k (shape)", min: 0.1, max: 10, step: 0.1, defaultValue: 2 },
    { name: "theta", label: "\u03B8 (scale)", min: 0.1, max: 5, step: 0.1, defaultValue: 1 },
  ],
  pdf: (x, p) => gammaPdf(x, p[0], p[1]),
  cdf: (x, p) => gammaCdf(x, p[0], p[1]),
  xRange: (p) => [0, p[0] * p[1] + 5 * Math.sqrt(p[0]) * p[1]],
  stats: (p) => {
    const k = p[0];
    const theta = p[1];
    return {
      mean: k * theta,
      variance: k * theta * theta,
      stdDev: Math.sqrt(k) * theta,
      skewness: 2 / Math.sqrt(k),
      kurtosis: 3 + 6 / k,
      mode: k >= 1 ? (k - 1) * theta : 0,
      median: "~" + (k * theta * Math.pow(1 - 1 / (9 * k), 3)).toFixed(4),
    };
  },
};

const chiSquared: DistributionDef = {
  id: "chi-squared",
  name: "Chi-Squared",
  color: "#f97316",
  type: "continuous",
  parameters: [
    { name: "k", label: "k (degrees of freedom)", min: 1, max: 20, step: 1, defaultValue: 3 },
  ],
  pdf: (x, p) => chiSquaredPdf(x, p[0]),
  cdf: (x, p) => chiSquaredCdf(x, p[0]),
  xRange: (p) => [0, p[0] + 4 * Math.sqrt(2 * p[0])],
  stats: (p) => {
    const k = p[0];
    return {
      mean: k,
      variance: 2 * k,
      stdDev: Math.sqrt(2 * k),
      skewness: Math.sqrt(8 / k),
      kurtosis: 3 + 12 / k,
      mode: Math.max(k - 2, 0),
      median: k * Math.pow(1 - 2 / (9 * k), 3),
    };
  },
};

const studentT: DistributionDef = {
  id: "student-t",
  name: "Student's t",
  color: "#8b5cf6",
  type: "continuous",
  parameters: [
    { name: "nu", label: "\u03BD (degrees of freedom)", min: 1, max: 30, step: 1, defaultValue: 3 },
  ],
  pdf: (x, p) => studentTPdf(x, p[0]),
  cdf: (x, p) => studentTCdf(x, p[0]),
  xRange: (p) => {
    const spread = p[0] <= 2 ? 8 : 4 * Math.sqrt(p[0] / (p[0] - 2));
    return [-Math.max(spread, 5), Math.max(spread, 5)];
  },
  stats: (p) => {
    const nu = p[0];
    return {
      mean: nu > 1 ? 0 : "Undefined",
      variance: nu > 2 ? nu / (nu - 2) : (nu > 1 ? "\u221E" : "Undefined"),
      stdDev: nu > 2 ? Math.sqrt(nu / (nu - 2)) : (nu > 1 ? "\u221E" : "Undefined"),
      skewness: nu > 3 ? 0 : "Undefined",
      kurtosis: nu > 4 ? 3 + 6 / (nu - 4) : (nu > 2 ? "\u221E" : "Undefined"),
      mode: 0,
      median: 0,
    };
  },
};

const cauchy: DistributionDef = {
  id: "cauchy",
  name: "Cauchy",
  color: "#e11d48",
  type: "continuous",
  parameters: [
    { name: "x0", label: "x\u2080 (location)", min: -5, max: 5, step: 0.1, defaultValue: 0 },
    { name: "gamma", label: "\u03B3 (scale)", min: 0.1, max: 5, step: 0.1, defaultValue: 1 },
  ],
  pdf: (x, p) => cauchyPdf(x, p[0], p[1]),
  cdf: (x, p) => cauchyCdf(x, p[0], p[1]),
  xRange: (p) => [p[0] - 10 * p[1], p[0] + 10 * p[1]],
  stats: (p) => ({
    mean: "Undefined",
    variance: "Undefined",
    stdDev: "Undefined",
    skewness: "Undefined",
    kurtosis: "Undefined",
    mode: p[0],
    median: p[0],
  }),
};

const weibull: DistributionDef = {
  id: "weibull",
  name: "Weibull",
  color: "#14b8a6",
  type: "continuous",
  parameters: [
    { name: "k", label: "k (shape)", min: 0.1, max: 5, step: 0.1, defaultValue: 1.5 },
    { name: "lambda", label: "\u03BB (scale)", min: 0.1, max: 5, step: 0.1, defaultValue: 1 },
  ],
  pdf: (x, p) => weibullPdf(x, p[0], p[1]),
  cdf: (x, p) => weibullCdf(x, p[0], p[1]),
  xRange: (p) => [0, p[1] * Math.pow(-Math.log(0.001), 1 / p[0])],
  stats: (p) => {
    const k = p[0];
    const lam = p[1];
    const meanVal = lam * gammaFn(1 + 1 / k);
    const e2 = lam * lam * gammaFn(1 + 2 / k);
    const varianceVal = e2 - meanVal * meanVal;
    const modeVal = k > 1 ? lam * Math.pow((k - 1) / k, 1 / k) : 0;
    return {
      mean: meanVal,
      variance: varianceVal,
      stdDev: Math.sqrt(Math.max(0, varianceVal)),
      skewness: "Computed",
      kurtosis: "Computed",
      mode: modeVal,
      median: lam * Math.pow(Math.log(2), 1 / k),
    };
  },
};

// ─────────────────────────────────────────────────────────
// Discrete Distributions
// ─────────────────────────────────────────────────────────

const bernoulli: DistributionDef = {
  id: "bernoulli",
  name: "Bernoulli",
  color: "#6366f1",
  type: "discrete",
  parameters: [
    { name: "p", label: "p (probability)", min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
  ],
  pdf: (k, p) => bernoulliPmf(Math.round(k), p[0]),
  cdf: (k, p) => bernoulliCdf(k, p[0]),
  xRange: () => [-0.5, 1.5],
  stats: (p) => ({
    mean: p[0],
    variance: p[0] * (1 - p[0]),
    stdDev: Math.sqrt(p[0] * (1 - p[0])),
    skewness: p[0] === 0 || p[0] === 1 ? "Undefined" : (1 - 2 * p[0]) / Math.sqrt(p[0] * (1 - p[0])),
    kurtosis: p[0] === 0 || p[0] === 1 ? "Undefined" : 3 + (1 - 6 * p[0] * (1 - p[0])) / (p[0] * (1 - p[0])),
    mode: p[0] > 0.5 ? 1 : (p[0] < 0.5 ? 0 : "0 and 1"),
    median: p[0] > 0.5 ? 1 : (p[0] < 0.5 ? 0 : 0.5),
  }),
};

const binomial: DistributionDef = {
  id: "binomial",
  name: "Binomial",
  color: "#a855f7",
  type: "discrete",
  parameters: [
    { name: "n", label: "n (trials)", min: 1, max: 50, step: 1, defaultValue: 10 },
    { name: "p", label: "p (probability)", min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
  ],
  pdf: (k, p) => binomialPmf(k, Math.round(p[0]), p[1]),
  cdf: (k, p) => binomialCdf(k, Math.round(p[0]), p[1]),
  xRange: (p) => [-0.5, Math.round(p[0]) + 0.5],
  stats: (p) => {
    const n = Math.round(p[0]);
    const pr = p[1];
    return {
      mean: n * pr,
      variance: n * pr * (1 - pr),
      stdDev: Math.sqrt(n * pr * (1 - pr)),
      skewness: n * pr * (1 - pr) === 0 ? "Undefined" : (1 - 2 * pr) / Math.sqrt(n * pr * (1 - pr)),
      kurtosis: n * pr * (1 - pr) === 0 ? "Undefined" : 3 + (1 - 6 * pr * (1 - pr)) / (n * pr * (1 - pr)),
      mode: Math.floor((n + 1) * pr),
      median: Math.round(n * pr),
    };
  },
};

const poisson: DistributionDef = {
  id: "poisson",
  name: "Poisson",
  color: "#ef4444",
  type: "discrete",
  parameters: [
    { name: "lambda", label: "\u03BB (rate)", min: 0.1, max: 20, step: 0.1, defaultValue: 5 },
  ],
  pdf: (k, p) => poissonPmf(k, p[0]),
  cdf: (k, p) => poissonCdf(k, p[0]),
  xRange: (p) => [-0.5, p[0] + 4 * Math.sqrt(p[0]) + 1],
  stats: (p) => ({
    mean: p[0],
    variance: p[0],
    stdDev: Math.sqrt(p[0]),
    skewness: 1 / Math.sqrt(p[0]),
    kurtosis: 3 + 1 / p[0],
    mode: Math.floor(p[0]),
    median: "~" + Math.round(p[0]).toString(),
  }),
};

const geometric: DistributionDef = {
  id: "geometric",
  name: "Geometric",
  color: "#d946ef",
  type: "discrete",
  parameters: [
    { name: "p", label: "p (probability)", min: 0.01, max: 1, step: 0.01, defaultValue: 0.3 },
  ],
  pdf: (k, p) => geometricPmf(k, p[0]),
  cdf: (k, p) => geometricCdf(k, p[0]),
  xRange: (p) => [0.5, Math.max(Math.ceil(4 / p[0]), 10) + 0.5],
  stats: (p) => ({
    mean: 1 / p[0],
    variance: (1 - p[0]) / (p[0] * p[0]),
    stdDev: Math.sqrt(1 - p[0]) / p[0],
    skewness: (2 - p[0]) / Math.sqrt(1 - p[0]),
    kurtosis: 3 + 6 + p[0] * p[0] / (1 - p[0]),
    mode: 1,
    median: Math.ceil(-1 / Math.log2(1 - p[0])),
  }),
};

const negativeBinomial: DistributionDef = {
  id: "negative-binomial",
  name: "Negative Binomial",
  color: "#fb923c",
  type: "discrete",
  parameters: [
    { name: "r", label: "r (successes)", min: 1, max: 20, step: 1, defaultValue: 5 },
    { name: "p", label: "p (probability)", min: 0.01, max: 0.99, step: 0.01, defaultValue: 0.5 },
  ],
  pdf: (k, p) => negativeBinomialPmf(k, Math.round(p[0]), p[1]),
  cdf: (k, p) => negativeBinomialCdf(k, Math.round(p[0]), p[1]),
  xRange: (p) => {
    const r = Math.round(p[0]);
    const pr = p[1];
    const mean = r * (1 - pr) / pr;
    const sd = Math.sqrt(r * (1 - pr)) / pr;
    return [-0.5, Math.max(mean + 4 * sd, 10) + 0.5];
  },
  stats: (p) => {
    const r = Math.round(p[0]);
    const pr = p[1];
    return {
      mean: r * (1 - pr) / pr,
      variance: r * (1 - pr) / (pr * pr),
      stdDev: Math.sqrt(r * (1 - pr)) / pr,
      skewness: (2 - pr) / Math.sqrt(r * (1 - pr)),
      kurtosis: 3 + 6 / r + pr * pr / (r * (1 - pr)),
      mode: pr < 1 && r > 1 ? Math.floor((r - 1) * (1 - pr) / pr) : 0,
      median: "~" + Math.round(r * (1 - pr) / pr).toString(),
    };
  },
};

// ─────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────

export const DISTRIBUTIONS: DistributionDef[] = [
  // Continuous
  normal,
  logNormal,
  exponential,
  uniform,
  betaDist,
  gammaDist,
  chiSquared,
  studentT,
  cauchy,
  weibull,
  // Discrete
  bernoulli,
  binomial,
  poisson,
  geometric,
  negativeBinomial,
];

export const CONTINUOUS_DISTRIBUTIONS = DISTRIBUTIONS.filter((d) => d.type === "continuous");
export const DISCRETE_DISTRIBUTIONS = DISTRIBUTIONS.filter((d) => d.type === "discrete");

export function getDistribution(id: string): DistributionDef | undefined {
  return DISTRIBUTIONS.find((d) => d.id === id);
}

// ─────────────────────────────────────────────────────────
// Preset Comparisons
// ─────────────────────────────────────────────────────────

export const PRESETS: PresetComparison[] = [
  {
    name: "Normal vs Student's t",
    description: "See how the t-distribution has heavier tails than the Normal, especially with few degrees of freedom.",
    overlays: [
      { distributionId: "normal", params: [0, 1], color: "#4f8ff7" },
      { distributionId: "student-t", params: [3], color: "#8b5cf6" },
      { distributionId: "student-t", params: [10], color: "#f59e0b" },
    ],
  },
  {
    name: "Poisson approx. to Binomial",
    description: "When n is large and p is small, Binomial(n,p) approaches Poisson(np).",
    overlays: [
      { distributionId: "binomial", params: [40, 0.1], color: "#a855f7" },
      { distributionId: "poisson", params: [4], color: "#ef4444" },
    ],
  },
  {
    name: "Central Limit Theorem",
    description: "As degrees of freedom increase, Chi-Squared approaches Normal.",
    overlays: [
      { distributionId: "chi-squared", params: [3], color: "#f97316" },
      { distributionId: "chi-squared", params: [10], color: "#f59e0b" },
      { distributionId: "chi-squared", params: [20], color: "#34d399" },
    ],
  },
];

// ─────────────────────────────────────────────────────────
// Overlay colors for additional overlays
// ─────────────────────────────────────────────────────────

export const OVERLAY_COLORS = [
  "#4f8ff7",
  "#34d399",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
];
