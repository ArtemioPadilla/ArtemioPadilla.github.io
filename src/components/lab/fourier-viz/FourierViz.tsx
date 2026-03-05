import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ══════════════════════════════════════════════════════════
   Constants
   ══════════════════════════════════════════════════════════ */

const SAMPLE_COUNT = 256;
const MAX_HARMONICS = 64;
const CANVAS_HEIGHT = 260;

const HARMONIC_COLORS = [
  "#4f8ff7", "#34d399", "#fbbf24", "#ef4444", "#a855f7",
  "#ec4899", "#06b6d4", "#f97316", "#84cc16", "#6366f1",
];

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

interface FourierComponent {
  re: number;
  im: number;
  freq: number;
  amp: number;
  phase: number;
}

type PresetId = "sine" | "square" | "sawtooth" | "triangle" | "pulse" | "step" | "custom";

interface PresetDef {
  id: PresetId;
  label: string;
  generate: (n: number) => number[];
}

/* ══════════════════════════════════════════════════════════
   DFT — Pure computation (no browser APIs)
   ══════════════════════════════════════════════════════════ */

function dft(signal: number[]): FourierComponent[] {
  const N = signal.length;
  const components: FourierComponent[] = [];

  for (let k = 0; k < N; k++) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < N; n++) {
      const angle = (2 * Math.PI * k * n) / N;
      re += signal[n] * Math.cos(angle);
      im -= signal[n] * Math.sin(angle);
    }
    re /= N;
    im /= N;
    const amp = Math.sqrt(re * re + im * im);
    const phase = Math.atan2(im, re);
    components.push({ re, im, freq: k, amp, phase });
  }

  return components;
}

function reconstructSignal(
  components: FourierComponent[],
  harmonicCount: number,
  sampleCount: number,
): number[] {
  const sorted = [...components].sort((a, b) => b.amp - a.amp);
  const selected = sorted.slice(0, harmonicCount);
  const N = components.length;
  const result: number[] = new Array(sampleCount);

  for (let n = 0; n < sampleCount; n++) {
    let value = 0;
    const t = (n / sampleCount) * N;
    for (const c of selected) {
      const angle = (2 * Math.PI * c.freq * t) / N;
      value += c.re * Math.cos(angle) - c.im * Math.sin(angle);
    }
    result[n] = value;
  }

  return result;
}

/* ══════════════════════════════════════════════════════════
   Preset Signal Generators
   ══════════════════════════════════════════════════════════ */

const PRESETS: PresetDef[] = [
  {
    id: "sine",
    label: "Sine",
    generate: (n) => Array.from({ length: n }, (_, i) =>
      Math.sin(2 * Math.PI * 3 * i / n)),
  },
  {
    id: "square",
    label: "Square",
    generate: (n) => Array.from({ length: n }, (_, i) =>
      Math.sin(2 * Math.PI * 3 * i / n) >= 0 ? 1 : -1),
  },
  {
    id: "sawtooth",
    label: "Sawtooth",
    generate: (n) => Array.from({ length: n }, (_, i) =>
      2 * ((3 * i / n) % 1) - 1),
  },
  {
    id: "triangle",
    label: "Triangle",
    generate: (n) => Array.from({ length: n }, (_, i) =>
      2 * Math.abs(2 * ((3 * i / n) % 1) - 1) - 1),
  },
  {
    id: "pulse",
    label: "Pulse",
    generate: (n) => Array.from({ length: n }, (_, i) =>
      (i % Math.floor(n / 3)) < Math.floor(n / 12) ? 1 : -0.2),
  },
  {
    id: "step",
    label: "Step",
    generate: (n) => Array.from({ length: n }, (_, i) =>
      i < n / 2 ? -1 : 1),
  },
  {
    id: "custom",
    label: "Draw",
    generate: (n) => new Array(n).fill(0),
  },
];

/* ══════════════════════════════════════════════════════════
   Canvas Drawing Helpers
   ══════════════════════════════════════════════════════════ */

function getComputedCSSColor(varName: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  return value || fallback;
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  borderColor: string,
): void {
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 0.5;
  ctx.globalAlpha = 0.3;

  const stepX = width / 8;
  const stepY = height / 4;

  for (let i = 1; i < 8; i++) {
    const x = i * stepX;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let i = 1; i < 4; i++) {
    const y = i * stepY;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();

  ctx.globalAlpha = 1;
}

function drawSignalLine(
  ctx: CanvasRenderingContext2D,
  signal: number[],
  width: number,
  height: number,
  color: string,
  lineWidth: number,
  alpha: number = 1,
): void {
  if (signal.length < 2) return;

  const mid = height / 2;
  const amp = height * 0.4;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();

  for (let i = 0; i < signal.length; i++) {
    const x = (i / (signal.length - 1)) * width;
    const y = mid - signal[i] * amp;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.stroke();
  ctx.restore();
}

/* ══════════════════════════════════════════════════════════
   Component
   ══════════════════════════════════════════════════════════ */

export default function FourierViz() {
  const [signal, setSignal] = useState<number[]>(() => PRESETS[0].generate(SAMPLE_COUNT));
  const [activePreset, setActivePreset] = useState<PresetId>("sine");
  const [harmonicCount, setHarmonicCount] = useState(8);
  const [animSpeed, setAnimSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(true);
  const [showMagnitude, setShowMagnitude] = useState(true);
  const [showPhase, setShowPhase] = useState(false);

  const signalCanvasRef = useRef<HTMLCanvasElement>(null);
  const epicycleCanvasRef = useRef<HTMLCanvasElement>(null);
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null);
  const reconstructCanvasRef = useRef<HTMLCanvasElement>(null);

  const isDrawingRef = useRef(false);
  const lastDrawnIndexRef = useRef(-1);
  const animTimeRef = useRef(0);
  const lastTimestampRef = useRef(0);
  const fourierRef = useRef<FourierComponent[]>([]);

  // ── Compute DFT whenever signal changes ──

  useEffect(() => {
    fourierRef.current = dft(signal);
  }, [signal]);

  // ── Resolve theme colors ──

  const getColors = useCallback(() => ({
    primary: getComputedCSSColor("--color-primary", "#4f8ff7"),
    accent: getComputedCSSColor("--color-accent", "#34d399"),
    bg: getComputedCSSColor("--color-bg", "#09090b"),
    surface: getComputedCSSColor("--color-surface", "#111111"),
    text: getComputedCSSColor("--color-text", "#e4e4e7"),
    textMuted: getComputedCSSColor("--color-text-muted", "#a1a1aa"),
    border: getComputedCSSColor("--color-border", "#27272a"),
    heading: getComputedCSSColor("--color-heading", "#ffffff"),
  }), []);

  // ── Draw the signal canvas ──

  const drawSignalCanvas = useCallback(() => {
    const canvas = signalCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const colors = getColors();

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = colors.surface;
    ctx.fillRect(0, 0, w, h);

    drawGrid(ctx, w, h, colors.border);
    drawSignalLine(ctx, signal, w, h, colors.primary, 2.5);

    // Axis labels
    ctx.fillStyle = colors.textMuted;
    ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Signal", 8, 14);
    ctx.fillText("+1", 4, h * 0.1 + 4);
    ctx.fillText("-1", 4, h * 0.9 + 4);
    ctx.fillText("0", 4, h / 2 - 4);
  }, [signal, getColors]);

  // ── Draw spectrum canvas ──

  const drawSpectrumCanvas = useCallback(() => {
    const canvas = spectrumCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const colors = getColors();
    const fourier = fourierRef.current;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = colors.surface;
    ctx.fillRect(0, 0, w, h);

    if (fourier.length === 0) return;

    // Show only first half (Nyquist) -- the useful part
    const displayCount = Math.min(Math.floor(fourier.length / 2), 64);
    const maxAmp = Math.max(...fourier.slice(0, displayCount).map(c => c.amp), 0.001);

    const barWidth = Math.max(2, (w - 40) / displayCount - 1);
    const chartHeight = h - 40;
    const baseY = h - 20;

    // Labels
    ctx.fillStyle = colors.textMuted;
    ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "left";

    if (showMagnitude && showPhase) {
      ctx.fillText("Magnitude (bars) / Phase (dots)", 8, 14);
    } else if (showMagnitude) {
      ctx.fillText("Magnitude Spectrum", 8, 14);
    } else if (showPhase) {
      ctx.fillText("Phase Spectrum", 8, 14);
    } else {
      ctx.fillText("Spectrum (hidden)", 8, 14);
      return;
    }

    // Frequency axis
    ctx.fillStyle = colors.textMuted;
    ctx.textAlign = "center";
    ctx.font = "9px Inter, sans-serif";
    for (let i = 0; i < displayCount; i += Math.max(1, Math.floor(displayCount / 8))) {
      const x = 20 + i * (barWidth + 1) + barWidth / 2;
      ctx.fillText(`${i}`, x, h - 4);
    }
    ctx.textAlign = "left";
    ctx.fillText("freq", w - 30, h - 4);

    // Draw magnitude bars
    if (showMagnitude) {
      // Pre-compute which frequencies are included in the reconstruction
      const sorted = [...fourier].sort((a, b) => b.amp - a.amp);
      const includedFreqs = new Set(sorted.slice(0, harmonicCount).map(c => c.freq));

      for (let i = 0; i < displayCount; i++) {
        const amp = fourier[i].amp;
        const barH = (amp / maxAmp) * chartHeight * 0.85;
        const x = 20 + i * (barWidth + 1);
        const y = baseY - barH;

        const t = i / displayCount;
        const r = Math.round(79 + t * (52 - 79));
        const g = Math.round(143 + t * (211 - 143));
        const b = Math.round(247 + t * (153 - 247));

        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.8)`;
        ctx.fillRect(x, y, barWidth, barH);

        // Highlight bars included in reconstruction
        if (includedFreqs.has(i)) {
          ctx.strokeStyle = colors.accent;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x - 0.5, y - 0.5, barWidth + 1, barH + 1);
        }
      }
    }

    // Draw phase dots
    if (showPhase) {
      const phaseMid = baseY - chartHeight * 0.5;
      for (let i = 0; i < displayCount; i++) {
        const phase = fourier[i].phase;
        const x = 20 + i * (barWidth + 1) + barWidth / 2;
        const y = phaseMid - (phase / Math.PI) * chartHeight * 0.35;

        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 2 * Math.PI);
        ctx.fillStyle = `rgba(251, 191, 36, 0.8)`;
        ctx.fill();
      }
    }
  }, [getColors, showMagnitude, showPhase, harmonicCount, signal]);

  // ── Draw reconstruction canvas ──

  const drawReconstructionCanvas = useCallback(() => {
    const canvas = reconstructCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const colors = getColors();
    const fourier = fourierRef.current;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = colors.surface;
    ctx.fillRect(0, 0, w, h);

    drawGrid(ctx, w, h, colors.border);

    if (fourier.length === 0) return;

    // Original signal (faded)
    drawSignalLine(ctx, signal, w, h, colors.primary, 1.5, 0.25);

    // Reconstructed signal
    const reconstructed = reconstructSignal(fourier, harmonicCount, signal.length);
    drawSignalLine(ctx, reconstructed, w, h, colors.accent, 2.5);

    // Labels
    ctx.fillStyle = colors.textMuted;
    ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`Reconstruction (${harmonicCount} harmonics)`, 8, 14);

    // Legend
    ctx.fillStyle = colors.primary;
    ctx.globalAlpha = 0.3;
    ctx.fillRect(w - 120, 6, 12, 3);
    ctx.globalAlpha = 1;
    ctx.fillStyle = colors.textMuted;
    ctx.fillText("Original", w - 104, 12);

    ctx.fillStyle = colors.accent;
    ctx.fillRect(w - 120, 18, 12, 3);
    ctx.fillStyle = colors.textMuted;
    ctx.fillText("Reconstructed", w - 104, 24);
  }, [signal, harmonicCount, getColors]);

  // ── Draw epicycle animation ──

  const drawEpicycles = useCallback((time: number) => {
    const canvas = epicycleCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const colors = getColors();
    const fourier = fourierRef.current;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = colors.surface;
    ctx.fillRect(0, 0, w, h);

    if (fourier.length === 0) return;

    const sorted = [...fourier].sort((a, b) => b.amp - a.amp);
    const selected = sorted.slice(0, harmonicCount);

    const cx = w * 0.45;
    const cy = h * 0.5;
    // Scale epicycles to fit the canvas
    const totalRadius = selected.reduce((sum, c) => sum + c.amp, 0);
    const maxR = Math.min(w, h) * 0.38;
    const scale = totalRadius > 0 ? maxR / totalRadius : 1;

    let x = cx;
    let y = cy;
    const N = fourier.length;

    // Draw each epicycle
    for (let i = 0; i < selected.length; i++) {
      const c = selected[i];
      const prevX = x;
      const prevY = y;
      const radius = c.amp * scale;

      if (radius < 0.5) continue;

      const angle = (2 * Math.PI * c.freq * time) / N + c.phase;
      x += radius * Math.cos(angle);
      y += radius * Math.sin(angle);

      // Circle
      ctx.beginPath();
      ctx.arc(prevX, prevY, radius, 0, 2 * Math.PI);
      ctx.strokeStyle = HARMONIC_COLORS[i % HARMONIC_COLORS.length];
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Radius line
      ctx.beginPath();
      ctx.moveTo(prevX, prevY);
      ctx.lineTo(x, y);
      ctx.strokeStyle = HARMONIC_COLORS[i % HARMONIC_COLORS.length];
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Dot at tip
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
      ctx.fillStyle = HARMONIC_COLORS[i % HARMONIC_COLORS.length];
      ctx.fill();
    }

    // Draw trail from the tip
    const trailPoints = 200;
    ctx.beginPath();
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.8;

    for (let p = 0; p < trailPoints; p++) {
      const t = time - p * 0.15;
      let tx = cx;
      let ty = cy;
      for (const c of selected) {
        const radius = c.amp * scale;
        if (radius < 0.5) continue;
        const angle = (2 * Math.PI * c.freq * t) / N + c.phase;
        tx += radius * Math.cos(angle);
        ty += radius * Math.sin(angle);
      }
      if (p === 0) ctx.moveTo(tx, ty);
      else ctx.lineTo(tx, ty);
    }
    ctx.globalAlpha = 0.6;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Labels
    ctx.fillStyle = colors.textMuted;
    ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Epicycles", 8, 14);
    ctx.font = "9px Inter, sans-serif";
    ctx.fillText(`${selected.length} component${selected.length !== 1 ? "s" : ""}`, 8, 26);
  }, [harmonicCount, getColors, signal]);

  // ── Animation loop ──

  useEffect(() => {
    let frameId: number;

    function animate(timestamp: number) {
      if (lastTimestampRef.current === 0) {
        lastTimestampRef.current = timestamp;
      }

      if (isPlaying) {
        const dt = (timestamp - lastTimestampRef.current) / 1000;
        animTimeRef.current += dt * animSpeed * 20;
      }
      lastTimestampRef.current = timestamp;

      drawEpicycles(animTimeRef.current);
      frameId = requestAnimationFrame(animate);
    }

    frameId = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, animSpeed, drawEpicycles]);

  // ── Redraw static canvases when deps change ──

  useEffect(() => {
    drawSignalCanvas();
    drawSpectrumCanvas();
    drawReconstructionCanvas();
  }, [drawSignalCanvas, drawSpectrumCanvas, drawReconstructionCanvas]);

  // ── Redraw on theme change ──

  useEffect(() => {
    const observer = new MutationObserver(() => {
      drawSignalCanvas();
      drawSpectrumCanvas();
      drawReconstructionCanvas();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [drawSignalCanvas, drawSpectrumCanvas, drawReconstructionCanvas]);

  // ── Redraw on window resize ──

  useEffect(() => {
    function handleResize() {
      drawSignalCanvas();
      drawSpectrumCanvas();
      drawReconstructionCanvas();
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [drawSignalCanvas, drawSpectrumCanvas, drawReconstructionCanvas]);

  // ── Drawing interaction on signal canvas ──

  const getSignalIndexFromEvent = useCallback((
    e: MouseEvent | TouchEvent,
    canvas: HTMLCanvasElement,
  ): { index: number; value: number } | null => {
    const rect = canvas.getBoundingClientRect();
    let clientX: number;
    let clientY: number;

    if ("touches" in e) {
      if (e.touches.length === 0) return null;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const w = rect.width;
    const h = rect.height;

    const index = Math.round((x / w) * (SAMPLE_COUNT - 1));
    const value = -((y / h) * 2 - 1);

    return {
      index: Math.max(0, Math.min(SAMPLE_COUNT - 1, index)),
      value: Math.max(-1, Math.min(1, value)),
    };
  }, []);

  const handleDrawStart = useCallback((e: MouseEvent | TouchEvent) => {
    e.preventDefault();
    isDrawingRef.current = true;
    setActivePreset("custom");

    const canvas = signalCanvasRef.current;
    if (!canvas) return;

    const pos = getSignalIndexFromEvent(e, canvas);
    if (!pos) return;

    lastDrawnIndexRef.current = pos.index;
    setSignal(prev => {
      const next = [...prev];
      next[pos.index] = pos.value;
      return next;
    });
  }, [getSignalIndexFromEvent]);

  const handleDrawMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isDrawingRef.current) return;
    e.preventDefault();

    const canvas = signalCanvasRef.current;
    if (!canvas) return;

    const pos = getSignalIndexFromEvent(e, canvas);
    if (!pos) return;

    const lastIdx = lastDrawnIndexRef.current;
    lastDrawnIndexRef.current = pos.index;

    setSignal(prev => {
      const next = [...prev];
      // Interpolate between last drawn point and current for smooth lines
      if (lastIdx >= 0 && lastIdx !== pos.index) {
        const startIdx = Math.min(lastIdx, pos.index);
        const endIdx = Math.max(lastIdx, pos.index);
        const startVal = prev[lastIdx];
        const endVal = pos.value;

        for (let i = startIdx; i <= endIdx; i++) {
          const t = (i - lastIdx) / (pos.index - lastIdx);
          next[i] = startVal + t * (endVal - startVal);
        }
      } else {
        next[pos.index] = pos.value;
      }
      return next;
    });
  }, [getSignalIndexFromEvent]);

  const handleDrawEnd = useCallback(() => {
    isDrawingRef.current = false;
    lastDrawnIndexRef.current = -1;
  }, []);

  // ── Preset selection ──

  const selectPreset = useCallback((presetId: PresetId) => {
    setActivePreset(presetId);
    const preset = PRESETS.find(p => p.id === presetId);
    if (preset) {
      setSignal(preset.generate(SAMPLE_COUNT));
    }
  }, []);

  const clearDrawing = useCallback(() => {
    setActivePreset("custom");
    setSignal(new Array(SAMPLE_COUNT).fill(0));
  }, []);

  // ── Render ──

  return (
    <div
      class="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
      style={{ boxShadow: "0 0 0 1px var(--color-border)" }}
    >
      {/* ─── Toolbar ─── */}
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-[var(--color-text-muted)]">Fourier Transform</span>
          <span
            class="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
            style={{
              borderColor: "rgba(79, 143, 247, 0.3)",
              color: "var(--color-primary)",
            }}
          >
            beta
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          {PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => selectPreset(p.id)}
              class="rounded-lg border px-2 py-1 text-[11px] font-medium transition-all"
              style={{
                borderColor: activePreset === p.id ? "var(--color-primary)" : "var(--color-border)",
                backgroundColor: activePreset === p.id ? "rgba(79, 143, 247, 0.15)" : "transparent",
                color: activePreset === p.id ? "var(--color-primary)" : "var(--color-text-muted)",
              }}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={clearDrawing}
            class="rounded-lg border border-[var(--color-border)] px-2 py-1 text-[11px] font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
          >
            Clear
          </button>
        </div>
      </div>

      {/* ─── Signal Canvas + Epicycles ─── */}
      <div class="grid md:grid-cols-2">
        {/* Signal canvas */}
        <div
          class="relative border-b border-[var(--color-border)] md:border-r md:border-b-0"
          style={{ touchAction: "none" }}
        >
          <canvas
            ref={signalCanvasRef}
            style={{ width: "100%", height: `${CANVAS_HEIGHT}px`, cursor: "crosshair" }}
            onMouseDown={handleDrawStart as any}
            onMouseMove={handleDrawMove as any}
            onMouseUp={handleDrawEnd}
            onMouseLeave={handleDrawEnd}
            onTouchStart={handleDrawStart as any}
            onTouchMove={handleDrawMove as any}
            onTouchEnd={handleDrawEnd}
          />
        </div>

        {/* Epicycle canvas */}
        <div class="relative border-b border-[var(--color-border)]">
          <canvas
            ref={epicycleCanvasRef}
            style={{ width: "100%", height: `${CANVAS_HEIGHT}px` }}
          />
        </div>
      </div>

      {/* ─── Harmonics Slider ─── */}
      <div class="border-b border-[var(--color-border)] px-4 py-3">
        <div class="flex flex-wrap items-center gap-4">
          {/* Harmonics */}
          <div class="flex flex-1 items-center gap-3" style={{ minWidth: "200px" }}>
            <label class="shrink-0 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              Harmonics
            </label>
            <input
              type="range"
              min="1"
              max={MAX_HARMONICS}
              value={harmonicCount}
              onInput={(e) => setHarmonicCount(parseInt((e.target as HTMLInputElement).value, 10))}
              class="fourier-slider flex-1"
              style={{ accentColor: "var(--color-primary)" }}
            />
            <span
              class="shrink-0 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-0.5 text-xs font-mono tabular-nums text-[var(--color-heading)]"
              style={{ fontFamily: "var(--font-mono)", minWidth: "48px", textAlign: "center" }}
            >
              {harmonicCount}/{MAX_HARMONICS}
            </span>
          </div>

          {/* Speed */}
          <div class="flex items-center gap-3" style={{ minWidth: "160px" }}>
            <label class="shrink-0 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              Speed
            </label>
            <input
              type="range"
              min="0.1"
              max="5"
              step="0.1"
              value={animSpeed}
              onInput={(e) => setAnimSpeed(parseFloat((e.target as HTMLInputElement).value))}
              class="fourier-slider flex-1"
              style={{ accentColor: "var(--color-accent)" }}
            />
            <span
              class="shrink-0 text-xs font-mono tabular-nums text-[var(--color-text-muted)]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {animSpeed.toFixed(1)}x
            </span>
          </div>

          {/* Play/Pause */}
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            class="rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-all"
            style={{
              borderColor: isPlaying ? "var(--color-accent)" : "var(--color-border)",
              backgroundColor: isPlaying ? "rgba(52, 211, 153, 0.1)" : "transparent",
              color: isPlaying ? "var(--color-accent)" : "var(--color-text-muted)",
            }}
          >
            {isPlaying ? "Pause" : "Play"}
          </button>
        </div>
      </div>

      {/* ─── Spectrum Toggles ─── */}
      <div class="border-b border-[var(--color-border)] px-4 py-2.5">
        <div class="flex items-center gap-3">
          <span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Show
          </span>
          <button
            onClick={() => setShowMagnitude(!showMagnitude)}
            class="rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all"
            style={{
              borderColor: showMagnitude ? "var(--color-primary)" : "var(--color-border)",
              backgroundColor: showMagnitude ? "rgba(79, 143, 247, 0.15)" : "transparent",
              color: showMagnitude ? "var(--color-primary)" : "var(--color-text-muted)",
            }}
          >
            Magnitude
          </button>
          <button
            onClick={() => setShowPhase(!showPhase)}
            class="rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all"
            style={{
              borderColor: showPhase ? "rgba(251, 191, 36, 0.8)" : "var(--color-border)",
              backgroundColor: showPhase ? "rgba(251, 191, 36, 0.1)" : "transparent",
              color: showPhase ? "rgba(251, 191, 36, 0.9)" : "var(--color-text-muted)",
            }}
          >
            Phase
          </button>
        </div>
      </div>

      {/* ─── Spectrum + Reconstruction ─── */}
      <div class="grid md:grid-cols-2">
        {/* Spectrum */}
        <div class="border-b border-[var(--color-border)] md:border-r md:border-b-0">
          <canvas
            ref={spectrumCanvasRef}
            style={{ width: "100%", height: `${CANVAS_HEIGHT}px` }}
          />
        </div>

        {/* Reconstruction */}
        <div>
          <canvas
            ref={reconstructCanvasRef}
            style={{ width: "100%", height: `${CANVAS_HEIGHT}px` }}
          />
        </div>
      </div>

      {/* ─── Info Footer ─── */}
      <div class="border-t border-[var(--color-border)] px-4 py-3">
        <InfoSection />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Info Section (collapsible)
   ══════════════════════════════════════════════════════════ */

function InfoSection() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        class="flex w-full items-center justify-between text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-heading)]"
      >
        <span class="flex items-center gap-2">
          <InfoIcon />
          How it works
        </span>
        <span
          class="transition-transform"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          &#9656;
        </span>
      </button>
      {expanded && (
        <div class="mt-3 grid gap-4 border-t border-[var(--color-border)] pt-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <h4 class="mb-1 text-xs font-semibold text-[var(--color-heading)]">
              Discrete Fourier Transform
            </h4>
            <p class="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
              The DFT decomposes a signal into a sum of sinusoids at different
              frequencies. Each frequency component has a magnitude (how strong)
              and a phase (where it starts).
            </p>
          </div>
          <div>
            <h4 class="mb-1 text-xs font-semibold text-[var(--color-heading)]">
              Epicycles
            </h4>
            <p class="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
              Each rotating circle represents one frequency component. The radius
              equals its magnitude, the speed equals its frequency. The tip of the
              last circle traces the reconstructed signal.
            </p>
          </div>
          <div>
            <h4 class="mb-1 text-xs font-semibold text-[var(--color-heading)]">
              Reconstruction
            </h4>
            <p class="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
              By summing only the top N harmonics (sorted by magnitude), you get an
              approximation of the original signal. More harmonics means a better
              approximation.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Icons (inline SVG for zero deps)
   ══════════════════════════════════════════════════════════ */

function InfoIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
