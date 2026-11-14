# SECURITY (Phase 8 review)

Evidence is by test or by command, not by assertion. Items marked OPEN are not done.

| Area                           | State            | Evidence                                                                                                                 |
| ------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Webhook HMAC                   | Done             | All 7 webhook routes call `authenticate.webhook`; bad HMAC returns 401 and does no work (tests/webhooks.test.ts).        |
| App proxy signature            | Done             | Real HMAC verification; wrong/tampered/missing signature rejected, records nothing (tests/analytics/proxy.test.ts).      |
| Tenant isolation               | Done             | AST test fails CI if any Prisma call on a shop-owned table lacks `shopId` (tests/tenant-scope.test.ts).                  |
| Tokens at rest                 | Done             | AES-256-GCM wrapper over the session store (tests/session-storage.test.ts). Key rotation: see RUNBOOK.                   |
| Logging                        | Done             | pino redaction of tokens, auth headers, HMAC header, emails (tests/logger.test.ts). Webhook payloads are never logged.   |
| Input validation               | Done             | zod on every admin form (server-side) and the beacon; size cap on the beacon body.                                       |
| Rate limiting                  | Partial          | In-memory per instance (per shop 600/min, per IP 120/min). Shared store needed if run on several instances.              |
| Privacy webhooks               | Done             | shop/redact deletes shop rows, sessions, receipts (test). We store no customer data (order GIDs, totals, counters only). |
| Function fails open            | Done             | Any error yields no discount, never a thrown error (20+ fixture carts incl. hostile config).                             |
| CSV export                     | Done             | Cells starting `= + - @` are neutralised.                                                                                |
| Secrets                        | Done             | None in the repo; `.env.example` only; env validated at boot.                                                            |
| CSP / admin headers            | Template default | `addDocumentResponseHeaders` from the Shopify template (frame-ancestors). Not customised.                                |
| Error tracking, uptime, alerts | OPEN             | `/healthz` exists. Sentry (or equivalent) and an uptime monitor need accounts; see RUNBOOK.                              |
| Backups / restore test         | OPEN             | Needs the production database; procedure in RUNBOOK.                                                                     |
| Playwright E2E on a dev store  | OPEN             | Needs a dev store and Shopify CLI login.                                                                                 |
| Per-shop sync lock             | OPEN             | Overlapping syncs are last-write-wins.                                                                                   |

## Dependency audit (`npm audit --omit=dev`, 2026-11-14): 6 findings, all accepted for now

| Package                                     | Severity | Why accepted                                                                                                                                                                      | Revisit                      |
| ------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| prisma, @prisma/config, deepmerge-ts        | high     | Prisma CLI config loading (stack exhaustion on recursive config merges). Runs at migrate/generate time on our own config, never on shopper input. Fix is a breaking Prisma major. | Prisma 7 migration (BACKLOG) |
| @shopify/shopify-app-session-storage-prisma | high     | Only via `prisma` above.                                                                                                                                                          | same                         |
| minimatch, @react-router/fs-routes          | moderate | Glob DoS in build-time route discovery over our own file names. No fix available.                                                                                                 | upstream release             |

`npm audit fix --force` was deliberately not run (breaking major upgrades).

The hostile-reviewer pass is in [REVIEW.md](REVIEW.md).
