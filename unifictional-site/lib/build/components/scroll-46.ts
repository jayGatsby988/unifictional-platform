// @ts-nocheck
// scroll-46 · A column of photos that snakes left and right as you scroll, each opening to full width mid-screen (Awwwards Pack).
import type { Component } from "./_types";

const RATIOS = ["3/2", "4/3", "5/4", "7/5"];

// Item image: the resolver's {url} on it.image, else a parallel s.images entry, else a URL written in query.
function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}

const c: Component = {
  id: "scroll-46",
  type: "wave-column",
  kind: "section",
  weight: "light",
  describe: "wave-column (scroll-46): a centred title, then 5-9 landscape photos stacked in one tall column that snakes left and right as you scroll: each photo slides sideways along a sine wave while crossing the screen, enters cropped to a narrow vertical strip, opens to its full width at mid-screen and narrows again on the way out. The last two are a little smaller. Each photo has a short caption {title}. A long, calm image run for food, editorial, interiors, craft and portfolio brands; put it between two text sections.",
  fields: `{"type":"wave-column","component":"scroll-46","title":"","items":[{"query":"","alt":"","title":""}]}`,
  images: { min: 5, max: 9 },
  css: () => `
.wave{padding:clamp(4rem,10vh,8rem) 0;overflow:hidden}
.wave .sec-head{grid-template-columns:1fr;padding:0 var(--gutter);text-align:center}
.wave .sec-head h2{margin:0 auto;max-width:16ch}
.wave__col{display:flex;flex-direction:column;align-items:flex-start}
.wave__item{margin:0;display:grid;gap:.5rem;will-change:transform}
.wave__img{height:calc(min(375px,50vw) * var(--k,1));aspect-ratio:var(--ar);overflow:hidden;clip-path:inset(0 20% 0 20%);will-change:clip-path;background:var(--bg2)}
.wave__img img{width:100%;height:100%;object-fit:cover}
.wave__cap{font-family:var(--mono);font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink2)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .wave__col{padding:0 var(--gutter);gap:2rem}
  .wave__item{transform:none!important;width:100%}
  .wave__img{height:auto;width:100%;aspect-ratio:4/3;clip-path:none!important}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, 9);
    const n = items.length;
    const shrinkStart = Math.floor(n * 0.75);
    return `
<section class="wave" data-fx="wave-column">
  <div class="sec-head"><h2 class="display reveal">${esc(s.title || "")}</h2></div>
  <div class="wave__col">${items.map((it, i) => {
    const p = pic(it, s, i);
    const u = p ? imgUrl(p, 1200) : "";
    const k = i >= shrinkStart ? 1 - ((i - shrinkStart + 1) / (n - shrinkStart)) * 0.5 : 1;
    return `<figure class="wave__item" style="--ar:${RATIOS[i % RATIOS.length]};--k:${k.toFixed(3)}"><div class="wave__img">${u ? `<img src="${esc(u)}" alt="${esc(it.alt || p.alt || it.title || "")}" loading="lazy">` : ""}</div>${it.title ? `<figcaption class="wave__cap">${esc(it.title)}</figcaption>` : ""}</figure>`;
  }).join("")}</div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="wave-column"]');
  if (!sec || !window.__fx.FX) return;
  var items = Array.prototype.slice.call(sec.querySelectorAll('.wave__item'));
  var n = items.length; if (!n) return;
  var W = { base: { amp: 0.1, freq: 1, speed: 1, phase: 5 }, flow: { amp: 0.15, freq: 5, speed: 5, phase: 10 }, detail: { amp: 0.025, freq: 5, speed: 1.5, phase: 2.5 } };
  items.forEach(function(item, i){
    var box = item.querySelector('.wave__img');
    var t = n > 1 ? i / (n - 1) : 0;
    function place(p){
      var vw = sec.clientWidth;
      var b = Math.sin(t * W.base.freq + (1 - p) * W.base.speed + W.base.phase);
      var f = 0.5 + Math.sin(t * W.flow.freq + W.flow.phase + p * W.flow.speed);
      var d = 0.5 + Math.sin(t * W.detail.freq + W.detail.phase + p * W.detail.speed);
      var x = (vw - item.offsetWidth) / 2 - vw * 0.1 + b * vw * W.base.amp + f * vw * W.flow.amp + d * vw * W.detail.amp;
      var clip = Math.pow(Math.abs(p - 0.5) * 2, 2) * 20;
      gsap.set(item, { x: x });
      box.style.clipPath = 'inset(0 ' + clip + '% 0 ' + clip + '%)';
    }
    ScrollTrigger.create({ trigger: item, start: 'top bottom', end: 'bottom top',
      onUpdate: function(self){ place(self.progress); },
      onRefresh: function(self){ place(self.progress); } });
  });
})();`,
};
export default c;
