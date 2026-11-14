import { ConfigTooLargeError, parseStored, rulePackSchema } from "@bundlekit/config-schema";
import { describe, expect, it } from "vitest";
import { GqlClient } from "../app/services/sync/gql";
import { reconcileShop } from "../app/services/sync/reconcile";
import { runSync, type SyncRepo } from "../app/services/sync/run";
import { syncShop } from "../app/services/sync/sync";
import { FakeShopify } from "./helpers/fake-shopify";
import { bundle, C, P, state, upsell, volume } from "./helpers/state";

const client = (fake: FakeShopify) => new GqlClient(fake, { sleep: async () => {} });
const packOf = (fake: FakeShopify, gid: string) => parseStored(rulePackSchema, fake.store.get(`${gid}|fn`));

describe("rule pack discount node", () => {
  it("creates ONE automatic discount with the Function handle, PRODUCT class and safe combinesWith", async () => {
    const fake = new FakeShopify();
    const r = await syncShop(
      client(fake),
      state({ bundles: [bundle("b1", [1, 2]), bundle("b2", [3])], volumeRules: [volume("v1", [P(1)])] }),
    );
    expect(r.ruleDiscountGid).toBe("gid://shopify/DiscountAutomaticNode/1");
    expect(fake.createdDiscounts).toHaveLength(1);
    expect(fake.createdDiscounts[0]).toMatchObject({
      functionHandle: "bundlekit-discount",
      discountClasses: ["PRODUCT"],
      combinesWith: { orderDiscounts: true, shippingDiscounts: true, productDiscounts: false },
    });
    const pack = packOf(fake, r.ruleDiscountGid!);
    expect(pack?.bundles.map((b) => b.id)).toEqual(["b1", "b2"]);
    expect(pack?.volume).toHaveLength(1);
    expect(pack?.currency).toBe("INR");
    expect(pack?.stackVolumeWithBundles).toBe(false);
  });

  it("reuses the node on later syncs and updates its pack in place", async () => {
    const fake = new FakeShopify();
    const r1 = await syncShop(client(fake), state({ bundles: [bundle("b1", [1, 2])] }));
    const r2 = await syncShop(
      client(fake),
      state({
        bundles: [bundle("b1", [1, 2]), bundle("b2", [3])],
        ruleDiscountGid: r1.ruleDiscountGid,
        syncedProductGids: r1.productGids,
      }),
    );
    expect(fake.createdDiscounts).toHaveLength(1);
    expect(r2.ruleDiscountGid).toBe(r1.ruleDiscountGid);
    expect(packOf(fake, r2.ruleDiscountGid!)?.bundles).toHaveLength(2);
    expect(fake.nodes.get(r2.ruleDiscountGid!)).toBe("ACTIVE");
  });

  it("creates nothing when there are no rules; deactivates the node when the last rule is paused", async () => {
    const fake = new FakeShopify();
    expect((await syncShop(client(fake), state())).ruleDiscountGid).toBeNull();
    expect(fake.nodes.size).toBe(0);

    const r1 = await syncShop(client(fake), state({ bundles: [bundle("b1", [1])] }));
    const r2 = await syncShop(
      client(fake),
      state({
        bundles: [bundle("b1", [1], { status: "PAUSED" })],
        ruleDiscountGid: r1.ruleDiscountGid,
        syncedProductGids: r1.productGids,
      }),
    );
    expect(fake.nodes.get(r2.ruleDiscountGid!)).toBe("EXPIRED");
    expect(packOf(fake, r2.ruleDiscountGid!)?.bundles).toEqual([]);

    const r3 = await syncShop(
      client(fake),
      state({ bundles: [bundle("b1", [1])], ruleDiscountGid: r2.ruleDiscountGid }),
    );
    expect(fake.nodes.get(r3.ruleDiscountGid!)).toBe("ACTIVE");
  });

  it("recreates the node if the merchant deleted it in the Shopify admin", async () => {
    const fake = new FakeShopify();
    const r1 = await syncShop(client(fake), state({ bundles: [bundle("b1", [1])] }));
    fake.nodes.delete(r1.ruleDiscountGid!);
    const r2 = await syncShop(
      client(fake),
      state({ bundles: [bundle("b1", [1])], ruleDiscountGid: r1.ruleDiscountGid }),
    );
    expect(r2.ruleDiscountGid).not.toBe(r1.ruleDiscountGid);
    expect(fake.createdDiscounts).toHaveLength(2);
  });

  it("includes discounted upsells only, unions collection ids, honours the stacking setting", async () => {
    const fake = new FakeShopify();
    fake.collections.set(C(1), [P(50)]);
    const s = state({
      settings: { stackVolumeWithBundles: true },
      volumeRules: [volume("v1", [C(1)], { targetType: "COLLECTION" })],
      bundles: [bundle("b1", [], { type: "MIX_MATCH", items: [{ collectionGid: C(2), quantity: 3 }] })],
      upsellRules: [
        upsell("u1", [7], { discountPercent: 10 }),
        upsell("u2", [8]),
        upsell("u3", [9], { status: "PAUSED", discountPercent: 20 }),
      ],
    });
    fake.collections.set(C(2), [P(60)]);
    const r = await syncShop(client(fake), s);
    const pack = packOf(fake, r.ruleDiscountGid!);
    expect(pack?.upsells).toEqual([{ id: "u1", offerIds: [P(7)], percentOff: 10 }]);
    expect(pack?.collectionIds).toEqual([C(1), C(2)]);
    expect(pack?.stackVolumeWithBundles).toBe(true);
  });

  it("fails with ConfigTooLargeError and writes nothing when active rules exceed the Function budget", async () => {
    const fake = new FakeShopify();
    const many = Array.from({ length: 45 }, (_, i) =>
      bundle(`bundle-${String(i).padStart(2, "0")}`, [i + 1, i + 100, i + 200], {
        title: "A reasonably long bundle title here",
      }),
    );
    const err = await syncShop(client(fake), state({ bundles: many })).catch((e) => e);
    expect(err).toBeInstanceOf(ConfigTooLargeError);
    expect(fake.store.size).toBe(0);
    expect(fake.nodes.size).toBe(0);
  });
});

describe("rule pack reconcile and persistence", () => {
  it("repairs a corrupted or missing pack on the node, then is clean", async () => {
    const fake = new FakeShopify();
    const s = state({ bundles: [bundle("b1", [1, 2])] });
    const r = await syncShop(client(fake), s);
    const synced = { ...s, ruleDiscountGid: r.ruleDiscountGid, syncedProductGids: r.productGids };
    fake.store.set(`${r.ruleDiscountGid}|fn`, '{"schemaVersion":1,"bundles":[]}');
    expect(await reconcileShop(client(fake), synced, { repair: false })).toMatchObject({ changed: 1 });
    expect(await reconcileShop(client(fake), synced)).toMatchObject({ changed: 1, repaired: true });
    expect(packOf(fake, r.ruleDiscountGid!)?.bundles).toHaveLength(1);
    expect(await reconcileShop(client(fake), synced)).toMatchObject({
      missing: 0,
      changed: 0,
      stale: 0,
      repaired: false,
    });
  });

  it("runSync stores the node gid for next time", async () => {
    const fake = new FakeShopify();
    let saved: string | null = null;
    const repo: SyncRepo = {
      load: async () => state({ bundles: [bundle("b1", [1])] }),
      markSyncing: async () => {},
      markSynced: async (_id, _gids, node) => void (saved = node),
      markFailed: async () => {},
    };
    await runSync("dev.myshopify.com", { repo, admin: async () => fake });
    expect(saved).toBe("gid://shopify/DiscountAutomaticNode/1");
  });
});

describe("storefront upsell metafield", () => {
  it("publishes ACTIVE upsell rules (with handles) to the shop, including undiscounted ones", async () => {
    const fake = new FakeShopify();
    await syncShop(
      client(fake),
      state({
        upsellRules: [
          upsell("u1", [7, 8], { discountPercent: 10, maxOffers: 3 }),
          upsell("u2", [9], { status: "PAUSED" }),
        ],
      }),
    );
    const raw = JSON.parse(fake.store.get(`${fake.shopGid}|upsells`)!);
    expect(raw.rules).toHaveLength(1);
    expect(raw.rules[0]).toMatchObject({
      id: "u1",
      offerHandles: ["offer-7", "offer-8"],
      discountPercent: 10,
      maxOffers: 2,
      layout: "STACKED",
    });
  });
});

describe("handles", () => {
  it("storefront metafields keep component handles; the Function pack strips them (size budget)", async () => {
    const fake = new FakeShopify();
    const b = bundle("b1", [1, 2], {
      items: [
        { productGid: P(1), handle: "mug", quantity: 1 },
        { productGid: P(2), handle: "plate", quantity: 1 },
      ],
    });
    const r = await syncShop(client(fake), state({ bundles: [b] }));
    const storefront = JSON.parse(fake.store.get(`${P(1)}|bundles`)!);
    expect(storefront.bundles[0].components.map((c: { handle: string }) => c.handle)).toEqual([
      "mug",
      "plate",
    ]);
    const pack = JSON.parse(fake.store.get(`${r.ruleDiscountGid}|fn`)!);
    expect(JSON.stringify(pack)).not.toContain("mug");
    expect(pack.bundles[0].components.every((c: object) => !("handle" in c))).toBe(true);
  });
});

describe("upsell trigger expansion", () => {
  it("expands collection triggers to product ids for the storefront", async () => {
    const fake = new FakeShopify();
    fake.collections.set(C(3), [P(30), P(31)]);
    await syncShop(
      client(fake),
      state({
        upsellRules: [
          upsell("u1", [7], { triggerType: "COLLECTION", triggerGids: [C(3)] }),
          upsell("u2", [8], { triggerType: "COLLECTION", triggerGids: [C(404)] }),
        ],
      }),
    );
    const rules = JSON.parse(fake.store.get(`${fake.shopGid}|upsells`)!).rules;
    expect(rules).toHaveLength(1); // u2's collection has no products, so it can never fire
    expect(rules[0].triggerProductIds).toEqual([P(30), P(31)]);
  });
});

describe("shop config currency", () => {
  it("stamps the shop currency into shippingBar so the storefront can skip other-currency carts", async () => {
    const fake = new FakeShopify();
    await syncShop(
      client(fake),
      state({ settings: { shippingBar: { enabled: true, thresholdMinor: "50000" } } }),
    );
    const cfg = JSON.parse(fake.store.get(`${fake.shopGid}|config`)!);
    expect(cfg.shippingBar).toMatchObject({ enabled: true, thresholdMinor: "50000", currency: "INR" });
  });
});
