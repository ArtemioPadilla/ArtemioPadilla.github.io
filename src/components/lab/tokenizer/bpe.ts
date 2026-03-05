/**
 * Simplified BPE (Byte Pair Encoding) tokenizer engine.
 *
 * Implements a lightweight GPT-2-style BPE for educational demonstration.
 * Includes ~200 common merge rules, pre-tokenization via regex, and
 * heuristic token-count estimators for popular LLMs.
 *
 * All processing is synchronous and runs entirely in the browser.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MergeStep {
  step: number;
  pair: [string, string];
  merged: string;
  tokens: string[];
}

export interface TokenizerResult {
  tokens: string[];
  tokenIds: number[];
  mergeSteps: MergeStep[];
}

export type EncodingMode = "bpe" | "character" | "utf8";

export interface ModelEstimate {
  model: string;
  tokens: number;
  charsPerToken: number;
  costPer1MInput: number;
  costPer1MOutput: number;
}

// ---------------------------------------------------------------------------
// GPT-2 style pre-tokenization regex
// ---------------------------------------------------------------------------

/**
 * Splits input text into coarse "words" the same way GPT-2 does before
 * applying BPE merges.  Captures contractions, letter sequences, digit
 * sequences, punctuation, and whitespace-prefixed runs.
 */
const PRE_TOKEN_REGEX =
  /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+/gu;

function preTokenize(text: string): string[] {
  return text.match(PRE_TOKEN_REGEX) ?? [];
}

// ---------------------------------------------------------------------------
// Common BPE merge rules (GPT-2 style, ~200 most frequent)
// ---------------------------------------------------------------------------

/**
 * Each entry is a tuple [left, right] representing a merge rule.
 * They are ordered by priority (most common first).
 * This is a curated subset -- enough to demonstrate BPE visually.
 */
const MERGE_RULES: [string, string][] = [
  // Very frequent English bigrams
  ["t", "h"], ["t", "he"], ["th", "e"], ["i", "n"], ["a", "n"],
  ["e", "r"], ["r", "e"], ["o", "n"], ["h", "e"], ["i", "s"],
  ["e", "s"], ["o", "r"], ["e", "n"], ["a", "l"], ["i", "t"],
  ["a", "t"], ["s", "t"], ["a", "r"], ["n", "d"], ["o", "u"],
  ["o", "f"], ["e", "d"], ["h", "a"], ["n", "t"], ["t", "o"],
  ["i", "ng"], ["n", "g"], ["i", "on"], ["o", "m"], ["a", "s"],
  // Longer merges
  ["th", "at"], ["th", "is"], ["wi", "th"], ["w", "i"],
  ["f", "or"], ["fo", "r"], ["h", "av"], ["ha", "ve"],
  ["n", "ot"], ["no", "t"], ["b", "ut"], ["bu", "t"],
  ["a", "re"], ["ar", "e"], ["fr", "om"], ["f", "r"],
  ["b", "y"], ["w", "as"], ["wa", "s"], ["c", "an"],
  ["a", "ll"], ["al", "l"], ["w", "e"], ["y", "ou"],
  ["yo", "u"], ["h", "er"], ["he", "r"], ["w", "h"],
  ["wh", "en"], ["wh", "at"], ["wh", "ich"],
  ["th", "ey"], ["th", "eir"], ["th", "ere"],
  ["s", "o"], ["m", "e"], ["h", "im"], ["m", "y"],
  ["u", "p"], ["d", "o"], ["i", "f"], ["n", "o"],
  ["ou", "t"], ["ab", "out"], ["a", "b"],
  ["j", "ust"], ["ju", "st"], ["j", "u"],
  // Common word pieces
  ["s", "h"], ["sh", "ould"], ["sh", "e"],
  ["c", "h"], ["ch", "ar"], ["ch", "ild"],
  ["l", "e"], ["le", "t"], ["l", "i"], ["li", "ke"],
  ["m", "a"], ["ma", "ke"], ["ma", "n"],
  ["s", "e"], ["se", "e"], ["s", "a"], ["sa", "y"],
  ["g", "o"], ["go", "od"], ["g", "e"], ["ge", "t"],
  ["c", "o"], ["co", "me"], ["co", "uld"],
  ["k", "n"], ["kn", "ow"],
  ["w", "or"], ["wor", "k"], ["wor", "ld"],
  ["l", "o"], ["lo", "ok"], ["lo", "ng"],
  ["p", "e"], ["pe", "ople"], ["pe", "r"],
  ["b", "e"], ["be", "en"], ["be", "fore"],
  ["o", "ver"], ["ov", "er"],
  ["d", "own"], ["do", "wn"],
  ["e", "v"], ["ev", "en"], ["ev", "er"],
  ["s", "ome"], ["so", "me"],
  ["a", "fter"], ["af", "ter"],
  ["t", "ime"], ["ti", "me"],
  ["w", "ant"], ["wa", "nt"],
  ["p", "l"], ["pl", "ace"],
  ["t", "r"], ["tr", "y"],
  ["n", "ew"], ["ne", "w"],
  ["g", "r"], ["gr", "eat"],
  ["p", "r"], ["pr", "o"],
  ["d", "i"], ["di", "d"],
  ["s", "ay"], ["sa", "id"],
  // Programming-related merges
  ["f", "un"], ["fun", "ction"], ["fun", "c"],
  ["r", "et"], ["ret", "urn"],
  ["v", "ar"], ["va", "r"],
  ["c", "on"], ["con", "st"],
  ["i", "mp"], ["imp", "ort"],
  ["e", "x"], ["ex", "port"],
  ["c", "l"], ["cl", "ass"],
  ["d", "ef"], ["de", "f"],
  ["p", "ri"], ["pri", "nt"],
  // Punctuation & whitespace
  [" ", " "], ["  ", " "], ["  ", "  "],
  ["=", "="], [">", "="], ["<", "="], ["!", "="],
  ["-", ">"], ["=", ">"],
  ["/", "/"], ["/", "*"], ["*", "/"],
  ["{", "}"], ["(", ")"], ["[", "]"],
  // Digits
  ["0", "0"], ["1", "0"], ["2", "0"],
  ["0", "1"], ["1", "1"],
  ["0", "."], ["1", "."],
];

// Build a lookup set for fast pair checking: "left|right" -> merge priority
const MERGE_PRIORITY = new Map<string, number>();
MERGE_RULES.forEach(([l, r], idx) => {
  MERGE_PRIORITY.set(`${l}|${r}`, idx);
});

// ---------------------------------------------------------------------------
// Vocabulary (token -> id)
// ---------------------------------------------------------------------------

/** Build a simple vocabulary from merge rules + individual characters */
function buildVocab(): Map<string, number> {
  const vocab = new Map<string, number>();
  let nextId = 0;

  // All printable ASCII as base tokens
  for (let i = 32; i <= 126; i++) {
    vocab.set(String.fromCharCode(i), nextId++);
  }
  // Common non-ASCII
  vocab.set("\t", nextId++);
  vocab.set("\n", nextId++);

  // Add merged tokens from rules
  for (const [l, r] of MERGE_RULES) {
    const merged = l + r;
    if (!vocab.has(merged)) {
      vocab.set(merged, nextId++);
    }
  }

  return vocab;
}

const VOCAB = buildVocab();

function getTokenId(token: string): number {
  return VOCAB.get(token) ?? -1;
}

// ---------------------------------------------------------------------------
// BPE merge algorithm
// ---------------------------------------------------------------------------

function findBestPair(symbols: string[]): [number, [string, string]] | null {
  let bestPriority = Infinity;
  let bestIndex = -1;
  let bestPair: [string, string] | null = null;

  for (let i = 0; i < symbols.length - 1; i++) {
    const key = `${symbols[i]}|${symbols[i + 1]}`;
    const priority = MERGE_PRIORITY.get(key);
    if (priority !== undefined && priority < bestPriority) {
      bestPriority = priority;
      bestIndex = i;
      bestPair = [symbols[i], symbols[i + 1]];
    }
  }

  if (bestPair === null) return null;
  return [bestIndex, bestPair];
}

function applyMerge(
  symbols: string[],
  pair: [string, string]
): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < symbols.length) {
    if (
      i < symbols.length - 1 &&
      symbols[i] === pair[0] &&
      symbols[i + 1] === pair[1]
    ) {
      result.push(pair[0] + pair[1]);
      i += 2;
    } else {
      result.push(symbols[i]);
      i++;
    }
  }
  return result;
}

function bpeMerge(word: string): { tokens: string[]; steps: MergeStep[] } {
  let symbols = [...word];
  const steps: MergeStep[] = [];

  let stepNum = 0;
  const MAX_ITERATIONS = 200;

  while (stepNum < MAX_ITERATIONS) {
    const best = findBestPair(symbols);
    if (!best) break;

    const [, pair] = best;
    symbols = applyMerge(symbols, pair);
    stepNum++;

    steps.push({
      step: stepNum,
      pair,
      merged: pair[0] + pair[1],
      tokens: [...symbols],
    });
  }

  return { tokens: symbols, steps };
}

// ---------------------------------------------------------------------------
// Character-level tokenizer
// ---------------------------------------------------------------------------

function tokenizeCharacter(text: string): TokenizerResult {
  const tokens = [...text];
  return {
    tokens,
    tokenIds: tokens.map((t) => t.charCodeAt(0)),
    mergeSteps: [],
  };
}

// ---------------------------------------------------------------------------
// UTF-8 byte-level tokenizer
// ---------------------------------------------------------------------------

function tokenizeUtf8(text: string): TokenizerResult {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const tokens = Array.from(bytes).map((b) => {
    if (b >= 32 && b <= 126) return String.fromCharCode(b);
    return `<0x${b.toString(16).toUpperCase().padStart(2, "0")}>`;
  });
  return {
    tokens,
    tokenIds: Array.from(bytes),
    mergeSteps: [],
  };
}

// ---------------------------------------------------------------------------
// Main BPE tokenizer
// ---------------------------------------------------------------------------

function tokenizeBpe(text: string): TokenizerResult {
  if (text.length === 0) {
    return { tokens: [], tokenIds: [], mergeSteps: [] };
  }

  const preTokens = preTokenize(text);
  const allTokens: string[] = [];
  const allSteps: MergeStep[] = [];
  let globalStepOffset = 0;

  for (const word of preTokens) {
    const { tokens, steps } = bpeMerge(word);
    allTokens.push(...tokens);

    for (const step of steps) {
      allSteps.push({
        ...step,
        step: step.step + globalStepOffset,
      });
    }
    globalStepOffset += steps.length;
  }

  return {
    tokens: allTokens,
    tokenIds: allTokens.map(getTokenId),
    mergeSteps: allSteps,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function tokenize(text: string, mode: EncodingMode = "bpe"): TokenizerResult {
  switch (mode) {
    case "character":
      return tokenizeCharacter(text);
    case "utf8":
      return tokenizeUtf8(text);
    case "bpe":
      return tokenizeBpe(text);
  }
}

// ---------------------------------------------------------------------------
// Heuristic model estimators
// ---------------------------------------------------------------------------

/**
 * Estimates token counts for popular LLMs using character-per-token ratios.
 * These are rough heuristics, not exact tokenizer outputs. The ratios are
 * tuned for typical English text.
 */
export function estimateModelTokenCounts(text: string): ModelEstimate[] {
  const len = text.length;
  if (len === 0) {
    return getModelDefinitions().map((m) => ({
      ...m,
      tokens: 0,
      charsPerToken: 0,
    }));
  }

  return getModelDefinitions().map((m) => {
    const tokens = Math.max(1, Math.ceil(len / m.charsPerToken));
    return { ...m, tokens };
  });
}

interface ModelDefinition {
  model: string;
  charsPerToken: number;
  costPer1MInput: number;
  costPer1MOutput: number;
}

function getModelDefinitions(): ModelDefinition[] {
  return [
    {
      model: "GPT-4o",
      charsPerToken: 4.0,
      costPer1MInput: 2.50,
      costPer1MOutput: 10.0,
    },
    {
      model: "GPT-4",
      charsPerToken: 3.7,
      costPer1MInput: 30.0,
      costPer1MOutput: 60.0,
    },
    {
      model: "Claude 3.5",
      charsPerToken: 3.5,
      costPer1MInput: 3.0,
      costPer1MOutput: 15.0,
    },
    {
      model: "Llama 3",
      charsPerToken: 3.8,
      costPer1MInput: 0.0,
      costPer1MOutput: 0.0,
    },
  ];
}

// ---------------------------------------------------------------------------
// Text statistics
// ---------------------------------------------------------------------------

export interface TextStats {
  charCount: number;
  wordCount: number;
  lineCount: number;
  tokenCount: number;
  charsPerToken: number;
}

export function computeTextStats(text: string, tokenCount: number): TextStats {
  const charCount = text.length;
  const wordCount = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
  const lineCount = text === "" ? 0 : text.split("\n").length;
  const charsPerToken = tokenCount > 0 ? charCount / tokenCount : 0;

  return {
    charCount,
    wordCount,
    lineCount,
    tokenCount,
    charsPerToken,
  };
}
