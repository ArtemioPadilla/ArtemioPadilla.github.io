/**
 * Loan payoff projection beyond the simulation horizon.
 *
 * Projects when a loan will be fully paid off even if the
 * simulation horizon ends before term completion.
 */

import {
  calcLoanPayment,
  getAmortizationForMonth,
  type LoanAmortization,
} from "./amortization";

// ─── Types ────────────────────────────────────────────────────────────

export interface PayoffProjection {
  loanId: number;
  /** Absolute month from sim start when loan reaches zero (0 = already paid within horizon, -1 = not paid within projection) */
  payoffMonth: number;
  totalInterestPaid: number;
  totalPaid: number;
}

// ─── Projection ──────────────────────────────────────────────────────

export function projectPayoff(
  loanId: number,
  balance: number,
  annualRate: number,
  termMonths: number,
  startMonth: number,
  paymentInterval: "monthly" | "biweekly",
  amortizations: LoanAmortization[],
  currentMonth: number,
  maxProjectionMonths: number,
): PayoffProjection {
  if (balance <= 0.01)
    return { loanId, payoffMonth: 0, totalInterestPaid: 0, totalPaid: 0 };

  const r = annualRate / 100 / 12;
  let bal = balance;
  let fixedPmt = calcLoanPayment(
    bal,
    r,
    Math.max(1, termMonths - (currentMonth - startMonth)),
  );
  let totalInterest = 0;
  let totalPaid = 0;

  for (let m = currentMonth + 1; m <= currentMonth + maxProjectionMonths; m++) {
    if (bal <= 0.01)
      return {
        loanId,
        payoffMonth: m - 1,
        totalInterestPaid: totalInterest,
        totalPaid,
      };

    const monthsElapsed = m - startMonth;
    const remaining = Math.max(0, termMonths - monthsElapsed);

    // Past end of term — pay off remaining balance in one shot
    if (remaining <= 0 && bal > 0.01) {
      const interest = bal * r;
      totalInterest += interest;
      totalPaid += bal + interest;
      return {
        loanId,
        payoffMonth: m,
        totalInterestPaid: totalInterest,
        totalPaid,
      };
    }

    let payment = fixedPmt;
    if (paymentInterval === "biweekly") payment = (payment * 13) / 12;
    payment = Math.min(payment, bal + bal * r);

    const interest = bal * r;
    const principal = Math.min(payment - interest, bal);
    totalInterest += interest;
    totalPaid += interest + Math.max(0, principal);
    bal = Math.max(0, bal - Math.max(0, principal));

    const amort = getAmortizationForMonth(
      amortizations,
      m,
      currentMonth + maxProjectionMonths,
    );
    if (amort && bal > 0.01) {
      const amortReal = Math.min(amort.amount, bal);
      bal -= amortReal;
      totalPaid += amortReal;
      if (amort.effect === "reduce-payment" && bal > 0.01) {
        fixedPmt = calcLoanPayment(
          bal,
          r,
          Math.max(1, termMonths - monthsElapsed),
        );
      }
    }
  }

  return { loanId, payoffMonth: -1, totalInterestPaid: totalInterest, totalPaid };
}
