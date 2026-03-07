import { useState, useEffect, useRef, useCallback } from "preact/hooks";

// ================================================================
// Types
// ================================================================

interface ControlPoint {
  x: number;
  y: number;
}

type ShapeType = "square" | "hexagon" | "triangle";
type ColorSchemeId = "classic" | "warm" | "cool" | "pastel" | "bold";
type PresetId = "flat" | "zigzag" | "wave" | "comb";

interface TessParams {
  shape: ShapeType;
  gridSize: number;
  showGrid: boolean;
  colorScheme: ColorSchemeId;
}

interface PanState {
  offsetX: number;
  offsetY: number;
}

// ================================================================
// Constants
// ================================================================

const CANVAS_SIZE = 600;
const TILE_BASE = 100;
const POINTS_PER_EDGE = 3;
const CONTROL_RADIUS = 7;
const CONTROL_HIT_RADIUS = 14;

const COLOR_SCHEMES: Record<ColorSchemeId, string[]> = {
  classic: ["#4f8ff7", "#34d399", "#fbbf24"],
  warm: ["#ef4444", "#f97316", "#fbbf24"],
  cool: ["#3b82f6", "#8b5cf6", "#06b6d4"],
  pastel: ["#fca5a5", "#a5f3fc", "#d9f99d"],
  bold: ["#dc2626", "#2563eb", "#16a34a"],
};

const SCHEME_LABELS: Record<ColorSchemeId, string> = {
  classic: "Classic",
  warm: "Warm",
  cool: "Cool",
  pastel: "Pastel",
  bold: "Bold",
};

const SHAPE_LABELS: Record<ShapeType, string> = {
  square: "Square",
  hexagon: "Hexagon",
  triangle: "Triangle",
};

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
// Preset deformations
// ================================================================

function makeDefaultEdgePoints(): ControlPoint[] {
  const pts: ControlPoint[] = [];
  for (let i = 0; i < POINTS_PER_EDGE; i++) {
    const t = (i + 1) / (POINTS_PER_EDGE + 1);
    pts.push({ x: t * TILE_BASE, y: 0 });
  }
  return pts;
}

function makeDefaultSidePoints(): ControlPoint[] {
  const pts: ControlPoint[] = [];
  for (let i = 0; i < POINTS_PER_EDGE; i++) {
    const t = (i + 1) / (POINTS_PER_EDGE + 1);
    pts.push({ x: 0, y: t * TILE_BASE });
  }
  return pts;
}

interface PresetDef {
  name: string;
  id: PresetId;
  topEdge: ControlPoint[];
  leftEdge: ControlPoint[];
}

const PRESETS: PresetDef[] = [
  {
    name: "Flat",
    id: "flat",
    topEdge: makeDefaultEdgePoints(),
    leftEdge: makeDefaultSidePoints(),
  },
  {
    name: "Zigzag",
    id: "zigzag",
    topEdge: [
      { x: 25, y: -20 },
      { x: 50, y: 20 },
      { x: 75, y: -20 },
    ],
    leftEdge: [
      { x: 20, y: 25 },
      { x: -20, y: 50 },
      { x: 20, y: 75 },
    ],
  },
  {
    name: "Wave",
    id: "wave",
    topEdge: [
      { x: 25, y: -15 },
      { x: 50, y: 0 },
      { x: 75, y: 15 },
    ],
    leftEdge: [
      { x: 15, y: 25 },
      { x: 0, y: 50 },
      { x: -15, y: 75 },
    ],
  },
  {
    name: "Comb",
    id: "comb",
    topEdge: [
      { x: 25, y: -30 },
      { x: 50, y: 30 },
      { x: 75, y: -30 },
    ],
    leftEdge: makeDefaultSidePoints(),
  },
];

// ================================================================
// Component
// ================================================================

export default function Tessellation() {
  const [params, setParams] = useState<TessParams>({
    shape: "square",
    gridSize: 6,
    showGrid: false,
    colorScheme: "classic",
  });

  const [topEdge, setTopEdge] = useState<ControlPoint[]>(makeDefaultEdgePoints());
  const [leftEdge, setLeftEdge] = useState<ControlPoint[]>(makeDefaultSidePoints());
  const [dragging, setDragging] = useState<{ edge: "top" | "left"; index: number } | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<{ edge: "top" | "left"; index: number } | null>(null);
  const [pan, setPan] = useState<PanState>({ offsetX: 0, offsetY: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editorRef = useRef<HTMLCanvasElement>(null);

  const tileCount = params.gridSize * params.gridSize;

  // Build the tile boundary path relative to (0,0) for squares
  const buildSquarePath = useCallback(
    (ctx: CanvasRenderingContext2D, ox: number, oy: number, scale: number) => {
      const s = scale;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      for (const pt of topEdge) ctx.lineTo(ox + pt.x * s, oy + pt.y * s);
      ctx.lineTo(ox + TILE_BASE * s, oy);
      for (const pt of leftEdge) ctx.lineTo(ox + TILE_BASE * s + pt.x * s, oy + pt.y * s);
      ctx.lineTo(ox + TILE_BASE * s, oy + TILE_BASE * s);
      for (let i = topEdge.length - 1; i >= 0; i--) {
        ctx.lineTo(ox + topEdge[i].x * s, oy + TILE_BASE * s + topEdge[i].y * s);
      }
      ctx.lineTo(ox, oy + TILE_BASE * s);
      for (let i = leftEdge.length - 1; i >= 0; i--) {
        ctx.lineTo(ox + leftEdge[i].x * s, oy + leftEdge[i].y * s);
      }
      ctx.closePath();
    },
    [topEdge, leftEdge]
  );

  // Build hexagon path with deformations on alternating edges
  const buildHexPath = useCallback(
    (ctx: CanvasRenderingContext2D, ox: number, oy: number, scale: number) => {
      const s = scale;
      const r = (TILE_BASE * s) / 2;
      const cx = ox + r;
      const cy = oy + r;
      const vertices: { x: number; y: number }[] = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        vertices.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
      }
      ctx.beginPath();
      ctx.moveTo(vertices[0].x, vertices[0].y);
      for (let i = 1; i < 6; i++) {
        const prev = vertices[i - 1];
        const curr = vertices[i];
        if (i % 2 === 1) {
          const mid = { x: (prev.x + curr.x) / 2, y: (prev.y + curr.y) / 2 };
          const deformIdx = Math.min(Math.floor(i / 2), topEdge.length - 1);
          const deform = topEdge[deformIdx] || { x: 0, y: 0 };
          const nx = -(curr.y - prev.y);
          const ny = curr.x - prev.x;
          const len = Math.sqrt(nx * nx + ny * ny) || 1;
          ctx.lineTo(mid.x + (nx / len) * deform.y * s * 0.15, mid.y + (ny / len) * deform.y * s * 0.15);
        }
        ctx.lineTo(curr.x, curr.y);
      }
      ctx.closePath();
    },
    [topEdge]
  );

  // Build triangle path
  const buildTriPath = useCallback(
    (ctx: CanvasRenderingContext2D, ox: number, oy: number, scale: number, flip: boolean) => {
      const s = scale;
      const w = TILE_BASE * s;
      const h = (TILE_BASE * s * Math.sqrt(3)) / 2;
      ctx.beginPath();
      if (!flip) {
        ctx.moveTo(ox, oy + h);
        const midBot = { x: ox + w / 2, y: oy + h };
        const deformAmt = topEdge[0] ? topEdge[0].y * s * 0.1 : 0;
        ctx.lineTo(midBot.x, midBot.y + deformAmt);
        ctx.lineTo(ox + w, oy + h);
        ctx.lineTo(ox + w / 2, oy);
      } else {
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox + w, oy);
        const midBot = { x: ox + w / 2, y: oy + h };
        ctx.lineTo(midBot.x, midBot.y);
      }
      ctx.closePath();
    },
    [topEdge]
  );

  const buildTilePath = useCallback(
    (ctx: CanvasRenderingContext2D, ox: number, oy: number, scale: number, gx?: number, gy?: number) => {
      if (params.shape === "hexagon") {
        buildHexPath(ctx, ox, oy, scale);
      } else if (params.shape === "triangle") {
        const flip = ((gx || 0) + (gy || 0)) % 2 === 1;
        buildTriPath(ctx, ox, oy, scale, flip);
      } else {
        buildSquarePath(ctx, ox, oy, scale);
      }
    },
    [params.shape, buildSquarePath, buildHexPath, buildTriPath]
  );

  // Render tiled grid
  const renderGrid = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(pan.offsetX, pan.offsetY);

    const gridSize = params.gridSize;
    const colors = COLOR_SCHEMES[params.colorScheme];

    if (params.shape === "hexagon") {
      const hexR = Math.min(w, h) / (gridSize * 2);
      const hexW = hexR * 2;
      const hexH = hexR * Math.sqrt(3);
      const startX = (w - gridSize * hexW * 0.75) / 2;
      const startY = (h - gridSize * hexH) / 2;
      for (let gy = 0; gy < gridSize; gy++) {
        for (let gx = 0; gx < gridSize; gx++) {
          const ox = startX + gx * hexW * 0.75;
          const oy = startY + gy * hexH + (gx % 2 === 1 ? hexH / 2 : 0);
          const tileScale = hexR / (TILE_BASE / 2);
          const colorIdx = (gx + gy * 2) % colors.length;
          buildTilePath(ctx, ox, oy, tileScale, gx, gy);
          ctx.fillStyle = colors[colorIdx];
          ctx.fill();
          if (params.showGrid) {
            ctx.strokeStyle = "rgba(255,255,255,0.2)";
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
    } else if (params.shape === "triangle") {
      const triW = Math.min(w, h) / gridSize;
      const triH = (triW * Math.sqrt(3)) / 2;
      const tileScale = triW / TILE_BASE;
      const startX = (w - gridSize * triW / 2) / 2;
      const startY = (h - Math.ceil(gridSize / 2) * triH) / 2;
      for (let gy = 0; gy < gridSize; gy++) {
        for (let gx = 0; gx < gridSize; gx++) {
          const flip = (gx + gy) % 2 === 1;
          const ox = startX + gx * triW / 2;
          const oy = startY + gy * triH;
          const colorIdx = (gx + gy * 2) % colors.length;
          buildTilePath(ctx, ox, oy, tileScale, gx, gy);
          ctx.fillStyle = colors[colorIdx];
          ctx.fill();
          if (params.showGrid) {
            ctx.strokeStyle = "rgba(255,255,255,0.2)";
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
    } else {
      const tileScale = Math.min(w, h) / (gridSize * TILE_BASE);
      const totalW = gridSize * TILE_BASE * tileScale;
      const totalH = gridSize * TILE_BASE * tileScale;
      const startX = (w - totalW) / 2;
      const startY = (h - totalH) / 2;

      for (let gy = 0; gy < gridSize; gy++) {
        for (let gx = 0; gx < gridSize; gx++) {
          const ox = startX + gx * TILE_BASE * tileScale;
          const oy = startY + gy * TILE_BASE * tileScale;
          const colorIdx = (gx + gy * 2) % colors.length;
          buildTilePath(ctx, ox, oy, tileScale, gx, gy);
          ctx.fillStyle = colors[colorIdx];
          ctx.fill();
        }
      }

      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1;
      for (let gy = 0; gy < gridSize; gy++) {
        for (let gx = 0; gx < gridSize; gx++) {
          const ox = startX + gx * TILE_BASE * tileScale;
          const oy = startY + gy * TILE_BASE * tileScale;
          buildTilePath(ctx, ox, oy, tileScale, gx, gy);
          ctx.stroke();
        }
      }

      if (params.showGrid) {
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.lineWidth = 0.5;
        ctx.setLineDash([4, 4]);
        for (let gy = 0; gy <= gridSize; gy++) {
          ctx.beginPath();
          ctx.moveTo(startX, startY + gy * TILE_BASE * tileScale);
          ctx.lineTo(startX + totalW, startY + gy * TILE_BASE * tileScale);
          ctx.stroke();
        }
        for (let gx = 0; gx <= gridSize; gx++) {
          ctx.beginPath();
          ctx.moveTo(startX + gx * TILE_BASE * tileScale, startY);
          ctx.lineTo(startX + gx * TILE_BASE * tileScale, startY + totalH);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }

    ctx.restore();
  }, [params, buildTilePath, pan]);

  // Render editor tile
  const renderEditor = useCallback(() => {
    const canvas = editorRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const margin = 40;
    const scale = (Math.min(w, h) - margin * 2) / TILE_BASE;
    const ox = (w - TILE_BASE * scale) / 2;
    const oy = (h - TILE_BASE * scale) / 2;

    // Ghost square
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(ox, oy, TILE_BASE * scale, TILE_BASE * scale);
    ctx.setLineDash([]);

    // Deformed tile
    buildSquarePath(ctx, ox, oy, scale);
    ctx.fillStyle = "rgba(79, 143, 247, 0.15)";
    ctx.fill();
    ctx.strokeStyle = "#4f8ff7";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Mirrored bottom edge
    ctx.strokeStyle = "rgba(52, 211, 153, 0.6)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(ox, oy + TILE_BASE * scale);
    for (const pt of topEdge) ctx.lineTo(ox + pt.x * scale, oy + TILE_BASE * scale + pt.y * scale);
    ctx.lineTo(ox + TILE_BASE * scale, oy + TILE_BASE * scale);
    ctx.stroke();

    // Mirrored right edge
    ctx.beginPath();
    ctx.moveTo(ox + TILE_BASE * scale, oy);
    for (const pt of leftEdge) ctx.lineTo(ox + TILE_BASE * scale + pt.x * scale, oy + pt.y * scale);
    ctx.lineTo(ox + TILE_BASE * scale, oy + TILE_BASE * scale);
    ctx.stroke();
    ctx.setLineDash([]);

    // Control points - top edge
    for (let i = 0; i < topEdge.length; i++) {
      const pt = topEdge[i];
      const cx = ox + pt.x * scale;
      const cy = oy + pt.y * scale;
      const isHovered = hoveredPoint?.edge === "top" && hoveredPoint?.index === i;
      const isDragged = dragging?.edge === "top" && dragging?.index === i;
      ctx.beginPath();
      ctx.arc(cx, cy, isDragged ? CONTROL_RADIUS + 2 : CONTROL_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = isHovered || isDragged ? "#4f8ff7" : "rgba(79, 143, 247, 0.6)";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Control points - left edge
    for (let i = 0; i < leftEdge.length; i++) {
      const pt = leftEdge[i];
      const cx = ox + pt.x * scale;
      const cy = oy + pt.y * scale;
      const isHovered = hoveredPoint?.edge === "left" && hoveredPoint?.index === i;
      const isDragged = dragging?.edge === "left" && dragging?.index === i;
      ctx.beginPath();
      ctx.arc(cx, cy, isDragged ? CONTROL_RADIUS + 2 : CONTROL_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = isHovered || isDragged ? "#34d399" : "rgba(52, 211, 153, 0.6)";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Labels
    ctx.font = "10px sans-serif";
    ctx.fillStyle = "rgba(161,161,170,0.8)";
    ctx.textAlign = "center";
    ctx.fillText("TOP (drag points)", ox + TILE_BASE * scale / 2, oy - 12);
    ctx.fillText("BOTTOM (mirrors top)", ox + TILE_BASE * scale / 2, oy + TILE_BASE * scale + 20);
    ctx.save();
    ctx.translate(ox - 16, oy + TILE_BASE * scale / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("LEFT (drag)", 0, 0);
    ctx.restore();
    ctx.save();
    ctx.translate(ox + TILE_BASE * scale + 20, oy + TILE_BASE * scale / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillText("RIGHT (mirrors left)", 0, 0);
    ctx.restore();
  }, [topEdge, leftEdge, dragging, hoveredPoint, buildSquarePath]);

  useEffect(() => {
    renderGrid();
    renderEditor();
  }, [renderGrid, renderEditor]);

  // Editor mouse interaction
  const getEditorTransform = useCallback(() => {
    const canvas = editorRef.current;
    if (!canvas) return { ox: 0, oy: 0, scale: 1 };
    const w = canvas.width;
    const h = canvas.height;
    const margin = 40;
    const scale = (Math.min(w, h) - margin * 2) / TILE_BASE;
    const ox = (w - TILE_BASE * scale) / 2;
    const oy = (h - TILE_BASE * scale) / 2;
    return { ox, oy, scale };
  }, []);

  const getCanvasPos = useCallback((e: MouseEvent, ref: { current: HTMLCanvasElement | null }): { x: number; y: number } => {
    const canvas = ref.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const findHitPoint = useCallback(
    (mx: number, my: number): { edge: "top" | "left"; index: number } | null => {
      const { ox, oy, scale } = getEditorTransform();
      for (let i = 0; i < topEdge.length; i++) {
        const cx = ox + topEdge[i].x * scale;
        const cy = oy + topEdge[i].y * scale;
        if (Math.sqrt((mx - cx) ** 2 + (my - cy) ** 2) < CONTROL_HIT_RADIUS) return { edge: "top", index: i };
      }
      for (let i = 0; i < leftEdge.length; i++) {
        const cx = ox + leftEdge[i].x * scale;
        const cy = oy + leftEdge[i].y * scale;
        if (Math.sqrt((mx - cx) ** 2 + (my - cy) ** 2) < CONTROL_HIT_RADIUS) return { edge: "left", index: i };
      }
      return null;
    },
    [topEdge, leftEdge, getEditorTransform]
  );

  const handleEditorDown = useCallback(
    (e: MouseEvent) => {
      const pos = getCanvasPos(e, editorRef);
      const hit = findHitPoint(pos.x, pos.y);
      if (hit) {
        setDragging(hit);
        e.preventDefault();
      }
    },
    [getCanvasPos, findHitPoint]
  );

  const handleEditorMove = useCallback(
    (e: MouseEvent) => {
      const pos = getCanvasPos(e, editorRef);
      if (dragging) {
        const { ox, oy, scale } = getEditorTransform();
        const localX = (pos.x - ox) / scale;
        const localY = (pos.y - oy) / scale;
        if (dragging.edge === "top") {
          setTopEdge((prev) => {
            const next = [...prev];
            const t = (dragging.index + 1) / (POINTS_PER_EDGE + 1);
            next[dragging.index] = { x: t * TILE_BASE, y: Math.max(-TILE_BASE * 0.4, Math.min(TILE_BASE * 0.4, localY)) };
            return next;
          });
        } else {
          setLeftEdge((prev) => {
            const next = [...prev];
            const t = (dragging.index + 1) / (POINTS_PER_EDGE + 1);
            next[dragging.index] = { x: Math.max(-TILE_BASE * 0.4, Math.min(TILE_BASE * 0.4, localX)), y: t * TILE_BASE };
            return next;
          });
        }
      } else {
        setHoveredPoint(findHitPoint(pos.x, pos.y));
      }
    },
    [dragging, getCanvasPos, getEditorTransform, findHitPoint]
  );

  const handleEditorUp = useCallback(() => { setDragging(null); }, []);

  // Pan on main canvas
  const handleGridDown = useCallback((e: MouseEvent) => {
    setIsPanning(true);
    panStartRef.current = { x: e.clientX, y: e.clientY, ox: pan.offsetX, oy: pan.offsetY };
  }, [pan]);

  const handleGridMove = useCallback((e: MouseEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    setPan({ offsetX: panStartRef.current.ox + dx, offsetY: panStartRef.current.oy + dy });
  }, [isPanning]);

  const handleGridUp = useCallback(() => { setIsPanning(false); }, []);

  const resetTile = useCallback(() => {
    setTopEdge(makeDefaultEdgePoints());
    setLeftEdge(makeDefaultSidePoints());
    setPan({ offsetX: 0, offsetY: 0 });
  }, []);

  const applyPreset = useCallback((preset: PresetDef) => {
    setTopEdge(preset.topEdge.map((p) => ({ ...p })));
    setLeftEdge(preset.leftEdge.map((p) => ({ ...p })));
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Controls Bar */}
      <div style={panelStyle}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <span style={labelStyle}>Shape</span>
          {(["square", "hexagon", "triangle"] as ShapeType[]).map((s) => (
            <button
              key={s}
              style={params.shape === s ? btnActiveStyle : btnStyle}
              onClick={() => setParams((p) => ({ ...p, shape: s }))}
            >
              {SHAPE_LABELS[s]}
            </button>
          ))}

          <span style={{ ...labelStyle, marginLeft: "0.75rem" }}>Colors</span>
          {(Object.keys(COLOR_SCHEMES) as ColorSchemeId[]).map((sid) => (
            <button
              key={sid}
              style={params.colorScheme === sid ? btnActiveStyle : btnStyle}
              onClick={() => setParams((p) => ({ ...p, colorScheme: sid }))}
            >
              <span style={{ display: "inline-flex", gap: "2px", marginRight: "4px" }}>
                {COLOR_SCHEMES[sid].map((c, i) => (
                  <span key={i} style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "2px", background: c }} />
                ))}
              </span>
              {SCHEME_LABELS[sid]}
            </button>
          ))}

          <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", fontFamily: "monospace" }}>
              {tileCount} tiles
            </span>
            <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={params.showGrid}
                onChange={(e) => setParams((p) => ({ ...p, showGrid: (e.target as HTMLInputElement).checked }))}
                style={{ accentColor: "var(--color-primary)" }}
              />
              Grid
            </label>
            <button style={btnStyle} onClick={resetTile}>Reset</button>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        {/* Tiled Grid */}
        <div style={{ flex: "1 1 400px", minWidth: 0 }}>
          <div style={panelStyle}>
            <canvas
              ref={canvasRef}
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              style={{ width: "100%", height: "auto", display: "block", borderRadius: "0.375rem", background: "var(--color-bg)", cursor: isPanning ? "grabbing" : "grab" }}
              onMouseDown={handleGridDown}
              onMouseMove={handleGridMove}
              onMouseUp={handleGridUp}
              onMouseLeave={handleGridUp}
            />
          </div>
        </div>

        {/* Editor + Controls */}
        <div style={{ flex: "0 0 320px", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {/* Tile Editor */}
          <div style={panelStyle}>
            <span style={{ ...labelStyle, fontSize: "0.75rem", display: "block", marginBottom: "0.5rem" }}>
              Tile Editor (square base)
            </span>
            <canvas
              ref={editorRef}
              width={300}
              height={300}
              style={{
                width: "100%",
                height: "auto",
                display: "block",
                borderRadius: "0.375rem",
                background: "var(--color-bg)",
                cursor: hoveredPoint ? "grab" : dragging ? "grabbing" : "default",
              }}
              onMouseDown={handleEditorDown}
              onMouseMove={handleEditorMove}
              onMouseUp={handleEditorUp}
              onMouseLeave={handleEditorUp}
            />
          </div>

          {/* Grid Size */}
          <div style={panelStyle}>
            <label style={labelStyle}>Grid Size: {params.gridSize} x {params.gridSize}</label>
            <input
              type="range" min={3} max={12} step={1}
              value={params.gridSize}
              onInput={(e) => setParams((p) => ({ ...p, gridSize: parseInt((e.target as HTMLInputElement).value) }))}
              style={sliderStyle}
            />
          </div>

          {/* Presets */}
          <div style={panelStyle}>
            <span style={{ ...labelStyle, fontSize: "0.75rem", display: "block", marginBottom: "0.5rem" }}>Presets</span>
            <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
              {PRESETS.map((p) => (
                <button key={p.id} style={btnStyle} onClick={() => applyPreset(p)}>{p.name}</button>
              ))}
            </div>
          </div>

          {/* Info */}
          <div style={panelStyle}>
            <span style={{ ...labelStyle, fontSize: "0.75rem" }}>How It Works</span>
            <p style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", marginTop: "0.5rem", lineHeight: "1.5" }}>
              Drag the blue control points on the top edge -- the bottom edge mirrors
              the same deformation. Drag the green points on the left edge -- the right
              edge mirrors them. This creates a translational tessellation where tiles
              interlock perfectly. Pan the tiled view by dragging the background. Choose
              between square, hexagonal, and triangular base shapes.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
