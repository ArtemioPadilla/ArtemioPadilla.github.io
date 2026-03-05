// -----------------------------------------------------------------
// Preset datasets for embedding exploration
// -----------------------------------------------------------------

export interface EmbeddingPoint {
  vector: number[];
  label: string;
  category: number;
}

export interface Dataset {
  name: string;
  points: EmbeddingPoint[];
  dimensions: number;
}

// -----------------------------------------------------------------
// Word Embeddings (50 words, pre-defined 50-dim vectors, pre-reduced)
// Clusters: animals, colors, actions, emotions, food
// -----------------------------------------------------------------

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function generateClusteredVector(
  dim: number,
  clusterCenter: number[],
  spread: number,
  rng: () => number
): number[] {
  return Array.from({ length: dim }, (_, i) =>
    clusterCenter[i % clusterCenter.length] + (rng() - 0.5) * spread
  );
}

export function createWordEmbeddings(): Dataset {
  const rng = seededRandom(42);
  const dim = 50;

  const clusters: { words: string[]; center: number[]; category: number }[] = [
    {
      words: [
        "cat", "dog", "bird", "fish", "horse",
        "lion", "tiger", "bear", "wolf", "eagle",
      ],
      center: Array.from({ length: 10 }, (_, i) => 2 + Math.sin(i) * 0.5),
      category: 0,
    },
    {
      words: [
        "red", "blue", "green", "yellow", "purple",
        "orange", "pink", "white", "black", "gray",
      ],
      center: Array.from({ length: 10 }, (_, i) => -2 + Math.cos(i) * 0.5),
      category: 1,
    },
    {
      words: [
        "run", "jump", "walk", "swim", "fly",
        "climb", "throw", "catch", "push", "pull",
      ],
      center: Array.from({ length: 10 }, (_, i) => Math.sin(i * 2) * 2),
      category: 2,
    },
    {
      words: [
        "happy", "sad", "angry", "calm", "excited",
        "nervous", "brave", "shy", "proud", "grateful",
      ],
      center: Array.from({ length: 10 }, (_, i) => Math.cos(i * 2) * 2),
      category: 3,
    },
    {
      words: [
        "apple", "bread", "cheese", "pasta", "rice",
        "soup", "salad", "cake", "juice", "milk",
      ],
      center: Array.from({ length: 10 }, (_, i) => Math.sin(i + 3) * 2),
      category: 4,
    },
  ];

  const points: EmbeddingPoint[] = [];
  for (const cluster of clusters) {
    for (const word of cluster.words) {
      points.push({
        vector: generateClusteredVector(dim, cluster.center, 1.0, rng),
        label: word,
        category: cluster.category,
      });
    }
  }

  return { name: "Word Embeddings", points, dimensions: dim };
}

// -----------------------------------------------------------------
// MNIST Digits (100 samples, pre-reduced to 2D-like features)
// -----------------------------------------------------------------

export function createMNISTDigits(): Dataset {
  const rng = seededRandom(123);
  const dim = 28;
  const points: EmbeddingPoint[] = [];

  // Generate 10 samples for each digit (0-9)
  for (let digit = 0; digit < 10; digit++) {
    const angle = (digit / 10) * Math.PI * 2;
    const cx = Math.cos(angle) * 5;
    const cy = Math.sin(angle) * 5;
    const centerVec = Array.from(
      { length: dim },
      (_, i) => cx * Math.sin(i * 0.5) + cy * Math.cos(i * 0.3)
    );

    for (let s = 0; s < 10; s++) {
      points.push({
        vector: generateClusteredVector(dim, centerVec, 2.5, rng),
        label: `${digit}`,
        category: digit,
      });
    }
  }

  return { name: "MNIST Digits", points, dimensions: dim };
}

// -----------------------------------------------------------------
// Random Clusters (K Gaussian clusters in N-dim)
// -----------------------------------------------------------------

export function createRandomClusters(
  k: number = 5,
  pointsPerCluster: number = 30,
  dim: number = 20
): Dataset {
  const rng = seededRandom(7);
  const points: EmbeddingPoint[] = [];

  for (let c = 0; c < k; c++) {
    const center = Array.from({ length: dim }, () => (rng() - 0.5) * 10);
    for (let i = 0; i < pointsPerCluster; i++) {
      points.push({
        vector: generateClusteredVector(dim, center, 2.0, rng),
        label: `C${c}-${i}`,
        category: c,
      });
    }
  }

  return { name: "Random Clusters", points, dimensions: dim };
}

// -----------------------------------------------------------------
// Iris Dataset (4-dim, 150 points, 3 classes)
// Approximated with realistic distributions
// -----------------------------------------------------------------

export function createIrisDataset(): Dataset {
  const rng = seededRandom(99);
  const points: EmbeddingPoint[] = [];

  const species: {
    name: string;
    means: number[];
    stds: number[];
    category: number;
  }[] = [
    {
      name: "setosa",
      means: [5.0, 3.4, 1.5, 0.2],
      stds: [0.35, 0.38, 0.17, 0.1],
      category: 0,
    },
    {
      name: "versicolor",
      means: [5.9, 2.8, 4.3, 1.3],
      stds: [0.52, 0.31, 0.47, 0.2],
      category: 1,
    },
    {
      name: "virginica",
      means: [6.6, 3.0, 5.6, 2.0],
      stds: [0.64, 0.32, 0.55, 0.27],
      category: 2,
    },
  ];

  for (const sp of species) {
    for (let i = 0; i < 50; i++) {
      const vector = sp.means.map(
        (m, j) => m + (rng() - 0.5) * 2 * sp.stds[j]
      );
      points.push({
        vector,
        label: `${sp.name}-${i + 1}`,
        category: sp.category,
      });
    }
  }

  return { name: "Iris", points, dimensions: 4 };
}

// -----------------------------------------------------------------
// Parse user CSV/TSV data
// -----------------------------------------------------------------

export function parseEmbeddingData(text: string): Dataset | null {
  const lines = text.trim().split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;

  const points: EmbeddingPoint[] = [];
  let dim = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Detect separator: tab, comma, or space
    const sep = line.includes("\t") ? "\t" : line.includes(",") ? "," : /\s+/;
    const parts = line.split(sep).map((s) => s.trim());

    // Check if last column is a label (non-numeric)
    const lastPart = parts[parts.length - 1];
    const lastIsLabel = isNaN(Number(lastPart));

    const numericParts = lastIsLabel ? parts.slice(0, -1) : parts;
    const values = numericParts.map(Number);

    if (values.some(isNaN)) continue;

    if (dim === 0) {
      dim = values.length;
    } else if (values.length !== dim) {
      continue; // Skip inconsistent rows
    }

    points.push({
      vector: values,
      label: lastIsLabel ? lastPart : `point-${i}`,
      category: 0,
    });
  }

  if (points.length < 2 || dim < 2) return null;

  // Auto-assign categories based on unique labels
  const uniqueLabels = [...new Set(points.map((p) => p.label))];
  if (uniqueLabels.length <= 20) {
    for (const p of points) {
      p.category = uniqueLabels.indexOf(p.label);
    }
  }

  return { name: "Custom", points, dimensions: dim };
}

// -----------------------------------------------------------------
// Category labels for datasets
// -----------------------------------------------------------------

export const CATEGORY_LABELS: Record<string, string[]> = {
  "Word Embeddings": [
    "Animals",
    "Colors",
    "Actions",
    "Emotions",
    "Food",
  ],
  "MNIST Digits": ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
  "Random Clusters": ["C0", "C1", "C2", "C3", "C4"],
  Iris: ["Setosa", "Versicolor", "Virginica"],
};
