import db from "../../db.server";
import { syncShopMetafields } from "../sync/repo.server";
import { upsellInputSchema } from "./validation";

export type UpsellSaveResult =
  | { ok: true; id: string; synced: boolean; syncMessage?: string }
  | { ok: false; errors: Record<string, string> };

async function shopIdOf(domain: string): Promise<string> {
  const shop = await db.shop.findUnique({ where: { domain }, select: { id: true } });
  if (!shop) throw new Error("Shop not found. Reopen the app from Shopify admin.");
  return shop.id;
}

export async function createUpsellRule(domain: string, raw: unknown): Promise<UpsellSaveResult> {
  const parsed = upsellInputSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[String(i.path[0] ?? "form")] ??= i.message;
    return { ok: false, errors };
  }
  const u = parsed.data;
  const shopId = await shopIdOf(domain);
  const row = await db.upsellRule.create({
    data: {
      shopId,
      triggerType: u.triggerType,
      triggerGids: u.triggerGids,
      offerGids: u.offerGids,
      offerHandles: u.offerHandles,
      discountPercent: u.discountPercent ? u.discountPercent : null,
      maxOffers: u.maxOffers,
      hideIfInCart: u.hideIfInCart,
      layout: u.layout,
      status: "ACTIVE",
    },
  });
  const sync = await syncShopMetafields(domain);
  return { ok: true, id: row.id, synced: sync.ok, ...(sync.ok ? {} : { syncMessage: sync.message }) };
}

export async function setUpsellStatus(domain: string, ids: string[], status: "ACTIVE" | "PAUSED") {
  const shopId = await shopIdOf(domain);
  const { count } = await db.upsellRule.updateMany({ where: { shopId, id: { in: ids } }, data: { status } });
  const sync = await syncShopMetafields(domain);
  return { changed: count, synced: sync.ok, syncMessage: sync.ok ? undefined : sync.message };
}

export async function deleteUpsellRules(domain: string, ids: string[]) {
  const shopId = await shopIdOf(domain);
  const { count } = await db.upsellRule.deleteMany({ where: { shopId, id: { in: ids } } });
  const sync = await syncShopMetafields(domain);
  return { changed: count, synced: sync.ok, syncMessage: sync.ok ? undefined : sync.message };
}
