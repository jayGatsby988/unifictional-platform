// @ts-nocheck
// scroll-38 · One pinned card flips over to reveal a fanned stack behind it; each card then lifts off the top (Awwwards Pack, recreated from the preview video).
import type { Component } from "./_types";

function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}
const SKINS = ["accent", "paper", "ink", "accent", "paper"];

const c: Component = {
  id: "scroll-38",
  type: "stack-flip-38",
  kind: "section",
  weight: "light",
  describe: "(recreated from the preview video) stack-flip-38 (scroll-38): a 4-10 word headline sits at the top of a pinned screen; under it one tall rounded card (about a quarter of the screen wide, 4:5) in the accent colour, carrying a number, a title, a round photo badge and one sentence. As you scroll the card flips around its vertical axis with perspective and comes out as a fanned stack of the remaining cards, each tilted a few degrees and in alternating skins (paper, inverse, accent). Scrolling on, the top card lifts off and leaves through the top edge, rotating 15-30 degrees, then the next, until the last card is left holding the centre and the page moves on. Needs 3-5 items (title 2-4 words, 10-25 words of text, one photo each). For a process in steps, three to five services, or 'how we work' moments; on phones it is the headline and the cards stacked in a column.",
  fields: `{"type":"stack-flip-38","component":"scroll-38","headline":"","items":[{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""}]}`,
  images: { min: 3, max: 5 },
  css: ({ pair, capsRule }) => `
.sflip{--n:4;height:calc((var(--n) + 2) * 100svh)}
.sflip__stage{position:sticky;top:0;height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:clamp(1.5rem,4vh,3rem);padding:6rem var(--gutter) 2rem;overflow:hidden}
.sflip__title{text-align:center;font-size:clamp(1.8rem,3.6vw,3.4rem);max-width:22ch;will-change:transform,opacity}
.sflip__scene{position:relative;width:clamp(15rem,24vw,22rem);aspect-ratio:4/5;perspective:1400px;flex-shrink:1;max-height:62svh}
.sflip__flipper{position:absolute;inset:0;transform-style:preserve-3d;will-change:transform}
.sflip__front,.sflip__back{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden}
.sflip__back{transform:rotateY(180deg)}
.sflip__card{position:absolute;inset:0;border-radius:18px;padding:clamp(1rem,1.6vw,1.6rem);display:flex;flex-direction:column;align-items:center;justify-content:space-between;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.18);will-change:transform;transform-origin:50% 60%}
.sflip__card.is-accent{background:var(--accent);color:var(--on-accent)}
.sflip__card.is-paper{background:var(--bg2);color:var(--ink);border:1px solid var(--line)}
.sflip__card.is-ink{background:var(--inv-bg);color:var(--inv-ink)}
.sflip__card h3{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}font-size:clamp(1.2rem,2vw,1.9rem);line-height:1;margin-top:.6em}
.sflip__card .mono{color:inherit;opacity:.6}
.sflip__badge{width:38%;aspect-ratio:1;border-radius:50%;overflow:hidden;border:3px solid rgba(255,255,255,.65)}
.sflip__badge img{width:100%;height:100%;object-fit:cover}
.sflip__card p{font-size:clamp(.72rem,.9vw,.92rem);line-height:1.4;opacity:.85;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;overflow:hidden}
.sflip__back .sflip__card{transform:rotate(var(--tilt))}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .sflip{height:auto}
  .sflip__stage{position:static;height:auto;padding:4rem var(--gutter);gap:2rem;overflow:visible}
  .sflip__scene{width:100%;max-width:26rem;aspect-ratio:auto;max-height:none;perspective:none}
  .sflip__flipper{position:static;transform:none!important;transform-style:flat}
  .sflip__front,.sflip__back{position:static;transform:none!important;backface-visibility:visible;-webkit-backface-visibility:visible;display:grid;gap:1rem}
  .sflip__card{position:relative;inset:auto;transform:none!important;aspect-ratio:4/5;max-height:28rem;box-shadow:none}
  .sflip__card h3{font-size:1.4rem}
  .sflip__card p{font-size:.95rem;-webkit-line-clamp:unset}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, 5);
    const card = (it, i, tilt) => {
      const p = pic(it, s, i);
      return `<div class="sflip__card is-${SKINS[i % SKINS.length]}" style="--tilt:${tilt}deg"><span class="mono">( 0${i + 1} )</span><h3>${esc(it.title || "")}</h3><div class="sflip__badge">${p ? `<img src="${esc(imgUrl(p, 600))}" alt="${esc(it.alt || p.alt || it.title || "")}" loading="lazy">` : ""}</div><p>${esc(it.text || "")}</p></div>`;
    };
    const rest = items.slice(1);
    // Back of the flipper: the last card at the bottom of the pile, the second card on top.
    const stack = rest.map((it, k) => card(it, k + 1, [4, -5, 3, -3][k % 4])).reverse().join("");
    return `
<section class="sflip" data-fx="stack-flip-38" style="--n:${items.length}">
  <div class="sflip__stage">
    <h2 class="sflip__title display">${esc(s.headline || "")}</h2>
    <div class="sflip__scene">
      <div class="sflip__flipper">
        <div class="sflip__front">${items[0] ? card(items[0], 0, 0) : ""}</div>
        <div class="sflip__back">${stack}</div>
      </div>
    </div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="stack-flip-38"]');
  if (!sec || !window.__fx.FX) return;
  var flipper = sec.querySelector('.sflip__flipper'), title = sec.querySelector('.sflip__title');
  var back = Array.prototype.slice.call(sec.querySelectorAll('.sflip__back .sflip__card')).reverse(); // top of pile first
  if (!back.length) return;
  var n = back.length, seg = 1 / (n + 1.6);
  var tl = gsap.timeline({ scrollTrigger: { trigger: sec, start: 'top top', end: 'bottom bottom', scrub: 0.6 } });
  tl.to(flipper, { rotationY: 180, duration: seg * 1.1, ease: 'back.out(1.2)' }, seg * 0.3)
    .to(title, { yPercent: -40, opacity: 0, duration: seg * 0.8, ease: 'power2.in' }, seg * 0.6);
  back.forEach(function(card, i){
    if (i === n - 1) return; // the last card stays
    var dir = i % 2 ? 1 : -1;
    tl.to(card, { yPercent: -260, rotation: dir * (18 + i * 4), duration: seg, ease: 'power2.in' }, seg * (1.6 + i));
  });
  tl.set({}, {}, 1);
})();`,
};
export default c;
