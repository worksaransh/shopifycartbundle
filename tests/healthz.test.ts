import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ $queryRaw: vi.fn() }));
vi.mock("../app/db.server", () => ({ default: db }));

import { loader } from "../app/routes/healthz";

describe("/healthz", () => {
  it("is 200 when the database answers", async () => {
    db.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const res = await loader();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
  it("is 503 when the database is down, without leaking details", async () => {
    db.$queryRaw.mockRejectedValue(new Error("connect ECONNREFUSED postgres://user:secret@host"));
    const res = await loader();
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});
