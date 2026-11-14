import { createHash } from "node:crypto";

/**
 * Fixed-window rate limiter, in memory. LIMITATION: per server instance, so on several instances or serverless the
 * effective limit is higher; move to a shared store (Redis / Upstash) in Phase 8 if abuse appears. Keys are hashed:
 * a raw IP is never kept, and nothing is persisted.
 */
export class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** true = allowed, false = over the limit */
  hit(key: string): boolean {
    const t = this.now();
    const k = createHash("sha256").update(key).digest("base64url").slice(0, 16);
    const w = this.windows.get(k);
    if (!w || t - w.start >= this.windowMs) {
      this.windows.set(k, { start: t, count: 1 });
      if (this.windows.size > 5000) this.sweep(t);
      return true;
    }
    w.count++;
    return w.count <= this.limit;
  }

  private sweep(t: number) {
    for (const [k, w] of this.windows) if (t - w.start >= this.windowMs) this.windows.delete(k);
  }
}
