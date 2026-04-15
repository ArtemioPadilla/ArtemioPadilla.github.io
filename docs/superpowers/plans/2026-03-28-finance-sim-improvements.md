# Finance Simulator — Full Improvement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 10 improvements to the finance simulator, ordered from highest to lowest impact for a dual-income Mexican household scenario with mortgage, family loans, and salary-based income.

**Architecture:** Each task is a self-contained feature that modifies `FinanceSim.tsx` and optionally creates shared utility modules in `src/components/lab/shared/`. Features build on the existing single-component architecture. New pure-logic modules are extracted to `shared/` to keep the main file from growing unboundedly. No test framework exists yet — verify via `npm run build` and dev server.

**Tech Stack:** Preact + TypeScript, Chart.js, Astro 5, Tailwind CSS v4

---

## File Map

| File | Role | Tasks |
|---|---|---|
| `src/components/lab/finance-sim/FinanceSim.tsx` | Main component (interfaces, engine, UI) | All tasks |
| `src/components/lab/shared/mexican-tax.ts` | **Create** — ISR bracket calculator, exemptions | Task 1 |
| `src/components/lab/shared/payoff-projection.ts` | **Create** — Beyond-horizon loan payoff math | Task 6 |

---

## Task 1: Tax Modeling (Mexican ISR)

**Priority:** Highest — all incomes are gross, sim overstates disposable income by ~20%.

**Files:**
- Create: `src/components/lab/shared/mexican-tax.ts`
- Modify: `src/components/lab/finance-sim/FinanceSim.tsx` (interfaces ~line 80, simulate ~line 449, UI ~line 1249)

### Design

Mexican payroll tax for _asalariados_ works via monthly ISR tables. Each income source has its own tax treatment:

- **Salaries**: Monthly ISR table, employer withholds
- **Aguinaldo**: First 30 UMA daily values exempt, rest taxed
- **PTU**: First 15 UMA daily values exempt, rest taxed
- **Bonuses**: Taxed as ordinary income (no exemption)
- **Investment interest**: 0.15% withholding on average daily balance (simplified)

The sim should compute ISR per income source, sum deductions (PPR Art.151 already exists), and show both gross and net income.

### Steps

- [ ] **Step 1: Create the ISR calculation module**

Create `src/components/lab/shared/mexican-tax.ts`:

```typescript
/**
 * Mexican ISR (Impuesto Sobre la Renta) calculator.
 * Based on 2025 monthly ISR tables for asalariados.
 * UMA 2025: $113.14/day (update annually).
 */

export interface IsrBracket {
  lowerLimit: number;
  upperLimit: number;
  fixedFee: number;
  rate: number; // decimal, e.g. 0.064
}

// 2025 monthly ISR table (Art. 96 LISR)
export const ISR_MONTHLY_2025: IsrBracket[] = [
  { lowerLimit: 0.01,    upperLimit: 746.04,     fixedFee: 0,       rate: 0.0192 },
  { lowerLimit: 746.05,  upperLimit: 6332.05,    fixedFee: 14.32,   rate: 0.0640 },
  { lowerLimit: 6332.06, upperLimit: 11128.01,   fixedFee: 371.83,  rate: 0.1088 },
  { lowerLimit: 11128.02, upperLimit: 12935.82,  fixedFee: 893.63,  rate: 0.16   },
  { lowerLimit: 12935.83, upperLimit: 15487.71,  fixedFee: 1182.88, rate: 0.1792 },
  { lowerLimit: 15487.72, upperLimit: 31236.49,  fixedFee: 1640.18, rate: 0.2136 },
  { lowerLimit: 31236.50, upperLimit: 49233.00,  fixedFee: 5004.12, rate: 0.2352 },
  { lowerLimit: 49233.01, upperLimit: 93993.90,  fixedFee: 9236.89, rate: 0.30   },
  { lowerLimit: 93993.91, upperLimit: 125325.20, fixedFee: 22665.17, rate: 0.32  },
  { lowerLimit: 125325.21, upperLimit: 375975.61, fixedFee: 32691.18, rate: 0.34 },
  { lowerLimit: 375975.62, upperLimit: Infinity,  fixedFee: 117912.32, rate: 0.35 },
];

// Monthly employment subsidy table (Subsidio al empleo)
export const SUBSIDY_MONTHLY_2025 = [
  { lowerLimit: 0.01,    upperLimit: 1768.96, subsidy: 407.02 },
  { lowerLimit: 1768.97, upperLimit: 2653.38, subsidy: 406.83 },
  { lowerLimit: 2653.39, upperLimit: 3472.84, subsidy: 406.62 },
  { lowerLimit: 3472.85, upperLimit: 3537.87, subsidy: 392.77 },
  { lowerLimit: 3537.88, upperLimit: 4446.15, subsidy: 382.46 },
  { lowerLimit: 4446.16, upperLimit: 4717.18, subsidy: 354.23 },
  { lowerLimit: 4717.19, upperLimit: 5335.42, subsidy: 324.87 },
  { lowerLimit: 5335.43, upperLimit: 6224.67, subsidy: 294.63 },
  { lowerLimit: 6224.68, upperLimit: 7113.90, subsidy: 253.54 },
  { lowerLimit: 7113.91, upperLimit: 7382.33, subsidy: 217.61 },
  { lowerLimit: 7382.34, upperLimit: Infinity, subsidy: 0 },
];

export function calcMonthlyIsr(taxableIncome: number, table: IsrBracket[] = ISR_MONTHLY_2025): number {
  if (taxableIncome <= 0) return 0;
  const bracket = table.find(b => taxableIncome >= b.lowerLimit && taxableIncome <= b.upperLimit);
  if (!bracket) return 0;
  return bracket.fixedFee + (taxableIncome - bracket.lowerLimit) * bracket.rate;
}

export function calcEmploymentSubsidy(taxableIncome: number): number {
  const row = SUBSIDY_MONTHLY_2025.find(
    r => taxableIncome >= r.lowerLimit && taxableIncome <= r.upperLimit
  );
  return row?.subsidy ?? 0;
}

export function calcNetMonthlyIsr(grossMonthly: number): number {
  const isr = calcMonthlyIsr(grossMonthly);
  const subsidy = calcEmploymentSubsidy(grossMonthly);
  return Math.max(0, isr - subsidy);
}

/** Aguinaldo: first 30 * UMA daily value is exempt */
export function calcAguinaldoTax(amount: number, umaDiario: number): number {
  const exempt = 30 * umaDiario;
  const taxable = Math.max(0, amount - exempt);
  return calcMonthlyIsr(taxable);
}

/** PTU: first 15 * UMA daily value is exempt */
export function calcPtuTax(amount: number, umaDiario: number): number {
  const exempt = 15 * umaDiario;
  const taxable = Math.max(0, amount - exempt);
  return calcMonthlyIsr(taxable);
}

export const DEFAULT_UMA_DIARIO = 113.14; // 2025 value
```

- [ ] **Step 2: Add TaxConfig to FinanceSim interfaces**

In `FinanceSim.tsx`, add to `SimConfig`:

```typescript
interface SimConfig {
  horizonYears: number; inflationRate: number; startDate: string;
  umaAnnual?: number; art185AnnualCap?: number;
  taxEnabled?: boolean;
  umaDiario?: number; // defaults to 113.14
}
```

Add a `taxCategory` field to `Income`:

```typescript
interface Income {
  id: number; name: string; amount: number;
  periodicity: IncomePeriodicity; frequencyMonths: number;
  growthRate: number; bonusMonth: number; bonusAmount: number;
  startMonth: number; endMonth: number;
  ownerId?: number;
  taxCategory?: "salary" | "aguinaldo" | "ptu" | "bonus" | "exempt";
}
```

Add to `MonthRow`:

```typescript
totalTaxPaid?: number;
```

- [ ] **Step 3: Apply ISR in simulate() income step**

After computing `incAmt` for each income source (line ~490), apply tax:

```typescript
// After: incomeBySource[inc.id] = incAmt; totalIncome += incAmt;
// Replace with:
let netAmt = incAmt;
if (state.config.taxEnabled && incAmt > 0) {
  const uma = state.config.umaDiario ?? DEFAULT_UMA_DIARIO;
  const cat = inc.taxCategory ?? "salary";
  let tax = 0;
  if (cat === "salary") tax = calcNetMonthlyIsr(incAmt);
  else if (cat === "aguinaldo") tax = calcAguinaldoTax(incAmt, uma);
  else if (cat === "ptu") tax = calcPtuTax(incAmt, uma);
  else if (cat === "bonus") tax = calcMonthlyIsr(incAmt);
  // "exempt" = no tax
  netAmt = incAmt - tax;
  totalTaxPaid += tax;
}
incomeBySource[inc.id] = netAmt;
totalIncome += netAmt;
```

Initialize `let totalTaxPaid = 0;` at the top of the loop. Add to `months.push()`.

- [ ] **Step 4: Add tax toggle and UMA config to the settings UI**

In the config section of the dashboard (where horizonYears and inflationRate are), add:

```tsx
<div class="mb-3 flex items-center gap-2">
  <input type="checkbox" checked={state.config.taxEnabled ?? false}
    onChange={(e) => setState(s => ({ ...s, config: { ...s.config, taxEnabled: (e.target as HTMLInputElement).checked } }))} />
  <span class="font-mono text-xs">Apply Mexican ISR</span>
</div>
{state.config.taxEnabled && (
  <div class="mb-3">
    {label("UMA Diario")}
    {numInput(state.config.umaDiario ?? 113.14, (v) => setState(s => ({ ...s, config: { ...s.config, umaDiario: v } })), { prefix: "$", min: 50, max: 300, step: 0.01 })}
  </div>
)}
```

- [ ] **Step 5: Add taxCategory dropdown to income form**

In the income form, add a select after periodicity:

```tsx
{state.config.taxEnabled && (
  <div class="mb-3">
    {label("Tax Category")}
    {selectInput(incTaxCategory, (v) => setIncTaxCategory(v as any), [
      { value: "salary", label: "Salary (ISR table)" },
      { value: "aguinaldo", label: "Aguinaldo (30 UMA exempt)" },
      { value: "ptu", label: "PTU (15 UMA exempt)" },
      { value: "bonus", label: "Bonus (no exemption)" },
      { value: "exempt", label: "Exempt (no tax)" },
    ])}
  </div>
)}
```

Add state: `const [incTaxCategory, setIncTaxCategory] = useState<string>("salary");`

Wire into `saveIncome` and `startEditIncome` callbacks.

- [ ] **Step 6: Add tax column to yearly table and CSV**

Yearly table: add "Tax Paid" header and `ys.totalTaxPaid` cell.
CSV: add "Tax Paid" column.
YearSummary: add `totalTaxPaid: yearMonths.reduce((s, r) => s + (r.totalTaxPaid ?? 0), 0)`.

- [ ] **Step 7: Build and verify**

Run: `npm run build`
Expected: Clean build. Load the sim, enable ISR, verify salary income decreases by ~20-30%.

- [ ] **Step 8: Commit**

```bash
git add src/components/lab/shared/mexican-tax.ts src/components/lab/finance-sim/FinanceSim.tsx
git commit -m "feat(finance-sim): add Mexican ISR tax modeling with bracket tables, exemptions"
```

---

## Task 2: Negative Balance Warnings + Peak Stress Metric

**Priority:** High — user's scenario hits -$460K at month 3. Combined because they share data and dashboard space.

**Files:**
- Modify: `src/components/lab/finance-sim/FinanceSim.tsx` (SimulationResult ~line 122, simulate ~line 885, dashboard ~line 3098)

### Steps

- [ ] **Step 1: Extend SimulationResult with stress metrics**

```typescript
interface SimulationResult {
  months: MonthRow[]; yearSummaries: YearSummary[];
  finalNetWorth: number; finalAssets: number; finalDebt: number;
  totalInterestEarned: number; totalInterestPaid: number;
  avgMonthlyCashflow: number; debtFreeMonth: number;
  alerts: string[];
  // New:
  peakStressMonth: number;       // month with lowest total account balance
  peakStressBalance: number;     // that balance value
  overdraftMonths: number;       // count of months with any negative account
  peakDti: number;               // highest debt-to-income ratio (%)
  peakDtiMonth: number;          // month it occurs
}
```

- [ ] **Step 2: Compute stress metrics in simulate()**

After the main loop, before `return`:

```typescript
let peakStressMonth = 0;
let peakStressBalance = Infinity;
let overdraftMonths = 0;
let peakDti = 0;
let peakDtiMonth = 0;

for (const row of months) {
  const accountBal = state.accounts.reduce((s, a) => s + (row.accountBalances[a.id] ?? 0), 0);
  if (accountBal < peakStressBalance) {
    peakStressBalance = accountBal;
    peakStressMonth = row.month;
  }
  if (state.accounts.some(a => (row.accountBalances[a.id] ?? 0) < -0.01)) {
    overdraftMonths++;
  }
  if (row.totalIncome > 0) {
    const dti = (row.totalLoanPayments / row.totalIncome) * 100;
    if (dti > peakDti) { peakDti = dti; peakDtiMonth = row.month; }
  }
}
```

Add these to the return object.

- [ ] **Step 3: Add dashboard StatCards for stress**

After the existing 6 KPI cards, add a conditional stress section:

```tsx
{(sim.peakStressBalance < 0 || sim.peakDti > 40) && (
  <div class="col-span-full mt-2">
    <div class="rounded-xl border border-[rgba(224,92,106,0.3)] bg-[rgba(224,92,106,0.05)] p-4">
      <div class="mb-2 font-mono text-xs font-medium uppercase tracking-wider" style={{ color: C.red }}>
        Stress Indicators
      </div>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {sim.peakStressBalance < 0 && (
          <StatCard
            label="Peak Negative"
            value={fmtShort(sim.peakStressBalance)}
            sub={state.config.startDate ? monthToShortDate(sim.peakStressMonth, state.config.startDate) : `Month ${sim.peakStressMonth}`}
            color={C.red}
          />
        )}
        {sim.overdraftMonths > 0 && (
          <StatCard
            label="Overdraft Months"
            value={String(sim.overdraftMonths)}
            sub={`of ${state.config.horizonYears * 12}`}
            color={C.red}
          />
        )}
        {sim.peakDti > 40 && (
          <StatCard
            label="Peak DTI"
            value={`${sim.peakDti.toFixed(0)}%`}
            sub={state.config.startDate ? monthToShortDate(sim.peakDtiMonth, state.config.startDate) : `Month ${sim.peakDtiMonth}`}
            color={sim.peakDti > 50 ? C.red : C.orange}
          />
        )}
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Add peak stress to milestone markers**

In `detectMilestones()`, add:

```typescript
// Peak stress month
if (sim.months.length > 0) {
  let worstBal = Infinity, worstMonth = 0;
  for (const r of sim.months) {
    const bal = Object.values(r.accountBalances).reduce((s, v) => s + v, 0);
    if (bal < worstBal) { worstBal = bal; worstMonth = r.month; }
  }
  if (worstBal < 0) {
    ms.push({ month: worstMonth, label: "Peak stress", color: C.red });
  }
}
```

- [ ] **Step 5: Build and verify**

Run: `npm run build`
Expected: Clean build. Load user's scenario — peak stress card shows month 3, -$460K.

- [ ] **Step 6: Commit**

```bash
git add src/components/lab/finance-sim/FinanceSim.tsx
git commit -m "feat(finance-sim): add peak stress metrics, overdraft warnings, DTI tracking"
```

---

## Task 3: Calendar Month Input for Annual Events

**Priority:** High — prevents data breakage when changing startDate.

**Files:**
- Modify: `src/components/lab/finance-sim/FinanceSim.tsx` (Income/Expense interfaces, simulate income/expense steps, form UI)

### Steps

- [ ] **Step 1: Add calendarMonth to interfaces**

```typescript
interface Income {
  // ... existing fields ...
  calendarMonth?: number; // 1-12; if set, annually fires on this calendar month
}

interface Expense {
  // ... existing fields ...
  calendarMonth?: number; // 1-12; if set, annually fires on this calendar month
}
```

- [ ] **Step 2: Update simulate() annually logic for income**

Replace the annual income check (line ~464):

```typescript
if (inc.periodicity === "annually") {
  let fires = false;
  if (inc.calendarMonth && state.config.startDate) {
    // Calendar-month mode: fire when sim's actual calendar month matches
    const d = new Date(state.config.startDate + "T00:00:00");
    d.setMonth(d.getMonth() + m - 1);
    fires = (d.getMonth() + 1) === inc.calendarMonth && m >= inc.startMonth;
  } else {
    // Legacy: fire based on monthInYear offset from startMonth
    fires = monthInYear === (inc.startMonth > 0 ? ((inc.startMonth - 1) % 12) + 1 : 1);
  }
  if (fires) {
    incAmt = inc.amount * growthFactor;
  }
  incomeBySource[inc.id] = incAmt;
  totalIncome += incAmt;
  continue;
}
```

- [ ] **Step 3: Update simulate() annually logic for expenses**

Same pattern for expenses (line ~513):

```typescript
else if (exp.frequency === "annually") {
  if (exp.calendarMonth && state.config.startDate) {
    const d = new Date(state.config.startDate + "T00:00:00");
    d.setMonth(d.getMonth() + m - 1);
    applies = (d.getMonth() + 1) === exp.calendarMonth && m >= exp.startMonth;
  } else {
    applies = (m - exp.startMonth) % 12 === 0;
  }
}
```

- [ ] **Step 4: Add calendar month dropdown to income form**

When periodicity is "annually" and startDate exists, show a month name dropdown:

```tsx
{incPeriodicity === "annually" && state.config.startDate && (
  <div class="mb-3">
    {label("Calendar Month")}
    {selectInput(String(incCalendarMonth), (v) => setIncCalendarMonth(Number(v)),
      [{ value: "0", label: "Auto (from start month)" },
       ...Array.from({ length: 12 }, (_, i) => ({
         value: String(i + 1),
         label: MONTH_NAMES[i + 1],
       }))]
    )}
  </div>
)}
```

Add state: `const [incCalendarMonth, setIncCalendarMonth] = useState(0);`

Wire into `saveIncome`, `startEditIncome`, `cancelEditIncome`.

- [ ] **Step 5: Same for expense form**

Add `const [expCalendarMonth, setExpCalendarMonth] = useState(0);` and the dropdown in the expense form when frequency is "annually".

Wire into `saveExpense`, `startEditExpense`, `cancelEditExpense`.

- [ ] **Step 6: Auto-migration on import**

In `importJSON()`, after `if (!data.assets) data.assets = [];`, add:

```typescript
// Auto-populate calendarMonth for annual incomes/expenses if startDate is set
if (data.config.startDate) {
  for (const inc of data.incomes) {
    if (inc.periodicity === "annually" && !inc.calendarMonth) {
      const d = new Date(data.config.startDate + "T00:00:00");
      d.setMonth(d.getMonth() + inc.startMonth - 1);
      inc.calendarMonth = d.getMonth() + 1;
    }
  }
  for (const exp of data.expenses) {
    if (exp.frequency === "annually" && !exp.calendarMonth) {
      const d = new Date(data.config.startDate + "T00:00:00");
      d.setMonth(d.getMonth() + exp.startMonth - 1);
      exp.calendarMonth = d.getMonth() + 1;
    }
  }
}
```

- [ ] **Step 7: Build and verify**

Run: `npm run build`
Expected: Clean build. Import user's JSON — aguinaldos should auto-detect December. Changing startDate should not shift annual event timing.

- [ ] **Step 8: Commit**

```bash
git add src/components/lab/finance-sim/FinanceSim.tsx
git commit -m "feat(finance-sim): calendar month input for annual events, auto-migration on import"
```

---

## Task 4: Real vs Nominal Value Toggle

**Priority:** Medium — small effort, big insight for mortgages.

**Files:**
- Modify: `src/components/lab/finance-sim/FinanceSim.tsx` (chart rendering ~line 2036, yearly table ~line 3380)

### Steps

- [ ] **Step 1: Add state for real/nominal toggle**

```typescript
const [showReal, setShowReal] = useState(false);
```

- [ ] **Step 2: Create deflation wrapper**

After `sampleData` definition in the main chart useEffect (line ~2036):

```typescript
const deflate = (amount: number, monthIdx: number) => {
  if (!showReal) return amount;
  const monthsElapsed = sim.months[monthIdx]?.month ?? 0;
  return amount / Math.pow(1 + state.config.inflationRate / 100, monthsElapsed / 12);
};

const sampleDataReal = (accessor: (r: MonthRow) => number) =>
  dataIndices.map(i => deflate(accessor(sim.months[i]), i));
```

- [ ] **Step 3: Replace sampleData with sampleDataReal in chart datasets**

In the main chart useEffect, replace all `sampleData(` calls with `sampleDataReal(` for the networth, cashflow, and balances chart modes. The debt mode should also use it. Keep the raw `sampleData` for tooltips (show both nominal and real).

- [ ] **Step 4: Add toggle pill button**

After the Milestones toggle in the dashboard chart controls:

```tsx
{pillBtn(showReal, () => setShowReal(!showReal), showReal ? "Real $" : "Nominal $")}
```

- [ ] **Step 5: Update yAxisTitle when in real mode**

```typescript
if (showReal) yAxisTitle += " (real)";
```

- [ ] **Step 6: Apply to yearly table**

Wrap yearly table values with deflation when `showReal` is true:

```typescript
const deflateYear = (amount: number, year: number) =>
  showReal ? amount / Math.pow(1 + state.config.inflationRate / 100, year) : amount;
```

Apply to: `ys.totalIncome`, `ys.totalExpenses`, `ys.totalLoanPayments`, `ys.endAssets`, `ys.endDebt`, `ys.endNetWorth`.

- [ ] **Step 7: Add showReal to chart useEffect dependencies**

- [ ] **Step 8: Build and verify**

Run: `npm run build`
Expected: Toggle shows inflation-eroded values. Mortgage payment line should visibly decline in real terms.

- [ ] **Step 9: Commit**

```bash
git add src/components/lab/finance-sim/FinanceSim.tsx
git commit -m "feat(finance-sim): real vs nominal toggle for inflation-adjusted chart views"
```

---

## Task 5: Loan Payoff Projection Beyond Horizon

**Priority:** Medium — user's mortgage won't pay off in 3 years; they need to see when it ends.

**Files:**
- Create: `src/components/lab/shared/payoff-projection.ts`
- Modify: `src/components/lab/finance-sim/FinanceSim.tsx` (SimulationResult, post-simulation, loan cards, dashboard)

### Steps

- [ ] **Step 1: Create payoff projection module**

Create `src/components/lab/shared/payoff-projection.ts`:

```typescript
import { calcLoanPayment, getAmortizationForMonth, type LoanAmortization } from "./amortization";

export interface PayoffProjection {
  loanId: number;
  payoffMonth: number;        // absolute month from sim start (0 = already paid)
  totalInterestPaid: number;
  totalPaid: number;
}

export function projectPayoff(
  loanId: number,
  balance: number,
  annualRate: number,
  termMonths: number,
  startMonth: number,
  paymentInterval: "monthly" | "biweekly",
  amortizations: LoanAmortization[],
  currentMonth: number,         // where sim ended
  maxProjectionMonths: number,  // safety cap (e.g. 600 months = 50 years)
): PayoffProjection {
  if (balance <= 0.01) return { loanId, payoffMonth: 0, totalInterestPaid: 0, totalPaid: 0 };

  const r = annualRate / 100 / 12;
  let bal = balance;
  let fixedPmt = calcLoanPayment(bal, r, Math.max(1, termMonths - (currentMonth - startMonth)));
  let totalInterest = 0;
  let totalPaid = 0;

  for (let m = currentMonth + 1; m <= currentMonth + maxProjectionMonths; m++) {
    if (bal <= 0.01) return { loanId, payoffMonth: m - 1, totalInterestPaid: totalInterest, totalPaid };

    const monthsElapsed = m - startMonth;
    const remaining = Math.max(0, termMonths - monthsElapsed);

    // Balloon at term end
    if (remaining <= 0 && bal > 0.01) {
      const interest = bal * r;
      totalInterest += interest;
      totalPaid += bal + interest;
      return { loanId, payoffMonth: m, totalInterestPaid: totalInterest, totalPaid };
    }

    let payment = fixedPmt;
    if (paymentInterval === "biweekly") payment = payment * 13 / 12;
    payment = Math.min(payment, bal + bal * r);

    const interest = bal * r;
    const principal = Math.min(payment - interest, bal);
    totalInterest += interest;
    totalPaid += interest + Math.max(0, principal);
    bal = Math.max(0, bal - Math.max(0, principal));

    // Extra amortizations
    const amort = getAmortizationForMonth(amortizations, m, currentMonth + maxProjectionMonths);
    if (amort && bal > 0.01) {
      const amortReal = Math.min(amort.amount, bal);
      bal -= amortReal;
      totalPaid += amortReal;
      if (amort.effect === "reduce-payment" && bal > 0.01) {
        fixedPmt = calcLoanPayment(bal, r, Math.max(1, termMonths - monthsElapsed));
      }
    }
  }

  // Didn't pay off within max projection
  return { loanId, payoffMonth: -1, totalInterestPaid: totalInterest, totalPaid };
}
```

- [ ] **Step 2: Compute projections after simulate()**

In `SimulationResult`, add:

```typescript
loanPayoffProjections: PayoffProjection[];
```

After the main simulation loop, before return:

```typescript
const loanPayoffProjections: PayoffProjection[] = [];
for (const loan of state.loans) {
  const endBal = loanBals[loan.id];
  if (endBal > 0.01) {
    loanPayoffProjections.push(projectPayoff(
      loan.id, endBal, loan.annualRate, loan.termMonths,
      loan.startMonth, loan.paymentInterval, loan.amortizations,
      totalMonths, 600
    ));
  } else {
    loanPayoffProjections.push({ loanId: loan.id, payoffMonth: 0, totalInterestPaid: 0, totalPaid: 0 });
  }
}
```

Add to return object.

- [ ] **Step 3: Display on loan cards**

In the loan list rendering, after the payment display, add:

```tsx
{(() => {
  const proj = sim.loanPayoffProjections.find(p => p.loanId === l.id);
  if (!proj || proj.payoffMonth <= 0) return null;
  const label = state.config.startDate
    ? monthToDate(proj.payoffMonth, state.config.startDate)
    : `Month ${proj.payoffMonth}`;
  return (
    <div class="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
      Payoff: {label} ({Math.ceil(proj.payoffMonth / 12)} yrs) · Total interest: {fmtShort(proj.totalInterestPaid)}
    </div>
  );
})()}
```

- [ ] **Step 4: Update debt-free dashboard card**

If `sim.debtFreeMonth === 0` (beyond horizon) but all loans have projections, show the latest payoff:

```typescript
const latestPayoff = sim.loanPayoffProjections.reduce(
  (max, p) => p.payoffMonth > max ? p.payoffMonth : max, 0
);
```

Use this in the "Debt-Free" StatCard sub text: `"projected ~${Math.ceil(latestPayoff / 12)} yrs"`.

- [ ] **Step 5: Build and verify**

Run: `npm run build`
Expected: Loan cards show projected payoff dates beyond the 3-year horizon. Mortgage with $50K/month extra amortization should show ~6-7 year payoff.

- [ ] **Step 6: Commit**

```bash
git add src/components/lab/shared/payoff-projection.ts src/components/lab/finance-sim/FinanceSim.tsx
git commit -m "feat(finance-sim): loan payoff projection beyond simulation horizon"
```

---

## Task 6: Loan Refinancing

**Priority:** Medium — common for Mexican mortgages after 2-3 years.

**Files:**
- Modify: `src/components/lab/finance-sim/FinanceSim.tsx` (Loan interface, simulate loan step, loan form UI)

### Steps

- [ ] **Step 1: Extend Loan interface**

```typescript
interface LoanRefinance {
  month: number;
  newRate: number;       // annual %
  newTermMonths: number;
  cost: number;          // one-time refinancing fee
}

interface Loan {
  // ... existing fields ...
  refinance?: LoanRefinance;
}
```

- [ ] **Step 2: Apply refinancing in simulate()**

In the loan payment loop (step 3b), after checking `loan.startMonth > m`, before computing the payment:

```typescript
// Check for refinancing
if (loan.refinance && loan.refinance.month === m) {
  const refi = loan.refinance;
  const newR = refi.newRate / 100 / 12;
  loanFixedPmt[loan.id] = calcLoanPayment(loanBals[loan.id], newR, refi.newTermMonths);
  // Refinancing cost added as expense
  totalExpenses += refi.cost;
}
// Use the possibly-refinanced rate
const currentRate = (loan.refinance && m >= loan.refinance.month)
  ? loan.refinance.newRate / 100 / 12
  : loan.annualRate / 100 / 12;
```

Replace all uses of `r` (the monthly rate) in the loan loop with `currentRate`.

- [ ] **Step 3: Add refinance form to loan cards**

On each loan card, add a "Refinance" button that expands a mini-form:

```tsx
<div class="mt-2 space-y-2 border-t border-[var(--color-border)] pt-2">
  <div class="font-mono text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
    Refinancing
  </div>
  <div class="grid grid-cols-2 gap-2">
    {numInput(refiMonth, setRefiMonth, { suffix: "mo", min: 1, max: 600, step: 1 })}
    {numInput(refiRate, setRefiRate, { suffix: "%", min: 0, max: 100, step: 0.25 })}
    {numInput(refiTerm, setRefiTerm, { suffix: "mo", min: 1, max: 600, step: 1 })}
    {numInput(refiCost, setRefiCost, { prefix: "$", min: 0, step: 1000 })}
  </div>
  {goldButton(() => applyRefinance(l.id), "Set Refinance")}
</div>
```

- [ ] **Step 4: Add applyRefinance callback**

```typescript
const applyRefinance = useCallback((loanId: number) => {
  setState(s => ({
    ...s,
    loans: s.loans.map(l => l.id === loanId
      ? { ...l, refinance: { month: refiMonth, newRate: refiRate, newTermMonths: refiTerm, cost: refiCost } }
      : l),
  }));
}, [refiMonth, refiRate, refiTerm, refiCost]);
```

Add state variables: `refiMonth`, `refiRate`, `refiTerm`, `refiCost` with sensible defaults.

- [ ] **Step 5: Add refinance to milestones**

In `detectMilestones()`:

```typescript
for (const loan of state.loans) {
  if (loan.refinance && loan.refinance.month > 1) {
    ms.push({ month: loan.refinance.month, label: `Refi: ${loan.name}`, color: C.purple });
  }
}
```

- [ ] **Step 6: Build and verify**

Run: `npm run build`
Expected: Can set refinance on mortgage. At refi month, payment recalculates with new rate/term.

- [ ] **Step 7: Commit**

```bash
git add src/components/lab/finance-sim/FinanceSim.tsx
git commit -m "feat(finance-sim): loan refinancing with new rate, term, and one-time cost"
```

---

## Task 7: Sensitivity / What-If Quick Toggles

**Priority:** Medium-low — nice for scenario exploration.

**Files:**
- Modify: `src/components/lab/finance-sim/FinanceSim.tsx` (state, simulate call, dashboard UI)

### Steps

- [ ] **Step 1: Add sensitivity override state**

```typescript
const [sensitivity, setSensitivity] = useState<{
  rateOffset: number;    // percentage points added to all loan rates
  growthOffset: number;  // percentage points added to all income growth
  inflOffset: number;    // percentage points added to inflation
  extraAmort: number;    // extra amount added to all amortizations
}>({ rateOffset: 0, growthOffset: 0, inflOffset: 0, extraAmort: 0 });
```

- [ ] **Step 2: Create merged state for simulation**

```typescript
const sensitiveState = useMemo((): FinanceState => {
  if (!sensitivity.rateOffset && !sensitivity.growthOffset && !sensitivity.inflOffset && !sensitivity.extraAmort) return state;
  return {
    ...state,
    loans: state.loans.map(l => ({
      ...l,
      annualRate: l.annualRate + sensitivity.rateOffset,
    })),
    incomes: state.incomes.map(i => ({
      ...i,
      growthRate: i.growthRate + sensitivity.growthOffset,
    })),
    config: {
      ...state.config,
      inflationRate: state.config.inflationRate + sensitivity.inflOffset,
    },
  };
}, [state, sensitivity]);

const sim = useMemo(() => simulate(sensitiveState), [sensitiveState]);
```

**Important:** Remove the existing `sim` memo and replace with this version.

- [ ] **Step 3: Add slider panel to dashboard**

Below the chart controls, add a collapsible sensitivity panel:

```tsx
<details class="mb-3">
  <summary class="cursor-pointer font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
    What-If Sensitivity
  </summary>
  <div class="mt-2 grid grid-cols-2 gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 sm:grid-cols-4">
    <div>
      <div class="mb-1 font-mono text-[10px] text-[var(--color-text-muted)]">Loan Rate</div>
      <input type="range" min={-3} max={3} step={0.25} value={sensitivity.rateOffset}
        onInput={(e) => setSensitivity(s => ({ ...s, rateOffset: Number((e.target as HTMLInputElement).value) }))}
        class="w-full" />
      <div class="text-center font-mono text-xs" style={{ color: sensitivity.rateOffset ? C.orange : C.muted }}>
        {sensitivity.rateOffset >= 0 ? "+" : ""}{sensitivity.rateOffset}%
      </div>
    </div>
    <div>
      <div class="mb-1 font-mono text-[10px] text-[var(--color-text-muted)]">Income Growth</div>
      <input type="range" min={-5} max={5} step={0.5} value={sensitivity.growthOffset}
        onInput={(e) => setSensitivity(s => ({ ...s, growthOffset: Number((e.target as HTMLInputElement).value) }))}
        class="w-full" />
      <div class="text-center font-mono text-xs" style={{ color: sensitivity.growthOffset ? C.green : C.muted }}>
        {sensitivity.growthOffset >= 0 ? "+" : ""}{sensitivity.growthOffset}%
      </div>
    </div>
    <div>
      <div class="mb-1 font-mono text-[10px] text-[var(--color-text-muted)]">Inflation</div>
      <input type="range" min={-3} max={5} step={0.5} value={sensitivity.inflOffset}
        onInput={(e) => setSensitivity(s => ({ ...s, inflOffset: Number((e.target as HTMLInputElement).value) }))}
        class="w-full" />
      <div class="text-center font-mono text-xs" style={{ color: sensitivity.inflOffset ? C.red : C.muted }}>
        {sensitivity.inflOffset >= 0 ? "+" : ""}{sensitivity.inflOffset}%
      </div>
    </div>
    <div class="flex flex-col items-center justify-end">
      <button
        onClick={() => setSensitivity({ rateOffset: 0, growthOffset: 0, inflOffset: 0, extraAmort: 0 })}
        class="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        Reset
      </button>
    </div>
  </div>
</details>
```

- [ ] **Step 4: Add "Save as Scenario" button**

When any slider is non-zero, show a button:

```tsx
{(sensitivity.rateOffset || sensitivity.growthOffset || sensitivity.inflOffset) && (
  <button onClick={() => {
    const name = `What-if: rate ${sensitivity.rateOffset >= 0 ? "+" : ""}${sensitivity.rateOffset}%, growth ${sensitivity.growthOffset >= 0 ? "+" : ""}${sensitivity.growthOffset}%`;
    setComparisonScenarios(prev => [...prev, { name, state: sensitiveState, sim }]);
    setSensitivity({ rateOffset: 0, growthOffset: 0, inflOffset: 0, extraAmort: 0 });
  }}
  class="ml-2 rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
    Save as Scenario
  </button>
)}
```

- [ ] **Step 5: Build and verify**

Run: `npm run build`
Expected: Sliders live-update charts. "Save as Scenario" adds comparison overlay.

- [ ] **Step 6: Commit**

```bash
git add src/components/lab/finance-sim/FinanceSim.tsx
git commit -m "feat(finance-sim): what-if sensitivity sliders with save-as-scenario"
```

---

## Task 8: Debt Snowball/Avalanche Visualization

**Priority:** Low — waterfall engine works; this adds a dedicated chart mode.

**Files:**
- Modify: `src/components/lab/finance-sim/FinanceSim.tsx` (MonthRow, simulate waterfall step, chart rendering)

### Steps

- [ ] **Step 1: Track waterfall allocations in MonthRow**

Add to `MonthRow`:

```typescript
waterfallDebtPaidByLoan?: Record<number, number>;
```

- [ ] **Step 2: Record waterfall debt payments in simulate()**

In the waterfall `pay-debt` branch, track which loan received the payment:

```typescript
// Inside the pay-debt branch:
const extra = Math.min(surplus, loanBals[tgt.id]);
loanBals[tgt.id] -= extra;
surplus -= extra;
if (!waterfallDebtByLoan) waterfallDebtByLoan = {};
waterfallDebtByLoan[tgt.id] = (waterfallDebtByLoan[tgt.id] ?? 0) + extra;
```

Initialize `let waterfallDebtByLoan: Record<number, number> | undefined;` before the waterfall block.
Add `waterfallDebtPaidByLoan: waterfallDebtByLoan ? { ...waterfallDebtByLoan } : undefined` to `months.push()`.

- [ ] **Step 3: Add "Snowball" chart mode**

In `chartMode` type, add `"snowball"`:

```typescript
const [chartMode, setChartMode] = useState<"networth" | "cashflow" | "balances" | "debt" | "snowball" | "ppr">("networth");
```

Add pill button: `{state.waterfall?.length > 0 && pillBtn(chartMode === "snowball", () => setChartMode("snowball"), "Snowball")}`

- [ ] **Step 4: Build snowball chart datasets**

In the chart useEffect, add snowball mode:

```typescript
} else if (chartMode === "snowball") {
  // Stacked area: each loan's total payment (scheduled + waterfall)
  for (let li = 0; li < state.loans.length; li++) {
    const loan = state.loans[li];
    const color = C.palette[li % C.palette.length];
    datasets.push({
      label: loan.name,
      data: sampleDataReal(r => {
        const scheduled = r.loanPaymentBySource[loan.id] ?? 0;
        const waterfall = r.waterfallDebtPaidByLoan?.[loan.id] ?? 0;
        return scheduled + waterfall;
      }),
      borderColor: color,
      backgroundColor: color + "40",
      fill: true, tension: 0.3, borderWidth: 1.5, pointRadius: 0,
    });
  }
  yAxisTitle = "Payment Allocation ($)";
}
```

Set `options.scales.y.stacked = true` and `options.scales.x.stacked = true` when in snowball mode.

- [ ] **Step 5: Build and verify**

Run: `npm run build`
Expected: Snowball chart shows stacked payments per loan. When a loan is paid off, its area disappears and the next loan's area grows.

- [ ] **Step 6: Commit**

```bash
git add src/components/lab/finance-sim/FinanceSim.tsx
git commit -m "feat(finance-sim): snowball/avalanche visualization chart mode"
```

---

## Task 9: Cash Flow Sankey Diagram

**Priority:** Lowest — visual polish, requires external dependency.

**Files:**
- Modify: `package.json` (add d3-sankey)
- Create: `src/components/lab/finance-sim/SankeyChart.tsx`
- Modify: `src/components/lab/finance-sim/FinanceSim.tsx` (import and render)

### Steps

- [ ] **Step 1: Install d3-sankey**

```bash
npm install d3-sankey d3-shape
npm install -D @types/d3-sankey @types/d3-shape
```

- [ ] **Step 2: Create SankeyChart component**

Create `src/components/lab/finance-sim/SankeyChart.tsx`:

```tsx
import { useMemo, useRef, useEffect } from "preact/hooks";
import { sankey, sankeyLinkHorizontal } from "d3-sankey";

interface SankeyNode { name: string; color: string; }
interface SankeyLink { source: number; target: number; value: number; }

interface Props {
  incomes: { name: string; amount: number }[];
  expenses: { name: string; amount: number }[];
  loanPayments: { name: string; amount: number }[];
  savings: number;
  width?: number;
  height?: number;
}

export default function SankeyChart({ incomes, expenses, loanPayments, savings, width = 600, height = 400 }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);

  const data = useMemo(() => {
    const nodes: SankeyNode[] = [];
    const links: SankeyLink[] = [];

    // Income sources (left)
    incomes.forEach(inc => nodes.push({ name: inc.name, color: "#3fb68a" }));

    // Central "Total Income" node
    const totalIdx = nodes.length;
    nodes.push({ name: "Total Income", color: "#e4e4e7" });

    // Link incomes → total
    incomes.forEach((inc, i) => {
      if (inc.amount > 0) links.push({ source: i, target: totalIdx, value: inc.amount });
    });

    // Outflow categories (right)
    const categories = [
      ...expenses.map(e => ({ name: e.name, amount: e.amount, color: "#e05c6a" })),
      ...loanPayments.map(l => ({ name: l.name, amount: l.amount, color: "#4a9eff" })),
      ...(savings > 0 ? [{ name: "Savings", amount: savings, color: "#d4a843" }] : []),
    ];

    categories.forEach(cat => {
      const catIdx = nodes.length;
      nodes.push({ name: cat.name, color: cat.color });
      if (cat.amount > 0) links.push({ source: totalIdx, target: catIdx, value: cat.amount });
    });

    return { nodes, links };
  }, [incomes, expenses, loanPayments, savings]);

  useEffect(() => {
    if (!svgRef.current || data.nodes.length === 0) return;

    const sankeyGen = sankey<SankeyNode, SankeyLink>()
      .nodeWidth(15)
      .nodePadding(10)
      .extent([[1, 5], [width - 1, height - 5]]);

    const { nodes: sankeyNodes, links: sankeyLinks } = sankeyGen({
      nodes: data.nodes.map(d => ({ ...d })),
      links: data.links.map(d => ({ ...d })),
    });

    const svg = svgRef.current;
    svg.innerHTML = "";
    const ns = "http://www.w3.org/2000/svg";

    // Draw links
    const linkPath = sankeyLinkHorizontal();
    for (const link of sankeyLinks) {
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", linkPath(link as any) ?? "");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", (link.source as any).color + "44");
      path.setAttribute("stroke-width", String(Math.max(1, (link as any).width)));
      svg.appendChild(path);
    }

    // Draw nodes
    for (const node of sankeyNodes) {
      const rect = document.createElementNS(ns, "rect");
      rect.setAttribute("x", String(node.x0));
      rect.setAttribute("y", String(node.y0));
      rect.setAttribute("width", String((node.x1 ?? 0) - (node.x0 ?? 0)));
      rect.setAttribute("height", String(Math.max(1, (node.y1 ?? 0) - (node.y0 ?? 0))));
      rect.setAttribute("fill", (node as any).color);
      rect.setAttribute("rx", "2");
      svg.appendChild(rect);

      // Labels
      const text = document.createElementNS(ns, "text");
      text.setAttribute("x", String((node.x0 ?? 0) < width / 2 ? (node.x1 ?? 0) + 6 : (node.x0 ?? 0) - 6));
      text.setAttribute("y", String(((node.y0 ?? 0) + (node.y1 ?? 0)) / 2));
      text.setAttribute("dy", "0.35em");
      text.setAttribute("text-anchor", (node.x0 ?? 0) < width / 2 ? "start" : "end");
      text.setAttribute("fill", "var(--color-text-muted)");
      text.setAttribute("font-family", "monospace");
      text.setAttribute("font-size", "10");
      text.textContent = (node as any).name;
      svg.appendChild(text);
    }
  }, [data, width, height]);

  return <svg ref={svgRef} width={width} height={height} />;
}
```

- [ ] **Step 3: Add Sankey to dashboard**

In `FinanceSim.tsx`, import and add below the yearly table:

```tsx
import SankeyChart from "./SankeyChart";
```

Add a collapsible section:

```tsx
<details class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
  <summary class="cursor-pointer">
    <CardTitle>Cash Flow Diagram</CardTitle>
  </summary>
  <div class="mt-3">
    <SankeyChart
      incomes={state.incomes.map(i => ({
        name: i.name,
        amount: sim.yearSummaries[0]?.totalIncome ? (sim.months.filter(m => m.year === 1).reduce((s, m) => s + (m.incomeBySource[i.id] ?? 0), 0)) : 0,
      }))}
      expenses={state.expenses.map(e => ({
        name: e.name,
        amount: sim.months.filter(m => m.year === 1).reduce((s, m) => s + (m.expenseBySource[e.id] ?? 0), 0),
      }))}
      loanPayments={state.loans.map(l => ({
        name: l.name,
        amount: sim.months.filter(m => m.year === 1).reduce((s, m) => s + (m.loanPaymentBySource[l.id] ?? 0), 0),
      }))}
      savings={Math.max(0, sim.yearSummaries[0]?.netCashflow ?? 0)}
    />
  </div>
</details>
```

- [ ] **Step 4: Add year selector**

Add a dropdown above the Sankey to pick which year to display:

```tsx
const [sankeyYear, setSankeyYear] = useState(1);
```

Filter data by `sankeyYear` instead of hardcoded year 1.

- [ ] **Step 5: Build and verify**

Run: `npm run build`
Expected: Collapsible Sankey diagram shows income → expenses/loans/savings flow for selected year.

- [ ] **Step 6: Commit**

```bash
git add src/components/lab/finance-sim/SankeyChart.tsx src/components/lab/finance-sim/FinanceSim.tsx package.json package-lock.json
git commit -m "feat(finance-sim): cash flow Sankey diagram with year selection"
```

---

## Execution Order Summary

| Task | Feature | Priority | Est. Lines | Depends On |
|---|---|---|---|---|
| 1 | Mexican ISR Tax Modeling | Highest | ~200 | None |
| 2 | Negative Balance + Peak Stress | High | ~80 | None |
| 3 | Calendar Month Input | High | ~80 | None |
| 4 | Real vs Nominal Toggle | Medium | ~40 | None |
| 5 | Loan Payoff Projection | Medium | ~100 | None |
| 6 | Loan Refinancing | Medium | ~120 | None |
| 7 | Sensitivity Sliders | Medium-low | ~100 | None |
| 8 | Snowball/Avalanche Viz | Low | ~60 | Task 2 waterfall tracking |
| 9 | Cash Flow Sankey | Lowest | ~150 | npm install |

All tasks are independent (except Task 8 uses waterfall tracking). Can be parallelized via worktrees for tasks 1-7.
