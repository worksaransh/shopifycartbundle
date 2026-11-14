import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { csvCell } from "../services/analytics/metrics";
import { currencyExponent, minorToDecimal } from "@bundlekit/pricing";

/** Monthly attribution export for client reporting: /app/attribution.csv?month=2026-11 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const month = new URL(request.url).searchParams.get("month") ?? "";
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return new Response("Use ?month=YYYY-MM, for example 2026-11.", { status: 400 });
  const from = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  const to = new Date(Date.UTC(Number(m[1]), Number(m[2]), 1));
  const shop = await db.shop.findUnique({ where: { domain: session.shop }, select: { id: true } });
  if (!shop) return new Response("Shop not found.", { status: 404 });

  const rows = await db.orderAttribution.findMany({
    where: { shopId: shop.id, createdAt: { gte: from, lt: to } },
    orderBy: { createdAt: "asc" },
    take: 100_000,
  });
  const lines = ["date,order,source,reference,revenue,currency"];
  for (const r of rows) {
    const rev = minorToDecimal(Number(r.revenueMinor), currencyExponent(r.currency));
    lines.push(
      [r.createdAt.toISOString().slice(0, 10), r.orderGid, r.source, r.refId, rev, r.currency]
        .map(csvCell)
        .join(","),
    );
  }
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bundlekit-${month}.csv"`,
    },
  });
};
