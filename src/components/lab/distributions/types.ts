// ─────────────────────────────────────────────────────────
// Types for the Probability Distributions Explorer
// ─────────────────────────────────────────────────────────

export interface ParameterDef {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}

export interface DistributionStats {
  mean: number | string;
  variance: number | string;
  stdDev: number | string;
  skewness: number | string;
  kurtosis: number | string;
  mode: number | string;
  median: number | string;
}

export interface DistributionDef {
  id: string;
  name: string;
  color: string;
  type: "continuous" | "discrete";
  parameters: ParameterDef[];
  pdf: (x: number, params: number[]) => number;
  cdf: (x: number, params: number[]) => number;
  xRange: (params: number[]) => [number, number];
  stats: (params: number[]) => DistributionStats;
}

export interface OverlayEntry {
  distributionId: string;
  params: number[];
  color: string;
}

export interface ProbCalcResult {
  pLessEqual: number;
  pGreater: number;
  pBetween: number | null;
}

export interface SampleData {
  values: number[];
  bins: number[];
  counts: number[];
  maxCount: number;
}

export type ViewMode = "pdf" | "cdf";

export interface PresetComparison {
  name: string;
  description: string;
  overlays: OverlayEntry[];
}
