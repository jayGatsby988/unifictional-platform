// @ts-nocheck
// scroll-4 · A full-screen photo contracts into the middle pill of a five-photo row as you scroll (Awwwards Pack).
// The demo toggles on a button click; here the same timeline is scrubbed on a pinned stage.
import type { Component } from "./_types";

const c: Component = {
  id: "scroll-4",
  type: "gallery-collapse-4",
  kind: "section",
  weight: "light",
  describe: "gallery-collapse-4 (scroll-4): a pinned screen that opens as one full-bleed photo with a single word set huge across it. As you scroll the photo contracts into a tall rounded pill in the middle of the screen while four more pill-shaped photos fly in from depth on either side and the word's letters flatten away; a one-line caption and a button then fade in under the row. Needs exactly 5 photos (the first is the cover), one word of 3-10 letters, a caption of 8-20 words and a button. A cover that opens into a mini gallery: interiors, venues, products, portfolios, finished work. Phones get the cover photo, the word and a two-column grid of the other four.",
  fields: `{"type":"gallery-collapse-4","component":"scroll-4","word":"","text":"","cta":{"label":"","href":"work"},"images":[{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""}]}`,
  images: { min: 5, max: 5 },
  css: ({ pair, capsRule }) => `
.gcol{height:300svh}
.gcol__stage{position:sticky;top:0;height:100svh;overflow:hidden;background:var(--bg2)}
.gcol__slides{position:absolute;inset:0;padding-bottom:12svh;display:grid;grid-template-columns:repeat(5,22%);gap:2.5vw;align-items:center;justify-content:center;perspective:1000px;pointer-events:none}
.gcol__slide{height:56svh;max-height:62vw;width:100%;border-radius:23vw;overflow:hidden;opacity:0;transform:translateZ(600px);will-change:transform,opacity}
.gcol__slide img{width:100%;height:100%;object-fit:cover}
.gcol__slide--current{visibility:hidden}
.gcol__clip{position:absolute;inset:0;overflow:hidden;will-change:clip-path}
.gcol__clip img{width:100%;height:100%;object-fit:cover;will-change:transform}
.gcol__shade{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.45),rgba(0,0,0,.12) 60%)}
.gcol__cover{position:absolute;inset:0;z-index:2;display:grid;grid-template-rows:1fr auto;justify-items:center;pointer-events:none}
.gcol__word{align-self:center;display:flex;font-family:var(--display);font-weight:${pair.weight};font-size:clamp(3rem,11vw,13rem);line-height:1;letter-spacing:${pair.track};text-transform:uppercase;color:#fff;margin-top:6vh}
.gcol__word span{display:inline-block;transform-origin:50% 100%;will-change:transform}
.gcol__foot{display:grid;gap:.8rem;justify-items:center;text-align:center;padding:0 var(--gutter) clamp(1.2rem,3.5vh,2.5rem);max-width:44rem;opacity:0;transform:translateY(16px);pointer-events:auto}
.gcol__foot p{color:var(--ink2);font-size:1rem;line-height:1.4}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .gcol{height:auto}
  .gcol__stage{position:static;height:auto;display:grid;gap:1.5rem;padding:0 0 3rem;background:var(--bg)}
  .gcol__clip{order:1;position:relative;inset:auto;aspect-ratio:4/3;clip-path:none!important}
  .gcol__clip img{transform:none!important;filter:none!important}
  .gcol__shade{display:none}
  .gcol__cover{order:2;position:relative;inset:auto;grid-template-rows:auto auto;gap:1.2rem;padding:0 var(--gutter)}
  .gcol__word{color:var(--ink);font-size:clamp(2.6rem,12vw,5rem);margin:0}
  .gcol__word span{transform:none!important}
  .gcol__foot{opacity:1;transform:none;padding:0;max-width:none}
  .gcol__slides{order:3;position:relative;inset:auto;grid-template-columns:1fr 1fr;gap:.6rem;padding:0 var(--gutter);perspective:none;pointer-events:auto}
  .gcol__slide{opacity:1!important;transform:none!important;height:auto;aspect-ratio:1;border-radius:1rem}
  .gcol__slide--current{display:none}
}`,
  html: (s, { spec, esc, imgUrl, link, arrow }) => {
    const imgs = (s.images || []).slice(0, 5);
    while (imgs.length < 5) imgs.push(imgs[imgs.length - 1] || {});
    const word = String(s.word || spec.brand.name).toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 12) || "WORK";
    const cover = imgs[0];
    const order = [1, 2, 0, 3, 4];
    const slide = (i) => i === 0
      ? `<div class="gcol__slide gcol__slide--current"></div>`
      : `<div class="gcol__slide"><img src="${esc(imgUrl(imgs[i], 900))}" alt="${esc(imgs[i].alt || "")}" loading="lazy"></div>`;
    return `
<section class="gcol" data-fx="gallery-collapse-4">
  <div class="gcol__stage">
    <div class="gcol__slides">${order.map(slide).join("")}</div>
    <div class="gcol__clip"><img src="${esc(imgUrl(cover, 2000))}" alt="${esc(cover.alt || "")}" loading="lazy"><div class="gcol__shade"></div></div>
    <div class="gcol__cover">
      <h2 class="gcol__word" aria-label="${esc(word)}">${word.split("").map(ch => `<span aria-hidden="true">${ch === " " ? "&nbsp;" : ch}</span>`).join("")}</h2>
      <div class="gcol__foot">${s.text ? `<p>${esc(s.text)}</p>` : ""}${s.cta ? `<a class="btn btn-primary" href="${esc(link(s.cta.href))}">${esc(s.cta.label)}${arrow}</a>` : ""}</div>
    </div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="gallery-collapse-4"]');
  if (!sec || !window.__fx.FX) return;
  var clip = sec.querySelector('.gcol__clip'), img = clip.querySelector('img'), shade = clip.querySelector('.gcol__shade');
  var slides = sec.querySelectorAll('.gcol__slide:not(.gcol__slide--current)');
  var chars = sec.querySelectorAll('.gcol__word span'), foot = sec.querySelector('.gcol__foot');
  gsap.set(clip, { clipPath: 'inset(0% 0% round 0vw)' });
  gsap.timeline({ scrollTrigger: { trigger: sec, start: 'top top', end: 'bottom bottom', scrub: 0.8 }, defaults: { duration: 1.2, ease: 'power4.inOut' } })
    .to(clip, { clipPath: 'inset(16% 39% 28% round 23vw)' }, 0)
    .to(img, { scale: 0.8 }, 0)
    .to(shade, { opacity: 0, duration: 0.6 }, 0)
    .fromTo(slides, { opacity: 0, z: 600 }, { opacity: 1, z: 0, duration: 1.4, ease: 'power3.inOut', stagger: { amount: 0.15, from: 'center' } }, 0)
    .to(chars, { scaleY: 0, duration: 1, stagger: { amount: 0.2, from: 'center' } }, 0)
    .to(foot, { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' }, 1.1)
    .to({}, { duration: 0.6 });
})();`,
};
export default c;
