export const categoryMap: Record<string, string> = {
  // Machine Learning & AI
  "neural-network": "ml",
  "gradient-descent": "ml",
  "activation-functions": "ml",
  "loss-explorer": "ml",
  "convolution-viz": "ml",
  "diffusion-viz": "ml",
  "tokenizer": "ml",
  "embedding-explorer": "ml",
  "confusion-matrix": "ml",
  "decision-tree": "ml",
  "clustering": "ml",
  "genetic-algorithm": "ml",
  "mcmc-visualizer": "ml",
  "neuroevolution": "ml",
  "rl-playground": "ml",
  "word-embeddings": "ml",
  "attention-viz": "ml",
  "gan-playground": "ml",
  "backprop-viz": "ml",
  "gradient-boosting": "ml",
  "dim-reduction": "ml",
  "loss-landscape": "ml",
  "tokenizer-compare": "ml",

  // Mathematics & Statistics
  "fourier-viz": "math",
  "distributions": "math",
  "linear-algebra": "math",
  "bezier-editor": "math",
  "ab-test": "math",
  "markov-chain": "math",
  "voronoi": "math",
  "strange-attractors": "math",
  "epidemic-sim": "math",
  "mortgage-calc": "math",
  "investment-sim": "math",
  "compound-interest": "math",
  "supply-demand": "math",
  "amortization-race": "math",
  "evolution-trust": "math",
  "voting-systems": "math",
  "bayesian-inference": "math",
  "calculus-viz": "math",
  "complex-numbers": "math",
  "loopy": "math",
  "dice-lab": "math",
  "central-limit": "math",
  "hypothesis-testing": "math",
  "bootstrap-resampling": "math",
  "monte-carlo": "math",
  "glm-explorer": "math",
  "finance-sim": "math",

  // Algorithms & Data Structures
  "sorting-viz": "algo",
  "graph-algorithms": "algo",
  "data-structures": "algo",
  "pathfinding": "algo",
  "compression-viz": "algo",
  "l-system": "algo",
  "cellular-automata": "algo",

  // Computer Science Theory
  "turing-machine": "cs",
  "state-machine": "cs",
  "regex-automaton": "cs",
  "memory-allocator": "cs",
  "db-index-viz": "cs",
  "gc-visualizer": "cs",
  "cpu-pipeline": "cs",
  "process-scheduler": "cs",
  "page-replacement": "cs",
  "compiler-pipeline": "cs",
  "search-engine": "cs",

  // Graphics & Creative
  "shader-playground": "gfx",
  "ray-tracer": "gfx",
  "pixel-art": "gfx",
  "perlin-noise": "gfx",
  "color-palette": "gfx",
  "fractal-explorer": "gfx",
  "flow-field": "gfx",
  "tessellation": "gfx",
  "lissajous": "gfx",
  "spirograph": "gfx",

  // Developer Tools
  "regex-tester": "dev",
  "json-validator": "dev",
  "jwt-decoder": "dev",
  "cron-parser": "dev",
  "diff-viewer": "dev",
  "hash-generator": "dev",
  "timestamp": "dev",
  "base-converter": "dev",
  "qr-generator": "dev",
  "sql-playground": "dev",
  "mermaid-viz": "dev",
  "markdown-preview": "dev",
  "json-visualizer": "dev",
  "git-viz": "dev",

  // Audio & Music
  "audio-visualizer": "audio",
  "music-theory": "audio",

  // Python
  "python-repl": "python",
  "python-tutor": "python",

  // Systems & Networking
  "network-protocols": "systems",
  "blockchain": "systems",
  "physics-sandbox": "systems",
  "fluid-sim": "systems",
  "wave-sim": "systems",
  "particle-life": "systems",
  "boids": "systems",
  "reaction-diffusion": "systems",
  "orbital-mechanics": "systems",
  "cloth-sim": "systems",
  "em-field": "systems",
  "optics-bench": "systems",
  "entropy-demon": "systems",
  "pendulum-lab": "systems",
  "segregation-sim": "systems",
  "dns-resolver": "systems",
  "tcp-viz": "systems",

  // Life & Personal Tools
  "tax-sim": "life",
  "nutrition-planner": "life",
  "career-model": "life",
  "decision-matrix": "life",
  "investment-compare": "life",
  "housing-sim": "life",
  "sleep-optimizer": "life",
  "habit-tracker": "life",
  "argument-analyzer": "life",
  "life-tradeoff": "life",
  "total-comp": "life",
};

// ─── Subcategory mapping ─────────────────────────────────────────────
export const subcategoryMap: Record<string, string> = {
  // ML & AI
  "neural-network": "neural-nets", "activation-functions": "neural-nets", "backprop-viz": "neural-nets",
  "loss-explorer": "neural-nets", "loss-landscape": "neural-nets", "convolution-viz": "neural-nets",
  "tokenizer": "nlp", "tokenizer-compare": "nlp", "word-embeddings": "nlp",
  "attention-viz": "nlp", "embedding-explorer": "nlp",
  "gradient-descent": "optimization", "genetic-algorithm": "optimization",
  "neuroevolution": "optimization", "rl-playground": "optimization",
  "gan-playground": "generative", "diffusion-viz": "generative",
  "decision-tree": "classical-ml", "clustering": "classical-ml", "confusion-matrix": "classical-ml",
  "mcmc-visualizer": "classical-ml", "gradient-boosting": "classical-ml", "dim-reduction": "classical-ml",

  // Math & Statistics
  "distributions": "probability", "ab-test": "probability", "bayesian-inference": "probability",
  "hypothesis-testing": "probability", "bootstrap-resampling": "probability", "central-limit": "probability",
  "monte-carlo": "probability", "dice-lab": "probability", "glm-explorer": "probability",
  "markov-chain": "probability", "mcmc-visualizer": "probability",
  "mortgage-calc": "finance", "investment-sim": "finance", "compound-interest": "finance",
  "supply-demand": "finance", "amortization-race": "finance", "finance-sim": "finance",
  "fourier-viz": "analysis", "calculus-viz": "analysis", "complex-numbers": "analysis",
  "linear-algebra": "geometry", "bezier-editor": "geometry", "voronoi": "geometry",
  "strange-attractors": "geometry",
  "evolution-trust": "game-theory", "voting-systems": "game-theory", "epidemic-sim": "game-theory",
  "loopy": "game-theory",

  // CS Theory
  "turing-machine": "automata", "state-machine": "automata", "regex-automaton": "automata",
  "memory-allocator": "os-memory", "gc-visualizer": "os-memory", "cpu-pipeline": "os-memory",
  "process-scheduler": "os-memory", "page-replacement": "os-memory",
  "db-index-viz": "cs-other", "compiler-pipeline": "cs-other", "search-engine": "cs-other",

  // Graphics
  "perlin-noise": "procedural", "flow-field": "procedural", "tessellation": "procedural",
  "lissajous": "procedural", "spirograph": "procedural",
  "shader-playground": "rendering", "ray-tracer": "rendering", "fractal-explorer": "rendering",
  "pixel-art": "gfx-tools", "color-palette": "gfx-tools",

  // Dev Tools
  "json-validator": "data-text", "json-visualizer": "data-text", "diff-viewer": "data-text",
  "markdown-preview": "data-text", "mermaid-viz": "data-text",
  "jwt-decoder": "encoding", "hash-generator": "encoding", "base-converter": "encoding",
  "qr-generator": "encoding",
  "regex-tester": "dev-other", "cron-parser": "dev-other", "timestamp": "dev-other",
  "sql-playground": "dev-other", "git-viz": "dev-other",

  // Systems & Networking
  "physics-sandbox": "physics", "fluid-sim": "physics", "wave-sim": "physics",
  "orbital-mechanics": "physics", "cloth-sim": "physics", "em-field": "physics",
  "optics-bench": "physics", "entropy-demon": "physics", "pendulum-lab": "physics",
  "network-protocols": "networking", "dns-resolver": "networking", "tcp-viz": "networking",
  "blockchain": "networking",
  "particle-life": "emergence", "boids": "emergence", "reaction-diffusion": "emergence",
  "segregation-sim": "emergence",

  // Life & Personal
  "tax-sim": "life-finance", "investment-compare": "life-finance", "housing-sim": "life-finance",
  "nutrition-planner": "health", "sleep-optimizer": "health",
  "career-model": "career", "total-comp": "career",
  "decision-matrix": "thinking", "argument-analyzer": "thinking",
  "life-tradeoff": "thinking", "habit-tracker": "thinking",
};

export interface SubcategoryMeta {
  key: string;
  label: string;
  categoryKey: string;
}

export const subcategories: SubcategoryMeta[] = [
  // ML & AI
  { key: "neural-nets", label: "Neural Networks", categoryKey: "ml" },
  { key: "nlp", label: "NLP & Language", categoryKey: "ml" },
  { key: "optimization", label: "Optimization", categoryKey: "ml" },
  { key: "generative", label: "Generative Models", categoryKey: "ml" },
  { key: "classical-ml", label: "Classical ML", categoryKey: "ml" },

  // Math
  { key: "probability", label: "Probability & Stats", categoryKey: "math" },
  { key: "finance", label: "Finance & Economics", categoryKey: "math" },
  { key: "analysis", label: "Analysis & Calculus", categoryKey: "math" },
  { key: "geometry", label: "Geometry & Algebra", categoryKey: "math" },
  { key: "game-theory", label: "Game Theory", categoryKey: "math" },

  // CS
  { key: "automata", label: "Automata", categoryKey: "cs" },
  { key: "os-memory", label: "OS & Memory", categoryKey: "cs" },
  { key: "cs-other", label: "Other", categoryKey: "cs" },

  // Graphics
  { key: "procedural", label: "Procedural", categoryKey: "gfx" },
  { key: "rendering", label: "Rendering", categoryKey: "gfx" },
  { key: "gfx-tools", label: "Tools", categoryKey: "gfx" },

  // Dev
  { key: "data-text", label: "Data & Text", categoryKey: "dev" },
  { key: "encoding", label: "Encoding & Security", categoryKey: "dev" },
  { key: "dev-other", label: "Other", categoryKey: "dev" },

  // Systems
  { key: "physics", label: "Physics", categoryKey: "systems" },
  { key: "networking", label: "Networking", categoryKey: "systems" },
  { key: "emergence", label: "Emergence", categoryKey: "systems" },

  // Life
  { key: "life-finance", label: "Finance", categoryKey: "life" },
  { key: "health", label: "Health", categoryKey: "life" },
  { key: "career", label: "Career", categoryKey: "life" },
  { key: "thinking", label: "Decision-Making", categoryKey: "life" },
];

export interface CategoryMeta {
  key: string;
  label: string;
  icon: string;
  description: string;
}

export const categories: CategoryMeta[] = [
  { key: "ml", label: "Machine Learning & AI", icon: "brain", description: "Neural networks, optimization, embeddings, and generative models" },
  { key: "math", label: "Mathematics & Statistics", icon: "sigma", description: "Fourier, probability, linear algebra, and statistical testing" },
  { key: "algo", label: "Algorithms & Data Structures", icon: "flow", description: "Sorting, pathfinding, graphs, compression, and fractals" },
  { key: "cs", label: "Computer Science Theory", icon: "cpu", description: "Turing machines, automata, state machines, and memory" },
  { key: "gfx", label: "Graphics & Creative", icon: "palette", description: "Shaders, ray tracing, pixel art, and procedural generation" },
  { key: "dev", label: "Developer Tools", icon: "wrench", description: "Regex, JSON, JWT, SQL, hashing, and encoding utilities" },
  { key: "audio", label: "Audio & Music", icon: "music", description: "Audio analysis, music theory, and Web Audio experiments" },
  { key: "python", label: "Python", icon: "python", description: "Browser-based Python REPL and code execution visualizer" },
  { key: "systems", label: "Systems & Networking", icon: "globe", description: "Network protocols, blockchain, and physics simulation" },
  { key: "life", label: "Life & Personal", icon: "heart", description: "Tax, career, nutrition, sleep, habits, and decision-making tools" },
];
