import db from "../../db.server";
import { syncShopMetafields } from "../sync/repo.server";
import { settingsInputSchema } from "./validation";

export type SettingsResult =
  { ok: true; synced: boolean; syncMessage?: string } | { ok: false; errors: Record<string, string> };

/** Saves storefront settings, preserving unrelated keys (setup flags, stacking), then syncs. */
export async function saveSettings(domain: string, raw: unknown): Promise<SettingsResult> {
  const parsed = settingsInputSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[i.path.join(".") || "form"] ??= i.message;
    return { ok: false, errors };
  }
  const shop = await db.shop.findUnique({ where: { domain }, select: { id: true, settings: true } });
  if (!shop) throw new Error("Shop not found. Reopen the app from Shopify admin.");
  const s = parsed.data;
  // Only keep overrides that differ from empty; blank messages fall back to the defaults.
  const strings = Object.fromEntries(Object.entries(s.strings).filter(([, v]) => v.trim() !== ""));
  const prev = (shop.settings ?? {}) as Record<string, unknown>;
  await db.shop.update({
    where: { id: shop.id },
    data: {
      settings: {
        ...prev,
        killSwitch: s.killSwitch,
        shippingBar: s.shippingBar,
        colours: s.colours,
        strings,
        ...(s.cartSelector ? { cartSelector: s.cartSelector } : { cartSelector: undefined }),
      },
    },
  });
  const sync = await syncShopMetafields(domain);
  return { ok: true, synced: sync.ok, ...(sync.ok ? {} : { syncMessage: sync.message }) };
}

/** One-click kill switch: disables every storefront feature via the shop config metafield. */
export async function setKillSwitch(domain: string, on: boolean) {
  const shop = await db.shop.findUnique({ where: { domain }, select: { id: true, settings: true } });
  if (!shop) throw new Error("Shop not found. Reopen the app from Shopify admin.");
  await db.shop.update({
    where: { id: shop.id },
    data: { settings: { ...((shop.settings ?? {}) as object), killSwitch: on } },
  });
  const sync = await syncShopMetafields(domain);
  return { synced: sync.ok, syncMessage: sync.ok ? undefined : sync.message };
}
