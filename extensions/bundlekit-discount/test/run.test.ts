import { describe, expect, it } from "vitest";
import { cartLinesDiscountsGenerateRun, type FunctionInput } from "../src/run";

const P = (n: number) => `gid://shopify/Product/${n}`;
const C = (n: number) => `gid://shopify/Collection/${n}`;

interface LineSpec {
  id: string;
  product: number;
  qty?: number;
  price?: string;
  bundle?: string;
  upsell?: string;
  inCollections?: number[];
  type?: string;
}

function cart(lines: LineSpec[], pack: unknown | null | string, currency = "INR"): FunctionInput {
  const colls = [...new Set(lines.flatMap((l) => l.inCollections ?? []))];
  return {
    cart: {
      cost: { subtotalAmount: { currencyCode: currency } },
      lines: lines.map((l) => ({
        id: `gid://shopify/CartLine/${l.id}`,
        quantity: l.qty ?? 1,
        bundleId: l.bundle ? { value: l.bundle } : null,
        upsellId: l.upsell ? { value: l.upsell } : null,
        cost: { amountPerQuantity: { amount: l.price ?? "100.00" } },
        merchandise:
          l.type && l.type !== "ProductVariant"
            ? { __typename: l.type }
            : {
                __typename: "ProductVariant",
                id: `gid://shopify/ProductVariant/${l.product}01`,
                product: {
                  id: P(l.product),
                  inCollections: colls.map((c) => ({
                    collectionId: C(c),
                    isMember: !!l.inCollections?.includes(c),
                  })),
                },
              },
      })),
    },
    discountNode: {
      metafield: pack === null ? null : { value: typeof pack === "string" ? pack : JSON.stringify(pack) },
    },
  };
}

const L = (id: string) => `gid://shopify/CartLine/${id}`;
const pack = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  bundles: [],
  volume: [],
  upsells: [],
  stackVolumeWithBundles: false,
  collectionIds: [],
  ...over,
});
const pair = (type = "PERCENT", value = "15", extra: Record<string, unknown> = {}) => ({
  id: "b1",
  title: "Pair",
  type: "FIXED",
  discountType: type,
  discountValue: value,
  components: [
    { productId: P(1), quantity: 1 },
    { productId: P(2), quantity: 1 },
  ],
  ...extra,
});
const tiers = [
  { minQty: 2, percentOff: 10 },
  { minQty: 3, percentOff: 15 },
  { minQty: 5, percentOff: 20 },
];
const vol = (targetIds: string[], targetType = "PRODUCT", mode = "GROUP") => ({
  id: "v1",
  targetType,
  targetIds,
  mode,
  tiers,
});

/** candidates flattened: [{ line, quantity, amount, message }] */
function out(input: FunctionInput) {
  const r = cartLinesDiscountsGenerateRun(input);
  const op = r.operations[0] as
    { productDiscountsAdd?: { candidates: any[]; selectionStrategy: string } } | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    raw: r,
    c: (op?.productDiscountsAdd?.candidates ?? []).map((c) => ({
      line: c.targets[0].cartLine.id as string,
      quantity: c.targets[0].cartLine.quantity as number,
      amount: c.value.fixedAmount.amount as string,
      message: c.message as string,
    })),
    strategy: op?.productDiscountsAdd?.selectionStrategy,
  };
}
const total = (c: { amount: string }[]) => c.reduce((n, x) => n + Number(x.amount), 0);

describe("bundles", () => {
  it("1. complete fixed bundle, percent: discount split across both lines", () => {
    const r = out(
      cart(
        [
          { id: "1", product: 1, price: "200.00", bundle: "b1" },
          { id: "2", product: 2, price: "100.00", bundle: "b1" },
        ],
        pack({ bundles: [pair()] }),
      ),
    );
    expect(r.c).toEqual([
      { line: L("1"), quantity: 1, amount: "30.00", message: "Bundle: Pair" },
      { line: L("2"), quantity: 1, amount: "15.00", message: "Bundle: Pair" },
    ]);
    expect(r.strategy).toBe("ALL");
  });
  it("2. incomplete bundle (one component removed) gets no discount", () => {
    expect(out(cart([{ id: "1", product: 1, bundle: "b1" }], pack({ bundles: [pair()] }))).c).toEqual([]);
  });
  it("3. extra quantity: only the covered units are discounted", () => {
    const r = out(
      cart(
        [
          { id: "1", product: 1, qty: 3, bundle: "b1" },
          { id: "2", product: 2, bundle: "b1" },
        ],
        pack({ bundles: [pair("PERCENT", "10")] }),
      ),
    );
    expect(r.c.map((x) => [x.line, x.quantity, x.amount])).toEqual([
      [L("1"), 1, "10.00"],
      [L("2"), 1, "10.00"],
    ]);
  });
  it("4. two bundle instances", () => {
    const r = out(
      cart(
        [
          { id: "1", product: 1, qty: 2, bundle: "b1" },
          { id: "2", product: 2, qty: 2, bundle: "b1" },
        ],
        pack({ bundles: [pair("PERCENT", "10")] }),
      ),
    );
    expect(total(r.c)).toBeCloseTo(40);
    expect(r.c.map((x) => x.quantity)).toEqual([2, 2]);
  });
  it("5. AMOUNT off per bundle", () => {
    expect(
      total(
        out(
          cart(
            [
              { id: "1", product: 1, bundle: "b1" },
              { id: "2", product: 2, bundle: "b1" },
            ],
            pack({ bundles: [pair("AMOUNT", "5000")], currency: "INR" }),
          ),
        ).c,
      ),
    ).toBeCloseTo(50);
  });
  it("6. FIXED_PRICE bundle, and it never raises the price", () => {
    const lines = [
      { id: "1", product: 1, bundle: "b1" },
      { id: "2", product: 2, bundle: "b1" },
    ];
    expect(
      total(out(cart(lines, pack({ bundles: [pair("FIXED_PRICE", "15000")], currency: "INR" }))).c),
    ).toBeCloseTo(50);
    expect(out(cart(lines, pack({ bundles: [pair("FIXED_PRICE", "99999")], currency: "INR" }))).c).toEqual(
      [],
    );
  });
  it("7. mix-and-match: any 3 from a collection", () => {
    const b = {
      id: "b1",
      title: "Any 3",
      type: "MIX_MATCH",
      discountType: "PERCENT",
      discountValue: "20",
      components: [{ collectionId: C(9), quantity: 3 }],
    };
    const three = [1, 2, 3].map((n) => ({ id: String(n), product: n, bundle: "b1", inCollections: [9] }));
    expect(total(out(cart(three, pack({ bundles: [b], collectionIds: [C(9)] }))).c)).toBeCloseTo(60);
    expect(out(cart(three.slice(0, 2), pack({ bundles: [b], collectionIds: [C(9)] }))).c).toEqual([]);
  });
  it("8. a line with another or no _bundle_id is ignored", () => {
    expect(
      out(
        cart(
          [
            { id: "1", product: 1, bundle: "other" },
            { id: "2", product: 2 },
          ],
          pack({ bundles: [pair()] }),
        ),
      ).c,
    ).toEqual([]);
  });
});

describe("volume tiers", () => {
  const lines = (q: number) => [{ id: "1", product: 1, qty: q }];
  it("9. tier boundaries: below, at and above each tier", () => {
    const p = pack({ volume: [vol([P(1)])] });
    const pct = (q: number) => total(out(cart(lines(q), p)).c) / (q * 100);
    expect(out(cart(lines(1), p)).c).toEqual([]);
    expect(pct(2)).toBeCloseTo(0.1);
    expect(pct(3)).toBeCloseTo(0.15);
    expect(pct(4)).toBeCloseTo(0.15);
    expect(pct(5)).toBeCloseTo(0.2);
    expect(pct(50)).toBeCloseTo(0.2);
  });
  it("10. collection target with 60 lines sums exactly to the tier percent", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      id: String(i),
      product: 100 + i,
      price: (19.99 + i).toFixed(2),
      inCollections: [5],
    }));
    const r = out(cart(many, pack({ volume: [vol([C(5)], "COLLECTION")], collectionIds: [C(5)] })));
    const subtotal = many.reduce((n, l) => n + Number(l.price), 0);
    expect(r.c).toHaveLength(60);
    expect(total(r.c)).toBeCloseTo(subtotal * 0.2, 1);
  });
  it("11. PER_LINE picks each line's own tier", () => {
    const r = out(
      cart(
        [
          { id: "1", product: 1, qty: 2 },
          { id: "2", product: 1, qty: 1 },
        ],
        pack({ volume: [vol([P(1)], "PRODUCT", "PER_LINE")] }),
      ),
    );
    expect(r.c.map((x) => [x.line, x.amount])).toEqual([[L("1"), "20.00"]]);
  });
});

describe("conflicts and upsells", () => {
  const bundledCart = [
    { id: "1", product: 1, qty: 3, bundle: "b1" },
    { id: "2", product: 2, bundle: "b1" },
  ];
  it("12. bundled lines do not also get a volume discount by default", () => {
    const r = out(cart(bundledCart, pack({ bundles: [pair("PERCENT", "10")], volume: [vol([P(1)])] })));
    expect(r.c.every((x) => x.message.startsWith("Bundle"))).toBe(true);
  });
  it("13. stacking enabled: volume also applies, never beyond the line total", () => {
    const r = out(
      cart(
        bundledCart,
        pack({
          bundles: [pair("PERCENT", "90")],
          volume: [
            {
              ...vol([P(1)]),
              tiers: [
                { minQty: 2, percentOff: 90 },
                { minQty: 3, percentOff: 90 },
              ],
            },
          ],
          stackVolumeWithBundles: true,
        }),
      ),
    );
    const line1 = r.c.filter((x) => x.line === L("1"));
    expect(line1.map((x) => x.message.split(" ")[0])).toEqual(["Bundle:", "Volume"]);
    expect(total(line1)).toBeLessThanOrEqual(300);
  });
  it("14. upsell with a valid _upsell_id and offered product gets its percent", () => {
    const r = out(
      cart(
        [{ id: "1", product: 7, price: "200.00", upsell: "u1" }],
        pack({ upsells: [{ id: "u1", offerIds: [P(7)], percentOff: 10 }] }),
      ),
    );
    expect(r.c).toEqual([{ line: L("1"), quantity: 1, amount: "20.00", message: "Offer 10% off" }]);
  });
  it("15. upsell id on the wrong product, or unknown id, gets nothing (cannot be spoofed)", () => {
    const p = pack({ upsells: [{ id: "u1", offerIds: [P(7)], percentOff: 10 }] });
    expect(out(cart([{ id: "1", product: 8, upsell: "u1" }], p)).c).toEqual([]);
    expect(out(cart([{ id: "1", product: 7, upsell: "forged" }], p)).c).toEqual([]);
  });
});

describe("currency and safety", () => {
  it("16. zero-decimal currency (JPY) stays in whole units", () => {
    const r = out(
      cart(
        [
          { id: "1", product: 1, price: "1500", bundle: "b1" },
          { id: "2", product: 2, price: "500", bundle: "b1" },
        ],
        pack({ bundles: [pair("PERCENT", "10")] }),
        "JPY",
      ),
    );
    expect(r.c.map((x) => x.amount)).toEqual(["150", "50"]);
  });
  it("17. three-decimal currency (KWD)", () => {
    const r = out(
      cart(
        [
          { id: "1", product: 1, price: "10.000", bundle: "b1" },
          { id: "2", product: 2, price: "5.500", bundle: "b1" },
        ],
        pack({ bundles: [pair("PERCENT", "10")] }),
        "KWD",
      ),
    );
    expect(r.c.map((x) => x.amount)).toEqual(["1.000", "0.550"]);
  });
  it("18. mixed currency: fixed amounts are skipped, percent still applies", () => {
    const lines = [
      { id: "1", product: 1, bundle: "b1" },
      { id: "2", product: 2, bundle: "b1" },
    ];
    const p = pack({ currency: "INR", bundles: [pair("AMOUNT", "5000")] });
    expect(out(cart(lines, p, "USD")).c).toEqual([]);
    expect(
      out(cart(lines, pack({ currency: "INR", bundles: [pair("PERCENT", "10")] }), "USD")).c,
    ).toHaveLength(2);
  });
  it("19. fails open: missing, corrupt, wrong-version or hostile config gives no discount and never throws", () => {
    const lines = [{ id: "1", product: 1, bundle: "b1" }];
    for (const bad of [
      null,
      "{not json",
      "[]",
      JSON.stringify({ schemaVersion: 2 }),
      JSON.stringify({ schemaVersion: 1, bundles: [{ id: "b1" }] }),
      "null",
    ]) {
      expect(() => cartLinesDiscountsGenerateRun(cart(lines, bad))).not.toThrow();
      expect(cartLinesDiscountsGenerateRun(cart(lines, bad)).operations).toEqual([]);
    }
    expect(cartLinesDiscountsGenerateRun({ cart: { lines: null } } as never).operations).toEqual([]);
  });
  it("20. non-variant merchandise, zero quantity and bad prices are skipped; a 100-line cart is fine", () => {
    const lines: LineSpec[] = [
      { id: "1", product: 1, bundle: "b1" },
      { id: "2", product: 2, bundle: "b1" },
      { id: "3", product: 3, type: "CustomProduct" },
      { id: "4", product: 1, qty: 0, bundle: "b1" },
      { id: "5", product: 1, price: "abc", bundle: "b1" },
      ...Array.from({ length: 95 }, (_, i) => ({ id: `x${i}`, product: 500 + i })),
    ];
    const started = Date.now();
    const r = out(cart(lines, pack({ bundles: [pair()], volume: [vol([P(1)])] })));
    expect(Date.now() - started).toBeLessThan(500);
    expect(r.c.map((x) => x.line)).toEqual([L("1"), L("2")]);
  });
});
