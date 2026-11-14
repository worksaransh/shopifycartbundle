import db from "../../db.server";
import { computeKpis, lastDays, type Kpis } from "./metrics";

/** KPIs for the last `days` UTC days. Every query is scoped by shopId. */
export async function loadKpis(
  shopId: string,
  days: number,
  now: Date = new Date(),
): Promise<{ kpis: Kpis; currency: string }> {
  const list = lastDays(now, days);
  const from = new Date(`${list[0]}T00:00:00.000Z`);
  const [attr, orders, events] = await Promise.all([
    db.orderAttribution.findMany({
      where: { shopId, createdAt: { gte: from } },
      select: { orderGid: true, source: true, revenueMinor: true, createdAt: true, currency: true },
      take: 50_000,
    }),
    db.orderTotal.findMany({
      where: { shopId, createdAt: { gte: from } },
      select: { totalMinor: true, touched: true, currency: true },
      take: 50_000,
    }),
    db.eventDaily.groupBy({
      by: ["eventType"],
      where: { shopId, date: { gte: from } },
      _sum: { count: true },
    }),
  ]);
  const kpis = computeKpis(
    attr.map((a) => ({
      orderGid: a.orderGid,
      source: a.source,
      revenueMinor: Number(a.revenueMinor),
      day: a.createdAt.toISOString().slice(0, 10),
    })),
    orders.map((o) => ({ totalMinor: Number(o.totalMinor), touched: o.touched })),
    events.map((e) => ({ eventType: e.eventType, count: e._sum.count ?? 0 })),
    list,
  );
  return { kpis, currency: attr[0]?.currency ?? orders[0]?.currency ?? "USD" };
}
