import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "preact/hooks";

// -----------------------------------------------------------------
// Types
// -----------------------------------------------------------------

interface KernelPreset {
  name: string;
  size: 3 | 5;
  values: number[];
}

interface InputPreset {
  name: string;
  generate: (size: number) => number[];
}

type PaddingMode = "none" | "same" | "full";

interface AnimationState {
  row: number;
  col: number;
  outputRow: number;
  outputCol: number;
  done: boolean;
}

// -----------------------------------------------------------------
// Convolution computation (pure functions)
// -----------------------------------------------------------------

function computePaddedInput(
  input: number[],
  inputSize: number,
  kernelSize: number,
  padding: PaddingMode
): { padded: number[]; paddedSize: number; padAmount: number } {
  let padAmount = 0;
  if (padding === "same") {
    padAmount = Math.floor(kernelSize / 2);
  } else if (padding === "full") {
    padAmount = kernelSize - 1;
  }

  const paddedSize = inputSize + 2 * padAmount;
  const padded = new Array(paddedSize * paddedSize).fill(0);

  for (let r = 0; r < inputSize; r++) {
    for (let c = 0; c < inputSize; c++) {
      padded[(r + padAmount) * paddedSize + (c + padAmount)] =
        input[r * inputSize + c];
    }
  }

  return { padded, paddedSize, padAmount };
}

function computeOutputSize(
  inputSize: number,
  kernelSize: number,
  stride: number,
  padding: PaddingMode
): number {
  let padAmount = 0;
  if (padding === "same") padAmount = Math.floor(kernelSize / 2);
  if (padding === "full") padAmount = kernelSize - 1;
  return Math.floor((inputSize - kernelSize + 2 * padAmount) / stride) + 1;
}

function computeConvolutionFull(
  input: number[],
  inputSize: number,
  kernel: number[],
  kernelSize: number,
  stride: number,
  padding: PaddingMode
): number[] {
  const { padded, paddedSize } = computePaddedInput(
    input,
    inputSize,
    kernelSize,
    padding
  );
  const outSize = computeOutputSize(inputSize, kernelSize, stride, padding);
  const output = new Array(outSize * outSize).fill(0);

  for (let or = 0; or < outSize; or++) {
    for (let oc = 0; oc < outSize; oc++) {
      let sum = 0;
      const startR = or * stride;
      const startC = oc * stride;
      for (let kr = 0; kr < kernelSize; kr++) {
        for (let kc = 0; kc < kernelSize; kc++) {
          sum +=
            padded[(startR + kr) * paddedSize + (startC + kc)] *
            kernel[kr * kernelSize + kc];
        }
      }
      output[or * outSize + oc] = sum;
    }
  }

  return output;
}

function computeSingleConvolution(
  padded: number[],
  paddedSize: number,
  kernel: number[],
  kernelSize: number,
  startR: number,
  startC: number
): { sum: number; products: number[] } {
  const products: number[] = [];
  let sum = 0;
  for (let kr = 0; kr < kernelSize; kr++) {
    for (let kc = 0; kc < kernelSize; kc++) {
      const inputVal = padded[(startR + kr) * paddedSize + (startC + kc)];
      const kernelVal = kernel[kr * kernelSize + kc];
      const product = inputVal * kernelVal;
      products.push(product);
      sum += product;
    }
  }
  return { sum, products };
}

// -----------------------------------------------------------------
// Kernel presets
// -----------------------------------------------------------------

const KERNEL_PRESETS: KernelPreset[] = [
  {
    name: "Identity",
    size: 3,
    values: [0, 0, 0, 0, 1, 0, 0, 0, 0],
  },
  {
    name: "Edge (All)",
    size: 3,
    values: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
  },
  {
    name: "Edge (H)",
    size: 3,
    values: [-1, -1, -1, 2, 2, 2, -1, -1, -1],
  },
  {
    name: "Edge (V)",
    size: 3,
    values: [-1, 2, -1, -1, 2, -1, -1, 2, -1],
  },
  {
    name: "Sharpen",
    size: 3,
    values: [0, -1, 0, -1, 5, -1, 0, -1, 0],
  },
  {
    name: "Box Blur",
    size: 3,
    values: Array(9).fill(1 / 9),
  },
  {
    name: "Gaussian",
    size: 3,
    values: [1, 2, 1, 2, 4, 2, 1, 2, 1].map((v) => v / 16),
  },
  {
    name: "Emboss",
    size: 3,
    values: [-2, -1, 0, -1, 1, 1, 0, 1, 2],
  },
  {
    name: "Sobel X",
    size: 3,
    values: [-1, 0, 1, -2, 0, 2, -1, 0, 1],
  },
  {
    name: "Sobel Y",
    size: 3,
    values: [-1, -2, -1, 0, 0, 0, 1, 2, 1],
  },
  {
    name: "Identity 5x5",
    size: 5,
    values: (() => {
      const v = new Array(25).fill(0);
      v[12] = 1;
      return v;
    })(),
  },
  {
    name: "Gaussian 5x5",
    size: 5,
    values: [
      1, 4, 7, 4, 1, 4, 16, 26, 16, 4, 7, 26, 41, 26, 7, 4, 16, 26, 16, 4,
      1, 4, 7, 4, 1,
    ].map((v) => v / 273),
  },
  {
    name: "Laplacian 5x5",
    size: 5,
    values: [
      0, 0, -1, 0, 0, 0, -1, -2, -1, 0, -1, -2, 16, -2, -1, 0, -1, -2, -1,
      0, 0, 0, -1, 0, 0,
    ],
  },
];

// -----------------------------------------------------------------
// Input presets
// -----------------------------------------------------------------

const INPUT_PRESETS: InputPreset[] = [
  {
    name: "Checkerboard",
    generate: (size: number) => {
      const grid: number[] = [];
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          grid.push((r + c) % 2 === 0 ? 255 : 0);
        }
      }
      return grid;
    },
  },
  {
    name: "H-Lines",
    generate: (size: number) => {
      const grid: number[] = [];
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          grid.push(r % 2 === 0 ? 255 : 0);
        }
      }
      return grid;
    },
  },
  {
    name: "V-Lines",
    generate: (size: number) => {
      const grid: number[] = [];
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          grid.push(c % 2 === 0 ? 255 : 0);
        }
      }
      return grid;
    },
  },
  {
    name: "Diagonal",
    generate: (size: number) => {
      const grid: number[] = [];
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          grid.push(Math.abs(r - c) <= 1 ? 255 : 0);
        }
      }
      return grid;
    },
  },
  {
    name: "Random",
    generate: (size: number) => {
      const grid: number[] = [];
      for (let i = 0; i < size * size; i++) {
        grid.push(Math.floor(Math.random() * 256));
      }
      return grid;
    },
  },
  {
    name: "Edge Box",
    generate: (size: number) => {
      const grid: number[] = [];
      const margin = Math.floor(size / 4);
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          const isEdge =
            (r >= margin &&
              r < size - margin &&
              (c === margin || c === size - margin - 1)) ||
            (c >= margin &&
              c < size - margin &&
              (r === margin || r === size - margin - 1));
          grid.push(isEdge ? 255 : 0);
        }
      }
      return grid;
    },
  },
  {
    name: "Gradient",
    generate: (size: number) => {
      const grid: number[] = [];
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          grid.push(Math.floor((c / (size - 1)) * 255));
        }
      }
      return grid;
    },
  },
];

// -----------------------------------------------------------------
// Color utilities
// -----------------------------------------------------------------

function grayscaleColor(value: number): string {
  const v = Math.max(0, Math.min(255, Math.round(value)));
  return `rgb(${v},${v},${v})`;
}

function divergingColor(value: number, minVal: number, maxVal: number): string {
  const range = Math.max(Math.abs(minVal), Math.abs(maxVal), 1);
  const normalized = Math.max(-1, Math.min(1, value / range));

  if (normalized < 0) {
    const t = -normalized;
    const r = Math.round(100 + (1 - t) * 155);
    const g = Math.round(100 + (1 - t) * 155);
    const b = Math.round(180 + (1 - t) * 75);
    return `rgb(${r},${g},${b})`;
  }
  const t = normalized;
  const r = Math.round(180 + (1 - t) * 75);
  const g = Math.round(100 + (1 - t) * 155);
  const b = Math.round(100 + (1 - t) * 155);
  return `rgb(${r},${g},${b})`;
}

function formatNumber(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1000) return String(n);
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  if (Math.abs(n) < 0.01) return n.toExponential(1);
  return n.toFixed(2);
}

function formatKernelValue(n: number): string {
  if (Number.isInteger(n)) return String(n);
  if (Math.abs(n) < 0.001) return "0";
  return n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

// -----------------------------------------------------------------
// Canvas drawing helpers
// -----------------------------------------------------------------

function drawGrid(
  ctx: CanvasRenderingContext2D,
  grid: number[],
  gridSize: number,
  x: number,
  y: number,
  cellSize: number,
  colorFn: (value: number) => string,
  textColor: string,
  borderColor: string,
  highlight?: {
    startRow: number;
    startCol: number;
    size: number;
    color: string;
  }
): void {
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      const value = grid[r * gridSize + c];
      const cx = x + c * cellSize;
      const cy = y + r * cellSize;

      ctx.fillStyle = colorFn(value);
      ctx.fillRect(cx, cy, cellSize, cellSize);

      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 0.5;
      ctx.strokeRect(cx, cy, cellSize, cellSize);

      if (cellSize >= 24) {
        ctx.fillStyle = textColor;
        const fontSize = Math.max(8, Math.min(11, cellSize * 0.3));
        ctx.font = `${fontSize}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          formatNumber(value),
          cx + cellSize / 2,
          cy + cellSize / 2,
          cellSize - 2
        );
      }
    }
  }

  if (highlight) {
    const hx = x + highlight.startCol * cellSize;
    const hy = y + highlight.startRow * cellSize;
    const hSize = highlight.size * cellSize;

    ctx.fillStyle = highlight.color;
    ctx.fillRect(hx, hy, hSize, hSize);

    ctx.strokeStyle = highlight.color.replace("0.25", "0.8");
    ctx.lineWidth = 2;
    ctx.strokeRect(hx, hy, hSize, hSize);

    for (let kr = 0; kr < highlight.size; kr++) {
      for (let kc = 0; kc < highlight.size; kc++) {
        const r = highlight.startRow + kr;
        const c = highlight.startCol + kc;
        if (r >= 0 && r < gridSize && c >= 0 && c < gridSize) {
          const value = grid[r * gridSize + c];
          const cx2 = x + c * cellSize;
          const cy2 = y + r * cellSize;

          ctx.strokeStyle = borderColor;
          ctx.lineWidth = 0.5;
          ctx.strokeRect(cx2, cy2, cellSize, cellSize);

          if (cellSize >= 24) {
            ctx.fillStyle = textColor;
            const fontSize = Math.max(8, Math.min(11, cellSize * 0.3));
            ctx.font = `bold ${fontSize}px monospace`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(
              formatNumber(value),
              cx2 + cellSize / 2,
              cy2 + cellSize / 2,
              cellSize - 2
            );
          }
        }
      }
    }
  }
}

function drawOutputGrid(
  ctx: CanvasRenderingContext2D,
  grid: number[],
  gridSize: number,
  x: number,
  y: number,
  cellSize: number,
  textColor: string,
  borderColor: string,
  highlightRow?: number,
  highlightCol?: number,
  accentColor?: string
): void {
  const minVal = grid.length > 0 ? Math.min(...grid) : 0;
  const maxVal = grid.length > 0 ? Math.max(...grid) : 0;

  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      const value = grid[r * gridSize + c];
      const cx = x + c * cellSize;
      const cy = y + r * cellSize;

      ctx.fillStyle = divergingColor(value, minVal, maxVal);
      ctx.fillRect(cx, cy, cellSize, cellSize);

      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 0.5;
      ctx.strokeRect(cx, cy, cellSize, cellSize);

      if (cellSize >= 24) {
        const lum =
          value > 0
            ? 180 + (1 - Math.min(1, Math.abs(value) / Math.max(Math.abs(maxVal), 1))) * 75
            : 180 + (1 - Math.min(1, Math.abs(value) / Math.max(Math.abs(minVal), 1))) * 75;
        ctx.fillStyle = lum > 180 ? "#222" : "#eee";
        const fontSize = Math.max(7, Math.min(10, cellSize * 0.28));
        ctx.font = `${fontSize}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          formatNumber(value),
          cx + cellSize / 2,
          cy + cellSize / 2,
          cellSize - 2
        );
      }
    }
  }

  if (
    highlightRow !== undefined &&
    highlightCol !== undefined &&
    accentColor &&
    highlightRow >= 0 &&
    highlightRow < gridSize &&
    highlightCol >= 0 &&
    highlightCol < gridSize
  ) {
    const hx = x + highlightCol * cellSize;
    const hy = y + highlightRow * cellSize;
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 3;
    ctx.strokeRect(hx, hy, cellSize, cellSize);
  }
}

// -----------------------------------------------------------------
// Main Component
// -----------------------------------------------------------------

const DEFAULT_INPUT_SIZE = 8;
const DEFAULT_KERNEL_SIZE: 3 | 5 = 3;
const DEFAULT_STRIDE = 1;
const DEFAULT_PADDING: PaddingMode = "none";
const ANIMATION_SPEEDS = [2000, 1000, 500, 250, 100];

export default function ConvolutionViz() {
  // --- State ---
  const [inputSize, setInputSize] = useState(DEFAULT_INPUT_SIZE);
  const [inputGrid, setInputGrid] = useState<number[]>(() =>
    INPUT_PRESETS[0].generate(DEFAULT_INPUT_SIZE)
  );
  const [kernelSize, setKernelSize] = useState<3 | 5>(DEFAULT_KERNEL_SIZE);
  const [kernel, setKernel] = useState<number[]>(KERNEL_PRESETS[0].values);
  const [stride, setStride] = useState(DEFAULT_STRIDE);
  const [padding, setPadding] = useState<PaddingMode>(DEFAULT_PADDING);
  const [speedIdx, setSpeedIdx] = useState(2);
  const [isPlaying, setIsPlaying] = useState(false);
  const [animState, setAnimState] = useState<AnimationState>({
    row: 0,
    col: 0,
    outputRow: 0,
    outputCol: 0,
    done: false,
  });
  const [editingKernel, setEditingKernel] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [isPainting, setIsPainting] = useState(false);
  const [paintValue, setPaintValue] = useState<number | null>(null);

  // --- Refs ---
  const inputCanvasRef = useRef<HTMLCanvasElement>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const lastStepTimeRef = useRef<number>(0);

  // --- Derived values ---
  const outputSize = useMemo(
    () => computeOutputSize(inputSize, kernelSize, stride, padding),
    [inputSize, kernelSize, stride, padding]
  );

  const fullOutput = useMemo(
    () =>
      computeConvolutionFull(inputGrid, inputSize, kernel, kernelSize, stride, padding),
    [inputGrid, inputSize, kernel, kernelSize, stride, padding]
  );

  const paddedData = useMemo(
    () => computePaddedInput(inputGrid, inputSize, kernelSize, padding),
    [inputGrid, inputSize, kernelSize, padding]
  );

  const partialOutput = useMemo(() => {
    const out = new Array(outputSize * outputSize).fill(NaN);
    const totalSteps = outputSize * outputSize;
    const currentStep = animState.outputRow * outputSize + animState.outputCol;

    for (let i = 0; i < totalSteps; i++) {
      if (i < currentStep || animState.done) {
        out[i] = fullOutput[i];
      }
    }

    if (!animState.done && currentStep < totalSteps) {
      out[currentStep] = fullOutput[currentStep];
    }

    return out;
  }, [fullOutput, outputSize, animState]);

  const currentComputation = useMemo(() => {
    if (animState.done || outputSize <= 0) return null;

    const startR = animState.outputRow * stride;
    const startC = animState.outputCol * stride;

    return computeSingleConvolution(
      paddedData.padded,
      paddedData.paddedSize,
      kernel,
      kernelSize,
      startR,
      startC
    );
  }, [animState, paddedData, kernel, kernelSize, stride, outputSize]);

  // --- Compute cell sizes based on available space ---
  const getCellSize = useCallback(
    (gridSz: number, maxPx: number): number => {
      return Math.max(16, Math.min(48, Math.floor(maxPx / gridSz)));
    },
    []
  );

  // --- Canvas rendering ---
  const renderInputCanvas = useCallback(() => {
    const canvas = inputCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const style = getComputedStyle(document.documentElement);
    const borderColor = style.getPropertyValue("--color-border").trim() || "#27272a";
    const textMuted = style.getPropertyValue("--color-text-muted").trim() || "#a1a1aa";
    const primaryColor = style.getPropertyValue("--color-primary").trim() || "#4f8ff7";

    const { paddedSize, padAmount } = paddedData;
    const displaySize = padding === "none" ? inputSize : paddedSize;
    const displayGrid =
      padding === "none" ? inputGrid : paddedData.padded;

    const cellSize = getCellSize(displaySize, canvas.width);
    const totalPx = displaySize * cellSize;

    canvas.height = totalPx;
    canvas.width = totalPx;

    const highlight =
      !animState.done && outputSize > 0
        ? {
            startRow: animState.outputRow * stride,
            startCol: animState.outputCol * stride,
            size: kernelSize,
            color: `${primaryColor}40`,
          }
        : undefined;

    drawGrid(
      ctx,
      displayGrid,
      displaySize,
      0,
      0,
      cellSize,
      grayscaleColor,
      textMuted,
      borderColor,
      highlight
    );

    if (padding !== "none" && padAmount > 0) {
      ctx.strokeStyle = `${primaryColor}60`;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(
        padAmount * cellSize,
        padAmount * cellSize,
        inputSize * cellSize,
        inputSize * cellSize
      );
      ctx.setLineDash([]);
    }
  }, [inputGrid, inputSize, paddedData, animState, stride, kernelSize, padding, outputSize, getCellSize]);

  const renderOutputCanvas = useCallback(() => {
    const canvas = outputCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (outputSize <= 0) {
      canvas.width = 100;
      canvas.height = 100;
      ctx.clearRect(0, 0, 100, 100);
      const style = getComputedStyle(document.documentElement);
      ctx.fillStyle = style.getPropertyValue("--color-text-muted").trim() || "#a1a1aa";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Invalid config", 50, 50);
      return;
    }

    const cellSize = getCellSize(outputSize, canvas.width);
    const totalPx = outputSize * cellSize;

    canvas.height = totalPx;
    canvas.width = totalPx;

    const style = getComputedStyle(document.documentElement);
    const borderColor = style.getPropertyValue("--color-border").trim() || "#27272a";
    const textMuted = style.getPropertyValue("--color-text-muted").trim() || "#a1a1aa";
    const accentColor = style.getPropertyValue("--color-accent").trim() || "#34d399";

    const displayGrid = partialOutput.map((v) => (Number.isNaN(v) ? 0 : v));

    drawOutputGrid(
      ctx,
      displayGrid,
      outputSize,
      0,
      0,
      cellSize,
      textMuted,
      borderColor,
      animState.done ? undefined : animState.outputRow,
      animState.done ? undefined : animState.outputCol,
      accentColor
    );

    if (!animState.done) {
      for (let i = 0; i < outputSize * outputSize; i++) {
        if (Number.isNaN(partialOutput[i])) {
          const r = Math.floor(i / outputSize);
          const c = i % outputSize;
          const cx = c * cellSize;
          const cy = r * cellSize;
          ctx.fillStyle = borderColor + "30";
          ctx.fillRect(cx, cy, cellSize, cellSize);
          ctx.strokeStyle = borderColor;
          ctx.lineWidth = 0.5;
          ctx.strokeRect(cx, cy, cellSize, cellSize);
        }
      }
    }
  }, [partialOutput, outputSize, animState, getCellSize]);

  // --- Render canvases on state change ---
  useEffect(() => {
    renderInputCanvas();
  }, [renderInputCanvas]);

  useEffect(() => {
    renderOutputCanvas();
  }, [renderOutputCanvas]);

  // --- Animation loop ---
  const advanceStep = useCallback(() => {
    if (outputSize <= 0) return;

    setAnimState((prev) => {
      if (prev.done) return prev;

      let nextCol = prev.outputCol + 1;
      let nextRow = prev.outputRow;

      if (nextCol >= outputSize) {
        nextCol = 0;
        nextRow += 1;
      }

      if (nextRow >= outputSize) {
        return { ...prev, done: true };
      }

      return {
        row: nextRow * stride,
        col: nextCol * stride,
        outputRow: nextRow,
        outputCol: nextCol,
        done: false,
      };
    });
  }, [outputSize, stride]);

  useEffect(() => {
    if (!isPlaying) {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = 0;
      }
      return;
    }

    const speed = ANIMATION_SPEEDS[speedIdx];

    const tick = (timestamp: number) => {
      if (timestamp - lastStepTimeRef.current >= speed) {
        lastStepTimeRef.current = timestamp;
        setAnimState((prev) => {
          if (prev.done) {
            setIsPlaying(false);
            return prev;
          }

          let nextCol = prev.outputCol + 1;
          let nextRow = prev.outputRow;

          if (nextCol >= outputSize) {
            nextCol = 0;
            nextRow += 1;
          }

          if (nextRow >= outputSize) {
            setIsPlaying(false);
            return { ...prev, done: true };
          }

          return {
            row: nextRow * stride,
            col: nextCol * stride,
            outputRow: nextRow,
            outputCol: nextCol,
            done: false,
          };
        });
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };

    lastStepTimeRef.current = performance.now();
    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = 0;
      }
    };
  }, [isPlaying, speedIdx, outputSize, stride]);

  // --- Handlers ---
  const handleReset = useCallback(() => {
    setIsPlaying(false);
    setAnimState({
      row: 0,
      col: 0,
      outputRow: 0,
      outputCol: 0,
      done: false,
    });
  }, []);

  const handleInputPreset = useCallback(
    (preset: InputPreset) => {
      setInputGrid(preset.generate(inputSize));
      handleReset();
    },
    [inputSize, handleReset]
  );

  const handleKernelPreset = useCallback(
    (preset: KernelPreset) => {
      setKernelSize(preset.size);
      setKernel([...preset.values]);
      handleReset();
    },
    [handleReset]
  );

  const handleKernelSizeChange = useCallback(
    (newSize: 3 | 5) => {
      setKernelSize(newSize);
      if (newSize === 3) {
        setKernel(KERNEL_PRESETS[0].values);
      } else {
        setKernel(KERNEL_PRESETS.find((p) => p.size === 5)?.values ?? new Array(25).fill(0));
      }
      handleReset();
    },
    [handleReset]
  );

  const handleKernelValueChange = useCallback(
    (index: number, value: string) => {
      const num = parseFloat(value);
      if (!Number.isFinite(num)) return;
      setKernel((prev) => {
        const next = [...prev];
        next[index] = num;
        return next;
      });
      handleReset();
    },
    [handleReset]
  );

  const handleInputSizeChange = useCallback(
    (newSize: number) => {
      setInputSize(newSize);
      setInputGrid(INPUT_PRESETS[0].generate(newSize));
      handleReset();
    },
    [handleReset]
  );

  const handleCanvasPaint = useCallback(
    (e: MouseEvent | PointerEvent, canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const mx = (e.clientX - rect.left) * scaleX;
      const my = (e.clientY - rect.top) * scaleY;

      const { paddedSize, padAmount } = paddedData;
      const displaySize = padding === "none" ? inputSize : paddedSize;
      const cellSize = getCellSize(displaySize, canvas.width);

      let col = Math.floor(mx / cellSize);
      let row = Math.floor(my / cellSize);

      if (padding !== "none") {
        col -= padAmount;
        row -= padAmount;
      }

      if (row < 0 || row >= inputSize || col < 0 || col >= inputSize) return;

      const idx = row * inputSize + col;
      setInputGrid((prev) => {
        const next = [...prev];
        if (paintValue !== null) {
          next[idx] = paintValue;
        } else {
          next[idx] = prev[idx] > 128 ? 0 : 255;
          setPaintValue(next[idx]);
        }
        return next;
      });
    },
    [inputSize, paddedData, padding, paintValue, getCellSize]
  );

  const handleInputPointerDown = useCallback(
    (e: PointerEvent) => {
      setIsPainting(true);
      setPaintValue(null);
      handleCanvasPaint(e, inputCanvasRef.current);
    },
    [handleCanvasPaint]
  );

  const handleInputPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!isPainting) return;
      handleCanvasPaint(e, inputCanvasRef.current);
    },
    [isPainting, handleCanvasPaint]
  );

  const handleInputPointerUp = useCallback(() => {
    setIsPainting(false);
    setPaintValue(null);
  }, []);

  // --- Padding label ---
  const padLabel = useMemo(() => {
    const padAmt =
      padding === "same"
        ? Math.floor(kernelSize / 2)
        : padding === "full"
          ? kernelSize - 1
          : 0;
    return `(${inputSize} - ${kernelSize} + 2*${padAmt}) / ${stride} + 1 = ${outputSize}`;
  }, [inputSize, kernelSize, padding, stride, outputSize]);

  // --- Computation display ---
  const computationDisplay = useMemo(() => {
    if (!currentComputation || animState.done) return null;
    const { sum, products } = currentComputation;
    const terms = products
      .slice(0, 6)
      .map((p) => formatNumber(p))
      .join(" + ");
    const suffix = products.length > 6 ? " + ..." : "";
    return `${terms}${suffix} = ${formatNumber(sum)}`;
  }, [currentComputation, animState.done]);

  // --- Max canvas width for responsive layout ---
  const maxCanvasPx = 384;

  // -----------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------

  return (
    <div class="conv-root overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Header */}
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-[var(--color-text-muted)]">
            Convolution Visualizer
          </span>
          <span class="rounded-full border border-[var(--color-primary)]/30 px-2 py-0.5 text-[10px] font-semibold text-[var(--color-primary)]">
            BETA
          </span>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-xs text-[var(--color-text-muted)]">Grid:</label>
          <select
            class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-text)] outline-none"
            value={inputSize}
            onChange={(e) =>
              handleInputSizeChange(parseInt((e.target as HTMLSelectElement).value, 10))
            }
          >
            {[6, 7, 8, 10, 12].map((s) => (
              <option key={s} value={s}>
                {s}x{s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main content: 3-panel layout */}
      <div class="flex flex-col lg:flex-row">
        {/* Input Grid Panel */}
        <div class="flex-1 border-b border-[var(--color-border)] p-4 lg:border-b-0 lg:border-r">
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
            Input{" "}
            <span class="font-normal text-[var(--color-text-muted)]">
              ({padding !== "none" ? `${paddedData.paddedSize}x${paddedData.paddedSize} padded` : `${inputSize}x${inputSize}`})
            </span>
          </h3>
          <div class="flex justify-center">
            <canvas
              ref={inputCanvasRef}
              width={maxCanvasPx}
              height={maxCanvasPx}
              class="cursor-crosshair rounded border border-[var(--color-border)]"
              style={{ maxWidth: "100%", height: "auto", imageRendering: "pixelated" }}
              onPointerDown={handleInputPointerDown}
              onPointerMove={handleInputPointerMove}
              onPointerUp={handleInputPointerUp}
              onPointerLeave={handleInputPointerUp}
            />
          </div>
          <div class="mt-2 flex flex-wrap gap-1">
            {INPUT_PRESETS.map((preset) => (
              <button
                key={preset.name}
                class="rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
                onClick={() => handleInputPreset(preset)}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>

        {/* Kernel Panel */}
        <div class="w-full border-b border-[var(--color-border)] p-4 lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r">
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
            Kernel{" "}
            <span class="font-normal text-[var(--color-text-muted)]">
              ({kernelSize}x{kernelSize})
            </span>
          </h3>

          {/* Kernel size toggle */}
          <div class="mb-3 flex gap-1">
            {([3, 5] as const).map((s) => (
              <button
                key={s}
                class="rounded px-2 py-0.5 text-[10px] font-medium transition-colors"
                style={{
                  background:
                    kernelSize === s ? "var(--color-primary)" : "transparent",
                  color: kernelSize === s ? "#fff" : "var(--color-text-muted)",
                  border: `1px solid ${kernelSize === s ? "var(--color-primary)" : "var(--color-border)"}`,
                }}
                onClick={() => handleKernelSizeChange(s)}
              >
                {s}x{s}
              </button>
            ))}
          </div>

          {/* Editable kernel grid */}
          <div
            class="mx-auto mb-3"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${kernelSize}, 1fr)`,
              gap: "2px",
              maxWidth: kernelSize === 3 ? "160px" : "220px",
            }}
          >
            {kernel.map((val, idx) => (
              <div key={idx} class="relative">
                {editingKernel === idx ? (
                  <input
                    type="text"
                    class="w-full rounded border border-[var(--color-primary)] bg-[var(--color-bg)] px-1 py-1 text-center font-mono text-[10px] text-[var(--color-heading)] outline-none"
                    value={editValue}
                    autoFocus
                    onInput={(e) =>
                      setEditValue((e.target as HTMLInputElement).value)
                    }
                    onBlur={() => {
                      handleKernelValueChange(idx, editValue);
                      setEditingKernel(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleKernelValueChange(idx, editValue);
                        setEditingKernel(null);
                      }
                      if (e.key === "Escape") {
                        setEditingKernel(null);
                      }
                    }}
                  />
                ) : (
                  <button
                    class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-1 text-center font-mono text-[10px] text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
                    onClick={() => {
                      setEditingKernel(idx);
                      setEditValue(formatKernelValue(val));
                    }}
                  >
                    {formatKernelValue(val)}
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Kernel presets */}
          <div class="flex flex-wrap gap-1">
            {KERNEL_PRESETS.filter((p) => p.size === kernelSize).map(
              (preset) => (
                <button
                  key={preset.name}
                  class="rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
                  onClick={() => handleKernelPreset(preset)}
                >
                  {preset.name}
                </button>
              )
            )}
          </div>
        </div>

        {/* Output Grid Panel */}
        <div class="flex-1 p-4">
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
            Output{" "}
            <span class="font-normal text-[var(--color-text-muted)]">
              ({outputSize > 0 ? `${outputSize}x${outputSize}` : "N/A"})
            </span>
          </h3>
          <div class="flex justify-center">
            <canvas
              ref={outputCanvasRef}
              width={maxCanvasPx}
              height={maxCanvasPx}
              class="rounded border border-[var(--color-border)]"
              style={{ maxWidth: "100%", height: "auto", imageRendering: "pixelated" }}
            />
          </div>
          {outputSize > 0 && !animState.done && (
            <div class="mt-2 text-center text-[10px] text-[var(--color-text-muted)]">
              Position: ({animState.outputRow}, {animState.outputCol})
            </div>
          )}
          {animState.done && (
            <div class="mt-2 text-center text-[10px] font-semibold text-[var(--color-accent)]">
              Complete
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div class="border-t border-[var(--color-border)] px-4 py-3">
        {/* Row 1: Stride & Padding */}
        <div class="mb-3 flex flex-wrap items-center gap-4">
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-[var(--color-text-muted)]">Stride:</span>
            {[1, 2, 3].map((s) => (
              <button
                key={s}
                class="rounded px-2 py-0.5 text-[10px] font-medium transition-colors"
                style={{
                  background:
                    stride === s ? "var(--color-primary)" : "transparent",
                  color: stride === s ? "#fff" : "var(--color-text-muted)",
                  border: `1px solid ${stride === s ? "var(--color-primary)" : "var(--color-border)"}`,
                }}
                onClick={() => {
                  setStride(s);
                  handleReset();
                }}
              >
                {s}
              </button>
            ))}
          </div>

          <div class="flex items-center gap-2">
            <span class="text-[11px] text-[var(--color-text-muted)]">Padding:</span>
            {(["none", "same", "full"] as const).map((p) => (
              <button
                key={p}
                class="rounded px-2 py-0.5 text-[10px] font-medium transition-colors"
                style={{
                  background:
                    padding === p ? "var(--color-primary)" : "transparent",
                  color: padding === p ? "#fff" : "var(--color-text-muted)",
                  border: `1px solid ${padding === p ? "var(--color-primary)" : "var(--color-border)"}`,
                }}
                onClick={() => {
                  setPadding(p);
                  handleReset();
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: Playback controls */}
        <div class="mb-3 flex flex-wrap items-center gap-3">
          <button
            class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
            onClick={() => {
              if (!animState.done) advanceStep();
            }}
            disabled={animState.done}
          >
            Step
          </button>
          <button
            class="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
            style={{
              background: isPlaying ? "var(--color-accent)" : "var(--color-primary)",
              color: "#fff",
            }}
            onClick={() => {
              if (animState.done) {
                handleReset();
                setIsPlaying(true);
              } else {
                setIsPlaying(!isPlaying);
              }
            }}
          >
            {isPlaying ? "Pause" : animState.done ? "Replay" : "Play"}
          </button>
          <button
            class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
            onClick={handleReset}
          >
            Reset
          </button>

          <div class="flex items-center gap-2">
            <span class="text-[11px] text-[var(--color-text-muted)]">Speed:</span>
            <input
              type="range"
              min={0}
              max={ANIMATION_SPEEDS.length - 1}
              value={speedIdx}
              class="conv-slider w-20"
              onInput={(e) =>
                setSpeedIdx(parseInt((e.target as HTMLInputElement).value, 10))
              }
            />
            <span class="font-mono text-[10px] text-[var(--color-heading)]">
              {ANIMATION_SPEEDS[speedIdx]}ms
            </span>
          </div>
        </div>

        {/* Row 3: Info panel */}
        <div class="space-y-1">
          {computationDisplay && (
            <div class="font-mono text-[10px] text-[var(--color-text-muted)]">
              <span class="text-[var(--color-text-muted)]">Sum: </span>
              <span class="text-[var(--color-heading)]">{computationDisplay}</span>
            </div>
          )}
          <div class="font-mono text-[10px] text-[var(--color-text-muted)]">
            <span class="text-[var(--color-text-muted)]">Output size: </span>
            <span class="text-[var(--color-heading)]">{padLabel}</span>
          </div>
          <div class="font-mono text-[10px] text-[var(--color-text-muted)]">
            Step:{" "}
            <span class="text-[var(--color-heading)]">
              {animState.done
                ? outputSize * outputSize
                : animState.outputRow * outputSize + animState.outputCol}
            </span>
            {" / "}
            {outputSize * outputSize}
          </div>
        </div>
      </div>

      {/* Scoped styles */}
      <style>{`
        .conv-root {
          box-shadow: 0 0 0 1px var(--color-border);
        }
        .conv-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          border-radius: 2px;
          background: var(--color-border);
          outline: none;
        }
        .conv-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--color-primary);
          cursor: pointer;
          border: 2px solid var(--color-surface);
        }
        .conv-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--color-primary);
          cursor: pointer;
          border: 2px solid var(--color-surface);
        }
        .conv-root select {
          cursor: pointer;
        }
        .conv-root button:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
