// @ts-nocheck
// 3d-11 · Hover/click laptop and phone mockup scene (Awwwards Pack).
// The pack demo is threepipe with poses baked into a 12 MB GLB; rebuilt in plain
// three.js r160: devices are box meshes (laptop base + hinged lid, phone slab)
// whose screens carry the section's images; hover peeks, click opens and flies
// the camera in, click elsewhere or Escape resets.
import type { Component } from "./_types";

function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}

const c: Component = {
  id: "3d-11",
  type: "device-mockup",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "device-mockup (3d-11): a full-screen 3D tabletop with a closed laptop and a phone lying on it (up to four devices, alternating laptop and phone), each showing one of your screenshots or photos on its screen. Hovering a device cracks the lid open or tilts the phone; clicking opens it fully and glides the camera in close, with the item's title appearing; clicking empty space or Escape puts everything back. Small buttons under the scene jump to each device. Needs 2-4 images (website screenshots, app screens or project photos) each with a short title. Suits web and app studios, software products, photographers showing a portfolio, anyone with screens to show. Heavy: one per site.",
  fields: `{"type":"device-mockup","component":"3d-11","eyebrow":"","headline":"","items":[{"query":"","alt":"","title":""},{"query":"","alt":"","title":""}]}`,
  images: { min: 2, max: 4 },
  css: ({ pair, capsRule }) => `
.dv{position:relative;min-height:100svh;overflow:hidden;background:var(--bg2);display:grid;grid-template-rows:auto 1fr auto;padding:6.5rem var(--gutter) 2rem}
.dv__canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}
.dv__canvas.is-hover{cursor:pointer}
.dv__head{position:relative;z-index:2;display:grid;gap:.8rem;max-width:36rem;pointer-events:none}
.dv__head h2{font-size:clamp(2rem,4.6vw,4.2rem);font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};line-height:.95;${capsRule}}
.dv__cap{position:relative;z-index:2;align-self:end;justify-self:start;padding:.35em .7em;background:var(--bg);border-radius:8px;font-family:var(--display);font-weight:${pair.weight};font-size:clamp(1.2rem,2.4vw,2rem);opacity:0;transform:translateY(10px);transition:opacity .4s,transform .5s var(--ease-out);pointer-events:none;${capsRule}}
.dv__cap.is-on{opacity:1;transform:none}
.dv__nav{position:relative;z-index:2;display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1.2rem}
.dv__nav button{font:inherit;font-size:.82rem;padding:.55em 1.1em;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--ink2);cursor:pointer;transition:border-color .3s,color .3s,background .3s}
.dv__nav button:hover,.dv__nav button.is-on{border-color:var(--ink);color:var(--ink)}
.dv__static{display:none;position:relative;z-index:2;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:1.2rem;align-items:end;padding:2rem 0}
.dv__dev{display:grid;gap:.6rem}
.dv__dev figure{margin:0;border:3px solid var(--ink);border-radius:10px;overflow:hidden;background:var(--ink)}
.dv__dev.is-laptop figure{aspect-ratio:16/10;border-bottom-width:10px;border-radius:10px 10px 4px 4px}
.dv__dev.is-phone figure{aspect-ratio:9/16;border-radius:22px;border-width:6px;max-width:12rem}
.dv__dev img{width:100%;height:100%;object-fit:cover;display:block}
.dv__dev figcaption{font-family:var(--mono);font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink2)}
.dv.is-static .dv__canvas,.dv.is-static .dv__nav,.dv.is-static .dv__cap{display:none}
.dv.is-static .dv__static{display:grid}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .dv{min-height:0;padding:5rem var(--gutter) 3rem;grid-template-rows:auto auto}
  .dv__canvas,.dv__nav,.dv__cap{display:none}
  .dv__static{display:grid;grid-template-columns:1fr 1fr}
  .dv__dev.is-laptop{grid-column:1/-1}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, 4);
    const devs = items.map((it, i) => {
      const p = pic(it, s, i);
      return { url: p ? imgUrl(p, 1200) : "", alt: it.alt || (p && p.alt) || "", title: it.title || "", laptop: i % 2 === 0 };
    });
    return `
<section class="dv" data-fx="device-mockup">
  <canvas class="dv__canvas" aria-hidden="true"></canvas>
  <div class="dv__head">
    ${s.eyebrow ? `<span class="mono reveal">${esc(s.eyebrow)}</span>` : ""}
    ${s.headline ? `<h2 class="reveal">${esc(s.headline)}</h2>` : ""}
  </div>
  <div class="dv__static">${devs.map(d => `<div class="dv__dev ${d.laptop ? "is-laptop" : "is-phone"}"><figure>${d.url ? `<img src="${esc(d.url)}" alt="${esc(d.alt)}" loading="lazy">` : ""}</figure>${d.title ? `<figcaption>${esc(d.title)}</figcaption>` : ""}</div>`).join("")}</div>
  <div class="dv__cap" aria-live="polite"></div>
  <div class="dv__nav">${devs.map((d, i) => `<button type="button" data-i="${i}" data-src="${esc(d.url)}" data-laptop="${d.laptop ? 1 : 0}">${esc(d.title || "Screen " + (i + 1))}</button>`).join("")}</div>
</section>`;
  },
  js: ({ t }) => String.raw`
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
(function(){
  var sec = document.querySelector('[data-fx="device-mockup"]');
  if (!sec) return;
  var canvas = sec.querySelector('.dv__canvas'), cap = sec.querySelector('.dv__cap'), btns = sec.querySelectorAll('.dv__nav button');
  function hasGL(){ try { var c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }
  if (!window.__fx.FX || !hasGL() || !btns.length) { sec.classList.add('is-static'); return; }

  var DPR = Math.min(window.devicePixelRatio || 1, 1.5);
  var renderer, scene, camera, pmrem, started = false, running = false, raf = 0;
  var devices = [], pickables = [], focused = -1, hovered = -1;
  var camTarget = new THREE.Vector3(0, 0.5, 0), lookAt = new THREE.Vector3(0, 0.5, 0);
  var HOME = { pos: new THREE.Vector3(0, 4.2, 9), look: new THREE.Vector3(0, 0.3, 0) };
  var ray = new THREE.Raycaster(), ptr = new THREE.Vector2(-2, -2), tl = null, vf = 1;
  var texLoader = new THREE.TextureLoader(); texLoader.setCrossOrigin('anonymous');

  function body(){ return new THREE.MeshStandardMaterial({ color: new THREE.Color('${t.dark ? "#d8d8d8" : "#2a2a2e"}'), metalness: 0.75, roughness: 0.42 }); }
  function screenMat(src, aspect){
    var m = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
    if (src) texLoader.load(src, function(tex){
      tex.colorSpace = THREE.SRGBColorSpace;
      var ia = tex.image.width / tex.image.height;
      if (ia > aspect) { tex.repeat.set(aspect / ia, 1); tex.offset.set((1 - aspect / ia) / 2, 0); } else { tex.repeat.set(1, ia / aspect); tex.offset.set(0, (1 - ia / aspect) / 2); }
      m.map = tex; m.color.set(0xffffff); m.needsUpdate = true;
    });
    return m;
  }
  function shadow(w, d){
    var cv = document.createElement('canvas'); cv.width = cv.height = 128;
    var g = cv.getContext('2d'), gr = g.createRadialGradient(64, 64, 10, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,0,0,.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    var tex = new THREE.CanvasTexture(cv);
    var m = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.5, d * 1.6), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.005;
    return m;
  }

  function laptop(src){
    var g = new THREE.Group(), W = 3, D = 2, H = 0.12;
    var base = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), body()); base.position.y = H / 2; g.add(base);
    var kb = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.86, D * 0.5), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })); kb.rotation.x = -Math.PI / 2; kb.position.set(0, H + 0.002, 0.08); g.add(kb);
    var hinge = new THREE.Group(); hinge.position.set(0, H, -D / 2 + 0.05); g.add(hinge);
    var LH = 1.9, LT = 0.07;
    var lid = new THREE.Mesh(new THREE.BoxGeometry(W, LH, LT), body()); lid.position.y = LH / 2; hinge.add(lid);
    var scr = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.92, LH * 0.88), screenMat(src, (W * 0.92) / (LH * 0.88))); scr.position.set(0, LH / 2, LT / 2 + 0.003); hinge.add(scr);
    g.add(shadow(W, D));
    var d = { group: g, hinge: hinge, kind: 'laptop', poses: { rest: Math.PI / 2 - 0.02, hover: Math.PI / 2 - 0.5, open: Math.PI / 2 - 1.85 }, view: { pos: new THREE.Vector3(0, 2.6, 6.2), look: new THREE.Vector3(0, 1.0, -0.3) } };
    hinge.rotation.x = d.poses.rest;
    [base, lid, scr].forEach(function(m){ m.userData.dev = d; pickables.push(m); });
    return d;
  }
  function phone(src){
    var g = new THREE.Group(), W = 0.78, L = 1.6, H = 0.08;
    var pivot = new THREE.Group(); pivot.position.z = L / 2; g.add(pivot);
    var slab = new THREE.Mesh(new THREE.BoxGeometry(W, H, L), body()); slab.position.set(0, H / 2, -L / 2); pivot.add(slab);
    var scr = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.9, L * 0.94), screenMat(src, (W * 0.9) / (L * 0.94))); scr.rotation.x = -Math.PI / 2; scr.position.set(0, H + 0.003, -L / 2); pivot.add(scr);
    g.add(shadow(W, L));
    var d = { group: g, hinge: pivot, kind: 'phone', poses: { rest: 0, hover: 0.22, open: Math.PI / 2 - 0.22 }, view: { pos: new THREE.Vector3(0, 2.0, 4.2), look: new THREE.Vector3(0, 0.8, 0) } };
    [slab, scr].forEach(function(m){ m.userData.dev = d; pickables.push(m); });
    return d;
  }

  function setCap(i){ if (i >= 0 && btns[i]) { cap.textContent = btns[i].textContent; cap.classList.add('is-on'); } else cap.classList.remove('is-on'); btns.forEach(function(b, k){ b.classList.toggle('is-on', k === i); }); }
  function pose(d, name, dur){ gsap.to(d.hinge.rotation, { x: d.poses[name], duration: dur, ease: 'power3.out', overwrite: true }); }
  function fly(pos, look, dur){
    if (tl) tl.kill();
    tl = gsap.timeline();
    tl.to(camTarget, { x: pos.x, y: pos.y, z: pos.z, duration: dur, ease: 'power3.inOut' }, 0)
      .to(lookAt, { x: look.x, y: look.y, z: look.z, duration: dur, ease: 'power3.inOut' }, 0);
  }
  function focus(i){
    if (focused === i) return;
    focused = i;
    devices.forEach(function(d, k){ pose(d, k === i ? 'open' : 'rest', 0.9); });
    var d = devices[i];
    var p = d.group.position;
    fly(new THREE.Vector3(p.x + d.view.pos.x, d.view.pos.y * vf, p.z + d.view.pos.z * vf), new THREE.Vector3(p.x + d.view.look.x, d.view.look.y, p.z + d.view.look.z), 1.1);
    setCap(i);
    canvas.classList.remove('is-hover');
  }
  function reset(){
    if (focused < 0) return;
    focused = -1;
    devices.forEach(function(d){ pose(d, 'rest', 0.8); });
    fly(HOME.pos, HOME.look, 1);
    setCap(-1);
  }
  function hover(i){
    if (focused >= 0 || hovered === i) return;
    if (hovered >= 0) pose(devices[hovered], 'rest', 0.5);
    hovered = i;
    if (i >= 0) pose(devices[i], 'hover', 0.45);
    canvas.classList.toggle('is-hover', i >= 0);
  }
  function pick(e){
    var r = canvas.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    var hit = ray.intersectObjects(pickables, false)[0];
    return hit ? devices.indexOf(hit.object.userData.dev) : -1;
  }

  function size(){
    var w = sec.clientWidth, h = sec.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    vf = Math.max(1, 1.5 / camera.aspect);
    var f = vf * (devices.length > 2 ? 1.15 : 1);
    HOME.pos.set(0, 4.2 * f, 9 * f);
    if (focused < 0) { camTarget.copy(HOME.pos); if (!started) camera.position.copy(HOME.pos); }
  }

  function init(){
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(DPR);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
    camera.position.copy(HOME.pos); camTarget.copy(HOME.pos); lookAt.copy(HOME.look);
    pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.9));
    var key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(2, 6, 4); scene.add(key);
    var table = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: new THREE.Color('${t.bg2}'), roughness: 0.95, metalness: 0 }));
    table.rotation.x = -Math.PI / 2; scene.add(table);

    var n = btns.length;
    var xs = n === 1 ? [0] : n === 2 ? [-1.4, 1.6] : n === 3 ? [-2.6, 0.4, 2.6] : [-3.1, -0.6, 1.5, 3.4];
    var zs = n <= 2 ? [0, 0.4] : [0.2, -0.6, 0.3, -0.5];
    btns.forEach(function(b, i){
      var d = b.getAttribute('data-laptop') === '1' ? laptop(b.getAttribute('data-src')) : phone(b.getAttribute('data-src'));
      d.group.position.set(xs[i], 0, zs[i] || 0);
      d.group.rotation.y = (i % 2 ? -1 : 1) * 0.12 * (i + 1);
      scene.add(d.group); devices.push(d);
      b.addEventListener('click', function(){ focused === i ? reset() : focus(i); });
    });

    size();
    if (window.ResizeObserver) new ResizeObserver(size).observe(sec);
    canvas.addEventListener('pointermove', function(e){ hover(pick(e)); });
    canvas.addEventListener('pointerleave', function(){ hover(-1); });
    canvas.addEventListener('click', function(e){ var i = pick(e); if (i >= 0) focus(i); else reset(); });
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') reset(); });
  }

  function render(){
    camera.position.lerp(camTarget, 0.12);
    camera.lookAt(lookAt);
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
    pmrem.dispose(); renderer.dispose();
  }, { once: true });
})();`,
};
export default c;
