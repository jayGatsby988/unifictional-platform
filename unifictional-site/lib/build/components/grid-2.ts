// @ts-nocheck
// grid-2 · 3D parallax field of floating cards (Awwwards Pack, video only: recreated from the preview).
// 8-14 small picture cards hang at different depths inside a perspective stage; the field pans
// with the pointer (near cards move more than far ones) and drifts upward as the page scrolls.
import type { Component } from "./_types";

// Card positions on the stage (x%, y%, z px). Far cards (negative z) look smaller and wash into the background.
const SPOTS = [[14, 42, 0], [56, 9, -820], [51, 64, 130], [90, 30, 70], [8, 70, -270], [31, 10, -180], [84, 56, -720], [71, 80, -430], [10, 14, -640], [39, 36, -520], [93, 82, -140], [79, 12, -340], [29, 74, -840], [63, 32, -80]];

function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}

const c: Component = {
  id: "grid-2",
  type: "card-field",
  kind: "section",
  weight: "light",
  describe: "(recreated from the preview video) card-field (grid-2): an optional title and intro, then a full-screen stage where 8-14 small picture cards (a photo with a one-line caption {title, meta} under it) float at different depths, like a camera looking into a cloud of them: the near ones are large and crisp, the far ones small and washed toward the background colour. Moving the mouse pans the whole field with parallax, near cards sliding further than far ones, and scrolling makes the cloud drift upward through the screen. Cards can link to their pages. Phones show the same cards as a plain two-column grid. Use for a project or product overview, a team wall or a menu of services for studios, product brands, cafes and shops.",
  fields: `{"type":"card-field","component":"grid-2","title":"","intro":"","items":[{"title":"","meta":"","query":"","alt":"","href":""}]}`,
  images: { min: 8, max: 14 },
  css: () => `
.cfield{padding:clamp(4rem,10vh,8rem) 0 0;overflow:hidden}
.cfield__head{padding:0 var(--gutter);display:grid;gap:1rem;max-width:50rem;margin-bottom:1rem}
.cfield__head h2{font-size:clamp(2rem,5vw,4.5rem);max-width:14ch}
.cfield__head p{max-width:46ch;color:var(--ink2);font-size:1.05rem}
.cfield__stage{position:relative;height:100svh;perspective:1200px;perspective-origin:50% 50%}
.cfield__layer{position:absolute;inset:0;transform-style:preserve-3d}
.cfield__card{position:absolute;left:var(--x);top:var(--y);width:clamp(150px,16vw,240px);min-width:0;transform:translate3d(-50%,-50%,var(--z));background:var(--bg2);box-shadow:0 20px 60px rgba(0,0,0,.18);display:grid;grid-template-columns:minmax(0,1fr);gap:.55rem;padding:.55rem;will-change:transform;color:inherit}
.cfield__img{aspect-ratio:4/5;overflow:hidden;background:var(--bg)}
.cfield__img img{width:100%;height:100%;object-fit:cover}
.cfield__cap{display:flex;justify-content:space-between;gap:.6rem;font-family:var(--mono);font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink2);padding:0 .15rem .15rem}
.cfield__cap span{min-width:0}
.cfield__cap span:first-child{color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cfield__card::after{content:"";position:absolute;inset:0;background:var(--bg);opacity:var(--fade);pointer-events:none}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .cfield{padding-bottom:3rem}
  .cfield__stage{height:auto;perspective:none;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:1rem;padding:1rem var(--gutter) 0}
  .cfield__layer{display:contents}
  .cfield__card{position:static;transform:none!important;width:auto;box-shadow:none;background:var(--bg2)}
  .cfield__card::after{display:none}
}`,
  html: (s, { esc, imgUrl, link }) => {
    const items = (s.items || []).slice(0, 14);
    const cards = items.map((it, i) => {
      const [x, y, z] = SPOTS[i % SPOTS.length];
      const p = pic(it, s, i);
      const fade = Math.max(0, Math.min(0.62, -z / 1300)).toFixed(2);
      const tag = it.href ? "a" : "div";
      return `<${tag} class="cfield__card" data-z="${z}" style="--x:${x}%;--y:${y}%;--z:${z}px;--fade:${fade}"${it.href ? ` href="${esc(link(it.href))}"` : ""}><div class="cfield__img">${p ? `<img src="${esc(imgUrl(p, 700))}" alt="${esc(it.alt || p.alt || it.title || "")}" loading="lazy">` : ""}</div><div class="cfield__cap"><span>${esc(it.title || "")}</span><span>${esc(it.meta || "")}</span></div></${tag}>`;
    }).join("");
    return `
<section class="cfield" data-fx="card-field">
  ${s.title || s.intro ? `<div class="cfield__head">${s.title ? `<h2 class="display reveal">${esc(s.title)}</h2>` : ""}${s.intro ? `<p class="reveal">${esc(s.intro)}</p>` : ""}</div>` : ""}
  <div class="cfield__stage"><div class="cfield__layer">${cards}</div></div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="card-field"]');
  if (!sec || !window.__fx.FX) return;
  var stage = sec.querySelector('.cfield__stage'), cards = Array.prototype.slice.call(sec.querySelectorAll('.cfield__card'));
  var fine = window.matchMedia('(pointer: fine)').matches, inView = false;
  var cs = cards.map(function(card){
    var z = +card.getAttribute('data-z') || 0, d = (z + 900) / 800;
    gsap.set(card, { xPercent: -50, yPercent: -50, z: z });
    return { el: card, d: d, xTo: gsap.quickTo(card, 'x', { duration: 0.9, ease: 'power3' }), yTo: gsap.quickTo(card, 'y', { duration: 0.9, ease: 'power3' }) };
  });
  ScrollTrigger.create({ trigger: stage, start: 'top bottom', end: 'bottom top', scrub: true, onUpdate: function(self){
    var p = self.progress;
    cs.forEach(function(c){ gsap.set(c.el, { yPercent: -50 + (1 - 2 * p) * 55 * c.d }); });
  }});
  if (!fine) return;
  new IntersectionObserver(function(es){ es.forEach(function(en){ inView = en.isIntersecting; if (!inView) cs.forEach(function(c){ c.xTo(0); c.yTo(0); }); }); }).observe(stage);
  document.addEventListener('mousemove', function(e){
    if (!inView) return;
    var nx = e.clientX / window.innerWidth - 0.5, ny = e.clientY / window.innerHeight - 0.5;
    cs.forEach(function(c){ c.xTo(-nx * 150 * c.d); c.yTo(-ny * 90 * c.d); });
  }, { passive: true });
})();`,
};
export default c;
