// @ts-nocheck
// hero-7 · Capsule preloader into hero reveal (Awwwards Pack).
// A pill-shaped loader fills while a brand word slides through it; the pill
// then becomes a window that scales open onto the full-bleed hero photo and
// the copy rises out of masks. Skipped entirely for reduced motion / phones.
import type { Component } from "./_types";

const c: Component = {
  id: "hero-7",
  type: "hero-reveal",
  kind: "hero",
  weight: "light",
  describe: "hero-reveal (hero-7): the page opens on a pill-shaped loader in the page colour; a short brand WORD (1-12 letters) slides in letter by letter while the bar fills, then the pill turns into a window that scales open onto a full-bleed hero photo. The headline rises word by word at the bottom left with the sub and a button; about 2.5 s from load to hero, skipped on phones and for reduced motion. Needs one strong wide photo, a 3-8 word headline and a one-sentence sub. A cinematic entrance for a home page: studios, hospitality, premium trades, products, architecture.",
  fields: `{"type":"hero-reveal","component":"hero-7","word":"","headline":"","sub":"","cta":{"label":"","href":"contact"},"image":{"query":"","alt":""}}`,
  images: { min: 1, max: 1 },
  css: ({ t, pair, capsRule }) => `
.hero-reveal{position:relative;height:100svh;overflow:hidden;background:var(--bg)}
.hero-reveal__pre{position:fixed;inset:0;z-index:70;overflow:hidden;pointer-events:none;display:grid;place-items:center}
.hero-reveal__hole,.hero-reveal__pill{grid-area:1/1;width:min(72vw,980px);height:min(24vw,260px);min-height:180px;border-radius:999px;will-change:transform,opacity}
.hero-reveal__hole{transform:scale(.8);box-shadow:0 0 0 300vmax var(--bg)}
.hero-reveal__pill{position:relative;transform:scale(.86);background:color-mix(in srgb,var(--bg),var(--ink) 9%);overflow:hidden;z-index:1}
.hero-reveal__bar{position:absolute;inset:0;background:var(--ink);transform:scaleX(0);transform-origin:left center;will-change:transform}
.hero-reveal__word{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;mix-blend-mode:difference;color:#fff;font-family:var(--display);font-weight:${pair.weight};font-size:clamp(2.2rem,4vw,4rem);letter-spacing:${pair.caps ? ".04em" : pair.track};text-transform:uppercase;line-height:1;white-space:nowrap}
.hero-reveal__word i{display:inline-block;overflow:hidden;font-style:normal;padding:0 .03em}
.hero-reveal__word i b{display:inline-block;font-weight:inherit;transform:translateX(105%)}
.hero-reveal__tag{position:absolute;left:50%;bottom:3.5rem;transform:translateX(-50%);width:min(34rem,70vw);text-align:center;color:var(--ink2);font-size:.95rem;overflow:hidden;z-index:2}
.hero-reveal__tag span{display:block;transform:translateY(110%)}
.hero-reveal__img{position:absolute;inset:0;z-index:1;overflow:hidden}
.hero-reveal__img img{width:100%;height:100%;object-fit:cover;transform:scale(1.3);will-change:transform}
.hero-reveal__img::after{content:"";position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.65),rgba(0,0,0,.08) 55%)}
.hero-reveal__copy{position:absolute;left:var(--gutter);right:var(--gutter);bottom:clamp(2rem,7vh,4.5rem);z-index:2;display:grid;gap:1.4rem;max-width:56rem;color:#fff}
.hero-reveal__copy h1{font-size:clamp(2.6rem,7.2vw,7.5rem);line-height:.95;font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}max-width:14ch}
.hero-reveal__copy h1 .w{display:inline-block;overflow:hidden;vertical-align:bottom;padding:0 .04em .1em 0;margin-bottom:-.1em}
.hero-reveal__copy h1 .w b{display:inline-block;font-weight:inherit;transform:translateY(110%)}
.hero-reveal__copy .ln{display:block;overflow:hidden}
.hero-reveal__copy .ln>*{display:block;transform:translateY(110%)}
.hero-reveal__copy .ln .btn{display:inline-flex}
.hero-reveal__copy p{max-width:44ch;color:rgba(255,255,255,.78);font-size:1.08rem}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .hero-reveal__pre{display:none}
  .hero-reveal{height:auto;min-height:100svh;display:grid;align-content:end}
  .hero-reveal__img img{transform:none}
  .hero-reveal__img::after{background:linear-gradient(to top,rgba(0,0,0,.75),rgba(0,0,0,.2))}
  .hero-reveal__copy{position:relative;inset:auto;padding:8rem var(--gutter) 3rem;max-width:none}
  .hero-reveal__copy h1 .w b,.hero-reveal__copy .ln>*{transform:none}
}`,
  html: (s, { spec, esc, imgUrl, link, arrow }) => {
    const word = String(s.word || (spec.brand?.name || "").split(/\s+/)[0] || "").replace(/[^A-Za-z0-9&'.-]/g, "").slice(0, 12) || "Studio";
    const chars = [...word].map(ch => `<i><b>${esc(ch)}</b></i>`).join("");
    const words = String(s.headline || "").trim().split(/\s+/).filter(Boolean).map(w => `<span class="w"><b>${esc(w)}</b></span>`).join(" ");
    return `
<section class="hero-reveal" id="top" data-fx="hero-reveal">
  <div class="hero-reveal__pre" aria-hidden="true">
    <div class="hero-reveal__hole"></div>
    <div class="hero-reveal__pill"><div class="hero-reveal__bar"></div><div class="hero-reveal__word">${chars}</div></div>
    <div class="hero-reveal__tag"><span>${esc(spec.brand?.tagline || s.sub || "")}</span></div>
  </div>
  <div class="hero-reveal__img"><img src="${esc(imgUrl(s.image, 2000))}" alt="${esc(s.image?.alt || "")}" fetchpriority="high"></div>
  <div class="hero-reveal__copy">
    <h1>${words}</h1>
    <span class="ln"><p>${esc(s.sub || "")}</p></span>
    ${s.cta ? `<span class="ln"><span><a class="btn btn-primary" href="${esc(link(s.cta.href))}">${esc(s.cta.label)}${arrow}</a></span></span>` : ""}
  </div>
</section>`;
  },
  js: () => `
(function(){
  var el = document.querySelector('[data-fx="hero-reveal"]');
  if (!el) return;
  var pre = el.querySelector('.hero-reveal__pre');
  if (!window.__fx.FX) { if (pre) pre.remove(); return; }
  var hole = el.querySelector('.hero-reveal__hole'), pill = el.querySelector('.hero-reveal__pill'), bar = el.querySelector('.hero-reveal__bar');
  var chars = el.querySelectorAll('.hero-reveal__word b'), tag = el.querySelector('.hero-reveal__tag span');
  var img = el.querySelector('.hero-reveal__img img'), hw = el.querySelectorAll('.hero-reveal__copy h1 .w b'), lines = el.querySelectorAll('.hero-reveal__copy .ln > *');
  // CSS holds the pre-JS state in percentages; hand those to GSAP explicitly.
  gsap.set(chars, { x: 0, xPercent: 105 });
  gsap.set(tag, { y: 0, yPercent: 110 });
  gsap.set(hw, { y: 0, yPercent: 110 });
  gsap.set(lines, { y: 0, yPercent: 110 });
  gsap.set(hole, { scale: 0.8 });
  gsap.set(pill, { scale: 0.86 });
  gsap.set(img, { scale: 1.3 });
  gsap.timeline({ delay: 0.1 })
    .to(pill, { scale: 1, duration: 0.5, ease: 'power4.out' }, 0)
    .to(chars, { xPercent: 0, duration: 0.55, stagger: 0.04, ease: 'power4.inOut' }, 0)
    .to(tag, { yPercent: 0, duration: 0.55, ease: 'power4.inOut' }, 0.15)
    .to(bar, { scaleX: 0.42, duration: 0.3, ease: 'power3.out' }, 0.1)
    .to(bar, { scaleX: 0.68, duration: 0.3, ease: 'power3.out' }, 0.45)
    .to(bar, { scaleX: 1, duration: 0.35, ease: 'power3.out' }, 0.8)
    .to(chars, { xPercent: -105, duration: 0.45, stagger: 0.03, ease: 'power4.inOut' }, 1.0)
    .to(tag, { yPercent: -110, duration: 0.35, ease: 'power4.inOut' }, 1.05)
    .to(pill, { opacity: 0, duration: 0.35, ease: 'power3.out' }, 1.2)
    .to(hole, { scale: 7, duration: 1.3, ease: 'power3.out' }, 1.2)
    .to(img, { scale: 1, duration: 1.5, ease: 'power3.out' }, 1.15)
    .to(hw, { yPercent: 0, duration: 0.9, stagger: 0.04, ease: 'power4.out' }, 1.35)
    .to(lines, { yPercent: 0, duration: 0.9, stagger: 0.12, ease: 'power4.out' }, 1.55)
    .set(pre, { display: 'none' }, 2.6);
})();`,
};
export default c;
