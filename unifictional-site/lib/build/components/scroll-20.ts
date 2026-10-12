// @ts-nocheck
// scroll-20 · Squash-stretch wordmark loop: a photo and the brand word take turns filling the screen, each
// block squashed to exactly the part of the screen it occupies as it enters and leaves (Awwwards Pack, video only).
// The demo loops forever with Lenis infinite; here the cycle runs twice on a pinned stage so it sits inside a page.
import type { Component } from "./_types";

const c: Component = {
  id: "scroll-20",
  type: "loop-wordmark-20",
  kind: "section",
  weight: "light",
  describe: "(recreated from the preview video) loop-wordmark-20 (scroll-20): a pinned brand moment. A 3:2 photo sits centred on the page background; as you scroll the brand word, set exactly as wide as the screen in the display face, rises from the bottom edge squashed to a thin band and stretches taller as it takes over the screen while the photo shrinks toward the top edge; the word then squashes against the top as the photo grows back from below, and the cycle repeats once more before the page moves on. A tagline sits under the word. Needs one photo, a word of 3-10 letters (defaults to the brand name) and a short tagline. A punchy brand beat between sections for studios, makers, venues. Phones show the photo, then the word and tagline.",
  fields: `{"type":"loop-wordmark-20","component":"scroll-20","word":"","tagline":"","cta":{"label":"","href":"work"},"image":{"query":"","alt":""}}`,
  images: { min: 1, max: 1 },
  css: ({ pair }) => `
.lw{height:100svh;overflow:hidden;background:var(--bg)}
.lw__pin{position:relative;height:100svh;overflow:hidden;background:var(--bg)}
.lw__half{position:absolute;left:0;right:0;overflow:hidden}
.lw__half--top{top:0;height:100%}
.lw__half--bot{bottom:0;height:0}
.lw__block{position:absolute;left:0;width:100%;height:100svh;display:none;will-change:transform}
.lw__half--top .lw__block{bottom:0;transform-origin:50% 100%}
.lw__half--bot .lw__block{top:0;transform-origin:50% 0%}
.lw__block.is-on{display:flex}
.lw__img{align-items:center;justify-content:center}
.lw__img img{width:min(60vw,120svh);aspect-ratio:3/2;object-fit:cover}
.lw__word{flex-direction:column;align-items:center;justify-content:space-between;padding:3svh 0 3svh}
.lw__mark{display:block;width:100%;height:78svh;fill:var(--ink);font-family:var(--display);font-weight:${pair.weight}}
.lw__word .mono{text-align:center;padding:0 var(--gutter)}
.lw__word .btn{margin-top:1rem}
.lw__tail{display:grid;gap:1rem;justify-items:center}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .lw{height:auto}
  .lw__pin{height:auto}
  .lw__half{position:static;height:auto!important}
  .lw__half--bot{display:none}
  .lw__block{position:static;display:flex!important;height:auto;transform:none!important}
  .lw__img{padding:3rem var(--gutter) 2rem}
  .lw__img img{width:100%}
  .lw__word{gap:1.5rem;padding:0 var(--gutter) 3rem}
  .lw__mark{height:auto;aspect-ratio:var(--ar)}
}`,
  html: (s, { spec, esc, imgUrl, link, arrow }) => {
    const word = String(s.word || spec.brand.name).toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 12) || "WORK";
    const tagline = s.tagline || spec.brand.tagline || "";
    const n = word.length;
    const fs = Math.round(1000 / (0.62 * n));
    const vh = Math.round(fs * 0.78);
    const svg = `<svg class="lw__mark" viewBox="0 0 1000 ${vh}" preserveAspectRatio="none" aria-hidden="true"><text x="500" y="${Math.round(fs * 0.76)}" text-anchor="middle" textLength="1000" lengthAdjust="spacingAndGlyphs" font-size="${fs}">${esc(word)}</text></svg>`;
    const im = s.image || {};
    const block = (kind) => kind === "img"
      ? `<div class="lw__block lw__img"><img src="${esc(imgUrl(im, 1600))}" alt="${esc(im.alt || "")}" loading="lazy"></div>`
      : `<div class="lw__block lw__word" style="--ar:1000/${vh}">${svg}<div class="lw__tail">${tagline ? `<div class="mono">${esc(tagline)}</div>` : ""}${s.cta ? `<a class="btn btn-ghost" href="${esc(link(s.cta.href))}">${esc(s.cta.label)}${arrow}</a>` : ""}</div></div>`;
    return `
<section class="lw" data-fx="loop-wordmark-20" aria-label="${esc(word)}">
  <div class="lw__pin">
    <div class="lw__half lw__half--top">${block("img")}${block("word")}</div>
    <div class="lw__half lw__half--bot" aria-hidden="true">${block("img")}${block("word")}</div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="loop-wordmark-20"]');
  if (!sec) return;
  var top = sec.querySelector('.lw__half--top'), bot = sec.querySelector('.lw__half--bot');
  var tImg = top.querySelector('.lw__img'), tWord = top.querySelector('.lw__word'), bImg = bot.querySelector('.lw__img'), bWord = bot.querySelector('.lw__word');
  if (!window.__fx.FX) { tImg.classList.add('is-on'); tWord.classList.add('is-on'); return; }
  var CYCLES = 4; // img > word > img > word > img
  function render(p){
    var k = Math.min(Math.floor(p), CYCLES - 1), f = Math.max(0, Math.min(1, p - k));
    var topImg = k % 2 === 0;
    tImg.classList.toggle('is-on', topImg); tWord.classList.toggle('is-on', !topImg);
    bImg.classList.toggle('is-on', !topImg); bWord.classList.toggle('is-on', topImg);
    top.style.height = ((1 - f) * 100).toFixed(3) + '%';
    bot.style.height = (f * 100).toFixed(3) + '%';
    var tEl = topImg ? tImg : tWord, bEl = topImg ? bWord : bImg;
    tEl.style.transform = topImg ? 'scale(' + (1 - f).toFixed(4) + ')' : 'scaleY(' + (1 - f).toFixed(4) + ')';
    bEl.style.transform = topImg ? 'scaleY(' + f.toFixed(4) + ')' : 'scale(' + f.toFixed(4) + ')';
  }
  render(0);
  ScrollTrigger.create({ trigger: sec, start: 'top top', end: '+=' + (CYCLES * 90) + '%', pin: sec.querySelector('.lw__pin'), pinSpacing: true, scrub: 0.5,
    onUpdate: function(self){ render(self.progress * CYCLES); } });
  sec.style.height = 'auto';
})();`,
};
export default c;
