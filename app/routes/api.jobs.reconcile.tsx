import { timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { env } from "../lib/env.server";
import { logger } from "../lib/logger.server";
import { reconcileShopMetafields } from "../services/sync/repo.server";

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Daily (and on-demand) drift repair for every installed shop. Call from any scheduler:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/jobs/reconcile
 * Optional ?shop=<domain> limits it to one shop; ?repair=0 only reports.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const secret = env().CRON_SECRET;
  if (!secret) return new Response("Not found", { status: 404 });
  const given = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!safeEqual(given, secret)) return new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  const only = url.searchParams.get("shop");
  const repair = url.searchParams.get("repair") !== "0";
  const shops = await db.shop.findMany({
    where: { uninstalledAt: null, ...(only ? { domain: only } : {}) },
    select: { domain: true },
  });

  const results: Record<string, unknown> = {};
  for (const { domain } of shops) {
    try {
      const r = await reconcileShopMetafields(domain, repair);
      results[domain] = r && { missing: r.missing, changed: r.changed, stale: r.stale, repaired: r.repaired };
    } catch (e) {
      logger.error({ shop: domain, err: e instanceof Error ? e.message : "unknown" }, "reconcile failed");
      results[domain] = { error: true };
    }
  }
  return Response.json({ shops: shops.length, results });
};
