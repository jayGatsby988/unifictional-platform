// @ts-nocheck
// scroll-15 · A sentence crosses the pinned screen, letters tumbling into place (Awwwards Pack).
import type { Component } from "./_types";

const c: Component = {
  id: "scroll-15",
  type: "sentence",
  kind: "section",
  weight: "light",
  describe: "sentence (scroll-15): a pinned screen where one 4-8 word line in huge display type travels across from right to left, each letter tumbling into place as it enters. A closing line with rhythm, in the brand's voice.",
  fields: `{"type":"sentence","component":"scroll-15","text":""}`,
  css: ({ pair, capsRule }) => `
.sentence{height:100svh;overflow:hidden;display:flex;align-items:center}
.sentence__text{display:flex;width:max-content;white-space:nowrap;gap:3vw;padding-left:100vw;font-family:var(--display);font-weight:${pair.weight};${capsRule}font-size:clamp(3rem,11vw,13rem);letter-spacing:${pair.track};line-height:1}
.sentence__text .char{display:inline-block}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .sentence{height:auto;padding:4rem var(--gutter)}
  .sentence__text{white-space:normal;width:auto;padding:0;flex-wrap:wrap;font-size:clamp(2.4rem,11vw,6rem)}
}`,
  html: (s, { esc }) => `<section class="sentence" data-fx="sentence"><h2 class="sentence__text">${esc(s.text)}</h2></section>`,
  js: () => `
(function(){
  var sen = document.querySelector('[data-fx="sentence"]');
  if (!sen || !window.__fx.FX || !window.SplitText) return;
  var text = sen.querySelector('.sentence__text');
  var split = SplitText.create(text, { type: 'chars, words' });
  var dist = text.scrollWidth;
  var tween = gsap.to(text, { xPercent: -100, ease: 'none', scrollTrigger: { trigger: sen, pin: true, end: '+=' + Math.round(dist * 1.1) + 'px', scrub: true } });
  split.chars.forEach(function(ch){ gsap.from(ch, { yPercent: 'random(-160, 160)', rotation: 'random(-18, 18)', ease: 'back.out(1.2)', scrollTrigger: { trigger: ch, containerAnimation: tween, start: 'left 100%', end: 'left 35%', scrub: 1 } }); });
})();`,
};
export default c;
