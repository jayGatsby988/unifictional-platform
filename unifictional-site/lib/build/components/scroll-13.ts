// @ts-nocheck
// scroll-13 · Pixel-block enter/leave shader on DOM cards (Awwwards Pack,
// recreated from the preview video). The cards are ordinary DOM; a WebGL
// canvas over them paints each card's box in the page colour and dissolves
// that cover cell by cell, drawing glowing outlined squares in the accent
// colour along the dissolve edge. Leaving the viewport runs it backwards.
import type { Component } from "./_types";

// Item image: the resolver's {url} on it.image, else a parallel s.images entry, else a URL written in query.
function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}
function rgb(hex, fb) {
  let h = String(hex || "").replace("#", "");
  if (h.length === 3) h = h.split("").map(ch => ch + ch).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return fb;
  return [0, 2, 4].map(i => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(",");
}

const c: Component = {
  id: "scroll-13",
  type: "cards-pixel-13",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "(recreated from the preview video) cards-pixel-13 (scroll-13): a title and intro, then 3-6 cards in a row (photo on top, a short title, one or two sentences). Each card is invisible until it scrolls into view; then, over about a second, clusters of outlined squares in the accent colour, at three sizes, flicker across its box from left to right and the card resolves out of them, the squares clearing behind the edge like a signal locking in. Cards leaving the screen dissolve back into squares the same way, so the effect replays on every pass. Needs 3-6 items with a photo, a 1-4 word title and 10-30 words of text. For services, features or team cards on tech, studio, gaming, music and modern trade sites; on phones and without WebGL the cards simply fade in.",
  fields: `{"type":"cards-pixel-13","component":"scroll-13","title":"","intro":"","items":[{"title":"","text":"","query":"","alt":""}]}`,
  images: { min: 3, max: 6 },
  css: ({ capsRule }) => `
.px{position:relative;padding:clamp(4rem,10vh,8rem) 0}
.px .sec-head{padding:0 var(--gutter)}
.px__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1.4rem;padding:0 var(--gutter);position:relative;z-index:1}
.px__card{background:var(--bg2);border:1px solid var(--line);padding:1rem;display:grid;gap:1rem;align-content:start}
.px__img{aspect-ratio:4/3;overflow:hidden;background:var(--bg)}
.px__img img{width:100%;height:100%;object-fit:cover}
.px__card h3{font-size:clamp(1.3rem,1.8vw,1.8rem);${capsRule}}
.px__card p{color:var(--ink2);font-size:.98rem}
.px__gl{position:absolute;inset:0;pointer-events:none;z-index:3}
.px__gl canvas{position:sticky;top:0;display:block;width:100%;height:100vh}
.px.is-gl:not(.is-ready) .px__card{visibility:hidden}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .px__gl{display:none}
  .px__grid{grid-template-columns:1fr}
  .px.is-gl:not(.is-ready) .px__card{visibility:visible}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, 6);
    return `
<section class="px" data-fx="cards-pixel-13">
  ${s.title || s.intro ? `<div class="sec-head">${s.title ? `<h2 class="display reveal">${esc(s.title)}</h2>` : ""}${s.intro ? `<p class="reveal">${esc(s.intro)}</p>` : ""}</div>` : ""}
  <div class="px__grid">${items.map((it, i) => {
    const p = pic(it, s, i);
    const u = p ? imgUrl(p, 900) : "";
    return `<article class="px__card reveal">
    <div class="px__img">${u ? `<img src="${esc(u)}" alt="${esc(it.alt || p.alt || it.title || "")}" loading="lazy">` : ""}</div>
    <h3 class="display">${esc(it.title || "")}</h3>
    ${it.text ? `<p>${esc(it.text)}</p>` : ""}
  </article>`;
  }).join("")}</div>
  <div class="px__gl"><canvas aria-hidden="true"></canvas></div>
</section>`;
  },
  js: ({ t }) => `
import * as THREE from "three";
(function(){
  var sec = document.querySelector('[data-fx="cards-pixel-13"]');
  if (!sec || !window.__fx.FX) return;
  var gl2 = null; try { gl2 = document.createElement('canvas').getContext('webgl2'); } catch (e) {}
  if (!gl2) return;
  var canvas = sec.querySelector('.px__gl canvas');
  var cards = Array.prototype.slice.call(sec.querySelectorAll('.px__card'));
  if (!canvas || !cards.length) return;
  var PAD = 28;
  var VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var FRAG = 'uniform float uProgress; uniform vec2 uSize; uniform float uPad; uniform vec3 uBg; uniform vec3 uAccent; varying vec2 vUv;'
    + 'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }'
    + 'void main(){'
    + 'vec2 px = vUv * uSize;'
    + 'vec2 inner = (px - uPad) / (uSize - 2.0 * uPad);'
    + 'float inside = step(0.0, inner.x) * step(inner.x, 1.0) * step(0.0, inner.y) * step(inner.y, 1.0);'
    + 'float gx = clamp(inner.x, 0.0, 1.0); float p = uProgress;'
    + 'vec2 c0 = floor(px / 14.0); float th0 = hash(c0) * 0.5 + gx * 0.5;'
    + 'float covered = inside * step(p, th0);'
    + 'vec4 col = vec4(uBg, covered);'
    + 'float band = 0.0; vec3 glow = vec3(0.0);'
    + 'for (int k = 0; k < 3; k++) {'
    + '  float s = k == 0 ? 44.0 : (k == 1 ? 24.0 : 12.0);'
    + '  vec2 cc = floor(px / s); float h = hash(cc + s);'
    + '  float th = h * 0.5 + gx * 0.5; float d = th - p;'
    + '  float inBand = step(-0.14, d) * step(d, 0.06) * step(0.55, hash(cc * 1.7 + s));'
    + '  vec2 f = fract(px / s); float bw = 2.0 / s;'
    + '  float edge = min(1.0, step(f.x, bw) + step(1.0 - bw, f.x) + step(f.y, bw) + step(1.0 - bw, f.y));'
    + '  vec3 hue = mix(uAccent, vec3(1.0), hash(cc + 3.3) * 0.55);'
    + '  float a = inBand * (edge * 0.95 + 0.22);'
    + '  glow += hue * a; band += a;'
    + '}'
    + 'if (band > 0.0) { float b = min(band, 1.0); col.rgb = mix(col.rgb, glow / band, b); col.a = max(col.a, b); }'
    + 'gl_FragColor = col; }';
  var renderer, scene, camera, items = [], started = false, active = false, raf = 0, W = 0, H = 0, first = true;
  function size(){ W = window.innerWidth; H = window.innerHeight; renderer.setSize(W, H, true); camera.aspect = W / H; camera.fov = 2 * Math.atan(H / 2 / 1000) * 180 / Math.PI; camera.updateProjectionMatrix(); }
  function build(){
    sec.classList.add('is-gl');
    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, 10, 2000); camera.position.z = 1000;
    size();
    var geo = new THREE.PlaneGeometry(1, 1, 1, 1);
    var bg = new THREE.Vector3(${rgb(t.bg, t.dark ? "0.04,0.04,0.05" : "0.96,0.95,0.93")});
    var accent = new THREE.Vector3(${rgb(t.accent, "0.83,0.99,0.25")});
    cards.forEach(function(card, i){
      var u = { uProgress: { value: -0.25 }, uSize: { value: new THREE.Vector2(1, 1) }, uPad: { value: PAD }, uBg: { value: bg }, uAccent: { value: accent } };
      var mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false });
      var mesh = new THREE.Mesh(geo, mat); scene.add(mesh);
      items.push({ el: card, u: u, mesh: mesh, mat: mat });
      var show = function(){ gsap.to(u.uProgress, { value: 1.2, duration: 1.1, ease: 'none', delay: (i % 3) * 0.12, overwrite: true }); };
      var hide = function(){ gsap.to(u.uProgress, { value: -0.25, duration: 0.8, ease: 'none', overwrite: true }); };
      ScrollTrigger.create({ trigger: card, start: 'top 90%', end: 'bottom 10%', onEnter: show, onEnterBack: show, onLeave: hide, onLeaveBack: hide });
    });
    window.addEventListener('resize', size);
    window.addEventListener('pagehide', dispose, { once: true });
  }
  function frame(){
    if (!active) return;
    raf = requestAnimationFrame(frame);
    var cr = canvas.getBoundingClientRect();
    items.forEach(function(it){
      var r = it.el.getBoundingClientRect();
      if (r.bottom < -H || r.top > 2 * H) { it.mesh.visible = false; return; }
      it.mesh.visible = true;
      var w = r.width + PAD * 2, h = r.height + PAD * 2;
      it.mesh.position.set(r.left - cr.left - W / 2 + r.width / 2, -(r.top - cr.top) + H / 2 - r.height / 2, 0);
      it.mesh.scale.set(w, h, 1);
      it.u.uSize.value.set(w, h);
    });
    renderer.render(scene, camera);
    if (first) { first = false; sec.classList.add('is-ready'); }
  }
  function dispose(){ active = false; cancelAnimationFrame(raf); items.forEach(function(it){ it.mat.dispose(); }); if (renderer) renderer.dispose(); }
  var io = new IntersectionObserver(function(es){
    es.forEach(function(en){
      if (en.isIntersecting) { if (!started) { started = true; build(); } active = true; cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); }
      else { active = false; cancelAnimationFrame(raf); }
    });
  }, { rootMargin: '25% 0px' });
  io.observe(sec);
})();`,
};
export default c;
