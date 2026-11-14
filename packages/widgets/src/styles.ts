import { BUNDLE_CARD_CSS } from "./bundle-card";

/**
 * Storefront stylesheet (written to extensions/bundlekit-theme/assets/bundlekit.css by scripts/build-storefront.mjs).
 * Rules: theme variables with safe fallbacks, logical properties only (RTL-safe), 44px targets, visible focus,
 * no animation under prefers-reduced-motion.
 */
export const STOREFRONT_CSS = `${BUNDLE_CARD_CSS}
.bk-sr{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.bk-vol,.bk-cart{--bk-accent:var(--color-button,#1a6b4f);--bk-text:var(--color-foreground,#202223);--bk-bg:var(--color-background,#fff);color:var(--bk-text);font:inherit;box-sizing:border-box}
.bk-vol-h{margin-block:0 8px;font-size:1.1em}
.bk-vol-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.bk-tier{display:flex;justify-content:space-between;align-items:center;inline-size:100%;min-block-size:44px;padding-inline:12px;padding-block:8px;border:1px solid color-mix(in srgb,var(--bk-text) 25%,transparent);border-radius:6px;background:var(--bk-bg);color:var(--bk-text);font:inherit;cursor:pointer;text-align:start}
.bk-tier:focus-visible,.bk-oadd:focus-visible,.bk-var:focus-visible{outline:3px solid var(--bk-text);outline-offset:2px}
.bk-tier.bk-active{border-color:var(--bk-accent);box-shadow:inset 0 0 0 2px var(--bk-accent);font-weight:600}
.bk-tag{font-size:.85em}
.bk-ship{padding-block:8px}
.bk-ship-text{margin-block:0 6px;font-size:.95em}
.bk-bar{block-size:8px;border-radius:4px;background:color-mix(in srgb,var(--bk-text) 15%,transparent);overflow:hidden}
.bk-bar>span{display:block;block-size:100%;background:var(--bk-accent)}
.bk-motion .bk-bar>span{transition:inline-size .3s ease}
.bk-done .bk-ship-text{font-weight:600}
.bk-offers{padding-block:8px}
.bk-oh{margin-block:0 8px;font-weight:600}
.bk-olist{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.bk-olist.bk-carousel{grid-auto-flow:column;grid-auto-columns:minmax(240px,80%);overflow-x:auto;scroll-snap-type:x proximity}
.bk-carousel .bk-offer{scroll-snap-align:start}
.bk-offer{display:flex;gap:12px;align-items:center;padding:8px;border:1px solid color-mix(in srgb,var(--bk-text) 20%,transparent);border-radius:6px;background:var(--bk-bg)}
.bk-oimg{inline-size:56px;block-size:56px;object-fit:cover;border-radius:4px;flex:none}
.bk-obody{flex:1;display:grid;gap:2px;min-inline-size:0}
.bk-otitle{font-weight:600;overflow-wrap:anywhere}
.bk-osave{font-size:.85em}
.bk-var{min-block-size:44px;max-inline-size:100%;font:inherit}
.bk-oadd{min-block-size:44px;min-inline-size:44px;padding-inline:16px;border:0;border-radius:6px;background:var(--bk-accent);color:#fff;font:inherit;cursor:pointer}
.bk-oadd[disabled]{opacity:.6;cursor:not-allowed}
.bk-note{margin-block:4px 0}
.bk-mix{display:grid;gap:8px;margin-block:8px;padding:0;list-style:none}
.bk-mix input[type=number]{min-block-size:44px;inline-size:72px;font:inherit}
`;
