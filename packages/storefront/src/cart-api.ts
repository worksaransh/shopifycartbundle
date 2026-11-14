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

export async function addItems(items: AddItem[], f: Fetch = fetch): Promise<void> {
  const res = await f("/cart/add.js", {
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
