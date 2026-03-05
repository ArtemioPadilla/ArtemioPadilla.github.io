// ─────────────────────────────────────────────────────────
// Decision Tree Engine — CART / ID3 Algorithm
// Pure business logic, zero UI dependencies
// ─────────────────────────────────────────────────────────

export type SplitCriterion = "gini" | "entropy" | "variance";
export type TaskType = "classification" | "regression";

export interface TreeParams {
  maxDepth: number;
  minSamplesLeaf: number;
  minImpurityDecrease: number;
  criterion: SplitCriterion;
}

export interface SplitInfo {
  feature: string;
  featureIndex: number;
  threshold: number | string;
  isNumeric: boolean;
  gain: number;
  parentImpurity: number;
  leftImpurity: number;
  rightImpurity: number;
}

export interface TreeNode {
  id: number;
  depth: number;
  indices: number[];
  classCounts: Record<string, number>;
  prediction: string | number;
  impurity: number;
  samples: number;
  isLeaf: boolean;
  split: SplitInfo | null;
  left: TreeNode | null;
  right: TreeNode | null;
}

export interface BuildStep {
  nodeId: number;
  description: string;
  bestSplit: SplitInfo | null;
  candidateSplits: SplitInfo[];
  node: TreeNode;
}

export interface FeatureImportance {
  feature: string;
  importance: number;
}

// ─────────────────────────────────────────────────────────
// Impurity Functions
// ─────────────────────────────────────────────────────────

export function giniImpurity(counts: Record<string, number>, total: number): number {
  if (total === 0) return 0;
  let sum = 0;
  for (const key in counts) {
    const p = counts[key] / total;
    sum += p * p;
  }
  return 1 - sum;
}

export function entropy(counts: Record<string, number>, total: number): number {
  if (total === 0) return 0;
  let sum = 0;
  for (const key in counts) {
    const p = counts[key] / total;
    if (p > 0) {
      sum -= p * Math.log2(p);
    }
  }
  return sum;
}

export function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
}

function computeImpurity(
  criterion: SplitCriterion,
  targets: Array<string | number>,
): number {
  if (targets.length === 0) return 0;

  if (criterion === "variance") {
    return variance(targets as number[]);
  }

  const counts: Record<string, number> = {};
  for (const t of targets) {
    const key = String(t);
    counts[key] = (counts[key] || 0) + 1;
  }

  return criterion === "gini"
    ? giniImpurity(counts, targets.length)
    : entropy(counts, targets.length);
}

// ─────────────────────────────────────────────────────────
// Class Counts & Prediction
// ─────────────────────────────────────────────────────────

function getClassCounts(
  targets: Array<string | number>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of targets) {
    const key = String(t);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function getPrediction(
  targets: Array<string | number>,
  taskType: TaskType,
): string | number {
  if (taskType === "regression") {
    const nums = targets as number[];
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }
  const counts = getClassCounts(targets);
  let best = "";
  let bestCount = -1;
  for (const key in counts) {
    if (counts[key] > bestCount) {
      bestCount = counts[key];
      best = key;
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────
// Find Best Split
// ─────────────────────────────────────────────────────────

function findBestSplit(
  data: Array<Record<string, number | string>>,
  indices: number[],
  features: string[],
  featureTypes: Array<"numeric" | "categorical">,
  target: string,
  criterion: SplitCriterion,
): { best: SplitInfo | null; candidates: SplitInfo[] } {
  const targets = indices.map((i) => data[i][target]);
  const parentImpurity = computeImpurity(criterion, targets);
  const n = indices.length;

  let best: SplitInfo | null = null;
  const candidates: SplitInfo[] = [];

  for (let fi = 0; fi < features.length; fi++) {
    const feature = features[fi];
    const isNumeric = featureTypes[fi] === "numeric";

    if (isNumeric) {
      const vals = indices.map((i) => ({
        val: data[i][feature] as number,
        target: data[i][target],
      }));
      vals.sort((a, b) => a.val - b.val);

      const uniqueVals = [...new Set(vals.map((v) => v.val))];
      if (uniqueVals.length <= 1) continue;

      const thresholds: number[] = [];
      for (let j = 0; j < uniqueVals.length - 1; j++) {
        thresholds.push((uniqueVals[j] + uniqueVals[j + 1]) / 2);
      }

      for (const threshold of thresholds) {
        const leftTargets: Array<string | number> = [];
        const rightTargets: Array<string | number> = [];

        for (const v of vals) {
          if (v.val <= threshold) {
            leftTargets.push(v.target);
          } else {
            rightTargets.push(v.target);
          }
        }

        if (leftTargets.length === 0 || rightTargets.length === 0) continue;

        const leftImpurity = computeImpurity(criterion, leftTargets);
        const rightImpurity = computeImpurity(criterion, rightTargets);
        const weightedImpurity =
          (leftTargets.length / n) * leftImpurity +
          (rightTargets.length / n) * rightImpurity;
        const gain = parentImpurity - weightedImpurity;

        const split: SplitInfo = {
          feature,
          featureIndex: fi,
          threshold,
          isNumeric: true,
          gain,
          parentImpurity,
          leftImpurity,
          rightImpurity,
        };

        candidates.push(split);

        if (best === null || gain > best.gain) {
          best = split;
        }
      }
    } else {
      const uniqueValues = [...new Set(indices.map((i) => data[i][feature]))];
      if (uniqueValues.length <= 1) continue;

      for (const value of uniqueValues) {
        const leftTargets: Array<string | number> = [];
        const rightTargets: Array<string | number> = [];

        for (const idx of indices) {
          if (data[idx][feature] === value) {
            leftTargets.push(data[idx][target]);
          } else {
            rightTargets.push(data[idx][target]);
          }
        }

        if (leftTargets.length === 0 || rightTargets.length === 0) continue;

        const leftImpurity = computeImpurity(criterion, leftTargets);
        const rightImpurity = computeImpurity(criterion, rightTargets);
        const weightedImpurity =
          (leftTargets.length / n) * leftImpurity +
          (rightTargets.length / n) * rightImpurity;
        const gain = parentImpurity - weightedImpurity;

        const split: SplitInfo = {
          feature,
          featureIndex: fi,
          threshold: value,
          isNumeric: false,
          gain,
          parentImpurity,
          leftImpurity,
          rightImpurity,
        };

        candidates.push(split);

        if (best === null || gain > best.gain) {
          best = split;
        }
      }
    }
  }

  candidates.sort((a, b) => b.gain - a.gain);
  return { best, candidates: candidates.slice(0, 10) };
}

// ─────────────────────────────────────────────────────────
// Build Tree (Full)
// ─────────────────────────────────────────────────────────

let nodeCounter = 0;

function buildNode(
  data: Array<Record<string, number | string>>,
  indices: number[],
  features: string[],
  featureTypes: Array<"numeric" | "categorical">,
  target: string,
  taskType: TaskType,
  params: TreeParams,
  depth: number,
  steps: BuildStep[],
): TreeNode {
  const targets = indices.map((i) => data[i][target]);
  const classCounts = getClassCounts(targets);
  const prediction = getPrediction(targets, taskType);
  const impurity = computeImpurity(params.criterion, targets);
  const nodeId = nodeCounter++;

  const node: TreeNode = {
    id: nodeId,
    depth,
    indices,
    classCounts,
    prediction,
    impurity,
    samples: indices.length,
    isLeaf: true,
    split: null,
    left: null,
    right: null,
  };

  // Check stopping conditions
  if (depth >= params.maxDepth) {
    steps.push({
      nodeId,
      description: `Node ${nodeId}: Max depth (${params.maxDepth}) reached. Leaf: ${formatPrediction(prediction, taskType)}`,
      bestSplit: null,
      candidateSplits: [],
      node: { ...node },
    });
    return node;
  }

  if (indices.length < params.minSamplesLeaf * 2) {
    steps.push({
      nodeId,
      description: `Node ${nodeId}: Too few samples (${indices.length} < ${params.minSamplesLeaf * 2}). Leaf: ${formatPrediction(prediction, taskType)}`,
      bestSplit: null,
      candidateSplits: [],
      node: { ...node },
    });
    return node;
  }

  if (impurity === 0) {
    steps.push({
      nodeId,
      description: `Node ${nodeId}: Pure node (impurity = 0). Leaf: ${formatPrediction(prediction, taskType)}`,
      bestSplit: null,
      candidateSplits: [],
      node: { ...node },
    });
    return node;
  }

  const { best, candidates } = findBestSplit(
    data,
    indices,
    features,
    featureTypes,
    target,
    params.criterion,
  );

  if (best === null || best.gain < params.minImpurityDecrease) {
    steps.push({
      nodeId,
      description: `Node ${nodeId}: No good split found (gain < ${params.minImpurityDecrease.toFixed(4)}). Leaf: ${formatPrediction(prediction, taskType)}`,
      bestSplit: best,
      candidateSplits: candidates,
      node: { ...node },
    });
    return node;
  }

  // Perform the split
  const leftIndices: number[] = [];
  const rightIndices: number[] = [];

  for (const idx of indices) {
    if (best.isNumeric) {
      if ((data[idx][best.feature] as number) <= (best.threshold as number)) {
        leftIndices.push(idx);
      } else {
        rightIndices.push(idx);
      }
    } else {
      if (data[idx][best.feature] === best.threshold) {
        leftIndices.push(idx);
      } else {
        rightIndices.push(idx);
      }
    }
  }

  if (
    leftIndices.length < params.minSamplesLeaf ||
    rightIndices.length < params.minSamplesLeaf
  ) {
    steps.push({
      nodeId,
      description: `Node ${nodeId}: Split would create too-small leaves. Leaf: ${formatPrediction(prediction, taskType)}`,
      bestSplit: best,
      candidateSplits: candidates,
      node: { ...node },
    });
    return node;
  }

  node.isLeaf = false;
  node.split = best;

  const splitLabel = best.isNumeric
    ? `${best.feature} <= ${(best.threshold as number).toFixed(2)}`
    : `${best.feature} == ${best.threshold}`;

  steps.push({
    nodeId,
    description: `Node ${nodeId}: Split on ${splitLabel} (gain=${best.gain.toFixed(4)}, ${leftIndices.length} left, ${rightIndices.length} right)`,
    bestSplit: best,
    candidateSplits: candidates,
    node: { ...node },
  });

  node.left = buildNode(
    data,
    leftIndices,
    features,
    featureTypes,
    target,
    taskType,
    params,
    depth + 1,
    steps,
  );

  node.right = buildNode(
    data,
    rightIndices,
    features,
    featureTypes,
    target,
    taskType,
    params,
    depth + 1,
    steps,
  );

  return node;
}

function formatPrediction(prediction: string | number, taskType: TaskType): string {
  if (taskType === "regression" && typeof prediction === "number") {
    return prediction.toFixed(2);
  }
  return String(prediction);
}

export interface BuildResult {
  tree: TreeNode;
  steps: BuildStep[];
  featureImportance: FeatureImportance[];
}

export function buildTree(
  data: Array<Record<string, number | string>>,
  features: string[],
  featureTypes: Array<"numeric" | "categorical">,
  target: string,
  taskType: TaskType,
  params: TreeParams,
): BuildResult {
  nodeCounter = 0;
  const steps: BuildStep[] = [];
  const indices = Array.from({ length: data.length }, (_, i) => i);

  const tree = buildNode(
    data,
    indices,
    features,
    featureTypes,
    target,
    taskType,
    params,
    0,
    steps,
  );

  const featureImportance = computeFeatureImportance(tree, features, data.length);

  return { tree, steps, featureImportance };
}

// ─────────────────────────────────────────────────────────
// Feature Importance
// ─────────────────────────────────────────────────────────

function computeFeatureImportance(
  tree: TreeNode,
  features: string[],
  totalSamples: number,
): FeatureImportance[] {
  const importanceMap: Record<string, number> = {};
  for (const f of features) {
    importanceMap[f] = 0;
  }

  function traverse(node: TreeNode): void {
    if (node.isLeaf || !node.split || !node.left || !node.right) return;

    const weightedGain = (node.samples / totalSamples) * node.split.gain;
    importanceMap[node.split.feature] += weightedGain;

    traverse(node.left);
    traverse(node.right);
  }

  traverse(tree);

  const totalImportance = Object.values(importanceMap).reduce((a, b) => a + b, 0);
  const result: FeatureImportance[] = features.map((f) => ({
    feature: f,
    importance: totalImportance > 0 ? importanceMap[f] / totalImportance : 0,
  }));

  result.sort((a, b) => b.importance - a.importance);
  return result;
}

// ─────────────────────────────────────────────────────────
// Prediction
// ─────────────────────────────────────────────────────────

export interface PredictionPath {
  nodeId: number;
  feature: string | null;
  threshold: number | string | null;
  direction: "left" | "right" | "leaf";
  prediction: string | number;
}

export function predict(
  tree: TreeNode,
  sample: Record<string, number | string>,
): { prediction: string | number; path: PredictionPath[] } {
  const path: PredictionPath[] = [];
  let node = tree;

  while (!node.isLeaf && node.split) {
    const val = sample[node.split.feature];
    let goLeft: boolean;

    if (node.split.isNumeric) {
      goLeft = (val as number) <= (node.split.threshold as number);
    } else {
      goLeft = val === node.split.threshold;
    }

    path.push({
      nodeId: node.id,
      feature: node.split.feature,
      threshold: node.split.threshold,
      direction: goLeft ? "left" : "right",
      prediction: node.prediction,
    });

    node = goLeft ? node.left! : node.right!;
  }

  path.push({
    nodeId: node.id,
    feature: null,
    threshold: null,
    direction: "leaf",
    prediction: node.prediction,
  });

  return { prediction: node.prediction, path };
}

// ─────────────────────────────────────────────────────────
// Tree Pruning (max depth based)
// ─────────────────────────────────────────────────────────

export function pruneTree(tree: TreeNode, maxDepth: number): TreeNode {
  return pruneNode(structuredClone(tree), maxDepth);
}

function pruneNode(node: TreeNode, maxDepth: number): TreeNode {
  if (node.depth >= maxDepth || node.isLeaf) {
    node.isLeaf = true;
    node.left = null;
    node.right = null;
    node.split = null;
    return node;
  }

  if (node.left) {
    node.left = pruneNode(node.left, maxDepth);
  }
  if (node.right) {
    node.right = pruneNode(node.right, maxDepth);
  }

  return node;
}

// ─────────────────────────────────────────────────────────
// Tree Layout Computation
// ─────────────────────────────────────────────────────────

export interface NodeLayout {
  node: TreeNode;
  x: number;
  y: number;
  parentX: number | null;
  parentY: number | null;
}

export function computeTreeLayout(
  tree: TreeNode,
  canvasWidth: number,
  canvasHeight: number,
): NodeLayout[] {
  const layouts: NodeLayout[] = [];
  const maxDepth = getTreeDepth(tree);
  const levelHeight = Math.min(
    80,
    maxDepth > 0 ? (canvasHeight - 80) / (maxDepth + 1) : canvasHeight - 80,
  );
  const yOffset = 40;

  function assignPositions(
    node: TreeNode,
    xMin: number,
    xMax: number,
    depth: number,
    parentX: number | null,
    parentY: number | null,
  ): void {
    const x = (xMin + xMax) / 2;
    const y = yOffset + depth * levelHeight;

    layouts.push({ node, x, y, parentX, parentY });

    if (!node.isLeaf && node.left && node.right) {
      assignPositions(node.left, xMin, x, depth + 1, x, y);
      assignPositions(node.right, x, xMax, depth + 1, x, y);
    }
  }

  assignPositions(tree, 20, canvasWidth - 20, 0, null, null);
  return layouts;
}

export function getTreeDepth(node: TreeNode): number {
  if (node.isLeaf) return 0;
  const leftDepth = node.left ? getTreeDepth(node.left) : 0;
  const rightDepth = node.right ? getTreeDepth(node.right) : 0;
  return 1 + Math.max(leftDepth, rightDepth);
}

export function getNodeCount(node: TreeNode): number {
  if (node.isLeaf) return 1;
  const leftCount = node.left ? getNodeCount(node.left) : 0;
  const rightCount = node.right ? getNodeCount(node.right) : 0;
  return 1 + leftCount + rightCount;
}

// ─────────────────────────────────────────────────────────
// 2D Decision Boundary
// ─────────────────────────────────────────────────────────

export function computeDecisionBoundary(
  tree: TreeNode,
  feature1: string,
  feature2: string,
  x1Range: [number, number],
  x2Range: [number, number],
  resolution: number,
): Array<{ x: number; y: number; prediction: string | number }> {
  const grid: Array<{ x: number; y: number; prediction: string | number }> = [];
  const stepX = (x1Range[1] - x1Range[0]) / resolution;
  const stepY = (x2Range[1] - x2Range[0]) / resolution;

  for (let i = 0; i <= resolution; i++) {
    for (let j = 0; j <= resolution; j++) {
      const x = x1Range[0] + i * stepX;
      const y = x2Range[0] + j * stepY;
      const sample: Record<string, number | string> = {
        [feature1]: x,
        [feature2]: y,
      };
      const { prediction } = predict(tree, sample);
      grid.push({ x, y, prediction });
    }
  }

  return grid;
}
