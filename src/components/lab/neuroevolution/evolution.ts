// ─────────────────────────────────────────────────────────
// Genetic Algorithm engine for neuroevolution
// Operates on flat Float64Array weight vectors.
// ─────────────────────────────────────────────────────────

import {
  type NetworkTopology,
  type NeuralNetwork,
  createNetworkFromWeights,
  computeWeightCount,
  cloneWeights,
} from "./nn";

export interface GAParams {
  populationSize: number;
  mutationRate: number;      // 0-1: probability of mutating each weight
  mutationStrength: number;  // std dev of Gaussian noise
  crossoverRate: number;     // 0-1: probability of crossover vs clone
  elitismCount: number;      // top N kept unchanged
  tournamentSize: number;    // tournament selection size
}

export const DEFAULT_GA_PARAMS: GAParams = {
  populationSize: 100,
  mutationRate: 0.1,
  mutationStrength: 0.3,
  crossoverRate: 0.7,
  elitismCount: 2,
  tournamentSize: 5,
};

export interface Individual {
  network: NeuralNetwork;
  fitness: number;
}

export interface Population {
  individuals: Individual[];
  generation: number;
  bestFitness: number;
  avgFitness: number;
  worstFitness: number;
}

/** Create an initial random population. */
export function createPopulation(
  topology: NetworkTopology,
  size: number,
): Population {
  const totalWeights = computeWeightCount(topology);
  const individuals: Individual[] = [];

  for (let i = 0; i < size; i++) {
    const weights = new Float64Array(totalWeights);
    for (let j = 0; j < totalWeights; j++) {
      weights[j] = Math.random() * 2 - 1;
    }
    individuals.push({
      network: createNetworkFromWeights(topology, weights),
      fitness: 0,
    });
  }

  return {
    individuals,
    generation: 0,
    bestFitness: 0,
    avgFitness: 0,
    worstFitness: 0,
  };
}

/** Box-Muller transform for Gaussian random number. */
function gaussianRandom(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/** Tournament selection: pick tournamentSize random individuals, return best. */
function tournamentSelect(
  individuals: Individual[],
  tournamentSize: number,
): Individual {
  let best: Individual | null = null;
  for (let i = 0; i < tournamentSize; i++) {
    const idx = Math.floor(Math.random() * individuals.length);
    const candidate = individuals[idx];
    if (best === null || candidate.fitness > best.fitness) {
      best = candidate;
    }
  }
  return best!;
}

/** Uniform crossover: for each weight, pick from parent A or B. */
function uniformCrossover(
  parentA: Float64Array,
  parentB: Float64Array,
): Float64Array {
  const child = new Float64Array(parentA.length);
  for (let i = 0; i < child.length; i++) {
    child[i] = Math.random() < 0.5 ? parentA[i] : parentB[i];
  }
  return child;
}

/** Mutate weights with Gaussian noise. */
function mutate(
  weights: Float64Array,
  rate: number,
  strength: number,
): void {
  for (let i = 0; i < weights.length; i++) {
    if (Math.random() < rate) {
      // 95% perturbation, 5% full reset
      if (Math.random() < 0.05) {
        weights[i] = Math.random() * 2 - 1;
      } else {
        weights[i] += gaussianRandom() * strength;
        // Clamp to prevent extreme values
        if (weights[i] > 5) weights[i] = 5;
        if (weights[i] < -5) weights[i] = -5;
      }
    }
  }
}

/** Evolve one generation. Assumes fitness is already assigned to all individuals. */
export function evolveGeneration(
  population: Population,
  params: GAParams,
  topology: NetworkTopology,
): Population {
  const { individuals } = population;
  const sorted = [...individuals].sort((a, b) => b.fitness - a.fitness);

  const nextIndividuals: Individual[] = [];

  // Elitism: keep top N unchanged
  const eliteCount = Math.min(params.elitismCount, sorted.length);
  for (let i = 0; i < eliteCount; i++) {
    nextIndividuals.push({
      network: createNetworkFromWeights(
        topology,
        cloneWeights(sorted[i].network.weights),
      ),
      fitness: 0,
    });
  }

  // Fill the rest with offspring
  while (nextIndividuals.length < params.populationSize) {
    const parentA = tournamentSelect(sorted, params.tournamentSize);

    let childWeights: Float64Array;

    if (Math.random() < params.crossoverRate) {
      const parentB = tournamentSelect(sorted, params.tournamentSize);
      childWeights = uniformCrossover(
        parentA.network.weights,
        parentB.network.weights,
      );
    } else {
      childWeights = cloneWeights(parentA.network.weights);
    }

    mutate(childWeights, params.mutationRate, params.mutationStrength);

    nextIndividuals.push({
      network: createNetworkFromWeights(topology, childWeights),
      fitness: 0,
    });
  }

  // Compute stats from the CURRENT (evaluated) generation
  const fitnesses = sorted.map((ind) => ind.fitness);
  const bestFitness = fitnesses[0];
  const worstFitness = fitnesses[fitnesses.length - 1];
  const avgFitness =
    fitnesses.reduce((sum, f) => sum + f, 0) / fitnesses.length;

  return {
    individuals: nextIndividuals,
    generation: population.generation + 1,
    bestFitness,
    avgFitness,
    worstFitness,
  };
}
