/**
 * Weekly one-page report per store (Phase 9). Usage:
 *   DATABASE_URL=... DIRECT_URL=... npx tsx scripts/weekly-report.ts --shop my-store.myshopify.com [--days 7]
 * Prints Markdown to stdout. Issues found are written by a person in docs/PILOT_LOG.md; this only reports numbers.
 */
import { PrismaClient } from "@prisma/client";
import { formatMoney } from "../packages/widgets/src";
import { computeKpis, lastDays, MIN_ORDERS_FOR_AOV } from "../app/services/analytics/metrics";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const domain = arg("shop");
  const days = Number(arg("days") ?? 7);
  if (!domain || !Number.isInteger(days) || days < 1 || days > 90) {
    console.error("Usage: weekly-report.ts --shop <domain> [--days 1-90]");
    process.exit(1);
  }
  const db = new PrismaClient();
  try {
    const shop = await db.shop.findUnique({ where: { domain } });
    if (!shop) throw new Error(`No shop ${domain}`);
    const list = lastDays(new Date(), days);
    const from = new Date(`${list[0]}T00:00:00.000Z`);
    const [attr, orders, events] = await Promise.all([
      db.orderAttribution.findMany({ where: { shopId: shop.id, createdAt: { gte: from } } }),
      db.orderTotal.findMany({ where: { shopId: shop.id, createdAt: { gte: from } } }),
      db.eventDaily.groupBy({
        by: ["eventType"],
        where: { shopId: shop.id, date: { gte: from } },
        _sum: { count: true },
      }),
    ]);
    const k = computeKpis(
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
    const cur = attr[0]?.currency ?? orders[0]?.currency ?? "USD";
    const m = (n: number | null) => (n === null ? "n/a" : formatMoney(n, cur, "en"));
    console.log(`# BundleKit weekly report: ${domain}`);
    console.log(`Period: ${list[0]} to ${list[list.length - 1]} (${days} days, UTC)\n`);
    console.log(`| Metric | Value |\n|---|---|`);
    console.log(`| Attributed revenue (after discounts and refunds) | ${m(k.attributedRevenueMinor)} |`);
    console.log(`| Bundle orders | ${k.bundleOrders} |`);
    console.log(
      `| Upsell acceptance | ${k.upsellAcceptanceRate === null ? "n/a" : `${(k.upsellAcceptanceRate * 100).toFixed(1)}% (${k.upsellAdded} of ${k.upsellViewed})`} |`,
    );
    console.log(`| Shipping bar completions | ${k.shippingBarCompleted} |`);
    console.log(`| Orders with / without BundleKit | ${k.orders.touched} / ${k.orders.untouched} |`);
    console.log(`| AOV with BundleKit | ${m(k.aov.touchedMinor)} |`);
    console.log(`| AOV without BundleKit | ${m(k.aov.untouchedMinor)} |`);
    console.log(
      `| AOV difference | ${k.aov.enoughData && k.aov.liftPercent !== null ? `${k.aov.liftPercent.toFixed(1)}%` : `not enough data (need ${MIN_ORDERS_FOR_AOV} orders each side)`} |`,
    );
    console.log(`\nAOV difference is a correlation, not proof of lift.`);
    console.log(`\n## Issues found\nSee docs/PILOT_LOG.md.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
