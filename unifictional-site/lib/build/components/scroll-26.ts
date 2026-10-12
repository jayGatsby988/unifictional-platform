// @ts-nocheck
// scroll-26 · Scrolling content folded over three 3D planes: the middle flat, the top and bottom hinged steeply away (Awwwards Pack, demo 2).
// The demo owns the page (fixed stage, body height set by JS); here the
// stage is a sticky box in a tall track and the three clones are moved by one
// scrubbed tween instead of a scrollTop lerp.
import type { Component } from "./_types";

// Item image: the resolver's {url} on it.image, else a parallel s.images entry, else a URL written in query.
function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}

const c: Component = {
  id: "scroll-26",
  type: "fold-planes",
  kind: "section",
  weight: "medium",
  describe: "fold-planes (scroll-26): the screen pins on a three-panel fold: a flat panel in the middle with two panels hinged steeply away from its top and bottom edges, like a paper fold seen from inside. A column of content (3-5 blocks: a big title, a paragraph and a full-width photo each) scrolls through the fold, so each line enters warped and stretched on the top panel, reads flat in the middle and bends away on the bottom panel. Needs 3-5 blocks with a 2-5 word title, 1-3 sentences and one landscape photo. A storytelling section for about pages, process walkthroughs and manifestos; builders, architects, studios, hospitality.",
  fields: `{"type":"fold-planes","component":"scroll-26","items":[{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""}]}`,
  images: { min: 3, max: 5 },
  css: () => `
.fold{position:relative;background:var(--inv-bg);color:var(--inv-ink)}
.fold__base,.fold__content{padding:12svh var(--gutter);max-width:72rem;margin:0 auto;display:grid;gap:clamp(4rem,12vh,9rem)}
.fold__block{display:grid;gap:1.5rem}
.fold__block h2{font-size:clamp(2.4rem,6.5vw,6.5rem);max-width:14ch}
.fold__block p{max-width:52ch;font-size:clamp(1.05rem,1.4vw,1.3rem);line-height:1.5;opacity:.75}
.fold__img{aspect-ratio:3/2;overflow:hidden;background:rgba(127,127,127,.15)}
.fold__img img{width:100%;height:100%;object-fit:cover}
.fold__track{display:none}
.fold.is-fx .fold__base{display:none}
.fold.is-fx .fold__track{display:block;height:var(--fh,400svh)}
.fold__stage{position:sticky;top:0;height:100svh;display:flex;align-items:center;justify-content:center;overflow:hidden}
.fold__3d{position:relative;perspective:250px;transform-style:preserve-3d;width:100%}
.fold__plane{overflow:hidden;width:100%;height:80svh;will-change:transform}
.fold__plane--center{position:relative;transform:translateZ(0)}
.fold__plane--before{position:absolute;inset:0;transform-origin:bottom center;transform:translate3d(0,-80svh,0) rotateX(-120deg)}
.fold__plane--after{position:absolute;inset:0;transform-origin:top center;transform:translate3d(0,80svh,0) rotateX(120deg)}
.fold__scroller{width:100%;height:100%}
.fold__plane--before .fold__scroller{transform:translateY(100%)}
.fold__plane--after .fold__scroller{transform:translateY(-100%)}
.fold__content{will-change:transform}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .fold__track{display:none!important}
  .fold__base{display:grid!important;padding:4rem var(--gutter);gap:3rem}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, 5);
    return `
<section class="fold" data-fx="fold-planes">
  <div class="fold__base">${items.map((it, i) => {
    const p = pic(it, s, i);
    const u = p ? imgUrl(p, 1600) : "";
    return `<div class="fold__block">${it.title ? `<h2 class="display">${esc(it.title)}</h2>` : ""}${it.text ? `<p>${esc(it.text)}</p>` : ""}${u ? `<div class="fold__img"><img src="${esc(u)}" alt="${esc(it.alt || p.alt || it.title || "")}" loading="lazy"></div>` : ""}</div>`;
  }).join("")}</div>
  <div class="fold__track"><div class="fold__stage"><div class="fold__3d">
    <div class="fold__plane fold__plane--before" aria-hidden="true"></div>
    <div class="fold__plane fold__plane--center"></div>
    <div class="fold__plane fold__plane--after" aria-hidden="true"></div>
  </div></div></div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="fold-planes"]');
  if (!sec || !window.__fx.FX) return;
  var base = sec.querySelector('.fold__base'), track = sec.querySelector('.fold__track');
  var planes = Array.prototype.slice.call(sec.querySelectorAll('.fold__plane'));
  if (!base || !track || planes.length !== 3) return;
  var contents = planes.map(function(pl){
    var sc = document.createElement('div'); sc.className = 'fold__scroller';
    var cp = base.cloneNode(true); cp.className = 'fold__content'; cp.removeAttribute('id');
    cp.querySelectorAll('img').forEach(function(im){ im.loading = 'eager'; if (pl.classList.contains('fold__plane--center')) return; im.alt = ''; });
    sc.appendChild(cp); pl.appendChild(sc); return cp;
  });
  sec.classList.add('is-fx');
  var dist = 0;
  function size(){
    dist = Math.max(0, contents[1].offsetHeight - planes[1].offsetHeight);
    sec.style.setProperty('--fh', (dist + window.innerHeight) + 'px');
  }
  size();
  ScrollTrigger.addEventListener('refreshInit', size);
  gsap.to(contents, { y: function(){ return -dist; }, ease: 'none', scrollTrigger: { trigger: track, start: 'top top', end: 'bottom bottom', scrub: 0.8, invalidateOnRefresh: true } });
  var pending = 0;
  contents[1].querySelectorAll('img').forEach(function(im){ if (!im.complete) { pending++; im.addEventListener('load', done, { once: true }); im.addEventListener('error', done, { once: true }); } });
  function done(){ if (--pending <= 0) ScrollTrigger.refresh(); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ ScrollTrigger.refresh(); });
})();`,
};
export default c;
