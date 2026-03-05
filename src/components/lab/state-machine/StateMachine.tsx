import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import type {
  State,
  Transition,
  StateMachine as SM,
  SimulationResult,
  SimulationStep,
  MachineType,
  Preset,
} from "./engine";
import {
  EPSILON,
  extractAlphabet,
  detectMachineType,
  simulateInput,
  buildTransitionTable,
  toDotFormat,
  toMarkdownTable,
  nfaToDfa,
  PRESETS,
} from "./engine";

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const STATE_RADIUS = 28;
const ACCEPT_INNER_RADIUS = 22;
const ARROW_SIZE = 10;
const SELF_LOOP_RADIUS = 22;
const START_ARROW_LEN = 40;
const HIT_TOLERANCE = 8;
const LABEL_FONT = "13px Inter, system-ui, sans-serif";
const STATE_FONT = "bold 14px Inter, system-ui, sans-serif";

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

let _idCounter = 0;
function genId(prefix: string): string {
  return `${prefix}_${++_idCounter}_${Date.now().toString(36)}`;
}

function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

function pointOnCircle(
  cx: number,
  cy: number,
  r: number,
  angle: number,
): [number, number] {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

function getComputedCssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const val = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return val || fallback;
}

// ─────────────────────────────────────────────────────────
// Canvas drawing helpers
// ─────────────────────────────────────────────────────────

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  size: number,
) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(
    x - size * Math.cos(angle - Math.PI / 6),
    y - size * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    x - size * Math.cos(angle + Math.PI / 6),
    y - size * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
}

function computeEdgeCurve(
  from: State,
  to: State,
  offset: number,
): { cx: number; cy: number; startAngle: number; endAngle: number } {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const nx = -dy / len;
  const ny = dx / len;

  return {
    cx: mx + nx * offset,
    cy: my + ny * offset,
    startAngle: Math.atan2(from.y - (my + ny * offset), from.x - (mx + nx * offset)),
    endAngle: Math.atan2(to.y - (my + ny * offset), to.x - (mx + nx * offset)),
  };
}

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

export default function StateMachineDesigner() {
  // ── State ─────────────────────────────────────────────
  const [states, setStates] = useState<State[]>([]);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [selectedTransitionId, setSelectedTransitionId] = useState<string | null>(null);

  // Drag state
  const [dragging, setDragging] = useState<{
    stateId: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  // Edge creation drag
  const [edgeDrag, setEdgeDrag] = useState<{
    fromId: string;
    mouseX: number;
    mouseY: number;
  } | null>(null);

  // Editing
  const [editingLabel, setEditingLabel] = useState<{
    stateId: string;
    value: string;
  } | null>(null);
  const [editingTransition, setEditingTransition] = useState<{
    transitionId: string;
    value: string;
  } | null>(null);

  // Simulation
  const [testInput, setTestInput] = useState("");
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [simStepIdx, setSimStepIdx] = useState(-1);
  const [isRunning, setIsRunning] = useState(false);

  // UI
  const [showPresets, setShowPresets] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const transitionInputRef = useRef<HTMLInputElement>(null);
  const animFrameRef = useRef<number>(0);
  const runTimerRef = useRef<number>(0);

  // ── Derived ───────────────────────────────────────────
  const machine: SM = {
    states,
    transitions,
    alphabet: extractAlphabet(transitions),
  };
  const machineType: MachineType =
    states.length === 0 ? "DFA" : detectMachineType(machine);
  const transitionTable = buildTransitionTable(machine);

  const currentSimStep: SimulationStep | null =
    simResult && simStepIdx >= 0 && simStepIdx < simResult.steps.length
      ? simResult.steps[simStepIdx]
      : null;

  // ── Canvas sizing ─────────────────────────────────────
  const getCanvasSize = useCallback(() => {
    if (!containerRef.current) return { width: 600, height: 400 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      width: Math.floor(rect.width),
      height: Math.max(400, Math.floor(rect.height)),
    };
  }, []);

  // ── Canvas draw ───────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const { width, height } = getCanvasSize();

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Colors
    const colorBorder = getComputedCssVar("--color-border", "#27272a");
    const colorText = getComputedCssVar("--color-text", "#e4e4e7");
    const colorTextMuted = getComputedCssVar("--color-text-muted", "#a1a1aa");
    const colorSurface = getComputedCssVar("--color-surface", "#111111");
    const colorPrimary = getComputedCssVar("--color-primary", "#4f8ff7");
    const colorBg = getComputedCssVar("--color-bg", "#09090b");

    const colorActive = "#f59e0b";
    const colorAccepted = "#34d399";
    const colorRejected = "#ef4444";

    // Clear
    ctx.fillStyle = colorBg;
    ctx.fillRect(0, 0, width, height);

    // Grid dots
    ctx.fillStyle = colorBorder;
    for (let x = 20; x < width; x += 40) {
      for (let y = 20; y < height; y += 40) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const stateMap = new Map(states.map((s) => [s.id, s]));

    // Active state IDs from simulation
    const activeIds = currentSimStep ? currentSimStep.activeStates : new Set<string>();
    const acceptIds = new Set(states.filter((s) => s.isAccept).map((s) => s.id));
    const isSimDone =
      simResult !== null && simStepIdx === simResult.steps.length - 1;

    // ── Draw transitions ─────────────────────────────
    // Group transitions by from-to pair for offset
    const edgePairs = new Map<string, Transition[]>();
    for (const t of transitions) {
      const key = [t.from, t.to].sort().join(":");
      const arr = edgePairs.get(key) ?? [];
      arr.push(t);
      edgePairs.set(key, arr);
    }

    for (const t of transitions) {
      const from = stateMap.get(t.from);
      const to = stateMap.get(t.to);
      if (!from || !to) continue;

      const isSelected = t.id === selectedTransitionId;
      ctx.strokeStyle = isSelected ? colorPrimary : colorTextMuted;
      ctx.fillStyle = isSelected ? colorPrimary : colorTextMuted;
      ctx.lineWidth = isSelected ? 2.5 : 1.5;

      const label = t.symbols.join(",");

      if (t.from === t.to) {
        // Self-loop
        const loopCx = from.x;
        const loopCy = from.y - STATE_RADIUS - SELF_LOOP_RADIUS;
        ctx.beginPath();
        ctx.arc(loopCx, loopCy, SELF_LOOP_RADIUS, 0.3 * Math.PI, 0.7 * Math.PI);
        ctx.stroke();

        // Arrow at end of self-loop
        const endAngle = 0.7 * Math.PI;
        const ex = loopCx + SELF_LOOP_RADIUS * Math.cos(endAngle);
        const ey = loopCy + SELF_LOOP_RADIUS * Math.sin(endAngle);
        const arrowAngle = endAngle + Math.PI / 2;
        drawArrowHead(ctx, ex, ey, arrowAngle, ARROW_SIZE);

        // Label
        ctx.font = LABEL_FONT;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(label, loopCx, loopCy - SELF_LOOP_RADIUS - 4);
      } else {
        // Check if there is a reverse transition
        const reverseKey = [t.to, t.from].sort().join(":");
        const group = edgePairs.get(reverseKey) ?? [];
        const hasReverse =
          group.some((g) => g.from === t.to && g.to === t.from) &&
          group.some((g) => g.from === t.from && g.to === t.to);

        const curveOffset = hasReverse ? 30 : 0;
        const { cx: ctrlX, cy: ctrlY } = computeEdgeCurve(from, to, curveOffset);

        // Compute start and end points on circle edge
        const startAngle = Math.atan2(ctrlY - from.y, ctrlX - from.x);
        const [sx, sy] = pointOnCircle(from.x, from.y, STATE_RADIUS, startAngle);

        const endApproachAngle = Math.atan2(ctrlY - to.y, ctrlX - to.x);
        const [ex, ey] = pointOnCircle(to.x, to.y, STATE_RADIUS, endApproachAngle);

        // Draw quadratic curve
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(ctrlX, ctrlY, ex, ey);
        ctx.stroke();

        // Arrow head
        const arrowAngle = Math.atan2(ey - ctrlY, ex - ctrlX);
        drawArrowHead(ctx, ex, ey, arrowAngle, ARROW_SIZE);

        // Label at midpoint of curve
        const labelX = 0.25 * sx + 0.5 * ctrlX + 0.25 * ex;
        const labelY = 0.25 * sy + 0.5 * ctrlY + 0.25 * ey - 6;
        ctx.font = LABEL_FONT;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";

        // Label background
        const metrics = ctx.measureText(label);
        const pad = 3;
        ctx.fillStyle = colorBg;
        ctx.fillRect(
          labelX - metrics.width / 2 - pad,
          labelY - 12 - pad,
          metrics.width + pad * 2,
          14 + pad * 2,
        );
        ctx.fillStyle = isSelected ? colorPrimary : colorText;
        ctx.fillText(label, labelX, labelY);
      }
    }

    // ── Edge drag line ───────────────────────────────
    if (edgeDrag) {
      const from = stateMap.get(edgeDrag.fromId);
      if (from) {
        ctx.strokeStyle = colorPrimary;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(edgeDrag.mouseX, edgeDrag.mouseY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // ── Draw states ──────────────────────────────────
    for (const s of states) {
      const isActive = activeIds.has(s.id);
      const isAcceptState = acceptIds.has(s.id);
      const isSelected = s.id === selectedStateId;

      let fillColor = colorSurface;
      let strokeColor = colorBorder;

      if (isActive && isSimDone) {
        fillColor = simResult!.accepted && isAcceptState ? colorAccepted : colorRejected;
        strokeColor = fillColor;
      } else if (isActive) {
        fillColor = isAcceptState ? colorAccepted : colorActive;
        strokeColor = fillColor;
      }

      if (isSelected && !isActive) {
        strokeColor = colorPrimary;
      }

      // Start arrow
      if (s.isStart) {
        ctx.strokeStyle = colorPrimary;
        ctx.fillStyle = colorPrimary;
        ctx.lineWidth = 2;
        const arrowStartX = s.x - STATE_RADIUS - START_ARROW_LEN;
        const arrowEndX = s.x - STATE_RADIUS;
        ctx.beginPath();
        ctx.moveTo(arrowStartX, s.y);
        ctx.lineTo(arrowEndX, s.y);
        ctx.stroke();
        drawArrowHead(ctx, arrowEndX, s.y, 0, ARROW_SIZE);
      }

      // State circle
      ctx.fillStyle = fillColor;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = isSelected ? 2.5 : 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, STATE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Accept state inner circle
      if (isAcceptState) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, ACCEPT_INNER_RADIUS, 0, Math.PI * 2);
        ctx.stroke();
      }

      // State label
      ctx.fillStyle = isActive ? colorBg : colorText;
      ctx.font = STATE_FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(s.label, s.x, s.y);
    }

    // Empty state hint
    if (states.length === 0) {
      ctx.fillStyle = colorTextMuted;
      ctx.font = "14px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Click anywhere to add a state", width / 2, height / 2 - 10);
      ctx.font = "12px Inter, system-ui, sans-serif";
      ctx.fillText(
        "Shift+drag between states to add transitions",
        width / 2,
        height / 2 + 14,
      );
    }

    animFrameRef.current = requestAnimationFrame(draw);
  }, [
    states,
    transitions,
    selectedStateId,
    selectedTransitionId,
    edgeDrag,
    currentSimStep,
    simResult,
    simStepIdx,
    getCanvasSize,
  ]);

  // ── Start/stop draw loop ──────────────────────────────
  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [draw]);

  // ── Focus editing inputs ──────────────────────────────
  useEffect(() => {
    if (editingLabel && labelInputRef.current) {
      labelInputRef.current.focus();
      labelInputRef.current.select();
    }
  }, [editingLabel]);

  useEffect(() => {
    if (editingTransition && transitionInputRef.current) {
      transitionInputRef.current.focus();
      transitionInputRef.current.select();
    }
  }, [editingTransition]);

  // ── Hit testing ───────────────────────────────────────
  const hitTestState = useCallback(
    (mx: number, my: number): State | null => {
      for (let i = states.length - 1; i >= 0; i--) {
        if (dist(mx, my, states[i].x, states[i].y) <= STATE_RADIUS + HIT_TOLERANCE) {
          return states[i];
        }
      }
      return null;
    },
    [states],
  );

  const hitTestTransition = useCallback(
    (mx: number, my: number): Transition | null => {
      const stateMap = new Map(states.map((s) => [s.id, s]));
      for (const t of transitions) {
        const from = stateMap.get(t.from);
        const to = stateMap.get(t.to);
        if (!from || !to) continue;

        if (t.from === t.to) {
          // Self-loop hit test
          const loopCx = from.x;
          const loopCy = from.y - STATE_RADIUS - SELF_LOOP_RADIUS;
          const d = dist(mx, my, loopCx, loopCy);
          if (Math.abs(d - SELF_LOOP_RADIUS) < HIT_TOLERANCE + 4) return t;
        } else {
          // Line/curve proximity
          const edgePairs = new Map<string, Transition[]>();
          for (const tr of transitions) {
            const key = [tr.from, tr.to].sort().join(":");
            const arr = edgePairs.get(key) ?? [];
            arr.push(tr);
            edgePairs.set(key, arr);
          }
          const reverseKey = [t.to, t.from].sort().join(":");
          const group = edgePairs.get(reverseKey) ?? [];
          const hasReverse =
            group.some((g) => g.from === t.to && g.to === t.from) &&
            group.some((g) => g.from === t.from && g.to === t.to);

          const offset = hasReverse ? 30 : 0;
          const { cx: ctrlX, cy: ctrlY } = computeEdgeCurve(from, to, offset);

          // Sample points along quadratic bezier
          for (let p = 0; p <= 1; p += 0.05) {
            const bx =
              (1 - p) * (1 - p) * from.x +
              2 * (1 - p) * p * ctrlX +
              p * p * to.x;
            const by =
              (1 - p) * (1 - p) * from.y +
              2 * (1 - p) * p * ctrlY +
              p * p * to.y;
            if (dist(mx, my, bx, by) < HIT_TOLERANCE + 4) return t;
          }
        }
      }
      return null;
    },
    [states, transitions],
  );

  // ── Canvas event handlers ─────────────────────────────
  const getCanvasCoords = useCallback(
    (e: MouseEvent): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    },
    [],
  );

  const handleCanvasMouseDown = useCallback(
    (e: MouseEvent) => {
      if (editingLabel || editingTransition) return;
      const { x, y } = getCanvasCoords(e);

      const hitState = hitTestState(x, y);

      if (e.shiftKey && hitState) {
        // Start edge drag
        setEdgeDrag({ fromId: hitState.id, mouseX: x, mouseY: y });
        setSelectedStateId(null);
        setSelectedTransitionId(null);
        return;
      }

      if (hitState) {
        setSelectedStateId(hitState.id);
        setSelectedTransitionId(null);
        setDragging({
          stateId: hitState.id,
          offsetX: x - hitState.x,
          offsetY: y - hitState.y,
        });
        return;
      }

      const hitTrans = hitTestTransition(x, y);
      if (hitTrans) {
        setSelectedTransitionId(hitTrans.id);
        setSelectedStateId(null);
        return;
      }

      // Click on empty canvas -> add state
      setSelectedStateId(null);
      setSelectedTransitionId(null);

      const newId = genId("s");
      const label = `q${states.length}`;
      const isFirst = states.length === 0;
      setStates((prev) => [
        ...prev,
        {
          id: newId,
          label,
          x,
          y,
          isStart: isFirst,
          isAccept: false,
        },
      ]);
      setSelectedStateId(newId);
      clearSimulation();
    },
    [
      states,
      getCanvasCoords,
      hitTestState,
      hitTestTransition,
      editingLabel,
      editingTransition,
    ],
  );

  const handleCanvasMouseMove = useCallback(
    (e: MouseEvent) => {
      const { x, y } = getCanvasCoords(e);

      if (dragging) {
        setStates((prev) =>
          prev.map((s) =>
            s.id === dragging.stateId
              ? { ...s, x: x - dragging.offsetX, y: y - dragging.offsetY }
              : s,
          ),
        );
        return;
      }

      if (edgeDrag) {
        setEdgeDrag((prev) => (prev ? { ...prev, mouseX: x, mouseY: y } : null));
      }
    },
    [dragging, edgeDrag, getCanvasCoords],
  );

  const handleCanvasMouseUp = useCallback(
    (e: MouseEvent) => {
      if (edgeDrag) {
        const { x, y } = getCanvasCoords(e);
        const hitState = hitTestState(x, y);

        if (hitState && hitState.id !== edgeDrag.fromId) {
          // Check if transition already exists between these states
          const existing = transitions.find(
            (t) => t.from === edgeDrag.fromId && t.to === hitState.id,
          );
          if (!existing) {
            const newT: Transition = {
              id: genId("t"),
              from: edgeDrag.fromId,
              to: hitState.id,
              symbols: ["a"],
            };
            setTransitions((prev) => [...prev, newT]);
            setSelectedTransitionId(newT.id);
            setEditingTransition({ transitionId: newT.id, value: "a" });
            clearSimulation();
          }
        } else if (hitState && hitState.id === edgeDrag.fromId) {
          // Self-loop
          const existing = transitions.find(
            (t) => t.from === edgeDrag.fromId && t.to === edgeDrag.fromId,
          );
          if (!existing) {
            const newT: Transition = {
              id: genId("t"),
              from: edgeDrag.fromId,
              to: edgeDrag.fromId,
              symbols: ["a"],
            };
            setTransitions((prev) => [...prev, newT]);
            setSelectedTransitionId(newT.id);
            setEditingTransition({ transitionId: newT.id, value: "a" });
            clearSimulation();
          }
        }

        setEdgeDrag(null);
        return;
      }

      setDragging(null);
    },
    [edgeDrag, getCanvasCoords, hitTestState, transitions],
  );

  const handleCanvasDoubleClick = useCallback(
    (e: MouseEvent) => {
      const { x, y } = getCanvasCoords(e);
      const hitState = hitTestState(x, y);

      if (hitState) {
        setEditingLabel({ stateId: hitState.id, value: hitState.label });
        setSelectedStateId(hitState.id);
        return;
      }

      const hitTrans = hitTestTransition(x, y);
      if (hitTrans) {
        setEditingTransition({
          transitionId: hitTrans.id,
          value: hitTrans.symbols.join(","),
        });
        setSelectedTransitionId(hitTrans.id);
      }
    },
    [getCanvasCoords, hitTestState, hitTestTransition],
  );

  const handleCanvasContextMenu = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      const { x, y } = getCanvasCoords(e);
      const hitState = hitTestState(x, y);

      if (hitState) {
        setStates((prev) =>
          prev.map((s) =>
            s.id === hitState.id ? { ...s, isAccept: !s.isAccept } : s,
          ),
        );
        clearSimulation();
      }
    },
    [getCanvasCoords, hitTestState],
  );

  // ── State/transition actions ──────────────────────────
  const deleteSelected = useCallback(() => {
    if (selectedStateId) {
      setTransitions((prev) =>
        prev.filter((t) => t.from !== selectedStateId && t.to !== selectedStateId),
      );
      setStates((prev) => prev.filter((s) => s.id !== selectedStateId));
      setSelectedStateId(null);
      clearSimulation();
    }
    if (selectedTransitionId) {
      setTransitions((prev) => prev.filter((t) => t.id !== selectedTransitionId));
      setSelectedTransitionId(null);
      clearSimulation();
    }
  }, [selectedStateId, selectedTransitionId]);

  const toggleStartState = useCallback(() => {
    if (!selectedStateId) return;
    setStates((prev) =>
      prev.map((s) => ({
        ...s,
        isStart: s.id === selectedStateId ? !s.isStart : false,
      })),
    );
    clearSimulation();
  }, [selectedStateId]);

  const toggleAcceptState = useCallback(() => {
    if (!selectedStateId) return;
    setStates((prev) =>
      prev.map((s) =>
        s.id === selectedStateId ? { ...s, isAccept: !s.isAccept } : s,
      ),
    );
    clearSimulation();
  }, [selectedStateId]);

  const commitLabel = useCallback(() => {
    if (!editingLabel) return;
    const val = editingLabel.value.trim() || editingLabel.stateId;
    setStates((prev) =>
      prev.map((s) =>
        s.id === editingLabel.stateId ? { ...s, label: val } : s,
      ),
    );
    setEditingLabel(null);
    clearSimulation();
  }, [editingLabel]);

  const commitTransitionLabel = useCallback(() => {
    if (!editingTransition) return;
    const symbols = editingTransition.value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (symbols.length === 0) return;

    setTransitions((prev) =>
      prev.map((t) =>
        t.id === editingTransition.transitionId ? { ...t, symbols } : t,
      ),
    );
    setEditingTransition(null);
    clearSimulation();
  }, [editingTransition]);

  // ── Keyboard ──────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (editingLabel || editingTransition) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        deleteSelected();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelected, editingLabel, editingTransition]);

  // ── Simulation ────────────────────────────────────────
  const clearSimulation = useCallback(() => {
    setSimResult(null);
    setSimStepIdx(-1);
    setIsRunning(false);
    if (runTimerRef.current) {
      clearInterval(runTimerRef.current);
      runTimerRef.current = 0;
    }
  }, []);

  const runSimulation = useCallback(() => {
    const result = simulateInput(machine, testInput);
    setSimResult(result);
    setSimStepIdx(0);
    setIsRunning(false);
  }, [machine, testInput]);

  const stepForward = useCallback(() => {
    if (!simResult) {
      runSimulation();
      return;
    }
    if (simStepIdx < simResult.steps.length - 1) {
      setSimStepIdx((prev) => prev + 1);
    }
  }, [simResult, simStepIdx, runSimulation]);

  const autoRun = useCallback(() => {
    const result = simulateInput(machine, testInput);
    setSimResult(result);
    setSimStepIdx(0);
    setIsRunning(true);

    let idx = 0;
    const timer = window.setInterval(() => {
      idx++;
      if (idx >= result.steps.length) {
        clearInterval(timer);
        runTimerRef.current = 0;
        setIsRunning(false);
        setSimStepIdx(result.steps.length - 1);
        return;
      }
      setSimStepIdx(idx);
    }, 500);

    runTimerRef.current = timer;
  }, [machine, testInput]);

  const resetSimulation = useCallback(() => {
    clearSimulation();
  }, [clearSimulation]);

  // ── Presets ───────────────────────────────────────────
  const loadPreset = useCallback((preset: Preset) => {
    setStates([...preset.machine.states]);
    setTransitions([...preset.machine.transitions]);
    setTestInput(preset.testInputs[0] ?? "");
    setSelectedStateId(null);
    setSelectedTransitionId(null);
    setShowPresets(false);
    clearSimulation();
  }, [clearSimulation]);

  // ── Export ────────────────────────────────────────────
  const copyToClipboard = useCallback(
    (text: string, label: string) => {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(label);
        setTimeout(() => setCopied(null), 2000);
      });
    },
    [],
  );

  const clearAll = useCallback(() => {
    setStates([]);
    setTransitions([]);
    setSelectedStateId(null);
    setSelectedTransitionId(null);
    clearSimulation();
  }, [clearSimulation]);

  // ── Convert NFA to DFA ────────────────────────────────
  const convertToDfa = useCallback(() => {
    if (machineType !== "NFA") return;
    const dfa = nfaToDfa(machine);
    setStates([...dfa.states]);
    setTransitions([...dfa.transitions]);
    setSelectedStateId(null);
    setSelectedTransitionId(null);
    clearSimulation();
  }, [machine, machineType, clearSimulation]);

  // ── Selected item info ────────────────────────────────
  const selectedState = states.find((s) => s.id === selectedStateId) ?? null;
  const selectedTransition =
    transitions.find((t) => t.id === selectedTransitionId) ?? null;

  // ── Render ────────────────────────────────────────────
  return (
    <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      <div class="flex flex-col lg:flex-row">
        {/* ── Canvas Panel ─────────────────────────────── */}
        <div
          ref={containerRef}
          class="relative flex-1 min-h-[400px] lg:min-h-[520px]"
        >
          <canvas
            ref={canvasRef}
            class="block w-full h-full cursor-crosshair"
            style={{ minHeight: "400px" }}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onDblClick={handleCanvasDoubleClick}
            onContextMenu={handleCanvasContextMenu}
          />

          {/* State label editor overlay */}
          {editingLabel && (() => {
            const s = states.find((st) => st.id === editingLabel.stateId);
            if (!s) return null;
            return (
              <div
                class="absolute"
                style={{
                  left: `${s.x - 40}px`,
                  top: `${s.y - 14}px`,
                }}
              >
                <input
                  ref={labelInputRef}
                  type="text"
                  class="w-20 rounded border border-[var(--color-primary)] bg-[var(--color-bg)] px-2 py-1 text-center text-sm text-[var(--color-text)] outline-none"
                  value={editingLabel.value}
                  onInput={(e) =>
                    setEditingLabel({
                      ...editingLabel,
                      value: (e.target as HTMLInputElement).value,
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitLabel();
                    if (e.key === "Escape") setEditingLabel(null);
                  }}
                  onBlur={commitLabel}
                />
              </div>
            );
          })()}

          {/* Transition label editor overlay */}
          {editingTransition && (() => {
            const t = transitions.find(
              (tr) => tr.id === editingTransition.transitionId,
            );
            if (!t) return null;
            const from = states.find((s) => s.id === t.from);
            const to = states.find((s) => s.id === t.to);
            if (!from || !to) return null;
            const mx = t.from === t.to ? from.x - 40 : (from.x + to.x) / 2 - 40;
            const my =
              t.from === t.to
                ? from.y - STATE_RADIUS - SELF_LOOP_RADIUS * 2 - 20
                : (from.y + to.y) / 2 - 28;
            return (
              <div
                class="absolute"
                style={{ left: `${mx}px`, top: `${my}px` }}
              >
                <input
                  ref={transitionInputRef}
                  type="text"
                  class="w-20 rounded border border-[var(--color-primary)] bg-[var(--color-bg)] px-2 py-1 text-center text-sm text-[var(--color-text)] outline-none"
                  value={editingTransition.value}
                  placeholder="a,b,..."
                  onInput={(e) =>
                    setEditingTransition({
                      ...editingTransition,
                      value: (e.target as HTMLInputElement).value,
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitTransitionLabel();
                    if (e.key === "Escape") setEditingTransition(null);
                  }}
                  onBlur={commitTransitionLabel}
                />
              </div>
            );
          })()}

          {/* Canvas toolbar */}
          <div class="absolute top-3 left-3 flex flex-wrap gap-1.5">
            <button
              class="rounded bg-[var(--color-bg)] px-2.5 py-1 text-xs text-[var(--color-text-muted)] border border-[var(--color-border)] hover:text-[var(--color-heading)] hover:border-[var(--color-text-muted)] transition-colors"
              onClick={clearAll}
              title="Clear all states and transitions"
            >
              Clear
            </button>
            {selectedStateId && (
              <>
                <button
                  class="rounded bg-[var(--color-bg)] px-2.5 py-1 text-xs text-[var(--color-text-muted)] border border-[var(--color-border)] hover:text-[var(--color-heading)] hover:border-[var(--color-text-muted)] transition-colors"
                  onClick={toggleStartState}
                  title="Set as start state"
                >
                  {selectedState?.isStart ? "Unset Start" : "Set Start"}
                </button>
                <button
                  class="rounded bg-[var(--color-bg)] px-2.5 py-1 text-xs text-[var(--color-text-muted)] border border-[var(--color-border)] hover:text-[var(--color-heading)] hover:border-[var(--color-text-muted)] transition-colors"
                  onClick={toggleAcceptState}
                  title="Toggle accept state"
                >
                  {selectedState?.isAccept ? "Unset Accept" : "Set Accept"}
                </button>
                <button
                  class="rounded bg-[var(--color-bg)] px-2.5 py-1 text-xs text-red-400 border border-[var(--color-border)] hover:bg-red-400/10 hover:border-red-400 transition-colors"
                  onClick={deleteSelected}
                  title="Delete selected (or press Delete key)"
                >
                  Delete
                </button>
              </>
            )}
            {selectedTransitionId && (
              <button
                class="rounded bg-[var(--color-bg)] px-2.5 py-1 text-xs text-red-400 border border-[var(--color-border)] hover:bg-red-400/10 hover:border-red-400 transition-colors"
                onClick={deleteSelected}
                title="Delete selected transition"
              >
                Delete Edge
              </button>
            )}
          </div>

          {/* Help hint */}
          <div class="absolute bottom-3 left-3 text-[10px] text-[var(--color-text-muted)] leading-relaxed hidden sm:block">
            Click: add state | Drag: move | Shift+drag: add edge | Double-click:
            rename | Right-click: toggle accept
          </div>
        </div>

        {/* ── Sidebar ──────────────────────────────────── */}
        <div class="w-full lg:w-72 xl:w-80 border-t lg:border-t-0 lg:border-l border-[var(--color-border)] bg-[var(--color-bg)] flex flex-col overflow-y-auto max-h-[520px]">
          {/* Type badge */}
          <div class="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span
                class={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
                  machineType === "DFA"
                    ? "bg-emerald-500/15 text-emerald-400"
                    : machineType === "NFA"
                      ? "bg-amber-500/15 text-amber-400"
                      : "bg-zinc-500/15 text-zinc-400"
                }`}
              >
                {machineType}
              </span>
              <span class="text-xs text-[var(--color-text-muted)]">
                {states.length} state{states.length !== 1 ? "s" : ""}
              </span>
            </div>
            {machineType === "NFA" && (
              <button
                class="rounded px-2 py-0.5 text-xs text-[var(--color-primary)] border border-[var(--color-primary)]/30 hover:bg-[var(--color-primary)]/10 transition-colors"
                onClick={convertToDfa}
                title="Convert NFA to DFA using subset construction"
              >
                NFA to DFA
              </button>
            )}
          </div>

          {/* Presets */}
          <div class="px-4 py-3 border-b border-[var(--color-border)]">
            <button
              class="w-full text-left text-xs font-medium text-[var(--color-heading)] flex items-center justify-between"
              onClick={() => setShowPresets(!showPresets)}
            >
              <span>Presets</span>
              <span class="text-[var(--color-text-muted)]">
                {showPresets ? "\u25B2" : "\u25BC"}
              </span>
            </button>
            {showPresets && (
              <div class="mt-2 flex flex-col gap-1">
                {PRESETS.map((p) => (
                  <button
                    key={p.name}
                    class="text-left rounded px-2 py-1.5 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-heading)] transition-colors"
                    onClick={() => loadPreset(p)}
                  >
                    <span class="font-medium">{p.name}</span>
                    <br />
                    <span class="text-[10px]">{p.description}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Test Input */}
          <div class="px-4 py-3 border-b border-[var(--color-border)]">
            <label class="text-xs font-medium text-[var(--color-heading)] block mb-1.5">
              Test Input
            </label>
            <div class="flex gap-1.5">
              <input
                type="text"
                class="flex-1 min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text)] font-mono placeholder:text-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)]"
                placeholder="e.g. 0110"
                value={testInput}
                onInput={(e) => {
                  setTestInput((e.target as HTMLInputElement).value);
                  clearSimulation();
                }}
              />
            </div>
            <div class="flex gap-1.5 mt-2">
              <button
                class="flex-1 rounded bg-[var(--color-primary)] px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-40"
                onClick={autoRun}
                disabled={states.length === 0 || isRunning}
              >
                {"\u25B6"} Run
              </button>
              <button
                class="flex-1 rounded border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-heading)] hover:border-[var(--color-text-muted)] transition-colors disabled:opacity-40"
                onClick={stepForward}
                disabled={
                  states.length === 0 ||
                  isRunning ||
                  (simResult !== null &&
                    simStepIdx >= simResult.steps.length - 1)
                }
              >
                Step
              </button>
              <button
                class="rounded border border-[var(--color-border)] px-2 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-heading)] hover:border-[var(--color-text-muted)] transition-colors disabled:opacity-40"
                onClick={resetSimulation}
                disabled={!simResult}
              >
                Reset
              </button>
            </div>

            {/* Simulation result */}
            {simResult && (
              <div class="mt-2">
                {currentSimStep && (
                  <div class="text-xs text-[var(--color-text-muted)] mb-1">
                    Step {currentSimStep.stepIndex} / {simResult.steps.length - 1}
                    {currentSimStep.symbol !== "START" && (
                      <span>
                        {" "}
                        — reading{" "}
                        <span class="font-mono font-bold text-[var(--color-heading)]">
                          {currentSimStep.symbol}
                        </span>
                      </span>
                    )}
                  </div>
                )}
                {currentSimStep && (
                  <div class="text-xs text-[var(--color-text-muted)]">
                    Active:{" "}
                    {currentSimStep.activeStates.size > 0 ? (
                      Array.from(currentSimStep.activeStates).map((sid) => {
                        const s = states.find((st) => st.id === sid);
                        return (
                          <span key={sid} class="font-mono text-[var(--color-heading)]">
                            {s?.label ?? sid}
                            {" "}
                          </span>
                        );
                      })
                    ) : (
                      <span class="text-red-400">stuck (no active states)</span>
                    )}
                  </div>
                )}
                {simStepIdx === simResult.steps.length - 1 && (
                  <div
                    class={`mt-1.5 rounded px-2.5 py-1.5 text-xs font-semibold text-center ${
                      simResult.accepted
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-red-500/15 text-red-400"
                    }`}
                  >
                    {simResult.accepted ? "ACCEPTED" : "REJECTED"}
                  </div>
                )}

                {/* Input visualization */}
                {testInput.length > 0 && (
                  <div class="mt-2 flex flex-wrap gap-0.5 font-mono text-xs">
                    {testInput.split("").map((ch, i) => {
                      const isProcessed = simResult && i + 1 <= simStepIdx;
                      const isCurrent = simResult && i + 1 === simStepIdx;
                      return (
                        <span
                          key={i}
                          class={`inline-block w-5 h-5 rounded text-center leading-5 ${
                            isCurrent
                              ? "bg-[var(--color-primary)] text-white"
                              : isProcessed
                                ? "bg-[var(--color-surface)] text-[var(--color-text-muted)]"
                                : "text-[var(--color-text)]"
                          }`}
                        >
                          {ch}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Transition Table */}
          {transitionTable.length > 0 && machine.alphabet.length > 0 && (
            <div class="px-4 py-3 border-b border-[var(--color-border)]">
              <div class="text-xs font-medium text-[var(--color-heading)] mb-1.5">
                Transition Table
              </div>
              <div class="overflow-x-auto">
                <table class="w-full text-[11px] border-collapse">
                  <thead>
                    <tr>
                      <th class="text-left py-1 pr-2 text-[var(--color-text-muted)] font-medium border-b border-[var(--color-border)]">
                        {"\u03B4"}
                      </th>
                      {machine.alphabet.map((sym) => (
                        <th
                          key={sym}
                          class="text-center py-1 px-1.5 text-[var(--color-text-muted)] font-medium border-b border-[var(--color-border)]"
                        >
                          {sym}
                        </th>
                      ))}
                      {transitions.some((t) => t.symbols.includes(EPSILON)) && (
                        <th class="text-center py-1 px-1.5 text-[var(--color-text-muted)] font-medium border-b border-[var(--color-border)]">
                          {EPSILON}
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {transitionTable.map((row) => {
                      const allSymbols = transitions.some((t) =>
                        t.symbols.includes(EPSILON),
                      )
                        ? [...machine.alphabet, EPSILON]
                        : machine.alphabet;
                      return (
                        <tr key={row.stateId}>
                          <td class="py-1 pr-2 font-mono text-[var(--color-heading)] border-b border-[var(--color-border)]">
                            {row.isStart ? "\u2192" : ""}
                            {row.stateLabel}
                            {row.isAccept ? "*" : ""}
                          </td>
                          {allSymbols.map((sym) => (
                            <td
                              key={sym}
                              class="text-center py-1 px-1.5 font-mono text-[var(--color-text-muted)] border-b border-[var(--color-border)]"
                            >
                              {row.transitions[sym]?.length > 0
                                ? row.transitions[sym].join(",")
                                : "-"}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Export */}
          {states.length > 0 && (
            <div class="px-4 py-3">
              <div class="text-xs font-medium text-[var(--color-heading)] mb-1.5">
                Export
              </div>
              <div class="flex gap-1.5">
                <button
                  class="flex-1 rounded border border-[var(--color-border)] px-2 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-heading)] hover:border-[var(--color-text-muted)] transition-colors"
                  onClick={() =>
                    copyToClipboard(toMarkdownTable(machine), "markdown")
                  }
                >
                  {copied === "markdown" ? "Copied!" : "Markdown"}
                </button>
                <button
                  class="flex-1 rounded border border-[var(--color-border)] px-2 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-heading)] hover:border-[var(--color-text-muted)] transition-colors"
                  onClick={() => copyToClipboard(toDotFormat(machine), "dot")}
                >
                  {copied === "dot" ? "Copied!" : "DOT"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
