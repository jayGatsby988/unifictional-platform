// @ts-nocheck
// svg-5 · Scroll storytelling with wavy-edge image masks (Awwwards Pack, video only: recreated from the preview).
// 3-5 full-width story blocks; each photo is clipped by an SVG clipPath whose top and bottom
// edges are sine waves that swell with scroll speed and keep a slow undulation while in view.
// Thin wave lines separate the blocks and draw on as they scroll in.
import type { Component } from "./_types";

function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}

const LINES = ["M0 30 C150 10 300 50 450 30 S750 10 900 30 S1150 50 1200 30", "M0 60 C150 40 300 80 450 60 S750 40 900 60 S1150 80 1200 60", "M0 90 C150 70 300 110 450 90 S750 70 900 90 S1150 110 1200 90"];

const c: Component = {
  id: "svg-5",
  type: "wave-story",
  kind: "section",
  weight: "light",
  describe: "(recreated from the preview video) wave-story (svg-5): an optional 2-6 word section headline, then 3-5 story chapters stacked down the page, each a full-width photo about four fifths of the screen tall with a 2-5 word title in white over its lower corner and a numbered paragraph (40-100 words) beneath it, alternating left and right. The photos' top and bottom edges are not straight: they are gentle waves that swell as you scroll and settle into a slow ripple while the photo is in view, and the photo drifts slightly slower than the page. Between chapters three thin wave lines draw themselves across the page. Needs one photo per chapter. Phones and reduced motion show the same chapters with straight edges and no lines. For 'our story', a process in steps, or a tour of a place: restaurants, wellness, crafts, hospitality, heritage brands.",
  fields: `{"type":"wave-story","component":"svg-5","headline":"","items":[{"title":"","text":"","query":"","alt":""}]}`,
  images: { min: 3, max: 5 },
  css: () => `
.wst{padding:clamp(3rem,8vh,6rem) 0 clamp(3rem,8vh,6rem);overflow:hidden}
.wst__head{padding:0 var(--gutter);margin-bottom:clamp(2rem,6vh,4rem)}
.wst__head h2{font-size:clamp(2.4rem,6.5vw,6.5rem);max-width:14ch}
.wst__block{display:grid;gap:1.5rem;margin-bottom:clamp(2rem,6vh,4rem)}
.wst__fig{position:relative;margin:0;height:clamp(24rem,80svh,52rem);overflow:hidden;will-change:clip-path}
.wst__fig img{position:absolute;left:0;top:-10%;width:100%;height:120%;object-fit:cover;will-change:transform}
.wst__title{position:absolute;left:var(--gutter);bottom:clamp(2rem,9vh,5rem);max-width:12ch;color:#fff;font-size:clamp(2.2rem,6vw,6rem);text-shadow:0 2px 40px rgba(0,0,0,.45)}
.wst__block.is-alt .wst__title{left:auto;right:var(--gutter);text-align:right}
.wst__text{padding:0 var(--gutter);display:grid;gap:.8rem;max-width:46rem}
.wst__block.is-alt .wst__text{margin-left:auto;text-align:right}
.wst__text p{font-size:clamp(1rem,1.3vw,1.2rem);line-height:1.6;color:var(--ink2)}
.wst__lines{display:block;width:100%;height:clamp(60px,12vh,140px);margin:clamp(1rem,4vh,3rem) 0}
.wst__lines path{fill:none;stroke:var(--ink3);stroke-width:1;vector-effect:non-scaling-stroke}
.wst__svg{position:absolute;width:0;height:0}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .wst__fig{clip-path:none!important;height:auto;aspect-ratio:4/5}
  .wst__fig img{top:0;height:100%;transform:none!important}
  .wst__lines{display:none}
  .wst__block.is-alt .wst__text{text-align:left}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, 5);
    const salt = Math.random().toString(36).slice(2, 6);
    const blocks = items.map((it, i) => {
      const p = pic(it, s, i), id = `wst-${salt}-${i}`;
      return `
  <article class="wst__block${i % 2 ? " is-alt" : ""}">
    <svg class="wst__svg" aria-hidden="true"><defs><clipPath id="${id}" clipPathUnits="objectBoundingBox"><path d="M0 0H1V1H0Z"/></clipPath></defs></svg>
    <figure class="wst__fig" style="clip-path:url(#${id})" data-clip="${id}">${p ? `<img src="${esc(imgUrl(p, 1800))}" alt="${esc(it.alt || p.alt || it.title || "")}" loading="lazy">` : ""}<figcaption class="wst__title display reveal">${esc(it.title || "")}</figcaption></figure>
    <div class="wst__text reveal"><span class="mono">${String(i + 1).padStart(2, "0")}</span><p>${esc(it.text || "")}</p></div>
  </article>
  ${i < items.length - 1 ? `<svg class="wst__lines" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true">${LINES.map(d => `<path d="${d}"/>`).join("")}</svg>` : ""}`;
    }).join("");
    return `
<section class="wst" data-fx="wave-story">
  ${s.headline ? `<div class="wst__head"><h2 class="display reveal">${esc(s.headline)}</h2></div>` : ""}
  ${blocks}
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="wave-story"]');
  if (!sec || !window.__fx.FX) return;
  var figs = Array.prototype.slice.call(sec.querySelectorAll('.wst__fig'));
  var S = 40, live = [], lastY = window.scrollY, vel = 0, running = false, t = 0;
  function wave(amp, ph){
    var d = 'M0 ' + amp.toFixed(4);
    for (var k = 1; k <= S; k++) { var x = k / S; d += 'L' + x.toFixed(4) + ' ' + (amp * (0.5 + 0.5 * Math.sin(x * 9.42 + ph))).toFixed(4); }
    for (k = S; k >= 0; k--) { x = k / S; d += 'L' + x.toFixed(4) + ' ' + (1 - amp * (0.5 + 0.5 * Math.sin(x * 9.42 + ph + 2.1))).toFixed(4); }
    return d + 'Z';
  }
  var items = figs.map(function(fig, i){
    var path = document.getElementById(fig.getAttribute('data-clip')); if (path) path = path.querySelector('path');
    var img = fig.querySelector('img');
    if (img) gsap.fromTo(img, { yPercent: -7 }, { yPercent: 7, ease: 'none', scrollTrigger: { trigger: fig, start: 'top bottom', end: 'bottom top', scrub: true } });
    return { fig: fig, path: path, amp: 0.02, ph: i * 1.3, on: false };
  });
  function tick(){
    var y = window.scrollY; vel += ((y - lastY) - vel) * 0.2; lastY = y; t += 0.016;
    var target = 0.02 + Math.min(0.07, Math.abs(vel) * 0.0012), any = false;
    items.forEach(function(it){
      if (!it.on || !it.path) return; any = true;
      it.amp += (target - it.amp) * 0.08; it.ph += 0.012 + Math.min(0.08, Math.abs(vel) * 0.001);
      it.path.setAttribute('d', wave(it.amp, it.ph));
    });
    if (!any) { gsap.ticker.remove(tick); running = false; }
  }
  function run(){ if (!running) { running = true; gsap.ticker.add(tick); } }
  var io = new IntersectionObserver(function(es){ es.forEach(function(en){ var it = items[figs.indexOf(en.target)]; if (!it) return; it.on = en.isIntersecting; if (it.on) run(); }); }, { rootMargin: '40px 0px' });
  figs.forEach(function(f){ io.observe(f); });
  sec.querySelectorAll('.wst__lines').forEach(function(svg){
    var paths = svg.querySelectorAll('path');
    paths.forEach(function(p){ var L = p.getTotalLength(); p.style.strokeDasharray = L; p.style.strokeDashoffset = L; });
    gsap.to(paths, { strokeDashoffset: 0, ease: 'none', stagger: 0.15, scrollTrigger: { trigger: svg, start: 'top 95%', end: 'bottom 45%', scrub: true } });
  });
})();`,
};
export default c;
