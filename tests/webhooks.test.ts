import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  session: {
    count: vi.fn().mockResolvedValue(0),
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    update: vi.fn(),
  },
  shop: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), upsert: vi.fn() },
  webhookReceipt: { findUnique: vi.fn(), create: vi.fn().mockResolvedValue({}) },
}));
vi.mock("../app/db.server", () => ({ default: db }));

const SECRET = "test-secret";
const SHOP = "dev.myshopify.com";

function req(topic: string, body: string, opts: { id?: string; hmac?: string } = {}) {
  const hmac = opts.hmac ?? createHmac("sha256", SECRET).update(body, "utf8").digest("base64");
  return new Request("https://bundlekit.example.com/webhooks/x", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-shopify-topic": topic,
      "x-shopify-shop-domain": SHOP,
      "x-shopify-hmac-sha256": hmac,
      "x-shopify-webhook-id": opts.id ?? "wh-1",
      "x-shopify-api-version": "2026-10",
    },
  });
}

async function routes() {
  return {
    uninstalled: (await import("../app/routes/webhooks.app.uninstalled")).action,
    dataRequest: (await import("../app/routes/webhooks.customers.data_request")).action,
    customersRedact: (await import("../app/routes/webhooks.customers.redact")).action,
    shopRedact: (await import("../app/routes/webhooks.shop.redact")).action,
  };
}
const call = (action: (a: never) => unknown, request: Request) =>
  action({ request, params: {}, context: {} } as never);

beforeEach(() => {
  vi.clearAllMocks();
  db.webhookReceipt.findUnique.mockResolvedValue(null);
});

describe("webhook HMAC", () => {
  it.each(["uninstalled", "dataRequest", "customersRedact", "shopRedact"] as const)(
    "%s rejects a bad HMAC with 401 and does no work",
    async (name) => {
      const r = await routes();
      let res: unknown;
      try {
        res = await call(r[name], req("app/uninstalled", "{}", { hmac: "AAAA" }));
      } catch (e) {
        res = e; // authenticate.webhook throws a Response on HMAC failure
      }
      expect(res).toBeInstanceOf(Response);
      expect((res as Response).status).toBe(401);
      expect(db.session.deleteMany).not.toHaveBeenCalled();
      expect(db.webhookReceipt.create).not.toHaveBeenCalled();
    },
  );

  it("accepts a valid HMAC and runs the uninstall handler", async () => {
    const r = await routes();
    const res = (await call(r.uninstalled, req("app/uninstalled", "{}"))) as Response;
    expect(res.status).toBe(200);
    expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { shop: SHOP } });
    expect(db.shop.updateMany).toHaveBeenCalled();
    expect(db.webhookReceipt.create).toHaveBeenCalledWith({
      data: { id: "wh-1", topic: "APP_UNINSTALLED", shopDomain: SHOP },
    });
  });
});

describe("webhook idempotency", () => {
  it("skips handler work when the webhook id was already processed", async () => {
    db.webhookReceipt.findUnique.mockResolvedValue({ id: "wh-1" });
    const r = await routes();
    const res = (await call(r.uninstalled, req("app/uninstalled", "{}"))) as Response;
    expect(res.status).toBe(200);
    expect(db.session.deleteMany).not.toHaveBeenCalled();
    expect(db.webhookReceipt.create).not.toHaveBeenCalled();
  });

  it("privacy webhooks acknowledge valid deliveries and record a receipt", async () => {
    const r = await routes();
    for (const [name, topic] of [
      ["dataRequest", "customers/data_request"],
      ["customersRedact", "customers/redact"],
      ["shopRedact", "shop/redact"],
    ] as const) {
      db.webhookReceipt.create.mockClear();
      const res = (await call(
        r[name],
        req(topic, '{"shop_domain":"dev.myshopify.com"}', { id: `id-${name}` }),
      )) as Response;
      expect(res.status).toBe(200);
      expect(db.webhookReceipt.create).toHaveBeenCalledTimes(1);
    }
  });
});
