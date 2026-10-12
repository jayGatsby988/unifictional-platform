// @ts-nocheck
// scroll-31 · Dual-column sine-wave index: two columns of labels sway in mirrored sine waves as you scroll, the row
// nearest the viewport centre lights up and a thumbnail between the columns swaps to it (Awwwards Pack).
// The demo's ScrollSmoother is replaced by the site's Lenis.
import type { Component } from "./_types";

const c: Component = {
  id: "scroll-31",
  type: "wave-index-31",
  kind: "section",
  weight: "light",
  describe: "wave-index-31 (scroll-31): an index of 8-16 rows under an optional title. Each row has a name on the left (a service, project, client or area, 1-3 words) and a short note on the right (place, year, category). As you scroll, every row is pushed sideways by a different amount so the left column sways in a sine wave and the right column mirrors it; the row nearest the middle of the screen turns full ink while the rest stay faint, and when rows have photos a small thumbnail floating between the columns stays at screen centre and switches to that row's photo. Rows can link to pages. A long list that feels alive: services, project archives, service areas, client lists. Phones show a plain list of name and note.",
  fields: `{"type":"wave-index-31","component":"scroll-31","title":"","intro":"","items":[{"title":"","meta":"","href":"","query":"","alt":""},{"title":"","meta":"","href":"","query":"","alt":""},{"title":"","meta":"","href":"","query":"","alt":""}]}`,
  images: { min: 0, max: 16 },
  css: ({ pair, capsRule }) => `
.wix{padding:clamp(4rem,10vh,8rem) var(--gutter)}
.wix__wrap{position:relative;display:flex;gap:clamp(3rem,22vw,26rem);padding:4vh 0}
.wix__col{flex:1;display:flex;flex-direction:column;gap:1.2rem;position:relative;z-index:2;min-width:0}
.wix__col--l{align-items:flex-start}
.wix__col--r{align-items:flex-end;text-align:right}
.wix__row{display:block;width:max-content;max-width:100%;font-family:var(--display);font-weight:${pair.weight};font-size:clamp(1.3rem,3vw,2.7rem);line-height:.95;letter-spacing:${pair.track};${capsRule}color:var(--ink3);transition:color .3s ease-out;will-change:transform;white-space:nowrap}
.wix__row.is-on{color:var(--ink)}
.wix__col--r .wix__row{font-weight:400;color:var(--ink3)}
.wix__thumb{position:absolute;top:0;left:50%;transform:translateX(-50%);width:clamp(8rem,15vw,16rem);z-index:1;pointer-events:none;will-change:transform}
.wix__thumb img{width:100%;aspect-ratio:3/4;object-fit:cover;display:block}
.wix__thumb[hidden]{display:none}
.wix__list{display:none}
@media(prefers-reduced-motion:reduce){
  .wix__row{transform:none!important}
  .wix__thumb{display:none}
}
@media(max-width:767px){
  .wix__wrap{display:none}
  .wix__list{display:block}
  .wix__list li{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;padding:1rem 0;border-top:1px solid var(--line)}
  .wix__list li:last-child{border-bottom:1px solid var(--line)}
  .wix__list a,.wix__list span.t{font-family:var(--display);font-weight:${pair.weight};font-size:1.4rem;letter-spacing:${pair.track};${capsRule}}
  .wix__list .m{text-align:right}
}`,
  html: (s, { esc, imgUrl, link }) => {
    const items = (s.items || []).slice(0, 16);
    const img = (it) => it.image?.url ? imgUrl(it.image, 800) : "";
    const first = items.find(it => img(it));
    const name = (it) => it.href ? `<a class="wix__row" href="${esc(link(it.href))}" data-img="${esc(img(it))}">${esc(it.title)}</a>` : `<span class="wix__row" data-img="${esc(img(it))}">${esc(it.title)}</span>`;
    return `
<section class="wix" data-fx="wave-index-31">
  ${s.title ? `<div class="sec-head"><h2 class="display reveal">${esc(s.title)}</h2>${s.intro ? `<p class="reveal">${esc(s.intro)}</p>` : ""}</div>` : ""}
  <div class="wix__wrap">
    <div class="wix__col wix__col--l">${items.map(name).join("")}</div>
    <div class="wix__thumb"${first ? "" : " hidden"}><img src="${esc(first ? img(first) : "")}" alt="" loading="lazy"></div>
    <div class="wix__col wix__col--r" aria-hidden="true">${items.map(it => `<span class="wix__row">${esc(it.meta || "")}</span>`).join("")}</div>
  </div>
  <ul class="wix__list">${items.map(it => `<li>${it.href ? `<a href="${esc(link(it.href))}">${esc(it.title)}</a>` : `<span class="t">${esc(it.title)}</span>`}<span class="mono m">${esc(it.meta || "")}</span></li>`).join("")}</ul>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="wave-index-31"]');
  if (!sec || !window.__fx.FX) return;
  var wrap = sec.querySelector('.wix__wrap'), colL = sec.querySelector('.wix__col--l'), colR = sec.querySelector('.wix__col--r');
  var L = Array.prototype.slice.call(colL.querySelectorAll('.wix__row')), R = Array.prototype.slice.call(colR.querySelectorAll('.wix__row'));
  var thumb = sec.querySelector('.wix__thumb'), thumbImg = thumb.querySelector('img');
  if (!L.length || !R.length) return;
  var WAVE = 1.2, SPEED = 1.5, rangeL = 0, rangeR = 0, current = thumbImg.getAttribute('src') || '';
  var setL = L.map(function(el){ return gsap.quickTo(el, 'x', { duration: 0.6, ease: 'power4.out' }); });
  var setR = R.map(function(el){ return gsap.quickTo(el, 'x', { duration: 0.6, ease: 'power4.out' }); });
  function ranges(){
    var wl = 0, wr = 0;
    L.forEach(function(el){ wl = Math.max(wl, el.offsetWidth); }); R.forEach(function(el){ wr = Math.max(wr, el.offsetWidth); });
    rangeL = Math.max(0, colL.offsetWidth - wl); rangeR = Math.max(0, colR.offsetWidth - wr);
  }
  function pos(i, p, range){ var ph = WAVE * i + SPEED * p * Math.PI * 2 - Math.PI / 2; return (Math.sin(ph) + 1) / 2 * range; }
  function focus(){
    var mid = window.innerHeight / 2, best = 0, d = Infinity;
    L.forEach(function(el, i){ var r = el.getBoundingClientRect(), c = r.top + r.height / 2, dd = Math.abs(c - mid); if (dd < d) { d = dd; best = i; } });
    return best;
  }
  function update(p, instant){
    var f = focus();
    L.forEach(function(el, i){ var x = pos(i, p, rangeL); if (instant) gsap.set(el, { x: x }); else setL[i](x); el.classList.toggle('is-on', i === f); });
    R.forEach(function(el, i){ var x = -pos(i, p, rangeR); if (instant) gsap.set(el, { x: x }); else setR[i](x); el.classList.toggle('is-on', i === f); });
    if (thumb.hidden) return;
    var src = L[f].getAttribute('data-img');
    if (src && src !== current) { current = src; thumbImg.src = src; }
    var wr = wrap.getBoundingClientRect(), th = thumb.offsetHeight;
    var y = window.innerHeight / 2 - wr.top - th / 2;
    gsap.set(thumb, { y: Math.max(-th / 2, Math.min(wrap.offsetHeight - th / 2, y)) });
  }
  ranges();
  var st = ScrollTrigger.create({ trigger: wrap, start: 'top bottom', end: 'bottom top', onUpdate: function(self){ update(self.progress); },
    onRefresh: function(self){ ranges(); update(self.progress, true); } });
  update(st.progress, true);
})();`,
};
export default c;
