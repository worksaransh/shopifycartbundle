# CLIENT GUIDE: setting BundleKit up for a new store

For an account manager. About 15 minutes. Not yet timed with a person who has not seen the app.

## 0. Before you start

- Install the app from your link and open it from Shopify admin (Apps > BundleKit).
- In Shopify admin: Online Store > Themes > Customize > App embeds, turn on **BundleKit cart**. Back in the app, press **I did this**.

## 1. Bundle (about 1 minute)

1. Bundles > Create bundle. Pick **Fixed bundle**, Next.
2. Pick 2 or more products, Next. (Mix and match: pick one collection and how many items shoppers choose.)
3. Leave the discount at 15% or change it. The preview shows the shopper's card. **Save and activate**.
4. Theme editor > open a product page > add the **Bundle** block. Save.
   Shoppers add all items with one button. If any item is removed from the cart, the discount disappears at checkout.

## 2. Volume discount

Volume discounts > pick products (or one collection) > keep or edit the tiers (at least 2, quantities rising) > Save and activate.
Add the **Volume tiers** block to the product page. Dates use the store's time zone and include both days.
Items inside a complete bundle do not also get a volume discount unless you turn on stacking.

## 3. Cart upsell

Cart upsell > pick the trigger product or collection > pick up to 3 offer products > optional discount percent > Save and activate.
Offers are never pre-selected. They hide when already in the cart.

## 4. Free-shipping bar

Settings > turn on the bar > enter the same amount as the free-shipping rate in Shopify > Save settings.
The bar hides for carts in another currency.

## 5. Check it works

- Open the store in a private window, add a bundle, open the cart and check out as far as the payment step: the discount is shown there.
- Settings > **Turn all features off** is the emergency switch. It hides every widget; checkout discounts are unaffected.

## Troubleshooting

| Symptom                            | Likely cause                                                                    | Fix                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Banner "Your changes are not live" | Shopify was busy or rejected an update                                          | Press **Retry**; read the message in the banner                                                  |
| Bundle block shows nothing         | Product has no active bundle, one item is missing, or kill switch is on         | Check Bundles status; Settings emergency switch                                                  |
| Shipping bar or upsells missing    | App embed off, or theme not recognised                                          | Turn on the embed; Settings > Cart container selector                                            |
| Discount missing at checkout       | Bundle incomplete, bundle paused, or another product discount on the same lines | Check the cart has every item; BundleKit does not combine with other product discounts by design |
| "Rules too large" on save          | Too many active rules for the checkout budget                                   | Pause a rule you do not need                                                                     |
| Wrong discount reported            | See RUNBOOK "Client reports a wrong discount"                                   |                                                                                                  |
