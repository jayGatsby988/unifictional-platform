// @ts-nocheck
// webgl-18 · Sticky full-screen image that melts into the next with liquid displacement, zoom and RGB split as each label scrolls in (Awwwards Pack).
import type { Component } from "./_types";

const c: Component = {
  id: "webgl-18",
  type: "sticky-morph-18",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "sticky-morph-18 (webgl-18): a pinned storytelling section. One full-bleed photo sticks to the screen while 3-5 big labels scroll over it, each with a 1-4 word title and one short line (8-20 words) plus a small index number. Every time the next label reaches the middle of the screen the photo melts into the next one in under a second: liquid noise warping, a slight zoom and a flash of red/blue colour fringing, then it settles sharp. Needs 3-5 photos with a title and a line each. Good for 'how we work' steps, a project story or three service pillars; phones and reduced motion get each photo stacked above its title and text.",
  fields: `{"type":"sticky-morph-18","component":"webgl-18","items":[{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""}]}`,
  images: { min: 3, max: 5 },
  css: ({ pair, capsRule }) => `
.sm18{position:relative;height:calc(var(--n) * 100svh);background:var(--bg)}
.sm18__stage{position:sticky;top:0;height:100svh;overflow:hidden;background:var(--inv-bg)}
.sm18__stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.sm18__poster{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:opacity .5s}
.sm18.is-gl .sm18__poster{opacity:0}
.sm18__shade{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.55),rgba(0,0,0,.05) 50%,rgba(0,0,0,.25));pointer-events:none}
.sm18__labels{position:absolute;inset:0;z-index:2;pointer-events:none}
.sm18__item{height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:1rem;padding:0 var(--gutter);color:#fff}
.sm18__item img{display:none}
.sm18__item .mono{color:rgba(255,255,255,.7)}
.sm18__item h3{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};line-height:.92;font-size:clamp(3rem,10vw,10rem);max-width:12ch;${capsRule}}
.sm18__item p{max-width:46ch;color:rgba(255,255,255,.82);font-size:clamp(1rem,1.3vw,1.2rem)}
.sm18.is-static{height:auto}
.sm18.is-static .sm18__stage{display:none}
.sm18.is-static .sm18__labels{position:relative;inset:auto;pointer-events:auto}
.sm18.is-static .sm18__item{height:auto;align-items:flex-start;text-align:left;padding:3rem var(--gutter);color:var(--ink);gap:.8rem}
.sm18.is-static .sm18__item img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;margin-bottom:1rem}
.sm18.is-static .sm18__item .mono{color:var(--ink2)}
.sm18.is-static .sm18__item p{color:var(--ink2)}
.sm18.is-static .sm18__item h3{font-size:clamp(2.4rem,8vw,5rem)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .sm18{height:auto}
  .sm18__stage{display:none}
  .sm18__labels{position:relative;inset:auto;pointer-events:auto}
  .sm18__item{height:auto;align-items:flex-start;text-align:left;padding:3rem var(--gutter);color:var(--ink);gap:.8rem}
  .sm18__item img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;margin-bottom:1rem}
  .sm18__item .mono,.sm18__item p{color:var(--ink2)}
  .sm18__item h3{font-size:clamp(2.4rem,8vw,5rem)}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).filter(it => it && it.image).slice(0, 5);
    return `
<section class="sm18" data-fx="sticky-morph-18" style="--n:${items.length}">
  <div class="sm18__stage">
    ${items[0] ? `<img class="sm18__poster" src="${esc(imgUrl(items[0].image, 1800))}" alt="${esc(items[0].image?.alt || items[0].title || "")}" loading="lazy">` : ""}
    <canvas aria-hidden="true"></canvas>
    <div class="sm18__shade"></div>
  </div>
  <div class="sm18__labels">${items.map((it, i) => `
    <div class="sm18__item" data-src="${esc(imgUrl(it.image, 1800))}">
      <img src="${esc(imgUrl(it.image, 1200))}" alt="${esc(it.image?.alt || it.title || "")}" loading="lazy">
      <span class="mono">${String(i + 1).padStart(2, "0")} / ${String(items.length).padStart(2, "0")}</span>
      <h3>${esc(it.title)}</h3>
      ${it.text ? `<p>${esc(it.text)}</p>` : ""}
    </div>`).join("")}
  </div>
</section>`;
  },
  js: () => `
import * as THREE from "three";
(function(){
  var el = document.querySelector('[data-fx="sticky-morph-18"]'); if (!el) return;
  var fx = window.__fx || {};
  function glOK(){ try { var c = document.createElement('canvas'); var g = c.getContext('webgl2'); if (!g) return false; var x = g.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); return true; } catch (e) { return false; } }
  var items = el.querySelectorAll('.sm18__item');
  if (!fx.FX || !glOK() || items.length < 2) { el.classList.add('is-static'); return; }
  var stage = el.querySelector('.sm18__stage'), canvas = stage.querySelector('canvas');
  var srcs = Array.prototype.map.call(items, function(it){ return it.getAttribute('data-src'); });
  var renderer, scene, camera, mat, geo, mesh, raf = 0, started = false, visible = false, ro, st, textures = [], current = 0, target = 0, busy = false, ready = false;
  var W = 1, H = 1;
  var VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var FRAG = [
    'precision highp float;',
    'uniform sampler2D u_texture0; uniform sampler2D u_texture1; uniform float u_progress; uniform float u_strength; uniform float u_rgbShift; uniform float u_scale;',
    'uniform vec2 u_resolution; uniform vec2 u_textureResolution0; uniform vec2 u_textureResolution1; varying vec2 vUv;',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }',
    'float noise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }',
    'float fbm(vec2 p){ float v = 0.0; v += noise(p) * 0.5; v += noise(p * 2.03) * 0.25; v += noise(p * 4.1) * 0.125; v += noise(p * 8.2) * 0.0625; return v; }',
    'vec2 coverUV(vec2 uv, vec2 planeRes, vec2 texRes){ float s = max(planeRes.x / texRes.x, planeRes.y / texRes.y); vec2 ns = texRes * s; return uv * (planeRes / ns) + (ns - planeRes) / 2.0 / ns; }',
    'void main(){',
    '  float disp = fbm(vUv * vec2(u_resolution.x / u_resolution.y, 1.0) * 3.0 + 2.7);',
    '  disp = mix(disp, disp * (sin(vUv.y * 10.0 + u_progress * 6.28) * 0.5 + 0.5), 0.3);',
    '  vec2 uv0 = coverUV(vUv, u_resolution, u_textureResolution0);',
    '  vec2 uv1 = coverUV(vUv, u_resolution, u_textureResolution1);',
    '  float scaleEffect = 1.0 + u_progress * (1.0 - u_progress) * u_scale;',
    '  vec2 center = vec2(0.5);',
    '  vec2 d0 = (uv0 - center) / scaleEffect + center + u_progress * disp * u_strength * vec2(1.0, 0.5);',
    '  vec2 d1 = (uv1 - center) * scaleEffect + center - (1.0 - u_progress) * disp * u_strength * vec2(1.0, 0.5);',
    '  float o = u_progress * (1.0 - u_progress) * u_rgbShift;',
    '  vec4 t0 = vec4(texture2D(u_texture0, d0 + vec2(o, 0.0)).r, texture2D(u_texture0, d0).g, texture2D(u_texture0, d0 - vec2(o, 0.0)).b, 1.0);',
    '  vec4 t1 = vec4(texture2D(u_texture1, d1 + vec2(o, 0.0)).r, texture2D(u_texture1, d1).g, texture2D(u_texture1, d1 - vec2(o, 0.0)).b, 1.0);',
    '  gl_FragColor = mix(t0, t1, smoothstep(0.0, 1.0, u_progress));',
    '}'
  ].join('\\n');
  function setRes(i, tex){ if (tex && tex.image && tex.image.width) mat.uniforms['u_textureResolution' + i].value.set(tex.image.width, tex.image.height); }
  function transitionTo(i){
    target = i;
    if (!ready || busy || i === current || i < 0 || i >= textures.length) return;
    busy = true;
    mat.uniforms.u_texture1.value = textures[i]; setRes(1, textures[i]);
    gsap.to(mat.uniforms.u_progress, { value: 1, duration: 0.8, ease: 'power3.inOut', onComplete: function(){
      mat.uniforms.u_texture0.value = textures[i]; setRes(0, textures[i]); mat.uniforms.u_progress.value = 0; current = i; busy = false;
      if (target !== current) transitionTo(target);
    } });
  }
  function size(){
    W = stage.clientWidth || 1; H = stage.clientHeight || 1;
    renderer.setSize(W, H, false);
    camera.left = -W / 2; camera.right = W / 2; camera.top = H / 2; camera.bottom = -H / 2; camera.updateProjectionMatrix();
    mesh.scale.set(W, H, 1);
    mat.uniforms.u_resolution.value.set(W, H);
  }
  function tick(){ raf = 0; if (!visible) return; renderer.render(scene, camera); raf = requestAnimationFrame(tick); }
  function play(){ if (!raf && started) raf = requestAnimationFrame(tick); }
  function pause(){ if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  function load(url){ return new Promise(function(res){ var l = new THREE.TextureLoader(); l.setCrossOrigin('anonymous'); l.load(url, function(t){ t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; res(t); }, undefined, function(){ res(null); }); }); }
  function init(){
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    geo = new THREE.PlaneGeometry(1, 1);
    mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: {
      u_texture0: { value: null }, u_texture1: { value: null }, u_progress: { value: 0 }, u_resolution: { value: new THREE.Vector2(1, 1) },
      u_textureResolution0: { value: new THREE.Vector2(1, 1) }, u_textureResolution1: { value: new THREE.Vector2(1, 1) },
      u_strength: { value: 0.8 }, u_rgbShift: { value: 0.05 }, u_scale: { value: 0.15 } } });
    mesh = new THREE.Mesh(geo, mat); scene.add(mesh);
    size();
    ro = new ResizeObserver(size); ro.observe(stage);
    Promise.all(srcs.map(load)).then(function(list){
      textures = list.filter(Boolean); if (textures.length < 2) return;
      mat.uniforms.u_texture0.value = textures[0]; mat.uniforms.u_texture1.value = textures[0]; setRes(0, textures[0]); setRes(1, textures[0]);
      ready = true; el.classList.add('is-gl');
      if (target !== current) transitionTo(target);
    });
    st = ScrollTrigger.create({ trigger: el, start: 'top top', end: 'bottom bottom', scrub: true, onUpdate: function(self){ transitionTo(Math.round(self.progress * (srcs.length - 1))); } });
  }
  var io = new IntersectionObserver(function(es){ es.forEach(function(en){ visible = en.isIntersecting; if (visible) { if (!started) { started = true; init(); } play(); } else pause(); }); }, { rootMargin: '10% 0px' });
  io.observe(el);
  window.addEventListener('pagehide', function(){ pause(); io.disconnect(); if (ro) ro.disconnect(); if (st) st.kill(); if (renderer) { geo.dispose(); mat.dispose(); textures.forEach(function(t){ t.dispose(); }); renderer.dispose(); } });
})();`,
};
export default c;
