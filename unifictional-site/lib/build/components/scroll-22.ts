// @ts-nocheck
// scroll-22 · Tall photos load in as a mosaic of huge colour blocks that sharpen in steps, titles drifting over them (Awwwards Pack).
import type { Component } from "./_types";

function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}

const c: Component = {
  id: "scroll-22",
  type: "pixel-load-22",
  kind: "section",
  weight: "medium",
  describe: "pixel-load-22 (scroll-22): a title and intro, then 3-8 big portrait photos stacked down the page, each nearly a screen tall and alternating left and right with the next one's edge peeking in. A photo first appears as a mosaic of a few huge colour blocks; once a fifth of it is in view it steps through finer and finer pixel grids to full sharpness in about half a second, like an image loading on a slow connection. A large title (2-4 words) and a short line (meta, e.g. place and year) ride up over each photo faster than the photo itself. For lookbooks, portfolios and 'the work' pages of photographers, fashion, interiors and architecture; on phones the photos are simply sharp with captions underneath.",
  fields: `{"type":"pixel-load-22","component":"scroll-22","title":"","intro":"","items":[{"query":"","alt":"","title":"","meta":""},{"query":"","alt":"","title":"","meta":""},{"query":"","alt":"","title":"","meta":""}]}`,
  images: { min: 3, max: 8 },
  css: ({ pair, capsRule }) => `
.pxl{padding:clamp(4rem,10vh,8rem) var(--gutter)}
.pxl__list{display:grid;gap:clamp(3rem,10vh,8rem)}
.pxl__item{position:relative;margin:0;width:min(100%,62vw);justify-self:start}
.pxl__item:nth-child(even){justify-self:end}
.pxl__img{position:relative;aspect-ratio:3/4;overflow:hidden;background:var(--bg2)}
.pxl__img img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0}
.pxl__img canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.pxl__img.is-sharp img{opacity:1}
.pxl__img.is-sharp canvas{display:none}
.pxl__cap{position:absolute;left:0;right:0;bottom:-1rem;padding:0 clamp(1rem,2vw,2rem);display:grid;gap:.4rem;text-align:right;justify-items:end;color:#fff;mix-blend-mode:difference;pointer-events:none;will-change:transform}
.pxl__item:nth-child(even) .pxl__cap{text-align:left;justify-items:start}
.pxl__cap h3{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}font-size:clamp(2.4rem,7vw,7rem);line-height:.85}
.pxl__cap .mono{color:#fff;opacity:.8}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .pxl__list{gap:2.5rem}
  .pxl__item{width:100%}
  .pxl__img img{opacity:1}
  .pxl__img canvas{display:none}
  .pxl__cap{position:static;mix-blend-mode:normal;color:var(--ink);padding:1rem 0 0;text-align:left;justify-items:start;transform:none!important}
  .pxl__cap h3{font-size:2rem}
  .pxl__cap .mono{color:var(--ink2)}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, 8);
    const fig = (it, i) => {
      const p = pic(it, s, i);
      return `
  <figure class="pxl__item">
    <div class="pxl__img">${p ? `<img src="${esc(imgUrl(p, 1400))}" alt="${esc(it.alt || p.alt || it.title || "")}" loading="lazy" crossorigin="anonymous"><canvas aria-hidden="true"></canvas>` : ""}</div>
    <figcaption class="pxl__cap"><h3>${esc(it.title || "")}</h3>${it.meta ? `<span class="mono">${esc(it.meta)}</span>` : ""}</figcaption>
  </figure>`;
    };
    return `
<section class="pxl" id="work" data-fx="pixel-load-22">
  <div class="sec-head"><h2 class="display reveal">${esc(s.title || "")}</h2>${s.intro ? `<p class="reveal">${esc(s.intro)}</p>` : ""}</div>
  <div class="pxl__list">${items.map(fig).join("")}</div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="pixel-load-22"]');
  if (!sec) return;
  if (!window.__fx.FX) { sec.querySelectorAll('.pxl__img').forEach(function(w){ w.classList.add('is-sharp'); }); return; }
  var STEPS = [1, 2, 4, 9, 18];
  var tmp = document.createElement('canvas'), tctx = tmp.getContext('2d');
  sec.querySelectorAll('.pxl__item').forEach(function(item){
    var wrap = item.querySelector('.pxl__img'), img = wrap.querySelector('img'), cv = wrap.querySelector('canvas'), cap = item.querySelector('.pxl__cap');
    gsap.fromTo(cap, { yPercent: 40 }, { yPercent: -120, ease: 'none', scrollTrigger: { trigger: item, start: 'top bottom', end: 'bottom top', scrub: true } });
    if (!img || !cv) return;
    var ctx = cv.getContext('2d'), step = 0, running = false, done = false;
    function size(){ var r = wrap.getBoundingClientRect(); cv.width = Math.max(2, Math.round(r.width)); cv.height = Math.max(2, Math.round(r.height)); }
    function draw(pct){
      if (!img.naturalWidth) return;
      var W = cv.width, H = cv.height, w = Math.max(1, Math.round(W * pct / 100)), h = Math.max(1, Math.round(H * pct / 100));
      tmp.width = w; tmp.height = h;
      var ir = img.naturalWidth / img.naturalHeight, cr = w / h, sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
      if (ir > cr) { sw = sh * cr; sx = (img.naturalWidth - sw) / 2; } else { sh = sw / cr; sy = (img.naturalHeight - sh) / 2; }
      tctx.imageSmoothingEnabled = true; tctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
      ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, W, H); ctx.drawImage(tmp, 0, 0, w, h, 0, 0, W, H);
    }
    function finish(){ done = true; wrap.classList.add('is-sharp'); }
    function run(){
      if (running || done) return; running = true;
      function next(){ if (step >= STEPS.length) return finish(); draw(STEPS[step]); step++; setTimeout(next, step === 1 ? 300 : 90); }
      next();
    }
    function ready(fn){ if (img.complete && img.naturalWidth) fn(); else { img.addEventListener('load', fn, { once: true }); img.addEventListener('error', finish, { once: true }); } }
    ready(function(){ size(); draw(STEPS[0]); });
    ScrollTrigger.create({ trigger: item, start: 'top+=20% bottom', once: true, onEnter: function(){ ready(function(){ size(); run(); }); } });
  });
})();`,
};
export default c;
