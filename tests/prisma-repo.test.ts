import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  shop: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  bundle: { findMany: vi.fn().mockResolvedValue([]) },
  volumeRule: { findMany: vi.fn().mockResolvedValue([]) },
  upsellRule: { findMany: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../app/db.server", () => ({ default: db }));
vi.mock("../app/shopify.server", () => ({ unauthenticated: { admin: vi.fn() } }));

import { prismaSyncRepo } from "../app/services/sync/repo.server";

beforeEach(() => vi.clearAllMocks());

describe("prismaSyncRepo", () => {
  it("markSynced persists the discount node gid (otherwise every sync would create a new discount)", async () => {
    await prismaSyncRepo.markSynced(
      "shop1",
      ["gid://shopify/Product/1"],
      "gid://shopify/DiscountAutomaticNode/9",
    );
    expect(db.shop.update).toHaveBeenCalledWith({
      where: { id: "shop1" },
      data: expect.objectContaining({
        syncStatus: "SYNCED",
        syncedProductGids: ["gid://shopify/Product/1"],
        ruleDiscountGid: "gid://shopify/DiscountAutomaticNode/9",
      }),
    });
  });

  it("load scopes every query by the shop id and returns the node gid and upsells", async () => {
    db.shop.findUnique.mockResolvedValue({
      id: "shop1",
      domain: "a.myshopify.com",
      settings: {},
      syncedProductGids: [],
      ruleDiscountGid: "gid://shopify/DiscountAutomaticNode/9",
    });
    const s = await prismaSyncRepo.load("a.myshopify.com");
    expect(s?.ruleDiscountGid).toBe("gid://shopify/DiscountAutomaticNode/9");
    for (const t of [db.bundle, db.volumeRule, db.upsellRule])
      expect(t.findMany).toHaveBeenCalledWith({ where: { shopId: "shop1" } });
    db.shop.findUnique.mockResolvedValue(null);
    expect(await prismaSyncRepo.load("none.myshopify.com")).toBeNull();
  });
});
