import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  shop: { findUnique: vi.fn() },
  bundle: { create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
}));
const sync = vi.hoisted(() => vi.fn());
vi.mock("../app/db.server", () => ({ default: db }));
vi.mock("../app/services/sync/repo.server", () => ({ syncShopMetafields: sync }));

import { bundleInputSchema, fieldErrors } from "../app/services/bundles/validation";
import { createBundle, deleteBundles, setBundlesStatus } from "../app/services/bundles/service.server";

const P = (n: number) => `gid://shopify/Product/${n}`;
const valid = {
  type: "FIXED",
  title: "Starter pair",
  discountType: "PERCENT",
  discountValue: 15,
  items: [
    { productGid: P(1), quantity: 1 },
    { productGid: P(2), quantity: 1 },
  ],
};
const errs = (input: unknown) => {
  const r = bundleInputSchema.safeParse(input);
  return r.success ? {} : fieldErrors(r.error);
};

beforeEach(() => {
  vi.clearAllMocks();
  db.shop.findUnique.mockResolvedValue({ id: "shop1" });
  db.bundle.create.mockResolvedValue({ id: "bundle1" });
  db.bundle.updateMany.mockResolvedValue({ count: 2 });
  db.bundle.deleteMany.mockResolvedValue({ count: 1 });
  sync.mockResolvedValue({ ok: true, set: 1, deleted: 0 });
});

describe("bundle validation", () => {
  it("accepts a valid 2-product fixed bundle", () => expect(errs(valid)).toEqual({}));
  it("says what to do when there are fewer than 2 products", () => {
    expect(errs({ ...valid, items: [valid.items[0]] }).items).toBe(
      "Bundle needs at least 2 products. Add another product.",
    );
  });
  it("rejects duplicate products, collections in a fixed bundle, and bad GIDs", () => {
    expect(errs({ ...valid, items: [valid.items[0], valid.items[0]] }).items).toMatch(/twice/);
    expect(
      errs({
        ...valid,
        items: [...valid.items, { collectionGid: "gid://shopify/Collection/5", quantity: 1 }],
      }).items,
    ).toMatch(/not collections/);
    expect(
      errs({ ...valid, items: [{ productGid: "nope", quantity: 1 }, valid.items[1]] }).items,
    ).toBeDefined();
  });
  it("validates discount ranges and title", () => {
    expect(errs({ ...valid, discountValue: 91 }).discountValue).toMatch(/at most 90/);
    expect(errs({ ...valid, discountValue: 0 }).discountValue).toMatch(/more than 0/);
    expect(errs({ ...valid, discountType: "AMOUNT", discountValue: 5000 })).toEqual({});
    expect(errs({ ...valid, title: "  " }).title).toMatch(/title/);
  });
  it("mix-and-match needs exactly one collection and quantity >= 2", () => {
    const mm = {
      ...valid,
      type: "MIX_MATCH",
      items: [{ collectionGid: "gid://shopify/Collection/5", quantity: 3 }],
    };
    expect(errs(mm)).toEqual({});
    expect(errs({ ...mm, items: [{ ...mm.items[0], quantity: 1 }] }).items).toMatch(/at least 2/);
    expect(errs({ ...mm, items: [] }).items).toMatch(/exactly one collection/);
  });
});

describe("bundle service", () => {
  it("creates an ACTIVE bundle scoped to the shop, then syncs", async () => {
    const r = await createBundle("dev.myshopify.com", valid);
    expect(r).toEqual({ ok: true, id: "bundle1", synced: true });
    expect(db.shop.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { domain: "dev.myshopify.com" } }),
    );
    expect(db.bundle.create.mock.calls[0][0].data).toMatchObject({
      shopId: "shop1",
      status: "ACTIVE",
      discountValue: "15",
    });
    expect(db.bundle.create.mock.calls[0][0].data.items).toEqual([
      { productGid: P(1), quantity: 1 },
      { productGid: P(2), quantity: 1 },
    ]);
    expect(sync).toHaveBeenCalledWith("dev.myshopify.com");
  });
  it("returns field errors and writes nothing when invalid", async () => {
    const r = await createBundle("dev.myshopify.com", { ...valid, items: [] });
    expect(r.ok).toBe(false);
    expect(db.bundle.create).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });
  it("keeps the bundle and surfaces the sync failure instead of losing input", async () => {
    sync.mockResolvedValue({ ok: false, message: "Shopify was busy", retryScheduled: true, retriable: true });
    const r = await createBundle("dev.myshopify.com", valid);
    expect(r).toMatchObject({ ok: true, synced: false, syncMessage: "Shopify was busy" });
  });
  it("pause, resume and delete always filter by shopId", async () => {
    await setBundlesStatus("dev.myshopify.com", ["a", "b"], "PAUSED");
    expect(db.bundle.updateMany).toHaveBeenCalledWith({
      where: { shopId: "shop1", id: { in: ["a", "b"] } },
      data: { status: "PAUSED" },
    });
    await setBundlesStatus("dev.myshopify.com", ["a"], "ACTIVE");
    expect(db.bundle.updateMany.mock.calls[1][0].data).toEqual({ status: "ACTIVE" });
    await deleteBundles("dev.myshopify.com", ["a"]);
    expect(db.bundle.deleteMany).toHaveBeenCalledWith({ where: { shopId: "shop1", id: { in: ["a"] } } });
    expect(sync).toHaveBeenCalledTimes(3);
  });
  it("throws a clear error for an unknown shop", async () => {
    db.shop.findUnique.mockResolvedValue(null);
    await expect(createBundle("x.myshopify.com", valid)).rejects.toThrow(/Reopen the app/);
  });
});

describe("non-retriable sync failures roll back to a safe state", () => {
  const tooLarge = {
    ok: false,
    message: "Active rules is 12000 bytes; the limit is 9500. Remove products or rules and save again.",
    retryScheduled: false,
    retriable: false,
  };
  const busy = { ok: false, message: "Shopify was busy", retryScheduled: true, retriable: true };

  it("a new bundle that does not fit is saved as a DRAFT and the store is re-synced to its previous state", async () => {
    sync.mockResolvedValueOnce(tooLarge).mockResolvedValue({ ok: true, set: 1, deleted: 0 });
    const r = await createBundle("dev.myshopify.com", valid);
    expect(r).toMatchObject({ ok: true, synced: false });
    expect((r as { syncMessage: string }).syncMessage).toMatch(/limit is 9500.*saved as a draft/);
    expect(db.bundle.updateMany).toHaveBeenCalledWith({
      where: { shopId: "shop1", id: "bundle1" },
      data: { status: "DRAFT" },
    });
    expect(sync).toHaveBeenCalledTimes(2); // the failed attempt, then the restore
  });
  it("a retriable failure (Shopify busy) is NOT rolled back: the bundle stays active and Retry will work", async () => {
    sync.mockResolvedValue(busy);
    const r = await createBundle("dev.myshopify.com", valid);
    expect(r).toMatchObject({ ok: true, synced: false, syncMessage: "Shopify was busy" });
    expect(db.bundle.updateMany).not.toHaveBeenCalled();
    expect(sync).toHaveBeenCalledTimes(1);
  });
  it("resuming bundles that do not fit restores their previous statuses", async () => {
    db.bundle.findMany.mockResolvedValue([
      { id: "a", status: "PAUSED" },
      { id: "b", status: "DRAFT" },
    ]);
    sync.mockResolvedValueOnce(tooLarge).mockResolvedValue({ ok: true, set: 1, deleted: 0 });
    const r = await setBundlesStatus("dev.myshopify.com", ["a", "b"], "ACTIVE");
    expect(r.synced).toBe(false);
    expect(db.bundle.updateMany).toHaveBeenCalledWith({
      where: { shopId: "shop1", id: "a" },
      data: { status: "PAUSED" },
    });
    expect(db.bundle.updateMany).toHaveBeenCalledWith({
      where: { shopId: "shop1", id: "b" },
      data: { status: "DRAFT" },
    });
  });
});
