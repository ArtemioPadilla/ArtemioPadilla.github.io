import { useState, useRef, useEffect, useMemo } from "preact/hooks";
import {
  Chart, RadarController, RadialLinearScale, PointElement, LineElement,
  CategoryScale, LinearScale, BarElement, BarController, Filler, Legend, Tooltip,
} from "chart.js";

Chart.register(RadarController, RadialLinearScale, PointElement, LineElement, CategoryScale, LinearScale, BarElement, BarController, Filler, Legend, Tooltip);

const C = {
  gold: "#d4a843", goldDim: "rgba(212,168,67,0.15)",
  blue: "#4a9eff", blueDim: "rgba(74,158,255,0.25)",
  green: "#3fb68a", greenDim: "rgba(63,182,138,0.25)",
  red: "#e05c6a", purple: "#a78bfa", purpleDim: "rgba(167,139,250,0.25)",
  orange: "#f59e0b", orangeDim: "rgba(245,158,11,0.25)",
  muted: "#7d8590", gridDark: "rgba(48,54,61,0.5)", gridLight: "rgba(0,0,0,0.06)",
};

const OFFER_COLORS = [C.blue, C.green, C.purple, C.orange, C.red, C.gold];
const OFFER_DIMS = [C.blueDim, C.greenDim, C.purpleDim, C.orangeDim, "rgba(224,92,106,0.25)", C.goldDim];

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

// ─── Satisfaction Factors ────────────────────────────────────────────
const FACTORS = [
  { key: "compensation", label: "Compensation", group: "Financial", default: 10 },
  { key: "equity", label: "Equity/Stock", group: "Financial", default: 7 },
  { key: "benefits", label: "Benefits Package", group: "Financial", default: 6 },
  { key: "bonus", label: "Bonus Potential", group: "Financial", default: 5 },
  { key: "growth", label: "Career Growth", group: "Career", default: 9 },
  { key: "learning", label: "Learning Opportunities", group: "Career", default: 8 },
  { key: "impact", label: "Impact of Work", group: "Career", default: 7 },
  { key: "autonomy", label: "Autonomy", group: "Work Style", default: 8 },
  { key: "flexibility", label: "Schedule Flexibility", group: "Work Style", default: 7 },
  { key: "remote", label: "Remote Work", group: "Work Style", default: 6 },
  { key: "balance", label: "Work-Life Balance", group: "Work Style", default: 9 },
  { key: "culture", label: "Company Culture", group: "Environment", default: 7 },
  { key: "team", label: "Team Quality", group: "Environment", default: 8 },
  { key: "management", label: "Management", group: "Environment", default: 6 },
  { key: "location", label: "Location", group: "Environment", default: 5 },
  { key: "mission", label: "Company Mission", group: "Environment", default: 4 },
  { key: "stability", label: "Job Stability", group: "Risk", default: 6 },
  { key: "reputation", label: "Company Reputation", group: "Risk", default: 5 },
];

const GROUPS = [...new Set(FACTORS.map(f => f.group))];

// ─── Types ───────────────────────────────────────────────────────────
interface Offer {
  id: number;
  name: string;
  baseSalary: number;
  equity: number; // annual value
  signingBonus: number;
  annualBonus: number;
  otherComp: number;
  // Factor ratings 0-10
  ratings: Record<string, number>;
}

// Satisfaction formula: S = [Σ αi·f(ρi) / Σ αi·f(10)] × 100
// where f(x) = log(x+1) for logarithmic scale, or x for linear
function calcSatisfaction(
  ratings: Record<string, number>,
  weights: Record<string, number>,
  scale: "log" | "linear"
): number {
  const f = scale === "log" ? (x: number) => Math.log(x + 1) : (x: number) => x;
  let num = 0, den = 0;
  for (const factor of FACTORS) {
    const w = weights[factor.key] || 0;
    const r = ratings[factor.key] || 0;
    num += w * f(r);
    den += w * f(10);
  }
  return den > 0 ? (num / den) * 100 : 0;
}

function fmtMoney(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

// ─── Main Component ──────────────────────────────────────────────────
export default function TotalComp() {
  const [offers, setOffers] = useState<Offer[]>([
    { id: 1, name: "Offer A", baseSalary: 80000, equity: 10000, signingBonus: 5000, annualBonus: 8000, otherComp: 0, ratings: Object.fromEntries(FACTORS.map(f => [f.key, 7])) },
    { id: 2, name: "Offer B", baseSalary: 95000, equity: 20000, signingBonus: 0, annualBonus: 12000, otherComp: 0, ratings: Object.fromEntries(FACTORS.map(f => [f.key, 6])) },
  ]);
  const [nextId, setNextId] = useState(3);
  const [weights, setWeights] = useState<Record<string, number>>(Object.fromEntries(FACTORS.map(f => [f.key, f.default])));
  const [scale, setScale] = useState<"log" | "linear">("log");
  const [tab, setTab] = useState<"comp" | "satisfaction" | "weights">("comp");
  const [activeOffer, setActiveOffer] = useState(1);

  const radarRef = useRef<HTMLCanvasElement>(null);
  const radarInst = useRef<Chart | null>(null);
  const barRef = useRef<HTMLCanvasElement>(null);
  const barInst = useRef<Chart | null>(null);

  // ── Computed ──
  const results = useMemo(() => {
    return offers.map(o => {
      const totalComp = o.baseSalary + o.equity + o.annualBonus + o.otherComp;
      const firstYear = totalComp + o.signingBonus;
      const satisfaction = calcSatisfaction(o.ratings, weights, scale);
      return { ...o, totalComp, firstYear, satisfaction };
    }).sort((a, b) => b.satisfaction - a.satisfaction);
  }, [offers, weights, scale]);

  const best = results[0];

  // ── CRUD ──
  function addOffer() {
    const id = nextId; setNextId(id + 1);
    setOffers(p => [...p, { id, name: `Offer ${String.fromCharCode(64 + id)}`, baseSalary: 0, equity: 0, signingBonus: 0, annualBonus: 0, otherComp: 0, ratings: Object.fromEntries(FACTORS.map(f => [f.key, 5])) }]);
    setActiveOffer(id);
  }
  function removeOffer(id: number) {
    if (offers.length <= 1) return;
    const remaining = offers.filter(o => o.id !== id);
    setOffers(remaining);
    if (activeOffer === id) setActiveOffer(remaining[0].id);
  }
  function updateOffer(id: number, fn: (o: Offer) => Offer) {
    setOffers(p => p.map(o => o.id === id ? fn(o) : o));
  }
  function setRating(offerId: number, factorKey: string, value: number) {
    updateOffer(offerId, o => ({ ...o, ratings: { ...o.ratings, [factorKey]: value } }));
  }

  const currentOffer = offers.find(o => o.id === activeOffer) || offers[0];

  // ── Radar Chart ──
  useEffect(() => {
    if (!radarRef.current) return;
    radarInst.current?.destroy();
    const isDark = !document.documentElement.classList.contains("light");
    const gridColor = isDark ? C.gridDark : C.gridLight;
    const textColor = isDark ? "#e4e4e7" : "#3f3f46";

    const groupLabels = GROUPS;
    const datasets = offers.map((o, i) => {
      const groupScores = GROUPS.map(g => {
        const factors = FACTORS.filter(f => f.group === g);
        const avg = factors.reduce((s, f) => s + (o.ratings[f.key] || 0), 0) / (factors.length || 1);
        return avg;
      });
      return { label: o.name, data: groupScores, borderColor: OFFER_COLORS[i % OFFER_COLORS.length], backgroundColor: OFFER_DIMS[i % OFFER_DIMS.length], borderWidth: 2, pointRadius: 3 };
    });

    radarInst.current = new Chart(radarRef.current, {
      type: "radar",
      data: { labels: groupLabels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { r: { min: 0, max: 10, ticks: { stepSize: 2, color: textColor, backdropColor: "transparent" }, grid: { color: gridColor }, angleLines: { color: gridColor }, pointLabels: { color: textColor, font: { size: 11 } } } },
        plugins: { legend: { labels: { color: textColor, font: { family: "monospace", size: 11 } } } },
      },
    });
    return () => { radarInst.current?.destroy(); radarInst.current = null; };
  }, [offers]);

  // ── Bar Chart ──
  useEffect(() => {
    if (!barRef.current) return;
    barInst.current?.destroy();
    const isDark = !document.documentElement.classList.contains("light");
    const gridColor = isDark ? C.gridDark : C.gridLight;
    const textColor = isDark ? "#e4e4e7" : "#3f3f46";

    barInst.current = new Chart(barRef.current, {
      type: "bar",
      data: {
        labels: results.map(r => r.name),
        datasets: [
          { label: "Base Salary", data: results.map(r => r.baseSalary), backgroundColor: C.blue },
          { label: "Equity", data: results.map(r => r.equity), backgroundColor: C.green },
          { label: "Bonus", data: results.map(r => r.annualBonus), backgroundColor: C.orange },
          { label: "Other", data: results.map(r => r.otherComp + r.signingBonus), backgroundColor: C.purple },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: textColor } },
          y: { stacked: true, grid: { color: gridColor }, ticks: { color: textColor, callback: (v: any) => fmtMoney(v) } },
        },
        plugins: { legend: { labels: { color: textColor, font: { family: "monospace", size: 10 } } } },
      },
    });
    return () => { barInst.current?.destroy(); barInst.current = null; };
  }, [results]);

  return (
    <div class="space-y-6">
      {/* Summary */}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Best Overall" value={best?.name || "—"} color={C.green} sub={best ? `${best.satisfaction.toFixed(1)}% satisfaction` : ""} />
        <StatCard label="Highest Comp" value={fmtMoney(Math.max(...results.map(r => r.totalComp)))} color={C.blue} />
        <StatCard label="Offers" value={String(offers.length)} color={C.gold} />
        <StatCard label="Scale" value={scale === "log" ? "Logarithmic" : "Linear"} color={C.purple} sub="diminishing returns" />
      </div>

      {/* Offer tabs */}
      <div class="flex gap-2 overflow-x-auto">
        {offers.map((o, i) => (
          <button key={o.id} onClick={() => setActiveOffer(o.id)}
            class={`flex items-center gap-2 rounded px-3 py-1.5 font-mono text-xs transition-colors ${activeOffer === o.id ? "text-[var(--color-bg)]" : "border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}
            style={activeOffer === o.id ? { background: OFFER_COLORS[i % OFFER_COLORS.length] } : undefined}>
            {o.name}
            {offers.length > 1 && <span onClick={(e) => { e.stopPropagation(); removeOffer(o.id); }} class="ml-1 hover:text-red-400">✕</span>}
          </button>
        ))}
        <button onClick={addOffer} class="rounded border border-dashed border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)]">+ Add Offer</button>
      </div>

      {/* Mode tabs */}
      <div class="flex gap-2 border-b border-[var(--color-border)] pb-2">
        {(["comp", "satisfaction", "weights"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            class={`px-3 py-1.5 font-mono text-xs transition-colors ${tab === t ? "border-b-2 text-[var(--color-heading)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}
            style={tab === t ? { borderColor: C.gold } : undefined}>
            {t === "comp" ? "Compensation" : t === "satisfaction" ? "Satisfaction Factors" : "Weights"}
          </button>
        ))}
      </div>

      {/* Comp tab */}
      {tab === "comp" && currentOffer && (
        <div class="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div class="space-y-4">
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <CardTitle>Offer Details</CardTitle>
              <div class="mb-3">
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Offer Name</label>
                <input type="text" value={currentOffer.name} onInput={(e: any) => updateOffer(currentOffer.id, o => ({ ...o, name: e.target.value }))}
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div class="grid gap-3 sm:grid-cols-2">
                {[
                  { key: "baseSalary", label: "Base Salary (annual)" },
                  { key: "equity", label: "Equity (annual value)" },
                  { key: "signingBonus", label: "Signing Bonus (one-time)" },
                  { key: "annualBonus", label: "Annual Bonus" },
                  { key: "otherComp", label: "Other Compensation" },
                ].map(f => (
                  <div key={f.key}>
                    <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">{f.label}</label>
                    <input type="number" value={(currentOffer as any)[f.key]}
                      onInput={(e: any) => updateOffer(currentOffer.id, o => ({ ...o, [f.key]: +e.target.value }))}
                      class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
                  </div>
                ))}
              </div>
            </div>

            {/* Stacked bar chart */}
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <CardTitle>Compensation Breakdown</CardTitle>
              <div style={{ height: "250px" }}><canvas ref={barRef} /></div>
            </div>
          </div>

          {/* Right: comparison */}
          <div class="space-y-4">
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <CardTitle>Offer Rankings</CardTitle>
              <div class="space-y-2">
                {results.map((r, i) => (
                  <div key={r.id} class="rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                    <div class="flex items-center justify-between mb-2">
                      <div class="flex items-center gap-2">
                        <span class="font-mono text-lg font-bold" style={{ color: i === 0 ? C.gold : C.muted }}>#{i + 1}</span>
                        <span class="font-mono text-sm text-[var(--color-heading)]">{r.name}</span>
                      </div>
                      <span class="font-mono text-sm font-bold" style={{ color: OFFER_COLORS[i % OFFER_COLORS.length] }}>{r.satisfaction.toFixed(1)}%</span>
                    </div>
                    <div class="grid grid-cols-2 gap-1 font-mono text-[10px]">
                      <div><span class="text-[var(--color-text-muted)]">Total Comp:</span> <span class="text-[var(--color-text)]">{fmtMoney(r.totalComp)}</span></div>
                      <div><span class="text-[var(--color-text-muted)]">Year 1:</span> <span class="text-[var(--color-text)]">{fmtMoney(r.firstYear)}</span></div>
                    </div>
                    <div class="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
                      <div class="h-full rounded-full" style={{ width: `${r.satisfaction}%`, background: OFFER_COLORS[i % OFFER_COLORS.length] }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Radar */}
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <CardTitle>Factor Comparison (by group)</CardTitle>
              <div style={{ height: "280px" }}><canvas ref={radarRef} /></div>
            </div>
          </div>
        </div>
      )}

      {/* Satisfaction tab */}
      {tab === "satisfaction" && currentOffer && (
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <CardTitle>Rate {currentOffer.name}</CardTitle>
          <div class="mb-3 flex items-center gap-3">
            <span class="font-mono text-xs text-[var(--color-text-muted)]">Scale:</span>
            {(["log", "linear"] as const).map(s => (
              <button key={s} onClick={() => setScale(s)}
                class={`rounded px-2 py-1 font-mono text-[10px] ${scale === s ? "text-[var(--color-bg)]" : "border border-[var(--color-border)] text-[var(--color-text-muted)]"}`}
                style={scale === s ? { background: C.purple } : undefined}>
                {s === "log" ? "Logarithmic" : "Linear"}
              </button>
            ))}
            <span class="font-mono text-[9px] text-[var(--color-text-muted)]">{scale === "log" ? "Diminishing returns (realistic)" : "Linear scoring"}</span>
          </div>
          {GROUPS.map(g => (
            <div key={g} class="mb-4">
              <h3 class="mb-2 font-mono text-xs font-bold uppercase text-[var(--color-heading)]">{g}</h3>
              <div class="space-y-2">
                {FACTORS.filter(f => f.group === g).map(f => (
                  <div key={f.key} class="flex items-center gap-3">
                    <span class="w-40 font-mono text-xs text-[var(--color-text)]">{f.label}</span>
                    <input type="range" min="0" max="10" value={currentOffer.ratings[f.key] || 0}
                      onInput={(e: any) => setRating(currentOffer.id, f.key, +e.target.value)}
                      class="flex-1 accent-[#d4a843]" />
                    <span class="w-8 text-right font-mono text-xs text-[var(--color-text)]">{currentOffer.ratings[f.key] || 0}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div class="mt-4 rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-4 text-center">
            <div class="font-mono text-3xl font-bold" style={{ color: C.gold }}>
              {calcSatisfaction(currentOffer.ratings, weights, scale).toFixed(1)}%
            </div>
            <div class="font-mono text-xs text-[var(--color-text-muted)]">Overall Satisfaction Score</div>
          </div>
        </div>
      )}

      {/* Weights tab */}
      {tab === "weights" && (
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <CardTitle>Factor Weights (Importance)</CardTitle>
          <p class="mb-4 font-mono text-[10px] text-[var(--color-text-muted)]">How important is each factor to you? Higher weight = more influence on final score.</p>
          {GROUPS.map(g => (
            <div key={g} class="mb-4">
              <h3 class="mb-2 font-mono text-xs font-bold uppercase text-[var(--color-heading)]">{g}</h3>
              <div class="space-y-2">
                {FACTORS.filter(f => f.group === g).map(f => (
                  <div key={f.key} class="flex items-center gap-3">
                    <span class="w-40 font-mono text-xs text-[var(--color-text)]">{f.label}</span>
                    <input type="range" min="0" max="10" value={weights[f.key] || 0}
                      onInput={(e: any) => setWeights(w => ({ ...w, [f.key]: +e.target.value }))}
                      class="flex-1 accent-[#d4a843]" />
                    <span class="w-8 text-right font-mono text-xs text-[var(--color-text)]">{weights[f.key] || 0}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div class="mt-4 flex gap-3">
            <button onClick={() => setWeights(Object.fromEntries(FACTORS.map(f => [f.key, f.default])))}
              class="rounded border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)]">Reset Defaults</button>
            <button onClick={() => setWeights(Object.fromEntries(FACTORS.map(f => [f.key, 5])))}
              class="rounded border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)]">Equal Weights</button>
          </div>
        </div>
      )}

      {/* Formula explanation */}
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <CardTitle>Scoring Formula</CardTitle>
        <div class="font-mono text-xs text-[var(--color-text-muted)]">
          <p class="mb-2">S = [Σ αᵢ·f(ρᵢ) / Σ αᵢ·f(10)] × 100</p>
          <p>Where αᵢ = weight, ρᵢ = rating (0-10), f(x) = {scale === "log" ? "ln(x+1)" : "x"}</p>
          <p class="mt-1">Logarithmic scale models diminishing returns: going from 1→5 matters more than 5→9.</p>
        </div>
      </div>
    </div>
  );
}
