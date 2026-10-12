// @ts-nocheck
// 3d-15 · Live cube-camera mirror reflections of 3D text (Awwwards Pack).
// The pack demo is an r120-era react-three-fiber scene; rebuilt in three.js r160:
// the word is drawn to a canvas texture on a plane, copies of it ring the scene
// on a layer only a CubeCamera sees, and ten slowly tumbling mirror slabs use
// that cube render target as their env map so the reflections are live.
import type { Component } from "./_types";

const MIRRORS = [
  [2.87, 2.92, 3.12, -2.17, -8.0, 1.25, -1.67, -2.84],
  [1.8, 1.96, -3.33, 3.53, -6.53, 1.4, -0.29, 0.72],
  [2.88, 2.91, 1.28, 2.89, -6.47, -1.33, 2.8, -0.19],
  [2.22, 1.38, 4.55, 0.98, -5.84, -2.33, 0.61, -0.39],
  [1.74, 2.62, -2.83, -3.03, -5.47, -1.41, 3.0, 2.54],
  [1.14, 1.8, -0.04, -1.35, -2.4, 1.28, -0.31, -2.11],
  [2.2, 2.61, -4.15, -0.35, -2.49, 1.44, 1.82, -2.22],
  [2.1, 1.58, 6.57, -2.65, -6.25, 1.19, 0.53, 0.45],
  [1.33, 1.52, 3.68, -4.14, -4.39, -0.77, 1.41, 2.03],
  [5.14, 4.42, 0.65, 7.09, -8.35, -0.07, 1.92, 0.53],
];

const c: Component = {
  id: "3d-15",
  type: "mirror-word",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "mirror-word (3d-15): a full-screen black WebGL stage where one short word in the display face hangs in space while ten slowly tumbling mirror slabs around it reflect copies of the word in real time, with a faint iridescent sheen on their faces; the whole scene leans toward the pointer. A small eyebrow line and a one-sentence caption sit in the lower left. Needs one word of 3-8 letters (the brand name by default) and nothing else; on phones it is the word set large in plain type. Suits studios, agencies, fashion and nightlife brands that want a typographic statement. Heavy: one per site.",
  fields: `{"type":"mirror-word","component":"3d-15","word":"","eyebrow":"","text":""}`,
  css: ({ pair, capsRule }) => `
.mw{position:relative;min-height:100svh;overflow:hidden;background:var(--inv-bg);color:var(--inv-ink);display:grid;align-content:center;padding:7rem var(--gutter) 5rem}
.mw__canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.mw__word{position:relative;z-index:1;text-align:center;font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};font-size:clamp(3rem,14vw,15rem);line-height:1;text-transform:uppercase;transition:opacity .6s}
.mw.is-gl .mw__word{opacity:0}
.mw__copy{position:absolute;left:var(--gutter);bottom:clamp(2rem,6vh,4rem);z-index:2;display:grid;gap:.6rem;max-width:34rem;pointer-events:none}
.mw__copy .mono{color:var(--inv-ink);opacity:.6}
.mw__copy p{opacity:.7;max-width:40ch;${capsRule ? "" : ""}}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .mw{min-height:0;padding:6rem var(--gutter) 3rem;gap:2rem}
  .mw__canvas{display:none}
  .mw.is-gl .mw__word{opacity:1}
  .mw__copy{position:relative;inset:auto}
}`,
  html: (s, { esc, spec }) => {
    const word = String(s.word || spec.brand?.name || "STUDIO").trim().split(/\s+/)[0].slice(0, 12).toUpperCase();
    return `
<section class="mw" data-fx="mirror-word" data-word="${esc(word)}">
  <canvas class="mw__canvas" aria-hidden="true"></canvas>
  <h2 class="mw__word">${esc(word)}</h2>
  <div class="mw__copy">
    ${s.eyebrow ? `<span class="mono">${esc(s.eyebrow)}</span>` : ""}
    ${s.text ? `<p>${esc(s.text)}</p>` : ""}
  </div>
</section>`;
  },
  js: ({ t }) => String.raw`
import * as THREE from "three";
(function(){
  var sec = document.querySelector('[data-fx="mirror-word"]');
  if (!sec) return;
  var canvas = sec.querySelector('.mw__canvas'), wordEl = sec.querySelector('.mw__word');
  var word = sec.getAttribute('data-word') || 'STUDIO';
  function hasGL(){ try { var c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }
  if (!window.__fx.FX || !hasGL()) return;

  var DPR = Math.min(window.devicePixelRatio || 1, 1.5);
  var MIRRORS = ${JSON.stringify(MIRRORS)};
  var renderer, scene, camera, cubeRT, cubeCam, group, mirrors = [], started = false, running = false, raf = 0;
  var mx = 0, my = 0, targetQ = new THREE.Quaternion(), eul = new THREE.Euler(), last = performance.now();

  function textTexture(){
    var cs = getComputedStyle(wordEl);
    var family = cs.fontFamily, weight = cs.fontWeight || '700';
    var cv = document.createElement('canvas'), g = cv.getContext('2d');
    var fs = 300;
    g.font = weight + ' ' + fs + 'px ' + family;
    var w = Math.ceil(g.measureText(word).width);
    var maxW = 3600;
    if (w > maxW) { fs = Math.floor(fs * maxW / w); g.font = weight + ' ' + fs + 'px ' + family; w = Math.ceil(g.measureText(word).width); }
    cv.width = w + 80; cv.height = Math.ceil(fs * 1.25);
    g = cv.getContext('2d');
    g.font = weight + ' ' + fs + 'px ' + family;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '${t.invInk}';
    g.fillText(word, cv.width / 2, cv.height / 2 + fs * 0.04);
    var tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    return { tex: tex, aspect: cv.width / cv.height };
  }

  function size(){
    var w = sec.clientWidth, h = sec.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (group) group.scale.setScalar(w < 1100 ? Math.max(0.6, w / 1100) : 1);
  }

  function init(){
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(DPR);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.NoToneMapping;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    group = new THREE.Group(); scene.add(group);

    var tt = textTexture();
    var H = 3.4, W = H * tt.aspect;
    var titleMat = new THREE.MeshBasicMaterial({ map: tt.tex, transparent: true, toneMapped: false, side: THREE.DoubleSide, depthTest: false });
    var titleGeo = new THREE.PlaneGeometry(W, H);
    var title = new THREE.Mesh(titleGeo, titleMat); title.position.set(0, 0, -10); title.renderOrder = 2; group.add(title);

    // copies only the cube camera sees (layer 11), at the 12 vertices of an icosahedron
    var phi = (1 + Math.sqrt(5)) / 2, s = 10 / Math.sqrt(1 + phi * phi), verts = [];
    [[0, 1, phi], [0, -1, phi], [0, 1, -phi], [0, -1, -phi], [1, phi, 0], [-1, phi, 0], [1, -phi, 0], [-1, -phi, 0], [phi, 0, 1], [-phi, 0, 1], [phi, 0, -1], [-phi, 0, -1]].forEach(function(v){ verts.push(new THREE.Vector3(v[0] * s, v[1] * s, v[2] * s)); });
    var copyMat = new THREE.MeshBasicMaterial({ map: tt.tex, transparent: true, toneMapped: false, side: THREE.DoubleSide });
    verts.forEach(function(v){ var m = new THREE.Mesh(titleGeo, copyMat); m.position.copy(v); m.lookAt(0, 0, 0); m.layers.set(11); group.add(m); });
    var back = new THREE.Mesh(new THREE.SphereGeometry(30, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color('${t.dark ? "#3a3a3c" : "#2a2a30"}'), side: THREE.BackSide }));
    back.layers.set(11); group.add(back);

    cubeRT = new THREE.WebGLCubeRenderTarget(512, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    cubeCam = new THREE.CubeCamera(0.1, 100, cubeRT);
    cubeCam.children.forEach(function(c){ c.layers.set(11); });
    cubeCam.position.set(0, 0, 2);
    group.add(cubeCam);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    var pl = new THREE.PointLight(0xffffff, 60, 0, 1.6); pl.position.set(2, 4, 6); scene.add(pl);
    var faceMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.03, envMap: cubeRT.texture, envMapIntensity: 1.6, iridescence: 0.5, iridescenceIOR: 1.35, iridescenceThicknessRange: [120, 560] });
    var sideMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, metalness: 0.9, roughness: 0.4, envMap: cubeRT.texture, envMapIntensity: 0.6 });
    MIRRORS.forEach(function(d){
      var m = new THREE.Mesh(new THREE.BoxGeometry(d[0], d[1], 0.05), [sideMat, sideMat, sideMat, sideMat, faceMat, faceMat]);
      m.position.set(d[2], d[3], d[4]); m.rotation.set(d[5], d[6], d[7]);
      group.add(m); mirrors.push(m);
    });

    size();
    if (window.ResizeObserver) new ResizeObserver(size).observe(sec);
    sec.addEventListener('pointermove', function(e){ var r = sec.getBoundingClientRect(); mx = ((e.clientX - r.left) / r.width - 0.5) * 2; my = ((e.clientY - r.top) / r.height - 0.5) * 2; });
    sec.classList.add('is-gl');
  }

  function render(){
    var now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    var k = dt * 60;
    mirrors.forEach(function(m){ m.rotation.y += 0.001 * k; m.rotation.z += 0.01 * k; });
    eul.set(my * 0.18, mx * 0.28, 0);
    targetQ.setFromEuler(eul);
    group.quaternion.slerp(targetQ, 0.08);
    cubeCam.update(renderer, scene);
    renderer.render(scene, camera);
  }
  function loop(){ if (!running) return; raf = requestAnimationFrame(loop); render(); }

  var io = new IntersectionObserver(function(es){
    es.forEach(function(en){
      if (en.isIntersecting) {
        if (!started) { started = true; (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(function(){ try { init(); if (running) loop(); } catch (e) { sec.classList.remove('is-gl'); running = false; io.disconnect(); } }); }
        if (!running) { running = true; if (renderer) loop(); }
      } else { running = false; cancelAnimationFrame(raf); }
    });
  }, { rootMargin: '120px' });
  io.observe(sec);

  window.addEventListener('pagehide', function(){
    running = false; cancelAnimationFrame(raf);
    if (!renderer) return;
    scene.traverse(function(o){ if (o.geometry) o.geometry.dispose(); var m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach(function(mm){ for (var k in mm) if (mm[k] && mm[k].isTexture) mm[k].dispose(); mm.dispose(); }); });
    cubeRT.dispose(); renderer.dispose();
  }, { once: true });
})();`,
};
export default c;
