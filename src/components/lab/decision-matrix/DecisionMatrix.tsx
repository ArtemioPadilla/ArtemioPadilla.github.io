import { useState, useRef, useEffect, useMemo } from "preact/hooks";
import {
  Chart, CategoryScale, LinearScale, PointElement, LineElement,
  LineController, BarElement, BarController, RadarController,
  RadialLinearScale, Filler, Legend, Tooltip, ArcElement,
} from "chart.js";

Chart.register(
  CategoryScale, LinearScale, PointElement, LineElement, LineController,
  BarElement, BarController, RadarController, RadialLinearScale,
  Filler, Legend, Tooltip, ArcElement,
);

// ─── Colors ──────────────────────────────────────────────────────────
const C = {
  gold: "#d4a843", goldLight: "#f0c96a", goldDim: "rgba(212,168,67,0.15)",
  blue: "#4a9eff", blueDim: "rgba(74,158,255,0.25)",
  green: "#3fb68a", greenDim: "rgba(63,182,138,0.25)",
  red: "#e05c6a", redDim: "rgba(224,92,106,0.25)",
  purple: "#a78bfa", purpleDim: "rgba(167,139,250,0.25)",
  orange: "#f59e0b", orangeDim: "rgba(245,158,11,0.25)",
  muted: "#7d8590",
  gridDark: "rgba(48,54,61,0.5)", gridLight: "rgba(0,0,0,0.06)",
};

const OPTION_COLORS = [C.blue, C.green, C.purple, C.orange, C.red, C.gold];
const OPTION_DIMS = [C.blueDim, C.greenDim, C.purpleDim, C.orangeDim, C.redDim, C.goldDim];

const fmt = (n: number, dec = 1) => n.toFixed(dec);

// ─── Types ───────────────────────────────────────────────────────────
interface Criterion { id: number; name: string; weight: number; }
interface Option { id: number; name: string; scores: Record<number, number>; }

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

// ─── Templates ───────────────────────────────────────────────────────
const TEMPLATES: Record<string, { criteria: string[]; options: string[] }> = {
  "Job Offer": {
    criteria: ["Salary", "Growth", "Culture", "Location", "Work-Life Balance", "Benefits"],
    options: ["Company A", "Company B", "Company C"],
  },
  "City to Live": {
    criteria: ["Cost of Living", "Job Market", "Safety", "Weather", "Social Life", "Transit"],
    options: ["City A", "City B", "City C"],
  },
  "Tech Stack": {
    criteria: ["Performance", "Ecosystem", "Learning Curve", "Hiring Pool", "Maintainability"],
    options: ["Option A", "Option B", "Option C"],
  },
  "Custom": { criteria: ["Criterion 1", "Criterion 2", "Criterion 3"], options: ["Option A", "Option B"] },
};

// ─── Main Component ──────────────────────────────────────────────────
export default function DecisionMatrix() {
  const [criteria, setCriteria] = useState<Criterion[]>([
    { id: 1, name: "Cost", weight: 5 },
    { id: 2, name: "Quality", weight: 4 },
    { id: 3, name: "Speed", weight: 3 },
  ]);
  const [options, setOptions] = useState<Option[]>([
    { id: 1, name: "Option A", scores: { 1: 7, 2: 8, 3: 5 } },
    { id: 2, name: "Option B", scores: { 1: 5, 2: 6, 3: 9 } },
  ]);
  const [nextCId, setNextCId] = useState(4);
  const [nextOId, setNextOId] = useState(3);
  const [chartMode, setChartMode] = useState<"radar" | "bar">("radar");
  const [sensitivityCrit, setSensitivityCrit] = useState<number>(1);
  const radarRef = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLCanvasElement>(null);
  const radarInst = useRef<Chart | null>(null);
  const barInst = useRef<Chart | null>(null);

  // ── Scoring ──
  const totalWeight = useMemo(() => criteria.reduce((s, c) => s + c.weight, 0), [criteria]);
  const results = useMemo(() => {
    if (totalWeight === 0) return options.map(o => ({ ...o, weighted: 0, pct: 0 }));
    return options.map(o => {
      const weighted = criteria.reduce((s, c) => s + (o.scores[c.id] || 0) * c.weight, 0);
      const maxPossible = totalWeight * 10;
      return { ...o, weighted, pct: maxPossible > 0 ? (weighted / maxPossible) * 100 : 0 };
    }).sort((a, b) => b.weighted - a.weighted);
  }, [criteria, options, totalWeight]);

  const winner = results[0];
  const runnerUp = results[1];
  const margin = winner && runnerUp ? winner.weighted - runnerUp.weighted : 0;

  // ── Sensitivity analysis ──
  const sensitivity = useMemo(() => {
    const crit = criteria.find(c => c.id === sensitivityCrit);
    if (!crit || totalWeight === 0) return [];
    const points: { weight: number; scores: { name: string; pct: number }[] }[] = [];
    for (let w = 0; w <= 10; w++) {
      const adjCriteria = criteria.map(c => c.id === sensitivityCrit ? { ...c, weight: w } : c);
      const adjTotalW = adjCriteria.reduce((s, c) => s + c.weight, 0);
      if (adjTotalW === 0) { points.push({ weight: w, scores: options.map(o => ({ name: o.name, pct: 0 })) }); continue; }
      const scores = options.map(o => {
        const ws = adjCriteria.reduce((s, c) => s + (o.scores[c.id] || 0) * c.weight, 0);
        return { name: o.name, pct: (ws / (adjTotalW * 10)) * 100 };
      });
      points.push({ weight: w, scores });
    }
    return points;
  }, [criteria, options, sensitivityCrit, totalWeight]);

  // ── CRUD ──
  function addCriterion() {
    const id = nextCId;
    setNextCId(id + 1);
    setCriteria(p => [...p, { id, name: `Criterion ${id}`, weight: 3 }]);
  }
  function removeCriterion(id: number) {
    setCriteria(p => p.filter(c => c.id !== id));
    setOptions(p => p.map(o => { const s = { ...o.scores }; delete s[id]; return { ...o, scores: s }; }));
  }
  function addOption() {
    const id = nextOId;
    setNextOId(id + 1);
    const scores: Record<number, number> = {};
    criteria.forEach(c => { scores[c.id] = 5; });
    setOptions(p => [...p, { id, name: `Option ${String.fromCharCode(64 + id)}`, scores }]);
  }
  function removeOption(id: number) { setOptions(p => p.filter(o => o.id !== id)); }
  function setScore(optId: number, critId: number, val: number) {
    setOptions(p => p.map(o => o.id === optId ? { ...o, scores: { ...o.scores, [critId]: val } } : o));
  }
  function setCritName(id: number, name: string) { setCriteria(p => p.map(c => c.id === id ? { ...c, name } : c)); }
  function setCritWeight(id: number, w: number) { setCriteria(p => p.map(c => c.id === id ? { ...c, weight: w } : c)); }
  function setOptName(id: number, name: string) { setOptions(p => p.map(o => o.id === id ? { ...o, name } : o)); }

  function loadTemplate(key: string) {
    const t = TEMPLATES[key]; if (!t) return;
    const newCriteria = t.criteria.map((name, i) => ({ id: i + 1, name, weight: 5 }));
    const newOptions = t.options.map((name, i) => {
      const scores: Record<number, number> = {};
      newCriteria.forEach(c => { scores[c.id] = 5; });
      return { id: i + 1, name, scores };
    });
    setCriteria(newCriteria);
    setOptions(newOptions);
    setNextCId(newCriteria.length + 1);
    setNextOId(newOptions.length + 1);
    setSensitivityCrit(newCriteria[0]?.id || 1);
  }

  // ── Radar Chart ──
  useEffect(() => {
    if (!radarRef.current || chartMode !== "radar") return;
    radarInst.current?.destroy();
    const isDark = !document.documentElement.classList.contains("light");
    const gridColor = isDark ? C.gridDark : C.gridLight;
    const textColor = isDark ? "#e4e4e7" : "#3f3f46";

    radarInst.current = new Chart(radarRef.current, {
      type: "radar",
      data: {
        labels: criteria.map(c => c.name),
        datasets: options.map((o, i) => ({
          label: o.name,
          data: criteria.map(c => o.scores[c.id] || 0),
          borderColor: OPTION_COLORS[i % OPTION_COLORS.length],
          backgroundColor: OPTION_DIMS[i % OPTION_DIMS.length],
          borderWidth: 2, pointRadius: 3,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          r: { min: 0, max: 10, ticks: { stepSize: 2, color: textColor, backdropColor: "transparent" }, grid: { color: gridColor }, angleLines: { color: gridColor }, pointLabels: { color: textColor, font: { size: 11 } } },
        },
        plugins: { legend: { labels: { color: textColor, font: { family: "monospace", size: 11 } } } },
      },
    });
    return () => { radarInst.current?.destroy(); radarInst.current = null; };
  }, [criteria, options, chartMode]);

  // ── Bar Chart ──
  useEffect(() => {
    if (!barRef.current || chartMode !== "bar") return;
    barInst.current?.destroy();
    const isDark = !document.documentElement.classList.contains("light");
    const gridColor = isDark ? C.gridDark : C.gridLight;
    const textColor = isDark ? "#e4e4e7" : "#3f3f46";

    barInst.current = new Chart(barRef.current, {
      type: "bar",
      data: {
        labels: results.map(r => r.name),
        datasets: [{
          label: "Weighted Score %",
          data: results.map(r => r.pct),
          backgroundColor: results.map((_, i) => OPTION_COLORS[i % OPTION_COLORS.length]),
          borderColor: results.map((_, i) => OPTION_COLORS[i % OPTION_COLORS.length]),
          borderWidth: 1,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: "y" as const,
        scales: {
          x: { min: 0, max: 100, grid: { color: gridColor }, ticks: { color: textColor } },
          y: { grid: { display: false }, ticks: { color: textColor, font: { family: "monospace" } } },
        },
        plugins: { legend: { display: false } },
      },
    });
    return () => { barInst.current?.destroy(); barInst.current = null; };
  }, [results, chartMode]);

  // ── Render ──
  return (
    <div class="space-y-6">
      {/* Summary Cards */}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Winner" value={winner?.name || "—"} color={C.green} sub={winner ? `${fmt(winner.pct)}%` : ""} />
        <StatCard label="Score Gap" value={margin > 0 ? fmt(margin, 1) : "Tied"} color={margin > 5 ? C.green : C.orange} sub="weighted points" />
        <StatCard label="Criteria" value={String(criteria.length)} color={C.blue} />
        <StatCard label="Options" value={String(options.length)} color={C.purple} />
      </div>

      {/* Templates */}
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <CardTitle>Templates</CardTitle>
        <div class="flex flex-wrap gap-2">
          {Object.keys(TEMPLATES).map(k => (
            <button key={k} onClick={() => loadTemplate(k)} class="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 font-mono text-xs text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)]">{k}</button>
          ))}
        </div>
      </div>

      {/* Main grid */}
      <div class="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Matrix table */}
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 overflow-x-auto">
          <CardTitle>Decision Matrix</CardTitle>
          <table class="w-full border-collapse font-mono text-xs">
            <thead>
              <tr>
                <th class="border-b border-[var(--color-border)] p-2 text-left text-[var(--color-text-muted)]">Criterion</th>
                <th class="border-b border-[var(--color-border)] p-2 text-center text-[var(--color-text-muted)] w-20">Weight</th>
                {options.map(o => (
                  <th key={o.id} class="border-b border-[var(--color-border)] p-2 text-center text-[var(--color-text-muted)]">
                    <input type="text" value={o.name} onInput={(e: any) => setOptName(o.id, e.target.value)}
                      class="w-full bg-transparent text-center text-[var(--color-heading)] outline-none" />
                  </th>
                ))}
                <th class="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {criteria.map(c => (
                <tr key={c.id} class="hover:bg-[var(--color-bg)]">
                  <td class="border-b border-[var(--color-border)] p-2">
                    <input type="text" value={c.name} onInput={(e: any) => setCritName(c.id, e.target.value)}
                      class="w-full bg-transparent text-[var(--color-text)] outline-none" />
                  </td>
                  <td class="border-b border-[var(--color-border)] p-2 text-center">
                    <input type="range" min="1" max="10" value={c.weight} onInput={(e: any) => setCritWeight(c.id, +e.target.value)} class="w-16 accent-[#d4a843]" />
                    <span class="ml-1 text-[var(--color-text-muted)]">{c.weight}</span>
                  </td>
                  {options.map(o => (
                    <td key={o.id} class="border-b border-[var(--color-border)] p-2 text-center">
                      <input type="number" min="0" max="10" value={o.scores[c.id] || 0}
                        onInput={(e: any) => setScore(o.id, c.id, Math.max(0, Math.min(10, +e.target.value)))}
                        class="w-14 rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-1 text-center text-[var(--color-text)] outline-none" />
                    </td>
                  ))}
                  <td class="border-b border-[var(--color-border)] p-1">
                    <button onClick={() => removeCriterion(c.id)} class="text-[var(--color-text-muted)] hover:text-red-400" title="Remove">✕</button>
                  </td>
                </tr>
              ))}
              {/* Weighted totals row */}
              <tr class="font-bold">
                <td class="p-2 text-[var(--color-heading)]">Weighted Score</td>
                <td class="p-2 text-center text-[var(--color-text-muted)]">Σ={totalWeight}</td>
                {options.map((o, i) => {
                  const r = results.find(r => r.id === o.id);
                  return (
                    <td key={o.id} class="p-2 text-center" style={{ color: OPTION_COLORS[i % OPTION_COLORS.length] }}>
                      {r ? `${fmt(r.pct)}%` : "0%"}
                    </td>
                  );
                })}
                <td></td>
              </tr>
            </tbody>
          </table>
          <div class="mt-3 flex gap-2">
            <button onClick={addCriterion} class="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 font-mono text-xs text-[var(--color-text)] hover:border-[var(--color-primary)]">+ Criterion</button>
            <button onClick={addOption} class="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 font-mono text-xs text-[var(--color-text)] hover:border-[var(--color-primary)]">+ Option</button>
            {options.length > 2 && (
              <button onClick={() => removeOption(options[options.length - 1].id)} class="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 font-mono text-xs text-red-400 hover:border-red-400">Remove Last Option</button>
            )}
          </div>
        </div>

        {/* Right panel */}
        <div class="space-y-4">
          {/* Rankings */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Rankings</CardTitle>
            <div class="space-y-2">
              {results.map((r, i) => (
                <div key={r.id} class="flex items-center gap-3 rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
                  <span class="font-mono text-lg font-bold" style={{ color: i === 0 ? C.gold : C.muted }}>#{i + 1}</span>
                  <div class="flex-1">
                    <div class="font-mono text-sm text-[var(--color-heading)]">{r.name}</div>
                    <div class="mt-1 h-2 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
                      <div class="h-full rounded-full transition-all" style={{ width: `${r.pct}%`, background: OPTION_COLORS[i % OPTION_COLORS.length] }} />
                    </div>
                  </div>
                  <span class="font-mono text-sm font-bold" style={{ color: OPTION_COLORS[i % OPTION_COLORS.length] }}>{fmt(r.pct)}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Chart */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Visualization</CardTitle>
            <div class="mb-3 flex gap-2">
              {(["radar", "bar"] as const).map(m => (
                <button key={m} onClick={() => setChartMode(m)}
                  class={`rounded px-3 py-1 font-mono text-xs transition-colors ${chartMode === m ? "text-[var(--color-bg)]" : "border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}
                  style={chartMode === m ? { background: C.gold } : undefined}>
                  {m === "radar" ? "Radar" : "Bar"}
                </button>
              ))}
            </div>
            <div class="relative" style={{ height: "280px" }}>
              <canvas ref={radarRef} style={{ display: chartMode === "radar" ? "block" : "none" }} />
              <canvas ref={barRef} style={{ display: chartMode === "bar" ? "block" : "none" }} />
            </div>
          </div>
        </div>
      </div>

      {/* Sensitivity Analysis */}
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <CardTitle>Sensitivity Analysis</CardTitle>
        <div class="mb-3 flex items-center gap-3">
          <span class="font-mono text-xs text-[var(--color-text-muted)]">Vary weight of:</span>
          <select value={sensitivityCrit} onChange={(e: any) => setSensitivityCrit(+e.target.value)}
            class="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none">
            {criteria.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full border-collapse font-mono text-xs">
            <thead>
              <tr>
                <th class="border-b border-[var(--color-border)] p-2 text-left text-[var(--color-text-muted)]">Weight</th>
                {options.map((o, i) => (
                  <th key={o.id} class="border-b border-[var(--color-border)] p-2 text-center" style={{ color: OPTION_COLORS[i % OPTION_COLORS.length] }}>{o.name}</th>
                ))}
                <th class="border-b border-[var(--color-border)] p-2 text-center text-[var(--color-text-muted)]">Winner</th>
              </tr>
            </thead>
            <tbody>
              {sensitivity.map(pt => {
                const best = pt.scores.reduce((a, b) => b.pct > a.pct ? b : a, pt.scores[0]);
                const isCurrent = pt.weight === (criteria.find(c => c.id === sensitivityCrit)?.weight || 0);
                return (
                  <tr key={pt.weight} class={isCurrent ? "bg-[var(--color-bg)]" : ""}>
                    <td class="border-b border-[var(--color-border)] p-2 text-[var(--color-text)]">
                      {pt.weight}{isCurrent && <span class="ml-1 text-[var(--color-text-muted)]">←</span>}
                    </td>
                    {pt.scores.map((s, i) => (
                      <td key={i} class="border-b border-[var(--color-border)] p-2 text-center text-[var(--color-text)]">{fmt(s.pct)}%</td>
                    ))}
                    <td class="border-b border-[var(--color-border)] p-2 text-center font-bold" style={{ color: C.green }}>{best?.name}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p class="mt-2 font-mono text-[10px] text-[var(--color-text-muted)]">
          Shows how changing one criterion's weight from 0 to 10 affects the final ranking. Current weight is marked.
        </p>
      </div>
    </div>
  );
}
