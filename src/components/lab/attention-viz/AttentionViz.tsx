import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";

// -----------------------------------------------------------------
// Types
// -----------------------------------------------------------------

interface AttentionHead {
  wQ: number[][];
  wK: number[][];
  wV: number[][];
}

interface AttentionResult {
  queries: number[][];
  keys: number[][];
  values: number[][];
  scores: number[][];
  output: number[][];
}

type TabId = "heatmap" | "positional" | "embeddings";

// -----------------------------------------------------------------
// Constants
// -----------------------------------------------------------------

const EMBEDDING_DIMS = [16, 32, 64] as const;
const NUM_HEADS = 4;
const DEFAULT_DIM = 32;
const DEFAULT_TEMPERATURE = 1.0;

const PRESET_SENTENCES: { label: string; text: string }[] = [
  { label: "The cat sat on the mat", text: "The cat sat on the mat" },
  { label: "I bank at the river bank", text: "I bank at the river bank" },
  { label: "Time flies like an arrow", text: "Time flies like an arrow" },
  { label: "The quick brown fox jumps", text: "The quick brown fox jumps over the lazy dog" },
  { label: "Attention is all you need", text: "Attention is all you need" },
  { label: "She saw the man with the telescope", text: "She saw the man with the telescope" },
];

// -----------------------------------------------------------------
// Color utilities
// -----------------------------------------------------------------

const HEATMAP_COLORS: [number, number, number][] = [
  [9, 9, 11],       // --color-bg-ish, near-black
  [30, 58, 138],     // deep blue
  [79, 143, 247],    // --color-primary
  [52, 211, 153],    // --color-accent
  [253, 231, 37],    // yellow
];

function interpolateColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const n = HEATMAP_COLORS.length - 1;
  const idx = clamped * n;
  const lower = Math.floor(idx);
  const upper = Math.min(lower + 1, n);
  const f = idx - lower;

  const [r1, g1, b1] = HEATMAP_COLORS[lower];
  const [r2, g2, b2] = HEATMAP_COLORS[upper];

  const r = Math.round(r1 + f * (r2 - r1));
  const g = Math.round(g1 + f * (g2 - g1));
  const b = Math.round(b1 + f * (b2 - b1));

  return `rgb(${r},${g},${b})`;
}

function embeddingColor(value: number): string {
  const t = (value + 1) / 2;
  return interpolateColor(t);
}

// -----------------------------------------------------------------
// Math utilities
// -----------------------------------------------------------------

function randomMatrix(rows: number, cols: number): number[][] {
  const scale = Math.sqrt(2 / (rows + cols));
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => (Math.random() * 2 - 1) * scale)
  );
}

function matMul(a: number[][], b: number[][]): number[][] {
  const rowsA = a.length;
  const colsA = a[0].length;
  const colsB = b[0].length;
  const result: number[][] = Array.from({ length: rowsA }, () =>
    new Array(colsB).fill(0)
  );

  for (let i = 0; i < rowsA; i++) {
    for (let j = 0; j < colsB; j++) {
      let sum = 0;
      for (let k = 0; k < colsA; k++) {
        sum += a[i][k] * b[k][j];
      }
      result[i][j] = sum;
    }
  }
  return result;
}

function transpose(m: number[][]): number[][] {
  if (m.length === 0) return [];
  const rows = m.length;
  const cols = m[0].length;
  const result: number[][] = Array.from({ length: cols }, () =>
    new Array(rows).fill(0)
  );
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      result[j][i] = m[i][j];
    }
  }
  return result;
}

function softmaxRow(row: number[], temperature: number): number[] {
  const scaled = row.map((v) => v / Math.max(temperature, 0.01));
  const maxVal = Math.max(...scaled);
  const exps = scaled.map((v) => Math.exp(v - maxVal));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((v) => v / sum);
}

// -----------------------------------------------------------------
// Tokenizer (whitespace + punctuation)
// -----------------------------------------------------------------

function tokenize(text: string): string[] {
  if (!text.trim()) return [];
  const tokens: string[] = [];
  const regex = /[a-zA-Z0-9]+|[^\s]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}

// -----------------------------------------------------------------
// Positional encoding (sinusoidal)
// -----------------------------------------------------------------

function positionalEncoding(seqLen: number, dModel: number): number[][] {
  const pe: number[][] = [];
  for (let pos = 0; pos < seqLen; pos++) {
    const row: number[] = [];
    for (let i = 0; i < dModel; i++) {
      const angle = pos / Math.pow(10000, (2 * Math.floor(i / 2)) / dModel);
      row.push(i % 2 === 0 ? Math.sin(angle) : Math.cos(angle));
    }
    pe.push(row);
  }
  return pe;
}

// -----------------------------------------------------------------
// Embedding generation (hash-based for reproducibility)
// -----------------------------------------------------------------

function hashCode(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash;
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) / 4294967296);
  };
}

function tokenEmbedding(token: string, dim: number): number[] {
  const rng = seededRandom(hashCode(token.toLowerCase()));
  return Array.from({ length: dim }, () => rng() * 2 - 1);
}

// -----------------------------------------------------------------
// Attention computation
// -----------------------------------------------------------------

function initializeHeads(dModel: number, dHead: number, numHeads: number): AttentionHead[] {
  return Array.from({ length: numHeads }, () => ({
    wQ: randomMatrix(dModel, dHead),
    wK: randomMatrix(dModel, dHead),
    wV: randomMatrix(dModel, dHead),
  }));
}

function computeAttention(
  embeddings: number[][],
  head: AttentionHead,
  temperature: number
): AttentionResult {
  const queries = matMul(embeddings, head.wQ);
  const keys = matMul(embeddings, head.wK);
  const values = matMul(embeddings, head.wV);

  const dK = keys[0]?.length ?? 1;
  const rawScores = matMul(queries, transpose(keys));

  const scores = rawScores.map((row) =>
    softmaxRow(
      row.map((v) => v / Math.sqrt(dK)),
      temperature
    )
  );

  const output = matMul(scores, values);

  return { queries, keys, values, scores, output };
}

// -----------------------------------------------------------------
// Sub-components
// -----------------------------------------------------------------

function HeatmapGrid({
  tokens,
  scores,
  selectedToken,
  onTokenClick,
}: {
  tokens: string[];
  scores: number[][];
  selectedToken: number | null;
  onTokenClick: (idx: number) => void;
}) {
  const n = tokens.length;
  if (n === 0) return null;

  const cellSize = n <= 8 ? 48 : n <= 12 ? 36 : 28;
  const labelWidth = n <= 8 ? 64 : 48;
  const fontSize = n <= 8 ? 11 : n <= 12 ? 10 : 9;

  return (
    <div class="overflow-x-auto">
      <div style={{ display: "inline-block", minWidth: "fit-content" }}>
        {/* Column headers */}
        <div style={{ display: "flex", marginLeft: `${labelWidth}px` }}>
          {tokens.map((tok, j) => (
            <div
              key={`col-${j}`}
              style={{
                width: `${cellSize}px`,
                textAlign: "center",
                fontSize: `${fontSize}px`,
                color: selectedToken === j ? "var(--color-primary)" : "var(--color-text-muted)",
                fontWeight: selectedToken === j ? 700 : 400,
                cursor: "pointer",
                padding: "0 2px 4px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              onClick={() => onTokenClick(j)}
              title={tok}
            >
              {tok}
            </div>
          ))}
        </div>

        {/* Rows */}
        {tokens.map((tok, i) => (
          <div key={`row-${i}`} style={{ display: "flex", alignItems: "center" }}>
            {/* Row label */}
            <div
              style={{
                width: `${labelWidth}px`,
                textAlign: "right",
                paddingRight: "8px",
                fontSize: `${fontSize}px`,
                color: selectedToken === i ? "var(--color-primary)" : "var(--color-text-muted)",
                fontWeight: selectedToken === i ? 700 : 400,
                cursor: "pointer",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              onClick={() => onTokenClick(i)}
              title={tok}
            >
              {tok}
            </div>

            {/* Cells */}
            {scores[i].map((score, j) => {
              const isHighlighted =
                selectedToken !== null && (selectedToken === i || selectedToken === j);
              const opacity = selectedToken !== null && !isHighlighted ? 0.3 : 1;

              return (
                <div
                  key={`cell-${i}-${j}`}
                  style={{
                    width: `${cellSize}px`,
                    height: `${cellSize}px`,
                    backgroundColor: interpolateColor(score),
                    opacity,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: `${Math.max(fontSize - 2, 7)}px`,
                    color: score > 0.5 ? "#09090b" : "#e4e4e7",
                    fontFamily: "var(--font-mono)",
                    cursor: "pointer",
                    border: isHighlighted
                      ? "1px solid var(--color-primary)"
                      : "1px solid transparent",
                    transition: "opacity 0.15s ease",
                  }}
                  onClick={() => onTokenClick(i)}
                  title={`${tok} -> ${tokens[j]}: ${score.toFixed(4)}`}
                >
                  {cellSize >= 36 ? score.toFixed(2) : ""}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Color legend */}
      <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>0</span>
        <div
          style={{
            height: "10px",
            width: "160px",
            borderRadius: "4px",
            background: `linear-gradient(to right, ${interpolateColor(0)}, ${interpolateColor(0.25)}, ${interpolateColor(0.5)}, ${interpolateColor(0.75)}, ${interpolateColor(1)})`,
          }}
        />
        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>1</span>
        <span style={{ fontSize: "10px", color: "var(--color-text-muted)", marginLeft: "4px" }}>
          Attention weight
        </span>
      </div>
    </div>
  );
}

function PositionalEncodingView({ seqLen, dModel }: { seqLen: number; dModel: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const pe = useMemo(() => positionalEncoding(seqLen, dModel), [seqLen, dModel]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const containerWidth = container.clientWidth;
    const cellW = Math.max(4, Math.min(16, Math.floor(containerWidth / dModel)));
    const cellH = Math.max(16, Math.min(28, Math.floor(300 / seqLen)));
    const labelOffset = 50;

    canvas.width = labelOffset + dModel * cellW;
    canvas.height = seqLen * cellH + 24;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw dimension labels at top
    const textColor = getComputedStyle(canvas).getPropertyValue("--color-text-muted").trim() || "#a1a1aa";
    ctx.fillStyle = textColor;
    ctx.font = "9px sans-serif";
    ctx.textAlign = "center";
    const labelStep = dModel <= 16 ? 1 : dModel <= 32 ? 4 : 8;
    for (let d = 0; d < dModel; d += labelStep) {
      ctx.fillText(`${d}`, labelOffset + d * cellW + cellW / 2, 10);
    }

    // Draw cells
    for (let pos = 0; pos < seqLen; pos++) {
      // Position label
      ctx.fillStyle = textColor;
      ctx.font = "10px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`pos ${pos}`, labelOffset - 6, 24 + pos * cellH + cellH / 2 + 3);

      for (let d = 0; d < dModel; d++) {
        const val = pe[pos][d];
        ctx.fillStyle = embeddingColor(val);
        ctx.fillRect(labelOffset + d * cellW, 16 + pos * cellH, cellW - 1, cellH - 1);
      }
    }
  }, [pe, seqLen, dModel]);

  return (
    <div ref={containerRef}>
      <canvas
        ref={canvasRef}
        style={{
          maxWidth: "100%",
          borderRadius: "6px",
          border: "1px solid var(--color-border)",
        }}
      />
      <div style={{ marginTop: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>-1</span>
        <div
          style={{
            height: "10px",
            width: "120px",
            borderRadius: "4px",
            background: `linear-gradient(to right, ${embeddingColor(-1)}, ${embeddingColor(0)}, ${embeddingColor(1)})`,
          }}
        />
        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>+1</span>
        <span style={{ fontSize: "10px", color: "var(--color-text-muted)", marginLeft: "4px" }}>
          sin/cos value
        </span>
      </div>
      <p style={{ marginTop: "6px", fontSize: "11px", color: "var(--color-text-muted)" }}>
        Each row is a position, each column a dimension. Even dimensions use sin, odd use cos.
        Lower dimensions capture coarse position, higher dimensions capture fine position.
      </p>
    </div>
  );
}

function TokenEmbeddingView({
  tokens,
  embeddings,
  dim,
}: {
  tokens: string[];
  embeddings: number[][];
  dim: number;
}) {
  if (tokens.length === 0) return null;

  const barHeight = tokens.length <= 8 ? 24 : tokens.length <= 14 ? 18 : 14;

  return (
    <div class="overflow-x-auto">
      <div style={{ display: "inline-block", minWidth: "fit-content" }}>
        {tokens.map((tok, i) => (
          <div
            key={i}
            style={{ display: "flex", alignItems: "center", marginBottom: "2px" }}
          >
            <div
              style={{
                width: "60px",
                textAlign: "right",
                paddingRight: "8px",
                fontSize: "11px",
                color: "var(--color-text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={tok}
            >
              {tok}
            </div>
            <div style={{ display: "flex", gap: "1px" }}>
              {embeddings[i].slice(0, Math.min(dim, 64)).map((val, d) => (
                <div
                  key={d}
                  style={{
                    width: dim <= 16 ? "12px" : dim <= 32 ? "8px" : "5px",
                    height: `${barHeight}px`,
                    backgroundColor: embeddingColor(val),
                    borderRadius: "1px",
                  }}
                  title={`dim ${d}: ${val.toFixed(4)}`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>-1</span>
        <div
          style={{
            height: "10px",
            width: "120px",
            borderRadius: "4px",
            background: `linear-gradient(to right, ${embeddingColor(-1)}, ${embeddingColor(0)}, ${embeddingColor(1)})`,
          }}
        />
        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>+1</span>
        <span style={{ fontSize: "10px", color: "var(--color-text-muted)", marginLeft: "4px" }}>
          Embedding value
        </span>
      </div>
      <p style={{ marginTop: "6px", fontSize: "11px", color: "var(--color-text-muted)" }}>
        Each row shows a token's embedding vector. Colors encode dimension values.
        Positional encoding is added to produce the final input to attention.
      </p>
    </div>
  );
}

function AttentionBarChart({
  tokens,
  scores,
  selectedToken,
}: {
  tokens: string[];
  scores: number[][];
  selectedToken: number;
}) {
  const row = scores[selectedToken];
  if (!row) return null;

  const maxScore = Math.max(...row);

  return (
    <div style={{ marginTop: "12px" }}>
      <p style={{ fontSize: "12px", color: "var(--color-text-muted)", marginBottom: "8px" }}>
        Token <strong style={{ color: "var(--color-primary)" }}>"{tokens[selectedToken]}"</strong> attends to:
      </p>
      {row.map((score, j) => (
        <div
          key={j}
          style={{
            display: "flex",
            alignItems: "center",
            marginBottom: "3px",
            gap: "6px",
          }}
        >
          <div
            style={{
              width: "50px",
              textAlign: "right",
              fontSize: "11px",
              color: j === selectedToken ? "var(--color-primary)" : "var(--color-text-muted)",
              fontWeight: j === selectedToken ? 700 : 400,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {tokens[j]}
          </div>
          <div
            style={{
              flex: 1,
              height: "16px",
              backgroundColor: "var(--color-surface)",
              borderRadius: "3px",
              overflow: "hidden",
              border: "1px solid var(--color-border)",
            }}
          >
            <div
              style={{
                width: `${maxScore > 0 ? (score / maxScore) * 100 : 0}%`,
                height: "100%",
                backgroundColor: interpolateColor(score),
                borderRadius: "2px",
                transition: "width 0.2s ease",
              }}
            />
          </div>
          <span
            style={{
              fontSize: "10px",
              fontFamily: "var(--font-mono)",
              color: "var(--color-text-muted)",
              width: "42px",
              textAlign: "right",
            }}
          >
            {score.toFixed(3)}
          </span>
        </div>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------
// Main component
// -----------------------------------------------------------------

export default function AttentionViz() {
  const [inputText, setInputText] = useState(PRESET_SENTENCES[0].text);
  const [embeddingDim, setEmbeddingDim] = useState<number>(DEFAULT_DIM);
  const [temperature, setTemperature] = useState(DEFAULT_TEMPERATURE);
  const [activeHead, setActiveHead] = useState(0);
  const [selectedToken, setSelectedToken] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("heatmap");
  const [heads, setHeads] = useState<AttentionHead[]>([]);
  const [seed, setSeed] = useState(0);

  // Tokens
  const tokens = useMemo(() => tokenize(inputText), [inputText]);

  // Embeddings with positional encoding
  const embeddings = useMemo(() => {
    if (tokens.length === 0) return [];
    const tokenEmbs = tokens.map((t) => tokenEmbedding(t, embeddingDim));
    const pe = positionalEncoding(tokens.length, embeddingDim);
    return tokenEmbs.map((emb, i) =>
      emb.map((v, d) => v + pe[i][d])
    );
  }, [tokens, embeddingDim]);

  // Raw token embeddings (without PE, for visualization)
  const rawEmbeddings = useMemo(() => {
    if (tokens.length === 0) return [];
    return tokens.map((t) => tokenEmbedding(t, embeddingDim));
  }, [tokens, embeddingDim]);

  // Initialize heads when dimensions or seed changes
  useEffect(() => {
    const dHead = Math.max(4, Math.floor(embeddingDim / NUM_HEADS));
    setHeads(initializeHeads(embeddingDim, dHead, NUM_HEADS));
  }, [embeddingDim, seed]);

  // Compute attention for active head
  const attentionResult = useMemo<AttentionResult | null>(() => {
    if (embeddings.length === 0 || heads.length === 0 || !heads[activeHead]) return null;
    return computeAttention(embeddings, heads[activeHead], temperature);
  }, [embeddings, heads, activeHead, temperature]);

  const handlePresetChange = useCallback((e: Event) => {
    const target = e.target as HTMLSelectElement;
    const preset = PRESET_SENTENCES.find((p) => p.label === target.value);
    if (preset) {
      setInputText(preset.text);
      setSelectedToken(null);
    }
  }, []);

  const handleInputChange = useCallback((e: Event) => {
    setInputText((e.target as HTMLInputElement).value);
    setSelectedToken(null);
  }, []);

  const handleDimChange = useCallback((e: Event) => {
    setEmbeddingDim(Number((e.target as HTMLSelectElement).value));
    setSelectedToken(null);
  }, []);

  const handleTemperatureChange = useCallback((e: Event) => {
    setTemperature(Number((e.target as HTMLInputElement).value));
  }, []);

  const handleTokenClick = useCallback((idx: number) => {
    setSelectedToken((prev) => (prev === idx ? null : idx));
  }, []);

  const handleRandomize = useCallback(() => {
    setSeed((s) => s + 1);
    setSelectedToken(null);
  }, []);

  const tabs: { id: TabId; label: string }[] = [
    { id: "heatmap", label: "Attention Heatmap" },
    { id: "positional", label: "Positional Encoding" },
    { id: "embeddings", label: "Token Embeddings" },
  ];

  return (
    <div
      style={{
        backgroundColor: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "12px",
        padding: "24px",
      }}
    >
      {/* Controls row */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "16px",
          alignItems: "flex-end",
        }}
      >
        {/* Text input */}
        <div style={{ flex: "1 1 280px" }}>
          <label
            style={{
              display: "block",
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--color-text-muted)",
              marginBottom: "4px",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Input text
          </label>
          <input
            type="text"
            value={inputText}
            onInput={handleInputChange}
            placeholder="Type a sentence..."
            style={{
              width: "100%",
              padding: "8px 12px",
              fontSize: "14px",
              backgroundColor: "var(--color-bg)",
              color: "var(--color-text)",
              border: "1px solid var(--color-border)",
              borderRadius: "6px",
              outline: "none",
              fontFamily: "var(--font-mono)",
            }}
          />
        </div>

        {/* Preset selector */}
        <div style={{ flex: "0 0 auto" }}>
          <label
            style={{
              display: "block",
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--color-text-muted)",
              marginBottom: "4px",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Presets
          </label>
          <select
            onChange={handlePresetChange}
            style={{
              padding: "8px 12px",
              fontSize: "13px",
              backgroundColor: "var(--color-bg)",
              color: "var(--color-text)",
              border: "1px solid var(--color-border)",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            {PRESET_SENTENCES.map((p) => (
              <option key={p.label} value={p.label} selected={p.text === inputText}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Parameters row */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "16px",
          marginBottom: "20px",
          alignItems: "center",
        }}
      >
        {/* Embedding dim */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <label
            style={{ fontSize: "11px", color: "var(--color-text-muted)", fontWeight: 600 }}
          >
            Dim:
          </label>
          <select
            value={embeddingDim}
            onChange={handleDimChange}
            style={{
              padding: "4px 8px",
              fontSize: "12px",
              backgroundColor: "var(--color-bg)",
              color: "var(--color-text)",
              border: "1px solid var(--color-border)",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            {EMBEDDING_DIMS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        {/* Temperature */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <label
            style={{ fontSize: "11px", color: "var(--color-text-muted)", fontWeight: 600 }}
          >
            Temperature:
          </label>
          <input
            type="range"
            min="0.1"
            max="5.0"
            step="0.1"
            value={temperature}
            onInput={handleTemperatureChange}
            style={{ width: "100px", accentColor: "var(--color-primary)" }}
          />
          <span
            style={{
              fontSize: "12px",
              fontFamily: "var(--font-mono)",
              color: "var(--color-text-muted)",
              minWidth: "32px",
            }}
          >
            {temperature.toFixed(1)}
          </span>
        </div>

        {/* Token count */}
        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
          {tokens.length} token{tokens.length !== 1 ? "s" : ""}
        </span>

        {/* Randomize weights */}
        <button
          onClick={handleRandomize}
          style={{
            padding: "4px 12px",
            fontSize: "11px",
            fontWeight: 600,
            backgroundColor: "transparent",
            color: "var(--color-primary)",
            border: "1px solid var(--color-primary)",
            borderRadius: "4px",
            cursor: "pointer",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Randomize Weights
        </button>
      </div>

      {/* Tokens display */}
      {tokens.length > 0 && (
        <div style={{ marginBottom: "16px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
            {tokens.map((tok, i) => (
              <button
                key={`${tok}-${i}`}
                onClick={() => handleTokenClick(i)}
                style={{
                  padding: "4px 10px",
                  fontSize: "13px",
                  fontFamily: "var(--font-mono)",
                  backgroundColor:
                    selectedToken === i
                      ? "rgba(79, 143, 247, 0.2)"
                      : "var(--color-bg)",
                  color:
                    selectedToken === i
                      ? "var(--color-primary)"
                      : "var(--color-text)",
                  border:
                    selectedToken === i
                      ? "1px solid var(--color-primary)"
                      : "1px solid var(--color-border)",
                  borderRadius: "4px",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {tok}
              </button>
            ))}
          </div>
          <p style={{ fontSize: "10px", color: "var(--color-text-muted)", marginTop: "4px" }}>
            Click a token to highlight its attention pattern
          </p>
        </div>
      )}

      {/* Tab navigation */}
      <div
        style={{
          display: "flex",
          gap: "0",
          borderBottom: "1px solid var(--color-border)",
          marginBottom: "16px",
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "8px 16px",
              fontSize: "12px",
              fontWeight: 600,
              backgroundColor: "transparent",
              color:
                activeTab === tab.id
                  ? "var(--color-primary)"
                  : "var(--color-text-muted)",
              border: "none",
              borderBottom:
                activeTab === tab.id
                  ? "2px solid var(--color-primary)"
                  : "2px solid transparent",
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              transition: "color 0.15s ease",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ minHeight: "200px" }}>
        {activeTab === "heatmap" && (
          <div>
            {/* Multi-head selector */}
            <div
              style={{
                display: "flex",
                gap: "6px",
                marginBottom: "16px",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "var(--color-text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Head:
              </span>
              {Array.from({ length: NUM_HEADS }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setActiveHead(i)}
                  style={{
                    padding: "4px 12px",
                    fontSize: "12px",
                    fontWeight: activeHead === i ? 700 : 400,
                    backgroundColor:
                      activeHead === i
                        ? "rgba(79, 143, 247, 0.15)"
                        : "var(--color-bg)",
                    color:
                      activeHead === i
                        ? "var(--color-primary)"
                        : "var(--color-text-muted)",
                    border:
                      activeHead === i
                        ? "1px solid var(--color-primary)"
                        : "1px solid var(--color-border)",
                    borderRadius: "4px",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  {i + 1}
                </button>
              ))}
            </div>

            {attentionResult && tokens.length > 0 ? (
              <div>
                <HeatmapGrid
                  tokens={tokens}
                  scores={attentionResult.scores}
                  selectedToken={selectedToken}
                  onTokenClick={handleTokenClick}
                />
                {selectedToken !== null && (
                  <AttentionBarChart
                    tokens={tokens}
                    scores={attentionResult.scores}
                    selectedToken={selectedToken}
                  />
                )}
              </div>
            ) : (
              <p style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>
                Type some text above to see the attention heatmap.
              </p>
            )}
          </div>
        )}

        {activeTab === "positional" && tokens.length > 0 && (
          <PositionalEncodingView seqLen={tokens.length} dModel={embeddingDim} />
        )}

        {activeTab === "positional" && tokens.length === 0 && (
          <p style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>
            Type some text above to see positional encoding.
          </p>
        )}

        {activeTab === "embeddings" && tokens.length > 0 && (
          <TokenEmbeddingView
            tokens={tokens}
            embeddings={rawEmbeddings}
            dim={embeddingDim}
          />
        )}

        {activeTab === "embeddings" && tokens.length === 0 && (
          <p style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>
            Type some text above to see token embeddings.
          </p>
        )}
      </div>

      {/* Explanation footer */}
      <div
        style={{
          marginTop: "20px",
          paddingTop: "16px",
          borderTop: "1px solid var(--color-border)",
        }}
      >
        <details>
          <summary
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--color-text-muted)",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            How it works
          </summary>
          <div
            style={{
              marginTop: "8px",
              fontSize: "12px",
              lineHeight: 1.6,
              color: "var(--color-text-muted)",
            }}
          >
            <p style={{ marginBottom: "8px" }}>
              <strong style={{ color: "var(--color-heading)" }}>Tokenization:</strong>{" "}
              Text is split on whitespace and punctuation into tokens.
            </p>
            <p style={{ marginBottom: "8px" }}>
              <strong style={{ color: "var(--color-heading)" }}>Embeddings:</strong>{" "}
              Each token gets a deterministic pseudo-random embedding vector of size d<sub>model</sub>.
              Sinusoidal positional encoding is added so the model can distinguish token positions.
            </p>
            <p style={{ marginBottom: "8px" }}>
              <strong style={{ color: "var(--color-heading)" }}>Self-Attention:</strong>{" "}
              For each head, random weight matrices W<sub>Q</sub>, W<sub>K</sub>, W<sub>V</sub> project
              embeddings into queries, keys, and values. Attention scores are computed as
              softmax(Q &middot; K<sup>T</sup> / &radic;d<sub>k</sub>). The temperature parameter
              sharpens ({"<"}1) or softens ({">"}1) the distribution.
            </p>
            <p>
              <strong style={{ color: "var(--color-heading)" }}>Multi-Head Attention:</strong>{" "}
              4 independent heads with separate weight matrices learn different attention patterns.
              In a real transformer, outputs are concatenated and projected; here each head is shown
              independently for educational clarity.
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}
