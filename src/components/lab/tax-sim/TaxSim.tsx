import { useState, useRef, useEffect, useMemo } from "preact/hooks";
import {
  Chart, CategoryScale, LinearScale, BarElement, BarController,
  PointElement, LineElement, LineController, Filler, Legend, Tooltip,
} from "chart.js";

Chart.register(CategoryScale, LinearScale, BarElement, BarController, PointElement, LineElement, LineController, Filler, Legend, Tooltip);

const C = {
  gold: "#d4a843", blue: "#4a9eff", blueDim: "rgba(74,158,255,0.15)",
  green: "#3fb68a", greenDim: "rgba(63,182,138,0.15)",
  red: "#e05c6a", purple: "#a78bfa", orange: "#f59e0b",
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

const fmt = (n: number) => "$" + new Intl.NumberFormat("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
const fmtPct = (n: number) => n.toFixed(2) + "%";

// ─── 2024 ISR Brackets (Art. 152 LISR) ──────────────────────────────
const ISR_BRACKETS = [
  { lower: 0.01, upper: 8952.49, fixed: 0, rate: 1.92 },
  { lower: 8952.50, upper: 75984.55, fixed: 171.88, rate: 6.40 },
  { lower: 75984.56, upper: 133536.07, fixed: 4461.94, rate: 10.88 },
  { lower: 133536.08, upper: 155229.80, fixed: 10723.55, rate: 16.00 },
  { lower: 155229.81, upper: 185852.57, fixed: 14194.54, rate: 17.92 },
  { lower: 185852.58, upper: 374837.88, fixed: 19682.13, rate: 21.36 },
  { lower: 374837.89, upper: 590795.99, fixed: 60049.40, rate: 23.52 },
  { lower: 590796.00, upper: 1127926.84, fixed: 110842.74, rate: 30.00 },
  { lower: 1127926.85, upper: 1503902.46, fixed: 271981.99, rate: 32.00 },
  { lower: 1503902.47, upper: 4511707.37, fixed: 392294.17, rate: 34.00 },
  { lower: 4511707.38, upper: Infinity, fixed: 1414947.85, rate: 35.00 },
];

// RESICO brackets (simplified regime)
const RESICO_RATES = [
  { lower: 0.01, upper: 25000, rate: 1.00 },
  { lower: 25000.01, upper: 50000, rate: 1.10 },
  { lower: 50000.01, upper: 83333.33, rate: 1.50 },
  { lower: 83333.34, upper: 208333.33, rate: 2.00 },
  { lower: 208333.34, upper: 291666.67, rate: 2.50 },
];

// Subsidy brackets
const SUBSIDY_BRACKETS = [
  { lower: 0.01, upper: 7382.33, subsidy: 407.02 },
  { lower: 7382.34, upper: 10298.35, subsidy: 406.83 },
  { lower: 10298.36, upper: 10152.01, subsidy: 406.62 },
  { lower: 10152.02, upper: 11128.01, subsidy: 392.77 },
  { lower: 11128.02, upper: 13381.47, subsidy: 382.46 },
  { lower: 13381.48, upper: 15992.68, subsidy: 354.23 },
  { lower: 15992.69, upper: 20888.11, subsidy: 324.87 },
  { lower: 20888.12, upper: 24222.31, subsidy: 294.63 },
  { lower: 24222.32, upper: Infinity, subsidy: 253.54 },
];

// Art. 151 deduction categories
const DEDUCTION_TYPES = [
  { key: "medical", label: "Medical/Dental/Hospital", cap: "none" },
  { key: "funeral", label: "Funeral Expenses", cap: "1 UMA annual" },
  { key: "donations", label: "Donations", cap: "7% of prev year income" },
  { key: "mortgage", label: "Mortgage Interest (real)", cap: "750K UDIS" },
  { key: "insurance", label: "Insurance Premiums", cap: "none" },
  { key: "transport", label: "School Transport", cap: "none" },
  { key: "retirement", label: "Retirement (PPR Art.151)", cap: "10% income or 5 UMAs" },
  { key: "education", label: "School Tuition", cap: "varies by level" },
];

function calcISR(annualIncome: number): { isr: number; bracket: typeof ISR_BRACKETS[0]; effectiveRate: number; marginalRate: number } {
  if (annualIncome <= 0) return { isr: 0, bracket: ISR_BRACKETS[0], effectiveRate: 0, marginalRate: 0 };
  const bracket = ISR_BRACKETS.find(b => annualIncome >= b.lower && annualIncome <= b.upper) || ISR_BRACKETS[ISR_BRACKETS.length - 1];
  const excess = annualIncome - bracket.lower;
  const isr = bracket.fixed + excess * (bracket.rate / 100);
  return { isr, bracket, effectiveRate: (isr / annualIncome) * 100, marginalRate: bracket.rate };
}

function calcRESICO(monthlyIncome: number): number {
  if (monthlyIncome <= 0) return 0;
  const bracket = RESICO_RATES.find(b => monthlyIncome >= b.lower && monthlyIncome <= b.upper);
  return bracket ? monthlyIncome * (bracket.rate / 100) : monthlyIncome * 0.025;
}

// ─── Main Component ──────────────────────────────────────────────────
export default function TaxSim() {
  const [monthlyGross, setMonthlyGross] = useState(50000);
  const [regime, setRegime] = useState<"asalariado" | "resico" | "actividad">("asalariado");
  const [deductions, setDeductions] = useState<Record<string, number>>(Object.fromEntries(DEDUCTION_TYPES.map(d => [d.key, 0])));
  const [aguinaldo, setAguinaldo] = useState(15); // days
  const [vacationPremium, setVacationPremium] = useState(12); // days
  const [profitSharing, setProfitSharing] = useState(0); // PTU
  const [retentions, setRetentions] = useState(0); // ISR already withheld

  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInst = useRef<Chart | null>(null);
  const compRef = useRef<HTMLCanvasElement>(null);
  const compInst = useRef<Chart | null>(null);

  const annualGross = monthlyGross * 12;
  const aguinaldoAmount = (monthlyGross / 30) * aguinaldo;
  const vacPremiumAmount = (monthlyGross / 30) * vacationPremium * 0.25;
  const totalAnnualIncome = annualGross + aguinaldoAmount + vacPremiumAmount + profitSharing;

  const totalDeductions = useMemo(() => {
    const sum = Object.values(deductions).reduce((a, b) => a + b, 0);
    const umaAnnual = 206368;
    const cap = Math.min(totalAnnualIncome * 0.15, 5 * umaAnnual);
    return Math.min(sum, cap);
  }, [deductions, totalAnnualIncome]);

  const taxableIncome = Math.max(0, totalAnnualIncome - totalDeductions);

  const isrResult = useMemo(() => calcISR(taxableIncome), [taxableIncome]);
  const isrNoDeductions = useMemo(() => calcISR(totalAnnualIncome), [totalAnnualIncome]);
  const deductionSavings = isrNoDeductions.isr - isrResult.isr;

  const resicoAnnual = useMemo(() => calcRESICO(monthlyGross) * 12, [monthlyGross]);
  const resicoEffective = totalAnnualIncome > 0 ? (resicoAnnual / totalAnnualIncome) * 100 : 0;

  const netAnnual = totalAnnualIncome - isrResult.isr;
  const netMonthly = netAnnual / 12;
  const isrMonthly = isrResult.isr / 12;
  const pendingISR = isrResult.isr - retentions;

  // ── Effective rate chart ──
  useEffect(() => {
    if (!chartRef.current) return;
    chartInst.current?.destroy();
    const isDark = !document.documentElement.classList.contains("light");
    const gridColor = isDark ? C.gridDark : C.gridLight;
    const textColor = isDark ? "#e4e4e7" : "#3f3f46";

    const incomes: number[] = [];
    const effectiveRates: number[] = [];
    const marginalRates: number[] = [];
    const resicoRates: number[] = [];
    for (let inc = 5000; inc <= 300000; inc += 5000) {
      const annual = inc * 12;
      incomes.push(inc);
      const r = calcISR(annual);
      effectiveRates.push(r.effectiveRate);
      marginalRates.push(r.marginalRate);
      const resico = calcRESICO(inc) * 12;
      resicoRates.push(annual > 0 ? (resico / annual) * 100 : 0);
    }

    chartInst.current = new Chart(chartRef.current, {
      type: "line",
      data: {
        labels: incomes.map(i => `$${(i / 1000).toFixed(0)}K`),
        datasets: [
          { label: "Effective Rate (ISR)", data: effectiveRates, borderColor: C.blue, tension: 0.3, pointRadius: 0 },
          { label: "Marginal Rate", data: marginalRates, borderColor: C.red, borderDash: [5, 5], tension: 0, pointRadius: 0 },
          { label: "RESICO Rate", data: resicoRates, borderColor: C.green, tension: 0.3, pointRadius: 0 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, maxTicksLimit: 10 }, title: { display: true, text: "Monthly Income", color: textColor } },
          y: { min: 0, max: 40, grid: { color: gridColor }, ticks: { color: textColor, callback: (v: any) => v + "%" } },
        },
        plugins: { legend: { labels: { color: textColor, font: { family: "monospace", size: 10 } } } },
      },
    });
    return () => { chartInst.current?.destroy(); chartInst.current = null; };
  }, []);

  // ── Regime comparison chart ──
  useEffect(() => {
    if (!compRef.current) return;
    compInst.current?.destroy();
    const isDark = !document.documentElement.classList.contains("light");
    const gridColor = isDark ? C.gridDark : C.gridLight;
    const textColor = isDark ? "#e4e4e7" : "#3f3f46";

    compInst.current = new Chart(compRef.current, {
      type: "bar",
      data: {
        labels: ["Asalariado", "RESICO", "With Deductions"],
        datasets: [{
          label: "Annual ISR",
          data: [isrNoDeductions.isr, resicoAnnual, isrResult.isr],
          backgroundColor: [C.blue, C.green, C.purple],
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false }, ticks: { color: textColor } },
          y: { grid: { color: gridColor }, ticks: { color: textColor, callback: (v: any) => fmt(v) } },
        },
        plugins: { legend: { display: false } },
      },
    });
    return () => { compInst.current?.destroy(); compInst.current = null; };
  }, [isrNoDeductions.isr, resicoAnnual, isrResult.isr]);

  return (
    <div class="space-y-6">
      {/* Summary */}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Annual ISR" value={fmt(isrResult.isr)} color={C.red} sub={fmtPct(isrResult.effectiveRate) + " effective"} />
        <StatCard label="Net Monthly" value={fmt(netMonthly)} color={C.green} />
        <StatCard label="Deduction Savings" value={fmt(deductionSavings)} color={deductionSavings > 0 ? C.gold : C.muted} sub="/year" />
        <StatCard label={pendingISR > 0 ? "ISR to Pay" : "ISR Refund"} value={fmt(Math.abs(pendingISR))}
          color={pendingISR > 0 ? C.red : C.green} sub="at annual filing" />
      </div>

      <div class="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Left */}
        <div class="space-y-4">
          {/* Income */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Income</CardTitle>
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Monthly Gross</label>
                <input type="number" value={monthlyGross} onInput={(e: any) => setMonthlyGross(+e.target.value)}
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Regime</label>
                <select value={regime} onChange={(e: any) => setRegime(e.target.value)}
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none">
                  <option value="asalariado">Asalariado (employee)</option>
                  <option value="resico">RESICO (simplified)</option>
                  <option value="actividad">Actividad Empresarial</option>
                </select>
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Aguinaldo (days)</label>
                <input type="number" value={aguinaldo} onInput={(e: any) => setAguinaldo(+e.target.value)} min="15"
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Vacation Premium Days</label>
                <input type="number" value={vacationPremium} onInput={(e: any) => setVacationPremium(+e.target.value)} min="12"
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">PTU (Profit Sharing)</label>
                <input type="number" value={profitSharing} onInput={(e: any) => setProfitSharing(+e.target.value)}
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">ISR Already Withheld</label>
                <input type="number" value={retentions} onInput={(e: any) => setRetentions(+e.target.value)}
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
            </div>
          </div>

          {/* Deductions */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Personal Deductions (Art. 151)</CardTitle>
            <div class="space-y-2">
              {DEDUCTION_TYPES.map(d => (
                <div key={d.key} class="flex items-center gap-3">
                  <span class="w-48 font-mono text-xs text-[var(--color-text)]">{d.label}</span>
                  <input type="number" value={deductions[d.key]} onInput={(e: any) => setDeductions(prev => ({ ...prev, [d.key]: +e.target.value }))}
                    class="w-32 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 font-mono text-xs text-[var(--color-text)] outline-none" />
                  <span class="font-mono text-[9px] text-[var(--color-text-muted)]">{d.cap}</span>
                </div>
              ))}
            </div>
            <div class="mt-3 flex justify-between rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 font-mono text-xs">
              <span class="text-[var(--color-text-muted)]">Total deductible:</span>
              <span class="text-[var(--color-heading)]">{fmt(totalDeductions)}</span>
            </div>
            <p class="mt-1 font-mono text-[9px] text-[var(--color-text-muted)]">Cap: 15% of income or 5 UMAs (~$206,368), whichever is lower.</p>
          </div>

          {/* Tax rate curves */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Tax Rate Curves</CardTitle>
            <div style={{ height: "280px" }}><canvas ref={chartRef} /></div>
            <p class="mt-2 font-mono text-[10px] text-[var(--color-text-muted)]">
              RESICO available for income &lt; $3.5M/year. Shows effective (actual) vs marginal (bracket) rates.
            </p>
          </div>
        </div>

        {/* Right */}
        <div class="space-y-4">
          {/* Breakdown */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Annual Breakdown</CardTitle>
            <div class="space-y-2 font-mono text-xs">
              {[
                { label: "Salary (12 months)", value: annualGross, color: C.blue },
                { label: "Aguinaldo", value: aguinaldoAmount, color: C.blue },
                { label: "Vacation Premium", value: vacPremiumAmount, color: C.blue },
                { label: "PTU", value: profitSharing, color: C.blue },
              ].map(r => (
                <div key={r.label} class="flex justify-between">
                  <span class="text-[var(--color-text-muted)]">{r.label}</span>
                  <span style={{ color: r.color }}>{fmt(r.value)}</span>
                </div>
              ))}
              <div class="border-t border-[var(--color-border)] pt-2 flex justify-between font-bold">
                <span class="text-[var(--color-heading)]">Total Annual Income</span>
                <span class="text-[var(--color-heading)]">{fmt(totalAnnualIncome)}</span>
              </div>
              <div class="flex justify-between" style={{ color: C.gold }}>
                <span>- Deductions</span>
                <span>{fmt(totalDeductions)}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-[var(--color-text-muted)]">= Taxable Income</span>
                <span class="text-[var(--color-text)]">{fmt(taxableIncome)}</span>
              </div>
              <div class="border-t border-[var(--color-border)] pt-2 flex justify-between" style={{ color: C.red }}>
                <span>ISR</span>
                <span>{fmt(isrResult.isr)}</span>
              </div>
              <div class="flex justify-between font-bold" style={{ color: C.green }}>
                <span>Net Annual</span>
                <span>{fmt(netAnnual)}</span>
              </div>
            </div>
          </div>

          {/* ISR Bracket */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Your ISR Bracket</CardTitle>
            <div class="space-y-2 font-mono text-[10px]">
              <div class="rounded bg-[var(--color-bg)] p-2">
                <span class="text-[var(--color-text-muted)]">Marginal rate: </span>
                <span class="font-bold" style={{ color: C.red }}>{fmtPct(isrResult.marginalRate)}</span>
              </div>
              <div class="rounded bg-[var(--color-bg)] p-2">
                <span class="text-[var(--color-text-muted)]">Effective rate: </span>
                <span class="font-bold" style={{ color: C.blue }}>{fmtPct(isrResult.effectiveRate)}</span>
              </div>
              <div class="rounded bg-[var(--color-bg)] p-2">
                <span class="text-[var(--color-text-muted)]">Fixed quota: </span>
                <span class="text-[var(--color-text)]">{fmt(isrResult.bracket.fixed)}</span>
              </div>
              <div class="rounded bg-[var(--color-bg)] p-2">
                <span class="text-[var(--color-text-muted)]">Bracket: </span>
                <span class="text-[var(--color-text)]">{fmt(isrResult.bracket.lower)} — {isrResult.bracket.upper === Infinity ? "∞" : fmt(isrResult.bracket.upper)}</span>
              </div>
            </div>
          </div>

          {/* Regime comparison */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Regime Comparison</CardTitle>
            <div style={{ height: "200px" }}><canvas ref={compRef} /></div>
            <div class="mt-2 space-y-1 font-mono text-[10px]">
              <div class="flex justify-between">
                <span class="text-[var(--color-text-muted)]">Asalariado:</span>
                <span style={{ color: C.blue }}>{fmt(isrNoDeductions.isr)} ({fmtPct(isrNoDeductions.effectiveRate)})</span>
              </div>
              <div class="flex justify-between">
                <span class="text-[var(--color-text-muted)]">RESICO:</span>
                <span style={{ color: C.green }}>{fmt(resicoAnnual)} ({fmtPct(resicoEffective)})</span>
              </div>
              <div class="flex justify-between">
                <span class="text-[var(--color-text-muted)]">W/ Deductions:</span>
                <span style={{ color: C.purple }}>{fmt(isrResult.isr)} ({fmtPct(isrResult.effectiveRate)})</span>
              </div>
            </div>
            {monthlyGross * 12 <= 3_500_000 && resicoAnnual < isrResult.isr && (
              <div class="mt-2 rounded bg-green-500/10 p-2 font-mono text-[10px] text-green-400">
                RESICO would save you {fmt(isrResult.isr - resicoAnnual)}/year. Eligible if income &lt; $3.5M/year.
              </div>
            )}
          </div>

          {/* ISR brackets table */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>2024 ISR Brackets</CardTitle>
            <div class="max-h-48 overflow-y-auto">
              <table class="w-full font-mono text-[9px]">
                <thead>
                  <tr class="text-[var(--color-text-muted)]">
                    <th class="p-1 text-left">From</th>
                    <th class="p-1 text-left">To</th>
                    <th class="p-1 text-right">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {ISR_BRACKETS.map((b, i) => {
                    const active = taxableIncome >= b.lower && (taxableIncome <= b.upper || b.upper === Infinity);
                    return (
                      <tr key={i} class={active ? "bg-[var(--color-bg)]" : ""}>
                        <td class="p-1 text-[var(--color-text)]">{fmt(b.lower)}</td>
                        <td class="p-1 text-[var(--color-text)]">{b.upper === Infinity ? "∞" : fmt(b.upper)}</td>
                        <td class="p-1 text-right" style={{ color: active ? C.gold : "var(--color-text-muted)" }}>{b.rate}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
