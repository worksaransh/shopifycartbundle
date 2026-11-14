import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { logger } from "./logger.server";
import { processOnce } from "./webhook-receipt.server";

/**
 * Factory for the three mandatory privacy webhooks. Phase 0 = stubs: HMAC verified (by
 * authenticate.webhook), idempotent, logged without payload. We store no customer data beyond
 * order IDs and totals. Phase 8 implements shop/redact deletion and tests it.
 * Ref: https://shopify.dev/docs/apps/build/privacy-law-compliance
 */
export function privacyAction(onHandle?: (shop: string) => Promise<void>) {
  return async ({ request }: ActionFunctionArgs) => {
    const { shop, topic } = await authenticate.webhook(request);
    await processOnce(request, topic, shop, async () => {
      // Never log the payload: it contains customer PII.
      logger.info({ shop, topic }, "privacy webhook received (stub)");
      await onHandle?.(shop);
    });
    return new Response();
  };
}
