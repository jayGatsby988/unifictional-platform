// @ts-nocheck
// scroll-50 · Three-view portfolio layout morph (Awwwards Pack, recreated
// from the preview video). One set of thumbnails morphs with GSAP Flip
// between a scattered grid, a filmstrip beside one large image, and a title
// index with a greyscale stack.
import type { Component } from "./_types";

// Item image: the resolver's {url} on it.image, else a parallel s.images entry, else a URL written in query.
function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}
// Scatter slots on a 10 x 4 grid: [column, row]
const SLOTS = [[1, 1], [6, 2], [3, 3], [9, 1], [5, 4], [2, 2], [8, 3], [4, 1], [10, 4], [7, 1], [1, 4], [6, 3]];

const c: Component = {
  id: "scroll-50",
  type: "portfolio-morph",
  kind: "section",
  weight: "medium",
  describe: "(recreated from the preview video) portfolio-morph (scroll-50): a full-screen portfolio index with a thin bar on top (a label left, the switches 01 / 02 / 03 right). View 01 scatters 6-12 small portrait thumbnails across the screen; pressing 02 sends them shrinking in a staggered cascade into a vertical filmstrip at the left while a large version of the chosen one rises from below (click a thumb to swap it); 03 cascades them to the top right into one greyscale stack while the project names unmask line by line in big display type, roman and italic alternating, hovering a name lifting its picture to the top. Every change takes about a second and the thumbnails never reload. Names link to project pages when href is set. Needs 6-12 portrait photos with a 1-3 word name and a meta line. A gallery index for photographers, studios, fashion, product and interiors; on phones it is a simple two-column grid with captions.",
  fields: `{"type":"portfolio-morph","component":"scroll-50","title":"","items":[{"title":"","meta":"","query":"","alt":"","href":""}]}`,
  images: { min: 6, max: 12 },
  css: ({ capsRule }) => `
.pm{position:relative;min-height:100svh;overflow:hidden}
.pm__bar{display:flex;justify-content:space-between;align-items:center;padding:6rem var(--gutter) 1rem;position:relative;z-index:5}
.pm__switch{display:flex;gap:1.6rem}
.pm__btn{font-family:var(--mono);font-size:.72rem;letter-spacing:.14em;color:var(--ink3);padding:.3rem 0;border-bottom:1px solid transparent;transition:color .3s,border-color .3s}
.pm__btn.is-on,.pm__btn:hover{color:var(--ink);border-color:var(--ink)}
.pm__stage{position:absolute;inset:8.5rem var(--gutter) 2.5rem}
.pm__items{position:absolute;inset:0;display:grid;grid-template-columns:repeat(10,1fr);grid-template-rows:repeat(4,1fr);column-gap:1.2vw;row-gap:1.5vh}
.pm__item{display:block;grid-column:var(--c);grid-row:var(--r);align-self:start;aspect-ratio:3/4;width:100%;overflow:hidden;background:var(--bg2);transition:filter .6s var(--ease-out)}
.pm__item img{width:100%;height:100%;object-fit:cover}
.pm__cap{display:none}
.pm__big{position:absolute;left:28%;top:0;width:min(36vw,34rem);aspect-ratio:3/4;max-height:100%;overflow:hidden;opacity:0;pointer-events:none;background:var(--bg2)}
.pm__big img{width:100%;height:100%;object-fit:cover}
.pm__index{position:absolute;left:0;top:0;bottom:0;width:58%;display:none;flex-direction:column;justify-content:center;gap:.1em;pointer-events:none}
.pm__line{overflow:hidden;line-height:1.05;font-size:clamp(1.3rem,2.6vw,2.6rem);font-family:var(--display);${capsRule}}
.pm__line:nth-child(odd){padding-left:6%}
.pm__line:nth-child(even){font-style:italic}
.pm__line>span{display:block}
.pm__line a,.pm__line span span{pointer-events:auto;transition:color .3s}
.pm__line:hover a,.pm__line:hover span span{color:var(--accent)}
.pm__meta{position:absolute;right:0;bottom:0;text-align:right;display:grid;gap:.2rem}
.pm[data-view="2"] .pm__items{display:flex;flex-direction:column;gap:.4vw;inset:auto auto auto 0;top:0;width:4.4vw}
.pm[data-view="2"] .pm__item{grid-column:auto;grid-row:auto;cursor:pointer}
.pm[data-view="2"] .pm__item.is-active{outline:1px solid var(--ink);outline-offset:2px}
.pm[data-view="2"] .pm__big{pointer-events:auto}
.pm[data-view="3"] .pm__items{display:block;inset:auto 0 auto auto;top:0;width:11vw;height:auto}
.pm[data-view="3"] .pm__item{position:absolute;top:0;left:0;grid-column:auto;grid-row:auto;filter:grayscale(1)}
.pm[data-view="3"] .pm__item.is-front{filter:none;z-index:3}
.pm[data-view="3"] .pm__index{display:flex}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .pm{min-height:0;overflow:visible}
  .pm__bar{padding:3rem var(--gutter) 1.5rem}
  .pm__switch{display:none}
  .pm__stage{position:static;padding:0 var(--gutter) 3rem}
  .pm__items,.pm[data-view] .pm__items{position:static;display:grid;grid-template-columns:1fr 1fr;gap:1rem;width:auto;height:auto}
  .pm__item,.pm[data-view] .pm__item{position:static;grid-column:auto;grid-row:auto;aspect-ratio:auto;filter:none;width:auto}
  .pm__item img{aspect-ratio:3/4}
  .pm__cap{display:grid;gap:.1rem;padding:.6rem 0 0;font-size:.9rem}
  .pm__cap small{color:var(--ink2)}
  .pm__big,.pm__index,.pm__meta{display:none!important}
}`,
  html: (s, { esc, imgUrl, link }) => {
    const items = (s.items || []).slice(0, 12);
    const first = items[0] ? pic(items[0], s, 0) : null;
    return `
<section class="pm" id="work" data-fx="portfolio-morph" data-view="1">
  <div class="pm__bar">
    <div class="mono">${esc(s.title || "Index")}</div>
    <div class="pm__switch" role="tablist" aria-label="Layout">${[1, 2, 3].map(v => `<button class="pm__btn${v === 1 ? " is-on" : ""}" data-view="${v}" aria-pressed="${v === 1 ? "true" : "false"}">0${v}</button>`).join("")}</div>
  </div>
  <div class="pm__stage">
    <div class="pm__items">${items.map((it, i) => {
      const p = pic(it, s, i);
      const u = p ? imgUrl(p, 900) : "";
      const [col, row] = SLOTS[i % SLOTS.length];
      const tag = it.href ? "a" : "div";
      return `<${tag} class="pm__item${i === 0 ? " is-active" : ""}" data-i="${i}" data-src="${esc(u)}" style="--c:${col};--r:${row}"${it.href ? ` href="${esc(link(it.href))}"` : ""}>${u ? `<img src="${esc(u)}" alt="${esc(it.alt || p.alt || it.title || "")}" loading="lazy">` : ""}<div class="pm__cap"><span>${esc(it.title || "")}</span>${it.meta ? `<small>${esc(it.meta)}</small>` : ""}</div></${tag}>`;
    }).join("")}</div>
    <div class="pm__big" aria-hidden="true">${first ? `<img src="${esc(imgUrl(first, 1400))}" alt="">` : ""}</div>
    <ul class="pm__index" aria-hidden="true">${items.map((it, i) => `<li class="pm__line" data-i="${i}"><span>${it.href ? `<a href="${esc(link(it.href))}">${esc(it.title || "")}</a>` : `<span>${esc(it.title || "")}</span>`}</span></li>`).join("")}</ul>
    <div class="pm__meta mono"><span class="pm__meta-title">${esc(items[0]?.title || "")}</span><span class="pm__meta-sub">${esc(items[0]?.meta || "")}</span></div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="portfolio-morph"]');
  if (!sec || !window.__fx.FX || !window.Flip) return;
  var items = Array.prototype.slice.call(sec.querySelectorAll('.pm__item'));
  var btns = sec.querySelectorAll('.pm__btn'), big = sec.querySelector('.pm__big'), bigImg = big && big.querySelector('img');
  var lines = Array.prototype.slice.call(sec.querySelectorAll('.pm__line > span'));
  var metaT = sec.querySelector('.pm__meta-title'), metaS = sec.querySelector('.pm__meta-sub');
  var view = 1, busy = false, activeI = 0;
  gsap.set(lines, { yPercent: 110 });
  function setActive(i){
    activeI = i;
    items.forEach(function(it, k){ it.classList.toggle('is-active', k === i); });
    var src = items[i] && items[i].getAttribute('data-src');
    if (bigImg && src && bigImg.getAttribute('src') !== src) { gsap.fromTo(bigImg, { opacity: 0 }, { opacity: 1, duration: .6 }); bigImg.src = src.replace(/w=\\d+/, 'w=1400'); }
    var cap = items[i] && items[i].querySelector('.pm__cap');
    if (metaT && cap) { metaT.textContent = cap.children[0] ? cap.children[0].textContent : ''; metaS.textContent = cap.children[1] ? cap.children[1].textContent : ''; }
  }
  function go(v){
    if (busy || v === view) return;
    busy = true;
    var from = view; view = v;
    btns.forEach(function(b){ var on = +b.getAttribute('data-view') === v; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    if (from === 3) gsap.to(lines, { yPercent: 110, duration: .5, ease: 'power3.in', stagger: { each: .02, from: 'end' }, overwrite: true });
    if (from === 2) gsap.to(big, { yPercent: 20, opacity: 0, duration: .6, ease: 'power3.in', overwrite: true });
    var state = Flip.getState(items);
    sec.setAttribute('data-view', String(v));
    Flip.from(state, { duration: 1, ease: 'power3.inOut', stagger: { each: .035, from: from < v ? 'start' : 'end' }, absolute: true, onComplete: function(){ busy = false; } });
    if (v === 2) gsap.fromTo(big, { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 1.1, ease: 'power3.inOut', delay: .2, overwrite: true });
    if (v === 3) gsap.fromTo(lines, { yPercent: 110 }, { yPercent: 0, duration: .9, ease: 'power3.out', stagger: .04, delay: .5, overwrite: true });
  }
  btns.forEach(function(b){ b.addEventListener('click', function(){ go(+b.getAttribute('data-view')); }); });
  items.forEach(function(it, i){
    it.addEventListener('click', function(e){ if (view === 2) { e.preventDefault(); setActive(i); } });
  });
  sec.querySelectorAll('.pm__line').forEach(function(li){
    var i = +li.getAttribute('data-i');
    li.addEventListener('mouseenter', function(){ items.forEach(function(it, k){ it.classList.toggle('is-front', k === i); }); setActive(i); });
  });
  setActive(0);
})();`,
};
export default c;
