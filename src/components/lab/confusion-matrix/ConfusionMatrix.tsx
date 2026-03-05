import { useState, useCallback, useMemo } from "preact/hooks";

// -----------------------------------------------------------------
// Types
// -----------------------------------------------------------------

interface MatrixData {
  classes: string[];
  matrix: number[][];
}

type NormMode = "raw" | "row" | "column" | "total";
type InputMode = "csv" | "manual" | "presets";

interface ClassMetrics {
  className: string;
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

interface OverallMetrics {
  accuracy: number;
  macroF1: number;
  weightedF1: number;
  macroPrecision: number;
  macroRecall: number;
  cohensKappa: number;
  mcc: number | null; // only for binary
  totalSamples: number;
}

interface Preset {
  name: string;
  description: string;
  data: string;
}

// -----------------------------------------------------------------
// Pure Computation: Parsing
// -----------------------------------------------------------------

function detectDelimiter(text: string): string {
  const firstLine = text.trim().split("\n")[0];
  if (firstLine.includes("\t")) return "\t";
  if (firstLine.includes(",")) return ",";
  if (firstLine.includes(";")) return ";";
  return /\s+/.test(firstLine) ? " " : ",";
}

function isHeaderRow(line: string, delimiter: string): boolean {
  const parts = line.split(delimiter === " " ? /\s+/ : delimiter).map((s) => s.trim());
  if (parts.length < 2) return false;
  const headerWords = ["actual", "predicted", "true", "label", "class", "target", "expected", "y_true", "y_pred"];
  return parts.some((p) => headerWords.includes(p.toLowerCase()));
}

function parseCsvInput(text: string): MatrixData | string {
  const lines = text
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return "No data found. Paste at least one row of actual,predicted values.";

  const delimiter = detectDelimiter(text);
  const startIdx = isHeaderRow(lines[0], delimiter) ? 1 : 0;
  const dataLines = lines.slice(startIdx);

  if (dataLines.length === 0) return "No data rows found after header.";

  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < dataLines.length; i++) {
    const parts = dataLines[i].split(delimiter === " " ? /\s+/ : delimiter).map((s) => s.trim());
    if (parts.length < 2) {
      return `Line ${i + startIdx + 1}: expected at least 2 columns, got ${parts.length}. Format: actual${delimiter}predicted`;
    }
    pairs.push([parts[0], parts[1]]);
  }

  const classSet = new Set<string>();
  for (const [actual, predicted] of pairs) {
    classSet.add(actual);
    classSet.add(predicted);
  }
  const classes = Array.from(classSet).sort();

  const classIndex = new Map<string, number>();
  classes.forEach((c, i) => classIndex.set(c, i));

  const n = classes.length;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));

  for (const [actual, predicted] of pairs) {
    const ai = classIndex.get(actual)!;
    const pi = classIndex.get(predicted)!;
    matrix[ai][pi]++;
  }

  return { classes, matrix };
}

// -----------------------------------------------------------------
// Pure Computation: Metrics
// -----------------------------------------------------------------

function safeDivide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function computeClassMetrics(classes: string[], matrix: number[][]): ClassMetrics[] {
  return classes.map((className, i) => {
    const tp = matrix[i][i];
    const support = matrix[i].reduce((a, b) => a + b, 0);
    const predictedTotal = matrix.reduce((sum, row) => sum + row[i], 0);

    const precision = safeDivide(tp, predictedTotal);
    const recall = safeDivide(tp, support);
    const f1 = safeDivide(2 * precision * recall, precision + recall);

    return { className, precision, recall, f1, support };
  });
}

function computeOverallMetrics(
  classes: string[],
  matrix: number[][],
  classMetrics: ClassMetrics[]
): OverallMetrics {
  const n = classes.length;
  const totalSamples = matrix.reduce(
    (sum, row) => sum + row.reduce((a, b) => a + b, 0),
    0
  );

  const correctPredictions = matrix.reduce((sum, row, i) => sum + row[i], 0);
  const accuracy = safeDivide(correctPredictions, totalSamples);

  const macroF1 = safeDivide(
    classMetrics.reduce((sum, m) => sum + m.f1, 0),
    n
  );
  const macroPrecision = safeDivide(
    classMetrics.reduce((sum, m) => sum + m.precision, 0),
    n
  );
  const macroRecall = safeDivide(
    classMetrics.reduce((sum, m) => sum + m.recall, 0),
    n
  );

  const weightedF1 = safeDivide(
    classMetrics.reduce((sum, m) => sum + m.f1 * m.support, 0),
    totalSamples
  );

  // Cohen's Kappa
  const rowSums = matrix.map((row) => row.reduce((a, b) => a + b, 0));
  const colSums = classes.map((_, j) => matrix.reduce((sum, row) => sum + row[j], 0));
  const pe = safeDivide(
    rowSums.reduce((sum, rs, i) => sum + rs * colSums[i], 0),
    totalSamples * totalSamples
  );
  const cohensKappa = safeDivide(accuracy - pe, 1 - pe);

  // MCC (only for binary)
  let mcc: number | null = null;
  if (n === 2) {
    const tp = matrix[0][0];
    const fp = matrix[1][0];
    const fn = matrix[0][1];
    const tn = matrix[1][1];
    const denom = Math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn));
    mcc = denom === 0 ? 0 : (tp * tn - fp * fn) / denom;
  }

  return {
    accuracy,
    macroF1,
    weightedF1,
    macroPrecision,
    macroRecall,
    cohensKappa,
    mcc,
    totalSamples,
  };
}

function normalizeMatrix(
  matrix: number[][],
  mode: NormMode
): number[][] {
  if (mode === "raw") return matrix;
  const n = matrix.length;

  if (mode === "total") {
    const total = matrix.reduce(
      (sum, row) => sum + row.reduce((a, b) => a + b, 0),
      0
    );
    if (total === 0) return matrix.map((row) => row.map(() => 0));
    return matrix.map((row) => row.map((v) => v / total));
  }

  if (mode === "row") {
    return matrix.map((row) => {
      const rowSum = row.reduce((a, b) => a + b, 0);
      return rowSum === 0 ? row.map(() => 0) : row.map((v) => v / rowSum);
    });
  }

  // mode === "column"
  const colSums = Array.from({ length: n }, (_, j) =>
    matrix.reduce((sum, row) => sum + row[j], 0)
  );
  return matrix.map((row) =>
    row.map((v, j) => (colSums[j] === 0 ? 0 : v / colSums[j]))
  );
}

// -----------------------------------------------------------------
// Export helpers
// -----------------------------------------------------------------

function matrixToCsv(classes: string[], matrix: number[][]): string {
  const header = ["", ...classes].join(",");
  const rows = classes.map(
    (c, i) => [c, ...matrix[i].map(String)].join(",")
  );
  return [header, ...rows].join("\n");
}

function matrixToMarkdown(classes: string[], matrix: number[][]): string {
  const maxLen = Math.max(...classes.map((c) => c.length), 4);
  const pad = (s: string) => s.padEnd(maxLen);

  const header = `| ${pad("")} | ${classes.map((c) => pad(c)).join(" | ")} |`;
  const sep = `| ${"-".repeat(maxLen)} | ${classes.map(() => "-".repeat(maxLen)).join(" | ")} |`;
  const rows = classes.map(
    (c, i) =>
      `| ${pad(c)} | ${matrix[i].map((v) => pad(String(v))).join(" | ")} |`
  );
  return [header, sep, ...rows].join("\n");
}

function metricsToText(
  classMetrics: ClassMetrics[],
  overall: OverallMetrics
): string {
  const lines: string[] = [];
  const w = Math.max(...classMetrics.map((m) => m.className.length), 12);

  lines.push(
    `${"".padEnd(w)}  precision    recall  f1-score   support`
  );
  lines.push("");

  for (const m of classMetrics) {
    lines.push(
      `${m.className.padEnd(w)}      ${m.precision.toFixed(2)}      ${m.recall.toFixed(2)}      ${m.f1.toFixed(2)}      ${m.support}`
    );
  }

  lines.push("");
  lines.push(
    `${"accuracy".padEnd(w)}                          ${overall.accuracy.toFixed(2)}      ${overall.totalSamples}`
  );
  lines.push(
    `${"macro avg".padEnd(w)}      ${overall.macroPrecision.toFixed(2)}      ${overall.macroRecall.toFixed(2)}      ${overall.macroF1.toFixed(2)}      ${overall.totalSamples}`
  );
  lines.push(
    `${"weighted avg".padEnd(w)}      ${(classMetrics.reduce((s, m) => s + m.precision * m.support, 0) / overall.totalSamples).toFixed(2)}      ${(classMetrics.reduce((s, m) => s + m.recall * m.support, 0) / overall.totalSamples).toFixed(2)}      ${overall.weightedF1.toFixed(2)}      ${overall.totalSamples}`
  );

  lines.push("");
  lines.push(`Cohen's Kappa: ${overall.cohensKappa.toFixed(4)}`);
  if (overall.mcc !== null) {
    lines.push(`MCC: ${overall.mcc.toFixed(4)}`);
  }

  return lines.join("\n");
}

// -----------------------------------------------------------------
// Presets
// -----------------------------------------------------------------

const PRESETS: Preset[] = [
  {
    name: "Binary: Spam Detection",
    description: "Spam vs Not Spam (200 samples)",
    data: `actual,predicted
${"not-spam,not-spam\n".repeat(85)}${"not-spam,spam\n".repeat(15)}${"spam,not-spam\n".repeat(10)}${"spam,spam\n".repeat(90)}`.trim(),
  },
  {
    name: "Multi-class: Iris",
    description: "Setosa, Versicolor, Virginica (150 samples)",
    data: `actual,predicted
${"setosa,setosa\n".repeat(48)}${"setosa,versicolor\n".repeat(2)}${"versicolor,versicolor\n".repeat(42)}${"versicolor,setosa\n".repeat(3)}${"versicolor,virginica\n".repeat(5)}${"virginica,virginica\n".repeat(44)}${"virginica,versicolor\n".repeat(6)}`.trim(),
  },
  {
    name: "Sentiment: 3-class",
    description: "Positive, Neutral, Negative (300 samples)",
    data: `actual,predicted
${"positive,positive\n".repeat(72)}${"positive,neutral\n".repeat(18)}${"positive,negative\n".repeat(10)}${"neutral,positive\n".repeat(12)}${"neutral,neutral\n".repeat(68)}${"neutral,negative\n".repeat(20)}${"negative,positive\n".repeat(5)}${"negative,neutral\n".repeat(15)}${"negative,negative\n".repeat(80)}`.trim(),
  },
  {
    name: "Multi-class: Digits (5-class)",
    description: "Digit recognition 0-4 (500 samples)",
    data: `actual,predicted
${"0,0\n".repeat(88)}${"0,1\n".repeat(5)}${"0,2\n".repeat(4)}${"0,3\n".repeat(2)}${"0,4\n".repeat(1)}${"1,1\n".repeat(82)}${"1,0\n".repeat(8)}${"1,7\n".repeat(0)}${"1,2\n".repeat(6)}${"1,3\n".repeat(4)}${"2,2\n".repeat(78)}${"2,0\n".repeat(3)}${"2,1\n".repeat(9)}${"2,3\n".repeat(7)}${"2,4\n".repeat(3)}${"3,3\n".repeat(85)}${"3,2\n".repeat(6)}${"3,4\n".repeat(5)}${"3,1\n".repeat(4)}${"4,4\n".repeat(80)}${"4,3\n".repeat(8)}${"4,2\n".repeat(5)}${"4,0\n".repeat(4)}${"4,1\n".repeat(3)}`.trim(),
  },
];

// -----------------------------------------------------------------
// Styles (inline objects for Preact)
// -----------------------------------------------------------------

const CELL_SIZE = 56;
const LABEL_SIZE = 80;

function getCellColor(
  value: number,
  maxValue: number,
  isDiagonal: boolean
): string {
  if (maxValue === 0) return "transparent";
  const intensity = value / maxValue;
  if (isDiagonal) {
    const alpha = 0.1 + intensity * 0.6;
    return `rgba(52, 211, 153, ${alpha.toFixed(2)})`;
  }
  if (value === 0) return "transparent";
  const alpha = 0.1 + intensity * 0.4;
  return `rgba(239, 68, 68, ${alpha.toFixed(2)})`;
}

// -----------------------------------------------------------------
// Sub-Components
// -----------------------------------------------------------------

function InputTabs({
  mode,
  onModeChange,
}: {
  mode: InputMode;
  onModeChange: (m: InputMode) => void;
}) {
  const tabs: Array<{ id: InputMode; label: string }> = [
    { id: "csv", label: "Paste CSV" },
    { id: "manual", label: "Manual Grid" },
    { id: "presets", label: "Presets" },
  ];
  return (
    <div class="flex gap-1 rounded-lg p-1" style={{ background: "var(--color-surface)" }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onModeChange(t.id)}
          class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
          style={{
            background: mode === t.id ? "var(--color-primary)" : "transparent",
            color: mode === t.id ? "#fff" : "var(--color-text-muted)",
            border: "none",
            cursor: "pointer",
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function CsvInput({
  value,
  onChange,
  onBuild,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onBuild: () => void;
  error: string | null;
}) {
  return (
    <div>
      <textarea
        value={value}
        onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
        placeholder={`actual,predicted\ncat,cat\ncat,dog\ndog,dog\ndog,cat`}
        rows={8}
        class="w-full rounded-lg border p-3 font-mono text-xs leading-relaxed"
        style={{
          background: "var(--color-bg)",
          color: "var(--color-text)",
          borderColor: error ? "rgba(239,68,68,0.6)" : "var(--color-border)",
          resize: "vertical",
        }}
      />
      {error && (
        <p class="mt-1 text-xs" style={{ color: "rgba(239,68,68,0.9)" }}>
          {error}
        </p>
      )}
      <button
        onClick={onBuild}
        class="mt-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        style={{
          background: "var(--color-primary)",
          color: "#fff",
          border: "none",
          cursor: "pointer",
        }}
      >
        Build Matrix
      </button>
    </div>
  );
}

function ManualInput({
  data,
  onDataChange,
}: {
  data: MatrixData;
  onDataChange: (d: MatrixData) => void;
}) {
  const [newClassName, setNewClassName] = useState("");

  const addClass = useCallback(() => {
    const name = newClassName.trim();
    if (!name || data.classes.includes(name)) return;
    const n = data.classes.length;
    const newMatrix = data.matrix.map((row) => [...row, 0]);
    newMatrix.push(new Array(n + 1).fill(0));
    onDataChange({ classes: [...data.classes, name], matrix: newMatrix });
    setNewClassName("");
  }, [newClassName, data, onDataChange]);

  const removeClass = useCallback(
    (idx: number) => {
      if (data.classes.length <= 2) return;
      const classes = data.classes.filter((_, i) => i !== idx);
      const matrix = data.matrix
        .filter((_, i) => i !== idx)
        .map((row) => row.filter((_, j) => j !== idx));
      onDataChange({ classes, matrix });
    },
    [data, onDataChange]
  );

  const incrementCell = useCallback(
    (r: number, c: number, delta: number) => {
      const matrix = data.matrix.map((row) => [...row]);
      matrix[r][c] = Math.max(0, matrix[r][c] + delta);
      onDataChange({ ...data, matrix });
    },
    [data, onDataChange]
  );

  return (
    <div>
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <span class="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Classes:
        </span>
        {data.classes.map((c, i) => (
          <span
            key={c}
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
            style={{
              background: "var(--color-surface)",
              color: "var(--color-text)",
              border: "1px solid var(--color-border)",
            }}
          >
            {c}
            {data.classes.length > 2 && (
              <button
                onClick={() => removeClass(i)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--color-text-muted)",
                  padding: "0 2px",
                  fontSize: "10px",
                }}
                title={`Remove ${c}`}
              >
                x
              </button>
            )}
          </span>
        ))}
        <div class="inline-flex items-center gap-1">
          <input
            type="text"
            value={newClassName}
            onInput={(e) => setNewClassName((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === "Enter" && addClass()}
            placeholder="Add class"
            class="rounded border px-2 py-0.5 text-xs"
            style={{
              background: "var(--color-bg)",
              color: "var(--color-text)",
              borderColor: "var(--color-border)",
              width: "80px",
            }}
          />
          <button
            onClick={addClass}
            class="rounded px-2 py-0.5 text-xs"
            style={{
              background: "var(--color-primary)",
              color: "#fff",
              border: "none",
              cursor: "pointer",
            }}
          >
            +
          </button>
        </div>
      </div>

      <p class="mb-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
        Click a cell to increment (+1). Right-click or Shift+click to decrement (-1).
      </p>

      <div class="overflow-x-auto">
        <table
          style={{
            borderCollapse: "collapse",
            fontSize: "12px",
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  padding: "4px 8px",
                  color: "var(--color-text-muted)",
                  fontWeight: 500,
                  textAlign: "left",
                }}
              >
                Actual \ Pred
              </th>
              {data.classes.map((c) => (
                <th
                  key={c}
                  style={{
                    padding: "4px 8px",
                    color: "var(--color-heading)",
                    fontWeight: 600,
                    textAlign: "center",
                    minWidth: "48px",
                  }}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.classes.map((c, r) => (
              <tr key={c}>
                <td
                  style={{
                    padding: "4px 8px",
                    color: "var(--color-heading)",
                    fontWeight: 600,
                  }}
                >
                  {c}
                </td>
                {data.matrix[r].map((val, col) => (
                  <td
                    key={col}
                    onClick={() => incrementCell(r, col, 1)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      incrementCell(r, col, -1);
                    }}
                    onMouseDown={(e) => {
                      if (e.shiftKey) {
                        e.preventDefault();
                        incrementCell(r, col, -1);
                      }
                    }}
                    style={{
                      padding: "4px",
                      textAlign: "center",
                      cursor: "pointer",
                      borderRadius: "4px",
                      minWidth: "48px",
                      background: getCellColor(
                        val,
                        Math.max(...data.matrix.flat()),
                        r === col
                      ),
                      color: "var(--color-text)",
                      userSelect: "none",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    {val}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PresetSelector({
  onSelect,
}: {
  onSelect: (data: string) => void;
}) {
  return (
    <div class="grid gap-2 sm:grid-cols-2">
      {PRESETS.map((p) => (
        <button
          key={p.name}
          onClick={() => onSelect(p.data)}
          class="rounded-lg border p-3 text-left transition-colors"
          style={{
            background: "var(--color-surface)",
            borderColor: "var(--color-border)",
            cursor: "pointer",
            color: "var(--color-text)",
          }}
        >
          <div class="text-sm font-medium" style={{ color: "var(--color-heading)" }}>
            {p.name}
          </div>
          <div class="mt-0.5 text-xs" style={{ color: "var(--color-text-muted)" }}>
            {p.description}
          </div>
        </button>
      ))}
    </div>
  );
}

function NormSelector({
  mode,
  onChange,
}: {
  mode: NormMode;
  onChange: (m: NormMode) => void;
}) {
  const options: Array<{ id: NormMode; label: string }> = [
    { id: "raw", label: "Raw" },
    { id: "row", label: "Row (Recall)" },
    { id: "column", label: "Col (Precision)" },
    { id: "total", label: "Total" },
  ];

  return (
    <div class="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          class="rounded px-2 py-1 text-xs transition-colors"
          style={{
            background: mode === o.id ? "var(--color-primary)" : "var(--color-surface)",
            color: mode === o.id ? "#fff" : "var(--color-text-muted)",
            border: `1px solid ${mode === o.id ? "var(--color-primary)" : "var(--color-border)"}`,
            cursor: "pointer",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MatrixGrid({
  classes,
  rawMatrix,
  normMode,
  highlightRow,
  highlightCol,
  onCellHover,
  onCellLeave,
}: {
  classes: string[];
  rawMatrix: number[][];
  normMode: NormMode;
  highlightRow: number | null;
  highlightCol: number | null;
  onCellHover: (r: number, c: number) => void;
  onCellLeave: () => void;
}) {
  const normalized = useMemo(
    () => normalizeMatrix(rawMatrix, normMode),
    [rawMatrix, normMode]
  );

  const maxRaw = useMemo(
    () => Math.max(...rawMatrix.flat(), 1),
    [rawMatrix]
  );

  const n = classes.length;
  const isLargeGrid = n > 6;
  const cellSize = isLargeGrid ? 44 : CELL_SIZE;
  const labelWidth = isLargeGrid ? 60 : LABEL_SIZE;
  const fontSize = isLargeGrid ? "10px" : "12px";

  return (
    <div class="overflow-x-auto">
      <div
        style={{
          display: "inline-block",
          minWidth: "fit-content",
        }}
      >
        {/* Column labels (predicted) */}
        <div style={{ display: "flex", marginLeft: `${labelWidth}px` }}>
          {classes.map((c, j) => (
            <div
              key={c}
              style={{
                width: `${cellSize}px`,
                textAlign: "center",
                fontSize,
                fontWeight: 600,
                color:
                  highlightCol === j
                    ? "var(--color-primary)"
                    : "var(--color-heading)",
                padding: "2px 0",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={c}
            >
              {c}
            </div>
          ))}
        </div>

        {/* Predicted label */}
        <div
          style={{
            marginLeft: `${labelWidth}px`,
            fontSize: "10px",
            color: "var(--color-text-muted)",
            textAlign: "center",
            width: `${cellSize * n}px`,
            marginBottom: "2px",
          }}
        >
          Predicted
        </div>

        {/* Rows */}
        {classes.map((c, i) => (
          <div key={c} style={{ display: "flex", alignItems: "center" }}>
            {/* Row label (actual) */}
            <div
              style={{
                width: `${labelWidth}px`,
                textAlign: "right",
                paddingRight: "8px",
                fontSize,
                fontWeight: 600,
                color:
                  highlightRow === i
                    ? "var(--color-primary)"
                    : "var(--color-heading)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={c}
            >
              {i === Math.floor(n / 2) && (
                <span
                  style={{
                    fontSize: "10px",
                    color: "var(--color-text-muted)",
                    marginRight: "6px",
                    fontWeight: 400,
                  }}
                >
                  Actual
                </span>
              )}
              {c}
            </div>

            {/* Cells */}
            {rawMatrix[i].map((rawVal, j) => {
              const displayVal = normalized[i][j];
              const isHighlighted =
                highlightRow === i || highlightCol === j;

              return (
                <div
                  key={j}
                  onMouseEnter={() => onCellHover(i, j)}
                  onMouseLeave={onCellLeave}
                  style={{
                    width: `${cellSize}px`,
                    height: `${cellSize}px`,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    background: getCellColor(rawVal, maxRaw, i === j),
                    border: `1px solid ${isHighlighted ? "var(--color-primary)" : "var(--color-border)"}`,
                    borderRadius: "4px",
                    margin: "1px",
                    cursor: "default",
                    transition: "border-color 0.15s",
                  }}
                >
                  <span
                    style={{
                      fontSize: normMode === "raw" ? "13px" : "11px",
                      fontWeight: 600,
                      color: "var(--color-heading)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {normMode === "raw"
                      ? rawVal
                      : displayVal.toFixed(displayVal < 0.01 && displayVal > 0 ? 3 : 2)}
                  </span>
                  {normMode !== "raw" && (
                    <span
                      style={{
                        fontSize: "9px",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      ({rawVal})
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricsTable({
  classMetrics,
  overall,
}: {
  classMetrics: ClassMetrics[];
  overall: OverallMetrics;
}) {
  const fmt = (v: number) => v.toFixed(2);

  return (
    <div class="overflow-x-auto">
      <table
        style={{
          borderCollapse: "collapse",
          width: "100%",
          fontSize: "12px",
          fontFamily: "var(--font-mono)",
        }}
      >
        <thead>
          <tr>
            {["", "Prec", "Recall", "F1", "Support"].map((h) => (
              <th
                key={h}
                style={{
                  padding: "4px 6px",
                  textAlign: h === "" ? "left" : "right",
                  color: "var(--color-text-muted)",
                  fontWeight: 500,
                  borderBottom: "1px solid var(--color-border)",
                  whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {classMetrics.map((m) => (
            <tr key={m.className}>
              <td
                style={{
                  padding: "4px 6px",
                  fontWeight: 600,
                  color: "var(--color-heading)",
                  fontFamily: "var(--font-sans)",
                }}
              >
                {m.className}
              </td>
              <td
                style={{
                  padding: "4px 6px",
                  textAlign: "right",
                  color: "var(--color-text)",
                }}
              >
                {fmt(m.precision)}
              </td>
              <td
                style={{
                  padding: "4px 6px",
                  textAlign: "right",
                  color: "var(--color-text)",
                }}
              >
                {fmt(m.recall)}
              </td>
              <td
                style={{
                  padding: "4px 6px",
                  textAlign: "right",
                  color: "var(--color-text)",
                }}
              >
                {fmt(m.f1)}
              </td>
              <td
                style={{
                  padding: "4px 6px",
                  textAlign: "right",
                  color: "var(--color-text-muted)",
                }}
              >
                {m.support}
              </td>
            </tr>
          ))}

          {/* Separator */}
          <tr>
            <td
              colSpan={5}
              style={{
                borderTop: "1px solid var(--color-border)",
                padding: "0",
              }}
            />
          </tr>

          {/* Accuracy */}
          <tr>
            <td
              style={{
                padding: "4px 6px",
                fontWeight: 600,
                color: "var(--color-heading)",
                fontFamily: "var(--font-sans)",
              }}
            >
              accuracy
            </td>
            <td colSpan={2} />
            <td
              style={{
                padding: "4px 6px",
                textAlign: "right",
                color: "var(--color-accent)",
                fontWeight: 600,
              }}
            >
              {fmt(overall.accuracy)}
            </td>
            <td
              style={{
                padding: "4px 6px",
                textAlign: "right",
                color: "var(--color-text-muted)",
              }}
            >
              {overall.totalSamples}
            </td>
          </tr>

          {/* Macro avg */}
          <tr>
            <td
              style={{
                padding: "4px 6px",
                fontWeight: 600,
                color: "var(--color-heading)",
                fontFamily: "var(--font-sans)",
              }}
            >
              macro avg
            </td>
            <td
              style={{
                padding: "4px 6px",
                textAlign: "right",
                color: "var(--color-text)",
              }}
            >
              {fmt(overall.macroPrecision)}
            </td>
            <td
              style={{
                padding: "4px 6px",
                textAlign: "right",
                color: "var(--color-text)",
              }}
            >
              {fmt(overall.macroRecall)}
            </td>
            <td
              style={{
                padding: "4px 6px",
                textAlign: "right",
                color: "var(--color-text)",
              }}
            >
              {fmt(overall.macroF1)}
            </td>
            <td
              style={{
                padding: "4px 6px",
                textAlign: "right",
                color: "var(--color-text-muted)",
              }}
            >
              {overall.totalSamples}
            </td>
          </tr>

          {/* Weighted avg */}
          <tr>
            <td
              style={{
                padding: "4px 6px",
                fontWeight: 600,
                color: "var(--color-heading)",
                fontFamily: "var(--font-sans)",
              }}
            >
              weighted avg
            </td>
            <td
              style={{
                padding: "4px 6px",
                textAlign: "right",
                color: "var(--color-text)",
              }}
            >
              {fmt(
                overall.totalSamples > 0
                  ? classMetrics.reduce(
                      (s, m) => s + m.precision * m.support,
                      0
                    ) / overall.totalSamples
                  : 0
              )}
            </td>
            <td
              style={{
                padding: "4px 6px",
                textAlign: "right",
                color: "var(--color-text)",
              }}
            >
              {fmt(
                overall.totalSamples > 0
                  ? classMetrics.reduce(
                      (s, m) => s + m.recall * m.support,
                      0
                    ) / overall.totalSamples
                  : 0
              )}
            </td>
            <td
              style={{
                padding: "4px 6px",
                textAlign: "right",
                color: "var(--color-text)",
              }}
            >
              {fmt(overall.weightedF1)}
            </td>
            <td
              style={{
                padding: "4px 6px",
                textAlign: "right",
                color: "var(--color-text-muted)",
              }}
            >
              {overall.totalSamples}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Extra metrics */}
      <div
        class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs"
        style={{ color: "var(--color-text-muted)" }}
      >
        <span>
          Cohen's Kappa:{" "}
          <strong style={{ color: "var(--color-heading)" }}>
            {overall.cohensKappa.toFixed(3)}
          </strong>
        </span>
        {overall.mcc !== null && (
          <span>
            MCC:{" "}
            <strong style={{ color: "var(--color-heading)" }}>
              {overall.mcc.toFixed(3)}
            </strong>
          </span>
        )}
      </div>
    </div>
  );
}

function BarChart({ classMetrics }: { classMetrics: ClassMetrics[] }) {
  const metrics = [
    { key: "precision" as const, label: "Precision", color: "var(--color-primary)" },
    { key: "recall" as const, label: "Recall", color: "var(--color-accent)" },
    { key: "f1" as const, label: "F1", color: "#a78bfa" },
  ];

  return (
    <div>
      <div class="mb-2 flex flex-wrap gap-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
        {metrics.map((m) => (
          <span key={m.key} class="flex items-center gap-1">
            <span
              style={{
                display: "inline-block",
                width: "10px",
                height: "10px",
                borderRadius: "2px",
                background: m.color,
              }}
            />
            {m.label}
          </span>
        ))}
      </div>

      <div class="space-y-3">
        {classMetrics.map((cm) => (
          <div key={cm.className}>
            <div
              class="mb-1 text-xs font-medium"
              style={{ color: "var(--color-heading)" }}
            >
              {cm.className}
            </div>
            <div class="space-y-1">
              {metrics.map((m) => {
                const val = cm[m.key];
                return (
                  <div key={m.key} class="flex items-center gap-2">
                    <div
                      style={{
                        width: "100%",
                        maxWidth: "200px",
                        height: "12px",
                        background: "var(--color-surface)",
                        borderRadius: "4px",
                        overflow: "hidden",
                        border: "1px solid var(--color-border)",
                      }}
                    >
                      <div
                        style={{
                          width: `${(val * 100).toFixed(1)}%`,
                          height: "100%",
                          background: m.color,
                          borderRadius: "3px",
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                    <span
                      class="text-xs font-mono"
                      style={{
                        color: "var(--color-text)",
                        minWidth: "32px",
                      }}
                    >
                      {val.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CopyButton({
  text,
  label,
}: {
  text: string;
  label: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      class="rounded px-2 py-1 text-xs transition-colors"
      style={{
        background: copied ? "var(--color-accent)" : "var(--color-surface)",
        color: copied ? "#fff" : "var(--color-text-muted)",
        border: `1px solid ${copied ? "var(--color-accent)" : "var(--color-border)"}`,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

// -----------------------------------------------------------------
// Main Component
// -----------------------------------------------------------------

const DEFAULT_MANUAL_DATA: MatrixData = {
  classes: ["A", "B"],
  matrix: [
    [0, 0],
    [0, 0],
  ],
};

export default function ConfusionMatrix() {
  const [inputMode, setInputMode] = useState<InputMode>("presets");
  const [csvText, setCsvText] = useState("");
  const [csvError, setCsvError] = useState<string | null>(null);
  const [manualData, setManualData] = useState<MatrixData>(DEFAULT_MANUAL_DATA);
  const [matrixData, setMatrixData] = useState<MatrixData | null>(null);
  const [normMode, setNormMode] = useState<NormMode>("raw");
  const [highlightRow, setHighlightRow] = useState<number | null>(null);
  const [highlightCol, setHighlightCol] = useState<number | null>(null);

  const handleBuildFromCsv = useCallback(() => {
    const result = parseCsvInput(csvText);
    if (typeof result === "string") {
      setCsvError(result);
      setMatrixData(null);
    } else {
      setCsvError(null);
      setMatrixData(result);
    }
  }, [csvText]);

  const handlePresetSelect = useCallback((data: string) => {
    setCsvText(data);
    setCsvError(null);
    const result = parseCsvInput(data);
    if (typeof result !== "string") {
      setMatrixData(result);
      setInputMode("csv");
    }
  }, []);

  const handleManualChange = useCallback((data: MatrixData) => {
    setManualData(data);
    setMatrixData(data);
  }, []);

  const handleModeChange = useCallback(
    (mode: InputMode) => {
      setInputMode(mode);
      if (mode === "manual") {
        setMatrixData(manualData);
      }
    },
    [manualData]
  );

  const handleCellHover = useCallback((r: number, c: number) => {
    setHighlightRow(r);
    setHighlightCol(c);
  }, []);

  const handleCellLeave = useCallback(() => {
    setHighlightRow(null);
    setHighlightCol(null);
  }, []);

  const classMetrics = useMemo(
    () =>
      matrixData
        ? computeClassMetrics(matrixData.classes, matrixData.matrix)
        : [],
    [matrixData]
  );

  const overallMetrics = useMemo(
    () =>
      matrixData
        ? computeOverallMetrics(
            matrixData.classes,
            matrixData.matrix,
            classMetrics
          )
        : null,
    [matrixData, classMetrics]
  );

  const hasData = matrixData !== null && overallMetrics !== null && overallMetrics.totalSamples > 0;

  const cellDetailText = useMemo(() => {
    if (!matrixData || highlightRow === null || highlightCol === null) return null;
    const r = highlightRow;
    const c = highlightCol;
    const actual = matrixData.classes[r];
    const predicted = matrixData.classes[c];
    const count = matrixData.matrix[r][c];
    const rowTotal = matrixData.matrix[r].reduce((a, b) => a + b, 0);
    const isDiag = r === c;
    return `${isDiag ? "Correct" : "Error"}: ${count} sample${count !== 1 ? "s" : ""} where actual="${actual}" predicted as "${predicted}" (${rowTotal > 0 ? ((count / rowTotal) * 100).toFixed(1) : 0}% of actual "${actual}")`;
  }, [matrixData, highlightRow, highlightCol]);

  return (
    <div
      class="rounded-xl border p-4 sm:p-6"
      style={{
        background: "color-mix(in srgb, var(--color-surface) 80%, transparent)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Input Section */}
      <div class="mb-6">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2
            class="text-sm font-semibold"
            style={{ color: "var(--color-heading)" }}
          >
            Input Data
          </h2>
          <InputTabs mode={inputMode} onModeChange={handleModeChange} />
        </div>

        {inputMode === "csv" && (
          <CsvInput
            value={csvText}
            onChange={setCsvText}
            onBuild={handleBuildFromCsv}
            error={csvError}
          />
        )}
        {inputMode === "manual" && (
          <ManualInput data={manualData} onDataChange={handleManualChange} />
        )}
        {inputMode === "presets" && (
          <PresetSelector onSelect={handlePresetSelect} />
        )}
      </div>

      {/* Results Section */}
      {hasData && matrixData && overallMetrics && (
        <div>
          {/* Divider */}
          <div
            class="mb-6"
            style={{ borderTop: "1px solid var(--color-border)" }}
          />

          {/* Matrix + Metrics side by side on desktop */}
          <div class="grid gap-6 lg:grid-cols-2">
            {/* Left: Matrix */}
            <div>
              <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3
                  class="text-sm font-semibold"
                  style={{ color: "var(--color-heading)" }}
                >
                  Confusion Matrix
                </h3>
                <NormSelector mode={normMode} onChange={setNormMode} />
              </div>
              <MatrixGrid
                classes={matrixData.classes}
                rawMatrix={matrixData.matrix}
                normMode={normMode}
                highlightRow={highlightRow}
                highlightCol={highlightCol}
                onCellHover={handleCellHover}
                onCellLeave={handleCellLeave}
              />
              {cellDetailText && (
                <p
                  class="mt-2 text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {cellDetailText}
                </p>
              )}
            </div>

            {/* Right: Metrics */}
            <div>
              <h3
                class="mb-2 text-sm font-semibold"
                style={{ color: "var(--color-heading)" }}
              >
                Classification Report
              </h3>
              <MetricsTable
                classMetrics={classMetrics}
                overall={overallMetrics}
              />
            </div>
          </div>

          {/* Bar Chart */}
          <div class="mt-6">
            <div
              class="mb-4"
              style={{ borderTop: "1px solid var(--color-border)" }}
            />
            <h3
              class="mb-3 text-sm font-semibold"
              style={{ color: "var(--color-heading)" }}
            >
              Per-Class Metrics
            </h3>
            <BarChart classMetrics={classMetrics} />
          </div>

          {/* Export */}
          <div class="mt-6">
            <div
              class="mb-4"
              style={{ borderTop: "1px solid var(--color-border)" }}
            />
            <h3
              class="mb-2 text-sm font-semibold"
              style={{ color: "var(--color-heading)" }}
            >
              Export
            </h3>
            <div class="flex flex-wrap gap-2">
              <CopyButton
                text={matrixToCsv(matrixData.classes, matrixData.matrix)}
                label="Copy as CSV"
              />
              <CopyButton
                text={matrixToMarkdown(matrixData.classes, matrixData.matrix)}
                label="Copy as Markdown"
              />
              <CopyButton
                text={metricsToText(classMetrics, overallMetrics)}
                label="Copy Metrics"
              />
            </div>
          </div>
        </div>
      )}

      {/* Empty state when no data */}
      {!hasData && inputMode !== "presets" && (
        <div
          class="rounded-lg border border-dashed p-8 text-center"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text-muted)",
          }}
        >
          <p class="text-sm">
            {inputMode === "csv"
              ? "Paste your classification data above and click \"Build Matrix\" to visualize."
              : "Click cells in the grid above to add counts, then view the results."}
          </p>
        </div>
      )}
    </div>
  );
}
