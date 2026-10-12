// @ts-nocheck
// mouse-1 · Name list with a cursor-following warped image (Awwwards Pack, video only: recreated from the preview).
// Hairline-split rows of big names; hovering a row floats that row's photo under the cursor
// with lag, skewing and stretching in the direction of travel. Phones get thumbnails in the rows.
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
  id: "mouse-1",
  type: "hover-list",
  kind: "section",
  weight: "light",
  describe: "(recreated from the preview video) hover-list (mouse-1): a plain list of 4-8 rows split by hairlines, each a big display-type name on the left (a project, a person, a service) and a small mono note on the right (place, role, year). Nothing else is on screen until the cursor enters a row: that row's photo (portrait, about a quarter of the screen wide) fades in under the pointer and follows it with a soft lag, its edges skewing and stretching in the direction of travel like a sheet being pulled, while the other rows dim; the names stay readable over the photo. Needs one photo per row and an optional small title above the list. On phones each row shows a small thumbnail instead. Good as a project index, team list or service menu for studios, trades and makers.",
  fields: `{"type":"hover-list","component":"mouse-1","title":"","items":[{"title":"","meta":"","query":"","alt":"","href":""}]}`,
  images: { min: 4, max: 8 },
  css: ({ pair, capsRule }) => `
.hl{position:relative;isolation:isolate;padding:clamp(3rem,8vh,6rem) 0}
.hl__head{padding:0 var(--gutter);margin-bottom:1.2rem}
.hl__row{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:2rem;padding:clamp(1.1rem,3.6vh,2.4rem) var(--gutter);border-top:1px solid var(--line);font-family:var(--display);font-weight:${pair.weight};font-size:clamp(1.8rem,4.4vw,4.2rem);line-height:1;letter-spacing:${pair.track};${capsRule}color:inherit;transition:opacity .45s var(--ease-out)}
.hl__row:last-child{border-bottom:1px solid var(--line)}
.hl__left{display:flex;align-items:center;gap:1rem;min-width:0}
.hl__title{display:block}
.hl__meta{flex-shrink:0;font-family:var(--mono);font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2);font-weight:400}
.hl.is-hover .hl__row:not(.is-on){opacity:.28}
.hl__thumb{display:none}
.hl__fly{position:fixed;top:0;left:0;z-index:0;width:clamp(13rem,21vw,23rem);aspect-ratio:3/4;pointer-events:none;opacity:0;overflow:hidden;will-change:transform,opacity;background:var(--bg2)}
.hl__fly img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .35s}
.hl__fly img.is-on{opacity:1}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .hl__fly{display:none}
  .hl.is-hover .hl__row{opacity:1}
  .hl__row{font-size:clamp(1.35rem,6vw,2rem);padding:1rem var(--gutter)}
  .hl__thumb{display:block;width:54px;height:68px;object-fit:cover;flex-shrink:0;background:var(--bg2)}
}`,
  html: (s, { esc, imgUrl, link }) => {
    const items = (s.items || []).slice(0, 8);
    const rows = items.map((it, i) => {
      const p = pic(it, s, i);
      const tag = it.href ? "a" : "div";
      return `<${tag} class="hl__row" data-i="${i}"${it.href ? ` href="${esc(link(it.href))}"` : ""}><span class="hl__left">${p ? `<img class="hl__thumb" src="${esc(imgUrl(p, 400))}" alt="" loading="lazy">` : ""}<span class="hl__title">${esc(it.title || "")}</span></span><span class="hl__meta">${esc(it.meta || "")}</span></${tag}>`;
    }).join("");
    const fly = items.map((it, i) => {
      const p = pic(it, s, i);
      return p ? `<img src="${esc(imgUrl(p, 900))}" alt="${esc(it.alt || p.alt || it.title || "")}" loading="lazy" data-i="${i}">` : "";
    }).join("");
    return `
<section class="hl" data-fx="hover-list">
  ${s.title ? `<div class="hl__head mono">${esc(s.title)}</div>` : ""}
  <div class="hl__rows">${rows}</div>
  <div class="hl__fly" aria-hidden="true">${fly}</div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="hover-list"]');
  if (!sec || !window.__fx.FX || !window.matchMedia('(pointer: fine)').matches) return;
  var fly = sec.querySelector('.hl__fly'), imgs = fly.querySelectorAll('img'), rows = sec.querySelectorAll('.hl__row');
  if (!imgs.length) return;
  var tx = 0, ty = 0, cx = 0, cy = 0, vx = 0, vy = 0, on = false, running = false, cur = -1, w = 0, h = 0;
  function clamp(v, m){ return Math.max(-m, Math.min(m, v)); }
  function tick(){
    var nx = cx + (tx - cx) * 0.13, ny = cy + (ty - cy) * 0.13;
    vx += ((nx - cx) - vx) * 0.25; vy += ((ny - cy) - vy) * 0.25; cx = nx; cy = ny;
    var sk = clamp(vx * 0.55, 14), sy = clamp(vy * 0.3, 8), st = 1 + Math.min(0.18, Math.abs(vx) * 0.004 + Math.abs(vy) * 0.002);
    fly.style.transform = 'translate3d(' + (cx - w / 2).toFixed(1) + 'px,' + (cy - h / 2).toFixed(1) + 'px,0) rotate(' + (vx * 0.12).toFixed(2) + 'deg) skew(' + (-sk).toFixed(2) + 'deg,' + (-sy * 0.5).toFixed(2) + 'deg) scale(' + st.toFixed(3) + ',' + (2 - st).toFixed(3) + ')';
    if (!on && Math.abs(tx - cx) + Math.abs(ty - cy) < 0.5 && Math.abs(vx) + Math.abs(vy) < 0.05) { gsap.ticker.remove(tick); running = false; }
  }
  function run(){ if (!running) { running = true; gsap.ticker.add(tick); } }
  function show(i){
    if (i === cur) return;
    cur = i;
    imgs.forEach(function(im){ im.classList.toggle('is-on', +im.getAttribute('data-i') === i); });
    rows.forEach(function(r){ r.classList.toggle('is-on', +r.getAttribute('data-i') === i); });
  }
  rows.forEach(function(r){
    r.addEventListener('mouseenter', function(e){
      var i = +r.getAttribute('data-i');
      if (!on) { on = true; w = fly.offsetWidth; h = fly.offsetHeight; cx = tx = e.clientX; cy = ty = e.clientY; vx = vy = 0; sec.classList.add('is-hover'); gsap.to(fly, { opacity: 1, duration: 0.35, overwrite: true }); }
      show(i); run();
    });
  });
  sec.addEventListener('mousemove', function(e){ tx = e.clientX; ty = e.clientY; if (on) run(); }, { passive: true });
  sec.addEventListener('mouseleave', function(){
    on = false; cur = -1; sec.classList.remove('is-hover');
    rows.forEach(function(r){ r.classList.remove('is-on'); });
    gsap.to(fly, { opacity: 0, duration: 0.3, overwrite: true });
    run();
  });
})();`,
};
export default c;
