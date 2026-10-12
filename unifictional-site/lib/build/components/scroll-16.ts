// @ts-nocheck
// scroll-16 · Sticky grid: three columns of square photos slide in from opposite directions behind a title,
// then the grid zooms and parts around the title, sub and button (Awwwards Pack).
import type { Component } from "./_types";

const c: Component = {
  id: "scroll-16",
  type: "grid-zoom-16",
  kind: "section",
  weight: "light",
  describe: "grid-zoom-16 (scroll-16): a pinned screen with a 3-6 word title fading in at its centre. Square photos slide in as three columns, the outer two dropping from above and the middle one rising from below, and settle into a 3-wide grid behind the title. Keep scrolling and the whole grid zooms to twice its size while the side columns push outward and the middle column splits up and down, clearing the centre; the title lifts and a one-sentence description and a button fade in beneath it. Needs 9-12 photos that crop well to squares (12 is the full 3x4 grid), a title, a sentence of 12-25 words and a button. A pinned 'the work' or 'our team' moment with a call to action. Phones show the title, text, button and a two-column grid.",
  fields: `{"type":"grid-zoom-16","component":"scroll-16","title":"","text":"","cta":{"label":"","href":"work"},"images":[{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""}]}`,
  images: { min: 9, max: 12 },
  css: () => `
.gz{height:425svh}
.gz__wrap{position:sticky;top:0;height:100svh;overflow:hidden;display:flex;align-items:center;justify-content:center}
.gz__content{position:relative;z-index:1;width:min(60rem,100%);padding:0 var(--gutter);text-align:center;display:grid;justify-items:center;will-change:transform}
.gz__content h2{font-size:clamp(2.2rem,6vw,6.5rem);max-width:14ch;opacity:0;text-shadow:0 0 28px var(--bg),0 0 8px var(--bg)}
.gz__more{position:absolute;top:calc(100% + 1.6rem);left:var(--gutter);right:var(--gutter);display:grid;gap:1.4rem;justify-items:center;opacity:0;pointer-events:none}
.gz__more p{max-width:44ch;color:var(--ink2);font-size:1.05rem;text-shadow:0 0 20px var(--bg)}
.gz__gal{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(58vw,66svh)}
.gz__grid{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(.6rem,1.6vw,1.6rem);will-change:transform}
.gz__item{aspect-ratio:1;overflow:hidden;will-change:transform}
.gz__item img{width:100%;height:100%;object-fit:cover}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .gz{height:auto}
  .gz__wrap{position:static;height:auto;display:grid;gap:2.5rem;padding:4rem 0}
  .gz__content{order:1;transform:none!important;text-align:left;justify-items:start;width:auto}
  .gz__content h2{opacity:1!important;text-shadow:none}
  .gz__more{position:static;opacity:1!important;pointer-events:auto;justify-items:start;margin-top:1.2rem}
  .gz__more p{text-shadow:none}
  .gz__gal{order:2;position:static;transform:none;width:100%;padding:0 var(--gutter)}
  .gz__grid{grid-template-columns:1fr 1fr;transform:none!important}
  .gz__item{transform:none!important}
}`,
  html: (s, { esc, imgUrl, link, arrow }) => {
    const imgs = (s.images || []).slice(0, 12);
    return `
<section class="gz" data-fx="grid-zoom-16">
  <div class="gz__wrap">
    <div class="gz__content">
      <h2 class="display">${esc(s.title)}</h2>
      <div class="gz__more">${s.text ? `<p>${esc(s.text)}</p>` : ""}${s.cta ? `<a class="btn btn-primary" href="${esc(link(s.cta.href))}">${esc(s.cta.label)}${arrow}</a>` : ""}</div>
    </div>
    <div class="gz__gal"><ul class="gz__grid">${imgs.map(im => `<li class="gz__item"><img src="${esc(imgUrl(im, 900))}" alt="${esc(im.alt || "")}" loading="lazy"></li>`).join("")}</ul></div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="grid-zoom-16"]');
  if (!sec || !window.__fx.FX) return;
  var grid = sec.querySelector('.gz__grid'), items = Array.prototype.slice.call(sec.querySelectorAll('.gz__item'));
  var content = sec.querySelector('.gz__content'), title = content.querySelector('h2'), more = sec.querySelector('.gz__more');
  var cols = [[], [], []];
  items.forEach(function(it, i){ cols[i % 3].push(it); });
  var dy = function(){ var h = window.innerHeight; return h - (h - grid.offsetHeight) / 2; };
  var tl = gsap.timeline({ scrollTrigger: { trigger: sec, start: 'top 25%', end: 'bottom bottom', scrub: true, invalidateOnRefresh: true } });
  tl.to(title, { opacity: 1, duration: 0.35, ease: 'power1.out' }, 0);
  cols.forEach(function(col, ci){
    var fromTop = ci % 2 === 0;
    if (col.length) tl.from(col, { y: function(){ return dy() * (fromTop ? -1 : 1); }, duration: 1, ease: 'power1.inOut', stagger: { each: 0.06, from: fromTop ? 'end' : 'start' } }, 'reveal');
  });
  var half = Math.floor(cols[1].length / 2);
  tl.to(grid, { scale: 2.05, duration: 1, ease: 'power3.inOut' }, 'zoom-=0.6')
    .to(cols[0], { xPercent: -40, duration: 1, ease: 'power3.inOut' }, '<')
    .to(cols[2], { xPercent: 40, duration: 1, ease: 'power3.inOut' }, '<')
    .to(cols[1], { yPercent: function(i){ return (i < half ? -1 : 1) * 50; }, duration: 0.5, ease: 'power1.inOut' }, '-=0.5')
    .to(content, { y: function(){ return -more.offsetHeight / 2 - 12; }, duration: 0.5, ease: 'power2.inOut' }, '-=0.32')
    .to(more, { opacity: 1, pointerEvents: 'auto', duration: 0.4, ease: 'power1.inOut' }, '<+=0.1')
    .to({}, { duration: 0.3 });
})();`,
};
export default c;
