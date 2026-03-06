// ─────────────────────────────────────────────────────────
// Reinforcement Learning Agents
// ─────────────────────────────────────────────────────────

// ── Q-Table ──

export function createQTable(numStates: number, numActions: number): Float64Array {
  return new Float64Array(numStates * numActions);
}

export function getQ(table: Float64Array, numActions: number, state: number, action: number): number {
  return table[state * numActions + action];
}

export function setQ(table: Float64Array, numActions: number, state: number, action: number, value: number): void {
  table[state * numActions + action] = value;
}

export function getMaxQ(table: Float64Array, numActions: number, state: number): number {
  let maxVal = -Infinity;
  for (let a = 0; a < numActions; a++) {
    const v = table[state * numActions + a];
    if (v > maxVal) maxVal = v;
  }
  return maxVal;
}

export function getGreedyAction(table: Float64Array, numActions: number, state: number): number {
  let bestAction = 0;
  let bestVal = -Infinity;
  for (let a = 0; a < numActions; a++) {
    const v = table[state * numActions + a];
    if (v > bestVal) {
      bestVal = v;
      bestAction = a;
    }
  }
  return bestAction;
}

export function getExpectedQ(table: Float64Array, numActions: number, state: number, epsilon: number): number {
  const greedyAction = getGreedyAction(table, numActions, state);
  let expected = 0;
  for (let a = 0; a < numActions; a++) {
    const prob = (a === greedyAction)
      ? (1 - epsilon + epsilon / numActions)
      : (epsilon / numActions);
    expected += prob * getQ(table, numActions, state, a);
  }
  return expected;
}

// ── Epsilon-Greedy Action Selection ──

export function selectAction(
  table: Float64Array,
  numActions: number,
  state: number,
  epsilon: number,
): number {
  if (Math.random() < epsilon) {
    return Math.floor(Math.random() * numActions);
  }
  return getGreedyAction(table, numActions, state);
}

// ── Algorithm Types ──

export const AlgorithmId = {
  QLearning: "q-learning",
  SARSA: "sarsa",
  ExpectedSARSA: "expected-sarsa",
  MonteCarlo: "monte-carlo",
} as const;
export type AlgorithmId = (typeof AlgorithmId)[keyof typeof AlgorithmId];

export interface AlgorithmDef {
  id: AlgorithmId;
  name: string;
  description: string;
}

export const ALGORITHMS: AlgorithmDef[] = [
  {
    id: AlgorithmId.QLearning,
    name: "Q-Learning",
    description: "Off-policy TD: updates Q toward max future Q regardless of action taken.",
  },
  {
    id: AlgorithmId.SARSA,
    name: "SARSA",
    description: "On-policy TD: updates Q toward the action actually taken next.",
  },
  {
    id: AlgorithmId.ExpectedSARSA,
    name: "Expected SARSA",
    description: "Updates Q toward the expected value over all actions under current policy.",
  },
  {
    id: AlgorithmId.MonteCarlo,
    name: "Monte Carlo",
    description: "First-visit MC: updates Q using actual returns at end of episode.",
  },
];

// ── Training Parameters ──

export interface TrainParams {
  alpha: number;       // learning rate
  gamma: number;       // discount factor
  epsilon: number;     // exploration rate
  epsilonDecay: number; // multiply epsilon by this each episode
  epsilonMin: number;  // minimum epsilon
  maxStepsPerEpisode: number;
}

export const DEFAULT_PARAMS: TrainParams = {
  alpha: 0.1,
  gamma: 0.99,
  epsilon: 1.0,
  epsilonDecay: 0.995,
  epsilonMin: 0.01,
  maxStepsPerEpisode: 200,
};

// ── Episode Trace (for replay) ──

export interface EpisodeStep {
  state: number;
  action: number;
  reward: number;
  nextState: number;
  done: boolean;
}

// ── Episode Result ──

export interface EpisodeResult {
  totalReward: number;
  steps: number;
  reachedGoal: boolean;
  trace: EpisodeStep[];
}

// ── Step Function type (environment abstraction) ──

export type StepFn = (state: number, action: number) => {
  nextState: number;
  reward: number;
  done: boolean;
};

// ── Q-Learning Episode ──

export function runQLearningEpisode(
  qTable: Float64Array,
  numActions: number,
  startState: number,
  stepFn: StepFn,
  params: TrainParams,
  epsilon: number,
  recordTrace: boolean,
): EpisodeResult {
  let state = startState;
  let totalReward = 0;
  const trace: EpisodeStep[] = [];
  let reachedGoal = false;

  for (let t = 0; t < params.maxStepsPerEpisode; t++) {
    const action = selectAction(qTable, numActions, state, epsilon);
    const { nextState, reward, done } = stepFn(state, action);

    // Q-Learning update: Q(s,a) += alpha * (r + gamma * max_a' Q(s',a') - Q(s,a))
    const currentQ = getQ(qTable, numActions, state, action);
    const maxNextQ = done ? 0 : getMaxQ(qTable, numActions, nextState);
    const newQ = currentQ + params.alpha * (reward + params.gamma * maxNextQ - currentQ);
    setQ(qTable, numActions, state, action, newQ);

    if (recordTrace) {
      trace.push({ state, action, reward, nextState, done });
    }

    totalReward += reward;
    if (done) {
      reachedGoal = reward > 0;
      break;
    }
    state = nextState;
  }

  return { totalReward, steps: trace.length || params.maxStepsPerEpisode, reachedGoal, trace };
}

// ── SARSA Episode ──

export function runSARSAEpisode(
  qTable: Float64Array,
  numActions: number,
  startState: number,
  stepFn: StepFn,
  params: TrainParams,
  epsilon: number,
  recordTrace: boolean,
): EpisodeResult {
  let state = startState;
  let action = selectAction(qTable, numActions, state, epsilon);
  let totalReward = 0;
  const trace: EpisodeStep[] = [];
  let reachedGoal = false;
  let steps = 0;

  for (let t = 0; t < params.maxStepsPerEpisode; t++) {
    const { nextState, reward, done } = stepFn(state, action);
    const nextAction = done ? 0 : selectAction(qTable, numActions, nextState, epsilon);

    // SARSA update: Q(s,a) += alpha * (r + gamma * Q(s',a') - Q(s,a))
    const currentQ = getQ(qTable, numActions, state, action);
    const nextQ = done ? 0 : getQ(qTable, numActions, nextState, nextAction);
    const newQ = currentQ + params.alpha * (reward + params.gamma * nextQ - currentQ);
    setQ(qTable, numActions, state, action, newQ);

    if (recordTrace) {
      trace.push({ state, action, reward, nextState, done });
    }

    totalReward += reward;
    steps++;
    if (done) {
      reachedGoal = reward > 0;
      break;
    }
    state = nextState;
    action = nextAction;
  }

  return { totalReward, steps, reachedGoal, trace };
}

// ── Expected SARSA Episode ──

export function runExpectedSARSAEpisode(
  qTable: Float64Array,
  numActions: number,
  startState: number,
  stepFn: StepFn,
  params: TrainParams,
  epsilon: number,
  recordTrace: boolean,
): EpisodeResult {
  let state = startState;
  let totalReward = 0;
  const trace: EpisodeStep[] = [];
  let reachedGoal = false;
  let steps = 0;

  for (let t = 0; t < params.maxStepsPerEpisode; t++) {
    const action = selectAction(qTable, numActions, state, epsilon);
    const { nextState, reward, done } = stepFn(state, action);

    // Expected SARSA: Q(s,a) += alpha * (r + gamma * E[Q(s', .)] - Q(s,a))
    const currentQ = getQ(qTable, numActions, state, action);
    const expectedNextQ = done ? 0 : getExpectedQ(qTable, numActions, nextState, epsilon);
    const newQ = currentQ + params.alpha * (reward + params.gamma * expectedNextQ - currentQ);
    setQ(qTable, numActions, state, action, newQ);

    if (recordTrace) {
      trace.push({ state, action, reward, nextState, done });
    }

    totalReward += reward;
    steps++;
    if (done) {
      reachedGoal = reward > 0;
      break;
    }
    state = nextState;
  }

  return { totalReward, steps, reachedGoal, trace };
}

// ── Monte Carlo (First-Visit) Episode ──

export function runMonteCarloEpisode(
  qTable: Float64Array,
  numActions: number,
  startState: number,
  stepFn: StepFn,
  params: TrainParams,
  epsilon: number,
  visitCounts: Float64Array,
  recordTrace: boolean,
): EpisodeResult {
  let state = startState;
  let totalReward = 0;
  const trace: EpisodeStep[] = [];
  let reachedGoal = false;

  // Generate full episode
  for (let t = 0; t < params.maxStepsPerEpisode; t++) {
    const action = selectAction(qTable, numActions, state, epsilon);
    const { nextState, reward, done } = stepFn(state, action);

    trace.push({ state, action, reward, nextState, done });
    totalReward += reward;

    if (done) {
      reachedGoal = reward > 0;
      break;
    }
    state = nextState;
  }

  // First-visit MC update
  const visited = new Set<string>();
  let G = 0;

  for (let t = trace.length - 1; t >= 0; t--) {
    G = params.gamma * G + trace[t].reward;
    const key = `${trace[t].state},${trace[t].action}`;
    if (!visited.has(key)) {
      visited.add(key);
      const idx = trace[t].state * numActions + trace[t].action;
      visitCounts[idx]++;
      // Incremental mean update
      qTable[idx] += (G - qTable[idx]) / visitCounts[idx];
    }
  }

  return {
    totalReward,
    steps: trace.length,
    reachedGoal,
    trace: recordTrace ? trace : [],
  };
}

// ── Bandit Agent ──

export interface BanditState {
  estimates: number[];
  counts: number[];
  totalReward: number;
  totalPulls: number;
  regretHistory: number[];
  rewardHistory: number[];
}

export function createBanditState(numArms: number): BanditState {
  return {
    estimates: new Array(numArms).fill(0),
    counts: new Array(numArms).fill(0),
    totalReward: 0,
    totalPulls: 0,
    regretHistory: [],
    rewardHistory: [],
  };
}

export function banditSelectArm(state: BanditState, epsilon: number): number {
  if (Math.random() < epsilon) {
    return Math.floor(Math.random() * state.estimates.length);
  }
  let bestArm = 0;
  let bestVal = -Infinity;
  for (let i = 0; i < state.estimates.length; i++) {
    if (state.estimates[i] > bestVal) {
      bestVal = state.estimates[i];
      bestArm = i;
    }
  }
  return bestArm;
}

export function banditUpdate(state: BanditState, arm: number, reward: number, bestMean: number): void {
  state.counts[arm]++;
  state.totalPulls++;
  // Incremental mean update
  state.estimates[arm] += (reward - state.estimates[arm]) / state.counts[arm];
  state.totalReward += reward;
  state.rewardHistory.push(reward);
  // Regret = best possible mean reward - actual reward
  const prevRegret = state.regretHistory.length > 0
    ? state.regretHistory[state.regretHistory.length - 1]
    : 0;
  state.regretHistory.push(prevRegret + (bestMean - reward));
}
