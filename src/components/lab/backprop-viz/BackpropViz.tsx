import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";
import {
  createNetwork,
  forwardPass,
  backwardPass,
  updateWeights,
  predict,
  gradientMagnitudesPerLayer,
  PRESETS,
} from "./engine";
import type {
  Network,
  ActivationType,
  Preset,
} from "./engine";

/* ──────────────────────────────────────
   Constants
   ────────────────────────────────────── */

const ACTIVATION_OPTIONS: ActivationType[] = ["relu", "sigmoid", "tanh"];

const PASS_PHASE = {
  IDLE: 0,
  FORWARD: 1,
  BACKWARD: 2,
} as const;
type PassPhase = (typeof PASS_PHASE)[keyof typeof PASS_PHASE];

const PHASE_LABELS: Record<PassPhase, string> = {
  [PASS_PHASE.IDLE]: "Idle",
  [PASS_PHASE.FORWARD]: "Forward Pass",
  [PASS_PHASE.BACKWARD]: "Backward Pass",
};

const MAX_LOSS_HISTORY = 200;

/* ──────────────────────────────────────
   Component
   ────────────────────────────────────── */

export default function BackpropViz() {
  // Network config
  const [layerSizes, setLayerSizes] = useState<number[]>([2, 4, 2]);
  const [activation, setActivation] = useState<ActivationType>("tanh");
  const [learningRate, setLearningRate] = useState(0.1);

  // Data
  const [sampleIndex, setSampleIndex] = useState(0);
  const [presetIndex, setPresetIndex] = useState(0);

  // Visualization state
  const [phase, setPhase] = useState<PassPhase>(PASS_PHASE.IDLE);
  const [epoch, setEpoch] = useState(0);
  const [lossHistory, setLossHistory] = useState<number[]>([]);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [showGradientBars, setShowGradientBars] = useState(false);
  const [gradMagnitudes, setGradMagnitudes] = useState<number[]>([]);

  // Refs
  const networkRef = useRef<Network | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gradCanvasRef = useRef<HTMLCanvasElement>(null);
  const lossCanvasRef = useRef<HTMLCanvasElement>(null);
  const autoPlayRef = useRef(false);
  const animFrameRef = useRef(0);
  const epochRef = useRef(0);
  const lossHistoryRef = useRef<number[]>([]);

  const currentPreset = useMemo(() => PRESETS[presetIndex], [presetIndex]);

  // Initialize network
  const initNetwork = useCallback(() => {
    const sizes = [...layerSizes];
    const net = createNetwork(sizes, activation);
    networkRef.current = net;
    epochRef.current = 0;
    lossHistoryRef.current = [];
    setEpoch(0);
    setPhase(PASS_PHASE.IDLE);
    setLossHistory([]);
    setGradMagnitudes([]);
    setSampleIndex(0);
    setIsAutoPlaying(false);
    autoPlayRef.current = false;
    cancelAnimationFrame(animFrameRef.current);
  }, [layerSizes, activation]);

  // Run forward pass on current sample
  const runForwardPass = useCallback(() => {
    const net = networkRef.current;
    if (!net) return;

    const inputs = currentPreset.inputs[sampleIndex];
    const targets = currentPreset.targets[sampleIndex];
    forwardPass(net, inputs, targets);
    setPhase(PASS_PHASE.FORWARD);
    drawNetwork();
  }, [sampleIndex, currentPreset]);

  // Run backward pass
  const runBackwardPass = useCallback(() => {
    const net = networkRef.current;
    if (!net) return;

    backwardPass(net);
    setPhase(PASS_PHASE.BACKWARD);
    setGradMagnitudes(gradientMagnitudesPerLayer(net));
    drawNetwork();
    drawGradientBars();
  }, []);

  // Update weights and advance
  const applyUpdate = useCallback(() => {
    const net = networkRef.current;
    if (!net) return;

    updateWeights(net, learningRate);
    epochRef.current++;
    setEpoch(epochRef.current);

    // Record loss
    if (lossHistoryRef.current.length >= MAX_LOSS_HISTORY) {
      lossHistoryRef.current = lossHistoryRef.current.filter(
        (_, i) => i % 2 === 0,
      );
    }
    lossHistoryRef.current.push(net.loss);
    setLossHistory([...lossHistoryRef.current]);
    setPhase(PASS_PHASE.IDLE);
    drawNetwork();
    drawLossChart();
  }, [learningRate]);

  // Full training step: forward + backward + update for all samples
  const fullTrainingStep = useCallback(() => {
    const net = networkRef.current;
    if (!net) return;

    let totalLoss = 0;
    for (let s = 0; s < currentPreset.inputs.length; s++) {
      forwardPass(net, currentPreset.inputs[s], currentPreset.targets[s]);
      backwardPass(net);
      updateWeights(net, learningRate / currentPreset.inputs.length);
      totalLoss += net.loss;
    }
    totalLoss /= currentPreset.inputs.length;

    epochRef.current++;
    setEpoch(epochRef.current);

    if (lossHistoryRef.current.length >= MAX_LOSS_HISTORY) {
      lossHistoryRef.current = lossHistoryRef.current.filter(
        (_, i) => i % 2 === 0,
      );
    }
    lossHistoryRef.current.push(totalLoss);
    setLossHistory([...lossHistoryRef.current]);
    setGradMagnitudes(gradientMagnitudesPerLayer(net));

    // Show the last sample's state
    forwardPass(
      net,
      currentPreset.inputs[sampleIndex],
      currentPreset.targets[sampleIndex],
    );
    backwardPass(net);
    setPhase(PASS_PHASE.BACKWARD);

    drawNetwork();
    drawLossChart();
    drawGradientBars();
  }, [learningRate, currentPreset, sampleIndex]);

  // Auto-play training loop
  const autoPlayLoop = useCallback(() => {
    if (!autoPlayRef.current) return;

    const net = networkRef.current;
    if (!net) return;

    let totalLoss = 0;
    for (let s = 0; s < currentPreset.inputs.length; s++) {
      forwardPass(net, currentPreset.inputs[s], currentPreset.targets[s]);
      backwardPass(net);
      updateWeights(net, learningRate / currentPreset.inputs.length);
      totalLoss += net.loss;
    }
    totalLoss /= currentPreset.inputs.length;

    epochRef.current++;
    setEpoch(epochRef.current);

    if (lossHistoryRef.current.length >= MAX_LOSS_HISTORY) {
      lossHistoryRef.current = lossHistoryRef.current.filter(
        (_, i) => i % 2 === 0,
      );
    }
    lossHistoryRef.current.push(totalLoss);
    setLossHistory([...lossHistoryRef.current]);
    setGradMagnitudes(gradientMagnitudesPerLayer(net));

    // Show current sample's state
    forwardPass(
      net,
      currentPreset.inputs[sampleIndex],
      currentPreset.targets[sampleIndex],
    );
    backwardPass(net);
    setPhase(PASS_PHASE.BACKWARD);

    drawNetwork();
    drawLossChart();
    drawGradientBars();

    if (totalLoss > 0.0001 && epochRef.current < 5000) {
      animFrameRef.current = requestAnimationFrame(autoPlayLoop);
    } else {
      autoPlayRef.current = false;
      setIsAutoPlaying(false);
    }
  }, [learningRate, currentPreset, sampleIndex]);

  const toggleAutoPlay = useCallback(() => {
    if (isAutoPlaying) {
      autoPlayRef.current = false;
      setIsAutoPlaying(false);
      cancelAnimationFrame(animFrameRef.current);
    } else {
      autoPlayRef.current = true;
      setIsAutoPlaying(true);
      animFrameRef.current = requestAnimationFrame(autoPlayLoop);
    }
  }, [isAutoPlaying, autoPlayLoop]);

  // Drawing functions
  const drawNetwork = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    const bgColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-surface")
      .trim();
    ctx.fillStyle = bgColor || "#111111";
    ctx.fillRect(0, 0, w, h);

    const net = networkRef.current;
    if (!net) return;

    const numLayers = net.layerSizes.length;
    const padX = 60;
    const padY = 40;
    const layerSpacing = (w - 2 * padX) / Math.max(numLayers - 1, 1);

    const textColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-text-muted")
      .trim() || "#a1a1aa";
    const headingColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-heading")
      .trim() || "#ffffff";

    // Compute node positions
    const positions: { x: number; y: number }[][] = [];
    for (let l = 0; l < numLayers; l++) {
      const size = net.layerSizes[l];
      const layerPositions: { x: number; y: number }[] = [];
      const x = padX + l * layerSpacing;
      const totalH = h - 2 * padY;
      const nodeSpacing = size > 1 ? totalH / (size - 1) : 0;
      const startY = size > 1 ? padY : h / 2;

      for (let n = 0; n < size; n++) {
        layerPositions.push({
          x,
          y: startY + n * nodeSpacing,
        });
      }
      positions.push(layerPositions);
    }

    // Draw connections (weights)
    for (let l = 1; l < numLayers; l++) {
      const layer = net.layers[l];
      for (let j = 0; j < net.layerSizes[l]; j++) {
        for (let i = 0; i < net.layerSizes[l - 1]; i++) {
          const from = positions[l - 1][i];
          const to = positions[l][j];
          const weight = layer.weights[j][i];

          // Color: green for positive, red for negative
          const wVal = weight.value;
          const absW = Math.min(Math.abs(wVal), 3);
          const lineWidth = 0.5 + (absW / 3) * 3;

          let lineColor: string;
          if (phase === PASS_PHASE.BACKWARD) {
            // Show gradient magnitude as color intensity
            const absGrad = Math.min(Math.abs(weight.grad), 2);
            const intensity = absGrad / 2;
            const gradColor =
              weight.grad >= 0
                ? `rgba(239, 68, 68, ${0.15 + intensity * 0.85})`
                : `rgba(79, 143, 247, ${0.15 + intensity * 0.85})`;
            lineColor = gradColor;
          } else {
            const alpha = 0.2 + (absW / 3) * 0.6;
            lineColor =
              wVal >= 0
                ? `rgba(52, 211, 153, ${alpha})`
                : `rgba(239, 68, 68, ${alpha})`;
          }

          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(to.x, to.y);
          ctx.strokeStyle = lineColor;
          ctx.lineWidth = lineWidth;
          ctx.stroke();

          // Show weight value on hover area — show value as text for small networks
          if (numLayers <= 4 && net.layerSizes[l] <= 4 && net.layerSizes[l - 1] <= 3) {
            const midX = (from.x + to.x) / 2;
            const midY = (from.y + to.y) / 2;
            const offset = (j - (net.layerSizes[l] - 1) / 2) * 3;
            ctx.font = "9px Inter, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            if (phase === PASS_PHASE.BACKWARD) {
              ctx.fillStyle = `rgba(239, 68, 68, 0.8)`;
              ctx.fillText(
                `g:${weight.grad.toFixed(2)}`,
                midX,
                midY + offset + 8,
              );
            }
            ctx.fillStyle = textColor;
            ctx.fillText(`${wVal.toFixed(2)}`, midX, midY + offset - 2);
          }
        }
      }
    }

    // Draw nodes
    const nodeRadius = Math.max(14, Math.min(22, 200 / Math.max(...net.layerSizes)));

    for (let l = 0; l < numLayers; l++) {
      const layer = net.layers[l];
      const isInput = l === 0;
      const isOutput = l === numLayers - 1;

      for (let n = 0; n < net.layerSizes[l]; n++) {
        const pos = positions[l][n];
        const node = layer.nodes[n];

        // Node circle
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, nodeRadius, 0, 2 * Math.PI);

        // Fill based on activation
        if (phase !== PASS_PHASE.IDLE) {
          const aVal = clampDisplay(node.a);
          const brightness = Math.abs(aVal);
          if (isInput) {
            ctx.fillStyle = `rgba(161, 161, 170, ${0.1 + brightness * 0.5})`;
          } else if (isOutput) {
            ctx.fillStyle = `rgba(52, 211, 153, ${0.1 + brightness * 0.6})`;
          } else {
            ctx.fillStyle = `rgba(79, 143, 247, ${0.1 + brightness * 0.6})`;
          }
        } else {
          ctx.fillStyle = "rgba(39, 39, 42, 0.5)";
        }
        ctx.fill();

        // Border
        ctx.strokeStyle = isOutput
          ? "rgba(52, 211, 153, 0.6)"
          : isInput
            ? "rgba(161, 161, 170, 0.4)"
            : "rgba(79, 143, 247, 0.4)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Node value text
        ctx.font = "bold 10px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = headingColor;

        if (phase !== PASS_PHASE.IDLE) {
          ctx.fillText(formatValue(node.a), pos.x, pos.y);
        }

        // Show z value (pre-activation) for hidden/output during forward
        if (
          phase === PASS_PHASE.FORWARD &&
          !isInput &&
          nodeRadius >= 16
        ) {
          ctx.font = "8px Inter, sans-serif";
          ctx.fillStyle = textColor;
          ctx.fillText(`z=${formatValue(node.z)}`, pos.x, pos.y + nodeRadius + 10);
        }

        // Show gradient during backward pass
        if (phase === PASS_PHASE.BACKWARD && !isInput) {
          ctx.font = "8px Inter, sans-serif";
          ctx.fillStyle = "rgba(239, 68, 68, 0.9)";
          const gradText = `dz=${formatValue(node.dZ)}`;
          ctx.fillText(gradText, pos.x, pos.y + nodeRadius + 10);
        }
      }

      // Layer label
      ctx.font = "10px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = textColor;
      const labelY = h - 8;
      const labelText = isInput
        ? "Input"
        : isOutput
          ? "Output"
          : `Hidden ${l}`;
      ctx.fillText(labelText, positions[l][0].x, labelY);
    }

    // Phase indicator
    ctx.font = "bold 11px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle =
      phase === PASS_PHASE.FORWARD
        ? "rgba(52, 211, 153, 0.9)"
        : phase === PASS_PHASE.BACKWARD
          ? "rgba(239, 68, 68, 0.9)"
          : textColor;
    ctx.fillText(PHASE_LABELS[phase], 8, 16);

    // Loss display
    if (networkRef.current && phase !== PASS_PHASE.IDLE) {
      ctx.font = "10px Inter, sans-serif";
      ctx.textAlign = "right";
      ctx.fillStyle = textColor;
      ctx.fillText(
        `Loss: ${networkRef.current.loss.toFixed(4)}`,
        w - 8,
        16,
      );
    }
  }, [phase]);

  const drawGradientBars = useCallback(() => {
    const canvas = gradCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    const bgColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-surface")
      .trim();
    ctx.fillStyle = bgColor || "#111111";
    ctx.fillRect(0, 0, w, h);

    const net = networkRef.current;
    if (!net || gradMagnitudes.length === 0) {
      const textColor = getComputedStyle(document.documentElement)
        .getPropertyValue("--color-text-muted")
        .trim() || "#a1a1aa";
      ctx.fillStyle = textColor;
      ctx.font = "10px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Run backward pass to see gradient magnitudes", w / 2, h / 2);
      return;
    }

    const maxMag = Math.max(0.001, ...gradMagnitudes);
    const barCount = gradMagnitudes.length;
    const padX = 30;
    const padY = 20;
    const barWidth = Math.min(40, (w - 2 * padX) / barCount - 8);
    const totalBarsWidth = barCount * (barWidth + 8) - 8;
    const startX = (w - totalBarsWidth) / 2;
    const barAreaH = h - 2 * padY;

    const textColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-text-muted")
      .trim() || "#a1a1aa";

    for (let i = 0; i < barCount; i++) {
      const mag = gradMagnitudes[i];
      const barH = (mag / maxMag) * barAreaH;
      const x = startX + i * (barWidth + 8);
      const y = h - padY - barH;

      // Gradient from red (vanishing) to green (healthy)
      const ratio = mag / maxMag;
      const r = Math.round(239 * (1 - ratio) + 52 * ratio);
      const g = Math.round(68 * (1 - ratio) + 211 * ratio);
      const b = Math.round(68 * (1 - ratio) + 153 * ratio);

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.8)`;
      ctx.fillRect(x, y, barWidth, barH);

      // Label
      ctx.font = "9px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = textColor;
      ctx.fillText(`L${i + 1}`, x + barWidth / 2, h - 5);

      // Value
      ctx.font = "8px Inter, sans-serif";
      ctx.fillText(mag.toFixed(4), x + barWidth / 2, y - 4);
    }

    // Title
    ctx.font = "bold 10px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = textColor;
    ctx.fillText("Gradient Magnitude per Layer", w / 2, 12);
  }, [gradMagnitudes]);

  const drawLossChart = useCallback(() => {
    const canvas = lossCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const pad = { top: 16, right: 10, bottom: 16, left: 36 };

    const bgColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-surface")
      .trim();
    ctx.fillStyle = bgColor || "#111111";
    ctx.fillRect(0, 0, w, h);

    const losses = lossHistoryRef.current;
    if (losses.length < 2) {
      const textColor = getComputedStyle(document.documentElement)
        .getPropertyValue("--color-text-muted")
        .trim() || "#a1a1aa";
      ctx.fillStyle = textColor;
      ctx.font = "10px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Loss chart appears after training", w / 2, h / 2);
      return;
    }

    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const maxLoss = Math.max(0.01, ...losses);
    const yScale = plotH / maxLoss;

    const textColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-text-muted")
      .trim() || "#a1a1aa";

    // Grid lines
    ctx.strokeStyle = "rgba(161, 161, 170, 0.1)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = pad.top + (plotH / 3) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();

      ctx.fillStyle = textColor;
      ctx.font = "8px Inter, sans-serif";
      ctx.textAlign = "right";
      const val = maxLoss * (1 - i / 3);
      ctx.fillText(val.toFixed(3), pad.left - 4, y + 3);
    }

    // Loss curve
    ctx.strokeStyle = "rgba(239, 68, 68, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < losses.length; i++) {
      const x = pad.left + (i / (losses.length - 1)) * plotW;
      const y = pad.top + plotH - losses[i] * yScale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Label
    ctx.font = "bold 9px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(239, 68, 68, 0.8)";
    ctx.fillText("Loss", pad.left + 2, pad.top + 10);
  }, []);

  // Apply preset
  const applyPreset = useCallback(
    (idx: number) => {
      setPresetIndex(idx);
      const preset = PRESETS[idx];
      setLayerSizes([...preset.layerSizes]);
      setActivation(preset.activation);
      setLearningRate(preset.learningRate);
    },
    [],
  );

  // Initialize on mount
  useEffect(() => {
    initNetwork();
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      autoPlayRef.current = false;
    };
  }, []);

  // Re-init when config changes (only when not auto-playing)
  useEffect(() => {
    if (!isAutoPlaying) {
      initNetwork();
    }
  }, [layerSizes, activation]);

  // Resize handler
  useEffect(() => {
    const handleResize = () => {
      drawNetwork();
      drawLossChart();
      if (showGradientBars) drawGradientBars();
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [drawNetwork, drawLossChart, drawGradientBars, showGradientBars]);

  // Adjust layer sizes with UI
  const addHiddenLayer = useCallback(() => {
    if (isAutoPlaying) return;
    setLayerSizes((prev) => {
      if (prev.length >= 8) return prev;
      const newSizes = [...prev];
      newSizes.splice(newSizes.length - 1, 0, 3);
      return newSizes;
    });
  }, [isAutoPlaying]);

  const removeHiddenLayer = useCallback(() => {
    if (isAutoPlaying) return;
    setLayerSizes((prev) => {
      if (prev.length <= 3) return prev;
      const newSizes = [...prev];
      newSizes.splice(newSizes.length - 2, 1);
      return newSizes;
    });
  }, [isAutoPlaying]);

  const setHiddenNeurons = useCallback(
    (layerIdx: number, count: number) => {
      if (isAutoPlaying) return;
      setLayerSizes((prev) => {
        const newSizes = [...prev];
        newSizes[layerIdx] = count;
        return newSizes;
      });
    },
    [isAutoPlaying],
  );

  const hiddenLayers = layerSizes.slice(1, -1);

  return (
    <div
      class="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
      style={{ boxShadow: "0 0 0 1px var(--color-border)" }}
    >
      {/* Toolbar */}
      <div class="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-[var(--color-text-muted)]">
            Backpropagation Visualizer
          </span>
          <span
            class="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
            style={{
              borderColor: "rgba(52, 211, 153, 0.3)",
              color: "var(--color-accent)",
            }}
          >
            beta
          </span>
        </div>
        <span class="text-[10px] text-[var(--color-text-muted)]">
          Epoch: {epoch}
        </span>
      </div>

      {/* Main layout */}
      <div class="flex flex-col lg:flex-row">
        {/* Left panel: Controls */}
        <div class="border-b border-[var(--color-border)] p-4 lg:w-72 lg:shrink-0 lg:border-r lg:border-b-0">
          {/* Presets */}
          <Section title="Presets">
            <select
              value={presetIndex}
              onChange={(e) => {
                applyPreset(parseInt((e.target as HTMLSelectElement).value));
              }}
              class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none transition-colors hover:border-[var(--color-primary)]"
              disabled={isAutoPlaying}
            >
              {PRESETS.map((p, i) => (
                <option key={i} value={i}>
                  {p.name}
                </option>
              ))}
            </select>
            <p class="mt-1 text-[10px] text-[var(--color-text-muted)]">
              {currentPreset.description}
            </p>
          </Section>

          {/* Architecture */}
          <Section title="Architecture">
            <div class="mb-2 flex items-center justify-between">
              <span class="text-[10px] text-[var(--color-text-muted)]">
                Hidden Layers: {hiddenLayers.length}
              </span>
              <div class="flex gap-1">
                <button
                  onClick={removeHiddenLayer}
                  class="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-xs text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
                  disabled={isAutoPlaying || layerSizes.length <= 3}
                  style={{
                    opacity: isAutoPlaying || layerSizes.length <= 3 ? 0.4 : 1,
                  }}
                >
                  -
                </button>
                <button
                  onClick={addHiddenLayer}
                  class="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-xs text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
                  disabled={isAutoPlaying || layerSizes.length >= 8}
                  style={{
                    opacity: isAutoPlaying || layerSizes.length >= 8 ? 0.4 : 1,
                  }}
                >
                  +
                </button>
              </div>
            </div>

            {hiddenLayers.map((neurons, i) => (
              <div key={i} class="mb-2">
                <div class="flex items-center justify-between">
                  <span class="text-[10px] text-[var(--color-text-muted)]">
                    Hidden {i + 1}
                  </span>
                  <span class="text-[10px] font-semibold text-[var(--color-primary)]">
                    {neurons}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={6}
                  value={neurons}
                  onInput={(e) =>
                    setHiddenNeurons(
                      i + 1,
                      parseInt((e.target as HTMLInputElement).value),
                    )
                  }
                  class="bp-slider w-full"
                  disabled={isAutoPlaying}
                />
              </div>
            ))}

            <Label text="Activation" />
            <div class="mb-1 flex gap-1">
              {ACTIVATION_OPTIONS.map((act) => (
                <button
                  key={act}
                  onClick={() => {
                    if (isAutoPlaying) return;
                    setActivation(act);
                  }}
                  class="flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-all"
                  style={{
                    borderColor:
                      activation === act
                        ? "var(--color-primary)"
                        : "var(--color-border)",
                    backgroundColor:
                      activation === act
                        ? "rgba(79, 143, 247, 0.15)"
                        : "transparent",
                    color:
                      activation === act
                        ? "var(--color-primary)"
                        : "var(--color-text-muted)",
                    opacity: isAutoPlaying ? 0.5 : 1,
                    cursor: isAutoPlaying ? "not-allowed" : "pointer",
                  }}
                >
                  {act}
                </button>
              ))}
            </div>
            <ActivationPreview activation={activation} />
          </Section>

          {/* Training */}
          <Section title="Training">
            <div class="mb-3">
              <div class="flex items-center justify-between">
                <span class="text-[10px] text-[var(--color-text-muted)]">
                  Learning Rate
                </span>
                <span class="text-[10px] font-semibold text-[var(--color-primary)]">
                  {learningRate.toFixed(4)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={lrToSlider(learningRate)}
                onInput={(e) =>
                  setLearningRate(
                    sliderToLr(parseInt((e.target as HTMLInputElement).value)),
                  )
                }
                class="bp-slider w-full"
              />
            </div>

            {/* Sample selector */}
            <div class="mb-3">
              <div class="flex items-center justify-between">
                <span class="text-[10px] text-[var(--color-text-muted)]">
                  Sample
                </span>
                <span class="text-[10px] font-semibold text-[var(--color-primary)]">
                  {sampleIndex + 1}/{currentPreset.inputs.length}
                </span>
              </div>
              <div class="mt-1 flex gap-1">
                {currentPreset.inputs.map((inp, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setSampleIndex(i);
                      if (phase !== PASS_PHASE.IDLE && networkRef.current) {
                        forwardPass(
                          networkRef.current,
                          currentPreset.inputs[i],
                          currentPreset.targets[i],
                        );
                        if (phase === PASS_PHASE.BACKWARD) {
                          backwardPass(networkRef.current);
                        }
                        drawNetwork();
                      }
                    }}
                    class="flex-1 rounded border px-1 py-1 text-[9px] font-mono transition-all"
                    style={{
                      borderColor:
                        sampleIndex === i
                          ? "var(--color-primary)"
                          : "var(--color-border)",
                      backgroundColor:
                        sampleIndex === i
                          ? "rgba(79, 143, 247, 0.15)"
                          : "transparent",
                      color:
                        sampleIndex === i
                          ? "var(--color-primary)"
                          : "var(--color-text-muted)",
                    }}
                    title={`Input: [${inp.join(", ")}]`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
              <div class="mt-1 text-[9px] font-mono text-[var(--color-text-muted)]">
                in: [{currentPreset.inputs[sampleIndex].join(", ")}] target: [
                {currentPreset.targets[sampleIndex].join(", ")}]
              </div>
            </div>
          </Section>

          {/* Step Controls */}
          <Section title="Step Controls">
            <div class="mb-2 flex flex-col gap-1.5">
              <button
                onClick={() => {
                  if (isAutoPlaying) return;
                  runForwardPass();
                }}
                class="w-full rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
                style={{
                  borderColor: "rgba(52, 211, 153, 0.4)",
                  color: "var(--color-accent)",
                  opacity: isAutoPlaying ? 0.4 : 1,
                }}
                disabled={isAutoPlaying}
              >
                Forward Pass
              </button>
              <button
                onClick={() => {
                  if (isAutoPlaying) return;
                  if (phase === PASS_PHASE.IDLE) runForwardPass();
                  runBackwardPass();
                }}
                class="w-full rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
                style={{
                  borderColor: "rgba(239, 68, 68, 0.4)",
                  color: "rgba(239, 68, 68, 0.9)",
                  opacity: isAutoPlaying ? 0.4 : 1,
                }}
                disabled={isAutoPlaying}
              >
                Backward Pass
              </button>
              <button
                onClick={() => {
                  if (isAutoPlaying) return;
                  if (phase !== PASS_PHASE.BACKWARD) {
                    runForwardPass();
                    runBackwardPass();
                  }
                  applyUpdate();
                }}
                class="w-full rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
                disabled={isAutoPlaying}
                style={{ opacity: isAutoPlaying ? 0.4 : 1 }}
              >
                Apply Update
              </button>
            </div>
            <div class="flex gap-1.5">
              <button
                onClick={() => {
                  if (isAutoPlaying) return;
                  fullTrainingStep();
                }}
                class="flex-1 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
                disabled={isAutoPlaying}
                style={{ opacity: isAutoPlaying ? 0.4 : 1 }}
              >
                Full Step
              </button>
              <button
                onClick={toggleAutoPlay}
                class="flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-all"
                style={{
                  backgroundColor: isAutoPlaying
                    ? "rgba(239, 68, 68, 0.8)"
                    : "var(--color-primary)",
                }}
              >
                {isAutoPlaying ? "Stop" : "Auto-Train"}
              </button>
            </div>
            <button
              onClick={() => {
                if (isAutoPlaying) {
                  autoPlayRef.current = false;
                  setIsAutoPlaying(false);
                  cancelAnimationFrame(animFrameRef.current);
                }
                initNetwork();
              }}
              class="mt-2 w-full rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
            >
              Reset Network
            </button>
          </Section>

          {/* Gradient bar toggle */}
          <label class="flex cursor-pointer items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
            <input
              type="checkbox"
              checked={showGradientBars}
              onChange={(e) =>
                setShowGradientBars((e.target as HTMLInputElement).checked)
              }
              class="accent-[var(--color-primary)]"
            />
            Show Gradient Magnitude Chart
          </label>
        </div>

        {/* Right panel: Visualization */}
        <div class="flex flex-1 flex-col">
          {/* Network canvas */}
          <div
            class="relative"
            style={{ minHeight: "320px", aspectRatio: "16/9", maxHeight: "420px" }}
          >
            <canvas
              ref={canvasRef}
              class="h-full w-full"
              style={{ display: "block" }}
            />
            {/* Legend overlay */}
            <div
              class="absolute bottom-2 right-2 flex flex-col gap-1 rounded-lg px-2.5 py-1.5"
              style={{
                backgroundColor: "rgba(0,0,0,0.5)",
                backdropFilter: "blur(4px)",
              }}
            >
              <span class="flex items-center gap-1.5 text-[9px] text-white">
                <span
                  class="inline-block h-2 w-4 rounded-sm"
                  style={{ backgroundColor: "rgba(52, 211, 153, 0.6)" }}
                />
                +weight
              </span>
              <span class="flex items-center gap-1.5 text-[9px] text-white">
                <span
                  class="inline-block h-2 w-4 rounded-sm"
                  style={{ backgroundColor: "rgba(239, 68, 68, 0.6)" }}
                />
                -weight / gradient
              </span>
            </div>
          </div>

          {/* Gradient bars */}
          {showGradientBars && (
            <div
              class="border-t border-[var(--color-border)]"
              style={{ height: "100px" }}
            >
              <canvas
                ref={gradCanvasRef}
                class="h-full w-full"
                style={{ display: "block" }}
              />
            </div>
          )}

          {/* Loss chart */}
          <div
            class="border-t border-[var(--color-border)]"
            style={{ height: "100px" }}
          >
            <canvas
              ref={lossCanvasRef}
              class="h-full w-full"
              style={{ display: "block" }}
            />
          </div>

          {/* Metrics bar */}
          <div class="flex flex-wrap items-center justify-around gap-2 border-t border-[var(--color-border)] px-4 py-3">
            <Metric
              label="Loss"
              value={
                networkRef.current && phase !== PASS_PHASE.IDLE
                  ? networkRef.current.loss.toFixed(4)
                  : "--"
              }
              color="rgba(239, 68, 68, 0.8)"
            />
            <Metric
              label="Phase"
              value={PHASE_LABELS[phase]}
              color={
                phase === PASS_PHASE.FORWARD
                  ? "rgba(52, 211, 153, 0.9)"
                  : phase === PASS_PHASE.BACKWARD
                    ? "rgba(239, 68, 68, 0.9)"
                    : "var(--color-text-muted)"
              }
            />
            <Metric label="Epoch" value={epoch.toString()} color="var(--color-primary)" />
            <Metric
              label="Layers"
              value={layerSizes.join("-")}
              color="var(--color-text-muted)"
            />
          </div>
        </div>
      </div>

      {/* Inline styles for sliders */}
      <style>{`
        .bp-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          border-radius: 2px;
          background: var(--color-border);
          outline: none;
          cursor: pointer;
        }
        .bp-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--color-primary);
          cursor: pointer;
          border: 2px solid var(--color-surface);
          box-shadow: 0 0 0 1px var(--color-primary);
        }
        .bp-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--color-primary);
          cursor: pointer;
          border: 2px solid var(--color-surface);
          box-shadow: 0 0 0 1px var(--color-primary);
        }
        .bp-slider:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}

/* ──────────────────────────────────────
   Sub-components
   ────────────────────────────────────── */

function Section({
  title,
  children,
}: {
  title: string;
  children: preact.ComponentChildren;
}) {
  return (
    <div class="mb-4">
      <h3 class="mb-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Label({ text }: { text: string }) {
  return (
    <span class="mb-1 block text-[10px] text-[var(--color-text-muted)]">
      {text}
    </span>
  );
}

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div class="text-center">
      <div class="text-[10px] text-[var(--color-text-muted)]">{label}</div>
      <div class="text-sm font-semibold" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function ActivationPreview({ activation }: { activation: ActivationType }) {
  const formula =
    activation === "relu"
      ? "f(z) = max(0, z)"
      : activation === "sigmoid"
        ? "f(z) = 1/(1+e^(-z))"
        : "f(z) = tanh(z)";

  const derivative =
    activation === "relu"
      ? "f'(z) = z>0 ? 1 : 0"
      : activation === "sigmoid"
        ? "f'(z) = f(z)(1-f(z))"
        : "f'(z) = 1-tanh(z)^2";

  return (
    <div class="mt-2 rounded-lg border border-[var(--color-border)] px-2.5 py-2">
      <div class="text-[10px] font-mono text-[var(--color-accent)]">{formula}</div>
      <div class="text-[10px] font-mono text-[var(--color-text-muted)]">
        {derivative}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────
   Helpers
   ────────────────────────────────────── */

function formatValue(v: number): string {
  if (Math.abs(v) < 0.001) return "0";
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function clampDisplay(v: number): number {
  return Math.min(1, Math.max(-1, v));
}

function lrToSlider(lr: number): number {
  const logMin = Math.log(0.001);
  const logMax = Math.log(1.0);
  return ((Math.log(lr) - logMin) / (logMax - logMin)) * 100;
}

function sliderToLr(slider: number): number {
  const logMin = Math.log(0.001);
  const logMax = Math.log(1.0);
  return Math.exp(logMin + (slider / 100) * (logMax - logMin));
}
