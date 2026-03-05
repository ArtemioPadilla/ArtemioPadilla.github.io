// ─────────────────────────────────────────────────────────
// Pure math functions for probability distributions.
// No external dependencies — all implementations from scratch.
// ─────────────────────────────────────────────────────────

const SQRT_2PI = Math.sqrt(2 * Math.PI);
const SQRT_2 = Math.sqrt(2);
const LN_SQRT_2PI = Math.log(SQRT_2PI);

// ─────────────────────────────────────────────────────────
// Gamma Function — Lanczos approximation (g=7, n=9)
// ─────────────────────────────────────────────────────────

const LANCZOS_G = 7;
const LANCZOS_COEFFS = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
];

export function lnGamma(z: number): number {
  if (z < 0.5) {
    // Reflection formula: Gamma(1-z) * Gamma(z) = pi / sin(pi*z)
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }
  z -= 1;
  let x = LANCZOS_COEFFS[0];
  for (let i = 1; i < LANCZOS_COEFFS.length; i++) {
    x += LANCZOS_COEFFS[i] / (z + i);
  }
  const t = z + LANCZOS_G + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

export function gamma(z: number): number {
  return Math.exp(lnGamma(z));
}

// ─────────────────────────────────────────────────────────
// Factorial
// ─────────────────────────────────────────────────────────

const FACTORIAL_CACHE: number[] = [1];

export function factorial(n: number): number {
  if (n < 0) return NaN;
  if (n > 170) return Infinity;
  n = Math.round(n);
  if (FACTORIAL_CACHE[n] !== undefined) return FACTORIAL_CACHE[n];
  let result = FACTORIAL_CACHE[FACTORIAL_CACHE.length - 1];
  for (let i = FACTORIAL_CACHE.length; i <= n; i++) {
    result *= i;
    FACTORIAL_CACHE[i] = result;
  }
  return result;
}

export function lnFactorial(n: number): number {
  if (n < 0) return NaN;
  if (n <= 170) return Math.log(factorial(n));
  return lnGamma(n + 1);
}

// ─────────────────────────────────────────────────────────
// Beta Function
// ─────────────────────────────────────────────────────────

export function lnBeta(a: number, b: number): number {
  return lnGamma(a) + lnGamma(b) - lnGamma(a + b);
}

export function beta(a: number, b: number): number {
  return Math.exp(lnBeta(a, b));
}

// ─────────────────────────────────────────────────────────
// Error Function (erf) — Abramowitz & Stegun approximation
// Maximum error: 1.5e-7
// ─────────────────────────────────────────────────────────

export function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const ax = Math.abs(x);

  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);

  return sign * y;
}

export function erfc(x: number): number {
  return 1 - erf(x);
}

// ─────────────────────────────────────────────────────────
// Normal Distribution CDF via erf
// ─────────────────────────────────────────────────────────

export function normalCdf(x: number, mu: number, sigma: number): number {
  return 0.5 * (1 + erf((x - mu) / (sigma * SQRT_2)));
}

// ─────────────────────────────────────────────────────────
// Regularized Incomplete Gamma Function P(a, x)
// Using series expansion for small x, continued fraction for large x
// ─────────────────────────────────────────────────────────

function lowerGammaSeries(a: number, x: number): number {
  if (x === 0) return 0;
  const maxIter = 200;
  const eps = 1e-12;
  let sum = 1 / a;
  let term = 1 / a;
  for (let n = 1; n < maxIter; n++) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * eps) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
}

function upperGammaCF(a: number, x: number): number {
  const maxIter = 200;
  const eps = 1e-12;
  const tiny = 1e-30;

  let f = tiny;
  let c = tiny;
  let d = 1 / (x + 1 - a);
  let h = d;

  for (let n = 1; n < maxIter; n++) {
    const an = n * (a - n);
    const bn = x + 2 * n + 1 - a;
    d = bn + an * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = bn + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = c * d;
    h *= delta;
    if (Math.abs(delta - 1) < eps) break;
  }

  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

export function regularizedGammaP(a: number, x: number): number {
  if (x < 0) return 0;
  if (x === 0) return 0;
  if (!Number.isFinite(x)) return 1;
  if (x < a + 1) {
    return lowerGammaSeries(a, x);
  }
  return 1 - upperGammaCF(a, x);
}

export function regularizedGammaQ(a: number, x: number): number {
  return 1 - regularizedGammaP(a, x);
}

// ─────────────────────────────────────────────────────────
// Regularized Incomplete Beta Function I_x(a, b)
// Continued fraction (Lentz's method)
// ─────────────────────────────────────────────────────────

function incompleteBetaCF(a: number, b: number, x: number): number {
  const maxIter = 200;
  const eps = 1e-12;
  const tiny = 1e-30;

  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;

  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= maxIter; m++) {
    const m2 = 2 * m;

    // Even step
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;

    // Odd step
    aa = -((a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;

    if (Math.abs(delta - 1) < eps) break;
  }

  return h;
}

export function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (a <= 0 || b <= 0) return NaN;

  const bt = Math.exp(
    lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  );

  // Use symmetry relation for numerical stability
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * incompleteBetaCF(a, b, x)) / a;
  }
  return 1 - (bt * incompleteBetaCF(b, a, 1 - x)) / b;
}

// ─────────────────────────────────────────────────────────
// Binomial coefficient
// ─────────────────────────────────────────────────────────

export function lnBinomial(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  if (k === 0 || k === n) return 0;
  return lnFactorial(n) - lnFactorial(k) - lnFactorial(n - k);
}

export function binomialCoeff(n: number, k: number): number {
  return Math.exp(lnBinomial(n, k));
}

// ─────────────────────────────────────────────────────────
// Distribution PDF/PMF functions
// ─────────────────────────────────────────────────────────

export function normalPdf(x: number, mu: number, sigma: number): number {
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * SQRT_2PI);
}

export function logNormalPdf(x: number, mu: number, sigma: number): number {
  if (x <= 0) return 0;
  const lnx = Math.log(x);
  const z = (lnx - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (x * sigma * SQRT_2PI);
}

export function logNormalCdf(x: number, mu: number, sigma: number): number {
  if (x <= 0) return 0;
  return normalCdf(Math.log(x), mu, sigma);
}

export function exponentialPdf(x: number, lambda: number): number {
  if (x < 0) return 0;
  return lambda * Math.exp(-lambda * x);
}

export function exponentialCdf(x: number, lambda: number): number {
  if (x < 0) return 0;
  return 1 - Math.exp(-lambda * x);
}

export function uniformPdf(x: number, a: number, b: number): number {
  if (x < a || x > b) return 0;
  return 1 / (b - a);
}

export function uniformCdf(x: number, a: number, b: number): number {
  if (x < a) return 0;
  if (x > b) return 1;
  return (x - a) / (b - a);
}

export function betaPdf(x: number, alpha: number, betaParam: number): number {
  if (x <= 0 || x >= 1) return 0;
  const logP =
    (alpha - 1) * Math.log(x) +
    (betaParam - 1) * Math.log(1 - x) -
    lnBeta(alpha, betaParam);
  return Math.exp(logP);
}

export function betaCdf(x: number, alpha: number, betaParam: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return regularizedBeta(x, alpha, betaParam);
}

export function gammaPdf(x: number, shape: number, scale: number): number {
  if (x < 0) return 0;
  if (x === 0) {
    if (shape < 1) return Infinity;
    if (shape === 1) return 1 / scale;
    return 0;
  }
  const logP =
    (shape - 1) * Math.log(x) - x / scale - shape * Math.log(scale) - lnGamma(shape);
  return Math.exp(logP);
}

export function gammaCdf(x: number, shape: number, scale: number): number {
  if (x <= 0) return 0;
  return regularizedGammaP(shape, x / scale);
}

export function chiSquaredPdf(x: number, k: number): number {
  return gammaPdf(x, k / 2, 2);
}

export function chiSquaredCdf(x: number, k: number): number {
  return gammaCdf(x, k / 2, 2);
}

export function studentTPdf(x: number, nu: number): number {
  const coeff = Math.exp(lnGamma((nu + 1) / 2) - lnGamma(nu / 2)) / Math.sqrt(nu * Math.PI);
  return coeff * Math.pow(1 + (x * x) / nu, -(nu + 1) / 2);
}

export function studentTCdf(x: number, nu: number): number {
  const t2 = x * x;
  const xBeta = nu / (nu + t2);
  const ib = regularizedBeta(xBeta, nu / 2, 0.5);
  if (x >= 0) {
    return 1 - 0.5 * ib;
  }
  return 0.5 * ib;
}

export function cauchyPdf(x: number, x0: number, gammaParam: number): number {
  const z = (x - x0) / gammaParam;
  return 1 / (Math.PI * gammaParam * (1 + z * z));
}

export function cauchyCdf(x: number, x0: number, gammaParam: number): number {
  return 0.5 + Math.atan((x - x0) / gammaParam) / Math.PI;
}

export function weibullPdf(x: number, k: number, lambda: number): number {
  if (x < 0) return 0;
  if (x === 0) {
    if (k < 1) return Infinity;
    if (k === 1) return 1 / lambda;
    return 0;
  }
  return (k / lambda) * Math.pow(x / lambda, k - 1) * Math.exp(-Math.pow(x / lambda, k));
}

export function weibullCdf(x: number, k: number, lambda: number): number {
  if (x < 0) return 0;
  return 1 - Math.exp(-Math.pow(x / lambda, k));
}

// ─────────────────────────────────────────────────────────
// Discrete Distribution PMF/CDF functions
// ─────────────────────────────────────────────────────────

export function bernoulliPmf(k: number, p: number): number {
  if (k === 0) return 1 - p;
  if (k === 1) return p;
  return 0;
}

export function bernoulliCdf(k: number, p: number): number {
  if (k < 0) return 0;
  if (k < 1) return 1 - p;
  return 1;
}

export function binomialPmf(k: number, n: number, p: number): number {
  k = Math.round(k);
  if (k < 0 || k > n) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  const logP = lnBinomial(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p);
  return Math.exp(logP);
}

export function binomialCdf(k: number, n: number, p: number): number {
  k = Math.floor(k);
  if (k < 0) return 0;
  if (k >= n) return 1;
  // Use regularized incomplete beta for efficiency
  return 1 - regularizedBeta(p, k + 1, n - k);
}

export function poissonPmf(k: number, lambda: number): number {
  k = Math.round(k);
  if (k < 0) return 0;
  if (lambda === 0) return k === 0 ? 1 : 0;
  const logP = k * Math.log(lambda) - lambda - lnFactorial(k);
  return Math.exp(logP);
}

export function poissonCdf(k: number, lambda: number): number {
  k = Math.floor(k);
  if (k < 0) return 0;
  return regularizedGammaQ(k + 1, lambda);
}

export function geometricPmf(k: number, p: number): number {
  k = Math.round(k);
  if (k < 1) return 0;
  return p * Math.pow(1 - p, k - 1);
}

export function geometricCdf(k: number, p: number): number {
  k = Math.floor(k);
  if (k < 1) return 0;
  return 1 - Math.pow(1 - p, k);
}

export function negativeBinomialPmf(k: number, r: number, p: number): number {
  k = Math.round(k);
  if (k < 0) return 0;
  const logP =
    lnGamma(k + r) - lnFactorial(k) - lnGamma(r) + r * Math.log(p) + k * Math.log(1 - p);
  return Math.exp(logP);
}

export function negativeBinomialCdf(k: number, r: number, p: number): number {
  k = Math.floor(k);
  if (k < 0) return 0;
  return regularizedBeta(p, r, k + 1);
}

// ─────────────────────────────────────────────────────────
// Random sampling (using Box-Muller, inverse transform, etc.)
// ─────────────────────────────────────────────────────────

function randNormal(mu: number, sigma: number): number {
  let u1 = Math.random();
  const u2 = Math.random();
  // Avoid log(0)
  if (u1 === 0) u1 = 1e-10;
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mu + sigma * z;
}

function randGamma(shape: number, scale: number): number {
  // Marsaglia and Tsang's method for shape >= 1
  if (shape < 1) {
    return randGamma(shape + 1, scale) * Math.pow(Math.random(), 1 / shape);
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  for (;;) {
    let x: number;
    let v: number;
    do {
      x = randNormal(0, 1);
      v = 1 + c * x;
    } while (v <= 0);

    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v * scale;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}

function randBeta(alpha: number, betaParam: number): number {
  const x = randGamma(alpha, 1);
  const y = randGamma(betaParam, 1);
  return x / (x + y);
}

function randBinomial(n: number, p: number): number {
  let successes = 0;
  for (let i = 0; i < n; i++) {
    if (Math.random() < p) successes++;
  }
  return successes;
}

function randPoisson(lambda: number): number {
  if (lambda < 30) {
    // Knuth's algorithm
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= Math.random();
    } while (p > L);
    return k - 1;
  }
  // For large lambda, use normal approximation
  return Math.max(0, Math.round(randNormal(lambda, Math.sqrt(lambda))));
}

function randGeometric(p: number): number {
  return Math.ceil(Math.log(1 - Math.random()) / Math.log(1 - p));
}

function randNegBinomial(r: number, p: number): number {
  // Gamma-Poisson mixture
  const g = randGamma(r, (1 - p) / p);
  return randPoisson(g);
}

export type SampleFn = (count: number) => number[];

export function createSampler(distributionId: string, params: number[]): SampleFn {
  return (count: number): number[] => {
    const samples: number[] = [];
    for (let i = 0; i < count; i++) {
      samples.push(sampleOne(distributionId, params));
    }
    return samples;
  };
}

function sampleOne(id: string, params: number[]): number {
  switch (id) {
    case "normal":
      return randNormal(params[0], params[1]);
    case "log-normal":
      return Math.exp(randNormal(params[0], params[1]));
    case "exponential":
      return -Math.log(1 - Math.random()) / params[0];
    case "uniform":
      return params[0] + Math.random() * (params[1] - params[0]);
    case "beta":
      return randBeta(params[0], params[1]);
    case "gamma":
      return randGamma(params[0], params[1]);
    case "chi-squared":
      return randGamma(params[0] / 2, 2);
    case "student-t": {
      const z = randNormal(0, 1);
      const v = randGamma(params[0] / 2, 2);
      return z / Math.sqrt(v / params[0]);
    }
    case "cauchy":
      return params[0] + params[1] * Math.tan(Math.PI * (Math.random() - 0.5));
    case "weibull": {
      const u = Math.random();
      return params[1] * Math.pow(-Math.log(1 - u), 1 / params[0]);
    }
    case "bernoulli":
      return Math.random() < params[0] ? 1 : 0;
    case "binomial":
      return randBinomial(Math.round(params[0]), params[1]);
    case "poisson":
      return randPoisson(params[0]);
    case "geometric":
      return randGeometric(params[0]);
    case "negative-binomial":
      return randNegBinomial(params[0], params[1]);
    default:
      return 0;
  }
}
