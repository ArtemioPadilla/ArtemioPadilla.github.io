// -----------------------------------------------------------------
// Word2Vec Skip-Gram with Negative Sampling — from scratch
// -----------------------------------------------------------------

// -----------------------------------------------------------------
// Vocabulary
// -----------------------------------------------------------------

export interface VocabEntry {
  readonly word: string;
  readonly index: number;
  readonly count: number;
}

export interface Vocabulary {
  readonly entries: VocabEntry[];
  readonly wordToIndex: Map<string, number>;
  readonly size: number;
  /** Precomputed unigram distribution raised to 3/4 power for negative sampling */
  readonly unigramTable: Float64Array;
}

/** Tokenize text into lowercase words, stripping punctuation. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/** Build vocabulary from tokens, optionally filtering by minimum count. */
export function buildVocabulary(tokens: string[], minCount: number = 1): Vocabulary {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  const entries: VocabEntry[] = [];
  const wordToIndex = new Map<string, number>();
  let idx = 0;

  // Sort by frequency descending for deterministic ordering
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);

  for (const [word, count] of sorted) {
    if (count >= minCount) {
      entries.push({ word, index: idx, count });
      wordToIndex.set(word, idx);
      idx++;
    }
  }

  // Build unigram distribution (count^0.75) for negative sampling
  const unigramTable = new Float64Array(entries.length);
  let total = 0;
  for (let i = 0; i < entries.length; i++) {
    unigramTable[i] = Math.pow(entries[i].count, 0.75);
    total += unigramTable[i];
  }
  for (let i = 0; i < entries.length; i++) {
    unigramTable[i] /= total;
  }

  // Convert to cumulative distribution for efficient sampling
  for (let i = 1; i < unigramTable.length; i++) {
    unigramTable[i] += unigramTable[i - 1];
  }

  return { entries, wordToIndex, size: entries.length, unigramTable };
}

// -----------------------------------------------------------------
// Skip-gram pairs
// -----------------------------------------------------------------

export interface SkipGramPair {
  readonly target: number;
  readonly context: number;
}

/** Generate skip-gram (target, context) pairs with given window size. */
export function generateSkipGrams(
  tokens: string[],
  vocab: Vocabulary,
  windowSize: number,
): SkipGramPair[] {
  const pairs: SkipGramPair[] = [];
  const indices = tokens
    .map((t) => vocab.wordToIndex.get(t))
    .filter((i): i is number => i !== undefined);

  for (let i = 0; i < indices.length; i++) {
    const target = indices[i];
    const start = Math.max(0, i - windowSize);
    const end = Math.min(indices.length - 1, i + windowSize);
    for (let j = start; j <= end; j++) {
      if (j === i) continue;
      pairs.push({ target, context: indices[j] });
    }
  }

  return pairs;
}

// -----------------------------------------------------------------
// Negative sampling
// -----------------------------------------------------------------

/** Sample a negative word index using the precomputed unigram CDF. */
function sampleNegative(vocab: Vocabulary, exclude: number): number {
  const table = vocab.unigramTable;
  const len = table.length;

  for (let attempt = 0; attempt < 20; attempt++) {
    const r = Math.random();
    // Binary search on cumulative distribution
    let lo = 0;
    let hi = len - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (table[mid] < r) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    if (lo !== exclude) return lo;
  }

  // Fallback: pick any word that is not excluded
  const fallback = (exclude + 1) % len;
  return fallback;
}

// -----------------------------------------------------------------
// Model
// -----------------------------------------------------------------

export interface Word2VecModel {
  /** Input (target) embeddings: vocabSize x embDim */
  embeddings: Float64Array[];
  /** Output (context) embeddings: vocabSize x embDim */
  contextEmbeddings: Float64Array[];
  readonly embDim: number;
  readonly vocab: Vocabulary;
}

/** Initialize a new Word2Vec model with random embeddings. */
export function createModel(vocab: Vocabulary, embDim: number): Word2VecModel {
  const scale = 0.1;
  const embeddings: Float64Array[] = [];
  const contextEmbeddings: Float64Array[] = [];

  for (let i = 0; i < vocab.size; i++) {
    const emb = new Float64Array(embDim);
    const ctx = new Float64Array(embDim);
    for (let d = 0; d < embDim; d++) {
      emb[d] = (Math.random() - 0.5) * scale;
      ctx[d] = (Math.random() - 0.5) * scale;
    }
    embeddings.push(emb);
    contextEmbeddings.push(ctx);
  }

  return { embeddings, contextEmbeddings, embDim, vocab };
}

// -----------------------------------------------------------------
// Sigmoid
// -----------------------------------------------------------------

function sigmoid(x: number): number {
  if (x > 6) return 1.0;
  if (x < -6) return 0.0;
  return 1.0 / (1.0 + Math.exp(-x));
}

// -----------------------------------------------------------------
// Training (one epoch)
// -----------------------------------------------------------------

export interface TrainEpochResult {
  readonly loss: number;
  readonly pairsProcessed: number;
}

/**
 * Train one epoch of skip-gram with negative sampling.
 * Returns the average loss for the epoch.
 */
export function trainEpoch(
  model: Word2VecModel,
  pairs: SkipGramPair[],
  learningRate: number,
  numNegatives: number,
): TrainEpochResult {
  const { embeddings, contextEmbeddings, embDim, vocab } = model;
  let totalLoss = 0;

  // Shuffle pairs
  const shuffled = [...pairs];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  for (const pair of shuffled) {
    const targetEmb = embeddings[pair.target];
    const gradTarget = new Float64Array(embDim);

    // Positive sample: context word (label = 1)
    const ctxEmb = contextEmbeddings[pair.context];
    let dot = 0;
    for (let d = 0; d < embDim; d++) {
      dot += targetEmb[d] * ctxEmb[d];
    }
    const sigPos = sigmoid(dot);
    const gradPos = sigPos - 1; // derivative of -log(sigmoid(dot))
    totalLoss += -Math.log(Math.max(sigPos, 1e-10));

    for (let d = 0; d < embDim; d++) {
      gradTarget[d] += gradPos * ctxEmb[d];
      ctxEmb[d] -= learningRate * gradPos * targetEmb[d];
    }

    // Negative samples (label = 0)
    for (let neg = 0; neg < numNegatives; neg++) {
      const negIdx = sampleNegative(vocab, pair.target);
      const negEmb = contextEmbeddings[negIdx];
      let negDot = 0;
      for (let d = 0; d < embDim; d++) {
        negDot += targetEmb[d] * negEmb[d];
      }
      const sigNeg = sigmoid(negDot);
      const gradNeg = sigNeg; // derivative of -log(1 - sigmoid(dot))
      totalLoss += -Math.log(Math.max(1 - sigNeg, 1e-10));

      for (let d = 0; d < embDim; d++) {
        gradTarget[d] += gradNeg * negEmb[d];
        negEmb[d] -= learningRate * gradNeg * targetEmb[d];
      }
    }

    // Update target embedding
    for (let d = 0; d < embDim; d++) {
      targetEmb[d] -= learningRate * gradTarget[d];
    }
  }

  return {
    loss: totalLoss / shuffled.length,
    pairsProcessed: shuffled.length,
  };
}

// -----------------------------------------------------------------
// Cosine Similarity & Nearest Neighbors
// -----------------------------------------------------------------

export function cosineSimilarity(a: Float64Array, b: Float64Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 1e-12 ? dot / denom : 0;
}

export interface SimilarWord {
  readonly word: string;
  readonly similarity: number;
  readonly index: number;
}

/** Find the K most similar words to a given word index. */
export function findMostSimilar(
  model: Word2VecModel,
  wordIndex: number,
  k: number,
): SimilarWord[] {
  const targetEmb = model.embeddings[wordIndex];
  const results: SimilarWord[] = [];

  for (let i = 0; i < model.vocab.size; i++) {
    if (i === wordIndex) continue;
    const sim = cosineSimilarity(targetEmb, model.embeddings[i]);
    results.push({
      word: model.vocab.entries[i].word,
      similarity: sim,
      index: i,
    });
  }

  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, k);
}

/** Solve analogy: a - b + c = ?  Find nearest to (vec_a - vec_b + vec_c). */
export function solveAnalogy(
  model: Word2VecModel,
  aIdx: number,
  bIdx: number,
  cIdx: number,
  k: number,
): SimilarWord[] {
  const { embeddings, embDim, vocab } = model;
  const result = new Float64Array(embDim);

  for (let d = 0; d < embDim; d++) {
    result[d] = embeddings[aIdx][d] - embeddings[bIdx][d] + embeddings[cIdx][d];
  }

  const exclude = new Set([aIdx, bIdx, cIdx]);
  const scores: SimilarWord[] = [];

  for (let i = 0; i < vocab.size; i++) {
    if (exclude.has(i)) continue;
    const sim = cosineSimilarity(result, embeddings[i]);
    scores.push({ word: vocab.entries[i].word, similarity: sim, index: i });
  }

  scores.sort((a, b) => b.similarity - a.similarity);
  return scores.slice(0, k);
}

/** Get embedding vectors as plain number[][] for PCA. */
export function getEmbeddingMatrix(model: Word2VecModel): number[][] {
  return model.embeddings.map((emb) => Array.from(emb));
}

/** Get K nearest neighbor indices for each word in embedding space. */
export function computeKNNGraph(model: Word2VecModel, k: number): number[][] {
  const n = model.vocab.size;
  const graph: number[][] = [];

  for (let i = 0; i < n; i++) {
    const neighbors = findMostSimilar(model, i, k);
    graph.push(neighbors.map((s) => s.index));
  }

  return graph;
}
