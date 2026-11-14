import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { recordRefund } from "../services/analytics/attribution.server";
import type { RefundPayload } from "../services/analytics/orders";
import { processOnce } from "../lib/webhook-receipt.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  await processOnce(request, topic, shop, async () => {
    await recordRefund(shop, payload as RefundPayload);
  });
  return new Response();
};
