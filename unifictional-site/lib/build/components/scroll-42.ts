// @ts-nocheck
// scroll-42 · Pinned hero: the brand mark blurs away and six photo-faced CSS cubes spin in from deep in the scene to settle around the copy (Awwwards Pack).
// The demo's six-block logo becomes ctx.brandMark(); cube poses are the
// demo's cubesData, the cube size scales with the viewport, and the 36 faces
// cycle the six supplied photos.
import type { Component } from "./_types";

const POSES = [
  { i: [-55, 37.5, 360, -360, -48], f: [50, 15, 0, 3, 0] },
  { i: [-35, 32.5, -360, 360, 90], f: [75, 25, 1, 2, 0] },
  { i: [-65, 50, -360, -360, -180], f: [25, 25, -1, 2, 0] },
  { i: [-35, 50, -360, -360, -180], f: [75, 75, 1, -2, 0] },
  { i: [-55, 62.5, 360, 360, -135], f: [25, 75, -1, -2, 0] },
  { i: [-35, 67.5, -180, -360, -180], f: [50, 85, 0, -3, 0] },
];
const FACES = ["front", "back", "right", "left", "top", "bottom"];

const c: Component = {
  id: "scroll-42",
  type: "hero-cubes",
  kind: "hero",
  weight: "medium",
  describe: "hero-cubes (scroll-42): a pinned opening screen with the brand mark near the top and the headline centred under it. As you scroll the mark blurs away and six small photo-covered cubes spin in from deep in the scene, tumbling toward the viewer, and settle three on each side of the centre while the headline blurs out and the sub line with the button sharpens in; in the second half two cubes turn to show another face. Needs a 3-8 word headline, a one or two sentence sub, a button and 6 square-ish photos (they also cover the cubes' other faces). A playful, product-led opening for shops, makers, food, fitness, studios and agencies with good photography.",
  fields: `{"type":"hero-cubes","component":"scroll-42","headline":"","sub":"","cta":{"label":"","href":"contact"},"images":[{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""}]}`,
  images: { min: 6, max: 6 },
  css: ({ pair, capsRule }) => `
.hc{height:500svh;position:relative;--cs:clamp(96px,11vw,150px)}
.hc__stage{position:sticky;top:0;height:100svh;overflow:hidden}
.hc__mark{position:absolute;top:25%;left:50%;transform:translate(-50%,-50%);z-index:2;will-change:filter,opacity}
.hc__mark .nav__brand{font-size:clamp(1.6rem,3vw,2.6rem);gap:.4em}
.hc__mark .nav__brand i{width:.5em;height:.5em}
.hc__mark .nav__brand img,.hc__mark .nav__brand svg{height:clamp(44px,6vw,72px);max-width:50vw}
.hc__cubes{position:absolute;inset:0;transform-style:preserve-3d;perspective:10000px;opacity:0;pointer-events:none}
.hc__cube{position:absolute;width:var(--cs);height:var(--cs);transform-style:preserve-3d;top:-50%;left:50%;transform:translate3d(-50%,-50%,-30000px)}
.hc__face{position:absolute;width:var(--cs);height:var(--cs);transform-style:preserve-3d;backface-visibility:visible;overflow:hidden;background:var(--bg2)}
.hc__face img{width:100%;height:100%;object-fit:cover}
.hc__face--front{transform:translateZ(calc(var(--cs)/2))}
.hc__face--back{transform:translateZ(calc(var(--cs)/-2)) rotateY(180deg)}
.hc__face--right{transform:translateX(calc(var(--cs)/2)) rotateY(90deg)}
.hc__face--left{transform:translateX(calc(var(--cs)/-2)) rotateY(-90deg)}
.hc__face--top{transform:translateY(calc(var(--cs)/-2)) rotateX(90deg)}
.hc__face--bottom{transform:translateY(calc(var(--cs)/2)) rotateX(-90deg)}
.hc__h1{position:absolute;top:50%;left:50%;width:min(64%,56rem);transform:translate(-50%,-50%);text-align:center;will-change:transform,filter,opacity;z-index:3}
.hc__h1 h1{font-size:clamp(2.6rem,6vw,6.5rem);line-height:.98}
.hc__h2{position:absolute;top:50%;left:50%;width:min(38rem,80%);transform:translate(-50%,-50%) scale(.75);opacity:0;filter:blur(10px);text-align:center;display:grid;gap:1.6rem;justify-items:center;pointer-events:none;z-index:3}
.hc__h2 p{font-size:clamp(1.05rem,1.5vw,1.35rem);color:var(--ink2);max-width:44ch;line-height:1.5}
.hc__scroll{position:absolute;right:var(--gutter);bottom:2rem;z-index:4;font-family:var(--mono);font-size:.65rem;letter-spacing:.2em;text-transform:uppercase;color:var(--ink2);display:flex;align-items:center;gap:.8rem}
.hc__scroll i{width:1px;height:48px;background:currentColor;opacity:.5;display:block}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .hc{height:auto;min-height:100svh}
  .hc__stage{position:static;height:auto;min-height:100svh;overflow:visible;display:grid;align-content:center;gap:2rem;padding:7rem var(--gutter) 3rem}
  .hc__mark{position:static;transform:none;justify-self:start;filter:none!important;opacity:1!important}
  .hc__h1,.hc__h2{position:static;transform:none!important;opacity:1!important;filter:none!important;width:auto;text-align:left;justify-items:start;pointer-events:auto!important}
  .hc__h1 h1{font-size:clamp(2.4rem,11vw,4rem)}
  .hc__cubes{position:static;opacity:1!important;perspective:none;transform-style:flat;display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;pointer-events:auto}
  .hc__cube{position:static;transform:none!important;width:100%;height:auto;aspect-ratio:1;transform-style:flat}
  .hc__face{display:none}
  .hc__face--front{display:block;position:static;transform:none;width:100%;height:100%}
  .hc__scroll{display:none}
}`,
  html: (s, { esc, imgUrl, link, arrow, brandMark }) => {
    const imgs = (s.images || []).filter(im => im && (im.url || im.query)).slice(0, 6);
    const n = imgs.length;
    const cubes = POSES.map((_, ci) => `<div class="hc__cube hc__cube--${ci + 1}">${FACES.map((f, fi) => {
      const im = n ? imgs[(ci + fi) % n] : null;
      const u = im ? imgUrl(im, 400) : "";
      const first = ci === 0 && fi === 0;
      return `<div class="hc__face hc__face--${f}">${u ? `<img src="${esc(u)}" alt="${fi === 0 ? esc(im.alt || "") : ""}" ${first ? 'fetchpriority="high"' : 'loading="lazy"'}>` : ""}</div>`;
    }).join("")}</div>`).join("");
    return `
<section class="hc" id="top" data-fx="hero-cubes">
  <div class="hc__stage">
    <div class="hc__mark">${brandMark()}</div>
    <div class="hc__cubes" aria-hidden="true">${cubes}</div>
    <div class="hc__h1"><h1 class="display">${esc(s.headline || "")}</h1></div>
    <div class="hc__h2">${s.sub ? `<p>${esc(s.sub)}</p>` : ""}${s.cta ? `<a class="btn btn-primary" href="${esc(link(s.cta.href))}">${esc(s.cta.label)}${arrow}</a>` : ""}</div>
    <div class="hc__scroll"><span>Scroll</span><i></i></div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="hero-cubes"]');
  if (!sec || !window.__fx.FX) return;
  var mark = sec.querySelector('.hc__mark'), cubesBox = sec.querySelector('.hc__cubes'), h1 = sec.querySelector('.hc__h1'), h2 = sec.querySelector('.hc__h2'), hint = sec.querySelector('.hc__scroll');
  var cubes = Array.prototype.slice.call(sec.querySelectorAll('.hc__cube'));
  var P = ${JSON.stringify(POSES)};
  var L = function(a, b, t){ return a + (b - a) * t; };
  var C = function(v){ return Math.max(0, Math.min(1, v)); };
  var proxy = { p: 0 };
  function render(){
    var p = proxy.p;
    var ip = Math.min(p * 20, 1);
    mark.style.filter = 'blur(' + L(0, 20, ip) + 'px)';
    mark.style.opacity = 1 - C((p - 0.02) * 100);
    cubesBox.style.opacity = C((p - 0.01) * 100);
    var a1 = Math.min(p * 2.5, 1);
    h1.style.transform = 'translate(-50%, -50%) scale(' + L(1, 1.5, a1) + ')';
    h1.style.filter = 'blur(' + L(0, 20, a1) + 'px)';
    h1.style.opacity = 1 - a1;
    h1.style.pointerEvents = a1 < 0.5 ? 'auto' : 'none';
    var a2 = C((p - 0.4) * 10);
    h2.style.transform = 'translate(-50%, -50%) scale(' + L(0.75, 1, a2) + ')';
    h2.style.filter = 'blur(' + L(10, 0, a2) + 'px)';
    h2.style.opacity = a2;
    h2.style.pointerEvents = a2 > 0.5 ? 'auto' : 'none';
    if (hint) hint.style.opacity = 1 - C(p * 8);
    var f1 = Math.min(p * 2, 1), f2 = p >= 0.5 ? (p - 0.5) * 2 : 0;
    for (var k = 0; k < cubes.length; k++) {
      var d = P[k]; if (!d) break;
      var extra = k === 1 ? L(0, 180, f2) : k === 3 ? L(0, -180, f2) : 0;
      cubes[k].style.top = L(d.i[0], d.f[0], f1) + '%';
      cubes[k].style.left = L(d.i[1], d.f[1], f1) + '%';
      cubes[k].style.transform = 'translate3d(-50%, -50%, ' + L(-30000, 0, f1) + 'px) rotateX(' + L(d.i[2], d.f[2], f1) + 'deg) rotateY(' + (L(d.i[3], d.f[3], f1) + extra) + 'deg) rotateZ(' + L(d.i[4], d.f[4], f1) + 'deg)';
    }
  }
  render();
  gsap.to(proxy, { p: 1, ease: 'none', onUpdate: render, scrollTrigger: { trigger: sec, start: 'top top', end: 'bottom bottom', scrub: 0.6 } });
})();`,
};
export default c;
