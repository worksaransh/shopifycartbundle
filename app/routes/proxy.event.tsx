import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { RateLimiter } from "../lib/rate-limit.server";
import { authenticate } from "../shopify.server";
import { recordEvents } from "../services/analytics/events.server";

/**
 * App proxy endpoint for storefront beacons: /apps/bundlekit/event (configured in shopify.app.toml [app_proxy]).
 * The signature is verified by authenticate.public.appProxy (HMAC of the query string with the app secret).
 * Always answers 204 quickly; the shopper's page never waits on or learns anything from this.
 */
const perShop = new RateLimiter(600, 60_000);
const perIp = new RateLimiter(120, 60_000);
const MAX_BYTES = 4096;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request); // throws a 401 Response on a bad signature
  const shopDomain = session?.shop ?? new URL(request.url).searchParams.get("shop");
  if (!shopDomain) return new Response(null, { status: 204 });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!perShop.hit(shopDomain) || !perIp.hit(`${shopDomain}|${ip}`)) {
    return new Response(null, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES)
    return new Response(null, { status: 413 });

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BYTES) return new Response(null, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const shop = await db.shop.findFirst({
    where: { domain: shopDomain, uninstalledAt: null },
    select: { id: true },
  });
  if (shop) await recordEvents(shop.id, body);
  return new Response(null, { status: 204 });
};
