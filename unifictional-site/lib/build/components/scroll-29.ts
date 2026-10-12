// @ts-nocheck
// scroll-29 · Text blocks scroll past a pinned photo frame that wipes to the next image; background tints per step (Awwwards Pack).
import type { Component } from "./_types";

const c: Component = {
  id: "scroll-29",
  type: "story-wipe",
  kind: "section",
  weight: "light",
  describe: "story-wipe (scroll-29): a section title, then two columns. 3-5 text blocks (title of 2-4 words, 25-50 words of text) scroll up the left, one screen each, while a rounded landscape photo stays pinned mid-screen on the right; as each new block arrives the current photo wipes away from its bottom edge upward to reveal the next one, and the whole section's background shifts to a slightly different tint. Needs one landscape photo per block. For services, a process in steps or 'what we build' overviews; on phones it stacks the title, then photo and text for each step.",
  fields: `{"type":"story-wipe","component":"scroll-29","title":"","items":[{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""}]}`,
  images: { min: 3, max: 5 },
  css: ({ pair, capsRule }) => `
.swipe{padding:clamp(4rem,10vh,8rem) 0 0;background:var(--bg)}
.swipe__head{padding:0 var(--gutter);margin-bottom:clamp(1rem,4vh,3rem)}
.swipe__head h2{font-size:clamp(2rem,5vw,4.5rem);max-width:14ch}
.swipe__grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:clamp(2rem,6vw,6rem);padding:0 var(--gutter);max-width:1280px;margin:0 auto}
.swipe__step{min-height:100svh;display:grid;align-content:center;gap:1rem;max-width:28rem}
.swipe__step .mono{margin-bottom:.2rem}
.swipe__step h3{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}font-size:clamp(1.8rem,3.2vw,3rem);line-height:1}
.swipe__step p{color:var(--ink2);font-size:1.05rem}
.swipe__sticky{position:sticky;top:0;height:100svh;display:flex;align-items:center}
.swipe__frame{position:relative;width:100%;aspect-ratio:4/3;max-height:72svh;border-radius:16px;overflow:hidden;background:var(--bg2)}
.swipe__pic{position:absolute;inset:0}
.swipe__pic img{width:100%;height:100%;object-fit:cover;object-position:50% 50%;will-change:clip-path,object-position}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .swipe{padding-bottom:1rem}
  .swipe__grid{display:flex;flex-direction:column;gap:1.2rem}
  .swipe__left,.swipe__right,.swipe__sticky,.swipe__frame{display:contents}
  .swipe__step{min-height:0;padding:0 0 2.5rem;max-width:none}
  .swipe__pic{position:relative;inset:auto;aspect-ratio:4/3;border-radius:12px;overflow:hidden;background:var(--bg2)}
  .swipe__pic img{clip-path:none!important;object-position:50% 50%!important}
  .swipe__step:nth-child(1){order:1}.swipe__pic:nth-child(1){order:2}
  .swipe__step:nth-child(2){order:3}.swipe__pic:nth-child(2){order:4}
  .swipe__step:nth-child(3){order:5}.swipe__pic:nth-child(3){order:6}
  .swipe__step:nth-child(4){order:7}.swipe__pic:nth-child(4){order:8}
  .swipe__step:nth-child(5){order:9}.swipe__pic:nth-child(5){order:10}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, 5);
    const pic = (it, i) => it.image?.url ? it.image : it.url ? it : (s.images || [])[i];
    return `
<section class="swipe" data-fx="story-wipe">
  <div class="swipe__head"><h2 class="display">${esc(s.title)}</h2></div>
  <div class="swipe__grid">
    <div class="swipe__left">${items.map((it, i) => `<article class="swipe__step"><div class="mono">0${i + 1}</div><h3>${esc(it.title)}</h3><p>${esc(it.text)}</p></article>`).join("")}</div>
    <div class="swipe__right"><div class="swipe__sticky"><div class="swipe__frame">${items.map((it, i) => { const im = pic(it, i); return `<div class="swipe__pic"><img src="${esc(imgUrl(im, 1600))}" alt="${esc(it.alt || im?.alt || it.title || "")}" loading="lazy"></div>`; }).join("")}</div></div></div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="story-wipe"]');
  if (!sec) return;
  var pics = Array.prototype.slice.call(sec.querySelectorAll('.swipe__pic'));
  pics.forEach(function(p, i){ p.style.zIndex = String(pics.length - i); });
  var imgs = pics.map(function(p){ return p.querySelector('img'); });
  if (!window.__fx.FX || imgs.length < 2) return;
  var grid = sec.querySelector('.swipe__grid');
  var cs = getComputedStyle(document.documentElement);
  var tok = function(n){ return cs.getPropertyValue(n).trim(); };
  var bg = tok('--bg'), mix = gsap.utils.interpolate;
  var tints = [bg, tok('--bg2'), mix(bg, tok('--accent'), 0.12), mix(bg, tok('--inv-bg'), 0.09), mix(bg, tok('--accent'), 0.06)];
  gsap.set(sec, { backgroundColor: tints[0] });
  gsap.set(imgs, { clipPath: 'inset(0% 0% 0% 0%)', objectPosition: '50% 50%' });
  gsap.set(imgs.slice(1), { objectPosition: '50% 35%' });
  var n = imgs.length;
  var tl = gsap.timeline({ scrollTrigger: { trigger: grid, start: 'top top', end: 'bottom bottom', scrub: true } });
  for (var i = 0; i < n - 1; i++) {
    tl.to(imgs[i], { clipPath: 'inset(0% 0% 100% 0%)', objectPosition: '50% 70%', duration: 0.5, ease: 'none' }, i + 0.3)
      .to(imgs[i + 1], { objectPosition: '50% 50%', duration: 0.5, ease: 'none' }, i + 0.3)
      .to(sec, { backgroundColor: tints[(i + 1) % tints.length], duration: 0.6, ease: 'power2.inOut' }, i + 0.25);
  }
  tl.set({}, {}, n - 1);
})();`,
};
export default c;
