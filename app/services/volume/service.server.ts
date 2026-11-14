import db from "../../db.server";
import { syncShopMetafields } from "../sync/repo.server";
import { syncOrRollback } from "../sync/activate.server";
import { volumeFieldErrors, volumeInputSchema } from "./validation";

export type VolumeSaveResult =
  | { ok: true; id: string; synced: boolean; syncMessage?: string }
  | { ok: false; errors: Record<string, string> };

async function shopOf(domain: string) {
  const shop = await db.shop.findUnique({ where: { domain }, select: { id: true, settings: true } });
  if (!shop) throw new Error("Shop not found. Reopen the app from Shopify admin.");
  return shop;
}

/** YYYY-MM-DD (shop calendar date) -> UTC midnight; read back as the same date by the sync. */
const day = (d?: string) => (d ? new Date(`${d}T00:00:00.000Z`) : null);

export async function createVolumeRule(domain: string, raw: unknown): Promise<VolumeSaveResult> {
  const parsed = volumeInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: volumeFieldErrors(parsed.error) };
  const v = parsed.data;
  const shop = await shopOf(domain);
  const row = await db.volumeRule.create({
    data: {
      shopId: shop.id,
      targetType: v.targetType,
      targetGids: v.targetGids,
      tiers: v.tiers,
      status: "ACTIVE",
      startsAt: day(v.startsAt),
      endsAt: day(v.endsAt),
    },
  });
  const sync = await syncOrRollback(domain, async () => {
    await db.volumeRule.updateMany({ where: { shopId: shop.id, id: row.id }, data: { status: "DRAFT" } });
  });
  return { ok: true, id: row.id, synced: sync.synced, ...(sync.synced ? {} : { syncMessage: sync.message }) };
}

export async function setVolumeStatus(domain: string, ids: string[], status: "ACTIVE" | "PAUSED") {
  const shop = await shopOf(domain);
  const before =
    status === "ACTIVE"
      ? await db.volumeRule.findMany({
          where: { shopId: shop.id, id: { in: ids } },
          select: { id: true, status: true },
        })
      : [];
  const { count } = await db.volumeRule.updateMany({
    where: { shopId: shop.id, id: { in: ids } },
    data: { status },
  });
  const sync = await syncOrRollback(domain, async () => {
    for (const r of before)
      await db.volumeRule.updateMany({ where: { shopId: shop.id, id: r.id }, data: { status: r.status } });
  });
  return { changed: count, synced: sync.synced, syncMessage: sync.synced ? undefined : sync.message };
}

export async function deleteVolumeRules(domain: string, ids: string[]) {
  const shop = await shopOf(domain);
  const { count } = await db.volumeRule.deleteMany({ where: { shopId: shop.id, id: { in: ids } } });
  const sync = await syncShopMetafields(domain);
  return { changed: count, synced: sync.ok, syncMessage: sync.ok ? undefined : sync.message };
}

/** Bundle + volume stacking. Default off: volume tiers skip lines that are part of a complete bundle. */
export async function setStackVolumeWithBundles(domain: string, on: boolean) {
  const shop = await shopOf(domain);
  const settings = (shop.settings ?? {}) as Record<string, unknown>;
  await db.shop.update({
    where: { id: shop.id },
    data: { settings: { ...settings, stackVolumeWithBundles: on } },
  });
  const sync = await syncShopMetafields(domain);
  return { synced: sync.ok, syncMessage: sync.ok ? undefined : sync.message };
}
