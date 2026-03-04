import type { FunctionalComponent } from "preact";
import type { RefObject } from "preact";
import { useState, useLayoutEffect, useCallback } from "preact/hooks";

interface ArrowOverlayProps {
  containerRef: RefObject<HTMLDivElement>;
  stepIndex: number;
}

interface Arrow {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function computeArrows(container: HTMLDivElement): Arrow[] {
  const containerRect = container.getBoundingClientRect();
  const sources = container.querySelectorAll<HTMLElement>("[data-ref-id]");
  const arrows: Arrow[] = [];

  sources.forEach((source) => {
    const refId = source.getAttribute("data-ref-id");
    if (!refId) return;

    const target = container.querySelector<HTMLElement>(
      `[data-heap-id="${refId}"]`
    );
    if (!target) return;

    const sourceRect = source.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    const x1 = sourceRect.left + sourceRect.width / 2 - containerRect.left;
    const y1 = sourceRect.top + sourceRect.height / 2 - containerRect.top;
    const x2 = targetRect.left - containerRect.left;
    const y2 = targetRect.top + 12 - containerRect.top;

    arrows.push({
      id: `${refId}-${Math.round(x1)}-${Math.round(y1)}`,
      x1,
      y1,
      x2,
      y2,
    });
  });

  return arrows;
}

const ArrowOverlay: FunctionalComponent<ArrowOverlayProps> = ({
  containerRef,
  stepIndex,
}) => {
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const recalculate = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    setDimensions({
      width: container.offsetWidth,
      height: container.offsetHeight,
    });
    setArrows(computeArrows(container));
  }, [containerRef]);

  useLayoutEffect(() => {
    // Small delay to allow DOM to settle after step change
    const frame = requestAnimationFrame(() => {
      recalculate();
    });
    return () => cancelAnimationFrame(frame);
  }, [stepIndex, recalculate]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      recalculate();
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [containerRef, recalculate]);

  if (arrows.length === 0 || dimensions.width === 0) return null;

  return (
    <svg
      class="pointer-events-none absolute inset-0 hidden md:block"
      width={dimensions.width}
      height={dimensions.height}
      style={{ zIndex: 10 }}
    >
      <defs>
        <marker
          id="arrowhead"
          markerWidth="8"
          markerHeight="6"
          refX="8"
          refY="3"
          orient="auto"
        >
          <polygon
            points="0 0, 8 3, 0 6"
            fill="var(--color-primary)"
            opacity="0.6"
          />
        </marker>
      </defs>
      {arrows.map((arrow) => {
        const midX = (arrow.x1 + arrow.x2) / 2;
        const cpX = midX + 20;
        const cpY = Math.min(arrow.y1, arrow.y2) - 10;

        return (
          <path
            key={arrow.id}
            d={`M ${arrow.x1} ${arrow.y1} Q ${cpX} ${cpY} ${arrow.x2} ${arrow.y2}`}
            fill="none"
            stroke="var(--color-primary)"
            stroke-width="1.5"
            opacity="0.5"
            marker-end="url(#arrowhead)"
          />
        );
      })}
    </svg>
  );
};

export default ArrowOverlay;
