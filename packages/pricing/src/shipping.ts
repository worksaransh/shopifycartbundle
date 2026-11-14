import type { Minor } from "./types";

export interface ShippingProgress {
  enabled: boolean;
  remainingMinor: Minor;
  /** Integer 0-100. Reaches 100 only when the threshold is met. */
  percent: number;
  complete: boolean;
}

/**
 * Free-shipping progress. subtotalMinor should be the cart total after discounts, in the same currency
 * as thresholdMinor. A missing, zero or invalid threshold disables the bar (render nothing).
 */
export function computeShippingProgress(subtotalMinor: Minor, thresholdMinor: Minor): ShippingProgress {
  const off: ShippingProgress = { enabled: false, remainingMinor: 0, percent: 0, complete: false };
  if (!Number.isSafeInteger(thresholdMinor) || thresholdMinor <= 0) return off;
  if (!Number.isSafeInteger(subtotalMinor) || subtotalMinor < 0) return off;
  const complete = subtotalMinor >= thresholdMinor;
  return {
    enabled: true,
    complete,
    remainingMinor: complete ? 0 : thresholdMinor - subtotalMinor,
    percent: complete ? 100 : Math.floor((subtotalMinor * 100) / thresholdMinor),
  };
}
