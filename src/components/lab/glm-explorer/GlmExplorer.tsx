import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

interface DataPoint {
  x: number;
  y: number;
}

type FamilyId = "normal" | "binomial" | "poisson" | "gamma";
type LinkId = "identity" | "log" | "logit" | "probit" | "cloglog" | "inverse" | "sqrt";

interface FamilyDef {
  id: FamilyId;
  label: string;
  links: LinkId[];
  canonical: LinkId;
  variance: (mu: number) => number;
  deviance: (y: number, mu: number) => number;
}

interface LinkDef {
  id: LinkId;
  label: string;
  g: (mu: number) => number;
  gInv: (eta: number) => number;
  gPrime: (mu: number) => number;
  formula: string;
  inverse: string;
  domain: string;
}

interface IRLSState {
  iteration: number;
  beta: [number, number];
  deviance: number;
  converged: boolean;
  workingResponse: number[];
  weights: number[];
  fittedValues: number[];
}

interface ModelComparison {
  family: string;
  link: string;
  deviance: number;
  aic: number;
  bic: number;
  nParams: number;
}

interface PresetData {
  id: string;
  label: string;
  family: FamilyId;
  points: DataPoint[];
}

/* ══════════════════════════════════════════════════════════
   Constants
   ══════════════════════════════════════════════════════════ */

const LINK_DEFS: Record<LinkId, LinkDef> = {
  identity: {
    id: "identity",
    label: "Identity",
    g: (mu) => mu,
    gInv: (eta) => eta,
    gPrime: () => 1,
    formula: "g(mu) = mu",
    inverse: "mu = eta",
    domain: "(-inf, inf)",
  },
  log: {
    id: "log",
    label: "Log",
    g: (mu) => Math.log(Math.max(mu, 1e-10)),
    gInv: (eta) => Math.exp(Math.min(eta, 20)),
    gPrime: (mu) => 1 / Math.max(mu, 1e-10),
    formula: "g(mu) = ln(mu)",
    inverse: "mu = exp(eta)",
    domain: "(0, inf)",
  },
  logit: {
    id: "logit",
    label: "Logit",
    g: (mu) => Math.log(Math.max(mu, 1e-10) / Math.max(1 - mu, 1e-10)),
    gInv: (eta) => 1 / (1 + Math.exp(-Math.min(Math.max(eta, -20), 20))),
    gPrime: (mu) => 1 / (Math.max(mu, 1e-10) * Math.max(1 - mu, 1e-10)),
    formula: "g(mu) = ln(mu / (1-mu))",
    inverse: "mu = 1 / (1 + exp(-eta))",
    domain: "(0, 1)",
  },
  probit: {
    id: "probit",
    label: "Probit",
    g: (mu) => probitFn(Math.max(1e-6, Math.min(mu, 1 - 1e-6))),
    gInv: (eta) => normalCdf(eta),
    gPrime: (mu) => 1 / normalPdf(probitFn(Math.max(1e-6, Math.min(mu, 1 - 1e-6)))),
    formula: "g(mu) = Phi^-1(mu)",
    inverse: "mu = Phi(eta)",
    domain: "(0, 1)",
  },
  cloglog: {
    id: "cloglog",
    label: "Cloglog",
    g: (mu) => Math.log(-Math.log(Math.max(1 - mu, 1e-10))),
    gInv: (eta) => 1 - Math.exp(-Math.exp(Math.min(eta, 10))),
    gPrime: (mu) => 1 / (Math.max(1 - mu, 1e-10) * (-Math.log(Math.max(1 - mu, 1e-10)))),
    formula: "g(mu) = ln(-ln(1-mu))",
    inverse: "mu = 1 - exp(-exp(eta))",
    domain: "(0, 1)",
  },
  inverse: {
    id: "inverse",
    label: "Inverse",
    g: (mu) => 1 / Math.max(mu, 1e-10),
    gInv: (eta) => 1 / Math.max(eta, 1e-10),
    gPrime: (mu) => -1 / (mu * mu + 1e-10),
    formula: "g(mu) = 1/mu",
    inverse: "mu = 1/eta",
    domain: "(0, inf)",
  },
  sqrt: {
    id: "sqrt",
    label: "Sqrt",
    g: (mu) => Math.sqrt(Math.max(mu, 0)),
    gInv: (eta) => Math.max(eta, 0) * Math.max(eta, 0),
    gPrime: (mu) => 0.5 / Math.sqrt(Math.max(mu, 1e-10)),
    formula: "g(mu) = sqrt(mu)",
    inverse: "mu = eta^2",
    domain: "[0, inf)",
  },
};

const FAMILIES: FamilyDef[] = [
  {
    id: "normal",
    label: "Normal (Gaussian)",
    links: ["identity", "log"],
    canonical: "identity",
    variance: () => 1,
    deviance: (y, mu) => (y - mu) ** 2,
  },
  {
    id: "binomial",
    label: "Binomial",
    links: ["logit", "probit", "cloglog"],
    canonical: "logit",
    variance: (mu) => mu * (1 - mu),
    deviance: (y, mu) => {
      const mc = Math.max(mu, 1e-10);
      const mc2 = Math.max(1 - mu, 1e-10);
      if (y === 1) return -2 * Math.log(mc);
      if (y === 0) return -2 * Math.log(mc2);
      return -2 * (y * Math.log(mc) + (1 - y) * Math.log(mc2));
    },
  },
  {
    id: "poisson",
    label: "Poisson",
    links: ["log", "identity", "sqrt"],
    canonical: "log",
    variance: (mu) => Math.max(mu, 1e-10),
    deviance: (y, mu) => {
      const mc = Math.max(mu, 1e-10);
      if (y === 0) return 2 * mc;
      return 2 * (y * Math.log(y / mc) - (y - mc));
    },
  },
  {
    id: "gamma",
    label: "Gamma",
    links: ["inverse", "log", "identity"],
    canonical: "inverse",
    variance: (mu) => mu * mu,
    deviance: (y, mu) => {
      const mc = Math.max(mu, 1e-10);
      return 2 * (-Math.log(y / mc) + (y - mc) / mc);
    },
  },
];

const PRESETS: PresetData[] = [
  {
    id: "dose-response",
    label: "Dose-Response",
    family: "binomial",
    points: [
      { x: 0.5, y: 0 }, { x: 1.0, y: 0 }, { x: 1.5, y: 0 }, { x: 2.0, y: 0 },
      { x: 2.5, y: 0 }, { x: 3.0, y: 0 }, { x: 3.5, y: 1 }, { x: 3.5, y: 0 },
      { x: 4.0, y: 0 }, { x: 4.0, y: 1 }, { x: 4.5, y: 1 }, { x: 5.0, y: 1 },
      { x: 5.0, y: 0 }, { x: 5.5, y: 1 }, { x: 6.0, y: 1 }, { x: 6.5, y: 1 },
      { x: 7.0, y: 1 }, { x: 7.5, y: 1 }, { x: 8.0, y: 1 }, { x: 8.5, y: 1 },
    ],
  },
  {
    id: "species-count",
    label: "Species Count",
    family: "poisson",
    points: [
      { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 3 },
      { x: 5, y: 5 }, { x: 6, y: 4 }, { x: 7, y: 7 }, { x: 8, y: 8 },
      { x: 9, y: 12 }, { x: 10, y: 10 }, { x: 11, y: 15 }, { x: 12, y: 18 },
      { x: 13, y: 14 }, { x: 14, y: 20 }, { x: 15, y: 22 },
    ],
  },
  {
    id: "insurance",
    label: "Insurance Claims",
    family: "gamma",
    points: [
      { x: 1, y: 2.1 }, { x: 2, y: 3.5 }, { x: 3, y: 2.8 }, { x: 4, y: 5.2 },
      { x: 5, y: 4.8 }, { x: 6, y: 7.1 }, { x: 7, y: 6.3 }, { x: 8, y: 9.5 },
      { x: 9, y: 8.2 }, { x: 10, y: 11.0 }, { x: 11, y: 10.8 }, { x: 12, y: 14.2 },
    ],
  },
  {
    id: "linear",
    label: "Linear Baseline",
    family: "normal",
    points: [
      { x: 1, y: 2.1 }, { x: 2, y: 4.3 }, { x: 3, y: 5.8 }, { x: 4, y: 8.2 },
      { x: 5, y: 9.5 }, { x: 6, y: 12.1 }, { x: 7, y: 13.8 }, { x: 8, y: 16.0 },
      { x: 9, y: 17.5 }, { x: 10, y: 20.3 },
    ],
  },
  {
    id: "growth",
    label: "Growth Curve",
    family: "normal",
    points: [
      { x: 0, y: 1.2 }, { x: 1, y: 1.8 }, { x: 2, y: 3.1 }, { x: 3, y: 4.5 },
      { x: 4, y: 7.8 }, { x: 5, y: 12.0 }, { x: 6, y: 18.5 }, { x: 7, y: 28.0 },
      { x: 8, y: 42.0 }, { x: 9, y: 60.0 },
    ],
  },
];

/* ── Math Helpers ────────────────────────────────────────── */

function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327;
  const p = d * Math.exp(-x * x / 2) * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

function probitFn(p: number): number {
  // Rational approximation of the inverse normal CDF
  if (p <= 0) return -8;
  if (p >= 1) return 8;
  if (p === 0.5) return 0;
  const a = p < 0.5 ? p : 1 - p;
  const t = Math.sqrt(-2 * Math.log(a));
  const c0 = 2.515517, c1 = 0.802853, c2 = 0.010328;
  const d1 = 1.432788, d2 = 0.189269, d3 = 0.001308;
  let r = t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);
  return p < 0.5 ? -r : r;
}

function resolveColor(el: HTMLElement, varName: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(varName).trim() || fallback;
}

/* ══════════════════════════════════════════════════════════
   IRLS Engine (2x2 matrix for simple linear predictor)
   ══════════════════════════════════════════════════════════ */

function runIRLS(
  data: DataPoint[],
  family: FamilyDef,
  link: LinkDef,
  maxIter: number = 25,
  tol: number = 1e-8
): IRLSState[] {
  const n = data.length;
  if (n < 2) return [];

  const xs = data.map((d) => d.x);
  const ys = data.map((d) => d.y);

  // Initialize beta
  let beta: [number, number] = [0, 0];

  // Initialize mu with reasonable starting values
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  let mu = ys.map((y) => {
    if (family.id === "binomial") return Math.max(0.1, Math.min(0.9, (y + 0.5) / 2));
    if (family.id === "poisson") return Math.max(0.5, y + 0.1);
    if (family.id === "gamma") return Math.max(0.5, y);
    return y === 0 ? 0.1 : y;
  });

  // Initial eta = g(mu)
  let eta = mu.map((m) => link.g(m));

  // Solve for initial beta using least squares on eta
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const etaMean = eta.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - xMean) * (eta[i] - etaMean);
    sxx += (xs[i] - xMean) * (xs[i] - xMean);
  }
  beta[1] = sxx > 0 ? sxy / sxx : 0;
  beta[0] = etaMean - beta[1] * xMean;

  const states: IRLSState[] = [];

  for (let iter = 0; iter < maxIter; iter++) {
    // Compute eta from beta
    eta = xs.map((x) => beta[0] + beta[1] * x);
    mu = eta.map((e) => link.gInv(e));

    // Clamp mu for numerical stability
    mu = mu.map((m) => {
      if (family.id === "binomial") return Math.max(1e-6, Math.min(1 - 1e-6, m));
      if (family.id === "poisson") return Math.max(1e-6, m);
      if (family.id === "gamma") return Math.max(1e-6, m);
      return m;
    });

    // Compute working weights W and working response z
    const W: number[] = [];
    const z: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = family.variance(mu[i]);
      const gp = link.gPrime(mu[i]);
      const w = 1 / (v * gp * gp + 1e-10);
      W.push(Math.max(w, 1e-10));
      z.push(eta[i] + (ys[i] - mu[i]) * gp);
    }

    // Weighted least squares: solve (X'WX) beta = X'Wz
    // X is [1, x_i] for each observation
    let xtwx00 = 0, xtwx01 = 0, xtwx11 = 0;
    let xtwz0 = 0, xtwz1 = 0;
    for (let i = 0; i < n; i++) {
      const wi = W[i];
      xtwx00 += wi;
      xtwx01 += wi * xs[i];
      xtwx11 += wi * xs[i] * xs[i];
      xtwz0 += wi * z[i];
      xtwz1 += wi * xs[i] * z[i];
    }

    const det = xtwx00 * xtwx11 - xtwx01 * xtwx01;
    if (Math.abs(det) < 1e-20) break;

    const newBeta: [number, number] = [
      (xtwx11 * xtwz0 - xtwx01 * xtwz1) / det,
      (xtwx00 * xtwz1 - xtwx01 * xtwz0) / det,
    ];

    // Compute deviance
    const newEta = xs.map((x) => newBeta[0] + newBeta[1] * x);
    const newMu = newEta.map((e) => link.gInv(e));
    let dev = 0;
    for (let i = 0; i < n; i++) {
      const mc = family.id === "binomial"
        ? Math.max(1e-6, Math.min(1 - 1e-6, newMu[i]))
        : Math.max(1e-6, newMu[i]);
      dev += family.deviance(ys[i], mc);
    }

    const converged = Math.abs(newBeta[0] - beta[0]) < tol && Math.abs(newBeta[1] - beta[1]) < tol;
    beta = newBeta;

    states.push({
      iteration: iter + 1,
      beta: [...beta],
      deviance: dev,
      converged,
      workingResponse: z,
      weights: W,
      fittedValues: newMu,
    });

    if (converged) break;
  }

  return states;
}

/* ══════════════════════════════════════════════════════════
   Diagnostic computations
   ══════════════════════════════════════════════════════════ */

function computeDiagnostics(
  data: DataPoint[],
  family: FamilyDef,
  fitted: number[],
  beta: [number, number]
) {
  const n = data.length;
  const xs = data.map((d) => d.x);
  const ys = data.map((d) => d.y);

  // Deviance residuals
  const devResiduals: number[] = [];
  for (let i = 0; i < n; i++) {
    const mc = Math.max(1e-10, fitted[i]);
    const d = family.deviance(ys[i], mc);
    const sign = ys[i] > mc ? 1 : -1;
    devResiduals.push(sign * Math.sqrt(Math.max(0, d)));
  }

  // Hat matrix diagonal (leverage)
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const sxx = xs.reduce((a, v) => a + (v - xMean) ** 2, 0);
  const leverage = xs.map((x) => 1 / n + (x - xMean) ** 2 / (sxx + 1e-10));

  // Standardized residuals
  const phi = devResiduals.reduce((a, r) => a + r * r, 0) / Math.max(1, n - 2);
  const stdResiduals = devResiduals.map((r, i) =>
    r / Math.sqrt(Math.max(1e-10, phi * (1 - leverage[i])))
  );

  // Cook's distance
  const cookD = stdResiduals.map((r, i) =>
    (r * r * leverage[i]) / (2 * (1 - leverage[i]) ** 2 + 1e-10)
  );

  return { devResiduals, leverage, stdResiduals, cookD, phi };
}

/* ══════════════════════════════════════════════════════════
   Shared styles
   ══════════════════════════════════════════════════════════ */

const panelStyle: Record<string, string> = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "12px",
  padding: "12px",
};

const btnStyle: Record<string, string> = {
  padding: "5px 12px",
  borderRadius: "6px",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  cursor: "pointer",
  fontSize: "12px",
  fontFamily: "var(--font-sans)",
};

const activeBtnStyle: Record<string, string> = {
  ...btnStyle,
  background: "var(--color-primary)",
  color: "#fff",
  borderColor: "var(--color-primary)",
};

const labelStyle: Record<string, string> = {
  fontSize: "11px",
  color: "var(--color-text-muted)",
  fontFamily: "var(--font-sans)",
};

const statStyle: Record<string, string> = {
  fontSize: "13px",
  color: "var(--color-heading)",
  fontFamily: "var(--font-mono)",
  fontWeight: "600",
};

const selectStyle: Record<string, string> = {
  padding: "5px 8px",
  borderRadius: "6px",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  fontSize: "12px",
  fontFamily: "var(--font-sans)",
};

/* ══════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════ */

export default function GlmExplorer() {
  const [data, setData] = useState<DataPoint[]>(PRESETS[0].points);
  const [familyIdx, setFamilyIdx] = useState(1); // binomial
  const [linkIdx, setLinkIdx] = useState(0);

  const [irlsStates, setIrlsStates] = useState<IRLSState[]>([]);
  const [currentStep, setCurrentStep] = useState(-1);
  const [autoRun, setAutoRun] = useState(false);
  const [autoSpeed, setAutoSpeed] = useState(500);
  const autoRef = useRef(false);

  const [comparisons, setComparisons] = useState<ModelComparison[]>([]);

  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const irlsChartRef = useRef<HTMLCanvasElement>(null);
  const diagCanvasRefs = [useRef<HTMLCanvasElement>(null), useRef<HTMLCanvasElement>(null), useRef<HTMLCanvasElement>(null), useRef<HTMLCanvasElement>(null)];
  const linkCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const family = FAMILIES[familyIdx];
  const link = LINK_DEFS[family.links[linkIdx]];
  const isCanonical = family.links[linkIdx] === family.canonical;

  const finalState = currentStep >= 0 && irlsStates.length > 0
    ? irlsStates[Math.min(currentStep, irlsStates.length - 1)]
    : irlsStates.length > 0
      ? irlsStates[irlsStates.length - 1]
      : null;

  // Compute model metrics
  const metrics = useMemo(() => {
    if (!finalState || data.length < 3) return null;
    const n = data.length;
    const k = 2; // intercept + slope
    const dev = finalState.deviance;
    const logLik = -dev / 2;
    const aic = 2 * k - 2 * logLik;
    const bic = k * Math.log(n) - 2 * logLik;
    const phi = dev / Math.max(1, n - k);
    return { deviance: dev, aic, bic, logLik, phi, n, k };
  }, [finalState, data]);

  // Run IRLS when data/family/link change
  useEffect(() => {
    if (data.length < 2) {
      setIrlsStates([]);
      setCurrentStep(-1);
      return;
    }
    const states = runIRLS(data, family, link);
    setIrlsStates(states);
    setCurrentStep(states.length - 1);
  }, [data, family, link]);

  // Auto-run animation
  useEffect(() => {
    if (!autoRun || irlsStates.length === 0) return;
    autoRef.current = true;
    setCurrentStep(0);

    let step = 0;
    const interval = setInterval(() => {
      if (!autoRef.current) return;
      step++;
      if (step >= irlsStates.length) {
        setAutoRun(false);
        autoRef.current = false;
        clearInterval(interval);
        return;
      }
      setCurrentStep(step);
    }, autoSpeed);

    return () => {
      autoRef.current = false;
      clearInterval(interval);
    };
  }, [autoRun, irlsStates, autoSpeed]);

  // Change family resets link
  const handleFamilyChange = useCallback((idx: number) => {
    setFamilyIdx(idx);
    setLinkIdx(0);
  }, []);

  // Load preset
  const loadPreset = useCallback((p: PresetData) => {
    setData([...p.points]);
    const fIdx = FAMILIES.findIndex((f) => f.id === p.family);
    if (fIdx >= 0) {
      setFamilyIdx(fIdx);
      setLinkIdx(0);
    }
  }, []);

  // Add point on canvas click
  const handleCanvasClick = useCallback(
    (e: MouseEvent) => {
      const canvas = mainCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;

      const pad = { l: 50, r: 20, t: 20, b: 40 };
      const pw = canvas.width - pad.l - pad.r;
      const ph = canvas.height - pad.t - pad.b;

      if (cx < pad.l || cx > canvas.width - pad.r || cy < pad.t || cy > canvas.height - pad.b) return;

      const allX = data.map((d) => d.x);
      const allY = data.map((d) => d.y);
      const xMin = allX.length > 0 ? Math.min(...allX) - 1 : 0;
      const xMax = allX.length > 0 ? Math.max(...allX) + 1 : 10;
      const yMin = allY.length > 0 ? Math.min(...allY) - 1 : -1;
      const yMax = allY.length > 0 ? Math.max(...allY) + 1 : 2;

      let x = xMin + ((cx - pad.l) / pw) * (xMax - xMin);
      let y = yMax - ((cy - pad.t) / ph) * (yMax - yMin);

      if (family.id === "binomial") {
        y = y > 0.5 ? 1 : 0;
      } else if (family.id === "poisson") {
        y = Math.max(0, Math.round(y));
      }

      // Check for removal (click near existing point)
      const rmIdx = data.findIndex((d) => {
        const dx = ((d.x - xMin) / (xMax - xMin)) * pw + pad.l;
        const dy = pad.t + ph * (1 - (d.y - yMin) / (yMax - yMin));
        return Math.abs(cx - dx) < 8 && Math.abs(cy - dy) < 8;
      });

      if (rmIdx >= 0 && e.shiftKey) {
        setData(data.filter((_, i) => i !== rmIdx));
      } else {
        setData([...data, { x: parseFloat(x.toFixed(2)), y: parseFloat(y.toFixed(2)) }]);
      }
    },
    [data, family]
  );

  // Add to comparison
  const addComparison = useCallback(() => {
    if (!metrics || comparisons.length >= 3) return;
    setComparisons([
      ...comparisons,
      {
        family: family.label,
        link: link.label,
        deviance: metrics.deviance,
        aic: metrics.aic,
        bic: metrics.bic,
        nParams: metrics.k,
      },
    ]);
  }, [metrics, comparisons, family, link]);

  /* ── Draw main scatter + fitted curve ─────────────────── */
  const drawMain = useCallback(() => {
    const canvas = mainCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    const bg = resolveColor(canvas, "--color-bg", "#09090b");
    const border = resolveColor(canvas, "--color-border", "#27272a");
    const primary = resolveColor(canvas, "--color-primary", "#4f8ff7");
    const accent = resolveColor(canvas, "--color-accent", "#34d399");
    const textMuted = resolveColor(canvas, "--color-text-muted", "#a1a1aa");
    const heading = resolveColor(canvas, "--color-heading", "#ffffff");

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const pad = { l: 50, r: 20, t: 20, b: 40 };
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;

    if (data.length === 0) {
      ctx.fillStyle = textMuted;
      ctx.font = "14px var(--font-sans)";
      ctx.textAlign = "center";
      ctx.fillText("Click to add data points", w / 2, h / 2);
      return;
    }

    const allX = data.map((d) => d.x);
    const allY = data.map((d) => d.y);
    const xMin = Math.min(...allX) - 1;
    const xMax = Math.max(...allX) + 1;
    const yMinRaw = Math.min(...allY);
    const yMaxRaw = Math.max(...allY);
    const yRange = yMaxRaw - yMinRaw || 2;
    const yMin = yMinRaw - yRange * 0.15;
    const yMax = yMaxRaw + yRange * 0.15;

    const toX = (x: number) => pad.l + ((x - xMin) / (xMax - xMin)) * pw;
    const toY = (y: number) => pad.t + ph * (1 - (y - yMin) / (yMax - yMin));

    // Grid lines
    ctx.strokeStyle = border;
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const yy = yMin + (i / 4) * (yMax - yMin);
      const cy = toY(yy);
      ctx.beginPath();
      ctx.moveTo(pad.l, cy);
      ctx.lineTo(w - pad.r, cy);
      ctx.stroke();

      ctx.fillStyle = textMuted;
      ctx.font = "10px var(--font-mono)";
      ctx.textAlign = "right";
      ctx.fillText(yy.toFixed(1), pad.l - 5, cy + 4);
    }

    for (let i = 0; i <= 4; i++) {
      const xx = xMin + (i / 4) * (xMax - xMin);
      const cx = toX(xx);
      ctx.beginPath();
      ctx.moveTo(cx, pad.t);
      ctx.lineTo(cx, h - pad.b);
      ctx.stroke();

      ctx.fillStyle = textMuted;
      ctx.font = "10px var(--font-mono)";
      ctx.textAlign = "center";
      ctx.fillText(xx.toFixed(1), cx, h - pad.b + 14);
    }

    // Axes
    ctx.strokeStyle = textMuted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t);
    ctx.lineTo(pad.l, h - pad.b);
    ctx.lineTo(w - pad.r, h - pad.b);
    ctx.stroke();

    // Fitted curve with confidence band
    if (finalState && data.length >= 2) {
      const [b0, b1] = finalState.beta;
      const nSteps = 200;

      // Confidence band (approximate)
      ctx.fillStyle = primary;
      ctx.globalAlpha = 0.1;
      ctx.beginPath();
      for (let i = 0; i <= nSteps; i++) {
        const x = xMin + (i / nSteps) * (xMax - xMin);
        const eta = b0 + b1 * x;
        const muHat = link.gInv(eta);
        const se = Math.sqrt(family.variance(muHat)) * 0.3;
        const upper = muHat + 1.96 * se;
        const cx = toX(x);
        const cy = toY(upper);
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      }
      for (let i = nSteps; i >= 0; i--) {
        const x = xMin + (i / nSteps) * (xMax - xMin);
        const eta = b0 + b1 * x;
        const muHat = link.gInv(eta);
        const se = Math.sqrt(family.variance(muHat)) * 0.3;
        const lower = muHat - 1.96 * se;
        const cx = toX(x);
        const cy = toY(lower);
        ctx.lineTo(cx, cy);
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1.0;

      // Fitted line
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i <= nSteps; i++) {
        const x = xMin + (i / nSteps) * (xMax - xMin);
        const eta = b0 + b1 * x;
        const muHat = link.gInv(eta);
        const cx = toX(x);
        const cy = toY(muHat);
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }

    // Data points
    for (const pt of data) {
      ctx.beginPath();
      ctx.arc(toX(pt.x), toY(pt.y), 5, 0, Math.PI * 2);
      ctx.fillStyle = primary;
      ctx.fill();
      ctx.strokeStyle = heading;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }, [data, finalState, family, link]);

  /* ── Draw IRLS convergence chart ──────────────────────── */
  const drawIRLSChart = useCallback(() => {
    const canvas = irlsChartRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    const bg = resolveColor(canvas, "--color-bg", "#09090b");
    const border = resolveColor(canvas, "--color-border", "#27272a");
    const primary = resolveColor(canvas, "--color-primary", "#4f8ff7");
    const accent = resolveColor(canvas, "--color-accent", "#34d399");
    const textMuted = resolveColor(canvas, "--color-text-muted", "#a1a1aa");

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    if (irlsStates.length < 2) {
      ctx.fillStyle = textMuted;
      ctx.font = "11px var(--font-sans)";
      ctx.textAlign = "center";
      ctx.fillText("Run IRLS to see convergence", w / 2, h / 2);
      return;
    }

    const pad = { l: 50, r: 10, t: 10, b: 25 };
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;

    const maxIter = irlsStates[irlsStates.length - 1].iteration;
    const deviances = irlsStates.map((s) => s.deviance);
    const maxDev = Math.max(...deviances);
    const minDev = Math.min(...deviances);
    const devRange = maxDev - minDev || 1;

    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t);
    ctx.lineTo(pad.l, h - pad.b);
    ctx.lineTo(w - pad.r, h - pad.b);
    ctx.stroke();

    // Deviance line
    const upTo = currentStep >= 0 ? Math.min(currentStep + 1, irlsStates.length) : irlsStates.length;

    ctx.strokeStyle = primary;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < upTo; i++) {
      const s = irlsStates[i];
      const cx = pad.l + (s.iteration / maxIter) * pw;
      const cy = pad.t + ph * (1 - (s.deviance - minDev) / devRange);
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.stroke();

    // Dots
    for (let i = 0; i < upTo; i++) {
      const s = irlsStates[i];
      const cx = pad.l + (s.iteration / maxIter) * pw;
      const cy = pad.t + ph * (1 - (s.deviance - minDev) / devRange);
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fillStyle = i === currentStep ? accent : primary;
      ctx.fill();
    }

    ctx.fillStyle = textMuted;
    ctx.font = "9px var(--font-sans)";
    ctx.textAlign = "center";
    ctx.fillText("Iteration", w / 2, h - 3);
    ctx.save();
    ctx.translate(12, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Deviance", 0, 0);
    ctx.restore();
  }, [irlsStates, currentStep]);

  /* ── Draw diagnostic plots ────────────────────────────── */
  const drawDiagnostics = useCallback(() => {
    if (!finalState || data.length < 3) return;

    const diag = computeDiagnostics(data, family, finalState.fittedValues, finalState.beta);
    const titles = ["Residuals vs Fitted", "QQ Plot", "Scale-Location", "Residuals vs Leverage"];

    for (let plotIdx = 0; plotIdx < 4; plotIdx++) {
      const canvas = diagCanvasRefs[plotIdx].current;
      if (!canvas) continue;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      const w = canvas.width;
      const h = canvas.height;

      const bg = resolveColor(canvas, "--color-bg", "#09090b");
      const border = resolveColor(canvas, "--color-border", "#27272a");
      const primary = resolveColor(canvas, "--color-primary", "#4f8ff7");
      const textMuted = resolveColor(canvas, "--color-text-muted", "#a1a1aa");

      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      const pad = { l: 35, r: 8, t: 18, b: 18 };
      const pw = w - pad.l - pad.r;
      const ph = h - pad.t - pad.b;

      // Title
      ctx.fillStyle = textMuted;
      ctx.font = "9px var(--font-sans)";
      ctx.textAlign = "center";
      ctx.fillText(titles[plotIdx], w / 2, 11);

      // Axes
      ctx.strokeStyle = border;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(pad.l, pad.t);
      ctx.lineTo(pad.l, h - pad.b);
      ctx.lineTo(w - pad.r, h - pad.b);
      ctx.stroke();

      if (plotIdx === 0) {
        // Residuals vs Fitted
        const fitted = finalState.fittedValues;
        const res = diag.devResiduals;
        const fMin = Math.min(...fitted) - 0.5;
        const fMax = Math.max(...fitted) + 0.5;
        const rAbs = Math.max(...res.map(Math.abs), 1);

        // Zero line
        const zeroY = pad.t + ph * 0.5;
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = textMuted;
        ctx.beginPath();
        ctx.moveTo(pad.l, zeroY);
        ctx.lineTo(w - pad.r, zeroY);
        ctx.stroke();
        ctx.setLineDash([]);

        for (let i = 0; i < fitted.length; i++) {
          const cx = pad.l + ((fitted[i] - fMin) / (fMax - fMin)) * pw;
          const cy = pad.t + ph * (0.5 - (res[i] / (2 * rAbs)));
          ctx.beginPath();
          ctx.arc(cx, cy, 3, 0, Math.PI * 2);
          ctx.fillStyle = primary;
          ctx.fill();
        }
      } else if (plotIdx === 1) {
        // QQ plot
        const sorted = [...diag.devResiduals].sort((a, b) => a - b);
        const n = sorted.length;
        const rAbs = Math.max(...sorted.map(Math.abs), 1) * 1.2;

        // Reference line
        ctx.strokeStyle = textMuted;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(pad.l, pad.t + ph);
        ctx.lineTo(w - pad.r, pad.t);
        ctx.stroke();
        ctx.setLineDash([]);

        for (let i = 0; i < n; i++) {
          const p = (i + 0.5) / n;
          const theoretical = probitFn(p);
          const tAbs = Math.max(Math.abs(probitFn(0.5 / n)), Math.abs(probitFn(1 - 0.5 / n)), 2);
          const cx = pad.l + ((theoretical + tAbs) / (2 * tAbs)) * pw;
          const cy = pad.t + ph * (1 - (sorted[i] + rAbs) / (2 * rAbs));
          ctx.beginPath();
          ctx.arc(cx, cy, 3, 0, Math.PI * 2);
          ctx.fillStyle = primary;
          ctx.fill();
        }
      } else if (plotIdx === 2) {
        // Scale-Location
        const fitted = finalState.fittedValues;
        const sqrtAbsStd = diag.stdResiduals.map((r) => Math.sqrt(Math.abs(r)));
        const fMin = Math.min(...fitted) - 0.5;
        const fMax = Math.max(...fitted) + 0.5;
        const sMax = Math.max(...sqrtAbsStd, 1) * 1.1;

        for (let i = 0; i < fitted.length; i++) {
          const cx = pad.l + ((fitted[i] - fMin) / (fMax - fMin)) * pw;
          const cy = pad.t + ph * (1 - sqrtAbsStd[i] / sMax);
          ctx.beginPath();
          ctx.arc(cx, cy, 3, 0, Math.PI * 2);
          ctx.fillStyle = primary;
          ctx.fill();
        }
      } else {
        // Residuals vs Leverage
        const lev = diag.leverage;
        const res = diag.stdResiduals;
        const lMax = Math.max(...lev, 0.5) * 1.1;
        const rAbs = Math.max(...res.map(Math.abs), 1) * 1.2;

        // Cook's distance contours (D = 0.5, 1.0)
        for (const dc of [0.5, 1.0]) {
          ctx.setLineDash([2, 2]);
          ctx.strokeStyle = "#ef4444";
          ctx.globalAlpha = 0.3;
          ctx.beginPath();
          for (let i = 0; i <= 50; i++) {
            const ll = (i / 50) * lMax;
            const rr = Math.sqrt((dc * 2 * (1 - ll) ** 2) / (ll + 1e-10));
            if (rr > rAbs * 2) continue;
            const cx = pad.l + (ll / lMax) * pw;
            const cy = pad.t + ph * (0.5 - rr / (2 * rAbs));
            if (i === 0 || rr > rAbs * 2) ctx.moveTo(cx, cy);
            else ctx.lineTo(cx, cy);
          }
          ctx.stroke();
          ctx.beginPath();
          for (let i = 0; i <= 50; i++) {
            const ll = (i / 50) * lMax;
            const rr = -Math.sqrt((dc * 2 * (1 - ll) ** 2) / (ll + 1e-10));
            if (Math.abs(rr) > rAbs * 2) continue;
            const cx = pad.l + (ll / lMax) * pw;
            const cy = pad.t + ph * (0.5 - rr / (2 * rAbs));
            if (i === 0) ctx.moveTo(cx, cy);
            else ctx.lineTo(cx, cy);
          }
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1.0;
        }

        for (let i = 0; i < lev.length; i++) {
          const cx = pad.l + (lev[i] / lMax) * pw;
          const cy = pad.t + ph * (0.5 - res[i] / (2 * rAbs));
          ctx.beginPath();
          ctx.arc(cx, cy, 3, 0, Math.PI * 2);
          ctx.fillStyle = diag.cookD[i] > 0.5 ? "#ef4444" : primary;
          ctx.fill();
        }
      }
    }
  }, [finalState, data, family]);

  /* ── Draw link function ───────────────────────────────── */
  const drawLinkCanvas = useCallback(() => {
    const canvas = linkCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    const bg = resolveColor(canvas, "--color-bg", "#09090b");
    const border = resolveColor(canvas, "--color-border", "#27272a");
    const primary = resolveColor(canvas, "--color-primary", "#4f8ff7");
    const accent = resolveColor(canvas, "--color-accent", "#34d399");
    const textMuted = resolveColor(canvas, "--color-text-muted", "#a1a1aa");

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const pad = { l: 35, r: 10, t: 15, b: 25 };
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;

    // Determine domain
    let muMin = 0.01, muMax = 5;
    if (link.id === "logit" || link.id === "probit" || link.id === "cloglog") {
      muMin = 0.01;
      muMax = 0.99;
    }

    // Compute range of g(mu)
    const etaVals: number[] = [];
    const steps = 100;
    for (let i = 0; i <= steps; i++) {
      const mu = muMin + (i / steps) * (muMax - muMin);
      const eta = link.g(mu);
      if (Number.isFinite(eta)) etaVals.push(eta);
    }
    if (etaVals.length === 0) return;

    const etaMin = Math.min(...etaVals) - 0.5;
    const etaMax = Math.max(...etaVals) + 0.5;

    // Axes
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t);
    ctx.lineTo(pad.l, h - pad.b);
    ctx.lineTo(w - pad.r, h - pad.b);
    ctx.stroke();

    // Draw g(mu)
    ctx.strokeStyle = primary;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i <= steps; i++) {
      const mu = muMin + (i / steps) * (muMax - muMin);
      const eta = link.g(mu);
      if (!Number.isFinite(eta)) continue;
      const cx = pad.l + ((mu - muMin) / (muMax - muMin)) * pw;
      const cy = pad.t + ph * (1 - (eta - etaMin) / (etaMax - etaMin));
      if (!started) {
        ctx.moveTo(cx, cy);
        started = true;
      } else {
        ctx.lineTo(cx, cy);
      }
    }
    ctx.stroke();

    // Labels
    ctx.fillStyle = textMuted;
    ctx.font = "9px var(--font-sans)";
    ctx.textAlign = "center";
    ctx.fillText("mu (response)", w / 2, h - 4);

    ctx.save();
    ctx.translate(10, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("g(mu) = eta", 0, 0);
    ctx.restore();

    ctx.fillStyle = accent;
    ctx.font = "9px var(--font-mono)";
    ctx.textAlign = "left";
    ctx.fillText(link.formula, pad.l + 4, pad.t + 10);
  }, [link]);

  /* ── Redraw all on state change ───────────────────────── */
  useEffect(() => {
    drawMain();
    drawIRLSChart();
    drawDiagnostics();
    drawLinkCanvas();
  }, [drawMain, drawIRLSChart, drawDiagnostics, drawLinkCanvas]);

  const bestAicIdx = useMemo(() => {
    if (comparisons.length === 0) return -1;
    let bestIdx = 0;
    for (let i = 1; i < comparisons.length; i++) {
      if (comparisons[i].aic < comparisons[bestIdx].aic) bestIdx = i;
    }
    return bestIdx;
  }, [comparisons]);

  /* ══════════════════════════════════════════════════════════
     Render
     ══════════════════════════════════════════════════════════ */

  return (
    <div ref={containerRef} style={{ fontFamily: "var(--font-sans)", color: "var(--color-text)" }}>
      {/* Top: Presets + Model Config */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
        {/* Presets */}
        <div style={{ ...panelStyle, flex: "1 1 300px" }}>
          <div style={{ ...labelStyle, marginBottom: "6px", fontWeight: "600" }}>Preset Datasets</div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {PRESETS.map((p) => (
              <button key={p.id} style={btnStyle} onClick={() => loadPreset(p)}>
                {p.label}
              </button>
            ))}
            <button
              style={{ ...btnStyle, color: "#ef4444", borderColor: "#ef4444" }}
              onClick={() => setData([])}
            >
              Clear
            </button>
          </div>
          <div style={{ ...labelStyle, marginTop: "6px" }}>
            Click canvas to add points. Shift+click near a point to remove it.
          </div>
        </div>

        {/* Model config */}
        <div style={{ ...panelStyle, flex: "1 1 300px" }}>
          <div style={{ ...labelStyle, marginBottom: "6px", fontWeight: "600" }}>Model Configuration</div>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-start" }}>
            <div>
              <div style={labelStyle}>Family</div>
              <select
                style={selectStyle}
                value={familyIdx}
                onInput={(e) => handleFamilyChange(parseInt((e.target as HTMLSelectElement).value))}
              >
                {FAMILIES.map((f, i) => (
                  <option key={f.id} value={i}>{f.label}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={labelStyle}>
                Link Function{" "}
                {isCanonical && (
                  <span style={{ color: "var(--color-accent)", fontSize: "10px" }}>(canonical)</span>
                )}
              </div>
              <select
                style={selectStyle}
                value={linkIdx}
                onInput={(e) => setLinkIdx(parseInt((e.target as HTMLSelectElement).value))}
              >
                {family.links.map((lid, i) => {
                  const ldef = LINK_DEFS[lid];
                  const isCan = lid === family.canonical;
                  return (
                    <option key={lid} value={i}>
                      {ldef.label}{isCan ? " *" : ""}
                    </option>
                  );
                })}
              </select>
            </div>
            <div style={{ flex: "0 0 auto" }}>
              <div style={labelStyle}>Link formula</div>
              <div style={{ ...statStyle, fontSize: "12px" }}>{link.formula}</div>
              <div style={{ ...labelStyle, marginTop: "2px" }}>Inverse: {link.inverse}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main row: Canvas + Side panels */}
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        {/* Main visualization */}
        <div style={{ flex: "2 1 400px", minWidth: "320px" }}>
          <canvas
            ref={mainCanvasRef}
            width={600}
            height={400}
            style={{
              width: "100%",
              height: "auto",
              borderRadius: "8px",
              border: "1px solid var(--color-border)",
              cursor: "crosshair",
            }}
            onClick={handleCanvasClick}
          />

          {/* Coefficients and metrics */}
          {finalState && metrics && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: "8px", marginTop: "8px" }}>
              <div style={panelStyle}>
                <div style={labelStyle}>b0</div>
                <div style={statStyle}>{finalState.beta[0].toFixed(4)}</div>
              </div>
              <div style={panelStyle}>
                <div style={labelStyle}>b1</div>
                <div style={statStyle}>{finalState.beta[1].toFixed(4)}</div>
              </div>
              <div style={panelStyle}>
                <div style={labelStyle}>Deviance</div>
                <div style={statStyle}>{metrics.deviance.toFixed(3)}</div>
              </div>
              <div style={panelStyle}>
                <div style={labelStyle}>AIC</div>
                <div style={statStyle}>{metrics.aic.toFixed(2)}</div>
              </div>
              <div style={panelStyle}>
                <div style={labelStyle}>BIC</div>
                <div style={statStyle}>{metrics.bic.toFixed(2)}</div>
              </div>
              <div style={panelStyle}>
                <div style={labelStyle}>Dispersion</div>
                <div style={statStyle}>{metrics.phi.toFixed(4)}</div>
              </div>
            </div>
          )}
        </div>

        {/* Side panel: IRLS + Link viz */}
        <div style={{ flex: "1 1 250px", minWidth: "230px" }}>
          {/* IRLS control */}
          <div style={{ ...panelStyle, marginBottom: "10px" }}>
            <div style={{ ...labelStyle, marginBottom: "6px", fontWeight: "600" }}>IRLS Convergence</div>
            <div style={{ display: "flex", gap: "6px", marginBottom: "8px", flexWrap: "wrap" }}>
              <button
                style={btnStyle}
                disabled={currentStep <= 0}
                onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
              >
                Prev
              </button>
              <button
                style={btnStyle}
                disabled={currentStep >= irlsStates.length - 1}
                onClick={() => setCurrentStep(Math.min(irlsStates.length - 1, currentStep + 1))}
              >
                Next
              </button>
              <button
                style={autoRun ? activeBtnStyle : btnStyle}
                onClick={() => setAutoRun(!autoRun)}
              >
                {autoRun ? "Stop" : "Auto"}
              </button>
            </div>
            {finalState && (
              <div style={labelStyle}>
                Iter {finalState.iteration} | Dev: {finalState.deviance.toFixed(3)} |{" "}
                {finalState.converged ? (
                  <span style={{ color: "var(--color-accent)" }}>Converged</span>
                ) : (
                  <span style={{ color: "#fbbf24" }}>Running...</span>
                )}
              </div>
            )}
            <canvas
              ref={irlsChartRef}
              width={300}
              height={140}
              style={{ width: "100%", height: "110px", borderRadius: "6px", border: "1px solid var(--color-border)", marginTop: "6px" }}
            />
          </div>

          {/* Link function viz */}
          <div style={{ ...panelStyle }}>
            <div style={{ ...labelStyle, marginBottom: "4px", fontWeight: "600" }}>Link: {link.label}</div>
            <canvas
              ref={linkCanvasRef}
              width={280}
              height={160}
              style={{ width: "100%", height: "120px", borderRadius: "6px", border: "1px solid var(--color-border)" }}
            />
            <div style={{ ...labelStyle, marginTop: "4px" }}>
              Domain: {link.domain}
            </div>
          </div>
        </div>
      </div>

      {/* Diagnostics */}
      {finalState && data.length >= 3 && (
        <div style={{ marginTop: "16px" }}>
          <div style={{ ...labelStyle, fontWeight: "600", marginBottom: "8px" }}>Diagnostic Plots</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            {[0, 1, 2, 3].map((i) => (
              <canvas
                key={i}
                ref={diagCanvasRefs[i]}
                width={300}
                height={200}
                style={{
                  width: "100%",
                  height: "auto",
                  borderRadius: "6px",
                  border: "1px solid var(--color-border)",
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Model Comparison */}
      <div style={{ marginTop: "16px", ...panelStyle }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <div style={{ ...labelStyle, fontWeight: "600" }}>Model Comparison</div>
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              style={btnStyle}
              onClick={addComparison}
              disabled={!metrics || comparisons.length >= 3}
            >
              Add Current Model
            </button>
            {comparisons.length > 0 && (
              <button
                style={{ ...btnStyle, color: "#ef4444", borderColor: "#ef4444" }}
                onClick={() => setComparisons([])}
              >
                Clear
              </button>
            )}
          </div>
        </div>
        {comparisons.length === 0 ? (
          <div style={labelStyle}>
            Fit different models and add them to compare. Up to 3 models.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "12px",
                fontFamily: "var(--font-mono)",
              }}
            >
              <thead>
                <tr>
                  {["#", "Family", "Link", "Deviance", "AIC", "BIC", "Params"].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        padding: "6px 8px",
                        borderBottom: "1px solid var(--color-border)",
                        color: "var(--color-text-muted)",
                        fontWeight: "500",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparisons.map((c, i) => (
                  <tr
                    key={i}
                    style={{
                      background: i === bestAicIdx ? "color-mix(in srgb, var(--color-accent) 10%, transparent)" : "transparent",
                    }}
                  >
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--color-border)" }}>
                      {i + 1}{i === bestAicIdx ? " *" : ""}
                    </td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--color-border)" }}>{c.family}</td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--color-border)" }}>{c.link}</td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--color-border)" }}>{c.deviance.toFixed(3)}</td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--color-border)", color: i === bestAicIdx ? "var(--color-accent)" : "var(--color-text)" }}>
                      {c.aic.toFixed(2)}
                    </td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--color-border)" }}>{c.bic.toFixed(2)}</td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--color-border)" }}>{c.nParams}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {bestAicIdx >= 0 && (
              <div style={{ ...labelStyle, marginTop: "4px" }}>
                * Best model by AIC
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
