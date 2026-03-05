import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import {
  ALL_PROTOCOLS,
  OSI_LAYERS,
  OSI_LAYER_COLORS,
  type ProtocolDefinition,
  type PacketHeader,
} from "./protocols";
import {
  render,
  computeCanvasHeight,
  hitTestArrow,
  type ArrowHitbox,
  type HoveredArrow,
} from "./renderer";

/* ══════════════════════════════════════════════════════════
   Constants
   ══════════════════════════════════════════════════════════ */

const ANIMATION_DURATION_MS = 600;
const AUTO_PLAY_MIN_INTERVAL = 500;
const AUTO_PLAY_MAX_INTERVAL = 3000;
const DEFAULT_SPEED = 0.5; // 0=slow, 1=fast

/* ══════════════════════════════════════════════════════════
   Styles — CSS-in-JS with CSS variables
   ══════════════════════════════════════════════════════════ */

const styles = {
  container: {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "8px",
    overflow: "hidden",
  } as Record<string, string>,
  tabBar: {
    display: "flex",
    overflowX: "auto",
    borderBottom: "1px solid var(--color-border)",
    background: "var(--color-bg)",
    gap: "0",
  } as Record<string, string>,
  tab: (active: boolean) =>
    ({
      padding: "10px 16px",
      fontSize: "13px",
      fontWeight: active ? "700" : "500",
      color: active ? "var(--color-primary)" : "var(--color-text-muted)",
      background: active ? "var(--color-surface)" : "transparent",
      border: "none",
      borderBottom: active ? "2px solid var(--color-primary)" : "2px solid transparent",
      cursor: "pointer",
      whiteSpace: "nowrap",
      fontFamily: "var(--font-sans)",
      transition: "color 0.15s, background 0.15s",
    }) as Record<string, string>,
  body: {
    display: "flex",
    flexDirection: "column",
  } as Record<string, string>,
  mainArea: {
    display: "flex",
    flexDirection: "row",
    gap: "0",
  } as Record<string, string>,
  canvasWrapper: {
    flex: "1",
    minWidth: "0",
    position: "relative",
    borderRight: "1px solid var(--color-border)",
  } as Record<string, string>,
  canvas: {
    display: "block",
    width: "100%",
    cursor: "pointer",
  } as Record<string, string>,
  sidebar: {
    width: "200px",
    flexShrink: "0",
    padding: "12px",
    overflowY: "auto",
    background: "var(--color-bg)",
  } as Record<string, string>,
  sidebarTitle: {
    fontSize: "11px",
    fontWeight: "700",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: "var(--color-text-muted)",
    marginBottom: "8px",
  } as Record<string, string>,
  osiRow: (active: boolean, color: string) =>
    ({
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "5px 8px",
      borderRadius: "4px",
      fontSize: "11px",
      fontWeight: active ? "700" : "400",
      color: active ? color : "var(--color-text-muted)",
      background: active
        ? `color-mix(in srgb, ${color} 12%, transparent)`
        : "transparent",
      transition: "all 0.2s",
    }) as Record<string, string>,
  osiDot: (active: boolean, color: string) =>
    ({
      width: "8px",
      height: "8px",
      borderRadius: "50%",
      background: active ? color : "var(--color-border)",
      transition: "background 0.2s",
      flexShrink: "0",
    }) as Record<string, string>,
  controls: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 16px",
    borderTop: "1px solid var(--color-border)",
    background: "var(--color-bg)",
    flexWrap: "wrap",
  } as Record<string, string>,
  controlBtn: (disabled: boolean) =>
    ({
      padding: "6px 14px",
      fontSize: "12px",
      fontWeight: "600",
      borderRadius: "4px",
      border: "1px solid var(--color-border)",
      background: disabled ? "var(--color-bg)" : "var(--color-surface)",
      color: disabled ? "var(--color-text-muted)" : "var(--color-text)",
      cursor: disabled ? "not-allowed" : "pointer",
      fontFamily: "var(--font-sans)",
      transition: "background 0.15s",
      opacity: disabled ? "0.5" : "1",
    }) as Record<string, string>,
  playBtn: (playing: boolean) =>
    ({
      padding: "6px 14px",
      fontSize: "12px",
      fontWeight: "600",
      borderRadius: "4px",
      border: playing ? "1px solid var(--color-primary)" : "1px solid var(--color-border)",
      background: playing ? "var(--color-primary)" : "var(--color-surface)",
      color: playing ? "#fff" : "var(--color-text)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)",
      transition: "all 0.15s",
    }) as Record<string, string>,
  stepIndicator: {
    fontSize: "12px",
    color: "var(--color-text-muted)",
    marginLeft: "auto",
    whiteSpace: "nowrap",
  } as Record<string, string>,
  speedControl: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginLeft: "8px",
  } as Record<string, string>,
  speedLabel: {
    fontSize: "11px",
    color: "var(--color-text-muted)",
    whiteSpace: "nowrap",
  } as Record<string, string>,
  speedSlider: {
    width: "60px",
    accentColor: "var(--color-primary)",
  } as Record<string, string>,
  description: {
    padding: "12px 16px",
    fontSize: "13px",
    lineHeight: "1.5",
    color: "var(--color-text)",
    borderTop: "1px solid var(--color-border)",
    background: "var(--color-bg)",
    minHeight: "48px",
  } as Record<string, string>,
  inspector: {
    padding: "12px 16px",
    borderTop: "1px solid var(--color-border)",
    background: "var(--color-bg)",
  } as Record<string, string>,
  inspectorTitle: {
    fontSize: "12px",
    fontWeight: "700",
    color: "var(--color-heading)",
    marginBottom: "8px",
  } as Record<string, string>,
  inspectorEmpty: {
    fontSize: "12px",
    color: "var(--color-text-muted)",
    fontStyle: "italic",
  } as Record<string, string>,
  headerGroup: {
    marginBottom: "10px",
  } as Record<string, string>,
  headerGroupTitle: (color: string) =>
    ({
      fontSize: "11px",
      fontWeight: "700",
      color,
      marginBottom: "4px",
      textTransform: "uppercase" as const,
      letterSpacing: "0.04em",
    }) as Record<string, string>,
  headerTable: {
    width: "100%",
    fontSize: "11px",
    borderCollapse: "collapse",
  } as Record<string, string>,
  headerRow: {
    borderBottom: "1px solid var(--color-border)",
  } as Record<string, string>,
  headerKey: {
    padding: "3px 8px 3px 0",
    color: "var(--color-text-muted)",
    fontWeight: "600",
    whiteSpace: "nowrap",
    verticalAlign: "top",
  } as Record<string, string>,
  headerValue: {
    padding: "3px 0",
    color: "var(--color-text)",
    fontFamily: "var(--font-mono)",
    wordBreak: "break-all",
  } as Record<string, string>,
  mobileHint: {
    display: "none",
    padding: "8px 16px",
    fontSize: "11px",
    color: "var(--color-text-muted)",
    textAlign: "center",
    borderTop: "1px solid var(--color-border)",
  } as Record<string, string>,
};

/* ══════════════════════════════════════════════════════════
   Component
   ══════════════════════════════════════════════════════════ */

export default function NetworkProtocols() {
  const [activeProtocol, setActiveProtocol] = useState<string>("tcp");
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [animProgress, setAnimProgress] = useState(1);
  const [hoveredArrow, setHoveredArrow] = useState<HoveredArrow | null>(null);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hitboxesRef = useRef<ArrowHitbox[]>([]);
  const animFrameRef = useRef<number>(0);
  const playTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const protocol: ProtocolDefinition =
    ALL_PROTOCOLS.find((p) => p.id === activeProtocol) ?? ALL_PROTOCOLS[0];
  const totalSteps = protocol.steps.length;
  const step = protocol.steps[currentStep];
  const inspectedStep =
    selectedStep !== null ? protocol.steps[selectedStep] : step;
  const inspectedStepIndex = selectedStep ?? currentStep;

  /* ── Detect dark mode ──────────────────────────────────── */

  const isDarkRef = useRef(true);

  const updateDarkMode = useCallback(() => {
    if (typeof document !== "undefined") {
      isDarkRef.current = !document.documentElement.classList.contains("light");
    }
  }, []);

  /* ── Detect mobile ─────────────────────────────────────── */

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 640;
      setIsMobile(mobile);
      if (mobile) setShowSidebar(false);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  /* ── Resize canvas ─────────────────────────────────────── */

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width;
    const h = computeCanvasHeight(totalSteps);

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }, [totalSteps]);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [resizeCanvas]);

  /* ── Animation frame loop ──────────────────────────────── */

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    updateDarkMode();

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    hitboxesRef.current = render({
      ctx,
      width: w,
      height: h,
      dpr,
      endpoints: protocol.endpoints,
      steps: protocol.steps,
      currentStep,
      animationProgress: animProgress,
      hoveredArrow,
      isDark: isDarkRef.current,
    });

    animFrameRef.current = requestAnimationFrame(drawFrame);
  }, [protocol, currentStep, animProgress, hoveredArrow, updateDarkMode]);

  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [drawFrame]);

  /* ── Step animation ────────────────────────────────────── */

  const animateStep = useCallback(() => {
    const startTime = performance.now();
    const duration = ANIMATION_DURATION_MS;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimProgress(eased);

      if (progress < 1) {
        requestAnimationFrame(tick);
      }
    };

    setAnimProgress(0);
    requestAnimationFrame(tick);
  }, []);

  /* ── Step navigation ───────────────────────────────────── */

  const goToStep = useCallback(
    (step: number) => {
      const clamped = Math.max(0, Math.min(step, totalSteps - 1));
      setCurrentStep(clamped);
      setSelectedStep(null);
      animateStep();
    },
    [totalSteps, animateStep],
  );

  const goNext = useCallback(() => {
    if (currentStep < totalSteps - 1) {
      goToStep(currentStep + 1);
    } else {
      setIsPlaying(false);
    }
  }, [currentStep, totalSteps, goToStep]);

  const goPrev = useCallback(() => {
    if (currentStep > 0) goToStep(currentStep - 1);
  }, [currentStep, goToStep]);

  const goFirst = useCallback(() => goToStep(0), [goToStep]);

  /* ── Auto-play ─────────────────────────────────────────── */

  useEffect(() => {
    if (!isPlaying) {
      if (playTimerRef.current) clearTimeout(playTimerRef.current);
      return;
    }

    const interval =
      AUTO_PLAY_MAX_INTERVAL -
      speed * (AUTO_PLAY_MAX_INTERVAL - AUTO_PLAY_MIN_INTERVAL);

    playTimerRef.current = setTimeout(() => {
      goNext();
    }, interval);

    return () => {
      if (playTimerRef.current) clearTimeout(playTimerRef.current);
    };
  }, [isPlaying, currentStep, speed, goNext]);

  /* ── Protocol switch ───────────────────────────────────── */

  const switchProtocol = useCallback((id: string) => {
    setActiveProtocol(id);
    setCurrentStep(0);
    setAnimProgress(1);
    setSelectedStep(null);
    setIsPlaying(false);
    setHoveredArrow(null);
  }, []);

  /* ── Canvas mouse handlers ─────────────────────────────── */

  const getCanvasCoords = useCallback(
    (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    },
    [],
  );

  const handleCanvasMouseMove = useCallback(
    (e: MouseEvent) => {
      const { x, y } = getCanvasCoords(e);
      const hit = hitTestArrow(hitboxesRef.current, x, y);
      if (hit) {
        setHoveredArrow({ stepIndex: hit.stepIndex, arrowIndex: hit.arrowIndex });
        if (canvasRef.current) canvasRef.current.style.cursor = "pointer";
      } else {
        setHoveredArrow(null);
        if (canvasRef.current) canvasRef.current.style.cursor = "default";
      }
    },
    [getCanvasCoords],
  );

  const handleCanvasClick = useCallback(
    (e: MouseEvent) => {
      const { x, y } = getCanvasCoords(e);
      const hit = hitTestArrow(hitboxesRef.current, x, y);
      if (hit) {
        setSelectedStep(hit.stepIndex);
      }
    },
    [getCanvasCoords],
  );

  const handleCanvasLeave = useCallback(() => {
    setHoveredArrow(null);
  }, []);

  /* ── Keyboard navigation ───────────────────────────────── */

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goNext, goPrev]);

  /* ── Theme observer ────────────────────────────────────── */

  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => {
      updateDarkMode();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [updateDarkMode]);

  /* ══════════════════════════════════════════════════════════
     Render
     ══════════════════════════════════════════════════════════ */

  return (
    <div style={styles.container}>
      {/* ── Tab Bar ─────────────────────────────────────── */}
      <div style={styles.tabBar} role="tablist">
        {ALL_PROTOCOLS.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={p.id === activeProtocol}
            style={styles.tab(p.id === activeProtocol)}
            onClick={() => switchProtocol(p.id)}
          >
            {p.shortName}
          </button>
        ))}
      </div>

      {/* ── Main Area: Canvas + Sidebar ──────────────────── */}
      <div
        style={{
          ...styles.mainArea,
          flexDirection: isMobile ? "column" : "row",
        }}
      >
        {/* Canvas */}
        <div ref={wrapperRef} style={styles.canvasWrapper}>
          <canvas
            ref={canvasRef}
            style={styles.canvas}
            onMouseMove={handleCanvasMouseMove as any}
            onClick={handleCanvasClick as any}
            onMouseLeave={handleCanvasLeave}
          />
        </div>

        {/* OSI Sidebar */}
        {showSidebar && (
          <div style={styles.sidebar}>
            <div style={styles.sidebarTitle}>OSI Model</div>
            {OSI_LAYERS.map((layer, i) => {
              const active = step.activeOsiLayers.includes(layer);
              const color = OSI_LAYER_COLORS[layer];
              return (
                <div key={layer} style={styles.osiRow(active, color)}>
                  <div style={styles.osiDot(active, color)} />
                  <span>
                    {7 - i}. {layer}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Step Description ─────────────────────────────── */}
      <div style={styles.description}>{step.description}</div>

      {/* ── Controls ─────────────────────────────────────── */}
      <div style={styles.controls}>
        <button
          style={styles.controlBtn(currentStep === 0)}
          onClick={goFirst}
          disabled={currentStep === 0}
          title="Reset to first step"
        >
          &#9198;
        </button>
        <button
          style={styles.controlBtn(currentStep === 0)}
          onClick={goPrev}
          disabled={currentStep === 0}
          title="Previous step"
        >
          &#9664;
        </button>
        <button
          style={styles.playBtn(isPlaying)}
          onClick={() => setIsPlaying(!isPlaying)}
          title={isPlaying ? "Pause" : "Auto-play"}
        >
          {isPlaying ? "\u23F8" : "\u25B6"}
        </button>
        <button
          style={styles.controlBtn(currentStep === totalSteps - 1)}
          onClick={goNext}
          disabled={currentStep === totalSteps - 1}
          title="Next step"
        >
          &#9654;
        </button>

        <div style={styles.speedControl}>
          <span style={styles.speedLabel}>Speed</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={speed}
            onInput={(e) => setSpeed(Number((e.target as HTMLInputElement).value))}
            style={styles.speedSlider}
          />
        </div>

        {!isMobile && (
          <button
            style={styles.controlBtn(false)}
            onClick={() => setShowSidebar(!showSidebar)}
            title={showSidebar ? "Hide OSI panel" : "Show OSI panel"}
          >
            {showSidebar ? "Hide OSI" : "Show OSI"}
          </button>
        )}

        <span style={styles.stepIndicator}>
          Step {currentStep + 1} / {totalSteps}
        </span>
      </div>

      {/* ── Packet Inspector ─────────────────────────────── */}
      <div style={styles.inspector}>
        <div style={styles.inspectorTitle}>
          Packet Inspector{" "}
          {selectedStep !== null && (
            <span style={{ fontWeight: "400", color: "var(--color-text-muted)" }}>
              {" "}
              (Step {inspectedStepIndex + 1})
              <button
                style={{
                  marginLeft: "8px",
                  fontSize: "11px",
                  color: "var(--color-primary)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "var(--font-sans)",
                  textDecoration: "underline",
                }}
                onClick={() => setSelectedStep(null)}
              >
                Clear selection
              </button>
            </span>
          )}
        </div>

        {inspectedStep.packetHeaders.length === 0 ? (
          <div style={styles.inspectorEmpty}>
            No packet data for this step. Click an arrow in the diagram to inspect a specific packet.
          </div>
        ) : (
          inspectedStep.packetHeaders.map((header, hi) => (
            <PacketHeaderView key={hi} header={header} />
          ))
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Sub-component: Packet Header View
   ══════════════════════════════════════════════════════════ */

function PacketHeaderView({ header }: { header: PacketHeader }) {
  const layerColor = OSI_LAYER_COLORS[header.layer] ?? "var(--color-text)";
  return (
    <div style={styles.headerGroup}>
      <div style={styles.headerGroupTitle(layerColor)}>{header.layer} Layer</div>
      <table style={styles.headerTable}>
        <tbody>
          {Object.entries(header.fields).map(([key, value]) => (
            <tr key={key} style={styles.headerRow}>
              <td style={styles.headerKey}>{key}</td>
              <td style={styles.headerValue}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
