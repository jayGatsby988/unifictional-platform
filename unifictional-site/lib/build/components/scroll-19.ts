// @ts-nocheck
// scroll-19 · Staircase gallery whose images grow in from a corner as they scroll in (Awwwards Pack).
import type { Component } from "./_types";

const c: Component = {
  id: "scroll-19",
  type: "gallery",
  kind: "section",
  weight: "light",
  describe: "gallery (scroll-19): title + intro, then 6-9 project photos laid out as a staircase across an 8-column grid; each image scales in from its corner as it scrolls into view, with a small caption {title, meta} (project name and place). The main 'work' section.",
  fields: `{"type":"gallery","component":"scroll-19","title":"","intro":"","items":[{"title":"","meta":"","query":""}]}`,
  images: { min: 6, max: 9 },
  css: () => `
.gallery{padding:clamp(4rem,10vh,8rem) 0 clamp(4rem,10vh,8rem)}
.gallery .sec-head{padding:0 var(--gutter)}
.grid{display:grid;grid-template-columns:100%;gap:3rem;padding:0 var(--gutter)}
@media(min-width:53em){.grid{grid-template-columns:repeat(8,1fr);gap:1rem 0}}
.grid__item{position:relative;display:grid;gap:.6rem}
@media(min-width:53em){.grid__item{grid-column:var(--c)/span var(--s);grid-row:var(--r)}}
.grid__item-img{overflow:hidden;aspect-ratio:1.5;will-change:transform}
.grid__item-img-inner{width:100%;height:100%;background-size:cover;background-position:50% 50%;will-change:transform}
.grid__item-caption{display:flex;justify-content:space-between;gap:1rem;font-family:var(--mono);font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink2)}`,
  html: (s, { esc, imgUrl }) => {
    const layout = [[1, 1, 3], [2, 4, 3], [3, 1, 2], [4, 3, 3], [5, 6, 3], [6, 3, 2], [7, 5, 3], [8, 1, 3], [9, 4, 3]];
    const items = (s.items || []).slice(0, 9);
    return `
<section class="gallery" id="work" data-fx="gallery">
  <div class="sec-head"><h2 class="display reveal">${esc(s.title)}</h2>${s.intro ? `<p class="reveal">${esc(s.intro)}</p>` : ""}</div>
  <div class="grid">${items.map((it, i) => { const [r, c, sp] = layout[i]; return `<figure class="grid__item" style="--r:${r};--c:${c};--s:${sp}"><div class="grid__item-img"><div class="grid__item-img-inner" role="img" aria-label="${esc(it.image?.alt || it.title)}" style="background-image:url('${esc(imgUrl(it.image, 1200))}')"></div></div><figcaption class="grid__item-caption"><span>${esc(it.title)}</span><span>${esc(it.meta || "")}</span></figcaption></figure>`; }).join("")}</div>
</section>`;
  },
  js: () => `
(function(){
  var grid = document.querySelector('[data-fx="gallery"] .grid');
  if (!grid || window.__fx.RM) return;
  var SMALL = window.__fx.SMALL;
  grid.querySelectorAll('.grid__item').forEach(function(item){
    var prev = item.previousElementSibling;
    var left = prev && (item.offsetLeft + item.offsetWidth <= prev.offsetLeft + 1);
    var ox = left ? 100 : 0;
    gsap.timeline({ defaults: { ease: 'power4' }, scrollTrigger: { trigger: item, start: 'top bottom-=10%', end: '+=90%', scrub: true } })
      .fromTo(item.querySelector('.grid__item-img'), { scale: SMALL ? 0.85 : 0, transformOrigin: ox + '% 0%' }, { scale: 1 })
      .fromTo(item.querySelector('.grid__item-img-inner'), { scale: SMALL ? 1.3 : 4, transformOrigin: ox + '% 0%' }, { scale: 1 }, 0)
      .fromTo(item.querySelector('.grid__item-caption'), { xPercent: left ? 60 : -60, opacity: 0 }, { ease: 'power1', xPercent: 0, opacity: 1 }, 0);
  });
})();`,
};
export default c;
