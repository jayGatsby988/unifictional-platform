// @ts-nocheck
// 3d-7 · Scroll-spun CSS 3D carousels with grid expand (Awwwards Pack / Codrops
// "On-Scroll 3D Carousel"). Each ring of four photo cards turns half a revolution
// and dims from over-bright as it scrolls past, with a mono title typing in over
// it. Clicking the title spins the ring away and a captioned grid of every photo
// flies in from depth; Close reverses it. ScrollSmoother is replaced by Lenis
// (stop/start while the grid is open) and the fixed px ring scales to the viewport.
import type { Component } from "./_types";

const PER_RING = 4;

function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}

const c: Component = {
  id: "3d-7",
  type: "carousel-rings-3d",
  kind: "section",
  weight: "medium",
  describe: "carousel-rings-3d (3d-7): a run of full-height dark scenes, one per group of four photos. Each scene is a ring of four tall photo cards standing in 3D space that turns half a revolution as it scrolls past, the cards fading from over-bright to normal, while a small mono caption types itself in over the ring. Clicking a caption spins that ring off into the distance and a grid of every photo in the section (with its title under each) flies in from depth; a Close link sends them back and the ring returns. Needs 8-16 photos, each with a short title; the photos are shown four per ring and each ring is captioned with the title of its first photo, so order them in themed runs of four (decks, pergolas, fences...). An index-of-collections piece for photographers, portfolios, galleries, fashion, interiors and builders with lots of project photos. Phones get a plain stack of the groups.",
  fields: `{"type":"carousel-rings-3d","component":"3d-7","items":[{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""}]}`,
  images: { min: 8, max: 16 },
  css: ({ t }) => `
.rings{position:relative;background:${t.dark ? "var(--bg)" : "var(--inv-bg)"};color:${t.dark ? "var(--ink)" : "var(--inv-ink)"};overflow:hidden}
.rings__scene{position:relative;height:100svh;perspective:900px;display:flex;align-items:center;justify-content:center}
.rings__title{position:relative;z-index:10;font-family:var(--mono);font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;font-weight:400}
.rings__title a{display:block;padding:.6em 1em}
.rings__title .ch{display:inline-block;will-change:opacity}
.rings__carousel{position:absolute;left:50%;top:50%;width:var(--cw,400px);height:var(--ch,500px);margin:calc(var(--ch,500px) / -2) 0 0 calc(var(--cw,400px) / -2);transform-style:preserve-3d;will-change:transform;transform:translateZ(-550px)}
.rings__scene:nth-child(even) .rings__carousel{transform:translateZ(-550px) rotateY(45deg)}
.rings__cell{position:absolute;left:0;top:0;width:var(--cw,400px);height:var(--ch,500px);transform-style:preserve-3d}
.rings__card{width:100%;height:100%;position:relative;transform-style:preserve-3d;will-change:transform,filter}
.rings__face{position:absolute;inset:0;backface-visibility:hidden;overflow:hidden;border-radius:4px;background:#1a1a1c}
.rings__face img{width:100%;height:100%;object-fit:cover}
.rings__face--back{transform:rotateY(180deg)}
.rings__cell h3{display:none}
.rings__preview{position:fixed;inset:0;z-index:70;padding:0 var(--gutter);display:grid;align-content:center;justify-items:center;row-gap:1rem;opacity:0;visibility:hidden;pointer-events:none;background:${t.dark ? "var(--bg)" : "var(--inv-bg)"};color:${t.dark ? "var(--ink)" : "var(--inv-ink)"};overflow:hidden}
.rings__phead{display:flex;width:100%;align-items:flex-end;justify-content:space-between;font-family:var(--mono);font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;line-height:1}
.rings__phead h2{font:inherit;margin:0}
.rings__close{font:inherit;letter-spacing:inherit;text-transform:inherit;color:inherit;cursor:pointer;padding:.4em 0}
.rings__close:hover{opacity:.6}
.rings__grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(1rem,2vw,3rem);width:100%;perspective:900px;padding:1rem 0;max-height:80svh}
@media(min-width:65em){.rings__grid{grid-template-columns:repeat(6,minmax(0,1fr))}}
.rings__item{display:flex;flex-direction:column;gap:.35rem;will-change:transform;transform-style:preserve-3d;visibility:hidden;opacity:0}
.rings__pic{overflow:hidden;border-radius:4px;aspect-ratio:4/5;background:#1a1a1c}
.rings__item img{width:100%;height:100%;object-fit:cover;transition:opacity .15s}
.rings__item:hover img{opacity:.7}
.rings__item figcaption{font-family:var(--mono);font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;opacity:.75}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .rings__scene{height:auto;perspective:none;display:block;padding:3rem var(--gutter) 1rem}
  .rings__title{margin-bottom:1.2rem}
  .rings__title a{padding:0;pointer-events:none}
  .rings__carousel,.rings__scene:nth-child(even) .rings__carousel{position:static;width:auto;height:auto;margin:0;transform:none!important;display:grid;grid-template-columns:1fr 1fr;gap:.6rem}
  .rings__cell{position:static;width:100%;height:auto;aspect-ratio:4/5;transform:none!important}
  .rings__card{transform:none!important;filter:none!important}
  .rings__face--back{display:none}
  .rings__preview{display:none}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).map((it, i) => ({ p: pic(it, s, i), alt: it.alt || "", title: it.title || "" })).filter(x => x.p).slice(0, 16);
    if (!items.length) return `<section class="rings" data-fx="carousel-rings-3d"></section>`;
    const rings = [];
    for (let i = 0; i < items.length; i += PER_RING) rings.push(items.slice(i, i + PER_RING));
    const pad = (n) => String(n).padStart(2, "0");
    const scene = (ring, k) => `
  <div class="rings__scene">
    <h2 class="rings__title"><a href="#rings-preview" data-ring="${k}"><span>${esc(ring[0].title || `Collection ${pad(k + 1)}`)}</span></a></h2>
    <div class="rings__carousel">${ring.map(it => `<div class="rings__cell"><div class="rings__card"><div class="rings__face"><img src="${esc(imgUrl(it.p, 900))}" alt="${esc(it.alt || it.p.alt || "")}" loading="lazy"></div><div class="rings__face rings__face--back"><img src="${esc(imgUrl(it.p, 900))}" alt="" loading="lazy"></div></div><h3>${esc(it.title)}</h3></div>`).join("")}</div>
  </div>`;
    return `
<section class="rings" data-fx="carousel-rings-3d">
  ${rings.map(scene).join("")}
  <div class="rings__preview" id="rings-preview" aria-hidden="true">
    <div class="rings__phead"><h2><span>${esc(s.title || "All work")}</span></h2><button class="rings__close" type="button"><span>Close</span></button></div>
    <div class="rings__grid">${items.map(it => `<figure class="rings__item"><div class="rings__pic"><img src="${esc(imgUrl(it.p, 600))}" alt="${esc(it.alt || it.p.alt || "")}" loading="lazy"></div><figcaption>${esc(it.title)}</figcaption></figure>`).join("")}</div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="carousel-rings-3d"]');
  if (!sec || !window.__fx.FX) return;
  var scenes = [].slice.call(sec.querySelectorAll('.rings__scene'));
  var preview = sec.querySelector('.rings__preview'), gridItems = [].slice.call(sec.querySelectorAll('.rings__item'));
  var L = window.__fx.lenis, busy = false, openRing = null;
  // Ring size follows the viewport: the demo's 400x500 ring at 500px radius only fits a desktop.
  var cw = Math.round(Math.max(220, Math.min(400, window.innerWidth * 0.26))), ch = Math.round(cw * 1.25), radius = Math.round(cw * 1.25);
  sec.style.setProperty('--cw', cw + 'px'); sec.style.setProperty('--ch', ch + 'px');
  function split(span){ if (window.SplitText) { try { return SplitText.create(span, { type: 'chars', charsClass: 'ch' }).chars; } catch (e) {} } return [span]; }
  scenes.forEach(function(scene){
    var car = scene.querySelector('.rings__carousel'), cells = scene.querySelectorAll('.rings__cell'), cards = scene.querySelectorAll('.rings__card');
    var chars = split(scene.querySelector('.rings__title span'));
    cells.forEach(function(cell, i){ cell.style.transform = 'rotateY(' + (i * 360 / cells.length) + 'deg) translateZ(' + radius + 'px)'; });
    gsap.set(car, { z: -550 });
    scene._chars = chars; scene._car = car; scene._cards = cards;
    scene._tl = gsap.timeline({ defaults: { ease: 'sine.inOut' }, scrollTrigger: { trigger: scene, start: 'top bottom', end: 'bottom top', scrub: true } })
      .fromTo(car, { rotationY: 0 }, { rotationY: -180 }, 0)
      .fromTo(car, { rotationZ: 3, rotationX: 3 }, { rotationZ: -3, rotationX: -3 }, 0)
      .fromTo(cards, { filter: 'brightness(250%)' }, { filter: 'brightness(80%)', ease: 'power3' }, 0)
      .fromTo(cards, { rotationZ: 10 }, { rotationZ: -10, ease: 'none' }, 0);
    gsap.fromTo(chars, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.02, ease: 'none', stagger: { each: 0.04, from: 'start' }, scrollTrigger: { trigger: scene, start: 'top center', toggleActions: 'play none none reverse' } });
  });
  var pChars = [].concat.apply([], [].slice.call(preview.querySelectorAll('.rings__phead span')).map(split));
  function gridIn(){
    gsap.set(gridItems, { clearProps: 'all' });
    var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    var data = gridItems.map(function(el){ var r = el.getBoundingClientRect(); var dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2); return { el: el, dx: dx, dy: dy, dist: Math.hypot(dx, dy), left: r.left + r.width / 2 < cx }; });
    var max = Math.max.apply(null, data.map(function(d){ return d.dist; })) || 1, total = 0.025 * (data.length - 1);
    data.forEach(function(d){
      var delay = (1 - d.dist / max) * total;
      gsap.fromTo(d.el, { autoAlpha: 0, y: d.dy * 0.5, scale: 0.5, rotationY: d.left ? 100 : -100, transformOrigin: '50% 50% ' + (d.dx > 0 ? -d.dx * 0.8 : d.dx * 0.8) + 'px' }, { autoAlpha: 1, y: 0, scale: 1, rotationY: 0, duration: 0.4, ease: 'sine', delay: delay + 0.1 });
      gsap.fromTo(d.el, { z: -3500 }, { z: 0, duration: 0.3, ease: 'expo', delay: delay });
    });
  }
  function gridOut(done){
    var cx = window.innerWidth / 2, cy = window.innerHeight / 2, last = null, lastDelay = -1;
    var data = gridItems.map(function(el){ var r = el.getBoundingClientRect(); var dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2); return { el: el, dx: dx, dy: dy, dist: Math.hypot(dx, dy), left: r.left + r.width / 2 < cx }; });
    var max = Math.max.apply(null, data.map(function(d){ return d.dist; })) || 1, total = 0.025 * (data.length - 1);
    data.forEach(function(d){
      var delay = (d.dist / max) * total; if (delay > lastDelay) { lastDelay = delay; last = d; }
      gsap.to(d.el, { y: d.dy * 0.4, rotationY: d.left ? 100 : -100, scale: 0.4, autoAlpha: 0, duration: 0.4, ease: 'sine.in', delay: delay });
      gsap.to(d.el, { z: -3500, duration: 0.4, ease: 'expo.in', delay: delay + 0.9, onComplete: d === last ? done : null });
    });
    if (!last) done();
  }
  function prevent(e){ e.preventDefault(); }
  function lock(){ window.addEventListener('wheel', prevent, { passive: false }); window.addEventListener('touchmove', prevent, { passive: false }); if (L) L.stop(); }
  function unlock(){ window.removeEventListener('wheel', prevent); window.removeEventListener('touchmove', prevent); if (L) L.start(); }
  function open(scene){
    if (busy) return; busy = true; openRing = scene;
    var car = scene._car, cards = scene._cards;
    var run = function(){
      lock();
      gsap.timeline({ defaults: { duration: 1.5, ease: 'power2.inOut' }, onComplete: function(){ busy = false; } })
        .to(scene._chars, { autoAlpha: 0, duration: 0.02, ease: 'none', stagger: { each: 0.04, from: 'end' } }, 0)
        .to(car, { rotationX: 90, rotationY: -360, z: -2000 }, 0)
        .to(car, { duration: 2.5, ease: 'power3.inOut', z: 1500, rotationZ: 270 }, 0.7)
        .to(cards, { rotationZ: 0 }, 0)
        .add(function(){
          gsap.set(preview, { autoAlpha: 1, pointerEvents: 'auto' }); preview.setAttribute('aria-hidden', 'false');
          gridIn();
          gsap.fromTo(pChars, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.02, ease: 'none', stagger: { each: 0.04 } });
        }, '<+=1.9');
    };
    // Centre the scene first (it is one viewport tall, so its top is the target). Lenis skips
    // scrollTo (and its onComplete) when already there, so run straight away in that case.
    var top = scene.getBoundingClientRect().top + window.scrollY, done = false, go = function(){ if (!done) { done = true; run(); } };
    if (Math.abs(window.scrollY - top) < 2) go();
    else if (L) { L.scrollTo(scene, { offset: 0, duration: 1, onComplete: go }); setTimeout(go, 1500); }
    else { window.scrollTo({ top: top, behavior: 'smooth' }); setTimeout(go, 700); }
  }
  function close(){
    if (busy || !openRing) return; busy = true;
    var scene = openRing, car = scene._car, cards = scene._cards, p = scene._tl.scrollTrigger ? scene._tl.scrollTrigger.progress : 0.5;
    var rot = { rotationY: gsap.utils.interpolate(0, -180, p), rotationX: gsap.utils.interpolate(3, -3, p), rotationZ: gsap.utils.interpolate(3, -3, p) };
    gsap.to(pChars, { autoAlpha: 0, duration: 0.02, ease: 'none', stagger: { each: 0.04, from: 'end' } });
    gridOut(function(){ gsap.set(preview, { autoAlpha: 0, pointerEvents: 'none' }); preview.setAttribute('aria-hidden', 'true'); });
    gsap.timeline({ delay: 0.7, defaults: { duration: 1.3, ease: 'expo' }, onComplete: function(){ unlock(); busy = false; openRing = null; } })
      .fromTo(scene._chars, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.02, ease: 'none', stagger: { each: 0.04 } })
      .fromTo(car, { z: -550, rotationX: rot.rotationX, rotationY: -720, rotationZ: rot.rotationZ, yPercent: 300 }, { rotationY: rot.rotationY, yPercent: 0 }, 0)
      .fromTo(cards, { autoAlpha: 0 }, { autoAlpha: 1 }, 0.3);
  }
  scenes.forEach(function(scene){ scene.querySelector('.rings__title a').addEventListener('click', function(e){ e.preventDefault(); open(scene); }); });
  preview.querySelector('.rings__close').addEventListener('click', close);
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && openRing) close(); });
})();`,
};
export default c;
