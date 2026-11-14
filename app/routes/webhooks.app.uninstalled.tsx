import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { logger } from "../lib/logger.server";
import { processOnce } from "../lib/webhook-receipt.server";

// authenticate.webhook verifies the HMAC and throws a 401 Response on mismatch.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  await processOnce(request, topic, shop, async () => {
    // Idempotent: safe to re-run, and may arrive after sessions were already removed.
    await db.session.deleteMany({ where: { shop } });
    await db.shop.updateMany({ where: { domain: shop }, data: { uninstalledAt: new Date() } });
    // Phase 8: disable background jobs and pause discounts; aggregated stats kept per RUNBOOK retention.
    logger.info({ shop, topic }, "app uninstalled");
  });
  return new Response();
};
