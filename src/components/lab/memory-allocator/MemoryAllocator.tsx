import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

interface Block {
  address: number;
  size: number;
  allocated: boolean;
  label: string;
  color: string;
  metadataSize: number;
}

type Strategy = "first-fit" | "best-fit" | "worst-fit" | "next-fit" | "buddy";

interface OperationLog {
  id: number;
  type: "malloc" | "free" | "coalesce" | "info";
  description: string;
  address?: number;
  size?: number;
  timestamp: number;
}

interface Metrics {
  total: number;
  used: number;
  free: number;
  fragmentation: number;
  largestFree: number;
  blockCount: number;
  freeBlockCount: number;
}

interface AllocatorState {
  blocks: Block[];
  logs: OperationLog[];
  nextLabel: number;
  nextFitPointer: number;
  logIdCounter: number;
}

interface Preset {
  name: string;
  description: string;
  operations: Array<{ type: "malloc" | "free"; size?: number; label?: string }>;
}

/* ══════════════════════════════════════════════════════════
   Constants
   ══════════════════════════════════════════════════════════ */

const HEAP_SIZES = [256, 512, 1024, 2048];
const METADATA_SIZE = 8;

const STRATEGIES: Array<{ value: Strategy; label: string; description: string }> = [
  { value: "first-fit", label: "First Fit", description: "Use the first free block that is large enough" },
  { value: "best-fit", label: "Best Fit", description: "Use the smallest free block that fits" },
  { value: "worst-fit", label: "Worst Fit", description: "Use the largest free block available" },
  { value: "next-fit", label: "Next Fit", description: "Like first fit, but starts from last allocation" },
  { value: "buddy", label: "Buddy System", description: "Split power-of-2 blocks; merge buddies on free" },
];

const BLOCK_COLORS = [
  "#4f8ff7", "#34d399", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
  "#14b8a6", "#e879f9", "#fb923c", "#22d3ee", "#a3e635",
  "#c084fc", "#fbbf24", "#2dd4bf", "#f472b6", "#818cf8",
];

/* ══════════════════════════════════════════════════════════
   Allocator Engine
   ══════════════════════════════════════════════════════════ */

function createInitialState(heapSize: number): AllocatorState {
  return {
    blocks: [
      {
        address: 0,
        size: heapSize,
        allocated: false,
        label: "",
        color: "",
        metadataSize: 0,
      },
    ],
    logs: [
      {
        id: 0,
        type: "info",
        description: `Heap initialized: ${heapSize} bytes`,
        timestamp: Date.now(),
      },
    ],
    nextLabel: 0,
    nextFitPointer: 0,
    logIdCounter: 1,
  };
}

function labelForIndex(index: number): string {
  if (index < 26) return String.fromCharCode(65 + index);
  const first = String.fromCharCode(65 + Math.floor(index / 26) - 1);
  const second = String.fromCharCode(65 + (index % 26));
  return first + second;
}

function nextPowerOf2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function findFreeBlock(
  blocks: Block[],
  size: number,
  strategy: Strategy,
  nextFitPointer: number,
): number {
  const requiredSize = size + METADATA_SIZE;
  let bestIdx = -1;

  switch (strategy) {
    case "first-fit": {
      for (let i = 0; i < blocks.length; i++) {
        if (!blocks[i].allocated && blocks[i].size >= requiredSize) {
          return i;
        }
      }
      return -1;
    }

    case "best-fit": {
      let bestSize = Infinity;
      for (let i = 0; i < blocks.length; i++) {
        if (!blocks[i].allocated && blocks[i].size >= requiredSize && blocks[i].size < bestSize) {
          bestSize = blocks[i].size;
          bestIdx = i;
        }
      }
      return bestIdx;
    }

    case "worst-fit": {
      let worstSize = -1;
      for (let i = 0; i < blocks.length; i++) {
        if (!blocks[i].allocated && blocks[i].size >= requiredSize && blocks[i].size > worstSize) {
          worstSize = blocks[i].size;
          bestIdx = i;
        }
      }
      return bestIdx;
    }

    case "next-fit": {
      const n = blocks.length;
      for (let j = 0; j < n; j++) {
        const i = (nextFitPointer + j) % n;
        if (!blocks[i].allocated && blocks[i].size >= requiredSize) {
          return i;
        }
      }
      return -1;
    }

    case "buddy": {
      const buddySize = nextPowerOf2(requiredSize);
      let bestBuddyIdx = -1;
      let bestBuddySize = Infinity;
      for (let i = 0; i < blocks.length; i++) {
        if (!blocks[i].allocated && blocks[i].size >= buddySize && blocks[i].size < bestBuddySize) {
          bestBuddySize = blocks[i].size;
          bestBuddyIdx = i;
        }
      }
      return bestBuddyIdx;
    }

    default:
      return -1;
  }
}

function performMalloc(
  state: AllocatorState,
  requestedSize: number,
  strategy: Strategy,
): AllocatorState {
  const blocks = state.blocks.map((b) => ({ ...b }));
  const logs = [...state.logs];
  let logId = state.logIdCounter;
  let { nextLabel, nextFitPointer } = state;

  if (requestedSize <= 0) {
    logs.push({
      id: logId++,
      type: "info",
      description: "malloc(0): invalid size",
      timestamp: Date.now(),
    });
    return { ...state, logs, logIdCounter: logId };
  }

  const freeIdx = findFreeBlock(blocks, requestedSize, strategy, nextFitPointer);

  if (freeIdx === -1) {
    logs.push({
      id: logId++,
      type: "malloc",
      description: `malloc(${requestedSize}): FAILED - no suitable block found`,
      size: requestedSize,
      timestamp: Date.now(),
    });
    return { ...state, blocks, logs, logIdCounter: logId };
  }

  const freeBlock = blocks[freeIdx];
  const label = labelForIndex(nextLabel);
  const color = BLOCK_COLORS[nextLabel % BLOCK_COLORS.length];
  nextLabel++;

  if (strategy === "buddy") {
    const buddySize = nextPowerOf2(requestedSize + METADATA_SIZE);

    // Split down to the right size
    while (freeBlock.size > buddySize && freeBlock.size / 2 >= buddySize) {
      const halfSize = freeBlock.size / 2;
      freeBlock.size = halfSize;

      blocks.splice(freeIdx + 1, 0, {
        address: freeBlock.address + halfSize,
        size: halfSize,
        allocated: false,
        label: "",
        color: "",
        metadataSize: 0,
      });

      logs.push({
        id: logId++,
        type: "info",
        description: `Split block at 0x${freeBlock.address.toString(16)} into two ${halfSize}B buddies`,
        timestamp: Date.now(),
      });
    }

    freeBlock.allocated = true;
    freeBlock.label = label;
    freeBlock.color = color;
    freeBlock.metadataSize = METADATA_SIZE;

    logs.push({
      id: logId++,
      type: "malloc",
      description: `malloc(${requestedSize}) = 0x${(freeBlock.address + METADATA_SIZE).toString(16).padStart(4, "0")} [Block ${label}, ${freeBlock.size}B buddy]`,
      address: freeBlock.address + METADATA_SIZE,
      size: requestedSize,
      timestamp: Date.now(),
    });
  } else {
    const totalNeeded = requestedSize + METADATA_SIZE;
    const remaining = freeBlock.size - totalNeeded;
    const minSplitSize = METADATA_SIZE + 1;

    if (remaining >= minSplitSize) {
      // Split the block
      blocks.splice(freeIdx + 1, 0, {
        address: freeBlock.address + totalNeeded,
        size: remaining,
        allocated: false,
        label: "",
        color: "",
        metadataSize: 0,
      });
      freeBlock.size = totalNeeded;
    }

    freeBlock.allocated = true;
    freeBlock.label = label;
    freeBlock.color = color;
    freeBlock.metadataSize = METADATA_SIZE;

    if (strategy === "next-fit") {
      nextFitPointer = freeIdx + 1;
      if (nextFitPointer >= blocks.length) nextFitPointer = 0;
    }

    logs.push({
      id: logId++,
      type: "malloc",
      description: `malloc(${requestedSize}) = 0x${(freeBlock.address + METADATA_SIZE).toString(16).padStart(4, "0")} [Block ${label}, ${freeBlock.size}B]`,
      address: freeBlock.address + METADATA_SIZE,
      size: requestedSize,
      timestamp: Date.now(),
    });
  }

  return { blocks, logs, nextLabel, nextFitPointer, logIdCounter: logId };
}

function coalesceBlocks(blocks: Block[], logs: OperationLog[], startLogId: number): { blocks: Block[]; logs: OperationLog[]; logId: number } {
  let logId = startLogId;
  let merged = true;

  while (merged) {
    merged = false;
    for (let i = 0; i < blocks.length - 1; i++) {
      if (!blocks[i].allocated && !blocks[i + 1].allocated) {
        const mergedAddr = blocks[i].address;
        const mergedSize = blocks[i].size + blocks[i + 1].size;
        blocks[i].size = mergedSize;
        blocks.splice(i + 1, 1);
        merged = true;

        logs.push({
          id: logId++,
          type: "coalesce",
          description: `Coalesced free blocks at 0x${mergedAddr.toString(16)} -> ${mergedSize}B`,
          address: mergedAddr,
          size: mergedSize,
          timestamp: Date.now(),
        });
        break;
      }
    }
  }

  return { blocks, logs, logId };
}

function coalesceBuddyBlocks(blocks: Block[], logs: OperationLog[], startLogId: number): { blocks: Block[]; logs: OperationLog[]; logId: number } {
  let logId = startLogId;
  let merged = true;

  while (merged) {
    merged = false;
    for (let i = 0; i < blocks.length - 1; i++) {
      if (!blocks[i].allocated && !blocks[i + 1].allocated) {
        const a = blocks[i];
        const b = blocks[i + 1];
        // Buddies must be same size and power of 2
        if (a.size === b.size && (a.size & (a.size - 1)) === 0) {
          // The buddy address must be aligned correctly
          const buddyAddr = a.address ^ a.size;
          if (buddyAddr === b.address) {
            const mergedSize = a.size * 2;
            a.size = mergedSize;
            blocks.splice(i + 1, 1);
            merged = true;

            logs.push({
              id: logId++,
              type: "coalesce",
              description: `Merged buddies at 0x${a.address.toString(16)} + 0x${b.address.toString(16)} -> ${mergedSize}B`,
              address: a.address,
              size: mergedSize,
              timestamp: Date.now(),
            });
            break;
          }
        }
      }
    }
  }

  return { blocks, logs, logId };
}

function performFree(
  state: AllocatorState,
  blockLabel: string,
  strategy: Strategy,
): AllocatorState {
  const blocks = state.blocks.map((b) => ({ ...b }));
  const logs = [...state.logs];
  let logId = state.logIdCounter;

  const idx = blocks.findIndex((b) => b.allocated && b.label === blockLabel);
  if (idx === -1) {
    logs.push({
      id: logId++,
      type: "info",
      description: `free(${blockLabel}): block not found`,
      timestamp: Date.now(),
    });
    return { ...state, logs, logIdCounter: logId };
  }

  const block = blocks[idx];
  logs.push({
    id: logId++,
    type: "free",
    description: `free(Block ${blockLabel}) at 0x${block.address.toString(16).padStart(4, "0")} [${block.size}B]`,
    address: block.address,
    size: block.size,
    timestamp: Date.now(),
  });

  block.allocated = false;
  block.label = "";
  block.color = "";
  block.metadataSize = 0;

  // Coalesce adjacent free blocks
  const coalResult = strategy === "buddy"
    ? coalesceBuddyBlocks(blocks, logs, logId)
    : coalesceBlocks(blocks, logs, logId);

  return {
    ...state,
    blocks: coalResult.blocks,
    logs: coalResult.logs,
    logIdCounter: coalResult.logId,
  };
}

function computeMetrics(blocks: Block[], heapSize: number): Metrics {
  let used = 0;
  let freeTotal = 0;
  let largestFree = 0;
  let freeBlockCount = 0;

  for (const block of blocks) {
    if (block.allocated) {
      used += block.size;
    } else {
      freeTotal += block.size;
      freeBlockCount++;
      if (block.size > largestFree) largestFree = block.size;
    }
  }

  // External fragmentation: 1 - (largest_free / total_free)
  const fragmentation = freeTotal > 0 && freeBlockCount > 1
    ? ((1 - largestFree / freeTotal) * 100)
    : 0;

  return {
    total: heapSize,
    used,
    free: freeTotal,
    fragmentation: Math.round(fragmentation * 10) / 10,
    largestFree,
    blockCount: blocks.length,
    freeBlockCount,
  };
}

/* ══════════════════════════════════════════════════════════
   Presets
   ══════════════════════════════════════════════════════════ */

const PRESETS: Preset[] = [
  {
    name: "Fragment then compact",
    description: "Allocate many small blocks, free alternating ones, then observe fragmentation",
    operations: [
      { type: "malloc", size: 32 },
      { type: "malloc", size: 32 },
      { type: "malloc", size: 32 },
      { type: "malloc", size: 32 },
      { type: "malloc", size: 32 },
      { type: "malloc", size: 32 },
      { type: "malloc", size: 32 },
      { type: "malloc", size: 32 },
      { type: "free", label: "B" },
      { type: "free", label: "D" },
      { type: "free", label: "F" },
      { type: "free", label: "H" },
    ],
  },
  {
    name: "Best fit advantage",
    description: "Show how best fit uses smaller gaps more efficiently than first fit",
    operations: [
      { type: "malloc", size: 64 },
      { type: "malloc", size: 128 },
      { type: "malloc", size: 32 },
      { type: "malloc", size: 96 },
      { type: "free", label: "A" },
      { type: "free", label: "C" },
      { type: "malloc", size: 30 },
    ],
  },
  {
    name: "Buddy system demo",
    description: "Watch power-of-2 splitting and buddy merging in action",
    operations: [
      { type: "malloc", size: 50 },
      { type: "malloc", size: 30 },
      { type: "malloc", size: 100 },
      { type: "malloc", size: 20 },
      { type: "free", label: "B" },
      { type: "free", label: "A" },
      { type: "malloc", size: 60 },
    ],
  },
];

/* ══════════════════════════════════════════════════════════
   Canvas Rendering
   ══════════════════════════════════════════════════════════ */

function readThemeColors(): {
  bg: string;
  surface: string;
  text: string;
  textMuted: string;
  border: string;
  heading: string;
  primary: string;
  accent: string;
} {
  if (typeof document === "undefined") {
    return {
      bg: "#09090b",
      surface: "#111111",
      text: "#e4e4e7",
      textMuted: "#a1a1aa",
      border: "#27272a",
      heading: "#ffffff",
      primary: "#4f8ff7",
      accent: "#34d399",
    };
  }
  const s = getComputedStyle(document.documentElement);
  return {
    bg: s.getPropertyValue("--color-bg").trim() || "#09090b",
    surface: s.getPropertyValue("--color-surface").trim() || "#111111",
    text: s.getPropertyValue("--color-text").trim() || "#e4e4e7",
    textMuted: s.getPropertyValue("--color-text-muted").trim() || "#a1a1aa",
    border: s.getPropertyValue("--color-border").trim() || "#27272a",
    heading: s.getPropertyValue("--color-heading").trim() || "#ffffff",
    primary: s.getPropertyValue("--color-primary").trim() || "#4f8ff7",
    accent: s.getPropertyValue("--color-accent").trim() || "#34d399",
  };
}

function renderHeapCanvas(
  ctx: CanvasRenderingContext2D,
  blocks: Block[],
  heapSize: number,
  width: number,
  height: number,
  highlightLabel: string | null,
): void {
  const colors = readThemeColors();
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const padding = 16;
  const barHeight = 64;
  const barY = height / 2 - barHeight / 2 - 10;
  const barWidth = width - padding * 2;

  // Background border
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(padding - 0.5, barY - 0.5, barWidth + 1, barHeight + 1);

  // Render each block
  for (const block of blocks) {
    const x = padding + (block.address / heapSize) * barWidth;
    const w = (block.size / heapSize) * barWidth;

    if (block.allocated) {
      // Metadata header
      const metaW = (block.metadataSize / heapSize) * barWidth;
      ctx.fillStyle = darken(block.color, 0.5);
      ctx.fillRect(x, barY, metaW, barHeight);

      // Data portion
      const isHighlighted = highlightLabel === block.label;
      ctx.fillStyle = isHighlighted ? lighten(block.color, 0.2) : block.color;
      ctx.globalAlpha = isHighlighted ? 1 : 0.85;
      ctx.fillRect(x + metaW, barY, w - metaW, barHeight);
      ctx.globalAlpha = 1;

      // Border between metadata and data
      ctx.strokeStyle = darken(block.color, 0.3);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + metaW, barY);
      ctx.lineTo(x + metaW, barY + barHeight);
      ctx.stroke();

      // Block border
      ctx.strokeStyle = isHighlighted ? colors.heading : darken(block.color, 0.2);
      ctx.lineWidth = isHighlighted ? 2 : 1;
      ctx.strokeRect(x, barY, w, barHeight);

      // Label
      if (w > 20) {
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold ${Math.min(16, w * 0.5)}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(block.label, x + w / 2, barY + barHeight / 2 - 2);

        // Size label below
        if (w > 35) {
          ctx.fillStyle = "rgba(255,255,255,0.7)";
          ctx.font = `${Math.min(10, w * 0.3)}px Inter, sans-serif`;
          ctx.fillText(`${block.size - METADATA_SIZE}B`, x + w / 2, barY + barHeight / 2 + 12);
        }
      }
    } else {
      // Free block
      ctx.fillStyle = colors.surface;
      ctx.fillRect(x, barY, w, barHeight);

      // Hatch pattern for free blocks
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 0.5;
      const step = 8;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, barY, w, barHeight);
      ctx.clip();
      for (let hx = x - barHeight; hx < x + w + barHeight; hx += step) {
        ctx.beginPath();
        ctx.moveTo(hx, barY);
        ctx.lineTo(hx + barHeight, barY + barHeight);
        ctx.stroke();
      }
      ctx.restore();

      // Border
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, barY, w, barHeight);

      // "FREE" label
      if (w > 40) {
        ctx.fillStyle = colors.textMuted;
        ctx.font = `${Math.min(11, w * 0.3)}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("FREE", x + w / 2, barY + barHeight / 2 - 4);
        ctx.fillText(`${block.size}B`, x + w / 2, barY + barHeight / 2 + 10);
      }
    }
  }

  // Address markers below the bar
  ctx.fillStyle = colors.textMuted;
  ctx.font = "9px JetBrains Mono, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const markerY = barY + barHeight + 6;
  const drawnAddresses = new Set<number>();

  for (const block of blocks) {
    const x = padding + (block.address / heapSize) * barWidth;
    const w = (block.size / heapSize) * barWidth;

    // Start address
    if (!drawnAddresses.has(block.address) && w > 25) {
      ctx.textAlign = "center";
      ctx.fillText(`0x${block.address.toString(16)}`, Math.max(x, padding + 12), markerY);
      drawnAddresses.add(block.address);
    }
  }

  // End address
  ctx.textAlign = "right";
  ctx.fillText(`0x${heapSize.toString(16)}`, padding + barWidth, markerY);

  // Title
  ctx.fillStyle = colors.heading;
  ctx.font = "bold 12px Inter, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("Heap Memory", padding, barY - 8);

  // Size label
  ctx.fillStyle = colors.textMuted;
  ctx.font = "11px Inter, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`${heapSize} bytes`, padding + barWidth, barY - 8);
}

function darken(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.round(r * (1 - amount))}, ${Math.round(g * (1 - amount))}, ${Math.round(b * (1 - amount))})`;
}

function lighten(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.min(255, Math.round(r + (255 - r) * amount))}, ${Math.min(255, Math.round(g + (255 - g) * amount))}, ${Math.min(255, Math.round(b + (255 - b) * amount))})`;
}

/* ══════════════════════════════════════════════════════════
   Component
   ══════════════════════════════════════════════════════════ */

export default function MemoryAllocator() {
  const [heapSize, setHeapSize] = useState(512);
  const [strategy, setStrategy] = useState<Strategy>("first-fit");
  const [allocState, setAllocState] = useState<AllocatorState>(() => createInitialState(512));
  const [mallocSize, setMallocSize] = useState("64");
  const [highlightLabel, setHighlightLabel] = useState<string | null>(null);
  const [stepMode, setStepMode] = useState(false);
  const [pendingOps, setPendingOps] = useState<Array<{ type: "malloc" | "free"; size?: number; label?: string }>>([]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logPanelRef = useRef<HTMLDivElement>(null);

  const metrics = computeMetrics(allocState.blocks, heapSize);
  const allocatedBlocks = allocState.blocks.filter((b) => b.allocated);

  // Canvas rendering
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    renderHeapCanvas(ctx, allocState.blocks, heapSize, rect.width, rect.height, highlightLabel);
  }, [allocState.blocks, heapSize, highlightLabel]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  // Redraw on theme changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      requestAnimationFrame(redraw);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [redraw]);

  // Redraw on resize
  useEffect(() => {
    const handleResize = () => requestAnimationFrame(redraw);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [redraw]);

  // Auto-scroll log panel
  useEffect(() => {
    if (logPanelRef.current) {
      logPanelRef.current.scrollTop = logPanelRef.current.scrollHeight;
    }
  }, [allocState.logs]);

  const handleMalloc = useCallback(() => {
    const size = parseInt(mallocSize, 10);
    if (isNaN(size) || size <= 0) return;
    setAllocState((prev) => performMalloc(prev, size, strategy));
  }, [mallocSize, strategy]);

  const handleFree = useCallback(
    (label: string) => {
      setAllocState((prev) => performFree(prev, label, strategy));
    },
    [strategy],
  );

  const handleReset = useCallback(() => {
    setAllocState(createInitialState(heapSize));
    setPendingOps([]);
  }, [heapSize]);

  const handleHeapSizeChange = useCallback((newSize: number) => {
    setHeapSize(newSize);
    setAllocState(createInitialState(newSize));
    setPendingOps([]);
  }, []);

  const handleStrategyChange = useCallback((newStrategy: Strategy) => {
    setStrategy(newStrategy);
    setAllocState(createInitialState(heapSize));
    setPendingOps([]);
  }, [heapSize]);

  const handlePreset = useCallback(
    (preset: Preset) => {
      if (stepMode) {
        // In step mode, queue all operations
        setAllocState(createInitialState(heapSize));
        setPendingOps([...preset.operations]);
      } else {
        // Execute all at once
        let state = createInitialState(heapSize);
        for (const op of preset.operations) {
          if (op.type === "malloc" && op.size) {
            state = performMalloc(state, op.size, strategy);
          } else if (op.type === "free" && op.label) {
            state = performFree(state, op.label, strategy);
          }
        }
        setAllocState(state);
        setPendingOps([]);
      }
    },
    [heapSize, strategy, stepMode],
  );

  const handleStepNext = useCallback(() => {
    if (pendingOps.length === 0) return;
    const [next, ...rest] = pendingOps;
    if (next.type === "malloc" && next.size) {
      setAllocState((prev) => performMalloc(prev, next.size!, strategy));
    } else if (next.type === "free" && next.label) {
      setAllocState((prev) => performFree(prev, next.label!, strategy));
    }
    setPendingOps(rest);
  }, [pendingOps, strategy]);

  const handleRunAll = useCallback(() => {
    let state = allocState;
    for (const op of pendingOps) {
      if (op.type === "malloc" && op.size) {
        state = performMalloc(state, op.size, strategy);
      } else if (op.type === "free" && op.label) {
        state = performFree(state, op.label, strategy);
      }
    }
    setAllocState(state);
    setPendingOps([]);
  }, [allocState, pendingOps, strategy]);

  const selectedStrategyInfo = STRATEGIES.find((s) => s.value === strategy);

  return (
    <div class="space-y-4">
      {/* Controls Row */}
      <div
        class="rounded-lg p-4"
        style={{
          backgroundColor: "var(--color-surface)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div class="flex flex-wrap items-end gap-4">
          {/* Heap Size */}
          <div>
            <label
              class="mb-1 block text-xs font-medium"
              style={{ color: "var(--color-text-muted)" }}
            >
              Heap Size
            </label>
            <select
              value={heapSize}
              onChange={(e) => handleHeapSizeChange(parseInt((e.target as HTMLSelectElement).value, 10))}
              class="rounded px-2 py-1.5 text-sm"
              style={{
                backgroundColor: "var(--color-bg)",
                color: "var(--color-text)",
                border: "1px solid var(--color-border)",
              }}
            >
              {HEAP_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} bytes
                </option>
              ))}
            </select>
          </div>

          {/* Strategy */}
          <div>
            <label
              class="mb-1 block text-xs font-medium"
              style={{ color: "var(--color-text-muted)" }}
            >
              Strategy
            </label>
            <select
              value={strategy}
              onChange={(e) => handleStrategyChange((e.target as HTMLSelectElement).value as Strategy)}
              class="rounded px-2 py-1.5 text-sm"
              style={{
                backgroundColor: "var(--color-bg)",
                color: "var(--color-text)",
                border: "1px solid var(--color-border)",
              }}
            >
              {STRATEGIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* Malloc */}
          <div class="flex items-end gap-2">
            <div>
              <label
                class="mb-1 block text-xs font-medium"
                style={{ color: "var(--color-text-muted)" }}
              >
                Size (bytes)
              </label>
              <input
                type="number"
                min="1"
                max={heapSize}
                value={mallocSize}
                onInput={(e) => setMallocSize((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleMalloc();
                }}
                class="w-20 rounded px-2 py-1.5 text-sm"
                style={{
                  backgroundColor: "var(--color-bg)",
                  color: "var(--color-text)",
                  border: "1px solid var(--color-border)",
                }}
              />
            </div>
            <button
              onClick={handleMalloc}
              class="rounded px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-80"
              style={{
                backgroundColor: "var(--color-primary)",
                color: "#ffffff",
              }}
            >
              malloc()
            </button>
          </div>

          {/* Step Mode */}
          <div class="flex items-end gap-2">
            <label class="flex cursor-pointer items-center gap-2 text-sm" style={{ color: "var(--color-text)" }}>
              <input
                type="checkbox"
                checked={stepMode}
                onChange={(e) => setStepMode((e.target as HTMLInputElement).checked)}
                class="accent-[var(--color-primary)]"
              />
              Step mode
            </label>
          </div>

          {/* Reset */}
          <button
            onClick={handleReset}
            class="rounded px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-80"
            style={{
              backgroundColor: "transparent",
              color: "var(--color-text-muted)",
              border: "1px solid var(--color-border)",
            }}
          >
            Reset
          </button>
        </div>

        {/* Strategy description */}
        {selectedStrategyInfo && (
          <p class="mt-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
            {selectedStrategyInfo.description}
          </p>
        )}
      </div>

      {/* Step Mode Controls */}
      {stepMode && pendingOps.length > 0 && (
        <div
          class="flex items-center gap-3 rounded-lg p-3"
          style={{
            backgroundColor: "var(--color-surface)",
            border: "1px solid var(--color-primary)",
          }}
        >
          <span class="text-xs font-medium" style={{ color: "var(--color-primary)" }}>
            {pendingOps.length} operation{pendingOps.length !== 1 ? "s" : ""} pending
          </span>
          <button
            onClick={handleStepNext}
            class="rounded px-3 py-1 text-xs font-medium transition-opacity hover:opacity-80"
            style={{
              backgroundColor: "var(--color-primary)",
              color: "#ffffff",
            }}
          >
            Step ({pendingOps[0].type === "malloc" ? `malloc(${pendingOps[0].size})` : `free(${pendingOps[0].label})`})
          </button>
          <button
            onClick={handleRunAll}
            class="rounded px-3 py-1 text-xs font-medium transition-opacity hover:opacity-80"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "#ffffff",
            }}
          >
            Run All
          </button>
        </div>
      )}

      {/* Heap Visualization */}
      <div
        class="overflow-hidden rounded-lg"
        style={{
          backgroundColor: "var(--color-bg)",
          border: "1px solid var(--color-border)",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "140px", display: "block" }}
        />
      </div>

      {/* Metrics + Free Blocks + Allocated Blocks */}
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Metrics */}
        <div
          class="rounded-lg p-4"
          style={{
            backgroundColor: "var(--color-surface)",
            border: "1px solid var(--color-border)",
          }}
        >
          <h3
            class="mb-3 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-text-muted)" }}
          >
            Fragmentation Metrics
          </h3>
          <div class="space-y-2">
            <MetricRow label="Total Memory" value={`${metrics.total}B`} />
            <MetricRow label="Used Memory" value={`${metrics.used}B`} accent />
            <MetricRow label="Free Memory" value={`${metrics.free}B`} />
            <MetricRow label="Fragmentation" value={`${metrics.fragmentation}%`} warn={metrics.fragmentation > 50} />
            <MetricRow label="Largest Free" value={`${metrics.largestFree}B`} />
            <MetricRow label="Total Blocks" value={`${metrics.blockCount}`} />
            <MetricRow label="Free Blocks" value={`${metrics.freeBlockCount}`} />
          </div>
        </div>

        {/* Allocated Blocks (free buttons) */}
        <div
          class="rounded-lg p-4"
          style={{
            backgroundColor: "var(--color-surface)",
            border: "1px solid var(--color-border)",
          }}
        >
          <h3
            class="mb-3 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-text-muted)" }}
          >
            Allocated Blocks
          </h3>
          {allocatedBlocks.length === 0 ? (
            <p class="text-xs" style={{ color: "var(--color-text-muted)" }}>
              No blocks allocated
            </p>
          ) : (
            <div class="flex flex-wrap gap-2">
              {allocatedBlocks.map((block) => (
                <button
                  key={block.label}
                  onClick={() => handleFree(block.label)}
                  onMouseEnter={() => setHighlightLabel(block.label)}
                  onMouseLeave={() => setHighlightLabel(null)}
                  class="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-opacity hover:opacity-80"
                  style={{
                    backgroundColor: block.color,
                    color: "#ffffff",
                  }}
                  title={`free(Block ${block.label}) — ${block.size - METADATA_SIZE}B at 0x${block.address.toString(16)}`}
                >
                  <span>{block.label}</span>
                  <span class="opacity-70">{block.size - METADATA_SIZE}B</span>
                  <span class="opacity-50">x</span>
                </button>
              ))}
            </div>
          )}
          <p class="mt-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
            Click a block to free it
          </p>
        </div>

        {/* Presets */}
        <div
          class="rounded-lg p-4"
          style={{
            backgroundColor: "var(--color-surface)",
            border: "1px solid var(--color-border)",
          }}
        >
          <h3
            class="mb-3 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-text-muted)" }}
          >
            Presets
          </h3>
          <div class="space-y-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.name}
                onClick={() => handlePreset(preset)}
                class="block w-full rounded p-2 text-left transition-colors"
                style={{
                  backgroundColor: "var(--color-bg)",
                  border: "1px solid var(--color-border)",
                }}
              >
                <span
                  class="block text-xs font-medium"
                  style={{ color: "var(--color-heading)" }}
                >
                  {preset.name}
                </span>
                <span
                  class="block text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {preset.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Operation History */}
      <div
        class="rounded-lg p-4"
        style={{
          backgroundColor: "var(--color-surface)",
          border: "1px solid var(--color-border)",
        }}
      >
        <h3
          class="mb-3 text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-text-muted)" }}
        >
          Operation History
        </h3>
        <div
          ref={logPanelRef}
          class="space-y-1 overflow-y-auto font-mono text-xs"
          style={{
            maxHeight: "200px",
            color: "var(--color-text)",
          }}
        >
          {allocState.logs.map((log) => (
            <div
              key={log.id}
              class="flex items-start gap-2 rounded px-2 py-0.5"
              style={{
                backgroundColor: log.type === "malloc"
                  ? "rgba(79, 143, 247, 0.08)"
                  : log.type === "free"
                    ? "rgba(239, 68, 68, 0.08)"
                    : log.type === "coalesce"
                      ? "rgba(52, 211, 153, 0.08)"
                      : "transparent",
              }}
            >
              <span
                class="mt-0.5 inline-block w-14 flex-shrink-0 text-right font-semibold uppercase"
                style={{
                  color:
                    log.type === "malloc"
                      ? "var(--color-primary)"
                      : log.type === "free"
                        ? "#ef4444"
                        : log.type === "coalesce"
                          ? "var(--color-accent)"
                          : "var(--color-text-muted)",
                }}
              >
                {log.type === "coalesce" ? "merge" : log.type}
              </span>
              <span>{log.description}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div class="flex flex-wrap items-center gap-4 text-xs" style={{ color: "var(--color-text-muted)" }}>
        <div class="flex items-center gap-1.5">
          <span
            class="inline-block h-3 w-5 rounded-sm"
            style={{ backgroundColor: "var(--color-primary)" }}
          />
          <span>Allocated</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span
            class="inline-block h-3 w-5 rounded-sm"
            style={{ backgroundColor: darken("#4f8ff7", 0.5) }}
          />
          <span>Metadata ({METADATA_SIZE}B header)</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span
            class="inline-block h-3 w-5 rounded-sm"
            style={{
              backgroundColor: "var(--color-surface)",
              border: "1px solid var(--color-border)",
            }}
          />
          <span>Free</span>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Sub-components
   ══════════════════════════════════════════════════════════ */

function MetricRow({
  label,
  value,
  accent,
  warn,
}: {
  label: string;
  value: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div class="flex items-center justify-between">
      <span class="text-xs" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </span>
      <span
        class="text-xs font-semibold font-mono"
        style={{
          color: warn
            ? "#ef4444"
            : accent
              ? "var(--color-primary)"
              : "var(--color-heading)",
        }}
      >
        {value}
      </span>
    </div>
  );
}
