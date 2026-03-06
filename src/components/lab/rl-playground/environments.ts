// ─────────────────────────────────────────────────────────
// Reinforcement Learning Environments
// ─────────────────────────────────────────────────────────

// ── Cell types for grid worlds ──

export const CellKind = {
  Empty: 0,
  Wall: 1,
  Hole: 2,
  Goal: 3,
  Start: 4,
  Slippery: 5,
} as const;
export type CellKind = (typeof CellKind)[keyof typeof CellKind];

// ── Actions ──

export const Action = {
  Up: 0,
  Down: 1,
  Left: 2,
  Right: 3,
} as const;
export type Action = (typeof Action)[keyof typeof Action];

export const ACTION_NAMES: Record<Action, string> = {
  [Action.Up]: "Up",
  [Action.Down]: "Down",
  [Action.Left]: "Left",
  [Action.Right]: "Right",
};

export const NUM_ACTIONS = 4;

export const ACTION_DELTAS: Record<Action, [number, number]> = {
  [Action.Up]: [-1, 0],
  [Action.Down]: [1, 0],
  [Action.Left]: [0, -1],
  [Action.Right]: [0, 1],
};

// ── Step result ──

export interface StepResult {
  nextState: number;
  reward: number;
  done: boolean;
}

// ── Environment interface ──

export interface Environment {
  readonly numStates: number;
  readonly numActions: number;
  readonly rows: number;
  readonly cols: number;
  readonly grid: CellKind[];
  readonly startState: number;
  reset(): number;
  step(state: number, action: Action): StepResult;
  stateToPos(state: number): [number, number];
  posToState(row: number, col: number): number;
  isTerminal(state: number): boolean;
}

// ── Grid World Environment ──

export function createGridWorld(
  rows: number,
  cols: number,
  grid: CellKind[],
): Environment {
  const startIdx = grid.indexOf(CellKind.Start);
  const startState = startIdx >= 0 ? startIdx : 0;

  function stateToPos(s: number): [number, number] {
    return [Math.floor(s / cols), s % cols];
  }

  function posToState(r: number, c: number): number {
    return r * cols + c;
  }

  function isTerminal(s: number): boolean {
    const cell = grid[s];
    return cell === CellKind.Goal || cell === CellKind.Hole;
  }

  function step(state: number, action: Action): StepResult {
    const [r, c] = stateToPos(state);
    const cell = grid[state];

    // If already in terminal state, return same state
    if (isTerminal(state)) {
      return { nextState: state, reward: 0, done: true };
    }

    // Slippery tiles: 33% chance of random action
    let actualAction = action;
    if (cell === CellKind.Slippery && Math.random() < 0.33) {
      actualAction = Math.floor(Math.random() * NUM_ACTIONS) as Action;
    }

    const [dr, dc] = ACTION_DELTAS[actualAction];
    let nr = r + dr;
    let nc = c + dc;

    // Bounds check
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) {
      nr = r;
      nc = c;
    }

    const nextState = posToState(nr, nc);
    const nextCell = grid[nextState];

    // Wall collision: stay in place
    if (nextCell === CellKind.Wall) {
      return { nextState: state, reward: -1, done: false };
    }

    // Goal
    if (nextCell === CellKind.Goal) {
      return { nextState, reward: 10, done: true };
    }

    // Hole
    if (nextCell === CellKind.Hole) {
      return { nextState, reward: -10, done: true };
    }

    // Normal step
    return { nextState, reward: -0.1, done: false };
  }

  return {
    numStates: rows * cols,
    numActions: NUM_ACTIONS,
    rows,
    cols,
    grid: [...grid],
    startState,
    reset: () => startState,
    step,
    stateToPos,
    posToState,
    isTerminal,
  };
}

// ── Taxi Environment ──
// Simplified 5x5 grid with 4 pickup/dropoff locations
// State = (row, col, passengerLocation, destination)
// passengerLocation: 0-3 = at location, 4 = in taxi
// destination: 0-3

const TAXI_LOCS: [number, number][] = [
  [0, 0], // R (red)
  [0, 4], // G (green)
  [4, 0], // Y (yellow)
  [4, 3], // B (blue)
];

const TAXI_LOC_NAMES = ["R", "G", "Y", "B"];

// Taxi has 6 actions: 4 movement + pickup + dropoff
export const TaxiAction = {
  Up: 0,
  Down: 1,
  Left: 2,
  Right: 3,
  Pickup: 4,
  Dropoff: 5,
} as const;
export type TaxiAction = (typeof TaxiAction)[keyof typeof TaxiAction];

export const TAXI_NUM_ACTIONS = 6;
export const TAXI_ACTION_NAMES = ["Up", "Down", "Left", "Right", "Pickup", "Dropoff"];

// Walls in taxi world (between cells)
const TAXI_WALLS: Set<string> = new Set([
  "0,1-0,2", "1,1-1,2", // wall between col 1 and 2 in rows 0-1
  "3,0-3,1", "4,0-4,1", // wall between col 0 and 1 in rows 3-4
  "3,2-3,3", "4,2-4,3", // wall between col 2 and 3 in rows 3-4
]);

function hasWall(r1: number, c1: number, r2: number, c2: number): boolean {
  const minC = Math.min(c1, c2);
  const maxC = Math.max(c1, c2);
  const minR = Math.min(r1, r2);
  // Only vertical walls (between columns)
  if (r1 === r2 && Math.abs(c1 - c2) === 1) {
    return TAXI_WALLS.has(`${r1},${minC}-${r1},${maxC}`);
  }
  // Horizontal boundary (between rows) - no walls in standard taxi
  return false;
}

export interface TaxiState {
  row: number;
  col: number;
  passengerLoc: number; // 0-3 = at location, 4 = in taxi
  destination: number;  // 0-3
}

export interface TaxiStepResult {
  nextState: TaxiState;
  reward: number;
  done: boolean;
}

export interface TaxiEnvironment {
  readonly numStates: number;
  readonly numActions: number;
  reset(): TaxiState;
  step(state: TaxiState, action: TaxiAction): TaxiStepResult;
  encodeState(state: TaxiState): number;
  decodeState(encoded: number): TaxiState;
  readonly pickupLocations: [number, number][];
  readonly locationNames: string[];
  readonly walls: Set<string>;
}

export function createTaxiEnvironment(): TaxiEnvironment {
  // State space: 5 * 5 * 5 * 4 = 500 states
  const numStates = 5 * 5 * 5 * 4;

  function encodeState(s: TaxiState): number {
    return ((s.row * 5 + s.col) * 5 + s.passengerLoc) * 4 + s.destination;
  }

  function decodeState(encoded: number): TaxiState {
    const destination = encoded % 4;
    encoded = Math.floor(encoded / 4);
    const passengerLoc = encoded % 5;
    encoded = Math.floor(encoded / 5);
    const col = encoded % 5;
    const row = Math.floor(encoded / 5);
    return { row, col, passengerLoc, destination };
  }

  function reset(): TaxiState {
    const row = Math.floor(Math.random() * 5);
    const col = Math.floor(Math.random() * 5);
    let passengerLoc = Math.floor(Math.random() * 4);
    let destination = Math.floor(Math.random() * 4);
    while (destination === passengerLoc) {
      destination = Math.floor(Math.random() * 4);
    }
    return { row, col, passengerLoc, destination };
  }

  function step(state: TaxiState, action: TaxiAction): TaxiStepResult {
    let { row, col, passengerLoc, destination } = state;

    if (action <= 3) {
      // Movement
      const deltas: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      const [dr, dc] = deltas[action];
      const nr = row + dr;
      const nc = col + dc;

      if (nr >= 0 && nr < 5 && nc >= 0 && nc < 5 && !hasWall(row, col, nr, nc)) {
        row = nr;
        col = nc;
      }

      return {
        nextState: { row, col, passengerLoc, destination },
        reward: -1,
        done: false,
      };
    }

    if (action === TaxiAction.Pickup) {
      if (passengerLoc < 4) {
        const [pr, pc] = TAXI_LOCS[passengerLoc];
        if (row === pr && col === pc) {
          return {
            nextState: { row, col, passengerLoc: 4, destination },
            reward: -1,
            done: false,
          };
        }
      }
      // Invalid pickup
      return {
        nextState: { row, col, passengerLoc, destination },
        reward: -10,
        done: false,
      };
    }

    // Dropoff
    if (passengerLoc === 4) {
      const [dr2, dc2] = TAXI_LOCS[destination];
      if (row === dr2 && col === dc2) {
        return {
          nextState: { row, col, passengerLoc: destination, destination },
          reward: 20,
          done: true,
        };
      }
    }
    // Invalid dropoff
    return {
      nextState: { row, col, passengerLoc, destination },
      reward: -10,
      done: false,
    };
  }

  return {
    numStates,
    numActions: TAXI_NUM_ACTIONS,
    reset,
    step,
    encodeState,
    decodeState,
    pickupLocations: TAXI_LOCS,
    locationNames: TAXI_LOC_NAMES,
    walls: TAXI_WALLS,
  };
}

// ── Multi-Armed Bandit ──

export interface BanditArm {
  trueMean: number;
  trueStd: number;
}

export interface BanditEnvironment {
  readonly numArms: number;
  readonly arms: BanditArm[];
  pull(arm: number): number;
}

export function createBanditEnvironment(numArms: number): BanditEnvironment {
  const arms: BanditArm[] = [];
  for (let i = 0; i < numArms; i++) {
    arms.push({
      trueMean: (Math.random() - 0.5) * 4, // mean in [-2, 2]
      trueStd: 0.5 + Math.random() * 1.5,   // std in [0.5, 2.0]
    });
  }

  function pull(arm: number): number {
    const { trueMean, trueStd } = arms[arm];
    // Box-Muller transform for normal distribution
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return trueMean + trueStd * z;
  }

  return { numArms, arms, pull };
}
