// @ts-nocheck
// webgl-5 · A wall of tiny grey thumbnails that swell to full colour in a mosaic lens around the cursor (Awwwards Pack, recreated from the preview video).
import type { Component } from "./_types";

const rgb = (col: string): number[] => {
  const m = String(col || "").match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) { let h = m[1]; if (h.length === 3) h = h.split("").map(x => x + x).join(""); const n = parseInt(h, 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
  const r = String(col || "").match(/rgba?\(([^)]+)\)/); if (r) { const p = r[1].split(",").map(Number); return [p[0] / 255, p[1] / 255, p[2] / 255]; }
  return [0.5, 0.5, 0.5];
};
const vec = (col: string) => rgb(col).map(v => v.toFixed(4)).join(",");
const hex = (col: string) => { const [r, g, b] = rgb(col).map(v => Math.round(v * 255)); return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join(""); };

const c: Component = {
  id: "webgl-5",
  type: "lens-grid-5",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "(recreated from the preview video) lens-grid-5 (webgl-5): a full-screen wall tiled with a regular grid of tiny square thumbnails (about 40px cells), drawn from 8-16 photos repeated at random. At rest the tiles are small and greyscale so the wall reads as a dot pattern on the page colour; within a few cells of the cursor they swell to fill their cells and switch to full colour, forming a mosaic lens that follows the pointer with a lag and leaves a shrinking wake behind fast moves. A small label next to the cursor names the photo under it, and when nobody moves the mouse the lens drifts on its own. An eyebrow and a 2-5 word title sit top-left. Needs 8-16 photos with a short title each. An 'archive', 'our work' or 'the team' wall for photographers, agencies, galleries, restaurants and makers; phones and reduced motion get a plain grid of the thumbnails with captions.",
  fields: `{"type":"lens-grid-5","component":"webgl-5","eyebrow":"","title":"","items":[{"title":"","query":"","alt":""},{"title":"","query":"","alt":""},{"title":"","query":"","alt":""},{"title":"","query":"","alt":""},{"title":"","query":"","alt":""},{"title":"","query":"","alt":""},{"title":"","query":"","alt":""},{"title":"","query":"","alt":""}]}`,
  images: { min: 8, max: 16 },
  css: ({ pair, capsRule }) => `
.lg5{position:relative;background:var(--bg)}
.lg5__stage{position:relative;height:100svh;min-height:560px;overflow:hidden;background:var(--bg);cursor:crosshair}
.lg5__stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.lg5__head{position:absolute;top:clamp(5rem,12vh,7rem);left:var(--gutter);z-index:2;display:grid;gap:.6rem;pointer-events:none;max-width:40rem}
.lg5__eyebrow{font-family:var(--mono);font-size:.68rem;letter-spacing:.16em;text-transform:uppercase;color:var(--ink2)}
.lg5__head h2{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};line-height:.95;font-size:clamp(2.4rem,6vw,6rem);${capsRule}}
.lg5__label{position:absolute;left:0;top:0;z-index:3;pointer-events:none;font-family:var(--mono);font-size:.66rem;letter-spacing:.14em;text-transform:uppercase;background:var(--ink);color:var(--bg);padding:.45em .8em;opacity:0;transition:opacity .25s;white-space:nowrap}
.lg5__label.is-on{opacity:1}
.lg5__static{display:none;grid-template-columns:repeat(4,1fr);gap:1rem;padding:clamp(4rem,10vh,7rem) var(--gutter)}
.lg5__static figure{display:grid;gap:.5rem}
.lg5__static img{width:100%;aspect-ratio:1;object-fit:cover}
.lg5__static figcaption{font-family:var(--mono);font-size:.62rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink2)}
.lg5__static-head{grid-column:1/-1;display:grid;gap:.6rem;margin-bottom:1.5rem}
.lg5__static-head h2{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};line-height:.95;font-size:clamp(2.2rem,8vw,5rem);${capsRule}}
.lg5.is-static .lg5__stage{display:none}
.lg5.is-static .lg5__static{display:grid}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .lg5__stage{display:none}
  .lg5__static{display:grid;grid-template-columns:repeat(3,1fr);gap:.6rem}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).filter(it => it && it.image).slice(0, 16);
    const head = `${s.eyebrow ? `<span class="lg5__eyebrow">${esc(s.eyebrow)}</span>` : ""}${s.title ? `<h2>${esc(s.title)}</h2>` : ""}`;
    return `
<section class="lg5" data-fx="lens-grid-5">
  <div class="lg5__stage">
    <canvas aria-hidden="true"></canvas>
    <div class="lg5__head">${head}</div>
    <div class="lg5__label" aria-hidden="true"></div>
    <ul hidden class="lg5__src">${items.map(it => `<li data-src="${esc(imgUrl(it.image, 500))}" data-title="${esc(it.title || it.image?.alt || "")}"></li>`).join("")}</ul>
  </div>
  <div class="lg5__static">
    ${head ? `<div class="lg5__static-head">${head}</div>` : ""}
    ${items.map(it => `<figure><img src="${esc(imgUrl(it.image, 600))}" alt="${esc(it.image?.alt || it.title || "")}" loading="lazy"><figcaption>${esc(it.title || "")}</figcaption></figure>`).join("")}
  </div>
</section>`;
  },
  js: ({ t }) => `
import * as THREE from "three";
(function(){
  var el = document.querySelector('[data-fx="lens-grid-5"]'); if (!el) return;
  var fx = window.__fx || {};
  function glOK(){ try { var c = document.createElement('canvas'); var g = c.getContext('webgl2'); if (!g) return false; var x = g.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); return true; } catch (e) { return false; } }
  var srcEls = Array.prototype.slice.call(el.querySelectorAll('.lg5__src li'));
  if (!fx.FX || !glOK() || srcEls.length < 1) { el.classList.add('is-static'); return; }
  var stage = el.querySelector('.lg5__stage'), canvas = stage.querySelector('canvas'), label = el.querySelector('.lg5__label');
  var srcs = srcEls.map(function(li){ return li.getAttribute('data-src'); }), titles = srcEls.map(function(li){ return li.getAttribute('data-title'); });
  var N = Math.ceil(Math.sqrt(srcs.length)), CELL = 40, TILE = 256;
  var renderer, scene, camera, mat, geo, mesh, atlasTex, infTex, infCanvas, infCtx, raf = 0, started = false, visible = false, ro, ready = false;
  var W = 1, H = 1, cols = 1, rows = 1, count = 0, cellIndex = null;
  var target = { x: 0, y: 0 }, pos = { x: 0, y: 0 }, hasPointer = false, idleT = 0, lastLabel = -1;
  var VERT = [
    'attribute vec2 aCell; attribute float aIndex;',
    'uniform vec2 uGrid; uniform float uCell; uniform vec2 uRes; uniform sampler2D uInfluence; uniform float uAtlasN;',
    'varying vec2 vUv; varying float vI; varying vec2 vAtlas;',
    'void main(){',
    '  vec2 cuv = (aCell + 0.5) / uGrid;',
    '  float i = texture2D(uInfluence, cuv).r;',
    '  float s = mix(0.38, 1.12, smoothstep(0.0, 0.65, i));',
    '  vec2 centre = vec2(aCell.x * uCell + uCell * 0.5 - uRes.x * 0.5, uRes.y * 0.5 - (aCell.y * uCell + uCell * 0.5));',
    '  vec3 p = vec3(position.xy * uCell * s + centre, i * 0.1);',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
    '  vUv = uv; vI = i; vAtlas = vec2(mod(aIndex, uAtlasN), floor(aIndex / uAtlasN));',
    '}'
  ].join('\\n');
  var FRAG = [
    'precision highp float;',
    'uniform sampler2D uAtlas; uniform float uAtlasN; uniform vec3 uBg; varying vec2 vUv; varying float vI; varying vec2 vAtlas;',
    'void main(){',
    '  vec2 auv = (vAtlas + vec2(vUv.x, 1.0 - vUv.y)) / uAtlasN;',
    '  vec3 c = texture2D(uAtlas, auv).rgb;',
    '  float l = dot(c, vec3(0.299, 0.587, 0.114));',
    '  vec3 grey = mix(uBg, vec3(l), 0.78);',
    '  vec3 col = mix(grey, c, smoothstep(0.45, 0.9, vI));',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\\n');
  function buildGrid(){
    cols = Math.ceil(W / CELL) + 1; rows = Math.ceil(H / CELL) + 1; count = cols * rows;
    var cells = new Float32Array(count * 2), idx = new Float32Array(count); cellIndex = new Int16Array(count);
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) { var k = r * cols + c; cells[k * 2] = c; cells[k * 2 + 1] = r; var pick = Math.floor(Math.random() * srcs.length); idx[k] = pick; cellIndex[k] = pick; }
    if (geo) geo.dispose();
    var plane = new THREE.PlaneGeometry(1, 1);
    geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index; geo.setAttribute('position', plane.getAttribute('position')); geo.setAttribute('uv', plane.getAttribute('uv'));
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2)); geo.setAttribute('aIndex', new THREE.InstancedBufferAttribute(idx, 1));
    geo.instanceCount = count;
    if (mesh) mesh.geometry = geo; else { mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; scene.add(mesh); }
    infCanvas.width = cols; infCanvas.height = rows; infCtx.fillStyle = '#000'; infCtx.fillRect(0, 0, cols, rows); infTex.needsUpdate = true;
    mat.uniforms.uGrid.value.set(cols, rows);
  }
  function size(){
    W = stage.clientWidth || 1; H = stage.clientHeight || 1;
    renderer.setSize(W, H, false);
    camera.left = -W / 2; camera.right = W / 2; camera.top = H / 2; camera.bottom = -H / 2; camera.updateProjectionMatrix();
    mat.uniforms.uRes.value.set(W, H);
    if (!hasPointer) { target.x = W * 0.6; target.y = H * 0.5; pos.x = target.x; pos.y = target.y; }
    buildGrid();
  }
  function brush(){
    infCtx.globalCompositeOperation = 'source-over';
    infCtx.fillStyle = 'rgba(0,0,0,0.07)'; infCtx.fillRect(0, 0, cols, rows);
    var cx = pos.x / CELL, cy = pos.y / CELL, R = 5.2;
    var g = infCtx.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    infCtx.globalCompositeOperation = 'lighter';
    infCtx.fillStyle = g; infCtx.beginPath(); infCtx.arc(cx, cy, R, 0, Math.PI * 2); infCtx.fill();
    infTex.needsUpdate = true;
  }
  function updateLabel(){
    if (!hasPointer || performance.now() - idleT > 2600) { if (lastLabel !== -1) { lastLabel = -1; label.classList.remove('is-on'); } return; }
    var c = Math.floor(target.x / CELL), r = Math.floor(target.y / CELL);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return;
    var k = r * cols + c, i = cellIndex[k];
    if (i !== lastLabel) { lastLabel = i; label.textContent = titles[i] || ''; label.classList.toggle('is-on', !!titles[i]); }
    label.style.transform = 'translate(' + Math.round(target.x + 18) + 'px,' + Math.round(target.y + 18) + 'px)';
  }
  function tick(now){
    raf = 0; if (!visible) return;
    if (!hasPointer || now - idleT > 2600) { var tt = now * 0.0003; target.x = W * (0.5 + 0.32 * Math.cos(tt)); target.y = H * (0.5 + 0.3 * Math.sin(tt * 1.37)); }
    pos.x += (target.x - pos.x) * 0.1; pos.y += (target.y - pos.y) * 0.1;
    brush(); updateLabel();
    if (ready) renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  function play(){ if (!raf && started) raf = requestAnimationFrame(tick); }
  function pause(){ if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  function loadImg(url){ return new Promise(function(res){ var im = new Image(); im.crossOrigin = 'anonymous'; im.onload = function(){ res(im); }; im.onerror = function(){ res(null); }; im.src = url; }); }
  function buildAtlas(){
    var cv = document.createElement('canvas'); cv.width = cv.height = N * TILE; var ctx = cv.getContext('2d');
    ctx.fillStyle = '${hex(t.accent)}'; ctx.fillRect(0, 0, cv.width, cv.height);
    return Promise.all(srcs.map(loadImg)).then(function(imgs){
      imgs.forEach(function(im, i){
        if (!im) return;
        var x = (i % N) * TILE, y = Math.floor(i / N) * TILE, s = Math.max(TILE / im.naturalWidth, TILE / im.naturalHeight), w = im.naturalWidth * s, h = im.naturalHeight * s;
        try { ctx.drawImage(im, x + (TILE - w) / 2, y + (TILE - h) / 2, w, h); } catch (e) {}
      });
      atlasTex = new THREE.CanvasTexture(cv); atlasTex.flipY = false; atlasTex.minFilter = THREE.LinearMipmapLinearFilter; atlasTex.magFilter = THREE.LinearFilter; atlasTex.generateMipmaps = true;
      mat.uniforms.uAtlas.value = atlasTex; ready = true; el.classList.add('is-gl');
    });
  }
  function init(){
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10); camera.position.z = 1;
    infCanvas = document.createElement('canvas'); infCtx = infCanvas.getContext('2d', { willReadFrequently: false });
    infTex = new THREE.CanvasTexture(infCanvas); infTex.minFilter = THREE.LinearFilter; infTex.magFilter = THREE.LinearFilter; infTex.generateMipmaps = false; infTex.flipY = false;
    mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: {
      uGrid: { value: new THREE.Vector2(1, 1) }, uCell: { value: CELL }, uRes: { value: new THREE.Vector2(1, 1) }, uInfluence: { value: infTex },
      uAtlas: { value: null }, uAtlasN: { value: N }, uBg: { value: new THREE.Vector3(${vec(t.bg)}) } } });
    size();
    ro = new ResizeObserver(size); ro.observe(stage);
    buildAtlas();
    stage.addEventListener('pointermove', function(e){ var r = stage.getBoundingClientRect(); target.x = e.clientX - r.left; target.y = e.clientY - r.top; hasPointer = true; idleT = performance.now(); }, { passive: true });
    stage.addEventListener('pointerleave', function(){ idleT = -1e9; });
  }
  var io = new IntersectionObserver(function(es){ es.forEach(function(en){ visible = en.isIntersecting; if (visible) { if (!started) { started = true; init(); } play(); } else pause(); }); }, { rootMargin: '10% 0px' });
  io.observe(el);
  window.addEventListener('pagehide', function(){ pause(); io.disconnect(); if (ro) ro.disconnect(); if (renderer) { if (geo) geo.dispose(); mat.dispose(); infTex.dispose(); if (atlasTex) atlasTex.dispose(); renderer.dispose(); } });
})();`,
};
export default c;
