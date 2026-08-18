// §5.5 commissioned-margin back-solve.
//
// All money is exact e4 (ten-thousandths of a currency unit) — see money.ts.
// Inputs carry unit_price_e4; outputs are e4, with the assembly price rounded
// half-up to the cent because that value is materialised as a PRICE_POINT.
//
// Inputs: every line's (cost = unit_price × quantity), is_commissioned flag,
//   commission_cap_pct (strictly in (0,1) if commissioned, else NULL).
// Output: baseline assembly sell price + achieved margin + below-target flag.
//
// Algorithm:
//   For each commissioned line, its share of revenue is fixed:
//     line_revenue = line_cost / (1 - cap)
//   (margin on that line equals cap, by construction.)
//   For non-commissioned lines, total revenue must add to the target sell
//   price (or stay at non-commissioned cost, whichever is higher) to hit the
//   engineer's target_assembly_margin_pct.
//   When ALL lines are commissioned, baseline_sell is forced to the sum of
//   commissioned revenues — and we drop below-target if that's lower than
//   target_sell.

import { divFactorE4, marginPct, mulQtyE4, roundToCentE4 } from './money';

export type LineForBacksolve = {
  id?: string;
  component?: string;
  /** Unit cost in e4. */
  unit_price_e4: number;
  quantity: number;
  is_commissioned: boolean;
  commission_cap_pct: number | null;
};

export type BacksolveResult = {
  /** All e4. */
  total_cost_e4: number;
  baseline_sell_price_e4: number;
  achieved_margin_pct: number;
  is_below_target: boolean;
  target_margin_pct: number;
  per_line_revenue: Array<{ id?: string; revenue_e4: number; cost_e4: number; margin_pct: number }>;
};

const EPS = 0.0001;

export function backsolve(lines: LineForBacksolve[], targetMarginPct: number): BacksolveResult {
  let totalCost = 0;
  let commissionedRevenue = 0;
  let nonCommissionedCost = 0;
  let hasNonCommissioned = false;

  const linesWithCost = lines.map((l) => {
    const cost = mulQtyE4(l.unit_price_e4 ?? 0, l.quantity ?? 0);
    totalCost += cost;
    if (l.is_commissioned) {
      const cap = l.commission_cap_pct ?? 0;
      // Invalid cap → no margin. G4pr rejects such a line at check-in; during
      // drafting we simply don't invent revenue for it.
      const lineRev = cap > 0 && cap < 1 ? divFactorE4(cost, 1 - cap) : cost;
      commissionedRevenue += lineRev;
      return { id: l.id, cost, isCommissioned: true, cap, lineRev };
    }
    nonCommissionedCost += cost;
    hasNonCommissioned = true;
    return { id: l.id, cost, isCommissioned: false, cap: 0, lineRev: 0 };
  });

  const targetSell = divFactorE4(totalCost, Math.max(1 - targetMarginPct, EPS));
  let baselineSellPrice: number;
  let nonCommissionedTotalRev: number;

  if (!hasNonCommissioned) {
    baselineSellPrice = commissionedRevenue;
    nonCommissionedTotalRev = 0;
  } else {
    const needed = targetSell - commissionedRevenue;
    nonCommissionedTotalRev = Math.max(needed, nonCommissionedCost);
    baselineSellPrice = commissionedRevenue + nonCommissionedTotalRev;
  }

  // The assembly price is materialised as a PRICE_POINT, so it is rounded to a
  // cent here — the same value G4pr then asserts the commissioned caps against.
  baselineSellPrice = roundToCentE4(baselineSellPrice);
  const isBelowTarget = baselineSellPrice + 1 < targetSell;

  const perLineRevenue = linesWithCost.map((l) => {
    if (l.isCommissioned) {
      return { id: l.id, revenue_e4: l.lineRev, cost_e4: l.cost, margin_pct: marginPct(l.lineRev, l.cost) };
    }
    if (nonCommissionedCost <= 0) return { id: l.id, revenue_e4: 0, cost_e4: l.cost, margin_pct: 0 };
    const rev = Math.round((nonCommissionedTotalRev * l.cost) / nonCommissionedCost);
    return { id: l.id, revenue_e4: rev, cost_e4: l.cost, margin_pct: marginPct(rev, l.cost) };
  });

  return {
    total_cost_e4: totalCost,
    baseline_sell_price_e4: baselineSellPrice,
    achieved_margin_pct: marginPct(baselineSellPrice, totalCost),
    is_below_target: isBelowTarget,
    target_margin_pct: targetMarginPct,
    per_line_revenue: perLineRevenue,
  };
}

/**
 * G4pr cap-breach assertion (§5.5, §5.7).
 *
 * The back-solve sets each commissioned line's revenue to cost/(1-cap), so its
 * margin equals the cap in exact arithmetic. This re-checks it *after* rounding,
 * which is the point: rounding to the cent is what could nudge a line above its
 * contractual ceiling. ε absorbs a rounding step, nothing more.
 *
 * Returns the offending lines; empty means every cap holds.
 */
export function findCapBreaches(
  result: BacksolveResult,
  lines: LineForBacksolve[],
  epsilon = EPS,
): Array<{ id?: string; component?: string; cap: number; achieved: number }> {
  const byId = new Map(result.per_line_revenue.map((r) => [r.id, r]));
  const breaches: Array<{ id?: string; component?: string; cap: number; achieved: number }> = [];
  for (const l of lines) {
    if (!l.is_commissioned || l.commission_cap_pct == null) continue;
    const r = byId.get(l.id);
    if (!r) continue;
    const achieved = marginPct(roundToCentE4(r.revenue_e4), r.cost_e4);
    if (achieved > l.commission_cap_pct + epsilon) {
      breaches.push({ id: l.id, component: l.component, cap: l.commission_cap_pct, achieved });
    }
  }
  return breaches;
}
