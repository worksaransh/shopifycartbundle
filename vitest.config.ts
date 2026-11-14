import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "packages/**/*.test.ts", "extensions/**/*.test.ts"],
    environment: "node",
    env: {
      NODE_ENV: "test",
      SHOPIFY_API_KEY: "test-key",
      SHOPIFY_API_SECRET: "test-secret",
      SHOPIFY_APP_URL: "https://bundlekit.example.com",
      SCOPES: "read_products,write_products,read_orders,write_discounts",
      DATABASE_URL: "postgresql://u:p@localhost:5432/test",
      DIRECT_URL: "postgresql://u:p@localhost:5432/test",
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      LOG_LEVEL: "silent",
    },
  },
});
