// §5.5 commissioned-margin back-solve.
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

export type LineForBacksolve = {
  id?: string;
  component?: string;
  unit_price: number | null;
  quantity: number;
  is_commissioned: boolean;
  commission_cap_pct: number | null;
};

export type BacksolveResult = {
  total_cost: number;
  baseline_sell_price: number;
  achieved_margin_pct: number;
  is_below_target: boolean;
  target_margin_pct: number;
  per_line_revenue: Array<{ id?: string; revenue: number; margin_pct: number }>;
};

const EPS = 0.0001;

export function backsolve(lines: LineForBacksolve[], targetMarginPct: number): BacksolveResult {
  let totalCost = 0;
  let commissionedRevenue = 0;
  let nonCommissionedCost = 0;
  let hasNonCommissioned = false;

  const linesWithCost = lines.map((l) => {
    const unit = l.unit_price ?? 0;
    const cost = unit * (l.quantity ?? 0);
    totalCost += cost;
    if (l.is_commissioned) {
      const cap = l.commission_cap_pct ?? 0;
      const lineRev = cap > 0 && cap < 1 ? cost / (1 - cap) : cost; // invalid cap → no margin
      commissionedRevenue += lineRev;
      return { id: l.id, cost, isCommissioned: true, cap, lineRev };
    } else {
      nonCommissionedCost += cost;
      hasNonCommissioned = true;
      return { id: l.id, cost, isCommissioned: false, cap: 0, lineRev: 0 };
    }
  });

  const targetSell = totalCost / Math.max(1 - targetMarginPct, EPS);
  let baselineSellPrice: number;
  let isBelowTarget: boolean;
  let nonCommissionedTotalRev: number;

  if (!hasNonCommissioned) {
    baselineSellPrice = commissionedRevenue;
    isBelowTarget = baselineSellPrice + EPS < targetSell;
    nonCommissionedTotalRev = 0;
  } else {
    const needed = targetSell - commissionedRevenue;
    nonCommissionedTotalRev = Math.max(needed, nonCommissionedCost);
    baselineSellPrice = commissionedRevenue + nonCommissionedTotalRev;
    isBelowTarget = baselineSellPrice + EPS < targetSell;
  }

  const perLineRevenue = linesWithCost.map((l) => {
    if (l.isCommissioned) {
      return { id: l.id, revenue: l.lineRev, margin_pct: l.cap };
    }
    if (nonCommissionedCost <= 0) return { id: l.id, revenue: 0, margin_pct: 0 };
    const share = l.cost / nonCommissionedCost;
    const rev = nonCommissionedTotalRev * share;
    const margin = rev > 0 ? (rev - l.cost) / rev : 0;
    return { id: l.id, revenue: rev, margin_pct: margin };
  });

  const achievedMarginPct = baselineSellPrice > 0 ? (baselineSellPrice - totalCost) / baselineSellPrice : 0;

  return {
    total_cost: totalCost,
    baseline_sell_price: baselineSellPrice,
    achieved_margin_pct: achievedMarginPct,
    is_below_target: isBelowTarget,
    target_margin_pct: targetMarginPct,
    per_line_revenue: perLineRevenue,
  };
}
