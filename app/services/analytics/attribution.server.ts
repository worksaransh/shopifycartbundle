import db from "../../db.server";
import { logger } from "../../lib/logger.server";
import {
  buildAttributions,
  parseOrder,
  parseRefund,
  type KnownIds,
  type OrderPayload,
  type RefundPayload,
} from "./orders";

async function shopOf(domain: string) {
  return db.shop.findFirst({ where: { domain, uninstalledAt: null }, select: { id: true } });
}

async function knownIds(shopId: string): Promise<KnownIds> {
  const [bundles, upsells] = await Promise.all([
    db.bundle.findMany({ where: { shopId }, select: { id: true } }),
    db.upsellRule.findMany({ where: { shopId }, select: { id: true } }),
  ]);
  return { bundleIds: new Set(bundles.map((b) => b.id)), upsellIds: new Set(upsells.map((u) => u.id)) };
}

/**
 * orders/paid. Idempotent: rows are keyed (shop, order, source, ref) and use create-if-missing, so a redelivery never
 * double counts and never undoes a refund applied in between. The webhook route also dedupes by webhook id.
 */
export async function recordOrderPaid(
  domain: string,
  payload: OrderPayload,
): Promise<{ attributed: number } | null> {
  const shop = await shopOf(domain);
  if (!shop) return null;
  const order = parseOrder(payload);
  if (!order) {
    logger.warn({ shop: domain }, "orders/paid payload could not be parsed; skipped");
    return null;
  }
  const rows = buildAttributions(order, await knownIds(shop.id));
  await db.orderTotal.upsert({
    where: { shopId_orderGid: { shopId: shop.id, orderGid: order.orderGid } },
    create: {
      shopId: shop.id,
      orderGid: order.orderGid,
      totalMinor: BigInt(order.totalMinor),
      currency: order.currency,
      touched: rows.length > 0,
    },
    update: {},
  });
  for (const r of rows) {
    await db.orderAttribution.upsert({
      where: {
        shopId_orderGid_source_refId: {
          shopId: shop.id,
          orderGid: order.orderGid,
          source: r.source,
          refId: r.refId,
        },
      },
      create: {
        shopId: shop.id,
        orderGid: order.orderGid,
        source: r.source,
        refId: r.refId,
        revenueMinor: BigInt(r.revenueMinor),
        currency: order.currency,
      },
      update: {},
    });
  }
  return { attributed: rows.length };
}

/** refunds/create: reduce attributed revenue and the order total by the refunded line subtotals (never below 0). */
export async function recordRefund(
  domain: string,
  payload: RefundPayload,
): Promise<{ reduced: number } | null> {
  const shop = await shopOf(domain);
  if (!shop || !payload.order_id) return null;
  const orderGid = `gid://shopify/Order/${payload.order_id}`;
  const total = await db.orderTotal.findUnique({ where: { shopId_orderGid: { shopId: shop.id, orderGid } } });
  if (!total) return null; // we never recorded this order (placed before install)
  const reductions = parseRefund(payload, total.currency, await knownIds(shop.id));

  let all = 0;
  for (const r of reductions) {
    all += r.amountMinor;
    if (!r.source || !r.refId) continue;
    const where = {
      shopId_orderGid_source_refId: { shopId: shop.id, orderGid, source: r.source, refId: r.refId },
    };
    const row = await db.orderAttribution.findUnique({ where });
    if (!row) continue;
    const next = row.revenueMinor - BigInt(r.amountMinor);
    await db.orderAttribution.update({ where, data: { revenueMinor: next < 0n ? 0n : next } });
  }
  if (all > 0) {
    const next = total.totalMinor - BigInt(all);
    await db.orderTotal.update({
      where: { shopId_orderGid: { shopId: shop.id, orderGid } },
      data: { totalMinor: next < 0n ? 0n : next },
    });
  }
  return { reduced: all };
}
