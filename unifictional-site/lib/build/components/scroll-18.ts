// @ts-nocheck
// scroll-18 · A stack of image cards on a tilted 3D axis flies from deep behind the screen past the viewer while each card spins (Awwwards Pack).
// Effect 1 of the demo, with the card spacing widened because we carry 4-8
// cards instead of 27, and the stage pinned with CSS sticky around a headline.
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
  id: "scroll-18",
  type: "card-stack",
  kind: "section",
  weight: "medium",
  describe: "card-stack (scroll-18): the screen pins on a headline with a short line under it; a stack of 4-8 small cards (photo, name, one line) sits far away on a tilted 3D axis and, as you scroll, travels towards the viewer and past the camera, every card turning as it goes, so the cards sweep diagonally across the headline one after another. Needs one photo, a 1-3 word name and a one-sentence line per card, plus a 2-6 word headline. Suits service menus, product ranges, project lists and team intros for trades, studios, agencies and shops.",
  fields: `{"type":"card-stack","component":"scroll-18","title":"","text":"","items":[{"title":"","text":"","query":"","alt":""}]}`,
  images: { min: 4, max: 8 },
  css: ({ pair }) => `
.stack__track{height:300svh;position:relative}
.stack__stage{position:sticky;top:0;height:100svh;overflow:hidden}
.stack__copy{position:absolute;inset:0;display:grid;place-content:center;text-align:center;padding:0 var(--gutter);gap:1.2rem;z-index:0}
.stack__copy h2{font-size:clamp(2.4rem,6.5vw,6.5rem);max-width:14ch;margin:0 auto}
.stack__copy p{max-width:44ch;margin:0 auto;color:var(--ink2);font-size:1.05rem}
.stack__scene{position:absolute;inset:0;perspective:1000px;display:grid;place-items:center;z-index:1;pointer-events:none}
.stack__content{display:grid;grid-template-areas:'c';transform-style:preserve-3d;transform:rotate3d(1,0,0,-25deg) rotate3d(0,1,0,50deg) rotate3d(0,0,1,25deg)}
.stack__card{grid-area:c;width:clamp(170px,22vw,260px);background:var(--bg2);border:1px solid var(--line);padding:.6rem;display:grid;gap:.5rem;will-change:transform;box-shadow:0 20px 50px rgba(0,0,0,.18)}
.stack__img{aspect-ratio:1;overflow:hidden;background:var(--bg)}
.stack__img img{width:100%;height:100%;object-fit:cover}
.stack__card h3{font-family:var(--display);font-weight:${pair.weight};font-size:1.05rem;line-height:1.1;margin-top:.2rem}
.stack__card p{font-size:.78rem;line-height:1.4;color:var(--ink2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .stack__track{height:auto}
  .stack__stage{position:static;height:auto;overflow:visible;padding:4rem 0}
  .stack__copy{position:static;padding:0 var(--gutter) 2rem;text-align:left;place-content:start}
  .stack__copy h2,.stack__copy p{margin:0}
  .stack__scene{position:static;perspective:none;display:block;pointer-events:auto;padding:0 var(--gutter)}
  .stack__content{display:grid;grid-template-areas:none;grid-template-columns:1fr 1fr;gap:.8rem;transform:none!important}
  .stack__card{grid-area:auto;width:100%;transform:none!important;box-shadow:none}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, 8);
    return `
<section class="stack" data-fx="card-stack">
  <div class="stack__track"><div class="stack__stage">
    <div class="stack__copy">${s.title ? `<h2 class="display">${esc(s.title)}</h2>` : ""}${s.text ? `<p>${esc(s.text)}</p>` : ""}</div>
    <div class="stack__scene"><div class="stack__content">${items.map((it, i) => {
      const p = pic(it, s, i);
      const u = p ? imgUrl(p, 700) : "";
      return `<article class="stack__card"><div class="stack__img">${u ? `<img src="${esc(u)}" alt="${esc(it.alt || p.alt || it.title || "")}" loading="lazy">` : ""}</div>${it.title ? `<h3>${esc(it.title)}</h3>` : ""}${it.text ? `<p>${esc(it.text)}</p>` : ""}</article>`;
    }).join("")}</div></div>
  </div></div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="card-stack"]');
  if (!sec || !window.__fx.FX) return;
  var track = sec.querySelector('.stack__track');
  var cards = Array.prototype.slice.call(sec.querySelectorAll('.stack__card'));
  var n = cards.length; if (!n) return;
  var W = function(){ return window.innerWidth; };
  var sp = function(){ return 0.35 * W(); };
  gsap.timeline({ defaults: { ease: 'power1' }, scrollTrigger: { trigger: track, start: 'top top', end: 'bottom bottom', scrub: true, invalidateOnRefresh: true } })
    .fromTo(cards, { z: function(i){ return -2.4 * W() - i * sp(); } }, { z: function(i){ return 1.3 * W() + (n - 1 - i) * sp(); } }, 0)
    .fromTo(cards, { rotationZ: -220 }, { rotationY: -30, rotationZ: 120, stagger: 0.005 }, 0);
})();`,
};
export default c;
