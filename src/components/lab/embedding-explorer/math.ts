// -----------------------------------------------------------------
// Pure math utilities for dimensionality reduction
// PCA (power iteration) and t-SNE (exact, simplified)
// -----------------------------------------------------------------

// -----------------------------------------------------------------
// Linear Algebra Helpers
// -----------------------------------------------------------------

export function subtractMean(data: number[][]): {
  centered: number[][];
  mean: number[];
} {
  const n = data.length;
  const d = data[0].length;
  const mean = new Array(d).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < d; j++) {
      mean[j] += data[i][j];
    }
  }
  for (let j = 0; j < d; j++) {
    mean[j] /= n;
  }

  const centered = data.map((row) => row.map((v, j) => v - mean[j]));
  return { centered, mean };
}

export function covarianceMatrix(centered: number[][]): number[][] {
  const n = centered.length;
  const d = centered[0].length;
  const cov: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));

  for (let i = 0; i < d; i++) {
    for (let j = i; j < d; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        sum += centered[k][i] * centered[k][j];
      }
      const val = sum / (n - 1);
      cov[i][j] = val;
      cov[j][i] = val;
    }
  }
  return cov;
}

function vecNorm(v: number[]): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i] * v[i];
  }
  return Math.sqrt(sum);
}

function matVecMul(mat: number[][], vec: number[]): number[] {
  const d = mat.length;
  const result = new Array(d).fill(0);
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      result[i] += mat[i][j] * vec[j];
    }
  }
  return result;
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

function normalizeVec(v: number[]): number[] {
  const norm = vecNorm(v);
  if (norm < 1e-12) return v;
  return v.map((x) => x / norm);
}

// -----------------------------------------------------------------
// Power Iteration for top K eigenvectors
// -----------------------------------------------------------------

function powerIteration(
  mat: number[][],
  maxIter: number = 200,
  tol: number = 1e-8
): { eigenvalue: number; eigenvector: number[] } {
  const d = mat.length;
  let v = Array.from({ length: d }, () => Math.random() - 0.5);
  v = normalizeVec(v);

  let eigenvalue = 0;
  for (let iter = 0; iter < maxIter; iter++) {
    const newV = matVecMul(mat, v);
    const newEigenvalue = dotProduct(newV, v);
    const normalized = normalizeVec(newV);

    if (Math.abs(newEigenvalue - eigenvalue) < tol) {
      return { eigenvalue: newEigenvalue, eigenvector: normalized };
    }
    eigenvalue = newEigenvalue;
    v = normalized;
  }
  return { eigenvalue, eigenvector: v };
}

function deflateMatrix(
  mat: number[][],
  eigenvalue: number,
  eigenvector: number[]
): number[][] {
  const d = mat.length;
  const deflated: number[][] = Array.from({ length: d }, (_, i) =>
    Array.from({ length: d }, (_, j) =>
      mat[i][j] - eigenvalue * eigenvector[i] * eigenvector[j]
    )
  );
  return deflated;
}

// -----------------------------------------------------------------
// PCA
// -----------------------------------------------------------------

export interface PCAResult {
  projected: number[][];
  explainedVariance: number[];
  totalVariance: number;
}

export function computePCA(data: number[][], nComponents: number): PCAResult {
  const { centered } = subtractMean(data);
  const cov = covarianceMatrix(centered);

  // Total variance = trace of covariance matrix
  let totalVariance = 0;
  for (let i = 0; i < cov.length; i++) {
    totalVariance += cov[i][i];
  }

  const eigenvectors: number[][] = [];
  const eigenvalues: number[] = [];
  let deflated = cov;

  for (let k = 0; k < nComponents; k++) {
    const { eigenvalue, eigenvector } = powerIteration(deflated);
    eigenvalues.push(eigenvalue);
    eigenvectors.push(eigenvector);
    deflated = deflateMatrix(deflated, eigenvalue, eigenvector);
  }

  const projected = centered.map((row) =>
    eigenvectors.map((ev) => dotProduct(row, ev))
  );

  return {
    projected,
    explainedVariance: eigenvalues.map((e) =>
      totalVariance > 0 ? Math.abs(e) / totalVariance : 0
    ),
    totalVariance,
  };
}

// -----------------------------------------------------------------
// t-SNE (exact, for small datasets < 500 points)
// -----------------------------------------------------------------

export interface TSNEState {
  positions: number[][];
  iteration: number;
  klDivergence: number;
}

export interface TSNEParams {
  perplexity: number;
  learningRate: number;
  nComponents: number;
}

function pairwiseDistances(data: number[][]): number[][] {
  const n = data.length;
  const dist: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let d = 0;
      for (let k = 0; k < data[i].length; k++) {
        const diff = data[i][k] - data[j][k];
        d += diff * diff;
      }
      dist[i][j] = d;
      dist[j][i] = d;
    }
  }
  return dist;
}

function computeAffinities(
  distances: number[][],
  perplexity: number
): number[][] {
  const n = distances.length;
  const P: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const targetEntropy = Math.log(perplexity);

  for (let i = 0; i < n; i++) {
    let betaMin = -Infinity;
    let betaMax = Infinity;
    let beta = 1.0;

    for (let iter = 0; iter < 50; iter++) {
      let sumP = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        P[i][j] = Math.exp(-distances[i][j] * beta);
        sumP += P[i][j];
      }
      if (sumP < 1e-12) sumP = 1e-12;

      let entropy = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        P[i][j] /= sumP;
        if (P[i][j] > 1e-12) {
          entropy -= P[i][j] * Math.log(P[i][j]);
        }
      }

      const entropyDiff = entropy - targetEntropy;
      if (Math.abs(entropyDiff) < 1e-5) break;

      if (entropyDiff > 0) {
        betaMin = beta;
        beta = betaMax === Infinity ? beta * 2 : (beta + betaMax) / 2;
      } else {
        betaMax = beta;
        beta = betaMin === -Infinity ? beta / 2 : (beta + betaMin) / 2;
      }
    }
  }

  // Symmetrize
  const symP: number[][] = Array.from({ length: n }, () =>
    new Array(n).fill(0)
  );
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const val = (P[i][j] + P[j][i]) / (2 * n);
      symP[i][j] = val;
      symP[j][i] = val;
    }
  }
  return symP;
}

export function initTSNE(
  data: number[][],
  params: TSNEParams
): { state: TSNEState; affinities: number[][] } {
  const n = data.length;
  const dim = params.nComponents;

  // Initialize with small random values
  const positions = Array.from({ length: n }, () =>
    Array.from({ length: dim }, () => (Math.random() - 0.5) * 0.01)
  );

  // Pre-compute high-dimensional affinities
  const distances = pairwiseDistances(data);
  const affinities = computeAffinities(distances, params.perplexity);

  return {
    state: { positions, iteration: 0, klDivergence: 0 },
    affinities,
  };
}

export function stepTSNE(
  state: TSNEState,
  affinities: number[][],
  params: TSNEParams,
  momentum: number[][]
): { state: TSNEState; momentum: number[][] } {
  const n = state.positions.length;
  const dim = params.nComponents;
  const Y = state.positions;
  const P = affinities;
  const iteration = state.iteration;

  // Early exaggeration factor
  const exaggeration = iteration < 250 ? 4.0 : 1.0;
  const momentumFactor = iteration < 250 ? 0.5 : 0.8;

  // Compute low-dimensional pairwise distances (Student-t kernel)
  const qDist: number[][] = Array.from({ length: n }, () =>
    new Array(n).fill(0)
  );
  let qSum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let d = 0;
      for (let k = 0; k < dim; k++) {
        const diff = Y[i][k] - Y[j][k];
        d += diff * diff;
      }
      const val = 1 / (1 + d);
      qDist[i][j] = val;
      qDist[j][i] = val;
      qSum += 2 * val;
    }
  }
  if (qSum < 1e-12) qSum = 1e-12;

  // Compute gradients
  const grad: number[][] = Array.from({ length: n }, () =>
    new Array(dim).fill(0)
  );
  let kl = 0;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const pij = P[i][j] * exaggeration;
      const qij = qDist[i][j] / qSum;
      const mult = 4 * (pij - qij) * qDist[i][j];

      for (let k = 0; k < dim; k++) {
        grad[i][k] += mult * (Y[i][k] - Y[j][k]);
      }

      if (i < j && pij > 1e-12 && qij > 1e-12) {
        kl += pij * Math.log(pij / qij);
      }
    }
  }

  // Update positions with momentum
  const newPositions = Y.map((row) => [...row]);
  const newMomentum = momentum.map((row) => [...row]);

  for (let i = 0; i < n; i++) {
    for (let k = 0; k < dim; k++) {
      newMomentum[i][k] =
        momentumFactor * newMomentum[i][k] - params.learningRate * grad[i][k];
      newPositions[i][k] += newMomentum[i][k];
    }
  }

  return {
    state: {
      positions: newPositions,
      iteration: iteration + 1,
      klDivergence: kl,
    },
    momentum: newMomentum,
  };
}

// -----------------------------------------------------------------
// K-Nearest Neighbors
// -----------------------------------------------------------------

export function findKNN(
  points: number[][],
  targetIdx: number,
  k: number
): number[] {
  const target = points[targetIdx];
  const distances: { idx: number; dist: number }[] = [];

  for (let i = 0; i < points.length; i++) {
    if (i === targetIdx) continue;
    let dist = 0;
    for (let j = 0; j < target.length; j++) {
      const diff = target[j] - points[i][j];
      dist += diff * diff;
    }
    distances.push({ idx: i, dist });
  }

  distances.sort((a, b) => a.dist - b.dist);
  return distances.slice(0, k).map((d) => d.idx);
}

// -----------------------------------------------------------------
// Euclidean distance
// -----------------------------------------------------------------

export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}
