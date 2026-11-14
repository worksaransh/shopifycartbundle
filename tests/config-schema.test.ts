import { describe, expect, it } from "vitest";
import {
  ConfigTooLargeError,
  FUNCTION_MAX_BYTES,
  bundleSchema,
  functionConfigSchema,
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
    const cfg = { schemaVersion: 1, kind: "BUNDLE", bundle };
    expect(() => serialize(functionConfigSchema, cfg, 100, "rule")).toThrow(ConfigTooLargeError);
  });
  it("worst-case schema-valid Function configs stay under the 10,000-byte Function input limit", () => {
    const gid = (i: number) => `gid://shopify/Product/${9_000_000_000_000 + i}`;
    const worstVolume = {
      schemaVersion: 1,
      kind: "VOLUME",
      stackWithBundles: true,
      rule: {
        id: "x".repeat(64),
        targetType: "PRODUCT",
        targetIds: Array.from({ length: 100 }, (_, i) => gid(i)),
        mode: "PER_LINE",
        tiers: [2, 3, 4, 5, 6].map((q) => ({ minQty: q, percentOff: 90 })),
        startsAt: "2026-11-14T10:00:00.000+05:30",
        endsAt: "2026-12-14T10:00:00.000+05:30",
      },
    };
    const worstBundle = {
      schemaVersion: 1,
      kind: "BUNDLE",
      bundle: {
        id: "x".repeat(64),
        title: "é".repeat(80),
        type: "MIX_MATCH",
        badge: "é".repeat(40),
        discountType: "FIXED_PRICE",
        discountValue: "999999999999999",
        components: Array.from({ length: 10 }, (_, i) => ({ productId: gid(i), quantity: 99 })),
        startsAt: "2026-11-14T10:00:00.000+05:30",
        endsAt: "2026-12-14T10:00:00.000+05:30",
      },
    };
    for (const cfg of [worstVolume, worstBundle]) {
      expect(
        new TextEncoder().encode(serialize(functionConfigSchema, cfg, FUNCTION_MAX_BYTES, "worst")).length,
      ).toBeLessThan(FUNCTION_MAX_BYTES);
    }
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
