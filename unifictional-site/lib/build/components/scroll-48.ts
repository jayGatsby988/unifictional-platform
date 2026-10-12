// @ts-nocheck
// scroll-48 · Hero whose photo shrinks into the corner on scroll while a Lottie mascot walks along its bottom edge, one frame per few pixels (Awwwards Pack).
import type { Component } from "./_types";

const c: Component = {
  id: "scroll-48",
  type: "hero-mascot",
  kind: "hero",
  weight: "light",
  libs: ["lottie"],
  describe: "hero-mascot (scroll-48): a light hero. Headline (3-8 words), sub and button sit bottom-left; a wide 16:9 photo fills the top-right two thirds of the screen with a small mascot standing at its lower-left corner. The screen pins for a while: as you scroll the photo shrinks towards the top-right corner to a thumbnail and the mascot walks along, one frame per few pixels of scroll (it turns round when you scroll up), then the whole hero scrolls away and the page continues. The mascot is a looping Lottie walk cycle given as `lottie` (a JSON URL, optional); without one the brand mark stands in its place and the shrink still plays. Needs one landscape photo. For playful brands with a character: kids' services, pet care, cafés, creative studios; on phones it is copy, the photo and the mascot in a static column.",
  fields: `{"type":"hero-mascot","component":"scroll-48","eyebrow":"","headline":"","sub":"","cta":{"label":"","href":"contact"},"lottie":"","image":{"query":"","alt":""}}`,
  images: { min: 1, max: 1 },
  css: ({ pair, capsRule }) => `
.hmas{height:220svh}
.hmas__stage{position:sticky;top:0;height:100svh;overflow:hidden;padding:5.5rem var(--gutter) clamp(2rem,6vh,4rem);display:flex;flex-direction:column;justify-content:flex-end}
.hmas__pic{position:absolute;top:5.5rem;right:var(--gutter);left:var(--gutter);display:flex;justify-content:flex-end;align-items:flex-end;pointer-events:none}
.hmas__img{width:65%;aspect-ratio:16/9;border-radius:14px;overflow:hidden;background:var(--bg2);transform-origin:top right;will-change:width}
.hmas__img img{width:100%;height:100%;object-fit:cover}
.hmas__mascot{position:relative;z-index:1;width:clamp(6rem,10vw,10rem);min-width:max-content;height:clamp(6rem,10vw,10rem);transform:translateX(2rem);will-change:transform;display:flex;align-items:flex-end;justify-content:center}
.hmas__mascot svg{width:100%;height:100%}
.hmas__mascot .nav__brand{font-size:clamp(1rem,1.6vw,1.4rem);pointer-events:auto;white-space:nowrap;padding-bottom:.4rem}
.hmas__copy{position:relative;z-index:2;display:grid;gap:1.3rem;max-width:40rem}
.hmas__copy h1{font-size:clamp(2.6rem,6vw,6.4rem);line-height:.95;font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}max-width:12ch}
.hmas__copy p{max-width:44ch;color:var(--ink2);font-size:1.08rem}
@media(max-width:1000px){.hmas__copy h1{font-size:clamp(2.2rem,5vw,4rem)}}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .hmas{height:auto}
  .hmas__stage{position:static;height:auto;min-height:100svh;overflow:visible;padding:6.5rem var(--gutter) 3rem;gap:2rem;justify-content:flex-start}
  .hmas__pic{position:relative;top:auto;right:auto;left:auto;order:2;flex-direction:column;align-items:flex-start;gap:.5rem}
  .hmas__img{width:100%!important;transform:none!important}
  .hmas__mascot{transform:none!important;order:-1;width:5rem;height:5rem}
  .hmas__copy{order:1}
}`,
  html: (s, { esc, imgUrl, link, arrow, brandMark }) => `
<section class="hmas" id="top" data-fx="hero-mascot" ${s.lottie && /^https?:\/\//i.test(s.lottie) ? `data-lottie="${esc(s.lottie)}"` : ""}>
  <div class="hmas__stage">
    <div class="hmas__pic">
      <div class="hmas__mascot" aria-hidden="true">${brandMark()}</div>
      <div class="hmas__img"><img src="${esc(imgUrl(s.image, 1800))}" alt="${esc(s.image?.alt || "")}" fetchpriority="high"></div>
    </div>
    <div class="hmas__copy">
      ${s.eyebrow ? `<div class="mono reveal">${esc(s.eyebrow)}</div>` : ""}
      <h1 class="reveal">${esc(s.headline || "")}</h1>
      ${s.sub ? `<p class="reveal">${esc(s.sub)}</p>` : ""}
      ${s.cta && s.cta.label ? `<div class="reveal"><a class="btn btn-primary" href="${esc(link(s.cta.href))}">${esc(s.cta.label)}${arrow}</a></div>` : ""}
    </div>
  </div>
</section>`,
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="hero-mascot"]');
  if (!sec) return;
  var FX = window.__fx.FX, RM = window.__fx.RM;
  var slot = sec.querySelector('.hmas__mascot'), img = sec.querySelector('.hmas__img'), url = sec.getAttribute('data-lottie');
  var anim = null, mark = slot.innerHTML;
  if (url && window.lottie && !RM) {
    slot.innerHTML = '';
    try {
      anim = lottie.loadAnimation({ container: slot, path: url, renderer: 'svg', loop: true, autoplay: !FX });
      anim.addEventListener('data_failed', function(){ anim = null; slot.innerHTML = mark; });
    } catch (e) { anim = null; slot.innerHTML = mark; }
  }
  if (!FX) return;
  var startW = img.offsetWidth, targetW = Math.min(300, startW), dir = 1, walking = true;
  var frame = 0;
  function walk(scroll){
    if (!anim || !walking || !anim.totalFrames) return;
    var f = Math.floor(scroll / 3) % anim.totalFrames;
    if (f !== frame) { frame = f; anim.goToAndStop(f, true); }
  }
  ScrollTrigger.create({ trigger: sec, start: 'top top', end: 'bottom bottom', scrub: true, invalidateOnRefresh: true,
    onRefresh: function(){ startW = img.offsetWidth / (gsap.getProperty(img, 'width') ? 1 : 1); },
    onUpdate: function(self){
      var p = Math.min(1, self.progress / 0.72);
      gsap.set(img, { width: startW - (startW - targetW) * p });
      dir = self.direction;
      gsap.set(slot, { rotationY: dir < 0 ? -180 : 0 });
      walking = self.progress < 0.72;
      walk(self.scroll() - self.start);
    } });
})();`,
};
export default c;
