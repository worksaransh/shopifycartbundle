# THEME NOTES: "Kutkut Style - Fusion2 (Draft)"

Read from the theme's own files through the Shopify connection on 2026-11-14 (read-only; nothing was changed in the
store). The app is NOT installed and nothing here has been seen in a browser yet.

## Does BundleKit work in this theme?

Expected yes, with the notes below. It is an Online Store 2.0 theme (JSON templates), so app blocks and the app embed are supported.

| Area               | What the theme has                                                                                                                           | What BundleKit does                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product page       | `templates/product.json` with three **Apps** sections (`"type": "apps"`) below the main product                                              | Add the **Bundle** and **Volume tiers** blocks inside an Apps section. They cannot go inside the buy box (the main-product section lists no app-block slot in its template). |
| Quantity input     | Custom `<quantity-input>` with `[data-quantity-input]`; it fires `change`                                                                    | Volume table listens to it and ignores cart-line quantity inputs (`data-line`). Covered by tests.                                                                            |
| Cart drawer        | `<fusion-cart-drawer id="CartDrawer" data-cart-drawer>`, body `.drawer__body`, re-rendered by `window.Fusion.refreshCart()` (innerHTML swap) | `fusion-drawer` adapter mounts at the top of `.drawer__body`; re-mounts after each swap.                                                                                     |
| Cart page          | `[data-cart-page] .cart-page__main`, refreshes itself on `cart:updated`                                                                      | `fusion-cart-page` adapter; the page adapter wins over the hidden drawer on `/cart`.                                                                                         |
| Adding to cart     | `window.Fusion.cart.add(items)` posts, refreshes the drawer, throws `Error(description)`                                                     | BundleKit uses the theme's own API when present, so the drawer updates; otherwise it posts to `/cart/add.js` and asks the theme to refresh.                                  |
| After a bundle add | Theme opens its drawer on the `cart:open` event                                                                                              | BundleKit fires `cart:open` after a successful add.                                                                                                                          |

## Duplicates to decide on

The theme already ships its own **free-shipping bar** (`settings.cart_free_shipping_enabled`) and **cart upsell**
(`settings.cart_upsell_enabled`). Running both with BundleKit's shows two bars and two upsell lists. Pick one per feature:
turn off the theme setting, or leave BundleKit's shipping bar / upsells unconfigured.

## Risks specific to this store (verify, do not assume)

1. **Third-party checkout.** The store has themes named "fastrr" and "PRAGMA 1Checkout". Fastrr/Shiprocket-style checkouts may not
   apply Shopify automatic discounts, which bundle and volume discounts rely on. Confirm which checkout the live store uses and test
   a bundle through it.
2. **Live theme is a different theme** ("Fv3<>Copy of TF THEME", Techno Flavour based). Its cart markup is unknown. Run the checklist on the
   draft/Dawn first, and read the live theme's cart files before enabling anything there.
3. Dynamic checkout buttons ("Buy it now") on the product page bypass the cart: a bundle is only added by the Bundle block's button.
4. The `bulk_enquiry` block suggests wholesale buyers; check that volume tiers do not conflict with how bulk prices are quoted.
5. Currency is INR; the shipping bar and fixed-amount bundles use shop-currency values, and hide for other presentment currencies.

## How to test safely

Use the unpublished draft theme (or the unpublished stock Dawn) and the theme editor's preview; never publish for the test.
Follow the "Dev-store verification checklist" in RUNBOOK.md on a development store first.
