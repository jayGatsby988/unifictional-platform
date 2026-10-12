// @ts-nocheck
// grid-7 · Scroll-staged image wall that scatters, tiles, curves and zooms (Awwwards Pack, video only: recreated from the preview).
// A pinned stage of 12-20 photo tiles in CSS 3D moves through four states as the page scrolls:
// scattered in depth, a tidy wall with thin gutters, a curved ring around the viewer, and a zoom
// into the first photo with the headline over it. No WebGL.
import type { Component } from "./_types";

function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}

const c: Component = {
  id: "grid-7",
  type: "wall-stages",
  kind: "section",
  weight: "medium",
  describe: "(recreated from the preview video) wall-stages (grid-7): a pinned full-screen stage holding 12-20 photos of one look that rearrange themselves four times as you scroll, about one screen per state: first scattered at random depths and tilts, then gathering into a tidy wall of tiles with thin gutters, then bending into a curved ring that wraps around the viewer, and finally the first photo swelling to fill the screen while the rest fly out of frame. A 2-6 word headline fades in as the ring forms and stays over the final full-screen photo, with an optional one-sentence intro beneath it at the end. Phones and reduced motion show the headline and a plain two-column grid of the photos. The main portfolio moment for photographers, interior designers, architects, florists, fashion and any brand with a consistent photo library.",
  fields: `{"type":"wall-stages","component":"grid-7","headline":"","intro":"","items":[{"query":"","alt":""}]}`,
  images: { min: 12, max: 20 },
  css: () => `
.wall{height:500svh;background:var(--bg)}
.wall__pin{position:sticky;top:0;height:100svh;overflow:hidden}
.wall__stage{position:absolute;inset:0;perspective:1400px;transform-style:preserve-3d}
.wall__tile{position:absolute;left:50%;top:50%;width:var(--tw,160px);height:var(--th,200px);margin:calc(var(--th,200px)/-2) 0 0 calc(var(--tw,160px)/-2);overflow:hidden;background:var(--bg2);will-change:transform,opacity;backface-visibility:hidden}
.wall__tile img{width:100%;height:100%;object-fit:cover}
.wall__scrim{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.55),rgba(0,0,0,.1) 55%,rgba(0,0,0,0));opacity:0;pointer-events:none}
.wall__copy{position:absolute;left:var(--gutter);right:var(--gutter);bottom:clamp(2rem,8vh,5rem);display:grid;gap:1rem;color:#fff;opacity:0;pointer-events:none;text-shadow:0 2px 30px rgba(0,0,0,.35)}
.wall__copy h2{font-size:clamp(2.4rem,7vw,7rem);max-width:12ch}
.wall__copy p{max-width:42ch;color:rgba(255,255,255,.8);opacity:0}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .wall{height:auto;padding:4rem 0 3rem}
  .wall__pin{position:static;height:auto;overflow:visible}
  .wall__stage{position:static;perspective:none;display:grid;grid-template-columns:1fr 1fr;gap:.5rem;padding:0 var(--gutter)}
  .wall__tile{position:static;margin:0;width:auto;height:auto;aspect-ratio:4/5;transform:none!important;opacity:1!important}
  .wall__scrim{display:none}
  .wall__copy{position:static;opacity:1!important;color:var(--ink);text-shadow:none;padding:0 var(--gutter) 2rem;order:-1}
  .wall__copy p{opacity:1!important;color:var(--ink2)}
  .wall__pin{display:flex;flex-direction:column}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, 20);
    const tiles = items.map((it, i) => {
      const p = pic(it, s, i);
      return `<div class="wall__tile">${p ? `<img src="${esc(imgUrl(p, i === 0 ? 1800 : 700))}" alt="${esc(it.alt || p.alt || "")}" loading="lazy">` : ""}</div>`;
    }).join("");
    return `
<section class="wall" data-fx="wall-stages">
  <div class="wall__pin">
    <div class="wall__stage">${tiles}</div>
    <div class="wall__scrim"></div>
    <div class="wall__copy"><h2 class="display">${esc(s.headline || "")}</h2>${s.intro ? `<p>${esc(s.intro)}</p>` : ""}</div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="wall-stages"]');
  if (!sec || !window.__fx.FX) return;
  var stage = sec.querySelector('.wall__stage'), tiles = Array.prototype.slice.call(sec.querySelectorAll('.wall__tile')), copy = sec.querySelector('.wall__copy'), intro = copy.querySelector('p'), scrim = sec.querySelector('.wall__scrim');
  var n = tiles.length; if (n < 4) return;
  var tl = null, st = null, builtW = 0;
  function rnd(i){ var x = Math.sin(i * 9301 + 49297) * 233280; return x - Math.floor(x); }
  function build(){
    var vw = window.innerWidth, vh = window.innerHeight, g = 6;
    var cols = n <= 12 ? 4 : 5, rows = Math.ceil(n / cols);
    var th = Math.min((vh * 0.84 - (rows - 1) * g) / rows, ((vw * 0.86 - (cols - 1) * g) / cols) * 1.25), tw = th / 1.25;
    stage.style.setProperty('--tw', tw + 'px'); stage.style.setProperty('--th', th + 'px');
    var A = [], B = [], C = [], D = [], ringRows = n > 12 ? 3 : 2, perRow = Math.ceil(n / ringRows), R = Math.max(vw * 0.42, 420), zoom = Math.max(vw / tw, vh / th) * 1.04;
    for (var i = 0; i < n; i++) {
      A.push({ x: (rnd(i) - 0.5) * vw * 1.15, y: (rnd(i + 7) - 0.5) * vh * 1.05, z: -1000 + rnd(i + 13) * 1150, rotationY: (rnd(i + 3) - 0.5) * 50, rotationZ: (rnd(i + 5) - 0.5) * 18, scale: 1, opacity: 0.9 });
      var c = i % cols, r = Math.floor(i / cols);
      B.push({ x: (c - (cols - 1) / 2) * (tw + g), y: (r - (rows - 1) / 2) * (th + g), z: 0, rotationY: 0, rotationZ: 0, scale: 1, opacity: 1 });
      var row = i % ringRows, idx = Math.floor(i / ringRows), a = (idx / Math.max(1, perRow - 1) - 0.5) * 1.75;
      C.push({ x: Math.sin(a) * R, y: (row - (ringRows - 1) / 2) * th * (ringRows > 2 ? 0.7 : 0.62) * (ringRows > 2 ? 0.85 : 1), z: Math.cos(a) * R - R * 0.95, rotationY: a * 57.3, rotationZ: 0, scale: ringRows > 2 ? 0.78 : 0.9, opacity: 1 });
      D.push(i === 0 ? { x: 0, y: 0, z: 0, rotationY: 0, rotationZ: 0, scale: zoom, opacity: 1 } : { x: B[i].x * 3.2, y: B[i].y * 3.2, z: 500, rotationY: 0, rotationZ: 0, scale: 1, opacity: 0 });
    }
    if (tl) { tl.kill(); } if (st) st.kill();
    tiles.forEach(function(t, i){ gsap.set(t, A[i]); });
    gsap.set(tiles[0], { zIndex: 2 });
    tl = gsap.timeline({ paused: true, defaults: { duration: 1, ease: 'power2.inOut' } });
    tiles.forEach(function(t, i){ tl.to(t, B[i], 0.1 + i * 0.015); });
    tl.to(copy, { opacity: 1, duration: 0.5 }, 2.2).to(scrim, { opacity: 0.6, duration: 0.5 }, 2.2);
    tiles.forEach(function(t, i){ tl.to(t, C[i], 1.7 + i * 0.015); });
    tiles.forEach(function(t, i){ tl.to(t, D[i], 3.3 + (i ? 0 : 0.1)); });
    if (intro) tl.to(intro, { opacity: 1, duration: 0.4 }, 4.1);
    tl.to({}, { duration: 0.3 });
    st = ScrollTrigger.create({ trigger: sec, start: 'top top', end: 'bottom bottom', scrub: 0.6, animation: tl });
    builtW = vw;
  }
  build();
  window.addEventListener('resize', function(){ if (Math.abs(window.innerWidth - builtW) > 80) build(); });
})();`,
};
export default c;
