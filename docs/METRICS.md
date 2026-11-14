# METRICS

Every number on the Home screen, how it is computed, and what it does NOT mean. Code: `app/services/analytics/metrics.ts`
(pure functions, unit-tested against a hand-calculated 10-order scenario in `tests/analytics/pipeline.test.ts`).

All money is integer minor units (never floats). Days are UTC calendar days (a shop-timezone rollup is a follow-up).

| Metric                   | Formula                                                                                         | Notes                                                                                                                                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attributed revenue       | Sum over attribution rows of (line price x quantity minus that line's discounts), minus refunds | Only lines our Function actually discounted (discount > 0) AND whose `_bundle_id` / `_upsell_id` is a real bundle / upsell rule of this shop. Volume lines are matched by the discount's title ("Volume discount N%"). A forged property earns nothing. |
| Bundle orders            | Count of distinct orders with at least one BUNDLE attribution row                               |                                                                                                                                                                                                                                                         |
| Upsell acceptance rate   | `upsell_added / upsell_viewed` (beacon counts)                                                  | A rate of widget interactions, not of orders. `No data` when nothing was shown.                                                                                                                                                                         |
| Tier uptake              | Count of `tier_selected` events                                                                 | Shows tapping a tier, not buying at it.                                                                                                                                                                                                                 |
| Shipping bar completions | Count of `shipping_bar_completed` events                                                        | Once per page load.                                                                                                                                                                                                                                     |
| AOV with / without       | Mean order total of orders where `touched` (at least one attributed line) vs not                | Order totals are reduced by refunds.                                                                                                                                                                                                                    |
| AOV difference           | `(AOV with - AOV without) / AOV without`                                                        | Shown only with at least 20 orders on BOTH sides ("Not enough data yet" otherwise). **Correlation, not proof of lift**: shoppers who choose a bundle may already spend more.                                                                            |

## Integrity rules

- Duplicate webhook deliveries never double count: rows are keyed (shop, order, source, ref) and created if missing; the
  webhook id is also deduplicated.
- A redelivered `orders/paid` never undoes a refund applied in between.
- Refunds reduce attributed revenue and the order total, never below zero; a refund for an order we never recorded is ignored.

## Not verified on a real store (do this with the first orders)

1. Line properties starting with `_` appear in the `orders/paid` payload.
2. The volume discount's application title starts with "Volume discount".
3. The order webhooks are delivered (protected customer data access may be required for order webhooks on your app type).
