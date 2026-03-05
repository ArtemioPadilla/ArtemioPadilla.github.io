import { useState, useMemo, useCallback, useRef, useEffect } from "preact/hooks";
import type { JSX } from "preact";
import {
  tokenize,
  estimateModelTokenCounts,
  computeTextStats,
  type TokenizerResult,
  type EncodingMode,
  type MergeStep,
  type ModelEstimate,
  type TextStats,
} from "./bpe";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKEN_COLORS = [
  { bg: "rgba(79, 143, 247, 0.2)", border: "rgba(79, 143, 247, 0.5)" },
  { bg: "rgba(52, 211, 153, 0.2)", border: "rgba(52, 211, 153, 0.5)" },
  { bg: "rgba(251, 191, 36, 0.2)", border: "rgba(251, 191, 36, 0.5)" },
  { bg: "rgba(239, 68, 68, 0.2)", border: "rgba(239, 68, 68, 0.5)" },
  { bg: "rgba(168, 85, 247, 0.2)", border: "rgba(168, 85, 247, 0.5)" },
  { bg: "rgba(236, 72, 153, 0.2)", border: "rgba(236, 72, 153, 0.5)" },
  { bg: "rgba(14, 165, 233, 0.2)", border: "rgba(14, 165, 233, 0.5)" },
  { bg: "rgba(245, 158, 11, 0.2)", border: "rgba(245, 158, 11, 0.5)" },
];

const PRESETS: { label: string; text: string }[] = [
  {
    label: "Hello World",
    text: "Hello, world! This is a simple test of the tokenizer.",
  },
  {
    label: "Python Code",
    text: `def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

result = fibonacci(10)
print(f"Result: {result}")`,
  },
  {
    label: "JSON Data",
    text: `{
  "name": "Artemio Padilla",
  "role": "Deep Learning Architect",
  "skills": ["Python", "TypeScript", "PyTorch"],
  "experience": 5,
  "active": true
}`,
  },
  {
    label: "Mixed Languages",
    text: "Hello! Hola! Bonjour! The quick brown fox jumps. El rapido zorro salta. Le renard brun saute. Emojis: \u{1F680}\u{1F30D}\u{2728}\u{1F916}",
  },
  {
    label: "Technical Paragraph",
    text: "Large Language Models use tokenization to convert text into numerical representations. The most common approach is Byte Pair Encoding (BPE), which iteratively merges the most frequent character pairs. This allows the model to handle any text while keeping vocabulary size manageable.",
  },
];

const ENCODING_OPTIONS: { value: EncodingMode; label: string; description: string }[] = [
  { value: "bpe", label: "BPE", description: "Byte Pair Encoding with merge rules" },
  { value: "character", label: "Character", description: "One token per character" },
  { value: "utf8", label: "UTF-8 Bytes", description: "One token per UTF-8 byte" },
];

const AUTOPLAY_INTERVAL_MS = 350;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TokenChip({
  token,
  tokenId,
  index,
}: {
  token: string;
  tokenId: number;
  index: number;
}) {
  const [hovered, setHovered] = useState(false);
  const color = TOKEN_COLORS[index % TOKEN_COLORS.length];
  const displayText = token.replace(/ /g, "\u00B7").replace(/\n/g, "\u21B5").replace(/\t/g, "\u21E5");

  return (
    <span
      class="tokenizer-chip relative inline-flex cursor-default items-center rounded px-1.5 py-0.5 font-mono text-sm leading-snug transition-all"
      style={{
        backgroundColor: color.bg,
        borderWidth: "1px",
        borderStyle: "solid",
        borderColor: color.border,
        color: "var(--color-text)",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {displayText}
      {hovered && (
        <span
          class="absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs shadow-lg"
          style={{
            backgroundColor: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-muted)",
          }}
        >
          <span style={{ color: "var(--color-heading)" }}>ID:</span> {tokenId}
          {" | "}
          <span style={{ color: "var(--color-heading)" }}>Bytes:</span>{" "}
          {[...new TextEncoder().encode(token)].map((b) => b.toString(16).padStart(2, "0")).join(" ")}
        </span>
      )}
    </span>
  );
}

function TokenVisualization({
  result,
}: {
  result: TokenizerResult;
}) {
  if (result.tokens.length === 0) {
    return (
      <p class="py-8 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
        Enter some text above to see tokens.
      </p>
    );
  }

  return (
    <div class="flex flex-wrap gap-1">
      {result.tokens.map((token, i) => (
        <TokenChip key={`${i}-${token}`} token={token} tokenId={result.tokenIds[i]} index={i} />
      ))}
    </div>
  );
}

function ModelComparisonBar({
  estimates,
}: {
  estimates: ModelEstimate[];
}) {
  const maxTokens = Math.max(...estimates.map((e) => e.tokens), 1);

  return (
    <div class="space-y-2.5">
      {estimates.map((est) => {
        const widthPct = Math.max((est.tokens / maxTokens) * 100, 2);
        return (
          <div key={est.model} class="flex items-center gap-3">
            <span
              class="w-20 shrink-0 text-right text-xs font-medium"
              style={{ color: "var(--color-text-muted)" }}
            >
              {est.model}
            </span>
            <div class="flex-1">
              <div
                class="relative h-6 overflow-hidden rounded-md"
                style={{ backgroundColor: "var(--color-border)" }}
              >
                <div
                  class="flex h-full items-center rounded-md px-2 text-xs font-semibold transition-all duration-500"
                  style={{
                    width: `${widthPct}%`,
                    background: `linear-gradient(90deg, var(--color-primary), var(--color-accent))`,
                    color: "#fff",
                    minWidth: "3rem",
                  }}
                >
                  {est.tokens}
                </div>
              </div>
            </div>
            <span
              class="w-16 shrink-0 text-right text-[10px] tabular-nums"
              style={{ color: "var(--color-text-muted)" }}
            >
              {est.charsPerToken > 0 ? `~${est.charsPerToken.toFixed(1)} c/t` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StatsPanel({ stats }: { stats: TextStats }) {
  const items = [
    { label: "Characters", value: stats.charCount.toLocaleString() },
    { label: "Words", value: stats.wordCount.toLocaleString() },
    { label: "Lines", value: stats.lineCount.toLocaleString() },
    { label: "Tokens", value: stats.tokenCount.toLocaleString() },
    {
      label: "Chars / Token",
      value: stats.charsPerToken > 0 ? stats.charsPerToken.toFixed(2) : "--",
    },
  ];

  return (
    <div class="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((item) => (
        <div key={item.label}>
          <div class="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>
            {item.label}
          </div>
          <div class="mt-0.5 font-mono text-lg font-bold tabular-nums" style={{ color: "var(--color-heading)" }}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function CostEstimate({ estimates }: { estimates: ModelEstimate[] }) {
  return (
    <div class="overflow-x-auto">
      <table class="w-full text-left text-xs">
        <thead>
          <tr style={{ color: "var(--color-text-muted)" }}>
            <th class="pb-1.5 pr-4 font-medium">Model</th>
            <th class="pb-1.5 pr-4 font-medium text-right">Est. Tokens</th>
            <th class="pb-1.5 pr-4 font-medium text-right">Input $/1M</th>
            <th class="pb-1.5 font-medium text-right">Output $/1M</th>
          </tr>
        </thead>
        <tbody>
          {estimates.map((est) => (
            <tr key={est.model} style={{ color: "var(--color-text)" }}>
              <td class="py-1 pr-4 font-medium" style={{ color: "var(--color-heading)" }}>
                {est.model}
              </td>
              <td class="py-1 pr-4 text-right font-mono tabular-nums">{est.tokens.toLocaleString()}</td>
              <td class="py-1 pr-4 text-right font-mono tabular-nums">
                {est.costPer1MInput > 0 ? `$${est.costPer1MInput.toFixed(2)}` : "Free"}
              </td>
              <td class="py-1 text-right font-mono tabular-nums">
                {est.costPer1MOutput > 0 ? `$${est.costPer1MOutput.toFixed(2)}` : "Free"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MergeStepVisualizer({
  steps,
  isOpen,
  onToggle,
}: {
  steps: MergeStep[];
  isOpen: boolean;
  onToggle: () => void;
}) {
  const [playingStep, setPlayingStep] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const intervalRef = useRef<number | null>(null);

  const stopPlayback = useCallback(() => {
    setIsPlaying(false);
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startPlayback = useCallback(() => {
    setPlayingStep(0);
    setIsPlaying(true);
  }, []);

  useEffect(() => {
    if (isPlaying && steps.length > 0) {
      intervalRef.current = window.setInterval(() => {
        setPlayingStep((prev) => {
          const next = prev + 1;
          if (next >= steps.length) {
            stopPlayback();
            return prev;
          }
          return next;
        });
      }, AUTOPLAY_INTERVAL_MS);
    }
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPlaying, steps.length, stopPlayback]);

  // Reset playback when steps change
  useEffect(() => {
    stopPlayback();
    setPlayingStep(-1);
  }, [steps, stopPlayback]);

  if (steps.length === 0) {
    return null;
  }

  return (
    <div>
      <button
        onClick={onToggle}
        class="flex w-full items-center gap-2 text-left text-sm font-medium transition-colors"
        style={{ color: "var(--color-heading)" }}
      >
        <span
          class="inline-block transition-transform duration-200"
          style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          &#9654;
        </span>
        BPE Merge Steps ({steps.length})
      </button>

      {isOpen && (
        <div class="mt-3">
          {/* Playback controls */}
          <div class="mb-3 flex items-center gap-2">
            {isPlaying ? (
              <button
                onClick={stopPlayback}
                class="rounded-lg px-3 py-1 text-xs font-medium transition-colors"
                style={{
                  backgroundColor: "var(--color-border)",
                  color: "var(--color-heading)",
                }}
              >
                Pause
              </button>
            ) : (
              <button
                onClick={startPlayback}
                class="tokenizer-play-btn rounded-lg px-3 py-1 text-xs font-semibold text-white transition-all"
              >
                Play
              </button>
            )}
            <span class="text-xs tabular-nums" style={{ color: "var(--color-text-muted)" }}>
              {playingStep >= 0 ? `Step ${playingStep + 1} / ${steps.length}` : `${steps.length} steps`}
            </span>
          </div>

          {/* Steps list */}
          <div
            class="max-h-60 space-y-1 overflow-y-auto rounded-lg p-3"
            style={{
              backgroundColor: "var(--color-bg)",
              border: "1px solid var(--color-border)",
            }}
          >
            {steps.map((step, idx) => {
              const isHighlighted = idx === playingStep;
              const isPast = playingStep >= 0 && idx < playingStep;
              const isFuture = playingStep >= 0 && idx > playingStep;

              return (
                <div
                  key={step.step}
                  class="flex items-center gap-3 rounded-md px-2 py-1 font-mono text-xs transition-all"
                  style={{
                    backgroundColor: isHighlighted ? "rgba(79, 143, 247, 0.15)" : "transparent",
                    opacity: isFuture ? 0.3 : 1,
                    color: isPast ? "var(--color-text-muted)" : "var(--color-text)",
                  }}
                >
                  <span
                    class="w-6 shrink-0 text-right tabular-nums"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    {step.step}
                  </span>
                  <span style={{ color: "var(--color-primary)" }}>
                    {formatToken(step.pair[0])}
                  </span>
                  <span style={{ color: "var(--color-text-muted)" }}>+</span>
                  <span style={{ color: "var(--color-primary)" }}>
                    {formatToken(step.pair[1])}
                  </span>
                  <span style={{ color: "var(--color-text-muted)" }}>&rarr;</span>
                  <span class="font-semibold" style={{ color: "var(--color-accent)" }}>
                    {formatToken(step.merged)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function formatToken(t: string): string {
  return t.replace(/ /g, "\u00B7").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function TokenizerPlayground() {
  const [text, setText] = useState(PRESETS[0].text);
  const [encoding, setEncoding] = useState<EncodingMode>("bpe");
  const [mergeStepsOpen, setMergeStepsOpen] = useState(false);

  const result: TokenizerResult = useMemo(
    () => tokenize(text, encoding),
    [text, encoding]
  );

  const estimates: ModelEstimate[] = useMemo(
    () => estimateModelTokenCounts(text),
    [text]
  );

  const stats: TextStats = useMemo(
    () => computeTextStats(text, result.tokens.length),
    [text, result.tokens.length]
  );

  const handlePresetChange = useCallback((e: JSX.TargetedEvent<HTMLSelectElement>) => {
    const preset = PRESETS.find((p) => p.label === e.currentTarget.value);
    if (preset) setText(preset.text);
  }, []);

  const handleEncodingChange = useCallback((e: JSX.TargetedEvent<HTMLSelectElement>) => {
    setEncoding(e.currentTarget.value as EncodingMode);
  }, []);

  const handleTextInput = useCallback((e: JSX.TargetedEvent<HTMLTextAreaElement>) => {
    setText(e.currentTarget.value);
  }, []);

  const toggleMergeSteps = useCallback(() => {
    setMergeStepsOpen((prev) => !prev);
  }, []);

  return (
    <div class="space-y-4">
      {/* Input section */}
      <div
        class="overflow-hidden rounded-2xl"
        style={{ border: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)" }}
      >
        {/* Toolbar */}
        <div
          class="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <div class="flex items-center gap-2">
            <span class="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
              Input Text
            </span>
          </div>

          <div class="flex items-center gap-2">
            {/* Encoding selector */}
            <select
              class="rounded-lg px-2 py-1.5 text-xs outline-none"
              style={{
                border: "1px solid var(--color-border)",
                backgroundColor: "var(--color-bg)",
                color: "var(--color-text)",
              }}
              value={encoding}
              onChange={handleEncodingChange}
            >
              {ENCODING_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            {/* Preset selector */}
            <select
              class="rounded-lg px-2 py-1.5 text-xs outline-none"
              style={{
                border: "1px solid var(--color-border)",
                backgroundColor: "var(--color-bg)",
                color: "var(--color-text)",
              }}
              onChange={handlePresetChange}
              value={PRESETS.find((p) => p.text === text)?.label ?? ""}
            >
              <option value="" disabled>
                Presets...
              </option>
              {PRESETS.map((p) => (
                <option key={p.label} value={p.label}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Textarea */}
        <textarea
          class="w-full resize-y p-4 font-mono text-sm leading-relaxed outline-none"
          style={{
            backgroundColor: "var(--color-surface)",
            color: "var(--color-text)",
            minHeight: "120px",
            maxHeight: "300px",
          }}
          value={text}
          onInput={handleTextInput}
          placeholder="Type or paste text here..."
          spellcheck={false}
        />
      </div>

      {/* Token visualization */}
      <div
        class="overflow-hidden rounded-2xl"
        style={{ border: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)" }}
      >
        <div
          class="flex items-center justify-between px-4 py-2.5"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <div class="flex items-center gap-2">
            <span class="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
              Tokens
            </span>
            <span
              class="rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums"
              style={{
                backgroundColor: "rgba(79, 143, 247, 0.15)",
                color: "var(--color-primary)",
              }}
            >
              {result.tokens.length}
            </span>
          </div>
          <span class="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
            {ENCODING_OPTIONS.find((o) => o.value === encoding)?.description}
          </span>
        </div>

        <div class="p-4">
          <TokenVisualization result={result} />
        </div>
      </div>

      {/* Model comparison */}
      <div
        class="overflow-hidden rounded-2xl"
        style={{ border: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)" }}
      >
        <div
          class="px-4 py-2.5"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <span class="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
            Estimated Token Counts by Model
          </span>
        </div>
        <div class="p-4">
          <ModelComparisonBar estimates={estimates} />
        </div>
      </div>

      {/* Stats + Merge steps + Cost side by side */}
      <div class="grid gap-4 lg:grid-cols-2">
        {/* Statistics */}
        <div
          class="overflow-hidden rounded-2xl"
          style={{ border: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)" }}
        >
          <div
            class="px-4 py-2.5"
            style={{ borderBottom: "1px solid var(--color-border)" }}
          >
            <span class="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
              Statistics
            </span>
          </div>
          <div class="p-4">
            <StatsPanel stats={stats} />
          </div>
        </div>

        {/* Cost estimate */}
        <div
          class="overflow-hidden rounded-2xl"
          style={{ border: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)" }}
        >
          <div
            class="px-4 py-2.5"
            style={{ borderBottom: "1px solid var(--color-border)" }}
          >
            <span class="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
              API Pricing Reference
            </span>
          </div>
          <div class="p-4">
            <CostEstimate estimates={estimates} />
          </div>
        </div>
      </div>

      {/* BPE merge steps (only for BPE mode) */}
      {encoding === "bpe" && result.mergeSteps.length > 0 && (
        <div
          class="overflow-hidden rounded-2xl"
          style={{ border: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)" }}
        >
          <div class="p-4">
            <MergeStepVisualizer
              steps={result.mergeSteps}
              isOpen={mergeStepsOpen}
              onToggle={toggleMergeSteps}
            />
          </div>
        </div>
      )}

      <style>{`
        .tokenizer-play-btn {
          background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
        }
        .tokenizer-play-btn:hover {
          filter: brightness(1.1);
          box-shadow: 0 0 16px color-mix(in srgb, var(--color-primary) 40%, transparent);
        }
        .tokenizer-chip {
          white-space: pre;
        }
      `}</style>
    </div>
  );
}
