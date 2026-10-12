// @ts-nocheck
// scroll-51 · Tall full-bleed project images that open from a slanted wedge, names rising letter by letter (Awwwards Pack).
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
  id: "scroll-51",
  type: "projects-wedge",
  kind: "section",
  weight: "medium",
  describe: "projects-wedge (scroll-51): a centred title, then 3-6 projects, each a full-bleed photo one and a half screens tall. A project's photo arrives as a slanted wedge cut into the bottom of the screen that flattens open to the full frame as it reaches the top; its name, in huge white display type, rises letter by letter from behind masks over the picture, with a small meta line (place, year) above and a one-sentence description below. As it leaves, its bottom edge folds up into a wedge that uncovers the next project. Each name links to the project's page when href is set. The case-study list for builders, architects, studios, agencies and makers; needs one strong photo and a 1-3 word name per project.",
  fields: `{"type":"projects-wedge","component":"scroll-51","title":"","items":[{"query":"","alt":"","title":"","meta":"","text":"","href":""}]}`,
  images: { min: 3, max: 6 },
  css: ({ capsRule }) => `
.wedge{padding-top:clamp(4rem,10vh,8rem)}
.wedge .sec-head{grid-template-columns:1fr;padding:0 var(--gutter);text-align:center}
.wedge .sec-head h2{margin:0 auto}
.wedge__item{position:relative;height:150svh;overflow:hidden}
.wedge__img{position:absolute;inset:0;clip-path:polygon(25% 25%,75% 40%,100% 100%,0% 100%);will-change:clip-path;background:var(--bg2)}
.wedge__img img{width:100%;height:100%;object-fit:cover}
.wedge__img::after{content:"";position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,.08),rgba(0,0,0,.4))}
.wedge__name{position:absolute;top:50%;left:0;width:100%;transform:translateY(-50%);padding:0 var(--gutter);text-align:center;color:#fff;z-index:1;display:grid;gap:1.2rem;justify-items:center}
.wedge__name h3{font-size:clamp(2.4rem,7vw,7rem);${capsRule}}
.wedge__name h3 a{color:inherit}
.wedge__name .mono{color:rgba(255,255,255,.8)}
.wedge__name p{max-width:40ch;font-size:1.05rem;color:rgba(255,255,255,.88)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .wedge__item{height:auto;overflow:visible;padding:0 var(--gutter);margin-bottom:3.5rem}
  .wedge__img{position:relative;inset:auto;aspect-ratio:4/5;clip-path:none!important}
  .wedge__img::after{display:none}
  .wedge__name{position:static;transform:none;color:var(--ink);padding:1rem 0 0;text-align:left;justify-items:start;gap:.5rem}
  .wedge__name .mono,.wedge__name p{color:var(--ink2)}
  .wedge__name h3{font-size:clamp(1.8rem,8vw,3rem)}
}`,
  html: (s, { esc, imgUrl, link }) => {
    const items = (s.items || []).slice(0, 6);
    return `
<section class="wedge" id="work" data-fx="projects-wedge">
  ${s.title ? `<div class="sec-head"><h2 class="display reveal">${esc(s.title)}</h2></div>` : ""}
  ${items.map((it, i) => {
    const p = pic(it, s, i);
    const u = p ? imgUrl(p, 2000) : "";
    const name = it.href ? `<a href="${esc(link(it.href))}">${esc(it.title || "")}</a>` : esc(it.title || "");
    return `<article class="wedge__item">
    <div class="wedge__img">${u ? `<img src="${esc(u)}" alt="${esc(it.alt || p.alt || it.title || "")}" loading="lazy">` : ""}</div>
    <div class="wedge__name">${it.meta ? `<div class="mono">${esc(it.meta)}</div>` : ""}<h3 class="display">${name}</h3>${it.text ? `<p>${esc(it.text)}</p>` : ""}</div>
  </article>`;
  }).join("")}
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="projects-wedge"]');
  if (!sec || !window.__fx.FX) return;
  var OPEN = 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';
  var IN = 'polygon(25% 25%, 75% 40%, 100% 100%, 0% 100%)';
  var OUT = 'polygon(0% 0%, 100% 0%, 75% 60%, 25% 75%)';
  sec.querySelectorAll('.wedge__item').forEach(function(item){
    var img = item.querySelector('.wedge__img');
    var name = item.querySelector('.wedge__name');
    var h = name.querySelector('h3');
    var extras = Array.prototype.slice.call(name.querySelectorAll('.mono, p'));
    gsap.fromTo(img, { clipPath: IN }, { clipPath: OPEN, ease: 'none', scrollTrigger: { trigger: item, start: 'top bottom', end: 'top top', scrub: 0.5 } });
    gsap.fromTo(img, { clipPath: OPEN }, { clipPath: OUT, ease: 'none', immediateRender: false, scrollTrigger: { trigger: item, start: 'bottom bottom', end: 'bottom top', scrub: 0.5 } });
    var chars = null;
    if (window.SplitText && h) {
      var target = h.querySelector('a') || h;
      try { chars = SplitText.create(target, { type: 'chars', mask: 'chars' }).chars; } catch (e) { chars = null; }
    }
    var n = chars ? chars.length : 8;
    var tl = gsap.timeline({ scrollTrigger: { trigger: item, start: 'top-=250 top', end: 'top+=' + (n * 25 - 100) + ' top', scrub: 1 } });
    if (chars) tl.fromTo(chars, { yPercent: 125 }, { yPercent: 0, ease: 'none', duration: 150, stagger: 25 }, 0);
    else tl.fromTo(h, { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, ease: 'none', duration: 150 }, 0);
    if (extras.length) tl.fromTo(extras, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, ease: 'none', duration: 150, stagger: 20 }, n * 12);
  });
})();`,
};
export default c;
