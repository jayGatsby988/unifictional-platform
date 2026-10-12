// @ts-nocheck
// mouse-16 · Cursor image trail with switchable mask styles (Awwwards Pack, video only: recreated from the preview).
// Like mouse-9 but denser and each card is clipped to a shape (circle, rounded square, blob,
// hexagon or stepped slats) chosen from spec.theme.cursorStyle.mask, else cycling through them.
import type { Component } from "./_types";

const MASKS = {
  circle: "circle(50% at 50% 50%)",
  rounded: "inset(0 round 22%)",
  blob: "polygon(50% 0%, 84% 10%, 100% 42%, 92% 78%, 64% 100%, 28% 97%, 4% 74%, 0% 40%, 18% 10%)",
  hexagon: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
  slats: "polygon(0 0, 100% 0, 100% 20%, 88% 20%, 88% 40%, 100% 40%, 100% 60%, 88% 60%, 88% 80%, 100% 80%, 100% 100%, 0 100%, 0 80%, 12% 80%, 12% 60%, 0 60%, 0 40%, 12% 40%, 12% 20%, 0 20%)",
};

const c: Component = {
  id: "mouse-16",
  type: "cursor",
  kind: "cursor",
  weight: "light",
  describe: "(recreated from the preview video) masked cursor trail (mouse-16): a site-wide cursor effect. Fast mouse movement drops a dense chain of small photo cards (up to eight alive) along the pointer's path at random tilts, each clipped to a shape: a circle, a rounded square, an organic blob, a hexagon or a stepped slat edge. The shape is fixed site-wide when theme.cursorStyle.mask names one ('circle', 'rounded', 'blob', 'hexagon' or 'slats'); otherwise every card takes the next shape in turn. Cards flash in slightly larger the faster the mouse goes, then shrink and fade within a second; slow moves leave nothing. Photos come from the page's own images and the menu's page previews, with plain accent tiles as a fallback. Does nothing on touch screens or with reduced motion. For bold, playful brands: streetwear, events, music, creative studios.",
  fields: `theme: {"cursor":"mouse-16","cursorStyle":{"mask":"blob"}}`,
  css: ({ pair }) => `
.cmask{position:fixed;inset:0;z-index:45;pointer-events:none;overflow:hidden}
.cmask__card{position:absolute;top:0;left:0;width:clamp(68px,7.4vw,124px);aspect-ratio:1/1;overflow:hidden;opacity:0;will-change:transform,opacity;background:var(--accent);color:var(--on-accent);display:grid;place-items:center}
.cmask__card img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none}
.cmask__card.has-img img{display:block}
.cmask__card span{font-family:var(--display);font-weight:${pair.weight};font-size:1.6rem;line-height:1}
.cmask__card.has-img span{display:none}
@media(pointer:coarse),(prefers-reduced-motion:reduce),(max-width:767px){.cmask{display:none}}`,
  html: (_, { spec, esc, imgUrl }) => {
    const nav = (spec.nav?.links || []).map(l => l.image?.url ? imgUrl(l.image, 600) : "").filter(Boolean);
    const initial = String(spec.brand?.name || "").trim().charAt(0).toUpperCase() || "·";
    const mask = String(spec.theme?.cursorStyle?.mask || "").toLowerCase();
    return `<div class="cmask" data-fx="cursor-mask-16" aria-hidden="true" data-nav="${esc(JSON.stringify(nav))}" data-initial="${esc(initial)}" data-mask="${esc(MASKS[mask] ? mask : "")}"></div>`;
  },
  js: () => `
(function(){
  var root = document.querySelector('[data-fx="cursor-mask-16"]');
  if (!root || window.__fx.RM || window.__fx.SMALL || window.matchMedia('(pointer: coarse)').matches || !window.matchMedia('(pointer: fine)').matches) return;
  var MASKS = ${JSON.stringify(MASKS)}, ORDER = ['circle', 'rounded', 'blob', 'hexagon', 'slats'];
  var fixed = root.getAttribute('data-mask') || '';
  var nav = []; try { nav = JSON.parse(root.getAttribute('data-nav') || '[]'); } catch (e) {}
  var MAX = 8, pool = [], srcs = [], k = 0, next = 0, z = 1, m = 0, lastX = 0, lastY = 0, lastT = 0, dist = 0, has = false;
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
    var card = document.createElement('div'); card.className = 'cmask__card';
    card.innerHTML = '<img alt=""><span>' + (root.getAttribute('data-initial') || '') + '</span>';
    root.appendChild(card); pool.push(card);
  }
  function spawn(x, y, speed){
    if (!srcs.length) collect();
    var card = pool[next++ % MAX], img = card.firstChild, w = card.offsetWidth, h = card.offsetHeight;
    if (card._tl) card._tl.kill();
    if (srcs.length) { img.src = srcs[k++ % srcs.length]; card.classList.add('has-img'); } else card.classList.remove('has-img');
    card.style.clipPath = MASKS[fixed || ORDER[m++ % ORDER.length]];
    card.style.zIndex = String(z++);
    var s = Math.min(1.3, 0.85 + speed * 0.18);
    card._tl = gsap.timeline()
      .fromTo(card, { x: x - w / 2 + (Math.random() - 0.5) * 24, y: y - h / 2 + (Math.random() - 0.5) * 24, rotation: (Math.random() - 0.5) * 50, scale: 0.4, opacity: 0 }, { scale: s, opacity: 1, duration: 0.22, ease: 'power3.out' })
      .to(card, { scale: 0.5, opacity: 0, rotation: '+=12', duration: 0.5, ease: 'power2.in' }, 0.4);
  }
  document.addEventListener('pointermove', function(e){
    if (e.pointerType && e.pointerType !== 'mouse') return;
    var t = performance.now();
    if (!has) { has = true; lastX = e.clientX; lastY = e.clientY; lastT = t; return; }
    var dx = e.clientX - lastX, dy = e.clientY - lastY, dt = Math.max(1, t - lastT), d = Math.sqrt(dx * dx + dy * dy), speed = d / dt;
    lastX = e.clientX; lastY = e.clientY; lastT = t;
    dist += d;
    if (speed < 0.6) { dist = Math.min(dist, 30); return; }
    if (dist >= 70) { dist = 0; spawn(e.clientX, e.clientY, speed); }
  }, { passive: true });
  window.addEventListener('load', collect);
})();`,
};
export default c;
