import { describe, expect, it } from "vitest";
import {
  ConfigTooLargeError,
  FUNCTION_MAX_BYTES,
  bundleSchema,
  rulePackSchema,
  upsellDiscountSchema,
  parseStored,
  productBundlesSchema,
  serialize,
  volumeRuleSchema,
} from "@bundlekit/config-schema";

const P = (n: number) => `gid://shopify/Product/${n}`;
const bundle = {
  id: "b1",
  title: "Pair",
  type: "FIXED",
  discountType: "PERCENT",
  discountValue: "15",
  components: [
    { productId: P(1), quantity: 1 },
    { productId: P(2), quantity: 1 },
  ],
};
const volume = {
  id: "v1",
  targetType: "PRODUCT",
  targetIds: [P(1)],
  tiers: [
    { minQty: 2, percentOff: 10 },
    { minQty: 3, percentOff: 15 },
  ],
};

describe("config-schema", () => {
  it("serialises deterministically regardless of key order", () => {
    const a = serialize(bundleSchema, bundle, 10_000, "b");
    const b = serialize(
      bundleSchema,
      JSON.parse(
        JSON.stringify(bundle, [
          "title",
          "id",
          "components",
          "type",
          "discountType",
          "discountValue",
          "productId",
          "quantity",
        ]),
      ),
      10_000,
      "b",
    );
    expect(a).toBe(b);
  });
  it("requires exactly one of productId / collectionId per component", () => {
    expect(bundleSchema.safeParse({ ...bundle, components: [{ quantity: 1 }] }).success).toBe(false);
    expect(
      bundleSchema.safeParse({
        ...bundle,
        components: [{ productId: P(1), collectionId: "gid://shopify/Collection/1", quantity: 1 }],
      }).success,
    ).toBe(false);
  });
  it("requires strictly increasing tiers, 2-5 tiers, percent 1-90", () => {
    expect(volumeRuleSchema.safeParse(volume).success).toBe(true);
    expect(
      volumeRuleSchema.safeParse({
        ...volume,
        tiers: [
          { minQty: 3, percentOff: 10 },
          { minQty: 3, percentOff: 15 },
        ],
      }).success,
    ).toBe(false);
    expect(volumeRuleSchema.safeParse({ ...volume, tiers: [{ minQty: 2, percentOff: 10 }] }).success).toBe(
      false,
    );
    expect(
      volumeRuleSchema.safeParse({
        ...volume,
        tiers: [
          { minQty: 2, percentOff: 91 },
          { minQty: 3, percentOff: 95 },
        ],
      }).success,
    ).toBe(false);
  });
  it("enforces the byte cap with ConfigTooLargeError", () => {
    expect(() => serialize(rulePackSchema, { schemaVersion: 1, bundles: [bundle] }, 100, "pack")).toThrow(
      ConfigTooLargeError,
    );
  });
  it("a realistic pack fits the Function limit; a huge one fails with a clear error", () => {
    const mk = (n: number) => ({ ...bundle, id: `bundle-${n}`, title: `Bundle number ${n}` });
    const realistic = {
      schemaVersion: 1,
      bundles: Array.from({ length: 10 }, (_, i) => mk(i)),
      volume: [volume, { ...volume, id: "v2" }],
      upsells: [{ id: "u1", offerIds: [P(3)], percentOff: 10 }],
    };
    expect(
      new TextEncoder().encode(serialize(rulePackSchema, realistic, FUNCTION_MAX_BYTES, "pack")).length,
    ).toBeLessThan(FUNCTION_MAX_BYTES);
    const huge = { schemaVersion: 1, bundles: Array.from({ length: 50 }, (_, i) => mk(i)) };
    expect(() => serialize(rulePackSchema, huge, FUNCTION_MAX_BYTES, "pack")).toThrow(/limit is 9500/);
  });
  it("a bundle may have at most one collection component; upsells offer at most 3 products", () => {
    const c = (n: number) => ({ collectionId: `gid://shopify/Collection/${n}`, quantity: 1 });
    expect(bundleSchema.safeParse({ ...bundle, components: [c(1), c(2)] }).success).toBe(false);
    expect(
      bundleSchema.safeParse({ ...bundle, components: [c(1), { productId: P(1), quantity: 1 }] }).success,
    ).toBe(true);
    expect(
      upsellDiscountSchema.safeParse({ id: "u", offerIds: [P(1), P(2), P(3), P(4)], percentOff: 10 }).success,
    ).toBe(false);
  });
  it("readers fail safe on unknown versions, bad JSON and bad shapes", () => {
    expect(parseStored(productBundlesSchema, JSON.stringify({ schemaVersion: 2, bundles: [] }))).toBeNull();
    expect(parseStored(productBundlesSchema, "{nope")).toBeNull();
    expect(
      parseStored(productBundlesSchema, JSON.stringify({ schemaVersion: 1, bundles: [{ id: 1 }] })),
    ).toBeNull();
    expect(parseStored(productBundlesSchema, null)).toBeNull();
    expect(
      parseStored(productBundlesSchema, JSON.stringify({ schemaVersion: 1, bundles: [bundle] }))?.bundles,
    ).toHaveLength(1);
  });
});
