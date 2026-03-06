import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ================================================================
   Types & Constants
   ================================================================ */

type VisMode = "dye" | "velocity" | "pressure" | "arrows";
type ColorMode = "rainbow" | "smoke" | "temperature" | "custom";
type PresetKey = "calm" | "turbulent" | "smoke" | "wind";

interface Preset {
  label: string;
  viscosity: number;
  diffusion: number;
  gravity: number;
  inflow: boolean;
}

const PRESETS: Record<PresetKey, Preset> = {
  calm: {
    label: "Calm Pool",
    viscosity: 0.0001,
    diffusion: 0.0001,
    gravity: 0,
    inflow: false,
  },
  turbulent: {
    label: "Turbulent Flow",
    viscosity: 0.00005,
    diffusion: 0.00002,
    gravity: 0,
    inflow: false,
  },
  smoke: {
    label: "Smoke Rising",
    viscosity: 0.0001,
    diffusion: 0.0002,
    gravity: -0.5,
    inflow: false,
  },
  wind: {
    label: "Wind Tunnel",
    viscosity: 0.0001,
    diffusion: 0.0001,
    gravity: 0,
    inflow: true,
  },
};

const GS_ITERATIONS = 20;
const DT = 0.1;

/* ================================================================
   Fluid Solver (Jos Stam Stable Fluids)
   ================================================================ */

function ix(x: number, y: number, n: number): number {
  return x + y * n;
}

function setBoundary(b: number, field: Float32Array, n: number): void {
  for (let i = 1; i < n - 1; i++) {
    field[ix(i, 0, n)] = b === 2 ? -field[ix(i, 1, n)] : field[ix(i, 1, n)];
    field[ix(i, n - 1, n)] = b === 2 ? -field[ix(i, n - 2, n)] : field[ix(i, n - 2, n)];
    field[ix(0, i, n)] = b === 1 ? -field[ix(1, i, n)] : field[ix(1, i, n)];
    field[ix(n - 1, i, n)] = b === 1 ? -field[ix(n - 2, i, n)] : field[ix(n - 2, i, n)];
  }
  field[ix(0, 0, n)] = 0.5 * (field[ix(1, 0, n)] + field[ix(0, 1, n)]);
  field[ix(0, n - 1, n)] = 0.5 * (field[ix(1, n - 1, n)] + field[ix(0, n - 2, n)]);
  field[ix(n - 1, 0, n)] = 0.5 * (field[ix(n - 2, 0, n)] + field[ix(n - 1, 1, n)]);
  field[ix(n - 1, n - 1, n)] = 0.5 * (field[ix(n - 2, n - 1, n)] + field[ix(n - 1, n - 2, n)]);
}

function diffuse(
  b: number,
  x: Float32Array,
  x0: Float32Array,
  diff: number,
  dt: number,
  n: number,
  obstacles: Uint8Array,
): void {
  const a = dt * diff * (n - 2) * (n - 2);
  const c = 1 + 4 * a;
  for (let k = 0; k < GS_ITERATIONS; k++) {
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        const idx = ix(i, j, n);
        if (obstacles[idx]) { x[idx] = 0; continue; }
        x[idx] =
          (x0[idx] +
            a * (x[ix(i + 1, j, n)] + x[ix(i - 1, j, n)] +
                 x[ix(i, j + 1, n)] + x[ix(i, j - 1, n)])) / c;
      }
    }
    setBoundary(b, x, n);
  }
}

function advect(
  b: number,
  d: Float32Array,
  d0: Float32Array,
  u: Float32Array,
  v: Float32Array,
  dt: number,
  n: number,
  obstacles: Uint8Array,
): void {
  const dt0 = dt * (n - 2);
  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      const idx = ix(i, j, n);
      if (obstacles[idx]) { d[idx] = 0; continue; }
      let x = i - dt0 * u[idx];
      let y = j - dt0 * v[idx];
      if (x < 0.5) x = 0.5;
      if (x > n - 1.5) x = n - 1.5;
      if (y < 0.5) y = 0.5;
      if (y > n - 1.5) y = n - 1.5;
      const i0 = Math.floor(x);
      const i1 = i0 + 1;
      const j0 = Math.floor(y);
      const j1 = j0 + 1;
      const s1 = x - i0;
      const s0 = 1 - s1;
      const t1 = y - j0;
      const t0 = 1 - t1;
      d[idx] =
        s0 * (t0 * d0[ix(i0, j0, n)] + t1 * d0[ix(i0, j1, n)]) +
        s1 * (t0 * d0[ix(i1, j0, n)] + t1 * d0[ix(i1, j1, n)]);
    }
  }
  setBoundary(b, d, n);
}

function project(
  u: Float32Array,
  v: Float32Array,
  p: Float32Array,
  div: Float32Array,
  n: number,
  obstacles: Uint8Array,
): void {
  const h = 1.0 / (n - 2);
  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      const idx = ix(i, j, n);
      if (obstacles[idx]) { div[idx] = 0; p[idx] = 0; continue; }
      div[idx] =
        -0.5 * h *
        (u[ix(i + 1, j, n)] - u[ix(i - 1, j, n)] +
         v[ix(i, j + 1, n)] - v[ix(i, j - 1, n)]);
      p[idx] = 0;
    }
  }
  setBoundary(0, div, n);
  setBoundary(0, p, n);

  for (let k = 0; k < GS_ITERATIONS; k++) {
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        const idx = ix(i, j, n);
        if (obstacles[idx]) continue;
        p[idx] =
          (div[idx] +
            p[ix(i + 1, j, n)] + p[ix(i - 1, j, n)] +
            p[ix(i, j + 1, n)] + p[ix(i, j - 1, n)]) / 4;
      }
    }
    setBoundary(0, p, n);
  }

  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      const idx = ix(i, j, n);
      if (obstacles[idx]) { u[idx] = 0; v[idx] = 0; continue; }
      u[idx] -= 0.5 * (p[ix(i + 1, j, n)] - p[ix(i - 1, j, n)]) / h;
      v[idx] -= 0.5 * (p[ix(i, j + 1, n)] - p[ix(i, j - 1, n)]) / h;
    }
  }
  setBoundary(1, u, n);
  setBoundary(2, v, n);
}

function addSource(
  target: Float32Array,
  source: Float32Array,
  dt: number,
  size: number,
): void {
  for (let i = 0; i < size; i++) {
    target[i] += dt * source[i];
  }
}

/* ================================================================
   Color Utilities
   ================================================================ */

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function densityToColor(
  d: number,
  mode: ColorMode,
  customHue: number,
): [number, number, number] {
  const v = Math.min(d, 1);
  switch (mode) {
    case "rainbow": {
      const hue = v * 0.8;
      return hslToRgb(hue, 0.9, Math.min(v * 0.6, 0.55));
    }
    case "smoke": {
      const brightness = Math.round(v * 220);
      return [brightness, brightness, brightness];
    }
    case "temperature": {
      const r = Math.round(Math.min(v * 2, 1) * 255);
      const b = Math.round(Math.max(1 - v * 2, 0) * 255);
      const g = Math.round(v > 0.5 ? (1 - v) * 2 * 100 : v * 2 * 100);
      return [r, g, b];
    }
    case "custom": {
      return hslToRgb(customHue / 360, 0.85, Math.min(v * 0.55, 0.5));
    }
  }
}

function velocityToColor(mag: number): [number, number, number] {
  const v = Math.min(mag * 20, 1);
  const r = Math.round(v * 255);
  const b = Math.round((1 - v) * 200);
  return [r, 40, b];
}

function pressureToColor(p: number): [number, number, number] {
  const v = Math.max(-1, Math.min(1, p * 100));
  if (v > 0) {
    return [Math.round(v * 255), Math.round(50 + v * 50), 50];
  }
  return [50, Math.round(50 + Math.abs(v) * 50), Math.round(Math.abs(v) * 255)];
}

/* ================================================================
   Component
   ================================================================ */

export default function FluidSim() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [gridSize, setGridSize] = useState(128);
  const [viscosity, setViscosity] = useState(0.0001);
  const [diffusion, setDiffusion] = useState(0.0001);
  const [speed, setSpeed] = useState(1);
  const [visMode, setVisMode] = useState<VisMode>("dye");
  const [colorMode, setColorMode] = useState<ColorMode>("rainbow");
  const [customHue, setCustomHue] = useState(200);
  const [paused, setPaused] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [gravity, setGravity] = useState(0);
  const [windInflow, setWindInflow] = useState(false);
  const [fps, setFps] = useState(0);

  const simRef = useRef<{
    n: number;
    u: Float32Array;
    v: Float32Array;
    uPrev: Float32Array;
    vPrev: Float32Array;
    dens: Float32Array;
    densPrev: Float32Array;
    pressure: Float32Array;
    divField: Float32Array;
    obstacles: Uint8Array;
    obstacleX: number;
    obstacleY: number;
    obstacleR: number;
    dragging: boolean;
    rightDragging: boolean;
    lastMx: number;
    lastMy: number;
  } | null>(null);

  const animRef = useRef<number>(0);
  const fpsRef = useRef({ frames: 0, lastTime: performance.now() });

  /* ---------------------------------------------------------------
     Initialize / resize sim
     --------------------------------------------------------------- */

  const initSim = useCallback((n: number) => {
    const size = n * n;
    const sim = {
      n,
      u: new Float32Array(size),
      v: new Float32Array(size),
      uPrev: new Float32Array(size),
      vPrev: new Float32Array(size),
      dens: new Float32Array(size),
      densPrev: new Float32Array(size),
      pressure: new Float32Array(size),
      divField: new Float32Array(size),
      obstacles: new Uint8Array(size),
      obstacleX: n * 0.3,
      obstacleY: n * 0.5,
      obstacleR: n * 0.06,
      dragging: false,
      rightDragging: false,
      lastMx: 0,
      lastMy: 0,
    };
    placeCircleObstacle(sim.obstacles, n, sim.obstacleX, sim.obstacleY, sim.obstacleR);
    simRef.current = sim;
  }, []);

  function placeCircleObstacle(
    obs: Uint8Array,
    n: number,
    cx: number,
    cy: number,
    r: number,
  ): void {
    obs.fill(0);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const dx = i - cx;
        const dy = j - cy;
        if (dx * dx + dy * dy < r * r) {
          obs[ix(i, j, n)] = 1;
        }
      }
    }
  }

  useEffect(() => {
    initSim(gridSize);
  }, [gridSize, initSim]);

  /* ---------------------------------------------------------------
     Main simulation + render loop
     --------------------------------------------------------------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    let running = true;

    const loop = () => {
      if (!running) return;
      const sim = simRef.current;
      if (!sim) { animRef.current = requestAnimationFrame(loop); return; }

      const n = sim.n;

      // FPS tracking
      fpsRef.current.frames++;
      const now = performance.now();
      if (now - fpsRef.current.lastTime >= 1000) {
        setFps(fpsRef.current.frames);
        fpsRef.current.frames = 0;
        fpsRef.current.lastTime = now;
      }

      if (!paused) {
        // Apply gravity as a force on velocity
        if (gravity !== 0) {
          for (let j = 1; j < n - 1; j++) {
            for (let i = 1; i < n - 1; i++) {
              const idx = ix(i, j, n);
              if (!sim.obstacles[idx]) {
                sim.vPrev[idx] += gravity * 0.01;
              }
            }
          }
        }

        // Wind tunnel: constant inflow from left
        if (windInflow) {
          for (let j = Math.floor(n * 0.3); j < Math.floor(n * 0.7); j++) {
            const idx = ix(2, j, n);
            sim.uPrev[idx] = 5.0;
            sim.densPrev[idx] = 3.0;
          }
        }

        for (let s = 0; s < speed; s++) {
          stepFluid(sim, n);
        }
      }

      render(ctx, canvas, sim, n);
      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
    };
  }, [paused, speed, gravity, windInflow, visMode, colorMode, customHue, viscosity, diffusion]);

  const stepFluid = useCallback((sim: NonNullable<typeof simRef.current>, n: number) => {
    const size = n * n;

    // Velocity step
    addSource(sim.u, sim.uPrev, DT, size);
    addSource(sim.v, sim.vPrev, DT, size);

    // Swap u <-> uPrev, v <-> vPrev
    [sim.u, sim.uPrev] = [sim.uPrev, sim.u];
    diffuse(1, sim.u, sim.uPrev, viscosity, DT, n, sim.obstacles);
    [sim.v, sim.vPrev] = [sim.vPrev, sim.v];
    diffuse(2, sim.v, sim.vPrev, viscosity, DT, n, sim.obstacles);

    project(sim.u, sim.v, sim.pressure, sim.divField, n, sim.obstacles);

    [sim.u, sim.uPrev] = [sim.uPrev, sim.u];
    [sim.v, sim.vPrev] = [sim.vPrev, sim.v];
    advect(1, sim.u, sim.uPrev, sim.uPrev, sim.vPrev, DT, n, sim.obstacles);
    advect(2, sim.v, sim.vPrev, sim.uPrev, sim.vPrev, DT, n, sim.obstacles);
    project(sim.u, sim.v, sim.pressure, sim.divField, n, sim.obstacles);

    // Density step
    addSource(sim.dens, sim.densPrev, DT, size);
    [sim.dens, sim.densPrev] = [sim.densPrev, sim.dens];
    diffuse(0, sim.dens, sim.densPrev, diffusion, DT, n, sim.obstacles);
    [sim.dens, sim.densPrev] = [sim.densPrev, sim.dens];
    advect(0, sim.dens, sim.densPrev, sim.u, sim.v, DT, n, sim.obstacles);

    // Clear source fields
    sim.uPrev.fill(0);
    sim.vPrev.fill(0);
    sim.densPrev.fill(0);

    // Dissipate density slightly
    for (let i = 0; i < size; i++) {
      sim.dens[i] *= 0.995;
    }
  }, [viscosity, diffusion]);

  /* ---------------------------------------------------------------
     Render
     --------------------------------------------------------------- */

  const render = useCallback((
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    sim: NonNullable<typeof simRef.current>,
    n: number,
  ) => {
    const cw = canvas.width;
    const ch = canvas.height;
    const cellW = cw / n;
    const cellH = ch / n;

    // Resolve background color from CSS
    const bgColor = getComputedStyle(canvas).getPropertyValue("--color-bg").trim() || "#09090b";
    const bgIsLight = bgColor.startsWith("#f") || bgColor.startsWith("#e") || bgColor.startsWith("#d");

    const imgData = ctx.createImageData(cw, ch);
    const pixels = imgData.data;

    // Parse bg for fill
    const bgR = parseInt(bgColor.slice(1, 3), 16) || 9;
    const bgG = parseInt(bgColor.slice(3, 5), 16) || 9;
    const bgB = parseInt(bgColor.slice(5, 7), 16) || 11;

    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const idx = ix(i, j, n);
        let r: number, g: number, b: number;

        if (sim.obstacles[idx]) {
          r = bgIsLight ? 80 : 180;
          g = bgIsLight ? 80 : 180;
          b = bgIsLight ? 90 : 200;
        } else {
          switch (visMode) {
            case "dye": {
              const d = sim.dens[idx];
              if (d < 0.001) { r = bgR; g = bgG; b = bgB; }
              else { [r, g, b] = densityToColor(d, colorMode, customHue); }
              break;
            }
            case "velocity": {
              const mag = Math.sqrt(sim.u[idx] ** 2 + sim.v[idx] ** 2);
              if (mag < 0.0001) { r = bgR; g = bgG; b = bgB; }
              else { [r, g, b] = velocityToColor(mag); }
              break;
            }
            case "pressure": {
              const p = sim.pressure[idx];
              if (Math.abs(p) < 0.0001) { r = bgR; g = bgG; b = bgB; }
              else { [r, g, b] = pressureToColor(p); }
              break;
            }
            case "arrows": {
              const d = sim.dens[idx];
              if (d < 0.001) { r = bgR; g = bgG; b = bgB; }
              else { [r, g, b] = densityToColor(d, colorMode, customHue); }
              break;
            }
          }
        }

        // Fill all pixels for this cell
        const px0 = Math.floor(i * cellW);
        const py0 = Math.floor(j * cellH);
        const px1 = Math.floor((i + 1) * cellW);
        const py1 = Math.floor((j + 1) * cellH);
        for (let py = py0; py < py1 && py < ch; py++) {
          for (let px = px0; px < px1 && px < cw; px++) {
            const pIdx = (py * cw + px) * 4;
            pixels[pIdx] = r;
            pixels[pIdx + 1] = g;
            pixels[pIdx + 2] = b;
            pixels[pIdx + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // Arrow overlay for velocity vector field
    if (visMode === "arrows") {
      const step = Math.max(2, Math.floor(n / 32));
      const arrowColor = bgIsLight ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.6)";
      ctx.strokeStyle = arrowColor;
      ctx.fillStyle = arrowColor;
      ctx.lineWidth = 1;
      for (let j = step; j < n - 1; j += step) {
        for (let i = step; i < n - 1; i += step) {
          const idx = ix(i, j, n);
          const ux = sim.u[idx];
          const vy = sim.v[idx];
          const mag = Math.sqrt(ux * ux + vy * vy);
          if (mag < 0.001) continue;
          const sx = (i + 0.5) * cellW;
          const sy = (j + 0.5) * cellH;
          const scale = cellW * step * 0.8;
          const ex = sx + (ux / Math.max(mag, 0.1)) * mag * scale;
          const ey = sy + (vy / Math.max(mag, 0.1)) * mag * scale;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          // Arrowhead
          const angle = Math.atan2(ey - sy, ex - sx);
          const headLen = 4;
          ctx.beginPath();
          ctx.moveTo(ex, ey);
          ctx.lineTo(
            ex - headLen * Math.cos(angle - 0.4),
            ey - headLen * Math.sin(angle - 0.4),
          );
          ctx.lineTo(
            ex - headLen * Math.cos(angle + 0.4),
            ey - headLen * Math.sin(angle + 0.4),
          );
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // Draw obstacle circle outline
    ctx.strokeStyle = bgIsLight ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.3)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(
      sim.obstacleX * cellW,
      sim.obstacleY * cellH,
      sim.obstacleR * cellW,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }, [visMode, colorMode, customHue]);

  /* ---------------------------------------------------------------
     Mouse / pointer interaction
     --------------------------------------------------------------- */

  const getSimCoords = useCallback((e: MouseEvent): [number, number] => {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    const sim = simRef.current;
    if (!sim) return [0, 0];
    const n = sim.n;
    const x = ((e.clientX - rect.left) / rect.width) * n;
    const y = ((e.clientY - rect.top) / rect.height) * n;
    return [x, y];
  }, []);

  const handlePointerDown = useCallback((e: MouseEvent) => {
    e.preventDefault();
    const sim = simRef.current;
    if (!sim) return;
    const [mx, my] = getSimCoords(e);

    if (e.button === 2) {
      // Right click: check if near obstacle center to drag it
      const dx = mx - sim.obstacleX;
      const dy = my - sim.obstacleY;
      if (dx * dx + dy * dy < (sim.obstacleR + 2) * (sim.obstacleR + 2)) {
        sim.rightDragging = true;
      }
    } else {
      sim.dragging = true;
    }
    sim.lastMx = mx;
    sim.lastMy = my;
  }, [getSimCoords]);

  const handlePointerMove = useCallback((e: MouseEvent) => {
    const sim = simRef.current;
    if (!sim) return;
    if (!sim.dragging && !sim.rightDragging) return;

    const [mx, my] = getSimCoords(e);
    const n = sim.n;

    if (sim.rightDragging) {
      // Move obstacle
      sim.obstacleX = Math.max(sim.obstacleR + 1, Math.min(n - sim.obstacleR - 1, mx));
      sim.obstacleY = Math.max(sim.obstacleR + 1, Math.min(n - sim.obstacleR - 1, my));
      placeCircleObstacle(sim.obstacles, n, sim.obstacleX, sim.obstacleY, sim.obstacleR);
    } else if (sim.dragging) {
      const dx = mx - sim.lastMx;
      const dy = my - sim.lastMy;
      const radius = Math.max(1, Math.floor(n / 40));

      const ci = Math.floor(mx);
      const cj = Math.floor(my);
      for (let dj = -radius; dj <= radius; dj++) {
        for (let di = -radius; di <= radius; di++) {
          const gi = ci + di;
          const gj = cj + dj;
          if (gi < 1 || gi >= n - 1 || gj < 1 || gj >= n - 1) continue;
          if (di * di + dj * dj > radius * radius) continue;
          const idx = ix(gi, gj, n);
          if (sim.obstacles[idx]) continue;
          const factor = 1 - Math.sqrt(di * di + dj * dj) / (radius + 1);
          sim.uPrev[idx] += dx * 50 * factor;
          sim.vPrev[idx] += dy * 50 * factor;
          sim.densPrev[idx] += 8 * factor;
        }
      }
    }
    sim.lastMx = mx;
    sim.lastMy = my;
  }, [getSimCoords]);

  const handlePointerUp = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    sim.dragging = false;
    sim.rightDragging = false;
  }, []);

  const handleContextMenu = useCallback((e: Event) => {
    e.preventDefault();
  }, []);

  /* ---------------------------------------------------------------
     Canvas sizing
     --------------------------------------------------------------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const resize = () => {
      const w = wrapper.clientWidth;
      const h = Math.min(w, 600);
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
    };

    resize();
    const obs = new ResizeObserver(resize);
    obs.observe(wrapper);
    return () => obs.disconnect();
  }, []);

  /* ---------------------------------------------------------------
     Fullscreen
     --------------------------------------------------------------- */

  const toggleFullscreen = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  /* ---------------------------------------------------------------
     Actions
     --------------------------------------------------------------- */

  const handleClear = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    sim.dens.fill(0);
    sim.densPrev.fill(0);
  }, []);

  const handleReset = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    const n = sim.n;
    sim.u.fill(0);
    sim.v.fill(0);
    sim.uPrev.fill(0);
    sim.vPrev.fill(0);
    sim.dens.fill(0);
    sim.densPrev.fill(0);
    sim.pressure.fill(0);
    sim.divField.fill(0);
    sim.obstacleX = n * 0.3;
    sim.obstacleY = n * 0.5;
    sim.obstacleR = n * 0.06;
    placeCircleObstacle(sim.obstacles, n, sim.obstacleX, sim.obstacleY, sim.obstacleR);
  }, []);

  const applyPreset = useCallback((key: PresetKey) => {
    const p = PRESETS[key];
    setViscosity(p.viscosity);
    setDiffusion(p.diffusion);
    setGravity(p.gravity);
    setWindInflow(p.inflow);
    handleReset();
  }, [handleReset]);

  /* ---------------------------------------------------------------
     UI
     --------------------------------------------------------------- */

  const sBtn =
    "rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)]/40 hover:text-[var(--color-primary)]";
  const sBtnActive =
    "rounded border border-[var(--color-primary)] bg-[var(--color-primary)]/10 px-3 py-1.5 text-xs font-medium text-[var(--color-primary)]";

  return (
    <div class="space-y-4">
      {/* Toolbar row */}
      <div class="flex flex-wrap items-center gap-2">
        {/* Vis mode */}
        <div class="flex gap-1">
          {(["dye", "velocity", "pressure", "arrows"] as VisMode[]).map((m) => (
            <button
              key={m}
              class={visMode === m ? sBtnActive : sBtn}
              onClick={() => setVisMode(m)}
            >
              {m === "dye" ? "Dye" : m === "velocity" ? "Velocity" : m === "pressure" ? "Pressure" : "Arrows"}
            </button>
          ))}
        </div>

        <div class="mx-1 h-5 w-px bg-[var(--color-border)]" />

        {/* Color mode */}
        <div class="flex gap-1">
          {(["rainbow", "smoke", "temperature", "custom"] as ColorMode[]).map((m) => (
            <button
              key={m}
              class={colorMode === m ? sBtnActive : sBtn}
              onClick={() => setColorMode(m)}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        {colorMode === "custom" && (
          <input
            type="range"
            min={0}
            max={360}
            value={customHue}
            onInput={(e) => setCustomHue(Number((e.target as HTMLInputElement).value))}
            class="w-20"
            title={`Hue: ${customHue}`}
          />
        )}

        <div class="ml-auto flex gap-1">
          <button class={sBtn} onClick={() => setPaused(!paused)}>
            {paused ? "Play" : "Pause"}
          </button>
          <button class={sBtn} onClick={handleClear}>Clear Dye</button>
          <button class={sBtn} onClick={handleReset}>Reset</button>
          <button class={sBtn} onClick={toggleFullscreen}>
            {isFullscreen ? "Exit FS" : "Fullscreen"}
          </button>
        </div>
      </div>

      {/* Presets */}
      <div class="flex flex-wrap gap-2">
        <span class="self-center text-xs text-[var(--color-text-muted)]">Presets:</span>
        {(Object.keys(PRESETS) as PresetKey[]).map((key) => (
          <button key={key} class={sBtn} onClick={() => applyPreset(key)}>
            {PRESETS[key].label}
          </button>
        ))}
      </div>

      {/* Canvas */}
      <div
        ref={wrapperRef}
        class="relative overflow-hidden rounded-lg border border-[var(--color-border)]"
        style={{ background: "var(--color-bg)" }}
      >
        <canvas
          ref={canvasRef}
          class="block cursor-crosshair"
          style={{ "--color-bg": "var(--color-bg)" } as any}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onMouseLeave={handlePointerUp}
          onContextMenu={handleContextMenu}
        />
        <div class="absolute right-2 top-2 rounded bg-black/50 px-2 py-0.5 text-[10px] font-mono text-white/70">
          {fps} fps | {gridSize}x{gridSize}
        </div>
      </div>

      {/* Controls */}
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Viscosity */}
        <label class="block">
          <span class="mb-1 block text-xs text-[var(--color-text-muted)]">
            Viscosity: {viscosity.toFixed(5)}
          </span>
          <input
            type="range"
            min={0.00001}
            max={0.01}
            step={0.00001}
            value={viscosity}
            onInput={(e) => setViscosity(Number((e.target as HTMLInputElement).value))}
            class="w-full"
          />
        </label>

        {/* Diffusion */}
        <label class="block">
          <span class="mb-1 block text-xs text-[var(--color-text-muted)]">
            Diffusion: {diffusion.toFixed(5)}
          </span>
          <input
            type="range"
            min={0.00001}
            max={0.01}
            step={0.00001}
            value={diffusion}
            onInput={(e) => setDiffusion(Number((e.target as HTMLInputElement).value))}
            class="w-full"
          />
        </label>

        {/* Grid resolution */}
        <label class="block">
          <span class="mb-1 block text-xs text-[var(--color-text-muted)]">
            Resolution: {gridSize}
          </span>
          <select
            class="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)]"
            value={gridSize}
            onChange={(e) => setGridSize(Number((e.target as HTMLSelectElement).value))}
          >
            <option value={64}>64 (fast)</option>
            <option value={128}>128 (balanced)</option>
            <option value={256}>256 (detailed)</option>
          </select>
        </label>

        {/* Speed */}
        <label class="block">
          <span class="mb-1 block text-xs text-[var(--color-text-muted)]">
            Sim Speed: {speed}x
          </span>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={speed}
            onInput={(e) => setSpeed(Number((e.target as HTMLInputElement).value))}
            class="w-full"
          />
        </label>
      </div>

      {/* Help text */}
      <div class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-xs leading-relaxed text-[var(--color-text-muted)]">
        <strong class="text-[var(--color-heading)]">Controls:</strong>{" "}
        Left-click drag to inject dye and velocity.
        Right-click drag near the obstacle to reposition it.
        Use presets to try different flow configurations.
      </div>
    </div>
  );
}
