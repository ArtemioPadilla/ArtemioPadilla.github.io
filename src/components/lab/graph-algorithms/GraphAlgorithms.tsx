import {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "preact/hooks";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  x: number;
  y: number;
}

interface GraphEdge {
  from: string;
  to: string;
  weight: number;
}

interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  directed: boolean;
}

type NodeStatus = "unvisited" | "frontier" | "processing" | "visited" | "path";
type EdgeStatus = "default" | "exploring" | "result" | "relaxed";

interface AlgorithmStep {
  nodeStatuses: Record<string, NodeStatus>;
  edgeStatuses: Map<string, EdgeStatus>;
  description: string;
  dataStructure: string[];
  distances?: Record<string, number>;
  parents?: Record<string, string | null>;
  step: number;
}

type AlgorithmId =
  | "bfs"
  | "dfs"
  | "dijkstra"
  | "astar"
  | "bellman-ford"
  | "prim"
  | "kruskal"
  | "toposort";

interface AlgorithmDef {
  id: AlgorithmId;
  name: string;
  needsEnd: boolean;
  needsDirected?: boolean;
  description: string;
  complexity: string;
}

interface PresetGraph {
  name: string;
  graph: Graph;
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const NODE_RADIUS = 20;
const FONT = "14px Inter, system-ui, sans-serif";
const FONT_SMALL = "11px Inter, system-ui, sans-serif";
const FONT_WEIGHT = "10px Inter, system-ui, sans-serif";

const NODE_COLORS: Record<NodeStatus, string> = {
  unvisited: "var(--color-border)",
  frontier: "#f59e0b",
  processing: "#ef4444",
  visited: "#34d399",
  path: "#4f8ff7",
};

const EDGE_COLORS: Record<EdgeStatus, string> = {
  default: "var(--color-border)",
  exploring: "#f59e0b",
  result: "#34d399",
  relaxed: "#4f8ff7",
};

const ALGORITHMS: AlgorithmDef[] = [
  { id: "bfs", name: "BFS", needsEnd: true, description: "Breadth-First Search explores nodes layer by layer using a queue.", complexity: "O(V + E)" },
  { id: "dfs", name: "DFS", needsEnd: true, description: "Depth-First Search explores as deep as possible using a stack.", complexity: "O(V + E)" },
  { id: "dijkstra", name: "Dijkstra", needsEnd: true, description: "Finds shortest paths using a priority queue. Non-negative weights only.", complexity: "O((V + E) log V)" },
  { id: "astar", name: "A*", needsEnd: true, description: "Shortest path with Euclidean heuristic. Optimal with consistent heuristic.", complexity: "O((V + E) log V)" },
  { id: "bellman-ford", name: "Bellman-Ford", needsEnd: true, description: "Shortest path supporting negative weights. Detects negative cycles.", complexity: "O(V * E)" },
  { id: "prim", name: "Prim MST", needsEnd: false, description: "Builds minimum spanning tree by greedily adding cheapest edges.", complexity: "O((V + E) log V)" },
  { id: "kruskal", name: "Kruskal MST", needsEnd: false, description: "Builds MST by sorting edges and using Union-Find.", complexity: "O(E log E)" },
  { id: "toposort", name: "Topological Sort", needsEnd: false, needsDirected: true, description: "Orders nodes so every edge goes from earlier to later. Directed acyclic graphs only.", complexity: "O(V + E)" },
];

// ─────────────────────────────────────────────────────────
// Preset Graphs
// ─────────────────────────────────────────────────────────

function makePresets(): PresetGraph[] {
  return [
    {
      name: "Simple Path",
      graph: {
        nodes: [
          { id: "A", x: 80, y: 200 },
          { id: "B", x: 250, y: 200 },
          { id: "C", x: 420, y: 200 },
        ],
        edges: [
          { from: "A", to: "B", weight: 1 },
          { from: "B", to: "C", weight: 1 },
        ],
        directed: false,
      },
    },
    {
      name: "Binary Tree",
      graph: {
        nodes: [
          { id: "A", x: 280, y: 60 },
          { id: "B", x: 150, y: 160 },
          { id: "C", x: 410, y: 160 },
          { id: "D", x: 80, y: 270 },
          { id: "E", x: 220, y: 270 },
          { id: "F", x: 340, y: 270 },
          { id: "G", x: 480, y: 270 },
        ],
        edges: [
          { from: "A", to: "B", weight: 1 },
          { from: "A", to: "C", weight: 1 },
          { from: "B", to: "D", weight: 1 },
          { from: "B", to: "E", weight: 1 },
          { from: "C", to: "F", weight: 1 },
          { from: "C", to: "G", weight: 1 },
        ],
        directed: false,
      },
    },
    {
      name: "Grid 4x4",
      graph: (() => {
        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];
        const labels = "ABCDEFGHIJKLMNOP";
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 4; c++) {
            const i = r * 4 + c;
            nodes.push({ id: labels[i], x: 80 + c * 120, y: 60 + r * 90 });
            if (c < 3) edges.push({ from: labels[i], to: labels[i + 1], weight: 1 });
            if (r < 3) edges.push({ from: labels[i], to: labels[i + 4], weight: 1 });
          }
        }
        return { nodes, edges, directed: false };
      })(),
    },
    {
      name: "Complete K5",
      graph: (() => {
        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];
        const labels = "ABCDE";
        for (let i = 0; i < 5; i++) {
          const angle = (i / 5) * 2 * Math.PI - Math.PI / 2;
          nodes.push({
            id: labels[i],
            x: 280 + 150 * Math.cos(angle),
            y: 190 + 150 * Math.sin(angle),
          });
        }
        for (let i = 0; i < 5; i++) {
          for (let j = i + 1; j < 5; j++) {
            edges.push({ from: labels[i], to: labels[j], weight: 1 });
          }
        }
        return { nodes, edges, directed: false };
      })(),
    },
    {
      name: "Weighted (Dijkstra)",
      graph: {
        nodes: [
          { id: "A", x: 60, y: 100 },
          { id: "B", x: 200, y: 50 },
          { id: "C", x: 200, y: 200 },
          { id: "D", x: 350, y: 100 },
          { id: "E", x: 350, y: 250 },
          { id: "F", x: 500, y: 150 },
        ],
        edges: [
          { from: "A", to: "B", weight: 4 },
          { from: "A", to: "C", weight: 2 },
          { from: "B", to: "D", weight: 5 },
          { from: "C", to: "B", weight: 1 },
          { from: "C", to: "E", weight: 8 },
          { from: "D", to: "F", weight: 2 },
          { from: "E", to: "F", weight: 3 },
          { from: "D", to: "E", weight: 1 },
        ],
        directed: false,
      },
    },
    {
      name: "Random Connected",
      graph: (() => {
        const n = 8;
        const labels = "ABCDEFGH";
        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];
        for (let i = 0; i < n; i++) {
          const angle = (i / n) * 2 * Math.PI;
          const r = 120 + (i % 2) * 50;
          nodes.push({
            id: labels[i],
            x: 280 + r * Math.cos(angle),
            y: 200 + r * Math.sin(angle),
          });
        }
        for (let i = 0; i < n - 1; i++) {
          edges.push({ from: labels[i], to: labels[i + 1], weight: 1 + Math.floor(Math.random() * 9) });
        }
        for (let i = 0; i < 4; i++) {
          const a = Math.floor(Math.random() * n);
          let b = Math.floor(Math.random() * n);
          if (b === a) b = (b + 1) % n;
          const exists = edges.some(
            (e) => (e.from === labels[a] && e.to === labels[b]) || (e.from === labels[b] && e.to === labels[a])
          );
          if (!exists) {
            edges.push({ from: labels[a], to: labels[b], weight: 1 + Math.floor(Math.random() * 9) });
          }
        }
        return { nodes, edges, directed: false };
      })(),
    },
  ];
}

// ─────────────────────────────────────────────────────────
// Utility: Edge key for status map
// ─────────────────────────────────────────────────────────

function edgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}

function getEdgeStatus(statuses: Map<string, EdgeStatus>, from: string, to: string, directed: boolean): EdgeStatus {
  const s = statuses.get(edgeKey(from, to));
  if (s) return s;
  if (!directed) {
    return statuses.get(edgeKey(to, from)) ?? "default";
  }
  return "default";
}

// ─────────────────────────────────────────────────────────
// Utility: Adjacency helpers
// ─────────────────────────────────────────────────────────

function getNeighbors(graph: Graph, nodeId: string): Array<{ id: string; weight: number; edgeFrom: string; edgeTo: string }> {
  const result: Array<{ id: string; weight: number; edgeFrom: string; edgeTo: string }> = [];
  for (const e of graph.edges) {
    if (e.from === nodeId) {
      result.push({ id: e.to, weight: e.weight, edgeFrom: e.from, edgeTo: e.to });
    }
    if (!graph.directed && e.to === nodeId) {
      result.push({ id: e.from, weight: e.weight, edgeFrom: e.to, edgeTo: e.from });
    }
  }
  return result;
}

function getInDegree(graph: Graph, nodeId: string): number {
  return graph.edges.filter((e) => e.to === nodeId).length;
}

// ─────────────────────────────────────────────────────────
// Algorithms (Generator-based stepping)
// ─────────────────────────────────────────────────────────

function initStep(graph: Graph): AlgorithmStep {
  const nodeStatuses: Record<string, NodeStatus> = {};
  for (const n of graph.nodes) nodeStatuses[n.id] = "unvisited";
  return {
    nodeStatuses,
    edgeStatuses: new Map(),
    description: "Ready to start.",
    dataStructure: [],
    step: 0,
  };
}

function* bfsGenerator(graph: Graph, startId: string, endId: string): Generator<AlgorithmStep> {
  const state = initStep(graph);
  const parents: Record<string, string | null> = {};
  parents[startId] = null;
  const queue: string[] = [startId];
  state.nodeStatuses[startId] = "frontier";
  state.dataStructure = [...queue];
  state.description = `Initialize BFS. Enqueue start node ${startId}.`;
  state.parents = { ...parents };
  state.step = 1;
  yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };

  let found = false;
  while (queue.length > 0 && !found) {
    const current = queue.shift()!;
    state.nodeStatuses[current] = "processing";
    state.dataStructure = [...queue];
    state.step++;
    state.description = `Dequeue and process node ${current}.`;
    state.parents = { ...parents };
    yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };

    for (const neighbor of getNeighbors(graph, current)) {
      if (state.nodeStatuses[neighbor.id] === "unvisited") {
        state.edgeStatuses.set(edgeKey(neighbor.edgeFrom, neighbor.edgeTo), "exploring");
        parents[neighbor.id] = current;
        state.nodeStatuses[neighbor.id] = "frontier";
        queue.push(neighbor.id);
        state.dataStructure = [...queue];
        state.step++;
        state.description = `Discovered ${neighbor.id} via ${current}. Enqueue.`;
        state.parents = { ...parents };
        yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };

        if (neighbor.id === endId) {
          found = true;
          break;
        }
      }
    }
    state.nodeStatuses[current] = "visited";
  }

  if (found || state.nodeStatuses[endId] === "visited") {
    let cur: string | null = endId;
    while (cur !== null) {
      state.nodeStatuses[cur] = "path";
      const p: string | null | undefined = parents[cur];
      if (p !== null && p !== undefined) {
        state.edgeStatuses.set(edgeKey(p, cur), "result");
        if (!graph.directed) state.edgeStatuses.set(edgeKey(cur, p), "result");
      }
      cur = p ?? null;
    }
    state.step++;
    state.description = `Path found from ${startId} to ${endId}!`;
    state.dataStructure = [];
  } else {
    state.step++;
    state.description = `No path from ${startId} to ${endId}.`;
    state.dataStructure = [];
  }
  state.parents = { ...parents };
  yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };
}

function* dfsGenerator(graph: Graph, startId: string, endId: string): Generator<AlgorithmStep> {
  const state = initStep(graph);
  const parents: Record<string, string | null> = {};
  parents[startId] = null;
  const stack: string[] = [startId];
  state.nodeStatuses[startId] = "frontier";
  state.dataStructure = [...stack];
  state.description = `Initialize DFS. Push start node ${startId}.`;
  state.parents = { ...parents };
  state.step = 1;
  yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };

  let found = false;
  const visited = new Set<string>();

  while (stack.length > 0 && !found) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);

    state.nodeStatuses[current] = "processing";
    state.dataStructure = [...stack];
    state.step++;
    state.description = `Pop and process node ${current}.`;
    state.parents = { ...parents };
    yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };

    if (current === endId) {
      found = true;
      break;
    }

    const neighbors = getNeighbors(graph, current);
    for (let i = neighbors.length - 1; i >= 0; i--) {
      const neighbor = neighbors[i];
      if (!visited.has(neighbor.id)) {
        state.edgeStatuses.set(edgeKey(neighbor.edgeFrom, neighbor.edgeTo), "exploring");
        if (!(neighbor.id in parents)) parents[neighbor.id] = current;
        state.nodeStatuses[neighbor.id] = "frontier";
        stack.push(neighbor.id);
      }
    }
    state.dataStructure = [...stack];
    state.step++;
    state.description = `Explored neighbors of ${current}. Stack: [${stack.join(", ")}].`;
    state.parents = { ...parents };
    yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };

    state.nodeStatuses[current] = "visited";
  }

  if (found) {
    let cur: string | null = endId;
    while (cur !== null) {
      state.nodeStatuses[cur] = "path";
      const p: string | null | undefined = parents[cur];
      if (p !== null && p !== undefined) {
        state.edgeStatuses.set(edgeKey(p, cur), "result");
        if (!graph.directed) state.edgeStatuses.set(edgeKey(cur, p), "result");
      }
      cur = p ?? null;
    }
    state.step++;
    state.description = `Path found from ${startId} to ${endId}!`;
  } else {
    state.step++;
    state.description = `No path from ${startId} to ${endId}.`;
  }
  state.dataStructure = [];
  state.parents = { ...parents };
  yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };
}

function* dijkstraGenerator(graph: Graph, startId: string, endId: string): Generator<AlgorithmStep> {
  const state = initStep(graph);
  const dist: Record<string, number> = {};
  const parents: Record<string, string | null> = {};
  const pq: Array<{ id: string; dist: number }> = [];
  const finalized = new Set<string>();

  for (const n of graph.nodes) {
    dist[n.id] = Infinity;
    parents[n.id] = null;
  }
  dist[startId] = 0;
  pq.push({ id: startId, dist: 0 });
  state.nodeStatuses[startId] = "frontier";
  state.distances = { ...dist };
  state.parents = { ...parents };
  state.dataStructure = pq.map((p) => `${p.id}(${p.dist})`);
  state.description = `Initialize Dijkstra. Set dist[${startId}] = 0, all others = Inf.`;
  state.step = 1;
  yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };

  while (pq.length > 0) {
    pq.sort((a, b) => a.dist - b.dist);
    const current = pq.shift()!;
    if (finalized.has(current.id)) continue;
    finalized.add(current.id);

    state.nodeStatuses[current.id] = "processing";
    state.dataStructure = pq.filter((p) => !finalized.has(p.id)).map((p) => `${p.id}(${p.dist})`);
    state.step++;
    state.description = `Extract min: ${current.id} with dist=${current.dist}.`;
    state.distances = { ...dist };
    state.parents = { ...parents };
    yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };

    if (current.id === endId) break;

    for (const neighbor of getNeighbors(graph, current.id)) {
      if (finalized.has(neighbor.id)) continue;
      const newDist = dist[current.id] + neighbor.weight;
      state.edgeStatuses.set(edgeKey(neighbor.edgeFrom, neighbor.edgeTo), "exploring");

      if (newDist < dist[neighbor.id]) {
        const oldDist = dist[neighbor.id];
        dist[neighbor.id] = newDist;
        parents[neighbor.id] = current.id;
        pq.push({ id: neighbor.id, dist: newDist });
        state.nodeStatuses[neighbor.id] = "frontier";
        state.edgeStatuses.set(edgeKey(neighbor.edgeFrom, neighbor.edgeTo), "relaxed");
        state.step++;
        state.description = `Relax edge ${current.id}->${neighbor.id}: dist ${oldDist === Infinity ? "Inf" : oldDist} -> ${newDist}.`;
      } else {
        state.step++;
        state.description = `Edge ${current.id}->${neighbor.id}: no improvement (${newDist} >= ${dist[neighbor.id]}).`;
      }
      state.dataStructure = pq.filter((p) => !finalized.has(p.id)).map((p) => `${p.id}(${dist[p.id]})`);
      state.distances = { ...dist };
      state.parents = { ...parents };
      yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };
    }
    state.nodeStatuses[current.id] = "visited";
  }

  if (dist[endId] < Infinity) {
    let cur: string | null = endId;
    while (cur !== null) {
      state.nodeStatuses[cur] = "path";
      const p: string | null | undefined = parents[cur];
      if (p !== null && p !== undefined) {
        state.edgeStatuses.set(edgeKey(p, cur), "result");
        if (!graph.directed) state.edgeStatuses.set(edgeKey(cur, p), "result");
      }
      cur = p ?? null;
    }
    state.step++;
    state.description = `Shortest path ${startId}->${endId}: distance = ${dist[endId]}.`;
  } else {
    state.step++;
    state.description = `No path from ${startId} to ${endId}.`;
  }
  state.distances = { ...dist };
  state.parents = { ...parents };
  state.dataStructure = [];
  yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };
}

function* astarGenerator(graph: Graph, startId: string, endId: string): Generator<AlgorithmStep> {
  const state = initStep(graph);
  const nodeMap = new Map<string, GraphNode>();
  for (const n of graph.nodes) nodeMap.set(n.id, n);

  const heuristic = (a: string, b: string): number => {
    const na = nodeMap.get(a)!;
    const nb = nodeMap.get(b)!;
    return Math.sqrt((na.x - nb.x) ** 2 + (na.y - nb.y) ** 2) / 50;
  };

  const gScore: Record<string, number> = {};
  const fScore: Record<string, number> = {};
  const parents: Record<string, string | null> = {};
  const openSet: Set<string> = new Set();
  const closedSet: Set<string> = new Set();

  for (const n of graph.nodes) {
    gScore[n.id] = Infinity;
    fScore[n.id] = Infinity;
    parents[n.id] = null;
  }
  gScore[startId] = 0;
  fScore[startId] = heuristic(startId, endId);
  openSet.add(startId);

  state.nodeStatuses[startId] = "frontier";
  state.distances = { ...gScore };
  state.parents = { ...parents };
  state.dataStructure = [`${startId}(f=${fScore[startId].toFixed(1)})`];
  state.description = `Initialize A*. Start=${startId}, heuristic to ${endId}.`;
  state.step = 1;
  yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };

  let found = false;
  while (openSet.size > 0) {
    let current = "";
    let bestF = Infinity;
    for (const id of openSet) {
      if (fScore[id] < bestF) {
        bestF = fScore[id];
        current = id;
      }
    }

    if (current === endId) {
      found = true;
      break;
    }

    openSet.delete(current);
    closedSet.add(current);
    state.nodeStatuses[current] = "processing";
    state.step++;
    state.description = `Process ${current}: g=${gScore[current].toFixed(1)}, f=${fScore[current].toFixed(1)}.`;
    state.dataStructure = [...openSet].map((id) => `${id}(f=${fScore[id].toFixed(1)})`);
    state.distances = { ...gScore };
    state.parents = { ...parents };
    yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };

    for (const neighbor of getNeighbors(graph, current)) {
      if (closedSet.has(neighbor.id)) continue;
      state.edgeStatuses.set(edgeKey(neighbor.edgeFrom, neighbor.edgeTo), "exploring");
      const tentG = gScore[current] + neighbor.weight;

      if (tentG < gScore[neighbor.id]) {
        parents[neighbor.id] = current;
        gScore[neighbor.id] = tentG;
        fScore[neighbor.id] = tentG + heuristic(neighbor.id, endId);
        state.edgeStatuses.set(edgeKey(neighbor.edgeFrom, neighbor.edgeTo), "relaxed");
        if (!openSet.has(neighbor.id)) {
          openSet.add(neighbor.id);
          state.nodeStatuses[neighbor.id] = "frontier";
        }
        state.step++;
        state.description = `Relax ${current}->${neighbor.id}: g=${tentG.toFixed(1)}, f=${fScore[neighbor.id].toFixed(1)}.`;
      } else {
        state.step++;
        state.description = `Edge ${current}->${neighbor.id}: no improvement.`;
      }
      state.dataStructure = [...openSet].map((id) => `${id}(f=${fScore[id].toFixed(1)})`);
      state.distances = { ...gScore };
      state.parents = { ...parents };
      yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };
    }
    state.nodeStatuses[current] = "visited";
  }

  if (found) {
    let cur: string | null = endId;
    while (cur !== null) {
      state.nodeStatuses[cur] = "path";
      const p: string | null | undefined = parents[cur];
      if (p !== null && p !== undefined) {
        state.edgeStatuses.set(edgeKey(p, cur), "result");
        if (!graph.directed) state.edgeStatuses.set(edgeKey(cur, p), "result");
      }
      cur = p ?? null;
    }
    state.step++;
    state.description = `A* found path ${startId}->${endId}: cost = ${gScore[endId].toFixed(1)}.`;
  } else {
    state.step++;
    state.description = `A*: No path from ${startId} to ${endId}.`;
  }
  state.distances = { ...gScore };
  state.parents = { ...parents };
  state.dataStructure = [];
  yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };
}

function* bellmanFordGenerator(graph: Graph, startId: string, endId: string): Generator<AlgorithmStep> {
  const state = initStep(graph);
  const dist: Record<string, number> = {};
  const parents: Record<string, string | null> = {};

  for (const n of graph.nodes) {
    dist[n.id] = Infinity;
    parents[n.id] = null;
  }
  dist[startId] = 0;
  state.nodeStatuses[startId] = "frontier";
  state.distances = { ...dist };
  state.parents = { ...parents };
  state.dataStructure = [`Iteration 0/${graph.nodes.length - 1}`];
  state.description = `Initialize Bellman-Ford. dist[${startId}] = 0.`;
  state.step = 1;
  yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };

  const allEdges: Array<{ from: string; to: string; weight: number }> = [];
  for (const e of graph.edges) {
    allEdges.push(e);
    if (!graph.directed) {
      allEdges.push({ from: e.to, to: e.from, weight: e.weight });
    }
  }

  const V = graph.nodes.length;
  let changed = false;

  for (let i = 0; i < V - 1; i++) {
    changed = false;
    state.dataStructure = [`Iteration ${i + 1}/${V - 1}`];

    for (const e of allEdges) {
      if (dist[e.from] === Infinity) continue;
      state.edgeStatuses.set(edgeKey(e.from, e.to), "exploring");
      const newDist = dist[e.from] + e.weight;

      if (newDist < dist[e.to]) {
        const old = dist[e.to];
        dist[e.to] = newDist;
        parents[e.to] = e.from;
        changed = true;
        state.nodeStatuses[e.to] = "frontier";
        state.edgeStatuses.set(edgeKey(e.from, e.to), "relaxed");
        state.step++;
        state.description = `Iter ${i + 1}: Relax ${e.from}->${e.to}: ${old === Infinity ? "Inf" : old} -> ${newDist}.`;
        state.distances = { ...dist };
        state.parents = { ...parents };
        yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };
      }
    }

    if (!changed) {
      state.step++;
      state.description = `Iter ${i + 1}: No changes, converged early.`;
      state.distances = { ...dist };
      yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };
      break;
    }

    for (const n of graph.nodes) {
      if (state.nodeStatuses[n.id] === "frontier" || state.nodeStatuses[n.id] === "processing") {
        state.nodeStatuses[n.id] = dist[n.id] < Infinity ? "visited" : "unvisited";
      }
    }
  }

  if (dist[endId] < Infinity) {
    let cur: string | null = endId;
    while (cur !== null) {
      state.nodeStatuses[cur] = "path";
      const p: string | null | undefined = parents[cur];
      if (p !== null && p !== undefined) {
        state.edgeStatuses.set(edgeKey(p, cur), "result");
        if (!graph.directed) state.edgeStatuses.set(edgeKey(cur, p), "result");
      }
      cur = p ?? null;
    }
    state.step++;
    state.description = `Bellman-Ford: shortest path ${startId}->${endId} = ${dist[endId]}.`;
  } else {
    state.step++;
    state.description = `Bellman-Ford: No path from ${startId} to ${endId}.`;
  }
  state.distances = { ...dist };
  state.parents = { ...parents };
  state.dataStructure = [];
  yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };
}

function* primGenerator(graph: Graph, startId: string): Generator<AlgorithmStep> {
  const state = initStep(graph);
  const inMST = new Set<string>();
  const edgesInMST: Array<{ from: string; to: string }> = [];
  const pq: Array<{ from: string; to: string; weight: number }> = [];
  let totalWeight = 0;

  inMST.add(startId);
  state.nodeStatuses[startId] = "visited";

  for (const neighbor of getNeighbors(graph, startId)) {
    pq.push({ from: startId, to: neighbor.id, weight: neighbor.weight });
  }
  pq.sort((a, b) => a.weight - b.weight);

  state.dataStructure = pq.map((e) => `${e.from}-${e.to}(${e.weight})`);
  state.description = `Prim: Start from ${startId}. Add its edges to PQ.`;
  state.step = 1;
  yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };

  while (pq.length > 0 && inMST.size < graph.nodes.length) {
    pq.sort((a, b) => a.weight - b.weight);
    const cheapest = pq.shift()!;

    if (inMST.has(cheapest.to)) {
      state.step++;
      state.description = `Skip edge ${cheapest.from}-${cheapest.to}: ${cheapest.to} already in MST.`;
      state.dataStructure = pq.map((e) => `${e.from}-${e.to}(${e.weight})`);
      yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };
      continue;
    }

    state.edgeStatuses.set(edgeKey(cheapest.from, cheapest.to), "exploring");
    state.nodeStatuses[cheapest.to] = "processing";
    state.step++;
    state.description = `Add edge ${cheapest.from}-${cheapest.to} (w=${cheapest.weight}) to MST.`;
    yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: pq.map((e) => `${e.from}-${e.to}(${e.weight})`) };

    inMST.add(cheapest.to);
    edgesInMST.push({ from: cheapest.from, to: cheapest.to });
    totalWeight += cheapest.weight;
    state.edgeStatuses.set(edgeKey(cheapest.from, cheapest.to), "result");
    if (!graph.directed) state.edgeStatuses.set(edgeKey(cheapest.to, cheapest.from), "result");
    state.nodeStatuses[cheapest.to] = "visited";

    for (const neighbor of getNeighbors(graph, cheapest.to)) {
      if (!inMST.has(neighbor.id)) {
        pq.push({ from: cheapest.to, to: neighbor.id, weight: neighbor.weight });
        if (state.nodeStatuses[neighbor.id] === "unvisited") {
          state.nodeStatuses[neighbor.id] = "frontier";
        }
      }
    }

    state.dataStructure = pq.filter((e) => !inMST.has(e.to)).map((e) => `${e.from}-${e.to}(${e.weight})`);
    state.step++;
    state.description = `Node ${cheapest.to} added. MST weight so far: ${totalWeight}.`;
    yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };
  }

  state.step++;
  state.description = `Prim's MST complete. Total weight: ${totalWeight}. Edges: ${edgesInMST.length}.`;
  state.dataStructure = [];
  yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };
}

// Union-Find for Kruskal
class UnionFind {
  parent: Record<string, string>;
  rank: Record<string, number>;

  constructor(nodes: string[]) {
    this.parent = {};
    this.rank = {};
    for (const n of nodes) {
      this.parent[n] = n;
      this.rank[n] = 0;
    }
  }

  find(x: string): string {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]);
    }
    return this.parent[x];
  }

  union(a: string, b: string): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    if (this.rank[ra] < this.rank[rb]) {
      this.parent[ra] = rb;
    } else if (this.rank[ra] > this.rank[rb]) {
      this.parent[rb] = ra;
    } else {
      this.parent[rb] = ra;
      this.rank[ra]++;
    }
    return true;
  }
}

function* kruskalGenerator(graph: Graph): Generator<AlgorithmStep> {
  const state = initStep(graph);
  const sortedEdges = [...graph.edges].sort((a, b) => a.weight - b.weight);
  const uf = new UnionFind(graph.nodes.map((n) => n.id));
  const mstEdges: GraphEdge[] = [];
  let totalWeight = 0;

  state.dataStructure = sortedEdges.map((e) => `${e.from}-${e.to}(${e.weight})`);
  state.description = `Kruskal: Sort ${sortedEdges.length} edges by weight. Union-Find initialized.`;
  state.step = 1;
  yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };

  for (const edge of sortedEdges) {
    state.edgeStatuses.set(edgeKey(edge.from, edge.to), "exploring");
    state.nodeStatuses[edge.from] = state.nodeStatuses[edge.from] === "unvisited" ? "processing" : state.nodeStatuses[edge.from];
    state.nodeStatuses[edge.to] = state.nodeStatuses[edge.to] === "unvisited" ? "processing" : state.nodeStatuses[edge.to];
    state.step++;
    state.description = `Consider edge ${edge.from}-${edge.to} (w=${edge.weight}).`;
    yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };

    if (uf.union(edge.from, edge.to)) {
      mstEdges.push(edge);
      totalWeight += edge.weight;
      state.edgeStatuses.set(edgeKey(edge.from, edge.to), "result");
      if (!graph.directed) state.edgeStatuses.set(edgeKey(edge.to, edge.from), "result");
      state.nodeStatuses[edge.from] = "visited";
      state.nodeStatuses[edge.to] = "visited";
      state.step++;
      state.description = `Added ${edge.from}-${edge.to} to MST (w=${edge.weight}). Total: ${totalWeight}.`;
    } else {
      state.edgeStatuses.set(edgeKey(edge.from, edge.to), "default");
      state.step++;
      state.description = `Skip ${edge.from}-${edge.to}: would create cycle.`;
    }
    state.dataStructure = sortedEdges
      .filter((e) => !mstEdges.includes(e) && e !== edge)
      .map((e) => `${e.from}-${e.to}(${e.weight})`);
    yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };

    if (mstEdges.length === graph.nodes.length - 1) break;
  }

  state.step++;
  state.description = `Kruskal's MST complete. Total weight: ${totalWeight}. Edges: ${mstEdges.length}.`;
  state.dataStructure = [];
  yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };
}

function* topoSortGenerator(graph: Graph): Generator<AlgorithmStep> {
  const state = initStep(graph);
  const inDegree: Record<string, number> = {};
  for (const n of graph.nodes) inDegree[n.id] = 0;
  for (const e of graph.edges) inDegree[e.to]++;

  const queue: string[] = [];
  for (const n of graph.nodes) {
    if (inDegree[n.id] === 0) {
      queue.push(n.id);
      state.nodeStatuses[n.id] = "frontier";
    }
  }

  const result: string[] = [];
  state.dataStructure = [...queue];
  state.description = `Topological Sort: nodes with in-degree 0: [${queue.join(", ")}].`;
  state.step = 1;
  yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    state.nodeStatuses[current] = "processing";
    state.step++;
    state.description = `Process ${current}. Order so far: [${result.join(", ")}].`;
    state.dataStructure = [...queue];
    yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };

    for (const e of graph.edges) {
      if (e.from === current) {
        state.edgeStatuses.set(edgeKey(e.from, e.to), "exploring");
        inDegree[e.to]--;
        if (inDegree[e.to] === 0) {
          queue.push(e.to);
          state.nodeStatuses[e.to] = "frontier";
          state.edgeStatuses.set(edgeKey(e.from, e.to), "result");
        }
      }
    }
    state.nodeStatuses[current] = "visited";
    state.dataStructure = [...queue];
    state.step++;
    state.description = `${current} done. Queue: [${queue.join(", ")}].`;
    yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };
  }

  if (result.length < graph.nodes.length) {
    state.step++;
    state.description = `Cycle detected! Only ${result.length}/${graph.nodes.length} nodes sorted.`;
  } else {
    for (const id of result) state.nodeStatuses[id] = "path";
    state.step++;
    state.description = `Topological order: [${result.join(" -> ")}].`;
  }
  state.dataStructure = [];
  yield { ...state, nodeStatuses: { ...state.nodeStatuses }, edgeStatuses: new Map(state.edgeStatuses), dataStructure: [...state.dataStructure] };
}

// ─────────────────────────────────────────────────────────
// Canvas Rendering
// ─────────────────────────────────────────────────────────

function drawGraph(
  ctx: CanvasRenderingContext2D,
  graph: Graph,
  algorithmStep: AlgorithmStep | null,
  selectedNode: string | null,
  hoverNode: string | null,
  dragEdgeFrom: string | null,
  mousePos: { x: number; y: number } | null,
  dpr: number,
): void {
  const w = ctx.canvas.width / dpr;
  const h = ctx.canvas.height / dpr;
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const textColor = getComputedStyle(ctx.canvas).getPropertyValue("color").trim() || "#e4e4e7";
  const headingColor = getComputedStyle(ctx.canvas).getPropertyValue("--heading-color").trim() || "#ffffff";

  const nodeMap = new Map<string, GraphNode>();
  for (const n of graph.nodes) nodeMap.set(n.id, n);

  // Draw edges
  for (const e of graph.edges) {
    const from = nodeMap.get(e.from);
    const to = nodeMap.get(e.to);
    if (!from || !to) continue;

    let status: EdgeStatus = "default";
    if (algorithmStep) {
      status = getEdgeStatus(algorithmStep.edgeStatuses, e.from, e.to, graph.directed);
    }

    const color = EDGE_COLORS[status];
    const lineWidth = status === "result" ? 3 : status === "default" ? 1.5 : 2;

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    // Arrowhead for directed graphs
    if (graph.directed) {
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const arrowLen = 12;
      const arrowX = to.x - NODE_RADIUS * Math.cos(angle);
      const arrowY = to.y - NODE_RADIUS * Math.sin(angle);
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.moveTo(arrowX, arrowY);
      ctx.lineTo(
        arrowX - arrowLen * Math.cos(angle - Math.PI / 6),
        arrowY - arrowLen * Math.sin(angle - Math.PI / 6),
      );
      ctx.lineTo(
        arrowX - arrowLen * Math.cos(angle + Math.PI / 6),
        arrowY - arrowLen * Math.sin(angle + Math.PI / 6),
      );
      ctx.closePath();
      ctx.fill();
    }

    // Weight label
    if (e.weight !== 1 || graph.edges.some((ed) => ed.weight !== 1)) {
      const mx = (from.x + to.x) / 2;
      const my = (from.y + to.y) / 2;
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const offsetX = -10 * Math.sin(angle);
      const offsetY = 10 * Math.cos(angle);

      ctx.font = FONT_WEIGHT;
      ctx.fillStyle = status !== "default" ? color : textColor;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(e.weight), mx + offsetX, my + offsetY);
    }
  }

  // Draw edge being created
  if (dragEdgeFrom && mousePos) {
    const fromNode = nodeMap.get(dragEdgeFrom);
    if (fromNode) {
      ctx.beginPath();
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.moveTo(fromNode.x, fromNode.y);
      ctx.lineTo(mousePos.x, mousePos.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Draw nodes
  for (const node of graph.nodes) {
    let status: NodeStatus = "unvisited";
    if (algorithmStep) {
      status = algorithmStep.nodeStatuses[node.id] ?? "unvisited";
    }

    const isSelected = node.id === selectedNode;
    const isHover = node.id === hoverNode;
    const fillColor = NODE_COLORS[status];
    const radius = NODE_RADIUS + (isHover ? 3 : 0);

    // Glow for selected/active
    if (status !== "unvisited" || isSelected) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + 4, 0, Math.PI * 2);
      ctx.fillStyle = isSelected
        ? "rgba(79, 143, 247, 0.2)"
        : status === "processing"
          ? "rgba(239, 68, 68, 0.15)"
          : status === "path"
            ? "rgba(79, 143, 247, 0.15)"
            : "transparent";
      ctx.fill();
    }

    // Node circle
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fillColor;
    ctx.fill();

    if (isSelected) {
      ctx.strokeStyle = "#4f8ff7";
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Node label
    ctx.font = FONT;
    ctx.fillStyle = status === "unvisited" ? textColor : headingColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(node.id, node.x, node.y);
  }

  // Placeholder text when empty
  if (graph.nodes.length === 0) {
    ctx.font = FONT;
    ctx.fillStyle = textColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = 0.5;
    ctx.fillText("Click to add nodes", w / 2, h / 2 - 12);
    ctx.fillText("Drag between nodes to add edges", w / 2, h / 2 + 12);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

// ─────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────

export default function GraphAlgorithms() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const generatorRef = useRef<Generator<AlgorithmStep> | null>(null);
  const playIntervalRef = useRef<number>(0);

  const [graph, setGraph] = useState<Graph>(() => makePresets()[4].graph);
  const [algorithm, setAlgorithm] = useState<AlgorithmId>("dijkstra");
  const [startNode, setStartNode] = useState("A");
  const [endNode, setEndNode] = useState("F");
  const [speed, setSpeed] = useState(500);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState<AlgorithmStep | null>(null);
  const [isFinished, setIsFinished] = useState(false);

  // Interaction state
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [dragEdgeFrom, setDragEdgeFrom] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [nextLabel, setNextLabel] = useState(() => {
    const preset = makePresets()[4].graph;
    const labels = preset.nodes.map((n) => n.id);
    const maxCode = Math.max(...labels.map((l) => l.charCodeAt(0)), 64);
    return String.fromCharCode(maxCode + 1);
  });

  const algDef = ALGORITHMS.find((a) => a.id === algorithm)!;

  // ─── Canvas sizing & rendering ───

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    drawGraph(ctx, graph, currentStep, selectedNode, hoverNode, dragEdgeFrom, mousePos, dpr);
  }, [graph, currentStep, selectedNode, hoverNode, dragEdgeFrom, mousePos]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      render();
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [render]);

  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(() => render());
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [render]);

  // ─── Algorithm stepping ───

  const startAlgorithm = useCallback(() => {
    if (graph.nodes.length === 0) return;
    setIsFinished(false);
    setIsPlaying(false);
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = 0;
    }

    const start = graph.nodes.find((n) => n.id === startNode)?.id ?? graph.nodes[0].id;
    const end = graph.nodes.find((n) => n.id === endNode)?.id ?? graph.nodes[graph.nodes.length - 1].id;

    let gen: Generator<AlgorithmStep>;
    switch (algorithm) {
      case "bfs":
        gen = bfsGenerator(graph, start, end);
        break;
      case "dfs":
        gen = dfsGenerator(graph, start, end);
        break;
      case "dijkstra":
        gen = dijkstraGenerator(graph, start, end);
        break;
      case "astar":
        gen = astarGenerator(graph, start, end);
        break;
      case "bellman-ford":
        gen = bellmanFordGenerator(graph, start, end);
        break;
      case "prim":
        gen = primGenerator(graph, start);
        break;
      case "kruskal":
        gen = kruskalGenerator(graph);
        break;
      case "toposort":
        gen = topoSortGenerator(graph);
        break;
    }

    generatorRef.current = gen;
    const first = gen.next();
    if (!first.done) {
      setCurrentStep(first.value);
    }
  }, [graph, algorithm, startNode, endNode]);

  const stepForward = useCallback(() => {
    const gen = generatorRef.current;
    if (!gen) return;
    const next = gen.next();
    if (next.done) {
      setIsFinished(true);
      setIsPlaying(false);
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = 0;
      }
    } else {
      setCurrentStep(next.value);
    }
  }, []);

  const togglePlay = useCallback(() => {
    if (isFinished) return;
    if (isPlaying) {
      setIsPlaying(false);
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = 0;
      }
    } else {
      if (!generatorRef.current) {
        startAlgorithm();
      }
      setIsPlaying(true);
    }
  }, [isPlaying, isFinished, startAlgorithm]);

  useEffect(() => {
    if (isPlaying && !isFinished) {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
      playIntervalRef.current = window.setInterval(() => {
        stepForward();
      }, speed);
      return () => {
        if (playIntervalRef.current) {
          clearInterval(playIntervalRef.current);
          playIntervalRef.current = 0;
        }
      };
    }
  }, [isPlaying, isFinished, speed, stepForward]);

  const resetAlgorithm = useCallback(() => {
    setIsPlaying(false);
    setIsFinished(false);
    setCurrentStep(null);
    generatorRef.current = null;
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = 0;
    }
  }, []);

  // ─── Graph editing ───

  const getCanvasCoords = useCallback((e: MouseEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const findNodeAt = useCallback(
    (x: number, y: number): GraphNode | null => {
      for (const node of graph.nodes) {
        const dx = node.x - x;
        const dy = node.y - y;
        if (dx * dx + dy * dy <= (NODE_RADIUS + 5) ** 2) return node;
      }
      return null;
    },
    [graph.nodes],
  );

  const findEdgeAt = useCallback(
    (x: number, y: number): GraphEdge | null => {
      const nodeMap = new Map<string, GraphNode>();
      for (const n of graph.nodes) nodeMap.set(n.id, n);

      for (const e of graph.edges) {
        const from = nodeMap.get(e.from);
        const to = nodeMap.get(e.to);
        if (!from || !to) continue;

        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) continue;

        const t = Math.max(0, Math.min(1, ((x - from.x) * dx + (y - from.y) * dy) / (len * len)));
        const projX = from.x + t * dx;
        const projY = from.y + t * dy;
        const dist = Math.sqrt((x - projX) ** 2 + (y - projY) ** 2);
        if (dist < 8) return e;
      }
      return null;
    },
    [graph.nodes, graph.edges],
  );

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (e.button === 2) return;
      const pos = getCanvasCoords(e);
      const node = findNodeAt(pos.x, pos.y);

      if (node) {
        if (e.shiftKey) {
          setDragEdgeFrom(node.id);
          setMousePos(pos);
        } else {
          setDraggingNode(node.id);
          setSelectedNode(node.id);
        }
      }
    },
    [getCanvasCoords, findNodeAt],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      const pos = getCanvasCoords(e);
      setMousePos(pos);

      if (draggingNode) {
        setGraph((prev) => ({
          ...prev,
          nodes: prev.nodes.map((n) => (n.id === draggingNode ? { ...n, x: pos.x, y: pos.y } : n)),
        }));
        return;
      }

      const node = findNodeAt(pos.x, pos.y);
      setHoverNode(node?.id ?? null);
    },
    [getCanvasCoords, draggingNode, findNodeAt],
  );

  const handleMouseUp = useCallback(
    (e: MouseEvent) => {
      const pos = getCanvasCoords(e);

      if (dragEdgeFrom) {
        const targetNode = findNodeAt(pos.x, pos.y);
        if (targetNode && targetNode.id !== dragEdgeFrom) {
          const exists = graph.edges.some(
            (ed) =>
              (ed.from === dragEdgeFrom && ed.to === targetNode.id) ||
              (!graph.directed && ed.from === targetNode.id && ed.to === dragEdgeFrom),
          );
          if (!exists) {
            const weightStr = prompt("Edge weight:", "1");
            const weight = weightStr ? parseInt(weightStr, 10) : 1;
            setGraph((prev) => ({
              ...prev,
              edges: [...prev.edges, { from: dragEdgeFrom!, to: targetNode.id, weight: isNaN(weight) ? 1 : weight }],
            }));
            resetAlgorithm();
          }
        }
        setDragEdgeFrom(null);
        setMousePos(null);
        return;
      }

      if (draggingNode) {
        setDraggingNode(null);
        return;
      }

      if (e.button === 0 && !findNodeAt(pos.x, pos.y)) {
        const label = nextLabel;
        setGraph((prev) => ({
          ...prev,
          nodes: [...prev.nodes, { id: label, x: pos.x, y: pos.y }],
        }));
        setNextLabel(String.fromCharCode(label.charCodeAt(0) + 1));
        resetAlgorithm();
      }
    },
    [getCanvasCoords, dragEdgeFrom, draggingNode, findNodeAt, graph, nextLabel, resetAlgorithm],
  );

  const handleContextMenu = useCallback(
    (e: Event) => {
      e.preventDefault();
      const me = e as MouseEvent;
      const pos = getCanvasCoords(me);
      const node = findNodeAt(pos.x, pos.y);
      if (node) {
        setGraph((prev) => ({
          ...prev,
          nodes: prev.nodes.filter((n) => n.id !== node.id),
          edges: prev.edges.filter((ed) => ed.from !== node.id && ed.to !== node.id),
        }));
        if (selectedNode === node.id) setSelectedNode(null);
        resetAlgorithm();
        return;
      }
      const edge = findEdgeAt(pos.x, pos.y);
      if (edge) {
        setGraph((prev) => ({
          ...prev,
          edges: prev.edges.filter((ed) => ed !== edge),
        }));
        resetAlgorithm();
      }
    },
    [getCanvasCoords, findNodeAt, findEdgeAt, selectedNode, resetAlgorithm],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedNode) {
        setGraph((prev) => ({
          ...prev,
          nodes: prev.nodes.filter((n) => n.id !== selectedNode),
          edges: prev.edges.filter((ed) => ed.from !== selectedNode && ed.to !== selectedNode),
        }));
        setSelectedNode(null);
        resetAlgorithm();
      }
    },
    [selectedNode, resetAlgorithm],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleDoubleClick = useCallback(
    (e: MouseEvent) => {
      const pos = getCanvasCoords(e);
      const edge = findEdgeAt(pos.x, pos.y);
      if (edge) {
        const weightStr = prompt("Set edge weight:", String(edge.weight));
        if (weightStr !== null) {
          const weight = parseInt(weightStr, 10);
          if (!isNaN(weight)) {
            setGraph((prev) => ({
              ...prev,
              edges: prev.edges.map((ed) => (ed === edge ? { ...ed, weight } : ed)),
            }));
            resetAlgorithm();
          }
        }
      }
    },
    [getCanvasCoords, findEdgeAt, resetAlgorithm],
  );

  // ─── Preset loading ───

  const loadPreset = useCallback(
    (index: number) => {
      const presets = makePresets();
      const preset = presets[index];
      if (!preset) return;
      setGraph(preset.graph);
      setCurrentStep(null);
      setIsPlaying(false);
      setIsFinished(false);
      generatorRef.current = null;
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = 0;
      }
      const labels = preset.graph.nodes.map((n) => n.id);
      const maxCode = Math.max(...labels.map((l) => l.charCodeAt(0)), 64);
      setNextLabel(String.fromCharCode(maxCode + 1));
      if (preset.graph.nodes.length > 0) {
        setStartNode(preset.graph.nodes[0].id);
        setEndNode(preset.graph.nodes[preset.graph.nodes.length - 1].id);
      }
    },
    [],
  );

  const clearGraph = useCallback(() => {
    setGraph({ nodes: [], edges: [], directed: graph.directed });
    setCurrentStep(null);
    setIsPlaying(false);
    setIsFinished(false);
    generatorRef.current = null;
    setNextLabel("A");
    setSelectedNode(null);
  }, [graph.directed]);

  const toggleDirected = useCallback(() => {
    setGraph((prev) => ({ ...prev, directed: !prev.directed }));
    resetAlgorithm();
  }, [resetAlgorithm]);

  // ─── Data structure label ───

  const dsLabel = (() => {
    switch (algorithm) {
      case "bfs":
      case "toposort":
        return "Queue";
      case "dfs":
        return "Stack";
      case "dijkstra":
      case "astar":
        return "Priority Queue";
      case "bellman-ford":
        return "Iteration";
      case "prim":
        return "Edge PQ";
      case "kruskal":
        return "Remaining Edges";
    }
  })();

  // ─── Render ───

  return (
    <div class="flex flex-col gap-4">
      {/* Top controls bar */}
      <div class="flex flex-wrap items-center gap-3">
        <label class="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
          <input
            type="checkbox"
            checked={graph.directed}
            onChange={toggleDirected}
            class="accent-[var(--color-primary)]"
          />
          Directed
        </label>

        <select
          value={algorithm}
          onChange={(e) => {
            setAlgorithm((e.target as HTMLSelectElement).value as AlgorithmId);
            resetAlgorithm();
          }}
          class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)]"
        >
          {ALGORITHMS.map((a) => (
            <option key={a.id} value={a.id} disabled={a.needsDirected && !graph.directed}>
              {a.name}
              {a.needsDirected ? " (directed)" : ""}
            </option>
          ))}
        </select>

        {algDef.needsEnd && (
          <>
            <label class="text-xs text-[var(--color-text-muted)]">
              Start:
              <select
                value={startNode}
                onChange={(e) => { setStartNode((e.target as HTMLSelectElement).value); resetAlgorithm(); }}
                class="ml-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5 text-xs text-[var(--color-text)]"
              >
                {graph.nodes.map((n) => (
                  <option key={n.id} value={n.id}>{n.id}</option>
                ))}
              </select>
            </label>
            <label class="text-xs text-[var(--color-text-muted)]">
              End:
              <select
                value={endNode}
                onChange={(e) => { setEndNode((e.target as HTMLSelectElement).value); resetAlgorithm(); }}
                class="ml-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5 text-xs text-[var(--color-text)]"
              >
                {graph.nodes.map((n) => (
                  <option key={n.id} value={n.id}>{n.id}</option>
                ))}
              </select>
            </label>
          </>
        )}

        {!algDef.needsEnd && (
          <label class="text-xs text-[var(--color-text-muted)]">
            Start:
            <select
              value={startNode}
              onChange={(e) => { setStartNode((e.target as HTMLSelectElement).value); resetAlgorithm(); }}
              class="ml-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5 text-xs text-[var(--color-text)]"
            >
              {graph.nodes.map((n) => (
                <option key={n.id} value={n.id}>{n.id}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* Main layout */}
      <div class="flex flex-col gap-4 lg:flex-row">
        {/* Canvas */}
        <div class="relative min-h-[400px] flex-1 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
          <canvas
            ref={canvasRef}
            class="block h-full w-full cursor-crosshair"
            style={{ color: "var(--color-text)", "--heading-color": "var(--color-heading)" } as any}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onDblClick={handleDoubleClick}
            onContextMenu={handleContextMenu}
          />
          <div class="pointer-events-none absolute bottom-2 left-2 text-[10px] text-[var(--color-text-muted)] opacity-60">
            Click: add node | Shift+drag: edge | Right-click: delete | Double-click edge: set weight
          </div>
        </div>

        {/* Side panel */}
        <div class="flex w-full flex-col gap-3 lg:w-72">
          {/* Algorithm info */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div class="mb-1 text-xs font-semibold text-[var(--color-heading)]">{algDef.name}</div>
            <p class="mb-2 text-[11px] leading-relaxed text-[var(--color-text-muted)]">{algDef.description}</p>
            <div class="text-[10px] text-[var(--color-text-muted)]">Complexity: {algDef.complexity}</div>
          </div>

          {/* Playback controls */}
          <div class="flex items-center gap-2">
            <button
              onClick={() => { if (!generatorRef.current) startAlgorithm(); togglePlay(); }}
              disabled={graph.nodes.length === 0}
              class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-40"
            >
              {isPlaying ? "Pause" : isFinished ? "Done" : "Play"}
            </button>
            <button
              onClick={() => { if (!generatorRef.current) startAlgorithm(); else stepForward(); }}
              disabled={isFinished || graph.nodes.length === 0}
              class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs text-[var(--color-text)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-40"
            >
              Step
            </button>
            <button
              onClick={resetAlgorithm}
              class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs text-[var(--color-text)] transition-colors hover:border-[var(--color-text-muted)]"
            >
              Reset
            </button>
          </div>

          {/* Speed */}
          <label class="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            Speed:
            <input
              type="range"
              min={50}
              max={1500}
              step={50}
              value={1550 - speed}
              onInput={(e) => setSpeed(1550 - parseInt((e.target as HTMLInputElement).value, 10))}
              class="flex-1 accent-[var(--color-primary)]"
            />
          </label>

          {/* Presets */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div class="mb-2 text-xs font-semibold text-[var(--color-heading)]">Presets</div>
            <div class="flex flex-wrap gap-1">
              {makePresets().map((p, i) => (
                <button
                  key={p.name}
                  onClick={() => loadPreset(i)}
                  class="rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                >
                  {p.name}
                </button>
              ))}
              <button
                onClick={clearGraph}
                class="rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-red-400 transition-colors hover:border-red-400"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Algorithm state */}
          {currentStep && (
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <div class="mb-2 text-xs font-semibold text-[var(--color-heading)]">State (Step {currentStep.step})</div>

              <p class="mb-2 text-[11px] leading-relaxed text-[var(--color-text)]">{currentStep.description}</p>

              {currentStep.dataStructure.length > 0 && (
                <div class="mb-2">
                  <span class="text-[10px] font-medium text-[var(--color-text-muted)]">{dsLabel}: </span>
                  <span class="font-mono text-[10px] text-[var(--color-accent)]">
                    [{currentStep.dataStructure.join(", ")}]
                  </span>
                </div>
              )}

              {currentStep.distances && (
                <div class="mb-2">
                  <span class="text-[10px] font-medium text-[var(--color-text-muted)]">Distances: </span>
                  <div class="mt-1 font-mono text-[10px] text-[var(--color-text)]">
                    {Object.entries(currentStep.distances)
                      .filter(([, d]) => d < Infinity)
                      .map(([id, d]) => `${id}=${typeof d === "number" ? (Number.isInteger(d) ? d : d.toFixed(1)) : d}`)
                      .join(", ")}
                  </div>
                </div>
              )}

              {currentStep.parents && (
                <div>
                  <span class="text-[10px] font-medium text-[var(--color-text-muted)]">Parent: </span>
                  <div class="mt-1 font-mono text-[10px] text-[var(--color-text)]">
                    {Object.entries(currentStep.parents)
                      .filter(([, p]) => p !== null)
                      .map(([id, p]) => `${id}<-${p}`)
                      .join(", ")}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Color legend */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div class="mb-2 text-xs font-semibold text-[var(--color-heading)]">Legend</div>
            <div class="grid grid-cols-2 gap-x-3 gap-y-1">
              <div class="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
                <span class="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--color-border)" }} />
                Unvisited
              </div>
              <div class="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
                <span class="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#f59e0b" }} />
                Frontier
              </div>
              <div class="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
                <span class="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#ef4444" }} />
                Processing
              </div>
              <div class="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
                <span class="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#34d399" }} />
                Visited/MST
              </div>
              <div class="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
                <span class="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#4f8ff7" }} />
                Path/Relaxed
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
