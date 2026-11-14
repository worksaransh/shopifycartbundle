import { allocate } from "./allocate";
import { isPriceable, lineTotal } from "./lines";
import { percentOf } from "./money";
import { EMPTY_RESULT, type DiscountResult, type PricingLine, type Tier, type VolumeRule } from "./types";

const validTier = (t: Tier) =>
  Number.isInteger(t.minQty) &&
  t.minQty >= 1 &&
  Number.isInteger(t.percentOff) &&
  t.percentOff >= 1 &&
  t.percentOff <= 90;

/** Highest satisfied tier (largest minQty <= qty). Input order does not matter. Invalid tiers are ignored. */
export function pickActiveTier(tiers: readonly Tier[], qty: number): Tier | undefined {
  if (!Number.isInteger(qty) || qty < 1) return undefined;
  let best: Tier | undefined;
  for (const t of tiers) {
    if (validTier(t) && t.minQty <= qty && (!best || t.minQty > best.minQty)) best = t;
  }
  return best;
}

export interface VolumeResult extends DiscountResult {
  /** GROUP mode: the tier that applied. PER_LINE: undefined (see lineTiers). */
  tier?: Tier;
  lineTiers: Record<string, Tier>;
}

export interface VolumeOptions {
  /** Lines already priced by a complete bundle. Skipped unless the merchant enabled stacking. */
  excludeLineIds?: ReadonlySet<string>;
}

function matchesTarget(rule: VolumeRule, l: PricingLine): boolean {
  return rule.targetType === "PRODUCT"
    ? rule.targetIds.includes(l.productId)
    : !!l.collectionIds?.some((c) => rule.targetIds.includes(c));
}

export function computeVolumeDiscount(
  rule: VolumeRule,
  lines: readonly PricingLine[],
  opts: VolumeOptions = {},
): VolumeResult {
  const none: VolumeResult = { ...EMPTY_RESULT, lineTiers: {} };
  const matched = lines.filter(
    (l) => isPriceable(l) && matchesTarget(rule, l) && !opts.excludeLineIds?.has(l.id),
  );
  if (matched.length === 0) return none;

  if (rule.mode === "PER_LINE") {
    const lineDiscounts = [];
    const lineTiers: Record<string, Tier> = {};
    let totalMinor = 0;
    for (const l of matched) {
      const tier = pickActiveTier(rule.tiers, l.quantity);
      if (!tier) continue;
      const amountMinor = percentOf(lineTotal(l), tier.percentOff);
      if (amountMinor > 0) {
        lineDiscounts.push({ lineId: l.id, amountMinor });
        lineTiers[l.id] = tier;
        totalMinor += amountMinor;
      }
    }
    return { totalMinor, lineDiscounts, lineTiers };
  }

  const qty = matched.reduce((n, l) => n + l.quantity, 0);
  const tier = pickActiveTier(rule.tiers, qty);
  if (!tier) return none;
  const caps = matched.map(lineTotal);
  const total = percentOf(
    caps.reduce((a, b) => a + b, 0),
    tier.percentOff,
  );
  if (total === 0) return none;
  const shares = allocate(total, caps);
  const lineDiscounts = matched
    .map((l, i) => ({ lineId: l.id, amountMinor: shares[i] }))
    .filter((d) => d.amountMinor > 0);
  return { totalMinor: total, lineDiscounts, tier, lineTiers: {} };
}
