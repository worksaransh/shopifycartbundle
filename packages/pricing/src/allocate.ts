import { mulDivRoundHalfUp, isMinor } from "./money";
import type { Minor } from "./types";

/**
 * Split `total` across lines proportionally to `caps` (each line's maximum), half-up rounded.
 * Guarantees: sum(result) === total, and result[i] <= caps[i].
 * The remainder goes to the LAST line; if that would exceed its cap, it spills backwards.
 */
export function allocate(total: Minor, caps: readonly Minor[]): Minor[] {
  if (!isMinor(total) || !caps.every(isMinor)) throw new RangeError("allocate: bad operands");
  const capSum = caps.reduce((a, b) => a + b, 0);
  if (total > capSum) throw new RangeError("allocate: total exceeds capacity");
  if (total === 0 || caps.length === 0) return caps.map(() => 0);
  const shares = caps.map((c) => Math.min(c, mulDivRoundHalfUp(total, c, capSum)));
  let remainder = total - shares.reduce((a, b) => a + b, 0);
  // remainder can be negative when rounding up overshot; fix from the end as well.
  for (let i = caps.length - 1; i >= 0 && remainder !== 0; i--) {
    if (remainder > 0) {
      const add = Math.min(remainder, caps[i] - shares[i]);
      shares[i] += add;
      remainder -= add;
    } else {
      const take = Math.min(-remainder, shares[i]);
      shares[i] -= take;
      remainder += take;
    }
  }
  return shares;
}
