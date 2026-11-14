import { ZodError } from "zod";
import { ConfigTooLargeError } from "@bundlekit/config-schema";
import type { SyncState } from "./desired";
import { GqlClient, type AdminLike, type GqlOptions } from "./gql";
import { reconcileShop, type ReconcileReport } from "./reconcile";
import { syncShop } from "./sync";

export interface SyncRepo {
  load(shopDomain: string): Promise<SyncState | null>;
  markSyncing(shopId: string): Promise<void>;
  markSynced(shopId: string, productGids: string[]): Promise<void>;
  markFailed(shopId: string, message: string): Promise<void>;
}

/** Hook for the background retry job (Trigger.dev when wired; see docs/DECISIONS.md). */
export interface SyncScheduler {
  scheduleRetry(shopDomain: string, delayMs: number): Promise<void>;
}
export const noopScheduler: SyncScheduler = { scheduleRetry: async () => {} };

export interface RunDeps {
  repo: SyncRepo;
  admin: (shopDomain: string) => Promise<AdminLike>;
  scheduler?: SyncScheduler;
  gql?: GqlOptions;
  log?: (msg: string, fields?: Record<string, unknown>) => void;
}

export type RunResult =
  { ok: true; set: number; deleted: number } | { ok: false; message: string; retryScheduled: boolean };

/** Merchant-safe message: says what happened and what to do. Never contains tokens or raw payloads. */
export function friendlyError(e: unknown): { message: string; retriable: boolean } {
  if (e instanceof ConfigTooLargeError) return { message: e.message, retriable: false };
  if (e instanceof ZodError) {
    return {
      message: `A setting is invalid (${e.issues[0]?.path.join(".") || "config"}: ${e.issues[0]?.message}). Fix it and save again.`,
      retriable: false,
    };
  }
  const err = e as { retriable?: boolean; message?: string };
  return {
    message: err.retriable
      ? "Shopify was busy or unreachable, so your changes are not live yet. We will retry; you can also press Retry."
      : `Shopify rejected the update: ${String(err.message ?? "unknown error").slice(0, 300)}`,
    retriable: err.retriable === true,
  };
}

/** Full sync with status tracking. On failure sets Shop.syncStatus = FAILED so the admin shows a banner. */
export async function runSync(shopDomain: string, deps: RunDeps): Promise<RunResult> {
  const state = await deps.repo.load(shopDomain);
  if (!state) return { ok: false, message: "Shop not found", retryScheduled: false };
  await deps.repo.markSyncing(state.shopId);
  try {
    const client = new GqlClient(await deps.admin(shopDomain), deps.gql);
    const report = await syncShop(client, state);
    await deps.repo.markSynced(state.shopId, report.productGids);
    deps.log?.("metafield sync ok", { shop: shopDomain, set: report.set, deleted: report.deleted });
    return { ok: true, set: report.set, deleted: report.deleted };
  } catch (e) {
    const { message, retriable } = friendlyError(e);
    await deps.repo.markFailed(state.shopId, message);
    deps.log?.("metafield sync failed", { shop: shopDomain, retriable, message });
    let retryScheduled = false;
    if (retriable && deps.scheduler) {
      await deps.scheduler.scheduleRetry(shopDomain, 60_000);
      retryScheduled = true;
    }
    return { ok: false, message, retryScheduled };
  }
}

/** Drift check and repair (daily job + on demand). */
export async function runReconcile(
  shopDomain: string,
  deps: RunDeps,
  opts: { repair?: boolean } = {},
): Promise<ReconcileReport | null> {
  const state = await deps.repo.load(shopDomain);
  if (!state) return null;
  const client = new GqlClient(await deps.admin(shopDomain), deps.gql);
  const report = await reconcileShop(client, state, opts);
  if (report.repaired || opts.repair !== false) await deps.repo.markSynced(state.shopId, report.productGids);
  return report;
}
