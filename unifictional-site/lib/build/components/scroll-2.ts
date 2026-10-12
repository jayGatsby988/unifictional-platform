// @ts-nocheck
// scroll-2 · Huge words act as windows onto photos: SVG text clip-paths that drift and build letter by letter on scroll (Awwwards Pack).
import type { Component } from "./_types";

// Item image: the resolver's {url} on it.image, else a parallel s.images entry, else a URL written in query.
function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}

const c: Component = {
  id: "scroll-2",
  type: "word-windows",
  kind: "section",
  weight: "light",
  describe: "word-windows (scroll-2): two to four statement WORDS (one word each, 3-10 letters) set so large they span the screen, each cut out of the page like a stencil with a photo showing through the letters. As a word travels up the screen it drifts sideways and its letters build in one after another: the first word's letters stretch up from the baseline while its photo zooms out, the second's unfold from a tilt while the window tips upright, the third's squeeze in from the right while the colour drains out of the photo, then the cycle repeats. Each word has an optional short caption (6-20 words) beside it. Needs one photo per word. A bold chapter divider or brand-statement band for trades, studios, restaurants and fashion; on phones the words sit static over their photos.",
  fields: `{"type":"word-windows","component":"scroll-2","label":"","items":[{"word":"","text":"","query":"","alt":""},{"word":"","text":"","query":"","alt":""},{"word":"","text":"","query":"","alt":""}]}`,
  images: { min: 2, max: 4 },
  css: ({ pair }) => `
.ww{padding:clamp(3rem,8vh,6rem) 0 clamp(2rem,6vh,4rem);overflow:hidden;background:var(--bg)}
.ww .label{padding:0 var(--gutter);margin-bottom:clamp(2rem,6vh,4rem)}
.ww__item{position:relative;margin:0 0 clamp(2rem,8vh,6rem)}
.ww__win{position:relative;height:calc(var(--fs) * 1.02);width:100%}
.ww__svg{position:absolute;inset:0;width:100%;height:100%;opacity:0;pointer-events:none;overflow:visible}
.ww__svg text{font-family:var(--display);font-weight:${pair.weight};font-size:var(--fs);text-transform:uppercase;letter-spacing:${pair.track};line-height:1}
.ww__poster{position:absolute;inset:0;overflow:hidden;will-change:transform,filter}
.ww__poster img{position:absolute;left:-10%;top:-10%;width:120%;height:120%;max-width:none;object-fit:cover;will-change:transform}
.ww__cap{display:flex;gap:1.5rem;align-items:baseline;padding:1.2rem var(--gutter) 0;color:var(--ink2);font-size:1rem;max-width:60ch}
.ww__cap .mono{flex-shrink:0;color:var(--ink3)}
.ww__item--r .ww__cap{margin-left:auto;justify-content:flex-end;text-align:right}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .ww__win{height:auto;aspect-ratio:3/2}
  .ww__svg{display:none}
  .ww__poster{clip-path:none!important;transform:none!important;filter:none!important}
  .ww__poster img{left:0;top:0;width:100%;height:100%;transform:none!important}
  .ww__poster::after{content:attr(data-word);position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:var(--display);font-weight:${pair.weight};font-size:clamp(3rem,16vw,6rem);text-transform:uppercase;letter-spacing:${pair.track};color:#fff;mix-blend-mode:difference;text-align:center}
  .ww__cap{flex-direction:column;gap:.4rem;padding-top:1rem}
  .ww__item--r .ww__cap{margin-left:0;text-align:left}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, 4);
    const uid = "ww" + Math.random().toString(36).slice(2, 7);
    const block = (it, i) => {
      const p = pic(it, s, i);
      const word = String(it.word || it.title || "").replace(/\s+/g, "").slice(0, 10) || "WORK";
      const id = `${uid}-${i}`;
      const letters = word.split("").map((ch, k) => `<text x="${k}ch" y="0.92em">${esc(ch)}</text>`).join("");
      // Size the word so it spans roughly 115% of the viewport (it drifts across), capped for short words.
      const fs = `min(27vw, calc(115vw / ${(word.length * 0.6 + 0.3).toFixed(2)}), 30rem)`;
      return `
  <figure class="ww__item${i % 2 ? " ww__item--r" : ""}" data-fx-i="${i % 3}" style="--fs:${fs}">
    <div class="ww__win">
      <svg class="ww__svg" aria-hidden="true"><clipPath id="${id}">${letters}</clipPath></svg>
      <div class="ww__poster" style="clip-path:url(#${id})" data-word="${esc(word)}">${p ? `<img src="${esc(imgUrl(p, 1800))}" alt="${esc(it.alt || p.alt || word)}" loading="lazy">` : ""}</div>
    </div>
    ${it.text ? `<figcaption class="ww__cap"><span class="mono">( 0${i + 1} )</span><span>${esc(it.text)}</span></figcaption>` : ""}
  </figure>`;
    };
    return `
<section class="ww" data-fx="word-windows">
  ${s.label ? `<div class="mono label">${esc(s.label)}</div>` : ""}
  ${items.map(block).join("")}
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="word-windows"]');
  if (!sec || !window.__fx.FX) return;
  sec.querySelectorAll('.ww__item').forEach(function(item){
    var v = +item.getAttribute('data-fx-i') || 0;
    var clip = item.querySelector('clipPath'), texts = clip.querySelectorAll('text');
    var poster = item.querySelector('.ww__poster'), img = poster.querySelector('img');
    var tl = gsap.timeline({ scrollTrigger: { trigger: item.querySelector('.ww__win'), start: 'top bottom', end: 'bottom top', scrub: true } });
    if (v === 0) {
      tl.fromTo(clip, { xPercent: 30 }, { xPercent: -40, ease: 'none' }, 0)
        .fromTo(poster, { filter: 'brightness(170%)', skewX: -4 }, { filter: 'brightness(35%)', skewX: 4, ease: 'sine' }, 0)
        .fromTo(img, { scale: 2.2 }, { scale: 1, ease: 'none' }, 0)
        .fromTo(texts, { transformOrigin: '50% 100%', scaleX: 0.8, scaleY: 0 }, { duration: 0.25, stagger: 0.015, scaleX: 1, scaleY: 1 }, 0);
    } else if (v === 1) {
      tl.fromTo(clip, { xPercent: 60 }, { xPercent: -60, ease: 'none' }, 0)
        .fromTo(poster, { transformOrigin: '-50% 50%', rotation: -4 }, { rotation: 6, ease: 'none' }, 0)
        .fromTo(img, { scale: 2.4 }, { scale: 1, ease: 'none' }, 0)
        .fromTo(texts, { transformOrigin: '0% 50%', rotation: -45, yPercent: -10, scale: 0.1 }, { duration: 0.3, ease: 'power1', stagger: 0.04, rotation: 0, scale: 1, yPercent: 0 }, 0);
    } else {
      tl.fromTo(clip, { xPercent: 20 }, { xPercent: -50, ease: 'none' }, 0)
        .fromTo(texts, { transformOrigin: '150% 50%', scaleX: 0.25, opacity: 0, xPercent: 100 }, { duration: 0.15, ease: 'power1', stagger: 0.045, scaleX: 1, xPercent: 0, opacity: 1 }, 0)
        .fromTo(poster, { filter: 'saturate(6)' }, { filter: 'saturate(0)', ease: 'none' }, 0);
    }
  });
})();`,
};
export default c;
