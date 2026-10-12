// @ts-nocheck
// scroll-28 · Fullscreen slideshow: each step slides the old photo away stretched to double height while the next one is uncovered; click a photo to wipe it up and read about it (Awwwards Pack).
// The demo hijacks the wheel with GSAP Observer and Splitting.js and owns the
// viewport. Here the block pins for one screen per slide and the page's own
// scroll (wheel, trackpad, drag, arrow keys) steps the slides, snapping to
// each; Splitting is replaced by SplitText on the cursor and back labels.
import type { Component } from "./_types";

const c: Component = {
  id: "scroll-28",
  type: "wheel-slides",
  kind: "section",
  weight: "medium",
  describe: "wheel-slides (scroll-28): a full-screen photo slideshow that pins while you scroll through it, one screen per slide. Each wheel step or arrow key slides the current photo away while it stretches to double height and uncovers the next one relaxing from the same stretch; thin slide markers and a counter sit along the bottom. Clicking a photo wipes it upward to reveal a panel with a small copy of the photo, the slide's title and a short paragraph, with a Back control; a small 'Discover more' label trails the cursor over the photos. Needs 3-6 strong photos with a 1-4 word title and one or two sentences each. A lookbook or portfolio moment for photographers, architects, interior designers, venues and fashion.",
  fields: `{"type":"wheel-slides","component":"scroll-28","slides":[{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""}]}`,
  images: { min: 3, max: 6 },
  css: ({ pair }) => `
.ws__track{height:calc(var(--n,3) * 100svh);position:relative}
.ws__stage{position:sticky;top:0;height:100svh;overflow:hidden;background:var(--inv-bg)}
.ws__slides{position:absolute;inset:0;display:grid;grid-template-rows:100%;grid-template-columns:100%;place-items:center}
.ws__slide{grid-area:1/1/-1/-1;width:100%;height:104%;opacity:0;pointer-events:none;overflow:hidden;position:relative;will-change:transform}
.ws__slide.is-on{opacity:1;pointer-events:auto}
.ws__inner{width:100%;height:100%;display:grid;grid-template-rows:100%;grid-template-columns:100%;position:relative;overflow:hidden;will-change:transform}
.ws__img{grid-area:1/1/-1/-1;overflow:hidden;position:relative;z-index:1;cursor:pointer}
.ws__imgin{width:100%;height:100%;will-change:transform}
.ws__imgin img{width:100%;height:100%;object-fit:cover}
.ws__content{grid-area:1/1/-1/-1;display:grid;background:var(--inv-bg);color:var(--inv-ink);align-content:center;justify-content:center;padding:6rem var(--gutter) 5rem;grid-template-columns:minmax(0,26rem) minmax(0,30rem);column-gap:3rem;grid-template-rows:auto auto 1fr;grid-template-areas:'img title' 'img text' 'img .'}
.ws__thumb{grid-area:img;height:min(58svh,440px);overflow:hidden;will-change:transform}
.ws__thumb img{width:100%;height:100%;object-fit:cover}
.ws__content h2{grid-area:title;font-size:clamp(2.2rem,4.5vw,4.6rem);margin-bottom:1.5rem}
.ws__content p{grid-area:text;max-width:38ch;line-height:1.55;opacity:.7}
.ws__ui{position:absolute;left:var(--gutter);right:var(--gutter);bottom:2rem;display:flex;justify-content:space-between;align-items:center;gap:1rem;z-index:5;color:#fff;mix-blend-mode:difference}
.ws__back{font-family:var(--mono);font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;opacity:0;pointer-events:none;display:inline-flex;align-items:center;gap:.6rem;transition:opacity .3s}
.ws__back.is-show{opacity:1;pointer-events:auto}
.ws__back svg{width:14px;height:14px;transform:scaleX(-1)}
.ws__nav{display:flex;gap:.6rem;align-items:center}
.ws__dot{width:28px;height:14px;position:relative}
.ws__dot::after{content:"";position:absolute;left:0;right:0;top:6px;height:2px;background:rgba(255,255,255,.35);transition:background .3s}
.ws__dot[aria-current="true"]::after{background:#fff}
.ws__count{font-family:var(--mono);font-size:.68rem;letter-spacing:.14em;opacity:.8}
.ws__cursor{position:absolute;top:0;left:0;z-index:6;pointer-events:none;font-family:var(--mono);font-size:.66rem;letter-spacing:.16em;text-transform:uppercase;color:#fff;mix-blend-mode:difference;opacity:0;padding-left:1.2rem;white-space:nowrap;will-change:transform}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .ws__track{height:auto}
  .ws__stage{position:static;height:auto;overflow:visible;background:none;padding:3rem 0}
  .ws__slides{position:static;display:grid;grid-template-columns:1fr;grid-template-rows:none;gap:3rem;padding:0 var(--gutter)}
  .ws__slide{grid-area:auto;height:auto;opacity:1;pointer-events:auto;transform:none!important}
  .ws__inner{display:grid;grid-template-rows:none;gap:1rem;transform:none!important}
  .ws__img{grid-area:auto;aspect-ratio:4/5;cursor:default;transform:none!important}
  .ws__imgin{transform:none!important}
  .ws__content{grid-area:auto;display:grid;grid-template-columns:1fr;grid-template-areas:none;background:none;color:var(--ink);padding:0;gap:.6rem}
  .ws__thumb{display:none}
  .ws__content h2{grid-area:auto;font-size:clamp(1.8rem,8vw,3rem);margin:0}
  .ws__content p{grid-area:auto;opacity:1;color:var(--ink2)}
  .ws__ui,.ws__cursor{display:none}
}`,
  html: (s, { esc, imgUrl, arrow }) => {
    const slides = (s.slides || []).filter(Boolean).slice(0, 6);
    const n = slides.length;
    const slide = (sl, i) => {
      const u = imgUrl(sl.image || sl, 2000), ut = imgUrl(sl.image || sl, 900);
      const alt = esc(sl.alt || (sl.image && sl.image.alt) || sl.title || "");
      return `<div class="ws__slide${i === 0 ? " is-on" : ""}"><div class="ws__inner">
      <div class="ws__content"><div class="ws__thumb">${u ? `<img src="${esc(ut)}" alt="" loading="lazy">` : ""}</div><h2 class="display">${esc(sl.title || "")}</h2>${sl.text ? `<p>${esc(sl.text)}</p>` : ""}</div>
      <div class="ws__img" role="button" tabindex="0" aria-label="Open ${esc(sl.title || "slide " + (i + 1))}"><div class="ws__imgin">${u ? `<img src="${esc(u)}" alt="${alt}" loading="${i === 0 ? "eager" : "lazy"}">` : ""}</div></div>
    </div></div>`;
    };
    return `
<section class="ws" data-fx="wheel-slides" style="--n:${Math.max(1, n)}">
  <div class="ws__track"><div class="ws__stage">
    <div class="ws__slides">${slides.map(slide).join("")}</div>
    <div class="ws__ui">
      <button class="ws__back" type="button">${arrow}<span>Back</span></button>
      <div class="ws__nav" role="tablist" aria-label="Slides">${slides.map((sl, i) => `<button class="ws__dot" type="button" aria-label="Slide ${i + 1}" aria-current="${i === 0 ? "true" : "false"}"></button>`).join("")}</div>
      <div class="ws__count">01 / ${n < 10 ? "0" : ""}${n}</div>
    </div>
    <div class="ws__cursor" aria-hidden="true">Discover more</div>
  </div></div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="wheel-slides"]');
  if (!sec) return;
  var FX = window.__fx.FX, RM = window.__fx.RM;
  var track = sec.querySelector('.ws__track'), stage = sec.querySelector('.ws__stage');
  var els = Array.prototype.slice.call(sec.querySelectorAll('.ws__slide'));
  var n = els.length; if (!n) return;
  var slides = els.map(function(el){ return { el: el, inner: el.querySelector('.ws__inner'), img: el.querySelector('.ws__img'), imgin: el.querySelector('.ws__imgin'), thumb: el.querySelector('.ws__thumb'), open: false }; });
  if (!FX) return;
  var dots = Array.prototype.slice.call(sec.querySelectorAll('.ws__dot')), count = sec.querySelector('.ws__count'), back = sec.querySelector('.ws__back'), cursor = sec.querySelector('.ws__cursor');
  var cur = 0, want = 0, busy = false, active = false;
  var D = 1.6, E = 'power3.inOut';
  var cursorChars = null, backChars = null;
  if (window.SplitText) { try { cursorChars = SplitText.create(cursor, { type: 'chars' }).chars; backChars = SplitText.create(back.querySelector('span'), { type: 'chars' }).chars; } catch (e) { cursorChars = backChars = null; } }
  function mark(i){ dots.forEach(function(d, k){ d.setAttribute('aria-current', k === i ? 'true' : 'false'); }); if (count) count.textContent = (i + 1 < 10 ? '0' : '') + (i + 1) + ' / ' + (n < 10 ? '0' : '') + n; }
  function toggleBack(show){
    back.classList.toggle('is-show', !!show);
    if (cursorChars) gsap.to(cursorChars, { duration: 0.1, ease: 'expo', opacity: show ? 0 : 1, stagger: { amount: 0.5, from: 'random' } });
    if (backChars) gsap.fromTo(backChars, { opacity: show ? 0 : 1 }, { duration: 0.1, ease: 'expo', opacity: show ? 1 : 0, stagger: { amount: 0.5, from: 'random' } });
  }
  function hide(s, animate){
    if (!s.open) return; busy = true;
    var done = function(){ s.open = false; busy = false; if (want !== cur) go(want); };
    if (animate) gsap.timeline({ defaults: { duration: D, ease: E }, onComplete: done }).to(s.img, { yPercent: 0 }, 0).to(s.imgin, { yPercent: 0, scaleY: 1 }, 0);
    else { gsap.set(s.img, { yPercent: 0 }); gsap.set(s.imgin, { yPercent: 0, scaleY: 1 }); done(); }
  }
  function show(s){
    if (busy || s.open) return; busy = true; s.open = true; toggleBack(true);
    gsap.timeline({ defaults: { duration: D, ease: E }, onComplete: function(){ busy = false; if (want !== cur) go(want); } })
      .to(s.img, { yPercent: -100 }, 0)
      .set(s.imgin, { transformOrigin: '50% 100%' }, 0)
      .to(s.imgin, { yPercent: 100, scaleY: 2 }, 0)
      .fromTo(s.thumb, { transformOrigin: '50% 0%', scaleY: 1.5 }, { scaleY: 1 }, 0);
  }
  function go(to){
    if (busy || to === cur || to < 0 || to >= n) return;
    busy = true;
    var dir = to > cur ? 1 : -1, a = slides[cur], b = slides[to];
    if (a.open) toggleBack(false);
    cur = to; mark(cur);
    gsap.timeline({ defaults: { duration: D, ease: E }, onComplete: function(){
      a.el.classList.remove('is-on'); busy = false;
      if (a.open) hide(a, false);
      if (want !== cur) go(want);
    } })
      .set([a.imgin, b.imgin], { transformOrigin: dir > 0 ? '50% 0%' : '50% 100%' }, 0)
      .set(b.el, { yPercent: dir > 0 ? 100 : -100 }, 0)
      .set(b.inner, { yPercent: dir > 0 ? -100 : 100 }, 0)
      .add(function(){ b.el.classList.add('is-on'); }, 0)
      .to(a.el, { yPercent: dir > 0 ? -100 : 100 }, 0)
      .to(a.imgin, { scaleY: 2 }, 0)
      .to([b.el, b.inner], { yPercent: 0 }, 0)
      .fromTo(b.imgin, { scaleY: 2 }, { scaleY: 1, ease: 'power2.inOut' }, 0);
  }
  // No ScrollTrigger snap: it fights Lenis's own smoothing and can flip the slide index back and forth.
  var st = ScrollTrigger.create({ trigger: track, start: 'top top', end: 'bottom bottom',
    onUpdate: function(self){ var i = Math.round(self.progress * (n - 1)); if (i !== want) { want = i; if (!busy && want !== cur) go(want); } },
    onToggle: function(self){ active = self.isActive; if (!active && cursor) gsap.to(cursor, { opacity: 0, duration: 0.2 }); } });
  function jump(i){
    i = Math.max(0, Math.min(n - 1, i));
    var y = st.start + (n > 1 ? (st.end - st.start) * i / (n - 1) : 0);
    if (window.__fx.lenis) window.__fx.lenis.scrollTo(y, { duration: 0.9 }); else window.scrollTo({ top: y, behavior: 'smooth' });
  }
  dots.forEach(function(d, k){ d.addEventListener('click', function(){ jump(k); }); });
  back.addEventListener('click', function(){ if (busy) return; toggleBack(false); hide(slides[cur], true); });
  slides.forEach(function(s){
    s.img.addEventListener('click', function(){ show(s); });
    s.img.addEventListener('keydown', function(e){ if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(s); } });
  });
  document.addEventListener('keydown', function(e){
    if (!active || e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); jump(cur + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); jump(cur - 1); }
    else if (e.key === 'Escape' && slides[cur].open && !busy) { toggleBack(false); hide(slides[cur], true); }
  });
  // Drag: a vertical drag of 60px steps a slide, like the demo's pointer Observer.
  var dy0 = null;
  stage.addEventListener('pointerdown', function(e){ if (e.pointerType === 'mouse' && e.button !== 0) return; dy0 = e.clientY; });
  stage.addEventListener('pointerup', function(e){ if (dy0 === null) return; var d = e.clientY - dy0; dy0 = null; if (Math.abs(d) < 60) return; jump(cur + (d < 0 ? 1 : -1)); });
  // Cursor label follows the pointer over the photos.
  if (cursor && window.matchMedia('(pointer: fine)').matches) {
    var qx = gsap.quickTo(cursor, 'x', { duration: 0.35, ease: 'power3' }), qy = gsap.quickTo(cursor, 'y', { duration: 0.35, ease: 'power3' });
    stage.addEventListener('pointermove', function(e){ var r = stage.getBoundingClientRect(); qx(e.clientX - r.left); qy(e.clientY - r.top); var over = e.target && e.target.closest && e.target.closest('.ws__img'); gsap.to(cursor, { opacity: over && !slides[cur].open ? 1 : 0, duration: 0.25, overwrite: true }); });
    stage.addEventListener('pointerleave', function(){ gsap.to(cursor, { opacity: 0, duration: 0.25, overwrite: true }); });
  }
  mark(0);
  setTimeout(function(){ slides.forEach(function(s, i){ if (i) { var im = s.imgin.querySelector('img'); if (im) im.loading = 'eager'; } }); }, 1200);
})();`,
};
export default c;
