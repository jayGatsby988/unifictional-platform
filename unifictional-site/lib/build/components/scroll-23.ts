// @ts-nocheck
// scroll-23 · A huge headline echoes stacked copies of itself above and below as it scrolls past (Awwwards Pack).
import type { Component } from "./_types";

const COPIES = 8;

const c: Component = {
  id: "scroll-23",
  type: "headline-echo",
  kind: "section",
  weight: "light",
  describe: "headline-echo (scroll-23): a 2-6 word headline set huge on a flat band of page background. As it travels through the viewport, eight copies of it slide out from behind it, four upward and four downward in 12% steps, so slivers of the words stack above and below it like an echo; it follows the scroll exactly and gathers back in when you scroll up. Optional small label above. Light, no pinning: a chapter divider or one-line brand statement between heavier sections. Static text on phones.",
  fields: `{"type":"headline-echo","component":"scroll-23","label":"","text":""}`,
  css: () => `
.echo{padding:clamp(4rem,12vh,9rem) var(--gutter);text-align:center;overflow:hidden;background:var(--bg)}
.echo .label{margin-bottom:2rem}
.echo__title{display:grid;justify-items:center;font-size:clamp(2.6rem,9.5vw,11rem);line-height:.88;padding:.5em 0;cursor:default;user-select:none;-webkit-user-select:none}
.echo__title span{grid-area:1/1/2/2;background:var(--bg);line-height:.88;padding:.02em .08em;will-change:transform}
.echo__copy{color:var(--ink2)}
.echo__main{color:var(--ink)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .echo__copy{display:none}
  .echo__title{padding:0;font-size:clamp(2.4rem,11vw,5rem)}
  .echo__title span{transform:none!important}
}`,
  html: (s, { esc }) => {
    const text = esc(s.text);
    const copies = Array.from({ length: COPIES }, () => `<span class="echo__copy" aria-hidden="true">${text}</span>`).join("");
    return `<section class="echo" data-fx="headline-echo">${s.label ? `<div class="mono label">${esc(s.label)}</div>` : ""}<h2 class="echo__title display">${copies}<span class="echo__main">${text}</span></h2></section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="headline-echo"]');
  if (!sec || !window.__fx.FX) return;
  var title = sec.querySelector('.echo__title');
  var copies = title.querySelectorAll('.echo__copy');
  var n = copies.length, half = n / 2, inc = 12, dinc = 0.1;
  var tl = gsap.timeline({ scrollTrigger: { trigger: title, start: 'top bottom', end: 'bottom top', scrub: true } });
  copies.forEach(function(sp, i){
    var j = i < half ? i : i - half;
    var ty = (half - j) * inc * (i < half ? 1 : -1);
    tl.to(sp, { yPercent: ty, duration: 1, ease: 'power1' }, dinc * (half - j) - dinc);
  });
})();`,
};
export default c;
