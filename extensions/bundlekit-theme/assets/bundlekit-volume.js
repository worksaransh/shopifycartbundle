"use strict";(()=>{function x(e,t={}){var u,s;let o=(u=t.send)!=null?u:((n,i)=>typeof navigator!="undefined"&&navigator.sendBeacon?navigator.sendBeacon(n,i):!1),r=(s=t.schedule)!=null?s:((n,i)=>setTimeout(n,i)),a=new Map,f=new Set,p=null,l=()=>{if(p=null,!e||a.size===0){a.clear();return}let n=[...a.values()].slice(0,20);a.clear();try{o(e,new Blob([JSON.stringify({events:n})],{type:"application/json"}))}catch{}},c=(n,i)=>{if(!e)return;let d=`${n}|${i!=null?i:""}`,b=a.get(d);b?b.n++:a.set(d,{t:n,...i?{r:i.slice(0,64)}:{},n:1}),a.size>=20?l():p===null&&(p=r(l,3e3))};return typeof document!="undefined"&&(document.addEventListener("visibilitychange",()=>document.visibilityState==="hidden"&&l()),window.addEventListener("pagehide",l)),{track:c,once(n,i){let d=`${n}|${i!=null?i:""}`;f.has(d)||(f.add(d),c(n,i))},flush:l}}var g=Object.freeze({totalMinor:0,lineDiscounts:[]});var X={...g,instances:0,coveredUnits:{}};var v=`
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
`.trim();var h={"bundle.price":"Bundle price","bundle.save":"Save {percent}%","bundle.add":"Add bundle to cart","bundle.added":"Bundle added to cart","bundle.soldOut":"One item in this bundle is sold out","bundle.error":"Could not add the bundle. Try again.","price.atCheckout":"Price at checkout","volume.heading":"Buy more, save more","volume.row":"Buy {qty}+ and save {percent}%","volume.selected":"{qty} selected","upsell.heading":"Add to your order","upsell.add":"Add","upsell.added":"{title} added to your cart","upsell.error":"Could not add {title}. Try again.","upsell.save":"Save {percent}%","shipping.progress":"Add {amount} more for free shipping","shipping.success":"You've unlocked free shipping"},P=Object.keys(h);function I(e){let t={...h};for(let o of P){let r=e==null?void 0:e[o];typeof r=="string"&&r.trim()&&(t[o]=r)}return t}function M(e,t={}){return e.replace(/\{(\w+)\}/g,(o,r)=>r in t?String(t[r]):o)}var Te=`${v}
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
`;function m(e){try{e()}catch{}}function T(e){try{return e!=null&&e.textContent?JSON.parse(e.textContent):null}catch{return null}}var L='form[action*="/cart/add"] input[name="quantity"], input[name="quantity"][form^="product-form"]';function D(e,t){let o=-1;return e.forEach((r,a)=>{r<=t&&(o===-1||r>e[o])&&(o=a)}),o}function O(e,t={}){m(()=>{let o=I(T(e.querySelector("script[data-bk-strings]"))),r=[...e.querySelectorAll("[data-bk-tier]")];if(r.length===0)return;let a=r.map(c=>Number(c.dataset.min)),f=e.ownerDocument,p=()=>f.querySelector(L),l=()=>{var s;let c=Number((s=p())==null?void 0:s.value)||1,u=D(a,c);r.forEach((n,i)=>{let d=i===u;n.classList.toggle("bk-active",d),n.setAttribute("aria-pressed",String(d));let b=n.querySelector("[data-bk-selected]");b&&(b.textContent=d?M(o["volume.selected"],{qty:c}):"")})};for(let c of["input","change"])f.addEventListener(c,u=>m(()=>{var s,n;return((n=(s=u.target)==null?void 0:s.matches)==null?void 0:n.call(s,"input[name='quantity']"))&&l()}));r.forEach((c,u)=>c.addEventListener("click",()=>m(()=>{var n;let s=p();s&&(s.value=String(a[u]),s.dispatchEvent(new Event("input",{bubbles:!0})),s.dispatchEvent(new Event("change",{bubbles:!0})),(n=t.beacon)==null||n.track("tier_selected",`${a[u]}`),l())}))),l()})}function R(e,t={}){e.querySelectorAll("[data-bk-volume]").forEach(o=>O(o,t))}var E=()=>{var t;let e=(t=document.querySelector("[data-bk-volume]"))==null?void 0:t.dataset.beacon;R(document,{beacon:x(e)})};document.readyState==="loading"?document.addEventListener("DOMContentLoaded",E,{once:!0}):E();})();
