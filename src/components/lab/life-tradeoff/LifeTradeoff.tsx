import { useState, useRef, useEffect, useMemo } from "preact/hooks";
import {
  Chart, ArcElement, DoughnutController, CategoryScale, LinearScale,
  BarElement, BarController, Legend, Tooltip,
} from "chart.js";

Chart.register(ArcElement, DoughnutController, CategoryScale, LinearScale, BarElement, BarController, Legend, Tooltip);

const C = {
  gold: "#d4a843", blue: "#4a9eff", green: "#3fb68a", red: "#e05c6a",
  purple: "#a78bfa", orange: "#f59e0b", cyan: "#22d3ee", pink: "#f472b6",
  muted: "#7d8590", gridDark: "rgba(48,54,61,0.5)", gridLight: "rgba(0,0,0,0.06)",
};

const TOTAL_HOURS = 168;

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

// ─── Types ───────────────────────────────────────────────────────────
interface Category {
  id: number;
  name: string;
  hours: number;
  color: string;
  icon: string;
  isFixed: boolean; // sleep, work are semi-fixed
}

interface Phase {
  id: number;
  name: string;
  ageStart: number;
  ageEnd: number;
  allocations: Record<number, number>; // categoryId -> hours
}

const CATEGORY_COLORS = [C.blue, C.green, C.purple, C.orange, C.red, C.cyan, C.pink, C.gold];

const DEFAULT_CATEGORIES: Omit<Category, "id">[] = [
  { name: "Sleep", hours: 56, color: C.purple, icon: "😴", isFixed: true },
  { name: "Work", hours: 45, color: C.blue, icon: "💼", isFixed: false },
  { name: "Commute", hours: 5, color: C.muted, icon: "🚗", isFixed: false },
  { name: "Exercise", hours: 5, color: C.green, icon: "🏃", isFixed: false },
  { name: "Family/Social", hours: 15, color: C.orange, icon: "👨‍👩‍👧", isFixed: false },
  { name: "Learning", hours: 7, color: C.cyan, icon: "📚", isFixed: false },
  { name: "Hobbies", hours: 10, color: C.pink, icon: "🎨", isFixed: false },
  { name: "Self-care", hours: 14, color: C.gold, icon: "🧘", isFixed: false },
  { name: "Chores", hours: 7, color: C.red, icon: "🏠", isFixed: false },
];

const PHASE_PRESETS: { name: string; ages: [number, number]; adjustments: Record<string, number> }[] = [
  { name: "College Student", ages: [18, 22], adjustments: { Work: 15, Learning: 25, "Family/Social": 20, Commute: 2 } },
  { name: "Early Career", ages: [23, 30], adjustments: { Work: 50, Learning: 10, Exercise: 5, Commute: 7 } },
  { name: "Parent (young kids)", ages: [28, 38], adjustments: { "Family/Social": 30, Work: 40, Hobbies: 3, Exercise: 3 } },
  { name: "Mid Career", ages: [35, 50], adjustments: { Work: 50, "Family/Social": 15, Learning: 5, Hobbies: 7 } },
  { name: "Pre-Retirement", ages: [50, 65], adjustments: { Work: 40, Exercise: 7, Hobbies: 12, Learning: 8 } },
  { name: "Retirement", ages: [65, 85], adjustments: { Work: 0, Hobbies: 25, Exercise: 10, "Family/Social": 25, Learning: 10 } },
];

export default function LifeTradeoff() {
  const [categories, setCategories] = useState<Category[]>(
    DEFAULT_CATEGORIES.map((c, i) => ({ ...c, id: i + 1 }))
  );
  const [nextCatId, setNextCatId] = useState(DEFAULT_CATEGORIES.length + 1);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [nextPhaseId, setNextPhaseId] = useState(1);
  const [showPhases, setShowPhases] = useState(false);
  const [currentAge, setCurrentAge] = useState(28);
  const [lifeExpectancy, setLifeExpectancy] = useState(80);

  const doughnutRef = useRef<HTMLCanvasElement>(null);
  const doughnutInst = useRef<Chart | null>(null);
  const barRef = useRef<HTMLCanvasElement>(null);
  const barInst = useRef<Chart | null>(null);

  const allocated = useMemo(() => categories.reduce((s, c) => s + c.hours, 0), [categories]);
  const remaining = TOTAL_HOURS - allocated;
  const overBudget = remaining < 0;

  // Opportunity cost: for every hour added to X, it must come from somewhere
  const yearlyHours = useMemo(() => categories.map(c => ({ ...c, yearly: c.hours * 52, daily: c.hours / 7 })), [categories]);

  // Lifetime hours remaining
  const yearsLeft = Math.max(0, lifeExpectancy - currentAge);
  const lifetimeHours = useMemo(() => categories.map(c => ({
    name: c.name, color: c.color, hours: c.hours * 52 * yearsLeft,
    pct: (c.hours / TOTAL_HOURS) * 100,
  })), [categories, yearsLeft]);

  // ── CRUD ──
  function setHours(id: number, h: number) {
    setCategories(p => p.map(c => c.id === id ? { ...c, hours: Math.max(0, h) } : c));
  }
  function addCategory() {
    const id = nextCatId; setNextCatId(id + 1);
    setCategories(p => [...p, { id, name: "New Category", hours: 0, color: CATEGORY_COLORS[(id - 1) % CATEGORY_COLORS.length], icon: "📌", isFixed: false }]);
  }
  function removeCategory(id: number) { setCategories(p => p.filter(c => c.id !== id)); }
  function setCatName(id: number, name: string) { setCategories(p => p.map(c => c.id === id ? { ...c, name } : c)); }

  function addPhaseFromPreset(preset: typeof PHASE_PRESETS[0]) {
    const id = nextPhaseId; setNextPhaseId(id + 1);
    const allocs: Record<number, number> = {};
    categories.forEach(c => {
      allocs[c.id] = preset.adjustments[c.name] ?? c.hours;
    });
    setPhases(p => [...p, { id, name: preset.name, ageStart: preset.ages[0], ageEnd: preset.ages[1], allocations: allocs }]);
    setShowPhases(true);
  }
  function removePhase(id: number) { setPhases(p => p.filter(ph => ph.id !== id)); }

  // ── Doughnut Chart ──
  useEffect(() => {
    if (!doughnutRef.current) return;
    doughnutInst.current?.destroy();
    const isDark = !document.documentElement.classList.contains("light");
    const textColor = isDark ? "#e4e4e7" : "#3f3f46";

    const data = categories.filter(c => c.hours > 0).map(c => c.hours);
    const colors = categories.filter(c => c.hours > 0).map(c => c.color);
    const labels = categories.filter(c => c.hours > 0).map(c => `${c.icon} ${c.name}`);
    if (remaining > 0) { data.push(remaining); colors.push("#333"); labels.push("Unallocated"); }

    doughnutInst.current = new Chart(doughnutRef.current, {
      type: "doughnut",
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "60%",
        plugins: { legend: { position: "bottom" as const, labels: { color: textColor, font: { family: "monospace", size: 10 }, padding: 8 } } },
      },
    });
    return () => { doughnutInst.current?.destroy(); doughnutInst.current = null; };
  }, [categories, remaining]);

  // ── Lifetime Bar Chart ──
  useEffect(() => {
    if (!barRef.current) return;
    barInst.current?.destroy();
    const isDark = !document.documentElement.classList.contains("light");
    const gridColor = isDark ? C.gridDark : C.gridLight;
    const textColor = isDark ? "#e4e4e7" : "#3f3f46";

    barInst.current = new Chart(barRef.current, {
      type: "bar",
      data: {
        labels: lifetimeHours.map(l => l.name),
        datasets: [{
          label: "Lifetime Hours Remaining",
          data: lifetimeHours.map(l => l.hours),
          backgroundColor: lifetimeHours.map(l => l.color),
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: "y" as const,
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, callback: (v: any) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v) } },
          y: { grid: { display: false }, ticks: { color: textColor, font: { family: "monospace", size: 10 } } },
        },
        plugins: { legend: { display: false } },
      },
    });
    return () => { barInst.current?.destroy(); barInst.current = null; };
  }, [lifetimeHours]);

  return (
    <div class="space-y-6">
      {/* Summary */}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Allocated" value={`${allocated}h`} sub={`of ${TOTAL_HOURS}h/week`} color={overBudget ? C.red : C.green} />
        <StatCard label="Remaining" value={overBudget ? `${Math.abs(remaining)}h over!` : `${remaining}h`} color={overBudget ? C.red : C.blue} />
        <StatCard label="Years Left" value={String(yearsLeft)} sub={`life expectancy: ${lifeExpectancy}`} color={C.purple} />
        <StatCard label="Categories" value={String(categories.length)} color={C.gold} />
      </div>

      <div class="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Left: Allocation sliders */}
        <div class="space-y-4">
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Weekly Time Allocation</CardTitle>
            <p class="mb-4 font-mono text-[10px] text-[var(--color-text-muted)]">You have {TOTAL_HOURS} hours per week. Allocate them across life categories.</p>
            {overBudget && <div class="mb-4 rounded bg-red-500/10 p-2 font-mono text-xs text-red-400">Over budget by {Math.abs(remaining)}h! Reduce allocations.</div>}

            <div class="space-y-3">
              {categories.map(c => (
                <div key={c.id} class="flex items-center gap-3">
                  <span class="w-5 text-center">{c.icon}</span>
                  <input type="text" value={c.name} onInput={(e: any) => setCatName(c.id, e.target.value)}
                    class="w-28 bg-transparent font-mono text-xs text-[var(--color-heading)] outline-none" />
                  <input type="range" min="0" max="80" value={c.hours} onInput={(e: any) => setHours(c.id, +e.target.value)}
                    class="flex-1 accent-[#d4a843]" />
                  <input type="number" min="0" max="168" value={c.hours} onInput={(e: any) => setHours(c.id, +e.target.value)}
                    class="w-14 rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-1 text-center font-mono text-xs text-[var(--color-text)] outline-none" />
                  <span class="w-12 font-mono text-[10px] text-[var(--color-text-muted)]">{(c.hours / 7).toFixed(1)}h/d</span>
                  <div class="h-2 w-16 overflow-hidden rounded-full bg-[var(--color-border)]">
                    <div class="h-full rounded-full" style={{ width: `${(c.hours / TOTAL_HOURS) * 100}%`, background: c.color }} />
                  </div>
                  <button onClick={() => removeCategory(c.id)} class="text-[var(--color-text-muted)] hover:text-red-400 text-xs">✕</button>
                </div>
              ))}
            </div>
            <button onClick={addCategory} class="mt-3 rounded border border-dashed border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)]">+ Add Category</button>
          </div>

          {/* Opportunity Cost */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Opportunity Cost</CardTitle>
            <p class="mb-3 font-mono text-[10px] text-[var(--color-text-muted)]">Adding 1h/week to a category = 52h/year = {(52 * yearsLeft).toLocaleString()}h over your remaining lifetime</p>
            <div class="grid gap-2 sm:grid-cols-2">
              {yearlyHours.filter(c => c.hours > 0).sort((a, b) => b.hours - a.hours).map(c => (
                <div key={c.id} class="flex items-center justify-between rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
                  <div class="flex items-center gap-2">
                    <span class="inline-block h-2 w-2 rounded-full" style={{ background: c.color }} />
                    <span class="font-mono text-xs text-[var(--color-text)]">{c.name}</span>
                  </div>
                  <div class="text-right font-mono text-[10px]">
                    <div class="text-[var(--color-text)]">{c.yearly.toLocaleString()}h/yr</div>
                    <div class="text-[var(--color-text-muted)]">{(c.hours * 52 * yearsLeft).toLocaleString()}h lifetime</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Life Phases */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Life Phases</CardTitle>
            <div class="mb-3 flex flex-wrap gap-2">
              {PHASE_PRESETS.map(p => (
                <button key={p.name} onClick={() => addPhaseFromPreset(p)}
                  class="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:border-[var(--color-primary)]">{p.name}</button>
              ))}
            </div>
            {phases.length > 0 && (
              <div class="space-y-2">
                {phases.sort((a, b) => a.ageStart - b.ageStart).map(ph => (
                  <div key={ph.id} class="rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                    <div class="flex items-center justify-between mb-2">
                      <span class="font-mono text-xs font-bold text-[var(--color-heading)]">{ph.name}</span>
                      <div class="flex items-center gap-2">
                        <span class="font-mono text-[10px] text-[var(--color-text-muted)]">Ages {ph.ageStart}-{ph.ageEnd}</span>
                        <button onClick={() => removePhase(ph.id)} class="text-[var(--color-text-muted)] hover:text-red-400 text-xs">✕</button>
                      </div>
                    </div>
                    <div class="flex flex-wrap gap-1">
                      {categories.map(c => {
                        const h = ph.allocations[c.id] ?? 0;
                        if (h === 0) return null;
                        return (
                          <span key={c.id} class="rounded px-1.5 py-0.5 font-mono text-[9px]" style={{ background: c.color + "22", color: c.color }}>
                            {c.icon} {h}h
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Charts */}
        <div class="space-y-4">
          {/* Settings */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Life Settings</CardTitle>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Current Age</label>
                <input type="number" value={currentAge} onInput={(e: any) => setCurrentAge(+e.target.value)} min="1" max="120"
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Life Expectancy</label>
                <input type="number" value={lifeExpectancy} onInput={(e: any) => setLifeExpectancy(+e.target.value)} min="1" max="120"
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
            </div>
          </div>

          {/* Doughnut */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Weekly Breakdown</CardTitle>
            <div style={{ height: "300px" }}><canvas ref={doughnutRef} /></div>
          </div>

          {/* Lifetime bar */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Lifetime Hours Remaining</CardTitle>
            <div style={{ height: `${Math.max(200, categories.length * 30)}px` }}><canvas ref={barRef} /></div>
            <p class="mt-2 font-mono text-[10px] text-[var(--color-text-muted)]">
              Based on {yearsLeft} years remaining. Total: {(TOTAL_HOURS * 52 * yearsLeft).toLocaleString()} hours.
            </p>
          </div>

          {/* Quick insights */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Insights</CardTitle>
            <div class="space-y-2 font-mono text-[10px] text-[var(--color-text-muted)]">
              {categories.filter(c => c.hours > 0).sort((a, b) => b.hours - a.hours).slice(0, 3).map((c, i) => (
                <div key={c.id} class="rounded bg-[var(--color-bg)] p-2">
                  <span style={{ color: c.color }}>{c.icon} {c.name}</span>: {((c.hours / TOTAL_HOURS) * 100).toFixed(1)}% of your life = {(c.hours * 52 * yearsLeft).toLocaleString()} hours remaining
                </div>
              ))}
              {remaining > 10 && <div class="rounded bg-blue-500/10 p-2 text-blue-400">{remaining}h/week unallocated. That's {(remaining * 52 * yearsLeft).toLocaleString()} lifetime hours of potential.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
