// @ts-nocheck
// webgl-9 · A photo drawn as thousands of shimmering dots that scatter from the cursor's trail and reform (Awwwards Pack).
import type { Component } from "./_types";

const rgb = (col: string): number[] => {
  const m = String(col || "").match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) { let h = m[1]; if (h.length === 3) h = h.split("").map(x => x + x).join(""); const n = parseInt(h, 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
  const r = String(col || "").match(/rgba?\(([^)]+)\)/); if (r) { const p = r[1].split(",").map(Number); return [p[0] / 255, p[1] / 255, p[2] / 255]; }
  return [0.5, 0.5, 0.5];
};
const vec = (col: string) => rgb(col).map(v => v.toFixed(4)).join(",");

const c: Component = {
  id: "webgl-9",
  type: "particle-portrait-9",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "particle-portrait-9 (webgl-9): a two-column band: eyebrow, a 2-6 word headline and one short paragraph on the left, and on the right one photo redrawn as a field of about 40,000 soft dots in the ink colour, one per pixel, which shimmer gently in size and depth. When the section scrolls in the dots fly in from a scattered cloud and assemble into the picture; moving the cursor over it pushes the dots outward along a fading trail, and a click blows the picture apart and reassembles it. Needs one photo with a clear subject on a plain background (a portrait, a product, a building, a logo mark). A signature 'about' or hero-adjacent moment for studios, personal brands, tech and product companies; phones and reduced motion show the plain photo beside the text.",
  fields: `{"type":"particle-portrait-9","component":"webgl-9","eyebrow":"","headline":"","text":"","image":{"query":"","alt":""}}`,
  images: { min: 1, max: 1 },
  css: ({ pair, capsRule }) => `
.pp9{display:grid;grid-template-columns:5fr 7fr;min-height:100svh;background:var(--bg)}
.pp9__copy{display:grid;align-content:center;gap:1.4rem;padding:clamp(5rem,12vh,8rem) clamp(1.5rem,3vw,3rem) clamp(5rem,12vh,8rem) var(--gutter)}
.pp9__eyebrow{font-family:var(--mono);font-size:.68rem;letter-spacing:.16em;text-transform:uppercase;color:var(--ink2)}
.pp9__copy h2{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};line-height:.95;font-size:clamp(2.4rem,5vw,5.5rem);max-width:12ch;${capsRule}}
.pp9__copy p{max-width:44ch;color:var(--ink2);font-size:1.05rem;line-height:1.6}
.pp9__stage{position:relative;min-height:100svh;overflow:hidden;background:var(--bg);cursor:crosshair}
.pp9__stage img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:opacity .6s}
.pp9__stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.pp9.is-gl .pp9__stage img{opacity:0}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .pp9{grid-template-columns:1fr;min-height:0}
  .pp9__copy{padding:5rem var(--gutter) 2.5rem}
  .pp9__stage{min-height:0;aspect-ratio:4/5;cursor:auto}
  .pp9__stage canvas{display:none}
  .pp9.is-gl .pp9__stage img{opacity:1}
}`,
  html: (s, { esc, imgUrl }) => `
<section class="pp9" data-fx="particle-portrait-9">
  <div class="pp9__copy">
    ${s.eyebrow ? `<span class="pp9__eyebrow">${esc(s.eyebrow)}</span>` : ""}
    <h2>${esc(s.headline)}</h2>
    ${s.text ? `<p>${esc(s.text)}</p>` : ""}
  </div>
  <div class="pp9__stage">
    <img src="${esc(imgUrl(s.image, 1200))}" alt="${esc(s.image?.alt || "")}" loading="lazy" data-src="${esc(imgUrl(s.image, 800))}">
    <canvas aria-hidden="true"></canvas>
  </div>
</section>`,
  js: ({ t }) => `
import * as THREE from "three";
(function(){
  var el = document.querySelector('[data-fx="particle-portrait-9"]'); if (!el) return;
  var fx = window.__fx || {};
  function glOK(){ try { var c = document.createElement('canvas'); var g = c.getContext('webgl2'); if (!g) return false; var x = g.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); return true; } catch (e) { return false; } }
  if (!fx.FX || !glOK()) { el.classList.add('is-static'); return; }
  var stage = el.querySelector('.pp9__stage'), canvas = stage.querySelector('canvas'), img = stage.querySelector('img');
  var renderer, scene, camera, mat, geo, mesh, hit, raf = 0, started = false, visible = false, ro, ready = false;
  var W = 1, H = 1, iw = 1, ih = 1, fovH = 1, clock = new THREE.Clock(false), raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  var touch = { size: 64, maxAge: 120, radius: 0.15, trail: [], canvas: null, ctx: null, tex: null };
  var VERT = [
    'attribute float pindex; attribute vec3 offset; attribute float angle; attribute float aGrey;',
    'uniform float uTime; uniform float uRandom; uniform float uDepth; uniform float uSize; uniform vec2 uTextureSize; uniform sampler2D uTouch;',
    'varying vec2 vUv; varying float vGrey;',
    'vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; } vec2 mod289(vec2 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; } vec3 permute(vec3 x){ return mod289(((x * 34.0) + 1.0) * x); }',
    'float snoise(vec2 v){ const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439); vec2 i = floor(v + dot(v, C.yy)); vec2 x0 = v - i + dot(i, C.xx); vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0); vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1; i = mod289(i); vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0)); vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0); m = m * m; m = m * m; vec3 x = 2.0 * fract(p * C.www) - 1.0; vec3 h = abs(x) - 0.5; vec3 ox = floor(x + 0.5); vec3 a0 = x - ox; m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h); vec3 g; g.x = a0.x * x0.x + h.x * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw; return 130.0 * dot(m, g); }',
    'float random(float n){ return fract(sin(n) * 43758.5453123); }',
    'void main(){',
    '  vUv = uv; vGrey = aGrey;',
    '  vec2 puv = (offset.xy + 0.5) / uTextureSize;',
    '  vec3 displaced = offset;',
    '  displaced.xy += vec2(random(pindex) - 0.5, random(offset.x + pindex) - 0.5) * uRandom;',
    '  float rndz = (random(pindex) + snoise(vec2(pindex * 0.1, uTime * 0.1)));',
    '  displaced.z += rndz * (random(pindex) * 2.0 * uDepth);',
    '  displaced.xy -= uTextureSize * 0.5;',
    '  float t = texture2D(uTouch, puv).r;',
    '  displaced.z += t * 20.0 * rndz; displaced.x += cos(angle) * t * 20.0 * rndz; displaced.y += sin(angle) * t * 20.0 * rndz;',
    '  float psize = (snoise(vec2(uTime, pindex) * 0.5) * 0.5 + 1.25); psize *= max(aGrey, 0.15); psize *= uSize;',
    '  vec4 mv = modelViewMatrix * vec4(displaced, 1.0); mv.xyz += position * psize;',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\\n');
  var FRAG = [
    'precision highp float; uniform vec3 uInk; uniform vec3 uBg; varying vec2 vUv; varying float vGrey;',
    'void main(){ float d = 0.5 - distance(vUv, vec2(0.5)); float a = smoothstep(0.0, 0.3, d); vec3 col = mix(uBg, uInk, 0.12 + 0.88 * vGrey); gl_FragColor = vec4(col, a); }'
  ].join('\\n');
  function initTouch(){
    touch.canvas = document.createElement('canvas'); touch.canvas.width = touch.canvas.height = touch.size; touch.ctx = touch.canvas.getContext('2d');
    touch.ctx.fillStyle = '#000'; touch.ctx.fillRect(0, 0, touch.size, touch.size);
    touch.tex = new THREE.CanvasTexture(touch.canvas); touch.tex.minFilter = THREE.LinearFilter; touch.tex.magFilter = THREE.LinearFilter; touch.tex.generateMipmaps = false;
  }
  function easeOutSine(x){ return Math.sin(x * Math.PI / 2); }
  function touchUpdate(){
    var ctx = touch.ctx, S = touch.size; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
    for (var i = touch.trail.length - 1; i >= 0; i--) { var p = touch.trail[i]; p.age++; if (p.age > touch.maxAge) touch.trail.splice(i, 1); }
    touch.trail.forEach(function(p){
      var x = p.x * S, y = (1 - p.y) * S, inten = p.age < touch.maxAge * 0.3 ? easeOutSine(p.age / (touch.maxAge * 0.3)) : easeOutSine(1 - (p.age - touch.maxAge * 0.3) / (touch.maxAge * 0.7));
      inten *= p.force; var r = S * touch.radius * inten; if (r <= 0.5) return;
      var g = ctx.createRadialGradient(x, y, r * 0.25, x, y, r); g.addColorStop(0, 'rgba(255,255,255,0.2)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath(); ctx.fillStyle = g; ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    });
    touch.tex.needsUpdate = true;
  }
  function addTouch(x, y){ var force = 0, last = touch.trail[touch.trail.length - 1]; if (last) { var dx = last.x - x, dy = last.y - y; force = Math.min((dx * dx + dy * dy) * 10000, 1); } touch.trail.push({ x: x, y: y, age: 0, force: force }); }
  function build(image){
    var maxW = 260, s = Math.min(1, maxW / image.naturalWidth); iw = Math.max(2, Math.round(image.naturalWidth * s)); ih = Math.max(2, Math.round(image.naturalHeight * s));
    if (iw * ih > 70000) { var k = Math.sqrt(70000 / (iw * ih)); iw = Math.floor(iw * k); ih = Math.floor(ih * k); }
    var cv = document.createElement('canvas'); cv.width = iw; cv.height = ih; var ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, iw, ih);
    var data; try { data = ctx.getImageData(0, 0, iw, ih).data; } catch (e) { el.classList.add('is-static'); return false; }
    var n = iw * ih, offsets = new Float32Array(n * 3), idx = new Float32Array(n), ang = new Float32Array(n), grey = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var x = i % iw, row = Math.floor(i / iw), y = ih - 1 - row, p = (row * iw + x) * 4;
      var l = (data[p] * 0.21 + data[p + 1] * 0.71 + data[p + 2] * 0.07) / 255;
      offsets[i * 3] = x; offsets[i * 3 + 1] = y; offsets[i * 3 + 2] = 0; idx[i] = i; ang[i] = Math.random() * Math.PI; grey[i] = ${t.dark ? "l" : "1 - l"};
    }
    var plane = new THREE.PlaneGeometry(1, 1);
    geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index; geo.setAttribute('position', plane.getAttribute('position')); geo.setAttribute('uv', plane.getAttribute('uv'));
    geo.setAttribute('pindex', new THREE.InstancedBufferAttribute(idx, 1)); geo.setAttribute('offset', new THREE.InstancedBufferAttribute(offsets, 3));
    geo.setAttribute('angle', new THREE.InstancedBufferAttribute(ang, 1)); geo.setAttribute('aGrey', new THREE.InstancedBufferAttribute(grey, 1));
    geo.instanceCount = n;
    mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, depthTest: false, transparent: true, uniforms: {
      uTime: { value: 0 }, uRandom: { value: 1 }, uDepth: { value: 2 }, uSize: { value: 0 }, uTextureSize: { value: new THREE.Vector2(iw, ih) }, uTouch: { value: touch.tex },
      uInk: { value: new THREE.Vector3(${vec(t.ink)}) }, uBg: { value: new THREE.Vector3(${vec(t.bg)}) } } });
    mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; scene.add(mesh);
    hit = new THREE.Mesh(new THREE.PlaneGeometry(iw, ih), new THREE.MeshBasicMaterial({ visible: false })); scene.add(hit);
    return true;
  }
  function fit(){ if (!mesh) return; var fovW = fovH * (W / H), sc = Math.min(fovH / ih, fovW / iw) * 0.88; mesh.scale.set(sc, sc, 1); hit.scale.set(sc, sc, 1); }
  function size(){
    W = stage.clientWidth || 1; H = stage.clientHeight || 1;
    renderer.setSize(W, H, false);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    fovH = 2 * Math.tan((camera.fov * Math.PI) / 180 / 2) * camera.position.z;
    fit();
  }
  function show(){ gsap.fromTo(mat.uniforms.uSize, { value: 0.5 }, { value: 1.5, duration: 1 }); gsap.to(mat.uniforms.uRandom, { value: 2, duration: 1 }); gsap.fromTo(mat.uniforms.uDepth, { value: 40 }, { value: 4, duration: 1.5 }); }
  function hide(){ return new Promise(function(res){ gsap.to(mat.uniforms.uRandom, { value: 5, duration: 0.8, onComplete: res }); gsap.to(mat.uniforms.uDepth, { value: -20, duration: 0.8, ease: 'power2.in' }); gsap.to(mat.uniforms.uSize, { value: 0, duration: 0.64 }); }); }
  function tick(){ raf = 0; if (!visible) return; if (ready) { touchUpdate(); mat.uniforms.uTime.value += clock.getDelta(); renderer.render(scene, camera); } raf = requestAnimationFrame(tick); }
  function play(){ if (!raf && started) { clock.start(); raf = requestAnimationFrame(tick); } }
  function pause(){ if (raf) { cancelAnimationFrame(raf); raf = 0; clock.stop(); } }
  function init(){
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, 1, 1, 10000); camera.position.z = 300;
    initTouch();
    var im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = function(){ if (!build(im)) return; size(); ready = true; el.classList.add('is-gl'); show(); };
    im.onerror = function(){ el.classList.add('is-static'); };
    im.src = img.getAttribute('data-src') || img.currentSrc || img.src;
    size();
    ro = new ResizeObserver(size); ro.observe(stage);
    stage.addEventListener('pointermove', function(e){
      if (!ready) return; var r = stage.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera); var hits = raycaster.intersectObject(hit); if (hits.length && hits[0].uv) addTouch(hits[0].uv.x, hits[0].uv.y);
    }, { passive: true });
    var busy = false;
    stage.addEventListener('click', function(){ if (!ready || busy) return; busy = true; hide().then(function(){ show(); busy = false; }); });
  }
  var io = new IntersectionObserver(function(es){ es.forEach(function(en){ visible = en.isIntersecting; if (visible) { if (!started) { started = true; init(); } play(); } else pause(); }); }, { rootMargin: '10% 0px' });
  io.observe(el);
  window.addEventListener('pagehide', function(){ pause(); io.disconnect(); if (ro) ro.disconnect(); if (renderer) { if (geo) geo.dispose(); if (mat) mat.dispose(); if (touch.tex) touch.tex.dispose(); renderer.dispose(); } });
})();`,
};
export default c;
