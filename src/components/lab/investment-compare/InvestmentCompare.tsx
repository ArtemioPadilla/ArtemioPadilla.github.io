import { useState, useRef, useEffect, useMemo } from "preact/hooks";
import {
  Chart, CategoryScale, LinearScale, PointElement, LineElement,
  LineController, Filler, Legend, Tooltip,
} from "chart.js";

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, LineController, Filler, Legend, Tooltip);

const C = {
  gold: "#d4a843", blue: "#4a9eff", blueDim: "rgba(74,158,255,0.15)",
  green: "#3fb68a", greenDim: "rgba(63,182,138,0.15)",
  red: "#e05c6a", purple: "#a78bfa", purpleDim: "rgba(167,139,250,0.15)",
  orange: "#f59e0b", orangeDim: "rgba(245,158,11,0.15)",
  cyan: "#22d3ee",
  muted: "#7d8590", gridDark: "rgba(48,54,61,0.5)", gridLight: "rgba(0,0,0,0.06)",
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

const fmtM = (n: number) => "$" + new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(n);
const fmtPct = (n: number) => n.toFixed(2) + "%";

// ─── Investment Instruments ──────────────────────────────────────────
interface Instrument {
  id: number;
  name: string;
  nominalRate: number;    // annual %
  inflationAdj: boolean;  // if rate is already real
  taxRate: number;        // ISR retention %
  minInvestment: number;
  lockDays: number;       // 0 = liquid
  risk: "low" | "medium" | "high";
  category: string;
  color: string;
  enabled: boolean;
}

const DEFAULT_INSTRUMENTS: Omit<Instrument, "id" | "enabled">[] = [
  { name: "CETES 28d", nominalRate: 11.00, inflationAdj: false, taxRate: 0.15, minInvestment: 100, lockDays: 28, risk: "low", category: "Government", color: C.blue },
  { name: "CETES 91d", nominalRate: 11.20, inflationAdj: false, taxRate: 0.15, minInvestment: 100, lockDays: 91, risk: "low", category: "Government", color: C.blue },
  { name: "CETES 182d", nominalRate: 11.10, inflationAdj: false, taxRate: 0.15, minInvestment: 100, lockDays: 182, risk: "low", category: "Government", color: C.blue },
  { name: "CETES 364d", nominalRate: 10.80, inflationAdj: false, taxRate: 0.15, minInvestment: 100, lockDays: 364, risk: "low", category: "Government", color: C.blue },
  { name: "BONDDIA", nominalRate: 10.90, inflationAdj: false, taxRate: 0.15, minInvestment: 100, lockDays: 0, risk: "low", category: "Government", color: C.cyan },
  { name: "UDIBONOS", nominalRate: 4.50, inflationAdj: true, taxRate: 0.15, minInvestment: 100, lockDays: 364, risk: "low", category: "Government", color: C.green },
  { name: "SOFIPO (savings)", nominalRate: 13.00, inflationAdj: false, taxRate: 0, minInvestment: 100, lockDays: 0, risk: "medium", category: "Fintech", color: C.orange },
  { name: "S&P 500 ETF", nominalRate: 10.50, inflationAdj: false, taxRate: 10, minInvestment: 5000, lockDays: 0, risk: "high", category: "Equity", color: C.purple },
  { name: "IPC ETF (Mexico)", nominalRate: 8.00, inflationAdj: false, taxRate: 10, minInvestment: 1000, lockDays: 0, risk: "high", category: "Equity", color: C.red },
  { name: "Real Estate (avg)", nominalRate: 7.00, inflationAdj: false, taxRate: 0, minInvestment: 500000, lockDays: 0, risk: "medium", category: "Real Assets", color: C.gold },
  { name: "Bank Savings", nominalRate: 3.50, inflationAdj: false, taxRate: 0.15, minInvestment: 0, lockDays: 0, risk: "low", category: "Banking", color: C.muted },
];

function calcGrowth(initial: number, monthly: number, nominalRate: number, inflation: number, taxRate: number, inflationAdj: boolean, years: number) {
  const months = years * 12;
  const realRate = inflationAdj ? nominalRate : nominalRate - inflation;
  const afterTaxRate = nominalRate * (1 - taxRate / 100);
  const afterTaxReal = inflationAdj ? afterTaxRate : afterTaxRate - inflation;
  const monthlyRate = afterTaxReal / 100 / 12;

  let balance = initial;
  const trajectory: number[] = [initial];
  for (let m = 1; m <= months; m++) {
    balance = balance * (1 + monthlyRate) + monthly;
    if (m % 12 === 0) trajectory.push(balance);
  }
  if (months % 12 !== 0) trajectory.push(balance);

  const totalContributed = initial + monthly * months;
  const totalReturn = balance - totalContributed;
  return { finalBalance: balance, totalContributed, totalReturn, realRate: afterTaxReal, trajectory };
}

// ─── Main Component ──────────────────────────────────────────────────
export default function InvestmentCompare() {
  const [instruments, setInstruments] = useState<Instrument[]>(
    DEFAULT_INSTRUMENTS.map((inst, i) => ({ ...inst, id: i + 1, enabled: i < 5 }))
  );
  const [initial, setInitial] = useState(50000);
  const [monthly, setMonthly] = useState(5000);
  const [years, setYears] = useState(10);
  const [inflation, setInflation] = useState(4.5);

  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInst = useRef<Chart | null>(null);

  const enabled = instruments.filter(i => i.enabled);

  const results = useMemo(() => {
    return enabled.map(inst => {
      const g = calcGrowth(initial, monthly, inst.nominalRate, inflation, inst.taxRate, inst.inflationAdj, years);
      return { ...inst, ...g };
    }).sort((a, b) => b.finalBalance - a.finalBalance);
  }, [enabled, initial, monthly, years, inflation]);

  const best = results[0];
  const worst = results[results.length - 1];
  const totalContributed = results[0]?.totalContributed || 0;

  // ── Chart ──
  useEffect(() => {
    if (!chartRef.current || results.length === 0) return;
    chartInst.current?.destroy();
    const isDark = !document.documentElement.classList.contains("light");
    const gridColor = isDark ? C.gridDark : C.gridLight;
    const textColor = isDark ? "#e4e4e7" : "#3f3f46";

    const labels = Array.from({ length: years + 1 }, (_, i) => `Year ${i}`);
    const datasets = results.map(r => ({
      label: r.name,
      data: r.trajectory,
      borderColor: r.color,
      backgroundColor: r.color + "15",
      fill: false,
      tension: 0.3,
      pointRadius: 2,
    }));

    // Add contributions line
    const contribData = Array.from({ length: years + 1 }, (_, i) => initial + monthly * 12 * i);
    datasets.push({
      label: "Contributions",
      data: contribData,
      borderColor: C.muted,
      backgroundColor: "transparent",
      fill: false,
      tension: 0,
      pointRadius: 0,
    } as any);

    chartInst.current = new Chart(chartRef.current, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor } },
          y: { grid: { color: gridColor }, ticks: { color: textColor, callback: (v: any) => v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${(v / 1000).toFixed(0)}K` } },
        },
        plugins: { legend: { labels: { color: textColor, font: { family: "monospace", size: 10 } } } },
      },
    });
    return () => { chartInst.current?.destroy(); chartInst.current = null; };
  }, [results, years]);

  function toggleInstrument(id: number) {
    setInstruments(p => p.map(i => i.id === id ? { ...i, enabled: !i.enabled } : i));
  }

  return (
    <div class="space-y-6">
      {/* Summary */}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Best Return" value={best ? fmtM(best.finalBalance) : "—"} color={C.green} sub={best ? `${best.name} (${fmtPct(best.realRate)} real)` : ""} />
        <StatCard label="Contributed" value={fmtM(totalContributed)} color={C.blue} sub={`${years} years`} />
        <StatCard label="Best Gain" value={best ? fmtM(best.totalReturn) : "—"} color={best && best.totalReturn > 0 ? C.green : C.red} />
        <StatCard label="Instruments" value={String(enabled.length)} color={C.gold} sub={`of ${instruments.length}`} />
      </div>

      <div class="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Left */}
        <div class="space-y-4">
          {/* Parameters */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Investment Parameters</CardTitle>
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Initial Investment</label>
                <input type="number" value={initial} onInput={(e: any) => setInitial(+e.target.value)}
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Monthly Contribution</label>
                <input type="number" value={monthly} onInput={(e: any) => setMonthly(+e.target.value)}
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Time Horizon</label>
                <div class="flex items-center gap-2">
                  <input type="range" min="1" max="40" value={years} onInput={(e: any) => setYears(+e.target.value)} class="flex-1 accent-[#d4a843]" />
                  <span class="w-16 font-mono text-xs text-[var(--color-text)]">{years} yrs</span>
                </div>
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Expected Inflation</label>
                <div class="flex items-center gap-2">
                  <input type="range" min="0" max="15" step="0.5" value={inflation} onInput={(e: any) => setInflation(+e.target.value)} class="flex-1 accent-[#d4a843]" />
                  <span class="w-12 font-mono text-xs text-[var(--color-text)]">{inflation}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Growth chart */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Growth Projection (Real Terms)</CardTitle>
            <div style={{ height: "320px" }}><canvas ref={chartRef} /></div>
            <p class="mt-2 font-mono text-[10px] text-[var(--color-text-muted)]">
              All values in real (inflation-adjusted) terms. Gray dashed = contributions only.
            </p>
          </div>

          {/* Results table */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 overflow-x-auto">
            <CardTitle>Comparison Table</CardTitle>
            <table class="w-full border-collapse font-mono text-xs">
              <thead>
                <tr class="text-[var(--color-text-muted)]">
                  <th class="border-b border-[var(--color-border)] p-2 text-left">Instrument</th>
                  <th class="border-b border-[var(--color-border)] p-2 text-right">Nominal</th>
                  <th class="border-b border-[var(--color-border)] p-2 text-right">Real*</th>
                  <th class="border-b border-[var(--color-border)] p-2 text-right">Final Balance</th>
                  <th class="border-b border-[var(--color-border)] p-2 text-right">Total Return</th>
                  <th class="border-b border-[var(--color-border)] p-2 text-center">Risk</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={r.id} class="hover:bg-[var(--color-bg)]">
                    <td class="border-b border-[var(--color-border)] p-2">
                      <span class="inline-block h-2 w-2 rounded-full mr-2" style={{ background: r.color }} />
                      <span class="text-[var(--color-heading)]">{r.name}</span>
                    </td>
                    <td class="border-b border-[var(--color-border)] p-2 text-right text-[var(--color-text)]">{fmtPct(r.nominalRate)}</td>
                    <td class="border-b border-[var(--color-border)] p-2 text-right" style={{ color: r.realRate > 0 ? C.green : C.red }}>{fmtPct(r.realRate)}</td>
                    <td class="border-b border-[var(--color-border)] p-2 text-right font-bold" style={{ color: i === 0 ? C.gold : "var(--color-text)" }}>{fmtM(r.finalBalance)}</td>
                    <td class="border-b border-[var(--color-border)] p-2 text-right" style={{ color: r.totalReturn > 0 ? C.green : C.red }}>{fmtM(r.totalReturn)}</td>
                    <td class="border-b border-[var(--color-border)] p-2 text-center">
                      <span class={`rounded px-1.5 py-0.5 text-[9px] uppercase ${r.risk === "low" ? "bg-green-500/20 text-green-400" : r.risk === "medium" ? "bg-orange-500/20 text-orange-400" : "bg-red-500/20 text-red-400"}`}>{r.risk}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p class="mt-2 font-mono text-[9px] text-[var(--color-text-muted)]">*Real rate = after-tax nominal minus inflation. For UDIBONOS, rate is already real.</p>
          </div>
        </div>

        {/* Right */}
        <div class="space-y-4">
          {/* Instrument selector */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Instruments</CardTitle>
            <div class="space-y-1">
              {instruments.map(inst => (
                <button key={inst.id} onClick={() => toggleInstrument(inst.id)}
                  class={`flex w-full items-center justify-between rounded border p-2 text-left transition-colors ${inst.enabled ? "border-[var(--color-primary)] bg-[var(--color-bg)]" : "border-[var(--color-border)] bg-transparent opacity-50"}`}>
                  <div class="flex items-center gap-2">
                    <span class="inline-block h-2.5 w-2.5 rounded-full" style={{ background: inst.color }} />
                    <span class="font-mono text-xs text-[var(--color-heading)]">{inst.name}</span>
                  </div>
                  <div class="font-mono text-[10px] text-[var(--color-text-muted)]">
                    {fmtPct(inst.nominalRate)} · {inst.risk}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Key insights */}
          {results.length >= 2 && (
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <CardTitle>Insights</CardTitle>
              <div class="space-y-2 font-mono text-[10px] text-[var(--color-text-muted)]">
                <div class="rounded bg-green-500/10 p-2 text-green-400">
                  Best: {best.name} yields {fmtM(best.finalBalance)} ({fmtPct(best.realRate)} real)
                </div>
                {worst && (
                  <div class="rounded bg-red-500/10 p-2 text-red-400">
                    Worst: {worst.name} yields {fmtM(worst.finalBalance)} — {fmtM(best.finalBalance - worst.finalBalance)} less
                  </div>
                )}
                <div class="rounded bg-[var(--color-bg)] p-2">
                  Inflation erodes {fmtPct(inflation)} per year. Any return below {fmtPct(inflation)} loses purchasing power.
                </div>
                {results.some(r => r.realRate < 0) && (
                  <div class="rounded bg-orange-500/10 p-2 text-orange-400">
                    {results.filter(r => r.realRate < 0).map(r => r.name).join(", ")} have negative real returns after inflation.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tax info */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Tax Impact</CardTitle>
            <div class="space-y-2 font-mono text-[10px] text-[var(--color-text-muted)]">
              <p>Government bonds (CETES, BONDDIA): 0.15% ISR retention on capital gains</p>
              <p>Equities: 10% ISR on gains upon sale</p>
              <p>SOFIPO: Tax-exempt up to 5 UMAs annual (~$206K)</p>
              <p>Real estate: Various regimes, typically ISR on sale</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
