import { useState, useEffect, useRef, useCallback } from "preact/hooks";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

type ProblemType = "tsp" | "function-opt" | "target-string";
type SelectionMethod = "tournament" | "roulette" | "rank";
type CrossoverMethod = "single-point" | "two-point" | "uniform" | "order";
type PlayState = "idle" | "running" | "paused";

interface City {
  x: number;
  y: number;
}

interface GAParams {
  populationSize: number;
  mutationRate: number;
  crossoverRate: number;
  elitismCount: number;
  tournamentSize: number;
  selection: SelectionMethod;
  crossover: CrossoverMethod;
}

interface FitnessRecord {
  generation: number;
  best: number;
  average: number;
  worst: number;
}

interface Individual<T> {
  genes: T;
  fitness: number;
}

type FunctionOptTarget = "rastrigin" | "ackley" | "sphere";

interface GAState {
  generation: number;
  bestFitness: number;
  averageFitness: number;
  worstFitness: number;
  converged: boolean;
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const DEFAULT_PARAMS: GAParams = {
  populationSize: 100,
  mutationRate: 5,
  crossoverRate: 85,
  elitismCount: 2,
  tournamentSize: 5,
  selection: "tournament",
  crossover: "order",
};

const DEFAULT_CITIES: City[] = [
  { x: 100, y: 150 },
  { x: 300, y: 80 },
  { x: 450, y: 200 },
  { x: 350, y: 350 },
  { x: 150, y: 300 },
  { x: 250, y: 250 },
  { x: 400, y: 100 },
  { x: 200, y: 180 },
];

const FUNCTIONS: Record<FunctionOptTarget, {
  name: string;
  fn: (x: number, y: number) => number;
  rangeX: [number, number];
  rangeY: [number, number];
  minimize: boolean;
}> = {
  rastrigin: {
    name: "Rastrigin",
    fn: (x, y) => 20 + x * x - 10 * Math.cos(2 * Math.PI * x) + y * y - 10 * Math.cos(2 * Math.PI * y),
    rangeX: [-5.12, 5.12],
    rangeY: [-5.12, 5.12],
    minimize: true,
  },
  ackley: {
    name: "Ackley",
    fn: (x, y) =>
      -20 * Math.exp(-0.2 * Math.sqrt(0.5 * (x * x + y * y))) -
      Math.exp(0.5 * (Math.cos(2 * Math.PI * x) + Math.cos(2 * Math.PI * y))) +
      Math.E + 20,
    rangeX: [-5, 5],
    rangeY: [-5, 5],
    minimize: true,
  },
  sphere: {
    name: "Sphere",
    fn: (x, y) => x * x + y * y,
    rangeX: [-5, 5],
    rangeY: [-5, 5],
    minimize: true,
  },
};

const CONVERGENCE_WINDOW = 50;
const CONVERGENCE_THRESHOLD = 1e-6;

// ─────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ─────────────────────────────────────────────────────────
// GA Engine: TSP
// ─────────────────────────────────────────────────────────

function tspDistance(route: number[], cities: City[]): number {
  let d = 0;
  for (let i = 0; i < route.length; i++) {
    const a = cities[route[i]];
    const b = cities[route[(i + 1) % route.length]];
    d += Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  }
  return d;
}

function createTSPIndividual(numCities: number): number[] {
  const arr = Array.from({ length: numCities }, (_, i) => i);
  return shuffle(arr);
}

function orderCrossover(p1: number[], p2: number[]): number[] {
  const n = p1.length;
  const start = randomInt(0, n - 2);
  const end = randomInt(start + 1, n - 1);
  const child = new Array(n).fill(-1);
  for (let i = start; i <= end; i++) child[i] = p1[i];
  let pos = (end + 1) % n;
  for (let i = 0; i < n; i++) {
    const gene = p2[(end + 1 + i) % n];
    if (!child.includes(gene)) {
      child[pos] = gene;
      pos = (pos + 1) % n;
    }
  }
  return child;
}

function mutateTSP(route: number[], rate: number): number[] {
  if (Math.random() * 100 > rate) return route;
  const result = [...route];
  const i = randomInt(0, result.length - 1);
  const j = randomInt(0, result.length - 1);
  [result[i], result[j]] = [result[j], result[i]];
  return result;
}

// ─────────────────────────────────────────────────────────
// GA Engine: Function Optimization
// ─────────────────────────────────────────────────────────

function createFuncIndividual(rangeX: [number, number], rangeY: [number, number]): [number, number] {
  return [
    Math.random() * (rangeX[1] - rangeX[0]) + rangeX[0],
    Math.random() * (rangeY[1] - rangeY[0]) + rangeY[0],
  ];
}

function crossoverFunc(
  p1: [number, number],
  p2: [number, number],
  method: CrossoverMethod,
): [number, number] {
  if (method === "uniform") {
    return [
      Math.random() < 0.5 ? p1[0] : p2[0],
      Math.random() < 0.5 ? p1[1] : p2[1],
    ];
  }
  const alpha = Math.random();
  return [
    p1[0] * alpha + p2[0] * (1 - alpha),
    p1[1] * alpha + p2[1] * (1 - alpha),
  ];
}

function mutateFunc(
  ind: [number, number],
  rate: number,
  rangeX: [number, number],
  rangeY: [number, number],
): [number, number] {
  if (Math.random() * 100 > rate) return ind;
  const sigma = 0.3;
  return [
    clamp(ind[0] + (Math.random() - 0.5) * 2 * sigma * (rangeX[1] - rangeX[0]), rangeX[0], rangeX[1]),
    clamp(ind[1] + (Math.random() - 0.5) * 2 * sigma * (rangeY[1] - rangeY[0]), rangeY[0], rangeY[1]),
  ];
}

// ─────────────────────────────────────────────────────────
// GA Engine: Target String
// ─────────────────────────────────────────────────────────

const CHARSET = " ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?.,'";

function createStringIndividual(length: number): string {
  return Array.from({ length }, () => CHARSET[randomInt(0, CHARSET.length - 1)]).join("");
}

function stringFitness(candidate: string, target: string): number {
  let matches = 0;
  for (let i = 0; i < target.length; i++) {
    if (candidate[i] === target[i]) matches++;
  }
  return matches / target.length;
}

function crossoverString(p1: string, p2: string, method: CrossoverMethod): string {
  const n = p1.length;
  if (method === "single-point" || method === "order") {
    const point = randomInt(1, n - 1);
    return p1.slice(0, point) + p2.slice(point);
  }
  if (method === "two-point") {
    const a = randomInt(1, n - 2);
    const b = randomInt(a + 1, n - 1);
    return p1.slice(0, a) + p2.slice(a, b) + p1.slice(b);
  }
  // uniform
  return Array.from({ length: n }, (_, i) =>
    Math.random() < 0.5 ? p1[i] : p2[i],
  ).join("");
}

function mutateString(s: string, rate: number): string {
  return s
    .split("")
    .map((c) =>
      Math.random() * 100 < rate
        ? CHARSET[randomInt(0, CHARSET.length - 1)]
        : c,
    )
    .join("");
}

// ─────────────────────────────────────────────────────────
// GA Engine: Selection
// ─────────────────────────────────────────────────────────

function selectParent<T>(
  pop: Individual<T>[],
  method: SelectionMethod,
  tournamentSize: number,
): Individual<T> {
  if (method === "tournament") {
    let best: Individual<T> | null = null;
    for (let i = 0; i < tournamentSize; i++) {
      const candidate = pop[randomInt(0, pop.length - 1)];
      if (!best || candidate.fitness > best.fitness) best = candidate;
    }
    return best!;
  }
  if (method === "roulette") {
    const minFit = Math.min(...pop.map((p) => p.fitness));
    const shifted = pop.map((p) => ({ ...p, fitness: p.fitness - minFit + 1e-6 }));
    const total = shifted.reduce((sum, p) => sum + p.fitness, 0);
    let r = Math.random() * total;
    for (const ind of shifted) {
      r -= ind.fitness;
      if (r <= 0) return pop[shifted.indexOf(ind)];
    }
    return pop[pop.length - 1];
  }
  // rank
  const sorted = [...pop].sort((a, b) => a.fitness - b.fitness);
  const totalRank = (pop.length * (pop.length + 1)) / 2;
  let r = Math.random() * totalRank;
  for (let i = 0; i < sorted.length; i++) {
    r -= i + 1;
    if (r <= 0) return sorted[i];
  }
  return sorted[sorted.length - 1];
}

// ─────────────────────────────────────────────────────────
// Rendering Helpers
// ─────────────────────────────────────────────────────────

function getComputedColor(varName: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const val = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  return val || fallback;
}

function drawTSPCanvas(
  ctx: CanvasRenderingContext2D,
  cities: City[],
  bestRoute: number[] | null,
  w: number,
  h: number,
): void {
  const bg = getComputedColor("--color-surface", "#111111");
  const border = getComputedColor("--color-border", "#27272a");
  const primary = getComputedColor("--color-primary", "#4f8ff7");
  const accent = getComputedColor("--color-accent", "#34d399");
  const text = getComputedColor("--color-text", "#e4e4e7");

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Border
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, w, h);

  // Draw route
  if (bestRoute && bestRoute.length > 1) {
    ctx.strokeStyle = primary;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const first = cities[bestRoute[0]];
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < bestRoute.length; i++) {
      const c = cities[bestRoute[i]];
      ctx.lineTo(c.x, c.y);
    }
    ctx.lineTo(first.x, first.y);
    ctx.stroke();
  }

  // Draw cities
  for (let i = 0; i < cities.length; i++) {
    const c = cities[i];
    ctx.beginPath();
    ctx.arc(c.x, c.y, 6, 0, 2 * Math.PI);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.strokeStyle = bg;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = text;
    ctx.font = "11px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(i), c.x, c.y - 10);
  }
}

function drawFuncCanvas(
  ctx: CanvasRenderingContext2D,
  fnDef: typeof FUNCTIONS[FunctionOptTarget],
  population: Individual<[number, number]>[],
  bestInd: Individual<[number, number]> | null,
  w: number,
  h: number,
): void {
  // Draw heatmap
  const imgData = ctx.createImageData(w, h);
  const [xMin, xMax] = fnDef.rangeX;
  const [yMin, yMax] = fnDef.rangeY;

  // Pre-compute function values to find range for color mapping
  let fMin = Infinity;
  let fMax = -Infinity;
  const step = 4;
  const vals: number[] = [];
  for (let py = 0; py < h; py += step) {
    for (let px = 0; px < w; px += step) {
      const x = xMin + (px / w) * (xMax - xMin);
      const y = yMin + (py / h) * (yMax - yMin);
      const v = fnDef.fn(x, y);
      vals.push(v);
      if (v < fMin) fMin = v;
      if (v > fMax) fMax = v;
    }
  }

  const range = fMax - fMin || 1;
  let idx = 0;
  for (let py = 0; py < h; py += step) {
    for (let px = 0; px < w; px += step) {
      const t = (vals[idx++] - fMin) / range;
      // Viridis-inspired colors
      const r = Math.floor(68 + t * 120);
      const g = Math.floor(1 + (1 - Math.abs(t - 0.5) * 2) * 200);
      const b = Math.floor(84 + (1 - t) * 150);
      for (let dy = 0; dy < step && py + dy < h; dy++) {
        for (let dx = 0; dx < step && px + dx < w; dx++) {
          const offset = ((py + dy) * w + (px + dx)) * 4;
          imgData.data[offset] = r;
          imgData.data[offset + 1] = g;
          imgData.data[offset + 2] = b;
          imgData.data[offset + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // Draw population dots
  for (const ind of population) {
    const px = ((ind.genes[0] - xMin) / (xMax - xMin)) * w;
    const py = ((ind.genes[1] - yMin) / (yMax - yMin)) * h;
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, 2 * Math.PI);
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.fill();
  }

  // Highlight best
  if (bestInd) {
    const px = ((bestInd.genes[0] - xMin) / (xMax - xMin)) * w;
    const py = ((bestInd.genes[1] - yMin) / (yMax - yMin)) * h;
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, 2 * Math.PI);
    ctx.strokeStyle = "#ff4444";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, 2 * Math.PI);
    ctx.fillStyle = "#ff4444";
    ctx.fill();
  }
}

function drawFitnessChart(
  ctx: CanvasRenderingContext2D,
  history: FitnessRecord[],
  w: number,
  h: number,
): void {
  const bg = getComputedColor("--color-surface", "#111111");
  const border = getComputedColor("--color-border", "#27272a");
  const textMuted = getComputedColor("--color-text-muted", "#a1a1aa");

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, w, h);

  if (history.length < 2) {
    ctx.fillStyle = textMuted;
    ctx.font = "12px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Fitness chart will appear here", w / 2, h / 2);
    return;
  }

  const pad = { top: 20, right: 15, bottom: 30, left: 50 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const allVals = history.flatMap((r) => [r.best, r.average, r.worst]);
  let yMin = Math.min(...allVals);
  let yMax = Math.max(...allVals);
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const xMin = history[0].generation;
  const xMax = history[history.length - 1].generation;
  const xRange = xMax - xMin || 1;

  const toX = (gen: number) => pad.left + ((gen - xMin) / xRange) * plotW;
  const toY = (val: number) => pad.top + plotH - ((val - yMin) / (yMax - yMin)) * plotH;

  // Grid lines
  ctx.strokeStyle = border;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
  }

  // Axis labels
  ctx.fillStyle = textMuted;
  ctx.font = "10px Inter, system-ui, sans-serif";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const val = yMax - ((yMax - yMin) / 4) * i;
    const y = pad.top + (plotH / 4) * i;
    ctx.fillText(val.toFixed(val > 100 ? 0 : 2), pad.left - 5, y + 3);
  }
  ctx.textAlign = "center";
  ctx.fillText("Generation", w / 2, h - 5);
  ctx.fillText(String(xMin), pad.left, h - 15);
  ctx.fillText(String(xMax), w - pad.right, h - 15);

  // Draw lines
  const drawLine = (key: "best" | "average" | "worst", color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = 0; i < history.length; i++) {
      const x = toX(history[i].generation);
      const y = toY(history[i][key]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };

  drawLine("worst", "#ef4444", 1);
  drawLine("average", "#f59e0b", 1.5);
  drawLine("best", "#34d399", 2);

  // Legend
  const legendX = pad.left + 10;
  const legendY = pad.top + 10;
  const items: [string, string][] = [
    ["Best", "#34d399"],
    ["Average", "#f59e0b"],
    ["Worst", "#ef4444"],
  ];
  ctx.font = "10px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  items.forEach(([label, color], i) => {
    const lx = legendX + i * 70;
    ctx.fillStyle = color;
    ctx.fillRect(lx, legendY - 4, 12, 3);
    ctx.fillStyle = textMuted;
    ctx.fillText(label, lx + 16, legendY);
  });
}

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

export default function GeneticAlgorithm() {
  // Problem state
  const [problem, setProblem] = useState<ProblemType>("tsp");
  const [params, setParams] = useState<GAParams>(DEFAULT_PARAMS);
  const [playState, setPlayState] = useState<PlayState>("idle");
  const [speed, setSpeed] = useState(50);
  const [gaState, setGAState] = useState<GAState>({
    generation: 0,
    bestFitness: 0,
    averageFitness: 0,
    worstFitness: 0,
    converged: false,
  });
  const [fitnessHistory, setFitnessHistory] = useState<FitnessRecord[]>([]);

  // TSP state
  const [cities, setCities] = useState<City[]>(DEFAULT_CITIES);
  const [bestRoute, setBestRoute] = useState<number[] | null>(null);
  const tspPopRef = useRef<Individual<number[]>[]>([]);

  // Function optimization state
  const [funcTarget, setFuncTarget] = useState<FunctionOptTarget>("rastrigin");
  const funcPopRef = useRef<Individual<[number, number]>[]>([]);
  const funcBestRef = useRef<Individual<[number, number]> | null>(null);

  // Target string state
  const [targetString, setTargetString] = useState("Hello, World!");
  const stringPopRef = useRef<Individual<string>[]>([]);
  const [displayPop, setDisplayPop] = useState<Individual<string>[]>([]);
  const [bestString, setBestString] = useState("");

  // Refs for animation
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const chartCanvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const playStateRef = useRef<PlayState>("idle");
  const paramsRef = useRef<GAParams>(DEFAULT_PARAMS);
  const fitnessHistoryRef = useRef<FitnessRecord[]>([]);
  const generationRef = useRef(0);
  const lastBestsRef = useRef<number[]>([]);

  // Keep refs in sync
  useEffect(() => { playStateRef.current = playState; }, [playState]);
  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { fitnessHistoryRef.current = fitnessHistory; }, [fitnessHistory]);

  // ───────── Initialize population ─────────
  const initPopulation = useCallback(() => {
    const p = paramsRef.current;
    generationRef.current = 0;
    lastBestsRef.current = [];
    setFitnessHistory([]);
    fitnessHistoryRef.current = [];
    setGAState({
      generation: 0,
      bestFitness: 0,
      averageFitness: 0,
      worstFitness: 0,
      converged: false,
    });

    if (problem === "tsp") {
      const pop: Individual<number[]>[] = [];
      for (let i = 0; i < p.populationSize; i++) {
        const genes = createTSPIndividual(cities.length);
        const fitness = 1 / tspDistance(genes, cities);
        pop.push({ genes, fitness });
      }
      pop.sort((a, b) => b.fitness - a.fitness);
      tspPopRef.current = pop;
      setBestRoute(pop[0].genes);
    } else if (problem === "function-opt") {
      const fnDef = FUNCTIONS[funcTarget];
      const pop: Individual<[number, number]>[] = [];
      for (let i = 0; i < p.populationSize; i++) {
        const genes = createFuncIndividual(fnDef.rangeX, fnDef.rangeY);
        const raw = fnDef.fn(genes[0], genes[1]);
        const fitness = fnDef.minimize ? -raw : raw;
        pop.push({ genes, fitness });
      }
      pop.sort((a, b) => b.fitness - a.fitness);
      funcPopRef.current = pop;
      funcBestRef.current = pop[0];
    } else {
      const pop: Individual<string>[] = [];
      for (let i = 0; i < p.populationSize; i++) {
        const genes = createStringIndividual(targetString.length);
        const fitness = stringFitness(genes, targetString);
        pop.push({ genes, fitness });
      }
      pop.sort((a, b) => b.fitness - a.fitness);
      stringPopRef.current = pop;
      setDisplayPop(pop.slice(0, 20));
      setBestString(pop[0].genes);
    }
  }, [problem, cities, funcTarget, targetString]);

  // ───────── Run one generation ─────────
  const runGeneration = useCallback(() => {
    const p = paramsRef.current;
    generationRef.current++;

    if (problem === "tsp") {
      const pop = tspPopRef.current;
      if (pop.length === 0 || cities.length < 3) return;
      const newPop: Individual<number[]>[] = [];
      pop.sort((a, b) => b.fitness - a.fitness);
      // Elitism
      for (let i = 0; i < Math.min(p.elitismCount, pop.length); i++) {
        newPop.push({ ...pop[i] });
      }
      while (newPop.length < p.populationSize) {
        const p1 = selectParent(pop, p.selection, p.tournamentSize);
        const p2 = selectParent(pop, p.selection, p.tournamentSize);
        let childGenes: number[];
        if (Math.random() * 100 < p.crossoverRate) {
          childGenes = orderCrossover(p1.genes, p2.genes);
        } else {
          childGenes = [...p1.genes];
        }
        childGenes = mutateTSP(childGenes, p.mutationRate);
        const fitness = 1 / tspDistance(childGenes, cities);
        newPop.push({ genes: childGenes, fitness });
      }
      newPop.sort((a, b) => b.fitness - a.fitness);
      tspPopRef.current = newPop;
      setBestRoute(newPop[0].genes);

      const bestF = 1 / newPop[0].fitness;
      const avgF = newPop.reduce((s, i) => s + 1 / i.fitness, 0) / newPop.length;
      const worstF = 1 / newPop[newPop.length - 1].fitness;
      const rec: FitnessRecord = {
        generation: generationRef.current,
        best: bestF,
        average: avgF,
        worst: worstF,
      };
      const newHistory = [...fitnessHistoryRef.current, rec];
      fitnessHistoryRef.current = newHistory;
      setFitnessHistory(newHistory);

      lastBestsRef.current.push(bestF);
      if (lastBestsRef.current.length > CONVERGENCE_WINDOW) lastBestsRef.current.shift();
      const converged =
        lastBestsRef.current.length >= CONVERGENCE_WINDOW &&
        Math.abs(lastBestsRef.current[0] - lastBestsRef.current[lastBestsRef.current.length - 1]) <
          CONVERGENCE_THRESHOLD;

      setGAState({
        generation: generationRef.current,
        bestFitness: bestF,
        averageFitness: avgF,
        worstFitness: worstF,
        converged,
      });
    } else if (problem === "function-opt") {
      const fnDef = FUNCTIONS[funcTarget];
      const pop = funcPopRef.current;
      if (pop.length === 0) return;
      const newPop: Individual<[number, number]>[] = [];
      pop.sort((a, b) => b.fitness - a.fitness);
      for (let i = 0; i < Math.min(p.elitismCount, pop.length); i++) {
        newPop.push({ ...pop[i] });
      }
      const xoverMethod = p.crossover === "order" ? "uniform" : p.crossover;
      while (newPop.length < p.populationSize) {
        const p1 = selectParent(pop, p.selection, p.tournamentSize);
        const p2 = selectParent(pop, p.selection, p.tournamentSize);
        let childGenes: [number, number];
        if (Math.random() * 100 < p.crossoverRate) {
          childGenes = crossoverFunc(p1.genes, p2.genes, xoverMethod);
        } else {
          childGenes = [...p1.genes] as [number, number];
        }
        childGenes = mutateFunc(childGenes, p.mutationRate, fnDef.rangeX, fnDef.rangeY);
        const raw = fnDef.fn(childGenes[0], childGenes[1]);
        const fitness = fnDef.minimize ? -raw : raw;
        newPop.push({ genes: childGenes, fitness });
      }
      newPop.sort((a, b) => b.fitness - a.fitness);
      funcPopRef.current = newPop;
      funcBestRef.current = newPop[0];

      const bestRaw = fnDef.minimize ? -newPop[0].fitness : newPop[0].fitness;
      const avgRaw =
        newPop.reduce(
          (s, i) => s + (fnDef.minimize ? -i.fitness : i.fitness),
          0,
        ) / newPop.length;
      const worstRaw = fnDef.minimize
        ? -newPop[newPop.length - 1].fitness
        : newPop[newPop.length - 1].fitness;

      const rec: FitnessRecord = {
        generation: generationRef.current,
        best: bestRaw,
        average: avgRaw,
        worst: worstRaw,
      };
      const newHistory = [...fitnessHistoryRef.current, rec];
      fitnessHistoryRef.current = newHistory;
      setFitnessHistory(newHistory);

      lastBestsRef.current.push(bestRaw);
      if (lastBestsRef.current.length > CONVERGENCE_WINDOW) lastBestsRef.current.shift();
      const converged =
        lastBestsRef.current.length >= CONVERGENCE_WINDOW &&
        Math.abs(lastBestsRef.current[0] - lastBestsRef.current[lastBestsRef.current.length - 1]) <
          CONVERGENCE_THRESHOLD;

      setGAState({
        generation: generationRef.current,
        bestFitness: bestRaw,
        averageFitness: avgRaw,
        worstFitness: worstRaw,
        converged,
      });
    } else {
      const pop = stringPopRef.current;
      if (pop.length === 0) return;
      const newPop: Individual<string>[] = [];
      pop.sort((a, b) => b.fitness - a.fitness);
      for (let i = 0; i < Math.min(p.elitismCount, pop.length); i++) {
        newPop.push({ ...pop[i] });
      }
      const xoverMethod = p.crossover === "order" ? "single-point" : p.crossover;
      while (newPop.length < p.populationSize) {
        const p1 = selectParent(pop, p.selection, p.tournamentSize);
        const p2 = selectParent(pop, p.selection, p.tournamentSize);
        let childGenes: string;
        if (Math.random() * 100 < p.crossoverRate) {
          childGenes = crossoverString(p1.genes, p2.genes, xoverMethod);
        } else {
          childGenes = p1.genes;
        }
        childGenes = mutateString(childGenes, p.mutationRate);
        const fitness = stringFitness(childGenes, targetString);
        newPop.push({ genes: childGenes, fitness });
      }
      newPop.sort((a, b) => b.fitness - a.fitness);
      stringPopRef.current = newPop;
      setDisplayPop(newPop.slice(0, 20));
      setBestString(newPop[0].genes);

      const bestF = newPop[0].fitness;
      const avgF = newPop.reduce((s, i) => s + i.fitness, 0) / newPop.length;
      const worstF = newPop[newPop.length - 1].fitness;

      const rec: FitnessRecord = {
        generation: generationRef.current,
        best: bestF,
        average: avgF,
        worst: worstF,
      };
      const newHistory = [...fitnessHistoryRef.current, rec];
      fitnessHistoryRef.current = newHistory;
      setFitnessHistory(newHistory);

      const converged = bestF >= 1.0;

      setGAState({
        generation: generationRef.current,
        bestFitness: bestF,
        averageFitness: avgF,
        worstFitness: worstF,
        converged,
      });

      if (converged) {
        setPlayState("paused");
      }
    }
  }, [problem, cities, funcTarget, targetString]);

  // ───────── Animation loop ─────────
  useEffect(() => {
    if (playState !== "running") return;
    let cancelled = false;
    let lastTime = 0;
    const interval = Math.max(5, 200 - speed * 1.9);

    const tick = (time: number) => {
      if (cancelled || playStateRef.current !== "running") return;
      if (time - lastTime >= interval) {
        runGeneration();
        lastTime = time;
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [playState, speed, runGeneration]);

  // ───────── Draw main canvas ─────────
  useEffect(() => {
    const canvas = mainCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width;
    const h = rect.height;

    if (problem === "tsp") {
      drawTSPCanvas(ctx, cities, bestRoute, w, h);
    } else if (problem === "function-opt") {
      drawFuncCanvas(ctx, FUNCTIONS[funcTarget], funcPopRef.current, funcBestRef.current, w, h);
    }
  }, [problem, cities, bestRoute, funcTarget, gaState.generation]);

  // ───────── Draw fitness chart ─────────
  useEffect(() => {
    const canvas = chartCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    drawFitnessChart(ctx, fitnessHistory, rect.width, rect.height);
  }, [fitnessHistory]);

  // ───────── Init on problem/params change ─────────
  useEffect(() => {
    initPopulation();
    setPlayState("idle");
  }, [problem, cities.length, funcTarget, targetString]);

  // ───────── TSP canvas click to add city ─────────
  const handleCanvasClick = useCallback(
    (e: MouseEvent) => {
      if (problem !== "tsp") return;
      const canvas = mainCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Check if clicking near existing city to remove
      const threshold = 15;
      const nearIdx = cities.findIndex(
        (c) => Math.sqrt((c.x - x) ** 2 + (c.y - y) ** 2) < threshold,
      );
      if (nearIdx >= 0 && cities.length > 3) {
        setCities((prev) => prev.filter((_, i) => i !== nearIdx));
      } else if (nearIdx < 0) {
        setCities((prev) => [...prev, { x, y }]);
      }
      setPlayState("idle");
    },
    [problem, cities],
  );

  // ───────── Controls ─────────
  const handleStart = useCallback(() => {
    if (playState === "idle") {
      initPopulation();
    }
    setPlayState("running");
  }, [playState, initPopulation]);

  const handlePause = useCallback(() => {
    setPlayState("paused");
  }, []);

  const handleStep = useCallback(() => {
    if (playState === "idle") {
      initPopulation();
    }
    setPlayState("paused");
    runGeneration();
  }, [playState, initPopulation, runGeneration]);

  const handleReset = useCallback(() => {
    setPlayState("idle");
    initPopulation();
  }, [initPopulation]);

  const updateParam = useCallback(
    <K extends keyof GAParams>(key: K, value: GAParams[K]) => {
      setParams((prev) => {
        const next = { ...prev, [key]: value };
        paramsRef.current = next;
        return next;
      });
    },
    [],
  );

  // ───────── Formatting helpers ─────────
  const formatFitness = (val: number): string => {
    if (problem === "tsp") return val.toFixed(1);
    if (problem === "function-opt") return val.toFixed(4);
    return (val * 100).toFixed(1) + "%";
  };

  // ───────── Problem selector styles ─────────
  const tabClass = (active: boolean) =>
    `px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
      active
        ? "bg-[var(--color-primary)] text-white"
        : "bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
    }`;

  return (
    <div class="space-y-4">
      {/* Problem tabs */}
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs font-medium text-[var(--color-text-muted)] mr-2">Problem:</span>
        <button class={tabClass(problem === "tsp")} onClick={() => setProblem("tsp")}>
          TSP
        </button>
        <button class={tabClass(problem === "function-opt")} onClick={() => setProblem("function-opt")}>
          Function Opt
        </button>
        <button class={tabClass(problem === "target-string")} onClick={() => setProblem("target-string")}>
          Target String
        </button>
      </div>

      {/* Problem-specific options */}
      {problem === "function-opt" && (
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs text-[var(--color-text-muted)]">Function:</span>
          {(Object.keys(FUNCTIONS) as FunctionOptTarget[]).map((key) => (
            <button
              key={key}
              class={tabClass(funcTarget === key)}
              onClick={() => setFuncTarget(key)}
            >
              {FUNCTIONS[key].name}
            </button>
          ))}
        </div>
      )}

      {problem === "target-string" && (
        <div class="flex items-center gap-2">
          <label class="text-xs text-[var(--color-text-muted)]">Target:</label>
          <input
            type="text"
            value={targetString}
            maxLength={40}
            onInput={(e) => setTargetString((e.target as HTMLInputElement).value || "Hello")}
            class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)] w-52"
          />
        </div>
      )}

      {/* Main visualization area */}
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Canvas / String display */}
        <div class="lg:col-span-2">
          {problem === "target-string" ? (
            <div
              class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 overflow-auto"
              style={{ height: "380px" }}
            >
              <div class="mb-3">
                <span class="text-xs text-[var(--color-text-muted)]">Target: </span>
                <span class="font-mono text-sm text-[var(--color-accent)]">{targetString}</span>
              </div>
              <div class="mb-3">
                <span class="text-xs text-[var(--color-text-muted)]">Best: </span>
                <span class="font-mono text-sm text-[var(--color-heading)]">
                  {bestString.split("").map((char, i) => (
                    <span
                      key={i}
                      style={{
                        color:
                          char === targetString[i]
                            ? "var(--color-accent)"
                            : "var(--color-text-muted)",
                      }}
                    >
                      {char}
                    </span>
                  ))}
                </span>
              </div>
              <div class="border-t border-[var(--color-border)] pt-2 mt-2">
                <span class="text-xs text-[var(--color-text-muted)] block mb-2">
                  Population (top 20):
                </span>
                <div class="space-y-0.5 font-mono text-xs leading-5">
                  {displayPop.map((ind, idx) => (
                    <div key={idx} class="flex items-center gap-2">
                      <span class="text-[var(--color-text-muted)] w-8 text-right shrink-0">
                        {(ind.fitness * 100).toFixed(0)}%
                      </span>
                      <span>
                        {ind.genes.split("").map((char, i) => (
                          <span
                            key={i}
                            style={{
                              color:
                                char === targetString[i]
                                  ? "var(--color-accent)"
                                  : "var(--color-text-muted)",
                              opacity: char === targetString[i] ? 1 : 0.5,
                            }}
                          >
                            {char}
                          </span>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div class="relative">
              <canvas
                ref={mainCanvasRef}
                onClick={handleCanvasClick}
                class="w-full rounded-lg border border-[var(--color-border)]"
                style={{ height: "380px", cursor: problem === "tsp" ? "crosshair" : "default" }}
              />
              {problem === "tsp" && (
                <div class="absolute bottom-2 left-2 rounded bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text-muted)]" style={{ opacity: 0.85 }}>
                  Click to add cities, click near a city to remove it
                </div>
              )}
            </div>
          )}
        </div>

        {/* Parameters panel */}
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3 text-xs">
          <h3 class="text-sm font-semibold text-[var(--color-heading)]">GA Parameters</h3>

          <ParamSlider
            label="Population"
            value={params.populationSize}
            min={20}
            max={500}
            step={10}
            onChange={(v) => updateParam("populationSize", v)}
          />
          <ParamSlider
            label="Mutation Rate"
            value={params.mutationRate}
            min={0}
            max={100}
            step={1}
            suffix="%"
            onChange={(v) => updateParam("mutationRate", v)}
          />
          <ParamSlider
            label="Crossover Rate"
            value={params.crossoverRate}
            min={0}
            max={100}
            step={5}
            suffix="%"
            onChange={(v) => updateParam("crossoverRate", v)}
          />
          <ParamSlider
            label="Elitism"
            value={params.elitismCount}
            min={0}
            max={20}
            step={1}
            onChange={(v) => updateParam("elitismCount", v)}
          />
          <ParamSlider
            label="Tournament Size"
            value={params.tournamentSize}
            min={2}
            max={20}
            step={1}
            onChange={(v) => updateParam("tournamentSize", v)}
          />

          <div>
            <label class="block text-[var(--color-text-muted)] mb-1">Selection</label>
            <select
              value={params.selection}
              onChange={(e) => updateParam("selection", (e.target as HTMLSelectElement).value as SelectionMethod)}
              class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-text)]"
            >
              <option value="tournament">Tournament</option>
              <option value="roulette">Roulette Wheel</option>
              <option value="rank">Rank-based</option>
            </select>
          </div>

          <div>
            <label class="block text-[var(--color-text-muted)] mb-1">Crossover</label>
            <select
              value={params.crossover}
              onChange={(e) => updateParam("crossover", (e.target as HTMLSelectElement).value as CrossoverMethod)}
              class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-text)]"
            >
              {problem === "tsp" ? (
                <option value="order">Order (OX)</option>
              ) : (
                <>
                  <option value="single-point">Single-point</option>
                  <option value="two-point">Two-point</option>
                  <option value="uniform">Uniform</option>
                </>
              )}
            </select>
          </div>

          {/* Stats */}
          <div class="border-t border-[var(--color-border)] pt-3 space-y-1.5">
            <h3 class="text-sm font-semibold text-[var(--color-heading)]">Statistics</h3>
            <StatRow label="Generation" value={String(gaState.generation)} />
            <StatRow label="Best Fitness" value={formatFitness(gaState.bestFitness)} highlight />
            <StatRow label="Avg Fitness" value={formatFitness(gaState.averageFitness)} />
            <StatRow label="Worst Fitness" value={formatFitness(gaState.worstFitness)} />
            {problem === "tsp" && (
              <StatRow label="Cities" value={String(cities.length)} />
            )}
            {problem === "function-opt" && funcBestRef.current && (
              <>
                <StatRow
                  label="Best X"
                  value={funcBestRef.current.genes[0].toFixed(4)}
                />
                <StatRow
                  label="Best Y"
                  value={funcBestRef.current.genes[1].toFixed(4)}
                />
              </>
            )}
            {gaState.converged && (
              <div class="mt-2 rounded bg-[var(--color-accent)] bg-opacity-10 px-2 py-1 text-center text-xs font-medium" style={{ color: "var(--color-accent)" }}>
                Converged!
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Controls row */}
      <div class="flex flex-wrap items-center gap-3">
        {playState === "running" ? (
          <button
            onClick={handlePause}
            class="rounded-md bg-[var(--color-primary)] px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            Pause
          </button>
        ) : (
          <button
            onClick={handleStart}
            class="rounded-md bg-[var(--color-primary)] px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            {playState === "paused" ? "Resume" : "Start"}
          </button>
        )}
        <button
          onClick={handleStep}
          class="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)]"
        >
          Step
        </button>
        <button
          onClick={handleReset}
          class="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)]"
        >
          Reset
        </button>
        <div class="flex items-center gap-2 ml-auto">
          <span class="text-xs text-[var(--color-text-muted)]">Speed:</span>
          <input
            type="range"
            min={1}
            max={100}
            value={speed}
            onInput={(e) => setSpeed(Number((e.target as HTMLInputElement).value))}
            class="w-24 accent-[var(--color-primary)]"
          />
          <span class="text-xs text-[var(--color-text-muted)] w-8">{speed}%</span>
        </div>
      </div>

      {/* Fitness chart */}
      <div>
        <h3 class="mb-2 text-sm font-semibold text-[var(--color-heading)]">Fitness Over Generations</h3>
        <canvas
          ref={chartCanvasRef}
          class="w-full rounded-lg border border-[var(--color-border)]"
          style={{ height: "200px" }}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────

function ParamSlider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div class="flex justify-between text-[var(--color-text-muted)] mb-1">
        <span>{label}</span>
        <span class="text-[var(--color-text)]">
          {value}
          {suffix || ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
        class="w-full accent-[var(--color-primary)]"
      />
    </div>
  );
}

function StatRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div class="flex justify-between">
      <span class="text-[var(--color-text-muted)]">{label}</span>
      <span
        class="font-mono"
        style={{
          color: highlight ? "var(--color-accent)" : "var(--color-text)",
        }}
      >
        {value}
      </span>
    </div>
  );
}
