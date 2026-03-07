import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type TabId = "roll" | "sample-space" | "lln";
type ExperimentType = "1-die" | "2-dice-sum" | "3-coins" | "card-suit";

interface DieState {
  value: number;
  rolling: boolean;
}

interface FrequencyMap {
  [key: string]: number;
}

interface LlnRun {
  data: number[];
  color: string;
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const TABS: { id: TabId; label: string }[] = [
  { id: "roll", label: "Roll Dice" },
  { id: "sample-space", label: "Sample Space" },
  { id: "lln", label: "Law of Large Numbers" },
];

const DOT_PATTERNS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.25, 0.25], [0.75, 0.75]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.5], [0.75, 0.5], [0.25, 0.75], [0.75, 0.75]],
};

const RUN_COLORS = [
  "#4f8ff7", "#34d399", "#f59e0b", "#ef4444",
  "#a78bfa", "#ec4899", "#06b6d4", "#84cc16",
];

const SAMPLE_SPACE_EXPERIMENTS: { id: ExperimentType; label: string }[] = [
  { id: "1-die", label: "1 Die" },
  { id: "2-dice-sum", label: "2 Dice (Sum)" },
  { id: "3-coins", label: "3 Coins" },
  { id: "card-suit", label: "Deck (Suit)" },
];

// ─────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────

function rollDie(): number {
  return Math.floor(Math.random() * 6) + 1;
}

function flipCoin(): "H" | "T" {
  return Math.random() < 0.5 ? "H" : "T";
}

function getSampleSpace(exp: ExperimentType): string[] {
  if (exp === "1-die") return ["1", "2", "3", "4", "5", "6"];
  if (exp === "2-dice-sum") return ["2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
  if (exp === "3-coins") return ["HHH", "HHT", "HTH", "HTT", "THH", "THT", "TTH", "TTT"];
  return ["Spades", "Hearts", "Diamonds", "Clubs"];
}

function getOutcomeCount(exp: ExperimentType, outcome: string): number {
  if (exp === "1-die") return 1;
  if (exp === "2-dice-sum") {
    const s = parseInt(outcome);
    return s <= 7 ? s - 1 : 13 - s;
  }
  if (exp === "3-coins") return 1;
  return 13;
}

function getTotalOutcomes(exp: ExperimentType): number {
  if (exp === "1-die") return 6;
  if (exp === "2-dice-sum") return 36;
  if (exp === "3-coins") return 8;
  return 52;
}

function getEvents(exp: ExperimentType): { label: string; filter: (o: string) => boolean }[] {
  if (exp === "1-die") return [
    { label: "Even number", filter: (o) => parseInt(o) % 2 === 0 },
    { label: "Odd number", filter: (o) => parseInt(o) % 2 !== 0 },
    { label: ">= 4", filter: (o) => parseInt(o) >= 4 },
    { label: "= 6", filter: (o) => o === "6" },
    { label: "Prime", filter: (o) => [2, 3, 5].includes(parseInt(o)) },
  ];
  if (exp === "2-dice-sum") return [
    { label: "Sum >= 7", filter: (o) => parseInt(o) >= 7 },
    { label: "Sum = 7", filter: (o) => o === "7" },
    { label: "Sum <= 4", filter: (o) => parseInt(o) <= 4 },
    { label: "Even sum", filter: (o) => parseInt(o) % 2 === 0 },
    { label: "Doubles (sum even)", filter: (o) => parseInt(o) % 2 === 0 },
  ];
  if (exp === "3-coins") return [
    { label: "All same", filter: (o) => o === "HHH" || o === "TTT" },
    { label: "At least 2 heads", filter: (o) => (o.match(/H/g) || []).length >= 2 },
    { label: "Exactly 1 tail", filter: (o) => (o.match(/T/g) || []).length === 1 },
    { label: "No heads", filter: (o) => !o.includes("H") },
  ];
  return [
    { label: "Red suit", filter: (o) => o === "Hearts" || o === "Diamonds" },
    { label: "Black suit", filter: (o) => o === "Spades" || o === "Clubs" },
    { label: "Hearts", filter: (o) => o === "Hearts" },
  ];
}

function resolveColor(el: HTMLElement | null, varName: string, fallback: string): string {
  if (!el) return fallback;
  return getComputedStyle(el).getPropertyValue(varName).trim() || fallback;
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function DiceFace({ value, size = 60, rolling = false }: { value: number; size?: number; rolling?: boolean }) {
  const dots = DOT_PATTERNS[value] || [];
  const dotR = size * 0.09;
  return (
    <div style={{
      width: size, height: size,
      borderRadius: size * 0.15,
      background: "var(--color-surface)",
      border: "2px solid var(--color-border)",
      position: "relative",
      display: "inline-block",
      transition: "transform 0.2s",
      transform: rolling ? `rotate(${Math.random() * 360}deg)` : "none",
    }}>
      {dots.map(([x, y], i) => (
        <div key={i} style={{
          position: "absolute",
          left: x * size - dotR,
          top: y * size - dotR,
          width: dotR * 2,
          height: dotR * 2,
          borderRadius: "50%",
          background: "var(--color-heading)",
        }} />
      ))}
    </div>
  );
}

function CoinFace({ value, size = 60, rolling = false }: { value: "H" | "T"; size?: number; rolling?: boolean }) {
  return (
    <div style={{
      width: size, height: size,
      borderRadius: "50%",
      background: value === "H" ? "var(--color-primary)" : "var(--color-accent)",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: 700,
      fontSize: size * 0.4,
      color: "#fff",
      border: "3px solid var(--color-border)",
      transition: "transform 0.3s",
      transform: rolling ? "rotateY(180deg)" : "none",
    }}>
      {value}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────

export default function DiceLab() {
  const [tab, setTab] = useState<TabId>("roll");

  // ── Roll tab state ──
  const [diceCount, setDiceCount] = useState(2);
  const [mode, setMode] = useState<"dice" | "coin">("dice");
  const [dice, setDice] = useState<DieState[]>([{ value: 1, rolling: false }, { value: 4, rolling: false }]);
  const [coinValues, setCoinValues] = useState<("H" | "T")[]>(["H"]);
  const [freq, setFreq] = useState<FrequencyMap>({});
  const [totalRolls, setTotalRolls] = useState(0);
  const [isRolling, setIsRolling] = useState(false);
  const rollChartRef = useRef<HTMLCanvasElement>(null);
  const rollContainerRef = useRef<HTMLDivElement>(null);

  // ── Sample space tab state ──
  const [experiment, setExperiment] = useState<ExperimentType>("1-die");
  const [selectedEventIdx, setSelectedEventIdx] = useState(0);

  // ── LLN tab state ──
  const [llnRuns, setLlnRuns] = useState<LlnRun[]>([]);
  const [llnPlaying, setLlnPlaying] = useState(false);
  const [llnSpeed, setLlnSpeed] = useState(10);
  const [llnTarget, setLlnTarget] = useState(6);
  const llnCanvasRef = useRef<HTMLCanvasElement>(null);
  const llnContainerRef = useRef<HTMLDivElement>(null);
  const llnPlayingRef = useRef(false);
  const llnAnimRef = useRef<number>(0);
  const llnRunsRef = useRef(llnRuns);

  useEffect(() => { llnRunsRef.current = llnRuns; }, [llnRuns]);
  useEffect(() => { llnPlayingRef.current = llnPlaying; }, [llnPlaying]);

  // ─── ROLL TAB LOGIC ───────────────────────────────────

  const performRoll = useCallback((count: number) => {
    if (mode === "dice") {
      const newFreq = { ...freq };
      for (let r = 0; r < count; r++) {
        const values = Array.from({ length: diceCount }, () => rollDie());
        const sum = values.reduce((a, b) => a + b, 0);
        const key = diceCount === 1 ? String(sum) : String(sum);
        newFreq[key] = (newFreq[key] || 0) + 1;
        if (r === count - 1) {
          setDice(values.map((v) => ({ value: v, rolling: false })));
        }
      }
      setFreq(newFreq);
      setTotalRolls((prev) => prev + count);
    } else {
      const newFreq = { ...freq };
      for (let r = 0; r < count; r++) {
        const flips = Array.from({ length: diceCount }, () => flipCoin());
        const key = flips.join("");
        newFreq[key] = (newFreq[key] || 0) + 1;
        if (r === count - 1) {
          setCoinValues(flips);
        }
      }
      setFreq(newFreq);
      setTotalRolls((prev) => prev + count);
    }
  }, [mode, diceCount, freq]);

  const handleRoll = useCallback((count: number) => {
    if (count === 1) {
      setIsRolling(true);
      if (mode === "dice") {
        setDice(Array.from({ length: diceCount }, () => ({ value: rollDie(), rolling: true })));
      }
      setTimeout(() => {
        performRoll(1);
        setIsRolling(false);
      }, 300);
    } else {
      performRoll(count);
    }
  }, [performRoll, mode, diceCount]);

  const resetRolls = useCallback(() => {
    setFreq({});
    setTotalRolls(0);
    setDice(Array.from({ length: diceCount }, () => ({ value: 1, rolling: false })));
    setCoinValues(Array.from({ length: diceCount }, () => "H" as const));
  }, [diceCount]);

  useEffect(() => {
    resetRolls();
  }, [diceCount, mode]);

  // ─── Draw roll frequency chart ─────────────────────────

  const drawRollChart = useCallback(() => {
    const canvas = rollChartRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const container = rollContainerRef.current;
    const w = container ? container.clientWidth : 500;
    const h = 220;
    canvas.width = w * 2;
    canvas.height = h * 2;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(2, 2);

    const bgColor = resolveColor(canvas, "--color-bg", "#09090b");
    const textColor = resolveColor(canvas, "--color-text-muted", "#a1a1aa");
    const headingColor = resolveColor(canvas, "--color-heading", "#fff");
    const primaryColor = resolveColor(canvas, "--color-primary", "#4f8ff7");
    const accentColor = resolveColor(canvas, "--color-accent", "#34d399");
    const borderColor = resolveColor(canvas, "--color-border", "#27272a");

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    let outcomes: string[];
    if (mode === "dice") {
      const min = diceCount;
      const max = diceCount * 6;
      outcomes = [];
      for (let i = min; i <= max; i++) outcomes.push(String(i));
    } else {
      outcomes = getSampleSpace("3-coins");
      if (diceCount === 1) outcomes = ["H", "T"];
      else if (diceCount === 2) outcomes = ["HH", "HT", "TH", "TT"];
      else {
        const generate = (n: number): string[] => {
          if (n === 0) return [""];
          const prev = generate(n - 1);
          return prev.flatMap((s) => [s + "H", s + "T"]);
        };
        outcomes = generate(diceCount);
      }
    }

    const pad = { left: 40, right: 15, top: 25, bottom: 40 };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;
    const barW = Math.max(2, Math.min(30, chartW / outcomes.length - 2));
    const gap = (chartW - barW * outcomes.length) / (outcomes.length + 1);

    // Compute theoretical probabilities
    const theoreticalProbs: Record<string, number> = {};
    if (mode === "dice") {
      const total = Math.pow(6, diceCount);
      const countWays = (target: number, numDice: number): number => {
        if (numDice === 0) return target === 0 ? 1 : 0;
        let ways = 0;
        for (let f = 1; f <= 6; f++) {
          if (target - f >= 0) ways += countWays(target - f, numDice - 1);
        }
        return ways;
      };
      for (const o of outcomes) {
        theoreticalProbs[o] = countWays(parseInt(o), diceCount) / total;
      }
    } else {
      const total = Math.pow(2, diceCount);
      for (const o of outcomes) {
        theoreticalProbs[o] = 1 / total;
      }
    }

    const maxProb = Math.max(...Object.values(theoreticalProbs), 0.01);
    const maxObserved = totalRolls > 0
      ? Math.max(...outcomes.map((o) => (freq[o] || 0) / totalRolls))
      : 0;
    const yMax = Math.max(maxProb, maxObserved) * 1.2;

    // Grid lines
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + chartH * (1 - i / 4);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();

      ctx.fillStyle = textColor;
      ctx.font = "10px Inter, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText((yMax * i / 4 * 100).toFixed(0) + "%", pad.left - 4, y + 3);
    }

    // Bars
    outcomes.forEach((o, i) => {
      const x = pad.left + gap + i * (barW + gap);

      // Theoretical bar (background)
      const theoH = (theoreticalProbs[o] / yMax) * chartH;
      ctx.fillStyle = borderColor;
      ctx.fillRect(x, pad.top + chartH - theoH, barW, theoH);

      // Observed bar
      if (totalRolls > 0) {
        const obsProb = (freq[o] || 0) / totalRolls;
        const obsH = (obsProb / yMax) * chartH;
        ctx.fillStyle = primaryColor;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x, pad.top + chartH - obsH, barW, obsH);
        ctx.globalAlpha = 1;
      }

      // Theoretical line marker
      const theoY = pad.top + chartH - theoH;
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 2, theoY);
      ctx.lineTo(x + barW + 2, theoY);
      ctx.stroke();

      // Labels
      ctx.fillStyle = textColor;
      ctx.font = `${Math.min(10, barW)}px Inter, sans-serif`;
      ctx.textAlign = "center";
      const label = o.length > 3 ? o.slice(0, 3) : o;
      ctx.fillText(label, x + barW / 2, h - pad.bottom + 14);
    });

    // Legend
    ctx.font = "10px Inter, sans-serif";
    ctx.fillStyle = primaryColor;
    ctx.fillRect(w - 160, 6, 10, 10);
    ctx.fillStyle = headingColor;
    ctx.textAlign = "left";
    ctx.fillText("Observed", w - 146, 15);

    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w - 80, 11);
    ctx.lineTo(w - 68, 11);
    ctx.stroke();
    ctx.fillStyle = headingColor;
    ctx.fillText("Theory", w - 64, 15);
  }, [freq, totalRolls, mode, diceCount]);

  useEffect(() => {
    if (tab === "roll") drawRollChart();
  }, [tab, drawRollChart]);

  // ─── SAMPLE SPACE TAB ──────────────────────────────────

  const sampleSpaceData = useMemo(() => {
    const outcomes = getSampleSpace(experiment);
    const events = getEvents(experiment);
    const event = events[selectedEventIdx] || events[0];
    const total = getTotalOutcomes(experiment);
    const matchingOutcomes = outcomes.filter((o) => event.filter(o));
    const matchingCount = matchingOutcomes.reduce((sum, o) => sum + getOutcomeCount(experiment, o), 0);
    const probability = matchingCount / total;
    return { outcomes, events, event, total, matchingOutcomes, matchingCount, probability };
  }, [experiment, selectedEventIdx]);

  // ─── LLN TAB ───────────────────────────────────────────

  const addLlnRun = useCallback(() => {
    const color = RUN_COLORS[llnRunsRef.current.length % RUN_COLORS.length];
    setLlnRuns((prev) => [...prev, { data: [], color }]);
  }, []);

  const resetLln = useCallback(() => {
    setLlnRuns([]);
    setLlnPlaying(false);
    cancelAnimationFrame(llnAnimRef.current);
  }, []);

  const theoreticalLlnProb = useMemo(() => {
    if (llnTarget === 6) return 1 / 6;
    if (llnTarget === 7) return 6 / 36;
    return 0.5;
  }, [llnTarget]);

  const llnExperimentLabel = useMemo(() => {
    if (llnTarget === 6) return "P(rolling a 6)";
    if (llnTarget === 7) return "P(sum of 2 dice = 7)";
    return "P(coin = Heads)";
  }, [llnTarget]);

  const drawLln = useCallback(() => {
    const canvas = llnCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const container = llnContainerRef.current;
    const w = container ? container.clientWidth : 500;
    const h = 300;
    canvas.width = w * 2;
    canvas.height = h * 2;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(2, 2);

    const bgColor = resolveColor(canvas, "--color-bg", "#09090b");
    const textColor = resolveColor(canvas, "--color-text-muted", "#a1a1aa");
    const headingColor = resolveColor(canvas, "--color-heading", "#fff");
    const borderColor = resolveColor(canvas, "--color-border", "#27272a");
    const accentColor = resolveColor(canvas, "--color-accent", "#34d399");

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    const pad = { left: 55, right: 15, top: 25, bottom: 35 };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;

    const runs = llnRunsRef.current;
    const maxTrials = Math.max(100, ...runs.map((r) => r.data.length));

    // Y range centered on theoretical
    const tp = theoreticalLlnProb;
    const yRange = Math.max(0.3, tp + 0.1);
    const yMin = Math.max(0, tp - yRange / 2);
    const yMax = Math.min(1, tp + yRange / 2);

    // Grid
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 0.5;
    ctx.font = "10px Inter, sans-serif";
    ctx.fillStyle = textColor;
    ctx.textAlign = "right";
    for (let i = 0; i <= 5; i++) {
      const yVal = yMin + (yMax - yMin) * (i / 5);
      const y = pad.top + chartH * (1 - i / 5);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      ctx.fillText((yVal * 100).toFixed(1) + "%", pad.left - 4, y + 3);
    }

    // X-axis labels
    ctx.textAlign = "center";
    const xSteps = [1, 10, 100, 1000, 10000];
    for (const step of xSteps) {
      if (step > maxTrials) break;
      const xFrac = Math.log10(step) / Math.log10(maxTrials);
      const x = pad.left + xFrac * chartW;
      ctx.fillStyle = textColor;
      ctx.fillText(step >= 1000 ? (step / 1000) + "k" : String(step), x, h - pad.bottom + 16);
    }

    // Axis titles
    ctx.fillStyle = textColor;
    ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Number of trials (log scale)", pad.left + chartW / 2, h - 4);

    // Theoretical line
    const theoY = pad.top + chartH * (1 - (tp - yMin) / (yMax - yMin));
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pad.left, theoY);
    ctx.lineTo(w - pad.right, theoY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Label
    ctx.fillStyle = accentColor;
    ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`Theory: ${(tp * 100).toFixed(2)}%`, pad.left + 4, theoY - 6);

    // Standard deviation band
    if (runs.length > 0) {
      ctx.fillStyle = accentColor;
      ctx.globalAlpha = 0.08;
      ctx.beginPath();
      for (let i = 1; i <= maxTrials; i++) {
        const xFrac = Math.log10(i) / Math.log10(maxTrials);
        const x = pad.left + xFrac * chartW;
        const sd = Math.sqrt(tp * (1 - tp) / i);
        const upper = tp + sd;
        const yPos = pad.top + chartH * (1 - (upper - yMin) / (yMax - yMin));
        if (i === 1) ctx.moveTo(x, yPos);
        else ctx.lineTo(x, yPos);
      }
      for (let i = maxTrials; i >= 1; i--) {
        const xFrac = Math.log10(i) / Math.log10(maxTrials);
        const x = pad.left + xFrac * chartW;
        const sd = Math.sqrt(tp * (1 - tp) / i);
        const lower = tp - sd;
        const yPos = pad.top + chartH * (1 - (lower - yMin) / (yMax - yMin));
        ctx.lineTo(x, yPos);
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Run lines
    for (const run of runs) {
      if (run.data.length === 0) continue;
      ctx.strokeStyle = run.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let successes = 0;
      for (let i = 0; i < run.data.length; i++) {
        successes += run.data[i];
        const prob = successes / (i + 1);
        const xFrac = Math.log10(i + 1) / Math.log10(maxTrials);
        const x = pad.left + xFrac * chartW;
        const y = pad.top + chartH * (1 - (prob - yMin) / (yMax - yMin));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Legend
    ctx.font = "10px Inter, sans-serif";
    runs.forEach((run, i) => {
      ctx.fillStyle = run.color;
      ctx.fillRect(w - 100, 8 + i * 16, 10, 10);
      ctx.fillStyle = headingColor;
      ctx.textAlign = "left";
      ctx.fillText(`Run ${i + 1} (${run.data.length})`, w - 86, 17 + i * 16);
    });
  }, [theoreticalLlnProb]);

  useEffect(() => {
    if (tab === "lln") drawLln();
  }, [tab, llnRuns, drawLln]);

  // LLN animation loop
  useEffect(() => {
    if (!llnPlaying || tab !== "lln") return;

    let cancelled = false;
    const step = () => {
      if (cancelled || !llnPlayingRef.current) return;

      setLlnRuns((prev) => {
        if (prev.length === 0) return prev;
        const maxLen = 10000;
        const updated = prev.map((run) => {
          if (run.data.length >= maxLen) return run;
          const newData = [...run.data];
          const batchSize = llnSpeed;
          for (let i = 0; i < batchSize; i++) {
            if (newData.length >= maxLen) break;
            let success: number;
            if (llnTarget === 6) {
              success = rollDie() === 6 ? 1 : 0;
            } else if (llnTarget === 7) {
              success = rollDie() + rollDie() === 7 ? 1 : 0;
            } else {
              success = Math.random() < 0.5 ? 1 : 0;
            }
            newData.push(success);
          }
          return { ...run, data: newData };
        });

        const allDone = updated.every((r) => r.data.length >= maxLen);
        if (allDone) {
          setLlnPlaying(false);
        }
        return updated;
      });

      llnAnimRef.current = requestAnimationFrame(step);
    };

    llnAnimRef.current = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(llnAnimRef.current);
    };
  }, [llnPlaying, tab, llnSpeed, llnTarget]);

  // Redraw LLN when runs change
  useEffect(() => {
    if (tab === "lln") drawLln();
  }, [llnRuns, tab, drawLln]);

  // ─── SHARED STYLES ────────────────────────────────────

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

  const smallBtnStyle = {
    padding: "4px 10px",
    borderRadius: 5,
    border: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    color: "var(--color-text)",
    cursor: "pointer" as const,
    fontSize: 12,
  };

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

  // ─── RENDER ────────────────────────────────────────────

  return (
    <div style={containerStyle}>
      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            style={btnStyle(tab === t.id)}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ════════════════ ROLL TAB ════════════════ */}
      {tab === "roll" && (
        <div>
          {/* Controls */}
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
            <div>
              <span style={labelStyle}>Mode</span>
              <div style={{ display: "flex", gap: 4 }}>
                <button style={btnStyle(mode === "dice")} onClick={() => setMode("dice")}>Dice</button>
                <button style={btnStyle(mode === "coin")} onClick={() => setMode("coin")}>Coin</button>
              </div>
            </div>
            <div>
              <span style={labelStyle}>Count: {diceCount}</span>
              <input
                type="range"
                min={1}
                max={5}
                value={diceCount}
                onInput={(e) => setDiceCount(parseInt((e.target as HTMLInputElement).value))}
                style={{ width: 100 }}
              />
            </div>
          </div>

          {/* Visual display */}
          <div style={{
            display: "flex", gap: 12, justifyContent: "center",
            padding: 20, marginBottom: 16,
            background: "var(--color-bg)", borderRadius: 8,
            border: "1px solid var(--color-border)",
            minHeight: 90, alignItems: "center", flexWrap: "wrap",
          }}>
            {mode === "dice"
              ? dice.map((d, i) => <DiceFace key={i} value={d.value} size={64} rolling={isRolling} />)
              : coinValues.map((c, i) => <CoinFace key={i} value={c} size={64} rolling={isRolling} />)
            }
          </div>

          {/* Roll buttons */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {[1, 10, 100, 1000].map((n) => (
              <button
                key={n}
                style={{
                  ...btnStyle(),
                  background: "var(--color-primary)",
                  color: "#fff",
                  opacity: isRolling ? 0.6 : 1,
                }}
                onClick={() => handleRoll(n)}
                disabled={isRolling}
              >
                {mode === "dice" ? "Roll" : "Flip"} {n === 1 ? "" : `${n}x`}
              </button>
            ))}
            <button style={{ ...btnStyle(), marginLeft: "auto" }} onClick={resetRolls}>
              Reset
            </button>
          </div>

          {/* Stats */}
          <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 12 }}>
            Total {mode === "dice" ? "rolls" : "flips"}: <strong style={{ color: "var(--color-heading)" }}>{totalRolls.toLocaleString()}</strong>
          </div>

          {/* Frequency chart */}
          <div ref={rollContainerRef} style={{ width: "100%" }}>
            <canvas ref={rollChartRef} style={{ width: "100%", borderRadius: 8 }} />
          </div>

          {/* Frequency table */}
          {totalRolls > 0 && (
            <div style={{ marginTop: 12, maxHeight: 160, overflowY: "auto" }}>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <th style={{ textAlign: "left", padding: "4px 8px", color: "var(--color-text-muted)" }}>Outcome</th>
                    <th style={{ textAlign: "right", padding: "4px 8px", color: "var(--color-text-muted)" }}>Count</th>
                    <th style={{ textAlign: "right", padding: "4px 8px", color: "var(--color-text-muted)" }}>Observed</th>
                    <th style={{ textAlign: "right", padding: "4px 8px", color: "var(--color-text-muted)" }}>Expected</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(freq).sort(([a], [b]) => {
                    const na = parseInt(a), nb = parseInt(b);
                    if (!isNaN(na) && !isNaN(nb)) return na - nb;
                    return a.localeCompare(b);
                  }).map(([key, count]) => (
                    <tr key={key} style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <td style={{ padding: "4px 8px", color: "var(--color-heading)" }}>{key}</td>
                      <td style={{ textAlign: "right", padding: "4px 8px" }}>{count}</td>
                      <td style={{ textAlign: "right", padding: "4px 8px", color: "var(--color-primary)" }}>
                        {(count / totalRolls * 100).toFixed(2)}%
                      </td>
                      <td style={{ textAlign: "right", padding: "4px 8px", color: "var(--color-accent)" }}>
                        {mode === "dice"
                          ? ((1 / (diceCount === 1 ? 6 : (diceCount * 6 - diceCount + 1))) * 100).toFixed(2) + "%"
                          : ((1 / Math.pow(2, diceCount)) * 100).toFixed(2) + "%"
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ════════════════ SAMPLE SPACE TAB ════════════════ */}
      {tab === "sample-space" && (
        <div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16, alignItems: "flex-end" }}>
            <div>
              <span style={labelStyle}>Experiment</span>
              <select
                value={experiment}
                onInput={(e) => { setExperiment((e.target as HTMLSelectElement).value as ExperimentType); setSelectedEventIdx(0); }}
                style={{
                  padding: "6px 10px", borderRadius: 6,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg)", color: "var(--color-text)",
                  fontSize: 13,
                }}
              >
                {SAMPLE_SPACE_EXPERIMENTS.map((e) => (
                  <option key={e.id} value={e.id}>{e.label}</option>
                ))}
              </select>
            </div>
            <div>
              <span style={labelStyle}>Event</span>
              <select
                value={selectedEventIdx}
                onInput={(e) => setSelectedEventIdx(parseInt((e.target as HTMLSelectElement).value))}
                style={{
                  padding: "6px 10px", borderRadius: 6,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg)", color: "var(--color-text)",
                  fontSize: 13,
                }}
              >
                {sampleSpaceData.events.map((ev, i) => (
                  <option key={i} value={i}>{ev.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Probability display */}
          <div style={{
            display: "flex", gap: 20, marginBottom: 16, flexWrap: "wrap",
            padding: 16, background: "var(--color-bg)", borderRadius: 8,
            border: "1px solid var(--color-border)",
          }}>
            <div style={{ textAlign: "center", flex: 1, minWidth: 120 }}>
              <div style={labelStyle}>Event</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--color-heading)" }}>
                {sampleSpaceData.event.label}
              </div>
            </div>
            <div style={{ textAlign: "center", flex: 1, minWidth: 80 }}>
              <div style={labelStyle}>Fraction</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--color-primary)" }}>
                {sampleSpaceData.matchingCount}/{sampleSpaceData.total}
              </div>
            </div>
            <div style={{ textAlign: "center", flex: 1, minWidth: 80 }}>
              <div style={labelStyle}>Decimal</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--color-primary)" }}>
                {sampleSpaceData.probability.toFixed(4)}
              </div>
            </div>
            <div style={{ textAlign: "center", flex: 1, minWidth: 80 }}>
              <div style={labelStyle}>Percentage</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--color-accent)" }}>
                {(sampleSpaceData.probability * 100).toFixed(2)}%
              </div>
            </div>
          </div>

          {/* Outcome grid */}
          <div style={sectionTitle}>
            Sample Space ({sampleSpaceData.outcomes.length} distinct outcomes, {sampleSpaceData.total} total equally likely)
          </div>
          <div style={{
            display: "flex", gap: 6, flexWrap: "wrap",
            maxHeight: 300, overflowY: "auto", padding: 8,
          }}>
            {sampleSpaceData.outcomes.map((o) => {
              const isMatch = sampleSpaceData.event.filter(o);
              const count = getOutcomeCount(experiment, o);
              return (
                <div
                  key={o}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: `2px solid ${isMatch ? "var(--color-primary)" : "var(--color-border)"}`,
                    background: isMatch ? "rgba(79, 143, 247, 0.15)" : "var(--color-bg)",
                    color: isMatch ? "var(--color-primary)" : "var(--color-text-muted)",
                    fontSize: 13,
                    fontWeight: isMatch ? 600 : 400,
                    fontFamily: "var(--font-mono)",
                    position: "relative",
                    minWidth: 40,
                    textAlign: "center",
                  }}
                >
                  {o}
                  {count > 1 && (
                    <span style={{
                      position: "absolute", top: -6, right: -6,
                      background: "var(--color-primary)", color: "#fff",
                      borderRadius: "50%", width: 18, height: 18,
                      fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {count}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Visual: dice grid for 2 dice */}
          {experiment === "2-dice-sum" && (
            <div style={{ marginTop: 16 }}>
              <div style={sectionTitle}>Outcome Table (Die 1 vs Die 2)</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ padding: "4px 8px", color: "var(--color-text-muted)" }}>+</th>
                      {[1, 2, 3, 4, 5, 6].map((d) => (
                        <th key={d} style={{ padding: "4px 10px", color: "var(--color-heading)", textAlign: "center" }}>{d}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[1, 2, 3, 4, 5, 6].map((d1) => (
                      <tr key={d1}>
                        <td style={{ padding: "4px 8px", fontWeight: 600, color: "var(--color-heading)" }}>{d1}</td>
                        {[1, 2, 3, 4, 5, 6].map((d2) => {
                          const sum = d1 + d2;
                          const isMatch = sampleSpaceData.event.filter(String(sum));
                          return (
                            <td key={d2} style={{
                              padding: "6px 10px",
                              textAlign: "center",
                              background: isMatch ? "rgba(79, 143, 247, 0.2)" : "transparent",
                              color: isMatch ? "var(--color-primary)" : "var(--color-text-muted)",
                              fontWeight: isMatch ? 700 : 400,
                              border: "1px solid var(--color-border)",
                              borderRadius: 2,
                            }}>
                              {sum}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Visual: tree for 3 coins */}
          {experiment === "3-coins" && (
            <div style={{ marginTop: 16 }}>
              <div style={sectionTitle}>Outcome Tree</div>
              <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", lineHeight: 1.8, padding: 8, background: "var(--color-bg)", borderRadius: 8, overflowX: "auto" }}>
                {sampleSpaceData.outcomes.map((o) => {
                  const isMatch = sampleSpaceData.event.filter(o);
                  return (
                    <div key={o} style={{
                      color: isMatch ? "var(--color-primary)" : "var(--color-text-muted)",
                      fontWeight: isMatch ? 600 : 400,
                    }}>
                      {"  ".repeat(0)}{o[0]} {"\u2192"} {o[1]} {"\u2192"} {o[2]}
                      {isMatch && " \u2713"}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════ LLN TAB ════════════════ */}
      {tab === "lln" && (
        <div>
          <div style={sectionTitle}>Law of Large Numbers</div>
          <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 16, lineHeight: 1.6 }}>
            As the number of trials increases, the observed probability converges to the theoretical value.
            Add multiple runs to see how variance decreases with more trials.
          </p>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16, alignItems: "flex-end" }}>
            <div>
              <span style={labelStyle}>Experiment</span>
              <select
                value={llnTarget}
                onInput={(e) => { setLlnTarget(parseInt((e.target as HTMLSelectElement).value)); resetLln(); }}
                style={{
                  padding: "6px 10px", borderRadius: 6,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg)", color: "var(--color-text)",
                  fontSize: 13,
                }}
              >
                <option value={6}>Roll a 6 (1 die)</option>
                <option value={7}>Sum = 7 (2 dice)</option>
                <option value={5}>Heads (coin flip)</option>
              </select>
            </div>
            <div>
              <span style={labelStyle}>Speed: {llnSpeed}x</span>
              <input
                type="range"
                min={1}
                max={100}
                value={llnSpeed}
                onInput={(e) => setLlnSpeed(parseInt((e.target as HTMLInputElement).value))}
                style={{ width: 120 }}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            <button style={{ ...btnStyle(true) }} onClick={addLlnRun}>
              + Add Run
            </button>
            <button
              style={{
                ...btnStyle(),
                background: llnPlaying ? "var(--color-accent)" : "var(--color-primary)",
                color: "#fff",
                opacity: llnRuns.length === 0 ? 0.5 : 1,
              }}
              onClick={() => {
                if (llnRuns.length === 0) addLlnRun();
                setLlnPlaying((p) => !p);
              }}
            >
              {llnPlaying ? "Pause" : "Play"}
            </button>
            <button style={btnStyle()} onClick={resetLln}>
              Reset
            </button>
          </div>

          <div style={{
            padding: 10, marginBottom: 12,
            background: "var(--color-bg)", borderRadius: 8,
            border: "1px solid var(--color-border)",
            fontSize: 13, color: "var(--color-text-muted)",
          }}>
            {llnExperimentLabel} = <strong style={{ color: "var(--color-accent)" }}>{(theoreticalLlnProb * 100).toFixed(2)}%</strong>
            {" | "}Runs: <strong style={{ color: "var(--color-heading)" }}>{llnRuns.length}</strong>
            {llnRuns.length > 0 && (
              <span>
                {" | "}Max trials: <strong style={{ color: "var(--color-heading)" }}>
                  {Math.max(...llnRuns.map((r) => r.data.length)).toLocaleString()}
                </strong>
              </span>
            )}
          </div>

          <div ref={llnContainerRef} style={{ width: "100%" }}>
            <canvas ref={llnCanvasRef} style={{ width: "100%", borderRadius: 8 }} />
          </div>

          {llnRuns.length > 0 && (
            <div style={{ marginTop: 12, fontSize: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <th style={{ textAlign: "left", padding: "4px 8px", color: "var(--color-text-muted)" }}>Run</th>
                    <th style={{ textAlign: "right", padding: "4px 8px", color: "var(--color-text-muted)" }}>Trials</th>
                    <th style={{ textAlign: "right", padding: "4px 8px", color: "var(--color-text-muted)" }}>Observed</th>
                    <th style={{ textAlign: "right", padding: "4px 8px", color: "var(--color-text-muted)" }}>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {llnRuns.map((run, i) => {
                    const successes = run.data.reduce((a, b) => a + b, 0);
                    const obs = run.data.length > 0 ? successes / run.data.length : 0;
                    const err = obs - theoreticalLlnProb;
                    return (
                      <tr key={i} style={{ borderBottom: "1px solid var(--color-border)" }}>
                        <td style={{ padding: "4px 8px" }}>
                          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: run.color, marginRight: 6, verticalAlign: "middle" }} />
                          Run {i + 1}
                        </td>
                        <td style={{ textAlign: "right", padding: "4px 8px" }}>{run.data.length.toLocaleString()}</td>
                        <td style={{ textAlign: "right", padding: "4px 8px", color: "var(--color-primary)" }}>
                          {(obs * 100).toFixed(3)}%
                        </td>
                        <td style={{
                          textAlign: "right", padding: "4px 8px",
                          color: Math.abs(err) < 0.01 ? "var(--color-accent)" : "var(--color-text-muted)",
                        }}>
                          {err >= 0 ? "+" : ""}{(err * 100).toFixed(3)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
