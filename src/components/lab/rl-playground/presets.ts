// ─────────────────────────────────────────────────────────
// Grid World Preset Maps
// ─────────────────────────────────────────────────────────

import { CellKind } from "./environments";

const S = CellKind.Start;
const G = CellKind.Goal;
const W = CellKind.Wall;
const H = CellKind.Hole;
const E = CellKind.Empty;
const I = CellKind.Slippery; // Ice / slippery

export interface MapPreset {
  id: string;
  name: string;
  rows: number;
  cols: number;
  grid: CellKind[];
  description: string;
}

export const MAP_PRESETS: MapPreset[] = [
  {
    id: "frozen-lake-4x4",
    name: "Frozen Lake 4x4",
    rows: 4,
    cols: 4,
    description: "Classic 4x4 frozen lake with slippery ice and holes.",
    grid: [
      S, I, I, I,
      I, H, I, H,
      I, I, I, H,
      H, I, I, G,
    ],
  },
  {
    id: "frozen-lake-8x8",
    name: "Frozen Lake 8x8",
    rows: 8,
    cols: 8,
    description: "Larger frozen lake with more holes and ice.",
    grid: [
      S, I, I, I, I, I, I, I,
      I, I, I, I, I, I, I, I,
      I, I, I, H, I, I, I, I,
      I, I, I, I, I, H, I, I,
      I, I, I, H, I, I, I, I,
      I, H, H, I, I, I, H, I,
      I, H, I, I, H, I, H, I,
      I, I, I, H, I, I, I, G,
    ],
  },
  {
    id: "cliff-walking",
    name: "Cliff Walking",
    rows: 4,
    cols: 8,
    description: "Navigate along a cliff edge. Falling off the cliff gives -100 reward.",
    grid: [
      E, E, E, E, E, E, E, E,
      E, E, E, E, E, E, E, E,
      E, E, E, E, E, E, E, E,
      S, H, H, H, H, H, H, G,
    ],
  },
  {
    id: "windy-grid",
    name: "Windy Gridworld",
    rows: 7,
    cols: 7,
    description: "A 7x7 grid with slippery tiles in the center columns.",
    grid: [
      E, E, I, I, I, E, E,
      E, E, I, I, I, E, E,
      E, E, I, I, I, E, E,
      S, E, I, I, I, E, G,
      E, E, I, I, I, E, E,
      E, E, I, I, I, E, E,
      E, E, I, I, I, E, E,
    ],
  },
  {
    id: "maze-5x5",
    name: "Simple Maze",
    rows: 5,
    cols: 5,
    description: "A 5x5 maze with walls to navigate around.",
    grid: [
      S, E, W, E, E,
      E, W, W, E, W,
      E, E, E, E, E,
      W, W, E, W, E,
      E, E, E, W, G,
    ],
  },
  {
    id: "open-5x5",
    name: "Open 5x5",
    rows: 5,
    cols: 5,
    description: "Simple open 5x5 grid - good for learning basics.",
    grid: [
      S, E, E, E, E,
      E, E, E, E, E,
      E, E, E, E, E,
      E, E, E, E, E,
      E, E, E, E, G,
    ],
  },
  {
    id: "traps-7x7",
    name: "Trap Field",
    rows: 7,
    cols: 7,
    description: "Navigate through a field of traps to reach the goal.",
    grid: [
      S, E, E, H, E, E, E,
      E, H, E, E, E, H, E,
      E, E, E, H, E, E, E,
      H, E, E, E, E, H, E,
      E, E, H, E, E, E, E,
      E, H, E, E, H, E, E,
      E, E, E, E, E, E, G,
    ],
  },
];

export function createCustomGrid(rows: number, cols: number): CellKind[] {
  const grid = new Array(rows * cols).fill(CellKind.Empty);
  grid[0] = CellKind.Start;
  grid[rows * cols - 1] = CellKind.Goal;
  return grid;
}
