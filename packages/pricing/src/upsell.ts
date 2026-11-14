export interface UpsellRuleView {
  id: string;
  triggerProductIds: readonly string[];
  offerIds: readonly string[];
  maxOffers: number;
  hideIfInCart: boolean;
}

export interface SelectedOffer {
  ruleId: string;
  productId: string;
}

/**
 * Which upsell offers to show. Pure, so it is unit-tested and shared by the storefront.
 *  - a rule fires only if the cart contains one of its trigger products
 *  - offers already in the cart are hidden when hideIfInCart is set
 *  - unavailable offers are never shown
 *  - at most maxOffers per rule, and at most `cap` (default 3) overall; each product appears once
 * Offers are never pre-selected: showing is all this does.
 */
export function selectUpsellOffers(
  rules: readonly UpsellRuleView[],
  cartProductIds: ReadonlySet<string>,
  available: ReadonlyMap<string, boolean>,
  cap = 3,
): SelectedOffer[] {
  const out: SelectedOffer[] = [];
  const seen = new Set<string>();
  for (const rule of rules) {
    if (!rule.triggerProductIds.some((p) => cartProductIds.has(p))) continue;
    let shown = 0;
    for (const productId of rule.offerIds) {
      if (out.length >= cap || shown >= rule.maxOffers) break;
      if (seen.has(productId) || available.get(productId) !== true) continue;
      if (rule.hideIfInCart && cartProductIds.has(productId)) continue;
      seen.add(productId);
      out.push({ ruleId: rule.id, productId });
      shown++;
    }
  }
  return out;
}
