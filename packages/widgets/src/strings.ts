/**
 * All storefront copy lives here (i18n-ready): no English is hard-coded in components. Merchants override any
 * key in Settings (stored in the shop `config` metafield); other locales can ship as extra tables later.
 * Copy is short and concrete: "Save 15%", not "Amazing deal". No fake urgency or scarcity.
 */
export const DEFAULT_STRINGS = {
  "bundle.price": "Bundle price",
  "bundle.save": "Save {percent}%",
  "bundle.add": "Add bundle to cart",
  "bundle.added": "Bundle added to cart",
  "bundle.soldOut": "One item in this bundle is sold out",
  "bundle.error": "Could not add the bundle. Try again.",
  "price.atCheckout": "Price at checkout",
  "volume.heading": "Buy more, save more",
  "volume.row": "Buy {qty}+ and save {percent}%",
  "volume.selected": "{qty} selected",
  "upsell.heading": "Add to your order",
  "upsell.add": "Add",
  "upsell.added": "{title} added to your cart",
  "upsell.error": "Could not add {title}. Try again.",
  "upsell.save": "Save {percent}%",
  "shipping.progress": "Add {amount} more for free shipping",
  "shipping.success": "You've unlocked free shipping",
} as const;

export type StringKey = keyof typeof DEFAULT_STRINGS;
export const STRING_KEYS = Object.keys(DEFAULT_STRINGS) as StringKey[];

export type Strings = Record<StringKey, string>;

/** Merge merchant overrides over the defaults; unknown keys and non-strings are ignored. */
export function resolveStrings(overrides?: Record<string, unknown> | null): Strings {
  const out: Record<string, string> = { ...DEFAULT_STRINGS };
  for (const k of STRING_KEYS) {
    const v = overrides?.[k];
    if (typeof v === "string" && v.trim()) out[k] = v;
  }
  return out as Strings;
}

/** Replace {name} placeholders. Missing variables are left visible so a bad template is noticed, not hidden. */
export function t(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
