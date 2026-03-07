import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

interface Process {
  id: string;
  arrival: number;
  burst: number;
  priority: number;
  color: string;
}

interface GanttBlock {
  processId: string;
  start: number;
  end: number;
  color: string;
}

interface ScheduleResult {
  gantt: GanttBlock[];
  avgWaiting: number;
  avgTurnaround: number;
  cpuUtilization: number;
}

type Algorithm = "fcfs" | "sjf" | "rr" | "priority";

const COLORS = [
  "#4f8ff7", "#34d399", "#f59e0b", "#ef4444", "#a855f7",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

const ALGO_LABELS: Record<Algorithm, string> = {
  fcfs: "FCFS",
  sjf: "SJF (Non-preemptive)",
  rr: "Round Robin",
  priority: "Priority",
};

/* ══════════════════════════════════════════════════════════
   Scheduling Algorithms
   ══════════════════════════════════════════════════════════ */

function scheduleFCFS(procs: Process[]): ScheduleResult {
  const sorted = [...procs].sort((a, b) => a.arrival - b.arrival || a.id.localeCompare(b.id));
  const gantt: GanttBlock[] = [];
  let time = 0;
  let totalWait = 0;
  let totalTurnaround = 0;

  for (const p of sorted) {
    if (time < p.arrival) {
      gantt.push({ processId: "idle", start: time, end: p.arrival, color: "#374151" });
      time = p.arrival;
    }
    gantt.push({ processId: p.id, start: time, end: time + p.burst, color: p.color });
    const finish = time + p.burst;
    totalWait += time - p.arrival;
    totalTurnaround += finish - p.arrival;
    time = finish;
  }

  const totalBurst = procs.reduce((s, p) => s + p.burst, 0);
  return {
    gantt,
    avgWaiting: procs.length ? totalWait / procs.length : 0,
    avgTurnaround: procs.length ? totalTurnaround / procs.length : 0,
    cpuUtilization: time > 0 ? (totalBurst / time) * 100 : 0,
  };
}

function scheduleSJF(procs: Process[]): ScheduleResult {
  const remaining = procs.map((p) => ({ ...p }));
  const gantt: GanttBlock[] = [];
  let time = 0;
  const completed: Set<string> = new Set();
  let totalWait = 0;
  let totalTurnaround = 0;

  while (completed.size < procs.length) {
    const available = remaining.filter((p) => p.arrival <= time && !completed.has(p.id));
    if (available.length === 0) {
      const next = remaining.filter((p) => !completed.has(p.id)).sort((a, b) => a.arrival - b.arrival)[0];
      gantt.push({ processId: "idle", start: time, end: next.arrival, color: "#374151" });
      time = next.arrival;
      continue;
    }
    available.sort((a, b) => a.burst - b.burst || a.arrival - b.arrival);
    const p = available[0];
    gantt.push({ processId: p.id, start: time, end: time + p.burst, color: p.color });
    const finish = time + p.burst;
    totalWait += time - p.arrival;
    totalTurnaround += finish - p.arrival;
    time = finish;
    completed.add(p.id);
  }

  const totalBurst = procs.reduce((s, p) => s + p.burst, 0);
  return {
    gantt,
    avgWaiting: procs.length ? totalWait / procs.length : 0,
    avgTurnaround: procs.length ? totalTurnaround / procs.length : 0,
    cpuUtilization: time > 0 ? (totalBurst / time) * 100 : 0,
  };
}

function scheduleRR(procs: Process[], quantum: number): ScheduleResult {
  const queue: { proc: Process; remaining: number }[] = [];
  const arrivals = [...procs].sort((a, b) => a.arrival - b.arrival);
  const gantt: GanttBlock[] = [];
  let time = 0;
  let arrIdx = 0;
  const finishTimes: Record<string, number> = {};

  while (arrIdx < arrivals.length && arrivals[arrIdx].arrival <= time) {
    queue.push({ proc: arrivals[arrIdx], remaining: arrivals[arrIdx].burst });
    arrIdx++;
  }

  while (queue.length > 0 || arrIdx < arrivals.length) {
    if (queue.length === 0) {
      const next = arrivals[arrIdx];
      gantt.push({ processId: "idle", start: time, end: next.arrival, color: "#374151" });
      time = next.arrival;
      while (arrIdx < arrivals.length && arrivals[arrIdx].arrival <= time) {
        queue.push({ proc: arrivals[arrIdx], remaining: arrivals[arrIdx].burst });
        arrIdx++;
      }
      continue;
    }

    const item = queue.shift()!;
    const execTime = Math.min(item.remaining, quantum);
    gantt.push({ processId: item.proc.id, start: time, end: time + execTime, color: item.proc.color });
    time += execTime;
    item.remaining -= execTime;

    while (arrIdx < arrivals.length && arrivals[arrIdx].arrival <= time) {
      queue.push({ proc: arrivals[arrIdx], remaining: arrivals[arrIdx].burst });
      arrIdx++;
    }

    if (item.remaining > 0) {
      queue.push(item);
    } else {
      finishTimes[item.proc.id] = time;
    }
  }

  let totalWait = 0;
  let totalTurnaround = 0;
  for (const p of procs) {
    const turnaround = (finishTimes[p.id] ?? time) - p.arrival;
    totalTurnaround += turnaround;
    totalWait += turnaround - p.burst;
  }

  const totalBurst = procs.reduce((s, p) => s + p.burst, 0);
  return {
    gantt,
    avgWaiting: procs.length ? totalWait / procs.length : 0,
    avgTurnaround: procs.length ? totalTurnaround / procs.length : 0,
    cpuUtilization: time > 0 ? (totalBurst / time) * 100 : 0,
  };
}

function schedulePriority(procs: Process[]): ScheduleResult {
  const remaining = procs.map((p) => ({ ...p }));
  const gantt: GanttBlock[] = [];
  let time = 0;
  const completed: Set<string> = new Set();
  let totalWait = 0;
  let totalTurnaround = 0;

  while (completed.size < procs.length) {
    const available = remaining.filter((p) => p.arrival <= time && !completed.has(p.id));
    if (available.length === 0) {
      const next = remaining.filter((p) => !completed.has(p.id)).sort((a, b) => a.arrival - b.arrival)[0];
      gantt.push({ processId: "idle", start: time, end: next.arrival, color: "#374151" });
      time = next.arrival;
      continue;
    }
    available.sort((a, b) => a.priority - b.priority || a.arrival - b.arrival);
    const p = available[0];
    gantt.push({ processId: p.id, start: time, end: time + p.burst, color: p.color });
    const finish = time + p.burst;
    totalWait += time - p.arrival;
    totalTurnaround += finish - p.arrival;
    time = finish;
    completed.add(p.id);
  }

  const totalBurst = procs.reduce((s, p) => s + p.burst, 0);
  return {
    gantt,
    avgWaiting: procs.length ? totalWait / procs.length : 0,
    avgTurnaround: procs.length ? totalTurnaround / procs.length : 0,
    cpuUtilization: time > 0 ? (totalBurst / time) * 100 : 0,
  };
}

function runScheduler(procs: Process[], algo: Algorithm, quantum: number): ScheduleResult {
  if (procs.length === 0) return { gantt: [], avgWaiting: 0, avgTurnaround: 0, cpuUtilization: 0 };
  switch (algo) {
    case "fcfs": return scheduleFCFS(procs);
    case "sjf": return scheduleSJF(procs);
    case "rr": return scheduleRR(procs, quantum);
    case "priority": return schedulePriority(procs);
  }
}

/* ══════════════════════════════════════════════════════════
   Gantt Chart Canvas
   ══════════════════════════════════════════════════════════ */

function GanttCanvas({ result, label }: { result: ScheduleResult; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || result.gantt.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;

    const totalTime = result.gantt[result.gantt.length - 1].end;
    const barY = 28;
    const barH = H - 48;
    const unitW = (W - 40) / Math.max(totalTime, 1);
    const xOff = 20;

    let progress = 0;
    const speed = 0.02;

    function draw() {
      ctx!.clearRect(0, 0, W, H);
      ctx!.fillStyle = "var(--color-text-muted)";
      ctx!.font = "11px Inter, sans-serif";
      ctx!.textAlign = "center";

      if (label) {
        ctx!.fillStyle = getComputedStyle(canvas!).getPropertyValue("color") || "#a1a1aa";
        ctx!.font = "bold 12px Inter, sans-serif";
        ctx!.textAlign = "left";
        ctx!.fillText(label, xOff, 16);
      }

      const textColor = getComputedStyle(canvas!).getPropertyValue("color") || "#a1a1aa";

      for (const block of result.gantt) {
        const bx = xOff + block.start * unitW;
        const bw = (block.end - block.start) * unitW;
        const drawW = Math.min(bw, bw * (progress * totalTime - block.start) / (block.end - block.start));

        if (progress * totalTime < block.start) continue;
        const clampedW = Math.max(0, Math.min(bw, drawW));

        ctx!.fillStyle = block.color;
        ctx!.beginPath();
        ctx!.roundRect(bx, barY, clampedW, barH, 3);
        ctx!.fill();

        if (clampedW > 24 && block.processId !== "idle") {
          ctx!.fillStyle = "#ffffff";
          ctx!.font = "bold 11px Inter, sans-serif";
          ctx!.textAlign = "center";
          ctx!.fillText(block.processId, bx + clampedW / 2, barY + barH / 2 + 4);
        }
      }

      ctx!.fillStyle = textColor;
      ctx!.font = "10px Inter, sans-serif";
      ctx!.textAlign = "center";
      const tickInterval = Math.max(1, Math.ceil(totalTime / 20));
      for (let t = 0; t <= totalTime; t += tickInterval) {
        const tx = xOff + t * unitW;
        ctx!.fillText(String(t), tx, H - 4);
      }

      if (progress < 1) {
        progress = Math.min(1, progress + speed);
        animRef.current = requestAnimationFrame(draw);
      }
    }

    progress = 0;
    cancelAnimationFrame(animRef.current);
    animRef.current = requestAnimationFrame(draw);

    return () => cancelAnimationFrame(animRef.current);
  }, [result, label]);

  return (
    <canvas
      ref={canvasRef}
      class="w-full rounded"
      style={{ height: "90px", color: "var(--color-text-muted)" }}
    />
  );
}

/* ══════════════════════════════════════════════════════════
   Stats Display
   ══════════════════════════════════════════════════════════ */

function StatsRow({ result, label }: { result: ScheduleResult; label?: string }) {
  return (
    <div class="flex flex-wrap gap-3 text-xs">
      {label && <span class="font-semibold text-[var(--color-heading)]">{label}</span>}
      <span class="rounded bg-[var(--color-primary)]/20 px-2 py-0.5 text-[var(--color-primary)]">
        Avg Wait: {result.avgWaiting.toFixed(2)}
      </span>
      <span class="rounded bg-[var(--color-accent)]/20 px-2 py-0.5 text-[var(--color-accent)]">
        Avg Turnaround: {result.avgTurnaround.toFixed(2)}
      </span>
      <span class="rounded bg-amber-500/20 px-2 py-0.5 text-amber-400">
        CPU: {result.cpuUtilization.toFixed(1)}%
      </span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════ */

export default function ProcessScheduler() {
  const [processes, setProcesses] = useState<Process[]>([
    { id: "P1", arrival: 0, burst: 5, priority: 2, color: COLORS[0] },
    { id: "P2", arrival: 1, burst: 3, priority: 1, color: COLORS[1] },
    { id: "P3", arrival: 2, burst: 8, priority: 3, color: COLORS[2] },
    { id: "P4", arrival: 3, burst: 2, priority: 4, color: COLORS[3] },
  ]);

  const [algorithm, setAlgorithm] = useState<Algorithm>("fcfs");
  const [quantum, setQuantum] = useState(2);
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [compareAlgo, setCompareAlgo] = useState<Algorithm | "">("");
  const [compareResult, setCompareResult] = useState<ScheduleResult | null>(null);

  const addProcess = useCallback(() => {
    if (processes.length >= 10) return;
    const nextId = `P${processes.length + 1}`;
    setProcesses((prev) => [
      ...prev,
      { id: nextId, arrival: 0, burst: 4, priority: 1, color: COLORS[prev.length % COLORS.length] },
    ]);
  }, [processes.length]);

  const removeProcess = useCallback((idx: number) => {
    setProcesses((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const updateProcess = useCallback((idx: number, field: keyof Process, value: string | number) => {
    setProcesses((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p))
    );
  }, []);

  const simulate = useCallback(() => {
    const res = runScheduler(processes, algorithm, quantum);
    setResult(res);
    if (compareAlgo) {
      setCompareResult(runScheduler(processes, compareAlgo as Algorithm, quantum));
    } else {
      setCompareResult(null);
    }
  }, [processes, algorithm, quantum, compareAlgo]);

  const randomize = useCallback(() => {
    const count = 4 + Math.floor(Math.random() * 4);
    const procs: Process[] = [];
    for (let i = 0; i < count; i++) {
      procs.push({
        id: `P${i + 1}`,
        arrival: Math.floor(Math.random() * 10),
        burst: 1 + Math.floor(Math.random() * 10),
        priority: 1 + Math.floor(Math.random() * 5),
        color: COLORS[i % COLORS.length],
      });
    }
    setProcesses(procs);
    setResult(null);
    setCompareResult(null);
  }, []);

  return (
    <div class="mx-auto max-w-4xl space-y-4">
      {/* Controls */}
      <div class="flex flex-wrap items-center gap-3">
        <select
          class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]"
          value={algorithm}
          onChange={(e) => setAlgorithm((e.target as HTMLSelectElement).value as Algorithm)}
        >
          {Object.entries(ALGO_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        {algorithm === "rr" && (
          <label class="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            Quantum:
            <input
              type="range" min={1} max={10} value={quantum}
              onInput={(e) => setQuantum(Number((e.target as HTMLInputElement).value))}
              class="w-20"
            />
            <span class="w-4 text-[var(--color-heading)]">{quantum}</span>
          </label>
        )}

        <select
          class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]"
          value={compareAlgo}
          onChange={(e) => setCompareAlgo((e.target as HTMLSelectElement).value as Algorithm | "")}
        >
          <option value="">Compare with...</option>
          {Object.entries(ALGO_LABELS)
            .filter(([k]) => k !== algorithm)
            .map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
        </select>

        <button
          onClick={simulate}
          class="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm font-medium text-white hover:brightness-110"
        >
          Simulate
        </button>

        <button
          onClick={randomize}
          class="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          Random
        </button>
      </div>

      {/* Process Table */}
      <div class="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
              <th class="px-3 py-2">Process</th>
              <th class="px-3 py-2">Arrival</th>
              <th class="px-3 py-2">Burst</th>
              <th class="px-3 py-2">Priority</th>
              <th class="px-3 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {processes.map((p, i) => (
              <tr key={p.id} class="border-b border-[var(--color-border)]/50">
                <td class="px-3 py-1.5">
                  <span class="inline-block w-3 h-3 rounded-sm mr-2" style={{ background: p.color }} />
                  <span class="text-[var(--color-heading)]">{p.id}</span>
                </td>
                <td class="px-3 py-1.5">
                  <input
                    type="number" min={0} max={50} value={p.arrival}
                    onInput={(e) => updateProcess(i, "arrival", Number((e.target as HTMLInputElement).value))}
                    class="w-16 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-0.5 text-[var(--color-text)]"
                  />
                </td>
                <td class="px-3 py-1.5">
                  <input
                    type="number" min={1} max={50} value={p.burst}
                    onInput={(e) => updateProcess(i, "burst", Math.max(1, Number((e.target as HTMLInputElement).value)))}
                    class="w-16 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-0.5 text-[var(--color-text)]"
                  />
                </td>
                <td class="px-3 py-1.5">
                  <input
                    type="number" min={1} max={10} value={p.priority}
                    onInput={(e) => updateProcess(i, "priority", Math.max(1, Number((e.target as HTMLInputElement).value)))}
                    class="w-16 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-0.5 text-[var(--color-text)]"
                  />
                </td>
                <td class="px-3 py-1.5">
                  {processes.length > 1 && (
                    <button
                      onClick={() => removeProcess(i)}
                      class="text-red-400 hover:text-red-300 text-lg leading-none"
                    >
                      x
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {processes.length < 10 && (
          <button
            onClick={addProcess}
            class="w-full py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-primary)] border-t border-[var(--color-border)]/50"
          >
            + Add Process
          </button>
        )}
      </div>

      {/* Gantt Charts */}
      {result && (
        <div class="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <GanttCanvas result={result} label={ALGO_LABELS[algorithm]} />
          <StatsRow result={result} />

          {compareResult && compareAlgo && (
            <>
              <div class="border-t border-[var(--color-border)] pt-3">
                <GanttCanvas result={compareResult} label={ALGO_LABELS[compareAlgo as Algorithm]} />
                <div class="mt-2">
                  <StatsRow result={compareResult} />
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Legend */}
      <div class="flex flex-wrap gap-2 text-xs text-[var(--color-text-muted)]">
        <span>Lower priority number = higher priority.</span>
        <span>Idle time shown in gray.</span>
      </div>
    </div>
  );
}
