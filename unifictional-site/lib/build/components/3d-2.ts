// @ts-nocheck
// 3d-2 · Camera-projected 2D layout turning into a 3D set (Awwwards Pack, video
// only). At rest a flat poster: big headline fragments around a run of cards. As
// you scroll the "camera" swings off axis and every element takes its own depth,
// so the poster smears across a 3D set (floor, arch, discs); further on it swings
// back and snaps flat. Rebuilt with CSS 3D (perspective + preserve-3d) and one
// scrubbed GSAP timeline instead of a projective-texture three.js scene.
import type { Component } from "./_types";

// Poster slots for up to 8 cards: left/top in %, width in vw-ish clamp, depth (px), tilt (deg).
const SLOTS = [
  { l: 37, t: 22, w: "clamp(14rem,22vw,24rem)", z: 260, r: -4 },
  { l: 8, t: 56, w: "clamp(11rem,17vw,19rem)", z: -220, r: 6 },
  { l: 66, t: 12, w: "clamp(10rem,15vw,17rem)", z: 120, r: -9 },
  { l: 70, t: 58, w: "clamp(11rem,17vw,19rem)", z: 380, r: 5 },
  { l: 22, t: 8, w: "clamp(9rem,13vw,15rem)", z: -340, r: 8 },
  { l: 50, t: 66, w: "clamp(9rem,13vw,15rem)", z: -120, r: -7 },
  { l: 2, t: 20, w: "clamp(8rem,12vw,14rem)", z: 200, r: 3 },
  { l: 84, t: 36, w: "clamp(8rem,12vw,14rem)", z: -60, r: -3 },
];

function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}

const c: Component = {
  id: "3d-2",
  type: "poster-depth-3d",
  kind: "section",
  weight: "medium",
  describe: "(recreated from the preview video) poster-depth-3d (3d-2): the screen pins on what looks like a flat printed poster: the headline broken into three big fragments scattered around a collage of 4-8 photo cards, the first card in the accent colour with a short paragraph on it. As you scroll the whole poster swings off axis like a camera orbiting it and every piece takes its own depth: cards float forward or sink back, the words hang in the air, a floor with ruled lines and a few pale set pieces (an arch, discs) appear behind, and the type smears across them. Keep scrolling and it orbits back and snaps flat again. Needs a headline of 4-9 words, 4-8 cards with a photo and 2-4 word title (the first also carries a one-sentence text) and a tiny scroll cue. Suits studios, architects, interior designers, agencies and makers who want one theatrical moment; phones get the headline over a plain list of the cards.",
  fields: `{"type":"poster-depth-3d","component":"3d-2","headline":"","items":[{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""}]}`,
  images: { min: 4, max: 8 },
  css: ({ t, pair, capsRule }) => `
.poster{height:320svh;position:relative;background:var(--bg2)}
.poster__stage{position:sticky;top:0;height:100svh;overflow:hidden;perspective:1300px;perspective-origin:50% 50%}
.poster__world{position:absolute;inset:0;transform-style:preserve-3d;will-change:transform}
.poster__set{position:absolute;inset:0;transform-style:preserve-3d;pointer-events:none}
.poster__floor{position:absolute;left:-40%;right:-40%;bottom:-2%;height:120svh;transform-origin:50% 100%;transform:rotateX(90deg);background:repeating-linear-gradient(to top,var(--line) 0 1px,transparent 1px 48px);opacity:0}
.poster__arch{position:absolute;left:58%;bottom:14%;width:clamp(10rem,18vw,20rem);height:clamp(16rem,30vw,34rem);border:clamp(1.6rem,3vw,3.4rem) solid var(--bg);border-bottom:0;border-radius:999px 999px 0 0;background:transparent;box-shadow:inset 0 0 0 1px var(--line),0 40px 80px -40px rgba(0,0,0,.25);opacity:0}
.poster__disc{position:absolute;border-radius:50%;background:radial-gradient(circle at 35% 30%,var(--bg2),var(--bg) 70%);box-shadow:inset 0 0 0 1px var(--line);opacity:0}
.poster__disc--a{left:8%;bottom:10%;width:clamp(6rem,10vw,12rem);aspect-ratio:1}
.poster__disc--b{left:34%;bottom:4%;width:clamp(4rem,7vw,8rem);aspect-ratio:1}
.poster__disc--c{right:6%;top:18%;width:clamp(5rem,8vw,9rem);aspect-ratio:1}
.poster__word{position:absolute;z-index:3;font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}font-size:clamp(2.2rem,6.2vw,6.4rem);line-height:.95;color:var(--ink);will-change:transform;white-space:nowrap}
.poster__word--1{left:30%;top:12%}
.poster__word--2{left:9%;top:34%}
.poster__word--3{right:10%;top:60%;text-align:right}
.poster__card{position:absolute;z-index:2;background:var(--bg);box-shadow:0 30px 60px -30px rgba(0,0,0,.35);padding:.6rem;display:grid;gap:.6rem;will-change:transform;transform-style:preserve-3d}
.poster__card img{width:100%;aspect-ratio:4/3;object-fit:cover}
.poster__card h3{font-size:.95rem;font-weight:500;line-height:1.2}
.poster__card p{font-size:.78rem;line-height:1.45;color:var(--ink2)}
.poster__card.is-accent{background:var(--accent);color:var(--on-accent);padding:1rem}
.poster__card.is-accent h3{font-size:1.05rem}
.poster__card.is-accent p{color:var(--on-accent);opacity:.85}
.poster__cue{position:absolute;left:50%;bottom:2rem;transform:translateX(-50%);z-index:4;font-family:var(--mono);font-size:.62rem;letter-spacing:.2em;text-transform:uppercase;color:var(--ink2)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .poster{height:auto}
  .poster__stage{position:static;height:auto;overflow:visible;perspective:none;padding:4rem var(--gutter)}
  .poster__world{position:static;transform:none!important;display:grid;gap:1rem}
  .poster__set,.poster__cue{display:none}
  .poster__word{position:static;transform:none!important;white-space:normal;font-size:clamp(2.2rem,10vw,4rem);text-align:left}
  .poster__word--2{margin-top:-.4rem}.poster__word--3{margin-bottom:1.5rem}
  .poster__card{position:static;width:auto!important;transform:none!important;box-shadow:none;border:1px solid var(--line)}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, 8);
    const words = String(s.headline || "").trim().split(/\s+/).filter(Boolean);
    const n = words.length, a = Math.max(1, Math.round(n / 3)), b = Math.max(a + 1, Math.round((2 * n) / 3));
    const parts = n <= 2 ? [words.join(" "), "", ""] : [words.slice(0, a).join(" "), words.slice(a, b).join(" "), words.slice(b).join(" ")];
    const card = (it, i) => {
      const sl = SLOTS[i], p = pic(it, s, i);
      return `<article class="poster__card${i === 0 ? " is-accent" : ""}" style="left:${sl.l}%;top:${sl.t}%;width:${sl.w}" data-z="${sl.z}" data-r="${sl.r}">
      ${p ? `<img src="${esc(imgUrl(p, 800))}" alt="${esc(it.alt || p.alt || "")}" loading="lazy">` : ""}
      <h3>${esc(it.title || "")}</h3>${i === 0 && it.text ? `<p>${esc(it.text)}</p>` : ""}</article>`;
    };
    return `
<section class="poster" data-fx="poster-depth-3d">
  <div class="poster__stage">
    <div class="poster__world">
      <div class="poster__set" aria-hidden="true"><div class="poster__floor"></div><div class="poster__arch" data-z="-500"></div><div class="poster__disc poster__disc--a" data-z="-260"></div><div class="poster__disc poster__disc--b" data-z="-80"></div><div class="poster__disc poster__disc--c" data-z="-420"></div></div>
      ${items.map(card).join("")}
      ${parts.map((p, i) => p ? `<h2 class="poster__word poster__word--${i + 1}" data-z="${[140, 300, 60][i]}" data-r="${[-2, 3, -3][i]}">${esc(p)}</h2>` : "").join("")}
    </div>
    <div class="poster__cue">Scroll down</div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="poster-depth-3d"]');
  if (!sec || !window.__fx.FX) return;
  var world = sec.querySelector('.poster__world'), floor = sec.querySelector('.poster__floor'), props = sec.querySelectorAll('.poster__arch,.poster__disc');
  var deep = [].slice.call(sec.querySelectorAll('[data-z]'));
  var tl = gsap.timeline({ scrollTrigger: { trigger: sec, start: 'top top', end: 'bottom bottom', scrub: 0.8 }, defaults: { ease: 'none' } });
  // 0 - 0.45: swing off axis and separate; 0.45 - 0.7: orbit; 0.7 - 1: swing back and snap flat.
  tl.fromTo(world, { rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1 }, { rotationX: 34, rotationY: -28, rotationZ: -5, scale: 0.86, duration: 0.45, ease: 'power2.inOut' }, 0)
    .to(world, { rotationY: 22, rotationX: 26, rotationZ: 3, duration: 0.25, ease: 'sine.inOut' }, 0.45)
    .to(world, { rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1, duration: 0.3, ease: 'power2.inOut' }, 0.7);
  deep.forEach(function(el, i){
    var z = parseFloat(el.getAttribute('data-z')) || 0, r = parseFloat(el.getAttribute('data-r')) || 0, d = (i % 5) * 0.02;
    tl.fromTo(el, { z: 0, rotationZ: 0 }, { z: z, rotationZ: r, duration: 0.4, ease: 'power2.inOut' }, d)
      .to(el, { z: 0, rotationZ: 0, duration: 0.28, ease: 'power2.inOut' }, 0.7 + d * 0.5);
  });
  tl.fromTo(floor, { opacity: 0 }, { opacity: 0.9, duration: 0.3 }, 0.1).to(floor, { opacity: 0, duration: 0.2 }, 0.78);
  tl.fromTo(props, { opacity: 0 }, { opacity: 1, duration: 0.3 }, 0.15).to(props, { opacity: 0, duration: 0.2 }, 0.78);
  tl.to(sec.querySelector('.poster__cue'), { opacity: 0, duration: 0.1 }, 0);
})();`,
};
export default c;
