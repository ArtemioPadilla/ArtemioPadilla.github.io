import { useState, useRef, useEffect, useMemo } from "preact/hooks";
import {
  Chart, CategoryScale, LinearScale, PointElement, LineElement,
  LineController, BarElement, BarController, Filler, Legend, Tooltip,
} from "chart.js";

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, LineController, BarElement, BarController, Filler, Legend, Tooltip);

const C = {
  gold: "#d4a843", blue: "#4a9eff", blueDim: "rgba(74,158,255,0.15)",
  green: "#3fb68a", greenDim: "rgba(63,182,138,0.15)",
  red: "#e05c6a", purple: "#a78bfa", purpleDim: "rgba(167,139,250,0.15)",
  orange: "#f59e0b", orangeDim: "rgba(245,158,11,0.15)",
  muted: "#7d8590", gridDark: "rgba(48,54,61,0.5)", gridLight: "rgba(0,0,0,0.06)",
};

const PATH_COLORS = [C.blue, C.green, C.purple, C.orange];

const fmtM = (n: number) => "$" + new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(n);

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
interface CareerPath {
  id: number;
  name: string;
  startingSalary: number;
  annualRaise: number; // %
  promotionEveryYears: number;
  promotionBump: number; // %
  maxSalary: number;
  color: string;
}

interface MexicanBenefits {
  aguinaldoDays: number;
  vacationDays: number;
  vacPremiumPct: number;
  savingsFundPct: number;
  foodVoucherMonthly: number;
  ptu: number;
}

// ─── Templates ───────────────────────────────────────────────────────
const TEMPLATES: { name: string; salary: number; raise: number; promoYears: number; promoBump: number; max: number }[] = [
  { name: "Junior Dev (Mexico)", salary: 25000, raise: 8, promoYears: 2, promoBump: 20, max: 120000 },
  { name: "Senior Dev (Mexico)", salary: 55000, raise: 6, promoYears: 3, promoBump: 15, max: 150000 },
  { name: "Data Scientist", salary: 40000, raise: 10, promoYears: 2, promoBump: 25, max: 180000 },
  { name: "Product Manager", salary: 45000, raise: 7, promoYears: 3, promoBump: 20, max: 160000 },
  { name: "Remote (USD)", salary: 80000, raise: 5, promoYears: 3, promoBump: 15, max: 250000 },
  { name: "Freelance/Consulting", salary: 60000, raise: 12, promoYears: 0, promoBump: 0, max: 300000 },
];

// ─── Main Component ──────────────────────────────────────────────────
export default function CareerModel() {
  const [paths, setPaths] = useState<CareerPath[]>([
    { id: 1, name: "Current Path", startingSalary: 40000, annualRaise: 7, promotionEveryYears: 3, promotionBump: 20, maxSalary: 150000, color: C.blue },
  ]);
  const [nextId, setNextId] = useState(2);
  const [years, setYears] = useState(20);
  const [inflation, setInflation] = useState(4.5);
  const [activePath, setActivePath] = useState(1);

  // Mexican labor benefits
  const [benefits, setBenefits] = useState<MexicanBenefits>({
    aguinaldoDays: 15, vacationDays: 12, vacPremiumPct: 25,
    savingsFundPct: 13, foodVoucherMonthly: 2500, ptu: 0,
  });

  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInst = useRef<Chart | null>(null);
  const compRef = useRef<HTMLCanvasElement>(null);
  const compInst = useRef<Chart | null>(null);

  // ── Projections ──
  const projections = useMemo(() => {
    return paths.map(path => {
      const data: { year: number; monthly: number; annual: number; totalComp: number; cumulative: number; real: number }[] = [];
      let salary = path.startingSalary;
      let cumulative = 0;

      for (let y = 1; y <= years; y++) {
        // Annual raise
        salary = Math.min(salary * (1 + path.annualRaise / 100), path.maxSalary);
        // Promotion bump
        if (path.promotionEveryYears > 0 && y % path.promotionEveryYears === 0) {
          salary = Math.min(salary * (1 + path.promotionBump / 100), path.maxSalary);
        }

        const annual = salary * 12;
        // Benefits
        const aguinaldo = (salary / 30) * benefits.aguinaldoDays;
        const vacPremium = (salary / 30) * benefits.vacationDays * (benefits.vacPremiumPct / 100);
        const savingsFund = salary * (benefits.savingsFundPct / 100) * 12;
        const foodVouchers = benefits.foodVoucherMonthly * 12;
        const totalComp = annual + aguinaldo + vacPremium + savingsFund + foodVouchers + benefits.ptu;
        const real = totalComp / Math.pow(1 + inflation / 100, y);
        cumulative += totalComp;

        data.push({ year: y, monthly: salary, annual, totalComp, cumulative, real });
      }
      return { ...path, data };
    });
  }, [paths, years, inflation, benefits]);

  const currentPath = projections.find(p => p.id === activePath) || projections[0];
  const finalYear = currentPath?.data[currentPath.data.length - 1];

  // ── Chart ──
  useEffect(() => {
    if (!chartRef.current) return;
    chartInst.current?.destroy();
    const isDark = !document.documentElement.classList.contains("light");
    const gridColor = isDark ? C.gridDark : C.gridLight;
    const textColor = isDark ? "#e4e4e7" : "#3f3f46";

    chartInst.current = new Chart(chartRef.current, {
      type: "line",
      data: {
        labels: Array.from({ length: years }, (_, i) => `Year ${i + 1}`),
        datasets: projections.map(p => ({
          label: p.name,
          data: p.data.map(d => d.monthly),
          borderColor: p.color,
          backgroundColor: p.color + "15",
          fill: false,
          tension: 0.3,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, maxTicksLimit: 10 } },
          y: { grid: { color: gridColor }, ticks: { color: textColor, callback: (v: any) => `$${(v / 1000).toFixed(0)}K` } },
        },
        plugins: { legend: { labels: { color: textColor, font: { family: "monospace", size: 10 } } } },
      },
    });
    return () => { chartInst.current?.destroy(); chartInst.current = null; };
  }, [projections, years]);

  // ── Cumulative Chart ──
  useEffect(() => {
    if (!compRef.current) return;
    compInst.current?.destroy();
    const isDark = !document.documentElement.classList.contains("light");
    const gridColor = isDark ? C.gridDark : C.gridLight;
    const textColor = isDark ? "#e4e4e7" : "#3f3f46";

    compInst.current = new Chart(compRef.current, {
      type: "line",
      data: {
        labels: Array.from({ length: years }, (_, i) => `Year ${i + 1}`),
        datasets: projections.map(p => ({
          label: p.name,
          data: p.data.map(d => d.cumulative),
          borderColor: p.color,
          backgroundColor: p.color + "22",
          fill: true,
          tension: 0.3,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, maxTicksLimit: 10 } },
          y: { grid: { color: gridColor }, ticks: { color: textColor, callback: (v: any) => v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${(v / 1000).toFixed(0)}K` } },
        },
        plugins: { legend: { labels: { color: textColor, font: { family: "monospace", size: 10 } } } },
      },
    });
    return () => { compInst.current?.destroy(); compInst.current = null; };
  }, [projections, years]);

  // ── CRUD ──
  function addPath() {
    const id = nextId; setNextId(id + 1);
    setPaths(p => [...p, { id, name: `Path ${id}`, startingSalary: 40000, annualRaise: 7, promotionEveryYears: 3, promotionBump: 20, maxSalary: 150000, color: PATH_COLORS[(id - 1) % PATH_COLORS.length] }]);
    setActivePath(id);
  }
  function removePath(id: number) {
    if (paths.length <= 1) return;
    const remaining = paths.filter(p => p.id !== id);
    setPaths(remaining);
    if (activePath === id) setActivePath(remaining[0].id);
  }
  function updatePath(id: number, fn: (p: CareerPath) => CareerPath) {
    setPaths(prev => prev.map(p => p.id === id ? fn(p) : p));
  }
  function loadTemplate(t: typeof TEMPLATES[0]) {
    const current = paths.find(p => p.id === activePath);
    if (!current) return;
    updatePath(activePath, p => ({ ...p, name: t.name, startingSalary: t.salary, annualRaise: t.raise, promotionEveryYears: t.promoYears, promotionBump: t.promoBump, maxSalary: t.max }));
  }

  const cp = paths.find(p => p.id === activePath) || paths[0];

  return (
    <div class="space-y-6">
      {/* Summary */}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={`Salary (Year ${years})`} value={fmtM(finalYear?.monthly || 0)} color={C.green} sub="/month" />
        <StatCard label="Lifetime Earnings" value={fmtM(finalYear?.cumulative || 0)} color={C.gold} sub={`${years} years`} />
        <StatCard label={`Total Comp (Year ${years})`} value={fmtM(finalYear?.totalComp || 0)} color={C.blue} sub="inc. benefits" />
        <StatCard label="Real Value" value={fmtM(finalYear?.real || 0)} color={C.purple} sub={`at ${inflation}% inflation`} />
      </div>

      {/* Path tabs */}
      <div class="flex gap-2 overflow-x-auto">
        {paths.map((p, i) => (
          <button key={p.id} onClick={() => setActivePath(p.id)}
            class={`flex items-center gap-2 rounded px-3 py-1.5 font-mono text-xs transition-colors ${activePath === p.id ? "text-[var(--color-bg)]" : "border border-[var(--color-border)] text-[var(--color-text-muted)]"}`}
            style={activePath === p.id ? { background: p.color } : undefined}>
            {p.name}
            {paths.length > 1 && <span onClick={e => { e.stopPropagation(); removePath(p.id); }} class="ml-1 hover:text-red-400">✕</span>}
          </button>
        ))}
        <button onClick={addPath} class="rounded border border-dashed border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)]">+ Add Path</button>
      </div>

      <div class="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Left */}
        <div class="space-y-4">
          {/* Templates */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Templates</CardTitle>
            <div class="flex flex-wrap gap-2">
              {TEMPLATES.map(t => (
                <button key={t.name} onClick={() => loadTemplate(t)}
                  class="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:border-[var(--color-primary)]">{t.name}</button>
              ))}
            </div>
          </div>

          {/* Path config */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Career Path Configuration</CardTitle>
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Path Name</label>
                <input type="text" value={cp.name} onInput={(e: any) => updatePath(cp.id, p => ({ ...p, name: e.target.value }))}
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Starting Salary (monthly)</label>
                <input type="number" value={cp.startingSalary} onInput={(e: any) => updatePath(cp.id, p => ({ ...p, startingSalary: +e.target.value }))}
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Annual Raise (%)</label>
                <input type="number" value={cp.annualRaise} onInput={(e: any) => updatePath(cp.id, p => ({ ...p, annualRaise: +e.target.value }))} step="0.5"
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Promotion Every (years, 0=none)</label>
                <input type="number" value={cp.promotionEveryYears} onInput={(e: any) => updatePath(cp.id, p => ({ ...p, promotionEveryYears: +e.target.value }))} min="0"
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Promotion Bump (%)</label>
                <input type="number" value={cp.promotionBump} onInput={(e: any) => updatePath(cp.id, p => ({ ...p, promotionBump: +e.target.value }))}
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Salary Cap (monthly)</label>
                <input type="number" value={cp.maxSalary} onInput={(e: any) => updatePath(cp.id, p => ({ ...p, maxSalary: +e.target.value }))}
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
            </div>
          </div>

          {/* Salary chart */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Monthly Salary Projection</CardTitle>
            <div class="mb-3 flex items-center gap-2">
              <span class="font-mono text-xs text-[var(--color-text-muted)]">Years:</span>
              <input type="range" min="5" max="40" value={years} onInput={(e: any) => setYears(+e.target.value)} class="flex-1 accent-[#d4a843]" />
              <span class="font-mono text-xs text-[var(--color-text)]">{years}</span>
            </div>
            <div style={{ height: "280px" }}><canvas ref={chartRef} /></div>
          </div>

          {/* Cumulative chart */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Cumulative Earnings</CardTitle>
            <div style={{ height: "250px" }}><canvas ref={compRef} /></div>
          </div>
        </div>

        {/* Right */}
        <div class="space-y-4">
          {/* Mexican benefits */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Mexican Labor Benefits</CardTitle>
            <div class="space-y-2">
              {[
                { label: "Aguinaldo (days)", value: benefits.aguinaldoDays, key: "aguinaldoDays", min: 15 },
                { label: "Vacation Days", value: benefits.vacationDays, key: "vacationDays", min: 12 },
                { label: "Vacation Premium (%)", value: benefits.vacPremiumPct, key: "vacPremiumPct", min: 25 },
                { label: "Savings Fund (%)", value: benefits.savingsFundPct, key: "savingsFundPct", min: 0 },
                { label: "Food Vouchers (monthly)", value: benefits.foodVoucherMonthly, key: "foodVoucherMonthly", min: 0 },
                { label: "PTU (annual)", value: benefits.ptu, key: "ptu", min: 0 },
              ].map(b => (
                <div key={b.key} class="flex items-center gap-2">
                  <span class="w-36 font-mono text-[10px] text-[var(--color-text)]">{b.label}</span>
                  <input type="number" value={b.value} min={b.min}
                    onInput={(e: any) => setBenefits(prev => ({ ...prev, [b.key]: +e.target.value }))}
                    class="w-20 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-right font-mono text-xs text-[var(--color-text)] outline-none" />
                </div>
              ))}
            </div>
          </div>

          {/* Settings */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Settings</CardTitle>
            <div class="space-y-2">
              <div class="flex items-center gap-2">
                <span class="w-36 font-mono text-[10px] text-[var(--color-text)]">Inflation (%)</span>
                <input type="number" value={inflation} step="0.5"
                  onInput={(e: any) => setInflation(+e.target.value)}
                  class="w-20 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-right font-mono text-xs text-[var(--color-text)] outline-none" />
              </div>
            </div>
          </div>

          {/* Milestones */}
          {currentPath && (
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <CardTitle>Milestones</CardTitle>
              <div class="space-y-2 font-mono text-[10px]">
                {[50000, 80000, 100000, 150000].map(target => {
                  const year = currentPath.data.findIndex(d => d.monthly >= target) + 1;
                  return (
                    <div key={target} class="flex justify-between rounded bg-[var(--color-bg)] p-2">
                      <span class="text-[var(--color-text-muted)]">{fmtM(target)}/mo</span>
                      <span style={{ color: year > 0 ? C.green : C.muted }}>{year > 0 ? `Year ${year}` : `Beyond ${years}yr`}</span>
                    </div>
                  );
                })}
                {[1_000_000, 5_000_000, 10_000_000].map(target => {
                  const year = currentPath.data.findIndex(d => d.cumulative >= target) + 1;
                  return (
                    <div key={target} class="flex justify-between rounded bg-[var(--color-bg)] p-2">
                      <span class="text-[var(--color-text-muted)]">{fmtM(target)} cum.</span>
                      <span style={{ color: year > 0 ? C.gold : C.muted }}>{year > 0 ? `Year ${year}` : `Beyond ${years}yr`}</span>
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
