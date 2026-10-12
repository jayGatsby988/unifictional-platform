// @ts-nocheck
// mouse-4 · X-ray reveal blob following the cursor (Awwwards Pack, video only: recreated from the preview).
// A text block with a hidden second layer (the photo with the same words in white) that shows
// only inside a liquid, hard-edged blob trailing the pointer; it melts away when the pointer rests.
import type { Component } from "./_types";

const c: Component = {
  id: "mouse-4",
  type: "xray-reveal",
  kind: "section",
  weight: "light",
  describe: "(recreated from the preview video) xray-reveal (mouse-4): a tall calm panel with a 4-10 word headline in big display type and one short paragraph (40-90 words) on the page background. Hidden underneath is a second layer: a full-bleed photo, darkened, with the same headline and paragraph in white. Moving the cursor over the panel opens an irregular liquid blob that trails along the pointer's path and shows that hidden layer, like an x-ray or a torch beam with a hard rippling edge; a second after the pointer rests the blob shrinks and vanishes. Needs one strong photo (a workshop, a kitchen, a crew at work) that pays off when discovered. Phones and reduced motion show the text with the photo under it. Good as a 'what we really do' or manifesto block for studios, trades, restaurants and anything with a behind-the-scenes photo.",
  fields: `{"type":"xray-reveal","component":"mouse-4","eyebrow":"","headline":"","text":"","image":{"query":"","alt":""}}`,
  images: { min: 1, max: 1 },
  css: () => `
.xr{position:relative;min-height:88svh;display:grid;overflow:hidden;background:var(--bg)}
.xr__base,.xr__reveal{grid-area:1/1;display:flex;align-items:center;padding:clamp(5rem,12vh,9rem) var(--gutter)}
.xr__copy{display:grid;gap:1.6rem;max-width:62rem}
.xr__copy .mono{color:var(--accent)}
.xr__copy h2{font-size:clamp(2.4rem,6.6vw,7rem);max-width:14ch}
.xr__copy p{max-width:52ch;font-size:clamp(1.05rem,1.4vw,1.3rem);line-height:1.55;color:var(--ink2)}
.xr__reveal{position:absolute;inset:0;z-index:1;color:#fff;clip-path:circle(min(24vw,300px) at 74% 56%);will-change:clip-path;pointer-events:none}
.xr__reveal>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.xr__tint{position:absolute;inset:0;background:rgba(0,0,0,.42)}
.xr__reveal .xr__copy{position:relative;z-index:1}
.xr__reveal .xr__copy .mono{color:#fff}
.xr__reveal .xr__copy p{color:rgba(255,255,255,.85)}
.xr__static{display:none}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .xr{min-height:0;display:block}
  .xr__base{padding:4rem var(--gutter) 2.5rem}
  .xr__reveal{display:none}
  .xr__static{display:block;width:100%;aspect-ratio:4/3;object-fit:cover}
}`,
  html: (s, { esc, imgUrl }) => {
    const copy = `<div class="xr__copy">${s.eyebrow ? `<span class="mono">${esc(s.eyebrow)}</span>` : ""}<h2 class="display">${esc(s.headline || "")}</h2>${s.text ? `<p>${esc(s.text)}</p>` : ""}</div>`;
    const src = esc(imgUrl(s.image, 1800)), alt = esc(s.image?.alt || "");
    return `
<section class="xr" data-fx="xray-reveal">
  <div class="xr__base">${copy}</div>
  <div class="xr__reveal" aria-hidden="true"><img src="${src}" alt="" loading="lazy"><div class="xr__tint"></div>${copy}</div>
  <img class="xr__static" src="${src}" alt="${alt}" loading="lazy">
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="xray-reveal"]');
  if (!sec || !window.__fx.FX || !window.matchMedia('(pointer: fine)').matches) return;
  var layer = sec.querySelector('.xr__reveal');
  var stamps = [], running = false, lastT = -1e9, lx = -1e9, ly = -1e9, MAX = 16;
  function blob(x, y, r, seed, t){
    var n = 20, d = '';
    for (var i = 0; i < n; i++) {
      var a = i / n * 6.2832;
      var rr = r * (1 + 0.16 * Math.sin(a * 3 + seed + t * 0.0025) + 0.1 * Math.sin(a * 5 - seed * 2 - t * 0.0035));
      d += (i ? 'L' : 'M') + (x + Math.cos(a) * rr).toFixed(1) + ' ' + (y + Math.sin(a) * rr).toFixed(1);
    }
    return d + 'Z';
  }
  function tick(){
    var now = performance.now(), idle = now - lastT > 120, d = '';
    for (var i = stamps.length - 1; i >= 0; i--) {
      var s = stamps[i];
      if (idle || now - s.born > 420) s.tr *= idle ? 0.86 : 0.94;
      s.r += (s.tr - s.r) * 0.3;
      if (s.r < 2) { stamps.splice(i, 1); continue; }
      d += blob(s.x, s.y, s.r, s.seed, now);
    }
    layer.style.clipPath = d ? 'path("' + d + '")' : ''; // no stamps: back to the resting window from the stylesheet
    if (!stamps.length) { gsap.ticker.remove(tick); running = false; }
  }
  function run(){ if (!running) { running = true; gsap.ticker.add(tick); } }
  var R = Math.max(110, Math.min(200, window.innerWidth * 0.11));
  sec.addEventListener('mousemove', function(e){
    var rc = layer.getBoundingClientRect(), x = e.clientX - rc.left, y = e.clientY - rc.top;
    lastT = performance.now();
    if (Math.abs(x - lx) + Math.abs(y - ly) > 18) {
      lx = x; ly = y;
      stamps.push({ x: x, y: y, r: R * 0.35, tr: R * (0.75 + Math.random() * 0.35), seed: Math.random() * 6.28, born: lastT });
      if (stamps.length > MAX) stamps.shift();
    }
    run();
  }, { passive: true });
  sec.addEventListener('mouseleave', function(){ lastT = -1e9; lx = ly = -1e9; run(); });
})();`,
};
export default c;
