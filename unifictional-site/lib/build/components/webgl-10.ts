// @ts-nocheck
// webgl-10 · Accent SDF shape behind a statement whose edge blurs near the cursor, plus a soft disc that follows it (Awwwards Pack).
import type { Component } from "./_types";

const rgb = (col: string): number[] => {
  const m = String(col || "").match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) { let h = m[1]; if (h.length === 3) h = h.split("").map(x => x + x).join(""); const n = parseInt(h, 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
  const r = String(col || "").match(/rgba?\(([^)]+)\)/); if (r) { const p = r[1].split(",").map(Number); return [p[0] / 255, p[1] / 255, p[2] / 255]; }
  return [0.5, 0.5, 0.5];
};
const vec = (col: string) => rgb(col).map(v => v.toFixed(4)).join(",");

const c: Component = {
  id: "webgl-10",
  type: "sdf-lens-10",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "sdf-lens-10 (webgl-10): a full-height statement band: eyebrow, a 3-8 word headline and one short paragraph (20-50 words) centred on the page colour, with an optional button. Behind the text a large geometric mark in the accent colour is drawn by a shader (a rounded frame outline by default; 'ring' or 'disc' as alternatives). Its edge is razor sharp except near the cursor, where it melts into a soft out-of-focus glow, and a second soft accent disc trails the pointer around the band. No images. A manifesto or 'why us' moment for studios, agencies, consultancies and tech brands; phones and reduced motion get the text over a soft static accent glow.",
  fields: `{"type":"sdf-lens-10","component":"webgl-10","eyebrow":"","headline":"","text":"","cta":{"label":"","href":""},"shape":"frame"}`,
  css: ({ pair, capsRule }) => `
.sl10{position:relative;min-height:100svh;display:grid;place-items:center;padding:clamp(5rem,12vh,8rem) var(--gutter);overflow:hidden;background:var(--bg)}
.sl10__canvas{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}
.sl10__blob{position:absolute;left:50%;top:50%;width:min(90vw,46rem);aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle,var(--accent) 0,transparent 62%);opacity:.3;display:none;pointer-events:none}
.sl10__inner{position:relative;z-index:1;text-align:center;display:grid;justify-items:center;gap:1.4rem;max-width:62rem}
.sl10__eyebrow{font-family:var(--mono);font-size:.68rem;letter-spacing:.16em;text-transform:uppercase;color:var(--ink2)}
.sl10__inner h2{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};line-height:.95;font-size:clamp(2.6rem,7vw,7.5rem);max-width:14ch;${capsRule}}
.sl10__inner p{max-width:52ch;color:var(--ink2);font-size:clamp(1.05rem,1.3vw,1.25rem);line-height:1.6}
.sl10.is-static .sl10__canvas{display:none}
.sl10.is-static .sl10__blob{display:block}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .sl10{min-height:0;padding:6rem var(--gutter)}
  .sl10__canvas{display:none}
  .sl10__blob{display:block}
}`,
  html: (s, { esc, link, arrow }) => {
    const shape = ["frame", "ring", "disc"].includes(s.shape) ? s.shape : "frame";
    return `
<section class="sl10" data-fx="sdf-lens-10" data-shape="${shape}">
  <canvas class="sl10__canvas" aria-hidden="true"></canvas>
  <div class="sl10__blob" aria-hidden="true"></div>
  <div class="sl10__inner">
    ${s.eyebrow ? `<span class="sl10__eyebrow">${esc(s.eyebrow)}</span>` : ""}
    <h2>${esc(s.headline)}</h2>
    ${s.text ? `<p>${esc(s.text)}</p>` : ""}
    ${s.cta && s.cta.label ? `<div><a class="btn btn-ghost" href="${esc(link(s.cta.href))}">${esc(s.cta.label)}${arrow}</a></div>` : ""}
  </div>
</section>`;
  },
  js: ({ t }) => `
import * as THREE from "three";
(function(){
  var el = document.querySelector('[data-fx="sdf-lens-10"]'); if (!el) return;
  var fx = window.__fx || {};
  function glOK(){ try { var c = document.createElement('canvas'); var g = c.getContext('webgl2'); if (!g) return false; var x = g.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); return true; } catch (e) { return false; } }
  if (!fx.FX || !glOK()) { el.classList.add('is-static'); return; }
  var canvas = el.querySelector('.sl10__canvas');
  var SHAPE = { frame: 0, ring: 1, disc: 2 }[el.getAttribute('data-shape')] || 0;
  var renderer, scene, camera, mat, geo, quad, raf = 0, started = false, visible = false, ro;
  var W = 1, H = 1, dpr = 1, last = 0, idleT = 0, hasPointer = false;
  var target = new THREE.Vector2(0, 0), mouse = new THREE.Vector2(0, 0), slow = new THREE.Vector2(0, 0), res = new THREE.Vector2(1, 1);
  var VERT = 'varying vec2 v_uv; void main(){ v_uv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var FRAG = [
    'precision highp float;',
    'uniform vec2 u_mouse; uniform vec2 u_slow; uniform vec2 u_resolution; uniform float u_pixelRatio; uniform vec3 u_color; uniform int u_shape;',
    '#define PI 3.1415926535897932',
    'vec2 coord(in vec2 p){ p = p / u_resolution.xy; if (u_resolution.x > u_resolution.y) { p.x *= u_resolution.x / u_resolution.y; p.x += (u_resolution.y - u_resolution.x) / u_resolution.y / 2.0; } else { p.y *= u_resolution.y / u_resolution.x; p.y += (u_resolution.x - u_resolution.y) / u_resolution.x / 2.0; } p -= 0.5; p *= vec2(-1.0, 1.0); return p; }',
    'float sdRoundRect(vec2 p, vec2 b, float r){ vec2 d = abs(p - 0.5) * 4.2 - b + vec2(r); return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r; }',
    'float sdCircle(in vec2 st, in vec2 c){ return length(st - c) * 2.0; }',
    'float fill(float x, float size, float edge){ return 1.0 - smoothstep(size - edge, size + edge, x); }',
    'float stroke(float x, float size, float w, float edge){ float d = smoothstep(size - edge, size + edge, x + w * 0.5) - smoothstep(size - edge, size + edge, x - w * 0.5); return clamp(d, 0.0, 1.0); }',
    'void main(){',
    '  vec2 st = coord(gl_FragCoord.xy) + 0.5;',
    '  vec2 posMouse = coord(u_mouse * u_pixelRatio) * vec2(1.0, -1.0) + 0.5;',
    '  vec2 posSlow = coord(u_slow * u_pixelRatio) * vec2(1.0, -1.0) + 0.5;',
    '  float lens = fill(sdCircle(st, posMouse), 0.3, 0.5);',
    '  float sdf = 0.0;',
    '  if (u_shape == 0) { sdf = sdRoundRect(st, vec2(1.2), 0.4); sdf = stroke(sdf, 0.0, 0.05, lens + 0.004) * 4.0; }',
    '  else if (u_shape == 1) { sdf = sdCircle(st, vec2(0.5)); sdf = stroke(sdf, 0.62, 0.025, lens + 0.004) * 4.0; }',
    '  else { sdf = sdCircle(st, vec2(0.5)); sdf = fill(sdf, 0.62, lens + 0.004) * 1.2; }',
    '  float blob = (1.0 - smoothstep(0.0, 0.34, length(st - posSlow))) * 0.55;',
    '  float a = clamp(max(min(sdf, 1.0), blob), 0.0, 1.0);',
    '  gl_FragColor = vec4(u_color, a);',
    '}'
  ].join('\\n');
  function size(){
    W = el.clientWidth || 1; H = el.clientHeight || 1; dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(dpr); renderer.setSize(W, H, false);
    camera.left = -W / 2; camera.right = W / 2; camera.top = H / 2; camera.bottom = -H / 2; camera.updateProjectionMatrix();
    quad.scale.set(W, H, 1);
    res.set(W, H).multiplyScalar(dpr); mat.uniforms.u_pixelRatio.value = dpr;
    if (!hasPointer) { target.set(W * 0.62, H * 0.42); mouse.copy(target); slow.copy(target); }
  }
  function damp(a, b, l, dt){ return THREE.MathUtils.damp(a, b, l, dt); }
  function tick(now){
    raf = 0; if (!visible) return;
    var dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    if (!hasPointer || now - idleT > 2600) { var tt = now * 0.00035; target.set(W * (0.5 + 0.28 * Math.cos(tt)), H * (0.5 + 0.26 * Math.sin(tt * 1.3))); }
    mouse.x = damp(mouse.x, target.x, 8, dt); mouse.y = damp(mouse.y, target.y, 8, dt);
    slow.x = damp(slow.x, target.x, 2.6, dt); slow.y = damp(slow.y, target.y, 2.6, dt);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  function play(){ if (!raf && started) { last = performance.now(); raf = requestAnimationFrame(tick); } }
  function pause(){ if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  function init(){
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, alpha: true, premultipliedAlpha: false, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000); camera.position.z = 1;
    geo = new THREE.PlaneGeometry(1, 1);
    mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, uniforms: {
      u_mouse: { value: mouse }, u_slow: { value: slow }, u_resolution: { value: res }, u_pixelRatio: { value: 1 },
      u_color: { value: new THREE.Vector3(${vec(t.accent)}) }, u_shape: { value: SHAPE } } });
    quad = new THREE.Mesh(geo, mat); scene.add(quad);
    size();
    ro = new ResizeObserver(size); ro.observe(el);
    el.addEventListener('pointermove', function(e){ var r = el.getBoundingClientRect(); target.set(e.clientX - r.left, e.clientY - r.top); hasPointer = true; idleT = performance.now(); }, { passive: true });
  }
  var io = new IntersectionObserver(function(es){ es.forEach(function(en){ visible = en.isIntersecting; if (visible) { if (!started) { started = true; init(); } play(); } else pause(); }); }, { rootMargin: '10% 0px' });
  io.observe(el);
  window.addEventListener('pagehide', function(){ pause(); io.disconnect(); if (ro) ro.disconnect(); if (renderer) { geo.dispose(); mat.dispose(); renderer.dispose(); } });
})();`,
};
export default c;
