# RUNBOOK

Phase 0 baseline. Extended in Phase 8 (rollback of last 3 migrations, backups, incident playbooks).

## Environment variables

See `.env.example`. All are validated at boot by `app/lib/env.server.ts`; the app refuses to start with a clear list
of what is wrong.

| Var                                     | Purpose                                                  |
| --------------------------------------- | -------------------------------------------------------- |
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` | From the Partner dashboard app (`shopify app env show`). |
| `SHOPIFY_APP_URL`                       | Public HTTPS URL of the deployed app.                    |
| `SCOPES`                                | Must equal `[access_scopes]` in `shopify.app.toml`.      |
| `DATABASE_URL` / `DIRECT_URL`           | Pooled / direct Postgres URLs.                           |
| `TOKEN_ENCRYPTION_KEY`                  | 32 bytes base64 (`openssl rand -base64 32`).             |
| `LOG_LEVEL`                             | trace..error, silent.                                    |

## Local development

```bash
cp .env.example .env        # fill values
npm install
npx prisma migrate deploy   # or: npm run db:migrate
npm run db:seed             # dev shop with sample rules
npm run dev                 # shopify app dev (needs Shopify CLI login + a dev store)
```

## Deploy

1. `shopify app config link` once (writes `client_id` into `shopify.app.toml`), then set `application_url` and
   `auth.redirect_urls` to the production URL.
2. Set env vars on the host (Vercel or a Node host). The app is stateless.
3. `npm run setup` (`prisma generate && prisma migrate deploy`), then `npm run build && npm start`.
4. `shopify app deploy` to push config (scopes, webhooks) and extensions.

## Rollback

- Code: redeploy the previous build. Config: `shopify app deploy` from the previous commit.
- Database: migrations are forward-only; see Phase 8 for per-migration down scripts.

## Rotating TOKEN_ENCRYPTION_KEY

Not yet supported in code: rotating the key invalidates stored tokens, so merchants re-authenticate via token exchange
on next open (sessions re-created automatically). Procedure: set the new key, `DELETE FROM "Session"`, redeploy.
A dual-key read path is a Phase 8 task.

## Metafield sync

- Status: `Shop.syncStatus` (`SYNCED`, `FAILED`...). A FAILED shop shows a banner with Retry on Home.
- Force a resync for one shop: press Retry in the admin, or call `syncShopMetafields(domain)`.
- Daily drift repair (schedule this; Vercel Cron, GitHub Actions or Trigger.dev all work):

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "https://<app-url>/api/jobs/reconcile"
```

Add `?shop=<domain>` for one shop, `?repair=0` to report drift without fixing it.

- "A client's storefront shows no bundle": check `syncStatus`, run reconcile with `?repair=0` for that shop, read the
  product's `$app:bundlekit` metafields in the Shopify admin (Settings > Custom data) or via GraphQL.

## Dev-store verification checklist (NONE of this has been run yet)

Do this on a development store before any client install. Record pass/fail and the date next to each line.

1. `shopify app config link`, set URLs, `shopify app dev`; app installs and opens Home. Uninstall, reinstall: works.
2. `shopify app function build` succeeds. Note wasm size, input-query cost (limit 30). Run the fixture carts with `shopify app function run`.
3. Create a 2-product fixed bundle in the wizard (time it; target under 90 seconds). Confirm the `BundleKit discounts` automatic discount exists and `$app:bundlekit` / `fn` holds the pack.
4. Product metafields `bundles` / `volume` exist on the products (Settings > Custom data, or GraphQL).
5. Add the Bundle block on a Dawn product page. Add to cart. Checkout shows the bundle discount. Remove one item: the discount disappears.
6. Volume tiers: check just below and at each tier at checkout. Check a date window (start day and end day).
7. Combined codes: bundle + percent code, bundle + free-shipping code, bundle + a merchant product sale. Record what happens.
8. Cart embed: turn it on; drawer and cart page show the bar and upsells on Dawn and on one other free theme. Kill switch hides everything.
9. Place 10 orders including a refund. Compare Home numbers with a hand calculation (METRICS.md). Confirm the three payload assumptions in METRICS.md.
10. Lighthouse on a product page before and after enabling the block (LCP, CLS, TBT); accessibility score 95+ for the block.
11. Keyboard-only add to cart; screen reader announces the result.
12. Uninstall and wait for `shop/redact` (or send a test): shop rows are gone.

## Rollback

- Code: redeploy the previous build; `shopify app deploy` from the previous commit for config and extensions.
- Metafields: reconcile repairs drift: `POST /api/jobs/reconcile?shop=<domain>`.
- Migrations are forward-only SQL in `prisma/migrations`. To undo the last three, restore the pre-deploy backup, or apply these by hand
  (each only adds columns/tables):
  - `20261114040000_order_totals`: `DROP TABLE "OrderTotal";`
  - `20261114030000_upsell_storefront_fields`: `ALTER TABLE "UpsellRule" DROP COLUMN "layout", DROP COLUMN "offerHandles";`
  - `20261114020000_rule_discount_gid`: `ALTER TABLE "Shop" DROP COLUMN "ruleDiscountGid";`
    Then `DELETE FROM "_prisma_migrations" WHERE migration_name = '<name>';` for each one undone. Untested against production data.

## Rotating secrets

- `SHOPIFY_API_SECRET`: rotate in the Partner dashboard, update the env var, redeploy. In-flight webhooks signed with the old secret fail HMAC until redeploy.
- `TOKEN_ENCRYPTION_KEY`: set the new key, `DELETE FROM "Session";`, redeploy; merchants re-authenticate silently on next open.
- `CRON_SECRET`: change the env var and the scheduler's header together.

## Backups

Enable nightly backups on the database host (Supabase: Project > Database > Backups). **Restore test not done.** Before the pilot: restore
the latest backup into a scratch database and run `npx prisma migrate status` and the seed check.

## Client reports a wrong discount

1. Ask for the cart contents (line items and properties) and the discounts shown at checkout.
2. Is a merchant discount code or product sale on the same lines? BundleKit does not combine with other PRODUCT discounts by design.
3. Check the rule pack: Shopify admin > Discounts > BundleKit discounts, or read the `$app:bundlekit` `fn` metafield. Compare with the Bundles/Volume pages (paused or draft rules are not in it).
4. Run `POST /api/jobs/reconcile?shop=<domain>&repair=0`; any drift means sync is behind (check `syncStatus`).
5. Reproduce with the fixture format in `extensions/bundlekit-discount/test/run.test.ts` using the same cart.
6. If the Function is wrong: Settings > emergency switch hides widgets, and pausing rules removes them from the pack. Log it in PILOT_LOG.md.

## Production monitoring (to set up)

`/healthz` uptime monitor, error tracking (Sentry), the alerts in REVIEW.md, and `npm run report -- --shop <domain> --days 7` weekly.
