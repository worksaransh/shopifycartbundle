# BACKLOG

Deferred ideas. Anything outside v1 scope goes here and we move on.

v1 scope: bundles (fixed, mix-and-match), volume discounts, cart upsell, free-shipping bar.

Out of scope for v1: AI recommendations, post-purchase upsell pages, subscriptions, multi-currency FX tricks,
A/B testing, loyalty, WhatsApp.

## Ideas

- Cart transform (merge bundle into one line) as an alternative to line-property discounts.
- Historic order backfill (needs `read_all_orders`).
- Upgrade `@shopify/shopify-app-react-router` to v4 and Prisma to 7+ (Phase 8 dependency review).
- Bulk-operation path for syncs touching more than 5,000 products (`bulkOperationRunMutation`).
- Alternative storefront config: one shop-level metafield keyed by product id (and Liquid `product.collections` for
  collection targets). Would remove per-product writes, stale cleanup and the `write_products` scope; limit is 128 KB.
- Per-shop sync lock (advisory lock) so overlapping syncs cannot interleave.
- Trigger.dev adapter for `SyncScheduler` and the daily reconcile cron.
