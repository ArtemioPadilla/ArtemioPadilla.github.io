import { useState, useRef, useCallback, useEffect } from "preact/hooks";
import type { JSX } from "preact";
import {
  tokenize,
  buildVocabulary,
  generateSkipGrams,
  createModel,
  trainEpoch,
  findMostSimilar,
  solveAnalogy,
  getEmbeddingMatrix,
  computeKNNGraph,
  cosineSimilarity,
} from "./word2vec";
import type {
  Word2VecModel,
  Vocabulary,
  SkipGramPair,
  SimilarWord,
} from "./word2vec";
import { projectTo2D } from "./pca";
import { CORPORA } from "./corpora";

// -----------------------------------------------------------------
// Constants
// -----------------------------------------------------------------

const WORD_COLORS = [
  "#4f8ff7", "#34d399", "#f59e0b", "#ef4444", "#a855f7",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
];

const EMB_DIM_OPTIONS = [8, 16, 32] as const;
const WINDOW_SIZE_OPTIONS = [2, 3, 4, 5] as const;
const NEGATIVES_OPTIONS = [5, 7, 10] as const;

const DEFAULT_EMB_DIM = 16;
const DEFAULT_WINDOW_SIZE = 3;
const DEFAULT_LEARNING_RATE = 0.025;
const DEFAULT_EPOCHS = 50;
const DEFAULT_NEGATIVES = 5;
const DEFAULT_KNN_K = 3;

type Tab = "viz" | "analogy" | "similarity";

// -----------------------------------------------------------------
// Canvas helpers
// -----------------------------------------------------------------

function getCanvasColors(canvas: HTMLCanvasElement): {
  text: string;
  textMuted: string;
  border: string;
  surface: string;
  primary: string;
} {
  const cs = getComputedStyle(canvas);
  return {
    text: cs.getPropertyValue("--color-text").trim() || "#e4e4e7",
    textMuted: cs.getPropertyValue("--color-text-muted").trim() || "#a1a1aa",
    border: cs.getPropertyValue("--color-border").trim() || "#27272a",
    surface: cs.getPropertyValue("--color-surface").trim() || "#111111",
    primary: cs.getPropertyValue("--color-primary").trim() || "#4f8ff7",
  };
}

// -----------------------------------------------------------------
// Sub-components
// -----------------------------------------------------------------

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      class={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
        active
          ? "bg-[var(--color-primary)] text-white"
          : "border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      }`}
    >
      {label}
    </button>
  );
}

function ControlSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
      <span>
        {label}: <strong class="text-[var(--color-text)]">{value}</strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
        class="h-1.5 w-full cursor-pointer accent-[var(--color-primary)]"
      />
    </label>
  );
}

function SelectControl<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
      <span>{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange((typeof value === "number" ? Number((e.target as HTMLSelectElement).value) : (e.target as HTMLSelectElement).value) as T)}
        class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)]"
      >
        {options.map((opt) => (
          <option key={String(opt)} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  );
}

function SimilarWordRow({
  word,
  similarity,
  rank,
}: {
  word: string;
  similarity: number;
  rank: number;
}): JSX.Element {
  const barWidth = Math.max(0, Math.min(100, ((similarity + 1) / 2) * 100));
  return (
    <div class="flex items-center gap-2 text-xs">
      <span class="w-4 text-right text-[var(--color-text-muted)]">{rank}</span>
      <span class="min-w-[60px] font-mono text-[var(--color-heading)]">{word}</span>
      <div class="flex-1">
        <div
          class="h-1.5 rounded-full bg-[var(--color-primary)]"
          style={{ width: `${barWidth}%`, opacity: 0.5 + similarity * 0.5 }}
        />
      </div>
      <span class="w-12 text-right font-mono text-[var(--color-text-muted)]">
        {similarity.toFixed(3)}
      </span>
    </div>
  );
}

// -----------------------------------------------------------------
// Loss chart
// -----------------------------------------------------------------

function LossChart({
  losses,
  width,
  height,
}: {
  losses: number[];
  width: number;
  height: number;
}): JSX.Element {
  if (losses.length < 2) return <div />;

  const maxLoss = Math.max(...losses);
  const minLoss = Math.min(...losses);
  const range = maxLoss - minLoss || 1;

  const points = losses
    .map((l, i) => {
      const x = (i / (losses.length - 1)) * width;
      const y = height - ((l - minLoss) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} class="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke="var(--color-primary)"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

// -----------------------------------------------------------------
// Main Component
// -----------------------------------------------------------------

export default function WordEmbeddings(): JSX.Element {
  // Corpus selection
  const [corpusIdx, setCorpusIdx] = useState(0);
  const [customText, setCustomText] = useState("");
  const [useCustom, setUseCustom] = useState(false);

  // Hyperparameters
  const [embDim, setEmbDim] = useState<number>(DEFAULT_EMB_DIM);
  const [windowSize, setWindowSize] = useState<number>(DEFAULT_WINDOW_SIZE);
  const [learningRate, setLearningRate] = useState(DEFAULT_LEARNING_RATE);
  const [epochs, setEpochs] = useState(DEFAULT_EPOCHS);
  const [numNegatives, setNumNegatives] = useState<number>(DEFAULT_NEGATIVES);

  // Training state
  const [model, setModel] = useState<Word2VecModel | null>(null);
  const [vocab, setVocab] = useState<Vocabulary | null>(null);
  const [pairs, setPairs] = useState<SkipGramPair[]>([]);
  const [isTraining, setIsTraining] = useState(false);
  const [currentEpoch, setCurrentEpoch] = useState(0);
  const [losses, setLosses] = useState<number[]>([]);

  // Visualization state
  const [projected, setProjected] = useState<number[][] | null>(null);
  const [showKNN, setShowKNN] = useState(false);
  const [knnK, setKnnK] = useState(DEFAULT_KNN_K);
  const [knnGraph, setKnnGraph] = useState<number[][] | null>(null);

  // Pan & zoom
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });

  // UI tabs
  const [activeTab, setActiveTab] = useState<Tab>("viz");

  // Analogy inputs
  const [analogyA, setAnalogyA] = useState("");
  const [analogyB, setAnalogyB] = useState("");
  const [analogyC, setAnalogyC] = useState("");
  const [analogyResults, setAnalogyResults] = useState<SimilarWord[]>([]);
  const [analogyError, setAnalogyError] = useState("");

  // Similarity search
  const [simWord, setSimWord] = useState("");
  const [simResults, setSimResults] = useState<SimilarWord[]>([]);
  const [simError, setSimError] = useState("");

  // Canvas ref
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trainingRef = useRef(false);

  // -----------------------------------------------------------------
  // Build vocabulary and pairs
  // -----------------------------------------------------------------

  const prepareData = useCallback(() => {
    const text = useCustom ? customText : CORPORA[corpusIdx].text;
    if (!text.trim()) return;

    const tokens = tokenize(text);
    if (tokens.length < 5) return;

    const newVocab = buildVocabulary(tokens, 2);
    if (newVocab.size < 3) return;

    const newPairs = generateSkipGrams(tokens, newVocab, windowSize);
    const newModel = createModel(newVocab, embDim);

    setVocab(newVocab);
    setPairs(newPairs);
    setModel(newModel);
    setCurrentEpoch(0);
    setLosses([]);
    setProjected(null);
    setKnnGraph(null);
    setAnalogyResults([]);
    setSimResults([]);
    setAnalogyError("");
    setSimError("");
    setPanOffset({ x: 0, y: 0 });
    setZoom(1);
  }, [corpusIdx, customText, useCustom, windowSize, embDim]);

  // Auto-prepare on first render or when corpus/params change
  useEffect(() => {
    prepareData();
  }, [prepareData]);

  // -----------------------------------------------------------------
  // Training loop
  // -----------------------------------------------------------------

  const startTraining = useCallback(() => {
    if (!model || !pairs.length || isTraining) return;

    setIsTraining(true);
    trainingRef.current = true;
    let epoch = currentEpoch;
    const lossHistory = [...losses];

    const step = () => {
      if (!trainingRef.current || epoch >= epochs) {
        setIsTraining(false);
        trainingRef.current = false;
        // Final projection
        if (model) {
          const matrix = getEmbeddingMatrix(model);
          const { projected: proj } = projectTo2D(matrix);
          setProjected(proj);
          if (showKNN) {
            setKnnGraph(computeKNNGraph(model, knnK));
          }
        }
        return;
      }

      const result = trainEpoch(model, pairs, learningRate, numNegatives);
      epoch++;
      lossHistory.push(result.loss);

      setCurrentEpoch(epoch);
      setLosses([...lossHistory]);

      // Update projection every few epochs for visual feedback
      if (epoch % 3 === 0 || epoch === epochs) {
        const matrix = getEmbeddingMatrix(model);
        const { projected: proj } = projectTo2D(matrix);
        setProjected(proj);
        if (showKNN) {
          setKnnGraph(computeKNNGraph(model, knnK));
        }
      }

      requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  }, [model, pairs, isTraining, currentEpoch, losses, epochs, learningRate, numNegatives, showKNN, knnK]);

  const stopTraining = useCallback(() => {
    trainingRef.current = false;
    setIsTraining(false);
  }, []);

  const resetTraining = useCallback(() => {
    trainingRef.current = false;
    setIsTraining(false);
    prepareData();
  }, [prepareData]);

  // -----------------------------------------------------------------
  // Canvas rendering
  // -----------------------------------------------------------------

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !projected || !vocab) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const colors = getCanvasColors(canvas);

    // Clear
    ctx.fillStyle = colors.surface;
    ctx.fillRect(0, 0, w, h);

    // Border
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

    if (projected.length === 0) return;

    // Compute bounding box of projected points
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [px, py] of projected) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const padding = 50;

    const toScreenX = (x: number) =>
      ((x - minX) / rangeX) * (w - 2 * padding) * zoom + padding + panOffset.x;
    const toScreenY = (y: number) =>
      ((y - minY) / rangeY) * (h - 2 * padding) * zoom + padding + panOffset.y;

    // Draw KNN lines
    if (showKNN && knnGraph) {
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 0.5;
      ctx.globalAlpha = 0.3;
      for (let i = 0; i < knnGraph.length; i++) {
        const sx = toScreenX(projected[i][0]);
        const sy = toScreenY(projected[i][1]);
        for (const j of knnGraph[i]) {
          const ex = toScreenX(projected[j][0]);
          const ey = toScreenY(projected[j][1]);
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(ex, ey);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    // Draw points and labels
    const entries = vocab.entries;
    const maxCount = Math.max(...entries.map((e) => e.count));

    for (let i = 0; i < projected.length; i++) {
      const sx = toScreenX(projected[i][0]);
      const sy = toScreenY(projected[i][1]);

      // Skip if out of visible area
      if (sx < -50 || sx > w + 50 || sy < -50 || sy > h + 50) continue;

      const entry = entries[i];
      const colorIdx = i % WORD_COLORS.length;
      const radius = 3 + (entry.count / maxCount) * 4;

      // Point
      ctx.fillStyle = WORD_COLORS[colorIdx];
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.fill();

      // Label
      const fontSize = Math.max(9, Math.min(12, 9 + (entry.count / maxCount) * 3));
      ctx.font = `${fontSize}px var(--font-mono, monospace)`;
      ctx.fillStyle = colors.text;
      ctx.textAlign = "center";
      ctx.fillText(entry.word, sx, sy - radius - 3);
    }

    // Info text
    ctx.font = "10px var(--font-sans, sans-serif)";
    ctx.fillStyle = colors.textMuted;
    ctx.textAlign = "left";
    ctx.fillText(
      `${vocab.size} words | Epoch ${currentEpoch}/${epochs}`,
      8,
      h - 8,
    );
  }, [projected, vocab, showKNN, knnGraph, panOffset, zoom, currentEpoch, epochs]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  // Redraw on resize
  useEffect(() => {
    const handleResize = () => drawCanvas();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [drawCanvas]);

  // -----------------------------------------------------------------
  // Pan & zoom handlers
  // -----------------------------------------------------------------

  const handleMouseDown = useCallback((e: MouseEvent) => {
    isPanning.current = true;
    panStart.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
  }, [panOffset]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isPanning.current) return;
    setPanOffset({
      x: e.clientX - panStart.current.x,
      y: e.clientY - panStart.current.y,
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.max(0.2, Math.min(5, z * delta)));
  }, []);

  // -----------------------------------------------------------------
  // Analogy solver
  // -----------------------------------------------------------------

  const handleAnalogy = useCallback(() => {
    if (!model || !vocab) return;
    setAnalogyError("");

    const aIdx = vocab.wordToIndex.get(analogyA.toLowerCase().trim());
    const bIdx = vocab.wordToIndex.get(analogyB.toLowerCase().trim());
    const cIdx = vocab.wordToIndex.get(analogyC.toLowerCase().trim());

    if (aIdx === undefined) {
      setAnalogyError(`"${analogyA}" not in vocabulary`);
      return;
    }
    if (bIdx === undefined) {
      setAnalogyError(`"${analogyB}" not in vocabulary`);
      return;
    }
    if (cIdx === undefined) {
      setAnalogyError(`"${analogyC}" not in vocabulary`);
      return;
    }

    const results = solveAnalogy(model, aIdx, bIdx, cIdx, 5);
    setAnalogyResults(results);
  }, [model, vocab, analogyA, analogyB, analogyC]);

  // -----------------------------------------------------------------
  // Similarity search
  // -----------------------------------------------------------------

  const handleSimilaritySearch = useCallback(() => {
    if (!model || !vocab) return;
    setSimError("");

    const idx = vocab.wordToIndex.get(simWord.toLowerCase().trim());
    if (idx === undefined) {
      setSimError(`"${simWord}" not in vocabulary`);
      return;
    }

    const results = findMostSimilar(model, idx, 10);
    setSimResults(results);
  }, [model, vocab, simWord]);

  // -----------------------------------------------------------------
  // Toggle KNN
  // -----------------------------------------------------------------

  const handleToggleKNN = useCallback(() => {
    const next = !showKNN;
    setShowKNN(next);
    if (next && model) {
      setKnnGraph(computeKNNGraph(model, knnK));
    } else {
      setKnnGraph(null);
    }
  }, [showKNN, model, knnK]);

  const handleKnnKChange = useCallback(
    (k: number) => {
      setKnnK(k);
      if (showKNN && model) {
        setKnnGraph(computeKNNGraph(model, k));
      }
    },
    [showKNN, model],
  );

  // -----------------------------------------------------------------
  // Corpus list for select
  // -----------------------------------------------------------------

  const corpusOptions = CORPORA.map((c, i) => ({ label: c.label, value: i }));

  return (
    <div class="space-y-4">
      {/* Controls panel */}
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Corpus selector */}
          <div class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
            <span>Corpus</span>
            <div class="flex gap-2">
              <select
                value={useCustom ? "custom" : String(corpusIdx)}
                disabled={isTraining}
                onChange={(e) => {
                  const val = (e.target as HTMLSelectElement).value;
                  if (val === "custom") {
                    setUseCustom(true);
                  } else {
                    setUseCustom(false);
                    setCorpusIdx(Number(val));
                  }
                }}
                class="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)]"
              >
                {corpusOptions.map((opt) => (
                  <option key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </option>
                ))}
                <option value="custom">Custom Text</option>
              </select>
            </div>
          </div>

          <SelectControl
            label="Embedding Dim"
            value={embDim}
            options={EMB_DIM_OPTIONS}
            onChange={setEmbDim}
            disabled={isTraining}
          />

          <SelectControl
            label="Window Size"
            value={windowSize}
            options={WINDOW_SIZE_OPTIONS}
            onChange={setWindowSize}
            disabled={isTraining}
          />

          <ControlSlider
            label="Learning Rate"
            value={learningRate}
            min={0.001}
            max={0.1}
            step={0.001}
            onChange={setLearningRate}
            disabled={isTraining}
          />

          <ControlSlider
            label="Epochs"
            value={epochs}
            min={10}
            max={200}
            step={10}
            onChange={setEpochs}
            disabled={isTraining}
          />

          <SelectControl
            label="Negative Samples"
            value={numNegatives}
            options={NEGATIVES_OPTIONS}
            onChange={setNumNegatives}
            disabled={isTraining}
          />
        </div>

        {/* Custom text input */}
        {useCustom && (
          <div class="mt-3">
            <textarea
              value={customText}
              disabled={isTraining}
              onInput={(e) => setCustomText((e.target as HTMLTextAreaElement).value)}
              placeholder="Paste or type your corpus text here (at least a few sentences)..."
              class="h-28 w-full resize-y rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 font-mono text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)]"
            />
          </div>
        )}

        {/* Action buttons */}
        <div class="mt-4 flex flex-wrap items-center gap-2">
          {!isTraining ? (
            <button
              onClick={startTraining}
              disabled={!model || !pairs.length}
              class="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {currentEpoch > 0 ? "Resume Training" : "Train"}
            </button>
          ) : (
            <button
              onClick={stopTraining}
              class="rounded-lg border border-[var(--color-accent)] px-4 py-2 text-xs font-semibold text-[var(--color-accent)] transition-opacity hover:opacity-80"
            >
              Pause
            </button>
          )}
          <button
            onClick={resetTraining}
            disabled={isTraining}
            class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)] disabled:opacity-40"
          >
            Reset
          </button>

          {/* Stats */}
          {vocab && (
            <span class="ml-auto text-xs text-[var(--color-text-muted)]">
              {vocab.size} words | {pairs.length} skip-gram pairs | Epoch{" "}
              {currentEpoch}/{epochs}
              {losses.length > 0 && ` | Loss: ${losses[losses.length - 1].toFixed(4)}`}
            </span>
          )}
        </div>

        {/* Loss chart */}
        {losses.length > 1 && (
          <div class="mt-3">
            <div class="mb-1 text-[10px] text-[var(--color-text-muted)]">Training Loss</div>
            <div class="rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
              <LossChart losses={losses} width={300} height={60} />
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div class="flex gap-2">
        <TabButton label="2D Visualization" active={activeTab === "viz"} onClick={() => setActiveTab("viz")} />
        <TabButton label="Analogy Solver" active={activeTab === "analogy"} onClick={() => setActiveTab("analogy")} />
        <TabButton label="Similarity Search" active={activeTab === "similarity"} onClick={() => setActiveTab("similarity")} />
      </div>

      {/* Visualization tab */}
      {activeTab === "viz" && (
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div class="mb-3 flex flex-wrap items-center gap-3">
            <label class="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
              <input
                type="checkbox"
                checked={showKNN}
                onChange={handleToggleKNN}
                class="accent-[var(--color-primary)]"
              />
              Show NN Lines
            </label>
            {showKNN && (
              <label class="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                K:
                <select
                  value={knnK}
                  onChange={(e) => handleKnnKChange(Number((e.target as HTMLSelectElement).value))}
                  class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-xs text-[var(--color-text)]"
                >
                  {[1, 2, 3, 4, 5].map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </label>
            )}
            <span class="ml-auto text-[10px] text-[var(--color-text-muted)]">
              Drag to pan, scroll to zoom
            </span>
          </div>

          <canvas
            ref={canvasRef}
            class="h-[400px] w-full cursor-grab rounded border border-[var(--color-border)] active:cursor-grabbing sm:h-[500px]"
            style="touch-action: none"
            onMouseDown={handleMouseDown as any}
            onMouseMove={handleMouseMove as any}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel as any}
          />

          {!projected && (
            <div class="mt-4 text-center text-xs text-[var(--color-text-muted)]">
              Train the model to see word embeddings projected to 2D via PCA.
            </div>
          )}
        </div>
      )}

      {/* Analogy tab */}
      {activeTab === "analogy" && (
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <p class="mb-3 text-xs text-[var(--color-text-muted)]">
            Solve word analogies: A - B + C = ? (e.g., king - man + woman = queen)
          </p>

          <div class="flex flex-wrap items-end gap-2">
            <label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
              <span>A</span>
              <input
                type="text"
                value={analogyA}
                onInput={(e) => setAnalogyA((e.target as HTMLInputElement).value)}
                placeholder="king"
                class="w-24 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-text)]"
              />
            </label>
            <span class="pb-1 text-[var(--color-text-muted)]">-</span>
            <label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
              <span>B</span>
              <input
                type="text"
                value={analogyB}
                onInput={(e) => setAnalogyB((e.target as HTMLInputElement).value)}
                placeholder="man"
                class="w-24 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-text)]"
              />
            </label>
            <span class="pb-1 text-[var(--color-text-muted)]">+</span>
            <label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
              <span>C</span>
              <input
                type="text"
                value={analogyC}
                onInput={(e) => setAnalogyC((e.target as HTMLInputElement).value)}
                placeholder="woman"
                class="w-24 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-text)]"
              />
            </label>
            <span class="pb-1 text-[var(--color-text-muted)]">=</span>
            <button
              onClick={handleAnalogy}
              disabled={!model || currentEpoch === 0}
              class="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Solve
            </button>
          </div>

          {analogyError && (
            <p class="mt-2 text-xs text-red-400">{analogyError}</p>
          )}

          {analogyResults.length > 0 && (
            <div class="mt-4 space-y-1.5">
              <div class="text-xs font-medium text-[var(--color-heading)]">
                Top 5 Results
              </div>
              {analogyResults.map((r, i) => (
                <SimilarWordRow
                  key={r.word}
                  word={r.word}
                  similarity={r.similarity}
                  rank={i + 1}
                />
              ))}
            </div>
          )}

          {!model || currentEpoch === 0 ? (
            <p class="mt-3 text-xs text-[var(--color-text-muted)]">
              Train the model first before solving analogies.
            </p>
          ) : null}
        </div>
      )}

      {/* Similarity tab */}
      {activeTab === "similarity" && (
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <p class="mb-3 text-xs text-[var(--color-text-muted)]">
            Find the most similar words by cosine similarity in the embedding space.
          </p>

          <div class="flex items-end gap-2">
            <label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
              <span>Word</span>
              <input
                type="text"
                value={simWord}
                onInput={(e) => setSimWord((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSimilaritySearch();
                }}
                placeholder="Type a word..."
                class="w-40 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-text)]"
              />
            </label>
            <button
              onClick={handleSimilaritySearch}
              disabled={!model || currentEpoch === 0}
              class="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Search
            </button>
          </div>

          {simError && (
            <p class="mt-2 text-xs text-red-400">{simError}</p>
          )}

          {simResults.length > 0 && (
            <div class="mt-4 space-y-1.5">
              <div class="text-xs font-medium text-[var(--color-heading)]">
                Top 10 Similar Words
              </div>
              {simResults.map((r, i) => (
                <SimilarWordRow
                  key={r.word}
                  word={r.word}
                  similarity={r.similarity}
                  rank={i + 1}
                />
              ))}
            </div>
          )}

          {/* Vocabulary list */}
          {vocab && (
            <div class="mt-4">
              <div class="mb-1 text-xs font-medium text-[var(--color-heading)]">
                Vocabulary ({vocab.size} words)
              </div>
              <div class="max-h-40 overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
                <div class="flex flex-wrap gap-1">
                  {vocab.entries.map((entry) => (
                    <button
                      key={entry.word}
                      onClick={() => {
                        setSimWord(entry.word);
                        if (model && currentEpoch > 0) {
                          const results = findMostSimilar(model, entry.index, 10);
                          setSimResults(results);
                          setSimError("");
                        }
                      }}
                      class="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                    >
                      {entry.word}
                      <span class="ml-0.5 opacity-50">({entry.count})</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {!model || currentEpoch === 0 ? (
            <p class="mt-3 text-xs text-[var(--color-text-muted)]">
              Train the model first to search for similar words.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
