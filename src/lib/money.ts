// Exact money.
//
// §5.5 specifies DECIMAL(19,4). SQLite has no decimal type, so money is an
// INTEGER count of ten-thousandths of a unit ("e4"). Floats appear only at the
// display boundary, after the value has been rounded to a cent.

const E4 = 10_000;
const E4_PER_CENT = 100;

/**
 * Decimal units → exact e4.
 *
 * `units * E4` alone is unsafe: 12.35 * 10000 is 123499.99999999999 in binary
 * floating point and truncates a cent below what the engineer typed. Fixing the
 * decimal representation first removes that error before it can be rounded.
 */
export function toE4(units: number | null | undefined): number {
  if (units == null || !Number.isFinite(units)) return 0;
  return Math.round(Number((units * E4).toFixed(4)));
}

/** e4 → decimal units, for display and JSON. Not for further arithmetic. */
export function fromE4(e4: number | null | undefined): number {
  if (e4 == null || !Number.isFinite(e4)) return 0;
  return e4 / E4;
}

/**
 * Round to the nearest cent, half-up, still in e4. Half-up rather than banker's
 * rounding: §5.5 pins this to Excel's ROUND so prices match the spreadsheets
 * this system replaces.
 */
export function roundToCentE4(e4: number): number {
  const cents = e4 / E4_PER_CENT;
  const rounded = cents >= 0 ? Math.floor(cents + 0.5) : Math.ceil(cents - 0.5);
  return rounded * E4_PER_CENT;
}

/** Unit price × quantity. Quantities are fractional by schema, so the product is rounded to e4. */
export function mulQtyE4(unitE4: number, quantity: number): number {
  if (!Number.isFinite(quantity)) return 0;
  return Math.round(Number((unitE4 * quantity).toFixed(4)));
}

/** Divide by a unitless factor, e.g. cost / (1 - cap). */
export function divFactorE4(e4: number, factor: number): number {
  if (!Number.isFinite(factor) || factor === 0) return 0;
  return Math.round(Number((e4 / factor).toFixed(4)));
}

/** Margin as a fraction of revenue. */
export function marginPct(revenueE4: number, costE4: number): number {
  if (revenueE4 <= 0) return 0;
  return (revenueE4 - costE4) / revenueE4;
}
