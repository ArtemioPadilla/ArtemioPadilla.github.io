import {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "preact/hooks";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

interface Rule {
  predecessor: string;
  successor: string;
}

interface LSystemConfig {
  axiom: string;
  rules: Rule[];
  angle: number;
  iterations: number;
}

interface TurtleState {
  x: number;
  y: number;
  heading: number;
}

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  depth: number;
}

interface BoundsBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface Preset {
  name: string;
  axiom: string;
  rules: Rule[];
  angle: number;
  iterations: number;
  startAngle: number;
}

type ColorModeType = "monochrome" | "depth" | "rainbow";

type AnimPhase = "idle" | "rewrite" | "draw";

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const MIN_ITERATIONS = 1;
const MAX_ITERATIONS = 8;
const MIN_STEP = 1;
const MAX_STEP = 50;
const DEFAULT_STEP = 10;
const MIN_LINE_WIDTH = 0.5;
const MAX_LINE_WIDTH = 5;
const DEFAULT_LINE_WIDTH = 1.5;
const ZOOM_FACTOR = 1.1;
const MIN_ZOOM = 0.01;
const MAX_ZOOM = 100;
const STRING_DISPLAY_LIMIT = 2000;
const DRAW_BATCH_SIZE = 200;

const CHAR_COLORS: Record<string, string> = {
  F: "#4f8ff7",
  G: "#34d399",
  "+": "#f59e0b",
  "-": "#ef4444",
  "[": "#a855f7",
  "]": "#ec4899",
  X: "#14b8a6",
  Y: "#f97316",
  A: "#4f8ff7",
  B: "#34d399",
};

// ─────────────────────────────────────────────────────────
// Presets
// ─────────────────────────────────────────────────────────

const PRESETS: Preset[] = [
  {
    name: "Koch Snowflake",
    axiom: "F--F--F",
    rules: [{ predecessor: "F", successor: "F+F--F+F" }],
    angle: 60,
    iterations: 4,
    startAngle: 0,
  },
  {
    name: "Sierpinski Triangle",
    axiom: "F-G-G",
    rules: [
      { predecessor: "F", successor: "F-G+F+G-F" },
      { predecessor: "G", successor: "GG" },
    ],
    angle: 120,
    iterations: 5,
    startAngle: 0,
  },
  {
    name: "Dragon Curve",
    axiom: "FX",
    rules: [
      { predecessor: "X", successor: "X+YF+" },
      { predecessor: "Y", successor: "-FX-Y" },
    ],
    angle: 90,
    iterations: 10,
    startAngle: 0,
  },
  {
    name: "Fractal Tree",
    axiom: "X",
    rules: [
      { predecessor: "X", successor: "F[+X][-X]FX" },
      { predecessor: "F", successor: "FF" },
    ],
    angle: 25,
    iterations: 6,
    startAngle: -90,
  },
  {
    name: "Hilbert Curve",
    axiom: "A",
    rules: [
      { predecessor: "A", successor: "-BF+AFA+FB-" },
      { predecessor: "B", successor: "+AF-BFB-FA+" },
    ],
    angle: 90,
    iterations: 5,
    startAngle: 0,
  },
  {
    name: "Gosper Curve",
    axiom: "A",
    rules: [
      { predecessor: "A", successor: "A-B--B+A++AA+B-" },
      { predecessor: "B", successor: "+A-BB--B-A++A+B" },
    ],
    angle: 60,
    iterations: 4,
    startAngle: 0,
  },
  {
    name: "Fractal Plant",
    axiom: "X",
    rules: [
      { predecessor: "X", successor: "F+[[X]-X]-F[-FX]+X" },
      { predecessor: "F", successor: "FF" },
    ],
    angle: 25,
    iterations: 5,
    startAngle: -90,
  },
  {
    name: "Barnsley Fern",
    axiom: "X",
    rules: [
      { predecessor: "X", successor: "F[-X][X]F[-X]+FX" },
      { predecessor: "F", successor: "FF" },
    ],
    angle: 25,
    iterations: 5,
    startAngle: -90,
  },
  {
    name: "Penrose Tiling",
    axiom: "[X]++[X]++[X]++[X]++[X]",
    rules: [
      { predecessor: "F", successor: "" },
      { predecessor: "X", successor: "+YF--ZF[---WF--XF]+" },
      { predecessor: "Y", successor: "-WF++XF[+++YF++ZF]-" },
      { predecessor: "Z", successor: "--YF++++WF[+ZF++++XF]--XF" },
      { predecessor: "W", successor: "++ZF----XF[---WF----YF]++YF" },
    ],
    angle: 36,
    iterations: 5,
    startAngle: 0,
  },
];

// ─────────────────────────────────────────────────────────
// Pure L-System Logic
// ─────────────────────────────────────────────────────────

function rewriteOnce(str: string, rules: Rule[]): string {
  const ruleMap = new Map<string, string>();
  for (const r of rules) {
    ruleMap.set(r.predecessor, r.successor);
  }
  let result = "";
  for (const ch of str) {
    result += ruleMap.get(ch) ?? ch;
  }
  return result;
}

function rewriteNTimes(axiom: string, rules: Rule[], n: number): string[] {
  const steps: string[] = [axiom];
  let current = axiom;
  for (let i = 0; i < n; i++) {
    current = rewriteOnce(current, rules);
    steps.push(current);
  }
  return steps;
}

function interpretTurtle(
  str: string,
  angleDeg: number,
  stepLen: number,
  startAngleDeg: number,
): Segment[] {
  const segments: Segment[] = [];
  const stack: TurtleState[] = [];
  const angleRad = (angleDeg * Math.PI) / 180;
  let state: TurtleState = {
    x: 0,
    y: 0,
    heading: (startAngleDeg * Math.PI) / 180,
  };
  let depth = 0;

  for (const ch of str) {
    switch (ch) {
      case "F":
      case "G":
      case "A":
      case "B": {
        const nx = state.x + stepLen * Math.cos(state.heading);
        const ny = state.y + stepLen * Math.sin(state.heading);
        segments.push({
          x1: state.x,
          y1: state.y,
          x2: nx,
          y2: ny,
          depth,
        });
        state = { ...state, x: nx, y: ny };
        break;
      }
      case "+":
        state = { ...state, heading: state.heading + angleRad };
        break;
      case "-":
        state = { ...state, heading: state.heading - angleRad };
        break;
      case "[":
        stack.push({ ...state });
        depth++;
        break;
      case "]":
        if (stack.length > 0) {
          state = stack.pop()!;
          depth = Math.max(0, depth - 1);
        }
        break;
      default:
        break;
    }
  }
  return segments;
}

function computeBounds(segments: Segment[]): BoundsBox {
  if (segments.length === 0) {
    return { minX: -1, maxX: 1, minY: -1, maxY: 1 };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of segments) {
    minX = Math.min(minX, s.x1, s.x2);
    maxX = Math.max(maxX, s.x1, s.x2);
    minY = Math.min(minY, s.y1, s.y2);
    maxY = Math.max(maxY, s.y1, s.y2);
  }
  return { minX, maxX, minY, maxY };
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function lerpColor(c1: string, c2: string, t: number): string {
  const r1 = parseInt(c1.slice(1, 3), 16);
  const g1 = parseInt(c1.slice(3, 5), 16);
  const b1 = parseInt(c1.slice(5, 7), 16);
  const r2 = parseInt(c2.slice(1, 3), 16);
  const g2 = parseInt(c2.slice(3, 5), 16);
  const b2 = parseInt(c2.slice(5, 7), 16);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

export default function LSystem() {
  // Canvas + rendering state
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });

  // L-System config
  const [axiom, setAxiom] = useState(PRESETS[0].axiom);
  const [rules, setRules] = useState<Rule[]>([...PRESETS[0].rules]);
  const [angle, setAngle] = useState(PRESETS[0].angle);
  const [iterations, setIterations] = useState(PRESETS[0].iterations);
  const [startAngle, setStartAngle] = useState(PRESETS[0].startAngle);
  const [selectedPreset, setSelectedPreset] = useState(0);

  // Customization
  const [stepLength, setStepLength] = useState(DEFAULT_STEP);
  const [lineWidth, setLineWidth] = useState(DEFAULT_LINE_WIDTH);
  const [lineColor, setLineColor] = useState("#4f8ff7");
  const [lineColor2, setLineColor2] = useState("#34d399");
  const [bgColor, setBgColor] = useState("");
  const [colorMode, setColorMode] = useState<ColorModeType>("depth");

  // Camera
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  // Drag state for pan
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });

  // Computed L-system data
  const [rewriteSteps, setRewriteSteps] = useState<string[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [maxDepth, setMaxDepth] = useState(0);

  // Animation
  const [animPhase, setAnimPhase] = useState<AnimPhase>("idle");
  const [animRewriteStep, setAnimRewriteStep] = useState(0);
  const [animDrawProgress, setAnimDrawProgress] = useState(0);
  const animFrameRef = useRef(0);

  // String display
  const [showString, setShowString] = useState(false);
  const [viewIteration, setViewIteration] = useState(0);

  // Tab
  const [activeTab, setActiveTab] = useState<"editor" | "customize" | "export">("editor");

  // ─── Resize Observer ───────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        const h = Math.max(400, Math.floor(w * 0.65));
        setCanvasSize({ w, h });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ─── Recompute L-System ────────────────────────────────
  useEffect(() => {
    if (animPhase !== "idle") return;
    const validRules = rules.filter((r) => r.predecessor.length === 1);
    const steps = rewriteNTimes(axiom, validRules, iterations);
    setRewriteSteps(steps);

    const finalStr = steps[steps.length - 1];
    const segs = interpretTurtle(finalStr, angle, stepLength, startAngle);
    setSegments(segs);

    let md = 0;
    for (const s of segs) {
      if (s.depth > md) md = s.depth;
    }
    setMaxDepth(md);
    setViewIteration(iterations);
  }, [axiom, rules, angle, iterations, stepLength, startAngle, animPhase]);

  // ─── Fit to Canvas ────────────────────────────────────
  const fitToCanvas = useCallback(() => {
    if (segments.length === 0) return;
    const bounds = computeBounds(segments);
    const bw = bounds.maxX - bounds.minX || 1;
    const bh = bounds.maxY - bounds.minY || 1;
    const padding = 40;
    const scaleX = (canvasSize.w - padding * 2) / bw;
    const scaleY = (canvasSize.h - padding * 2) / bh;
    const newZoom = Math.min(scaleX, scaleY);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    setZoom(newZoom);
    setPanX(canvasSize.w / 2 - cx * newZoom);
    setPanY(canvasSize.h / 2 - cy * newZoom);
  }, [segments, canvasSize]);

  // Auto fit on new data
  useEffect(() => {
    if (animPhase === "idle") {
      fitToCanvas();
    }
  }, [segments, canvasSize, fitToCanvas, animPhase]);

  // ─── Get Segment Color ────────────────────────────────
  const getSegmentColor = useCallback(
    (seg: Segment, index: number, total: number): string => {
      switch (colorMode) {
        case "monochrome":
          return lineColor;
        case "depth": {
          const t = maxDepth > 0 ? seg.depth / maxDepth : 0;
          return lerpColor(lineColor, lineColor2, t);
        }
        case "rainbow": {
          const hue = total > 1 ? (index / total) * 360 : 0;
          return hslToHex(hue, 0.8, 0.55);
        }
        default:
          return lineColor;
      }
    },
    [colorMode, lineColor, lineColor2, maxDepth],
  );

  // ─── Canvas Rendering ─────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = canvasSize.w * dpr;
    canvas.height = canvasSize.h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    if (bgColor) {
      ctx.fillStyle = bgColor;
    } else {
      ctx.fillStyle =
        typeof document !== "undefined" &&
        document.documentElement.classList.contains("light")
          ? "#fafafa"
          : "#09090b";
    }
    ctx.fillRect(0, 0, canvasSize.w, canvasSize.h);

    if (segments.length === 0) {
      ctx.fillStyle =
        typeof document !== "undefined" &&
        document.documentElement.classList.contains("light")
          ? "#71717a"
          : "#a1a1aa";
      ctx.font = "14px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        "Define rules and click Generate to see your fractal",
        canvasSize.w / 2,
        canvasSize.h / 2,
      );
      return;
    }

    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    const drawCount =
      animPhase === "draw"
        ? Math.min(animDrawProgress, segments.length)
        : segments.length;

    ctx.lineWidth = lineWidth / zoom;
    ctx.lineCap = "round";

    for (let i = 0; i < drawCount; i++) {
      const seg = segments[i];
      ctx.strokeStyle = getSegmentColor(seg, i, drawCount);
      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
      ctx.stroke();
    }

    ctx.restore();
  }, [
    canvasSize,
    segments,
    zoom,
    panX,
    panY,
    lineWidth,
    bgColor,
    animPhase,
    animDrawProgress,
    getSegmentColor,
  ]);

  // ─── Animation Loop ───────────────────────────────────
  useEffect(() => {
    if (animPhase === "idle") return;

    if (animPhase === "rewrite") {
      const timer = setTimeout(() => {
        if (animRewriteStep < iterations) {
          setAnimRewriteStep((s) => s + 1);
          setViewIteration((v) => v + 1);
        } else {
          setAnimPhase("draw");
          setAnimDrawProgress(0);
        }
      }, 600);
      return () => clearTimeout(timer);
    }

    if (animPhase === "draw") {
      let running = true;
      const animate = () => {
        if (!running) return;
        setAnimDrawProgress((p) => {
          const next = p + DRAW_BATCH_SIZE;
          if (next >= segments.length) {
            setAnimPhase("idle");
            return segments.length;
          }
          return next;
        });
        animFrameRef.current = requestAnimationFrame(animate);
      };
      animFrameRef.current = requestAnimationFrame(animate);
      return () => {
        running = false;
        cancelAnimationFrame(animFrameRef.current);
      };
    }
  }, [animPhase, animRewriteStep, iterations, segments.length]);

  // ─── Mouse / Touch Handlers ───────────────────────────
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const direction = e.deltaY < 0 ? 1 : -1;
      const factor = direction > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
      const ratio = newZoom / zoom;
      setPanX(mx - (mx - panX) * ratio);
      setPanY(my - (my - panY) * ratio);
      setZoom(newZoom);
    },
    [zoom, panX, panY],
  );

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      isDragging.current = true;
      dragStart.current = { x: e.clientX, y: e.clientY };
      panStart.current = { x: panX, y: panY };
      (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
    },
    [panX, panY],
  );

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPanX(panStart.current.x + dx);
    setPanY(panStart.current.y + dy);
  }, []);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  // ─── Attach Wheel Listener (passive: false) ───────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // ─── Preset Selection ─────────────────────────────────
  const applyPreset = useCallback((index: number) => {
    const p = PRESETS[index];
    setSelectedPreset(index);
    setAxiom(p.axiom);
    setRules(p.rules.map((r) => ({ ...r })));
    setAngle(p.angle);
    setIterations(p.iterations);
    setStartAngle(p.startAngle);
    setAnimPhase("idle");
  }, []);

  // ─── Rule Management ──────────────────────────────────
  const addRule = useCallback(() => {
    setRules((prev) => [...prev, { predecessor: "", successor: "" }]);
  }, []);

  const removeRule = useCallback((index: number) => {
    setRules((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateRule = useCallback(
    (index: number, field: "predecessor" | "successor", value: string) => {
      setRules((prev) =>
        prev.map((r, i) =>
          i === index ? { ...r, [field]: field === "predecessor" ? value.slice(0, 1) : value } : r,
        ),
      );
    },
    [],
  );

  // ─── Animation Controls ───────────────────────────────
  const startAnimation = useCallback(() => {
    setAnimRewriteStep(0);
    setViewIteration(0);
    setAnimDrawProgress(0);
    setAnimPhase("rewrite");
  }, []);

  const stopAnimation = useCallback(() => {
    setAnimPhase("idle");
    cancelAnimationFrame(animFrameRef.current);
  }, []);

  // ─── Export ───────────────────────────────────────────
  const exportPNG = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = "l-system-fractal.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, []);

  const copySVGPath = useCallback(() => {
    if (segments.length === 0) return;
    let path = "";
    for (const seg of segments) {
      path += `M${seg.x1.toFixed(2)},${seg.y1.toFixed(2)} L${seg.x2.toFixed(2)},${seg.y2.toFixed(2)} `;
    }
    navigator.clipboard.writeText(path.trim()).catch(() => {
      /* clipboard not available */
    });
  }, [segments]);

  // ─── Stats ────────────────────────────────────────────
  const finalString =
    rewriteSteps.length > 0 ? rewriteSteps[rewriteSteps.length - 1] : axiom;
  const stringLength = finalString.length;
  const segmentCount = segments.length;

  // ─── Displayed String ─────────────────────────────────
  const displayedString =
    rewriteSteps.length > viewIteration
      ? rewriteSteps[viewIteration]
      : finalString;
  const truncatedString =
    displayedString.length > STRING_DISPLAY_LIMIT
      ? displayedString.slice(0, STRING_DISPLAY_LIMIT)
      : displayedString;
  const isTruncated = displayedString.length > STRING_DISPLAY_LIMIT;

  // ─── Render ───────────────────────────────────────────

  const inputClass =
    "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none";
  const btnClass =
    "rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-border)] disabled:opacity-40";
  const btnPrimaryClass =
    "rounded bg-[var(--color-primary)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:opacity-40";
  const labelClass =
    "block text-xs font-medium text-[var(--color-text-muted)] mb-1";

  return (
    <div class="space-y-4">
      {/* ── Stats Bar ────────────────────────────────────── */}
      <div class="flex flex-wrap items-center gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs text-[var(--color-text-muted)]">
        <span>
          Iterations: <strong class="text-[var(--color-heading)]">{iterations}</strong>
        </span>
        <span>
          String length:{" "}
          <strong class="text-[var(--color-heading)]">
            {stringLength.toLocaleString()}
          </strong>
        </span>
        <span>
          Segments:{" "}
          <strong class="text-[var(--color-heading)]">
            {segmentCount.toLocaleString()}
          </strong>
        </span>
        {animPhase !== "idle" && (
          <span class="text-[var(--color-accent)]">
            {animPhase === "rewrite"
              ? `Rewriting... step ${animRewriteStep}/${iterations}`
              : `Drawing... ${Math.min(animDrawProgress, segments.length)}/${segments.length}`}
          </span>
        )}
      </div>

      <div class="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* ── Control Panel ──────────────────────────────── */}
        <div class="space-y-3">
          {/* Tabs */}
          <div class="flex gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
            {(["editor", "customize", "export"] as const).map((tab) => (
              <button
                key={tab}
                class={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                  activeTab === tab
                    ? "bg-[var(--color-primary)] text-white"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                }`}
                onClick={() => setActiveTab(tab)}
              >
                {tab === "editor" ? "Editor" : tab === "customize" ? "Style" : "Export"}
              </button>
            ))}
          </div>

          {/* ── Editor Tab ───────────────────────────────── */}
          {activeTab === "editor" && (
            <div class="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              {/* Preset Select */}
              <div>
                <label class={labelClass}>Preset</label>
                <select
                  class={inputClass}
                  value={selectedPreset}
                  onChange={(e) =>
                    applyPreset(parseInt((e.target as HTMLSelectElement).value, 10))
                  }
                >
                  {PRESETS.map((p, i) => (
                    <option key={p.name} value={i}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Axiom */}
              <div>
                <label class={labelClass}>Axiom</label>
                <input
                  type="text"
                  class={inputClass}
                  value={axiom}
                  onInput={(e) => setAxiom((e.target as HTMLInputElement).value)}
                  spellcheck={false}
                />
              </div>

              {/* Rules */}
              <div>
                <div class="mb-1 flex items-center justify-between">
                  <label class={labelClass}>Production Rules</label>
                  <button class={btnClass} onClick={addRule}>
                    + Add
                  </button>
                </div>
                <div class="space-y-1.5">
                  {rules.map((rule, i) => (
                    <div key={i} class="flex items-center gap-1">
                      <input
                        type="text"
                        class="w-10 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1 text-center text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
                        value={rule.predecessor}
                        maxLength={1}
                        onInput={(e) =>
                          updateRule(
                            i,
                            "predecessor",
                            (e.target as HTMLInputElement).value,
                          )
                        }
                        spellcheck={false}
                      />
                      <span class="text-xs text-[var(--color-text-muted)]">-&gt;</span>
                      <input
                        type="text"
                        class="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
                        value={rule.successor}
                        onInput={(e) =>
                          updateRule(
                            i,
                            "successor",
                            (e.target as HTMLInputElement).value,
                          )
                        }
                        spellcheck={false}
                      />
                      {rules.length > 1 && (
                        <button
                          class="rounded p-1 text-xs text-[var(--color-text-muted)] hover:text-red-400"
                          onClick={() => removeRule(i)}
                          title="Remove rule"
                        >
                          x
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Angle */}
              <div>
                <label class={labelClass}>
                  Angle: {angle}deg
                </label>
                <input
                  type="range"
                  class="w-full accent-[var(--color-primary)]"
                  min={1}
                  max={180}
                  step={1}
                  value={angle}
                  onInput={(e) =>
                    setAngle(parseInt((e.target as HTMLInputElement).value, 10))
                  }
                />
              </div>

              {/* Iterations */}
              <div>
                <label class={labelClass}>
                  Iterations: {iterations}
                </label>
                <input
                  type="range"
                  class="w-full accent-[var(--color-primary)]"
                  min={MIN_ITERATIONS}
                  max={MAX_ITERATIONS}
                  step={1}
                  value={iterations}
                  onInput={(e) =>
                    setIterations(
                      parseInt((e.target as HTMLInputElement).value, 10),
                    )
                  }
                />
              </div>

              {/* Start Angle */}
              <div>
                <label class={labelClass}>
                  Start Angle: {startAngle}deg
                </label>
                <input
                  type="range"
                  class="w-full accent-[var(--color-primary)]"
                  min={-180}
                  max={180}
                  step={1}
                  value={startAngle}
                  onInput={(e) =>
                    setStartAngle(
                      parseInt((e.target as HTMLInputElement).value, 10),
                    )
                  }
                />
              </div>

              {/* Step Length */}
              <div>
                <label class={labelClass}>
                  Step Length: {stepLength}
                </label>
                <input
                  type="range"
                  class="w-full accent-[var(--color-primary)]"
                  min={MIN_STEP}
                  max={MAX_STEP}
                  step={1}
                  value={stepLength}
                  onInput={(e) =>
                    setStepLength(
                      parseInt((e.target as HTMLInputElement).value, 10),
                    )
                  }
                />
              </div>

              {/* Animation Buttons */}
              <div class="flex gap-2 pt-1">
                {animPhase === "idle" ? (
                  <button class={btnPrimaryClass} onClick={startAnimation}>
                    Animate
                  </button>
                ) : (
                  <button class={btnClass} onClick={stopAnimation}>
                    Stop
                  </button>
                )}
                <button class={btnClass} onClick={fitToCanvas}>
                  Fit View
                </button>
              </div>
            </div>
          )}

          {/* ── Customize Tab ────────────────────────────── */}
          {activeTab === "customize" && (
            <div class="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              {/* Color Mode */}
              <div>
                <label class={labelClass}>Color Mode</label>
                <select
                  class={inputClass}
                  value={colorMode}
                  onChange={(e) =>
                    setColorMode(
                      (e.target as HTMLSelectElement).value as ColorModeType,
                    )
                  }
                >
                  <option value="monochrome">Monochrome</option>
                  <option value="depth">Depth Gradient</option>
                  <option value="rainbow">Rainbow</option>
                </select>
              </div>

              {/* Line Color */}
              <div>
                <label class={labelClass}>
                  {colorMode === "depth" ? "Root Color" : "Line Color"}
                </label>
                <div class="flex items-center gap-2">
                  <input
                    type="color"
                    class="h-8 w-8 cursor-pointer rounded border border-[var(--color-border)]"
                    value={lineColor}
                    onInput={(e) =>
                      setLineColor((e.target as HTMLInputElement).value)
                    }
                  />
                  <span class="text-xs text-[var(--color-text-muted)]">
                    {lineColor}
                  </span>
                </div>
              </div>

              {/* Tip Color (depth mode) */}
              {colorMode === "depth" && (
                <div>
                  <label class={labelClass}>Tip Color</label>
                  <div class="flex items-center gap-2">
                    <input
                      type="color"
                      class="h-8 w-8 cursor-pointer rounded border border-[var(--color-border)]"
                      value={lineColor2}
                      onInput={(e) =>
                        setLineColor2((e.target as HTMLInputElement).value)
                      }
                    />
                    <span class="text-xs text-[var(--color-text-muted)]">
                      {lineColor2}
                    </span>
                  </div>
                </div>
              )}

              {/* Line Width */}
              <div>
                <label class={labelClass}>
                  Line Width: {lineWidth.toFixed(1)}
                </label>
                <input
                  type="range"
                  class="w-full accent-[var(--color-primary)]"
                  min={MIN_LINE_WIDTH}
                  max={MAX_LINE_WIDTH}
                  step={0.1}
                  value={lineWidth}
                  onInput={(e) =>
                    setLineWidth(
                      parseFloat((e.target as HTMLInputElement).value),
                    )
                  }
                />
              </div>

              {/* Background Color */}
              <div>
                <label class={labelClass}>Background</label>
                <div class="flex items-center gap-2">
                  <input
                    type="color"
                    class="h-8 w-8 cursor-pointer rounded border border-[var(--color-border)]"
                    value={bgColor || "#09090b"}
                    onInput={(e) =>
                      setBgColor((e.target as HTMLInputElement).value)
                    }
                  />
                  <button
                    class="text-xs text-[var(--color-text-muted)] underline hover:text-[var(--color-text)]"
                    onClick={() => setBgColor("")}
                  >
                    Reset to theme
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Export Tab ────────────────────────────────── */}
          {activeTab === "export" && (
            <div class="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <button class={btnPrimaryClass + " w-full"} onClick={exportPNG}>
                Download PNG
              </button>
              <button class={btnClass + " w-full"} onClick={copySVGPath}>
                Copy SVG Path
              </button>
              <p class="text-xs text-[var(--color-text-muted)]">
                PNG exports the canvas at current view. SVG path copies all
                segments as M/L commands to clipboard.
              </p>
            </div>
          )}
        </div>

        {/* ── Canvas Area ────────────────────────────────── */}
        <div class="space-y-2">
          <div
            ref={containerRef}
            class="relative overflow-hidden rounded-lg border border-[var(--color-border)]"
          >
            <canvas
              ref={canvasRef}
              style={{ width: `${canvasSize.w}px`, height: `${canvasSize.h}px` }}
              class="block cursor-grab active:cursor-grabbing"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            />
            {/* Canvas controls overlay */}
            <div class="absolute bottom-2 right-2 flex gap-1">
              <button
                class="rounded bg-[var(--color-surface)] p-1.5 text-xs text-[var(--color-text-muted)] shadow-sm border border-[var(--color-border)] hover:text-[var(--color-text)]"
                onClick={() => {
                  const newZoom = Math.min(MAX_ZOOM, zoom * 1.3);
                  const ratio = newZoom / zoom;
                  setPanX(canvasSize.w / 2 - (canvasSize.w / 2 - panX) * ratio);
                  setPanY(canvasSize.h / 2 - (canvasSize.h / 2 - panY) * ratio);
                  setZoom(newZoom);
                }}
                title="Zoom in"
              >
                +
              </button>
              <button
                class="rounded bg-[var(--color-surface)] p-1.5 text-xs text-[var(--color-text-muted)] shadow-sm border border-[var(--color-border)] hover:text-[var(--color-text)]"
                onClick={() => {
                  const newZoom = Math.max(MIN_ZOOM, zoom / 1.3);
                  const ratio = newZoom / zoom;
                  setPanX(canvasSize.w / 2 - (canvasSize.w / 2 - panX) * ratio);
                  setPanY(canvasSize.h / 2 - (canvasSize.h / 2 - panY) * ratio);
                  setZoom(newZoom);
                }}
                title="Zoom out"
              >
                -
              </button>
              <button
                class="rounded bg-[var(--color-surface)] p-1.5 text-xs text-[var(--color-text-muted)] shadow-sm border border-[var(--color-border)] hover:text-[var(--color-text)]"
                onClick={fitToCanvas}
                title="Fit to view"
              >
                Fit
              </button>
            </div>
          </div>

          {/* ── String Display ───────────────────────────── */}
          <div>
            <button
              class="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              onClick={() => setShowString((v) => !v)}
            >
              <span
                class="inline-block transition-transform"
                style={{ transform: showString ? "rotate(90deg)" : "rotate(0)" }}
              >
                &#9654;
              </span>
              L-System String (iteration {viewIteration}, {displayedString.length.toLocaleString()} chars)
            </button>

            {showString && (
              <div class="mt-1 space-y-2">
                {/* Iteration selector */}
                {rewriteSteps.length > 1 && (
                  <div class="flex items-center gap-2">
                    <label class="text-xs text-[var(--color-text-muted)]">
                      View iteration:
                    </label>
                    <input
                      type="range"
                      class="flex-1 accent-[var(--color-primary)]"
                      min={0}
                      max={rewriteSteps.length - 1}
                      step={1}
                      value={viewIteration}
                      onInput={(e) =>
                        setViewIteration(
                          parseInt((e.target as HTMLInputElement).value, 10),
                        )
                      }
                    />
                    <span class="text-xs text-[var(--color-text-muted)] tabular-nums w-6 text-right">
                      {viewIteration}
                    </span>
                  </div>
                )}
                <div class="max-h-32 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 font-mono text-xs leading-relaxed">
                  {truncatedString.split("").map((ch, idx) => (
                    <span
                      key={idx}
                      style={{ color: CHAR_COLORS[ch] || "var(--color-text-muted)" }}
                    >
                      {ch}
                    </span>
                  ))}
                  {isTruncated && (
                    <span class="text-[var(--color-text-muted)]">
                      {" "}
                      ... ({(displayedString.length - STRING_DISPLAY_LIMIT).toLocaleString()}{" "}
                      more)
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Quick Reference ──────────────────────────────── */}
      <details class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <summary class="cursor-pointer px-4 py-2 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          Turtle Graphics Reference
        </summary>
        <div class="grid grid-cols-2 gap-x-6 gap-y-1 px-4 pb-3 pt-1 text-xs text-[var(--color-text-muted)] sm:grid-cols-4">
          <div>
            <span style={{ color: CHAR_COLORS.F }}>F</span> / <span style={{ color: CHAR_COLORS.G }}>G</span> / <span style={{ color: CHAR_COLORS.A }}>A</span> / <span style={{ color: CHAR_COLORS.B }}>B</span> = Draw forward
          </div>
          <div>
            <span style={{ color: CHAR_COLORS["+"] }}>+</span> = Turn right
          </div>
          <div>
            <span style={{ color: CHAR_COLORS["-"] }}>-</span> = Turn left
          </div>
          <div>
            <span style={{ color: CHAR_COLORS["["] }}>[</span> = Push state
          </div>
          <div>
            <span style={{ color: CHAR_COLORS["]"] }}>]</span> = Pop state
          </div>
          <div>Other = ignored (used as rewrite variables)</div>
        </div>
      </details>
    </div>
  );
}
