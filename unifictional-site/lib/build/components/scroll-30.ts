// @ts-nocheck
// scroll-30 · One photo that opens full screen, then Flip-morphs down the page into a slot in each text block (Awwwards Pack).
// The demo's six placeholders and 13 support images become 3-4 slots beside
// text blocks (centre tile under a title, inline inside a headline, a left
// column, a small centred tile); the Flip timeline is the demo's.
import type { Component } from "./_types";

const LAYOUTS = ["center", "inline", "sides", "small"];

const c: Component = {
  id: "scroll-30",
  type: "one-image",
  kind: "section",
  weight: "medium",
  describe: "one-image (scroll-30): one photo fills the screen, then, as you scroll, the same photo shrinks and travels down the page as a single element, re-fitting into a slot in each block that follows: first a tall tile centred over a big two-line title, then inline inside a headline between its words, then a left column beside a paragraph, then a small tile over a closing line. The titles' words slide in from the sides. Needs one strong photo and 3-4 blocks with a 2-4 word title and 1-3 sentences each. A signature move for a single-product or single-project story: builders, architects, makers, restaurants, boutique brands.",
  fields: `{"type":"one-image","component":"scroll-30","image":{"query":"","alt":""},"items":[{"title":"","text":""},{"title":"","text":""},{"title":"","text":""}]}`,
  images: { min: 1, max: 1 },
  css: () => `
.one{position:relative}
.one__open{height:100svh;position:relative}
.one__img{position:absolute;inset:0;z-index:10;overflow:hidden;background:var(--bg2);will-change:transform,width,height}
.one__img img{width:100%;height:100%;object-fit:cover}
.one__block{position:relative;display:grid;padding:0 var(--gutter);min-height:100svh;align-content:center;justify-items:center;text-align:center;gap:1.5rem}
.one__title{font-size:clamp(3rem,9vw,9rem);line-height:.95}
.one__title>span{display:inline-block;will-change:transform}
.one__title--md{font-size:clamp(2.2rem,6vw,6rem);display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:.2em}
.one__block p{max-width:46ch;color:var(--ink2);font-size:clamp(1.05rem,1.4vw,1.3rem)}
.one__slot{display:block;background:transparent}
.one__block--center{grid-template-rows:auto}
.one__block--center .one__slot{height:38svh;aspect-ratio:.8;grid-area:1/1/2/2;z-index:1}
.one__block--center .one__title{grid-area:1/1/2/2;position:relative;z-index:11;mix-blend-mode:difference;color:#fff}
.one__slot--inline{height:.72em;aspect-ratio:16/9;align-self:center;flex:none}
.one__block--sides{grid-template-columns:1fr 1fr;align-items:center;justify-items:stretch;text-align:left;gap:3rem;max-width:80rem;margin:0 auto}
.one__block--sides .one__slot{height:50svh}
.one__block--sides .one__text{display:grid;gap:1.2rem}
.one__block--sides h2{font-size:clamp(2rem,4.5vw,4.5rem)}
.one__block--small{min-height:100svh;padding-top:10vh}
.one__block--small .one__slot{height:30svh;aspect-ratio:.8}
.one__block--small h2{font-size:clamp(2rem,4.5vw,4.5rem)}
.one__block--small p{font-size:clamp(1.2rem,2vw,1.8rem);max-width:36ch;color:var(--ink)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .one__open{height:auto;padding:0 var(--gutter)}
  .one__img{position:relative;inset:auto;aspect-ratio:4/5;transform:none!important;width:auto!important;height:auto!important}
  .one__slot{display:none}
  .one__block{min-height:0;padding:3rem var(--gutter);text-align:left;justify-items:start}
  .one__block--center .one__title{grid-area:auto;mix-blend-mode:normal;color:var(--ink);font-size:clamp(2.4rem,11vw,4rem)}
  .one__title--md{justify-content:flex-start;font-size:clamp(2rem,9vw,3rem)}
  .one__title>span{transform:none!important}
  .one__block--sides{grid-template-columns:1fr;gap:1rem;max-width:none}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, 4);
    const u = imgUrl(s.image, 2000);
    const split = (t) => { const w = String(t || "").trim().split(/\s+/); const h = Math.max(1, Math.ceil(w.length / 2)); return [w.slice(0, h).join(" "), w.slice(h).join(" ")]; };
    const block = (it, i) => {
      const lay = LAYOUTS[i] || "small";
      const [a, b] = split(it.title);
      if (lay === "center") return `<div class="one__block one__block--center"><div class="one__slot" data-step></div><h2 class="one__title display"><span>${esc(a)}</span>${b ? `<br><span>${esc(b)}</span>` : ""}</h2>${it.text ? `<p>${esc(it.text)}</p>` : ""}</div>`;
      if (lay === "inline") return `<div class="one__block one__block--inline"><h2 class="one__title one__title--md display"><span>${esc(a)}</span><span class="one__slot one__slot--inline" data-step></span>${b ? `<span>${esc(b)}</span>` : ""}</h2>${it.text ? `<p>${esc(it.text)}</p>` : ""}</div>`;
      if (lay === "sides") return `<div class="one__block one__block--sides"><div class="one__slot" data-step></div><div class="one__text"><h2 class="display">${esc(it.title || "")}</h2>${it.text ? `<p>${esc(it.text)}</p>` : ""}</div></div>`;
      return `<div class="one__block one__block--small"><div class="one__slot" data-step></div><h2 class="display">${esc(it.title || "")}</h2>${it.text ? `<p>${esc(it.text)}</p>` : ""}</div>`;
    };
    return `
<section class="one" data-fx="one-image">
  <div class="one__open"><div class="one__img">${u ? `<img src="${esc(u)}" alt="${esc((s.image && s.image.alt) || "")}" loading="lazy">` : ""}</div></div>
  ${items.map(block).join("")}
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="one-image"]');
  if (!sec || !window.__fx.FX || !window.Flip) return;
  var one = sec.querySelector('.one__img'), open = sec.querySelector('.one__open');
  var steps = Array.prototype.slice.call(sec.querySelectorAll('[data-step]'));
  if (!one || !open || !steps.length) return;
  var tl = null;
  function build(){
    if (tl) { if (tl.scrollTrigger) tl.scrollTrigger.kill(); tl.kill(); gsap.set(one, { clearProps: 'all' }); }
    var states = steps.map(function(st){ return Flip.getState(st); });
    tl = gsap.timeline({ scrollTrigger: { trigger: open, start: 'clamp(center center)', endTrigger: steps[steps.length - 1], end: 'clamp(center center)', scrub: true, immediateRender: false } });
    states.forEach(function(st, i){ tl.add(Flip.fit(one, st, { duration: 1, ease: i ? 'sine.inOut' : 'none' }), i ? '+=0.5' : 0); });
  }
  build();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ build(); ScrollTrigger.refresh(); });
  var rt; window.addEventListener('resize', function(){ clearTimeout(rt); rt = setTimeout(function(){ build(); ScrollTrigger.refresh(); }, 200); });
  sec.querySelectorAll('.one__title > span:not(.one__slot)').forEach(function(sp, i){
    gsap.from(sp, { x: i % 2 ? 150 : -150, ease: 'sine', scrollTrigger: { trigger: sp.closest('.one__block'), start: 'top bottom', end: '+=45%', scrub: true } });
  });
  gsap.fromTo(one, { filter: 'brightness(80%)' }, { filter: 'brightness(100%)', ease: 'sine', scrollTrigger: { trigger: open, start: 'clamp(top bottom)', end: 'clamp(bottom top)', scrub: true } });
})();`,
};
export default c;
