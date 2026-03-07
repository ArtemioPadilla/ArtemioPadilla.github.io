import { useState, useEffect, useRef, useCallback } from "preact/hooks";

// ================================================================
// Types
// ================================================================

interface SpiroLayer {
  R: number;
  r: number;
  d: number;
  hueOffset: number;
  visible: boolean;
}

interface SpiroParams {
  speed: number;
  showGears: boolean;
  activeLayer: number;
  lineWidth: number;
}

interface Preset {
  name: string;
  layers: SpiroLayer[];
}

// ================================================================
// Constants
// ================================================================

const CANVAS_SIZE = 560;
const CENTER_X = CANVAS_SIZE / 2;
const CENTER_Y = CANVAS_SIZE / 2;
const MAX_LAYERS = 4;
const DRAW_STEPS_PER_FRAME = 8;

const DEFAULT_LAYER: SpiroLayer = {
  R: 120,
  r: 75,
  d: 60,
  hueOffset: 0,
  visible: true,
};

const PRESETS: Preset[] = [
  { name: "Classic", layers: [{ R: 150, r: 90, d: 90, hueOffset: 0, visible: true }] },
  { name: "Star", layers: [{ R: 140, r: 40, d: 100, hueOffset: 0, visible: true }] },
  { name: "Rose", layers: [{ R: 120, r: 60, d: 60, hueOffset: 120, visible: true }] },
  { name: "Flower", layers: [{ R: 150, r: 50, d: 50, hueOffset: 200, visible: true }] },
  { name: "Pentagon", layers: [{ R: 120, r: 96, d: 70, hueOffset: 60, visible: true }] },
  { name: "Spiral Web", layers: [{ R: 100, r: 37, d: 90, hueOffset: 30, visible: true }] },
  {
    name: "Dual Bloom",
    layers: [
      { R: 140, r: 56, d: 56, hueOffset: 0, visible: true },
      { R: 140, r: 84, d: 42, hueOffset: 180, visible: true },
    ],
  },
  {
    name: "Triple Ring",
    layers: [
      { R: 120, r: 40, d: 60, hueOffset: 0, visible: true },
      { R: 120, r: 60, d: 40, hueOffset: 120, visible: true },
      { R: 120, r: 80, d: 30, hueOffset: 240, visible: true },
    ],
  },
];

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

const btnDangerStyle: Record<string, string> = {
  ...btnStyle,
  borderColor: "#ef4444",
  color: "#ef4444",
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
// Math helpers
// ================================================================

function spirographPoint(R: number, r: number, d: number, t: number): { x: number; y: number } {
  const diff = R - r;
  const ratio = diff / r;
  return {
    x: diff * Math.cos(t) + d * Math.cos(ratio * t),
    y: diff * Math.sin(t) - d * Math.sin(ratio * t),
  };
}

function gcd(a: number, b: number): number {
  a = Math.round(Math.abs(a));
  b = Math.round(Math.abs(b));
  while (b) { const t = b; b = a % b; a = t; }
  return a || 1;
}

function fullRevolutions(R: number, r: number): number {
  const g = gcd(R, r);
  return r / g;
}

function lobeCount(R: number, r: number): number {
  const g = gcd(R, r);
  return R / g;
}

// ================================================================
// Component
// ================================================================

export default function Spirograph() {
  const [layers, setLayers] = useState<SpiroLayer[]>([{ ...DEFAULT_LAYER }]);
  const [params, setParams] = useState<SpiroParams>({
    speed: 1,
    showGears: true,
    activeLayer: 0,
    lineWidth: 1.5,
  });
  const [drawing, setDrawing] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gearCanvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const tRef = useRef(0);
  const layerPathsRef = useRef<Map<number, { x: number; y: number }[]>>(new Map());
  const layersRef = useRef(layers);
  const paramsRef = useRef(params);
  const drawingRef = useRef(drawing);

  layersRef.current = layers;
  paramsRef.current = params;
  drawingRef.current = drawing;

  const clearAndRedraw = useCallback(() => {
    tRef.current = 0;
    layerPathsRef.current = new Map();
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) { ctx.fillStyle = "#09090b"; ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE); }
    }
    const gearCanvas = gearCanvasRef.current;
    if (gearCanvas) {
      const ctx = gearCanvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    }
  }, []);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const gearCanvas = gearCanvasRef.current;
    if (!canvas || !gearCanvas) return;
    const ctx = canvas.getContext("2d");
    const gearCtx = gearCanvas.getContext("2d");
    if (!ctx || !gearCtx) return;

    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    const tick = () => {
      const currentLayers = layersRef.current;
      const p = paramsRef.current;
      const isDrawing = drawingRef.current;

      if (isDrawing) {
        const dt = 0.03 * p.speed;
        for (let step = 0; step < DRAW_STEPS_PER_FRAME; step++) {
          tRef.current += dt;
          const t = tRef.current;
          for (let li = 0; li < currentLayers.length; li++) {
            const layer = currentLayers[li];
            if (!layer.visible) continue;
            const pt = spirographPoint(layer.R, layer.r, layer.d, t);
            const cx = CENTER_X + pt.x;
            const cy = CENTER_Y + pt.y;
            if (!layerPathsRef.current.has(li)) layerPathsRef.current.set(li, []);
            const path = layerPathsRef.current.get(li)!;
            if (path.length > 0) {
              const prev = path[path.length - 1];
              const hue = (layer.hueOffset + t * 20) % 360;
              ctx.strokeStyle = `hsl(${hue}, 80%, 60%)`;
              ctx.lineWidth = p.lineWidth;
              ctx.beginPath();
              ctx.moveTo(prev.x, prev.y);
              ctx.lineTo(cx, cy);
              ctx.stroke();
            }
            path.push({ x: cx, y: cy });
          }
        }
      }

      // Draw gears overlay
      gearCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      if (p.showGears && isDrawing) {
        const t = tRef.current;
        for (let li = 0; li < currentLayers.length; li++) {
          const layer = currentLayers[li];
          if (!layer.visible) continue;

          const R = layer.R;
          const r = layer.r;
          const d = layer.d;

          // Fixed outer circle
          gearCtx.beginPath();
          gearCtx.arc(CENTER_X, CENTER_Y, R, 0, Math.PI * 2);
          gearCtx.strokeStyle = "rgba(255,255,255,0.12)";
          gearCtx.lineWidth = 1;
          gearCtx.stroke();

          // Gear teeth on outer circle
          const teethCount = Math.round(R / 4);
          for (let i = 0; i < teethCount; i++) {
            const angle = (i / teethCount) * Math.PI * 2;
            const tx = CENTER_X + (R - 2) * Math.cos(angle);
            const ty = CENTER_Y + (R - 2) * Math.sin(angle);
            gearCtx.beginPath();
            gearCtx.arc(tx, ty, 1.5, 0, Math.PI * 2);
            gearCtx.fillStyle = "rgba(255,255,255,0.06)";
            gearCtx.fill();
          }

          // Inner rolling circle
          const innerCX = CENTER_X + (R - r) * Math.cos(t);
          const innerCY = CENTER_Y + (R - r) * Math.sin(t);

          gearCtx.beginPath();
          gearCtx.arc(innerCX, innerCY, r, 0, Math.PI * 2);
          gearCtx.strokeStyle = "rgba(79, 143, 247, 0.3)";
          gearCtx.lineWidth = 1;
          gearCtx.stroke();

          // Pen position
          const pen = spirographPoint(R, r, d, t);
          const penX = CENTER_X + pen.x;
          const penY = CENTER_Y + pen.y;

          // Arm from inner center to pen
          gearCtx.beginPath();
          gearCtx.moveTo(innerCX, innerCY);
          gearCtx.lineTo(penX, penY);
          gearCtx.strokeStyle = "rgba(52, 211, 153, 0.4)";
          gearCtx.lineWidth = 1;
          gearCtx.stroke();

          // Pen dot
          gearCtx.beginPath();
          gearCtx.arc(penX, penY, 3, 0, Math.PI * 2);
          gearCtx.fillStyle = "#34d399";
          gearCtx.fill();

          // Inner center dot
          gearCtx.beginPath();
          gearCtx.arc(innerCX, innerCY, 2, 0, Math.PI * 2);
          gearCtx.fillStyle = "rgba(255,255,255,0.4)";
          gearCtx.fill();
        }
      }

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  useEffect(() => { clearAndRedraw(); }, [layers.length, clearAndRedraw]);

  const updateLayer = useCallback(
    <K extends keyof SpiroLayer>(index: number, key: K, value: SpiroLayer[K]) => {
      setLayers((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], [key]: value };
        return next;
      });
      clearAndRedraw();
    },
    [clearAndRedraw]
  );

  const addLayer = useCallback(() => {
    if (layers.length >= MAX_LAYERS) return;
    const hueOffset = layers.length * 90;
    setLayers((prev) => [...prev, { ...DEFAULT_LAYER, hueOffset, r: 50 + layers.length * 15 }]);
    setParams((p) => ({ ...p, activeLayer: layers.length }));
  }, [layers.length]);

  const removeLayer = useCallback(
    (index: number) => {
      if (layers.length <= 1) return;
      setLayers((prev) => prev.filter((_, i) => i !== index));
      setParams((p) => ({ ...p, activeLayer: Math.min(p.activeLayer, layers.length - 2) }));
      clearAndRedraw();
    },
    [layers.length, clearAndRedraw]
  );

  const applyPreset = useCallback(
    (preset: Preset) => {
      setLayers(preset.layers.map((l) => ({ ...l })));
      setParams((p) => ({ ...p, activeLayer: 0 }));
      clearAndRedraw();
    },
    [clearAndRedraw]
  );

  const handleClear = useCallback(() => {
    clearAndRedraw();
    setDrawing(true);
  }, [clearAndRedraw]);

  const activeIdx = Math.min(params.activeLayer, layers.length - 1);
  const activeLayer = layers[activeIdx] || layers[0];
  const revolutions = fullRevolutions(activeLayer.R, activeLayer.r);
  const lobes = lobeCount(activeLayer.R, activeLayer.r);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Preset Bar */}
      <div style={panelStyle}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <span style={labelStyle}>Presets</span>
          {PRESETS.map((preset) => (
            <button key={preset.name} style={btnStyle} onClick={() => applyPreset(preset)}>
              {preset.name}
            </button>
          ))}
          <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
            <button style={btnStyle} onClick={() => setDrawing(!drawing)}>
              {drawing ? "Pause" : "Play"}
            </button>
            <button style={btnStyle} onClick={handleClear}>Clear</button>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        {/* Canvas */}
        <div style={{ flex: "1 1 400px", minWidth: 0 }}>
          <div style={{ ...panelStyle, position: "relative" }}>
            <canvas
              ref={canvasRef}
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              style={{ width: "100%", height: "auto", display: "block", borderRadius: "0.375rem", background: "#09090b" }}
            />
            <canvas
              ref={gearCanvasRef}
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              style={{
                width: "100%",
                height: "auto",
                display: "block",
                borderRadius: "0.375rem",
                position: "absolute",
                top: "1rem",
                left: "1rem",
                right: "1rem",
                pointerEvents: "none",
              }}
            />
          </div>
        </div>

        {/* Controls */}
        <div style={{ flex: "0 0 280px", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {/* Layer tabs */}
          <div style={panelStyle}>
            <div style={{ display: "flex", gap: "0.35rem", alignItems: "center", marginBottom: "0.75rem" }}>
              <span style={labelStyle}>Layers</span>
              {layers.map((_, i) => (
                <button
                  key={i}
                  style={activeIdx === i ? btnActiveStyle : btnStyle}
                  onClick={() => setParams((p) => ({ ...p, activeLayer: i }))}
                >
                  {i + 1}
                </button>
              ))}
              {layers.length < MAX_LAYERS && (
                <button style={btnStyle} onClick={addLayer}>+</button>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              <div>
                <label style={labelStyle}>Outer Radius (R): {activeLayer.R}</label>
                <input type="range" min={50} max={200} step={1} value={activeLayer.R}
                  onInput={(e) => updateLayer(activeIdx, "R", parseInt((e.target as HTMLInputElement).value))}
                  style={sliderStyle} />
              </div>

              <div>
                <label style={labelStyle}>Inner Radius (r): {activeLayer.r}</label>
                <input type="range" min={10} max={150} step={1} value={activeLayer.r}
                  onInput={(e) => updateLayer(activeIdx, "r", parseInt((e.target as HTMLInputElement).value))}
                  style={sliderStyle} />
              </div>

              <div>
                <label style={labelStyle}>Pen Distance (d): {activeLayer.d}</label>
                <input type="range" min={10} max={150} step={1} value={activeLayer.d}
                  onInput={(e) => updateLayer(activeIdx, "d", parseInt((e.target as HTMLInputElement).value))}
                  style={sliderStyle} />
              </div>

              <div>
                <label style={labelStyle}>Hue Offset: {activeLayer.hueOffset}</label>
                <input type="range" min={0} max={360} step={5} value={activeLayer.hueOffset}
                  onInput={(e) => updateLayer(activeIdx, "hueOffset", parseInt((e.target as HTMLInputElement).value))}
                  style={sliderStyle} />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
                  <input type="checkbox" checked={activeLayer.visible}
                    onChange={(e) => updateLayer(activeIdx, "visible", (e.target as HTMLInputElement).checked)}
                    style={{ accentColor: "var(--color-primary)" }} />
                  Visible
                </label>
                {layers.length > 1 && (
                  <button style={btnDangerStyle} onClick={() => removeLayer(activeIdx)}>Remove</button>
                )}
              </div>
            </div>
          </div>

          {/* Global controls */}
          <div style={panelStyle}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              <div>
                <label style={labelStyle}>Speed: {params.speed.toFixed(1)}x</label>
                <input type="range" min={0.2} max={5} step={0.1} value={params.speed}
                  onInput={(e) => setParams((p) => ({ ...p, speed: parseFloat((e.target as HTMLInputElement).value) }))}
                  style={sliderStyle} />
              </div>

              <div>
                <label style={labelStyle}>Line Width: {params.lineWidth.toFixed(1)}</label>
                <input type="range" min={0.5} max={4} step={0.5} value={params.lineWidth}
                  onInput={(e) => setParams((p) => ({ ...p, lineWidth: parseFloat((e.target as HTMLInputElement).value) }))}
                  style={sliderStyle} />
              </div>

              <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
                <input type="checkbox" checked={params.showGears}
                  onChange={(e) => setParams((p) => ({ ...p, showGears: (e.target as HTMLInputElement).checked }))}
                  style={{ accentColor: "var(--color-primary)" }} />
                Show Gears
              </label>
            </div>
          </div>

          {/* Mathematical Formula */}
          <div style={panelStyle}>
            <span style={{ ...labelStyle, fontSize: "0.75rem" }}>Formula (Hypotrochoid)</span>
            <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", marginTop: "0.5rem", lineHeight: "1.6", fontFamily: "monospace" }}>
              <div>x(t) = (R-r)cos(t) + d*cos((R-r)/r * t)</div>
              <div>y(t) = (R-r)sin(t) - d*sin((R-r)/r * t)</div>
            </div>
          </div>

          {/* Curve Info */}
          <div style={panelStyle}>
            <span style={{ ...labelStyle, fontSize: "0.75rem" }}>Curve Info</span>
            <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", marginTop: "0.5rem", lineHeight: "1.5", fontFamily: "monospace" }}>
              <div>R = {activeLayer.R}, r = {activeLayer.r}, d = {activeLayer.d}</div>
              <div>Ratio R/r = {(activeLayer.R / activeLayer.r).toFixed(3)}</div>
              <div>Lobes = {lobes}</div>
              <div>Revolutions to close = {revolutions}</div>
              <div>GCD(R, r) = {gcd(activeLayer.R, activeLayer.r)}</div>
            </div>
            <p style={{ fontSize: "0.65rem", color: "var(--color-text-muted)", marginTop: "0.75rem", lineHeight: "1.4" }}>
              A spirograph traces the path of a pen embedded in a small gear rolling
              inside a larger fixed gear. The number of lobes equals R/GCD(R,r)
              and the curve closes after r/GCD(R,r) full revolutions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
