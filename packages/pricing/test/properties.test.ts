import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  allocate,
  computeBundleDiscount,
  computeShippingProgress,
  computeVolumeDiscount,
  pickActiveTier,
  type BundleRule,
  type PricingLine,
  type Tier,
  type VolumeRule,
} from "../src";

const PRODUCTS = ["A", "B", "C", "D"];
const lineArb = (bundleId: string | null = "b1"): fc.Arbitrary<PricingLine> =>
  fc.record({
    id: fc.uuid(),
    productId: fc.constantFrom(...PRODUCTS),
    variantId: fc.constantFrom("v1", "v2", ""),
    quantity: fc.integer({ min: 0, max: 20 }),
    unitPriceMinor: fc.integer({ min: 0, max: 5_000_000 }),
    bundleId: fc.constant(bundleId),
    collectionIds: fc.constantFrom(["C1"], ["C2"], ["C1", "C2"], undefined),
  }) as fc.Arbitrary<PricingLine>;
const linesArb = fc
  .array(lineArb(), { maxLength: 12 })
  .map((ls) => ls.map((l, i) => ({ ...l, id: `l${i}` })));

const bundleArb: fc.Arbitrary<BundleRule> = fc
  .record({
    id: fc.constant("b1"),
    discountType: fc.constantFrom("PERCENT", "AMOUNT", "FIXED_PRICE") as fc.Arbitrary<
      BundleRule["discountType"]
    >,
    discountValue: fc.integer({ min: 0, max: 20_000_000 }),
    components: fc.array(
      fc.record({ productId: fc.constantFrom(...PRODUCTS), quantity: fc.integer({ min: 1, max: 4 }) }),
      { minLength: 1, maxLength: 4 },
    ),
  })
  .map((r) => (r.discountType === "PERCENT" ? { ...r, discountValue: (r.discountValue % 90) + 1 } : r));

const lt = (l: PricingLine) => l.quantity * l.unitPriceMinor;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("properties", () => {
  it("allocate: sums exactly and never exceeds a line's cap", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 10_000_000 }), { minLength: 1, maxLength: 15 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (caps, f) => {
          const total = Math.floor(sum(caps) * f);
          const out = allocate(total, caps);
          expect(sum(out)).toBe(total);
          out.forEach((v, i) => {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(caps[i]);
          });
        },
      ),
      { numRuns: 500 },
    );
  });

  it("bundle: discount never exceeds a line total, and line discounts reconcile to the total", () => {
    fc.assert(
      fc.property(bundleArb, linesArb, (rule, lines) => {
        const r = computeBundleDiscount(rule, lines);
        const byId = new Map(lines.map((l) => [l.id, l]));
        expect(sum(r.lineDiscounts.map((d) => d.amountMinor))).toBe(r.totalMinor);
        for (const d of r.lineDiscounts) {
          expect(d.amountMinor).toBeGreaterThan(0);
          expect(d.amountMinor).toBeLessThanOrEqual(lt(byId.get(d.lineId)!));
        }
        expect(r.totalMinor).toBeLessThanOrEqual(sum(lines.map(lt)));
      }),
      { numRuns: 500 },
    );
  });

  it("bundle FIXED_PRICE never raises the price", () => {
    fc.assert(
      fc.property(bundleArb, linesArb, (rule, lines) => {
        const r = computeBundleDiscount({ ...rule, discountType: "FIXED_PRICE" }, lines);
        expect(r.totalMinor).toBeGreaterThanOrEqual(0);
        const covered = sum(
          lines.filter((l) => r.coveredUnits[l.id]).map((l) => l.unitPriceMinor * r.coveredUnits[l.id]),
        );
        // price paid for the covered units is min(covered, bundlePrice * instances): never above the original
        expect(covered - r.totalMinor).toBeLessThanOrEqual(covered);
        if (r.instances > 0)
          expect(covered - r.totalMinor).toBe(Math.min(covered, rule.discountValue * r.instances));
      }),
      { numRuns: 500 },
    );
  });

  it("bundle: zero-quantity, missing-variant and wrong-id lines never produce a discount", () => {
    fc.assert(
      fc.property(bundleArb, linesArb, (rule, lines) => {
        const bad = lines.map((l, i) =>
          i % 3 === 0
            ? { ...l, quantity: 0 }
            : i % 3 === 1
              ? { ...l, variantId: "" }
              : { ...l, bundleId: "nope" },
        );
        expect(computeBundleDiscount(rule, bad).totalMinor).toBe(0);
      }),
    );
  });

  const tiersArb = fc
    .uniqueArray(fc.integer({ min: 1, max: 30 }), { minLength: 1, maxLength: 6 })
    .chain((qs) =>
      fc.tuple(
        ...qs.map((q) => fc.integer({ min: 1, max: 90 }).map((p): Tier => ({ minQty: q, percentOff: p }))),
      ),
    );

  it("tiers: highest satisfied minQty wins, independent of input order", () => {
    fc.assert(
      fc.property(tiersArb, fc.integer({ min: -2, max: 40 }), (tiers, qty) => {
        const got = pickActiveTier(tiers, qty);
        const eligible = tiers.filter((t) => t.minQty <= qty);
        if (qty < 1 || eligible.length === 0) {
          expect(got).toBeUndefined();
        } else {
          expect(got!.minQty).toBe(Math.max(...eligible.map((t) => t.minQty)));
          expect(pickActiveTier([...tiers].reverse(), qty)).toEqual(got);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("volume: discount never exceeds line totals and reconciles, in both modes", () => {
    fc.assert(
      fc.property(
        tiersArb,
        linesArb,
        fc.constantFrom("GROUP", "PER_LINE") as fc.Arbitrary<VolumeRule["mode"]>,
        (tiers, lines, mode) => {
          const rule: VolumeRule = { id: "v", targetType: "COLLECTION", targetIds: ["C1"], tiers, mode };
          const r = computeVolumeDiscount(rule, lines);
          const byId = new Map(lines.map((l) => [l.id, l]));
          expect(sum(r.lineDiscounts.map((d) => d.amountMinor))).toBe(r.totalMinor);
          for (const d of r.lineDiscounts) expect(d.amountMinor).toBeLessThanOrEqual(lt(byId.get(d.lineId)!));
        },
      ),
      { numRuns: 500 },
    );
  });

  it("shipping: percent is monotonic in subtotal and 100 only when complete", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 0, max: 20_000_000 }),
        fc.integer({ min: 0, max: 1000 }),
        (thr, sub, extra) => {
          const a = computeShippingProgress(sub, thr);
          const b = computeShippingProgress(sub + extra, thr);
          expect(b.percent).toBeGreaterThanOrEqual(a.percent);
          expect(a.percent === 100).toBe(a.complete);
          expect(a.remainingMinor).toBe(Math.max(0, thr - sub));
        },
      ),
    );
  });
});
