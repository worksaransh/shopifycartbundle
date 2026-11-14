import { describe, expect, it } from "vitest";
import { BUNDLE_CARD_CSS, esc, priceBundle, renderBundleCard, type BundleCardModel } from "../src";

const model = (over: Partial<BundleCardModel> = {}): BundleCardModel => ({
  id: "b1",
  title: "Starter pair",
  badge: "Best value",
  items: [
    { title: "Mug", quantity: 1, unitPriceMinor: 20000, productId: "A" },
    { title: "Plate", quantity: 1, unitPriceMinor: 10000, productId: "B" },
  ],
  discountType: "PERCENT",
  discountValue: 15,
  currency: "INR",
  locale: "en-IN",
  labels: {
    bundlePrice: "Bundle price",
    save: "Save {percent}%",
    add: "Add bundle to cart",
    priceAtCheckout: "Price at checkout",
  },
  ...over,
});

describe("bundle card", () => {
  it("prices from the shared pricing package", () => {
    expect(priceBundle(model())).toEqual({
      originalMinor: 30000,
      savedMinor: 4500,
      bundleMinor: 25500,
      percentSaved: 15,
    });
  });
  it("renders title, strikethrough original, bundle price and saving badge", () => {
    const html = renderBundleCard(model());
    expect(html).toContain("Starter pair");
    expect(html).toContain('<s class="bk-was">');
    expect(html).toContain("Save 15%");
    expect(html).toContain("Best value");
    expect(html).toMatch(/bk-now">[^<]*255/);
  });
  it("escapes merchant-supplied text", () => {
    const html = renderBundleCard(model({ title: '<img src=x onerror="alert(1)">', badge: "<b>x</b>" }));
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>x</b>");
    expect(esc(`a&b<"'`)).toBe("a&amp;b&lt;&quot;&#39;");
  });
  it("renders nothing when sold out, empty, or there is no real saving (never a fake deal)", () => {
    expect(renderBundleCard(model({ soldOut: true }))).toBe("");
    expect(renderBundleCard(model({ items: [] }))).toBe("");
    expect(renderBundleCard(model({ discountType: "FIXED_PRICE", discountValue: 999999 }))).toBe("");
  });
  it("shows the estimate note only when asked", () => {
    expect(renderBundleCard(model())).not.toContain("Price at checkout");
    expect(renderBundleCard(model({ estimate: true }))).toContain("Price at checkout");
  });
  it("CSS is RTL-safe, has a 44px target, focus ring and reduced-motion support", () => {
    expect(BUNDLE_CARD_CSS).not.toMatch(
      /\b(margin|padding)-(left|right)\b|\b(left|right):|text-align:\s*(left|right)/,
    );
    expect(BUNDLE_CARD_CSS).toContain("min-block-size:44px");
    expect(BUNDLE_CARD_CSS).toContain(":focus-visible");
    expect(BUNDLE_CARD_CSS).toContain("prefers-reduced-motion");
  });
});
