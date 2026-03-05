// ─────────────────────────────────────────────────────────
// Color Math — Pure functions for color science
// No dependencies. All math from published research.
// ─────────────────────────────────────────────────────────

export interface RGB {
  r: number; // 0-255
  g: number;
  b: number;
}

export interface HSL {
  h: number; // 0-360
  s: number; // 0-100
  l: number; // 0-100
}

export interface Lab {
  L: number; // 0-100
  a: number; // roughly -128 to 128
  b: number;
}

export interface XYZ {
  x: number;
  y: number;
  z: number;
}

// ─────────────────────────────────────────────────────────
// HSL <-> RGB Conversion
// ─────────────────────────────────────────────────────────

export function hslToRgb(hsl: HSL): RGB {
  const h = hsl.h / 360;
  const s = hsl.s / 100;
  const l = hsl.l / 100;

  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return {
    r: Math.round(hueToChannel(p, q, h + 1 / 3) * 255),
    g: Math.round(hueToChannel(p, q, h) * 255),
    b: Math.round(hueToChannel(p, q, h - 1 / 3) * 255),
  };
}

function hueToChannel(p: number, q: number, t: number): number {
  let tc = t;
  if (tc < 0) tc += 1;
  if (tc > 1) tc -= 1;
  if (tc < 1 / 6) return p + (q - p) * 6 * tc;
  if (tc < 1 / 2) return q;
  if (tc < 2 / 3) return p + (q - p) * (2 / 3 - tc) * 6;
  return p;
}

export function rgbToHsl(rgb: RGB): HSL {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l: l * 100 };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return { h: h * 360, s: s * 100, l: l * 100 };
}

// ─────────────────────────────────────────────────────────
// RGB <-> Hex
// ─────────────────────────────────────────────────────────

export function rgbToHex(rgb: RGB): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

export function hexToRgb(hex: string): RGB {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

// ─────────────────────────────────────────────────────────
// RGB <-> XYZ <-> Lab (CIE 1931 / CIELAB)
// Using D65 illuminant reference white
// ─────────────────────────────────────────────────────────

const D65_X = 0.95047;
const D65_Y = 1.0;
const D65_Z = 1.08883;

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, v)) * 255);
}

export function rgbToXyz(rgb: RGB): XYZ {
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);

  return {
    x: 0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    y: 0.2126729 * r + 0.7151522 * g + 0.0721750 * b,
    z: 0.0193339 * r + 0.1191920 * g + 0.9503041 * b,
  };
}

export function xyzToRgb(xyz: XYZ): RGB {
  const r = 3.2404542 * xyz.x - 1.5371385 * xyz.y - 0.4985314 * xyz.z;
  const g = -0.9692660 * xyz.x + 1.8760108 * xyz.y + 0.0415560 * xyz.z;
  const b = 0.0556434 * xyz.x - 0.2040259 * xyz.y + 1.0572252 * xyz.z;

  return {
    r: linearToSrgb(r),
    g: linearToSrgb(g),
    b: linearToSrgb(b),
  };
}

const LAB_EPSILON = 0.008856; // (6/29)^3
const LAB_KAPPA = 903.3; // (29/3)^3

function labF(t: number): number {
  return t > LAB_EPSILON ? Math.cbrt(t) : (LAB_KAPPA * t + 16) / 116;
}

function labFInverse(t: number): number {
  return t > 6 / 29 ? t * t * t : (116 * t - 16) / LAB_KAPPA;
}

export function xyzToLab(xyz: XYZ): Lab {
  const fx = labF(xyz.x / D65_X);
  const fy = labF(xyz.y / D65_Y);
  const fz = labF(xyz.z / D65_Z);

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

export function labToXyz(lab: Lab): XYZ {
  const fy = (lab.L + 16) / 116;
  const fx = lab.a / 500 + fy;
  const fz = fy - lab.b / 200;

  return {
    x: D65_X * labFInverse(fx),
    y: D65_Y * labFInverse(fy),
    z: D65_Z * labFInverse(fz),
  };
}

export function rgbToLab(rgb: RGB): Lab {
  return xyzToLab(rgbToXyz(rgb));
}

export function labToRgb(lab: Lab): RGB {
  return xyzToRgb(labToXyz(lab));
}

// ─────────────────────────────────────────────────────────
// Perceptual interpolation in Lab space
// ─────────────────────────────────────────────────────────

export function interpolateLab(c1: RGB, c2: RGB, t: number): RGB {
  const lab1 = rgbToLab(c1);
  const lab2 = rgbToLab(c2);

  const lab: Lab = {
    L: lab1.L + (lab2.L - lab1.L) * t,
    a: lab1.a + (lab2.a - lab1.a) * t,
    b: lab1.b + (lab2.b - lab1.b) * t,
  };

  return labToRgb(lab);
}

// ─────────────────────────────────────────────────────────
// WCAG Contrast Ratio
// ─────────────────────────────────────────────────────────

export function relativeLuminance(rgb: RGB): number {
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(c1: RGB, c2: RGB): number {
  const l1 = relativeLuminance(c1);
  const l2 = relativeLuminance(c2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export type WcagRating = "AAA" | "AA" | "AA-large" | "Fail";

export function wcagRating(ratio: number): WcagRating {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA-large";
  return "Fail";
}

// ─────────────────────────────────────────────────────────
// Colorblind Simulation
//
// Based on Brettel, Vienot & Mollon (1997) and
// Vienot, Brettel & Mollon (1999) color transformation.
// Matrices from published research for LMS color space.
// ─────────────────────────────────────────────────────────

// sRGB to LMS (Hunt-Pointer-Estevez adapted)
const RGB_TO_LMS = [
  [0.31399022, 0.63951294, 0.04649755],
  [0.15537241, 0.75789446, 0.08670142],
  [0.01775239, 0.10944209, 0.87256922],
];

const LMS_TO_RGB = [
  [5.47221206, -4.6419601, 0.16963708],
  [-1.1252419, 2.29317094, -0.1678952],
  [0.02980165, -0.19318073, 1.16364789],
];

function matMul3(m: number[][], v: number[]): number[] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

// Simulation matrices in LMS space
// These zero out / collapse the affected cone response
const PROTAN_LMS = [
  [0, 1.05118294, -0.05116099],
  [0, 1, 0],
  [0, 0, 1],
];

const DEUTAN_LMS = [
  [1, 0, 0],
  [0.9513092, 0, 0.04866992],
  [0, 0, 1],
];

const TRITAN_LMS = [
  [1, 0, 0],
  [0, 1, 0],
  [-0.86744736, 1.86727089, 0],
];

function simulateColorblindLms(rgb: RGB, lmsMatrix: number[][]): RGB {
  const linearR = srgbToLinear(rgb.r);
  const linearG = srgbToLinear(rgb.g);
  const linearB = srgbToLinear(rgb.b);

  const lms = matMul3(RGB_TO_LMS, [linearR, linearG, linearB]);
  const simLms = matMul3(lmsMatrix, lms);
  const simRgb = matMul3(LMS_TO_RGB, simLms);

  return {
    r: linearToSrgb(simRgb[0]),
    g: linearToSrgb(simRgb[1]),
    b: linearToSrgb(simRgb[2]),
  };
}

export type ColorblindType =
  | "protanopia"
  | "deuteranopia"
  | "tritanopia"
  | "achromatopsia";

export function simulateColorblind(rgb: RGB, type: ColorblindType): RGB {
  switch (type) {
    case "protanopia":
      return simulateColorblindLms(rgb, PROTAN_LMS);
    case "deuteranopia":
      return simulateColorblindLms(rgb, DEUTAN_LMS);
    case "tritanopia":
      return simulateColorblindLms(rgb, TRITAN_LMS);
    case "achromatopsia": {
      const gray = linearToSrgb(relativeLuminance(rgb));
      return { r: gray, g: gray, b: gray };
    }
  }
}

// ─────────────────────────────────────────────────────────
// Color distance (CIE76 - Delta E)
// ─────────────────────────────────────────────────────────

export function deltaE(c1: RGB, c2: RGB): number {
  const lab1 = rgbToLab(c1);
  const lab2 = rgbToLab(c2);
  return Math.sqrt(
    (lab1.L - lab2.L) ** 2 + (lab1.a - lab2.a) ** 2 + (lab1.b - lab2.b) ** 2
  );
}
