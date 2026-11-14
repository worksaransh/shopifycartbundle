import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  shop: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  volumeRule: { create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
}));
const sync = vi.hoisted(() => vi.fn());
vi.mock("../app/db.server", () => ({ default: db }));
vi.mock("../app/services/sync/repo.server", () => ({ syncShopMetafields: sync }));

import { volumeFieldErrors, volumeInputSchema } from "../app/services/volume/validation";
import {
  createVolumeRule,
  deleteVolumeRules,
  setStackVolumeWithBundles,
  setVolumeStatus,
} from "../app/services/volume/service.server";

const P = (n: number) => `gid://shopify/Product/${n}`;
const valid = {
  targetType: "PRODUCT",
  targetGids: [P(1)],
  tiers: [
    { minQty: 2, percentOff: 10 },
    { minQty: 3, percentOff: 15 },
  ],
};
const errs = (i: unknown) => {
  const r = volumeInputSchema.safeParse(i);
  return r.success ? {} : volumeFieldErrors(r.error);
};

beforeEach(() => {
  vi.clearAllMocks();
  db.shop.findUnique.mockResolvedValue({ id: "shop1", settings: { shippingBar: { enabled: true } } });
  db.volumeRule.create.mockResolvedValue({ id: "v1" });
  db.volumeRule.updateMany.mockResolvedValue({ count: 1 });
  db.volumeRule.deleteMany.mockResolvedValue({ count: 1 });
  sync.mockResolvedValue({ ok: true, set: 1, deleted: 0 });
});

describe("volume validation", () => {
  it("accepts 2 to 5 tiers with rising quantity", () => {
    expect(errs(valid)).toEqual({});
    expect(errs({ ...valid, tiers: [2, 3, 4, 5, 6].map((q) => ({ minQty: q, percentOff: q * 5 })) })).toEqual(
      {},
    );
  });
  it("rejects fewer than 2 or more than 5 tiers", () => {
    expect(errs({ ...valid, tiers: [valid.tiers[0]] }).tiers).toMatch(/at least 2/);
    expect(
      errs({ ...valid, tiers: [2, 3, 4, 5, 6, 7].map((q) => ({ minQty: q, percentOff: 10 + q })) }).tiers,
    ).toMatch(/at most 5/);
  });
  it("requires strictly increasing quantity and non-decreasing percent, percent 1-90", () => {
    expect(
      errs({
        ...valid,
        tiers: [
          { minQty: 3, percentOff: 10 },
          { minQty: 3, percentOff: 15 },
        ],
      }).tiers,
    ).toMatch(/must start above 3/);
    expect(
      errs({
        ...valid,
        tiers: [
          { minQty: 2, percentOff: 20 },
          { minQty: 3, percentOff: 15 },
        ],
      }).tiers,
    ).toMatch(/less than tier 1/);
    expect(
      errs({
        ...valid,
        tiers: [
          { minQty: 2, percentOff: 91 },
          { minQty: 3, percentOff: 92 },
        ],
      }).tiers,
    ).toMatch(/at most 90/);
    expect(
      errs({
        ...valid,
        tiers: [
          { minQty: 1, percentOff: 5 },
          { minQty: 3, percentOff: 15 },
        ],
      }).tiers,
    ).toMatch(/2 or more/);
  });
  it("checks targets and dates", () => {
    expect(errs({ ...valid, targetGids: [] }).targetGids).toMatch(/at least one/);
    expect(errs({ ...valid, targetGids: ["gid://shopify/Collection/1"] }).targetGids).toMatch(/products/);
    expect(
      errs({
        ...valid,
        targetType: "COLLECTION",
        targetGids: ["gid://shopify/Collection/1", "gid://shopify/Collection/2"],
      }).targetGids,
    ).toMatch(/one collection/);
    expect(errs({ ...valid, startsAt: "2026-12-10", endsAt: "2026-12-01" }).endsAt).toMatch(
      /before the start/,
    );
    expect(errs({ ...valid, startsAt: "12/10/2026" }).startsAt).toMatch(/2026-12-31/);
    expect(errs({ ...valid, startsAt: "2026-12-01", endsAt: "2026-12-01" })).toEqual({});
  });
});

describe("volume service", () => {
  it("stores dates as UTC midnight of the calendar day and syncs", async () => {
    const r = await createVolumeRule("dev.myshopify.com", {
      ...valid,
      startsAt: "2026-12-01",
      endsAt: "2026-12-31",
    });
    expect(r).toEqual({ ok: true, id: "v1", synced: true });
    const data = db.volumeRule.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ shopId: "shop1", status: "ACTIVE", targetGids: [P(1)] });
    expect(data.startsAt.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(data.endsAt.toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(sync).toHaveBeenCalledWith("dev.myshopify.com");
  });
  it("writes nothing for invalid input", async () => {
    expect((await createVolumeRule("dev.myshopify.com", { ...valid, tiers: [] })).ok).toBe(false);
    expect(db.volumeRule.create).not.toHaveBeenCalled();
  });
  it("status and delete are scoped by shopId", async () => {
    await setVolumeStatus("dev.myshopify.com", ["a"], "PAUSED");
    expect(db.volumeRule.updateMany).toHaveBeenCalledWith({
      where: { shopId: "shop1", id: { in: ["a"] } },
      data: { status: "PAUSED" },
    });
    await deleteVolumeRules("dev.myshopify.com", ["a"]);
    expect(db.volumeRule.deleteMany).toHaveBeenCalledWith({ where: { shopId: "shop1", id: { in: ["a"] } } });
  });
  it("stacking setting keeps other settings and re-syncs", async () => {
    await setStackVolumeWithBundles("dev.myshopify.com", true);
    expect(db.shop.update).toHaveBeenCalledWith({
      where: { id: "shop1" },
      data: { settings: { shippingBar: { enabled: true }, stackVolumeWithBundles: true } },
    });
    expect(sync).toHaveBeenCalled();
  });
});
