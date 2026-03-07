import { useState, useEffect, useRef, useCallback } from "preact/hooks";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

interface LoopyNode {
  id: number;
  name: string;
  value: number;
  x: number;
  y: number;
  initialValue: number;
}

interface LoopyEdge {
  from: number;
  to: number;
  polarity: 1 | -1;
  strength: number;
}

interface HistoryPoint {
  step: number;
  values: Record<number, number>;
}

interface PresetEdge {
  fromIdx: number;
  toIdx: number;
  polarity: 1 | -1;
  strength: number;
}

interface Preset {
  name: string;
  nodes: Omit<LoopyNode, "id">[];
  edges: PresetEdge[];
}

type InteractionMode = "select" | "add-node" | "add-edge-source" | "add-edge-target";

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const NODE_BASE_RADIUS = 28;
const NODE_MAX_RADIUS = 48;
const ARROW_SIZE = 10;
const FONT = "13px Inter, system-ui, sans-serif";
const FONT_BOLD = "bold 13px Inter, system-ui, sans-serif";
const FONT_SMALL = "11px Inter, system-ui, sans-serif";

const NODE_COLORS = [
  "#4f8ff7", "#34d399", "#f59e0b", "#ef4444",
  "#a855f7", "#ec4899", "#14b8a6", "#f97316",
  "#6366f1", "#84cc16",
];

const PRESETS: Preset[] = [
  {
    name: "Predator-Prey",
    nodes: [
      { name: "Rabbits", value: 70, x: 200, y: 200, initialValue: 70 },
      { name: "Foxes", value: 30, x: 450, y: 200, initialValue: 30 },
    ],
    edges: [
      { fromIdx: 0, toIdx: 1, polarity: 1, strength: 0.4 },
      { fromIdx: 1, toIdx: 0, polarity: -1, strength: 0.5 },
    ],
  },
  {
    name: "Thermostat",
    nodes: [
      { name: "Temperature", value: 40, x: 320, y: 100, initialValue: 40 },
      { name: "Heater", value: 60, x: 180, y: 300, initialValue: 60 },
      { name: "Gap", value: 50, x: 460, y: 300, initialValue: 50 },
    ],
    edges: [
      { fromIdx: 1, toIdx: 0, polarity: 1, strength: 0.5 },
      { fromIdx: 0, toIdx: 2, polarity: -1, strength: 0.4 },
      { fromIdx: 2, toIdx: 1, polarity: 1, strength: 0.3 },
    ],
  },
  {
    name: "Economic Cycle",
    nodes: [
      { name: "Demand", value: 60, x: 320, y: 80, initialValue: 60 },
      { name: "Production", value: 50, x: 500, y: 220, initialValue: 50 },
      { name: "Employment", value: 55, x: 320, y: 360, initialValue: 55 },
      { name: "Wages", value: 45, x: 140, y: 220, initialValue: 45 },
    ],
    edges: [
      { fromIdx: 0, toIdx: 1, polarity: 1, strength: 0.3 },
      { fromIdx: 1, toIdx: 2, polarity: 1, strength: 0.3 },
      { fromIdx: 2, toIdx: 3, polarity: 1, strength: 0.3 },
      { fromIdx: 3, toIdx: 0, polarity: 1, strength: 0.3 },
      { fromIdx: 1, toIdx: 0, polarity: -1, strength: 0.15 },
    ],
  },
];

// ─────────────────────────────────────────────────────────
// Drawing helpers
// ─────────────────────────────────────────────────────────

function getCssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function nodeRadius(value: number): number {
  return NODE_BASE_RADIUS + (value / 100) * (NODE_MAX_RADIUS - NODE_BASE_RADIUS);
}

function drawCurvedArrow(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, r1: number,
  x2: number, y2: number, r2: number,
  color: string,
  polarity: 1 | -1,
  animPhase: number,
  bidirectional: boolean,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return;

  const angle = Math.atan2(dy, dx);

  const curveOffset = bidirectional ? 30 : 0;
  const perpX = -Math.sin(angle) * curveOffset;
  const perpY = Math.cos(angle) * curveOffset;

  const mx = (x1 + x2) / 2 + perpX;
  const my = (y1 + y2) / 2 + perpY;

  const startAngle = Math.atan2(my - y1, mx - x1);
  const sx = x1 + r1 * Math.cos(startAngle);
  const sy = y1 + r1 * Math.sin(startAngle);

  const endAngle = Math.atan2(my - y2, mx - x2);
  const ex = x2 + r2 * Math.cos(endAngle + Math.PI);
  const ey = y2 + r2 * Math.sin(endAngle + Math.PI);

  const arrAngle = Math.atan2(ey - my, ex - mx);

  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.quadraticCurveTo(mx, my, ex, ey);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Arrow head
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(
    ex - ARROW_SIZE * Math.cos(arrAngle - Math.PI / 6),
    ey - ARROW_SIZE * Math.sin(arrAngle - Math.PI / 6),
  );
  ctx.lineTo(
    ex - ARROW_SIZE * Math.cos(arrAngle + Math.PI / 6),
    ey - ARROW_SIZE * Math.sin(arrAngle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  // Polarity label
  const labelX = mx;
  const labelY = my - 10;
  ctx.font = FONT_BOLD;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(polarity === 1 ? "+" : "-", labelX, labelY);

  // Animated dot
  const t = (animPhase % 1);
  const dotX = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * mx + t * t * ex;
  const dotY = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * my + t * t * ey;
  ctx.beginPath();
  ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.7;
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  node: LoopyNode,
  colorIdx: number,
  selected: boolean,
  isLinkSource: boolean,
  pulse: number,
) {
  const r = nodeRadius(node.value);
  const color = NODE_COLORS[colorIdx % NODE_COLORS.length];

  // Pulse ring
  if (pulse > 0) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, r + 4 + pulse * 6, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.3 * (1 - pulse);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Value fill (arc representing current value)
  ctx.beginPath();
  ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
  ctx.fillStyle = getCssVar("--color-surface", "#111");
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(node.x, node.y);
  ctx.arc(node.x, node.y, r, -Math.PI / 2, -Math.PI / 2 + (node.value / 100) * Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = color + "40";
  ctx.fill();

  // Border
  ctx.beginPath();
  ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
  ctx.strokeStyle = selected ? "#f59e0b" : isLinkSource ? "#a855f7" : color;
  ctx.lineWidth = selected || isLinkSource ? 3 : 2;
  ctx.stroke();

  // Name
  ctx.font = FONT_BOLD;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = getCssVar("--color-heading", "#fff");
  const maxLabelWidth = r * 1.6;
  let label = node.name;
  if (ctx.measureText(label).width > maxLabelWidth) {
    while (ctx.measureText(label + "..").width > maxLabelWidth && label.length > 2) {
      label = label.slice(0, -1);
    }
    label += "..";
  }
  ctx.fillText(label, node.x, node.y - 6);

  // Value
  ctx.font = FONT_SMALL;
  ctx.fillStyle = getCssVar("--color-text-muted", "#a1a1aa");
  ctx.fillText(Math.round(node.value).toString(), node.x, node.y + 10);
}

// ─────────────────────────────────────────────────────────
// Chart drawing
// ─────────────────────────────────────────────────────────

function drawChart(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  history: HistoryPoint[],
  nodes: LoopyNode[],
) {
  ctx.clearRect(0, 0, width, height);

  const bgColor = getCssVar("--color-bg", "#09090b");
  const borderColor = getCssVar("--color-border", "#27272a");
  const mutedColor = getCssVar("--color-text-muted", "#a1a1aa");

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);

  const padL = 40;
  const padR = 10;
  const padT = 20;
  const padB = 30;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  // Grid
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 0.5;
  for (let v = 0; v <= 100; v += 25) {
    const y = padT + plotH * (1 - v / 100);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();

    ctx.font = "10px Inter, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillStyle = mutedColor;
    ctx.fillText(v.toString(), padL - 4, y + 4);
  }

  if (history.length < 2) {
    ctx.font = FONT;
    ctx.textAlign = "center";
    ctx.fillStyle = mutedColor;
    ctx.fillText("Run simulation to see chart", width / 2, height / 2);
    return;
  }

  const maxStep = history[history.length - 1].step;
  const minStep = history[0].step;
  const range = maxStep - minStep || 1;

  // X axis labels
  ctx.font = "10px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = mutedColor;
  for (let i = 0; i <= 4; i++) {
    const step = Math.round(minStep + (range * i) / 4);
    const x = padL + (plotW * i) / 4;
    ctx.fillText(step.toString(), x, height - 6);
  }

  // Lines
  for (let ni = 0; ni < nodes.length; ni++) {
    const node = nodes[ni];
    const color = NODE_COLORS[ni % NODE_COLORS.length];

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    let started = false;
    for (const point of history) {
      const val = point.values[node.id];
      if (val === undefined) continue;
      const x = padL + ((point.step - minStep) / range) * plotW;
      const y = padT + plotH * (1 - val / 100);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  // Legend
  const legendX = padL + 10;
  let legendY = padT + 10;
  for (let ni = 0; ni < nodes.length; ni++) {
    const color = NODE_COLORS[ni % NODE_COLORS.length];
    ctx.fillStyle = color;
    ctx.fillRect(legendX, legendY - 4, 12, 3);
    ctx.font = "10px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(nodes[ni].name, legendX + 16, legendY);
    legendY += 14;
  }
}

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

export default function Loopy() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const [nodes, setNodes] = useState<LoopyNode[]>([]);
  const [edges, setEdges] = useState<LoopyEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<number | null>(null);
  const [mode, setMode] = useState<InteractionMode>("select");
  const [edgeSource, setEdgeSource] = useState<number | null>(null);
  const [dragging, setDragging] = useState<{ id: number; ox: number; oy: number } | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [animPhase, setAnimPhase] = useState(0);
  const [pulses, setPulses] = useState<Record<number, number>>({});
  const nextId = useRef(1);
  const simRef = useRef<number>(0);
  const animRef = useRef<number>(0);
  const stepRef = useRef(0);

  // ── Drawing ──
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

    ctx.clearRect(0, 0, rect.width, rect.height);

    // Determine bidirectional edges
    const edgePairs = new Set<string>();
    const bidir = new Set<string>();
    for (const e of edges) {
      const key = `${e.from}-${e.to}`;
      const rev = `${e.to}-${e.from}`;
      if (edgePairs.has(rev)) {
        bidir.add(key);
        bidir.add(rev);
      }
      edgePairs.add(key);
    }

    // Draw edges
    for (const edge of edges) {
      const fromNode = nodes.find(n => n.id === edge.from);
      const toNode = nodes.find(n => n.id === edge.to);
      if (!fromNode || !toNode) continue;

      const color = edge.polarity === 1 ? "#34d399" : "#ef4444";
      const key = `${edge.from}-${edge.to}`;
      const isBidir = bidir.has(key);

      drawCurvedArrow(
        ctx,
        fromNode.x, fromNode.y, nodeRadius(fromNode.value),
        toNode.x, toNode.y, nodeRadius(toNode.value),
        color, edge.polarity,
        simulating ? animPhase : 0,
        isBidir,
      );
    }

    // Draw nodes
    const nodeIds = nodes.map(n => n.id);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      drawNode(
        ctx, node, i,
        selectedNode === node.id,
        mode === "add-edge-target" && edgeSource === node.id,
        simulating ? (pulses[node.id] || 0) : 0,
      );
    }
  }, [nodes, edges, selectedNode, mode, edgeSource, simulating, animPhase, pulses]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Chart
  useEffect(() => {
    const canvas = chartRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    drawChart(ctx, rect.width, rect.height, history, nodes);
  }, [history, nodes]);

  // ── Simulation ──
  const simulate = useCallback(() => {
    setNodes(prev => {
      const newNodes = prev.map(n => {
        let delta = 0;
        for (const edge of edges) {
          if (edge.to !== n.id) continue;
          const source = prev.find(s => s.id === edge.from);
          if (!source) continue;
          const influence = ((source.value - 50) / 50) * edge.polarity * edge.strength * (speed / 5);
          delta += influence;
        }
        const newVal = clamp(n.value + delta, 0, 100);
        return { ...n, value: newVal };
      });
      return newNodes;
    });
  }, [edges, speed]);

  useEffect(() => {
    if (!simulating) {
      if (simRef.current) clearInterval(simRef.current);
      return;
    }

    simRef.current = window.setInterval(() => {
      simulate();
      stepRef.current++;

      setNodes(curr => {
        const vals: Record<number, number> = {};
        for (const n of curr) vals[n.id] = n.value;
        setHistory(prev => {
          const next = [...prev, { step: stepRef.current, values: vals }];
          return next.length > 500 ? next.slice(-500) : next;
        });
        return curr;
      });
    }, 100);

    return () => {
      if (simRef.current) clearInterval(simRef.current);
    };
  }, [simulating, simulate]);

  // Animation loop for edge dots and pulses
  useEffect(() => {
    if (!simulating) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      return;
    }

    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setAnimPhase(p => (p + dt * 0.8) % 1);
      setPulses(prev => {
        const next: Record<number, number> = {};
        for (const [k, v] of Object.entries(prev)) {
          const nv = v + dt;
          if (nv < 1) next[Number(k)] = nv;
        }
        return next;
      });
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [simulating]);

  // ── Mouse handlers ──
  const getNodeAt = useCallback((x: number, y: number): LoopyNode | null => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const r = nodeRadius(n.value);
      const dx = n.x - x;
      const dy = n.y - y;
      if (dx * dx + dy * dy <= r * r) return n;
    }
    return null;
  }, [nodes]);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const node = getNodeAt(x, y);

    if (mode === "add-node") {
      const id = nextId.current++;
      const newNode: LoopyNode = {
        id, name: `Var ${id}`, value: 50, x, y, initialValue: 50,
      };
      setNodes(prev => [...prev, newNode]);
      setSelectedNode(id);
      setMode("select");
      return;
    }

    if (mode === "add-edge-source" && node) {
      setEdgeSource(node.id);
      setMode("add-edge-target");
      return;
    }

    if (mode === "add-edge-target" && node && edgeSource !== null) {
      if (node.id !== edgeSource) {
        const exists = edges.some(e => e.from === edgeSource && e.to === node.id);
        if (!exists) {
          setEdges(prev => [...prev, { from: edgeSource, to: node.id, polarity: 1, strength: 0.3 }]);
        }
      }
      setEdgeSource(null);
      setMode("select");
      return;
    }

    if (mode === "select" && node) {
      setSelectedNode(node.id);
      setDragging({ id: node.id, ox: x - node.x, oy: y - node.y });
    } else if (mode === "select") {
      setSelectedNode(null);
    }
  }, [mode, getNodeAt, edgeSource, edges]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - dragging.ox;
    const y = e.clientY - rect.top - dragging.oy;
    setNodes(prev => prev.map(n => n.id === dragging.id ? { ...n, x, y } : n));
  }, [dragging]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  const resetValues = useCallback(() => {
    setNodes(prev => prev.map(n => ({ ...n, value: n.initialValue })));
    setHistory([]);
    stepRef.current = 0;
    setSimulating(false);
  }, []);

  const clearAll = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setSelectedNode(null);
    setHistory([]);
    stepRef.current = 0;
    setSimulating(false);
    nextId.current = 1;
  }, []);

  const deleteSelectedNode = useCallback(() => {
    if (selectedNode === null) return;
    setNodes(prev => prev.filter(n => n.id !== selectedNode));
    setEdges(prev => prev.filter(e => e.from !== selectedNode && e.to !== selectedNode));
    setSelectedNode(null);
  }, [selectedNode]);

  const loadPreset = useCallback((preset: Preset) => {
    clearAll();
    const newNodes: LoopyNode[] = preset.nodes.map((n, i) => ({
      ...n,
      id: i + 1,
    }));
    const newEdges: LoopyEdge[] = preset.edges.map(e => ({
      from: e.fromIdx + 1,
      to: e.toIdx + 1,
      polarity: e.polarity,
      strength: e.strength,
    }));
    setNodes(newNodes);
    setEdges(newEdges);
    nextId.current = newNodes.length + 1;
  }, [clearAll]);

  const selectedNodeData = nodes.find(n => n.id === selectedNode);
  const selectedEdges = edges.filter(e => e.from === selectedNode || e.to === selectedNode);

  return (
    <div class="flex flex-col gap-4">
      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-2">
        <button
          onClick={() => { setMode("select"); setEdgeSource(null); }}
          class={`rounded px-3 py-1.5 text-xs font-medium transition ${mode === "select" ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border)]"}`}
        >
          Select
        </button>
        <button
          onClick={() => setMode("add-node")}
          class={`rounded px-3 py-1.5 text-xs font-medium transition ${mode === "add-node" ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border)]"}`}
        >
          + Node
        </button>
        <button
          onClick={() => { setMode("add-edge-source"); setEdgeSource(null); }}
          class={`rounded px-3 py-1.5 text-xs font-medium transition ${mode === "add-edge-source" || mode === "add-edge-target" ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border)]"}`}
        >
          + Edge
        </button>
        <div class="mx-1 h-5 w-px bg-[var(--color-border)]" />
        <button
          onClick={() => setSimulating(!simulating)}
          class={`rounded px-3 py-1.5 text-xs font-medium transition ${simulating ? "bg-red-500 text-white" : "bg-[var(--color-accent)] text-black"}`}
        >
          {simulating ? "Stop" : "Simulate"}
        </button>
        <button
          onClick={resetValues}
          class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text)] transition hover:border-[var(--color-primary)]"
        >
          Reset Values
        </button>
        <button
          onClick={clearAll}
          class="rounded border border-red-500/30 bg-[var(--color-surface)] px-3 py-1.5 text-xs text-red-400 transition hover:bg-red-500/10"
        >
          Clear All
        </button>
        {selectedNode !== null && (
          <button
            onClick={deleteSelectedNode}
            class="rounded border border-red-500/40 bg-[var(--color-surface)] px-3 py-1.5 text-xs text-red-400 transition hover:bg-red-500/10"
          >
            Delete Node
          </button>
        )}
        {mode === "add-edge-target" && (
          <span class="text-xs text-[var(--color-accent)]">Click target node...</span>
        )}
        {mode === "add-edge-source" && (
          <span class="text-xs text-[var(--color-text-muted)]">Click source node...</span>
        )}
        {mode === "add-node" && (
          <span class="text-xs text-[var(--color-text-muted)]">Click canvas to place node...</span>
        )}
      </div>

      {/* Presets */}
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs text-[var(--color-text-muted)]">Presets:</span>
        {PRESETS.map(preset => (
          <button
            key={preset.name}
            onClick={() => loadPreset(preset)}
            class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs text-[var(--color-text)] transition hover:border-[var(--color-primary)]"
          >
            {preset.name}
          </button>
        ))}
      </div>

      {/* Main area */}
      <div class="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div class="flex flex-col gap-3">
          {/* System canvas */}
          <canvas
            ref={canvasRef}
            class="h-[400px] w-full cursor-crosshair rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)]"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          />

          {/* Chart */}
          <canvas
            ref={chartRef}
            class="h-[180px] w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)]"
          />
        </div>

        {/* Right panel */}
        <div class="flex flex-col gap-3">
          {/* Speed control */}
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Simulation Speed</p>
            <input
              type="range"
              min="1"
              max="20"
              step="1"
              value={speed}
              onInput={(e) => setSpeed(Number((e.target as HTMLInputElement).value))}
              class="w-full accent-[var(--color-primary)]"
            />
            <p class="mt-1 text-xs text-[var(--color-text-muted)]">{speed}x</p>
          </div>

          {/* Node editor */}
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <p class="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Node Editor</p>
            {selectedNodeData ? (
              <div class="flex flex-col gap-2">
                <label class="text-xs text-[var(--color-text-muted)]">Name</label>
                <input
                  type="text"
                  value={selectedNodeData.name}
                  onInput={(e) => {
                    const val = (e.target as HTMLInputElement).value;
                    setNodes(prev => prev.map(n => n.id === selectedNode ? { ...n, name: val } : n));
                  }}
                  class="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
                />
                <label class="text-xs text-[var(--color-text-muted)]">Value: {Math.round(selectedNodeData.value)}</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={selectedNodeData.value}
                  onInput={(e) => {
                    const val = Number((e.target as HTMLInputElement).value);
                    setNodes(prev => prev.map(n => n.id === selectedNode ? { ...n, value: val, initialValue: val } : n));
                  }}
                  class="w-full accent-[var(--color-primary)]"
                />

                {/* Connected edges */}
                {selectedEdges.length > 0 && (
                  <div class="mt-2 space-y-2">
                    <p class="text-xs text-[var(--color-text-muted)]">Connections</p>
                    {selectedEdges.map((edge, i) => {
                      const other = edge.from === selectedNode
                        ? nodes.find(n => n.id === edge.to)
                        : nodes.find(n => n.id === edge.from);
                      const direction = edge.from === selectedNode ? "to" : "from";
                      return (
                        <div key={i} class="flex items-center gap-2 text-xs">
                          <span class="text-[var(--color-text-muted)]">{direction}</span>
                          <span class="text-[var(--color-text)]">{other?.name || "?"}</span>
                          <button
                            onClick={() => {
                              setEdges(prev => prev.map((e, j) => {
                                if (e.from === edge.from && e.to === edge.to) {
                                  return { ...e, polarity: e.polarity === 1 ? -1 : 1 };
                                }
                                return e;
                              }));
                            }}
                            class={`rounded px-1.5 py-0.5 text-xs font-bold ${edge.polarity === 1 ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}
                          >
                            {edge.polarity === 1 ? "+" : "-"}
                          </button>
                          <input
                            type="range"
                            min="0.05"
                            max="1"
                            step="0.05"
                            value={edge.strength}
                            onInput={(ev) => {
                              const val = Number((ev.target as HTMLInputElement).value);
                              setEdges(prev => prev.map(e =>
                                e.from === edge.from && e.to === edge.to ? { ...e, strength: val } : e
                              ));
                            }}
                            class="w-16 accent-[var(--color-primary)]"
                          />
                          <span class="text-[var(--color-text-muted)]">{edge.strength.toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <p class="text-xs text-[var(--color-text-muted)]">Select a node to edit, or click "+ Node" to add one.</p>
            )}
          </div>

          {/* How it works */}
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">How It Works</p>
            <div class="space-y-1 text-xs text-[var(--color-text-muted)]">
              <p>1. Add nodes (variables with 0-100 values)</p>
              <p>2. Connect them with positive (+) or negative (-) edges</p>
              <p>3. Adjust edge strengths and node values</p>
              <p>4. Click "Simulate" to run the dynamics</p>
              <p>5. Watch feedback loops emerge in the chart</p>
              <p class="mt-2 italic">
                Green (+) edges: source above 50 increases target.
                Red (-) edges: source above 50 decreases target.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
