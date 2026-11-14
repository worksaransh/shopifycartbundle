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
- `write_products`: **confirmed required (Phase 1).** `metafieldsSet` "requires the same access level needed to mutate the
  owner resource" (docs), so product-level metafields (`bundles`/`volume`) need it. Alternative that would drop the scope:
  one shop-level metafield keyed by product (see BACKLOG).
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

## Phase 1: pricing core and metafield sync

**Rounding rule** (`packages/pricing/src/money.ts`): all money is integer minor units; every division rounds half up;
a total split across lines gives each line its rounded share, then the remainder is settled from the last line
backwards (never exceeding a line's cap), so line discounts always sum to the total exactly. Multiply-then-divide uses
BigInt to avoid float error on large amounts. Property tests (fast-check, 500 runs each) cover: discount never exceeds a
line total, totals reconcile, highest satisfied tier wins regardless of order, FIXED_PRICE never raises the price,
zero-quantity / missing-variant / wrong-bundle-id lines never discount.

**Bundle semantics** (`computeBundleDiscount`): lines are grouped by `_bundle_id`; each line is assigned to the first
matching component; `instances = min(floor(units / required))`; only `instances * required` units per component are
discounted (extra units stay full price). Incomplete bundle = no discount. AMOUNT and FIXED_PRICE values are per
bundle instance.

**Metafield contract** (`packages/config-schema`): namespace `$app:bundlekit`, every payload carries `schemaVersion: 1`,
readers return null on unknown versions or bad shapes (fail safe). Keys: Shop `config`; Product `bundles`, `volume`;
discount node `fn`.

**Size limits (verified in docs 2026-11-14):**

- json metafield max **128 KB** (2 MB global). Storefront payloads are capped at 100,000 bytes and fail loudly at save.
- **Functions receive `null` for any metafield value over 10,000 bytes.** So Function config is NOT one shared blob.
  Decision: **one automatic discount node per bundle / volume rule**, each with its own `fn` metafield (cap 9,500 bytes).
  Worst-case schema-valid configs are about 4-5 KB (tested), so the cap cannot be hit through the UI.
- Function input queries have a max cost of 30; each metafield read costs 3, so we read exactly one (`discountNode.metafield`).
- Consequence to verify in Phase 2: Shopify limits how many active automatic app discounts a shop can have. If the
  limit is small, shops with many rules will hit it. Phase 2 must measure it and, if needed, pack several small rules per node.
- Per product: max 20 bundles and 10 volume rules (schema). A sync touching more than **5,000 products** fails with a
  clear message; the bulk-operation path is in BACKLOG.

**Sync design:** DB is the source of truth. `syncShop` computes the desired metafields (pure `buildDesired`), writes them
with `metafieldsSet` in batches of 25 (API maximum), and deletes metafields that no longer apply
(`metafieldsDelete`, also 25 per call, tracked via `Shop.syncedProductGids`). Collections are expanded to product ids
with paginated queries. Retry: HTTP 429 / 5xx / network errors / GraphQL `THROTTLED` with exponential backoff, jitter,
`Retry-After` and the throttle cost hint; 4xx and `userErrors` are never retried. Status lives on `Shop.syncStatus`
(`IDLE|SYNCING|SYNCED|FAILED`) with a merchant-readable `syncError`; Home shows a banner with a Retry button.
Reconciliation (`reconcileShop`) compares desired vs actual (JSON-normalised), repairs missing / changed / stale values,
and only touches products we know about.

**Trigger.dev: deferred.** It needs an account and project key that this environment does not have. The retry job is a
`SyncScheduler` interface (default no-op) so Trigger.dev can implement `scheduleRetry` later without touching the sync
code; until then FAILED state + the Retry button + `POST /api/jobs/reconcile` (Bearer `CRON_SECRET`, callable from any
scheduler) cover the same ground. Concurrent syncs for one shop are last-write-wins; a lock is a Phase 8 item.

**Not machine-validated:** the GraphQL documents in `app/services/sync/queries.ts`. The schema tool confirmed
`metafieldsDelete(metafields: [MetafieldIdentifierInput!]!)` and that `Shop` has `id` and `metafield`; the full documents
could not be validated here, so the first dev-store run must confirm them. Shop config is read with `shop { }`, not `nodes`.

## Phase 2: discount Function and bundle wizard

**One rule pack per shop (supersedes the Phase 1 "one node per rule" idea).** Docs: a store can have at most **25 active
discount functions across all apps**, and they run with no knowledge of each other. One node per bundle would burn the
merchant's whole budget. So there is ONE automatic discount node per shop (`Shop.ruleDiscountGid`) whose `fn` metafield
holds a rule pack: all active bundles, volume rules and discounted upsells. One run also lets us resolve conflicts in
one place. Cost: the pack shares a **9,500-byte budget** (Functions get `null` above 10,000). A realistic pack of 10
bundles + 2 volume rules + 1 upsell is well under it; 45 bundles fail save with a clear message. Sharding across
several nodes is in BACKLOG for listing scale.

**Function language: JavaScript.** It imports `packages/pricing` directly, so the checkout math and the storefront
preview are the same code (property-tested). Trade-off: JS Functions cost more instructions than Rust (docs sample:
about 45k vs 19k for a trivial Rust Function; limits are far higher). `mulDivRoundHalfUp` uses plain numbers for all
realistic amounts and only falls back to BigInt beyond 2^53, since we have not confirmed BigInt in the Function runtime.
zod is kept out of the Function; the pack is validated on write and only lightly checked on read.

**Fail open.** `cartLinesDiscountsGenerateRun` wraps everything in try/catch: bad config, version mismatch or an
unparsable price means no discount, never an error that could block checkout. Tested (20 fixture carts).

**Conflict rules** (`computeCartDiscounts`, tested): bundles first; volume tiers skip lines in a complete bundle unless
the merchant enables `stackVolumeWithBundles` (default off), in which case the volume discount is capped at what is left
of the line; a line gets at most one volume rule; upsell discounts need a matching `_upsell_id` AND an offered product
and are skipped if the line already has a discount (so a forged id on another product gets nothing). Per line the total
never exceeds the line total.

**Collections.** Membership uses `inCollections(ids: $collectionIds)` with the pack's `collectionIds` as an input
variable (`input_variables` in the toml). A bundle may have at most one collection component, because `inCollections`
cannot say which collection a second component meant.

**Currency.** Cart amounts are presentment currency. PERCENT bundles work in any currency. AMOUNT and FIXED_PRICE values
are stored in the shop currency, so they are skipped for carts in another currency (no FX tricks, per scope). Exponent
table in `packages/pricing/src/currency.ts` (0, 2 or 3 decimals).

**combinesWith.** The discount node combines with ORDER and SHIPPING discounts (merchant free-shipping and order codes
keep working) but not other PRODUCT discounts, so a merchant sale and a bundle never compound on one line by surprise.
Revisit if a client wants the opposite.

**Function toml and build are unverified.** `export = "cart-lines-discounts-generate-run"`, the JS entry and
`build.command` follow the docs pattern but have not been run through `shopify app function build` (no CLI auth here).
The first dev-store run must confirm the build, the wasm size, the input-query cost (limit 30; the query has one
`inCollections` and one metafield read, estimated well under) and that `$app:bundlekit` resolves in
`discountAutomaticAppCreate.metafields`.

**Wizard.** Fixed bundle: 2+ distinct products. Mix-and-match: one collection and a quantity of at least 2. Server
validation (zod) is authoritative; inline validation reuses the same schema on blur. The preview calls the shared
`renderBundleCard` (packages/widgets), the same function the storefront block will use. The 90-second target is NOT
measured (no store); defaults are chosen so a fixed bundle is: pick products, Next, Save.

**Embed check.** Detecting the app embed via API needs `read_themes`, which we do not request. Home uses a manual
"I did this" confirmation (stored in `Shop.settings.setup`).

## Open items (carry forward)

- Combined-discount behaviour with real merchant discount codes: unit tests cannot cover Shopify's combination engine; test on a dev store.
- Theme-extension JS: Shopify suggests <=10 KB compressed per schema-referenced file; our 30 KB total budget is split
  across files accordingly.
