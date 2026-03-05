import { useState, useEffect, useRef, useCallback } from "preact/hooks";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

type Direction = "L" | "R" | "S";
type MachineStatus = "idle" | "running" | "paused" | "halted" | "accepted" | "rejected";

interface TransitionRule {
  currentState: string;
  readSymbol: string;
  writeSymbol: string;
  direction: Direction;
  nextState: string;
}

interface TapeSnapshot {
  tape: Map<number, string>;
  headPosition: number;
  currentState: string;
  step: number;
}

interface Preset {
  name: string;
  description: string;
  states: string[];
  alphabet: string[];
  blankSymbol: string;
  initialState: string;
  acceptStates: string[];
  rules: TransitionRule[];
  tapeInput: string;
}

interface StatePosition {
  x: number;
  y: number;
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const BLANK = "_";
const MAX_STEPS = 10000;
const TAPE_CELL_SIZE = 40;
const TAPE_CELL_GAP = 2;
const TAPE_VISIBLE_CELLS = 21;
const STATE_RADIUS = 26;
const ARROW_SIZE = 9;

// ─────────────────────────────────────────────────────────
// Presets
// ─────────────────────────────────────────────────────────

const PRESETS: Preset[] = [
  {
    name: "Binary Counter",
    description: "Increments a binary number by 1",
    states: ["carry", "done", "halt"],
    alphabet: ["0", "1", BLANK],
    blankSymbol: BLANK,
    initialState: "carry",
    acceptStates: ["halt"],
    rules: [
      { currentState: "carry", readSymbol: "1", writeSymbol: "0", direction: "L", nextState: "carry" },
      { currentState: "carry", readSymbol: "0", writeSymbol: "1", direction: "L", nextState: "done" },
      { currentState: "carry", readSymbol: BLANK, writeSymbol: "1", direction: "R", nextState: "halt" },
      { currentState: "done", readSymbol: "0", writeSymbol: "0", direction: "L", nextState: "done" },
      { currentState: "done", readSymbol: "1", writeSymbol: "1", direction: "L", nextState: "done" },
      { currentState: "done", readSymbol: BLANK, writeSymbol: BLANK, direction: "R", nextState: "halt" },
    ],
    tapeInput: "1011",
  },
  {
    name: "Palindrome Checker",
    description: "Checks if a binary string is a palindrome",
    states: ["q0", "q1a", "q1b", "q2a", "q2b", "q3", "accept", "reject"],
    alphabet: ["0", "1", "X", BLANK],
    blankSymbol: BLANK,
    initialState: "q0",
    acceptStates: ["accept"],
    rules: [
      { currentState: "q0", readSymbol: "0", writeSymbol: "X", direction: "R", nextState: "q1a" },
      { currentState: "q0", readSymbol: "1", writeSymbol: "X", direction: "R", nextState: "q1b" },
      { currentState: "q0", readSymbol: "X", writeSymbol: "X", direction: "R", nextState: "accept" },
      { currentState: "q0", readSymbol: BLANK, writeSymbol: BLANK, direction: "S", nextState: "accept" },
      { currentState: "q1a", readSymbol: "0", writeSymbol: "0", direction: "R", nextState: "q1a" },
      { currentState: "q1a", readSymbol: "1", writeSymbol: "1", direction: "R", nextState: "q1a" },
      { currentState: "q1a", readSymbol: "X", writeSymbol: "X", direction: "L", nextState: "q2a" },
      { currentState: "q1a", readSymbol: BLANK, writeSymbol: BLANK, direction: "L", nextState: "q2a" },
      { currentState: "q1b", readSymbol: "0", writeSymbol: "0", direction: "R", nextState: "q1b" },
      { currentState: "q1b", readSymbol: "1", writeSymbol: "1", direction: "R", nextState: "q1b" },
      { currentState: "q1b", readSymbol: "X", writeSymbol: "X", direction: "L", nextState: "q2b" },
      { currentState: "q1b", readSymbol: BLANK, writeSymbol: BLANK, direction: "L", nextState: "q2b" },
      { currentState: "q2a", readSymbol: "0", writeSymbol: "X", direction: "L", nextState: "q3" },
      { currentState: "q2a", readSymbol: "X", writeSymbol: "X", direction: "R", nextState: "accept" },
      { currentState: "q2a", readSymbol: "1", writeSymbol: "1", direction: "S", nextState: "reject" },
      { currentState: "q2b", readSymbol: "1", writeSymbol: "X", direction: "L", nextState: "q3" },
      { currentState: "q2b", readSymbol: "X", writeSymbol: "X", direction: "R", nextState: "accept" },
      { currentState: "q2b", readSymbol: "0", writeSymbol: "0", direction: "S", nextState: "reject" },
      { currentState: "q3", readSymbol: "0", writeSymbol: "0", direction: "L", nextState: "q3" },
      { currentState: "q3", readSymbol: "1", writeSymbol: "1", direction: "L", nextState: "q3" },
      { currentState: "q3", readSymbol: "X", writeSymbol: "X", direction: "R", nextState: "q0" },
    ],
    tapeInput: "10101",
  },
  {
    name: "Busy Beaver (3-state)",
    description: "3-state busy beaver: writes 6 ones before halting",
    states: ["A", "B", "C", "halt"],
    alphabet: ["0", "1"],
    blankSymbol: "0",
    initialState: "A",
    acceptStates: ["halt"],
    rules: [
      { currentState: "A", readSymbol: "0", writeSymbol: "1", direction: "R", nextState: "B" },
      { currentState: "A", readSymbol: "1", writeSymbol: "1", direction: "L", nextState: "C" },
      { currentState: "B", readSymbol: "0", writeSymbol: "1", direction: "L", nextState: "A" },
      { currentState: "B", readSymbol: "1", writeSymbol: "1", direction: "R", nextState: "B" },
      { currentState: "C", readSymbol: "0", writeSymbol: "1", direction: "L", nextState: "B" },
      { currentState: "C", readSymbol: "1", writeSymbol: "1", direction: "R", nextState: "halt" },
    ],
    tapeInput: "",
  },
  {
    name: "Busy Beaver (4-state)",
    description: "4-state busy beaver: writes 13 ones before halting",
    states: ["A", "B", "C", "D", "halt"],
    alphabet: ["0", "1"],
    blankSymbol: "0",
    initialState: "A",
    acceptStates: ["halt"],
    rules: [
      { currentState: "A", readSymbol: "0", writeSymbol: "1", direction: "R", nextState: "B" },
      { currentState: "A", readSymbol: "1", writeSymbol: "1", direction: "L", nextState: "B" },
      { currentState: "B", readSymbol: "0", writeSymbol: "1", direction: "L", nextState: "A" },
      { currentState: "B", readSymbol: "1", writeSymbol: "0", direction: "L", nextState: "C" },
      { currentState: "C", readSymbol: "0", writeSymbol: "1", direction: "R", nextState: "halt" },
      { currentState: "C", readSymbol: "1", writeSymbol: "1", direction: "L", nextState: "D" },
      { currentState: "D", readSymbol: "0", writeSymbol: "1", direction: "R", nextState: "D" },
      { currentState: "D", readSymbol: "1", writeSymbol: "0", direction: "R", nextState: "A" },
    ],
    tapeInput: "",
  },
  {
    name: "Unary Addition",
    description: "Adds two unary numbers separated by +",
    states: ["q0", "q1", "q2", "halt"],
    alphabet: ["1", "+", BLANK],
    blankSymbol: BLANK,
    initialState: "q0",
    acceptStates: ["halt"],
    rules: [
      { currentState: "q0", readSymbol: "1", writeSymbol: "1", direction: "R", nextState: "q0" },
      { currentState: "q0", readSymbol: "+", writeSymbol: "1", direction: "R", nextState: "q1" },
      { currentState: "q1", readSymbol: "1", writeSymbol: "1", direction: "R", nextState: "q1" },
      { currentState: "q1", readSymbol: BLANK, writeSymbol: BLANK, direction: "L", nextState: "q2" },
      { currentState: "q2", readSymbol: "1", writeSymbol: BLANK, direction: "L", nextState: "halt" },
    ],
    tapeInput: "111+11",
  },
  {
    name: "Binary Addition",
    description: "Adds 1 to a binary number (right-aligned)",
    states: ["seek", "carry", "rewind", "halt"],
    alphabet: ["0", "1", BLANK],
    blankSymbol: BLANK,
    initialState: "seek",
    acceptStates: ["halt"],
    rules: [
      { currentState: "seek", readSymbol: "0", writeSymbol: "0", direction: "R", nextState: "seek" },
      { currentState: "seek", readSymbol: "1", writeSymbol: "1", direction: "R", nextState: "seek" },
      { currentState: "seek", readSymbol: BLANK, writeSymbol: BLANK, direction: "L", nextState: "carry" },
      { currentState: "carry", readSymbol: "1", writeSymbol: "0", direction: "L", nextState: "carry" },
      { currentState: "carry", readSymbol: "0", writeSymbol: "1", direction: "L", nextState: "rewind" },
      { currentState: "carry", readSymbol: BLANK, writeSymbol: "1", direction: "R", nextState: "halt" },
      { currentState: "rewind", readSymbol: "0", writeSymbol: "0", direction: "L", nextState: "rewind" },
      { currentState: "rewind", readSymbol: "1", writeSymbol: "1", direction: "L", nextState: "rewind" },
      { currentState: "rewind", readSymbol: BLANK, writeSymbol: BLANK, direction: "R", nextState: "halt" },
    ],
    tapeInput: "1011",
  },
  {
    name: "Copy String",
    description: "Copies a binary string after a separator",
    states: ["q0", "mark0", "mark1", "paste0", "paste1", "ret", "clean", "halt"],
    alphabet: ["0", "1", "X", "Y", "#", BLANK],
    blankSymbol: BLANK,
    initialState: "q0",
    acceptStates: ["halt"],
    rules: [
      { currentState: "q0", readSymbol: "0", writeSymbol: "X", direction: "R", nextState: "mark0" },
      { currentState: "q0", readSymbol: "1", writeSymbol: "Y", direction: "R", nextState: "mark1" },
      { currentState: "q0", readSymbol: "#", writeSymbol: "#", direction: "R", nextState: "clean" },
      { currentState: "mark0", readSymbol: "0", writeSymbol: "0", direction: "R", nextState: "mark0" },
      { currentState: "mark0", readSymbol: "1", writeSymbol: "1", direction: "R", nextState: "mark0" },
      { currentState: "mark0", readSymbol: "#", writeSymbol: "#", direction: "R", nextState: "paste0" },
      { currentState: "mark1", readSymbol: "0", writeSymbol: "0", direction: "R", nextState: "mark1" },
      { currentState: "mark1", readSymbol: "1", writeSymbol: "1", direction: "R", nextState: "mark1" },
      { currentState: "mark1", readSymbol: "#", writeSymbol: "#", direction: "R", nextState: "paste1" },
      { currentState: "paste0", readSymbol: "0", writeSymbol: "0", direction: "R", nextState: "paste0" },
      { currentState: "paste0", readSymbol: "1", writeSymbol: "1", direction: "R", nextState: "paste0" },
      { currentState: "paste0", readSymbol: BLANK, writeSymbol: "0", direction: "L", nextState: "ret" },
      { currentState: "paste1", readSymbol: "0", writeSymbol: "0", direction: "R", nextState: "paste1" },
      { currentState: "paste1", readSymbol: "1", writeSymbol: "1", direction: "R", nextState: "paste1" },
      { currentState: "paste1", readSymbol: BLANK, writeSymbol: "1", direction: "L", nextState: "ret" },
      { currentState: "ret", readSymbol: "0", writeSymbol: "0", direction: "L", nextState: "ret" },
      { currentState: "ret", readSymbol: "1", writeSymbol: "1", direction: "L", nextState: "ret" },
      { currentState: "ret", readSymbol: "#", writeSymbol: "#", direction: "L", nextState: "ret" },
      { currentState: "ret", readSymbol: "X", writeSymbol: "0", direction: "R", nextState: "q0" },
      { currentState: "ret", readSymbol: "Y", writeSymbol: "1", direction: "R", nextState: "q0" },
      { currentState: "clean", readSymbol: "0", writeSymbol: "0", direction: "R", nextState: "clean" },
      { currentState: "clean", readSymbol: "1", writeSymbol: "1", direction: "R", nextState: "clean" },
      { currentState: "clean", readSymbol: BLANK, writeSymbol: BLANK, direction: "S", nextState: "halt" },
    ],
    tapeInput: "101#",
  },
];

// ─────────────────────────────────────────────────────────
// CSS Variable Helper (SSR-safe)
// ─────────────────────────────────────────────────────────

function getCssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return val || fallback;
}

// ─────────────────────────────────────────────────────────
// Turing Machine Engine
// ─────────────────────────────────────────────────────────

function createTape(input: string, blankSymbol: string): Map<number, string> {
  const tape = new Map<number, string>();
  for (let i = 0; i < input.length; i++) {
    tape.set(i, input[i]);
  }
  if (input.length === 0) {
    tape.set(0, blankSymbol);
  }
  return tape;
}

function readTape(tape: Map<number, string>, position: number, blankSymbol: string): string {
  return tape.get(position) ?? blankSymbol;
}

function writeTape(tape: Map<number, string>, position: number, symbol: string): Map<number, string> {
  const next = new Map(tape);
  next.set(position, symbol);
  return next;
}

function findTransition(
  rules: TransitionRule[],
  currentState: string,
  readSymbol: string,
): TransitionRule | undefined {
  return rules.find(
    (r) => r.currentState === currentState && r.readSymbol === readSymbol,
  );
}

function cloneTape(tape: Map<number, string>): Map<number, string> {
  return new Map(tape);
}

function takeSnapshot(
  tape: Map<number, string>,
  headPosition: number,
  currentState: string,
  step: number,
): TapeSnapshot {
  return {
    tape: cloneTape(tape),
    headPosition,
    currentState,
    step,
  };
}

// ─────────────────────────────────────────────────────────
// Canvas Drawing Helpers
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

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

export default function TuringMachine() {
  // --- Machine state ---
  const [rules, setRules] = useState<TransitionRule[]>(PRESETS[0].rules);
  const [tape, setTape] = useState<Map<number, string>>(() =>
    createTape(PRESETS[0].tapeInput, PRESETS[0].blankSymbol),
  );
  const [headPosition, setHeadPosition] = useState(
    PRESETS[0].tapeInput.length > 0 ? PRESETS[0].tapeInput.length - 1 : 0,
  );
  const [currentState, setCurrentState] = useState(PRESETS[0].initialState);
  const [status, setStatus] = useState<MachineStatus>("idle");
  const [stepCount, setStepCount] = useState(0);
  const [activeTransition, setActiveTransition] = useState<TransitionRule | null>(null);

  // --- Configuration ---
  const [blankSymbol, setBlankSymbol] = useState(PRESETS[0].blankSymbol);
  const [initialState, setInitialState] = useState(PRESETS[0].initialState);
  const [acceptStates, setAcceptStates] = useState<string[]>(PRESETS[0].acceptStates);
  const [tapeInput, setTapeInput] = useState(PRESETS[0].tapeInput);
  const [speed, setSpeed] = useState(5);
  const [selectedPreset, setSelectedPreset] = useState(0);

  // --- History ---
  const [history, setHistory] = useState<TapeSnapshot[]>([]);

  // --- Editing ---
  const [editingRule, setEditingRule] = useState<number | null>(null);
  const [newRule, setNewRule] = useState<TransitionRule>({
    currentState: "",
    readSymbol: "",
    writeSymbol: "",
    direction: "R",
    nextState: "",
  });

  // --- Refs ---
  const tapeCanvasRef = useRef<HTMLCanvasElement>(null);
  const diagramCanvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const lastStepTimeRef = useRef<number>(0);
  const statusRef = useRef<MachineStatus>("idle");

  // Keep statusRef in sync
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // ─────────────────────────────────────────────────────────
  // Tape canvas rendering
  // ─────────────────────────────────────────────────────────

  const drawTape = useCallback(() => {
    const canvas = tapeCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = 100;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const colorBg = getCssVar("--color-bg", "#09090b");
    const colorSurface = getCssVar("--color-surface", "#111111");
    const colorBorder = getCssVar("--color-border", "#27272a");
    const colorText = getCssVar("--color-text", "#e4e4e7");
    const colorHeading = getCssVar("--color-heading", "#ffffff");
    const colorPrimary = getCssVar("--color-primary", "#4f8ff7");
    const colorAccent = getCssVar("--color-accent", "#34d399");

    const cellW = TAPE_CELL_SIZE;
    const cellH = TAPE_CELL_SIZE;
    const halfVisible = Math.floor(TAPE_VISIBLE_CELLS / 2);
    const totalCells = Math.min(TAPE_VISIBLE_CELLS, Math.ceil(w / (cellW + TAPE_CELL_GAP)) + 1);
    const halfCells = Math.floor(totalCells / 2);
    const startX = (w - totalCells * (cellW + TAPE_CELL_GAP) + TAPE_CELL_GAP) / 2;
    const tapeY = 40;

    // Draw head arrow above current cell
    const headX = startX + halfCells * (cellW + TAPE_CELL_GAP) + cellW / 2;
    ctx.fillStyle = colorPrimary;
    ctx.beginPath();
    ctx.moveTo(headX, tapeY - 8);
    ctx.lineTo(headX - 8, tapeY - 22);
    ctx.lineTo(headX + 8, tapeY - 22);
    ctx.closePath();
    ctx.fill();

    // State label above arrow
    ctx.font = "bold 11px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = colorPrimary;
    ctx.fillText(currentState, headX, tapeY - 26);

    // Draw tape cells
    for (let i = -halfCells; i <= halfCells; i++) {
      const tapePos = headPosition + i;
      const x = startX + (i + halfCells) * (cellW + TAPE_CELL_GAP);
      const isCurrent = i === 0;
      const symbol = readTape(tape, tapePos, blankSymbol);

      // Cell background
      ctx.fillStyle = isCurrent ? colorPrimary : colorSurface;
      ctx.strokeStyle = isCurrent ? colorPrimary : colorBorder;
      ctx.lineWidth = isCurrent ? 2 : 1;
      ctx.beginPath();
      ctx.roundRect(x, tapeY, cellW, cellH, 4);
      ctx.fill();
      ctx.stroke();

      // Symbol
      ctx.font = "bold 16px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = isCurrent ? colorBg : colorHeading;
      ctx.fillText(symbol, x + cellW / 2, tapeY + cellH / 2);

      // Position label
      ctx.font = "9px Inter, system-ui, sans-serif";
      ctx.fillStyle = getCssVar("--color-text-muted", "#a1a1aa");
      ctx.fillText(String(tapePos), x + cellW / 2, tapeY + cellH + 12);
    }
  }, [tape, headPosition, currentState, blankSymbol]);

  // ─────────────────────────────────────────────────────────
  // State diagram rendering
  // ─────────────────────────────────────────────────────────

  const drawStateDiagram = useCallback(() => {
    const canvas = diagramCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = 280;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const colorBorder = getCssVar("--color-border", "#27272a");
    const colorText = getCssVar("--color-text", "#e4e4e7");
    const colorHeading = getCssVar("--color-heading", "#ffffff");
    const colorPrimary = getCssVar("--color-primary", "#4f8ff7");
    const colorAccent = getCssVar("--color-accent", "#34d399");
    const colorSurface = getCssVar("--color-surface", "#111111");
    const colorMuted = getCssVar("--color-text-muted", "#a1a1aa");

    // Collect unique states from rules
    const stateSet = new Set<string>();
    stateSet.add(initialState);
    for (const r of rules) {
      stateSet.add(r.currentState);
      stateSet.add(r.nextState);
    }
    for (const s of acceptStates) {
      stateSet.add(s);
    }
    const stateList = Array.from(stateSet);

    if (stateList.length === 0) return;

    // Layout states in a circle or line
    const positions = new Map<string, StatePosition>();
    const cx = w / 2;
    const cy = h / 2;
    const layoutRadius = Math.min(w, h) / 2 - STATE_RADIUS - 30;

    if (stateList.length <= 2) {
      // Horizontal layout for 1-2 states
      const spacing = Math.min(200, w / (stateList.length + 1));
      stateList.forEach((s, i) => {
        positions.set(s, {
          x: cx - ((stateList.length - 1) * spacing) / 2 + i * spacing,
          y: cy,
        });
      });
    } else {
      // Circular layout
      const angleStep = (2 * Math.PI) / stateList.length;
      const startAngle = -Math.PI / 2;
      stateList.forEach((s, i) => {
        const angle = startAngle + i * angleStep;
        positions.set(s, {
          x: cx + layoutRadius * Math.cos(angle),
          y: cy + layoutRadius * Math.sin(angle),
        });
      });
    }

    // Group transitions by (from, to) for label stacking
    const transitionsByEdge = new Map<string, TransitionRule[]>();
    for (const r of rules) {
      const key = `${r.currentState}->${r.nextState}`;
      const existing = transitionsByEdge.get(key) ?? [];
      existing.push(r);
      transitionsByEdge.set(key, existing);
    }

    // Draw transitions (edges)
    for (const [key, edgeRules] of transitionsByEdge) {
      const fromState = edgeRules[0].currentState;
      const toState = edgeRules[0].nextState;
      const fromPos = positions.get(fromState);
      const toPos = positions.get(toState);
      if (!fromPos || !toPos) continue;

      const isActive = activeTransition !== null &&
        activeTransition.currentState === fromState &&
        activeTransition.nextState === toState;

      const label = edgeRules
        .map((r) => `${r.readSymbol}/${r.writeSymbol},${r.direction}`)
        .join("\n");

      ctx.strokeStyle = isActive ? colorAccent : colorBorder;
      ctx.fillStyle = isActive ? colorAccent : colorBorder;
      ctx.lineWidth = isActive ? 2.5 : 1.5;

      if (fromState === toState) {
        // Self-loop
        const loopRadius = 20;
        const loopCenterY = fromPos.y - STATE_RADIUS - loopRadius;
        ctx.beginPath();
        ctx.arc(fromPos.x, loopCenterY, loopRadius, 0.3 * Math.PI, 0.7 * Math.PI);
        ctx.stroke();

        // Arrow head at end of self-loop
        const endAngle = 0.7 * Math.PI;
        const ax = fromPos.x + loopRadius * Math.cos(endAngle);
        const ay = loopCenterY + loopRadius * Math.sin(endAngle);
        drawArrowHead(ctx, ax, ay, endAngle + Math.PI / 2, ARROW_SIZE);

        // Label
        ctx.font = "10px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = isActive ? colorAccent : colorMuted;
        const lines = label.split("\n");
        lines.forEach((line, li) => {
          ctx.fillText(line, fromPos.x, loopCenterY - loopRadius - 4 - (lines.length - 1 - li) * 12);
        });
      } else {
        // Check if reverse edge exists for curvature
        const reverseKey = `${toState}->${fromState}`;
        const hasBidirectional = transitionsByEdge.has(reverseKey);

        const dx = toPos.x - fromPos.x;
        const dy = toPos.y - fromPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);

        if (hasBidirectional) {
          // Curved edge
          const curvature = 30;
          const nx = -dy / dist;
          const ny = dx / dist;
          const midX = (fromPos.x + toPos.x) / 2 + nx * curvature;
          const midY = (fromPos.y + toPos.y) / 2 + ny * curvature;

          // Start and end points on circle boundary
          const startAngle = Math.atan2(midY - fromPos.y, midX - fromPos.x);
          const endAngle = Math.atan2(midY - toPos.y, midX - toPos.x);
          const sx = fromPos.x + STATE_RADIUS * Math.cos(startAngle);
          const sy = fromPos.y + STATE_RADIUS * Math.sin(startAngle);
          const ex = toPos.x + STATE_RADIUS * Math.cos(endAngle);
          const ey = toPos.y + STATE_RADIUS * Math.sin(endAngle);

          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.quadraticCurveTo(midX, midY, ex, ey);
          ctx.stroke();

          // Arrow head
          const arrAngle = Math.atan2(ey - midY, ex - midX);
          drawArrowHead(ctx, ex, ey, arrAngle, ARROW_SIZE);

          // Label at midpoint
          ctx.font = "10px JetBrains Mono, monospace";
          ctx.textAlign = "center";
          ctx.fillStyle = isActive ? colorAccent : colorMuted;
          const lines = label.split("\n");
          const labelOffset = curvature > 0 ? -8 : 8;
          lines.forEach((line, li) => {
            ctx.fillText(
              line,
              midX + nx * labelOffset,
              midY + ny * labelOffset - (lines.length - 1 - li) * 12,
            );
          });
        } else {
          // Straight edge
          const sx = fromPos.x + STATE_RADIUS * Math.cos(angle);
          const sy = fromPos.y + STATE_RADIUS * Math.sin(angle);
          const ex = toPos.x - STATE_RADIUS * Math.cos(angle);
          const ey = toPos.y - STATE_RADIUS * Math.sin(angle);

          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(ex, ey);
          ctx.stroke();

          drawArrowHead(ctx, ex, ey, angle, ARROW_SIZE);

          // Label at midpoint
          const mx = (sx + ex) / 2;
          const my = (sy + ey) / 2;
          const perpX = -Math.sin(angle);
          const perpY = Math.cos(angle);
          ctx.font = "10px JetBrains Mono, monospace";
          ctx.textAlign = "center";
          ctx.fillStyle = isActive ? colorAccent : colorMuted;
          const lines = label.split("\n");
          lines.forEach((line, li) => {
            ctx.fillText(
              line,
              mx + perpX * 14,
              my + perpY * 14 - (lines.length - 1 - li) * 12,
            );
          });
        }
      }
    }

    // Draw start arrow
    const startPos = positions.get(initialState);
    if (startPos) {
      const arrowLen = 35;
      ctx.strokeStyle = colorHeading;
      ctx.fillStyle = colorHeading;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startPos.x - STATE_RADIUS - arrowLen, startPos.y);
      ctx.lineTo(startPos.x - STATE_RADIUS, startPos.y);
      ctx.stroke();
      drawArrowHead(
        ctx,
        startPos.x - STATE_RADIUS,
        startPos.y,
        0,
        ARROW_SIZE,
      );
    }

    // Draw states (circles)
    for (const state of stateList) {
      const pos = positions.get(state);
      if (!pos) continue;

      const isCurrent = state === currentState;
      const isAccept = acceptStates.includes(state);
      const isHalt = state.toLowerCase() === "halt";

      // State circle
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, STATE_RADIUS, 0, 2 * Math.PI);
      ctx.fillStyle = isCurrent
        ? (isHalt || isAccept ? colorAccent : colorPrimary)
        : colorSurface;
      ctx.fill();
      ctx.strokeStyle = isCurrent
        ? (isHalt || isAccept ? colorAccent : colorPrimary)
        : colorBorder;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Accept state double circle
      if (isAccept) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, STATE_RADIUS - 5, 0, 2 * Math.PI);
        ctx.strokeStyle = isCurrent ? colorSurface : colorAccent;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // State label
      ctx.font = "bold 12px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = isCurrent ? colorSurface : colorHeading;
      ctx.fillText(state, pos.x, pos.y);
    }
  }, [rules, currentState, initialState, acceptStates, activeTransition]);

  // ─────────────────────────────────────────────────────────
  // Redraw on state changes
  // ─────────────────────────────────────────────────────────

  useEffect(() => {
    drawTape();
  }, [drawTape]);

  useEffect(() => {
    drawStateDiagram();
  }, [drawStateDiagram]);

  // Handle resize
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      drawTape();
      drawStateDiagram();
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [drawTape, drawStateDiagram]);

  // ─────────────────────────────────────────────────────────
  // Machine step logic
  // ─────────────────────────────────────────────────────────

  const executeStep = useCallback((): boolean => {
    const symbol = readTape(tape, headPosition, blankSymbol);
    const transition = findTransition(rules, currentState, symbol);

    if (!transition) {
      if (acceptStates.includes(currentState)) {
        setStatus("accepted");
        setActiveTransition(null);
      } else {
        setStatus(currentState.toLowerCase() === "halt" ? "halted" : "rejected");
        setActiveTransition(null);
      }
      return false;
    }

    // Save snapshot for history
    setHistory((prev) => [...prev, takeSnapshot(tape, headPosition, currentState, stepCount)]);

    setActiveTransition(transition);

    // Write symbol
    const newTape = writeTape(tape, headPosition, transition.writeSymbol);
    setTape(newTape);

    // Move head
    let newHeadPos = headPosition;
    if (transition.direction === "L") newHeadPos--;
    else if (transition.direction === "R") newHeadPos++;
    setHeadPosition(newHeadPos);

    // Update state
    setCurrentState(transition.nextState);
    const nextStep = stepCount + 1;
    setStepCount(nextStep);

    // Check for halt / accept / step limit
    if (acceptStates.includes(transition.nextState)) {
      // Check if there's a transition from the accept state
      const nextSymbol = readTape(newTape, newHeadPos, blankSymbol);
      const nextTrans = findTransition(rules, transition.nextState, nextSymbol);
      if (!nextTrans) {
        setStatus("accepted");
        setActiveTransition(null);
        return false;
      }
    }

    if (transition.nextState.toLowerCase() === "halt" && !acceptStates.includes(transition.nextState)) {
      setStatus("halted");
      setActiveTransition(null);
      return false;
    }

    if (nextStep >= MAX_STEPS) {
      setStatus("halted");
      setActiveTransition(null);
      return false;
    }

    return true;
  }, [tape, headPosition, currentState, rules, blankSymbol, acceptStates, stepCount]);

  // ─────────────────────────────────────────────────────────
  // Run loop
  // ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (status !== "running") {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = 0;
      }
      return;
    }

    const intervalMs = Math.max(10, 1000 / speed);

    const loop = (timestamp: number) => {
      if (statusRef.current !== "running") return;

      if (timestamp - lastStepTimeRef.current >= intervalMs) {
        lastStepTimeRef.current = timestamp;
        const canContinue = executeStep();
        if (!canContinue) return;
      }
      animFrameRef.current = requestAnimationFrame(loop);
    };

    lastStepTimeRef.current = performance.now();
    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [status, speed, executeStep]);

  // ─────────────────────────────────────────────────────────
  // Controls
  // ─────────────────────────────────────────────────────────

  const handleStep = useCallback(() => {
    if (status === "halted" || status === "accepted" || status === "rejected") return;
    if (status === "running") {
      setStatus("paused");
      return;
    }
    setStatus("paused");
    executeStep();
  }, [status, executeStep]);

  const handleRun = useCallback(() => {
    if (status === "halted" || status === "accepted" || status === "rejected") return;
    setStatus("running");
  }, [status]);

  const handlePause = useCallback(() => {
    if (status === "running") {
      setStatus("paused");
    }
  }, [status]);

  const handleReset = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    setTape(createTape(tapeInput, blankSymbol));
    setHeadPosition(tapeInput.length > 0 ? tapeInput.length - 1 : 0);
    setCurrentState(initialState);
    setStatus("idle");
    setStepCount(0);
    setHistory([]);
    setActiveTransition(null);
  }, [tapeInput, blankSymbol, initialState]);

  const handleStepBack = useCallback(() => {
    if (history.length === 0) return;
    const snapshot = history[history.length - 1];
    setTape(snapshot.tape);
    setHeadPosition(snapshot.headPosition);
    setCurrentState(snapshot.currentState);
    setStepCount(snapshot.step);
    setHistory((prev) => prev.slice(0, -1));
    setStatus("paused");
    setActiveTransition(null);
  }, [history]);

  // ─────────────────────────────────────────────────────────
  // Preset loading
  // ─────────────────────────────────────────────────────────

  const loadPreset = useCallback((index: number) => {
    const preset = PRESETS[index];
    if (!preset) return;
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    setSelectedPreset(index);
    setRules([...preset.rules]);
    setBlankSymbol(preset.blankSymbol);
    setInitialState(preset.initialState);
    setAcceptStates([...preset.acceptStates]);
    setTapeInput(preset.tapeInput);
    setTape(createTape(preset.tapeInput, preset.blankSymbol));
    setHeadPosition(preset.tapeInput.length > 0 ? preset.tapeInput.length - 1 : 0);
    setCurrentState(preset.initialState);
    setStatus("idle");
    setStepCount(0);
    setHistory([]);
    setActiveTransition(null);
  }, []);

  // ─────────────────────────────────────────────────────────
  // Transition table editing
  // ─────────────────────────────────────────────────────────

  const addRule = useCallback(() => {
    if (!newRule.currentState || !newRule.readSymbol || !newRule.writeSymbol || !newRule.nextState) return;
    setRules((prev) => [...prev, { ...newRule }]);
    setNewRule({ currentState: "", readSymbol: "", writeSymbol: "", direction: "R", nextState: "" });
  }, [newRule]);

  const removeRule = useCallback((index: number) => {
    setRules((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateRule = useCallback((index: number, field: keyof TransitionRule, value: string) => {
    setRules((prev) =>
      prev.map((r, i) =>
        i === index ? { ...r, [field]: value } : r,
      ),
    );
  }, []);

  // ─────────────────────────────────────────────────────────
  // Status badge
  // ─────────────────────────────────────────────────────────

  const statusBadge = useCallback(() => {
    const base = "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider";
    switch (status) {
      case "idle":
        return { cls: `${base} bg-[var(--color-surface)] text-[var(--color-text-muted)] border border-[var(--color-border)]`, label: "Ready" };
      case "running":
        return { cls: `${base} bg-[var(--color-primary)] text-white`, label: "Running" };
      case "paused":
        return { cls: `${base} bg-yellow-600/20 text-yellow-400 border border-yellow-600/40`, label: "Paused" };
      case "halted":
        return { cls: `${base} bg-orange-600/20 text-orange-400 border border-orange-600/40`, label: "Halted" };
      case "accepted":
        return { cls: `${base} bg-emerald-600/20 text-emerald-400 border border-emerald-600/40`, label: "Accepted" };
      case "rejected":
        return { cls: `${base} bg-red-600/20 text-red-400 border border-red-600/40`, label: "Rejected" };
    }
  }, [status]);

  const badge = statusBadge();

  // ─────────────────────────────────────────────────────────
  // Tape input handling
  // ─────────────────────────────────────────────────────────

  const handleTapeInputChange = useCallback(
    (value: string) => {
      setTapeInput(value);
      if (status === "idle") {
        setTape(createTape(value, blankSymbol));
        setHeadPosition(value.length > 0 ? value.length - 1 : 0);
        setCurrentState(initialState);
        setStepCount(0);
        setHistory([]);
      }
    },
    [status, blankSymbol, initialState],
  );

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────

  const isTerminal = status === "halted" || status === "accepted" || status === "rejected";
  const inputCls = "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text)] font-mono focus:border-[var(--color-primary)] focus:outline-none";
  const btnCls = "rounded px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const btnPrimary = `${btnCls} bg-[var(--color-primary)] text-white hover:opacity-90`;
  const btnSecondary = `${btnCls} border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface)]`;

  return (
    <div class="space-y-4">
      {/* Status Bar */}
      <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <div class="flex items-center gap-3">
          <span class={badge.cls}>{badge.label}</span>
          <span class="text-xs text-[var(--color-text-muted)]">
            Step: <span class="font-mono text-[var(--color-heading)]">{stepCount}</span>
            {stepCount >= MAX_STEPS && (
              <span class="ml-2 text-orange-400">(limit reached)</span>
            )}
          </span>
        </div>
        <span class="text-xs text-[var(--color-text-muted)]">
          State: <span class="font-mono font-semibold text-[var(--color-primary)]">{currentState}</span>
        </span>
      </div>

      {/* Tape Canvas */}
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <div class="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Tape</div>
        <canvas
          ref={tapeCanvasRef}
          class="w-full"
          style={{ height: "100px" }}
        />
      </div>

      {/* Controls */}
      <div class="flex flex-wrap items-center gap-2">
        <button
          class={btnSecondary}
          onClick={handleStepBack}
          disabled={history.length === 0 || status === "running"}
          title="Step back"
        >
          &#9664;&#9664; Back
        </button>
        <button
          class={btnPrimary}
          onClick={handleStep}
          disabled={isTerminal}
          title="Single step"
        >
          Step
        </button>
        <button
          class={`${btnCls} bg-emerald-600 text-white hover:bg-emerald-700`}
          onClick={handleRun}
          disabled={isTerminal || status === "running"}
          title="Run"
        >
          Run
        </button>
        <button
          class={`${btnCls} bg-yellow-600 text-white hover:bg-yellow-700`}
          onClick={handlePause}
          disabled={status !== "running"}
          title="Pause"
        >
          Pause
        </button>
        <button
          class={btnSecondary}
          onClick={handleReset}
          title="Reset"
        >
          Reset
        </button>

        <div class="ml-auto flex items-center gap-2">
          <label class="text-xs text-[var(--color-text-muted)]">Speed:</label>
          <input
            type="range"
            min="1"
            max="100"
            value={speed}
            onInput={(e) => setSpeed(Number((e.target as HTMLInputElement).value))}
            class="h-1.5 w-24 cursor-pointer accent-[var(--color-primary)]"
          />
          <span class="w-8 text-right text-xs font-mono text-[var(--color-text-muted)]">{speed}</span>
        </div>
      </div>

      {/* Active Transition Display */}
      {activeTransition && (
        <div class="flex items-center gap-2 rounded border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 px-3 py-1.5 text-xs">
          <span class="text-[var(--color-accent)] font-semibold">Transition:</span>
          <span class="font-mono text-[var(--color-text)]">
            ({activeTransition.currentState}, {activeTransition.readSymbol}) &rarr; ({activeTransition.writeSymbol}, {activeTransition.direction}, {activeTransition.nextState})
          </span>
        </div>
      )}

      {/* Tape Input & Presets Row */}
      <div class="grid gap-3 sm:grid-cols-2">
        {/* Tape Input */}
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <label class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Tape Input
          </label>
          <input
            type="text"
            class={inputCls}
            value={tapeInput}
            onInput={(e) => handleTapeInputChange((e.target as HTMLInputElement).value)}
            placeholder="Enter tape content..."
            disabled={status !== "idle"}
          />
          <p class="mt-1 text-[10px] text-[var(--color-text-muted)]">
            Head starts at rightmost character (or position 0 if empty)
          </p>
        </div>

        {/* Presets */}
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <label class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Presets
          </label>
          <select
            class={inputCls}
            value={selectedPreset}
            onChange={(e) => loadPreset(Number((e.target as HTMLSelectElement).value))}
          >
            {PRESETS.map((p, i) => (
              <option key={i} value={i}>
                {p.name}
              </option>
            ))}
          </select>
          <p class="mt-1 text-[10px] text-[var(--color-text-muted)]">
            {PRESETS[selectedPreset]?.description}
          </p>
        </div>
      </div>

      {/* State Diagram */}
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <div class="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          State Diagram
        </div>
        <canvas
          ref={diagramCanvasRef}
          class="w-full"
          style={{ height: "280px" }}
        />
      </div>

      {/* Transition Table */}
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <div class="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          Transition Table
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="border-b border-[var(--color-border)] text-left">
                <th class="px-2 py-1.5 font-semibold text-[var(--color-text-muted)]">State</th>
                <th class="px-2 py-1.5 font-semibold text-[var(--color-text-muted)]">Read</th>
                <th class="px-2 py-1.5 font-semibold text-[var(--color-text-muted)]">Write</th>
                <th class="px-2 py-1.5 font-semibold text-[var(--color-text-muted)]">Move</th>
                <th class="px-2 py-1.5 font-semibold text-[var(--color-text-muted)]">Next</th>
                <th class="px-2 py-1.5 font-semibold text-[var(--color-text-muted)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, i) => {
                const isActiveRow =
                  activeTransition !== null &&
                  activeTransition.currentState === rule.currentState &&
                  activeTransition.readSymbol === rule.readSymbol;

                return (
                  <tr
                    key={i}
                    class={`border-b border-[var(--color-border)]/50 ${
                      isActiveRow ? "bg-[var(--color-accent)]/10" : ""
                    }`}
                  >
                    {editingRule === i ? (
                      <>
                        <td class="px-2 py-1">
                          <input
                            class={inputCls + " !w-16"}
                            value={rule.currentState}
                            onInput={(e) =>
                              updateRule(i, "currentState", (e.target as HTMLInputElement).value)
                            }
                          />
                        </td>
                        <td class="px-2 py-1">
                          <input
                            class={inputCls + " !w-10"}
                            value={rule.readSymbol}
                            maxLength={1}
                            onInput={(e) =>
                              updateRule(i, "readSymbol", (e.target as HTMLInputElement).value)
                            }
                          />
                        </td>
                        <td class="px-2 py-1">
                          <input
                            class={inputCls + " !w-10"}
                            value={rule.writeSymbol}
                            maxLength={1}
                            onInput={(e) =>
                              updateRule(i, "writeSymbol", (e.target as HTMLInputElement).value)
                            }
                          />
                        </td>
                        <td class="px-2 py-1">
                          <select
                            class={inputCls + " !w-12"}
                            value={rule.direction}
                            onChange={(e) =>
                              updateRule(i, "direction", (e.target as HTMLSelectElement).value)
                            }
                          >
                            <option value="L">L</option>
                            <option value="R">R</option>
                            <option value="S">S</option>
                          </select>
                        </td>
                        <td class="px-2 py-1">
                          <input
                            class={inputCls + " !w-16"}
                            value={rule.nextState}
                            onInput={(e) =>
                              updateRule(i, "nextState", (e.target as HTMLInputElement).value)
                            }
                          />
                        </td>
                        <td class="px-2 py-1">
                          <button
                            class="text-[var(--color-primary)] hover:underline"
                            onClick={() => setEditingRule(null)}
                          >
                            Done
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td class="px-2 py-1.5 font-mono text-[var(--color-heading)]">
                          {rule.currentState}
                        </td>
                        <td class="px-2 py-1.5 font-mono">{rule.readSymbol}</td>
                        <td class="px-2 py-1.5 font-mono text-[var(--color-accent)]">
                          {rule.writeSymbol}
                        </td>
                        <td class="px-2 py-1.5 font-mono">{rule.direction}</td>
                        <td class="px-2 py-1.5 font-mono text-[var(--color-primary)]">
                          {rule.nextState}
                        </td>
                        <td class="px-2 py-1.5">
                          <div class="flex gap-2">
                            <button
                              class="text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
                              onClick={() => setEditingRule(i)}
                              title="Edit"
                            >
                              Edit
                            </button>
                            <button
                              class="text-[var(--color-text-muted)] hover:text-red-400"
                              onClick={() => removeRule(i)}
                              title="Delete"
                            >
                              Del
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
              {/* Add new rule row */}
              <tr class="border-t border-[var(--color-border)]">
                <td class="px-2 py-1">
                  <input
                    class={inputCls + " !w-16"}
                    value={newRule.currentState}
                    placeholder="state"
                    onInput={(e) =>
                      setNewRule((p) => ({ ...p, currentState: (e.target as HTMLInputElement).value }))
                    }
                  />
                </td>
                <td class="px-2 py-1">
                  <input
                    class={inputCls + " !w-10"}
                    value={newRule.readSymbol}
                    placeholder="r"
                    maxLength={1}
                    onInput={(e) =>
                      setNewRule((p) => ({ ...p, readSymbol: (e.target as HTMLInputElement).value }))
                    }
                  />
                </td>
                <td class="px-2 py-1">
                  <input
                    class={inputCls + " !w-10"}
                    value={newRule.writeSymbol}
                    placeholder="w"
                    maxLength={1}
                    onInput={(e) =>
                      setNewRule((p) => ({ ...p, writeSymbol: (e.target as HTMLInputElement).value }))
                    }
                  />
                </td>
                <td class="px-2 py-1">
                  <select
                    class={inputCls + " !w-12"}
                    value={newRule.direction}
                    onChange={(e) =>
                      setNewRule((p) => ({
                        ...p,
                        direction: (e.target as HTMLSelectElement).value as Direction,
                      }))
                    }
                  >
                    <option value="L">L</option>
                    <option value="R">R</option>
                    <option value="S">S</option>
                  </select>
                </td>
                <td class="px-2 py-1">
                  <input
                    class={inputCls + " !w-16"}
                    value={newRule.nextState}
                    placeholder="next"
                    onInput={(e) =>
                      setNewRule((p) => ({ ...p, nextState: (e.target as HTMLInputElement).value }))
                    }
                  />
                </td>
                <td class="px-2 py-1">
                  <button
                    class={`text-xs font-semibold text-[var(--color-accent)] hover:underline disabled:opacity-40 disabled:cursor-not-allowed`}
                    onClick={addRule}
                    disabled={
                      !newRule.currentState ||
                      !newRule.readSymbol ||
                      !newRule.writeSymbol ||
                      !newRule.nextState
                    }
                  >
                    + Add
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Configuration */}
      <div class="grid gap-3 sm:grid-cols-3">
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <label class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Initial State
          </label>
          <input
            type="text"
            class={inputCls}
            value={initialState}
            onInput={(e) => setInitialState((e.target as HTMLInputElement).value)}
            disabled={status !== "idle"}
          />
        </div>
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <label class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Accept States
          </label>
          <input
            type="text"
            class={inputCls}
            value={acceptStates.join(", ")}
            onInput={(e) =>
              setAcceptStates(
                (e.target as HTMLInputElement).value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
            placeholder="comma-separated"
            disabled={status !== "idle"}
          />
        </div>
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <label class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Blank Symbol
          </label>
          <input
            type="text"
            class={inputCls}
            value={blankSymbol}
            maxLength={1}
            onInput={(e) => setBlankSymbol((e.target as HTMLInputElement).value || BLANK)}
            disabled={status !== "idle"}
          />
        </div>
      </div>
    </div>
  );
}
