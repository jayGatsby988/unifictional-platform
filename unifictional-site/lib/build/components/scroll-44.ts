// @ts-nocheck
// scroll-44 · Cards stacked at the centre of a pinned panel spread into a tilted fan, then flip one by one to their text backs (Awwwards Pack).
import type { Component } from "./_types";

function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}

const c: Component = {
  id: "scroll-44",
  type: "fan-flip-44",
  kind: "section",
  weight: "light",
  describe: "fan-flip-44 (scroll-44): a full-screen panel in the inverse colour pins with 3-6 photo cards (2:3, rounded) piled at its centre, gently bobbing, under a small label. As you scroll the pile spreads into a row fanned like a hand of cards, the outer ones tilted up to 15 degrees; scrolling on, the cards turn over one after another, straightening as they flip, to show paper backs carrying a number, a 2-4 word title and 10-25 words of text. Needs 3-6 items with a photo, title and text each. For services, packages, pricing tiers or steps; on phones it is a plain column of photo cards with their text underneath.",
  fields: `{"type":"fan-flip-44","component":"scroll-44","label":"","items":[{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""}]}`,
  images: { min: 3, max: 6 },
  css: ({ pair, capsRule }) => `
.fan{height:400svh;background:var(--inv-bg);color:var(--inv-ink)}
.fan__stage{position:sticky;top:0;height:100svh;overflow:hidden}
.fan__label{position:absolute;top:clamp(5rem,12vh,7rem);left:0;right:0;text-align:center;color:var(--inv-ink);opacity:.6}
.fan__card{position:absolute;top:50%;left:50%;width:clamp(11rem,17vw,19rem);aspect-ratio:2/3;transform:translate(-50%,-50%);perspective:1000px;will-change:transform,left}
.fan__bob{position:absolute;inset:0;animation:fanbob 3s ease-in-out infinite}
.fan__card:nth-child(2) .fan__bob{animation-delay:.2s}.fan__card:nth-child(3) .fan__bob{animation-delay:.4s}.fan__card:nth-child(4) .fan__bob{animation-delay:.6s}.fan__card:nth-child(5) .fan__bob{animation-delay:.8s}.fan__card:nth-child(6) .fan__bob{animation-delay:1s}
.fan__inner{position:absolute;inset:0;transform-style:preserve-3d;will-change:transform}
.fan__face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;border-radius:14px;overflow:hidden;box-shadow:0 24px 50px rgba(0,0,0,.3)}
.fan__front{background:var(--bg2)}
.fan__front img{width:100%;height:100%;object-fit:cover}
.fan__back{transform:rotateY(180deg);background:var(--bg2);color:var(--ink);padding:clamp(.9rem,1.4vw,1.4rem);display:flex;flex-direction:column;justify-content:flex-end;gap:.5em}
.fan__back .mono{position:absolute;top:1.2em;left:1.4em;font-size:.68rem}
.fan__back h3{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}font-size:clamp(1.1rem,1.7vw,1.7rem);line-height:1}
.fan__back p{font-size:clamp(.72rem,.9vw,.9rem);line-height:1.4;color:var(--ink2);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:6;overflow:hidden}
@keyframes fanbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6%)}}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .fan{height:auto}
  .fan__stage{position:static;height:auto;overflow:visible;padding:4rem var(--gutter);display:grid;gap:1.5rem}
  .fan__label{position:static;margin-bottom:.5rem}
  .fan__card{position:static;width:100%;max-width:24rem;aspect-ratio:auto;transform:none!important;perspective:none;justify-self:center}
  .fan__bob{position:static;animation:none}
  .fan__inner{position:static;transform:none!important;transform-style:flat;display:grid;gap:.8rem}
  .fan__face{position:static;transform:none!important;backface-visibility:visible;-webkit-backface-visibility:visible;box-shadow:none}
  .fan__front{aspect-ratio:3/2}
  .fan__back{padding:1rem 0 0;background:none;color:var(--inv-ink)}
  .fan__back .mono{position:static;margin-bottom:.3rem;color:inherit;opacity:.6}
  .fan__back h3{font-size:1.4rem}
  .fan__back p{color:inherit;opacity:.75;font-size:.95rem;-webkit-line-clamp:unset}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, 6);
    const card = (it, i) => {
      const p = pic(it, s, i);
      return `<div class="fan__card"><div class="fan__bob"><div class="fan__inner"><div class="fan__face fan__front">${p ? `<img src="${esc(imgUrl(p, 800))}" alt="${esc(it.alt || p.alt || it.title || "")}" loading="lazy">` : ""}</div><div class="fan__face fan__back"><span class="mono">( 0${i + 1} )</span><h3>${esc(it.title || "")}</h3><p>${esc(it.text || "")}</p></div></div></div></div>`;
    };
    return `
<section class="fan" data-fx="fan-flip-44">
  <div class="fan__stage">
    ${s.label ? `<div class="mono fan__label">${esc(s.label)}</div>` : ""}
    ${items.map(card).join("")}
  </div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="fan-flip-44"]');
  if (!sec || !window.__fx.FX) return;
  var cards = Array.prototype.slice.call(sec.querySelectorAll('.fan__card'));
  var n = cards.length; if (n < 2) return;
  var span = n > 4 ? 76 : 72, lefts = cards.map(function(_, i){ return 50 - span / 2 + i * span / (n - 1); });
  var rots = cards.map(function(_, i){ return -15 + i * 30 / (n - 1); });
  var tl = gsap.timeline({ scrollTrigger: { trigger: sec, start: 'top top', end: 'bottom bottom', scrub: 0.6 } });
  cards.forEach(function(card, i){
    tl.to(card, { left: lefts[i] + '%', rotation: rots[i], duration: 0.3, ease: 'none' }, 0);
    var t0 = 0.36 + i * (0.3 / n);
    tl.to(card.querySelector('.fan__inner'), { rotationY: 180, duration: 0.3, ease: 'power2.inOut' }, t0)
      .to(card, { rotation: 0, duration: 0.3, ease: 'power2.inOut' }, t0);
  });
  tl.set({}, {}, 1);
})();`,
};
export default c;
