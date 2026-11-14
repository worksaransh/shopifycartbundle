import {
  computeCartDiscounts,
  currencyExponent,
  decimalToMinor,
  minorToDecimal,
  type BundleRule,
  type PricingLine,
  type RulePackInput,
  type VolumeRule,
} from "@bundlekit/pricing";

/**
 * Discount Function (target cart.lines.discounts.generate.run, API 2026-10).
 * FAILS OPEN: any problem (bad config, bad amount, unexpected shape) means "no discount", never a thrown error,
 * so checkout is never blocked. The pack was validated with zod when it was written; here we only do light
 * structural checks, to keep zod out of the wasm (size and instruction cost).
 */

export interface FunctionInput {
  cart: {
    cost: { subtotalAmount: { currencyCode: string } };
    lines: {
      id: string;
      quantity: number;
      bundleId: { value: string } | null;
      upsellId: { value: string } | null;
      cost: { amountPerQuantity: { amount: string } };
      merchandise: {
        __typename: string;
        id?: string;
        product?: { id: string; inCollections?: { collectionId: string; isMember: boolean }[] | null };
      };
    }[];
  };
  discountNode: { metafield: { value: string } | null } | null;
}

export interface FunctionResult {
  operations: unknown[];
}

const NONE: FunctionResult = { operations: [] };

interface RawPack {
  schemaVersion?: number;
  currency?: string;
  stackVolumeWithBundles?: boolean;
  bundles?: {
    id: string;
    title?: string;
    discountType: BundleRule["discountType"];
    discountValue: string;
    components: { productId?: string; collectionId?: string; quantity: number }[];
  }[];
  volume?: {
    id: string;
    targetType: VolumeRule["targetType"];
    targetIds: string[];
    mode?: VolumeRule["mode"];
    tiers: VolumeRule["tiers"];
  }[];
  upsells?: { id: string; offerIds: string[]; percentOff: number }[];
}

export function cartLinesDiscountsGenerateRun(input: FunctionInput): FunctionResult {
  try {
    return run(input);
  } catch {
    return NONE;
  }
}

function run(input: FunctionInput): FunctionResult {
  const raw = input.discountNode?.metafield?.value;
  if (!raw) return NONE;
  const pack = JSON.parse(raw) as RawPack;
  if (pack.schemaVersion !== 1) return NONE;

  const currency = input.cart.cost.subtotalAmount.currencyCode;
  const exp = currencyExponent(currency);
  // Fixed amounts are stored in the shop currency; skip them for carts presented in another currency.
  const sameCurrency = !pack.currency || pack.currency === currency;

  const lines: PricingLine[] = [];
  for (const l of input.cart.lines) {
    const m = l.merchandise;
    if (m.__typename !== "ProductVariant" || !m.id || !m.product) continue;
    try {
      lines.push({
        id: l.id,
        productId: m.product.id,
        variantId: m.id,
        collectionIds: (m.product.inCollections ?? []).filter((c) => c.isMember).map((c) => c.collectionId),
        quantity: l.quantity,
        unitPriceMinor: decimalToMinor(l.cost.amountPerQuantity.amount, exp),
        bundleId: l.bundleId?.value ?? null,
        upsellId: l.upsellId?.value ?? null,
      });
    } catch {
      // unparsable price: leave this line undiscounted
    }
  }

  const rules: RulePackInput = {
    bundles: (pack.bundles ?? [])
      .filter((b) => sameCurrency || b.discountType === "PERCENT")
      .map((b) => ({
        id: b.id,
        title: b.title,
        discountType: b.discountType,
        discountValue: Number(b.discountValue),
        components: b.components,
      })),
    volume: (pack.volume ?? []).map((v) => ({
      id: v.id,
      targetType: v.targetType,
      targetIds: v.targetIds,
      mode: v.mode ?? "GROUP",
      tiers: v.tiers,
    })),
    upsells: (pack.upsells ?? []).map((u) => ({ id: u.id, offerIds: u.offerIds, percentOff: u.percentOff })),
    stackVolumeWithBundles: pack.stackVolumeWithBundles === true,
  };

  const { allocations } = computeCartDiscounts(rules, lines);
  if (allocations.length === 0) return NONE;

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates: allocations.map((a) => ({
            message: a.label,
            targets: [{ cartLine: { id: a.lineId, quantity: a.quantity } }],
            value: { fixedAmount: { amount: minorToDecimal(a.amountMinor, exp), appliesToEachItem: false } },
          })),
          selectionStrategy: "ALL",
        },
      },
    ],
  };
}
