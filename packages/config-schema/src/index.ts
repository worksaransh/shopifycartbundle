import { z } from "zod";

/**
 * Metafield contract. Namespace `$app:bundlekit` (resolves to the app-reserved namespace).
 * Every payload carries `schemaVersion`; readers must ignore payloads with a version they do not know.
 *
 * Owners and keys:
 *   Shop      `config`   storefront config (shipping bar, colours, strings, kill switch)
 *   Product   `bundles`  active bundles that include this product (directly or via a collection)
 *   Product   `volume`   active volume rules that apply to this product
 *   DiscountNode `fn`    ONE rule's config for the discount Function (own node per bundle / volume rule)
 *
 * SIZE LIMITS (docs: shopify.dev/docs/apps/build/metafields/metafield-limits):
 *   - json metafield <= 128 KB; our storefront payloads are capped at STOREFRONT_MAX_BYTES.
 *   - Function input queries return NULL for any metafield value > 10,000 bytes, so `fn` is capped at
 *     FUNCTION_MAX_BYTES. Exceeding it is a hard error at save time, never a silent no-discount at checkout.
 */
export const NAMESPACE = "$app:bundlekit";
export const SCHEMA_VERSION = 1 as const;
export const KEYS = {
  shopConfig: "config",
  productBundles: "bundles",
  productVolume: "volume",
  shopUpsells: "upsells",
  functionConfig: "fn",
} as const;

export const STOREFRONT_MAX_BYTES = 100_000;
export const FUNCTION_MAX_BYTES = 9_500;
/** Hard cap on products touched per sync until the bulk-operation path exists (see docs/BACKLOG.md). */
export const MAX_SYNC_PRODUCTS = 5_000;

const gid = z.string().regex(/^gid:\/\/shopify\/[A-Za-z]+\/\d+$/, "must be a Shopify GID");
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a #rrggbb colour");
/** Calendar date in the SHOP timezone (YYYY-MM-DD). Compared with Function input shop.localTime.date. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
const minorString = z.string().regex(/^\d{1,15}$/, "must be integer minor units");

export const componentSchema = z
  .object({
    productId: gid.optional(),
    collectionId: gid.optional(),
    /** Product or collection handle. Liquid looks things up by handle; the Function never needs it. */
    handle: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/)
      .max(255)
      .optional(),
    quantity: z.number().int().min(1).max(99),
  })
  .refine((c) => !!c.productId !== !!c.collectionId, "exactly one of productId or collectionId");

export const bundleSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(80),
  type: z.enum(["FIXED", "MIX_MATCH"]),
  badge: z.string().max(40).optional(),
  discountType: z.enum(["PERCENT", "AMOUNT", "FIXED_PRICE"]),
  /** PERCENT: "1".."90". AMOUNT / FIXED_PRICE: integer minor units per bundle. */
  discountValue: minorString,
  components: z
    .array(componentSchema)
    .min(1)
    .max(10)
    // collection membership comes from inCollections(ids) which cannot tell WHICH collection a second component means
    .refine(
      (cs) => cs.filter((c) => c.collectionId).length <= 1,
      "at most one collection component per bundle",
    ),
  startsAt: isoDate.optional(),
  endsAt: isoDate.optional(),
});
export type BundleConfig = z.infer<typeof bundleSchema>;

export const tierSchema = z.object({
  minQty: z.number().int().min(2),
  percentOff: z.number().int().min(1).max(90),
});

export const volumeRuleSchema = z
  .object({
    id: z.string().min(1).max(64),
    targetType: z.enum(["PRODUCT", "COLLECTION"]),
    targetIds: z.array(gid).min(1).max(100),
    mode: z.enum(["GROUP", "PER_LINE"]).default("GROUP"),
    tiers: z.array(tierSchema).min(2).max(5),
    startsAt: isoDate.optional(),
    endsAt: isoDate.optional(),
  })
  .refine((r) => r.tiers.every((t, i) => i === 0 || t.minQty > r.tiers[i - 1].minQty), {
    message: "tier minQty must strictly increase",
    path: ["tiers"],
  });
export type VolumeRuleConfig = z.infer<typeof volumeRuleSchema>;

export const shopConfigSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  /** Kill switch: when true every storefront feature renders nothing. */
  killSwitch: z.boolean().default(false),
  shippingBar: z
    .object({
      enabled: z.boolean().default(false),
      thresholdMinor: minorString.default("0"),
      currency: z.string().length(3).optional(),
    })
    .default({ enabled: false, thresholdMinor: "0" }),
  colours: z
    .object({ accent: hex, text: hex, background: hex })
    .default({ accent: "#1a6b4f", text: "#202223", background: "#ffffff" }),
  locale: z.string().min(2).max(10).default("en"),
  /** Generic-adapter fallback: CSS selector of the merchant's cart container (Settings). */
  cartSelector: z.string().max(120).optional(),
  /** Storefront strings keyed by id; {amount} placeholder allowed in shipping messages. */
  strings: z.record(z.string().max(60), z.string().max(200)).default({}),
});
export type ShopConfig = z.infer<typeof shopConfigSchema>;

const handle = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "must be a product handle");

/** Storefront view of an upsell rule (shop metafield `upsells`). Offer product DATA is rendered by Liquid, not stored here. */
export const upsellStorefrontSchema = z.object({
  id: z.string().min(1).max(64),
  /** Product ids that trigger the rule. Collection triggers are expanded to products at sync time because
   * /cart.js has no collection data. Capped at 200 per rule. */
  triggerProductIds: z.array(gid).min(1).max(200),
  offerIds: z.array(gid).min(1).max(3),
  offerHandles: z.array(handle).min(1).max(3),
  discountPercent: z.number().int().min(0).max(90).default(0),
  maxOffers: z.number().int().min(1).max(3).default(3),
  hideIfInCart: z.boolean().default(true),
  layout: z.enum(["CAROUSEL", "STACKED"]).default("STACKED"),
});
export const shopUpsellsSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  rules: z.array(upsellStorefrontSchema).max(20),
});

export const productBundlesSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  bundles: z.array(bundleSchema).max(20),
});
export const productVolumeSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  rules: z.array(volumeRuleSchema).max(10),
});

export const upsellDiscountSchema = z.object({
  id: z.string().min(1).max(64),
  /** Products this rule may discount. A line needs a matching `_upsell_id` AND a product in this list. */
  offerIds: z.array(gid).min(1).max(3),
  percentOff: z.number().int().min(1).max(90),
});

/**
 * The ONE rule pack stored on the shop's single automatic discount node and read by the Function.
 * A store may have at most 25 active discount functions across ALL apps, so we use one node per shop, not one per
 * rule. All bundles, volume rules and upsell discounts share the FUNCTION_MAX_BYTES budget; saving fails with a
 * clear message when it is exceeded. `collectionIds` doubles as the Function's input variable for inCollections().
 */
export const rulePackSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  bundles: z.array(bundleSchema).max(50).default([]),
  volume: z.array(volumeRuleSchema).max(20).default([]),
  upsells: z.array(upsellDiscountSchema).max(20).default([]),
  /** Let volume tiers also apply to lines that are part of a complete bundle. Default off. */
  stackVolumeWithBundles: z.boolean().default(false),
  collectionIds: z.array(gid).max(100).default([]),
  /** Shop currency. AMOUNT / FIXED_PRICE bundle values are in this currency and are skipped for carts in another. */
  currency: z.string().length(3).optional(),
});
export type RulePack = z.infer<typeof rulePackSchema>;

export class ConfigTooLargeError extends Error {
  constructor(
    readonly bytes: number,
    readonly maxBytes: number,
    what: string,
  ) {
    super(`${what} is ${bytes} bytes; the limit is ${maxBytes}. Remove products or rules and save again.`);
  }
}

const byteLength = (s: string) => new TextEncoder().encode(s).length;

/** Validate, serialise with stable key order, and enforce the byte cap. Throws ZodError or ConfigTooLargeError. */
export function serialize<T>(
  schema: z.ZodType<T, unknown>,
  value: unknown,
  maxBytes: number,
  what: string,
): string {
  const parsed = schema.parse(value);
  const json = JSON.stringify(sortKeys(parsed));
  const bytes = byteLength(json);
  if (bytes > maxBytes) throw new ConfigTooLargeError(bytes, maxBytes, what);
  return json;
}

/** Parse a stored value; returns null for unknown schemaVersion, bad JSON or invalid shape (readers fail safe). */
export function parseStored<T>(schema: z.ZodType<T, unknown>, raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    const r = schema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, sortKeys(x)]),
    );
  }
  return v;
}
