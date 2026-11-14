/**
 * Cart AJAX API (https://shopify.dev/docs/api/ajax/reference/cart). The browser only ADDS lines and READS the
 * cart; prices are never sent, and discounts are computed at checkout by the Function.
 */
export interface CartLine {
  id: number;
  product_id: number;
  quantity: number;
  properties?: Record<string, string> | null;
}
export interface Cart {
  items: CartLine[];
  items_subtotal_price: number;
  currency: string;
  item_count: number;
}
export interface AddItem {
  id: number | string;
  quantity: number;
  properties?: Record<string, string>;
}

export class CartError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

/** A theme's own cart API (e.g. the Fusion theme's `window.Fusion.cart`). Using it keeps the theme's drawer in sync. */
interface ThemeCart {
  add?: (items: AddItem[]) => Promise<unknown>;
}
const themeCart = (): ThemeCart | undefined => (globalThis as { Fusion?: { cart?: ThemeCart } }).Fusion?.cart;

/**
 * Adds lines to the cart. Resolves `true` when the THEME's own cart API did the add (the theme has already re-rendered
 * its drawer), `false` when we posted to /cart/add.js ourselves (the caller should ask the theme to refresh).
 * Only ever sends variant ids, quantities and properties: prices are never sent from the browser.
 */
export async function addItems(items: AddItem[], f?: Fetch): Promise<boolean> {
  const theme = f ? undefined : themeCart();
  if (theme?.add) {
    try {
      await theme.add(items);
      return true;
    } catch (e) {
      // the theme throws Error(description) for 4xx such as out of stock; keep the message
      throw new CartError(e instanceof Error && e.message ? e.message : "Could not add to cart", 422);
    }
  }
  const res = await (f ?? fetch)("/cart/add.js", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { description?: string; message?: string };
      message = body.description || body.message || message;
    } catch {
      /* keep status message */
    }
    throw new CartError(message, res.status);
  }
  return false;
}

export async function getCart(f: Fetch = fetch): Promise<Cart> {
  const res = await f("/cart.js", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new CartError(`HTTP ${res.status}`, res.status);
  return (await res.json()) as Cart;
}

/** Tell the theme (and us) the cart changed. Themes listen to different names; fire the common ones. */
export function announceCartChange(doc: Document = document): void {
  for (const name of ["bundlekit:cart-updated", "cart:refresh", "cart:updated"]) {
    doc.dispatchEvent(new CustomEvent(name, { bubbles: true }));
  }
}
