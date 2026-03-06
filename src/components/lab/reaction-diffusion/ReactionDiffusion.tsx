import { useState, useEffect, useRef, useCallback } from "preact/hooks";

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

type ColorMapId = "grayscale" | "fire" | "ocean" | "rainbow" | "custom";

interface Preset {
  name: string;
  f: number;
  k: number;
  description: string;
}

interface ColorStop {
  pos: number;
  r: number;
  g: number;
  b: number;
}

// ═══════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════

const DEFAULT_WIDTH = 256;
const DEFAULT_HEIGHT = 256;
const MIN_RESOLUTION = 200;
const MAX_RESOLUTION = 400;
const CANVAS_DISPLAY_SIZE = 512;
const DEFAULT_DA = 1.0;
const DEFAULT_DB = 0.5;
const DEFAULT_STEPS_PER_FRAME = 16;
const MIN_STEPS = 1;
const MAX_STEPS = 40;
const DT = 1.0;
const MIN_BRUSH = 1;
const MAX_BRUSH = 20;
const DEFAULT_BRUSH = 5;

// Laplacian 3x3 kernel weights (center, adjacent, diagonal)
const LAPLACIAN_CENTER = -1.0;
const LAPLACIAN_ADJACENT = 0.2;
const LAPLACIAN_DIAGONAL = 0.05;

// ═══════════════════════════════════════════════════════════
// Presets
// ═══════════════════════════════════════════════════════════

const PRESETS: Preset[] = [
  { name: "Mitosis", f: 0.028, k: 0.062, description: "Dividing spots" },
  { name: "Coral", f: 0.062, k: 0.063, description: "Coral-like growth" },
  { name: "Fingerprints", f: 0.037, k: 0.06, description: "Labyrinthine stripes" },
  { name: "Holes", f: 0.039, k: 0.058, description: "Spots on background" },
  { name: "Spirals", f: 0.014, k: 0.054, description: "Rotating spirals" },
  { name: "Worms", f: 0.078, k: 0.061, description: "Worm-like patterns" },
  { name: "Chaos", f: 0.026, k: 0.051, description: "Unstable, evolving" },
];

// ═══════════════════════════════════════════════════════════
// Color Maps
// ═══════════════════════════════════════════════════════════

const COLOR_MAP_OPTIONS: { id: ColorMapId; label: string }[] = [
  { id: "grayscale", label: "Grayscale" },
  { id: "fire", label: "Fire" },
  { id: "ocean", label: "Ocean" },
  { id: "rainbow", label: "Rainbow" },
  { id: "custom", label: "Custom Gradient" },
];

function buildGradientLUT(stops: ColorStop[]): Uint8Array {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let s0 = stops[0];
    let s1 = stops[stops.length - 1];
    for (let j = 0; j < stops.length - 1; j++) {
      if (t >= stops[j].pos && t <= stops[j + 1].pos) {
        s0 = stops[j];
        s1 = stops[j + 1];
        break;
      }
    }
    const range = s1.pos - s0.pos;
    const f = range > 0 ? (t - s0.pos) / range : 0;
    lut[i * 3] = Math.round(s0.r + f * (s1.r - s0.r));
    lut[i * 3 + 1] = Math.round(s0.g + f * (s1.g - s0.g));
    lut[i * 3 + 2] = Math.round(s0.b + f * (s1.b - s0.b));
  }
  return lut;
}

function getColorMapStops(id: ColorMapId): ColorStop[] {
  switch (id) {
    case "grayscale":
      return [
        { pos: 0, r: 0, g: 0, b: 0 },
        { pos: 1, r: 255, g: 255, b: 255 },
      ];
    case "fire":
      return [
        { pos: 0, r: 0, g: 0, b: 0 },
        { pos: 0.25, r: 128, g: 0, b: 0 },
        { pos: 0.5, r: 255, g: 80, b: 0 },
        { pos: 0.75, r: 255, g: 200, b: 50 },
        { pos: 1, r: 255, g: 255, b: 200 },
      ];
    case "ocean":
      return [
        { pos: 0, r: 0, g: 5, b: 20 },
        { pos: 0.3, r: 0, g: 40, b: 120 },
        { pos: 0.6, r: 20, g: 120, b: 200 },
        { pos: 0.8, r: 80, g: 200, b: 220 },
        { pos: 1, r: 200, g: 255, b: 255 },
      ];
    case "rainbow":
      return [
        { pos: 0, r: 0, g: 0, b: 128 },
        { pos: 0.17, r: 0, g: 0, b: 255 },
        { pos: 0.33, r: 0, g: 200, b: 200 },
        { pos: 0.5, r: 0, g: 200, b: 0 },
        { pos: 0.67, r: 200, g: 200, b: 0 },
        { pos: 0.83, r: 255, g: 100, b: 0 },
        { pos: 1, r: 255, g: 0, b: 0 },
      ];
    case "custom":
      return [
        { pos: 0, r: 10, g: 10, b: 30 },
        { pos: 0.3, r: 79, g: 143, b: 247 },
        { pos: 0.6, r: 52, g: 211, b: 153 },
        { pos: 1, r: 255, g: 255, b: 255 },
      ];
  }
}

// ═══════════════════════════════════════════════════════════
// Simulation Core
// ═══════════════════════════════════════════════════════════

function createGrids(w: number, h: number): { a: Float32Array; b: Float32Array } {
  const size = w * h;
  const a = new Float32Array(size);
  const b = new Float32Array(size);
  a.fill(1.0);
  return { a, b };
}

function seedCenter(a: Float32Array, b: Float32Array, w: number, h: number): void {
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const radius = Math.floor(Math.min(w, h) / 10);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < w && y >= 0 && y < h) {
          const idx = y * w + x;
          a[idx] = 0.0;
          b[idx] = 1.0;
        }
      }
    }
  }
}

function seedRandom(a: Float32Array, b: Float32Array, w: number, h: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const cx = Math.floor(Math.random() * w);
    const cy = Math.floor(Math.random() * h);
    const radius = 3 + Math.floor(Math.random() * 5);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) {
          const x = (cx + dx + w) % w;
          const y = (cy + dy + h) % h;
          const idx = y * w + x;
          a[idx] = 0.0;
          b[idx] = 1.0;
        }
      }
    }
  }
}

function simulateStep(
  a: Float32Array,
  b: Float32Array,
  nextA: Float32Array,
  nextB: Float32Array,
  w: number,
  h: number,
  dA: number,
  dB: number,
  f: number,
  k: number,
): void {
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1) + h) % h;
    const yp = (y + 1) % h;
    for (let x = 0; x < w; x++) {
      const xm = ((x - 1) + w) % w;
      const xp = (x + 1) % w;
      const idx = y * w + x;

      const aVal = a[idx];
      const bVal = b[idx];

      // Laplacian via 3x3 kernel
      const lapA =
        LAPLACIAN_ADJACENT * (a[y * w + xm] + a[y * w + xp] + a[ym * w + x] + a[yp * w + x]) +
        LAPLACIAN_DIAGONAL * (a[ym * w + xm] + a[ym * w + xp] + a[yp * w + xm] + a[yp * w + xp]) +
        LAPLACIAN_CENTER * aVal;

      const lapB =
        LAPLACIAN_ADJACENT * (b[y * w + xm] + b[y * w + xp] + b[ym * w + x] + b[yp * w + x]) +
        LAPLACIAN_DIAGONAL * (b[ym * w + xm] + b[ym * w + xp] + b[yp * w + xm] + b[yp * w + xp]) +
        LAPLACIAN_CENTER * bVal;

      const aBB = aVal * bVal * bVal;

      nextA[idx] = aVal + (dA * lapA - aBB + f * (1.0 - aVal)) * DT;
      nextB[idx] = bVal + (dB * lapB + aBB - (k + f) * bVal) * DT;

      // Clamp
      if (nextA[idx] < 0) nextA[idx] = 0;
      if (nextA[idx] > 1) nextA[idx] = 1;
      if (nextB[idx] < 0) nextB[idx] = 0;
      if (nextB[idx] > 1) nextB[idx] = 1;
    }
  }
}

// ═══════════════════════════════════════════════════════════
// Parameter Space Component
// ═══════════════════════════════════════════════════════════

function ParameterSpace({
  f,
  k,
  onPick,
}: {
  f: number;
  k: number;
  onPick: (f: number, k: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const SIZE = 160;
  const F_MIN = 0.01;
  const F_MAX = 0.1;
  const K_MIN = 0.04;
  const K_MAX = 0.07;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bgColor = getComputedStyle(canvas).getPropertyValue("--color-surface").trim() || "#111";
    const borderColor = getComputedStyle(canvas).getPropertyValue("--color-border").trim() || "#333";
    const textColor = getComputedStyle(canvas).getPropertyValue("--color-text-muted").trim() || "#aaa";
    const primaryColor = getComputedStyle(canvas).getPropertyValue("--color-primary").trim() || "#4f8ff7";
    const accentColor = getComputedStyle(canvas).getPropertyValue("--color-accent").trim() || "#34d399";

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Draw region where patterns form (approximate)
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, SIZE, SIZE);

    // Axis labels
    ctx.font = "9px sans-serif";
    ctx.fillStyle = textColor;
    ctx.textAlign = "center";
    ctx.fillText("f \u2192", SIZE / 2, SIZE - 2);
    ctx.save();
    ctx.translate(8, SIZE / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("k \u2192", 0, 0);
    ctx.restore();

    // Plot presets
    for (const preset of PRESETS) {
      const px = ((preset.f - F_MIN) / (F_MAX - F_MIN)) * (SIZE - 20) + 10;
      const py = SIZE - (((preset.k - K_MIN) / (K_MAX - K_MIN)) * (SIZE - 20) + 10);
      ctx.fillStyle = primaryColor;
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = textColor;
      ctx.font = "8px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(preset.name, px + 6, py + 3);
    }

    // Current position
    const cx = ((f - F_MIN) / (F_MAX - F_MIN)) * (SIZE - 20) + 10;
    const cy = SIZE - (((k - K_MIN) / (K_MAX - K_MIN)) * (SIZE - 20) + 10);
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = accentColor;
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fill();
  }, [f, k]);

  useEffect(() => {
    draw();
  }, [draw]);

  const handleClick = useCallback(
    (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const scaleX = SIZE / rect.width;
      const scaleY = SIZE / rect.height;
      const px = mx * scaleX;
      const py = my * scaleY;
      const newF = F_MIN + ((px - 10) / (SIZE - 20)) * (F_MAX - F_MIN);
      const newK = K_MIN + ((SIZE - py - 10) / (SIZE - 20)) * (K_MAX - K_MIN);
      onPick(
        Math.max(F_MIN, Math.min(F_MAX, parseFloat(newF.toFixed(4)))),
        Math.max(K_MIN, Math.min(K_MAX, parseFloat(newK.toFixed(4)))),
      );
    },
    [onPick],
  );

  return (
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      class="w-full cursor-crosshair rounded border border-[var(--color-border)]"
      style={{ maxWidth: `${SIZE}px`, imageRendering: "auto" }}
      onClick={handleClick}
      title="Click to set f and k parameters"
    />
  );
}

// ═══════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════

export default function ReactionDiffusion() {
  // ----- State -----
  const [feedRate, setFeedRate] = useState(PRESETS[0].f);
  const [killRate, setKillRate] = useState(PRESETS[0].k);
  const [diffA, setDiffA] = useState(DEFAULT_DA);
  const [diffB, setDiffB] = useState(DEFAULT_DB);
  const [stepsPerFrame, setStepsPerFrame] = useState(DEFAULT_STEPS_PER_FRAME);
  const [colorMap, setColorMap] = useState<ColorMapId>("fire");
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH);
  const [paused, setPaused] = useState(false);
  const [resolution, setResolution] = useState(DEFAULT_WIDTH);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState(0);
  const [frameCount, setFrameCount] = useState(0);

  // ----- Refs -----
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const gridARef = useRef<Float32Array | null>(null);
  const gridBRef = useRef<Float32Array | null>(null);
  const nextARef = useRef<Float32Array | null>(null);
  const nextBRef = useRef<Float32Array | null>(null);
  const animRef = useRef<number>(0);
  const pausedRef = useRef(paused);
  const paramsRef = useRef({ f: feedRate, k: killRate, dA: diffA, dB: diffB, steps: stepsPerFrame });
  const resRef = useRef(resolution);
  const colorMapRef = useRef(colorMap);
  const isDrawingRef = useRef(false);
  const isErasingRef = useRef(false);
  const brushRef = useRef(brushSize);
  const frameCountRef = useRef(0);

  // Keep refs in sync
  pausedRef.current = paused;
  paramsRef.current = { f: feedRate, k: killRate, dA: diffA, dB: diffB, steps: stepsPerFrame };
  resRef.current = resolution;
  colorMapRef.current = colorMap;
  brushRef.current = brushSize;

  // ----- Color LUT -----
  const lutRef = useRef<Uint8Array>(buildGradientLUT(getColorMapStops("fire")));

  useEffect(() => {
    lutRef.current = buildGradientLUT(getColorMapStops(colorMap));
  }, [colorMap]);

  // ----- Initialize grids -----
  const initGrids = useCallback((w: number, h: number, mode: "center" | "random" | "clear") => {
    const { a, b } = createGrids(w, h);
    if (mode === "center") {
      seedCenter(a, b, w, h);
    } else if (mode === "random") {
      seedRandom(a, b, w, h, 15);
    }
    gridARef.current = a;
    gridBRef.current = b;
    nextARef.current = new Float32Array(w * h);
    nextBRef.current = new Float32Array(w * h);
    frameCountRef.current = 0;
    setFrameCount(0);
  }, []);

  // ----- Render to canvas -----
  const renderToCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const b = gridBRef.current;
    if (!canvas || !b) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = resRef.current;
    const h = resRef.current;
    const imgData = ctx.createImageData(w, h);
    const pixels = imgData.data;
    const lut = lutRef.current;

    for (let i = 0; i < w * h; i++) {
      const val = Math.min(1, Math.max(0, b[i]));
      const ci = Math.round(val * 255);
      const p = i * 4;
      const li = ci * 3;
      pixels[p] = lut[li];
      pixels[p + 1] = lut[li + 1];
      pixels[p + 2] = lut[li + 2];
      pixels[p + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  }, []);

  // ----- Animation loop -----
  useEffect(() => {
    const w = resolution;
    initGrids(w, w, "center");

    const loop = () => {
      animRef.current = requestAnimationFrame(loop);

      if (!pausedRef.current) {
        const a = gridARef.current;
        const b = gridBRef.current;
        const nA = nextARef.current;
        const nB = nextBRef.current;
        if (!a || !b || !nA || !nB) return;

        const p = paramsRef.current;
        const res = resRef.current;

        for (let s = 0; s < p.steps; s++) {
          simulateStep(a, b, nA, nB, res, res, p.dA, p.dB, p.f, p.k);
          // Swap buffers
          const tmpA = gridARef.current!;
          const tmpB = gridBRef.current!;
          gridARef.current = nextARef.current;
          gridBRef.current = nextBRef.current;
          nextARef.current = tmpA;
          nextBRef.current = tmpB;
        }

        frameCountRef.current += p.steps;
        setFrameCount(frameCountRef.current);
      }

      renderToCanvas();
    };

    loop();

    return () => {
      cancelAnimationFrame(animRef.current);
    };
  }, [resolution, initGrids, renderToCanvas]);

  // ----- Painting (seed B) -----
  const paintAt = useCallback((e: MouseEvent | PointerEvent) => {
    const canvas = canvasRef.current;
    const a = gridARef.current;
    const b = gridBRef.current;
    if (!canvas || !a || !b) return;

    const rect = canvas.getBoundingClientRect();
    const w = resRef.current;
    const h = resRef.current;
    const scaleX = w / rect.width;
    const scaleY = h / rect.height;
    const mx = Math.floor((e.clientX - rect.left) * scaleX);
    const my = Math.floor((e.clientY - rect.top) * scaleY);
    const r = brushRef.current;
    const erasing = isErasingRef.current;

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = (mx + dx + w) % w;
        const y = (my + dy + h) % h;
        const idx = y * w + x;
        if (erasing) {
          a[idx] = 1.0;
          b[idx] = 0.0;
        } else {
          a[idx] = 0.0;
          b[idx] = 1.0;
        }
      }
    }
  }, []);

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      if (e.button === 2) {
        isErasingRef.current = true;
      } else {
        isErasingRef.current = false;
      }
      isDrawingRef.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      paintAt(e);
    },
    [paintAt],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!isDrawingRef.current) return;
      paintAt(e);
    },
    [paintAt],
  );

  const handlePointerUp = useCallback(() => {
    isDrawingRef.current = false;
    isErasingRef.current = false;
  }, []);

  const handleContextMenu = useCallback((e: Event) => {
    e.preventDefault();
  }, []);

  // ----- Preset selection -----
  const selectPreset = useCallback(
    (idx: number) => {
      const p = PRESETS[idx];
      setFeedRate(p.f);
      setKillRate(p.k);
      setSelectedPreset(idx);
    },
    [],
  );

  // ----- Actions -----
  const handleClear = useCallback(() => {
    initGrids(resolution, resolution, "clear");
  }, [resolution, initGrids]);

  const handleReset = useCallback(() => {
    initGrids(resolution, resolution, "center");
  }, [resolution, initGrids]);

  const handleRandomize = useCallback(() => {
    initGrids(resolution, resolution, "random");
  }, [resolution, initGrids]);

  const handleResolutionChange = useCallback(
    (newRes: number) => {
      setResolution(newRes);
    },
    [],
  );

  const handleParameterPick = useCallback((newF: number, newK: number) => {
    setFeedRate(newF);
    setKillRate(newK);
    setSelectedPreset(-1);
  }, []);

  // ----- Fullscreen -----
  const toggleFullscreen = useCallback(() => {
    const el = fullscreenRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // ----- Slider helper -----
  const Slider = ({
    label,
    value,
    min,
    max,
    step,
    onChange,
    displayValue,
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (v: number) => void;
    displayValue?: string;
  }) => (
    <div class="mb-3">
      <div class="mb-1 flex items-center justify-between text-xs">
        <span class="text-[var(--color-text-muted)]">{label}</span>
        <span class="font-mono text-[var(--color-heading)]">{displayValue ?? value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(e) => onChange(parseFloat((e.target as HTMLInputElement).value))}
        class="slider w-full"
      />
    </div>
  );

  // ═══════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════

  return (
    <div class="space-y-4">
      <div class="flex flex-col gap-4 lg:flex-row">
        {/* ----- Controls Panel ----- */}
        <div class="w-full space-y-4 lg:w-72 lg:flex-shrink-0">
          {/* Presets */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
              Presets
            </h3>
            <div class="flex flex-wrap gap-1.5">
              {PRESETS.map((p, i) => (
                <button
                  key={p.name}
                  onClick={() => selectPreset(i)}
                  class="rounded-md border px-2 py-1 text-xs transition-colors"
                  style={{
                    borderColor:
                      selectedPreset === i ? "var(--color-primary)" : "var(--color-border)",
                    color:
                      selectedPreset === i ? "var(--color-primary)" : "var(--color-text-muted)",
                    background:
                      selectedPreset === i
                        ? "rgba(79, 143, 247, 0.1)"
                        : "transparent",
                  }}
                  title={p.description}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Parameters */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
              Parameters
            </h3>
            <Slider
              label="Feed Rate (f)"
              value={feedRate}
              min={0.01}
              max={0.1}
              step={0.001}
              onChange={(v) => {
                setFeedRate(v);
                setSelectedPreset(-1);
              }}
              displayValue={feedRate.toFixed(3)}
            />
            <Slider
              label="Kill Rate (k)"
              value={killRate}
              min={0.04}
              max={0.07}
              step={0.001}
              onChange={(v) => {
                setKillRate(v);
                setSelectedPreset(-1);
              }}
              displayValue={killRate.toFixed(3)}
            />
            <Slider
              label="Diffusion A"
              value={diffA}
              min={0.1}
              max={1.5}
              step={0.05}
              onChange={setDiffA}
              displayValue={diffA.toFixed(2)}
            />
            <Slider
              label="Diffusion B"
              value={diffB}
              min={0.1}
              max={1.0}
              step={0.05}
              onChange={setDiffB}
              displayValue={diffB.toFixed(2)}
            />
            <Slider
              label="Steps / Frame"
              value={stepsPerFrame}
              min={MIN_STEPS}
              max={MAX_STEPS}
              step={1}
              onChange={(v) => setStepsPerFrame(Math.round(v))}
            />
          </div>

          {/* Display */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
              Display
            </h3>
            <div class="mb-3">
              <label class="mb-1 block text-xs text-[var(--color-text-muted)]">Color Map</label>
              <select
                value={colorMap}
                onChange={(e) => setColorMap((e.target as HTMLSelectElement).value as ColorMapId)}
                class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-text)]"
              >
                {COLOR_MAP_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <Slider
              label="Brush Size"
              value={brushSize}
              min={MIN_BRUSH}
              max={MAX_BRUSH}
              step={1}
              onChange={(v) => setBrushSize(Math.round(v))}
            />
            <Slider
              label="Resolution"
              value={resolution}
              min={MIN_RESOLUTION}
              max={MAX_RESOLUTION}
              step={50}
              onChange={(v) => handleResolutionChange(Math.round(v))}
              displayValue={`${resolution}x${resolution}`}
            />
          </div>

          {/* Actions */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
              Actions
            </h3>
            <div class="grid grid-cols-2 gap-2">
              <button
                onClick={() => setPaused((p) => !p)}
                class="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)]"
              >
                {paused ? "\u25B6 Play" : "\u23F8 Pause"}
              </button>
              <button
                onClick={handleReset}
                class="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)]"
              >
                Reset
              </button>
              <button
                onClick={handleRandomize}
                class="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)]"
              >
                Randomize
              </button>
              <button
                onClick={handleClear}
                class="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)]"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Parameter Space */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
              f-k Parameter Space
            </h3>
            <ParameterSpace f={feedRate} k={killRate} onPick={handleParameterPick} />
            <p class="mt-2 text-[10px] leading-relaxed text-[var(--color-text-muted)]">
              Click anywhere to pick f and k values. Dots show presets.
            </p>
          </div>
        </div>

        {/* ----- Canvas Panel ----- */}
        <div class="flex-1" ref={fullscreenRef}>
          <div
            class="relative overflow-hidden rounded-lg border border-[var(--color-border)]"
            style={{
              backgroundColor: isFullscreen ? "#000" : "var(--color-bg)",
            }}
          >
            <canvas
              ref={canvasRef}
              width={resolution}
              height={resolution}
              class="block w-full cursor-crosshair"
              style={{
                imageRendering: "pixelated",
                maxWidth: isFullscreen ? "100%" : `${CANVAS_DISPLAY_SIZE}px`,
                aspectRatio: "1 / 1",
                margin: isFullscreen ? "auto" : undefined,
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              onContextMenu={handleContextMenu}
            />

            {/* Overlay controls */}
            <div
              class="absolute right-2 top-2 flex items-center gap-2"
              style={{ zIndex: 10 }}
            >
              <span
                class="rounded px-2 py-0.5 text-[10px] font-mono"
                style={{
                  color: "var(--color-text-muted)",
                  backgroundColor:
                    "color-mix(in srgb, var(--color-bg) 80%, transparent)",
                }}
              >
                Step {frameCount}
              </span>
              <button
                class="rounded px-2 py-0.5 text-[10px]"
                style={{
                  color: "var(--color-text-muted)",
                  backgroundColor:
                    "color-mix(in srgb, var(--color-bg) 80%, transparent)",
                }}
                onClick={toggleFullscreen}
                title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              >
                {isFullscreen ? "Exit FS" : "Fullscreen"}
              </button>
            </div>

            {/* Paused indicator */}
            {paused && (
              <div
                class="absolute inset-0 flex items-center justify-center"
                style={{
                  backgroundColor: "rgba(0,0,0,0.3)",
                  pointerEvents: "none",
                }}
              >
                <span
                  class="rounded-lg px-4 py-2 text-sm font-semibold"
                  style={{
                    color: "var(--color-heading)",
                    backgroundColor:
                      "color-mix(in srgb, var(--color-bg) 80%, transparent)",
                  }}
                >
                  PAUSED
                </span>
              </div>
            )}
          </div>

          {/* Canvas info bar */}
          <div class="mt-2 flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
            <span>
              {resolution}x{resolution} | {stepsPerFrame} steps/frame | f={feedRate.toFixed(3)} k=
              {killRate.toFixed(3)}
            </span>
            <span>Click to seed B | Right-click to erase</span>
          </div>
        </div>
      </div>

      {/* ----- Style ----- */}
      <style>{`
        .slider {
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          border-radius: 2px;
          background: var(--color-border);
          outline: none;
        }
        .slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--color-primary);
          cursor: pointer;
          border: 2px solid var(--color-bg);
        }
        .slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--color-primary);
          cursor: pointer;
          border: 2px solid var(--color-bg);
        }
      `}</style>
    </div>
  );
}
