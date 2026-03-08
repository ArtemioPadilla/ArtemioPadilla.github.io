/**
 * Shared amortization engine for financial lab tools.
 *
 * French amortization (fixed-payment) formula:
 *   M = P * [r(1+r)^n] / [(1+r)^n - 1]
 */

// ─── Types ────────────────────────────────────────────────────────────

export interface LoanAmortization {
  id: number;
  type: "one-time" | "periodic";
  amount: number;
  effect: "reduce-term" | "reduce-payment";
  month?: number;
  startMonth?: number;
  endMonth?: number;
  frequency?: number;
}

// ─── Payment calculation ──────────────────────────────────────────────

export function calcLoanPayment(
  balance: number,
  monthlyRate: number,
  remainingMonths: number,
): number {
  if (balance <= 0) return 0;
  if (monthlyRate === 0)
    return remainingMonths > 0 ? balance / remainingMonths : 0;
  if (remainingMonths <= 0) return 0;
  const r = monthlyRate;
  const n = remainingMonths;
  return (balance * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

// ─── Amortization check ──────────────────────────────────────────────

export function getAmortizationForMonth(
  amortizations: LoanAmortization[],
  month: number,
  totalMonths: number,
): { amount: number; effect: "reduce-term" | "reduce-payment" } | null {
  let total = 0;
  let effect: "reduce-term" | "reduce-payment" = "reduce-term";
  for (const a of amortizations) {
    let applies = false;
    if (a.type === "one-time") {
      applies = a.month === month;
    } else {
      const start = a.startMonth ?? 1;
      const end = a.endMonth && a.endMonth > 0 ? a.endMonth : totalMonths;
      const freq = a.frequency ?? 12;
      applies = month >= start && month <= end && (month - start) % freq === 0;
    }
    if (applies) {
      total += a.amount;
      effect = a.effect;
    }
  }
  return total > 0 ? { amount: total, effect } : null;
}
