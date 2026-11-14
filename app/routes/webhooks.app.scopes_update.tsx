import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { logger } from "../lib/logger.server";
import { processOnce } from "../lib/webhook-receipt.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);
  await processOnce(request, topic, shop, async () => {
    const current = payload.current as string[];
    if (session) {
      await db.session.update({ where: { id: session.id }, data: { scope: current.toString() } });
    }
    logger.info({ shop, topic }, "scopes updated");
  });
  return new Response();
};
