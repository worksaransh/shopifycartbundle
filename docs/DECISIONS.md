# DECISIONS

What we chose and why. Newest at the bottom of each section. Versions verified 2026-11-14 against shopify.dev
(docs search) and the npm registry.

## Versions

| Item              | Chosen                                                    | Source / note                                                                                                                                                                                                                                     |
| ----------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin GraphQL API | **2026-10**                                               | shopify.dev/docs/api/admin-graphql/2026-10 is the current reference root; the official template pins `ApiVersion.October26`. Single constant: `apiVersion` in `app/shopify.server.ts`; must match `[webhooks] api_version` in `shopify.app.toml`. |
| Functions API     | **2026-07 (provisional)**                                 | Docs surfaced `functions/2026-07`, `2026-01`, `unstable`. 2026-10 not seen. **Re-verify with `shopify app generate extension` in Phase 2 and update here.**                                                                                       |
| Discount target   | `cart.lines.discounts.generate.run`                       | Unified product/order/shipping operations. Legacy `product_discounts`/`order_discounts` targets are not used.                                                                                                                                     |
| App template      | Shopify official React Router template                    | `@shopify/shopify-app-react-router` **^3.0.1** (template pin). npm `latest` is 4.0.3; we stay on the template's major until Phase 8 dependency review.                                                                                            |
| Auth              | Managed install + token exchange, expiring offline tokens | `future.expiringOfflineAccessTokens: true` (template default). No custom OAuth.                                                                                                                                                                   |
| Prisma            | **6.x** (`^6.19`)                                         | `@shopify/shopify-app-session-storage-prisma` ^11 targets it. npm `latest` tag is an 8.0 release candidate, which we do not use. Migrate to a Prisma config file before moving to 7+.                                                             |
| Node              | >=22.12                                                   | Template `engines`.                                                                                                                                                                                                                               |
| React Router      | 7.18.2 (template pin)                                     |                                                                                                                                                                                                                                                   |
| Test              | vitest 3, fast-check (Phase 1)                            |                                                                                                                                                                                                                                                   |
| Validation / logs | zod 4, pino 10                                            |                                                                                                                                                                                                                                                   |

## Scopes (minimum, each justified)

`read_products,write_products,read_orders,write_discounts`

- `read_products`: resource picker and product/variant lookups for bundle and rule setup.
- `write_products`: **provisional.** Needed to write product-level metafields (`$app:bundlekit` `bundles`/`volume`) with
  `metafieldsSet`. Phase 1 will test whether app-reserved namespaces can be written without it; if so, drop it.
- `read_orders`: `orders/paid` and `refunds/create` attribution. Limitation: only the last 60 days are readable.
  `read_all_orders` is NOT requested; historic backfill is out of scope for v1.
- `write_discounts`: create/update/pause the automatic app discount (`discountAutomaticAppCreate`).
- Not requested: `read_themes` (embed-activation check uses manual confirm fallback until verified), customer scopes
  (we store no customer data), `read_all_orders`.

## Data and security

- **Postgres via Prisma.** Supabase in prod: pooled `DATABASE_URL` for runtime, `DIRECT_URL` for migrations.
- **WebhookReceipt** keyed by `X-Shopify-Webhook-Id`, with `shopDomain` as a plain string instead of a Shop FK, so
  receipts survive `shop/redact` deleting Shop rows. Receipt is written _after_ the handler succeeds; handlers are
  therefore idempotent by construction (deleteMany/updateMany), and a crash mid-handler is retried by Shopify.
- **Tokens encrypted at rest.** The template stores `accessToken`/`refreshToken` in `Session`. `EncryptedSessionStorage`
  (AES-256-GCM, key `TOKEN_ENCRYPTION_KEY`) wraps the Prisma storage. Rows written before the key existed are read as-is.
  Rotation procedure is in RUNBOOK.
- **Logging.** pino with redaction of tokens, auth headers, HMAC header and emails. Privacy webhook payloads are never logged.
- **HMAC.** Every webhook route calls `authenticate.webhook`, which verifies the HMAC and throws 401 on mismatch.
  Tested for all five webhook routes.
- **Shop upsert** happens in the `afterAuth` hook (runs on install via token exchange).
- Webhooks are declared in `shopify.app.toml` only (app-specific subscriptions), including the three compliance topics.
  The template's demo `products/update` event subscription was removed.

## Open items (carry forward)

- Function language (Rust vs JS): decide in Phase 2 with measured wasm size and instruction count; template sample
  shows ~19k instructions for a trivial Rust Function.
- Metafield size cap and Function input limits: measure in Phase 1; document the cap here.
- Combined-discount behaviour (`combinesWith`): decide in Phase 2 and test against merchant discount codes.
- Theme-extension JS: Shopify suggests <=10 KB compressed per schema-referenced file; our 30 KB total budget is split
  across files accordingly.
