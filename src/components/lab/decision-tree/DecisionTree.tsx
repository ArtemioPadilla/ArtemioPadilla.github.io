import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "preact/hooks";
import type { JSX } from "preact";

import {
  buildTree,
  pruneTree,
  predict,
  computeTreeLayout,
  computeDecisionBoundary,
  getTreeDepth,
  getNodeCount,
  type TreeNode,
  type TreeParams,
  type SplitCriterion,
  type BuildResult,
  type NodeLayout,
  type PredictionPath,
} from "./tree-engine";

import {
  renderTreeDiagram,
  renderScatterPlot,
  renderFeatureImportance,
  hitTestNode,
  getClassColor,
} from "./tree-renderer";

import { PRESET_DATASETS, parseCSV, type Dataset } from "./datasets";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

type ViewTab = "tree" | "scatter" | "importance" | "data";
type Mode = "full" | "step" | "predict";

// ─────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────

const btnBase =
  "px-3 py-1.5 text-xs font-medium rounded border transition-colors cursor-pointer";
const btnPrimary = `${btnBase} bg-[var(--color-primary)] text-white border-transparent hover:opacity-90`;
const btnSecondary = `${btnBase} bg-transparent text-[var(--color-text-muted)] border-[var(--color-border)] hover:text-[var(--color-heading)] hover:border-[var(--color-text-muted)]`;
const btnActive = `${btnBase} bg-[var(--color-primary)] text-white border-[var(--color-primary)]`;
const inputStyle =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none";
const selectStyle =
  "rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none";
const labelStyle = "block text-[10px] font-medium text-[var(--color-text-muted)] mb-1";

// ─────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────

export default function DecisionTree(): JSX.Element {
  // Dataset state
  const [datasetIndex, setDatasetIndex] = useState(0);
  const [csvInput, setCsvInput] = useState("");
  const [showCsvInput, setShowCsvInput] = useState(false);
  const [dataset, setDataset] = useState<Dataset>(PRESET_DATASETS[0]);

  // Tree parameters
  const [maxDepth, setMaxDepth] = useState(5);
  const [minSamplesLeaf, setMinSamplesLeaf] = useState(1);
  const [minImpurityDecrease, setMinImpurityDecrease] = useState(0);
  const [criterion, setCriterion] = useState<SplitCriterion>("gini");

  // Build result
  const [buildResult, setBuildResult] = useState<BuildResult | null>(null);
  const [displayTree, setDisplayTree] = useState<TreeNode | null>(null);
  const [pruneDepth, setPruneDepth] = useState(5);

  // View state
  const [activeTab, setActiveTab] = useState<ViewTab>("tree");
  const [mode, setMode] = useState<Mode>("full");
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [predictionInputs, setPredictionInputs] = useState<Record<string, string>>({});
  const [predictionResult, setPredictionResult] = useState<{
    prediction: string | number;
    path: PredictionPath[];
  } | null>(null);

  // Canvas refs
  const treeCanvasRef = useRef<HTMLCanvasElement>(null);
  const scatterCanvasRef = useRef<HTMLCanvasElement>(null);
  const importanceCanvasRef = useRef<HTMLCanvasElement>(null);

  // Layout cache
  const [treeLayouts, setTreeLayouts] = useState<NodeLayout[]>([]);

  // ─────────────────────────────────────────────────────
  // Derived
  // ─────────────────────────────────────────────────────

  const classes = useMemo(() => {
    const vals = new Set(dataset.rows.map((r) => String(r[dataset.target])));
    return [...vals].sort();
  }, [dataset]);

  const numericFeatureCount = useMemo(() => {
    return dataset.featureTypes.filter((t) => t === "numeric").length;
  }, [dataset]);

  const hasTwoNumericFeatures = numericFeatureCount >= 2;

  const numericFeatures = useMemo(() => {
    return dataset.features.filter((_, i) => dataset.featureTypes[i] === "numeric");
  }, [dataset]);

  const effectiveCriterion = useMemo((): SplitCriterion => {
    if (dataset.taskType === "regression") return "variance";
    return criterion;
  }, [dataset.taskType, criterion]);

  // ─────────────────────────────────────────────────────
  // Build Tree
  // ─────────────────────────────────────────────────────

  const handleBuild = useCallback(() => {
    const params: TreeParams = {
      maxDepth,
      minSamplesLeaf,
      minImpurityDecrease,
      criterion: effectiveCriterion,
    };

    const result = buildTree(
      dataset.rows,
      dataset.features,
      dataset.featureTypes,
      dataset.target,
      dataset.taskType,
      params,
    );

    setBuildResult(result);
    setDisplayTree(result.tree);
    setPruneDepth(getTreeDepth(result.tree));
    setSelectedNode(null);
    setPredictionResult(null);
    setStepIndex(0);
  }, [dataset, maxDepth, minSamplesLeaf, minImpurityDecrease, effectiveCriterion]);

  // Build on first render and dataset change
  useEffect(() => {
    handleBuild();
  }, [dataset]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────
  // Pruning
  // ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!buildResult) return;
    const actualDepth = getTreeDepth(buildResult.tree);
    if (pruneDepth >= actualDepth) {
      setDisplayTree(buildResult.tree);
    } else {
      setDisplayTree(pruneTree(buildResult.tree, pruneDepth));
    }
  }, [pruneDepth, buildResult]);

  // ─────────────────────────────────────────────────────
  // Dataset Switch
  // ─────────────────────────────────────────────────────

  const handleDatasetChange = useCallback(
    (idx: number) => {
      setDatasetIndex(idx);
      setShowCsvInput(false);
      const ds = PRESET_DATASETS[idx];
      setDataset(ds);
      if (ds.taskType === "regression") {
        setCriterion("variance");
      } else {
        setCriterion("gini");
      }
      setSelectedNode(null);
      setPredictionResult(null);
      setPredictionInputs({});
    },
    [],
  );

  const handleCsvLoad = useCallback(() => {
    const parsed = parseCSV(csvInput);
    if (parsed) {
      setDataset(parsed);
      setShowCsvInput(false);
      if (parsed.taskType === "regression") {
        setCriterion("variance");
      } else {
        setCriterion("gini");
      }
      setSelectedNode(null);
      setPredictionResult(null);
      setPredictionInputs({});
    }
  }, [csvInput]);

  // ─────────────────────────────────────────────────────
  // Prediction
  // ─────────────────────────────────────────────────────

  const handlePredict = useCallback(() => {
    if (!displayTree) return;
    const sample: Record<string, number | string> = {};
    for (const f of dataset.features) {
      const val = predictionInputs[f] ?? "";
      const num = Number(val);
      sample[f] = isNaN(num) ? val : num;
    }
    const result = predict(displayTree, sample);
    setPredictionResult(result);
  }, [displayTree, dataset.features, predictionInputs]);

  // ─────────────────────────────────────────────────────
  // Canvas: Tree Diagram
  // ─────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = treeCanvasRef.current;
    if (!canvas || !displayTree || activeTab !== "tree") return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const layouts = computeTreeLayout(displayTree, rect.width, rect.height);
    setTreeLayouts(layouts);

    renderTreeDiagram(
      ctx,
      layouts,
      classes,
      dataset.taskType,
      selectedNode?.id ?? null,
      predictionResult?.path ?? null,
      dpr,
    );
  }, [displayTree, activeTab, selectedNode, predictionResult, classes, dataset.taskType]);

  // ─────────────────────────────────────────────────────
  // Canvas: Scatter Plot
  // ─────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = scatterCanvasRef.current;
    if (!canvas || !displayTree || activeTab !== "scatter") return;
    if (!hasTwoNumericFeatures) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const f1 = numericFeatures[0];
    const f2 = numericFeatures[1];

    const vals1 = dataset.rows.map((r) => r[f1] as number);
    const vals2 = dataset.rows.map((r) => r[f2] as number);

    const pad = 0.1;
    const min1 = Math.min(...vals1);
    const max1 = Math.max(...vals1);
    const min2 = Math.min(...vals2);
    const max2 = Math.max(...vals2);
    const range1 = max1 - min1 || 1;
    const range2 = max2 - min2 || 1;
    const x1Range: [number, number] = [min1 - pad * range1, max1 + pad * range1];
    const x2Range: [number, number] = [min2 - pad * range2, max2 + pad * range2];

    const resolution = 50;
    const boundary = computeDecisionBoundary(
      displayTree,
      f1,
      f2,
      x1Range,
      x2Range,
      resolution,
    );

    renderScatterPlot(
      ctx,
      dataset.rows as Array<Record<string, number | string>>,
      f1,
      f2,
      dataset.target,
      classes,
      dataset.taskType,
      boundary,
      x1Range,
      x2Range,
      resolution,
      dpr,
    );
  }, [displayTree, activeTab, dataset, classes, hasTwoNumericFeatures, numericFeatures]);

  // ─────────────────────────────────────────────────────
  // Canvas: Feature Importance
  // ─────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = importanceCanvasRef.current;
    if (!canvas || !buildResult || activeTab !== "importance") return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    renderFeatureImportance(ctx, buildResult.featureImportance, dpr);
  }, [buildResult, activeTab]);

  // ─────────────────────────────────────────────────────
  // Tree Canvas Click
  // ─────────────────────────────────────────────────────

  const handleTreeClick = useCallback(
    (e: MouseEvent) => {
      const canvas = treeCanvasRef.current;
      if (!canvas || treeLayouts.length === 0) return;

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const x = (e.clientX - rect.left) * dpr;
      const y = (e.clientY - rect.top) * dpr;

      const hit = hitTestNode(treeLayouts, x, y, dpr);
      setSelectedNode(hit);
    },
    [treeLayouts],
  );

  // ─────────────────────────────────────────────────────
  // Step-by-step controls
  // ─────────────────────────────────────────────────────

  const currentStep = buildResult?.steps[stepIndex] ?? null;
  const totalSteps = buildResult?.steps.length ?? 0;

  // ─────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────

  return (
    <div class="space-y-4">
      {/* Controls Row */}
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {/* Dataset Selector */}
          <div>
            <label class={labelStyle}>Dataset</label>
            <select
              class={`${selectStyle} w-full`}
              value={showCsvInput ? -1 : datasetIndex}
              onChange={(e) => {
                const val = Number((e.target as HTMLSelectElement).value);
                if (val === -1) {
                  setShowCsvInput(true);
                } else {
                  handleDatasetChange(val);
                }
              }}
            >
              {PRESET_DATASETS.map((ds, i) => (
                <option key={ds.name} value={i}>
                  {ds.name}
                </option>
              ))}
              <option value={-1}>Custom CSV...</option>
            </select>
          </div>

          {/* Criterion */}
          <div>
            <label class={labelStyle}>Split Criterion</label>
            <select
              class={`${selectStyle} w-full`}
              value={effectiveCriterion}
              onChange={(e) => {
                const val = (e.target as HTMLSelectElement).value as SplitCriterion;
                setCriterion(val);
              }}
              disabled={dataset.taskType === "regression"}
            >
              <option value="gini">Gini Impurity</option>
              <option value="entropy">Information Gain (Entropy)</option>
              {dataset.taskType === "regression" && (
                <option value="variance">Variance Reduction</option>
              )}
            </select>
          </div>

          {/* Max Depth */}
          <div>
            <label class={labelStyle}>Max Depth: {maxDepth}</label>
            <input
              type="range"
              min={1}
              max={10}
              value={maxDepth}
              class="w-full accent-[var(--color-primary)]"
              onInput={(e) =>
                setMaxDepth(Number((e.target as HTMLInputElement).value))
              }
            />
          </div>

          {/* Min Samples */}
          <div>
            <label class={labelStyle}>Min Samples / Leaf: {minSamplesLeaf}</label>
            <input
              type="range"
              min={1}
              max={10}
              value={minSamplesLeaf}
              class="w-full accent-[var(--color-primary)]"
              onInput={(e) =>
                setMinSamplesLeaf(Number((e.target as HTMLInputElement).value))
              }
            />
          </div>
        </div>

        {/* Min Impurity Decrease + Build Button */}
        <div class="mt-3 flex flex-wrap items-end gap-4">
          <div class="flex-1 min-w-[140px]">
            <label class={labelStyle}>
              Min Impurity Decrease: {minImpurityDecrease.toFixed(3)}
            </label>
            <input
              type="range"
              min={0}
              max={0.5}
              step={0.005}
              value={minImpurityDecrease}
              class="w-full accent-[var(--color-primary)]"
              onInput={(e) =>
                setMinImpurityDecrease(
                  Number((e.target as HTMLInputElement).value),
                )
              }
            />
          </div>

          <button class={btnPrimary} onClick={handleBuild}>
            Build Tree
          </button>
        </div>
      </div>

      {/* CSV Input */}
      {showCsvInput && (
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <label class={labelStyle}>
            Paste CSV (last column is the target)
          </label>
          <textarea
            class={`${inputStyle} h-32 font-mono`}
            value={csvInput}
            placeholder={"feature1,feature2,target\n1.0,2.0,A\n3.0,4.0,B"}
            onInput={(e) => setCsvInput((e.target as HTMLTextAreaElement).value)}
          />
          <div class="mt-2 flex gap-2">
            <button class={btnPrimary} onClick={handleCsvLoad}>
              Load CSV
            </button>
            <button
              class={btnSecondary}
              onClick={() => setShowCsvInput(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Mode + View Tabs */}
      <div class="flex flex-wrap items-center gap-2">
        {/* Mode buttons */}
        <div class="flex gap-1 rounded border border-[var(--color-border)] p-0.5">
          {(["full", "step", "predict"] as Mode[]).map((m) => (
            <button
              key={m}
              class={mode === m ? btnActive : btnSecondary}
              onClick={() => {
                setMode(m);
                if (m === "step") setStepIndex(0);
                if (m === "predict") setPredictionResult(null);
              }}
            >
              {m === "full" ? "Full Tree" : m === "step" ? "Step-by-Step" : "Predict"}
            </button>
          ))}
        </div>

        <div class="mx-2 h-4 w-px bg-[var(--color-border)]" />

        {/* View tabs */}
        <div class="flex gap-1 rounded border border-[var(--color-border)] p-0.5">
          {(
            [
              { key: "tree", label: "Tree" },
              { key: "scatter", label: "Scatter" },
              { key: "importance", label: "Importance" },
              { key: "data", label: "Data" },
            ] as Array<{ key: ViewTab; label: string }>
          ).map(({ key, label }) => (
            <button
              key={key}
              class={activeTab === key ? btnActive : btnSecondary}
              onClick={() => setActiveTab(key)}
              disabled={key === "scatter" && !hasTwoNumericFeatures}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Pruning slider */}
        {buildResult && (
          <div class="ml-auto flex items-center gap-2">
            <span class="text-[10px] text-[var(--color-text-muted)]">
              Prune depth: {pruneDepth}
            </span>
            <input
              type="range"
              min={0}
              max={getTreeDepth(buildResult.tree)}
              value={pruneDepth}
              class="w-24 accent-[var(--color-primary)]"
              onInput={(e) =>
                setPruneDepth(Number((e.target as HTMLInputElement).value))
              }
            />
          </div>
        )}
      </div>

      {/* Main Canvas Area */}
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        {/* Tree View */}
        {activeTab === "tree" && (
          <canvas
            ref={treeCanvasRef}
            class="block w-full cursor-pointer"
            style={{ height: "400px" }}
            onClick={handleTreeClick}
          />
        )}

        {/* Scatter View */}
        {activeTab === "scatter" && hasTwoNumericFeatures && (
          <canvas
            ref={scatterCanvasRef}
            class="block w-full"
            style={{ height: "400px" }}
          />
        )}
        {activeTab === "scatter" && !hasTwoNumericFeatures && (
          <div class="flex h-[400px] items-center justify-center text-sm text-[var(--color-text-muted)]">
            Scatter plot requires at least 2 numeric features
          </div>
        )}

        {/* Importance View */}
        {activeTab === "importance" && (
          <canvas
            ref={importanceCanvasRef}
            class="block w-full"
            style={{ height: "250px" }}
          />
        )}

        {/* Data View */}
        {activeTab === "data" && (
          <div class="max-h-[400px] overflow-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b border-[var(--color-border)] bg-[var(--color-bg)]">
                  <th class="px-2 py-1.5 text-left text-[10px] font-medium text-[var(--color-text-muted)]">
                    #
                  </th>
                  {dataset.features.map((f) => (
                    <th
                      key={f}
                      class="px-2 py-1.5 text-left text-[10px] font-medium text-[var(--color-text-muted)]"
                    >
                      {f}
                    </th>
                  ))}
                  <th class="px-2 py-1.5 text-left text-[10px] font-bold text-[var(--color-primary)]">
                    {dataset.target}
                  </th>
                </tr>
              </thead>
              <tbody>
                {dataset.rows.map((row, i) => {
                  const isInSelected =
                    selectedNode?.indices.includes(i) ?? false;
                  return (
                    <tr
                      key={i}
                      class={`border-b border-[var(--color-border)] ${
                        isInSelected ? "bg-[var(--color-primary)]/10" : ""
                      }`}
                    >
                      <td class="px-2 py-1 text-[var(--color-text-muted)]">
                        {i}
                      </td>
                      {dataset.features.map((f) => (
                        <td key={f} class="px-2 py-1 text-[var(--color-text)]">
                          {typeof row[f] === "number"
                            ? (row[f] as number).toFixed(2)
                            : String(row[f])}
                        </td>
                      ))}
                      <td class="px-2 py-1 font-medium text-[var(--color-heading)]">
                        {String(row[dataset.target])}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Info Panels (below canvas) */}
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Step-by-Step Panel */}
        {mode === "step" && buildResult && (
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div class="mb-3 flex items-center justify-between">
              <h3 class="text-xs font-bold text-[var(--color-heading)]">
                Build Step {stepIndex + 1} / {totalSteps}
              </h3>
              <div class="flex gap-1">
                <button
                  class={btnSecondary}
                  onClick={() => setStepIndex(Math.max(0, stepIndex - 1))}
                  disabled={stepIndex === 0}
                >
                  Prev
                </button>
                <button
                  class={btnSecondary}
                  onClick={() =>
                    setStepIndex(Math.min(totalSteps - 1, stepIndex + 1))
                  }
                  disabled={stepIndex >= totalSteps - 1}
                >
                  Next
                </button>
              </div>
            </div>

            {currentStep && (
              <div class="space-y-2">
                <p class="text-xs text-[var(--color-text)]">
                  {currentStep.description}
                </p>

                {currentStep.bestSplit && (
                  <div class="rounded border border-[var(--color-border)] p-2">
                    <p class="text-[10px] font-medium text-[var(--color-accent)]">
                      Best Split
                    </p>
                    <p class="text-xs text-[var(--color-text)]">
                      Feature: {currentStep.bestSplit.feature}
                      {currentStep.bestSplit.isNumeric
                        ? ` <= ${(currentStep.bestSplit.threshold as number).toFixed(3)}`
                        : ` == ${currentStep.bestSplit.threshold}`}
                    </p>
                    <p class="text-xs text-[var(--color-text-muted)]">
                      Gain: {currentStep.bestSplit.gain.toFixed(4)} | Parent
                      impurity: {currentStep.bestSplit.parentImpurity.toFixed(4)}
                    </p>
                  </div>
                )}

                {currentStep.candidateSplits.length > 1 && (
                  <div>
                    <p class="text-[10px] font-medium text-[var(--color-text-muted)] mb-1">
                      Top Candidate Splits
                    </p>
                    <div class="max-h-24 overflow-auto">
                      {currentStep.candidateSplits.slice(0, 5).map((s, i) => (
                        <div
                          key={i}
                          class="flex justify-between text-[10px] text-[var(--color-text-muted)] py-0.5"
                        >
                          <span>
                            {s.feature}{" "}
                            {s.isNumeric
                              ? `<= ${(s.threshold as number).toFixed(2)}`
                              : `= ${s.threshold}`}
                          </span>
                          <span class="text-[var(--color-accent)]">
                            gain={s.gain.toFixed(4)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Prediction Panel */}
        {mode === "predict" && (
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <h3 class="mb-3 text-xs font-bold text-[var(--color-heading)]">
              Predict New Sample
            </h3>
            <div class="grid grid-cols-2 gap-2">
              {dataset.features.map((f, i) => (
                <div key={f}>
                  <label class={labelStyle}>{f}</label>
                  <input
                    class={inputStyle}
                    placeholder={
                      dataset.featureTypes[i] === "numeric"
                        ? "number"
                        : "value"
                    }
                    value={predictionInputs[f] ?? ""}
                    onInput={(e) =>
                      setPredictionInputs({
                        ...predictionInputs,
                        [f]: (e.target as HTMLInputElement).value,
                      })
                    }
                  />
                </div>
              ))}
            </div>
            <button class={`${btnPrimary} mt-3`} onClick={handlePredict}>
              Predict
            </button>

            {predictionResult && (
              <div class="mt-3 space-y-2">
                <div class="rounded border border-[var(--color-accent)] bg-[var(--color-accent)]/10 p-2">
                  <p class="text-xs font-bold text-[var(--color-accent)]">
                    Prediction:{" "}
                    {typeof predictionResult.prediction === "number"
                      ? predictionResult.prediction.toFixed(2)
                      : predictionResult.prediction}
                  </p>
                </div>
                <div>
                  <p class="text-[10px] font-medium text-[var(--color-text-muted)] mb-1">
                    Decision Path
                  </p>
                  {predictionResult.path.map((p, i) => (
                    <div
                      key={i}
                      class="flex items-center gap-1 text-[10px] text-[var(--color-text)] py-0.5"
                    >
                      <span class="text-[var(--color-primary)]">
                        Node {p.nodeId}
                      </span>
                      {p.direction !== "leaf" ? (
                        <span>
                          {p.feature}{" "}
                          {typeof p.threshold === "number"
                            ? `<= ${p.threshold.toFixed(2)}`
                            : `= ${p.threshold}`}{" "}
                          → {p.direction}
                        </span>
                      ) : (
                        <span class="font-bold text-[var(--color-accent)]">
                          → Leaf:{" "}
                          {typeof p.prediction === "number"
                            ? p.prediction.toFixed(2)
                            : p.prediction}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Selected Node Info */}
        {selectedNode && (
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <h3 class="mb-2 text-xs font-bold text-[var(--color-heading)]">
              Node {selectedNode.id} {selectedNode.isLeaf ? "(Leaf)" : "(Split)"}
            </h3>

            <div class="space-y-1 text-xs text-[var(--color-text)]">
              <p>
                <span class="text-[var(--color-text-muted)]">Samples:</span>{" "}
                {selectedNode.samples}
              </p>
              <p>
                <span class="text-[var(--color-text-muted)]">Impurity:</span>{" "}
                {selectedNode.impurity.toFixed(4)}
              </p>
              <p>
                <span class="text-[var(--color-text-muted)]">Prediction:</span>{" "}
                <span class="font-bold text-[var(--color-accent)]">
                  {typeof selectedNode.prediction === "number"
                    ? selectedNode.prediction.toFixed(2)
                    : selectedNode.prediction}
                </span>
              </p>

              {dataset.taskType === "classification" && (
                <div class="mt-2">
                  <p class="text-[10px] font-medium text-[var(--color-text-muted)] mb-1">
                    Class Distribution
                  </p>
                  <div class="flex flex-wrap gap-2">
                    {Object.entries(selectedNode.classCounts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([cls, count]) => {
                        const classIdx = classes.indexOf(cls);
                        return (
                          <span
                            key={cls}
                            class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
                            style={{
                              backgroundColor: `${getClassColor(classIdx)}22`,
                              color: getClassColor(classIdx),
                            }}
                          >
                            <span
                              class="inline-block h-2 w-2 rounded-full"
                              style={{
                                backgroundColor: getClassColor(classIdx),
                              }}
                            />
                            {cls}: {count}
                          </span>
                        );
                      })}
                  </div>

                  {/* Mini bar */}
                  <div class="mt-1 flex h-2 overflow-hidden rounded">
                    {Object.entries(selectedNode.classCounts).map(
                      ([cls, count]) => {
                        const classIdx = classes.indexOf(cls);
                        const pct = (count / selectedNode.samples) * 100;
                        return (
                          <div
                            key={cls}
                            style={{
                              width: `${pct}%`,
                              backgroundColor: getClassColor(classIdx),
                            }}
                          />
                        );
                      },
                    )}
                  </div>
                </div>
              )}

              {selectedNode.split && (
                <div class="mt-2 rounded border border-[var(--color-border)] p-2">
                  <p class="text-[10px] font-medium text-[var(--color-text-muted)]">
                    Split Rule
                  </p>
                  <p class="text-xs text-[var(--color-heading)]">
                    {selectedNode.split.feature}{" "}
                    {selectedNode.split.isNumeric
                      ? `<= ${(selectedNode.split.threshold as number).toFixed(3)}`
                      : `== ${selectedNode.split.threshold}`}
                  </p>
                  <p class="text-[10px] text-[var(--color-text-muted)]">
                    Gain: {selectedNode.split.gain.toFixed(4)}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tree Statistics */}
        {displayTree && (
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <h3 class="mb-2 text-xs font-bold text-[var(--color-heading)]">
              Tree Statistics
            </h3>
            <div class="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span class="text-[var(--color-text-muted)]">Depth:</span>{" "}
                <span class="text-[var(--color-heading)]">
                  {getTreeDepth(displayTree)}
                </span>
              </div>
              <div>
                <span class="text-[var(--color-text-muted)]">Nodes:</span>{" "}
                <span class="text-[var(--color-heading)]">
                  {getNodeCount(displayTree)}
                </span>
              </div>
              <div>
                <span class="text-[var(--color-text-muted)]">Task:</span>{" "}
                <span class="text-[var(--color-heading)]">
                  {dataset.taskType}
                </span>
              </div>
              <div>
                <span class="text-[var(--color-text-muted)]">Criterion:</span>{" "}
                <span class="text-[var(--color-heading)]">
                  {effectiveCriterion}
                </span>
              </div>
              <div>
                <span class="text-[var(--color-text-muted)]">Samples:</span>{" "}
                <span class="text-[var(--color-heading)]">
                  {dataset.rows.length}
                </span>
              </div>
              <div>
                <span class="text-[var(--color-text-muted)]">Features:</span>{" "}
                <span class="text-[var(--color-heading)]">
                  {dataset.features.length}
                </span>
              </div>
              {dataset.taskType === "classification" && (
                <div class="col-span-2">
                  <span class="text-[var(--color-text-muted)]">Classes:</span>{" "}
                  <span class="text-[var(--color-heading)]">
                    {classes.join(", ")}
                  </span>
                </div>
              )}
            </div>

            {/* Legend */}
            {dataset.taskType === "classification" && (
              <div class="mt-3 flex flex-wrap gap-2">
                {classes.map((cls, i) => (
                  <span
                    key={cls}
                    class="inline-flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]"
                  >
                    <span
                      class="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: getClassColor(i) }}
                    />
                    {cls}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
