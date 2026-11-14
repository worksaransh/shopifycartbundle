import {
  computeShippingProgress,
  percentOf,
  selectUpsellOffers,
  type UpsellRuleView,
} from "@bundlekit/pricing";
import { esc, formatMoney, resolveStrings, t, type Strings } from "@bundlekit/widgets";
import { findSurface, refreshSections, type Adapter } from "./adapters";
import type { Beacon } from "./beacon";
import { addItems, announceCartChange, getCart, type Cart } from "./cart-api";
import { gid, liveRegion, prefersReducedMotion, safely } from "./util";

/**
 * Cart embed: free-shipping bar + upsell offers in the cart drawer or page.
 *
 * Data (rendered by blocks/app-embed.liquid into script#bk-cart-config): shop config, upsell rules, and the offered
 * products' data (rendered by Liquid from handles, never fetched from our server). Prices from Liquid are in the
 * cart's presentment currency. If config is missing, the kill switch is on, or no surface is found: do nothing.
 */
export interface OfferVariant {
  id: number;
  title: string;
  price: number;
  available: boolean;
}
export interface OfferProduct {
  id: string;
  title: string;
  image?: string;
  variants: OfferVariant[];
}
export interface RuleView extends UpsellRuleView {
  discountPercent: number;
  layout: "CAROUSEL" | "STACKED";
}
export interface EmbedData {
  config: {
    killSwitch?: boolean;
    shippingBar?: { enabled?: boolean; thresholdMinor?: string; currency?: string };
    strings?: Record<string, string>;
    cartSelector?: string;
    locale?: string;
  };
  rules: RuleView[];
  offers: Record<string, OfferProduct>;
  /** Storefront locale (request.locale), preferred over config.locale. */
  locale?: string;
}

export interface EmbedDeps {
  beacon?: Beacon;
  fetchImpl?: typeof fetch;
  getCartImpl?: () => Promise<Cart>;
  addImpl?: typeof addItems;
  doc?: Document;
}

export interface EmbedController {
  refresh(): Promise<void>;
  destroy(): void;
}

const ROOT_ATTR = "data-bk-cart-root";

export function initCartEmbed(data: EmbedData | null, deps: EmbedDeps = {}): EmbedController | null {
  const doc = deps.doc ?? document;
  if (!data || data.config.killSwitch) return null;
  const strings: Strings = resolveStrings(data.config.strings);
  const locale = data.locale ?? data.config.locale ?? "en";
  const bar = data.config.shippingBar;
  const barOn = bar?.enabled === true && Number(bar.thresholdMinor) > 0;
  if (!barOn && data.rules.length === 0) return null;

  const surface = () => findSurface(doc, data.config.cartSelector);
  if (!surface()) {
    deps.beacon?.once("cart_surface_missing");
    // drawers can mount late; one more try shortly after load, then give up quietly
    setTimeout(() => safely(() => (surface() ? mount() : deps.beacon?.once("cart_surface_missing"))), 2500);
  }

  let root: HTMLElement | null = null;
  let adapter: Adapter | null = null;
  let say: ((m: string, o?: { focus?: boolean }) => void) | null = null;
  let lastHtml = "";
  let lastCart: Cart | null = null;
  let barDone = false;

  function mount(): boolean {
    const found = surface();
    if (!found) return false;
    adapter = found.adapter;
    if (root?.isConnected && found.host.contains(root)) return true;
    root = doc.createElement("div");
    root.setAttribute(ROOT_ATTR, "");
    root.className = "bk-cart";
    // reserve space up front so the bar never shifts the layout when it fills in
    if (barOn) root.style.minBlockSize = "3.25rem";
    found.host.insertBefore(root, found.host.firstChild);
    say = liveRegion(root);
    lastHtml = "";
    return true;
  }

  function barHtml(cart: Cart): string {
    if (!barOn || !bar) return "";
    if (bar.currency && cart.currency !== bar.currency) return ""; // threshold is in the shop currency only
    const p = computeShippingProgress(cart.items_subtotal_price, Number(bar.thresholdMinor));
    if (!p.enabled) return "";
    const text = p.complete
      ? strings["shipping.success"]
      : t(strings["shipping.progress"], { amount: formatMoney(p.remainingMinor, cart.currency, locale) });
    if (p.complete && !barDone) {
      barDone = true;
      deps.beacon?.once("shipping_bar_completed");
    }
    return (
      `<div class="bk-ship${p.complete ? " bk-done" : ""}">` +
      `<p class="bk-ship-text">${esc(text)}</p>` +
      `<div class="bk-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.percent}" aria-label="${esc(text)}"><span style="inline-size:${p.percent}%"></span></div>` +
      `</div>`
    );
  }

  function offersHtml(cart: Cart): string {
    if (data!.rules.length === 0) return "";
    const inCart = new Set(cart.items.map((i) => gid("Product", i.product_id)));
    const available = new Map(
      Object.entries(data!.offers).map(([id, p]) => [id, p.variants.some((v) => v.available)]),
    );
    const picked = selectUpsellOffers(data!.rules, inCart, available);
    if (picked.length === 0) return "";
    const cards = picked
      .map(({ ruleId, productId }) => {
        const p = data!.offers[productId];
        const rule = data!.rules.find((r) => r.id === ruleId);
        if (!p || !rule) return "";
        const vs = p.variants.filter((v) => v.available);
        const base = vs[0].price;
        const sale = rule.discountPercent > 0 ? base - percentOf(base, rule.discountPercent) : base;
        const options =
          vs.length > 1
            ? `<select class="bk-var" data-bk-var aria-label="${esc(p.title)}">${vs.map((v) => `<option value="${v.id}" data-price="${v.price}">${esc(v.title)}</option>`).join("")}</select>`
            : `<input type="hidden" data-bk-var value="${vs[0].id}" data-price="${vs[0].price}">`;
        deps.beacon?.once("upsell_viewed", ruleId);
        return (
          `<li class="bk-offer" data-bk-offer data-rule="${esc(ruleId)}" data-title="${esc(p.title)}" data-percent="${rule.discountPercent}">` +
          (p.image
            ? `<img class="bk-oimg" src="${esc(p.image)}" alt="" width="56" height="56" loading="lazy">`
            : "") +
          `<div class="bk-obody"><span class="bk-otitle">${esc(p.title)}</span>` +
          `<span class="bk-oprice">${rule.discountPercent > 0 ? `<s>${esc(formatMoney(base, cart.currency, locale))}</s> ` : ""}<strong>${esc(formatMoney(sale, cart.currency, locale))}</strong>${rule.discountPercent > 0 ? ` <span class="bk-osave">${esc(t(strings["upsell.save"], { percent: rule.discountPercent }))}</span>` : ""}</span>${options}</div>` +
          `<button type="button" class="bk-oadd" data-bk-oadd>${esc(strings["upsell.add"])}<span class="bk-sr"> ${esc(p.title)}</span></button></li>`
        );
      })
      .join("");
    const layout =
      picked.length && data!.rules.find((r) => r.id === picked[0].ruleId)?.layout === "CAROUSEL"
        ? "bk-carousel"
        : "bk-stacked";
    return `<div class="bk-offers"><p class="bk-oh">${esc(strings["upsell.heading"])}</p><ul class="bk-olist ${layout}">${cards}</ul></div>`;
  }

  function render(cart: Cart) {
    lastCart = cart;
    if (!mount() || !root) return;
    const html = barHtml(cart) + offersHtml(cart);
    if (html === lastHtml) return; // unchanged: avoid flicker and layout work
    lastHtml = html;
    const keep = root.querySelector("[data-bk-status]");
    root.innerHTML = html;
    if (keep) root.appendChild(keep);
    if (!prefersReducedMotion(doc.defaultView ?? window)) root.classList.add("bk-motion");
    else root.classList.remove("bk-motion");
    if (!html) root.style.minBlockSize = "";
  }

  async function refresh() {
    try {
      render(await (deps.getCartImpl ?? (() => getCart(deps.fetchImpl)))());
    } catch {
      /* leave whatever is shown; never affect the native cart */
    }
  }

  // one delegated listener for offer buttons
  const onClick = (ev: Event) => {
    const btn = (ev.target as Element | null)?.closest?.("[data-bk-oadd]") as HTMLButtonElement | null;
    const card = btn?.closest<HTMLElement>("[data-bk-offer]");
    if (!btn || !card || !root?.contains(card)) return;
    const variant = card.querySelector<HTMLSelectElement | HTMLInputElement>("[data-bk-var]");
    const title = card.dataset.title ?? "";
    if (!variant?.value) return;
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    (deps.addImpl ?? addItems)([
      { id: variant.value, quantity: 1, properties: { _upsell_id: card.dataset.rule ?? "" } },
    ])
      .then(async () => {
        say?.(t(strings["upsell.added"], { title }));
        deps.beacon?.track("upsell_added", card.dataset.rule);
        announceCartChange(doc);
        await refreshSections(doc, adapter?.sections, deps.fetchImpl);
        await refresh();
      })
      .catch(() => {
        say?.(t(strings["upsell.error"], { title }), { focus: true });
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
      });
  };
  doc.addEventListener("click", onClick);

  // refresh when the theme or our other widgets change the cart
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => safely(() => void refresh()), 120);
  };
  const CART_EVENTS = ["cart:refresh", "cart:updated", "bundlekit:cart-updated"];
  for (const name of CART_EVENTS) doc.addEventListener(name, soon);

  // detect cart changes made by the theme itself (/cart/add, /change, /update, /clear) without touching responses
  const win = doc.defaultView;
  const original = win?.fetch;
  if (win && original && !deps.fetchImpl) {
    win.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
      const result = original.apply(win, args);
      safely(() => {
        const u =
          typeof args[0] === "string"
            ? args[0]
            : args[0] instanceof URL
              ? args[0].href
              : (args[0] as Request).url;
        if (/\/cart\/(add|change|update|clear)(\.js)?(\?|$)/.test(u)) void result.then(soon, () => {});
      });
      return result;
    } as typeof fetch;
  }

  // re-mount if the theme re-renders the drawer and drops our root
  const observer = new (doc.defaultView?.MutationObserver ?? MutationObserver)(() => {
    if (root && !root.isConnected) soon();
  });
  observer.observe(doc.body, { childList: true, subtree: true });

  void refresh();

  return {
    refresh,
    destroy() {
      observer.disconnect();
      clearTimeout(timer);
      doc.removeEventListener("click", onClick);
      for (const name of CART_EVENTS) doc.removeEventListener(name, soon);
      if (win && original) win.fetch = original;
      root?.remove();
    },
  };
}
