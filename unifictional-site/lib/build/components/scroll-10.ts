// @ts-nocheck
// scroll-10 · Pinned telescope zoom: thumbnails fly past the camera, the headline parts, and one photo grows
// from the centre through nested blurred copies that sharpen and merge (Awwwards Pack).
// The demo's ScrollSmoother is replaced by the site's Lenis; its PNG subject mask by scaled copies of the photo.
import type { Component } from "./_types";

const POS = ["top:15vw;left:-3vw", "top:5vw;left:20vw", "top:8vw;left:26.5vw", "top:18vw;right:18vw", "top:5vw;right:10vw", "bottom:5vw;left:10vw", "bottom:8vw;left:22.5vw", "bottom:3vw;left:45vw", "bottom:5vw;right:15vw", "bottom:9vw;right:7vw"];
const SCALES = [0.85, 0.62, 0.42, 0.26, 0.14];

const c: Component = {
  id: "scroll-10",
  type: "hero-telescope-10",
  kind: "hero",
  weight: "light",
  describe: "hero-telescope-10 (scroll-10): the page opens on a plain background with the headline in the middle and 6-8 small photos scattered around it. The screen stays pinned while you scroll: the small photos fly toward and past the viewer, the two halves of the headline slide apart off the screen, and one big photo grows from the centre as a telescope of nested, blurred copies that expand, sharpen and merge into the single full-bleed image; sub and button then fade in over it. Needs one strong main photo (a centred subject works best), 6-8 supporting photos, a headline of 2-8 words, a sub and a button. Dramatic opener for photographers, builders, landscapers, venues. Phones show the headline, the main photo and the copy.",
  fields: `{"type":"hero-telescope-10","component":"scroll-10","headline":"","sub":"","cta":{"label":"","href":"contact"},"image":{"query":"","alt":""},"images":[{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""}]}`,
  images: { min: 7, max: 9 },
  css: ({ pair, capsRule }) => `
.htel{height:100svh;position:relative;overflow:hidden}
.htel__pin{position:relative;height:100svh;display:flex;align-items:center;justify-content:center;background:var(--bg);overflow:hidden;--p:0}
.htel__media{position:absolute;inset:0;z-index:0;transform:scale(var(--p));will-change:transform}
.htel__layer{position:absolute;inset:0}
.htel__layer img{width:100%;height:100%;object-fit:cover}
.htel__front{filter:blur(2px);will-change:transform,filter}
${SCALES.map((s, i) => `.htel__front.f${i}{transform:scale(${s})}`).join("")}
.htel__shade{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.6),rgba(0,0,0,0) 55%)}
.htel__thumbs{position:absolute;inset:0;z-index:2;perspective:100vh;pointer-events:none}
.htel__thumbs img{position:absolute;width:10vw;aspect-ratio:4/3;object-fit:cover;will-change:transform}
${POS.map((p, i) => `.htel__thumbs img:nth-child(${i + 1}){${p}}`).join("")}
.htel__title{position:relative;z-index:3;display:flex;gap:.28em;justify-content:center;font-family:var(--display);font-weight:${pair.weight};font-size:clamp(2rem,4.6vw,5rem);line-height:1;letter-spacing:${pair.track};${capsRule}color:var(--ink);text-align:center;margin:0;transform:translateY(-10%)}
.htel__title span{display:inline-block;white-space:nowrap;will-change:transform}
.htel__title .l{transform:translate3d(calc(var(--p) * (-52vw - 100%)),0,0)}
.htel__title .r{transform:translate3d(calc(var(--p) * (52vw + 100%)),0,0)}
.htel__copy{position:absolute;left:var(--gutter);right:var(--gutter);bottom:clamp(2rem,6vh,4rem);z-index:4;display:grid;gap:1.2rem;max-width:42rem;color:#fff;opacity:0;transform:translateY(20px)}
.htel__copy p{max-width:40ch;color:rgba(255,255,255,.78);font-size:1.05rem}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .htel{height:auto}
  .htel__pin{height:auto;display:grid;gap:1.6rem;padding:7rem var(--gutter) 3rem;align-content:start}
  .htel__title{order:1;display:block;transform:none;text-align:left;font-size:clamp(2.6rem,11vw,5rem)}
  .htel__title span{transform:none!important;white-space:normal}
  .htel__media{order:2;position:relative;inset:auto;transform:none!important;aspect-ratio:4/3}
  .htel__front,.htel__shade,.htel__thumbs{display:none}
  .htel__layer{position:relative}
  .htel__copy{order:3;position:relative;inset:auto;color:var(--ink);opacity:1;transform:none;max-width:none}
  .htel__copy p{color:var(--ink2)}
}`,
  html: (s, { esc, imgUrl, link, arrow }) => {
    const words = String(s.headline || "").trim().split(/\s+/).filter(Boolean);
    let L, R;
    if (words.length >= 2) { const h = Math.ceil(words.length / 2); L = words.slice(0, h).join(" "); R = words.slice(h).join(" "); }
    else { const w = words[0] || ""; const h = Math.ceil(w.length / 2); L = w.slice(0, h); R = w.slice(h); }
    const thumbs = (s.images || []).slice(0, 10);
    const main = s.image || thumbs[0] || {};
    const big = esc(imgUrl(main, 2000));
    return `
<section class="htel" id="top" data-fx="hero-telescope-10">
  <div class="htel__pin">
    <div class="htel__media">
      <div class="htel__layer"><img src="${big}" alt="${esc(main.alt || "")}" fetchpriority="high"></div>
      ${SCALES.map((_, i) => `<div class="htel__layer htel__front f${i}" aria-hidden="true"><img src="${big}" alt=""></div>`).join("")}
      <div class="htel__shade"></div>
    </div>
    <div class="htel__thumbs">${thumbs.map(im => `<img src="${esc(imgUrl(im, 600))}" alt="${esc(im.alt || "")}" loading="lazy">`).join("")}</div>
    <h1 class="htel__title"><span class="l">${esc(L)}</span><span class="r">${esc(R)}</span></h1>
    <div class="htel__copy">
      ${s.sub ? `<p>${esc(s.sub)}</p>` : ""}
      ${s.cta ? `<div><a class="btn btn-primary" href="${esc(link(s.cta.href))}">${esc(s.cta.label)}${arrow}</a></div>` : ""}
    </div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="hero-telescope-10"]');
  if (!sec || !window.__fx.FX) return;
  var pin = sec.querySelector('.htel__pin'), fronts = sec.querySelectorAll('.htel__front'), thumbs = sec.querySelectorAll('.htel__thumbs img'), copy = sec.querySelector('.htel__copy');
  var ease = gsap.parseEase('power1.inOut');
  gsap.set(thumbs, { transformStyle: 'preserve-3d', backfaceVisibility: 'hidden', force3D: true });
  var tl = gsap.timeline({ scrollTrigger: { trigger: sec, start: 'top top', end: '+=170%', scrub: 1, pin: pin, pinSpacing: true, invalidateOnRefresh: true,
    onUpdate: function(self){ pin.style.setProperty('--p', ease(Math.min(1, self.progress / 0.78)).toFixed(4)); } } });
  tl.to(thumbs, { z: function(){ return window.innerHeight; }, duration: 1, ease: 'power1.inOut', stagger: { amount: 0.2, from: 'center' } }, 0)
    .to(fronts, { scale: 1, duration: 1, ease: 'power1.inOut' }, 0.7)
    .to(fronts, { filter: 'blur(0px)', duration: 1, ease: 'power1.inOut', stagger: { amount: 0.2, from: 'end' } }, 1.0)
    .to(copy, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, 1.75)
    .to({}, { duration: 0.3 });
  sec.style.height = 'auto';
})();`,
};
export default c;
