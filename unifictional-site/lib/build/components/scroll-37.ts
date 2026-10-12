// @ts-nocheck
// scroll-37 · A photo resolves out of scrambling monospace characters: cells fill in at random, dark cells flicker, then the picture cuts in (Awwwards Pack).
import type { Component } from "./_types";

const c: Component = {
  id: "scroll-37",
  type: "ascii-reveal",
  kind: "section",
  weight: "medium",
  describe: "ascii-reveal (scroll-37): a two-column block, a 3-8 word headline with an optional paragraph (20-60 words) and small label on the left, one portrait photo (4:5) on the right. When the block scrolls into view the photo's frame is empty page colour, then fills in cell by cell, in random order over about a second and a half, with grey monospace characters that draw the picture as ASCII art; dark areas keep flickering between dense glyphs a moment longer, and once every cell has settled the real photo cuts in. Plays once. Needs exactly one photo. An 'about' or 'studio' moment for tech-minded brands, studios, barbers, makers and anyone who wants a nerdy signature; on phones the photo simply shows.",
  fields: `{"type":"ascii-reveal","component":"scroll-37","label":"","headline":"","text":"","cta":{"label":"","href":"about"},"image":{"query":"","alt":""}}`,
  images: { min: 1, max: 1 },
  css: ({ pair, capsRule }) => `
.asc{padding:clamp(4rem,10vh,8rem) var(--gutter);display:grid;gap:clamp(2rem,5vw,5rem);align-items:center}
@media(min-width:900px){.asc{grid-template-columns:1.1fr 1fr}}
.asc__copy{display:grid;gap:1.4rem;max-width:40rem}
.asc__copy h2{font-size:clamp(2.2rem,4.8vw,4.8rem);max-width:16ch}
.asc__copy p{color:var(--ink2);font-size:1.08rem;max-width:48ch}
.asc__img{position:relative;aspect-ratio:4/5;overflow:hidden;background:var(--bg);justify-self:center;width:min(100%,34rem)}
.asc__img img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .35s}
.asc__img canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.asc__img.is-done img{opacity:1}
.asc__img.is-done canvas{opacity:0;transition:opacity .35s}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .asc__img img{opacity:1}
  .asc__img canvas{display:none}
}`,
  html: (s, { esc, imgUrl, link, arrow }) => `
<section class="asc" data-fx="ascii-reveal">
  <div class="asc__copy">
    ${s.label ? `<div class="mono reveal">${esc(s.label)}</div>` : ""}
    <h2 class="display reveal">${esc(s.headline || "")}</h2>
    ${s.text ? `<p class="reveal">${esc(s.text)}</p>` : ""}
    ${s.cta && s.cta.label ? `<div class="reveal"><a class="btn btn-ghost" href="${esc(link(s.cta.href))}">${esc(s.cta.label)}${arrow}</a></div>` : ""}
  </div>
  <div class="asc__img"><img src="${esc(imgUrl(s.image, 1200))}" alt="${esc(s.image?.alt || "")}" loading="lazy" crossorigin="anonymous"><canvas aria-hidden="true"></canvas></div>
</section>`,
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="ascii-reveal"]');
  if (!sec) return;
  var wrap = sec.querySelector('.asc__img'), img = wrap.querySelector('img'), cv = wrap.querySelector('canvas');
  if (!window.__fx.FX || !cv) { wrap.classList.add('is-done'); return; }
  var CHARS = '........:::=+xX#0369', COLS = 32, DENSE = CHARS.lastIndexOf('.'), dense = CHARS.slice(DENSE + 1).split('');
  var cs = getComputedStyle(sec), BG = cs.getPropertyValue('--bg').trim() || '#111', INK = cs.getPropertyValue('--ink2').trim() || '#c8c8c8', MONO = cs.getPropertyValue('--mono').trim() || 'monospace';
  var ctx = cv.getContext('2d'), started = false;
  function done(){ wrap.classList.add('is-done'); }
  function start(){
    if (started) return; started = true;
    var r = wrap.getBoundingClientRect(), dpr = Math.min(1.5, window.devicePixelRatio || 1);
    var cw = r.width / COLS, fs = cw / 0.6, ch = fs, ROWS = Math.ceil(r.height / ch);
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG; ctx.fillRect(0, 0, r.width, r.height);
    var samp = document.createElement('canvas'); samp.width = COLS; samp.height = ROWS;
    var sctx = samp.getContext('2d'), data;
    try {
      var ir = img.naturalWidth / img.naturalHeight, cr = r.width / r.height, sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
      if (ir > cr) { sw = sh * cr; sx = (img.naturalWidth - sw) / 2; } else { sh = sw / cr; sy = (img.naturalHeight - sh) / 2; }
      sctx.drawImage(img, sx, sy, sw, sh, 0, 0, COLS, ROWS);
      data = sctx.getImageData(0, 0, COLS, ROWS).data;
    } catch (e) { return done(); }
    var total = COLS * ROWS, grid = new Array(total), idx = new Array(total);
    for (var i = 0; i < total; i++) { var b = (data[i*4] * 0.299 + data[i*4+1] * 0.587 + data[i*4+2] * 0.114) / 255; var k = Math.min(CHARS.length - 1, Math.floor((1 - b) * CHARS.length)); grid[i] = CHARS[k]; idx[i] = k; }
    ctx.font = fs + 'px ' + MONO; ctx.textBaseline = 'top';
    function cell(i, chr){ var row = Math.floor(i / COLS), col = i % COLS; ctx.fillStyle = BG; ctx.fillRect(col * cw, row * ch, cw + 1, ch + 1); ctx.fillStyle = INK; ctx.fillText(chr, col * cw, row * ch); }
    var order = []; for (var j = 0; j < total; j++) order.push(j);
    for (var m = total - 1; m > 0; m--) { var n = Math.floor(Math.random() * (m + 1)); var t = order[m]; order[m] = order[n]; order[n] = t; }
    var state = new Array(total).fill(null), settled = 0, per = Math.max(1, Math.ceil(total / 90)), p = 0;
    function finishCheck(){ if (settled >= total) setTimeout(done, 120); }
    var appear = setInterval(function(){
      for (var q = 0; q < per && p < total; q++, p++) {
        var ci = order[p], dark = idx[ci] > DENSE;
        if (!dark) { cell(ci, grid[ci]); state[ci] = 0; settled++; }
        else { cell(ci, dense[Math.floor(Math.random() * dense.length)]); state[ci] = 8; }
      }
      if (p >= total) { clearInterval(appear); finishCheck(); }
    }, 16);
    var tick = setInterval(function(){
      var live = false;
      for (var ci = 0; ci < total; ci++) {
        var rem = state[ci]; if (rem === null || rem === 0) continue; live = true;
        if (rem === 1) { cell(ci, grid[ci]); state[ci] = 0; settled++; }
        else { cell(ci, dense[Math.floor(Math.random() * dense.length)]); state[ci] = rem - 1; }
      }
      if (!live && p >= total) { clearInterval(tick); finishCheck(); }
    }, 100);
  }
  function ready(fn){ if (img.complete && img.naturalWidth) fn(); else { img.addEventListener('load', fn, { once: true }); img.addEventListener('error', done, { once: true }); } }
  ScrollTrigger.create({ trigger: wrap, start: 'top 75%', once: true, onEnter: function(){ ready(start); } });
})();`,
};
export default c;
