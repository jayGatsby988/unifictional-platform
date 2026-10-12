// @ts-nocheck
// webgl-3 · Portrait tiles that rest as a duotone and reveal full colour through a cursor-following shader mask on hover (Awwwards Pack).
import type { Component } from "./_types";

const rgb = (col: string): number[] => {
  const m = String(col || "").match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) { let h = m[1]; if (h.length === 3) h = h.split("").map(x => x + x).join(""); const n = parseInt(h, 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
  const r = String(col || "").match(/rgba?\(([^)]+)\)/); if (r) { const p = r[1].split(",").map(Number); return [p[0] / 255, p[1] / 255, p[2] / 255]; }
  return [0.5, 0.5, 0.5];
};
const vec = (col: string) => rgb(col).map(v => v.toFixed(4)).join(",");

const c: Component = {
  id: "webgl-3",
  type: "hover-reveal-tiles-3",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "hover-reveal-tiles-3 (webgl-3): a title and intro, then 4-9 portrait photo tiles in a responsive grid, each with a 1-3 word title and a short meta line (place, year or category) under it and an optional link. At rest every tile is a two-tone print in the page colours; moving the cursor over one reveals the full-colour photo through a shader mask that follows the pointer (tiles alternate between a melting gooey blob, a noisy diagonal wipe and a wavy liquid crossfade) and the tile edge softens toward the cursor. Needs 4-9 photos, portrait or square work best. The 'destinations', 'projects' or 'rooms' gallery for travel, hospitality, interiors, studios and agencies; phones and reduced motion get the plain photos (desaturated until tapped).",
  fields: `{"type":"hover-reveal-tiles-3","component":"webgl-3","title":"","intro":"","items":[{"title":"","meta":"","query":"","alt":"","href":""}]}`,
  images: { min: 4, max: 9 },
  css: ({ pair, capsRule }) => `
.hr3{padding:clamp(4rem,10vh,8rem) 0}
.hr3 .sec-head{padding:0 var(--gutter)}
.hr3__wrap{position:relative;padding:0 var(--gutter)}
.hr3__canvas{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:1}
.hr3__list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:clamp(1rem,2.4vw,2.2rem) clamp(1rem,2vw,1.6rem)}
.hr3__tile a{display:grid;gap:.8rem}
.hr3__fig{aspect-ratio:3/4;overflow:hidden;background:var(--bg2)}
.hr3__fig img{width:100%;height:100%;object-fit:cover;filter:grayscale(1) contrast(1.05);transition:filter .6s var(--ease-out),transform .8s var(--ease-out),opacity .3s}
.hr3__tile a:hover .hr3__fig img{filter:none;transform:scale(1.04)}
.hr3.is-gl .hr3__fig img.is-loaded{opacity:0;transition:opacity .4s}
.hr3__cap{display:grid;gap:.2rem}
.hr3__cap h3{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};font-size:clamp(1.3rem,2vw,1.9rem);line-height:1;${capsRule}}
.hr3__cap span{font-family:var(--mono);font-size:.66rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .hr3__canvas{display:none}
  .hr3__list{grid-template-columns:repeat(2,1fr)}
  .hr3__fig img{filter:none;opacity:1!important}
}`,
  html: (s, { esc, imgUrl, link }) => {
    const items = (s.items || []).filter(it => it && it.image).slice(0, 9);
    return `
<section class="hr3" id="work" data-fx="hover-reveal-tiles-3">
  <div class="sec-head"><h2 class="display reveal">${esc(s.title)}</h2>${s.intro ? `<p class="reveal">${esc(s.intro)}</p>` : ""}</div>
  <div class="hr3__wrap">
    <canvas class="hr3__canvas" aria-hidden="true"></canvas>
    <ul class="hr3__list">${items.map((it, i) => {
      const inner = `<div class="hr3__fig"><img src="${esc(imgUrl(it.image, 1000))}" alt="${esc(it.image?.alt || it.title || "")}" loading="lazy"></div><div class="hr3__cap"><h3>${esc(it.title)}</h3>${it.meta ? `<span>${esc(it.meta)}</span>` : ""}</div>`;
      return `<li class="hr3__tile" data-v="${i % 3}">${it.href ? `<a href="${esc(link(it.href))}">${inner}</a>` : `<a>${inner}</a>`}</li>`;
    }).join("")}</ul>
  </div>
</section>`;
  },
  js: ({ t }) => `
import * as THREE from "three";
(function(){
  var el = document.querySelector('[data-fx="hover-reveal-tiles-3"]'); if (!el) return;
  var fx = window.__fx || {};
  function glOK(){ try { var c = document.createElement('canvas'); var g = c.getContext('webgl2'); if (!g) return false; var x = g.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); return true; } catch (e) { return false; } }
  if (!fx.FX || !glOK() || !window.matchMedia('(pointer: fine)').matches) { el.classList.add('is-static'); return; }
  var wrap = el.querySelector('.hr3__wrap'), canvas = el.querySelector('.hr3__canvas'), tiles = Array.prototype.slice.call(el.querySelectorAll('.hr3__tile'));
  var renderer, scene, camera, geo, raf = 0, started = false, visible = false, ro, W = 1, H = 1, pr = 1, objs = [];
  var mouse = { x: -9999, y: -9999 }, mouseT = { x: -9999, y: -9999 };
  var VERT = 'varying vec2 v_uv; void main(){ v_uv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var FRAG = [
    'precision highp float;',
    'uniform sampler2D u_map; uniform float u_time; uniform float u_hover; uniform float u_variant; uniform vec2 u_res; uniform vec2 u_mouse; uniform vec2 u_ratio; uniform vec3 u_bg; uniform vec3 u_ink; varying vec2 v_uv;',
    'vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; } vec4 mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; } vec4 permute(vec4 x){ return mod289(((x * 34.0) + 1.0) * x); } vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }',
    'float snoise3(vec3 v){ const vec2 C = vec2(1.0/6.0, 1.0/3.0); const vec4 D = vec4(0.0, 0.5, 1.0, 2.0); vec3 i = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx); vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1.0 - g; vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy); vec3 x1 = x0 - i1 + C.xxx; vec3 x2 = x0 - i2 + C.yyy; vec3 x3 = x0 - D.yyy; i = mod289(i); vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0)); float n_ = 0.142857142857; vec3 ns = n_ * D.wyz - D.xzx; vec4 j = p - 49.0 * floor(p * ns.z * ns.z); vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7.0 * x_); vec4 x = x_ * ns.x + ns.yyyy; vec4 y = y_ * ns.x + ns.yyyy; vec4 h = 1.0 - abs(x) - abs(y); vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw); vec4 s0 = floor(b0) * 2.0 + 1.0; vec4 s1 = floor(b1) * 2.0 + 1.0; vec4 sh = -step(h, vec4(0.0)); vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww; vec3 p0 = vec3(a0.xy, h.x); vec3 p1 = vec3(a0.zw, h.y); vec3 p2 = vec3(a1.xy, h.z); vec3 p3 = vec3(a1.zw, h.w); vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3))); p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w; vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0); m = m * m; return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3))); }',
    'float circle(in vec2 st, in float r, in float blur){ return 1. - smoothstep(r - (r * blur), r + (r * blur), dot(st, st) * 4.0); }',
    'void main(){',
    '  float time = u_time * 0.05; float ph = u_hover;',
    '  vec2 uv = v_uv; vec2 uv_h = v_uv;',
    '  vec2 st = gl_FragCoord.xy / u_res.xy - vec2(.5); st.y *= u_res.y / u_res.x;',
    '  vec2 mouse = vec2((u_mouse.x / u_res.x) * 2. - 1., -(u_mouse.y / u_res.y) * 2. + 1.) * -.5; mouse.y *= u_res.y / u_res.x;',
    '  vec2 cpos = st + mouse;',
    '  float grd = 0.1 * ph;',
    '  float sqr = 100. * ((smoothstep(0., grd, uv.x) - smoothstep(1. - grd, 1., uv.x)) * (smoothstep(0., grd, uv.y) - smoothstep(1. - grd, 1., uv.y))) - 10.;',
    '  float c = circle(cpos, .04 * ph, 2.) * 50.;',
    '  float mask = 0.0; vec2 warp = vec2(0.0);',
    '  if (u_variant < 0.5) {',
    '    float c2 = circle(cpos, .01 * ph, 2.);',
    '    float offX = uv.x + sin(uv.y + time * 2.); float offY = uv.y - time * .2 - cos(time * 2.) * 0.1;',
    '    float nc = snoise3(vec3(offX, offY, time * .5) * 8.) * ph;',
    '    float nh = snoise3(vec3(offX, offY, time * .5) * 2.) * .1;',
    '    mask = smoothstep(.1, .8, c2 * 5. + nc * 3. - 1.); warp = vec2(nh) * ph;',
    '  } else if (u_variant < 1.5) {',
    '    float shape = (uv.x + uv.y - 2. + ph * 2.7) * 2.;',
    '    float n = snoise3(vec3(uv.x + uv.y, uv.y - uv.x, time) * 8.) * .5;',
    '    mask = smoothstep(.99, 1., n + shape); warp = mouse * 0.1 * ph;',
    '  } else {',
    '    float offX = uv.x * .3 - time * 0.3;',
    '    float offY = uv.y + sin(uv.x * 5.) * .1 - sin(time * 0.5) + snoise3(vec3(uv.x, uv.y, time) * 0.5);',
    '    offX += snoise3(vec3(offX, offY, time) * 5.) * .3; offY += snoise3(vec3(offX, offX, time * 0.3)) * .1;',
    '    float nc = snoise3(vec3(offX, offY, time * .5) * 8.) * ph; float nh = snoise3(vec3(offX, offY, time * .5) * 2.) * .03;',
    '    mask = smoothstep(0., 1., ph); warp = vec2(nc + nh) * 1.4 * ph * (1. - ph);',
    '  }',
    '  uv_h -= vec2(0.5); uv_h *= 1. - ph * 0.1; uv_h *= u_ratio; uv_h += vec2(0.5);',
    '  uv -= vec2(0.5); uv *= 1. - ph * 0.2; uv += mouse * 0.1 * ph; uv *= u_ratio; uv += vec2(0.5);',
    '  vec4 base = texture2D(u_map, uv + warp * 0.3);',
    '  float g = dot(base.rgb, vec3(0.299, 0.587, 0.114));',
    '  vec3 duo = mix(u_bg, u_ink, smoothstep(0.05, 0.95, g));',
    '  vec4 hover = texture2D(u_map, uv_h + warp);',
    '  vec3 color = mix(duo, hover.rgb, clamp(mask, 0., 1.));',
    '  float finalMask = smoothstep(.0, .1, sqr - c);',
    '  gl_FragColor = vec4(color, finalMask);',
    '}'
  ].join('\\n');
  function ratio(w, h, iw, ih){ var r = (w / h) / (iw / ih); return r > 1 ? [1, 1 / r] : [r, 1]; }
  function layout(){
    var wr = wrap.getBoundingClientRect();
    objs.forEach(function(o){
      var r = o.img.getBoundingClientRect(), w = r.width, h = r.height;
      o.mesh.scale.set(w, h, 1);
      o.mesh.position.set(r.left - wr.left - W / 2 + w / 2, -(r.top - wr.top) + H / 2 - h / 2, 0);
      if (o.tex && o.tex.image) { var q = ratio(w, h, o.tex.image.width, o.tex.image.height); o.mat.uniforms.u_ratio.value.set(q[0], q[1]); }
    });
  }
  function size(){
    W = wrap.clientWidth || 1; H = wrap.clientHeight || 1;
    pr = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(4.5e6 / (W * H)));
    renderer.setPixelRatio(pr); renderer.setSize(W, H, false);
    camera.left = -W / 2; camera.right = W / 2; camera.top = H / 2; camera.bottom = -H / 2; camera.updateProjectionMatrix();
    objs.forEach(function(o){ o.mat.uniforms.u_res.value.set(W * pr, H * pr); });
    layout();
  }
  var clock = new THREE.Clock(false);
  function tick(){
    raf = 0; if (!visible) return;
    var dt = clock.getDelta();
    mouse.x += (mouseT.x - mouse.x) * 0.12; mouse.y += (mouseT.y - mouse.y) * 0.12;
    layout();
    objs.forEach(function(o){ if (o.hovering) o.mat.uniforms.u_time.value += dt; o.mat.uniforms.u_mouse.value.set(mouse.x * pr, mouse.y * pr); });
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  function play(){ if (!raf && started) { clock.start(); raf = requestAnimationFrame(tick); } }
  function pause(){ if (raf) { cancelAnimationFrame(raf); raf = 0; clock.stop(); } }
  function init(){
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, alpha: true, premultipliedAlpha: false, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10); camera.position.z = 1;
    geo = new THREE.PlaneGeometry(1, 1);
    var loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
    tiles.forEach(function(tile){
      var img = tile.querySelector('img'), a = tile.querySelector('a'), v = parseFloat(tile.getAttribute('data-v')) || 0;
      var mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, uniforms: {
        u_map: { value: null }, u_time: { value: Math.random() * 20 }, u_hover: { value: 0 }, u_variant: { value: v },
        u_res: { value: new THREE.Vector2(1, 1) }, u_mouse: { value: new THREE.Vector2(-9999, -9999) }, u_ratio: { value: new THREE.Vector2(1, 1) },
        u_bg: { value: new THREE.Vector3(${vec(t.dark ? t.bg2 : t.ink)}) }, u_ink: { value: new THREE.Vector3(${vec(t.dark ? t.ink : t.bg2)}) } } });
      var mesh = new THREE.Mesh(geo, mat); mesh.visible = false; scene.add(mesh);
      var o = { img: img, mesh: mesh, mat: mat, tex: null, hovering: false };
      loader.load(img.currentSrc || img.src, function(tex){ tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; o.tex = tex; mat.uniforms.u_map.value = tex; mesh.visible = true; layout(); img.classList.add('is-loaded'); });
      a.addEventListener('mouseenter', function(){ o.hovering = true; gsap.to(mat.uniforms.u_hover, { value: 1, duration: 0.6, ease: 'power2.inOut', overwrite: true }); });
      a.addEventListener('mouseleave', function(){ gsap.to(mat.uniforms.u_hover, { value: 0, duration: 0.6, ease: 'power2.inOut', overwrite: true, onComplete: function(){ o.hovering = false; } }); });
      objs.push(o);
    });
    el.classList.add('is-gl');
    size();
    ro = new ResizeObserver(size); ro.observe(wrap);
    window.addEventListener('pointermove', function(e){ var wr = wrap.getBoundingClientRect(); mouseT.x = e.clientX - wr.left; mouseT.y = e.clientY - wr.top; if (mouse.x < -999) { mouse.x = mouseT.x; mouse.y = mouseT.y; } }, { passive: true });
    if (window.ScrollTrigger) ScrollTrigger.addEventListener('refresh', layout);
  }
  var io = new IntersectionObserver(function(es){ es.forEach(function(en){ visible = en.isIntersecting; if (visible) { if (!started) { started = true; init(); } play(); } else pause(); }); }, { rootMargin: '10% 0px' });
  io.observe(el);
  window.addEventListener('pagehide', function(){ pause(); io.disconnect(); if (ro) ro.disconnect(); if (renderer) { objs.forEach(function(o){ o.mat.dispose(); if (o.tex) o.tex.dispose(); }); geo.dispose(); renderer.dispose(); } });
})();`,
};
export default c;
