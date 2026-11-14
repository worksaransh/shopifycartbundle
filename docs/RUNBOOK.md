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
