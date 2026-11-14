# BundleKit

Shopify app combining product bundles, volume discounts, cart upsells and a free-shipping bar. Built as a custom
(unlisted) app first; listing path stays open.

- Product spec and UX rules: [docs/UX_SPEC.md](docs/UX_SPEC.md)
- Decisions and versions: [docs/DECISIONS.md](docs/DECISIONS.md)
- Deploy, env vars, rollback: [docs/RUNBOOK.md](docs/RUNBOOK.md)
- Deferred ideas: [docs/BACKLOG.md](docs/BACKLOG.md)

## Quick start

```bash
cp .env.example .env && npm install
npx prisma migrate deploy && npm run db:seed
npm run dev
```

Checks: `npm run lint && npm run format:check && npm run typecheck && npm test`

Status: Phase 1 (pricing core and metafield sync). No storefront or Function yet.

Packages: `packages/pricing` (pure money math), `packages/config-schema` (metafield contract).
