import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

type AudioSourceKind = "mic" | "file" | "oscillator";
type VisualizationStyle = "bars" | "line" | "mirror" | "circular";
type OscillatorWaveform = "sine" | "square" | "sawtooth" | "triangle";
type FftSize = 256 | 512 | 1024 | 2048 | 4096;

interface AudioNodes {
  context: AudioContext;
  analyser: AnalyserNode;
  gain: GainNode;
  source: AudioBufferSourceNode | MediaStreamAudioSourceNode | OscillatorNode | null;
  stream: MediaStream | null;
}

/* ══════════════════════════════════════════════════════════
   Constants
   ══════════════════════════════════════════════════════════ */

const FFT_SIZES: FftSize[] = [256, 512, 1024, 2048, 4096];
const ACCEPTED_AUDIO_TYPES = ".mp3,.wav,.ogg,.flac,.aac,.m4a,.webm";

const SPECTROGRAM_COLORS: [number, number, number][] = [
  [13, 8, 135],
  [65, 4, 157],
  [106, 0, 168],
  [143, 13, 164],
  [177, 42, 144],
  [204, 71, 120],
  [225, 100, 98],
  [242, 132, 75],
  [253, 166, 54],
  [253, 202, 39],
  [240, 249, 33],
];

/* ══════════════════════════════════════════════════════════
   Color Utilities
   ══════════════════════════════════════════════════════════ */

function spectrumColor(ratio: number): string {
  const r = Math.round(50 + 205 * ratio);
  const g = Math.round(100 * (1 - ratio * 0.6));
  const b = Math.round(255 * (1 - ratio));
  return `rgb(${r},${g},${b})`;
}

function spectrogramColor(value: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, value / 255));
  const idx = t * (SPECTROGRAM_COLORS.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, SPECTROGRAM_COLORS.length - 1);
  const frac = idx - lo;
  const cLo = SPECTROGRAM_COLORS[lo];
  const cHi = SPECTROGRAM_COLORS[hi];
  return [
    Math.round(cLo[0] + (cHi[0] - cLo[0]) * frac),
    Math.round(cLo[1] + (cHi[1] - cLo[1]) * frac),
    Math.round(cLo[2] + (cHi[2] - cLo[2]) * frac),
  ];
}

/* ══════════════════════════════════════════════════════════
   Drawing Functions (pure — take canvas context + data)
   ══════════════════════════════════════════════════════════ */

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = "var(--color-border)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = "#34d399";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();

  const sliceWidth = width / data.length;
  let x = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] / 128.0;
    const y = (v * height) / 2;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
    x += sliceWidth;
  }
  ctx.stroke();
}

function drawSpectrumBars(
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);
  const barCount = data.length;
  const barWidth = width / barCount;
  const gap = barWidth > 4 ? 1 : 0;

  for (let i = 0; i < barCount; i++) {
    const barHeight = (data[i] / 255) * height;
    const ratio = i / barCount;
    ctx.fillStyle = spectrumColor(ratio);
    ctx.fillRect(
      i * barWidth + gap,
      height - barHeight,
      barWidth - gap * 2,
      barHeight,
    );
  }
}

function drawSpectrumLine(
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);

  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "#3b82f6");
  gradient.addColorStop(0.33, "#8b5cf6");
  gradient.addColorStop(0.66, "#ef4444");
  gradient.addColorStop(1, "#f97316");

  ctx.fillStyle = gradient;
  ctx.globalAlpha = 0.15;
  ctx.beginPath();
  ctx.moveTo(0, height);
  const sliceWidth = width / data.length;
  for (let i = 0; i < data.length; i++) {
    const y = height - (data[i] / 255) * height;
    ctx.lineTo(i * sliceWidth, y);
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = gradient;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const y = height - (data[i] / 255) * height;
    if (i === 0) ctx.moveTo(0, y);
    else ctx.lineTo(i * sliceWidth, y);
  }
  ctx.stroke();
}

function drawSpectrumMirror(
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);
  const barCount = data.length;
  const barWidth = width / barCount;
  const half = height / 2;
  const gap = barWidth > 4 ? 1 : 0;

  for (let i = 0; i < barCount; i++) {
    const barHeight = (data[i] / 255) * half;
    const ratio = i / barCount;
    ctx.fillStyle = spectrumColor(ratio);
    ctx.fillRect(
      i * barWidth + gap,
      half - barHeight,
      barWidth - gap * 2,
      barHeight * 2,
    );
  }
}

function drawSpectrumCircular(
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);
  const cx = width / 2;
  const cy = height / 2;
  const baseRadius = Math.min(cx, cy) * 0.3;
  const maxBarHeight = Math.min(cx, cy) * 0.55;
  const barCount = data.length;

  for (let i = 0; i < barCount; i++) {
    const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
    const barHeight = (data[i] / 255) * maxBarHeight;
    const ratio = i / barCount;

    const x1 = cx + Math.cos(angle) * baseRadius;
    const y1 = cy + Math.sin(angle) * baseRadius;
    const x2 = cx + Math.cos(angle) * (baseRadius + barHeight);
    const y2 = cy + Math.sin(angle) * (baseRadius + barHeight);

    ctx.strokeStyle = spectrumColor(ratio);
    ctx.lineWidth = Math.max(1, (Math.PI * 2 * baseRadius) / barCount - 1);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
  ctx.stroke();
}

function drawSpectrogram(
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number,
  spectrogramBuffer: Uint8Array[],
): void {
  ctx.clearRect(0, 0, width, height);
  const columns = spectrogramBuffer.length;
  if (columns === 0) return;

  const colWidth = Math.max(1, width / columns);
  const bins = spectrogramBuffer[0].length;

  for (let col = 0; col < columns; col++) {
    const colData = spectrogramBuffer[col];
    const binHeight = height / bins;
    for (let bin = 0; bin < bins; bin++) {
      const [r, g, b] = spectrogramColor(colData[bin]);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(
        col * colWidth,
        height - (bin + 1) * binHeight,
        Math.ceil(colWidth),
        Math.ceil(binHeight),
      );
    }
  }
}

function drawFrequencyLabels(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  sampleRate: number,
  fftSize: number,
): void {
  const freqs = [100, 500, 1000, 2000, 5000, 10000, 20000];
  const maxFreq = sampleRate / 2;

  ctx.fillStyle = "var(--color-text-muted)";
  ctx.font = "10px var(--font-mono)";
  ctx.textAlign = "center";

  for (const freq of freqs) {
    if (freq > maxFreq) continue;
    const x = (freq / maxFreq) * width;
    ctx.fillText(freq >= 1000 ? `${freq / 1000}k` : `${freq}`, x, height - 2);

    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height - 14);
    ctx.stroke();
  }
}

/* ══════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════ */

export default function AudioVisualizer() {
  const [started, setStarted] = useState(false);
  const [sourceKind, setSourceKind] = useState<AudioSourceKind>("oscillator");
  const [vizStyle, setVizStyle] = useState<VisualizationStyle>("bars");
  const [fftSize, setFftSize] = useState<FftSize>(2048);
  const [smoothing, setSmoothing] = useState(0.8);
  const [gain, setGain] = useState(0.5);
  const [minDecibels, setMinDecibels] = useState(-90);
  const [maxDecibels, setMaxDecibels] = useState(-10);
  const [oscFreq, setOscFreq] = useState(440);
  const [oscWaveform, setOscWaveform] = useState<OscillatorWaveform>("sine");
  const [micActive, setMicActive] = useState(false);
  const [fileLoaded, setFileLoaded] = useState<string | null>(null);
  const [filePlaying, setFilePlaying] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [oscActive, setOscActive] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const nodesRef = useRef<AudioNodes | null>(null);
  const animFrameRef = useRef(0);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null);
  const spectrogramCanvasRef = useRef<HTMLCanvasElement>(null);
  const spectrogramBufferRef = useRef<Uint8Array[]>([]);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ──────────────────────────────────────
     Audio Context Initialization
     ────────────────────────────────────── */

  const initAudioContext = useCallback(() => {
    if (nodesRef.current) return nodesRef.current;

    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = smoothing;
    analyser.minDecibels = minDecibels;
    analyser.maxDecibels = maxDecibels;

    const gainNode = context.createGain();
    gainNode.gain.value = gain;

    analyser.connect(gainNode);

    const nodes: AudioNodes = {
      context,
      analyser,
      gain: gainNode,
      source: null,
      stream: null,
    };
    nodesRef.current = nodes;
    return nodes;
  }, []);

  /* ──────────────────────────────────────
     Cleanup
     ────────────────────────────────────── */

  const stopCurrentSource = useCallback(() => {
    const nodes = nodesRef.current;
    if (!nodes) return;

    if (nodes.source) {
      try {
        if (nodes.source instanceof OscillatorNode) {
          nodes.source.stop();
        } else if ("stop" in nodes.source && typeof nodes.source.stop === "function") {
          nodes.source.stop();
        }
        nodes.source.disconnect();
      } catch {
        // Source may already be stopped
      }
      nodes.source = null;
    }

    if (nodes.stream) {
      nodes.stream.getTracks().forEach((t) => t.stop());
      nodes.stream = null;
    }

    nodes.gain.disconnect();
    setMicActive(false);
    setFilePlaying(false);
    setOscActive(false);
    setMicError(null);
  }, []);

  /* ──────────────────────────────────────
     Source: Microphone
     ────────────────────────────────────── */

  const startMic = useCallback(async () => {
    const nodes = initAudioContext();
    stopCurrentSource();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = nodes.context.createMediaStreamSource(stream);
      source.connect(nodes.analyser);
      // Do NOT connect to destination for mic — prevents feedback
      nodes.source = source;
      nodes.stream = stream;
      setMicActive(true);
      setMicError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Microphone access denied";
      setMicError(message);
      setMicActive(false);
    }
  }, [initAudioContext, stopCurrentSource]);

  const stopMic = useCallback(() => {
    stopCurrentSource();
    setMicActive(false);
  }, [stopCurrentSource]);

  /* ──────────────────────────────────────
     Source: Audio File
     ────────────────────────────────────── */

  const loadAudioFile = useCallback(
    async (file: File) => {
      const nodes = initAudioContext();
      stopCurrentSource();

      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await nodes.context.decodeAudioData(arrayBuffer);
      audioBufferRef.current = audioBuffer;
      setFileLoaded(file.name);
      setFilePlaying(false);
    },
    [initAudioContext, stopCurrentSource],
  );

  const playFile = useCallback(() => {
    const nodes = nodesRef.current;
    const buffer = audioBufferRef.current;
    if (!nodes || !buffer) return;

    stopCurrentSource();

    const source = nodes.context.createBufferSource();
    source.buffer = buffer;
    source.connect(nodes.analyser);
    nodes.gain.connect(nodes.context.destination);
    source.start();
    nodes.source = source;
    setFilePlaying(true);

    source.onended = () => {
      setFilePlaying(false);
    };
  }, [stopCurrentSource]);

  const stopFile = useCallback(() => {
    stopCurrentSource();
    setFilePlaying(false);
  }, [stopCurrentSource]);

  /* ──────────────────────────────────────
     Source: Oscillator
     ────────────────────────────────────── */

  const startOscillator = useCallback(() => {
    const nodes = initAudioContext();
    stopCurrentSource();

    const osc = nodes.context.createOscillator();
    osc.type = oscWaveform;
    osc.frequency.value = oscFreq;
    osc.connect(nodes.analyser);
    nodes.gain.connect(nodes.context.destination);
    osc.start();
    nodes.source = osc;
    setOscActive(true);
  }, [initAudioContext, stopCurrentSource, oscFreq, oscWaveform]);

  const stopOscillator = useCallback(() => {
    stopCurrentSource();
    setOscActive(false);
  }, [stopCurrentSource]);

  /* ──────────────────────────────────────
     Analyser Updates
     ────────────────────────────────────── */

  useEffect(() => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.analyser.fftSize = fftSize;
  }, [fftSize]);

  useEffect(() => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.analyser.smoothingTimeConstant = smoothing;
  }, [smoothing]);

  useEffect(() => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.gain.gain.value = gain;
  }, [gain]);

  useEffect(() => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.analyser.minDecibels = minDecibels;
    nodes.analyser.maxDecibels = maxDecibels;
  }, [minDecibels, maxDecibels]);

  useEffect(() => {
    const nodes = nodesRef.current;
    if (!nodes || !oscActive) return;
    if (nodes.source instanceof OscillatorNode) {
      nodes.source.frequency.value = oscFreq;
    }
  }, [oscFreq, oscActive]);

  useEffect(() => {
    const nodes = nodesRef.current;
    if (!nodes || !oscActive) return;
    if (nodes.source instanceof OscillatorNode) {
      nodes.source.type = oscWaveform;
    }
  }, [oscWaveform, oscActive]);

  /* ──────────────────────────────────────
     Animation Loop
     ────────────────────────────────────── */

  useEffect(() => {
    if (!started) return;

    const isActive = micActive || filePlaying || oscActive;
    if (!isActive) return;

    const nodes = nodesRef.current;
    if (!nodes) return;

    const bufferLength = nodes.analyser.frequencyBinCount;
    const timeDomainData = new Uint8Array(bufferLength);
    const frequencyData = new Uint8Array(bufferLength);
    const maxSpectrogramCols = 200;

    const animate = () => {
      nodes.analyser.getByteTimeDomainData(timeDomainData);
      nodes.analyser.getByteFrequencyData(frequencyData);

      // Waveform
      const wCtx = waveformCanvasRef.current?.getContext("2d");
      if (wCtx && waveformCanvasRef.current) {
        const w = waveformCanvasRef.current.width;
        const h = waveformCanvasRef.current.height;
        drawWaveform(wCtx, timeDomainData, w, h);
      }

      // Spectrum
      const sCtx = spectrumCanvasRef.current?.getContext("2d");
      if (sCtx && spectrumCanvasRef.current) {
        const w = spectrumCanvasRef.current.width;
        const h = spectrumCanvasRef.current.height;
        if (vizStyle === "bars") {
          drawSpectrumBars(sCtx, frequencyData, w, h);
        } else if (vizStyle === "line") {
          drawSpectrumLine(sCtx, frequencyData, w, h);
        } else if (vizStyle === "mirror") {
          drawSpectrumMirror(sCtx, frequencyData, w, h);
        } else {
          drawSpectrumCircular(sCtx, frequencyData, w, h);
        }
        drawFrequencyLabels(
          sCtx,
          w,
          h,
          nodes.context.sampleRate,
          nodes.analyser.fftSize,
        );
      }

      // Spectrogram
      const sgCtx = spectrogramCanvasRef.current?.getContext("2d");
      if (sgCtx && spectrogramCanvasRef.current) {
        const col = new Uint8Array(frequencyData);
        spectrogramBufferRef.current.push(col);
        if (spectrogramBufferRef.current.length > maxSpectrogramCols) {
          spectrogramBufferRef.current.shift();
        }
        const w = spectrogramCanvasRef.current.width;
        const h = spectrogramCanvasRef.current.height;
        drawSpectrogram(sgCtx, frequencyData, w, h, spectrogramBufferRef.current);
      }

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [started, micActive, filePlaying, oscActive, vizStyle]);

  /* ──────────────────────────────────────
     Canvas Resize
     ────────────────────────────────────── */

  useEffect(() => {
    if (typeof window === "undefined") return;

    const resize = () => {
      const canvases = [
        waveformCanvasRef.current,
        spectrumCanvasRef.current,
        spectrogramCanvasRef.current,
      ];
      for (const canvas of canvases) {
        if (!canvas) continue;
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.scale(dpr, dpr);
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
      }
    };

    const timer = setTimeout(resize, 50);
    window.addEventListener("resize", resize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", resize);
    };
  }, [started]);

  /* ──────────────────────────────────────
     Cleanup on Unmount
     ────────────────────────────────────── */

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      const nodes = nodesRef.current;
      if (nodes) {
        if (nodes.source) {
          try {
            if ("stop" in nodes.source && typeof nodes.source.stop === "function") {
              nodes.source.stop();
            }
            nodes.source.disconnect();
          } catch {
            // Already stopped
          }
        }
        if (nodes.stream) {
          nodes.stream.getTracks().forEach((t) => t.stop());
        }
        nodes.context.close();
      }
    };
  }, []);

  /* ──────────────────────────────────────
     File Drop Handler
     ────────────────────────────────────── */

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith("audio/")) {
        loadAudioFile(file);
      }
    },
    [loadAudioFile],
  );

  const handleFileInput = useCallback(
    (e: Event) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (file) loadAudioFile(file);
    },
    [loadAudioFile],
  );

  /* ──────────────────────────────────────
     Format helpers
     ────────────────────────────────────── */

  const formatFreq = (hz: number): string => {
    if (hz >= 1000) return `${(hz / 1000).toFixed(1)} kHz`;
    return `${hz} Hz`;
  };

  /* ──────────────────────────────────────
     Start screen (user gesture requirement)
     ────────────────────────────────────── */

  if (!started) {
    return (
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "12px",
          padding: "48px 24px",
          textAlign: "center",
          background: "var(--color-surface)",
        }}
      >
        <div style={{ fontSize: "48px", marginBottom: "16px" }}>&#9835;</div>
        <h2
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "1.5rem",
            fontWeight: 700,
            textTransform: "uppercase",
            color: "var(--color-heading)",
            marginBottom: "12px",
          }}
        >
          Audio Visualizer
        </h2>
        <p
          style={{
            color: "var(--color-text-muted)",
            fontSize: "0.875rem",
            marginBottom: "24px",
            maxWidth: "400px",
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          Visualize audio in real-time with waveforms, frequency spectra, and spectrograms.
          Click below to initialize the audio engine.
        </p>
        <button
          onClick={() => setStarted(true)}
          style={{
            background: "var(--color-primary)",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            padding: "12px 32px",
            fontSize: "1rem",
            fontWeight: 600,
            cursor: "pointer",
            transition: "opacity 0.2s",
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLButtonElement).style.opacity = "0.85";
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLButtonElement).style.opacity = "1";
          }}
        >
          Click to Start
        </button>
      </div>
    );
  }

  /* ──────────────────────────────────────
     Active Audio Check
     ────────────────────────────────────── */

  const isActive = micActive || filePlaying || oscActive;

  /* ──────────────────────────────────────
     Render
     ────────────────────────────────────── */

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Source Selector */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "8px",
          padding: "12px 16px",
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "10px",
        }}
      >
        <SourceTab
          label="Mic"
          icon="&#127908;"
          active={sourceKind === "mic"}
          onClick={() => setSourceKind("mic")}
        />
        <SourceTab
          label="File"
          icon="&#128193;"
          active={sourceKind === "file"}
          onClick={() => setSourceKind("file")}
        />
        <SourceTab
          label="Oscillator"
          icon="&#128266;"
          active={sourceKind === "oscillator"}
          onClick={() => setSourceKind("oscillator")}
        />
      </div>

      {/* Source Controls */}
      <div
        style={{
          padding: "16px",
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "10px",
        }}
      >
        {sourceKind === "mic" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <button
                onClick={micActive ? stopMic : startMic}
                style={{
                  background: micActive ? "#ef4444" : "var(--color-primary)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  padding: "8px 20px",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {micActive ? "Stop Mic" : "Start Mic"}
              </button>
              {micActive && (
                <span style={{ color: "#34d399", fontSize: "0.8rem", fontWeight: 600 }}>
                  &#9679; Listening
                </span>
              )}
            </div>
            {micError && (
              <p style={{ color: "#ef4444", fontSize: "0.8rem", margin: 0 }}>{micError}</p>
            )}
          </div>
        )}

        {sourceKind === "file" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? "var(--color-primary)" : "var(--color-border)"}`,
                borderRadius: "8px",
                padding: "24px",
                textAlign: "center",
                cursor: "pointer",
                transition: "border-color 0.2s",
                background: dragOver
                  ? "color-mix(in srgb, var(--color-primary) 5%, transparent)"
                  : "transparent",
              }}
            >
              <p style={{ color: "var(--color-text-muted)", fontSize: "0.875rem", margin: 0 }}>
                {fileLoaded
                  ? `Loaded: ${fileLoaded}`
                  : "Drop an audio file here or click to browse"}
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_AUDIO_TYPES}
              onChange={handleFileInput}
              style={{ display: "none" }}
            />
            {fileLoaded && (
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={filePlaying ? stopFile : playFile}
                  style={{
                    background: filePlaying ? "#ef4444" : "#34d399",
                    color: filePlaying ? "#fff" : "#000",
                    border: "none",
                    borderRadius: "6px",
                    padding: "8px 20px",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {filePlaying ? "Stop" : "Play"}
                </button>
              </div>
            )}
          </div>
        )}

        {sourceKind === "oscillator" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              <button
                onClick={oscActive ? stopOscillator : startOscillator}
                style={{
                  background: oscActive ? "#ef4444" : "var(--color-primary)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  padding: "8px 20px",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {oscActive ? "Stop" : "Play Tone"}
              </button>
              {oscActive && (
                <span style={{ color: "#34d399", fontSize: "0.8rem", fontWeight: 600 }}>
                  &#9679; Playing
                </span>
              )}
            </div>

            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "end" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "4px", flex: "1 1 200px" }}>
                <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>
                  Frequency: {formatFreq(oscFreq)}
                </span>
                <input
                  type="range"
                  min={20}
                  max={20000}
                  step={1}
                  value={oscFreq}
                  onInput={(e) => setOscFreq(Number((e.target as HTMLInputElement).value))}
                  style={{ accentColor: "var(--color-primary)" }}
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>
                  Waveform
                </span>
                <select
                  value={oscWaveform}
                  onChange={(e) =>
                    setOscWaveform((e.target as HTMLSelectElement).value as OscillatorWaveform)
                  }
                  style={{
                    background: "var(--color-bg)",
                    color: "var(--color-text)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "6px",
                    padding: "6px 10px",
                    fontSize: "0.8rem",
                  }}
                >
                  <option value="sine">Sine</option>
                  <option value="square">Square</option>
                  <option value="sawtooth">Sawtooth</option>
                  <option value="triangle">Triangle</option>
                </select>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Visualization Canvases */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {/* Waveform */}
        <CanvasPanel label="Waveform" sublabel="Time Domain">
          <canvas
            ref={waveformCanvasRef}
            style={{
              width: "100%",
              height: "140px",
              display: "block",
              borderRadius: "6px",
            }}
          />
          {!isActive && <CanvasPlaceholder text="Start an audio source to see the waveform" />}
        </CanvasPanel>

        {/* Frequency Spectrum */}
        <CanvasPanel label="Frequency Spectrum" sublabel="FFT">
          <canvas
            ref={spectrumCanvasRef}
            style={{
              width: "100%",
              height: "180px",
              display: "block",
              borderRadius: "6px",
            }}
          />
          {!isActive && <CanvasPlaceholder text="Start an audio source to see the spectrum" />}
        </CanvasPanel>

        {/* Spectrogram */}
        <CanvasPanel label="Spectrogram" sublabel="Waterfall">
          <canvas
            ref={spectrogramCanvasRef}
            style={{
              width: "100%",
              height: "160px",
              display: "block",
              borderRadius: "6px",
            }}
          />
          {!isActive && (
            <CanvasPlaceholder text="Start an audio source to see the spectrogram" />
          )}
        </CanvasPanel>
      </div>

      {/* Controls */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "16px",
          padding: "16px",
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "10px",
        }}
      >
        {/* FFT Size */}
        <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>FFT Size</span>
          <select
            value={fftSize}
            onChange={(e) => setFftSize(Number((e.target as HTMLSelectElement).value) as FftSize)}
            style={{
              background: "var(--color-bg)",
              color: "var(--color-text)",
              border: "1px solid var(--color-border)",
              borderRadius: "6px",
              padding: "6px 10px",
              fontSize: "0.8rem",
            }}
          >
            {FFT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        {/* Smoothing */}
        <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>
            Smoothing: {smoothing.toFixed(2)}
          </span>
          <input
            type="range"
            min={0}
            max={0.95}
            step={0.05}
            value={smoothing}
            onInput={(e) => setSmoothing(Number((e.target as HTMLInputElement).value))}
            style={{ accentColor: "var(--color-primary)" }}
          />
        </label>

        {/* Gain */}
        <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>
            Volume: {Math.round(gain * 100)}%
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={gain}
            onInput={(e) => setGain(Number((e.target as HTMLInputElement).value))}
            style={{ accentColor: "var(--color-accent)" }}
          />
        </label>

        {/* Min Decibels */}
        <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>
            Min dB: {minDecibels}
          </span>
          <input
            type="range"
            min={-120}
            max={-30}
            step={1}
            value={minDecibels}
            onInput={(e) => setMinDecibels(Number((e.target as HTMLInputElement).value))}
            style={{ accentColor: "var(--color-primary)" }}
          />
        </label>

        {/* Max Decibels */}
        <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>
            Max dB: {maxDecibels}
          </span>
          <input
            type="range"
            min={-60}
            max={0}
            step={1}
            value={maxDecibels}
            onInput={(e) => setMaxDecibels(Number((e.target as HTMLInputElement).value))}
            style={{ accentColor: "var(--color-primary)" }}
          />
        </label>

        {/* Visualization Style */}
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>
            Spectrum Style
          </span>
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
            {(["bars", "line", "mirror", "circular"] as VisualizationStyle[]).map((style) => (
              <button
                key={style}
                onClick={() => setVizStyle(style)}
                style={{
                  background:
                    vizStyle === style
                      ? "var(--color-primary)"
                      : "var(--color-bg)",
                  color:
                    vizStyle === style ? "#fff" : "var(--color-text-muted)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "4px",
                  padding: "4px 10px",
                  fontSize: "0.75rem",
                  fontWeight: vizStyle === style ? 600 : 400,
                  cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {style}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Sub-components
   ══════════════════════════════════════════════════════════ */

function SourceTab({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        background: active ? "var(--color-primary)" : "transparent",
        color: active ? "#fff" : "var(--color-text-muted)",
        border: active ? "none" : "1px solid var(--color-border)",
        borderRadius: "6px",
        padding: "8px 16px",
        fontSize: "0.875rem",
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
        transition: "all 0.2s",
      }}
    >
      <span dangerouslySetInnerHTML={{ __html: icon }} />
      {label}
    </button>
  );
}

function CanvasPanel({
  label,
  sublabel,
  children,
}: {
  label: string;
  sublabel: string;
  children: preact.ComponentChildren;
}) {
  return (
    <div
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "10px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 12px",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <span
          style={{
            color: "var(--color-heading)",
            fontSize: "0.8rem",
            fontWeight: 600,
          }}
        >
          {label}
        </span>
        <span
          style={{
            color: "var(--color-text-muted)",
            fontSize: "0.7rem",
            fontFamily: "var(--font-mono)",
          }}
        >
          {sublabel}
        </span>
      </div>
      <div style={{ position: "relative", padding: "8px" }}>{children}</div>
    </div>
  );
}

function CanvasPlaceholder({ text }: { text: string }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <span style={{ color: "var(--color-text-muted)", fontSize: "0.8rem", opacity: 0.6 }}>
        {text}
      </span>
    </div>
  );
}
