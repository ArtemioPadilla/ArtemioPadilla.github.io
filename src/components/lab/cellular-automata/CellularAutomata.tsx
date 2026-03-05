import {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "preact/hooks";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

type SimMode = "2d" | "1d";
type ColorMode = "classic" | "age" | "heat" | "custom";
type DrawTool = "pen" | "line" | "rect" | "fill";

interface Preset2D {
  name: string;
  /** Cells as [row, col] offsets from center */
  cells: [number, number][];
}

interface Preset1D {
  name: string;
  rule: number;
  initialCondition: "single" | "random";
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const MIN_CELL_SIZE = 2;
const MAX_CELL_SIZE = 20;
const DEFAULT_CELL_SIZE = 6;
const DEFAULT_GRID_SIZE = 120;
const MIN_GRID_SIZE = 20;
const MAX_GRID_SIZE = 400;
const DEFAULT_SPEED = 10;
const MIN_SPEED = 1;
const MAX_SPEED = 60;

// ─────────────────────────────────────────────────────────
// 2D Presets (offsets from center)
// ─────────────────────────────────────────────────────────

const PRESETS_2D: Preset2D[] = [
  {
    name: "Glider",
    cells: [[0,1],[1,2],[2,0],[2,1],[2,2]],
  },
  {
    name: "Gosper Glider Gun",
    cells: [
      [0,24],
      [1,22],[1,24],
      [2,12],[2,13],[2,20],[2,21],[2,34],[2,35],
      [3,11],[3,15],[3,20],[3,21],[3,34],[3,35],
      [4,0],[4,1],[4,10],[4,16],[4,20],[4,21],
      [5,0],[5,1],[5,10],[5,14],[5,16],[5,17],[5,22],[5,24],
      [6,10],[6,16],[6,24],
      [7,11],[7,15],
      [8,12],[8,13],
    ],
  },
  {
    name: "Pulsar",
    cells: (() => {
      const c: [number, number][] = [];
      const offsets = [
        [-6,-4],[-6,-3],[-6,-2],[-6,2],[-6,3],[-6,4],
        [-4,-6],[-4,-1],[-4,1],[-4,6],
        [-3,-6],[-3,-1],[-3,1],[-3,6],
        [-2,-6],[-2,-1],[-2,1],[-2,6],
        [-1,-4],[-1,-3],[-1,-2],[-1,2],[-1,3],[-1,4],
        [1,-4],[1,-3],[1,-2],[1,2],[1,3],[1,4],
        [2,-6],[2,-1],[2,1],[2,6],
        [3,-6],[3,-1],[3,1],[3,6],
        [4,-6],[4,-1],[4,1],[4,6],
        [6,-4],[6,-3],[6,-2],[6,2],[6,3],[6,4],
      ];
      for (const [r, col] of offsets) c.push([r, col]);
      return c;
    })(),
  },
  {
    name: "Pentadecathlon",
    cells: [
      [-5,0],[-4,0],[-3,-1],[-3,1],[-2,0],[-1,0],
      [0,0],[1,0],[2,-1],[2,1],[3,0],[4,0],
    ],
  },
  {
    name: "R-pentomino",
    cells: [[-1,0],[-1,1],[0,-1],[0,0],[1,0]],
  },
  {
    name: "Acorn",
    cells: [[0,-3],[0,-2],[0,0],[0,1],[0,2],[1,0],[-1,-1]],
  },
  {
    name: "LWSS",
    cells: [
      [0,1],[0,4],[1,0],[2,0],[2,4],[3,0],[3,1],[3,2],[3,3],
    ],
  },
];

// ─────────────────────────────────────────────────────────
// 1D Presets
// ─────────────────────────────────────────────────────────

const PRESETS_1D: Preset1D[] = [
  { name: "Rule 30", rule: 30, initialCondition: "single" },
  { name: "Rule 90", rule: 90, initialCondition: "single" },
  { name: "Rule 110", rule: 110, initialCondition: "single" },
  { name: "Rule 184", rule: 184, initialCondition: "single" },
  { name: "Rule 30 (Random)", rule: 30, initialCondition: "random" },
  { name: "Rule 90 (Random)", rule: 90, initialCondition: "random" },
];

// ─────────────────────────────────────────────────────────
// Pure simulation functions
// ─────────────────────────────────────────────────────────

function parseBirthSurvival(ruleStr: string): { birth: Set<number>; survival: Set<number> } {
  const birth = new Set<number>();
  const survival = new Set<number>();
  const match = ruleStr.match(/^B(\d*)\/S(\d*)$/i);
  if (match) {
    for (const ch of match[1]) birth.add(parseInt(ch, 10));
    for (const ch of match[2]) survival.add(parseInt(ch, 10));
  }
  return { birth, survival };
}

function countNeighbors2D(
  grid: Uint8Array,
  cols: number,
  rows: number,
  r: number,
  c: number,
  wrap: boolean,
): number {
  let count = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      let nr = r + dr;
      let nc = c + dc;
      if (wrap) {
        nr = (nr + rows) % rows;
        nc = (nc + cols) % cols;
      } else if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) {
        continue;
      }
      if (grid[nr * cols + nc]) count++;
    }
  }
  return count;
}

function step2D(
  grid: Uint8Array,
  cols: number,
  rows: number,
  birth: Set<number>,
  survival: Set<number>,
  wrap: boolean,
): Uint8Array {
  const next = new Uint8Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const neighbors = countNeighbors2D(grid, cols, rows, r, c, wrap);
      const alive = grid[r * cols + c] > 0;
      if (alive) {
        next[r * cols + c] = survival.has(neighbors) ? 1 : 0;
      } else {
        next[r * cols + c] = birth.has(neighbors) ? 1 : 0;
      }
    }
  }
  return next;
}

function computeWolframLookup(rule: number): Uint8Array {
  const lookup = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    lookup[i] = (rule >> i) & 1;
  }
  return lookup;
}

function step1D(
  row: Uint8Array,
  width: number,
  lookup: Uint8Array,
  wrap: boolean,
): Uint8Array {
  const next = new Uint8Array(width);
  for (let i = 0; i < width; i++) {
    const left = i > 0 ? row[i - 1] : (wrap ? row[width - 1] : 0);
    const center = row[i];
    const right = i < width - 1 ? row[i + 1] : (wrap ? row[0] : 0);
    const index = (left << 2) | (center << 1) | right;
    next[i] = lookup[index];
  }
  return next;
}

function bresenhamLine(r0: number, c0: number, r1: number, c1: number): [number, number][] {
  const cells: [number, number][] = [];
  let dr = Math.abs(r1 - r0);
  let dc = Math.abs(c1 - c0);
  const sr = r0 < r1 ? 1 : -1;
  const sc = c0 < c1 ? 1 : -1;
  let err = dr - dc;
  let r = r0;
  let c = c0;

  while (true) {
    cells.push([r, c]);
    if (r === r1 && c === c1) break;
    const e2 = 2 * err;
    if (e2 > -dc) { err -= dc; r += sr; }
    if (e2 < dr) { err += dr; c += sc; }
  }
  return cells;
}

function floodFill(
  grid: Uint8Array,
  cols: number,
  rows: number,
  startR: number,
  startC: number,
  targetValue: number,
): Uint8Array {
  const result = new Uint8Array(grid);
  const fillValue = targetValue === 0 ? 1 : 0;
  if (result[startR * cols + startC] !== targetValue) return result;

  const stack: [number, number][] = [[startR, startC]];
  while (stack.length > 0) {
    const [r, c] = stack.pop()!;
    if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
    if (result[r * cols + c] !== targetValue) continue;
    result[r * cols + c] = fillValue;
    stack.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
  }
  return result;
}

// ─────────────────────────────────────────────────────────
// Color helpers
// ─────────────────────────────────────────────────────────

function getCSSVar(name: string): string {
  if (typeof document === "undefined") return "#ffffff";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16) || 0,
    parseInt(h.substring(2, 4), 16) || 0,
    parseInt(h.substring(4, 6), 16) || 0,
  ];
}

function heatColor(age: number, maxAge: number): [number, number, number] {
  const t = Math.min(age / Math.max(maxAge, 1), 1);
  // Hot (red/yellow) for recent changes, cool (blue) for old
  if (t < 0.25) return [255, Math.floor(255 * (t / 0.25)), 0];
  if (t < 0.5) return [Math.floor(255 * (1 - (t - 0.25) / 0.25)), 255, 0];
  if (t < 0.75) return [0, 255, Math.floor(255 * ((t - 0.5) / 0.25))];
  return [0, Math.floor(255 * (1 - (t - 0.75) / 0.25)), 255];
}

function ageColor(age: number, maxAge: number): [number, number, number] {
  const t = Math.min(age / Math.max(maxAge, 1), 1);
  // Dim green to bright white
  const brightness = 80 + Math.floor(175 * t);
  return [brightness, Math.min(255, brightness + 40), brightness];
}

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

export default function CellularAutomata() {
  // ── Mode & Rules ──
  const [mode, setMode] = useState<SimMode>("2d");
  const [ruleStr, setRuleStr] = useState("B3/S23");
  const [wolframRule, setWolframRule] = useState(30);

  // ── Grid ──
  const [gridSize, setGridSize] = useState(DEFAULT_GRID_SIZE);
  const [cellSize, setCellSize] = useState(DEFAULT_CELL_SIZE);
  const [wrap, setWrap] = useState(true);

  // ── Simulation ──
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [generation, setGeneration] = useState(0);
  const [population, setPopulation] = useState(0);

  // ── Drawing ──
  const [drawTool, setDrawTool] = useState<DrawTool>("pen");
  const [colorMode, setColorMode] = useState<ColorMode>("classic");
  const [customFg, setCustomFg] = useState("#34d399");
  const [customBg, setCustomBg] = useState("#09090b");
  const [randomFillPct, setRandomFillPct] = useState(25);

  // ── Refs ──
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<Uint8Array>(new Uint8Array(gridSize * gridSize));
  const ageGridRef = useRef<Uint16Array>(new Uint16Array(gridSize * gridSize));
  const changeGridRef = useRef<Uint16Array>(new Uint16Array(gridSize * gridSize));
  const prevGridRef = useRef<Uint8Array>(new Uint8Array(gridSize * gridSize));

  // 1D-specific
  const historyRef = useRef<Uint8Array[]>([]);
  const currentRow1DRef = useRef<Uint8Array>(new Uint8Array(gridSize));

  // Interaction state
  const drawStartRef = useRef<[number, number] | null>(null);
  const isDrawingRef = useRef(false);
  const lastDrawCellRef = useRef<[number, number] | null>(null);
  const drawValueRef = useRef<number>(1);
  const panRef = useRef({ offsetX: 0, offsetY: 0 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });

  const animFrameRef = useRef<number>(0);
  const lastStepTimeRef = useRef<number>(0);
  const playingRef = useRef(playing);
  const speedRef = useRef(speed);
  const modeRef = useRef(mode);
  const wrapRef = useRef(wrap);
  const ruleStrRef = useRef(ruleStr);
  const wolframRuleRef = useRef(wolframRule);
  const cellSizeRef = useRef(cellSize);
  const gridSizeRef = useRef(gridSize);
  const colorModeRef = useRef(colorMode);
  const customFgRef = useRef(customFg);
  const customBgRef = useRef(customBg);
  const generationRef = useRef(0);

  // Sync refs
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { wrapRef.current = wrap; }, [wrap]);
  useEffect(() => { ruleStrRef.current = ruleStr; }, [ruleStr]);
  useEffect(() => { wolframRuleRef.current = wolframRule; }, [wolframRule]);
  useEffect(() => { cellSizeRef.current = cellSize; }, [cellSize]);
  useEffect(() => { gridSizeRef.current = gridSize; }, [gridSize]);
  useEffect(() => { colorModeRef.current = colorMode; }, [colorMode]);
  useEffect(() => { customFgRef.current = customFg; }, [customFg]);
  useEffect(() => { customBgRef.current = customBg; }, [customBg]);

  // ── Grid resizing ──
  const resetGrid = useCallback((newSize?: number) => {
    const size = newSize ?? gridSizeRef.current;
    gridRef.current = new Uint8Array(size * size);
    ageGridRef.current = new Uint16Array(size * size);
    changeGridRef.current = new Uint16Array(size * size);
    prevGridRef.current = new Uint8Array(size * size);
    historyRef.current = [];
    currentRow1DRef.current = new Uint8Array(size);
    generationRef.current = 0;
    setGeneration(0);
    setPopulation(0);
    setPlaying(false);
    panRef.current = { offsetX: 0, offsetY: 0 };
  }, []);

  useEffect(() => {
    resetGrid(gridSize);
  }, [gridSize, resetGrid]);

  // ── Canvas rendering (2D mode) ──
  const render2D = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cs = cellSizeRef.current;
    const gs = gridSizeRef.current;
    const grid = gridRef.current;
    const ages = ageGridRef.current;
    const changes = changeGridRef.current;
    const cm = colorModeRef.current;

    const w = canvas.width;
    const h = canvas.height;

    // Background
    const bgColor = cm === "custom"
      ? customBgRef.current
      : getCSSVar("--color-bg");
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    const ox = panRef.current.offsetX;
    const oy = panRef.current.offsetY;

    // Determine visible range
    const startCol = Math.max(0, Math.floor(-ox / cs));
    const startRow = Math.max(0, Math.floor(-oy / cs));
    const endCol = Math.min(gs, Math.ceil((w - ox) / cs));
    const endRow = Math.min(gs, Math.ceil((h - oy) / cs));

    // For ImageData performance, compute pixel buffer for visible area
    const visW = (endCol - startCol) * cs;
    const visH = (endRow - startRow) * cs;

    if (visW <= 0 || visH <= 0) return;

    const imageData = ctx.createImageData(visW, visH);
    const pixels = imageData.data;

    const bgRgb = hexToRgb(bgColor);
    // Fill with background
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = bgRgb[0];
      pixels[i + 1] = bgRgb[1];
      pixels[i + 2] = bgRgb[2];
      pixels[i + 3] = 255;
    }

    let maxAge = 1;
    let maxChange = 1;
    if (cm === "age" || cm === "heat") {
      for (let i = 0; i < gs * gs; i++) {
        if (ages[i] > maxAge) maxAge = ages[i];
        if (changes[i] > maxChange) maxChange = changes[i];
      }
    }

    // Default fg
    const defaultFg: [number, number, number] = cm === "custom"
      ? hexToRgb(customFgRef.current)
      : hexToRgb(getCSSVar("--color-accent") || "#34d399");

    for (let r = startRow; r < endRow; r++) {
      for (let c = startCol; c < endCol; c++) {
        const alive = grid[r * gs + c];
        if (!alive) continue;

        let rgb: [number, number, number];
        if (cm === "age") {
          rgb = ageColor(ages[r * gs + c], maxAge);
        } else if (cm === "heat") {
          rgb = heatColor(changes[r * gs + c], maxChange);
        } else {
          rgb = defaultFg;
        }

        const px = (c - startCol) * cs;
        const py = (r - startRow) * cs;
        const innerSize = cs > 3 ? cs - 1 : cs;

        for (let dy = 0; dy < innerSize; dy++) {
          for (let dx = 0; dx < innerSize; dx++) {
            const idx = ((py + dy) * visW + (px + dx)) * 4;
            if (idx >= 0 && idx < pixels.length - 3) {
              pixels[idx] = rgb[0];
              pixels[idx + 1] = rgb[1];
              pixels[idx + 2] = rgb[2];
              pixels[idx + 3] = 255;
            }
          }
        }
      }
    }

    const destX = ox + startCol * cs;
    const destY = oy + startRow * cs;
    ctx.putImageData(imageData, destX, destY);

    // Grid lines (only when cells are large enough)
    if (cs >= 6) {
      ctx.strokeStyle = getCSSVar("--color-border") || "#27272a";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let c = startCol; c <= endCol; c++) {
        const x = ox + c * cs;
        ctx.moveTo(x, oy + startRow * cs);
        ctx.lineTo(x, oy + endRow * cs);
      }
      for (let r = startRow; r <= endRow; r++) {
        const y = oy + r * cs;
        ctx.moveTo(ox + startCol * cs, y);
        ctx.lineTo(ox + endCol * cs, y);
      }
      ctx.stroke();
    }
  }, []);

  // ── Canvas rendering (1D mode) ──
  const render1D = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cs = cellSizeRef.current;
    const gs = gridSizeRef.current;
    const history = historyRef.current;
    const cm = colorModeRef.current;

    const w = canvas.width;
    const h = canvas.height;

    const bgColor = cm === "custom"
      ? customBgRef.current
      : getCSSVar("--color-bg");
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    const maxRows = Math.floor(h / cs);
    const startIdx = Math.max(0, history.length - maxRows);

    const fgColor: [number, number, number] = cm === "custom"
      ? hexToRgb(customFgRef.current)
      : hexToRgb(getCSSVar("--color-accent") || "#34d399");
    const bgRgb = hexToRgb(bgColor);

    const visibleRows = Math.min(history.length, maxRows);
    const visW = gs * cs;
    const visH = visibleRows * cs;

    if (visW <= 0 || visH <= 0) return;

    const clampedW = Math.min(visW, w);
    const clampedH = Math.min(visH, h);

    const imageData = ctx.createImageData(clampedW, clampedH);
    const pixels = imageData.data;

    // Fill background
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = bgRgb[0];
      pixels[i + 1] = bgRgb[1];
      pixels[i + 2] = bgRgb[2];
      pixels[i + 3] = 255;
    }

    for (let rowIdx = 0; rowIdx < visibleRows; rowIdx++) {
      const row = history[startIdx + rowIdx];
      for (let c = 0; c < gs && c * cs < clampedW; c++) {
        if (!row[c]) continue;

        let rgb: [number, number, number];
        if (cm === "age") {
          const t = Math.min((startIdx + rowIdx) / Math.max(history.length, 1), 1);
          const brightness = 80 + Math.floor(175 * t);
          rgb = [brightness, Math.min(255, brightness + 40), brightness];
        } else if (cm === "heat") {
          const density = row.reduce((s: number, v: number) => s + v, 0) / gs;
          const t = Math.min(density * 4, 1);
          rgb = heatColor(Math.floor(t * 100), 100);
        } else {
          rgb = fgColor;
        }

        const px = c * cs;
        const py = rowIdx * cs;
        for (let dy = 0; dy < cs && (py + dy) < clampedH; dy++) {
          for (let dx = 0; dx < cs && (px + dx) < clampedW; dx++) {
            const idx = ((py + dy) * clampedW + (px + dx)) * 4;
            if (idx >= 0 && idx < pixels.length - 3) {
              pixels[idx] = rgb[0];
              pixels[idx + 1] = rgb[1];
              pixels[idx + 2] = rgb[2];
              pixels[idx + 3] = 255;
            }
          }
        }
      }
    }

    const offsetX = Math.floor((w - clampedW) / 2);
    ctx.putImageData(imageData, offsetX, 0);
  }, []);

  // ── Simulation step ──
  const simulationStep = useCallback(() => {
    const gs = gridSizeRef.current;

    if (modeRef.current === "2d") {
      const { birth, survival } = parseBirthSurvival(ruleStrRef.current);
      const prev = gridRef.current;
      const next = step2D(prev, gs, gs, birth, survival, wrapRef.current);

      // Update age and change tracking
      const ages = ageGridRef.current;
      const changes = changeGridRef.current;
      for (let i = 0; i < gs * gs; i++) {
        if (next[i]) {
          ages[i] = prev[i] ? ages[i] + 1 : 1;
        } else {
          ages[i] = 0;
        }
        if (next[i] !== prev[i]) {
          changes[i] = 1;
        } else if (changes[i] > 0) {
          changes[i] = Math.min(changes[i] + 1, 1000);
        }
      }

      prevGridRef.current = prev;
      gridRef.current = next;

      let pop = 0;
      for (let i = 0; i < gs * gs; i++) if (next[i]) pop++;
      setPopulation(pop);
    } else {
      // 1D Wolfram
      const lookup = computeWolframLookup(wolframRuleRef.current);
      const current = currentRow1DRef.current;
      const next = step1D(current, gs, lookup, wrapRef.current);
      historyRef.current.push(next);
      currentRow1DRef.current = next;

      let pop = 0;
      for (let i = 0; i < gs; i++) if (next[i]) pop++;
      setPopulation(pop);
    }

    generationRef.current++;
    setGeneration(generationRef.current);
  }, []);

  // ── Animation loop ──
  useEffect(() => {
    const loop = (time: number) => {
      if (playingRef.current) {
        const interval = 1000 / speedRef.current;
        if (time - lastStepTimeRef.current >= interval) {
          lastStepTimeRef.current = time;
          simulationStep();
        }
      }

      if (modeRef.current === "2d") {
        render2D();
      } else {
        render1D();
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [simulationStep, render2D, render1D]);

  // ── Canvas sizing ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const resize = () => {
      const rect = parent.getBoundingClientRect();
      canvas.width = Math.floor(rect.width);
      canvas.height = Math.floor(rect.height);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  // ── Mouse interaction (2D) ──
  const getCellFromEvent = useCallback((e: MouseEvent): [number, number] | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - panRef.current.offsetX;
    const y = e.clientY - rect.top - panRef.current.offsetY;
    const cs = cellSizeRef.current;
    const c = Math.floor(x / cs);
    const r = Math.floor(y / cs);
    const gs = gridSizeRef.current;
    if (r < 0 || r >= gs || c < 0 || c >= gs) return null;
    return [r, c];
  }, []);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (modeRef.current !== "2d") return;

    // Middle button or shift+left = pan
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      e.preventDefault();
      isPanningRef.current = true;
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        offsetX: panRef.current.offsetX,
        offsetY: panRef.current.offsetY,
      };
      return;
    }

    if (e.button !== 0) return;

    const cell = getCellFromEvent(e);
    if (!cell) return;

    const [r, c] = cell;
    const gs = gridSizeRef.current;
    const grid = gridRef.current;
    const tool = drawTool;

    if (tool === "pen") {
      drawValueRef.current = grid[r * gs + c] ? 0 : 1;
      grid[r * gs + c] = drawValueRef.current;
      isDrawingRef.current = true;
      lastDrawCellRef.current = cell;
      let pop = 0;
      for (let i = 0; i < gs * gs; i++) if (grid[i]) pop++;
      setPopulation(pop);
    } else if (tool === "fill") {
      const targetVal = grid[r * gs + c];
      gridRef.current = floodFill(grid, gs, gs, r, c, targetVal);
      let pop = 0;
      for (let i = 0; i < gs * gs; i++) if (gridRef.current[i]) pop++;
      setPopulation(pop);
    } else if (tool === "line" || tool === "rect") {
      drawStartRef.current = cell;
      isDrawingRef.current = true;
    }
  }, [drawTool, getCellFromEvent]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isPanningRef.current) {
      panRef.current.offsetX = panStartRef.current.offsetX + (e.clientX - panStartRef.current.x);
      panRef.current.offsetY = panStartRef.current.offsetY + (e.clientY - panStartRef.current.y);
      return;
    }

    if (!isDrawingRef.current || modeRef.current !== "2d") return;
    const cell = getCellFromEvent(e);
    if (!cell) return;

    if (drawTool === "pen") {
      const [r, c] = cell;
      const gs = gridSizeRef.current;
      // Bresenham line from last cell to current for smooth drawing
      const last = lastDrawCellRef.current;
      if (last) {
        const cells = bresenhamLine(last[0], last[1], r, c);
        for (const [lr, lc] of cells) {
          if (lr >= 0 && lr < gs && lc >= 0 && lc < gs) {
            gridRef.current[lr * gs + lc] = drawValueRef.current;
          }
        }
      } else {
        gridRef.current[r * gs + c] = drawValueRef.current;
      }
      lastDrawCellRef.current = cell;
      let pop = 0;
      for (let i = 0; i < gs * gs; i++) if (gridRef.current[i]) pop++;
      setPopulation(pop);
    }
  }, [drawTool, getCellFromEvent]);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      return;
    }

    if (!isDrawingRef.current || modeRef.current !== "2d") return;

    const cell = getCellFromEvent(e);
    if (cell && drawStartRef.current && (drawTool === "line" || drawTool === "rect")) {
      const [sr, sc] = drawStartRef.current;
      const [er, ec] = cell;
      const gs = gridSizeRef.current;
      const grid = gridRef.current;

      if (drawTool === "line") {
        const cells = bresenhamLine(sr, sc, er, ec);
        for (const [r, c] of cells) {
          if (r >= 0 && r < gs && c >= 0 && c < gs) {
            grid[r * gs + c] = 1;
          }
        }
      } else if (drawTool === "rect") {
        const minR = Math.min(sr, er);
        const maxR = Math.max(sr, er);
        const minC = Math.min(sc, ec);
        const maxC = Math.max(sc, ec);
        for (let r = minR; r <= maxR; r++) {
          for (let c = minC; c <= maxC; c++) {
            if (r >= 0 && r < gs && c >= 0 && c < gs) {
              grid[r * gs + c] = 1;
            }
          }
        }
      }

      let pop = 0;
      for (let i = 0; i < gs * gs; i++) if (grid[i]) pop++;
      setPopulation(pop);
    }

    isDrawingRef.current = false;
    drawStartRef.current = null;
    lastDrawCellRef.current = null;
  }, [drawTool, getCellFromEvent]);

  // ── Zoom (scroll) ──
  const handleWheel = useCallback((e: WheelEvent) => {
    if (modeRef.current !== "2d") return;
    e.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const oldCs = cellSizeRef.current;
    const newCs = Math.max(MIN_CELL_SIZE, Math.min(MAX_CELL_SIZE, oldCs + (e.deltaY > 0 ? -1 : 1)));

    if (newCs !== oldCs) {
      // Keep the point under cursor stable
      const gridX = (mouseX - panRef.current.offsetX) / oldCs;
      const gridY = (mouseY - panRef.current.offsetY) / oldCs;
      panRef.current.offsetX = mouseX - gridX * newCs;
      panRef.current.offsetY = mouseY - gridY * newCs;

      setCellSize(newCs);
    }
  }, []);

  // ── Canvas event binding ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // ── Actions ──
  const handleClear = useCallback(() => {
    resetGrid();
  }, [resetGrid]);

  const handleRandomFill = useCallback(() => {
    const gs = gridSizeRef.current;
    if (modeRef.current === "2d") {
      const grid = new Uint8Array(gs * gs);
      for (let i = 0; i < gs * gs; i++) {
        grid[i] = Math.random() * 100 < randomFillPct ? 1 : 0;
      }
      gridRef.current = grid;
      ageGridRef.current = new Uint16Array(gs * gs);
      changeGridRef.current = new Uint16Array(gs * gs);
      generationRef.current = 0;
      setGeneration(0);
      let pop = 0;
      for (let i = 0; i < gs * gs; i++) if (grid[i]) pop++;
      setPopulation(pop);
    } else {
      const row = new Uint8Array(gs);
      for (let i = 0; i < gs; i++) {
        row[i] = Math.random() < 0.5 ? 1 : 0;
      }
      currentRow1DRef.current = row;
      historyRef.current = [row];
      generationRef.current = 0;
      setGeneration(0);
      let pop = 0;
      for (let i = 0; i < gs; i++) if (row[i]) pop++;
      setPopulation(pop);
    }
  }, [randomFillPct]);

  const handlePreset2D = useCallback((preset: Preset2D) => {
    const gs = gridSizeRef.current;
    const grid = new Uint8Array(gs * gs);
    const centerR = Math.floor(gs / 2);
    const centerC = Math.floor(gs / 2);
    for (const [dr, dc] of preset.cells) {
      const r = centerR + dr;
      const c = centerC + dc;
      if (r >= 0 && r < gs && c >= 0 && c < gs) {
        grid[r * gs + c] = 1;
      }
    }
    gridRef.current = grid;
    ageGridRef.current = new Uint16Array(gs * gs);
    changeGridRef.current = new Uint16Array(gs * gs);
    panRef.current = { offsetX: 0, offsetY: 0 };
    generationRef.current = 0;
    setGeneration(0);
    setPopulation(preset.cells.length);
    setPlaying(false);
  }, []);

  const handlePreset1D = useCallback((preset: Preset1D) => {
    const gs = gridSizeRef.current;
    setWolframRule(preset.rule);
    wolframRuleRef.current = preset.rule;
    const row = new Uint8Array(gs);
    if (preset.initialCondition === "single") {
      row[Math.floor(gs / 2)] = 1;
    } else {
      for (let i = 0; i < gs; i++) {
        row[i] = Math.random() < 0.5 ? 1 : 0;
      }
    }
    currentRow1DRef.current = row;
    historyRef.current = [row];
    generationRef.current = 0;
    setGeneration(0);
    let pop = 0;
    for (let i = 0; i < gs; i++) if (row[i]) pop++;
    setPopulation(pop);
    setPlaying(false);
  }, []);

  const handleStep = useCallback(() => {
    simulationStep();
  }, [simulationStep]);

  const handleModeSwitch = useCallback((newMode: SimMode) => {
    setMode(newMode);
    modeRef.current = newMode;
    resetGrid();
    if (newMode === "1d") {
      // Initialize with single cell
      const gs = gridSizeRef.current;
      const row = new Uint8Array(gs);
      row[Math.floor(gs / 2)] = 1;
      currentRow1DRef.current = row;
      historyRef.current = [row];
      setPopulation(1);
    }
  }, [resetGrid]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === " ") {
        e.preventDefault();
        setPlaying(p => !p);
      } else if (e.key === "." || e.key === "ArrowRight") {
        handleStep();
      } else if (e.key === "c") {
        handleClear();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleStep, handleClear]);

  // ── Render ──
  const formatNumber = (n: number): string => n.toLocaleString();

  const buttonClass = "px-3 py-1.5 text-xs font-medium rounded border transition-colors cursor-pointer";
  const activeBtn = `${buttonClass} border-[var(--color-accent)] text-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_15%,transparent)]`;
  const inactiveBtn = `${buttonClass} border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)]`;

  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      <div class="flex flex-col lg:flex-row">
        {/* ── Canvas Area ── */}
        <div
          class="relative flex-1 min-h-[400px] lg:min-h-[600px] bg-[var(--color-bg)]"
          style={{ cursor: isPanningRef.current ? "grabbing" : (drawTool === "pen" ? "crosshair" : "default") }}
        >
          <canvas
            ref={canvasRef}
            class="w-full h-full block"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          />
          {/* Generation overlay */}
          <div class="absolute top-3 left-3 px-2 py-1 rounded text-xs font-mono bg-[color-mix(in_srgb,var(--color-bg)_85%,transparent)] text-[var(--color-text-muted)]">
            Gen: {formatNumber(generation)} | Pop: {formatNumber(population)}
          </div>
        </div>

        {/* ── Controls Panel ── */}
        <div class="lg:w-72 xl:w-80 border-t lg:border-t-0 lg:border-l border-[var(--color-border)] p-4 flex flex-col gap-4 overflow-y-auto max-h-[600px]">
          {/* Mode toggle */}
          <div>
            <label class="block text-xs font-medium text-[var(--color-text-muted)] mb-2 uppercase tracking-wider">Mode</label>
            <div class="flex gap-2">
              <button
                class={mode === "2d" ? activeBtn : inactiveBtn}
                onClick={() => handleModeSwitch("2d")}
              >2D (Life)</button>
              <button
                class={mode === "1d" ? activeBtn : inactiveBtn}
                onClick={() => handleModeSwitch("1d")}
              >1D (Wolfram)</button>
            </div>
          </div>

          {/* Rule */}
          {mode === "2d" ? (
            <div>
              <label class="block text-xs font-medium text-[var(--color-text-muted)] mb-1 uppercase tracking-wider">Rule (B/S notation)</label>
              <input
                type="text"
                value={ruleStr}
                onInput={(e) => setRuleStr((e.target as HTMLInputElement).value)}
                class="w-full px-3 py-1.5 text-sm rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] font-mono focus:outline-none focus:border-[var(--color-accent)]"
                placeholder="B3/S23"
              />
              <div class="mt-1 flex flex-wrap gap-1">
                {[
                  ["B3/S23", "Life"],
                  ["B36/S23", "HighLife"],
                  ["B1357/S1357", "Replicator"],
                  ["B3678/S34678", "Day & Night"],
                ].map(([rule, name]) => (
                  <button
                    key={rule}
                    class="px-2 py-0.5 text-[10px] rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] cursor-pointer transition-colors"
                    onClick={() => setRuleStr(rule)}
                  >{name}</button>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <label class="block text-xs font-medium text-[var(--color-text-muted)] mb-1 uppercase tracking-wider">Rule (0-255)</label>
              <input
                type="number"
                min={0}
                max={255}
                value={wolframRule}
                onInput={(e) => {
                  const v = parseInt((e.target as HTMLInputElement).value, 10);
                  if (!isNaN(v) && v >= 0 && v <= 255) {
                    setWolframRule(v);
                    wolframRuleRef.current = v;
                  }
                }}
                class="w-full px-3 py-1.5 text-sm rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] font-mono focus:outline-none focus:border-[var(--color-accent)]"
              />
              {/* Rule visualization */}
              <div class="mt-2 flex gap-0.5 justify-center">
                {Array.from({ length: 8 }, (_, i) => 7 - i).map(i => (
                  <div key={i} class="text-center">
                    <div class="flex gap-px mb-0.5">
                      {[2, 1, 0].map(bit => (
                        <div
                          key={bit}
                          class="w-2.5 h-2.5 rounded-sm"
                          style={{
                            backgroundColor: (i >> bit) & 1
                              ? "var(--color-accent)"
                              : "var(--color-border)",
                          }}
                        />
                      ))}
                    </div>
                    <div
                      class="w-full h-2.5 rounded-sm mx-auto"
                      style={{
                        backgroundColor: (wolframRule >> i) & 1
                          ? "var(--color-accent)"
                          : "var(--color-border)",
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Presets */}
          <div>
            <label class="block text-xs font-medium text-[var(--color-text-muted)] mb-2 uppercase tracking-wider">Presets</label>
            <div class="flex flex-wrap gap-1">
              {mode === "2d" ? (
                PRESETS_2D.map(p => (
                  <button
                    key={p.name}
                    class="px-2 py-1 text-[11px] rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] cursor-pointer transition-colors"
                    onClick={() => handlePreset2D(p)}
                  >{p.name}</button>
                ))
              ) : (
                PRESETS_1D.map(p => (
                  <button
                    key={p.name}
                    class="px-2 py-1 text-[11px] rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] cursor-pointer transition-colors"
                    onClick={() => handlePreset1D(p)}
                  >{p.name}</button>
                ))
              )}
            </div>
          </div>

          {/* Play controls */}
          <div>
            <label class="block text-xs font-medium text-[var(--color-text-muted)] mb-2 uppercase tracking-wider">Controls</label>
            <div class="flex gap-2">
              <button
                class={playing ? activeBtn : inactiveBtn}
                onClick={() => setPlaying(p => !p)}
              >{playing ? "Pause" : "Play"}</button>
              <button
                class={inactiveBtn}
                onClick={handleStep}
              >Step</button>
            </div>
            <div class="mt-2 text-xs text-[var(--color-text-muted)]">
              Space = play/pause, . = step, C = clear
            </div>
          </div>

          {/* Speed */}
          <div>
            <label class="block text-xs font-medium text-[var(--color-text-muted)] mb-1 uppercase tracking-wider">
              Speed: {speed} fps
            </label>
            <input
              type="range"
              min={MIN_SPEED}
              max={MAX_SPEED}
              value={speed}
              onInput={(e) => setSpeed(parseInt((e.target as HTMLInputElement).value, 10))}
              class="w-full accent-[var(--color-accent)]"
            />
          </div>

          {/* Grid size */}
          <div>
            <label class="block text-xs font-medium text-[var(--color-text-muted)] mb-1 uppercase tracking-wider">
              Grid: {gridSize}x{gridSize}
            </label>
            <input
              type="range"
              min={MIN_GRID_SIZE}
              max={MAX_GRID_SIZE}
              step={10}
              value={gridSize}
              onInput={(e) => setGridSize(parseInt((e.target as HTMLInputElement).value, 10))}
              class="w-full accent-[var(--color-accent)]"
            />
          </div>

          {/* Cell size (2D only) */}
          {mode === "2d" && (
            <div>
              <label class="block text-xs font-medium text-[var(--color-text-muted)] mb-1 uppercase tracking-wider">
                Cell size: {cellSize}px
              </label>
              <input
                type="range"
                min={MIN_CELL_SIZE}
                max={MAX_CELL_SIZE}
                value={cellSize}
                onInput={(e) => setCellSize(parseInt((e.target as HTMLInputElement).value, 10))}
                class="w-full accent-[var(--color-accent)]"
              />
            </div>
          )}

          {/* Drawing tools (2D only) */}
          {mode === "2d" && (
            <div>
              <label class="block text-xs font-medium text-[var(--color-text-muted)] mb-2 uppercase tracking-wider">Draw Tool</label>
              <div class="flex gap-1">
                {(["pen", "line", "rect", "fill"] as DrawTool[]).map(tool => (
                  <button
                    key={tool}
                    class={drawTool === tool ? activeBtn : inactiveBtn}
                    onClick={() => setDrawTool(tool)}
                  >
                    {tool === "pen" ? "Pen" : tool === "line" ? "Line" : tool === "rect" ? "Rect" : "Fill"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Wrap edges */}
          <div class="flex items-center gap-2">
            <label class="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={wrap}
                onChange={() => setWrap(w => !w)}
                class="sr-only peer"
              />
              <div class="w-8 h-4 bg-[var(--color-border)] rounded-full peer peer-checked:bg-[var(--color-accent)] after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-[var(--color-bg)] after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:after:translate-x-4"></div>
            </label>
            <span class="text-xs text-[var(--color-text-muted)]">Wrap edges (toroidal)</span>
          </div>

          {/* Color mode */}
          <div>
            <label class="block text-xs font-medium text-[var(--color-text-muted)] mb-2 uppercase tracking-wider">Color Mode</label>
            <div class="flex flex-wrap gap-1">
              {(["classic", "age", "heat", "custom"] as ColorMode[]).map(cm => (
                <button
                  key={cm}
                  class={colorMode === cm ? activeBtn : inactiveBtn}
                  onClick={() => setColorMode(cm)}
                >{cm[0].toUpperCase() + cm.slice(1)}</button>
              ))}
            </div>
            {colorMode === "custom" && (
              <div class="mt-2 flex gap-3 items-center">
                <label class="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                  FG
                  <input
                    type="color"
                    value={customFg}
                    onInput={(e) => setCustomFg((e.target as HTMLInputElement).value)}
                    class="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                  />
                </label>
                <label class="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                  BG
                  <input
                    type="color"
                    value={customBg}
                    onInput={(e) => setCustomBg((e.target as HTMLInputElement).value)}
                    class="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                  />
                </label>
              </div>
            )}
          </div>

          {/* Actions */}
          <div>
            <label class="block text-xs font-medium text-[var(--color-text-muted)] mb-2 uppercase tracking-wider">Actions</label>
            <div class="flex gap-2">
              <button
                class={inactiveBtn}
                onClick={handleClear}
              >Clear</button>
              <button
                class={inactiveBtn}
                onClick={handleRandomFill}
              >Random</button>
            </div>
            <div class="mt-2">
              <label class="block text-[10px] text-[var(--color-text-muted)] mb-1">
                Fill density: {randomFillPct}%
              </label>
              <input
                type="range"
                min={5}
                max={80}
                value={randomFillPct}
                onInput={(e) => setRandomFillPct(parseInt((e.target as HTMLInputElement).value, 10))}
                class="w-full accent-[var(--color-accent)]"
              />
            </div>
          </div>

          {/* Stats */}
          <div class="border-t border-[var(--color-border)] pt-3">
            <div class="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span class="text-[var(--color-text-muted)]">Generation</span>
                <div class="font-mono text-[var(--color-heading)]">{formatNumber(generation)}</div>
              </div>
              <div>
                <span class="text-[var(--color-text-muted)]">Population</span>
                <div class="font-mono text-[var(--color-heading)]">{formatNumber(population)}</div>
              </div>
              <div>
                <span class="text-[var(--color-text-muted)]">Grid</span>
                <div class="font-mono text-[var(--color-heading)]">{gridSize}x{gridSize}</div>
              </div>
              <div>
                <span class="text-[var(--color-text-muted)]">Mode</span>
                <div class="font-mono text-[var(--color-heading)]">
                  {mode === "2d" ? ruleStr : `Rule ${wolframRule}`}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
