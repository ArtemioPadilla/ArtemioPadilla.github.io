import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type DistId = "uniform" | "exponential" | "bimodal" | "skewed" | "discrete" | "custom";

interface DistConfig {
  id: DistId;
  label: string;
  description: string;
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const DISTRIBUTIONS: DistConfig[] = [
  { id: "uniform", label: "Uniform", description: "Equal probability across [0, 1]" },
  { id: "exponential", label: "Exponential", description: "Right-skewed, rate = 1" },
  { id: "bimodal", label: "Bimodal", description: "Mixture of two normals" },
  { id: "skewed", label: "Skewed (Chi-squared)", description: "Right-skewed, df = 3" },
  { id: "discrete", label: "Discrete (Die)", description: "Uniform integers 1-6" },
  { id: "custom", label: "Custom (Draw)", description: "Click to draw your own PDF" },
];

const SAMPLE_SIZES = [1, 2, 5, 10, 30, 50, 100];

const N_OVERLAY_COLORS = [
  "#4f8ff7", "#34d399", "#f59e0b", "#ef4444", "#a78bfa",
];

// ─────────────────────────────────────────────────────────────
// Random samplers
// ─────────────────────────────────────────────────────────────

function randNormal(mu: number, sigma: number): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function sampleFromDist(dist: DistId, customPdf: number[]): number {
  switch (dist) {
    case "uniform":
      return Math.random();
    case "exponential":
      return -Math.log(1 - Math.random());
    case "bimodal":
      return Math.random() < 0.5
        ? randNormal(-2, 0.8)
        : randNormal(2, 0.8);
    case "skewed": {
      let sum = 0;
      for (let i = 0; i < 3; i++) {
        const z = randNormal(0, 1);
        sum += z * z;
      }
      return sum;
    }
    case "discrete":
      return Math.floor(Math.random() * 6) + 1;
    case "custom":
      return sampleFromCustomPdf(customPdf);
    default:
      return Math.random();
  }
}

function sampleFromCustomPdf(pdf: number[]): number {
  const total = pdf.reduce((a, b) => a + b, 0);
  if (total === 0) return Math.random();
  const r = Math.random() * total;
  let cum = 0;
  for (let i = 0; i < pdf.length; i++) {
    cum += pdf[i];
    if (r <= cum) {
      return (i + Math.random()) / pdf.length;
    }
  }
  return Math.random();
}

function getDistRange(dist: DistId): [number, number] {
  switch (dist) {
    case "uniform": return [0, 1];
    case "exponential": return [0, 6];
    case "bimodal": return [-5, 5];
    case "skewed": return [0, 15];
    case "discrete": return [0.5, 6.5];
    case "custom": return [0, 1];
    default: return [0, 1];
  }
}

function computeDistStats(dist: DistId, customPdf: number[]): { mean: number; variance: number; skewness: number } {
  switch (dist) {
    case "uniform":
      return { mean: 0.5, variance: 1 / 12, skewness: 0 };
    case "exponential":
      return { mean: 1, variance: 1, skewness: 2 };
    case "bimodal":
      return { mean: 0, variance: 0.64 + 4, skewness: 0 };
    case "skewed":
      return { mean: 3, variance: 6, skewness: 2 * Math.sqrt(2 / 3) };
    case "discrete":
      return { mean: 3.5, variance: 35 / 12, skewness: 0 };
    case "custom": {
      const total = customPdf.reduce((a, b) => a + b, 0);
      if (total === 0) return { mean: 0.5, variance: 1 / 12, skewness: 0 };
      const n = customPdf.length;
      let m1 = 0, m2 = 0, m3 = 0;
      for (let i = 0; i < n; i++) {
        const x = (i + 0.5) / n;
        const p = customPdf[i] / total;
        m1 += x * p;
      }
      for (let i = 0; i < n; i++) {
        const x = (i + 0.5) / n;
        const p = customPdf[i] / total;
        m2 += (x - m1) ** 2 * p;
        m3 += (x - m1) ** 3 * p;
      }
      const skew = m2 > 0 ? m3 / Math.pow(m2, 1.5) : 0;
      return { mean: m1, variance: m2, skewness: skew };
    }
    default:
      return { mean: 0, variance: 1, skewness: 0 };
  }
}

function getTheoreticalPdf(dist: DistId, x: number, customPdf: number[]): number {
  switch (dist) {
    case "uniform":
      return x >= 0 && x <= 1 ? 1 : 0;
    case "exponential":
      return x >= 0 ? Math.exp(-x) : 0;
    case "bimodal": {
      const g = (x: number, m: number, s: number) =>
        Math.exp(-0.5 * ((x - m) / s) ** 2) / (s * Math.sqrt(2 * Math.PI));
      return 0.5 * g(x, -2, 0.8) + 0.5 * g(x, 2, 0.8);
    }
    case "skewed": {
      if (x <= 0) return 0;
      const k = 3 / 2;
      return (Math.pow(x, k - 1) * Math.exp(-x / 2)) / (Math.pow(2, k) * gamma(k));
    }
    case "discrete": {
      const ix = Math.round(x);
      return ix >= 1 && ix <= 6 && Math.abs(x - ix) < 0.5 ? 1 / 6 : 0;
    }
    case "custom": {
      const n = customPdf.length;
      const total = customPdf.reduce((a, b) => a + b, 0);
      if (total === 0) return 1;
      const idx = Math.floor(x * n);
      if (idx < 0 || idx >= n) return 0;
      return (customPdf[idx] / total) * n;
    }
    default:
      return 0;
  }
}

function gamma(z: number): number {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

function normalPdf(x: number, mu: number, sigma: number): number {
  if (sigma <= 0) return 0;
  return Math.exp(-0.5 * ((x - mu) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI));
}

function resolveColor(el: HTMLElement | null, varName: string, fallback: string): string {
  if (!el) return fallback;
  return getComputedStyle(el).getPropertyValue(varName).trim() || fallback;
}

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────

export default function CentralLimit() {
  // State
  const [distId, setDistId] = useState<DistId>("uniform");
  const [sampleSize, setSampleSize] = useState(30);
  const [sampleMeans, setSampleMeans] = useState<number[]>([]);
  const [currentSample, setCurrentSample] = useState<number[]>([]);
  const [autoSampling, setAutoSampling] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [showOverlay, setShowOverlay] = useState(true);
  const [showPoints, setShowPoints] = useState(true);
  const [customPdf, setCustomPdf] = useState<number[]>(Array(50).fill(1));
  const [nCompare, setNCompare] = useState<number[]>([]);
  const [nCompareData, setNCompareData] = useState<Record<number, number[]>>({});

  // Refs
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null);
  const samplingCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoRef = useRef(false);
  const animRef = useRef<number>(0);
  const meansRef = useRef(sampleMeans);
  const customPdfRef = useRef(customPdf);
  const isDrawingRef = useRef(false);

  useEffect(() => { meansRef.current = sampleMeans; }, [sampleMeans]);
  useEffect(() => { autoRef.current = autoSampling; }, [autoSampling]);
  useEffect(() => { customPdfRef.current = customPdf; }, [customPdf]);

  const distStats = useMemo(
    () => computeDistStats(distId, customPdf),
    [distId, customPdf]
  );

  const [sourceRange] = useMemo(() => [getDistRange(distId)], [distId]);

  // Reset when distribution or sample size changes
  useEffect(() => {
    setSampleMeans([]);
    setCurrentSample([]);
    setAutoSampling(false);
    setNCompare([]);
    setNCompareData({});
    cancelAnimationFrame(animRef.current);
  }, [distId, sampleSize]);

  // ─── Drawing source distribution ──────────────────────

  const drawSource = useCallback(() => {
    const canvas = sourceCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const container = containerRef.current;
    const w = container ? container.clientWidth : 500;
    const h = 200;
    canvas.width = w * 2;
    canvas.height = h * 2;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(2, 2);

    const bgColor = resolveColor(canvas, "--color-bg", "#09090b");
    const textColor = resolveColor(canvas, "--color-text-muted", "#a1a1aa");
    const primaryColor = resolveColor(canvas, "--color-primary", "#4f8ff7");
    const accentColor = resolveColor(canvas, "--color-accent", "#34d399");
    const borderColor = resolveColor(canvas, "--color-border", "#27272a");
    const headingColor = resolveColor(canvas, "--color-heading", "#fff");

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    const pad = { left: 45, right: 15, top: 20, bottom: 30 };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;
    const [xMin, xMax] = sourceRange;

    // Compute PDF values for plotting
    const steps = 200;
    let maxPdf = 0;
    const pdfVals: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const x = xMin + (xMax - xMin) * (i / steps);
      const y = getTheoreticalPdf(distId, x, customPdfRef.current);
      pdfVals.push(y);
      if (y > maxPdf) maxPdf = y;
    }
    maxPdf = Math.max(maxPdf, 0.1) * 1.15;

    // Grid
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 0.5;
    ctx.font = "10px Inter, sans-serif";
    ctx.fillStyle = textColor;
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + chartH * (1 - i / 4);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      ctx.fillText((maxPdf * i / 4).toFixed(2), pad.left - 4, y + 3);
    }

    // X labels
    ctx.textAlign = "center";
    for (let i = 0; i <= 5; i++) {
      const xVal = xMin + (xMax - xMin) * (i / 5);
      const x = pad.left + chartW * (i / 5);
      ctx.fillText(xVal.toFixed(1), x, h - pad.bottom + 14);
    }

    // PDF curve
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const x = pad.left + chartW * (i / steps);
      const y = pad.top + chartH * (1 - pdfVals[i] / maxPdf);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Fill under curve
    ctx.fillStyle = primaryColor;
    ctx.globalAlpha = 0.1;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top + chartH);
    for (let i = 0; i <= steps; i++) {
      const x = pad.left + chartW * (i / steps);
      const y = pad.top + chartH * (1 - pdfVals[i] / maxPdf);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(pad.left + chartW, pad.top + chartH);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // Show current sample points on source
    if (showPoints && currentSample.length > 0) {
      ctx.fillStyle = accentColor;
      ctx.globalAlpha = 0.7;
      for (const val of currentSample) {
        const xFrac = (val - xMin) / (xMax - xMin);
        if (xFrac < 0 || xFrac > 1) continue;
        const x = pad.left + xFrac * chartW;
        ctx.beginPath();
        ctx.arc(x, pad.top + chartH - 4, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Mean indicator
    if (currentSample.length > 0) {
      const mean = currentSample.reduce((a, b) => a + b, 0) / currentSample.length;
      const xFrac = (mean - xMin) / (xMax - xMin);
      const x = pad.left + xFrac * chartW;
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + chartH);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = accentColor;
      ctx.font = "bold 10px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`x\u0304 = ${mean.toFixed(3)}`, x, pad.top - 5);
    }

    // Title
    ctx.fillStyle = headingColor;
    ctx.font = "bold 12px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Source Distribution", pad.left, 14);
  }, [distId, sourceRange, currentSample, showPoints, customPdf]);

  // ─── Drawing sampling distribution ─────────────────────

  const drawSampling = useCallback(() => {
    const canvas = samplingCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const container = containerRef.current;
    const w = container ? container.clientWidth : 500;
    const h = 250;
    canvas.width = w * 2;
    canvas.height = h * 2;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(2, 2);

    const bgColor = resolveColor(canvas, "--color-bg", "#09090b");
    const textColor = resolveColor(canvas, "--color-text-muted", "#a1a1aa");
    const primaryColor = resolveColor(canvas, "--color-primary", "#4f8ff7");
    const accentColor = resolveColor(canvas, "--color-accent", "#34d399");
    const borderColor = resolveColor(canvas, "--color-border", "#27272a");
    const headingColor = resolveColor(canvas, "--color-heading", "#fff");

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    const pad = { left: 45, right: 15, top: 20, bottom: 30 };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;

    const means = meansRef.current;
    const mu = distStats.mean;
    const sigmaBar = Math.sqrt(distStats.variance / sampleSize);

    // Range for histogram
    const xCenter = mu;
    const xSpread = Math.max(sigmaBar * 5, 0.5);
    const xMin = xCenter - xSpread;
    const xMax = xCenter + xSpread;

    // Build histogram bins
    const numBins = Math.min(80, Math.max(20, Math.floor(Math.sqrt(means.length))));
    const binWidth = (xMax - xMin) / numBins;
    const bins = new Array(numBins).fill(0);

    for (const m of means) {
      const idx = Math.floor((m - xMin) / binWidth);
      if (idx >= 0 && idx < numBins) bins[idx]++;
    }

    // Normalize to density
    const totalArea = means.length * binWidth;
    const maxBinDensity = totalArea > 0
      ? Math.max(...bins.map((b) => b / totalArea))
      : 0;

    // Normal overlay max
    const normalMax = normalPdf(mu, mu, sigmaBar);
    const yMax = Math.max(maxBinDensity, normalMax) * 1.2 || 1;

    // Grid
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 0.5;
    ctx.font = "10px Inter, sans-serif";
    ctx.fillStyle = textColor;
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + chartH * (1 - i / 4);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      ctx.fillText((yMax * i / 4).toFixed(2), pad.left - 4, y + 3);
    }

    ctx.textAlign = "center";
    for (let i = 0; i <= 5; i++) {
      const xVal = xMin + (xMax - xMin) * (i / 5);
      const x = pad.left + chartW * (i / 5);
      ctx.fillText(xVal.toFixed(2), x, h - pad.bottom + 14);
    }

    // Histogram bars
    ctx.fillStyle = primaryColor;
    ctx.globalAlpha = 0.6;
    for (let i = 0; i < numBins; i++) {
      if (bins[i] === 0) continue;
      const density = bins[i] / totalArea;
      const x = pad.left + (i / numBins) * chartW;
      const barW = chartW / numBins;
      const barH = (density / yMax) * chartH;
      ctx.fillRect(x, pad.top + chartH - barH, barW - 1, barH);
    }
    ctx.globalAlpha = 1;

    // N-comparison overlays
    if (nCompare.length > 0) {
      nCompare.forEach((n, idx) => {
        const data = nCompareData[n] || [];
        if (data.length === 0) return;
        const color = N_OVERLAY_COLORS[idx % N_OVERLAY_COLORS.length];
        const sigN = Math.sqrt(distStats.variance / n);

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        for (let i = 0; i <= 200; i++) {
          const xVal = xMin + (xMax - xMin) * (i / 200);
          const y = normalPdf(xVal, mu, sigN);
          const px = pad.left + (i / 200) * chartW;
          const py = pad.top + chartH * (1 - y / yMax);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
    }

    // Normal overlay
    if (showOverlay && sigmaBar > 0) {
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 200; i++) {
        const xVal = xMin + (xMax - xMin) * (i / 200);
        const y = normalPdf(xVal, mu, sigmaBar);
        const px = pad.left + (i / 200) * chartW;
        const py = pad.top + chartH * (1 - y / yMax);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Current sample mean indicator
    if (currentSample.length > 0) {
      const mean = currentSample.reduce((a, b) => a + b, 0) / currentSample.length;
      const xFrac = (mean - xMin) / (xMax - xMin);
      if (xFrac >= 0 && xFrac <= 1) {
        const x = pad.left + xFrac * chartW;
        ctx.fillStyle = accentColor;
        ctx.beginPath();
        ctx.moveTo(x, pad.top + chartH + 2);
        ctx.lineTo(x - 6, pad.top + chartH + 12);
        ctx.lineTo(x + 6, pad.top + chartH + 12);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Title
    ctx.fillStyle = headingColor;
    ctx.font = "bold 12px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Sampling Distribution of the Mean", pad.left, 14);

    // Legend
    const legendX = w - 180;
    let legendY = 10;
    ctx.font = "10px Inter, sans-serif";

    ctx.fillStyle = primaryColor;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(legendX, legendY, 10, 10);
    ctx.globalAlpha = 1;
    ctx.fillStyle = headingColor;
    ctx.textAlign = "left";
    ctx.fillText("Histogram", legendX + 14, legendY + 9);
    legendY += 16;

    if (showOverlay) {
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(legendX, legendY + 5);
      ctx.lineTo(legendX + 10, legendY + 5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = headingColor;
      ctx.fillText(`N(\u03BC, \u03C3\u00B2/${sampleSize})`, legendX + 14, legendY + 9);
    }
  }, [distStats, sampleSize, showOverlay, currentSample, nCompare, nCompareData, sampleMeans]);

  // ─── Draw on state changes ─────────────────────────────

  useEffect(() => { drawSource(); }, [drawSource]);
  useEffect(() => { drawSampling(); }, [drawSampling]);

  // ─── Sampling logic ────────────────────────────────────

  const drawOneSample = useCallback(() => {
    const sample = Array.from({ length: sampleSize }, () =>
      sampleFromDist(distId, customPdfRef.current)
    );
    const mean = sample.reduce((a, b) => a + b, 0) / sample.length;
    setCurrentSample(sample);
    setSampleMeans((prev) => [...prev, mean]);
  }, [distId, sampleSize]);

  // Auto-sampling loop
  useEffect(() => {
    if (!autoSampling) return;

    let cancelled = false;
    const step = () => {
      if (cancelled || !autoRef.current) return;

      for (let i = 0; i < speed; i++) {
        const sample = Array.from({ length: sampleSize }, () =>
          sampleFromDist(distId, customPdfRef.current)
        );
        const mean = sample.reduce((a, b) => a + b, 0) / sample.length;
        meansRef.current = [...meansRef.current, mean];
        if (i === speed - 1) {
          setCurrentSample(sample);
        }
      }
      setSampleMeans([...meansRef.current]);

      if (meansRef.current.length >= 10000) {
        setAutoSampling(false);
        return;
      }

      animRef.current = requestAnimationFrame(step);
    };

    animRef.current = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(animRef.current);
    };
  }, [autoSampling, speed, distId, sampleSize]);

  const resetSamples = useCallback(() => {
    setSampleMeans([]);
    setCurrentSample([]);
    meansRef.current = [];
    setAutoSampling(false);
    setNCompare([]);
    setNCompareData({});
    cancelAnimationFrame(animRef.current);
  }, []);

  // ─── N-comparison ──────────────────────────────────────

  const toggleNCompare = useCallback((n: number) => {
    setNCompare((prev) => {
      if (prev.includes(n)) return prev.filter((v) => v !== n);
      return [...prev, n];
    });

    setNCompareData((prev) => {
      if (prev[n]) return prev;
      const data: number[] = [];
      for (let i = 0; i < 2000; i++) {
        const sample = Array.from({ length: n }, () =>
          sampleFromDist(distId, customPdfRef.current)
        );
        data.push(sample.reduce((a, b) => a + b, 0) / sample.length);
      }
      return { ...prev, [n]: data };
    });
  }, [distId]);

  // ─── Custom PDF drawing ────────────────────────────────

  const handleCustomDraw = useCallback((e: MouseEvent) => {
    const canvas = sourceCanvasRef.current;
    if (!canvas || distId !== "custom") return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = 1 - (e.clientY - rect.top) / rect.height;

    if (x < 0.09 || x > 0.97 || y < 0.15 || y > 0.9) return;

    const idx = Math.floor(((x - 0.09) / 0.88) * customPdf.length);
    const val = Math.max(0, Math.min(5, (y - 0.15) / 0.75 * 5));
    if (idx >= 0 && idx < customPdf.length) {
      setCustomPdf((prev) => {
        const next = [...prev];
        next[idx] = val;
        return next;
      });
    }
  }, [distId, customPdf.length]);

  // ─── Computed stats for sampling distribution ──────────

  const samplingStats = useMemo(() => {
    if (sampleMeans.length === 0) return null;
    const mean = sampleMeans.reduce((a, b) => a + b, 0) / sampleMeans.length;
    const variance = sampleMeans.reduce((a, b) => a + (b - mean) ** 2, 0) / sampleMeans.length;
    const sd = Math.sqrt(variance);
    const expectedSd = Math.sqrt(distStats.variance / sampleSize);
    return { mean, sd, expectedSd, count: sampleMeans.length };
  }, [sampleMeans, distStats, sampleSize]);

  // ─── Styles ────────────────────────────────────────────

  const containerStyle = {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: 12,
    padding: 20,
    color: "var(--color-text)",
    fontFamily: "var(--font-sans)",
  };

  const btnStyle = (active = false) => ({
    padding: "6px 14px",
    borderRadius: 6,
    border: "1px solid var(--color-border)",
    background: active ? "var(--color-primary)" : "var(--color-surface)",
    color: active ? "#fff" : "var(--color-text)",
    cursor: "pointer" as const,
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    transition: "all 0.15s",
  });

  const labelStyle = {
    fontSize: 12,
    color: "var(--color-text-muted)",
    marginBottom: 4,
    display: "block" as const,
  };

  const sectionTitle = {
    fontSize: 15,
    fontWeight: 600,
    color: "var(--color-heading)",
    marginBottom: 10,
  };

  const statBox = {
    textAlign: "center" as const,
    flex: 1,
    minWidth: 100,
    padding: "8px 4px",
  };

  return (
    <div style={containerStyle}>
      {/* ─── Source Distribution Selection ─── */}
      <div style={sectionTitle}>Source Distribution</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {DISTRIBUTIONS.map((d) => (
          <button
            key={d.id}
            style={btnStyle(distId === d.id)}
            onClick={() => setDistId(d.id)}
            title={d.description}
          >
            {d.label}
          </button>
        ))}
      </div>

      {distId === "custom" && (
        <div style={{
          fontSize: 12, color: "var(--color-accent)",
          marginBottom: 8, padding: "6px 10px",
          background: "var(--color-bg)", borderRadius: 6,
          border: "1px solid var(--color-border)",
        }}>
          Click and drag on the chart below to draw your custom distribution shape.
        </div>
      )}

      {/* Source stats */}
      <div style={{
        display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap",
        padding: 10, background: "var(--color-bg)", borderRadius: 8,
        border: "1px solid var(--color-border)",
      }}>
        <div style={statBox}>
          <div style={labelStyle}>Mean (\u03BC)</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--color-heading)" }}>
            {distStats.mean.toFixed(4)}
          </div>
        </div>
        <div style={statBox}>
          <div style={labelStyle}>Variance (\u03C3\u00B2)</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--color-primary)" }}>
            {distStats.variance.toFixed(4)}
          </div>
        </div>
        <div style={statBox}>
          <div style={labelStyle}>Skewness</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--color-accent)" }}>
            {distStats.skewness.toFixed(4)}
          </div>
        </div>
      </div>

      {/* Source canvas */}
      <div
        ref={containerRef}
        style={{ width: "100%", marginBottom: 20 }}
        onMouseDown={(e) => {
          if (distId === "custom") {
            isDrawingRef.current = true;
            handleCustomDraw(e as unknown as MouseEvent);
          }
        }}
        onMouseMove={(e) => {
          if (distId === "custom" && isDrawingRef.current) {
            handleCustomDraw(e as unknown as MouseEvent);
          }
        }}
        onMouseUp={() => { isDrawingRef.current = false; }}
        onMouseLeave={() => { isDrawingRef.current = false; }}
      >
        <canvas
          ref={sourceCanvasRef}
          style={{ width: "100%", borderRadius: 8, cursor: distId === "custom" ? "crosshair" : "default" }}
        />
      </div>

      {/* ─── Sampling Controls ─── */}
      <div style={{
        borderTop: "1px solid var(--color-border)",
        paddingTop: 16,
        marginBottom: 16,
      }}>
        <div style={sectionTitle}>Sampling Engine</div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
          <div>
            <span style={labelStyle}>Sample size (n)</span>
            <div style={{ display: "flex", gap: 4 }}>
              {SAMPLE_SIZES.map((n) => (
                <button key={n} style={btnStyle(sampleSize === n)} onClick={() => setSampleSize(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span style={labelStyle}>Speed: {speed}x</span>
            <input
              type="range"
              min={1}
              max={50}
              value={speed}
              onInput={(e) => setSpeed(parseInt((e.target as HTMLInputElement).value))}
              style={{ width: 120 }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <button
            style={{ ...btnStyle(), background: "var(--color-primary)", color: "#fff" }}
            onClick={drawOneSample}
          >
            Draw Sample
          </button>
          <button
            style={{
              ...btnStyle(),
              background: autoSampling ? "var(--color-accent)" : "var(--color-primary)",
              color: "#fff",
            }}
            onClick={() => setAutoSampling((p) => !p)}
          >
            {autoSampling ? "Stop" : "Auto-Sample"}
          </button>
          <button style={btnStyle()} onClick={resetSamples}>
            Reset
          </button>

          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ fontSize: 12, color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
              <input type="checkbox" checked={showOverlay} onInput={() => setShowOverlay((p) => !p)} />
              Normal overlay
            </label>
            <label style={{ fontSize: 12, color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
              <input type="checkbox" checked={showPoints} onInput={() => setShowPoints((p) => !p)} />
              Show points
            </label>
          </div>
        </div>

        {/* Sample counter */}
        <div style={{
          fontSize: 13, color: "var(--color-text-muted)", marginBottom: 12,
          padding: "8px 12px", background: "var(--color-bg)", borderRadius: 6,
          border: "1px solid var(--color-border)",
        }}>
          Samples drawn: <strong style={{ color: "var(--color-heading)" }}>{sampleMeans.length.toLocaleString()}</strong>
          {" | "}n = <strong style={{ color: "var(--color-primary)" }}>{sampleSize}</strong>
          {samplingStats && (
            <>
              {" | "}Mean of means: <strong style={{ color: "var(--color-heading)" }}>{samplingStats.mean.toFixed(4)}</strong>
              {" | "}SD: <strong style={{ color: "var(--color-primary)" }}>{samplingStats.sd.toFixed(4)}</strong>
              {" | "}\u03C3/\u221An: <strong style={{ color: "var(--color-accent)" }}>{samplingStats.expectedSd.toFixed(4)}</strong>
            </>
          )}
        </div>
      </div>

      {/* ─── Sampling Distribution Canvas ─── */}
      <div style={{ width: "100%", marginBottom: 16 }}>
        <canvas ref={samplingCanvasRef} style={{ width: "100%", borderRadius: 8 }} />
      </div>

      {/* ─── N-Comparison ─── */}
      <div style={{
        borderTop: "1px solid var(--color-border)",
        paddingTop: 16,
      }}>
        <div style={sectionTitle}>Compare Sample Sizes</div>
        <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
          Toggle different values of n to overlay their theoretical Normal curves.
          Larger n produces tighter distributions around the mean.
        </p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {[1, 2, 5, 10, 30, 50, 100].map((n, i) => {
            const active = nCompare.includes(n);
            const color = N_OVERLAY_COLORS[nCompare.indexOf(n) % N_OVERLAY_COLORS.length];
            return (
              <button
                key={n}
                style={{
                  ...btnStyle(active),
                  ...(active ? { background: color, borderColor: color } : {}),
                }}
                onClick={() => toggleNCompare(n)}
              >
                n={n}
              </button>
            );
          })}
        </div>

        {nCompare.length > 0 && (
          <div style={{ fontSize: 12, padding: 8, background: "var(--color-bg)", borderRadius: 6, border: "1px solid var(--color-border)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <th style={{ textAlign: "left", padding: "4px 8px", color: "var(--color-text-muted)" }}>n</th>
                  <th style={{ textAlign: "right", padding: "4px 8px", color: "var(--color-text-muted)" }}>\u03C3/\u221An</th>
                  <th style={{ textAlign: "right", padding: "4px 8px", color: "var(--color-text-muted)" }}>Observed SD</th>
                  <th style={{ textAlign: "right", padding: "4px 8px", color: "var(--color-text-muted)" }}>Samples</th>
                </tr>
              </thead>
              <tbody>
                {nCompare.map((n, i) => {
                  const data = nCompareData[n] || [];
                  const mean = data.length > 0 ? data.reduce((a, b) => a + b, 0) / data.length : 0;
                  const sd = data.length > 0
                    ? Math.sqrt(data.reduce((a, b) => a + (b - mean) ** 2, 0) / data.length)
                    : 0;
                  const expected = Math.sqrt(distStats.variance / n);
                  const color = N_OVERLAY_COLORS[i % N_OVERLAY_COLORS.length];
                  return (
                    <tr key={n} style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <td style={{ padding: "4px 8px" }}>
                        <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: color, marginRight: 6, verticalAlign: "middle" }} />
                        {n}
                      </td>
                      <td style={{ textAlign: "right", padding: "4px 8px", color: "var(--color-accent)" }}>
                        {expected.toFixed(4)}
                      </td>
                      <td style={{ textAlign: "right", padding: "4px 8px", color: "var(--color-primary)" }}>
                        {sd.toFixed(4)}
                      </td>
                      <td style={{ textAlign: "right", padding: "4px 8px", color: "var(--color-text-muted)" }}>
                        {data.length.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Educational note ─── */}
      <div style={{
        marginTop: 16,
        padding: 12,
        background: "var(--color-bg)",
        borderRadius: 8,
        border: "1px solid var(--color-border)",
        fontSize: 12,
        color: "var(--color-text-muted)",
        lineHeight: 1.6,
      }}>
        <strong style={{ color: "var(--color-heading)" }}>Central Limit Theorem:</strong>{" "}
        Regardless of the shape of the source distribution (as long as it has finite variance),
        the distribution of sample means approaches a Normal distribution N(\u03BC, \u03C3\u00B2/n)
        as the sample size n increases. Notice how even highly skewed or bimodal distributions
        produce bell-shaped sampling distributions when n is large enough.
      </div>
    </div>
  );
}
