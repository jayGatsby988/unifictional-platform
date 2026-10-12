// @ts-nocheck
// scroll-34 · Pinned zoom through a window frame (Awwwards Pack).
// A wall in the page colour with a rounded window cut out of it (a CSS
// box-shadow cutout, no PNG) sits over a tall photo. Scrolling pushes the
// camera through the window: the wall and its corner headings scale past the
// edges while the photo pans; then the sub and button rise over the photo.
import type { Component } from "./_types";

const c: Component = {
  id: "scroll-34",
  type: "hero-zoom",
  kind: "hero",
  weight: "light",
  describe: "hero-zoom (scroll-34): a pinned opener. A wall in the page colour with a tall rounded window cut out of it shows a photo through the opening; the headline sits in the corners of the wall as 3-5 short lines (write them with \"/\" between lines: the first half top-left, the rest bottom-right). Scrolling pushes the camera through the window: the wall and headline fly past the edges while the photo pans upward, then the sub and button rise in over the full-bleed photo. Needs one tall or square photo with room to pan (sky, landscape, interior, water). Suits travel, architecture, hospitality, outdoor and landscape businesses, or any brand with one atmospheric photo.",
  fields: `{"type":"hero-zoom","component":"scroll-34","headline":"line one / line two / line three / line four","sub":"","cta":{"label":"","href":"contact"},"image":{"query":"","alt":""}}`,
  images: { min: 1, max: 1 },
  css: ({ t, pair, capsRule }) => `
.hero-zoom{height:400svh;position:relative}
.hero-zoom__pin{position:sticky;top:0;height:100svh;overflow:hidden;background:var(--bg)}
.hero-zoom__photo{position:absolute;inset:0;z-index:1;overflow:hidden}
.hero-zoom__photo img{width:100%;height:170%;object-fit:cover;will-change:transform}
.hero-zoom__photo::after{content:"";position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.6),rgba(0,0,0,0) 55%)}
.hero-zoom__copy{position:absolute;left:var(--gutter);right:var(--gutter);bottom:clamp(2rem,7vh,5rem);z-index:2;display:grid;gap:1.6rem;max-width:50rem;color:#fff;opacity:0;transform:translateY(60%)}
.hero-zoom__copy p{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}font-size:clamp(1.4rem,2.6vw,2.4rem);line-height:1.15;max-width:34ch}
.hero-zoom__frame{position:absolute;inset:0;z-index:3;transform-origin:50% 50%;will-change:transform}
.hero-zoom__hole{position:absolute;top:50%;left:50%;width:min(46vh,60vw);height:min(60vh,78vw);transform:translate(-50%,-50%);border-radius:46%/35.4%;box-shadow:0 0 0 200vmax var(--bg),inset 0 0 0 clamp(8px,1vw,14px) ${t.dark ? "rgba(255,255,255,.14)" : "rgba(14,14,14,.12)"},inset 0 0 60px rgba(0,0,0,.35)}
.hero-zoom__head{position:absolute;inset:0;color:var(--ink)}
.hero-zoom__head h1{font-size:clamp(2rem,4.6vw,4.8rem);line-height:.95;max-width:none}
.hero-zoom__tl,.hero-zoom__br{position:absolute;display:block;max-width:30vw}
.hero-zoom__tl{left:var(--gutter);top:6.5rem}
.hero-zoom__br{right:var(--gutter);bottom:clamp(2rem,6vh,4rem);text-align:right}
.hero-zoom__tag{position:absolute;right:var(--gutter);top:6.8rem}
.hero-zoom__hint{position:absolute;left:var(--gutter);bottom:clamp(2rem,6vh,4rem);display:flex;align-items:center;gap:.8rem}
.hero-zoom__hint i{width:1px;height:48px;background:currentColor;opacity:.5;display:block}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .hero-zoom{height:auto}
  .hero-zoom__pin{position:relative;height:auto;min-height:100svh;display:grid;align-content:end;gap:1.6rem;padding:8rem var(--gutter) 3rem}
  .hero-zoom__photo{z-index:0}
  .hero-zoom__photo img{height:100%;transform:none!important}
  .hero-zoom__photo::after{background:linear-gradient(to top,rgba(0,0,0,.78),rgba(0,0,0,.2))}
  .hero-zoom__frame{position:relative;inset:auto;transform:none!important;opacity:1!important;visibility:visible!important;z-index:2;order:1}
  .hero-zoom__hole,.hero-zoom__tag,.hero-zoom__hint{display:none}
  .hero-zoom__head{position:relative;inset:auto;color:#fff}
  .hero-zoom__head h1{font-size:clamp(2.6rem,11vw,5rem)}
  .hero-zoom__tl,.hero-zoom__br{position:static;max-width:none;text-align:left}
  .hero-zoom__copy{position:relative;inset:auto;transform:none!important;opacity:1!important;order:2;max-width:none}
  .hero-zoom__copy p{font-family:var(--body);font-weight:400;letter-spacing:0;text-transform:none;font-size:1.05rem;color:rgba(255,255,255,.8);line-height:1.5;max-width:44ch}
}`,
  html: (s, { spec, esc, imgUrl, link, arrow }) => {
    const lines = String(s.headline || "").split(/\s*\/\s*|\n/).map(l => l.trim()).filter(Boolean).slice(0, 5);
    const half = Math.ceil(lines.length / 2);
    const tl = lines.slice(0, half).map(esc).join("<br>");
    const br = lines.slice(half).map(esc).join("<br>");
    return `
<section class="hero-zoom" id="top" data-fx="hero-zoom">
  <div class="hero-zoom__pin">
    <div class="hero-zoom__photo"><img src="${esc(imgUrl(s.image, 2000))}" alt="${esc(s.image?.alt || "")}" fetchpriority="high"></div>
    <div class="hero-zoom__copy">
      <p>${esc(s.sub || "")}</p>
      ${s.cta ? `<div><a class="btn btn-primary" href="${esc(link(s.cta.href))}">${esc(s.cta.label)}${arrow}</a></div>` : ""}
    </div>
    <div class="hero-zoom__frame">
      <div class="hero-zoom__hole"></div>
      <div class="hero-zoom__head">
        <h1 class="display"><span class="hero-zoom__tl">${tl}</span>${br ? `<span class="hero-zoom__br">${br}</span>` : ""}</h1>
        <span class="mono hero-zoom__tag">${esc(spec.brand?.name || "")}</span>
        <span class="mono hero-zoom__hint"><span>Scroll</span><i></i></span>
      </div>
    </div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var el = document.querySelector('[data-fx="hero-zoom"]');
  if (!el || !window.__fx.FX) return;
  var frame = el.querySelector('.hero-zoom__frame'), img = el.querySelector('.hero-zoom__photo img'), copy = el.querySelector('.hero-zoom__copy');
  gsap.timeline({ scrollTrigger: { trigger: el, start: 'top top', end: 'bottom bottom', scrub: 1 }, defaults: { ease: 'none' } })
    .fromTo(frame, { scale: 1 }, { scale: 6, duration: 0.5, ease: 'power2.in' }, 0)
    .set(frame, { autoAlpha: 0 }, 0.5)
    .fromTo(img, { yPercent: 0 }, { yPercent: -41, duration: 1 }, 0)
    .fromTo(copy, { y: 0, yPercent: 60, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.3, ease: 'power2.out' }, 0.66);
})();`,
};
export default c;
