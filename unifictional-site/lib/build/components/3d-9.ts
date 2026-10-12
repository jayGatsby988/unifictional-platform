// @ts-nocheck
// 3d-9 · Ordered-dither post-processing on a floating 3D model (Awwwards Pack).
// The pack demo is React/R3F + the `postprocessing` library; rebuilt here as a
// two-pass three.js r160 module: scene -> render target -> 4x4 Bayer dither quad
// drawn in the theme's two colours (ink on bg). Optional GLB `model`, else a
// metal torus knot.
import type { Component } from "./_types";

const isModel = (u) => typeof u === "string" && /^https?:\/\/.+\.(glb|gltf)(\?.*)?$/i.test(u);

const c: Component = {
  id: "3d-9",
  type: "dither-model",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "dither-model (3d-9): a full-screen WebGL stage where a metallic 3D object floats and slowly turns, drawn entirely as coarse black-and-white ordered-dither pixels in the theme's ink and background colours, like a 1-bit print; moving the pointer tilts it and dragging spins it. Headline and a short paragraph sit in the lower left. Takes an optional .glb model URL (a product, a tool, a logo), otherwise it shows a chunky torus knot. No photos needed. Suits design studios, fabrication shops, product makers and brands that want a bold graphic 3D moment; it is heavy, so only one per site.",
  fields: `{"type":"dither-model","component":"3d-9","eyebrow":"","headline":"","text":"","model":""}`,
  css: ({ pair, capsRule }) => `
.dm{position:relative;min-height:100svh;overflow:hidden;background:var(--bg);display:grid;align-content:end;padding:7rem var(--gutter) clamp(2.5rem,7vh,5rem)}
.dm__canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab;touch-action:none}
.dm__canvas:active{cursor:grabbing}
.dm__fallback{position:absolute;inset:0;display:none;align-items:center;justify-content:center;pointer-events:none}
.dm__fallback i{display:block;width:min(60vmin,34rem);aspect-ratio:1;border-radius:50%;background:radial-gradient(circle at 35% 30%,var(--bg) 0 18%,transparent 19%),radial-gradient(circle,var(--ink) 1.2px,transparent 1.6px) 0 0/6px 6px;-webkit-mask:radial-gradient(circle at 35% 30%,#000 0 20%,rgba(0,0,0,.9) 45%,rgba(0,0,0,.3) 70%,transparent 72%);mask:radial-gradient(circle at 35% 30%,#000 0 20%,rgba(0,0,0,.9) 45%,rgba(0,0,0,.3) 70%,transparent 72%)}
.dm.is-static .dm__canvas{display:none}
.dm.is-static .dm__fallback{display:flex}
.dm__copy{position:relative;z-index:2;display:grid;gap:1rem;max-width:40rem;pointer-events:none}
.dm__copy>*{pointer-events:auto}
.dm__copy h2{font-size:clamp(2.2rem,5.5vw,5rem);font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};line-height:.95;${capsRule}}
.dm__copy p{max-width:44ch;color:var(--ink2);font-size:clamp(1rem,1.3vw,1.2rem)}
.dm__hint{position:absolute;right:var(--gutter);bottom:2rem;z-index:2;font-family:var(--mono);font-size:.65rem;letter-spacing:.2em;text-transform:uppercase;color:var(--ink3)}
.dm.is-static .dm__hint{display:none}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .dm{min-height:0;padding:5rem var(--gutter) 3rem;align-content:start;gap:2rem}
  .dm__canvas,.dm__hint{display:none}
  .dm__fallback{position:relative;display:flex;order:-1;padding:1rem 0}
  .dm__fallback i{width:min(70vw,20rem)}
}`,
  html: (s, { esc }) => `
<section class="dm" data-fx="dither-model"${isModel(s.model) ? ` data-model="${esc(s.model)}"` : ""}>
  <canvas class="dm__canvas" aria-hidden="true"></canvas>
  <div class="dm__fallback" aria-hidden="true"><i></i></div>
  <div class="dm__copy">
    ${s.eyebrow ? `<span class="mono reveal">${esc(s.eyebrow)}</span>` : ""}
    <h2 class="reveal">${esc(s.headline || "")}</h2>
    ${s.text ? `<p class="reveal">${esc(s.text)}</p>` : ""}
  </div>
  <div class="dm__hint">Drag to turn</div>
</section>`,
  js: ({ t }) => String.raw`
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
(function(){
  var sec = document.querySelector('[data-fx="dither-model"]');
  if (!sec) return;
  var canvas = sec.querySelector('.dm__canvas');
  function hasGL(){ try { var c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }
  if (!window.__fx.FX || !hasGL()) { sec.classList.add('is-static'); return; }

  var renderer, scene, camera, rt, quad, quadScene, quadCam, obj, pmrem, started = false, running = false, raf = 0;
  var DPR = Math.min(window.devicePixelRatio || 1, 1.5);
  var rot = { x: 0, y: 0 }, target = { x: 0, y: 0 }, spin = 0, dragging = false, last = null, t0 = performance.now();

  function srgb(s){ var c = new THREE.Color(s).convertLinearToSRGB(); return new THREE.Vector3(c.r, c.g, c.b); }

  var VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  var FS = [
    'precision highp float;',
    'uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uGrid; uniform vec3 uInk; uniform vec3 uBg;',
    'varying vec2 vUv;',
    'float thr(int x, int y){',
    ' if (x == 0) { if (y == 0) return 16.0/17.0; if (y == 1) return 5.0/17.0; if (y == 2) return 13.0/17.0; return 1.0/17.0; }',
    ' if (x == 1) { if (y == 0) return 8.0/17.0; if (y == 1) return 12.0/17.0; if (y == 2) return 4.0/17.0; return 9.0/17.0; }',
    ' if (x == 2) { if (y == 0) return 14.0/17.0; if (y == 1) return 2.0/17.0; if (y == 2) return 15.0/17.0; return 3.0/17.0; }',
    ' if (y == 0) return 6.0/17.0; if (y == 1) return 10.0/17.0; if (y == 2) return 7.0/17.0; return 11.0/17.0;',
    '}',
    'void main(){',
    ' vec2 fc = vUv * uRes;',
    ' vec2 cell = floor(fc / uGrid);',
    ' vec2 suv = (cell + 0.5) * uGrid / uRes;',
    ' vec4 c = texture2D(tDiffuse, suv);',
    ' float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));',
    ' lum = pow(clamp(lum, 0.0, 1.0), 0.55);',
    ' vec2 p = mod(cell, 4.0);',
    ' float dark = lum < thr(int(p.x), int(p.y)) ? 1.0 : 0.0;',
    ' if (lum > 16.0/17.0) dark = 0.0;',
    ' if (lum < 1.0/17.0) dark = 1.0;',
    ' gl_FragColor = vec4(mix(uBg, uInk, dark), 1.0);',
    '}'
  ].join('\n');

  function size(){
    var w = sec.clientWidth, h = sec.clientHeight;
    renderer.setSize(w, h, false);
    rt.setSize(Math.floor(w * DPR), Math.floor(h * DPR));
    camera.aspect = w / h; camera.updateProjectionMatrix();
    quad.material.uniforms.uRes.value.set(Math.floor(w * DPR), Math.floor(h * DPR));
    quad.material.uniforms.uGrid.value = Math.max(2, Math.round(2.6 * DPR));
  }

  function fallbackMesh(){
    var g = new THREE.TorusKnotGeometry(1, 0.34, 240, 36, 2, 3);
    var m = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.9, roughness: 0.3 });
    var mesh = new THREE.Mesh(g, m);
    mesh.scale.setScalar(0.95);
    return mesh;
  }

  function fit(root){
    var box = new THREE.Box3().setFromObject(root);
    var c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    var max = Math.max(s.x, s.y, s.z) || 1;
    root.position.sub(c);
    var holder = new THREE.Group();
    holder.add(root);
    holder.scale.setScalar(2.6 / max);
    return holder;
  }

  function init(){
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(DPR);
    renderer.setClearColor(0xffffff, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.5;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);
    camera.position.set(0, 0.2, 8.4);
    pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    var key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 5, 4); scene.add(key);
    var rim = new THREE.DirectionalLight(0xffffff, 0.8); rim.position.set(-4, -2, -3); scene.add(rim);

    rt = new THREE.WebGLRenderTarget(2, 2, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    quadScene = new THREE.Scene();
    quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: rt.texture }, uRes: { value: new THREE.Vector2(1, 1) }, uGrid: { value: 4 }, uInk: { value: srgb('${t.ink}') }, uBg: { value: srgb('${t.bg}') } }
    }));
    quadScene.add(quad);

    obj = new THREE.Group();
    obj.position.y = 0.6;
    scene.add(obj);
    var url = sec.getAttribute('data-model');
    if (url) {
      var loader = new GLTFLoader();
      var draco = new DRACOLoader(); draco.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/'); loader.setDRACOLoader(draco);
      loader.setCrossOrigin('anonymous');
      loader.load(url, function(gltf){ obj.add(fit(gltf.scene)); }, undefined, function(){ obj.add(fallbackMesh()); });
    } else {
      obj.add(fallbackMesh());
    }

    size();
    if (window.ResizeObserver) new ResizeObserver(size).observe(sec);

    sec.addEventListener('pointermove', function(e){
      if (dragging) return;
      var r = sec.getBoundingClientRect();
      target.y = ((e.clientX - r.left) / r.width - 0.5) * 0.9;
      target.x = ((e.clientY - r.top) / r.height - 0.5) * 0.6;
    });
    canvas.addEventListener('pointerdown', function(e){ dragging = true; last = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', function(e){
      if (!dragging || !last) return;
      spin += (e.clientX - last[0]) * 0.012;
      target.x += (e.clientY - last[1]) * 0.006;
      last = [e.clientX, e.clientY];
    });
    function up(){ dragging = false; last = null; }
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  }

  function render(){
    var tt = (performance.now() - t0) / 1000;
    rot.x += (target.x - rot.x) * 0.06;
    rot.y += (target.y - rot.y) * 0.06;
    obj.rotation.x = rot.x + Math.sin(tt * 0.7) * 0.12 - 0.35;
    obj.rotation.y = rot.y + spin + tt * 0.25;
    obj.rotation.z = Math.sin(tt * 0.5) * 0.08 - 0.25;
    obj.position.y = 0.6 + Math.sin(tt * 1.4) * 0.14;
    obj.position.x = camera.aspect > 1.1 ? 1.4 * Math.min(1, (camera.aspect - 1.1) * 1.6) : 0;
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(quadScene, quadCam);
  }
  function loop(){ if (!running) return; raf = requestAnimationFrame(loop); render(); }

  var io = new IntersectionObserver(function(es){
    es.forEach(function(en){
      if (en.isIntersecting) {
        if (!started) { started = true; try { init(); } catch (e) { sec.classList.add('is-static'); io.disconnect(); return; } }
        if (!running) { running = true; loop(); }
      } else { running = false; cancelAnimationFrame(raf); }
    });
  }, { rootMargin: '120px' });
  io.observe(sec);

  window.addEventListener('pagehide', function(){
    running = false; cancelAnimationFrame(raf);
    if (!renderer) return;
    scene.traverse(function(o){ if (o.geometry) o.geometry.dispose(); var m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach(function(mm){ for (var k in mm) if (mm[k] && mm[k].isTexture) mm[k].dispose(); mm.dispose(); }); });
    quad.geometry.dispose(); quad.material.dispose(); rt.dispose(); pmrem.dispose(); renderer.dispose();
  }, { once: true });
})();`,
};
export default c;
