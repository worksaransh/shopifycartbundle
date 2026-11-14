import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "s".repeat(40);
vi.mock("../app/db.server", () => ({ default: { shop: { findMany: vi.fn().mockResolvedValue([]) } } }));
vi.mock("../app/services/sync/repo.server", () => ({
  reconcileShopMetafields: vi.fn().mockResolvedValue(null),
}));

const call = async (headers: Record<string, string>, secret: string | undefined) => {
  vi.resetModules();
  if (secret) process.env.CRON_SECRET = secret;
  else delete process.env.CRON_SECRET;
  const { action } = await import("../app/routes/api.jobs.reconcile");
  return action({
    request: new Request("https://x.example/api/jobs/reconcile", { method: "POST", headers }),
    params: {},
    context: {},
  } as never);
};

beforeEach(() => vi.clearAllMocks());

describe("POST /api/jobs/reconcile", () => {
  it("is disabled (404) when CRON_SECRET is not set", async () => {
    expect((await call({ authorization: `Bearer ${SECRET}` }, undefined)).status).toBe(404);
  });
  it("rejects missing and wrong secrets with 401", async () => {
    expect((await call({}, SECRET)).status).toBe(401);
    expect((await call({ authorization: "Bearer wrong" }, SECRET)).status).toBe(401);
    expect((await call({ authorization: `Bearer ${SECRET}x` }, SECRET)).status).toBe(401);
  });
  it("accepts the right secret", async () => {
    const res = await call({ authorization: `Bearer ${SECRET}` }, SECRET);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ shops: 0, results: {} });
  });
});
