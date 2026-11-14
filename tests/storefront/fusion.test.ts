// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findSurface, surfaceExists } from "../../packages/storefront/src/adapters";
import { addItems, CartError } from "../../packages/storefront/src/cart-api";
import { initBundleBlock } from "../../packages/storefront/src/bundle-block";
import {
  initCartEmbed,
  type EmbedController,
  type EmbedData,
} from "../../packages/storefront/src/cart-embed";
import { initVolumeTable } from "../../packages/storefront/src/volume-table";

/**
 * Markup copied in structure from the "Fusion" theme's own files (sections/cart-drawer.liquid, sections/main-cart.liquid,
 * assets/fusion-cart.js): <fusion-cart-drawer data-cart-drawer> .drawer__body > ul[data-cart-items], the cart page
 * root [data-cart-page] > .cart-page__main, and window.Fusion.cart / refreshCart.
 */
const drawer = (items = true) => `
<fusion-cart-drawer id="CartDrawer" data-drawer data-cart-drawer data-section-id="sections--1__cart-drawer">
  <div class="drawer__panel" data-drawer-panel>
    <div class="drawer__header"><span>Cart</span></div>
    ${items ? `<div class="drawer__body"><ul class="cart-drawer__items" data-cart-items><li>line</li></ul></div>` : `<div class="drawer__body cart-drawer__empty"><p>Empty</p></div>`}
  </div>
</fusion-cart-drawer>`;
const page = `
<div class="cart-page" data-cart-page data-section-id="main-cart"><div class="container">
  <form id="CartPageForm"><div class="cart-page__main"><ul class="cart-page__items" data-cart-items><li>line</li></ul></div></form>
</div></div>`;

const P = (n: number) => `gid://shopify/Product/${n}`;
const embedData = (): EmbedData => ({
  config: { shippingBar: { enabled: true, thresholdMinor: "100000", currency: "INR" }, locale: "en-IN" },
  rules: [
    {
      id: "u1",
      triggerProductIds: [P(1)],
      offerIds: [P(7)],
      maxOffers: 1,
      hideIfInCart: true,
      discountPercent: 0,
      layout: "STACKED",
    },
  ],
  offers: {
    [P(7)]: {
      id: P(7),
      title: "Kit",
      variants: [{ id: 701, title: "Default", price: 49900, available: true }],
    },
  },
});
const cart = (subtotal: number, ids = [1]) => ({
  items: ids.map((id) => ({ id: id * 10, product_id: id, quantity: 1 })),
  items_subtotal_price: subtotal,
  currency: "INR",
  item_count: ids.length,
});
const flush = () => new Promise((r) => setTimeout(r, 60));
let ctl: EmbedController | null = null;

afterEach(() => {
  ctl?.destroy();
  ctl = null;
  delete (globalThis as { Fusion?: unknown }).Fusion;
  document.body.innerHTML = "";
});

describe("Fusion adapters", () => {
  it("mounts in the drawer body (above the item list, not inside the <ul>) when the cart has items", () => {
    document.body.innerHTML = drawer();
    const s = findSurface(document)!;
    expect(s.adapter.name).toBe("fusion-drawer");
    expect(s.host.classList.contains("drawer__body")).toBe(true);
  });
  it("an empty-cart drawer has nothing to mount into, but is recognised as a real surface (no false alarm)", () => {
    document.body.innerHTML = drawer(false);
    expect(findSurface(document)).toBeNull();
    expect(surfaceExists(document)).toBe(true);
    document.body.innerHTML = "<main></main>";
    expect(surfaceExists(document)).toBe(false);
  });
  it("on the cart page the page adapter wins over the hidden drawer", () => {
    document.body.innerHTML = drawer() + page;
    expect(findSurface(document)!.adapter.name).toBe("fusion-cart-page");
    expect(findSurface(document)!.host.classList.contains("cart-page__main")).toBe(true);
  });
});

describe("Fusion cart embed", () => {
  beforeEach(() => {
    document.body.innerHTML = drawer();
  });

  it("shows the bar and offer inside the drawer body, and re-mounts after the theme swaps the drawer HTML", async () => {
    ctl = initCartEmbed(embedData(), { getCartImpl: async () => cart(66000), fetchImpl: vi.fn() as never });
    await flush();
    const body = document.querySelector(".drawer__body")!;
    expect(body.firstElementChild!.hasAttribute("data-bk-cart-root")).toBe(true);
    expect(body.querySelector("[data-bk-offer]")).not.toBeNull();
    expect(body.querySelector("ul[data-cart-items]")!.querySelector("[data-bk-cart-root]")).toBeNull();

    // the theme's refresh() replaces the drawer's innerHTML and then emits cart:updated
    document.querySelector("[data-cart-drawer]")!.innerHTML = document
      .querySelector("[data-cart-drawer]")!
      .innerHTML.replace("line", "line 2");
    document.dispatchEvent(new CustomEvent("cart:updated"));
    await flush();
    await flush();
    expect(document.querySelector(".drawer__body > [data-bk-cart-root]")).not.toBeNull();
  });

  it("asks the THEME to refresh its drawer after an add we made ourselves, and not when the theme did the add", async () => {
    const refreshCart = vi.fn().mockResolvedValue(undefined);
    (globalThis as { Fusion?: unknown }).Fusion = { refreshCart };
    const add = vi.fn().mockResolvedValue(false); // we posted to /cart/add.js ourselves
    ctl = initCartEmbed(embedData(), {
      getCartImpl: async () => cart(5000),
      addImpl: add,
      fetchImpl: vi.fn() as never,
    });
    await flush();
    document.querySelector<HTMLButtonElement>("[data-bk-oadd]")!.click();
    await flush();
    await flush();
    expect(refreshCart).toHaveBeenCalledTimes(1);

    refreshCart.mockClear();
    ctl!.destroy();
    document.body.innerHTML = drawer();
    add.mockResolvedValue(true); // the theme's own cart API did it (and already refreshed)
    ctl = initCartEmbed(embedData(), {
      getCartImpl: async () => cart(5000),
      addImpl: add,
      fetchImpl: vi.fn() as never,
    });
    await flush();
    document.querySelector<HTMLButtonElement>("[data-bk-oadd]")!.click();
    await flush();
    await flush();
    expect(refreshCart).not.toHaveBeenCalled();
  });
});

describe("addItems and the theme's cart API", () => {
  const items = [{ id: 1, quantity: 1, properties: { _bundle_id: "b1" } }];
  it("uses window.Fusion.cart.add when present (the theme then re-renders its own drawer) and reports it", async () => {
    const themeAdd = vi.fn().mockResolvedValue({});
    (globalThis as { Fusion?: unknown }).Fusion = { cart: { add: themeAdd } };
    expect(await addItems(items)).toBe(true);
    expect(themeAdd).toHaveBeenCalledWith(items);
  });
  it("keeps the theme's error message (e.g. out of stock) as a 422 CartError", async () => {
    (globalThis as { Fusion?: unknown }).Fusion = {
      cart: { add: vi.fn().mockRejectedValue(new Error("Only 2 left")) },
    };
    const err = await addItems(items).catch((e) => e);
    expect(err).toBeInstanceOf(CartError);
    expect(err).toMatchObject({ message: "Only 2 left", status: 422 });
  });
  it("posts to /cart/add.js itself on themes without a cart API, sending only ids, quantities and properties", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true });
    expect(await addItems(items, f as never)).toBe(false);
    expect(f.mock.calls[0][0]).toBe("/cart/add.js");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ items });
  });
});

describe("product page with the Fusion theme", () => {
  it("volume table reads the theme's [data-quantity-input] and ignores cart-line quantity inputs", () => {
    document.body.innerHTML = `
      <form action="/cart/add"><quantity-input><input data-quantity-input value="1"></quantity-input></form>
      <input data-quantity-input data-line="1" value="9">
      <div data-bk-volume>${[2, 3].map((m) => `<button type="button" data-bk-tier data-min="${m}" data-percent="${m * 5}"><span data-bk-selected></span></button>`).join("")}</div>`;
    initVolumeTable(document.querySelector<HTMLElement>("[data-bk-volume]")!);
    const qty = document.querySelector<HTMLInputElement>("form [data-quantity-input]")!;
    qty.value = "3"; // what the theme's QuantityInput.step() does, then fires change
    qty.dispatchEvent(new Event("change", { bubbles: true }));
    const rows = [...document.querySelectorAll("[data-bk-tier]")];
    expect(rows.map((r) => r.classList.contains("bk-active"))).toEqual([false, true]);
    // a cart-line input changing must not move the highlight
    const line = document.querySelector<HTMLInputElement>("[data-line]")!;
    line.value = "2";
    line.dispatchEvent(new Event("change", { bubbles: true }));
    expect(rows.map((r) => r.classList.contains("bk-active"))).toEqual([false, true]);
  });

  it("after adding a bundle it tells the theme the cart changed and asks it to open the drawer", async () => {
    document.body.innerHTML = `
    <div data-bk-bundle data-bundle-id="b1" data-type="FIXED" data-discount-type="PERCENT" data-discount-value="15" data-currency="INR" data-locale="en">
      <ul><li data-bk-item data-product-id="${P(1)}" data-quantity="1"><input type="hidden" data-bk-variant value="1" data-price="20000" data-available="true"></li>
          <li data-bk-item data-product-id="${P(2)}" data-quantity="1"><input type="hidden" data-bk-variant value="2" data-price="10000" data-available="true"></li></ul>
      <s data-bk-original></s><strong data-bk-now></strong><span data-bk-save></span><p data-bk-note></p><button data-bk-add>Add</button>
    </div>`;
    const events: string[] = [];
    for (const n of ["cart:updated", "cart:open"]) document.addEventListener(n, () => events.push(n));
    initBundleBlock(document.querySelector<HTMLElement>("[data-bk-bundle]")!, {
      add: vi.fn().mockResolvedValue(true),
    });
    document.querySelector<HTMLButtonElement>("[data-bk-add]")!.click();
    await flush();
    expect(events).toEqual(expect.arrayContaining(["cart:updated", "cart:open"]));
  });
});
