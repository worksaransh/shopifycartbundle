import { describe, expect, it } from "vitest";
import { loadEnv } from "../app/lib/env.server";

const good = {
  SHOPIFY_API_KEY: "k",
  SHOPIFY_API_SECRET: "s",
  SHOPIFY_APP_URL: "https://x.example.com",
  SCOPES: "read_products",
  DATABASE_URL: "postgresql://a",
  DIRECT_URL: "postgresql://a",
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
};

describe("loadEnv", () => {
  it("accepts a valid environment", () => {
    expect(loadEnv(good).LOG_LEVEL).toBe("info");
  });
  it("fails fast listing every bad variable", () => {
    expect(() => loadEnv({ ...good, SHOPIFY_API_KEY: "", TOKEN_ENCRYPTION_KEY: "short" })).toThrow(
      /SHOPIFY_API_KEY[\s\S]*TOKEN_ENCRYPTION_KEY/,
    );
  });
});
