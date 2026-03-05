import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";

/* ================================================================
   TYPES
   ================================================================ */

/** AST node types for parsed regex */
type ASTNode =
  | { type: "literal"; char: string }
  | { type: "dot" }
  | { type: "charClass"; chars: string[]; negated: boolean }
  | { type: "concat"; left: ASTNode; right: ASTNode }
  | { type: "union"; left: ASTNode; right: ASTNode }
  | { type: "star"; child: ASTNode }
  | { type: "plus"; child: ASTNode }
  | { type: "optional"; child: ASTNode }
  | { type: "group"; child: ASTNode };

/** NFA transition */
interface NFATransition {
  from: number;
  to: number;
  label: string; // "ε" for epsilon transitions
}

/** NFA representation */
interface NFA {
  startState: number;
  acceptState: number;
  states: number[];
  transitions: NFATransition[];
}

/** DFA state (set of NFA states) */
interface DFAState {
  id: number;
  nfaStates: Set<number>;
  isAccept: boolean;
  label: string;
}

/** DFA transition */
interface DFATransition {
  from: number;
  to: number;
  label: string;
}

/** DFA representation */
interface DFA {
  startState: number;
  states: DFAState[];
  transitions: DFATransition[];
  alphabet: string[];
}

/** Position for layout */
interface NodePosition {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

type ViewMode = "nfa" | "dfa";

interface Preset {
  label: string;
  pattern: string;
  testString: string;
  description: string;
}

/* ================================================================
   CONSTANTS
   ================================================================ */

const EPSILON = "\u03B5";

const PRESETS: Preset[] = [
  {
    label: "Union: ab|cd",
    pattern: "ab|cd",
    testString: "ab",
    description: "Alternation between two concatenations",
  },
  {
    label: "Star: a*b",
    pattern: "a*b",
    testString: "aaab",
    description: "Kleene star followed by concatenation",
  },
  {
    label: "Combined: (a|b)*c",
    pattern: "(a|b)*c",
    testString: "abac",
    description: "Union inside Kleene star, then concat",
  },
  {
    label: "Class: [0-9]+",
    pattern: "[0-9]+",
    testString: "42",
    description: "Character class with plus quantifier",
  },
  {
    label: "Quantifiers: a?b+c*",
    pattern: "a?b+c*",
    testString: "bbcc",
    description: "Optional, plus, and star quantifiers",
  },
  {
    label: "Dot: a.b",
    pattern: "a.b",
    testString: "axb",
    description: "Dot matches any character",
  },
];

const STATE_RADIUS = 20;
const CANVAS_PADDING = 50;

/* ================================================================
   REGEX PARSER — Recursive Descent
   Produces an AST from a regex string.
   Grammar:
     expr     → term ('|' term)*
     term     → factor factor*
     factor   → atom ('*' | '+' | '?')*
     atom     → '(' expr ')' | charClass | '.' | escaped | literal
     charClass → '[' '^'? (range | char)* ']'
   ================================================================ */

class ParseError extends Error {
  constructor(
    message: string,
    public position: number,
  ) {
    super(message);
  }
}

function parseRegex(pattern: string): ASTNode {
  let pos = 0;

  function peek(): string | undefined {
    return pattern[pos];
  }

  function advance(): string {
    return pattern[pos++];
  }

  function expect(ch: string): void {
    if (peek() !== ch) {
      throw new ParseError(`Expected '${ch}' at position ${pos}`, pos);
    }
    advance();
  }

  function parseExpr(): ASTNode {
    let node = parseTerm();
    while (peek() === "|") {
      advance();
      const right = parseTerm();
      node = { type: "union", left: node, right };
    }
    return node;
  }

  function parseTerm(): ASTNode {
    let node: ASTNode | null = null;

    while (pos < pattern.length && peek() !== ")" && peek() !== "|") {
      const factor = parseFactor();
      if (node === null) {
        node = factor;
      } else {
        node = { type: "concat", left: node, right: factor };
      }
    }

    if (node === null) {
      // Empty term — match empty string (literal epsilon)
      return { type: "literal", char: "" };
    }
    return node;
  }

  function parseFactor(): ASTNode {
    let node = parseAtom();

    while (pos < pattern.length) {
      const ch = peek();
      if (ch === "*") {
        advance();
        node = { type: "star", child: node };
      } else if (ch === "+") {
        advance();
        node = { type: "plus", child: node };
      } else if (ch === "?") {
        advance();
        node = { type: "optional", child: node };
      } else {
        break;
      }
    }

    return node;
  }

  function parseAtom(): ASTNode {
    const ch = peek();

    if (ch === "(") {
      advance();
      const node = parseExpr();
      expect(")");
      return { type: "group", child: node };
    }

    if (ch === "[") {
      return parseCharClass();
    }

    if (ch === ".") {
      advance();
      return { type: "dot" };
    }

    if (ch === "\\") {
      advance();
      const escaped = advance();
      if (escaped === undefined) {
        throw new ParseError("Unexpected end after backslash", pos);
      }
      return resolveEscape(escaped);
    }

    if (
      ch === undefined ||
      ch === ")" ||
      ch === "|" ||
      ch === "*" ||
      ch === "+" ||
      ch === "?"
    ) {
      throw new ParseError(`Unexpected character '${ch}' at position ${pos}`, pos);
    }

    advance();
    return { type: "literal", char: ch };
  }

  function resolveEscape(ch: string): ASTNode {
    switch (ch) {
      case "d":
        return { type: "charClass", chars: expandRange("0", "9"), negated: false };
      case "D":
        return { type: "charClass", chars: expandRange("0", "9"), negated: true };
      case "w":
        return {
          type: "charClass",
          chars: [
            ...expandRange("a", "z"),
            ...expandRange("A", "Z"),
            ...expandRange("0", "9"),
            "_",
          ],
          negated: false,
        };
      case "W":
        return {
          type: "charClass",
          chars: [
            ...expandRange("a", "z"),
            ...expandRange("A", "Z"),
            ...expandRange("0", "9"),
            "_",
          ],
          negated: true,
        };
      case "s":
        return { type: "charClass", chars: [" ", "\t", "\n", "\r", "\f", "\v"], negated: false };
      case "S":
        return { type: "charClass", chars: [" ", "\t", "\n", "\r", "\f", "\v"], negated: true };
      default:
        return { type: "literal", char: ch };
    }
  }

  function parseCharClass(): ASTNode {
    advance(); // consume '['
    let negated = false;
    if (peek() === "^") {
      negated = true;
      advance();
    }

    const chars: string[] = [];
    while (peek() !== "]" && pos < pattern.length) {
      const c = advance();
      if (c === "\\") {
        const esc = advance();
        if (esc === undefined) throw new ParseError("Unexpected end in char class", pos);
        chars.push(esc);
      } else if (peek() === "-" && pattern[pos + 1] !== "]" && pattern[pos + 1] !== undefined) {
        advance(); // consume '-'
        const end = advance();
        if (end === undefined) throw new ParseError("Unexpected end in char class range", pos);
        chars.push(...expandRange(c, end));
      } else {
        chars.push(c);
      }
    }

    if (peek() !== "]") {
      throw new ParseError("Unterminated character class", pos);
    }
    advance(); // consume ']'

    return { type: "charClass", chars, negated };
  }

  const result = parseExpr();

  if (pos < pattern.length) {
    throw new ParseError(`Unexpected character '${pattern[pos]}' at position ${pos}`, pos);
  }

  return result;
}

function expandRange(start: string, end: string): string[] {
  const result: string[] = [];
  const startCode = start.charCodeAt(0);
  const endCode = end.charCodeAt(0);
  for (let i = startCode; i <= endCode; i++) {
    result.push(String.fromCharCode(i));
  }
  return result;
}

/* ================================================================
   THOMPSON'S CONSTRUCTION — AST to NFA
   Each sub-expression becomes an NFA fragment with one start
   and one accept state.
   ================================================================ */

let stateCounter = 0;

function newState(): number {
  return stateCounter++;
}

function resetStateCounter(): void {
  stateCounter = 0;
}

function thompsonsConstruction(ast: ASTNode): NFA {
  resetStateCounter();
  return buildNFA(ast);
}

function buildNFA(node: ASTNode): NFA {
  switch (node.type) {
    case "literal":
      return buildLiteralNFA(node.char);
    case "dot":
      return buildDotNFA();
    case "charClass":
      return buildCharClassNFA(node.chars, node.negated);
    case "concat":
      return buildConcatNFA(node.left, node.right);
    case "union":
      return buildUnionNFA(node.left, node.right);
    case "star":
      return buildStarNFA(node.child);
    case "plus":
      return buildPlusNFA(node.child);
    case "optional":
      return buildOptionalNFA(node.child);
    case "group":
      return buildNFA(node.child);
  }
}

function buildLiteralNFA(char: string): NFA {
  const s = newState();
  const a = newState();
  if (char === "") {
    return {
      startState: s,
      acceptState: a,
      states: [s, a],
      transitions: [{ from: s, to: a, label: EPSILON }],
    };
  }
  return {
    startState: s,
    acceptState: a,
    states: [s, a],
    transitions: [{ from: s, to: a, label: char }],
  };
}

function buildDotNFA(): NFA {
  const s = newState();
  const a = newState();
  return {
    startState: s,
    acceptState: a,
    states: [s, a],
    transitions: [{ from: s, to: a, label: "." }],
  };
}

function buildCharClassNFA(chars: string[], negated: boolean): NFA {
  const s = newState();
  const a = newState();
  // For visualization, represent as a compact label
  const label = negated
    ? `[^${compactCharLabel(chars)}]`
    : `[${compactCharLabel(chars)}]`;
  return {
    startState: s,
    acceptState: a,
    states: [s, a],
    transitions: [{ from: s, to: a, label }],
  };
}

function compactCharLabel(chars: string[]): string {
  if (chars.length <= 4) return chars.join("");
  // Detect ranges
  const sorted = [...new Set(chars)].sort();
  if (sorted.length > 1) {
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    // Check if it's a continuous range
    const expectedLen = last.charCodeAt(0) - first.charCodeAt(0) + 1;
    if (expectedLen === sorted.length) {
      return `${first}-${last}`;
    }
  }
  return sorted.slice(0, 3).join("") + "...";
}

function buildConcatNFA(left: ASTNode, right: ASTNode): NFA {
  const nfa1 = buildNFA(left);
  const nfa2 = buildNFA(right);
  // Connect nfa1's accept to nfa2's start via epsilon
  const transitions = [
    ...nfa1.transitions,
    ...nfa2.transitions,
    { from: nfa1.acceptState, to: nfa2.startState, label: EPSILON },
  ];
  return {
    startState: nfa1.startState,
    acceptState: nfa2.acceptState,
    states: [...nfa1.states, ...nfa2.states],
    transitions,
  };
}

function buildUnionNFA(left: ASTNode, right: ASTNode): NFA {
  const nfa1 = buildNFA(left);
  const nfa2 = buildNFA(right);
  const s = newState();
  const a = newState();
  const transitions = [
    ...nfa1.transitions,
    ...nfa2.transitions,
    { from: s, to: nfa1.startState, label: EPSILON },
    { from: s, to: nfa2.startState, label: EPSILON },
    { from: nfa1.acceptState, to: a, label: EPSILON },
    { from: nfa2.acceptState, to: a, label: EPSILON },
  ];
  return {
    startState: s,
    acceptState: a,
    states: [s, ...nfa1.states, ...nfa2.states, a],
    transitions,
  };
}

function buildStarNFA(child: ASTNode): NFA {
  const inner = buildNFA(child);
  const s = newState();
  const a = newState();
  const transitions = [
    ...inner.transitions,
    { from: s, to: inner.startState, label: EPSILON },
    { from: s, to: a, label: EPSILON },
    { from: inner.acceptState, to: inner.startState, label: EPSILON },
    { from: inner.acceptState, to: a, label: EPSILON },
  ];
  return {
    startState: s,
    acceptState: a,
    states: [s, ...inner.states, a],
    transitions,
  };
}

function buildPlusNFA(child: ASTNode): NFA {
  const inner = buildNFA(child);
  const s = newState();
  const a = newState();
  const transitions = [
    ...inner.transitions,
    { from: s, to: inner.startState, label: EPSILON },
    { from: inner.acceptState, to: inner.startState, label: EPSILON },
    { from: inner.acceptState, to: a, label: EPSILON },
  ];
  return {
    startState: s,
    acceptState: a,
    states: [s, ...inner.states, a],
    transitions,
  };
}

function buildOptionalNFA(child: ASTNode): NFA {
  const inner = buildNFA(child);
  const s = newState();
  const a = newState();
  const transitions = [
    ...inner.transitions,
    { from: s, to: inner.startState, label: EPSILON },
    { from: s, to: a, label: EPSILON },
    { from: inner.acceptState, to: a, label: EPSILON },
  ];
  return {
    startState: s,
    acceptState: a,
    states: [s, ...inner.states, a],
    transitions,
  };
}

/* ================================================================
   SUBSET CONSTRUCTION — NFA to DFA
   ================================================================ */

function epsilonClosure(nfa: NFA, states: Set<number>): Set<number> {
  const closure = new Set(states);
  const stack = [...states];

  while (stack.length > 0) {
    const state = stack.pop()!;
    for (const t of nfa.transitions) {
      if (t.from === state && t.label === EPSILON && !closure.has(t.to)) {
        closure.add(t.to);
        stack.push(t.to);
      }
    }
  }

  return closure;
}

function moveNFA(nfa: NFA, states: Set<number>, symbol: string): Set<number> {
  const result = new Set<number>();
  for (const state of states) {
    for (const t of nfa.transitions) {
      if (t.from === state && transitionMatches(t.label, symbol)) {
        result.add(t.to);
      }
    }
  }
  return result;
}

function transitionMatches(label: string, symbol: string): boolean {
  if (label === EPSILON) return false;
  if (label === ".") return true;
  if (label === symbol) return true;

  // Character class labels like [a-z] or [^0-9]
  if (label.startsWith("[") && label.endsWith("]")) {
    const inner = label.slice(1, -1);
    const negated = inner.startsWith("^");
    const classContent = negated ? inner.slice(1) : inner;
    // Expand the class content to check membership
    const chars = expandClassLabel(classContent);
    const inClass = chars.includes(symbol);
    return negated ? !inClass : inClass;
  }

  return false;
}

function expandClassLabel(content: string): string[] {
  const chars: string[] = [];
  let i = 0;
  while (i < content.length) {
    if (content[i] === "." && content.slice(i, i + 3) === "...") {
      // Ellipsis from compaction — can't fully expand, skip
      i += 3;
    } else if (i + 2 < content.length && content[i + 1] === "-") {
      chars.push(...expandRange(content[i], content[i + 2]));
      i += 3;
    } else {
      chars.push(content[i]);
      i++;
    }
  }
  return chars;
}

function getAlphabet(nfa: NFA): string[] {
  const symbols = new Set<string>();
  for (const t of nfa.transitions) {
    if (t.label !== EPSILON) {
      symbols.add(t.label);
    }
  }
  return [...symbols].sort();
}

function subsetConstruction(nfa: NFA): DFA {
  const alphabet = getAlphabet(nfa);
  const startClosure = epsilonClosure(nfa, new Set([nfa.startState]));

  const dfaStates: DFAState[] = [];
  const dfaTransitions: DFATransition[] = [];
  const stateMap = new Map<string, number>(); // serialized NFA state set → DFA state ID
  let nextId = 0;

  function stateKey(states: Set<number>): string {
    return [...states].sort((a, b) => a - b).join(",");
  }

  function getOrCreateState(nfaStates: Set<number>): number {
    const key = stateKey(nfaStates);
    if (stateMap.has(key)) return stateMap.get(key)!;

    const id = nextId++;
    stateMap.set(key, id);
    const isAccept = nfaStates.has(nfa.acceptState);
    const sortedStates = [...nfaStates].sort((a, b) => a - b);
    const label =
      sortedStates.length <= 4
        ? `{${sortedStates.join(",")}}`
        : `{${sortedStates.slice(0, 3).join(",")}...}`;
    dfaStates.push({ id, nfaStates, isAccept, label });
    return id;
  }

  const startId = getOrCreateState(startClosure);
  const worklist = [startClosure];

  while (worklist.length > 0) {
    const current = worklist.pop()!;
    const currentId = stateMap.get(stateKey(current))!;

    for (const symbol of alphabet) {
      const moved = moveNFA(nfa, current, symbol);
      if (moved.size === 0) continue;
      const closure = epsilonClosure(nfa, moved);
      if (closure.size === 0) continue;

      const key = stateKey(closure);
      const isNew = !stateMap.has(key);
      const targetId = getOrCreateState(closure);
      dfaTransitions.push({ from: currentId, to: targetId, label: symbol });

      if (isNew) {
        worklist.push(closure);
      }
    }
  }

  return {
    startState: startId,
    states: dfaStates,
    transitions: dfaTransitions,
    alphabet,
  };
}

/* ================================================================
   FORCE-DIRECTED LAYOUT
   Simple spring-based simulation for positioning graph nodes.
   ================================================================ */

function forceDirectedLayout(
  nodeCount: number,
  edges: Array<{ from: number; to: number }>,
  width: number,
  height: number,
  iterations: number = 60,
): NodePosition[] {
  if (nodeCount === 0) return [];

  // Initialize positions in a circle
  const positions: NodePosition[] = [];
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.35;

  for (let i = 0; i < nodeCount; i++) {
    const angle = (2 * Math.PI * i) / nodeCount - Math.PI / 2;
    positions.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      vx: 0,
      vy: 0,
    });
  }

  if (nodeCount === 1) return positions;
  if (nodeCount === 2) {
    positions[0].x = cx - 60;
    positions[1].x = cx + 60;
    positions[0].y = cy;
    positions[1].y = cy;
    return positions;
  }

  const repulsionStrength = 3000;
  const attractionStrength = 0.02;
  const idealLength = Math.max(80, Math.min(150, (width * 0.8) / Math.sqrt(nodeCount)));
  const damping = 0.85;

  for (let iter = 0; iter < iterations; iter++) {
    const temperature = 1 - iter / iterations;

    // Repulsion between all pairs
    for (let i = 0; i < nodeCount; i++) {
      for (let j = i + 1; j < nodeCount; j++) {
        const dx = positions[j].x - positions[i].x;
        const dy = positions[j].y - positions[i].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = (repulsionStrength * temperature) / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        positions[i].vx -= fx;
        positions[i].vy -= fy;
        positions[j].vx += fx;
        positions[j].vy += fy;
      }
    }

    // Attraction along edges
    for (const edge of edges) {
      const i = edge.from;
      const j = edge.to;
      if (i >= nodeCount || j >= nodeCount) continue;
      const dx = positions[j].x - positions[i].x;
      const dy = positions[j].y - positions[i].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const force = attractionStrength * (dist - idealLength) * temperature;
      const fx = (dx / Math.max(dist, 1)) * force;
      const fy = (dy / Math.max(dist, 1)) * force;
      positions[i].vx += fx;
      positions[i].vy += fy;
      positions[j].vx -= fx;
      positions[j].vy -= fy;
    }

    // Left-to-right bias for directed graphs: encourage edges to flow left→right
    for (const edge of edges) {
      const i = edge.from;
      const j = edge.to;
      if (i >= nodeCount || j >= nodeCount) continue;
      if (i !== j) {
        // Nudge target to be to the right of source
        const horizontalBias = 0.5 * temperature;
        positions[j].vx += horizontalBias;
        positions[i].vx -= horizontalBias;
      }
    }

    // Apply velocities with damping and boundary constraints
    const margin = CANVAS_PADDING + STATE_RADIUS;
    for (let i = 0; i < nodeCount; i++) {
      positions[i].vx *= damping;
      positions[i].vy *= damping;

      // Clamp velocity
      const maxV = 20 * temperature + 2;
      const v = Math.sqrt(positions[i].vx ** 2 + positions[i].vy ** 2);
      if (v > maxV) {
        positions[i].vx = (positions[i].vx / v) * maxV;
        positions[i].vy = (positions[i].vy / v) * maxV;
      }

      positions[i].x += positions[i].vx;
      positions[i].y += positions[i].vy;

      // Keep within bounds
      positions[i].x = Math.max(margin, Math.min(width - margin, positions[i].x));
      positions[i].y = Math.max(margin, Math.min(height - margin, positions[i].y));
    }
  }

  return positions;
}

/* ================================================================
   STEP-THROUGH MATCHING
   ================================================================ */

interface MatchStep {
  charIndex: number;
  char: string;
  activeStates: Set<number>;
  description: string;
}

function buildNFAMatchSteps(nfa: NFA, input: string): MatchStep[] {
  const steps: MatchStep[] = [];
  const initialClosure = epsilonClosure(nfa, new Set([nfa.startState]));

  steps.push({
    charIndex: -1,
    char: "",
    activeStates: initialClosure,
    description: `Start: ${EPSILON}-closure of q${nfa.startState} = {${[...initialClosure].map((s) => `q${s}`).join(", ")}}`,
  });

  let currentStates = initialClosure;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const moved = moveNFA(nfa, currentStates, ch);
    const closure = epsilonClosure(nfa, moved);

    steps.push({
      charIndex: i,
      char: ch,
      activeStates: closure,
      description:
        closure.size === 0
          ? `'${ch}': No reachable states — stuck`
          : `'${ch}': move to {${[...moved].map((s) => `q${s}`).join(", ")}}, ${EPSILON}-close to {${[...closure].map((s) => `q${s}`).join(", ")}}`,
    });

    currentStates = closure;
  }

  return steps;
}

function buildDFAMatchSteps(dfa: DFA, input: string): MatchStep[] {
  const steps: MatchStep[] = [];
  let currentState = dfa.startState;

  const startDFAState = dfa.states.find((s) => s.id === currentState);
  steps.push({
    charIndex: -1,
    char: "",
    activeStates: new Set([currentState]),
    description: `Start: DFA state D${currentState} ${startDFAState?.label ?? ""}`,
  });

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const trans = dfa.transitions.find(
      (t) => t.from === currentState && transitionMatches(t.label, ch),
    );

    if (trans) {
      currentState = trans.to;
      const dfaState = dfa.states.find((s) => s.id === currentState);
      steps.push({
        charIndex: i,
        char: ch,
        activeStates: new Set([currentState]),
        description: `'${ch}': D${trans.from} → D${currentState} ${dfaState?.label ?? ""}`,
      });
    } else {
      steps.push({
        charIndex: i,
        char: ch,
        activeStates: new Set<number>(),
        description: `'${ch}': No transition from D${currentState} — stuck`,
      });
      // Dead state: continue with empty states
      currentState = -1;
    }
  }

  return steps;
}

/* ================================================================
   CANVAS RENDERING
   ================================================================ */

function drawAutomaton(
  ctx: CanvasRenderingContext2D,
  positions: NodePosition[],
  edges: Array<{ from: number; to: number; label: string }>,
  startState: number,
  acceptStates: Set<number>,
  activeStates: Set<number>,
  stateLabels: Map<number, string>,
  width: number,
  height: number,
  isDark: boolean,
): void {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  ctx.clearRect(0, 0, width * dpr, height * dpr);
  ctx.save();
  ctx.scale(dpr, dpr);

  const colorText = isDark ? "#e4e4e7" : "#27272a";
  const colorMuted = isDark ? "#71717a" : "#a1a1aa";
  const colorBorder = isDark ? "#27272a" : "#d4d4d8";
  const colorSurface = isDark ? "#111111" : "#ffffff";
  const colorPrimary = isDark ? "#4f8ff7" : "#2563eb";
  const colorAccent = isDark ? "#34d399" : "#059669";
  const colorActive = isDark ? "rgba(79, 143, 247, 0.25)" : "rgba(37, 99, 235, 0.2)";
  const colorActiveStroke = isDark ? "#4f8ff7" : "#2563eb";

  // Group edges by (from, to) to handle multiple labels
  const edgeMap = new Map<string, string[]>();
  for (const e of edges) {
    const key = `${e.from}-${e.to}`;
    if (!edgeMap.has(key)) edgeMap.set(key, []);
    edgeMap.get(key)!.push(e.label);
  }

  // Draw edges
  for (const [key, labels] of edgeMap) {
    const [fromStr, toStr] = key.split("-");
    const fromId = parseInt(fromStr, 10);
    const toId = parseInt(toStr, 10);

    if (fromId >= positions.length || toId >= positions.length) continue;

    const from = positions[fromId];
    const to = positions[toId];
    const combinedLabel = labels.join(", ");

    if (fromId === toId) {
      // Self-loop
      drawSelfLoop(ctx, from, combinedLabel, colorMuted, colorText, isDark);
      continue;
    }

    // Check for reverse edge to use curved arrows
    const reverseKey = `${toId}-${fromId}`;
    const hasReverse = edgeMap.has(reverseKey);

    drawArrow(ctx, from, to, combinedLabel, colorMuted, colorText, STATE_RADIUS, hasReverse, isDark);
  }

  // Draw start arrow
  if (startState < positions.length) {
    const startPos = positions[startState];
    const arrowStartX = startPos.x - STATE_RADIUS - 30;
    const arrowEndX = startPos.x - STATE_RADIUS - 2;

    ctx.strokeStyle = colorPrimary;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(arrowStartX, startPos.y);
    ctx.lineTo(arrowEndX, startPos.y);
    ctx.stroke();

    // Arrowhead
    ctx.fillStyle = colorPrimary;
    ctx.beginPath();
    ctx.moveTo(arrowEndX, startPos.y);
    ctx.lineTo(arrowEndX - 8, startPos.y - 5);
    ctx.lineTo(arrowEndX - 8, startPos.y + 5);
    ctx.closePath();
    ctx.fill();
  }

  // Draw nodes
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const isActive = activeStates.has(i);
    const isAccept = acceptStates.has(i);
    const label = stateLabels.get(i) ?? `q${i}`;

    // Active glow
    if (isActive) {
      ctx.fillStyle = colorActive;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, STATE_RADIUS + 6, 0, 2 * Math.PI);
      ctx.fill();
    }

    // Outer circle (accept state double circle)
    if (isAccept) {
      ctx.strokeStyle = isActive ? colorActiveStroke : colorAccent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, STATE_RADIUS + 4, 0, 2 * Math.PI);
      ctx.stroke();
    }

    // Main circle
    ctx.fillStyle = isActive ? (isDark ? "rgba(79, 143, 247, 0.15)" : "rgba(37, 99, 235, 0.1)") : colorSurface;
    ctx.strokeStyle = isActive ? colorActiveStroke : isAccept ? colorAccent : colorBorder;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, STATE_RADIUS, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();

    // Label
    ctx.fillStyle = isActive ? colorActiveStroke : colorText;
    ctx.font = "11px var(--font-mono, monospace)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, pos.x, pos.y);
  }

  ctx.restore();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  from: NodePosition,
  to: NodePosition,
  label: string,
  lineColor: string,
  textColor: string,
  radius: number,
  curved: boolean,
  isDark: boolean,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return;

  const nx = dx / dist;
  const ny = dy / dist;

  if (curved) {
    // Curved arrow offset perpendicular to edge direction
    const offset = 20;
    const perpX = -ny * offset;
    const perpY = nx * offset;

    const startX = from.x + nx * radius;
    const startY = from.y + ny * radius;
    const endX = to.x - nx * radius;
    const endY = to.y - ny * radius;

    const ctrlX = (from.x + to.x) / 2 + perpX;
    const ctrlY = (from.y + to.y) / 2 + perpY;

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(ctrlX, ctrlY, endX, endY);
    ctx.stroke();

    // Arrowhead at end of curve
    // Tangent at end of quadratic bezier: 2*(P2-P1) at t=1
    const tangentX = endX - ctrlX;
    const tangentY = endY - ctrlY;
    const tangentLen = Math.sqrt(tangentX * tangentX + tangentY * tangentY);
    const tnx = tangentX / Math.max(tangentLen, 1);
    const tny = tangentY / Math.max(tangentLen, 1);

    drawArrowhead(ctx, endX, endY, tnx, tny, lineColor);

    // Label at midpoint of curve
    const labelX = (startX + 2 * ctrlX + endX) / 4;
    const labelY = (startY + 2 * ctrlY + endY) / 4 - 6;
    drawEdgeLabel(ctx, labelX, labelY, label, textColor, isDark);
  } else {
    const startX = from.x + nx * radius;
    const startY = from.y + ny * radius;
    const endX = to.x - nx * radius;
    const endY = to.y - ny * radius;

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    drawArrowhead(ctx, endX, endY, nx, ny, lineColor);

    // Label at midpoint
    const labelX = (startX + endX) / 2 - ny * 12;
    const labelY = (startY + endY) / 2 + nx * 12 - 4;
    drawEdgeLabel(ctx, labelX, labelY, label, textColor, isDark);
  }
}

function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dirX: number,
  dirY: number,
  color: string,
): void {
  const headLen = 10;
  const headAngle = Math.PI / 6;
  const angle = Math.atan2(dirY, dirX);

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(
    x - headLen * Math.cos(angle - headAngle),
    y - headLen * Math.sin(angle - headAngle),
  );
  ctx.lineTo(
    x - headLen * Math.cos(angle + headAngle),
    y - headLen * Math.sin(angle + headAngle),
  );
  ctx.closePath();
  ctx.fill();
}

function drawSelfLoop(
  ctx: CanvasRenderingContext2D,
  pos: NodePosition,
  label: string,
  lineColor: string,
  textColor: string,
  isDark: boolean,
): void {
  const loopRadius = 16;
  const cx = pos.x;
  const cy = pos.y - STATE_RADIUS - loopRadius;

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, loopRadius, 0.3, Math.PI * 2 - 0.3);
  ctx.stroke();

  // Arrowhead at the reconnection point
  const arrowAngle = Math.PI * 2 - 0.3;
  const arrowX = cx + loopRadius * Math.cos(arrowAngle);
  const arrowY = cy + loopRadius * Math.sin(arrowAngle);
  drawArrowhead(ctx, arrowX, arrowY, 0.5, 0.8, lineColor);

  // Label above loop
  drawEdgeLabel(ctx, cx, cy - loopRadius - 6, label, textColor, isDark);
}

function drawEdgeLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  textColor: string,
  isDark: boolean,
): void {
  ctx.font = "11px var(--font-mono, monospace)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const metrics = ctx.measureText(label);
  const padding = 4;
  const bgColor = isDark ? "rgba(17, 17, 17, 0.9)" : "rgba(255, 255, 255, 0.9)";

  ctx.fillStyle = bgColor;
  ctx.fillRect(
    x - metrics.width / 2 - padding,
    y - 7 - padding / 2,
    metrics.width + padding * 2,
    14 + padding,
  );

  ctx.fillStyle = textColor;
  ctx.fillText(label, x, y);
}

/* ================================================================
   PARSE TREE RENDERING
   ================================================================ */

interface TreeNode {
  label: string;
  children: TreeNode[];
}

function astToTree(node: ASTNode): TreeNode {
  switch (node.type) {
    case "literal":
      return { label: node.char === "" ? EPSILON : `'${node.char}'`, children: [] };
    case "dot":
      return { label: ".", children: [] };
    case "charClass":
      return {
        label: node.negated ? `[^${compactCharLabel(node.chars)}]` : `[${compactCharLabel(node.chars)}]`,
        children: [],
      };
    case "concat":
      return {
        label: "concat",
        children: [astToTree(node.left), astToTree(node.right)],
      };
    case "union":
      return {
        label: "union (|)",
        children: [astToTree(node.left), astToTree(node.right)],
      };
    case "star":
      return { label: "star (*)", children: [astToTree(node.child)] };
    case "plus":
      return { label: "plus (+)", children: [astToTree(node.child)] };
    case "optional":
      return { label: "optional (?)", children: [astToTree(node.child)] };
    case "group":
      return { label: "group ()", children: [astToTree(node.child)] };
  }
}

/* ================================================================
   COMPONENT
   ================================================================ */

export default function RegexAutomaton() {
  const [pattern, setPattern] = useState(PRESETS[0].pattern);
  const [testString, setTestString] = useState(PRESETS[0].testString);
  const [viewMode, setViewMode] = useState<ViewMode>("nfa");
  const [stepIndex, setStepIndex] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [showParseTree, setShowParseTree] = useState(false);
  const [showTransTable, setShowTransTable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse and build automata
  const compiled = useMemo(() => {
    try {
      const ast = parseRegex(pattern);
      const nfa = thompsonsConstruction(ast);
      const dfa = subsetConstruction(nfa);
      return { ast, nfa, dfa, error: null };
    } catch (err) {
      const msg = err instanceof ParseError ? err.message : String(err);
      return { ast: null, nfa: null, dfa: null, error: msg };
    }
  }, [pattern]);

  useEffect(() => {
    setError(compiled.error);
  }, [compiled.error]);

  // Build match steps
  const matchSteps = useMemo(() => {
    if (!compiled.nfa || !compiled.dfa) return [];
    if (!testString) return [];
    if (viewMode === "nfa") {
      return buildNFAMatchSteps(compiled.nfa, testString);
    }
    return buildDFAMatchSteps(compiled.dfa, testString);
  }, [compiled.nfa, compiled.dfa, testString, viewMode]);

  // Reset step when pattern/test/view changes
  useEffect(() => {
    setStepIndex(0);
    setIsRunning(false);
  }, [pattern, testString, viewMode]);

  // Compute layout
  const layout = useMemo(() => {
    if (viewMode === "nfa" && compiled.nfa) {
      const nfa = compiled.nfa;
      const edges = nfa.transitions.map((t) => ({ from: t.from, to: t.to }));
      return forceDirectedLayout(nfa.states.length, edges, 600, 350);
    }
    if (viewMode === "dfa" && compiled.dfa) {
      const dfa = compiled.dfa;
      const edges = dfa.transitions.map((t) => ({ from: t.from, to: t.to }));
      return forceDirectedLayout(dfa.states.length, edges, 600, 350);
    }
    return [];
  }, [compiled.nfa, compiled.dfa, viewMode]);

  // Active states for current step
  const activeStates = useMemo(() => {
    if (matchSteps.length === 0 || stepIndex >= matchSteps.length) {
      return new Set<number>();
    }
    return matchSteps[stepIndex].activeStates;
  }, [matchSteps, stepIndex]);

  // Determine match result
  const matchResult = useMemo(() => {
    if (matchSteps.length === 0) return null;
    const lastStep = matchSteps[matchSteps.length - 1];
    if (viewMode === "nfa" && compiled.nfa) {
      return lastStep.activeStates.has(compiled.nfa.acceptState);
    }
    if (viewMode === "dfa" && compiled.dfa) {
      for (const stateId of lastStep.activeStates) {
        const dfaState = compiled.dfa.states.find((s) => s.id === stateId);
        if (dfaState?.isAccept) return true;
      }
      return false;
    }
    return null;
  }, [matchSteps, compiled.nfa, compiled.dfa, viewMode]);

  // Draw canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dark = typeof document !== "undefined"
      ? !document.documentElement.classList.contains("light")
      : true;

    const width = 600;
    const height = 350;

    if (viewMode === "nfa" && compiled.nfa) {
      const nfa = compiled.nfa;
      const acceptStates = new Set([nfa.acceptState]);
      const stateLabels = new Map<number, string>();
      nfa.states.forEach((s) => stateLabels.set(s, `q${s}`));

      drawAutomaton(
        ctx,
        layout,
        nfa.transitions.map((t) => ({ from: t.from, to: t.to, label: t.label })),
        nfa.startState,
        acceptStates,
        activeStates,
        stateLabels,
        width,
        height,
        dark,
      );
    } else if (viewMode === "dfa" && compiled.dfa) {
      const dfa = compiled.dfa;
      const acceptStates = new Set(dfa.states.filter((s) => s.isAccept).map((s) => s.id));
      const stateLabels = new Map<number, string>();
      dfa.states.forEach((s) => stateLabels.set(s.id, `D${s.id}`));

      drawAutomaton(
        ctx,
        layout,
        dfa.transitions.map((t) => ({ from: t.from, to: t.to, label: t.label })),
        dfa.startState,
        acceptStates,
        activeStates,
        stateLabels,
        width,
        height,
        dark,
      );
    }
  }, [compiled.nfa, compiled.dfa, viewMode, layout, activeStates]);

  // Set up canvas and redraw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const width = 600;
    const height = 350;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    draw();
  }, [draw]);

  // Auto-run animation
  useEffect(() => {
    if (!isRunning) return;
    if (stepIndex >= matchSteps.length - 1) {
      setIsRunning(false);
      return;
    }

    const timer = setTimeout(() => {
      setStepIndex((prev) => prev + 1);
    }, 600);

    return () => clearTimeout(timer);
  }, [isRunning, stepIndex, matchSteps.length]);

  const handleStep = useCallback(() => {
    setStepIndex((prev) => Math.min(prev + 1, matchSteps.length - 1));
  }, [matchSteps.length]);

  const handleStepBack = useCallback(() => {
    setStepIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  const handleRun = useCallback(() => {
    if (stepIndex >= matchSteps.length - 1) {
      setStepIndex(0);
    }
    setIsRunning(true);
  }, [stepIndex, matchSteps.length]);

  const handleReset = useCallback(() => {
    setStepIndex(0);
    setIsRunning(false);
  }, []);

  const loadPreset = useCallback((e: Event) => {
    const index = parseInt((e.target as HTMLSelectElement).value, 10);
    if (isNaN(index) || index < 0) return;
    const preset = PRESETS[index];
    setPattern(preset.pattern);
    setTestString(preset.testString);
  }, []);

  // Build parse tree data
  const parseTree = useMemo(() => {
    if (!compiled.ast) return null;
    return astToTree(compiled.ast);
  }, [compiled.ast]);

  // Transition table data
  const transitionTable = useMemo(() => {
    if (viewMode === "nfa" && compiled.nfa) {
      return {
        headers: ["State", ...getAlphabet(compiled.nfa), EPSILON],
        rows: compiled.nfa.states.map((s) => {
          const row: string[] = [`q${s}`];
          const alpha = getAlphabet(compiled.nfa!);
          for (const sym of alpha) {
            const targets = compiled.nfa!.transitions
              .filter((t) => t.from === s && t.label === sym)
              .map((t) => `q${t.to}`);
            row.push(targets.length > 0 ? targets.join(", ") : "-");
          }
          // Epsilon transitions
          const epsTargets = compiled.nfa!.transitions
            .filter((t) => t.from === s && t.label === EPSILON)
            .map((t) => `q${t.to}`);
          row.push(epsTargets.length > 0 ? epsTargets.join(", ") : "-");
          return row;
        }),
      };
    }
    if (viewMode === "dfa" && compiled.dfa) {
      return {
        headers: ["State", ...compiled.dfa.alphabet],
        rows: compiled.dfa.states.map((s) => {
          const row: string[] = [`D${s.id}${s.isAccept ? "*" : ""}`];
          for (const sym of compiled.dfa!.alphabet) {
            const trans = compiled.dfa!.transitions.find(
              (t) => t.from === s.id && t.label === sym,
            );
            row.push(trans ? `D${trans.to}` : "-");
          }
          return row;
        }),
      };
    }
    return null;
  }, [compiled.nfa, compiled.dfa, viewMode]);

  // Current step info
  const currentStep = matchSteps[stepIndex] ?? null;
  const isAtEnd = stepIndex >= matchSteps.length - 1;

  return (
    <div
      class="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
      style={{ boxShadow: "0 0 0 1px var(--color-border)" }}
    >
      {/* Toolbar */}
      <div class="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-[var(--color-text-muted)]">
            Regex to Automaton
          </span>
          <span
            class="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
            style={{
              borderColor: "rgba(79, 143, 247, 0.3)",
              color: "var(--color-primary)",
            }}
          >
            alpha
          </span>
        </div>
        {matchResult !== null && isAtEnd && !isRunning && (
          <span
            class="rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
            style={{
              backgroundColor: matchResult
                ? "rgba(52, 211, 153, 0.15)"
                : "rgba(239, 68, 68, 0.15)",
              color: matchResult ? "var(--color-accent)" : "rgba(239, 68, 68, 0.9)",
            }}
          >
            {matchResult ? "ACCEPTED" : "REJECTED"}
          </span>
        )}
      </div>

      {/* Input section */}
      <div class="border-b border-[var(--color-border)] px-4 py-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
          {/* Regex input */}
          <div class="flex-1">
            <label class="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              Regex Pattern
            </label>
            <input
              type="text"
              value={pattern}
              onInput={(e) => setPattern((e.target as HTMLInputElement).value)}
              class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)]"
              style={{ fontFamily: "var(--font-mono)" }}
              placeholder="Enter regex pattern..."
              spellcheck={false}
              autocorrect="off"
              autocapitalize="off"
            />
            {error && (
              <p class="mt-1.5 text-xs" style={{ color: "rgba(239, 68, 68, 0.9)" }}>
                {error}
              </p>
            )}
          </div>

          {/* Test string input */}
          <div class="flex-1">
            <label class="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              Test String
            </label>
            <input
              type="text"
              value={testString}
              onInput={(e) => setTestString((e.target as HTMLInputElement).value)}
              class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)]"
              style={{ fontFamily: "var(--font-mono)" }}
              placeholder="Enter test string..."
              spellcheck={false}
              autocorrect="off"
              autocapitalize="off"
            />
          </div>

          {/* Preset selector */}
          <div class="shrink-0">
            <select
              onChange={loadPreset}
              class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-2 text-xs text-[var(--color-text)] outline-none transition-colors hover:border-[var(--color-primary)]"
            >
              <option value="-1">Presets...</option>
              {PRESETS.map((p, i) => (
                <option key={i} value={i}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main content: Canvas + Match Info */}
      <div class="grid md:grid-cols-[1fr,280px]">
        {/* Canvas panel */}
        <div class="relative border-b border-[var(--color-border)] md:border-r md:border-b-0">
          {/* View tabs */}
          <div class="flex items-center gap-1 border-b border-[var(--color-border)] px-3 py-2">
            <button
              onClick={() => setViewMode("nfa")}
              class="rounded-md px-3 py-1 text-xs font-medium transition-all"
              style={{
                backgroundColor:
                  viewMode === "nfa" ? "rgba(79, 143, 247, 0.15)" : "transparent",
                color:
                  viewMode === "nfa" ? "var(--color-primary)" : "var(--color-text-muted)",
              }}
            >
              NFA
            </button>
            <button
              onClick={() => setViewMode("dfa")}
              class="rounded-md px-3 py-1 text-xs font-medium transition-all"
              style={{
                backgroundColor:
                  viewMode === "dfa" ? "rgba(79, 143, 247, 0.15)" : "transparent",
                color:
                  viewMode === "dfa" ? "var(--color-primary)" : "var(--color-text-muted)",
              }}
            >
              DFA
            </button>
            <span class="ml-auto text-[10px] text-[var(--color-text-muted)]">
              {viewMode === "nfa" && compiled.nfa
                ? `${compiled.nfa.states.length} states, ${compiled.nfa.transitions.length} transitions`
                : viewMode === "dfa" && compiled.dfa
                  ? `${compiled.dfa.states.length} states, ${compiled.dfa.transitions.length} transitions`
                  : ""}
            </span>
          </div>

          {/* Canvas */}
          <div ref={containerRef} class="flex items-center justify-center overflow-auto p-2" style={{ minHeight: "350px" }}>
            {compiled.nfa || compiled.dfa ? (
              <canvas
                ref={canvasRef}
                style={{ width: "600px", height: "350px", maxWidth: "100%" }}
              />
            ) : (
              <p class="text-sm italic text-[var(--color-text-muted)]">
                Enter a valid regex to see the automaton
              </p>
            )}
          </div>

          {/* Step controls */}
          <div class="flex items-center gap-2 border-t border-[var(--color-border)] px-3 py-2">
            <button
              onClick={handleReset}
              class="rounded-md border border-[var(--color-border)] px-2 py-1 text-[10px] font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
              title="Reset"
            >
              Reset
            </button>
            <button
              onClick={handleStepBack}
              disabled={stepIndex <= 0}
              class="rounded-md border border-[var(--color-border)] px-2 py-1 text-[10px] font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)] disabled:opacity-30"
              title="Step back"
            >
              &#9664; Back
            </button>
            <button
              onClick={handleStep}
              disabled={isAtEnd || matchSteps.length === 0}
              class="rounded-md border border-[var(--color-border)] px-2 py-1 text-[10px] font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)] disabled:opacity-30"
              title="Step forward"
            >
              Step &#9654;
            </button>
            <button
              onClick={handleRun}
              disabled={matchSteps.length === 0}
              class="rounded-md border px-2 py-1 text-[10px] font-medium transition-colors"
              style={{
                borderColor: isRunning ? "var(--color-accent)" : "var(--color-border)",
                color: isRunning ? "var(--color-accent)" : "var(--color-text-muted)",
                backgroundColor: isRunning ? "rgba(52, 211, 153, 0.1)" : "transparent",
              }}
            >
              {isRunning ? "Running..." : "Run All"}
            </button>
            {matchSteps.length > 0 && (
              <span class="ml-auto text-[10px] text-[var(--color-text-muted)]" style={{ fontFamily: "var(--font-mono)" }}>
                Step {stepIndex}/{matchSteps.length - 1}
              </span>
            )}
          </div>
        </div>

        {/* Side panel: Match progress */}
        <div class="flex flex-col">
          {/* Step info */}
          <div class="border-b border-[var(--color-border)] px-3 py-3">
            <div class="mb-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              Match Progress
            </div>

            {/* Test string character highlight */}
            {testString && (
              <div class="mb-3 flex flex-wrap gap-0.5" style={{ fontFamily: "var(--font-mono)" }}>
                {testString.split("").map((ch, i) => {
                  const isCurrent = currentStep?.charIndex === i;
                  const isPast = currentStep ? currentStep.charIndex > i : false;
                  return (
                    <span
                      key={i}
                      class="inline-flex h-6 w-5 items-center justify-center rounded text-xs"
                      style={{
                        backgroundColor: isCurrent
                          ? "rgba(79, 143, 247, 0.3)"
                          : isPast
                            ? "rgba(52, 211, 153, 0.1)"
                            : "transparent",
                        color: isCurrent
                          ? "var(--color-primary)"
                          : isPast
                            ? "var(--color-accent)"
                            : "var(--color-text-muted)",
                        border: isCurrent ? "1px solid var(--color-primary)" : "1px solid transparent",
                        fontWeight: isCurrent ? "bold" : "normal",
                      }}
                    >
                      {ch}
                    </span>
                  );
                })}
              </div>
            )}

            {/* Current step description */}
            {currentStep && (
              <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
                <div class="text-[11px] text-[var(--color-text)]" style={{ fontFamily: "var(--font-mono)" }}>
                  {currentStep.description}
                </div>
                {currentStep.activeStates.size > 0 && (
                  <div class="mt-1.5 text-[10px] text-[var(--color-text-muted)]">
                    Active: {"{"}
                    {[...currentStep.activeStates]
                      .map((s) => (viewMode === "nfa" ? `q${s}` : `D${s}`))
                      .join(", ")}
                    {"}"}
                  </div>
                )}
              </div>
            )}

            {!testString && (
              <p class="text-xs italic text-[var(--color-text-muted)]">
                Enter a test string to step through matching
              </p>
            )}
          </div>

          {/* Step log */}
          <div class="flex-1 overflow-auto px-3 py-2" style={{ maxHeight: "200px" }}>
            <div class="mb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              Step Log
            </div>
            <div class="space-y-1">
              {matchSteps.slice(0, stepIndex + 1).map((step, i) => (
                <div
                  key={i}
                  class="cursor-pointer rounded px-2 py-1 text-[10px] transition-colors hover:bg-[var(--color-bg)]"
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: i === stepIndex ? "var(--color-primary)" : "var(--color-text-muted)",
                    backgroundColor: i === stepIndex ? "rgba(79, 143, 247, 0.08)" : "transparent",
                  }}
                  onClick={() => setStepIndex(i)}
                >
                  {step.description}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Collapsible panels */}
      <div class="border-t border-[var(--color-border)]">
        {/* Parse Tree toggle */}
        <button
          onClick={() => setShowParseTree(!showParseTree)}
          class="flex w-full items-center justify-between px-4 py-3 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-heading)]"
        >
          <span class="flex items-center gap-2">
            <TreeIcon />
            Parse Tree
          </span>
          <span
            class="transition-transform"
            style={{ transform: showParseTree ? "rotate(90deg)" : "rotate(0deg)" }}
          >
            &#9656;
          </span>
        </button>
        {showParseTree && parseTree && (
          <div class="border-t border-[var(--color-border)] px-4 py-4 overflow-auto" style={{ maxHeight: "300px" }}>
            <ParseTreeView node={parseTree} depth={0} />
          </div>
        )}

        {/* Transition Table toggle */}
        <button
          onClick={() => setShowTransTable(!showTransTable)}
          class="flex w-full items-center justify-between border-t border-[var(--color-border)] px-4 py-3 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-heading)]"
        >
          <span class="flex items-center gap-2">
            <TableIcon />
            Transition Table
          </span>
          <span
            class="transition-transform"
            style={{ transform: showTransTable ? "rotate(90deg)" : "rotate(0deg)" }}
          >
            &#9656;
          </span>
        </button>
        {showTransTable && transitionTable && (
          <div class="border-t border-[var(--color-border)] px-4 py-4 overflow-auto">
            <table class="w-full text-[11px]" style={{ fontFamily: "var(--font-mono)" }}>
              <thead>
                <tr>
                  {transitionTable.headers.map((h, i) => (
                    <th
                      key={i}
                      class="border border-[var(--color-border)] px-2 py-1.5 text-left font-semibold text-[var(--color-heading)]"
                      style={{ backgroundColor: "rgba(79, 143, 247, 0.08)" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transitionTable.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        class="border border-[var(--color-border)] px-2 py-1"
                        style={{
                          color: ci === 0 ? "var(--color-primary)" : "var(--color-text)",
                        }}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   SUB-COMPONENTS
   ================================================================ */

function ParseTreeView({ node, depth }: { node: TreeNode; depth: number }) {
  const indent = depth * 20;
  const hasChildren = node.children.length > 0;
  const [expanded, setExpanded] = useState(true);

  return (
    <div style={{ marginLeft: `${indent}px` }}>
      <div
        class="flex items-center gap-1 rounded px-1 py-0.5 text-xs cursor-pointer transition-colors hover:bg-[var(--color-bg)]"
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {hasChildren && (
          <span
            class="text-[10px] text-[var(--color-text-muted)] transition-transform"
            style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block" }}
          >
            &#9656;
          </span>
        )}
        {!hasChildren && <span class="w-2.5" />}
        <span
          class="rounded px-1.5 py-0.5"
          style={{
            fontFamily: "var(--font-mono)",
            backgroundColor: hasChildren
              ? "rgba(79, 143, 247, 0.1)"
              : "rgba(52, 211, 153, 0.1)",
            color: hasChildren ? "var(--color-primary)" : "var(--color-accent)",
          }}
        >
          {node.label}
        </span>
      </div>
      {expanded &&
        node.children.map((child, i) => (
          <ParseTreeView key={i} node={child} depth={depth + 1} />
        ))}
    </div>
  );
}

/* ================================================================
   ICONS (inline SVG, zero deps)
   ================================================================ */

function TreeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M12 3v6" />
      <path d="M6 13v4" />
      <path d="M18 13v4" />
      <circle cx="12" cy="3" r="2" />
      <circle cx="12" cy="11" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="19" r="2" />
      <path d="M12 13l-6 4" />
      <path d="M12 13l6 4" />
    </svg>
  );
}

function TableIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </svg>
  );
}
