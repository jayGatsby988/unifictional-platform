// @ts-nocheck
// scroll-53 · Editorial photo grid whose pictures assemble from nine tiles in a diagonal sweep (Awwwards Pack).
import type { Component } from "./_types";

// Row plan on a 12-column grid: a pair, one wide landscape, a row of three, a pair, …
const PLAN = [[7, 5], [12], [4, 4, 4], [5, 7], [12], [4, 4, 4]];
const ASPECT = { 12: "21/9", 7: "5/4", 6: "4/3", 5: "4/5", 4: "4/5" };

// Item image: the resolver's {url} on it.image, else a parallel s.images entry, else a URL written in query.
function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}

const c: Component = {
  id: "scroll-53",
  type: "tiles-reveal",
  kind: "section",
  weight: "light",
  describe: "tiles-reveal (scroll-53): title + intro, then 4-8 photos in an editorial grid (a pair of portraits, one wide landscape, a row of three, another pair). When a row reaches the lower quarter of the screen every photo in it builds itself from a 3x3 grid of tiles that grow out of their corners in a diagonal sweep, top-left to bottom-right, in about a second, then stays put. Each photo carries a small caption {title, meta} (name and place). Good as the main work or lookbook section for interiors, food, fashion, product and any brand with strong photography.",
  fields: `{"type":"tiles-reveal","component":"scroll-53","title":"","intro":"","items":[{"query":"","alt":"","title":"","meta":""}]}`,
  images: { min: 4, max: 8 },
  css: () => `
.tiles{padding:clamp(4rem,10vh,8rem) var(--gutter)}
.tiles__row{display:grid;grid-template-columns:repeat(12,1fr);gap:clamp(1rem,2.5vw,2.5rem);align-items:start;margin-bottom:clamp(1.5rem,3vw,3rem)}
.tiles__item{grid-column:span var(--s);display:grid;gap:.6rem;margin:0}
.tiles__img{position:relative;overflow:hidden;aspect-ratio:var(--ar);background:var(--bg2)}
.tiles__m{position:absolute;overflow:hidden;width:calc(100%/3 + 1px);height:calc(100%/3 + 1px);left:calc(var(--c)*100%/3);top:calc(var(--r)*100%/3);clip-path:inset(0% 100% 100% 0%);will-change:clip-path}
.tiles__m img{position:absolute;max-width:none;width:calc(300% - 3px);height:calc(300% - 3px);object-fit:cover;left:calc(var(--c)*(1px - 100%));top:calc(var(--r)*(1px - 100%))}
.tiles__cap{display:flex;justify-content:space-between;gap:1rem;font-family:var(--mono);font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink2)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .tiles__row{grid-template-columns:1fr;gap:2rem;margin-bottom:2rem}
  .tiles__item{grid-column:auto}
  .tiles__img{aspect-ratio:4/5}
  .tiles__m{clip-path:none!important}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, 8);
    const rows = [];
    let k = 0;
    for (const plan of PLAN) {
      if (k >= items.length) break;
      const left = items.length - k;
      const spans = left >= plan.length ? plan : left === 1 ? [12] : Array(left).fill(12 / left);
      rows.push(spans.map((sp, j) => ({ it: items[k + j], sp, i: k + j })));
      k += spans.length;
    }
    const tiles = (u, alt) => Array.from({ length: 9 }, (_, t) => `<div class="tiles__m" style="--c:${t % 3};--r:${Math.floor(t / 3)}">${u ? `<img src="${esc(u)}" alt="${t === 0 ? esc(alt) : ""}" loading="lazy">` : ""}</div>`).join("");
    const fig = ({ it, sp, i }) => {
      const p = pic(it, s, i);
      const u = p ? imgUrl(p, sp >= 12 ? 1800 : 1200) : "";
      return `<figure class="tiles__item" style="--s:${sp};--ar:${ASPECT[sp] || "4/5"}"><div class="tiles__img">${tiles(u, it.alt || (p && p.alt) || it.title || "")}</div><figcaption class="tiles__cap"><span>${esc(it.title || "")}</span><span>${esc(it.meta || "")}</span></figcaption></figure>`;
    };
    return `
<section class="tiles" id="work" data-fx="tiles-reveal">
  <div class="sec-head"><h2 class="display reveal">${esc(s.title || "")}</h2>${s.intro ? `<p class="reveal">${esc(s.intro)}</p>` : ""}</div>
  ${rows.map(r => `<div class="tiles__row">${r.map(fig).join("")}</div>`).join("")}
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="tiles-reveal"]');
  if (!sec || !window.__fx.FX) return;
  var order = [[0], [1, 3], [2, 4, 6], [5, 7], [8]];
  sec.querySelectorAll('.tiles__row').forEach(function(row){
    var tl = gsap.timeline({ scrollTrigger: { trigger: row, start: 'top 75%' } });
    row.querySelectorAll('.tiles__img').forEach(function(img){
      var m = img.querySelectorAll('.tiles__m');
      if (m.length < 9) return;
      gsap.set(m, { clipPath: 'inset(0% 100% 100% 0%)' });
      order.forEach(function(idx, k){
        tl.to(idx.map(function(i){ return m[i]; }), { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.5, ease: 'power2.out', stagger: 0.1 }, k * 0.125);
      });
    });
  });
})();`,
};
export default c;
