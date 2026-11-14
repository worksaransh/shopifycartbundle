// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findSurface, genericAdapter } from "../../packages/storefront/src/adapters";
import type { Cart } from "../../packages/storefront/src/cart-api";
import {
  initCartEmbed,
  type EmbedController,
  type EmbedData,
} from "../../packages/storefront/src/cart-embed";

const P = (n: number) => `gid://shopify/Product/${n}`;
const cart = (subtotal: number, productIds: number[] = [1], currency = "INR"): Cart => ({
  items: productIds.map((id) => ({ id: id * 10, product_id: id, quantity: 1 })),
  items_subtotal_price: subtotal,
  currency,
  item_count: productIds.length,
});
const data = (over: Partial<EmbedData> = {}, bar: object = {}): EmbedData => ({
  config: {
    shippingBar: { enabled: true, thresholdMinor: "100000", currency: "INR", ...bar },
    locale: "en-IN",
  },
  rules: [
    {
      id: "u1",
      triggerProductIds: [P(1)],
      offerIds: [P(7)],
      maxOffers: 1,
      hideIfInCart: true,
      discountPercent: 10,
      layout: "STACKED",
    },
  ],
  offers: {
    [P(7)]: {
      id: P(7),
      title: "Cleaning kit",
      variants: [{ id: 701, title: "Default", price: 49900, available: true }],
    },
  },
  ...over,
});
const beacon = () => ({ track: vi.fn(), once: vi.fn(), flush: vi.fn() });
const flush = () => new Promise((r) => setTimeout(r, 60));
let ctl: EmbedController | null = null;

const dawnDrawer = `<cart-drawer><div class="drawer__inner"><p id="native">native cart</p></div></cart-drawer>`;
beforeEach(() => (document.body.innerHTML = dawnDrawer));
afterEach(() => {
  ctl?.destroy();
  ctl = null;
});
const root = () => document.querySelector<HTMLElement>("[data-bk-cart-root]");

describe("shipping bar", () => {
  it("mounts inside the Dawn drawer without touching the native cart, with progress text and ARIA", async () => {
    ctl = initCartEmbed(data({ rules: [] }), {
      getCartImpl: async () => cart(66000),
      fetchImpl: vi.fn() as never,
    });
    await flush();
    expect(document.getElementById("native")!.textContent).toBe("native cart");
    expect(root()!.parentElement!.classList.contains("drawer__inner")).toBe(true);
    expect(root()!.textContent).toMatch(/340/); // 1000 - 660 left
    expect(root()!.textContent).toMatch(/more for free shipping/);
    const bar = root()!.querySelector("[role=progressbar]")!;
    expect(bar.getAttribute("aria-valuenow")).toBe("66");
    expect(bar.getAttribute("aria-label")).toBeTruthy();
  });
  it("reaches 100% with the success message and reports completion once", async () => {
    const b = beacon();
    ctl = initCartEmbed(data({ rules: [] }), {
      getCartImpl: async () => cart(100000),
      beacon: b,
      fetchImpl: vi.fn() as never,
    });
    await flush();
    expect(root()!.textContent).toContain("You've unlocked free shipping");
    expect(root()!.querySelector("[role=progressbar]")!.getAttribute("aria-valuenow")).toBe("100");
    await ctl!.refresh();
    expect(b.once).toHaveBeenCalledWith("shipping_bar_completed");
  });
  it("shows nothing for a cart in another currency (threshold is in the shop currency)", async () => {
    ctl = initCartEmbed(data({ rules: [] }), {
      getCartImpl: async () => cart(5000, [1], "USD"),
      fetchImpl: vi.fn() as never,
    });
    await flush();
    expect(root()!.querySelector(".bk-ship")).toBeNull();
  });
  it("uses merchant message templates with {amount}", async () => {
    const d = data({ rules: [] });
    d.config.strings = { "shipping.progress": "Only {amount} to go!" };
    ctl = initCartEmbed(d, { getCartImpl: async () => cart(90000), fetchImpl: vi.fn() as never });
    await flush();
    expect(root()!.textContent).toMatch(/Only .*100.* to go!/);
  });
});

describe("upsell offers", () => {
  it("shows a triggered offer with its discount and never pre-selects it", async () => {
    const b = beacon();
    ctl = initCartEmbed(data(), {
      getCartImpl: async () => cart(5000),
      beacon: b,
      fetchImpl: vi.fn() as never,
    });
    await flush();
    const card = root()!.querySelector<HTMLElement>("[data-bk-offer]")!;
    expect(card.textContent).toContain("Cleaning kit");
    expect(card.textContent).toMatch(/Save 10%/);
    expect(card.querySelector("s")!.textContent).toMatch(/499/);
    expect(card.querySelector("strong")!.textContent).toMatch(/449/); // 499 - 10%
    expect(b.once).toHaveBeenCalledWith("upsell_viewed", "u1");
  });
  it("hides it when the trigger is absent or the offer is already in the cart", async () => {
    ctl = initCartEmbed(data(), { getCartImpl: async () => cart(5000, [2]), fetchImpl: vi.fn() as never });
    await flush();
    expect(root()!.querySelector("[data-bk-offer]")).toBeNull();
    await ctl!.refresh();
    ctl!.destroy();
    ctl = initCartEmbed(data(), { getCartImpl: async () => cart(5000, [1, 7]), fetchImpl: vi.fn() as never });
    await flush();
    expect(root()!.querySelector("[data-bk-offer]")).toBeNull();
  });
  it("adds with the _upsell_id property, announces politely, and refreshes", async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const b = beacon();
    const getCartImpl = vi
      .fn()
      .mockResolvedValueOnce(cart(5000))
      .mockResolvedValue(cart(54900, [1, 7]));
    ctl = initCartEmbed(data(), {
      getCartImpl,
      addImpl: add,
      beacon: b,
      fetchImpl: vi.fn().mockResolvedValue({ ok: false }) as never,
    });
    await flush();
    root()!.querySelector<HTMLButtonElement>("[data-bk-oadd]")!.click();
    await flush();
    await flush();
    expect(add).toHaveBeenCalledWith([{ id: "701", quantity: 1, properties: { _upsell_id: "u1" } }]);
    expect(root()!.querySelector("[data-bk-status]")!.textContent).toBe("Cleaning kit added to your cart");
    expect(root()!.querySelector("[data-bk-status]")!.getAttribute("aria-live")).toBe("polite");
    expect(b.track).toHaveBeenCalledWith("upsell_added", "u1");
    expect(root()!.querySelector("[data-bk-offer]")).toBeNull(); // now in the cart, so hidden
  });
  it("announces an error and re-enables the button when add fails", async () => {
    const add = vi.fn().mockRejectedValue(new Error("x"));
    ctl = initCartEmbed(data(), {
      getCartImpl: async () => cart(5000),
      addImpl: add,
      fetchImpl: vi.fn() as never,
    });
    await flush();
    const btn = root()!.querySelector<HTMLButtonElement>("[data-bk-oadd]")!;
    btn.click();
    await flush();
    expect(root()!.querySelector("[data-bk-status]")!.textContent).toBe(
      "Could not add Cleaning kit. Try again.",
    );
    expect(btn.disabled).toBe(false);
  });
});

describe("safety", () => {
  it("renders nothing when the kill switch is on, config is missing, or nothing is configured", () => {
    expect(initCartEmbed(null)).toBeNull();
    expect(initCartEmbed({ ...data(), config: { killSwitch: true } })).toBeNull();
    expect(initCartEmbed({ ...data({ rules: [] }), config: { shippingBar: { enabled: false } } })).toBeNull();
    expect(root()).toBeNull();
  });
  it("reports cart_surface_missing once and does nothing when no adapter matches", async () => {
    document.body.innerHTML = "<main>no cart here</main>";
    const b = beacon();
    ctl = initCartEmbed(data(), { getCartImpl: async () => cart(5000), beacon: b });
    await flush();
    expect(b.once).toHaveBeenCalledWith("cart_surface_missing");
    expect(root()).toBeNull();
    expect(document.body.innerHTML).toBe("<main>no cart here</main>");
  });
  it("leaves the page alone if the cart request fails", async () => {
    ctl = initCartEmbed(data(), {
      getCartImpl: async () => Promise.reject(new Error("offline")),
      fetchImpl: vi.fn() as never,
    });
    await flush();
    expect(document.getElementById("native")!.textContent).toBe("native cart");
  });
  it("re-mounts if the theme re-renders the drawer and drops our root", async () => {
    ctl = initCartEmbed(data({ rules: [] }), {
      getCartImpl: async () => cart(66000),
      fetchImpl: vi.fn() as never,
    });
    await flush();
    root()!.remove();
    await flush();
    await flush();
    expect(root()).not.toBeNull();
  });
});

describe("adapters", () => {
  it("finds Dawn's drawer, Dawn's cart page, legacy markup, and the merchant selector first", () => {
    expect(findSurface(document)!.adapter.name).toBe("dawn-drawer");
    document.body.innerHTML = `<cart-items></cart-items>`;
    expect(findSurface(document)!.adapter.name).toBe("dawn-cart-page");
    document.body.innerHTML = `<div id="CartDrawer"></div>`;
    expect(findSurface(document)!.adapter.name).toBe("legacy-drawer-or-form");
    document.body.innerHTML = `<div id="mine"></div><cart-items></cart-items>`;
    expect(findSurface(document, "#mine")!.adapter.name).toBe("generic-selector");
    expect(findSurface(document, "###bad[")!.adapter.name).toBe("dawn-cart-page"); // invalid selector falls through
    expect(genericAdapter(undefined)).toBeNull();
  });
});
