/**
 * KPI formulas (documented in docs/METRICS.md). Pure functions over plain rows, so every number can be checked by hand.
 * All money is integer minor units.
 */
export const MIN_ORDERS_FOR_AOV = 20;

export interface AttributionRowIn {
  orderGid: string;
  source: "BUNDLE" | "VOLUME" | "UPSELL";
  revenueMinor: number;
  day: string; // YYYY-MM-DD (UTC)
}
export interface OrderRowIn {
  totalMinor: number;
  touched: boolean;
}
export interface EventCountIn {
  eventType: string;
  count: number;
}

export interface Kpis {
  attributedRevenueMinor: number;
  bundleOrders: number;
  upsellViewed: number;
  upsellAdded: number;
  /** upsell_added / upsell_viewed, or null when there were no views. A rate, not a conversion of orders. */
  upsellAcceptanceRate: number | null;
  tierSelections: number;
  orders: { touched: number; untouched: number };
  /** Average order value of orders with / without BundleKit discounts. null when too few orders. */
  aov: {
    touchedMinor: number | null;
    untouchedMinor: number | null;
    liftPercent: number | null;
    enoughData: boolean;
  };
  series: { day: string; revenueMinor: number }[];
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function computeKpis(
  attributions: AttributionRowIn[],
  orders: OrderRowIn[],
  events: EventCountIn[],
  days: string[],
): Kpis {
  const count = (type: string) => sum(events.filter((e) => e.eventType === type).map((e) => e.count));
  const viewed = count("UPSELL_VIEWED");
  const added = count("UPSELL_ADDED");

  const touched = orders.filter((o) => o.touched);
  const untouched = orders.filter((o) => !o.touched);
  const avg = (rows: OrderRowIn[]) =>
    rows.length ? Math.round(sum(rows.map((r) => r.totalMinor)) / rows.length) : null;
  const enoughData = touched.length >= MIN_ORDERS_FOR_AOV && untouched.length >= MIN_ORDERS_FOR_AOV;
  const aovT = avg(touched);
  const aovU = avg(untouched);

  const byDay = new Map<string, number>();
  for (const a of attributions) byDay.set(a.day, (byDay.get(a.day) ?? 0) + a.revenueMinor);

  return {
    attributedRevenueMinor: sum(attributions.map((a) => a.revenueMinor)),
    bundleOrders: new Set(attributions.filter((a) => a.source === "BUNDLE").map((a) => a.orderGid)).size,
    upsellViewed: viewed,
    upsellAdded: added,
    upsellAcceptanceRate: viewed > 0 ? added / viewed : null,
    tierSelections: count("TIER_SELECTED"),
    orders: { touched: touched.length, untouched: untouched.length },
    aov: {
      touchedMinor: aovT,
      untouchedMinor: aovU,
      enoughData,
      liftPercent: enoughData && aovT !== null && aovU ? ((aovT - aovU) / aovU) * 100 : null,
    },
    series: days.map((day) => ({ day, revenueMinor: byDay.get(day) ?? 0 })),
  };
}

/** Last `n` UTC days ending at `end` (inclusive), oldest first, as YYYY-MM-DD. */
export function lastDays(end: Date, n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - (n - 1 - i)));
    return d.toISOString().slice(0, 10);
  });
}

/** CSV cell safe against formula injection (shopper-controlled text must never run in a spreadsheet). */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
