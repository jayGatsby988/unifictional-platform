// @ts-nocheck
// scroll-56 · A headline covered word by word with coloured blocks that drop away, tumbling, when it scrolls into view (Awwwards Pack; lifted from a React demo).
import type { Component } from "./_types";

const c: Component = {
  id: "scroll-56",
  type: "falling-words",
  kind: "section",
  weight: "light",
  describe: "falling-words (scroll-56): a centred statement of 6-14 words set large (up to three lines), with an optional small label above. On arrival every word is hidden under a rounded block in the accent colour, sized to the word; as the statement reaches the lower part of the screen the blocks drop one after another, accelerating, each drifting sideways and spinning as it falls out of the bottom of the band, and the words are left standing. Plays once. Text only, no image. A manifesto line, a promise or a value statement between heavier sections for any business; on phones the text simply shows.",
  fields: `{"type":"falling-words","component":"scroll-56","label":"","headline":""}`,
  css: ({ pair }) => `
.fall{padding:clamp(5rem,14vh,10rem) var(--gutter);overflow:clip;text-align:center;background:var(--bg)}
.fall .label{margin-bottom:2rem}
.fall__h{font-size:clamp(2.2rem,5.6vw,5.6rem);line-height:1.02;max-width:22ch;margin:0 auto}
.fall__w{position:relative;display:inline-block;white-space:nowrap}
.fall__b{position:absolute;left:-5%;top:6%;width:110%;height:88%;background:var(--accent);border-radius:.5vw;z-index:2;pointer-events:none;will-change:transform}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .fall__b{display:none}
  .fall__h{font-size:clamp(2rem,9vw,3.4rem)}
}`,
  html: (s, { esc }) => {
    const words = String(s.headline || s.text || "").trim().split(/\s+/).filter(Boolean).slice(0, 24);
    return `
<section class="fall" data-fx="falling-words">
  ${s.label ? `<div class="mono label">${esc(s.label)}</div>` : ""}
  <h2 class="fall__h display">${words.map(w => `<span class="fall__w">${esc(w)}<i class="fall__b" aria-hidden="true"></i></span>`).join(" ")}</h2>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="falling-words"]');
  if (!sec || !window.__fx.FX) return;
  var boxes = sec.querySelectorAll('.fall__b');
  if (!boxes.length) return;
  gsap.timeline({ scrollTrigger: { trigger: sec, start: 'top 75%', once: true }, onComplete: function(){ gsap.set(boxes, { display: 'none' }); } })
    .to(boxes, { y: function(){ return window.innerHeight * 1.1 + gsap.utils.random(0, 300); }, x: function(){ return gsap.utils.random(-150, 150); }, rotation: function(){ return gsap.utils.random(-360, 360); }, duration: 1, ease: 'power2.in', stagger: 0.03 });
})();`,
};
export default c;
