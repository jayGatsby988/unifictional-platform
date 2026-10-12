// @ts-nocheck
// scroll-5 · Three scrubbed 3D photo grids, each with a line of text over it (Awwwards Pack).
// The demo's six grid types are reduced to the three that read best with a
// dozen photos: a sideways stream at mixed depths, rows sliding opposite ways
// on a tilted wall, and tiles rising while they spin. Photos repeat to fill.
import type { Component } from "./_types";

// Item image: the resolver's {url} on it.image, else a parallel s.images entry, else a URL written in query.
function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}

// type, columns, rows, tile ratio, gap, grid width, perspective, inner zoom
const GRIDS = [
  { type: 1, cols: 4, rows: 5, ratio: "1.5", gap: "2vw", width: "100%", persp: "1000px", zoom: true },
  { type: 5, cols: 8, rows: 3, ratio: "1.5", gap: "0px", width: "120%", persp: "1500px", zoom: false },
  { type: 6, cols: 4, rows: 3, ratio: "1", gap: "1.5vw", width: "100%", persp: "2500px", zoom: false },
];

const c: Component = {
  id: "scroll-5",
  type: "grids-3d",
  kind: "section",
  weight: "medium",
  describe: "grids-3d (scroll-5): a centred title, then three walls of small photos pass by, each with one short line of big text laid over it. Scrolling drives each wall differently: in the first the tiles stream sideways at mixed depths like a shuffled deck; in the second a tilted wall lights up while its rows slide left and right; in the third the tiles rise from below while turning a full spin. Needs 6-12 photos (they repeat to fill the walls), a title, and three lines of 2-6 words. A decorative showreel for photographers, builders, event companies and anyone with a big photo archive; place it between two text sections.",
  fields: `{"type":"grids-3d","component":"scroll-5","title":"","lines":["","",""],"items":[{"query":"","alt":"","title":""}]}`,
  images: { min: 6, max: 12 },
  css: ({ pair, capsRule }) => `
.g3d{overflow:hidden;padding:clamp(4rem,10vh,8rem) 0 0}
.g3d .sec-head{grid-template-columns:1fr;padding:0 var(--gutter);text-align:center}
.g3d .sec-head h2{margin:0 auto}
.g3d__grid{position:relative;display:grid;place-items:center;perspective:var(--p);margin:0 auto 24vh;width:100%}
.g3d__wrap{width:var(--w);display:grid;grid-template-columns:repeat(var(--c),1fr);gap:var(--g);transform-style:preserve-3d;will-change:transform}
.g3d__tile{aspect-ratio:var(--r);overflow:hidden;position:relative;background:var(--bg2);will-change:transform,filter}
.g3d__tile img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;will-change:transform}
.g3d__grid--zoom .g3d__tile img{inset:-50%;width:200%;height:200%}
.g3d__cap{display:none}
.g3d__line{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;z-index:2;padding:0 var(--gutter);text-align:center}
.g3d__line h3{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}font-size:clamp(2rem,6vw,6rem);line-height:.95;max-width:16ch;color:#fff;mix-blend-mode:difference}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .g3d{padding-bottom:3rem}
  .g3d__grid{perspective:none;margin:0 0 2.5rem;display:block;padding:0 var(--gutter)}
  .g3d__grid:not(.g3d__grid--main) .g3d__wrap{display:none}
  .g3d__wrap{width:100%!important;grid-template-columns:1fr 1fr;gap:.6rem;transform:none!important}
  .g3d__tile{aspect-ratio:4/3;transform:none!important;filter:none!important;opacity:1!important}
  .g3d__tile img{inset:0;width:100%;height:100%;transform:none!important}
  .g3d__tile.is-dup{display:none}
  .g3d__cap{display:block;position:absolute;left:0;right:0;bottom:0;padding:.4rem .6rem;font-family:var(--mono);font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;color:#fff;background:linear-gradient(to top,rgba(0,0,0,.6),transparent)}
  .g3d__line{position:static;display:block;padding:0 0 1rem;text-align:left}
  .g3d__line h3{font-size:clamp(1.8rem,8vw,3rem);color:var(--ink);mix-blend-mode:normal;max-width:none}
}`,
  html: (s, { esc, imgUrl, spec }) => {
    const items = (s.items || []).slice(0, 12);
    const n = items.length;
    const lines = Array.isArray(s.lines) ? s.lines : [];
    const fallback = [s.title || "", s.text || "", (spec.brand && (spec.brand.tagline || spec.brand.name)) || ""];
    const grids = GRIDS.map((g, gi) => {
      const total = g.cols * g.rows;
      const tiles = Array.from({ length: total }, (_, k) => {
        if (!n) return `<div class="g3d__tile"></div>`;
        const idx = (k + gi * 3) % n;
        const it = items[idx];
        const p = pic(it, s, idx);
        const u = p ? imgUrl(p, 600) : "";
        const dup = k >= n;
        return `<div class="g3d__tile${dup ? " is-dup" : ""}">${u ? `<img src="${esc(u)}" alt="${dup ? "" : esc(it.alt || p.alt || it.title || "")}" loading="lazy">` : ""}${it.title && !dup ? `<span class="g3d__cap">${esc(it.title)}</span>` : ""}</div>`;
      }).join("");
      const line = lines[gi] || fallback[gi] || "";
      return `<div class="g3d__grid${g.zoom ? " g3d__grid--zoom" : ""}${gi === 0 ? " g3d__grid--main" : ""}" data-type="${g.type}" data-cols="${g.cols}" style="--p:${g.persp};--w:${g.width};--c:${g.cols};--g:${g.gap};--r:${g.ratio}">
    <div class="g3d__wrap">${tiles}</div>
    ${line ? `<div class="g3d__line"><h3>${esc(line)}</h3></div>` : ""}
  </div>`;
    }).join("");
    return `
<section class="g3d" data-fx="grids-3d">
  ${s.title ? `<div class="sec-head"><h2 class="display reveal">${esc(s.title)}</h2></div>` : ""}
  ${grids}
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="grids-3d"]');
  if (!sec || !window.__fx.FX) return;
  var R = gsap.utils.random;
  sec.querySelectorAll('.g3d__grid').forEach(function(grid){
    var type = +grid.getAttribute('data-type'), cols = +grid.getAttribute('data-cols') || 4;
    var wrap = grid.querySelector('.g3d__wrap');
    var tiles = Array.prototype.slice.call(wrap.querySelectorAll('.g3d__tile'));
    var inners = tiles.map(function(t){ return t.querySelector('img'); }).filter(Boolean);
    if (!tiles.length) return;
    var tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: wrap, start: 'top bottom+=5%', end: 'bottom top-=5%', scrub: true } });
    if (type === 1) {
      tl.set(wrap, { rotationY: 25 })
        .set(tiles, { z: function(){ return R(-1600, 200); } })
        .fromTo(tiles, { xPercent: function(){ return R(-1000, -500); } }, { xPercent: function(){ return R(500, 1000); } }, 0)
        .fromTo(inners, { scale: 2 }, { scale: 0.5 }, 0);
    } else if (type === 5) {
      var even = tiles.filter(function(t, i){ return Math.floor(i / cols) % 2 === 0; });
      var odd = tiles.filter(function(t, i){ return Math.floor(i / cols) % 2 === 1; });
      tl.set(wrap, { rotationX: 50 })
        .to(wrap, { rotationX: 30 })
        .fromTo(tiles, { filter: 'brightness(0%)' }, { filter: 'brightness(100%)' }, 0)
        .to(even, { xPercent: -100, ease: 'power1' }, 0)
        .to(odd, { xPercent: 100, ease: 'power1' }, 0)
        .addLabel('rowsEnd', '>-=0.15')
        .to(tiles, { ease: 'power1', yPercent: function(){ return R(-100, 200); } }, 'rowsEnd');
    } else {
      tl.fromTo(tiles, { transformOrigin: '50% 200%', rotationX: 0, yPercent: 400 }, { yPercent: 0, rotationY: 360, opacity: 0.2, scale: 0.8, stagger: 0.03 });
    }
  });
})();`,
};
export default c;
