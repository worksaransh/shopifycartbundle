import "@shopify/shopify-app-react-router/adapters/node";
import { ApiVersion, AppDistribution, shopifyApp } from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { env } from "./lib/env.server";
import { EncryptedSessionStorage } from "./lib/session-storage.server";

const e = env();

const shopify = shopifyApp({
  apiKey: e.SHOPIFY_API_KEY,
  apiSecretKey: e.SHOPIFY_API_SECRET,
  // One constant for the Admin API version. Keep in sync with shopify.app.toml [webhooks].
  apiVersion: ApiVersion.October26,
  scopes: e.SCOPES.split(","),
  appUrl: e.SHOPIFY_APP_URL,
  authPathPrefix: "/auth",
  sessionStorage: new EncryptedSessionStorage(new PrismaSessionStorage(prisma), e.TOKEN_ENCRYPTION_KEY),
  distribution: AppDistribution.AppStore,
  future: { expiringOfflineAccessTokens: true },
  hooks: {
    // Runs after token exchange on install. Shop row is the tenant root for all app tables.
    afterAuth: async ({ session }) => {
      await prisma.shop.upsert({
        where: { domain: session.shop },
        create: { domain: session.shop },
        update: { uninstalledAt: null },
      });
    },
  },
});

export default shopify;
export const apiVersion = ApiVersion.October26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
