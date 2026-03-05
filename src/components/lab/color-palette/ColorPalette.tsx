import { useState, useCallback, useRef, useEffect } from "preact/hooks";
import type { RGB } from "./color-math";
import {
  rgbToHex,
  hslToRgb,
  contrastRatio,
  wcagRating,
  simulateColorblind,
} from "./color-math";
import type { ColorblindType, WcagRating } from "./color-math";
import type { PaletteMode, PaletteConfig } from "./palette-generators";
import {
  generatePalette,
  expandPreset,
  PRESET_PALETTES,
  exportAsCssVariables,
  exportAsJsonArray,
  exportAsTailwindConfig,
  exportAsSvgGradient,
} from "./palette-generators";

// ─────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────

function ModeSelector({
  mode,
  onModeChange,
}: {
  mode: PaletteMode;
  onModeChange: (m: PaletteMode) => void;
}) {
  const modes: { value: PaletteMode; label: string }[] = [
    { value: "sequential", label: "Sequential" },
    { value: "diverging", label: "Diverging" },
    { value: "categorical", label: "Categorical" },
  ];

  return (
    <div class="flex flex-wrap gap-2">
      {modes.map((m) => (
        <button
          key={m.value}
          onClick={() => onModeChange(m.value)}
          class={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === m.value
              ? "bg-[var(--color-primary)] text-white"
              : "bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          }`}
          style={
            mode !== m.value
              ? { border: "1px solid var(--color-border)" }
              : undefined
          }
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

function SliderControl({
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
  step?: number;
  onChange: (v: number) => void;
  displayValue?: string;
}) {
  return (
    <div class="flex items-center gap-3">
      <label class="w-24 shrink-0 text-xs text-[var(--color-text-muted)]">
        {label}
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
        class="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--color-border)]"
        style="accent-color: var(--color-primary)"
      />
      <span class="w-10 text-right text-xs font-mono text-[var(--color-text)]">
        {displayValue ?? value}
      </span>
    </div>
  );
}

function ColorSwatch({
  color,
  index,
  onCopy,
  isDragging,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  color: RGB;
  index: number;
  onCopy: (hex: string) => void;
  isDragging: boolean;
  onDragStart: (i: number) => void;
  onDragOver: (e: DragEvent, i: number) => void;
  onDrop: (i: number) => void;
}) {
  const hex = rgbToHex(color);
  const lum = 0.2126 * (color.r / 255) + 0.7152 * (color.g / 255) + 0.0722 * (color.b / 255);
  const textColor = lum > 0.5 ? "#000000" : "#ffffff";

  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e: DragEvent) => onDragOver(e, index)}
      onDrop={() => onDrop(index)}
      onClick={() => onCopy(hex)}
      class={`group relative flex cursor-pointer flex-col items-center justify-end rounded-lg p-2 transition-all hover:scale-105 ${
        isDragging ? "opacity-40" : ""
      }`}
      style={{
        backgroundColor: hex,
        minWidth: "60px",
        height: "100px",
        flex: "1 1 0",
      }}
      title={`Click to copy ${hex}`}
    >
      <span
        class="text-[10px] font-mono font-bold opacity-90"
        style={{ color: textColor }}
      >
        {hex}
      </span>
      <span
        class="text-[9px] font-mono opacity-70"
        style={{ color: textColor }}
      >
        {color.r},{color.g},{color.b}
      </span>
      <span
        class="pointer-events-none absolute top-1 right-1 text-[9px] opacity-0 transition-opacity group-hover:opacity-80"
        style={{ color: textColor }}
      >
        copy
      </span>
    </div>
  );
}

function ContrastMatrix({ colors }: { colors: RGB[] }) {
  if (colors.length > 8) {
    // Show simplified view for large palettes
    return <ContrastSimplified colors={colors} />;
  }

  return (
    <div class="overflow-x-auto">
      <table class="w-full border-collapse text-[10px]">
        <thead>
          <tr>
            <th class="p-1" />
            {colors.map((c, i) => (
              <th key={i} class="p-1">
                <div
                  class="mx-auto h-4 w-4 rounded"
                  style={{ backgroundColor: rgbToHex(c) }}
                />
              </th>
            ))}
            <th class="p-1 text-[var(--color-text-muted)]">W</th>
            <th class="p-1 text-[var(--color-text-muted)]">B</th>
          </tr>
        </thead>
        <tbody>
          {colors.map((c1, i) => (
            <tr key={i}>
              <td class="p-1">
                <div
                  class="mx-auto h-4 w-4 rounded"
                  style={{ backgroundColor: rgbToHex(c1) }}
                />
              </td>
              {colors.map((c2, j) => {
                if (i === j) {
                  return (
                    <td key={j} class="p-1 text-center text-[var(--color-text-muted)]">
                      -
                    </td>
                  );
                }
                const ratio = contrastRatio(c1, c2);
                const rating = wcagRating(ratio);
                return (
                  <td
                    key={j}
                    class="p-1 text-center font-mono"
                    style={{ color: ratingColor(rating) }}
                    title={`${ratio.toFixed(2)}:1 (${rating})`}
                  >
                    {ratio.toFixed(1)}
                  </td>
                );
              })}
              <td class="p-1 text-center font-mono" style={{ color: ratingColor(wcagRating(contrastRatio(c1, { r: 255, g: 255, b: 255 }))) }}>
                {contrastRatio(c1, { r: 255, g: 255, b: 255 }).toFixed(1)}
              </td>
              <td class="p-1 text-center font-mono" style={{ color: ratingColor(wcagRating(contrastRatio(c1, { r: 0, g: 0, b: 0 }))) }}>
                {contrastRatio(c1, { r: 0, g: 0, b: 0 }).toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContrastSimplified({ colors }: { colors: RGB[] }) {
  const white: RGB = { r: 255, g: 255, b: 255 };
  const black: RGB = { r: 0, g: 0, b: 0 };

  return (
    <div class="space-y-1">
      <p class="text-[10px] text-[var(--color-text-muted)] mb-2">
        Contrast vs white & black backgrounds:
      </p>
      {colors.map((c, i) => {
        const ratioW = contrastRatio(c, white);
        const ratioB = contrastRatio(c, black);
        const ratingW = wcagRating(ratioW);
        const ratingB = wcagRating(ratioB);
        return (
          <div key={i} class="flex items-center gap-2 text-[10px] font-mono">
            <div
              class="h-3 w-3 rounded"
              style={{ backgroundColor: rgbToHex(c) }}
            />
            <span style={{ color: ratingColor(ratingW) }}>
              W:{ratioW.toFixed(1)} {ratingW}
            </span>
            <span style={{ color: ratingColor(ratingB) }}>
              B:{ratioB.toFixed(1)} {ratingB}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ratingColor(rating: WcagRating): string {
  switch (rating) {
    case "AAA":
      return "var(--color-accent)";
    case "AA":
      return "#4ade80";
    case "AA-large":
      return "#fbbf24";
    case "Fail":
      return "#ef4444";
  }
}

function ColorblindPreview({ colors }: { colors: RGB[] }) {
  const types: { type: ColorblindType; label: string }[] = [
    { type: "protanopia", label: "Protanopia (red-blind)" },
    { type: "deuteranopia", label: "Deuteranopia (green-blind)" },
    { type: "tritanopia", label: "Tritanopia (blue-blind)" },
    { type: "achromatopsia", label: "Achromatopsia (total)" },
  ];

  return (
    <div class="space-y-2">
      {types.map(({ type, label }) => (
        <div key={type}>
          <p class="mb-1 text-[10px] text-[var(--color-text-muted)]">{label}</p>
          <div class="flex gap-1">
            {colors.map((c, i) => {
              const sim = simulateColorblind(c, type);
              return (
                <div
                  key={i}
                  class="rounded"
                  style={{
                    backgroundColor: rgbToHex(sim),
                    height: "20px",
                    flex: "1 1 0",
                    minWidth: "12px",
                  }}
                  title={`${rgbToHex(c)} -> ${rgbToHex(sim)}`}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function PreviewCharts({ colors }: { colors: RGB[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
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

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = "transparent";
    ctx.fillRect(0, 0, w, h);

    const chartW = w / 2 - 16;
    const chartH = h / 2 - 16;

    // Get computed text color for labels
    const style = getComputedStyle(canvas);
    const textColor =
      style.getPropertyValue("--color-text-muted").trim() || "#a1a1aa";

    // Bar chart (top left)
    drawBarChart(ctx, 8, 8, chartW, chartH, colors, textColor);

    // Pie chart (top right)
    drawPieChart(ctx, w / 2 + 8, 8, chartW, chartH, colors);

    // Line chart (bottom left)
    drawLineChart(ctx, 8, h / 2 + 8, chartW, chartH, colors, textColor);

    // Text preview (bottom right)
    drawTextPreview(ctx, w / 2 + 8, h / 2 + 8, chartW, chartH, colors);
  }, [colors]);

  useEffect(() => {
    draw();
    const handleResize = () => draw();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      class="h-full w-full rounded-lg"
      style={{
        width: "100%",
        height: "280px",
        color: "var(--color-text-muted)",
      }}
    />
  );
}

function drawBarChart(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  colors: RGB[],
  textColor: string
) {
  const barCount = Math.min(colors.length, 7);
  const barGap = 4;
  const barW = (w - barGap * (barCount + 1)) / barCount;
  const maxH = h - 20;
  const values = [0.8, 0.6, 0.95, 0.45, 0.7, 0.55, 0.85];

  ctx.font = "9px monospace";
  ctx.fillStyle = textColor;
  ctx.fillText("Bar Chart", x, y + 10);

  for (let i = 0; i < barCount; i++) {
    const barH = maxH * values[i % values.length];
    const bx = x + barGap + i * (barW + barGap);
    const by = y + 16 + (maxH - barH);

    ctx.fillStyle = rgbToHex(colors[i % colors.length]);
    ctx.beginPath();
    ctx.roundRect(bx, by, barW, barH, 2);
    ctx.fill();
  }
}

function drawPieChart(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  colors: RGB[]
) {
  const cx = x + w / 2;
  const cy = y + h / 2 + 6;
  const radius = Math.min(w, h - 16) / 2 - 4;
  const sliceCount = Math.min(colors.length, 8);
  const values = [3, 2, 4, 1.5, 2.5, 1, 3.5, 2];
  const total = values.slice(0, sliceCount).reduce((a, b) => a + b, 0);

  ctx.font = "9px monospace";
  const style = getComputedStyle(ctx.canvas);
  ctx.fillStyle =
    style.getPropertyValue("--color-text-muted").trim() || "#a1a1aa";
  ctx.fillText("Pie Chart", x, y + 10);

  let startAngle = -Math.PI / 2;
  for (let i = 0; i < sliceCount; i++) {
    const sliceAngle = (values[i] / total) * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, startAngle + sliceAngle);
    ctx.closePath();
    ctx.fillStyle = rgbToHex(colors[i % colors.length]);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.lineWidth = 1;
    ctx.stroke();
    startAngle += sliceAngle;
  }
}

function drawLineChart(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  colors: RGB[],
  textColor: string
) {
  const lineCount = Math.min(colors.length, 4);
  const points = 8;
  const maxH = h - 20;

  ctx.font = "9px monospace";
  ctx.fillStyle = textColor;
  ctx.fillText("Line Chart", x, y + 10);

  // Generate deterministic data per line
  for (let line = 0; line < lineCount; line++) {
    ctx.beginPath();
    ctx.strokeStyle = rgbToHex(colors[line]);
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";

    for (let p = 0; p < points; p++) {
      const px = x + (p / (points - 1)) * w;
      // Deterministic "random" based on line + point index
      const seed = Math.sin(line * 127 + p * 311) * 0.5 + 0.5;
      const base = 0.3 + line * 0.12;
      const val = base + seed * 0.4;
      const py = y + 16 + maxH * (1 - Math.min(1, val));

      if (p === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}

function drawTextPreview(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  colors: RGB[]
) {
  ctx.font = "9px monospace";
  const style = getComputedStyle(ctx.canvas);
  ctx.fillStyle =
    style.getPropertyValue("--color-text-muted").trim() || "#a1a1aa";
  ctx.fillText("Text on BG", x, y + 10);

  const rows = Math.min(colors.length, 4);
  const rowH = (h - 20) / rows;

  for (let i = 0; i < rows; i++) {
    const bgColor = colors[i];
    const ry = y + 16 + i * rowH;

    ctx.fillStyle = rgbToHex(bgColor);
    ctx.beginPath();
    ctx.roundRect(x, ry, w, rowH - 2, 3);
    ctx.fill();

    // Choose white or black text based on luminance
    const lum =
      0.2126 * (bgColor.r / 255) +
      0.7152 * (bgColor.g / 255) +
      0.0722 * (bgColor.b / 255);
    ctx.fillStyle = lum > 0.5 ? "#000000" : "#ffffff";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText("Sample Text Aa", x + 6, ry + rowH / 2 + 3);
  }
}

function ExportPanel({
  colors,
  onCopy,
}: {
  colors: RGB[];
  onCopy: (text: string, label: string) => void;
}) {
  const exports = [
    { label: "CSS", fn: () => exportAsCssVariables(colors) },
    { label: "JSON", fn: () => exportAsJsonArray(colors) },
    { label: "Tailwind", fn: () => exportAsTailwindConfig(colors) },
    { label: "SVG", fn: () => exportAsSvgGradient(colors) },
  ];

  return (
    <div class="flex flex-wrap gap-2">
      {exports.map(({ label, fn }) => (
        <button
          key={label}
          onClick={() => onCopy(fn(), label)}
          class="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-text)]"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────

export default function ColorPalette() {
  const [mode, setMode] = useState<PaletteMode>("sequential");
  const [count, setCount] = useState(6);
  const [hue, setHue] = useState(210);
  const [hue2, setHue2] = useState(30);
  const [saturation, setSaturation] = useState(70);
  const [lightnessMin, setLightnessMin] = useState(25);
  const [lightnessMax, setLightnessMax] = useState(85);
  const [selectedPreset, setSelectedPreset] = useState<string>("");
  const [copyFeedback, setCopyFeedback] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [customColors, setCustomColors] = useState<RGB[] | null>(null);

  const config: PaletteConfig = {
    mode,
    count,
    hue,
    hue2,
    saturation,
    lightnessMin,
    lightnessMax,
  };

  // Generate palette
  const colors = selectedPreset
    ? expandPreset(
        PRESET_PALETTES.find((p) => p.name === selectedPreset)!,
        count
      )
    : customColors ?? generatePalette(config);

  const handleCopy = useCallback((text: string, label?: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopyFeedback(label ? `${label} copied!` : "Copied!");
      setTimeout(() => setCopyFeedback(""), 1500);
    });
  }, []);

  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback((e: DragEvent, _index: number) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(
    (targetIndex: number) => {
      if (dragIndex === null || dragIndex === targetIndex) {
        setDragIndex(null);
        return;
      }
      const newColors = [...colors];
      const [moved] = newColors.splice(dragIndex, 1);
      newColors.splice(targetIndex, 0, moved);
      setCustomColors(newColors);
      setSelectedPreset("");
      setDragIndex(null);
    },
    [dragIndex, colors]
  );

  const handleShuffle = useCallback(() => {
    const shuffled = [...colors];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setCustomColors(shuffled);
    setSelectedPreset("");
  }, [colors]);

  const handleModeChange = useCallback((m: PaletteMode) => {
    setMode(m);
    setSelectedPreset("");
    setCustomColors(null);
  }, []);

  const handlePresetChange = useCallback(
    (e: Event) => {
      const value = (e.target as HTMLSelectElement).value;
      setSelectedPreset(value);
      setCustomColors(null);
      if (value) {
        const preset = PRESET_PALETTES.find((p) => p.name === value);
        if (preset) {
          if (preset.category === "sequential") setMode("sequential");
          else if (preset.category === "diverging") setMode("diverging");
          else setMode("categorical");
        }
      }
    },
    []
  );

  const handleConfigChange = useCallback(
    (setter: (v: number) => void) => (v: number) => {
      setter(v);
      setSelectedPreset("");
      setCustomColors(null);
    },
    []
  );

  return (
    <div class="space-y-6">
      {/* Controls */}
      <div
        class="rounded-xl border border-[var(--color-border)] p-4"
        style={{
          backgroundColor: "color-mix(in srgb, var(--color-surface) 80%, transparent)",
        }}
      >
        <div class="space-y-4">
          {/* Mode + Preset row */}
          <div class="flex flex-wrap items-center gap-4">
            <ModeSelector mode={mode} onModeChange={handleModeChange} />
            <div class="flex items-center gap-2">
              <select
                value={selectedPreset}
                onChange={handlePresetChange}
                class="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text)]"
              >
                <option value="">Custom</option>
                <optgroup label="Sequential">
                  {PRESET_PALETTES.filter((p) => p.category === "sequential").map(
                    (p) => (
                      <option key={p.name} value={p.name}>
                        {p.name}
                      </option>
                    )
                  )}
                </optgroup>
                <optgroup label="Diverging">
                  {PRESET_PALETTES.filter((p) => p.category === "diverging").map(
                    (p) => (
                      <option key={p.name} value={p.name}>
                        {p.name}
                      </option>
                    )
                  )}
                </optgroup>
                <optgroup label="Categorical">
                  {PRESET_PALETTES.filter((p) => p.category === "categorical").map(
                    (p) => (
                      <option key={p.name} value={p.name}>
                        {p.name}
                      </option>
                    )
                  )}
                </optgroup>
              </select>
              <button
                onClick={handleShuffle}
                class="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-text)]"
                title="Shuffle order"
              >
                Shuffle
              </button>
            </div>
          </div>

          {/* Sliders */}
          <div class="grid gap-3 sm:grid-cols-2">
            <SliderControl
              label="Colors"
              value={count}
              min={2}
              max={12}
              onChange={handleConfigChange(setCount)}
            />
            <SliderControl
              label="Hue"
              value={hue}
              min={0}
              max={360}
              onChange={handleConfigChange(setHue)}
              displayValue={`${hue}\u00B0`}
            />
            {mode === "diverging" && (
              <SliderControl
                label="Hue 2"
                value={hue2}
                min={0}
                max={360}
                onChange={handleConfigChange(setHue2)}
                displayValue={`${hue2}\u00B0`}
              />
            )}
            <SliderControl
              label="Saturation"
              value={saturation}
              min={0}
              max={100}
              onChange={handleConfigChange(setSaturation)}
              displayValue={`${saturation}%`}
            />
            <SliderControl
              label="Light Min"
              value={lightnessMin}
              min={0}
              max={lightnessMax - 5}
              onChange={handleConfigChange(setLightnessMin)}
              displayValue={`${lightnessMin}%`}
            />
            <SliderControl
              label="Light Max"
              value={lightnessMax}
              min={lightnessMin + 5}
              max={100}
              onChange={handleConfigChange(setLightnessMax)}
              displayValue={`${lightnessMax}%`}
            />
          </div>

          {/* Hue preview strips */}
          <div class="flex gap-2">
            <div class="flex h-3 flex-1 overflow-hidden rounded-full">
              {Array.from({ length: 36 }, (_, i) => {
                const h = i * 10;
                const c = rgbToHex(hslToRgb({ h, s: saturation, l: (lightnessMin + lightnessMax) / 2 }));
                return (
                  <div
                    key={i}
                    class="flex-1 cursor-pointer"
                    style={{ backgroundColor: c }}
                    onClick={() => {
                      handleConfigChange(setHue)(h);
                    }}
                    title={`Hue: ${h}\u00B0`}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Palette Swatches */}
      <div
        class="rounded-xl border border-[var(--color-border)] p-4"
        style={{
          backgroundColor: "color-mix(in srgb, var(--color-surface) 80%, transparent)",
        }}
      >
        <div class="mb-2 flex items-center justify-between">
          <h3 class="text-xs font-medium text-[var(--color-heading)]">
            Palette ({colors.length} colors)
          </h3>
          {copyFeedback && (
            <span class="text-xs text-[var(--color-accent)]">{copyFeedback}</span>
          )}
        </div>
        <div class="flex gap-2">
          {colors.map((c, i) => (
            <ColorSwatch
              key={i}
              color={c}
              index={i}
              onCopy={(hex) => handleCopy(hex)}
              isDragging={dragIndex === i}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            />
          ))}
        </div>
        <p class="mt-2 text-[10px] text-[var(--color-text-muted)]">
          Click a swatch to copy hex. Drag to reorder.
        </p>
      </div>

      {/* Colorblind Simulation */}
      <div
        class="rounded-xl border border-[var(--color-border)] p-4"
        style={{
          backgroundColor: "color-mix(in srgb, var(--color-surface) 80%, transparent)",
        }}
      >
        <h3 class="mb-3 text-xs font-medium text-[var(--color-heading)]">
          Colorblind Simulation
        </h3>
        <ColorblindPreview colors={colors} />
      </div>

      {/* Contrast Matrix & Preview (tabbed on mobile, side by side on desktop) */}
      <div class="grid gap-6 lg:grid-cols-2">
        {/* Contrast Matrix */}
        <div
          class="rounded-xl border border-[var(--color-border)] p-4"
          style={{
            backgroundColor: "color-mix(in srgb, var(--color-surface) 80%, transparent)",
          }}
        >
          <h3 class="mb-3 text-xs font-medium text-[var(--color-heading)]">
            Contrast Matrix (WCAG 2.1)
          </h3>
          <div class="mb-2 flex gap-3 text-[9px]">
            <span>
              <span style={{ color: "var(--color-accent)" }}>AAA</span> 7:1+
            </span>
            <span>
              <span style={{ color: "#4ade80" }}>AA</span> 4.5:1+
            </span>
            <span>
              <span style={{ color: "#fbbf24" }}>AA-lg</span> 3:1+
            </span>
            <span>
              <span style={{ color: "#ef4444" }}>Fail</span> &lt;3:1
            </span>
          </div>
          <ContrastMatrix colors={colors} />
        </div>

        {/* Preview Charts */}
        <div
          class="rounded-xl border border-[var(--color-border)] p-4"
          style={{
            backgroundColor: "color-mix(in srgb, var(--color-surface) 80%, transparent)",
          }}
        >
          <h3 class="mb-3 text-xs font-medium text-[var(--color-heading)]">
            Preview
          </h3>
          <PreviewCharts colors={colors} />
        </div>
      </div>

      {/* Export */}
      <div
        class="rounded-xl border border-[var(--color-border)] p-4"
        style={{
          backgroundColor: "color-mix(in srgb, var(--color-surface) 80%, transparent)",
        }}
      >
        <h3 class="mb-3 text-xs font-medium text-[var(--color-heading)]">
          Export
        </h3>
        <ExportPanel colors={colors} onCopy={handleCopy} />
      </div>
    </div>
  );
}
