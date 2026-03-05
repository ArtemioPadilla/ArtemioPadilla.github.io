import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";

/* ══════════════════════════════════════
   Types
   ══════════════════════════════════════ */

type Tool = "pencil" | "eraser" | "fill" | "line" | "rect" | "circle" | "picker";
type CanvasSize = 8 | 16 | 32 | 64;
type MirrorMode = "none" | "horizontal" | "vertical" | "both";

interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface Layer {
  name: string;
  pixels: (string | null)[][];
  visible: boolean;
  opacity: number;
}

interface Frame {
  layers: Layer[];
  activeLayerIndex: number;
}

interface HistoryEntry {
  frames: Frame[];
  activeFrameIndex: number;
}

interface ToolDef {
  id: Tool;
  label: string;
  shortcut: string;
}

interface Preset {
  name: string;
  size: CanvasSize;
  pixels: Record<string, string>;
}

/* ══════════════════════════════════════
   Constants
   ══════════════════════════════════════ */

const CANVAS_SIZES: CanvasSize[] = [8, 16, 32, 64];

const TOOLS: ToolDef[] = [
  { id: "pencil", label: "Pencil", shortcut: "B" },
  { id: "eraser", label: "Eraser", shortcut: "E" },
  { id: "fill", label: "Fill", shortcut: "G" },
  { id: "line", label: "Line", shortcut: "L" },
  { id: "rect", label: "Rectangle", shortcut: "R" },
  { id: "circle", label: "Circle", shortcut: "C" },
  { id: "picker", label: "Picker", shortcut: "I" },
];

const TOOL_ICONS: Record<Tool, string> = {
  pencil: "✏️",
  eraser: "🧹",
  fill: "🪣",
  line: "📏",
  rect: "⬜",
  circle: "⭕",
  picker: "💉",
};

const PICO8_PALETTE = [
  "#000000", "#1D2B53", "#7E2553", "#008751",
  "#AB5236", "#5F574F", "#C2C3C7", "#FFF1E8",
  "#FF004D", "#FFA300", "#FFEC27", "#00E436",
  "#29ADFF", "#83769C", "#FF77A8", "#FFCCAA",
];

const MAX_LAYERS = 4;
const MAX_HISTORY = 50;
const MAX_RECENT_COLORS = 8;

/* ══════════════════════════════════════
   Pure helper functions
   ══════════════════════════════════════ */

function createEmptyGrid(size: number): (string | null)[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}

function cloneGrid(grid: (string | null)[][]): (string | null)[][] {
  return grid.map((row) => [...row]);
}

function cloneLayer(layer: Layer): Layer {
  return {
    name: layer.name,
    pixels: cloneGrid(layer.pixels),
    visible: layer.visible,
    opacity: layer.opacity,
  };
}

function cloneFrame(frame: Frame): Frame {
  return {
    layers: frame.layers.map(cloneLayer),
    activeLayerIndex: frame.activeLayerIndex,
  };
}

function createDefaultLayer(size: number, name: string): Layer {
  return {
    name,
    pixels: createEmptyGrid(size),
    visible: true,
    opacity: 1,
  };
}

function createDefaultFrame(size: number): Frame {
  return {
    layers: [createDefaultLayer(size, "Layer 1")],
    activeLayerIndex: 0,
  };
}

function parseHexColor(hex: string): RGBA {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b, a: 255 };
}

function colorsMatch(a: string | null, b: string | null): boolean {
  return a === b;
}

/* ── Drawing algorithms ─────────────── */

function bresenhamLine(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const points: [number, number][] = [];
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0;
  let cy = y0;

  for (;;) {
    points.push([cx, cy]);
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      cx += sx;
    }
    if (e2 < dx) {
      err += dx;
      cy += sy;
    }
  }
  return points;
}

function midpointCircle(cx: number, cy: number, radius: number): [number, number][] {
  const points: [number, number][] = [];
  if (radius <= 0) {
    points.push([cx, cy]);
    return points;
  }
  let x = radius;
  let y = 0;
  let d = 1 - radius;

  const addSymmetric = (px: number, py: number) => {
    points.push([cx + px, cy + py]);
    points.push([cx - px, cy + py]);
    points.push([cx + px, cy - py]);
    points.push([cx - px, cy - py]);
    points.push([cx + py, cy + px]);
    points.push([cx - py, cy + px]);
    points.push([cx + py, cy - px]);
    points.push([cx - py, cy - px]);
  };

  addSymmetric(x, y);
  while (x > y) {
    y++;
    if (d <= 0) {
      d += 2 * y + 1;
    } else {
      x--;
      d += 2 * (y - x) + 1;
    }
    addSymmetric(x, y);
  }
  return points;
}

function rectOutline(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  const points: [number, number][] = [];
  for (let x = minX; x <= maxX; x++) {
    points.push([x, minY]);
    points.push([x, maxY]);
  }
  for (let y = minY + 1; y < maxY; y++) {
    points.push([minX, y]);
    points.push([maxX, y]);
  }
  return points;
}

function floodFill(
  grid: (string | null)[][],
  startX: number,
  startY: number,
  fillColor: string | null,
): (string | null)[][] {
  const size = grid.length;
  if (startX < 0 || startX >= size || startY < 0 || startY >= size) return grid;
  const targetColor = grid[startY][startX];
  if (colorsMatch(targetColor, fillColor)) return grid;

  const result = cloneGrid(grid);
  const stack: [number, number][] = [[startX, startY]];
  const visited = new Set<string>();

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    const key = `${x},${y}`;
    if (visited.has(key)) continue;
    if (x < 0 || x >= size || y < 0 || y >= size) continue;
    if (!colorsMatch(result[y][x], targetColor)) continue;

    visited.add(key);
    result[y][x] = fillColor;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return result;
}

function getMirroredPoints(
  x: number,
  y: number,
  size: number,
  mirror: MirrorMode,
): [number, number][] {
  const points: [number, number][] = [[x, y]];
  if (mirror === "horizontal" || mirror === "both") {
    points.push([size - 1 - x, y]);
  }
  if (mirror === "vertical" || mirror === "both") {
    points.push([x, size - 1 - y]);
  }
  if (mirror === "both") {
    points.push([size - 1 - x, size - 1 - y]);
  }
  return points;
}

/* ── Checkerboard pattern for transparency ── */

const CHECKER_LIGHT = "#cccccc";
const CHECKER_DARK = "#999999";

/* ── Preset sprites ──────────────────── */

function buildPresets(size: CanvasSize): Preset[] {
  const presets: Preset[] = [{ name: "Blank", size, pixels: {} }];

  if (size >= 8) {
    presets.push({
      name: "Smiley",
      size: 8,
      pixels: {
        "2,1": "#FFEC27", "3,1": "#FFEC27", "4,1": "#FFEC27", "5,1": "#FFEC27",
        "1,2": "#FFEC27", "2,2": "#FFEC27", "3,2": "#FFEC27", "4,2": "#FFEC27", "5,2": "#FFEC27", "6,2": "#FFEC27",
        "1,3": "#FFEC27", "2,3": "#000000", "3,3": "#FFEC27", "4,3": "#FFEC27", "5,3": "#000000", "6,3": "#FFEC27",
        "1,4": "#FFEC27", "2,4": "#FFEC27", "3,4": "#FFEC27", "4,4": "#FFEC27", "5,4": "#FFEC27", "6,4": "#FFEC27",
        "1,5": "#FFEC27", "2,5": "#FFEC27", "3,5": "#FFEC27", "4,5": "#FFEC27", "5,5": "#FFEC27", "6,5": "#FFEC27",
        "1,6": "#FFEC27", "2,6": "#000000", "3,6": "#FFEC27", "4,6": "#FFEC27", "5,6": "#000000", "6,6": "#FFEC27",
        "2,7": "#FFEC27", "3,7": "#000000", "4,7": "#000000", "5,7": "#FFEC27",
      },
    });

    presets.push({
      name: "Heart",
      size: 8,
      pixels: {
        "1,1": "#FF004D", "2,1": "#FF004D", "5,1": "#FF004D", "6,1": "#FF004D",
        "0,2": "#FF004D", "1,2": "#FF77A8", "2,2": "#FF004D", "3,2": "#FF004D",
        "4,2": "#FF004D", "5,2": "#FF004D", "6,2": "#FF004D", "7,2": "#FF004D",
        "0,3": "#FF004D", "1,3": "#FF004D", "2,3": "#FF004D", "3,3": "#FF004D",
        "4,3": "#FF004D", "5,3": "#FF004D", "6,3": "#FF004D", "7,3": "#FF004D",
        "1,4": "#FF004D", "2,4": "#FF004D", "3,4": "#FF004D", "4,4": "#FF004D",
        "5,4": "#FF004D", "6,4": "#FF004D",
        "2,5": "#FF004D", "3,5": "#FF004D", "4,5": "#FF004D", "5,5": "#FF004D",
        "3,6": "#FF004D", "4,6": "#FF004D",
      },
    });

    presets.push({
      name: "Arrow",
      size: 8,
      pixels: {
        "3,0": "#29ADFF",
        "2,1": "#29ADFF", "3,1": "#29ADFF", "4,1": "#29ADFF",
        "1,2": "#29ADFF", "3,2": "#29ADFF", "5,2": "#29ADFF",
        "0,3": "#29ADFF", "3,3": "#29ADFF", "6,3": "#29ADFF",
        "3,4": "#29ADFF",
        "3,5": "#29ADFF",
        "3,6": "#29ADFF",
        "3,7": "#29ADFF",
      },
    });

    presets.push({
      name: "Sword",
      size: 8,
      pixels: {
        "6,0": "#C2C3C7", "7,0": "#C2C3C7",
        "5,1": "#C2C3C7", "6,1": "#FFF1E8",
        "4,2": "#C2C3C7", "5,2": "#FFF1E8",
        "3,3": "#C2C3C7",
        "2,4": "#AB5236", "3,4": "#C2C3C7",
        "1,5": "#AB5236", "2,5": "#C2C3C7",
        "0,6": "#5F574F", "1,6": "#AB5236",
        "0,7": "#5F574F",
      },
    });
  }

  return presets;
}

/* ── GIF encoder (minimal LZW) ──────── */

function encodeGif(
  frames: Uint8Array[],
  width: number,
  height: number,
  palette: string[],
  delayCs: number,
): Uint8Array {
  const colorCount = 256;
  const colorBits = 8;

  const paletteBytes = new Uint8Array(colorCount * 3);
  for (let i = 0; i < palette.length && i < colorCount; i++) {
    const c = parseHexColor(palette[i]);
    paletteBytes[i * 3] = c.r;
    paletteBytes[i * 3 + 1] = c.g;
    paletteBytes[i * 3 + 2] = c.b;
  }

  const parts: Uint8Array[] = [];

  const pushBytes = (...bytes: number[]) => parts.push(new Uint8Array(bytes));
  const pushData = (data: Uint8Array) => parts.push(data);

  // Header
  pushBytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); // GIF89a

  // Logical Screen Descriptor
  pushBytes(width & 0xff, (width >> 8) & 0xff);
  pushBytes(height & 0xff, (height >> 8) & 0xff);
  pushBytes(0x80 | (colorBits - 1), 0, 0); // GCT flag, bg color, aspect

  // Global Color Table
  pushData(paletteBytes);

  // Netscape extension for looping
  pushBytes(0x21, 0xff, 0x0b);
  pushBytes(0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30); // NETSCAPE2.0
  pushBytes(0x03, 0x01, 0x00, 0x00, 0x00); // loop forever

  for (const frame of frames) {
    // Graphics Control Extension
    pushBytes(0x21, 0xf9, 0x04);
    pushBytes(0x09, delayCs & 0xff, (delayCs >> 8) & 0xff, 0x00); // disposal=restore, transparent=0
    pushBytes(0x00);

    // Image Descriptor
    pushBytes(0x2c, 0x00, 0x00, 0x00, 0x00);
    pushBytes(width & 0xff, (width >> 8) & 0xff);
    pushBytes(height & 0xff, (height >> 8) & 0xff);
    pushBytes(0x00); // no local color table

    // LZW compressed data
    const minCodeSize = colorBits;
    pushBytes(minCodeSize);

    const lzwData = lzwEncode(frame, minCodeSize);
    // Write in sub-blocks of max 255 bytes
    let offset = 0;
    while (offset < lzwData.length) {
      const chunkSize = Math.min(255, lzwData.length - offset);
      pushBytes(chunkSize);
      pushData(lzwData.slice(offset, offset + chunkSize));
      offset += chunkSize;
    }
    pushBytes(0x00); // block terminator
  }

  // Trailer
  pushBytes(0x3b);

  let totalLen = 0;
  for (const p of parts) totalLen += p.length;
  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of parts) {
    result.set(p, pos);
    pos += p.length;
  }
  return result;
}

function lzwEncode(data: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;

  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;

  const table = new Map<string, number>();
  const initTable = () => {
    table.clear();
    for (let i = 0; i < clearCode; i++) {
      table.set(String.fromCharCode(i), i);
    }
    codeSize = minCodeSize + 1;
    nextCode = eoiCode + 1;
  };

  const output: number[] = [];
  let buffer = 0;
  let bufferBits = 0;

  const writeCode = (code: number) => {
    buffer |= code << bufferBits;
    bufferBits += codeSize;
    while (bufferBits >= 8) {
      output.push(buffer & 0xff);
      buffer >>= 8;
      bufferBits -= 8;
    }
  };

  initTable();
  writeCode(clearCode);

  if (data.length === 0) {
    writeCode(eoiCode);
    if (bufferBits > 0) output.push(buffer & 0xff);
    return new Uint8Array(output);
  }

  let current = String.fromCharCode(data[0]);

  for (let i = 1; i < data.length; i++) {
    const ch = String.fromCharCode(data[i]);
    const combined = current + ch;
    if (table.has(combined)) {
      current = combined;
    } else {
      writeCode(table.get(current)!);
      if (nextCode < 4096) {
        table.set(combined, nextCode++);
        if (nextCode > (1 << codeSize) && codeSize < 12) {
          codeSize++;
        }
      } else {
        writeCode(clearCode);
        initTable();
      }
      current = ch;
    }
  }

  writeCode(table.get(current)!);
  writeCode(eoiCode);
  if (bufferBits > 0) output.push(buffer & 0xff);

  return new Uint8Array(output);
}

/* ══════════════════════════════════════
   Component
   ══════════════════════════════════════ */

export default function PixelArt() {
  /* ── Canvas size ─────────────────── */
  const [canvasSize, setCanvasSize] = useState<CanvasSize>(16);

  /* ── Frames & Layers ─────────────── */
  const [frames, setFrames] = useState<Frame[]>(() => [createDefaultFrame(16)]);
  const [activeFrameIndex, setActiveFrameIndex] = useState(0);

  /* ── Tools ───────────────────────── */
  const [activeTool, setActiveTool] = useState<Tool>("pencil");
  const [primaryColor, setPrimaryColor] = useState("#000000");
  const [recentColors, setRecentColors] = useState<string[]>(PICO8_PALETTE.slice(0, MAX_RECENT_COLORS));

  /* ── View ─────────────────────────── */
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [mirror, setMirror] = useState<MirrorMode>("none");

  /* ── History ──────────────────────── */
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  /* ── Animation ───────────────────── */
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(4);
  const [onionSkin, setOnionSkin] = useState(false);
  const [playFrameIndex, setPlayFrameIndex] = useState(0);

  /* ── UI panels ───────────────────── */
  const [showAnimPanel, setShowAnimPanel] = useState(false);

  /* ── Refs ─────────────────────────── */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const shapeStartRef = useRef<{ x: number; y: number } | null>(null);
  const previewPixelsRef = useRef<[number, number][]>([]);
  const isPanningRef = useRef(false);
  const lastPanRef = useRef({ x: 0, y: 0 });
  const lastPixelRef = useRef<{ x: number; y: number } | null>(null);

  /* ── Derived state ───────────────── */
  const activeFrame = frames[activeFrameIndex];
  const activeLayer = activeFrame?.layers[activeFrame.activeLayerIndex];
  const pixelSize = useMemo(() => {
    const base = canvasSize <= 16 ? 24 : canvasSize <= 32 ? 16 : 10;
    return Math.max(2, Math.floor(base * zoom));
  }, [canvasSize, zoom]);

  const canvasDim = canvasSize * pixelSize;

  /* ── Presets ─────────────────────── */
  const presets = useMemo(() => buildPresets(canvasSize), [canvasSize]);

  /* ══════════════════════════════════
     History management
     ══════════════════════════════════ */

  const pushHistory = useCallback(() => {
    setHistory((prev) => {
      const trimmed = prev.slice(0, historyIndex + 1);
      const entry: HistoryEntry = {
        frames: frames.map(cloneFrame),
        activeFrameIndex,
      };
      const next = [...trimmed, entry];
      if (next.length > MAX_HISTORY) next.shift();
      return next;
    });
    setHistoryIndex((prev) => Math.min(prev + 1, MAX_HISTORY - 1));
  }, [frames, activeFrameIndex, historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex < 0) return;
    const entry = history[historyIndex];
    if (!entry) return;
    setFrames(entry.frames.map(cloneFrame));
    setActiveFrameIndex(entry.activeFrameIndex);
    setHistoryIndex((i) => i - 1);
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex + 1 >= history.length - 1) return;
    const nextIndex = historyIndex + 2;
    if (nextIndex >= history.length) return;
    const entry = history[nextIndex];
    if (!entry) return;
    setFrames(entry.frames.map(cloneFrame));
    setActiveFrameIndex(entry.activeFrameIndex);
    setHistoryIndex(nextIndex - 1);
  }, [history, historyIndex]);

  /* ══════════════════════════════════
     Layer operations
     ══════════════════════════════════ */

  const updateActiveLayer = useCallback(
    (updater: (pixels: (string | null)[][]) => (string | null)[][]) => {
      setFrames((prev) => {
        const next = prev.map(cloneFrame);
        const frame = next[activeFrameIndex];
        frame.layers[frame.activeLayerIndex] = {
          ...frame.layers[frame.activeLayerIndex],
          pixels: updater(frame.layers[frame.activeLayerIndex].pixels),
        };
        return next;
      });
    },
    [activeFrameIndex],
  );

  const addLayer = useCallback(() => {
    if (activeFrame.layers.length >= MAX_LAYERS) return;
    pushHistory();
    setFrames((prev) => {
      const next = prev.map(cloneFrame);
      const frame = next[activeFrameIndex];
      const newLayer = createDefaultLayer(canvasSize, `Layer ${frame.layers.length + 1}`);
      frame.layers.push(newLayer);
      frame.activeLayerIndex = frame.layers.length - 1;
      return next;
    });
  }, [activeFrame, activeFrameIndex, canvasSize, pushHistory]);

  const removeLayer = useCallback(
    (index: number) => {
      if (activeFrame.layers.length <= 1) return;
      pushHistory();
      setFrames((prev) => {
        const next = prev.map(cloneFrame);
        const frame = next[activeFrameIndex];
        frame.layers.splice(index, 1);
        if (frame.activeLayerIndex >= frame.layers.length) {
          frame.activeLayerIndex = frame.layers.length - 1;
        }
        return next;
      });
    },
    [activeFrame, activeFrameIndex, pushHistory],
  );

  const toggleLayerVisibility = useCallback(
    (index: number) => {
      setFrames((prev) => {
        const next = prev.map(cloneFrame);
        const frame = next[activeFrameIndex];
        frame.layers[index].visible = !frame.layers[index].visible;
        return next;
      });
    },
    [activeFrameIndex],
  );

  const setLayerOpacity = useCallback(
    (index: number, opacity: number) => {
      setFrames((prev) => {
        const next = prev.map(cloneFrame);
        const frame = next[activeFrameIndex];
        frame.layers[index].opacity = opacity;
        return next;
      });
    },
    [activeFrameIndex],
  );

  const setActiveLayerIndex = useCallback(
    (index: number) => {
      setFrames((prev) => {
        const next = prev.map(cloneFrame);
        next[activeFrameIndex].activeLayerIndex = index;
        return next;
      });
    },
    [activeFrameIndex],
  );

  const moveLayer = useCallback(
    (fromIndex: number, direction: -1 | 1) => {
      const toIndex = fromIndex + direction;
      if (toIndex < 0 || toIndex >= activeFrame.layers.length) return;
      pushHistory();
      setFrames((prev) => {
        const next = prev.map(cloneFrame);
        const frame = next[activeFrameIndex];
        const temp = frame.layers[fromIndex];
        frame.layers[fromIndex] = frame.layers[toIndex];
        frame.layers[toIndex] = temp;
        if (frame.activeLayerIndex === fromIndex) frame.activeLayerIndex = toIndex;
        else if (frame.activeLayerIndex === toIndex) frame.activeLayerIndex = fromIndex;
        return next;
      });
    },
    [activeFrame, activeFrameIndex, pushHistory],
  );

  const mergeLayerDown = useCallback(
    (index: number) => {
      if (index <= 0) return;
      pushHistory();
      setFrames((prev) => {
        const next = prev.map(cloneFrame);
        const frame = next[activeFrameIndex];
        const top = frame.layers[index];
        const bottom = frame.layers[index - 1];
        for (let y = 0; y < canvasSize; y++) {
          for (let x = 0; x < canvasSize; x++) {
            if (top.pixels[y][x] !== null) {
              bottom.pixels[y][x] = top.pixels[y][x];
            }
          }
        }
        frame.layers.splice(index, 1);
        if (frame.activeLayerIndex >= frame.layers.length) {
          frame.activeLayerIndex = frame.layers.length - 1;
        }
        return next;
      });
    },
    [activeFrameIndex, canvasSize, pushHistory],
  );

  /* ══════════════════════════════════
     Frame operations
     ══════════════════════════════════ */

  const addFrame = useCallback(() => {
    pushHistory();
    setFrames((prev) => [...prev, createDefaultFrame(canvasSize)]);
    setActiveFrameIndex(frames.length);
  }, [canvasSize, frames.length, pushHistory]);

  const duplicateFrame = useCallback(() => {
    pushHistory();
    const cloned = cloneFrame(frames[activeFrameIndex]);
    setFrames((prev) => {
      const next = [...prev];
      next.splice(activeFrameIndex + 1, 0, cloned);
      return next;
    });
    setActiveFrameIndex(activeFrameIndex + 1);
  }, [frames, activeFrameIndex, pushHistory]);

  const removeFrame = useCallback(
    (index: number) => {
      if (frames.length <= 1) return;
      pushHistory();
      setFrames((prev) => {
        const next = [...prev];
        next.splice(index, 1);
        return next;
      });
      if (activeFrameIndex >= frames.length - 1) {
        setActiveFrameIndex(Math.max(0, frames.length - 2));
      }
    },
    [frames, activeFrameIndex, pushHistory],
  );

  /* ══════════════════════════════════
     Canvas resize
     ══════════════════════════════════ */

  const handleResize = useCallback(
    (newSize: CanvasSize) => {
      pushHistory();
      setCanvasSize(newSize);
      setFrames([createDefaultFrame(newSize)]);
      setActiveFrameIndex(0);
      setZoom(1);
      setPanOffset({ x: 0, y: 0 });
    },
    [pushHistory],
  );

  /* ══════════════════════════════════
     Load preset
     ══════════════════════════════════ */

  const loadPreset = useCallback(
    (preset: Preset) => {
      pushHistory();
      const targetSize = preset.size;
      setCanvasSize(targetSize);
      const frame = createDefaultFrame(targetSize);
      for (const [key, color] of Object.entries(preset.pixels)) {
        const [x, y] = key.split(",").map(Number);
        if (x >= 0 && x < targetSize && y >= 0 && y < targetSize) {
          frame.layers[0].pixels[y][x] = color;
        }
      }
      setFrames([frame]);
      setActiveFrameIndex(0);
      setZoom(1);
      setPanOffset({ x: 0, y: 0 });
    },
    [pushHistory],
  );

  /* ══════════════════════════════════
     Drawing logic
     ══════════════════════════════════ */

  const addRecentColor = useCallback((color: string) => {
    setRecentColors((prev) => {
      const filtered = prev.filter((c) => c !== color);
      return [color, ...filtered].slice(0, MAX_RECENT_COLORS);
    });
  }, []);

  const setPixelAt = useCallback(
    (grid: (string | null)[][], x: number, y: number, color: string | null): (string | null)[][] => {
      const result = cloneGrid(grid);
      const points = getMirroredPoints(x, y, canvasSize, mirror);
      for (const [px, py] of points) {
        if (px >= 0 && px < canvasSize && py >= 0 && py < canvasSize) {
          result[py][px] = color;
        }
      }
      return result;
    },
    [canvasSize, mirror],
  );

  const getPixelCoords = useCallback(
    (e: MouseEvent): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left - panOffset.x;
      const my = e.clientY - rect.top - panOffset.y;
      const x = Math.floor(mx / pixelSize);
      const y = Math.floor(my / pixelSize);
      if (x < 0 || x >= canvasSize || y < 0 || y >= canvasSize) return null;
      return { x, y };
    },
    [pixelSize, canvasSize, panOffset],
  );

  const handleCanvasMouseDown = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();

      // Middle button or space+click for panning
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        isPanningRef.current = true;
        lastPanRef.current = { x: e.clientX, y: e.clientY };
        return;
      }

      if (e.button !== 0) return;
      const coords = getPixelCoords(e);
      if (!coords) return;

      if (activeTool === "picker") {
        const color = activeLayer?.pixels[coords.y][coords.x];
        if (color) {
          setPrimaryColor(color);
          addRecentColor(color);
        }
        return;
      }

      if (activeTool === "fill") {
        pushHistory();
        const fillColor = primaryColor;
        updateActiveLayer((pixels) => floodFill(pixels, coords.x, coords.y, fillColor));
        addRecentColor(fillColor);
        return;
      }

      drawingRef.current = true;
      lastPixelRef.current = coords;

      if (activeTool === "line" || activeTool === "rect" || activeTool === "circle") {
        shapeStartRef.current = coords;
        previewPixelsRef.current = [[coords.x, coords.y]];
        return;
      }

      // Pencil or eraser
      pushHistory();
      const color = activeTool === "eraser" ? null : primaryColor;
      if (activeTool === "pencil") addRecentColor(primaryColor);
      updateActiveLayer((pixels) => setPixelAt(pixels, coords.x, coords.y, color));
    },
    [
      activeTool, primaryColor, activeLayer, canvasSize, mirror,
      getPixelCoords, pushHistory, updateActiveLayer, setPixelAt, addRecentColor,
    ],
  );

  const handleCanvasMouseMove = useCallback(
    (e: MouseEvent) => {
      if (isPanningRef.current) {
        const dx = e.clientX - lastPanRef.current.x;
        const dy = e.clientY - lastPanRef.current.y;
        setPanOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
        lastPanRef.current = { x: e.clientX, y: e.clientY };
        return;
      }

      if (!drawingRef.current) return;
      const coords = getPixelCoords(e);
      if (!coords) return;

      if (activeTool === "line" && shapeStartRef.current) {
        previewPixelsRef.current = bresenhamLine(
          shapeStartRef.current.x, shapeStartRef.current.y,
          coords.x, coords.y,
        );
        renderCanvas();
        return;
      }

      if (activeTool === "rect" && shapeStartRef.current) {
        previewPixelsRef.current = rectOutline(
          shapeStartRef.current.x, shapeStartRef.current.y,
          coords.x, coords.y,
        );
        renderCanvas();
        return;
      }

      if (activeTool === "circle" && shapeStartRef.current) {
        const dx = coords.x - shapeStartRef.current.x;
        const dy = coords.y - shapeStartRef.current.y;
        const radius = Math.round(Math.sqrt(dx * dx + dy * dy));
        previewPixelsRef.current = midpointCircle(
          shapeStartRef.current.x, shapeStartRef.current.y, radius,
        );
        renderCanvas();
        return;
      }

      // Pencil/eraser: draw continuous line from last pixel
      if (lastPixelRef.current && (coords.x !== lastPixelRef.current.x || coords.y !== lastPixelRef.current.y)) {
        const color = activeTool === "eraser" ? null : primaryColor;
        const linePoints = bresenhamLine(
          lastPixelRef.current.x, lastPixelRef.current.y,
          coords.x, coords.y,
        );
        updateActiveLayer((pixels) => {
          let result = cloneGrid(pixels);
          for (const [px, py] of linePoints) {
            const mirrored = getMirroredPoints(px, py, canvasSize, mirror);
            for (const [mx, my] of mirrored) {
              if (mx >= 0 && mx < canvasSize && my >= 0 && my < canvasSize) {
                result[my][mx] = color;
              }
            }
          }
          return result;
        });
        lastPixelRef.current = coords;
      }
    },
    [activeTool, primaryColor, canvasSize, mirror, getPixelCoords, updateActiveLayer],
  );

  const handleCanvasMouseUp = useCallback(
    (e: MouseEvent) => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        return;
      }

      if (!drawingRef.current) return;
      drawingRef.current = false;

      if (
        (activeTool === "line" || activeTool === "rect" || activeTool === "circle") &&
        shapeStartRef.current
      ) {
        const coords = getPixelCoords(e);
        if (!coords) {
          shapeStartRef.current = null;
          previewPixelsRef.current = [];
          return;
        }

        pushHistory();
        addRecentColor(primaryColor);

        let points: [number, number][] = [];
        if (activeTool === "line") {
          points = bresenhamLine(
            shapeStartRef.current.x, shapeStartRef.current.y,
            coords.x, coords.y,
          );
        } else if (activeTool === "rect") {
          points = rectOutline(
            shapeStartRef.current.x, shapeStartRef.current.y,
            coords.x, coords.y,
          );
        } else if (activeTool === "circle") {
          const dx = coords.x - shapeStartRef.current.x;
          const dy = coords.y - shapeStartRef.current.y;
          const radius = Math.round(Math.sqrt(dx * dx + dy * dy));
          points = midpointCircle(shapeStartRef.current.x, shapeStartRef.current.y, radius);
        }

        updateActiveLayer((pixels) => {
          let result = cloneGrid(pixels);
          for (const [px, py] of points) {
            const mirrored = getMirroredPoints(px, py, canvasSize, mirror);
            for (const [mx, my] of mirrored) {
              if (mx >= 0 && mx < canvasSize && my >= 0 && my < canvasSize) {
                result[my][mx] = primaryColor;
              }
            }
          }
          return result;
        });

        shapeStartRef.current = null;
        previewPixelsRef.current = [];
      }

      lastPixelRef.current = null;
    },
    [activeTool, primaryColor, canvasSize, mirror, getPixelCoords, pushHistory, updateActiveLayer, addRecentColor],
  );

  /* ══════════════════════════════════
     Zoom via scroll wheel
     ══════════════════════════════════ */

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      setZoom((prev) => {
        const delta = e.deltaY > 0 ? -1 : 1;
        return Math.max(1, Math.min(16, prev + delta));
      });
    },
    [],
  );

  /* ══════════════════════════════════
     Canvas rendering
     ══════════════════════════════════ */

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.translate(panOffset.x, panOffset.y);

    // Checkerboard background for transparency
    const checkerSize = Math.max(2, pixelSize / 2);
    for (let y = 0; y < canvasSize; y++) {
      for (let x = 0; x < canvasSize; x++) {
        const px = x * pixelSize;
        const py = y * pixelSize;
        // Draw 2x2 checkerboard within each pixel
        for (let cy = 0; cy < 2; cy++) {
          for (let cx = 0; cx < 2; cx++) {
            ctx.fillStyle = (cx + cy) % 2 === 0 ? CHECKER_LIGHT : CHECKER_DARK;
            ctx.fillRect(
              px + cx * checkerSize,
              py + cy * checkerSize,
              checkerSize,
              checkerSize,
            );
          }
        }
      }
    }

    // Determine which frame to render
    const renderFrame = playing ? frames[playFrameIndex] : activeFrame;
    if (!renderFrame) {
      ctx.restore();
      return;
    }

    // Onion skin: show previous frame dimmed
    if (onionSkin && !playing) {
      const prevIdx = activeFrameIndex - 1;
      if (prevIdx >= 0) {
        const prevFrame = frames[prevIdx];
        ctx.globalAlpha = 0.25;
        for (const layer of prevFrame.layers) {
          if (!layer.visible) continue;
          for (let y = 0; y < canvasSize; y++) {
            for (let x = 0; x < canvasSize; x++) {
              const color = layer.pixels[y][x];
              if (color) {
                ctx.fillStyle = color;
                ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
              }
            }
          }
        }
        ctx.globalAlpha = 1;
      }
    }

    // Render layers bottom to top
    for (const layer of renderFrame.layers) {
      if (!layer.visible) continue;
      ctx.globalAlpha = layer.opacity;
      for (let y = 0; y < canvasSize; y++) {
        for (let x = 0; x < canvasSize; x++) {
          const color = layer.pixels[y][x];
          if (color) {
            ctx.fillStyle = color;
            ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
          }
        }
      }
    }
    ctx.globalAlpha = 1;

    // Preview pixels for shape tools
    if (previewPixelsRef.current.length > 0 && !playing) {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = primaryColor;
      for (const [px, py] of previewPixelsRef.current) {
        const mirrored = getMirroredPoints(px, py, canvasSize, mirror);
        for (const [mx, my] of mirrored) {
          if (mx >= 0 && mx < canvasSize && my >= 0 && my < canvasSize) {
            ctx.fillRect(mx * pixelSize, my * pixelSize, pixelSize, pixelSize);
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    // Grid overlay
    if (showGrid && pixelSize >= 4) {
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= canvasSize; i++) {
        ctx.beginPath();
        ctx.moveTo(i * pixelSize + 0.5, 0);
        ctx.lineTo(i * pixelSize + 0.5, canvasDim);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * pixelSize + 0.5);
        ctx.lineTo(canvasDim, i * pixelSize + 0.5);
        ctx.stroke();
      }
    }

    // Mirror guides
    if (mirror !== "none" && !playing) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(79,143,247,0.5)";
      ctx.lineWidth = 2;
      if (mirror === "horizontal" || mirror === "both") {
        const mx = (canvasSize / 2) * pixelSize;
        ctx.beginPath();
        ctx.moveTo(mx, 0);
        ctx.lineTo(mx, canvasDim);
        ctx.stroke();
      }
      if (mirror === "vertical" || mirror === "both") {
        const my = (canvasSize / 2) * pixelSize;
        ctx.beginPath();
        ctx.moveTo(0, my);
        ctx.lineTo(canvasDim, my);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    ctx.restore();
  }, [
    frames, activeFrame, activeFrameIndex, canvasSize, pixelSize, canvasDim,
    panOffset, showGrid, primaryColor, mirror, playing, playFrameIndex, onionSkin,
  ]);

  /* ── Re-render when state changes ── */
  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  /* ── Animation playback ──────────── */
  useEffect(() => {
    if (!playing || frames.length <= 1) {
      setPlaying(false);
      return;
    }
    const interval = setInterval(() => {
      setPlayFrameIndex((prev) => (prev + 1) % frames.length);
    }, 1000 / fps);
    return () => clearInterval(interval);
  }, [playing, fps, frames.length]);

  useEffect(() => {
    if (playing) renderCanvas();
  }, [playFrameIndex, playing, renderCanvas]);

  /* ══════════════════════════════════
     Keyboard shortcuts
     ══════════════════════════════════ */

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing in inputs
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;

      if (e.ctrlKey || e.metaKey) {
        if (e.key === "z" && e.shiftKey) {
          e.preventDefault();
          redo();
          return;
        }
        if (e.key === "z") {
          e.preventDefault();
          undo();
          return;
        }
      }

      const key = e.key.toUpperCase();
      const toolMap: Record<string, Tool> = {
        B: "pencil", E: "eraser", G: "fill",
        L: "line", R: "rect", C: "circle", I: "picker",
      };
      if (toolMap[key]) {
        setActiveTool(toolMap[key]);
        return;
      }
      if (e.key === "[") {
        setZoom((z) => Math.max(1, z - 1));
      }
      if (e.key === "]") {
        setZoom((z) => Math.min(16, z + 1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  /* ══════════════════════════════════
     Export
     ══════════════════════════════════ */

  const compositeFrame = useCallback(
    (frame: Frame): (string | null)[][] => {
      const result = createEmptyGrid(canvasSize);
      for (const layer of frame.layers) {
        if (!layer.visible) continue;
        for (let y = 0; y < canvasSize; y++) {
          for (let x = 0; x < canvasSize; x++) {
            if (layer.pixels[y][x] !== null) {
              result[y][x] = layer.pixels[y][x];
            }
          }
        }
      }
      return result;
    },
    [canvasSize],
  );

  const exportPng = useCallback(
    (scale: number) => {
      const offscreen = document.createElement("canvas");
      const w = canvasSize * scale;
      const h = canvasSize * scale;
      offscreen.width = w;
      offscreen.height = h;
      const ctx = offscreen.getContext("2d")!;

      const composite = compositeFrame(activeFrame);
      for (let y = 0; y < canvasSize; y++) {
        for (let x = 0; x < canvasSize; x++) {
          const color = composite[y][x];
          if (color) {
            ctx.fillStyle = color;
            ctx.fillRect(x * scale, y * scale, scale, scale);
          }
        }
      }

      const link = document.createElement("a");
      link.download = `pixel-art-${canvasSize}x${canvasSize}-${scale}x.png`;
      link.href = offscreen.toDataURL("image/png");
      link.click();
    },
    [canvasSize, activeFrame, compositeFrame],
  );

  const copyToClipboard = useCallback(async () => {
    const offscreen = document.createElement("canvas");
    offscreen.width = canvasSize;
    offscreen.height = canvasSize;
    const ctx = offscreen.getContext("2d")!;

    const composite = compositeFrame(activeFrame);
    for (let y = 0; y < canvasSize; y++) {
      for (let x = 0; x < canvasSize; x++) {
        const color = composite[y][x];
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }

    try {
      const blob = await new Promise<Blob | null>((resolve) => offscreen.toBlob(resolve, "image/png"));
      if (blob) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      }
    } catch {
      // Clipboard API may not be available
    }
  }, [canvasSize, activeFrame, compositeFrame]);

  const exportGif = useCallback(() => {
    if (frames.length <= 1) return;

    // Build a palette from all used colors + transparent
    const colorSet = new Set<string>();
    for (const frame of frames) {
      const composite = compositeFrame(frame);
      for (let y = 0; y < canvasSize; y++) {
        for (let x = 0; x < canvasSize; x++) {
          const c = composite[y][x];
          if (c) colorSet.add(c);
        }
      }
    }

    // Palette: index 0 = transparent (black), rest = colors
    const palette: string[] = ["#000000"];
    const colorToIndex = new Map<string, number>();
    colorToIndex.set("", 0); // transparent
    for (const c of colorSet) {
      colorToIndex.set(c, palette.length);
      palette.push(c);
    }
    // Pad to 256
    while (palette.length < 256) palette.push("#000000");

    const scale = canvasSize <= 16 ? 8 : canvasSize <= 32 ? 4 : 2;
    const outW = canvasSize * scale;
    const outH = canvasSize * scale;

    const gifFrames: Uint8Array[] = [];
    for (const frame of frames) {
      const composite = compositeFrame(frame);
      const indices = new Uint8Array(outW * outH);
      for (let y = 0; y < canvasSize; y++) {
        for (let x = 0; x < canvasSize; x++) {
          const c = composite[y][x];
          const idx = c ? (colorToIndex.get(c) ?? 0) : 0;
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              indices[(y * scale + sy) * outW + (x * scale + sx)] = idx;
            }
          }
        }
      }
      gifFrames.push(indices);
    }

    const delayCs = Math.round(100 / fps);
    const gifData = encodeGif(gifFrames, outW, outH, palette, delayCs);

    const blob = new Blob([gifData.buffer as ArrayBuffer], { type: "image/gif" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = `pixel-art-animation.gif`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }, [frames, canvasSize, fps, compositeFrame]);

  /* ══════════════════════════════════
     Clear canvas
     ══════════════════════════════════ */

  const clearCanvas = useCallback(() => {
    pushHistory();
    updateActiveLayer(() => createEmptyGrid(canvasSize));
  }, [canvasSize, pushHistory, updateActiveLayer]);

  /* ══════════════════════════════════
     Render
     ══════════════════════════════════ */

  const canvasPixels = canvasDim + Math.abs(panOffset.x) * 2 + 200;
  const displayWidth = canvasDim;
  const displayHeight = canvasDim;

  return (
    <div class="space-y-4" style="user-select: none;">
      {/* ── Toolbar ──────────────────── */}
      <div
        class="flex flex-wrap items-center gap-2 rounded-lg p-3"
        style="background: var(--color-surface); border: 1px solid var(--color-border);"
      >
        {/* Canvas size */}
        <div class="flex items-center gap-1">
          <label class="text-xs" style="color: var(--color-text-muted);">Size:</label>
          <select
            value={canvasSize}
            onChange={(e) => handleResize(Number((e.target as HTMLSelectElement).value) as CanvasSize)}
            class="rounded px-2 py-1 text-xs"
            style="background: var(--color-bg); color: var(--color-text); border: 1px solid var(--color-border);"
          >
            {CANVAS_SIZES.map((s) => (
              <option key={s} value={s}>{s}x{s}</option>
            ))}
          </select>
        </div>

        <div style="width: 1px; height: 24px; background: var(--color-border);" />

        {/* Tools */}
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            onClick={() => setActiveTool(tool.id)}
            title={`${tool.label} (${tool.shortcut})`}
            class="rounded px-2 py-1 text-sm transition-colors"
            style={{
              background: activeTool === tool.id ? "var(--color-primary)" : "var(--color-bg)",
              color: activeTool === tool.id ? "#fff" : "var(--color-text)",
              border: `1px solid ${activeTool === tool.id ? "var(--color-primary)" : "var(--color-border)"}`,
            }}
          >
            <span class="mr-1">{TOOL_ICONS[tool.id]}</span>
            <span class="hidden sm:inline">{tool.label}</span>
          </button>
        ))}

        <div style="width: 1px; height: 24px; background: var(--color-border);" />

        {/* Undo / Redo */}
        <button
          onClick={undo}
          disabled={historyIndex < 0}
          title="Undo (Ctrl+Z)"
          class="rounded px-2 py-1 text-xs transition-opacity disabled:opacity-30"
          style="background: var(--color-bg); color: var(--color-text); border: 1px solid var(--color-border);"
        >
          ↩ Undo
        </button>
        <button
          onClick={redo}
          disabled={historyIndex + 2 >= history.length}
          title="Redo (Ctrl+Shift+Z)"
          class="rounded px-2 py-1 text-xs transition-opacity disabled:opacity-30"
          style="background: var(--color-bg); color: var(--color-text); border: 1px solid var(--color-border);"
        >
          ↪ Redo
        </button>

        <div style="width: 1px; height: 24px; background: var(--color-border);" />

        {/* Grid toggle */}
        <button
          onClick={() => setShowGrid(!showGrid)}
          class="rounded px-2 py-1 text-xs"
          style={{
            background: showGrid ? "var(--color-primary)" : "var(--color-bg)",
            color: showGrid ? "#fff" : "var(--color-text)",
            border: `1px solid ${showGrid ? "var(--color-primary)" : "var(--color-border)"}`,
          }}
        >
          Grid
        </button>

        {/* Mirror */}
        <select
          value={mirror}
          onChange={(e) => setMirror((e.target as HTMLSelectElement).value as MirrorMode)}
          class="rounded px-2 py-1 text-xs"
          style="background: var(--color-bg); color: var(--color-text); border: 1px solid var(--color-border);"
        >
          <option value="none">No Mirror</option>
          <option value="horizontal">Mirror H</option>
          <option value="vertical">Mirror V</option>
          <option value="both">Mirror Both</option>
        </select>

        {/* Zoom */}
        <div class="flex items-center gap-1">
          <label class="text-xs" style="color: var(--color-text-muted);">Zoom:</label>
          <span class="text-xs font-mono" style="color: var(--color-text);">{zoom}x</span>
          <button
            onClick={() => setZoom((z) => Math.max(1, z - 1))}
            class="rounded px-1 text-xs"
            style="background: var(--color-bg); color: var(--color-text); border: 1px solid var(--color-border);"
          >-</button>
          <button
            onClick={() => setZoom((z) => Math.min(16, z + 1))}
            class="rounded px-1 text-xs"
            style="background: var(--color-bg); color: var(--color-text); border: 1px solid var(--color-border);"
          >+</button>
          <button
            onClick={() => { setZoom(1); setPanOffset({ x: 0, y: 0 }); }}
            class="rounded px-1 text-xs"
            style="background: var(--color-bg); color: var(--color-text); border: 1px solid var(--color-border);"
            title="Reset zoom and pan"
          >Fit</button>
        </div>

        {/* Clear */}
        <button
          onClick={clearCanvas}
          class="rounded px-2 py-1 text-xs"
          style="background: var(--color-bg); color: #ef4444; border: 1px solid var(--color-border);"
          title="Clear active layer"
        >
          Clear
        </button>
      </div>

      {/* ── Main area: Canvas + Sidebar ── */}
      <div class="flex flex-col gap-4 lg:flex-row">
        {/* Canvas */}
        <div
          ref={containerRef}
          class="relative flex-1 overflow-hidden rounded-lg"
          style={`background: var(--color-bg); border: 1px solid var(--color-border); min-height: 300px;`}
        >
          <canvas
            ref={canvasRef}
            width={displayWidth + 200}
            height={displayHeight + 200}
            style={`cursor: ${activeTool === "picker" ? "crosshair" : activeTool === "eraser" ? "cell" : "crosshair"}; display: block; margin: auto;`}
            onMouseDown={handleCanvasMouseDown as any}
            onMouseMove={handleCanvasMouseMove as any}
            onMouseUp={handleCanvasMouseUp as any}
            onMouseLeave={() => {
              if (drawingRef.current && (activeTool === "pencil" || activeTool === "eraser")) {
                drawingRef.current = false;
                lastPixelRef.current = null;
              }
              isPanningRef.current = false;
            }}
            onWheel={handleWheel as any}
          />
        </div>

        {/* Sidebar */}
        <div class="flex w-full flex-col gap-3 lg:w-64">
          {/* Color picker */}
          <div
            class="rounded-lg p-3"
            style="background: var(--color-surface); border: 1px solid var(--color-border);"
          >
            <div class="mb-2 text-xs font-semibold" style="color: var(--color-heading);">Color</div>
            <div class="flex items-center gap-2 mb-2">
              <input
                type="color"
                value={primaryColor}
                onInput={(e) => {
                  const c = (e.target as HTMLInputElement).value;
                  setPrimaryColor(c);
                  addRecentColor(c);
                }}
                class="h-8 w-8 cursor-pointer rounded border-0"
                style="background: none;"
              />
              <input
                type="text"
                value={primaryColor}
                onInput={(e) => {
                  const v = (e.target as HTMLInputElement).value;
                  if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                    setPrimaryColor(v);
                    addRecentColor(v);
                  }
                }}
                class="flex-1 rounded px-2 py-1 text-xs font-mono"
                style="background: var(--color-bg); color: var(--color-text); border: 1px solid var(--color-border);"
              />
            </div>

            {/* PICO-8 palette */}
            <div class="mb-2 text-xs" style="color: var(--color-text-muted);">Palette</div>
            <div class="grid grid-cols-8 gap-1 mb-2">
              {PICO8_PALETTE.map((color) => (
                <button
                  key={color}
                  onClick={() => {
                    setPrimaryColor(color);
                    addRecentColor(color);
                  }}
                  class="h-5 w-5 rounded-sm transition-transform hover:scale-125"
                  style={{
                    background: color,
                    border: primaryColor === color ? "2px solid var(--color-heading)" : "1px solid var(--color-border)",
                  }}
                  title={color}
                />
              ))}
            </div>

            {/* Recent colors */}
            {recentColors.length > 0 && (
              <>
                <div class="mb-1 text-xs" style="color: var(--color-text-muted);">Recent</div>
                <div class="flex flex-wrap gap-1">
                  {recentColors.map((color, i) => (
                    <button
                      key={`${color}-${i}`}
                      onClick={() => setPrimaryColor(color)}
                      class="h-5 w-5 rounded-sm transition-transform hover:scale-125"
                      style={{
                        background: color,
                        border: primaryColor === color ? "2px solid var(--color-heading)" : "1px solid var(--color-border)",
                      }}
                      title={color}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Layers panel */}
          <div
            class="rounded-lg p-3"
            style="background: var(--color-surface); border: 1px solid var(--color-border);"
          >
            <div class="mb-2 flex items-center justify-between">
              <span class="text-xs font-semibold" style="color: var(--color-heading);">Layers</span>
              <button
                onClick={addLayer}
                disabled={activeFrame.layers.length >= MAX_LAYERS}
                class="rounded px-2 py-0.5 text-xs disabled:opacity-30"
                style="background: var(--color-bg); color: var(--color-text); border: 1px solid var(--color-border);"
              >
                + Add
              </button>
            </div>
            <div class="space-y-1">
              {[...activeFrame.layers].reverse().map((layer, revIdx) => {
                const idx = activeFrame.layers.length - 1 - revIdx;
                const isActive = idx === activeFrame.activeLayerIndex;
                return (
                  <div
                    key={idx}
                    class="flex items-center gap-1 rounded px-2 py-1 text-xs cursor-pointer"
                    style={{
                      background: isActive ? "rgba(79,143,247,0.15)" : "transparent",
                      border: isActive ? "1px solid var(--color-primary)" : "1px solid transparent",
                      color: "var(--color-text)",
                    }}
                    onClick={() => setActiveLayerIndex(idx)}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(idx); }}
                      class="text-xs"
                      style={{ opacity: layer.visible ? 1 : 0.3 }}
                      title={layer.visible ? "Hide" : "Show"}
                    >
                      {layer.visible ? "👁" : "👁"}
                    </button>
                    <span class="flex-1 truncate">{layer.name}</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={layer.opacity}
                      onInput={(e) => setLayerOpacity(idx, parseFloat((e.target as HTMLInputElement).value))}
                      class="w-12"
                      title={`Opacity: ${Math.round(layer.opacity * 100)}%`}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); moveLayer(idx, 1); }}
                      class="text-xs px-0.5"
                      style="color: var(--color-text-muted);"
                      title="Move up"
                    >▲</button>
                    <button
                      onClick={(e) => { e.stopPropagation(); moveLayer(idx, -1); }}
                      class="text-xs px-0.5"
                      style="color: var(--color-text-muted);"
                      title="Move down"
                    >▼</button>
                    {idx > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); mergeLayerDown(idx); }}
                        class="text-xs px-0.5"
                        style="color: var(--color-text-muted);"
                        title="Merge down"
                      >⤓</button>
                    )}
                    {activeFrame.layers.length > 1 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); removeLayer(idx); }}
                        class="text-xs px-0.5"
                        style="color: #ef4444;"
                        title="Delete layer"
                      >✕</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Presets */}
          <div
            class="rounded-lg p-3"
            style="background: var(--color-surface); border: 1px solid var(--color-border);"
          >
            <div class="mb-2 text-xs font-semibold" style="color: var(--color-heading);">Presets</div>
            <div class="flex flex-wrap gap-1">
              {presets.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => loadPreset(preset)}
                  class="rounded px-2 py-1 text-xs transition-colors hover:opacity-80"
                  style="background: var(--color-bg); color: var(--color-text); border: 1px solid var(--color-border);"
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* Export */}
          <div
            class="rounded-lg p-3"
            style="background: var(--color-surface); border: 1px solid var(--color-border);"
          >
            <div class="mb-2 text-xs font-semibold" style="color: var(--color-heading);">Export</div>
            <div class="flex flex-wrap gap-1">
              <button
                onClick={() => exportPng(1)}
                class="rounded px-2 py-1 text-xs"
                style="background: var(--color-bg); color: var(--color-text); border: 1px solid var(--color-border);"
              >
                PNG 1x
              </button>
              <button
                onClick={() => exportPng(canvasSize <= 16 ? 16 : canvasSize <= 32 ? 8 : 4)}
                class="rounded px-2 py-1 text-xs"
                style="background: var(--color-bg); color: var(--color-text); border: 1px solid var(--color-border);"
              >
                PNG Scaled
              </button>
              <button
                onClick={copyToClipboard}
                class="rounded px-2 py-1 text-xs"
                style="background: var(--color-bg); color: var(--color-text); border: 1px solid var(--color-border);"
              >
                Copy
              </button>
              {frames.length > 1 && (
                <button
                  onClick={exportGif}
                  class="rounded px-2 py-1 text-xs"
                  style="background: var(--color-primary); color: #fff; border: 1px solid var(--color-primary);"
                >
                  GIF
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Animation panel ──────────── */}
      <div
        class="rounded-lg p-3"
        style="background: var(--color-surface); border: 1px solid var(--color-border);"
      >
        <div class="mb-2 flex items-center justify-between">
          <button
            onClick={() => setShowAnimPanel(!showAnimPanel)}
            class="text-xs font-semibold"
            style="color: var(--color-heading); background: none; border: none; cursor: pointer;"
          >
            {showAnimPanel ? "▾" : "▸"} Animation ({frames.length} frame{frames.length !== 1 ? "s" : ""})
          </button>
          <div class="flex items-center gap-2">
            {showAnimPanel && (
              <>
                <button
                  onClick={addFrame}
                  class="rounded px-2 py-0.5 text-xs"
                  style="background: var(--color-bg); color: var(--color-text); border: 1px solid var(--color-border);"
                >
                  + Frame
                </button>
                <button
                  onClick={duplicateFrame}
                  class="rounded px-2 py-0.5 text-xs"
                  style="background: var(--color-bg); color: var(--color-text); border: 1px solid var(--color-border);"
                >
                  Duplicate
                </button>
              </>
            )}
          </div>
        </div>

        {showAnimPanel && (
          <div class="space-y-2">
            {/* Frame thumbnails */}
            <div class="flex flex-wrap gap-2">
              {frames.map((frame, idx) => {
                const isActive = idx === activeFrameIndex;
                return (
                  <div key={idx} class="text-center">
                    <button
                      onClick={() => { setActiveFrameIndex(idx); setPlaying(false); }}
                      class="rounded p-1 transition-colors"
                      style={{
                        background: isActive ? "rgba(79,143,247,0.2)" : "var(--color-bg)",
                        border: isActive ? "2px solid var(--color-primary)" : "1px solid var(--color-border)",
                      }}
                    >
                      <FrameThumbnail frame={frame} size={canvasSize} thumbSize={48} />
                    </button>
                    <div class="mt-1 flex items-center justify-center gap-1">
                      <span class="text-xs" style="color: var(--color-text-muted);">{idx + 1}</span>
                      {frames.length > 1 && (
                        <button
                          onClick={() => removeFrame(idx)}
                          class="text-xs"
                          style="color: #ef4444;"
                          title="Delete frame"
                        >✕</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Playback controls */}
            <div class="flex items-center gap-3">
              <button
                onClick={() => {
                  if (frames.length <= 1) return;
                  setPlaying(!playing);
                  setPlayFrameIndex(activeFrameIndex);
                }}
                disabled={frames.length <= 1}
                class="rounded px-3 py-1 text-xs font-semibold disabled:opacity-30"
                style={{
                  background: playing ? "#ef4444" : "var(--color-primary)",
                  color: "#fff",
                  border: "none",
                }}
              >
                {playing ? "Stop" : "Play"}
              </button>

              <label class="flex items-center gap-1 text-xs" style="color: var(--color-text-muted);">
                FPS:
                <input
                  type="range"
                  min="1"
                  max="24"
                  value={fps}
                  onInput={(e) => setFps(parseInt((e.target as HTMLInputElement).value, 10))}
                  class="w-16"
                />
                <span class="font-mono w-4 text-right" style="color: var(--color-text);">{fps}</span>
              </label>

              <label class="flex items-center gap-1 text-xs cursor-pointer" style="color: var(--color-text-muted);">
                <input
                  type="checkbox"
                  checked={onionSkin}
                  onChange={() => setOnionSkin(!onionSkin)}
                />
                Onion skin
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Keyboard shortcuts reference */}
      <div class="text-xs leading-relaxed" style="color: var(--color-text-muted);">
        <strong style="color: var(--color-heading);">Shortcuts:</strong>{" "}
        B=Pencil, E=Eraser, G=Fill, L=Line, R=Rect, C=Circle, I=Picker, [/]=Zoom, Ctrl+Z=Undo, Ctrl+Shift+Z=Redo, Alt+Drag=Pan, Scroll=Zoom
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   Frame Thumbnail sub-component
   ══════════════════════════════════════ */

function FrameThumbnail({
  frame,
  size,
  thumbSize,
}: {
  frame: Frame;
  size: number;
  thumbSize: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, thumbSize, thumbSize);

    // Checkerboard
    const cs = thumbSize / size;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? "#666" : "#888";
        ctx.fillRect(x * cs, y * cs, cs, cs);
      }
    }

    // Composite layers
    for (const layer of frame.layers) {
      if (!layer.visible) continue;
      ctx.globalAlpha = layer.opacity;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const color = layer.pixels[y][x];
          if (color) {
            ctx.fillStyle = color;
            ctx.fillRect(x * cs, y * cs, cs, cs);
          }
        }
      }
    }
    ctx.globalAlpha = 1;
  }, [frame, size, thumbSize]);

  return (
    <canvas
      ref={canvasRef}
      width={thumbSize}
      height={thumbSize}
      style={`width: ${thumbSize}px; height: ${thumbSize}px; image-rendering: pixelated;`}
    />
  );
}
