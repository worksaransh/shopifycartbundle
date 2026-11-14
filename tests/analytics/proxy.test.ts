import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  session: {
    count: vi.fn().mockResolvedValue(0),
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
  },
  shop: { findFirst: vi.fn() },
}));
const recordEvents = vi.hoisted(() => vi.fn().mockResolvedValue(1));
vi.mock("../../app/db.server", () => ({ default: db }));
vi.mock("../../app/services/analytics/events.server", () => ({ recordEvents }));

import { RateLimiter } from "../../app/lib/rate-limit.server";

const SECRET = "test-secret"; // vitest.config.ts SHOPIFY_API_SECRET

/** Shopify app proxy signature: HMAC-SHA256 hex over the sorted `key=value` pairs, concatenated with no separator. */
function signed(params: Record<string, string>, secret = SECRET) {
  const message = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("");
  const signature = createHmac("sha256", secret).update(message).digest("hex");
  return new URLSearchParams({ ...params, signature }).toString();
}
const base = () => ({
  shop: "dev.myshopify.com",
  path_prefix: "/apps/bundlekit",
  timestamp: String(Math.floor(Date.now() / 1000)),
  logged_in_customer_id: "",
});
const body = JSON.stringify({ events: [{ t: "bundle_added", r: "b1", n: 1 }] });

async function post(query: string, text = body, headers: Record<string, string> = {}) {
  vi.resetModules();
  const { action } = await import("../../app/routes/proxy.event");
  return action({
    request: new Request(`https://bundlekit.example.com/proxy/event?${query}`, {
      method: "POST",
      body: text,
      headers: { "content-type": "application/json", ...headers },
    }),
    params: {},
    context: {},
  } as never);
}
const status = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as Response).status;

beforeEach(() => {
  vi.clearAllMocks();
  db.shop.findFirst.mockResolvedValue({ id: "shop1" });
});

describe("app proxy /event", () => {
  it("accepts a correctly signed beacon, records it for that shop, answers 204", async () => {
    expect(await status(post(signed(base())))).toBe(204);
    expect(recordEvents).toHaveBeenCalledWith("shop1", { events: [{ t: "bundle_added", r: "b1", n: 1 }] });
    expect(db.shop.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { domain: "dev.myshopify.com", uninstalledAt: null } }),
    );
  });
  it("rejects a wrong, tampered or missing signature and records nothing", async () => {
    const tampered = signed(base()).replace("dev.myshopify.com", "evil.myshopify.com");
    // the library answers 400 (bad request) for any invalid or missing signature
    expect(await status(post(tampered))).toBe(400);
    expect(await status(post(signed(base(), "wrong-secret")))).toBe(400);
    expect(await status(post("shop=dev.myshopify.com"))).toBe(400);
    expect(recordEvents).not.toHaveBeenCalled();
  });
  it("rejects oversized and malformed bodies", async () => {
    expect(await status(post(signed(base()), "x".repeat(5000)))).toBe(413);
    expect(await status(post(signed(base()), "{not json"))).toBe(400);
    expect(recordEvents).not.toHaveBeenCalled();
  });
  it("answers 204 and records nothing for an unknown or uninstalled shop", async () => {
    db.shop.findFirst.mockResolvedValue(null);
    expect(await status(post(signed(base())))).toBe(204);
    expect(recordEvents).not.toHaveBeenCalled();
  });
});

describe("RateLimiter", () => {
  it("allows up to the limit per window, then blocks, then recovers", () => {
    let now = 0;
    const rl = new RateLimiter(3, 1000, () => now);
    expect([1, 2, 3, 4, 5].map(() => rl.hit("k"))).toEqual([true, true, true, false, false]);
    expect(rl.hit("other")).toBe(true);
    now = 1001;
    expect(rl.hit("k")).toBe(true);
  });
});
