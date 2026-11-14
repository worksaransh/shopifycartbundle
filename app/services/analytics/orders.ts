import { currencyExponent, decimalToMinor } from "@bundlekit/pricing";

/**
 * Pure parsing of order webhooks into attribution rows. No I/O, so it is tested against hand-calculated orders.
 *
 * Payload fields used (REST-shaped webhook payload; only ids, quantities and money, never customer data):
 *   admin_graphql_api_id, currency, total_price, discount_applications[].title,
 *   line_items[].{id, price, quantity, total_discount, properties[], discount_allocations[]}
 *
 * UNVERIFIED on a real store (no order access in the authoring environment): that line properties starting with "_"
 * appear in the payload, and that the volume discount's application title starts with "Volume discount". Test with
 * the first real orders (docs/RUNBOOK.md).
 *
 * Integrity rules:
 *  - BUNDLE / UPSELL revenue counts only for lines our Function actually discounted (discount > 0) AND whose id is a
 *    real bundle / upsell rule of this shop. A shopper-forged property therefore cannot create attributed revenue.
 *  - Revenue = line price x quantity minus that line's discounts, in minor units (never floats).
 */
export interface OrderPayload {
  admin_graphql_api_id?: string;
  currency?: string;
  total_price?: string;
  discount_applications?: { title?: string }[];
  line_items?: LinePayload[];
}
export interface LinePayload {
  id?: number;
  price?: string;
  quantity?: number;
  total_discount?: string;
  properties?: { name?: string; value?: string }[] | null;
  discount_allocations?: { amount?: string; discount_application_index?: number }[];
}

export type Source = "BUNDLE" | "VOLUME" | "UPSELL";

export interface ParsedLine {
  lineId: number;
  netMinor: number;
  discountMinor: number;
  bundleId: string | null;
  upsellId: string | null;
  volume: boolean;
}
export interface ParsedOrder {
  orderGid: string;
  currency: string;
  totalMinor: number;
  lines: ParsedLine[];
}
export interface AttributionRow {
  source: Source;
  refId: string;
  revenueMinor: number;
}
export interface KnownIds {
  bundleIds: ReadonlySet<string>;
  upsellIds: ReadonlySet<string>;
}

const prop = (l: LinePayload, name: string): string | null => {
  const v = l.properties?.find((p) => p?.name === name)?.value;
  return typeof v === "string" && v ? v.slice(0, 64) : null;
};

export function parseOrder(p: OrderPayload): ParsedOrder | null {
  if (!p.admin_graphql_api_id || !p.currency || p.total_price == null) return null;
  const exp = currencyExponent(p.currency);
  try {
    const apps = p.discount_applications ?? [];
    const lines: ParsedLine[] = (p.line_items ?? []).map((l) => {
      const gross = decimalToMinor(l.price ?? "0", exp) * (l.quantity ?? 0);
      const allocations = l.discount_allocations ?? [];
      const discountMinor = allocations.length
        ? allocations.reduce((n, a) => n + decimalToMinor(a.amount ?? "0", exp), 0)
        : decimalToMinor(l.total_discount ?? "0", exp);
      const volume = allocations.some((a) =>
        /^volume discount/i.test(apps[a.discount_application_index ?? -1]?.title ?? ""),
      );
      return {
        lineId: l.id ?? 0,
        netMinor: Math.max(0, gross - discountMinor),
        discountMinor,
        bundleId: prop(l, "_bundle_id"),
        upsellId: prop(l, "_upsell_id"),
        volume,
      };
    });
    return {
      orderGid: p.admin_graphql_api_id,
      currency: p.currency,
      totalMinor: decimalToMinor(p.total_price, exp),
      lines,
    };
  } catch {
    return null; // malformed money: skip rather than record wrong numbers
  }
}

/** Per (source, refId) revenue for one order. Empty array means the order was not influenced by BundleKit. */
export function buildAttributions(order: ParsedOrder, known: KnownIds): AttributionRow[] {
  const acc = new Map<string, AttributionRow>();
  const add = (source: Source, refId: string, revenueMinor: number) => {
    const key = `${source}|${refId}`;
    const cur = acc.get(key);
    if (cur) cur.revenueMinor += revenueMinor;
    else acc.set(key, { source, refId, revenueMinor });
  };
  for (const l of order.lines) {
    if (l.discountMinor <= 0) continue; // we did not discount it, so we did not influence it
    if (l.bundleId && known.bundleIds.has(l.bundleId)) add("BUNDLE", l.bundleId, l.netMinor);
    else if (l.upsellId && known.upsellIds.has(l.upsellId)) add("UPSELL", l.upsellId, l.netMinor);
    else if (l.volume) add("VOLUME", "volume", l.netMinor);
  }
  return [...acc.values()].sort((a, b) => (a.source + a.refId).localeCompare(b.source + b.refId));
}

export interface RefundPayload {
  id?: number;
  order_id?: number;
  admin_graphql_api_id?: string;
  refund_line_items?: { quantity?: number; subtotal?: string; line_item?: LinePayload }[];
}

export interface RefundReduction {
  source: Source | null;
  refId: string | null;
  amountMinor: number;
}

/**
 * Amount to take off attributed revenue and off the order total for one refund.
 * `source`/`refId` are null for refunded lines that were not attributed (they still reduce the order total).
 */
export function parseRefund(p: RefundPayload, currency: string, known: KnownIds): RefundReduction[] {
  const exp = currencyExponent(currency);
  const out: RefundReduction[] = [];
  try {
    for (const r of p.refund_line_items ?? []) {
      const amountMinor = decimalToMinor(r.subtotal ?? "0", exp);
      if (amountMinor <= 0) continue;
      const li = r.line_item ?? {};
      const bundleId = prop(li, "_bundle_id");
      const upsellId = prop(li, "_upsell_id");
      if (bundleId && known.bundleIds.has(bundleId))
        out.push({ source: "BUNDLE", refId: bundleId, amountMinor });
      else if (upsellId && known.upsellIds.has(upsellId))
        out.push({ source: "UPSELL", refId: upsellId, amountMinor });
      else out.push({ source: null, refId: null, amountMinor });
    }
  } catch {
    return [];
  }
  return out;
}
