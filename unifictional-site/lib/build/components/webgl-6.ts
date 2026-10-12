// @ts-nocheck
// webgl-6 · Pinned stage where each photo blooms from the centre with a smoky liquid edge as you scroll (Awwwards Pack, recreated from the preview video).
import type { Component } from "./_types";

const rgb = (col: string): number[] => {
  const m = String(col || "").match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) { let h = m[1]; if (h.length === 3) h = h.split("").map(x => x + x).join(""); const n = parseInt(h, 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
  const r = String(col || "").match(/rgba?\(([^)]+)\)/); if (r) { const p = r[1].split(",").map(Number); return [p[0] / 255, p[1] / 255, p[2] / 255]; }
  return [0.5, 0.5, 0.5];
};
const vec = (col: string) => rgb(col).map(v => v.toFixed(4)).join(",");

const c: Component = {
  id: "webgl-6",
  type: "liquid-reveal-6",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "(recreated from the preview video) liquid-reveal-6 (webgl-6): a pinned full-screen stage in the page colour with a small eyebrow and counter top-left. As you scroll, each photo blooms out of the centre of the screen: first a faint washed-out ellipse, then an expanding blob whose rim is torn into smoky, flame-like tendrils, until it fills the screen; the next photo then blooms over it the same way. Each photo's 1-4 word title and a short meta line appear bottom-left once it is full. Needs 3-6 photos. A dramatic reveal for portfolios, architecture, cars, fashion, restaurants and event venues; phones and reduced motion get the photos stacked with their captions.",
  fields: `{"type":"liquid-reveal-6","component":"webgl-6","eyebrow":"","items":[{"title":"","meta":"","query":"","alt":""},{"title":"","meta":"","query":"","alt":""},{"title":"","meta":"","query":"","alt":""}]}`,
  images: { min: 3, max: 6 },
  css: ({ pair, capsRule }) => `
.lr6{position:relative;height:calc((var(--n) + 0.6) * 100svh);background:var(--bg)}
.lr6__stage{position:sticky;top:0;height:100svh;overflow:hidden;background:var(--bg)}
.lr6__stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.lr6__head{position:absolute;top:clamp(5rem,12vh,7rem);left:var(--gutter);z-index:2;display:flex;gap:1.2rem;align-items:center;font-family:var(--mono);font-size:.66rem;letter-spacing:.16em;text-transform:uppercase;color:var(--ink2);mix-blend-mode:difference;color:#fff}
.lr6__caps{position:absolute;left:var(--gutter);right:var(--gutter);bottom:clamp(2rem,6vh,4rem);z-index:2;pointer-events:none}
.lr6__cap{position:absolute;left:0;bottom:0;display:grid;gap:.4rem;color:#fff;opacity:0;transform:translateY(14px);transition:opacity .6s var(--ease-out),transform .6s var(--ease-out);text-shadow:0 2px 24px rgba(0,0,0,.35)}
.lr6__cap.is-on{opacity:1;transform:none}
.lr6__cap h3{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};line-height:.95;font-size:clamp(2.2rem,5.5vw,5.5rem);${capsRule}}
.lr6__cap span{font-family:var(--mono);font-size:.66rem;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.75)}
.lr6__static{display:none}
.lr6.is-static{height:auto}
.lr6.is-static .lr6__stage{display:none}
.lr6.is-static .lr6__static{display:grid;gap:3rem;padding:clamp(4rem,10vh,7rem) var(--gutter)}
.lr6__static figure{display:grid;gap:.8rem}
.lr6__static img{width:100%;aspect-ratio:4/3;object-fit:cover}
.lr6__static figcaption{display:flex;justify-content:space-between;gap:1rem;align-items:baseline}
.lr6__static h3{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};font-size:clamp(1.6rem,4vw,3rem);line-height:1;${capsRule}}
.lr6__static span{font-family:var(--mono);font-size:.66rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .lr6{height:auto}
  .lr6__stage{display:none}
  .lr6__static{display:grid;gap:3rem;padding:clamp(4rem,10vh,7rem) var(--gutter)}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).filter(it => it && it.image).slice(0, 6);
    const n = items.length;
    return `
<section class="lr6" data-fx="liquid-reveal-6" style="--n:${n}">
  <div class="lr6__stage">
    <canvas aria-hidden="true"></canvas>
    <div class="lr6__head">${s.eyebrow ? `<span>${esc(s.eyebrow)}</span>` : ""}<span class="lr6__count">01 / ${String(n).padStart(2, "0")}</span></div>
    <div class="lr6__caps">${items.map((it, i) => `<div class="lr6__cap" data-src="${esc(imgUrl(it.image, 1800))}"><h3>${esc(it.title)}</h3>${it.meta ? `<span>${esc(it.meta)}</span>` : ""}</div>`).join("")}</div>
  </div>
  <div class="lr6__static">${items.map(it => `<figure><img src="${esc(imgUrl(it.image, 1200))}" alt="${esc(it.image?.alt || it.title || "")}" loading="lazy"><figcaption><h3>${esc(it.title)}</h3>${it.meta ? `<span>${esc(it.meta)}</span>` : ""}</figcaption></figure>`).join("")}</div>
</section>`;
  },
  js: ({ t }) => `
import * as THREE from "three";
(function(){
  var el = document.querySelector('[data-fx="liquid-reveal-6"]'); if (!el) return;
  var fx = window.__fx || {};
  function glOK(){ try { var c = document.createElement('canvas'); var g = c.getContext('webgl2'); if (!g) return false; var x = g.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); return true; } catch (e) { return false; } }
  var caps = Array.prototype.slice.call(el.querySelectorAll('.lr6__cap'));
  if (!fx.FX || !glOK() || caps.length < 1) { el.classList.add('is-static'); return; }
  var stage = el.querySelector('.lr6__stage'), canvas = stage.querySelector('canvas'), count = el.querySelector('.lr6__count');
  var srcs = caps.map(function(c){ return c.getAttribute('data-src'); }), n = srcs.length;
  var renderer, scene, camera, mat, geo, mesh, raf = 0, started = false, visible = false, ro, st, textures = [], W = 1, H = 1, P = 0, curCap = -1;
  var clock = new THREE.Clock(false);
  var VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var FRAG = [
    'precision highp float;',
    'uniform sampler2D uTexA; uniform sampler2D uTexB; uniform vec2 uResA; uniform vec2 uResB; uniform vec2 uRes; uniform float uProgress; uniform float uTime; uniform float uHasA; uniform vec3 uBg; varying vec2 vUv;',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }',
    'float noise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }',
    'float fbm(vec2 p){ float v = 0.0; v += noise(p) * 0.5; v += noise(p * 2.07) * 0.25; v += noise(p * 4.13) * 0.125; v += noise(p * 8.3) * 0.0625; return v; }',
    'vec2 cover(vec2 uv, vec2 plane, vec2 tex){ float s = max(plane.x / tex.x, plane.y / tex.y); vec2 ns = tex * s; return uv * (plane / ns) + (ns - plane) / 2.0 / ns; }',
    'void main(){',
    '  vec2 uv = vUv; float aspect = uRes.x / uRes.y; float p = uProgress;',
    '  vec2 cuv = (uv - 0.5) * vec2(aspect, 1.0);',
    '  float d = length(cuv * vec2(1.0, 1.25));',
    '  float maxD = length(vec2(aspect * 0.5, 0.5 * 1.25));',
    '  float n = fbm(cuv * 3.2 + uTime * 0.12);',
    '  float n2 = fbm(cuv * 7.0 - uTime * 0.08 + 5.3);',
    '  float r = p * (maxD + 0.35);',
    '  float tendril = (n - 0.45) * 0.7 * (1.0 - p) + (n2 - 0.45) * 0.35 * (1.0 - p);',
    '  float mask = smoothstep(r + 0.22, r - 0.04, d + tendril) * smoothstep(0.0, 0.06, p);',
    '  vec2 warp = (vec2(n, n2) - 0.45) * 0.14 * (1.0 - p) * (1.0 - mask);',
    '  vec3 b = texture2D(uTexB, cover(uv + warp, uRes, uResB)).rgb;',
    '  float pale = smoothstep(0.0, 0.55, p);',
    '  b = mix(uBg, b, 0.25 + 0.75 * pale);',
    '  vec3 a = mix(uBg, texture2D(uTexA, cover(uv, uRes, uResA)).rgb, uHasA);',
    '  float glow = smoothstep(r + 0.5, r + 0.1, d + tendril) * (1.0 - mask) * (1.0 - p) * 0.35;',
    '  vec3 col = mix(a, b, mask);',
    '  col = mix(col, mix(uBg, vec3(1.0), 0.5), glow * (1.0 - uHasA));',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\\n');
  function setTex(k, tex){ var u = mat.uniforms; u[k === 0 ? 'uTexA' : 'uTexB'].value = tex; if (tex && tex.image && tex.image.width) u[k === 0 ? 'uResA' : 'uResB'].value.set(tex.image.width, tex.image.height); }
  function apply(){
    if (!textures.length) return;
    var pt = Math.min(P * (n + 0.6), n - 0.0001), idx = Math.floor(pt), local = Math.min(1, pt - idx);
    setTex(1, textures[idx]);
    if (idx > 0) { setTex(0, textures[idx - 1]); mat.uniforms.uHasA.value = 1; } else { mat.uniforms.uHasA.value = 0; }
    mat.uniforms.uProgress.value = local;
    var cur = local > 0.55 ? idx : idx - 1;
    if (cur !== curCap) { curCap = cur; caps.forEach(function(c, i){ c.classList.toggle('is-on', i === cur); }); if (count) count.textContent = String(Math.max(0, cur) + 1).padStart(2, '0') + ' / ' + String(n).padStart(2, '0'); }
  }
  function size(){
    W = stage.clientWidth || 1; H = stage.clientHeight || 1;
    renderer.setSize(W, H, false);
    camera.left = -W / 2; camera.right = W / 2; camera.top = H / 2; camera.bottom = -H / 2; camera.updateProjectionMatrix();
    mesh.scale.set(W, H, 1);
    mat.uniforms.uRes.value.set(W, H);
  }
  function tick(){ raf = 0; if (!visible) return; mat.uniforms.uTime.value += clock.getDelta(); apply(); renderer.render(scene, camera); raf = requestAnimationFrame(tick); }
  function play(){ if (!raf && started) { clock.start(); raf = requestAnimationFrame(tick); } }
  function pause(){ if (raf) { cancelAnimationFrame(raf); raf = 0; clock.stop(); } }
  function load(url){ return new Promise(function(res){ var l = new THREE.TextureLoader(); l.setCrossOrigin('anonymous'); l.load(url, function(tx){ tx.minFilter = THREE.LinearFilter; tx.generateMipmaps = false; res(tx); }, undefined, function(){ res(null); }); }); }
  function init(){
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    geo = new THREE.PlaneGeometry(1, 1);
    mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: {
      uTexA: { value: null }, uTexB: { value: null }, uResA: { value: new THREE.Vector2(1, 1) }, uResB: { value: new THREE.Vector2(1, 1) }, uRes: { value: new THREE.Vector2(1, 1) },
      uProgress: { value: 0 }, uTime: { value: 0 }, uHasA: { value: 0 }, uBg: { value: new THREE.Vector3(${vec(t.bg)}) } } });
    mesh = new THREE.Mesh(geo, mat); scene.add(mesh);
    size();
    ro = new ResizeObserver(size); ro.observe(stage);
    Promise.all(srcs.map(load)).then(function(list){
      var blank = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1); blank.needsUpdate = true;
      textures = list.map(function(tx){ return tx || blank; });
      el.classList.add('is-gl'); apply();
    });
    st = ScrollTrigger.create({ trigger: el, start: 'top top', end: 'bottom bottom', scrub: true, onUpdate: function(self){ P = self.progress; } });
  }
  var io = new IntersectionObserver(function(es){ es.forEach(function(en){ visible = en.isIntersecting; if (visible) { if (!started) { started = true; init(); } play(); } else pause(); }); }, { rootMargin: '10% 0px' });
  io.observe(el);
  window.addEventListener('pagehide', function(){ pause(); io.disconnect(); if (ro) ro.disconnect(); if (st) st.kill(); if (renderer) { geo.dispose(); mat.dispose(); textures.forEach(function(tx){ tx.dispose(); }); renderer.dispose(); } });
})();`,
};
export default c;
