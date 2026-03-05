import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

interface SortStep {
  type: "compare" | "swap" | "overwrite" | "sorted" | "done";
  indices: number[];
  value?: number;
}

interface AlgorithmDef {
  id: string;
  name: string;
  timeWorst: string;
  timeAvg: string;
  timeBest: string;
  space: string;
  stable: boolean;
  generator: (arr: number[]) => Generator<SortStep>;
}

interface SortRunnerState {
  array: number[];
  comparisons: number;
  swaps: number;
  accesses: number;
  activeIndices: number[];
  activeType: "compare" | "swap" | "overwrite" | "sorted" | "done" | "idle";
  sortedIndices: Set<number>;
  done: boolean;
  startTime: number;
  elapsed: number;
}

type ArrayPreset = "random" | "nearly-sorted" | "reversed" | "few-unique";
type PlayState = "idle" | "running" | "paused";

/* ══════════════════════════════════════════════════════════
   Algorithm Generators
   ══════════════════════════════════════════════════════════ */

function* bubbleSort(arr: number[]): Generator<SortStep> {
  const n = arr.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n - i - 1; j++) {
      yield { type: "compare", indices: [j, j + 1] };
      if (arr[j] > arr[j + 1]) {
        [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];
        yield { type: "swap", indices: [j, j + 1] };
      }
    }
    yield { type: "sorted", indices: [n - i - 1] };
  }
  yield { type: "done", indices: [] };
}

function* selectionSort(arr: number[]): Generator<SortStep> {
  const n = arr.length;
  for (let i = 0; i < n - 1; i++) {
    let minIdx = i;
    for (let j = i + 1; j < n; j++) {
      yield { type: "compare", indices: [minIdx, j] };
      if (arr[j] < arr[minIdx]) {
        minIdx = j;
      }
    }
    if (minIdx !== i) {
      [arr[i], arr[minIdx]] = [arr[minIdx], arr[i]];
      yield { type: "swap", indices: [i, minIdx] };
    }
    yield { type: "sorted", indices: [i] };
  }
  yield { type: "sorted", indices: [arr.length - 1] };
  yield { type: "done", indices: [] };
}

function* insertionSort(arr: number[]): Generator<SortStep> {
  const n = arr.length;
  for (let i = 1; i < n; i++) {
    const key = arr[i];
    let j = i - 1;
    yield { type: "compare", indices: [i, j] };
    while (j >= 0 && arr[j] > key) {
      arr[j + 1] = arr[j];
      yield { type: "swap", indices: [j, j + 1] };
      j--;
      if (j >= 0) {
        yield { type: "compare", indices: [j, j + 1] };
      }
    }
    arr[j + 1] = key;
  }
  for (let i = 0; i < n; i++) {
    yield { type: "sorted", indices: [i] };
  }
  yield { type: "done", indices: [] };
}

function* mergeSortGen(arr: number[]): Generator<SortStep> {
  yield* mergeSortHelper(arr, 0, arr.length - 1);
  for (let i = 0; i < arr.length; i++) {
    yield { type: "sorted", indices: [i] };
  }
  yield { type: "done", indices: [] };
}

function* mergeSortHelper(
  arr: number[],
  left: number,
  right: number,
): Generator<SortStep> {
  if (left >= right) return;
  const mid = Math.floor((left + right) / 2);
  yield* mergeSortHelper(arr, left, mid);
  yield* mergeSortHelper(arr, mid + 1, right);
  yield* mergeArrays(arr, left, mid, right);
}

function* mergeArrays(
  arr: number[],
  left: number,
  mid: number,
  right: number,
): Generator<SortStep> {
  const leftArr = arr.slice(left, mid + 1);
  const rightArr = arr.slice(mid + 1, right + 1);
  let i = 0;
  let j = 0;
  let k = left;

  while (i < leftArr.length && j < rightArr.length) {
    yield { type: "compare", indices: [left + i, mid + 1 + j] };
    if (leftArr[i] <= rightArr[j]) {
      arr[k] = leftArr[i];
      yield { type: "overwrite", indices: [k], value: leftArr[i] };
      i++;
    } else {
      arr[k] = rightArr[j];
      yield { type: "overwrite", indices: [k], value: rightArr[j] };
      j++;
    }
    k++;
  }
  while (i < leftArr.length) {
    arr[k] = leftArr[i];
    yield { type: "overwrite", indices: [k], value: leftArr[i] };
    i++;
    k++;
  }
  while (j < rightArr.length) {
    arr[k] = rightArr[j];
    yield { type: "overwrite", indices: [k], value: rightArr[j] };
    j++;
    k++;
  }
}

function* quickSort(arr: number[]): Generator<SortStep> {
  yield* quickSortHelper(arr, 0, arr.length - 1);
  for (let i = 0; i < arr.length; i++) {
    yield { type: "sorted", indices: [i] };
  }
  yield { type: "done", indices: [] };
}

function* quickSortHelper(
  arr: number[],
  low: number,
  high: number,
): Generator<SortStep> {
  if (low >= high) return;
  const pivotIdx = high;
  let i = low;
  for (let j = low; j < high; j++) {
    yield { type: "compare", indices: [j, pivotIdx] };
    if (arr[j] < arr[pivotIdx]) {
      if (i !== j) {
        [arr[i], arr[j]] = [arr[j], arr[i]];
        yield { type: "swap", indices: [i, j] };
      }
      i++;
    }
  }
  [arr[i], arr[high]] = [arr[high], arr[i]];
  yield { type: "swap", indices: [i, high] };
  yield* quickSortHelper(arr, low, i - 1);
  yield* quickSortHelper(arr, i + 1, high);
}

function* heapSort(arr: number[]): Generator<SortStep> {
  const n = arr.length;
  for (let i = Math.floor(n / 2) - 1; i >= 0; i--) {
    yield* heapify(arr, n, i);
  }
  for (let i = n - 1; i > 0; i--) {
    [arr[0], arr[i]] = [arr[i], arr[0]];
    yield { type: "swap", indices: [0, i] };
    yield { type: "sorted", indices: [i] };
    yield* heapify(arr, i, 0);
  }
  yield { type: "sorted", indices: [0] };
  yield { type: "done", indices: [] };
}

function* heapify(
  arr: number[],
  n: number,
  i: number,
): Generator<SortStep> {
  let largest = i;
  const left = 2 * i + 1;
  const right = 2 * i + 2;

  if (left < n) {
    yield { type: "compare", indices: [left, largest] };
    if (arr[left] > arr[largest]) largest = left;
  }
  if (right < n) {
    yield { type: "compare", indices: [right, largest] };
    if (arr[right] > arr[largest]) largest = right;
  }
  if (largest !== i) {
    [arr[i], arr[largest]] = [arr[largest], arr[i]];
    yield { type: "swap", indices: [i, largest] };
    yield* heapify(arr, n, largest);
  }
}

function* radixSort(arr: number[]): Generator<SortStep> {
  if (arr.length === 0) {
    yield { type: "done", indices: [] };
    return;
  }
  const max = Math.max(...arr);
  for (let exp = 1; Math.floor(max / exp) > 0; exp *= 10) {
    yield* countingSortByDigit(arr, exp);
  }
  for (let i = 0; i < arr.length; i++) {
    yield { type: "sorted", indices: [i] };
  }
  yield { type: "done", indices: [] };
}

function* countingSortByDigit(
  arr: number[],
  exp: number,
): Generator<SortStep> {
  const n = arr.length;
  const output = new Array(n);
  const count = new Array(10).fill(0);

  for (let i = 0; i < n; i++) {
    yield { type: "compare", indices: [i] };
    count[Math.floor(arr[i] / exp) % 10]++;
  }
  for (let i = 1; i < 10; i++) {
    count[i] += count[i - 1];
  }
  for (let i = n - 1; i >= 0; i--) {
    const digit = Math.floor(arr[i] / exp) % 10;
    output[count[digit] - 1] = arr[i];
    count[digit]--;
  }
  for (let i = 0; i < n; i++) {
    if (arr[i] !== output[i]) {
      arr[i] = output[i];
      yield { type: "overwrite", indices: [i], value: output[i] };
    }
  }
}

function* shellSort(arr: number[]): Generator<SortStep> {
  const n = arr.length;
  for (let gap = Math.floor(n / 2); gap > 0; gap = Math.floor(gap / 2)) {
    for (let i = gap; i < n; i++) {
      const temp = arr[i];
      let j = i;
      yield { type: "compare", indices: [j, j - gap] };
      while (j >= gap && arr[j - gap] > temp) {
        arr[j] = arr[j - gap];
        yield { type: "swap", indices: [j, j - gap] };
        j -= gap;
        if (j >= gap) {
          yield { type: "compare", indices: [j, j - gap] };
        }
      }
      arr[j] = temp;
    }
  }
  for (let i = 0; i < n; i++) {
    yield { type: "sorted", indices: [i] };
  }
  yield { type: "done", indices: [] };
}

function* countingSort(arr: number[]): Generator<SortStep> {
  if (arr.length === 0) {
    yield { type: "done", indices: [] };
    return;
  }
  const max = Math.max(...arr);
  const count = new Array(max + 1).fill(0);

  for (let i = 0; i < arr.length; i++) {
    yield { type: "compare", indices: [i] };
    count[arr[i]]++;
  }
  let idx = 0;
  for (let i = 0; i <= max; i++) {
    while (count[i] > 0) {
      if (arr[idx] !== i) {
        arr[idx] = i;
        yield { type: "overwrite", indices: [idx], value: i };
      }
      idx++;
      count[i]--;
    }
  }
  for (let i = 0; i < arr.length; i++) {
    yield { type: "sorted", indices: [i] };
  }
  yield { type: "done", indices: [] };
}

function* cocktailShakerSort(arr: number[]): Generator<SortStep> {
  let start = 0;
  let end = arr.length - 1;
  let swapped = true;

  while (swapped) {
    swapped = false;
    for (let i = start; i < end; i++) {
      yield { type: "compare", indices: [i, i + 1] };
      if (arr[i] > arr[i + 1]) {
        [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
        yield { type: "swap", indices: [i, i + 1] };
        swapped = true;
      }
    }
    yield { type: "sorted", indices: [end] };
    end--;

    if (!swapped) break;
    swapped = false;

    for (let i = end; i > start; i--) {
      yield { type: "compare", indices: [i, i - 1] };
      if (arr[i] < arr[i - 1]) {
        [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
        yield { type: "swap", indices: [i, i - 1] };
        swapped = true;
      }
    }
    yield { type: "sorted", indices: [start] };
    start++;
  }
  for (let i = start; i <= end; i++) {
    yield { type: "sorted", indices: [i] };
  }
  yield { type: "done", indices: [] };
}

/* ══════════════════════════════════════════════════════════
   Algorithm Registry
   ══════════════════════════════════════════════════════════ */

const ALGORITHMS: AlgorithmDef[] = [
  {
    id: "bubble",
    name: "Bubble Sort",
    timeWorst: "O(n\u00B2)",
    timeAvg: "O(n\u00B2)",
    timeBest: "O(n)",
    space: "O(1)",
    stable: true,
    generator: bubbleSort,
  },
  {
    id: "selection",
    name: "Selection Sort",
    timeWorst: "O(n\u00B2)",
    timeAvg: "O(n\u00B2)",
    timeBest: "O(n\u00B2)",
    space: "O(1)",
    stable: false,
    generator: selectionSort,
  },
  {
    id: "insertion",
    name: "Insertion Sort",
    timeWorst: "O(n\u00B2)",
    timeAvg: "O(n\u00B2)",
    timeBest: "O(n)",
    space: "O(1)",
    stable: true,
    generator: insertionSort,
  },
  {
    id: "merge",
    name: "Merge Sort",
    timeWorst: "O(n log n)",
    timeAvg: "O(n log n)",
    timeBest: "O(n log n)",
    space: "O(n)",
    stable: true,
    generator: mergeSortGen,
  },
  {
    id: "quick",
    name: "Quick Sort",
    timeWorst: "O(n\u00B2)",
    timeAvg: "O(n log n)",
    timeBest: "O(n log n)",
    space: "O(log n)",
    stable: false,
    generator: quickSort,
  },
  {
    id: "heap",
    name: "Heap Sort",
    timeWorst: "O(n log n)",
    timeAvg: "O(n log n)",
    timeBest: "O(n log n)",
    space: "O(1)",
    stable: false,
    generator: heapSort,
  },
  {
    id: "radix",
    name: "Radix Sort",
    timeWorst: "O(nk)",
    timeAvg: "O(nk)",
    timeBest: "O(nk)",
    space: "O(n + k)",
    stable: true,
    generator: radixSort,
  },
  {
    id: "shell",
    name: "Shell Sort",
    timeWorst: "O(n\u00B2)",
    timeAvg: "O(n log\u00B2 n)",
    timeBest: "O(n log n)",
    space: "O(1)",
    stable: false,
    generator: shellSort,
  },
  {
    id: "counting",
    name: "Counting Sort",
    timeWorst: "O(n + k)",
    timeAvg: "O(n + k)",
    timeBest: "O(n + k)",
    space: "O(k)",
    stable: true,
    generator: countingSort,
  },
  {
    id: "cocktail",
    name: "Cocktail Shaker",
    timeWorst: "O(n\u00B2)",
    timeAvg: "O(n\u00B2)",
    timeBest: "O(n)",
    space: "O(1)",
    stable: true,
    generator: cocktailShakerSort,
  },
];

const ALGORITHM_MAP = new Map(ALGORITHMS.map((a) => [a.id, a]));

/* ══════════════════════════════════════════════════════════
   Color Constants
   ══════════════════════════════════════════════════════════ */

const COLOR_COMPARE = "#f59e0b";
const COLOR_SWAP = "#ef4444";
const COLOR_SORTED = "#34d399";

/* ══════════════════════════════════════════════════════════
   Array Generation
   ══════════════════════════════════════════════════════════ */

function generateArray(size: number, preset: ArrayPreset): number[] {
  switch (preset) {
    case "random":
      return Array.from({ length: size }, () =>
        Math.floor(Math.random() * size) + 1,
      );
    case "nearly-sorted": {
      const arr = Array.from({ length: size }, (_, i) => i + 1);
      const swapCount = Math.max(1, Math.floor(size * 0.05));
      for (let s = 0; s < swapCount; s++) {
        const i = Math.floor(Math.random() * size);
        const j = Math.min(size - 1, i + Math.floor(Math.random() * 3) + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
    case "reversed":
      return Array.from({ length: size }, (_, i) => size - i);
    case "few-unique": {
      const values = [
        Math.floor(size * 0.2),
        Math.floor(size * 0.4),
        Math.floor(size * 0.6),
        Math.floor(size * 0.8),
        size,
      ];
      return Array.from(
        { length: size },
        () => values[Math.floor(Math.random() * values.length)],
      );
    }
  }
}

/* ══════════════════════════════════════════════════════════
   Audio Engine
   ══════════════════════════════════════════════════════════ */

function createAudioEngine(): {
  beep: (value: number, max: number) => void;
  cleanup: () => void;
} {
  let ctx: AudioContext | null = null;

  function ensureContext(): AudioContext {
    if (!ctx) {
      ctx = new AudioContext();
    }
    return ctx;
  }

  function beep(value: number, max: number): void {
    const audioCtx = ensureContext();
    const frequency = 200 + (value / max) * 800;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.value = 0.05;
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      audioCtx.currentTime + 0.05,
    );
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.05);
  }

  function cleanup(): void {
    if (ctx) {
      ctx.close();
      ctx = null;
    }
  }

  return { beep, cleanup };
}

/* ══════════════════════════════════════════════════════════
   Canvas Renderer
   ══════════════════════════════════════════════════════════ */

function drawBars(
  canvas: HTMLCanvasElement,
  array: number[],
  maxVal: number,
  activeIndices: number[],
  activeType: string,
  sortedIndices: Set<number>,
  primaryColor: string,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const displayW = canvas.clientWidth;
  const displayH = canvas.clientHeight;

  if (canvas.width !== displayW * dpr || canvas.height !== displayH * dpr) {
    canvas.width = displayW * dpr;
    canvas.height = displayH * dpr;
    ctx.scale(dpr, dpr);
  } else {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  ctx.clearRect(0, 0, displayW, displayH);

  const n = array.length;
  const totalGap = Math.min(n * 0.5, displayW * 0.1);
  const gap = n > 1 ? totalGap / (n - 1) : 0;
  const barWidth = (displayW - totalGap) / n;
  const padding = 4;
  const activeSet = new Set(activeIndices);

  for (let i = 0; i < n; i++) {
    const x = i * (barWidth + gap);
    const barHeight = (array[i] / maxVal) * (displayH - padding * 2);
    const y = displayH - barHeight - padding;

    if (activeSet.has(i)) {
      if (activeType === "compare") {
        ctx.fillStyle = COLOR_COMPARE;
      } else if (activeType === "swap" || activeType === "overwrite") {
        ctx.fillStyle = COLOR_SWAP;
      } else {
        ctx.fillStyle = primaryColor;
      }
    } else if (sortedIndices.has(i)) {
      ctx.fillStyle = COLOR_SORTED;
    } else {
      ctx.fillStyle = primaryColor;
    }

    ctx.fillRect(x, y, Math.max(barWidth, 1), barHeight);
  }
}

/* ══════════════════════════════════════════════════════════
   Runner State
   ══════════════════════════════════════════════════════════ */

function createInitialRunnerState(array: number[]): SortRunnerState {
  return {
    array: [...array],
    comparisons: 0,
    swaps: 0,
    accesses: 0,
    activeIndices: [],
    activeType: "idle",
    sortedIndices: new Set(),
    done: false,
    startTime: 0,
    elapsed: 0,
  };
}

function applyStep(
  prev: SortRunnerState,
  step: SortStep,
  timestamp: number,
): SortRunnerState {
  if (prev.done) return prev;
  const next = { ...prev, elapsed: timestamp - prev.startTime };

  switch (step.type) {
    case "compare":
      next.comparisons = prev.comparisons + 1;
      next.accesses = prev.accesses + step.indices.length;
      next.activeIndices = step.indices;
      next.activeType = "compare";
      break;
    case "swap":
      next.swaps = prev.swaps + 1;
      next.accesses = prev.accesses + 2;
      next.activeIndices = step.indices;
      next.activeType = "swap";
      break;
    case "overwrite":
      next.swaps = prev.swaps + 1;
      next.accesses = prev.accesses + 1;
      next.activeIndices = step.indices;
      next.activeType = "overwrite";
      break;
    case "sorted": {
      const newSorted = new Set(prev.sortedIndices);
      for (const idx of step.indices) newSorted.add(idx);
      next.sortedIndices = newSorted;
      next.activeIndices = step.indices;
      next.activeType = "sorted";
      break;
    }
    case "done":
      next.done = true;
      next.activeIndices = [];
      next.activeType = "idle";
      next.elapsed = timestamp - prev.startTime;
      break;
  }
  return next;
}

/* ══════════════════════════════════════════════════════════
   Sort Canvas Sub-component
   ══════════════════════════════════════════════════════════ */

function SortCanvas({
  state,
  maxVal,
  primaryColor,
  label,
  algorithmDef,
  showStats,
}: {
  state: SortRunnerState;
  maxVal: number;
  primaryColor: string;
  label?: string;
  algorithmDef?: AlgorithmDef;
  showStats: boolean;
}): preact.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    drawBars(
      canvasRef.current,
      state.array,
      maxVal,
      state.activeIndices,
      state.activeType,
      state.sortedIndices,
      primaryColor,
    );
  }, [state, maxVal, primaryColor]);

  return (
    <div class="flex flex-col gap-1">
      {label && (
        <div class="flex items-center justify-between text-xs">
          <span
            class="font-bold text-[var(--color-heading)]"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {label}
          </span>
          {state.done && (
            <span
              class="rounded px-1.5 py-0.5 text-[10px] font-bold text-black"
              style={{ background: COLOR_SORTED }}
            >
              DONE {(state.elapsed / 1000).toFixed(2)}s
            </span>
          )}
        </div>
      )}
      <canvas
        ref={canvasRef}
        class="w-full rounded border"
        style={{
          height: showStats ? "180px" : "280px",
          borderColor: state.done ? COLOR_SORTED : "var(--color-border)",
          background: "var(--color-bg)",
        }}
      />
      {showStats && algorithmDef && (
        <div class="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--color-text-muted)]">
          <span>
            Comparisons:{" "}
            <strong class="text-[var(--color-text)]">
              {state.comparisons}
            </strong>
          </span>
          <span>
            Swaps:{" "}
            <strong class="text-[var(--color-text)]">{state.swaps}</strong>
          </span>
          <span>
            Accesses:{" "}
            <strong class="text-[var(--color-text)]">{state.accesses}</strong>
          </span>
          <span>
            Avg:{" "}
            <strong class="text-[var(--color-text)]">
              {algorithmDef.timeAvg}
            </strong>
          </span>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════ */

const DEFAULT_SIZE = 50;
const DEFAULT_SPEED = 25;
const MIN_SIZE = 10;
const MAX_SIZE = 200;
const MIN_SPEED = 1;
const MAX_SPEED = 500;

export default function SortingViz(): preact.JSX.Element {
  const [selectedAlgo, setSelectedAlgo] = useState("quick");
  const [raceMode, setRaceMode] = useState(false);
  const [raceAlgos, setRaceAlgos] = useState<string[]>([
    "bubble",
    "quick",
    "merge",
    "heap",
  ]);
  const [arraySize, setArraySize] = useState(DEFAULT_SIZE);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [arrayPreset, setArrayPreset] = useState<ArrayPreset>("random");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [playState, setPlayState] = useState<PlayState>("idle");
  const [baseArray, setBaseArray] = useState<number[]>(() =>
    generateArray(DEFAULT_SIZE, "random"),
  );

  const [singleState, setSingleState] = useState<SortRunnerState>(() =>
    createInitialRunnerState(baseArray),
  );
  const [raceStates, setRaceStates] = useState<Map<string, SortRunnerState>>(
    () => new Map(),
  );

  // Mutable refs for the animation loop (avoids stale closure issues)
  const generatorsRef = useRef<Map<string, Generator<SortStep>>>(new Map());
  const animFrameRef = useRef<number>(0);
  const audioRef = useRef<ReturnType<typeof createAudioEngine> | null>(null);
  const lastStepTimeRef = useRef<number>(0);
  const playStateRef = useRef<PlayState>("idle");
  const speedRef = useRef(speed);
  const soundEnabledRef = useRef(soundEnabled);
  const raceModeRef = useRef(raceMode);

  // Mutable snapshots for the animation loop to read current array state
  const singleStateRef = useRef(singleState);
  const raceStatesRef = useRef(raceStates);

  const maxVal = Math.max(...baseArray, 1);

  // Keep refs in sync with state
  useEffect(() => {
    playStateRef.current = playState;
  }, [playState]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);
  useEffect(() => {
    raceModeRef.current = raceMode;
  }, [raceMode]);
  useEffect(() => {
    singleStateRef.current = singleState;
  }, [singleState]);
  useEffect(() => {
    raceStatesRef.current = raceStates;
  }, [raceStates]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioRef.current) audioRef.current.cleanup();
    };
  }, []);

  const stopAnimation = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
  }, []);

  const resetToArray = useCallback((arr: number[]) => {
    setSingleState(createInitialRunnerState(arr));
    setRaceStates(new Map());
    setPlayState("idle");
    generatorsRef.current.clear();
    stopAnimation();
  }, [stopAnimation]);

  const handleNewArray = useCallback(
    (preset?: ArrayPreset) => {
      const p = preset ?? arrayPreset;
      if (preset !== undefined) setArrayPreset(p);
      const newArr = generateArray(arraySize, p);
      setBaseArray(newArr);
      resetToArray(newArr);
    },
    [arraySize, arrayPreset, resetToArray],
  );

  const handleSizeChange = useCallback(
    (newSize: number) => {
      setArraySize(newSize);
      const newArr = generateArray(newSize, arrayPreset);
      setBaseArray(newArr);
      resetToArray(newArr);
    },
    [arrayPreset, resetToArray],
  );

  const handleReset = useCallback(() => {
    resetToArray(baseArray);
  }, [baseArray, resetToArray]);

  const toggleRaceAlgo = useCallback((id: string) => {
    setRaceAlgos((prev) => {
      if (prev.includes(id)) {
        return prev.length > 2 ? prev.filter((a) => a !== id) : prev;
      }
      return prev.length < 4 ? [...prev, id] : prev;
    });
  }, []);

  const animationLoop = useCallback((timestamp: number) => {
    if (playStateRef.current !== "running") return;

    const delay = MAX_SPEED + MIN_SPEED - speedRef.current;
    if (timestamp - lastStepTimeRef.current < delay) {
      animFrameRef.current = requestAnimationFrame(animationLoop);
      return;
    }
    lastStepTimeRef.current = timestamp;

    const stepsPerFrame =
      speedRef.current > 400
        ? 10
        : speedRef.current > 300
          ? 5
          : speedRef.current > 200
            ? 3
            : 1;

    let allDone = true;
    const isRace = raceModeRef.current;

    for (const [id, gen] of generatorsRef.current) {
      // Read the current done status from the ref snapshot
      const currentDone = isRace
        ? raceStatesRef.current.get(id)?.done
        : singleStateRef.current.done;

      if (currentDone) continue;
      allDone = false;

      for (let s = 0; s < stepsPerFrame; s++) {
        const result = gen.next();
        if (result.done) break;

        const step = result.value;

        if (isRace) {
          setRaceStates((prev) => {
            const existing = prev.get(id);
            if (!existing || existing.done) return prev;
            const updated = applyStep(existing, step, timestamp);
            const newMap = new Map(prev);
            newMap.set(id, updated);
            return newMap;
          });
        } else {
          setSingleState((prev) => applyStep(prev, step, timestamp));
        }

        // Sound: beep based on the accessed index value
        if (
          soundEnabledRef.current &&
          audioRef.current &&
          step.type !== "done" &&
          step.indices.length > 0
        ) {
          // Read from the generator's array directly (it mutates in place)
          // The generator closes over its array copy, so we can read from state
          const stateSnap = isRace
            ? raceStatesRef.current.get(id)
            : singleStateRef.current;
          if (stateSnap) {
            const idx = step.indices[0];
            if (idx < stateSnap.array.length) {
              audioRef.current.beep(
                stateSnap.array[idx],
                Math.max(...stateSnap.array, 1),
              );
            }
          }
        }

        if (step.type === "done") break;
      }
    }

    if (allDone) {
      setPlayState("idle");
    } else {
      animFrameRef.current = requestAnimationFrame(animationLoop);
    }
  }, []);

  const startSorting = useCallback(() => {
    const now = performance.now();

    if (!raceMode) {
      const algo = ALGORITHM_MAP.get(selectedAlgo);
      if (!algo) return;
      const arrCopy = [...baseArray];
      const gen = algo.generator(arrCopy);
      generatorsRef.current.clear();
      generatorsRef.current.set(selectedAlgo, gen);

      const initial = {
        ...createInitialRunnerState(baseArray),
        array: arrCopy,
        startTime: now,
      };
      setSingleState(initial);
      singleStateRef.current = initial;
    } else {
      const newGenerators = new Map<string, Generator<SortStep>>();
      const newStates = new Map<string, SortRunnerState>();

      for (const id of raceAlgos) {
        const algo = ALGORITHM_MAP.get(id);
        if (!algo) continue;
        const arrCopy = [...baseArray];
        const gen = algo.generator(arrCopy);
        newGenerators.set(id, gen);
        newStates.set(id, {
          ...createInitialRunnerState(baseArray),
          array: arrCopy,
          startTime: now,
        });
      }
      generatorsRef.current = newGenerators;
      setRaceStates(newStates);
      raceStatesRef.current = newStates;
    }

    if (soundEnabled && !audioRef.current) {
      audioRef.current = createAudioEngine();
    }

    setPlayState("running");
    lastStepTimeRef.current = now;
    animFrameRef.current = requestAnimationFrame(animationLoop);
  }, [raceMode, selectedAlgo, raceAlgos, baseArray, soundEnabled, animationLoop]);

  const handleStartPause = useCallback(() => {
    if (playState === "idle") {
      startSorting();
    } else if (playState === "running") {
      setPlayState("paused");
      stopAnimation();
    } else if (playState === "paused") {
      setPlayState("running");
      lastStepTimeRef.current = performance.now();
      animFrameRef.current = requestAnimationFrame(animationLoop);
    }
  }, [playState, startSorting, animationLoop, stopAnimation]);

  const currentAlgo = ALGORITHM_MAP.get(selectedAlgo);
  const isSortDone = raceMode
    ? Array.from(raceStates.values()).every((s) => s.done) &&
      raceStates.size > 0
    : singleState.done;

  return (
    <div class="flex flex-col gap-4">
      {/* ── Controls Row 1: Algorithm + Mode ── */}
      <div class="flex flex-wrap items-center gap-3">
        {!raceMode && (
          <div class="flex items-center gap-2">
            <label
              class="text-xs font-bold uppercase text-[var(--color-text-muted)]"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Algorithm
            </label>
            <select
              class="rounded border bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-text)]"
              style={{ borderColor: "var(--color-border)" }}
              value={selectedAlgo}
              onChange={(e) => {
                setSelectedAlgo((e.target as HTMLSelectElement).value);
                handleReset();
              }}
              disabled={playState !== "idle"}
            >
              {ALGORITHMS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          class="rounded border px-3 py-1.5 text-xs font-bold transition-colors"
          style={{
            borderColor: raceMode
              ? "var(--color-primary)"
              : "var(--color-border)",
            background: raceMode ? "var(--color-primary)" : "transparent",
            color: raceMode ? "#fff" : "var(--color-text-muted)",
            fontFamily: "var(--font-heading)",
          }}
          onClick={() => {
            setRaceMode((p) => !p);
            handleReset();
          }}
          disabled={playState !== "idle"}
        >
          RACE MODE
        </button>
      </div>

      {/* ── Race Algorithm Multi-Select ── */}
      {raceMode && (
        <div class="flex flex-wrap gap-1.5">
          {ALGORITHMS.map((a) => {
            const active = raceAlgos.includes(a.id);
            return (
              <button
                key={a.id}
                class="rounded border px-2 py-1 text-[11px] font-bold transition-colors"
                style={{
                  borderColor: active
                    ? "var(--color-accent)"
                    : "var(--color-border)",
                  background: active
                    ? "color-mix(in srgb, var(--color-accent) 20%, transparent)"
                    : "transparent",
                  color: active
                    ? "var(--color-accent)"
                    : "var(--color-text-muted)",
                }}
                onClick={() => toggleRaceAlgo(a.id)}
                disabled={playState !== "idle"}
              >
                {a.name}
              </button>
            );
          })}
          <span class="self-center text-[10px] text-[var(--color-text-muted)]">
            (select 2-4)
          </span>
        </div>
      )}

      {/* ── Controls Row 2: Size + Speed ── */}
      <div class="flex flex-wrap items-center gap-4">
        <div class="flex items-center gap-2">
          <label
            class="text-xs font-bold uppercase text-[var(--color-text-muted)]"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Size
          </label>
          <input
            type="range"
            min={MIN_SIZE}
            max={MAX_SIZE}
            value={arraySize}
            onInput={(e) =>
              handleSizeChange(
                parseInt((e.target as HTMLInputElement).value, 10),
              )
            }
            class="w-24 accent-[var(--color-primary)]"
            disabled={playState !== "idle"}
          />
          <span class="w-8 text-right text-xs text-[var(--color-text)]">
            {arraySize}
          </span>
        </div>

        <div class="flex items-center gap-2">
          <label
            class="text-xs font-bold uppercase text-[var(--color-text-muted)]"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Speed
          </label>
          <input
            type="range"
            min={MIN_SPEED}
            max={MAX_SPEED}
            value={speed}
            onInput={(e) =>
              setSpeed(parseInt((e.target as HTMLInputElement).value, 10))
            }
            class="w-24 accent-[var(--color-primary)]"
          />
          <span class="w-12 text-right text-xs text-[var(--color-text)]">
            {speed >= 400 ? "FAST" : speed >= 200 ? "Med" : "Slow"}
          </span>
        </div>
      </div>

      {/* ── Controls Row 3: Array presets ── */}
      <div class="flex flex-wrap items-center gap-2">
        <label
          class="text-xs font-bold uppercase text-[var(--color-text-muted)]"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Array
        </label>
        {(
          [
            ["random", "Random"],
            ["nearly-sorted", "Nearly Sorted"],
            ["reversed", "Reversed"],
            ["few-unique", "Few Unique"],
          ] as [ArrayPreset, string][]
        ).map(([key, lbl]) => (
          <button
            key={key}
            class="rounded border px-2 py-1 text-[11px] font-bold transition-colors"
            style={{
              borderColor:
                arrayPreset === key
                  ? "var(--color-primary)"
                  : "var(--color-border)",
              background:
                arrayPreset === key
                  ? "color-mix(in srgb, var(--color-primary) 20%, transparent)"
                  : "transparent",
              color:
                arrayPreset === key
                  ? "var(--color-primary)"
                  : "var(--color-text-muted)",
            }}
            onClick={() => handleNewArray(key)}
            disabled={playState !== "idle"}
          >
            {lbl}
          </button>
        ))}
      </div>

      {/* ── Canvas Area ── */}
      <div
        class="rounded-lg border p-3"
        style={{
          borderColor: "var(--color-border)",
          background:
            "color-mix(in srgb, var(--color-surface) 80%, transparent)",
        }}
      >
        {!raceMode ? (
          <SortCanvas
            state={singleState}
            maxVal={maxVal}
            primaryColor="var(--color-primary)"
            showStats={false}
          />
        ) : (
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {raceAlgos.map((id) => {
              const algo = ALGORITHM_MAP.get(id);
              const state =
                raceStates.get(id) ?? createInitialRunnerState(baseArray);
              return (
                <SortCanvas
                  key={id}
                  state={state}
                  maxVal={maxVal}
                  primaryColor="var(--color-primary)"
                  label={algo?.name ?? id}
                  algorithmDef={algo}
                  showStats={true}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* ── Playback Controls ── */}
      <div class="flex flex-wrap items-center gap-3">
        <button
          class="rounded border px-4 py-2 text-sm font-bold uppercase transition-colors"
          style={{
            fontFamily: "var(--font-heading)",
            borderColor:
              playState === "running"
                ? COLOR_COMPARE
                : "var(--color-primary)",
            background:
              playState === "running"
                ? COLOR_COMPARE
                : "var(--color-primary)",
            color: "#fff",
          }}
          onClick={handleStartPause}
          disabled={isSortDone && playState === "idle"}
        >
          {playState === "idle"
            ? "\u25B6 Start"
            : playState === "running"
              ? "\u23F8 Pause"
              : "\u25B6 Resume"}
        </button>

        <button
          class="rounded border px-4 py-2 text-sm font-bold uppercase transition-colors"
          style={{
            fontFamily: "var(--font-heading)",
            borderColor: "var(--color-border)",
            background: "transparent",
            color: "var(--color-text-muted)",
          }}
          onClick={handleReset}
        >
          \u21BA Reset
        </button>

        <button
          class="rounded border px-3 py-2 text-sm transition-colors"
          style={{
            borderColor: soundEnabled
              ? "var(--color-accent)"
              : "var(--color-border)",
            background: soundEnabled
              ? "color-mix(in srgb, var(--color-accent) 20%, transparent)"
              : "transparent",
            color: soundEnabled
              ? "var(--color-accent)"
              : "var(--color-text-muted)",
          }}
          onClick={() => {
            const next = !soundEnabled;
            setSoundEnabled(next);
            if (next && !audioRef.current) {
              audioRef.current = createAudioEngine();
            }
            if (!next && audioRef.current) {
              audioRef.current.cleanup();
              audioRef.current = null;
            }
          }}
        >
          {soundEnabled ? "\u266B Sound ON" : "\u266A Sound"}
        </button>

        <button
          class="rounded border px-3 py-2 text-sm font-bold uppercase transition-colors"
          style={{
            fontFamily: "var(--font-heading)",
            borderColor: "var(--color-border)",
            background: "transparent",
            color: "var(--color-text-muted)",
          }}
          onClick={() => handleNewArray()}
          disabled={playState !== "idle"}
        >
          New Array
        </button>
      </div>

      {/* ── Stats Panel (single mode) ── */}
      {!raceMode && currentAlgo && (
        <div
          class="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border px-4 py-3"
          style={{
            borderColor: "var(--color-border)",
            background:
              "color-mix(in srgb, var(--color-surface) 80%, transparent)",
          }}
        >
          <Stat label="Comparisons" value={singleState.comparisons} />
          <Stat label="Swaps" value={singleState.swaps} />
          <Stat label="Accesses" value={singleState.accesses} />
          <Stat
            label="Time"
            value={`${(singleState.elapsed / 1000).toFixed(2)}s`}
          />
          <div class="ml-auto flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
            <ComplexityBadge label="Best" value={currentAlgo.timeBest} />
            <ComplexityBadge label="Avg" value={currentAlgo.timeAvg} />
            <ComplexityBadge label="Worst" value={currentAlgo.timeWorst} />
            <ComplexityBadge label="Space" value={currentAlgo.space} />
            <span class="text-[var(--color-text-muted)]">
              {currentAlgo.stable ? "Stable" : "Unstable"}
            </span>
          </div>
        </div>
      )}

      {/* ── Complexity Reference Table ── */}
      <details class="group">
        <summary
          class="cursor-pointer text-xs font-bold uppercase text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-heading)]"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Complexity Reference
        </summary>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-[11px]">
            <thead>
              <tr
                class="border-b text-left"
                style={{ borderColor: "var(--color-border)" }}
              >
                <th class="px-2 py-1 text-[var(--color-text-muted)]">
                  Algorithm
                </th>
                <th class="px-2 py-1 text-[var(--color-text-muted)]">Best</th>
                <th class="px-2 py-1 text-[var(--color-text-muted)]">Avg</th>
                <th class="px-2 py-1 text-[var(--color-text-muted)]">Worst</th>
                <th class="px-2 py-1 text-[var(--color-text-muted)]">Space</th>
                <th class="px-2 py-1 text-[var(--color-text-muted)]">
                  Stable
                </th>
              </tr>
            </thead>
            <tbody>
              {ALGORITHMS.map((a) => (
                <tr
                  key={a.id}
                  class="border-b"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <td class="px-2 py-1 font-bold text-[var(--color-heading)]">
                    {a.name}
                  </td>
                  <td class="px-2 py-1 text-[var(--color-text)]">
                    {a.timeBest}
                  </td>
                  <td class="px-2 py-1 text-[var(--color-text)]">
                    {a.timeAvg}
                  </td>
                  <td class="px-2 py-1 text-[var(--color-text)]">
                    {a.timeWorst}
                  </td>
                  <td class="px-2 py-1 text-[var(--color-text)]">{a.space}</td>
                  <td class="px-2 py-1 text-[var(--color-text)]">
                    {a.stable ? "Yes" : "No"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Small Sub-components
   ══════════════════════════════════════════════════════════ */

function Stat({
  label,
  value,
}: {
  label: string;
  value: number | string;
}): preact.JSX.Element {
  return (
    <div class="flex flex-col">
      <span
        class="text-[10px] font-bold uppercase text-[var(--color-text-muted)]"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        {label}
      </span>
      <span class="text-sm font-bold text-[var(--color-heading)]">
        {value}
      </span>
    </div>
  );
}

function ComplexityBadge({
  label,
  value,
}: {
  label: string;
  value: string;
}): preact.JSX.Element {
  return (
    <span class="text-[var(--color-text-muted)]">
      {label}:{" "}
      <strong class="text-[var(--color-text)]">{value}</strong>
    </span>
  );
}
