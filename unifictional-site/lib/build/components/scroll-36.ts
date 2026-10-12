// @ts-nocheck
// scroll-36 · Rows of captioned thumbnails that widen around their centre as they travel up the screen (Awwwards Pack, React demo rebuilt in plain JS).
// The demo's per-frame width loop is kept (reads batched before writes and
// only while the section is in view); the flat item list is cut into rows.
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
  id: "scroll-36",
  type: "rows-widen",
  kind: "section",
  weight: "medium",
  describe: "rows-widen (scroll-36): a centred title, then a wall of 3-6 rows of captioned photos (name left, year or place right, in small mono type). A row is small and dense when it enters at the bottom of the screen and widens steadily around its centre as it travels up, so each photo is over half the screen wide by the time the row leaves at the top, the rest spilling off both sides. Needs 9-30 photos with a 1-3 word name and a short meta (year, place) each, in rows of 3-5 (set perRow). A project index for builders, landscapers, architects, photographers and studios with many jobs to show.",
  fields: `{"type":"rows-widen","component":"scroll-36","title":"","perRow":4,"items":[{"query":"","alt":"","title":"","meta":""},{"query":"","alt":"","title":"","meta":""},{"query":"","alt":"","title":"","meta":""},{"query":"","alt":"","title":"","meta":""},{"query":"","alt":"","title":"","meta":""},{"query":"","alt":"","title":"","meta":""},{"query":"","alt":"","title":"","meta":""},{"query":"","alt":"","title":"","meta":""},{"query":"","alt":"","title":"","meta":""},{"query":"","alt":"","title":"","meta":""},{"query":"","alt":"","title":"","meta":""},{"query":"","alt":"","title":"","meta":""}]}`,
  images: { min: 9, max: 30 },
  css: () => `
.rw{padding:clamp(4rem,10vh,8rem) 0;overflow:hidden}
.rw .sec-head{grid-template-columns:1fr;padding:0 var(--gutter);text-align:center}
.rw .sec-head h2{margin:0 auto}
.rw__rows{display:flex;flex-direction:column;align-items:center;gap:.75rem;padding:.5rem 0;overflow:hidden}
.rw__row{width:125%;flex:none;display:flex;gap:1rem}
.rw__card{flex:1;min-width:0;margin:0;display:flex;flex-direction:column}
.rw__img{aspect-ratio:7/5;overflow:hidden;background:var(--bg2)}
.rw__img img{width:100%;height:100%;object-fit:cover}
.rw__cap{display:flex;justify-content:space-between;gap:1rem;padding:.35rem 0 0;font-family:var(--mono);font-size:.62rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink2);white-space:nowrap;overflow:hidden}
.rw__cap span{overflow:hidden;text-overflow:ellipsis}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .rw__rows{display:grid;grid-template-columns:1fr 1fr;gap:1rem .6rem;padding:0 var(--gutter);height:auto!important}
  .rw__row{display:contents;width:auto!important}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, 30);
    const per = Math.max(3, Math.min(5, parseInt(s.perRow, 10) || 4));
    const rows = [];
    for (let i = 0; i < items.length; i += per) rows.push(items.slice(i, i + per).map((it, j) => [it, i + j]));
    const last = rows[rows.length - 1];
    if (rows.length > 1 && last && last.length < per) rows.pop();
    return `
<section class="rw" data-fx="rows-widen" data-per="${per}">
  ${s.title ? `<div class="sec-head"><h2 class="display reveal">${esc(s.title)}</h2></div>` : ""}
  <div class="rw__rows">${rows.map(row => `<div class="rw__row">${row.map(([it, i]) => {
    const p = pic(it, s, i);
    const u = p ? imgUrl(p, 1000) : "";
    return `<figure class="rw__card"><div class="rw__img">${u ? `<img src="${esc(u)}" alt="${esc(it.alt || p.alt || it.title || "")}" loading="lazy">` : ""}</div><figcaption class="rw__cap"><span>${esc(it.title || "")}</span><span>${esc(it.meta || "")}</span></figcaption></figure>`;
  }).join("")}</div>`).join("")}</div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="rows-widen"]');
  if (!sec || !window.__fx.FX) return;
  var box = sec.querySelector('.rw__rows');
  var rows = Array.prototype.slice.call(sec.querySelectorAll('.rw__row'));
  if (!box || !rows.length) return;
  var per = +sec.getAttribute('data-per') || 4;
  var startW = 125, endW = per * 55;
  function fixHeight(){
    var r0 = rows[0]; r0.style.width = endW + '%'; var h = r0.offsetHeight; r0.style.width = '';
    var cs = getComputedStyle(box), gap = parseFloat(cs.rowGap || cs.gap) || 0, pad = parseFloat(cs.paddingTop) || 0;
    box.style.height = Math.round(h * rows.length + gap * (rows.length - 1) + pad * 2) + 'px';
  }
  fixHeight();
  var inView = false;
  if (window.IntersectionObserver) new IntersectionObserver(function(es){ inView = es[0].isIntersecting; }, { rootMargin: '20% 0px' }).observe(sec);
  else inView = true;
  function tick(){
    if (!inView) return;
    var y = window.scrollY, vh = window.innerHeight, widths = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i].getBoundingClientRect();
      var top = r.top + y, bottom = top + r.height;
      var p = (y - (top - vh)) / (bottom - (top - vh));
      p = Math.max(0, Math.min(1, p));
      widths.push(startW + (endW - startW) * p);
    }
    for (var j = 0; j < rows.length; j++) rows[j].style.width = widths[j] + '%';
  }
  gsap.ticker.add(tick);
  var rt; window.addEventListener('resize', function(){ clearTimeout(rt); rt = setTimeout(function(){ fixHeight(); ScrollTrigger.refresh(); }, 200); });
  var imgs = sec.querySelectorAll('img'), pending = 0;
  function done(){ if (--pending <= 0) { fixHeight(); ScrollTrigger.refresh(); } }
  imgs.forEach(function(im){ if (!im.complete) { pending++; im.addEventListener('load', done, { once: true }); im.addEventListener('error', done, { once: true }); } });
})();`,
};
export default c;
