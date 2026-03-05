// ─────────────────────────────────────────────────────────
// State Machine Engine — Pure computation, no DOM/Canvas
// ─────────────────────────────────────────────────────────

export const EPSILON = "\u03B5"; // ε

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export interface State {
  id: string;
  label: string;
  x: number;
  y: number;
  isStart: boolean;
  isAccept: boolean;
}

export interface Transition {
  id: string;
  from: string; // state id
  to: string; // state id
  symbols: string[]; // input symbols (including EPSILON for NFA)
}

export interface StateMachine {
  states: State[];
  transitions: Transition[];
  alphabet: string[];
}

export type MachineType = "DFA" | "NFA" | "INCOMPLETE";

export interface SimulationStep {
  stepIndex: number;
  symbol: string;
  activeStates: Set<string>;
  isStuck: boolean;
}

export interface SimulationResult {
  steps: SimulationStep[];
  accepted: boolean;
  finalStates: Set<string>;
}

export interface TransitionTableRow {
  stateId: string;
  stateLabel: string;
  isStart: boolean;
  isAccept: boolean;
  transitions: Record<string, string[]>; // symbol -> target state labels
}

// ─────────────────────────────────────────────────────────
// Alphabet extraction
// ─────────────────────────────────────────────────────────

export function extractAlphabet(transitions: Transition[]): string[] {
  const symbols = new Set<string>();
  for (const t of transitions) {
    for (const s of t.symbols) {
      if (s !== EPSILON) symbols.add(s);
    }
  }
  return Array.from(symbols).sort();
}

// ─────────────────────────────────────────────────────────
// Machine type detection
// ─────────────────────────────────────────────────────────

export function detectMachineType(machine: StateMachine): MachineType {
  const { states, transitions } = machine;
  const alphabet = extractAlphabet(transitions);

  // Check for epsilon transitions -> NFA
  for (const t of transitions) {
    if (t.symbols.includes(EPSILON)) return "NFA";
  }

  // Check for multiple transitions from same state on same symbol -> NFA
  for (const state of states) {
    for (const symbol of alphabet) {
      const targets = getTransitionTargets(transitions, state.id, symbol);
      if (targets.length > 1) return "NFA";
    }
  }

  // Check completeness (every state must have a transition for every symbol)
  for (const state of states) {
    for (const symbol of alphabet) {
      const targets = getTransitionTargets(transitions, state.id, symbol);
      if (targets.length === 0) return "INCOMPLETE";
    }
  }

  return "DFA";
}

// ─────────────────────────────────────────────────────────
// Transition lookup
// ─────────────────────────────────────────────────────────

export function getTransitionTargets(
  transitions: Transition[],
  fromId: string,
  symbol: string,
): string[] {
  const targets: string[] = [];
  for (const t of transitions) {
    if (t.from === fromId && t.symbols.includes(symbol)) {
      if (!targets.includes(t.to)) targets.push(t.to);
    }
  }
  return targets;
}

// ─────────────────────────────────────────────────────────
// Epsilon closure
// ─────────────────────────────────────────────────────────

export function epsilonClosure(
  transitions: Transition[],
  stateIds: Set<string>,
): Set<string> {
  const closure = new Set(stateIds);
  const stack = Array.from(stateIds);

  while (stack.length > 0) {
    const current = stack.pop()!;
    const targets = getTransitionTargets(transitions, current, EPSILON);
    for (const t of targets) {
      if (!closure.has(t)) {
        closure.add(t);
        stack.push(t);
      }
    }
  }

  return closure;
}

// ─────────────────────────────────────────────────────────
// Input simulation (supports NFA with epsilon)
// ─────────────────────────────────────────────────────────

export function simulateInput(
  machine: StateMachine,
  input: string,
): SimulationResult {
  const { states, transitions } = machine;
  const startState = states.find((s) => s.isStart);

  if (!startState) {
    return {
      steps: [],
      accepted: false,
      finalStates: new Set(),
    };
  }

  // Initial active states = epsilon closure of start state
  let activeStates = epsilonClosure(transitions, new Set([startState.id]));

  const steps: SimulationStep[] = [
    {
      stepIndex: 0,
      symbol: "START",
      activeStates: new Set(activeStates),
      isStuck: activeStates.size === 0,
    },
  ];

  const symbols = input.split("");

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    const nextStates = new Set<string>();

    for (const stateId of activeStates) {
      const targets = getTransitionTargets(transitions, stateId, symbol);
      for (const t of targets) nextStates.add(t);
    }

    // Apply epsilon closure to the new states
    activeStates = epsilonClosure(transitions, nextStates);

    steps.push({
      stepIndex: i + 1,
      symbol,
      activeStates: new Set(activeStates),
      isStuck: activeStates.size === 0,
    });
  }

  const acceptStateIds = new Set(
    states.filter((s) => s.isAccept).map((s) => s.id),
  );
  const finalStates = new Set(activeStates);
  const accepted = Array.from(activeStates).some((s) => acceptStateIds.has(s));

  return { steps, accepted, finalStates };
}

// ─────────────────────────────────────────────────────────
// Transition table generation
// ─────────────────────────────────────────────────────────

export function buildTransitionTable(
  machine: StateMachine,
): TransitionTableRow[] {
  const { states, transitions } = machine;
  const alphabet = extractAlphabet(transitions);
  const hasEpsilon = transitions.some((t) => t.symbols.includes(EPSILON));
  const allSymbols = hasEpsilon ? [...alphabet, EPSILON] : alphabet;

  const stateMap = new Map(states.map((s) => [s.id, s]));

  return states.map((state) => {
    const row: Record<string, string[]> = {};
    for (const symbol of allSymbols) {
      const targets = getTransitionTargets(transitions, state.id, symbol);
      row[symbol] = targets.map((t) => stateMap.get(t)?.label ?? t);
    }
    return {
      stateId: state.id,
      stateLabel: state.label,
      isStart: state.isStart,
      isAccept: state.isAccept,
      transitions: row,
    };
  });
}

// ─────────────────────────────────────────────────────────
// Export: DOT format
// ─────────────────────────────────────────────────────────

export function toDotFormat(machine: StateMachine): string {
  const { states, transitions } = machine;
  const lines: string[] = ["digraph FSM {", "  rankdir=LR;"];

  // Start arrow
  const startState = states.find((s) => s.isStart);
  if (startState) {
    lines.push('  __start [shape=none, label=""];');
    lines.push(`  __start -> ${sanitizeDotId(startState.label)};`);
  }

  // Accept states
  const acceptLabels = states
    .filter((s) => s.isAccept)
    .map((s) => sanitizeDotId(s.label));
  if (acceptLabels.length > 0) {
    lines.push(
      `  node [shape=doublecircle]; ${acceptLabels.join(" ")};`,
    );
  }

  // Normal states
  const normalLabels = states
    .filter((s) => !s.isAccept)
    .map((s) => sanitizeDotId(s.label));
  if (normalLabels.length > 0) {
    lines.push(`  node [shape=circle]; ${normalLabels.join(" ")};`);
  }

  // Group transitions between same state pairs
  const edgeMap = new Map<string, string[]>();
  for (const t of transitions) {
    const fromState = states.find((s) => s.id === t.from);
    const toState = states.find((s) => s.id === t.to);
    if (!fromState || !toState) continue;

    const key = `${sanitizeDotId(fromState.label)}->${sanitizeDotId(toState.label)}`;
    const existing = edgeMap.get(key) ?? [];
    existing.push(...t.symbols);
    edgeMap.set(key, existing);
  }

  for (const [edge, symbols] of edgeMap) {
    const [from, to] = edge.split("->");
    const label = symbols.join(",");
    lines.push(`  ${from} -> ${to} [label="${label}"];`);
  }

  lines.push("}");
  return lines.join("\n");
}

function sanitizeDotId(label: string): string {
  return /^[a-zA-Z_]\w*$/.test(label) ? label : `"${label}"`;
}

// ─────────────────────────────────────────────────────────
// Export: Markdown transition table
// ─────────────────────────────────────────────────────────

export function toMarkdownTable(machine: StateMachine): string {
  const table = buildTransitionTable(machine);
  const alphabet = extractAlphabet(machine.transitions);
  const hasEpsilon = machine.transitions.some((t) =>
    t.symbols.includes(EPSILON),
  );
  const allSymbols = hasEpsilon ? [...alphabet, EPSILON] : alphabet;

  if (table.length === 0 || allSymbols.length === 0) return "";

  const header = `| State | ${allSymbols.join(" | ")} |`;
  const separator = `|-------|${allSymbols.map(() => "-------").join("|")}|`;

  const rows = table.map((row) => {
    const prefix = `${row.isStart ? ">" : ""}${row.isAccept ? "*" : ""}`;
    const stateCell = `${prefix}${row.stateLabel}`;
    const cells = allSymbols.map((s) => {
      const targets = row.transitions[s] ?? [];
      return targets.length > 0 ? `{${targets.join(",")}}` : "-";
    });
    return `| ${stateCell} | ${cells.join(" | ")} |`;
  });

  return [header, separator, ...rows].join("\n");
}

// ─────────────────────────────────────────────────────────
// NFA to DFA conversion (subset construction)
// ─────────────────────────────────────────────────────────

export function nfaToDfa(machine: StateMachine): StateMachine {
  const { states, transitions } = machine;
  const alphabet = extractAlphabet(transitions);
  const stateMap = new Map(states.map((s) => [s.id, s]));
  const acceptIds = new Set(states.filter((s) => s.isAccept).map((s) => s.id));

  const startState = states.find((s) => s.isStart);
  if (!startState) return { states: [], transitions: [], alphabet };

  const startClosure = epsilonClosure(transitions, new Set([startState.id]));
  const startKey = setToKey(startClosure);

  const dfaStates: State[] = [];
  const dfaTransitions: Transition[] = [];
  const visited = new Map<string, string>(); // key -> dfa state id
  const queue: Array<{ key: string; stateSet: Set<string> }> = [];

  let idCounter = 0;

  function createDfaState(stateSet: Set<string>): string {
    const key = setToKey(stateSet);
    if (visited.has(key)) return visited.get(key)!;

    const id = `dfa_${idCounter++}`;
    const label = `{${Array.from(stateSet)
      .map((s) => stateMap.get(s)?.label ?? s)
      .sort()
      .join(",")}}`;
    const isAccept = Array.from(stateSet).some((s) => acceptIds.has(s));

    dfaStates.push({
      id,
      label,
      x: 100 + dfaStates.length * 150,
      y: 200,
      isStart: dfaStates.length === 0,
      isAccept,
    });

    visited.set(key, id);
    queue.push({ key, stateSet });
    return id;
  }

  createDfaState(startClosure);

  while (queue.length > 0) {
    const { stateSet } = queue.shift()!;
    const fromId = visited.get(setToKey(stateSet))!;

    for (const symbol of alphabet) {
      const nextStates = new Set<string>();
      for (const s of stateSet) {
        const targets = getTransitionTargets(transitions, s, symbol);
        for (const t of targets) nextStates.add(t);
      }

      if (nextStates.size === 0) continue;

      const closure = epsilonClosure(transitions, nextStates);
      if (closure.size === 0) continue;

      const toId = createDfaState(closure);

      dfaTransitions.push({
        id: `dt_${dfaTransitions.length}`,
        from: fromId,
        to: toId,
        symbols: [symbol],
      });
    }
  }

  // Layout DFA states in a grid
  const cols = Math.ceil(Math.sqrt(dfaStates.length));
  dfaStates.forEach((s, i) => {
    s.x = 120 + (i % cols) * 160;
    s.y = 120 + Math.floor(i / cols) * 160;
  });

  return { states: dfaStates, transitions: dfaTransitions, alphabet };
}

function setToKey(s: Set<string>): string {
  return Array.from(s).sort().join("|");
}

// ─────────────────────────────────────────────────────────
// Presets
// ─────────────────────────────────────────────────────────

export interface Preset {
  name: string;
  description: string;
  machine: StateMachine;
  testInputs: string[];
}

export const PRESETS: Preset[] = [
  {
    name: "Even number of 1s",
    description: "DFA: Accepts binary strings with an even number of 1s",
    machine: {
      states: [
        { id: "q0", label: "q0", x: 150, y: 200, isStart: true, isAccept: true },
        { id: "q1", label: "q1", x: 400, y: 200, isStart: false, isAccept: false },
      ],
      transitions: [
        { id: "t0", from: "q0", to: "q0", symbols: ["0"] },
        { id: "t1", from: "q0", to: "q1", symbols: ["1"] },
        { id: "t2", from: "q1", to: "q1", symbols: ["0"] },
        { id: "t3", from: "q1", to: "q0", symbols: ["1"] },
      ],
      alphabet: ["0", "1"],
    },
    testInputs: ["0110", "101", "1001", "111"],
  },
  {
    name: 'Contains "ab"',
    description: 'DFA: Accepts strings over {a,b} that contain the substring "ab"',
    machine: {
      states: [
        { id: "q0", label: "q0", x: 120, y: 200, isStart: true, isAccept: false },
        { id: "q1", label: "q1", x: 320, y: 200, isStart: false, isAccept: false },
        { id: "q2", label: "q2", x: 520, y: 200, isStart: false, isAccept: true },
      ],
      transitions: [
        { id: "t0", from: "q0", to: "q1", symbols: ["a"] },
        { id: "t1", from: "q0", to: "q0", symbols: ["b"] },
        { id: "t2", from: "q1", to: "q1", symbols: ["a"] },
        { id: "t3", from: "q1", to: "q2", symbols: ["b"] },
        { id: "t4", from: "q2", to: "q2", symbols: ["a", "b"] },
      ],
      alphabet: ["a", "b"],
    },
    testInputs: ["ab", "bab", "aab", "bba", "aabb"],
  },
  {
    name: "Binary div by 3",
    description: "DFA: Accepts binary numbers divisible by 3 (reading left to right)",
    machine: {
      states: [
        { id: "q0", label: "r0", x: 150, y: 200, isStart: true, isAccept: true },
        { id: "q1", label: "r1", x: 400, y: 100, isStart: false, isAccept: false },
        { id: "q2", label: "r2", x: 400, y: 300, isStart: false, isAccept: false },
      ],
      transitions: [
        { id: "t0", from: "q0", to: "q0", symbols: ["0"] },
        { id: "t1", from: "q0", to: "q1", symbols: ["1"] },
        { id: "t2", from: "q1", to: "q2", symbols: ["0"] },
        { id: "t3", from: "q1", to: "q0", symbols: ["1"] },
        { id: "t4", from: "q2", to: "q1", symbols: ["0"] },
        { id: "t5", from: "q2", to: "q2", symbols: ["1"] },
      ],
      alphabet: ["0", "1"],
    },
    testInputs: ["0", "11", "110", "101", "1001", "111"],
  },
  {
    name: "Alternating 0/1",
    description: "DFA: Accepts strings of alternating 0s and 1s (starting with either)",
    machine: {
      states: [
        { id: "q0", label: "q0", x: 120, y: 200, isStart: true, isAccept: true },
        { id: "q1", label: "q1", x: 320, y: 120, isStart: false, isAccept: true },
        { id: "q2", label: "q2", x: 320, y: 280, isStart: false, isAccept: true },
        { id: "q3", label: "dead", x: 520, y: 200, isStart: false, isAccept: false },
      ],
      transitions: [
        { id: "t0", from: "q0", to: "q1", symbols: ["0"] },
        { id: "t1", from: "q0", to: "q2", symbols: ["1"] },
        { id: "t2", from: "q1", to: "q2", symbols: ["1"] },
        { id: "t3", from: "q1", to: "q3", symbols: ["0"] },
        { id: "t4", from: "q2", to: "q1", symbols: ["0"] },
        { id: "t5", from: "q2", to: "q3", symbols: ["1"] },
        { id: "t6", from: "q3", to: "q3", symbols: ["0", "1"] },
      ],
      alphabet: ["0", "1"],
    },
    testInputs: ["0101", "1010", "010", "0011"],
  },
  {
    name: "NFA: ends with 01",
    description: "NFA: Accepts binary strings that end with 01",
    machine: {
      states: [
        { id: "q0", label: "q0", x: 120, y: 200, isStart: true, isAccept: false },
        { id: "q1", label: "q1", x: 320, y: 200, isStart: false, isAccept: false },
        { id: "q2", label: "q2", x: 520, y: 200, isStart: false, isAccept: true },
      ],
      transitions: [
        { id: "t0", from: "q0", to: "q0", symbols: ["0", "1"] },
        { id: "t1", from: "q0", to: "q1", symbols: ["0"] },
        { id: "t2", from: "q1", to: "q2", symbols: ["1"] },
      ],
      alphabet: ["0", "1"],
    },
    testInputs: ["01", "101", "0101", "10", "11"],
  },
];
