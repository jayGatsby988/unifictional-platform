// @ts-nocheck
// scroll-40 · A panorama shrinks under a title, splits into three cards that flip and fan out (Awwwards Pack).
import type { Component } from "./_types";

const c: Component = {
  id: "scroll-40",
  type: "cards-flip",
  kind: "section",
  weight: "light",
  describe: "cards-flip (scroll-40): a pinned screen. One wide panoramic photo sits in the middle; as you scroll it narrows a little while a 4-8 word headline fades in above it, then it breaks into three tall rounded cards with gaps, and further on the cards flip over one after another, the outer two tilting outward, to show coloured backs (paper, accent, inverse) each carrying a number, a short title and one or two sentences. Needs one landscape photo and exactly 3 items (title 2-4 words, 12-30 words of text). For three services, pillars or values; on phones it is the photo followed by three stacked text cards.",
  fields: `{"type":"cards-flip","component":"scroll-40","headline":"","image":{"query":"","alt":""},"items":[{"title":"","text":""},{"title":"","text":""},{"title":"","text":""}]}`,
  images: { min: 1, max: 1 },
  css: ({ pair, capsRule }) => `
.cflip{height:500svh}
.cflip__stage{position:sticky;top:0;height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:clamp(2rem,5vh,4rem);padding:0 var(--gutter);overflow:hidden}
.cflip__title{text-align:center;font-size:clamp(2rem,4.5vw,4.2rem);max-width:18ch;opacity:0;transform:translateY(40px);will-change:transform,opacity}
.cflip__cards{--w:75;position:relative;display:flex;gap:0;width:min(calc(var(--w) * 1%),calc((100svh - 18rem) * 15 / 7));perspective:1200px;will-change:width}
.cflip__card{position:relative;flex:1;aspect-ratio:5/7;transform-style:preserve-3d;transform-origin:50% 0;border-radius:0;will-change:transform}
.cflip__card:first-child{border-radius:20px 0 0 20px}
.cflip__card:last-child{border-radius:0 20px 20px 0}
.cflip__face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;overflow:hidden;border-radius:inherit}
.cflip__front{background:var(--bg2)}
.cflip__front img{position:absolute;top:0;left:calc(var(--i) * -100%);width:300%;height:100%;max-width:none;object-fit:cover}
.cflip__back{transform:rotateY(180deg);display:flex;flex-direction:column;justify-content:flex-end;gap:.5em;padding:clamp(.8rem,1.6vw,1.8rem);font-size:clamp(.7rem,.95vw,.98rem)}
.cflip__back .mono{position:absolute;top:1.4em;left:1.6em;color:inherit;opacity:.55;font-size:.72em}
.cflip__back h3{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}font-size:clamp(1rem,2vw,2.1rem);line-height:1}
.cflip__back p{line-height:1.45;opacity:.82;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:6;overflow:hidden}
.cflip__card:nth-child(1) .cflip__back{background:var(--bg2);color:var(--ink)}
.cflip__card:nth-child(2) .cflip__back{background:var(--accent);color:var(--on-accent)}
.cflip__card:nth-child(3) .cflip__back{background:var(--inv-bg);color:var(--inv-ink)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .cflip{height:auto}
  .cflip__stage{position:static;height:auto;padding:4rem var(--gutter);gap:2rem;overflow:visible}
  .cflip__title{opacity:1;transform:none}
  .cflip__cards{width:100%;flex-direction:column;gap:1rem!important;perspective:none}
  .cflip__card{aspect-ratio:auto;transform:none!important;transform-style:flat;border-radius:14px!important}
  .cflip__face{position:relative;inset:auto;border-radius:14px!important;backface-visibility:visible;-webkit-backface-visibility:visible}
  .cflip__front{display:none}
  .cflip__card:first-child .cflip__front{display:block;aspect-ratio:16/10;margin-bottom:1rem}
  .cflip__front img{position:static;width:100%;height:100%}
  .cflip__back{transform:none;padding:1.4rem;font-size:1rem}
  .cflip__back .mono{position:static;margin-bottom:.4rem;font-size:.72rem}
  .cflip__back h3{font-size:1.5rem}
  .cflip__back p{-webkit-line-clamp:unset}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, 3);
    const src = esc(imgUrl(s.image, 2000));
    return `
<section class="cflip" data-fx="cards-flip">
  <div class="cflip__stage">
    <h2 class="cflip__title display">${esc(s.headline)}</h2>
    <div class="cflip__cards">
      ${items.map((it, i) => `<div class="cflip__card"><div class="cflip__face cflip__front"><img src="${src}" alt="${i === 0 ? esc(s.image?.alt || "") : ""}" loading="lazy" style="--i:${i}"></div><div class="cflip__face cflip__back"><span class="mono">( 0${i + 1} )</span><h3>${esc(it.title)}</h3><p>${esc(it.text)}</p></div></div>`).join("")}
    </div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="cards-flip"]');
  if (!sec || !window.__fx.FX) return;
  var title = sec.querySelector('.cflip__title'), wrap = sec.querySelector('.cflip__cards');
  var cards = Array.prototype.slice.call(wrap.querySelectorAll('.cflip__card'));
  if (cards.length < 3) return;
  var o = { w: 75 };
  gsap.set(cards[0], { borderRadius: '20px 0px 0px 20px' });
  gsap.set(cards[1], { borderRadius: '0px 0px 0px 0px' });
  gsap.set(cards[2], { borderRadius: '0px 20px 20px 0px' });
  var tl = gsap.timeline({ scrollTrigger: { trigger: sec, start: 'top top', end: 'bottom bottom', scrub: 1 } });
  tl.to(o, { w: 60, duration: 0.25, ease: 'none', onUpdate: function(){ wrap.style.setProperty('--w', o.w.toFixed(3)); } }, 0)
    .fromTo(title, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.15, ease: 'none' }, 0.1)
    .to(wrap, { gap: '20px', duration: 0.12, ease: 'power3.out' }, 0.35)
    .to(cards, { borderRadius: '20px 20px 20px 20px', duration: 0.12, ease: 'power3.out' }, 0.35)
    .to(cards, { rotationY: 180, duration: 0.25, ease: 'power3.inOut', stagger: 0.04 }, 0.62)
    .to(cards[0], { y: 30, rotationZ: -15, duration: 0.25, ease: 'power3.inOut' }, 0.62)
    .to(cards[2], { y: 30, rotationZ: 15, duration: 0.25, ease: 'power3.inOut' }, 0.62)
    .set({}, {}, 1);
})();`,
};
export default c;
