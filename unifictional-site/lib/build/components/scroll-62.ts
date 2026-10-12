// @ts-nocheck
// scroll-62 · Pinned horizontal cards over flowing letters (Awwwards Pack;
// three.js r128 global build upgraded to r160 modules). Rows of giant accent
// letters stream along bowed curves (three.js curve maths projected to the
// DOM) over a drifting dot grid rendered as WebGL points, while image cards
// glide across in front.
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
  id: "scroll-62",
  type: "cards-letters",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "cards-letters (scroll-62): a dark panel pins for several screens. Behind everything a grid of tiny accent-coloured dots drifts sideways; over it, one row per letter of a short word (the brand name by default, 3-6 letters), fifteen copies of that letter in giant accent display type stream right to left along bowed paths at slightly different speeds, trailing the scroll like a river of type. In front, 5-8 framed photo cards with a name and a meta line glide across from right to left as you scroll; each links to its page when href is set. Needs 5-8 portrait photos with a 1-3 word name and a short meta line, plus a word. A showcase strip for studios, agencies, product makers, fashion and nightlife; on phones it is a grid of the cards.",
  fields: `{"type":"cards-letters","component":"scroll-62","word":"","eyebrow":"","items":[{"title":"","meta":"","query":"","alt":"","href":""}]}`,
  images: { min: 5, max: 8 },
  css: ({ pair }) => `
.cl__track{position:relative}
.cl__stage{position:sticky;top:0;height:100svh;overflow:hidden;background:var(--inv-bg);color:var(--inv-ink)}
.cl__gl{position:absolute;inset:0;width:100%;height:100%;z-index:0;display:block}
.cl__letters{position:absolute;inset:0;z-index:1;pointer-events:none;overflow:hidden}
.cl__letter{position:absolute;left:0;top:0;font-family:var(--display);font-weight:${pair.weight};font-size:clamp(4rem,calc(72vh / var(--rows, 4)),15rem);line-height:1;color:var(--accent);will-change:transform;text-transform:uppercase;transform:translate(-50%,-50%) translate3d(-200px,-200px,0)}
.cl__cards{position:absolute;left:0;top:0;height:100%;display:flex;align-items:center;gap:10vw;padding:0 24vw 0 100vw;z-index:2;will-change:transform}
.cl__card{flex:none;width:clamp(12rem,15vw,19rem);background:var(--inv-bg);padding:.5rem;display:grid;gap:.5rem;color:var(--accent)}
.cl__img{aspect-ratio:3/4;overflow:hidden;background:rgba(128,128,128,.15)}
.cl__img img{width:100%;height:100%;object-fit:cover}
.cl__copy{display:flex;justify-content:space-between;gap:.6rem;font-family:var(--mono);font-size:.66rem;letter-spacing:.1em;text-transform:uppercase}
.cl__label{position:absolute;left:var(--gutter);top:6rem;z-index:3;color:var(--accent)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .cl__track{height:auto!important}
  .cl__stage{position:static;height:auto;overflow:visible;padding:3rem var(--gutter)}
  .cl__gl,.cl__letters{display:none}
  .cl__label{position:static;margin-bottom:1.5rem}
  .cl__cards{position:static;height:auto;display:grid;grid-template-columns:1fr 1fr;gap:1rem;padding:0;transform:none!important}
  .cl__card{width:100%}
  .cl__copy{flex-direction:column;gap:.2rem}
}`,
  html: (s, { esc, imgUrl, link, spec }) => {
    const items = (s.items || []).slice(0, 8);
    const word = String(s.word || (spec.brand && spec.brand.name) || "WORK").toUpperCase().trim().split(/\s+/)[0].replace(/[^A-Z0-9]/g, "").slice(0, 6) || "WORK";
    return `
<section class="cl" data-fx="cards-letters" data-word="${esc(word)}" style="--rows:${word.length}">
  <div class="cl__track" style="height:${Math.max(400, items.length * 90)}svh">
    <div class="cl__stage">
      <canvas class="cl__gl" aria-hidden="true"></canvas>
      <div class="cl__letters" aria-hidden="true"></div>
      ${s.eyebrow ? `<div class="cl__label mono">${esc(s.eyebrow)}</div>` : ""}
      <div class="cl__cards">${items.map((it, i) => {
        const p = pic(it, s, i);
        const u = p ? imgUrl(p, 900) : "";
        const tag = it.href ? "a" : "div";
        return `<${tag} class="cl__card"${it.href ? ` href="${esc(link(it.href))}"` : ""}>
        <div class="cl__img">${u ? `<img src="${esc(u)}" alt="${esc(it.alt || p.alt || it.title || "")}" loading="lazy">` : ""}</div>
        <div class="cl__copy"><span>${esc(it.title || "")}</span><span>${esc(it.meta || String(i + 1).padStart(2, "0"))}</span></div>
      </${tag}>`;
      }).join("")}</div>
    </div>
  </div>
</section>`;
  },
  js: ({ t }) => `
import * as THREE from "three";
(function(){
  var sec = document.querySelector('[data-fx="cards-letters"]');
  if (!sec || !window.__fx.FX) return;
  var track = sec.querySelector('.cl__track'), canvas = sec.querySelector('.cl__gl'), box = sec.querySelector('.cl__letters'), cards = sec.querySelector('.cl__cards');
  if (!track || !canvas || !box || !cards) return;
  var WORD = (sec.getAttribute('data-word') || 'WORK').split('');
  var SPEEDS = [0.8, 1, 0.7, 0.9, 0.85, 0.95];
  var progress = 0, curX = 0, W = 0, H = 0, moveDist = 0;
  // Cards slide with a lerp even before WebGL is ready.
  ScrollTrigger.create({ trigger: track, start: 'top top', end: 'bottom bottom', scrub: 1, onUpdate: function(self){ progress = self.progress; if (ready) targets(progress); } });
  var gl2 = null; try { gl2 = document.createElement('canvas').getContext('webgl2'); } catch (e) {}
  var renderer, scene, cam, ortho, pts, ptsMat, paths = [], letters = [], started = false, active = false, raf = 0, ready = false;
  function lerp(a, b, t){ return a + (b - a) * t; }
  function makePath(y, amp){
    var p = [];
    for (var i = 0; i <= 20; i++) { var tt = i / 20; p.push(new THREE.Vector3(-25 + 50 * tt, y + Math.sin(tt * Math.PI) * -amp, (1 - Math.pow(Math.abs(tt - 0.5) * 2, 2)) * -5)); }
    return new THREE.CatmullRomCurve3(p);
  }
  function grid(){
    if (pts) { scene.remove(pts); pts.geometry.dispose(); }
    var sp = 30, cols = Math.ceil(W / sp) + 15, rows = Math.ceil(H / sp) + 1, arr = new Float32Array(cols * rows * 3), k = 0;
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) { arr[k++] = c * sp - W / 2; arr[k++] = H / 2 - r * sp; arr[k++] = 0; }
    var geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    pts = new THREE.Points(geo, ptsMat); scene.add(pts);
  }
  function size(){
    W = window.innerWidth; H = window.innerHeight;
    moveDist = Math.max(0, cards.scrollWidth - W);
    if (!renderer) return;
    renderer.setSize(W, H, true);
    cam.aspect = W / H; cam.updateProjectionMatrix();
    ortho.left = -W / 2; ortho.right = W / 2; ortho.top = H / 2; ortho.bottom = -H / 2; ortho.updateProjectionMatrix();
    ptsMat.uniforms.uSize.value = 2 * renderer.getPixelRatio();
    grid(); targets(progress);
  }
  function build(){
    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    scene = new THREE.Scene();
    cam = new THREE.PerspectiveCamera(50, 1, 0.1, 1000); cam.position.z = 20; cam.updateMatrixWorld(); // maths only: never rendered, so refresh its inverse matrix here
    ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    ptsMat = new THREE.ShaderMaterial({ transparent: true, depthTest: false, uniforms: { uShift: { value: 0 }, uSize: { value: 2 }, uColor: { value: new THREE.Vector3(${rgb(t.accent, "0.83,0.99,0.25")}) } },
      vertexShader: 'uniform float uShift; uniform float uSize; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x - uShift, position.y, 0.0, 1.0); gl_PointSize = uSize; }',
      fragmentShader: 'uniform vec3 uColor; void main(){ if (length(gl_PointCoord - 0.5) > 0.5) discard; gl_FragColor = vec4(uColor, 0.9); }' });
    var n = WORD.length, per = window.innerWidth < 1200 ? 12 : 15;
    WORD.forEach(function(ch, row){
      var y = n === 1 ? 0 : 7.5 - 15 * row / (n - 1);
      var amp = n === 1 ? 2 : 2 - 4 * row / (n - 1);
      var curve = makePath(y, amp), els = [];
      for (var i = 0; i < per; i++) { var el = document.createElement('div'); el.className = 'cl__letter'; el.textContent = ch; box.appendChild(el); els.push({ el: el, cx: 0, cy: 0, tx: 0, ty: 0, fresh: true }); }
      paths.push({ curve: curve, els: els, speed: SPEEDS[row % SPEEDS.length] });
    });
    ready = true;
    size();
    window.addEventListener('resize', size);
    window.addEventListener('pagehide', dispose, { once: true });
  }
  function targets(p){
    paths.forEach(function(path){
      var count = path.els.length;
      path.els.forEach(function(l, i){
        var pt = path.curve.getPoint(((i / (count - 1)) + p * path.speed) % 1);
        var v = pt.clone().project(cam);
        l.tx = (-v.x * 0.5 + 0.5) * W; l.ty = (-v.y * 0.5 + 0.5) * H;
        if (l.fresh) { l.cx = l.tx; l.cy = l.ty; l.fresh = false; }
      });
    });
  }
  function frame(){
    if (!active) return;
    raf = requestAnimationFrame(frame);
    curX = lerp(curX, -moveDist * progress, 0.07);
    cards.style.transform = 'translate3d(' + curX.toFixed(2) + 'px,0,0)';
    if (!ready) return;
    paths.forEach(function(path){ path.els.forEach(function(l){
      if (Math.abs(l.tx - l.cx) > W * 0.7) { l.cx = l.tx; l.cy = l.ty; } else { l.cx = lerp(l.cx, l.tx, 0.07); l.cy = lerp(l.cy, l.ty, 0.07); }
      l.el.style.transform = 'translate(-50%,-50%) translate3d(' + l.cx.toFixed(1) + 'px,' + l.cy.toFixed(1) + 'px,0)';
    }); });
    ptsMat.uniforms.uShift.value = (progress * 300) % 30;
    renderer.render(scene, ortho);
  }
  function dispose(){ active = false; cancelAnimationFrame(raf); if (pts) pts.geometry.dispose(); if (ptsMat) ptsMat.dispose(); if (renderer) renderer.dispose(); }
  size();
  var io = new IntersectionObserver(function(es){
    es.forEach(function(en){
      if (en.isIntersecting) { if (!started && gl2) { started = true; build(); } active = true; cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); }
      else { active = false; cancelAnimationFrame(raf); }
    });
  }, { rootMargin: '25% 0px' });
  io.observe(sec);
})();`,
};
export default c;
