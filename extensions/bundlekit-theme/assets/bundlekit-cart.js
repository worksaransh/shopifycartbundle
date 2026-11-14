"use strict";
(() => {
  var we = Object.defineProperty;
  var Te = (e, t, n) =>
    t in e ? we(e, t, { enumerable: !0, configurable: !0, writable: !0, value: n }) : (e[t] = n);
  var Z = (e, t, n) => Te(e, typeof t != "symbol" ? t + "" : t, n);
  function ee(e, t = {}) {
    var I, x;
    let n =
        (I = t.send) != null
          ? I
          : (f, u) =>
              typeof navigator != "undefined" && navigator.sendBeacon ? navigator.sendBeacon(f, u) : !1,
      r = (x = t.schedule) != null ? x : (f, u) => setTimeout(f, u),
      s = new Map(),
      c = new Set(),
      l = null,
      p = () => {
        if (((l = null), !e || s.size === 0)) {
          s.clear();
          return;
        }
        let f = [...s.values()].slice(0, 20);
        s.clear();
        try {
          n(e, new Blob([JSON.stringify({ events: f })], { type: "application/json" }));
        } catch {}
      },
      i = (f, u) => {
        if (!e) return;
        let h = `${f}|${u != null ? u : ""}`,
          R = s.get(h);
        (R ? R.n++ : s.set(h, { t: f, ...(u ? { r: u.slice(0, 64) } : {}), n: 1 }),
          s.size >= 20 ? p() : l === null && (l = r(p, 3e3)));
      };
    return (
      typeof document != "undefined" &&
        (document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && p()),
        window.addEventListener("pagehide", p)),
      {
        track: i,
        once(f, u) {
          let h = `${f}|${u != null ? u : ""}`;
          c.has(h) || (c.add(h), i(f, u));
        },
        flush: p,
      }
    );
  }
  var z = Object.freeze({ totalMinor: 0, lineDiscounts: [] });
  function A(e) {
    return typeof e == "number" && Number.isSafeInteger(e) && e >= 0;
  }
  function te(e, t, n) {
    if (!(A(e) && A(t) && A(n)) || n === 0) throw new RangeError("mulDivRoundHalfUp: bad operands");
    let r = 2 * e * t + n;
    return Number.isSafeInteger(r)
      ? Math.floor(r / (2 * n))
      : Number((BigInt(2) * BigInt(e) * BigInt(t) + BigInt(n)) / (BigInt(2) * BigInt(n)));
  }
  function C(e, t) {
    if (!Number.isInteger(t) || t < 0 || t > 100) throw new RangeError("percent must be an integer 0-100");
    return te(e, t, 100);
  }
  var Xe = { ...z, instances: 0, coveredUnits: {} };
  function re(e, t) {
    let n = { enabled: !1, remainingMinor: 0, percent: 0, complete: !1 };
    if (!Number.isSafeInteger(t) || t <= 0 || !Number.isSafeInteger(e) || e < 0) return n;
    let r = e >= t;
    return {
      enabled: !0,
      complete: r,
      remainingMinor: r ? 0 : t - e,
      percent: r ? 100 : Math.floor((e * 100) / t),
    };
  }
  function ie(e, t, n, r = 3) {
    let s = [],
      c = new Set();
    for (let l of e) {
      if (!l.triggerProductIds.some((i) => t.has(i))) continue;
      let p = 0;
      for (let i of l.offerIds) {
        if (s.length >= r || p >= l.maxOffers) break;
        c.has(i) ||
          n.get(i) !== !0 ||
          (l.hideIfInCart && t.has(i)) ||
          (c.add(i), s.push({ ruleId: l.id, productId: i }), p++);
      }
    }
    return s;
  }
  var Ce = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" },
    b = (e) => e.replace(/[&<>"']/g, (t) => Ce[t]),
    _ = (e, t, n) => {
      var s;
      let r =
        (s = new Intl.NumberFormat(n, { style: "currency", currency: t }).resolvedOptions()
          .maximumFractionDigits) != null
          ? s
          : 2;
      return new Intl.NumberFormat(n, { style: "currency", currency: t }).format(e / 10 ** r);
    };
  var oe = `
.bk-card{--bk-accent:var(--color-button,#1a6b4f);--bk-text:var(--color-foreground,#202223);--bk-bg:var(--color-background,#fff);
  color:var(--bk-text);background:var(--bk-bg);border:1px solid color-mix(in srgb,var(--bk-text) 20%,transparent);
  border-radius:8px;padding-inline:16px;padding-block:16px;max-inline-size:100%;box-sizing:border-box;font:inherit}
.bk-title{margin-block:0 8px;font-size:1.1em}
.bk-badge{display:inline-block;padding-inline:8px;padding-block:2px;border-radius:4px;background:var(--bk-accent);color:#fff;font-size:.85em}
.bk-items{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.bk-item{display:flex;align-items:center;gap:12px}
.bk-img{inline-size:64px;block-size:64px;object-fit:cover;border-radius:4px;background:color-mix(in srgb,var(--bk-text) 8%,transparent);flex:none}
.bk-price{margin-block:12px 0}
.bk-was{opacity:.75}
.bk-now{font-size:1.2em}
.bk-save{font-weight:600}
.bk-note{margin-block:4px 0;font-size:.85em;opacity:.8}
.bk-add{margin-block-start:12px;min-block-size:44px;inline-size:100%;border:0;border-radius:6px;background:var(--bk-accent);color:#fff;font:inherit;cursor:pointer}
.bk-add:focus-visible{outline:3px solid var(--bk-text);outline-offset:2px}
.bk-add[disabled]{opacity:.6;cursor:not-allowed}
@media (prefers-reduced-motion:reduce){.bk-card *{transition:none!important;animation:none!important}}
`.trim();
  var se = {
      "bundle.price": "Bundle price",
      "bundle.save": "Save {percent}%",
      "bundle.add": "Add bundle to cart",
      "bundle.added": "Bundle added to cart",
      "bundle.soldOut": "One item in this bundle is sold out",
      "bundle.error": "Could not add the bundle. Try again.",
      "price.atCheckout": "Price at checkout",
      "volume.heading": "Buy more, save more",
      "volume.row": "Buy {qty}+ and save {percent}%",
      "volume.selected": "{qty} selected",
      "upsell.heading": "Add to your order",
      "upsell.add": "Add",
      "upsell.added": "{title} added to your cart",
      "upsell.error": "Could not add {title}. Try again.",
      "upsell.save": "Save {percent}%",
      "shipping.progress": "Add {amount} more for free shipping",
      "shipping.success": "You've unlocked free shipping",
    },
    Pe = Object.keys(se);
  function ae(e) {
    let t = { ...se };
    for (let n of Pe) {
      let r = e == null ? void 0 : e[n];
      typeof r == "string" && r.trim() && (t[n] = r);
    }
    return t;
  }
  function P(e, t = {}) {
    return e.replace(/\{(\w+)\}/g, (n, r) => (r in t ? String(t[r]) : n));
  }
  var Rt = `${oe}
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
  var q = (e, t) => {
      for (let n of t) {
        let r = e.querySelector(n);
        if (r) return r;
      }
      return null;
    },
    De = {
      name: "dawn-drawer",
      find: (e) => q(e, ["cart-drawer .drawer__inner", "cart-drawer"]),
      sections: ["cart-drawer", "cart-icon-bubble"],
    },
    Le = {
      name: "dawn-cart-page",
      find: (e) => q(e, ["cart-items", "#main-cart-items", ".cart__items"]),
      sections: ["main-cart-items", "cart-icon-bubble", "main-cart-footer"],
    },
    Be = {
      name: "legacy-drawer-or-form",
      find: (e) =>
        q(e, [
          "#CartDrawer",
          ".js-drawer-cart",
          ".ajax-cart__drawer",
          ".cart-drawer",
          'form[action="/cart"]',
        ]),
    };
  function Oe(e) {
    return e
      ? {
          name: "generic-selector",
          find: (t) => {
            try {
              return t.querySelector(e);
            } catch {
              return null;
            }
          },
        }
      : null;
  }
  function ce(e, t) {
    let n = [Oe(t), De, Le, Be].filter((r) => !!r);
    for (let r of n) {
      let s = r.find(e);
      if (s) return { adapter: r, host: s };
    }
    return null;
  }
  async function le(e, t, n = fetch) {
    if (t != null && t.length)
      try {
        let r = await n(`/?sections=${t.join(",")}`, { headers: { Accept: "application/json" } });
        if (!r.ok) return;
        let s = await r.json();
        for (let c of t) {
          let l = e.getElementById(`shopify-section-${c}`),
            p = s[c];
          if (!l || !p) continue;
          let i = new DOMParser().parseFromString(p, "text/html").querySelector(".shopify-section");
          i && (l.innerHTML = i.innerHTML);
        }
      } catch {}
  }
  var N = class extends Error {
    constructor(n, r) {
      super(n);
      Z(this, "status", r);
    }
  };
  async function ue(e, t = fetch) {
    let n = await t("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ items: e }),
    });
    if (!n.ok) {
      let r = `HTTP ${n.status}`;
      try {
        let s = await n.json();
        r = s.description || s.message || r;
      } catch {}
      throw new N(r, n.status);
    }
  }
  async function de(e = fetch) {
    let t = await e("/cart.js", { headers: { Accept: "application/json" } });
    if (!t.ok) throw new N(`HTTP ${t.status}`, t.status);
    return await t.json();
  }
  function pe(e = document) {
    for (let t of ["bundlekit:cart-updated", "cart:refresh", "cart:updated"])
      e.dispatchEvent(new CustomEvent(t, { bubbles: !0 }));
  }
  var fe = (e, t) => `gid://shopify/${e}/${t}`;
  function V(e) {
    try {
      e();
    } catch {}
  }
  var $e =
    "position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap";
  function me(e) {
    let t = e.querySelector("[data-bk-status]");
    (t ||
      ((t = e.ownerDocument.createElement("div")),
      t.setAttribute("data-bk-status", ""),
      (t.style.cssText = $e),
      e.appendChild(t)),
      t.setAttribute("role", "status"),
      t.setAttribute("aria-live", "polite"),
      t.setAttribute("tabindex", "-1"));
    let n = t;
    return (r, s) => {
      ((n.textContent = ""),
        setTimeout(() => {
          ((n.textContent = r), s != null && s.focus && n.focus());
        }, 20));
    };
  }
  var be = (e = window) => {
    var t;
    return !!((t = e.matchMedia) != null && t.call(e, "(prefers-reduced-motion: reduce)").matches);
  };
  function ge(e) {
    try {
      return e != null && e.textContent ? JSON.parse(e.textContent) : null;
    } catch {
      return null;
    }
  }
  var Ae = "data-bk-cart-root";
  function ye(e, t = {}) {
    var Y, K, X, J, G, Q;
    let n = (Y = t.doc) != null ? Y : document;
    if (!e || e.config.killSwitch) return null;
    let r = ae(e.config.strings),
      s = (X = (K = e.locale) != null ? K : e.config.locale) != null ? X : "en",
      c = e.config.shippingBar,
      l = (c == null ? void 0 : c.enabled) === !0 && Number(c.thresholdMinor) > 0;
    if (!l && e.rules.length === 0) return null;
    let p = () => ce(n, e.config.cartSelector);
    p() ||
      ((J = t.beacon) == null || J.once("cart_surface_missing"),
      setTimeout(
        () =>
          V(() => {
            var o;
            return p() ? R() : (o = t.beacon) == null ? void 0 : o.once("cart_surface_missing");
          }),
        2500,
      ));
    let i = null,
      I = null,
      x = null,
      f = "",
      u = null,
      h = !1;
    function R() {
      let o = p();
      return o
        ? ((I = o.adapter),
          (i != null && i.isConnected && o.host.contains(i)) ||
            ((i = n.createElement("div")),
            i.setAttribute(Ae, ""),
            (i.className = "bk-cart"),
            l && (i.style.minBlockSize = "3.25rem"),
            o.host.insertBefore(i, o.host.firstChild),
            (x = me(i)),
            (f = "")),
          !0)
        : !1;
    }
    function ke(o) {
      var m;
      if (!l || !c || (c.currency && o.currency !== c.currency)) return "";
      let a = re(o.items_subtotal_price, Number(c.thresholdMinor));
      if (!a.enabled) return "";
      let d = a.complete
        ? r["shipping.success"]
        : P(r["shipping.progress"], { amount: _(a.remainingMinor, o.currency, s) });
      return (
        a.complete && !h && ((h = !0), (m = t.beacon) == null || m.once("shipping_bar_completed")),
        `<div class="bk-ship${a.complete ? " bk-done" : ""}"><p class="bk-ship-text">${b(d)}</p><div class="bk-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${a.percent}" aria-label="${b(d)}"><span style="inline-size:${a.percent}%"></span></div></div>`
      );
    }
    function he(o) {
      var E;
      if (e.rules.length === 0) return "";
      let a = new Set(o.items.map((y) => fe("Product", y.product_id))),
        d = new Map(Object.entries(e.offers).map(([y, T]) => [y, T.variants.some((g) => g.available)])),
        m = ie(e.rules, a, d);
      if (m.length === 0) return "";
      let O = m
          .map(({ ruleId: y, productId: T }) => {
            var W;
            let g = e.offers[T],
              k = e.rules.find((M) => M.id === y);
            if (!g || !k) return "";
            let S = g.variants.filter((M) => M.available),
              $ = S[0].price,
              Ie = k.discountPercent > 0 ? $ - C($, k.discountPercent) : $,
              Me =
                S.length > 1
                  ? `<select class="bk-var" data-bk-var aria-label="${b(g.title)}">${S.map((M) => `<option value="${M.id}" data-price="${M.price}">${b(M.title)}</option>`).join("")}</select>`
                  : `<input type="hidden" data-bk-var value="${S[0].id}" data-price="${S[0].price}">`;
            return (
              (W = t.beacon) == null || W.once("upsell_viewed", y),
              `<li class="bk-offer" data-bk-offer data-rule="${b(y)}" data-title="${b(g.title)}" data-percent="${k.discountPercent}">` +
                (g.image
                  ? `<img class="bk-oimg" src="${b(g.image)}" alt="" width="56" height="56" loading="lazy">`
                  : "") +
                `<div class="bk-obody"><span class="bk-otitle">${b(g.title)}</span><span class="bk-oprice">${k.discountPercent > 0 ? `<s>${b(_($, o.currency, s))}</s> ` : ""}<strong>${b(_(Ie, o.currency, s))}</strong>${k.discountPercent > 0 ? ` <span class="bk-osave">${b(P(r["upsell.save"], { percent: k.discountPercent }))}</span>` : ""}</span>${Me}</div><button type="button" class="bk-oadd" data-bk-oadd>${b(r["upsell.add"])}<span class="bk-sr"> ${b(g.title)}</span></button></li>`
            );
          })
          .join(""),
        w =
          m.length &&
          ((E = e.rules.find((y) => y.id === m[0].ruleId)) == null ? void 0 : E.layout) === "CAROUSEL"
            ? "bk-carousel"
            : "bk-stacked";
      return `<div class="bk-offers"><p class="bk-oh">${b(r["upsell.heading"])}</p><ul class="bk-olist ${w}">${O}</ul></div>`;
    }
    function ve(o) {
      var m;
      if (((u = o), !R() || !i)) return;
      let a = ke(o) + he(o);
      if (a === f) return;
      f = a;
      let d = i.querySelector("[data-bk-status]");
      ((i.innerHTML = a),
        d && i.appendChild(d),
        be((m = n.defaultView) != null ? m : window)
          ? i.classList.remove("bk-motion")
          : i.classList.add("bk-motion"),
        a || (i.style.minBlockSize = ""));
    }
    async function D() {
      var o;
      try {
        ve(await ((o = t.getCartImpl) != null ? o : () => de(t.fetchImpl))());
      } catch {}
    }
    let H = (o) => {
      var w, E, y, T, g;
      let a =
          (E = (w = o.target) == null ? void 0 : w.closest) == null ? void 0 : E.call(w, "[data-bk-oadd]"),
        d = a == null ? void 0 : a.closest("[data-bk-offer]");
      if (!a || !d || !(i != null && i.contains(d))) return;
      let m = d.querySelector("[data-bk-var]"),
        O = (y = d.dataset.title) != null ? y : "";
      m != null &&
        m.value &&
        ((a.disabled = !0),
        a.setAttribute("aria-busy", "true"),
        ((T = t.addImpl) != null ? T : ue)([
          { id: m.value, quantity: 1, properties: { _upsell_id: (g = d.dataset.rule) != null ? g : "" } },
        ])
          .then(async () => {
            var k;
            (x == null || x(P(r["upsell.added"], { title: O })),
              (k = t.beacon) == null || k.track("upsell_added", d.dataset.rule),
              pe(n),
              await le(n, I == null ? void 0 : I.sections, t.fetchImpl),
              await D());
          })
          .catch(() => {
            (x == null || x(P(r["upsell.error"], { title: O }), { focus: !0 }),
              (a.disabled = !1),
              a.removeAttribute("aria-busy"));
          }));
    };
    n.addEventListener("click", H);
    let U,
      L = () => {
        (clearTimeout(U),
          (U = setTimeout(
            () =>
              V(() => {
                D();
              }),
            120,
          )));
      },
      j = ["cart:refresh", "cart:updated", "bundlekit:cart-updated"];
    for (let o of j) n.addEventListener(o, L);
    let v = n.defaultView,
      B = v == null ? void 0 : v.fetch;
    v &&
      B &&
      !t.fetchImpl &&
      (v.fetch = function (...o) {
        let a = B.apply(v, o);
        return (
          V(() => {
            let d = typeof o[0] == "string" ? o[0] : o[0] instanceof URL ? o[0].href : o[0].url;
            /\/cart\/(add|change|update|clear)(\.js)?(\?|$)/.test(d) && a.then(L, () => {});
          }),
          a
        );
      });
    let F = new (
      (Q = (G = n.defaultView) == null ? void 0 : G.MutationObserver) != null ? Q : MutationObserver
    )(() => {
      i && !i.isConnected && L();
    });
    return (
      F.observe(n.body, { childList: !0, subtree: !0 }),
      D(),
      {
        refresh: D,
        destroy() {
          (F.disconnect(), clearTimeout(U), n.removeEventListener("click", H));
          for (let o of j) n.removeEventListener(o, L);
          (v && B && (v.fetch = B), i == null || i.remove());
        },
      }
    );
  }
  var xe = () => {
    let e = document.getElementById("bk-cart-config"),
      t = ge(e);
    t && ye(t, { beacon: ee(t.beacon) });
  };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", xe, { once: !0 }) : xe();
})();
