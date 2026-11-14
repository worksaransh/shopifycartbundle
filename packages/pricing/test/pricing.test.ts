import { describe, expect, it } from "vitest";
import {
  allocate,
  computeBundleDiscount,
  computeShippingProgress,
  computeVolumeDiscount,
  decimalToMinor,
  minorToDecimal,
  percentOf,
  pickActiveTier,
  type BundleRule,
  type PricingLine,
  type VolumeRule,
} from "../src";

const line = (
  id: string,
  productId: string,
  qty: number,
  price: number,
  extra: Partial<PricingLine> = {},
): PricingLine => ({
  id,
  productId,
  variantId: `v-${productId}`,
  quantity: qty,
  unitPriceMinor: price,
  bundleId: "b1",
  ...extra,
});

const fixed = (type: BundleRule["discountType"], value: number): BundleRule => ({
  id: "b1",
  discountType: type,
  discountValue: value,
  components: [
    { productId: "A", quantity: 1 },
    { productId: "B", quantity: 1 },
  ],
});

describe("money", () => {
  it("rounds half up", () => {
    expect(percentOf(1005, 10)).toBe(101); // 100.5 -> 101
    expect(percentOf(999, 10)).toBe(100); // 99.9 -> 100
    expect(percentOf(994, 10)).toBe(99); // 99.4 -> 99
    expect(percentOf(5, 10)).toBe(1); // 0.5 -> 1
  });
  it("parses and prints decimals by currency exponent", () => {
    expect(decimalToMinor("12.34", 2)).toBe(1234);
    expect(decimalToMinor("12.3", 2)).toBe(1230);
    expect(decimalToMinor("500", 0)).toBe(500);
    expect(minorToDecimal(1234, 2)).toBe("12.34");
    expect(minorToDecimal(5, 2)).toBe("0.05");
    expect(() => decimalToMinor("12.345", 2)).toThrow();
    expect(() => decimalToMinor("1e3", 2)).toThrow();
    expect(decimalToMinor("12.340", 2)).toBe(1234);
  });
  it("does not lose precision on large amounts", () => {
    expect(percentOf(9_000_000_000_000_000, 15)).toBe(1_350_000_000_000_000);
  });
});

describe("allocate", () => {
  it("adds up exactly with the remainder on the last line", () => {
    const r = allocate(2, [1, 1, 1]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(2);
    expect(r).toEqual([1, 1, 0]); // each rounds up to 1; the overshoot is taken from the last line
  });
  it("splits 10 over three equal lines", () => {
    expect(allocate(10, [100, 100, 100])).toEqual([3, 3, 4]);
  });
  it("rejects totals above capacity", () => {
    expect(() => allocate(11, [5, 5])).toThrow(RangeError);
  });
});

describe("computeBundleDiscount", () => {
  it("applies percent to a complete fixed bundle", () => {
    const r = computeBundleDiscount(fixed("PERCENT", 15), [
      line("l1", "A", 1, 2000),
      line("l2", "B", 1, 1000),
    ]);
    expect(r.instances).toBe(1);
    expect(r.totalMinor).toBe(450);
    expect(r.lineDiscounts).toEqual([
      { lineId: "l1", amountMinor: 300 },
      { lineId: "l2", amountMinor: 150 },
    ]);
  });
  it("gives no discount when a component is missing (incomplete bundle)", () => {
    const r = computeBundleDiscount(fixed("PERCENT", 15), [line("l1", "A", 1, 2000)]);
    expect(r.totalMinor).toBe(0);
    expect(r.instances).toBe(0);
  });
  it("gives no discount when quantity is below the requirement", () => {
    const rule: BundleRule = {
      ...fixed("PERCENT", 10),
      components: [
        { productId: "A", quantity: 2 },
        { productId: "B", quantity: 1 },
      ],
    };
    expect(computeBundleDiscount(rule, [line("l1", "A", 1, 1000), line("l2", "B", 1, 1000)]).totalMinor).toBe(
      0,
    );
  });
  it("ignores lines with another bundle id or none", () => {
    const r = computeBundleDiscount(fixed("PERCENT", 15), [
      line("l1", "A", 1, 2000, { bundleId: "other" }),
      line("l2", "B", 1, 1000, { bundleId: null }),
    ]);
    expect(r.totalMinor).toBe(0);
  });
  it("discounts only covered units when the cart has extra quantity", () => {
    const r = computeBundleDiscount(fixed("PERCENT", 10), [
      line("l1", "A", 3, 1000),
      line("l2", "B", 1, 1000),
    ]);
    expect(r.instances).toBe(1);
    expect(r.coveredUnits).toEqual({ l1: 1, l2: 1 });
    expect(r.totalMinor).toBe(200); // 10% of 2000, not of 4000
  });
  it("handles two instances", () => {
    const r = computeBundleDiscount(fixed("PERCENT", 10), [
      line("l1", "A", 2, 1000),
      line("l2", "B", 2, 1000),
    ]);
    expect(r.instances).toBe(2);
    expect(r.totalMinor).toBe(400);
  });
  it("AMOUNT is per instance and capped at the covered subtotal", () => {
    expect(
      computeBundleDiscount(fixed("AMOUNT", 500), [line("l1", "A", 1, 2000), line("l2", "B", 1, 1000)])
        .totalMinor,
    ).toBe(500);
    expect(
      computeBundleDiscount(fixed("AMOUNT", 9999), [line("l1", "A", 1, 200), line("l2", "B", 1, 100)])
        .totalMinor,
    ).toBe(300);
  });
  it("FIXED_PRICE charges the bundle price, and never raises the price", () => {
    const lines = [line("l1", "A", 1, 2000), line("l2", "B", 1, 1000)];
    expect(computeBundleDiscount(fixed("FIXED_PRICE", 2400), lines).totalMinor).toBe(600);
    expect(computeBundleDiscount(fixed("FIXED_PRICE", 5000), lines).totalMinor).toBe(0);
  });
  it("mix-and-match: any N from a collection", () => {
    const rule: BundleRule = {
      id: "b1",
      discountType: "PERCENT",
      discountValue: 20,
      components: [{ collectionId: "C", quantity: 3 }],
    };
    const inC = { collectionIds: ["C"] };
    const lines = [
      line("l1", "A", 1, 1000, inC),
      line("l2", "B", 1, 1000, inC),
      line("l3", "D", 1, 1000, inC),
    ];
    expect(computeBundleDiscount(rule, lines).totalMinor).toBe(600);
    expect(computeBundleDiscount(rule, lines.slice(0, 2)).totalMinor).toBe(0);
  });
  it("returns nothing for invalid rules and unknown merchandise", () => {
    expect(
      computeBundleDiscount(fixed("PERCENT", 95), [line("l1", "A", 1, 100), line("l2", "B", 1, 100)])
        .totalMinor,
    ).toBe(0);
    expect(
      computeBundleDiscount({ ...fixed("PERCENT", 10), components: [] }, [line("l1", "A", 1, 100)])
        .totalMinor,
    ).toBe(0);
    expect(
      computeBundleDiscount(fixed("PERCENT", 10), [
        line("l1", "A", 1, 100, { variantId: "" }),
        line("l2", "B", 1, 100),
      ]).totalMinor,
    ).toBe(0);
    expect(
      computeBundleDiscount(fixed("PERCENT", 10), [line("l1", "A", 0, 100), line("l2", "B", 1, 100)])
        .totalMinor,
    ).toBe(0);
  });
});

describe("pickActiveTier / computeVolumeDiscount", () => {
  const tiers = [
    { minQty: 2, percentOff: 10 },
    { minQty: 3, percentOff: 15 },
    { minQty: 5, percentOff: 20 },
  ];
  it("picks the highest satisfied tier at each boundary", () => {
    expect(pickActiveTier(tiers, 1)).toBeUndefined();
    expect(pickActiveTier(tiers, 2)?.percentOff).toBe(10);
    expect(pickActiveTier(tiers, 4)?.percentOff).toBe(15);
    expect(pickActiveTier(tiers, 5)?.percentOff).toBe(20);
    expect(pickActiveTier(tiers, 99)?.percentOff).toBe(20);
    expect(pickActiveTier(tiers, 0)).toBeUndefined();
  });
  const rule = (mode: VolumeRule["mode"]): VolumeRule => ({
    id: "v1",
    targetType: "PRODUCT",
    targetIds: ["A", "B"],
    tiers,
    mode,
  });
  const cart = [line("l1", "A", 2, 1000, { bundleId: null }), line("l2", "B", 1, 1000, { bundleId: null })];
  it("GROUP mode uses total quantity of the target", () => {
    const r = computeVolumeDiscount(rule("GROUP"), cart); // qty 3 -> 15% of 3000
    expect(r.tier?.percentOff).toBe(15);
    expect(r.totalMinor).toBe(450);
    expect(r.lineDiscounts.reduce((a, d) => a + d.amountMinor, 0)).toBe(450);
  });
  it("PER_LINE mode picks a tier per line", () => {
    const r = computeVolumeDiscount(rule("PER_LINE"), cart); // l1 qty2 -> 10% of 2000; l2 qty1 -> none
    expect(r.totalMinor).toBe(200);
    expect(r.lineDiscounts).toEqual([{ lineId: "l1", amountMinor: 200 }]);
  });
  it("COLLECTION targets match by collection membership", () => {
    const r = computeVolumeDiscount({ ...rule("GROUP"), targetType: "COLLECTION", targetIds: ["C"] }, [
      line("l1", "X", 3, 1000, { collectionIds: ["C"], bundleId: null }),
    ]);
    expect(r.totalMinor).toBe(450);
  });
  it("skips lines excluded because they are already in a bundle", () => {
    const r = computeVolumeDiscount(rule("GROUP"), cart, { excludeLineIds: new Set(["l1"]) });
    expect(r.totalMinor).toBe(0); // only l2 left, qty 1
  });
  it("handles a 60-line collection cart", () => {
    const lines = Array.from({ length: 60 }, (_, i) =>
      line(`l${i}`, `P${i}`, 1, 1999 + i, { collectionIds: ["C"], bundleId: null }),
    );
    const r = computeVolumeDiscount({ ...rule("GROUP"), targetType: "COLLECTION", targetIds: ["C"] }, lines);
    expect(r.tier?.percentOff).toBe(20);
    expect(r.lineDiscounts.reduce((a, d) => a + d.amountMinor, 0)).toBe(r.totalMinor);
  });
});

describe("computeShippingProgress", () => {
  it("reports remaining and percent", () => {
    expect(computeShippingProgress(66000, 100000)).toEqual({
      enabled: true,
      complete: false,
      remainingMinor: 34000,
      percent: 66,
    });
  });
  it("is 99 just below the threshold, 100 at it", () => {
    expect(computeShippingProgress(99999, 100000).percent).toBe(99);
    expect(computeShippingProgress(100000, 100000)).toMatchObject({
      complete: true,
      percent: 100,
      remainingMinor: 0,
    });
  });
  it("is disabled without a valid threshold", () => {
    expect(computeShippingProgress(500, 0).enabled).toBe(false);
    expect(computeShippingProgress(-1, 1000).enabled).toBe(false);
  });
});
