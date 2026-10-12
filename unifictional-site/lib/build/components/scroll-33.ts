// @ts-nocheck
// scroll-33 · A thick accent ribbon draws itself down the page as you scroll, snaking behind a zigzag of
// step photos and text cards (Awwwards Pack, video only). The path is built from the photo positions at runtime.
import type { Component } from "./_types";

const c: Component = {
  id: "scroll-33",
  type: "ribbon-steps-33",
  kind: "section",
  weight: "light",
  describe: "(recreated from the preview video) ribbon-steps-33 (scroll-33): a long storytelling section of 3-6 steps laid out as a zigzag, each step a rounded photo on one side and a card with a step number, a short title and 15-40 words of text on the other, alternating sides down the page. A very thick ribbon in the accent colour with rounded ends draws itself down the page as you scroll, swinging in S-curves from photo to photo and passing behind the photos and cards; scrolling back shortens it again. Nothing is pinned. Needs 3-6 photos (or illustrations) with a title and text each. Process, 'how it works' or company story for trades, studios, clinics, agencies. Phones stack the steps without the ribbon.",
  fields: `{"type":"ribbon-steps-33","component":"scroll-33","title":"","intro":"","items":[{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""}]}`,
  images: { min: 3, max: 6 },
  css: ({ pair, capsRule }) => `
.rib{position:relative;padding:clamp(4rem,10vh,8rem) var(--gutter);overflow:hidden}
.rib .sec-head{position:relative;z-index:1}
.rib__svg{position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;overflow:visible}
.rib__path{fill:none;stroke:var(--accent);stroke-linecap:round;stroke-linejoin:round;stroke-width:clamp(44px,7vw,120px)}
.rib__steps{position:relative;z-index:1;display:grid;gap:clamp(5rem,14vh,10rem);max-width:72rem;margin:0 auto;counter-reset:rib}
.rib__step{display:grid;grid-template-columns:1fr 1fr;gap:clamp(2rem,5vw,5rem);align-items:center}
.rib__step:nth-child(even) .rib__fig{order:2}
.rib__fig{margin:0;aspect-ratio:4/3;overflow:hidden;border-radius:1.2rem;background:var(--bg2)}
.rib__fig img{width:100%;height:100%;object-fit:cover}
.rib__card{background:var(--bg2);border:1px solid var(--line);border-radius:1rem;padding:clamp(1.4rem,3vw,2.4rem);display:grid;gap:.8rem;max-width:30rem}
.rib__card h3{font-family:var(--display);font-weight:${pair.weight};font-size:clamp(1.4rem,2.4vw,2.1rem);line-height:1.05;letter-spacing:${pair.track};${capsRule}}
.rib__card p{color:var(--ink2)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .rib__steps{gap:3rem}
  .rib__step{grid-template-columns:1fr;gap:1rem}
  .rib__step:nth-child(even) .rib__fig{order:0}
  .rib__card{max-width:none}
}
@media(max-width:767px){.rib__svg{display:none}}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, 6);
    const pic = (it, i) => it.image?.url ? it.image : it.url ? it : (s.images || [])[i];
    return `
<section class="rib" data-fx="ribbon-steps-33">
  ${s.title ? `<div class="sec-head"><h2 class="display reveal">${esc(s.title)}</h2>${s.intro ? `<p class="reveal">${esc(s.intro)}</p>` : ""}</div>` : ""}
  <svg class="rib__svg" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none"><path class="rib__path" d=""/></svg>
  <ol class="rib__steps">
    ${items.map((it, i) => { const im = pic(it, i); return `<li class="rib__step"><figure class="rib__fig"><img src="${esc(imgUrl(im, 1200))}" alt="${esc(it.alt || im?.alt || it.title || "")}" loading="lazy"></figure><div class="rib__card"><div class="mono">0${i + 1}</div><h3>${esc(it.title)}</h3><p>${esc(it.text)}</p></div></li>`; }).join("")}
  </ol>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="ribbon-steps-33"]');
  if (!sec || window.__fx.SMALL) return;
  var svg = sec.querySelector('.rib__svg'), path = sec.querySelector('.rib__path'), figs = sec.querySelectorAll('.rib__fig');
  if (figs.length < 2) return;
  var len = 0, o = { v: window.__fx.RM ? 1 : 0 };
  function apply(){ path.style.strokeDashoffset = (len * (1 - o.v)).toFixed(2); }
  function build(){
    var r = sec.getBoundingClientRect(), W = sec.offsetWidth, H = sec.offsetHeight;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var pts = Array.prototype.map.call(figs, function(f){ var b = f.getBoundingClientRect(); return { x: b.left - r.left + b.width / 2, y: b.top - r.top + b.height / 2 }; });
    var d = 'M' + pts[0].x.toFixed(1) + ' ' + (pts[0].y - 10).toFixed(1);
    for (var i = 0; i < pts.length - 1; i++) {
      var A = pts[i], B = pts[i + 1], my = (A.y + B.y) / 2, swing = (B.x - A.x) * 0.35;
      d += ' C' + (A.x - swing).toFixed(1) + ' ' + my.toFixed(1) + ' ' + (B.x + swing).toFixed(1) + ' ' + my.toFixed(1) + ' ' + B.x.toFixed(1) + ' ' + B.y.toFixed(1);
    }
    path.setAttribute('d', d);
    len = path.getTotalLength();
    path.style.strokeDasharray = len.toFixed(2);
    apply();
  }
  build();
  if (window.__fx.RM) { ScrollTrigger.addEventListener('refresh', build); return; }
  gsap.to(o, { v: 1, ease: 'none', onUpdate: apply, scrollTrigger: { trigger: sec, start: 'top 60%', end: 'bottom 75%', scrub: 0.6, onRefresh: build } });
})();`,
};
export default c;
