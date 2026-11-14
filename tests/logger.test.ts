import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "../app/lib/logger.server";

function capture() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(c, _e, cb) {
      chunks.push(c.toString());
      cb();
    },
  });
  return { stream, out: () => chunks.join("") };
}

describe("logger redaction", () => {
  it("redacts tokens and emails at top level and one level deep", () => {
    const { stream, out } = capture();
    const log = createLogger({ level: "info", destination: stream });
    log.info({ accessToken: "shpat_secret", session: { refreshToken: "r_secret", email: "a@b.co" } }, "x");
    const line = out();
    expect(line).not.toContain("shpat_secret");
    expect(line).not.toContain("r_secret");
    expect(line).not.toContain("a@b.co");
    expect(line).toContain("[REDACTED]");
  });
  it("redacts sensitive headers", () => {
    const { stream, out } = capture();
    const log = createLogger({ level: "info", destination: stream });
    log.info({ headers: { "x-shopify-access-token": "tok", "x-shopify-hmac-sha256": "sig" } }, "x");
    expect(out()).not.toMatch(/"tok"|"sig"/);
  });
});
