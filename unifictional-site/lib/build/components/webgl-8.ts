// @ts-nocheck
// webgl-8 · Full-bleed photo whose pixel grid smears with mouse velocity and springs back (Awwwards Pack).
import type { Component } from "./_types";

const c: Component = {
  id: "webgl-8",
  type: "pixel-smear-8",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "pixel-smear-8 (webgl-8): a full-screen photo band with an eyebrow, a 2-6 word headline and one short line of text sitting bottom-left. The photo is broken into a grid of about 44 x 44 cells: when the section enters it is scrambled and settles into place, and from then on moving the cursor drags the cells under it along in the direction and speed of the movement before they ease back. Needs one strong landscape photo. A statement or 'about' moment for studios, builders, photographers and any brand with one great picture; on phones and with reduced motion it is the plain photo with the text.",
  fields: `{"type":"pixel-smear-8","component":"webgl-8","eyebrow":"","headline":"","text":"","image":{"query":"","alt":""}}`,
  images: { min: 1, max: 1 },
  css: ({ pair, capsRule }) => `
.ps8{position:relative;height:100svh;min-height:540px;overflow:hidden;background:var(--bg2)}
.ps8__media{position:absolute;inset:0}
.ps8__media img{width:100%;height:100%;object-fit:cover;transition:opacity .4s}
.ps8__media canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.ps8.is-gl .ps8__media img{opacity:0}
.ps8__shade{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.62),rgba(0,0,0,0) 55%);pointer-events:none}
.ps8__copy{position:absolute;left:var(--gutter);right:var(--gutter);bottom:clamp(2rem,7vh,5rem);color:#fff;display:grid;gap:1rem;max-width:52rem;pointer-events:none}
.ps8__eyebrow{font-family:var(--mono);font-size:.68rem;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.7)}
.ps8__copy h2{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};line-height:.95;font-size:clamp(2.4rem,7vw,7rem);max-width:12ch;${capsRule}}
.ps8__copy p{max-width:46ch;color:rgba(255,255,255,.78);font-size:1.05rem}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .ps8{height:72svh;min-height:440px}
  .ps8__media canvas{display:none}
  .ps8.is-gl .ps8__media img{opacity:1}
}`,
  html: (s, { esc, imgUrl }) => `
<section class="ps8" data-fx="pixel-smear-8">
  <div class="ps8__media"><img src="${esc(imgUrl(s.image, 1800))}" alt="${esc(s.image?.alt || "")}" loading="lazy"></div>
  <div class="ps8__shade"></div>
  <div class="ps8__copy">
    ${s.eyebrow ? `<span class="ps8__eyebrow">${esc(s.eyebrow)}</span>` : ""}
    <h2>${esc(s.headline)}</h2>
    ${s.text ? `<p>${esc(s.text)}</p>` : ""}
  </div>
</section>`,
  js: () => `
import * as THREE from "three";
(function(){
  var el = document.querySelector('[data-fx="pixel-smear-8"]'); if (!el) return;
  var fx = window.__fx || {};
  function glOK(){ try { var c = document.createElement('canvas'); var g = c.getContext('webgl2'); if (!g) return false; var x = g.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); return true; } catch (e) { return false; } }
  if (!fx.FX || !glOK()) { el.classList.add('is-static'); return; }
  var media = el.querySelector('.ps8__media'), img = media.querySelector('img');
  var GRID = 44, MOUSE = 0.22, STRENGTH = 0.14, RELAX = 0.92;
  var renderer, scene, camera, mat, geo, mesh, data, dataTex, tex, raf = 0, started = false, visible = false, ro, ih = 2 / 3;
  var W = 1, H = 1, mouse = { x: -10, y: -10, px: -10, py: -10, vx: 0, vy: 0 };
  var VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var FRAG = 'precision highp float; uniform sampler2D uTexture; uniform sampler2D uData; uniform vec4 uRes; varying vec2 vUv;' +
    'void main(){ vec2 uv = (vUv - 0.5) * uRes.zw + 0.5; vec4 off = texture2D(uData, vUv); gl_FragColor = texture2D(uTexture, uv - 0.02 * off.rg); }';
  function fillGrid(){ for (var i = 0; i < GRID * GRID; i++) { var s = i * 4; data[s] = Math.random() * 255 - 125; data[s + 1] = Math.random() * 255 - 125; data[s + 2] = 0; data[s + 3] = 1; } dataTex.needsUpdate = true; }
  function size(){
    W = media.clientWidth || 1; H = media.clientHeight || 1;
    renderer.setSize(W, H, false);
    var a1, a2; if (H / W > ih) { a1 = (W / H) * ih; a2 = 1; } else { a1 = 1; a2 = (H / W) / ih; }
    mat.uniforms.uRes.value.set(W, H, a1, a2);
  }
  function update(){
    var d = data, n = GRID * GRID, i, j;
    for (i = 0; i < n; i++) { d[i * 4] *= RELAX; d[i * 4 + 1] *= RELAX; }
    var gx = GRID * mouse.x, gy = GRID * (1 - mouse.y), maxD = GRID * MOUSE, maxSq = maxD * maxD, asp = H / W;
    if (Math.abs(mouse.vx) + Math.abs(mouse.vy) > 0.0001) {
      for (i = 0; i < GRID; i++) for (j = 0; j < GRID; j++) {
        var dist = ((gx - i) * (gx - i)) / asp + (gy - j) * (gy - j);
        if (dist < maxSq) { var idx = 4 * (i + GRID * j); var p = Math.min(10, maxD / Math.sqrt(Math.max(dist, 0.0001))); d[idx] += STRENGTH * 100 * mouse.vx * p; d[idx + 1] -= STRENGTH * 100 * mouse.vy * p; }
      }
    }
    mouse.vx *= 0.9; mouse.vy *= 0.9; dataTex.needsUpdate = true;
  }
  function tick(){ raf = 0; if (!visible) return; update(); renderer.render(scene, camera); raf = requestAnimationFrame(tick); }
  function play(){ if (!raf && started) raf = requestAnimationFrame(tick); }
  function pause(){ if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  function init(){
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    media.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -10, 10); camera.position.z = 2;
    data = new Float32Array(GRID * GRID * 4);
    dataTex = new THREE.DataTexture(data, GRID, GRID, THREE.RGBAFormat, THREE.FloatType);
    dataTex.magFilter = dataTex.minFilter = THREE.NearestFilter;
    fillGrid();
    var loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
    tex = loader.load(img.currentSrc || img.src, function(t){ t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; if (t.image && t.image.width) ih = t.image.height / t.image.width; size(); el.classList.add('is-gl'); });
    mat = new THREE.ShaderMaterial({ uniforms: { uTexture: { value: tex }, uData: { value: dataTex }, uRes: { value: new THREE.Vector4(1, 1, 1, 1) } }, vertexShader: VERT, fragmentShader: FRAG });
    geo = new THREE.PlaneGeometry(1, 1, 1, 1);
    mesh = new THREE.Mesh(geo, mat); scene.add(mesh);
    size();
    ro = new ResizeObserver(size); ro.observe(media);
    el.addEventListener('pointermove', function(e){
      var r = media.getBoundingClientRect();
      mouse.x = (e.clientX - r.left) / W; mouse.y = (e.clientY - r.top) / H;
      if (mouse.px < -1) { mouse.px = mouse.x; mouse.py = mouse.y; }
      mouse.vx = Math.max(-0.05, Math.min(0.05, mouse.x - mouse.px)); mouse.vy = Math.max(-0.05, Math.min(0.05, mouse.y - mouse.py)); mouse.px = mouse.x; mouse.py = mouse.y;
    }, { passive: true });
    el.addEventListener('pointerleave', function(){ mouse.px = -10; mouse.py = -10; });
  }
  var io = new IntersectionObserver(function(es){ es.forEach(function(en){ visible = en.isIntersecting; if (visible) { if (!started) { started = true; init(); } play(); } else pause(); }); }, { rootMargin: '10% 0px' });
  io.observe(el);
  window.addEventListener('pagehide', function(){ pause(); io.disconnect(); if (ro) ro.disconnect(); if (renderer) { geo.dispose(); mat.dispose(); dataTex.dispose(); if (tex) tex.dispose(); renderer.dispose(); } });
})();`,
};
export default c;
