// ─────────────────────────────────────────────────────────
// Task definitions for neuroevolution playground
// Each task: physics/sim step, fitness evaluation, rendering
// ─────────────────────────────────────────────────────────

import { type NeuralNetwork, forward } from "./nn";
import type { NetworkTopology } from "./nn";

// ─────────────────────────────────────────────────────────
// Common types
// ─────────────────────────────────────────────────────────

export type TaskType = "cart-pole" | "flappy" | "maze";

export interface TaskConfig {
  label: string;
  topology: NetworkTopology;
  maxSteps: number;
  description: string;
}

export const TASK_CONFIGS: Record<TaskType, TaskConfig> = {
  "cart-pole": {
    label: "Cart-Pole",
    topology: { layers: [4, 8, 2] },
    maxSteps: 1000,
    description: "Balance a pole on a moving cart",
  },
  flappy: {
    label: "Flappy Bird",
    topology: { layers: [4, 6, 1] },
    maxSteps: 2000,
    description: "Navigate through gaps in pipes",
  },
  maze: {
    label: "Maze Runner",
    topology: { layers: [7, 10, 3] },
    maxSteps: 500,
    description: "Navigate a maze using ray-cast sensors",
  },
};

// ─────────────────────────────────────────────────────────
// Cart-Pole Task
// ─────────────────────────────────────────────────────────

export interface CartPoleState {
  x: number;        // cart position
  v: number;        // cart velocity
  theta: number;    // pole angle (rad, 0 = upright)
  omega: number;    // pole angular velocity
  alive: boolean;
  steps: number;
}

const CART_POLE = {
  gravity: 9.8,
  cartMass: 1.0,
  poleMass: 0.1,
  poleLength: 0.5,     // half-length
  forceMag: 10.0,
  dt: 0.02,
  xLimit: 2.4,
  thetaLimit: Math.PI / 6,  // 30 degrees
} as const;

export function createCartPoleState(): CartPoleState {
  return {
    x: 0,
    v: 0,
    theta: (Math.random() - 0.5) * 0.1,
    omega: 0,
    alive: true,
    steps: 0,
  };
}

export function stepCartPole(state: CartPoleState, net: NeuralNetwork): void {
  if (!state.alive) return;

  // Normalize inputs to ~[-1, 1]
  const inputs = [
    state.x / CART_POLE.xLimit,
    state.v / 3,
    state.theta / CART_POLE.thetaLimit,
    state.omega / 3,
  ];

  const output = forward(net, inputs);
  // Two outputs: interpret as push-left vs push-right
  const force =
    output[0] > output[1]
      ? -CART_POLE.forceMag
      : CART_POLE.forceMag;

  // Cart-pole physics (Euler integration)
  const { gravity, cartMass, poleMass, poleLength, dt } = CART_POLE;
  const totalMass = cartMass + poleMass;
  const cosTheta = Math.cos(state.theta);
  const sinTheta = Math.sin(state.theta);

  const temp =
    (force + poleMass * poleLength * state.omega * state.omega * sinTheta) /
    totalMass;
  const alphaNum =
    gravity * sinTheta - cosTheta * temp;
  const alphaDen =
    poleLength * (4.0 / 3.0 - (poleMass * cosTheta * cosTheta) / totalMass);
  const alpha = alphaNum / alphaDen;
  const accel = temp - (poleMass * poleLength * alpha * cosTheta) / totalMass;

  // Update state
  state.x += state.v * dt;
  state.v += accel * dt;
  state.theta += state.omega * dt;
  state.omega += alpha * dt;
  state.steps++;

  // Check termination
  if (
    Math.abs(state.x) > CART_POLE.xLimit ||
    Math.abs(state.theta) > CART_POLE.thetaLimit
  ) {
    state.alive = false;
  }
}

export function cartPoleFitness(state: CartPoleState): number {
  // Reward: steps survived + bonus for staying centered and upright
  const centerBonus = 1 - Math.abs(state.x) / CART_POLE.xLimit;
  const angleBonus = 1 - Math.abs(state.theta) / CART_POLE.thetaLimit;
  return state.steps + centerBonus * 10 + angleBonus * 10;
}

// ─────────────────────────────────────────────────────────
// Flappy Bird Task
// ─────────────────────────────────────────────────────────

export interface Pipe {
  x: number;
  gapY: number;
  gapHeight: number;
  passed: boolean;
}

export interface FlappyState {
  y: number;         // bird vertical position
  vy: number;        // bird vertical velocity
  alive: boolean;
  steps: number;
  distance: number;  // horizontal distance traveled
  pipes: Pipe[];
  nextPipeIdx: number;
}

const FLAPPY = {
  gravity: 0.4,
  flapForce: -6,
  speed: 2.5,
  birdX: 60,
  worldHeight: 400,
  worldWidth: 400,
  pipeWidth: 40,
  pipeSpacing: 180,
  gapHeight: 90,
  birdRadius: 8,
} as const;

function generatePipes(): Pipe[] {
  const pipes: Pipe[] = [];
  const margin = 60;
  for (let i = 0; i < 50; i++) {
    pipes.push({
      x: 250 + i * FLAPPY.pipeSpacing,
      gapY:
        margin +
        Math.random() * (FLAPPY.worldHeight - 2 * margin - FLAPPY.gapHeight),
      gapHeight: FLAPPY.gapHeight,
      passed: false,
    });
  }
  return pipes;
}

let sharedPipes: Pipe[] | null = null;

export function resetSharedPipes(): void {
  sharedPipes = generatePipes();
}

export function createFlappyState(): FlappyState {
  if (!sharedPipes) sharedPipes = generatePipes();
  return {
    y: FLAPPY.worldHeight / 2,
    vy: 0,
    alive: true,
    steps: 0,
    distance: 0,
    pipes: sharedPipes.map((p) => ({ ...p, passed: false })),
    nextPipeIdx: 0,
  };
}

export function stepFlappy(state: FlappyState, net: NeuralNetwork): void {
  if (!state.alive) return;

  // Find next pipe
  while (
    state.nextPipeIdx < state.pipes.length &&
    state.pipes[state.nextPipeIdx].x + FLAPPY.pipeWidth < FLAPPY.birdX + state.distance
  ) {
    state.nextPipeIdx++;
  }

  const pipe =
    state.nextPipeIdx < state.pipes.length
      ? state.pipes[state.nextPipeIdx]
      : null;

  // NN inputs (normalized)
  const inputs = [
    state.y / FLAPPY.worldHeight,
    state.vy / 10,
    pipe ? (pipe.x - state.distance - FLAPPY.birdX) / FLAPPY.worldWidth : 1,
    pipe ? (pipe.gapY + pipe.gapHeight / 2) / FLAPPY.worldHeight : 0.5,
  ];

  const output = forward(net, inputs);
  if (output[0] > 0) {
    state.vy = FLAPPY.flapForce;
  }

  // Physics
  state.vy += FLAPPY.gravity;
  state.y += state.vy;
  state.distance += FLAPPY.speed;
  state.steps++;

  // Collision: floor/ceiling
  if (state.y < FLAPPY.birdRadius || state.y > FLAPPY.worldHeight - FLAPPY.birdRadius) {
    state.alive = false;
    return;
  }

  // Collision: pipes
  if (pipe) {
    const birdScreenX = FLAPPY.birdX;
    const pipeScreenX = pipe.x - state.distance;

    if (
      birdScreenX + FLAPPY.birdRadius > pipeScreenX &&
      birdScreenX - FLAPPY.birdRadius < pipeScreenX + FLAPPY.pipeWidth
    ) {
      if (
        state.y - FLAPPY.birdRadius < pipe.gapY ||
        state.y + FLAPPY.birdRadius > pipe.gapY + pipe.gapHeight
      ) {
        state.alive = false;
      }
    }
  }
}

export function flappyFitness(state: FlappyState): number {
  return state.distance + state.steps * 0.1;
}

export { FLAPPY };

// ─────────────────────────────────────────────────────────
// Maze Runner Task
// ─────────────────────────────────────────────────────────

export interface MazeState {
  x: number;
  y: number;
  angle: number;      // heading in radians
  alive: boolean;
  steps: number;
  reachedGoal: boolean;
  bestDistToGoal: number;
}

// 10x10 maze: 1 = wall, 0 = open
// S = start (1,1), G = goal (8,8)
const MAZE_GRID: readonly number[][] = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  [1, 0, 1, 0, 1, 0, 1, 1, 0, 1],
  [1, 0, 1, 0, 0, 0, 0, 1, 0, 1],
  [1, 0, 1, 1, 1, 1, 0, 1, 0, 1],
  [1, 0, 0, 0, 0, 1, 0, 0, 0, 1],
  [1, 1, 1, 1, 0, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 1, 0, 1],
  [1, 0, 1, 1, 1, 1, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
];

const MAZE = {
  cellSize: 40,
  startX: 1.5,
  startY: 1.5,
  goalX: 8.5,
  goalY: 8.5,
  agentRadius: 0.2,
  moveSpeed: 0.06,
  turnSpeed: 0.15,
  rayCount: 5,
  rayMaxDist: 6,
  raySpread: Math.PI * 0.75,  // 135 degrees total spread
} as const;

export { MAZE_GRID, MAZE };

export function createMazeState(): MazeState {
  const dx = MAZE.goalX - MAZE.startX;
  const dy = MAZE.goalY - MAZE.startY;
  const distToGoal = Math.sqrt(dx * dx + dy * dy);
  return {
    x: MAZE.startX,
    y: MAZE.startY,
    angle: 0,
    alive: true,
    steps: 0,
    reachedGoal: false,
    bestDistToGoal: distToGoal,
  };
}

/** Cast a ray from (x,y) in direction angle, return distance to wall (max = rayMaxDist). */
export function castRay(
  x: number,
  y: number,
  angle: number,
): number {
  const stepSize = 0.05;
  const dx = Math.cos(angle) * stepSize;
  const dy = Math.sin(angle) * stepSize;
  let cx = x;
  let cy = y;
  let dist = 0;

  while (dist < MAZE.rayMaxDist) {
    cx += dx;
    cy += dy;
    dist += stepSize;

    const gridX = Math.floor(cx);
    const gridY = Math.floor(cy);

    if (
      gridX < 0 ||
      gridX >= 10 ||
      gridY < 0 ||
      gridY >= 10 ||
      MAZE_GRID[gridY][gridX] === 1
    ) {
      return dist;
    }
  }

  return MAZE.rayMaxDist;
}

export function stepMaze(state: MazeState, net: NeuralNetwork): void {
  if (!state.alive || state.reachedGoal) return;

  // Cast rays
  const rays: number[] = [];
  for (let i = 0; i < MAZE.rayCount; i++) {
    const rayAngle =
      state.angle -
      MAZE.raySpread / 2 +
      (i / (MAZE.rayCount - 1)) * MAZE.raySpread;
    rays.push(castRay(state.x, state.y, rayAngle) / MAZE.rayMaxDist);
  }

  // Direction to goal
  const dx = MAZE.goalX - state.x;
  const dy = MAZE.goalY - state.y;
  const goalAngle = Math.atan2(dy, dx);
  const relativeGoalAngle = goalAngle - state.angle;
  // Normalize to [-PI, PI]
  const normalizedAngle =
    Math.atan2(Math.sin(relativeGoalAngle), Math.cos(relativeGoalAngle));

  const distToGoal = Math.sqrt(dx * dx + dy * dy);

  // Inputs: 5 ray distances + goal direction + goal distance
  const inputs = [
    ...rays,
    normalizedAngle / Math.PI,
    Math.min(distToGoal / 10, 1),
  ];

  const output = forward(net, inputs);

  // Outputs: [turn, move]
  // output[0]: turn amount (-1 = left, 1 = right)
  // output[1]: forward speed (0 to 1 mapped from tanh output)
  // output[2]: not used for now, reserved
  state.angle += output[0] * MAZE.turnSpeed;
  const moveAmount = (output[1] + 1) / 2 * MAZE.moveSpeed; // map [-1,1] to [0, moveSpeed]

  const newX = state.x + Math.cos(state.angle) * moveAmount;
  const newY = state.y + Math.sin(state.angle) * moveAmount;

  // Check wall collision
  const gridX = Math.floor(newX);
  const gridY = Math.floor(newY);

  if (
    gridX >= 0 &&
    gridX < 10 &&
    gridY >= 0 &&
    gridY < 10 &&
    MAZE_GRID[gridY][gridX] === 0
  ) {
    state.x = newX;
    state.y = newY;
  }

  state.steps++;

  // Update best distance to goal
  const currentDist = Math.sqrt(
    (state.x - MAZE.goalX) ** 2 + (state.y - MAZE.goalY) ** 2,
  );
  if (currentDist < state.bestDistToGoal) {
    state.bestDistToGoal = currentDist;
  }

  // Check if reached goal
  if (currentDist < 0.5) {
    state.reachedGoal = true;
  }

  // Time limit
  if (state.steps >= TASK_CONFIGS.maze.maxSteps) {
    state.alive = false;
  }
}

export function mazeFitness(state: MazeState): number {
  const dx = MAZE.goalX - MAZE.startX;
  const dy = MAZE.goalY - MAZE.startY;
  const maxDist = Math.sqrt(dx * dx + dy * dy);

  // Reward: inverse of best distance to goal + bonus for reaching it
  const distScore = (maxDist - state.bestDistToGoal) / maxDist;
  const reachBonus = state.reachedGoal ? 100 : 0;
  const speedBonus = state.reachedGoal
    ? (TASK_CONFIGS.maze.maxSteps - state.steps) / TASK_CONFIGS.maze.maxSteps * 50
    : 0;

  return distScore * 100 + reachBonus + speedBonus;
}

// ─────────────────────────────────────────────────────────
// Evaluation: run a full episode for one individual
// ─────────────────────────────────────────────────────────

export type TaskState = CartPoleState | FlappyState | MazeState;

export function evaluateIndividual(
  net: NeuralNetwork,
  task: TaskType,
): { fitness: number; finalState: TaskState } {
  switch (task) {
    case "cart-pole": {
      const state = createCartPoleState();
      for (let i = 0; i < TASK_CONFIGS["cart-pole"].maxSteps && state.alive; i++) {
        stepCartPole(state, net);
      }
      return { fitness: cartPoleFitness(state), finalState: state };
    }
    case "flappy": {
      const state = createFlappyState();
      for (let i = 0; i < TASK_CONFIGS.flappy.maxSteps && state.alive; i++) {
        stepFlappy(state, net);
      }
      return { fitness: flappyFitness(state), finalState: state };
    }
    case "maze": {
      const state = createMazeState();
      for (
        let i = 0;
        i < TASK_CONFIGS.maze.maxSteps && state.alive && !state.reachedGoal;
        i++
      ) {
        stepMaze(state, net);
      }
      return { fitness: mazeFitness(state), finalState: state };
    }
  }
}
