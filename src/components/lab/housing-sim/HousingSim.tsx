import { useState, useRef, useEffect, useMemo } from "preact/hooks";
import {
  Chart, CategoryScale, LinearScale, PointElement, LineElement,
  LineController, Filler, Legend, Tooltip,
} from "chart.js";

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, LineController, Filler, Legend, Tooltip);

const C = {
  gold: "#d4a843", blue: "#4a9eff", blueDim: "rgba(74,158,255,0.15)",
  green: "#3fb68a", greenDim: "rgba(63,182,138,0.15)",
  red: "#e05c6a", purple: "#a78bfa", orange: "#f59e0b",
  muted: "#7d8590", gridDark: "rgba(48,54,61,0.5)", gridLight: "rgba(0,0,0,0.06)",
};

const fmtM = (n: number) => "$" + new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(n);
const fmtPct = (n: number) => n.toFixed(2) + "%";

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

function calcMonthlyPayment(principal: number, monthlyRate: number, months: number): number {
  if (monthlyRate === 0) return principal / months;
  return principal * (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);
}

// ─── Main Component ──────────────────────────────────────────────────
export default function HousingSim() {
  // Buy parameters
  const [propertyPrice, setPropertyPrice] = useState(3_000_000);
  const [downPaymentPct, setDownPaymentPct] = useState(20);
  const [mortgageRate, setMortgageRate] = useState(10.5);
  const [mortgageTerm, setMortgageTerm] = useState(20);
  const [closingCostsPct, setClosingCostsPct] = useState(5);
  const [propertyTaxPct, setPropertyTaxPct] = useState(0.1);
  const [maintenancePct, setMaintenancePct] = useState(1);
  const [appreciation, setAppreciation] = useState(4);
  const [creditType, setCreditType] = useState<"bancario" | "infonavit" | "cofinavit">("bancario");

  // Rent parameters
  const [monthlyRent, setMonthlyRent] = useState(15000);
  const [rentIncrease, setRentIncrease] = useState(4);

  // Investment parameters
  const [investmentReturn, setInvestmentReturn] = useState(8);
  const [inflation, setInflation] = useState(4.5);
  const [horizonYears, setHorizonYears] = useState(20);

  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInst = useRef<Chart | null>(null);

  // ── Buy calculations ──
  const downPayment = propertyPrice * (downPaymentPct / 100);
  const closingCosts = propertyPrice * (closingCostsPct / 100);
  const loanAmount = propertyPrice - downPayment;
  const monthlyRate = mortgageRate / 100 / 12;
  const totalMonths = mortgageTerm * 12;
  const monthlyMortgage = calcMonthlyPayment(loanAmount, monthlyRate, totalMonths);

  // Infonavit adjustment
  const infonavitSubsidy = creditType === "infonavit" ? 0.02 : creditType === "cofinavit" ? 0.01 : 0;
  const effectiveRate = Math.max(0, mortgageRate - infonavitSubsidy * 100);

  const results = useMemo(() => {
    const buyData: { year: number; equity: number; totalSpent: number; netWorth: number }[] = [];
    const rentData: { year: number; invested: number; totalSpent: number; netWorth: number }[] = [];

    let buyTotalSpent = downPayment + closingCosts;
    let loanBalance = loanAmount;
    let propValue = propertyPrice;
    let rentTotalSpent = 0;
    let rentInvestment = downPayment + closingCosts; // renter invests the down payment
    let currentRent = monthlyRent;
    const monthlyMortgageActual = calcMonthlyPayment(loanAmount, effectiveRate / 100 / 12, totalMonths);

    for (let y = 1; y <= horizonYears; y++) {
      // BUY: annual costs
      const annualPropertyTax = propValue * (propertyTaxPct / 100);
      const annualMaintenance = propValue * (maintenancePct / 100);
      let yearMortgage = 0;

      for (let m = 0; m < 12; m++) {
        if (loanBalance > 0) {
          const interest = loanBalance * (effectiveRate / 100 / 12);
          const principal = Math.min(monthlyMortgageActual - interest, loanBalance);
          loanBalance -= principal;
          yearMortgage += monthlyMortgageActual;
        }
      }

      buyTotalSpent += yearMortgage + annualPropertyTax + annualMaintenance;
      propValue *= 1 + appreciation / 100;
      const buyEquity = propValue - Math.max(0, loanBalance);
      buyData.push({ year: y, equity: buyEquity, totalSpent: buyTotalSpent, netWorth: buyEquity });

      // RENT: annual costs
      let yearRent = 0;
      for (let m = 0; m < 12; m++) {
        yearRent += currentRent;
      }
      currentRent *= 1 + rentIncrease / 100;
      rentTotalSpent += yearRent;

      // Renter invests the difference
      const buyMonthlyTotal = (yearMortgage + annualPropertyTax + annualMaintenance) / 12;
      const monthlySavings = Math.max(0, buyMonthlyTotal - yearRent / 12);
      for (let m = 0; m < 12; m++) {
        rentInvestment = rentInvestment * (1 + investmentReturn / 100 / 12) + monthlySavings;
      }

      rentData.push({ year: y, invested: rentInvestment, totalSpent: rentTotalSpent, netWorth: rentInvestment });
    }

    return { buyData, rentData };
  }, [propertyPrice, downPayment, closingCosts, loanAmount, effectiveRate, totalMonths, propertyTaxPct, maintenancePct, appreciation, monthlyRent, rentIncrease, investmentReturn, horizonYears]);

  const finalBuy = results.buyData[results.buyData.length - 1];
  const finalRent = results.rentData[results.rentData.length - 1];
  const buyWins = finalBuy && finalRent && finalBuy.netWorth > finalRent.netWorth;
  const breakEvenYear = results.buyData.findIndex((b, i) => b.netWorth > (results.rentData[i]?.netWorth || 0)) + 1;

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
        labels: results.buyData.map(d => `Year ${d.year}`),
        datasets: [
          { label: "Buy (Net Worth)", data: results.buyData.map(d => d.netWorth), borderColor: C.blue, backgroundColor: C.blueDim, fill: true, tension: 0.3 },
          { label: "Rent + Invest (Net Worth)", data: results.rentData.map(d => d.netWorth), borderColor: C.green, backgroundColor: C.greenDim, fill: true, tension: 0.3 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, maxTicksLimit: 10 } },
          y: { grid: { color: gridColor }, ticks: { color: textColor, callback: (v: any) => v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${(v / 1000).toFixed(0)}K` } },
        },
        plugins: { legend: { labels: { color: textColor, font: { family: "monospace", size: 11 } } } },
      },
    });
    return () => { chartInst.current?.destroy(); chartInst.current = null; };
  }, [results]);

  return (
    <div class="space-y-6">
      {/* Summary */}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={`Winner (${horizonYears}yr)`} value={buyWins ? "Buy" : "Rent + Invest"} color={buyWins ? C.blue : C.green} />
        <StatCard label="Buy Net Worth" value={fmtM(finalBuy?.netWorth || 0)} color={C.blue} />
        <StatCard label="Rent Net Worth" value={fmtM(finalRent?.netWorth || 0)} color={C.green} />
        <StatCard label="Break-Even" value={breakEvenYear > 0 ? `Year ${breakEvenYear}` : "Never"} color={C.gold} />
      </div>

      <div class="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Left */}
        <div class="space-y-4">
          {/* Buy params */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Buy Parameters</CardTitle>
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Property Price</label>
                <input type="number" value={propertyPrice} onInput={(e: any) => setPropertyPrice(+e.target.value)}
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Down Payment (%)</label>
                <input type="number" value={downPaymentPct} onInput={(e: any) => setDownPaymentPct(+e.target.value)} min="0" max="100"
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Credit Type</label>
                <select value={creditType} onChange={(e: any) => setCreditType(e.target.value)}
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none">
                  <option value="bancario">Bancario</option>
                  <option value="infonavit">Infonavit</option>
                  <option value="cofinavit">Cofinavit</option>
                </select>
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Mortgage Rate (%)</label>
                <input type="number" value={mortgageRate} onInput={(e: any) => setMortgageRate(+e.target.value)} step="0.1"
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Term (years)</label>
                <input type="number" value={mortgageTerm} onInput={(e: any) => setMortgageTerm(+e.target.value)} min="5" max="30"
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Appreciation (%/yr)</label>
                <input type="number" value={appreciation} onInput={(e: any) => setAppreciation(+e.target.value)} step="0.5"
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Property Tax (%/yr)</label>
                <input type="number" value={propertyTaxPct} onInput={(e: any) => setPropertyTaxPct(+e.target.value)} step="0.01"
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Maintenance (%/yr)</label>
                <input type="number" value={maintenancePct} onInput={(e: any) => setMaintenancePct(+e.target.value)} step="0.1"
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
            </div>
          </div>

          {/* Rent params */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Rent Parameters</CardTitle>
            <div class="grid gap-3 sm:grid-cols-3">
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Monthly Rent</label>
                <input type="number" value={monthlyRent} onInput={(e: any) => setMonthlyRent(+e.target.value)}
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Rent Increase (%/yr)</label>
                <input type="number" value={rentIncrease} onInput={(e: any) => setRentIncrease(+e.target.value)} step="0.5"
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Investment Return (%)</label>
                <input type="number" value={investmentReturn} onInput={(e: any) => setInvestmentReturn(+e.target.value)} step="0.5"
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
            </div>
          </div>

          {/* Chart */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Net Worth Over Time</CardTitle>
            <div class="mb-3 flex items-center gap-2">
              <span class="font-mono text-xs text-[var(--color-text-muted)]">Horizon:</span>
              <input type="range" min="5" max="40" value={horizonYears} onInput={(e: any) => setHorizonYears(+e.target.value)} class="flex-1 accent-[#d4a843]" />
              <span class="font-mono text-xs text-[var(--color-text)]">{horizonYears} yrs</span>
            </div>
            <div style={{ height: "300px" }}><canvas ref={chartRef} /></div>
          </div>
        </div>

        {/* Right */}
        <div class="space-y-4">
          {/* Buy summary */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Buy Summary</CardTitle>
            <div class="space-y-2 font-mono text-xs">
              <div class="flex justify-between"><span class="text-[var(--color-text-muted)]">Down Payment</span><span class="text-[var(--color-text)]">{fmtM(downPayment)}</span></div>
              <div class="flex justify-between"><span class="text-[var(--color-text-muted)]">Closing Costs</span><span class="text-[var(--color-text)]">{fmtM(closingCosts)}</span></div>
              <div class="flex justify-between"><span class="text-[var(--color-text-muted)]">Loan Amount</span><span class="text-[var(--color-text)]">{fmtM(loanAmount)}</span></div>
              <div class="flex justify-between"><span class="text-[var(--color-text-muted)]">Monthly Payment</span><span style={{ color: C.blue }}>{fmtM(monthlyMortgage)}</span></div>
              <div class="flex justify-between"><span class="text-[var(--color-text-muted)]">Total Interest</span><span style={{ color: C.red }}>{fmtM(monthlyMortgage * totalMonths - loanAmount)}</span></div>
              <div class="border-t border-[var(--color-border)] pt-2 flex justify-between">
                <span class="text-[var(--color-text-muted)]">Total Paid ({mortgageTerm}yr)</span>
                <span class="text-[var(--color-heading)]">{fmtM(downPayment + closingCosts + monthlyMortgage * totalMonths)}</span>
              </div>
            </div>
          </div>

          {/* Rent summary */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Rent Summary</CardTitle>
            <div class="space-y-2 font-mono text-xs">
              <div class="flex justify-between"><span class="text-[var(--color-text-muted)]">Starting Rent</span><span class="text-[var(--color-text)]">{fmtM(monthlyRent)}/mo</span></div>
              <div class="flex justify-between"><span class="text-[var(--color-text-muted)]">Rent at Year {horizonYears}</span><span class="text-[var(--color-text)]">{fmtM(monthlyRent * Math.pow(1 + rentIncrease / 100, horizonYears))}/mo</span></div>
              <div class="flex justify-between"><span class="text-[var(--color-text-muted)]">Total Rent Paid</span><span style={{ color: C.red }}>{fmtM(finalRent?.totalSpent || 0)}</span></div>
              <div class="flex justify-between"><span class="text-[var(--color-text-muted)]">Portfolio Value</span><span style={{ color: C.green }}>{fmtM(finalRent?.invested || 0)}</span></div>
            </div>
          </div>

          {/* Verdict */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Verdict</CardTitle>
            <div class="text-center mb-3">
              <div class="font-mono text-2xl font-bold" style={{ color: buyWins ? C.blue : C.green }}>
                {buyWins ? "Buy Wins" : "Rent + Invest Wins"}
              </div>
              <div class="font-mono text-xs text-[var(--color-text-muted)]">
                by {fmtM(Math.abs((finalBuy?.netWorth || 0) - (finalRent?.netWorth || 0)))} after {horizonYears} years
              </div>
            </div>
            <div class="space-y-1 font-mono text-[10px] text-[var(--color-text-muted)]">
              {breakEvenYear > 0 && breakEvenYear < horizonYears && (
                <div class="rounded bg-blue-500/10 p-2 text-blue-400">Buying breaks even at year {breakEvenYear}</div>
              )}
              {!buyWins && (
                <div class="rounded bg-green-500/10 p-2 text-green-400">Investing the down payment + savings generates more wealth</div>
              )}
              <div class="rounded bg-[var(--color-bg)] p-2">
                This model assumes: {appreciation}% appreciation, {investmentReturn}% investment return, {rentIncrease}% rent increases
              </div>
              {creditType !== "bancario" && (
                <div class="rounded bg-purple-500/10 p-2 text-purple-400">
                  {creditType === "infonavit" ? "Infonavit" : "Cofinavit"} rate adjustment: -{(infonavitSubsidy * 100).toFixed(0)}% effective rate
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
