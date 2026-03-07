import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ================================================================
   Types & Constants
   ================================================================ */

interface Particle {
  x: number;
  y: number;
  oldX: number;
  oldY: number;
  pinned: boolean;
  mass: number;
}

interface Constraint {
  p1: number;
  p2: number;
  restLength: number;
  active: boolean;
}

interface SimConfig {
  gravity: number;
  wind: boolean;
  windStrength: number;
  stiffness: number;
  damping: number;
  tearThreshold: number;
  constraintIterations: number;
}

const COLS = 30;
const ROWS = 30;
const SPACING = 12;
const DT = 0.8;

const DEFAULT_CONFIG: SimConfig = {
  gravity: 0.5,
  wind: false,
  windStrength: 0.3,
  stiffness: 1.0,
  damping: 0.99,
  tearThreshold: 2.5,
  constraintIterations: 4,
};

/* ================================================================
   Cloth Engine
   ================================================================ */

function createCloth(
  cols: number,
  rows: number,
  spacing: number,
  offsetX: number,
  offsetY: number,
): { particles: Particle[]; constraints: Constraint[] } {
  const particles: Particle[] = [];
  const constraints: Constraint[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = offsetX + col * spacing;
      const y = offsetY + row * spacing;
      particles.push({
        x,
        y,
        oldX: x,
        oldY: y,
        pinned: row === 0,
        mass: 1,
      });
    }
  }

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      if (col < cols - 1) {
        constraints.push({
          p1: idx,
          p2: idx + 1,
          restLength: spacing,
          active: true,
        });
      }
      if (row < rows - 1) {
        constraints.push({
          p1: idx,
          p2: idx + cols,
          restLength: spacing,
          active: true,
        });
      }
    }
  }

  return { particles, constraints };
}

function verletIntegrate(
  particles: Particle[],
  gravity: number,
  wind: boolean,
  windStrength: number,
  damping: number,
  time: number,
): void {
  const windForceX = wind ? Math.sin(time * 0.002) * windStrength : 0;
  const windForceY = wind ? Math.cos(time * 0.003) * windStrength * 0.3 : 0;

  for (const p of particles) {
    if (p.pinned) continue;
    const vx = (p.x - p.oldX) * damping;
    const vy = (p.y - p.oldY) * damping;
    p.oldX = p.x;
    p.oldY = p.y;
    p.x += vx + windForceX * DT * DT;
    p.y += vy + (gravity + windForceY) * DT * DT;
  }
}

function satisfyConstraints(
  particles: Particle[],
  constraints: Constraint[],
  iterations: number,
  stiffness: number,
  tearThreshold: number,
): void {
  for (let iter = 0; iter < iterations; iter++) {
    for (const c of constraints) {
      if (!c.active) continue;
      const p1 = particles[c.p1];
      const p2 = particles[c.p2];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist === 0) continue;

      if (dist > c.restLength * tearThreshold) {
        c.active = false;
        continue;
      }

      const diff = (c.restLength - dist) / dist * stiffness;
      const offsetX = dx * diff * 0.5;
      const offsetY = dy * diff * 0.5;

      if (!p1.pinned) {
        p1.x -= offsetX;
        p1.y -= offsetY;
      }
      if (!p2.pinned) {
        p2.x += offsetX;
        p2.y += offsetY;
      }
    }
  }
}

/* ================================================================
   Rendering Helpers
   ================================================================ */

function resolveColor(el: HTMLCanvasElement, varName: string, fallback: string): string {
  const val = getComputedStyle(el).getPropertyValue(varName).trim();
  return val || fallback;
}

function drawCloth(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  particles: Particle[],
  constraints: Constraint[],
  cols: number,
): void {
  const bg = resolveColor(canvas, "--color-bg", "#09090b");
  const lineColor = resolveColor(canvas, "--color-primary", "#4f8ff7");
  const pinColor = resolveColor(canvas, "--color-accent", "#34d399");

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.7;

  for (const c of constraints) {
    if (!c.active) continue;
    const p1 = particles[c.p1];
    const p2 = particles[c.p2];
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  ctx.globalAlpha = 1.0;

  // Draw colored fabric patches
  for (let row = 0; row < ROWS - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const i = row * cols + col;
      const tl = particles[i];
      const tr = particles[i + 1];
      const bl = particles[i + cols];
      const br = particles[i + cols + 1];

      const c1 = constraints.find(
        (c) => c.active && ((c.p1 === i && c.p2 === i + 1) || (c.p1 === i + 1 && c.p2 === i)),
      );
      const c2 = constraints.find(
        (c) => c.active && ((c.p1 === i && c.p2 === i + cols) || (c.p1 === i + cols && c.p2 === i)),
      );

      if (!c1 || !c2) continue;

      const strain = Math.min(
        1,
        Math.sqrt((tr.x - tl.x) ** 2 + (tr.y - tl.y) ** 2) / (SPACING * 1.5),
      );
      const hue = 220 - strain * 40;
      ctx.fillStyle = `hsla(${hue}, 60%, 50%, 0.25)`;
      ctx.beginPath();
      ctx.moveTo(tl.x, tl.y);
      ctx.lineTo(tr.x, tr.y);
      ctx.lineTo(br.x, br.y);
      ctx.lineTo(bl.x, bl.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Draw pinned particles
  for (const p of particles) {
    if (p.pinned) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = pinColor;
      ctx.fill();
    }
  }
}

/* ================================================================
   Component
   ================================================================ */

export default function ClothSim() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const particlesRef = useRef<Particle[]>([]);
  const constraintsRef = useRef<Constraint[]>([]);
  const configRef = useRef<SimConfig>({ ...DEFAULT_CONFIG });
  const timeRef = useRef(0);
  const mouseRef = useRef<{ x: number; y: number; down: boolean; tear: boolean }>({
    x: 0,
    y: 0,
    down: false,
    tear: false,
  });
  const sizeRef = useRef({ w: 800, h: 500 });

  const [config, setConfig] = useState<SimConfig>({ ...DEFAULT_CONFIG });
  const [running, setRunning] = useState(true);
  const [showControls, setShowControls] = useState(true);

  const initCloth = useCallback(() => {
    const { w, h } = sizeRef.current;
    const totalWidth = (COLS - 1) * SPACING;
    const offsetX = (w - totalWidth) / 2;
    const offsetY = 40;
    const { particles, constraints } = createCloth(COLS, ROWS, SPACING, offsetX, offsetY);
    particlesRef.current = particles;
    constraintsRef.current = constraints;
  }, []);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(rect.width);
    const h = Math.min(Math.floor(rect.width * 0.65), 550);

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);
    sizeRef.current = { w, h };
  }, []);

  const loop = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const { w, h } = sizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const particles = particlesRef.current;
    const constraints = constraintsRef.current;
    const cfg = configRef.current;
    const mouse = mouseRef.current;

    timeRef.current += 16;

    // Mouse interaction
    if (mouse.down && particles.length > 0) {
      const influenceRadius = mouse.tear ? 20 : 40;
      for (const p of particles) {
        if (p.pinned && !mouse.tear) continue;
        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < influenceRadius) {
          if (mouse.tear) {
            // Tear nearby constraints
            for (const c of constraints) {
              if (!c.active) continue;
              const cp1 = particles[c.p1];
              const cp2 = particles[c.p2];
              const cx = (cp1.x + cp2.x) / 2;
              const cy = (cp1.y + cp2.y) / 2;
              const td = Math.sqrt((mouse.x - cx) ** 2 + (mouse.y - cy) ** 2);
              if (td < 15) c.active = false;
            }
          } else {
            p.x = mouse.x;
            p.y = mouse.y;
          }
        }
      }
    }

    verletIntegrate(
      particles,
      cfg.gravity,
      cfg.wind,
      cfg.windStrength,
      cfg.damping,
      timeRef.current,
    );

    satisfyConstraints(
      particles,
      constraints,
      cfg.constraintIterations,
      cfg.stiffness,
      cfg.tearThreshold,
    );

    // Keep particles in bounds
    for (const p of particles) {
      if (p.pinned) continue;
      if (p.y > h - 5) {
        p.y = h - 5;
        p.oldY = p.y;
      }
      if (p.x < 5) {
        p.x = 5;
        p.oldX = p.x;
      }
      if (p.x > w - 5) {
        p.x = w - 5;
        p.oldX = p.x;
      }
    }

    drawCloth(ctx, canvas, particles, constraints, COLS);

    // Draw interaction cursor indicator
    if (mouse.down) {
      ctx.beginPath();
      ctx.arc(mouse.x, mouse.y, mouse.tear ? 15 : 30, 0, Math.PI * 2);
      ctx.strokeStyle = mouse.tear ? "#ef4444" : "rgba(79,143,247,0.4)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    animRef.current = requestAnimationFrame(loop);
  }, []);

  const getCanvasCoords = useCallback((e: MouseEvent | TouchEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  useEffect(() => {
    resizeCanvas();
    initCloth();

    const handleResize = () => {
      resizeCanvas();
      initCloth();
    };
    window.addEventListener("resize", handleResize);

    animRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", handleResize);
    };
  }, [resizeCanvas, initCloth, loop]);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      const coords = getCanvasCoords(e);
      mouseRef.current = { ...coords, down: true, tear: e.shiftKey };
    },
    [getCanvasCoords],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!mouseRef.current.down) return;
      const coords = getCanvasCoords(e);
      mouseRef.current.x = coords.x;
      mouseRef.current.y = coords.y;
    },
    [getCanvasCoords],
  );

  const handleMouseUp = useCallback(() => {
    mouseRef.current.down = false;
  }, []);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      e.preventDefault();
      const coords = getCanvasCoords(e);
      mouseRef.current = { ...coords, down: true, tear: false };
    },
    [getCanvasCoords],
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      e.preventDefault();
      if (!mouseRef.current.down) return;
      const coords = getCanvasCoords(e);
      mouseRef.current.x = coords.x;
      mouseRef.current.y = coords.y;
    },
    [getCanvasCoords],
  );

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    e.preventDefault();
    mouseRef.current.down = false;
  }, []);

  const handleReset = useCallback(() => {
    initCloth();
  }, [initCloth]);

  const togglePin = useCallback((mode: "all" | "corners" | "none") => {
    const particles = particlesRef.current;
    for (let col = 0; col < COLS; col++) {
      const p = particles[col];
      if (mode === "all") {
        p.pinned = true;
      } else if (mode === "corners") {
        p.pinned = col === 0 || col === COLS - 1 || col === Math.floor(COLS / 2);
      } else {
        p.pinned = false;
      }
    }
  }, []);

  const updateConfig = useCallback((key: keyof SimConfig, value: number | boolean) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }, []);

  return (
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap gap-2">
          <button
            onClick={handleReset}
            class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)]"
          >
            Reset
          </button>
          <button
            onClick={() => togglePin("all")}
            class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)]"
          >
            Pin Top
          </button>
          <button
            onClick={() => togglePin("corners")}
            class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)]"
          >
            Pin Corners
          </button>
          <button
            onClick={() => togglePin("none")}
            class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)]"
          >
            Unpin All
          </button>
        </div>
        <button
          onClick={() => setShowControls((v) => !v)}
          class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)]"
        >
          {showControls ? "Hide" : "Show"} Controls
        </button>
      </div>

      {showControls && (
        <div class="grid grid-cols-2 gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:grid-cols-3 lg:grid-cols-4">
          <label class="space-y-1">
            <span class="text-xs text-[var(--color-text-muted)]">
              Gravity: {config.gravity.toFixed(2)}
            </span>
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={config.gravity}
              onInput={(e) => updateConfig("gravity", parseFloat((e.target as HTMLInputElement).value))}
              class="w-full accent-[var(--color-primary)]"
            />
          </label>

          <label class="space-y-1">
            <span class="text-xs text-[var(--color-text-muted)]">
              Stiffness: {config.stiffness.toFixed(2)}
            </span>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={config.stiffness}
              onInput={(e) => updateConfig("stiffness", parseFloat((e.target as HTMLInputElement).value))}
              class="w-full accent-[var(--color-primary)]"
            />
          </label>

          <label class="space-y-1">
            <span class="text-xs text-[var(--color-text-muted)]">
              Tear Threshold: {config.tearThreshold.toFixed(1)}
            </span>
            <input
              type="range"
              min="1.5"
              max="5"
              step="0.1"
              value={config.tearThreshold}
              onInput={(e) =>
                updateConfig("tearThreshold", parseFloat((e.target as HTMLInputElement).value))
              }
              class="w-full accent-[var(--color-primary)]"
            />
          </label>

          <label class="space-y-1">
            <span class="text-xs text-[var(--color-text-muted)]">
              Wind Strength: {config.windStrength.toFixed(2)}
            </span>
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={config.windStrength}
              onInput={(e) =>
                updateConfig("windStrength", parseFloat((e.target as HTMLInputElement).value))
              }
              class="w-full accent-[var(--color-primary)]"
            />
          </label>

          <div class="flex items-center gap-2">
            <button
              onClick={() => updateConfig("wind", !config.wind)}
              class={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                config.wind
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]"
              }`}
            >
              Wind {config.wind ? "ON" : "OFF"}
            </button>
          </div>

          <label class="space-y-1">
            <span class="text-xs text-[var(--color-text-muted)]">
              Iterations: {config.constraintIterations}
            </span>
            <input
              type="range"
              min="1"
              max="8"
              step="1"
              value={config.constraintIterations}
              onInput={(e) =>
                updateConfig("constraintIterations", parseInt((e.target as HTMLInputElement).value, 10))
              }
              class="w-full accent-[var(--color-primary)]"
            />
          </label>
        </div>
      )}

      <div ref={containerRef} class="relative overflow-hidden rounded-xl border border-[var(--color-border)]">
        <canvas
          ref={canvasRef}
          class="block w-full cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        />
        <div class="absolute bottom-2 left-3 text-[10px] text-[var(--color-text-muted)] opacity-60">
          Drag to pull | Shift+drag to tear
        </div>
      </div>
    </div>
  );
}
