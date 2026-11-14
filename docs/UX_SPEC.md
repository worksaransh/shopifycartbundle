# UX_SPEC

Source of truth for every admin screen and storefront widget. Phase prompts refer back to this file.

## Admin screens

| Screen                    | Purpose                                    | Key elements                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home                      | Show setup state and results in 10 seconds | Setup checklist (enable app embed, create first bundle, set shipping bar); 4 KPIs for the last 30 days: attributed revenue, bundle orders, upsell acceptance rate, AOV lift vs prior period  |
| Bundles                   | List and create bundles                    | Table with name, type, products, status, orders, revenue; search; bulk activate or pause; "Create bundle" 3-step wizard                                                                      |
| Bundle wizard             | Create fixed or mix-and-match bundle       | Step 1 type; Step 2 pick products or collection and quantities; Step 3 discount (percent, fixed amount off, or fixed bundle price), title, badge text, live preview card                     |
| Volume discounts          | Tier tables                                | Target (products or collection), 2 to 5 tiers (qty, percent off), preview table, start and end dates                                                                                         |
| Cart upsell               | Rules for add-ons                          | Rule list: trigger (product or collection) to offer (up to 3 products), optional discount, max offers shown, hide if already in cart; layout choice (carousel or stacked)                    |
| Shipping bar and Settings | Threshold and global options               | Threshold amount, message templates with `{amount}` placeholder, success message, colours (3 pickers), position, "Where to enable" deep link to the theme editor app embed, plan and support |

## Storefront widgets

| Widget                | Where                                | Behaviour                                                                                                                                                           |
| --------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bundle block          | Product page (app block)             | Card with product images, "Bundle price" with strikethrough original and saving badge, one add-to-cart button that adds all lines with shared `_bundle_id` property |
| Volume tier table     | Product page (app block)             | Rows for each tier; the active tier highlights as quantity changes; tapping a row sets quantity                                                                     |
| Cart upsell           | Cart drawer or cart page (app embed) | 1 to 3 offer cards, image, title, price, variant select if needed, one-tap "Add"; updates the cart without a page reload and announces via ARIA live region         |
| Shipping progress bar | Top of cart (app embed)              | Bar plus text such as "Add ₹340 more for free shipping"; reaches 100% with a success message; animates only if reduced motion is off                                |

## UX rules (apply to every screen and widget)

1. Admin uses Polaris web components only; no custom CSS frameworks. Empty states always explain the next action with one primary button. Every list has loading skeleton, empty, error and populated states.
2. Forms: inline validation on blur, a sticky Save bar via App Bridge contextual save bar, unsaved-changes guard. Never lose merchant input on error.
3. The bundle wizard must be completable in under 90 seconds for a 2-product fixed bundle. Default every optional field sensibly.
4. Live preview in the wizard renders the same React component the storefront uses (shared package), so merchants see what shoppers see.
5. Storefront copy is short and concrete: "Save 15%" not "Amazing deal". No dark patterns: no fake countdowns, no fake scarcity, no pre-ticked upsells.
6. Every storefront widget degrades safely: if config is missing, JS fails or the product is sold out, render nothing and leave the native cart untouched. Never break checkout.
7. Money display: always from Shopify's formatted money fields or Intl with the cart currency; show tax-inclusive prices if the shop shows them.
8. Touch targets at least 44 px, focus ring visible, all widgets usable at 320 px width, RTL-safe layout using logical CSS properties.
9. Merchant-facing errors say what happened and what to do next ("Bundle needs at least 2 products. Add another product.").
10. Instrument funnel events: `bundle_viewed`, `bundle_added`, `upsell_viewed`, `upsell_added`, `tier_selected`, `shipping_bar_completed`. Batch with `sendBeacon`; no PII.

## Architecture

Config is written once to Shopify metafields and read from there by both the Functions and the storefront widgets, so the app server is never on the render or checkout path. The admin app saves rules to Postgres and syncs them to metafields; Functions and the theme extension read only metafields, and the storefront reports back through beacons and the order webhook.

| Decision          | Choice                                                                                              | Why                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Bundle pricing    | Discount Function keyed on a line property `_bundle_id`; no parent bundle product                   | Works with existing products and variants; no catalogue pollution. Cart transform (merge into one line) stays an option for later |
| Volume tiers      | Discount Function reading tier config from a metafield                                              | Holds at checkout and with any theme                                                                                              |
| Storefront config | Shop and product metafields exposed to Liquid in the theme extension                                | No network call before render, no layout shift                                                                                    |
| Analytics         | Beacons to an app-proxy endpoint plus `orders/paid` webhook                                         | Orders attribute by `_bundle_id` and offer ID on line properties                                                                  |
| Auth              | Shopify managed install with token exchange                                                         | No custom OAuth to maintain                                                                                                       |
| Discount stacking | Declare `combinesWith` explicitly per Function; document the behaviour with merchant discount codes | Stacking surprises are the top support risk in this category                                                                      |

## Data model (Prisma, Postgres)

Implemented in `prisma/schema.prisma`.

| Table            | Key fields                                                                                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shop             | id, domain, installedAt, uninstalledAt, settings (JSON: shipping bar, colours, locale), metafieldSyncedAt                                                                                |
| Bundle           | id, shopId, type (FIXED or MIX_MATCH), title, status, discountType (PERCENT, AMOUNT, FIXED_PRICE), discountValue, items (JSON: product or collection GIDs, quantities), startsAt, endsAt |
| VolumeRule       | id, shopId, targetType (PRODUCT or COLLECTION), targetGids, tiers (JSON: minQty, percentOff), status, startsAt, endsAt                                                                   |
| UpsellRule       | id, shopId, triggerType, triggerGids, offerGids (max 3), discountPercent, maxOffers, hideIfInCart, status                                                                                |
| EventDaily       | shopId, date, eventType, refId, count (roll-up of beacons; no PII)                                                                                                                       |
| OrderAttribution | shopId, orderGid, source (BUNDLE, VOLUME, UPSELL), refId, revenueMinor, currency, createdAt                                                                                              |
| WebhookReceipt   | id, topic, shopId, receivedAt (idempotency). Implemented with `shopDomain` instead of a shopId FK; see DECISIONS.md                                                                      |

Every write to Bundle, VolumeRule, UpsellRule or Shop settings must end by syncing the relevant metafields, in one transaction-like step with a retry job and a visible "sync failed" state in the admin.
