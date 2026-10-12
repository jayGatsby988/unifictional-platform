// @ts-nocheck
// slider-10 · Infinite drag strip with warped cards and blurred titles (Awwwards Pack, video only).
// Portrait cards and their big titles move sideways in an endless loop on a
// dark stage. Dragging flings the strip with inertia; the cards skew and
// squash with the speed, the titles are sharp only near the centre and blur
// as they leave. Rebuilt with CSS transforms + filters and GSAP instead of
// the demo's WebGL planes, so it stays a medium-weight component.
import type { Component } from "./_types";

function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}

const c: Component = {
  id: "slider-10",
  type: "drag-strip-10",
  kind: "section",
  weight: "medium",
  describe: "(recreated from the preview video) drag-strip-10 (slider-10): a dark, full-width showcase strip. Portrait photo cards (about 240 x 320) drift sideways in an endless loop, each with its project title in big display type and a small meta line beside it. Only the card nearest the centre is in colour and its title sharp; the others are monochrome and their titles blur out the further they travel. Dragging flings the strip with inertia and the cards skew and squash with the speed; arrows, dots and the arrow keys step one project at a time, and the strip drifts slowly on its own until you hover. Needs 6-12 portrait photos, each with a 1-3 word title and a short meta line (place, year, category). Suits studios, photographers, builders and makers showing a project list, collections and case studies.",
  fields: `{"type":"drag-strip-10","component":"slider-10","eyebrow":"","title":"","items":[{"query":"","alt":"","title":"","meta":""},{"query":"","alt":"","title":"","meta":""},{"query":"","alt":"","title":"","meta":""},{"query":"","alt":"","title":"","meta":""},{"query":"","alt":"","title":"","meta":""},{"query":"","alt":"","title":"","meta":""}]}`,
  images: { min: 6, max: 12 },
  css: ({ pair, capsRule }) => `
.ds10{position:relative;background:var(--inv-bg);color:var(--inv-ink);overflow:hidden;padding:clamp(4rem,10vh,8rem) 0}
.ds10 .sec-head{padding:0 var(--gutter)}
.ds10 .sec-head p{color:inherit;opacity:.7}
.ds10__stage{position:relative;height:clamp(400px,54vh,600px);cursor:grab;touch-action:pan-y;user-select:none;-webkit-user-select:none}
.ds10__stage.is-drag{cursor:grabbing}
.ds10__item{position:absolute;left:50%;top:50%;width:var(--w);height:320px;margin:-160px 0 0 calc(var(--w) / -2);display:flex;align-items:center;gap:2rem;will-change:transform;pointer-events:none}
.ds10__card{flex:0 0 240px;height:320px;overflow:hidden;background:rgba(128,128,128,.15);will-change:transform,filter;box-shadow:0 30px 60px rgba(0,0,0,.35)}
.ds10__card img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}
.ds10__text{display:grid;gap:.7rem;min-width:0}
.ds10__title{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}font-size:clamp(2rem,4vw,3.6rem);line-height:1;white-space:nowrap;will-change:filter,opacity}
.ds10__meta{font-family:var(--mono);font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;opacity:.6;display:flex;align-items:center;gap:.8rem}
.ds10__meta::before{content:"";width:22px;height:1px;background:var(--accent)}
.ds10__foot{display:flex;justify-content:space-between;align-items:center;gap:1.5rem;padding:1.5rem var(--gutter) 0}
.ds10__count{font-family:var(--mono);font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;opacity:.65}
.ds10__hint{font-family:var(--mono);font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;opacity:.45}
.ds10__nav{display:flex;align-items:center;gap:1.2rem}
.ds10__dots{display:flex;gap:.4rem}
.ds10__dot{width:18px;height:14px;position:relative}
.ds10__dot::after{content:"";position:absolute;left:0;right:0;top:6px;height:2px;background:rgba(128,128,128,.4);transition:background .3s}
.ds10__dot[aria-current="true"]::after{background:currentColor}
.ds10__ctl{display:flex;gap:.5rem}
.ds10__btn{width:48px;height:48px;border:1px solid rgba(128,128,128,.45);border-radius:999px;display:grid;place-items:center;color:inherit;transition:background .25s,color .25s,border-color .25s}
.ds10__btn:hover{background:var(--inv-ink);color:var(--inv-bg);border-color:var(--inv-ink)}
.ds10__btn svg{width:16px;height:16px}
.ds10__btn--prev svg{transform:scaleX(-1)}
.ds10.is-static .ds10__stage,.ds10__stage.is-native{height:auto;display:flex;gap:1.2rem;overflow-x:auto;scroll-snap-type:x mandatory;scroll-padding:0 var(--gutter);padding:0 var(--gutter);scrollbar-width:none;cursor:default;touch-action:pan-x pan-y}
.ds10.is-static .ds10__stage::-webkit-scrollbar{display:none}
.ds10.is-static .ds10__item{position:static;margin:0;width:auto;height:auto;flex:0 0 min(72vw,300px);flex-direction:column;align-items:flex-start;gap:1rem;scroll-snap-align:start;transform:none!important;pointer-events:auto}
.ds10.is-static .ds10__card{flex:none;width:100%;height:auto;aspect-ratio:3/4;filter:none!important;transform:none!important}
.ds10.is-static .ds10__title{white-space:normal;font-size:1.5rem;filter:none!important;opacity:1!important}
.ds10.is-static .ds10__dots,.ds10.is-static .ds10__hint{display:none}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .ds10__stage{height:auto;display:flex;gap:1.2rem;overflow-x:auto;scroll-snap-type:x mandatory;scroll-padding:0 var(--gutter);padding:0 var(--gutter);scrollbar-width:none;cursor:default;touch-action:pan-x pan-y}
  .ds10__stage::-webkit-scrollbar{display:none}
  .ds10__item{position:static;margin:0;width:auto;height:auto;flex:0 0 min(72vw,300px);flex-direction:column;align-items:flex-start;gap:1rem;scroll-snap-align:start;transform:none!important;pointer-events:auto}
  .ds10__card{flex:none;width:100%;height:auto;aspect-ratio:3/4;filter:none!important;transform:none!important}
  .ds10__title{white-space:normal;font-size:1.5rem;filter:none!important;opacity:1!important}
  .ds10__dots,.ds10__hint{display:none}
}`,
  html: (s, { esc, imgUrl, arrow }) => {
    const items = (s.items || []).filter(Boolean).slice(0, 12);
    const n = items.length;
    return `
<section class="ds10" data-fx="drag-strip-10" style="--w:680px">
  <div class="sec-head">
    <div>${s.eyebrow ? `<span class="mono reveal">${esc(s.eyebrow)}</span>` : ""}<h2 class="display reveal">${esc(s.title || "")}</h2></div>
    <p class="ds10__hint reveal">Drag to explore</p>
  </div>
  <div class="ds10__stage" aria-label="Projects">${items.map((it, i) => {
    const p = pic(it, s, i);
    return `<article class="ds10__item" data-i="${i}"><div class="ds10__card">${p ? `<img src="${esc(imgUrl(p, 800))}" alt="${esc(it.alt || p.alt || it.title || "")}" loading="lazy" draggable="false">` : ""}</div><div class="ds10__text"><h3 class="ds10__title">${esc(it.title || "")}</h3>${it.meta ? `<span class="ds10__meta">${esc(it.meta)}</span>` : ""}</div></article>`;
  }).join("")}</div>
  <div class="ds10__foot">
    <span class="ds10__count"><b>01</b> / ${String(n).padStart(2, "0")}</span>
    <div class="ds10__nav">
      <div class="ds10__dots" role="tablist" aria-label="Projects">${items.map((it, i) => `<button class="ds10__dot" type="button" role="tab" aria-label="Project ${i + 1}: ${esc(it.title || "")}" aria-current="${i === 0 ? "true" : "false"}"></button>`).join("")}</div>
      <div class="ds10__ctl">
        <button class="ds10__btn ds10__btn--prev" type="button" aria-label="Previous project">${arrow}</button>
        <button class="ds10__btn ds10__btn--next" type="button" aria-label="Next project">${arrow}</button>
      </div>
    </div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var el = document.querySelector('[data-fx="drag-strip-10"]');
  if (!el) return;
  var FX = window.__fx.FX, RM = window.__fx.RM;
  var stage = el.querySelector('.ds10__stage'), count = el.querySelector('.ds10__count b');
  var items = [].slice.call(el.querySelectorAll('.ds10__item')), dots = [].slice.call(el.querySelectorAll('.ds10__dot'));
  var n = items.length; if (n < 2) return;
  var cur = 0, hover = false, inView = false;
  function mark(i){ if (i === cur) return; cur = i; dots.forEach(function(d, k){ d.setAttribute('aria-current', k === i ? 'true' : 'false'); }); if (count) count.textContent = (i + 1 < 10 ? '0' : '') + (i + 1); }
  // ---------- static row (phones, reduced motion): native scroll-snap, arrows scroll by one card
  if (!FX) {
    el.classList.add('is-static');
    function to(i){ i = (i + n) % n; mark(i); items[i].scrollIntoView({ block: 'nearest', inline: 'start', behavior: RM ? 'auto' : 'smooth' }); }
    el.querySelector('.ds10__btn--next').addEventListener('click', function(){ to(cur + 1); });
    el.querySelector('.ds10__btn--prev').addEventListener('click', function(){ to(cur - 1); });
    stage.addEventListener('scroll', function(){ var x = stage.scrollLeft, best = 0, bd = 1e9; items.forEach(function(it, i){ var d = Math.abs(it.offsetLeft - stage.offsetLeft - x - parseFloat(getComputedStyle(stage).paddingLeft)); if (d < bd) { bd = d; best = i; } }); mark(best); }, { passive: true });
    return;
  }
  // ---------- endless strip
  var W = 680, total = 0, off = 0, vel = 0, dragging = false, px = 0, lastDx = 0, moved = 0, tween = null, half = 0, cards, titles, flung = false;
  // clone until the loop is wider than the stage plus two slots so nothing ever shows a gap
  var all = items.slice(), k = 0;
  while (all.length * W < stage.clientWidth + 2 * W && k < 3) { items.forEach(function(it){ var c = it.cloneNode(true); c.setAttribute('aria-hidden', 'true'); stage.appendChild(c); all.push(c); }); k++; }
  var m = all.length; total = m * W; half = total / 2;
  cards = all.map(function(it){ return it.querySelector('.ds10__card'); });
  titles = all.map(function(it){ return it.querySelector('.ds10__text'); });
  function layout(){
    var sw = stage.clientWidth || 1, best = 0, bd = 1e9;
    var skew = Math.max(-14, Math.min(14, vel * 0.22)), sq = 1 - Math.min(0.18, Math.abs(vel) * 0.0022);
    for (var i = 0; i < m; i++) {
      var x = (((i * W + off) % total) + total) % total - half;
      all[i].style.transform = 'translate3d(' + x.toFixed(1) + 'px,0,0)';
      var dist = Math.min(1, Math.abs(x) / (sw * 0.5));
      cards[i].style.transform = 'skewX(' + skew.toFixed(2) + 'deg) scaleX(' + sq.toFixed(3) + ')';
      cards[i].style.filter = 'grayscale(' + Math.min(1, dist * 2.2).toFixed(2) + ') brightness(' + (1 - dist * 0.35).toFixed(2) + ')';
      var blur = Math.min(14, dist * dist * 22 + Math.abs(vel) * 0.08);
      titles[i].style.filter = 'blur(' + blur.toFixed(1) + 'px)';
      titles[i].style.opacity = (1 - dist * 0.55).toFixed(2);
      var ad = Math.abs(x); if (i < n && ad < bd) { bd = ad; best = i; }
    }
    // the item nearest the centre (clones map back to their source index)
    var nearest = 0, nd = 1e9;
    for (var j = 0; j < m; j++) { var xx = Math.abs((((j * W + off) % total) + total) % total - half); if (xx < nd) { nd = xx; nearest = j % n; } }
    mark(nearest);
  }
  function tick(){
    if (!dragging && !tween) {
      if (Math.abs(vel) > 0.05) { off += vel; vel *= 0.94; if (flung && Math.abs(vel) < 1.2) { flung = false; goTo(cur); } } else { vel = 0; if (!hover && inView) off -= 0.5; }
    } else if (dragging) { vel += (lastDx - vel) * 0.5; lastDx *= 0.6; }
    layout();
  }
  function glide(delta){
    if (tween) tween.kill();
    var o = { v: off }, from = off; vel = 0;
    tween = gsap.to(o, { v: off + delta, duration: 0.9, ease: 'power3.out', onUpdate: function(){ var nv = o.v - off; off = o.v; vel = nv; }, onComplete: function(){ tween = null; vel = 0; } });
  }
  function goTo(i){
    i = ((i % n) + n) % n;
    var want = -i * W, diff = (((want - off) % total) + total) % total; if (diff > half) diff -= total;
    glide(diff);
  }
  stage.addEventListener('pointerdown', function(e){ if (e.button) return; if (tween) { tween.kill(); tween = null; } dragging = true; moved = 0; px = e.clientX; lastDx = 0; vel = 0; stage.classList.add('is-drag'); stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', function(e){ if (!dragging) return; var dx = e.clientX - px; px = e.clientX; moved += Math.abs(dx); off += dx; lastDx = dx; });
  function endDrag(){ if (!dragging) return; dragging = false; stage.classList.remove('is-drag'); vel = Math.max(-40, Math.min(40, lastDx * 1.4)); flung = moved > 4; if (!flung) goTo(cur); }
  stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag); stage.addEventListener('lostpointercapture', endDrag);
  el.querySelector('.ds10__btn--next').addEventListener('click', function(){ goTo(cur + 1); });
  el.querySelector('.ds10__btn--prev').addEventListener('click', function(){ goTo(cur - 1); });
  dots.forEach(function(d, i){ d.addEventListener('click', function(){ goTo(i); }); });
  el.addEventListener('mouseenter', function(){ hover = true; });
  el.addEventListener('mouseleave', function(){ hover = false; });
  el.addEventListener('focusin', function(){ hover = true; });
  el.addEventListener('focusout', function(){ hover = false; });
  var running = false;
  function run(on){ if (on && !running) { running = true; gsap.ticker.add(tick); } else if (!on && running) { running = false; gsap.ticker.remove(tick); } }
  if (window.IntersectionObserver) new IntersectionObserver(function(es){ inView = es[0].isIntersecting; run(inView); }, { threshold: 0.2 }).observe(el); else run(true);
  document.addEventListener('keydown', function(e){
    if (!inView || e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (e.key === 'ArrowRight') goTo(cur + 1); else if (e.key === 'ArrowLeft') goTo(cur - 1);
  });
  layout();
})();`,
};
export default c;
