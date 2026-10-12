// @ts-nocheck
// mouse-20 · Dot-matrix image lit by a pixel trail (Awwwards Pack, video only: recreated from the preview).
// One photo rendered as a dim halftone of accent-coloured dots on a 2D canvas; the cursor lights
// the cells it passes as bright squares in a ragged trail that cools back down in about a second.
import type { Component } from "./_types";

const c: Component = {
  id: "mouse-20",
  type: "dot-matrix",
  kind: "section",
  weight: "medium",
  describe: "(recreated from the preview video) dot-matrix (mouse-20): a full-screen dark-ish stage where one high-contrast photo is drawn as a dim halftone of small dots in the accent colour (brighter parts of the photo get bigger dots). A huge 1-3 word headline sits along the bottom edge in display type and a short 15-30 word blurb sits top right. As the cursor moves across the stage the cells under it light up as bright accent-coloured squares with a soft white smear at the pointer, leaving a ragged trail that fades back to dots in about a second, so visitors 'wipe' the picture into view. Needs one photo with a clear bright subject on a dark or plain background (hands at work, a product on a dark table, a silhouette). Phones and reduced motion show the plain photo with the headline under it. A striking opener or divider for studios, makers, tech and product brands.",
  fields: `{"type":"dot-matrix","component":"mouse-20","headline":"","text":"","image":{"query":"","alt":""}}`,
  images: { min: 1, max: 1 },
  css: () => `
.dm{position:relative;overflow:hidden;background:var(--bg)}
.dm__stage{position:relative;height:100svh}
.dm__cv{position:absolute;inset:0;width:100%;height:100%;display:block}
.dm__img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0}
.dm.is-static .dm__img{position:relative;opacity:1;height:auto;aspect-ratio:4/5}
.dm.is-static .dm__stage{height:auto}
.dm.is-static .dm__cv{display:none}
.dm__text{position:absolute;top:clamp(5rem,12vh,7rem);right:var(--gutter);max-width:30ch;font-size:.92rem;line-height:1.5;color:var(--ink2);text-align:right;pointer-events:none}
.dm__copy{position:absolute;left:var(--gutter);right:var(--gutter);bottom:clamp(1.2rem,4vh,3rem);pointer-events:none}
.dm__copy h2{font-size:clamp(2.6rem,10vw,11rem);line-height:.88;max-width:12ch}
.dm.is-static{display:flex;flex-direction:column}
.dm.is-static .dm__copy{order:2;position:static;padding:1.5rem var(--gutter) 1rem}
.dm.is-static .dm__text{order:3;position:static;max-width:60ch;text-align:left;padding:0 var(--gutter) 3rem}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .dm{display:flex;flex-direction:column}
  .dm__copy{order:2}.dm__text{order:3;padding-top:0}
  .dm__stage{height:auto}
  .dm__cv{display:none}
  .dm__img{position:relative;opacity:1;height:auto;aspect-ratio:4/5}
  .dm__text{position:static;max-width:60ch;text-align:left;padding:1.5rem var(--gutter) 0}
  .dm__copy{position:static;padding:1.5rem var(--gutter) 1rem}
  .dm__text{padding:0 var(--gutter) 3rem}
  .dm__copy h2{font-size:clamp(2.4rem,13vw,5rem)}
}`,
  html: (s, { esc, imgUrl }) => `
<section class="dm" data-fx="dot-matrix">
  <div class="dm__stage">
    <img class="dm__img" src="${esc(imgUrl(s.image, 1400))}" alt="${esc(s.image?.alt || "")}" crossorigin="anonymous" loading="lazy">
    <canvas class="dm__cv" aria-hidden="true"></canvas>
  </div>
  ${s.text ? `<p class="dm__text">${esc(s.text)}</p>` : ""}
  <div class="dm__copy"><h2 class="display">${esc(s.headline || "")}</h2></div>
</section>`,
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="dot-matrix"]');
  if (!sec) return;
  var img = sec.querySelector('.dm__img'), cv = sec.querySelector('.dm__cv');
  if (!window.__fx.FX || !window.matchMedia('(pointer: fine)').matches || !cv.getContext) { sec.classList.add('is-static'); return; }
  var ctx = cv.getContext('2d');
  var accent = (getComputedStyle(sec).getPropertyValue('--accent') || '').trim() || '#ff7a1a';
  var CELL = 9, R = 36, cols = 0, rows = 0, W = 0, H = 0, bright, heat, noise, base = null, built = false;
  var px = -1e4, py = -1e4, gx = -1e4, gy = -1e4, lx = -1e4, ly = -1e4, running = false, inView = false, lastMove = 0;
  function build(){
    W = cv.clientWidth; H = cv.clientHeight; if (!W || !H || !img.naturalWidth) return;
    cv.width = W; cv.height = H; cols = Math.ceil(W / CELL); rows = Math.ceil(H / CELL);
    var off = document.createElement('canvas'); off.width = cols; off.height = rows; var oc = off.getContext('2d');
    var iw = img.naturalWidth, ih = img.naturalHeight, sc = Math.max(cols / iw, rows / ih), dw = iw * sc, dh = ih * sc;
    oc.drawImage(img, (cols - dw) / 2, (rows - dh) / 2, dw, dh);
    var data;
    try { data = oc.getImageData(0, 0, cols, rows).data; } catch (e) { sec.classList.add('is-static'); return; }
    var n = cols * rows; bright = new Float32Array(n); heat = new Float32Array(n); noise = new Float32Array(n);
    var lo = 1, hi = 0;
    for (var i = 0; i < n; i++) { var v = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255; bright[i] = v; noise[i] = Math.random(); if (v < lo) lo = v; if (v > hi) hi = v; }
    var span = Math.max(0.2, hi - lo);
    for (i = 0; i < n; i++) bright[i] = Math.pow(Math.max(0, (bright[i] - lo) / span), 1.4);
    base = document.createElement('canvas'); base.width = W; base.height = H; var bc = base.getContext('2d'); bc.fillStyle = accent;
    for (var j = 0; j < rows; j++) for (i = 0; i < cols; i++) { var b = bright[j * cols + i]; if (b < 0.06) continue; bc.globalAlpha = 0.1 + b * 0.32; bc.beginPath(); bc.arc(i * CELL + CELL / 2, j * CELL + CELL / 2, CELL * 0.14 + CELL * 0.32 * b, 0, 6.2832); bc.fill(); }
    built = true; draw();
  }
  function draw(){
    ctx.clearRect(0, 0, W, H); ctx.drawImage(base, 0, 0); ctx.fillStyle = accent;
    var any = false;
    for (var j = 0; j < rows; j++) for (var i = 0; i < cols; i++) {
      var k = j * cols + i, h = heat[k]; if (h <= 0) continue;
      if (h < 0.03) { heat[k] = 0; continue; }
      any = true; heat[k] = h * 0.93;
      var b = bright[k]; if (b < 0.1) continue;
      var a = Math.min(1, h * (0.45 + b)); if (a < noise[k] * 0.3) continue;
      ctx.globalAlpha = a; ctx.fillRect(i * CELL + 1, j * CELL + 1, CELL - 2, CELL - 2);
    }
    ctx.globalAlpha = 1;
    gx += (px - gx) * 0.3; gy += (py - gy) * 0.3;
    if (gx > -100) { var g = ctx.createRadialGradient(gx, gy, 0, gx, gy, 28); g.addColorStop(0, 'rgba(255,255,255,.5)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(gx - 28, gy - 28, 56, 56); }
    return any || Math.abs(px - gx) + Math.abs(py - gy) > 0.5;
  }
  function tick(){ if (!built) return; if (!draw() && performance.now() - lastMove > 200) { gsap.ticker.remove(tick); running = false; } }
  function run(){ if (!running && built && inView) { running = true; gsap.ticker.add(tick); } }
  function stamp(x, y){
    var c0 = Math.max(0, Math.floor((x - R) / CELL)), c1 = Math.min(cols - 1, Math.ceil((x + R) / CELL)), r0 = Math.max(0, Math.floor((y - R) / CELL)), r1 = Math.min(rows - 1, Math.ceil((y + R) / CELL));
    for (var j = r0; j <= r1; j++) for (var i = c0; i <= c1; i++) { var dx = i * CELL + CELL / 2 - x, dy = j * CELL + CELL / 2 - y, d = Math.sqrt(dx * dx + dy * dy) / R; if (d > 1) continue; var k = j * cols + i; var v = (1 - d) * (0.6 + noise[k] * 0.7); if (v > heat[k]) heat[k] = Math.min(1, v); }
  }
  sec.querySelector('.dm__stage').addEventListener('mousemove', function(e){
    if (!built) return;
    var rc = cv.getBoundingClientRect(), x = e.clientX - rc.left, y = e.clientY - rc.top;
    lastMove = performance.now();
    if (lx > -1e3) { var dx = x - lx, dy = y - ly, dist = Math.sqrt(dx * dx + dy * dy), steps = Math.max(1, Math.ceil(dist / (CELL * 0.8))); for (var s = 1; s <= steps; s++) stamp(lx + dx * s / steps, ly + dy * s / steps); } else stamp(x, y);
    lx = px = x; ly = py = y; run();
  }, { passive: true });
  sec.querySelector('.dm__stage').addEventListener('mouseleave', function(){ lx = ly = -1e4; px = py = -1e4; run(); });
  function ready(){ if (img.complete && img.naturalWidth) build(); else img.addEventListener('load', build, { once: true }); }
  new IntersectionObserver(function(es){ es.forEach(function(en){ inView = en.isIntersecting; if (inView && !built) ready(); if (inView) run(); }); }, { rootMargin: '80px 0px' }).observe(sec);
  var rw = 0; new ResizeObserver(function(){ var w = cv.clientWidth; if (built && Math.abs(w - rw) > 2) { rw = w; build(); } else rw = w; }).observe(cv);
  window.addEventListener('pagehide', function(){ gsap.ticker.remove(tick); });
})();`,
};
export default c;
