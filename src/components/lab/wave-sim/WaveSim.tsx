import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ══════════════════════════════════════════════════════════
   Types & Constants
   ══════════════════════════════════════════════════════════ */

const PRESETS = {
  ripple: "Ripple Tank",
  single_slit: "Single Slit Diffraction",
  double_slit: "Double Slit Interference",
  doppler: "Doppler Effect",
  reflection: "Reflection",
  refraction: "Refraction",
} as const;

type PresetKey = keyof typeof PRESETS;

interface ContinuousSource {
  x: number;
  y: number;
  frequency: number;
  phase: number;
  amplitude: number;
  moving?: { vx: number; vy: number };
}

interface ProbeData {
  x: number;
  y: number;
  amplitude: number;
  gridX: number;
  gridY: number;
}

type ViewMode = "2d" | "3d";

/* ══════════════════════════════════════════════════════════
   Wave Engine (pure functions operating on Float32Arrays)
   ══════════════════════════════════════════════════════════ */

function createGrid(size: number): Float32Array {
  return new Float32Array(size * size);
}

function stepWaveEquation(
  curr: Float32Array,
  prev: Float32Array,
  next: Float32Array,
  walls: Uint8Array,
  width: number,
  height: number,
  c: number,
  damping: number,
  dt: number,
  speedMap: Float32Array | null,
): void {
  const c2dt2 = c * c * dt * dt;
  const damp = 1.0 - damping;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (walls[i]) {
        next[i] = 0;
        continue;
      }

      const localC2 = speedMap ? speedMap[i] * speedMap[i] * dt * dt : c2dt2;

      const laplacian =
        curr[i - 1] + curr[i + 1] + curr[i - width] + curr[i + width] -
        4.0 * curr[i];

      next[i] = (2.0 * curr[i] - prev[i] + localC2 * laplacian) * damp;
    }
  }

  applyAbsorbingBoundary(next, width, height);
}

function applyAbsorbingBoundary(
  grid: Float32Array,
  width: number,
  height: number,
): void {
  const fade = 0.95;
  for (let x = 0; x < width; x++) {
    grid[x] *= fade;
    grid[(height - 1) * width + x] *= fade;
  }
  for (let y = 0; y < height; y++) {
    grid[y * width] *= fade;
    grid[y * width + width - 1] *= fade;
  }
}

function addImpulse(
  grid: Float32Array,
  width: number,
  gx: number,
  gy: number,
  radius: number,
  strength: number,
): void {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const dist2 = dx * dx + dy * dy;
      if (dist2 > r2) continue;
      const nx = gx + dx;
      const ny = gy + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= width) continue;
      const factor = 1.0 - dist2 / r2;
      grid[ny * width + nx] += strength * factor;
    }
  }
}

function placeWallLine(
  walls: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0;
  let cy = y0;

  while (true) {
    if (cx >= 0 && cx < width && cy >= 0 && cy < height) {
      walls[cy * width + cx] = 1;
    }
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      cx += sx;
    }
    if (e2 < dx) {
      err += dx;
      cy += sy;
    }
  }
}

/* ══════════════════════════════════════════════════════════
   Rendering
   ══════════════════════════════════════════════════════════ */

function renderWave2D(
  pixels: Uint8ClampedArray,
  curr: Float32Array,
  walls: Uint8Array,
  width: number,
  height: number,
  wallColor: [number, number, number],
): void {
  for (let i = 0; i < width * height; i++) {
    const pi = i * 4;

    if (walls[i]) {
      pixels[pi] = wallColor[0];
      pixels[pi + 1] = wallColor[1];
      pixels[pi + 2] = wallColor[2];
      pixels[pi + 3] = 255;
      continue;
    }

    const v = curr[i];
    const clamped = Math.max(-1, Math.min(1, v));

    let r: number, g: number, b: number;
    if (clamped > 0) {
      // Positive: white → red
      r = 255;
      g = Math.floor(255 * (1 - clamped));
      b = Math.floor(255 * (1 - clamped));
    } else {
      // Negative: white → blue
      const a = -clamped;
      r = Math.floor(255 * (1 - a));
      g = Math.floor(255 * (1 - a));
      b = 255;
    }

    pixels[pi] = r;
    pixels[pi + 1] = g;
    pixels[pi + 2] = b;
    pixels[pi + 3] = 255;
  }
}

function render3DPerspective(
  ctx: CanvasRenderingContext2D,
  curr: Float32Array,
  walls: Uint8Array,
  gridSize: number,
  canvasW: number,
  canvasH: number,
): void {
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, canvasW, canvasH);

  const step = Math.max(2, Math.floor(gridSize / 120));
  const scaleX = canvasW / (gridSize * 1.4);
  const scaleY = canvasH / (gridSize * 1.0);
  const heightScale = 40;
  const offsetX = canvasW * 0.15;
  const offsetY = canvasH * 0.35;

  for (let gy = gridSize - 1; gy >= 0; gy -= step) {
    ctx.beginPath();
    let started = false;

    for (let gx = 0; gx < gridSize; gx += step) {
      const idx = gy * gridSize + gx;
      const v = walls[idx] ? 0.5 : curr[idx];

      const isoX = (gx - gy) * 0.7 * scaleX + offsetX + canvasW * 0.35;
      const isoY =
        (gx + gy) * 0.35 * scaleY + offsetY - v * heightScale;

      if (!started) {
        ctx.moveTo(isoX, isoY);
        started = true;
      } else {
        ctx.lineTo(isoX, isoY);
      }
    }

    const clamped = Math.abs(
      curr[gy * gridSize + Math.floor(gridSize / 2)] || 0,
    );
    const intensity = Math.min(1, clamped * 3);
    const r = Math.floor(80 + 175 * intensity);
    const b = Math.floor(180 + 75 * (1 - intensity));
    ctx.strokeStyle = `rgb(${r}, ${Math.floor(100 + 100 * (1 - intensity))}, ${b})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/* ══════════════════════════════════════════════════════════
   Preset Setup
   ══════════════════════════════════════════════════════════ */

function setupPreset(
  preset: PresetKey,
  gridSize: number,
  walls: Uint8Array,
  speedMap: Float32Array | null,
  c: number,
): ContinuousSource[] {
  walls.fill(0);
  const sources: ContinuousSource[] = [];
  const mid = Math.floor(gridSize / 2);

  switch (preset) {
    case "ripple":
      // Open tank, user clicks to add impulses
      break;

    case "single_slit": {
      const slitWidth = Math.max(6, Math.floor(gridSize * 0.06));
      const barrierX = Math.floor(gridSize * 0.4);
      for (let y = 0; y < gridSize; y++) {
        if (Math.abs(y - mid) > slitWidth / 2) {
          walls[y * gridSize + barrierX] = 1;
          if (barrierX + 1 < gridSize) walls[y * gridSize + barrierX + 1] = 1;
        }
      }
      sources.push({
        x: Math.floor(gridSize * 0.15),
        y: mid,
        frequency: 0.15,
        phase: 0,
        amplitude: 0.8,
      });
      break;
    }

    case "double_slit": {
      const slitW = Math.max(5, Math.floor(gridSize * 0.04));
      const slitSep = Math.max(12, Math.floor(gridSize * 0.12));
      const bx = Math.floor(gridSize * 0.4);
      for (let y = 0; y < gridSize; y++) {
        const dy = y - mid;
        const inSlit1 = Math.abs(dy - slitSep / 2) < slitW / 2;
        const inSlit2 = Math.abs(dy + slitSep / 2) < slitW / 2;
        if (!inSlit1 && !inSlit2) {
          walls[y * gridSize + bx] = 1;
          if (bx + 1 < gridSize) walls[y * gridSize + bx + 1] = 1;
        }
      }
      sources.push({
        x: Math.floor(gridSize * 0.15),
        y: mid,
        frequency: 0.15,
        phase: 0,
        amplitude: 0.8,
      });
      break;
    }

    case "doppler":
      sources.push({
        x: Math.floor(gridSize * 0.2),
        y: mid,
        frequency: 0.2,
        phase: 0,
        amplitude: 0.6,
        moving: { vx: 0.3, vy: 0 },
      });
      break;

    case "reflection":
      // Wall on right side
      for (let y = 0; y < gridSize; y++) {
        const wx = Math.floor(gridSize * 0.8);
        walls[y * gridSize + wx] = 1;
        walls[y * gridSize + wx + 1] = 1;
      }
      sources.push({
        x: Math.floor(gridSize * 0.3),
        y: mid,
        frequency: 0.12,
        phase: 0,
        amplitude: 0.7,
      });
      break;

    case "refraction":
      // Right half has different speed -- set speedMap
      if (speedMap) {
        for (let y = 0; y < gridSize; y++) {
          for (let x = 0; x < gridSize; x++) {
            speedMap[y * gridSize + x] = x > mid ? c * 0.5 : c;
          }
        }
      }
      sources.push({
        x: Math.floor(gridSize * 0.15),
        y: mid,
        frequency: 0.12,
        phase: 0,
        amplitude: 0.7,
      });
      break;
  }

  return sources;
}

/* ══════════════════════════════════════════════════════════
   Component
   ══════════════════════════════════════════════════════════ */

const CANVAS_SIZE = 600;

export default function WaveSim() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  // Simulation state refs (not in React state for performance)
  const simRef = useRef<{
    gridSize: number;
    curr: Float32Array;
    prev: Float32Array;
    next: Float32Array;
    walls: Uint8Array;
    speedMap: Float32Array | null;
    sources: ContinuousSource[];
    time: number;
    running: boolean;
  } | null>(null);

  // UI state
  const [preset, setPreset] = useState<PresetKey>("ripple");
  const [gridSize, setGridSize] = useState(200);
  const [waveSpeed, setWaveSpeed] = useState(0.5);
  const [damping, setDamping] = useState(0.002);
  const [sourceFreq, setSourceFreq] = useState(0.15);
  const [simSpeed, setSimSpeed] = useState(3);
  const [viewMode, setViewMode] = useState<ViewMode>("2d");
  const [running, setRunning] = useState(true);
  const [probe, setProbe] = useState<ProbeData | null>(null);
  const [showSources, setShowSources] = useState(false);

  // Mouse interaction refs
  const isDragging = useRef(false);
  const isRightDrag = useRef(false);
  const lastWallPos = useRef<{ gx: number; gy: number } | null>(null);

  /* ── Initialize simulation ── */
  const initSim = useCallback(
    (presetKey: PresetKey, size: number, c: number, freq: number) => {
      const curr = createGrid(size);
      const prev = createGrid(size);
      const next = createGrid(size);
      const walls = new Uint8Array(size * size);
      const useSpeedMap = presetKey === "refraction";
      const speedMap = useSpeedMap ? new Float32Array(size * size) : null;

      if (speedMap) speedMap.fill(c);

      const sources = setupPreset(presetKey, size, walls, speedMap, c);

      // Update source frequencies to match control
      for (const src of sources) {
        src.frequency = freq;
      }

      simRef.current = {
        gridSize: size,
        curr,
        prev,
        next,
        walls,
        speedMap,
        sources,
        time: 0,
        running: true,
      };
    },
    [],
  );

  /* ── Reset handler ── */
  const handleReset = useCallback(() => {
    initSim(preset, gridSize, waveSpeed, sourceFreq);
    setRunning(true);
  }, [preset, gridSize, waveSpeed, sourceFreq, initSim]);

  /* ── Clear handler ── */
  const handleClear = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    sim.curr.fill(0);
    sim.prev.fill(0);
    sim.next.fill(0);
    sim.time = 0;
  }, []);

  /* ── Canvas coordinate mapping ── */
  const canvasToGrid = useCallback(
    (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const sim = simRef.current;
      if (!sim) return null;
      const scaleX = sim.gridSize / rect.width;
      const scaleY = sim.gridSize / rect.height;
      const gx = Math.floor((clientX - rect.left) * scaleX);
      const gy = Math.floor((clientY - rect.top) * scaleY);
      if (gx < 0 || gx >= sim.gridSize || gy < 0 || gy >= sim.gridSize)
        return null;
      return { gx, gy };
    },
    [],
  );

  /* ── Mouse handlers ── */
  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas || !simRef.current) return;
      canvas.setPointerCapture(e.pointerId);

      const pos = canvasToGrid(canvas, e.clientX, e.clientY);
      if (!pos) return;

      if (e.button === 2) {
        // Right-click: place walls
        isRightDrag.current = true;
        lastWallPos.current = pos;
        simRef.current.walls[pos.gy * simRef.current.gridSize + pos.gx] = 1;
      } else {
        // Left-click: drop impulse
        isDragging.current = true;
        addImpulse(
          simRef.current.curr,
          simRef.current.gridSize,
          pos.gx,
          pos.gy,
          Math.max(2, Math.floor(simRef.current.gridSize * 0.015)),
          1.0,
        );
      }
    },
    [canvasToGrid],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas || !simRef.current) return;

      const pos = canvasToGrid(canvas, e.clientX, e.clientY);
      if (!pos) {
        setProbe(null);
        return;
      }

      // Update probe
      const idx = pos.gy * simRef.current.gridSize + pos.gx;
      setProbe({
        x: e.clientX,
        y: e.clientY,
        amplitude: simRef.current.curr[idx],
        gridX: pos.gx,
        gridY: pos.gy,
      });

      if (isDragging.current) {
        addImpulse(
          simRef.current.curr,
          simRef.current.gridSize,
          pos.gx,
          pos.gy,
          Math.max(2, Math.floor(simRef.current.gridSize * 0.012)),
          0.5,
        );
      }

      if (isRightDrag.current) {
        const prev = lastWallPos.current;
        if (prev) {
          placeWallLine(
            simRef.current.walls,
            simRef.current.gridSize,
            simRef.current.gridSize,
            prev.gx,
            prev.gy,
            pos.gx,
            pos.gy,
          );
        }
        lastWallPos.current = pos;
      }
    },
    [canvasToGrid],
  );

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
    isRightDrag.current = false;
    lastWallPos.current = null;
  }, []);

  const handleContextMenu = useCallback((e: Event) => {
    e.preventDefault();
  }, []);

  /* ── Toggle continuous source ── */
  const toggleSource = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    if (sim.sources.length > 0) {
      sim.sources = [];
      setShowSources(false);
    } else {
      const mid = Math.floor(sim.gridSize / 2);
      sim.sources.push({
        x: Math.floor(sim.gridSize * 0.15),
        y: mid,
        frequency: sourceFreq,
        phase: 0,
        amplitude: 0.7,
      });
      setShowSources(true);
    }
  }, [sourceFreq]);

  /* ── Init on mount and preset/grid change ── */
  useEffect(() => {
    initSim(preset, gridSize, waveSpeed, sourceFreq);
  }, [preset, gridSize, initSim, waveSpeed, sourceFreq]);

  /* ── Sync running state ── */
  useEffect(() => {
    if (simRef.current) {
      simRef.current.running = running;
    }
  }, [running]);

  /* ── Animation loop ── */
  useEffect(() => {
    const cvsRaw = canvasRef.current;
    if (!cvsRaw) return;

    const ctxRaw = cvsRaw.getContext("2d", { willReadFrequently: true });
    if (!ctxRaw) return;

    // Capture as non-nullable for the closure (guards above ensure they exist)
    const cvs: HTMLCanvasElement = cvsRaw;
    const context: CanvasRenderingContext2D = ctxRaw;

    let imageData: ImageData | null = null;
    let lastGridSize = 0;

    const wallColorStyle = getComputedStyle(cvs);
    const borderVal = wallColorStyle.getPropertyValue("--color-text-muted").trim();
    const wallRGB = parseRGB(borderVal) || [120, 120, 140];

    function loop() {
      const sim = simRef.current;
      if (!sim) {
        animRef.current = requestAnimationFrame(loop);
        return;
      }

      if (sim.running) {
        for (let s = 0; s < simSpeed; s++) {
          for (const src of sim.sources) {
            if (src.moving) {
              src.x += src.moving.vx;
              src.y += src.moving.vy;
              if (src.x >= sim.gridSize - 2) src.x = 2;
              if (src.x < 2) src.x = sim.gridSize - 3;
              if (src.y >= sim.gridSize - 2) src.y = 2;
              if (src.y < 2) src.y = sim.gridSize - 3;
            }

            const gx = Math.floor(src.x);
            const gy = Math.floor(src.y);
            if (gx >= 0 && gx < sim.gridSize && gy >= 0 && gy < sim.gridSize) {
              const val =
                src.amplitude * Math.sin(sim.time * src.frequency * Math.PI * 2);
              sim.curr[gy * sim.gridSize + gx] = val;
            }
          }

          stepWaveEquation(
            sim.curr,
            sim.prev,
            sim.next,
            sim.walls,
            sim.gridSize,
            sim.gridSize,
            waveSpeed,
            damping,
            1.0,
            sim.speedMap,
          );

          const tmp = sim.prev;
          sim.prev = sim.curr;
          sim.curr = sim.next;
          sim.next = tmp;
          sim.time++;
        }
      }

      // Render
      if (viewMode === "2d") {
        if (!imageData || lastGridSize !== sim.gridSize) {
          cvs.width = sim.gridSize;
          cvs.height = sim.gridSize;
          imageData = context.createImageData(sim.gridSize, sim.gridSize);
          lastGridSize = sim.gridSize;
        }
        renderWave2D(
          imageData.data,
          sim.curr,
          sim.walls,
          sim.gridSize,
          sim.gridSize,
          wallRGB as [number, number, number],
        );
        context.putImageData(imageData, 0, 0);

        // Draw source indicators
        for (const src of sim.sources) {
          context.fillStyle = "rgba(52, 211, 153, 0.8)";
          context.beginPath();
          context.arc(src.x, src.y, Math.max(2, sim.gridSize * 0.012), 0, Math.PI * 2);
          context.fill();
        }
      } else {
        cvs.width = CANVAS_SIZE;
        cvs.height = CANVAS_SIZE;
        render3DPerspective(
          context,
          sim.curr,
          sim.walls,
          sim.gridSize,
          CANVAS_SIZE,
          CANVAS_SIZE,
        );
        imageData = null;
        lastGridSize = 0;
      }

      // Draw refraction boundary indicator
      if (preset === "refraction") {
        const mid = Math.floor(sim.gridSize / 2);
        context.strokeStyle = "rgba(52, 211, 153, 0.4)";
        context.setLineDash([4, 4]);
        context.lineWidth = viewMode === "2d" ? 1 : 2;
        if (viewMode === "2d") {
          context.beginPath();
          context.moveTo(mid, 0);
          context.lineTo(mid, sim.gridSize);
          context.stroke();
        }
        context.setLineDash([]);
      }

      animRef.current = requestAnimationFrame(loop);
    }

    animRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animRef.current);
    };
  }, [viewMode, waveSpeed, damping, simSpeed, preset]);

  /* ── Sync source frequency ── */
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    for (const src of sim.sources) {
      src.frequency = sourceFreq;
    }
  }, [sourceFreq]);

  /* ── Render ── */
  return (
    <div class="space-y-4">
      {/* Preset selector */}
      <div class="flex flex-wrap items-center gap-2">
        {Object.entries(PRESETS).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setPreset(key as PresetKey)}
            class={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
              preset === key
                ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)]/40 hover:text-[var(--color-text)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div class="flex flex-col gap-4 lg:flex-row">
        {/* Canvas */}
        <div class="flex-1">
          <div
            class="relative overflow-hidden rounded-xl border border-[var(--color-border)]"
            style={{ aspectRatio: "1 / 1" }}
          >
            <canvas
              ref={canvasRef}
              class="h-full w-full cursor-crosshair"
              style={{
                imageRendering: viewMode === "2d" ? "pixelated" : "auto",
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={() => {
                handlePointerUp();
                setProbe(null);
              }}
              onContextMenu={handleContextMenu}
            />

            {/* Probe tooltip */}
            {probe && (
              <div
                class="pointer-events-none absolute z-10 rounded-md border border-[var(--color-border)] px-2 py-1 text-[10px] leading-tight"
                style={{
                  left: "8px",
                  bottom: "8px",
                  background:
                    "color-mix(in srgb, var(--color-surface) 90%, transparent)",
                  color: "var(--color-text-muted)",
                }}
              >
                <div>
                  Pos: ({probe.gridX}, {probe.gridY})
                </div>
                <div>Amp: {probe.amplitude.toFixed(4)}</div>
              </div>
            )}

            {/* View mode toggle */}
            <div class="absolute right-2 top-2 flex gap-1">
              <button
                onClick={() => setViewMode("2d")}
                class={`rounded px-2 py-1 text-[10px] font-medium transition-all ${
                  viewMode === "2d"
                    ? "bg-[var(--color-primary)] text-white"
                    : "bg-[var(--color-surface)]/80 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                }`}
                style={{ border: "1px solid var(--color-border)" }}
              >
                2D
              </button>
              <button
                onClick={() => setViewMode("3d")}
                class={`rounded px-2 py-1 text-[10px] font-medium transition-all ${
                  viewMode === "3d"
                    ? "bg-[var(--color-primary)] text-white"
                    : "bg-[var(--color-surface)]/80 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                }`}
                style={{ border: "1px solid var(--color-border)" }}
              >
                3D
              </button>
            </div>
          </div>

          {/* Interaction hint */}
          <p class="mt-2 text-[10px] text-[var(--color-text-muted)]">
            Left-click: drop impulse / drag to emit waves. Right-click / drag:
            place walls.
          </p>
        </div>

        {/* Controls panel */}
        <div
          class="w-full space-y-3 rounded-xl border border-[var(--color-border)] p-4 lg:w-72"
          style={{
            background:
              "color-mix(in srgb, var(--color-surface) 80%, transparent)",
          }}
        >
          <h3 class="text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
            Controls
          </h3>

          {/* Wave Speed */}
          <ControlSlider
            label="Wave Speed (c)"
            value={waveSpeed}
            min={0.1}
            max={1.0}
            step={0.05}
            onChange={setWaveSpeed}
          />

          {/* Damping */}
          <ControlSlider
            label="Damping"
            value={damping}
            min={0}
            max={0.05}
            step={0.001}
            onChange={setDamping}
            decimals={3}
          />

          {/* Grid Resolution */}
          <ControlSlider
            label="Grid Resolution"
            value={gridSize}
            min={100}
            max={400}
            step={50}
            onChange={(v) => setGridSize(Math.round(v))}
            decimals={0}
          />

          {/* Source Frequency */}
          <ControlSlider
            label="Source Frequency"
            value={sourceFreq}
            min={0.02}
            max={0.4}
            step={0.01}
            onChange={setSourceFreq}
          />

          {/* Simulation Speed */}
          <ControlSlider
            label="Steps / Frame"
            value={simSpeed}
            min={1}
            max={10}
            step={1}
            onChange={(v) => setSimSpeed(Math.round(v))}
            decimals={0}
          />

          {/* Action buttons */}
          <div class="flex flex-wrap gap-2 pt-2">
            <button
              onClick={() => setRunning((r) => !r)}
              class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-all hover:border-[var(--color-primary)]/40 hover:text-[var(--color-text)]"
            >
              {running ? "Pause" : "Play"}
            </button>
            <button
              onClick={handleClear}
              class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-all hover:border-[var(--color-primary)]/40 hover:text-[var(--color-text)]"
            >
              Clear
            </button>
            <button
              onClick={handleReset}
              class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-all hover:border-[var(--color-primary)]/40 hover:text-[var(--color-text)]"
            >
              Reset
            </button>
          </div>

          <div class="border-t border-[var(--color-border)] pt-2">
            <button
              onClick={toggleSource}
              class={`w-full rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                showSources || (simRef.current?.sources.length ?? 0) > 0
                  ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                  : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-accent)]/40"
              }`}
            >
              {(simRef.current?.sources.length ?? 0) > 0
                ? "Remove Sources"
                : "Add Source"}
            </button>
          </div>

          {/* Legend */}
          <div class="border-t border-[var(--color-border)] pt-2">
            <p class="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Color Map
            </p>
            <div class="flex items-center gap-1">
              <div
                class="h-3 flex-1 rounded"
                style={{
                  background:
                    "linear-gradient(to right, #0000ff, #ffffff, #ff0000)",
                }}
              />
            </div>
            <div class="mt-0.5 flex justify-between text-[9px] text-[var(--color-text-muted)]">
              <span>Trough</span>
              <span>Zero</span>
              <span>Crest</span>
            </div>
          </div>

          {/* Info for current preset */}
          <div class="border-t border-[var(--color-border)] pt-2">
            <p class="text-[10px] leading-relaxed text-[var(--color-text-muted)]">
              {presetDescription(preset)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Sub-components
   ══════════════════════════════════════════════════════════ */

interface ControlSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  decimals?: number;
}

function ControlSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  decimals = 2,
}: ControlSliderProps) {
  return (
    <div>
      <div class="flex items-center justify-between">
        <label class="text-[10px] font-medium text-[var(--color-text-muted)]">
          {label}
        </label>
        <span class="text-[10px] font-mono text-[var(--color-heading)]">
          {value.toFixed(decimals)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(e) => onChange(parseFloat((e.target as HTMLInputElement).value))}
        class="mt-1 w-full accent-[var(--color-primary)]"
      />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Helpers
   ══════════════════════════════════════════════════════════ */

function presetDescription(preset: PresetKey): string {
  switch (preset) {
    case "ripple":
      return "Open ripple tank. Click anywhere to drop stones and create circular waves. Drag for continuous emission.";
    case "single_slit":
      return "A barrier with a single opening demonstrates diffraction -- waves bend around the edges of the slit.";
    case "double_slit":
      return "Young's double slit experiment. Coherent waves pass through two slits creating an interference pattern on the far side.";
    case "doppler":
      return "A moving source emits waves. Wavefronts compress ahead (higher frequency) and stretch behind (lower frequency).";
    case "reflection":
      return "Waves reflect off a solid wall on the right side, demonstrating standing wave formation.";
    case "refraction":
      return "The right half has slower wave speed (dashed line = boundary). Waves change direction when crossing -- Snell's law in action.";
  }
}

function parseRGB(cssColor: string): [number, number, number] | null {
  if (!cssColor) return null;

  // Try hex
  const hexMatch = cssColor.match(
    /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i,
  );
  if (hexMatch) {
    return [
      parseInt(hexMatch[1], 16),
      parseInt(hexMatch[2], 16),
      parseInt(hexMatch[3], 16),
    ];
  }

  // Try rgb(r, g, b)
  const rgbMatch = cssColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgbMatch) {
    return [
      parseInt(rgbMatch[1]),
      parseInt(rgbMatch[2]),
      parseInt(rgbMatch[3]),
    ];
  }

  return null;
}
