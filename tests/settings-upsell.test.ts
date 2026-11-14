import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  shop: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  upsellRule: { create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
}));
const sync = vi.hoisted(() => vi.fn());
vi.mock("../app/db.server", () => ({ default: db }));
vi.mock("../app/services/sync/repo.server", () => ({ syncShopMetafields: sync }));

import { contrastWarnings, settingsInputSchema } from "../app/services/settings/validation";
import { saveSettings, setKillSwitch } from "../app/services/settings/service.server";
import { upsellInputSchema } from "../app/services/upsell/validation";
import { createUpsellRule, deleteUpsellRules, setUpsellStatus } from "../app/services/upsell/service.server";
import { contrastRatio, meetsAA, resolveStrings, t, DEFAULT_STRINGS } from "@bundlekit/widgets";

const P = (n: number) => `gid://shopify/Product/${n}`;
const settings = {
  killSwitch: false,
  shippingBar: { enabled: true, thresholdMinor: "50000" },
  colours: { accent: "#1a6b4f", text: "#202223", background: "#ffffff" },
  strings: {},
};
const up = {
  triggerType: "PRODUCT",
  triggerGids: [P(1)],
  offerGids: [P(2)],
  offerHandles: ["offer-2"],
  maxOffers: 1,
  hideIfInCart: true,
  layout: "STACKED",
};

beforeEach(() => {
  vi.clearAllMocks();
  db.shop.findUnique.mockResolvedValue({
    id: "shop1",
    settings: { setup: { embedConfirmed: true }, stackVolumeWithBundles: true },
  });
  db.upsellRule.create.mockResolvedValue({ id: "u1" });
  db.upsellRule.updateMany.mockResolvedValue({ count: 1 });
  db.upsellRule.deleteMany.mockResolvedValue({ count: 1 });
  sync.mockResolvedValue({ ok: true, set: 1, deleted: 0 });
});

describe("storefront strings and contrast", () => {
  it("overrides defaults, ignores unknown keys and blanks", () => {
    const s = resolveStrings({ "bundle.add": "Buy the set", nope: "x", "bundle.price": "  " });
    expect(s["bundle.add"]).toBe("Buy the set");
    expect(s["bundle.price"]).toBe(DEFAULT_STRINGS["bundle.price"]);
    expect("nope" in s).toBe(false);
  });
  it("fills placeholders and leaves unknown ones visible", () => {
    expect(t("Add {amount} more", { amount: "₹340" })).toBe("Add ₹340 more");
    expect(t("Add {amount} more")).toBe("Add {amount} more");
  });
  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
    expect(meetsAA("#767676", "#ffffff")).toBe(true);
    expect(meetsAA("#808080", "#ffffff")).toBe(false);
  });
  it("warns about low-contrast colour choices", () => {
    expect(contrastWarnings(settings.colours)).toEqual([]);
    expect(contrastWarnings({ accent: "#ffcc00", text: "#aaaaaa", background: "#ffffff" })).toHaveLength(2);
  });
});

describe("settings", () => {
  it("accepts valid settings and rejects bad ones with actionable messages", () => {
    expect(settingsInputSchema.safeParse(settings).success).toBe(true);
    const bad = (s: object) => {
      const r = settingsInputSchema.safeParse({ ...settings, ...s });
      return r.success ? "" : r.error.issues[0].message;
    };
    expect(bad({ shippingBar: { enabled: true, thresholdMinor: "0" } })).toMatch(/more than 0/);
    expect(bad({ shippingBar: { enabled: true, thresholdMinor: "abc" } })).toMatch(/Enter an amount/);
    expect(bad({ colours: { ...settings.colours, accent: "red" } })).toMatch(/#1a6b4f/);
    expect(bad({ strings: { "shipping.progress": "Almost there" } })).toMatch(/\{amount\}/);
    expect(bad({ strings: { "made.up": "x" } })).toMatch(/Unknown message/);
    expect(bad({ cartSelector: "<script>" })).toMatch(/CSS selector/);
  });
  it("saves, keeps unrelated keys, drops blank messages, and syncs", async () => {
    const r = await saveSettings("dev.myshopify.com", {
      ...settings,
      strings: { "bundle.add": "Buy the set", "bundle.price": " " },
    });
    expect(r).toEqual({ ok: true, synced: true });
    const data = db.shop.update.mock.calls[0][0].data.settings;
    expect(data).toMatchObject({
      setup: { embedConfirmed: true },
      stackVolumeWithBundles: true,
      killSwitch: false,
      strings: { "bundle.add": "Buy the set" },
    });
    expect(data.strings["bundle.price"]).toBeUndefined();
    expect(sync).toHaveBeenCalled();
  });
  it("writes nothing when invalid", async () => {
    const r = await saveSettings("dev.myshopify.com", {
      ...settings,
      colours: { ...settings.colours, text: "nope" },
    });
    expect(r.ok).toBe(false);
    expect(db.shop.update).not.toHaveBeenCalled();
  });
  it("kill switch flips one flag and re-syncs", async () => {
    await setKillSwitch("dev.myshopify.com", true);
    expect(db.shop.update.mock.calls[0][0].data.settings).toMatchObject({
      killSwitch: true,
      stackVolumeWithBundles: true,
    });
    expect(sync).toHaveBeenCalled();
  });
});

describe("upsell rules", () => {
  const errs = (i: object) => {
    const r = upsellInputSchema.safeParse({ ...up, ...i });
    return r.success ? "" : r.error.issues[0].message;
  };
  it("validates triggers, offers, caps and self-offers", () => {
    expect(errs({})).toBe("");
    expect(errs({ offerGids: [P(2), P(3), P(4), P(5)], offerHandles: ["a", "b", "c", "d"] })).toMatch(
      /at most 3/,
    );
    expect(errs({ maxOffers: 2 })).toMatch(/Max offers/);
    expect(errs({ offerGids: [P(1)], offerHandles: ["x"] })).toMatch(/own page/);
    expect(errs({ discountPercent: 95 })).toMatch(/at most 90/);
    expect(errs({ triggerGids: [] })).toMatch(/at least one/);
  });
  it("creates an ACTIVE rule scoped to the shop; 0% discount is stored as none", async () => {
    const r = await createUpsellRule("dev.myshopify.com", { ...up, discountPercent: 0 });
    expect(r).toEqual({ ok: true, id: "u1", synced: true });
    expect(db.upsellRule.create.mock.calls[0][0].data).toMatchObject({
      shopId: "shop1",
      status: "ACTIVE",
      discountPercent: null,
      offerHandles: ["offer-2"],
    });
  });
  it("status and delete filter by shopId", async () => {
    await setUpsellStatus("dev.myshopify.com", ["a"], "PAUSED");
    expect(db.upsellRule.updateMany).toHaveBeenCalledWith({
      where: { shopId: "shop1", id: { in: ["a"] } },
      data: { status: "PAUSED" },
    });
    await deleteUpsellRules("dev.myshopify.com", ["a"]);
    expect(db.upsellRule.deleteMany).toHaveBeenCalledWith({ where: { shopId: "shop1", id: { in: ["a"] } } });
  });
});
