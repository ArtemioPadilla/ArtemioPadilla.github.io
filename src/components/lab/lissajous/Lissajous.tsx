import { useState, useEffect, useRef, useCallback } from "preact/hooks";

// ================================================================
// Types
// ================================================================

type ColorMode = "time" | "velocity" | "solid";

interface LissajousParams {
  a: number;
  b: number;
  delta: number;
  damping: number;
  colorMode: ColorMode;
  autoAnimate: boolean;
  animSpeed: number;
  lineWidth: number;
  showSineWaves: boolean;
  speed: number;
}

interface PresetDef {
  name: string;
  a: number;
  b: number;
  delta: number;
  description: string;
}

// ================================================================
// Constants
// ================================================================

const CANVAS_SIZE = 560;
const MARGIN_SIZE = 60;
const THUMB_SIZE = 48;
const TRAIL_LENGTH = 2000;
const TWO_PI = Math.PI * 2;

const SHAPE_NAMES: Record<string, string> = {
  "1:1": "Ellipse / Circle",
  "1:2": "Figure-8",
  "2:1": "Parabolic",
  "1:3": "Trefoil",
  "3:1": "Trefoil",
  "2:3": "Knot",
  "3:2": "Knot",
  "3:4": "Lissajous Knot",
  "4:3": "Lissajous Knot",
  "1:4": "Quadrifolium",
  "4:1": "Quadrifolium",
  "1:5": "Cinquefoil",
  "5:1": "Cinquefoil",
  "5:4": "Complex Knot",
};

const MUSICAL_INTERVALS: Record<string, string> = {
  "1:1": "Unison",
  "1:2": "Octave",
  "2:1": "Octave",
  "2:3": "Perfect Fifth",
  "3:2": "Perfect Fifth",
  "3:4": "Perfect Fourth",
  "4:3": "Perfect Fourth",
  "4:5": "Major Third",
  "5:4": "Major Third",
  "5:6": "Minor Third",
  "6:5": "Minor Third",
  "3:5": "Major Sixth",
  "5:3": "Major Sixth",
  "1:3": "Octave + Fifth",
  "3:1": "Octave + Fifth",
  "1:4": "Double Octave",
  "4:1": "Double Octave",
};

const PRESETS: PresetDef[] = [
  { name: "Circle", a: 1, b: 1, delta: Math.PI / 2, description: "1:1, phase=pi/2" },
  { name: "Figure 8", a: 1, b: 2, delta: Math.PI / 2, description: "1:2, phase=pi/2" },
  { name: "Star", a: 3, b: 2, delta: Math.PI / 2, description: "3:2, phase=pi/2" },
  { name: "Complex", a: 5, b: 4, delta: Math.PI / 3, description: "5:4, phase=pi/3" },
  { name: "Trefoil", a: 1, b: 3, delta: 0, description: "1:3, phase=0" },
  { name: "Bow Tie", a: 2, b: 3, delta: 0, description: "2:3, phase=0" },
];

const THUMB_GRID: { a: number; b: number; label: string }[] = [];
for (let a = 1; a <= 5; a++) {
  for (let b = 1; b <= 5; b++) {
    THUMB_GRID.push({ a, b, label: `${a}:${b}` });
  }
}

// ================================================================
// Styles
// ================================================================

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

// ================================================================
// Helpers
// ================================================================

function hslToRgb(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  return `hsl(${hue}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) { const t = b; b = a % b; a = t; }
  return a;
}

// ================================================================
// Component
// ================================================================

export default function Lissajous() {
  const [params, setParams] = useState<LissajousParams>({
    a: 3,
    b: 2,
    delta: Math.PI / 2,
    damping: 0,
    colorMode: "time",
    autoAnimate: false,
    animSpeed: 0.005,
    lineWidth: 2,
    showSineWaves: false,
    speed: 1,
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const thumbCanvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timeRef = useRef(0);
  const trailRef = useRef<{ x: number; y: number; vx: number; vy: number }[]>([]);
  const paramsRef = useRef(params);
  const deltaAnimRef = useRef(params.delta);

  paramsRef.current = params;

  // Thumbnail drawing
  const drawThumbnail = useCallback(
    (ctx: CanvasRenderingContext2D, a: number, b: number, ox: number, oy: number, size: number) => {
      const pad = 4;
      const amp = (size - pad * 2) / 2;
      const cx = ox + size / 2;
      const cy = oy + size / 2;
      ctx.beginPath();
      const steps = 200;
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * TWO_PI;
        const x = cx + amp * Math.sin(a * t + Math.PI / 2);
        const y = cy + amp * Math.sin(b * t);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "#4f8ff7";
      ctx.lineWidth = 1;
      ctx.stroke();
    },
    []
  );

  const renderThumbnails = useCallback(() => {
    const canvas = thumbCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cols = 5;
    const rows = 5;
    const gap = 4;
    canvas.width = cols * (THUMB_SIZE + gap) - gap;
    canvas.height = rows * (THUMB_SIZE + gap) - gap;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const entry = THUMB_GRID[row * cols + col];
        const ox = col * (THUMB_SIZE + gap);
        const oy = row * (THUMB_SIZE + gap);
        const isSelected = entry.a === params.a && entry.b === params.b;
        ctx.fillStyle = isSelected ? "rgba(79, 143, 247, 0.15)" : "rgba(255,255,255,0.03)";
        ctx.strokeStyle = isSelected ? "#4f8ff7" : "rgba(255,255,255,0.08)";
        ctx.lineWidth = isSelected ? 1.5 : 0.5;
        ctx.beginPath();
        ctx.roundRect(ox, oy, THUMB_SIZE, THUMB_SIZE, 4);
        ctx.fill();
        ctx.stroke();
        drawThumbnail(ctx, entry.a, entry.b, ox, oy, THUMB_SIZE);
      }
    }
  }, [params.a, params.b, drawThumbnail]);

  useEffect(() => { renderThumbnails(); }, [renderThumbnails]);

  // Main animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    timeRef.current = 0;
    trailRef.current = [];
    deltaAnimRef.current = paramsRef.current.delta;

    const tick = () => {
      const p = paramsRef.current;
      const t = timeRef.current;
      const dt = 0.02 * p.speed;
      timeRef.current += dt;

      if (p.autoAnimate) {
        deltaAnimRef.current += p.animSpeed;
      } else {
        deltaAnimRef.current = p.delta;
      }
      const delta = deltaAnimRef.current;

      const canvasW = canvas.width;
      const canvasH = canvas.height;
      const showWaves = p.showSineWaves;
      const plotMargin = showWaves ? MARGIN_SIZE : 0;
      const plotW = canvasW - plotMargin;
      const plotH = canvasH - plotMargin;
      const cx = plotMargin + plotW / 2;
      const cy = plotH / 2;
      const amp = Math.min(plotW, plotH) * 0.38;

      const dampFactor = p.damping > 0 ? Math.exp(-p.damping * t * 0.1) : 1;
      const rawX = Math.sin(p.a * t + delta) * dampFactor;
      const rawY = Math.sin(p.b * t) * dampFactor;
      const x = cx + amp * rawX;
      const y = cy + amp * rawY;

      const prevPt = trailRef.current.length > 0 ? trailRef.current[trailRef.current.length - 1] : null;
      const vx = prevPt ? x - prevPt.x : 0;
      const vy = prevPt ? y - prevPt.y : 0;
      trailRef.current.push({ x, y, vx, vy });
      if (trailRef.current.length > TRAIL_LENGTH) trailRef.current.shift();

      // Clear
      ctx.fillStyle = "rgba(9, 9, 11, 0.08)";
      ctx.fillRect(0, 0, canvasW, canvasH);

      // Draw sine waves on margins
      if (showWaves) {
        // Y-wave on left margin (vertical)
        ctx.strokeStyle = "rgba(52, 211, 153, 0.5)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let py = 0; py < plotH; py++) {
          const normalizedY = (py - plotH / 2) / amp;
          const waveX = plotMargin * 0.5 + (plotMargin * 0.35) * normalizedY;
          if (py === 0) ctx.moveTo(waveX, py); else ctx.lineTo(waveX, py);
        }
        ctx.stroke();

        // Current position marker on Y wave
        ctx.beginPath();
        ctx.arc(plotMargin * 0.5 + (plotMargin * 0.35) * rawY, y, 3, 0, TWO_PI);
        ctx.fillStyle = "#34d399";
        ctx.fill();

        // Horizontal guide line from Y wave to point
        ctx.strokeStyle = "rgba(52, 211, 153, 0.2)";
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(plotMargin * 0.5 + (plotMargin * 0.35) * rawY, y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // X-wave on top margin (horizontal)
        ctx.strokeStyle = "rgba(79, 143, 247, 0.5)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let px = plotMargin; px < canvasW; px++) {
          const normalizedX = (px - cx) / amp;
          const waveY = plotH + MARGIN_SIZE * 0.5 + (MARGIN_SIZE * 0.35) * normalizedX;
          if (px === plotMargin) ctx.moveTo(px, waveY); else ctx.lineTo(px, waveY);
        }
        ctx.stroke();

        // Current position marker on X wave
        ctx.beginPath();
        ctx.arc(x, plotH + MARGIN_SIZE * 0.5 + (MARGIN_SIZE * 0.35) * rawX, 3, 0, TWO_PI);
        ctx.fillStyle = "#4f8ff7";
        ctx.fill();

        // Vertical guide from X wave to point
        ctx.strokeStyle = "rgba(79, 143, 247, 0.2)";
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, plotH + MARGIN_SIZE * 0.5 + (MARGIN_SIZE * 0.35) * rawX);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Labels
        ctx.font = "9px sans-serif";
        ctx.fillStyle = "rgba(161,161,170,0.6)";
        ctx.textAlign = "center";
        ctx.fillText("y = sin(" + p.b + "t)", plotMargin * 0.5, plotH + 10);
        ctx.fillText("x = sin(" + p.a + "t + d)", cx, canvasH - 4);
      }

      // Draw trail
      const trail = trailRef.current;
      if (trail.length < 2) {
        animRef.current = requestAnimationFrame(tick);
        return;
      }

      for (let i = 1; i < trail.length; i++) {
        const alpha = i / trail.length;
        const pt = trail[i];
        const prev = trail[i - 1];

        let color: string;
        if (p.colorMode === "time") {
          color = hslToRgb((i / trail.length) * 360 + t * 20, 0.8, 0.6);
        } else if (p.colorMode === "velocity") {
          const vel = Math.sqrt(pt.vx * pt.vx + pt.vy * pt.vy);
          color = hslToRgb(Math.min(vel * 15, 270), 0.85, 0.55);
        } else {
          color = "#4f8ff7";
        }

        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha * 0.9;
        ctx.lineWidth = p.lineWidth * (0.5 + alpha * 0.5);
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(pt.x, pt.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Current dot
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, TWO_PI);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, TWO_PI);
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 1;
      ctx.stroke();

      animRef.current = requestAnimationFrame(tick);
    };

    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [params.a, params.b, params.damping, params.colorMode, params.showSineWaves]);

  useEffect(() => {
    if (!params.autoAnimate) deltaAnimRef.current = params.delta;
  }, [params.delta, params.autoAnimate]);

  const resetAnimation = useCallback(() => {
    timeRef.current = 0;
    trailRef.current = [];
    deltaAnimRef.current = paramsRef.current.delta;
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) { ctx.fillStyle = "#09090b"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    }
  }, []);

  const handleThumbClick = useCallback((e: MouseEvent) => {
    const canvas = thumbCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;
    const gap = 4;
    const col = Math.floor(mx / (THUMB_SIZE + gap));
    const row = Math.floor(my / (THUMB_SIZE + gap));
    if (col >= 0 && col < 5 && row >= 0 && row < 5) {
      const entry = THUMB_GRID[row * 5 + col];
      setParams((p) => ({ ...p, a: entry.a, b: entry.b }));
      resetAnimation();
    }
  }, [resetAnimation]);

  const applyPreset = useCallback((preset: PresetDef) => {
    setParams((p) => ({ ...p, a: preset.a, b: preset.b, delta: preset.delta }));
    resetAnimation();
  }, [resetAnimation]);

  const updateParam = useCallback(<K extends keyof LissajousParams>(key: K, value: LissajousParams[K]) => {
    setParams((p) => ({ ...p, [key]: value }));
  }, []);

  const shapeName = SHAPE_NAMES[`${params.a}:${params.b}`] || "Lissajous Curve";
  const ratioGcd = gcd(params.a, params.b);
  const ratioLabel = `${params.a / ratioGcd}:${params.b / ratioGcd}`;
  const musicalInterval = MUSICAL_INTERVALS[`${params.a}:${params.b}`] || MUSICAL_INTERVALS[ratioLabel] || "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Info Bar */}
      <div style={panelStyle}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center" }}>
          <div>
            <span style={labelStyle}>Curve</span>
            <div style={{ fontSize: "1rem", color: "var(--color-heading)", fontWeight: "600", marginTop: "2px" }}>
              {shapeName}
            </div>
          </div>
          <div>
            <span style={labelStyle}>Ratio</span>
            <div style={{ fontSize: "1rem", color: "var(--color-primary)", fontWeight: "600", fontFamily: "monospace", marginTop: "2px" }}>
              {ratioLabel}
            </div>
          </div>
          {musicalInterval && (
            <div>
              <span style={labelStyle}>Interval</span>
              <div style={{ fontSize: "0.85rem", color: "var(--color-accent)", fontWeight: "500", marginTop: "2px" }}>
                {musicalInterval}
              </div>
            </div>
          )}
          <div>
            <span style={labelStyle}>Equation</span>
            <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", fontFamily: "monospace", marginTop: "2px" }}>
              x = sin({params.a}t + {(params.delta / Math.PI).toFixed(2)}pi) &nbsp; y = sin({params.b}t)
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
            <button style={btnStyle} onClick={resetAnimation}>Reset</button>
          </div>
        </div>
      </div>

      {/* Presets */}
      <div style={panelStyle}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <span style={labelStyle}>Presets</span>
          {PRESETS.map((preset) => (
            <button key={preset.name} style={btnStyle} onClick={() => applyPreset(preset)}>
              {preset.name}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        {/* Canvas */}
        <div style={{ flex: "1 1 400px", minWidth: 0 }}>
          <div style={panelStyle}>
            <canvas
              ref={canvasRef}
              width={params.showSineWaves ? CANVAS_SIZE + MARGIN_SIZE : CANVAS_SIZE}
              height={params.showSineWaves ? CANVAS_SIZE + MARGIN_SIZE : CANVAS_SIZE}
              style={{ width: "100%", height: "auto", display: "block", borderRadius: "0.375rem", background: "#09090b" }}
            />
          </div>
        </div>

        {/* Controls */}
        <div style={{ flex: "0 0 280px", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ ...panelStyle, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <span style={{ ...labelStyle, fontSize: "0.75rem" }}>Parameters</span>

            <div>
              <label style={labelStyle}>X Frequency (a): {params.a}</label>
              <input type="range" min={1} max={10} step={1} value={params.a}
                onInput={(e) => { updateParam("a", parseInt((e.target as HTMLInputElement).value)); resetAnimation(); }}
                style={sliderStyle} />
            </div>

            <div>
              <label style={labelStyle}>Y Frequency (b): {params.b}</label>
              <input type="range" min={1} max={10} step={1} value={params.b}
                onInput={(e) => { updateParam("b", parseInt((e.target as HTMLInputElement).value)); resetAnimation(); }}
                style={sliderStyle} />
            </div>

            <div>
              <label style={labelStyle}>Phase (delta): {(params.delta / Math.PI).toFixed(2)}pi</label>
              <input type="range" min={0} max={6.283} step={0.01} value={params.delta}
                onInput={(e) => updateParam("delta", parseFloat((e.target as HTMLInputElement).value))}
                style={sliderStyle} />
            </div>

            <div>
              <label style={labelStyle}>Damping: {params.damping.toFixed(2)}</label>
              <input type="range" min={0} max={2} step={0.05} value={params.damping}
                onInput={(e) => { updateParam("damping", parseFloat((e.target as HTMLInputElement).value)); resetAnimation(); }}
                style={sliderStyle} />
            </div>

            <div>
              <label style={labelStyle}>Line Width: {params.lineWidth.toFixed(1)}</label>
              <input type="range" min={0.5} max={5} step={0.5} value={params.lineWidth}
                onInput={(e) => updateParam("lineWidth", parseFloat((e.target as HTMLInputElement).value))}
                style={sliderStyle} />
            </div>

            <div>
              <label style={labelStyle}>Speed: {params.speed.toFixed(1)}x</label>
              <input type="range" min={0.2} max={3} step={0.1} value={params.speed}
                onInput={(e) => updateParam("speed", parseFloat((e.target as HTMLInputElement).value))}
                style={sliderStyle} />
            </div>

            <div>
              <label style={labelStyle}>Color Mode</label>
              <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.25rem" }}>
                {(["time", "velocity", "solid"] as ColorMode[]).map((cm) => (
                  <button key={cm} style={params.colorMode === cm ? btnActiveStyle : btnStyle}
                    onClick={() => updateParam("colorMode", cm)}>
                    {cm.charAt(0).toUpperCase() + cm.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input type="checkbox" checked={params.showSineWaves}
                onChange={(e) => { updateParam("showSineWaves", (e.target as HTMLInputElement).checked); resetAnimation(); }}
                style={{ accentColor: "var(--color-primary)" }} />
              Show Sine Waves
            </label>

            <div>
              <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input type="checkbox" checked={params.autoAnimate}
                  onChange={(e) => updateParam("autoAnimate", (e.target as HTMLInputElement).checked)}
                  style={{ accentColor: "var(--color-primary)" }} />
                Auto-Animate Phase
              </label>
              {params.autoAnimate && (
                <div style={{ marginTop: "0.35rem" }}>
                  <label style={labelStyle}>Anim Speed: {params.animSpeed.toFixed(3)}</label>
                  <input type="range" min={0.001} max={0.03} step={0.001} value={params.animSpeed}
                    onInput={(e) => updateParam("animSpeed", parseFloat((e.target as HTMLInputElement).value))}
                    style={sliderStyle} />
                </div>
              )}
            </div>
          </div>

          {/* Thumbnail Matrix */}
          <div style={panelStyle}>
            <span style={{ ...labelStyle, fontSize: "0.75rem", display: "block", marginBottom: "0.5rem" }}>
              a:b Matrix (click to select)
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
              <div style={{ width: "16px" }} />
              {[1, 2, 3, 4, 5].map((b) => (
                <div key={b} style={{ width: `${THUMB_SIZE}px`, textAlign: "center", fontSize: "0.6rem", color: "var(--color-text-muted)" }}>
                  b={b}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: "0.25rem" }}>
              <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-around", width: "16px" }}>
                {[1, 2, 3, 4, 5].map((a) => (
                  <div key={a} style={{ fontSize: "0.6rem", color: "var(--color-text-muted)", height: `${THUMB_SIZE}px`, display: "flex", alignItems: "center" }}>
                    {a}
                  </div>
                ))}
              </div>
              <canvas ref={thumbCanvasRef} style={{ cursor: "pointer", borderRadius: "0.25rem" }} onClick={handleThumbClick} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
