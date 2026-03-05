import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";
import type {
  AlgorithmId,
  HuffmanStep,
  HuffmanNode,
  LzwStep,
  RleStep,
  CompressionResult,
} from "./algorithms";
import {
  generateHuffmanSteps,
  generateLzwSteps,
  generateRleSteps,
  computeHuffmanStats,
  computeLzwStats,
  computeRleStats,
  TEXT_PRESETS,
} from "./algorithms";

/* ══════════════════════════════════════════════════════════
   Theme helpers (SSR-safe)
   ══════════════════════════════════════════════════════════ */

interface ThemeColors {
  bg: string;
  surface: string;
  border: string;
  text: string;
  textMuted: string;
  heading: string;
  primary: string;
  accent: string;
}

function readThemeColors(): ThemeColors {
  if (typeof document === "undefined") {
    return {
      bg: "#09090b",
      surface: "#111111",
      border: "#27272a",
      text: "#e4e4e7",
      textMuted: "#a1a1aa",
      heading: "#ffffff",
      primary: "#4f8ff7",
      accent: "#34d399",
    };
  }
  const s = getComputedStyle(document.documentElement);
  const g = (v: string) => s.getPropertyValue(v).trim();
  return {
    bg: g("--color-bg") || "#09090b",
    surface: g("--color-surface") || "#111111",
    border: g("--color-border") || "#27272a",
    text: g("--color-text") || "#e4e4e7",
    textMuted: g("--color-text-muted") || "#a1a1aa",
    heading: g("--color-heading") || "#ffffff",
    primary: g("--color-primary") || "#4f8ff7",
    accent: g("--color-accent") || "#34d399",
  };
}

/* ══════════════════════════════════════════════════════════
   Huffman Tree Canvas Renderer
   ══════════════════════════════════════════════════════════ */

interface LayoutNode {
  node: HuffmanNode;
  x: number;
  y: number;
  left: LayoutNode | null;
  right: LayoutNode | null;
}

function layoutHuffmanTree(
  root: HuffmanNode,
  width: number,
  height: number,
): LayoutNode {
  // Count tree depth for vertical spacing
  function depth(n: HuffmanNode | null): number {
    if (!n) return 0;
    return 1 + Math.max(depth(n.left), depth(n.right));
  }
  const d = depth(root);
  const yStep = d > 1 ? (height - 80) / (d - 1) : 0;

  function layout(
    n: HuffmanNode,
    xMin: number,
    xMax: number,
    level: number,
  ): LayoutNode {
    const x = (xMin + xMax) / 2;
    const y = 40 + level * yStep;
    return {
      node: n,
      x,
      y,
      left: n.left ? layout(n.left, xMin, x, level + 1) : null,
      right: n.right ? layout(n.right, x, xMax, level + 1) : null,
    };
  }

  return layout(root, 20, width - 20, 0);
}

function drawHuffmanTree(
  ctx: CanvasRenderingContext2D,
  root: LayoutNode,
  colors: ThemeColors,
  highlightIds: Set<number>,
  dpr: number,
): void {
  const nodeRadius = 22;

  function drawEdge(parent: LayoutNode, child: LayoutNode, label: string): void {
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(parent.x, parent.y);
    ctx.lineTo(child.x, child.y);
    ctx.stroke();

    // Edge label
    const mx = (parent.x + child.x) / 2;
    const my = (parent.y + child.y) / 2;
    ctx.fillStyle = colors.accent;
    ctx.font = `bold ${12 * dpr}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, mx + (child.x < parent.x ? -8 * dpr : 8 * dpr), my);
  }

  function drawNode(ln: LayoutNode): void {
    // Draw edges first (behind nodes)
    if (ln.left) drawEdge(ln, ln.left, "0");
    if (ln.right) drawEdge(ln, ln.right, "1");

    // Recursively draw children
    if (ln.left) drawNode(ln.left);
    if (ln.right) drawNode(ln.right);

    // Draw this node
    const isHighlighted = highlightIds.has(ln.node.id);
    const isLeaf = ln.node.char !== null;

    ctx.beginPath();
    ctx.arc(ln.x, ln.y, nodeRadius * dpr, 0, Math.PI * 2);
    ctx.fillStyle = isHighlighted
      ? colors.primary
      : isLeaf
        ? colors.surface
        : colors.bg;
    ctx.fill();
    ctx.strokeStyle = isHighlighted ? colors.accent : colors.border;
    ctx.lineWidth = 2 * dpr;
    ctx.stroke();

    // Node label
    ctx.fillStyle = isHighlighted ? colors.heading : colors.text;
    ctx.font = `bold ${11 * dpr}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (isLeaf) {
      const displayChar = ln.node.char === " " ? "SP" : ln.node.char!;
      ctx.fillText(displayChar, ln.x, ln.y - 5 * dpr);
      ctx.fillStyle = colors.textMuted;
      ctx.font = `${9 * dpr}px monospace`;
      ctx.fillText(`${ln.node.freq}`, ln.x, ln.y + 8 * dpr);
    } else {
      ctx.fillText(`${ln.node.freq}`, ln.x, ln.y);
    }
  }

  drawNode(root);
}

/* ══════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════ */

const MAX_INPUT_LENGTH = 80;

export default function CompressionViz() {
  const [algorithm, setAlgorithm] = useState<AlgorithmId>("huffman");
  const [inputText, setInputText] = useState("hello world");
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(500);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playRef = useRef(false);
  const colorsRef = useRef<ThemeColors>(readThemeColors());

  // Generate steps for current algorithm + input
  const steps = useMemo(() => {
    const text = inputText.slice(0, MAX_INPUT_LENGTH);
    if (text.length === 0) return [];
    switch (algorithm) {
      case "huffman":
        return generateHuffmanSteps(text);
      case "lzw":
        return generateLzwSteps(text);
      case "rle":
        return generateRleSteps(text);
    }
  }, [algorithm, inputText]);

  // Clamp step when steps change
  useEffect(() => {
    setCurrentStep(0);
    setIsPlaying(false);
    playRef.current = false;
  }, [algorithm, inputText]);

  // Re-read theme colors on mount & theme change
  useEffect(() => {
    colorsRef.current = readThemeColors();
    const observer = new MutationObserver(() => {
      colorsRef.current = readThemeColors();
      drawCanvas();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  // Auto-play
  useEffect(() => {
    playRef.current = isPlaying;
    if (!isPlaying) return;

    const interval = setInterval(() => {
      if (!playRef.current) return;
      setCurrentStep((prev) => {
        if (prev >= steps.length - 1) {
          setIsPlaying(false);
          playRef.current = false;
          return prev;
        }
        return prev + 1;
      });
    }, speed);

    return () => clearInterval(interval);
  }, [isPlaying, speed, steps.length]);

  // Draw canvas for Huffman tree
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || algorithm !== "huffman") return;

    const step = steps[currentStep] as HuffmanStep | undefined;
    if (!step) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const colors = colorsRef.current;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Find the best tree to display: for merge steps, show the latest merge.
    // For tree-complete and later, show the full tree.
    let treeToShow: HuffmanNode | null = null;

    if (step.tree) {
      treeToShow = step.tree;
    } else if (step.kind === "init-queue" || step.kind === "freq-table") {
      // Show leaves as a flat "forest"
      // We'll draw them as individual nodes
      const leaves = step.queue;
      const spacing = canvas.width / (leaves.length + 1);
      leaves.forEach((leaf, i) => {
        const x = spacing * (i + 1);
        const y = canvas.height / 2;
        const isHL = step.highlightNodes.includes(leaf.id);
        const nodeR = 22 * dpr;

        ctx.beginPath();
        ctx.arc(x, y, nodeR, 0, Math.PI * 2);
        ctx.fillStyle = isHL ? colors.primary : colors.surface;
        ctx.fill();
        ctx.strokeStyle = isHL ? colors.accent : colors.border;
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();

        const displayChar = leaf.char === " " ? "SP" : leaf.char ?? "";
        ctx.fillStyle = isHL ? colors.heading : colors.text;
        ctx.font = `bold ${11 * dpr}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(displayChar, x, y - 5 * dpr);
        ctx.fillStyle = colors.textMuted;
        ctx.font = `${9 * dpr}px monospace`;
        ctx.fillText(`${leaf.freq}`, x, y + 8 * dpr);
      });
      return;
    }

    if (treeToShow) {
      const layoutRoot = layoutHuffmanTree(
        treeToShow,
        canvas.width / dpr,
        canvas.height / dpr,
      );
      // Scale layout to canvas coords (multiply by dpr)
      function scaleLayout(ln: LayoutNode): LayoutNode {
        return {
          ...ln,
          x: ln.x * dpr,
          y: ln.y * dpr,
          left: ln.left ? scaleLayout(ln.left) : null,
          right: ln.right ? scaleLayout(ln.right) : null,
        };
      }
      const scaled = scaleLayout(layoutRoot);
      drawHuffmanTree(
        ctx,
        scaled,
        colors,
        new Set(step.highlightNodes),
        dpr,
      );
    }
  }, [algorithm, steps, currentStep]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  // Resize observer for canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => drawCanvas());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [drawCanvas]);

  // Step navigation
  const goFirst = () => {
    setCurrentStep(0);
    setIsPlaying(false);
  };
  const goPrev = () => {
    setCurrentStep((p) => Math.max(0, p - 1));
    setIsPlaying(false);
  };
  const goNext = () => {
    setCurrentStep((p) => Math.min(steps.length - 1, p + 1));
    setIsPlaying(false);
  };
  const goLast = () => {
    setCurrentStep(steps.length - 1);
    setIsPlaying(false);
  };
  const togglePlay = () => setIsPlaying((p) => !p);

  // Current step data
  const step = steps[currentStep];
  const text = inputText.slice(0, MAX_INPUT_LENGTH);

  // Stats
  const stats: CompressionResult | null = useMemo(() => {
    if (!step || text.length === 0) return null;
    switch (algorithm) {
      case "huffman":
        return computeHuffmanStats(text, step as HuffmanStep);
      case "lzw":
        return computeLzwStats(text, step as LzwStep);
      case "rle":
        return computeRleStats(text, step as RleStep);
    }
  }, [algorithm, step, text]);

  return (
    <div class="space-y-4">
      {/* Controls Row */}
      <div
        class="rounded-lg border p-4"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-surface)",
        }}
      >
        <div class="flex flex-wrap items-end gap-4">
          {/* Algorithm selector */}
          <div class="flex flex-col gap-1">
            <label
              class="text-xs font-medium"
              style={{ color: "var(--color-text-muted)" }}
            >
              Algorithm
            </label>
            <div class="flex gap-1">
              {(["huffman", "lzw", "rle"] as AlgorithmId[]).map((alg) => (
                <button
                  key={alg}
                  onClick={() => setAlgorithm(alg)}
                  class="rounded px-3 py-1.5 text-xs font-medium transition-colors"
                  style={{
                    backgroundColor:
                      algorithm === alg
                        ? "var(--color-primary)"
                        : "var(--color-bg)",
                    color:
                      algorithm === alg
                        ? "#ffffff"
                        : "var(--color-text)",
                    border:
                      algorithm === alg
                        ? "1px solid var(--color-primary)"
                        : "1px solid var(--color-border)",
                  }}
                >
                  {alg === "huffman"
                    ? "Huffman"
                    : alg === "lzw"
                      ? "LZW"
                      : "RLE"}
                </button>
              ))}
            </div>
          </div>

          {/* Preset selector */}
          <div class="flex flex-col gap-1">
            <label
              class="text-xs font-medium"
              style={{ color: "var(--color-text-muted)" }}
            >
              Preset
            </label>
            <select
              class="rounded border px-2 py-1.5 text-xs"
              style={{
                backgroundColor: "var(--color-bg)",
                color: "var(--color-text)",
                borderColor: "var(--color-border)",
              }}
              onChange={(e) => {
                const preset = TEXT_PRESETS.find(
                  (p) => p.id === (e.target as HTMLSelectElement).value,
                );
                if (preset) setInputText(preset.text);
              }}
            >
              <option value="">Custom</option>
              {TEXT_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Speed slider */}
          <div class="flex flex-col gap-1">
            <label
              class="text-xs font-medium"
              style={{ color: "var(--color-text-muted)" }}
            >
              Speed: {speed}ms
            </label>
            <input
              type="range"
              min={50}
              max={2000}
              step={50}
              value={speed}
              onInput={(e) =>
                setSpeed(Number((e.target as HTMLInputElement).value))
              }
              class="w-24"
              style={{ accentColor: "var(--color-primary)" }}
            />
          </div>
        </div>

        {/* Input text */}
        <div class="mt-3">
          <label
            class="mb-1 block text-xs font-medium"
            style={{ color: "var(--color-text-muted)" }}
          >
            Input Text ({text.length}/{MAX_INPUT_LENGTH})
          </label>
          <textarea
            value={inputText}
            onInput={(e) =>
              setInputText((e.target as HTMLTextAreaElement).value)
            }
            maxLength={MAX_INPUT_LENGTH}
            rows={2}
            class="w-full rounded border px-3 py-2 font-mono text-sm"
            style={{
              backgroundColor: "var(--color-bg)",
              color: "var(--color-text)",
              borderColor: "var(--color-border)",
              resize: "none",
            }}
            spellcheck={false}
          />
        </div>
      </div>

      {/* Step Controls */}
      {steps.length > 0 && (
        <div
          class="flex flex-wrap items-center gap-2 rounded-lg border p-3"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-surface)",
          }}
        >
          <button onClick={goFirst} class="step-btn" title="First step">
            {"⏮"}
          </button>
          <button onClick={goPrev} class="step-btn" title="Previous step">
            {"◀"}
          </button>
          <button
            onClick={togglePlay}
            class="step-btn"
            style={{
              backgroundColor: isPlaying
                ? "var(--color-accent)"
                : "var(--color-primary)",
              color: "#ffffff",
              minWidth: "60px",
            }}
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button onClick={goNext} class="step-btn" title="Next step">
            {"▶"}
          </button>
          <button onClick={goLast} class="step-btn" title="Last step">
            {"⏭"}
          </button>

          <span
            class="ml-2 text-xs font-mono"
            style={{ color: "var(--color-text-muted)" }}
          >
            Step {currentStep + 1} / {steps.length}
          </span>

          {/* Progress bar */}
          <div
            class="ml-auto hidden h-1.5 flex-1 overflow-hidden rounded-full sm:block"
            style={{ backgroundColor: "var(--color-bg)", minWidth: "80px" }}
          >
            <div
              class="h-full rounded-full transition-all duration-200"
              style={{
                backgroundColor: "var(--color-primary)",
                width: `${((currentStep + 1) / steps.length) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Step Description */}
      {step && (
        <div
          class="rounded-lg border px-4 py-3"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-bg)",
          }}
        >
          <p
            class="font-mono text-sm"
            style={{ color: "var(--color-text)" }}
          >
            {step.description}
          </p>
        </div>
      )}

      {/* Main Visualization Area */}
      <div class="grid gap-4 lg:grid-cols-2">
        {/* Left: Algorithm-specific visualization */}
        <div
          class="rounded-lg border"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-surface)",
          }}
        >
          {algorithm === "huffman" && (
            <HuffmanView
              step={step as HuffmanStep | undefined}
              input={text}
              canvasRef={canvasRef}
            />
          )}
          {algorithm === "lzw" && (
            <LzwView step={step as LzwStep | undefined} input={text} />
          )}
          {algorithm === "rle" && (
            <RleView step={step as RleStep | undefined} input={text} />
          )}
        </div>

        {/* Right: Statistics + details */}
        <div class="space-y-4">
          {/* Statistics */}
          {stats && stats.compressedBits > 0 && (
            <StatsPanel stats={stats} />
          )}

          {/* Code Table (Huffman) */}
          {algorithm === "huffman" && step && (
            <HuffmanCodeTable step={step as HuffmanStep} />
          )}

          {/* Input highlight */}
          {step && (
            <InputHighlight
              input={text}
              step={step}
              algorithm={algorithm}
            />
          )}

          {/* Bit-level view (Huffman) */}
          {algorithm === "huffman" &&
            step &&
            (step as HuffmanStep).encodedSoFar.length > 0 && (
              <BitView encoded={(step as HuffmanStep).encodedSoFar} />
            )}
        </div>
      </div>

      {/* Inline styles for step buttons */}
      <style>{`
        .step-btn {
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          border: 1px solid var(--color-border);
          background: var(--color-bg);
          color: var(--color-text);
          cursor: pointer;
          transition: background-color 0.15s, border-color 0.15s;
        }
        .step-btn:hover {
          border-color: var(--color-primary);
          background: color-mix(in srgb, var(--color-primary) 15%, var(--color-bg));
        }
      `}</style>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Sub-components
   ══════════════════════════════════════════════════════════ */

function HuffmanView({
  step,
  input,
  canvasRef,
}: {
  step: HuffmanStep | undefined;
  input: string;
  canvasRef: { current: HTMLCanvasElement | null };
}) {
  if (!step) return <EmptyState />;

  // Frequency table for early steps
  if (step.kind === "freq-table") {
    return (
      <div class="p-4">
        <h3
          class="mb-3 text-sm font-semibold"
          style={{ color: "var(--color-heading)" }}
        >
          Frequency Table
        </h3>
        <div class="overflow-x-auto">
          <table class="w-full text-xs" style={{ color: "var(--color-text)" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                <th class="px-3 py-2 text-left" style={{ color: "var(--color-text-muted)" }}>
                  Char
                </th>
                <th class="px-3 py-2 text-right" style={{ color: "var(--color-text-muted)" }}>
                  Freq
                </th>
                <th class="px-3 py-2 text-right" style={{ color: "var(--color-text-muted)" }}>
                  Probability
                </th>
              </tr>
            </thead>
            <tbody>
              {Array.from(step.freqTable.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([ch, freq]) => (
                  <tr
                    key={ch}
                    style={{
                      borderBottom: "1px solid var(--color-border)",
                    }}
                  >
                    <td class="px-3 py-1.5 font-mono">
                      {ch === " " ? "SP" : ch}
                    </td>
                    <td class="px-3 py-1.5 text-right">{freq}</td>
                    <td class="px-3 py-1.5 text-right">
                      {((freq / input.length) * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Tree visualization for all other steps
  return (
    <div class="p-4">
      <h3
        class="mb-2 text-sm font-semibold"
        style={{ color: "var(--color-heading)" }}
      >
        Huffman Tree
        {step.queue.length > 0 && (
          <span
            class="ml-2 font-normal text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            (Queue: {step.queue.length} nodes)
          </span>
        )}
      </h3>
      <canvas
        ref={canvasRef}
        class="w-full rounded"
        style={{
          height: "280px",
          backgroundColor: "var(--color-bg)",
          border: "1px solid var(--color-border)",
        }}
      />
    </div>
  );
}

function LzwView({
  step,
  input,
}: {
  step: LzwStep | undefined;
  input: string;
}) {
  if (!step) return <EmptyState />;

  return (
    <div class="p-4">
      <h3
        class="mb-3 text-sm font-semibold"
        style={{ color: "var(--color-heading)" }}
      >
        LZW Dictionary
        <span
          class="ml-2 font-normal text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          ({step.dictionary.length} entries)
        </span>
      </h3>
      <div
        class="overflow-y-auto overflow-x-auto rounded"
        style={{
          maxHeight: "340px",
          backgroundColor: "var(--color-bg)",
          border: "1px solid var(--color-border)",
        }}
      >
        <table class="w-full text-xs" style={{ color: "var(--color-text)" }}>
          <thead
            class="sticky top-0"
            style={{ backgroundColor: "var(--color-surface)" }}
          >
            <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
              <th
                class="px-3 py-2 text-left"
                style={{ color: "var(--color-text-muted)" }}
              >
                Code
              </th>
              <th
                class="px-3 py-2 text-left"
                style={{ color: "var(--color-text-muted)" }}
              >
                Sequence
              </th>
            </tr>
          </thead>
          <tbody>
            {step.dictionary.map((entry) => (
              <tr
                key={entry.index}
                style={{
                  borderBottom: "1px solid var(--color-border)",
                  backgroundColor:
                    entry.index === step.highlightEntry
                      ? "color-mix(in srgb, var(--color-primary) 20%, transparent)"
                      : "transparent",
                }}
              >
                <td class="px-3 py-1 font-mono">{entry.index}</td>
                <td class="px-3 py-1 font-mono">
                  {entry.sequence.replace(/ /g, "\u2423")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Output codes */}
      {step.outputCodes.length > 0 && (
        <div class="mt-3">
          <h4
            class="mb-1 text-xs font-semibold"
            style={{ color: "var(--color-text-muted)" }}
          >
            Output Codes
          </h4>
          <div
            class="flex flex-wrap gap-1 rounded p-2 font-mono text-xs"
            style={{
              backgroundColor: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              color: "var(--color-accent)",
            }}
          >
            {step.outputCodes.map((code, i) => (
              <span
                key={i}
                class="rounded px-1.5 py-0.5"
                style={{
                  backgroundColor:
                    i === step.outputCodes.length - 1
                      ? "color-mix(in srgb, var(--color-accent) 20%, transparent)"
                      : "transparent",
                }}
              >
                {code}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RleView({
  step,
  input,
}: {
  step: RleStep | undefined;
  input: string;
}) {
  if (!step) return <EmptyState />;

  return (
    <div class="p-4">
      <h3
        class="mb-3 text-sm font-semibold"
        style={{ color: "var(--color-heading)" }}
      >
        Run-Length Encoding
      </h3>

      {/* Visual blocks */}
      <div
        class="mb-4 flex flex-wrap gap-1 rounded p-3"
        style={{
          backgroundColor: "var(--color-bg)",
          border: "1px solid var(--color-border)",
        }}
      >
        {input.split("").map((ch, i) => {
          const inRange =
            i >= step.highlightRange[0] && i <= step.highlightRange[1];
          return (
            <span
              key={i}
              class="inline-flex h-8 w-8 items-center justify-center rounded font-mono text-xs font-medium transition-colors"
              style={{
                backgroundColor: inRange
                  ? "var(--color-primary)"
                  : "var(--color-surface)",
                color: inRange ? "#ffffff" : "var(--color-text)",
                border: `1px solid ${inRange ? "var(--color-primary)" : "var(--color-border)"}`,
              }}
            >
              {ch === " " ? "\u2423" : ch}
            </span>
          );
        })}
      </div>

      {/* Current run info */}
      {step.kind === "scan" && (
        <div
          class="mb-4 rounded px-3 py-2 text-xs"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--color-primary) 10%, var(--color-bg))",
            border: "1px solid var(--color-border)",
            color: "var(--color-text)",
          }}
        >
          Current: <span class="font-mono font-bold">{step.currentChar === " " ? "SP" : step.currentChar}</span>{" "}
          x{step.currentCount}
        </div>
      )}

      {/* Completed runs */}
      {step.runs.length > 0 && (
        <div>
          <h4
            class="mb-2 text-xs font-semibold"
            style={{ color: "var(--color-text-muted)" }}
          >
            Encoded Runs
          </h4>
          <div class="flex flex-wrap gap-1">
            {step.runs.map((run, i) => (
              <span
                key={i}
                class="inline-flex items-center gap-0.5 rounded px-2 py-1 font-mono text-xs"
                style={{
                  backgroundColor: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text)",
                }}
              >
                <span style={{ color: "var(--color-accent)" }}>{run.count}</span>
                <span>{run.char === " " ? "\u2423" : run.char}</span>
              </span>
            ))}
          </div>

          {/* Encoded string */}
          <div
            class="mt-2 rounded px-3 py-2 font-mono text-xs"
            style={{
              backgroundColor: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              color: "var(--color-accent)",
            }}
          >
            {step.runs.map((r) => `${r.count}${r.char}`).join("")}
          </div>
        </div>
      )}
    </div>
  );
}

function HuffmanCodeTable({ step }: { step: HuffmanStep }) {
  if (step.codes.size === 0) return null;

  const entries = Array.from(step.codes.entries()).sort(
    (a, b) => a[1].length - b[1].length,
  );

  return (
    <div
      class="rounded-lg border"
      style={{
        borderColor: "var(--color-border)",
        backgroundColor: "var(--color-surface)",
      }}
    >
      <div class="p-4">
        <h3
          class="mb-3 text-sm font-semibold"
          style={{ color: "var(--color-heading)" }}
        >
          Code Assignments
        </h3>
        <div
          class="overflow-y-auto rounded"
          style={{
            maxHeight: "200px",
            backgroundColor: "var(--color-bg)",
            border: "1px solid var(--color-border)",
          }}
        >
          <table class="w-full text-xs" style={{ color: "var(--color-text)" }}>
            <thead
              class="sticky top-0"
              style={{ backgroundColor: "var(--color-surface)" }}
            >
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                <th
                  class="px-3 py-2 text-left"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Char
                </th>
                <th
                  class="px-3 py-2 text-left"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Code
                </th>
                <th
                  class="px-3 py-2 text-right"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Bits
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([ch, code]) => (
                <tr
                  key={ch}
                  style={{ borderBottom: "1px solid var(--color-border)" }}
                >
                  <td class="px-3 py-1 font-mono font-medium">
                    {ch === " " ? "SP" : ch}
                  </td>
                  <td
                    class="px-3 py-1 font-mono"
                    style={{ color: "var(--color-accent)" }}
                  >
                    {code}
                  </td>
                  <td class="px-3 py-1 text-right">{code.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatsPanel({ stats }: { stats: CompressionResult }) {
  const ratioPercent = (stats.ratio * 100).toFixed(1);
  const savings = (100 - stats.ratio * 100).toFixed(1);
  const isExpansion = stats.ratio > 1;

  return (
    <div
      class="rounded-lg border p-4"
      style={{
        borderColor: "var(--color-border)",
        backgroundColor: "var(--color-surface)",
      }}
    >
      <h3
        class="mb-3 text-sm font-semibold"
        style={{ color: "var(--color-heading)" }}
      >
        Statistics
      </h3>
      <div class="grid grid-cols-2 gap-3">
        <StatItem label="Original" value={`${stats.originalBits} bits`} />
        <StatItem label="Compressed" value={`${stats.compressedBits} bits`} />
        <StatItem
          label="Ratio"
          value={`${ratioPercent}%`}
          highlight={!isExpansion}
        />
        <StatItem
          label={isExpansion ? "Expansion" : "Savings"}
          value={isExpansion ? `+${(stats.ratio * 100 - 100).toFixed(1)}%` : `${savings}%`}
          highlight={!isExpansion}
        />
        <StatItem
          label="Bits/Char"
          value={stats.bitsPerChar.toFixed(2)}
        />
        <StatItem label="Original Bits/Char" value="8.00" />
      </div>

      {/* Visual ratio bar */}
      <div class="mt-3">
        <div
          class="flex h-4 overflow-hidden rounded-full"
          style={{ backgroundColor: "var(--color-bg)" }}
        >
          <div
            class="h-full rounded-full transition-all duration-500"
            style={{
              backgroundColor: isExpansion
                ? "#ef4444"
                : "var(--color-accent)",
              width: `${Math.min(100, parseFloat(ratioPercent))}%`,
            }}
          />
        </div>
        <div
          class="mt-1 flex justify-between text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          <span>0%</span>
          <span>100% (original)</span>
        </div>
      </div>
    </div>
  );
}

function StatItem({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div class="text-xs" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </div>
      <div
        class="font-mono text-sm font-semibold"
        style={{
          color: highlight ? "var(--color-accent)" : "var(--color-heading)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function InputHighlight({
  input,
  step,
  algorithm,
}: {
  input: string;
  step: HuffmanStep | LzwStep | RleStep;
  algorithm: AlgorithmId;
}) {
  let hlStart = -1;
  let hlEnd = -1;

  if (algorithm === "huffman") {
    const hs = step as HuffmanStep;
    if (hs.currentCharIndex >= 0) {
      hlStart = hs.currentCharIndex;
      hlEnd = hs.currentCharIndex;
    }
  } else if (algorithm === "lzw") {
    const ls = step as LzwStep;
    hlStart = ls.highlightRange[0];
    hlEnd = ls.highlightRange[1];
  } else {
    const rs = step as RleStep;
    hlStart = rs.highlightRange[0];
    hlEnd = rs.highlightRange[1];
  }

  return (
    <div
      class="rounded-lg border p-4"
      style={{
        borderColor: "var(--color-border)",
        backgroundColor: "var(--color-surface)",
      }}
    >
      <h3
        class="mb-2 text-sm font-semibold"
        style={{ color: "var(--color-heading)" }}
      >
        Input
      </h3>
      <div
        class="flex flex-wrap gap-0.5 rounded p-2 font-mono text-xs"
        style={{
          backgroundColor: "var(--color-bg)",
          border: "1px solid var(--color-border)",
        }}
      >
        {input.split("").map((ch, i) => {
          const inRange = i >= hlStart && i <= hlEnd && hlStart >= 0;
          return (
            <span
              key={i}
              class="inline-block rounded px-1 py-0.5 transition-colors"
              style={{
                backgroundColor: inRange
                  ? "color-mix(in srgb, var(--color-primary) 30%, transparent)"
                  : "transparent",
                color: inRange ? "var(--color-heading)" : "var(--color-text-muted)",
                border: inRange ? "1px solid var(--color-primary)" : "1px solid transparent",
              }}
            >
              {ch === " " ? "\u2423" : ch}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function BitView({ encoded }: { encoded: string }) {
  // Group into bytes
  const bytes: string[] = [];
  for (let i = 0; i < encoded.length; i += 8) {
    bytes.push(encoded.slice(i, i + 8));
  }

  return (
    <div
      class="rounded-lg border p-4"
      style={{
        borderColor: "var(--color-border)",
        backgroundColor: "var(--color-surface)",
      }}
    >
      <h3
        class="mb-2 text-sm font-semibold"
        style={{ color: "var(--color-heading)" }}
      >
        Bit Output
        <span
          class="ml-2 text-xs font-normal"
          style={{ color: "var(--color-text-muted)" }}
        >
          ({encoded.length} bits)
        </span>
      </h3>
      <div
        class="overflow-x-auto rounded p-2 font-mono text-xs"
        style={{
          backgroundColor: "var(--color-bg)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div class="flex flex-wrap gap-2">
          {bytes.map((byte, i) => (
            <span key={i}>
              {byte.split("").map((bit, j) => (
                <span
                  key={j}
                  style={{
                    color:
                      bit === "1"
                        ? "var(--color-accent)"
                        : "var(--color-text-muted)",
                  }}
                >
                  {bit}
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      class="flex items-center justify-center p-12"
      style={{ color: "var(--color-text-muted)" }}
    >
      <p class="text-sm">Enter text to start compression visualization.</p>
    </div>
  );
}
