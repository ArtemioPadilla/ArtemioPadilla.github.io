import { useState, useRef, useEffect, useMemo } from "preact/hooks";
import {
  Chart, CategoryScale, LinearScale, PointElement, LineElement,
  LineController, BarElement, BarController, Filler, Legend, Tooltip,
} from "chart.js";

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, LineController, BarElement, BarController, Filler, Legend, Tooltip);

const C = {
  gold: "#d4a843", goldDim: "rgba(212,168,67,0.15)",
  blue: "#4a9eff", blueDim: "rgba(74,158,255,0.15)",
  green: "#3fb68a", greenDim: "rgba(63,182,138,0.15)",
  red: "#e05c6a", purple: "#a78bfa", orange: "#f59e0b",
  muted: "#7d8590", gridDark: "rgba(48,54,61,0.5)", gridLight: "rgba(0,0,0,0.06)",
};

const COLORS = [C.green, C.blue, C.gold, C.purple, C.orange, C.red];

// ─── Types ───────────────────────────────────────────────────────────
interface Habit {
  id: number;
  name: string;
  unit: string;
  dailyTarget: number;
  compoundDescription: string; // e.g. "books/year" at this rate
  color: string;
  completedDays: Set<string>; // "YYYY-MM-DD" strings
}

// ─── Helpers ─────────────────────────────────────────────────────────
function dateKey(d: Date) { return d.toISOString().slice(0, 10); }
function today() { return dateKey(new Date()); }

function getStreak(completed: Set<string>): number {
  let streak = 0;
  const d = new Date();
  // Check if today is complete
  if (!completed.has(dateKey(d))) {
    // Check yesterday (allow current-day gap)
    d.setDate(d.getDate() - 1);
    if (!completed.has(dateKey(d))) return 0;
  }
  while (completed.has(dateKey(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function getLongestStreak(completed: Set<string>): number {
  if (completed.size === 0) return 0;
  const sorted = Array.from(completed).sort();
  let max = 1, current = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diff = (curr.getTime() - prev.getTime()) / 86400000;
    if (diff === 1) { current++; max = Math.max(max, current); }
    else { current = 1; }
  }
  return max;
}

function getCompletionRate(completed: Set<string>, daysBack: number): number {
  const d = new Date();
  let total = 0;
  for (let i = 0; i < daysBack; i++) {
    if (completed.has(dateKey(d))) total++;
    d.setDate(d.getDate() - 1);
  }
  return daysBack > 0 ? (total / daysBack) * 100 : 0;
}

// ─── Sub-components ──────────────────────────────────────────────────
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

// ─── Preset Habits ───────────────────────────────────────────────────
const PRESETS: { name: string; unit: string; dailyTarget: number; compound: string }[] = [
  { name: "Read", unit: "pages", dailyTarget: 20, compound: "~30 books/year (at 250 pages each)" },
  { name: "Exercise", unit: "minutes", dailyTarget: 30, compound: "~182 hours/year of fitness" },
  { name: "Meditate", unit: "minutes", dailyTarget: 10, compound: "~61 hours/year of mindfulness" },
  { name: "Write", unit: "words", dailyTarget: 500, compound: "~182K words/year (2 novels)" },
  { name: "Save Money", unit: "MXN", dailyTarget: 200, compound: "$73K/year or $1.46M in 20 years at 8%" },
  { name: "Learn Language", unit: "minutes", dailyTarget: 15, compound: "~91 hours/year (B1 in 2 years)" },
  { name: "Walk", unit: "steps", dailyTarget: 10000, compound: "~3,650 km/year" },
  { name: "Code", unit: "minutes", dailyTarget: 60, compound: "~365 hours/year of practice" },
];

// ─── Main Component ──────────────────────────────────────────────────
export default function HabitTracker() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [nextId, setNextId] = useState(1);
  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState("minutes");
  const [newTarget, setNewTarget] = useState(30);
  const [newCompound, setNewCompound] = useState("");
  const [projectionMonths, setProjectionMonths] = useState(12);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInst = useRef<Chart | null>(null);

  // ── Totals ──
  const totalStreaks = useMemo(() => habits.reduce((s, h) => s + getStreak(h.completedDays), 0), [habits]);
  const avgCompletion = useMemo(() => {
    if (habits.length === 0) return 0;
    return habits.reduce((s, h) => s + getCompletionRate(h.completedDays, 30), 0) / habits.length;
  }, [habits]);

  // ── CRUD ──
  function addHabit() {
    if (!newName.trim()) return;
    const id = nextId; setNextId(id + 1);
    setHabits(p => [...p, { id, name: newName, unit: newUnit, dailyTarget: newTarget, compoundDescription: newCompound, color: COLORS[(id - 1) % COLORS.length], completedDays: new Set() }]);
    setNewName(""); setNewCompound("");
  }
  function removeHabit(id: number) { setHabits(p => p.filter(h => h.id !== id)); }
  function loadPreset(preset: typeof PRESETS[0]) {
    setNewName(preset.name); setNewUnit(preset.unit); setNewTarget(preset.dailyTarget); setNewCompound(preset.compound);
  }
  function toggleDay(habitId: number, day: string) {
    setHabits(p => p.map(h => {
      if (h.id !== habitId) return h;
      const s = new Set(h.completedDays);
      if (s.has(day)) s.delete(day); else s.add(day);
      return { ...h, completedDays: s };
    }));
  }

  // ── Calendar helpers ──
  function getLast28Days(): string[] {
    const days: string[] = [];
    const d = new Date();
    for (let i = 27; i >= 0; i--) {
      const dd = new Date(d);
      dd.setDate(dd.getDate() - i);
      days.push(dateKey(dd));
    }
    return days;
  }
  const last28 = useMemo(getLast28Days, []);

  // ── Projection Chart ──
  useEffect(() => {
    if (!chartRef.current || habits.length === 0) return;
    chartInst.current?.destroy();
    const isDark = !document.documentElement.classList.contains("light");
    const gridColor = isDark ? C.gridDark : C.gridLight;
    const textColor = isDark ? "#e4e4e7" : "#3f3f46";

    const labels: string[] = [];
    for (let m = 0; m <= projectionMonths; m++) labels.push(`Month ${m}`);

    const datasets = habits.map(h => {
      const rate = getCompletionRate(h.completedDays, 30) / 100;
      const dailyActual = h.dailyTarget * rate;
      const data = labels.map((_, m) => Math.round(dailyActual * 30 * m));
      return { label: `${h.name} (${h.unit})`, data, borderColor: h.color, backgroundColor: h.color + "22", fill: true, tension: 0.3 };
    });

    chartInst.current = new Chart(chartRef.current, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor } },
          y: { grid: { color: gridColor }, ticks: { color: textColor } },
        },
        plugins: { legend: { labels: { color: textColor, font: { family: "monospace", size: 11 } } } },
      },
    });
    return () => { chartInst.current?.destroy(); chartInst.current = null; };
  }, [habits, projectionMonths]);

  return (
    <div class="space-y-6">
      {/* Summary */}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Active Habits" value={String(habits.length)} color={C.blue} />
        <StatCard label="Total Streaks" value={`${totalStreaks} days`} color={C.green} />
        <StatCard label="30-Day Avg" value={`${avgCompletion.toFixed(0)}%`} color={avgCompletion >= 80 ? C.green : avgCompletion >= 50 ? C.orange : C.red} />
        <StatCard label="Today" value={`${habits.filter(h => h.completedDays.has(today())).length}/${habits.length}`} color={C.gold} sub="completed" />
      </div>

      <div class="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Left: Habits + Calendar */}
        <div class="space-y-4">
          {/* Add habit form */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Add Habit</CardTitle>
            <div class="mb-3 flex flex-wrap gap-2">
              {PRESETS.map(p => (
                <button key={p.name} onClick={() => loadPreset(p)}
                  class="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-text)]">{p.name}</button>
              ))}
            </div>
            <div class="grid gap-3 sm:grid-cols-3">
              <input type="text" value={newName} onInput={(e: any) => setNewName(e.target.value)} placeholder="Habit name"
                class="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              <div class="flex gap-2">
                <input type="number" value={newTarget} onInput={(e: any) => setNewTarget(+e.target.value)} min="1"
                  class="w-20 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
                <input type="text" value={newUnit} onInput={(e: any) => setNewUnit(e.target.value)} placeholder="unit"
                  class="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <button onClick={addHabit}
                class="rounded px-4 py-2 font-mono text-xs font-bold text-[var(--color-bg)] transition-colors hover:opacity-90" style={{ background: C.gold }}>Add Habit</button>
            </div>
            {newCompound && <p class="mt-2 font-mono text-[10px] text-[var(--color-text-muted)]">Compounding: {newCompound}</p>}
          </div>

          {/* Habit Calendar Grid */}
          {habits.map(h => {
            const streak = getStreak(h.completedDays);
            const longest = getLongestStreak(h.completedDays);
            const rate = getCompletionRate(h.completedDays, 30);
            return (
              <div key={h.id} class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <div class="mb-3 flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="inline-block h-3 w-3 rounded-full" style={{ background: h.color }} />
                    <span class="font-mono text-sm font-bold text-[var(--color-heading)]">{h.name}</span>
                    <span class="font-mono text-[10px] text-[var(--color-text-muted)]">{h.dailyTarget} {h.unit}/day</span>
                  </div>
                  <div class="flex items-center gap-3">
                    <span class="font-mono text-xs" style={{ color: streak > 0 ? C.green : C.muted }}>🔥 {streak}d</span>
                    <span class="font-mono text-xs text-[var(--color-text-muted)]">Best: {longest}d</span>
                    <span class="font-mono text-xs text-[var(--color-text-muted)]">{rate.toFixed(0)}%</span>
                    <button onClick={() => removeHabit(h.id)} class="text-[var(--color-text-muted)] hover:text-red-400 text-xs">✕</button>
                  </div>
                </div>
                {/* 28-day grid */}
                <div class="flex flex-wrap gap-1">
                  {last28.map(day => {
                    const done = h.completedDays.has(day);
                    const isToday = day === today();
                    return (
                      <button key={day} onClick={() => toggleDay(h.id, day)}
                        class={`h-7 w-7 rounded text-center font-mono text-[9px] transition-colors ${isToday ? "ring-1 ring-[var(--color-primary)]" : ""}`}
                        style={{ background: done ? h.color : "var(--color-bg)", color: done ? "#fff" : "var(--color-text-muted)", border: `1px solid ${done ? h.color : "var(--color-border)"}` }}
                        title={day}>
                        {new Date(day + "T12:00:00").getDate()}
                      </button>
                    );
                  })}
                </div>
                {h.compoundDescription && (
                  <p class="mt-2 font-mono text-[10px] text-[var(--color-text-muted)]">At 100% consistency: {h.compoundDescription}</p>
                )}
              </div>
            );
          })}

          {habits.length === 0 && (
            <div class="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
              <p class="font-mono text-sm text-[var(--color-text-muted)]">Add a habit to start tracking. Click a preset above or enter your own.</p>
            </div>
          )}
        </div>

        {/* Right: Projection */}
        <div class="space-y-4">
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Compounding Projection</CardTitle>
            <div class="mb-3 flex items-center gap-2">
              <span class="font-mono text-xs text-[var(--color-text-muted)]">Months:</span>
              <input type="range" min="3" max="60" value={projectionMonths} onInput={(e: any) => setProjectionMonths(+e.target.value)} class="flex-1 accent-[#d4a843]" />
              <span class="font-mono text-xs text-[var(--color-text)]">{projectionMonths}</span>
            </div>
            <div style={{ height: "280px" }}>
              <canvas ref={chartRef} />
            </div>
            <p class="mt-2 font-mono text-[10px] text-[var(--color-text-muted)]">
              Projection based on your actual 30-day completion rate applied forward.
            </p>
          </div>

          {/* Per-habit stats */}
          {habits.length > 0 && (
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <CardTitle>Habit Stats</CardTitle>
              <div class="space-y-3">
                {habits.map(h => {
                  const rate = getCompletionRate(h.completedDays, 30);
                  const dailyActual = h.dailyTarget * (rate / 100);
                  const yearProjection = dailyActual * 365;
                  return (
                    <div key={h.id} class="rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                      <div class="flex items-center gap-2 mb-2">
                        <span class="inline-block h-2 w-2 rounded-full" style={{ background: h.color }} />
                        <span class="font-mono text-xs font-bold text-[var(--color-heading)]">{h.name}</span>
                      </div>
                      <div class="grid grid-cols-2 gap-2 font-mono text-[10px]">
                        <div><span class="text-[var(--color-text-muted)]">Daily avg:</span> <span class="text-[var(--color-text)]">{dailyActual.toFixed(1)} {h.unit}</span></div>
                        <div><span class="text-[var(--color-text-muted)]">Year proj:</span> <span class="text-[var(--color-text)]">{yearProjection.toFixed(0)} {h.unit}</span></div>
                        <div><span class="text-[var(--color-text-muted)]">Streak:</span> <span style={{ color: C.green }}>{getStreak(h.completedDays)}d</span></div>
                        <div><span class="text-[var(--color-text-muted)]">Completion:</span> <span style={{ color: rate >= 80 ? C.green : rate >= 50 ? C.orange : C.red }}>{rate.toFixed(0)}%</span></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
