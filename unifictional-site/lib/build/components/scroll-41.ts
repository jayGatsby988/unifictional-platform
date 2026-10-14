// @ts-nocheck
// scroll-41 · Split word hero with expanding image window (Awwwards Pack).
import type { Component } from "./_types";

const c: Component = {
  id: "scroll-41",
  type: "hero-split",
  kind: "hero",
  weight: "light",
  describe: "hero-split (scroll-41): one brand WORD in huge capitals (4-10 letters, no spaces) splits apart as you scroll while a small rotated photo window turns upright and opens to full bleed; then headline, sub and button sit over the photo. Best for trades, hospitality, anything with one strong wide photo.",
  fields: `{"type":"hero-split","component":"scroll-41","word":"BUILT","headline":"","sub":"","cta":{"label":"","href":"contact"},"image":{"query":"","alt":""}}`,
  images: { min: 1, max: 1 },
  css: ({ t, pair, capsRule }) => `
.hero-split{height:100svh;position:relative;overflow:hidden}
.hero-split__pin{position:relative;height:100svh}
.hero-split__word{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:3;pointer-events:none;mix-blend-mode:${t.dark ? "difference" : "normal"}}
.hero-split__word .letters{display:flex;font-family:var(--display);font-weight:${pair.weight};font-size:clamp(4rem,var(--word-vw,19vw),22rem);line-height:1;letter-spacing:${pair.track};text-transform:uppercase;color:${t.dark ? "#fff" : "var(--ink)"}}
.hero-split__img{position:absolute;inset:0;z-index:1;clip-path:polygon(37.5% 22%,62.5% 22%,62.5% 78%,37.5% 78%);transform:rotate(14deg) scale(.9)}
.hero-split__img img{width:100%;height:100%;object-fit:cover;transform:scale(1.6)}
.hero-split__img::after{content:"";position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.65),rgba(0,0,0,.05) 50%)}
.hero-split__copy{position:absolute;left:var(--gutter);right:var(--gutter);bottom:clamp(2rem,6vh,4rem);z-index:4;display:grid;gap:1.2rem;max-width:42rem;opacity:0;transform:translateY(20px);color:#fff}
.hero-split__copy h1{font-size:clamp(1.8rem,3.6vw,3.2rem);line-height:1.05;font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}}
.hero-split__copy p{max-width:40ch;color:rgba(255,255,255,.75);font-size:1.05rem}
.hero-split__scroll{position:absolute;right:var(--gutter);bottom:2rem;z-index:4;font-family:var(--mono);font-size:.65rem;letter-spacing:.2em;text-transform:uppercase;color:var(--ink2);display:flex;align-items:center;gap:.8rem}
.hero-split__scroll i{width:1px;height:48px;background:currentColor;opacity:.5;display:block}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .hero-split{height:auto;min-height:100svh}
  .hero-split__pin{height:auto;min-height:100svh;display:grid;align-content:end;padding:7rem var(--gutter) 3rem}
  .hero-split__word{position:relative;inset:auto;justify-content:flex-start;mix-blend-mode:normal;margin-bottom:1.5rem}
  .hero-split__word .letters{font-size:clamp(3rem,15vw,8rem);color:var(--ink)}
  .hero-split__img{position:absolute;inset:0;clip-path:none;transform:none;z-index:0;opacity:.55}
  .hero-split__img img{transform:none}
  .hero-split__copy{position:relative;inset:auto;opacity:1;transform:none;color:var(--ink)}
  .hero-split__copy p{color:var(--ink2)}
  .hero-split__scroll{display:none}
}`,
  html: (s, { spec, esc, imgUrl, link, arrow }) => {
    const word = String(s.word || spec.brand.name).toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 12) || "STUDIO";
    // a two-word name splits at the space; otherwise down the middle
    const half = word.includes(" ") ? word.indexOf(" ") : Math.ceil(word.length / 2);
    const letters = (str) => str.split("").filter(ch => ch !== " ").map(ch => `<div>${ch}</div>`).join("");
    const L = letters(word.slice(0, half));
    const Rr = letters(word.slice(half));
    return `
<section class="hero-split" id="top" data-fx="hero-split">
  <div class="hero-split__pin">
    <div class="hero-split__img"><img src="${esc(imgUrl(s.image, 2000))}" alt="${esc(s.image?.alt || "")}" fetchpriority="high"></div>
    <div class="hero-split__word" style="--word-vw:${Math.min(19, Math.floor(148 / Math.max(4, word.replace(/ /g, "").length)))}vw"><div class="letters">${L}</div><div class="letters">${Rr}</div></div>
    <div class="hero-split__copy">
      <h1>${esc(s.headline)}</h1>
      <p>${esc(s.sub)}</p>
      ${s.cta ? `<div><a class="btn btn-primary" href="${esc(link(s.cta.href))}">${esc(s.cta.label)}${arrow}</a></div>` : ""}
    </div>
    <div class="hero-split__scroll"><span>Scroll</span><i></i></div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var FX = window.__fx.FX;
  var hs = document.querySelector('[data-fx="hero-split"]');
  if (!hs) return;
  if (FX) {
    var letters = hs.querySelectorAll('.letters'), img = hs.querySelector('.hero-split__img'), copy = hs.querySelector('.hero-split__copy');
    gsap.timeline({ scrollTrigger: { trigger: hs, start: 'top top', end: '+=180%', scrub: 1, pin: hs.querySelector('.hero-split__pin'), pinSpacing: true }, defaults: { ease: 'power2.inOut' } })
      .to(letters[0], { xPercent: -220, scale: 6 }, 0)
      .to(letters[1], { xPercent: 220, scale: 6 }, 0)
      .to(img, { rotation: 0, scale: 1, clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)' }, 0)
      .to(img.querySelector('img'), { scale: 1 }, 0)
      .to(copy, { opacity: 1, y: 0, duration: 0.3 }, 0.55);
    hs.style.height = 'auto';
  } else {
    gsap.set(hs.querySelector('.hero-split__copy'), { opacity: 1, y: 0 });
  }
})();`,
};
export default c;
