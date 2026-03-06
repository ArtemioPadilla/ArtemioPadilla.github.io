// ─────────────────────────────────────────────────────────
// Simple feedforward neural network for neuroevolution
// Forward-pass only — no backpropagation needed.
// Weights stored as a flat Float64Array for efficient GA crossover/mutation.
// ─────────────────────────────────────────────────────────

export interface NetworkTopology {
  readonly layers: readonly number[]; // e.g. [4, 6, 2]
}

export interface NeuralNetwork {
  readonly topology: NetworkTopology;
  readonly weights: Float64Array;
  readonly totalWeights: number;
}

/** Compute total weight count (weights + biases) for a topology. */
export function computeWeightCount(topology: NetworkTopology): number {
  let count = 0;
  for (let i = 0; i < topology.layers.length - 1; i++) {
    const inputs = topology.layers[i];
    const outputs = topology.layers[i + 1];
    count += inputs * outputs + outputs; // weights + biases
  }
  return count;
}

/** Create a new neural network with random weights in [-1, 1]. */
export function createNetwork(topology: NetworkTopology): NeuralNetwork {
  const totalWeights = computeWeightCount(topology);
  const weights = new Float64Array(totalWeights);
  for (let i = 0; i < totalWeights; i++) {
    weights[i] = Math.random() * 2 - 1;
  }
  return { topology, weights, totalWeights };
}

/** Create a network with specific weights (for GA offspring). */
export function createNetworkFromWeights(
  topology: NetworkTopology,
  weights: Float64Array,
): NeuralNetwork {
  return { topology, weights, totalWeights: weights.length };
}

/** Activation: tanh (bounded, smooth, works well for control tasks). */
function tanh(x: number): number {
  if (x > 20) return 1;
  if (x < -20) return -1;
  const e2x = Math.exp(2 * x);
  return (e2x - 1) / (e2x + 1);
}

/** Forward pass through the network. Returns output activations. */
export function forward(net: NeuralNetwork, inputs: number[]): number[] {
  const { topology, weights } = net;
  let current = inputs;
  let offset = 0;

  for (let layer = 0; layer < topology.layers.length - 1; layer++) {
    const inputSize = topology.layers[layer];
    const outputSize = topology.layers[layer + 1];
    const next: number[] = new Array(outputSize);

    for (let j = 0; j < outputSize; j++) {
      let sum = 0;
      for (let i = 0; i < inputSize; i++) {
        sum += current[i] * weights[offset + j * inputSize + i];
      }
      // Bias
      sum += weights[offset + outputSize * inputSize + j];
      // tanh activation for all layers (bounded output suits control tasks)
      next[j] = tanh(sum);
    }

    offset += outputSize * inputSize + outputSize;
    current = next;
  }

  return current;
}

/** Clone weights into a new Float64Array. */
export function cloneWeights(weights: Float64Array): Float64Array {
  return new Float64Array(weights);
}
