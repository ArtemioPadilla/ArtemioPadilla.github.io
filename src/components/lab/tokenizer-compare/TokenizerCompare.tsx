import { useState, useMemo, useCallback } from "preact/hooks";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

interface Token {
  text: string;
  id: number;
}

interface TokenizerResult {
  name: string;
  tokens: Token[];
  vocabSize: number;
  avgTokenLength: number;
}

interface BPEMerge {
  pair: [string, string];
  merged: string;
  frequency: number;
  step: number;
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const TOKEN_COLORS = [
  { bg: "rgba(79, 143, 247, 0.2)", border: "rgba(79, 143, 247, 0.5)", text: "#4f8ff7" },
  { bg: "rgba(52, 211, 153, 0.2)", border: "rgba(52, 211, 153, 0.5)", text: "#34d399" },
  { bg: "rgba(251, 191, 36, 0.2)", border: "rgba(251, 191, 36, 0.5)", text: "#f59e0b" },
  { bg: "rgba(239, 68, 68, 0.2)", border: "rgba(239, 68, 68, 0.5)", text: "#ef4444" },
  { bg: "rgba(168, 85, 247, 0.2)", border: "rgba(168, 85, 247, 0.5)", text: "#a855f7" },
  { bg: "rgba(236, 72, 153, 0.2)", border: "rgba(236, 72, 153, 0.5)", text: "#ec4899" },
  { bg: "rgba(14, 165, 233, 0.2)", border: "rgba(14, 165, 233, 0.5)", text: "#0ea5e9" },
  { bg: "rgba(245, 158, 11, 0.2)", border: "rgba(245, 158, 11, 0.5)", text: "#f59e0b" },
  { bg: "rgba(132, 204, 22, 0.2)", border: "rgba(132, 204, 22, 0.5)", text: "#84cc16" },
  { bg: "rgba(99, 102, 241, 0.2)", border: "rgba(99, 102, 241, 0.5)", text: "#6366f1" },
];

const PRESETS = [
  {
    label: "English",
    text: "The quick brown fox jumps over the lazy dog",
  },
  {
    label: "Code",
    text: `function fibonacci(n) {\n  if (n <= 1) return n;\n  return fibonacci(n - 1) + fibonacci(n - 2);\n}`,
  },
  {
    label: "Multilingual",
    text: "Hello! Hola! Bonjour! Hallo! Ciao! \u3053\u3093\u306B\u3061\u306F \u4F60\u597D \uC548\uB155\uD558\uC138\uC694",
  },
  {
    label: "Emojis",
    text: "\u{1F680} Rocket science is \u{1F525} but also \u{1F9CA} cold. \u{1F30D}\u{2728}\u{1F916}\u{1F4A1}",
  },
  {
    label: "Technical",
    text: "Large Language Models use byte-pair encoding (BPE) to tokenize text. The algorithm iteratively merges the most frequent adjacent token pairs.",
  },
  {
    label: "JSON",
    text: '{"name": "Artemio", "role": "ML Engineer", "skills": ["Python", "TypeScript"]}',
  },
  {
    label: "Repeated",
    text: "aaaa bbbb cccc aaaa bbbb cccc dddd eeee aaaa bbbb",
  },
];

const DEFAULT_TEXT = "Hello, world! \u3053\u3093\u306B\u3061\u306F \u{1F30D} The quick brown fox";

// ─────────────────────────────────────────────────────────
// Character-level Tokenizer
// ─────────────────────────────────────────────────────────

function tokenizeCharacter(text: string): TokenizerResult {
  const vocab = new Map<string, number>();
  const tokens: Token[] = [];

  for (const char of text) {
    if (!vocab.has(char)) {
      vocab.set(char, vocab.size);
    }
    tokens.push({ text: char, id: vocab.get(char)! });
  }

  const avgLen = tokens.length > 0
    ? tokens.reduce((s, t) => s + t.text.length, 0) / tokens.length
    : 0;

  return {
    name: "Character",
    tokens,
    vocabSize: vocab.size,
    avgTokenLength: avgLen,
  };
}

// ─────────────────────────────────────────────────────────
// Word-level Tokenizer
// ─────────────────────────────────────────────────────────

function tokenizeWord(text: string): TokenizerResult {
  const rawTokens = text.match(/[\w]+|[^\s\w]/gu) || [];
  const vocab = new Map<string, number>();
  const tokens: Token[] = [];

  for (const t of rawTokens) {
    if (!vocab.has(t)) {
      vocab.set(t, vocab.size);
    }
    tokens.push({ text: t, id: vocab.get(t)! });
  }

  // Capture whitespace between tokens for display
  const withSpaces: Token[] = [];
  let idx = 0;
  for (const token of tokens) {
    const pos = text.indexOf(token.text, idx);
    if (pos > idx) {
      withSpaces.push({ text: text.slice(idx, pos), id: -1 });
    }
    withSpaces.push(token);
    idx = pos + token.text.length;
  }
  if (idx < text.length) {
    withSpaces.push({ text: text.slice(idx), id: -1 });
  }

  const avgLen = tokens.length > 0
    ? tokens.reduce((s, t) => s + t.text.length, 0) / tokens.length
    : 0;

  return {
    name: "Word",
    tokens: withSpaces,
    vocabSize: vocab.size,
    avgTokenLength: avgLen,
  };
}

// ─────────────────────────────────────────────────────────
// BPE (Byte Pair Encoding) Tokenizer
// ─────────────────────────────────────────────────────────

function runBPEMerges(text: string, maxMerges: number): { result: TokenizerResult; merges: BPEMerge[] } {
  if (text.length === 0) {
    return {
      result: { name: "BPE", tokens: [], vocabSize: 0, avgTokenLength: 0 },
      merges: [],
    };
  }

  // Start with character-level tokens
  let symbols = [...text];
  const merges: BPEMerge[] = [];
  const vocab = new Set<string>(symbols);

  for (let step = 0; step < maxMerges; step++) {
    // Count adjacent pairs
    const pairCounts = new Map<string, number>();
    for (let i = 0; i < symbols.length - 1; i++) {
      const pair = symbols[i] + "|" + symbols[i + 1];
      pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1);
    }

    if (pairCounts.size === 0) break;

    // Find most frequent pair
    let bestPair = "";
    let bestCount = 0;
    for (const [pair, count] of pairCounts) {
      if (count > bestCount) {
        bestPair = pair;
        bestCount = count;
      }
    }

    if (bestCount < 2) break;

    const [left, right] = bestPair.split("|");
    const merged = left + right;
    vocab.add(merged);

    merges.push({
      pair: [left, right],
      merged,
      frequency: bestCount,
      step: step + 1,
    });

    // Apply merge
    const newSymbols: string[] = [];
    let i = 0;
    while (i < symbols.length) {
      if (i < symbols.length - 1 && symbols[i] === left && symbols[i + 1] === right) {
        newSymbols.push(merged);
        i += 2;
      } else {
        newSymbols.push(symbols[i]);
        i++;
      }
    }
    symbols = newSymbols;
  }

  // Build tokens with IDs
  const vocabMap = new Map<string, number>();
  let nextId = 0;
  const tokens: Token[] = symbols.map((s) => {
    if (!vocabMap.has(s)) {
      vocabMap.set(s, nextId++);
    }
    return { text: s, id: vocabMap.get(s)! };
  });

  const avgLen = tokens.length > 0
    ? tokens.reduce((s, t) => s + t.text.length, 0) / tokens.length
    : 0;

  return {
    result: {
      name: "BPE",
      tokens,
      vocabSize: vocab.size,
      avgTokenLength: avgLen,
    },
    merges,
  };
}

// ─────────────────────────────────────────────────────────
// Unigram Tokenizer
// ─────────────────────────────────────────────────────────

function tokenizeUnigram(text: string): TokenizerResult {
  if (text.length === 0) {
    return { name: "Unigram", tokens: [], vocabSize: 0, avgTokenLength: 0 };
  }

  // Build frequency-based subword vocabulary from the text
  // 1. Collect all substrings up to length 8 and count them
  const substringCounts = new Map<string, number>();
  const maxSubLen = Math.min(8, text.length);

  for (let i = 0; i < text.length; i++) {
    for (let len = 1; len <= Math.min(maxSubLen, text.length - i); len++) {
      const sub = text.slice(i, i + len);
      substringCounts.set(sub, (substringCounts.get(sub) || 0) + 1);
    }
  }

  // 2. Score substrings: frequency * length (prefer longer, frequent pieces)
  const scored: Array<[string, number]> = [];
  for (const [sub, count] of substringCounts) {
    if (count >= 1) {
      scored.push([sub, count * sub.length]);
    }
  }
  scored.sort((a, b) => b[1] - a[1]);

  // 3. Build vocabulary: top-N subwords + all single characters as fallback
  const vocabSet = new Set<string>();
  for (const char of text) {
    vocabSet.add(char);
  }
  const maxVocab = 150;
  for (const [sub] of scored) {
    if (vocabSet.size >= maxVocab) break;
    if (sub.length > 1) vocabSet.add(sub);
  }

  // 4. Greedy longest-match tokenization with the built vocab
  const vocabMap = new Map<string, number>();
  let nextId = 0;
  for (const v of vocabSet) {
    vocabMap.set(v, nextId++);
  }

  // Sort vocab by length descending for greedy matching
  const sortedVocab = [...vocabSet].sort((a, b) => b.length - a.length);

  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    let matched = false;
    for (const v of sortedVocab) {
      if (text.startsWith(v, i)) {
        tokens.push({ text: v, id: vocabMap.get(v)! });
        i += v.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Fallback: single character
      const ch = text[i];
      if (!vocabMap.has(ch)) vocabMap.set(ch, nextId++);
      tokens.push({ text: ch, id: vocabMap.get(ch)! });
      i++;
    }
  }

  const avgLen = tokens.length > 0
    ? tokens.reduce((s, t) => s + t.text.length, 0) / tokens.length
    : 0;

  return {
    name: "Unigram",
    tokens,
    vocabSize: vocabMap.size,
    avgTokenLength: avgLen,
  };
}

// ─────────────────────────────────────────────────────────
// Token Chip Component
// ─────────────────────────────────────────────────────────

function TokenChip({ token, index }: { token: Token; index: number }) {
  if (token.id === -1) {
    const display = token.text
      .replace(/ /g, "\u00B7")
      .replace(/\n/g, "\u21B5")
      .replace(/\t/g, "\u2192");
    return (
      <span
        class="inline-block text-[10px] font-mono opacity-30"
        style={{ color: "var(--color-text-muted)" }}
      >
        {display}
      </span>
    );
  }

  const colorIdx = Math.abs(token.id) % TOKEN_COLORS.length;
  const color = TOKEN_COLORS[colorIdx];
  const displayText = token.text
    .replace(/ /g, "\u00B7")
    .replace(/\n/g, "\u21B5")
    .replace(/\t/g, "\u2192");

  return (
    <span
      class="inline-block px-1 py-0.5 rounded text-[11px] font-mono border leading-tight"
      style={{
        background: color.bg,
        borderColor: color.border,
        color: color.text,
      }}
      title={`Token #${index} | ID: ${token.id} | "${token.text}"`}
    >
      {displayText}
    </span>
  );
}

// ─────────────────────────────────────────────────────────
// Tokenizer Panel Component
// ─────────────────────────────────────────────────────────

function TokenizerPanel({ result }: { result: TokenizerResult }) {
  const nonSpaceTokens = result.tokens.filter((t) => t.id !== -1);
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 h-full flex flex-col">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-semibold text-[var(--color-heading)]">{result.name}</span>
        <span class="text-[10px] text-[var(--color-text-muted)]">
          {nonSpaceTokens.length} tokens
        </span>
      </div>

      <div
        class="flex flex-wrap gap-0.5 p-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] flex-1 overflow-y-auto content-start"
        style={{ maxHeight: "180px", minHeight: "80px" }}
      >
        {result.tokens.map((token, i) => (
          <TokenChip key={i} token={token} index={i} />
        ))}
      </div>

      <div class="grid grid-cols-3 gap-2 mt-2">
        <div class="text-center">
          <div class="text-[10px] text-[var(--color-text-muted)]">Tokens</div>
          <div class="text-sm font-semibold text-[var(--color-heading)]">{nonSpaceTokens.length}</div>
        </div>
        <div class="text-center">
          <div class="text-[10px] text-[var(--color-text-muted)]">Avg Len</div>
          <div class="text-sm font-semibold text-[var(--color-heading)]">
            {result.avgTokenLength.toFixed(1)}
          </div>
        </div>
        <div class="text-center">
          <div class="text-[10px] text-[var(--color-text-muted)]">Vocab</div>
          <div class="text-sm font-semibold text-[var(--color-heading)]">{result.vocabSize}</div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// BPE Merge Steps Panel
// ─────────────────────────────────────────────────────────

function BPEMergePanel({ merges }: { merges: BPEMerge[] }) {
  if (merges.length === 0) {
    return (
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <div class="text-xs font-semibold text-[var(--color-heading)] mb-2">BPE Merge Operations</div>
        <div class="text-[10px] text-[var(--color-text-muted)]">
          No merges possible (text too short or no repeated pairs).
        </div>
      </div>
    );
  }

  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div class="text-xs font-semibold text-[var(--color-heading)] mb-2">
        BPE Merge Operations ({merges.length} merges)
      </div>
      <div
        class="overflow-y-auto space-y-1"
        style={{ maxHeight: "200px" }}
      >
        {merges.map((m, i) => {
          const leftDisplay = m.pair[0].replace(/ /g, "\u00B7").replace(/\n/g, "\u21B5");
          const rightDisplay = m.pair[1].replace(/ /g, "\u00B7").replace(/\n/g, "\u21B5");
          const mergedDisplay = m.merged.replace(/ /g, "\u00B7").replace(/\n/g, "\u21B5");

          return (
            <div
              key={i}
              class="flex items-center gap-2 py-1 px-2 rounded text-[11px] font-mono"
              style={{
                background: i % 2 === 0 ? "var(--color-bg)" : "transparent",
              }}
            >
              <span class="text-[var(--color-text-muted)] w-6 text-right flex-shrink-0">
                {m.step}.
              </span>
              <span
                class="px-1 rounded border"
                style={{
                  background: TOKEN_COLORS[i % TOKEN_COLORS.length].bg,
                  borderColor: TOKEN_COLORS[i % TOKEN_COLORS.length].border,
                  color: TOKEN_COLORS[i % TOKEN_COLORS.length].text,
                }}
              >
                {leftDisplay}
              </span>
              <span class="text-[var(--color-text-muted)]">+</span>
              <span
                class="px-1 rounded border"
                style={{
                  background: TOKEN_COLORS[(i + 1) % TOKEN_COLORS.length].bg,
                  borderColor: TOKEN_COLORS[(i + 1) % TOKEN_COLORS.length].border,
                  color: TOKEN_COLORS[(i + 1) % TOKEN_COLORS.length].text,
                }}
              >
                {rightDisplay}
              </span>
              <span class="text-[var(--color-text-muted)]">=</span>
              <span class="text-[var(--color-accent)] font-bold">{mergedDisplay}</span>
              <span class="text-[var(--color-text-muted)] ml-auto flex-shrink-0">
                x{m.frequency}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Comparison Bar Chart
// ─────────────────────────────────────────────────────────

function ComparisonChart({ results }: { results: TokenizerResult[] }) {
  const maxTokens = Math.max(
    ...results.map((r) => r.tokens.filter((t) => t.id !== -1).length),
    1,
  );
  const colors = ["#4f8ff7", "#34d399", "#a855f7", "#f59e0b"];

  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div class="text-[10px] font-medium text-[var(--color-text-muted)] mb-2">
        Token Count Comparison
      </div>
      <div class="space-y-2">
        {results.map((r, i) => {
          const count = r.tokens.filter((t) => t.id !== -1).length;
          const pct = (count / maxTokens) * 100;
          return (
            <div key={r.name}>
              <div class="flex justify-between text-[10px] text-[var(--color-text-muted)] mb-0.5">
                <span>{r.name}</span>
                <span>{count}</span>
              </div>
              <div class="h-2 rounded-full bg-[var(--color-border)]">
                <div
                  class="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, background: colors[i % colors.length] }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Metrics Table
// ─────────────────────────────────────────────────────────

function MetricsTable({ results, textLength }: { results: TokenizerResult[]; textLength: number }) {
  const colors = ["#4f8ff7", "#34d399", "#a855f7", "#f59e0b"];

  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 overflow-x-auto">
      <div class="text-[10px] font-medium text-[var(--color-text-muted)] mb-2">
        Metrics Comparison
      </div>
      <table class="w-full text-xs" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr class="border-b border-[var(--color-border)]">
            <th class="text-left py-1.5 px-2 text-[var(--color-text-muted)] font-medium">Method</th>
            <th class="text-right py-1.5 px-2 text-[var(--color-text-muted)] font-medium">Tokens</th>
            <th class="text-right py-1.5 px-2 text-[var(--color-text-muted)] font-medium">Vocab Size</th>
            <th class="text-right py-1.5 px-2 text-[var(--color-text-muted)] font-medium">Avg Token Len</th>
            <th class="text-right py-1.5 px-2 text-[var(--color-text-muted)] font-medium">Compression</th>
            <th class="text-right py-1.5 px-2 text-[var(--color-text-muted)] font-medium">Efficiency</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => {
            const nonSpace = r.tokens.filter((t) => t.id !== -1);
            const tokenCount = nonSpace.length;
            const compression = textLength > 0 ? (tokenCount / textLength).toFixed(3) : "0";
            const efficiency = tokenCount > 0 ? (textLength / tokenCount).toFixed(2) : "0";

            return (
              <tr key={r.name} class="border-b border-[var(--color-border)]">
                <td class="py-1.5 px-2 font-semibold" style={{ color: colors[i % colors.length] }}>
                  {r.name}
                </td>
                <td class="py-1.5 px-2 text-right text-[var(--color-heading)] font-mono">
                  {tokenCount}
                </td>
                <td class="py-1.5 px-2 text-right text-[var(--color-text)] font-mono">
                  {r.vocabSize}
                </td>
                <td class="py-1.5 px-2 text-right text-[var(--color-text)] font-mono">
                  {r.avgTokenLength.toFixed(1)}
                </td>
                <td class="py-1.5 px-2 text-right text-[var(--color-text-muted)] font-mono">
                  {compression}
                </td>
                <td class="py-1.5 px-2 text-right text-[var(--color-accent)] font-mono">
                  {efficiency} chars/tok
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────

const btnBase =
  "px-3 py-1.5 text-xs font-medium rounded border transition-colors cursor-pointer";
const btnSecondary = `${btnBase} bg-transparent text-[var(--color-text-muted)] border-[var(--color-border)] hover:text-[var(--color-heading)] hover:border-[var(--color-text-muted)]`;

// ─────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────

export default function TokenizerCompare() {
  const [text, setText] = useState(DEFAULT_TEXT);
  const [showMerges, setShowMerges] = useState(true);

  const charResult = useMemo(() => tokenizeCharacter(text), [text]);
  const wordResult = useMemo(() => tokenizeWord(text), [text]);
  const bpeData = useMemo(() => runBPEMerges(text, 50), [text]);
  const unigramResult = useMemo(() => tokenizeUnigram(text), [text]);

  const allResults = [charResult, wordResult, bpeData.result, unigramResult];

  const handlePreset = useCallback((presetText: string) => {
    setText(presetText);
  }, []);

  return (
    <div class="space-y-4">
      {/* Input area */}
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <label class="block text-[10px] font-medium text-[var(--color-text-muted)] mb-1">
          Input Text
        </label>
        <textarea
          class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] font-mono focus:border-[var(--color-primary)] focus:outline-none resize-y"
          rows={3}
          value={text}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          placeholder="Type or paste text to tokenize..."
        />
        <div class="text-[10px] text-[var(--color-text-muted)] mt-1">
          {text.length} characters | {[...text].length} Unicode code points
        </div>
      </div>

      {/* Preset buttons */}
      <div class="flex flex-wrap gap-2">
        <span class="text-[10px] text-[var(--color-text-muted)] self-center mr-1">Try:</span>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            class={btnSecondary}
            onClick={() => handlePreset(p.text)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Four tokenizer panels */}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TokenizerPanel result={charResult} />
        <TokenizerPanel result={wordResult} />
        <TokenizerPanel result={bpeData.result} />
        <TokenizerPanel result={unigramResult} />
      </div>

      {/* BPE Merge Operations */}
      <div class="flex items-center gap-2">
        <button
          class={btnSecondary}
          onClick={() => setShowMerges(!showMerges)}
        >
          {showMerges ? "Hide" : "Show"} BPE Merge Steps
        </button>
        <span class="text-[10px] text-[var(--color-text-muted)]">
          {bpeData.merges.length} merge operations performed
        </span>
      </div>

      {showMerges && <BPEMergePanel merges={bpeData.merges} />}

      {/* Comparison chart */}
      <ComparisonChart results={allResults} />

      {/* Metrics table */}
      <MetricsTable results={allResults} textLength={text.length} />

      {/* Compression ratios */}
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        {allResults.map((r, i) => {
          const nonSpace = r.tokens.filter((t) => t.id !== -1);
          const ratio = text.length > 0 ? nonSpace.length / text.length : 0;
          const colors = ["#4f8ff7", "#34d399", "#a855f7", "#f59e0b"];
          return (
            <div
              key={r.name}
              class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-center"
            >
              <div class="text-[10px] text-[var(--color-text-muted)]">
                {r.name}
              </div>
              <div class="text-lg font-semibold" style={{ color: colors[i] }}>
                {ratio.toFixed(2)}x
              </div>
              <div class="text-[10px] text-[var(--color-text-muted)]">
                tokens / chars
              </div>
            </div>
          );
        })}
      </div>

      {/* Info */}
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <div class="text-xs font-semibold text-[var(--color-heading)] mb-1">
          How Real Tokenizers Work
        </div>
        <div class="text-xs text-[var(--color-text-muted)] leading-relaxed space-y-2">
          <p>
            <strong class="text-[var(--color-text)]">Character-level:</strong> Each character is a
            token. Tiny vocabulary but very long sequences. Used in some character-level language models.
          </p>
          <p>
            <strong class="text-[var(--color-text)]">Word-level:</strong> Splits on whitespace and
            punctuation. Simple but creates huge vocabularies and cannot handle unseen words (OOV problem).
          </p>
          <p>
            <strong class="text-[var(--color-text)]">BPE (Byte Pair Encoding):</strong> Iteratively
            merges the most frequent adjacent pairs. Used by GPT-2/3/4 and most modern LLMs. Real
            tokenizers like <code>tiktoken</code> train on billions of tokens to build ~100K merge rules.
            The simplified BPE here runs merges directly on the input text.
          </p>
          <p>
            <strong class="text-[var(--color-text)]">Unigram:</strong> Builds a vocabulary of subwords
            scored by frequency, then uses longest-match tokenization. Used by SentencePiece (T5, ALBERT).
            The real algorithm uses the EM algorithm to optimize a unigram language model; this is a
            simplified frequency-based version.
          </p>
        </div>
      </div>
    </div>
  );
}
