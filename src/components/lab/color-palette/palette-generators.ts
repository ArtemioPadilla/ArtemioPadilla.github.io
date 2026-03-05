// ─────────────────────────────────────────────────────────
// Palette Generators — Pure functions for generating
// color palettes in different modes.
// ─────────────────────────────────────────────────────────

import type { RGB } from "./color-math";
import { hslToRgb, interpolateLab, rgbToHex, hexToRgb } from "./color-math";

export type PaletteMode = "sequential" | "diverging" | "categorical" | "custom";

export interface PaletteConfig {
  mode: PaletteMode;
  count: number;
  hue: number; // 0-360 primary hue
  hue2: number; // 0-360 secondary hue (for diverging)
  saturation: number; // 0-100
  lightnessMin: number; // 0-100
  lightnessMax: number; // 0-100
}

// ─────────────────────────────────────────────────────────
// Sequential — Single hue, light to dark
// ─────────────────────────────────────────────────────────

export function generateSequential(config: PaletteConfig): RGB[] {
  const colors: RGB[] = [];
  for (let i = 0; i < config.count; i++) {
    const t = config.count === 1 ? 0.5 : i / (config.count - 1);
    const l = config.lightnessMax - t * (config.lightnessMax - config.lightnessMin);
    colors.push(
      hslToRgb({
        h: config.hue,
        s: config.saturation,
        l,
      })
    );
  }
  return colors;
}

// ─────────────────────────────────────────────────────────
// Diverging — Two hues from center
// ─────────────────────────────────────────────────────────

export function generateDiverging(config: PaletteConfig): RGB[] {
  const center: RGB = hslToRgb({ h: 0, s: 0, l: Math.min(95, config.lightnessMax) });

  const lowEnd: RGB = hslToRgb({
    h: config.hue,
    s: config.saturation,
    l: config.lightnessMin + (config.lightnessMax - config.lightnessMin) * 0.3,
  });

  const highEnd: RGB = hslToRgb({
    h: config.hue2,
    s: config.saturation,
    l: config.lightnessMin + (config.lightnessMax - config.lightnessMin) * 0.3,
  });

  const colors: RGB[] = [];
  const half = Math.floor(config.count / 2);

  // Left side (hue1 -> center)
  for (let i = 0; i < half; i++) {
    const t = half === 0 ? 1 : i / half;
    colors.push(interpolateLab(lowEnd, center, t));
  }

  // Center (for odd count)
  if (config.count % 2 === 1) {
    colors.push(center);
  }

  // Right side (center -> hue2)
  for (let i = 0; i < half; i++) {
    const t = half === 0 ? 0 : (i + 1) / half;
    colors.push(interpolateLab(center, highEnd, t));
  }

  return colors;
}

// ─────────────────────────────────────────────────────────
// Categorical — Maximally distinct hues
// ─────────────────────────────────────────────────────────

export function generateCategorical(config: PaletteConfig): RGB[] {
  const colors: RGB[] = [];
  const midL = (config.lightnessMin + config.lightnessMax) / 2;
  const goldenAngle = 137.508;

  for (let i = 0; i < config.count; i++) {
    const h = (config.hue + i * goldenAngle) % 360;
    // Alternate lightness slightly for better distinction
    const lVariation = i % 2 === 0 ? 0 : (config.lightnessMax - config.lightnessMin) * 0.15;
    colors.push(
      hslToRgb({
        h,
        s: config.saturation,
        l: midL + (i % 2 === 0 ? -lVariation : lVariation),
      })
    );
  }
  return colors;
}

// ─────────────────────────────────────────────────────────
// Custom — Interpolate between user-provided base colors
// ─────────────────────────────────────────────────────────

export function generateCustom(baseColors: RGB[], count: number): RGB[] {
  if (baseColors.length === 0) return [];
  if (baseColors.length === 1 || count === 1) return [baseColors[0]];
  if (count <= baseColors.length) return baseColors.slice(0, count);

  const colors: RGB[] = [];
  const segments = baseColors.length - 1;

  for (let i = 0; i < count; i++) {
    const pos = i / (count - 1) * segments;
    const segIdx = Math.min(Math.floor(pos), segments - 1);
    const t = pos - segIdx;
    colors.push(interpolateLab(baseColors[segIdx], baseColors[segIdx + 1], t));
  }

  return colors;
}

// ─────────────────────────────────────────────────────────
// Palette dispatcher
// ─────────────────────────────────────────────────────────

export function generatePalette(config: PaletteConfig): RGB[] {
  switch (config.mode) {
    case "sequential":
      return generateSequential(config);
    case "diverging":
      return generateDiverging(config);
    case "categorical":
      return generateCategorical(config);
    case "custom":
      return generateSequential(config); // fallback; custom uses generateCustom directly
  }
}

// ─────────────────────────────────────────────────────────
// Preset Palettes
// Inspired by matplotlib/d3 color schemes
// ─────────────────────────────────────────────────────────

export interface PresetPalette {
  name: string;
  category: "sequential" | "diverging" | "categorical";
  colors: string[]; // hex colors for interpolation anchors
}

export const PRESET_PALETTES: PresetPalette[] = [
  {
    name: "Viridis",
    category: "sequential",
    colors: ["#440154", "#31688e", "#35b779", "#fde725"],
  },
  {
    name: "Plasma",
    category: "sequential",
    colors: ["#0d0887", "#7e03a8", "#cc4778", "#f89540", "#f0f921"],
  },
  {
    name: "Inferno",
    category: "sequential",
    colors: ["#000004", "#420a68", "#932667", "#dd513a", "#fca50a", "#fcffa4"],
  },
  {
    name: "Blues",
    category: "sequential",
    colors: ["#f7fbff", "#6baed6", "#2171b5", "#08306b"],
  },
  {
    name: "RdBu",
    category: "diverging",
    colors: ["#67001f", "#d6604d", "#f7f7f7", "#4393c3", "#053061"],
  },
  {
    name: "RdYlGn",
    category: "diverging",
    colors: ["#a50026", "#f46d43", "#ffffbf", "#66bd63", "#006837"],
  },
  {
    name: "Set1",
    category: "categorical",
    colors: [
      "#e41a1c", "#377eb8", "#4daf4a", "#984ea3",
      "#ff7f00", "#ffff33", "#a65628", "#f781bf", "#999999",
    ],
  },
  {
    name: "Paired",
    category: "categorical",
    colors: [
      "#a6cee3", "#1f78b4", "#b2df8a", "#33a02c",
      "#fb9a99", "#e31a1c", "#fdbf6f", "#ff7f00",
      "#cab2d6", "#6a3d9a", "#ffff99", "#b15928",
    ],
  },
  {
    name: "Dark2",
    category: "categorical",
    colors: [
      "#1b9e77", "#d95f02", "#7570b3", "#e7298a",
      "#66a61e", "#e6ab02", "#a6761d", "#666666",
    ],
  },
  {
    name: "Spectral",
    category: "diverging",
    colors: ["#9e0142", "#f46d43", "#ffffbf", "#66c2a5", "#5e4fa2"],
  },
];

export function expandPreset(preset: PresetPalette, count: number): RGB[] {
  const baseColors = preset.colors.map(hexToRgb);

  if (preset.category === "categorical") {
    // For categorical, just pick colors from the list, cycling if needed
    const result: RGB[] = [];
    for (let i = 0; i < count; i++) {
      result.push(baseColors[i % baseColors.length]);
    }
    return result;
  }

  // For sequential/diverging, interpolate in Lab space
  return generateCustom(baseColors, count);
}

// ─────────────────────────────────────────────────────────
// Export Formatters
// ─────────────────────────────────────────────────────────

export function exportAsCssVariables(colors: RGB[]): string {
  return colors
    .map((c, i) => `  --palette-${i + 1}: ${rgbToHex(c)};`)
    .join("\n");
}

export function exportAsJsonArray(colors: RGB[]): string {
  return JSON.stringify(colors.map(rgbToHex), null, 2);
}

export function exportAsTailwindConfig(colors: RGB[]): string {
  const entries = colors
    .map((c, i) => `      '${i + 1}': '${rgbToHex(c)}',`)
    .join("\n");
  return `// tailwind.config.js\nmodule.exports = {\n  theme: {\n    extend: {\n      colors: {\n        palette: {\n${entries}\n        },\n      },\n    },\n  },\n};`;
}

export function exportAsSvgGradient(colors: RGB[]): string {
  const stops = colors
    .map((c, i) => {
      const offset = colors.length === 1 ? 50 : (i / (colors.length - 1)) * 100;
      return `    <stop offset="${offset.toFixed(0)}%" stop-color="${rgbToHex(c)}" />`;
    })
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="20">\n  <defs>\n    <linearGradient id="palette-gradient" x1="0%" y1="0%" x2="100%" y2="0%">\n${stops}\n    </linearGradient>\n  </defs>\n  <rect width="200" height="20" fill="url(#palette-gradient)" />\n</svg>`;
}
