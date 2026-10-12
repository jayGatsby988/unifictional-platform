// @ts-nocheck
// slider-17 · Fullscreen wipe slider with melting titles (Awwwards Pack).
// Arrow buttons (or keys, dots, a 6 s autoplay) wipe the next full-bleed
// photo in from the side with parallax while the centred title's words blur
// out and the new ones condense in. The demo's SVG goo filter is replaced by
// a GSAP blur/opacity tween on SplitText words.
import type { Component } from "./_types";

const c: Component = {
  id: "slider-17",
  type: "hero-slider",
  kind: "hero",
  weight: "light",
  describe: "hero-slider (slider-17): a full-screen photo slider as the hero. Each slide is one full-bleed photo with a 2-4 word title centred in huge type and one short line under it; dashed arrow buttons sit at the left and right edges, the button bottom-left, slide dots bottom-right. Pressing an arrow wipes the next photo in from that side with a parallax drift while the old title melts out of focus and the new one condenses in; it also advances every 6 s, pauses on hover and answers the arrow keys. Needs 3-5 photos with a title and a line each. Suits galleries, photographers, venues, restaurants, resorts, portfolios and anything with several strong photos to show up front.",
  fields: `{"type":"hero-slider","component":"slider-17","slides":[{"query":"","alt":"","title":"","text":""},{"query":"","alt":"","title":"","text":""},{"query":"","alt":"","title":"","text":""}],"cta":{"label":"","href":"contact"}}`,
  images: { min: 3, max: 5 },
  css: () => `
.hero-slider{position:relative;height:100svh;overflow:hidden;background:var(--inv-bg);color:#fff}
.hero-slider__imgs{position:absolute;inset:0;z-index:0}
.hero-slider__img{position:absolute;inset:0;visibility:hidden;overflow:hidden;will-change:clip-path}
.hero-slider__img.is-on{visibility:visible}
.hero-slider__img img{width:100%;height:100%;object-fit:cover;will-change:transform}
.hero-slider__img::after{content:"";position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.62),rgba(0,0,0,.18) 45%,rgba(0,0,0,.3))}
.hero-slider__titles{position:absolute;inset:0;z-index:1;pointer-events:none}
.hero-slider__slide{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(64rem,76%);text-align:center;display:grid;gap:1.4rem;justify-items:center;visibility:hidden}
.hero-slider__slide.is-on{visibility:visible}
.hero-slider__slide h1{font-size:clamp(2.6rem,8.5vw,9rem);line-height:.92}
.hero-slider__slide h1 .w{display:inline-block;will-change:filter,opacity,transform}
.hero-slider__slide p{max-width:42ch;color:rgba(255,255,255,.82);font-size:1.05rem}
.hero-slider__ctl{position:absolute;left:var(--gutter);right:var(--gutter);top:50%;transform:translateY(-50%);display:flex;justify-content:space-between;z-index:3;pointer-events:none}
.hero-slider__btn{pointer-events:auto;width:56px;height:56px;border:1px dashed rgba(255,255,255,.75);border-radius:6px;display:grid;place-items:center;color:#fff;transition:background .25s,color .25s,transform .4s var(--ease-out)}
.hero-slider__btn:hover{background:#fff;color:#000;transform:scale(1.04)}
.hero-slider__btn svg{width:18px;height:18px}
.hero-slider__btn--prev svg{transform:scaleX(-1)}
.hero-slider__foot{position:absolute;left:var(--gutter);right:var(--gutter);bottom:2rem;display:flex;justify-content:space-between;align-items:center;gap:1.5rem;z-index:3}
.hero-slider__dots{display:flex;gap:.6rem;align-items:center}
.hero-slider__dot{width:28px;height:14px;position:relative}
.hero-slider__dot::after{content:"";position:absolute;left:0;right:0;top:6px;height:2px;background:rgba(255,255,255,.35);transition:background .3s}
.hero-slider__dot[aria-current="true"]::after{background:#fff}
.hero-slider__count{font-family:var(--mono);font-size:.68rem;letter-spacing:.14em;color:rgba(255,255,255,.7)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .hero-slider__slide{width:calc(100% - 2*var(--gutter));top:auto;bottom:8.5rem;transform:translate(-50%,0);text-align:left;justify-items:start}
  .hero-slider__slide h1{font-size:clamp(2.4rem,12vw,4.5rem)}
  .hero-slider__slide h1 .w{filter:none!important;opacity:1!important;transform:none!important}
  .hero-slider__ctl{top:auto;bottom:2rem;transform:none;justify-content:flex-end;gap:.6rem}
  .hero-slider__btn{width:44px;height:44px}
  .hero-slider__foot{right:auto;flex-direction:column;align-items:flex-start;gap:1rem;bottom:2rem}
  .hero-slider__count{display:none}
}`,
  html: (s, { esc, imgUrl, link, arrow }) => {
    const slides = (s.slides || []).filter(Boolean).slice(0, 5);
    const img = (sl, i) => `<div class="hero-slider__img${i === 0 ? " is-on" : ""}"><img src="${esc(imgUrl(sl.image || sl, 2000))}" alt="${esc(sl.alt || sl.image?.alt || "")}" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}></div>`;
    const title = (sl, i) => `<div class="hero-slider__slide${i === 0 ? " is-on" : ""}"><h1 class="display">${esc(sl.title || "")}</h1>${sl.text ? `<p>${esc(sl.text)}</p>` : ""}</div>`;
    return `
<section class="hero-slider" id="top" data-fx="hero-slider">
  <div class="hero-slider__imgs">${slides.map(img).join("")}</div>
  <div class="hero-slider__titles">${slides.map(title).join("")}</div>
  <div class="hero-slider__ctl">
    <button class="hero-slider__btn hero-slider__btn--prev" type="button" aria-label="Previous slide">${arrow}</button>
    <button class="hero-slider__btn hero-slider__btn--next" type="button" aria-label="Next slide">${arrow}</button>
  </div>
  <div class="hero-slider__foot">
    ${s.cta ? `<a class="btn btn-primary" href="${esc(link(s.cta.href))}">${esc(s.cta.label)}${arrow}</a>` : "<span></span>"}
    <div class="hero-slider__dots" role="tablist" aria-label="Slides">
      ${slides.map((sl, i) => `<button class="hero-slider__dot" type="button" role="tab" aria-label="Slide ${i + 1}: ${esc(sl.title || "")}" aria-current="${i === 0 ? "true" : "false"}"></button>`).join("")}
      <span class="hero-slider__count"><b>01</b> / ${String(slides.length).padStart(2, "0")}</span>
    </div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var el = document.querySelector('[data-fx="hero-slider"]');
  if (!el) return;
  var FX = window.__fx.FX, RM = window.__fx.RM;
  var imgs = [].slice.call(el.querySelectorAll('.hero-slider__img')), slides = [].slice.call(el.querySelectorAll('.hero-slider__slide'));
  var dots = [].slice.call(el.querySelectorAll('.hero-slider__dot')), count = el.querySelector('.hero-slider__count b');
  var n = imgs.length; if (n < 2) return;
  var cur = 0, busy = false, timer = null, hover = false, inView = true;
  var ease = 'power3.inOut';
  if (window.CustomEase) { try { ease = CustomEase.get('hsHop') ? 'hsHop' : CustomEase.create('hsHop', 'M0,0 C0.071,0.505 0.192,0.726 0.318,0.852 0.45,0.984 0.504,1 1,1'); } catch (e) {} }
  var words = slides.map(function(s){ var h = s.querySelector('h1'); if (window.SplitText) { try { return SplitText.create(h, { type: 'words', wordsClass: 'w' }).words; } catch (e) {} } return [h]; });
  function mark(i){ dots.forEach(function(d, k){ d.setAttribute('aria-current', k === i ? 'true' : 'false'); }); if (count) count.textContent = (i + 1 < 10 ? '0' : '') + (i + 1); }
  function textOut(i){ var p = slides[i].querySelector('p'); gsap.to(words[i], { filter: 'blur(16px)', opacity: 0, y: -16, duration: 0.75, stagger: 0.035, ease: 'power2.in', overwrite: true, onComplete: function(){ slides[i].classList.remove('is-on'); } }); if (p) gsap.to(p, { opacity: 0, y: -10, duration: 0.5, ease: 'power2.in', overwrite: true }); }
  function textIn(i, delay){ var p = slides[i].querySelector('p'); slides[i].classList.add('is-on'); gsap.fromTo(words[i], { filter: 'blur(18px)', opacity: 0, y: 24 }, { filter: 'blur(0px)', opacity: 1, y: 0, duration: 1.2, stagger: 0.06, ease: 'power3.out', delay: delay, overwrite: true, onComplete: function(){ gsap.set(words[i], { clearProps: 'filter' }); } }); if (p) gsap.fromTo(p, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', delay: delay + 0.25, overwrite: true }); }
  function go(to, dir){
    if (busy || to === cur) return;
    busy = true;
    var from = imgs[cur], next = imgs[to], fi = from.querySelector('img'), ti = next.querySelector('img');
    var run = function(){
      if (!FX) {
        next.classList.add('is-on'); next.style.zIndex = 2;
        gsap.fromTo(next, { opacity: 0 }, { opacity: 1, duration: RM ? 0.01 : 0.5, ease: 'power1.out', onComplete: function(){ from.classList.remove('is-on'); next.style.zIndex = ''; gsap.set(next, { clearProps: 'opacity' }); busy = false; } });
        slides[cur].classList.remove('is-on'); slides[to].classList.add('is-on');
        cur = to; mark(cur); return;
      }
      var off = window.innerWidth < 1000 ? 120 : 420;
      next.classList.add('is-on'); next.style.zIndex = 2; from.style.zIndex = 1;
      gsap.set(ti, { x: dir > 0 ? off : -off });
      gsap.set(next, { clipPath: dir > 0 ? 'polygon(100% 0%, 100% 0%, 100% 100%, 100% 100%)' : 'polygon(0% 0%, 0% 0%, 0% 100%, 0% 100%)' });
      gsap.to(fi, { x: dir > 0 ? -off : off, duration: 1.5, ease: ease });
      gsap.to(ti, { x: 0, duration: 1.5, ease: ease });
      gsap.to(next, { clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)', duration: 1.5, ease: ease, onComplete: function(){
        from.classList.remove('is-on'); gsap.set(fi, { x: 0 }); gsap.set(next, { clearProps: 'clipPath' }); next.style.zIndex = ''; from.style.zIndex = ''; busy = false;
      } });
      textOut(cur); textIn(to, 0.35);
      cur = to; mark(cur);
    };
    if (ti.complete) run(); else { var done = false, fin = function(){ if (!done) { done = true; run(); } }; ti.addEventListener('load', fin, { once: true }); ti.addEventListener('error', fin, { once: true }); setTimeout(fin, 1500); }
  }
  function nextSlide(){ go((cur + 1) % n, 1); }
  function prevSlide(){ go((cur - 1 + n) % n, -1); }
  function restart(){ if (timer) clearInterval(timer); timer = null; if (!FX) return; timer = setInterval(function(){ if (!hover && inView && !document.hidden && !busy) nextSlide(); }, 6000); }
  el.querySelector('.hero-slider__btn--next').addEventListener('click', function(){ nextSlide(); restart(); });
  el.querySelector('.hero-slider__btn--prev').addEventListener('click', function(){ prevSlide(); restart(); });
  dots.forEach(function(d, k){ d.addEventListener('click', function(){ go(k, k > cur ? 1 : -1); restart(); }); });
  el.addEventListener('mouseenter', function(){ hover = true; });
  el.addEventListener('mouseleave', function(){ hover = false; });
  el.addEventListener('focusin', function(){ hover = true; });
  el.addEventListener('focusout', function(){ hover = false; });
  if (window.IntersectionObserver) new IntersectionObserver(function(es){ inView = es[0].isIntersecting; }, { threshold: 0.3 }).observe(el);
  document.addEventListener('keydown', function(e){
    if (!inView || e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (e.key === 'ArrowRight') { nextSlide(); restart(); } else if (e.key === 'ArrowLeft') { prevSlide(); restart(); }
  });
  // Warm the other photos once the first paint is done so a wipe never shows a blank.
  setTimeout(function(){ imgs.forEach(function(w, i){ if (i) w.querySelector('img').loading = 'eager'; }); }, 1200);
  if (FX) { gsap.fromTo(words[0], { filter: 'blur(18px)', opacity: 0, y: 24 }, { filter: 'blur(0px)', opacity: 1, y: 0, duration: 1.5, stagger: 0.07, ease: 'power3.out', delay: 0.2, onComplete: function(){ gsap.set(words[0], { clearProps: 'filter' }); } }); var p0 = slides[0].querySelector('p'); if (p0) gsap.fromTo(p0, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 1, ease: 'power3.out', delay: 0.6 }); }
  restart();
})();`,
};
export default c;
