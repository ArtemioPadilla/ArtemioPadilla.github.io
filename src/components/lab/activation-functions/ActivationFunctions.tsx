import { useState, useEffect, useRef, useCallback } from "preact/hooks";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

interface ActivationFn {
  id: string;
  name: string;
  color: string;
  fn: (x: number, params?: FnParams) => number;
  derivative: (x: number, params?: FnParams) => number;
  properties: FnProperties;
  hasParams?: boolean;
}

interface FnParams {
  leakyAlpha: number;
  eluAlpha: number;
}

interface FnProperties {
  range: string;
  monotonic: boolean;
  zeroCentered: boolean;
  differentiableEverywhere: boolean;
  deadNeuronProblem: boolean;
  computationalCost: "Low" | "Medium" | "High";
  useCase: string;
}

interface HoverInfo {
  canvasX: number;
  mathX: number;
  values: Array<{ name: string; color: string; value: number }>;
}

interface Preset {
  name: string;
  ids: string[];
}

// ─────────────────────────────────────────────────────────
// Math Helpers
// ─────────────────────────────────────────────────────────

function sigmoid(x: number): number {
  if (x >= 0) {
    return 1 / (1 + Math.exp(-x));
  }
  const expX = Math.exp(x);
  return expX / (1 + expX);
}

function softplus(x: number): number {
  // Numerically stable: log(1 + exp(x))
  if (x > 20) return x;
  if (x < -20) return 0;
  return Math.log(1 + Math.exp(x));
}

// Approximate GELU: 0.5 * x * (1 + tanh(sqrt(2/pi) * (x + 0.044715 * x^3)))
const SQRT_2_OVER_PI = Math.sqrt(2 / Math.PI);

function gelu(x: number): number {
  const inner = SQRT_2_OVER_PI * (x + 0.044715 * x * x * x);
  return 0.5 * x * (1 + Math.tanh(inner));
}

function geluDerivative(x: number): number {
  const cube = x * x * x;
  const inner = SQRT_2_OVER_PI * (x + 0.044715 * cube);
  const tanhInner = Math.tanh(inner);
  const sech2 = 1 - tanhInner * tanhInner;
  const dInner = SQRT_2_OVER_PI * (1 + 3 * 0.044715 * x * x);
  return 0.5 * (1 + tanhInner) + 0.5 * x * sech2 * dInner;
}

function swish(x: number): number {
  return x * sigmoid(x);
}

function swishDerivative(x: number): number {
  const s = sigmoid(x);
  return s + x * s * (1 - s);
}

function mish(x: number): number {
  return x * Math.tanh(softplus(x));
}

function mishDerivative(x: number): number {
  const sp = softplus(x);
  const tanhSp = Math.tanh(sp);
  const sech2Sp = 1 - tanhSp * tanhSp;
  const sigmoidX = sigmoid(x);
  return tanhSp + x * sech2Sp * sigmoidX;
}

// ─────────────────────────────────────────────────────────
// Activation Function Definitions
// ─────────────────────────────────────────────────────────

const ACTIVATION_FUNCTIONS: ActivationFn[] = [
  {
    id: "relu",
    name: "ReLU",
    color: "#4f8ff7",
    fn: (x) => Math.max(0, x),
    derivative: (x) => (x > 0 ? 1 : 0),
    properties: {
      range: "[0, +inf)",
      monotonic: true,
      zeroCentered: false,
      differentiableEverywhere: false,
      deadNeuronProblem: true,
      computationalCost: "Low",
      useCase: "Default for hidden layers in most networks",
    },
  },
  {
    id: "leaky-relu",
    name: "Leaky ReLU",
    color: "#3a6fd8",
    fn: (x, p) => (x > 0 ? x : (p?.leakyAlpha ?? 0.01) * x),
    derivative: (x, p) => (x > 0 ? 1 : p?.leakyAlpha ?? 0.01),
    hasParams: true,
    properties: {
      range: "(-inf, +inf)",
      monotonic: true,
      zeroCentered: false,
      differentiableEverywhere: false,
      deadNeuronProblem: false,
      computationalCost: "Low",
      useCase: "Drop-in ReLU replacement to avoid dead neurons",
    },
  },
  {
    id: "elu",
    name: "ELU",
    color: "#7aadff",
    fn: (x, p) => {
      const alpha = p?.eluAlpha ?? 1.0;
      return x > 0 ? x : alpha * (Math.exp(x) - 1);
    },
    derivative: (x, p) => {
      const alpha = p?.eluAlpha ?? 1.0;
      return x > 0 ? 1 : alpha * Math.exp(x);
    },
    hasParams: true,
    properties: {
      range: "(-alpha, +inf)",
      monotonic: true,
      zeroCentered: true,
      differentiableEverywhere: true,
      deadNeuronProblem: false,
      computationalCost: "Medium",
      useCase: "Faster convergence with near-zero-centered outputs",
    },
  },
  {
    id: "gelu",
    name: "GELU",
    color: "#34d399",
    fn: (x) => gelu(x),
    derivative: (x) => geluDerivative(x),
    properties: {
      range: "(-0.17, +inf)",
      monotonic: false,
      zeroCentered: false,
      differentiableEverywhere: true,
      deadNeuronProblem: false,
      computationalCost: "Medium",
      useCase: "Default in Transformers (BERT, GPT)",
    },
  },
  {
    id: "swish",
    name: "Swish/SiLU",
    color: "#10b981",
    fn: (x) => swish(x),
    derivative: (x) => swishDerivative(x),
    properties: {
      range: "(-0.28, +inf)",
      monotonic: false,
      zeroCentered: false,
      differentiableEverywhere: true,
      deadNeuronProblem: false,
      computationalCost: "Medium",
      useCase: "EfficientNet, modern ConvNets",
    },
  },
  {
    id: "mish",
    name: "Mish",
    color: "#059669",
    fn: (x) => mish(x),
    derivative: (x) => mishDerivative(x),
    properties: {
      range: "(-0.31, +inf)",
      monotonic: false,
      zeroCentered: false,
      differentiableEverywhere: true,
      deadNeuronProblem: false,
      computationalCost: "High",
      useCase: "YOLOv4, object detection models",
    },
  },
  {
    id: "sigmoid",
    name: "Sigmoid",
    color: "#f59e0b",
    fn: (x) => sigmoid(x),
    derivative: (x) => {
      const s = sigmoid(x);
      return s * (1 - s);
    },
    properties: {
      range: "(0, 1)",
      monotonic: true,
      zeroCentered: false,
      differentiableEverywhere: true,
      deadNeuronProblem: false,
      computationalCost: "Medium",
      useCase: "Output layer for binary classification",
    },
  },
  {
    id: "tanh",
    name: "Tanh",
    color: "#ef4444",
    fn: (x) => Math.tanh(x),
    derivative: (x) => 1 - Math.tanh(x) ** 2,
    properties: {
      range: "(-1, 1)",
      monotonic: true,
      zeroCentered: true,
      differentiableEverywhere: true,
      deadNeuronProblem: false,
      computationalCost: "Medium",
      useCase: "RNNs, LSTMs, zero-centered hidden layers",
    },
  },
  {
    id: "softplus",
    name: "Softplus",
    color: "#a855f7",
    fn: (x) => softplus(x),
    derivative: (x) => sigmoid(x),
    properties: {
      range: "(0, +inf)",
      monotonic: true,
      zeroCentered: false,
      differentiableEverywhere: true,
      deadNeuronProblem: false,
      computationalCost: "Medium",
      useCase: "Smooth ReLU approximation, variance parameters",
    },
  },
  {
    id: "step",
    name: "Step",
    color: "#71717a",
    fn: (x) => (x >= 0 ? 1 : 0),
    derivative: () => 0,
    properties: {
      range: "{0, 1}",
      monotonic: true,
      zeroCentered: false,
      differentiableEverywhere: false,
      deadNeuronProblem: true,
      computationalCost: "Low",
      useCase: "Perceptrons (historical, not used in backprop)",
    },
  },
];

// ─────────────────────────────────────────────────────────
// Comparison Presets
// ─────────────────────────────────────────────────────────

const PRESETS: Preset[] = [
  { name: "Classic", ids: ["relu", "sigmoid", "tanh"] },
  { name: "Modern", ids: ["gelu", "swish", "mish"] },
  { name: "ReLU Family", ids: ["relu", "leaky-relu", "elu"] },
  { name: "All Smooth", ids: ["gelu", "swish", "mish", "sigmoid", "tanh", "softplus"] },
];

// ─────────────────────────────────────────────────────────
// Plot Constants
// ─────────────────────────────────────────────────────────

const X_MIN = -6;
const X_MAX = 6;
const Y_MIN = -2;
const Y_MAX = 4;
const X_RANGE = X_MAX - X_MIN;
const Y_RANGE = Y_MAX - Y_MIN;
const CANVAS_HEIGHT_RATIO = 0.5; // aspect ratio for the plot
const DEFAULT_SELECTED = ["relu", "gelu"];

// ─────────────────────────────────────────────────────────
// Canvas Drawing Functions
// ─────────────────────────────────────────────────────────

function getThemeColors(): { bg: string; grid: string; axis: string; text: string; textMuted: string } {
  if (typeof window === "undefined") {
    return { bg: "#111111", grid: "#27272a", axis: "#a1a1aa", text: "#e4e4e7", textMuted: "#a1a1aa" };
  }
  const style = getComputedStyle(document.documentElement);
  return {
    bg: style.getPropertyValue("--color-surface").trim() || "#111111",
    grid: style.getPropertyValue("--color-border").trim() || "#27272a",
    axis: style.getPropertyValue("--color-text-muted").trim() || "#a1a1aa",
    text: style.getPropertyValue("--color-text").trim() || "#e4e4e7",
    textMuted: style.getPropertyValue("--color-text-muted").trim() || "#a1a1aa",
  };
}

function mathToCanvas(
  mathX: number,
  mathY: number,
  canvasW: number,
  canvasH: number
): [number, number] {
  const px = ((mathX - X_MIN) / X_RANGE) * canvasW;
  const py = ((Y_MAX - mathY) / Y_RANGE) * canvasH; // Y is inverted on canvas
  return [px, py];
}

function canvasToMath(
  canvasX: number,
  canvasY: number,
  canvasW: number,
  canvasH: number
): [number, number] {
  const mathX = X_MIN + (canvasX / canvasW) * X_RANGE;
  const mathY = Y_MAX - (canvasY / canvasH) * Y_RANGE;
  return [mathX, mathY];
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, colors: ReturnType<typeof getThemeColors>) {
  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;

  // Vertical grid lines (every 1 unit)
  for (let x = Math.ceil(X_MIN); x <= Math.floor(X_MAX); x++) {
    const [px] = mathToCanvas(x, 0, w, h);
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
  }

  // Horizontal grid lines (every 1 unit)
  for (let y = Math.ceil(Y_MIN); y <= Math.floor(Y_MAX); y++) {
    const [, py] = mathToCanvas(0, y, w, h);
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(w, py);
    ctx.stroke();
  }
}

function drawAxes(ctx: CanvasRenderingContext2D, w: number, h: number, colors: ReturnType<typeof getThemeColors>) {
  ctx.strokeStyle = colors.axis;
  ctx.lineWidth = 1.5;

  // X axis (y=0)
  const [, yAxis] = mathToCanvas(0, 0, w, h);
  if (yAxis >= 0 && yAxis <= h) {
    ctx.beginPath();
    ctx.moveTo(0, yAxis);
    ctx.lineTo(w, yAxis);
    ctx.stroke();
  }

  // Y axis (x=0)
  const [xAxis] = mathToCanvas(0, 0, w, h);
  if (xAxis >= 0 && xAxis <= w) {
    ctx.beginPath();
    ctx.moveTo(xAxis, 0);
    ctx.lineTo(xAxis, h);
    ctx.stroke();
  }

  // Axis labels
  ctx.fillStyle = colors.textMuted;
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";

  // X-axis tick labels
  for (let x = Math.ceil(X_MIN); x <= Math.floor(X_MAX); x++) {
    if (x === 0) continue;
    const [px] = mathToCanvas(x, 0, w, h);
    const labelY = Math.min(Math.max(yAxis + 14, 14), h - 4);
    ctx.fillText(String(x), px, labelY);
  }

  // Y-axis tick labels
  ctx.textAlign = "right";
  for (let y = Math.ceil(Y_MIN); y <= Math.floor(Y_MAX); y++) {
    if (y === 0) continue;
    const [, py] = mathToCanvas(0, y, w, h);
    const labelX = Math.max(Math.min(xAxis - 6, w - 6), 20);
    ctx.fillText(String(y), labelX, py + 4);
  }

  // Origin label
  ctx.textAlign = "right";
  const originLabelX = Math.max(Math.min(xAxis - 6, w - 6), 14);
  const originLabelY = Math.min(Math.max(yAxis + 14, 14), h - 4);
  ctx.fillText("0", originLabelX, originLabelY);
}

function drawFunction(
  ctx: CanvasRenderingContext2D,
  fn: (x: number) => number,
  color: string,
  w: number,
  h: number,
  lineWidth: number = 2
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();

  let started = false;

  for (let px = 0; px <= w; px++) {
    const mathX = X_MIN + (px / w) * X_RANGE;
    const mathY = fn(mathX);

    if (!Number.isFinite(mathY)) {
      started = false;
      continue;
    }

    const [, py] = mathToCanvas(mathX, mathY, w, h);

    // Clip to reasonable range
    if (py < -h || py > 2 * h) {
      started = false;
      continue;
    }

    if (!started) {
      ctx.moveTo(px, py);
      started = true;
    } else {
      ctx.lineTo(px, py);
    }
  }

  ctx.stroke();
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  functions: ActivationFn[],
  w: number,
  showDerivative: boolean,
  colors: ReturnType<typeof getThemeColors>
) {
  const padding = 10;
  const lineHeight = 18;
  const boxWidth = 14;
  const gapAfterBox = 6;
  const legendHeight = padding * 2 + functions.length * lineHeight;

  // Measure widest label
  ctx.font = "12px system-ui, sans-serif";
  let maxLabelWidth = 0;
  for (const f of functions) {
    const label = showDerivative ? `${f.name}'` : f.name;
    const measured = ctx.measureText(label).width;
    if (measured > maxLabelWidth) maxLabelWidth = measured;
  }

  const legendWidth = padding * 2 + boxWidth + gapAfterBox + maxLabelWidth;
  const legendX = w - legendWidth - 10;
  const legendY = 10;

  // Background
  ctx.fillStyle = colors.bg + "dd";
  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(legendX, legendY, legendWidth, legendHeight, 6);
  ctx.fill();
  ctx.stroke();

  // Entries
  for (let i = 0; i < functions.length; i++) {
    const f = functions[i];
    const y = legendY + padding + i * lineHeight;

    // Color swatch
    ctx.fillStyle = f.color;
    ctx.fillRect(legendX + padding, y + 2, boxWidth, 10);

    // Label
    ctx.fillStyle = colors.text;
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "left";
    const label = showDerivative ? `${f.name}'` : f.name;
    ctx.fillText(label, legendX + padding + boxWidth + gapAfterBox, y + 11);
  }
}

function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  hover: HoverInfo,
  w: number,
  h: number,
  colors: ReturnType<typeof getThemeColors>
) {
  // Vertical line
  ctx.strokeStyle = colors.axis + "60";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(hover.canvasX, 0);
  ctx.lineTo(hover.canvasX, h);
  ctx.stroke();
  ctx.setLineDash([]);

  // X label at bottom
  ctx.fillStyle = colors.bg + "ee";
  ctx.font = "11px monospace";
  const xLabel = `x = ${hover.mathX.toFixed(2)}`;
  const xLabelWidth = ctx.measureText(xLabel).width + 8;
  const [, yAxisPos] = mathToCanvas(0, 0, w, h);
  const xLabelY = Math.min(Math.max(yAxisPos + 2, 2), h - 20);
  ctx.fillRect(hover.canvasX - xLabelWidth / 2, xLabelY, xLabelWidth, 16);
  ctx.fillStyle = colors.text;
  ctx.textAlign = "center";
  ctx.fillText(xLabel, hover.canvasX, xLabelY + 12);

  // Value labels along the crosshair
  for (const entry of hover.values) {
    const [, py] = mathToCanvas(hover.mathX, entry.value, w, h);

    if (py < -10 || py > h + 10) continue;

    // Dot on curve
    ctx.beginPath();
    ctx.arc(hover.canvasX, py, 4, 0, Math.PI * 2);
    ctx.fillStyle = entry.color;
    ctx.fill();
    ctx.strokeStyle = colors.bg;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Value tooltip
    const valueLabel = `${entry.name}: ${entry.value.toFixed(3)}`;
    ctx.font = "11px monospace";
    const valueLabelWidth = ctx.measureText(valueLabel).width + 10;

    // Position tooltip to the right, or left if near edge
    let tooltipX = hover.canvasX + 10;
    if (tooltipX + valueLabelWidth > w - 10) {
      tooltipX = hover.canvasX - valueLabelWidth - 10;
    }

    const tooltipY = py - 8;

    ctx.fillStyle = colors.bg + "ee";
    ctx.strokeStyle = entry.color + "60";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(tooltipX, tooltipY, valueLabelWidth, 16, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = entry.color;
    ctx.textAlign = "left";
    ctx.fillText(valueLabel, tooltipX + 5, tooltipY + 12);
  }
}

// ─────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────

export default function ActivationFunctions() {
  const [selectedIds, setSelectedIds] = useState<string[]>(DEFAULT_SELECTED);
  const [showDerivative, setShowDerivative] = useState(false);
  const [leakyAlpha, setLeakyAlpha] = useState(0.01);
  const [eluAlpha, setEluAlpha] = useState(1.0);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(800);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const params: FnParams = { leakyAlpha, eluAlpha };

  const selectedFunctions = ACTIVATION_FUNCTIONS.filter((f) =>
    selectedIds.includes(f.id)
  );

  const canvasHeight = Math.round(canvasWidth * CANVAS_HEIGHT_RATIO);

  // ── Responsive sizing ──
  useEffect(() => {
    function handleResize() {
      if (containerRef.current) {
        const width = containerRef.current.clientWidth;
        setCanvasWidth(width);
      }
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // ── Canvas rendering ──
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const colors = getThemeColors();

    // Clear
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, w, h);

    // Grid, axes
    drawGrid(ctx, w, h, colors);
    drawAxes(ctx, w, h, colors);

    // Draw each selected function
    for (const fn of selectedFunctions) {
      const evaluator = showDerivative
        ? (x: number) => fn.derivative(x, params)
        : (x: number) => fn.fn(x, params);
      drawFunction(ctx, evaluator, fn.color, w, h);
    }

    // Legend
    if (selectedFunctions.length > 0) {
      drawLegend(ctx, selectedFunctions, w, showDerivative, colors);
    }

    // Crosshair on hover
    if (hoverInfo) {
      drawCrosshair(ctx, hoverInfo, w, h, colors);
    }
  }, [selectedFunctions, showDerivative, params, hoverInfo, canvasWidth, canvasHeight]);

  // Re-render on state changes
  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // ── Mouse hover handler ──
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const px = (e.clientX - rect.left) * scaleX;
      const py = (e.clientY - rect.top) * scaleY;

      const [mathX] = canvasToMath(px, py, canvas.width, canvas.height);

      if (mathX < X_MIN || mathX > X_MAX) {
        setHoverInfo(null);
        return;
      }

      const values = selectedFunctions.map((fn) => {
        const evaluator = showDerivative
          ? fn.derivative(mathX, params)
          : fn.fn(mathX, params);
        return { name: fn.name, color: fn.color, value: evaluator };
      });

      setHoverInfo({ canvasX: px, mathX, values });
    },
    [selectedFunctions, showDerivative, params]
  );

  const handleMouseLeave = useCallback(() => {
    setHoverInfo(null);
  }, []);

  // ── Toggle a function ──
  const toggleFunction = useCallback((id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((fid) => fid !== id);
      }
      return [...prev, id];
    });
  }, []);

  // ── Apply preset ──
  const applyPreset = useCallback((ids: string[]) => {
    setSelectedIds(ids);
  }, []);

  // ── Check if parametric functions are selected ──
  const showLeakyAlphaSlider = selectedIds.includes("leaky-relu");
  const showEluAlphaSlider = selectedIds.includes("elu");

  return (
    <div class="af-root overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Function selector */}
      <div class="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
        {ACTIVATION_FUNCTIONS.map((fn) => {
          const isActive = selectedIds.includes(fn.id);
          return (
            <button
              key={fn.id}
              onClick={() => toggleFunction(fn.id)}
              class="af-fn-toggle flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all"
              style={{
                background: isActive ? fn.color + "20" : "transparent",
                border: `1px solid ${isActive ? fn.color + "60" : "var(--color-border)"}`,
                color: isActive ? fn.color : "var(--color-text-muted)",
              }}
            >
              <span
                class="inline-block h-2.5 w-2.5 rounded-full"
                style={{
                  background: isActive ? fn.color : "var(--color-border)",
                }}
              />
              {fn.name}
            </button>
          );
        })}

        {/* Derivative toggle */}
        <button
          onClick={() => setShowDerivative((prev) => !prev)}
          class="ml-auto rounded-lg px-3 py-1 text-xs font-semibold transition-all"
          style={{
            background: showDerivative
              ? "var(--color-primary)"
              : "transparent",
            border: showDerivative
              ? "1px solid var(--color-primary)"
              : "1px solid var(--color-border)",
            color: showDerivative ? "#fff" : "var(--color-text-muted)",
          }}
        >
          {showDerivative ? "f'(x)" : "f'(x)"}
        </button>
      </div>

      {/* Presets + parameters */}
      <div class="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
        <span class="text-xs text-[var(--color-text-muted)]">Presets:</span>
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            onClick={() => applyPreset(preset.ids)}
            class="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
          >
            {preset.name}
          </button>
        ))}

        {/* Parameter sliders inline */}
        {showLeakyAlphaSlider && (
          <div class="ml-4 flex items-center gap-2">
            <label class="text-[11px] text-[var(--color-text-muted)]">
              Leaky alpha:
            </label>
            <input
              type="range"
              min="1"
              max="50"
              step="1"
              value={Math.round(leakyAlpha * 100)}
              onInput={(e) =>
                setLeakyAlpha(
                  Number((e.target as HTMLInputElement).value) / 100
                )
              }
              class="af-slider w-20"
            />
            <span class="font-mono text-[11px] text-[var(--color-heading)]">
              {leakyAlpha.toFixed(2)}
            </span>
          </div>
        )}
        {showEluAlphaSlider && (
          <div class="ml-4 flex items-center gap-2">
            <label class="text-[11px] text-[var(--color-text-muted)]">
              ELU alpha:
            </label>
            <input
              type="range"
              min="10"
              max="300"
              step="1"
              value={Math.round(eluAlpha * 100)}
              onInput={(e) =>
                setEluAlpha(
                  Number((e.target as HTMLInputElement).value) / 100
                )
              }
              class="af-slider w-20"
            />
            <span class="font-mono text-[11px] text-[var(--color-heading)]">
              {eluAlpha.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {/* Canvas plot */}
      <div ref={containerRef} class="relative border-b border-[var(--color-border)]">
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={canvasHeight}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          class="af-canvas block w-full cursor-crosshair"
          style={{ aspectRatio: `${canvasWidth} / ${canvasHeight}` }}
        />
        {selectedFunctions.length === 0 && (
          <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span class="rounded-full bg-black/60 px-4 py-2 text-sm text-white/70">
              Select at least one function above
            </span>
          </div>
        )}
        {showDerivative && selectedFunctions.length > 0 && (
          <div class="pointer-events-none absolute left-3 top-3">
            <span class="rounded-full bg-[var(--color-primary)]/20 px-3 py-1 text-[11px] font-semibold text-[var(--color-primary)]">
              Derivative mode
            </span>
          </div>
        )}
      </div>

      {/* Properties panel */}
      {selectedFunctions.length > 0 && (
        <div class="p-4">
          <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
            Properties
          </h3>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {selectedFunctions.map((fn) => (
              <div
                key={fn.id}
                class="rounded-xl border px-4 py-3"
                style={{
                  borderColor: fn.color + "40",
                  background: fn.color + "08",
                }}
              >
                <div class="mb-2 flex items-center gap-2">
                  <span
                    class="inline-block h-3 w-3 rounded-full"
                    style={{ background: fn.color }}
                  />
                  <span
                    class="text-sm font-semibold"
                    style={{ color: fn.color }}
                  >
                    {fn.name}
                  </span>
                </div>
                <div class="space-y-1 text-[11px] text-[var(--color-text-muted)]">
                  <PropertyRow label="Range" value={fn.properties.range} />
                  <PropertyRow
                    label="Monotonic"
                    value={fn.properties.monotonic ? "Yes" : "No"}
                  />
                  <PropertyRow
                    label="Zero-centered"
                    value={fn.properties.zeroCentered ? "Yes" : "No"}
                  />
                  <PropertyRow
                    label="Differentiable"
                    value={
                      fn.properties.differentiableEverywhere
                        ? "Everywhere"
                        : "Not at 0"
                    }
                  />
                  <PropertyRow
                    label="Dead neurons"
                    value={fn.properties.deadNeuronProblem ? "Yes" : "No"}
                    highlight={fn.properties.deadNeuronProblem}
                  />
                  <PropertyRow
                    label="Cost"
                    value={fn.properties.computationalCost}
                  />
                  <div class="mt-1.5 border-t border-[var(--color-border)] pt-1.5 text-[10px] italic leading-relaxed text-[var(--color-text-muted)]">
                    {fn.properties.useCase}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        .af-canvas {
          image-rendering: auto;
        }
        .af-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          border-radius: 2px;
          background: var(--color-border);
          outline: none;
        }
        .af-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--color-primary);
          cursor: pointer;
          border: 2px solid var(--color-surface);
          box-shadow: 0 0 4px rgba(79, 143, 247, 0.3);
        }
        .af-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--color-primary);
          cursor: pointer;
          border: 2px solid var(--color-surface);
        }
        .af-fn-toggle:hover {
          filter: brightness(1.1);
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────

function PropertyRow({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div class="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span
        class="font-mono font-medium"
        style={{
          color: highlight ? "#ef4444" : "var(--color-heading)",
        }}
      >
        {value}
      </span>
    </div>
  );
}
