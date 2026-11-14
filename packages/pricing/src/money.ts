import type { Minor } from "./types";

/**
 * ROUNDING RULE (documented contract, also in docs/DECISIONS.md):
 *   - All money is integer minor units.
 *   - Any division rounds HALF UP (0.5 rounds toward +infinity; amounts are never negative here).
 *   - When a total is split across lines, every line gets its rounded share and the REMAINDER goes to the
 *     last line, so line discounts always add up to the total exactly (see allocate.ts).
 *
 * Intermediate products can exceed 2^53, so multiply-then-divide uses BigInt.
 */

export function isMinor(n: unknown): n is Minor {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
}

/** floor((a*b + d/2) / d) for non-negative integers, without float error. d must be > 0. */
export function mulDivRoundHalfUp(a: number, b: number, d: number): number {
  if (!(isMinor(a) && isMinor(b) && isMinor(d)) || d === 0)
    throw new RangeError("mulDivRoundHalfUp: bad operands");
  const num = BigInt(a) * BigInt(b);
  const den = BigInt(d);
  return Number((2n * num + den) / (2n * den));
}

/** percent of amount, half up. percent is an integer 0-100. */
export function percentOf(amountMinor: Minor, percent: number): Minor {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100)
    throw new RangeError("percent must be an integer 0-100");
  return mulDivRoundHalfUp(amountMinor, percent, 100);
}

/** Parse a Shopify Decimal string ("12.34") into minor units. Rejects anything that is not a plain decimal. */
export function decimalToMinor(value: string, exponent: number): Minor {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new RangeError(`not a decimal amount: ${value}`);
  const frac = m[2] ?? "";
  if (frac.length > exponent && /[1-9]/.test(frac.slice(exponent))) {
    throw new RangeError(`too many decimal places for exponent ${exponent}: ${value}`);
  }
  const minor = Number(m[1] + frac.slice(0, exponent).padEnd(exponent, "0"));
  if (!Number.isSafeInteger(minor)) throw new RangeError("amount too large");
  return minor;
}

export function minorToDecimal(minor: Minor, exponent: number): string {
  if (!isMinor(minor)) throw new RangeError("minor must be a non-negative safe integer");
  if (exponent === 0) return String(minor);
  const s = String(minor).padStart(exponent + 1, "0");
  return `${s.slice(0, -exponent)}.${s.slice(-exponent)}`;
}
