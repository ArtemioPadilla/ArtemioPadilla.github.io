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
import {
  calcNetMonthlyIsr,
  calcAguinaldoTax,
  calcPtuTax,
  calcMonthlyIsr,
  DEFAULT_UMA_DIARIO,
} from "../shared/mexican-tax";
import {
  projectPayoff,
  type PayoffProjection,
} from "../shared/payoff-projection";
import SankeyChart from "./SankeyChart";

Chart.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  LineController, Filler, Legend, Tooltip
);

// ─── Types ────────────────────────────────────────────────────────────

type AccountType = "checking" | "savings" | "investment" | "retirement";
type CompoundInterval = "daily" | "monthly" | "quarterly" | "annually";
type LoanType = "mortgage" | "auto" | "personal" | "credit-card";
type AssetType = "property" | "vehicle" | "other";
type IncomePeriodicity = "weekly" | "biweekly" | "monthly" | "annually" | "one-time" | "every-n-months";
type ExpenseFrequency = "monthly" | "quarterly" | "annually" | "one-time" | "every-n-months";

interface Account {
  id: number; name: string; type: AccountType;
  balance: number; annualRate: number; compoundInterval: CompoundInterval;
  ownerId?: number;
}

interface LoanRefinance {
  month: number;
  newRate: number;       // annual %
  newTermMonths: number;
  cost: number;          // one-time refinancing fee
}

interface Loan {
  id: number; name: string; type: LoanType;
  principal: number; currentBalance: number; annualRate: number;
  termMonths: number; paymentInterval: "monthly" | "biweekly"; startMonth: number;
  disbursementMonth?: number; // when cash is received (personal/credit-card); defaults to startMonth
  amortizations: LoanAmortization[];
  ownerId?: number;
  refinance?: LoanRefinance;
}

type TaxCategory = "salary" | "aguinaldo" | "ptu" | "bonus" | "exempt";

interface Income {
  id: number; name: string; amount: number;
  periodicity: IncomePeriodicity; frequencyMonths: number;
  growthRate: number; bonusMonth: number; bonusAmount: number;
  startMonth: number; endMonth: number;
  ownerId?: number;
  taxCategory?: TaxCategory;
  calendarMonth?: number; // 1-12; if set, annually fires on this calendar month
}

interface Expense {
  id: number; name: string; amount: number;
  frequency: ExpenseFrequency; frequencyMonths: number;
  category: string; inflationAdjusted: boolean;
  startMonth: number; endMonth: number;
  split?: ExpenseSplit;
  calendarMonth?: number; // 1-12; if set, annually fires on this calendar month
}

interface Asset {
  id: number; name: string; type: AssetType;
  value: number; annualAppreciation: number; startMonth: number;
}

interface WaterfallStep {
  id: number;
  type: "fill-account" | "pay-debt";
  accountId?: number;
  targetBalance?: number; // 0 = unlimited (fill-account)
  debtStrategy?: "highest-rate" | "lowest-balance"; // for pay-debt
}

interface Milestone {
  month: number; label: string; color: string;
}

interface SimConfig { horizonYears: number; inflationRate: number; startDate: string; umaAnnual?: number; art185AnnualCap?: number; taxEnabled?: boolean; umaDiario?: number; }

interface FinanceState {
  accounts: Account[]; loans: Loan[]; incomes: Income[]; expenses: Expense[];
  assets: Asset[];
  pprs: PPR[];
  config: SimConfig; nextId: number;
  participants?: Participant[];
  waterfall?: WaterfallStep[];
}

interface MonthRow {
  month: number; year: number;
  totalIncome: number; totalExpenses: number;
  totalLoanPayments: number; totalLoanDisbursements: number;
  totalInterestPaid: number; totalPrincipalPaid: number;
  totalInterestEarned: number; netCashflow: number;
  accountBalances: Record<number, number>; loanBalances: Record<number, number>;
  incomeBySource: Record<number, number>; expenseBySource: Record<number, number>;
  loanPaymentBySource: Record<number, number>;
  assetValues: Record<number, number>; totalAssetValue: number;
  totalAssets: number; totalDebt: number; netWorth: number;
  incomeByParticipant?: Record<number, number>;
  expenseByParticipant?: Record<number, number>;
  loanPaymentByParticipant?: Record<number, number>;
  contributionByParticipant?: Record<number, number>;
  pprBalances?: Record<number, { art151: number; art185: number }>;
  pprContributions?: Record<number, number>;
  pprRefunds?: Record<number, number>;
  pprInterestEarned?: Record<number, number>;
  totalPPRBalance?: number;
  totalPPRContributions?: number;
  totalPPRRefunds?: number;
  totalTaxPaid?: number;
  waterfallDebtPaidByLoan?: Record<number, number>;
}

interface YearSummary {
  year: number; totalIncome: number; totalExpenses: number;
  totalLoanPayments: number; totalLoanDisbursements: number;
  interestEarned: number; interestPaid: number;
  netCashflow: number; endAssets: number; endDebt: number; endNetWorth: number;
  totalTaxPaid?: number;
}

interface SimulationResult {
  months: MonthRow[]; yearSummaries: YearSummary[];
  finalNetWorth: number; finalAssets: number; finalDebt: number;
  totalInterestEarned: number; totalInterestPaid: number;
  avgMonthlyCashflow: number; debtFreeMonth: number;
  peakStressMonth: number;
  peakStressBalance: number;
  overdraftMonths: number;
  peakDti: number;
  peakDtiMonth: number;
  alerts: string[];
  loanPayoffProjections: PayoffProjection[];
}

type SplitMode = "owner" | "equal" | "proportional" | "custom";

interface Participant {
  id: number;
  name: string;
  color: string;
}

interface ExpenseSplit {
  mode: SplitMode;
  participantIds: number[];
  customShares?: Record<number, number>;
}

interface PPR {
  id: number;
  name: string;
  ownerId?: number;
  monthlyArt151: number;
  monthlyArt185: number;
  annualReturnRate: number;
  compoundInterval: CompoundInterval;
  isrRate: number;
  otherArt151Deductions: number;
  startMonth: number;
  endMonth: number;
  refundMonth: number;
  initialBalance151: number;
  initialBalance185: number;
}

interface ComparisonScenario {
  name: string;
  state: FinanceState;
  sim: SimulationResult;
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

const PARTICIPANT_COLORS = ["#4a9eff", "#ec4899", "#a855f7", "#f59e0b", "#06b6d4"];

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

const ASSET_TYPE_COLORS: Record<AssetType, { color: string; bg: string; border: string }> = {
  property: { color: C.gold,   bg: C.goldDim,   border: C.goldBorder },
  vehicle:  { color: C.orange, bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.25)" },
  other:    { color: C.cyan,   bg: "rgba(6,182,212,0.15)",  border: "rgba(6,182,212,0.25)" },
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

// ─── Participant Helpers ──────────────────────────────────────────────

function resolveParticipants(state: FinanceState): Participant[] {
  if (state.participants && state.participants.length > 0) return state.participants;
  return [{ id: 0, name: "Me", color: PARTICIPANT_COLORS[0] }];
}

function getOwnerParticipant(ownerId: number | undefined, participants: Participant[]): number {
  if (ownerId != null && participants.some(p => p.id === ownerId)) return ownerId;
  return participants[0].id;
}

function computeExpenseSplit(
  expense: Expense,
  amount: number,
  participants: Participant[],
  monthIncomeByParticipant: Record<number, number>,
): Record<number, number> {
  const result: Record<number, number> = {};
  for (const p of participants) result[p.id] = 0;

  const split = expense.split;
  if (!split) {
    // No split defined — assign to first participant
    result[participants[0].id] = amount;
    return result;
  }

  const selectedIds = split.participantIds.length > 0
    ? split.participantIds.filter(pid => participants.some(p => p.id === pid))
    : participants.map(p => p.id);
  if (selectedIds.length === 0) {
    result[participants[0].id] = amount;
    return result;
  }

  if (split.mode === "owner") {
    const ownerId = getOwnerParticipant(selectedIds[0], participants);
    result[ownerId] = amount;
  } else if (split.mode === "equal") {
    const share = amount / selectedIds.length;
    for (const pid of selectedIds) result[pid] = share;
  } else if (split.mode === "proportional") {
    const totalIncome = selectedIds.reduce((s, pid) => s + (monthIncomeByParticipant[pid] ?? 0), 0);
    if (totalIncome <= 0) {
      const share = amount / selectedIds.length;
      for (const pid of selectedIds) result[pid] = share;
    } else {
      for (const pid of selectedIds) {
        result[pid] = amount * ((monthIncomeByParticipant[pid] ?? 0) / totalIncome);
      }
    }
  } else if (split.mode === "custom") {
    const shares = split.customShares ?? {};
    const totalShares = selectedIds.reduce((s, pid) => s + (shares[pid] ?? 0), 0);
    if (totalShares <= 0) {
      const share = amount / selectedIds.length;
      for (const pid of selectedIds) result[pid] = share;
    } else {
      for (const pid of selectedIds) {
        result[pid] = amount * ((shares[pid] ?? 0) / totalShares);
      }
    }
  }

  return result;
}

// ─── Milestones ──────────────────────────────────────────────────────

function detectMilestones(state: FinanceState, sim: SimulationResult): Milestone[] {
  const ms: Milestone[] = [];
  // Loan starts
  for (const loan of state.loans) {
    if (loan.startMonth > 1) ms.push({ month: loan.startMonth, label: loan.name, color: C.blue });
  }
  // Loan payoffs
  for (const loan of state.loans) {
    const payoff = sim.months.find(r => r.month >= loan.startMonth && r.loanBalances[loan.id] <= 0.01);
    if (payoff) ms.push({ month: payoff.month, label: `${loan.name} paid`, color: C.green });
  }
  // Large one-time expenses (≥50K)
  for (const exp of state.expenses) {
    if (exp.frequency === "one-time" && exp.amount >= 50000) {
      ms.push({ month: exp.startMonth, label: exp.name, color: C.red });
    }
  }
  // Large one-time incomes (≥50K)
  for (const inc of state.incomes) {
    if (inc.periodicity === "one-time" && inc.amount >= 50000) {
      ms.push({ month: inc.startMonth, label: inc.name, color: C.green });
    }
  }
  // Extra payment starts
  for (const loan of state.loans) {
    for (const a of loan.amortizations) {
      const m = a.type === "one-time" ? a.month : a.startMonth;
      if (m && m > 1) ms.push({ month: m, label: `Extra: ${loan.name}`, color: C.gold });
    }
  }
  // Loan refinances
  for (const loan of state.loans) {
    if (loan.refinance && loan.refinance.month > 1) {
      ms.push({ month: loan.refinance.month, label: `Refi: ${loan.name}`, color: C.purple });
    }
  }
  // Asset acquisitions
  for (const asset of state.assets) {
    if (asset.startMonth > 1) ms.push({ month: asset.startMonth, label: asset.name, color: C.gold });
  }
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
  // Deduplicate by month+label
  const seen = new Set<string>();
  return ms.filter(m => { const k = `${m.month}-${m.label}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

const milestonePlugin = {
  id: "milestones",
  afterDraw(chart: any) {
    const opts = chart.options?.plugins?.milestones;
    if (!opts?.items?.length) return;
    const { ctx, chartArea, scales } = chart;
    for (let i = 0; i < opts.items.length; i++) {
      const ms = opts.items[i];
      const x = scales.x.getPixelForValue(ms.index);
      if (x < chartArea.left || x > chartArea.right) continue;
      ctx.save();
      // Dashed vertical line
      ctx.strokeStyle = ms.color + "44";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top + 14);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      // Numbered circle at top
      const r = 7;
      ctx.fillStyle = ms.color + "cc";
      ctx.beginPath();
      ctx.arc(x, chartArea.top + 7, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.font = "bold 8px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), x, chartArea.top + 7);
      ctx.restore();
    }
  },
};

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
    // Disbursement month determines when the loan balance activates
    // For personal/credit-card: disbursementMonth (or startMonth if not set)
    // For mortgage/auto: startMonth (no cash disbursement)
    const effectiveDisbursement = (l.type === "personal" || l.type === "credit-card")
      ? (l.disbursementMonth ?? l.startMonth)
      : l.startMonth;
    loanBals[l.id] = effectiveDisbursement <= 1 ? l.currentBalance : 0;
    const r = l.annualRate / 100 / 12;
    loanFixedPmt[l.id] = calcLoanPayment(l.currentBalance, r, l.termMonths);
  }

  // PPR runtime state
  const pprBals: Record<number, { art151: number; art185: number }> = {};
  const pprPrevYearContrib: Record<number, { art151: number; art185: number }> = {};
  const pprYtd: Record<number, { contrib151: number; contrib185: number }> = {};
  for (const ppr of state.pprs) {
    pprBals[ppr.id] = { art151: ppr.initialBalance151, art185: ppr.initialBalance185 };
    pprPrevYearContrib[ppr.id] = { art151: 0, art185: 0 };
    pprYtd[ppr.id] = { contrib151: 0, contrib185: 0 };
  }

  // Asset runtime state
  const assetVals: Record<number, number> = {};
  for (const a of state.assets) {
    assetVals[a.id] = a.startMonth <= 1 ? a.value : 0;
  }

  let cumulativeInterestEarned = 0;
  let cumulativeInterestPaid = 0;
  let debtFreeMonth = 0;
  let negCashflowCount = 0;

  const participants = resolveParticipants(state);
  const hasParticipants = (state.participants?.length ?? 0) > 1;

  for (let m = 1; m <= totalMonths; m++) {
    const monthInYear = ((m - 1) % 12) + 1;

    // 1. Income
    let totalIncome = 0;
    let totalTaxPaid = 0;
    const incomeBySource: Record<number, number> = {};
    for (const inc of state.incomes) {
      let incAmt = 0;
      if (inc.startMonth > m) { incomeBySource[inc.id] = 0; continue; }
      if (inc.endMonth > 0 && inc.endMonth < m) { incomeBySource[inc.id] = 0; continue; }
      const growthFactor = Math.pow(1 + inc.growthRate / 100, Math.floor((m - 1) / 12));

      if (inc.periodicity === "one-time") {
        if (m === inc.startMonth) incAmt = inc.amount;
      } else if (inc.periodicity === "annually") {
        let fires = false;
        if (inc.calendarMonth && state.config.startDate) {
          const d = new Date(state.config.startDate + "T00:00:00");
          d.setMonth(d.getMonth() + m - 1);
          fires = (d.getMonth() + 1) === inc.calendarMonth && m >= inc.startMonth;
        } else {
          fires = monthInYear === (inc.startMonth > 0 ? ((inc.startMonth - 1) % 12) + 1 : 1);
        }
        if (fires) {
          incAmt = inc.amount * growthFactor;
        }
      } else if (inc.periodicity === "every-n-months") {
        const n = inc.frequencyMonths || 3;
        if ((m - inc.startMonth) % n === 0) {
          incAmt = inc.amount * growthFactor;
        }
      } else {
        let monthlyAmt = inc.amount;
        if (inc.periodicity === "weekly") monthlyAmt = inc.amount * 52 / 12;
        else if (inc.periodicity === "biweekly") monthlyAmt = inc.amount * 26 / 12;
        incAmt = monthlyAmt * growthFactor;
        if (inc.bonusMonth > 0 && monthInYear === inc.bonusMonth) {
          incAmt += inc.bonusAmount * growthFactor;
        }
      }

      // Apply Mexican ISR tax if enabled
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
    }

    // Per-participant income
    let incomeByParticipant: Record<number, number> = {};
    if (hasParticipants) {
      for (const p of participants) incomeByParticipant[p.id] = 0;
      for (const inc of state.incomes) {
        const pid = getOwnerParticipant(inc.ownerId, participants);
        incomeByParticipant[pid] = (incomeByParticipant[pid] ?? 0) + (incomeBySource[inc.id] ?? 0);
      }
    }

    // 2. Expenses
    let totalExpenses = 0;
    const expenseBySource: Record<number, number> = {};
    for (const exp of state.expenses) {
      let expAmt = 0;
      if (exp.startMonth > m) { expenseBySource[exp.id] = 0; continue; }
      if (exp.endMonth > 0 && exp.endMonth < m) { expenseBySource[exp.id] = 0; continue; }

      let applies = false;
      if (exp.frequency === "monthly") applies = true;
      else if (exp.frequency === "quarterly") applies = (m - exp.startMonth) % 3 === 0;
      else if (exp.frequency === "annually") {
        if (exp.calendarMonth && state.config.startDate) {
          const d = new Date(state.config.startDate + "T00:00:00");
          d.setMonth(d.getMonth() + m - 1);
          applies = (d.getMonth() + 1) === exp.calendarMonth && m >= exp.startMonth;
        } else {
          applies = (m - exp.startMonth) % 12 === 0;
        }
      }
      else if (exp.frequency === "one-time") applies = m === exp.startMonth;
      else if (exp.frequency === "every-n-months") applies = (m - exp.startMonth) % (exp.frequencyMonths || 3) === 0;

      if (applies) {
        expAmt = exp.amount;
        if (exp.inflationAdjusted) {
          expAmt *= Math.pow(1 + inflRate, (m - 1) / 12);
        }
      }
      expenseBySource[exp.id] = expAmt;
      totalExpenses += expAmt;
    }

    // Per-participant expenses
    let expenseByParticipant: Record<number, number> = {};
    if (hasParticipants) {
      for (const p of participants) expenseByParticipant[p.id] = 0;
      for (const exp of state.expenses) {
        const amt = expenseBySource[exp.id] ?? 0;
        if (amt <= 0) continue;
        const shares = computeExpenseSplit(exp, amt, participants, incomeByParticipant);
        for (const pid of Object.keys(shares)) {
          expenseByParticipant[Number(pid)] = (expenseByParticipant[Number(pid)] ?? 0) + shares[Number(pid)];
        }
      }
    }

    // 3. Loan disbursements: activate future loans
    // Personal/credit-card: disbursementMonth controls when cash arrives (positive cashflow)
    //   — debt activates at disbursementMonth, payments start at startMonth
    // Mortgage/auto: debt activates at startMonth (no cash to borrower)
    let totalLoanDisbursements = 0;
    for (const loan of state.loans) {
      if (loan.type === "personal" || loan.type === "credit-card") {
        const disbMonth = loan.disbursementMonth ?? loan.startMonth;
        if (disbMonth === m && m > 1) {
          loanBals[loan.id] = loan.currentBalance;
          totalLoanDisbursements += loan.currentBalance;
        }
      } else {
        // Mortgage/auto: activate debt at startMonth, no cash disbursement
        if (loan.startMonth === m && m > 1) {
          loanBals[loan.id] = loan.currentBalance;
        }
      }
    }

    // 3b. Loan payments (with amortization support)
    let totalLoanPayments = 0;
    let totalInterestPaid = 0;
    let totalPrincipalPaid = 0;
    const loanPaymentBySource: Record<number, number> = {};
    for (const loan of state.loans) {
      if (loan.startMonth > m) { loanPaymentBySource[loan.id] = 0; continue; }
      const bal = loanBals[loan.id];
      if (bal <= 0.01) { loanPaymentBySource[loan.id] = 0; continue; }

      // Check for refinancing
      if (loan.refinance && loan.refinance.month === m) {
        const refi = loan.refinance;
        const newR = refi.newRate / 100 / 12;
        loanFixedPmt[loan.id] = calcLoanPayment(loanBals[loan.id], newR, refi.newTermMonths);
        totalExpenses += refi.cost;
      }

      const currentAnnualRate = (loan.refinance && m >= loan.refinance.month) ? loan.refinance.newRate : loan.annualRate;
      const r = currentAnnualRate / 100 / 12;
      const monthsElapsed = m - loan.startMonth;
      const remainingMonths = (loan.refinance && m >= loan.refinance.month)
        ? Math.max(0, loan.refinance.newTermMonths - (m - loan.refinance.month))
        : Math.max(0, loan.termMonths - monthsElapsed);
      if (remainingMonths <= 0 && bal > 0.01) {
        const interest = bal * r;
        totalInterestPaid += interest;
        totalLoanPayments += bal + interest;
        totalPrincipalPaid += bal;
        loanPaymentBySource[loan.id] = bal + interest;
        loanBals[loan.id] = 0;
        continue;
      }

      let payment = loanFixedPmt[loan.id];
      if (loan.paymentInterval === "biweekly") {
        // Biweekly = half the monthly payment paid 26 times/year
        // Monthly equivalent: (monthly / 2) × 26 / 12 = monthly × 13/12
        payment = payment * 13 / 12;
      }
      payment = Math.min(payment, bal + bal * r);

      const interest = bal * r;
      const principal = Math.min(payment - interest, bal);
      const actualPayment = interest + Math.max(0, principal);

      totalInterestPaid += interest;
      totalPrincipalPaid += Math.max(0, principal);
      totalLoanPayments += actualPayment;
      let loanPmtThisMonth = actualPayment;
      let newBal = Math.max(0, bal - Math.max(0, principal));

      // Extra payments / amortizations
      const amort = getAmortizationForMonth(loan.amortizations, m, totalMonths);
      if (amort && newBal > 0.01) {
        const amortReal = Math.min(amort.amount, newBal);
        newBal -= amortReal;
        totalPrincipalPaid += amortReal;
        totalLoanPayments += amortReal;
        loanPmtThisMonth += amortReal;

        if (amort.effect === "reduce-payment" && newBal > 0.01) {
          const mRemaining = Math.max(1, remainingMonths);
          loanFixedPmt[loan.id] = calcLoanPayment(newBal, r, mRemaining);
        }
        // "reduce-term": keep the same fixed payment — loan ends sooner
      }

      loanPaymentBySource[loan.id] = loanPmtThisMonth;
      loanBals[loan.id] = newBal;
    }

    // Per-participant loan payments
    let loanPaymentByParticipant: Record<number, number> = {};
    if (hasParticipants) {
      for (const p of participants) loanPaymentByParticipant[p.id] = 0;
      for (const loan of state.loans) {
        const pmt = loanPaymentBySource[loan.id] ?? 0;
        if (pmt <= 0) continue;
        if (loan.ownerId != null && loan.ownerId !== 0) {
          const pid = getOwnerParticipant(loan.ownerId, participants);
          loanPaymentByParticipant[pid] = (loanPaymentByParticipant[pid] ?? 0) + pmt;
        } else {
          // Joint: split equally
          const share = pmt / participants.length;
          for (const p of participants) loanPaymentByParticipant[p.id] += share;
        }
      }
    }

    // 3.5 PPR contributions
    let totalPPRContributions = 0;
    let totalPPRRefunds = 0;
    let totalPPRInterestEarned = 0;
    const pprContributions: Record<number, number> = {};
    const pprRefunds: Record<number, number> = {};
    const pprInterestByPpr: Record<number, number> = {};

    for (const ppr of state.pprs) {
      if (m < ppr.startMonth) continue;
      if (ppr.endMonth > 0 && m > ppr.endMonth) continue;

      // Year boundary: save last year's YTD, reset
      if (monthInYear === 1 && m > 1) {
        pprPrevYearContrib[ppr.id] = {
          art151: pprYtd[ppr.id]?.contrib151 ?? 0,
          art185: pprYtd[ppr.id]?.contrib185 ?? 0,
        };
        pprYtd[ppr.id] = { contrib151: 0, contrib185: 0 };
      }

      // Compute owner's projected annual income for Art.151 cap
      const ownerPid = ppr.ownerId ?? 0;
      let ownerMonthlyIncome = 0;
      for (const inc of state.incomes) {
        const incOwner = inc.ownerId ?? 0;
        if (incOwner === ownerPid || ownerPid === 0) {
          ownerMonthlyIncome += incomeBySource[inc.id] ?? 0;
        }
      }
      const projectedAnnualIncome = ownerMonthlyIncome * 12;

      // Art.151 cap: min(10% income, UMA annual) - other deductions
      const umaAnnual = state.config.umaAnnual ?? 206368;
      const art151AnnualCap = Math.max(0, Math.min(projectedAnnualIncome * 0.1, umaAnnual) - ppr.otherArt151Deductions);
      const remainingMonthsInYear = Math.max(1, 13 - monthInYear);
      const art151MonthlyRemaining = Math.max(0, (art151AnnualCap - (pprYtd[ppr.id]?.contrib151 ?? 0)) / remainingMonthsInYear);
      const actual151 = Math.min(ppr.monthlyArt151, art151MonthlyRemaining);

      // Art.185 cap
      const art185AnnualCap = state.config.art185AnnualCap ?? 152000;
      const art185MonthlyRemaining = Math.max(0, (art185AnnualCap - (pprYtd[ppr.id]?.contrib185 ?? 0)) / remainingMonthsInYear);
      const actual185 = Math.min(ppr.monthlyArt185, art185MonthlyRemaining);

      const totalContrib = actual151 + actual185;
      totalPPRContributions += totalContrib;
      pprContributions[ppr.id] = totalContrib;

      // Credit to PPR balances
      pprBals[ppr.id].art151 += actual151;
      pprBals[ppr.id].art185 += actual185;
      pprYtd[ppr.id].contrib151 += actual151;
      pprYtd[ppr.id].contrib185 += actual185;

      // PPR investment returns
      const rPpr = ppr.annualReturnRate / 100;
      let interest151 = 0, interest185 = 0;
      if (ppr.compoundInterval === "daily") {
        interest151 = pprBals[ppr.id].art151 * (Math.pow(1 + rPpr / 365, 30.44) - 1);
        interest185 = pprBals[ppr.id].art185 * (Math.pow(1 + rPpr / 365, 30.44) - 1);
      } else if (ppr.compoundInterval === "monthly") {
        interest151 = pprBals[ppr.id].art151 * rPpr / 12;
        interest185 = pprBals[ppr.id].art185 * rPpr / 12;
      } else if (ppr.compoundInterval === "quarterly") {
        interest151 = pprBals[ppr.id].art151 * (Math.pow(1 + rPpr / 4, 1 / 3) - 1);
        interest185 = pprBals[ppr.id].art185 * (Math.pow(1 + rPpr / 4, 1 / 3) - 1);
      } else {
        interest151 = pprBals[ppr.id].art151 * (Math.pow(1 + rPpr, 1 / 12) - 1);
        interest185 = pprBals[ppr.id].art185 * (Math.pow(1 + rPpr, 1 / 12) - 1);
      }
      pprBals[ppr.id].art151 += interest151;
      pprBals[ppr.id].art185 += interest185;
      const pprInterest = interest151 + interest185;
      totalPPRInterestEarned += pprInterest;
      pprInterestByPpr[ppr.id] = pprInterest;

      // PPR tax refunds (arrives in refundMonth based on previous year contributions)
      if (monthInYear === ppr.refundMonth) {
        const prevContrib = pprPrevYearContrib[ppr.id];
        if (prevContrib) {
          const deductible = prevContrib.art151 + prevContrib.art185;
          const refund = deductible * (ppr.isrRate / 100);
          totalPPRRefunds += refund;
          pprRefunds[ppr.id] = refund;
          totalIncome += refund;
        }
      }
    }

    // 4. Net cashflow (disbursements are positive inflows from new loans)
    const netCashflow = totalIncome + totalLoanDisbursements - totalExpenses - totalLoanPayments - totalPPRContributions;

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

    // 5b. Asset appreciation
    for (const asset of state.assets) {
      if (asset.startMonth === m && m > 1) assetVals[asset.id] = asset.value;
      if (asset.startMonth > m) continue;
      assetVals[asset.id] *= 1 + asset.annualAppreciation / 100 / 12;
    }

    // 6. Distribute cashflow (waterfall-aware)
    let waterfallDebtByLoan: Record<number, number> | undefined;
    if (netCashflow >= 0) {
      let surplus = netCashflow;
      const wf = state.waterfall;
      if (wf && wf.length > 0) {
        for (const step of wf) {
          if (surplus <= 0.01) break;
          if (step.type === "fill-account") {
            const acc = state.accounts.find(a => a.id === step.accountId);
            if (!acc) continue;
            const target = step.targetBalance ?? 0;
            const cur = accBals[acc.id];
            if (target > 0 && cur >= target) continue;
            const deposit = target > 0 ? Math.min(surplus, target - cur) : surplus;
            if (deposit > 0) { accBals[acc.id] += deposit; surplus -= deposit; }
          } else if (step.type === "pay-debt") {
            const eligible = state.loans
              .filter(l => loanBals[l.id] > 0.01 && l.startMonth <= m)
              .sort((a, b) => step.debtStrategy === "lowest-balance"
                ? loanBals[a.id] - loanBals[b.id]
                : b.annualRate - a.annualRate);
            if (eligible.length === 0) continue;
            const tgt = eligible[0];
            const extra = Math.min(surplus, loanBals[tgt.id]);
            loanBals[tgt.id] -= extra;
            surplus -= extra;
            if (!waterfallDebtByLoan) waterfallDebtByLoan = {};
            waterfallDebtByLoan[tgt.id] = (waterfallDebtByLoan[tgt.id] ?? 0) + extra;
          }
        }
      }
      if (surplus > 0.01) {
        const checkingAcc = state.accounts.find(a => a.type === "checking") || state.accounts[0];
        if (checkingAcc) accBals[checkingAcc.id] += surplus;
      }
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
    const accountBalSum = state.accounts.reduce((sum, a) => sum + Math.max(0, accBals[a.id]), 0);
    const totalPPRBal = Object.values(pprBals).reduce((s, b) => s + b.art151 + b.art185, 0);
    const totalAssetVal = state.assets.reduce((sum, a) => sum + Math.max(0, assetVals[a.id]), 0);
    const totalAssets = accountBalSum + totalPPRBal + totalAssetVal;
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
      totalLoanDisbursements,
      totalInterestPaid,
      totalPrincipalPaid,
      totalInterestEarned,
      netCashflow,
      accountBalances: { ...accBals },
      loanBalances: { ...loanBals },
      incomeBySource: { ...incomeBySource },
      expenseBySource: { ...expenseBySource },
      loanPaymentBySource: { ...loanPaymentBySource },
      assetValues: { ...assetVals },
      totalAssetValue: totalAssetVal,
      totalAssets,
      totalDebt,
      netWorth: totalAssets - totalDebt,
      totalTaxPaid,
      waterfallDebtPaidByLoan: waterfallDebtByLoan ? { ...waterfallDebtByLoan } : undefined,
      ...(hasParticipants ? {
        incomeByParticipant: { ...incomeByParticipant },
        expenseByParticipant: { ...expenseByParticipant },
        loanPaymentByParticipant: { ...loanPaymentByParticipant },
        contributionByParticipant: Object.fromEntries(
          participants.map(p => [p.id, (incomeByParticipant[p.id] ?? 0) - (expenseByParticipant[p.id] ?? 0) - (loanPaymentByParticipant[p.id] ?? 0)])
        ),
      } : {}),
      ...(state.pprs.length > 0 ? {
        pprBalances: Object.fromEntries(Object.entries(pprBals).map(([k, v]) => [k, { ...v }])),
        pprContributions: { ...pprContributions },
        pprRefunds: { ...pprRefunds },
        pprInterestEarned: { ...pprInterestByPpr },
        totalPPRBalance: totalPPRBal,
        totalPPRContributions,
        totalPPRRefunds,
      } : {}),
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
      totalLoanDisbursements: yearMonths.reduce((s, r) => s + r.totalLoanDisbursements, 0),
      interestEarned: yearMonths.reduce((s, r) => s + r.totalInterestEarned, 0),
      interestPaid: yearMonths.reduce((s, r) => s + r.totalInterestPaid, 0),
      netCashflow: yearMonths.reduce((s, r) => s + r.netCashflow, 0),
      endAssets: last.totalAssets,
      endDebt: last.totalDebt,
      endNetWorth: last.netWorth,
      totalTaxPaid: yearMonths.reduce((s, r) => s + (r.totalTaxPaid ?? 0), 0),
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

  // Stress metrics
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

  if (peakStressBalance === Infinity) peakStressBalance = 0;

  // Loan payoff projections beyond the simulation horizon
  const loanPayoffProjections: PayoffProjection[] = [];
  for (const loan of state.loans) {
    const endBal = loanBals[loan.id];
    if (endBal > 0.01) {
      loanPayoffProjections.push(
        projectPayoff(
          loan.id,
          endBal,
          loan.annualRate,
          loan.termMonths,
          loan.startMonth,
          loan.paymentInterval,
          loan.amortizations,
          totalMonths,
          600,
        ),
      );
    } else {
      loanPayoffProjections.push({
        loanId: loan.id,
        payoffMonth: 0,
        totalInterestPaid: 0,
        totalPaid: 0,
      });
    }
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
    peakStressMonth,
    peakStressBalance,
    overdraftMonths,
    peakDti,
    peakDtiMonth,
    alerts,
    loanPayoffProjections,
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
    assets: [],
    pprs: [],
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
      assets: [],
      pprs: [],
      config: { horizonYears: 10, inflationRate: 4, startDate: "" },
      nextId: 9,
    },
  },
  {
    key: "dual-income",
    label: "Dual Income Family",
    state: {
      participants: [
        { id: 100, name: "Partner A", color: PARTICIPANT_COLORS[0] },
        { id: 101, name: "Partner B", color: PARTICIPANT_COLORS[1] },
      ],
      accounts: [
        { id: 1, name: "Joint Checking", type: "checking", balance: 40000, annualRate: 0, compoundInterval: "monthly", ownerId: 0 },
        { id: 2, name: "Emergency Fund", type: "savings", balance: 120000, annualRate: 4.5, compoundInterval: "monthly", ownerId: 0 },
        { id: 3, name: "Investment Portfolio", type: "investment", balance: 300000, annualRate: 9, compoundInterval: "quarterly", ownerId: 0 },
        { id: 4, name: "Retirement 401k", type: "retirement", balance: 200000, annualRate: 7, compoundInterval: "monthly", ownerId: 0 },
      ],
      loans: [
        { id: 5, name: "Mortgage", type: "mortgage", principal: 3500000, currentBalance: 3000000, annualRate: 9.5, termMonths: 240, paymentInterval: "monthly", startMonth: 1, amortizations: [], ownerId: 0 },
        { id: 6, name: "Car Loan", type: "auto", principal: 400000, currentBalance: 320000, annualRate: 11, termMonths: 48, paymentInterval: "monthly", startMonth: 1, amortizations: [], ownerId: 0 },
      ],
      incomes: [
        { id: 7, name: "Salary - Partner A", amount: 55000, periodicity: "monthly", frequencyMonths: 0, growthRate: 5, bonusMonth: 12, bonusAmount: 55000, startMonth: 1, endMonth: 0, ownerId: 100 },
        { id: 8, name: "Salary - Partner B", amount: 40000, periodicity: "monthly", frequencyMonths: 0, growthRate: 4, bonusMonth: 12, bonusAmount: 40000, startMonth: 1, endMonth: 0, ownerId: 101 },
      ],
      expenses: [
        { id: 9, name: "Groceries", amount: 10000, frequency: "monthly", frequencyMonths: 0, category: "food", inflationAdjusted: true, startMonth: 1, endMonth: 0, split: { mode: "proportional", participantIds: [100, 101] } },
        { id: 10, name: "Utilities", amount: 4000, frequency: "monthly", frequencyMonths: 0, category: "utilities", inflationAdjusted: true, startMonth: 1, endMonth: 0, split: { mode: "equal", participantIds: [100, 101] } },
        { id: 11, name: "Insurance", amount: 6000, frequency: "monthly", frequencyMonths: 0, category: "insurance", inflationAdjusted: false, startMonth: 1, endMonth: 0, split: { mode: "equal", participantIds: [100, 101] } },
        { id: 12, name: "Kids School", amount: 12000, frequency: "monthly", frequencyMonths: 0, category: "education", inflationAdjusted: true, startMonth: 1, endMonth: 0, split: { mode: "proportional", participantIds: [100, 101] } },
        { id: 13, name: "Entertainment", amount: 5000, frequency: "monthly", frequencyMonths: 0, category: "entertainment", inflationAdjusted: true, startMonth: 1, endMonth: 0, split: { mode: "equal", participantIds: [100, 101] } },
        { id: 14, name: "Health", amount: 3000, frequency: "monthly", frequencyMonths: 0, category: "health", inflationAdjusted: true, startMonth: 1, endMonth: 0, split: { mode: "equal", participantIds: [100, 101] } },
      ],
      assets: [],
      pprs: [],
      config: { horizonYears: 15, inflationRate: 4, startDate: "" },
      nextId: 102,
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
      assets: [],
      pprs: [],
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
      assets: [],
      pprs: [],
      config: { horizonYears: 20, inflationRate: 3.5, startDate: "" },
      nextId: 12,
    },
  },
  {
    key: "ppr-retirement",
    label: "PPR Retirement Planning",
    state: {
      accounts: [
        { id: 1, name: "Checking", type: "checking", balance: 50000, annualRate: 0, compoundInterval: "monthly" },
        { id: 2, name: "Savings", type: "savings", balance: 100000, annualRate: 4.5, compoundInterval: "monthly" },
      ],
      loans: [],
      incomes: [
        { id: 3, name: "Salary", amount: 60000, periodicity: "monthly", frequencyMonths: 0, growthRate: 5, bonusMonth: 12, bonusAmount: 60000, startMonth: 1, endMonth: 0 },
      ],
      expenses: [
        { id: 4, name: "Living Expenses", amount: 25000, frequency: "monthly", frequencyMonths: 0, category: "food", inflationAdjusted: true, startMonth: 1, endMonth: 0 },
        { id: 5, name: "Utilities", amount: 3000, frequency: "monthly", frequencyMonths: 0, category: "utilities", inflationAdjusted: true, startMonth: 1, endMonth: 0 },
        { id: 6, name: "Insurance", amount: 4000, frequency: "monthly", frequencyMonths: 0, category: "insurance", inflationAdjusted: false, startMonth: 1, endMonth: 0 },
      ],
      assets: [],
      pprs: [
        {
          id: 7, name: "PPR Principal", ownerId: undefined,
          monthlyArt151: 9000, monthlyArt185: 12700,
          annualReturnRate: 8, compoundInterval: "monthly",
          isrRate: 30, otherArt151Deductions: 0,
          startMonth: 1, endMonth: 0, refundMonth: 4,
          initialBalance151: 0, initialBalance185: 0,
        },
      ],
      config: { horizonYears: 20, inflationRate: 4, startDate: "" },
      nextId: 8,
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
      assets: [],
      pprs: [],
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
  const headers = ["Month", "Date", "Income", "Tax Paid", "Loan Disbursements", "Expenses", "Loan Payments", "Interest Paid", "Interest Earned", "Net Cashflow", "Asset Value", "Total Assets", "Total Debt", "Net Worth"];
  const rows = sim.months.map((r) => [
    r.month,
    startDate ? monthToDate(r.month, startDate) : `Month ${r.month}`,
    r.totalIncome.toFixed(2),
    (r.totalTaxPaid ?? 0).toFixed(2),
    r.totalLoanDisbursements.toFixed(2),
    r.totalExpenses.toFixed(2),
    r.totalLoanPayments.toFixed(2),
    r.totalInterestPaid.toFixed(2),
    r.totalInterestEarned.toFixed(2),
    r.netCashflow.toFixed(2),
    r.totalAssetValue.toFixed(2),
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
        if (!data.pprs) data.pprs = [];
        if (!data.assets) data.assets = [];
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
  const [tab, setTab] = useState<"dashboard" | "accounts" | "loans" | "income" | "expenses" | "assets" | "strategy" | "ppr">("dashboard");
  const [chartMode, setChartMode] = useState<"networth" | "cashflow" | "balances" | "debt" | "snowball" | "ppr">("networth");
  const [tableOpen, setTableOpen] = useState(false);
  const [granularity, setGranularity] = useState<"monthly" | "quarterly" | "yearly">("yearly");
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [sankeyYear, setSankeyYear] = useState(1);

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
  const [loanDisbursement, setLoanDisbursement] = useState(0); // 0 = same as startMonth

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
  const [incTaxCategory, setIncTaxCategory] = useState<TaxCategory>("salary");
  const [incCalendarMonth, setIncCalendarMonth] = useState(0);

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
  const [expCalendarMonth, setExpCalendarMonth] = useState(0);

  // Participant form
  const [partName, setPartName] = useState("Partner");
  const [participantsOpen, setParticipantsOpen] = useState(false);

  // Ownership / split form state
  const [incOwner, setIncOwner] = useState(0);
  const [accOwner, setAccOwner] = useState(0);
  const [loanOwner, setLoanOwner] = useState(0);
  const [expSplitMode, setExpSplitMode] = useState<SplitMode>("equal");
  const [expSplitParticipants, setExpSplitParticipants] = useState<number[]>([]);
  const [expCustomShares, setExpCustomShares] = useState<Record<number, number>>({});

  // PPR form
  const [pprName, setPprName] = useState("My PPR");
  const [pprMonthly151, setPprMonthly151] = useState(9000);
  const [pprMonthly185, setPprMonthly185] = useState(12700);
  const [pprReturnRate, setPprReturnRate] = useState(8);
  const [pprCompound, setPprCompound] = useState<CompoundInterval>("monthly");
  const [pprIsrRate, setPprIsrRate] = useState(30);
  const [pprOtherArt151, setPprOtherArt151] = useState(0);
  const [pprRefundMonth, setPprRefundMonth] = useState(4);
  const [pprStart, setPprStart] = useState(1);
  const [pprEnd, setPprEnd] = useState(0);
  const [pprInitBal151, setPprInitBal151] = useState(0);
  const [pprInitBal185, setPprInitBal185] = useState(0);
  const [pprOwner, setPprOwner] = useState(0);

  // Asset form
  const [assetName, setAssetName] = useState("New Asset");
  const [assetType, setAssetType] = useState<AssetType>("property");
  const [assetValue, setAssetValue] = useState(1000000);
  const [assetAppreciation, setAssetAppreciation] = useState(5);
  const [assetStart, setAssetStart] = useState(1);

  // Waterfall form
  const [wfStepType, setWfStepType] = useState<"fill-account" | "pay-debt">("fill-account");
  const [wfAccountId, setWfAccountId] = useState(0);
  const [wfTarget, setWfTarget] = useState(0);
  const [wfDebtStrategy, setWfDebtStrategy] = useState<"highest-rate" | "lowest-balance">("highest-rate");
  const [showMilestones, setShowMilestones] = useState(true);
  const [showReal, setShowReal] = useState(false);

  // Refinance form
  const [refiLoanId, setRefiLoanId] = useState<number | null>(null);
  const [refiMonth, setRefiMonth] = useState(24);
  const [refiRate, setRefiRate] = useState(8);
  const [refiTerm, setRefiTerm] = useState(240);
  const [refiCost, setRefiCost] = useState(50000);

  // Editing state (null = adding new, number = editing that ID)
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null);
  const [editingLoanId, setEditingLoanId] = useState<number | null>(null);
  const [editingIncomeId, setEditingIncomeId] = useState<number | null>(null);
  const [editingExpenseId, setEditingExpenseId] = useState<number | null>(null);
  const [editingPprId, setEditingPprId] = useState<number | null>(null);
  const [editingAssetId, setEditingAssetId] = useState<number | null>(null);

  // Refs
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstanceRef = useRef<Chart | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tabChartRef = useRef<HTMLCanvasElement>(null);
  const tabChartInstanceRef = useRef<Chart | null>(null);
  const ganttCanvasRef = useRef<HTMLCanvasElement>(null);
  const ganttContainerRef = useRef<HTMLDivElement>(null);
  const [ganttWidth, setGanttWidth] = useState(0);
  const [comparisonScenarios, setComparisonScenarios] = useState<ComparisonScenario[]>([]);
  const compFileInputRef = useRef<HTMLInputElement>(null);

  // Sensitivity / What-If overrides
  const [sensitivity, setSensitivity] = useState<{
    rateOffset: number;
    growthOffset: number;
    inflOffset: number;
  }>({ rateOffset: 0, growthOffset: 0, inflOffset: 0 });

  // Merge sensitivity offsets into state for simulation
  const sensitiveState = useMemo((): FinanceState => {
    if (!sensitivity.rateOffset && !sensitivity.growthOffset && !sensitivity.inflOffset) return state;
    return {
      ...state,
      loans: state.loans.map(l => ({
        ...l,
        annualRate: Math.max(0, l.annualRate + sensitivity.rateOffset),
      })),
      incomes: state.incomes.map(i => ({
        ...i,
        growthRate: i.growthRate + sensitivity.growthOffset,
      })),
      config: {
        ...state.config,
        inflationRate: Math.max(0, state.config.inflationRate + sensitivity.inflOffset),
      },
    };
  }, [state, sensitivity]);

  // Simulation
  const sim = useMemo(() => simulate(sensitiveState), [sensitiveState]);

  // Milestones
  const milestones = useMemo(() => detectMilestones(sensitiveState, sim), [sensitiveState, sim]);

  // Derived participants
  const participants = useMemo(() => resolveParticipants(state), [state]);

  // ── Participant management ──
  const addParticipant = useCallback(() => {
    setState(s => {
      const existing = s.participants ?? [];
      let newParts = [...existing];
      let nextIdVal = s.nextId;
      // If going from 0 participants to 2, auto-create "Me" first
      if (newParts.length === 0) {
        newParts.push({ id: nextIdVal, name: "Me", color: PARTICIPANT_COLORS[0] });
        nextIdVal++;
      }
      const color = PARTICIPANT_COLORS[newParts.length % PARTICIPANT_COLORS.length];
      newParts.push({ id: nextIdVal, name: partName || "Partner", color });
      return { ...s, participants: newParts, nextId: nextIdVal + 1 };
    });
    setPartName("Partner");
    setParticipantsOpen(false);
  }, [partName]);

  const removeParticipant = useCallback((pid: number) => {
    setState(s => {
      const parts = (s.participants ?? []).filter(p => p.id !== pid);
      if (parts.length <= 1) {
        // Back to single-person mode: remove all ownership data
        return {
          ...s,
          participants: [],
          incomes: s.incomes.map(i => ({ ...i, ownerId: undefined })),
          accounts: s.accounts.map(a => ({ ...a, ownerId: undefined })),
          loans: s.loans.map(l => ({ ...l, ownerId: undefined })),
          expenses: s.expenses.map(e => ({ ...e, split: undefined })),
          pprs: s.pprs.map(p => ({ ...p, ownerId: undefined })),
        };
      }
      const firstId = parts[0].id;
      return {
        ...s,
        participants: parts,
        incomes: s.incomes.map(i => i.ownerId === pid ? { ...i, ownerId: firstId } : i),
        accounts: s.accounts.map(a => a.ownerId === pid ? { ...a, ownerId: 0 } : a),
        loans: s.loans.map(l => l.ownerId === pid ? { ...l, ownerId: 0 } : l),
        expenses: s.expenses.map(e => {
          if (!e.split) return e;
          const newIds = e.split.participantIds.filter(id => id !== pid);
          const newShares = e.split.customShares
            ? Object.fromEntries(Object.entries(e.split.customShares).filter(([k]) => Number(k) !== pid))
            : undefined;
          return { ...e, split: { ...e.split, participantIds: newIds, customShares: newShares } };
        }),
        pprs: s.pprs.map(p => p.ownerId === pid ? { ...p, ownerId: 0 } : p),
      };
    });
  }, []);

  const renameParticipant = useCallback((pid: number, name: string) => {
    setState(s => ({
      ...s,
      participants: (s.participants ?? []).map(p => p.id === pid ? { ...p, name } : p),
    }));
  }, []);

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

  const addComparisonFromCurrent = useCallback(() => {
    const name = `Scenario ${comparisonScenarios.length + 1}`;
    const snapState = JSON.parse(JSON.stringify(state)) as FinanceState;
    const snapSim = simulate(snapState);
    setComparisonScenarios(prev => [...prev, { name, state: snapState, sim: snapSim }]);
  }, [state, comparisonScenarios.length]);

  const addComparisonFromFile = useCallback(async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const data = await importJSON(file);
    if (data) {
      const snapSim = simulate(data);
      const name = file.name.replace(/\.json$/i, "");
      setComparisonScenarios(prev => [...prev, { name, state: data, sim: snapSim }]);
    }
    if (compFileInputRef.current) compFileInputRef.current.value = "";
  }, []);

  const removeComparison = useCallback((idx: number) => {
    setComparisonScenarios(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const renameComparison = useCallback((idx: number, name: string) => {
    setComparisonScenarios(prev => prev.map((s, i) => i === idx ? { ...s, name } : s));
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
    setAccOwner(a.ownerId ?? 0);
  }, []);

  const cancelEditAccount = useCallback(() => {
    setEditingAccountId(null);
    setAccName("New Account"); setAccType("savings"); setAccBalance(10000);
    setAccRate(3); setAccCompound("monthly"); setAccOwner(0);
  }, []);

  const startEditLoan = useCallback((l: Loan) => {
    setEditingLoanId(l.id);
    setLoanName(l.name); setLoanType(l.type); setLoanPrincipal(l.principal);
    setLoanBalance(l.currentBalance); setLoanRate(l.annualRate);
    setLoanTerm(l.termMonths); setLoanInterval(l.paymentInterval); setLoanStart(l.startMonth);
    setLoanDisbursement(l.disbursementMonth ?? 0);
    setLoanOwner(l.ownerId ?? 0);
  }, []);

  const cancelEditLoan = useCallback(() => {
    setEditingLoanId(null);
    setLoanName("New Loan"); setLoanType("personal"); setLoanPrincipal(100000);
    setLoanBalance(100000); setLoanRate(12); setLoanTerm(60);
    setLoanInterval("monthly"); setLoanStart(1); setLoanDisbursement(0); setLoanOwner(0);
  }, []);

  const startEditIncome = useCallback((inc: Income) => {
    setEditingIncomeId(inc.id);
    setIncName(inc.name); setIncAmount(inc.amount); setIncPeriodicity(inc.periodicity);
    setIncFreqMonths(inc.frequencyMonths || 3);
    setIncGrowth(inc.growthRate); setIncBonusMonth(inc.bonusMonth);
    setIncBonusAmount(inc.bonusAmount); setIncStart(inc.startMonth); setIncEnd(inc.endMonth);
    setIncOwner(inc.ownerId ?? 0); setIncTaxCategory(inc.taxCategory ?? "salary");
    setIncCalendarMonth(inc.calendarMonth ?? 0);
  }, []);

  const cancelEditIncome = useCallback(() => {
    setEditingIncomeId(null);
    setIncName("New Income"); setIncAmount(10000); setIncPeriodicity("monthly");
    setIncFreqMonths(3); setIncGrowth(3); setIncBonusMonth(0); setIncBonusAmount(0);
    setIncStart(1); setIncEnd(0); setIncOwner(0); setIncTaxCategory("salary");
    setIncCalendarMonth(0);
  }, []);

  const startEditExpense = useCallback((exp: Expense) => {
    setEditingExpenseId(exp.id);
    setExpName(exp.name); setExpAmount(exp.amount); setExpFreq(exp.frequency);
    setExpFreqMonths(exp.frequencyMonths || 3);
    setExpCategory(exp.category); setExpInflation(exp.inflationAdjusted);
    setExpStart(exp.startMonth); setExpEnd(exp.endMonth);
    setExpCalendarMonth(exp.calendarMonth ?? 0);
    if (exp.split) {
      setExpSplitMode(exp.split.mode);
      setExpSplitParticipants(exp.split.participantIds);
      setExpCustomShares(exp.split.customShares ?? {});
    } else {
      setExpSplitMode("equal");
      setExpSplitParticipants([]);
      setExpCustomShares({});
    }
  }, []);

  const cancelEditExpense = useCallback(() => {
    setEditingExpenseId(null);
    setExpName("New Expense"); setExpAmount(1000); setExpFreq("monthly");
    setExpFreqMonths(3); setExpCategory("other"); setExpInflation(true); setExpStart(1); setExpEnd(0);
    setExpSplitMode("equal"); setExpSplitParticipants([]); setExpCustomShares({});
    setExpCalendarMonth(0);
  }, []);

  const startEditPpr = useCallback((ppr: PPR) => {
    setEditingPprId(ppr.id);
    setPprName(ppr.name); setPprMonthly151(ppr.monthlyArt151); setPprMonthly185(ppr.monthlyArt185);
    setPprReturnRate(ppr.annualReturnRate); setPprCompound(ppr.compoundInterval);
    setPprIsrRate(ppr.isrRate); setPprOtherArt151(ppr.otherArt151Deductions);
    setPprRefundMonth(ppr.refundMonth); setPprStart(ppr.startMonth); setPprEnd(ppr.endMonth);
    setPprInitBal151(ppr.initialBalance151); setPprInitBal185(ppr.initialBalance185);
    setPprOwner(ppr.ownerId ?? 0);
  }, []);

  const cancelEditPpr = useCallback(() => {
    setEditingPprId(null);
    setPprName("My PPR"); setPprMonthly151(9000); setPprMonthly185(12700);
    setPprReturnRate(8); setPprCompound("monthly"); setPprIsrRate(30);
    setPprOtherArt151(0); setPprRefundMonth(4); setPprStart(1); setPprEnd(0);
    setPprInitBal151(0); setPprInitBal185(0); setPprOwner(0);
  }, []);

  // ── Add / Save handlers ──
  const saveAccount = useCallback(() => {
    if (!accName.trim()) return;
    const ownerData = participants.length > 1 ? { ownerId: accOwner } : {};
    if (editingAccountId !== null) {
      setState(s => ({
        ...s,
        accounts: s.accounts.map(a => a.id === editingAccountId
          ? { ...a, name: accName, type: accType, balance: accBalance, annualRate: accRate, compoundInterval: accCompound, ...ownerData }
          : a),
      }));
      cancelEditAccount();
    } else {
      setState(s => ({
        ...s,
        accounts: [...s.accounts, {
          id: s.nextId, name: accName, type: accType,
          balance: accBalance, annualRate: accRate, compoundInterval: accCompound,
          ...ownerData,
        }],
        nextId: s.nextId + 1,
      }));
    }
  }, [accName, accType, accBalance, accRate, accCompound, accOwner, participants.length, editingAccountId, cancelEditAccount]);

  const removeAccount = useCallback((id: number) => {
    setState(s => ({ ...s, accounts: s.accounts.filter(a => a.id !== id) }));
    if (editingAccountId === id) cancelEditAccount();
  }, [editingAccountId, cancelEditAccount]);

  const saveLoan = useCallback(() => {
    if (!loanName.trim()) return;
    const ownerData = participants.length > 1 ? { ownerId: loanOwner } : {};
    const disbData = loanDisbursement > 0 ? { disbursementMonth: loanDisbursement } : {};
    if (editingLoanId !== null) {
      setState(s => ({
        ...s,
        loans: s.loans.map(l => l.id === editingLoanId
          ? { ...l, name: loanName, type: loanType, principal: loanPrincipal, currentBalance: loanBalance, annualRate: loanRate, termMonths: loanTerm, paymentInterval: loanInterval, startMonth: loanStart, ...ownerData, ...disbData }
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
          ...ownerData, ...disbData,
        }],
        nextId: s.nextId + 1,
      }));
    }
  }, [loanName, loanType, loanPrincipal, loanBalance, loanRate, loanTerm, loanInterval, loanStart, loanDisbursement, loanOwner, participants.length, editingLoanId, cancelEditLoan]);

  const removeLoan = useCallback((id: number) => {
    setState(s => ({ ...s, loans: s.loans.filter(l => l.id !== id) }));
    if (editingLoanId === id) cancelEditLoan();
  }, [editingLoanId, cancelEditLoan]);

  const applyRefinance = useCallback((loanId: number) => {
    setState(s => ({
      ...s,
      loans: s.loans.map(l => l.id === loanId
        ? { ...l, refinance: { month: refiMonth, newRate: refiRate, newTermMonths: refiTerm, cost: refiCost } }
        : l),
    }));
    setRefiLoanId(null);
  }, [refiMonth, refiRate, refiTerm, refiCost]);

  const removeRefinance = useCallback((loanId: number) => {
    setState(s => ({
      ...s,
      loans: s.loans.map(l => l.id === loanId ? { ...l, refinance: undefined } : l),
    }));
  }, []);

  const saveIncome = useCallback(() => {
    if (!incName.trim()) return;
    const ownerData = participants.length > 1 ? { ownerId: incOwner || participants[0].id } : {};
    const taxData = { taxCategory: incTaxCategory };
    const calData = { calendarMonth: incCalendarMonth || undefined };
    if (editingIncomeId !== null) {
      setState(s => ({
        ...s,
        incomes: s.incomes.map(i => i.id === editingIncomeId
          ? { ...i, name: incName, amount: incAmount, periodicity: incPeriodicity, frequencyMonths: incFreqMonths, growthRate: incGrowth, bonusMonth: incBonusMonth, bonusAmount: incBonusAmount, startMonth: incStart, endMonth: incEnd, ...ownerData, ...taxData, ...calData }
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
          ...ownerData, ...taxData, ...calData,
        }],
        nextId: s.nextId + 1,
      }));
    }
  }, [incName, incAmount, incPeriodicity, incFreqMonths, incGrowth, incBonusMonth, incBonusAmount, incStart, incEnd, incOwner, incTaxCategory, incCalendarMonth, participants, editingIncomeId, cancelEditIncome]);

  const removeIncome = useCallback((id: number) => {
    setState(s => ({ ...s, incomes: s.incomes.filter(i => i.id !== id) }));
    if (editingIncomeId === id) cancelEditIncome();
  }, [editingIncomeId, cancelEditIncome]);

  const saveExpense = useCallback(() => {
    if (!expName.trim()) return;
    const splitData = participants.length > 1 ? {
      split: {
        mode: expSplitMode,
        participantIds: expSplitParticipants.length > 0 ? expSplitParticipants : participants.map(p => p.id),
        ...(expSplitMode === "custom" ? { customShares: expCustomShares } : {}),
      } as ExpenseSplit,
    } : {};
    const calData = { calendarMonth: expCalendarMonth || undefined };
    if (editingExpenseId !== null) {
      setState(s => ({
        ...s,
        expenses: s.expenses.map(e => e.id === editingExpenseId
          ? { ...e, name: expName, amount: expAmount, frequency: expFreq, frequencyMonths: expFreqMonths, category: expCategory, inflationAdjusted: expInflation, startMonth: expStart, endMonth: expEnd, ...splitData, ...calData }
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
          ...splitData, ...calData,
        }],
        nextId: s.nextId + 1,
      }));
    }
  }, [expName, expAmount, expFreq, expFreqMonths, expCategory, expInflation, expStart, expEnd, expCalendarMonth, expSplitMode, expSplitParticipants, expCustomShares, participants, editingExpenseId, cancelEditExpense]);

  const removeExpense = useCallback((id: number) => {
    setState(s => ({ ...s, expenses: s.expenses.filter(e => e.id !== id) }));
    if (editingExpenseId === id) cancelEditExpense();
  }, [editingExpenseId, cancelEditExpense]);

  const savePpr = useCallback(() => {
    if (!pprName.trim()) return;
    const ownerData = participants.length > 1 ? { ownerId: pprOwner } : {};
    const pprData: Omit<PPR, "id"> = {
      name: pprName, monthlyArt151: pprMonthly151, monthlyArt185: pprMonthly185,
      annualReturnRate: pprReturnRate, compoundInterval: pprCompound,
      isrRate: pprIsrRate, otherArt151Deductions: pprOtherArt151,
      startMonth: pprStart, endMonth: pprEnd, refundMonth: pprRefundMonth,
      initialBalance151: pprInitBal151, initialBalance185: pprInitBal185,
      ...ownerData,
    };
    if (editingPprId !== null) {
      setState(s => ({
        ...s,
        pprs: s.pprs.map(p => p.id === editingPprId ? { ...p, ...pprData } : p),
      }));
      cancelEditPpr();
    } else {
      setState(s => ({
        ...s,
        pprs: [...s.pprs, { id: s.nextId, ...pprData }],
        nextId: s.nextId + 1,
      }));
    }
  }, [pprName, pprMonthly151, pprMonthly185, pprReturnRate, pprCompound, pprIsrRate, pprOtherArt151, pprStart, pprEnd, pprRefundMonth, pprInitBal151, pprInitBal185, pprOwner, participants.length, editingPprId, cancelEditPpr]);

  const removePpr = useCallback((id: number) => {
    setState(s => ({ ...s, pprs: s.pprs.filter(p => p.id !== id) }));
    if (editingPprId === id) cancelEditPpr();
  }, [editingPprId, cancelEditPpr]);

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

  // ── Asset CRUD ──
  const startEditAsset = useCallback((a: Asset) => {
    setEditingAssetId(a.id);
    setAssetName(a.name); setAssetType(a.type); setAssetValue(a.value);
    setAssetAppreciation(a.annualAppreciation); setAssetStart(a.startMonth);
  }, []);

  const cancelEditAsset = useCallback(() => {
    setEditingAssetId(null);
    setAssetName("New Asset"); setAssetType("property"); setAssetValue(1000000);
    setAssetAppreciation(5); setAssetStart(1);
  }, []);

  const saveAsset = useCallback(() => {
    if (!assetName.trim()) return;
    if (editingAssetId !== null) {
      setState(s => ({
        ...s,
        assets: s.assets.map(a => a.id === editingAssetId
          ? { ...a, name: assetName, type: assetType, value: assetValue, annualAppreciation: assetAppreciation, startMonth: assetStart }
          : a),
      }));
      cancelEditAsset();
    } else {
      setState(s => ({
        ...s,
        assets: [...s.assets, { id: s.nextId, name: assetName, type: assetType, value: assetValue, annualAppreciation: assetAppreciation, startMonth: assetStart }],
        nextId: s.nextId + 1,
      }));
    }
  }, [assetName, assetType, assetValue, assetAppreciation, assetStart, editingAssetId, cancelEditAsset]);

  const removeAsset = useCallback((id: number) => {
    setState(s => ({ ...s, assets: s.assets.filter(a => a.id !== id) }));
    if (editingAssetId === id) cancelEditAsset();
  }, [editingAssetId, cancelEditAsset]);

  // ── Waterfall CRUD ──
  const addWaterfallStep = useCallback(() => {
    setState(s => {
      const step: WaterfallStep = wfStepType === "fill-account"
        ? { id: s.nextId, type: "fill-account", accountId: wfAccountId || state.accounts[0]?.id, targetBalance: wfTarget }
        : { id: s.nextId, type: "pay-debt", debtStrategy: wfDebtStrategy };
      return { ...s, waterfall: [...(s.waterfall ?? []), step], nextId: s.nextId + 1 };
    });
  }, [wfStepType, wfAccountId, wfTarget, wfDebtStrategy, state.accounts]);

  const removeWaterfallStep = useCallback((id: number) => {
    setState(s => ({ ...s, waterfall: (s.waterfall ?? []).filter(w => w.id !== id) }));
  }, []);

  const moveWaterfallStep = useCallback((id: number, dir: -1 | 1) => {
    setState(s => {
      const wf = [...(s.waterfall ?? [])];
      const idx = wf.findIndex(w => w.id === id);
      if (idx < 0) return s;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= wf.length) return s;
      [wf[idx], wf[newIdx]] = [wf[newIdx], wf[idx]];
      return { ...s, waterfall: wf };
    });
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
    for (let i = step - 1; i < months.length; i += step) {
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

    const sampleDataReal = (accessor: (r: MonthRow) => number) =>
      dataIndices.map(i => {
        const val = accessor(sim.months[i]);
        if (!showReal) return val;
        const monthsElapsed = sim.months[i]?.month ?? 0;
        return val / Math.pow(1 + sensitiveState.config.inflationRate / 100, monthsElapsed / 12);
      });

    // Map milestones to chart label indices
    const msItems = showMilestones ? milestones.map(ms => {
      let best = -1, bestDist = Infinity;
      for (let li = 0; li < dataIndices.length; li++) {
        const mMonth = sim.months[dataIndices[li]]?.month ?? 0;
        const dist = Math.abs(mMonth - ms.month);
        if (dist < bestDist) { bestDist = dist; best = li; }
      }
      return { index: best, label: ms.label, color: ms.color };
    }).filter(m => m.index >= 0) : [];

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
        data: sampleDataReal(r => r.netWorth),
        borderColor: C.gold,
        backgroundColor: grad,
        fill: true, tension: 0.3, borderWidth: 2.5, pointRadius: ptRadius,
        pointBackgroundColor: C.gold, pointBorderColor: C.gold,
      }];
      yAxisTitle = "Net Worth ($)";
    } else if (chartMode === "cashflow") {
      const incomeData = sampleDataReal(r => r.totalIncome + r.totalLoanDisbursements);
      const expenseData = sampleDataReal(r => -(r.totalExpenses + r.totalLoanPayments));
      const netData = sampleDataReal(r => r.netCashflow);
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
        data: sampleDataReal(r => r.accountBalances[acc.id] ?? 0),
        borderColor: C.palette[i % C.palette.length],
        backgroundColor: "transparent",
        fill: false, tension: 0.3, borderWidth: 2, pointRadius: ptRadius,
        pointBackgroundColor: C.palette[i % C.palette.length],
      }));
      yAxisTitle = "Account Balance ($)";
    } else if (chartMode === "ppr") {
      // PPR balance growth chart
      const cyanGrad = ctx.createLinearGradient(0, 0, 0, 340);
      cyanGrad.addColorStop(0, "rgba(6,182,212,0.25)");
      cyanGrad.addColorStop(1, "rgba(6,182,212,0.02)");
      // Total PPR balance line
      datasets.push({
        label: "Total PPR Balance",
        data: sampleData(r => r.totalPPRBalance ?? 0),
        borderColor: C.cyan,
        backgroundColor: cyanGrad,
        fill: true, tension: 0.3, borderWidth: 2.5, pointRadius: ptRadius,
        pointBackgroundColor: C.cyan,
      });
      // Per-PPR lines
      for (let pi = 0; pi < state.pprs.length; pi++) {
        const ppr = state.pprs[pi];
        const color = C.palette[(pi + 1) % C.palette.length];
        datasets.push({
          label: `${ppr.name} Art.151`,
          data: sampleData(r => r.pprBalances?.[ppr.id]?.art151 ?? 0),
          borderColor: color,
          backgroundColor: "transparent",
          fill: false, tension: 0.3, borderWidth: 1.5, pointRadius: 0,
          borderDash: [6, 3],
        });
        datasets.push({
          label: `${ppr.name} Art.185`,
          data: sampleData(r => r.pprBalances?.[ppr.id]?.art185 ?? 0),
          borderColor: `${color}99`,
          backgroundColor: "transparent",
          fill: false, tension: 0.3, borderWidth: 1.5, pointRadius: 0,
          borderDash: [3, 3],
        });
      }
      yAxisTitle = "PPR Balance ($)";
    } else if (chartMode === "snowball") {
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
    } else {
      datasets = state.loans.map((loan, i) => {
        const color = C.palette[i % C.palette.length];
        return {
          label: loan.name,
          data: sampleDataReal(r => r.loanBalances[loan.id] ?? 0),
          borderColor: color,
          backgroundColor: "transparent",
          fill: false, tension: 0.3, borderWidth: 2, pointRadius: ptRadius,
          pointBackgroundColor: color,
        };
      });
      yAxisTitle = "Remaining Balance ($)";
    }

    if (showReal) yAxisTitle += " (real)";

    // Add comparison scenario overlays
    for (let si = 0; si < comparisonScenarios.length; si++) {
      const sc = comparisonScenarios[si];
      const scColor = C.palette[si % C.palette.length];
      const { dataIndices: scIndices } = getChartSamples(sc.sim.months, granularity, sd);
      const scSampleReal = (accessor: (r: MonthRow) => number) =>
        scIndices.map(i => {
          if (i >= sc.sim.months.length) return null;
          const val = accessor(sc.sim.months[i]);
          if (!showReal) return val;
          const monthsElapsed = sc.sim.months[i]?.month ?? 0;
          return val / Math.pow(1 + sensitiveState.config.inflationRate / 100, monthsElapsed / 12);
        });
      const dashStyle = { borderDash: [8, 4] as number[], borderWidth: 1.5, pointRadius: 0, fill: false, backgroundColor: "transparent", tension: 0.3 };

      if (chartMode === "networth") {
        datasets.push({
          label: `${sc.name}`,
          data: scSampleReal(r => r.netWorth),
          borderColor: scColor,
          ...dashStyle,
        });
      } else if (chartMode === "cashflow") {
        datasets.push({
          label: `${sc.name} Income`,
          data: scSampleReal(r => r.totalIncome + r.totalLoanDisbursements),
          borderColor: `${scColor}99`,
          ...dashStyle,
        });
        datasets.push({
          label: `${sc.name} Outflows`,
          data: scSampleReal(r => -(r.totalExpenses + r.totalLoanPayments)),
          borderColor: `${scColor}66`,
          ...dashStyle,
          borderDash: [4, 4],
        });
        datasets.push({
          label: `${sc.name} Net`,
          data: scSampleReal(r => r.netCashflow),
          borderColor: scColor,
          ...dashStyle,
        });
      } else if (chartMode === "balances") {
        for (const acc of sc.state.accounts) {
          datasets.push({
            label: `${sc.name}: ${acc.name}`,
            data: scSampleReal(r => r.accountBalances[acc.id] ?? 0),
            borderColor: `${scColor}99`,
            ...dashStyle,
          });
        }
      } else {
        for (const loan of sc.state.loans) {
          datasets.push({
            label: `${sc.name}: ${loan.name}`,
            data: scSampleReal(r => r.loanBalances[loan.id] ?? 0),
            borderColor: `${scColor}99`,
            ...dashStyle,
          });
        }
      }
    }

    chartInstanceRef.current = new Chart(chartRef.current, {
      type: "line",
      data: { labels, datasets },
      plugins: [milestonePlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          milestones: { items: msItems } as any,
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
            footerColor: isLight ? "#a1a1aa" : "#7d8590",
            footerFont: { family: "monospace", size: 10 },
            callbacks: {
              label: (ctx: any) =>
                ` ${ctx.dataset.label}: ${fmtShort(ctx.parsed.y ?? 0)}`,
              afterBody: (items: any[]) => {
                if (items.length === 0) return [];
                const idx = dataIndices[items[0].dataIndex];
                if (idx == null || !sim.months[idx]) return [];
                const row = sim.months[idx];
                const lines: string[] = [""];
                if (chartMode === "networth" || chartMode === "cashflow") {
                  if (state.incomes.length > 0) {
                    lines.push("── Income ──");
                    for (const inc of state.incomes) {
                      const v = row.incomeBySource[inc.id] ?? 0;
                      if (v > 0) lines.push(`  ${inc.name}: ${fmtShort(v)}`);
                    }
                  }
                  if (state.expenses.length > 0) {
                    lines.push("── Expenses ──");
                    for (const exp of state.expenses) {
                      const v = row.expenseBySource[exp.id] ?? 0;
                      if (v > 0) lines.push(`  ${exp.name}: -${fmtShort(v)}`);
                    }
                  }
                  if (state.loans.length > 0) {
                    if (row.totalLoanDisbursements > 0.01) {
                      lines.push("── Loan Disbursements ──");
                      for (const loan of state.loans) {
                        const disbMonth = loan.disbursementMonth ?? loan.startMonth;
                        if (disbMonth === row.month && row.month > 1 && (loan.type === "personal" || loan.type === "credit-card")) {
                          lines.push(`  ${loan.name}: +${fmtShort(loan.currentBalance)}`);
                        }
                      }
                    }
                    lines.push("── Loan Payments ──");
                    for (const loan of state.loans) {
                      const pmt = row.loanPaymentBySource[loan.id] ?? 0;
                      if (pmt > 0.01) lines.push(`  ${loan.name}: -${fmtShort(pmt)}`);
                    }
                  }
                  if (chartMode === "networth") {
                    lines.push("── Accounts ──");
                    for (const acc of state.accounts) {
                      lines.push(`  ${acc.name}: ${fmtShort(row.accountBalances[acc.id] ?? 0)}`);
                    }
                    if (state.assets.length > 0) {
                      lines.push("── Assets ──");
                      for (const asset of state.assets) {
                        const v = row.assetValues[asset.id] ?? 0;
                        if (v > 0.01) lines.push(`  ${asset.name}: ${fmtShort(v)}`);
                      }
                    }
                    if (state.loans.length > 0) {
                      lines.push("── Remaining Debt ──");
                      for (const loan of state.loans) {
                        const b = row.loanBalances[loan.id] ?? 0;
                        if (b > 0.01) lines.push(`  ${loan.name}: -${fmtShort(b)}`);
                      }
                    }
                  }
                }
                if (row.contributionByParticipant && participants.length > 1) {
                  lines.push("── By Participant ──");
                  for (const p of participants) {
                    const v = row.contributionByParticipant[p.id] ?? 0;
                    lines.push(`  ${p.name}: ${v >= 0 ? "+" : ""}${fmtShort(v)}`);
                  }
                }
                if (row.totalPPRBalance != null && row.totalPPRBalance > 0) {
                  lines.push("── PPR ──");
                  lines.push(`  Balance: ${fmtShort(row.totalPPRBalance)}`);
                  if ((row.totalPPRContributions ?? 0) > 0) {
                    lines.push(`  Contributions: ${fmtShort(row.totalPPRContributions ?? 0)}`);
                  }
                  if ((row.totalPPRRefunds ?? 0) > 0) {
                    lines.push(`  Tax Refund: +${fmtShort(row.totalPPRRefunds ?? 0)}`);
                  }
                }
                return lines;
              },
            },
          },
        },
        scales: {
          x: {
            stacked: chartMode === "snowball",
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
            stacked: chartMode === "snowball",
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
  }, [sim, chartMode, tab, sensitiveState.accounts, sensitiveState.loans, sensitiveState.assets, sensitiveState.pprs, sensitiveState.waterfall, sensitiveState.config.startDate, sensitiveState.config.inflationRate, granularity, getChartSamples, comparisonScenarios, milestones, showMilestones, showReal]);

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
      datasets = state.incomes.map((inc, i) => ({
        label: inc.name,
        data: sampleData(r => r.incomeBySource[inc.id] ?? 0),
        borderColor: C.palette[i % C.palette.length],
        backgroundColor: "transparent",
        fill: false, tension: 0.3, borderWidth: 2, pointRadius: ptRadius,
        pointBackgroundColor: C.palette[i % C.palette.length],
      }));
      // Add total line
      const grad = ctx.createLinearGradient(0, 0, 0, 260);
      grad.addColorStop(0, "rgba(63,182,138,0.15)");
      grad.addColorStop(1, "rgba(63,182,138,0.02)");
      datasets.push({
        label: "Total",
        data: sampleData(r => r.totalIncome),
        borderColor: C.green,
        backgroundColor: grad,
        fill: true, tension: 0.3, borderWidth: 2.5, pointRadius: 0,
        borderDash: [6, 3],
      });
      yAxisTitle = "Monthly Income ($)";
    } else if (tab === "expenses") {
      datasets = state.expenses.map((exp, i) => ({
        label: exp.name,
        data: sampleData(r => r.expenseBySource[exp.id] ?? 0),
        borderColor: C.palette[i % C.palette.length],
        backgroundColor: "transparent",
        fill: false, tension: 0.3, borderWidth: 2, pointRadius: ptRadius,
        pointBackgroundColor: C.palette[i % C.palette.length],
      }));
      // Add total line
      const grad = ctx.createLinearGradient(0, 0, 0, 260);
      grad.addColorStop(0, "rgba(224,92,106,0.15)");
      grad.addColorStop(1, "rgba(224,92,106,0.02)");
      datasets.push({
        label: "Total",
        data: sampleData(r => r.totalExpenses),
        borderColor: C.red,
        backgroundColor: grad,
        fill: true, tension: 0.3, borderWidth: 2.5, pointRadius: 0,
        borderDash: [6, 3],
      });
      yAxisTitle = "Monthly Expenses ($)";
    } else if (tab === "assets") {
      datasets = state.assets.map((asset, i) => ({
        label: asset.name,
        data: sampleData(r => r.assetValues[asset.id] ?? 0),
        borderColor: C.palette[i % C.palette.length],
        backgroundColor: "transparent",
        fill: false, tension: 0.3, borderWidth: 2, pointRadius: ptRadius,
        pointBackgroundColor: C.palette[i % C.palette.length],
      }));
      if (state.assets.length > 1) {
        const grad = ctx.createLinearGradient(0, 0, 0, 260);
        grad.addColorStop(0, "rgba(212,168,67,0.15)");
        grad.addColorStop(1, "rgba(212,168,67,0.02)");
        datasets.push({
          label: "Total",
          data: sampleData(r => r.totalAssetValue),
          borderColor: C.gold,
          backgroundColor: grad,
          fill: true, tension: 0.3, borderWidth: 2.5, pointRadius: 0,
          borderDash: [6, 3],
        });
      }
      yAxisTitle = "Asset Value ($)";
    } else if (tab === "strategy") {
      // Show net worth: base scenario vs current (with sensitivity)
      const baseSim = simulate(state);
      const baseSample = (accessor: (r: MonthRow) => number) =>
        dataIndices.map(i => i < baseSim.months.length ? accessor(baseSim.months[i]) : null);

      if (sensitivity.rateOffset || sensitivity.growthOffset || sensitivity.inflOffset) {
        datasets.push({
          label: "Base Net Worth",
          data: baseSample(r => r.netWorth),
          borderColor: C.muted,
          backgroundColor: "transparent",
          fill: false, tension: 0.3, borderWidth: 2, pointRadius: ptRadius,
          borderDash: [6, 3],
        });
        datasets.push({
          label: "Adjusted Net Worth",
          data: sampleData(r => r.netWorth),
          borderColor: C.gold,
          backgroundColor: "transparent",
          fill: false, tension: 0.3, borderWidth: 2.5, pointRadius: ptRadius,
          pointBackgroundColor: C.gold,
        });
      } else {
        datasets.push({
          label: "Net Worth",
          data: sampleData(r => r.netWorth),
          borderColor: C.gold,
          backgroundColor: "transparent",
          fill: false, tension: 0.3, borderWidth: 2.5, pointRadius: ptRadius,
          pointBackgroundColor: C.gold,
        });
      }
      yAxisTitle = "Net Worth ($)";
    } else if (tab === "ppr") {
      // PPR balance growth per PPR
      const cyanGrad = ctx.createLinearGradient(0, 0, 0, 260);
      cyanGrad.addColorStop(0, "rgba(6,182,212,0.2)");
      cyanGrad.addColorStop(1, "rgba(6,182,212,0.02)");
      datasets.push({
        label: "Total PPR",
        data: sampleData(r => r.totalPPRBalance ?? 0),
        borderColor: C.cyan,
        backgroundColor: cyanGrad,
        fill: true, tension: 0.3, borderWidth: 2.5, pointRadius: 0,
        borderDash: [6, 3],
      });
      for (let pi = 0; pi < state.pprs.length; pi++) {
        const ppr = state.pprs[pi];
        const color = C.palette[pi % C.palette.length];
        datasets.push({
          label: ppr.name,
          data: sampleData(r => (r.pprBalances?.[ppr.id]?.art151 ?? 0) + (r.pprBalances?.[ppr.id]?.art185 ?? 0)),
          borderColor: color,
          backgroundColor: "transparent",
          fill: false, tension: 0.3, borderWidth: 2, pointRadius: ptRadius,
          pointBackgroundColor: color,
        });
      }
      yAxisTitle = "PPR Balance ($)";
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
            display: true,
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
  }, [sim, tab, state.accounts, state.loans, state.incomes, state.expenses, state.assets, state.pprs, state.config.startDate, granularity, getChartSamples, sensitivity, state]);

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
      const end = inc.periodicity === "one-time"
        ? inc.startMonth
        : (inc.endMonth > 0 ? Math.min(inc.endMonth, totalMonths) : totalMonths);
      rows.push({ name: inc.name, start: inc.startMonth, end, color: C.green, section: "INCOME" });
    }

    // EXPENSES section
    for (const exp of state.expenses) {
      const end = exp.frequency === "one-time"
        ? exp.startMonth
        : (exp.endMonth > 0 ? Math.min(exp.endMonth, totalMonths) : totalMonths);
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

    // ASSETS section
    for (const asset of state.assets) {
      rows.push({ name: asset.name, start: asset.startMonth, end: totalMonths, color: C.gold, section: "ASSETS", amortMonths: [] });
    }

    // PPR section
    for (const ppr of state.pprs) {
      const end = ppr.endMonth > 0 ? Math.min(ppr.endMonth, totalMonths) : totalMonths;
      // Collect refund months
      const refundMonths: number[] = [];
      for (let yr = 1; yr <= Math.ceil(totalMonths / 12); yr++) {
        const refM = (yr - 1) * 12 + ppr.refundMonth;
        if (refM >= ppr.startMonth && refM <= end) refundMonths.push(refM);
      }
      rows.push({ name: ppr.name, start: ppr.startMonth, end, color: C.cyan, section: "PPR", amortMonths: refundMonths });
    }

    if (rows.length === 0) return;

    // Layout: align with Chart.js chart area if available
    const dpr = window.devicePixelRatio || 1;
    const containerW = ganttWidth || canvas.parentElement?.clientWidth || 600;
    const chartArea = chartInstanceRef.current?.chartArea;
    const leftPad = chartArea ? chartArea.left : 100;
    const rightPad = chartArea ? Math.max(8, containerW - chartArea.right) : 12;
    const topPad = 24;
    const rowH = 26;
    const sectionHeaderH = 22;
    const bottomPad = 22;

    // Count sections
    const sections = [...new Set(rows.map(r => r.section))];
    const totalRows = rows.length;
    const canvasH = topPad + sections.length * sectionHeaderH + totalRows * rowH + bottomPad;

    canvas.style.width = containerW + "px";
    canvas.style.height = canvasH + "px";
    canvas.width = containerW * dpr;
    canvas.height = canvasH * dpr;
    ctx.scale(dpr, dpr);

    const chartW = containerW - leftPad - rightPad;
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
      ctx.fillText(lbl, x, topPad - 6);
    }
    // Top axis line
    ctx.strokeStyle = isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(leftPad, topPad);
    ctx.lineTo(leftPad + chartW, topPad);
    ctx.stroke();

    // Draw sections and bars
    let y = topPad;
    const sectionColors: Record<string, string> = { INCOME: C.green, EXPENSES: C.red, LOANS: C.blue, ASSETS: C.gold, PPR: C.cyan };

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
        const barY = y + 5;
        const barH = rowH - 10;

        // Entity name (truncated)
        ctx.fillStyle = textColor;
        ctx.font = "11px monospace";
        ctx.textAlign = "right";
        const truncName = row.name.length > 12 ? row.name.slice(0, 11) + "\u2026" : row.name;
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

    // Bottom x-axis line and labels
    ctx.strokeStyle = isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(leftPad, y);
    ctx.lineTo(leftPad + chartW, y);
    ctx.stroke();

    ctx.fillStyle = textColor;
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    for (let m = 0; m <= totalMonths; m += tickInterval) {
      const x = leftPad + m * unitW;
      const lbl = sd ? monthToShortDate(m + 1, sd) : `Mo ${m + 1}`;
      ctx.fillText(lbl, x, y + 14);
    }
  }, [sim, tab, timelineOpen, state.incomes, state.expenses, state.loans, state.assets, state.pprs, state.config.startDate, ganttWidth]);

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

  // ── Deflation helper for yearly table ──
  const deflateYear = (amount: number, year: number) =>
    showReal ? amount / Math.pow(1 + sensitiveState.config.inflationRate / 100, year) : amount;

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
    { key: "assets", label: "Assets" },
    { key: "strategy", label: "Strategy" },
    { key: "ppr", label: "PPR" },
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

      {/* Participants */}
      <div class="mx-1 h-4 w-px bg-[var(--color-border)]" />
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
          Participants
        </span>
        {participants.length > 1 && participants.map(p => (
          <span
            key={p.id}
            class="inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[10px]"
            style={{ borderColor: `${p.color}40`, background: `${p.color}15`, color: p.color }}
          >
            <span class="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
            <input
              type="text"
              value={p.name}
              onInput={(e) => renameParticipant(p.id, (e.target as HTMLInputElement).value)}
              class="w-16 bg-transparent font-mono text-[10px] outline-none"
              style={{ color: p.color }}
            />
            <button
              onClick={() => removeParticipant(p.id)}
              class="ml-0.5 opacity-60 hover:opacity-100"
              style={{ color: p.color }}
            >
              x
            </button>
          </span>
        ))}
        {participantsOpen ? (
          <span class="inline-flex items-center gap-1">
            <input
              type="text"
              value={partName}
              onInput={(e) => setPartName((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => { if ((e as KeyboardEvent).key === "Enter") addParticipant(); }}
              class="w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-light)] px-2 py-1 font-mono text-[10px] text-[var(--color-text)] outline-none"
              placeholder="Name"
            />
            <button
              onClick={addParticipant}
              class="rounded-md border border-[var(--color-border)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)]"
            >
              OK
            </button>
            <button
              onClick={() => setParticipantsOpen(false)}
              class="font-mono text-[10px] text-[var(--color-text-muted)]"
            >
              x
            </button>
          </span>
        ) : (
          <button
            onClick={() => setParticipantsOpen(true)}
            class="rounded-md border border-dashed border-[var(--color-border)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)]"
          >
            + Add
          </button>
        )}
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

      {/* Comparison section */}
      <div class="mx-1 h-4 w-px bg-[var(--color-border)]" />
      <span class="mr-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
        Compare
      </span>
      {toolbarBtn(addComparisonFromCurrent, "Save Current")}
      {toolbarBtn(() => compFileInputRef.current?.click(), "Import Scenario")}
      <input
        ref={compFileInputRef}
        type="file"
        accept=".json"
        onChange={addComparisonFromFile}
        class="hidden"
      />
      {comparisonScenarios.length > 0 && toolbarBtn(() => setComparisonScenarios([]), "Clear All Comparisons", "danger")}

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
          {(() => {
            const latestPayoff = sim.loanPayoffProjections.reduce(
              (max, p) => (p.payoffMonth > max ? p.payoffMonth : max),
              0,
            );
            const debtFreeSub = sim.debtFreeMonth > 0
              ? `Yr ${Math.ceil(sim.debtFreeMonth / 12)}`
              : state.loans.length === 0
                ? "no loans"
                : latestPayoff > 0
                  ? `projected ~Yr ${Math.ceil(latestPayoff / 12)}`
                  : "beyond horizon";
            return (
              <StatCard
                label="Debt-Free"
                value={sim.debtFreeMonth > 0
                  ? (state.config.startDate
                    ? monthToDate(sim.debtFreeMonth, state.config.startDate)
                    : `Month ${sim.debtFreeMonth}`)
                  : "N/A"}
                sub={debtFreeSub}
                color={sim.debtFreeMonth > 0 ? C.green : C.muted}
              />
            );
          })()}
          <StatCard
            label="Interest Earned vs Paid"
            value={fmtShort(sim.totalInterestEarned)}
            sub={`paid: ${fmtShort(sim.totalInterestPaid)}`}
            color={sim.totalInterestEarned > sim.totalInterestPaid ? C.green : C.red}
          />
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
        </div>
      </div>

      {/* PPR Summary KPIs */}
      {state.pprs.length > 0 && sim.months.length > 0 && (() => {
        const lastRow = sim.months[sim.months.length - 1];
        const pprBal = lastRow.totalPPRBalance ?? 0;
        // Estimate annual refund from last year contributions
        let annualContrib = 0;
        const lastYearStart = Math.max(0, sim.months.length - 12);
        for (let i = lastYearStart; i < sim.months.length; i++) {
          annualContrib += sim.months[i].totalPPRContributions ?? 0;
        }
        const avgIsrRate = state.pprs.length > 0 ? state.pprs.reduce((s, p) => s + p.isrRate, 0) / state.pprs.length : 30;
        const estRefund = annualContrib * (avgIsrRate / 100);
        return (
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <CardTitle>PPR Overview</CardTitle>
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                label="PPR Balance"
                value={fmtShort(pprBal)}
                sub="end of horizon"
                color={C.cyan}
              />
              <StatCard
                label="Est. Annual Refund"
                value={fmtShort(estRefund)}
                sub={`~${avgIsrRate.toFixed(0)}% ISR rate`}
                color={C.green}
              />
              <StatCard
                label="Monthly Contributions"
                value={fmtShort(state.pprs.reduce((s, p) => s + p.monthlyArt151 + p.monthlyArt185, 0))}
                sub="Art.151 + Art.185"
                color={C.cyan}
              />
              <StatCard
                label="PPR Plans"
                value={String(state.pprs.length)}
                sub={`avg ${state.pprs.length > 0 ? fmtPct(state.pprs.reduce((s, p) => s + p.annualReturnRate, 0) / state.pprs.length) : "0%"} return`}
              />
            </div>
          </div>
        );
      })()}

      {/* Participant Breakdown */}
      {participants.length > 1 && sim.months.length > 0 && (
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <CardTitle>Participant Breakdown</CardTitle>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {participants.map(p => {
              let totalInc = 0, totalExp = 0, totalLoan = 0, totalContrib = 0;
              for (const row of sim.months) {
                totalInc += row.incomeByParticipant?.[p.id] ?? 0;
                totalExp += row.expenseByParticipant?.[p.id] ?? 0;
                totalLoan += row.loanPaymentByParticipant?.[p.id] ?? 0;
                totalContrib += row.contributionByParticipant?.[p.id] ?? 0;
              }
              const avgContrib = sim.months.length > 0 ? totalContrib / sim.months.length : 0;
              return (
                <div
                  key={p.id}
                  class="rounded-lg border p-3"
                  style={{ borderColor: `${p.color}30`, background: `${p.color}08` }}
                >
                  <div class="mb-2 flex items-center gap-2">
                    <span class="inline-block h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
                    <span class="font-mono text-xs font-medium" style={{ color: p.color }}>{p.name}</span>
                  </div>
                  <div class="space-y-1.5">
                    <div class="flex justify-between font-mono text-[10px]">
                      <span class="text-[var(--color-text-muted)]">Total Income</span>
                      <span style={{ color: C.green }}>{fmtShort(totalInc)}</span>
                    </div>
                    <div class="flex justify-between font-mono text-[10px]">
                      <span class="text-[var(--color-text-muted)]">Total Expenses</span>
                      <span style={{ color: C.red }}>{fmtShort(totalExp)}</span>
                    </div>
                    <div class="flex justify-between font-mono text-[10px]">
                      <span class="text-[var(--color-text-muted)]">Loan Payments</span>
                      <span>{fmtShort(totalLoan)}</span>
                    </div>
                    <div class="flex justify-between border-t border-[var(--color-border)] pt-1.5 font-mono text-[10px]">
                      <span class="text-[var(--color-text-muted)]">Avg Monthly Contrib.</span>
                      <span style={{ color: avgContrib >= 0 ? C.goldLight : C.red }}>{fmtShort(avgContrib)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Comparison Scenarios */}
      {comparisonScenarios.length > 0 && (
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <CardTitle>Scenario Comparison</CardTitle>
          <div class="flex flex-wrap items-center gap-2">
            {/* Current scenario tag */}
            <span
              class="inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[10px]"
              style={{ borderColor: C.goldBorder, background: C.goldDim, color: C.goldLight }}
            >
              <span class="inline-block h-2 w-4 rounded-sm" style={{ background: C.gold, borderBottom: `2px solid ${C.gold}` }} />
              Current
            </span>
            {comparisonScenarios.map((sc, i) => {
              const color = C.palette[i % C.palette.length];
              return (
                <span
                  key={i}
                  class="inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[10px]"
                  style={{ borderColor: `${color}40`, background: `${color}15`, color }}
                >
                  <span class="inline-block h-2 w-4 rounded-sm" style={{ borderBottom: `2px dashed ${color}` }} />
                  <input
                    type="text"
                    value={sc.name}
                    onInput={(e) => renameComparison(i, (e.target as HTMLInputElement).value)}
                    class="w-20 bg-transparent font-mono text-[10px] outline-none"
                    style={{ color }}
                  />
                  <button
                    onClick={() => removeComparison(i)}
                    class="ml-1 opacity-60 hover:opacity-100"
                    style={{ color }}
                  >
                    x
                  </button>
                </span>
              );
            })}
          </div>

          {/* KPI Comparison Table */}
          <div class="mt-4 overflow-x-auto">
            <table class="w-full font-mono text-xs">
              <thead>
                <tr style={{ borderBottom: `1px solid var(--color-border)` }}>
                  <th class="px-2 py-2 text-left font-mono text-[9px] uppercase tracking-wider text-[var(--color-text-muted)]">Metric</th>
                  <th class="px-2 py-2 text-left font-mono text-[9px] uppercase tracking-wider" style={{ color: C.goldLight }}>Current</th>
                  {comparisonScenarios.map((sc, i) => (
                    <th key={i} class="px-2 py-2 text-left font-mono text-[9px] uppercase tracking-wider" style={{ color: C.palette[i % C.palette.length] }}>{sc.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { label: "Final Net Worth", current: sim.finalNetWorth, get: (s: SimulationResult) => s.finalNetWorth, higher: true },
                  { label: "Avg Cashflow", current: sim.avgMonthlyCashflow, get: (s: SimulationResult) => s.avgMonthlyCashflow, higher: true },
                  { label: "Total Assets", current: sim.finalAssets, get: (s: SimulationResult) => s.finalAssets, higher: true },
                  { label: "Total Debt", current: sim.finalDebt, get: (s: SimulationResult) => s.finalDebt, higher: false },
                  { label: "Interest Earned", current: sim.totalInterestEarned, get: (s: SimulationResult) => s.totalInterestEarned, higher: true },
                  { label: "Interest Paid", current: sim.totalInterestPaid, get: (s: SimulationResult) => s.totalInterestPaid, higher: false },
                ].map(metric => (
                  <tr key={metric.label} class="border-b border-[var(--color-border)]">
                    <td class="px-2 py-1.5 text-[var(--color-text-muted)]">{metric.label}</td>
                    <td class="px-2 py-1.5" style={{ color: C.goldLight }}>{fmtShort(metric.current)}</td>
                    {comparisonScenarios.map((sc, i) => {
                      const val = metric.get(sc.sim);
                      const delta = metric.current - val;
                      const better = metric.higher ? delta > 0 : delta < 0;
                      return (
                        <td key={i} class="px-2 py-1.5">
                          <span style={{ color: C.palette[i % C.palette.length] }}>{fmtShort(val)}</span>
                          {Math.abs(delta) > 0.5 && (
                            <span class="ml-1 text-[9px]" style={{ color: better ? C.green : C.red }}>
                              ({delta > 0 ? "+" : ""}{fmtShort(delta)})
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Chart */}
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <CardTitle>Projection</CardTitle>
        <div class="mb-4 flex flex-wrap items-center gap-1">
          {pillBtn(chartMode === "networth", () => setChartMode("networth"), "Net Worth")}
          {pillBtn(chartMode === "cashflow", () => setChartMode("cashflow"), "Cashflow")}
          {pillBtn(chartMode === "balances", () => setChartMode("balances"), "Balances")}
          {pillBtn(chartMode === "debt", () => setChartMode("debt"), "Debt Paydown")}
          {(state.waterfall ?? []).length > 0 && pillBtn(chartMode === "snowball", () => setChartMode("snowball"), "Snowball")}
          {state.pprs.length > 0 && pillBtn(chartMode === "ppr", () => setChartMode("ppr"), "PPR Growth")}
          <div class="mx-2 h-5 w-px bg-[var(--color-border)]" />
          {pillBtn(granularity === "yearly", () => setGranularity("yearly"), "Yearly")}
          {pillBtn(granularity === "quarterly", () => setGranularity("quarterly"), "Quarterly")}
          {pillBtn(granularity === "monthly", () => setGranularity("monthly"), "Monthly")}
          <div class="mx-2 h-5 w-px bg-[var(--color-border)]" />
          {pillBtn(showMilestones, () => setShowMilestones(!showMilestones), "Milestones")}
          {pillBtn(showReal, () => setShowReal(!showReal), showReal ? "Inflation-Adjusted" : "Current $")}
        </div>
        <div style={{ height: "360px", position: "relative" }}>
          <canvas ref={chartRef} />
        </div>
        {showMilestones && milestones.length > 0 && (
          <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {milestones.map((ms, i) => (
              <div key={i} class="flex items-center gap-1.5">
                <span class="inline-flex h-4 w-4 items-center justify-center rounded-full font-mono text-[8px] font-bold text-black" style={{ background: ms.color + "cc" }}>{i + 1}</span>
                <span class="font-mono text-[10px] text-[var(--color-text-muted)]">
                  {ms.label}
                  {state.config.startDate ? ` (${monthToShortDate(ms.month, state.config.startDate)})` : ` Mo ${ms.month}`}
                </span>
              </div>
            ))}
          </div>
        )}
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
                  {["Year", "Income", ...(state.config.taxEnabled ? ["Tax"] : []), "Expenses", "Loan Pmts", "Int. Earned", "Int. Paid", "Assets", "Debt", "Net Worth"].map(h => (
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
                    <td class="px-2 py-1.5" style={{ color: C.green }}>{fmtShort(deflateYear(ys.totalIncome, ys.year))}</td>
                    {state.config.taxEnabled && (
                      <td class="px-2 py-1.5" style={{ color: C.red }}>{fmtShort(ys.totalTaxPaid ?? 0)}</td>
                    )}
                    <td class="px-2 py-1.5" style={{ color: C.red }}>{fmtShort(deflateYear(ys.totalExpenses, ys.year))}</td>
                    <td class="px-2 py-1.5">{fmtShort(deflateYear(ys.totalLoanPayments, ys.year))}</td>
                    <td class="px-2 py-1.5" style={{ color: C.green }}>{fmtShort(ys.interestEarned)}</td>
                    <td class="px-2 py-1.5" style={{ color: C.red }}>{fmtShort(ys.interestPaid)}</td>
                    <td class="px-2 py-1.5" style={{ color: C.blue }}>{fmtShort(deflateYear(ys.endAssets, ys.year))}</td>
                    <td class="px-2 py-1.5" style={{ color: ys.endDebt > 0 ? C.red : C.green }}>{fmtShort(deflateYear(ys.endDebt, ys.year))}</td>
                    <td class="px-2 py-1.5 font-medium" style={{ color: ys.endNetWorth >= 0 ? C.goldLight : C.red }}>{fmtShort(deflateYear(ys.endNetWorth, ys.year))}</td>
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

      {/* Cash Flow Sankey Diagram */}
      <details class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <summary class="cursor-pointer">
          <span class="font-mono text-sm font-medium uppercase tracking-wider" style={{ color: "var(--color-heading)" }}>Cash Flow Diagram</span>
        </summary>
        <div class="mt-3">
          <div class="mb-3 flex items-center gap-2">
            {label("Year")}
            {selectInput(String(sankeyYear), (v) => setSankeyYear(Number(v)),
              sim.yearSummaries.map((_, i) => ({ value: String(i + 1), label: `Year ${i + 1}` }))
            )}
          </div>
          <SankeyChart
            incomes={state.incomes.map(i => ({
              name: i.name,
              amount: sim.months.filter(m => m.year === sankeyYear).reduce((s, m) => s + (m.incomeBySource[i.id] ?? 0), 0),
            })).filter(i => i.amount > 0)}
            expenses={state.expenses.map(e => ({
              name: e.name,
              amount: sim.months.filter(m => m.year === sankeyYear).reduce((s, m) => s + (m.expenseBySource[e.id] ?? 0), 0),
            })).filter(e => e.amount > 0)}
            loanPayments={state.loans.map(l => ({
              name: l.name,
              amount: sim.months.filter(m => m.year === sankeyYear).reduce((s, m) => s + (m.loanPaymentBySource[l.id] ?? 0), 0),
            })).filter(l => l.amount > 0)}
            savings={(() => {
              const ym = sim.months.filter(m => m.year === sankeyYear);
              const totalInc = ym.reduce((s, m) => s + m.totalIncome, 0);
              const totalExp = ym.reduce((s, m) => s + m.totalExpenses, 0);
              const totalLoan = ym.reduce((s, m) => s + m.totalLoanPayments, 0);
              return Math.max(0, totalInc - totalExp - totalLoan);
            })()}
          />
        </div>
      </details>

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
          {participants.length > 1 && (
            <div class="mb-3">
              {label("Owner")}
              {selectInput(String(accOwner), (v) => setAccOwner(Number(v)),
                [{ value: "0", label: "Joint" }, ...participants.map(p => ({ value: String(p.id), label: p.name }))]
              )}
            </div>
          )}
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
                        {participants.length > 1 && (() => {
                          if (!a.ownerId || a.ownerId === 0) return <span class="font-mono text-[9px] text-[var(--color-text-muted)]">Joint</span>;
                          const owner = participants.find(p => p.id === a.ownerId);
                          return owner ? <span class="font-mono text-[9px]" style={{ color: owner.color }}>{owner.name}</span> : null;
                        })()}
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
          {participants.length > 1 && (
            <div class="mb-3">
              {label("Owner")}
              {selectInput(String(loanOwner), (v) => setLoanOwner(Number(v)),
                [{ value: "0", label: "Joint" }, ...participants.map(p => ({ value: String(p.id), label: p.name }))]
              )}
            </div>
          )}
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
              {label("Payments Start")}
              {numInput(loanStart, setLoanStart, { min: 1, max: 360, step: 1 })}
            </div>
          </div>
          {(loanType === "personal" || loanType === "credit-card") && (
            <div class="mb-3">
              {label("Cash Received At (0 = same as payments start)")}
              {numInput(loanDisbursement, setLoanDisbursement, { min: 0, max: 360, step: 1 })}
            </div>
          )}
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
                          {participants.length > 1 && (() => {
                            if (!l.ownerId || l.ownerId === 0) return <span class="font-mono text-[9px] text-[var(--color-text-muted)]">Joint</span>;
                            const owner = participants.find(p => p.id === l.ownerId);
                            return owner ? <span class="font-mono text-[9px]" style={{ color: owner.color }}>{owner.name}</span> : null;
                          })()}
                        </div>
                        <div class="mt-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
                          Bal: {fmtM(l.currentBalance)} | {fmtPct(l.annualRate)} | Pmt: {fmtM(pmt)} | {l.termMonths}mo | {l.paymentInterval}
                          {l.disbursementMonth && l.disbursementMonth !== l.startMonth && (
                            <span> | Cash Mo {l.disbursementMonth} → Pay Mo {l.startMonth}</span>
                          )}
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
                    {(() => {
                      const proj = sim.loanPayoffProjections.find(p => p.loanId === l.id);
                      if (!proj || proj.payoffMonth <= 0) return null;
                      const lbl = state.config.startDate
                        ? monthToDate(proj.payoffMonth, state.config.startDate)
                        : `Month ${proj.payoffMonth}`;
                      return (
                        <div class="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
                          Payoff: {lbl} · Total interest: {fmtShort(proj.totalInterestPaid)}
                        </div>
                      );
                    })()}
                    {/* Refinance section */}
                    <div class="mt-2 border-t border-[var(--color-border)] pt-2">
                      {l.refinance ? (
                        <div class="flex items-center justify-between">
                          <div class="font-mono text-[10px] text-[var(--color-text-muted)]">
                            Refi Mo {l.refinance.month}: {l.refinance.newRate}% / {l.refinance.newTermMonths}mo · Cost: {fmtShort(l.refinance.cost)}
                          </div>
                          {deleteBtn(() => removeRefinance(l.id))}
                        </div>
                      ) : refiLoanId === l.id ? (
                        <div class="space-y-2">
                          <div class="grid grid-cols-2 gap-2">
                            <div>{label("Month")}{numInput(refiMonth, setRefiMonth, { min: 1, max: 600, step: 1 })}</div>
                            <div>{label("New Rate")}{numInput(refiRate, setRefiRate, { suffix: "%", min: 0, max: 100, step: 0.25 })}</div>
                            <div>{label("New Term")}{numInput(refiTerm, setRefiTerm, { suffix: "mo", min: 1, max: 600, step: 1 })}</div>
                            <div>{label("Cost")}{numInput(refiCost, setRefiCost, { prefix: "$", min: 0, step: 1000 })}</div>
                          </div>
                          <div class="flex gap-2">
                            {goldButton(() => applyRefinance(l.id), "Apply")}
                            <button onClick={() => setRefiLoanId(null)} class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 font-mono text-[10px] text-[var(--color-text-muted)] hover:text-red-400">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => { setRefiLoanId(l.id); setRefiMonth(24); setRefiRate(l.annualRate - 2); setRefiTerm(l.termMonths); setRefiCost(50000); }}
                          class="font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)]">
                          + Refinance
                        </button>
                      )}
                    </div>
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
          <div class={participants.length > 1 ? "mb-3 grid grid-cols-2 gap-3" : "mb-3"}>
            <div>
              {label("Source Name")}
              {textInput(incName, setIncName)}
            </div>
            {participants.length > 1 && (
              <div>
                {label("Owner")}
                {selectInput(String(incOwner || participants[0].id), (v) => setIncOwner(Number(v)),
                  participants.map(p => ({ value: String(p.id), label: p.name }))
                )}
              </div>
            )}
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
          {incPeriodicity === "annually" && state.config.startDate && (
            <div class="mb-3">
              {label("Calendar Month")}
              {selectInput(String(incCalendarMonth), (v) => setIncCalendarMonth(Number(v)),
                [{ value: "0", label: "Auto (from start month)" },
                 ...Array.from({ length: 12 }, (_, i) => ({
                   value: String(i + 1),
                   label: MONTH_SHORT[i],
                 }))]
              )}
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
          {state.config.taxEnabled && (
            <div class="mb-4">
              {label("Tax Category")}
              {selectInput(incTaxCategory, (v) => setIncTaxCategory(v as TaxCategory), [
                { value: "salary", label: "Salary (ISR table)" },
                { value: "aguinaldo", label: "Aguinaldo (30 UMA exempt)" },
                { value: "ptu", label: "PTU (15 UMA exempt)" },
                { value: "bonus", label: "Bonus (no exemption)" },
                { value: "exempt", label: "Exempt (no tax)" },
              ])}
            </div>
          )}
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
                      {participants.length > 1 && (() => {
                        const owner = participants.find(p => p.id === inc.ownerId) ?? participants[0];
                        return (
                          <span class="inline-flex items-center gap-1 font-mono text-[9px]" style={{ color: owner.color }}>
                            <span class="inline-block h-1.5 w-1.5 rounded-full" style={{ background: owner.color }} />
                            {owner.name}
                          </span>
                        );
                      })()}
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
          {expFreq === "annually" && state.config.startDate && (
            <div class="mb-3">
              {label("Calendar Month")}
              {selectInput(String(expCalendarMonth), (v) => setExpCalendarMonth(Number(v)),
                [{ value: "0", label: "Auto (from start month)" },
                 ...Array.from({ length: 12 }, (_, i) => ({
                   value: String(i + 1),
                   label: MONTH_SHORT[i],
                 }))]
              )}
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
          {participants.length > 1 && (
            <div class="mb-3">
              {label("Split Mode")}
              {selectInput(expSplitMode, (v) => setExpSplitMode(v as SplitMode), [
                { value: "equal", label: "Equal Split" },
                { value: "owner", label: "Single Owner" },
                { value: "proportional", label: "Proportional to Income" },
                { value: "custom", label: "Custom Percentages" },
              ])}
              {expSplitMode === "owner" && (
                <div class="mt-2">
                  {label("Paid by")}
                  {selectInput(
                    String(expSplitParticipants[0] ?? participants[0].id),
                    (v) => setExpSplitParticipants([Number(v)]),
                    participants.map(p => ({ value: String(p.id), label: p.name }))
                  )}
                </div>
              )}
              {(expSplitMode === "equal" || expSplitMode === "proportional") && (
                <div class="mt-2">
                  {label("Shared by")}
                  <div class="flex flex-wrap gap-1">
                    {participants.map(p => {
                      const sel = expSplitParticipants.length === 0 || expSplitParticipants.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          onClick={() => {
                            if (sel) {
                              const next = (expSplitParticipants.length === 0 ? participants.map(pp => pp.id) : expSplitParticipants).filter(id => id !== p.id);
                              setExpSplitParticipants(next.length === 0 ? [] : next);
                            } else {
                              setExpSplitParticipants([...expSplitParticipants, p.id]);
                            }
                          }}
                          class="rounded-md px-2 py-1 font-mono text-[10px] transition-colors"
                          style={{
                            background: sel ? `${p.color}20` : "transparent",
                            border: sel ? `1px solid ${p.color}50` : "1px solid var(--color-border)",
                            color: sel ? p.color : "var(--color-text-muted)",
                          }}
                        >
                          {p.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {expSplitMode === "custom" && (
                <div class="mt-2 space-y-2">
                  {participants.map(p => (
                    <div key={p.id} class="flex items-center gap-2">
                      <span
                        class="w-16 truncate font-mono text-[10px]"
                        style={{ color: p.color }}
                      >
                        {p.name}
                      </span>
                      <div class="flex-1">
                        {numInput(
                          expCustomShares[p.id] ?? 0,
                          (v) => setExpCustomShares(prev => ({ ...prev, [p.id]: v })),
                          { suffix: "%", min: 0, max: 100, step: 1 }
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
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
                        {participants.length > 1 && exp.split && (() => {
                          const s = exp.split;
                          if (s.mode === "owner") {
                            const owner = participants.find(p => p.id === s.participantIds[0]) ?? participants[0];
                            return <span class="font-mono text-[9px]" style={{ color: owner.color }}>Owner: {owner.name}</span>;
                          }
                          if (s.mode === "equal") return <span class="font-mono text-[9px] text-[var(--color-text-muted)]">Equal</span>;
                          if (s.mode === "proportional") return <span class="font-mono text-[9px] text-[var(--color-text-muted)]">Proportional</span>;
                          if (s.mode === "custom" && s.customShares) {
                            const vals = s.participantIds.map(pid => s.customShares?.[pid] ?? 0);
                            const total = vals.reduce((a, b) => a + b, 0);
                            if (total > 0) {
                              const pcts = vals.map(v => Math.round(v / total * 100));
                              return <span class="font-mono text-[9px] text-[var(--color-text-muted)]">{pcts.join("/")}</span>;
                            }
                          }
                          return null;
                        })()}
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
  // PPR Tab
  // ════════════════════════════════════════════════════════════════════

  // Assets Tab
  const totalAssetValue = useMemo(() => state.assets.reduce((s, a) => s + a.value, 0), [state.assets]);

  const renderAssets = () => (
    <div class="grid grid-cols-1 items-start gap-5 lg:grid-cols-[380px_1fr]">
      <div class="space-y-4">
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <CardTitle>{editingAssetId !== null ? "Edit Asset" : "Add Asset"}</CardTitle>
          <div class="mb-3">
            {label("Asset Name")}
            {textInput(assetName, setAssetName)}
          </div>
          <div class="mb-3">
            {label("Type")}
            {selectInput(assetType, (v) => setAssetType(v as AssetType), [
              { value: "property", label: "Property" },
              { value: "vehicle", label: "Vehicle" },
              { value: "other", label: "Other" },
            ])}
          </div>
          <div class="mb-3 grid grid-cols-2 gap-3">
            <div>
              {label("Current Value")}
              {numInput(assetValue, setAssetValue, { prefix: "$", min: 0, step: 10000 })}
            </div>
            <div>
              {label("Annual Appreciation")}
              {numInput(assetAppreciation, setAssetAppreciation, { suffix: "%", min: -50, max: 50, step: 0.5 })}
            </div>
          </div>
          <div class="mb-4">
            {label("Acquired at Month")}
            {numInput(assetStart, setAssetStart, { min: 1, max: 600, step: 1 })}
          </div>
          {editingAssetId !== null ? (
            <div class="flex gap-2">
              {goldButton(saveAsset, "Save Changes")}
              <button onClick={cancelEditAsset} class="w-full rounded-lg border border-[var(--color-border)] px-3 py-2.5 font-mono text-xs uppercase tracking-wider text-[var(--color-text-muted)] transition-colors hover:border-red-500 hover:text-red-400">
                Cancel
              </button>
            </div>
          ) : goldButton(saveAsset, "Add Asset")}
        </div>

        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <CardTitle>Your Assets</CardTitle>
          <div class="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {state.assets.length === 0 ? (
              <p class="py-3 text-center font-mono text-xs text-[var(--color-text-muted)]">
                No assets yet. Add one above.
              </p>
            ) : (
              state.assets.map((a) => {
                const tc = ASSET_TYPE_COLORS[a.type];
                return (
                  <div key={a.id} class="flex items-center justify-between rounded-lg border px-3 py-2" style={{ borderColor: tc.border, background: tc.bg }}>
                    <div>
                      <div class="font-mono text-xs font-medium" style={{ color: tc.color }}>{a.name}</div>
                      <div class="font-mono text-[10px] text-[var(--color-text-muted)]">
                        {fmtShort(a.value)} · {a.annualAppreciation >= 0 ? "+" : ""}{a.annualAppreciation}%/yr · Mo {a.startMonth}
                      </div>
                    </div>
                    <div class="flex gap-1">
                      {editBtn(() => startEditAsset(a), editingAssetId === a.id)}
                      {deleteBtn(() => removeAsset(a.id))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <CardTitle>Asset Summary</CardTitle>
          <div class="grid grid-cols-2 gap-3">
            <StatCard label="Total Value" value={fmtShort(totalAssetValue)} sub="current" color={C.gold} />
            <StatCard
              label="End Value"
              value={fmtShort(sim.months.length > 0 ? sim.months[sim.months.length - 1].totalAssetValue : 0)}
              sub="projected"
              color={C.goldLight}
            />
          </div>
        </div>

      </div>

      {/* Right: chart */}
      <div class="space-y-4">
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <div class="mb-3 flex items-center justify-between">
            <CardTitle>Asset Value Over Time</CardTitle>
            <div class="flex gap-1">
              {pillBtn(granularity === "yearly", () => setGranularity("yearly"), "Yearly")}
              {pillBtn(granularity === "quarterly", () => setGranularity("quarterly"), "Quarterly")}
              {pillBtn(granularity === "monthly", () => setGranularity("monthly"), "Monthly")}
            </div>
          </div>
          <div style={{ height: "320px", position: "relative" }}>
            <canvas ref={tabChartRef} />
          </div>
        </div>
      </div>
    </div>
  );

  const renderStrategy = () => (
    <div class="grid grid-cols-1 items-start gap-5 lg:grid-cols-[380px_1fr]">
      <div class="space-y-4">
        {/* ISR Tax Config */}
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <CardTitle>Tax Settings (Mexican ISR)</CardTitle>
          <p class="mb-3 font-mono text-[10px] text-[var(--color-text-muted)]">
            When enabled, income is reduced by Mexican payroll tax (ISR). Each income source can have a tax category that determines exemptions.
          </p>
          <label class="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={state.config.taxEnabled ?? false}
              onChange={(e) => setState(s => ({ ...s, config: { ...s.config, taxEnabled: (e.target as HTMLInputElement).checked } }))}
              class="accent-[#d4a843]"
            />
            <span class="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Enable ISR Tax
            </span>
          </label>
          {state.config.taxEnabled && (
            <div class="mt-3">
              {label("UMA Diario")}
              {numInput(state.config.umaDiario ?? DEFAULT_UMA_DIARIO, (v) => setConfig({ umaDiario: v }), {
                prefix: "$",
                min: 50,
                max: 300,
                step: 0.01,
              })}
            </div>
          )}
        </div>

        {/* Cash Waterfall Config */}
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <CardTitle>Cash Waterfall</CardTitle>
          <p class="mb-3 font-mono text-[10px] text-[var(--color-text-muted)]">
            Configure how monthly surplus is distributed. Steps execute in order.
          </p>
          <div class="mb-3 flex max-h-48 flex-col gap-2 overflow-y-auto">
            {(state.waterfall ?? []).length === 0 ? (
              <p class="py-2 text-center font-mono text-[10px] text-[var(--color-text-muted)]">
                No rules — surplus goes to checking.
              </p>
            ) : (
              (state.waterfall ?? []).map((step, i) => (
                <div key={step.id} class="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
                  <div class="font-mono text-xs">
                    <span class="font-medium" style={{ color: step.type === "fill-account" ? C.blue : C.green }}>
                      {i + 1}. {step.type === "fill-account" ? "Fill" : "Pay debt"}
                    </span>
                    {step.type === "fill-account" && (
                      <span class="text-[var(--color-text-muted)]">
                        {" → "}{state.accounts.find(a => a.id === step.accountId)?.name ?? "?"}
                        {step.targetBalance ? ` (to ${fmtShort(step.targetBalance)})` : " (unlimited)"}
                      </span>
                    )}
                    {step.type === "pay-debt" && (
                      <span class="text-[var(--color-text-muted)]">
                        {" → "}{step.debtStrategy === "highest-rate" ? "highest rate first" : "lowest balance first"}
                      </span>
                    )}
                  </div>
                  <div class="flex gap-1">
                    <button onClick={() => moveWaterfallStep(step.id, -1)} class="rounded px-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title="Move up">↑</button>
                    <button onClick={() => moveWaterfallStep(step.id, 1)} class="rounded px-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title="Move down">↓</button>
                    {deleteBtn(() => removeWaterfallStep(step.id))}
                  </div>
                </div>
              ))
            )}
          </div>
          <div class="space-y-2 border-t border-[var(--color-border)] pt-3">
            <div class="grid grid-cols-2 gap-2">
              {selectInput(wfStepType, (v) => setWfStepType(v as any), [
                { value: "fill-account", label: "Fill Account" },
                { value: "pay-debt", label: "Pay Debt" },
              ])}
              {wfStepType === "fill-account" ? (
                selectInput(String(wfAccountId || state.accounts[0]?.id || 0), (v) => setWfAccountId(Number(v)),
                  state.accounts.map(a => ({ value: String(a.id), label: a.name }))
                )
              ) : (
                selectInput(wfDebtStrategy, (v) => setWfDebtStrategy(v as any), [
                  { value: "highest-rate", label: "Highest Rate" },
                  { value: "lowest-balance", label: "Lowest Balance" },
                ])
              )}
            </div>
            {wfStepType === "fill-account" && (
              <div>
                {label("Target Balance (0 = unlimited)")}
                {numInput(wfTarget, setWfTarget, { prefix: "$", min: 0, step: 10000 })}
              </div>
            )}
            {goldButton(addWaterfallStep, "Add Step")}
          </div>
        </div>

        {/* What-If Sensitivity */}
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <CardTitle>What-If Sensitivity</CardTitle>
          <p class="mb-3 font-mono text-[10px] text-[var(--color-text-muted)]">
            Adjust parameters to see how changes affect your projection. The chart shows the adjusted scenario.
          </p>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <div class="flex flex-col items-center justify-end gap-2">
              <button
                onClick={() => setSensitivity({ rateOffset: 0, growthOffset: 0, inflOffset: 0 })}
                class="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                Reset
              </button>
              {(sensitivity.rateOffset || sensitivity.growthOffset || sensitivity.inflOffset) ? (
                <button onClick={() => {
                  const name = `Rate ${sensitivity.rateOffset >= 0 ? "+" : ""}${sensitivity.rateOffset}%, Growth ${sensitivity.growthOffset >= 0 ? "+" : ""}${sensitivity.growthOffset}%`;
                  setComparisonScenarios(prev => [...prev, { name, state: sensitiveState, sim }]);
                  setSensitivity({ rateOffset: 0, growthOffset: 0, inflOffset: 0 });
                }}
                class="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] hover:text-[var(--color-accent)]">
                  Save as Scenario
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Right: chart showing base vs adjusted */}
      <div class="space-y-4">
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <div class="mb-3 flex items-center justify-between">
            <CardTitle>Impact Preview</CardTitle>
            <div class="flex gap-1">
              {pillBtn(granularity === "yearly", () => setGranularity("yearly"), "Yearly")}
              {pillBtn(granularity === "quarterly", () => setGranularity("quarterly"), "Quarterly")}
              {pillBtn(granularity === "monthly", () => setGranularity("monthly"), "Monthly")}
            </div>
          </div>
          <div style={{ height: "320px", position: "relative" }}>
            <canvas ref={tabChartRef} />
          </div>
        </div>
      </div>
    </div>
  );

  const renderPpr = () => {
    // Compute PPR summary stats
    const lastRow = sim.months.length > 0 ? sim.months[sim.months.length - 1] : null;
    const totalPprBalance = lastRow?.totalPPRBalance ?? 0;
    const totalArt151 = state.pprs.reduce((s, p) => s + p.monthlyArt151, 0);
    const totalArt185 = state.pprs.reduce((s, p) => s + p.monthlyArt185, 0);
    const avgReturn = state.pprs.length > 0 ? state.pprs.reduce((s, p) => s + p.annualReturnRate, 0) / state.pprs.length : 0;
    // Estimate tax benefit
    let annualContrib = 0;
    const startIdx = Math.max(0, sim.months.length - 12);
    for (let i = startIdx; i < sim.months.length; i++) {
      annualContrib += sim.months[i]?.totalPPRContributions ?? 0;
    }
    const avgIsrRate = state.pprs.length > 0 ? state.pprs.reduce((s, p) => s + p.isrRate, 0) / state.pprs.length : 30;
    const estAnnualRefund = annualContrib * (avgIsrRate / 100);
    // Total interest earned from PPR
    let totalPprInterest = 0;
    for (const row of sim.months) {
      if (row.pprInterestEarned) {
        for (const v of Object.values(row.pprInterestEarned)) totalPprInterest += v;
      }
    }

    return (
      <div class="grid grid-cols-1 items-start gap-5 lg:grid-cols-[380px_1fr]">
        {/* Left: form + list */}
        <div class="space-y-4">
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <CardTitle>{editingPprId !== null ? "Edit PPR" : "Add PPR Plan"}</CardTitle>
            <div class="mb-3">
              {label("Plan Name")}
              {textInput(pprName, setPprName)}
            </div>
            {participants.length > 1 && (
              <div class="mb-3">
                {label("Owner")}
                {selectInput(String(pprOwner), (v) => setPprOwner(Number(v)),
                  [{ value: "0", label: "Joint" }, ...participants.map(p => ({ value: String(p.id), label: p.name }))]
                )}
              </div>
            )}
            <div class="mb-3 grid grid-cols-2 gap-3">
              <div>
                {label("Monthly Art.151")}
                {numInput(pprMonthly151, setPprMonthly151, { prefix: "$", min: 0, step: 500 })}
              </div>
              <div>
                {label("Monthly Art.185")}
                {numInput(pprMonthly185, setPprMonthly185, { prefix: "$", min: 0, step: 500 })}
              </div>
            </div>
            <div class="mb-3 grid grid-cols-2 gap-3">
              <div>
                {label("Annual Return Rate")}
                {numInput(pprReturnRate, setPprReturnRate, { suffix: "%", min: 0, max: 30, step: 0.5 })}
              </div>
              <div>
                {label("Compound Interval")}
                {selectInput(pprCompound, (v) => setPprCompound(v as CompoundInterval), [
                  { value: "daily", label: "Daily" },
                  { value: "monthly", label: "Monthly" },
                  { value: "quarterly", label: "Quarterly" },
                  { value: "annually", label: "Annually" },
                ])}
              </div>
            </div>
            <div class="mb-3 grid grid-cols-2 gap-3">
              <div>
                {label("ISR Rate")}
                {numInput(pprIsrRate, setPprIsrRate, { suffix: "%", min: 0, max: 50, step: 1 })}
              </div>
              <div>
                {label("Refund Month")}
                {selectInput(String(pprRefundMonth), (v) => setPprRefundMonth(Number(v)),
                  MONTH_NAMES.slice(1).map((m, i) => ({ value: String(i + 1), label: m }))
                )}
              </div>
            </div>
            <div class="mb-3">
              {label("Other Art.151 Deductions (annual)")}
              {numInput(pprOtherArt151, setPprOtherArt151, { prefix: "$", min: 0, step: 1000 })}
            </div>
            <div class="mb-3 grid grid-cols-2 gap-3">
              <div>
                {label("Start Month")}
                {numInput(pprStart, setPprStart, { min: 1, step: 1 })}
              </div>
              <div>
                {label("End Month (0 = never)")}
                {numInput(pprEnd, setPprEnd, { min: 0, step: 1 })}
              </div>
            </div>
            <div class="mb-4 grid grid-cols-2 gap-3">
              <div>
                {label("Initial Balance Art.151")}
                {numInput(pprInitBal151, setPprInitBal151, { prefix: "$", min: 0, step: 1000 })}
              </div>
              <div>
                {label("Initial Balance Art.185")}
                {numInput(pprInitBal185, setPprInitBal185, { prefix: "$", min: 0, step: 1000 })}
              </div>
            </div>
            {editingPprId !== null ? (
              <div class="flex gap-2">
                {goldButton(savePpr, "Save Changes")}
                <button onClick={cancelEditPpr} class="w-full rounded-lg border border-[var(--color-border)] px-3 py-2.5 font-mono text-xs uppercase tracking-wider text-[var(--color-text-muted)] transition-colors hover:border-red-500 hover:text-red-400">
                  Cancel
                </button>
              </div>
            ) : goldButton(savePpr, "Add PPR Plan")}
          </div>

          {/* PPR list */}
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <CardTitle>Your PPR Plans</CardTitle>
            <div class="flex max-h-80 flex-col gap-2 overflow-y-auto">
              {state.pprs.length === 0 ? (
                <p class="py-3 text-center font-mono text-xs text-[var(--color-text-muted)]">
                  No PPR plans yet. Add one above.
                </p>
              ) : (
                state.pprs.map((p) => (
                  <div
                    key={p.id}
                    class="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2"
                  >
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="truncate font-mono text-sm text-[var(--color-text)]">
                          {p.name}
                        </span>
                        {badge("PPR", { color: C.cyan, bg: "rgba(6,182,212,0.15)", border: "rgba(6,182,212,0.25)" })}
                        {participants.length > 1 && (() => {
                          if (!p.ownerId || p.ownerId === 0) return <span class="font-mono text-[9px] text-[var(--color-text-muted)]">Joint</span>;
                          const owner = participants.find(pt => pt.id === p.ownerId);
                          return owner ? <span class="font-mono text-[9px]" style={{ color: owner.color }}>{owner.name}</span> : null;
                        })()}
                      </div>
                      <div class="mt-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
                        Art.151: {fmtM(p.monthlyArt151)}/mo | Art.185: {fmtM(p.monthlyArt185)}/mo | {fmtPct(p.annualReturnRate)} return
                      </div>
                    </div>
                    {editBtn(() => startEditPpr(p), editingPprId === p.id)}
                    {deleteBtn(() => removePpr(p.id))}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right: summary + charts */}
        <div class="space-y-4">
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <CardTitle>PPR Summary</CardTitle>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatCard
                label="Total PPR Balance"
                value={fmtShort(totalPprBalance)}
                sub="end of projection"
                color={C.cyan}
              />
              <StatCard
                label="Monthly Contributions"
                value={fmtM(totalArt151 + totalArt185)}
                sub={`Art.151: ${fmtM(totalArt151)} | Art.185: ${fmtM(totalArt185)}`}
                color={C.cyan}
              />
              <StatCard
                label="Avg Return Rate"
                value={fmtPct(avgReturn)}
                sub={`${state.pprs.length} plan${state.pprs.length !== 1 ? "s" : ""}`}
              />
            </div>
          </div>

          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <CardTitle>Tax Benefit Breakdown</CardTitle>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatCard
                label="Est. Annual Tax Refund"
                value={fmtShort(estAnnualRefund)}
                sub={`at ~${avgIsrRate.toFixed(0)}% ISR`}
                color={C.green}
              />
              <StatCard
                label="Total Interest Earned"
                value={fmtShort(totalPprInterest)}
                sub="over projection"
                color={C.green}
              />
              <StatCard
                label="Art.151 Annual Cap"
                value={fmtM(state.config.umaAnnual ?? 206368)}
                sub={`Art.185 cap: ${fmtM(state.config.art185AnnualCap ?? 152000)}`}
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
  };

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
      {tab === "assets" && renderAssets()}
      {tab === "strategy" && renderStrategy()}
      {tab === "ppr" && renderPpr()}
    </div>
  );
}
