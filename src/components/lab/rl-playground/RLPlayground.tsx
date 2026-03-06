import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import {
  CellKind,
  Action,
  NUM_ACTIONS,
  ACTION_DELTAS,
  createGridWorld,
  createTaxiEnvironment,
  createBanditEnvironment,
  TAXI_NUM_ACTIONS,
  type Environment,
  type TaxiEnvironment,
  type BanditEnvironment,
} from "./environments";
import {
  createQTable,
  getQ,
  getGreedyAction,
  getMaxQ,
  runQLearningEpisode,
  runSARSAEpisode,
  runExpectedSARSAEpisode,
  runMonteCarloEpisode,
  createBanditState,
  banditSelectArm,
  banditUpdate,
  AlgorithmId,
  ALGORITHMS,
  DEFAULT_PARAMS,
  type TrainParams,
  type EpisodeResult,
  type BanditState,
} from "./agents";
import { MAP_PRESETS, createCustomGrid } from "./presets";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

const TabId = {
  Bandit: "bandit",
  GridWorld: "gridworld",
  Taxi: "taxi",
} as const;
type TabId = (typeof TabId)[keyof typeof TabId];

const VizMode = {
  QTable: "qtable",
  Policy: "policy",
  Visits: "visits",
} as const;
type VizMode = (typeof VizMode)[keyof typeof VizMode];

const SpeedMode = {
  Slow: "slow",
  Medium: "medium",
  Fast: "fast",
} as const;
type SpeedMode = (typeof SpeedMode)[keyof typeof SpeedMode];

interface EpisodeStats {
  totalEpisodes: number;
  totalSteps: number;
  rewardHistory: number[];
  stepsHistory: number[];
  successCount: number;
  currentEpsilon: number;
}

// ─────────────────────────────────────────────────────────
// CSS Variable Helper
// ─────────────────────────────────────────────────────────

function getCSSVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

// ─────────────────────────────────────────────────────────
// Color helpers for heatmaps
// ─────────────────────────────────────────────────────────

function interpolateColor(t: number): string {
  // Cold (blue) to hot (red) via green/yellow
  const clamped = Math.max(0, Math.min(1, t));
  let r: number, g: number, b: number;
  if (clamped < 0.25) {
    const s = clamped / 0.25;
    r = 0; g = Math.round(s * 128); b = Math.round(128 + s * 127);
  } else if (clamped < 0.5) {
    const s = (clamped - 0.25) / 0.25;
    r = 0; g = Math.round(128 + s * 127); b = Math.round(255 - s * 255);
  } else if (clamped < 0.75) {
    const s = (clamped - 0.5) / 0.25;
    r = Math.round(s * 255); g = 255; b = 0;
  } else {
    const s = (clamped - 0.75) / 0.25;
    r = 255; g = Math.round(255 - s * 255); b = 0;
  }
  return `rgb(${r},${g},${b})`;
}

function visitColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const alpha = 0.1 + clamped * 0.8;
  return `rgba(79, 143, 247, ${alpha})`;
}

// ─────────────────────────────────────────────────────────
// Arrow drawing
// ─────────────────────────────────────────────────────────

function drawArrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  action: number,
  cellSize: number,
  color: string,
): void {
  const len = cellSize * 0.3;
  const headLen = cellSize * 0.1;
  const [dr, dc] = ACTION_DELTAS[action as Action];
  const ex = cx + dc * len;
  const ey = cy + dr * len;

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(ex, ey);

  // Arrowhead
  const angle = Math.atan2(ey - cy, ex - cx);
  ctx.lineTo(
    ex - headLen * Math.cos(angle - Math.PI / 6),
    ey - headLen * Math.sin(angle - Math.PI / 6),
  );
  ctx.moveTo(ex, ey);
  ctx.lineTo(
    ex - headLen * Math.cos(angle + Math.PI / 6),
    ey - headLen * Math.sin(angle + Math.PI / 6),
  );
  ctx.stroke();
}

// ─────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────

export default function RLPlayground() {
  // ── State ──
  const [activeTab, setActiveTab] = useState<TabId>(TabId.GridWorld);
  const [algorithm, setAlgorithm] = useState<AlgorithmId>(AlgorithmId.QLearning);
  const [vizMode, setVizMode] = useState<VizMode>(VizMode.QTable);
  const [speed, setSpeed] = useState<SpeedMode>(SpeedMode.Medium);
  const [presetId, setPresetId] = useState("open-5x5");

  // Grid world state
  const [gridRows, setGridRows] = useState(5);
  const [gridCols, setGridCols] = useState(5);
  const [grid, setGrid] = useState<CellKind[]>(() => MAP_PRESETS.find(p => p.id === "open-5x5")!.grid);
  const [editTool, setEditTool] = useState<CellKind>(CellKind.Wall);
  const [isCustom, setIsCustom] = useState(false);

  // Training params
  const [params, setParams] = useState<TrainParams>({ ...DEFAULT_PARAMS });

  // RL state
  const [stats, setStats] = useState<EpisodeStats>({
    totalEpisodes: 0,
    totalSteps: 0,
    rewardHistory: [],
    stepsHistory: [],
    successCount: 0,
    currentEpsilon: DEFAULT_PARAMS.epsilon,
  });

  const [isTraining, setIsTraining] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [hoveredCell, setHoveredCell] = useState<number | null>(null);

  // Bandit state
  const [numArms, setNumArms] = useState(5);

  // Refs
  const gridCanvasRef = useRef<HTMLCanvasElement>(null);
  const chartCanvasRef = useRef<HTMLCanvasElement>(null);
  const qTableRef = useRef<Float64Array | null>(null);
  const visitCountsRef = useRef<Float64Array | null>(null);
  const mcVisitCountsRef = useRef<Float64Array | null>(null);
  const envRef = useRef<Environment | null>(null);
  const taxiEnvRef = useRef<TaxiEnvironment | null>(null);
  const banditEnvRef = useRef<BanditEnvironment | null>(null);
  const banditStateRef = useRef<BanditState | null>(null);
  const statsRef = useRef(stats);
  const paramsRef = useRef(params);
  const trainingRef = useRef(false);
  const animFrameRef = useRef<number>(0);
  const replayPosRef = useRef<number>(-1);
  const replayTraceRef = useRef<{ state: number; action: number }[]>([]);

  statsRef.current = stats;
  paramsRef.current = params;

  // ── Initialize environment ──
  const initEnv = useCallback(() => {
    if (activeTab === TabId.GridWorld) {
      const env = createGridWorld(gridRows, gridCols, grid);
      envRef.current = env;
      qTableRef.current = createQTable(env.numStates, env.numActions);
      visitCountsRef.current = new Float64Array(env.numStates);
      mcVisitCountsRef.current = new Float64Array(env.numStates * env.numActions);
    } else if (activeTab === TabId.Taxi) {
      const taxiEnv = createTaxiEnvironment();
      taxiEnvRef.current = taxiEnv;
      qTableRef.current = createQTable(taxiEnv.numStates, taxiEnv.numActions);
      visitCountsRef.current = new Float64Array(taxiEnv.numStates);
      mcVisitCountsRef.current = new Float64Array(taxiEnv.numStates * taxiEnv.numActions);
    } else {
      const banditEnv = createBanditEnvironment(numArms);
      banditEnvRef.current = banditEnv;
      banditStateRef.current = createBanditState(numArms);
    }
    setStats({
      totalEpisodes: 0,
      totalSteps: 0,
      rewardHistory: [],
      stepsHistory: [],
      successCount: 0,
      currentEpsilon: paramsRef.current.epsilon,
    });
    replayPosRef.current = -1;
    replayTraceRef.current = [];
    setIsReplaying(false);
  }, [activeTab, gridRows, gridCols, grid, numArms]);

  useEffect(() => {
    initEnv();
  }, [initEnv]);

  // ── Load preset ──
  const loadPreset = useCallback((id: string) => {
    const preset = MAP_PRESETS.find(p => p.id === id);
    if (!preset) return;
    setPresetId(id);
    setGridRows(preset.rows);
    setGridCols(preset.cols);
    setGrid([...preset.grid]);
    setIsCustom(false);
  }, []);

  // ── Reset Q-table ──
  const resetQTable = useCallback(() => {
    if (activeTab === TabId.Bandit) {
      if (banditEnvRef.current) {
        banditStateRef.current = createBanditState(banditEnvRef.current.numArms);
      }
    } else {
      const numStates = activeTab === TabId.GridWorld
        ? (envRef.current?.numStates ?? 0)
        : (taxiEnvRef.current?.numStates ?? 0);
      const numActions = activeTab === TabId.GridWorld ? NUM_ACTIONS : TAXI_NUM_ACTIONS;
      qTableRef.current = createQTable(numStates, numActions);
      visitCountsRef.current = new Float64Array(numStates);
      mcVisitCountsRef.current = new Float64Array(numStates * numActions);
    }
    setStats({
      totalEpisodes: 0,
      totalSteps: 0,
      rewardHistory: [],
      stepsHistory: [],
      successCount: 0,
      currentEpsilon: paramsRef.current.epsilon,
    });
    replayPosRef.current = -1;
    replayTraceRef.current = [];
    setIsReplaying(false);
  }, [activeTab]);

  // ── Run training episodes ──
  const trainEpisodes = useCallback((count: number) => {
    if (activeTab === TabId.Bandit) {
      trainBanditEpisodes(count);
      return;
    }

    const qTable = qTableRef.current;
    const visits = visitCountsRef.current;
    const mcVisits = mcVisitCountsRef.current;
    if (!qTable || !visits || !mcVisits) return;

    const isGridWorld = activeTab === TabId.GridWorld;
    const env = isGridWorld ? envRef.current : null;
    const taxiEnv = isGridWorld ? null : taxiEnvRef.current;
    if (!env && !taxiEnv) return;

    const numActions = isGridWorld ? NUM_ACTIONS : TAXI_NUM_ACTIONS;
    const p = paramsRef.current;
    let currentStats = { ...statsRef.current };
    let epsilon = currentStats.currentEpsilon;

    for (let i = 0; i < count; i++) {
      let startState: number;
      let stepFn: (state: number, action: number) => { nextState: number; reward: number; done: boolean };

      if (isGridWorld && env) {
        startState = env.reset();
        stepFn = (s, a) => env.step(s, a as Action);
      } else if (taxiEnv) {
        const ts = taxiEnv.reset();
        startState = taxiEnv.encodeState(ts);
        stepFn = (s, a) => {
          const decoded = taxiEnv.decodeState(s);
          const result = taxiEnv.step(decoded, a as import("./environments").TaxiAction);
          return {
            nextState: taxiEnv.encodeState(result.nextState),
            reward: result.reward,
            done: result.done,
          };
        };
      } else {
        return;
      }

      let result: EpisodeResult;
      const shouldRecord = count <= 10;

      switch (algorithm) {
        case AlgorithmId.QLearning:
          result = runQLearningEpisode(qTable, numActions, startState, stepFn, p, epsilon, shouldRecord);
          break;
        case AlgorithmId.SARSA:
          result = runSARSAEpisode(qTable, numActions, startState, stepFn, p, epsilon, shouldRecord);
          break;
        case AlgorithmId.ExpectedSARSA:
          result = runExpectedSARSAEpisode(qTable, numActions, startState, stepFn, p, epsilon, shouldRecord);
          break;
        case AlgorithmId.MonteCarlo:
          result = runMonteCarloEpisode(qTable, numActions, startState, stepFn, p, epsilon, mcVisits, shouldRecord);
          break;
        default:
          result = runQLearningEpisode(qTable, numActions, startState, stepFn, p, epsilon, shouldRecord);
      }

      // Update visit counts
      if (shouldRecord) {
        for (const step of result.trace) {
          visits[step.state]++;
        }
      } else {
        // Fast mode: just increment visit count for start state as approximation
        visits[startState]++;
      }

      currentStats.totalEpisodes++;
      currentStats.totalSteps += result.steps;
      currentStats.rewardHistory.push(result.totalReward);
      currentStats.stepsHistory.push(result.steps);
      if (result.reachedGoal) currentStats.successCount++;

      // Epsilon decay
      epsilon = Math.max(p.epsilonMin, epsilon * p.epsilonDecay);
      currentStats.currentEpsilon = epsilon;
    }

    setStats(currentStats);
  }, [activeTab, algorithm]);

  // ── Bandit training ──
  const trainBanditEpisodes = useCallback((count: number) => {
    const bEnv = banditEnvRef.current;
    const bState = banditStateRef.current;
    if (!bEnv || !bState) return;

    const p = paramsRef.current;
    const bestMean = Math.max(...bEnv.arms.map(a => a.trueMean));

    for (let i = 0; i < count; i++) {
      const arm = banditSelectArm(bState, p.epsilon);
      const reward = bEnv.pull(arm);
      banditUpdate(bState, arm, reward, bestMean);
    }

    setStats(prev => ({
      ...prev,
      totalEpisodes: bState.totalPulls,
      totalSteps: bState.totalPulls,
      rewardHistory: [...bState.rewardHistory],
      stepsHistory: [],
      successCount: 0,
      currentEpsilon: p.epsilon,
    }));
  }, []);

  // ── Auto-train loop ──
  const startAutoTrain = useCallback(() => {
    if (trainingRef.current) return;
    trainingRef.current = true;
    setIsTraining(true);

    const batchSizes: Record<SpeedMode, number> = {
      [SpeedMode.Slow]: 1,
      [SpeedMode.Medium]: 10,
      [SpeedMode.Fast]: 100,
    };

    const delays: Record<SpeedMode, number> = {
      [SpeedMode.Slow]: 200,
      [SpeedMode.Medium]: 50,
      [SpeedMode.Fast]: 0,
    };

    function tick() {
      if (!trainingRef.current) return;
      const batch = batchSizes[speed] ?? 10;
      trainEpisodes(batch);
      const delay = delays[speed] ?? 50;
      if (delay > 0) {
        setTimeout(() => {
          if (trainingRef.current) animFrameRef.current = requestAnimationFrame(tick);
        }, delay);
      } else {
        animFrameRef.current = requestAnimationFrame(tick);
      }
    }

    animFrameRef.current = requestAnimationFrame(tick);
  }, [speed, trainEpisodes]);

  const stopAutoTrain = useCallback(() => {
    trainingRef.current = false;
    setIsTraining(false);
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      trainingRef.current = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // ── Watch best path (greedy replay) ──
  const watchBestPath = useCallback(() => {
    if (activeTab !== TabId.GridWorld) return;
    const env = envRef.current;
    const qTable = qTableRef.current;
    if (!env || !qTable) return;

    const trace: { state: number; action: number }[] = [];
    let state = env.reset();
    const visited = new Set<number>();

    for (let t = 0; t < 200; t++) {
      if (env.isTerminal(state) || visited.has(state)) break;
      visited.add(state);
      const action = getGreedyAction(qTable, NUM_ACTIONS, state);
      trace.push({ state, action });
      const result = env.step(state, action as Action);
      state = result.nextState;
      if (result.done) {
        trace.push({ state: result.nextState, action: -1 });
        break;
      }
    }

    replayTraceRef.current = trace;
    replayPosRef.current = 0;
    setIsReplaying(true);

    function advanceReplay() {
      if (replayPosRef.current < 0) return;
      replayPosRef.current++;
      if (replayPosRef.current >= replayTraceRef.current.length) {
        replayPosRef.current = -1;
        setIsReplaying(false);
        return;
      }
      setTimeout(advanceReplay, 200);
    }
    setTimeout(advanceReplay, 200);
  }, [activeTab]);

  // ── Grid cell click handler (custom map editing) ──
  const handleGridClick = useCallback((row: number, col: number) => {
    if (!isCustom) return;
    setGrid(prev => {
      const next = [...prev];
      const idx = row * gridCols + col;
      const current = next[idx];
      // Don't overwrite start/goal
      if (current === CellKind.Start || current === CellKind.Goal) return prev;
      next[idx] = current === editTool ? CellKind.Empty : editTool;
      return next;
    });
  }, [isCustom, gridCols, editTool]);

  // ── Draw grid world canvas ──
  const drawGridWorld = useCallback(() => {
    const canvas = gridCanvasRef.current;
    const env = envRef.current;
    const qTable = qTableRef.current;
    const visits = visitCountsRef.current;
    if (!canvas || !env || !qTable || !visits) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const cellW = w / env.cols;
    const cellH = h / env.rows;

    const bgColor = getCSSVar("--color-bg", "#09090b");
    const surfaceColor = getCSSVar("--color-surface", "#111111");
    const borderColor = getCSSVar("--color-border", "#27272a");
    const headingColor = getCSSVar("--color-heading", "#ffffff");
    const primaryColor = getCSSVar("--color-primary", "#4f8ff7");

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    // Find min/max Q values for normalization
    let minQ = Infinity;
    let maxQ = -Infinity;
    let maxVisits = 0;

    for (let s = 0; s < env.numStates; s++) {
      if (env.grid[s] === CellKind.Wall) continue;
      const mq = getMaxQ(qTable, NUM_ACTIONS, s);
      if (isFinite(mq)) {
        if (mq < minQ) minQ = mq;
        if (mq > maxQ) maxQ = mq;
      }
      if (visits[s] > maxVisits) maxVisits = visits[s];
    }
    if (!isFinite(minQ)) minQ = 0;
    if (!isFinite(maxQ)) maxQ = 0;
    const qRange = maxQ - minQ || 1;

    // Draw cells
    for (let r = 0; r < env.rows; r++) {
      for (let c = 0; c < env.cols; c++) {
        const s = env.posToState(r, c);
        const cell = env.grid[s];
        const x = c * cellW;
        const y = r * cellH;

        // Base cell color
        if (cell === CellKind.Wall) {
          ctx.fillStyle = "#374151";
        } else if (cell === CellKind.Hole) {
          ctx.fillStyle = "#991b1b";
        } else if (cell === CellKind.Goal) {
          ctx.fillStyle = "#854d0e";
        } else if (cell === CellKind.Start) {
          ctx.fillStyle = "#166534";
        } else if (cell === CellKind.Slippery) {
          ctx.fillStyle = "#1e3a5f";
        } else {
          ctx.fillStyle = surfaceColor;
        }
        ctx.fillRect(x, y, cellW, cellH);

        // Overlay based on viz mode
        if (cell !== CellKind.Wall) {
          if (vizMode === VizMode.QTable) {
            const maxVal = getMaxQ(qTable, NUM_ACTIONS, s);
            if (isFinite(maxVal) && qRange > 0) {
              const t = (maxVal - minQ) / qRange;
              ctx.fillStyle = interpolateColor(t);
              ctx.globalAlpha = 0.5;
              ctx.fillRect(x, y, cellW, cellH);
              ctx.globalAlpha = 1;
            }
          } else if (vizMode === VizMode.Visits && maxVisits > 0) {
            const t = visits[s] / maxVisits;
            ctx.fillStyle = visitColor(t);
            ctx.fillRect(x, y, cellW, cellH);
          } else if (vizMode === VizMode.Policy && stats.totalEpisodes > 0) {
            const bestAction = getGreedyAction(qTable, NUM_ACTIONS, s);
            if (!env.isTerminal(s)) {
              drawArrow(ctx, x + cellW / 2, y + cellH / 2, bestAction, Math.min(cellW, cellH), primaryColor);
            }
          }
        }

        // Cell border
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, cellW, cellH);

        // Cell label
        if (cell === CellKind.Start) {
          ctx.fillStyle = "#4ade80";
          ctx.font = `bold ${Math.min(cellW, cellH) * 0.4}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("S", x + cellW / 2, y + cellH / 2);
        } else if (cell === CellKind.Goal) {
          ctx.fillStyle = "#fbbf24";
          ctx.font = `bold ${Math.min(cellW, cellH) * 0.4}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("G", x + cellW / 2, y + cellH / 2);
        } else if (cell === CellKind.Hole) {
          ctx.fillStyle = "#f87171";
          ctx.font = `bold ${Math.min(cellW, cellH) * 0.35}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("H", x + cellW / 2, y + cellH / 2);
        } else if (cell === CellKind.Slippery) {
          ctx.fillStyle = "#60a5fa";
          ctx.font = `${Math.min(cellW, cellH) * 0.25}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("~", x + cellW / 2, y + cellH / 2);
        }
      }
    }

    // Draw replay agent
    if (replayPosRef.current >= 0 && replayPosRef.current < replayTraceRef.current.length) {
      const step = replayTraceRef.current[replayPosRef.current];
      const [ar, ac] = env.stateToPos(step.state);
      const ax = ac * cellW + cellW / 2;
      const ay = ar * cellH + cellH / 2;
      const radius = Math.min(cellW, cellH) * 0.3;

      ctx.beginPath();
      ctx.arc(ax, ay, radius, 0, Math.PI * 2);
      ctx.fillStyle = primaryColor;
      ctx.fill();
      ctx.strokeStyle = headingColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Hover tooltip
    if (hoveredCell !== null && hoveredCell >= 0 && hoveredCell < env.numStates && vizMode === VizMode.QTable) {
      const [hr, hc] = env.stateToPos(hoveredCell);
      const tooltipX = hc * cellW + cellW + 5;
      const tooltipY = hr * cellH;

      ctx.fillStyle = "rgba(0,0,0,0.85)";
      ctx.fillRect(tooltipX, tooltipY, 120, 70);
      ctx.fillStyle = headingColor;
      ctx.font = "11px monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";

      const actionNames = ["Up", "Down", "Left", "Right"];
      for (let a = 0; a < NUM_ACTIONS; a++) {
        const qVal = getQ(qTable, NUM_ACTIONS, hoveredCell, a);
        const best = a === getGreedyAction(qTable, NUM_ACTIONS, hoveredCell);
        ctx.fillStyle = best ? "#4ade80" : headingColor;
        ctx.fillText(
          `${actionNames[a]}: ${qVal.toFixed(3)}`,
          tooltipX + 5,
          tooltipY + 5 + a * 16,
        );
      }
    }
  }, [vizMode, hoveredCell, stats.totalEpisodes]);

  // ── Draw learning curves ──
  const drawChart = useCallback(() => {
    const canvas = chartCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const bgColor = getCSSVar("--color-bg", "#09090b");
    const borderColor = getCSSVar("--color-border", "#27272a");
    const textMutedColor = getCSSVar("--color-text-muted", "#a1a1aa");
    const primaryColor = getCSSVar("--color-primary", "#4f8ff7");
    const accentColor = getCSSVar("--color-accent", "#34d399");

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    if (activeTab === TabId.Bandit) {
      drawBanditCharts(ctx, w, h, borderColor, textMutedColor, primaryColor, accentColor);
      return;
    }

    const { rewardHistory, stepsHistory } = statsRef.current;
    if (rewardHistory.length === 0) {
      ctx.fillStyle = textMutedColor;
      ctx.font = "13px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Train some episodes to see learning curves", w / 2, h / 2);
      return;
    }

    // Compute smoothed values (rolling average of 50)
    const windowSize = Math.min(50, Math.max(1, Math.floor(rewardHistory.length / 10)));
    const smoothReward = smooth(rewardHistory, windowSize);
    const smoothSteps = smooth(stepsHistory, windowSize);

    // Split canvas into two charts
    const chartH = (h - 40) / 2;
    const margin = { left: 50, right: 10, top: 20 };

    // Chart 1: Reward per episode
    drawLineChart(ctx, smoothReward, margin.left, margin.top, w - margin.left - margin.right, chartH - 10, {
      color: primaryColor,
      title: "Avg Reward / Episode",
      borderColor,
      textColor: textMutedColor,
    });

    // Chart 2: Steps per episode
    drawLineChart(ctx, smoothSteps, margin.left, margin.top + chartH + 10, w - margin.left - margin.right, chartH - 10, {
      color: accentColor,
      title: "Avg Steps / Episode",
      borderColor,
      textColor: textMutedColor,
    });
  }, [activeTab]);

  // ── Bandit charts ──
  const drawBanditCharts = useCallback((
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    borderColor: string,
    textColor: string,
    primaryColor: string,
    accentColor: string,
  ) => {
    const bEnv = banditEnvRef.current;
    const bState = banditStateRef.current;
    if (!bEnv || !bState) {
      ctx.fillStyle = textColor;
      ctx.font = "13px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Pull some arms to see results", w / 2, h / 2);
      return;
    }

    const chartH = (h - 50) / 2;
    const margin = { left: 50, right: 10, top: 15 };

    // Chart 1: Estimated vs True values bar chart
    const barAreaW = w - margin.left - margin.right;
    const barAreaH = chartH - 15;
    const barWidth = Math.min(40, barAreaW / (bEnv.numArms * 2.5));
    const groupWidth = barWidth * 2.5;
    const offsetX = margin.left + (barAreaW - groupWidth * bEnv.numArms) / 2;

    // Find range
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (const arm of bEnv.arms) {
      if (arm.trueMean < minVal) minVal = arm.trueMean;
      if (arm.trueMean > maxVal) maxVal = arm.trueMean;
    }
    for (const est of bState.estimates) {
      if (est < minVal) minVal = est;
      if (est > maxVal) maxVal = est;
    }
    minVal = Math.min(minVal - 0.5, 0);
    maxVal = Math.max(maxVal + 0.5, 0);
    const valRange = maxVal - minVal || 1;

    // Title
    ctx.fillStyle = textColor;
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("Estimated vs True Values", margin.left, margin.top);

    const chartTop = margin.top + 18;
    const zeroY = chartTop + barAreaH * (maxVal / valRange);

    // Zero line
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin.left, zeroY);
    ctx.lineTo(w - margin.right, zeroY);
    ctx.stroke();

    // Bars
    for (let i = 0; i < bEnv.numArms; i++) {
      const x = offsetX + i * groupWidth;
      const trueH = (bEnv.arms[i].trueMean / valRange) * barAreaH;
      const estH = (bState.estimates[i] / valRange) * barAreaH;

      // True value bar
      ctx.fillStyle = accentColor;
      ctx.globalAlpha = 0.5;
      if (trueH >= 0) {
        ctx.fillRect(x, zeroY - trueH, barWidth, trueH);
      } else {
        ctx.fillRect(x, zeroY, barWidth, -trueH);
      }
      ctx.globalAlpha = 1;

      // Estimated value bar
      ctx.fillStyle = primaryColor;
      if (estH >= 0) {
        ctx.fillRect(x + barWidth + 2, zeroY - estH, barWidth, estH);
      } else {
        ctx.fillRect(x + barWidth + 2, zeroY, barWidth, -estH);
      }

      // Arm label
      ctx.fillStyle = textColor;
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(`#${i + 1}`, x + barWidth, chartTop + barAreaH + 3);

      // Pull count
      ctx.fillText(`${bState.counts[i]}`, x + barWidth, chartTop + barAreaH + 14);
    }

    // Legend
    ctx.fillStyle = accentColor;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(margin.left, chartTop + barAreaH + 3, 10, 10);
    ctx.globalAlpha = 1;
    ctx.fillStyle = textColor;
    ctx.font = "10px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("True", margin.left + 13, chartTop + barAreaH + 3);

    ctx.fillStyle = primaryColor;
    ctx.fillRect(margin.left + 50, chartTop + barAreaH + 3, 10, 10);
    ctx.fillStyle = textColor;
    ctx.fillText("Estimated", margin.left + 63, chartTop + barAreaH + 3);

    // Chart 2: Cumulative regret
    if (bState.regretHistory.length > 0) {
      drawLineChart(ctx, bState.regretHistory, margin.left, chartH + 35, w - margin.left - margin.right, chartH - 15, {
        color: "#f87171",
        title: "Cumulative Regret",
        borderColor,
        textColor,
      });
    }
  }, []);

  // ── Canvas mouse handler ──
  const handleCanvasMouseMove = useCallback((e: MouseEvent) => {
    if (activeTab !== TabId.GridWorld) return;
    const canvas = gridCanvasRef.current;
    const env = envRef.current;
    if (!canvas || !env) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const col = Math.floor((x * scaleX) / (canvas.width / env.cols));
    const row = Math.floor((y * scaleY) / (canvas.height / env.rows));

    if (row >= 0 && row < env.rows && col >= 0 && col < env.cols) {
      setHoveredCell(env.posToState(row, col));
    } else {
      setHoveredCell(null);
    }
  }, [activeTab]);

  const handleCanvasClick = useCallback((e: MouseEvent) => {
    if (activeTab !== TabId.GridWorld || !isCustom) return;
    const canvas = gridCanvasRef.current;
    const env = envRef.current;
    if (!canvas || !env) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const col = Math.floor((x * scaleX) / (canvas.width / env.cols));
    const row = Math.floor((y * scaleY) / (canvas.height / env.rows));

    if (row >= 0 && row < env.rows && col >= 0 && col < env.cols) {
      handleGridClick(row, col);
    }
  }, [activeTab, isCustom, handleGridClick]);

  const handleCanvasMouseLeave = useCallback(() => {
    setHoveredCell(null);
  }, []);

  // ── Render loop ──
  useEffect(() => {
    let raf = 0;
    function render() {
      if (activeTab === TabId.GridWorld) {
        drawGridWorld();
      }
      drawChart();
      raf = requestAnimationFrame(render);
    }
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [activeTab, drawGridWorld, drawChart]);

  // ── Param updater ──
  const updateParam = useCallback(<K extends keyof TrainParams>(key: K, value: TrainParams[K]) => {
    setParams(prev => ({ ...prev, [key]: value }));
  }, []);

  // ── Custom grid size ──
  const handleCustomGrid = useCallback((rows: number, cols: number) => {
    setIsCustom(true);
    setPresetId("custom");
    setGridRows(rows);
    setGridCols(cols);
    setGrid(createCustomGrid(rows, cols));
  }, []);

  // ── Convergence check ──
  const isConverged = stats.rewardHistory.length >= 100 && (() => {
    const last100 = stats.rewardHistory.slice(-100);
    const avg = last100.reduce((a, b) => a + b, 0) / 100;
    const variance = last100.reduce((a, b) => a + (b - avg) ** 2, 0) / 100;
    return variance < 1;
  })();

  const avgReward100 = stats.rewardHistory.length > 0
    ? (stats.rewardHistory.slice(-Math.min(100, stats.rewardHistory.length))
        .reduce((a, b) => a + b, 0) / Math.min(100, stats.rewardHistory.length)).toFixed(2)
    : "0";

  const successRate = stats.totalEpisodes > 0
    ? ((stats.successCount / stats.totalEpisodes) * 100).toFixed(1)
    : "0";

  // ── Render ──
  return (
    <div class="space-y-4">
      {/* Tab bar */}
      <div class="flex gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
        {([
          [TabId.Bandit, "Multi-Armed Bandit"],
          [TabId.GridWorld, "Grid World"],
          [TabId.Taxi, "Taxi"],
        ] as [TabId, string][]).map(([id, label]) => (
          <button
            key={id}
            class={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === id
                ? "bg-[var(--color-primary)] text-white"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-heading)]"
            }`}
            onClick={() => {
              stopAutoTrain();
              setActiveTab(id);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
        {/* Main area */}
        <div class="space-y-4">
          {/* Algorithm + preset selector */}
          <div class="flex flex-wrap gap-3">
            {activeTab !== TabId.Bandit && (
              <div class="flex flex-col gap-1">
                <label class="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  Algorithm
                </label>
                <select
                  class="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text)]"
                  value={algorithm}
                  onChange={(e) => setAlgorithm((e.target as HTMLSelectElement).value as AlgorithmId)}
                >
                  {ALGORITHMS.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
            )}

            {activeTab === TabId.GridWorld && (
              <div class="flex flex-col gap-1">
                <label class="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  Map
                </label>
                <select
                  class="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text)]"
                  value={presetId}
                  onChange={(e) => {
                    const val = (e.target as HTMLSelectElement).value;
                    if (val === "custom") {
                      handleCustomGrid(5, 5);
                    } else {
                      loadPreset(val);
                    }
                  }}
                >
                  {MAP_PRESETS.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                  <option value="custom">Custom (click to edit)</option>
                </select>
              </div>
            )}

            {activeTab === TabId.Bandit && (
              <div class="flex flex-col gap-1">
                <label class="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  Arms
                </label>
                <select
                  class="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text)]"
                  value={numArms}
                  onChange={(e) => setNumArms(Number((e.target as HTMLSelectElement).value))}
                >
                  {[3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                    <option key={n} value={n}>{n} arms</option>
                  ))}
                </select>
              </div>
            )}

            {activeTab !== TabId.Bandit && (
              <div class="flex flex-col gap-1">
                <label class="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  Visualization
                </label>
                <div class="flex gap-1">
                  {([
                    [VizMode.QTable, "Q-Table"],
                    [VizMode.Policy, "Policy"],
                    [VizMode.Visits, "Visits"],
                  ] as [VizMode, string][]).map(([id, label]) => (
                    <button
                      key={id}
                      class={`rounded-md px-2 py-1.5 text-[10px] font-medium transition-colors ${
                        vizMode === id
                          ? "bg-[var(--color-primary)]/20 text-[var(--color-primary)]"
                          : "text-[var(--color-text-muted)] hover:text-[var(--color-heading)]"
                      }`}
                      onClick={() => setVizMode(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Algorithm description */}
          {activeTab !== TabId.Bandit && (
            <p class="text-xs text-[var(--color-text-muted)]">
              {ALGORITHMS.find(a => a.id === algorithm)?.description}
            </p>
          )}
          {activeTab === TabId.Bandit && (
            <p class="text-xs text-[var(--color-text-muted)]">
              Epsilon-greedy strategy: explore random arms with probability epsilon, otherwise exploit the arm with highest estimated reward.
            </p>
          )}

          {/* Custom grid edit toolbar */}
          {activeTab === TabId.GridWorld && isCustom && (
            <div class="flex flex-wrap items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
              <span class="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                Paint:
              </span>
              {([
                [CellKind.Wall, "Wall", "#374151"],
                [CellKind.Hole, "Hole", "#991b1b"],
                [CellKind.Slippery, "Ice", "#1e3a5f"],
              ] as [CellKind, string, string][]).map(([kind, label, color]) => (
                <button
                  key={kind}
                  class={`rounded px-2 py-1 text-[10px] font-medium ${
                    editTool === kind ? "ring-2 ring-[var(--color-primary)]" : ""
                  }`}
                  style={{ backgroundColor: color, color: "#fff" }}
                  onClick={() => setEditTool(kind)}
                >
                  {label}
                </button>
              ))}
              <div class="ml-auto flex gap-2">
                <label class="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]">
                  Size:
                  <select
                    class="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5 text-[10px] text-[var(--color-text)]"
                    value={`${gridRows}x${gridCols}`}
                    onChange={(e) => {
                      const [r, c] = (e.target as HTMLSelectElement).value.split("x").map(Number);
                      handleCustomGrid(r, c);
                    }}
                  >
                    {["5x5", "6x6", "7x7", "8x8", "9x9", "10x10"].map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          )}

          {/* Canvas area */}
          {activeTab === TabId.GridWorld && (
            <div class="overflow-hidden rounded-lg border border-[var(--color-border)]">
              <canvas
                ref={gridCanvasRef}
                width={500}
                height={Math.round(500 * (gridRows / gridCols))}
                class="w-full cursor-crosshair"
                style={{ imageRendering: "pixelated" }}
                onMouseMove={handleCanvasMouseMove}
                onMouseLeave={handleCanvasMouseLeave}
                onClick={handleCanvasClick}
              />
            </div>
          )}

          {activeTab === TabId.Taxi && (
            <TaxiGrid
              taxiEnv={taxiEnvRef.current}
              qTable={qTableRef.current}
              numEpisodes={stats.totalEpisodes}
              vizMode={vizMode}
            />
          )}

          {/* Learning curves */}
          <div class="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <canvas
              ref={chartCanvasRef}
              width={500}
              height={280}
              class="w-full"
            />
          </div>
        </div>

        {/* Right sidebar: controls + stats */}
        <div class="space-y-4">
          {/* Training controls */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
              Controls
            </h3>
            <div class="grid grid-cols-2 gap-2">
              <button
                class="rounded-md bg-[var(--color-primary)] px-2 py-1.5 text-[10px] font-semibold text-white transition-opacity hover:opacity-90"
                onClick={() => trainEpisodes(1)}
                disabled={isTraining}
              >
                Train 1
              </button>
              <button
                class="rounded-md bg-[var(--color-primary)] px-2 py-1.5 text-[10px] font-semibold text-white transition-opacity hover:opacity-90"
                onClick={() => trainEpisodes(10)}
                disabled={isTraining}
              >
                Train 10
              </button>
              <button
                class="rounded-md bg-[var(--color-primary)] px-2 py-1.5 text-[10px] font-semibold text-white transition-opacity hover:opacity-90"
                onClick={() => trainEpisodes(100)}
                disabled={isTraining}
              >
                Train 100
              </button>
              <button
                class="rounded-md bg-[var(--color-primary)] px-2 py-1.5 text-[10px] font-semibold text-white transition-opacity hover:opacity-90"
                onClick={() => trainEpisodes(1000)}
                disabled={isTraining}
              >
                Train 1000
              </button>
            </div>

            <div class="mt-3 flex gap-2">
              <button
                class={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-semibold transition-colors ${
                  isTraining
                    ? "bg-red-600 text-white"
                    : "bg-[var(--color-accent)] text-black"
                }`}
                onClick={isTraining ? stopAutoTrain : startAutoTrain}
              >
                {isTraining ? "Stop Auto" : "Auto Train"}
              </button>
              <button
                class="flex-1 rounded-md border border-[var(--color-border)] px-2 py-1.5 text-[10px] font-semibold text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-heading)]"
                onClick={resetQTable}
              >
                Reset
              </button>
            </div>

            {activeTab === TabId.GridWorld && (
              <button
                class="mt-2 w-full rounded-md border border-[var(--color-border)] px-2 py-1.5 text-[10px] font-semibold text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-heading)]"
                onClick={watchBestPath}
                disabled={isReplaying || stats.totalEpisodes === 0}
              >
                {isReplaying ? "Replaying..." : "Watch Best Path"}
              </button>
            )}

            {/* Speed */}
            <div class="mt-3">
              <label class="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                Auto-Train Speed
              </label>
              <div class="mt-1 flex gap-1">
                {([
                  [SpeedMode.Slow, "Slow"],
                  [SpeedMode.Medium, "Med"],
                  [SpeedMode.Fast, "Fast"],
                ] as [SpeedMode, string][]).map(([id, label]) => (
                  <button
                    key={id}
                    class={`flex-1 rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                      speed === id
                        ? "bg-[var(--color-primary)]/20 text-[var(--color-primary)]"
                        : "text-[var(--color-text-muted)] hover:text-[var(--color-heading)]"
                    }`}
                    onClick={() => setSpeed(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Parameters */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
              Parameters
            </h3>
            <div class="space-y-3">
              {activeTab !== TabId.Bandit && (
                <>
                  <ParamSlider
                    label="Learning Rate (alpha)"
                    value={params.alpha}
                    min={0.01}
                    max={1}
                    step={0.01}
                    onChange={(v) => updateParam("alpha", v)}
                  />
                  <ParamSlider
                    label="Discount (gamma)"
                    value={params.gamma}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(v) => updateParam("gamma", v)}
                  />
                </>
              )}
              <ParamSlider
                label="Epsilon"
                value={params.epsilon}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => updateParam("epsilon", v)}
              />
              {activeTab !== TabId.Bandit && (
                <>
                  <ParamSlider
                    label="Epsilon Decay"
                    value={params.epsilonDecay}
                    min={0.9}
                    max={1}
                    step={0.001}
                    onChange={(v) => updateParam("epsilonDecay", v)}
                  />
                  <ParamSlider
                    label="Max Steps/Episode"
                    value={params.maxStepsPerEpisode}
                    min={50}
                    max={1000}
                    step={50}
                    onChange={(v) => updateParam("maxStepsPerEpisode", v)}
                  />
                </>
              )}
            </div>
          </div>

          {/* Stats panel */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
              Statistics
            </h3>
            <div class="space-y-1.5 text-xs">
              <StatRow label="Episodes" value={stats.totalEpisodes.toLocaleString()} />
              {activeTab !== TabId.Bandit && (
                <>
                  <StatRow label="Total Steps" value={stats.totalSteps.toLocaleString()} />
                  <StatRow label="Avg Reward (100)" value={avgReward100} />
                  <StatRow label="Success Rate" value={`${successRate}%`} />
                  <StatRow label="Current Epsilon" value={stats.currentEpsilon.toFixed(4)} />
                  <StatRow
                    label="Convergence"
                    value={isConverged ? "Converged" : "Learning..."}
                    highlight={isConverged}
                  />
                </>
              )}
              {activeTab === TabId.Bandit && banditStateRef.current && (
                <>
                  <StatRow
                    label="Total Reward"
                    value={banditStateRef.current.totalReward.toFixed(2)}
                  />
                  <StatRow
                    label="Avg Reward"
                    value={
                      banditStateRef.current.totalPulls > 0
                        ? (banditStateRef.current.totalReward / banditStateRef.current.totalPulls).toFixed(3)
                        : "0"
                    }
                  />
                  <StatRow
                    label="Cumulative Regret"
                    value={
                      banditStateRef.current.regretHistory.length > 0
                        ? banditStateRef.current.regretHistory[banditStateRef.current.regretHistory.length - 1].toFixed(2)
                        : "0"
                    }
                  />
                </>
              )}
            </div>
          </div>

          {/* Color legend */}
          {activeTab === TabId.GridWorld && (
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
                Legend
              </h3>
              <div class="grid grid-cols-2 gap-1.5 text-[10px]">
                <LegendItem color="#166534" label="Start (S)" textColor="#4ade80" />
                <LegendItem color="#854d0e" label="Goal (G)" textColor="#fbbf24" />
                <LegendItem color="#374151" label="Wall" textColor="#9ca3af" />
                <LegendItem color="#991b1b" label="Hole (H)" textColor="#f87171" />
                <LegendItem color="#1e3a5f" label="Slippery (~)" textColor="#60a5fa" />
              </div>
            </div>
          )}
        </div>
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
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div class="flex items-center justify-between">
        <label class="text-[10px] text-[var(--color-text-muted)]">{label}</label>
        <span class="text-[10px] font-mono text-[var(--color-heading)]">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        class="mt-1 w-full accent-[var(--color-primary)]"
        onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
      />
    </div>
  );
}

function StatRow({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div class="flex items-center justify-between">
      <span class="text-[var(--color-text-muted)]">{label}</span>
      <span class={highlight ? "font-semibold text-[var(--color-accent)]" : "font-mono text-[var(--color-heading)]"}>
        {value}
      </span>
    </div>
  );
}

function LegendItem({
  color,
  label,
  textColor,
}: {
  color: string;
  label: string;
  textColor: string;
}) {
  return (
    <div class="flex items-center gap-1.5">
      <div class="h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
      <span style={{ color: textColor }}>{label}</span>
    </div>
  );
}

// ── Taxi Grid (rendered as HTML table since it's simpler) ──

function TaxiGrid({
  taxiEnv,
  qTable,
  numEpisodes,
  vizMode,
}: {
  taxiEnv: TaxiEnvironment | null;
  qTable: Float64Array | null;
  numEpisodes: number;
  vizMode: VizMode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !taxiEnv) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const cellW = w / 5;
    const cellH = h / 5;

    const bgColor = getCSSVar("--color-bg", "#09090b");
    const surfaceColor = getCSSVar("--color-surface", "#111111");
    const borderColor = getCSSVar("--color-border", "#27272a");
    const primaryColor = getCSSVar("--color-primary", "#4f8ff7");

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    // Draw grid
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const x = c * cellW;
        const y = r * cellH;

        ctx.fillStyle = surfaceColor;
        ctx.fillRect(x, y, cellW, cellH);
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, cellW, cellH);
      }
    }

    // Draw pickup locations
    const locColors = ["#ef4444", "#22c55e", "#eab308", "#3b82f6"];
    for (let i = 0; i < taxiEnv.pickupLocations.length; i++) {
      const [lr, lc] = taxiEnv.pickupLocations[i];
      const x = lc * cellW;
      const y = lr * cellH;
      ctx.fillStyle = locColors[i];
      ctx.globalAlpha = 0.3;
      ctx.fillRect(x, y, cellW, cellH);
      ctx.globalAlpha = 1;
      ctx.fillStyle = locColors[i];
      ctx.font = `bold ${cellW * 0.35}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(taxiEnv.locationNames[i], x + cellW / 2, y + cellH / 2);
    }

    // Draw walls (thick lines between cells)
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 4;
    for (const wall of taxiEnv.walls) {
      const [from, to] = wall.split("-");
      const [r1, c1] = from.split(",").map(Number);
      const [r2, c2] = to.split(",").map(Number);

      if (c2 === c1 + 1) {
        // Vertical wall between (r1,c1) and (r1,c2)
        const x = c2 * cellW;
        const y = r1 * cellH;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + cellH);
        ctx.stroke();
      }
    }

    // Q-value overlay: aggregate over passenger/destination dimensions
    if (qTable && numEpisodes > 0 && vizMode === VizMode.Policy) {
      // Show most common best action for each grid position
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          const actionCounts = new Float64Array(TAXI_NUM_ACTIONS);
          for (let p = 0; p < 5; p++) {
            for (let d = 0; d < 4; d++) {
              const s = ((r * 5 + c) * 5 + p) * 4 + d;
              const bestA = getGreedyAction(qTable, TAXI_NUM_ACTIONS, s);
              if (bestA < 4) actionCounts[bestA]++;
            }
          }
          let bestMovement = 0;
          let bestCount = 0;
          for (let a = 0; a < 4; a++) {
            if (actionCounts[a] > bestCount) {
              bestCount = actionCounts[a];
              bestMovement = a;
            }
          }
          if (bestCount > 0) {
            const cx = c * cellW + cellW / 2;
            const cy = r * cellH + cellH / 2;
            drawArrow(ctx, cx, cy, bestMovement, Math.min(cellW, cellH), primaryColor);
          }
        }
      }
    }
  }, [taxiEnv, qTable, numEpisodes, vizMode]);

  return (
    <div class="space-y-2">
      <div class="overflow-hidden rounded-lg border border-[var(--color-border)]">
        <canvas
          ref={canvasRef}
          width={400}
          height={400}
          class="w-full"
        />
      </div>
      <p class="text-[10px] text-[var(--color-text-muted)]">
        5x5 taxi grid. R/G/Y/B = pickup/dropoff locations. Yellow lines = walls. Actions: 4 movement + Pickup + Dropoff.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Utility: Smoothing
// ─────────────────────────────────────────────────────────

function smooth(data: number[], windowSize: number): number[] {
  if (data.length === 0) return [];
  if (windowSize <= 1) return data;

  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (i >= windowSize) sum -= data[i - windowSize];
    const count = Math.min(i + 1, windowSize);
    result.push(sum / count);
  }
  return result;
}

// ─────────────────────────────────────────────────────────
// Utility: Line chart drawing
// ─────────────────────────────────────────────────────────

function drawLineChart(
  ctx: CanvasRenderingContext2D,
  data: number[],
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { color: string; title: string; borderColor: string; textColor: string },
): void {
  if (data.length === 0) return;

  // Title
  ctx.fillStyle = opts.textColor;
  ctx.font = "11px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(opts.title, x, y);

  const chartY = y + 16;
  const chartH = h - 16;

  // Find range
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (const v of data) {
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
  }

  if (minVal === maxVal) {
    minVal -= 1;
    maxVal += 1;
  }

  const valRange = maxVal - minVal;

  // Axes
  ctx.strokeStyle = opts.borderColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, chartY);
  ctx.lineTo(x, chartY + chartH);
  ctx.lineTo(x + w, chartY + chartH);
  ctx.stroke();

  // Y-axis labels
  ctx.fillStyle = opts.textColor;
  ctx.font = "9px monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText(maxVal.toFixed(1), x - 3, chartY);
  ctx.textBaseline = "bottom";
  ctx.fillText(minVal.toFixed(1), x - 3, chartY + chartH);

  // Draw line
  ctx.strokeStyle = opts.color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();

  const step = data.length > w ? Math.ceil(data.length / w) : 1;
  let first = true;

  for (let i = 0; i < data.length; i += step) {
    const px = x + (i / (data.length - 1 || 1)) * w;
    const py = chartY + chartH - ((data[i] - minVal) / valRange) * chartH;
    if (first) {
      ctx.moveTo(px, py);
      first = false;
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.stroke();

  // Current value label
  const lastVal = data[data.length - 1];
  ctx.fillStyle = opts.color;
  ctx.font = "10px monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText(lastVal.toFixed(2), x + w, chartY);
}
