// @ts-nocheck
// 3d-17 · Fixed GLB model tumbling with page scroll (Awwwards Pack).
// Rebuilt from the pack's plain three.js r128 demo: a transparent WebGL stage
// sticks to the viewport behind a long run of text blocks; the model bobs and
// somersaults twice (rotation.x = progress * 4π) as the section scrolls by.
// Optional `model` (.glb); otherwise an extruded brand-coloured octagon.
import type { Component } from "./_types";

const isModel = (u) => typeof u === "string" && /^https?:\/\/.+\.(glb|gltf)(\?.*)?$/i.test(u);

const c: Component = {
  id: "3d-17",
  type: "scroll-tumble",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "scroll-tumble (3d-17): a long editorial run of 2-4 text blocks (each a title and a short paragraph, alternating left and right) with a 3D object floating fixed in the middle of the screen behind them; it scales up when the section arrives, bobs gently, and somersaults forward through two full turns as you scroll to the end. Takes an optional .glb product model URL (a chair, a tool, a bottle, a logo); without one it shows a glossy extruded octagon in the accent colour. An optional headline opens the run. No photos needed. Suits furniture and product makers, fabricators, hardware and any brand with one object to show off. Heavy: one per site.",
  fields: `{"type":"scroll-tumble","component":"3d-17","eyebrow":"","headline":"","model":"","items":[{"title":"","text":""},{"title":"","text":""},{"title":"","text":""}]}`,
  css: ({ pair, capsRule }) => `
.tum{position:relative;background:var(--bg)}
.tum__stage{position:sticky;top:0;height:100svh;overflow:hidden;pointer-events:none;z-index:0}
.tum__canvas{position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;transition:opacity .8s}
.tum.is-gl .tum__canvas{opacity:1}
.tum__mark{position:absolute;top:50%;left:50%;width:min(36vmin,18rem);aspect-ratio:1;transform:translate(-50%,-50%);background:var(--accent);clip-path:polygon(30% 0,70% 0,100% 30%,100% 70%,70% 100%,30% 100%,0 70%,0 30%);opacity:.9}
.tum.is-gl .tum__mark{display:none}
.tum__blocks{position:relative;z-index:1;margin-top:-100svh;padding:0 var(--gutter)}
.tum__block{min-height:100svh;display:grid;grid-template-columns:repeat(12,1fr);align-content:center;padding:4rem 0}
.tum__block>div{grid-column:1/6;display:grid;gap:1rem}
.tum__block:nth-child(even)>div{grid-column:8/13}
.tum__block.is-head>div{grid-column:1/10}
.tum__block h2{font-size:clamp(2.6rem,7vw,7rem);font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};line-height:.95;${capsRule}}
.tum__block h3{font-size:clamp(1.8rem,3.4vw,3.2rem);font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};line-height:1;${capsRule}}
.tum__block p{max-width:38ch;color:var(--ink2);font-size:clamp(1rem,1.25vw,1.15rem)}
.tum__block .mono{color:var(--ink3)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .tum__stage{position:relative;height:auto;padding:5rem 0 1rem}
  .tum__canvas{display:none}
  .tum__mark{position:relative;top:auto;left:auto;transform:none;margin:0 auto;width:min(40vw,12rem)}
  .tum__blocks{margin-top:0;padding:1rem var(--gutter) 3rem}
  .tum__block{min-height:0;display:block;padding:2.5rem 0}
}`,
  html: (s, { esc }) => {
    const items = (s.items || []).slice(0, 4);
    return `
<section class="tum" data-fx="scroll-tumble"${isModel(s.model) ? ` data-model="${esc(s.model)}"` : ""}>
  <div class="tum__stage"><canvas class="tum__canvas" aria-hidden="true"></canvas><div class="tum__mark" aria-hidden="true"></div></div>
  <div class="tum__blocks">
    ${s.headline ? `<div class="tum__block is-head"><div>${s.eyebrow ? `<span class="mono reveal">${esc(s.eyebrow)}</span>` : ""}<h2 class="reveal">${esc(s.headline)}</h2></div></div>` : ""}
    ${items.map((it, i) => `<div class="tum__block"><div><span class="mono reveal">${String(i + 1).padStart(2, "0")}</span><h3 class="reveal">${esc(it.title || "")}</h3>${it.text ? `<p class="reveal">${esc(it.text)}</p>` : ""}</div></div>`).join("")}
  </div>
</section>`;
  },
  js: ({ t }) => String.raw`
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
(function(){
  var sec = document.querySelector('[data-fx="scroll-tumble"]');
  if (!sec) return;
  var canvas = sec.querySelector('.tum__canvas'), stage = sec.querySelector('.tum__stage');
  function hasGL(){ try { var c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }
  if (!window.__fx.FX || !hasGL()) return;

  var DPR = Math.min(window.devicePixelRatio || 1, 1.5);
  var renderer, scene, camera, pmrem, model, started = false, running = false, raf = 0;
  var progress = 0, t0 = performance.now();

  function size(){
    var w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    camera.position.z = w < 1000 ? 9.6 : 7.8;
  }

  function fallback(){
    var shape = new THREE.Shape(), n = 8, r = 1.15;
    for (var i = 0; i < n; i++) { var a = Math.PI / 8 + (i / n) * Math.PI * 2; var x = Math.cos(a) * r, y = Math.sin(a) * r; if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y); }
    shape.closePath();
    var geo = new THREE.ExtrudeGeometry(shape, { depth: 0.55, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.14, bevelSegments: 8, curveSegments: 8 });
    geo.center();
    var mat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('${t.accent}'), metalness: 0.15, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.15 });
    var mesh = new THREE.Mesh(geo, mat);
    var g = new THREE.Group(); g.add(mesh);
    var ring = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.07, 16, 64), new THREE.MeshStandardMaterial({ color: new THREE.Color('${t.ink}'), metalness: 0.9, roughness: 0.3 }));
    g.add(ring);
    return g;
  }

  function fit(root){
    var box = new THREE.Box3().setFromObject(root);
    var c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    root.position.sub(c);
    var holder = new THREE.Group(); holder.add(root); holder.scale.setScalar(3.4 / (Math.max(s.x, s.y, s.z) || 1));
    return holder;
  }

  function place(obj){
    model = new THREE.Group(); model.add(obj); scene.add(model);
    model.scale.setScalar(0.001);
    gsap.to(model.scale, { x: 1, y: 1, z: 1, duration: 1.1, ease: 'power2.out' });
    sec.classList.add('is-gl');
  }

  function init(){
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(DPR);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 0.6));
    var key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(1, 6, 3); scene.add(key);
    var fill = new THREE.DirectionalLight(0xffffff, 0.6); fill.position.set(-6, 0, -3); scene.add(fill);

    var url = sec.getAttribute('data-model');
    if (url) {
      var loader = new GLTFLoader(); var draco = new DRACOLoader(); draco.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/'); loader.setDRACOLoader(draco); loader.setCrossOrigin('anonymous');
      loader.load(url, function(g){ place(fit(g.scene)); }, undefined, function(){ place(fallback()); });
    } else place(fallback());

    size();
    if (window.ResizeObserver) new ResizeObserver(size).observe(stage);
    ScrollTrigger.create({ trigger: sec, start: 'top top', end: 'bottom bottom', onUpdate: function(st){ progress = st.progress; } });
  }

  function render(){
    if (model) {
      var tt = (performance.now() - t0) / 1000;
      model.position.y = Math.sin(tt * 1.5) * 0.2;
      model.rotation.x = progress * Math.PI * 4 + 0.5;
      model.rotation.y = 0.35 + Math.sin(tt * 0.4) * 0.15;
    }
    renderer.render(scene, camera);
  }
  function loop(){ if (!running) return; raf = requestAnimationFrame(loop); render(); }

  var io = new IntersectionObserver(function(es){
    es.forEach(function(en){
      if (en.isIntersecting) {
        if (!started) { started = true; try { init(); } catch (e) { sec.classList.remove('is-gl'); io.disconnect(); return; } }
        if (!running) { running = true; loop(); }
      } else { running = false; cancelAnimationFrame(raf); }
    });
  }, { rootMargin: '120px' });
  io.observe(sec);

  window.addEventListener('pagehide', function(){
    running = false; cancelAnimationFrame(raf);
    if (!renderer) return;
    scene.traverse(function(o){ if (o.geometry) o.geometry.dispose(); var m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach(function(mm){ for (var k in mm) if (mm[k] && mm[k].isTexture) mm[k].dispose(); mm.dispose(); }); });
    pmrem.dispose(); renderer.dispose();
  }, { once: true });
})();`,
};
export default c;
