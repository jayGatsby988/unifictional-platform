// @ts-nocheck
// scroll-52 · A pinned 15-tile photo wall that zooms in until its centre picture fills the screen (Awwwards Pack).
import type { Component } from "./_types";

const COLS = 5, ROWS = 3, MAIN = 7; // slot = col * 3 + row; slot 7 is the centre tile

// Item image: the resolver's {url} on it.image, else a parallel s.images entry, else a URL written in query.
function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}

const c: Component = {
  id: "scroll-52",
  type: "photo-wall",
  kind: "section",
  weight: "medium",
  describe: "photo-wall (scroll-52): a big centred headline, then the screen pins on a dark wall of 15 photos (five columns of three, Mondrian-style gaps) that enlarges as you scroll, the outer columns drifting down, until the centre photo alone fills the screen; then a short paragraph of text follows below. Needs 9-15 photos (the first one is the centre picture, so make it the best), a headline of 2-5 words and a one or two sentence text. A dramatic transition for photographers, studios, hospitality, fashion and event brands.",
  fields: `{"type":"photo-wall","component":"scroll-52","headline":"","text":"","items":[{"query":"","alt":""}]}`,
  images: { min: 9, max: 15 },
  css: () => `
.wall__head,.wall__foot{padding:clamp(5rem,16vh,10rem) var(--gutter);text-align:center}
.wall__head h2{font-size:clamp(2.6rem,8vw,8rem);max-width:12ch;margin:0 auto}
.wall__foot p{max-width:44ch;margin:0 auto;font-size:clamp(1.1rem,1.6vw,1.4rem);color:var(--ink2)}
.wall__track{height:400svh;position:relative}
.wall__stage{position:sticky;top:0;height:100svh;overflow:hidden;background:var(--inv-bg)}
.wall__grid{position:absolute;top:50%;left:50%;width:160vw;height:100svh;display:flex;gap:3vw;transform:translate(-50%,-50%);will-change:transform}
.wall__col{flex:1;display:flex;flex-direction:column;gap:3vw;will-change:transform}
.wall__img{flex:1;min-height:0;overflow:hidden;background:var(--bg2)}
.wall__img img{width:100%;height:100%;object-fit:cover}
.wall__img.is-main img{transform:scale(2);will-change:transform}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .wall__head,.wall__foot{padding:3rem var(--gutter)}
  .wall__track{height:auto}
  .wall__stage{position:static;height:auto;overflow:visible;background:none;padding:0 var(--gutter)}
  .wall__grid{position:static;width:100%;height:auto;display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;transform:none!important}
  .wall__col{display:contents}
  .wall__img{flex:none;aspect-ratio:1}
  .wall__img.is-dup{display:none}
  .wall__img.is-main img{transform:none!important}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, COLS * ROWS);
    const n = items.length;
    if (!n) return `<section class="wall" data-fx="photo-wall"><div class="wall__head"><h2 class="display">${esc(s.headline || "")}</h2></div></section>`;
    // Fill the 15 slots: item 0 takes the centre, the rest follow in order and repeat when there are fewer than 15.
    const slots = [];
    let k = 1;
    for (let i = 0; i < COLS * ROWS; i++) {
      if (i === MAIN) { slots.push({ idx: 0, dup: false }); continue; }
      const idx = n > 1 ? 1 + ((k - 1) % (n - 1)) : 0;
      slots.push({ idx, dup: k > n - 1 });
      k++;
    }
    const tile = (slot, i) => {
      const it = items[slot.idx];
      const p = pic(it, s, slot.idx);
      const u = p ? imgUrl(p, i === MAIN ? 2000 : 900) : "";
      return `<div class="wall__img${i === MAIN ? " is-main" : ""}${slot.dup ? " is-dup" : ""}">${u ? `<img src="${esc(u)}" alt="${slot.dup ? "" : esc(it.alt || p.alt || "")}" loading="lazy">` : ""}</div>`;
    };
    const cols = Array.from({ length: COLS }, (_, c) => `<div class="wall__col${c === 2 ? " is-main" : ""}">${Array.from({ length: ROWS }, (_, r) => tile(slots[c * ROWS + r], c * ROWS + r)).join("")}</div>`).join("");
    return `
<section class="wall" data-fx="photo-wall">
  <div class="wall__head"><h2 class="display reveal">${esc(s.headline || "")}</h2></div>
  <div class="wall__track"><div class="wall__stage"><div class="wall__grid">${cols}</div></div></div>
  ${s.text ? `<div class="wall__foot"><p class="reveal">${esc(s.text)}</p></div>` : ""}
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="photo-wall"]');
  if (!sec || !window.__fx.FX) return;
  var track = sec.querySelector('.wall__track'), grid = sec.querySelector('.wall__grid');
  var sides = sec.querySelectorAll('.wall__col:not(.is-main)'), main = sec.querySelector('.wall__img.is-main img');
  if (!track || !grid) return;
  var max = window.innerWidth < 900 ? 4 : 2.65;
  var tl = gsap.timeline({ scrollTrigger: { trigger: track, start: 'top top', end: 'bottom bottom', scrub: 1 } });
  tl.fromTo(grid, { xPercent: -50, yPercent: -50, scale: 1 }, { xPercent: -50, yPercent: -50, scale: 1 + max, ease: 'none' }, 0);
  if (sides.length) tl.fromTo(sides, { y: 0 }, { y: 300, ease: 'none' }, 0);
  if (main) tl.fromTo(main, { scale: 2 }, { scale: 1.15, ease: 'none' }, 0);
})();`,
};
export default c;
