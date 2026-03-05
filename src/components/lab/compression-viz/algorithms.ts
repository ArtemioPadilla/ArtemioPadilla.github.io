/* ══════════════════════════════════════════════════════════
   Compression Algorithm Step Generators
   ══════════════════════════════════════════════════════════
   Pure functions that produce step-by-step traces of
   Huffman, LZW, and RLE compression algorithms.
   No browser APIs — safe for SSR.
   ══════════════════════════════════════════════════════════ */

/* ─── Common Types ─── */

export type AlgorithmId = "huffman" | "lzw" | "rle";

export interface CompressionResult {
  originalBits: number;
  compressedBits: number;
  ratio: number;
  bitsPerChar: number;
}

/* ─── Huffman Types ─── */

export interface HuffmanNode {
  id: number;
  char: string | null;
  freq: number;
  left: HuffmanNode | null;
  right: HuffmanNode | null;
  code?: string;
  x?: number;
  y?: number;
}

export type HuffmanStepKind =
  | "freq-table"
  | "init-queue"
  | "merge-nodes"
  | "tree-complete"
  | "assign-code"
  | "encode-char"
  | "done";

export interface HuffmanStep {
  kind: HuffmanStepKind;
  description: string;
  queue: HuffmanNode[];
  tree: HuffmanNode | null;
  codes: Map<string, string>;
  highlightNodes: number[];
  encodedSoFar: string;
  currentCharIndex: number;
  freqTable: Map<string, number>;
}

/* ─── LZW Types ─── */

export type LzwStepKind =
  | "init-dict"
  | "match-extend"
  | "output-code"
  | "add-entry"
  | "done";

export interface LzwDictEntry {
  index: number;
  sequence: string;
  addedAtStep: number;
}

export interface LzwStep {
  kind: LzwStepKind;
  description: string;
  dictionary: LzwDictEntry[];
  currentMatch: string;
  nextChar: string;
  outputCodes: number[];
  highlightEntry: number;
  inputIndex: number;
  highlightRange: [number, number];
}

/* ─── RLE Types ─── */

export type RleStepKind = "scan" | "output-run" | "done";

export interface RleRun {
  char: string;
  count: number;
}

export interface RleStep {
  kind: RleStepKind;
  description: string;
  runs: RleRun[];
  currentChar: string;
  currentCount: number;
  inputIndex: number;
  highlightRange: [number, number];
}

export type CompressionStep = HuffmanStep | LzwStep | RleStep;

/* ─── Huffman Algorithm ─── */

let nodeCounter = 0;

function createLeaf(char: string, freq: number): HuffmanNode {
  return { id: nodeCounter++, char, freq, left: null, right: null };
}

function createInternal(
  left: HuffmanNode,
  right: HuffmanNode,
): HuffmanNode {
  return {
    id: nodeCounter++,
    char: null,
    freq: left.freq + right.freq,
    left,
    right,
  };
}

function cloneNode(node: HuffmanNode): HuffmanNode {
  return {
    ...node,
    left: node.left ? cloneNode(node.left) : null,
    right: node.right ? cloneNode(node.right) : null,
  };
}

function assignCodes(
  node: HuffmanNode | null,
  prefix: string,
  codes: Map<string, string>,
): void {
  if (!node) return;
  if (node.char !== null) {
    node.code = prefix || "0";
    codes.set(node.char, node.code);
    return;
  }
  assignCodes(node.left, prefix + "0", codes);
  assignCodes(node.right, prefix + "1", codes);
}

function sortQueue(queue: HuffmanNode[]): HuffmanNode[] {
  return [...queue].sort((a, b) => a.freq - b.freq || a.id - b.id);
}

export function generateHuffmanSteps(input: string): HuffmanStep[] {
  if (input.length === 0) return [];
  nodeCounter = 0;

  const steps: HuffmanStep[] = [];
  const freqTable = new Map<string, number>();
  for (const ch of input) {
    freqTable.set(ch, (freqTable.get(ch) ?? 0) + 1);
  }

  // Step 1: frequency table
  const leaves = sortQueue(
    Array.from(freqTable.entries()).map(([ch, f]) => createLeaf(ch, f)),
  );
  steps.push({
    kind: "freq-table",
    description: `Built frequency table with ${freqTable.size} unique characters.`,
    queue: leaves.map(cloneNode),
    tree: null,
    codes: new Map(),
    highlightNodes: [],
    encodedSoFar: "",
    currentCharIndex: -1,
    freqTable: new Map(freqTable),
  });

  // Step 2: init queue
  let queue = sortQueue([...leaves]);
  steps.push({
    kind: "init-queue",
    description: `Priority queue initialized with ${queue.length} leaf nodes, sorted by frequency.`,
    queue: queue.map(cloneNode),
    tree: null,
    codes: new Map(),
    highlightNodes: queue.map((n) => n.id),
    encodedSoFar: "",
    currentCharIndex: -1,
    freqTable: new Map(freqTable),
  });

  // Step 3..N: merge nodes
  while (queue.length > 1) {
    const left = queue.shift()!;
    const right = queue.shift()!;
    const merged = createInternal(left, right);
    queue.push(merged);
    queue = sortQueue(queue);

    steps.push({
      kind: "merge-nodes",
      description: `Merged "${left.char ?? "internal"}" (${left.freq}) + "${right.char ?? "internal"}" (${right.freq}) = ${merged.freq}`,
      queue: queue.map(cloneNode),
      tree: cloneNode(merged),
      codes: new Map(),
      highlightNodes: [merged.id, left.id, right.id],
      encodedSoFar: "",
      currentCharIndex: -1,
      freqTable: new Map(freqTable),
    });
  }

  const root = queue[0];
  steps.push({
    kind: "tree-complete",
    description: "Huffman tree construction complete!",
    queue: [],
    tree: cloneNode(root),
    codes: new Map(),
    highlightNodes: [root.id],
    encodedSoFar: "",
    currentCharIndex: -1,
    freqTable: new Map(freqTable),
  });

  // Assign codes
  const codes = new Map<string, string>();
  assignCodes(root, "", codes);

  const sortedCodes = Array.from(codes.entries()).sort(
    (a, b) => a[1].length - b[1].length,
  );
  for (const [ch, code] of sortedCodes) {
    steps.push({
      kind: "assign-code",
      description: `Assigned code "${code}" to "${ch}" (freq: ${freqTable.get(ch)})`,
      queue: [],
      tree: cloneNode(root),
      codes: new Map(codes),
      highlightNodes: [],
      encodedSoFar: "",
      currentCharIndex: -1,
      freqTable: new Map(freqTable),
    });
  }

  // Encode input step by step
  let encoded = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const code = codes.get(ch) ?? "";
    encoded += code;
    steps.push({
      kind: "encode-char",
      description: `Encoded "${ch}" -> ${code}`,
      queue: [],
      tree: cloneNode(root),
      codes: new Map(codes),
      highlightNodes: [],
      encodedSoFar: encoded,
      currentCharIndex: i,
      freqTable: new Map(freqTable),
    });
  }

  // Done
  steps.push({
    kind: "done",
    description: `Compression complete! ${input.length * 8} bits -> ${encoded.length} bits (ratio: ${((encoded.length / (input.length * 8)) * 100).toFixed(1)}%)`,
    queue: [],
    tree: cloneNode(root),
    codes: new Map(codes),
    highlightNodes: [],
    encodedSoFar: encoded,
    currentCharIndex: input.length - 1,
    freqTable: new Map(freqTable),
  });

  return steps;
}

/* ─── LZW Algorithm ─── */

export function generateLzwSteps(input: string): LzwStep[] {
  if (input.length === 0) return [];

  const steps: LzwStep[] = [];

  // Initialize dictionary with single characters
  const dictMap = new Map<string, number>();
  const dictEntries: LzwDictEntry[] = [];
  const uniqueChars = Array.from(new Set(input)).sort();
  for (let i = 0; i < uniqueChars.length; i++) {
    dictMap.set(uniqueChars[i], i);
    dictEntries.push({ index: i, sequence: uniqueChars[i], addedAtStep: 0 });
  }
  let nextCode = uniqueChars.length;

  steps.push({
    kind: "init-dict",
    description: `Initialized dictionary with ${uniqueChars.length} single-character entries.`,
    dictionary: [...dictEntries],
    currentMatch: "",
    nextChar: input[0] ?? "",
    outputCodes: [],
    highlightEntry: -1,
    inputIndex: 0,
    highlightRange: [0, 0],
  });

  let current = "";
  const outputCodes: number[] = [];
  let stepNum = 1;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const extended = current + ch;

    if (dictMap.has(extended)) {
      // Extend current match
      current = extended;
      steps.push({
        kind: "match-extend",
        description: `"${extended}" found in dictionary (code ${dictMap.get(extended)}). Extending match.`,
        dictionary: [...dictEntries],
        currentMatch: current,
        nextChar: i + 1 < input.length ? input[i + 1] : "",
        outputCodes: [...outputCodes],
        highlightEntry: dictMap.get(extended)!,
        inputIndex: i,
        highlightRange: [i - current.length + 1, i],
      });
    } else {
      // Output code for current, add extended to dictionary
      const code = dictMap.get(current)!;
      outputCodes.push(code);

      steps.push({
        kind: "output-code",
        description: `"${extended}" not in dictionary. Output code ${code} for "${current}".`,
        dictionary: [...dictEntries],
        currentMatch: current,
        nextChar: ch,
        outputCodes: [...outputCodes],
        highlightEntry: code,
        inputIndex: i,
        highlightRange: [i - current.length, i - 1],
      });

      // Add new dictionary entry
      dictMap.set(extended, nextCode);
      dictEntries.push({
        index: nextCode,
        sequence: extended,
        addedAtStep: stepNum,
      });
      nextCode++;
      stepNum++;

      steps.push({
        kind: "add-entry",
        description: `Added "${extended}" to dictionary as code ${nextCode - 1}.`,
        dictionary: [...dictEntries],
        currentMatch: ch,
        nextChar: i + 1 < input.length ? input[i + 1] : "",
        outputCodes: [...outputCodes],
        highlightEntry: nextCode - 1,
        inputIndex: i,
        highlightRange: [i, i],
      });

      current = ch;
    }
  }

  // Output remaining
  if (current.length > 0) {
    const code = dictMap.get(current)!;
    outputCodes.push(code);
    steps.push({
      kind: "output-code",
      description: `End of input. Output code ${code} for remaining "${current}".`,
      dictionary: [...dictEntries],
      currentMatch: current,
      nextChar: "",
      outputCodes: [...outputCodes],
      highlightEntry: code,
      inputIndex: input.length - 1,
      highlightRange: [input.length - current.length, input.length - 1],
    });
  }

  // Compute stats
  const bitsPerCode = Math.ceil(Math.log2(nextCode || 1));
  const compressedBits = outputCodes.length * bitsPerCode;

  steps.push({
    kind: "done",
    description: `LZW complete! ${outputCodes.length} codes output using ${bitsPerCode} bits each = ${compressedBits} bits (original: ${input.length * 8} bits, ratio: ${((compressedBits / (input.length * 8)) * 100).toFixed(1)}%)`,
    dictionary: [...dictEntries],
    currentMatch: "",
    nextChar: "",
    outputCodes: [...outputCodes],
    highlightEntry: -1,
    inputIndex: input.length - 1,
    highlightRange: [0, input.length - 1],
  });

  return steps;
}

/* ─── RLE Algorithm ─── */

export function generateRleSteps(input: string): RleStep[] {
  if (input.length === 0) return [];

  const steps: RleStep[] = [];
  const runs: RleRun[] = [];
  let currentChar = input[0];
  let currentCount = 1;

  steps.push({
    kind: "scan",
    description: `Starting scan. First character: "${currentChar}".`,
    runs: [],
    currentChar,
    currentCount: 1,
    inputIndex: 0,
    highlightRange: [0, 0],
  });

  for (let i = 1; i < input.length; i++) {
    const ch = input[i];

    if (ch === currentChar) {
      currentCount++;
      steps.push({
        kind: "scan",
        description: `"${ch}" matches current run. Count: ${currentCount}.`,
        runs: [...runs],
        currentChar,
        currentCount,
        inputIndex: i,
        highlightRange: [i - currentCount + 1, i],
      });
    } else {
      // Output the run
      runs.push({ char: currentChar, count: currentCount });
      steps.push({
        kind: "output-run",
        description: `Run complete: ${currentCount}x"${currentChar}". Starting new run with "${ch}".`,
        runs: [...runs],
        currentChar,
        currentCount,
        inputIndex: i,
        highlightRange: [i - currentCount, i - 1],
      });

      currentChar = ch;
      currentCount = 1;
      steps.push({
        kind: "scan",
        description: `New character: "${ch}". Count: 1.`,
        runs: [...runs],
        currentChar: ch,
        currentCount: 1,
        inputIndex: i,
        highlightRange: [i, i],
      });
    }
  }

  // Final run
  runs.push({ char: currentChar, count: currentCount });
  steps.push({
    kind: "output-run",
    description: `Final run: ${currentCount}x"${currentChar}".`,
    runs: [...runs],
    currentChar,
    currentCount,
    inputIndex: input.length - 1,
    highlightRange: [input.length - currentCount, input.length - 1],
  });

  // Compute stats
  const rleEncoded = runs.map((r) => `${r.count}${r.char}`).join("");
  const compressedBits = rleEncoded.length * 8;
  const originalBits = input.length * 8;

  steps.push({
    kind: "done",
    description: `RLE complete! "${rleEncoded}" (${rleEncoded.length} chars, ${compressedBits} bits vs original ${originalBits} bits, ratio: ${((compressedBits / originalBits) * 100).toFixed(1)}%)`,
    runs: [...runs],
    currentChar: "",
    currentCount: 0,
    inputIndex: input.length - 1,
    highlightRange: [0, input.length - 1],
  });

  return steps;
}

/* ─── Statistics ─── */

export function computeHuffmanStats(
  input: string,
  step: HuffmanStep,
): CompressionResult {
  const originalBits = input.length * 8;
  const compressedBits = step.encodedSoFar.length || 0;
  return {
    originalBits,
    compressedBits,
    ratio: originalBits > 0 ? compressedBits / originalBits : 0,
    bitsPerChar:
      input.length > 0 ? compressedBits / input.length : 0,
  };
}

export function computeLzwStats(
  input: string,
  step: LzwStep,
): CompressionResult {
  const originalBits = input.length * 8;
  const maxCode = step.dictionary.length;
  const bitsPerCode = Math.ceil(Math.log2(maxCode || 1));
  const compressedBits = step.outputCodes.length * bitsPerCode;
  return {
    originalBits,
    compressedBits,
    ratio: originalBits > 0 ? compressedBits / originalBits : 0,
    bitsPerChar:
      input.length > 0 ? compressedBits / input.length : 0,
  };
}

export function computeRleStats(
  input: string,
  step: RleStep,
): CompressionResult {
  const originalBits = input.length * 8;
  const rleEncoded = step.runs.map((r) => `${r.count}${r.char}`).join("");
  const compressedBits = rleEncoded.length * 8;
  return {
    originalBits,
    compressedBits,
    ratio: originalBits > 0 ? compressedBits / originalBits : 0,
    bitsPerChar:
      input.length > 0 ? compressedBits / input.length : 0,
  };
}

/* ─── Preset texts ─── */

export interface TextPreset {
  id: string;
  name: string;
  text: string;
}

export const TEXT_PRESETS: TextPreset[] = [
  {
    id: "hello",
    name: "Hello World",
    text: "hello world",
  },
  {
    id: "repeated",
    name: "Repeated Pattern",
    text: "AAABBBCCCAAABBBCCC",
  },
  {
    id: "dna",
    name: "DNA Sequence",
    text: "ATCGATCGATCGATCGATCG",
  },
  {
    id: "lorem",
    name: "Lorem Ipsum",
    text: "Lorem ipsum dolor sit amet consectetur",
  },
  {
    id: "binary",
    name: "Binary-like",
    text: "0000000011111111000011110000",
  },
  {
    id: "skewed",
    name: "Skewed Frequency",
    text: "aaaaaaaabbbbccde",
  },
];
