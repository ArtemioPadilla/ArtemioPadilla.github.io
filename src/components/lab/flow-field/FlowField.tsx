import { useState, useEffect, useRef, useCallback } from "preact/hooks";

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

interface Particle {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  speed: number;
  life: number;
}

type PaletteId = "ocean" | "fire" | "forest" | "neon" | "monochrome";

interface FlowParams {
  noiseScale: number;
  particleCount: number;
  speed: number;
  trailOpacity: number;
  seed: number;
  palette: PaletteId;
}

// ═══════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════

const CANVAS_W = 800;
const CANVAS_H = 600;

const PALETTES: Record<PaletteId, string[]> = {
  ocean: ["#0077b6", "#0096c7", "#00b4d8", "#48cae4", "#90e0ef", "#ade8f4"],
  fire: ["#d00000", "#dc2f02", "#e85d04", "#f48c06", "#faa307", "#ffba08"],
  forest: ["#2d6a4f", "#40916c", "#52b788", "#74c69d", "#95d5b2", "#b7e4c7"],
  neon: ["#f72585", "#7209b7", "#3a0ca3", "#4361ee", "#4cc9f0", "#80ffdb"],
  monochrome: ["#f8f9fa", "#dee2e6", "#adb5bd", "#6c757d", "#495057", "#343a40"],
};

const PALETTE_LABELS: Record<PaletteId, string> = {
  ocean: "Ocean",
  fire: "Fire",
  forest: "Forest",
  neon: "Neon",
  monochrome: "Mono",
};

const DEFAULT_PARAMS: FlowParams = {
  noiseScale: 0.005,
  particleCount: 2000,
  speed: 2,
  trailOpacity: 0.04,
  seed: 42,
  palette: "neon",
};

// ═══════════════════════════════════════════════════════════
// Simplex-like noise (hash-based gradient noise)
// ═══════════════════════════════════════════════════════════

function buildPermTable(seed: number): Uint8Array {
  const perm = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  let s = seed | 0;
  for (let i = 255; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    const tmp = base[i];
    base[i] = base[j];
    base[j] = tmp;
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
  return perm;
}

const GRAD2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function perlin2d(x: number, y: number, perm: Uint8Array): number {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);
  const aa = perm[perm[xi] + yi];
  const ab = perm[perm[xi] + yi + 1];
  const ba = perm[perm[xi + 1] + yi];
  const bb = perm[perm[xi + 1] + yi + 1];
  const g00 = GRAD2[aa & 7];
  const g10 = GRAD2[ba & 7];
  const g01 = GRAD2[ab & 7];
  const g11 = GRAD2[bb & 7];
  const n00 = g00[0] * xf + g00[1] * yf;
  const n10 = g10[0] * (xf - 1) + g10[1] * yf;
  const n01 = g01[0] * xf + g01[1] * (yf - 1);
  const n11 = g11[0] * (xf - 1) + g11[1] * (yf - 1);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}

// ═══════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════

const panelStyle: Record<string, string> = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  padding: "1rem",
};

const btnStyle: Record<string, string> = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.375rem",
  color: "var(--color-text)",
  padding: "0.375rem 0.75rem",
  fontSize: "0.75rem",
  cursor: "pointer",
  transition: "border-color 0.15s",
};

const btnActiveStyle: Record<string, string> = {
  ...btnStyle,
  borderColor: "var(--color-primary)",
  color: "var(--color-primary)",
};

const labelStyle: Record<string, string> = {
  fontSize: "0.7rem",
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  fontWeight: "600",
};

const sliderStyle: Record<string, string> = {
  width: "100%",
  accentColor: "var(--color-primary)",
};

// ═══════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════

export default function FlowField() {
  const [params, setParams] = useState<FlowParams>({ ...DEFAULT_PARAMS });
  const [running, setRunning] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const particlesRef = useRef<Particle[]>([]);
  const permRef = useRef<Uint8Array>(buildPermTable(DEFAULT_PARAMS.seed));
  const paramsRef = useRef(params);
  const zOffsetRef = useRef(0);

  paramsRef.current = params;

  const createParticle = useCallback((w: number, h: number): Particle => {
    const x = Math.random() * w;
    const y = Math.random() * h;
    return { x, y, prevX: x, prevY: y, speed: 0, life: Math.random() * 200 + 50 };
  }, []);

  const initParticles = useCallback((count: number) => {
    const particles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      particles.push(createParticle(CANVAS_W, CANVAS_H));
    }
    particlesRef.current = particles;
  }, [createParticle]);

  useEffect(() => {
    permRef.current = buildPermTable(params.seed);
  }, [params.seed]);

  useEffect(() => {
    const current = particlesRef.current;
    const target = params.particleCount;
    if (current.length < target) {
      for (let i = current.length; i < target; i++) {
        current.push(createParticle(CANVAS_W, CANVAS_H));
      }
    } else if (current.length > target) {
      particlesRef.current = current.slice(0, target);
    }
  }, [params.particleCount, createParticle]);

  useEffect(() => {
    initParticles(params.particleCount);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#09090b";
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      }
    }
  }, []);

  useEffect(() => {
    if (!running) {
      cancelAnimationFrame(animRef.current);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const tick = () => {
      const p = paramsRef.current;
      const perm = permRef.current;
      const particles = particlesRef.current;
      const colors = PALETTES[p.palette];
      const z = zOffsetRef.current;
      zOffsetRef.current += 0.0003;

      ctx.fillStyle = `rgba(9, 9, 11, ${p.trailOpacity})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      for (let i = 0; i < particles.length; i++) {
        const pt = particles[i];
        pt.prevX = pt.x;
        pt.prevY = pt.y;

        const nx = pt.x * p.noiseScale;
        const ny = pt.y * p.noiseScale;
        const angle = perlin2d(nx, ny + z, perm) * Math.PI * 4;

        const vx = Math.cos(angle) * p.speed;
        const vy = Math.sin(angle) * p.speed;

        pt.x += vx;
        pt.y += vy;
        pt.speed = Math.sqrt(vx * vx + vy * vy);
        pt.life--;

        if (pt.x < 0) pt.x += CANVAS_W;
        if (pt.x >= CANVAS_W) pt.x -= CANVAS_W;
        if (pt.y < 0) pt.y += CANVAS_H;
        if (pt.y >= CANVAS_H) pt.y -= CANVAS_H;

        if (pt.life <= 0) {
          const newPt = createParticle(CANVAS_W, CANVAS_H);
          particles[i] = newPt;
          continue;
        }

        const colorIdx = i % colors.length;
        const alpha = Math.min(1, pt.life / 20);
        ctx.strokeStyle = colors[colorIdx];
        ctx.globalAlpha = alpha * 0.6;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pt.prevX, pt.prevY);
        ctx.lineTo(pt.x, pt.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [running, createParticle]);

  const regenerate = useCallback(() => {
    const newSeed = Math.floor(Math.random() * 99999);
    setParams((p) => ({ ...p, seed: newSeed }));
    permRef.current = buildPermTable(newSeed);
    zOffsetRef.current = 0;
    initParticles(paramsRef.current.particleCount);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#09090b";
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      }
    }
  }, [initParticles]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#09090b";
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      }
    }
  }, []);

  const updateParam = useCallback(<K extends keyof FlowParams>(key: K, value: FlowParams[K]) => {
    setParams((p) => ({ ...p, [key]: value }));
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Palette + Actions */}
      <div style={panelStyle}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <span style={labelStyle}>Palette</span>
          {(Object.keys(PALETTES) as PaletteId[]).map((pid) => (
            <button
              key={pid}
              style={params.palette === pid ? btnActiveStyle : btnStyle}
              onClick={() => updateParam("palette", pid)}
            >
              <span style={{ display: "inline-flex", gap: "2px", marginRight: "4px" }}>
                {PALETTES[pid].slice(0, 3).map((c, i) => (
                  <span key={i} style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "2px", background: c }} />
                ))}
              </span>
              {PALETTE_LABELS[pid]}
            </button>
          ))}
          <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
            <button style={btnStyle} onClick={() => setRunning(!running)}>
              {running ? "Pause" : "Play"}
            </button>
            <button style={btnStyle} onClick={clearCanvas}>
              Clear
            </button>
            <button style={btnStyle} onClick={regenerate}>
              Regenerate
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        {/* Canvas */}
        <div style={{ flex: "1 1 600px", minWidth: 0 }}>
          <div style={panelStyle}>
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              style={{ width: "100%", height: "auto", display: "block", borderRadius: "0.375rem", background: "#09090b" }}
            />
          </div>
        </div>

        {/* Controls */}
        <div style={{ flex: "0 0 260px" }}>
          <div style={{ ...panelStyle, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <span style={{ ...labelStyle, fontSize: "0.75rem" }}>Parameters</span>

            {/* Noise Scale */}
            <div>
              <label style={labelStyle}>Noise Scale: {params.noiseScale.toFixed(4)}</label>
              <input
                type="range"
                min={0.001}
                max={0.02}
                step={0.0005}
                value={params.noiseScale}
                onInput={(e) => updateParam("noiseScale", parseFloat((e.target as HTMLInputElement).value))}
                style={sliderStyle}
              />
            </div>

            {/* Particle Count */}
            <div>
              <label style={labelStyle}>Particles: {params.particleCount}</label>
              <input
                type="range"
                min={500}
                max={5000}
                step={100}
                value={params.particleCount}
                onInput={(e) => updateParam("particleCount", parseInt((e.target as HTMLInputElement).value))}
                style={sliderStyle}
              />
            </div>

            {/* Speed */}
            <div>
              <label style={labelStyle}>Speed: {params.speed.toFixed(1)}</label>
              <input
                type="range"
                min={0.5}
                max={6}
                step={0.1}
                value={params.speed}
                onInput={(e) => updateParam("speed", parseFloat((e.target as HTMLInputElement).value))}
                style={sliderStyle}
              />
            </div>

            {/* Trail Opacity */}
            <div>
              <label style={labelStyle}>Trail Length: {(1 - params.trailOpacity).toFixed(2)}</label>
              <input
                type="range"
                min={0.01}
                max={0.15}
                step={0.005}
                value={params.trailOpacity}
                onInput={(e) => updateParam("trailOpacity", parseFloat((e.target as HTMLInputElement).value))}
                style={sliderStyle}
              />
              <div style={{ fontSize: "0.6rem", color: "var(--color-text-muted)", marginTop: "2px" }}>
                Lower = longer trails
              </div>
            </div>

            {/* Seed */}
            <div>
              <label style={labelStyle}>Seed</label>
              <div style={{ display: "flex", gap: "0.35rem", alignItems: "center", marginTop: "0.25rem" }}>
                <input
                  type="number"
                  value={params.seed}
                  onInput={(e) => {
                    const val = parseInt((e.target as HTMLInputElement).value) || 0;
                    updateParam("seed", val);
                  }}
                  style={{
                    ...btnStyle,
                    flex: "1",
                    fontFamily: "monospace",
                    padding: "0.375rem 0.5rem",
                  }}
                />
                <button style={btnStyle} onClick={regenerate}>
                  Random
                </button>
              </div>
            </div>
          </div>

          {/* Info */}
          <div style={{ ...panelStyle, marginTop: "0.5rem" }}>
            <span style={{ ...labelStyle, fontSize: "0.75rem" }}>How It Works</span>
            <p style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", marginTop: "0.5rem", lineHeight: "1.5" }}>
              Thousands of particles move through a Perlin noise vector field.
              Each particle's direction is determined by the noise value at its position,
              creating organic flowing patterns. Particles leave trails that slowly fade,
              revealing the underlying field structure.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
