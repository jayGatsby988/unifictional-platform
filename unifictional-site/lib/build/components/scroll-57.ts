// @ts-nocheck
// scroll-57 · A loose two-column gallery whose photos sharpen in five discrete pixel jumps as they cross the bottom of the screen (Awwwards Pack, recreated from the preview video).
import type { Component } from "./_types";

function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}
const RATIO = ["4/3", "4/5", "1/1", "3/4", "16/10", "4/5", "1/1", "4/3"];

const c: Component = {
  id: "scroll-57",
  type: "pixel-steps-57",
  kind: "section",
  weight: "medium",
  describe: "(recreated from the preview video) pixel-steps-57 (scroll-57): a centred title and intro, then 3-8 photos of mixed ratios in a loose, staggered two-column layout, the right column offset downward, each with a small monospace caption ('Title — meta', e.g. project and year). As a photo crosses the bottom of the screen it is first drawn as about 8 flat colour blocks across, then 16, 32, 64, 128, then sharp: five discrete jumps over about 0.7 s, fired once per photo. Selected-work galleries for photographers, architects, designers, builders and makers; on phones the photos are sharp in one column.",
  fields: `{"type":"pixel-steps-57","component":"scroll-57","title":"","intro":"","items":[{"query":"","alt":"","title":"","meta":""},{"query":"","alt":"","title":"","meta":""},{"query":"","alt":"","title":"","meta":""},{"query":"","alt":"","title":"","meta":""}]}`,
  images: { min: 3, max: 8 },
  css: () => `
.pxs{padding:clamp(4rem,10vh,8rem) var(--gutter)}
.pxs .sec-head{text-align:center;grid-template-columns:1fr;justify-items:center}
.pxs .sec-head p{justify-self:center}
.pxs__grid{display:grid;grid-template-columns:1fr 1fr;gap:clamp(3rem,8vw,8rem) clamp(2rem,6vw,7rem);align-items:start}
.pxs__col:last-child{margin-top:clamp(6rem,18vh,14rem)}
.pxs__col{display:grid;gap:clamp(3rem,8vw,8rem)}
.pxs__item{margin:0;display:grid;gap:.7rem;width:min(100%,var(--w))}
.pxs__col:first-child .pxs__item:nth-child(even){justify-self:end}
.pxs__col:last-child .pxs__item:nth-child(odd){justify-self:end}
.pxs__img{position:relative;aspect-ratio:var(--ar);overflow:hidden;background:var(--bg2)}
.pxs__img img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0}
.pxs__img canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.pxs__img.is-sharp img{opacity:1}
.pxs__img.is-sharp canvas{display:none}
.pxs__cap{font-family:var(--mono);font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink2)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .pxs__grid{grid-template-columns:1fr;gap:2.5rem}
  .pxs__col{gap:2.5rem}
  .pxs__col:last-child{margin-top:0}
  .pxs__item{width:100%;justify-self:start!important}
  .pxs__img img{opacity:1}
  .pxs__img canvas{display:none}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, 8);
    const fig = (it, i) => {
      const p = pic(it, s, i);
      const w = ["100%", "78%", "88%", "70%", "100%", "82%", "74%", "92%"][i % 8];
      return `<figure class="pxs__item" style="--ar:${RATIO[i % RATIO.length]};--w:${w}"><div class="pxs__img">${p ? `<img src="${esc(imgUrl(p, 1200))}" alt="${esc(it.alt || p.alt || it.title || "")}" loading="lazy" crossorigin="anonymous"><canvas aria-hidden="true"></canvas>` : ""}</div><figcaption class="pxs__cap">${esc(it.title || "")}${it.meta ? ` — ${esc(it.meta)}` : ""}</figcaption></figure>`;
    };
    const left = items.filter((_, i) => i % 2 === 0), right = items.filter((_, i) => i % 2 === 1);
    return `
<section class="pxs" id="work" data-fx="pixel-steps-57">
  <div class="sec-head"><h2 class="display reveal">${esc(s.title || "")}</h2>${s.intro ? `<p class="reveal">${esc(s.intro)}</p>` : ""}</div>
  <div class="pxs__grid">
    <div class="pxs__col">${left.map((it) => fig(it, items.indexOf(it))).join("")}</div>
    <div class="pxs__col">${right.map((it) => fig(it, items.indexOf(it))).join("")}</div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="pixel-steps-57"]');
  if (!sec) return;
  if (!window.__fx.FX) { sec.querySelectorAll('.pxs__img').forEach(function(w){ w.classList.add('is-sharp'); }); return; }
  var COLS = [8, 16, 32, 64, 128];
  var tmp = document.createElement('canvas'), tctx = tmp.getContext('2d');
  sec.querySelectorAll('.pxs__img').forEach(function(wrap){
    var img = wrap.querySelector('img'), cv = wrap.querySelector('canvas');
    if (!img || !cv) return;
    var ctx = cv.getContext('2d'), done = false;
    function size(){ var r = wrap.getBoundingClientRect(); cv.width = Math.max(2, Math.round(r.width)); cv.height = Math.max(2, Math.round(r.height)); }
    function draw(cols){
      if (!img.naturalWidth) return;
      var W = cv.width, H = cv.height, w = Math.min(cols, W), h = Math.max(1, Math.round(w * H / W));
      tmp.width = w; tmp.height = h;
      var ir = img.naturalWidth / img.naturalHeight, cr = W / H, sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
      if (ir > cr) { sw = sh * cr; sx = (img.naturalWidth - sw) / 2; } else { sh = sw / cr; sy = (img.naturalHeight - sh) / 2; }
      tctx.imageSmoothingEnabled = true; tctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
      ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, W, H); ctx.drawImage(tmp, 0, 0, w, h, 0, 0, W, H);
    }
    function finish(){ done = true; wrap.classList.add('is-sharp'); }
    function run(){
      if (done) return;
      var o = { i: 0 }, last = -1;
      size(); draw(COLS[0]);
      gsap.to(o, { i: COLS.length, duration: 0.75, ease: 'steps(' + COLS.length + ')', onUpdate: function(){ var k = Math.round(o.i); if (k === last) return; last = k; if (k >= COLS.length) finish(); else draw(COLS[k]); }, onComplete: finish });
    }
    function ready(fn){ if (img.complete && img.naturalWidth) fn(); else { img.addEventListener('load', fn, { once: true }); img.addEventListener('error', finish, { once: true }); } }
    ready(function(){ size(); draw(COLS[0]); });
    ScrollTrigger.create({ trigger: wrap, start: 'top 92%', once: true, onEnter: function(){ ready(run); } });
  });
})();`,
};
export default c;
