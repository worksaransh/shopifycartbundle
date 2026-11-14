import { allocate } from "./allocate";
import { isPriceable } from "./lines";
import { percentOf } from "./money";
import {
  EMPTY_RESULT,
  type BundleComponent,
  type BundleRule,
  type DiscountResult,
  type PricingLine,
} from "./types";

export interface BundleResult extends DiscountResult {
  /** How many full bundle instances the cart contains (0 = incomplete, no discount). */
  instances: number;
  /** Units of each line that belong to a bundle instance (units beyond are not discounted). */
  coveredUnits: Record<string, number>;
}

const NONE: BundleResult = { ...EMPTY_RESULT, instances: 0, coveredUnits: {} };

function matches(c: BundleComponent, l: PricingLine): boolean {
  if (c.productId) return l.productId === c.productId;
  if (c.collectionId) return !!l.collectionIds?.includes(c.collectionId);
  return false;
}

function validRule(rule: BundleRule): boolean {
  if (rule.components.length === 0) return false;
  if (
    !rule.components.every(
      (c) => Number.isInteger(c.quantity) && c.quantity > 0 && !!(c.productId || c.collectionId),
    )
  )
    return false;
  if (!Number.isSafeInteger(rule.discountValue) || rule.discountValue < 0) return false;
  if (rule.discountType === "PERCENT") return rule.discountValue >= 1 && rule.discountValue <= 90;
  return true;
}

/**
 * Bundle discount for ONE bundle rule over the cart lines carrying its `_bundle_id`.
 *
 * - A bundle is complete only if every component is present at its required quantity. Otherwise: no discount.
 * - Each line is assigned to the FIRST component it matches. instances = min over components of floor(units / required).
 * - Only instances * required units per component are discounted; extra units stay full price.
 * - PERCENT: percent of the covered subtotal. AMOUNT: amount per instance, capped at covered subtotal.
 *   FIXED_PRICE: covered subtotal minus (price * instances), never below 0, so the price never goes UP.
 * - The total is allocated across covered lines with allocate(): line discounts sum to the total exactly.
 */
export function computeBundleDiscount(rule: BundleRule, lines: readonly PricingLine[]): BundleResult {
  if (!validRule(rule)) return NONE;
  const mine = lines.filter((l) => l.bundleId === rule.id && isPriceable(l));
  if (mine.length === 0) return NONE;

  const assigned: PricingLine[][] = rule.components.map(() => []);
  for (const line of mine) {
    const idx = rule.components.findIndex((c) => matches(c, line));
    if (idx >= 0) assigned[idx].push(line);
  }

  const instances = Math.min(
    ...rule.components.map((c, i) =>
      Math.floor(assigned[i].reduce((n, l) => n + l.quantity, 0) / c.quantity),
    ),
  );
  if (!Number.isFinite(instances) || instances < 1) return NONE;

  const covered: { line: PricingLine; units: number }[] = [];
  rule.components.forEach((c, i) => {
    let need = c.quantity * instances;
    for (const line of assigned[i]) {
      if (need === 0) break;
      const units = Math.min(line.quantity, need);
      covered.push({ line, units });
      need -= units;
    }
  });

  const caps = covered.map(({ line, units }) => line.unitPriceMinor * units);
  const coveredSubtotal = caps.reduce((a, b) => a + b, 0);
  let total: number;
  switch (rule.discountType) {
    case "PERCENT":
      total = percentOf(coveredSubtotal, rule.discountValue);
      break;
    case "AMOUNT":
      total = Math.min(rule.discountValue * instances, coveredSubtotal);
      break;
    case "FIXED_PRICE":
      total = Math.max(0, coveredSubtotal - rule.discountValue * instances);
      break;
  }
  if (!Number.isSafeInteger(total) || total <= 0)
    return { ...NONE, instances, coveredUnits: unitsMap(covered) };

  const shares = allocate(total, caps);
  const byLine = new Map<string, number>();
  covered.forEach(({ line }, i) => byLine.set(line.id, (byLine.get(line.id) ?? 0) + shares[i]));
  return {
    totalMinor: total,
    lineDiscounts: [...byLine]
      .filter(([, a]) => a > 0)
      .map(([lineId, amountMinor]) => ({ lineId, amountMinor })),
    instances,
    coveredUnits: unitsMap(covered),
  };
}

function unitsMap(covered: { line: PricingLine; units: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { line, units } of covered) out[line.id] = (out[line.id] ?? 0) + units;
  return out;
}
