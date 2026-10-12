// @ts-nocheck
// scroll-47 · Four image cards pile onto a headline, then part to its corners (Awwwards Pack).
import type { Component } from "./_types";

const c: Component = {
  id: "scroll-47",
  type: "pile",
  kind: "section",
  weight: "light",
  describe: "pile (scroll-47): a pinned screen with a 3-6 word headline in the middle; four photo cards slide up and pile onto it one after another, then part to the four corners as you keep scrolling. Needs exactly 4 photos. Good for 'the work' or 'the crew' moments.",
  fields: `{"type":"pile","component":"scroll-47","headline":"","images":[{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""}]}`,
  images: { min: 4, max: 4 },
  css: () => `
.pile{height:100svh;display:flex;align-items:center;justify-content:center;overflow:hidden}
.pile h2{position:relative;z-index:1;text-align:center;font-size:clamp(2rem,5.5vw,5.2rem);max-width:16ch;padding:0 var(--gutter)}
.pile__imgs{position:absolute;inset:0;pointer-events:none}
.pile__img{position:absolute;top:50%;left:50%;width:clamp(14rem,24vw,32rem);aspect-ratio:7/5;overflow:hidden;transform:translate(-50%,200%);will-change:transform;box-shadow:0 30px 60px rgba(0,0,0,.25)}
.pile__img img{width:100%;height:100%;object-fit:cover}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .pile{height:auto;padding:4rem 0;flex-direction:column;gap:2rem}
  .pile__imgs{position:relative;inset:auto;display:grid;grid-template-columns:1fr 1fr;gap:.6rem;padding:0 var(--gutter);width:100%}
  .pile__img{position:static;transform:none!important;width:100%;aspect-ratio:7/5;box-shadow:none}
}`,
  html: (s, { esc, imgUrl }) => {
    const imgs = (s.images || []).slice(0, 4);
    return `
<section class="pile" data-fx="pile">
  <h2 class="display">${esc(s.headline)}</h2>
  <div class="pile__imgs">${imgs.map(im => `<div class="pile__img"><img src="${esc(imgUrl(im, 1200))}" alt="${esc(im.alt || "")}" loading="lazy"></div>`).join("")}</div>
</section>`;
  },
  js: () => `
(function(){
  var pile = document.querySelector('[data-fx="pile"]');
  if (!pile || !window.__fx.FX) return;
  var pImgs = pile.querySelectorAll('.pile__img');
  var finals = [[-140,-140],[40,-130],[-160,40],[20,30]], rots = [5,-3,3.5,-1], p1s = [0,0.1,0.2,0.3], p2s = [0.5,0.55,0.6,0.65];
  ScrollTrigger.create({ trigger: pile, start: 'top top', end: '+=' + window.innerHeight * 4, pin: true, pinSpacing: true, scrub: 1, onUpdate: function(self){
    var p = self.progress;
    pImgs.forEach(function(im, i){
      var x = -50, y, r = rots[i];
      var a = p1s[i], b = Math.min(a + (0.45 - a) * 0.9, 0.45);
      if (p < a) y = 200; else if (p <= 0.45) { var lp = p >= b ? 1 : (p - a) / (b - a); var e = 1 - Math.pow(1 - lp, 3); y = 200 - e * 250; } else y = -50;
      var c = p2s[i], d = Math.min(c + (0.95 - c) * 0.9, 0.95);
      if (p >= c && p <= 0.95) { var lp2 = p >= d ? 1 : (p - c) / (d - c); var e2 = 1 - Math.pow(1 - lp2, 3); x = -50 + (finals[i][0] + 50) * e2; y = -50 + (finals[i][1] + 50) * e2; r = rots[i] * (1 - e2); }
      else if (p > 0.95) { x = finals[i][0]; y = finals[i][1]; r = 0; }
      gsap.set(im, { transform: 'translate(' + x + '%, ' + y + '%) rotate(' + r + 'deg)' });
    });
  }});
})();`,
};
export default c;
