import {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "preact/hooks";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

interface Vec2 {
  x: number;
  y: number;
}

interface Sample extends Vec2 {
  accepted: boolean;
  iteration: number;
}

interface ChainState {
  position: Vec2;
  samples: Sample[];
  acceptCount: number;
  totalCount: number;
  hmcTrajectory: Vec2[] | null;
  lastProposal: Vec2 | null;
  lastAccepted: boolean;
}

type DistributionId =
  | "gaussian"
  | "mixture"
  | "banana"
  | "donut"
  | "bimodal"
  | "funnel";

type AlgorithmId = "mh" | "hmc" | "nuts" | "gibbs";

type SpeedMode = "slow" | "medium" | "fast" | "batch";

interface Distribution {
  id: DistributionId;
  name: string;
  logDensity: (x: number, y: number) => number;
  xRange: [number, number];
  yRange: [number, number];
  defaultStart: Vec2;
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const HEATMAP_RES = 100;
const FINITE_DIFF_H = 1e-5;
const TRACE_TAIL_LENGTH = 50;
const CHAIN_COLORS = ["#4f8ff7", "#34d399", "#f59e0b", "#a855f7"];
const HMC_TRAJECTORY_COLOR = "#f59e0b";
const REJECTED_COLOR = "#ef4444";
const MAX_ACF_LAGS = 40;

const SPEED_DELAYS: Record<SpeedMode, number> = {
  slow: 200,
  medium: 50,
  fast: 10,
  batch: 0,
};

const BATCH_SIZES: Record<SpeedMode, number> = {
  slow: 1,
  medium: 1,
  fast: 5,
  batch: 50,
};

// ─────────────────────────────────────────────────────────
// Colormap for density heatmap
// ─────────────────────────────────────────────────────────

const HEATMAP_STOPS = [
  { pos: 0.0, r: 10, g: 10, b: 40 },
  { pos: 0.15, r: 20, g: 40, b: 100 },
  { pos: 0.3, r: 30, g: 80, b: 140 },
  { pos: 0.45, r: 40, g: 140, b: 160 },
  { pos: 0.6, r: 60, g: 180, b: 120 },
  { pos: 0.75, r: 160, g: 200, b: 60 },
  { pos: 0.9, r: 240, g: 200, b: 40 },
  { pos: 1.0, r: 240, g: 60, b: 20 },
];

function heatmapColor(t: number): [number, number, number] {
  const c = Math.max(0, Math.min(1, t));
  let lo = HEATMAP_STOPS[0];
  let hi = HEATMAP_STOPS[HEATMAP_STOPS.length - 1];
  for (let i = 0; i < HEATMAP_STOPS.length - 1; i++) {
    if (c >= HEATMAP_STOPS[i].pos && c <= HEATMAP_STOPS[i + 1].pos) {
      lo = HEATMAP_STOPS[i];
      hi = HEATMAP_STOPS[i + 1];
      break;
    }
  }
  const range = hi.pos - lo.pos;
  const f = range === 0 ? 0 : (c - lo.pos) / range;
  return [
    Math.round(lo.r + f * (hi.r - lo.r)),
    Math.round(lo.g + f * (hi.g - lo.g)),
    Math.round(lo.b + f * (hi.b - lo.b)),
  ];
}

// ─────────────────────────────────────────────────────────
// Distributions (log-density)
// ─────────────────────────────────────────────────────────

function gaussLogDensity(
  x: number,
  y: number,
  mx: number,
  my: number,
  sx: number,
  sy: number,
  rho: number,
): number {
  const dx = x - mx;
  const dy = y - my;
  const z =
    (dx * dx) / (sx * sx) -
    (2 * rho * dx * dy) / (sx * sy) +
    (dy * dy) / (sy * sy);
  return -z / (2 * (1 - rho * rho));
}

const DISTRIBUTIONS: Distribution[] = [
  {
    id: "gaussian",
    name: "Gaussian",
    logDensity: (x, y) => gaussLogDensity(x, y, 0, 0, 1, 1, 0.5),
    xRange: [-4, 4],
    yRange: [-4, 4],
    defaultStart: { x: 2, y: 2 },
  },
  {
    id: "mixture",
    name: "Mixture of Gaussians",
    logDensity: (x, y) => {
      const d1 = gaussLogDensity(x, y, -1.5, -1.5, 0.7, 0.7, 0.3);
      const d2 = gaussLogDensity(x, y, 1.5, 1.5, 0.7, 0.7, -0.3);
      const d3 = gaussLogDensity(x, y, -1, 2, 0.5, 0.5, 0);
      return logSumExp([Math.log(0.4) + d1, Math.log(0.4) + d2, Math.log(0.2) + d3]);
    },
    xRange: [-4, 5],
    yRange: [-4, 5],
    defaultStart: { x: 0, y: 0 },
  },
  {
    id: "banana",
    name: "Banana (Rosenbrock)",
    logDensity: (x, y) => {
      const a = 1;
      const b = 5;
      return -0.5 * ((a - x) * (a - x) + b * (y - x * x) * (y - x * x));
    },
    xRange: [-3, 3],
    yRange: [-2, 8],
    defaultStart: { x: -1, y: 3 },
  },
  {
    id: "donut",
    name: "Donut / Ring",
    logDensity: (x, y) => {
      const r = Math.sqrt(x * x + y * y);
      const targetR = 2.5;
      return -2 * (r - targetR) * (r - targetR);
    },
    xRange: [-5, 5],
    yRange: [-5, 5],
    defaultStart: { x: 2.5, y: 0 },
  },
  {
    id: "bimodal",
    name: "Bimodal",
    logDensity: (x, y) => {
      const d1 = gaussLogDensity(x, y, -2.5, 0, 0.8, 0.8, 0);
      const d2 = gaussLogDensity(x, y, 2.5, 0, 0.8, 0.8, 0);
      return logSumExp([Math.log(0.5) + d1, Math.log(0.5) + d2]);
    },
    xRange: [-5, 5],
    yRange: [-4, 4],
    defaultStart: { x: -2, y: 0 },
  },
  {
    id: "funnel",
    name: "Neal's Funnel",
    logDensity: (x, y) => {
      const sigmaY = 1.5;
      const logpY = -0.5 * (y * y) / (sigmaY * sigmaY);
      const sx = Math.exp(y * 0.5);
      const logpXgivenY = -0.5 * (x * x) / (sx * sx) - Math.log(sx);
      return logpY + logpXgivenY;
    },
    xRange: [-6, 6],
    yRange: [-4, 4],
    defaultStart: { x: 0, y: 0 },
  },
];

function logSumExp(values: number[]): number {
  const maxVal = Math.max(...values);
  if (!isFinite(maxVal)) return -Infinity;
  let sum = 0;
  for (const v of values) {
    sum += Math.exp(v - maxVal);
  }
  return maxVal + Math.log(sum);
}

// ─────────────────────────────────────────────────────────
// Numerical gradient via finite differences
// ─────────────────────────────────────────────────────────

function gradLogDensity(
  logDensity: (x: number, y: number) => number,
  x: number,
  y: number,
): Vec2 {
  const h = FINITE_DIFF_H;
  const dfdx = (logDensity(x + h, y) - logDensity(x - h, y)) / (2 * h);
  const dfdy = (logDensity(x, y + h) - logDensity(x, y - h)) / (2 * h);
  return { x: isFinite(dfdx) ? dfdx : 0, y: isFinite(dfdy) ? dfdy : 0 };
}

// ─────────────────────────────────────────────────────────
// Random number utilities
// ─────────────────────────────────────────────────────────

function randn(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ─────────────────────────────────────────────────────────
// Sampling algorithms
// ─────────────────────────────────────────────────────────

function metropolisHastingsStep(
  state: ChainState,
  dist: Distribution,
  proposalSigma: number,
): ChainState {
  const { position } = state;
  const proposal: Vec2 = {
    x: position.x + randn() * proposalSigma,
    y: position.y + randn() * proposalSigma,
  };
  const logCurrent = dist.logDensity(position.x, position.y);
  const logProposal = dist.logDensity(proposal.x, proposal.y);
  const logAlpha = logProposal - logCurrent;
  const accepted = Math.log(Math.random()) < logAlpha;
  const newPos = accepted ? proposal : position;
  const iteration = state.totalCount + 1;

  state.samples.push({ x: newPos.x, y: newPos.y, accepted, iteration });

  return {
    position: newPos,
    samples: state.samples,
    acceptCount: state.acceptCount + (accepted ? 1 : 0),
    totalCount: iteration,
    hmcTrajectory: null,
    lastProposal: proposal,
    lastAccepted: accepted,
  };
}

function hmcStep(
  state: ChainState,
  dist: Distribution,
  stepSize: number,
  leapfrogSteps: number,
): ChainState {
  const q0: Vec2 = { ...state.position };
  let q: Vec2 = { ...q0 };
  let p: Vec2 = { x: randn(), y: randn() };
  const p0: Vec2 = { ...p };

  const trajectory: Vec2[] = [{ ...q }];

  // Leapfrog integration
  let grad = gradLogDensity(dist.logDensity, q.x, q.y);
  p.x += (stepSize / 2) * grad.x;
  p.y += (stepSize / 2) * grad.y;

  for (let i = 0; i < leapfrogSteps; i++) {
    q = { x: q.x + stepSize * p.x, y: q.y + stepSize * p.y };
    trajectory.push({ ...q });

    if (i < leapfrogSteps - 1) {
      grad = gradLogDensity(dist.logDensity, q.x, q.y);
      p.x += stepSize * grad.x;
      p.y += stepSize * grad.y;
    }
  }

  grad = gradLogDensity(dist.logDensity, q.x, q.y);
  p.x += (stepSize / 2) * grad.x;
  p.y += (stepSize / 2) * grad.y;
  p = { x: -p.x, y: -p.y };

  const currentH =
    -dist.logDensity(q0.x, q0.y) + 0.5 * (p0.x * p0.x + p0.y * p0.y);
  const proposedH =
    -dist.logDensity(q.x, q.y) + 0.5 * (p.x * p.x + p.y * p.y);
  const logAlpha = currentH - proposedH;
  const accepted = isFinite(logAlpha) && Math.log(Math.random()) < logAlpha;
  const newPos = accepted ? q : q0;
  const iteration = state.totalCount + 1;

  state.samples.push({ x: newPos.x, y: newPos.y, accepted, iteration });

  return {
    position: newPos,
    samples: state.samples,
    acceptCount: state.acceptCount + (accepted ? 1 : 0),
    totalCount: iteration,
    hmcTrajectory: trajectory,
    lastProposal: q,
    lastAccepted: accepted,
  };
}

function nutsStep(
  state: ChainState,
  dist: Distribution,
  stepSize: number,
): ChainState {
  // Simplified NUTS: build tree doubling until U-turn detected
  const q0: Vec2 = { ...state.position };
  let p0: Vec2 = { x: randn(), y: randn() };
  const trajectory: Vec2[] = [{ ...q0 }];

  const logU = dist.logDensity(q0.x, q0.y) - 0.5 * (p0.x * p0.x + p0.y * p0.y) + Math.log(Math.random());

  let qMinus: Vec2 = { ...q0 };
  let pMinus: Vec2 = { ...p0 };
  let qPlus: Vec2 = { ...q0 };
  let pPlus: Vec2 = { ...p0 };
  let candidate: Vec2 = { ...q0 };
  let candidateCount = 1;
  let depth = 0;
  const maxDepth = 6;

  function leapfrog(q: Vec2, p: Vec2, eps: number): { q: Vec2; p: Vec2 } {
    const grad0 = gradLogDensity(dist.logDensity, q.x, q.y);
    const pHalf: Vec2 = { x: p.x + (eps / 2) * grad0.x, y: p.y + (eps / 2) * grad0.y };
    const qNew: Vec2 = { x: q.x + eps * pHalf.x, y: q.y + eps * pHalf.y };
    const grad1 = gradLogDensity(dist.logDensity, qNew.x, qNew.y);
    const pNew: Vec2 = { x: pHalf.x + (eps / 2) * grad1.x, y: pHalf.y + (eps / 2) * grad1.y };
    return { q: qNew, p: pNew };
  }

  function uTurn(qm: Vec2, qp: Vec2, pm: Vec2, pp: Vec2): boolean {
    const dq: Vec2 = { x: qp.x - qm.x, y: qp.y - qm.y };
    return (dq.x * pm.x + dq.y * pm.y) < 0 || (dq.x * pp.x + dq.y * pp.y) < 0;
  }

  while (depth < maxDepth) {
    const direction = Math.random() < 0.5 ? 1 : -1;
    const eps = direction * stepSize;
    const stepsInTree = 1 << depth;

    if (direction === 1) {
      for (let i = 0; i < stepsInTree; i++) {
        const result = leapfrog(qPlus, pPlus, eps);
        qPlus = result.q;
        pPlus = result.p;
        trajectory.push({ ...qPlus });

        const energy = dist.logDensity(qPlus.x, qPlus.y) - 0.5 * (pPlus.x * pPlus.x + pPlus.y * pPlus.y);
        if (energy > logU) {
          candidateCount++;
          if (Math.random() < 1 / candidateCount) {
            candidate = { ...qPlus };
          }
        }
      }
    } else {
      for (let i = 0; i < stepsInTree; i++) {
        const result = leapfrog(qMinus, pMinus, eps);
        qMinus = result.q;
        pMinus = result.p;
        trajectory.push({ ...qMinus });

        const energy = dist.logDensity(qMinus.x, qMinus.y) - 0.5 * (pMinus.x * pMinus.x + pMinus.y * pMinus.y);
        if (energy > logU) {
          candidateCount++;
          if (Math.random() < 1 / candidateCount) {
            candidate = { ...qMinus };
          }
        }
      }
    }

    if (uTurn(qMinus, qPlus, pMinus, pPlus)) break;
    depth++;
  }

  const accepted = candidate.x !== q0.x || candidate.y !== q0.y;
  const newPos = candidate;
  const iteration = state.totalCount + 1;

  state.samples.push({ x: newPos.x, y: newPos.y, accepted, iteration });

  return {
    position: newPos,
    samples: state.samples,
    acceptCount: state.acceptCount + (accepted ? 1 : 0),
    totalCount: iteration,
    hmcTrajectory: trajectory,
    lastProposal: candidate,
    lastAccepted: accepted,
  };
}

function gibbsStep(
  state: ChainState,
  dist: Distribution,
): ChainState {
  const { position } = state;
  let newX = position.x;
  let newY = position.y;

  // Sample x | y using slice-like MH within conditional
  const numSlice = 30;
  const xRange = dist.xRange;
  const yRange = dist.yRange;

  // Sample x conditional on y
  {
    let bestX = newX;
    let bestLog = dist.logDensity(bestX, newY);
    for (let i = 0; i < numSlice; i++) {
      const candidateX = xRange[0] + Math.random() * (xRange[1] - xRange[0]);
      const logP = dist.logDensity(candidateX, newY);
      if (Math.log(Math.random()) < logP - bestLog) {
        bestX = candidateX;
        bestLog = logP;
      }
    }
    newX = bestX;
  }

  // Sample y conditional on x
  {
    let bestY = newY;
    let bestLog = dist.logDensity(newX, bestY);
    for (let i = 0; i < numSlice; i++) {
      const candidateY = yRange[0] + Math.random() * (yRange[1] - yRange[0]);
      const logP = dist.logDensity(newX, candidateY);
      if (Math.log(Math.random()) < logP - bestLog) {
        bestY = candidateY;
        bestLog = logP;
      }
    }
    newY = bestY;
  }

  const iteration = state.totalCount + 1;

  state.samples.push({ x: newX, y: newY, accepted: true, iteration });

  return {
    position: { x: newX, y: newY },
    samples: state.samples,
    acceptCount: state.acceptCount + 1,
    totalCount: iteration,
    hmcTrajectory: null,
    lastProposal: { x: newX, y: newY },
    lastAccepted: true,
  };
}

// ─────────────────────────────────────────────────────────
// Diagnostics
// ─────────────────────────────────────────────────────────

function computeACF(values: number[], maxLag: number): number[] {
  const n = values.length;
  if (n < 2) return new Array(maxLag).fill(0);

  let mean = 0;
  for (const v of values) mean += v;
  mean /= n;

  let variance = 0;
  for (const v of values) variance += (v - mean) * (v - mean);
  variance /= n;

  if (variance === 0) return new Array(maxLag).fill(0);

  const acf: number[] = [];
  for (let lag = 0; lag < maxLag; lag++) {
    let cov = 0;
    for (let i = 0; i < n - lag; i++) {
      cov += (values[i] - mean) * (values[i + lag] - mean);
    }
    cov /= n;
    acf.push(cov / variance);
  }
  return acf;
}

function computeESS(values: number[]): number {
  if (values.length < 2) return 0;
  const acf = computeACF(values, Math.min(MAX_ACF_LAGS, Math.floor(values.length / 2)));
  let sum = 0;
  for (let k = 1; k < acf.length; k++) {
    if (acf[k] < 0.05) break;
    sum += acf[k];
  }
  const ess = values.length / (1 + 2 * sum);
  return Math.max(1, Math.min(values.length, ess));
}

function computeMean(values: number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

function computeVariance(values: number[]): number {
  if (values.length < 2) return 0;
  const m = computeMean(values);
  let s = 0;
  for (const v of values) s += (v - m) * (v - m);
  return s / (values.length - 1);
}

// ─────────────────────────────────────────────────────────
// Heatmap cache
// ─────────────────────────────────────────────────────────

function computeHeatmapData(
  dist: Distribution,
  width: number,
  height: number,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  const [xMin, xMax] = dist.xRange;
  const [yMin, yMax] = dist.yRange;

  // First pass: compute log densities to find range
  const logVals = new Float64Array(width * height);
  let maxLog = -Infinity;
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const x = xMin + ((i + 0.5) / width) * (xMax - xMin);
      const y = yMax - ((j + 0.5) / height) * (yMax - yMin);
      const logD = dist.logDensity(x, y);
      logVals[j * width + i] = logD;
      if (isFinite(logD) && logD > maxLog) maxLog = logD;
    }
  }

  // Second pass: normalize and color
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const idx = j * width + i;
      const logD = logVals[idx];
      let t = 0;
      if (isFinite(logD) && isFinite(maxLog)) {
        const diff = logD - maxLog;
        t = Math.exp(diff);
        t = Math.pow(t, 0.3); // gamma correction for visibility
      }
      const [r, g, b] = heatmapColor(t);
      data[idx * 4] = r;
      data[idx * 4 + 1] = g;
      data[idx * 4 + 2] = b;
      data[idx * 4 + 3] = 255;
    }
  }
  return data;
}

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

export default function McmcVisualizer() {
  // Settings
  const [distId, setDistId] = useState<DistributionId>("gaussian");
  const [algId, setAlgId] = useState<AlgorithmId>("mh");
  const [proposalSigma, setProposalSigma] = useState(0.5);
  const [hmcStepSize, setHmcStepSize] = useState(0.1);
  const [leapfrogSteps, setLeapfrogSteps] = useState(20);
  const [maxSamples, setMaxSamples] = useState(2000);
  const [speed, setSpeed] = useState<SpeedMode>("medium");
  const [burnIn, setBurnIn] = useState(100);
  const [thinning, setThinning] = useState(1);
  const [showTrace, setShowTrace] = useState(true);
  const [showDensity, setShowDensity] = useState(true);
  const [multiChain, setMultiChain] = useState(false);
  const [numChains, setNumChains] = useState(4);

  // Playback
  const [playing, setPlaying] = useState(false);

  // State
  const [chains, setChains] = useState<ChainState[]>([]);
  const [heatmapPixels, setHeatmapPixels] = useState<Uint8ClampedArray | null>(null);

  // Refs
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const traceXCanvasRef = useRef<HTMLCanvasElement>(null);
  const traceYCanvasRef = useRef<HTMLCanvasElement>(null);
  const marginalCanvasRef = useRef<HTMLCanvasElement>(null);
  const acfCanvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const playingRef = useRef(false);
  const chainsRef = useRef<ChainState[]>([]);

  const dist = DISTRIBUTIONS.find((d) => d.id === distId) ?? DISTRIBUTIONS[0];

  // Keep refs in sync
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    chainsRef.current = chains;
  }, [chains]);

  // ─────────────────────────────────────────────────────
  // Initialize chains
  // ─────────────────────────────────────────────────────

  const initChains = useCallback(() => {
    const count = multiChain ? numChains : 1;
    const newChains: ChainState[] = [];
    const offsets = [
      { x: 0, y: 0 },
      { x: 1, y: -1 },
      { x: -1, y: 1 },
      { x: 1, y: 1 },
    ];

    for (let c = 0; c < count; c++) {
      const off = offsets[c % offsets.length];
      newChains.push({
        position: {
          x: dist.defaultStart.x + off.x,
          y: dist.defaultStart.y + off.y,
        },
        samples: [],
        acceptCount: 0,
        totalCount: 0,
        hmcTrajectory: null,
        lastProposal: null,
        lastAccepted: false,
      });
    }

    setChains(newChains);
    chainsRef.current = newChains;
    setPlaying(false);
  }, [dist, multiChain, numChains]);

  // ─────────────────────────────────────────────────────
  // Compute heatmap
  // ─────────────────────────────────────────────────────

  useEffect(() => {
    const pixels = computeHeatmapData(dist, HEATMAP_RES, HEATMAP_RES);
    setHeatmapPixels(pixels);
    initChains();
  }, [dist]);

  useEffect(() => {
    initChains();
  }, [multiChain, numChains]);

  // ─────────────────────────────────────────────────────
  // Step function
  // ─────────────────────────────────────────────────────

  const doStep = useCallback(
    (currentChains: ChainState[]): ChainState[] => {
      return currentChains.map((chain) => {
        if (chain.totalCount >= maxSamples) return chain;

        switch (algId) {
          case "mh":
            return metropolisHastingsStep(chain, dist, proposalSigma);
          case "hmc":
            return hmcStep(chain, dist, hmcStepSize, leapfrogSteps);
          case "nuts":
            return nutsStep(chain, dist, hmcStepSize);
          case "gibbs":
            return gibbsStep(chain, dist);
          default:
            return chain;
        }
      });
    },
    [algId, dist, proposalSigma, hmcStepSize, leapfrogSteps, maxSamples],
  );

  // ─────────────────────────────────────────────────────
  // Step (manual)
  // ─────────────────────────────────────────────────────

  const handleStep = useCallback(() => {
    setChains((prev) => {
      const next = doStep(prev);
      chainsRef.current = next;
      return next;
    });
  }, [doStep]);

  // ─────────────────────────────────────────────────────
  // Animation loop
  // ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!playing) return;

    const delay = SPEED_DELAYS[speed];
    const batchSize = BATCH_SIZES[speed];

    let lastTime = 0;
    let mounted = true;

    function tick(timestamp: number) {
      if (!mounted || !playingRef.current) return;

      if (timestamp - lastTime >= delay) {
        lastTime = timestamp;

        setChains((prev) => {
          let current = prev;
          for (let i = 0; i < batchSize; i++) {
            const allDone = current.every((c) => c.totalCount >= maxSamples);
            if (allDone) {
              setPlaying(false);
              return current;
            }
            current = doStep(current);
          }
          chainsRef.current = current;
          return current;
        });
      }

      animFrameRef.current = requestAnimationFrame(tick);
    }

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      mounted = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [playing, speed, doStep, maxSamples]);

  // ─────────────────────────────────────────────────────
  // Canvas coordinate helpers
  // ─────────────────────────────────────────────────────

  const worldToCanvas = useCallback(
    (wx: number, wy: number, cw: number, ch: number): [number, number] => {
      const [xMin, xMax] = dist.xRange;
      const [yMin, yMax] = dist.yRange;
      const cx = ((wx - xMin) / (xMax - xMin)) * cw;
      const cy = ((yMax - wy) / (yMax - yMin)) * ch;
      return [cx, cy];
    },
    [dist],
  );

  // ─────────────────────────────────────────────────────
  // Draw main canvas
  // ─────────────────────────────────────────────────────

  const drawMain = useCallback(() => {
    const canvas = mainCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Draw heatmap
    if (showDensity && heatmapPixels) {
      const imgData = ctx.createImageData(HEATMAP_RES, HEATMAP_RES);
      imgData.data.set(heatmapPixels);
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = HEATMAP_RES;
      tempCanvas.height = HEATMAP_RES;
      const tctx = tempCanvas.getContext("2d");
      if (tctx) {
        tctx.putImageData(imgData, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(tempCanvas, 0, 0, W, H);
      }
    } else {
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, W, H);
    }

    const currentChains = chainsRef.current;
    const chainCount = currentChains.length;

    for (let ci = 0; ci < chainCount; ci++) {
      const chain = currentChains[ci];
      const color = CHAIN_COLORS[ci % CHAIN_COLORS.length];
      const effectiveSamples = getEffectiveSamples(chain.samples, burnIn, thinning);

      // Draw all accepted samples
      ctx.globalAlpha = 0.5;
      for (const s of effectiveSamples) {
        if (s.accepted) {
          const [cx, cy] = worldToCanvas(s.x, s.y, W, H);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // Draw trace line (last N samples)
      if (showTrace && effectiveSamples.length > 1) {
        const tail = effectiveSamples.slice(-TRACE_TAIL_LENGTH);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < tail.length; i++) {
          const [cx, cy] = worldToCanvas(tail[i].x, tail[i].y, W, H);
          ctx.globalAlpha = 0.2 + (0.8 * i) / tail.length;
          if (i === 0) ctx.moveTo(cx, cy);
          else ctx.lineTo(cx, cy);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Draw HMC trajectory
      if (chain.hmcTrajectory && chain.hmcTrajectory.length > 1) {
        ctx.strokeStyle = HMC_TRAJECTORY_COLOR;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        for (let i = 0; i < chain.hmcTrajectory.length; i++) {
          const [cx, cy] = worldToCanvas(
            chain.hmcTrajectory[i].x,
            chain.hmcTrajectory[i].y,
            W,
            H,
          );
          if (i === 0) ctx.moveTo(cx, cy);
          else ctx.lineTo(cx, cy);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      // Draw rejected proposal
      if (chain.lastProposal && !chain.lastAccepted) {
        const [rx, ry] = worldToCanvas(chain.lastProposal.x, chain.lastProposal.y, W, H);
        ctx.fillStyle = REJECTED_COLOR;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(rx, ry, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Draw current position
      const [px, py] = worldToCanvas(chain.position.x, chain.position.y, W, H);
      ctx.fillStyle = color;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }, [chains, heatmapPixels, showDensity, showTrace, worldToCanvas, burnIn, thinning]);

  // ─────────────────────────────────────────────────────
  // Draw diagnostic plots
  // ─────────────────────────────────────────────────────

  const drawDiagnostics = useCallback(() => {
    const chain0 = chainsRef.current[0];
    if (!chain0) return;

    const effectiveSamples = getEffectiveSamples(chain0.samples, burnIn, thinning);
    const xVals = effectiveSamples.map((s) => s.x);
    const yVals = effectiveSamples.map((s) => s.y);

    drawTracePlot(traceXCanvasRef.current, xVals, "x trace", CHAIN_COLORS[0]);
    drawTracePlot(traceYCanvasRef.current, yVals, "y trace", CHAIN_COLORS[0]);

    // Draw additional chains on trace plots
    if (multiChain) {
      for (let ci = 1; ci < chainsRef.current.length; ci++) {
        const eff = getEffectiveSamples(chainsRef.current[ci].samples, burnIn, thinning);
        drawTraceOverlay(traceXCanvasRef.current, eff.map((s) => s.x), CHAIN_COLORS[ci % CHAIN_COLORS.length]);
        drawTraceOverlay(traceYCanvasRef.current, eff.map((s) => s.y), CHAIN_COLORS[ci % CHAIN_COLORS.length]);
      }
    }

    drawMarginalPlot(marginalCanvasRef.current, xVals, yVals);
    drawACFPlot(acfCanvasRef.current, xVals, yVals);
  }, [chains, burnIn, thinning, multiChain]);

  // ─────────────────────────────────────────────────────
  // Render loop
  // ─────────────────────────────────────────────────────

  useEffect(() => {
    drawMain();
    drawDiagnostics();
  }, [drawMain, drawDiagnostics]);

  // ─────────────────────────────────────────────────────
  // Compute statistics
  // ─────────────────────────────────────────────────────

  const stats = computeStats(chains, burnIn, thinning);

  // ─────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    setPlaying(false);
    initChains();
  }, [initChains]);

  const handlePlayPause = useCallback(() => {
    setPlaying((p) => !p);
  }, []);

  // ─────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────

  return (
    <div class="mcmc-root" style={{ fontFamily: "var(--font-sans)" }}>
      <div class="mcmc-layout">
        {/* Main visualization area */}
        <div class="mcmc-main">
          <div class="mcmc-canvas-wrap">
            <canvas
              ref={mainCanvasRef}
              width={500}
              height={500}
              class="mcmc-canvas"
            />
          </div>

          {/* Diagnostic plots */}
          <div class="mcmc-diag-grid">
            <div class="mcmc-diag-panel">
              <div class="mcmc-diag-label">x Trace</div>
              <canvas ref={traceXCanvasRef} width={280} height={100} class="mcmc-diag-canvas" />
            </div>
            <div class="mcmc-diag-panel">
              <div class="mcmc-diag-label">Marginals</div>
              <canvas ref={marginalCanvasRef} width={280} height={100} class="mcmc-diag-canvas" />
            </div>
            <div class="mcmc-diag-panel">
              <div class="mcmc-diag-label">y Trace</div>
              <canvas ref={traceYCanvasRef} width={280} height={100} class="mcmc-diag-canvas" />
            </div>
            <div class="mcmc-diag-panel">
              <div class="mcmc-diag-label">Autocorrelation</div>
              <canvas ref={acfCanvasRef} width={280} height={100} class="mcmc-diag-canvas" />
            </div>
          </div>
        </div>

        {/* Controls sidebar */}
        <div class="mcmc-sidebar">
          {/* Distribution selector */}
          <div class="mcmc-control-group">
            <label class="mcmc-label">Target Distribution</label>
            <select
              class="mcmc-select"
              value={distId}
              onChange={(e) => setDistId((e.target as HTMLSelectElement).value as DistributionId)}
            >
              {DISTRIBUTIONS.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          {/* Algorithm selector */}
          <div class="mcmc-control-group">
            <label class="mcmc-label">Algorithm</label>
            <select
              class="mcmc-select"
              value={algId}
              onChange={(e) => {
                setAlgId((e.target as HTMLSelectElement).value as AlgorithmId);
                initChains();
              }}
            >
              <option value="mh">Metropolis-Hastings</option>
              <option value="hmc">Hamiltonian Monte Carlo</option>
              <option value="nuts">NUTS (No-U-Turn)</option>
              <option value="gibbs">Gibbs Sampling</option>
            </select>
          </div>

          {/* MH-specific controls */}
          {algId === "mh" && (
            <div class="mcmc-control-group">
              <label class="mcmc-label">
                Proposal sigma: {proposalSigma.toFixed(2)}
              </label>
              <input
                type="range"
                class="mcmc-slider"
                min="0.05"
                max="3"
                step="0.05"
                value={proposalSigma}
                onInput={(e) => setProposalSigma(parseFloat((e.target as HTMLInputElement).value))}
              />
            </div>
          )}

          {/* HMC/NUTS-specific controls */}
          {(algId === "hmc" || algId === "nuts") && (
            <>
              <div class="mcmc-control-group">
                <label class="mcmc-label">
                  Step size (epsilon): {hmcStepSize.toFixed(3)}
                </label>
                <input
                  type="range"
                  class="mcmc-slider"
                  min="0.005"
                  max="0.5"
                  step="0.005"
                  value={hmcStepSize}
                  onInput={(e) => setHmcStepSize(parseFloat((e.target as HTMLInputElement).value))}
                />
              </div>
              {algId === "hmc" && (
                <div class="mcmc-control-group">
                  <label class="mcmc-label">
                    Leapfrog steps: {leapfrogSteps}
                  </label>
                  <input
                    type="range"
                    class="mcmc-slider"
                    min="5"
                    max="100"
                    step="1"
                    value={leapfrogSteps}
                    onInput={(e) => setLeapfrogSteps(parseInt((e.target as HTMLInputElement).value))}
                  />
                </div>
              )}
            </>
          )}

          {/* Common controls */}
          <div class="mcmc-control-group">
            <label class="mcmc-label">
              Max samples: {maxSamples}
            </label>
            <input
              type="range"
              class="mcmc-slider"
              min="100"
              max="10000"
              step="100"
              value={maxSamples}
              onInput={(e) => setMaxSamples(parseInt((e.target as HTMLInputElement).value))}
            />
          </div>

          <div class="mcmc-control-group">
            <label class="mcmc-label">Speed</label>
            <select
              class="mcmc-select"
              value={speed}
              onChange={(e) => setSpeed((e.target as HTMLSelectElement).value as SpeedMode)}
            >
              <option value="slow">Slow (step-by-step)</option>
              <option value="medium">Medium</option>
              <option value="fast">Fast</option>
              <option value="batch">Batch (instant)</option>
            </select>
          </div>

          {/* Playback controls */}
          <div class="mcmc-buttons">
            <button
              class="mcmc-btn mcmc-btn-primary"
              onClick={handlePlayPause}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <button
              class="mcmc-btn"
              onClick={handleStep}
              disabled={playing}
            >
              Step
            </button>
            <button class="mcmc-btn" onClick={handleReset}>
              Reset
            </button>
          </div>

          {/* Burn-in / Thinning */}
          <div class="mcmc-control-group">
            <label class="mcmc-label">
              Burn-in: {burnIn}
            </label>
            <input
              type="range"
              class="mcmc-slider"
              min="0"
              max="1000"
              step="10"
              value={burnIn}
              onInput={(e) => setBurnIn(parseInt((e.target as HTMLInputElement).value))}
            />
          </div>

          <div class="mcmc-control-group">
            <label class="mcmc-label">
              Thinning: every {thinning}
            </label>
            <input
              type="range"
              class="mcmc-slider"
              min="1"
              max="20"
              step="1"
              value={thinning}
              onInput={(e) => setThinning(parseInt((e.target as HTMLInputElement).value))}
            />
          </div>

          {/* Toggles */}
          <div class="mcmc-toggles">
            <label class="mcmc-toggle-label">
              <input
                type="checkbox"
                checked={showTrace}
                onChange={() => setShowTrace((v) => !v)}
              />
              <span>Show trace</span>
            </label>
            <label class="mcmc-toggle-label">
              <input
                type="checkbox"
                checked={showDensity}
                onChange={() => setShowDensity((v) => !v)}
              />
              <span>Show density</span>
            </label>
            <label class="mcmc-toggle-label">
              <input
                type="checkbox"
                checked={multiChain}
                onChange={() => setMultiChain((v) => !v)}
              />
              <span>Multi-chain ({numChains})</span>
            </label>
          </div>

          {multiChain && (
            <div class="mcmc-control-group">
              <label class="mcmc-label">Chains: {numChains}</label>
              <input
                type="range"
                class="mcmc-slider"
                min="2"
                max="4"
                step="1"
                value={numChains}
                onInput={(e) => setNumChains(parseInt((e.target as HTMLInputElement).value))}
              />
            </div>
          )}

          {/* Statistics */}
          <div class="mcmc-stats">
            <div class="mcmc-stats-title">Statistics</div>
            <div class="mcmc-stat-row">
              <span>Samples:</span>
              <span>{stats.totalSamples}</span>
            </div>
            <div class="mcmc-stat-row">
              <span>Effective (after burn-in):</span>
              <span>{stats.effectiveSamples}</span>
            </div>
            <div class="mcmc-stat-row">
              <span>Accept rate:</span>
              <span>{stats.acceptRate}</span>
            </div>
            <div class="mcmc-stat-row">
              <span>ESS (x):</span>
              <span>{stats.essX}</span>
            </div>
            <div class="mcmc-stat-row">
              <span>ESS (y):</span>
              <span>{stats.essY}</span>
            </div>
            <div class="mcmc-stat-row">
              <span>Mean x:</span>
              <span>{stats.meanX}</span>
            </div>
            <div class="mcmc-stat-row">
              <span>Mean y:</span>
              <span>{stats.meanY}</span>
            </div>
            <div class="mcmc-stat-row">
              <span>Var x:</span>
              <span>{stats.varX}</span>
            </div>
            <div class="mcmc-stat-row">
              <span>Var y:</span>
              <span>{stats.varY}</span>
            </div>
            {multiChain && chains.length > 1 && (
              <div class="mcmc-stat-row">
                <span>R-hat (x):</span>
                <span>{stats.rHatX}</span>
              </div>
            )}
          </div>

          {/* Legend */}
          <div class="mcmc-legend">
            <div class="mcmc-legend-title">Legend</div>
            <div class="mcmc-legend-item">
              <span class="mcmc-dot" style={{ background: CHAIN_COLORS[0] }} />
              <span>Accepted samples</span>
            </div>
            <div class="mcmc-legend-item">
              <span class="mcmc-dot" style={{ background: REJECTED_COLOR }} />
              <span>Rejected proposal</span>
            </div>
            {(algId === "hmc" || algId === "nuts") && (
              <div class="mcmc-legend-item">
                <span class="mcmc-dot" style={{ background: HMC_TRAJECTORY_COLOR }} />
                <span>Leapfrog trajectory</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .mcmc-root {
          color: var(--color-text);
        }

        .mcmc-layout {
          display: grid;
          grid-template-columns: 1fr 260px;
          gap: 16px;
        }

        @media (max-width: 800px) {
          .mcmc-layout {
            grid-template-columns: 1fr;
          }
        }

        .mcmc-main {
          display: flex;
          flex-direction: column;
          gap: 12px;
          min-width: 0;
        }

        .mcmc-canvas-wrap {
          border: 1px solid var(--color-border);
          border-radius: 8px;
          overflow: hidden;
          aspect-ratio: 1;
          max-height: 500px;
        }

        .mcmc-canvas {
          width: 100%;
          height: 100%;
          display: block;
        }

        .mcmc-diag-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }

        @media (max-width: 600px) {
          .mcmc-diag-grid {
            grid-template-columns: 1fr;
          }
        }

        .mcmc-diag-panel {
          border: 1px solid var(--color-border);
          border-radius: 6px;
          padding: 6px;
          background: color-mix(in srgb, var(--color-surface) 80%, transparent);
        }

        .mcmc-diag-label {
          font-size: 10px;
          font-weight: 600;
          color: var(--color-text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 4px;
        }

        .mcmc-diag-canvas {
          width: 100%;
          height: 100px;
          display: block;
          border-radius: 4px;
        }

        .mcmc-sidebar {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 12px;
          border: 1px solid var(--color-border);
          border-radius: 8px;
          background: color-mix(in srgb, var(--color-surface) 80%, transparent);
          font-size: 12px;
          overflow-y: auto;
          max-height: 820px;
        }

        .mcmc-control-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .mcmc-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--color-text-muted);
        }

        .mcmc-select {
          background: var(--color-bg);
          color: var(--color-text);
          border: 1px solid var(--color-border);
          border-radius: 4px;
          padding: 4px 6px;
          font-size: 12px;
          cursor: pointer;
        }

        .mcmc-slider {
          width: 100%;
          accent-color: var(--color-primary);
          cursor: pointer;
        }

        .mcmc-buttons {
          display: flex;
          gap: 6px;
        }

        .mcmc-btn {
          flex: 1;
          padding: 6px 10px;
          border: 1px solid var(--color-border);
          border-radius: 4px;
          background: var(--color-bg);
          color: var(--color-text);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
        }

        .mcmc-btn:hover {
          border-color: var(--color-primary);
        }

        .mcmc-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .mcmc-btn-primary {
          background: var(--color-primary);
          color: #fff;
          border-color: var(--color-primary);
        }

        .mcmc-btn-primary:hover {
          opacity: 0.9;
        }

        .mcmc-toggles {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .mcmc-toggle-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: var(--color-text);
          cursor: pointer;
        }

        .mcmc-toggle-label input {
          accent-color: var(--color-primary);
        }

        .mcmc-stats {
          border-top: 1px solid var(--color-border);
          padding-top: 8px;
        }

        .mcmc-stats-title {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--color-text-muted);
          margin-bottom: 6px;
        }

        .mcmc-stat-row {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: var(--color-text-muted);
          padding: 1px 0;
        }

        .mcmc-stat-row span:last-child {
          font-family: var(--font-mono);
          color: var(--color-text);
        }

        .mcmc-legend {
          border-top: 1px solid var(--color-border);
          padding-top: 8px;
        }

        .mcmc-legend-title {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--color-text-muted);
          margin-bottom: 4px;
        }

        .mcmc-legend-item {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: var(--color-text-muted);
          padding: 1px 0;
        }

        .mcmc-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          display: inline-block;
          flex-shrink: 0;
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Helper: get effective samples after burn-in + thinning
// ─────────────────────────────────────────────────────────

function getEffectiveSamples(
  samples: Sample[],
  burnIn: number,
  thinning: number,
): Sample[] {
  const afterBurnIn = samples.slice(burnIn);
  if (thinning <= 1) return afterBurnIn;
  return afterBurnIn.filter((_, i) => i % thinning === 0);
}

// ─────────────────────────────────────────────────────────
// Compute stats for display
// ─────────────────────────────────────────────────────────

function computeStats(
  chains: ChainState[],
  burnIn: number,
  thinning: number,
): Record<string, string> {
  if (chains.length === 0) {
    return {
      totalSamples: "0",
      effectiveSamples: "0",
      acceptRate: "0%",
      essX: "0",
      essY: "0",
      meanX: "-",
      meanY: "-",
      varX: "-",
      varY: "-",
      rHatX: "-",
    };
  }

  const chain0 = chains[0];
  const eff0 = getEffectiveSamples(chain0.samples, burnIn, thinning);
  const xVals = eff0.map((s) => s.x);
  const yVals = eff0.map((s) => s.y);

  const totalSamples = chain0.totalCount;
  const acceptRate =
    chain0.totalCount > 0
      ? ((chain0.acceptCount / chain0.totalCount) * 100).toFixed(1) + "%"
      : "0%";

  const essX = Math.round(computeESS(xVals));
  const essY = Math.round(computeESS(yVals));

  // R-hat for multi-chain
  let rHatX = "-";
  if (chains.length > 1) {
    const chainMeansX: number[] = [];
    const chainVarsX: number[] = [];
    let totalN = 0;
    for (const c of chains) {
      const eff = getEffectiveSamples(c.samples, burnIn, thinning);
      const xs = eff.map((s) => s.x);
      if (xs.length < 2) continue;
      chainMeansX.push(computeMean(xs));
      chainVarsX.push(computeVariance(xs));
      totalN += xs.length;
    }

    if (chainMeansX.length > 1) {
      const m = chains.length;
      const n = totalN / m;
      const grandMean = computeMean(chainMeansX);
      let B = 0;
      for (const cm of chainMeansX) B += (cm - grandMean) * (cm - grandMean);
      B = (n / (m - 1)) * B;
      const W = computeMean(chainVarsX);
      if (W > 0) {
        const varPlus = ((n - 1) / n) * W + (1 / n) * B;
        const rhat = Math.sqrt(varPlus / W);
        rHatX = rhat.toFixed(3);
      }
    }
  }

  return {
    totalSamples: String(totalSamples),
    effectiveSamples: String(eff0.length),
    acceptRate,
    essX: String(essX),
    essY: String(essY),
    meanX: xVals.length > 0 ? computeMean(xVals).toFixed(3) : "-",
    meanY: yVals.length > 0 ? computeMean(yVals).toFixed(3) : "-",
    varX: xVals.length > 0 ? computeVariance(xVals).toFixed(3) : "-",
    varY: yVals.length > 0 ? computeVariance(yVals).toFixed(3) : "-",
    rHatX,
  };
}

// ─────────────────────────────────────────────────────────
// Draw trace plot
// ─────────────────────────────────────────────────────────

function drawTracePlot(
  canvas: HTMLCanvasElement | null,
  values: number[],
  label: string,
  color: string,
): void {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = "#0a0a0f";
  ctx.fillRect(0, 0, W, H);

  if (values.length < 2) {
    ctx.fillStyle = "#666";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No data yet", W / 2, H / 2);
    return;
  }

  let minV = Infinity;
  let maxV = -Infinity;
  for (const v of values) {
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  const range = maxV - minV || 1;
  const pad = 4;

  // Grid lines
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad + ((H - 2 * pad) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // Trace
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  for (let i = 0; i < values.length; i++) {
    const x = (i / (values.length - 1)) * W;
    const y = pad + (1 - (values[i] - minV) / range) * (H - 2 * pad);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawTraceOverlay(
  canvas: HTMLCanvasElement | null,
  values: number[],
  color: string,
): void {
  if (!canvas || values.length < 2) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const W = canvas.width;
  const H = canvas.height;
  const pad = 4;

  let minV = Infinity;
  let maxV = -Infinity;
  for (const v of values) {
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  const range = maxV - minV || 1;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  for (let i = 0; i < values.length; i++) {
    const x = (i / (values.length - 1)) * W;
    const y = pad + (1 - (values[i] - minV) / range) * (H - 2 * pad);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// ─────────────────────────────────────────────────────────
// Draw marginal histogram
// ─────────────────────────────────────────────────────────

function drawMarginalPlot(
  canvas: HTMLCanvasElement | null,
  xVals: number[],
  yVals: number[],
): void {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = "#0a0a0f";
  ctx.fillRect(0, 0, W, H);

  if (xVals.length < 2) {
    ctx.fillStyle = "#666";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No data yet", W / 2, H / 2);
    return;
  }

  const halfW = Math.floor(W / 2);
  drawHistogram(ctx, xVals, 0, 0, halfW, H, "#4f8ff7", "x");
  drawHistogram(ctx, yVals, halfW, 0, W - halfW, H, "#34d399", "y");
}

function drawHistogram(
  ctx: CanvasRenderingContext2D,
  values: number[],
  ox: number,
  oy: number,
  w: number,
  h: number,
  color: string,
  label: string,
): void {
  const bins = 30;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const v of values) {
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  if (minV === maxV) {
    maxV = minV + 1;
  }
  const range = maxV - minV;
  const binWidth = range / bins;
  const counts = new Array(bins).fill(0);

  for (const v of values) {
    let bin = Math.floor((v - minV) / binWidth);
    if (bin >= bins) bin = bins - 1;
    if (bin < 0) bin = 0;
    counts[bin]++;
  }

  const maxCount = Math.max(...counts, 1);
  const pad = 12;
  const barW = (w - 2 * pad) / bins;

  ctx.fillStyle = color;
  ctx.globalAlpha = 0.6;
  for (let i = 0; i < bins; i++) {
    const barH = (counts[i] / maxCount) * (h - pad - 4);
    const bx = ox + pad + i * barW;
    const by = oy + h - pad - barH;
    ctx.fillRect(bx, by, barW - 1, barH);
  }
  ctx.globalAlpha = 1;

  // Label
  ctx.fillStyle = "#888";
  ctx.font = "9px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(label, ox + w / 2, oy + 10);
}

// ─────────────────────────────────────────────────────────
// Draw ACF plot
// ─────────────────────────────────────────────────────────

function drawACFPlot(
  canvas: HTMLCanvasElement | null,
  xVals: number[],
  yVals: number[],
): void {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = "#0a0a0f";
  ctx.fillRect(0, 0, W, H);

  if (xVals.length < 4) {
    ctx.fillStyle = "#666";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No data yet", W / 2, H / 2);
    return;
  }

  const maxLag = Math.min(MAX_ACF_LAGS, Math.floor(xVals.length / 2));
  const acfX = computeACF(xVals, maxLag);
  const acfY = computeACF(yVals, maxLag);

  const pad = 8;
  const plotW = W - 2 * pad;
  const plotH = H - 2 * pad;

  // Zero line
  const zeroY = pad + plotH / 2;
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(pad, zeroY);
  ctx.lineTo(pad + plotW, zeroY);
  ctx.stroke();

  // 95% confidence band
  const confBand = 1.96 / Math.sqrt(xVals.length);
  const bandY1 = pad + plotH / 2 - (confBand * plotH) / 2;
  const bandY2 = pad + plotH / 2 + (confBand * plotH) / 2;
  ctx.fillStyle = "rgba(100,100,100,0.15)";
  ctx.fillRect(pad, bandY1, plotW, bandY2 - bandY1);

  // Draw ACF bars for x
  const barW = plotW / maxLag / 2;
  for (let k = 0; k < maxLag; k++) {
    const x = pad + (k / maxLag) * plotW;
    const barH = (acfX[k] * plotH) / 2;
    ctx.fillStyle = "#4f8ff7";
    ctx.globalAlpha = 0.7;
    ctx.fillRect(x, zeroY - barH, barW - 1, barH);
  }

  // Draw ACF bars for y
  for (let k = 0; k < maxLag; k++) {
    const x = pad + (k / maxLag) * plotW + barW;
    const barH = (acfY[k] * plotH) / 2;
    ctx.fillStyle = "#34d399";
    ctx.globalAlpha = 0.7;
    ctx.fillRect(x, zeroY - barH, barW - 1, barH);
  }
  ctx.globalAlpha = 1;

  // Labels
  ctx.fillStyle = "#888";
  ctx.font = "9px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("ACF", pad + 2, pad + 8);
}
