import { useState, useEffect, useRef, useCallback } from "preact/hooks";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

const CellType = {
  Empty: 0,
  Wall: 1,
  Weighted: 2,
} as const;

type CellType = (typeof CellType)[keyof typeof CellType];

interface Cell {
  type: CellType;
  visited: boolean;
  inPath: boolean;
  visitOrder: number;
}

interface GridPos {
  row: number;
  col: number;
}

interface PathStep {
  type: "visit" | "path" | "done" | "visit-reverse";
  pos: GridPos;
  distance?: number;
}

type AlgorithmId = "bfs" | "dfs" | "dijkstra" | "astar-manhattan" | "astar-euclidean" | "greedy" | "bidirectional";
type MazeId = "recursive-backtracking" | "prims" | "kruskals" | "recursive-division";
type PlayState = "idle" | "running" | "paused" | "done";

interface AlgorithmDef {
  id: AlgorithmId;
  name: string;
  weighted: boolean;
  description: string;
}

interface MazeDef {
  id: MazeId;
  name: string;
}

interface Stats {
  nodesVisited: number;
  pathLength: number;
  timeMs: number;
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const COLS = 40;
const ROWS = 25;
const WEIGHT_COST = 5;

const ALGORITHMS: AlgorithmDef[] = [
  { id: "bfs", name: "BFS", weighted: false, description: "Breadth-first search: explores all neighbors at current depth before moving deeper. Guarantees shortest path on unweighted grids." },
  { id: "dfs", name: "DFS", weighted: false, description: "Depth-first search: explores as far as possible along each branch before backtracking. Does NOT guarantee shortest path." },
  { id: "dijkstra", name: "Dijkstra", weighted: true, description: "Explores nodes in order of cumulative cost. Guarantees shortest path on weighted grids." },
  { id: "astar-manhattan", name: "A* (Manhattan)", weighted: true, description: "Uses Manhattan distance heuristic. Guarantees shortest path when diagonal movement is off." },
  { id: "astar-euclidean", name: "A* (Euclidean)", weighted: true, description: "Uses Euclidean distance heuristic. Guarantees shortest path. Better suited for diagonal movement." },
  { id: "greedy", name: "Greedy Best-First", weighted: false, description: "Always expands the node closest to the goal by heuristic. Fast but does NOT guarantee shortest path." },
  { id: "bidirectional", name: "Bidirectional BFS", weighted: false, description: "Runs BFS from both start and end simultaneously. Meets in the middle. Guarantees shortest path on unweighted grids." },
];

const MAZES: MazeDef[] = [
  { id: "recursive-backtracking", name: "Recursive Backtracking" },
  { id: "prims", name: "Prim's Algorithm" },
  { id: "kruskals", name: "Kruskal's Algorithm" },
  { id: "recursive-division", name: "Recursive Division" },
];

const DIRECTIONS_4: GridPos[] = [
  { row: -1, col: 0 },
  { row: 1, col: 0 },
  { row: 0, col: -1 },
  { row: 0, col: 1 },
];

const DIRECTIONS_8: GridPos[] = [
  ...DIRECTIONS_4,
  { row: -1, col: -1 },
  { row: -1, col: 1 },
  { row: 1, col: -1 },
  { row: 1, col: 1 },
];

// ─────────────────────────────────────────────────────────
// CSS Variable Helper
// ─────────────────────────────────────────────────────────

function getCSSVar(name: string): string {
  if (typeof document === "undefined") return "#ffffff";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#ffffff";
}

// ─────────────────────────────────────────────────────────
// Grid Helpers
// ─────────────────────────────────────────────────────────

function createGrid(): Cell[][] {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ({
      type: CellType.Empty,
      visited: false,
      inPath: false,
      visitOrder: -1,
    })),
  );
}

function inBounds(pos: GridPos): boolean {
  return pos.row >= 0 && pos.row < ROWS && pos.col >= 0 && pos.col < COLS;
}

function posEquals(a: GridPos, b: GridPos): boolean {
  return a.row === b.row && a.col === b.col;
}

function getNeighbors(pos: GridPos, diagonal: boolean): GridPos[] {
  const dirs = diagonal ? DIRECTIONS_8 : DIRECTIONS_4;
  return dirs
    .map((d) => ({ row: pos.row + d.row, col: pos.col + d.col }))
    .filter(inBounds);
}

function moveCost(grid: Cell[][], to: GridPos, diagonal: boolean, from?: GridPos): number {
  const cell = grid[to.row][to.col];
  if (cell.type === CellType.Wall) return Infinity;
  const baseCost = cell.type === CellType.Weighted ? WEIGHT_COST : 1;
  if (diagonal && from && from.row !== to.row && from.col !== to.col) {
    return baseCost * Math.SQRT2;
  }
  return baseCost;
}

// ─────────────────────────────────────────────────────────
// Priority Queue (min-heap)
// ─────────────────────────────────────────────────────────

class MinHeap<T> {
  private heap: { priority: number; value: T }[] = [];

  get size(): number {
    return this.heap.length;
  }

  push(value: T, priority: number): void {
    this.heap.push({ priority, value });
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return top.value;
  }

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.heap[parent].priority <= this.heap[idx].priority) break;
      [this.heap[parent], this.heap[idx]] = [this.heap[idx], this.heap[parent]];
      idx = parent;
    }
  }

  private sinkDown(idx: number): void {
    const length = this.heap.length;
    while (true) {
      let smallest = idx;
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;
      if (left < length && this.heap[left].priority < this.heap[smallest].priority) smallest = left;
      if (right < length && this.heap[right].priority < this.heap[smallest].priority) smallest = right;
      if (smallest === idx) break;
      [this.heap[smallest], this.heap[idx]] = [this.heap[idx], this.heap[smallest]];
      idx = smallest;
    }
  }
}

// ─────────────────────────────────────────────────────────
// Heuristics
// ─────────────────────────────────────────────────────────

function manhattanDistance(a: GridPos, b: GridPos): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

function euclideanDistance(a: GridPos, b: GridPos): number {
  return Math.sqrt((a.row - b.row) ** 2 + (a.col - b.col) ** 2);
}

// ─────────────────────────────────────────────────────────
// Pathfinding Algorithms (Generator Functions)
// ─────────────────────────────────────────────────────────

function* bfs(
  grid: Cell[][],
  start: GridPos,
  end: GridPos,
  diagonal: boolean,
): Generator<PathStep> {
  const parent: (GridPos | null)[][] = Array.from({ length: ROWS }, () =>
    Array(COLS).fill(null),
  );
  const visited: boolean[][] = Array.from({ length: ROWS }, () =>
    Array(COLS).fill(false),
  );
  const queue: GridPos[] = [start];
  visited[start.row][start.col] = true;

  while (queue.length > 0) {
    const current = queue.shift()!;
    yield { type: "visit", pos: current };

    if (posEquals(current, end)) {
      yield* tracePath(parent, start, end);
      yield { type: "done", pos: end };
      return;
    }

    for (const neighbor of getNeighbors(current, diagonal)) {
      if (!visited[neighbor.row][neighbor.col] && grid[neighbor.row][neighbor.col].type !== CellType.Wall) {
        visited[neighbor.row][neighbor.col] = true;
        parent[neighbor.row][neighbor.col] = current;
        queue.push(neighbor);
      }
    }
  }
  yield { type: "done", pos: end };
}

function* dfs(
  grid: Cell[][],
  start: GridPos,
  end: GridPos,
  diagonal: boolean,
): Generator<PathStep> {
  const parent: (GridPos | null)[][] = Array.from({ length: ROWS }, () =>
    Array(COLS).fill(null),
  );
  const visited: boolean[][] = Array.from({ length: ROWS }, () =>
    Array(COLS).fill(false),
  );
  const stack: GridPos[] = [start];
  visited[start.row][start.col] = true;

  while (stack.length > 0) {
    const current = stack.pop()!;
    yield { type: "visit", pos: current };

    if (posEquals(current, end)) {
      yield* tracePath(parent, start, end);
      yield { type: "done", pos: end };
      return;
    }

    for (const neighbor of getNeighbors(current, diagonal)) {
      if (!visited[neighbor.row][neighbor.col] && grid[neighbor.row][neighbor.col].type !== CellType.Wall) {
        visited[neighbor.row][neighbor.col] = true;
        parent[neighbor.row][neighbor.col] = current;
        stack.push(neighbor);
      }
    }
  }
  yield { type: "done", pos: end };
}

function* dijkstra(
  grid: Cell[][],
  start: GridPos,
  end: GridPos,
  diagonal: boolean,
): Generator<PathStep> {
  const dist: number[][] = Array.from({ length: ROWS }, () =>
    Array(COLS).fill(Infinity),
  );
  const parent: (GridPos | null)[][] = Array.from({ length: ROWS }, () =>
    Array(COLS).fill(null),
  );
  const visited: boolean[][] = Array.from({ length: ROWS }, () =>
    Array(COLS).fill(false),
  );
  dist[start.row][start.col] = 0;
  const pq = new MinHeap<GridPos>();
  pq.push(start, 0);

  while (pq.size > 0) {
    const current = pq.pop()!;
    if (visited[current.row][current.col]) continue;
    visited[current.row][current.col] = true;
    yield { type: "visit", pos: current, distance: dist[current.row][current.col] };

    if (posEquals(current, end)) {
      yield* tracePath(parent, start, end);
      yield { type: "done", pos: end };
      return;
    }

    for (const neighbor of getNeighbors(current, diagonal)) {
      if (visited[neighbor.row][neighbor.col]) continue;
      const cost = moveCost(grid, neighbor, diagonal, current);
      if (cost === Infinity) continue;
      const newDist = dist[current.row][current.col] + cost;
      if (newDist < dist[neighbor.row][neighbor.col]) {
        dist[neighbor.row][neighbor.col] = newDist;
        parent[neighbor.row][neighbor.col] = current;
        pq.push(neighbor, newDist);
      }
    }
  }
  yield { type: "done", pos: end };
}

function* astar(
  grid: Cell[][],
  start: GridPos,
  end: GridPos,
  diagonal: boolean,
  heuristic: (a: GridPos, b: GridPos) => number,
): Generator<PathStep> {
  const gScore: number[][] = Array.from({ length: ROWS }, () =>
    Array(COLS).fill(Infinity),
  );
  const parent: (GridPos | null)[][] = Array.from({ length: ROWS }, () =>
    Array(COLS).fill(null),
  );
  const closed: boolean[][] = Array.from({ length: ROWS }, () =>
    Array(COLS).fill(false),
  );
  gScore[start.row][start.col] = 0;
  const pq = new MinHeap<GridPos>();
  pq.push(start, heuristic(start, end));

  while (pq.size > 0) {
    const current = pq.pop()!;
    if (closed[current.row][current.col]) continue;
    closed[current.row][current.col] = true;
    yield { type: "visit", pos: current, distance: gScore[current.row][current.col] };

    if (posEquals(current, end)) {
      yield* tracePath(parent, start, end);
      yield { type: "done", pos: end };
      return;
    }

    for (const neighbor of getNeighbors(current, diagonal)) {
      if (closed[neighbor.row][neighbor.col]) continue;
      const cost = moveCost(grid, neighbor, diagonal, current);
      if (cost === Infinity) continue;
      const tentativeG = gScore[current.row][current.col] + cost;
      if (tentativeG < gScore[neighbor.row][neighbor.col]) {
        gScore[neighbor.row][neighbor.col] = tentativeG;
        parent[neighbor.row][neighbor.col] = current;
        pq.push(neighbor, tentativeG + heuristic(neighbor, end));
      }
    }
  }
  yield { type: "done", pos: end };
}

function* greedyBestFirst(
  grid: Cell[][],
  start: GridPos,
  end: GridPos,
  diagonal: boolean,
): Generator<PathStep> {
  const parent: (GridPos | null)[][] = Array.from({ length: ROWS }, () =>
    Array(COLS).fill(null),
  );
  const visited: boolean[][] = Array.from({ length: ROWS }, () =>
    Array(COLS).fill(false),
  );
  const pq = new MinHeap<GridPos>();
  pq.push(start, manhattanDistance(start, end));
  visited[start.row][start.col] = true;

  while (pq.size > 0) {
    const current = pq.pop()!;
    yield { type: "visit", pos: current };

    if (posEquals(current, end)) {
      yield* tracePath(parent, start, end);
      yield { type: "done", pos: end };
      return;
    }

    for (const neighbor of getNeighbors(current, diagonal)) {
      if (!visited[neighbor.row][neighbor.col] && grid[neighbor.row][neighbor.col].type !== CellType.Wall) {
        visited[neighbor.row][neighbor.col] = true;
        parent[neighbor.row][neighbor.col] = current;
        pq.push(neighbor, manhattanDistance(neighbor, end));
      }
    }
  }
  yield { type: "done", pos: end };
}

function* bidirectionalBfs(
  grid: Cell[][],
  start: GridPos,
  end: GridPos,
  diagonal: boolean,
): Generator<PathStep> {
  const parentFwd: (GridPos | null)[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const parentBwd: (GridPos | null)[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const visitedFwd: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const visitedBwd: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const queueFwd: GridPos[] = [start];
  const queueBwd: GridPos[] = [end];
  visitedFwd[start.row][start.col] = true;
  visitedBwd[end.row][end.col] = true;

  let meeting: GridPos | null = null;

  if (posEquals(start, end)) {
    yield { type: "visit", pos: start };
    yield { type: "path", pos: start };
    yield { type: "done", pos: start };
    return;
  }

  while (queueFwd.length > 0 || queueBwd.length > 0) {
    // Expand forward
    if (queueFwd.length > 0) {
      const current = queueFwd.shift()!;
      yield { type: "visit", pos: current };

      for (const neighbor of getNeighbors(current, diagonal)) {
        if (grid[neighbor.row][neighbor.col].type === CellType.Wall) continue;
        if (visitedBwd[neighbor.row][neighbor.col]) {
          parentFwd[neighbor.row][neighbor.col] = current;
          meeting = neighbor;
          break;
        }
        if (!visitedFwd[neighbor.row][neighbor.col]) {
          visitedFwd[neighbor.row][neighbor.col] = true;
          parentFwd[neighbor.row][neighbor.col] = current;
          queueFwd.push(neighbor);
        }
      }
      if (meeting) break;
    }

    // Expand backward
    if (queueBwd.length > 0) {
      const current = queueBwd.shift()!;
      yield { type: "visit-reverse", pos: current };

      for (const neighbor of getNeighbors(current, diagonal)) {
        if (grid[neighbor.row][neighbor.col].type === CellType.Wall) continue;
        if (visitedFwd[neighbor.row][neighbor.col]) {
          parentBwd[neighbor.row][neighbor.col] = current;
          meeting = neighbor;
          break;
        }
        if (!visitedBwd[neighbor.row][neighbor.col]) {
          visitedBwd[neighbor.row][neighbor.col] = true;
          parentBwd[neighbor.row][neighbor.col] = current;
          queueBwd.push(neighbor);
        }
      }
      if (meeting) break;
    }
  }

  if (meeting) {
    // Trace forward path to meeting
    const fwdPath: GridPos[] = [];
    let cur: GridPos | null = meeting;
    while (cur && !posEquals(cur, start)) {
      fwdPath.push(cur);
      cur = parentFwd[cur.row][cur.col];
    }
    fwdPath.push(start);
    fwdPath.reverse();

    // Trace backward path from meeting
    cur = parentBwd[meeting.row][meeting.col];
    const bwdPath: GridPos[] = [];
    while (cur && !posEquals(cur, end)) {
      bwdPath.push(cur);
      cur = parentBwd[cur.row][cur.col];
    }
    bwdPath.push(end);

    const fullPath = [...fwdPath, ...bwdPath];
    for (const p of fullPath) {
      yield { type: "path", pos: p };
    }
  }

  yield { type: "done", pos: end };
}

function* tracePath(
  parent: (GridPos | null)[][],
  start: GridPos,
  end: GridPos,
): Generator<PathStep> {
  const path: GridPos[] = [];
  let current: GridPos | null = end;
  while (current) {
    path.push(current);
    if (posEquals(current, start)) break;
    current = parent[current.row][current.col];
  }
  path.reverse();
  for (const pos of path) {
    yield { type: "path", pos };
  }
}

function runAlgorithm(
  id: AlgorithmId,
  grid: Cell[][],
  start: GridPos,
  end: GridPos,
  diagonal: boolean,
): Generator<PathStep> {
  switch (id) {
    case "bfs":
      return bfs(grid, start, end, diagonal);
    case "dfs":
      return dfs(grid, start, end, diagonal);
    case "dijkstra":
      return dijkstra(grid, start, end, diagonal);
    case "astar-manhattan":
      return astar(grid, start, end, diagonal, manhattanDistance);
    case "astar-euclidean":
      return astar(grid, start, end, diagonal, euclideanDistance);
    case "greedy":
      return greedyBestFirst(grid, start, end, diagonal);
    case "bidirectional":
      return bidirectionalBfs(grid, start, end, diagonal);
  }
}

// ─────────────────────────────────────────────────────────
// Maze Generation (Generator Functions)
// ─────────────────────────────────────────────────────────

interface MazeStep {
  row: number;
  col: number;
  type: CellType;
}

function* mazeRecursiveBacktracking(): Generator<MazeStep> {
  // Start with all walls, carve passages
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      yield { row: r, col: c, type: CellType.Wall };
    }
  }

  const visited: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(false));

  function isValid(r: number, c: number): boolean {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS;
  }

  const stack: GridPos[] = [];
  const startR = 1;
  const startC = 1;
  visited[startR][startC] = true;
  stack.push({ row: startR, col: startC });

  const dirs = [
    { row: -2, col: 0 },
    { row: 2, col: 0 },
    { row: 0, col: -2 },
    { row: 0, col: 2 },
  ];

  while (stack.length > 0) {
    const current = stack[stack.length - 1];

    // Shuffle directions
    const shuffled = [...dirs].sort(() => Math.random() - 0.5);
    let found = false;

    for (const d of shuffled) {
      const nr = current.row + d.row;
      const nc = current.col + d.col;
      if (isValid(nr, nc) && !visited[nr][nc]) {
        visited[nr][nc] = true;
        // Carve the wall between
        const wallR = current.row + d.row / 2;
        const wallC = current.col + d.col / 2;
        yield { row: wallR, col: wallC, type: CellType.Empty };
        yield { row: nr, col: nc, type: CellType.Empty };
        // Also carve current
        yield { row: current.row, col: current.col, type: CellType.Empty };
        stack.push({ row: nr, col: nc });
        found = true;
        break;
      }
    }

    if (!found) {
      stack.pop();
    }
  }
}

function* mazePrims(): Generator<MazeStep> {
  // Start with all walls
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      yield { row: r, col: c, type: CellType.Wall };
    }
  }

  const inMaze: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const walls: { wallR: number; wallC: number; cellR: number; cellC: number }[] = [];

  function isValid(r: number, c: number): boolean {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS;
  }

  const dirs = [
    { row: -2, col: 0 },
    { row: 2, col: 0 },
    { row: 0, col: -2 },
    { row: 0, col: 2 },
  ];

  const startR = 1;
  const startC = 1;
  inMaze[startR][startC] = true;
  yield { row: startR, col: startC, type: CellType.Empty };

  for (const d of dirs) {
    const nr = startR + d.row;
    const nc = startC + d.col;
    if (isValid(nr, nc)) {
      walls.push({
        wallR: startR + d.row / 2,
        wallC: startC + d.col / 2,
        cellR: nr,
        cellC: nc,
      });
    }
  }

  while (walls.length > 0) {
    const idx = Math.floor(Math.random() * walls.length);
    const { wallR, wallC, cellR, cellC } = walls[idx];
    walls.splice(idx, 1);

    if (!inMaze[cellR]?.[cellC]) {
      inMaze[cellR][cellC] = true;
      yield { row: wallR, col: wallC, type: CellType.Empty };
      yield { row: cellR, col: cellC, type: CellType.Empty };

      for (const d of dirs) {
        const nr = cellR + d.row;
        const nc = cellC + d.col;
        if (isValid(nr, nc) && !inMaze[nr][nc]) {
          walls.push({
            wallR: cellR + d.row / 2,
            wallC: cellC + d.col / 2,
            cellR: nr,
            cellC: nc,
          });
        }
      }
    }
  }
}

function* mazeKruskals(): Generator<MazeStep> {
  // Start with all walls
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      yield { row: r, col: c, type: CellType.Wall };
    }
  }

  // Union-Find
  const parentMap = new Map<string, string>();
  const rankMap = new Map<string, number>();

  function key(r: number, c: number): string {
    return `${r},${c}`;
  }

  function find(k: string): string {
    let root = k;
    while (parentMap.get(root) !== root) {
      root = parentMap.get(root) || root;
    }
    // Path compression
    let cur = k;
    while (cur !== root) {
      const next = parentMap.get(cur) || cur;
      parentMap.set(cur, root);
      cur = next;
    }
    return root;
  }

  function union(a: string, b: string): boolean {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return false;
    const rankA = rankMap.get(ra) || 0;
    const rankB = rankMap.get(rb) || 0;
    if (rankA < rankB) {
      parentMap.set(ra, rb);
    } else if (rankA > rankB) {
      parentMap.set(rb, ra);
    } else {
      parentMap.set(rb, ra);
      rankMap.set(ra, rankA + 1);
    }
    return true;
  }

  // Initialize cells on odd positions
  for (let r = 1; r < ROWS; r += 2) {
    for (let c = 1; c < COLS; c += 2) {
      const k = key(r, c);
      parentMap.set(k, k);
      rankMap.set(k, 0);
      yield { row: r, col: c, type: CellType.Empty };
    }
  }

  // Create list of edges (walls between cells)
  const edges: { wallR: number; wallC: number; cell1R: number; cell1C: number; cell2R: number; cell2C: number }[] = [];
  for (let r = 1; r < ROWS; r += 2) {
    for (let c = 1; c < COLS; c += 2) {
      if (r + 2 < ROWS) {
        edges.push({ wallR: r + 1, wallC: c, cell1R: r, cell1C: c, cell2R: r + 2, cell2C: c });
      }
      if (c + 2 < COLS) {
        edges.push({ wallR: r, wallC: c + 1, cell1R: r, cell1C: c, cell2R: r, cell2C: c + 2 });
      }
    }
  }

  // Shuffle edges
  for (let i = edges.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [edges[i], edges[j]] = [edges[j], edges[i]];
  }

  for (const edge of edges) {
    const k1 = key(edge.cell1R, edge.cell1C);
    const k2 = key(edge.cell2R, edge.cell2C);
    if (union(k1, k2)) {
      yield { row: edge.wallR, col: edge.wallC, type: CellType.Empty };
    }
  }
}

function* mazeRecursiveDivision(): Generator<MazeStep> {
  // Start empty, add walls via recursive division
  // Add border walls
  for (let r = 0; r < ROWS; r++) {
    if (r === 0 || r === ROWS - 1) {
      for (let c = 0; c < COLS; c++) {
        yield { row: r, col: c, type: CellType.Wall };
      }
    } else {
      yield { row: r, col: 0, type: CellType.Wall };
      yield { row: r, col: COLS - 1, type: CellType.Wall };
    }
  }

  function* divide(
    rStart: number,
    rEnd: number,
    cStart: number,
    cEnd: number,
  ): Generator<MazeStep> {
    const height = rEnd - rStart;
    const width = cEnd - cStart;

    if (height < 2 || width < 2) return;

    // Choose orientation: horizontal if wider, vertical if taller, random if equal
    const horizontal = height < width ? false : width < height ? true : Math.random() < 0.5;

    if (horizontal) {
      // Draw horizontal wall
      const possibleRows: number[] = [];
      for (let r = rStart + 1; r < rEnd; r += 1) {
        possibleRows.push(r);
      }
      if (possibleRows.length === 0) return;
      const wallRow = possibleRows[Math.floor(Math.random() * possibleRows.length)];
      const passageCol = cStart + Math.floor(Math.random() * width);

      for (let c = cStart; c <= cEnd; c++) {
        if (c !== passageCol) {
          yield { row: wallRow, col: c, type: CellType.Wall };
        }
      }

      yield* divide(rStart, wallRow - 1, cStart, cEnd);
      yield* divide(wallRow + 1, rEnd, cStart, cEnd);
    } else {
      // Draw vertical wall
      const possibleCols: number[] = [];
      for (let c = cStart + 1; c < cEnd; c += 1) {
        possibleCols.push(c);
      }
      if (possibleCols.length === 0) return;
      const wallCol = possibleCols[Math.floor(Math.random() * possibleCols.length)];
      const passageRow = rStart + Math.floor(Math.random() * height);

      for (let r = rStart; r <= rEnd; r++) {
        if (r !== passageRow) {
          yield { row: r, col: wallCol, type: CellType.Wall };
        }
      }

      yield* divide(rStart, rEnd, cStart, wallCol - 1);
      yield* divide(rStart, rEnd, wallCol + 1, cEnd);
    }
  }

  yield* divide(1, ROWS - 2, 1, COLS - 2);
}

function runMaze(id: MazeId): Generator<MazeStep> {
  switch (id) {
    case "recursive-backtracking":
      return mazeRecursiveBacktracking();
    case "prims":
      return mazePrims();
    case "kruskals":
      return mazeKruskals();
    case "recursive-division":
      return mazeRecursiveDivision();
  }
}

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

export default function PathfindingViz() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [grid, setGrid] = useState<Cell[][]>(createGrid);
  const [start, setStart] = useState<GridPos>({ row: 12, col: 5 });
  const [end, setEnd] = useState<GridPos>({ row: 12, col: 34 });
  const [algorithm, setAlgorithm] = useState<AlgorithmId>("astar-manhattan");
  const [diagonal, setDiagonal] = useState(false);
  const [speed, setSpeed] = useState(20);
  const [playState, setPlayState] = useState<PlayState>("idle");
  const [stats, setStats] = useState<Stats>({ nodesVisited: 0, pathLength: 0, timeMs: 0 });
  const [placingMode, setPlacingMode] = useState<"start" | "end" | null>(null);
  const [cellSize, setCellSize] = useState(24);

  const generatorRef = useRef<Generator<PathStep> | null>(null);
  const mazeGenRef = useRef<Generator<MazeStep> | null>(null);
  const animFrameRef = useRef<number>(0);
  const isDrawingRef = useRef(false);
  const drawTypeRef = useRef<CellType | null>(null);
  const lastCellRef = useRef<GridPos | null>(null);
  const startTimeRef = useRef(0);
  const visitCountRef = useRef(0);
  const pathCountRef = useRef(0);
  const isMazeAnimating = useRef(false);

  // Responsive cell size
  useEffect(() => {
    if (typeof window === "undefined") return;
    function updateSize(): void {
      const container = containerRef.current;
      if (!container) return;
      const availableWidth = container.clientWidth;
      const newCellSize = Math.max(12, Math.min(28, Math.floor(availableWidth / COLS)));
      setCellSize(newCellSize);
    }
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // ── Canvas Rendering ──
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const width = COLS * cellSize;
    const height = ROWS * cellSize;

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const bgColor = getCSSVar("--color-bg");
    const surfaceColor = getCSSVar("--color-surface");
    const borderColor = getCSSVar("--color-border");
    const primaryColor = getCSSVar("--color-primary");

    ctx.clearRect(0, 0, width, height);

    // Draw cells
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = grid[r][c];
        const x = c * cellSize;
        const y = r * cellSize;

        // Determine cell color
        if (posEquals({ row: r, col: c }, start)) {
          ctx.fillStyle = "#22c55e"; // green
        } else if (posEquals({ row: r, col: c }, end)) {
          ctx.fillStyle = "#ef4444"; // red
        } else if (cell.inPath) {
          ctx.fillStyle = "#facc15"; // yellow path
        } else if (cell.type === CellType.Wall) {
          ctx.fillStyle = getCSSVar("--color-heading");
        } else if (cell.visited) {
          // Gradient from primary to a lighter shade based on visit order
          const maxVisit = visitCountRef.current || 1;
          const t = Math.min(cell.visitOrder / maxVisit, 1);
          const r1 = parseInt(primaryColor.slice(1, 3), 16) || 79;
          const g1 = parseInt(primaryColor.slice(3, 5), 16) || 143;
          const b1 = parseInt(primaryColor.slice(5, 7), 16) || 247;
          // Blend towards a softer version
          const rf = Math.floor(r1 * (1 - t * 0.4));
          const gf = Math.floor(g1 * (1 - t * 0.2));
          const bf = Math.floor(b1);
          ctx.fillStyle = `rgb(${rf},${gf},${bf})`;
        } else if (cell.type === CellType.Weighted) {
          ctx.fillStyle = "#a855f7"; // purple for weighted
        } else {
          ctx.fillStyle = surfaceColor;
        }

        ctx.fillRect(x, y, cellSize, cellSize);

        // Grid lines
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, y, cellSize, cellSize);

        // Weight indicator
        if (cell.type === CellType.Weighted && !cell.inPath && !posEquals({ row: r, col: c }, start) && !posEquals({ row: r, col: c }, end)) {
          ctx.fillStyle = bgColor;
          ctx.font = `${Math.max(8, cellSize * 0.45)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("W", x + cellSize / 2, y + cellSize / 2);
        }
      }
    }

    // Start/End labels
    const labelSize = Math.max(10, cellSize * 0.5);
    ctx.font = `bold ${labelSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillStyle = bgColor;
    ctx.fillText("S", start.col * cellSize + cellSize / 2, start.row * cellSize + cellSize / 2);
    ctx.fillText("E", end.col * cellSize + cellSize / 2, end.row * cellSize + cellSize / 2);
  }, [grid, start, end, cellSize]);

  useEffect(() => {
    draw();
  }, [draw]);

  // ── Grid Cell from Mouse ──
  const getCellFromEvent = useCallback(
    (e: MouseEvent): GridPos | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const col = Math.floor(x / cellSize);
      const row = Math.floor(y / cellSize);
      if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
      return { row, col };
    },
    [cellSize],
  );

  // ── Mouse Handlers ──
  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (playState === "running") return;
      e.preventDefault();
      const pos = getCellFromEvent(e);
      if (!pos) return;

      // Right-click to place start/end
      if (e.button === 2) {
        if (!placingMode) {
          setPlacingMode("start");
          if (!posEquals(pos, end)) {
            setStart(pos);
            setPlacingMode("end");
          }
        } else if (placingMode === "end") {
          if (!posEquals(pos, start)) {
            setEnd(pos);
            setPlacingMode(null);
          }
        }
        return;
      }

      // Left-click: shift = weight, else toggle wall
      if (posEquals(pos, start) || posEquals(pos, end)) return;

      isDrawingRef.current = true;
      lastCellRef.current = pos;

      if (e.shiftKey) {
        const newType = grid[pos.row][pos.col].type === CellType.Weighted ? CellType.Empty : CellType.Weighted;
        drawTypeRef.current = newType;
        setGrid((prev) => {
          const next = prev.map((row) => row.map((c) => ({ ...c })));
          next[pos.row][pos.col].type = newType;
          return next;
        });
      } else {
        const newType = grid[pos.row][pos.col].type === CellType.Wall ? CellType.Empty : CellType.Wall;
        drawTypeRef.current = newType;
        setGrid((prev) => {
          const next = prev.map((row) => row.map((c) => ({ ...c })));
          next[pos.row][pos.col].type = newType;
          return next;
        });
      }
    },
    [playState, getCellFromEvent, grid, start, end, placingMode],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDrawingRef.current || playState === "running") return;
      const pos = getCellFromEvent(e);
      if (!pos) return;
      if (lastCellRef.current && posEquals(pos, lastCellRef.current)) return;
      if (posEquals(pos, start) || posEquals(pos, end)) return;

      lastCellRef.current = pos;
      const targetType = drawTypeRef.current;
      if (targetType === null) return;

      setGrid((prev) => {
        const next = prev.map((row) => row.map((c) => ({ ...c })));
        next[pos.row][pos.col].type = targetType;
        return next;
      });
    },
    [playState, getCellFromEvent, start, end],
  );

  const handleMouseUp = useCallback(() => {
    isDrawingRef.current = false;
    drawTypeRef.current = null;
    lastCellRef.current = null;
  }, []);

  const handleContextMenu = useCallback((e: Event) => {
    e.preventDefault();
  }, []);

  // ── Animation Loop ──
  const animate = useCallback(() => {
    const gen = generatorRef.current;
    if (!gen) return;

    // Steps per frame based on speed
    const stepsPerFrame = Math.max(1, Math.floor(speed / 2));

    let finished = false;
    for (let i = 0; i < stepsPerFrame; i++) {
      const result = gen.next();
      if (result.done) {
        finished = true;
        break;
      }
      const step = result.value;
      if (step.type === "visit" || step.type === "visit-reverse") {
        visitCountRef.current++;
        setGrid((prev) => {
          const next = prev.map((row) => row.map((c) => ({ ...c })));
          next[step.pos.row][step.pos.col].visited = true;
          next[step.pos.row][step.pos.col].visitOrder = visitCountRef.current;
          return next;
        });
      } else if (step.type === "path") {
        pathCountRef.current++;
        setGrid((prev) => {
          const next = prev.map((row) => row.map((c) => ({ ...c })));
          next[step.pos.row][step.pos.col].inPath = true;
          return next;
        });
      } else if (step.type === "done") {
        finished = true;
        break;
      }
    }

    if (finished) {
      const elapsed = performance.now() - startTimeRef.current;
      setStats({
        nodesVisited: visitCountRef.current,
        pathLength: pathCountRef.current,
        timeMs: Math.round(elapsed),
      });
      setPlayState("done");
      generatorRef.current = null;
      return;
    }

    setStats({
      nodesVisited: visitCountRef.current,
      pathLength: pathCountRef.current,
      timeMs: Math.round(performance.now() - startTimeRef.current),
    });

    animFrameRef.current = requestAnimationFrame(animate);
  }, [speed]);

  // ── Maze Animation Loop ──
  const animateMaze = useCallback(() => {
    const gen = mazeGenRef.current;
    if (!gen) return;

    const stepsPerFrame = Math.max(5, Math.floor(speed));

    for (let i = 0; i < stepsPerFrame; i++) {
      const result = gen.next();
      if (result.done) {
        mazeGenRef.current = null;
        isMazeAnimating.current = false;
        setPlayState("idle");
        return;
      }
      const step = result.value;
      setGrid((prev) => {
        const next = prev.map((row) => row.map((c) => ({ ...c })));
        next[step.row][step.col].type = step.type;
        return next;
      });
    }

    animFrameRef.current = requestAnimationFrame(animateMaze);
  }, [speed]);

  // ── Controls ──
  const handleStart = useCallback(() => {
    if (playState === "running") return;

    // Clear visited/path state but keep walls
    const cleanGrid = grid.map((row) =>
      row.map((c) => ({
        ...c,
        visited: false,
        inPath: false,
        visitOrder: -1,
      })),
    );
    setGrid(cleanGrid);

    visitCountRef.current = 0;
    pathCountRef.current = 0;
    startTimeRef.current = performance.now();
    setStats({ nodesVisited: 0, pathLength: 0, timeMs: 0 });

    generatorRef.current = runAlgorithm(algorithm, cleanGrid, start, end, diagonal);
    setPlayState("running");
  }, [playState, grid, algorithm, start, end, diagonal]);

  const handlePause = useCallback(() => {
    if (playState === "running") {
      cancelAnimationFrame(animFrameRef.current);
      setPlayState("paused");
    } else if (playState === "paused") {
      setPlayState("running");
    }
  }, [playState]);

  const handleReset = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    generatorRef.current = null;
    mazeGenRef.current = null;
    isMazeAnimating.current = false;
    setGrid(createGrid());
    setPlayState("idle");
    setStats({ nodesVisited: 0, pathLength: 0, timeMs: 0 });
    visitCountRef.current = 0;
    pathCountRef.current = 0;
  }, []);

  const handleClearWalls = useCallback(() => {
    if (playState === "running") return;
    cancelAnimationFrame(animFrameRef.current);
    generatorRef.current = null;
    setGrid(createGrid());
    setPlayState("idle");
    setStats({ nodesVisited: 0, pathLength: 0, timeMs: 0 });
    visitCountRef.current = 0;
    pathCountRef.current = 0;
  }, [playState]);

  const handleClearPath = useCallback(() => {
    if (playState === "running") return;
    cancelAnimationFrame(animFrameRef.current);
    generatorRef.current = null;
    setGrid((prev) =>
      prev.map((row) =>
        row.map((c) => ({
          ...c,
          visited: false,
          inPath: false,
          visitOrder: -1,
        })),
      ),
    );
    setPlayState("idle");
    setStats({ nodesVisited: 0, pathLength: 0, timeMs: 0 });
    visitCountRef.current = 0;
    pathCountRef.current = 0;
  }, [playState]);

  const handleGenerateMaze = useCallback(
    (mazeId: MazeId) => {
      if (playState === "running" || isMazeAnimating.current) return;

      cancelAnimationFrame(animFrameRef.current);
      generatorRef.current = null;

      // Reset to empty grid
      setGrid(createGrid());
      setStats({ nodesVisited: 0, pathLength: 0, timeMs: 0 });
      visitCountRef.current = 0;
      pathCountRef.current = 0;

      isMazeAnimating.current = true;
      mazeGenRef.current = runMaze(mazeId);
      setPlayState("running");
    },
    [playState],
  );

  // Run animation loop
  useEffect(() => {
    if (playState === "running") {
      if (isMazeAnimating.current && mazeGenRef.current) {
        animFrameRef.current = requestAnimationFrame(animateMaze);
      } else if (generatorRef.current) {
        animFrameRef.current = requestAnimationFrame(animate);
      }
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [playState, animate, animateMaze]);

  // Cleanup on unmount
  useEffect(() => {
    return () => cancelAnimationFrame(animFrameRef.current);
  }, []);

  const currentAlgo = ALGORITHMS.find((a) => a.id === algorithm);
  const isRunningOrMaze = playState === "running";
  const canvasWidth = COLS * cellSize;
  const canvasHeight = ROWS * cellSize;

  return (
    <div class="space-y-4" ref={containerRef}>
      {/* Controls Row 1: Algorithm + Maze */}
      <div class="flex flex-wrap items-center gap-3">
        <div class="flex items-center gap-2">
          <label class="text-xs font-medium text-[var(--color-text-muted)]">Algorithm</label>
          <select
            class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]"
            value={algorithm}
            onChange={(e) => setAlgorithm((e.target as HTMLSelectElement).value as AlgorithmId)}
            disabled={isRunningOrMaze}
          >
            {ALGORITHMS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div class="flex items-center gap-2">
          <label class="text-xs font-medium text-[var(--color-text-muted)]">Maze</label>
          <select
            class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]"
            value=""
            onChange={(e) => {
              const val = (e.target as HTMLSelectElement).value as MazeId;
              if (val) handleGenerateMaze(val);
              (e.target as HTMLSelectElement).value = "";
            }}
            disabled={isRunningOrMaze}
          >
            <option value="">Generate Maze...</option>
            {MAZES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        <label class="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
          <input
            type="checkbox"
            checked={diagonal}
            onChange={(e) => setDiagonal((e.target as HTMLInputElement).checked)}
            disabled={isRunningOrMaze}
            class="accent-[var(--color-primary)]"
          />
          Diagonal
        </label>
      </div>

      {/* Controls Row 2: Actions + Speed */}
      <div class="flex flex-wrap items-center gap-3">
        <button
          class="rounded-lg bg-[var(--color-primary)] px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          onClick={handleStart}
          disabled={isRunningOrMaze || playState === "done"}
        >
          Start
        </button>

        <button
          class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-1.5 text-sm font-medium text-[var(--color-text)] transition-opacity hover:opacity-80 disabled:opacity-40"
          onClick={handlePause}
          disabled={playState === "idle" || playState === "done" || isMazeAnimating.current}
        >
          {playState === "paused" ? "Resume" : "Pause"}
        </button>

        <button
          class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-1.5 text-sm font-medium text-[var(--color-text)] transition-opacity hover:opacity-80"
          onClick={handleClearPath}
          disabled={isRunningOrMaze}
        >
          Clear Path
        </button>

        <button
          class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-1.5 text-sm font-medium text-[var(--color-text)] transition-opacity hover:opacity-80"
          onClick={handleClearWalls}
          disabled={isRunningOrMaze}
        >
          Clear Walls
        </button>

        <button
          class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-1.5 text-sm font-medium text-[var(--color-text)] transition-opacity hover:opacity-80"
          onClick={handleReset}
        >
          Reset
        </button>

        <div class="flex items-center gap-2">
          <label class="text-xs text-[var(--color-text-muted)]">Speed</label>
          <input
            type="range"
            min="1"
            max="100"
            value={speed}
            onInput={(e) => setSpeed(parseInt((e.target as HTMLInputElement).value, 10))}
            class="w-24 accent-[var(--color-primary)]"
          />
          <span class="w-8 text-right text-xs tabular-nums text-[var(--color-text-muted)]">{speed}</span>
        </div>
      </div>

      {/* Placing mode indicator */}
      {placingMode && (
        <div class="rounded-lg border border-[var(--color-accent)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-accent)]">
          Right-click to place {placingMode === "start" ? "start point" : "end point"}
        </div>
      )}

      {/* Stats */}
      <div class="flex flex-wrap items-center gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
        <div class="text-xs text-[var(--color-text-muted)]">
          <span class="font-medium text-[var(--color-heading)]">{stats.nodesVisited}</span> nodes visited
        </div>
        <div class="text-xs text-[var(--color-text-muted)]">
          <span class="font-medium text-[var(--color-heading)]">{stats.pathLength}</span> path length
        </div>
        <div class="text-xs text-[var(--color-text-muted)]">
          <span class="font-medium text-[var(--color-heading)]">{stats.timeMs}</span> ms
        </div>
        {playState === "done" && stats.pathLength === 0 && (
          <div class="text-xs font-medium text-[#ef4444]">No path found</div>
        )}
      </div>

      {/* Canvas */}
      <div class="overflow-x-auto rounded-xl border border-[var(--color-border)]">
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={canvasHeight}
          style={{ width: `${canvasWidth}px`, height: `${canvasHeight}px`, cursor: isRunningOrMaze ? "default" : "crosshair" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onContextMenu={handleContextMenu}
        />
      </div>

      {/* Legend */}
      <div class="flex flex-wrap items-center gap-4 text-xs text-[var(--color-text-muted)]">
        <div class="flex items-center gap-1.5">
          <span class="inline-block h-3 w-3 rounded" style={{ backgroundColor: "#22c55e" }} />
          Start (S)
        </div>
        <div class="flex items-center gap-1.5">
          <span class="inline-block h-3 w-3 rounded" style={{ backgroundColor: "#ef4444" }} />
          End (E)
        </div>
        <div class="flex items-center gap-1.5">
          <span class="inline-block h-3 w-3 rounded border border-[var(--color-border)]" style={{ backgroundColor: "var(--color-heading)" }} />
          Wall
        </div>
        <div class="flex items-center gap-1.5">
          <span class="inline-block h-3 w-3 rounded" style={{ backgroundColor: "#a855f7" }} />
          Weighted (5x)
        </div>
        <div class="flex items-center gap-1.5">
          <span class="inline-block h-3 w-3 rounded" style={{ backgroundColor: "var(--color-primary)" }} />
          Visited
        </div>
        <div class="flex items-center gap-1.5">
          <span class="inline-block h-3 w-3 rounded" style={{ backgroundColor: "#facc15" }} />
          Path
        </div>
      </div>

      {/* Instructions */}
      <div class="space-y-1 text-xs text-[var(--color-text-muted)]">
        <p><strong class="text-[var(--color-heading)]">Draw:</strong> Click and drag to place walls. Shift+click for weighted nodes (5x cost).</p>
        <p><strong class="text-[var(--color-heading)]">Place:</strong> Right-click twice to set start and end points.</p>
      </div>

      {/* Algorithm Info */}
      {currentAlgo && (
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs text-[var(--color-text-muted)]">
          <span class="font-medium text-[var(--color-heading)]">{currentAlgo.name}:</span>{" "}
          {currentAlgo.description}
          {currentAlgo.weighted && (
            <span class="ml-1 text-[#a855f7]">(respects weighted nodes)</span>
          )}
        </div>
      )}
    </div>
  );
}
