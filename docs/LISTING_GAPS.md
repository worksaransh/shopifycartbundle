# LISTING GAPS (Phase 10)

Phase 10 is **gated**: it starts only if the pilot gate in PILOT_PLAN.md passes. It has not started, billing is NOT
implemented, and nothing here has been submitted. This lists known gaps against the current requirements
(https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements, read 2026-11-14) so the work is visible.

| Area                      | Requirement                                                                                                                            | State                                                  | Blocking?          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------ |
| Billing                   | 1.2: bill through the Billing API / Shopify App Pricing, upgrade/downgrade without support, free tier + 2 flat tiers with 14-day trial | Not built (by design: gated)                           | Yes                |
| Plan limits in config     | Limits in config, not code                                                                                                             | Not built                                              | Yes                |
| Onboarding                | Setup without our help; manual "I did this" for the embed                                                                              | Partial                                                | Yes                |
| Support entry             | In-app support path                                                                                                                    | Settings shows a placeholder line                      | Yes                |
| Legal                     | Privacy policy and terms pages, listing copy, screenshots, demo store                                                                  | Not done                                               | Yes                |
| Review prompt             | Shown only after a merchant's first successful bundle order                                                                            | Not built                                              | No                 |
| Performance               | Storefront impact numbers (Lighthouse deltas on Dawn and a second theme)                                                               | Not measured. JS budget guard exists (13.8 KB gzipped) | Yes                |
| Reliability evidence      | Webhook and Function error rates over the pilot                                                                                        | Needs pilot data                                       | Yes                |
| Protected customer data   | Order webhooks carry PII; declare access and justification                                                                             | Not done                                               | Yes                |
| Distribution type         | Public distribution is a different app setup from custom                                                                               | Not done                                               | Yes                |
| Error tracking / alerting | Sentry or equivalent, uptime alert on `/healthz`                                                                                       | Not done (needs accounts)                              | Yes                |
| Built for Shopify         | Re-read criteria at that time                                                                                                          | Not assessed                                           | n/a                |
| Dependencies              | `npm audit` findings accepted in SECURITY.md                                                                                           | Re-evaluate                                            | No                 |
| Scale                     | Rule pack is limited to 9,500 bytes (about 10 to 20 rules per shop); needs sharding                                                    | Known limit                                            | For public listing |
