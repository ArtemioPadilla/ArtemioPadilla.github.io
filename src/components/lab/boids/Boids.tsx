import { useState, useEffect, useRef, useCallback } from "preact/hooks";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

interface Vec2 {
  x: number;
  y: number;
}

interface Boid {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Predator {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Obstacle {
  x: number;
  y: number;
  radius: number;
}

interface BoidParams {
  separationWeight: number;
  alignmentWeight: number;
  cohesionWeight: number;
  perceptionRadius: number;
  maxSpeed: number;
  maxForce: number;
  boidCount: number;
  wrapBoundary: boolean;
  showTrails: boolean;
  showPerception: boolean;
  showVelocity: boolean;
  speedColoring: boolean;
}

interface Preset {
  name: string;
  params: Partial<BoidParams>;
  spawnPredator: boolean;
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const DEFAULT_PARAMS: BoidParams = {
  separationWeight: 1.5,
  alignmentWeight: 1.0,
  cohesionWeight: 1.0,
  perceptionRadius: 50,
  maxSpeed: 4,
  maxForce: 0.2,
  boidCount: 200,
  wrapBoundary: true,
  showTrails: false,
  showPerception: false,
  showVelocity: false,
  speedColoring: true,
};

const PRESETS: Preset[] = [
  {
    name: "Classic Flock",
    params: {
      separationWeight: 1.5,
      alignmentWeight: 1.0,
      cohesionWeight: 1.0,
      perceptionRadius: 50,
      maxSpeed: 4,
      maxForce: 0.2,
      boidCount: 200,
    },
    spawnPredator: false,
  },
  {
    name: "Tight Swarm",
    params: {
      separationWeight: 0.8,
      alignmentWeight: 0.6,
      cohesionWeight: 3.5,
      perceptionRadius: 80,
      maxSpeed: 3,
      maxForce: 0.15,
      boidCount: 250,
    },
    spawnPredator: false,
  },
  {
    name: "Scatter",
    params: {
      separationWeight: 4.0,
      alignmentWeight: 0.3,
      cohesionWeight: 0.2,
      perceptionRadius: 60,
      maxSpeed: 5,
      maxForce: 0.3,
      boidCount: 150,
    },
    spawnPredator: false,
  },
  {
    name: "Murmuration",
    params: {
      separationWeight: 1.2,
      alignmentWeight: 2.5,
      cohesionWeight: 1.8,
      perceptionRadius: 40,
      maxSpeed: 5,
      maxForce: 0.25,
      boidCount: 400,
    },
    spawnPredator: false,
  },
  {
    name: "Predator Chase",
    params: {
      separationWeight: 1.5,
      alignmentWeight: 1.0,
      cohesionWeight: 1.2,
      perceptionRadius: 50,
      maxSpeed: 4,
      maxForce: 0.2,
      boidCount: 200,
    },
    spawnPredator: true,
  },
];

const BOID_SIZE = 6;
const PREDATOR_SIZE = 10;
const PREDATOR_SPEED = 3.5;
const PREDATOR_PERCEPTION = 200;
const OBSTACLE_AVOIDANCE_DIST = 40;
const FLEE_RADIUS = 120;
const TRAIL_ALPHA = 0.08;
const WIND_STRENGTH = 0.05;

// ─────────────────────────────────────────────────────────
// Vector helpers
// ─────────────────────────────────────────────────────────

function vecAdd(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

function vecSub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function vecScale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

function vecMag(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

function vecNormalize(v: Vec2): Vec2 {
  const m = vecMag(v);
  if (m === 0) return { x: 0, y: 0 };
  return { x: v.x / m, y: v.y / m };
}

function vecLimit(v: Vec2, max: number): Vec2 {
  const m = vecMag(v);
  if (m <= max) return v;
  return vecScale(vecNormalize(v), max);
}

function vecDist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ─────────────────────────────────────────────────────────
// Boid simulation logic
// ─────────────────────────────────────────────────────────

function createBoid(w: number, h: number): Boid {
  const angle = Math.random() * Math.PI * 2;
  const speed = 1 + Math.random() * 2;
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
  };
}

function createPredator(x: number, y: number): Predator {
  const angle = Math.random() * Math.PI * 2;
  return { x, y, vx: Math.cos(angle) * 2, vy: Math.sin(angle) * 2 };
}

function separation(
  boid: Boid,
  neighbors: Boid[],
  radius: number,
): Vec2 {
  let steer: Vec2 = { x: 0, y: 0 };
  let count = 0;
  const desiredSep = radius * 0.4;
  for (const other of neighbors) {
    const d = vecDist(boid, other);
    if (d > 0 && d < desiredSep) {
      const diff = vecNormalize(vecSub(boid, other));
      steer = vecAdd(steer, vecScale(diff, 1 / d));
      count++;
    }
  }
  if (count > 0) {
    steer = vecScale(steer, 1 / count);
  }
  return steer;
}

function alignment(
  boid: Boid,
  neighbors: Boid[],
): Vec2 {
  let avg: Vec2 = { x: 0, y: 0 };
  if (neighbors.length === 0) return avg;
  for (const other of neighbors) {
    avg.x += other.vx;
    avg.y += other.vy;
  }
  avg = vecScale(avg, 1 / neighbors.length);
  return vecSub(avg, { x: boid.vx, y: boid.vy });
}

function cohesion(
  boid: Boid,
  neighbors: Boid[],
): Vec2 {
  let center: Vec2 = { x: 0, y: 0 };
  if (neighbors.length === 0) return center;
  for (const other of neighbors) {
    center.x += other.x;
    center.y += other.y;
  }
  center = vecScale(center, 1 / neighbors.length);
  return vecSub(center, boid);
}

function avoidObstacles(
  boid: Boid,
  obstacles: Obstacle[],
): Vec2 {
  let steer: Vec2 = { x: 0, y: 0 };
  for (const obs of obstacles) {
    const d = vecDist(boid, obs) - obs.radius;
    if (d < OBSTACLE_AVOIDANCE_DIST && d > 0) {
      const diff = vecNormalize(vecSub(boid, obs));
      steer = vecAdd(steer, vecScale(diff, 1 / d));
    }
  }
  return steer;
}

function fleeFromPredator(
  boid: Boid,
  predators: Predator[],
): Vec2 {
  let steer: Vec2 = { x: 0, y: 0 };
  for (const pred of predators) {
    const d = vecDist(boid, pred);
    if (d < FLEE_RADIUS && d > 0) {
      const diff = vecNormalize(vecSub(boid, pred));
      steer = vecAdd(steer, vecScale(diff, FLEE_RADIUS / d));
    }
  }
  return steer;
}

function getNeighbors(
  boid: Boid,
  boids: Boid[],
  radius: number,
): Boid[] {
  const result: Boid[] = [];
  for (const other of boids) {
    if (other === boid) continue;
    if (vecDist(boid, other) < radius) {
      result.push(other);
    }
  }
  return result;
}

function updateBoid(
  boid: Boid,
  boids: Boid[],
  params: BoidParams,
  predators: Predator[],
  obstacles: Obstacle[],
  wind: Vec2,
  w: number,
  h: number,
): void {
  const neighbors = getNeighbors(boid, boids, params.perceptionRadius);

  const sep = vecScale(
    separation(boid, neighbors, params.perceptionRadius),
    params.separationWeight,
  );
  const ali = vecScale(
    alignment(boid, neighbors),
    params.alignmentWeight * 0.05,
  );
  const coh = vecScale(
    cohesion(boid, neighbors),
    params.cohesionWeight * 0.005,
  );
  const obsAvoid = vecScale(avoidObstacles(boid, obstacles), 5);
  const flee = vecScale(fleeFromPredator(boid, predators), 2);

  let acc = vecAdd(sep, vecAdd(ali, vecAdd(coh, vecAdd(obsAvoid, flee))));
  acc = vecAdd(acc, wind);
  acc = vecLimit(acc, params.maxForce);

  boid.vx += acc.x;
  boid.vy += acc.y;

  const vel = vecLimit({ x: boid.vx, y: boid.vy }, params.maxSpeed);
  boid.vx = vel.x;
  boid.vy = vel.y;

  boid.x += boid.vx;
  boid.y += boid.vy;

  if (params.wrapBoundary) {
    if (boid.x < 0) boid.x += w;
    if (boid.x > w) boid.x -= w;
    if (boid.y < 0) boid.y += h;
    if (boid.y > h) boid.y -= h;
  } else {
    if (boid.x < 0) { boid.x = 0; boid.vx *= -1; }
    if (boid.x > w) { boid.x = w; boid.vx *= -1; }
    if (boid.y < 0) { boid.y = 0; boid.vy *= -1; }
    if (boid.y > h) { boid.y = h; boid.vy *= -1; }
  }
}

function updatePredator(
  pred: Predator,
  boids: Boid[],
  w: number,
  h: number,
  wrap: boolean,
): void {
  let closest: Boid | null = null;
  let minDist = PREDATOR_PERCEPTION;
  for (const b of boids) {
    const d = vecDist(pred, b);
    if (d < minDist) {
      minDist = d;
      closest = b;
    }
  }

  if (closest) {
    const dir = vecNormalize(vecSub(closest, pred));
    pred.vx += dir.x * 0.1;
    pred.vy += dir.y * 0.1;
  }

  const vel = vecLimit({ x: pred.vx, y: pred.vy }, PREDATOR_SPEED);
  pred.vx = vel.x;
  pred.vy = vel.y;
  pred.x += pred.vx;
  pred.y += pred.vy;

  if (wrap) {
    if (pred.x < 0) pred.x += w;
    if (pred.x > w) pred.x -= w;
    if (pred.y < 0) pred.y += h;
    if (pred.y > h) pred.y -= h;
  } else {
    if (pred.x < 0) { pred.x = 0; pred.vx *= -1; }
    if (pred.x > w) { pred.x = w; pred.vx *= -1; }
    if (pred.y < 0) { pred.y = 0; pred.vy *= -1; }
    if (pred.y > h) { pred.y = h; pred.vy *= -1; }
  }
}

// ─────────────────────────────────────────────────────────
// Color helpers
// ─────────────────────────────────────────────────────────

function speedToColor(speed: number, maxSpeed: number): string {
  const t = Math.min(speed / maxSpeed, 1);
  const r = Math.round(50 + t * 205);
  const g = Math.round(130 - t * 80);
  const b = Math.round(220 - t * 180);
  return `rgb(${r},${g},${b})`;
}

function resolveColor(el: HTMLCanvasElement, varName: string, fallback: string): string {
  const val = getComputedStyle(el).getPropertyValue(varName).trim();
  return val || fallback;
}

// ─────────────────────────────────────────────────────────
// Drawing
// ─────────────────────────────────────────────────────────

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  vx: number,
  vy: number,
  size: number,
  color: string,
): void {
  const angle = Math.atan2(vy, vx);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.6, size * 0.5);
  ctx.lineTo(-size * 0.6, -size * 0.5);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

export default function Boids() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const boidsRef = useRef<Boid[]>([]);
  const predatorsRef = useRef<Predator[]>([]);
  const obstaclesRef = useRef<Obstacle[]>([]);
  const windRef = useRef<Vec2>({ x: 0, y: 0 });
  const paramsRef = useRef<BoidParams>({ ...DEFAULT_PARAMS });
  const dragRef = useRef<{ startX: number; startY: number; dragging: boolean }>({
    startX: 0,
    startY: 0,
    dragging: false,
  });
  const sizeRef = useRef<{ w: number; h: number }>({ w: 800, h: 500 });
  const isFullscreenRef = useRef(false);

  const [params, setParams] = useState<BoidParams>({ ...DEFAULT_PARAMS });
  const [running, setRunning] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [boidCountDisplay, setBoidCountDisplay] = useState(DEFAULT_PARAMS.boidCount);
  const [predatorCount, setPredatorCount] = useState(0);
  const [obstacleCount, setObstacleCount] = useState(0);
  const [showControls, setShowControls] = useState(true);

  const initBoids = useCallback((count: number) => {
    const { w, h } = sizeRef.current;
    boidsRef.current = Array.from({ length: count }, () => createBoid(w, h));
    setBoidCountDisplay(count);
  }, []);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(rect.width);
    const h = isFullscreenRef.current ? Math.floor(rect.height) : Math.min(Math.floor(rect.width * 0.6), 600);

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);

    sizeRef.current = { w, h };
  }, []);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w, h } = sizeRef.current;
    const p = paramsRef.current;
    const boids = boidsRef.current;
    const predators = predatorsRef.current;
    const obstacles = obstaclesRef.current;

    // Background with optional trail effect
    if (p.showTrails) {
      ctx.fillStyle = `rgba(9,9,11,${TRAIL_ALPHA})`;
      ctx.fillRect(0, 0, w, h);
    } else {
      const bgColor = resolveColor(canvas, "--color-bg", "#09090b");
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, w, h);
    }

    const primaryColor = resolveColor(canvas, "--color-primary", "#4f8ff7");
    const accentColor = resolveColor(canvas, "--color-accent", "#34d399");

    // Draw obstacles
    for (const obs of obstacles) {
      ctx.beginPath();
      ctx.arc(obs.x, obs.y, obs.radius, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw boids
    for (const boid of boids) {
      const speed = vecMag({ x: boid.vx, y: boid.vy });
      const color = p.speedColoring
        ? speedToColor(speed, p.maxSpeed)
        : primaryColor;

      drawTriangle(ctx, boid.x, boid.y, boid.vx, boid.vy, BOID_SIZE, color);

      if (p.showVelocity) {
        ctx.beginPath();
        ctx.moveTo(boid.x, boid.y);
        ctx.lineTo(boid.x + boid.vx * 5, boid.y + boid.vy * 5);
        ctx.strokeStyle = "rgba(255,255,255,0.2)";
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      if (p.showPerception) {
        ctx.beginPath();
        ctx.arc(boid.x, boid.y, p.perceptionRadius, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.04)";
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }

    // Draw predators
    for (const pred of predators) {
      drawTriangle(ctx, pred.x, pred.y, pred.vx, pred.vy, PREDATOR_SIZE, "#ef4444");
      // Perception circle for predator
      ctx.beginPath();
      ctx.arc(pred.x, pred.y, FLEE_RADIUS, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(239,68,68,0.15)";
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    // Draw wind indicator
    const windMag = vecMag(windRef.current);
    if (windMag > 0.001) {
      const cx = w - 40;
      const cy = 40;
      ctx.beginPath();
      ctx.arc(cx, cy, 20, 0, Math.PI * 2);
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1;
      ctx.stroke();

      const norm = vecNormalize(windRef.current);
      const len = Math.min(windMag * 200, 16);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + norm.x * len, cy + norm.y * len);
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, []);

  const step = useCallback(() => {
    const p = paramsRef.current;
    const boids = boidsRef.current;
    const predators = predatorsRef.current;
    const obstacles = obstaclesRef.current;
    const wind = windRef.current;
    const { w, h } = sizeRef.current;

    for (const boid of boids) {
      updateBoid(boid, boids, p, predators, obstacles, wind, w, h);
    }
    for (const pred of predators) {
      updatePredator(pred, boids, w, h, p.wrapBoundary);
    }

    // Decay wind
    windRef.current = vecScale(wind, 0.98);
  }, []);

  const loop = useCallback(() => {
    step();
    render();
    animRef.current = requestAnimationFrame(loop);
  }, [step, render]);

  // Start/stop animation loop
  useEffect(() => {
    if (running) {
      animRef.current = requestAnimationFrame(loop);
    }
    return () => cancelAnimationFrame(animRef.current);
  }, [running, loop]);

  // Init
  useEffect(() => {
    resizeCanvas();
    initBoids(paramsRef.current.boidCount);

    const handleResize = () => resizeCanvas();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [resizeCanvas, initBoids]);

  // Sync params ref
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  // Sync fullscreen ref
  useEffect(() => {
    isFullscreenRef.current = isFullscreen;
  }, [isFullscreen]);

  // Canvas interaction handlers
  const getCanvasPos = useCallback((e: MouseEvent): Vec2 => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    e.preventDefault();
    const pos = getCanvasPos(e);

    if (e.button === 2) {
      // Right-click: add obstacle
      obstaclesRef.current.push({ x: pos.x, y: pos.y, radius: 20 + Math.random() * 15 });
      setObstacleCount(obstaclesRef.current.length);
      return;
    }

    if (e.button === 0) {
      dragRef.current = { startX: pos.x, startY: pos.y, dragging: true };
    }
  }, [getCanvasPos]);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (e.button !== 0) return;
    const pos = getCanvasPos(e);
    const drag = dragRef.current;

    if (drag.dragging) {
      const dx = pos.x - drag.startX;
      const dy = pos.y - drag.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 5) {
        // Click (not drag): add predator
        predatorsRef.current.push(createPredator(pos.x, pos.y));
        setPredatorCount(predatorsRef.current.length);
      } else {
        // Drag: apply wind
        windRef.current = { x: dx * WIND_STRENGTH, y: dy * WIND_STRENGTH };
      }
    }

    dragRef.current.dragging = false;
  }, [getCanvasPos]);

  const handleContextMenu = useCallback((e: Event) => {
    e.preventDefault();
  }, []);

  const updateParam = useCallback(<K extends keyof BoidParams>(key: K, value: BoidParams[K]) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  const applyPreset = useCallback((preset: Preset) => {
    const newParams = { ...DEFAULT_PARAMS, ...preset.params };
    setParams(newParams);
    paramsRef.current = newParams;
    predatorsRef.current = [];
    obstaclesRef.current = [];
    windRef.current = { x: 0, y: 0 };
    initBoids(newParams.boidCount);

    if (preset.spawnPredator) {
      const { w, h } = sizeRef.current;
      predatorsRef.current.push(createPredator(w / 2, h / 2));
      setPredatorCount(1);
    } else {
      setPredatorCount(0);
    }
    setObstacleCount(0);
  }, [initBoids]);

  const clearEntities = useCallback(() => {
    predatorsRef.current = [];
    obstaclesRef.current = [];
    windRef.current = { x: 0, y: 0 };
    setPredatorCount(0);
    setObstacleCount(0);
  }, []);

  const resetSimulation = useCallback(() => {
    clearEntities();
    initBoids(paramsRef.current.boidCount);
  }, [clearEntities, initBoids]);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => {
      const next = !prev;
      isFullscreenRef.current = next;
      requestAnimationFrame(() => resizeCanvas());
      return next;
    });
  }, [resizeCanvas]);

  const handleBoidCountChange = useCallback((value: number) => {
    updateParam("boidCount", value);
    initBoids(value);
  }, [updateParam, initBoids]);

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────

  const sliderStyle = {
    accentColor: "var(--color-primary)",
  };

  return (
    <div
      ref={containerRef}
      class={`relative rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] ${
        isFullscreen ? "fixed inset-0 z-50 rounded-none border-none" : ""
      }`}
    >
      {/* Canvas */}
      <canvas
        ref={canvasRef}
        class="block w-full cursor-crosshair rounded-t-xl"
        style={isFullscreen ? { height: "100%" } : undefined}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onContextMenu={handleContextMenu}
      />

      {/* Status bar */}
      <div class="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-muted)]">
        <span>Boids: {boidCountDisplay}</span>
        {predatorCount > 0 && (
          <span class="text-red-400">Predators: {predatorCount}</span>
        )}
        {obstacleCount > 0 && (
          <span>Obstacles: {obstacleCount}</span>
        )}
        <div class="ml-auto flex items-center gap-2">
          <button
            onClick={() => setRunning((r) => !r)}
            class="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
          >
            {running ? "Pause" : "Play"}
          </button>
          <button
            onClick={resetSimulation}
            class="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
          >
            Reset
          </button>
          <button
            onClick={clearEntities}
            class="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
          >
            Clear
          </button>
          <button
            onClick={toggleFullscreen}
            class="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
          >
            {isFullscreen ? "Exit FS" : "Fullscreen"}
          </button>
          <button
            onClick={() => setShowControls((s) => !s)}
            class="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
          >
            {showControls ? "Hide Controls" : "Show Controls"}
          </button>
        </div>
      </div>

      {/* Controls panel */}
      {showControls && (
        <div class="border-t border-[var(--color-border)] px-4 py-4">
          {/* Presets */}
          <div class="mb-4">
            <label class="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Presets
            </label>
            <div class="flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => applyPreset(preset)}
                  class="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* Sliders grid */}
          <div class="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {/* Separation */}
            <div>
              <div class="mb-1 flex justify-between text-xs text-[var(--color-text-muted)]">
                <span>Separation</span>
                <span class="font-mono">{params.separationWeight.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="5"
                step="0.1"
                value={params.separationWeight}
                onInput={(e) => updateParam("separationWeight", parseFloat((e.target as HTMLInputElement).value))}
                class="w-full"
                style={sliderStyle}
              />
            </div>

            {/* Alignment */}
            <div>
              <div class="mb-1 flex justify-between text-xs text-[var(--color-text-muted)]">
                <span>Alignment</span>
                <span class="font-mono">{params.alignmentWeight.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="5"
                step="0.1"
                value={params.alignmentWeight}
                onInput={(e) => updateParam("alignmentWeight", parseFloat((e.target as HTMLInputElement).value))}
                class="w-full"
                style={sliderStyle}
              />
            </div>

            {/* Cohesion */}
            <div>
              <div class="mb-1 flex justify-between text-xs text-[var(--color-text-muted)]">
                <span>Cohesion</span>
                <span class="font-mono">{params.cohesionWeight.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="5"
                step="0.1"
                value={params.cohesionWeight}
                onInput={(e) => updateParam("cohesionWeight", parseFloat((e.target as HTMLInputElement).value))}
                class="w-full"
                style={sliderStyle}
              />
            </div>

            {/* Perception Radius */}
            <div>
              <div class="mb-1 flex justify-between text-xs text-[var(--color-text-muted)]">
                <span>Perception Radius</span>
                <span class="font-mono">{params.perceptionRadius}</span>
              </div>
              <input
                type="range"
                min="20"
                max="150"
                step="5"
                value={params.perceptionRadius}
                onInput={(e) => updateParam("perceptionRadius", parseInt((e.target as HTMLInputElement).value, 10))}
                class="w-full"
                style={sliderStyle}
              />
            </div>

            {/* Max Speed */}
            <div>
              <div class="mb-1 flex justify-between text-xs text-[var(--color-text-muted)]">
                <span>Max Speed</span>
                <span class="font-mono">{params.maxSpeed.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                step="0.5"
                value={params.maxSpeed}
                onInput={(e) => updateParam("maxSpeed", parseFloat((e.target as HTMLInputElement).value))}
                class="w-full"
                style={sliderStyle}
              />
            </div>

            {/* Max Steering Force */}
            <div>
              <div class="mb-1 flex justify-between text-xs text-[var(--color-text-muted)]">
                <span>Max Steer Force</span>
                <span class="font-mono">{params.maxForce.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.01"
                max="1"
                step="0.01"
                value={params.maxForce}
                onInput={(e) => updateParam("maxForce", parseFloat((e.target as HTMLInputElement).value))}
                class="w-full"
                style={sliderStyle}
              />
            </div>

            {/* Boid Count */}
            <div>
              <div class="mb-1 flex justify-between text-xs text-[var(--color-text-muted)]">
                <span>Boid Count</span>
                <span class="font-mono">{params.boidCount}</span>
              </div>
              <input
                type="range"
                min="50"
                max="500"
                step="10"
                value={params.boidCount}
                onInput={(e) => handleBoidCountChange(parseInt((e.target as HTMLInputElement).value, 10))}
                class="w-full"
                style={sliderStyle}
              />
            </div>
          </div>

          {/* Toggles */}
          <div class="mt-4 flex flex-wrap gap-4">
            <label class="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <input
                type="checkbox"
                checked={params.wrapBoundary}
                onChange={(e) => updateParam("wrapBoundary", (e.target as HTMLInputElement).checked)}
                class="accent-[var(--color-primary)]"
              />
              Wrap edges
            </label>
            <label class="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <input
                type="checkbox"
                checked={params.showTrails}
                onChange={(e) => updateParam("showTrails", (e.target as HTMLInputElement).checked)}
                class="accent-[var(--color-primary)]"
              />
              Trails
            </label>
            <label class="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <input
                type="checkbox"
                checked={params.speedColoring}
                onChange={(e) => updateParam("speedColoring", (e.target as HTMLInputElement).checked)}
                class="accent-[var(--color-primary)]"
              />
              Speed coloring
            </label>
            <label class="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <input
                type="checkbox"
                checked={params.showPerception}
                onChange={(e) => updateParam("showPerception", (e.target as HTMLInputElement).checked)}
                class="accent-[var(--color-primary)]"
              />
              Perception
            </label>
            <label class="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <input
                type="checkbox"
                checked={params.showVelocity}
                onChange={(e) => updateParam("showVelocity", (e.target as HTMLInputElement).checked)}
                class="accent-[var(--color-primary)]"
              />
              Velocity
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
