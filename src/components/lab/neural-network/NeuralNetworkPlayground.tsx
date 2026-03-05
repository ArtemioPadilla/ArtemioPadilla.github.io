import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "preact/hooks";
import {
  createNetwork,
  trainStep,
  predictGrid,
  computeAccuracy,
  countParameters,
} from "./nn";
import type { Network, ActivationType } from "./nn";
import {
  generateDataset,
  splitTrainTest,
  toTuples,
  DATASET_LABELS,
} from "./datasets";
import type { DataPoint, DatasetName } from "./datasets";

/* ──────────────────────────────────────
   Constants
   ────────────────────────────────────── */

const DATASET_NAMES: DatasetName[] = [
  "circle",
  "xor",
  "spiral",
  "gaussian",
  "moon",
  "linear",
];

const ACTIVATION_OPTIONS: ActivationType[] = ["relu", "sigmoid", "tanh"];

const BATCH_SIZES = [1, 4, 8, 16, 32];

const GRID_RESOLUTION = 40;

const STEPS_PER_FRAME = 10;
const BOUNDARY_UPDATE_FRAMES = 5;

const DATA_RANGE = { min: -1.5, max: 1.5 };

const CLASS_0_DOT = "#4f8ff7";
const CLASS_1_DOT = "#f59e0b";

const MAX_HISTORY = 500;

/* ──────────────────────────────────────
   Component
   ────────────────────────────────────── */

export default function NeuralNetworkPlayground() {
  // Architecture state
  const [numLayers, setNumLayers] = useState(2);
  const [neuronsPerLayer, setNeuronsPerLayer] = useState([4, 4, 4, 4]);
  const [activation, setActivation] = useState<ActivationType>("relu");

  // Dataset state
  const [datasetName, setDatasetName] = useState<DatasetName>("circle");
  const [noise, setNoise] = useState(0.1);
  const [trainRatio, setTrainRatio] = useState(0.8);
  const [dataVersion, setDataVersion] = useState(0);

  // Training state
  const [learningRate, setLearningRate] = useState(0.03);
  const [batchSize, setBatchSize] = useState(8);
  const [isTraining, setIsTraining] = useState(false);
  const [epoch, setEpoch] = useState(0);

  // Metrics
  const [trainLoss, setTrainLoss] = useState(0);
  const [trainAcc, setTrainAcc] = useState(0);
  const [testAcc, setTestAcc] = useState(0);

  // Refs
  const networkRef = useRef<Network | null>(null);
  const trainDataRef = useRef<[number, number, number][]>([]);
  const testDataRef = useRef<[number, number, number][]>([]);
  const trainPointsRef = useRef<DataPoint[]>([]);
  const testPointsRef = useRef<DataPoint[]>([]);
  const gridRef = useRef<number[][] | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef(0);
  const frameCountRef = useRef(0);
  const epochRef = useRef(0);
  const isTrainingRef = useRef(false);
  const lossHistoryRef = useRef<number[]>([]);
  const accHistoryRef = useRef<number[]>([]);

  // Build layer sizes from architecture config
  const layerSizes = useMemo(() => {
    const sizes = [2]; // Input: 2D
    for (let i = 0; i < numLayers; i++) {
      sizes.push(neuronsPerLayer[i]);
    }
    sizes.push(1); // Output: binary
    return sizes;
  }, [numLayers, neuronsPerLayer]);

  const paramCount = useMemo(() => {
    if (!networkRef.current) return 0;
    return countParameters(networkRef.current);
  }, [epoch, layerSizes]);

  // Initialize / reset network
  const resetNetwork = useCallback(() => {
    const net = createNetwork(layerSizes, activation);
    networkRef.current = net;
    epochRef.current = 0;
    setEpoch(0);
    setTrainLoss(0);
    setTrainAcc(0);
    setTestAcc(0);
    lossHistoryRef.current = [];
    accHistoryRef.current = [];
    gridRef.current = null;
    updateGrid();
    drawCanvas();
    drawChart();
  }, [layerSizes, activation]);

  // Generate dataset
  const regenerateData = useCallback(() => {
    const data = generateDataset(datasetName, noise);
    const { train, test } = splitTrainTest(data, trainRatio);
    trainPointsRef.current = train;
    testPointsRef.current = test;
    trainDataRef.current = toTuples(train);
    testDataRef.current = toTuples(test);
    setDataVersion((v) => v + 1);
  }, [datasetName, noise, trainRatio]);

  // Update prediction grid
  const updateGrid = useCallback(() => {
    if (!networkRef.current) return;
    gridRef.current = predictGrid(
      networkRef.current,
      DATA_RANGE.min,
      DATA_RANGE.max,
      DATA_RANGE.min,
      DATA_RANGE.max,
      GRID_RESOLUTION,
    );
  }, []);

  // Draw decision boundary canvas
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Get computed background color for theme adaptation
    const bgColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-bg")
      .trim();
    ctx.fillStyle = bgColor || "#09090b";
    ctx.fillRect(0, 0, w, h);

    // Draw decision boundary grid
    const grid = gridRef.current;
    if (grid) {
      const cellW = w / GRID_RESOLUTION;
      const cellH = h / GRID_RESOLUTION;

      for (let row = 0; row < GRID_RESOLUTION; row++) {
        for (let col = 0; col < GRID_RESOLUTION; col++) {
          const p = grid[row][col];
          // Interpolate between class colors
          const r0 = 79, g0 = 143, b0 = 247; // Blue class 0
          const r1 = 245, g1 = 158, b1 = 11; // Amber class 1
          const r = Math.round(r0 + (r1 - r0) * p);
          const g = Math.round(g0 + (g1 - g0) * p);
          const b = Math.round(b0 + (b1 - b0) * p);
          const alpha = 0.15 + Math.abs(p - 0.5) * 0.5;

          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          ctx.fillRect(col * cellW, row * cellH, cellW + 1, cellH + 1);
        }
      }
    }

    // Map data coordinate to canvas pixel
    const toPixel = (val: number, size: number): number => {
      return ((val - DATA_RANGE.min) / (DATA_RANGE.max - DATA_RANGE.min)) * size;
    };

    // Draw data points
    const drawPoints = (points: DataPoint[], filled: boolean) => {
      for (const p of points) {
        const px = toPixel(p.x, w);
        const py = toPixel(p.y, h);

        ctx.beginPath();
        ctx.arc(px, py, filled ? 4 : 4.5, 0, 2 * Math.PI);

        if (filled) {
          ctx.fillStyle = p.label === 0 ? CLASS_0_DOT : CLASS_1_DOT;
          ctx.fill();
          ctx.strokeStyle = "rgba(0,0,0,0.3)";
          ctx.lineWidth = 1;
          ctx.stroke();
        } else {
          ctx.strokeStyle = p.label === 0 ? CLASS_0_DOT : CLASS_1_DOT;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    };

    // Training points (filled), then test points (hollow)
    drawPoints(trainPointsRef.current, true);
    drawPoints(testPointsRef.current, false);
  }, []);

  // Draw loss/accuracy chart
  const drawChart = useCallback(() => {
    const canvas = chartRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const pad = { top: 20, right: 12, bottom: 20, left: 40 };

    const bgColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-surface")
      .trim();
    ctx.fillStyle = bgColor || "#111111";
    ctx.fillRect(0, 0, w, h);

    const losses = lossHistoryRef.current;
    const accs = accHistoryRef.current;
    if (losses.length < 2) {
      ctx.fillStyle = "rgba(161, 161, 170, 0.3)";
      ctx.font = "12px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Training chart will appear here", w / 2, h / 2);
      return;
    }

    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    // Auto-scale loss
    const maxLoss = Math.max(0.01, ...losses);
    const yScaleLoss = plotH / maxLoss;

    // Draw grid lines
    ctx.strokeStyle = "rgba(161, 161, 170, 0.1)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (plotH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
    }

    // Y-axis labels for loss
    ctx.fillStyle = "rgba(161, 161, 170, 0.5)";
    ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      const val = maxLoss * (1 - i / 4);
      const y = pad.top + (plotH / 4) * i;
      ctx.fillText(val.toFixed(2), pad.left - 6, y + 3);
    }

    // Draw loss curve
    ctx.strokeStyle = "rgba(239, 68, 68, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < losses.length; i++) {
      const x = pad.left + (i / (losses.length - 1)) * plotW;
      const y = pad.top + plotH - losses[i] * yScaleLoss;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Draw accuracy curve
    ctx.strokeStyle = "rgba(52, 211, 153, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < accs.length; i++) {
      const x = pad.left + (i / (accs.length - 1)) * plotW;
      const y = pad.top + plotH - accs[i] * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Legend
    ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(239, 68, 68, 0.8)";
    ctx.fillText("Loss", pad.left + 4, pad.top + 12);
    ctx.fillStyle = "rgba(52, 211, 153, 0.8)";
    ctx.fillText("Accuracy", pad.left + 40, pad.top + 12);
  }, []);

  // Training loop
  const trainingLoop = useCallback(() => {
    if (!isTrainingRef.current || !networkRef.current) return;

    const net = networkRef.current;
    const trainData = trainDataRef.current;
    if (trainData.length === 0) return;

    let loss = 0;

    for (let s = 0; s < STEPS_PER_FRAME; s++) {
      // Create mini-batch
      const batch: [number, number, number][] = [];
      for (let b = 0; b < batchSize; b++) {
        const idx = Math.floor(Math.random() * trainData.length);
        batch.push(trainData[idx]);
      }
      loss = trainStep(net, batch, learningRate);

      epochRef.current++;
    }

    // Detect divergence
    if (Number.isNaN(loss) || !Number.isFinite(loss)) {
      setIsTraining(false);
      isTrainingRef.current = false;
      return;
    }

    const tAcc = computeAccuracy(net, trainDataRef.current);
    const tsAcc = computeAccuracy(net, testDataRef.current);

    setEpoch(epochRef.current);
    setTrainLoss(loss);
    setTrainAcc(tAcc);
    setTestAcc(tsAcc);

    // Append to history (with limit)
    if (lossHistoryRef.current.length < MAX_HISTORY) {
      lossHistoryRef.current.push(loss);
      accHistoryRef.current.push(tAcc);
    } else {
      // Downsample: keep every other point
      lossHistoryRef.current = lossHistoryRef.current.filter(
        (_, i) => i % 2 === 0,
      );
      accHistoryRef.current = accHistoryRef.current.filter(
        (_, i) => i % 2 === 0,
      );
      lossHistoryRef.current.push(loss);
      accHistoryRef.current.push(tAcc);
    }

    frameCountRef.current++;

    // Update decision boundary periodically
    if (frameCountRef.current % BOUNDARY_UPDATE_FRAMES === 0) {
      updateGrid();
    }

    drawCanvas();
    drawChart();

    animFrameRef.current = requestAnimationFrame(trainingLoop);
  }, [batchSize, learningRate, updateGrid, drawCanvas, drawChart]);

  // Toggle training
  const toggleTraining = useCallback(() => {
    if (isTraining) {
      setIsTraining(false);
      isTrainingRef.current = false;
      cancelAnimationFrame(animFrameRef.current);
      // Final high-res grid on pause
      updateGrid();
      drawCanvas();
    } else {
      setIsTraining(true);
      isTrainingRef.current = true;
      frameCountRef.current = 0;
      animFrameRef.current = requestAnimationFrame(trainingLoop);
    }
  }, [isTraining, trainingLoop, updateGrid, drawCanvas]);

  // Single step
  const stepOnce = useCallback(() => {
    if (!networkRef.current || trainDataRef.current.length === 0) return;

    const batch: [number, number, number][] = [];
    for (let b = 0; b < batchSize; b++) {
      const idx = Math.floor(Math.random() * trainDataRef.current.length);
      batch.push(trainDataRef.current[idx]);
    }
    const loss = trainStep(networkRef.current, batch, learningRate);
    epochRef.current++;

    if (!Number.isNaN(loss) && Number.isFinite(loss)) {
      setEpoch(epochRef.current);
      setTrainLoss(loss);

      const tAcc = computeAccuracy(networkRef.current, trainDataRef.current);
      const tsAcc = computeAccuracy(networkRef.current, testDataRef.current);
      setTrainAcc(tAcc);
      setTestAcc(tsAcc);

      if (lossHistoryRef.current.length < MAX_HISTORY) {
        lossHistoryRef.current.push(loss);
        accHistoryRef.current.push(tAcc);
      }
    }

    updateGrid();
    drawCanvas();
    drawChart();
  }, [batchSize, learningRate, updateGrid, drawCanvas, drawChart]);

  // Initialize on mount
  useEffect(() => {
    regenerateData();
    resetNetwork();
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      isTrainingRef.current = false;
    };
  }, []);

  // Re-init when architecture changes (only when not training)
  useEffect(() => {
    if (!isTraining) {
      resetNetwork();
    }
  }, [layerSizes, activation]);

  // Regenerate data when dataset params change
  useEffect(() => {
    regenerateData();
  }, [datasetName, noise, trainRatio]);

  // Redraw when data changes
  useEffect(() => {
    if (networkRef.current) {
      updateGrid();
      drawCanvas();
    }
  }, [dataVersion]);

  // Canvas resize
  useEffect(() => {
    const resizeCanvases = () => {
      const mainCanvas = canvasRef.current;
      const chart = chartRef.current;
      if (mainCanvas) {
        const rect = mainCanvas.getBoundingClientRect();
        mainCanvas.width = rect.width;
        mainCanvas.height = rect.height;
      }
      if (chart) {
        const rect = chart.getBoundingClientRect();
        chart.width = rect.width;
        chart.height = rect.height;
      }
      drawCanvas();
      drawChart();
    };

    resizeCanvases();
    window.addEventListener("resize", resizeCanvases);
    return () => window.removeEventListener("resize", resizeCanvases);
  }, [drawCanvas, drawChart]);

  // Update neurons per layer
  const setNeurons = useCallback(
    (layerIndex: number, count: number) => {
      setNeuronsPerLayer((prev) => {
        const next = [...prev];
        next[layerIndex] = count;
        return next;
      });
    },
    [],
  );

  return (
    <div
      class="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
      style={{ boxShadow: "0 0 0 1px var(--color-border)" }}
    >
      {/* Toolbar */}
      <div class="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-[var(--color-text-muted)]">
            Neural Network Playground
          </span>
          <span
            class="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
            style={{
              borderColor: "rgba(79, 143, 247, 0.3)",
              color: "var(--color-primary)",
            }}
          >
            alpha
          </span>
        </div>
        <span class="text-[10px] text-[var(--color-text-muted)]">
          {paramCount} parameters
        </span>
      </div>

      {/* Main layout */}
      <div class="flex flex-col lg:flex-row">
        {/* Left panel: Controls */}
        <div class="border-b border-[var(--color-border)] p-4 lg:w-72 lg:shrink-0 lg:border-r lg:border-b-0">
          {/* Architecture */}
          <Section title="Architecture">
            {/* Hidden layers count */}
            <Label text="Hidden Layers" />
            <div class="mb-3 flex gap-1">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  onClick={() => {
                    if (isTraining) return;
                    setNumLayers(n);
                  }}
                  class="flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold transition-all"
                  style={{
                    borderColor:
                      numLayers === n
                        ? "var(--color-primary)"
                        : "var(--color-border)",
                    backgroundColor:
                      numLayers === n
                        ? "rgba(79, 143, 247, 0.15)"
                        : "transparent",
                    color:
                      numLayers === n
                        ? "var(--color-primary)"
                        : "var(--color-text-muted)",
                    opacity: isTraining ? 0.5 : 1,
                    cursor: isTraining ? "not-allowed" : "pointer",
                  }}
                >
                  {n}
                </button>
              ))}
            </div>

            {/* Neurons per layer */}
            {Array.from({ length: numLayers }).map((_, i) => (
              <div key={i} class="mb-2">
                <div class="flex items-center justify-between">
                  <span class="text-[10px] text-[var(--color-text-muted)]">
                    Layer {i + 1}
                  </span>
                  <span
                    class="text-[10px] font-semibold"
                    style={{ color: "var(--color-primary)" }}
                  >
                    {neuronsPerLayer[i]}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={neuronsPerLayer[i]}
                  onInput={(e) =>
                    setNeurons(i, parseInt((e.target as HTMLInputElement).value))
                  }
                  class="nn-slider w-full"
                  disabled={isTraining}
                />
              </div>
            ))}

            {/* Activation */}
            <Label text="Activation" />
            <div class="mb-1 flex gap-1">
              {ACTIVATION_OPTIONS.map((act) => (
                <button
                  key={act}
                  onClick={() => {
                    if (isTraining) return;
                    setActivation(act);
                  }}
                  class="flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-all"
                  style={{
                    borderColor:
                      activation === act
                        ? "var(--color-primary)"
                        : "var(--color-border)",
                    backgroundColor:
                      activation === act
                        ? "rgba(79, 143, 247, 0.15)"
                        : "transparent",
                    color:
                      activation === act
                        ? "var(--color-primary)"
                        : "var(--color-text-muted)",
                    opacity: isTraining ? 0.5 : 1,
                    cursor: isTraining ? "not-allowed" : "pointer",
                  }}
                >
                  {act}
                </button>
              ))}
            </div>
          </Section>

          {/* Network Diagram */}
          <Section title="Network">
            <NetworkDiagram layerSizes={layerSizes} />
          </Section>

          {/* Dataset */}
          <Section title="Dataset">
            <div class="mb-3">
              <select
                value={datasetName}
                onChange={(e) =>
                  setDatasetName(
                    (e.target as HTMLSelectElement).value as DatasetName,
                  )
                }
                class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none transition-colors hover:border-[var(--color-primary)]"
              >
                {DATASET_NAMES.map((name) => (
                  <option key={name} value={name}>
                    {DATASET_LABELS[name]}
                  </option>
                ))}
              </select>
            </div>

            <div class="mb-3">
              <div class="flex items-center justify-between">
                <span class="text-[10px] text-[var(--color-text-muted)]">
                  Noise
                </span>
                <span class="text-[10px] font-semibold text-[var(--color-primary)]">
                  {noise.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={50}
                value={noise * 100}
                onInput={(e) =>
                  setNoise(
                    parseInt((e.target as HTMLInputElement).value) / 100,
                  )
                }
                class="nn-slider w-full"
              />
            </div>

            <div class="mb-3">
              <div class="flex items-center justify-between">
                <span class="text-[10px] text-[var(--color-text-muted)]">
                  Train ratio
                </span>
                <span class="text-[10px] font-semibold text-[var(--color-primary)]">
                  {Math.round(trainRatio * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={50}
                max={90}
                value={trainRatio * 100}
                onInput={(e) =>
                  setTrainRatio(
                    parseInt((e.target as HTMLInputElement).value) / 100,
                  )
                }
                class="nn-slider w-full"
              />
            </div>

            <button
              onClick={() => regenerateData()}
              class="w-full rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
            >
              Regenerate
            </button>
          </Section>

          {/* Training */}
          <Section title="Training">
            <div class="mb-3">
              <div class="flex items-center justify-between">
                <span class="text-[10px] text-[var(--color-text-muted)]">
                  Learning rate
                </span>
                <span class="text-[10px] font-semibold text-[var(--color-primary)]">
                  {learningRate.toFixed(4)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={lrToSlider(learningRate)}
                onInput={(e) =>
                  setLearningRate(
                    sliderToLr(
                      parseInt((e.target as HTMLInputElement).value),
                    ),
                  )
                }
                class="nn-slider w-full"
              />
            </div>

            <div class="mb-3">
              <Label text="Batch size" />
              <select
                value={batchSize}
                onChange={(e) =>
                  setBatchSize(
                    parseInt((e.target as HTMLSelectElement).value),
                  )
                }
                class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none transition-colors hover:border-[var(--color-primary)]"
              >
                {BATCH_SIZES.map((bs) => (
                  <option key={bs} value={bs}>
                    {bs}
                  </option>
                ))}
              </select>
            </div>

            <div class="flex gap-2">
              <button
                onClick={toggleTraining}
                class="flex-1 rounded-lg px-3 py-2 text-xs font-semibold text-white transition-all"
                style={{
                  backgroundColor: isTraining
                    ? "rgba(239, 68, 68, 0.8)"
                    : "var(--color-primary)",
                }}
              >
                {isTraining ? "Pause" : "Train"}
              </button>
              <button
                onClick={() => {
                  if (isTraining) {
                    setIsTraining(false);
                    isTrainingRef.current = false;
                    cancelAnimationFrame(animFrameRef.current);
                  }
                  resetNetwork();
                }}
                class="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
                title="Reset weights"
              >
                Reset
              </button>
              <button
                onClick={stepOnce}
                class="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
                title="Single training step"
                disabled={isTraining}
              >
                Step
              </button>
            </div>

            <div class="mt-3 text-center text-[10px] text-[var(--color-text-muted)]">
              Epoch: <span class="font-semibold text-[var(--color-heading)]">{epoch}</span>
            </div>
          </Section>
        </div>

        {/* Right panel: Visualization */}
        <div class="flex flex-1 flex-col">
          {/* Decision boundary canvas */}
          <div class="relative" style={{ aspectRatio: "1 / 1", maxHeight: "480px" }}>
            <canvas
              ref={canvasRef}
              class="h-full w-full"
              style={{ display: "block" }}
            />
            {/* Legend overlay */}
            <div
              class="absolute bottom-2 left-2 flex items-center gap-3 rounded-lg px-2.5 py-1.5"
              style={{ backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
            >
              <span class="flex items-center gap-1 text-[10px] text-white">
                <span
                  class="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: CLASS_0_DOT }}
                />
                Class 0
              </span>
              <span class="flex items-center gap-1 text-[10px] text-white">
                <span
                  class="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: CLASS_1_DOT }}
                />
                Class 1
              </span>
              <span class="flex items-center gap-1 text-[10px] text-white">
                <span
                  class="inline-block h-2.5 w-2.5 rounded-full border border-white"
                  style={{ backgroundColor: "transparent" }}
                />
                Test
              </span>
            </div>
          </div>

          {/* Chart */}
          <div
            class="border-t border-[var(--color-border)]"
            style={{ height: "120px" }}
          >
            <canvas
              ref={chartRef}
              class="h-full w-full"
              style={{ display: "block" }}
            />
          </div>

          {/* Metrics bar */}
          <div class="flex flex-wrap items-center justify-around gap-2 border-t border-[var(--color-border)] px-4 py-3">
            <Metric label="Loss" value={trainLoss.toFixed(4)} color="rgba(239, 68, 68, 0.8)" />
            <Metric
              label="Train Acc"
              value={`${(trainAcc * 100).toFixed(1)}%`}
              color="rgba(52, 211, 153, 0.8)"
            />
            <Metric
              label="Test Acc"
              value={`${(testAcc * 100).toFixed(1)}%`}
              color="var(--color-primary)"
            />
            <Metric
              label="Epoch"
              value={epoch.toString()}
              color="var(--color-text-muted)"
            />
          </div>
        </div>
      </div>

      {/* Inline styles for sliders */}
      <style>{`
        .nn-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          border-radius: 2px;
          background: var(--color-border);
          outline: none;
          cursor: pointer;
        }
        .nn-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--color-primary);
          cursor: pointer;
          border: 2px solid var(--color-surface);
          box-shadow: 0 0 0 1px var(--color-primary);
        }
        .nn-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--color-primary);
          cursor: pointer;
          border: 2px solid var(--color-surface);
          box-shadow: 0 0 0 1px var(--color-primary);
        }
        .nn-slider:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}

/* ──────────────────────────────────────
   Sub-components
   ────────────────────────────────────── */

function Section({
  title,
  children,
}: {
  title: string;
  children: preact.ComponentChildren;
}) {
  return (
    <div class="mb-4">
      <h3 class="mb-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Label({ text }: { text: string }) {
  return (
    <span class="mb-1 block text-[10px] text-[var(--color-text-muted)]">
      {text}
    </span>
  );
}

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div class="text-center">
      <div class="text-[10px] text-[var(--color-text-muted)]">{label}</div>
      <div class="text-sm font-semibold" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function NetworkDiagram({ layerSizes }: { layerSizes: number[] }) {
  const svgWidth = 220;
  const svgHeight = 80;
  const layerCount = layerSizes.length;
  const xSpacing = svgWidth / (layerCount + 1);

  const getY = (layerIdx: number, neuronIdx: number): number => {
    const count = layerSizes[layerIdx];
    const totalH = Math.min(count * 14, svgHeight - 10);
    const startY = (svgHeight - totalH) / 2;
    return startY + (neuronIdx / Math.max(count - 1, 1)) * totalH;
  };

  const getX = (layerIdx: number): number => {
    return (layerIdx + 1) * xSpacing;
  };

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      style={{ maxHeight: "80px" }}
    >
      {/* Connections */}
      {layerSizes.map((_, li) => {
        if (li === 0) return null;
        const lines: preact.JSX.Element[] = [];
        for (let from = 0; from < layerSizes[li - 1]; from++) {
          for (let to = 0; to < layerSizes[li]; to++) {
            lines.push(
              <line
                key={`${li}-${from}-${to}`}
                x1={getX(li - 1)}
                y1={getY(li - 1, from)}
                x2={getX(li)}
                y2={getY(li, to)}
                stroke="var(--color-border)"
                stroke-width="0.5"
                opacity="0.5"
              />,
            );
          }
        }
        return lines;
      })}
      {/* Neurons */}
      {layerSizes.map((count, li) => {
        const isInput = li === 0;
        const isOutput = li === layerSizes.length - 1;
        return Array.from({ length: count }).map((_, ni) => (
          <circle
            key={`n-${li}-${ni}`}
            cx={getX(li)}
            cy={getY(li, ni)}
            r={4}
            fill={
              isInput
                ? "var(--color-text-muted)"
                : isOutput
                  ? "var(--color-accent)"
                  : "var(--color-primary)"
            }
            stroke="var(--color-surface)"
            stroke-width="1"
          />
        ));
      })}
      {/* Layer labels */}
      {layerSizes.map((_, li) => {
        const isInput = li === 0;
        const isOutput = li === layerSizes.length - 1;
        const label = isInput ? "In" : isOutput ? "Out" : `H${li}`;
        return (
          <text
            key={`label-${li}`}
            x={getX(li)}
            y={svgHeight - 2}
            text-anchor="middle"
            fill="var(--color-text-muted)"
            font-size="8"
            font-family="Inter, sans-serif"
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}

/* ──────────────────────────────────────
   Helpers
   ────────────────────────────────────── */

/** Map learning rate to log-scale slider (0-100) */
function lrToSlider(lr: number): number {
  // lr range: 0.001 to 1.0
  // log scale: slider = (log(lr) - log(0.001)) / (log(1) - log(0.001)) * 100
  const logMin = Math.log(0.001);
  const logMax = Math.log(1.0);
  return ((Math.log(lr) - logMin) / (logMax - logMin)) * 100;
}

/** Map slider value (0-100) back to log-scale learning rate */
function sliderToLr(slider: number): number {
  const logMin = Math.log(0.001);
  const logMax = Math.log(1.0);
  return Math.exp(logMin + (slider / 100) * (logMax - logMin));
}
