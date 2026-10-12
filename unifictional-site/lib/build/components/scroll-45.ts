// @ts-nocheck
// scroll-45 · Pinned glyph-band image wipe (Awwwards Pack). Full-screen
// images pin; each scroll step wipes to the next behind a ragged band of
// character cells. The demo's 8,000 DOM cells are drawn on one 2D canvas.
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
  id: "scroll-45",
  type: "glyph-wipe",
  kind: "section",
  weight: "medium",
  describe: "glyph-wipe (scroll-45): the screen pins on a full-bleed photo with a short name and a meta line in the lower left corner and an optional small eyebrow top left. Each step of scrolling wipes to the next photo from the top down: the edge of the wipe is a ragged horizontal band of small accent-coloured squares, each holding a letter, digit or symbol, that scatters and thins toward its edges like static as it travels down the screen; the caption swaps halfway. Needs 3-5 landscape photos with a 1-3 word name and a meta line (place, year). A pinned showreel for builders, architects, landscapers, studios and event venues; on phones it is a stack of photos with captions.",
  fields: `{"type":"glyph-wipe","component":"scroll-45","eyebrow":"","items":[{"query":"","alt":"","title":"","meta":""}]}`,
  images: { min: 3, max: 5 },
  css: ({ capsRule }) => `
.gw__track{position:relative}
.gw__fig{display:contents;margin:0}
.gw__stage{position:sticky;top:0;height:100svh;overflow:hidden;background:var(--inv-bg)}
.gw__img{position:absolute;inset:0;clip-path:polygon(0% 0%,100% 0%,100% 100%,0% 100%);will-change:clip-path}
.gw__img img{width:100%;height:100%;object-fit:cover}
.gw__img::after{content:"";position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.55),rgba(0,0,0,0) 45%)}
.gw__band{position:absolute;inset:0;width:100%;height:100%;z-index:20;pointer-events:none;font-family:var(--mono)}
.gw__eyebrow{position:absolute;left:var(--gutter);top:6rem;z-index:30;color:rgba(255,255,255,.8)}
.gw__caps{position:absolute;left:var(--gutter);right:var(--gutter);bottom:2.4rem;z-index:30;color:#fff;pointer-events:none}
.gw__cap{position:absolute;left:0;bottom:0;opacity:0;transition:opacity .5s var(--ease-out),transform .5s var(--ease-out);transform:translateY(10px);display:grid;gap:.5rem}
.gw__cap.is-on{opacity:1;transform:none}
.gw__cap h3{font-size:clamp(2rem,5vw,5rem);${capsRule}}
.gw__cap .mono{color:rgba(255,255,255,.75)}
.gw__cap .gw__i{font-family:var(--mono);font-size:.68rem;letter-spacing:.2em;color:rgba(255,255,255,.75)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .gw__track{height:auto!important}
  .gw__stage{position:static;height:auto;overflow:visible;background:none;display:grid;gap:2.5rem;padding:3rem var(--gutter)}
  .gw__fig{display:block}
  .gw__img{position:relative;inset:auto;aspect-ratio:4/5;clip-path:none!important}
  .gw__img::after{display:none}
  .gw__band,.gw__caps,.gw__eyebrow{display:none}
  .gw__m{display:grid;gap:.4rem;padding-top:.8rem;color:var(--ink)}
  .gw__m h3{font-size:clamp(1.6rem,8vw,2.6rem)}
}
@media(min-width:768px) and (prefers-reduced-motion:no-preference){.gw__m{display:none}}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, 5);
    const n = items.length;
    return `
<section class="gw" data-fx="glyph-wipe">
  <div class="gw__track" style="height:${n * 100}svh">
    <div class="gw__stage">
      ${items.map((it, i) => {
        const p = pic(it, s, i);
        const u = p ? imgUrl(p, 2000) : "";
        return `<figure class="gw__fig"><div class="gw__img" style="z-index:${n - i}">${u ? `<img src="${esc(u)}" alt="${esc(it.alt || p.alt || it.title || "")}" loading="${i === 0 ? "eager" : "lazy"}">` : ""}</div><figcaption class="gw__m"><h3 class="display">${esc(it.title || "")}</h3>${it.meta ? `<div class="mono">${esc(it.meta)}</div>` : ""}</figcaption></figure>`;
      }).join("")}
      <canvas class="gw__band" aria-hidden="true"></canvas>
      ${s.eyebrow ? `<div class="gw__eyebrow mono">${esc(s.eyebrow)}</div>` : ""}
      <div class="gw__caps">${items.map((it, i) => `<div class="gw__cap${i === 0 ? " is-on" : ""}"><span class="gw__i">${String(i + 1).padStart(2, "0")} / ${String(n).padStart(2, "0")}</span><h3 class="display">${esc(it.title || "")}</h3>${it.meta ? `<div class="mono">${esc(it.meta)}</div>` : ""}</div>`).join("")}</div>
    </div>
  </div>
</section>`;
  },
  js: ({ t }) => `
(function(){
  var sec = document.querySelector('[data-fx="glyph-wipe"]');
  if (!sec || !window.__fx.FX) return;
  var track = sec.querySelector('.gw__track'), imgs = sec.querySelectorAll('.gw__img'), caps = sec.querySelectorAll('.gw__cap'), canvas = sec.querySelector('.gw__band');
  var n = imgs.length; if (n < 2 || !canvas || !track) return;
  var g = canvas.getContext('2d'); if (!g) return;
  var CELL = 16, ABOVE = 0.25, BELOW = 0.25, SCATTER = 0.15, CORE = 0.025, MINSC = 0.3, THRESH = 0.65;
  var CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@$%&*+=?!<>{}[]';
  var ACCENT = ${JSON.stringify(t.accent)}, ON = ${JSON.stringify(t.onAccent)};
  var W = 0, H = 0, cells = [], font = '', activeCap = 0;
  function hashPos(r, c, seed){ var raw = Math.sin(r * seed + c * (seed * 2.45)) * 43758.5453; return raw - Math.floor(raw); }
  function setup(){
    W = window.innerWidth; H = window.innerHeight; var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(W * dpr); canvas.height = Math.ceil(H * dpr); canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var cols = Math.ceil(W / CELL), rows = Math.ceil(H / CELL); cells = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) cells.push({ x: c * CELL, y: r * CELL, ny: (r + 0.5) / rows, vis: hashPos(r, c, 127.1), sc: (hashPos(r, c, 269.3) - 0.5) * SCATTER, ch: CHARS[Math.floor(hashPos(r, c, 31.7) * CHARS.length)] });
    font = '500 ' + Math.round(CELL * 0.7) + 'px ' + getComputedStyle(canvas).fontFamily;
  }
  function clearBand(){ g.clearRect(0, 0, W, H); }
  function drawBand(center){
    g.clearRect(0, 0, W, H);
    var vis = [];
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var raw = Math.abs(cell.ny - center);
      var strength = Math.max(MINSC, Math.min(1, raw / CORE));
      var sd = cell.ny - center + cell.sc * strength;
      var nd = sd >= 0 ? sd / BELOW : -sd / ABOVE;
      if (nd >= 1) continue;
      var density = (1 - nd) * (1 - nd);
      if (density > cell.vis * THRESH) vis.push(cell);
    }
    g.fillStyle = ACCENT;
    for (var k = 0; k < vis.length; k++) g.fillRect(vis[k].x, vis[k].y, CELL, CELL);
    g.fillStyle = ON; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (var m = 0; m < vis.length; m++) g.fillText(vis[m].ch, vis[m].x + CELL / 2, vis[m].y + CELL / 2 + 1);
  }
  function setCap(i){ if (i === activeCap) return; activeCap = i; caps.forEach(function(cp, k){ cp.classList.toggle('is-on', k === i); }); }
  setup();
  var total = n - 1, travel = 1 + ABOVE + BELOW;
  ScrollTrigger.create({ trigger: track, start: 'top top', end: 'bottom bottom', scrub: true, onUpdate: function(self){
    var p = self.progress, raw = p * total;
    var cur = Math.min(Math.floor(raw), total - 1);
    var tp = Math.max(0, Math.min(1, raw - cur));
    for (var i = 0; i < total; i++) {
      var sp = Math.max(0, Math.min(1, (p - i / total) * total));
      var clip = Math.max(0, Math.min(100, (-ABOVE + sp * travel) * 100));
      imgs[i].style.clipPath = 'polygon(0% ' + clip + '%, 100% ' + clip + '%, 100% 100%, 0% 100%)';
    }
    setCap(tp < 0.5 ? cur : cur + 1);
    if (tp <= 0 || tp >= 1) clearBand(); else drawBand(-ABOVE + tp * travel);
  }});
  window.addEventListener('resize', setup);
})();`,
};
export default c;
