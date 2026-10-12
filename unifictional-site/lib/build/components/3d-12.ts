// @ts-nocheck
// 3d-12 · Floating poster gallery around a rotating 3D object (Awwwards Pack, video only).
// Rebuilt from the storyboard: three rings of poster planes in a dark void with a
// faint wire grid; a dark faceted centrepiece reflects them through a CubeCamera
// env map; page scroll turns the rings and drifts the camera, the pointer nudges it.
import type { Component } from "./_types";

const isModel = (u) => typeof u === "string" && /^https?:\/\/.+\.(glb|gltf)(\?.*)?$/i.test(u);

const c: Component = {
  id: "3d-12",
  type: "poster-orbit",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "(recreated from the preview video) poster-orbit (3d-12): the page pins on a near-black WebGL void with a faint curved wire grid, where three stacked rings of floating poster images hang around a dark, glossy, faceted object that slowly turns and picks their colours up in its facets. Scrolling spins the rings a full turn and drifts the camera down through them, so single posters sweep past close to the screen; the pointer nudges the view. Headline and a short line sit over the scene, and a static poster grid replaces it on phones. Needs 6-12 portrait images (project shots, campaign stills, product photos) each with a short title; an optional .glb model can replace the faceted object. Suits galleries, agencies, fashion and music brands and portfolios with lots of imagery. Heavy: one per site.",
  fields: `{"type":"poster-orbit","component":"3d-12","eyebrow":"","headline":"","text":"","model":"","images":[{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""}]}`,
  images: { min: 6, max: 12 },
  css: ({ pair, capsRule }) => `
.po{position:relative;height:320svh;background:var(--inv-bg);color:var(--inv-ink)}
.po__stage{position:sticky;top:0;height:100svh;overflow:hidden}
.po__canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.po__copy{position:absolute;left:var(--gutter);bottom:clamp(2rem,6vh,4rem);z-index:2;display:grid;gap:.9rem;max-width:36rem;pointer-events:none}
.po__copy .mono{color:var(--inv-ink);opacity:.6}
.po__copy h2{font-size:clamp(2rem,5vw,4.6rem);font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};line-height:.95;${capsRule}}
.po__copy p{max-width:42ch;opacity:.7;font-size:clamp(1rem,1.3vw,1.15rem)}
.po__hint{position:absolute;right:var(--gutter);bottom:2rem;z-index:2;font-family:var(--mono);font-size:.65rem;letter-spacing:.2em;text-transform:uppercase;opacity:.5;display:flex;align-items:center;gap:.8rem}
.po__hint i{width:1px;height:40px;background:currentColor;display:block}
.po__grid{display:none;grid-template-columns:repeat(auto-fill,minmax(9rem,1fr));gap:.8rem;padding:2rem var(--gutter) 0}
.po__grid figure{margin:0;display:grid;gap:.4rem}
.po__grid img{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;background:#222}
.po__grid figcaption{font-family:var(--mono);font-size:.62rem;letter-spacing:.12em;text-transform:uppercase;opacity:.6}
.po.is-static{height:auto;padding:5rem 0 4rem}
.po.is-static .po__stage{position:relative;height:auto;overflow:visible;padding-top:0}
.po.is-static .po__canvas,.po.is-static .po__hint{display:none}
.po.is-static .po__copy{position:relative;inset:auto;padding:0 var(--gutter)}
.po.is-static .po__grid{display:grid}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .po{height:auto;padding:5rem 0 4rem}
  .po__stage{position:relative;height:auto;overflow:visible}
  .po__canvas,.po__hint{display:none}
  .po__copy{position:relative;inset:auto;padding:0 var(--gutter)}
  .po__grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem}
}`,
  html: (s, { esc, imgUrl }) => {
    const imgs = (s.images || []).filter(im => im && im.url).slice(0, 12);
    return `
<section class="po" data-fx="poster-orbit"${isModel(s.model) ? ` data-model="${esc(s.model)}"` : ""}>
  <div class="po__stage">
    <canvas class="po__canvas" aria-hidden="true"></canvas>
    <div class="po__copy">
      ${s.eyebrow ? `<span class="mono">${esc(s.eyebrow)}</span>` : ""}
      <h2>${esc(s.headline || "")}</h2>
      ${s.text ? `<p>${esc(s.text)}</p>` : ""}
    </div>
    <div class="po__hint"><span>Scroll to orbit</span><i></i></div>
    <div class="po__grid">${imgs.map(im => `<figure><img src="${esc(imgUrl(im, 800))}" alt="${esc(im.alt || "")}" loading="lazy" data-poster>${im.title ? `<figcaption>${esc(im.title)}</figcaption>` : ""}</figure>`).join("")}</div>
  </div>
</section>`;
  },
  js: ({ t }) => String.raw`
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
(function(){
  var sec = document.querySelector('[data-fx="poster-orbit"]');
  if (!sec) return;
  var canvas = sec.querySelector('.po__canvas'), stage = sec.querySelector('.po__stage');
  var srcs = Array.prototype.map.call(sec.querySelectorAll('[data-poster]'), function(im){ return im.getAttribute('src'); });
  function hasGL(){ try { var c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }
  if (!window.__fx.FX || !hasGL() || srcs.length < 3) { sec.classList.add('is-static'); return; }

  var DPR = Math.min(window.devicePixelRatio || 1, 1.5);
  var renderer, scene, camera, cubeRT, cubeCam, rings, core, started = false, running = false, raf = 0, frame = 0;
  var progress = 0, mx = 0, my = 0, smx = 0, smy = 0, t0 = performance.now();
  var R = 0.31 * Math.max(10, srcs.length) + 1.2;
  var CAMZ = R + 3.4;
  var bg = new THREE.Color('${t.invBg}');

  function size(){
    var w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  function fit(root, target){
    var box = new THREE.Box3().setFromObject(root);
    var c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    root.position.sub(c);
    var holder = new THREE.Group(); holder.add(root); holder.scale.setScalar(target / (Math.max(s.x, s.y, s.z) || 1));
    return holder;
  }

  function init(){
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(DPR);
    renderer.setClearColor(bg, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(bg, CAMZ + R * 0.4, CAMZ + R * 2.4);
    camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100);
    camera.position.set(0, 0.6, CAMZ);
    camera.layers.enable(1);

    var loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
    var mats = srcs.map(function(src){
      var m = new THREE.MeshBasicMaterial({ color: 0x151515, side: THREE.DoubleSide, toneMapped: false });
      loader.load(src, function(tex){ tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; m.map = tex; m.color.set(0xffffff); m.needsUpdate = true; });
      return m;
    });
    var geo = new THREE.PlaneGeometry(1.05, 1.4);
    rings = new THREE.Group(); scene.add(rings);
    var per = Math.max(10, srcs.length), k = 0;
    [2.7, 0, -2.7].forEach(function(y, ri){
      var ring = new THREE.Group(); ring.position.y = y; ring.userData.dir = ri === 1 ? 1 : -0.6; rings.add(ring);
      for (var i = 0; i < per; i++) {
        var a = (i / per) * Math.PI * 2 + ri * 0.35;
        var m = new THREE.Mesh(geo, mats[k++ % mats.length]);
        var rr = R + (ri === 1 ? 0 : 0.6) + Math.sin(i * 2.3 + ri) * 0.5;
        m.position.set(Math.cos(a) * rr, Math.sin(i * 1.7 + ri * 2) * 0.5, Math.sin(a) * rr);
        m.lookAt(0, m.position.y, 0);
        m.rotation.z = Math.sin(i * 3.1 + ri) * 0.08;
        ring.add(m);
      }
    });

    var grid = new THREE.Mesh(new THREE.CylinderGeometry(R + 2.2, R + 2.2, 11, 48, 6, true), new THREE.MeshBasicMaterial({ color: new THREE.Color('${t.invInk}'), wireframe: true, transparent: true, opacity: 0.06, depthWrite: false }));
    scene.add(grid);
    var grid2 = new THREE.Mesh(new THREE.CylinderGeometry(R - 1.6, R - 1.6, 11, 36, 6, true), grid.material);
    scene.add(grid2);

    cubeRT = new THREE.WebGLCubeRenderTarget(256, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    cubeCam = new THREE.CubeCamera(0.1, 60, cubeRT);
    cubeCam.children.forEach(function(c){ c.layers.set(0); });
    scene.add(cubeCam);

    core = new THREE.Group(); core.layers.set(1); scene.add(core);
    var coreMat = new THREE.MeshPhysicalMaterial({ color: 0x3a3a3a, metalness: 1, roughness: 0.1, envMap: cubeRT.texture, envMapIntensity: 2.6, flatShading: true });
    var url = sec.getAttribute('data-model');
    function addCore(obj){ obj.traverse(function(o){ o.layers.set(1); }); core.add(obj); }
    if (url) {
      var gl = new GLTFLoader(); var dr = new DRACOLoader(); dr.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/'); gl.setDRACOLoader(dr); gl.setCrossOrigin('anonymous');
      gl.load(url, function(g){ g.scene.traverse(function(o){ if (o.isMesh) o.material = coreMat; }); addCore(fit(g.scene, 3.2)); }, undefined, function(){ addCore(new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), coreMat)); });
    } else {
      addCore(new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), coreMat));
    }
    var key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(3, 6, 5); key.layers.enable(1); scene.add(key);
    var rim = new THREE.DirectionalLight(new THREE.Color('${t.accent}'), 2); rim.position.set(-4, -2, -3); rim.layers.enable(1); scene.add(rim);

    size();
    if (window.ResizeObserver) new ResizeObserver(size).observe(stage);
    stage.addEventListener('pointermove', function(e){ var r = stage.getBoundingClientRect(); mx = (e.clientX - r.left) / r.width - 0.5; my = (e.clientY - r.top) / r.height - 0.5; });
    ScrollTrigger.create({ trigger: sec, start: 'top top', end: 'bottom bottom', onUpdate: function(st){ progress = st.progress; } });
  }

  function render(){
    var tt = (performance.now() - t0) / 1000;
    smx += (mx - smx) * 0.05; smy += (my - smy) * 0.05;
    var base = progress * Math.PI * 2 + tt * 0.04 + smx * 0.5;
    rings.children.forEach(function(ring){ ring.rotation.y = base * ring.userData.dir; });
    core.rotation.y = tt * 0.35 + progress * 2;
    core.rotation.x = Math.sin(tt * 0.6) * 0.3 + progress * 1.5;
    core.position.y = Math.sin(tt * 1.1) * 0.2;
    camera.position.x = smx * 1.6;
    camera.position.y = 2.2 - progress * 4.4 + smy * -0.8;
    camera.position.z = CAMZ - Math.sin(progress * Math.PI) * 1.2;
    camera.lookAt(0, camera.position.y * 0.35, 0);
    if (frame++ % 2 === 0) { core.visible = false; cubeCam.update(renderer, scene); core.visible = true; }
    renderer.render(scene, camera);
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
    cubeRT.dispose(); renderer.dispose();
  }, { once: true });
})();`,
};
export default c;
