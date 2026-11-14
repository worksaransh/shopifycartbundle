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
  shop: {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    upsert: vi.fn(),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  webhookReceipt: {
    findUnique: vi.fn(),
    create: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
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

  it("customer privacy webhooks acknowledge, record a receipt, and delete nothing (we store no customer data)", async () => {
    const r = await routes();
    for (const [name, topic] of [
      ["dataRequest", "customers/data_request"],
      ["customersRedact", "customers/redact"],
    ] as const) {
      db.webhookReceipt.create.mockClear();
      const res = (await call(
        r[name],
        req(topic, '{"customer":{"id":1,"email":"a@b.co"}}', { id: `id-${name}` }),
      )) as Response;
      expect(res.status).toBe(200);
      expect(db.webhookReceipt.create).toHaveBeenCalledTimes(1);
    }
    expect(db.shop.deleteMany).not.toHaveBeenCalled();
  });

  it("shop/redact deletes every row for that shop (shop cascade, sessions, receipts) and nothing for others", async () => {
    const r = await routes();
    const res = (await call(
      r.shopRedact,
      req("shop/redact", '{"shop_domain":"dev.myshopify.com"}', { id: "id-redact" }),
    )) as Response;
    expect(res.status).toBe(200);
    expect(db.shop.deleteMany).toHaveBeenCalledWith({ where: { domain: SHOP } });
    expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { shop: SHOP } });
    expect(db.webhookReceipt.deleteMany).toHaveBeenCalledWith({ where: { shopDomain: SHOP } });
    expect(db.webhookReceipt.create).not.toHaveBeenCalled(); // no receipt re-created for the deleted shop
    // idempotent: a second delivery just deletes nothing more
    expect(
      ((await call(r.shopRedact, req("shop/redact", "{}", { id: "id-redact-2" }))) as Response).status,
    ).toBe(200);
  });
});

describe("attribution webhooks", () => {
  it("orders/paid and refunds/create reject a bad HMAC with 401 and record nothing", async () => {
    const recorded = vi.fn();
    vi.doMock("../app/services/analytics/attribution.server", () => ({
      recordOrderPaid: recorded,
      recordRefund: recorded,
    }));
    vi.resetModules();
    for (const mod of ["../app/routes/webhooks.orders.paid", "../app/routes/webhooks.refunds.create"]) {
      const { action } = await import(mod);
      let res: unknown;
      try {
        res = await action({
          request: req("orders/paid", "{}", { hmac: "AAAA" }),
          params: {},
          context: {},
        } as never);
      } catch (e) {
        res = e;
      }
      expect((res as Response).status).toBe(401);
    }
    expect(recorded).not.toHaveBeenCalled();
  });
});
