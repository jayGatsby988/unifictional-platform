// @ts-nocheck
// scroll-11 · WebGL pixel-wipe image reveal (Awwwards Pack; the demo's Barba
// page transition and ScrollSmoother are dropped). Photos on a sparse 9-column
// grid; each is drawn top to bottom behind a band of random squares when it
// enters the viewport.
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
// (column, span, aspect) on a 9-column grid, cycling
const PLAN = [[1, 4, "4/5"], [5, 3, "4/3"], [2, 4, "1/1"], [6, 3, "3/4"], [1, 3, "4/5"], [4, 5, "4/3"], [3, 4, "3/4"], [6, 3, "1/1"]];

const c: Component = {
  id: "scroll-11",
  type: "gallery-pixel-wipe",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "gallery-pixel-wipe (scroll-11): a title and intro, then 3-8 photos placed loosely on a nine-column grid with a tall gap between rows, each with a small caption (name, place or year). Every photo is drawn in WebGL: when it scrolls into view it is painted top to bottom in about a second and a half, the wipe edge broken into a band of random dark squares that flicker and clear; leaving the screen resets it so it plays again. Each caption links to the project's page when href is set. Needs 3-8 photos with a 1-3 word name. A quiet editorial work grid for architects, photographers, interior studios and makers; on phones and without WebGL the photos simply show in a single column.",
  fields: `{"type":"gallery-pixel-wipe","component":"scroll-11","title":"","intro":"","items":[{"query":"","alt":"","title":"","meta":"","href":""}]}`,
  images: { min: 3, max: 8 },
  css: ({ capsRule }) => `
.pw{position:relative;padding:clamp(4rem,10vh,8rem) 0 clamp(4rem,10vh,8rem)}
.pw .sec-head{padding:0 var(--gutter)}
.pw__gl{position:absolute;inset:0;pointer-events:none;z-index:1}
.pw__gl canvas{position:sticky;top:0;display:block;width:100%;height:100vh}
.pw__grid{display:grid;grid-template-columns:repeat(9,1fr);column-gap:1rem;row-gap:clamp(6rem,22vh,16rem);padding:0 var(--gutter)}
.pw__item{grid-column:var(--c) / span var(--s);display:block}
.pw__img{aspect-ratio:var(--ar);overflow:hidden;background:var(--bg2)}
.pw__img img{width:100%;height:100%;object-fit:cover}
.pw__img.is-gl img{visibility:hidden}
.pw__cap{display:flex;justify-content:space-between;gap:1rem;padding-top:.7rem;font-size:.95rem}
.pw__cap b{font-family:var(--display);font-weight:500;${capsRule}}
.pw__cap span{color:var(--ink2);font-family:var(--mono);font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .pw__gl{display:none}
  .pw__grid{grid-template-columns:1fr;row-gap:2.5rem}
  .pw__item{grid-column:auto}
  .pw__img.is-gl img{visibility:visible}
}`,
  html: (s, { esc, imgUrl, link }) => {
    const items = (s.items || []).slice(0, 8);
    return `
<section class="pw" id="work" data-fx="gallery-pixel-wipe">
  ${s.title || s.intro ? `<div class="sec-head">${s.title ? `<h2 class="display reveal">${esc(s.title)}</h2>` : ""}${s.intro ? `<p class="reveal">${esc(s.intro)}</p>` : ""}</div>` : ""}
  <div class="pw__gl"><canvas aria-hidden="true"></canvas></div>
  <div class="pw__grid">${items.map((it, i) => {
    const p = pic(it, s, i);
    const u = p ? imgUrl(p, 1400) : "";
    const [col, span, ar] = PLAN[i % PLAN.length];
    const tag = it.href ? "a" : "div";
    return `<${tag} class="pw__item" style="--c:${col};--s:${span};--ar:${ar}"${it.href ? ` href="${esc(link(it.href))}"` : ""}>
    <div class="pw__img">${u ? `<img src="${esc(u)}" alt="${esc(it.alt || p.alt || it.title || "")}" loading="lazy">` : ""}</div>
    <div class="pw__cap reveal"><b>${esc(it.title || "")}</b>${it.meta ? `<span>${esc(it.meta)}</span>` : ""}</div>
  </${tag}>`;
  }).join("")}</div>
</section>`;
  },
  js: ({ t }) => `
import * as THREE from "three";
(function(){
  var sec = document.querySelector('[data-fx="gallery-pixel-wipe"]');
  if (!sec || !window.__fx.FX) return;
  var gl2 = null; try { gl2 = document.createElement('canvas').getContext('webgl2'); } catch (e) {}
  if (!gl2) return;
  var canvas = sec.querySelector('.pw__gl canvas');
  var figs = Array.prototype.slice.call(sec.querySelectorAll('.pw__img'));
  if (!canvas || !figs.length) return;
  var VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var FRAG = 'uniform sampler2D uMap; uniform vec2 uImg; uniform vec2 uPlane; uniform float uProgress; uniform vec3 uColor; varying vec2 vUv;'
    + 'float random(vec2 st){ return fract(sin(dot(st, vec2(12.9898,78.233))) * 43758.5453123); }'
    + 'void main(){'
    + 'vec2 ratio = vec2(min((uPlane.x/uPlane.y)/(uImg.x/uImg.y),1.0), min((uPlane.y/uPlane.x)/(uImg.y/uImg.x),1.0));'
    + 'vec2 uv = vec2(vUv.x*ratio.x + (1.0-ratio.x)*0.5, vUv.y*ratio.y + (1.0-ratio.y)*0.5);'
    + 'float cols = max(4.0, floor(uPlane.x / 20.0)); float rows = max(4.0, floor(uPlane.y / 20.0));'
    + 'vec2 grid = vec2(floor(vUv.x*cols)/cols, floor(vUv.y*rows)/rows);'
    + 'vec4 tex = texture2D(uMap, uv);'
    + 'float h = 0.2; float progress = (1.0+h) - uProgress*(1.0+2.0*h);'
    + 'float d = distance(grid.y, progress); float dist = 1.0 - d;'
    + 'float clamped = smoothstep(h, 0.0, d);'
    + 'float randDist = step(1.0 - h*random(grid), dist);'
    + 'dist = step(1.0 - h, dist);'
    + 'float rand = random(grid);'
    + 'float alpha = max(0.0, dist * (clamped + rand - 0.5*(1.0-randDist)));'
    + 'tex *= step(progress, grid.y);'
    + 'vec4 g = vec4(uColor, alpha); gl_FragColor = mix(tex, g, g.a); }';
  var renderer, scene, camera, items = [], started = false, active = false, raf = 0, W = 0, H = 0;
  function size(){ W = window.innerWidth; H = window.innerHeight; renderer.setSize(W, H, true); camera.aspect = W / H; camera.fov = 2 * Math.atan(H / 2 / 1000) * 180 / Math.PI; camera.updateProjectionMatrix(); }
  function build(){
    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, 10, 2000); camera.position.z = 1000;
    size();
    var geo = new THREE.PlaneGeometry(1, 1, 1, 1);
    var loader = new THREE.TextureLoader(); loader.crossOrigin = 'anonymous';
    var ink = new THREE.Vector3(${rgb(t.ink, "0.14,0.14,0.14")});
    figs.forEach(function(fig){
      var img = fig.querySelector('img'); if (!img) return;
      var u = { uMap: { value: null }, uImg: { value: new THREE.Vector2(1, 1) }, uPlane: { value: new THREE.Vector2(1, 1) }, uProgress: { value: 0 }, uColor: { value: ink } };
      var mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, transparent: true });
      var mesh = new THREE.Mesh(geo, mat); mesh.visible = false; scene.add(mesh);
      var it = { el: fig, u: u, mesh: mesh, mat: mat, ready: false, tween: null };
      loader.load(img.currentSrc || img.src, function(tex){
        tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
        u.uMap.value = tex; u.uImg.value.set(tex.image.width, tex.image.height);
        it.ready = true; fig.classList.add('is-gl');
        it.tween = gsap.to(u.uProgress, { value: 1, duration: 1.6, ease: 'none', scrollTrigger: { trigger: fig, start: 'top bottom', end: 'bottom top', toggleActions: 'play reset restart reset' } });
      });
      items.push(it);
    });
    window.addEventListener('resize', size);
    window.addEventListener('pagehide', dispose, { once: true });
  }
  function frame(){
    if (!active) return;
    raf = requestAnimationFrame(frame);
    var cr = canvas.getBoundingClientRect();
    items.forEach(function(it){
      if (!it.ready) return;
      var r = it.el.getBoundingClientRect();
      if (r.bottom < -H || r.top > 2 * H) { it.mesh.visible = false; return; }
      it.mesh.visible = true;
      it.mesh.position.set(r.left - cr.left - W / 2 + r.width / 2, -(r.top - cr.top) + H / 2 - r.height / 2, 0);
      it.mesh.scale.set(r.width, r.height, 1);
      it.u.uPlane.value.set(r.width, r.height);
    });
    renderer.render(scene, camera);
  }
  function dispose(){ active = false; cancelAnimationFrame(raf); items.forEach(function(it){ it.mat.dispose(); if (it.u.uMap.value) it.u.uMap.value.dispose(); }); if (renderer) renderer.dispose(); }
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
