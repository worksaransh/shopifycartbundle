import db from "../../db.server";
import { logger } from "../../lib/logger.server";
import { unauthenticated } from "../../shopify.server";
import type { SyncState } from "./desired";
import { noopScheduler, runReconcile, runSync, type RunDeps, type SyncRepo } from "./run";

/** Every query is scoped by shopId / domain (Phase 8 adds an automated scope check). */
export const prismaSyncRepo: SyncRepo = {
  async load(shopDomain) {
    const shop = await db.shop.findUnique({ where: { domain: shopDomain } });
    if (!shop) return null;
    const [bundles, volumeRules, upsellRules] = await Promise.all([
      db.bundle.findMany({ where: { shopId: shop.id } }),
      db.volumeRule.findMany({ where: { shopId: shop.id } }),
      db.upsellRule.findMany({ where: { shopId: shop.id } }),
    ]);
    return {
      shopId: shop.id,
      shopDomain: shop.domain,
      settings: shop.settings,
      syncedProductGids: shop.syncedProductGids,
      ruleDiscountGid: shop.ruleDiscountGid,
      upsellRules: upsellRules as unknown as SyncState["upsellRules"],
      bundles: bundles as unknown as SyncState["bundles"],
      volumeRules: volumeRules as unknown as SyncState["volumeRules"],
    };
  },
  async markSyncing(shopId) {
    await db.shop.update({ where: { id: shopId }, data: { syncStatus: "SYNCING", syncError: null } });
  },
  async markSynced(shopId, productGids, ruleDiscountGid) {
    await db.shop.update({
      where: { id: shopId },
      data: {
        syncStatus: "SYNCED",
        syncError: null,
        metafieldSyncedAt: new Date(),
        syncedProductGids: productGids,
        ruleDiscountGid,
      },
    });
  },
  async markFailed(shopId, message) {
    await db.shop.update({ where: { id: shopId }, data: { syncStatus: "FAILED", syncError: message } });
  },
};

const deps: RunDeps = {
  repo: prismaSyncRepo,
  admin: async (shop) => (await unauthenticated.admin(shop)).admin,
  scheduler: noopScheduler,
  log: (msg, fields) => logger.info(fields ?? {}, msg),
};

/** Call after any write to Bundle, VolumeRule, UpsellRule or Shop settings. */
export const syncShopMetafields = (shopDomain: string) => runSync(shopDomain, deps);
export const reconcileShopMetafields = (shopDomain: string, repair = true) =>
  runReconcile(shopDomain, deps, { repair });
