import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

interface HeapObject {
  id: string;
  label: string;
  references: string[];
  x: number;
  y: number;
  generation: number;
  survivalCount: number;
  refCount: number;
  marked: boolean;
  alive: boolean;
  color: string;
}

type GCAlgorithm = "mark-sweep" | "ref-counting" | "generational";

type AnimationPhase =
  | "idle"
  | "marking"
  | "sweeping"
  | "collecting"
  | "promoting"
  | "done";

interface GCState {
  phase: AnimationPhase;
  currentNodeId: string | null;
  visitedIds: Set<string>;
  markedIds: Set<string>;
  sweepIndex: number;
  message: string;
}

interface GCStats {
  liveObjects: number;
  garbageCollected: number;
  totalAllocations: number;
  gcPauseMs: number;
}

interface Preset {
  name: string;
  description: string;
  build: () => { objects: HeapObject[]; roots: string[] };
}

type DragMode =
  | { kind: "none" }
  | { kind: "move"; objectId: string; offsetX: number; offsetY: number }
  | { kind: "link"; fromId: string; mouseX: number; mouseY: number };

/* ══════════════════════════════════════════════════════════
   Constants
   ══════════════════════════════════════════════════════════ */

const OBJECT_RADIUS = 28;
const ROOTS_BOX_X = 40;
const ROOTS_BOX_Y = 30;
const ROOTS_BOX_W = 80;
const ROOTS_BOX_H = 30;

const OBJECT_COLORS = [
  "#4f8ff7", "#34d399", "#f59e0b", "#8b5cf6", "#ec4899",
  "#06b6d4", "#84cc16", "#f97316", "#6366f1", "#14b8a6",
  "#e879f9", "#fb923c", "#22d3ee", "#a3e635", "#c084fc",
];

const GEN_COLORS: Record<number, string> = {
  0: "#34d399",
  1: "#f59e0b",
  2: "#ef4444",
};

const ALGORITHM_INFO: Record<GCAlgorithm, { name: string; description: string }> = {
  "mark-sweep": {
    name: "Mark-and-Sweep",
    description: "Traces from roots to mark reachable objects, then sweeps unmarked ones.",
  },
  "ref-counting": {
    name: "Reference Counting",
    description: "Each object tracks how many references point to it. Collected when count reaches 0.",
  },
  generational: {
    name: "Generational GC",
    description: "Objects in younger generations are collected more often. Survivors get promoted.",
  },
};

const PROMOTION_THRESHOLD = 3;

/* ══════════════════════════════════════════════════════════
   Helpers
   ══════════════════════════════════════════════════════════ */

let objectCounter = 0;

function nextLabel(): string {
  const idx = objectCounter++;
  if (idx < 26) return String.fromCharCode(65 + idx);
  const first = String.fromCharCode(65 + Math.floor(idx / 26) - 1);
  const second = String.fromCharCode(65 + (idx % 26));
  return first + second;
}

function resetCounter(): void {
  objectCounter = 0;
}

function makeObject(x: number, y: number, generation = 0): HeapObject {
  const label = nextLabel();
  return {
    id: `obj-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label,
    references: [],
    x,
    y,
    generation,
    survivalCount: 0,
    refCount: 0,
    marked: false,
    alive: true,
    color: OBJECT_COLORS[objectCounter % OBJECT_COLORS.length],
  };
}

function computeRefCounts(objects: HeapObject[], roots: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const obj of objects) {
    counts.set(obj.id, 0);
  }
  for (const rootId of roots) {
    const current = counts.get(rootId);
    if (current !== undefined) counts.set(rootId, current + 1);
  }
  for (const obj of objects) {
    for (const refId of obj.references) {
      const current = counts.get(refId);
      if (current !== undefined) counts.set(refId, current + 1);
    }
  }
  return counts;
}

function markReachable(objects: HeapObject[], roots: string[]): Set<string> {
  const objectMap = new Map(objects.map((o) => [o.id, o]));
  const visited = new Set<string>();
  const queue = [...roots];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    const obj = objectMap.get(id);
    if (!obj || !obj.alive) continue;
    visited.add(id);
    for (const refId of obj.references) {
      if (!visited.has(refId)) queue.push(refId);
    }
  }
  return visited;
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

function pointOnCircleEdge(
  cx: number,
  cy: number,
  tx: number,
  ty: number,
  radius: number,
): { x: number; y: number } {
  const angle = Math.atan2(ty - cy, tx - cx);
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}

function pointNearLine(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  threshold: number,
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(px, py, x1, y1) < threshold;
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return distance(px, py, projX, projY) < threshold;
}

/* ══════════════════════════════════════════════════════════
   Presets
   ══════════════════════════════════════════════════════════ */

function buildPresets(): Preset[] {
  return [
    {
      name: "Simple Chain",
      description: "Linear chain from root: Root -> A -> B -> C",
      build() {
        resetCounter();
        const a = makeObject(200, 120);
        const b = makeObject(340, 120);
        const c = makeObject(480, 120);
        a.references = [b.id];
        b.references = [c.id];
        return { objects: [a, b, c], roots: [a.id] };
      },
    },
    {
      name: "Circular Reference",
      description: "Two objects reference each other but are unreachable from root",
      build() {
        resetCounter();
        const a = makeObject(200, 100);
        const b = makeObject(400, 100);
        const c = makeObject(300, 220);
        const d = makeObject(450, 220);
        a.references = [b.id];
        c.references = [d.id];
        d.references = [c.id];
        return { objects: [a, b, c, d], roots: [a.id] };
      },
    },
    {
      name: "Tree Structure",
      description: "Branching tree with some leaf nodes",
      build() {
        resetCounter();
        const a = makeObject(340, 60);
        const b = makeObject(200, 160);
        const c = makeObject(480, 160);
        const d = makeObject(130, 260);
        const e = makeObject(270, 260);
        const f = makeObject(410, 260);
        const g = makeObject(550, 260);
        a.references = [b.id, c.id];
        b.references = [d.id, e.id];
        c.references = [f.id, g.id];
        return { objects: [a, b, c, d, e, f, g], roots: [a.id] };
      },
    },
    {
      name: "Complex Web",
      description: "Cross-references with some garbage islands",
      build() {
        resetCounter();
        const a = makeObject(180, 80);
        const b = makeObject(340, 80);
        const c = makeObject(500, 80);
        const d = makeObject(260, 200);
        const e = makeObject(420, 200);
        const f = makeObject(140, 280);
        const g = makeObject(360, 300);
        const h = makeObject(540, 280);
        a.references = [b.id, d.id];
        b.references = [c.id, e.id];
        d.references = [f.id];
        f.references = [];
        g.references = [h.id];
        h.references = [g.id];
        return { objects: [a, b, c, d, e, f, g, h], roots: [a.id] };
      },
    },
    {
      name: "Generational",
      description: "Mix of young and old objects for generational GC",
      build() {
        resetCounter();
        const a = makeObject(200, 80, 2);
        a.survivalCount = 6;
        const b = makeObject(400, 80, 1);
        b.survivalCount = 3;
        const c = makeObject(300, 180, 0);
        const d = makeObject(180, 260, 0);
        const e = makeObject(420, 260, 0);
        const f = makeObject(550, 180, 0);
        a.references = [b.id, c.id];
        b.references = [e.id];
        c.references = [d.id];
        return { objects: [a, b, c, d, e, f], roots: [a.id] };
      },
    },
  ];
}

/* ══════════════════════════════════════════════════════════
   Component
   ══════════════════════════════════════════════════════════ */

export default function GCVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [objects, setObjects] = useState<HeapObject[]>([]);
  const [roots, setRoots] = useState<string[]>([]);
  const [algorithm, setAlgorithm] = useState<GCAlgorithm>("mark-sweep");
  const [speed, setSpeed] = useState(500);
  const [gcState, setGcState] = useState<GCState>({
    phase: "idle",
    currentNodeId: null,
    visitedIds: new Set(),
    markedIds: new Set(),
    sweepIndex: 0,
    message: "Ready. Create objects or load a preset.",
  });
  const [stats, setStats] = useState<GCStats>({
    liveObjects: 0,
    garbageCollected: 0,
    totalAllocations: 0,
    gcPauseMs: 0,
  });
  const [dragMode, setDragMode] = useState<DragMode>({ kind: "none" });
  const [canvasSize, setCanvasSize] = useState({ width: 680, height: 380 });

  const animationRef = useRef<number | null>(null);
  const gcRunningRef = useRef(false);
  const presets = useRef(buildPresets()).current;

  const isGcRunning = gcState.phase !== "idle" && gcState.phase !== "done";

  /* ── Resize ── */
  useEffect(() => {
    function handleResize() {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      setCanvasSize({ width: w, height: Math.max(340, Math.min(480, w * 0.56)) });
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  /* ── Update stats ── */
  useEffect(() => {
    const live = objects.filter((o) => o.alive).length;
    setStats((prev) => ({ ...prev, liveObjects: live }));
  }, [objects]);

  /* ── Canvas draw ── */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.width * dpr;
    canvas.height = canvasSize.height * dpr;
    ctx.scale(dpr, dpr);

    const computedStyle = getComputedStyle(canvas);
    const bgColor = computedStyle.getPropertyValue("--color-bg").trim() || "#09090b";
    const surfaceColor = computedStyle.getPropertyValue("--color-surface").trim() || "#111111";
    const borderColor = computedStyle.getPropertyValue("--color-border").trim() || "#27272a";
    const textColor = computedStyle.getPropertyValue("--color-text").trim() || "#e4e4e7";
    const mutedColor = computedStyle.getPropertyValue("--color-text-muted").trim() || "#a1a1aa";
    const primaryColor = computedStyle.getPropertyValue("--color-primary").trim() || "#4f8ff7";
    const headingColor = computedStyle.getPropertyValue("--color-heading").trim() || "#ffffff";

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

    const aliveObjects = objects.filter((o) => o.alive);
    const objectMap = new Map(aliveObjects.map((o) => [o.id, o]));

    /* ── Roots box ── */
    ctx.fillStyle = surfaceColor;
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    roundRect(ctx, ROOTS_BOX_X, ROOTS_BOX_Y, ROOTS_BOX_W, ROOTS_BOX_H, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = primaryColor;
    ctx.font = "bold 13px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("ROOTS", ROOTS_BOX_X + ROOTS_BOX_W / 2, ROOTS_BOX_Y + ROOTS_BOX_H / 2);

    /* ── Root arrows ── */
    for (const rootId of roots) {
      const obj = objectMap.get(rootId);
      if (!obj) continue;
      const startX = ROOTS_BOX_X + ROOTS_BOX_W / 2;
      const startY = ROOTS_BOX_Y + ROOTS_BOX_H;
      const end = pointOnCircleEdge(obj.x, obj.y, startX, startY, OBJECT_RADIUS + 2);
      drawArrow(ctx, startX, startY, end.x, end.y, primaryColor, 2);
    }

    /* ── Reference arrows ── */
    for (const obj of aliveObjects) {
      for (const refId of obj.references) {
        const target = objectMap.get(refId);
        if (!target) continue;
        const start = pointOnCircleEdge(obj.x, obj.y, target.x, target.y, OBJECT_RADIUS + 2);
        const end = pointOnCircleEdge(target.x, target.y, obj.x, obj.y, OBJECT_RADIUS + 2);
        const isHighlighted =
          gcState.currentNodeId === obj.id &&
          gcState.visitedIds.has(obj.id);
        const arrowColor = isHighlighted ? "#fbbf24" : borderColor;
        const arrowWidth = isHighlighted ? 2.5 : 1.5;
        drawArrow(ctx, start.x, start.y, end.x, end.y, arrowColor, arrowWidth);
      }
    }

    /* ── Drag link preview ── */
    if (dragMode.kind === "link") {
      const fromObj = objectMap.get(dragMode.fromId);
      if (fromObj) {
        const start = pointOnCircleEdge(
          fromObj.x,
          fromObj.y,
          dragMode.mouseX,
          dragMode.mouseY,
          OBJECT_RADIUS + 2,
        );
        ctx.setLineDash([6, 4]);
        drawArrow(ctx, start.x, start.y, dragMode.mouseX, dragMode.mouseY, mutedColor, 1.5);
        ctx.setLineDash([]);
      }
    }

    /* ── Objects ── */
    for (const obj of aliveObjects) {
      const isCurrentGc = gcState.currentNodeId === obj.id;
      const isMarked = gcState.markedIds.has(obj.id);
      const isReachable = gcState.phase !== "idle" && gcState.visitedIds.has(obj.id);

      let fillColor = obj.color;
      let strokeColor = borderColor;
      let strokeWidth = 2;

      if (gcState.phase === "marking" || gcState.phase === "sweeping") {
        if (isMarked) {
          fillColor = "#22c55e";
          strokeColor = "#16a34a";
        } else if (gcState.phase === "sweeping" && !isReachable) {
          fillColor = "#ef4444";
          strokeColor = "#dc2626";
        }
      }

      if (gcState.phase === "collecting") {
        const refCounts = computeRefCounts(aliveObjects, roots);
        const count = refCounts.get(obj.id) ?? 0;
        if (count === 0) {
          fillColor = "#ef4444";
          strokeColor = "#dc2626";
        }
      }

      if (algorithm === "generational" && gcState.phase === "idle") {
        fillColor = GEN_COLORS[obj.generation] ?? obj.color;
      }

      if (isCurrentGc) {
        strokeColor = "#fbbf24";
        strokeWidth = 3;
      }

      // Object circle
      ctx.beginPath();
      ctx.arc(obj.x, obj.y, OBJECT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();

      // Label
      ctx.fillStyle = headingColor;
      ctx.font = "bold 14px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(obj.label, obj.x, obj.y);

      // Ref count (for ref-counting algorithm)
      if (algorithm === "ref-counting") {
        const refCounts = computeRefCounts(aliveObjects, roots);
        const count = refCounts.get(obj.id) ?? 0;
        ctx.fillStyle = surfaceColor;
        ctx.beginPath();
        ctx.arc(obj.x + OBJECT_RADIUS - 4, obj.y - OBJECT_RADIUS + 4, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = count === 0 ? "#ef4444" : textColor;
        ctx.font = "bold 10px Inter, sans-serif";
        ctx.fillText(String(count), obj.x + OBJECT_RADIUS - 4, obj.y - OBJECT_RADIUS + 5);
      }

      // Generation badge (for generational algorithm)
      if (algorithm === "generational") {
        const genLabel = `G${obj.generation}`;
        ctx.fillStyle = surfaceColor;
        ctx.beginPath();
        ctx.arc(obj.x - OBJECT_RADIUS + 4, obj.y - OBJECT_RADIUS + 4, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = GEN_COLORS[obj.generation] ?? borderColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = GEN_COLORS[obj.generation] ?? textColor;
        ctx.font = "bold 9px Inter, sans-serif";
        ctx.fillText(genLabel, obj.x - OBJECT_RADIUS + 4, obj.y - OBJECT_RADIUS + 5);
      }
    }

    /* ── Generation labels ── */
    if (algorithm === "generational") {
      const labels = ["Young (Gen 0)", "Mid (Gen 1)", "Old (Gen 2)"];
      const colors = [GEN_COLORS[0], GEN_COLORS[1], GEN_COLORS[2]];
      for (let i = 0; i < 3; i++) {
        const lx = canvasSize.width - 130;
        const ly = 20 + i * 18;
        ctx.fillStyle = colors[i];
        ctx.beginPath();
        ctx.arc(lx, ly, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = mutedColor;
        ctx.font = "11px Inter, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(labels[i], lx + 10, ly + 4);
      }
    }

    /* ── Phase message ── */
    ctx.fillStyle = mutedColor;
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(gcState.message, 12, canvasSize.height - 10);
  }, [objects, roots, gcState, dragMode, canvasSize, algorithm]);

  useEffect(() => {
    const frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [draw]);

  /* ══════════════════════════════════════════════════════════
     GC Algorithm Runners
     ══════════════════════════════════════════════════════════ */

  const runMarkAndSweep = useCallback(async () => {
    gcRunningRef.current = true;
    const aliveObjects = objects.filter((o) => o.alive);
    const objectMap = new Map(aliveObjects.map((o) => [o.id, o]));
    const visited = new Set<string>();
    const queue = [...roots];
    const startTime = performance.now();

    setGcState((prev) => ({
      ...prev,
      phase: "marking",
      message: "Mark phase: tracing from roots...",
      visitedIds: new Set(),
      markedIds: new Set(),
    }));

    await delay(speed);

    // Mark phase - BFS
    while (queue.length > 0 && gcRunningRef.current) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      const obj = objectMap.get(id);
      if (!obj) continue;
      visited.add(id);

      setGcState((prev) => ({
        ...prev,
        currentNodeId: id,
        visitedIds: new Set(visited),
        markedIds: new Set(visited),
        message: `Marking: visiting ${obj.label}`,
      }));

      await delay(speed);

      for (const refId of obj.references) {
        if (!visited.has(refId)) queue.push(refId);
      }
    }

    if (!gcRunningRef.current) return;

    // Sweep phase
    setGcState((prev) => ({
      ...prev,
      phase: "sweeping",
      currentNodeId: null,
      message: "Sweep phase: collecting unmarked objects...",
    }));

    await delay(speed);

    const toRemove: string[] = [];
    for (const obj of aliveObjects) {
      if (!visited.has(obj.id)) {
        toRemove.push(obj.id);
      }
    }

    for (const id of toRemove) {
      if (!gcRunningRef.current) return;
      const obj = objectMap.get(id);
      setGcState((prev) => ({
        ...prev,
        currentNodeId: id,
        message: `Sweeping: collecting ${obj?.label ?? id}`,
      }));
      await delay(speed * 0.7);
    }

    const pauseTime = performance.now() - startTime;

    setObjects((prev) => {
      const removeSet = new Set(toRemove);
      return prev.map((o) =>
        removeSet.has(o.id) ? { ...o, alive: false } : o,
      ).filter((o) => o.alive);
    });

    setRoots((prev) => prev.filter((id) => !toRemove.includes(id)));

    setStats((prev) => ({
      ...prev,
      garbageCollected: prev.garbageCollected + toRemove.length,
      gcPauseMs: Math.round(pauseTime),
    }));

    setGcState({
      phase: "done",
      currentNodeId: null,
      visitedIds: new Set(),
      markedIds: new Set(),
      sweepIndex: 0,
      message: `Done. Collected ${toRemove.length} object${toRemove.length !== 1 ? "s" : ""}.`,
    });

    gcRunningRef.current = false;
  }, [objects, roots, speed]);

  const runRefCounting = useCallback(async () => {
    gcRunningRef.current = true;
    const aliveObjects = objects.filter((o) => o.alive);
    const refCounts = computeRefCounts(aliveObjects, roots);
    const startTime = performance.now();

    setGcState((prev) => ({
      ...prev,
      phase: "collecting",
      message: "Reference counting: checking counts...",
      visitedIds: new Set(),
      markedIds: new Set(),
    }));

    await delay(speed);

    const zeroCountIds: string[] = [];
    for (const obj of aliveObjects) {
      if (!gcRunningRef.current) return;
      const count = refCounts.get(obj.id) ?? 0;
      setGcState((prev) => ({
        ...prev,
        currentNodeId: obj.id,
        message: `Checking ${obj.label}: refCount = ${count}`,
      }));
      await delay(speed * 0.6);
      if (count === 0) {
        zeroCountIds.push(obj.id);
      }
    }

    if (!gcRunningRef.current) return;

    // Check for circular reference problem
    const reachable = markReachable(aliveObjects, roots);
    const circularGarbage = aliveObjects.filter(
      (o) => !reachable.has(o.id) && !zeroCountIds.includes(o.id),
    );

    let circularMsg = "";
    if (circularGarbage.length > 0) {
      circularMsg = ` (${circularGarbage.length} object${circularGarbage.length > 1 ? "s" : ""} in circular references NOT collected!)`;
    }

    // Only collect zero-count objects
    for (const id of zeroCountIds) {
      if (!gcRunningRef.current) return;
      const obj = aliveObjects.find((o) => o.id === id);
      setGcState((prev) => ({
        ...prev,
        currentNodeId: id,
        message: `Collecting ${obj?.label ?? id} (refCount = 0)`,
      }));
      await delay(speed * 0.7);
    }

    const pauseTime = performance.now() - startTime;

    setObjects((prev) => {
      const removeSet = new Set(zeroCountIds);
      return prev
        .map((o) => (removeSet.has(o.id) ? { ...o, alive: false } : o))
        .filter((o) => o.alive);
    });

    setStats((prev) => ({
      ...prev,
      garbageCollected: prev.garbageCollected + zeroCountIds.length,
      gcPauseMs: Math.round(pauseTime),
    }));

    setGcState({
      phase: "done",
      currentNodeId: null,
      visitedIds: new Set(),
      markedIds: new Set(),
      sweepIndex: 0,
      message: `Done. Collected ${zeroCountIds.length} object${zeroCountIds.length !== 1 ? "s" : ""}.${circularMsg}`,
    });

    gcRunningRef.current = false;
  }, [objects, roots, speed]);

  const runGenerationalGC = useCallback(
    async (mode: "minor" | "major") => {
      gcRunningRef.current = true;
      const aliveObjects = objects.filter((o) => o.alive);
      const startTime = performance.now();
      const targetGens = mode === "minor" ? [0] : [0, 1, 2];

      setGcState((prev) => ({
        ...prev,
        phase: "marking",
        message: `${mode === "minor" ? "Minor" : "Major"} collection: marking from roots...`,
        visitedIds: new Set(),
        markedIds: new Set(),
      }));

      await delay(speed);

      // Mark reachable
      const objectMap = new Map(aliveObjects.map((o) => [o.id, o]));
      const visited = new Set<string>();
      const queue = [...roots];

      while (queue.length > 0 && gcRunningRef.current) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        const obj = objectMap.get(id);
        if (!obj) continue;
        visited.add(id);

        setGcState((prev) => ({
          ...prev,
          currentNodeId: id,
          visitedIds: new Set(visited),
          markedIds: new Set(visited),
          message: `Marking: visiting ${obj.label} (Gen ${obj.generation})`,
        }));

        await delay(speed * 0.5);

        for (const refId of obj.references) {
          if (!visited.has(refId)) queue.push(refId);
        }
      }

      if (!gcRunningRef.current) return;

      // Sweep only target generations
      setGcState((prev) => ({
        ...prev,
        phase: "sweeping",
        currentNodeId: null,
        message: "Sweeping target generations...",
      }));

      await delay(speed * 0.5);

      const toRemove: string[] = [];
      const toPromote: string[] = [];

      for (const obj of aliveObjects) {
        if (!targetGens.includes(obj.generation)) continue;
        if (!visited.has(obj.id)) {
          toRemove.push(obj.id);
        } else {
          toPromote.push(obj.id);
        }
      }

      for (const id of toRemove) {
        if (!gcRunningRef.current) return;
        const obj = objectMap.get(id);
        setGcState((prev) => ({
          ...prev,
          currentNodeId: id,
          message: `Sweeping: collecting ${obj?.label ?? id}`,
        }));
        await delay(speed * 0.5);
      }

      // Promote survivors
      setGcState((prev) => ({
        ...prev,
        phase: "promoting",
        currentNodeId: null,
        message: "Promoting survivors...",
      }));

      await delay(speed * 0.4);

      const pauseTime = performance.now() - startTime;
      const removeSet = new Set(toRemove);

      setObjects((prev) =>
        prev
          .map((o) => {
            if (removeSet.has(o.id)) return { ...o, alive: false };
            if (toPromote.includes(o.id)) {
              const newSurvival = o.survivalCount + 1;
              const newGen =
                newSurvival >= PROMOTION_THRESHOLD && o.generation < 2
                  ? o.generation + 1
                  : o.generation;
              return { ...o, survivalCount: newSurvival, generation: newGen };
            }
            return o;
          })
          .filter((o) => o.alive),
      );

      setRoots((prev) => prev.filter((id) => !toRemove.includes(id)));

      setStats((prev) => ({
        ...prev,
        garbageCollected: prev.garbageCollected + toRemove.length,
        gcPauseMs: Math.round(pauseTime),
      }));

      setGcState({
        phase: "done",
        currentNodeId: null,
        visitedIds: new Set(),
        markedIds: new Set(),
        sweepIndex: 0,
        message: `Done. Collected ${toRemove.length}, promoted ${toPromote.length} survivor${toPromote.length !== 1 ? "s" : ""}.`,
      });

      gcRunningRef.current = false;
    },
    [objects, roots, speed],
  );

  /* ══════════════════════════════════════════════════════════
     Event Handlers
     ══════════════════════════════════════════════════════════ */

  const handleCanvasMouseDown = useCallback(
    (e: MouseEvent) => {
      if (isGcRunning) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const aliveObjects = objects.filter((o) => o.alive);

      // Check if clicking on an object
      for (const obj of aliveObjects) {
        if (distance(x, y, obj.x, obj.y) <= OBJECT_RADIUS) {
          if (e.shiftKey) {
            // Start link drag
            setDragMode({ kind: "link", fromId: obj.id, mouseX: x, mouseY: y });
          } else {
            setDragMode({
              kind: "move",
              objectId: obj.id,
              offsetX: x - obj.x,
              offsetY: y - obj.y,
            });
          }
          return;
        }
      }

      // Check if clicking on a reference edge to delete it
      for (const obj of aliveObjects) {
        for (const refId of obj.references) {
          const target = aliveObjects.find((o) => o.id === refId);
          if (!target) continue;
          const start = pointOnCircleEdge(obj.x, obj.y, target.x, target.y, OBJECT_RADIUS);
          const end = pointOnCircleEdge(target.x, target.y, obj.x, obj.y, OBJECT_RADIUS);
          if (pointNearLine(x, y, start.x, start.y, end.x, end.y, 8)) {
            setObjects((prev) =>
              prev.map((o) =>
                o.id === obj.id
                  ? { ...o, references: o.references.filter((r) => r !== refId) }
                  : o,
              ),
            );
            setGcState((prev) => ({
              ...prev,
              message: `Removed reference ${obj.label} -> ${target.label}`,
            }));
            return;
          }
        }
      }

      // Check if clicking on a root arrow to delete it
      for (const rootId of roots) {
        const obj = aliveObjects.find((o) => o.id === rootId);
        if (!obj) continue;
        const startX = ROOTS_BOX_X + ROOTS_BOX_W / 2;
        const startY = ROOTS_BOX_Y + ROOTS_BOX_H;
        const end = pointOnCircleEdge(obj.x, obj.y, startX, startY, OBJECT_RADIUS);
        if (pointNearLine(x, y, startX, startY, end.x, end.y, 8)) {
          setRoots((prev) => prev.filter((id) => id !== rootId));
          setGcState((prev) => ({
            ...prev,
            message: `Removed root reference to ${obj.label}`,
          }));
          return;
        }
      }
    },
    [objects, roots, isGcRunning],
  );

  const handleCanvasMouseMove = useCallback(
    (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (dragMode.kind === "move") {
        setObjects((prev) =>
          prev.map((o) =>
            o.id === dragMode.objectId
              ? { ...o, x: x - dragMode.offsetX, y: y - dragMode.offsetY }
              : o,
          ),
        );
      } else if (dragMode.kind === "link") {
        setDragMode((prev) => {
          if (prev.kind !== "link") return prev;
          return { ...prev, mouseX: x, mouseY: y };
        });
      }
    },
    [dragMode],
  );

  const handleCanvasMouseUp = useCallback(
    (e: MouseEvent) => {
      if (dragMode.kind === "link") {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const aliveObjects = objects.filter((o) => o.alive);
        const target = aliveObjects.find(
          (o) => distance(x, y, o.x, o.y) <= OBJECT_RADIUS && o.id !== dragMode.fromId,
        );

        if (target) {
          const from = aliveObjects.find((o) => o.id === dragMode.fromId);
          if (from && !from.references.includes(target.id)) {
            setObjects((prev) =>
              prev.map((o) =>
                o.id === dragMode.fromId
                  ? { ...o, references: [...o.references, target.id] }
                  : o,
              ),
            );
            setGcState((prev) => ({
              ...prev,
              message: `Added reference ${from.label} -> ${target.label}`,
            }));
          }
        }
      }
      setDragMode({ kind: "none" });
    },
    [dragMode, objects],
  );

  /* ── Actions ── */
  const handleCreateObject = useCallback(() => {
    if (isGcRunning) return;
    const x = 150 + Math.random() * (canvasSize.width - 300);
    const y = 100 + Math.random() * (canvasSize.height - 160);
    const newObj = makeObject(x, y);
    setObjects((prev) => [...prev, newObj]);
    setStats((prev) => ({
      ...prev,
      totalAllocations: prev.totalAllocations + 1,
    }));
    setGcState((prev) => ({
      ...prev,
      phase: "idle",
      message: `Created object ${newObj.label}. Shift+drag to create references.`,
    }));
  }, [isGcRunning, canvasSize]);

  const handleAddRoot = useCallback(() => {
    if (isGcRunning) return;
    const aliveObjects = objects.filter((o) => o.alive);
    const nonRoots = aliveObjects.filter((o) => !roots.includes(o.id));
    if (nonRoots.length === 0) {
      setGcState((prev) => ({
        ...prev,
        message: "All objects are already roots.",
      }));
      return;
    }
    const target = nonRoots[0];
    setRoots((prev) => [...prev, target.id]);
    setGcState((prev) => ({
      ...prev,
      message: `Added root reference to ${target.label}`,
    }));
  }, [objects, roots, isGcRunning]);

  const handleRunGC = useCallback(() => {
    if (isGcRunning) return;
    if (algorithm === "mark-sweep") {
      runMarkAndSweep();
    } else if (algorithm === "ref-counting") {
      runRefCounting();
    } else {
      runGenerationalGC("minor");
    }
  }, [algorithm, isGcRunning, runMarkAndSweep, runRefCounting, runGenerationalGC]);

  const handleMajorGC = useCallback(() => {
    if (isGcRunning || algorithm !== "generational") return;
    runGenerationalGC("major");
  }, [isGcRunning, algorithm, runGenerationalGC]);

  const handleStopGC = useCallback(() => {
    gcRunningRef.current = false;
    setGcState({
      phase: "idle",
      currentNodeId: null,
      visitedIds: new Set(),
      markedIds: new Set(),
      sweepIndex: 0,
      message: "GC stopped.",
    });
  }, []);

  const handleReset = useCallback(() => {
    gcRunningRef.current = false;
    resetCounter();
    setObjects([]);
    setRoots([]);
    setGcState({
      phase: "idle",
      currentNodeId: null,
      visitedIds: new Set(),
      markedIds: new Set(),
      sweepIndex: 0,
      message: "Ready. Create objects or load a preset.",
    });
    setStats({
      liveObjects: 0,
      garbageCollected: 0,
      totalAllocations: 0,
      gcPauseMs: 0,
    });
  }, []);

  const handleLoadPreset = useCallback(
    (preset: Preset) => {
      if (isGcRunning) return;
      resetCounter();
      const { objects: presetObjects, roots: presetRoots } = preset.build();
      setObjects(presetObjects);
      setRoots(presetRoots);
      setGcState({
        phase: "idle",
        currentNodeId: null,
        visitedIds: new Set(),
        markedIds: new Set(),
        sweepIndex: 0,
        message: `Loaded "${preset.name}". ${preset.description}`,
      });
      setStats((prev) => ({
        ...prev,
        totalAllocations: prev.totalAllocations + presetObjects.length,
        liveObjects: presetObjects.length,
      }));
    },
    [isGcRunning],
  );

  /* ══════════════════════════════════════════════════════════
     Render
     ══════════════════════════════════════════════════════════ */

  return (
    <div
      class="space-y-4"
      ref={containerRef}
      style="--color-bg: var(--color-bg); --color-surface: var(--color-surface); --color-border: var(--color-border); --color-text: var(--color-text); --color-text-muted: var(--color-text-muted); --color-primary: var(--color-primary); --color-heading: var(--color-heading);"
    >
      {/* Algorithm tabs */}
      <div class="flex flex-wrap gap-2">
        {(["mark-sweep", "ref-counting", "generational"] as GCAlgorithm[]).map((alg) => (
          <button
            key={alg}
            onClick={() => {
              if (!isGcRunning) setAlgorithm(alg);
            }}
            class={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
              algorithm === alg
                ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)]/40 hover:text-[var(--color-heading)]"
            }`}
            disabled={isGcRunning}
          >
            {ALGORITHM_INFO[alg].name}
          </button>
        ))}
      </div>

      {/* Algorithm description */}
      <p class="text-xs text-[var(--color-text-muted)]">
        {ALGORITHM_INFO[algorithm].description}
      </p>

      {/* Canvas */}
      <div class="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)]">
        <canvas
          ref={canvasRef}
          style={{ width: `${canvasSize.width}px`, height: `${canvasSize.height}px`, cursor: dragMode.kind !== "none" ? "grabbing" : "default" }}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={() => setDragMode({ kind: "none" })}
        />
      </div>

      {/* Controls */}
      <div class="flex flex-wrap items-center gap-2">
        <button
          onClick={handleCreateObject}
          disabled={isGcRunning}
          class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-heading)] transition-colors hover:border-[var(--color-primary)]/40 disabled:opacity-40"
        >
          + Object
        </button>
        <button
          onClick={handleAddRoot}
          disabled={isGcRunning}
          class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-heading)] transition-colors hover:border-[var(--color-primary)]/40 disabled:opacity-40"
        >
          + Root Ref
        </button>
        <button
          onClick={handleRunGC}
          disabled={isGcRunning}
          class="rounded-lg border border-[var(--color-primary)] bg-[var(--color-primary)]/10 px-3 py-1.5 text-xs font-medium text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary)]/20 disabled:opacity-40"
        >
          {algorithm === "generational" ? "Minor GC" : "Run GC"}
        </button>
        {algorithm === "generational" && (
          <button
            onClick={handleMajorGC}
            disabled={isGcRunning}
            class="rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-3 py-1.5 text-xs font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20 disabled:opacity-40"
          >
            Major GC
          </button>
        )}
        {isGcRunning && (
          <button
            onClick={handleStopGC}
            class="rounded-lg border border-red-500 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
          >
            Stop
          </button>
        )}
        <button
          onClick={handleReset}
          class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-heading)] disabled:opacity-40"
          disabled={isGcRunning}
        >
          Reset
        </button>

        {/* Speed slider */}
        <div class="ml-auto flex items-center gap-2">
          <label class="text-xs text-[var(--color-text-muted)]">Speed</label>
          <input
            type="range"
            min={100}
            max={1500}
            step={100}
            value={speed}
            onInput={(e) => setSpeed(Number((e.target as HTMLInputElement).value))}
            class="h-1 w-20 accent-[var(--color-primary)]"
            style={{ direction: "rtl" }}
          />
        </div>
      </div>

      {/* Presets */}
      <div class="flex flex-wrap gap-2">
        <span class="self-center text-xs text-[var(--color-text-muted)]">Presets:</span>
        {presets.map((preset) => (
          <button
            key={preset.name}
            onClick={() => handleLoadPreset(preset)}
            disabled={isGcRunning}
            class="rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)]/40 hover:text-[var(--color-heading)] disabled:opacity-40"
            title={preset.description}
          >
            {preset.name}
          </button>
        ))}
      </div>

      {/* Instructions */}
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs text-[var(--color-text-muted)]">
        <span class="font-medium text-[var(--color-heading)]">How to use: </span>
        Drag objects to move them. <strong>Shift+drag</strong> from one object to another to create a reference.
        Click on a reference arrow to delete it. Click on a root arrow to remove the root reference.
      </div>

      {/* Stats */}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Live Objects" value={stats.liveObjects} />
        <StatCard label="Garbage Collected" value={stats.garbageCollected} />
        <StatCard label="Total Allocations" value={stats.totalAllocations} />
        <StatCard label="GC Pause (ms)" value={stats.gcPauseMs} />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Sub-components
   ══════════════════════════════════════════════════════════ */

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div class="text-[11px] text-[var(--color-text-muted)]">{label}</div>
      <div class="mt-1 font-heading text-xl font-bold text-[var(--color-heading)]">
        {value}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Canvas Drawing Helpers
   ══════════════════════════════════════════════════════════ */

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  color: string,
  lineWidth: number,
): void {
  const headLen = 8;
  const angle = Math.atan2(toY - fromY, toX - fromX);

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;

  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - headLen * Math.cos(angle - Math.PI / 6),
    toY - headLen * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    toX - headLen * Math.cos(angle + Math.PI / 6),
    toY - headLen * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
}

/* ══════════════════════════════════════════════════════════
   Utility
   ══════════════════════════════════════════════════════════ */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
