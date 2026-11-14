import {
  KEYS,
  MAX_SYNC_PRODUCTS,
  STOREFRONT_MAX_BYTES,
  FUNCTION_MAX_BYTES,
  productBundlesSchema,
  productVolumeSchema,
  rulePackSchema,
  shopUpsellsSchema,
  serialize,
  shopConfigSchema,
  SCHEMA_VERSION,
  type BundleConfig,
  type VolumeRuleConfig,
} from "@bundlekit/config-schema";

/** Rows as stored by Prisma, reduced to what sync needs. */
export interface BundleRow {
  id: string;
  type: "FIXED" | "MIX_MATCH";
  title: string;
  status: "ACTIVE" | "PAUSED" | "DRAFT";
  discountType: "PERCENT" | "AMOUNT" | "FIXED_PRICE";
  discountValue: string;
  items: unknown;
  startsAt: Date | null;
  endsAt: Date | null;
}
export interface VolumeRow {
  id: string;
  status: "ACTIVE" | "PAUSED" | "DRAFT";
  targetType: "PRODUCT" | "COLLECTION";
  targetGids: string[];
  tiers: unknown;
  startsAt: Date | null;
  endsAt: Date | null;
}
export interface UpsellRow {
  id: string;
  status: "ACTIVE" | "PAUSED" | "DRAFT";
  triggerType: "PRODUCT" | "COLLECTION";
  triggerGids: string[];
  offerGids: string[];
  offerHandles: string[];
  layout: string;
  maxOffers: number;
  hideIfInCart: boolean;
  discountPercent: number | null;
}
export interface SyncState {
  shopId: string;
  shopDomain: string;
  settings: unknown;
  bundles: BundleRow[];
  volumeRules: VolumeRow[];
  upsellRules: UpsellRow[];
  syncedProductGids: string[];
  ruleDiscountGid: string | null;
}

export interface DesiredMetafield {
  ownerId: string;
  key: string;
  value: string;
}
export interface Desired {
  metafields: DesiredMetafield[];
  /** Products that should carry at least one of our metafields. */
  productGids: string[];
}

export class TooManyProductsError extends Error {
  constructor(count: number) {
    super(
      `Rules touch ${count} products; the limit is ${MAX_SYNC_PRODUCTS}. Narrow a collection or split the rule.`,
    );
  }
}

interface RawItem {
  productGid?: string;
  collectionGid?: string;
  quantity: number;
}

/** Stored as UTC midnight of the chosen calendar date; read back as that same YYYY-MM-DD. */
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : undefined);

export function toBundleConfig(b: BundleRow): BundleConfig {
  const items = (b.items ?? []) as RawItem[];
  return {
    id: b.id,
    title: b.title,
    type: b.type,
    discountType: b.discountType,
    discountValue: b.discountValue,
    components: items.map((i) => ({
      ...(i.productGid ? { productId: i.productGid } : { collectionId: i.collectionGid }),
      quantity: i.quantity,
    })),
    startsAt: iso(b.startsAt),
    endsAt: iso(b.endsAt),
  };
}

export function toVolumeConfig(v: VolumeRow): VolumeRuleConfig {
  return volumeRowToConfig(v);
}
function volumeRowToConfig(v: VolumeRow): VolumeRuleConfig {
  return {
    id: v.id,
    targetType: v.targetType,
    targetIds: v.targetGids,
    mode: "GROUP",
    tiers: v.tiers as VolumeRuleConfig["tiers"],
    startsAt: iso(v.startsAt),
    endsAt: iso(v.endsAt),
  };
}

/** Collections referenced by ACTIVE rules; their product membership must be resolved before building. */
export function collectionGidsOf(state: SyncState): string[] {
  const out = new Set<string>();
  for (const b of state.bundles) {
    if (b.status !== "ACTIVE") continue;
    for (const i of (b.items ?? []) as RawItem[]) if (i.collectionGid) out.add(i.collectionGid);
  }
  for (const v of state.volumeRules) {
    if (v.status === "ACTIVE" && v.targetType === "COLLECTION") v.targetGids.forEach((g) => out.add(g));
  }
  return [...out].sort();
}

/**
 * Pure: turns DB state into the exact metafield values that should exist. Output is deterministic
 * (sorted keys, sorted owners) so reconciliation can compare byte-for-byte after normalisation.
 */
export function buildDesired(
  state: SyncState,
  shopGid: string,
  collectionProducts: ReadonlyMap<string, readonly string[]>,
): Desired {
  const metafields: DesiredMetafield[] = [];

  const config = shopConfigSchema.parse({ schemaVersion: SCHEMA_VERSION, ...(state.settings as object) });
  metafields.push({
    ownerId: shopGid,
    key: KEYS.shopConfig,
    value: serialize(shopConfigSchema, config, STOREFRONT_MAX_BYTES, "Shop settings"),
  });

  const upsellRules = state.upsellRules
    .filter((u) => u.status === "ACTIVE")
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((u) => ({
      id: u.id,
      triggerType: u.triggerType,
      triggerIds: u.triggerGids,
      offerIds: u.offerGids,
      offerHandles: u.offerHandles,
      discountPercent: u.discountPercent ?? 0,
      maxOffers: Math.min(u.maxOffers, u.offerGids.length),
      hideIfInCart: u.hideIfInCart,
      layout: u.layout === "CAROUSEL" ? "CAROUSEL" : "STACKED",
    }));
  metafields.push({
    ownerId: shopGid,
    key: KEYS.shopUpsells,
    value: serialize(
      shopUpsellsSchema,
      { schemaVersion: SCHEMA_VERSION, rules: upsellRules },
      STOREFRONT_MAX_BYTES,
      "Upsell rules",
    ),
  });

  const perProductBundles = new Map<string, BundleConfig[]>();
  for (const b of state.bundles
    .filter((x) => x.status === "ACTIVE")
    .sort((a, b) => a.id.localeCompare(b.id))) {
    const cfg = toBundleConfig(b);
    const products = new Set<string>();
    for (const c of cfg.components) {
      if (c.productId) products.add(c.productId);
      if (c.collectionId) collectionProducts.get(c.collectionId)?.forEach((p) => products.add(p));
    }
    for (const p of products) perProductBundles.set(p, [...(perProductBundles.get(p) ?? []), cfg]);
  }

  const perProductVolume = new Map<string, VolumeRuleConfig[]>();
  for (const v of state.volumeRules
    .filter((x) => x.status === "ACTIVE")
    .sort((a, b) => a.id.localeCompare(b.id))) {
    const cfg = volumeRowToConfig(v);
    const products = new Set<string>();
    for (const t of cfg.targetIds) {
      if (cfg.targetType === "PRODUCT") products.add(t);
      else collectionProducts.get(t)?.forEach((p) => products.add(p));
    }
    for (const p of products) perProductVolume.set(p, [...(perProductVolume.get(p) ?? []), cfg]);
  }

  const products = [...new Set([...perProductBundles.keys(), ...perProductVolume.keys()])].sort();
  if (products.length > MAX_SYNC_PRODUCTS) throw new TooManyProductsError(products.length);

  for (const p of products) {
    const bundles = perProductBundles.get(p);
    if (bundles) {
      metafields.push({
        ownerId: p,
        key: KEYS.productBundles,
        value: serialize(
          productBundlesSchema,
          { schemaVersion: SCHEMA_VERSION, bundles },
          STOREFRONT_MAX_BYTES,
          `Bundles for ${p}`,
        ),
      });
    }
    const rules = perProductVolume.get(p);
    if (rules) {
      metafields.push({
        ownerId: p,
        key: KEYS.productVolume,
        value: serialize(
          productVolumeSchema,
          { schemaVersion: SCHEMA_VERSION, rules },
          STOREFRONT_MAX_BYTES,
          `Volume rules for ${p}`,
        ),
      });
    }
  }
  return { metafields, productGids: products };
}

export interface BuiltPack {
  json: string;
  /** True when no active bundle, volume rule or discounted upsell exists (the discount can be switched off). */
  empty: boolean;
}

/**
 * The rule pack read by the Function from the shop's single discount node. Deterministic output.
 * Fails with ConfigTooLargeError when active rules exceed the 9,500-byte Function budget.
 */
export function buildRulePack(state: SyncState, currency: string): BuiltPack {
  const bundles = state.bundles
    .filter((b) => b.status === "ACTIVE")
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(toBundleConfig);
  const volume = state.volumeRules
    .filter((v) => v.status === "ACTIVE")
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(volumeRowToConfig);
  const upsells = state.upsellRules
    .filter((u) => u.status === "ACTIVE" && (u.discountPercent ?? 0) > 0)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((u) => ({ id: u.id, offerIds: u.offerGids, percentOff: u.discountPercent as number }));
  const collectionIds = new Set<string>();
  for (const b of bundles)
    for (const c of b.components) if (c.collectionId) collectionIds.add(c.collectionId);
  for (const v of volume) if (v.targetType === "COLLECTION") v.targetIds.forEach((g) => collectionIds.add(g));
  const settings = (state.settings ?? {}) as { stackVolumeWithBundles?: boolean };
  const json = serialize(
    rulePackSchema,
    {
      schemaVersion: SCHEMA_VERSION,
      bundles,
      volume,
      upsells,
      stackVolumeWithBundles: settings.stackVolumeWithBundles === true,
      collectionIds: [...collectionIds].sort(),
      currency,
    },
    FUNCTION_MAX_BYTES,
    "Active rules",
  );
  return { json, empty: bundles.length + volume.length + upsells.length === 0 };
}
