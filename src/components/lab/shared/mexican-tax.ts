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
  { lowerLimit: 0.01,     upperLimit: 746.04,      fixedFee: 0,         rate: 0.0192 },
  { lowerLimit: 746.05,   upperLimit: 6332.05,     fixedFee: 14.32,     rate: 0.0640 },
  { lowerLimit: 6332.06,  upperLimit: 11128.01,    fixedFee: 371.83,    rate: 0.1088 },
  { lowerLimit: 11128.02, upperLimit: 12935.82,    fixedFee: 893.63,    rate: 0.16   },
  { lowerLimit: 12935.83, upperLimit: 15487.71,    fixedFee: 1182.88,   rate: 0.1792 },
  { lowerLimit: 15487.72, upperLimit: 31236.49,    fixedFee: 1640.18,   rate: 0.2136 },
  { lowerLimit: 31236.50, upperLimit: 49233.00,    fixedFee: 5004.12,   rate: 0.2352 },
  { lowerLimit: 49233.01, upperLimit: 93993.90,    fixedFee: 9236.89,   rate: 0.30   },
  { lowerLimit: 93993.91, upperLimit: 125325.20,   fixedFee: 22665.17,  rate: 0.32   },
  { lowerLimit: 125325.21, upperLimit: 375975.61,  fixedFee: 32691.18,  rate: 0.34   },
  { lowerLimit: 375975.62, upperLimit: Infinity,   fixedFee: 117912.32, rate: 0.35   },
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
  // Use lowerLimit-only search to avoid floating-point gaps between brackets
  let bracket = table[0];
  for (const b of table) {
    if (taxableIncome >= b.lowerLimit) bracket = b;
    else break;
  }
  return bracket.fixedFee + (taxableIncome - bracket.lowerLimit) * bracket.rate;
}

export function calcEmploymentSubsidy(taxableIncome: number): number {
  let row = SUBSIDY_MONTHLY_2025[0];
  for (const r of SUBSIDY_MONTHLY_2025) {
    if (taxableIncome >= r.lowerLimit) row = r;
    else break;
  }
  return row?.subsidy ?? 0;
}

export function calcNetMonthlyIsr(grossMonthly: number): number {
  const isr = calcMonthlyIsr(grossMonthly);
  const subsidy = calcEmploymentSubsidy(grossMonthly);
  return Math.max(0, isr - subsidy);
}

/** Aguinaldo: first 30 * UMA daily value is exempt.
 *  Simplified: taxes remainder via monthly ISR table. Real SAT procedure uses
 *  Art. 96 proportional method which yields a lower effective rate. */
export function calcAguinaldoTax(amount: number, umaDiario: number): number {
  const exempt = 30 * umaDiario;
  const taxable = Math.max(0, amount - exempt);
  return calcMonthlyIsr(taxable);
}

/** PTU: first 15 * UMA daily value is exempt.
 *  Simplified: same approach as aguinaldo — real procedure uses proportional method. */
export function calcPtuTax(amount: number, umaDiario: number): number {
  const exempt = 15 * umaDiario;
  const taxable = Math.max(0, amount - exempt);
  return calcMonthlyIsr(taxable);
}

export const DEFAULT_UMA_DIARIO = 113.14; // 2025 value
