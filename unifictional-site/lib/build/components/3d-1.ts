// @ts-nocheck
// 3d-1 · Extruded 3D glyph grid reacting to the cursor (Awwwards Pack, video
// only). A tilted grid of heavy extruded letters (the brand word, repeated) on
// a black stage; a point light rides with the pointer so near glyphs turn white
// while far ones stay dark grey, and each glyph swells, lifts and tilts toward
// the cursor. three.js r160 TextGeometry with the helvetiker_bold typeface that
// ships with three; lazy init, DPR cap 1.5, static display-type fallback.
import type { Component } from "./_types";

const FONT_URL = "https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json";
const SHADOW = Array.from({ length: 14 }, (_, i) => `${i + 1}px ${i + 1}px 0 ${i < 3 ? "#4a4a4a" : "#2a2a2a"}`).join(",");

const c: Component = {
  id: "3d-1",
  type: "glyph-grid-3d",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "(recreated from the preview video) glyph-grid-3d (3d-1): a full-screen black stage filled with a tilted grid of twenty heavy, deeply extruded 3D letters spelling the brand word over and over, lit by a single light that follows the mouse: letters near the pointer swell, lift off the grid, tilt toward it and turn bright white, while the rest sink into dark grey and the whole block drifts gently against the cursor. With no pointer the light roams on its own. Needs one word of 3-12 letters (defaults to the brand name), an optional small label and an optional one or two sentence text in the corners; no photos. A bold signature moment for studios, agencies, type-led brands, fitness, nightlife and events. Phones and no-WebGL browsers get the word in huge extruded-looking type on black.",
  fields: `{"type":"glyph-grid-3d","component":"3d-1","word":"","label":"","text":""}`,
  css: ({ pair }) => `
.glyphs{position:relative;height:100svh;min-height:560px;overflow:hidden;background:#050505;color:#f2f1ec;display:grid;align-content:end}
.glyphs canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:crosshair}
.glyphs__label{position:absolute;left:var(--gutter);top:clamp(6rem,14vh,8rem);z-index:2;font-family:var(--mono);font-size:.68rem;letter-spacing:.18em;text-transform:uppercase;color:rgba(242,241,236,.6)}
.glyphs__text{position:relative;z-index:2;padding:0 var(--gutter) clamp(2rem,6vh,4rem);max-width:38ch;color:rgba(242,241,236,.72);font-size:1rem;pointer-events:none}
.glyphs__static{display:none}
.glyphs.is-static canvas{display:none}
.glyphs.is-static .glyphs__static{display:flex;align-items:center;justify-content:center;position:absolute;inset:0;padding:0 var(--gutter);transform:perspective(900px) rotateX(18deg) rotateY(-8deg)}
.glyphs__static span{font-family:var(--display);font-weight:${pair.weight};text-transform:uppercase;font-size:clamp(3rem,15vw,15rem);line-height:1;letter-spacing:.02em;color:#c9c9c9;text-shadow:${SHADOW};text-align:center;word-break:break-all}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .glyphs{height:auto;min-height:100svh;padding-top:7rem}
  .glyphs canvas{display:none}
  .glyphs__static{display:flex;position:relative;inset:auto;align-items:center;justify-content:center;padding:4rem var(--gutter);transform:perspective(700px) rotateX(14deg)}
  .glyphs__static span{font-size:clamp(3rem,18vw,8rem)}
  .glyphs__label{position:static;padding:0 var(--gutter)}
}`,
  html: (s, { spec, esc }) => {
    const raw = String(s.word || (spec.brand && spec.brand.name) || "STUDIO").toUpperCase().trim().split(/\s+/)[0].replace(/[^A-Z0-9]/g, "");
    const word = (raw.length >= 2 ? raw : "STUDIO").slice(0, 12);
    return `
<section class="glyphs" data-fx="glyph-grid-3d" data-word="${esc(word)}">
  <canvas aria-hidden="true"></canvas>
  ${s.label ? `<div class="glyphs__label">${esc(s.label)}</div>` : ""}
  <div class="glyphs__static" aria-hidden="true"><span>${esc(word)}</span></div>
  ${s.text ? `<p class="glyphs__text">${esc(s.text)}</p>` : ""}
  <span class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">${esc(word)}</span>
</section>`;
  },
  js: () => `
import * as THREE from "three";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
(function(){
  var sec = document.querySelector('[data-fx="glyph-grid-3d"]');
  if (!sec) return;
  var canvas = sec.querySelector('canvas'), word = sec.getAttribute('data-word') || 'STUDIO';
  var gl = null;
  if (window.__fx.FX) { try { gl = canvas.getContext('webgl2', { antialias: true, alpha: true, powerPreference: 'high-performance' }); } catch (e) { gl = null; } }
  if (!gl) { sec.classList.add('is-static'); return; }
  var COLS = 5, ROWS = 4, SX = 1.78, SY = 1.95;
  var renderer, scene, camera, group, light, meshes = [], running = false, started = false, raf = 0, last = 0, t0 = 0;
  var pointer = { x: 0, y: 0, on: false, idle: 0 }, target = new THREE.Vector3(0, 0, 0), cur = new THREE.Vector3(0, 0, 0);
  var ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(), hit = new THREE.Vector3();
  function build(){
    renderer = new THREE.WebGLRenderer({ canvas: canvas, context: gl, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x050505, 1);
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x050505, 9, 19);
    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);
    camera.position.set(0, -0.4, 11.5);
    camera.lookAt(0, 0, 0);
    group = new THREE.Group();
    group.rotation.set(-0.3, 0.16, 0.03);
    scene.add(group);
    scene.add(new THREE.AmbientLight(0xffffff, 0.08));
    var key = new THREE.DirectionalLight(0xffffff, 0.35); key.position.set(-3, 5, 6); scene.add(key);
    light = new THREE.PointLight(0xffffff, 90, 0, 2); light.position.set(0, 0, 3); group.add(light);
    var mat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.55, metalness: 0.04 });
    new FontLoader().load('${FONT_URL}', function(font){
      var cache = {};
      for (var r = 0; r < ROWS; r++) for (var cI = 0; cI < COLS; cI++) {
        var i = r * COLS + cI, ch = word[i % word.length];
        var geo = cache[ch];
        if (!geo) {
          geo = new TextGeometry(ch, { font: font, size: 1.15, height: 0.95, curveSegments: 5, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 2 });
          geo.computeBoundingBox(); var bb = geo.boundingBox;
          geo.translate(-(bb.max.x + bb.min.x) / 2, -(bb.max.y + bb.min.y) / 2, -(bb.max.z + bb.min.z) / 2);
          cache[ch] = geo;
        }
        var m = new THREE.Mesh(geo, mat);
        var bx = (cI - (COLS - 1) / 2) * SX, by = ((ROWS - 1) / 2 - r) * SY;
        m.position.set(bx, by, 0); m.scale.setScalar(0.001);
        m.userData = { bx: bx, by: by, z: 0, s: 0, rx: 0, ry: 0, delay: (Math.abs(bx) + Math.abs(by)) * 90 };
        group.add(m); meshes.push(m);
      }
      t0 = performance.now();
    }, undefined, function(){ sec.classList.add('is-static'); stop(); });
    resize();
  }
  function resize(){ if (!renderer) return; var w = sec.clientWidth, h = sec.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.position.z = 11.8 + Math.max(0, 1.7 - w / h) * 5; camera.updateProjectionMatrix(); }
  function aim(){
    // Pointer (or the idle path) projected onto the glyph plane, in group space.
    if (pointer.on) { ndc.set(pointer.x, pointer.y); }
    else { var tt = performance.now() / 1000; ndc.set(Math.sin(tt * 0.35) * 0.75, Math.cos(tt * 0.27) * 0.55); }
    ray.setFromCamera(ndc, camera);
    var n = new THREE.Vector3(0, 0, 1).applyQuaternion(group.quaternion);
    plane.setFromNormalAndCoplanarPoint(n, group.position);
    if (ray.ray.intersectPlane(plane, hit)) { group.worldToLocal(hit); target.set(hit.x, hit.y, 0); }
  }
  function frame(now){
    if (!running) return;
    raf = requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    aim();
    cur.lerp(target, 1 - Math.exp(-dt * 6));
    light.position.set(cur.x, cur.y, 3.2);
    group.position.x += ((-cur.x * 0.12) - group.position.x) * 0.04;
    group.position.y += ((-cur.y * 0.08) - group.position.y) * 0.04;
    var since = now - t0;
    for (var i = 0; i < meshes.length; i++) {
      var m = meshes[i], u = m.userData;
      var dx = cur.x - u.bx, dy = cur.y - u.by, d = Math.hypot(dx, dy);
      var t = Math.max(0, Math.min(1, 1 - d / 3.4)), inf = t * t * (3 - 2 * t);
      var rev = Math.max(0, Math.min(1, (since - u.delay) / 800)); rev = 1 - Math.pow(1 - rev, 3);
      var k = 1 - Math.exp(-dt * 7);
      u.z += (inf * 1.15 - u.z) * k; u.s += ((1 + inf * 0.32) - u.s) * k;
      u.ry += (Math.max(-0.6, Math.min(0.6, dx * 0.26 * inf)) - u.ry) * k;
      u.rx += (Math.max(-0.6, Math.min(0.6, -dy * 0.26 * inf)) - u.rx) * k;
      m.position.set(u.bx, u.by, u.z);
      m.rotation.set(u.rx, u.ry, 0);
      m.scale.setScalar(Math.max(0.001, u.s * rev));
    }
    renderer.render(scene, camera);
  }
  function start(){ if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  function stop(){ running = false; cancelAnimationFrame(raf); }
  sec.addEventListener('pointermove', function(e){ var r = sec.getBoundingClientRect(); pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1; pointer.y = -(((e.clientY - r.top) / r.height) * 2 - 1); pointer.on = true; });
  sec.addEventListener('pointerleave', function(){ pointer.on = false; });
  var io = new IntersectionObserver(function(es){
    var on = es[0].isIntersecting;
    if (on && !started) { started = true; try { build(); } catch (e) { sec.classList.add('is-static'); io.disconnect(); return; } }
    if (on) start(); else stop();
  }, { threshold: 0.05 });
  io.observe(sec);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(sec); else window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', function(){ if (document.hidden) stop(); else if (started) start(); });
  window.addEventListener('pagehide', function(){ stop(); if (renderer) { meshes.forEach(function(m){ m.geometry.dispose(); }); renderer.dispose(); } });
})();`,
};
export default c;
