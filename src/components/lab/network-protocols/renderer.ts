/* ══════════════════════════════════════════════════════════
   Sequence Diagram Canvas Renderer
   Pure functions — no Preact, no browser globals at module level.
   All canvas operations are behind ctx parameter guards.
   ══════════════════════════════════════════════════════════ */

import type { Endpoint, Arrow, ProtocolStep } from "./protocols";

/* ── Layout Constants ──────────────────────────────────── */

const HEADER_HEIGHT = 60;
const ENDPOINT_RADIUS = 28;
const STEP_HEIGHT = 80;
const ARROW_HEAD_SIZE = 10;
const SIDE_PADDING = 40;
const LIFELINE_TOP = HEADER_HEIGHT + ENDPOINT_RADIUS + 16;

/* ── Color Helpers ─────────────────────────────────────── */

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ── Exported: Compute Canvas Height ───────────────────── */

export function computeCanvasHeight(stepCount: number): number {
  return LIFELINE_TOP + stepCount * STEP_HEIGHT + 40;
}

/* ── Exported: Get endpoint X in pixels ────────────────── */

export function endpointPixelX(
  endpoint: Endpoint,
  canvasWidth: number,
): number {
  const usable = canvasWidth - SIDE_PADDING * 2;
  return SIDE_PADDING + endpoint.x * usable;
}

/* ── Internal: Draw rounded rect ──────────────────────── */

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/* ── Internal: Draw arrowhead ──────────────────────────── */

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  toX: number,
  toY: number,
  fromX: number,
  color: string,
): void {
  const angle = Math.atan2(0, toX - fromX);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - ARROW_HEAD_SIZE * Math.cos(angle - Math.PI / 6),
    toY - ARROW_HEAD_SIZE * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    toX - ARROW_HEAD_SIZE * Math.cos(angle + Math.PI / 6),
    toY - ARROW_HEAD_SIZE * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
}

/* ── Internal: Draw "X" mark for lost packet ──────────── */

function drawLostMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
): void {
  const size = 8;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x - size, y - size);
  ctx.lineTo(x + size, y + size);
  ctx.moveTo(x + size, y - size);
  ctx.lineTo(x - size, y + size);
  ctx.stroke();
}

/* ── Exported: Render full diagram ─────────────────────── */

export interface RenderOptions {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  dpr: number;
  endpoints: Endpoint[];
  steps: ProtocolStep[];
  currentStep: number;
  animationProgress: number; // 0..1 for current step arrow animation
  hoveredArrow: HoveredArrow | null;
  isDark: boolean;
}

export interface HoveredArrow {
  stepIndex: number;
  arrowIndex: number;
}

export interface ArrowHitbox {
  stepIndex: number;
  arrowIndex: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  midX: number;
  midY: number;
}

export function render(opts: RenderOptions): ArrowHitbox[] {
  const { ctx, width, height, dpr, endpoints, steps, currentStep, animationProgress, hoveredArrow, isDark } = opts;
  const hitboxes: ArrowHitbox[] = [];

  ctx.save();
  ctx.scale(dpr, dpr);

  // Clear
  ctx.clearRect(0, 0, width, height);

  const textColor = isDark ? "#e4e4e7" : "#18181b";
  const mutedColor = isDark ? "#71717a" : "#a1a1aa";
  const surfaceColor = isDark ? "#111111" : "#f4f4f5";
  const borderColor = isDark ? "#27272a" : "#d4d4d8";

  // Draw endpoint headers
  for (const ep of endpoints) {
    const px = endpointPixelX(ep, width);
    const cy = HEADER_HEIGHT;

    // Circle
    ctx.fillStyle = surfaceColor;
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, cy, ENDPOINT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Label (handle newlines)
    ctx.fillStyle = textColor;
    ctx.font = "bold 11px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lines = ep.label.split("\n");
    const lineHeight = 13;
    const startY = cy - ((lines.length - 1) * lineHeight) / 2;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], px, startY + i * lineHeight);
    }
  }

  // Draw lifelines
  const lifelineBottom = LIFELINE_TOP + steps.length * STEP_HEIGHT;
  for (const ep of endpoints) {
    const px = endpointPixelX(ep, width);
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(px, LIFELINE_TOP);
    ctx.lineTo(px, lifelineBottom);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw steps
  const endpointMap = new Map(endpoints.map((ep) => [ep.id, ep]));

  for (let si = 0; si < steps.length; si++) {
    const step = steps[si];
    const stepY = LIFELINE_TOP + si * STEP_HEIGHT + STEP_HEIGHT / 2;
    const isCurrentStep = si === currentStep;
    const isPastStep = si < currentStep;
    const isFutureStep = si > currentStep;

    // Step number on the left
    ctx.font = "10px Inter, system-ui, sans-serif";
    ctx.fillStyle = isCurrentStep ? textColor : mutedColor;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(`${si + 1}`, SIDE_PADDING - 10, stepY);

    // Determine opacity
    let alpha = 1;
    if (isFutureStep) alpha = 0.15;
    else if (isPastStep) alpha = 0.5;

    // Draw each arrow in the step
    for (let ai = 0; ai < step.arrows.length; ai++) {
      const arrow = step.arrows[ai];
      const fromEp = endpointMap.get(arrow.from);
      const toEp = endpointMap.get(arrow.to);
      if (!fromEp || !toEp) continue;

      const fromX = endpointPixelX(fromEp, width);
      const toX = endpointPixelX(toEp, width);
      const arrowYOffset = ai * 16; // offset multiple arrows vertically
      const arrowY = stepY + arrowYOffset;

      // Animation: for current step, animate progress
      let drawToX = toX;
      if (isCurrentStep) {
        drawToX = fromX + (toX - fromX) * Math.min(animationProgress, 1);
      }

      const isHovered =
        hoveredArrow?.stepIndex === si && hoveredArrow.arrowIndex === ai;

      // Arrow line
      ctx.strokeStyle = hexToRgba(arrow.color, isHovered ? 1 : alpha);
      ctx.lineWidth = isHovered ? 3 : 2;

      if (arrow.dashed) {
        ctx.setLineDash([6, 4]);
      }

      ctx.beginPath();
      ctx.moveTo(fromX, arrowY);

      if (arrow.lost) {
        // Draw line to midpoint, then X
        const midX = (fromX + toX) / 2;
        if (isCurrentStep) {
          const animMidX = fromX + (midX - fromX) * Math.min(animationProgress * 2, 1);
          ctx.lineTo(animMidX, arrowY);
          ctx.stroke();
          if (animationProgress > 0.5) {
            drawLostMark(ctx, midX, arrowY, hexToRgba(arrow.color, alpha));
          }
        } else {
          ctx.lineTo(midX, arrowY);
          ctx.stroke();
          if (!isFutureStep) {
            drawLostMark(ctx, midX, arrowY, hexToRgba(arrow.color, alpha));
          }
        }
      } else {
        ctx.lineTo(drawToX, arrowY);
        ctx.stroke();

        // Arrowhead
        if (!isCurrentStep || animationProgress >= 0.95) {
          drawArrowHead(ctx, toX, arrowY, fromX, hexToRgba(arrow.color, alpha));
        }
      }

      ctx.setLineDash([]);

      // Label
      const labelX = (fromX + toX) / 2;
      const labelY = arrowY - 10;
      ctx.font = isHovered
        ? "bold 12px Inter, system-ui, sans-serif"
        : "bold 11px Inter, system-ui, sans-serif";
      ctx.fillStyle = hexToRgba(arrow.color, isHovered ? 1 : alpha);
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";

      if (!isFutureStep) {
        ctx.fillText(arrow.label, labelX, labelY);
      }

      // Sublabel
      if (arrow.sublabel && !isFutureStep) {
        ctx.font = "9px Inter, system-ui, sans-serif";
        ctx.fillStyle = hexToRgba(
          isHovered ? arrow.color : mutedColor,
          isHovered ? 0.9 : alpha,
        );
        ctx.fillText(arrow.sublabel, labelX, arrowY + 14);
      }

      // Hitbox (always register for past and current steps)
      if (!isFutureStep) {
        hitboxes.push({
          stepIndex: si,
          arrowIndex: ai,
          x1: Math.min(fromX, toX),
          y1: arrowY - 16,
          x2: Math.max(fromX, toX),
          y2: arrowY + 18,
          midX: labelX,
          midY: arrowY,
        });
      }
    }

    // Current step highlight bar
    if (isCurrentStep) {
      const barY = LIFELINE_TOP + si * STEP_HEIGHT;
      ctx.fillStyle = hexToRgba("#4f8ff7", 0.06);
      roundRect(ctx, SIDE_PADDING - 5, barY, width - SIDE_PADDING * 2 + 10, STEP_HEIGHT, 4);
      ctx.fill();
    }
  }

  ctx.restore();
  return hitboxes;
}

/* ── Hit testing ───────────────────────────────────────── */

export function hitTestArrow(
  hitboxes: ArrowHitbox[],
  x: number,
  y: number,
): ArrowHitbox | null {
  for (const hb of hitboxes) {
    if (x >= hb.x1 - 10 && x <= hb.x2 + 10 && y >= hb.y1 && y <= hb.y2) {
      return hb;
    }
  }
  return null;
}
