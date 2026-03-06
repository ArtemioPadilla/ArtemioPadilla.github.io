// -----------------------------------------------------------------
// PCA (Principal Component Analysis) via power iteration
// Self-contained implementation for projecting embeddings to 2D
// -----------------------------------------------------------------

function vecNorm(v: number[]): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i] * v[i];
  }
  return Math.sqrt(sum);
}

function normalizeVec(v: number[]): number[] {
  const norm = vecNorm(v);
  if (norm < 1e-12) return v;
  return v.map((x) => x / norm);
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
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

function subtractMean(data: number[][]): { centered: number[][]; mean: number[] } {
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

function covarianceMatrix(centered: number[][]): number[][] {
  const n = centered.length;
  const d = centered[0].length;
  const cov: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));

  for (let i = 0; i < d; i++) {
    for (let j = i; j < d; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        sum += centered[k][i] * centered[k][j];
      }
      const val = n > 1 ? sum / (n - 1) : sum;
      cov[i][j] = val;
      cov[j][i] = val;
    }
  }
  return cov;
}

function powerIteration(
  mat: number[][],
  maxIter: number = 200,
  tol: number = 1e-8,
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
  eigenvector: number[],
): number[][] {
  const d = mat.length;
  return Array.from({ length: d }, (_, i) =>
    Array.from({ length: d }, (_, j) =>
      mat[i][j] - eigenvalue * eigenvector[i] * eigenvector[j],
    ),
  );
}

// -----------------------------------------------------------------
// Public API
// -----------------------------------------------------------------

export interface PCA2DResult {
  projected: number[][]; // Nx2 array
  explainedVariance: number[];
}

/** Project high-dimensional data to 2D using PCA via power iteration. */
export function projectTo2D(data: number[][]): PCA2DResult {
  if (data.length === 0 || data[0].length === 0) {
    return { projected: [], explainedVariance: [0, 0] };
  }

  if (data[0].length <= 2) {
    const projected = data.map((row) => [row[0] ?? 0, row[1] ?? 0]);
    return { projected, explainedVariance: [0.5, 0.5] };
  }

  const { centered } = subtractMean(data);
  const cov = covarianceMatrix(centered);

  let totalVariance = 0;
  for (let i = 0; i < cov.length; i++) {
    totalVariance += cov[i][i];
  }

  const eigenvectors: number[][] = [];
  const eigenvalues: number[] = [];
  let deflated = cov;

  for (let k = 0; k < 2; k++) {
    const { eigenvalue, eigenvector } = powerIteration(deflated);
    eigenvalues.push(eigenvalue);
    eigenvectors.push(eigenvector);
    deflated = deflateMatrix(deflated, eigenvalue, eigenvector);
  }

  const projected = centered.map((row) => [
    dotProduct(row, eigenvectors[0]),
    dotProduct(row, eigenvectors[1]),
  ]);

  const explainedVariance = eigenvalues.map((e) =>
    totalVariance > 0 ? Math.abs(e) / totalVariance : 0,
  );

  return { projected, explainedVariance };
}
