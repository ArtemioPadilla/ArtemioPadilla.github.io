import { useState, useEffect, useRef, useCallback } from "preact/hooks";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  species: number;
}

interface SimParams {
  particleCount: number;
  speciesCount: number;
  forceRange: number;
  friction: number;
  speed: number;
  trails: boolean;
}

interface Preset {
  name: string;
  description: string;
  speciesCount: number;
  matrix: number[][];
}

type PlayState = "running" | "paused";

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const SPECIES_COLORS = [
  "#ef4444", // red
  "#22c55e", // green
  "#3b82f6", // blue
  "#eab308", // yellow
  "#06b6d4", // cyan
  "#d946ef", // magenta
];

const SPECIES_LABELS = ["Red", "Green", "Blue", "Yellow", "Cyan", "Magenta"];

const MIN_PARTICLES = 200;
const MAX_PARTICLES = 2000;
const MIN_SPECIES = 2;
const MAX_SPECIES = 6;
const MIN_FORCE_RANGE = 30;
const MAX_FORCE_RANGE = 200;
const MIN_FRICTION = 0.01;
const MAX_FRICTION = 0.5;
const MIN_SPEED = 0.1;
const MAX_SPEED = 3.0;
const PARTICLE_RADIUS = 2;
const FORCE_PEAK_RATIO = 0.5;
const TRAIL_ALPHA = 0.08;

const DEFAULT_PARAMS: SimParams = {
  particleCount: 600,
  speciesCount: 4,
  forceRange: 80,
  friction: 0.1,
  speed: 1.0,
  trails: false,
};

// ─────────────────────────────────────────────────────────
// Presets
// ─────────────────────────────────────────────────────────

const PRESETS: Preset[] = [
  {
    name: "Clusters",
    description: "Like attracts like, others repel",
    speciesCount: 4,
    matrix: [
      [ 1.0, -0.5, -0.5, -0.5],
      [-0.5,  1.0, -0.5, -0.5],
      [-0.5, -0.5,  1.0, -0.5],
      [-0.5, -0.5, -0.5,  1.0],
    ],
  },
  {
    name: "Chains",
    description: "A attracts B attracts C attracts A",
    speciesCount: 4,
    matrix: [
      [ 0.0,  0.8, -0.3,  0.0],
      [ 0.0,  0.0,  0.8, -0.3],
      [-0.3,  0.0,  0.0,  0.8],
      [ 0.8, -0.3,  0.0,  0.0],
    ],
  },
  {
    name: "Predator-Prey",
    description: "Asymmetric forces create chase dynamics",
    speciesCount: 3,
    matrix: [
      [ 0.2,  0.7, -0.9],
      [-0.9,  0.2,  0.7],
      [ 0.7, -0.9,  0.2],
    ],
  },
  {
    name: "Chaos",
    description: "Randomized matrix for unpredictable behavior",
    speciesCount: 5,
    matrix: generateRandomMatrix(5),
  },
  {
    name: "Symbiosis",
    description: "Mutual attraction between pairs",
    speciesCount: 6,
    matrix: [
      [ 0.0,  0.8,  0.0, -0.3,  0.0,  0.0],
      [ 0.8,  0.0,  0.0,  0.0, -0.3,  0.0],
      [ 0.0,  0.0,  0.0,  0.8,  0.0, -0.3],
      [-0.3,  0.0,  0.8,  0.0,  0.0,  0.0],
      [ 0.0, -0.3,  0.0,  0.0,  0.0,  0.8],
      [ 0.0,  0.0, -0.3,  0.0,  0.8,  0.0],
    ],
  },
];

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function generateRandomMatrix(n: number): number[][] {
  const m: number[][] = [];
  for (let i = 0; i < n; i++) {
    m[i] = [];
    for (let j = 0; j < n; j++) {
      m[i][j] = Math.round((Math.random() * 2 - 1) * 100) / 100;
    }
  }
  return m;
}

function createParticles(
  count: number,
  speciesCount: number,
  width: number,
  height: number,
): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: 0,
      vy: 0,
      species: i % speciesCount,
    });
  }
  return particles;
}

function resizeMatrix(
  oldMatrix: number[][],
  newSize: number,
): number[][] {
  const m: number[][] = [];
  for (let i = 0; i < newSize; i++) {
    m[i] = [];
    for (let j = 0; j < newSize; j++) {
      if (i < oldMatrix.length && j < (oldMatrix[i]?.length ?? 0)) {
        m[i][j] = oldMatrix[i][j];
      } else {
        m[i][j] = Math.round((Math.random() * 2 - 1) * 100) / 100;
      }
    }
  }
  return m;
}

function forceMagnitude(
  distance: number,
  forceRange: number,
): number {
  if (distance <= 0 || distance >= forceRange) return 0;
  const peak = forceRange * FORCE_PEAK_RATIO;
  if (distance < peak) {
    return distance / peak;
  }
  return 1 - (distance - peak) / (forceRange - peak);
}

// ─────────────────────────────────────────────────────────
// Spatial Grid for O(n) neighbor lookup
// ─────────────────────────────────────────────────────────

interface SpatialGrid {
  cells: Map<number, number[]>;
  cellSize: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
}

function createSpatialGrid(
  width: number,
  height: number,
  cellSize: number,
): SpatialGrid {
  return {
    cells: new Map(),
    cellSize,
    cols: Math.ceil(width / cellSize),
    rows: Math.ceil(height / cellSize),
    width,
    height,
  };
}

function populateGrid(
  grid: SpatialGrid,
  particles: Particle[],
): void {
  grid.cells.clear();
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const col = Math.floor(p.x / grid.cellSize) % grid.cols;
    const row = Math.floor(p.y / grid.cellSize) % grid.rows;
    const key = row * grid.cols + col;
    const cell = grid.cells.get(key);
    if (cell) {
      cell.push(i);
    } else {
      grid.cells.set(key, [i]);
    }
  }
}

function getNeighborIndices(
  grid: SpatialGrid,
  x: number,
  y: number,
): number[] {
  const col = Math.floor(x / grid.cellSize) % grid.cols;
  const row = Math.floor(y / grid.cellSize) % grid.rows;
  const result: number[] = [];

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = ((row + dr) % grid.rows + grid.rows) % grid.rows;
      const c = ((col + dc) % grid.cols + grid.cols) % grid.cols;
      const key = r * grid.cols + c;
      const cell = grid.cells.get(key);
      if (cell) {
        for (let k = 0; k < cell.length; k++) {
          result.push(cell[k]);
        }
      }
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────
// Physics Step
// ─────────────────────────────────────────────────────────

function stepSimulation(
  particles: Particle[],
  matrix: number[][],
  params: SimParams,
  width: number,
  height: number,
  grid: SpatialGrid,
): void {
  const { forceRange, friction, speed } = params;
  const dt = speed;
  const halfW = width / 2;
  const halfH = height / 2;

  populateGrid(grid, particles);

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    let fx = 0;
    let fy = 0;

    const neighbors = getNeighborIndices(grid, p.x, p.y);

    for (let ni = 0; ni < neighbors.length; ni++) {
      const j = neighbors[ni];
      if (j === i) continue;
      const q = particles[j];

      let dx = q.x - p.x;
      let dy = q.y - p.y;

      // Wrap-around shortest distance
      if (dx > halfW) dx -= width;
      else if (dx < -halfW) dx += width;
      if (dy > halfH) dy -= height;
      else if (dy < -halfH) dy += height;

      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist === 0 || dist >= forceRange) continue;

      const attraction = matrix[p.species]?.[q.species] ?? 0;
      const f = attraction * forceMagnitude(dist, forceRange);

      fx += (dx / dist) * f;
      fy += (dy / dist) * f;
    }

    p.vx = (p.vx + fx * dt) * (1 - friction);
    p.vy = (p.vy + fy * dt) * (1 - friction);
  }

  // Update positions with wrap-around
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    p.x = ((p.x + p.vx * dt) % width + width) % width;
    p.y = ((p.y + p.vy * dt) % height + height) % height;
  }
}

// ─────────────────────────────────────────────────────────
// Matrix Cell Component
// ─────────────────────────────────────────────────────────

function MatrixCell({
  value,
  rowIdx,
  colIdx,
  onChange,
}: {
  value: number;
  rowIdx: number;
  colIdx: number;
  onChange: (r: number, c: number, v: number) => void;
}) {
  const bg = value > 0
    ? `rgba(34,197,94,${Math.abs(value) * 0.6})`
    : value < 0
      ? `rgba(239,68,68,${Math.abs(value) * 0.6})`
      : "transparent";

  const handleClick = useCallback(() => {
    // Cycle: 0 -> 0.5 -> 1 -> -0.5 -> -1 -> 0
    let next: number;
    if (value < -0.75) next = 0;
    else if (value < -0.25) next = -1;
    else if (value < 0.25) next = 0.5;
    else if (value < 0.75) next = 1;
    else next = -0.5;
    onChange(rowIdx, colIdx, next);
  }, [value, rowIdx, colIdx, onChange]);

  const handleContextMenu = useCallback((e: Event) => {
    e.preventDefault();
    // Right-click cycles backward
    let next: number;
    if (value > 0.75) next = 0.5;
    else if (value > 0.25) next = 0;
    else if (value > -0.25) next = -0.5;
    else if (value > -0.75) next = -1;
    else next = 1;
    onChange(rowIdx, colIdx, next);
  }, [value, rowIdx, colIdx, onChange]);

  return (
    <button
      class="flex h-8 w-8 items-center justify-center rounded text-[10px] font-mono font-bold transition-colors"
      style={{ background: bg, color: value === 0 ? "var(--color-text-muted)" : "#fff" }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      title={`${SPECIES_LABELS[rowIdx]} -> ${SPECIES_LABELS[colIdx]}: ${value.toFixed(1)}`}
      type="button"
    >
      {value.toFixed(1)}
    </button>
  );
}

// ─────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────

export default function ParticleLife() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const gridRef = useRef<SpatialGrid | null>(null);
  const animRef = useRef<number>(0);
  const paramsRef = useRef<SimParams>({ ...DEFAULT_PARAMS });
  const matrixRef = useRef<number[][]>(PRESETS[0].matrix.map((r) => [...r]));

  const [params, setParams] = useState<SimParams>({ ...DEFAULT_PARAMS });
  const [matrix, setMatrix] = useState<number[][]>(PRESETS[0].matrix.map((r) => [...r]));
  const [playState, setPlayState] = useState<PlayState>("running");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 500 });
  const [showMatrix, setShowMatrix] = useState(true);

  // Keep refs in sync
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  useEffect(() => {
    matrixRef.current = matrix;
  }, [matrix]);

  // ─── Canvas sizing ──────────────────────────────────────

  const measureCanvas = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const w = Math.floor(rect.width);
    const h = isFullscreen ? Math.floor(window.innerHeight - 60) : Math.min(Math.floor(w * 0.625), 600);
    setCanvasSize({ w, h });
    return { w, h };
  }, [isFullscreen]);

  useEffect(() => {
    const size = measureCanvas();
    if (size) {
      initParticles(size.w, size.h);
    }
    const handleResize = () => {
      const s = measureCanvas();
      if (s) {
        reinitGridForSize(s.w, s.h);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isFullscreen]);

  // ─── Initialization ────────────────────────────────────

  const initParticles = useCallback((w: number, h: number) => {
    const p = paramsRef.current;
    particlesRef.current = createParticles(p.particleCount, p.speciesCount, w, h);
    gridRef.current = createSpatialGrid(w, h, p.forceRange);
  }, []);

  const reinitGridForSize = useCallback((w: number, h: number) => {
    const p = paramsRef.current;
    gridRef.current = createSpatialGrid(w, h, p.forceRange);
    // Remap particles to new bounds
    for (const pt of particlesRef.current) {
      pt.x = pt.x % w;
      pt.y = pt.y % h;
    }
  }, []);

  // ─── Animation Loop ────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let running = true;

    const animate = () => {
      if (!running) return;

      const p = paramsRef.current;
      const m = matrixRef.current;
      const particles = particlesRef.current;
      const w = canvas.width;
      const h = canvas.height;

      if (playState === "running" && particles.length > 0) {
        let grid = gridRef.current;
        if (!grid || grid.width !== w || grid.height !== h) {
          grid = createSpatialGrid(w, h, p.forceRange);
          gridRef.current = grid;
        }
        if (grid.cellSize !== p.forceRange) {
          grid = createSpatialGrid(w, h, p.forceRange);
          gridRef.current = grid;
        }
        stepSimulation(particles, m, p, w, h, grid);
      }

      // Render
      if (p.trails) {
        ctx.fillStyle = `rgba(9,9,11,${TRAIL_ALPHA})`;
        ctx.fillRect(0, 0, w, h);
      } else {
        ctx.clearRect(0, 0, w, h);
        // Fill with bg
        const bgColor = getComputedStyle(canvas).getPropertyValue("--color-bg").trim() || "#09090b";
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, w, h);
      }

      // Draw particles
      for (let i = 0; i < particles.length; i++) {
        const pt = particles[i];
        ctx.fillStyle = SPECIES_COLORS[pt.species] ?? SPECIES_COLORS[0];
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, PARTICLE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);

    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
    };
  }, [playState, canvasSize]);

  // ─── Controls ──────────────────────────────────────────

  const handleParamChange = useCallback((key: keyof SimParams, value: number | boolean) => {
    setParams((prev) => {
      const next = { ...prev, [key]: value };

      if (key === "speciesCount") {
        const newCount = value as number;
        setMatrix((oldM) => {
          const resized = resizeMatrix(oldM, newCount);
          matrixRef.current = resized;
          return resized;
        });
        // Reassign species
        const particles = particlesRef.current;
        for (let i = 0; i < particles.length; i++) {
          particles[i].species = particles[i].species % newCount;
        }
      }

      return next;
    });
  }, []);

  const handleMatrixChange = useCallback((r: number, c: number, v: number) => {
    setMatrix((prev) => {
      const next = prev.map((row) => [...row]);
      next[r][c] = v;
      return next;
    });
  }, []);

  const handleRandomizeMatrix = useCallback(() => {
    const n = paramsRef.current.speciesCount;
    const m = generateRandomMatrix(n);
    setMatrix(m);
    matrixRef.current = m;
  }, []);

  const handleRandomizePositions = useCallback(() => {
    const { w, h } = canvasSize;
    const p = paramsRef.current;
    particlesRef.current = createParticles(p.particleCount, p.speciesCount, w, h);
  }, [canvasSize]);

  const handleApplyPreset = useCallback((preset: Preset) => {
    const newMatrix = preset.matrix.map((r) => [...r]);
    setMatrix(newMatrix);
    matrixRef.current = newMatrix;
    setParams((prev) => {
      const next = { ...prev, speciesCount: preset.speciesCount };
      paramsRef.current = next;
      return next;
    });
    // Reassign species
    const particles = particlesRef.current;
    for (let i = 0; i < particles.length; i++) {
      particles[i].species = particles[i].species % preset.speciesCount;
    }
  }, []);

  const handleResetParticles = useCallback(() => {
    const { w, h } = canvasSize;
    const p = paramsRef.current;
    particlesRef.current = createParticles(p.particleCount, p.speciesCount, w, h);
    gridRef.current = createSpatialGrid(w, h, p.forceRange);
  }, [canvasSize]);

  const handleChangeParticleCount = useCallback((count: number) => {
    const current = particlesRef.current;
    const p = paramsRef.current;
    const { w, h } = canvasSize;

    if (count > current.length) {
      // Add particles
      for (let i = current.length; i < count; i++) {
        current.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: 0,
          vy: 0,
          species: i % p.speciesCount,
        });
      }
    } else if (count < current.length) {
      current.length = count;
    }

    handleParamChange("particleCount", count);
  }, [canvasSize, handleParamChange]);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  // ─── Render ────────────────────────────────────────────

  const btnClass = "rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]";
  const activeBtnClass = "rounded border border-[var(--color-primary)] bg-[var(--color-primary)]/10 px-3 py-1.5 text-xs font-medium text-[var(--color-primary)]";

  return (
    <div class={isFullscreen ? "fixed inset-0 z-50 flex flex-col bg-[var(--color-bg)]" : ""}>
      {/* Toolbar */}
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <button
          class={playState === "running" ? activeBtnClass : btnClass}
          onClick={() => setPlayState((s) => (s === "running" ? "paused" : "running"))}
          type="button"
        >
          {playState === "running" ? "Pause" : "Play"}
        </button>

        <button class={btnClass} onClick={handleResetParticles} type="button">
          Reset
        </button>

        <button class={btnClass} onClick={handleRandomizePositions} type="button">
          Scatter
        </button>

        <button class={btnClass} onClick={handleRandomizeMatrix} type="button">
          Random Rules
        </button>

        <button
          class={btnClass}
          onClick={() => setShowMatrix((s) => !s)}
          type="button"
        >
          {showMatrix ? "Hide Matrix" : "Show Matrix"}
        </button>

        <button class={btnClass} onClick={toggleFullscreen} type="button">
          {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
        </button>
      </div>

      {/* Presets */}
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <span class="text-xs font-semibold text-[var(--color-text-muted)]">Presets:</span>
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            class={btnClass}
            onClick={() => handleApplyPreset(preset)}
            title={preset.description}
            type="button"
          >
            {preset.name}
          </button>
        ))}
      </div>

      <div class="flex flex-col gap-4 lg:flex-row">
        {/* Canvas */}
        <div class="flex-1" ref={containerRef}>
          <canvas
            ref={canvasRef}
            width={canvasSize.w}
            height={canvasSize.h}
            class="w-full rounded-lg border border-[var(--color-border)]"
            style={{ imageRendering: "auto" }}
          />
        </div>

        {/* Side Panel */}
        <div class="w-full shrink-0 space-y-4 lg:w-72">
          {/* Interaction Matrix */}
          {showMatrix && (
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-heading)]">
                Interaction Matrix
              </h3>
              <p class="mb-2 text-[10px] text-[var(--color-text-muted)]">
                Click to cycle values. Right-click to reverse. Row acts on column.
              </p>
              <div class="overflow-x-auto">
                <table class="border-collapse">
                  <thead>
                    <tr>
                      <th class="h-8 w-8" />
                      {Array.from({ length: params.speciesCount }, (_, i) => (
                        <th key={i} class="h-8 w-8 text-center">
                          <div
                            class="mx-auto h-3 w-3 rounded-full"
                            style={{ background: SPECIES_COLORS[i] }}
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: params.speciesCount }, (_, r) => (
                      <tr key={r}>
                        <td class="h-8 w-8 text-center">
                          <div
                            class="mx-auto h-3 w-3 rounded-full"
                            style={{ background: SPECIES_COLORS[r] }}
                          />
                        </td>
                        {Array.from({ length: params.speciesCount }, (_, c) => (
                          <td key={c} class="p-0.5">
                            <MatrixCell
                              value={matrix[r]?.[c] ?? 0}
                              rowIdx={r}
                              colIdx={c}
                              onChange={handleMatrixChange}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Parameters */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <h3 class="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-heading)]">
              Parameters
            </h3>

            <div class="space-y-3">
              {/* Particle Count */}
              <label class="block">
                <span class="flex items-center justify-between text-[11px] text-[var(--color-text-muted)]">
                  <span>Particles</span>
                  <span class="font-mono">{params.particleCount}</span>
                </span>
                <input
                  type="range"
                  min={MIN_PARTICLES}
                  max={MAX_PARTICLES}
                  step={50}
                  value={params.particleCount}
                  onInput={(e) =>
                    handleChangeParticleCount(
                      parseInt((e.target as HTMLInputElement).value, 10),
                    )
                  }
                  class="mt-1 w-full accent-[var(--color-primary)]"
                />
              </label>

              {/* Species Count */}
              <label class="block">
                <span class="flex items-center justify-between text-[11px] text-[var(--color-text-muted)]">
                  <span>Species</span>
                  <span class="font-mono">{params.speciesCount}</span>
                </span>
                <input
                  type="range"
                  min={MIN_SPECIES}
                  max={MAX_SPECIES}
                  step={1}
                  value={params.speciesCount}
                  onInput={(e) =>
                    handleParamChange(
                      "speciesCount",
                      parseInt((e.target as HTMLInputElement).value, 10),
                    )
                  }
                  class="mt-1 w-full accent-[var(--color-primary)]"
                />
              </label>

              {/* Force Range */}
              <label class="block">
                <span class="flex items-center justify-between text-[11px] text-[var(--color-text-muted)]">
                  <span>Force Range</span>
                  <span class="font-mono">{params.forceRange}px</span>
                </span>
                <input
                  type="range"
                  min={MIN_FORCE_RANGE}
                  max={MAX_FORCE_RANGE}
                  step={5}
                  value={params.forceRange}
                  onInput={(e) =>
                    handleParamChange(
                      "forceRange",
                      parseInt((e.target as HTMLInputElement).value, 10),
                    )
                  }
                  class="mt-1 w-full accent-[var(--color-primary)]"
                />
              </label>

              {/* Friction */}
              <label class="block">
                <span class="flex items-center justify-between text-[11px] text-[var(--color-text-muted)]">
                  <span>Friction</span>
                  <span class="font-mono">{params.friction.toFixed(2)}</span>
                </span>
                <input
                  type="range"
                  min={MIN_FRICTION}
                  max={MAX_FRICTION}
                  step={0.01}
                  value={params.friction}
                  onInput={(e) =>
                    handleParamChange(
                      "friction",
                      parseFloat((e.target as HTMLInputElement).value),
                    )
                  }
                  class="mt-1 w-full accent-[var(--color-primary)]"
                />
              </label>

              {/* Speed */}
              <label class="block">
                <span class="flex items-center justify-between text-[11px] text-[var(--color-text-muted)]">
                  <span>Speed</span>
                  <span class="font-mono">{params.speed.toFixed(1)}x</span>
                </span>
                <input
                  type="range"
                  min={MIN_SPEED}
                  max={MAX_SPEED}
                  step={0.1}
                  value={params.speed}
                  onInput={(e) =>
                    handleParamChange(
                      "speed",
                      parseFloat((e.target as HTMLInputElement).value),
                    )
                  }
                  class="mt-1 w-full accent-[var(--color-primary)]"
                />
              </label>

              {/* Trails */}
              <label class="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={params.trails}
                  onChange={(e) =>
                    handleParamChange("trails", (e.target as HTMLInputElement).checked)
                  }
                  class="accent-[var(--color-primary)]"
                />
                <span class="text-[11px] text-[var(--color-text-muted)]">Trails</span>
              </label>
            </div>
          </div>

          {/* Legend */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-heading)]">
              Species
            </h3>
            <div class="flex flex-wrap gap-3">
              {Array.from({ length: params.speciesCount }, (_, i) => (
                <div key={i} class="flex items-center gap-1.5">
                  <div
                    class="h-3 w-3 rounded-full"
                    style={{ background: SPECIES_COLORS[i] }}
                  />
                  <span class="text-[11px] text-[var(--color-text-muted)]">
                    {SPECIES_LABELS[i]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
