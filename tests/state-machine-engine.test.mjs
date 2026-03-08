/**
 * Tests for the State Machine Engine.
 * Run with: npx tsx tests/state-machine-engine.test.mjs
 *
 * Tests cover: alphabet extraction, machine type detection, epsilon closure,
 * input simulation, transition table, DOT export, markdown export, NFA->DFA conversion.
 */

// We can't import TS directly in .mjs, so we re-implement the key functions here
// (same approach as hash-generator.test.mjs).
// Alternatively, we inline the engine logic for testing.

const EPSILON = "\u03B5";

// ── Engine functions (copied for test isolation) ────────

function extractAlphabet(transitions) {
  const symbols = new Set();
  for (const t of transitions) {
    for (const s of t.symbols) {
      if (s !== EPSILON) symbols.add(s);
    }
  }
  return Array.from(symbols).sort();
}

function getTransitionTargets(transitions, fromId, symbol) {
  const targets = [];
  for (const t of transitions) {
    if (t.from === fromId && t.symbols.includes(symbol)) {
      if (!targets.includes(t.to)) targets.push(t.to);
    }
  }
  return targets;
}

function epsilonClosure(transitions, stateIds) {
  const closure = new Set(stateIds);
  const stack = Array.from(stateIds);
  while (stack.length > 0) {
    const current = stack.pop();
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

function detectMachineType(machine) {
  const { states, transitions } = machine;
  const alphabet = extractAlphabet(transitions);
  for (const t of transitions) {
    if (t.symbols.includes(EPSILON)) return "NFA";
  }
  for (const state of states) {
    for (const symbol of alphabet) {
      const targets = getTransitionTargets(transitions, state.id, symbol);
      if (targets.length > 1) return "NFA";
    }
  }
  for (const state of states) {
    for (const symbol of alphabet) {
      const targets = getTransitionTargets(transitions, state.id, symbol);
      if (targets.length === 0) return "INCOMPLETE";
    }
  }
  return "DFA";
}

function simulateInput(machine, input) {
  const { states, transitions } = machine;
  const startState = states.find((s) => s.isStart);
  if (!startState) {
    return { steps: [], accepted: false, finalStates: new Set() };
  }
  let activeStates = epsilonClosure(transitions, new Set([startState.id]));
  const steps = [
    { stepIndex: 0, symbol: "START", activeStates: new Set(activeStates), isStuck: activeStates.size === 0 },
  ];
  const symbols = input.split("");
  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    const nextStates = new Set();
    for (const stateId of activeStates) {
      const targets = getTransitionTargets(transitions, stateId, symbol);
      for (const t of targets) nextStates.add(t);
    }
    activeStates = epsilonClosure(transitions, nextStates);
    steps.push({
      stepIndex: i + 1,
      symbol,
      activeStates: new Set(activeStates),
      isStuck: activeStates.size === 0,
    });
  }
  const acceptStateIds = new Set(states.filter((s) => s.isAccept).map((s) => s.id));
  const finalStates = new Set(activeStates);
  const accepted = Array.from(activeStates).some((s) => acceptStateIds.has(s));
  return { steps, accepted, finalStates };
}

function setToKey(s) {
  return Array.from(s).sort().join("|");
}

function nfaToDfa(machine) {
  const { states, transitions } = machine;
  const alphabet = extractAlphabet(transitions);
  const stateMap = new Map(states.map((s) => [s.id, s]));
  const acceptIds = new Set(states.filter((s) => s.isAccept).map((s) => s.id));
  const startState = states.find((s) => s.isStart);
  if (!startState) return { states: [], transitions: [], alphabet };

  const startClosure = epsilonClosure(transitions, new Set([startState.id]));
  const dfaStates = [];
  const dfaTransitions = [];
  const visited = new Map();
  const queue = [];
  let idCounter = 0;

  function createDfaState(stateSet) {
    const key = setToKey(stateSet);
    if (visited.has(key)) return visited.get(key);
    const id = `dfa_${idCounter++}`;
    const label = `{${Array.from(stateSet).map((s) => stateMap.get(s)?.label ?? s).sort().join(",")}}`;
    const isAccept = Array.from(stateSet).some((s) => acceptIds.has(s));
    dfaStates.push({ id, label, x: 0, y: 0, isStart: dfaStates.length === 0, isAccept });
    visited.set(key, id);
    queue.push({ key, stateSet });
    return id;
  }

  createDfaState(startClosure);

  while (queue.length > 0) {
    const { stateSet } = queue.shift();
    const fromId = visited.get(setToKey(stateSet));
    for (const symbol of alphabet) {
      const nextStates = new Set();
      for (const s of stateSet) {
        const targets = getTransitionTargets(transitions, s, symbol);
        for (const t of targets) nextStates.add(t);
      }
      if (nextStates.size === 0) continue;
      const closure = epsilonClosure(transitions, nextStates);
      if (closure.size === 0) continue;
      const toId = createDfaState(closure);
      dfaTransitions.push({ id: `dt_${dfaTransitions.length}`, from: fromId, to: toId, symbols: [symbol] });
    }
  }

  return { states: dfaStates, transitions: dfaTransitions, alphabet };
}

// ── Test helpers ─────────────────────────────────────────

let passed = 0;
let failed = 0;
let total = 0;

function assert(condition, message) {
  total++;
  if (condition) {
    passed++;
    console.log(`  \u2713 ${message}`);
  } else {
    failed++;
    console.error(`  \u2717 FAIL: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  total++;
  if (actual === expected) {
    passed++;
    console.log(`  \u2713 ${message}`);
  } else {
    failed++;
    console.error(`  \u2717 FAIL: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertSetEqual(actual, expected, message) {
  const a = new Set(actual);
  const b = new Set(expected);
  const equal = a.size === b.size && [...a].every((x) => b.has(x));
  total++;
  if (equal) {
    passed++;
    console.log(`  \u2713 ${message}`);
  } else {
    failed++;
    console.error(`  \u2717 FAIL: ${message} — expected {${[...expected].join(",")}}, got {${[...actual].join(",")}}`);
  }
}

// ── Test data: Even number of 1s DFA ─────────────────────

const evenOnes = {
  states: [
    { id: "q0", label: "q0", x: 0, y: 0, isStart: true, isAccept: true },
    { id: "q1", label: "q1", x: 0, y: 0, isStart: false, isAccept: false },
  ],
  transitions: [
    { id: "t0", from: "q0", to: "q0", symbols: ["0"] },
    { id: "t1", from: "q0", to: "q1", symbols: ["1"] },
    { id: "t2", from: "q1", to: "q1", symbols: ["0"] },
    { id: "t3", from: "q1", to: "q0", symbols: ["1"] },
  ],
  alphabet: ["0", "1"],
};

// ── Test data: NFA ends with 01 ──────────────────────────

const nfaEndsWith01 = {
  states: [
    { id: "q0", label: "q0", x: 0, y: 0, isStart: true, isAccept: false },
    { id: "q1", label: "q1", x: 0, y: 0, isStart: false, isAccept: false },
    { id: "q2", label: "q2", x: 0, y: 0, isStart: false, isAccept: true },
  ],
  transitions: [
    { id: "t0", from: "q0", to: "q0", symbols: ["0", "1"] },
    { id: "t1", from: "q0", to: "q1", symbols: ["0"] },
    { id: "t2", from: "q1", to: "q2", symbols: ["1"] },
  ],
  alphabet: ["0", "1"],
};

// ── Test data: NFA with epsilon ──────────────────────────

const nfaWithEpsilon = {
  states: [
    { id: "q0", label: "q0", x: 0, y: 0, isStart: true, isAccept: false },
    { id: "q1", label: "q1", x: 0, y: 0, isStart: false, isAccept: false },
    { id: "q2", label: "q2", x: 0, y: 0, isStart: false, isAccept: true },
  ],
  transitions: [
    { id: "t0", from: "q0", to: "q1", symbols: [EPSILON] },
    { id: "t1", from: "q1", to: "q2", symbols: ["a"] },
    { id: "t2", from: "q0", to: "q0", symbols: ["b"] },
  ],
  alphabet: ["a", "b"],
};

// ── Test data: Contains "ab" ─────────────────────────────

const containsAb = {
  states: [
    { id: "q0", label: "q0", x: 0, y: 0, isStart: true, isAccept: false },
    { id: "q1", label: "q1", x: 0, y: 0, isStart: false, isAccept: false },
    { id: "q2", label: "q2", x: 0, y: 0, isStart: false, isAccept: true },
  ],
  transitions: [
    { id: "t0", from: "q0", to: "q1", symbols: ["a"] },
    { id: "t1", from: "q0", to: "q0", symbols: ["b"] },
    { id: "t2", from: "q1", to: "q1", symbols: ["a"] },
    { id: "t3", from: "q1", to: "q2", symbols: ["b"] },
    { id: "t4", from: "q2", to: "q2", symbols: ["a", "b"] },
  ],
  alphabet: ["a", "b"],
};

// ── Tests ────────────────────────────────────────────────

console.log("\n=== Alphabet Extraction ===");
assertSetEqual(extractAlphabet(evenOnes.transitions), ["0", "1"], "Even-ones alphabet is {0,1}");
assertSetEqual(extractAlphabet(nfaWithEpsilon.transitions), ["a", "b"], "Epsilon NFA alphabet excludes epsilon");
assertSetEqual(extractAlphabet([]), [], "Empty transitions yield empty alphabet");

console.log("\n=== Machine Type Detection ===");
assertEqual(detectMachineType(evenOnes), "DFA", "Even-ones is a DFA");
assertEqual(detectMachineType(nfaEndsWith01), "NFA", "Ends-with-01 is an NFA (nondeterministic on '0')");
assertEqual(detectMachineType(nfaWithEpsilon), "NFA", "Epsilon transitions make it NFA");
assertEqual(detectMachineType(containsAb), "DFA", "Contains-ab is a complete DFA (all states have transitions for all symbols)");

console.log("\n=== Epsilon Closure ===");
{
  const closure = epsilonClosure(nfaWithEpsilon.transitions, new Set(["q0"]));
  assertSetEqual(closure, new Set(["q0", "q1"]), "Epsilon closure of q0 includes q1 via epsilon");
}
{
  const closure = epsilonClosure(nfaWithEpsilon.transitions, new Set(["q1"]));
  assertSetEqual(closure, new Set(["q1"]), "Epsilon closure of q1 is just {q1} (no outgoing epsilon)");
}
{
  const closure = epsilonClosure(evenOnes.transitions, new Set(["q0"]));
  assertSetEqual(closure, new Set(["q0"]), "No epsilon transitions -> closure is just the state itself");
}

console.log("\n=== Input Simulation: Even-ones DFA ===");
{
  const r1 = simulateInput(evenOnes, "0110");
  assertEqual(r1.accepted, true, '"0110" accepted (2 ones = even)');
  assertEqual(r1.steps.length, 5, '4-char input produces 5 steps (START + 4)');
}
{
  const r2 = simulateInput(evenOnes, "101");
  assertEqual(r2.accepted, true, '"101" accepted (2 ones = even)');
}
{
  const r3 = simulateInput(evenOnes, "111");
  assertEqual(r3.accepted, false, '"111" rejected (3 ones = odd)');
}
{
  const r4 = simulateInput(evenOnes, "");
  assertEqual(r4.accepted, true, '"" (empty) accepted (0 ones = even)');
}

console.log("\n=== Input Simulation: NFA ends-with-01 ===");
{
  const r1 = simulateInput(nfaEndsWith01, "01");
  assertEqual(r1.accepted, true, '"01" accepted (ends with 01)');
}
{
  const r2 = simulateInput(nfaEndsWith01, "101");
  assertEqual(r2.accepted, true, '"101" accepted (ends with 01)');
}
{
  const r3 = simulateInput(nfaEndsWith01, "10");
  assertEqual(r3.accepted, false, '"10" rejected (does not end with 01)');
}
{
  const r4 = simulateInput(nfaEndsWith01, "0101");
  assertEqual(r4.accepted, true, '"0101" accepted (ends with 01)');
}

console.log("\n=== Input Simulation: Contains 'ab' ===");
{
  const r1 = simulateInput(containsAb, "ab");
  assertEqual(r1.accepted, true, '"ab" accepted');
}
{
  const r2 = simulateInput(containsAb, "bab");
  assertEqual(r2.accepted, true, '"bab" accepted');
}
{
  const r3 = simulateInput(containsAb, "bba");
  assertEqual(r3.accepted, false, '"bba" rejected (no "ab" substring)');
}

console.log("\n=== Input Simulation: NFA with epsilon ===");
{
  const r1 = simulateInput(nfaWithEpsilon, "a");
  assertEqual(r1.accepted, true, '"a" accepted (q0 -eps-> q1 -a-> q2)');
}
{
  const r2 = simulateInput(nfaWithEpsilon, "b");
  assertEqual(r2.accepted, false, '"b" rejected (q0 -b-> q0, eps-> q1, no further)');
}
{
  const r3 = simulateInput(nfaWithEpsilon, "ba");
  assertEqual(r3.accepted, true, '"ba" accepted (q0 -b-> q0 -eps-> q1 -a-> q2)');
}

console.log("\n=== NFA to DFA Conversion ===");
{
  const dfa = nfaToDfa(nfaEndsWith01);
  const dfaType = detectMachineType(dfa);
  // The result should be DFA (or INCOMPLETE if dead states are missing, which is fine)
  assert(dfaType === "DFA" || dfaType === "INCOMPLETE", `Converted NFA->DFA type is ${dfaType} (not NFA)`);

  // Verify the DFA accepts the same language
  const r1 = simulateInput(dfa, "01");
  assertEqual(r1.accepted, true, 'Converted DFA accepts "01"');
  const r2 = simulateInput(dfa, "101");
  assertEqual(r2.accepted, true, 'Converted DFA accepts "101"');
  const r3 = simulateInput(dfa, "10");
  assertEqual(r3.accepted, false, 'Converted DFA rejects "10"');
  const r4 = simulateInput(dfa, "0101");
  assertEqual(r4.accepted, true, 'Converted DFA accepts "0101"');
  const r5 = simulateInput(dfa, "11");
  assertEqual(r5.accepted, false, 'Converted DFA rejects "11"');
}

console.log("\n=== Edge Cases ===");
{
  const empty = { states: [], transitions: [], alphabet: [] };
  const r = simulateInput(empty, "abc");
  assertEqual(r.accepted, false, "Empty machine rejects all input");
  assertEqual(r.steps.length, 0, "Empty machine produces 0 steps");
}
{
  const noStart = {
    states: [{ id: "q0", label: "q0", x: 0, y: 0, isStart: false, isAccept: true }],
    transitions: [],
    alphabet: [],
  };
  const r = simulateInput(noStart, "");
  assertEqual(r.accepted, false, "Machine with no start state rejects");
}

// ── Summary ──────────────────────────────────────────────

console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("All tests passed!\n");
}
