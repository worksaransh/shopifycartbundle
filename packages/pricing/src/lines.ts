import type { PricingLine } from "./types";

/** A line can take part in pricing only if merchandise is known, quantity is positive and price is sane. */
export function isPriceable(line: PricingLine): boolean {
  return (
    !!line.productId &&
    !!line.variantId &&
    Number.isSafeInteger(line.quantity) &&
    line.quantity > 0 &&
    Number.isSafeInteger(line.unitPriceMinor) &&
    line.unitPriceMinor >= 0
  );
}

export const lineTotal = (l: PricingLine): number => l.quantity * l.unitPriceMinor;
