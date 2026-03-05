import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";
import type { OverlayEntry, ViewMode, SampleData } from "./types";
import {
  DISTRIBUTIONS,
  getDistribution,
  PRESETS,
  OVERLAY_COLORS,
} from "./distributions-config";
import { createSampler } from "./math";
import { renderPlot, computeSampleData } from "./canvas-renderer";

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function formatStat(value: number | string): string {
  if (typeof value === "string") return value;
  if (!Number.isFinite(value)) return "Undefined";
  if (Math.abs(value) > 1e6) return value.toExponential(3);
  if (Math.abs(value) < 0.0001 && value !== 0) return value.toExponential(3);
  return value.toFixed(4);
}

// ─────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────

export default function Distributions() {
  // --- Primary state ---
  const [selectedDistId, setSelectedDistId] = useState("normal");
  const [params, setParams] = useState<number[]>([0, 1]);
  const [viewMode, setViewMode] = useState<ViewMode>("pdf");

  // --- Overlay state ---
  const [overlayMode, setOverlayMode] = useState(false);
  const [overlays, setOverlays] = useState<OverlayEntry[]>([]);

  // --- Probability calculator ---
  const [probX, setProbX] = useState("1.96");
  const [probA, setProbA] = useState("");
  const [probB, setProbB] = useState("");

  // --- Sampling ---
  const [sampleData, setSampleData] = useState<SampleData | null>(null);
  const [sampleCount, setSampleCount] = useState(1000);

  // --- Canvas ---
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(600);
  const canvasHeight = Math.round(canvasWidth * 0.6);

  const distribution = useMemo(
    () => getDistribution(selectedDistId) ?? DISTRIBUTIONS[0],
    [selectedDistId]
  );

  // --- Initialize params when distribution changes ---
  useEffect(() => {
    const dist = getDistribution(selectedDistId);
    if (dist) {
      setParams(dist.parameters.map((p) => p.defaultValue));
      setSampleData(null);
    }
  }, [selectedDistId]);

  // --- Responsive canvas sizing ---
  useEffect(() => {
    function handleResize() {
      if (containerRef.current) {
        const width = containerRef.current.clientWidth;
        setCanvasWidth(width);
      }
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // --- Computed stats ---
  const stats = useMemo(() => distribution.stats(params), [distribution, params]);

  // --- Probability calculations ---
  const probResults = useMemo(() => {
    const x = parseFloat(probX);
    const a = parseFloat(probA);
    const b = parseFloat(probB);

    const pLessEqual = Number.isFinite(x) ? distribution.cdf(x, params) : NaN;
    const pGreater = Number.isFinite(x) ? 1 - pLessEqual : NaN;
    const pBetween =
      Number.isFinite(a) && Number.isFinite(b) && b > a
        ? distribution.cdf(b, params) - distribution.cdf(a, params)
        : NaN;

    return { pLessEqual, pGreater, pBetween };
  }, [distribution, params, probX, probA, probB]);

  // --- Shaded range for visualization ---
  const shadedRange = useMemo((): [number, number] | null => {
    const a = parseFloat(probA);
    const b = parseFloat(probB);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
      return [a, b];
    }
    const x = parseFloat(probX);
    if (Number.isFinite(x)) {
      const xRange = distribution.xRange(params);
      return [xRange[0], x];
    }
    return null;
  }, [distribution, params, probX, probA, probB]);

  // --- Highlight X ---
  const highlightX = useMemo(() => {
    const x = parseFloat(probX);
    return Number.isFinite(x) ? x : null;
  }, [probX]);

  // --- Canvas rendering ---
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    ctx.scale(dpr, dpr);

    renderPlot(ctx, canvasWidth, canvasHeight, {
      distribution,
      params,
      viewMode,
      overlays: overlayMode ? overlays : [],
      sampleData,
      shadedRange,
      highlightX,
    });
  }, [distribution, params, viewMode, overlays, overlayMode, sampleData, shadedRange, highlightX, canvasWidth, canvasHeight]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // --- Handlers ---
  const handleParamChange = useCallback((index: number, value: number) => {
    setParams((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    setSampleData(null);
  }, []);

  const handleSample = useCallback(() => {
    const sampler = createSampler(distribution.id, params);
    const values = sampler(sampleCount);
    const numBins = Math.min(Math.max(Math.ceil(Math.sqrt(sampleCount)), 15), 80);
    setSampleData(computeSampleData(values, numBins));
  }, [distribution, params, sampleCount]);

  const handleClearSamples = useCallback(() => {
    setSampleData(null);
  }, []);

  const handleAddOverlay = useCallback(() => {
    if (overlays.length >= 3) return;
    const colorIdx = overlays.length % OVERLAY_COLORS.length;
    // Default to a different distribution
    const usedIds = [distribution.id, ...overlays.map((o) => o.distributionId)];
    const available = DISTRIBUTIONS.filter((d) => !usedIds.includes(d.id));
    const next = available.length > 0 ? available[0] : DISTRIBUTIONS[0];
    setOverlays((prev) => [
      ...prev,
      {
        distributionId: next.id,
        params: next.parameters.map((p) => p.defaultValue),
        color: OVERLAY_COLORS[colorIdx + 1] ?? OVERLAY_COLORS[0],
      },
    ]);
    setOverlayMode(true);
  }, [overlays, distribution]);

  const handleRemoveOverlay = useCallback((index: number) => {
    setOverlays((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) {
        setOverlayMode(false);
      }
      return next;
    });
  }, []);

  const handleOverlayDistChange = useCallback((index: number, distId: string) => {
    setOverlays((prev) => {
      const next = [...prev];
      const dist = getDistribution(distId);
      if (!dist) return prev;
      next[index] = {
        ...next[index],
        distributionId: distId,
        params: dist.parameters.map((p) => p.defaultValue),
      };
      return next;
    });
  }, []);

  const handleOverlayParamChange = useCallback((overlayIdx: number, paramIdx: number, value: number) => {
    setOverlays((prev) => {
      const next = [...prev];
      const newParams = [...next[overlayIdx].params];
      newParams[paramIdx] = value;
      next[overlayIdx] = { ...next[overlayIdx], params: newParams };
      return next;
    });
  }, []);

  const handlePreset = useCallback((presetIndex: number) => {
    const preset = PRESETS[presetIndex];
    if (!preset) return;

    // Set the primary distribution to the first overlay
    const first = preset.overlays[0];
    setSelectedDistId(first.distributionId);
    setParams([...first.params]);

    // Add remaining as overlays
    const rest = preset.overlays.slice(1).map((o, i) => ({
      ...o,
      color: OVERLAY_COLORS[i + 1] ?? OVERLAY_COLORS[0],
    }));
    setOverlays(rest);
    setOverlayMode(rest.length > 0);
    setSampleData(null);
  }, []);

  // Categorize distributions
  const continuousDists = useMemo(
    () => DISTRIBUTIONS.filter((d) => d.type === "continuous"),
    []
  );
  const discreteDists = useMemo(
    () => DISTRIBUTIONS.filter((d) => d.type === "discrete"),
    []
  );

  return (
    <div class="dist-root overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Toolbar */}
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-[var(--color-text-muted)]">
            Distribution Explorer
          </span>
          <span class="rounded-full border border-[var(--color-primary)]/30 px-2 py-0.5 text-[10px] font-semibold text-[var(--color-primary)]">
            beta
          </span>
        </div>
        <div class="flex items-center gap-2">
          <select
            class="dist-select rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-text)] outline-none"
            value={selectedDistId}
            onChange={(e) => setSelectedDistId((e.target as HTMLSelectElement).value)}
          >
            <optgroup label="Continuous">
              {continuousDists.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </optgroup>
            <optgroup label="Discrete">
              {discreteDists.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </optgroup>
          </select>

          {/* PDF / CDF toggle */}
          <div class="flex rounded-lg border border-[var(--color-border)] overflow-hidden">
            <button
              class="px-3 py-1 text-[11px] font-medium transition-colors"
              style={{
                background: viewMode === "pdf" ? "var(--color-primary)" : "transparent",
                color: viewMode === "pdf" ? "#fff" : "var(--color-text-muted)",
              }}
              onClick={() => setViewMode("pdf")}
            >
              {distribution.type === "discrete" ? "PMF" : "PDF"}
            </button>
            <button
              class="px-3 py-1 text-[11px] font-medium transition-colors"
              style={{
                background: viewMode === "cdf" ? "var(--color-primary)" : "transparent",
                color: viewMode === "cdf" ? "#fff" : "var(--color-text-muted)",
              }}
              onClick={() => setViewMode("cdf")}
            >
              CDF
            </button>
          </div>

          <button
            class="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
            onClick={handleAddOverlay}
            disabled={overlays.length >= 3}
            style={{ opacity: overlays.length >= 3 ? 0.4 : 1 }}
          >
            + Overlay
          </button>
        </div>
      </div>

      {/* Preset comparisons bar */}
      <div class="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
        <span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
          Presets:
        </span>
        {PRESETS.map((preset, i) => (
          <button
            key={preset.name}
            class="rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            onClick={() => handlePreset(i)}
            title={preset.description}
          >
            {preset.name}
          </button>
        ))}
      </div>

      {/* Main content: canvas + sidebar */}
      <div class="grid grid-cols-1 lg:grid-cols-[1fr_300px]">
        {/* Canvas area */}
        <div class="border-b border-[var(--color-border)] lg:border-b-0 lg:border-r">
          <div ref={containerRef} class="relative">
            <canvas
              ref={canvasRef}
              class="block w-full"
              style={{
                aspectRatio: `${canvasWidth} / ${canvasHeight}`,
                imageRendering: "auto",
              }}
            />
          </div>

          {/* Probability calculator */}
          <div class="border-t border-[var(--color-border)] px-4 py-3">
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
              Probability Calculator
            </h3>
            <div class="flex flex-wrap items-end gap-3">
              <div>
                <label class="mb-1 block text-[10px] text-[var(--color-text-muted)]">
                  P(X {"\u2264"} x)
                </label>
                <div class="flex items-center gap-1.5">
                  <span class="text-[11px] text-[var(--color-text-muted)]">x =</span>
                  <input
                    type="number"
                    step="0.1"
                    value={probX}
                    onInput={(e) => setProbX((e.target as HTMLInputElement).value)}
                    class="dist-input w-20 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-[11px] text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
                  />
                  <span class="text-[11px] text-[var(--color-text-muted)]">=</span>
                  <span class="font-mono text-[11px] font-semibold" style={{ color: distribution.color }}>
                    {Number.isFinite(probResults.pLessEqual) ? probResults.pLessEqual.toFixed(6) : "--"}
                  </span>
                </div>
              </div>
              <div>
                <label class="mb-1 block text-[10px] text-[var(--color-text-muted)]">
                  P(X &gt; x)
                </label>
                <span class="font-mono text-[11px] font-semibold" style={{ color: distribution.color }}>
                  {Number.isFinite(probResults.pGreater) ? probResults.pGreater.toFixed(6) : "--"}
                </span>
              </div>
              <div class="flex items-end gap-1.5">
                <div>
                  <label class="mb-1 block text-[10px] text-[var(--color-text-muted)]">
                    P(a {"\u2264"} X {"\u2264"} b)
                  </label>
                  <div class="flex items-center gap-1">
                    <input
                      type="number"
                      step="0.1"
                      placeholder="a"
                      value={probA}
                      onInput={(e) => setProbA((e.target as HTMLInputElement).value)}
                      class="dist-input w-16 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-[11px] text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
                    />
                    <span class="text-[10px] text-[var(--color-text-muted)]">to</span>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="b"
                      value={probB}
                      onInput={(e) => setProbB((e.target as HTMLInputElement).value)}
                      class="dist-input w-16 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-[11px] text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
                    />
                    <span class="text-[11px] text-[var(--color-text-muted)]">=</span>
                    <span class="font-mono text-[11px] font-semibold" style={{ color: distribution.color }}>
                      {Number.isFinite(probResults.pBetween) ? probResults.pBetween.toFixed(6) : "--"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sampling controls */}
          <div class="border-t border-[var(--color-border)] px-4 py-3">
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
              Sampling
            </h3>
            <div class="flex flex-wrap items-center gap-2">
              <label class="text-[11px] text-[var(--color-text-muted)]">N =</label>
              <select
                class="dist-select rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[11px] text-[var(--color-text)] outline-none"
                value={sampleCount}
                onChange={(e) => setSampleCount(Number((e.target as HTMLSelectElement).value))}
              >
                <option value={100}>100</option>
                <option value={500}>500</option>
                <option value={1000}>1,000</option>
                <option value={5000}>5,000</option>
                <option value={10000}>10,000</option>
              </select>
              <button
                class="dist-btn-primary rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white transition-all"
                onClick={handleSample}
              >
                Sample {sampleCount.toLocaleString()} points
              </button>
              {sampleData && (
                <button
                  class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[11px] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-heading)]"
                  onClick={handleClearSamples}
                >
                  Clear
                </button>
              )}
              {sampleData && (
                <span class="text-[10px] text-[var(--color-text-muted)]">
                  {sampleData.values.length.toLocaleString()} samples drawn
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar: parameters + stats + overlays */}
        <div class="flex flex-col gap-0 overflow-y-auto" style={{ maxHeight: "calc(100vh - 200px)" }}>
          {/* Parameters */}
          <div class="border-b border-[var(--color-border)] p-4">
            <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
              Parameters
            </h3>
            <div class="flex items-center gap-2 mb-3">
              <span
                class="inline-block h-3 w-3 rounded-full"
                style={{ background: distribution.color }}
              />
              <span class="text-[11px] font-medium" style={{ color: distribution.color }}>
                {distribution.name}
              </span>
              <span class="text-[9px] text-[var(--color-text-muted)]">
                ({distribution.type})
              </span>
            </div>
            {distribution.parameters.map((paramDef, i) => (
              <div key={paramDef.name} class="mb-3">
                <div class="mb-1 flex items-center justify-between">
                  <label class="text-[11px] text-[var(--color-text-muted)]">
                    {paramDef.label}
                  </label>
                  <span class="font-mono text-[11px] text-[var(--color-heading)]">
                    {params[i]?.toFixed(paramDef.step < 0.01 ? 3 : (paramDef.step < 1 ? 2 : 0))}
                  </span>
                </div>
                <input
                  type="range"
                  min={paramDef.min}
                  max={paramDef.max}
                  step={paramDef.step}
                  value={params[i] ?? paramDef.defaultValue}
                  onInput={(e) =>
                    handleParamChange(i, Number((e.target as HTMLInputElement).value))
                  }
                  class="dist-slider w-full"
                />
              </div>
            ))}
          </div>

          {/* Statistics */}
          <div class="border-b border-[var(--color-border)] p-4">
            <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
              Statistics
            </h3>
            <div class="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {[
                { label: "Mean", value: stats.mean },
                { label: "Variance", value: stats.variance },
                { label: "Std Dev", value: stats.stdDev },
                { label: "Skewness", value: stats.skewness },
                { label: "Kurtosis", value: stats.kurtosis },
                { label: "Mode", value: stats.mode },
                { label: "Median", value: stats.median },
              ].map(({ label, value }) => (
                <div key={label} class="flex items-baseline justify-between">
                  <span class="text-[10px] text-[var(--color-text-muted)]">{label}</span>
                  <span class="font-mono text-[10px] text-[var(--color-heading)]">
                    {formatStat(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Overlays */}
          {overlayMode && overlays.length > 0 && (
            <div class="border-b border-[var(--color-border)] p-4">
              <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
                Overlays
              </h3>
              {overlays.map((overlay, oi) => {
                const overlayDist = getDistribution(overlay.distributionId);
                return (
                  <div
                    key={oi}
                    class="mb-3 rounded-lg border border-[var(--color-border)] p-3"
                    style={{ borderColor: overlay.color + "40" }}
                  >
                    <div class="mb-2 flex items-center justify-between">
                      <div class="flex items-center gap-2">
                        <span
                          class="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ background: overlay.color }}
                        />
                        <select
                          class="dist-select rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 text-[11px] text-[var(--color-text)] outline-none"
                          value={overlay.distributionId}
                          onChange={(e) =>
                            handleOverlayDistChange(oi, (e.target as HTMLSelectElement).value)
                          }
                        >
                          <optgroup label="Continuous">
                            {continuousDists.map((d) => (
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                          </optgroup>
                          <optgroup label="Discrete">
                            {discreteDists.map((d) => (
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                          </optgroup>
                        </select>
                      </div>
                      <button
                        class="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-heading)]"
                        onClick={() => handleRemoveOverlay(oi)}
                      >
                        Remove
                      </button>
                    </div>
                    {overlayDist?.parameters.map((paramDef, pi) => (
                      <div key={paramDef.name} class="mb-1.5">
                        <div class="mb-0.5 flex items-center justify-between">
                          <label class="text-[10px] text-[var(--color-text-muted)]">
                            {paramDef.label}
                          </label>
                          <span class="font-mono text-[10px] text-[var(--color-heading)]">
                            {overlay.params[pi]?.toFixed(
                              paramDef.step < 0.01 ? 3 : (paramDef.step < 1 ? 2 : 0)
                            )}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={paramDef.min}
                          max={paramDef.max}
                          step={paramDef.step}
                          value={overlay.params[pi] ?? paramDef.defaultValue}
                          onInput={(e) =>
                            handleOverlayParamChange(
                              oi,
                              pi,
                              Number((e.target as HTMLInputElement).value)
                            )
                          }
                          class="dist-slider w-full"
                        />
                      </div>
                    ))}
                  </div>
                );
              })}
              {overlays.length < 3 && (
                <button
                  class="w-full rounded-lg border border-dashed border-[var(--color-border)] py-1.5 text-[11px] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                  onClick={handleAddOverlay}
                >
                  + Add overlay
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .dist-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          border-radius: 2px;
          background: var(--color-border);
          outline: none;
        }
        .dist-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--color-primary);
          cursor: pointer;
          border: 2px solid var(--color-surface);
          box-shadow: 0 0 4px rgba(79, 143, 247, 0.3);
        }
        .dist-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--color-primary);
          cursor: pointer;
          border: 2px solid var(--color-surface);
        }
        .dist-btn-primary {
          background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
        }
        .dist-btn-primary:hover {
          filter: brightness(1.1);
          box-shadow: 0 0 20px color-mix(in srgb, var(--color-primary) 40%, transparent);
        }
        .dist-select option {
          background: var(--color-bg);
          color: var(--color-text);
        }
        .dist-input::placeholder {
          color: var(--color-text-muted);
          opacity: 0.5;
        }
      `}</style>
    </div>
  );
}
