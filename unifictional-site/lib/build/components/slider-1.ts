// @ts-nocheck
// slider-1 · Thumbnail strip with live preview (Awwwards Pack).
// A row of small thumbnails glides sideways with inertia on wheel or drag;
// whichever thumbnail reaches the left edge becomes the large preview.
// The demo hijacked the window wheel over 100 images; here the strip owns
// the wheel only while the pointer is over it, hands the event back to the
// page at either end, and adds arrows, dots, keys and a gentle autoplay.
import type { Component } from "./_types";

function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}

const c: Component = {
  id: "slider-1",
  type: "strip-preview-1",
  kind: "section",
  weight: "medium",
  describe: "strip-preview-1 (slider-1): a gallery index. Under the section title runs a strip of small portrait thumbnails (about 64 px wide) that glides sideways with inertia when you scroll over it, drag it, press the arrows or the arrow keys; whichever thumbnail reaches the left edge lights up and crossfades into a large 4:5 preview below, next to its title, a counter (07 / 24) and a row of tick dots. It also steps forward on its own every few seconds and pauses on hover. Needs 8-30 photos with a short title each; the more the better. Suits photographers, galleries, makers, architects, interior and landscape work, any portfolio with many images to flick through.",
  fields: `{"type":"strip-preview-1","component":"slider-1","eyebrow":"","title":"","intro":"","items":[{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""}]}`,
  images: { min: 8, max: 30 },
  css: ({ pair, capsRule }) => `
.sp1{padding:clamp(4rem,10vh,8rem) var(--gutter);overflow:hidden}
.sp1__strip{position:relative;height:84px;margin-bottom:clamp(1.5rem,4vh,3rem);cursor:grab;user-select:none;-webkit-user-select:none;touch-action:pan-y}
.sp1__strip.is-drag{cursor:grabbing}
.sp1__track{display:flex;gap:6px;height:100%;width:max-content;will-change:transform}
.sp1__thumb{flex:0 0 64px;height:84px;overflow:hidden;background:var(--bg2);opacity:.55;transition:opacity .35s;outline:0}
.sp1__thumb img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}
.sp1__thumb:hover{opacity:.85}
.sp1__thumb.is-on{opacity:1;box-shadow:inset 0 0 0 2px var(--accent)}
.sp1__thumb:focus-visible{opacity:1;box-shadow:inset 0 0 0 2px var(--ink)}
.sp1__pad{flex:0 0 auto;width:0}
.sp1__stage{display:grid;grid-template-columns:minmax(260px,440px) 1fr;gap:clamp(1.5rem,4vw,4rem);align-items:end}
.sp1__preview{position:relative;aspect-ratio:4/5;overflow:hidden;background:var(--bg2)}
.sp1__preview img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.sp1__preview img.is-off{opacity:0}
.sp1__side{display:grid;gap:1.2rem;padding-bottom:.4rem}
.sp1__count{font-family:var(--mono);font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2)}
.sp1__title{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}font-size:clamp(1.8rem,4vw,3.8rem);line-height:1;min-height:1em}
.sp1__ctl{display:flex;gap:.6rem}
.sp1__btn{width:48px;height:48px;border:1px solid var(--line);border-radius:999px;display:grid;place-items:center;color:var(--ink);transition:background .25s,color .25s,border-color .25s}
.sp1__btn:hover{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.sp1__btn svg{width:16px;height:16px}
.sp1__btn--prev svg{transform:scaleX(-1)}
.sp1__dots{display:flex;flex-wrap:wrap;gap:4px;max-width:36rem}
.sp1__dot{width:12px;height:14px;position:relative}
.sp1__dot::after{content:"";position:absolute;left:0;right:0;top:6px;height:2px;background:var(--line);transition:background .3s}
.sp1__dot:hover::after{background:var(--ink2)}
.sp1__dot[aria-current="true"]::after{background:var(--ink)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .sp1__strip{overflow-x:auto;overflow-y:hidden;cursor:default;scrollbar-width:none;-webkit-overflow-scrolling:touch;touch-action:pan-x pan-y}
  .sp1__strip::-webkit-scrollbar{display:none}
  .sp1__track{transform:none!important}
  .sp1__stage{grid-template-columns:1fr}
  .sp1__dots{display:none}
}`,
  html: (s, { esc, imgUrl, arrow }) => {
    const items = (s.items || []).filter(Boolean).slice(0, 30);
    const n = items.length;
    const first = n ? pic(items[0], s, 0) : null;
    const alt = (it, p) => esc(it.alt || (p && p.alt) || it.title || "");
    return `
<section class="sp1" data-fx="strip-preview-1">
  <div class="sec-head">
    <div>${s.eyebrow ? `<span class="mono reveal">${esc(s.eyebrow)}</span>` : ""}<h2 class="display reveal">${esc(s.title || "")}</h2></div>
    ${s.intro ? `<p class="reveal">${esc(s.intro)}</p>` : ""}
  </div>
  <div class="sp1__strip" aria-label="Thumbnails">
    <div class="sp1__track">${items.map((it, i) => {
      const p = pic(it, s, i);
      return `<button class="sp1__thumb${i === 0 ? " is-on" : ""}" type="button" data-i="${i}" data-src="${esc(p ? imgUrl(p, 1200) : "")}" data-title="${esc(it.title || "")}" aria-label="Show ${esc(it.title || "image " + (i + 1))}">${p ? `<img src="${esc(imgUrl(p, 200))}" alt="${alt(it, p)}" loading="lazy" draggable="false">` : ""}</button>`;
    }).join("")}<span class="sp1__pad"></span></div>
  </div>
  <div class="sp1__stage">
    <div class="sp1__preview">
      <img class="sp1__a" src="${esc(first ? imgUrl(first, 1200) : "")}" alt="${n ? alt(items[0], first) : ""}" loading="lazy">
      <img class="sp1__b is-off" src="" alt="" aria-hidden="true">
    </div>
    <div class="sp1__side">
      <span class="sp1__count"><b>01</b> / ${String(n).padStart(2, "0")}</span>
      <h3 class="sp1__title">${esc(n ? items[0].title || "" : "")}</h3>
      <div class="sp1__ctl">
        <button class="sp1__btn sp1__btn--prev" type="button" aria-label="Previous image">${arrow}</button>
        <button class="sp1__btn sp1__btn--next" type="button" aria-label="Next image">${arrow}</button>
      </div>
      <div class="sp1__dots" role="tablist" aria-label="Images">${items.map((it, i) => `<button class="sp1__dot" type="button" role="tab" aria-label="Image ${i + 1}" aria-current="${i === 0 ? "true" : "false"}"></button>`).join("")}</div>
    </div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var el = document.querySelector('[data-fx="strip-preview-1"]');
  if (!el) return;
  var FX = window.__fx.FX, RM = window.__fx.RM;
  var strip = el.querySelector('.sp1__strip'), track = el.querySelector('.sp1__track'), pad = el.querySelector('.sp1__pad');
  var thumbs = [].slice.call(el.querySelectorAll('.sp1__thumb')), dots = [].slice.call(el.querySelectorAll('.sp1__dot'));
  var imgA = el.querySelector('.sp1__a'), imgB = el.querySelector('.sp1__b'), count = el.querySelector('.sp1__count b'), title = el.querySelector('.sp1__title');
  var n = thumbs.length; if (n < 2) return;
  var cur = 0, hover = false, inView = false, timer = null, fading = false;
  function setActive(i){
    if (i === cur) return;
    var t = thumbs[i];
    thumbs[cur].classList.remove('is-on'); t.classList.add('is-on');
    dots.forEach(function(d, k){ d.setAttribute('aria-current', k === i ? 'true' : 'false'); });
    if (count) count.textContent = (i + 1 < 10 ? '0' : '') + (i + 1);
    if (title) title.textContent = t.getAttribute('data-title') || '';
    var src = t.getAttribute('data-src'), alt = t.querySelector('img') ? t.querySelector('img').alt : '';
    cur = i;
    // Crossfade: load into the back image, fade it in, then swap roles.
    var back = imgB, front = imgA;
    gsap.killTweensOf([imgA, imgB]);
    back.src = src; back.alt = alt; back.removeAttribute('aria-hidden');
    var show = function(){ if (cur !== i) return; back.classList.remove('is-off'); gsap.fromTo(back, { opacity: 0 }, { opacity: 1, duration: RM ? 0.01 : 0.45, ease: 'power1.out', onComplete: function(){ front.classList.add('is-off'); front.setAttribute('aria-hidden', 'true'); gsap.set([front, back], { clearProps: 'opacity' }); imgA = back; imgB = front; } }); };
    if (back.complete && back.naturalWidth) show(); else { back.addEventListener('load', show, { once: true }); back.addEventListener('error', show, { once: true }); }
  }
  // ---- static strip (phones, reduced motion): native overflow, tap to select
  if (!FX) {
    thumbs.forEach(function(t, i){ t.addEventListener('click', function(){ setActive(i); t.scrollIntoView({ block: 'nearest', inline: 'start', behavior: RM ? 'auto' : 'smooth' }); }); });
    el.querySelector('.sp1__btn--next').addEventListener('click', function(){ thumbs[(cur + 1) % n].click(); });
    el.querySelector('.sp1__btn--prev').addEventListener('click', function(){ thumbs[(cur - 1 + n) % n].click(); });
    dots.forEach(function(d, k){ d.addEventListener('click', function(){ thumbs[k].click(); }); });
    return;
  }
  // ---- inertia strip
  var target = 0, x = 0, step = 70, max = 0, snapT = null;
  function measure(){
    step = thumbs.length > 1 ? thumbs[1].offsetLeft - thumbs[0].offsetLeft : thumbs[0].offsetWidth + 6;
    pad.style.width = Math.max(0, strip.clientWidth - thumbs[0].offsetWidth) + 'px';
    max = Math.max(0, track.scrollWidth - strip.clientWidth);
    target = Math.min(Math.max(target, 0), max);
  }
  measure();
  window.addEventListener('resize', measure);
  function goTo(i){ i = (i + n) % n; target = Math.min(i * step, max); }
  function tick(){
    x += (target - x) * 0.1;
    if (Math.abs(target - x) < 0.05) x = target;
    track.style.transform = 'translate3d(' + (-x) + 'px,0,0)';
    var i = Math.min(n - 1, Math.max(0, Math.round(x / step)));
    if (i !== cur) setActive(i);
  }
  gsap.ticker.add(tick);
  // wheel: the strip takes the wheel while it can still move, the page gets it at either end
  strip.addEventListener('wheel', function(e){
    var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    var next = Math.min(Math.max(target + d, 0), max);
    if (next === target) return;
    e.preventDefault(); e.stopPropagation();
    target = next; restart();
    clearTimeout(snapT); snapT = setTimeout(function(){ target = Math.min(Math.round(target / step) * step, max); }, 160);
  }, { passive: false });
  // drag
  var dragging = false, moved = 0, px = 0;
  strip.addEventListener('pointerdown', function(e){ if (e.button) return; dragging = true; moved = 0; px = e.clientX; strip.classList.add('is-drag'); strip.setPointerCapture(e.pointerId); });
  strip.addEventListener('pointermove', function(e){ if (!dragging) return; var dx = e.clientX - px; px = e.clientX; moved += Math.abs(dx); target = Math.min(Math.max(target - dx, 0), max); });
  function endDrag(e){ if (!dragging) return; dragging = false; strip.classList.remove('is-drag'); if (moved > 4) { target = Math.min(Math.round(target / step) * step, max); restart(); } }
  strip.addEventListener('pointerup', endDrag); strip.addEventListener('pointercancel', endDrag); strip.addEventListener('lostpointercapture', endDrag);
  thumbs.forEach(function(t, i){ t.addEventListener('click', function(){ if (moved > 4) return; goTo(i); restart(); }); });
  el.querySelector('.sp1__btn--next').addEventListener('click', function(){ goTo(cur + 1); restart(); });
  el.querySelector('.sp1__btn--prev').addEventListener('click', function(){ goTo(cur - 1); restart(); });
  dots.forEach(function(d, k){ d.addEventListener('click', function(){ goTo(k); restart(); }); });
  el.addEventListener('mouseenter', function(){ hover = true; });
  el.addEventListener('mouseleave', function(){ hover = false; });
  el.addEventListener('focusin', function(){ hover = true; });
  el.addEventListener('focusout', function(){ hover = false; });
  if (window.IntersectionObserver) new IntersectionObserver(function(es){ inView = es[0].isIntersecting; }, { threshold: 0.35 }).observe(el);
  document.addEventListener('keydown', function(e){
    if (!inView || e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (e.key === 'ArrowRight') { goTo(cur + 1); restart(); } else if (e.key === 'ArrowLeft') { goTo(cur - 1); restart(); }
  });
  function restart(){ if (timer) clearInterval(timer); timer = setInterval(function(){ if (!hover && inView && !dragging && !document.hidden) goTo(cur + 1); }, 3500); }
  restart();
  setTimeout(function(){ thumbs.forEach(function(t){ var im = t.querySelector('img'); if (im) im.loading = 'eager'; }); }, 1500);
})();`,
};
export default c;
