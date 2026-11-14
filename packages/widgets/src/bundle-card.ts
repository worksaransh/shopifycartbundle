import { computeBundleDiscount, type BundleRule } from "@bundlekit/pricing";

/**
 * ONE render function for the bundle card. The admin wizard preview and the storefront block both call it, so
 * merchants see exactly what shoppers see (UX rule 4). Pure string output: no DOM, no framework, tiny.
 * Prices here are DISPLAY ONLY; the Function computes the real discount at checkout.
 */

export interface BundleCardItem {
  title: string;
  imageUrl?: string;
  quantity: number;
  unitPriceMinor: number;
  productId: string;
}

export interface BundleCardLabels {
  bundlePrice: string;
  save: string; // "Save {percent}%"
  add: string; // "Add bundle to cart"
  priceAtCheckout: string; // shown when the estimate may differ at checkout
}

export interface BundleCardModel {
  id: string;
  title: string;
  badge?: string;
  items: BundleCardItem[];
  discountType: BundleRule["discountType"];
  discountValue: number;
  currency: string;
  locale: string;
  labels: BundleCardLabels;
  /** Show the "Price at checkout" note (tax or market pricing not exactly known). */
  estimate?: boolean;
  soldOut?: boolean;
}

export interface BundlePricing {
  originalMinor: number;
  bundleMinor: number;
  savedMinor: number;
  percentSaved: number;
}

export function priceBundle(
  m: Pick<BundleCardModel, "id" | "items" | "discountType" | "discountValue">,
): BundlePricing {
  const lines = m.items.map((it, i) => ({
    id: String(i),
    productId: it.productId,
    variantId: `v${i}`,
    quantity: it.quantity,
    unitPriceMinor: it.unitPriceMinor,
    bundleId: m.id,
  }));
  const rule: BundleRule = {
    id: m.id,
    discountType: m.discountType,
    discountValue: m.discountValue,
    components: m.items.map((it) => ({ productId: it.productId, quantity: it.quantity })),
  };
  const originalMinor = lines.reduce((n, l) => n + l.quantity * l.unitPriceMinor, 0);
  const savedMinor = computeBundleDiscount(rule, lines).totalMinor;
  return {
    originalMinor,
    savedMinor,
    bundleMinor: originalMinor - savedMinor,
    percentSaved: originalMinor > 0 ? Math.round((savedMinor * 100) / originalMinor) : 0,
  };
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c]);

/** Money via Intl with the cart currency (UX rule 7). Exponent comes from Intl, so JPY/KWD are right. */
export const formatMoney = (minor: number, currency: string, locale: string): string => {
  const digits =
    new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions().maximumFractionDigits ??
    2;
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 10 ** digits);
};

/** Returns "" (render nothing) when the card cannot be shown safely: no items, sold out, or no real saving. */
export function renderBundleCard(m: BundleCardModel): string {
  if (m.soldOut || m.items.length === 0) return "";
  const p = priceBundle(m);
  if (p.savedMinor <= 0) return "";
  const items = m.items
    .map(
      (it) =>
        `<li class="bk-item">${it.imageUrl ? `<img class="bk-img" src="${esc(it.imageUrl)}" alt="" width="64" height="64" loading="lazy">` : `<span class="bk-img" aria-hidden="true"></span>`}` +
        `<span class="bk-name">${it.quantity > 1 ? `${it.quantity} × ` : ""}${esc(it.title)}</span></li>`,
    )
    .join("");
  const save = m.labels.save.replace("{percent}", String(p.percentSaved));
  return (
    `<section class="bk-card" data-bundle-id="${esc(m.id)}" aria-label="${esc(m.title)}">` +
    `<h3 class="bk-title">${esc(m.title)}</h3>` +
    (m.badge ? `<span class="bk-badge">${esc(m.badge)}</span>` : "") +
    `<ul class="bk-items">${items}</ul>` +
    `<p class="bk-price"><span class="bk-label">${esc(m.labels.bundlePrice)}</span> ` +
    `<s class="bk-was">${esc(formatMoney(p.originalMinor, m.currency, m.locale))}</s> ` +
    `<strong class="bk-now">${esc(formatMoney(p.bundleMinor, m.currency, m.locale))}</strong> ` +
    `<span class="bk-save">${esc(save)}</span></p>` +
    (m.estimate ? `<p class="bk-note">${esc(m.labels.priceAtCheckout)}</p>` : "") +
    `<button type="button" class="bk-add" data-bk-add>${esc(m.labels.add)}</button>` +
    `</section>`
  );
}

/**
 * Card CSS. Colours come from CSS variables with safe fallbacks so any theme works; logical properties only
 * (RTL-safe); 44px touch target; visible focus ring.
 */
export const BUNDLE_CARD_CSS = `
.bk-card{--bk-accent:var(--color-button,#1a6b4f);--bk-text:var(--color-foreground,#202223);--bk-bg:var(--color-background,#fff);
  color:var(--bk-text);background:var(--bk-bg);border:1px solid color-mix(in srgb,var(--bk-text) 20%,transparent);
  border-radius:8px;padding-inline:16px;padding-block:16px;max-inline-size:100%;box-sizing:border-box;font:inherit}
.bk-title{margin-block:0 8px;font-size:1.1em}
.bk-badge{display:inline-block;padding-inline:8px;padding-block:2px;border-radius:4px;background:var(--bk-accent);color:#fff;font-size:.85em}
.bk-items{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.bk-item{display:flex;align-items:center;gap:12px}
.bk-img{inline-size:64px;block-size:64px;object-fit:cover;border-radius:4px;background:color-mix(in srgb,var(--bk-text) 8%,transparent);flex:none}
.bk-price{margin-block:12px 0}
.bk-was{opacity:.75}
.bk-now{font-size:1.2em}
.bk-save{font-weight:600}
.bk-note{margin-block:4px 0;font-size:.85em;opacity:.8}
.bk-add{margin-block-start:12px;min-block-size:44px;inline-size:100%;border:0;border-radius:6px;background:var(--bk-accent);color:#fff;font:inherit;cursor:pointer}
.bk-add:focus-visible{outline:3px solid var(--bk-text);outline-offset:2px}
.bk-add[disabled]{opacity:.6;cursor:not-allowed}
@media (prefers-reduced-motion:reduce){.bk-card *{transition:none!important;animation:none!important}}
`.trim();
