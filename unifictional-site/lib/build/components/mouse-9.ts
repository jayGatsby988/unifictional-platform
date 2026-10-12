// @ts-nocheck
// mouse-9 · Cursor image trail (Awwwards Pack, video only: recreated from the preview).
// Site-wide cursor effect: quick mouse moves leave a short ribbon of small portrait photo cards
// behind the pointer, each landing on top of the last, then shrinking away. Photos come from the
// page's own images (and the nav's page previews); with none, the cards are plain accent tiles.
import type { Component } from "./_types";

const c: Component = {
  id: "mouse-9",
  type: "cursor",
  kind: "cursor",
  weight: "light",
  describe: "(recreated from the preview video) cursor trail (mouse-9): a site-wide cursor effect. When the mouse moves quickly, small portrait photo cards (about 6% of the screen wide) spawn one after another along its path, each landing on top of the last with a slight offset and tilt, so a short ribbon of up to six overlapping photos arcs behind the pointer and melts away within a second. Slow movement leaves nothing, so reading is undisturbed. The cards reuse the photos already on the page (and the menu's page previews); on a page without photos they fall back to plain accent-coloured tiles. Does nothing on touch screens or with reduced motion. Suits playful, image-rich sites: photographers, studios, restaurants, makers.",
  fields: `theme: {"cursor":"mouse-9"}`,
  css: ({ pair }) => `
.ctrail{position:fixed;inset:0;z-index:45;pointer-events:none;overflow:hidden}
.ctrail__card{position:absolute;top:0;left:0;width:clamp(60px,6.2vw,104px);aspect-ratio:2/3;overflow:hidden;opacity:0;will-change:transform,opacity;background:var(--accent);color:var(--on-accent);display:grid;place-items:center;box-shadow:0 12px 32px rgba(0,0,0,.25)}
.ctrail__card img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none}
.ctrail__card.has-img img{display:block}
.ctrail__card span{font-family:var(--display);font-weight:${pair.weight};font-size:1.6rem;line-height:1}
.ctrail__card.has-img span{display:none}
@media(pointer:coarse),(prefers-reduced-motion:reduce),(max-width:767px){.ctrail{display:none}}`,
  html: (_, { spec, esc, imgUrl }) => {
    const nav = (spec.nav?.links || []).map(l => l.image?.url ? imgUrl(l.image, 600) : "").filter(Boolean);
    const initial = String(spec.brand?.name || "").trim().charAt(0).toUpperCase() || "·";
    return `<div class="ctrail" data-fx="cursor-trail-9" aria-hidden="true" data-nav="${esc(JSON.stringify(nav))}" data-initial="${esc(initial)}"></div>`;
  },
  js: () => `
(function(){
  var root = document.querySelector('[data-fx="cursor-trail-9"]');
  if (!root || window.__fx.RM || window.__fx.SMALL || window.matchMedia('(pointer: coarse)').matches || !window.matchMedia('(pointer: fine)').matches) return;
  var nav = []; try { nav = JSON.parse(root.getAttribute('data-nav') || '[]'); } catch (e) {}
  var MAX = 6, pool = [], srcs = [], k = 0, next = 0, z = 1, lastX = 0, lastY = 0, lastT = 0, dist = 0, has = false;
  function collect(){
    var list = [];
    document.querySelectorAll('img').forEach(function(im){
      var s = im.getAttribute('src') || ''; if (!s || /^data:/.test(s) || im.closest('.nav__brand') || im.closest('[data-fx^="cursor-"]')) return;
      if (im.naturalWidth && im.naturalWidth < 60) return;
      if (list.indexOf(s) < 0) list.push(s);
    });
    nav.forEach(function(s){ if (list.indexOf(s) < 0) list.push(s); });
    srcs = list;
  }
  for (var i = 0; i < MAX; i++) {
    var card = document.createElement('div'); card.className = 'ctrail__card';
    card.innerHTML = '<img alt=""><span>' + (root.getAttribute('data-initial') || '') + '</span>';
    root.appendChild(card); pool.push(card);
  }
  function spawn(x, y, speed){
    if (!srcs.length) collect();
    var card = pool[next++ % MAX], img = card.firstChild, w = card.offsetWidth, h = card.offsetHeight;
    if (card._tl) card._tl.kill();
    if (srcs.length) { img.src = srcs[k++ % srcs.length]; card.classList.add('has-img'); } else card.classList.remove('has-img');
    card.style.zIndex = String(z++);
    var s = Math.min(1.15, 0.9 + speed * 0.12);
    card._tl = gsap.timeline()
      .fromTo(card, { x: x - w / 2 + (Math.random() - 0.5) * 18, y: y - h / 2 + (Math.random() - 0.5) * 18, rotation: (Math.random() - 0.5) * 16, scale: 0.5, opacity: 0 }, { scale: s, opacity: 1, duration: 0.28, ease: 'power3.out' })
      .to(card, { scale: 0.7, opacity: 0, y: '+=18', duration: 0.5, ease: 'power2.in' }, 0.42);
  }
  document.addEventListener('pointermove', function(e){
    if (e.pointerType && e.pointerType !== 'mouse') return;
    var t = performance.now();
    if (!has) { has = true; lastX = e.clientX; lastY = e.clientY; lastT = t; return; }
    var dx = e.clientX - lastX, dy = e.clientY - lastY, dt = Math.max(1, t - lastT), d = Math.sqrt(dx * dx + dy * dy), speed = d / dt;
    lastX = e.clientX; lastY = e.clientY; lastT = t;
    dist += d;
    if (speed < 0.65) { dist = Math.min(dist, 40); return; }
    if (dist >= 100) { dist = 0; spawn(e.clientX, e.clientY, speed); }
  }, { passive: true });
  window.addEventListener('load', collect);
})();`,
};
export default c;
