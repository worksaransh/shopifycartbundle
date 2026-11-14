/**
 * Cart-surface adapters. Each knows how to find where our small root can be mounted in a theme's cart drawer or cart
 * page, and (optionally) how to ask the theme to refresh its own cart markup via the Section Rendering API.
 *
 * STATUS: selectors follow Dawn's documented markup (cart-drawer, cart-items) and the older drawer conventions used
 * by legacy free themes. They have NOT been run against real themes yet (no storefront access in the authoring
 * environment); the first dev-store run must verify each adapter. A merchant can always set a container selector in
 * Settings (generic adapter), and if nothing matches we do nothing and send cart_surface_missing.
 */
export interface Adapter {
  name: string;
  /** Element to insert our root BEFORE the first child of; null if this theme surface is not present. */
  find(doc: Document): HTMLElement | null;
  /** Section ids to re-fetch so the theme's own cart lines update after we add an item. */
  sections?: string[];
}

const first = (doc: Document, selectors: string[]) => {
  for (const s of selectors) {
    const el = doc.querySelector<HTMLElement>(s);
    if (el) return el;
  }
  return null;
};

export const dawnDrawer: Adapter = {
  name: "dawn-drawer",
  find: (doc) => first(doc, ["cart-drawer .drawer__inner", "cart-drawer"]),
  sections: ["cart-drawer", "cart-icon-bubble"],
};

export const dawnPage: Adapter = {
  name: "dawn-cart-page",
  find: (doc) => first(doc, ["cart-items", "#main-cart-items", ".cart__items"]),
  sections: ["main-cart-items", "cart-icon-bubble", "main-cart-footer"],
};

/** Older free themes that use #CartDrawer-style drawers or a classic <form action="/cart">. */
export const legacy: Adapter = {
  name: "legacy-drawer-or-form",
  find: (doc) =>
    first(doc, [
      "#CartDrawer",
      ".js-drawer-cart",
      ".ajax-cart__drawer",
      ".cart-drawer",
      'form[action="/cart"]',
    ]),
};

export function genericAdapter(selector: string | undefined): Adapter | null {
  if (!selector) return null;
  return {
    name: "generic-selector",
    find: (doc) => {
      try {
        return doc.querySelector<HTMLElement>(selector);
      } catch {
        return null; // invalid selector from Settings
      }
    },
  };
}

export function findSurface(
  doc: Document,
  cartSelector?: string,
): { adapter: Adapter; host: HTMLElement } | null {
  const list = [genericAdapter(cartSelector), dawnDrawer, dawnPage, legacy].filter((a): a is Adapter => !!a);
  for (const adapter of list) {
    const host = adapter.find(doc);
    if (host) return { adapter, host };
  }
  return null;
}

/** Re-fetch the given sections and swap their inner HTML, the same way Dawn updates its own cart. Never throws. */
export async function refreshSections(
  doc: Document,
  sections: string[] | undefined,
  f: typeof fetch = fetch,
): Promise<void> {
  if (!sections?.length) return;
  try {
    const res = await f(`/?sections=${sections.join(",")}`, { headers: { Accept: "application/json" } });
    if (!res.ok) return;
    const data = (await res.json()) as Record<string, string>;
    for (const id of sections) {
      const target = doc.getElementById(`shopify-section-${id}`);
      const html = data[id];
      if (!target || !html) continue;
      const next = new DOMParser().parseFromString(html, "text/html").querySelector(".shopify-section");
      if (next) target.innerHTML = next.innerHTML;
    }
  } catch {
    /* the theme keeps its old markup; our own bar and offers still update */
  }
}
