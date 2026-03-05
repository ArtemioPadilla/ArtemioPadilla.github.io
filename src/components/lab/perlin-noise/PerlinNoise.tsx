import { useState, useEffect, useRef, useCallback } from "preact/hooks";

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

type NoiseType = "perlin" | "simplex";
type ViewMode = "1d" | "2d" | "3d";
type ColorMapId = "grayscale" | "terrain" | "heat" | "custom";

interface NoiseParams {
  type: NoiseType;
  frequency: number;
  octaves: number;
  persistence: number;
  lacunarity: number;
  seed: number;
  tiling: boolean;
}

interface ColorStop {
  pos: number;
  color: [number, number, number];
}

interface Preset {
  name: string;
  params: Partial<NoiseParams>;
  colorMap: ColorMapId;
}

interface NoiseStats {
  min: number;
  max: number;
  histogram: number[];
}

// ═══════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════

const CANVAS_SIZE = 512;
const CANVAS_1D_HEIGHT = 260;
const HISTOGRAM_BINS = 64;
const ISO_TILE_W = 4;
const ISO_TILE_H = 2;
const ISO_HEIGHT_SCALE = 80;

// ═══════════════════════════════════════════════════════════
// Permutation Table + Gradient Vectors
// ═══════════════════════════════════════════════════════════

function buildPermTable(seed: number): Uint8Array {
  const perm = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;

  let s = seed | 0;
  for (let i = 255; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    const tmp = base[i];
    base[i] = base[j];
    base[j] = tmp;
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
  return perm;
}

// 2D gradient vectors for classic Perlin
const GRAD2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

function dot2(g: number[], x: number, y: number): number {
  return g[0] * x + g[1] * y;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

// ═══════════════════════════════════════════════════════════
// Classic Perlin 2D
// ═══════════════════════════════════════════════════════════

function perlin2d(x: number, y: number, perm: Uint8Array): number {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);

  const aa = perm[perm[xi] + yi];
  const ab = perm[perm[xi] + yi + 1];
  const ba = perm[perm[xi + 1] + yi];
  const bb = perm[perm[xi + 1] + yi + 1];

  const g00 = GRAD2[aa & 7];
  const g10 = GRAD2[ba & 7];
  const g01 = GRAD2[ab & 7];
  const g11 = GRAD2[bb & 7];

  const n00 = dot2(g00, xf, yf);
  const n10 = dot2(g10, xf - 1, yf);
  const n01 = dot2(g01, xf, yf - 1);
  const n11 = dot2(g11, xf - 1, yf - 1);

  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}

// ═══════════════════════════════════════════════════════════
// Simplex 2D (Improved)
// ═══════════════════════════════════════════════════════════

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

const SIMPLEX_GRAD3: [number, number][] = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [-1, 1], [1, -1], [-1, -1],
];

function simplex2d(x: number, y: number, perm: Uint8Array): number {
  const s = (x + y) * F2;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const t = (i + j) * G2;

  const x0 = x - (i - t);
  const y0 = y - (j - t);

  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;

  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;

  const ii = i & 255;
  const jj = j & 255;

  let n0 = 0, n1 = 0, n2 = 0;

  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 >= 0) {
    const gi0 = perm[ii + perm[jj]] % 12;
    t0 *= t0;
    n0 = t0 * t0 * (SIMPLEX_GRAD3[gi0][0] * x0 + SIMPLEX_GRAD3[gi0][1] * y0);
  }

  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 >= 0) {
    const gi1 = perm[ii + i1 + perm[jj + j1]] % 12;
    t1 *= t1;
    n1 = t1 * t1 * (SIMPLEX_GRAD3[gi1][0] * x1 + SIMPLEX_GRAD3[gi1][1] * y1);
  }

  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 >= 0) {
    const gi2 = perm[ii + 1 + perm[jj + 1]] % 12;
    t2 *= t2;
    n2 = t2 * t2 * (SIMPLEX_GRAD3[gi2][0] * x2 + SIMPLEX_GRAD3[gi2][1] * y2);
  }

  return 70 * (n0 + n1 + n2);
}

// ═══════════════════════════════════════════════════════════
// Fractal Brownian Motion (fBm)
// ═══════════════════════════════════════════════════════════

function fbm(
  x: number,
  y: number,
  params: NoiseParams,
  perm: Uint8Array,
): number {
  if (params.tiling) return fbmTiled(x, y, params, perm);

  const noiseFn = params.type === "simplex" ? simplex2d : perlin2d;
  let value = 0;
  let amplitude = 1;
  let frequency = params.frequency;
  let maxAmplitude = 0;

  for (let o = 0; o < params.octaves; o++) {
    const nx = x * frequency;
    const ny = y * frequency;
    value += noiseFn(nx, ny, perm) * amplitude;
    maxAmplitude += amplitude;
    amplitude *= params.persistence;
    frequency *= params.lacunarity;
  }

  return value / maxAmplitude;
}

// Seamless tiling via domain rotation (maps 2D coords onto a torus in 4D noise space)
function tiledNoise(
  x: number,
  y: number,
  period: number,
  perm: Uint8Array,
  noiseFn: (x: number, y: number, p: Uint8Array) => number,
): number {
  const angle1 = (x / period) * Math.PI * 2;
  const angle2 = (y / period) * Math.PI * 2;
  const r = period / (Math.PI * 2);
  return noiseFn(
    Math.cos(angle1) * r,
    Math.sin(angle1) * r + Math.cos(angle2) * r,
    perm,
  );
}

// Proper tiling fBm that sums octaves correctly
function fbmTiled(
  x: number,
  y: number,
  params: NoiseParams,
  perm: Uint8Array,
): number {
  const noiseFn = params.type === "simplex" ? simplex2d : perlin2d;
  let value = 0;
  let amplitude = 1;
  let maxAmplitude = 0;
  const basePeriod = Math.max(4, Math.round(1 / params.frequency));

  for (let o = 0; o < params.octaves; o++) {
    const period = basePeriod * Math.pow(params.lacunarity, o);
    const freq = params.frequency * Math.pow(params.lacunarity, o);
    const nx = x * freq;
    const ny = y * freq;
    value += tiledNoise(nx, ny, period, perm, noiseFn) * amplitude;
    maxAmplitude += amplitude;
    amplitude *= params.persistence;
  }
  return value / maxAmplitude;
}

// ═══════════════════════════════════════════════════════════
// Color Maps
// ═══════════════════════════════════════════════════════════

const TERRAIN_STOPS: ColorStop[] = [
  { pos: 0.0, color: [25, 25, 112] },    // deep water
  { pos: 0.35, color: [30, 100, 200] },   // shallow water
  { pos: 0.45, color: [238, 214, 175] },  // sand
  { pos: 0.5, color: [34, 139, 34] },     // grass
  { pos: 0.65, color: [20, 100, 20] },    // forest
  { pos: 0.75, color: [139, 90, 43] },    // mountain
  { pos: 0.9, color: [110, 110, 110] },   // rock
  { pos: 1.0, color: [255, 255, 255] },   // snow
];

const HEAT_STOPS: ColorStop[] = [
  { pos: 0.0, color: [0, 0, 0] },
  { pos: 0.25, color: [128, 0, 0] },
  { pos: 0.5, color: [255, 128, 0] },
  { pos: 0.75, color: [255, 255, 0] },
  { pos: 1.0, color: [255, 255, 255] },
];

const CUSTOM_STOPS: ColorStop[] = [
  { pos: 0.0, color: [79, 143, 247] },    // --color-primary
  { pos: 0.5, color: [52, 211, 153] },    // --color-accent
  { pos: 1.0, color: [168, 85, 247] },    // purple
];

function interpolateStops(t: number, stops: ColorStop[]): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    if (clamped >= stops[i].pos && clamped <= stops[i + 1].pos) {
      const ratio = (clamped - stops[i].pos) / (stops[i + 1].pos - stops[i].pos);
      return [
        Math.round(stops[i].color[0] + (stops[i + 1].color[0] - stops[i].color[0]) * ratio),
        Math.round(stops[i].color[1] + (stops[i + 1].color[1] - stops[i].color[1]) * ratio),
        Math.round(stops[i].color[2] + (stops[i + 1].color[2] - stops[i].color[2]) * ratio),
      ];
    }
  }
  return stops[stops.length - 1].color;
}

function mapColor(value: number, colorMap: ColorMapId): [number, number, number] {
  const t = (value + 1) * 0.5; // map [-1,1] to [0,1]
  switch (colorMap) {
    case "grayscale": {
      const v = Math.round(t * 255);
      return [v, v, v];
    }
    case "terrain":
      return interpolateStops(t, TERRAIN_STOPS);
    case "heat":
      return interpolateStops(t, HEAT_STOPS);
    case "custom":
      return interpolateStops(t, CUSTOM_STOPS);
  }
}

// ═══════════════════════════════════════════════════════════
// Presets
// ═══════════════════════════════════════════════════════════

const PRESETS: Preset[] = [
  { name: "Clouds", params: { type: "simplex", frequency: 0.005, octaves: 6, persistence: 0.5, lacunarity: 2.0 }, colorMap: "grayscale" },
  { name: "Terrain", params: { type: "perlin", frequency: 0.008, octaves: 6, persistence: 0.5, lacunarity: 2.0 }, colorMap: "terrain" },
  { name: "Marble", params: { type: "perlin", frequency: 0.015, octaves: 4, persistence: 0.6, lacunarity: 2.5 }, colorMap: "grayscale" },
  { name: "Wood", params: { type: "perlin", frequency: 0.02, octaves: 2, persistence: 0.4, lacunarity: 3.0 }, colorMap: "heat" },
  { name: "Organic", params: { type: "simplex", frequency: 0.01, octaves: 5, persistence: 0.55, lacunarity: 1.8 }, colorMap: "custom" },
  { name: "Turbulence", params: { type: "simplex", frequency: 0.012, octaves: 8, persistence: 0.65, lacunarity: 2.2 }, colorMap: "heat" },
];

// ═══════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════

const panelStyle: Record<string, string> = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  padding: "1rem",
};

const btnStyle: Record<string, string> = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.375rem",
  color: "var(--color-text)",
  padding: "0.375rem 0.75rem",
  fontSize: "0.75rem",
  cursor: "pointer",
  transition: "border-color 0.15s",
};

const btnActiveStyle: Record<string, string> = {
  ...btnStyle,
  borderColor: "var(--color-primary)",
  color: "var(--color-primary)",
};

const labelStyle: Record<string, string> = {
  fontSize: "0.7rem",
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  fontWeight: "600",
};

const sliderStyle: Record<string, string> = {
  width: "100%",
  accentColor: "var(--color-primary)",
};

// ═══════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════

export default function PerlinNoise() {
  // --- State ---
  const [viewMode, setViewMode] = useState<ViewMode>("2d");
  const [colorMap, setColorMap] = useState<ColorMapId>("grayscale");
  const [params, setParams] = useState<NoiseParams>({
    type: "perlin",
    frequency: 0.01,
    octaves: 4,
    persistence: 0.5,
    lacunarity: 2.0,
    seed: 42,
    tiling: false,
  });
  const [zOffset, setZOffset] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [stats, setStats] = useState<NoiseStats>({ min: 0, max: 0, histogram: [] });
  const [showOctaves, setShowOctaves] = useState(false);

  // --- Refs ---
  const canvas2dRef = useRef<HTMLCanvasElement>(null);
  const canvas1dRef = useRef<HTMLCanvasElement>(null);
  const canvas3dRef = useRef<HTMLCanvasElement>(null);
  const histRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const permRef = useRef<Uint8Array>(buildPermTable(42));
  const noiseBufferRef = useRef<Float32Array>(new Float32Array(CANVAS_SIZE * CANVAS_SIZE));

  // --- Rebuild perm table on seed change ---
  useEffect(() => {
    permRef.current = buildPermTable(params.seed);
  }, [params.seed]);

  // --- Generate 2D noise buffer ---
  const generateNoise = useCallback(() => {
    const size = CANVAS_SIZE;
    const buffer = noiseBufferRef.current;
    const perm = permRef.current;
    const p = { ...params };

    let min = Infinity;
    let max = -Infinity;
    const hist = new Array(HISTOGRAM_BINS).fill(0);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = p.tiling ? x : x + zOffset * 100;
        const val = fbm(nx, y, p, perm);
        buffer[y * size + x] = val;
        if (val < min) min = val;
        if (val > max) max = val;
      }
    }

    // Build histogram
    for (let i = 0; i < buffer.length; i++) {
      const t = (buffer[i] - min) / (max - min || 1);
      const bin = Math.min(HISTOGRAM_BINS - 1, Math.floor(t * HISTOGRAM_BINS));
      hist[bin]++;
    }

    setStats({ min, max, histogram: hist });
    return buffer;
  }, [params, zOffset]);

  // --- Render 2D view ---
  const render2d = useCallback(() => {
    const canvas = canvas2dRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const buffer = generateNoise();
    const imageData = ctx.createImageData(CANVAS_SIZE, CANVAS_SIZE);
    const data = imageData.data;

    for (let i = 0; i < buffer.length; i++) {
      const [r, g, b] = mapColor(buffer[i], colorMap);
      const idx = i * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);
  }, [generateNoise, colorMap]);

  // --- Render 1D view ---
  const render1d = useCallback(() => {
    const canvas = canvas1dRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const perm = permRef.current;
    const p = params;
    const noiseFn = p.type === "simplex" ? simplex2d : perlin2d;

    // Resolve CSS variables for Canvas compatibility
    const styles = getComputedStyle(canvas);
    const borderColor = styles.getPropertyValue("--color-border").trim() || "#27272a";
    const primaryColor = styles.getPropertyValue("--color-primary").trim() || "#4f8ff7";

    // Background grid
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    const octaveColors = [
      "#4f8ff7", "#34d399", "#fbbf24", "#ef4444",
      "#a855f7", "#ec4899", "#06b6d4", "#f97316",
    ];

    // Draw individual octaves
    if (showOctaves) {
      for (let o = 0; o < p.octaves; o++) {
        const amplitude = Math.pow(p.persistence, o);
        const frequency = p.frequency * Math.pow(p.lacunarity, o) * 50;
        ctx.strokeStyle = octaveColors[o % octaveColors.length];
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        for (let x = 0; x < w; x++) {
          const nx = (x + zOffset * 100) * frequency;
          const val = noiseFn(nx, 0, perm) * amplitude;
          const y = h / 2 - val * (h / 2.5);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Combined fBm line
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      let value = 0;
      let amp = 1;
      let freq = p.frequency * 50;
      let maxAmp = 0;
      for (let o = 0; o < p.octaves; o++) {
        const nx = (x + zOffset * 100) * freq;
        value += noiseFn(nx, 0, perm) * amp;
        maxAmp += amp;
        amp *= p.persistence;
        freq *= p.lacunarity;
      }
      value /= maxAmp;
      const y = h / 2 - value * (h / 2.5);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }, [params, zOffset, showOctaves]);

  // --- Render isometric 3D view ---
  const render3d = useCallback(() => {
    const canvas = canvas3dRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const buffer = generateNoise();
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const gridSize = 128;
    const step = Math.floor(CANVAS_SIZE / gridSize);
    const tileW = ISO_TILE_W;
    const tileH = ISO_TILE_H;
    const offsetX = w / 2;
    const offsetY = 60;

    // Draw back-to-front for painter's algorithm
    for (let gy = 0; gy < gridSize; gy++) {
      for (let gx = 0; gx < gridSize; gx++) {
        const val = buffer[gy * step * CANVAS_SIZE + gx * step];
        const heightVal = ((val + 1) * 0.5) * ISO_HEIGHT_SCALE;
        const [r, g, b] = mapColor(val, colorMap);

        // Isometric projection
        const isoX = (gx - gy) * tileW + offsetX;
        const isoY = (gx + gy) * tileH - heightVal + offsetY;

        // Top face
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.beginPath();
        ctx.moveTo(isoX, isoY);
        ctx.lineTo(isoX + tileW, isoY + tileH);
        ctx.lineTo(isoX, isoY + tileH * 2);
        ctx.lineTo(isoX - tileW, isoY + tileH);
        ctx.closePath();
        ctx.fill();

        // Right face (darker)
        const dr = Math.max(0, r - 50);
        const dg = Math.max(0, g - 50);
        const db = Math.max(0, b - 50);
        ctx.fillStyle = `rgb(${dr},${dg},${db})`;
        ctx.beginPath();
        ctx.moveTo(isoX, isoY + tileH * 2);
        ctx.lineTo(isoX + tileW, isoY + tileH);
        ctx.lineTo(isoX + tileW, isoY + tileH + tileH * 2);
        ctx.lineTo(isoX, isoY + tileH * 4);
        ctx.closePath();
        ctx.fill();

        // Left face (darkest)
        const lr = Math.max(0, r - 80);
        const lg = Math.max(0, g - 80);
        const lb = Math.max(0, b - 80);
        ctx.fillStyle = `rgb(${lr},${lg},${lb})`;
        ctx.beginPath();
        ctx.moveTo(isoX, isoY + tileH * 2);
        ctx.lineTo(isoX - tileW, isoY + tileH);
        ctx.lineTo(isoX - tileW, isoY + tileH + tileH * 2);
        ctx.lineTo(isoX, isoY + tileH * 4);
        ctx.closePath();
        ctx.fill();
      }
    }
  }, [generateNoise, colorMap]);

  // --- Render histogram ---
  const renderHistogram = useCallback(() => {
    const canvas = histRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const { histogram } = stats;
    if (histogram.length === 0) return;

    const maxCount = Math.max(...histogram);
    const barW = w / HISTOGRAM_BINS;

    const histPrimary = getComputedStyle(canvas).getPropertyValue("--color-primary").trim() || "#4f8ff7";

    for (let i = 0; i < HISTOGRAM_BINS; i++) {
      const barH = (histogram[i] / maxCount) * h;
      ctx.fillStyle = histPrimary;
      ctx.globalAlpha = 0.7;
      ctx.fillRect(i * barW, h - barH, barW - 1, barH);
    }
    ctx.globalAlpha = 1;
  }, [stats]);

  // --- Animation loop ---
  useEffect(() => {
    if (!animating) return;

    const tick = () => {
      setZOffset((z) => z + 0.02);
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(animRef.current);
  }, [animating]);

  // --- Re-render on param changes ---
  useEffect(() => {
    if (viewMode === "2d") render2d();
    else if (viewMode === "1d") render1d();
    else render3d();
  }, [viewMode, render2d, render1d, render3d]);

  useEffect(() => {
    renderHistogram();
  }, [renderHistogram]);

  // --- Export as PNG ---
  const exportPng = useCallback(() => {
    const canvas = viewMode === "1d"
      ? canvas1dRef.current
      : viewMode === "2d"
        ? canvas2dRef.current
        : canvas3dRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `perlin-noise-${params.type}-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, [viewMode, params.type]);

  // --- Randomize seed ---
  const randomizeSeed = useCallback(() => {
    setParams((p) => ({ ...p, seed: Math.floor(Math.random() * 99999) }));
  }, []);

  // --- Apply preset ---
  const applyPreset = useCallback((preset: Preset) => {
    setParams((p) => ({ ...p, ...preset.params }));
    setColorMap(preset.colorMap);
  }, []);

  // --- Update single param ---
  const updateParam = useCallback(<K extends keyof NoiseParams>(key: K, value: NoiseParams[K]) => {
    setParams((p) => ({ ...p, [key]: value }));
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* ───── View Mode Tabs ───── */}
      <div style={panelStyle}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <span style={labelStyle}>View</span>
          {(["1d", "2d", "3d"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              style={viewMode === mode ? btnActiveStyle : btnStyle}
              onClick={() => setViewMode(mode)}
            >
              {mode === "1d" ? "1D Waveform" : mode === "2d" ? "2D Heightmap" : "3D Isometric"}
            </button>
          ))}

          <span style={{ ...labelStyle, marginLeft: "1rem" }}>Color Map</span>
          {(["grayscale", "terrain", "heat", "custom"] as ColorMapId[]).map((cm) => (
            <button
              key={cm}
              style={colorMap === cm ? btnActiveStyle : btnStyle}
              onClick={() => setColorMap(cm)}
            >
              {cm.charAt(0).toUpperCase() + cm.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* ───── Presets ───── */}
      <div style={panelStyle}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <span style={labelStyle}>Presets</span>
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              style={btnStyle}
              onClick={() => applyPreset(preset)}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        {/* ───── Canvas Area ───── */}
        <div style={{ flex: "1 1 512px", minWidth: 0 }}>
          <div style={{ ...panelStyle, position: "relative" }}>
            {viewMode === "2d" && (
              <canvas
                ref={canvas2dRef}
                width={CANVAS_SIZE}
                height={CANVAS_SIZE}
                style={{ width: "100%", height: "auto", display: "block", borderRadius: "0.375rem" }}
              />
            )}
            {viewMode === "1d" && (
              <canvas
                ref={canvas1dRef}
                width={800}
                height={CANVAS_1D_HEIGHT}
                style={{ width: "100%", height: "auto", display: "block", borderRadius: "0.375rem", background: "var(--color-bg)" }}
              />
            )}
            {viewMode === "3d" && (
              <canvas
                ref={canvas3dRef}
                width={800}
                height={500}
                style={{ width: "100%", height: "auto", display: "block", borderRadius: "0.375rem", background: "var(--color-bg)" }}
              />
            )}
          </div>

          {/* ───── Animation + Export ───── */}
          <div style={{ ...panelStyle, marginTop: "0.5rem", display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
            <button
              style={animating ? btnActiveStyle : btnStyle}
              onClick={() => setAnimating(!animating)}
            >
              {animating ? "Stop Animation" : "Animate Z-axis"}
            </button>

            <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "0.5rem" }}>
              Z Offset
              <input
                type="range"
                min={-10}
                max={10}
                step={0.01}
                value={zOffset}
                onInput={(e) => setZOffset(parseFloat((e.target as HTMLInputElement).value))}
                style={{ ...sliderStyle, width: "120px" }}
              />
              <span style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", minWidth: "3rem" }}>
                {zOffset.toFixed(2)}
              </span>
            </label>

            <button style={btnStyle} onClick={exportPng}>
              Export PNG
            </button>

            {viewMode === "1d" && (
              <button
                style={showOctaves ? btnActiveStyle : btnStyle}
                onClick={() => setShowOctaves(!showOctaves)}
              >
                Show Octaves
              </button>
            )}
          </div>
        </div>

        {/* ───── Controls Panel ───── */}
        <div style={{ flex: "0 0 260px" }}>
          <div style={{ ...panelStyle, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <span style={{ ...labelStyle, fontSize: "0.75rem" }}>Parameters</span>

            {/* Noise Type */}
            <div>
              <label style={labelStyle}>Noise Type</label>
              <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.25rem" }}>
                {(["perlin", "simplex"] as NoiseType[]).map((t) => (
                  <button
                    key={t}
                    style={params.type === t ? btnActiveStyle : btnStyle}
                    onClick={() => updateParam("type", t)}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Frequency */}
            <div>
              <label style={labelStyle}>
                Frequency (Scale): {params.frequency.toFixed(4)}
              </label>
              <input
                type="range"
                min={0.001}
                max={0.05}
                step={0.0005}
                value={params.frequency}
                onInput={(e) => updateParam("frequency", parseFloat((e.target as HTMLInputElement).value))}
                style={sliderStyle}
              />
            </div>

            {/* Octaves */}
            <div>
              <label style={labelStyle}>Octaves: {params.octaves}</label>
              <input
                type="range"
                min={1}
                max={8}
                step={1}
                value={params.octaves}
                onInput={(e) => updateParam("octaves", parseInt((e.target as HTMLInputElement).value))}
                style={sliderStyle}
              />
            </div>

            {/* Persistence */}
            <div>
              <label style={labelStyle}>
                Persistence: {params.persistence.toFixed(2)}
              </label>
              <input
                type="range"
                min={0.1}
                max={1.0}
                step={0.05}
                value={params.persistence}
                onInput={(e) => updateParam("persistence", parseFloat((e.target as HTMLInputElement).value))}
                style={sliderStyle}
              />
            </div>

            {/* Lacunarity */}
            <div>
              <label style={labelStyle}>
                Lacunarity: {params.lacunarity.toFixed(2)}
              </label>
              <input
                type="range"
                min={1.0}
                max={4.0}
                step={0.1}
                value={params.lacunarity}
                onInput={(e) => updateParam("lacunarity", parseFloat((e.target as HTMLInputElement).value))}
                style={sliderStyle}
              />
            </div>

            {/* Seed */}
            <div>
              <label style={labelStyle}>Seed: {params.seed}</label>
              <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                <input
                  type="number"
                  value={params.seed}
                  onInput={(e) => updateParam("seed", parseInt((e.target as HTMLInputElement).value) || 0)}
                  style={{
                    ...btnStyle,
                    flex: "1",
                    fontFamily: "var(--font-mono)",
                    padding: "0.375rem 0.5rem",
                  }}
                />
                <button style={btnStyle} onClick={randomizeSeed}>
                  Randomize
                </button>
              </div>
            </div>

            {/* Tiling */}
            <div>
              <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={params.tiling}
                  onChange={(e) => updateParam("tiling", (e.target as HTMLInputElement).checked)}
                  style={{ accentColor: "var(--color-primary)" }}
                />
                Seamless Tiling
              </label>
            </div>
          </div>

          {/* ───── Stats ───── */}
          <div style={{ ...panelStyle, marginTop: "0.5rem" }}>
            <span style={{ ...labelStyle, fontSize: "0.75rem" }}>Statistics</span>
            <div style={{ marginTop: "0.5rem", fontSize: "0.7rem", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
              <div>Min: {stats.min.toFixed(4)}</div>
              <div>Max: {stats.max.toFixed(4)}</div>
              <div>Range: {(stats.max - stats.min).toFixed(4)}</div>
            </div>
            <canvas
              ref={histRef}
              width={220}
              height={60}
              style={{ width: "100%", height: "60px", marginTop: "0.5rem", borderRadius: "0.25rem", background: "var(--color-bg)" }}
            />
            <div style={{ fontSize: "0.6rem", color: "var(--color-text-muted)", marginTop: "0.25rem" }}>
              Distribution histogram
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
