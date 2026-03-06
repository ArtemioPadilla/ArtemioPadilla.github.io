/* ──────────────────────────────────────────────────
   Backpropagation Engine

   A minimal neural network with full forward/backward
   pass tracing. Every intermediate value is stored so
   the visualizer can step through the computation.
   ────────────────────────────────────────────────── */

export type ActivationType = "relu" | "sigmoid" | "tanh";

export interface NodeState {
  /** Weighted sum (z = sum(w_i * x_i) + b) */
  z: number;
  /** Activation output a = f(z) */
  a: number;
  /** dL/da — gradient of loss with respect to activation */
  dA: number;
  /** dL/dz — gradient of loss with respect to pre-activation */
  dZ: number;
}

export interface WeightState {
  /** Current weight value */
  value: number;
  /** dL/dw — gradient of loss with respect to this weight */
  grad: number;
}

export interface BiasState {
  value: number;
  grad: number;
}

export interface LayerState {
  nodes: NodeState[];
  /** Weights from previous layer: weights[to][from] */
  weights: WeightState[][];
  /** One bias per node */
  biases: BiasState[];
}

export interface Network {
  layerSizes: number[];
  layers: LayerState[];
  activation: ActivationType;
  /** Input values for the current pass */
  inputs: number[];
  /** Target values for the current pass */
  targets: number[];
  /** Current loss value */
  loss: number;
}

/* ── Activation functions ── */

function activate(z: number, type: ActivationType): number {
  switch (type) {
    case "relu":
      return Math.max(0, z);
    case "sigmoid":
      return 1 / (1 + Math.exp(-clamp(z, -500, 500)));
    case "tanh":
      return Math.tanh(z);
  }
}

function activateDerivative(z: number, type: ActivationType): number {
  switch (type) {
    case "relu":
      return z > 0 ? 1 : 0;
    case "sigmoid": {
      const s = activate(z, "sigmoid");
      return s * (1 - s);
    }
    case "tanh": {
      const t = Math.tanh(z);
      return 1 - t * t;
    }
  }
}

function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

/* ── Network creation ── */

export function createNetwork(
  layerSizes: number[],
  activation: ActivationType,
): Network {
  const layers: LayerState[] = [];

  for (let l = 0; l < layerSizes.length; l++) {
    const size = layerSizes[l];
    const nodes: NodeState[] = Array.from({ length: size }, () => ({
      z: 0,
      a: 0,
      dA: 0,
      dZ: 0,
    }));

    let weights: WeightState[][] = [];
    let biases: BiasState[] = [];

    if (l > 0) {
      const prevSize = layerSizes[l - 1];
      // Xavier initialization
      const scale = Math.sqrt(2 / (prevSize + size));
      weights = Array.from({ length: size }, () =>
        Array.from({ length: prevSize }, () => ({
          value: (Math.random() * 2 - 1) * scale,
          grad: 0,
        })),
      );
      biases = Array.from({ length: size }, () => ({
        value: 0,
        grad: 0,
      }));
    }

    layers.push({ nodes, weights, biases });
  }

  return {
    layerSizes,
    layers,
    activation,
    inputs: [],
    targets: [],
    loss: 0,
  };
}

/* ── Forward pass ── */

export function forwardPass(
  net: Network,
  inputs: number[],
  targets: number[],
): void {
  net.inputs = inputs;
  net.targets = targets;

  // Set input layer activations
  const inputLayer = net.layers[0];
  for (let i = 0; i < inputs.length; i++) {
    inputLayer.nodes[i].z = inputs[i];
    inputLayer.nodes[i].a = inputs[i];
  }

  // Propagate through hidden and output layers
  for (let l = 1; l < net.layers.length; l++) {
    const layer = net.layers[l];
    const prevLayer = net.layers[l - 1];
    const isOutput = l === net.layers.length - 1;

    for (let j = 0; j < layer.nodes.length; j++) {
      let z = layer.biases[j].value;
      for (let i = 0; i < prevLayer.nodes.length; i++) {
        z += layer.weights[j][i].value * prevLayer.nodes[i].a;
      }
      layer.nodes[j].z = z;
      // Output layer uses sigmoid for binary classification
      layer.nodes[j].a = isOutput
        ? activate(z, "sigmoid")
        : activate(z, net.activation);
    }
  }

  // Compute MSE loss
  const outputLayer = net.layers[net.layers.length - 1];
  let totalLoss = 0;
  for (let i = 0; i < outputLayer.nodes.length; i++) {
    const diff = outputLayer.nodes[i].a - targets[i];
    totalLoss += diff * diff;
  }
  net.loss = totalLoss / outputLayer.nodes.length;
}

/* ── Backward pass ── */

export function backwardPass(net: Network): void {
  const outputLayer = net.layers[net.layers.length - 1];

  // Output layer gradients (MSE derivative)
  for (let j = 0; j < outputLayer.nodes.length; j++) {
    const diff = outputLayer.nodes[j].a - net.targets[j];
    // dL/da = 2 * (a - target) / n
    outputLayer.nodes[j].dA =
      (2 * diff) / outputLayer.nodes.length;
    // For output layer, use sigmoid derivative
    const sigDeriv = activateDerivative(outputLayer.nodes[j].z, "sigmoid");
    outputLayer.nodes[j].dZ = outputLayer.nodes[j].dA * sigDeriv;
  }

  // Compute weight and bias gradients for output layer
  computeLayerGradients(net, net.layers.length - 1);

  // Propagate gradients backward through hidden layers
  for (let l = net.layers.length - 2; l >= 1; l--) {
    const layer = net.layers[l];
    const nextLayer = net.layers[l + 1];

    for (let j = 0; j < layer.nodes.length; j++) {
      // dL/da_j = sum over k: (dL/dz_k * w_kj)
      let dA = 0;
      for (let k = 0; k < nextLayer.nodes.length; k++) {
        dA += nextLayer.nodes[k].dZ * nextLayer.weights[k][j].value;
      }
      layer.nodes[j].dA = dA;
      layer.nodes[j].dZ = dA * activateDerivative(layer.nodes[j].z, net.activation);
    }

    computeLayerGradients(net, l);
  }

  // Clear input layer gradients
  for (const node of net.layers[0].nodes) {
    node.dA = 0;
    node.dZ = 0;
  }
}

function computeLayerGradients(net: Network, layerIndex: number): void {
  const layer = net.layers[layerIndex];
  const prevLayer = net.layers[layerIndex - 1];

  for (let j = 0; j < layer.nodes.length; j++) {
    const dZ = layer.nodes[j].dZ;

    // dL/dw_ji = dL/dz_j * a_i (from previous layer)
    for (let i = 0; i < prevLayer.nodes.length; i++) {
      layer.weights[j][i].grad = dZ * prevLayer.nodes[i].a;
    }

    // dL/db_j = dL/dz_j
    layer.biases[j].grad = dZ;
  }
}

/* ── Weight update (SGD) ── */

export function updateWeights(net: Network, learningRate: number): void {
  for (let l = 1; l < net.layers.length; l++) {
    const layer = net.layers[l];
    for (let j = 0; j < layer.nodes.length; j++) {
      for (let i = 0; i < layer.weights[j].length; i++) {
        layer.weights[j][i].value -= learningRate * layer.weights[j][i].grad;
      }
      layer.biases[j].value -= learningRate * layer.biases[j].grad;
    }
  }
}

/* ── Predict (forward only, returns output activations) ── */

export function predict(net: Network, inputs: number[]): number[] {
  forwardPass(net, inputs, new Array(net.layerSizes[net.layerSizes.length - 1]).fill(0));
  return net.layers[net.layers.length - 1].nodes.map((n) => n.a);
}

/* ── Gradient magnitude per layer (for vanishing gradient visualization) ── */

export function gradientMagnitudesPerLayer(net: Network): number[] {
  const magnitudes: number[] = [];
  for (let l = 1; l < net.layers.length; l++) {
    const layer = net.layers[l];
    let sumSq = 0;
    let count = 0;
    for (let j = 0; j < layer.nodes.length; j++) {
      for (let i = 0; i < layer.weights[j].length; i++) {
        sumSq += layer.weights[j][i].grad * layer.weights[j][i].grad;
        count++;
      }
    }
    magnitudes.push(count > 0 ? Math.sqrt(sumSq / count) : 0);
  }
  return magnitudes;
}

/* ── Preset configurations ── */

export interface Preset {
  name: string;
  description: string;
  layerSizes: number[];
  activation: ActivationType;
  learningRate: number;
  inputs: number[][];
  targets: number[][];
}

export const PRESETS: Preset[] = [
  {
    name: "XOR Problem",
    description: "Classic XOR: requires a hidden layer to solve",
    layerSizes: [2, 4, 2],
    activation: "tanh",
    learningRate: 0.1,
    inputs: [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ],
    targets: [[0, 1], [1, 0], [1, 0], [0, 1]],
  },
  {
    name: "Simple Classification",
    description: "Two-class separation with a small network",
    layerSizes: [2, 3, 2],
    activation: "relu",
    learningRate: 0.05,
    inputs: [
      [0.1, 0.9],
      [0.2, 0.8],
      [0.8, 0.1],
      [0.9, 0.2],
      [0.15, 0.85],
      [0.85, 0.15],
    ],
    targets: [[1, 0], [1, 0], [0, 1], [0, 1], [1, 0], [0, 1]],
  },
  {
    name: "Vanishing Gradients",
    description: "Deep narrow network (5 layers) with sigmoid — watch gradients vanish",
    layerSizes: [2, 3, 3, 3, 3, 2],
    activation: "sigmoid",
    learningRate: 0.5,
    inputs: [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ],
    targets: [[0, 1], [1, 0], [1, 0], [0, 1]],
  },
];
