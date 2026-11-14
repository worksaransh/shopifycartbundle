/** Integer minor units (cents, paise, yen). Never floats. */
export type Minor = number;

export type DiscountType = "PERCENT" | "AMOUNT" | "FIXED_PRICE";
export type TargetType = "PRODUCT" | "COLLECTION";

/**
 * One cart line as the pricing functions see it. Built from the Function input or from /cart.js.
 * `variantId` empty/missing means the merchandise is unknown: the line is ignored (no discount).
 */
export interface PricingLine {
  id: string;
  productId: string;
  variantId: string;
  /** Collections this product belongs to, when known. Used by COLLECTION targets. */
  collectionIds?: readonly string[];
  quantity: number;
  /** Price of ONE unit in minor units, before our discounts. */
  unitPriceMinor: Minor;
  /** Value of the `_bundle_id` line property, if present. */
  bundleId?: string | null;
}

/** A bundle requirement: `quantity` units matching a product or a collection. */
export interface BundleComponent {
  productId?: string;
  collectionId?: string;
  quantity: number;
}

export interface BundleRule {
  id: string;
  discountType: DiscountType;
  /** PERCENT: integer 1-90. AMOUNT / FIXED_PRICE: minor units for ONE bundle instance. */
  discountValue: number;
  components: readonly BundleComponent[];
}

export interface Tier {
  minQty: number;
  percentOff: number;
}

export interface VolumeRule {
  id: string;
  targetType: TargetType;
  targetIds: readonly string[];
  tiers: readonly Tier[];
  /** GROUP: one tier from the total qty of all matched lines. PER_LINE: each line picks its own tier. */
  mode: "GROUP" | "PER_LINE";
}

export interface UpsellRule {
  id: string;
  triggerType: TargetType;
  triggerIds: readonly string[];
  /** Max 3 (enforced by config-schema). */
  offerIds: readonly string[];
  discountPercent?: number;
  maxOffers: number;
  hideIfInCart: boolean;
}

export interface LineDiscount {
  lineId: string;
  amountMinor: Minor;
}

export interface DiscountResult {
  totalMinor: Minor;
  lineDiscounts: LineDiscount[];
}

export const EMPTY_RESULT: DiscountResult = Object.freeze({
  totalMinor: 0,
  lineDiscounts: [],
}) as DiscountResult;
