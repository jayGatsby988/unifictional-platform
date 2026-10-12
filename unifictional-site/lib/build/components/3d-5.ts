// @ts-nocheck
// 3d-5 · Draggable curved product grid with focus zoom (Awwwards Pack, "Shoe
// Finder", React / R3F). The idea is lifted and rebuilt in plain three.js r160:
// photo tiles on a grid that bows away like a dome over slow contour lines;
// dragging pans it with rubber-band resistance and re-centres on release;
// clicking a tile dollies the camera in, enlarges it, dims the rest, sweeps a
// light band across it and shows a caption with the title and a link. The
// framer-motion pill, Leva panel, minimap and collection tabs are dropped.
import type { Component } from "./_types";

function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}

const c: Component = {
  id: "3d-5",
  type: "curved-grid-3d",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "curved-grid-3d (3d-5): an optional heading, then a full-screen canvas holding a grid of photo tiles (four or five across) that bows away from you like the inside of a dome, floating over slowly drifting contour lines; the tiles fly in from depth when it first appears. Dragging anywhere pans the grid with a rubber-band pull at the edges and it eases back to centre on release; hovering lifts a tile; clicking one dollies the camera in, enlarges it, dims the others, sweeps a light band across it and shows its title with an optional link in a pill at the bottom, where Close (or a click on the background) zooms back out. Needs 8-20 photos, each with a short title and an optional href (a product or project page). Best for product catalogues, portfolios, menus and project showcases with square or portrait images. Phones and no-WebGL browsers get a plain photo grid with titles.",
  fields: `{"type":"curved-grid-3d","component":"3d-5","title":"","intro":"","items":[{"query":"","alt":"","title":"","href":""},{"query":"","alt":"","title":"","href":""},{"query":"","alt":"","title":"","href":""},{"query":"","alt":"","title":"","href":""},{"query":"","alt":"","title":"","href":""},{"query":"","alt":"","title":"","href":""},{"query":"","alt":"","title":"","href":""},{"query":"","alt":"","title":"","href":""}]}`,
  images: { min: 8, max: 20 },
  css: () => `
.cgrid__head{padding:clamp(4rem,10vh,7rem) var(--gutter) 0}
.cgrid__stage{position:relative;height:100svh;min-height:540px;overflow:hidden;background:var(--bg);cursor:grab;touch-action:pan-y}
.cgrid__stage.is-drag{cursor:grabbing}
.cgrid__stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.cgrid__ui{position:absolute;left:50%;bottom:2rem;transform:translateX(-50%);z-index:3;display:flex;align-items:center;gap:1rem;padding:.6rem .6rem .6rem 1.2rem;border-radius:999px;background:color-mix(in srgb,var(--bg2) 70%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid var(--line);font-size:.9rem;white-space:nowrap;max-width:calc(100% - 2*var(--gutter))}
.cgrid__hint{font-family:var(--mono);font-size:.66rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2);padding-right:.6rem}
.cgrid__cap{display:none;align-items:center;gap:1rem}
.cgrid__cap b{font-weight:500}
.cgrid__cap a{padding:.5em 1em;border-radius:999px;background:var(--accent);color:var(--on-accent);font-size:.85rem}
.cgrid__close{padding:.5em .9em;border-radius:999px;border:1px solid var(--line);font-size:.85rem}
.cgrid__close:hover{border-color:var(--ink)}
.cgrid__ui.is-on .cgrid__hint{display:none}
.cgrid__ui.is-on .cgrid__cap{display:flex}
.cgrid__static{display:none}
.cgrid.is-static .cgrid__stage{display:none}
.cgrid.is-static .cgrid__static{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;padding:3rem var(--gutter) 4rem}
.cgrid__item{display:grid;gap:.5rem}
.cgrid__item img{width:100%;aspect-ratio:1;object-fit:cover;background:var(--bg2)}
.cgrid__item span{font-size:.9rem;color:var(--ink2)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .cgrid__head{padding-top:3rem}
  .cgrid__stage{display:none}
  .cgrid__static,.cgrid.is-static .cgrid__static{display:grid;grid-template-columns:1fr 1fr;gap:.8rem;padding:2rem var(--gutter) 3rem}
}`,
  html: (s, { esc, imgUrl, link }) => {
    const items = (s.items || []).map((it, i) => ({ p: pic(it, s, i), alt: it.alt || "", title: it.title || "", href: it.href || "" })).filter(x => x.p).slice(0, 20);
    const cell = (it) => {
      const inner = `<img src="${esc(imgUrl(it.p, 700))}" alt="${esc(it.alt || it.p.alt || "")}" loading="lazy" crossorigin="anonymous"><span>${esc(it.title)}</span>`;
      return it.href ? `<a class="cgrid__item" href="${esc(link(it.href))}" data-title="${esc(it.title)}">${inner}</a>` : `<div class="cgrid__item" data-title="${esc(it.title)}">${inner}</div>`;
    };
    return `
<section class="cgrid" data-fx="curved-grid-3d">
  ${s.title || s.intro ? `<div class="cgrid__head sec-head">${s.title ? `<h2 class="display reveal">${esc(s.title)}</h2>` : ""}${s.intro ? `<p class="reveal">${esc(s.intro)}</p>` : ""}</div>` : ""}
  <div class="cgrid__stage">
    <canvas aria-hidden="true"></canvas>
    <div class="cgrid__ui"><span class="cgrid__hint">Drag to explore · click a photo</span><span class="cgrid__cap"><b></b><a href="#" hidden>View</a><button class="cgrid__close" type="button">Close</button></span></div>
  </div>
  <div class="cgrid__static">${items.map(cell).join("")}</div>
</section>`;
  },
  js: ({ t }) => `
import * as THREE from "three";
(function(){
  var sec = document.querySelector('[data-fx="curved-grid-3d"]');
  if (!sec) return;
  var stage = sec.querySelector('.cgrid__stage'), canvas = stage.querySelector('canvas'), ui = stage.querySelector('.cgrid__ui');
  var capB = ui.querySelector('.cgrid__cap b'), capA = ui.querySelector('.cgrid__cap a'), closeBtn = ui.querySelector('.cgrid__close');
  var items = [].slice.call(sec.querySelectorAll('.cgrid__item')).map(function(n){ var im = n.querySelector('img'); return { url: im.getAttribute('src'), title: n.getAttribute('data-title') || '', href: n.tagName === 'A' ? n.getAttribute('href') : '' }; });
  var gl = null;
  if (window.__fx.FX && items.length) { try { gl = canvas.getContext('webgl2', { antialias: true, alpha: true, powerPreference: 'high-performance' }); } catch (e) { gl = null; } }
  if (!gl) { sec.classList.add('is-static'); return; }
  var N = items.length, COLS = N <= 12 ? 4 : 5, ROWS = Math.ceil(N / COLS), SIZE = 2.5, STEP = 2.9, CURVE = 0.085;
  var gridW = COLS * STEP, gridH = ROWS * STEP;
  var FOV = 50, zoomOut = 20, zoomIn = 9;
  var renderer, scene, camera, tiles = [], bgMesh, ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  var rig = { tx: 0, ty: 0, x: 0, y: 0, vx: 0, vy: 0, zoom: 20, active: -1, hover: -1, dragging: false };
  var running = false, started = false, raf = 0, last = 0, t0 = 0;
  var ink = new THREE.Color('${t.ink}');
  function damp(o, k, target, sm, dt){ o[k] += (target - o[k]) * (1 - Math.exp(-dt * 4 / sm)); }
  function cubic(x){ return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  var VERT = 'varying vec2 vUv; uniform float uTime; uniform float uActive; void main(){ vUv = uv; float s = 1.0 + sin(uTime * 2.0) * 0.015 * uActive; gl_Position = projectionMatrix * modelViewMatrix * vec4(position * s, 1.0); }';
  var FRAG = 'uniform sampler2D uTexture; uniform float uOpacity; uniform float uActive; varying vec2 vUv; void main(){ vec4 tc = texture2D(uTexture, vUv); vec3 col = tc.rgb; if (uActive > 0.01) { float diag = vUv.x * 0.8 + vUv.y; float pos = uActive * 2.5; float d = abs(diag - pos); float inten = pow(1.0 - smoothstep(0.0, 0.5, d), 3.0); float fade = 1.0 - smoothstep(0.7, 1.0, uActive); col += vec3(0.85, 0.92, 1.0) * inten * 0.9 * fade * tc.a; } gl_FragColor = vec4(col, tc.a * uOpacity); }';
  var BG_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var BG_FRAG = 'uniform float uTime; uniform vec3 uColor; uniform vec2 uRes; uniform float uOpacity; varying vec2 vUv;'
    + 'vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; } vec2 mod289(vec2 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; } vec3 permute(vec3 x){ return mod289(((x * 34.0) + 1.0) * x); }'
    + 'float snoise(vec2 v){ const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439); vec2 i = floor(v + dot(v, C.yy)); vec2 x0 = v - i + dot(i, C.xx); vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0); vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1; i = mod289(i); vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0)); vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0); m = m * m; m = m * m; vec3 x = 2.0 * fract(p * C.www) - 1.0; vec3 h = abs(x) - 0.5; vec3 ox = floor(x + 0.5); vec3 a0 = x - ox; m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h); vec3 g; g.x = a0.x * x0.x + h.x * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw; return 130.0 * dot(m, g); }'
    + 'void main(){ float aspect = uRes.x / uRes.y; vec2 nuv = vUv; nuv.x *= aspect; vec2 c = vUv - 0.5; c.x *= aspect; float mask = 1.0 - smoothstep(0.59, 0.61, length(c)); float n = snoise(nuv * 3.0 + uTime * 0.05); float lines = fract(n * 5.0); float pat = smoothstep(0.47, 0.5, lines) - smoothstep(0.5, 0.53, lines); gl_FragColor = vec4(uColor, pat * mask * uOpacity); }';
  function fitZoom(){
    var aspect = Math.max(0.5, stage.clientWidth / stage.clientHeight);
    var needH = Math.max(gridH + 1.2, (gridW + 1.2) / aspect);
    zoomOut = (needH / 2) / Math.tan(FOV * Math.PI / 360);
    zoomIn = Math.max(5, zoomOut * 0.5);
    if (rig.active < 0) rig.zoom = zoomOut;
  }
  function bounds(){
    var vis = 2 * Math.tan(FOV * Math.PI / 360) * camera.position.z;
    return { x: Math.max(0, (gridW - vis * camera.aspect) / 2 + 1.5), y: Math.max(0, (gridH - vis) / 2 + 1.5), vis: vis };
  }
  function build(){
    renderer = new THREE.WebGLRenderer({ canvas: canvas, context: gl, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
    fitZoom(); camera.position.set(0, 0, zoomOut); rig.zoom = zoomOut;
    var bw = Math.max(gridW, gridH * 1.6) * 2.6, bh = bw * 0.45;
    bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.ShaderMaterial({ vertexShader: BG_VERT, fragmentShader: BG_FRAG, transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 }, uColor: { value: ink }, uRes: { value: new THREE.Vector2(bw, bh) }, uOpacity: { value: ${t.dark ? 0.22 : 0.3} } } }));
    bgMesh.position.z = -10; scene.add(bgMesh);
    var loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
    var geo = new THREE.PlaneGeometry(1, 1);
    t0 = performance.now();
    items.forEach(function(it, i){
      var cI = i % COLS, rI = Math.floor(i / COLS);
      var bx = (cI - (COLS - 1) / 2) * STEP, by = ((ROWS - 1) / 2 - rI) * STEP;
      var mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, uniforms: { uTexture: { value: null }, uOpacity: { value: 0 }, uActive: { value: 0 }, uTime: { value: 0 } } });
      var m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.userData = { i: i, bx: bx, by: by, w: SIZE * 0.9, h: SIZE * 0.9, delay: Math.random() * 400, enterZ: -50, opacity: 0, sc: 1, fz: 0, cz: 0, ready: false };
      scene.add(m); tiles.push(m);
      loader.load(it.url, function(tex){
        tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
        var a = tex.image && tex.image.width ? tex.image.width / tex.image.height : 1, mx = SIZE * 0.9;
        m.userData.w = a > 1 ? mx : mx * a; m.userData.h = a > 1 ? mx / a : mx;
        mat.uniforms.uTexture.value = tex; m.userData.ready = true; m.visible = true;
        if (m.userData.delay < performance.now() - t0 - 200) m.userData.delay = performance.now() - t0 + 100;
      });
    });
    resize();
  }
  function resize(){
    if (!renderer) return;
    var w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); fitZoom();
  }
  function setActive(i){
    rig.active = i;
    if (i >= 0) {
      var u = tiles[i].userData; rig.zoom = zoomIn; rig.tx = -u.bx; rig.ty = -u.by;
      capB.textContent = items[i].title || ''; if (items[i].href) { capA.hidden = false; capA.setAttribute('href', items[i].href); } else capA.hidden = true;
      ui.classList.add('is-on');
    } else { rig.zoom = zoomOut; rig.tx = 0; rig.ty = 0; ui.classList.remove('is-on'); }
  }
  function pick(e){
    var r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    ray.setFromCamera(ndc, camera);
    var hits = ray.intersectObjects(tiles.filter(function(m){ return m.visible; }), false);
    return hits.length ? hits[0].object.userData.i : -1;
  }
  var down = false, sx = 0, sy = 0, ix = 0, iy = 0, maxD = 0;
  canvas.addEventListener('pointerdown', function(e){ if (!camera || e.button) return; down = true; sx = e.clientX; sy = e.clientY; ix = rig.tx; iy = rig.ty; maxD = 0; rig.dragging = false; stage.classList.add('is-drag'); });
  window.addEventListener('pointermove', function(e){
    if (!camera) return;
    if (!down) { if (!rig.dragging && rig.active < 0 && e.target === canvas) rig.hover = pick(e); return; }
    var dx = e.clientX - sx, dy = e.clientY - sy; maxD = Math.max(maxD, Math.hypot(dx, dy));
    if (maxD > (e.pointerType === 'touch' ? 15 : 5)) { rig.dragging = true; rig.hover = -1; }
    var b = bounds(), sens = (b.vis / stage.clientHeight) * 2.2, RES = 0.25;
    var rx = ix + dx * sens, ry = iy - dy * sens;
    if (rx > b.x) rx = b.x + (rx - b.x) * RES; if (rx < -b.x) rx = -b.x + (rx + b.x) * RES;
    if (ry > b.y) ry = b.y + (ry - b.y) * RES; if (ry < -b.y) ry = -b.y + (ry + b.y) * RES;
    rig.tx = Math.max(-b.x - 3, Math.min(b.x + 3, rx)); rig.ty = Math.max(-b.y - 3, Math.min(b.y + 3, ry));
  });
  function up(e){
    if (!down) return; down = false; stage.classList.remove('is-drag');
    var wasDrag = rig.dragging; rig.dragging = false;
    if (!wasDrag && e && e.type === 'pointerup') { var hit = pick(e); if (hit >= 0 && hit !== rig.active) { setActive(hit); return; } if (hit < 0 && rig.active >= 0) { setActive(-1); return; } if (hit >= 0) return; }
    var b = bounds(), out = camera.position.z > zoomIn + 2;
    rig.tx = out ? 0 : Math.max(-b.x, Math.min(b.x, rig.tx)); rig.ty = out ? 0 : Math.max(-b.y, Math.min(b.y, rig.ty));
  }
  window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', function(){ if (!down) rig.hover = -1; });
  closeBtn.addEventListener('click', function(){ setActive(-1); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && rig.active >= 0) setActive(-1); });
  function frame(now){
    if (!running) return;
    raf = requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now; var time = now / 1000;
    damp(rig, 'x', rig.tx, 0.2, dt); damp(rig, 'y', rig.ty, 0.2, dt);
    var px = camera.position.x; damp(camera.position, 'z', rig.zoom, 0.25, dt);
    rig.vx = rig.x - (rig.px || 0); rig.vy = rig.y - (rig.py || 0); rig.px = rig.x; rig.py = rig.y;
    var zf = Math.min(1, zoomIn / rig.zoom);
    damp(camera.rotation, 'x', rig.vy * 0.08 * zf, 0.2, dt); damp(camera.rotation, 'y', -rig.vx * 0.08 * zf, 0.2, dt);
    var zoomedIn = rig.zoom <= zoomIn + 0.5, ratio = zoomedIn ? 0 : Math.max(0, Math.min(1, (rig.zoom - zoomIn) / (zoomOut - zoomIn))), smooth = cubic(ratio);
    var focus = rig.active >= 0, since = now - t0;
    for (var i = 0; i < tiles.length; i++) {
      var m = tiles[i], u = m.userData; if (!u.ready) continue;
      var x = u.bx + rig.x, y = u.by + rig.y;
      var entered = since > u.delay;
      var curve = -(x * x + y * y) * CURVE * smooth;
      var sc = 1, op = entered ? 1 : 0, fz = 0;
      if (focus) { if (rig.active === i) { sc = 1.5; fz = 1.2; } else { sc = 0.5; op = 0.15; fz = -0.5; } }
      else if (rig.hover === i && !rig.dragging) { sc = 1.05; fz = 0.5; }
      damp(u, 'sc', sc, 0.15, dt); damp(u, 'fz', fz, 0.2, dt); damp(u, 'cz', curve, 0.2, dt);
      damp(u, 'enterZ', entered ? 0 : -50, 0.25, dt);
      damp(u, 'opacity', op, focus || !entered ? 0.12 : 0.85, dt);
      m.scale.set(u.w * u.sc, u.h * u.sc, 1);
      m.position.set(x, y, u.cz + u.fz + u.enterZ);
      m.material.uniforms.uOpacity.value = u.opacity;
      m.material.uniforms.uTime.value = time;
      damp(m.material.uniforms.uActive, 'value', rig.active === i ? 1 : 0, rig.active === i ? 0.6 : 0.15, dt);
      m.visible = u.opacity > 0.01;
    }
    bgMesh.material.uniforms.uTime.value = time;
    renderer.render(scene, camera);
  }
  function start(){ if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  function stop(){ running = false; cancelAnimationFrame(raf); }
  var io = new IntersectionObserver(function(es){
    var on = es[0].isIntersecting;
    if (on && !started) { started = true; try { build(); } catch (e) { sec.classList.add('is-static'); io.disconnect(); return; } }
    if (on) start(); else stop();
  }, { threshold: 0.05 });
  io.observe(stage);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage); else window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', function(){ if (document.hidden) stop(); else if (started) start(); });
  window.addEventListener('pagehide', function(){ stop(); if (renderer) { tiles.forEach(function(m){ var tx = m.material.uniforms.uTexture.value; if (tx) tx.dispose(); m.material.dispose(); }); renderer.dispose(); } });
})();`,
};
export default c;
