// @ts-nocheck
// 3d-18 · Circular image vortex: five arms on a ring keep emitting small photo tiles
// that slide along the ring's tangent, then swing into the centre and shrink away
// (Awwwards Pack, "cosmos"). The demo animated top/left on 50 nodes; this port
// moves the tiles with transforms only and keeps the ring inside the viewport.
import type { Component } from "./_types";

const ARMS = 5, PER_ARM = 8, LOOP = 5; // seconds per tile cycle

function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}

const c: Component = {
  id: "3d-18",
  type: "image-vortex",
  kind: "section",
  weight: "light",
  describe: "image-vortex (3d-18): a full-screen dark stage with a short headline (and an optional line under it) centred on it, while five points on a large invisible ring around the text keep emitting small tall photo tiles: each one fades in, slides sideways along the ring, then swings in toward the centre and shrinks to nothing, so the screen reads as a slow whirlpool of photos that never ends. It is pure CSS and keeps looping; nothing reacts to scroll or the pointer. Needs 8-16 photos (they repeat across the arms) and a headline of 1-4 words. A moody opener or divider for photographers, studios, galleries, venues, festivals and fashion or beauty brands; phones get the headline over a plain grid of the photos.",
  fields: `{"type":"image-vortex","component":"3d-18","headline":"","sub":"","items":[{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""}]}`,
  images: { min: 8, max: 16 },
  css: ({ t }) => `
.vortex{position:relative;height:100svh;min-height:560px;overflow:hidden;background:${t.dark ? "var(--bg)" : "var(--inv-bg)"};color:${t.dark ? "var(--ink)" : "var(--inv-ink)"};display:flex;align-items:center;justify-content:center}
.vortex__ring{position:absolute;left:50%;top:50%;width:0;height:0;--r:min(44vh,38vw)}
.vortex__arm{position:absolute;left:0;top:0;width:clamp(64px,6vw,96px);aspect-ratio:8/15;margin:-7.5% 0 0 -4%;transform:rotate(var(--a)) translate(var(--r));transform-style:flat}
.vortex__tile{position:absolute;inset:0;transform-origin:50% 100%;transform:scale(0);opacity:0;overflow:hidden;background:${t.dark ? "var(--bg2)" : "#1a1a1c"};animation:vortex-fall ${LOOP}s infinite ease-in-out;animation-delay:var(--d);will-change:transform,opacity}
.vortex__tile img{width:100%;height:100%;object-fit:cover}
.vortex__copy{position:relative;z-index:2;text-align:center;padding:0 var(--gutter);display:grid;gap:.8rem;justify-items:center}
.vortex__copy h2{font-size:clamp(2rem,4.5vw,4.4rem);max-width:14ch}
.vortex__copy p{max-width:40ch;font-size:1.05rem;opacity:.7}
.vortex__static{display:none}
@keyframes vortex-fall{0%{opacity:0;transform:translate(0,0) scale(1)}25%{opacity:1}50%{opacity:1;transform:translate(0,-220%) scale(1)}100%{opacity:1;transform:translate(-340%,-160%) scale(0)}}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .vortex{height:auto;min-height:0;flex-direction:column;gap:2rem;padding:5rem 0 3rem}
  .vortex__ring{display:none}
  .vortex__static{display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem;padding:0 var(--gutter);width:100%}
  .vortex__static img{width:100%;aspect-ratio:8/15;object-fit:cover}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).map((it, i) => ({ p: pic(it, s, i), alt: it.alt || "" })).filter(x => x.p).slice(0, 16);
    const n = items.length;
    const tile = (k) => { const it = items[k % n]; return `<img src="${esc(imgUrl(it.p, 400))}" alt="${esc(it.alt || it.p.alt || "")}" loading="lazy">`; };
    const arms = n ? Array.from({ length: ARMS }, (_, a) => `<div class="vortex__arm" style="--a:${a * (360 / ARMS)}deg">${Array.from({ length: PER_ARM }, (_, j) => `<div class="vortex__tile" style="--d:${(j * LOOP / PER_ARM).toFixed(3)}s">${tile(a * 3 + j)}</div>`).join("")}</div>`).join("") : "";
    const stat = n ? `<div class="vortex__static">${items.slice(0, 8).map(it => `<img src="${esc(imgUrl(it.p, 400))}" alt="${esc(it.alt || it.p.alt || "")}" loading="lazy">`).join("")}</div>` : "";
    return `
<section class="vortex" data-fx="image-vortex">
  <div class="vortex__ring" aria-hidden="true">${arms}</div>
  <div class="vortex__copy">${s.headline ? `<h2 class="display">${esc(s.headline)}</h2>` : ""}${s.sub ? `<p>${esc(s.sub)}</p>` : ""}</div>
  ${stat}
</section>`;
  },
};
export default c;
