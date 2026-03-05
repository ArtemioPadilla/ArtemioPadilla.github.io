import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ──────────────────────────────────────
   Types
   ────────────────────────────────────── */

interface MarkovState {
  id: number;
  label: string;
  x: number;
  y: number;
}

interface Transition {
  from: number;
  to: number;
  probability: number;
}

interface ChainData {
  states: MarkovState[];
  transitions: Transition[];
}

interface SimulationState {
  currentStateId: number;
  step: number;
  visitCounts: number[];
  distributionHistory: number[][];
  convergenceHistory: number[];
}

interface DragInfo {
  type: "state" | "transition-start";
  stateId: number;
  offsetX: number;
  offsetY: number;
}

type ViewMode = "diagram" | "text-gen";

interface TextGenState {
  sourceText: string;
  level: "char" | "word";
  generatedText: string;
  chain: Map<string, Map<string, number>>;
}

/* ──────────────────────────────────────
   Constants
   ────────────────────────────────────── */

const STATE_RADIUS = 30;
const ARROW_HEAD_SIZE = 10;
const SELF_LOOP_RADIUS = 22;
const MIN_PROB = 0.01;

const STATE_COLORS = [
  "#4f8ff7", "#34d399", "#f59e0b", "#ef4444",
  "#a855f7", "#ec4899", "#14b8a6", "#f97316",
];

const PRESETS: Record<string, ChainData> = {
  weather: {
    states: [
      { id: 0, label: "Sunny", x: 180, y: 180 },
      { id: 1, label: "Rainy", x: 420, y: 180 },
    ],
    transitions: [
      { from: 0, to: 0, probability: 0.7 },
      { from: 0, to: 1, probability: 0.3 },
      { from: 1, to: 0, probability: 0.4 },
      { from: 1, to: 1, probability: 0.6 },
    ],
  },
  randomWalk: {
    states: [
      { id: 0, label: "S0", x: 80, y: 200 },
      { id: 1, label: "S1", x: 200, y: 200 },
      { id: 2, label: "S2", x: 320, y: 200 },
      { id: 3, label: "S3", x: 440, y: 200 },
      { id: 4, label: "S4", x: 560, y: 200 },
    ],
    transitions: [
      { from: 0, to: 0, probability: 0.5 },
      { from: 0, to: 1, probability: 0.5 },
      { from: 1, to: 0, probability: 0.5 },
      { from: 1, to: 2, probability: 0.5 },
      { from: 2, to: 1, probability: 0.5 },
      { from: 2, to: 3, probability: 0.5 },
      { from: 3, to: 2, probability: 0.5 },
      { from: 3, to: 4, probability: 0.5 },
      { from: 4, to: 3, probability: 0.5 },
      { from: 4, to: 4, probability: 0.5 },
    ],
  },
  gamblersRuin: {
    states: [
      { id: 0, label: "Broke", x: 80, y: 200 },
      { id: 1, label: "$1", x: 220, y: 200 },
      { id: 2, label: "$2", x: 360, y: 200 },
      { id: 3, label: "Rich", x: 500, y: 200 },
    ],
    transitions: [
      { from: 0, to: 0, probability: 1.0 },
      { from: 1, to: 0, probability: 0.4 },
      { from: 1, to: 2, probability: 0.6 },
      { from: 2, to: 1, probability: 0.4 },
      { from: 2, to: 3, probability: 0.6 },
      { from: 3, to: 3, probability: 1.0 },
    ],
  },
  pageRank: {
    states: [
      { id: 0, label: "A", x: 150, y: 100 },
      { id: 1, label: "B", x: 450, y: 100 },
      { id: 2, label: "C", x: 450, y: 300 },
      { id: 3, label: "D", x: 150, y: 300 },
    ],
    transitions: [
      { from: 0, to: 1, probability: 0.5 },
      { from: 0, to: 3, probability: 0.5 },
      { from: 1, to: 0, probability: 0.33 },
      { from: 1, to: 2, probability: 0.34 },
      { from: 1, to: 3, probability: 0.33 },
      { from: 2, to: 0, probability: 0.5 },
      { from: 2, to: 1, probability: 0.5 },
      { from: 3, to: 2, probability: 1.0 },
    ],
  },
  ehrenfest: {
    states: [
      { id: 0, label: "0", x: 100, y: 200 },
      { id: 1, label: "1", x: 250, y: 120 },
      { id: 2, label: "2", x: 400, y: 120 },
      { id: 3, label: "3", x: 550, y: 200 },
    ],
    transitions: [
      { from: 0, to: 1, probability: 1.0 },
      { from: 1, to: 0, probability: 0.33 },
      { from: 1, to: 2, probability: 0.67 },
      { from: 2, to: 1, probability: 0.67 },
      { from: 2, to: 3, probability: 0.33 },
      { from: 3, to: 2, probability: 1.0 },
    ],
  },
};

const TEXT_PRESETS: Record<string, string> = {
  shakespeare:
    "To be or not to be that is the question whether tis nobler in the mind to suffer the slings and arrows of outrageous fortune or to take arms against a sea of troubles and by opposing end them to die to sleep no more and by a sleep to say we end the heartache and the thousand natural shocks that flesh is heir to tis a consummation devoutly to be wished to die to sleep to sleep perchance to dream ay there is the rub for in that sleep of death what dreams may come when we have shuffled off this mortal coil must give us pause",
  loremIpsum:
    "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum",
  pythonCode:
    "def hello world print hello for i in range 10 print i if i > 5 return i else continue def main x = hello y = world for item in x print item return y class Foo def init self self x = 0 def run self return self x",
};

/* ──────────────────────────────────────
   Pure math functions
   ────────────────────────────────────── */

function buildTransitionMatrix(states: MarkovState[], transitions: Transition[]): number[][] {
  const n = states.length;
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (const t of transitions) {
    matrix[t.from][t.to] = t.probability;
  }
  return matrix;
}

function normalizeRow(row: number[]): number[] {
  const sum = row.reduce((a, b) => a + b, 0);
  if (sum === 0) return row;
  return row.map((v) => v / sum);
}

function matVecMul(matrix: number[][], vec: number[]): number[] {
  const n = matrix.length;
  const result = Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      result[j] += vec[i] * matrix[i][j];
    }
  }
  return result;
}

function powerIteration(matrix: number[][], maxIter: number = 1000, tol: number = 1e-10): number[] {
  const n = matrix.length;
  if (n === 0) return [];
  let pi = Array(n).fill(1 / n);
  for (let iter = 0; iter < maxIter; iter++) {
    const next = matVecMul(matrix, pi);
    const sum = next.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      for (let i = 0; i < n; i++) next[i] /= sum;
    }
    let diff = 0;
    for (let i = 0; i < n; i++) diff += Math.abs(next[i] - pi[i]);
    pi = next;
    if (diff < tol) break;
  }
  return pi;
}

function l1Distance(a: number[], b: number[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - (b[i] || 0));
  return d;
}

function sampleFromDistribution(probs: number[]): number {
  const r = Math.random();
  let cumulative = 0;
  for (let i = 0; i < probs.length; i++) {
    cumulative += probs[i];
    if (r <= cumulative) return i;
  }
  return probs.length - 1;
}

function detectAbsorbingStates(matrix: number[][]): number[] {
  const absorbing: number[] = [];
  for (let i = 0; i < matrix.length; i++) {
    if (matrix[i][i] === 1) absorbing.push(i);
  }
  return absorbing;
}

function computePeriod(matrix: number[][]): number {
  const n = matrix.length;
  if (n === 0) return 0;

  function gcd(a: number, b: number): number {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) { [a, b] = [b, a % b]; }
    return a;
  }

  let overallPeriod = 0;
  for (let start = 0; start < n; start++) {
    const returnTimes: number[] = [];
    const visited = Array(n).fill(false);
    const queue: [number, number][] = [[start, 0]];
    visited[start] = true;
    const maxDepth = n * 3;

    const bfsVisited = new Map<number, number[]>();
    bfsVisited.set(start, [0]);

    for (let depth = 1; depth <= maxDepth; depth++) {
      const nextLevel: number[] = [];
      for (const [node] of queue.filter(([, d]) => d === depth - 1)) {
        for (let j = 0; j < n; j++) {
          if (matrix[node][j] > 0) {
            if (j === start) {
              returnTimes.push(depth);
            }
            if (!bfsVisited.has(j) || !bfsVisited.get(j)!.includes(depth)) {
              nextLevel.push(j);
              if (!bfsVisited.has(j)) bfsVisited.set(j, []);
              bfsVisited.get(j)!.push(depth);
              queue.push([j, depth]);
            }
          }
        }
      }
      if (nextLevel.length === 0 && returnTimes.length > 0) break;
    }

    if (returnTimes.length > 0) {
      let period = returnTimes[0];
      for (let i = 1; i < returnTimes.length; i++) {
        period = gcd(period, returnTimes[i]);
      }
      overallPeriod = overallPeriod === 0 ? period : gcd(overallPeriod, period);
    }
  }

  return overallPeriod || 1;
}

function findCommunicationClasses(matrix: number[][]): number[][] {
  const n = matrix.length;
  if (n === 0) return [];

  function canReach(from: number, to: number): boolean {
    const visited = new Set<number>();
    const stack = [from];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === to && visited.size > 0) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      for (let j = 0; j < n; j++) {
        if (matrix[current][j] > 0 && !visited.has(j)) {
          stack.push(j);
        }
      }
    }
    return visited.has(to);
  }

  const assigned = new Set<number>();
  const classes: number[][] = [];

  for (let i = 0; i < n; i++) {
    if (assigned.has(i)) continue;
    const cls = [i];
    assigned.add(i);
    for (let j = i + 1; j < n; j++) {
      if (assigned.has(j)) continue;
      if (canReach(i, j) && canReach(j, i)) {
        cls.push(j);
        assigned.add(j);
      }
    }
    classes.push(cls);
  }

  return classes;
}

function isErgodic(matrix: number[][]): boolean {
  const classes = findCommunicationClasses(matrix);
  if (classes.length !== 1) return false;
  const period = computePeriod(matrix);
  return period === 1;
}

function rowSum(matrix: number[][], i: number): number {
  return matrix[i].reduce((a, b) => a + b, 0);
}

function isMatrixValid(matrix: number[][]): boolean {
  for (let i = 0; i < matrix.length; i++) {
    const sum = rowSum(matrix, i);
    if (Math.abs(sum - 1) > 0.01) return false;
  }
  return true;
}

/* ──────────────────────────────────────
   Text generation helpers
   ────────────────────────────────────── */

function buildTextChain(text: string, level: "char" | "word"): Map<string, Map<string, number>> {
  const chain = new Map<string, Map<string, number>>();
  const tokens = level === "char" ? text.split("") : text.split(/\s+/).filter(Boolean);

  for (let i = 0; i < tokens.length - 1; i++) {
    const current = tokens[i];
    const next = tokens[i + 1];
    if (!chain.has(current)) chain.set(current, new Map());
    const transitions = chain.get(current)!;
    transitions.set(next, (transitions.get(next) || 0) + 1);
  }

  for (const [, transitions] of chain) {
    const total = Array.from(transitions.values()).reduce((a, b) => a + b, 0);
    for (const [key, count] of transitions) {
      transitions.set(key, count / total);
    }
  }

  return chain;
}

function generateText(chain: Map<string, Map<string, number>>, length: number, level: "char" | "word"): string {
  if (chain.size === 0) return "";
  const keys = Array.from(chain.keys());
  let current = keys[Math.floor(Math.random() * keys.length)];
  const result = [current];

  for (let i = 0; i < length - 1; i++) {
    const transitions = chain.get(current);
    if (!transitions || transitions.size === 0) {
      current = keys[Math.floor(Math.random() * keys.length)];
      result.push(current);
      continue;
    }
    const entries = Array.from(transitions.entries());
    const r = Math.random();
    let cumulative = 0;
    let chosen = entries[0][0];
    for (const [token, prob] of entries) {
      cumulative += prob;
      if (r <= cumulative) {
        chosen = token;
        break;
      }
    }
    result.push(chosen);
    current = chosen;
  }

  return level === "char" ? result.join("") : result.join(" ");
}

/* ──────────────────────────────────────
   Canvas drawing helpers
   ────────────────────────────────────── */

function drawArrow(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  prob: number,
  color: string,
  isActive: boolean,
  curveOffset: number = 0
): void {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return;

  const nx = dx / dist;
  const ny = dy / dist;

  const startX = fromX + nx * STATE_RADIUS;
  const startY = fromY + ny * STATE_RADIUS;
  const endX = toX - nx * STATE_RADIUS;
  const endY = toY - ny * STATE_RADIUS;

  const lineWidth = 1 + prob * 4;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = isActive ? lineWidth + 2 : lineWidth;
  ctx.globalAlpha = isActive ? 1 : 0.6 + prob * 0.4;

  if (curveOffset !== 0) {
    const perpX = -ny * curveOffset;
    const perpY = nx * curveOffset;
    const midX = (startX + endX) / 2 + perpX;
    const midY = (startY + endY) / 2 + perpY;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(midX, midY, endX, endY);
    ctx.stroke();

    const t = 0.95;
    const tangentX = 2 * (1 - t) * (midX - startX) + 2 * t * (endX - midX);
    const tangentY = 2 * (1 - t) * (midY - startY) + 2 * t * (endY - midY);
    const tangentLen = Math.sqrt(tangentX * tangentX + tangentY * tangentY);
    if (tangentLen > 0) {
      const tnx = tangentX / tangentLen;
      const tny = tangentY / tangentLen;
      drawArrowHead(ctx, endX, endY, tnx, tny, color);
    }

    ctx.fillStyle = color;
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = 1;
    ctx.fillText(prob.toFixed(2), midX, midY - 10);
  } else {
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    drawArrowHead(ctx, endX, endY, nx, ny, color);

    const labelX = (startX + endX) / 2 - ny * 12;
    const labelY = (startY + endY) / 2 + nx * 12;
    ctx.fillStyle = color;
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = 1;
    ctx.fillText(prob.toFixed(2), labelX, labelY);
  }

  ctx.restore();
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  tipX: number,
  tipY: number,
  dirX: number,
  dirY: number,
  color: string
): void {
  const angle = Math.atan2(dirY, dirX);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(
    tipX - ARROW_HEAD_SIZE * Math.cos(angle - Math.PI / 6),
    tipY - ARROW_HEAD_SIZE * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    tipX - ARROW_HEAD_SIZE * Math.cos(angle + Math.PI / 6),
    tipY - ARROW_HEAD_SIZE * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
}

function drawSelfLoop(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  prob: number,
  color: string,
  isActive: boolean
): void {
  const loopCenterY = y - STATE_RADIUS - SELF_LOOP_RADIUS;
  const lineWidth = 1 + prob * 4;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = isActive ? lineWidth + 2 : lineWidth;
  ctx.globalAlpha = isActive ? 1 : 0.6 + prob * 0.4;

  ctx.beginPath();
  ctx.arc(x, loopCenterY, SELF_LOOP_RADIUS, 0.3, Math.PI * 2 - 0.3);
  ctx.stroke();

  const arrowAngle = Math.PI * 2 - 0.3;
  const tipX = x + SELF_LOOP_RADIUS * Math.cos(arrowAngle);
  const tipY = loopCenterY + SELF_LOOP_RADIUS * Math.sin(arrowAngle);
  const tangentAngle = arrowAngle + Math.PI / 2;
  drawArrowHead(ctx, tipX, tipY, Math.cos(tangentAngle), Math.sin(tangentAngle), color);

  ctx.fillStyle = color;
  ctx.font = "11px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.globalAlpha = 1;
  ctx.fillText(prob.toFixed(2), x, loopCenterY - SELF_LOOP_RADIUS - 8);

  ctx.restore();
}

function drawState(
  ctx: CanvasRenderingContext2D,
  state: MarkovState,
  colorIndex: number,
  probability: number,
  isCurrent: boolean,
  pulsePhase: number
): void {
  const color = STATE_COLORS[colorIndex % STATE_COLORS.length];

  ctx.save();

  if (isCurrent) {
    const pulseRadius = STATE_RADIUS + 6 + Math.sin(pulsePhase) * 4;
    ctx.beginPath();
    ctx.arc(state.x, state.y, pulseRadius, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.4 + Math.sin(pulsePhase) * 0.2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  const gradient = ctx.createRadialGradient(
    state.x, state.y, 0,
    state.x, state.y, STATE_RADIUS
  );
  const alpha = Math.max(0.3, probability);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, adjustAlpha(color, alpha));

  ctx.beginPath();
  ctx.arc(state.x, state.y, STATE_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = isCurrent ? 3 : 2;
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 13px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(state.label, state.x, state.y);

  ctx.restore();
}

function adjustAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ──────────────────────────────────────
   Component
   ────────────────────────────────────── */

export default function MarkovChain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const runIntervalRef = useRef<number>(0);

  const [states, setStates] = useState<MarkovState[]>(PRESETS.weather.states);
  const [transitions, setTransitions] = useState<Transition[]>(PRESETS.weather.transitions);
  const [selectedPreset, setSelectedPreset] = useState("weather");

  const [sim, setSim] = useState<SimulationState | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runSpeed, setRunSpeed] = useState(200);
  const [stepsToRun, setStepsToRun] = useState(100);

  const [dragInfo, setDragInfo] = useState<DragInfo | null>(null);
  const [drawingTransition, setDrawingTransition] = useState<{ fromId: number; mouseX: number; mouseY: number } | null>(null);
  const [editingTransition, setEditingTransition] = useState<{ from: number; to: number } | null>(null);
  const [editProbValue, setEditProbValue] = useState("");

  const [viewMode, setViewMode] = useState<ViewMode>("diagram");
  const [textGen, setTextGen] = useState<TextGenState>({
    sourceText: TEXT_PRESETS.shakespeare,
    level: "word",
    generatedText: "",
    chain: new Map(),
  });
  const [textPreset, setTextPreset] = useState("shakespeare");

  const [nextStateId, setNextStateId] = useState(2);
  const [pulsePhase, setPulsePhase] = useState(0);
  const [showMatrix, setShowMatrix] = useState(true);

  const matrix = buildTransitionMatrix(states, transitions);
  const stationaryDist = powerIteration(matrix);
  const absorbingStates = detectAbsorbingStates(matrix);
  const period = computePeriod(matrix);
  const commClasses = findCommunicationClasses(matrix);
  const ergodic = isErgodic(matrix);
  const matrixValid = isMatrixValid(matrix);

  const currentDist = sim
    ? sim.visitCounts.map((c) => (sim.step > 0 ? c / sim.step : 1 / states.length))
    : states.map(() => 1 / states.length);

  /* ── Canvas rendering ── */

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = "var(--color-surface)";
    ctx.fillRect(0, 0, w, h);

    // Fallback: try to read computed style
    const computedBg = getComputedStyle(canvas).getPropertyValue("--color-surface").trim() || "#111111";
    ctx.fillStyle = computedBg;
    ctx.fillRect(0, 0, w, h);

    // Grid
    const gridColor = getComputedStyle(canvas).getPropertyValue("--color-border").trim() || "#27272a";
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.3;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Determine which transitions are bidirectional for curving
    const bidirectional = new Set<string>();
    for (const t of transitions) {
      if (t.from !== t.to) {
        const reverse = transitions.find((r) => r.from === t.to && r.to === t.from);
        if (reverse) {
          bidirectional.add(`${t.from}-${t.to}`);
        }
      }
    }

    // Draw transitions
    for (const t of transitions) {
      const fromState = states.find((s) => s.id === t.from);
      const toState = states.find((s) => s.id === t.to);
      if (!fromState || !toState) continue;

      const isActiveTransition =
        sim &&
        sim.distributionHistory.length >= 2 &&
        sim.currentStateId === t.to;

      const color = STATE_COLORS[states.indexOf(fromState) % STATE_COLORS.length];

      if (t.from === t.to) {
        drawSelfLoop(ctx, fromState.x, fromState.y, t.probability, color, !!isActiveTransition);
      } else {
        const curveOffset = bidirectional.has(`${t.from}-${t.to}`) ? 30 : 0;
        drawArrow(
          ctx,
          fromState.x,
          fromState.y,
          toState.x,
          toState.y,
          t.probability,
          color,
          !!isActiveTransition,
          curveOffset
        );
      }
    }

    // Draw transition being created
    if (drawingTransition) {
      const fromState = states.find((s) => s.id === drawingTransition.fromId);
      if (fromState) {
        ctx.save();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(fromState.x, fromState.y);
        ctx.lineTo(drawingTransition.mouseX, drawingTransition.mouseY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    // Draw states
    for (let i = 0; i < states.length; i++) {
      const s = states[i];
      const prob = currentDist[i] || 0;
      const isCurrent = sim ? sim.currentStateId === s.id : false;
      drawState(ctx, s, i, prob, isCurrent, pulsePhase);
    }

    // Instructions when empty
    if (states.length === 0) {
      const textColor = getComputedStyle(canvas).getPropertyValue("--color-text-muted").trim() || "#a1a1aa";
      ctx.fillStyle = textColor;
      ctx.font = "14px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Click to add a state", w / 2, h / 2);
    }
  }, [states, transitions, sim, drawingTransition, pulsePhase, currentDist]);

  useEffect(() => {
    draw();
  }, [draw]);

  /* ── Animation loop for pulse ── */

  useEffect(() => {
    let running = true;
    const animate = () => {
      if (!running) return;
      setPulsePhase((prev) => prev + 0.08);
      animFrameRef.current = requestAnimationFrame(animate);
    };
    if (sim) {
      animate();
    }
    return () => {
      running = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [sim !== null]);

  /* ── Auto-run simulation ── */

  useEffect(() => {
    if (!isRunning) {
      if (runIntervalRef.current) clearInterval(runIntervalRef.current);
      return;
    }

    let stepsLeft = stepsToRun;
    runIntervalRef.current = window.setInterval(() => {
      if (stepsLeft <= 0) {
        setIsRunning(false);
        return;
      }
      stepSimulation();
      stepsLeft--;
    }, runSpeed);

    return () => {
      if (runIntervalRef.current) clearInterval(runIntervalRef.current);
    };
  }, [isRunning, runSpeed]);

  /* ── Canvas interactions ── */

  const getCanvasPos = useCallback((e: MouseEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const findStateAt = useCallback(
    (x: number, y: number): MarkovState | null => {
      for (const s of states) {
        const dx = s.x - x;
        const dy = s.y - y;
        if (dx * dx + dy * dy <= STATE_RADIUS * STATE_RADIUS) return s;
      }
      return null;
    },
    [states]
  );

  const handleCanvasMouseDown = useCallback(
    (e: MouseEvent) => {
      const pos = getCanvasPos(e);
      const clickedState = findStateAt(pos.x, pos.y);

      if (e.shiftKey && clickedState) {
        // Start drawing a transition
        setDrawingTransition({ fromId: clickedState.id, mouseX: pos.x, mouseY: pos.y });
        return;
      }

      if (clickedState) {
        setDragInfo({
          type: "state",
          stateId: clickedState.id,
          offsetX: pos.x - clickedState.x,
          offsetY: pos.y - clickedState.y,
        });
        return;
      }

      // Double-click to remove (via right-click context would be better, but for simplicity):
      if (e.detail === 2) {
        return;
      }

      // Add new state
      const newState: MarkovState = {
        id: nextStateId,
        label: `S${nextStateId}`,
        x: pos.x,
        y: pos.y,
      };
      setStates((prev) => [...prev, newState]);
      setNextStateId((prev) => prev + 1);
    },
    [getCanvasPos, findStateAt, nextStateId]
  );

  const handleCanvasMouseMove = useCallback(
    (e: MouseEvent) => {
      const pos = getCanvasPos(e);

      if (dragInfo && dragInfo.type === "state") {
        setStates((prev) =>
          prev.map((s) =>
            s.id === dragInfo.stateId
              ? { ...s, x: pos.x - dragInfo.offsetX, y: pos.y - dragInfo.offsetY }
              : s
          )
        );
        return;
      }

      if (drawingTransition) {
        setDrawingTransition((prev) => (prev ? { ...prev, mouseX: pos.x, mouseY: pos.y } : null));
      }
    },
    [dragInfo, drawingTransition, getCanvasPos]
  );

  const handleCanvasMouseUp = useCallback(
    (e: MouseEvent) => {
      if (drawingTransition) {
        const pos = getCanvasPos(e);
        const targetState = findStateAt(pos.x, pos.y);
        if (targetState) {
          const existing = transitions.find(
            (t) => t.from === drawingTransition.fromId && t.to === targetState.id
          );
          if (!existing) {
            const newTransition: Transition = {
              from: drawingTransition.fromId,
              to: targetState.id,
              probability: 0.5,
            };
            setTransitions((prev) => {
              const updated = [...prev, newTransition];
              return normalizeTransitions(updated, drawingTransition.fromId, states);
            });
          }
        }
        setDrawingTransition(null);
        return;
      }

      setDragInfo(null);
    },
    [drawingTransition, getCanvasPos, findStateAt, transitions, states]
  );

  const handleCanvasContextMenu = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      const pos = getCanvasPos(e);
      const clickedState = findStateAt(pos.x, pos.y);

      if (clickedState) {
        // Remove state and its transitions
        setStates((prev) => prev.filter((s) => s.id !== clickedState.id));
        setTransitions((prev) =>
          prev.filter((t) => t.from !== clickedState.id && t.to !== clickedState.id)
        );
        if (sim && sim.currentStateId === clickedState.id) {
          setSim(null);
        }
      }
    },
    [getCanvasPos, findStateAt, sim]
  );

  /* ── Transition helpers ── */

  function normalizeTransitions(trans: Transition[], fromId: number, currentStates: MarkovState[]): Transition[] {
    const fromTrans = trans.filter((t) => t.from === fromId);
    const sum = fromTrans.reduce((a, t) => a + t.probability, 0);
    if (sum === 0) return trans;

    return trans.map((t) => {
      if (t.from === fromId) {
        return { ...t, probability: t.probability / sum };
      }
      return t;
    });
  }

  function updateTransitionProb(from: number, to: number, newProb: number) {
    const clamped = Math.max(MIN_PROB, Math.min(1, newProb));
    setTransitions((prev) => {
      const updated = prev.map((t) =>
        t.from === from && t.to === to ? { ...t, probability: clamped } : t
      );
      return normalizeTransitions(updated, from, states);
    });
  }

  function removeTransition(from: number, to: number) {
    setTransitions((prev) => {
      const filtered = prev.filter((t) => !(t.from === from && t.to === to));
      const remaining = filtered.filter((t) => t.from === from);
      if (remaining.length > 0) {
        return normalizeTransitions(filtered, from, states);
      }
      return filtered;
    });
  }

  /* ── Simulation ── */

  function startSimulation(startStateId?: number) {
    const startId = startStateId ?? (states.length > 0 ? states[0].id : 0);
    setSim({
      currentStateId: startId,
      step: 0,
      visitCounts: states.map(() => 0),
      distributionHistory: [],
      convergenceHistory: [],
    });
    setIsRunning(false);
  }

  function stepSimulation() {
    setSim((prev) => {
      if (!prev || states.length === 0) return prev;

      const currentIndex = states.findIndex((s) => s.id === prev.currentStateId);
      if (currentIndex === -1) return prev;

      const row = matrix[currentIndex];
      const nextIndex = sampleFromDistribution(row);
      const nextStateId = states[nextIndex].id;

      const newVisitCounts = [...prev.visitCounts];
      newVisitCounts[nextIndex]++;

      const newStep = prev.step + 1;
      const empiricalDist = newVisitCounts.map((c) => c / newStep);
      const dist = l1Distance(empiricalDist, stationaryDist);

      return {
        currentStateId: nextStateId,
        step: newStep,
        visitCounts: newVisitCounts,
        distributionHistory: [...prev.distributionHistory, empiricalDist],
        convergenceHistory: [...prev.convergenceHistory, dist],
      };
    });
  }

  function resetSimulation() {
    setSim(null);
    setIsRunning(false);
    if (runIntervalRef.current) clearInterval(runIntervalRef.current);
  }

  /* ── Preset loading ── */

  function loadPreset(name: string) {
    const preset = PRESETS[name];
    if (!preset) return;
    setStates(preset.states.map((s) => ({ ...s })));
    setTransitions(preset.transitions.map((t) => ({ ...t })));
    setSelectedPreset(name);
    setSim(null);
    setIsRunning(false);
    const maxId = Math.max(...preset.states.map((s) => s.id));
    setNextStateId(maxId + 1);
  }

  /* ── Matrix editing ── */

  function handleMatrixChange(fromIdx: number, toIdx: number, value: string) {
    const parsed = parseFloat(value);
    if (isNaN(parsed)) return;

    const fromId = states[fromIdx].id;
    const toId = states[toIdx].id;

    setTransitions((prev) => {
      let updated: Transition[];
      const existing = prev.find((t) => t.from === fromId && t.to === toId);

      if (existing) {
        if (parsed <= 0) {
          updated = prev.filter((t) => !(t.from === fromId && t.to === toId));
        } else {
          updated = prev.map((t) =>
            t.from === fromId && t.to === toId ? { ...t, probability: parsed } : t
          );
        }
      } else if (parsed > 0) {
        updated = [...prev, { from: fromId, to: toId, probability: parsed }];
      } else {
        return prev;
      }

      const remaining = updated.filter((t) => t.from === fromId);
      if (remaining.length > 0) {
        return normalizeTransitions(updated, fromId, states);
      }
      return updated;
    });
  }

  /* ── Text generation ── */

  function handleBuildTextChain() {
    const chain = buildTextChain(textGen.sourceText, textGen.level);
    setTextGen((prev) => ({ ...prev, chain }));
  }

  function handleGenerateText() {
    if (textGen.chain.size === 0) {
      handleBuildTextChain();
      setTimeout(() => {
        setTextGen((prev) => {
          const chain = buildTextChain(prev.sourceText, prev.level);
          const text = generateText(chain, prev.level === "char" ? 200 : 50, prev.level);
          return { ...prev, chain, generatedText: text };
        });
      }, 0);
      return;
    }
    const text = generateText(textGen.chain, textGen.level === "char" ? 200 : 50, textGen.level);
    setTextGen((prev) => ({ ...prev, generatedText: text }));
  }

  function loadTextPreset(name: string) {
    setTextPreset(name);
    const text = TEXT_PRESETS[name] || "";
    setTextGen({ sourceText: text, level: textGen.level, generatedText: "", chain: new Map() });
  }

  /* ── Distribution bar chart (inline SVG-like via div) ── */

  function renderDistributionBars() {
    const maxProb = Math.max(...currentDist, ...stationaryDist, 0.01);

    return (
      <div class="space-y-1">
        {states.map((s, i) => {
          const empirical = currentDist[i] || 0;
          const theoretical = stationaryDist[i] || 0;
          const color = STATE_COLORS[i % STATE_COLORS.length];

          return (
            <div key={s.id} class="flex items-center gap-2 text-xs">
              <span class="w-10 text-right font-mono" style={{ color }}>
                {s.label}
              </span>
              <div class="flex-1">
                <div class="flex items-center gap-1">
                  <div
                    style={{
                      width: `${(empirical / maxProb) * 100}%`,
                      height: "10px",
                      backgroundColor: color,
                      borderRadius: "2px",
                      minWidth: "2px",
                      transition: "width 0.15s ease",
                    }}
                  />
                  <span class="font-mono text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                    {empirical.toFixed(3)}
                  </span>
                </div>
                <div class="flex items-center gap-1 mt-0.5">
                  <div
                    style={{
                      width: `${(theoretical / maxProb) * 100}%`,
                      height: "4px",
                      backgroundColor: color,
                      borderRadius: "2px",
                      opacity: 0.35,
                      minWidth: "2px",
                    }}
                  />
                  <span
                    class="font-mono text-[10px]"
                    style={{ color: "var(--color-text-muted)", opacity: 0.6 }}
                  >
                    {theoretical.toFixed(3)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        <div class="flex gap-4 text-[10px] mt-2" style={{ color: "var(--color-text-muted)" }}>
          <span>
            <span
              style={{
                display: "inline-block",
                width: "12px",
                height: "6px",
                backgroundColor: "var(--color-primary)",
                borderRadius: "1px",
                marginRight: "4px",
              }}
            />
            Empirical
          </span>
          <span>
            <span
              style={{
                display: "inline-block",
                width: "12px",
                height: "3px",
                backgroundColor: "var(--color-primary)",
                opacity: 0.35,
                borderRadius: "1px",
                marginRight: "4px",
              }}
            />
            Stationary
          </span>
        </div>
      </div>
    );
  }

  /* ── Convergence plot ── */

  function renderConvergencePlot() {
    if (!sim || sim.convergenceHistory.length < 2) {
      return (
        <div
          class="text-xs text-center py-4"
          style={{ color: "var(--color-text-muted)" }}
        >
          Run the simulation to see convergence
        </div>
      );
    }

    const history = sim.convergenceHistory;
    const maxVal = Math.max(...history, 0.01);
    const w = 280;
    const h = 80;
    const step = w / Math.max(history.length - 1, 1);

    const points = history
      .map((v, i) => `${i * step},${h - (v / maxVal) * h}`)
      .join(" ");

    return (
      <div>
        <svg width={w} height={h + 20} style={{ overflow: "visible" }}>
          <polyline
            points={points}
            fill="none"
            stroke="var(--color-accent)"
            stroke-width="1.5"
          />
          <line
            x1="0"
            y1={h}
            x2={w}
            y2={h}
            stroke="var(--color-border)"
            stroke-width="0.5"
          />
          <text x="0" y={h + 14} fill="var(--color-text-muted)" font-size="9">
            0
          </text>
          <text
            x={w}
            y={h + 14}
            fill="var(--color-text-muted)"
            font-size="9"
            text-anchor="end"
          >
            {history.length}
          </text>
          <text x="0" y="8" fill="var(--color-text-muted)" font-size="9">
            {maxVal.toFixed(2)}
          </text>
        </svg>
        <div class="text-[10px] mt-1" style={{ color: "var(--color-text-muted)" }}>
          |empirical - stationary| L1 distance
        </div>
      </div>
    );
  }

  /* ── Render ── */

  const panelBg = "color-mix(in srgb, var(--color-surface) 80%, transparent)";
  const borderColor = "var(--color-border)";

  return (
    <div style={{ fontFamily: "var(--font-sans)" }}>
      {/* Mode tabs */}
      <div class="flex gap-2 mb-4">
        <button
          onClick={() => setViewMode("diagram")}
          style={{
            padding: "6px 16px",
            borderRadius: "6px",
            border: `1px solid ${borderColor}`,
            backgroundColor: viewMode === "diagram" ? "var(--color-primary)" : "transparent",
            color: viewMode === "diagram" ? "#fff" : "var(--color-text)",
            cursor: "pointer",
            fontSize: "13px",
            fontFamily: "var(--font-sans)",
          }}
        >
          State Diagram
        </button>
        <button
          onClick={() => setViewMode("text-gen")}
          style={{
            padding: "6px 16px",
            borderRadius: "6px",
            border: `1px solid ${borderColor}`,
            backgroundColor: viewMode === "text-gen" ? "var(--color-primary)" : "transparent",
            color: viewMode === "text-gen" ? "#fff" : "var(--color-text)",
            cursor: "pointer",
            fontSize: "13px",
            fontFamily: "var(--font-sans)",
          }}
        >
          Text Generation
        </button>
      </div>

      {viewMode === "diagram" ? (
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
          {/* Left: Canvas + Distribution */}
          <div style={{ flex: "1 1 550px", minWidth: "320px" }}>
            {/* Canvas */}
            <div
              style={{
                position: "relative",
                border: `1px solid ${borderColor}`,
                borderRadius: "8px",
                overflow: "hidden",
              }}
            >
              <canvas
                ref={canvasRef}
                style={{ width: "100%", height: "400px", cursor: dragInfo ? "grabbing" : "crosshair" }}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={() => {
                  setDragInfo(null);
                  setDrawingTransition(null);
                }}
                onContextMenu={handleCanvasContextMenu}
              />
              <div
                style={{
                  position: "absolute",
                  bottom: "8px",
                  left: "8px",
                  fontSize: "10px",
                  color: "var(--color-text-muted)",
                  opacity: 0.7,
                }}
              >
                Click: add state | Shift+drag: add transition | Right-click: remove | Drag: move
              </div>
            </div>

            {/* Distribution bars */}
            <div
              style={{
                marginTop: "12px",
                padding: "12px",
                border: `1px solid ${borderColor}`,
                borderRadius: "8px",
                background: panelBg,
              }}
            >
              <div
                class="text-xs font-bold mb-2"
                style={{ color: "var(--color-heading)" }}
              >
                Distribution
              </div>
              {renderDistributionBars()}
            </div>

            {/* Convergence plot */}
            <div
              style={{
                marginTop: "12px",
                padding: "12px",
                border: `1px solid ${borderColor}`,
                borderRadius: "8px",
                background: panelBg,
              }}
            >
              <div
                class="text-xs font-bold mb-2"
                style={{ color: "var(--color-heading)" }}
              >
                Convergence
              </div>
              {renderConvergencePlot()}
            </div>
          </div>

          {/* Right: Controls panel */}
          <div
            style={{
              flex: "0 0 300px",
              minWidth: "260px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            {/* Presets */}
            <div
              style={{
                padding: "12px",
                border: `1px solid ${borderColor}`,
                borderRadius: "8px",
                background: panelBg,
              }}
            >
              <div
                class="text-xs font-bold mb-2"
                style={{ color: "var(--color-heading)" }}
              >
                Presets
              </div>
              <select
                value={selectedPreset}
                onChange={(e) => loadPreset((e.target as HTMLSelectElement).value)}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  borderRadius: "4px",
                  border: `1px solid ${borderColor}`,
                  backgroundColor: "var(--color-bg)",
                  color: "var(--color-text)",
                  fontSize: "12px",
                  fontFamily: "var(--font-sans)",
                }}
              >
                <option value="weather">Weather (Sunny/Rainy)</option>
                <option value="randomWalk">Random Walk (5 states)</option>
                <option value="gamblersRuin">Gambler's Ruin (absorbing)</option>
                <option value="pageRank">PageRank Mini (4 pages)</option>
                <option value="ehrenfest">Ehrenfest Model (diffusion)</option>
              </select>
            </div>

            {/* Transition Matrix */}
            <div
              style={{
                padding: "12px",
                border: `1px solid ${borderColor}`,
                borderRadius: "8px",
                background: panelBg,
              }}
            >
              <div class="flex items-center justify-between mb-2">
                <div
                  class="text-xs font-bold"
                  style={{ color: "var(--color-heading)" }}
                >
                  Transition Matrix
                </div>
                <button
                  onClick={() => setShowMatrix(!showMatrix)}
                  style={{
                    padding: "2px 8px",
                    borderRadius: "4px",
                    border: `1px solid ${borderColor}`,
                    backgroundColor: "transparent",
                    color: "var(--color-text-muted)",
                    cursor: "pointer",
                    fontSize: "10px",
                    fontFamily: "var(--font-sans)",
                  }}
                >
                  {showMatrix ? "Hide" : "Show"}
                </button>
              </div>

              {showMatrix && states.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      borderCollapse: "collapse",
                      fontSize: "11px",
                      width: "100%",
                    }}
                  >
                    <thead>
                      <tr>
                        <th
                          style={{
                            padding: "3px 4px",
                            color: "var(--color-text-muted)",
                            textAlign: "left",
                          }}
                        />
                        {states.map((s, j) => (
                          <th
                            key={s.id}
                            style={{
                              padding: "3px 4px",
                              color: STATE_COLORS[j % STATE_COLORS.length],
                              textAlign: "center",
                              fontWeight: "bold",
                            }}
                          >
                            {s.label}
                          </th>
                        ))}
                        <th
                          style={{
                            padding: "3px 4px",
                            color: "var(--color-text-muted)",
                            textAlign: "center",
                            fontSize: "10px",
                          }}
                        >
                          Sum
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {states.map((s, i) => {
                        const sum = rowSum(matrix, i);
                        const sumValid = Math.abs(sum - 1) < 0.01;
                        return (
                          <tr key={s.id}>
                            <td
                              style={{
                                padding: "3px 4px",
                                color: STATE_COLORS[i % STATE_COLORS.length],
                                fontWeight: "bold",
                              }}
                            >
                              {s.label}
                            </td>
                            {states.map((_, j) => (
                              <td key={j} style={{ padding: "2px" }}>
                                <input
                                  type="number"
                                  min="0"
                                  max="1"
                                  step="0.05"
                                  value={matrix[i][j].toFixed(2)}
                                  onChange={(e) =>
                                    handleMatrixChange(i, j, (e.target as HTMLInputElement).value)
                                  }
                                  style={{
                                    width: "48px",
                                    padding: "2px 4px",
                                    borderRadius: "3px",
                                    border: `1px solid ${borderColor}`,
                                    backgroundColor: "var(--color-bg)",
                                    color: "var(--color-text)",
                                    fontSize: "11px",
                                    textAlign: "center",
                                    fontFamily: "var(--font-mono)",
                                  }}
                                />
                              </td>
                            ))}
                            <td
                              style={{
                                padding: "3px 4px",
                                textAlign: "center",
                                fontFamily: "var(--font-mono)",
                                fontSize: "11px",
                                color: sumValid ? "var(--color-accent)" : "#ef4444",
                                fontWeight: "bold",
                              }}
                            >
                              {sum.toFixed(2)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!matrixValid && (
                    <div
                      class="text-[10px] mt-1"
                      style={{ color: "#ef4444" }}
                    >
                      Some rows do not sum to 1. They will be auto-normalized.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Simulation controls */}
            <div
              style={{
                padding: "12px",
                border: `1px solid ${borderColor}`,
                borderRadius: "8px",
                background: panelBg,
              }}
            >
              <div
                class="text-xs font-bold mb-2"
                style={{ color: "var(--color-heading)" }}
              >
                Simulation
              </div>

              {!sim ? (
                <div class="space-y-2">
                  <div class="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    Start from:
                  </div>
                  <div class="flex flex-wrap gap-1">
                    {states.map((s, i) => (
                      <button
                        key={s.id}
                        onClick={() => startSimulation(s.id)}
                        style={{
                          padding: "3px 10px",
                          borderRadius: "4px",
                          border: `1px solid ${STATE_COLORS[i % STATE_COLORS.length]}`,
                          backgroundColor: "transparent",
                          color: STATE_COLORS[i % STATE_COLORS.length],
                          cursor: "pointer",
                          fontSize: "11px",
                          fontFamily: "var(--font-sans)",
                        }}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div class="space-y-2">
                  <div class="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                    <span>Step:</span>
                    <span class="font-mono font-bold" style={{ color: "var(--color-heading)" }}>
                      {sim.step}
                    </span>
                    <span style={{ marginLeft: "8px" }}>Current:</span>
                    <span
                      class="font-mono font-bold"
                      style={{
                        color:
                          STATE_COLORS[
                            states.findIndex((s) => s.id === sim.currentStateId) %
                              STATE_COLORS.length
                          ],
                      }}
                    >
                      {states.find((s) => s.id === sim.currentStateId)?.label || "?"}
                    </span>
                  </div>

                  <div class="flex gap-1">
                    <button
                      onClick={() => stepSimulation()}
                      disabled={isRunning}
                      style={{
                        padding: "4px 12px",
                        borderRadius: "4px",
                        border: `1px solid ${borderColor}`,
                        backgroundColor: "var(--color-primary)",
                        color: "#fff",
                        cursor: isRunning ? "not-allowed" : "pointer",
                        fontSize: "11px",
                        opacity: isRunning ? 0.5 : 1,
                        fontFamily: "var(--font-sans)",
                      }}
                    >
                      Step
                    </button>
                    <button
                      onClick={() => setIsRunning(!isRunning)}
                      style={{
                        padding: "4px 12px",
                        borderRadius: "4px",
                        border: `1px solid ${borderColor}`,
                        backgroundColor: isRunning ? "#ef4444" : "var(--color-accent)",
                        color: "#fff",
                        cursor: "pointer",
                        fontSize: "11px",
                        fontFamily: "var(--font-sans)",
                      }}
                    >
                      {isRunning ? "Stop" : `Run ${stepsToRun}`}
                    </button>
                    <button
                      onClick={resetSimulation}
                      style={{
                        padding: "4px 12px",
                        borderRadius: "4px",
                        border: `1px solid ${borderColor}`,
                        backgroundColor: "transparent",
                        color: "var(--color-text-muted)",
                        cursor: "pointer",
                        fontSize: "11px",
                        fontFamily: "var(--font-sans)",
                      }}
                    >
                      Reset
                    </button>
                  </div>

                  <div class="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                    <label>Steps:</label>
                    <input
                      type="number"
                      min="10"
                      max="10000"
                      step="10"
                      value={stepsToRun}
                      onChange={(e) => setStepsToRun(parseInt((e.target as HTMLInputElement).value) || 100)}
                      style={{
                        width: "60px",
                        padding: "2px 4px",
                        borderRadius: "3px",
                        border: `1px solid ${borderColor}`,
                        backgroundColor: "var(--color-bg)",
                        color: "var(--color-text)",
                        fontSize: "11px",
                        fontFamily: "var(--font-mono)",
                      }}
                    />
                    <label>Speed (ms):</label>
                    <input
                      type="number"
                      min="10"
                      max="1000"
                      step="10"
                      value={runSpeed}
                      onChange={(e) => setRunSpeed(parseInt((e.target as HTMLInputElement).value) || 200)}
                      style={{
                        width: "50px",
                        padding: "2px 4px",
                        borderRadius: "3px",
                        border: `1px solid ${borderColor}`,
                        backgroundColor: "var(--color-bg)",
                        color: "var(--color-text)",
                        fontSize: "11px",
                        fontFamily: "var(--font-mono)",
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Stationary distribution */}
            <div
              style={{
                padding: "12px",
                border: `1px solid ${borderColor}`,
                borderRadius: "8px",
                background: panelBg,
              }}
            >
              <div
                class="text-xs font-bold mb-2"
                style={{ color: "var(--color-heading)" }}
              >
                Stationary Distribution (pi)
              </div>
              <div class="flex flex-wrap gap-2">
                {states.map((s, i) => (
                  <div
                    key={s.id}
                    class="text-xs font-mono"
                    style={{ color: STATE_COLORS[i % STATE_COLORS.length] }}
                  >
                    {s.label}: {stationaryDist[i]?.toFixed(4) || "N/A"}
                  </div>
                ))}
              </div>
              {absorbingStates.length > 0 && (
                <div class="text-[10px] mt-1" style={{ color: "var(--color-text-muted)" }}>
                  Note: Absorbing states present. Stationary distribution depends on initial state.
                </div>
              )}
            </div>

            {/* Properties */}
            <div
              style={{
                padding: "12px",
                border: `1px solid ${borderColor}`,
                borderRadius: "8px",
                background: panelBg,
              }}
            >
              <div
                class="text-xs font-bold mb-2"
                style={{ color: "var(--color-heading)" }}
              >
                Chain Properties
              </div>
              <div class="space-y-1 text-xs">
                <div class="flex justify-between">
                  <span style={{ color: "var(--color-text-muted)" }}>Ergodic:</span>
                  <span
                    style={{
                      color: ergodic ? "var(--color-accent)" : "#ef4444",
                      fontWeight: "bold",
                    }}
                  >
                    {ergodic ? "Yes" : "No"}
                  </span>
                </div>
                <div class="flex justify-between">
                  <span style={{ color: "var(--color-text-muted)" }}>Period:</span>
                  <span style={{ color: "var(--color-heading)", fontFamily: "var(--font-mono)" }}>
                    {period}
                  </span>
                </div>
                <div class="flex justify-between">
                  <span style={{ color: "var(--color-text-muted)" }}>Absorbing states:</span>
                  <span style={{ color: "var(--color-heading)", fontFamily: "var(--font-mono)" }}>
                    {absorbingStates.length > 0
                      ? absorbingStates.map((i) => states[i]?.label).join(", ")
                      : "None"}
                  </span>
                </div>
                <div class="flex justify-between">
                  <span style={{ color: "var(--color-text-muted)" }}>Communication classes:</span>
                  <span style={{ color: "var(--color-heading)", fontFamily: "var(--font-mono)" }}>
                    {commClasses.length}
                  </span>
                </div>
                {commClasses.length > 1 && (
                  <div class="text-[10px] mt-1" style={{ color: "var(--color-text-muted)" }}>
                    {commClasses.map((cls, idx) => (
                      <span key={idx}>
                        {"{"}
                        {cls.map((i) => states[i]?.label || i).join(", ")}
                        {"}"}{" "}
                      </span>
                    ))}
                  </div>
                )}
                {sim && (
                  <div class="flex justify-between">
                    <span style={{ color: "var(--color-text-muted)" }}>L1 distance to pi:</span>
                    <span
                      style={{ color: "var(--color-accent)", fontFamily: "var(--font-mono)" }}
                    >
                      {sim.convergenceHistory.length > 0
                        ? sim.convergenceHistory[sim.convergenceHistory.length - 1].toFixed(4)
                        : "N/A"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ── Text generation mode ── */
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 500px", minWidth: "320px" }}>
            {/* Source text */}
            <div
              style={{
                padding: "12px",
                border: `1px solid ${borderColor}`,
                borderRadius: "8px",
                background: panelBg,
              }}
            >
              <div class="flex items-center justify-between mb-2">
                <div
                  class="text-xs font-bold"
                  style={{ color: "var(--color-heading)" }}
                >
                  Source Text
                </div>
                <select
                  value={textPreset}
                  onChange={(e) => loadTextPreset((e.target as HTMLSelectElement).value)}
                  style={{
                    padding: "3px 6px",
                    borderRadius: "4px",
                    border: `1px solid ${borderColor}`,
                    backgroundColor: "var(--color-bg)",
                    color: "var(--color-text)",
                    fontSize: "11px",
                    fontFamily: "var(--font-sans)",
                  }}
                >
                  <option value="shakespeare">Shakespeare</option>
                  <option value="loremIpsum">Lorem Ipsum</option>
                  <option value="pythonCode">Python Code</option>
                </select>
              </div>
              <textarea
                value={textGen.sourceText}
                onInput={(e) =>
                  setTextGen((prev) => ({
                    ...prev,
                    sourceText: (e.target as HTMLTextAreaElement).value,
                    chain: new Map(),
                  }))
                }
                style={{
                  width: "100%",
                  height: "120px",
                  padding: "8px",
                  borderRadius: "4px",
                  border: `1px solid ${borderColor}`,
                  backgroundColor: "var(--color-bg)",
                  color: "var(--color-text)",
                  fontSize: "12px",
                  fontFamily: "var(--font-mono)",
                  resize: "vertical",
                }}
              />
            </div>

            {/* Generated text */}
            <div
              style={{
                marginTop: "12px",
                padding: "12px",
                border: `1px solid ${borderColor}`,
                borderRadius: "8px",
                background: panelBg,
              }}
            >
              <div
                class="text-xs font-bold mb-2"
                style={{ color: "var(--color-heading)" }}
              >
                Generated Text
              </div>
              <div
                style={{
                  minHeight: "80px",
                  padding: "8px",
                  borderRadius: "4px",
                  border: `1px solid ${borderColor}`,
                  backgroundColor: "var(--color-bg)",
                  color: "var(--color-text)",
                  fontSize: "12px",
                  fontFamily: "var(--font-mono)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {textGen.generatedText || (
                  <span style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>
                    Click "Generate" to create text using the Markov chain
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Controls */}
          <div
            style={{
              flex: "0 0 280px",
              minWidth: "240px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <div
              style={{
                padding: "12px",
                border: `1px solid ${borderColor}`,
                borderRadius: "8px",
                background: panelBg,
              }}
            >
              <div
                class="text-xs font-bold mb-2"
                style={{ color: "var(--color-heading)" }}
              >
                Settings
              </div>

              <div class="space-y-2">
                <div class="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                  <label>Level:</label>
                  <select
                    value={textGen.level}
                    onChange={(e) =>
                      setTextGen((prev) => ({
                        ...prev,
                        level: (e.target as HTMLSelectElement).value as "char" | "word",
                        chain: new Map(),
                        generatedText: "",
                      }))
                    }
                    style={{
                      padding: "3px 6px",
                      borderRadius: "4px",
                      border: `1px solid ${borderColor}`,
                      backgroundColor: "var(--color-bg)",
                      color: "var(--color-text)",
                      fontSize: "11px",
                      fontFamily: "var(--font-sans)",
                    }}
                  >
                    <option value="char">Character-level</option>
                    <option value="word">Word-level</option>
                  </select>
                </div>

                <div class="flex gap-1">
                  <button
                    onClick={handleBuildTextChain}
                    style={{
                      padding: "4px 12px",
                      borderRadius: "4px",
                      border: `1px solid ${borderColor}`,
                      backgroundColor: "var(--color-primary)",
                      color: "#fff",
                      cursor: "pointer",
                      fontSize: "11px",
                      fontFamily: "var(--font-sans)",
                    }}
                  >
                    Build Chain
                  </button>
                  <button
                    onClick={handleGenerateText}
                    style={{
                      padding: "4px 12px",
                      borderRadius: "4px",
                      border: `1px solid ${borderColor}`,
                      backgroundColor: "var(--color-accent)",
                      color: "#fff",
                      cursor: "pointer",
                      fontSize: "11px",
                      fontFamily: "var(--font-sans)",
                    }}
                  >
                    Generate
                  </button>
                </div>
              </div>
            </div>

            <div
              style={{
                padding: "12px",
                border: `1px solid ${borderColor}`,
                borderRadius: "8px",
                background: panelBg,
              }}
            >
              <div
                class="text-xs font-bold mb-2"
                style={{ color: "var(--color-heading)" }}
              >
                Chain Stats
              </div>
              <div class="space-y-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
                <div class="flex justify-between">
                  <span>Unique tokens:</span>
                  <span class="font-mono" style={{ color: "var(--color-heading)" }}>
                    {textGen.chain.size}
                  </span>
                </div>
                <div class="flex justify-between">
                  <span>Total transitions:</span>
                  <span class="font-mono" style={{ color: "var(--color-heading)" }}>
                    {Array.from(textGen.chain.values()).reduce((a, m) => a + m.size, 0)}
                  </span>
                </div>
              </div>
            </div>

            <div
              style={{
                padding: "12px",
                border: `1px solid ${borderColor}`,
                borderRadius: "8px",
                background: panelBg,
              }}
            >
              <div
                class="text-xs font-bold mb-2"
                style={{ color: "var(--color-heading)" }}
              >
                How it works
              </div>
              <div class="text-[11px] leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                A Markov chain is built from the source text by counting how often
                each token follows another. The chain then generates new text by
                randomly selecting the next token based on the learned transition
                probabilities.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Editing transition probability inline */}
      {editingTransition && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setEditingTransition(null)}
        >
          <div
            style={{
              padding: "16px",
              borderRadius: "8px",
              border: `1px solid ${borderColor}`,
              background: "var(--color-surface)",
              minWidth: "250px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div class="text-sm font-bold mb-3" style={{ color: "var(--color-heading)" }}>
              Edit Transition Probability
            </div>
            <div class="text-xs mb-2" style={{ color: "var(--color-text-muted)" }}>
              {states.find((s) => s.id === editingTransition.from)?.label} {"->"}
              {states.find((s) => s.id === editingTransition.to)?.label}
            </div>
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={editProbValue}
              onInput={(e) => setEditProbValue((e.target as HTMLInputElement).value)}
              style={{
                width: "100%",
                padding: "6px 8px",
                borderRadius: "4px",
                border: `1px solid ${borderColor}`,
                backgroundColor: "var(--color-bg)",
                color: "var(--color-text)",
                fontSize: "13px",
                fontFamily: "var(--font-mono)",
              }}
            />
            <div class="flex gap-2 mt-3">
              <button
                onClick={() => {
                  const val = parseFloat(editProbValue);
                  if (!isNaN(val)) {
                    updateTransitionProb(editingTransition.from, editingTransition.to, val);
                  }
                  setEditingTransition(null);
                }}
                style={{
                  padding: "4px 16px",
                  borderRadius: "4px",
                  backgroundColor: "var(--color-primary)",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontFamily: "var(--font-sans)",
                }}
              >
                Save
              </button>
              <button
                onClick={() => {
                  removeTransition(editingTransition.from, editingTransition.to);
                  setEditingTransition(null);
                }}
                style={{
                  padding: "4px 16px",
                  borderRadius: "4px",
                  backgroundColor: "#ef4444",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontFamily: "var(--font-sans)",
                }}
              >
                Remove
              </button>
              <button
                onClick={() => setEditingTransition(null)}
                style={{
                  padding: "4px 16px",
                  borderRadius: "4px",
                  backgroundColor: "transparent",
                  color: "var(--color-text-muted)",
                  border: `1px solid ${borderColor}`,
                  cursor: "pointer",
                  fontSize: "12px",
                  fontFamily: "var(--font-sans)",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
