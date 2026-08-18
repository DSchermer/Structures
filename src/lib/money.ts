// Exact money arithmetic.
//
// §5.5 specifies PRICE_POINT.price as DECIMAL(19,4) — 0.01¢ precision, chosen so
// the back-solve has headroom to compute intermediates without rounding drift —
// and requires the price written at check-in to be rounded half-up to the cent
// (matching Excel's ROUND). SQLite has no decimal type, so money is carried as
// an INTEGER count of ten-thousandths of a unit ("e4"). That is the same
// contract DECIMAL(19,4) gives, expressed in the only exact type SQLite has.
//
// Everything downstream of parsing works in e4 integers. Floats appear only at
// the display boundary, where the value has already been rounded to a cent.

/** Ten-thousandths of a currency unit — the DECIMAL(19,4) scale. */
export const E4 = 10_000;
/** e4 units in one cent. */
export const E4_PER_CENT = 100;

/**
 * Parse a decimal number of currency units into exact e4.
 *
 * `x * E4` alone is unsafe: 12.35 * 10000 is 123499.99999999999 in binary
 * floating point, which truncates to a cent less than the engineer typed.
 * Fixing the decimal representation first removes the representation error
 * before it can be rounded the wrong way.
 */
export function toE4(units: number | null | undefined): number {
  if (units == null || !Number.isFinite(units)) return 0;
  return Math.round(Number((units * E4).toFixed(4)));
}

/** e4 → currency units, for display and JSON. Not for further arithmetic. */
export function fromE4(e4: number | null | undefined): number {
  if (e4 == null || !Number.isFinite(e4)) return 0;
  return e4 / E4;
}

/**
 * Round an e4 amount half-up to the nearest cent, returned in e4.
 *
 * Half-up (not banker's rounding) is required: §5.5 pins this to Excel's ROUND
 * so a price computed here matches the same price computed in the spreadsheets
 * this system replaces. Money is non-negative throughout, so "half away from
 * zero" and "half up" coincide and the negative branch is not exercised.
 */
export function roundToCentE4(e4: number): number {
  const cents = e4 / E4_PER_CENT;
  const rounded = cents >= 0 ? Math.floor(cents + 0.5) : Math.ceil(cents - 0.5);
  return rounded * E4_PER_CENT;
}

/**
 * Multiply an e4 amount by a possibly-fractional quantity, staying in e4.
 * Quantities are REAL by schema (0.5 m of gasket rope is legitimate), so the
 * product can land between e4 units; it is rounded to the nearest one.
 */
export function mulQtyE4(unitE4: number, quantity: number): number {
  if (!Number.isFinite(quantity)) return 0;
  return Math.round(Number((unitE4 * quantity).toFixed(4)));
}

/**
 * Divide an e4 amount by a unitless factor (e.g. cost / (1 - cap)), staying in
 * e4. The result is rounded to the nearest e4 unit — the 0.01¢ headroom the
 * spec allocated for exactly this intermediate step.
 */
export function divFactorE4(e4: number, factor: number): number {
  if (!Number.isFinite(factor) || factor === 0) return 0;
  return Math.round(Number((e4 / factor).toFixed(4)));
}

/** Margin of a line as a fraction, computed from exact e4 inputs. */
export function marginPct(revenueE4: number, costE4: number): number {
  if (revenueE4 <= 0) return 0;
  return (revenueE4 - costE4) / revenueE4;
}
