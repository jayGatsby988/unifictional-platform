// @ts-nocheck
// scroll-1 · Velocity bend + RGB-split image scroll (Awwwards Pack).
// A vertical run of tall photos drawn on WebGL planes that track their <img>
// boxes; while the page moves each plane bows and its red channel slides.
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
  id: "scroll-1",
  type: "gallery-bend",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "gallery-bend (scroll-1): an optional title, then 4-10 tall photos, one per screen, each centred with a one or two word name in huge display type cutting across its lower right corner and a small index number. The photos are drawn in WebGL: while the page is moving each picture bows (its middle lags behind its edges) and its red channel slides off vertically, then everything relaxes to sharp as the scroll settles. Needs 4-10 portrait photos with a short name each. A moody portfolio run for photographers, studios, architects, fashion, interiors and makers; on phones and without WebGL it is a plain stack of photos with captions.",
  fields: `{"type":"gallery-bend","component":"scroll-1","title":"","items":[{"query":"","alt":"","title":""}]}`,
  images: { min: 4, max: 10 },
  css: ({ capsRule }) => `
.gb{position:relative;background:var(--bg)}
.gb__head{padding:clamp(4rem,10vh,8rem) var(--gutter) 0;text-align:center}
.gb__head h2{font-size:clamp(2rem,5vw,4.5rem);max-width:16ch;margin:0 auto}
.gb__gl{position:absolute;inset:0;pointer-events:none;z-index:1}
.gb__gl canvas{position:sticky;top:0;display:block;width:100%;height:100vh}
.gb__item{position:relative;height:100svh;display:flex;align-items:center;justify-content:center}
.gb__img{width:min(42vw,32rem);aspect-ratio:3/4;max-height:72svh;overflow:hidden;background:var(--bg2)}
.gb__img img{width:100%;height:100%;object-fit:cover}
.gb__img.is-gl img{visibility:hidden}
.gb__cap{position:absolute;left:52%;top:56%;z-index:2;max-width:46vw;pointer-events:none;mix-blend-mode:difference;color:#fff}
.gb__cap h3{font-size:clamp(2.4rem,6.5vw,7rem);line-height:.9;text-wrap:balance;${capsRule}}
.gb__cap .gb__n{display:block;font-family:var(--mono);font-size:.68rem;letter-spacing:.2em;margin-bottom:.8rem}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .gb__gl{display:none}
  .gb__head{padding:3rem var(--gutter) 1rem}
  .gb__item{height:auto;flex-direction:column;align-items:flex-start;padding:1.5rem var(--gutter)}
  .gb__img{width:100%;max-height:none;aspect-ratio:4/5}
  .gb__img.is-gl img{visibility:visible}
  .gb__cap{position:static;mix-blend-mode:normal;color:var(--ink);padding-top:.8rem}
  .gb__cap h3{font-size:clamp(1.8rem,9vw,3rem);white-space:normal}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, 10);
    return `
<section class="gb" data-fx="gallery-bend">
  ${s.title ? `<div class="gb__head"><h2 class="display reveal">${esc(s.title)}</h2></div>` : ""}
  <div class="gb__gl"><canvas aria-hidden="true"></canvas></div>
  ${items.map((it, i) => {
    const p = pic(it, s, i);
    const u = p ? imgUrl(p, 1400) : "";
    return `<article class="gb__item">
    <div class="gb__img">${u ? `<img src="${esc(u)}" alt="${esc(it.alt || p.alt || it.title || "")}" loading="lazy">` : ""}</div>
    <div class="gb__cap"><span class="gb__n">${String(i + 1).padStart(2, "0")} / ${String(items.length).padStart(2, "0")}</span><h3 class="display">${esc(it.title || "")}</h3></div>
  </article>`;
  }).join("")}
</section>`;
  },
  js: () => `
import * as THREE from "three";
(function(){
  var sec = document.querySelector('[data-fx="gallery-bend"]');
  if (!sec || !window.__fx.FX) return;
  var gl2 = null; try { gl2 = document.createElement('canvas').getContext('webgl2'); } catch (e) {}
  if (!gl2) return;
  var canvas = sec.querySelector('.gb__gl canvas');
  var figs = Array.prototype.slice.call(sec.querySelectorAll('.gb__img'));
  if (!canvas || !figs.length) return;
  var VERT = 'uniform vec2 uOffset; varying vec2 vUv; void main(){ vUv = uv; vec3 p = position; p.y += sin(uv.x * 3.14159265) * uOffset.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }';
  var FRAG = 'uniform sampler2D uMap; uniform vec2 uImg; uniform vec2 uPlane; uniform vec2 uOffset; uniform float uAlpha; varying vec2 vUv;'
    + 'void main(){ vec2 ratio = vec2(min((uPlane.x/uPlane.y)/(uImg.x/uImg.y),1.0), min((uPlane.y/uPlane.x)/(uImg.y/uImg.x),1.0));'
    + 'vec2 uv = vec2(vUv.x*ratio.x + (1.0-ratio.x)*0.5, vUv.y*ratio.y + (1.0-ratio.y)*0.5);'
    + 'float r = texture2D(uMap, uv + uOffset * 0.5).r; vec2 gb = texture2D(uMap, uv).gb; gl_FragColor = vec4(r, gb, uAlpha); }';
  var renderer, scene, camera, items = [], started = false, active = false, raf = 0, W = 0, H = 0;
  var lenis = window.__fx.lenis, lastY = window.scrollY, vel = 0;
  function size(){ W = window.innerWidth; H = window.innerHeight; renderer.setSize(W, H, true); camera.aspect = W / H; camera.fov = 2 * Math.atan(H / 2 / 1000) * 180 / Math.PI; camera.updateProjectionMatrix(); }
  function build(){
    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, 10, 2000); camera.position.z = 1000;
    size();
    var geo = new THREE.PlaneGeometry(1, 1, 32, 32);
    var loader = new THREE.TextureLoader(); loader.crossOrigin = 'anonymous';
    figs.forEach(function(fig){
      var img = fig.querySelector('img'); if (!img) return;
      var u = { uMap: { value: null }, uImg: { value: new THREE.Vector2(1, 1) }, uPlane: { value: new THREE.Vector2(1, 1) }, uOffset: { value: new THREE.Vector2(0, 0) }, uAlpha: { value: 0 } };
      var mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, transparent: true });
      var mesh = new THREE.Mesh(geo, mat); mesh.visible = false; scene.add(mesh);
      var it = { el: fig, u: u, mesh: mesh, mat: mat, ready: false };
      loader.load(img.currentSrc || img.src, function(tex){ tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; u.uMap.value = tex; u.uImg.value.set(tex.image.width, tex.image.height); u.uAlpha.value = 1; it.ready = true; fig.classList.add('is-gl'); });
      items.push(it);
    });
    window.addEventListener('resize', size);
    window.addEventListener('pagehide', dispose, { once: true });
  }
  function frame(){
    if (!active) return;
    raf = requestAnimationFrame(frame);
    var v = lenis ? lenis.velocity : (window.scrollY - lastY); lastY = window.scrollY;
    v = Math.max(-120, Math.min(120, v || 0));
    vel += (v - vel) * 0.12;
    var off = -vel * 0.0012;
    var cr = canvas.getBoundingClientRect();
    items.forEach(function(it){
      if (!it.ready) return;
      var r = it.el.getBoundingClientRect();
      if (r.bottom < -H || r.top > 2 * H) { it.mesh.visible = false; return; }
      it.mesh.visible = true;
      it.mesh.position.set(r.left - cr.left - W / 2 + r.width / 2, -(r.top - cr.top) + H / 2 - r.height / 2, 0);
      it.mesh.scale.set(r.width, r.height, 1);
      it.u.uPlane.value.set(r.width, r.height);
      it.u.uOffset.value.set(0, off);
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
