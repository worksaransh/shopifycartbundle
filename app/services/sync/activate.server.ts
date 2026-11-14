import { syncShopMetafields } from "./repo.server";

export interface ActivateOutcome {
  synced: boolean;
  /** True when the change could not go live for a reason that Retry cannot fix, and was rolled back to a safe state. */
  rolledBack: boolean;
  message?: string;
}

/**
 * Sync after a rule was activated. If syncing fails for a NON-retriable reason (rules too large for the checkout
 * budget, invalid setting), roll the change back (`rollback` marks the rule draft/paused) and re-sync, so the store
 * keeps its previous working state and the merchant is told what to do, instead of sitting in a failed state that
 * Retry can never fix. Retriable failures (Shopify busy) are kept as they are; the banner offers Retry.
 */
export async function syncOrRollback(
  domain: string,
  rollback: () => Promise<void>,
): Promise<ActivateOutcome> {
  const r = await syncShopMetafields(domain);
  if (r.ok) return { synced: true, rolledBack: false };
  if (r.retriable) return { synced: false, rolledBack: false, message: r.message };
  await rollback();
  await syncShopMetafields(domain);
  return {
    synced: false,
    rolledBack: true,
    message: `${r.message} It was saved as a draft; nothing changed on your store.`,
  };
}
