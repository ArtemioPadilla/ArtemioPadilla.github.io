import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

interface CurveParams {
  intercept: number;
  slope: number;
}

interface Equilibrium {
  price: number;
  quantity: number;
}

interface OverlayState {
  priceFloor: boolean;
  priceFloorValue: number;
  priceCeiling: boolean;
  priceCeilingValue: number;
  tax: boolean;
  taxAmount: number;
  subsidy: boolean;
  subsidyAmount: number;
}

interface SurplusAreas {
  consumerSurplus: number;
  producerSurplus: number;
  deadweightLoss: number;
}

interface Preset {
  name: string;
  supply: CurveParams;
  demand: CurveParams;
  overlay: Partial<OverlayState>;
}

type DragTarget =
  | "supply-intercept"
  | "supply-slope"
  | "demand-intercept"
  | "demand-slope"
  | null;

/* ══════════════════════════════════════════════════════════
   Constants
   ══════════════════════════════════════════════════════════ */

const CANVAS_PAD = { top: 20, right: 20, bottom: 50, left: 60 };
const MAX_PRICE = 100;
const MAX_QUANTITY = 100;
const ANIM_DURATION = 400;

const COLORS = {
  supply: "#ef4444",
  demand: "#3b82f6",
  equilibrium: "#f59e0b",
  consumerSurplus: "rgba(59,130,246,0.15)",
  producerSurplus: "rgba(239,68,68,0.15)",
  deadweightLoss: "rgba(156,163,175,0.25)",
  priceFloor: "#ef4444",
  priceCeiling: "#3b82f6",
  tax: "#a855f7",
  subsidy: "#34d399",
  grid: "rgba(100,100,120,0.12)",
  axis: "rgba(160,160,180,0.6)",
  controlPoint: "#f59e0b",
};

const DEFAULT_SUPPLY: CurveParams = { intercept: 10, slope: 0.8 };
const DEFAULT_DEMAND: CurveParams = { intercept: 90, slope: -0.8 };

const DEFAULT_OVERLAY: OverlayState = {
  priceFloor: false,
  priceFloorValue: 60,
  priceCeiling: false,
  priceCeilingValue: 30,
  tax: false,
  taxAmount: 10,
  subsidy: false,
  subsidyAmount: 10,
};

const PRESETS: Preset[] = [
  {
    name: "Default Market",
    supply: { ...DEFAULT_SUPPLY },
    demand: { ...DEFAULT_DEMAND },
    overlay: {},
  },
  {
    name: "Oil Shock",
    supply: { intercept: 35, slope: 0.9 },
    demand: { intercept: 85, slope: -0.6 },
    overlay: {},
  },
  {
    name: "Minimum Wage",
    supply: { intercept: 5, slope: 1.0 },
    demand: { intercept: 80, slope: -0.7 },
    overlay: { priceFloor: true, priceFloorValue: 55 },
  },
  {
    name: "Carbon Tax",
    supply: { intercept: 15, slope: 0.7 },
    demand: { intercept: 85, slope: -0.65 },
    overlay: { tax: true, taxAmount: 20 },
  },
  {
    name: "Rent Control",
    supply: { intercept: 10, slope: 0.9 },
    demand: { intercept: 95, slope: -0.75 },
    overlay: { priceCeiling: true, priceCeilingValue: 35 },
  },
  {
    name: "Farm Subsidy",
    supply: { intercept: 20, slope: 0.8 },
    demand: { intercept: 70, slope: -0.6 },
    overlay: { subsidy: true, subsidyAmount: 15 },
  },
];

/* ══════════════════════════════════════════════════════════
   Pure Math
   ══════════════════════════════════════════════════════════ */

function supplyPrice(q: number, params: CurveParams): number {
  return params.intercept + params.slope * q;
}

function demandPrice(q: number, params: CurveParams): number {
  return params.intercept + params.slope * q;
}

function findEquilibrium(supply: CurveParams, demand: CurveParams): Equilibrium {
  const q = (demand.intercept - supply.intercept) / (supply.slope - demand.slope);
  const p = supplyPrice(q, supply);
  return { price: Math.max(0, p), quantity: Math.max(0, q) };
}

function computeSurplus(
  supply: CurveParams,
  demand: CurveParams,
  eq: Equilibrium,
  overlay: OverlayState,
): SurplusAreas {
  const { price, quantity } = eq;

  if (quantity <= 0 || price <= 0) {
    return { consumerSurplus: 0, producerSurplus: 0, deadweightLoss: 0 };
  }

  const freeCs = 0.5 * (demand.intercept - price) * quantity;
  const freePs = 0.5 * (price - supply.intercept) * quantity;

  if (!overlay.priceFloor && !overlay.priceCeiling && !overlay.tax && !overlay.subsidy) {
    return {
      consumerSurplus: Math.max(0, freeCs),
      producerSurplus: Math.max(0, freePs),
      deadweightLoss: 0,
    };
  }

  let effectiveQuantity = quantity;

  if (overlay.priceFloor && overlay.priceFloorValue > price) {
    const qDemand = (overlay.priceFloorValue - demand.intercept) / demand.slope;
    effectiveQuantity = Math.max(0, qDemand);
  }

  if (overlay.priceCeiling && overlay.priceCeilingValue < price) {
    const qSupply = (overlay.priceCeilingValue - supply.intercept) / supply.slope;
    effectiveQuantity = Math.max(0, qSupply);
  }

  if (overlay.tax && overlay.taxAmount > 0) {
    const taxedSupply = { ...supply, intercept: supply.intercept + overlay.taxAmount };
    const taxEq = findEquilibrium(taxedSupply, demand);
    effectiveQuantity = Math.max(0, taxEq.quantity);
  }

  if (overlay.subsidy && overlay.subsidyAmount > 0) {
    const subsidizedSupply = { ...supply, intercept: supply.intercept - overlay.subsidyAmount };
    const subEq = findEquilibrium(subsidizedSupply, demand);
    effectiveQuantity = Math.max(0, subEq.quantity);
  }

  const actualCs =
    0.5 * (demandPrice(0, demand) - demandPrice(effectiveQuantity, demand)) * effectiveQuantity;
  const actualPs =
    0.5 * (supplyPrice(effectiveQuantity, supply) - supply.intercept) * effectiveQuantity;
  const totalFree = freeCs + freePs;
  const totalActual = actualCs + actualPs;
  const dwl = Math.max(0, totalFree - totalActual);

  return {
    consumerSurplus: Math.max(0, actualCs),
    producerSurplus: Math.max(0, actualPs),
    deadweightLoss: dwl,
  };
}

function lerpCurve(a: CurveParams, b: CurveParams, t: number): CurveParams {
  return {
    intercept: a.intercept + (b.intercept - a.intercept) * t,
    slope: a.slope + (b.slope - a.slope) * t,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/* ══════════════════════════════════════════════════════════
   Control Point Helpers
   ══════════════════════════════════════════════════════════ */

interface ControlPoint {
  id: DragTarget;
  q: number;
  p: number;
  curve: "supply" | "demand";
}

function getControlPoints(supply: CurveParams, demand: CurveParams): ControlPoint[] {
  return [
    { id: "supply-intercept", q: 10, p: supplyPrice(10, supply), curve: "supply" },
    { id: "supply-slope", q: 70, p: supplyPrice(70, supply), curve: "supply" },
    { id: "demand-intercept", q: 10, p: demandPrice(10, demand), curve: "demand" },
    { id: "demand-slope", q: 70, p: demandPrice(70, demand), curve: "demand" },
  ];
}

function getComputedTextColor(): string {
  if (typeof document === "undefined") return "#a1a1aa";
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--color-text-muted")
      .trim() || "#a1a1aa"
  );
}

/* ══════════════════════════════════════════════════════════
   Canvas Drawing
   ══════════════════════════════════════════════════════════ */

function drawChart(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  supply: CurveParams,
  demand: CurveParams,
  overlay: OverlayState,
  dpr: number,
  dragTarget: DragTarget,
): void {
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const chartW = w - CANVAS_PAD.left - CANVAS_PAD.right;
  const chartH = h - CANVAS_PAD.top - CANVAS_PAD.bottom;

  const xScale = (q: number) => CANVAS_PAD.left + (q / MAX_QUANTITY) * chartW;
  const yScale = (p: number) => CANVAS_PAD.top + chartH - (p / MAX_PRICE) * chartH;

  // Grid
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 0.5;
  for (let v = 0; v <= MAX_PRICE; v += 10) {
    ctx.beginPath();
    ctx.moveTo(CANVAS_PAD.left, yScale(v));
    ctx.lineTo(CANVAS_PAD.left + chartW, yScale(v));
    ctx.stroke();
  }
  for (let v = 0; v <= MAX_QUANTITY; v += 10) {
    ctx.beginPath();
    ctx.moveTo(xScale(v), CANVAS_PAD.top);
    ctx.lineTo(xScale(v), CANVAS_PAD.top + chartH);
    ctx.stroke();
  }

  const eq = findEquilibrium(supply, demand);
  const surplus = computeSurplus(supply, demand, eq, overlay);

  // Surplus shading
  if (eq.quantity > 0 && eq.price > 0) {
    let effectiveQ = eq.quantity;
    let buyerPrice = eq.price;
    let sellerPrice = eq.price;

    if (overlay.priceFloor && overlay.priceFloorValue > eq.price) {
      const qd = (overlay.priceFloorValue - demand.intercept) / demand.slope;
      effectiveQ = Math.max(0, qd);
      buyerPrice = overlay.priceFloorValue;
      sellerPrice = overlay.priceFloorValue;
    }
    if (overlay.priceCeiling && overlay.priceCeilingValue < eq.price) {
      const qs = (overlay.priceCeilingValue - supply.intercept) / supply.slope;
      effectiveQ = Math.max(0, qs);
      buyerPrice = overlay.priceCeilingValue;
      sellerPrice = overlay.priceCeilingValue;
    }

    // Consumer surplus
    ctx.beginPath();
    ctx.moveTo(xScale(0), yScale(demand.intercept));
    ctx.lineTo(xScale(effectiveQ), yScale(demandPrice(effectiveQ, demand)));
    ctx.lineTo(xScale(effectiveQ), yScale(buyerPrice));
    ctx.lineTo(xScale(0), yScale(buyerPrice));
    ctx.closePath();
    ctx.fillStyle = COLORS.consumerSurplus;
    ctx.fill();

    // Producer surplus
    ctx.beginPath();
    ctx.moveTo(xScale(0), yScale(supply.intercept));
    ctx.lineTo(xScale(effectiveQ), yScale(supplyPrice(effectiveQ, supply)));
    ctx.lineTo(xScale(effectiveQ), yScale(sellerPrice));
    ctx.lineTo(xScale(0), yScale(sellerPrice));
    ctx.closePath();
    ctx.fillStyle = COLORS.producerSurplus;
    ctx.fill();

    // DWL triangle
    if (surplus.deadweightLoss > 0 && effectiveQ < eq.quantity) {
      ctx.beginPath();
      ctx.moveTo(xScale(effectiveQ), yScale(demandPrice(effectiveQ, demand)));
      ctx.lineTo(xScale(eq.quantity), yScale(eq.price));
      ctx.lineTo(xScale(effectiveQ), yScale(supplyPrice(effectiveQ, supply)));
      ctx.closePath();
      ctx.fillStyle = COLORS.deadweightLoss;
      ctx.fill();
    }
  }

  // Supply curve
  ctx.beginPath();
  ctx.strokeStyle = COLORS.supply;
  ctx.lineWidth = 2.5;
  const supplyStart = Math.max(0, -supply.intercept / supply.slope);
  for (let q = supplyStart; q <= MAX_QUANTITY; q += 0.5) {
    const p = supplyPrice(q, supply);
    if (p < 0 || p > MAX_PRICE) continue;
    q === supplyStart ? ctx.moveTo(xScale(q), yScale(p)) : ctx.lineTo(xScale(q), yScale(p));
  }
  ctx.stroke();

  // Demand curve
  ctx.beginPath();
  ctx.strokeStyle = COLORS.demand;
  ctx.lineWidth = 2.5;
  for (let q = 0; q <= MAX_QUANTITY; q += 0.5) {
    const p = demandPrice(q, demand);
    if (p < 0 || p > MAX_PRICE) continue;
    q === 0 ? ctx.moveTo(xScale(q), yScale(p)) : ctx.lineTo(xScale(q), yScale(p));
  }
  ctx.stroke();

  // Tax-shifted supply
  if (overlay.tax && overlay.taxAmount > 0) {
    const taxedSupply = { ...supply, intercept: supply.intercept + overlay.taxAmount };
    drawShiftedCurve(ctx, taxedSupply, xScale, yScale, COLORS.tax, "S + Tax");
    const taxEq = findEquilibrium(taxedSupply, demand);
    if (taxEq.quantity > 0) {
      ctx.beginPath();
      ctx.arc(xScale(taxEq.quantity), yScale(taxEq.price), 5, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.tax;
      ctx.fill();
    }
  }

  // Subsidy-shifted supply
  if (overlay.subsidy && overlay.subsidyAmount > 0) {
    const subsidizedSupply = { ...supply, intercept: supply.intercept - overlay.subsidyAmount };
    drawShiftedCurve(ctx, subsidizedSupply, xScale, yScale, COLORS.subsidy, "S - Sub");
    const subEq = findEquilibrium(subsidizedSupply, demand);
    if (subEq.quantity > 0) {
      ctx.beginPath();
      ctx.arc(xScale(subEq.quantity), yScale(subEq.price), 5, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.subsidy;
      ctx.fill();
    }
  }

  // Price floor
  if (overlay.priceFloor) {
    drawHorizontalLine(ctx, overlay.priceFloorValue, CANVAS_PAD.left, chartW, yScale, COLORS.priceFloor, `Floor: $${overlay.priceFloorValue.toFixed(0)}`);
  }

  // Price ceiling
  if (overlay.priceCeiling) {
    drawHorizontalLine(ctx, overlay.priceCeilingValue, CANVAS_PAD.left, chartW, yScale, COLORS.priceCeiling, `Ceiling: $${overlay.priceCeilingValue.toFixed(0)}`);
  }

  // Equilibrium point
  if (eq.quantity > 0 && eq.price > 0) {
    ctx.beginPath();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = COLORS.equilibrium;
    ctx.lineWidth = 1;
    ctx.moveTo(xScale(eq.quantity), yScale(eq.price));
    ctx.lineTo(xScale(eq.quantity), yScale(0));
    ctx.moveTo(xScale(eq.quantity), yScale(eq.price));
    ctx.lineTo(xScale(0), yScale(eq.price));
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(xScale(eq.quantity), yScale(eq.price), 6, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.equilibrium;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Control points
  const controlPoints = getControlPoints(supply, demand);
  for (const cp of controlPoints) {
    const isActive = cp.id === dragTarget;
    ctx.beginPath();
    ctx.arc(xScale(cp.q), yScale(cp.p), isActive ? 8 : 6, 0, Math.PI * 2);
    ctx.fillStyle = isActive ? "#fff" : COLORS.controlPoint;
    ctx.fill();
    ctx.strokeStyle = cp.curve === "supply" ? COLORS.supply : COLORS.demand;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Axes
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(CANVAS_PAD.left, CANVAS_PAD.top);
  ctx.lineTo(CANVAS_PAD.left, CANVAS_PAD.top + chartH);
  ctx.lineTo(CANVAS_PAD.left + chartW, CANVAS_PAD.top + chartH);
  ctx.stroke();

  // Axis labels
  const textColor = getComputedTextColor();
  ctx.fillStyle = textColor;
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let v = 0; v <= MAX_PRICE; v += 20) {
    ctx.fillText(`$${v}`, CANVAS_PAD.left - 8, yScale(v));
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let v = 0; v <= MAX_QUANTITY; v += 20) {
    ctx.fillText(`${v}`, xScale(v), CANVAS_PAD.top + chartH + 8);
  }

  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.fillText("Quantity", CANVAS_PAD.left + chartW / 2, CANVAS_PAD.top + chartH + 28);
  ctx.save();
  ctx.translate(16, CANVAS_PAD.top + chartH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText("Price", 0, 0);
  ctx.restore();

  // Curve labels
  ctx.font = "bold 11px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.supply;
  ctx.fillText("S", xScale(MAX_QUANTITY * 0.85), yScale(supplyPrice(MAX_QUANTITY * 0.85, supply)) - 14);
  ctx.fillStyle = COLORS.demand;
  const dq = MAX_QUANTITY * 0.1;
  ctx.fillText("D", xScale(dq), yScale(demandPrice(dq, demand)) - 14);

  ctx.restore();
}

function drawShiftedCurve(
  ctx: CanvasRenderingContext2D,
  params: CurveParams,
  xScale: (q: number) => number,
  yScale: (p: number) => number,
  color: string,
  label: string,
): void {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  const start = Math.max(0, -params.intercept / params.slope);
  let first = true;
  for (let q = start; q <= MAX_QUANTITY; q += 0.5) {
    const p = supplyPrice(q, params);
    if (p < 0 || p > MAX_PRICE) continue;
    if (first) {
      ctx.moveTo(xScale(q), yScale(p));
      first = false;
    } else {
      ctx.lineTo(xScale(q), yScale(p));
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = "10px Inter, system-ui, sans-serif";
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  const lq = MAX_QUANTITY * 0.75;
  const lp = supplyPrice(lq, params);
  if (lp > 0 && lp < MAX_PRICE) {
    ctx.fillText(label, xScale(lq) + 4, yScale(lp) - 8);
  }
}

function drawHorizontalLine(
  ctx: CanvasRenderingContext2D,
  price: number,
  left: number,
  chartW: number,
  yScale: (p: number) => number,
  color: string,
  label: string,
): void {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8, 4]);
  const y = yScale(price);
  ctx.moveTo(left, y);
  ctx.lineTo(left + chartW, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.font = "10px Inter, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(label, left + chartW - 4, y - 6);
}

/* ══════════════════════════════════════════════════════════
   Sub-Components
   ══════════════════════════════════════════════════════════ */

function ToggleButton({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color: string;
  onClick: () => void;
}): preact.JSX.Element {
  return (
    <button
      onClick={onClick}
      class={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "text-white"
          : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-heading)]"
      }`}
      style={active ? { borderColor: color, background: color } : undefined}
    >
      {label}
    </button>
  );
}

function ValueSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  color,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  color: string;
}): preact.JSX.Element {
  return (
    <label class="block">
      <span class="flex justify-between text-[11px] text-[var(--color-text-muted)]">
        <span>{label}</span>
        <span class="font-mono" style={{ color }}>
          ${value.toFixed(0)}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(e) => onChange(parseFloat((e.target as HTMLInputElement).value))}
        class="mt-1 w-full"
        style={{ accentColor: color }}
      />
    </label>
  );
}

/* ══════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════ */

export default function SupplyDemand(): preact.JSX.Element {
  const [supply, setSupply] = useState<CurveParams>({ ...DEFAULT_SUPPLY });
  const [demand, setDemand] = useState<CurveParams>({ ...DEFAULT_DEMAND });
  const [overlay, setOverlay] = useState<OverlayState>({ ...DEFAULT_OVERLAY });
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  const [selectedPreset, setSelectedPreset] = useState("Default Market");

  // Animation state
  const [animSupply, setAnimSupply] = useState<CurveParams>({ ...DEFAULT_SUPPLY });
  const [animDemand, setAnimDemand] = useState<CurveParams>({ ...DEFAULT_DEMAND });
  const animStartRef = useRef<number | null>(null);
  const animFromSupplyRef = useRef<CurveParams>({ ...DEFAULT_SUPPLY });
  const animFromDemandRef = useRef<CurveParams>({ ...DEFAULT_DEMAND });
  const animToSupplyRef = useRef<CurveParams>({ ...DEFAULT_SUPPLY });
  const animToDemandRef = useRef<CurveParams>({ ...DEFAULT_DEMAND });
  const animFrameRef = useRef(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(600);
  const canvasHeight = Math.round(canvasWidth * 0.65);

  const displaySupply = animStartRef.current !== null ? animSupply : supply;
  const displayDemand = animStartRef.current !== null ? animDemand : demand;

  const eq = findEquilibrium(displaySupply, displayDemand);
  const surplus = computeSurplus(displaySupply, displayDemand, eq, overlay);

  // Animation loop for curve transitions
  const runAnimation = useCallback(() => {
    const start = animStartRef.current;
    if (start === null) return;

    const now = performance.now();
    const elapsed = now - start;
    const t = Math.min(1, elapsed / ANIM_DURATION);
    const eased = 1 - Math.pow(1 - t, 3);

    setAnimSupply(lerpCurve(animFromSupplyRef.current, animToSupplyRef.current, eased));
    setAnimDemand(lerpCurve(animFromDemandRef.current, animToDemandRef.current, eased));

    if (t < 1) {
      animFrameRef.current = requestAnimationFrame(runAnimation);
    } else {
      animStartRef.current = null;
      setSupply({ ...animToSupplyRef.current });
      setDemand({ ...animToDemandRef.current });
    }
  }, []);

  const animateTo = useCallback(
    (newSupply: CurveParams, newDemand: CurveParams) => {
      cancelAnimationFrame(animFrameRef.current);
      animFromSupplyRef.current = { ...displaySupply };
      animFromDemandRef.current = { ...displayDemand };
      animToSupplyRef.current = newSupply;
      animToDemandRef.current = newDemand;
      animStartRef.current = performance.now();
      animFrameRef.current = requestAnimationFrame(runAnimation);
    },
    [displaySupply, displayDemand, runAnimation],
  );

  // Responsive canvas
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 100) setCanvasWidth(Math.floor(w));
    });
    obs.observe(container);
    return () => obs.disconnect();
  }, []);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawChart(ctx, canvasWidth, canvasHeight, displaySupply, displayDemand, overlay, dpr, dragTarget);
  }, [displaySupply, displayDemand, overlay, canvasWidth, canvasHeight, dragTarget]);

  // Mouse drag handling
  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (canvasWidth / rect.width);
      const my = (e.clientY - rect.top) * (canvasHeight / rect.height);
      const chartW = canvasWidth - CANVAS_PAD.left - CANVAS_PAD.right;
      const chartH = canvasHeight - CANVAS_PAD.top - CANVAS_PAD.bottom;

      const controlPoints = getControlPoints(displaySupply, displayDemand);
      for (const cp of controlPoints) {
        const cx = CANVAS_PAD.left + (cp.q / MAX_QUANTITY) * chartW;
        const cy = CANVAS_PAD.top + chartH - (cp.p / MAX_PRICE) * chartH;
        if (Math.sqrt((mx - cx) ** 2 + (my - cy) ** 2) < 15) {
          setDragTarget(cp.id);
          canvas.setPointerCapture(e.pointerId);
          return;
        }
      }
    },
    [displaySupply, displayDemand, canvasWidth, canvasHeight],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragTarget) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (canvasWidth / rect.width);
      const my = (e.clientY - rect.top) * (canvasHeight / rect.height);
      const chartW = canvasWidth - CANVAS_PAD.left - CANVAS_PAD.right;
      const chartH = canvasHeight - CANVAS_PAD.top - CANVAS_PAD.bottom;

      const p = (1 - (my - CANVAS_PAD.top) / chartH) * MAX_PRICE;

      if (dragTarget === "supply-intercept") {
        setSupply((prev) => ({ ...prev, intercept: clamp(p - prev.slope * 10, 0, 80) }));
      } else if (dragTarget === "supply-slope") {
        setSupply((prev) => ({ ...prev, slope: clamp((p - prev.intercept) / 70, 0.1, 3) }));
      } else if (dragTarget === "demand-intercept") {
        setDemand((prev) => ({ ...prev, intercept: clamp(p - prev.slope * 10, 20, 100) }));
      } else if (dragTarget === "demand-slope") {
        setDemand((prev) => ({ ...prev, slope: clamp((p - prev.intercept) / 70, -3, -0.1) }));
      }
    },
    [dragTarget, canvasWidth, canvasHeight],
  );

  const handlePointerUp = useCallback(() => {
    setDragTarget(null);
  }, []);

  const updateOverlay = useCallback(<K extends keyof OverlayState>(key: K, value: OverlayState[K]) => {
    setOverlay((prev) => ({ ...prev, [key]: value }));
  }, []);

  const applyPreset = useCallback(
    (preset: Preset) => {
      setSelectedPreset(preset.name);
      animateTo(preset.supply, preset.demand);
      const newOverlay: OverlayState = { ...DEFAULT_OVERLAY, ...preset.overlay };
      setOverlay(newOverlay);
    },
    [animateTo],
  );

  const resetCurves = useCallback(() => {
    animateTo({ ...DEFAULT_SUPPLY }, { ...DEFAULT_DEMAND });
    setOverlay({ ...DEFAULT_OVERLAY });
    setSelectedPreset("Default Market");
  }, [animateTo]);

  return (
    <div class="space-y-6">
      {/* Preset Selector */}
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[11px] font-medium text-[var(--color-text-muted)]">Scenarios:</span>
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            onClick={() => applyPreset(preset)}
            class={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              selectedPreset === preset.name
                ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-heading)]"
            }`}
          >
            {preset.name}
          </button>
        ))}
      </div>

      {/* Canvas */}
      <div ref={containerRef} class="overflow-hidden rounded-xl border border-[var(--color-border)]">
        <canvas
          ref={canvasRef}
          class="w-full cursor-grab active:cursor-grabbing"
          style={{ background: "var(--color-surface)", aspectRatio: "20/13", touchAction: "none" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
      </div>

      {/* Controls */}
      <div class="grid gap-4 lg:grid-cols-[1fr_1fr]">
        {/* Overlays */}
        <div class="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
          <h3 class="text-xs font-bold text-[var(--color-heading)]">Overlays</h3>
          <div class="flex flex-wrap gap-2">
            <ToggleButton
              label="Price Floor"
              active={overlay.priceFloor}
              color={COLORS.priceFloor}
              onClick={() => updateOverlay("priceFloor", !overlay.priceFloor)}
            />
            <ToggleButton
              label="Price Ceiling"
              active={overlay.priceCeiling}
              color={COLORS.priceCeiling}
              onClick={() => updateOverlay("priceCeiling", !overlay.priceCeiling)}
            />
            <ToggleButton
              label="Tax Wedge"
              active={overlay.tax}
              color={COLORS.tax}
              onClick={() => updateOverlay("tax", !overlay.tax)}
            />
            <ToggleButton
              label="Subsidy"
              active={overlay.subsidy}
              color={COLORS.subsidy}
              onClick={() => updateOverlay("subsidy", !overlay.subsidy)}
            />
            <button
              onClick={resetCurves}
              class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-heading)]"
            >
              Reset
            </button>
          </div>
          {overlay.priceFloor && (
            <ValueSlider
              label="Price Floor"
              value={overlay.priceFloorValue}
              min={0}
              max={MAX_PRICE}
              step={1}
              onChange={(v) => updateOverlay("priceFloorValue", v)}
              color={COLORS.priceFloor}
            />
          )}
          {overlay.priceCeiling && (
            <ValueSlider
              label="Price Ceiling"
              value={overlay.priceCeilingValue}
              min={0}
              max={MAX_PRICE}
              step={1}
              onChange={(v) => updateOverlay("priceCeilingValue", v)}
              color={COLORS.priceCeiling}
            />
          )}
          {overlay.tax && (
            <ValueSlider
              label="Tax Amount"
              value={overlay.taxAmount}
              min={0}
              max={40}
              step={1}
              onChange={(v) => updateOverlay("taxAmount", v)}
              color={COLORS.tax}
            />
          )}
          {overlay.subsidy && (
            <ValueSlider
              label="Subsidy Amount"
              value={overlay.subsidyAmount}
              min={0}
              max={40}
              step={1}
              onChange={(v) => updateOverlay("subsidyAmount", v)}
              color={COLORS.subsidy}
            />
          )}
        </div>

        {/* Equilibrium + Surplus Stats */}
        <div class="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
          <h3 class="text-xs font-bold text-[var(--color-heading)]">Equilibrium</h3>
          <div class="grid grid-cols-2 gap-2">
            <div class="rounded border border-[var(--color-border)] p-2 text-center">
              <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                Price
              </div>
              <div class="text-lg font-bold" style={{ color: COLORS.equilibrium }}>
                ${eq.price.toFixed(1)}
              </div>
            </div>
            <div class="rounded border border-[var(--color-border)] p-2 text-center">
              <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                Quantity
              </div>
              <div class="text-lg font-bold" style={{ color: COLORS.equilibrium }}>
                {eq.quantity.toFixed(1)}
              </div>
            </div>
          </div>
          <h3 class="text-xs font-bold text-[var(--color-heading)]">Surplus</h3>
          <div class="grid grid-cols-3 gap-2">
            <div class="rounded border border-[var(--color-border)] p-2 text-center">
              <div class="text-[9px] uppercase tracking-wider text-[var(--color-text-muted)]">
                Consumer
              </div>
              <div class="text-sm font-bold" style={{ color: COLORS.demand }}>
                {surplus.consumerSurplus.toFixed(0)}
              </div>
            </div>
            <div class="rounded border border-[var(--color-border)] p-2 text-center">
              <div class="text-[9px] uppercase tracking-wider text-[var(--color-text-muted)]">
                Producer
              </div>
              <div class="text-sm font-bold" style={{ color: COLORS.supply }}>
                {surplus.producerSurplus.toFixed(0)}
              </div>
            </div>
            <div class="rounded border border-[var(--color-border)] p-2 text-center">
              <div class="text-[9px] uppercase tracking-wider text-[var(--color-text-muted)]">
                DWL
              </div>
              <div class="text-sm font-bold text-[var(--color-text-muted)]">
                {surplus.deadweightLoss.toFixed(0)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <p class="text-[11px] text-[var(--color-text-muted)]">
        Drag the yellow control points on each curve to shift or rotate supply and demand.
        Toggle overlays to see how price floors, ceilings, taxes, and subsidies affect equilibrium
        and welfare. Try preset scenarios for common economic situations.
      </p>
    </div>
  );
}
