// @ts-nocheck
// scroll-6 · A narrow two-column stream of thumbnails that tip up, sharpen and fold away, a marquee crossing mid-screen, a word rising letter by letter and a grid finale (Awwwards Pack).
// The demo's page-fixed marquee becomes a sticky line inside the section; the
// CodePen SplitText is the bundled one.
import type { Component } from "./_types";

// Item image: the resolver's {url} on it.image, else a parallel s.images entry, else a URL written in query.
function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}

const FULL_COLS = 5, FULL_ROWS = 3;

const c: Component = {
  id: "scroll-6",
  type: "thumb-stream",
  kind: "section",
  weight: "medium",
  describe: "thumb-stream (scroll-6): a centred title, then a narrow two-column stream of small captioned photos runs down the page. Each photo tips up from flat, blurred and dark, sharpens as it reaches mid-screen, then folds away towards the top, the two columns leaning opposite ways, while one line of big display text (the brand name or a short phrase, repeated) slides across the middle of the screen. Below, one big WORD rises letter by letter from its centre and a full-width wall of 15 photos rises column by column from the middle outwards. Needs 8-20 photos with a short caption each, a marquee phrase of 1-4 words and a single display word (defaults to the brand name). A long image run for builders, photographers, makers, restaurants and studios with lots of job photos.",
  fields: `{"type":"thumb-stream","component":"scroll-6","title":"","marquee":"","word":"","items":[{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""}]}`,
  images: { min: 8, max: 20 },
  css: ({ pair, capsRule }) => `
.stream{padding:clamp(4rem,10vh,8rem) 0 0;overflow:hidden}
.stream .sec-head{grid-template-columns:1fr;padding:0 var(--gutter);text-align:center}
.stream .sec-head h2{margin:0 auto}
.stream__body{position:relative;padding:10vh 0 20vh}
.stream__mark{position:sticky;top:50%;height:0;z-index:3;pointer-events:none;overflow:visible;white-space:nowrap}
.stream__mark-in{display:inline-block;transform:translateY(-50%);font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}font-size:clamp(2.4rem,6vw,5.5rem);line-height:1;color:var(--ink);will-change:transform}
.stream__mark-in span{margin-right:.6em}
.stream__grid{width:100%;max-width:380px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:2rem;padding:0 var(--gutter)}
.stream__item{margin:0;perspective:800px}
.stream__wrap{position:relative;overflow:hidden;border-radius:4px;background:var(--bg2);will-change:transform,filter}
.stream__wrap img{width:100%;aspect-ratio:1.2;object-fit:cover;will-change:transform}
.stream__cap{display:block;padding:.4rem 0 0;font-family:var(--mono);font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stream__word{text-align:center;font-size:clamp(3rem,12vw,13rem);line-height:1.05;padding:.08em var(--gutter);overflow:hidden;text-transform:uppercase}
.stream__full{display:grid;grid-template-columns:repeat(${FULL_COLS},1fr);gap:1rem;padding:1rem;margin-top:10vh}
.stream__tile{aspect-ratio:4/3;overflow:hidden;border-radius:4px;background:var(--bg2);will-change:transform,opacity}
.stream__tile img{width:100%;height:100%;object-fit:cover}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .stream__body{padding:2rem 0}
  .stream__mark{display:none}
  .stream__grid{max-width:none;gap:1rem}
  .stream__wrap{transform:none!important;filter:none!important}
  .stream__wrap img{transform:none!important}
  .stream__full{grid-template-columns:repeat(3,1fr);gap:.5rem;padding:.5rem;margin-top:2rem}
  .stream__tile{transform:none!important;opacity:1!important}
  .stream__tile.is-dup{display:none}
}`,
  html: (s, { esc, imgUrl, spec }) => {
    const items = (s.items || []).slice(0, 20);
    const n = items.length;
    const brand = (spec.brand && spec.brand.name) || "";
    const mark = s.marquee || brand;
    const word = String(s.word || brand.split(" ")[0] || "WORK").slice(0, 14);
    const thumbs = items.map((it, i) => {
      const p = pic(it, s, i);
      const u = p ? imgUrl(p, 700) : "";
      return `<figure class="stream__item"><div class="stream__wrap">${u ? `<img src="${esc(u)}" alt="${esc(it.alt || p.alt || it.title || "")}" loading="lazy">` : ""}${it.title ? `<figcaption class="stream__cap">${esc(it.title)}</figcaption>` : ""}</div></figure>`;
    }).join("");
    const tiles = n ? Array.from({ length: FULL_COLS * FULL_ROWS }, (_, k) => {
      const idx = (k * 7 + 3) % n; // scatter the order so neighbours differ
      const it = items[idx];
      const p = pic(it, s, idx);
      const u = p ? imgUrl(p, 700) : "";
      return `<div class="stream__tile${k >= n ? " is-dup" : ""}">${u ? `<img src="${esc(u)}" alt="" loading="lazy">` : ""}</div>`;
    }).join("") : "";
    return `
<section class="stream" data-fx="thumb-stream">
  ${s.title ? `<div class="sec-head"><h2 class="display reveal">${esc(s.title)}</h2></div>` : ""}
  <div class="stream__body">
    ${mark ? `<div class="stream__mark" aria-hidden="true"><div class="stream__mark-in">${Array.from({ length: 4 }, () => `<span>${esc(mark)}</span>`).join("")}</div></div>` : ""}
    <div class="stream__grid">${thumbs}</div>
  </div>
  <h3 class="stream__word display">${esc(word)}</h3>
  ${tiles ? `<div class="stream__full">${tiles}</div>` : ""}
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="thumb-stream"]');
  if (!sec || !window.__fx.FX) return;
  var grid = sec.querySelector('.stream__grid');
  sec.querySelectorAll('.stream__wrap').forEach(function(w, i){
    var left = i % 2 === 0, img = w.querySelector('img');
    var tl = gsap.timeline({ scrollTrigger: { trigger: w, start: 'top bottom+=10%', end: 'bottom top-=25%', scrub: true } });
    tl.fromTo(w, { z: 300, rotateX: 70, rotateZ: left ? 5 : -5, xPercent: left ? -40 : 40, skewX: left ? -20 : 20, yPercent: 100, filter: 'blur(7px) brightness(0%) contrast(400%)' },
      { z: 0, rotateX: 0, rotateZ: 0, xPercent: 0, skewX: 0, yPercent: 0, filter: 'blur(0px) brightness(100%) contrast(100%)', ease: 'sine' })
      .to(w, { z: 300, rotateX: -50, rotateZ: left ? -1 : 1, xPercent: left ? -20 : 20, skewX: left ? 10 : -10, filter: 'blur(4px) brightness(0%) contrast(500%)', ease: 'sine.in' });
    if (img) tl.fromTo(img, { scaleY: 1.8 }, { scaleY: 1, ease: 'sine' }, 0).to(img, { scaleY: 1.8, ease: 'sine.in' }, '>');
  });
  var mark = sec.querySelector('.stream__mark-in');
  if (mark && grid) gsap.fromTo(mark, { x: window.innerWidth }, { x: function(){ return -mark.offsetWidth; }, ease: 'sine', scrollTrigger: { trigger: grid, start: 'top bottom', end: 'bottom top', scrub: true, invalidateOnRefresh: true } });
  var word = sec.querySelector('.stream__word');
  if (word) {
    var chars = null;
    if (window.SplitText) { try { chars = SplitText.create(word, { type: 'chars' }).chars; } catch (e) { chars = null; } }
    if (chars && chars.length) gsap.from(chars, { yPercent: 300, autoAlpha: 0, ease: 'sine', stagger: { each: 0.04, from: 'center' }, scrollTrigger: { trigger: word, start: 'top bottom', end: 'center center-=25%', scrub: true } });
    else gsap.from(word, { yPercent: 60, autoAlpha: 0, ease: 'sine', scrollTrigger: { trigger: word, start: 'top bottom', end: 'center center-=25%', scrub: true } });
  }
  var full = sec.querySelector('.stream__full');
  if (full) {
    var tiles = Array.prototype.slice.call(full.querySelectorAll('.stream__tile'));
    var cols = ${FULL_COLS}, mid = Math.floor(cols / 2);
    for (var cI = 0; cI < cols; cI++) {
      var col = tiles.filter(function(t, k){ return k % cols === cI; });
      gsap.from(col, { yPercent: 450, autoAlpha: 0, delay: Math.abs(cI - mid) * 0.2, ease: 'sine', scrollTrigger: { trigger: full, start: 'top bottom', end: 'center center', scrub: true } });
    }
  }
})();`,
};
export default c;
