// @ts-nocheck
// scroll-25 · Background shift with blend inversion: five horizontal bands fill with the inverted page colour
// as the second statement scrolls in, and the text flips through an exclusion blend (Awwwards Pack).
// The demo drives Locomotive Scroll on the whole page; here the bands are a sticky layer inside the section.
import type { Component } from "./_types";

const c: Component = {
  id: "scroll-25",
  type: "shift-invert-25",
  kind: "section",
  weight: "light",
  describe: "shift-invert-25 (scroll-25): a chapter of 2-4 big statements, each a small label over 10-25 words set large, on the page background. As the second statement scrolls in, five horizontal bands fill from below one after another with the opposite colour (dark on a light site, light on a dark site) until the whole screen has flipped, and the text inverts with it, dark to light; the bands stay as a backdrop for the rest of the chapter and scrolling back undoes the flip. No images. A mood change into a manifesto, values or 'why us' passage for any business; reads as a plain stack of statements on phones.",
  fields: `{"type":"shift-invert-25","component":"scroll-25","items":[{"label":"","text":""},{"label":"","text":""},{"label":"","text":""}]}`,
  css: () => `
.shx{position:relative;isolation:isolate;background:var(--bg)}
.shx__bg{position:sticky;top:0;height:100svh;display:grid;grid-auto-rows:1fr;background:var(--bg);z-index:0}
.shx__band{position:relative;overflow:hidden;margin-top:-.5px}
.shx__band i{display:block;height:101%;background:var(--inv-bg);transform:translate3d(0,101%,0);will-change:transform}
.shx__content{position:relative;z-index:1;margin-top:-100svh;mix-blend-mode:exclusion;color:#fff;padding:0 var(--gutter)}
.shx__block{min-height:80svh;display:grid;align-content:center;gap:1.4rem;padding:4rem 0;max-width:62rem}
.shx__block:nth-child(even){margin-left:auto;text-align:right;justify-items:end}
.shx__label{color:rgba(255,255,255,.62)}
.shx__text{font-size:clamp(1.9rem,4.6vw,4.8rem);max-width:22ch;color:#fff}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .shx__bg{display:none}
  .shx__content{margin-top:0;mix-blend-mode:normal;color:var(--ink);padding:3rem var(--gutter)}
  .shx__block{min-height:0;padding:2.5rem 0}
  .shx__block:nth-child(even){margin-left:0;text-align:left;justify-items:start}
  .shx__label{color:var(--ink2)}
  .shx__text{color:var(--ink)}
}`,
  html: (s, { esc }) => {
    const items = (s.items || []).slice(0, 4);
    return `
<section class="shx" data-fx="shift-invert-25">
  <div class="shx__bg" aria-hidden="true">${"<div class=\"shx__band\"><i></i></div>".repeat(5)}</div>
  <div class="shx__content">
    ${items.map(it => `<article class="shx__block">${it.label ? `<div class="shx__label mono">${esc(it.label)}</div>` : ""}<p class="shx__text display">${esc(it.text)}</p></article>`).join("")}
  </div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="shift-invert-25"]');
  if (!sec || !window.__fx.FX) return;
  var bands = sec.querySelectorAll('.shx__band i'), blocks = sec.querySelectorAll('.shx__block');
  var trig = blocks[1] || blocks[0];
  // The CSS transform parks the bands before JS runs; GSAP must own the transform from here on.
  bands.forEach(function(b){ b.style.transform = 'none'; });
  gsap.fromTo(bands, { yPercent: 101 }, { yPercent: 0, ease: 'none', stagger: 0.08,
    scrollTrigger: { trigger: trig, start: 'top bottom', end: 'top 40%', scrub: true } });
})();`,
};
export default c;
