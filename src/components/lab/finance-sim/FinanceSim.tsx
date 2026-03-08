import { useState, useEffect, useRef, useMemo, useCallback } from "preact/hooks";
import {
  Chart,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  Filler,
  Legend,
  Tooltip,
} from "chart.js";
import {
  calcLoanPayment,
  getAmortizationForMonth,
  type LoanAmortization,
} from "../shared/amortization";

Chart.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  LineController, Filler, Legend, Tooltip
);

// ─── Types ────────────────────────────────────────────────────────────

type AccountType = "checking" | "savings" | "investment" | "retirement";
type CompoundInterval = "daily" | "monthly" | "quarterly" | "annually";
type LoanType = "mortgage" | "auto" | "personal" | "credit-card";
type IncomePeriodicity = "weekly" | "biweekly" | "monthly" | "annually" | "one-time" | "every-n-months";
type ExpenseFrequency = "monthly" | "quarterly" | "annually" | "one-time" | "every-n-months";

interface Account {
  id: number; name: string; type: AccountType;
  balance: number; annualRate: number; compoundInterval: CompoundInterval;
}

interface Loan {
  id: number; name: string; type: LoanType;
  principal: number; currentBalance: number; annualRate: number;
  termMonths: number; paymentInterval: "monthly" | "biweekly"; startMonth: number;
  amortizations: LoanAmortization[];
}

interface Income {
  id: number; name: string; amount: number;
  periodicity: IncomePeriodicity; frequencyMonths: number;
  growthRate: number; bonusMonth: number; bonusAmount: number;
  startMonth: number; endMonth: number;
}

interface Expense {
  id: number; name: string; amount: number;
  frequency: ExpenseFrequency; frequencyMonths: number;
  category: string; inflationAdjusted: boolean;
  startMonth: number; endMonth: number;
}

interface SimConfig { horizonYears: number; inflationRate: number; startDate: string; }

interface FinanceState {
  accounts: Account[]; loans: Loan[]; incomes: Income[]; expenses: Expense[];
  config: SimConfig; nextId: number;
}

interface MonthRow {
  month: number; year: number;
  totalIncome: number; totalExpenses: number;
  totalLoanPayments: number; totalInterestPaid: number; totalPrincipalPaid: number;
  totalInterestEarned: number; netCashflow: number;
  accountBalances: Record<number, number>; loanBalances: Record<number, number>;
  totalAssets: number; totalDebt: number; netWorth: number;
}

interface YearSummary {
  year: number; totalIncome: number; totalExpenses: number;
  totalLoanPayments: number; interestEarned: number; interestPaid: number;
  netCashflow: number; endAssets: number; endDebt: number; endNetWorth: number;
}

interface SimulationResult {
  months: MonthRow[]; yearSummaries: YearSummary[];
  finalNetWorth: number; finalAssets: number; finalDebt: number;
  totalInterestEarned: number; totalInterestPaid: number;
  avgMonthlyCashflow: number; debtFreeMonth: number;
  alerts: string[];
}

// ─── Colors ───────────────────────────────────────────────────────────

const C = {
  gold: "#d4a843",
  goldLight: "#f0c96a",
  goldDim: "rgba(212,168,67,0.15)",
  goldBorder: "rgba(212,168,67,0.25)",
  blue: "#4a9eff",
  blueDim: "rgba(74,158,255,0.15)",
  blueBorder: "rgba(74,158,255,0.25)",
  green: "#3fb68a",
  greenDim: "rgba(63,182,138,0.15)",
  greenBorder: "rgba(63,182,138,0.25)",
  red: "#e05c6a",
  redDim: "rgba(224,92,106,0.15)",
  purple: "#a855f7",
  orange: "#f59e0b",
  cyan: "#06b6d4",
  muted: "#7d8590",
  gridDark: "rgba(48,54,61,0.5)",
  gridLight: "rgba(0,0,0,0.06)",
  palette: ["#4a9eff", "#3fb68a", "#a855f7", "#f59e0b", "#06b6d4", "#ec4899"],
};

// ─── Formatters ───────────────────────────────────────────────────────

const fmt = (n: number, dec = 0) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  }).format(n);

const fmtM = (n: number) => "$" + fmt(n);

const fmtShort = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e6) return sign + "$" + (abs / 1e6).toFixed(1) + "M";
  if (abs >= 1e3) return sign + "$" + (abs / 1e3).toFixed(0) + "K";
  return sign + "$" + abs.toFixed(0);
};

const fmtPct = (n: number) => n.toFixed(2) + "%";

// ─── Category colors ──────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, { color: string; bg: string; border: string }> = {
  housing:        { color: C.blue,    bg: C.blueDim,    border: C.blueBorder },
  transport:      { color: C.orange,  bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.25)" },
  food:           { color: C.green,   bg: C.greenDim,   border: C.greenBorder },
  utilities:      { color: C.cyan,    bg: "rgba(6,182,212,0.15)",  border: "rgba(6,182,212,0.25)" },
  insurance:      { color: C.purple,  bg: "rgba(168,85,247,0.15)", border: "rgba(168,85,247,0.25)" },
  entertainment:  { color: "#ec4899", bg: "rgba(236,72,153,0.15)", border: "rgba(236,72,153,0.25)" },
  education:      { color: C.blue,    bg: C.blueDim,    border: C.blueBorder },
  health:         { color: C.red,     bg: C.redDim,     border: "rgba(224,92,106,0.25)" },
  subscriptions:  { color: C.gold,    bg: C.goldDim,    border: C.goldBorder },
  other:          { color: C.muted,   bg: "rgba(125,133,144,0.15)", border: "rgba(125,133,144,0.25)" },
};

const ACCOUNT_TYPE_COLORS: Record<AccountType, { color: string; bg: string; border: string }> = {
  checking:   { color: C.blue,    bg: C.blueDim,    border: C.blueBorder },
  savings:    { color: C.green,   bg: C.greenDim,   border: C.greenBorder },
  investment: { color: C.purple,  bg: "rgba(168,85,247,0.15)", border: "rgba(168,85,247,0.25)" },
  retirement: { color: C.orange,  bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.25)" },
};

const LOAN_TYPE_COLORS: Record<LoanType, { color: string; bg: string; border: string }> = {
  mortgage:      { color: C.blue,    bg: C.blueDim,    border: C.blueBorder },
  auto:          { color: C.orange,  bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.25)" },
  personal:      { color: C.purple,  bg: "rgba(168,85,247,0.15)", border: "rgba(168,85,247,0.25)" },
  "credit-card": { color: C.red,     bg: C.redDim,     border: "rgba(224,92,106,0.25)" },
};

const MONTH_NAMES = ["None","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function monthToDate(monthIndex: number, startDate: string): string {
  if (!startDate) return `Mo ${monthIndex}`;
  const d = new Date(startDate + "T00:00:00");
  d.setMonth(d.getMonth() + monthIndex - 1);
  return MONTH_SHORT[d.getMonth()] + " " + d.getFullYear();
}

function monthToShortDate(monthIndex: number, startDate: string): string {
  if (!startDate) return `Mo ${monthIndex}`;
  const d = new Date(startDate + "T00:00:00");
  d.setMonth(d.getMonth() + monthIndex - 1);
  return MONTH_SHORT[d.getMonth()] + " '" + String(d.getFullYear()).slice(2);
}

// ─── Calculation Engine ───────────────────────────────────────────────

function simulate(state: FinanceState): SimulationResult {
  const totalMonths = state.config.horizonYears * 12;
  const inflRate = state.config.inflationRate / 100;
  const months: MonthRow[] = [];
  const alerts: string[] = [];

  const accBals: Record<number, number> = {};
  for (const a of state.accounts) accBals[a.id] = a.balance;

  const loanBals: Record<number, number> = {};
  const loanFixedPmt: Record<number, number> = {};
  for (const l of state.loans) {
    loanBals[l.id] = l.currentBalance;
    const r = l.annualRate / 100 / 12;
    loanFixedPmt[l.id] = calcLoanPayment(l.currentBalance, r, l.termMonths);
  }

  let cumulativeInterestEarned = 0;
  let cumulativeInterestPaid = 0;
  let debtFreeMonth = 0;
  let negCashflowCount = 0;

  for (let m = 1; m <= totalMonths; m++) {
    const monthInYear = ((m - 1) % 12) + 1;

    // 1. Income
    let totalIncome = 0;
    for (const inc of state.incomes) {
      if (inc.startMonth > m) continue;
      if (inc.endMonth > 0 && inc.endMonth < m) continue;
      const growthFactor = Math.pow(1 + inc.growthRate / 100, Math.floor((m - 1) / 12));

      if (inc.periodicity === "one-time") {
        if (m === inc.startMonth) totalIncome += inc.amount;
        continue;
      }
      if (inc.periodicity === "annually") {
        if (monthInYear === (inc.startMonth > 0 ? ((inc.startMonth - 1) % 12) + 1 : 1)) {
          totalIncome += inc.amount * growthFactor;
        }
        continue;
      }
      if (inc.periodicity === "every-n-months") {
        const n = inc.frequencyMonths || 3;
        if ((m - inc.startMonth) % n === 0) {
          totalIncome += inc.amount * growthFactor;
        }
        continue;
      }

      let monthlyAmt = inc.amount;
      if (inc.periodicity === "weekly") monthlyAmt = inc.amount * 52 / 12;
      else if (inc.periodicity === "biweekly") monthlyAmt = inc.amount * 26 / 12;
      totalIncome += monthlyAmt * growthFactor;
      if (inc.bonusMonth > 0 && monthInYear === inc.bonusMonth) {
        totalIncome += inc.bonusAmount * growthFactor;
      }
    }

    // 2. Expenses
    let totalExpenses = 0;
    for (const exp of state.expenses) {
      if (exp.startMonth > m) continue;
      if (exp.endMonth > 0 && exp.endMonth < m) continue;

      let applies = false;
      if (exp.frequency === "monthly") applies = true;
      else if (exp.frequency === "quarterly") applies = (m - exp.startMonth) % 3 === 0;
      else if (exp.frequency === "annually") applies = (m - exp.startMonth) % 12 === 0;
      else if (exp.frequency === "one-time") applies = m === exp.startMonth;
      else if (exp.frequency === "every-n-months") applies = (m - exp.startMonth) % (exp.frequencyMonths || 3) === 0;

      if (applies) {
        let amount = exp.amount;
        if (exp.inflationAdjusted) {
          amount *= Math.pow(1 + inflRate, (m - 1) / 12);
        }
        totalExpenses += amount;
      }
    }

    // 3. Loan payments (with amortization support)
    let totalLoanPayments = 0;
    let totalInterestPaid = 0;
    let totalPrincipalPaid = 0;
    for (const loan of state.loans) {
      if (loan.startMonth > m) continue;
      const bal = loanBals[loan.id];
      if (bal <= 0.01) continue;

      const r = loan.annualRate / 100 / 12;
      const monthsElapsed = m - loan.startMonth;
      const remainingMonths = Math.max(0, loan.termMonths - monthsElapsed);
      if (remainingMonths <= 0 && bal > 0.01) {
        const interest = bal * r;
        totalInterestPaid += interest;
        totalLoanPayments += bal + interest;
        totalPrincipalPaid += bal;
        loanBals[loan.id] = 0;
        continue;
      }

      let payment = loanFixedPmt[loan.id];
      if (loan.paymentInterval === "biweekly") {
        payment = payment * 26 / 12;
      }
      payment = Math.min(payment, bal + bal * r);

      const interest = bal * r;
      const principal = Math.min(payment - interest, bal);
      const actualPayment = interest + Math.max(0, principal);

      totalInterestPaid += interest;
      totalPrincipalPaid += Math.max(0, principal);
      totalLoanPayments += actualPayment;
      let newBal = Math.max(0, bal - Math.max(0, principal));

      // Extra payments / amortizations
      const amort = getAmortizationForMonth(loan.amortizations, m, totalMonths);
      if (amort && newBal > 0.01) {
        const amortReal = Math.min(amort.amount, newBal);
        newBal -= amortReal;
        totalPrincipalPaid += amortReal;
        totalLoanPayments += amortReal;

        if (amort.effect === "reduce-payment" && newBal > 0.01) {
          const mRemaining = Math.max(1, loan.termMonths - monthsElapsed);
          loanFixedPmt[loan.id] = calcLoanPayment(newBal, r, mRemaining);
        }
        // "reduce-term": keep the same fixed payment — loan ends sooner
      }

      loanBals[loan.id] = newBal;
    }

    // 4. Net cashflow
    const netCashflow = totalIncome - totalExpenses - totalLoanPayments;

    // 5. Account interest
    let totalInterestEarned = 0;
    for (const acc of state.accounts) {
      const bal = accBals[acc.id];
      if (bal <= 0 || acc.annualRate <= 0) continue;
      const r = acc.annualRate / 100;
      let interest = 0;
      if (acc.compoundInterval === "daily") {
        interest = bal * (Math.pow(1 + r / 365, 30.44) - 1);
      } else if (acc.compoundInterval === "monthly") {
        interest = bal * r / 12;
      } else if (acc.compoundInterval === "quarterly") {
        interest = bal * (Math.pow(1 + r / 4, 1 / 3) - 1);
      } else {
        interest = bal * (Math.pow(1 + r, 1 / 12) - 1);
      }
      totalInterestEarned += interest;
      accBals[acc.id] += interest;
    }

    cumulativeInterestEarned += totalInterestEarned;
    cumulativeInterestPaid += totalInterestPaid;

    // 6. Distribute cashflow
    if (netCashflow >= 0) {
      const checkingAcc = state.accounts.find(a => a.type === "checking") || state.accounts[0];
      if (checkingAcc) accBals[checkingAcc.id] += netCashflow;
    } else {
      let deficit = Math.abs(netCashflow);
      const checkingFirst = state.accounts.filter(a => a.type === "checking");
      const savingsNext = state.accounts.filter(a => a.type === "savings");
      const rest = state.accounts.filter(a => a.type !== "checking" && a.type !== "savings");
      const deductOrder = [...checkingFirst, ...savingsNext, ...rest];
      for (const acc of deductOrder) {
        if (deficit <= 0) break;
        const deduct = Math.min(deficit, accBals[acc.id]);
        accBals[acc.id] -= deduct;
        deficit -= deduct;
      }
      if (deficit > 0.01) {
        const firstAcc = state.accounts[0];
        if (firstAcc) accBals[firstAcc.id] -= deficit;
      }
    }

    if (netCashflow < 0) negCashflowCount++;

    // 7. Record month data
    const totalAssets = state.accounts.reduce((sum, a) => sum + Math.max(0, accBals[a.id]), 0);
    const totalDebt = state.loans.reduce((sum, l) => sum + Math.max(0, loanBals[l.id]), 0);

    if (debtFreeMonth === 0 && totalDebt <= 0.01 && state.loans.length > 0) {
      debtFreeMonth = m;
    }

    months.push({
      month: m,
      year: Math.ceil(m / 12),
      totalIncome,
      totalExpenses,
      totalLoanPayments,
      totalInterestPaid,
      totalPrincipalPaid,
      totalInterestEarned,
      netCashflow,
      accountBalances: { ...accBals },
      loanBalances: { ...loanBals },
      totalAssets,
      totalDebt,
      netWorth: totalAssets - totalDebt,
    });
  }

  // Build year summaries
  const yearSummaries: YearSummary[] = [];
  for (let y = 1; y <= state.config.horizonYears; y++) {
    const yearMonths = months.filter(r => r.year === y);
    if (yearMonths.length === 0) continue;
    const last = yearMonths[yearMonths.length - 1];
    yearSummaries.push({
      year: y,
      totalIncome: yearMonths.reduce((s, r) => s + r.totalIncome, 0),
      totalExpenses: yearMonths.reduce((s, r) => s + r.totalExpenses, 0),
      totalLoanPayments: yearMonths.reduce((s, r) => s + r.totalLoanPayments, 0),
      interestEarned: yearMonths.reduce((s, r) => s + r.totalInterestEarned, 0),
      interestPaid: yearMonths.reduce((s, r) => s + r.totalInterestPaid, 0),
      netCashflow: yearMonths.reduce((s, r) => s + r.netCashflow, 0),
      endAssets: last.totalAssets,
      endDebt: last.totalDebt,
      endNetWorth: last.netWorth,
    });
  }

  const lastMonth = months.length > 0 ? months[months.length - 1] : null;

  // Alerts
  if (negCashflowCount > 3) {
    alerts.push(`Negative cashflow in ${negCashflowCount} of ${totalMonths} months.`);
  }
  if (lastMonth && lastMonth.netWorth < 0) {
    alerts.push("Net worth is negative at the end of the projection.");
  }
  const totalMonthlyDebt = state.loans.reduce((s, l) => {
    if (l.currentBalance <= 0.01) return s;
    const r = l.annualRate / 100 / 12;
    return s + calcLoanPayment(l.currentBalance, r, l.termMonths);
  }, 0);
  const totalMonthlyIncome = state.incomes.reduce((s, i) => {
    if (i.periodicity === "one-time") return s;
    if (i.periodicity === "annually") return s + i.amount / 12;
    if (i.periodicity === "every-n-months") return s + i.amount / (i.frequencyMonths || 3);
    let amt = i.amount;
    if (i.periodicity === "weekly") amt = i.amount * 52 / 12;
    else if (i.periodicity === "biweekly") amt = i.amount * 26 / 12;
    return s + amt;
  }, 0);
  if (totalMonthlyIncome > 0) {
    const dti = (totalMonthlyDebt / totalMonthlyIncome) * 100;
    if (dti > 50) {
      alerts.push(`High debt-to-income ratio: ${dti.toFixed(1)}%. Consider reducing debt.`);
    }
  }
  const anyNegAccount = months.some(r =>
    state.accounts.some(a => (r.accountBalances[a.id] ?? 0) < -100)
  );
  if (anyNegAccount) {
    alerts.push("One or more accounts go negative during the projection.");
  }

  return {
    months,
    yearSummaries,
    finalNetWorth: lastMonth?.netWorth ?? 0,
    finalAssets: lastMonth?.totalAssets ?? 0,
    finalDebt: lastMonth?.totalDebt ?? 0,
    totalInterestEarned: cumulativeInterestEarned,
    totalInterestPaid: cumulativeInterestPaid,
    avgMonthlyCashflow: months.length > 0
      ? months.reduce((s, r) => s + r.netCashflow, 0) / months.length
      : 0,
    debtFreeMonth,
    alerts,
  };
}

// ─── Subcomponents ────────────────────────────────────────────────────

function CardTitle({ children }: { children: string }) {
  return (
    <div
      class="mb-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em]"
      style={{ color: C.gold }}
    >
      <span
        class="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: C.gold }}
      />
      {children}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 transition-colors hover:border-[var(--color-primary)]">
      <div class="mb-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-text-muted)]">
        {label}
      </div>
      <div
        class="break-all font-mono text-base font-medium"
        style={{ color: color || "var(--color-text)" }}
      >
        {value}
      </div>
      {sub && (
        <div class="mt-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
          {sub}
        </div>
      )}
    </div>
  );
}

// ─── Default data ─────────────────────────────────────────────────────

function defaultState(): FinanceState {
  return {
    accounts: [
      { id: 1, name: "Checking", type: "checking", balance: 15000, annualRate: 0, compoundInterval: "monthly" },
      { id: 2, name: "Savings", type: "savings", balance: 50000, annualRate: 4, compoundInterval: "monthly" },
      { id: 3, name: "Investment", type: "investment", balance: 100000, annualRate: 8, compoundInterval: "monthly" },
    ],
    loans: [
      { id: 4, name: "Mortgage", type: "mortgage", principal: 2400000, currentBalance: 2200000, annualRate: 10.5, termMonths: 240, paymentInterval: "monthly", startMonth: 1, amortizations: [] },
      { id: 5, name: "Auto Loan", type: "auto", principal: 350000, currentBalance: 280000, annualRate: 12, termMonths: 48, paymentInterval: "monthly", startMonth: 1, amortizations: [] },
    ],
    incomes: [
      { id: 6, name: "Salary", amount: 45000, periodicity: "monthly", frequencyMonths: 0, growthRate: 5, bonusMonth: 12, bonusAmount: 45000, startMonth: 1, endMonth: 0 },
    ],
    expenses: [
      { id: 7, name: "Groceries", amount: 6000, frequency: "monthly", frequencyMonths: 0, category: "food", inflationAdjusted: true, startMonth: 1, endMonth: 0 },
      { id: 8, name: "Utilities", amount: 3000, frequency: "monthly", frequencyMonths: 0, category: "utilities", inflationAdjusted: true, startMonth: 1, endMonth: 0 },
      { id: 9, name: "Insurance", amount: 4500, frequency: "monthly", frequencyMonths: 0, category: "insurance", inflationAdjusted: false, startMonth: 1, endMonth: 0 },
      { id: 10, name: "Entertainment", amount: 3000, frequency: "monthly", frequencyMonths: 0, category: "entertainment", inflationAdjusted: true, startMonth: 1, endMonth: 0 },
    ],
    config: { horizonYears: 10, inflationRate: 4, startDate: "" },
    nextId: 11,
  };
}

// ─── Predefined Scenarios ─────────────────────────────────────────────

const SCENARIOS: { key: string; label: string; state: FinanceState }[] = [
  { key: "default", label: "Default Demo", state: defaultState() },
  {
    key: "fresh-grad",
    label: "Fresh Graduate",
    state: {
      accounts: [
        { id: 1, name: "Checking", type: "checking", balance: 8000, annualRate: 0, compoundInterval: "monthly" },
        { id: 2, name: "Savings", type: "savings", balance: 15000, annualRate: 3.5, compoundInterval: "monthly" },
      ],
      loans: [
        { id: 3, name: "Student Loan", type: "personal", principal: 250000, currentBalance: 250000, annualRate: 8, termMonths: 120, paymentInterval: "monthly", startMonth: 1, amortizations: [] },
      ],
      incomes: [
        { id: 4, name: "First Job", amount: 22000, periodicity: "monthly", frequencyMonths: 0, growthRate: 8, bonusMonth: 12, bonusAmount: 22000, startMonth: 1, endMonth: 0 },
      ],
      expenses: [
        { id: 5, name: "Rent", amount: 7000, frequency: "monthly", frequencyMonths: 0, category: "housing", inflationAdjusted: true, startMonth: 1, endMonth: 0 },
        { id: 6, name: "Food", amount: 3500, frequency: "monthly", frequencyMonths: 0, category: "food", inflationAdjusted: true, startMonth: 1, endMonth: 0 },
        { id: 7, name: "Transport", amount: 2000, frequency: "monthly", frequencyMonths: 0, category: "transport", inflationAdjusted: true, startMonth: 1, endMonth: 0 },
        { id: 8, name: "Subscriptions", amount: 800, frequency: "monthly", frequencyMonths: 0, category: "subscriptions", inflationAdjusted: false, startMonth: 1, endMonth: 0 },
      ],
      config: { horizonYears: 10, inflationRate: 4, startDate: "" },
      nextId: 9,
    },
  },
  {
    key: "dual-income",
    label: "Dual Income Family",
    state: {
      accounts: [
        { id: 1, name: "Joint Checking", type: "checking", balance: 40000, annualRate: 0, compoundInterval: "monthly" },
        { id: 2, name: "Emergency Fund", type: "savings", balance: 120000, annualRate: 4.5, compoundInterval: "monthly" },
        { id: 3, name: "Investment Portfolio", type: "investment", balance: 300000, annualRate: 9, compoundInterval: "quarterly" },
        { id: 4, name: "Retirement 401k", type: "retirement", balance: 200000, annualRate: 7, compoundInterval: "monthly" },
      ],
      loans: [
        { id: 5, name: "Mortgage", type: "mortgage", principal: 3500000, currentBalance: 3000000, annualRate: 9.5, termMonths: 240, paymentInterval: "monthly", startMonth: 1, amortizations: [] },
        { id: 6, name: "Car Loan", type: "auto", principal: 400000, currentBalance: 320000, annualRate: 11, termMonths: 48, paymentInterval: "monthly", startMonth: 1, amortizations: [] },
      ],
      incomes: [
        { id: 7, name: "Salary - Partner A", amount: 55000, periodicity: "monthly", frequencyMonths: 0, growthRate: 5, bonusMonth: 12, bonusAmount: 55000, startMonth: 1, endMonth: 0 },
        { id: 8, name: "Salary - Partner B", amount: 40000, periodicity: "monthly", frequencyMonths: 0, growthRate: 4, bonusMonth: 12, bonusAmount: 40000, startMonth: 1, endMonth: 0 },
      ],
      expenses: [
        { id: 9, name: "Groceries", amount: 10000, frequency: "monthly", frequencyMonths: 0, category: "food", inflationAdjusted: true, startMonth: 1, endMonth: 0 },
        { id: 10, name: "Utilities", amount: 4000, frequency: "monthly", frequencyMonths: 0, category: "utilities", inflationAdjusted: true, startMonth: 1, endMonth: 0 },
        { id: 11, name: "Insurance", amount: 6000, frequency: "monthly", frequencyMonths: 0, category: "insurance", inflationAdjusted: false, startMonth: 1, endMonth: 0 },
        { id: 12, name: "Kids School", amount: 12000, frequency: "monthly", frequencyMonths: 0, category: "education", inflationAdjusted: true, startMonth: 1, endMonth: 0 },
        { id: 13, name: "Entertainment", amount: 5000, frequency: "monthly", frequencyMonths: 0, category: "entertainment", inflationAdjusted: true, startMonth: 1, endMonth: 0 },
        { id: 14, name: "Health", amount: 3000, frequency: "monthly", frequencyMonths: 0, category: "health", inflationAdjusted: true, startMonth: 1, endMonth: 0 },
      ],
      config: { horizonYears: 15, inflationRate: 4, startDate: "" },
      nextId: 15,
    },
  },
  {
    key: "debt-payoff",
    label: "Aggressive Debt Payoff",
    state: {
      accounts: [
        { id: 1, name: "Checking", type: "checking", balance: 20000, annualRate: 0, compoundInterval: "monthly" },
        { id: 2, name: "Savings", type: "savings", balance: 30000, annualRate: 4, compoundInterval: "monthly" },
      ],
      loans: [
        { id: 3, name: "Mortgage", type: "mortgage", principal: 2000000, currentBalance: 1800000, annualRate: 10.5, termMonths: 240, paymentInterval: "monthly", startMonth: 1,
          amortizations: [
            { id: 100, type: "periodic", amount: 20000, effect: "reduce-term", startMonth: 6, endMonth: 0, frequency: 6 },
          ],
        },
        { id: 4, name: "Credit Card", type: "credit-card", principal: 80000, currentBalance: 80000, annualRate: 36, termMonths: 24, paymentInterval: "monthly", startMonth: 1, amortizations: [] },
        { id: 5, name: "Personal Loan", type: "personal", principal: 150000, currentBalance: 120000, annualRate: 15, termMonths: 36, paymentInterval: "monthly", startMonth: 1, amortizations: [] },
      ],
      incomes: [
        { id: 6, name: "Salary", amount: 50000, periodicity: "monthly", frequencyMonths: 0, growthRate: 4, bonusMonth: 12, bonusAmount: 100000, startMonth: 1, endMonth: 0 },
      ],
      expenses: [
        { id: 7, name: "Essentials", amount: 12000, frequency: "monthly", frequencyMonths: 0, category: "food", inflationAdjusted: true, startMonth: 1, endMonth: 0 },
        { id: 8, name: "Utilities", amount: 3000, frequency: "monthly", frequencyMonths: 0, category: "utilities", inflationAdjusted: true, startMonth: 1, endMonth: 0 },
        { id: 9, name: "Transport", amount: 2500, frequency: "monthly", frequencyMonths: 0, category: "transport", inflationAdjusted: true, startMonth: 1, endMonth: 0 },
      ],
      config: { horizonYears: 8, inflationRate: 4, startDate: "" },
      nextId: 10,
    },
  },
  {
    key: "investor",
    label: "Investment Focused",
    state: {
      accounts: [
        { id: 1, name: "Checking", type: "checking", balance: 30000, annualRate: 0, compoundInterval: "monthly" },
        { id: 2, name: "High-Yield Savings", type: "savings", balance: 200000, annualRate: 5, compoundInterval: "daily" },
        { id: 3, name: "Index Fund", type: "investment", balance: 500000, annualRate: 10, compoundInterval: "quarterly" },
        { id: 4, name: "Bonds", type: "investment", balance: 150000, annualRate: 6, compoundInterval: "monthly" },
        { id: 5, name: "Retirement", type: "retirement", balance: 400000, annualRate: 8, compoundInterval: "monthly" },
      ],
      loans: [],
      incomes: [
        { id: 6, name: "Salary", amount: 80000, periodicity: "monthly", frequencyMonths: 0, growthRate: 3, bonusMonth: 6, bonusAmount: 80000, startMonth: 1, endMonth: 0 },
        { id: 7, name: "Dividends", amount: 60000, periodicity: "annually", frequencyMonths: 0, growthRate: 5, bonusMonth: 0, bonusAmount: 0, startMonth: 1, endMonth: 0 },
        { id: 8, name: "Freelance", amount: 15000, periodicity: "monthly", frequencyMonths: 0, growthRate: 0, bonusMonth: 0, bonusAmount: 0, startMonth: 1, endMonth: 0 },
      ],
      expenses: [
        { id: 9, name: "Rent", amount: 18000, frequency: "monthly", frequencyMonths: 0, category: "housing", inflationAdjusted: true, startMonth: 1, endMonth: 0 },
        { id: 10, name: "Living Expenses", amount: 15000, frequency: "monthly", frequencyMonths: 0, category: "food", inflationAdjusted: true, startMonth: 1, endMonth: 0 },
        { id: 11, name: "Travel", amount: 60000, frequency: "annually", frequencyMonths: 0, category: "entertainment", inflationAdjusted: true, startMonth: 1, endMonth: 0 },
      ],
      config: { horizonYears: 20, inflationRate: 3.5, startDate: "" },
      nextId: 12,
    },
  },
  {
    key: "empty",
    label: "Start from Scratch",
    state: {
      accounts: [],
      loans: [],
      incomes: [],
      expenses: [],
      config: { horizonYears: 10, inflationRate: 4, startDate: "" },
      nextId: 1,
    },
  },
];

// ─── Export / Import helpers ──────────────────────────────────────────

function exportJSON(state: FinanceState) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "finance-sim.json";
  a.click();
  URL.revokeObjectURL(url);
}

function exportCSV(sim: SimulationResult, startDate: string) {
  const headers = ["Month", "Date", "Income", "Expenses", "Loan Payments", "Interest Paid", "Interest Earned", "Net Cashflow", "Total Assets", "Total Debt", "Net Worth"];
  const rows = sim.months.map((r) => [
    r.month,
    startDate ? monthToDate(r.month, startDate) : `Month ${r.month}`,
    r.totalIncome.toFixed(2),
    r.totalExpenses.toFixed(2),
    r.totalLoanPayments.toFixed(2),
    r.totalInterestPaid.toFixed(2),
    r.totalInterestEarned.toFixed(2),
    r.netCashflow.toFixed(2),
    r.totalAssets.toFixed(2),
    r.totalDebt.toFixed(2),
    r.netWorth.toFixed(2),
  ]);
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "finance-sim-results.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function importJSON(file: File): Promise<FinanceState | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as FinanceState;
        if (!data.accounts || !data.loans || !data.incomes || !data.expenses || !data.config) {
          resolve(null);
          return;
        }
        resolve(data);
      } catch {
        resolve(null);
      }
    };
    reader.onerror = () => resolve(null);
    reader.readAsText(file);
  });
}

// ─── Main Component ───────────────────────────────────────────────────

export default function FinanceSim() {
  const [state, setState] = useState<FinanceState>(defaultState);
  const [tab, setTab] = useState<"dashboard" | "accounts" | "loans" | "income" | "expenses">("dashboard");
  const [chartMode, setChartMode] = useState<"networth" | "cashflow" | "balances" | "debt">("networth");
  const [tableOpen, setTableOpen] = useState(false);
  const [granularity, setGranularity] = useState<"monthly" | "quarterly" | "yearly">("yearly");
  const [timelineOpen, setTimelineOpen] = useState(true);

  // Account form
  const [accName, setAccName] = useState("New Account");
  const [accType, setAccType] = useState<AccountType>("savings");
  const [accBalance, setAccBalance] = useState(10000);
  const [accRate, setAccRate] = useState(3);
  const [accCompound, setAccCompound] = useState<CompoundInterval>("monthly");

  // Loan form
  const [loanName, setLoanName] = useState("New Loan");
  const [loanType, setLoanType] = useState<LoanType>("personal");
  const [loanPrincipal, setLoanPrincipal] = useState(100000);
  const [loanBalance, setLoanBalance] = useState(100000);
  const [loanRate, setLoanRate] = useState(12);
  const [loanTerm, setLoanTerm] = useState(60);
  const [loanInterval, setLoanInterval] = useState<"monthly" | "biweekly">("monthly");
  const [loanStart, setLoanStart] = useState(1);

  // Income form
  const [incName, setIncName] = useState("New Income");
  const [incAmount, setIncAmount] = useState(10000);
  const [incPeriodicity, setIncPeriodicity] = useState<IncomePeriodicity>("monthly");
  const [incFreqMonths, setIncFreqMonths] = useState(3);
  const [incGrowth, setIncGrowth] = useState(3);
  const [incBonusMonth, setIncBonusMonth] = useState(0);
  const [incBonusAmount, setIncBonusAmount] = useState(0);
  const [incStart, setIncStart] = useState(1);
  const [incEnd, setIncEnd] = useState(0);

  // Loan amortization form
  const [amortLoanId, setAmortLoanId] = useState(0);
  const [amortType, setAmortType] = useState<"one-time" | "periodic">("one-time");
  const [amortAmount, setAmortAmount] = useState(50000);
  const [amortEffect, setAmortEffect] = useState<"reduce-term" | "reduce-payment">("reduce-term");
  const [amortMonth, setAmortMonth] = useState(12);
  const [amortStartMonth, setAmortStartMonth] = useState(12);
  const [amortEndMonth, setAmortEndMonth] = useState(0);
  const [amortFrequency, setAmortFrequency] = useState(12);

  // Expense form
  const [expName, setExpName] = useState("New Expense");
  const [expAmount, setExpAmount] = useState(1000);
  const [expFreq, setExpFreq] = useState<ExpenseFrequency>("monthly");
  const [expFreqMonths, setExpFreqMonths] = useState(3);
  const [expCategory, setExpCategory] = useState("other");
  const [expInflation, setExpInflation] = useState(true);
  const [expStart, setExpStart] = useState(1);
  const [expEnd, setExpEnd] = useState(0);

  // Editing state (null = adding new, number = editing that ID)
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null);
  const [editingLoanId, setEditingLoanId] = useState<number | null>(null);
  const [editingIncomeId, setEditingIncomeId] = useState<number | null>(null);
  const [editingExpenseId, setEditingExpenseId] = useState<number | null>(null);

  // Refs
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstanceRef = useRef<Chart | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tabChartRef = useRef<HTMLCanvasElement>(null);
  const tabChartInstanceRef = useRef<Chart | null>(null);
  const ganttCanvasRef = useRef<HTMLCanvasElement>(null);
  const ganttContainerRef = useRef<HTMLDivElement>(null);
  const [ganttWidth, setGanttWidth] = useState(0);

  // Simulation
  const sim = useMemo(() => simulate(state), [state]);

  // Import / Export / Scenario handlers
  const handleImport = useCallback(async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const data = await importJSON(file);
    if (data) {
      setState(data);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const loadScenario = useCallback((key: string) => {
    const scenario = SCENARIOS.find((s) => s.key === key);
    if (scenario) {
      setState(JSON.parse(JSON.stringify(scenario.state)));
    }
  }, []);

  // ── Input helpers ──
  const numInput = useCallback((
    value: number,
    onChange: (v: number) => void,
    opts?: {
      prefix?: string;
      suffix?: string;
      min?: number;
      max?: number;
      step?: number;
    }
  ) => (
    <div class="relative flex items-center">
      {opts?.prefix && (
        <span
          class="pointer-events-none absolute left-3 z-[1] font-mono text-sm"
          style={{ color: C.gold }}
        >
          {opts.prefix}
        </span>
      )}
      <input
        type="number"
        value={value}
        min={opts?.min}
        max={opts?.max}
        step={opts?.step}
        onInput={(e) =>
          onChange(Number((e.target as HTMLInputElement).value) || 0)
        }
        class={`w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-light)] py-2 font-mono text-sm text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)] ${opts?.prefix ? "pl-7" : "px-3"} ${opts?.suffix ? "pr-10" : "pr-3"}`}
        style={{
          MozAppearance: "textfield",
          WebkitAppearance: "none",
        }}
      />
      {opts?.suffix && (
        <span class="pointer-events-none absolute right-3 font-mono text-xs text-[var(--color-text-muted)]">
          {opts.suffix}
        </span>
      )}
    </div>
  ), []);

  const selectInput = useCallback((
    value: string,
    onChange: (v: string) => void,
    options: { value: string; label: string }[]
  ) => (
    <select
      value={value}
      onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
      class="w-full cursor-pointer appearance-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-light)] px-3 py-2 pr-8 font-mono text-sm text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)]"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%237d8590' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 12px center",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ), []);

  const textInput = useCallback((
    value: string,
    onChange: (v: string) => void,
  ) => (
    <input
      type="text"
      value={value}
      onInput={(e) => onChange((e.target as HTMLInputElement).value)}
      class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-light)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)]"
    />
  ), []);

  const label = useCallback((text: string) => (
    <div class="mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
      {text}
    </div>
  ), []);

  // ── State updaters ──
  const setConfig = useCallback((patch: Partial<SimConfig>) => {
    setState(s => ({ ...s, config: { ...s.config, ...patch } }));
  }, []);

  // ── Edit helpers: populate form from existing item ──
  const startEditAccount = useCallback((a: Account) => {
    setEditingAccountId(a.id);
    setAccName(a.name); setAccType(a.type); setAccBalance(a.balance);
    setAccRate(a.annualRate); setAccCompound(a.compoundInterval);
  }, []);

  const cancelEditAccount = useCallback(() => {
    setEditingAccountId(null);
    setAccName("New Account"); setAccType("savings"); setAccBalance(10000);
    setAccRate(3); setAccCompound("monthly");
  }, []);

  const startEditLoan = useCallback((l: Loan) => {
    setEditingLoanId(l.id);
    setLoanName(l.name); setLoanType(l.type); setLoanPrincipal(l.principal);
    setLoanBalance(l.currentBalance); setLoanRate(l.annualRate);
    setLoanTerm(l.termMonths); setLoanInterval(l.paymentInterval); setLoanStart(l.startMonth);
  }, []);

  const cancelEditLoan = useCallback(() => {
    setEditingLoanId(null);
    setLoanName("New Loan"); setLoanType("personal"); setLoanPrincipal(100000);
    setLoanBalance(100000); setLoanRate(12); setLoanTerm(60);
    setLoanInterval("monthly"); setLoanStart(1);
  }, []);

  const startEditIncome = useCallback((inc: Income) => {
    setEditingIncomeId(inc.id);
    setIncName(inc.name); setIncAmount(inc.amount); setIncPeriodicity(inc.periodicity);
    setIncFreqMonths(inc.frequencyMonths || 3);
    setIncGrowth(inc.growthRate); setIncBonusMonth(inc.bonusMonth);
    setIncBonusAmount(inc.bonusAmount); setIncStart(inc.startMonth); setIncEnd(inc.endMonth);
  }, []);

  const cancelEditIncome = useCallback(() => {
    setEditingIncomeId(null);
    setIncName("New Income"); setIncAmount(10000); setIncPeriodicity("monthly");
    setIncFreqMonths(3); setIncGrowth(3); setIncBonusMonth(0); setIncBonusAmount(0);
    setIncStart(1); setIncEnd(0);
  }, []);

  const startEditExpense = useCallback((exp: Expense) => {
    setEditingExpenseId(exp.id);
    setExpName(exp.name); setExpAmount(exp.amount); setExpFreq(exp.frequency);
    setExpFreqMonths(exp.frequencyMonths || 3);
    setExpCategory(exp.category); setExpInflation(exp.inflationAdjusted);
    setExpStart(exp.startMonth); setExpEnd(exp.endMonth);
  }, []);

  const cancelEditExpense = useCallback(() => {
    setEditingExpenseId(null);
    setExpName("New Expense"); setExpAmount(1000); setExpFreq("monthly");
    setExpFreqMonths(3); setExpCategory("other"); setExpInflation(true); setExpStart(1); setExpEnd(0);
  }, []);

  // ── Add / Save handlers ──
  const saveAccount = useCallback(() => {
    if (!accName.trim()) return;
    if (editingAccountId !== null) {
      setState(s => ({
        ...s,
        accounts: s.accounts.map(a => a.id === editingAccountId
          ? { ...a, name: accName, type: accType, balance: accBalance, annualRate: accRate, compoundInterval: accCompound }
          : a),
      }));
      cancelEditAccount();
    } else {
      setState(s => ({
        ...s,
        accounts: [...s.accounts, {
          id: s.nextId, name: accName, type: accType,
          balance: accBalance, annualRate: accRate, compoundInterval: accCompound,
        }],
        nextId: s.nextId + 1,
      }));
    }
  }, [accName, accType, accBalance, accRate, accCompound, editingAccountId, cancelEditAccount]);

  const removeAccount = useCallback((id: number) => {
    setState(s => ({ ...s, accounts: s.accounts.filter(a => a.id !== id) }));
    if (editingAccountId === id) cancelEditAccount();
  }, [editingAccountId, cancelEditAccount]);

  const saveLoan = useCallback(() => {
    if (!loanName.trim()) return;
    if (editingLoanId !== null) {
      setState(s => ({
        ...s,
        loans: s.loans.map(l => l.id === editingLoanId
          ? { ...l, name: loanName, type: loanType, principal: loanPrincipal, currentBalance: loanBalance, annualRate: loanRate, termMonths: loanTerm, paymentInterval: loanInterval, startMonth: loanStart }
          : l),
      }));
      cancelEditLoan();
    } else {
      setState(s => ({
        ...s,
        loans: [...s.loans, {
          id: s.nextId, name: loanName, type: loanType,
          principal: loanPrincipal, currentBalance: loanBalance,
          annualRate: loanRate, termMonths: loanTerm,
          paymentInterval: loanInterval, startMonth: loanStart,
          amortizations: [],
        }],
        nextId: s.nextId + 1,
      }));
    }
  }, [loanName, loanType, loanPrincipal, loanBalance, loanRate, loanTerm, loanInterval, loanStart, editingLoanId, cancelEditLoan]);

  const removeLoan = useCallback((id: number) => {
    setState(s => ({ ...s, loans: s.loans.filter(l => l.id !== id) }));
    if (editingLoanId === id) cancelEditLoan();
  }, [editingLoanId, cancelEditLoan]);

  const saveIncome = useCallback(() => {
    if (!incName.trim()) return;
    if (editingIncomeId !== null) {
      setState(s => ({
        ...s,
        incomes: s.incomes.map(i => i.id === editingIncomeId
          ? { ...i, name: incName, amount: incAmount, periodicity: incPeriodicity, frequencyMonths: incFreqMonths, growthRate: incGrowth, bonusMonth: incBonusMonth, bonusAmount: incBonusAmount, startMonth: incStart, endMonth: incEnd }
          : i),
      }));
      cancelEditIncome();
    } else {
      setState(s => ({
        ...s,
        incomes: [...s.incomes, {
          id: s.nextId, name: incName, amount: incAmount,
          periodicity: incPeriodicity, frequencyMonths: incFreqMonths,
          growthRate: incGrowth,
          bonusMonth: incBonusMonth, bonusAmount: incBonusAmount,
          startMonth: incStart, endMonth: incEnd,
        }],
        nextId: s.nextId + 1,
      }));
    }
  }, [incName, incAmount, incPeriodicity, incFreqMonths, incGrowth, incBonusMonth, incBonusAmount, incStart, incEnd, editingIncomeId, cancelEditIncome]);

  const removeIncome = useCallback((id: number) => {
    setState(s => ({ ...s, incomes: s.incomes.filter(i => i.id !== id) }));
    if (editingIncomeId === id) cancelEditIncome();
  }, [editingIncomeId, cancelEditIncome]);

  const saveExpense = useCallback(() => {
    if (!expName.trim()) return;
    if (editingExpenseId !== null) {
      setState(s => ({
        ...s,
        expenses: s.expenses.map(e => e.id === editingExpenseId
          ? { ...e, name: expName, amount: expAmount, frequency: expFreq, frequencyMonths: expFreqMonths, category: expCategory, inflationAdjusted: expInflation, startMonth: expStart, endMonth: expEnd }
          : e),
      }));
      cancelEditExpense();
    } else {
      setState(s => ({
        ...s,
        expenses: [...s.expenses, {
          id: s.nextId, name: expName, amount: expAmount,
          frequency: expFreq, frequencyMonths: expFreqMonths,
          category: expCategory,
          inflationAdjusted: expInflation,
          startMonth: expStart, endMonth: expEnd,
        }],
        nextId: s.nextId + 1,
      }));
    }
  }, [expName, expAmount, expFreq, expFreqMonths, expCategory, expInflation, expStart, expEnd, editingExpenseId, cancelEditExpense]);

  const removeExpense = useCallback((id: number) => {
    setState(s => ({ ...s, expenses: s.expenses.filter(e => e.id !== id) }));
    if (editingExpenseId === id) cancelEditExpense();
  }, [editingExpenseId, cancelEditExpense]);

  const addAmortization = useCallback(() => {
    const targetLoan = amortLoanId > 0 ? amortLoanId : state.loans[0]?.id;
    if (!targetLoan) return;
    setState(s => {
      const loan = s.loans.find(l => l.id === targetLoan);
      if (!loan) return s;
      const newAmort: LoanAmortization = amortType === "one-time"
        ? { id: s.nextId, type: "one-time", amount: amortAmount, effect: amortEffect, month: amortMonth }
        : { id: s.nextId, type: "periodic", amount: amortAmount, effect: amortEffect, startMonth: amortStartMonth, endMonth: amortEndMonth, frequency: amortFrequency };
      return {
        ...s,
        loans: s.loans.map(l =>
          l.id === targetLoan
            ? { ...l, amortizations: [...l.amortizations, newAmort] }
            : l
        ),
        nextId: s.nextId + 1,
      };
    });
  }, [amortLoanId, amortType, amortAmount, amortEffect, amortMonth, amortStartMonth, amortEndMonth, amortFrequency, state.loans]);

  const removeAmortization = useCallback((loanId: number, amortId: number) => {
    setState(s => ({
      ...s,
      loans: s.loans.map(l =>
        l.id === loanId
          ? { ...l, amortizations: l.amortizations.filter(a => a.id !== amortId) }
          : l
      ),
    }));
  }, []);

  // ── Computed summaries ──
  const totalMonthlyIncome = useMemo(() => {
    return state.incomes.reduce((s, i) => {
      if (i.periodicity === "one-time") return s;
      if (i.periodicity === "annually") return s + i.amount / 12;
      if (i.periodicity === "every-n-months") return s + i.amount / (i.frequencyMonths || 3);
      let amt = i.amount;
      if (i.periodicity === "weekly") amt = i.amount * 52 / 12;
      else if (i.periodicity === "biweekly") amt = i.amount * 26 / 12;
      return s + amt;
    }, 0);
  }, [state.incomes]);

  const annualGrossIncome = useMemo(() => {
    return state.incomes.reduce((s, i) => {
      if (i.periodicity === "one-time") return s + i.amount;
      if (i.periodicity === "annually") return s + i.amount;
      if (i.periodicity === "every-n-months") return s + i.amount * (12 / (i.frequencyMonths || 3));
      let annual = i.amount;
      if (i.periodicity === "weekly") annual = i.amount * 52;
      else if (i.periodicity === "biweekly") annual = i.amount * 26;
      else annual = i.amount * 12;
      if (i.bonusMonth > 0) annual += i.bonusAmount;
      return s + annual;
    }, 0);
  }, [state.incomes]);

  const totalMonthlyExpenses = useMemo(() => {
    return state.expenses.reduce((s, e) => {
      if (e.frequency === "monthly") return s + e.amount;
      if (e.frequency === "quarterly") return s + e.amount / 3;
      if (e.frequency === "annually") return s + e.amount / 12;
      if (e.frequency === "every-n-months") return s + e.amount / (e.frequencyMonths || 3);
      return s;
    }, 0);
  }, [state.expenses]);

  const expensesByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of state.expenses) {
      let monthly = e.amount;
      if (e.frequency === "quarterly") monthly = e.amount / 3;
      else if (e.frequency === "annually") monthly = e.amount / 12;
      else if (e.frequency === "every-n-months") monthly = e.amount / (e.frequencyMonths || 3);
      else if (e.frequency === "one-time") monthly = 0;
      map[e.category] = (map[e.category] || 0) + monthly;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [state.expenses]);

  const totalAccountBalance = useMemo(() => {
    return state.accounts.reduce((s, a) => s + a.balance, 0);
  }, [state.accounts]);

  const monthlyInterestFromAccounts = useMemo(() => {
    return state.accounts.reduce((s, a) => {
      if (a.annualRate <= 0) return s;
      return s + a.balance * a.annualRate / 100 / 12;
    }, 0);
  }, [state.accounts]);

  const totalDebt = useMemo(() => {
    return state.loans.reduce((s, l) => s + l.currentBalance, 0);
  }, [state.loans]);

  const totalMonthlyLoanPayments = useMemo(() => {
    return state.loans.reduce((s, l) => {
      if (l.currentBalance <= 0.01) return s;
      const r = l.annualRate / 100 / 12;
      let pmt = calcLoanPayment(l.currentBalance, r, l.termMonths);
      if (l.paymentInterval === "biweekly") pmt = pmt * 26 / 12;
      return s + pmt;
    }, 0);
  }, [state.loans]);

  const totalInterestOverLife = useMemo(() => {
    return state.loans.reduce((s, l) => {
      if (l.currentBalance <= 0.01) return s;
      const r = l.annualRate / 100 / 12;
      const pmt = calcLoanPayment(l.currentBalance, r, l.termMonths);
      return s + (pmt * l.termMonths - l.currentBalance);
    }, 0);
  }, [state.loans]);

  const getChartSamples = useCallback((months: MonthRow[], gran: "monthly" | "quarterly" | "yearly", startDate: string) => {
    const step = gran === "monthly" ? 1 : gran === "quarterly" ? 3 : 12;
    const labels: string[] = [];
    const dataIndices: number[] = [];
    for (let i = 0; i < months.length; i += step) {
      dataIndices.push(i);
      if (startDate) {
        if (gran === "quarterly") {
          const d = new Date(startDate + "T00:00:00");
          d.setMonth(d.getMonth() + i);
          const q = Math.floor(d.getMonth() / 3) + 1;
          labels.push(`Q${q} '${String(d.getFullYear()).slice(2)}`);
        } else {
          labels.push(monthToShortDate(i + 1, startDate));
        }
      } else {
        if (gran === "monthly") labels.push(`Mo ${i + 1}`);
        else if (gran === "quarterly") labels.push(`Q${Math.floor(i / 3) + 1}`);
        else labels.push(`Yr ${Math.floor(i / 12) + 1}`);
      }
    }
    return { labels, dataIndices };
  }, []);

  // ── Chart rendering ──
  useEffect(() => {
    if (!chartRef.current || tab !== "dashboard") return;
    if (chartInstanceRef.current) chartInstanceRef.current.destroy();

    const isLight = document.documentElement.classList.contains("light");
    const gridColor = isLight ? C.gridLight : C.gridDark;
    const textColor = isLight ? "#71717a" : C.muted;

    const totalMonths = sim.months.length;
    if (totalMonths === 0) return;

    const sd = state.config.startDate;
    const { labels, dataIndices } = getChartSamples(sim.months, granularity, sd);
    const ptRadius = granularity === "monthly" ? 0 : granularity === "quarterly" ? 1 : 3;

    const sampleData = (accessor: (r: MonthRow) => number) =>
      dataIndices.map(i => accessor(sim.months[i]));

    let datasets: any[] = [];
    let yAxisTitle = "Amount ($)";

    const ctx = chartRef.current.getContext("2d");
    if (!ctx) return;

    if (chartMode === "networth") {
      const grad = ctx.createLinearGradient(0, 0, 0, 340);
      grad.addColorStop(0, "rgba(212,168,67,0.35)");
      grad.addColorStop(1, "rgba(212,168,67,0.02)");
      datasets = [{
        label: "Net Worth",
        data: sampleData(r => r.netWorth),
        borderColor: C.gold,
        backgroundColor: grad,
        fill: true, tension: 0.3, borderWidth: 2.5, pointRadius: ptRadius,
        pointBackgroundColor: C.gold, pointBorderColor: C.gold,
      }];
      yAxisTitle = "Net Worth ($)";
    } else if (chartMode === "cashflow") {
      const incomeData = sampleData(r => r.totalIncome);
      const expenseData = sampleData(r => -(r.totalExpenses + r.totalLoanPayments));
      const netData = sampleData(r => r.netCashflow);
      const greenGrad = ctx.createLinearGradient(0, 0, 0, 340);
      greenGrad.addColorStop(0, "rgba(63,182,138,0.3)");
      greenGrad.addColorStop(1, "rgba(63,182,138,0.02)");
      const redGrad = ctx.createLinearGradient(0, 0, 0, 340);
      redGrad.addColorStop(0, "rgba(224,92,106,0.02)");
      redGrad.addColorStop(1, "rgba(224,92,106,0.3)");
      datasets = [
        {
          label: "Income",
          data: incomeData,
          borderColor: C.green,
          backgroundColor: greenGrad,
          fill: true, tension: 0.3, borderWidth: 1.5, pointRadius: 0,
        },
        {
          label: "Outflows",
          data: expenseData,
          borderColor: C.red,
          backgroundColor: redGrad,
          fill: true, tension: 0.3, borderWidth: 1.5, pointRadius: 0,
        },
        {
          label: "Net Cashflow",
          data: netData,
          borderColor: C.goldLight,
          backgroundColor: "transparent",
          fill: false, tension: 0.3, borderWidth: 2, pointRadius: ptRadius,
          pointBackgroundColor: C.goldLight,
          borderDash: [6, 3],
        },
      ];
      yAxisTitle = "Monthly Cashflow ($)";
    } else if (chartMode === "balances") {
      datasets = state.accounts.map((acc, i) => ({
        label: acc.name,
        data: sampleData(r => r.accountBalances[acc.id] ?? 0),
        borderColor: C.palette[i % C.palette.length],
        backgroundColor: "transparent",
        fill: false, tension: 0.3, borderWidth: 2, pointRadius: ptRadius,
        pointBackgroundColor: C.palette[i % C.palette.length],
      }));
      yAxisTitle = "Account Balance ($)";
    } else {
      datasets = state.loans.map((loan, i) => {
        const color = C.palette[i % C.palette.length];
        return {
          label: loan.name,
          data: sampleData(r => r.loanBalances[loan.id] ?? 0),
          borderColor: color,
          backgroundColor: "transparent",
          fill: false, tension: 0.3, borderWidth: 2, pointRadius: ptRadius,
          pointBackgroundColor: color,
        };
      });
      yAxisTitle = "Remaining Balance ($)";
    }

    chartInstanceRef.current = new Chart(chartRef.current, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            labels: {
              color: textColor,
              font: { family: "monospace", size: 10 },
              boxWidth: 12,
              padding: 16,
            },
          },
          tooltip: {
            backgroundColor: isLight ? "#fff" : "#1c2330",
            borderColor: isLight ? "#e4e4e7" : "#30363d",
            borderWidth: 1,
            titleColor: isLight ? "#18181b" : "#e6edf3",
            bodyColor: textColor,
            titleFont: { family: "monospace", size: 11 },
            bodyFont: { family: "monospace", size: 11 },
            callbacks: {
              label: (ctx: any) =>
                ` ${ctx.dataset.label}: ${fmtShort(ctx.parsed.y ?? 0)}`,
            },
          },
        },
        scales: {
          x: {
            title: {
              display: true,
              text: "Time",
              color: textColor,
              font: { family: "monospace", size: 10 },
              padding: { top: 8 },
            },
            grid: { color: gridColor, drawTicks: false },
            ticks: {
              color: textColor,
              font: { family: "monospace", size: 9 },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: granularity === "monthly" ? 20 : granularity === "quarterly" ? 15 : 12,
            },
            border: { color: gridColor },
          },
          y: {
            title: {
              display: true,
              text: yAxisTitle,
              color: textColor,
              font: { family: "monospace", size: 10 },
              padding: { bottom: 8 },
            },
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: { family: "monospace", size: 9 },
              callback: (v: any) => fmtShort(Number(v)),
            },
            border: { color: gridColor },
          },
        },
      },
    });

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [sim, chartMode, tab, state.accounts, state.loans, state.config.startDate, granularity, getChartSamples]);

  // ── Entity tab charts ──
  useEffect(() => {
    if (!tabChartRef.current || tab === "dashboard") return;
    if (tabChartInstanceRef.current) tabChartInstanceRef.current.destroy();

    const isLight = document.documentElement.classList.contains("light");
    const gridColor = isLight ? C.gridLight : C.gridDark;
    const textColor = isLight ? "#71717a" : C.muted;

    if (sim.months.length === 0) return;

    const sd = state.config.startDate;
    const { labels, dataIndices } = getChartSamples(sim.months, granularity, sd);
    const ptRadius = granularity === "monthly" ? 0 : granularity === "quarterly" ? 1 : 2;
    const sampleData = (accessor: (r: MonthRow) => number) =>
      dataIndices.map(i => accessor(sim.months[i]));

    const ctx = tabChartRef.current.getContext("2d");
    if (!ctx) return;

    let datasets: any[] = [];
    let yAxisTitle = "";

    if (tab === "accounts") {
      datasets = state.accounts.map((acc, i) => ({
        label: acc.name,
        data: sampleData(r => r.accountBalances[acc.id] ?? 0),
        borderColor: C.palette[i % C.palette.length],
        backgroundColor: "transparent",
        fill: false, tension: 0.3, borderWidth: 2, pointRadius: ptRadius,
        pointBackgroundColor: C.palette[i % C.palette.length],
      }));
      yAxisTitle = "Account Balance ($)";
    } else if (tab === "loans") {
      datasets = state.loans.map((loan, i) => ({
        label: loan.name,
        data: sampleData(r => r.loanBalances[loan.id] ?? 0),
        borderColor: C.palette[i % C.palette.length],
        backgroundColor: "transparent",
        fill: false, tension: 0.3, borderWidth: 2, pointRadius: ptRadius,
        pointBackgroundColor: C.palette[i % C.palette.length],
      }));
      yAxisTitle = "Remaining Balance ($)";
    } else if (tab === "income") {
      const grad = ctx.createLinearGradient(0, 0, 0, 260);
      grad.addColorStop(0, "rgba(63,182,138,0.35)");
      grad.addColorStop(1, "rgba(63,182,138,0.02)");
      datasets = [{
        label: "Total Income",
        data: sampleData(r => r.totalIncome),
        borderColor: C.green,
        backgroundColor: grad,
        fill: true, tension: 0.3, borderWidth: 2, pointRadius: ptRadius,
        pointBackgroundColor: C.green,
      }];
      yAxisTitle = "Monthly Income ($)";
    } else if (tab === "expenses") {
      const grad = ctx.createLinearGradient(0, 0, 0, 260);
      grad.addColorStop(0, "rgba(224,92,106,0.35)");
      grad.addColorStop(1, "rgba(224,92,106,0.02)");
      datasets = [{
        label: "Total Expenses",
        data: sampleData(r => r.totalExpenses),
        borderColor: C.red,
        backgroundColor: grad,
        fill: true, tension: 0.3, borderWidth: 2, pointRadius: ptRadius,
        pointBackgroundColor: C.red,
      }];
      yAxisTitle = "Monthly Expenses ($)";
    }

    if (datasets.length === 0) return;

    tabChartInstanceRef.current = new Chart(tabChartRef.current, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            display: tab === "accounts" || tab === "loans",
            labels: {
              color: textColor,
              font: { family: "monospace", size: 10 },
              boxWidth: 12, padding: 16,
            },
          },
          tooltip: {
            backgroundColor: isLight ? "#fff" : "#1c2330",
            borderColor: isLight ? "#e4e4e7" : "#30363d",
            borderWidth: 1,
            titleColor: isLight ? "#18181b" : "#e6edf3",
            bodyColor: textColor,
            titleFont: { family: "monospace", size: 11 },
            bodyFont: { family: "monospace", size: 11 },
            callbacks: {
              label: (c: any) => ` ${c.dataset.label}: ${fmtShort(c.parsed.y ?? 0)}`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: gridColor, drawTicks: false },
            ticks: {
              color: textColor,
              font: { family: "monospace", size: 9 },
              maxRotation: 0, autoSkip: true,
              maxTicksLimit: granularity === "monthly" ? 20 : granularity === "quarterly" ? 15 : 12,
            },
            border: { color: gridColor },
          },
          y: {
            title: {
              display: true, text: yAxisTitle, color: textColor,
              font: { family: "monospace", size: 10 }, padding: { bottom: 8 },
            },
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: { family: "monospace", size: 9 },
              callback: (v: any) => fmtShort(Number(v)),
            },
            border: { color: gridColor },
          },
        },
      },
    });

    return () => {
      if (tabChartInstanceRef.current) {
        tabChartInstanceRef.current.destroy();
        tabChartInstanceRef.current = null;
      }
    };
  }, [sim, tab, state.accounts, state.loans, state.config.startDate, granularity, getChartSamples]);

  // ── Gantt ResizeObserver ──
  useEffect(() => {
    const container = ganttContainerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setGanttWidth(entry.contentRect.width);
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [tab, timelineOpen]);

  // ── Gantt Timeline Drawing ──
  useEffect(() => {
    const canvas = ganttCanvasRef.current;
    if (!canvas || tab !== "dashboard" || !timelineOpen) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const totalMonths = sim.months.length;
    if (totalMonths === 0) return;

    // Gather entities with their active ranges
    type GanttRow = { name: string; start: number; end: number; color: string; section: string; amortMonths?: number[] };
    const rows: GanttRow[] = [];

    // INCOME section
    for (const inc of state.incomes) {
      const end = inc.endMonth > 0 ? Math.min(inc.endMonth, totalMonths) : totalMonths;
      rows.push({ name: inc.name, start: inc.startMonth, end, color: C.green, section: "INCOME" });
    }

    // EXPENSES section
    for (const exp of state.expenses) {
      const end = exp.endMonth > 0 ? Math.min(exp.endMonth, totalMonths) : totalMonths;
      rows.push({ name: exp.name, start: exp.startMonth, end, color: C.red, section: "EXPENSES" });
    }

    // LOANS section
    for (const loan of state.loans) {
      const end = Math.min(loan.startMonth + loan.termMonths, totalMonths);
      // Collect amortization months
      const amortMonths: number[] = [];
      for (const a of loan.amortizations) {
        if (a.type === "one-time") {
          amortMonths.push(a.month);
        } else {
          const aEnd = a.endMonth > 0 ? Math.min(a.endMonth, totalMonths) : totalMonths;
          for (let m = a.startMonth; m <= aEnd; m += a.frequency) {
            amortMonths.push(m);
          }
        }
      }
      rows.push({ name: loan.name, start: loan.startMonth, end, color: C.blue, section: "LOANS", amortMonths });
    }

    if (rows.length === 0) return;

    // Layout constants
    const dpr = window.devicePixelRatio || 1;
    const leftPad = 120;
    const topPad = 28;
    const rowH = 24;
    const sectionHeaderH = 22;
    const bottomPad = 24;

    // Count sections
    const sections = [...new Set(rows.map(r => r.section))];
    const totalRows = rows.length;
    const canvasH = topPad + sections.length * sectionHeaderH + totalRows * rowH + bottomPad;
    const containerW = ganttWidth || canvas.parentElement?.clientWidth || 600;

    canvas.style.width = containerW + "px";
    canvas.style.height = canvasH + "px";
    canvas.width = containerW * dpr;
    canvas.height = canvasH * dpr;
    ctx.scale(dpr, dpr);

    const chartW = containerW - leftPad - 16;
    const unitW = chartW / Math.max(totalMonths, 1);

    // Background
    ctx.clearRect(0, 0, containerW, canvasH);

    // Computed text color
    const isLight = document.documentElement.classList.contains("light");
    const textColor = isLight ? "#71717a" : "#7d8590";
    const headerBg = isLight ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.03)";

    // X-axis labels at top
    ctx.fillStyle = textColor;
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    const sd = state.config.startDate;
    const tickInterval = totalMonths <= 24 ? 3 : totalMonths <= 60 ? 6 : 12;
    for (let m = 0; m <= totalMonths; m += tickInterval) {
      const x = leftPad + m * unitW;
      const lbl = sd ? monthToShortDate(m + 1, sd) : `Mo ${m + 1}`;
      ctx.fillText(lbl, x, topPad - 8);
    }

    // Draw sections and bars
    let y = topPad;
    const sectionColors: Record<string, string> = { INCOME: C.green, EXPENSES: C.red, LOANS: C.blue };

    for (const section of sections) {
      const sectionRows = rows.filter(r => r.section === section);
      const sColor = sectionColors[section] || C.muted;

      // Section header
      ctx.fillStyle = headerBg;
      ctx.fillRect(0, y, containerW, sectionHeaderH);
      ctx.fillStyle = sColor;
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "left";
      ctx.fillText(section, 8, y + 15);
      // Colored underline
      ctx.strokeStyle = sColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(8, y + sectionHeaderH - 2);
      ctx.lineTo(8 + ctx.measureText(section).width, y + sectionHeaderH - 2);
      ctx.stroke();
      y += sectionHeaderH;

      // Entity bars
      for (const row of sectionRows) {
        const barX = leftPad + (row.start - 1) * unitW;
        const barW = Math.max(2, (row.end - row.start + 1) * unitW);
        const barY = y + 4;
        const barH = rowH - 8;

        // Entity name (truncated)
        ctx.fillStyle = textColor;
        ctx.font = "11px monospace";
        ctx.textAlign = "right";
        const truncName = row.name.length > 14 ? row.name.slice(0, 13) + "\u2026" : row.name;
        ctx.fillText(truncName, leftPad - 8, y + rowH / 2 + 4);

        // Bar
        ctx.fillStyle = row.color + "A6"; // 65% opacity
        ctx.beginPath();
        ctx.roundRect(barX, barY, barW, barH, 3);
        ctx.fill();
        ctx.strokeStyle = row.color;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Amortization diamonds
        if (row.amortMonths) {
          for (const am of row.amortMonths) {
            if (am < row.start || am > row.end) continue;
            const dx = leftPad + (am - 1) * unitW;
            const dy = y + rowH / 2;
            ctx.fillStyle = C.gold;
            ctx.beginPath();
            ctx.moveTo(dx, dy - 5);
            ctx.lineTo(dx + 4, dy);
            ctx.lineTo(dx, dy + 5);
            ctx.lineTo(dx - 4, dy);
            ctx.closePath();
            ctx.fill();
          }
        }

        y += rowH;
      }
    }

    // Bottom x-axis labels
    ctx.fillStyle = textColor;
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    for (let m = 0; m <= totalMonths; m += tickInterval) {
      const x = leftPad + m * unitW;
      const lbl = sd ? monthToShortDate(m + 1, sd) : `Mo ${m + 1}`;
      ctx.fillText(lbl, x, y + 16);
    }
  }, [sim, tab, timelineOpen, state.incomes, state.expenses, state.loans, state.config.startDate, ganttWidth]);

  // ── Pill button helper ──
  const pillBtn = (
    active: boolean,
    onClick: () => void,
    text: string
  ) => (
    <button
      onClick={onClick}
      class="rounded-md px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors"
      style={{
        background: active ? C.goldDim : "transparent",
        color: active ? C.goldLight : "var(--color-text-muted)",
        border: active ? `1px solid ${C.goldBorder}` : "1px solid transparent",
      }}
    >
      {text}
    </button>
  );

  // ── Gold button ──
  const goldButton = (onClick: () => void, text: string) => (
    <button
      onClick={onClick}
      class="w-full rounded-lg border border-dashed border-[var(--color-border)] px-3 py-2.5 font-mono text-xs uppercase tracking-wider transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/5"
      style={{ color: C.gold }}
    >
      + {text}
    </button>
  );

  // ── Edit button ──
  const editBtn = (onClick: () => void, isActive: boolean = false) => (
    <button
      onClick={onClick}
      class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] transition-colors"
      style={{
        borderColor: isActive ? C.gold : "var(--color-border)",
        color: isActive ? C.gold : "var(--color-text-muted)",
      }}
      title="Edit"
    >
      {"\u270E"}
    </button>
  );

  // ── Delete button ──
  const deleteBtn = (onClick: () => void) => (
    <button
      onClick={onClick}
      class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] transition-colors hover:border-red-500 hover:text-red-400"
    >
      x
    </button>
  );

  // ── Badge ──
  const badge = (text: string, colors: { color: string; bg: string; border: string }) => (
    <span
      class="shrink-0 rounded px-2 py-0.5 font-mono text-[10px]"
      style={{
        color: colors.color,
        background: colors.bg,
        border: `1px solid ${colors.border}`,
      }}
    >
      {text}
    </span>
  );

  // ── Render Tabs ──
  const TABS = [
    { key: "dashboard", label: "Dashboard" },
    { key: "accounts", label: "Accounts" },
    { key: "loans", label: "Loans" },
    { key: "income", label: "Income" },
    { key: "expenses", label: "Expenses" },
  ] as const;

  const renderConfigBar = () => (
    <div
      class="mb-4 flex flex-wrap items-center gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3"
    >
      <div class="flex items-center gap-2">
        <span class="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
          Start
        </span>
        <input
          type="month"
          value={state.config.startDate ? state.config.startDate.slice(0, 7) : ""}
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            setConfig({ startDate: v ? v + "-01" : "" });
          }}
          class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-light)] px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)]"
          style={{ colorScheme: "dark" }}
        />
      </div>
      <div class="flex items-center gap-2">
        <span class="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
          Horizon
        </span>
        <input
          type="range"
          min={1}
          max={30}
          value={state.config.horizonYears}
          onInput={(e) => setConfig({ horizonYears: Number((e.target as HTMLInputElement).value) })}
          class="h-1.5 w-28 cursor-pointer accent-[#d4a843]"
        />
        <span class="font-mono text-sm" style={{ color: C.goldLight }}>
          {state.config.horizonYears}yr
        </span>
      </div>
      <div class="flex items-center gap-2">
        <span class="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
          Inflation
        </span>
        <div class="w-20">
          {numInput(state.config.inflationRate, (v) => setConfig({ inflationRate: v }), {
            suffix: "%",
            min: 0,
            max: 20,
            step: 0.5,
          })}
        </div>
      </div>
    </div>
  );

  const toolbarBtn = (onClick: () => void, text: string, variant: "default" | "danger" = "default") => (
    <button
      onClick={onClick}
      class="rounded-md px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors"
      style={{
        color: variant === "danger" ? C.red : "var(--color-text-muted)",
        border: `1px solid ${variant === "danger" ? "rgba(224,92,106,0.25)" : "var(--color-border)"}`,
        background: "transparent",
      }}
    >
      {text}
    </button>
  );

  const renderToolbar = () => (
    <div class="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-2.5">
      <span class="mr-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
        Scenario
      </span>
      <select
        value=""
        onChange={(e) => {
          const v = (e.target as HTMLSelectElement).value;
          if (v) loadScenario(v);
          (e.target as HTMLSelectElement).value = "";
        }}
        class="cursor-pointer appearance-none rounded-md border border-[var(--color-border)] bg-[var(--color-surface-light)] px-2 py-1.5 pr-6 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%237d8590' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 6px center",
        }}
      >
        <option value="">Load...</option>
        {SCENARIOS.map((s) => (
          <option key={s.key} value={s.key}>{s.label}</option>
        ))}
      </select>

      <div class="mx-1 h-4 w-px bg-[var(--color-border)]" />

      {toolbarBtn(() => exportJSON(state), "Export JSON")}
      {toolbarBtn(() => exportCSV(sim, state.config.startDate), "Export CSV")}
      {toolbarBtn(() => fileInputRef.current?.click(), "Import JSON")}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleImport}
        class="hidden"
      />

      <div class="mx-1 h-4 w-px bg-[var(--color-border)]" />

      {toolbarBtn(() => loadScenario("empty"), "Clear All", "danger")}
    </div>
  );

  const renderTabs = () => (
    <div class="mb-4 flex gap-1 rounded-lg bg-[var(--color-bg)] p-0.5 overflow-x-auto">
      {TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => setTab(t.key)}
          class={`flex-1 min-w-[80px] rounded-md px-3 py-2 font-mono text-[11px] uppercase tracking-wider transition-colors ${
            tab === t.key
              ? "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
              : "border border-transparent text-[var(--color-text-muted)]"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  // ════════════════════════════════════════════════════════════════════
  // Dashboard Tab
  // ════════════════════════════════════════════════════════════════════

  const renderDashboard = () => (
    <div class="space-y-4">
      {/* KPIs */}
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <CardTitle>Financial Overview</CardTitle>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard
            label="Final Net Worth"
            value={fmtShort(sim.finalNetWorth)}
            sub={`in ${state.config.horizonYears} years`}
            color={sim.finalNetWorth >= 0 ? C.goldLight : C.red}
          />
          <StatCard
            label="Avg Monthly Cashflow"
            value={fmtShort(sim.avgMonthlyCashflow)}
            sub={sim.avgMonthlyCashflow >= 0 ? "surplus" : "deficit"}
            color={sim.avgMonthlyCashflow >= 0 ? C.green : C.red}
          />
          <StatCard
            label="Total Assets"
            value={fmtShort(sim.finalAssets)}
            sub="end of horizon"
            color={C.blue}
          />
          <StatCard
            label="Total Debt"
            value={fmtShort(sim.finalDebt)}
            sub="remaining"
            color={sim.finalDebt > 0 ? C.red : C.green}
          />
          <StatCard
            label="Debt-Free"
            value={sim.debtFreeMonth > 0
              ? (state.config.startDate
                ? monthToDate(sim.debtFreeMonth, state.config.startDate)
                : `Month ${sim.debtFreeMonth}`)
              : "N/A"}
            sub={sim.debtFreeMonth > 0 ? `Yr ${Math.ceil(sim.debtFreeMonth / 12)}` : state.loans.length === 0 ? "no loans" : "beyond horizon"}
            color={sim.debtFreeMonth > 0 ? C.green : C.muted}
          />
          <StatCard
            label="Interest Earned vs Paid"
            value={fmtShort(sim.totalInterestEarned)}
            sub={`paid: ${fmtShort(sim.totalInterestPaid)}`}
            color={sim.totalInterestEarned > sim.totalInterestPaid ? C.green : C.red}
          />
        </div>
      </div>

      {/* Chart */}
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <CardTitle>Projection</CardTitle>
        <div class="mb-4 flex flex-wrap items-center gap-1">
          {pillBtn(chartMode === "networth", () => setChartMode("networth"), "Net Worth")}
          {pillBtn(chartMode === "cashflow", () => setChartMode("cashflow"), "Cashflow")}
          {pillBtn(chartMode === "balances", () => setChartMode("balances"), "Balances")}
          {pillBtn(chartMode === "debt", () => setChartMode("debt"), "Debt Paydown")}
          <div class="mx-2 h-5 w-px bg-[var(--color-border)]" />
          {pillBtn(granularity === "yearly", () => setGranularity("yearly"), "Yearly")}
          {pillBtn(granularity === "quarterly", () => setGranularity("quarterly"), "Quarterly")}
          {pillBtn(granularity === "monthly", () => setGranularity("monthly"), "Monthly")}
        </div>
        <div style={{ height: "360px", position: "relative" }}>
          <canvas ref={chartRef} />
        </div>
      </div>

      {/* Event Timeline */}
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div class="flex items-center justify-between">
          <CardTitle>Event Timeline</CardTitle>
          <button
            onClick={() => setTimelineOpen(!timelineOpen)}
            class="font-mono text-[10px] uppercase tracking-wider transition-colors"
            style={{ color: C.gold }}
          >
            {timelineOpen ? "Collapse" : "Expand"}
          </button>
        </div>
        {timelineOpen ? (
          <div ref={ganttContainerRef} class="overflow-x-auto">
            <canvas ref={ganttCanvasRef} class="w-full" />
          </div>
        ) : (
          <div class="font-mono text-[10px] text-[var(--color-text-muted)]">
            Timeline showing active periods for income, expenses, and loans. Click expand to view.
          </div>
        )}
      </div>

      {/* Annual Summary */}
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div class="flex items-center justify-between">
          <CardTitle>Annual Summary</CardTitle>
          <button
            onClick={() => setTableOpen(!tableOpen)}
            class="font-mono text-[10px] uppercase tracking-wider transition-colors"
            style={{ color: C.gold }}
          >
            {tableOpen ? "Collapse" : "Expand"}
          </button>
        </div>
        {tableOpen && (
          <div class="overflow-x-auto">
            <table class="w-full font-mono text-xs">
              <thead>
                <tr style={{ borderBottom: `1px solid var(--color-border)` }}>
                  {["Year", "Income", "Expenses", "Loan Pmts", "Int. Earned", "Int. Paid", "Assets", "Debt", "Net Worth"].map(h => (
                    <th
                      key={h}
                      class="px-2 py-2 text-left font-mono text-[9px] uppercase tracking-wider text-[var(--color-text-muted)]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sim.yearSummaries.map((ys) => (
                  <tr
                    key={ys.year}
                    class="border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-bg)]"
                  >
                    <td class="px-2 py-1.5" style={{ color: C.goldLight }}>
                      {state.config.startDate
                        ? monthToShortDate(ys.year * 12, state.config.startDate)
                        : `Yr ${ys.year}`}
                    </td>
                    <td class="px-2 py-1.5" style={{ color: C.green }}>{fmtShort(ys.totalIncome)}</td>
                    <td class="px-2 py-1.5" style={{ color: C.red }}>{fmtShort(ys.totalExpenses)}</td>
                    <td class="px-2 py-1.5">{fmtShort(ys.totalLoanPayments)}</td>
                    <td class="px-2 py-1.5" style={{ color: C.green }}>{fmtShort(ys.interestEarned)}</td>
                    <td class="px-2 py-1.5" style={{ color: C.red }}>{fmtShort(ys.interestPaid)}</td>
                    <td class="px-2 py-1.5" style={{ color: C.blue }}>{fmtShort(ys.endAssets)}</td>
                    <td class="px-2 py-1.5" style={{ color: ys.endDebt > 0 ? C.red : C.green }}>{fmtShort(ys.endDebt)}</td>
                    <td class="px-2 py-1.5 font-medium" style={{ color: ys.endNetWorth >= 0 ? C.goldLight : C.red }}>{fmtShort(ys.endNetWorth)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!tableOpen && sim.yearSummaries.length > 0 && (
          <div class="font-mono text-[10px] text-[var(--color-text-muted)]">
            {sim.yearSummaries.length} years of data. Click expand to view.
          </div>
        )}
      </div>

      {/* Alerts */}
      {sim.alerts.length > 0 && (
        <div
          class="rounded-xl border p-4"
          style={{ borderColor: "rgba(224,92,106,0.3)", background: "rgba(224,92,106,0.06)" }}
        >
          <div
            class="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em]"
            style={{ color: C.red }}
          >
            <span class="inline-block h-1.5 w-1.5 rounded-full" style={{ background: C.red }} />
            Alerts
          </div>
          <ul class="space-y-1">
            {sim.alerts.map((a, i) => (
              <li key={i} class="font-mono text-xs text-[var(--color-text-muted)]">
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  // ════════════════════════════════════════════════════════════════════
  // Accounts Tab
  // ════════════════════════════════════════════════════════════════════

  const renderAccounts = () => (
    <div class="grid grid-cols-1 items-start gap-5 lg:grid-cols-[380px_1fr]">
      {/* Left: form + list */}
      <div class="space-y-4">
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <CardTitle>{editingAccountId !== null ? "Edit Account" : "Add Account"}</CardTitle>
          <div class="mb-3">
            {label("Account Name")}
            {textInput(accName, setAccName)}
          </div>
          <div class="mb-3">
            {label("Type")}
            {selectInput(accType, (v) => setAccType(v as AccountType), [
              { value: "checking", label: "Checking" },
              { value: "savings", label: "Savings" },
              { value: "investment", label: "Investment" },
              { value: "retirement", label: "Retirement" },
            ])}
          </div>
          <div class="mb-3 grid grid-cols-2 gap-3">
            <div>
              {label("Initial Balance")}
              {numInput(accBalance, setAccBalance, { prefix: "$", min: 0, step: 1000 })}
            </div>
            <div>
              {label("Annual Rate")}
              {numInput(accRate, setAccRate, { suffix: "%", min: 0, max: 50, step: 0.25 })}
            </div>
          </div>
          <div class="mb-4">
            {label("Compound Interval")}
            {selectInput(accCompound, (v) => setAccCompound(v as CompoundInterval), [
              { value: "daily", label: "Daily" },
              { value: "monthly", label: "Monthly" },
              { value: "quarterly", label: "Quarterly" },
              { value: "annually", label: "Annually" },
            ])}
          </div>
          {editingAccountId !== null ? (
            <div class="flex gap-2">
              {goldButton(saveAccount, "Save Changes")}
              <button onClick={cancelEditAccount} class="w-full rounded-lg border border-[var(--color-border)] px-3 py-2.5 font-mono text-xs uppercase tracking-wider text-[var(--color-text-muted)] transition-colors hover:border-red-500 hover:text-red-400">
                Cancel
              </button>
            </div>
          ) : goldButton(saveAccount, "Add Account")}
        </div>

        {/* Account list */}
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <CardTitle>Your Accounts</CardTitle>
          <div class="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {state.accounts.length === 0 ? (
              <p class="py-3 text-center font-mono text-xs text-[var(--color-text-muted)]">
                No accounts yet. Add one above.
              </p>
            ) : (
              state.accounts.map((a) => {
                const tc = ACCOUNT_TYPE_COLORS[a.type];
                return (
                  <div
                    key={a.id}
                    class="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2"
                  >
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="truncate font-mono text-sm text-[var(--color-text)]">
                          {a.name}
                        </span>
                        {badge(a.type, tc)}
                      </div>
                      <div class="mt-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
                        {fmtM(a.balance)} | {fmtPct(a.annualRate)} | {a.compoundInterval}
                      </div>
                    </div>
                    {editBtn(() => startEditAccount(a), editingAccountId === a.id)}
                    {deleteBtn(() => removeAccount(a.id))}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Right: summary */}
      <div class="space-y-4">
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <CardTitle>Account Summary</CardTitle>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
              label="Total Balance"
              value={fmtM(totalAccountBalance)}
              color={C.goldLight}
            />
            <StatCard
              label="Monthly Interest"
              value={fmtM(monthlyInterestFromAccounts)}
              sub="estimated"
              color={C.green}
            />
            <StatCard
              label="Accounts"
              value={String(state.accounts.length)}
              sub={`${state.accounts.filter(a => a.type === "checking").length} checking, ${state.accounts.filter(a => a.type === "savings").length} savings, ${state.accounts.filter(a => a.type === "investment").length} invest., ${state.accounts.filter(a => a.type === "retirement").length} retire.`}
            />
          </div>
        </div>
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <CardTitle>Balance Projection</CardTitle>
          <div class="mb-3 flex flex-wrap gap-1">
            {pillBtn(granularity === "yearly", () => setGranularity("yearly"), "Yearly")}
            {pillBtn(granularity === "quarterly", () => setGranularity("quarterly"), "Quarterly")}
            {pillBtn(granularity === "monthly", () => setGranularity("monthly"), "Monthly")}
          </div>
          <div style={{ height: "280px", position: "relative" }}>
            <canvas ref={tabChartRef} />
          </div>
        </div>
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════════════
  // Loans Tab
  // ════════════════════════════════════════════════════════════════════

  const renderLoans = () => (
    <div class="grid grid-cols-1 items-start gap-5 lg:grid-cols-[380px_1fr]">
      {/* Left: form + list */}
      <div class="space-y-4">
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <CardTitle>{editingLoanId !== null ? "Edit Loan" : "Add Loan"}</CardTitle>
          <div class="mb-3">
            {label("Loan Name")}
            {textInput(loanName, setLoanName)}
          </div>
          <div class="mb-3">
            {label("Type")}
            {selectInput(loanType, (v) => setLoanType(v as LoanType), [
              { value: "mortgage", label: "Mortgage" },
              { value: "auto", label: "Auto" },
              { value: "personal", label: "Personal" },
              { value: "credit-card", label: "Credit Card" },
            ])}
          </div>
          <div class="mb-3 grid grid-cols-2 gap-3">
            <div>
              {label("Original Principal")}
              {numInput(loanPrincipal, setLoanPrincipal, { prefix: "$", min: 0, step: 10000 })}
            </div>
            <div>
              {label("Current Balance")}
              {numInput(loanBalance, setLoanBalance, { prefix: "$", min: 0, step: 10000 })}
            </div>
          </div>
          <div class="mb-3 grid grid-cols-2 gap-3">
            <div>
              {label("Annual Rate")}
              {numInput(loanRate, setLoanRate, { suffix: "%", min: 0, max: 100, step: 0.25 })}
            </div>
            <div>
              {label("Term (months)")}
              {numInput(loanTerm, setLoanTerm, { suffix: "mo", min: 1, max: 600, step: 1 })}
            </div>
          </div>
          <div class="mb-3 grid grid-cols-2 gap-3">
            <div>
              {label("Payment Interval")}
              {selectInput(loanInterval, (v) => setLoanInterval(v as "monthly" | "biweekly"), [
                { value: "monthly", label: "Monthly" },
                { value: "biweekly", label: "Biweekly" },
              ])}
            </div>
            <div>
              {label("Start Month")}
              {numInput(loanStart, setLoanStart, { min: 1, max: 360, step: 1 })}
            </div>
          </div>
          {editingLoanId !== null ? (
            <div class="flex gap-2">
              {goldButton(saveLoan, "Save Changes")}
              <button onClick={cancelEditLoan} class="w-full rounded-lg border border-[var(--color-border)] px-3 py-2.5 font-mono text-xs uppercase tracking-wider text-[var(--color-text-muted)] transition-colors hover:border-red-500 hover:text-red-400">
                Cancel
              </button>
            </div>
          ) : goldButton(saveLoan, "Add Loan")}
        </div>

        {/* Loan list */}
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <CardTitle>Your Loans</CardTitle>
          <div class="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {state.loans.length === 0 ? (
              <p class="py-3 text-center font-mono text-xs text-[var(--color-text-muted)]">
                No loans yet. Add one above.
              </p>
            ) : (
              state.loans.map((l) => {
                const tc = LOAN_TYPE_COLORS[l.type];
                const r = l.annualRate / 100 / 12;
                const pmt = calcLoanPayment(l.currentBalance, r, l.termMonths);
                return (
                  <div key={l.id} class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
                    <div class="flex items-center gap-2">
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                          <span class="truncate font-mono text-sm text-[var(--color-text)]">
                            {l.name}
                          </span>
                          {badge(l.type, tc)}
                        </div>
                        <div class="mt-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
                          Bal: {fmtM(l.currentBalance)} | {fmtPct(l.annualRate)} | Pmt: {fmtM(pmt)} | {l.termMonths}mo | {l.paymentInterval}
                        </div>
                      </div>
                      {editBtn(() => startEditLoan(l), editingLoanId === l.id)}
                      {deleteBtn(() => removeLoan(l.id))}
                    </div>
                    {/* Amortizations for this loan */}
                    {l.amortizations.length > 0 && (
                      <div class="mt-2 space-y-1 border-t border-[var(--color-border)] pt-2">
                        {l.amortizations.map((a) => (
                          <div key={a.id} class="flex items-center justify-between">
                            <span class="font-mono text-[10px] text-[var(--color-text-muted)]">
                              {a.type === "one-time"
                                ? `${fmtM(a.amount)} at mo ${a.month}`
                                : `${fmtM(a.amount)} every ${a.frequency}mo from mo ${a.startMonth}${a.endMonth ? ` to ${a.endMonth}` : ""}`}
                              {" "}
                              <span style={{ color: a.effect === "reduce-term" ? C.blue : C.green }}>
                                [{a.effect === "reduce-term" ? "term" : "payment"}]
                              </span>
                            </span>
                            <button
                              onClick={() => removeAmortization(l.id, a.id)}
                              class="ml-2 font-mono text-[10px] text-[var(--color-text-muted)] transition-colors hover:text-red-400"
                            >
                              x
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Extra payments / amortization form */}
        {state.loans.length > 0 && (
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <CardTitle>Extra Payments / Amortization</CardTitle>
            <div class="mb-3">
              {label("Loan")}
              {selectInput(
                String(amortLoanId || state.loans[0]?.id || 0),
                (v) => setAmortLoanId(Number(v)),
                state.loans.map((l) => ({ value: String(l.id), label: l.name }))
              )}
            </div>
            <div class="mb-3 grid grid-cols-2 gap-3">
              <div>
                {label("Type")}
                {selectInput(amortType, (v) => setAmortType(v as "one-time" | "periodic"), [
                  { value: "one-time", label: "One-time" },
                  { value: "periodic", label: "Periodic" },
                ])}
              </div>
              <div>
                {label("Effect")}
                {selectInput(amortEffect, (v) => setAmortEffect(v as "reduce-term" | "reduce-payment"), [
                  { value: "reduce-term", label: "Reduce Term" },
                  { value: "reduce-payment", label: "Reduce Payment" },
                ])}
              </div>
            </div>
            <div class="mb-3">
              {label("Amount")}
              {numInput(amortAmount, setAmortAmount, { prefix: "$", min: 0, step: 5000 })}
            </div>
            {amortType === "one-time" ? (
              <div class="mb-4">
                {label("Month")}
                {numInput(amortMonth, setAmortMonth, { min: 1, max: 360, step: 1 })}
              </div>
            ) : (
              <div class="mb-4 grid grid-cols-3 gap-3">
                <div>
                  {label("Start Month")}
                  {numInput(amortStartMonth, setAmortStartMonth, { min: 1, max: 360, step: 1 })}
                </div>
                <div>
                  {label("End (0 = loan end)")}
                  {numInput(amortEndMonth, setAmortEndMonth, { min: 0, max: 360, step: 1 })}
                </div>
                <div>
                  {label("Every N months")}
                  {numInput(amortFrequency, setAmortFrequency, { min: 1, max: 60, step: 1 })}
                </div>
              </div>
            )}
            {goldButton(addAmortization, "Add Extra Payment")}
          </div>
        )}
      </div>

      {/* Right: summary */}
      <div class="space-y-4">
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <CardTitle>Loan Summary</CardTitle>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
              label="Total Debt"
              value={fmtM(totalDebt)}
              color={totalDebt > 0 ? C.red : C.green}
            />
            <StatCard
              label="Monthly Payments"
              value={fmtM(totalMonthlyLoanPayments)}
              sub="all loans combined"
              color={C.goldLight}
            />
            <StatCard
              label="Total Interest Over Life"
              value={fmtM(totalInterestOverLife)}
              sub="if paid to term"
              color={C.red}
            />
          </div>
        </div>
        {state.loans.some(l => l.amortizations.length > 0) && (
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <CardTitle>Amortization Impact</CardTitle>
            <div class="space-y-2">
              <div class="flex justify-between font-mono text-xs">
                <span class="text-[var(--color-text-muted)]">Total Interest Paid (projected)</span>
                <span style={{ color: C.red }}>{fmtM(sim.totalInterestPaid)}</span>
              </div>
              {sim.debtFreeMonth > 0 && (
                <div class="flex justify-between font-mono text-xs">
                  <span class="text-[var(--color-text-muted)]">Debt-Free</span>
                  <span style={{ color: C.green }}>
                    {state.config.startDate
                      ? monthToDate(sim.debtFreeMonth, state.config.startDate)
                      : `Month ${sim.debtFreeMonth}`}
                  </span>
                </div>
              )}
              <p class="mt-2 font-mono text-[10px] text-[var(--color-text-muted)]">
                <span style={{ color: C.blue }}>Reduce Term</span> = keep same payment, pay off faster.{" "}
                <span style={{ color: C.green }}>Reduce Payment</span> = lower monthly payment, same term.
              </p>
            </div>
          </div>
        )}
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <CardTitle>Debt Paydown Projection</CardTitle>
          <div class="mb-3 flex flex-wrap gap-1">
            {pillBtn(granularity === "yearly", () => setGranularity("yearly"), "Yearly")}
            {pillBtn(granularity === "quarterly", () => setGranularity("quarterly"), "Quarterly")}
            {pillBtn(granularity === "monthly", () => setGranularity("monthly"), "Monthly")}
          </div>
          <div style={{ height: "280px", position: "relative" }}>
            <canvas ref={tabChartRef} />
          </div>
        </div>
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════════════
  // Income Tab
  // ════════════════════════════════════════════════════════════════════

  const renderIncome = () => (
    <div class="grid grid-cols-1 items-start gap-5 lg:grid-cols-[380px_1fr]">
      {/* Left: form + list */}
      <div class="space-y-4">
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <CardTitle>{editingIncomeId !== null ? "Edit Income" : "Add Income"}</CardTitle>
          <div class="mb-3">
            {label("Source Name")}
            {textInput(incName, setIncName)}
          </div>
          <div class="mb-3 grid grid-cols-2 gap-3">
            <div>
              {label("Amount")}
              {numInput(incAmount, setIncAmount, { prefix: "$", min: 0, step: 500 })}
            </div>
            <div>
              {label("Periodicity")}
              {selectInput(incPeriodicity, (v) => setIncPeriodicity(v as IncomePeriodicity), [
                { value: "monthly", label: "Monthly" },
                { value: "biweekly", label: "Biweekly" },
                { value: "weekly", label: "Weekly" },
                { value: "annually", label: "Annually" },
                { value: "every-n-months", label: "Every N months" },
                { value: "one-time", label: "One-time" },
              ])}
            </div>
          </div>
          {incPeriodicity === "every-n-months" && (
            <div class="mb-3">
              {label("Every N months")}
              {numInput(incFreqMonths, setIncFreqMonths, { suffix: "mo", min: 2, max: 60, step: 1 })}
            </div>
          )}
          {incPeriodicity !== "one-time" && (
            <div class="mb-3">
              {label("Annual Growth Rate")}
              {numInput(incGrowth, setIncGrowth, { suffix: "%", min: 0, max: 50, step: 0.5 })}
            </div>
          )}
          {(incPeriodicity === "monthly" || incPeriodicity === "biweekly" || incPeriodicity === "weekly") && (
            <div class="mb-3 grid grid-cols-2 gap-3">
              <div>
                {label("Bonus Month")}
                {selectInput(String(incBonusMonth), (v) => setIncBonusMonth(Number(v)),
                  MONTH_NAMES.map((m, i) => ({ value: String(i), label: m }))
                )}
              </div>
              <div>
                {label("Bonus Amount")}
                {numInput(incBonusAmount, setIncBonusAmount, { prefix: "$", min: 0, step: 1000 })}
              </div>
            </div>
          )}
          <div class="mb-4 grid grid-cols-2 gap-3">
            <div>
              {label(incPeriodicity === "one-time" ? "Month" : "Start Month")}
              {numInput(incStart, setIncStart, { min: 1, max: 360, step: 1 })}
            </div>
            {incPeriodicity !== "one-time" && (
              <div>
                {label("End Month (0 = indefinite)")}
                {numInput(incEnd, setIncEnd, { min: 0, max: 360, step: 1 })}
              </div>
            )}
          </div>
          {editingIncomeId !== null ? (
            <div class="flex gap-2">
              {goldButton(saveIncome, "Save Changes")}
              <button onClick={cancelEditIncome} class="w-full rounded-lg border border-[var(--color-border)] px-3 py-2.5 font-mono text-xs uppercase tracking-wider text-[var(--color-text-muted)] transition-colors hover:border-red-500 hover:text-red-400">
                Cancel
              </button>
            </div>
          ) : goldButton(saveIncome, "Add Income")}
        </div>

        {/* Income list */}
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <CardTitle>Your Income Sources</CardTitle>
          <div class="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {state.incomes.length === 0 ? (
              <p class="py-3 text-center font-mono text-xs text-[var(--color-text-muted)]">
                No income sources yet. Add one above.
              </p>
            ) : (
              state.incomes.map((inc) => (
                <div
                  key={inc.id}
                  class="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2"
                >
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span class="truncate font-mono text-sm text-[var(--color-text)]">
                        {inc.name}
                      </span>
                      {badge(
                        inc.periodicity === "every-n-months" ? `every ${inc.frequencyMonths || 3}mo` : inc.periodicity,
                        { color: C.green, bg: C.greenDim, border: C.greenBorder }
                      )}
                    </div>
                    <div class="mt-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
                      {fmtM(inc.amount)}/{inc.periodicity === "every-n-months" ? `${inc.frequencyMonths || 3}mo` : inc.periodicity}
                      {inc.periodicity === "one-time" ? ` at month ${inc.startMonth}` : ""}
                      {inc.periodicity !== "one-time" && inc.growthRate > 0 ? ` | Growth: ${fmtPct(inc.growthRate)}` : ""}
                      {inc.bonusMonth > 0 ? ` | Bonus: ${fmtM(inc.bonusAmount)} in ${MONTH_NAMES[inc.bonusMonth]}` : ""}
                      {inc.periodicity !== "one-time" && inc.endMonth > 0 ? ` | Ends mo ${inc.endMonth}` : ""}
                    </div>
                  </div>
                  {editBtn(() => startEditIncome(inc), editingIncomeId === inc.id)}
                  {deleteBtn(() => removeIncome(inc.id))}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Right: summary */}
      <div class="space-y-4">
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <CardTitle>Income Summary</CardTitle>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <StatCard
              label="Total Monthly Income"
              value={fmtM(totalMonthlyIncome)}
              sub="before growth"
              color={C.green}
            />
            <StatCard
              label="Annual Gross Income"
              value={fmtM(annualGrossIncome)}
              sub="including bonuses"
              color={C.goldLight}
            />
          </div>
        </div>
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <CardTitle>Income Trajectory</CardTitle>
          <div class="mb-3 flex flex-wrap gap-1">
            {pillBtn(granularity === "yearly", () => setGranularity("yearly"), "Yearly")}
            {pillBtn(granularity === "quarterly", () => setGranularity("quarterly"), "Quarterly")}
            {pillBtn(granularity === "monthly", () => setGranularity("monthly"), "Monthly")}
          </div>
          <div style={{ height: "280px", position: "relative" }}>
            <canvas ref={tabChartRef} />
          </div>
        </div>
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════════════
  // Expenses Tab
  // ════════════════════════════════════════════════════════════════════

  const renderExpenses = () => (
    <div class="grid grid-cols-1 items-start gap-5 lg:grid-cols-[380px_1fr]">
      {/* Left: form + list */}
      <div class="space-y-4">
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <CardTitle>{editingExpenseId !== null ? "Edit Expense" : "Add Expense"}</CardTitle>
          <div class="mb-3">
            {label("Expense Name")}
            {textInput(expName, setExpName)}
          </div>
          <div class="mb-3 grid grid-cols-2 gap-3">
            <div>
              {label("Amount")}
              {numInput(expAmount, setExpAmount, { prefix: "$", min: 0, step: 100 })}
            </div>
            <div>
              {label("Frequency")}
              {selectInput(expFreq, (v) => setExpFreq(v as Expense["frequency"]), [
                { value: "monthly", label: "Monthly" },
                { value: "quarterly", label: "Quarterly" },
                { value: "every-n-months", label: "Every N months" },
                { value: "annually", label: "Annually" },
                { value: "one-time", label: "One-time" },
              ])}
            </div>
          </div>
          {expFreq === "every-n-months" && (
            <div class="mb-3">
              {label("Every N months")}
              {numInput(expFreqMonths, setExpFreqMonths, { suffix: "mo", min: 2, max: 60, step: 1 })}
            </div>
          )}
          <div class="mb-3">
            {label("Category")}
            {selectInput(expCategory, setExpCategory, [
              { value: "housing", label: "Housing" },
              { value: "transport", label: "Transport" },
              { value: "food", label: "Food" },
              { value: "utilities", label: "Utilities" },
              { value: "insurance", label: "Insurance" },
              { value: "entertainment", label: "Entertainment" },
              { value: "education", label: "Education" },
              { value: "health", label: "Health" },
              { value: "subscriptions", label: "Subscriptions" },
              { value: "other", label: "Other" },
            ])}
          </div>
          <div class="mb-3 flex items-center gap-2">
            <input
              type="checkbox"
              checked={expInflation}
              onInput={(e) => setExpInflation((e.target as HTMLInputElement).checked)}
              class="h-4 w-4 rounded border-[var(--color-border)] accent-[#d4a843]"
            />
            <span class="font-mono text-xs text-[var(--color-text-muted)]">
              Inflation-adjusted
            </span>
          </div>
          <div class="mb-4 grid grid-cols-2 gap-3">
            <div>
              {label("Start Month")}
              {numInput(expStart, setExpStart, { min: 1, max: 360, step: 1 })}
            </div>
            <div>
              {label("End Month (0 = indefinite)")}
              {numInput(expEnd, setExpEnd, { min: 0, max: 360, step: 1 })}
            </div>
          </div>
          {editingExpenseId !== null ? (
            <div class="flex gap-2">
              {goldButton(saveExpense, "Save Changes")}
              <button onClick={cancelEditExpense} class="w-full rounded-lg border border-[var(--color-border)] px-3 py-2.5 font-mono text-xs uppercase tracking-wider text-[var(--color-text-muted)] transition-colors hover:border-red-500 hover:text-red-400">
                Cancel
              </button>
            </div>
          ) : goldButton(saveExpense, "Add Expense")}
        </div>

        {/* Expense list */}
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <CardTitle>Your Expenses</CardTitle>
          <div class="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {state.expenses.length === 0 ? (
              <p class="py-3 text-center font-mono text-xs text-[var(--color-text-muted)]">
                No expenses yet. Add one above.
              </p>
            ) : (
              state.expenses.map((exp) => {
                const cc = CATEGORY_COLORS[exp.category] || CATEGORY_COLORS.other;
                return (
                  <div
                    key={exp.id}
                    class="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2"
                  >
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="truncate font-mono text-sm text-[var(--color-text)]">
                          {exp.name}
                        </span>
                        {badge(exp.category, cc)}
                        {exp.inflationAdjusted && (
                          <span class="font-mono text-[9px] text-[var(--color-text-muted)]" title="Inflation-adjusted">
                            INF
                          </span>
                        )}
                      </div>
                      <div class="mt-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
                        {fmtM(exp.amount)} / {exp.frequency === "every-n-months" ? `every ${exp.frequencyMonths || 3}mo` : exp.frequency}
                        {exp.endMonth > 0 ? ` | Ends month ${exp.endMonth}` : ""}
                      </div>
                    </div>
                    {editBtn(() => startEditExpense(exp), editingExpenseId === exp.id)}
                    {deleteBtn(() => removeExpense(exp.id))}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Right: summary */}
      <div class="space-y-4">
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <CardTitle>Expense Summary</CardTitle>
          <div class="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <StatCard
              label="Total Monthly Expenses"
              value={fmtM(totalMonthlyExpenses)}
              sub="recurring only"
              color={C.red}
            />
            <StatCard
              label="Annual Expenses"
              value={fmtM(totalMonthlyExpenses * 12)}
              sub="estimated"
              color={C.goldLight}
            />
          </div>

          {/* Category breakdown */}
          {expensesByCategory.length > 0 && (
            <>
              <CardTitle>Breakdown by Category</CardTitle>
              <div class="space-y-2">
                {expensesByCategory.map(([cat, amt]) => {
                  const cc = CATEGORY_COLORS[cat] || CATEGORY_COLORS.other;
                  const pct = totalMonthlyExpenses > 0 ? (amt / totalMonthlyExpenses) * 100 : 0;
                  return (
                    <div key={cat} class="flex items-center gap-3">
                      <div class="w-20">
                        {badge(cat, cc)}
                      </div>
                      <div class="flex-1">
                        <div
                          class="h-2 rounded-full"
                          style={{ background: "var(--color-bg)" }}
                        >
                          <div
                            class="h-2 rounded-full transition-all"
                            style={{
                              width: `${Math.min(pct, 100)}%`,
                              background: cc.color,
                              opacity: 0.7,
                            }}
                          />
                        </div>
                      </div>
                      <span class="w-16 text-right font-mono text-xs text-[var(--color-text)]">
                        {fmtM(amt)}
                      </span>
                      <span class="w-10 text-right font-mono text-[10px] text-[var(--color-text-muted)]">
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <CardTitle>Expense Trajectory</CardTitle>
          <div class="mb-3 flex flex-wrap gap-1">
            {pillBtn(granularity === "yearly", () => setGranularity("yearly"), "Yearly")}
            {pillBtn(granularity === "quarterly", () => setGranularity("quarterly"), "Quarterly")}
            {pillBtn(granularity === "monthly", () => setGranularity("monthly"), "Monthly")}
          </div>
          <div style={{ height: "280px", position: "relative" }}>
            <canvas ref={tabChartRef} />
          </div>
        </div>
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════════════
  // Main Render
  // ════════════════════════════════════════════════════════════════════

  return (
    <div class="space-y-0">
      {renderConfigBar()}
      {renderToolbar()}
      {renderTabs()}
      {tab === "dashboard" && renderDashboard()}
      {tab === "accounts" && renderAccounts()}
      {tab === "loans" && renderLoans()}
      {tab === "income" && renderIncome()}
      {tab === "expenses" && renderExpenses()}
    </div>
  );
}
