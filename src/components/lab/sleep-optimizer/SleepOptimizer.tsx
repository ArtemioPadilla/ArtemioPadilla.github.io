import { useState, useRef, useEffect, useMemo } from "preact/hooks";
import {
  Chart, CategoryScale, LinearScale, PointElement, LineElement,
  LineController, BarElement, BarController, Filler, Legend, Tooltip,
} from "chart.js";

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, LineController, BarElement, BarController, Filler, Legend, Tooltip);

const C = {
  gold: "#d4a843", blue: "#4a9eff", blueDim: "rgba(74,158,255,0.15)",
  green: "#3fb68a", red: "#e05c6a", purple: "#a78bfa", purpleDim: "rgba(167,139,250,0.15)",
  orange: "#f59e0b", muted: "#7d8590",
  gridDark: "rgba(48,54,61,0.5)", gridLight: "rgba(0,0,0,0.06)",
};

function CardTitle({ children }: { children: string }) {
  return (
    <div class="mb-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em]" style={{ color: C.gold }}>
      <span class="inline-block h-1.5 w-1.5 rounded-full" style={{ background: C.gold }} />
      {children}
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 transition-colors hover:border-[var(--color-primary)]">
      <div class="mb-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-text-muted)]">{label}</div>
      <div class="break-all font-mono text-base font-medium" style={{ color: color || "var(--color-text)" }}>{value}</div>
      {sub && <div class="mt-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">{sub}</div>}
    </div>
  );
}

// ─── Sleep Science Constants ─────────────────────────────────────────
const CYCLE_DURATION = 90; // minutes
const SLEEP_ONSET = 14; // avg minutes to fall asleep
const CAFFEINE_HALF_LIFE = 5; // hours
const IDEAL_SLEEP = 8; // hours
const CHRONOTYPES = {
  bear: { label: "Bear", wake: "7:00", sleep: "23:00", peak: "10:00-14:00", desc: "Most common (55%). Best productivity mid-morning. Follows solar cycle." },
  wolf: { label: "Wolf", wake: "7:30", sleep: "0:00", peak: "17:00-21:00", desc: "Night owl (15%). Creative energy peaks in evening. Struggles with early mornings." },
  lion: { label: "Lion", wake: "5:30", sleep: "22:00", peak: "8:00-12:00", desc: "Early riser (15%). Most productive in morning. Energy drops after lunch." },
  dolphin: { label: "Dolphin", wake: "6:30", sleep: "23:30", peak: "15:00-21:00", desc: "Light sleeper (10%). Irregular patterns. Often insomnia-prone." },
};

type Chronotype = keyof typeof CHRONOTYPES;

function parseTime(t: string): number { const [h, m] = t.split(":").map(Number); return h * 60 + m; }
function fmtTime(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
}
function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ─── Main Component ──────────────────────────────────────────────────
export default function SleepOptimizer() {
  const [targetWake, setTargetWake] = useState("7:00");
  const [currentBedtime, setCurrentBedtime] = useState("23:00");
  const [sleepOnset, setSleepOnset] = useState(SLEEP_ONSET);
  const [chronotype, setChronotype] = useState<Chronotype>("bear");

  // Caffeine tracking
  const [caffeineIntakes, setCaffeineIntakes] = useState<{ id: number; time: string; mg: number }[]>([]);
  const [nextCafId, setNextCafId] = useState(1);
  const [cafTime, setCafTime] = useState("9:00");
  const [cafMg, setCafMg] = useState(95); // standard coffee

  // Sleep debt
  const [weekLog, setWeekLog] = useState<number[]>([7, 7, 7, 7, 7, 8, 8]); // hours per day, Mon-Sun

  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInst = useRef<Chart | null>(null);

  // ── Calculations ──
  const wakeMin = parseTime(targetWake);
  const bedMin = parseTime(currentBedtime);
  const sleepDuration = useMemo(() => {
    let d = wakeMin - bedMin - sleepOnset;
    if (d < 0) d += 1440;
    return d;
  }, [wakeMin, bedMin, sleepOnset]);

  const cycles = Math.floor(sleepDuration / CYCLE_DURATION);
  const sleepHours = sleepDuration / 60;

  // Optimal bedtimes (wake up at end of a cycle)
  const optimalBedtimes = useMemo(() => {
    const times: { time: string; cycles: number; hours: number }[] = [];
    for (let c = 4; c <= 7; c++) {
      const totalMin = c * CYCLE_DURATION + sleepOnset;
      const bedtime = ((wakeMin - totalMin) % 1440 + 1440) % 1440;
      times.push({ time: fmtTime(bedtime), cycles: c, hours: (c * CYCLE_DURATION) / 60 });
    }
    return times;
  }, [wakeMin, sleepOnset]);

  // Caffeine at bedtime
  const caffeineAtBedtime = useMemo(() => {
    return caffeineIntakes.reduce((total, intake) => {
      const intakeMin = parseTime(intake.time);
      let hoursElapsed = (bedMin - intakeMin) / 60;
      if (hoursElapsed < 0) hoursElapsed += 24;
      const remaining = intake.mg * Math.pow(0.5, hoursElapsed / CAFFEINE_HALF_LIFE);
      return total + remaining;
    }, 0);
  }, [caffeineIntakes, bedMin]);

  // Sleep debt
  const weeklyDebt = useMemo(() => {
    const idealWeekly = IDEAL_SLEEP * 7;
    const actual = weekLog.reduce((a, b) => a + b, 0);
    return idealWeekly - actual;
  }, [weekLog]);

  const avgSleep = useMemo(() => weekLog.reduce((a, b) => a + b, 0) / 7, [weekLog]);

  // Sleep quality score
  const qualityScore = useMemo(() => {
    let score = 50;
    // Duration
    if (sleepHours >= 7 && sleepHours <= 9) score += 25;
    else if (sleepHours >= 6) score += 10;
    else score -= 15;
    // Cycles (complete)
    const remainder = sleepDuration % CYCLE_DURATION;
    if (remainder < 15) score += 15; // waking near cycle end
    else score -= 5;
    // Caffeine
    if (caffeineAtBedtime < 25) score += 10;
    else if (caffeineAtBedtime < 50) score -= 5;
    else score -= 15;
    // Debt
    if (weeklyDebt <= 2) score += 10;
    else if (weeklyDebt > 5) score -= 10;
    return Math.max(0, Math.min(100, score));
  }, [sleepHours, sleepDuration, caffeineAtBedtime, weeklyDebt]);

  const qualityLabel = qualityScore >= 80 ? "Excellent" : qualityScore >= 60 ? "Good" : qualityScore >= 40 ? "Fair" : "Poor";
  const qualityColor = qualityScore >= 80 ? C.green : qualityScore >= 60 ? C.blue : qualityScore >= 40 ? C.orange : C.red;

  // ── Caffeine chart ──
  useEffect(() => {
    if (!chartRef.current) return;
    chartInst.current?.destroy();
    const isDark = !document.documentElement.classList.contains("light");
    const gridColor = isDark ? C.gridDark : C.gridLight;
    const textColor = isDark ? "#e4e4e7" : "#3f3f46";

    // Generate 24-hour caffeine curve
    const labels: string[] = [];
    const data: number[] = [];
    for (let h = 0; h < 24; h++) {
      const timeMin = h * 60;
      labels.push(fmtTime(timeMin));
      let total = 0;
      for (const intake of caffeineIntakes) {
        const intakeMin = parseTime(intake.time);
        let hoursElapsed = (timeMin - intakeMin) / 60;
        if (hoursElapsed < 0) hoursElapsed += 24;
        if (hoursElapsed >= 0 && hoursElapsed < 24) {
          total += intake.mg * Math.pow(0.5, hoursElapsed / CAFFEINE_HALF_LIFE);
        }
      }
      data.push(Math.round(total));
    }

    chartInst.current = new Chart(chartRef.current, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Caffeine (mg)", data, borderColor: C.orange, backgroundColor: C.orange + "22", fill: true, tension: 0.4 },
          { label: "Sleep threshold (25mg)", data: Array(24).fill(25), borderColor: C.red, borderDash: [5, 5], pointRadius: 0 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, maxTicksLimit: 12 } },
          y: { min: 0, grid: { color: gridColor }, ticks: { color: textColor } },
        },
        plugins: { legend: { labels: { color: textColor, font: { family: "monospace", size: 11 } } } },
      },
    });
    return () => { chartInst.current?.destroy(); chartInst.current = null; };
  }, [caffeineIntakes]);

  function addCaffeine() {
    const id = nextCafId; setNextCafId(id + 1);
    setCaffeineIntakes(p => [...p, { id, time: cafTime, mg: cafMg }]);
  }
  function removeCaffeine(id: number) { setCaffeineIntakes(p => p.filter(c => c.id !== id)); }

  const chrono = CHRONOTYPES[chronotype];

  return (
    <div class="space-y-6">
      {/* Summary */}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Sleep Quality" value={qualityLabel} sub={`${qualityScore}/100`} color={qualityColor} />
        <StatCard label="Duration" value={fmtDuration(sleepDuration)} sub={`${cycles} cycles`} color={sleepHours >= 7 ? C.green : C.red} />
        <StatCard label="Caffeine @ Bed" value={`${caffeineAtBedtime.toFixed(0)}mg`} color={caffeineAtBedtime < 25 ? C.green : caffeineAtBedtime < 50 ? C.orange : C.red} />
        <StatCard label="Sleep Debt" value={weeklyDebt > 0 ? `${weeklyDebt.toFixed(1)}h` : "None"} color={weeklyDebt <= 2 ? C.green : weeklyDebt <= 5 ? C.orange : C.red} sub="this week" />
      </div>

      <div class="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Left */}
        <div class="space-y-4">
          {/* Schedule */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Sleep Schedule</CardTitle>
            <div class="grid gap-4 sm:grid-cols-3">
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Target Wake</label>
                <input type="time" value={targetWake} onInput={(e: any) => setTargetWake(e.target.value)}
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Bedtime</label>
                <input type="time" value={currentBedtime} onInput={(e: any) => setCurrentBedtime(e.target.value)}
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Fall Asleep (min)</label>
                <input type="number" value={sleepOnset} onInput={(e: any) => setSleepOnset(Math.max(0, +e.target.value))}
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
            </div>
          </div>

          {/* Optimal bedtimes */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Optimal Bedtimes</CardTitle>
            <p class="mb-3 font-mono text-[10px] text-[var(--color-text-muted)]">Wake at end of a 90-min sleep cycle to feel refreshed. Target: {targetWake}</p>
            <div class="grid gap-2 sm:grid-cols-2">
              {optimalBedtimes.map(b => {
                const isIdeal = b.cycles >= 5 && b.cycles <= 6;
                return (
                  <div key={b.cycles} class={`flex items-center justify-between rounded border p-3 ${isIdeal ? "border-green-500/50 bg-green-500/5" : "border-[var(--color-border)] bg-[var(--color-bg)]"}`}>
                    <div>
                      <span class="font-mono text-lg font-bold text-[var(--color-heading)]">{b.time}</span>
                      {isIdeal && <span class="ml-2 rounded bg-green-500/20 px-1.5 py-0.5 font-mono text-[9px] text-green-400">IDEAL</span>}
                    </div>
                    <div class="text-right font-mono text-[10px] text-[var(--color-text-muted)]">
                      <div>{b.cycles} cycles</div>
                      <div>{b.hours}h sleep</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Caffeine tracker */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Caffeine Tracker</CardTitle>
            <div class="mb-3 flex flex-wrap gap-2">
              <input type="time" value={cafTime} onInput={(e: any) => setCafTime(e.target.value)}
                class="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 font-mono text-xs text-[var(--color-text)] outline-none" />
              <select value={cafMg} onChange={(e: any) => setCafMg(+e.target.value)}
                class="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 font-mono text-xs text-[var(--color-text)] outline-none">
                <option value="95">Coffee (95mg)</option>
                <option value="63">Espresso (63mg)</option>
                <option value="47">Black tea (47mg)</option>
                <option value="28">Green tea (28mg)</option>
                <option value="34">Cola (34mg)</option>
                <option value="160">Energy drink (160mg)</option>
                <option value="200">Pre-workout (200mg)</option>
              </select>
              <button onClick={addCaffeine} class="rounded px-3 py-1.5 font-mono text-xs text-[var(--color-bg)]" style={{ background: C.gold }}>Add</button>
            </div>
            {caffeineIntakes.length > 0 && (
              <div class="mb-3 flex flex-wrap gap-2">
                {caffeineIntakes.map(c => (
                  <span key={c.id} class="flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-[10px] text-[var(--color-text)]">
                    {c.time} — {c.mg}mg
                    <button onClick={() => removeCaffeine(c.id)} class="text-[var(--color-text-muted)] hover:text-red-400">✕</button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ height: "220px" }}><canvas ref={chartRef} /></div>
            <p class="mt-2 font-mono text-[10px] text-[var(--color-text-muted)]">
              Caffeine half-life: ~5h. Below 25mg at bedtime is ideal. Red dashed line = sleep threshold.
            </p>
          </div>

          {/* Weekly sleep log */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Weekly Sleep Log</CardTitle>
            <div class="grid grid-cols-7 gap-2">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, i) => (
                <div key={day} class="text-center">
                  <div class="mb-1 font-mono text-[9px] text-[var(--color-text-muted)]">{day}</div>
                  <input type="number" min="0" max="14" step="0.5" value={weekLog[i]}
                    onInput={(e: any) => { const nl = [...weekLog]; nl[i] = +e.target.value; setWeekLog(nl); }}
                    class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-1 text-center font-mono text-xs text-[var(--color-text)] outline-none" />
                  <div class="mt-1 h-1.5 rounded-full" style={{ background: weekLog[i] >= 7 ? C.green : weekLog[i] >= 6 ? C.orange : C.red }} />
                </div>
              ))}
            </div>
            <div class="mt-3 flex justify-between font-mono text-[10px] text-[var(--color-text-muted)]">
              <span>Avg: {avgSleep.toFixed(1)}h/night</span>
              <span>Debt: {weeklyDebt > 0 ? `${weeklyDebt.toFixed(1)}h` : "None"}</span>
              <span>Ideal: {IDEAL_SLEEP}h × 7 = {IDEAL_SLEEP * 7}h</span>
            </div>
          </div>
        </div>

        {/* Right */}
        <div class="space-y-4">
          {/* Chronotype */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Chronotype</CardTitle>
            <div class="mb-3 grid grid-cols-2 gap-2">
              {(Object.keys(CHRONOTYPES) as Chronotype[]).map(k => (
                <button key={k} onClick={() => setChronotype(k)}
                  class={`rounded border p-2 font-mono text-xs transition-colors ${chronotype === k ? "text-[var(--color-bg)]" : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)]"}`}
                  style={chronotype === k ? { background: C.purple, borderColor: C.purple } : undefined}>
                  {CHRONOTYPES[k].label}
                </button>
              ))}
            </div>
            <div class="space-y-2 font-mono text-xs">
              <p class="text-[var(--color-text)]">{chrono.desc}</p>
              <div class="grid grid-cols-2 gap-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 text-[10px]">
                <div><span class="text-[var(--color-text-muted)]">Wake:</span> <span class="text-[var(--color-text)]">{chrono.wake}</span></div>
                <div><span class="text-[var(--color-text-muted)]">Sleep:</span> <span class="text-[var(--color-text)]">{chrono.sleep}</span></div>
                <div class="col-span-2"><span class="text-[var(--color-text-muted)]">Peak:</span> <span style={{ color: C.green }}>{chrono.peak}</span></div>
              </div>
            </div>
          </div>

          {/* Tips */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Sleep Tips</CardTitle>
            <div class="space-y-2 font-mono text-[10px] text-[var(--color-text-muted)]">
              {caffeineAtBedtime >= 25 && <div class="rounded bg-red-500/10 p-2 text-red-400">Stop caffeine at least 8h before bed. Your last safe coffee: {fmtTime(bedMin - 8 * 60)}</div>}
              {sleepHours < 7 && <div class="rounded bg-orange-500/10 p-2 text-orange-400">You're getting {sleepHours.toFixed(1)}h. Adults need 7-9h for optimal health.</div>}
              {weeklyDebt > 5 && <div class="rounded bg-red-500/10 p-2 text-red-400">High sleep debt ({weeklyDebt.toFixed(1)}h). Can't fully "catch up" on weekends.</div>}
              {sleepDuration % CYCLE_DURATION > 20 && <div class="rounded bg-blue-500/10 p-2 text-blue-400">You may wake mid-cycle. Try sleeping at {optimalBedtimes.find(b => b.cycles === 5)?.time || "earlier"} for 5 complete cycles.</div>}
              <div class="rounded bg-[var(--color-bg)] p-2">Keep room at 18-20°C. Dim lights 1h before bed. No screens 30min before.</div>
              <div class="rounded bg-[var(--color-bg)] p-2">Consistent wake time (even weekends) is the #1 factor for sleep quality.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
