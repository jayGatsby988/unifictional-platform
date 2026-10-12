// @ts-nocheck
// scroll-12 · WebGL edge-blur image gallery (Awwwards Pack; OGL rewritten
// with three.js). Photos in loose editorial rows, drawn on planes that are
// sharp mid-screen and melt into a grainy blur near the viewport edges.
import type { Component } from "./_types";

// Item image: the resolver's {url} on it.image, else a parallel s.images entry, else a URL written in query.
function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}
// Row plan: one centred, three across, two stacked and centred, two side by side; repeats.
const ROWS = [["1", 1], ["3", 3], ["2a", 2], ["2b", 2]];

const c: Component = {
  id: "scroll-12",
  type: "gallery-edge-blur",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "gallery-edge-blur (scroll-12): a centred title and intro, then 4-10 photos in loose editorial rows (one wide and centred, three across at different widths, a small one above a large one, a square beside a tall one) with a small numbered caption under each. The photos are drawn in WebGL with a fine animated film grain; each is sharp in the middle of the screen and dissolves into a soft noisy blur as it nears the top or bottom edge, so the page reads like a lens being pulled through the work. Needs 4-10 photos with a short caption each. A lookbook or portfolio page for photographers, fashion, interiors, food and studios; on phones and without WebGL the photos simply show in a single column.",
  fields: `{"type":"gallery-edge-blur","component":"scroll-12","title":"","intro":"","items":[{"query":"","alt":"","title":""}]}`,
  images: { min: 4, max: 10 },
  css: () => `
.eb{position:relative;padding:clamp(4rem,10vh,8rem) 0 clamp(2rem,6vh,4rem)}
.eb__head{padding:0 var(--gutter);text-align:center;margin-bottom:clamp(2rem,6vh,4rem)}
.eb__head h2{font-size:clamp(2.4rem,6.5vw,6.5rem);max-width:14ch;margin:0 auto}
.eb__head p{max-width:44ch;margin:1.2rem auto 0;color:var(--ink2);font-size:1.05rem}
.eb__gl{position:absolute;inset:0;pointer-events:none;z-index:1}
.eb__gl canvas{position:sticky;top:0;display:block;width:100%;height:100vh}
.eb__row{display:flex;gap:var(--gutter);padding:0 var(--gutter);margin:clamp(5rem,14vh,11rem) 0;align-items:flex-start}
.eb__fig{display:block;margin:0}
.eb__img{overflow:hidden;background:var(--bg2);width:100%}
.eb__img img{width:100%;height:100%;object-fit:cover}
.eb__img.is-gl img{visibility:hidden}
.eb__cap{display:block;text-align:center;padding-top:.6rem;font-family:var(--mono);font-size:.66rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2)}
.eb__row[data-n="1"]{justify-content:center}
.eb__row[data-n="1"] .eb__fig{width:min(64vw,1080px)}
.eb__row[data-n="1"] .eb__img{aspect-ratio:1080/950}
.eb__row[data-n="3"] .eb__img{height:40vw}
.eb__row[data-n="3"] .eb__fig:nth-child(1){width:32%}
.eb__row[data-n="3"] .eb__fig:nth-child(2){width:52%}
.eb__row[data-n="3"] .eb__fig:nth-child(3){width:16%}
.eb__row[data-n="2a"]{flex-direction:column;align-items:center}
.eb__row[data-n="2a"] .eb__fig:nth-child(1){width:20%}
.eb__row[data-n="2a"] .eb__fig:nth-child(1) .eb__img{aspect-ratio:1/1}
.eb__row[data-n="2a"] .eb__fig:nth-child(2){width:62%}
.eb__row[data-n="2a"] .eb__fig:nth-child(2) .eb__img{aspect-ratio:376/400}
.eb__row[data-n="2b"] .eb__fig:nth-child(1){width:59%}
.eb__row[data-n="2b"] .eb__fig:nth-child(1) .eb__img{aspect-ratio:1/1}
.eb__row[data-n="2b"] .eb__fig:nth-child(2){width:23%}
.eb__row[data-n="2b"] .eb__fig:nth-child(2) .eb__img{aspect-ratio:316/444}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .eb__gl{display:none}
  .eb__row{flex-direction:column;align-items:stretch;margin:2rem 0;gap:2rem}
  .eb__row .eb__fig{width:100%!important}
  .eb__row .eb__img{height:auto!important;aspect-ratio:4/5!important}
  .eb__img.is-gl img{visibility:visible}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, 10);
    const rows = [];
    let i = 0, r = 0;
    while (i < items.length) {
      const [n, count] = ROWS[r % ROWS.length];
      rows.push({ n, items: items.slice(i, i + count).map((it, k) => ({ it, i: i + k })) });
      i += count; r++;
    }
    return `
<section class="eb" data-fx="gallery-edge-blur">
  ${s.title || s.intro ? `<div class="eb__head">${s.title ? `<h2 class="display reveal">${esc(s.title)}</h2>` : ""}${s.intro ? `<p class="reveal">${esc(s.intro)}</p>` : ""}</div>` : ""}
  <div class="eb__gl"><canvas aria-hidden="true"></canvas></div>
  ${rows.map(row => `<div class="eb__row" data-n="${row.n}">${row.items.map(({ it, i }) => {
    const p = pic(it, s, i);
    const u = p ? imgUrl(p, 1400) : "";
    return `<figure class="eb__fig"><div class="eb__img">${u ? `<img src="${esc(u)}" alt="${esc(it.alt || p.alt || it.title || "")}" loading="lazy">` : ""}</div><figcaption class="eb__cap reveal">(${String(i + 1).padStart(2, "0")})${it.title ? ` ${esc(it.title)}` : ""}</figcaption></figure>`;
  }).join("")}</div>`).join("")}
</section>`;
  },
  js: () => `
import * as THREE from "three";
(function(){
  var sec = document.querySelector('[data-fx="gallery-edge-blur"]');
  if (!sec || !window.__fx.FX) return;
  var gl2 = null; try { gl2 = document.createElement('canvas').getContext('webgl2'); } catch (e) {}
  if (!gl2) return;
  var canvas = sec.querySelector('.eb__gl canvas');
  var figs = Array.prototype.slice.call(sec.querySelectorAll('.eb__img'));
  if (!canvas || !figs.length) return;
  var VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var FRAG = 'uniform sampler2D uMap; uniform vec2 uImg; uniform vec2 uPlane; uniform vec2 uRes; uniform float uTime; uniform float uStrength; varying vec2 vUv;'
    + 'float tvNoise(vec2 p, float ta, float tb){ return fract(sin(p.x*ta + p.y*tb) * 5678.0); }'
    + 'float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }'
    + 'void main(){'
    + 'vec2 ratio = vec2(min((uPlane.x/uPlane.y)/(uImg.x/uImg.y),1.0), min((uPlane.y/uPlane.x)/(uImg.y/uImg.x),1.0));'
    + 'vec2 uv = vec2(vUv.x*ratio.x + (1.0-ratio.x)*0.5, vUv.y*ratio.y + (1.0-ratio.y)*0.5);'
    + 'float ny = gl_FragCoord.y / uRes.y;'
    + 'float gradient = (smoothstep(0.3, 0.0, ny) + smoothstep(0.7, 1.0, ny)) * uStrength;'
    + 'vec3 acc = vec3(0.0); const float N = 14.0;'
    + 'for (float i = 0.0; i < N; i++) {'
    + '  float ang = (i / N) * 6.2831853; vec2 dir = vec2(cos(ang), sin(ang));'
    + '  vec2 q = dir * (rand(vec2(i, uv.x + uv.y)) + 0.08); acc += texture2D(uMap, uv + q * 0.08 * gradient).rgb;'
    + '  q = dir * (rand(vec2(i + 2.0, uv.x + uv.y + 24.0)) + 0.08); acc += texture2D(uMap, uv + q * 0.08 * gradient).rgb;'
    + '}'
    + 'vec3 col = acc / (2.0 * N);'
    + 'float t = uTime + 123.0; float ta = t * 0.654321; float tb = t * (ta * 0.123456);'
    + 'col -= (1.0 - tvNoise(uv, ta, tb)) * 0.08;'
    + 'gl_FragColor = vec4(col, 1.0); }';
  var renderer, scene, camera, items = [], started = false, active = false, raf = 0, W = 0, H = 0, res = null, t0 = 0;
  function size(){ W = window.innerWidth; H = window.innerHeight; renderer.setSize(W, H, true); camera.aspect = W / H; camera.fov = 2 * Math.atan(H / 2 / 1000) * 180 / Math.PI; camera.updateProjectionMatrix(); var dpr = renderer.getPixelRatio(); res.set(W * dpr, H * dpr); }
  function build(){
    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, 10, 2000); camera.position.z = 1000;
    res = new THREE.Vector2(1, 1);
    size();
    var geo = new THREE.PlaneGeometry(1, 1, 1, 1);
    var loader = new THREE.TextureLoader(); loader.crossOrigin = 'anonymous';
    figs.forEach(function(fig, i){
      var img = fig.querySelector('img'); if (!img) return;
      var u = { uMap: { value: null }, uImg: { value: new THREE.Vector2(1, 1) }, uPlane: { value: new THREE.Vector2(1, 1) }, uRes: { value: res }, uTime: { value: Math.random() * 100 }, uStrength: { value: i === 0 ? 0.2 : 1 } };
      var mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG });
      var mesh = new THREE.Mesh(geo, mat); mesh.visible = false; scene.add(mesh);
      var it = { el: fig, u: u, mesh: mesh, mat: mat, ready: false };
      loader.load(img.currentSrc || img.src, function(tex){ tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; u.uMap.value = tex; u.uImg.value.set(tex.image.width, tex.image.height); it.ready = true; fig.classList.add('is-gl'); });
      items.push(it);
      if (i === 0) gsap.to(u.uStrength, { value: 1, ease: 'power2.inOut', scrollTrigger: { trigger: fig, start: 'top 80%', end: 'top 20%', scrub: true } });
    });
    window.addEventListener('resize', size);
    window.addEventListener('pagehide', dispose, { once: true });
  }
  function frame(now){
    if (!active) return;
    raf = requestAnimationFrame(frame);
    var dt = t0 ? Math.min(0.1, (now - t0) / 1000) : 0; t0 = now;
    var cr = canvas.getBoundingClientRect();
    items.forEach(function(it){
      if (!it.ready) return;
      var r = it.el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > H) { it.mesh.visible = false; return; }
      it.mesh.visible = true;
      it.mesh.position.set(r.left - cr.left - W / 2 + r.width / 2, -(r.top - cr.top) + H / 2 - r.height / 2, 0);
      it.mesh.scale.set(r.width, r.height, 1);
      it.u.uPlane.value.set(r.width, r.height);
      it.u.uTime.value += dt * 2.4;
    });
    renderer.render(scene, camera);
  }
  function dispose(){ active = false; cancelAnimationFrame(raf); items.forEach(function(it){ it.mat.dispose(); if (it.u.uMap.value) it.u.uMap.value.dispose(); }); if (renderer) renderer.dispose(); }
  var io = new IntersectionObserver(function(es){
    es.forEach(function(en){
      if (en.isIntersecting) { if (!started) { started = true; build(); } active = true; t0 = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); }
      else { active = false; cancelAnimationFrame(raf); }
    });
  }, { rootMargin: '25% 0px' });
  io.observe(sec);
})();`,
};
export default c;
