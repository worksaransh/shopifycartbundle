import {
  productBundlesSchema,
  productVolumeSchema,
  parseStored,
  shopConfigSchema,
} from "@bundlekit/config-schema";
import { describe, expect, it, vi } from "vitest";
import { GqlClient, ShopifyApiError } from "../app/services/sync/gql";
import { reconcileShop } from "../app/services/sync/reconcile";
import { runReconcile, runSync, type SyncRepo } from "../app/services/sync/run";
import { syncShop } from "../app/services/sync/sync";
import { FakeShopify } from "./helpers/fake-shopify";
import { bundle, C, P, state, volume } from "./helpers/state";

const client = (fake: FakeShopify, over = {}) =>
  new GqlClient(fake, { sleep: async () => {}, random: () => 0.5, ...over });

describe("syncShop", () => {
  it("writes shop config and the right product metafields, readable back", async () => {
    const fake = new FakeShopify();
    const s = state({ bundles: [bundle("b1", [1, 2])], volumeRules: [volume("v1", [P(1)])] });
    const report = await syncShop(client(fake), s);

    expect(report.productGids).toEqual([P(1), P(2)]);
    const cfg = parseStored(shopConfigSchema, fake.store.get(`${fake.shopGid}|config`));
    expect(cfg?.shippingBar.thresholdMinor).toBe("50000");
    expect(fake.keysOf(P(1)).sort()).toEqual(["bundles", "volume"]);
    expect(fake.keysOf(P(2))).toEqual(["bundles"]);
    const b = parseStored(productBundlesSchema, fake.store.get(`${P(1)}|bundles`));
    expect(b?.bundles[0]).toMatchObject({ id: "b1", discountType: "PERCENT", discountValue: "15" });
    expect(b?.bundles[0].components.map((c) => c.productId)).toEqual([P(1), P(2)]);
    expect(parseStored(productVolumeSchema, fake.store.get(`${P(1)}|volume`))?.rules[0].tiers).toHaveLength(
      2,
    );
  });

  it("ignores PAUSED and DRAFT rules", async () => {
    const fake = new FakeShopify();
    await syncShop(
      client(fake),
      state({
        bundles: [bundle("b1", [1], { status: "PAUSED" })],
        volumeRules: [volume("v1", [P(1)], { status: "DRAFT" })],
      }),
    );
    expect(fake.keysOf(P(1))).toEqual([]);
  });

  it("expands collection targets to their products (50+ products, paginated)", async () => {
    const fake = new FakeShopify();
    fake.collections.set(
      C(1),
      Array.from({ length: 300 }, (_, i) => P(1000 + i)),
    );
    await syncShop(
      client(fake),
      state({ volumeRules: [volume("v1", [C(1)], { targetType: "COLLECTION" })] }),
    );
    expect(fake.keysOf(P(1000))).toEqual(["volume"]);
    expect(fake.keysOf(P(1299))).toEqual(["volume"]);
    expect(fake.calls.filter((c) => c.op === "collection")).toHaveLength(2); // 250 + 50
  });

  it("batches writes in groups of at most 25", async () => {
    const fake = new FakeShopify();
    const ids = Array.from({ length: 60 }, (_, i) => i + 1);
    await syncShop(client(fake), state({ bundles: [bundle("b1", ids.slice(0, 10))], volumeRules: [] }));
    fake.calls.length = 0;
    fake.store.clear();
    fake.collections.set(C(2), ids.map(P));
    await syncShop(
      client(fake),
      state({ bundles: [bundle("b2", [], { items: [{ collectionGid: C(2), quantity: 2 }] })] }),
    );
    expect(fake.setCalls().map((c) => c.size)).toEqual([25, 25, 13]); // shop config + upsells + 60 products + rule pack
  });

  it("removes metafields that no longer apply, key by key", async () => {
    const fake = new FakeShopify();
    const s1 = state({ bundles: [bundle("b1", [1, 2])], volumeRules: [volume("v1", [P(1)])] });
    const r1 = await syncShop(client(fake), s1);
    // pause the volume rule and drop product 2 from the bundle
    const s2 = state({
      bundles: [bundle("b1", [1])],
      volumeRules: [volume("v1", [P(1)], { status: "PAUSED" })],
      syncedProductGids: r1.productGids,
    });
    await syncShop(client(fake), s2);
    expect(fake.keysOf(P(1))).toEqual(["bundles"]);
    expect(fake.keysOf(P(2))).toEqual([]);
  });

  it("fails clearly when a rule touches too many products", async () => {
    const fake = new FakeShopify();
    fake.collections.set(
      C(1),
      Array.from({ length: 5001 }, (_, i) => P(i + 1)),
    );
    await expect(
      syncShop(client(fake), state({ volumeRules: [volume("v1", [C(1)], { targetType: "COLLECTION" })] })),
    ).rejects.toThrow(/5000/);
  });
});

describe("GqlClient retries", () => {
  const oneBundle = state({ bundles: [bundle("b1", [1])] });

  it("retries a 429 and succeeds, backing off", async () => {
    const fake = new FakeShopify();
    fake.failures = ["http429", "http429"];
    const sleep = vi.fn(async (_ms: number) => {});
    await syncShop(client(fake, { sleep }), oneBundle);
    expect(sleep).toHaveBeenCalledTimes(2);
    const [a, b] = sleep.mock.calls.map((c) => c[0] as number);
    expect(a).toBeGreaterThanOrEqual(1000); // Retry-After: 1 honoured
    expect(b).toBeGreaterThanOrEqual(a);
    expect(fake.keysOf(P(1))).toEqual(["bundles"]);
  });

  it("retries 5xx (response and thrown), network errors and THROTTLED", async () => {
    const fake = new FakeShopify();
    fake.failures = ["http503", "throw503", "network", "throttled"];
    const sleep = vi.fn(async (_ms: number) => {});
    await syncShop(client(fake, { sleep }), oneBundle);
    expect(sleep).toHaveBeenCalledTimes(4);
    expect(fake.keysOf(P(1))).toEqual(["bundles"]);
    expect(sleep.mock.calls[3][0]).toBeGreaterThanOrEqual(2000); // (300-100)/100 per sec from the cost hint
  });

  it("gives up after maxRetries on persistent 5xx with a retriable error", async () => {
    const fake = new FakeShopify();
    fake.failures = Array(10).fill("http503");
    const sleep = vi.fn(async (_ms: number) => {});
    const err = await syncShop(client(fake, { sleep, maxRetries: 2 }), oneBundle).catch((e) => e);
    expect(err).toBeInstanceOf(ShopifyApiError);
    expect(err.retriable).toBe(true);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(fake.store.size).toBe(0);
  });

  it("does not retry 401, and treats userErrors as non-retriable", async () => {
    const fake = new FakeShopify();
    fake.failures = ["http401"];
    const sleep = vi.fn(async (_ms: number) => {});
    const e1 = await syncShop(client(fake, { sleep }), oneBundle).catch((e) => e);
    expect(e1.retriable).toBe(false);
    expect(sleep).not.toHaveBeenCalled();

    fake.userError = "Owner not found";
    const e2 = await syncShop(client(fake, { sleep }), oneBundle).catch((e) => e);
    expect(e2.retriable).toBe(false);
    expect(e2.message).toMatch(/Owner not found/);
  });
});

function memoryRepo(initial = state()) {
  const row = { ...initial, status: "IDLE", error: null as string | null, history: [] as string[] };
  const repo: SyncRepo = {
    load: async () => ({ ...row, syncedProductGids: row.syncedProductGids }),
    markSyncing: async () => {
      row.history.push("SYNCING");
      row.status = "SYNCING";
    },
    markSynced: async (_id, gids) => {
      row.history.push("SYNCED");
      row.status = "SYNCED";
      row.error = null;
      row.syncedProductGids = gids;
    },
    markFailed: async (_id, m) => {
      row.history.push("FAILED");
      row.status = "FAILED";
      row.error = m;
    },
  };
  return { row, repo };
}

describe("runSync status handling", () => {
  it("sets FAILED with a merchant-safe message and schedules a retry, then recovers", async () => {
    const fake = new FakeShopify();
    const { row, repo } = memoryRepo(state({ bundles: [bundle("b1", [1])] }));
    const scheduler = { scheduleRetry: vi.fn(async (_s: string, _d: number) => {}) };
    const deps = { repo, admin: async () => fake, scheduler, gql: { sleep: async () => {}, maxRetries: 1 } };

    fake.failures = Array(10).fill("http503");
    const r1 = await runSync("dev.myshopify.com", deps);
    expect(r1).toMatchObject({ ok: false, retryScheduled: true });
    expect(row.status).toBe("FAILED");
    expect(row.error).toMatch(/Retry/);
    expect(row.error).not.toMatch(/503|token/i);
    expect(scheduler.scheduleRetry).toHaveBeenCalledWith("dev.myshopify.com", 60_000);

    fake.failures = [];
    const r2 = await runSync("dev.myshopify.com", deps);
    expect(r2.ok).toBe(true);
    expect(row.status).toBe("SYNCED");
    expect(row.error).toBeNull();
    expect(row.syncedProductGids).toEqual([P(1)]);
    expect(row.history).toEqual(["SYNCING", "FAILED", "SYNCING", "SYNCED"]);
  });

  it("does not schedule retries for non-retriable failures (invalid or oversized config)", async () => {
    const fake = new FakeShopify();
    const strings = Object.fromEntries(Array.from({ length: 700 }, (_, i) => [`k${i}`, "x".repeat(200)]));
    const { row, repo } = memoryRepo(state({ settings: { strings } }));
    const scheduler = { scheduleRetry: vi.fn(async (_s: string, _d: number) => {}) };
    const r = await runSync("dev.myshopify.com", { repo, admin: async () => fake, scheduler });
    expect(r).toMatchObject({ ok: false, retryScheduled: false });
    expect(row.error).toMatch(/limit is/);
    expect(scheduler.scheduleRetry).not.toHaveBeenCalled();
    expect(fake.store.size).toBe(0);
  });

  it("reports an unknown shop without throwing", async () => {
    const repo: SyncRepo = { ...memoryRepo().repo, load: async () => null };
    expect(await runSync("nope.myshopify.com", { repo, admin: async () => new FakeShopify() })).toMatchObject(
      { ok: false },
    );
  });
});

describe("reconcile", () => {
  const s = state({ bundles: [bundle("b1", [1, 2])], volumeRules: [volume("v1", [P(1)])] });

  it("is clean right after a sync, even if stored key order differs", async () => {
    const fake = new FakeShopify();
    const r = await syncShop(client(fake), s);
    const key = `${P(1)}|bundles`;
    fake.store.set(key, JSON.stringify(JSON.parse(fake.store.get(key)!), null, 2)); // whitespace only
    const rep = await reconcileShop(client(fake), { ...s, syncedProductGids: r.productGids });
    expect(rep).toMatchObject({ missing: 0, changed: 0, stale: 0, repaired: false });
  });

  it("repairs missing, changed and stale metafields, then is clean", async () => {
    const fake = new FakeShopify();
    const r = await syncShop(client(fake), s);
    const synced = { ...s, syncedProductGids: r.productGids };
    fake.store.delete(`${P(2)}|bundles`); // missing
    fake.store.set(`${P(1)}|volume`, '{"schemaVersion":1,"rules":[]}'); // changed
    fake.store.set(`${P(1)}|extra`, "x"); // unknown keys are left alone
    fake.store.set(`${P(2)}|volume`, '{"schemaVersion":1,"rules":[]}'); // stale: no rule applies to product 2

    const rep = await reconcileShop(client(fake), synced);
    expect(rep).toMatchObject({ missing: 1, changed: 1, stale: 1, repaired: true });
    expect(fake.store.has(`${P(2)}|bundles`)).toBe(true);
    expect(fake.store.has(`${P(2)}|volume`)).toBe(false);
    expect(JSON.parse(fake.store.get(`${P(1)}|volume`)!).rules).toHaveLength(1);

    const again = await reconcileShop(client(fake), synced);
    expect(again).toMatchObject({ missing: 0, changed: 0, stale: 0, repaired: false });
  });

  it("repair:false only reports", async () => {
    const fake = new FakeShopify();
    const r = await syncShop(client(fake), s);
    fake.store.delete(`${fake.shopGid}|config`);
    const rep = await reconcileShop(
      client(fake),
      { ...s, syncedProductGids: r.productGids },
      { repair: false },
    );
    expect(rep.missing).toBe(1);
    expect(fake.store.has(`${fake.shopGid}|config`)).toBe(false);
  });

  it("runReconcile updates sync bookkeeping", async () => {
    const fake = new FakeShopify();
    const { row, repo } = memoryRepo(s);
    await runReconcile("dev.myshopify.com", { repo, admin: async () => fake });
    expect(row.status).toBe("SYNCED");
    expect(row.syncedProductGids).toEqual([P(1), P(2)]);
  });
});
