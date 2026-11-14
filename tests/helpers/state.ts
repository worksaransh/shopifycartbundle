import type { BundleRow, SyncState, VolumeRow } from "../../app/services/sync/desired";

export const P = (n: number) => `gid://shopify/Product/${n}`;
export const C = (n: number) => `gid://shopify/Collection/${n}`;

export const bundle = (id: string, productNums: number[], over: Partial<BundleRow> = {}): BundleRow => ({
  id,
  type: "FIXED",
  title: `Bundle ${id}`,
  status: "ACTIVE",
  discountType: "PERCENT",
  discountValue: "15",
  items: productNums.map((n) => ({ productGid: P(n), quantity: 1 })),
  startsAt: null,
  endsAt: null,
  ...over,
});

export const volume = (id: string, targetGids: string[], over: Partial<VolumeRow> = {}): VolumeRow => ({
  id,
  status: "ACTIVE",
  targetType: "PRODUCT",
  targetGids,
  tiers: [
    { minQty: 2, percentOff: 10 },
    { minQty: 3, percentOff: 15 },
  ],
  startsAt: null,
  endsAt: null,
  ...over,
});

export const state = (over: Partial<SyncState> = {}): SyncState => ({
  shopId: "shop1",
  shopDomain: "dev.myshopify.com",
  settings: { shippingBar: { enabled: true, thresholdMinor: "50000" } },
  bundles: [],
  volumeRules: [],
  upsellRules: [],
  syncedProductGids: [],
  ruleDiscountGid: null,
  ...over,
});
