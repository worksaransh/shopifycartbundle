import { z } from "zod";
import db from "../../db.server";

/** Beacon payload from the storefront: aggregated counts only. No PII, no IPs, no cookies. */
export const EVENT_MAP = {
  bundle_viewed: "BUNDLE_VIEWED",
  bundle_added: "BUNDLE_ADDED",
  upsell_viewed: "UPSELL_VIEWED",
  upsell_added: "UPSELL_ADDED",
  tier_selected: "TIER_SELECTED",
  shipping_bar_completed: "SHIPPING_BAR_COMPLETED",
  cart_surface_missing: "CART_SURFACE_MISSING",
} as const;

export const beaconSchema = z.object({
  events: z
    .array(
      z.object({
        t: z.enum(Object.keys(EVENT_MAP) as [keyof typeof EVENT_MAP, ...(keyof typeof EVENT_MAP)[]]),
        r: z.string().max(64).optional(),
        n: z.number().int().min(1).max(1000),
      }),
    )
    .min(1)
    .max(20),
});

/** UTC calendar date. (Reports use UTC days; a shop-timezone rollup is a documented follow-up.) */
const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Roll-up happens on write: one counter row per shop, day, event type and ref id. */
export async function recordEvents(shopId: string, raw: unknown, now: Date = new Date()): Promise<number> {
  const parsed = beaconSchema.safeParse(raw);
  if (!parsed.success) return 0;
  const date = utcDay(now);
  await Promise.all(
    parsed.data.events.map((e) => {
      const eventType = EVENT_MAP[e.t];
      const refId = e.r ?? "";
      return db.eventDaily.upsert({
        where: { shopId_date_eventType_refId: { shopId, date, eventType, refId } },
        create: { shopId, date, eventType, refId, count: e.n },
        update: { count: { increment: e.n } },
      });
    }),
  );
  return parsed.data.events.length;
}
