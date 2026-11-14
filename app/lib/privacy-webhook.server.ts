import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { logger } from "./logger.server";
import { processOnce } from "./webhook-receipt.server";

/**
 * Mandatory privacy webhooks. Ref: https://shopify.dev/docs/apps/build/privacy-law-compliance
 * We hold NO customer personal data: only order GIDs, line totals and anonymous event counters. So:
 *  - customers/data_request: nothing to export; acknowledge and log (never the payload, which is PII).
 *  - customers/redact: nothing to delete; acknowledge and log.
 *  - shop/redact (sent ~48h after uninstall): delete everything we hold for the shop.
 * HMAC is verified by authenticate.webhook (401 on mismatch). Handlers are idempotent.
 */
export function customerPrivacyAction() {
  return async ({ request }: ActionFunctionArgs) => {
    const { shop, topic } = await authenticate.webhook(request);
    await processOnce(request, topic, shop, async () => {
      logger.info({ shop, topic }, "privacy request received: no customer data is stored by this app");
    });
    return new Response();
  };
}

/** Deletes every row we hold for a shop. Shop rows cascade to bundles, rules, events, attributions and order totals. */
export async function deleteAllShopData(domain: string): Promise<void> {
  await db.shop.deleteMany({ where: { domain } });
  await db.session.deleteMany({ where: { shop: domain } });
  await db.webhookReceipt.deleteMany({ where: { shopDomain: domain } });
}

export function shopRedactAction() {
  return async ({ request }: ActionFunctionArgs) => {
    const { shop, topic } = await authenticate.webhook(request);
    // Deletion is naturally idempotent, so no receipt is written (it would re-create a row for the deleted shop).
    await deleteAllShopData(shop);
    logger.info({ shop, topic }, "shop data deleted");
    return new Response();
  };
}
