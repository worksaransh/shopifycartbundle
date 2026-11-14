# PILOT PLAN (Phase 9)

Status: **NOT STARTED.** Needs two real client stores, a deployed app and a Shopify Partner login. Fields marked
`TODO` must be filled with real values before launch; none are invented here.

## Stores

|                          | Store A                                | Store B |
| ------------------------ | -------------------------------------- | ------- |
| Domain                   | TODO                                   | TODO    |
| Typical orders / 30 days | TODO (gate needs 100+ on at least one) | TODO    |
| Theme and version        | TODO (Dawn-based? confirms adapter)    | TODO    |
| Selling currency         | TODO                                   | TODO    |

## What we set up per store (fill with the reason for each choice)

| Feature                 | Store A | Store B | Why                          |
| ----------------------- | ------- | ------- | ---------------------------- |
| Bundles                 | TODO    | TODO    |                              |
| Volume tiers            | TODO    | TODO    |                              |
| Upsell rules            | TODO    | TODO    |                              |
| Free-shipping threshold | TODO    | TODO    | match the real shipping rate |

## Install steps

1. Deploy per RUNBOOK; set `application_url`, redirect URLs and app proxy URL in `shopify.app.toml`; `shopify app deploy`.
2. Create the app distribution as **custom** for each store and send the install link.
3. Complete the **Dev-store verification checklist** (RUNBOOK) on a dev store first. None of it has been run yet.
4. Record the baseline (below) BEFORE enabling any widget.

## Baseline (previous 30 days, per store) -> PILOT_BASELINE.md

Orders, AOV, conversion rate, add-to-cart rate, from Shopify admin or an analytics export.

## Launch checklist

- [ ] Real purchase through the real checkout with a real payment method, then refund it
- [ ] Mobile Safari and Chrome Android checked
- [ ] Kill switch tested (widgets disappear, checkout unaffected)
- [ ] Client told what is changing and how to switch it off
- [ ] `/healthz` monitored and an alert contact set
- [ ] Weekly report scheduled: `npm run report -- --shop <domain> --days 7`

## DECISION GATE (fixed before launch; do not change afterwards)

Continue only if ALL of the following hold at the end of 30 days:

1. On at least ONE store with **100+ orders** in the period, the average order value of orders that touched the app is at
   least **8% higher** than the baseline period's average order value;
2. **No checkout-breaking incident** occurred;
3. The pilot cost **less than 5 hours a week** to support.

Otherwise write a post-mortem and stop. Note the metric caveat in METRICS.md: the comparison is a correlation, and the
gate compares against the BASELINE PERIOD (not against untouched orders in the same period), which also absorbs
seasonality. Record both numbers; the gate uses the baseline-period comparison.

Gate sign-off (date, who, numbers): TODO
