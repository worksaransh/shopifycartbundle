// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { initBundleBlock } from "../../packages/storefront/src/bundle-block";
import { CartError } from "../../packages/storefront/src/cart-api";

const fixed = (opts: { avail2?: boolean; type?: string; value?: string } = {}) => `
<div data-bk-bundle data-bundle-id="b1" data-type="FIXED" data-discount-type="${opts.type ?? "PERCENT"}" data-discount-value="${opts.value ?? "15"}" data-currency="INR" data-locale="en-IN">
  <ul>
    <li data-bk-item data-product-id="gid://shopify/Product/1" data-quantity="1"><input type="hidden" data-bk-variant value="101" data-price="20000" data-available="true"></li>
    <li data-bk-item data-product-id="gid://shopify/Product/2" data-quantity="1">
      <select data-bk-variant>
        <option value="201" data-price="10000" data-available="${opts.avail2 === false ? "false" : "true"}" selected>S</option>
        <option value="202" data-price="14000" data-available="true">L</option>
      </select>
    </li>
  </ul>
  <s data-bk-original></s><strong data-bk-now></strong><span data-bk-save></span>
  <p data-bk-note></p><button data-bk-add>Add</button><span data-bk-count></span>
</div>`;

const mount = (html: string) => {
  document.body.innerHTML = html;
  return document.querySelector<HTMLElement>("[data-bk-bundle]")!;
};
const tick = () => new Promise((r) => setTimeout(r, 40));

beforeEach(() => (document.body.innerHTML = ""));

describe("bundle block (fixed)", () => {
  it("shows original and bundle price from the variant prices, and the saving", () => {
    const root = mount(fixed());
    initBundleBlock(root);
    expect(root.querySelector("[data-bk-original]")!.textContent).toMatch(/300/);
    expect(root.querySelector("[data-bk-now]")!.textContent).toMatch(/255/);
    expect(root.querySelector("[data-bk-save]")!.textContent).toBe("Save 15%");
    expect((root.querySelector("[data-bk-add]") as HTMLButtonElement).disabled).toBe(false);
  });
  it("recomputes when a variant changes", () => {
    const root = mount(fixed());
    initBundleBlock(root);
    const sel = root.querySelector("select")!;
    sel.value = "202";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(root.querySelector("[data-bk-now]")!.textContent).toMatch(/289/); // (20000+14000)*0.85
  });
  it("adds every line with the shared _bundle_id property, announces, tracks, and tells the theme", async () => {
    const root = mount(fixed());
    const add = vi.fn().mockResolvedValue(undefined);
    const beacon = { track: vi.fn(), once: vi.fn(), flush: vi.fn() };
    const notify = vi.fn();
    initBundleBlock(root, { add, beacon, notify });
    root.querySelector<HTMLButtonElement>("[data-bk-add]")!.click();
    await tick();
    expect(add).toHaveBeenCalledWith([
      { id: "101", quantity: 1, properties: { _bundle_id: "b1" } },
      { id: "201", quantity: 1, properties: { _bundle_id: "b1" } },
    ]);
    const status = root.querySelector("[data-bk-status]")!;
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("Bundle added to cart");
    expect(beacon.once).toHaveBeenCalledWith("bundle_viewed", "b1");
    expect(beacon.track).toHaveBeenCalledWith("bundle_added", "b1");
    expect(notify).toHaveBeenCalled();
    expect((root.querySelector("[data-bk-add]") as HTMLButtonElement).disabled).toBe(false);
  });
  it("shows the server's message on a 422 (e.g. not enough stock) and moves focus to the status", async () => {
    const root = mount(fixed());
    document.body.appendChild(root);
    initBundleBlock(root, {
      add: vi.fn().mockRejectedValue(new CartError("All 1 Mug are in your cart.", 422)),
    });
    root.querySelector<HTMLButtonElement>("[data-bk-add]")!.click();
    await tick();
    const status = root.querySelector<HTMLElement>("[data-bk-status]")!;
    expect(status.textContent).toBe("All 1 Mug are in your cart.");
    expect(document.activeElement).toBe(status);
  });
  it("shows a generic retry message for other failures and keeps the button usable", async () => {
    const root = mount(fixed());
    initBundleBlock(root, { add: vi.fn().mockRejectedValue(new Error("network")) });
    root.querySelector<HTMLButtonElement>("[data-bk-add]")!.click();
    await tick();
    expect(root.querySelector("[data-bk-status]")!.textContent).toBe("Could not add the bundle. Try again.");
    expect((root.querySelector("[data-bk-add]") as HTMLButtonElement).disabled).toBe(false);
  });
  it("disables the button with a clear message when a component is sold out", () => {
    const root = mount(fixed({ avail2: false }));
    initBundleBlock(root);
    expect((root.querySelector("[data-bk-add]") as HTMLButtonElement).disabled).toBe(true);
    expect(root.querySelector("[data-bk-note]")!.textContent).toBe("One item in this bundle is sold out");
  });
  it("hides the card when there is no real saving (never a fake deal)", () => {
    const root = mount(fixed({ type: "FIXED_PRICE", value: "999999" }));
    initBundleBlock(root);
    expect(root.hidden).toBe(true);
  });
  it("uses merchant string overrides", async () => {
    const root = mount(
      fixed().replace(
        "</div>",
        `<script type="application/json" data-bk-strings>{"bundle.added":"Set added!"}</script></div>`,
      ),
    );
    initBundleBlock(root, { add: vi.fn().mockResolvedValue(undefined) });
    root.querySelector<HTMLButtonElement>("[data-bk-add]")!.click();
    await tick();
    expect(root.querySelector("[data-bk-status]")!.textContent).toBe("Set added!");
  });
  it("does nothing, and does not throw, when the markup is incomplete", () => {
    const root = mount(`<div data-bk-bundle></div>`);
    expect(() => initBundleBlock(root)).not.toThrow();
  });
});

describe("bundle block (mix and match)", () => {
  const mix = `
  <div data-bk-bundle data-bundle-id="m1" data-type="MIX_MATCH" data-discount-type="PERCENT" data-discount-value="20" data-currency="INR" data-locale="en" data-need="3" data-collection-id="gid://shopify/Collection/9">
    ${[1, 2, 3, 4]
      .map(
        (n) =>
          `<li data-bk-pick data-product-id="gid://shopify/Product/${n}"><input type="hidden" data-bk-variant value="${n}01" data-price="10000" data-available="true"><input type="number" data-bk-qty value="0"></li>`,
      )
      .join("")}
    <s data-bk-original></s><strong data-bk-now></strong><span data-bk-save></span><p data-bk-note></p><button data-bk-add disabled>Add</button><span data-bk-count></span>
  </div>`;
  const set = (root: HTMLElement, n: number, v: number) => {
    const input = root.querySelectorAll<HTMLInputElement>("[data-bk-qty]")[n];
    input.value = String(v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  it("enables Add only when exactly N items are picked, then adds them with the bundle id", async () => {
    const root = mount(mix);
    const add = vi.fn().mockResolvedValue(undefined);
    initBundleBlock(root, { add });
    const btn = root.querySelector<HTMLButtonElement>("[data-bk-add]")!;
    set(root, 0, 1);
    set(root, 1, 1);
    expect(btn.disabled).toBe(true);
    expect(root.querySelector("[data-bk-count]")!.textContent).toBe("2/3");
    set(root, 3, 1);
    expect(btn.disabled).toBe(false);
    expect(root.querySelector("[data-bk-save]")!.textContent).toBe("Save 20%");
    btn.click();
    await tick();
    expect(add).toHaveBeenCalledWith([
      { id: "101", quantity: 1, properties: { _bundle_id: "m1" } },
      { id: "201", quantity: 1, properties: { _bundle_id: "m1" } },
      { id: "401", quantity: 1, properties: { _bundle_id: "m1" } },
    ]);
    set(root, 0, 3);
    set(root, 1, 0);
    set(root, 3, 0);
    expect(btn.disabled).toBe(false); // 3 of one product is a valid pick
    set(root, 0, 4);
    expect(btn.disabled).toBe(true); // too many
  });
});
