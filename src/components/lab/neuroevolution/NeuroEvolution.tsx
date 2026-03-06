import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import {
  type GAParams,
  type Population,
  DEFAULT_GA_PARAMS,
  createPopulation,
  evolveGeneration,
} from "./evolution";
import {
  type TaskType,
  type CartPoleState,
  type FlappyState,
  type MazeState,
  type TaskState,
  TASK_CONFIGS,
  evaluateIndividual,
  createCartPoleState,
  createFlappyState,
  createMazeState,
  stepCartPole,
  stepFlappy,
  stepMaze,
  resetSharedPipes,
  FLAPPY,
  MAZE_GRID,
  MAZE,
  castRay,
} from "./tasks";
import { type NeuralNetwork, createNetworkFromWeights } from "./nn";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

type PlayState = "idle" | "running" | "paused";
type ViewMode = "best" | "all";

interface FitnessRecord {
  generation: number;
  best: number;
  avg: number;
  worst: number;
}

interface GenerationSnapshot {
  bestWeights: Float64Array;
  bestFitness: number;
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function getColor(
  el: HTMLElement | null,
  varName: string,
  fallback: string,
): string {
  if (!el) return fallback;
  return (
    getComputedStyle(el).getPropertyValue(varName).trim() || fallback
  );
}

function lerpColor(t: number): string {
  // red (bad) -> yellow -> green (good), t in [0,1]
  const clamped = Math.max(0, Math.min(1, t));
  const r = clamped < 0.5 ? 255 : Math.round(255 * (1 - clamped) * 2);
  const g = clamped < 0.5 ? Math.round(255 * clamped * 2) : 255;
  return `rgb(${r},${g},60)`;
}

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

export default function NeuroEvolution() {
  // Task state
  const [task, setTask] = useState<TaskType>("cart-pole");
  const [playState, setPlayState] = useState<PlayState>("idle");
  const [viewMode, setViewMode] = useState<ViewMode>("best");
  const [speed, setSpeed] = useState(1);

  // GA params
  const [params, setParams] = useState<GAParams>({ ...DEFAULT_GA_PARAMS });

  // Stats
  const [generation, setGeneration] = useState(0);
  const [bestFitness, setBestFitness] = useState(0);
  const [avgFitness, setAvgFitness] = useState(0);

  // Refs
  const simCanvasRef = useRef<HTMLCanvasElement>(null);
  const chartCanvasRef = useRef<HTMLCanvasElement>(null);
  const netCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const populationRef = useRef<Population | null>(null);
  const historyRef = useRef<FitnessRecord[]>([]);
  const snapshotsRef = useRef<GenerationSnapshot[]>([]);
  const animFrameRef = useRef(0);
  const playStateRef = useRef<PlayState>("idle");
  const taskRef = useRef<TaskType>("cart-pole");
  const viewModeRef = useRef<ViewMode>("best");
  const speedRef = useRef(1);
  const paramsRef = useRef<GAParams>({ ...DEFAULT_GA_PARAMS });

  // Live simulation state for "Watch Best/All"
  const liveStatesRef = useRef<TaskState[]>([]);
  const liveNetsRef = useRef<NeuralNetwork[]>([]);
  const liveStepRef = useRef(0);
  const isEvaluatingRef = useRef(false);

  // Replay state
  const [replayGen, setReplayGen] = useState(0);
  const [isReplaying, setIsReplaying] = useState(false);
  const replayFrameRef = useRef(0);

  // Keep refs in sync
  useEffect(() => {
    playStateRef.current = playState;
  }, [playState]);
  useEffect(() => {
    taskRef.current = task;
  }, [task]);
  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  // ─────────────────────────────────────────────────────
  // Canvas rendering helpers
  // ─────────────────────────────────────────────────────

  const drawCartPole = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      states: CartPoleState[],
      nets: NeuralNetwork[],
      w: number,
      h: number,
      mode: ViewMode,
    ) => {
      const el = simCanvasRef.current;
      const bg = getColor(el, "--color-bg", "#09090b");
      const border = getColor(el, "--color-border", "#27272a");
      const primary = getColor(el, "--color-primary", "#4f8ff7");
      const textMuted = getColor(el, "--color-text-muted", "#a1a1aa");

      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Ground line
      const groundY = h * 0.75;
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(w, groundY);
      ctx.stroke();

      // Track limits
      const trackLeft = w * 0.1;
      const trackRight = w * 0.9;
      const trackWidth = trackRight - trackLeft;
      const xScale = trackWidth / (2 * 2.4);

      const polePixelLength = h * 0.25;
      const cartW = 40;
      const cartH = 20;

      const count = mode === "best" ? Math.min(1, states.length) : states.length;

      for (let i = 0; i < count; i++) {
        const s = states[i];
        const alpha = mode === "all" ? (s.alive ? 0.5 : 0.1) : 1;
        const color =
          mode === "all"
            ? lerpColor(s.steps / TASK_CONFIGS["cart-pole"].maxSteps)
            : primary;

        const cx = w / 2 + s.x * xScale;
        const cy = groundY;

        // Cart
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.fillRect(cx - cartW / 2, cy - cartH, cartW, cartH);

        // Pole
        const poleEndX = cx + Math.sin(s.theta) * polePixelLength;
        const poleEndY = cy - cartH - Math.cos(s.theta) * polePixelLength;
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx, cy - cartH);
        ctx.lineTo(poleEndX, poleEndY);
        ctx.stroke();

        // Pole tip
        ctx.beginPath();
        ctx.arc(poleEndX, poleEndY, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }

      ctx.globalAlpha = 1;

      // Labels
      ctx.fillStyle = textMuted;
      ctx.font = "11px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Cart-Pole Balancing", w / 2, 20);

      // Alive count for all-view
      if (mode === "all") {
        const alive = states.filter((s) => s.alive).length;
        ctx.fillText(`Alive: ${alive}/${states.length}`, w / 2, h - 10);
      }
    },
    [],
  );

  const drawFlappy = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      states: FlappyState[],
      _nets: NeuralNetwork[],
      w: number,
      h: number,
      mode: ViewMode,
    ) => {
      const el = simCanvasRef.current;
      const bg = getColor(el, "--color-bg", "#09090b");
      const border = getColor(el, "--color-border", "#27272a");
      const primary = getColor(el, "--color-primary", "#4f8ff7");
      const accent = getColor(el, "--color-accent", "#34d399");
      const textMuted = getColor(el, "--color-text-muted", "#a1a1aa");

      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Use the best (or first alive) agent's distance for camera
      const refState =
        mode === "best"
          ? states[0]
          : states.find((s) => s.alive) ?? states[0];

      if (!refState) return;

      const scaleX = w / FLAPPY.worldWidth;
      const scaleY = h / FLAPPY.worldHeight;

      // Draw pipes
      for (const pipe of refState.pipes) {
        const px = (pipe.x - refState.distance) * scaleX;
        if (px < -FLAPPY.pipeWidth * scaleX || px > w + 50) continue;

        ctx.fillStyle = border;
        // Top pipe
        ctx.fillRect(px, 0, FLAPPY.pipeWidth * scaleX, pipe.gapY * scaleY);
        // Bottom pipe
        const bottomY = (pipe.gapY + pipe.gapHeight) * scaleY;
        ctx.fillRect(px, bottomY, FLAPPY.pipeWidth * scaleX, h - bottomY);

        // Gap indicator
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(px, pipe.gapY * scaleY);
        ctx.lineTo(px + FLAPPY.pipeWidth * scaleX, pipe.gapY * scaleY);
        ctx.moveTo(px, (pipe.gapY + pipe.gapHeight) * scaleY);
        ctx.lineTo(
          px + FLAPPY.pipeWidth * scaleX,
          (pipe.gapY + pipe.gapHeight) * scaleY,
        );
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw birds
      const count = mode === "best" ? Math.min(1, states.length) : states.length;
      for (let i = count - 1; i >= 0; i--) {
        const s = states[i];
        const alpha = mode === "all" ? (s.alive ? 0.6 : 0.08) : 1;
        if (!s.alive && mode === "all" && alpha < 0.1) continue;

        const bx = FLAPPY.birdX * scaleX;
        // In all-mode, offset bird y based on their own state but keep in same pipe frame
        const by = s.y * scaleY;

        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(
          bx,
          by,
          FLAPPY.birdRadius * scaleX,
          0,
          Math.PI * 2,
        );
        ctx.fillStyle =
          mode === "all"
            ? lerpColor(s.distance / 3000)
            : primary;
        ctx.fill();
      }

      ctx.globalAlpha = 1;

      // Floor / ceiling lines
      ctx.strokeStyle = border;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w, 0);
      ctx.moveTo(0, h);
      ctx.lineTo(w, h);
      ctx.stroke();

      // Labels
      ctx.fillStyle = textMuted;
      ctx.font = "11px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Flappy Bird", w / 2, 16);

      if (mode === "all") {
        const alive = states.filter((s) => s.alive).length;
        ctx.fillText(`Alive: ${alive}/${states.length}`, w / 2, h - 6);
      } else {
        ctx.fillText(
          `Distance: ${Math.round(refState.distance)}`,
          w / 2,
          h - 6,
        );
      }
    },
    [],
  );

  const drawMaze = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      states: MazeState[],
      nets: NeuralNetwork[],
      w: number,
      h: number,
      mode: ViewMode,
    ) => {
      const el = simCanvasRef.current;
      const bg = getColor(el, "--color-bg", "#09090b");
      const surface = getColor(el, "--color-surface", "#111111");
      const border = getColor(el, "--color-border", "#27272a");
      const primary = getColor(el, "--color-primary", "#4f8ff7");
      const accent = getColor(el, "--color-accent", "#34d399");
      const textMuted = getColor(el, "--color-text-muted", "#a1a1aa");

      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      const cellW = w / 10;
      const cellH = h / 10;

      // Draw maze grid
      for (let row = 0; row < 10; row++) {
        for (let col = 0; col < 10; col++) {
          if (MAZE_GRID[row][col] === 1) {
            ctx.fillStyle = border;
          } else {
            ctx.fillStyle = surface;
          }
          ctx.fillRect(col * cellW, row * cellH, cellW, cellH);
        }
      }

      // Grid lines
      ctx.strokeStyle = bg;
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= 10; i++) {
        ctx.beginPath();
        ctx.moveTo(i * cellW, 0);
        ctx.lineTo(i * cellW, h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * cellH);
        ctx.lineTo(w, i * cellH);
        ctx.stroke();
      }

      // Goal
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.arc(
        MAZE.goalX * cellW,
        MAZE.goalY * cellH,
        cellW * 0.4,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.globalAlpha = 1;

      // Draw agents
      const count = mode === "best" ? Math.min(1, states.length) : states.length;
      for (let i = 0; i < count; i++) {
        const s = states[i];
        const alpha =
          mode === "all" ? (s.alive || s.reachedGoal ? 0.6 : 0.1) : 1;
        const color =
          mode === "all"
            ? lerpColor(1 - s.bestDistToGoal / 10)
            : primary;

        const px = s.x * cellW;
        const py = s.y * cellH;

        ctx.globalAlpha = alpha;

        // Draw rays for best agent
        if (i === 0 && mode === "best") {
          for (let r = 0; r < MAZE.rayCount; r++) {
            const rayAngle =
              s.angle -
              MAZE.raySpread / 2 +
              (r / (MAZE.rayCount - 1)) * MAZE.raySpread;
            const dist = castRay(s.x, s.y, rayAngle);
            const endX = px + Math.cos(rayAngle) * dist * cellW;
            const endY = py + Math.sin(rayAngle) * dist * cellH;

            ctx.strokeStyle = accent;
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.3;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(endX, endY);
            ctx.stroke();
          }
          ctx.globalAlpha = alpha;
        }

        // Agent body
        ctx.beginPath();
        ctx.arc(px, py, cellW * 0.2, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        // Direction indicator
        const dirX = px + Math.cos(s.angle) * cellW * 0.35;
        const dirY = py + Math.sin(s.angle) * cellH * 0.35;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(dirX, dirY);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;

      // Label
      ctx.fillStyle = textMuted;
      ctx.font = "11px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Maze Runner", w / 2, 14);
    },
    [],
  );

  // ─────────────────────────────────────────────────────
  // Draw fitness chart
  // ─────────────────────────────────────────────────────

  const drawChart = useCallback(() => {
    const canvas = chartCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width * dpr;
    const h = rect.height * dpr;
    canvas.width = w;
    canvas.height = h;
    ctx.scale(dpr, dpr);

    const rw = rect.width;
    const rh = rect.height;

    const el = canvas;
    const bg = getColor(el, "--color-bg", "#09090b");
    const border = getColor(el, "--color-border", "#27272a");
    const primary = getColor(el, "--color-primary", "#4f8ff7");
    const accent = getColor(el, "--color-accent", "#34d399");
    const textMuted = getColor(el, "--color-text-muted", "#a1a1aa");

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, rw, rh);

    const history = historyRef.current;
    if (history.length < 2) {
      ctx.fillStyle = textMuted;
      ctx.font = "12px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Fitness over generations", rw / 2, rh / 2);
      return;
    }

    const pad = { top: 20, right: 10, bottom: 25, left: 45 };
    const plotW = rw - pad.left - pad.right;
    const plotH = rh - pad.top - pad.bottom;

    // Find data range
    let maxVal = -Infinity;
    let minVal = Infinity;
    for (const rec of history) {
      if (rec.best > maxVal) maxVal = rec.best;
      if (rec.worst < minVal) minVal = rec.worst;
    }
    if (maxVal === minVal) {
      maxVal += 1;
      minVal -= 1;
    }
    const range = maxVal - minVal;

    // Axes
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, pad.top + plotH);
    ctx.lineTo(pad.left + plotW, pad.top + plotH);
    ctx.stroke();

    // Y axis labels
    ctx.fillStyle = textMuted;
    ctx.font = "9px Inter, sans-serif";
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      const val = minVal + (range * i) / 4;
      const y = pad.top + plotH - (plotH * i) / 4;
      ctx.fillText(val.toFixed(0), pad.left - 4, y + 3);
    }

    // X axis label
    ctx.textAlign = "center";
    ctx.fillText(`Gen ${history.length - 1}`, pad.left + plotW, rh - 4);

    // Draw lines: worst, avg, best
    const drawLine = (
      key: "worst" | "avg" | "best",
      color: string,
      lineWidth: number,
    ) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const x = pad.left + (i / (history.length - 1)) * plotW;
        const y =
          pad.top + plotH - ((history[i][key] - minVal) / range) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    drawLine("worst", border, 1);
    drawLine("avg", textMuted, 1.5);
    drawLine("best", primary, 2);

    // Legend
    ctx.font = "9px Inter, sans-serif";
    ctx.textAlign = "left";
    const legendY = 12;
    const items = [
      { label: "Best", color: primary },
      { label: "Avg", color: textMuted },
      { label: "Worst", color: border },
    ];
    let lx = pad.left;
    for (const item of items) {
      ctx.fillStyle = item.color;
      ctx.fillRect(lx, legendY - 6, 12, 3);
      ctx.fillStyle = textMuted;
      ctx.fillText(item.label, lx + 16, legendY);
      lx += 55;
    }
  }, []);

  // ─────────────────────────────────────────────────────
  // Draw network diagram
  // ─────────────────────────────────────────────────────

  const drawNetwork = useCallback((net: NeuralNetwork | null) => {
    const canvas = netCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width * dpr;
    const h = rect.height * dpr;
    canvas.width = w;
    canvas.height = h;
    ctx.scale(dpr, dpr);

    const rw = rect.width;
    const rh = rect.height;

    const el = canvas;
    const bg = getColor(el, "--color-bg", "#09090b");
    const textMuted = getColor(el, "--color-text-muted", "#a1a1aa");
    const primary = getColor(el, "--color-primary", "#4f8ff7");

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, rw, rh);

    if (!net) {
      ctx.fillStyle = textMuted;
      ctx.font = "12px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Network weights", rw / 2, rh / 2);
      return;
    }

    const { topology, weights } = net;
    const layers = topology.layers;
    const numLayers = layers.length;
    const padX = 30;
    const padY = 20;
    const layerSpacing = (rw - 2 * padX) / (numLayers - 1);

    // Compute node positions
    const nodePositions: { x: number; y: number }[][] = [];
    for (let l = 0; l < numLayers; l++) {
      const n = layers[l];
      const x = padX + l * layerSpacing;
      const positions: { x: number; y: number }[] = [];
      for (let i = 0; i < n; i++) {
        const y = padY + ((i + 0.5) / n) * (rh - 2 * padY);
        positions.push({ x, y });
      }
      nodePositions.push(positions);
    }

    // Draw connections (weights)
    let offset = 0;
    for (let l = 0; l < numLayers - 1; l++) {
      const inputSize = layers[l];
      const outputSize = layers[l + 1];
      for (let j = 0; j < outputSize; j++) {
        for (let i = 0; i < inputSize; i++) {
          const weight = weights[offset + j * inputSize + i];
          const absW = Math.min(Math.abs(weight), 3);
          const thickness = 0.5 + (absW / 3) * 2.5;
          const alpha = 0.15 + (absW / 3) * 0.6;

          ctx.strokeStyle =
            weight > 0
              ? `rgba(79, 143, 247, ${alpha})`
              : `rgba(239, 68, 68, ${alpha})`;
          ctx.lineWidth = thickness;
          ctx.beginPath();
          ctx.moveTo(nodePositions[l][i].x, nodePositions[l][i].y);
          ctx.lineTo(nodePositions[l + 1][j].x, nodePositions[l + 1][j].y);
          ctx.stroke();
        }
      }
      offset += outputSize * inputSize + outputSize;
    }

    // Draw nodes
    for (let l = 0; l < numLayers; l++) {
      for (const pos of nodePositions[l]) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = l === 0 ? primary : l === numLayers - 1 ? "#34d399" : textMuted;
        ctx.fill();
        ctx.strokeStyle = bg;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Layer labels
    ctx.fillStyle = textMuted;
    ctx.font = "9px Inter, sans-serif";
    ctx.textAlign = "center";
    const labels = layers.map((n, i) =>
      i === 0 ? `In(${n})` : i === numLayers - 1 ? `Out(${n})` : `H(${n})`,
    );
    for (let l = 0; l < numLayers; l++) {
      ctx.fillText(labels[l], nodePositions[l][0].x, rh - 4);
    }
  }, []);

  // ─────────────────────────────────────────────────────
  // Main simulation loop
  // ─────────────────────────────────────────────────────

  const drawSimulation = useCallback(() => {
    const canvas = simCanvasRef.current;
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
    const states = liveStatesRef.current;
    const nets = liveNetsRef.current;
    const mode = viewModeRef.current;
    const currentTask = taskRef.current;

    switch (currentTask) {
      case "cart-pole":
        drawCartPole(ctx, states as CartPoleState[], nets, w, h, mode);
        break;
      case "flappy":
        drawFlappy(ctx, states as FlappyState[], nets, w, h, mode);
        break;
      case "maze":
        drawMaze(ctx, states as MazeState[], nets, w, h, mode);
        break;
    }
  }, [drawCartPole, drawFlappy, drawMaze]);

  const initLiveStates = useCallback(
    (pop: Population, currentTask: TaskType) => {
      if (currentTask === "flappy") {
        resetSharedPipes();
      }
      const sorted = [...pop.individuals].sort(
        (a, b) => b.fitness - a.fitness,
      );
      const mode = viewModeRef.current;
      const agents =
        mode === "best" ? sorted.slice(0, 1) : sorted;

      liveNetsRef.current = agents.map((ind) => ind.network);
      liveStatesRef.current = agents.map(() => {
        switch (currentTask) {
          case "cart-pole":
            return createCartPoleState();
          case "flappy":
            return createFlappyState();
          case "maze":
            return createMazeState();
        }
      });
      liveStepRef.current = 0;
    },
    [],
  );

  const runLoop = useCallback(() => {
    if (playStateRef.current !== "running") return;

    const pop = populationRef.current;
    if (!pop) return;

    const currentTask = taskRef.current;
    const currentSpeed = speedRef.current;
    const maxSteps = TASK_CONFIGS[currentTask].maxSteps;

    // If speed = 0 (max), skip visualization and just evolve
    if (currentSpeed === 0) {
      // Evaluate all individuals
      for (const ind of pop.individuals) {
        const { fitness } = evaluateIndividual(ind.network, currentTask);
        ind.fitness = fitness;
      }

      const newPop = evolveGeneration(pop, paramsRef.current, TASK_CONFIGS[currentTask].topology);
      populationRef.current = newPop;

      // Save snapshot
      const sorted = [...pop.individuals].sort((a, b) => b.fitness - a.fitness);
      snapshotsRef.current.push({
        bestWeights: new Float64Array(sorted[0].network.weights),
        bestFitness: newPop.bestFitness,
      });

      historyRef.current.push({
        generation: newPop.generation - 1,
        best: newPop.bestFitness,
        avg: newPop.avgFitness,
        worst: newPop.worstFitness,
      });

      setGeneration(newPop.generation);
      setBestFitness(newPop.bestFitness);
      setAvgFitness(newPop.avgFitness);

      drawChart();
      drawNetwork(sorted[0].network);
      initLiveStates(newPop, currentTask);
      drawSimulation();

      animFrameRef.current = requestAnimationFrame(runLoop);
      return;
    }

    // If evaluation phase not started, start it
    if (!isEvaluatingRef.current && liveStepRef.current === 0) {
      isEvaluatingRef.current = true;
      initLiveStates(pop, currentTask);
    }

    // Step the live simulation
    const stepsPerFrame = currentSpeed;
    for (let s = 0; s < stepsPerFrame; s++) {
      if (liveStepRef.current >= maxSteps) break;

      const states = liveStatesRef.current;
      const nets = liveNetsRef.current;

      let allDone = true;
      for (let i = 0; i < states.length; i++) {
        const state = states[i];
        switch (currentTask) {
          case "cart-pole": {
            const cs = state as CartPoleState;
            if (cs.alive) {
              stepCartPole(cs, nets[i]);
              allDone = false;
            }
            break;
          }
          case "flappy": {
            const fs = state as FlappyState;
            if (fs.alive) {
              stepFlappy(fs, nets[i]);
              allDone = false;
            }
            break;
          }
          case "maze": {
            const ms = state as MazeState;
            if (ms.alive && !ms.reachedGoal) {
              stepMaze(ms, nets[i]);
              allDone = false;
            }
            break;
          }
        }
      }

      liveStepRef.current++;
      if (allDone) {
        liveStepRef.current = maxSteps;
        break;
      }
    }

    // Draw current frame
    drawSimulation();

    // Check if episode is done
    if (liveStepRef.current >= maxSteps) {
      // Evaluate all individuals (full evaluation for GA, not just the visualized ones)
      if (currentTask === "flappy") {
        resetSharedPipes();
      }
      for (const ind of pop.individuals) {
        const { fitness } = evaluateIndividual(ind.network, currentTask);
        ind.fitness = fitness;
      }

      // Sort to find best for snapshot
      const sorted = [...pop.individuals].sort((a, b) => b.fitness - a.fitness);
      snapshotsRef.current.push({
        bestWeights: new Float64Array(sorted[0].network.weights),
        bestFitness: sorted[0].fitness,
      });

      // Evolve
      const newPop = evolveGeneration(pop, paramsRef.current, TASK_CONFIGS[currentTask].topology);
      populationRef.current = newPop;

      historyRef.current.push({
        generation: newPop.generation - 1,
        best: newPop.bestFitness,
        avg: newPop.avgFitness,
        worst: newPop.worstFitness,
      });

      setGeneration(newPop.generation);
      setBestFitness(newPop.bestFitness);
      setAvgFitness(newPop.avgFitness);

      drawChart();
      drawNetwork(sorted[0].network);

      // Reset for next generation
      isEvaluatingRef.current = false;
      liveStepRef.current = 0;
    }

    animFrameRef.current = requestAnimationFrame(runLoop);
  }, [drawSimulation, drawChart, drawNetwork, initLiveStates]);

  // ─────────────────────────────────────────────────────
  // Controls
  // ─────────────────────────────────────────────────────

  const handleStart = useCallback(() => {
    if (playStateRef.current === "idle") {
      const currentTask = taskRef.current;
      if (currentTask === "flappy") {
        resetSharedPipes();
      }
      const topology = TASK_CONFIGS[currentTask].topology;
      const pop = createPopulation(topology, paramsRef.current.populationSize);
      populationRef.current = pop;
      historyRef.current = [];
      snapshotsRef.current = [];
      isEvaluatingRef.current = false;
      liveStepRef.current = 0;
      setGeneration(0);
      setBestFitness(0);
      setAvgFitness(0);
    }

    setPlayState("running");
    playStateRef.current = "running";
    animFrameRef.current = requestAnimationFrame(runLoop);
  }, [runLoop]);

  const handlePause = useCallback(() => {
    setPlayState("paused");
    playStateRef.current = "paused";
    cancelAnimationFrame(animFrameRef.current);
  }, []);

  const handleReset = useCallback(() => {
    setPlayState("idle");
    playStateRef.current = "idle";
    cancelAnimationFrame(animFrameRef.current);
    cancelAnimationFrame(replayFrameRef.current);
    populationRef.current = null;
    historyRef.current = [];
    snapshotsRef.current = [];
    liveStatesRef.current = [];
    liveNetsRef.current = [];
    isEvaluatingRef.current = false;
    liveStepRef.current = 0;
    setGeneration(0);
    setBestFitness(0);
    setAvgFitness(0);
    setIsReplaying(false);

    // Clear canvases
    for (const ref of [simCanvasRef, chartCanvasRef, netCanvasRef]) {
      const c = ref.current;
      if (c) {
        const ctx = c.getContext("2d");
        if (ctx) {
          const dpr = window.devicePixelRatio || 1;
          const rect = c.getBoundingClientRect();
          c.width = rect.width * dpr;
          c.height = rect.height * dpr;
          ctx.scale(dpr, dpr);
          ctx.fillStyle = getColor(c, "--color-bg", "#09090b");
          ctx.fillRect(0, 0, rect.width, rect.height);
        }
      }
    }
  }, []);

  const handleTaskChange = useCallback(
    (newTask: TaskType) => {
      handleReset();
      setTask(newTask);
      taskRef.current = newTask;
    },
    [handleReset],
  );

  // ─────────────────────────────────────────────────────
  // Replay
  // ─────────────────────────────────────────────────────

  const handleReplay = useCallback(
    (genIdx: number) => {
      const snapshots = snapshotsRef.current;
      if (genIdx < 0 || genIdx >= snapshots.length) return;

      // Pause main loop if running
      if (playStateRef.current === "running") {
        setPlayState("paused");
        playStateRef.current = "paused";
        cancelAnimationFrame(animFrameRef.current);
      }

      setIsReplaying(true);
      cancelAnimationFrame(replayFrameRef.current);

      const snap = snapshots[genIdx];
      const currentTask = taskRef.current;
      const topology = TASK_CONFIGS[currentTask].topology;

      const net = createNetworkFromWeights(topology, new Float64Array(snap.bestWeights));

      if (currentTask === "flappy") {
        resetSharedPipes();
      }

      let state: TaskState;
      switch (currentTask) {
        case "cart-pole":
          state = createCartPoleState();
          break;
        case "flappy":
          state = createFlappyState();
          break;
        case "maze":
          state = createMazeState();
          break;
      }

      liveStatesRef.current = [state];
      liveNetsRef.current = [net];
      viewModeRef.current = "best";
      setViewMode("best");

      drawNetwork(net);

      const maxSteps = TASK_CONFIGS[currentTask].maxSteps;
      let step = 0;

      const replayLoop = () => {
        if (step >= maxSteps) {
          setIsReplaying(false);
          return;
        }

        const s = liveStatesRef.current[0];
        let done = false;
        switch (currentTask) {
          case "cart-pole": {
            const cs = s as CartPoleState;
            if (!cs.alive) done = true;
            else stepCartPole(cs, net);
            break;
          }
          case "flappy": {
            const fs = s as FlappyState;
            if (!fs.alive) done = true;
            else stepFlappy(fs, net);
            break;
          }
          case "maze": {
            const ms = s as MazeState;
            if (!ms.alive && !ms.reachedGoal) done = true;
            else if (ms.reachedGoal) done = true;
            else stepMaze(ms, net);
            break;
          }
        }

        drawSimulation();
        step++;

        if (done) {
          setIsReplaying(false);
          return;
        }

        replayFrameRef.current = requestAnimationFrame(replayLoop);
      };

      replayFrameRef.current = requestAnimationFrame(replayLoop);
    },
    [drawSimulation, drawNetwork],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      cancelAnimationFrame(replayFrameRef.current);
    };
  }, []);

  // ─────────────────────────────────────────────────────
  // Param update helper
  // ─────────────────────────────────────────────────────

  const updateParam = useCallback(
    (key: keyof GAParams, value: number) => {
      setParams((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  // ─────────────────────────────────────────────────────
  // Speed labels
  // ─────────────────────────────────────────────────────

  const SPEED_OPTIONS = [
    { value: 1, label: "1x" },
    { value: 2, label: "2x" },
    { value: 5, label: "5x" },
    { value: 10, label: "10x" },
    { value: 0, label: "Max" },
  ];

  // ─────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────

  const taskKeys: TaskType[] = ["cart-pole", "flappy", "maze"];

  return (
    <div ref={containerRef} class="space-y-4">
      {/* Task tabs */}
      <div class="flex flex-wrap gap-2">
        {taskKeys.map((t) => (
          <button
            key={t}
            onClick={() => handleTaskChange(t)}
            class={`rounded-lg border px-4 py-2 text-sm font-medium transition-all ${
              task === t
                ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)]/40 hover:text-[var(--color-text)]"
            }`}
            disabled={playState === "running"}
          >
            {TASK_CONFIGS[t].label}
          </button>
        ))}
        <span class="self-center text-xs text-[var(--color-text-muted)]">
          {TASK_CONFIGS[task].description}
        </span>
      </div>

      {/* Main layout: simulation + controls */}
      <div class="grid gap-4 lg:grid-cols-[1fr_280px]">
        {/* Left: canvases */}
        <div class="space-y-3">
          {/* Simulation canvas */}
          <div class="overflow-hidden rounded-xl border border-[var(--color-border)]">
            <canvas
              ref={simCanvasRef}
              class="h-[320px] w-full sm:h-[360px]"
              style={{ display: "block" }}
            />
          </div>

          {/* Bottom row: chart + network */}
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="overflow-hidden rounded-xl border border-[var(--color-border)]">
              <canvas
                ref={chartCanvasRef}
                class="h-[180px] w-full"
                style={{ display: "block" }}
              />
            </div>
            <div class="overflow-hidden rounded-xl border border-[var(--color-border)]">
              <canvas
                ref={netCanvasRef}
                class="h-[180px] w-full"
                style={{ display: "block" }}
              />
            </div>
          </div>

          {/* Controls bar */}
          <div class="flex flex-wrap items-center gap-2">
            {playState === "running" ? (
              <button
                onClick={handlePause}
                class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)]"
              >
                Pause
              </button>
            ) : (
              <button
                onClick={handleStart}
                class="rounded-lg border border-[var(--color-primary)] bg-[var(--color-primary)]/10 px-4 py-2 text-sm font-medium text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary)]/20"
              >
                {playState === "idle" ? "Start Evolution" : "Resume"}
              </button>
            )}

            <button
              onClick={handleReset}
              class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)]"
            >
              Reset
            </button>

            <div class="mx-2 h-6 w-px bg-[var(--color-border)]" />

            {/* View mode */}
            <div class="flex rounded-lg border border-[var(--color-border)] overflow-hidden">
              {(["best", "all"] as ViewMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setViewMode(m);
                    viewModeRef.current = m;
                    if (populationRef.current && playStateRef.current !== "idle") {
                      initLiveStates(populationRef.current, taskRef.current);
                    }
                  }}
                  class={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    viewMode === m
                      ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`}
                >
                  {m === "best" ? "Watch Best" : "Watch All"}
                </button>
              ))}
            </div>

            <div class="mx-2 h-6 w-px bg-[var(--color-border)]" />

            {/* Speed */}
            <div class="flex items-center gap-1">
              <span class="text-xs text-[var(--color-text-muted)]">Speed:</span>
              {SPEED_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setSpeed(opt.value);
                    speedRef.current = opt.value;
                  }}
                  class={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                    speed === opt.value
                      ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Stats bar */}
          <div class="flex flex-wrap gap-4 text-xs">
            <div>
              <span class="text-[var(--color-text-muted)]">Generation: </span>
              <span class="font-mono text-[var(--color-heading)]">
                {generation}
              </span>
            </div>
            <div>
              <span class="text-[var(--color-text-muted)]">Best Fitness: </span>
              <span class="font-mono text-[var(--color-primary)]">
                {bestFitness.toFixed(1)}
              </span>
            </div>
            <div>
              <span class="text-[var(--color-text-muted)]">Avg Fitness: </span>
              <span class="font-mono text-[var(--color-text)]">
                {avgFitness.toFixed(1)}
              </span>
            </div>
            <div>
              <span class="text-[var(--color-text-muted)]">Population: </span>
              <span class="font-mono text-[var(--color-text)]">
                {params.populationSize}
              </span>
            </div>
            <div>
              <span class="text-[var(--color-text-muted)]">Topology: </span>
              <span class="font-mono text-[var(--color-text)]">
                {TASK_CONFIGS[task].topology.layers.join("-")}
              </span>
            </div>
          </div>

          {/* Generation replay slider */}
          {snapshotsRef.current.length > 0 && (
            <div class="flex items-center gap-3">
              <span class="text-xs text-[var(--color-text-muted)]">
                Replay Gen:
              </span>
              <input
                type="range"
                min={0}
                max={snapshotsRef.current.length - 1}
                value={replayGen}
                onInput={(e) => {
                  const val = parseInt(
                    (e.target as HTMLInputElement).value,
                    10,
                  );
                  setReplayGen(val);
                }}
                class="flex-1 accent-[var(--color-primary)]"
              />
              <button
                onClick={() => handleReplay(replayGen)}
                disabled={isReplaying}
                class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-50"
              >
                {isReplaying ? "Replaying..." : `Watch Gen ${replayGen}`}
              </button>
            </div>
          )}
        </div>

        {/* Right: parameters panel */}
        <div class="space-y-3">
          <div class="rounded-xl border border-[var(--color-border)] p-4">
            <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
              Evolution Parameters
            </h3>

            <div class="space-y-3">
              <ParamSlider
                label="Population Size"
                value={params.populationSize}
                min={20}
                max={500}
                step={10}
                onChange={(v) => updateParam("populationSize", v)}
                disabled={playState !== "idle"}
              />

              <ParamSlider
                label="Mutation Rate"
                value={params.mutationRate}
                min={0.01}
                max={0.5}
                step={0.01}
                onChange={(v) => updateParam("mutationRate", v)}
                format={(v) => (v * 100).toFixed(0) + "%"}
              />

              <ParamSlider
                label="Mutation Strength"
                value={params.mutationStrength}
                min={0.05}
                max={1.0}
                step={0.05}
                onChange={(v) => updateParam("mutationStrength", v)}
                format={(v) => v.toFixed(2)}
              />

              <ParamSlider
                label="Crossover Rate"
                value={params.crossoverRate}
                min={0.1}
                max={1.0}
                step={0.05}
                onChange={(v) => updateParam("crossoverRate", v)}
                format={(v) => (v * 100).toFixed(0) + "%"}
              />

              <ParamSlider
                label="Elitism Count"
                value={params.elitismCount}
                min={0}
                max={10}
                step={1}
                onChange={(v) => updateParam("elitismCount", v)}
              />

              <ParamSlider
                label="Tournament Size"
                value={params.tournamentSize}
                min={2}
                max={10}
                step={1}
                onChange={(v) => updateParam("tournamentSize", v)}
              />
            </div>
          </div>

          {/* Task info */}
          <div class="rounded-xl border border-[var(--color-border)] p-4">
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
              About This Task
            </h3>
            <div class="space-y-2 text-xs text-[var(--color-text-muted)] leading-relaxed">
              {task === "cart-pole" && (
                <>
                  <p>
                    A neural network controls a cart to balance a pole. Inputs:
                    cart position, velocity, pole angle, angular velocity.
                    Outputs: push left or right.
                  </p>
                  <p>
                    Fitness = steps survived + bonuses for staying centered and
                    upright. Max fitness ~1020 (1000 steps + bonuses).
                  </p>
                </>
              )}
              {task === "flappy" && (
                <>
                  <p>
                    A neural network controls a bird navigating through pipes.
                    Inputs: bird y, velocity, distance to next pipe, gap center.
                    Output: flap or not.
                  </p>
                  <p>
                    Fitness = distance traveled. All agents face the same pipe
                    layout each generation.
                  </p>
                </>
              )}
              {task === "maze" && (
                <>
                  <p>
                    Agents navigate a 10x10 maze using 5 ray-cast distance
                    sensors plus goal direction. Outputs: turn and move forward.
                  </p>
                  <p>
                    Fitness = closeness to goal + big bonus for reaching it.
                    Green circle = goal. Lines = sensor rays.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Parameter slider sub-component
// ─────────────────────────────────────────────────────────

interface ParamSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  format?: (v: number) => string;
}

function ParamSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  disabled,
  format,
}: ParamSliderProps) {
  const display = format ? format(value) : String(value);
  return (
    <div>
      <div class="flex items-center justify-between text-xs">
        <span class="text-[var(--color-text-muted)]">{label}</span>
        <span class="font-mono text-[var(--color-heading)]">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(e) => {
          onChange(parseFloat((e.target as HTMLInputElement).value));
        }}
        disabled={disabled}
        class="mt-1 w-full accent-[var(--color-primary)] disabled:opacity-50"
      />
    </div>
  );
}
