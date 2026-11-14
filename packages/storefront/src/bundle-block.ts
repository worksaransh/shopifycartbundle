import { computeBundleDiscount, type BundleRule, type PricingLine } from "@bundlekit/pricing";
import { formatMoney, resolveStrings, t, type Strings } from "@bundlekit/widgets";
import { addItems, announceCartChange, CartError } from "./cart-api";
import type { Beacon } from "./beacon";
import { liveRegion, parseJson, safely } from "./util";

/**
 * Bundle block behaviour. The HTML is server-rendered by Liquid (no JS needed for first paint); this adds:
 * variant selection, live price display, mix-and-match counting, add-to-cart and accessible status messages.
 *
 * Data contract (set by blocks/bundle.liquid):
 *   root[data-bk-bundle]  data-bundle-id data-type=FIXED|MIX_MATCH data-discount-type data-discount-value
 *                         data-currency data-locale data-need data-collection-id
 *   [data-bk-item]        data-product-id data-quantity      (FIXED)   contains [data-bk-variant]
 *   [data-bk-pick]        data-product-id                    (MIX)     contains input[data-bk-qty]
 *   [data-bk-variant]     <select> of <option value=variantId data-price=minor data-available=true|false>
 *                         or <input type=hidden value=variantId data-price data-available>
 *   [data-bk-original] [data-bk-now] [data-bk-save] [data-bk-note] [data-bk-add] [data-bk-count]
 *   script[data-bk-strings]  JSON overrides of storefront strings
 * Prices shown here are DISPLAY ONLY. The Function decides the real discount at checkout.
 */

interface Row {
  productId: string;
  variantId: string;
  quantity: number;
  unitPriceMinor: number;
  available: boolean;
}

/** After a successful add: tell the theme the cart changed, and ask it to open its drawer (themes that have none ignore it). */
function defaultNotify() {
  announceCartChange();
  document.dispatchEvent(new CustomEvent("cart:open"));
}

export interface BlockDeps {
  add?: typeof addItems;
  beacon?: Beacon;
  notify?: () => void;
}

function readVariant(host: Element): { variantId: string; price: number; available: boolean } | null {
  const v = host.querySelector<HTMLSelectElement | HTMLInputElement>("[data-bk-variant]");
  if (!v) return null;
  const opt = v instanceof HTMLSelectElement ? v.selectedOptions[0] : v;
  if (!opt) return null;
  const value = v.value;
  const price = Number((opt as HTMLElement).dataset.price);
  if (!value || !Number.isFinite(price)) return null;
  return { variantId: value, price, available: (opt as HTMLElement).dataset.available !== "false" };
}

function readRows(root: HTMLElement): Row[] {
  const rows: Row[] = [];
  if (root.dataset.type === "MIX_MATCH") {
    root.querySelectorAll<HTMLElement>("[data-bk-pick]").forEach((pick) => {
      const qty = Number(pick.querySelector<HTMLInputElement>("[data-bk-qty]")?.value) || 0;
      const v = readVariant(pick);
      if (qty > 0 && v)
        rows.push({
          productId: pick.dataset.productId ?? "",
          variantId: v.variantId,
          quantity: qty,
          unitPriceMinor: v.price,
          available: v.available,
        });
    });
  } else {
    root.querySelectorAll<HTMLElement>("[data-bk-item]").forEach((item) => {
      const v = readVariant(item);
      if (v)
        rows.push({
          productId: item.dataset.productId ?? "",
          variantId: v.variantId,
          quantity: Number(item.dataset.quantity) || 1,
          unitPriceMinor: v.price,
          available: v.available,
        });
    });
  }
  return rows;
}

export function initBundleBlock(root: HTMLElement, deps: BlockDeps = {}): void {
  safely(() => {
    const id = root.dataset.bundleId;
    const mix = root.dataset.type === "MIX_MATCH";
    const need = Number(root.dataset.need) || 0;
    const discountType = root.dataset.discountType as BundleRule["discountType"];
    const discountValue = Number(root.dataset.discountValue);
    const currency = root.dataset.currency ?? "USD";
    const locale = root.dataset.locale ?? "en";
    if (!id || !discountType || !Number.isFinite(discountValue)) return;

    const strings: Strings = resolveStrings(
      parseJson<Record<string, string>>(root.querySelector("script[data-bk-strings]")),
    );
    const say = liveRegion(root);
    const q = <T extends Element>(sel: string) => root.querySelector<T>(sel);
    const add = deps.add ?? addItems;
    const button = q<HTMLButtonElement>("[data-bk-add]");
    const note = q<HTMLElement>("[data-bk-note]");
    if (!button) return;

    const expectedFixed = root.querySelectorAll("[data-bk-item]").length;

    function recompute() {
      const rows = readRows(root);
      const soldOut = rows.some((r) => !r.available) || (!mix && rows.length < expectedFixed);
      const count = rows.reduce((n, r) => n + r.quantity, 0);
      const countEl = q<HTMLElement>("[data-bk-count]");
      if (countEl) countEl.textContent = `${count}/${need}`;

      const components: BundleRule["components"] = mix
        ? [{ collectionId: root.dataset.collectionId ?? "c", quantity: need }]
        : rows.map((r) => ({ productId: r.productId, quantity: r.quantity }));
      const lines: PricingLine[] = rows.map((r, i) => ({
        id: String(i),
        productId: r.productId,
        variantId: r.variantId,
        quantity: r.quantity,
        unitPriceMinor: r.unitPriceMinor,
        bundleId: id,
        collectionIds: mix ? [root.dataset.collectionId ?? "c"] : undefined,
      }));
      const original = lines.reduce((n, l) => n + l.quantity * l.unitPriceMinor, 0);
      const saved = computeBundleDiscount(
        { id: id as string, discountType, discountValue, components },
        lines,
      ).totalMinor;

      const set = (sel: string, text: string) => {
        const e = q<HTMLElement>(sel);
        if (e) e.textContent = text;
      };
      if (rows.length > 0) {
        set("[data-bk-original]", formatMoney(original, currency, locale));
        set("[data-bk-now]", formatMoney(original - saved, currency, locale));
        set(
          "[data-bk-save]",
          saved > 0 ? t(strings["bundle.save"], { percent: Math.round((saved * 100) / original) }) : "",
        );
      }
      const complete = mix ? count === need : !soldOut;
      button!.disabled = soldOut || !complete || saved <= 0;
      if (note) note.textContent = soldOut ? strings["bundle.soldOut"] : "";
      // No real saving means no card: never show a fake deal.
      if (!mix) root.hidden = saved <= 0 && !soldOut;
      return { rows, saved };
    }

    root.addEventListener("change", () => safely(recompute));
    root.addEventListener("input", () => safely(recompute));
    recompute();
    deps.beacon?.once("bundle_viewed", id);

    button.addEventListener("click", async () => {
      const { rows } = recompute();
      if (button.disabled || rows.length === 0) return;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      try {
        await add(
          rows.map((r) => ({ id: r.variantId, quantity: r.quantity, properties: { _bundle_id: id } })),
        );
        say(strings["bundle.added"]);
        deps.beacon?.track("bundle_added", id);
        (deps.notify ?? defaultNotify)();
      } catch (e) {
        say(e instanceof CartError && e.message && e.status === 422 ? e.message : strings["bundle.error"], {
          focus: true,
        });
      } finally {
        button.removeAttribute("aria-busy");
        recompute();
      }
    });
  });
}

export function initAllBundleBlocks(doc: Document, deps: BlockDeps = {}): void {
  doc.querySelectorAll<HTMLElement>("[data-bk-bundle]").forEach((el) => initBundleBlock(el, deps));
}
