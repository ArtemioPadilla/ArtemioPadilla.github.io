/**
 * Minimal neural network engine for binary classification.
 *
 * Supports:
 * - Configurable hidden layers (1-4) with 1-8 neurons each
 * - ReLU, Sigmoid, Tanh activations
 * - Xavier/He weight initialization
 * - Cross-entropy loss with sigmoid output
 * - Backpropagation via chain rule
 * - Mini-batch SGD with gradient clipping
 *
 * No external dependencies.
 */

/* ──────────────────────────────────────
   Types
   ────────────────────────────────────── */

export interface Layer {
  weights: number[][];   // [outputSize][inputSize]
  biases: number[];      // [outputSize]
  input?: number[];
  preActivation?: number[];
  output?: number[];
}

export type ActivationType = "relu" | "sigmoid" | "tanh";

export interface Network {
  layers: Layer[];
  activation: ActivationType;
}

/* ──────────────────────────────────────
   Initialization
   ────────────────────────────────────── */

function gaussianRandom(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function initializeWeights(
  inputSize: number,
  outputSize: number,
  activation: ActivationType,
): number[][] {
  // He initialization for ReLU, Xavier for sigmoid/tanh
  const scale =
    activation === "relu"
      ? Math.sqrt(2.0 / inputSize)
      : Math.sqrt(1.0 / inputSize);

  const weights: number[][] = [];
  for (let o = 0; o < outputSize; o++) {
    const row: number[] = [];
    for (let i = 0; i < inputSize; i++) {
      row.push(gaussianRandom() * scale);
    }
    weights.push(row);
  }
  return weights;
}

export function createNetwork(
  layerSizes: number[],
  activation: ActivationType,
): Network {
  if (layerSizes.length < 2) {
    throw new Error("Network must have at least input and output layers");
  }

  const layers: Layer[] = [];
  for (let i = 0; i < layerSizes.length - 1; i++) {
    const inputSize = layerSizes[i];
    const outputSize = layerSizes[i + 1];
    layers.push({
      weights: initializeWeights(inputSize, outputSize, activation),
      biases: new Array(outputSize).fill(0),
    });
  }

  return { layers, activation };
}

export function countParameters(net: Network): number {
  let total = 0;
  for (const layer of net.layers) {
    total += layer.weights.length * layer.weights[0].length;
    total += layer.biases.length;
  }
  return total;
}

/* ──────────────────────────────────────
   Activation functions
   ────────────────────────────────────── */

function relu(x: number): number {
  return x > 0 ? x : 0;
}

function reluDerivative(x: number): number {
  return x > 0 ? 1 : 0;
}

function sigmoid(x: number): number {
  if (x >= 0) {
    return 1 / (1 + Math.exp(-x));
  }
  const expX = Math.exp(x);
  return expX / (1 + expX);
}

function sigmoidDerivative(output: number): number {
  return output * (1 - output);
}

function tanh(x: number): number {
  return Math.tanh(x);
}

function tanhDerivative(output: number): number {
  return 1 - output * output;
}

function applyActivation(x: number, activation: ActivationType): number {
  switch (activation) {
    case "relu":
      return relu(x);
    case "sigmoid":
      return sigmoid(x);
    case "tanh":
      return tanh(x);
  }
}

function activationDerivative(
  preAct: number,
  output: number,
  activation: ActivationType,
): number {
  switch (activation) {
    case "relu":
      return reluDerivative(preAct);
    case "sigmoid":
      return sigmoidDerivative(output);
    case "tanh":
      return tanhDerivative(output);
  }
}

/* ──────────────────────────────────────
   Forward pass
   ────────────────────────────────────── */

export function forward(net: Network, input: number[]): number {
  let current = input;

  for (let l = 0; l < net.layers.length; l++) {
    const layer = net.layers[l];
    const isOutputLayer = l === net.layers.length - 1;

    layer.input = current;
    const preActivation: number[] = [];
    const output: number[] = [];

    for (let o = 0; o < layer.weights.length; o++) {
      let sum = layer.biases[o];
      for (let i = 0; i < current.length; i++) {
        sum += layer.weights[o][i] * current[i];
      }
      preActivation.push(sum);

      // Output layer always uses sigmoid for binary classification
      if (isOutputLayer) {
        output.push(sigmoid(sum));
      } else {
        output.push(applyActivation(sum, net.activation));
      }
    }

    layer.preActivation = preActivation;
    layer.output = output;
    current = output;
  }

  return current[0];
}

/* ──────────────────────────────────────
   Backpropagation + training
   ────────────────────────────────────── */

const GRADIENT_CLIP = 5.0;

function clipGradient(g: number): number {
  if (g > GRADIENT_CLIP) return GRADIENT_CLIP;
  if (g < -GRADIENT_CLIP) return -GRADIENT_CLIP;
  if (Number.isNaN(g)) return 0;
  return g;
}

function backprop(
  net: Network,
  target: number,
): { weightGrads: number[][][]; biasGrads: number[][] } {
  const numLayers = net.layers.length;
  const weightGrads: number[][][] = [];
  const biasGrads: number[][] = [];

  // Initialize gradient arrays
  for (let l = 0; l < numLayers; l++) {
    const layer = net.layers[l];
    const wg: number[][] = [];
    for (let o = 0; o < layer.weights.length; o++) {
      wg.push(new Array(layer.weights[o].length).fill(0));
    }
    weightGrads.push(wg);
    biasGrads.push(new Array(layer.biases.length).fill(0));
  }

  // Compute output layer delta
  // For binary cross-entropy with sigmoid output: delta = output - target
  const outputLayer = net.layers[numLayers - 1];
  const outputVal = outputLayer.output![0];
  let deltas: number[] = [clipGradient(outputVal - target)];

  // Set gradients for output layer
  for (let o = 0; o < outputLayer.weights.length; o++) {
    biasGrads[numLayers - 1][o] = deltas[o];
    for (let i = 0; i < outputLayer.weights[o].length; i++) {
      weightGrads[numLayers - 1][o][i] = clipGradient(
        deltas[o] * outputLayer.input![i],
      );
    }
  }

  // Backpropagate through hidden layers
  for (let l = numLayers - 2; l >= 0; l--) {
    const layer = net.layers[l];
    const nextLayer = net.layers[l + 1];
    const newDeltas: number[] = [];

    for (let o = 0; o < layer.weights.length; o++) {
      let error = 0;
      for (let n = 0; n < nextLayer.weights.length; n++) {
        error += nextLayer.weights[n][o] * deltas[n];
      }
      const dAct = activationDerivative(
        layer.preActivation![o],
        layer.output![o],
        net.activation,
      );
      newDeltas.push(clipGradient(error * dAct));
    }

    for (let o = 0; o < layer.weights.length; o++) {
      biasGrads[l][o] = newDeltas[o];
      for (let i = 0; i < layer.weights[o].length; i++) {
        weightGrads[l][o][i] = clipGradient(newDeltas[o] * layer.input![i]);
      }
    }

    deltas = newDeltas;
  }

  return { weightGrads, biasGrads };
}

export function trainStep(
  net: Network,
  data: [number, number, number][],
  lr: number,
): number {
  const batchSize = data.length;
  if (batchSize === 0) return 0;

  // Accumulate gradients
  const numLayers = net.layers.length;
  const accWeightGrads: number[][][] = [];
  const accBiasGrads: number[][] = [];

  for (let l = 0; l < numLayers; l++) {
    const layer = net.layers[l];
    const wg: number[][] = [];
    for (let o = 0; o < layer.weights.length; o++) {
      wg.push(new Array(layer.weights[o].length).fill(0));
    }
    accWeightGrads.push(wg);
    accBiasGrads.push(new Array(layer.biases.length).fill(0));
  }

  let totalLoss = 0;

  for (const [x, y, label] of data) {
    const prediction = forward(net, [x, y]);

    // Binary cross-entropy loss (clamped for numerical stability)
    const eps = 1e-7;
    const p = Math.max(eps, Math.min(1 - eps, prediction));
    totalLoss += -(label * Math.log(p) + (1 - label) * Math.log(1 - p));

    const { weightGrads, biasGrads } = backprop(net, label);

    for (let l = 0; l < numLayers; l++) {
      for (let o = 0; o < net.layers[l].weights.length; o++) {
        accBiasGrads[l][o] += biasGrads[l][o];
        for (let i = 0; i < net.layers[l].weights[o].length; i++) {
          accWeightGrads[l][o][i] += weightGrads[l][o][i];
        }
      }
    }
  }

  // Apply averaged gradients
  const scale = lr / batchSize;
  for (let l = 0; l < numLayers; l++) {
    const layer = net.layers[l];
    for (let o = 0; o < layer.weights.length; o++) {
      layer.biases[o] -= scale * accBiasGrads[l][o];
      for (let i = 0; i < layer.weights[o].length; i++) {
        layer.weights[o][i] -= scale * accWeightGrads[l][o][i];
      }
    }
  }

  return totalLoss / batchSize;
}

/* ──────────────────────────────────────
   Grid prediction (for decision boundary)
   ────────────────────────────────────── */

export function predictGrid(
  net: Network,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  resolution: number,
): number[][] {
  const grid: number[][] = [];
  const xStep = (xMax - xMin) / resolution;
  const yStep = (yMax - yMin) / resolution;

  for (let row = 0; row < resolution; row++) {
    const gridRow: number[] = [];
    const y = yMin + (row + 0.5) * yStep;
    for (let col = 0; col < resolution; col++) {
      const x = xMin + (col + 0.5) * xStep;
      gridRow.push(forward(net, [x, y]));
    }
    grid.push(gridRow);
  }

  return grid;
}

/* ──────────────────────────────────────
   Accuracy computation
   ────────────────────────────────────── */

export function computeAccuracy(
  net: Network,
  data: [number, number, number][],
): number {
  if (data.length === 0) return 0;
  let correct = 0;
  for (const [x, y, label] of data) {
    const prediction = forward(net, [x, y]);
    const predicted = prediction >= 0.5 ? 1 : 0;
    if (predicted === label) correct++;
  }
  return correct / data.length;
}
