# Finance Simulator — Future Improvements

## Implemented (current session)

### Bug Fixes
- **Biweekly payment calculation**: Was 2x too high (`payment * 26/12` instead of `payment * 13/12`)
- **Loan disbursement cashflow**: Future loans (startMonth > 1) now correctly model cash inflows. Personal/credit-card loans disburse cash to the borrower; mortgage/auto loans activate debt only (cash goes to seller/dealer)
- **Deferred debt for future loans**: Loan balance is 0 until startMonth, preventing phantom debt on the balance sheet

### New Features
- **Asset tracking**: Property, vehicle, and other assets with annual appreciation. Included in net worth, charts, tooltips, timeline, and CSV export
- **Cash distribution waterfall**: Configurable priority-based surplus routing (fill accounts to target, pay highest-rate/lowest-balance debt). Replaces the default "everything to checking" behavior
- **Milestone markers on charts**: Auto-detected vertical markers for loan starts/payoffs, large one-time events, extra payment starts, and asset acquisitions. Toggleable via "Milestones" button

---

## Documented for future implementation

### 1. Tax Modeling (Mexican ISR)

**Impact**: High — incomes are currently gross; the sim overstates disposable income.

**What to build**:
- ISR bracket calculator for Mexican tax tables (updated annually)
- Aguinaldo exemption: first 30 days of UMA are tax-free
- PTU exemption: first 15 days of UMA are tax-free
- Vacation premium: 25% of vacation days salary, partially exempt
- ISR withholding on investment interest (retenciones)
- Net income = gross − ISR − IMSS contributions
- Configuration: tax regime (asalariado, RESICO, honorarios), UMA value, annual update

**Where it touches**: Income calculation in `simulate()` loop (step 1). Add `afterTaxIncome` field or apply tax before computing `totalIncome`. PPR Art.151 deduction already partially models this.

**Estimated scope**: New `TaxConfig` interface, ~100 lines of tax math, ~50 lines of UI for config, bracket table data.

### 2. Negative Balance Warnings & Overdraft Modeling

**Impact**: Medium-high — silently allows negative checking balances with no cost.

**What to build**:
- Dashboard alert card showing: peak negative balance, months in overdraft, total overdraft cost
- Optional overdraft interest rate (charged on negative checking balances)
- Visual danger zone on charts (red shading below $0 on balance charts)
- Suggestion engine: "Consider adding income at month X" or "Delay enganche by 1 month"

**Where it touches**: Step 6 (distribute cashflow) for overdraft interest. New `alerts` entries in `SimulationResult`. Dashboard rendering for alert cards.

**Estimated scope**: ~40 lines engine, ~60 lines UI.

### 3. Sensitivity / What-If Quick Toggles

**Impact**: Medium — enables rapid scenario exploration without manual JSON editing.

**What to build**:
- Slider panel on dashboard: mortgage rate ±2%, salary growth ±3%, inflation ±2%, extra amortization ±$25K
- Each slider creates an ephemeral state override (doesn't modify the base state)
- Live chart updates as sliders move
- "Save as Scenario" button to persist a what-if as a comparison scenario

**Where it touches**: New state for slider overrides. `simulate()` takes merged state. Chart useEffect reacts to overrides.

**Estimated scope**: ~30 lines state/logic, ~80 lines slider UI, ~20 lines scenario persistence.

### 4. Real vs Nominal Value Toggle

**Impact**: Medium — shows how inflation erodes fixed payments and grows the real burden of expenses.

**What to build**:
- Toggle button on charts: "Nominal" / "Real (inflation-adjusted)"
- When "Real": divide all values by `(1 + inflation)^(month/12)` to show purchasing power
- Particularly insightful for mortgage payments (fixed nominal = declining real)
- Apply to: net worth chart, cashflow chart, yearly table

**Where it touches**: Chart data sampling layer — wrap `sampleData()` with deflation factor. Yearly table rendering.

**Estimated scope**: ~15 lines of deflation logic, ~10 lines of UI toggle.

### 5. Calendar Month Input for Annual Events

**Impact**: Medium — prevents breakage when changing start date.

**What to build**:
- Currently: annual events fire based on `monthInYear` derived from `startMonth % 12`
- Improvement: add `calendarMonth?: number` (1-12) to Income and Expense interfaces
- If set, annual events fire when the sim's calendar month matches (independent of start date)
- UI: month name dropdown ("January", "February", ...) instead of raw month number for annual items
- Migration: auto-compute `calendarMonth` from existing `startMonth` + `startDate`

**Where it touches**: Income/Expense interfaces. `simulate()` annually logic. Income/Expense form UI.

**Estimated scope**: ~20 lines engine, ~30 lines UI.

### 6. Loan Refinancing

**Impact**: Medium — common for Mexican mortgages after 2-3 years.

**What to build**:
- "Refinance" action on a loan: specify month, new rate, new term, refinancing cost
- At refinance month: old loan balance transfers to new loan parameters
- Model refinancing costs as one-time expense (appraisal, legal fees, etc.)
- Show comparison: total interest paid with vs without refinancing

**Where it touches**: New `refinance` field on Loan interface. `simulate()` loan payment loop checks for refinance triggers. UI: refinance dialog on loan cards.

**Estimated scope**: ~40 lines engine, ~60 lines UI.

### 7. Peak Stress Metric

**Impact**: Low-medium — surfaces the most dangerous month in the projection.

**What to build**:
- Computed metric: find the month with the lowest account balance (or highest deficit)
- Dashboard card: "Peak Stress: Month X — Balance: -$Y"
- Highlight on chart: marker or color change at the stress month
- Debt-to-income ratio per month: flag months where DTI > 40%

**Where it touches**: Post-simulation computation in `SimulationResult`. Dashboard card rendering.

**Estimated scope**: ~15 lines computation, ~15 lines UI.

### 8. Loan Payoff Projection Beyond Horizon

**Impact**: Low-medium — shows when each loan will be fully paid even if beyond the simulation horizon.

**What to build**:
- After main simulation, run a lightweight extension for each loan still active at horizon end
- Continue amortization math until balance reaches 0
- Display: "Mortgage fully paid: Month 75 (Mar 2032)" on loan cards and dashboard
- For loans with extra amortizations: show the acceleration effect

**Where it touches**: New post-simulation function. Loan card rendering. Dashboard debt-free card.

**Estimated scope**: ~30 lines computation, ~10 lines UI.

### 9. Debt Snowball/Avalanche Visualization

**Impact**: Low — the waterfall engine already supports this; this adds visualization.

**What to build**:
- Stacked area chart showing how waterfall payments are distributed across loans over time
- Color each loan's payment area differently
- Show the "snowball moment" when one loan is paid off and its payment redirects to the next
- Toggle between avalanche (highest rate) and snowball (lowest balance) views

**Where it touches**: New chart mode option. Data extraction from waterfall execution (would need tracking in MonthRow).

**Estimated scope**: ~40 lines data tracking, ~50 lines chart rendering.

### 10. Cash Flow Sankey Diagram

**Impact**: Low — visual clarity for where money flows each month/year.

**What to build**:
- Sankey diagram: Income sources → Categories (expenses, loan payments, savings, investments)
- Time-selectable: view any specific month or year aggregate
- Use d3-sankey or a lightweight library
- Show proportions and absolute values

**Where it touches**: New visualization component. Data already available in MonthRow.

**Estimated scope**: ~100 lines with library integration, new component file.
