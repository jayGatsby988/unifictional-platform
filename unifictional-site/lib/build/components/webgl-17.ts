// @ts-nocheck
// webgl-17 · Hero photo that dissolves through a ragged noise edge into the page colour as you scroll, words fading in on the colour (Awwwards Pack).
import type { Component } from "./_types";

const rgb = (col: string): number[] => {
  const m = String(col || "").match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) { let h = m[1]; if (h.length === 3) h = h.split("").map(x => x + x).join(""); const n = parseInt(h, 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
  const r = String(col || "").match(/rgba?\(([^)]+)\)/); if (r) { const p = r[1].split(",").map(Number); return [p[0] / 255, p[1] / 255, p[2] / 255]; }
  return [0.5, 0.5, 0.5];
};
const vec = (col: string) => rgb(col).map(v => v.toFixed(4)).join(",");

const c: Component = {
  id: "webgl-17",
  type: "hero-noise-dissolve-17",
  kind: "hero",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "hero-noise-dissolve-17 (webgl-17): a tall hero (about 1.85 screens) with one full-bleed photo and a huge centred 1-3 word headline over it, eyebrow above. As you scroll, the page colour climbs up through the photo with a torn, grainy noise edge until the picture is gone; on the solid colour a centred sentence (the sub, 10-30 words) fades in word by word, followed by the button. The hero literally dissolves into the next section. Needs one strong photo. Suits outdoor, landscape, hospitality, craft and heritage brands with an atmospheric image; phones and reduced motion get the photo with the headline, then the sentence and button on the page colour.",
  fields: `{"type":"hero-noise-dissolve-17","component":"webgl-17","eyebrow":"","headline":"","sub":"","cta":{"label":"","href":"contact"},"image":{"query":"","alt":""}}`,
  images: { min: 1, max: 1 },
  css: ({ pair, capsRule }) => `
.hn17{position:relative;height:185svh;overflow:clip;background:var(--bg)}
.hn17__bg{position:absolute;inset:0}
.hn17__bg img{width:100%;height:100%;object-fit:cover}
.hn17__bg::after{content:"";position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,.42),rgba(0,0,0,.12) 55%,rgba(0,0,0,.3))}
.hn17__sticky{position:sticky;top:0;height:100svh;z-index:1;pointer-events:none}
.hn17__sticky canvas{width:100%;height:100%;display:block}
.hn17__top{position:absolute;top:0;left:0;right:0;height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;z-index:2;color:#fff;padding:0 var(--gutter);gap:1.2rem;pointer-events:none}
.hn17__eyebrow{font-family:var(--mono);font-size:.68rem;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.75)}
.hn17__top h1{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};line-height:.9;font-size:clamp(3.2rem,13vw,15rem);max-width:12ch;${capsRule}}
.hn17__content{position:absolute;left:0;right:0;bottom:0;height:85svh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;z-index:2;padding:0 var(--gutter);gap:2.2rem}
.hn17__sentence{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};font-size:clamp(1.5rem,3.4vw,3.3rem);line-height:1.15;max-width:30ch;color:var(--ink);${capsRule}}
.hn17__sentence .w{display:inline-block;opacity:.12;will-change:opacity}
.hn17__cta{opacity:0;transform:translateY(12px)}
.hn17__scroll{position:absolute;right:var(--gutter);bottom:2rem;z-index:3;font-family:var(--mono);font-size:.65rem;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.7);display:flex;align-items:center;gap:.8rem;height:100svh;align-items:flex-end;top:0;pointer-events:none}
.hn17__scroll span{display:flex;align-items:center;gap:.8rem;padding-bottom:2rem}
.hn17__scroll i{width:1px;height:48px;background:currentColor;opacity:.5;display:block}
.hn17.is-static .hn17__sticky,.hn17.is-static .hn17__scroll{display:none}
.hn17.is-static .hn17__sentence .w,.hn17.is-static .hn17__cta{opacity:1;transform:none}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .hn17{height:auto}
  .hn17__bg{position:relative;height:72svh;min-height:420px}
  .hn17__sticky,.hn17__scroll{display:none}
  .hn17__top{height:72svh;min-height:420px}
  .hn17__top h1{font-size:clamp(3rem,16vw,8rem)}
  .hn17__content{position:relative;height:auto;padding:4rem var(--gutter) 5rem;gap:2rem}
  .hn17__sentence .w,.hn17__cta{opacity:1;transform:none}
}`,
  html: (s, { esc, imgUrl, link, arrow }) => {
    const words = String(s.sub || "").trim().split(/\s+/).filter(Boolean).map(w => `<span class="w">${esc(w)}</span>`).join(" ");
    return `
<section class="hn17" id="top" data-fx="hero-noise-dissolve-17">
  <div class="hn17__bg"><img src="${esc(imgUrl(s.image, 2000))}" alt="${esc(s.image?.alt || "")}" fetchpriority="high"></div>
  <div class="hn17__sticky"><canvas class="hn17__canvas" aria-hidden="true"></canvas></div>
  <div class="hn17__top">
    ${s.eyebrow ? `<span class="hn17__eyebrow">${esc(s.eyebrow)}</span>` : ""}
    <h1>${esc(s.headline)}</h1>
  </div>
  <div class="hn17__scroll"><span>Scroll<i></i></span></div>
  <div class="hn17__content">
    <p class="hn17__sentence">${words}</p>
    ${s.cta && s.cta.label ? `<div class="hn17__cta"><a class="btn btn-primary" href="${esc(link(s.cta.href))}">${esc(s.cta.label)}${arrow}</a></div>` : ""}
  </div>
</section>`;
  },
  js: ({ t }) => `
import * as THREE from "three";
(function(){
  var el = document.querySelector('[data-fx="hero-noise-dissolve-17"]'); if (!el) return;
  var fx = window.__fx || {};
  function glOK(){ try { var c = document.createElement('canvas'); var g = c.getContext('webgl2'); if (!g) return false; var x = g.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); return true; } catch (e) { return false; } }
  if (!fx.FX || !glOK()) { el.classList.add('is-static'); return; }
  var canvas = el.querySelector('.hn17__canvas'), content = el.querySelector('.hn17__content'), words = el.querySelectorAll('.hn17__sentence .w'), cta = el.querySelector('.hn17__cta');
  var renderer, scene, camera, mat, geo, mesh, raf = 0, started = false, visible = false, ro;
  var W = 1, H = 1;
  var VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var FRAG = [
    'precision highp float;',
    'uniform float uProgress; uniform float uScroll; uniform float uVH; uniform float uHeroH; uniform vec2 uResolution; uniform vec3 uColor; uniform float uSpread; varying vec2 vUv;',
    'float Hash(vec2 p){ vec3 p2 = vec3(p.xy, 1.0); return fract(sin(dot(p2, vec3(37.1, 61.7, 12.4))) * 3758.5453123); }',
    'float noise(in vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f *= f * (3.0 - 2.0 * f); return mix(mix(Hash(i), Hash(i + vec2(1.0, 0.0)), f.x), mix(Hash(i + vec2(0.0, 1.0)), Hash(i + vec2(1.0, 1.0)), f.x), f.y); }',
    'float fbm(vec2 p){ float v = 0.0; v += noise(p) * 0.5; v += noise(p * 2.0) * 0.25; v += noise(p * 4.0) * 0.125; return v; }',
    'void main(){',
    '  float aspect = uResolution.x / uResolution.y;',
    '  float heroY = 1.0 - (uScroll + (1.0 - vUv.y) * uVH) / uHeroH;',
    '  vec2 centered = vec2((vUv.x - 0.5) * aspect, (heroY - 0.5) * (uHeroH / uResolution.y));',
    '  float d = heroY - uProgress * 1.2 + fbm(centered * 15.0) * uSpread;',
    '  float px = 1.5 / uHeroH;',
    '  float alpha = 1.0 - smoothstep(-px, px, d);',
    '  gl_FragColor = vec4(uColor, alpha);',
    '}'
  ].join('\\n');
  function size(){
    W = canvas.parentNode.clientWidth || 1; H = canvas.parentNode.clientHeight || 1;
    renderer.setSize(W, H, false);
    mat.uniforms.uResolution.value.set(W, H);
  }
  function wordsAt(p){
    var n = words.length;
    for (var i = 0; i < n; i++) { var a = i / n, b = (i + 1) / n, o = 0.12; if (p >= b) o = 1; else if (p >= a) o = 0.12 + 0.88 * ((p - a) / (b - a)); words[i].style.opacity = o.toFixed(3); }
    if (cta) { var q = Math.max(0, Math.min(1, (p - 0.85) / 0.15)); cta.style.opacity = q.toFixed(3); cta.style.transform = 'translateY(' + (12 * (1 - q)).toFixed(1) + 'px)'; }
  }
  function tick(){
    raf = 0; if (!visible) return;
    var r = el.getBoundingClientRect(), vh = window.innerHeight, heroH = r.height || 1;
    var sc = Math.max(0, Math.min(-r.top, heroH));
    var p = Math.min(sc / Math.max(1, heroH - vh), 1.1);
    mat.uniforms.uProgress.value = p; mat.uniforms.uScroll.value = sc; mat.uniforms.uVH.value = vh; mat.uniforms.uHeroH.value = heroH;
    var cr = content.getBoundingClientRect();
    var wp = Math.max(0, Math.min(1, (vh * 0.62 - cr.top) / Math.max(1, cr.height - vh * 0.38)));
    wordsAt(wp);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  function play(){ if (!raf && started) raf = requestAnimationFrame(tick); }
  function pause(){ if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  function init(){
    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    geo = new THREE.PlaneGeometry(2, 2);
    mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, uniforms: {
      uProgress: { value: 0 }, uScroll: { value: 0 }, uVH: { value: 1 }, uHeroH: { value: 1 }, uResolution: { value: new THREE.Vector2(1, 1) },
      uColor: { value: new THREE.Vector3(${vec(t.bg)}) }, uSpread: { value: 0.5 } } });
    mesh = new THREE.Mesh(geo, mat); scene.add(mesh);
    size();
    ro = new ResizeObserver(size); ro.observe(canvas.parentNode);
  }
  var io = new IntersectionObserver(function(es){ es.forEach(function(en){ visible = en.isIntersecting; if (visible) { if (!started) { started = true; init(); } play(); } else pause(); }); }, { rootMargin: '10% 0px' });
  io.observe(el);
  window.addEventListener('pagehide', function(){ pause(); io.disconnect(); if (ro) ro.disconnect(); if (renderer) { geo.dispose(); mat.dispose(); renderer.dispose(); } });
})();`,
};
export default c;
