import type { LinePayload, OrderPayload } from "../../app/services/analytics/orders";

export const line = (
  id: number,
  price: string,
  qty: number,
  opts: { discount?: string; props?: Record<string, string>; appIndex?: number } = {},
): LinePayload => ({
  id,
  price,
  quantity: qty,
  total_discount: opts.discount ?? "0.00",
  properties: Object.entries(opts.props ?? {}).map(([name, value]) => ({ name, value })),
  discount_allocations: opts.discount
    ? [{ amount: opts.discount, discount_application_index: opts.appIndex ?? 0 }]
    : [],
});

export const order = (
  n: number,
  total: string,
  lines: LinePayload[],
  appTitle = "BundleKit discounts",
): OrderPayload => ({
  admin_graphql_api_id: `gid://shopify/Order/${n}`,
  currency: "INR",
  total_price: total,
  discount_applications: [{ title: appTitle }],
  line_items: lines,
});
