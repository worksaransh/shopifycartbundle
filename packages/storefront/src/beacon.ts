/**
 * Funnel events, batched and sent with navigator.sendBeacon to the app proxy. No cookies, no PII, no IDs of
 * shoppers: only an event type, an optional rule/bundle id and a count. Failures are silent.
 */
export type EventType =
  | "bundle_viewed"
  | "bundle_added"
  | "upsell_viewed"
  | "upsell_added"
  | "tier_selected"
  | "shipping_bar_completed"
  | "cart_surface_missing";

export interface BeaconEvent {
  t: EventType;
  r?: string;
  n: number;
}

export interface Beacon {
  track(type: EventType, refId?: string): void;
  /** Like track, but only the first call per (type, refId) per page. */
  once(type: EventType, refId?: string): void;
  flush(): void;
}

export interface BeaconDeps {
  send?: (url: string, body: Blob) => boolean;
  schedule?: (fn: () => void, ms: number) => unknown;
}

const MAX_BATCH = 20;

export function createBeacon(url: string | null | undefined, deps: BeaconDeps = {}): Beacon {
  const send =
    deps.send ??
    ((u, b) =>
      typeof navigator !== "undefined" && navigator.sendBeacon ? navigator.sendBeacon(u, b) : false);
  const schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const counts = new Map<string, BeaconEvent>();
  const seen = new Set<string>();
  let timer: unknown = null;

  const flush = () => {
    timer = null;
    if (!url || counts.size === 0) {
      counts.clear();
      return;
    }
    const events = [...counts.values()].slice(0, MAX_BATCH);
    counts.clear();
    try {
      send(url, new Blob([JSON.stringify({ events })], { type: "application/json" }));
    } catch {
      /* analytics must never affect the page */
    }
  };

  const track = (type: EventType, refId?: string) => {
    if (!url) return;
    const key = `${type}|${refId ?? ""}`;
    const cur = counts.get(key);
    if (cur) cur.n++;
    else counts.set(key, { t: type, ...(refId ? { r: refId.slice(0, 64) } : {}), n: 1 });
    if (counts.size >= MAX_BATCH) flush();
    else if (timer === null) timer = schedule(flush, 3000);
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
    window.addEventListener("pagehide", flush);
  }

  return {
    track,
    once(type, refId) {
      const key = `${type}|${refId ?? ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      track(type, refId);
    },
    flush,
  };
}
