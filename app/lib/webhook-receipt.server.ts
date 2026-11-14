import { Prisma } from "@prisma/client";
import db from "../db.server";
import { logger } from "./logger.server";

/** True if this webhook delivery was already fully processed. */
export async function alreadyProcessed(webhookId: string): Promise<boolean> {
  return (await db.webhookReceipt.findUnique({ where: { id: webhookId }, select: { id: true } })) !== null;
}

/** Record a processed delivery. Concurrent duplicate inserts are ignored. */
export async function markProcessed(webhookId: string, topic: string, shopDomain: string): Promise<void> {
  try {
    await db.webhookReceipt.create({ data: { id: webhookId, topic, shopDomain } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return;
    throw e;
  }
}

/**
 * Idempotent webhook processing. Handlers MUST themselves be safe to re-run, because the receipt
 * is written after success (so a crash mid-handler lets Shopify's retry run it again).
 * Returns true when the handler ran, false when it was a duplicate delivery.
 */
export async function processOnce(
  request: Request,
  topic: string,
  shopDomain: string,
  handler: () => Promise<void>,
): Promise<boolean> {
  const webhookId = request.headers.get("x-shopify-webhook-id");
  if (!webhookId) {
    // authenticate.webhook already verified HMAC; a missing id means we cannot dedupe, so just run.
    await handler();
    return true;
  }
  if (await alreadyProcessed(webhookId)) {
    logger.info({ topic, shop: shopDomain, webhookId }, "duplicate webhook ignored");
    return false;
  }
  await handler();
  await markProcessed(webhookId, topic, shopDomain);
  return true;
}
