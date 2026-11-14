import db from "../../db.server";
import { fieldErrors, bundleInputSchema, type BundleInput } from "./validation";
import { syncShopMetafields } from "../sync/repo.server";

export type SaveResult =
  | { ok: true; id: string; synced: boolean; syncMessage?: string }
  | { ok: false; errors: Record<string, string> };

async function shopIdOf(domain: string): Promise<string> {
  const shop = await db.shop.findUnique({ where: { domain }, select: { id: true } });
  if (!shop) throw new Error("Shop not found. Reopen the app from Shopify admin.");
  return shop.id;
}

/** Validates, stores as ACTIVE, then syncs metafields and the discount node. Every query is scoped by shopId. */
export async function createBundle(domain: string, raw: unknown): Promise<SaveResult> {
  const parsed = bundleInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const b: BundleInput = parsed.data;
  const shopId = await shopIdOf(domain);
  const row = await db.bundle.create({
    data: {
      shopId,
      type: b.type,
      title: b.title,
      status: "ACTIVE",
      discountType: b.discountType,
      discountValue: String(b.discountValue),
      items: b.items.map((i) => ({
        ...(i.productGid ? { productGid: i.productGid } : { collectionGid: i.collectionGid }),
        quantity: i.quantity,
      })),
    },
  });
  const sync = await syncShopMetafields(domain);
  return { ok: true, id: row.id, synced: sync.ok, ...(sync.ok ? {} : { syncMessage: sync.message }) };
}

/** Pause or resume. Paused bundles stay in the database (history kept) but leave the metafields and the pack. */
export async function setBundlesStatus(domain: string, ids: string[], status: "ACTIVE" | "PAUSED") {
  const shopId = await shopIdOf(domain);
  const { count } = await db.bundle.updateMany({ where: { shopId, id: { in: ids } }, data: { status } });
  const sync = await syncShopMetafields(domain);
  return { changed: count, synced: sync.ok, syncMessage: sync.ok ? undefined : sync.message };
}

/** Delete the bundle row. Attribution rows keep their refId, so historical stats survive. */
export async function deleteBundles(domain: string, ids: string[]) {
  const shopId = await shopIdOf(domain);
  const { count } = await db.bundle.deleteMany({ where: { shopId, id: { in: ids } } });
  const sync = await syncShopMetafields(domain);
  return { changed: count, synced: sync.ok, syncMessage: sync.ok ? undefined : sync.message };
}
