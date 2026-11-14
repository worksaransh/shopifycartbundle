import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { recordOrderPaid } from "../services/analytics/attribution.server";
import type { OrderPayload } from "../services/analytics/orders";
import { processOnce } from "../lib/webhook-receipt.server";

// HMAC verified by authenticate.webhook. We read ids, quantities and money only; the payload is never logged.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  await processOnce(request, topic, shop, async () => {
    await recordOrderPaid(shop, payload as OrderPayload);
  });
  return new Response();
};
