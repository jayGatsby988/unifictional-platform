// @ts-nocheck
// 3d-4 · Infinite photo tunnel behind hero copy (Awwwards Pack, video only). A
// square wireframe tunnel runs away from the camera with the section's photos
// pinned to its four walls; every frame they drift toward the viewer, fade in
// from the page colour at the far end and recycle once they pass the camera,
// so it reads as endless forward travel. The pointer tilts the camera a little.
// three.js r160, lazy init, DPR cap 1.5, static photo hero when WebGL is off.
import type { Component } from "./_types";

const c: Component = {
  id: "3d-4",
  type: "hero-tunnel",
  kind: "hero",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "(recreated from the preview video) hero-tunnel (3d-4): a full-screen hero with the headline, one line of sub copy and a button centred on the page colour, and behind them a faint square tunnel drawn in thin lines that runs away into the distance. The section's photos hang flat on the tunnel's four walls and glide slowly toward you, growing and sliding off the edges as new ones fade in small near the centre, so the background feels like endless forward travel; moving the mouse tilts the view slightly. Needs a 2-5 word headline, a one-sentence sub, one button and 8-16 photos (portraits, products or project shots work best). Suits SaaS and apps, agencies, creators, photographers and any brand with a large set of faces or products to show. Phones and no-WebGL browsers get the copy over a plain grid of six of the photos.",
  fields: `{"type":"hero-tunnel","component":"3d-4","eyebrow":"","headline":"","sub":"","cta":{"label":"","href":"contact"},"images":[{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""}]}`,
  images: { min: 8, max: 16 },
  css: ({ pair, capsRule }) => `
.hero-tunnel{position:relative;height:100svh;min-height:600px;overflow:hidden;display:grid;place-items:center;background:var(--bg)}
.hero-tunnel canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.hero-tunnel__copy{position:relative;z-index:2;text-align:center;display:grid;gap:1.2rem;justify-items:center;padding:0 var(--gutter);max-width:60rem}
.hero-tunnel__copy .mono{color:var(--ink2)}
.hero-tunnel__copy h1{font-size:clamp(2.8rem,7.2vw,7.6rem);max-width:12ch;font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};line-height:.95;${capsRule}}
.hero-tunnel__copy p{max-width:46ch;color:var(--ink2);font-size:clamp(1rem,1.3vw,1.2rem)}
.hero-tunnel__src{display:none}
.hero-tunnel.is-static canvas{display:none}
.hero-tunnel.is-static .hero-tunnel__src{position:absolute;inset:0;display:grid;grid-template-columns:repeat(6,1fr);grid-template-rows:repeat(3,1fr);gap:1.2rem;padding:6rem var(--gutter) 3rem;pointer-events:none;opacity:.8}
.hero-tunnel.is-static .hero-tunnel__src img{width:100%;height:100%;object-fit:cover;max-height:28vh}
.hero-tunnel.is-static .hero-tunnel__src img:nth-child(1){grid-area:1/1}.hero-tunnel.is-static .hero-tunnel__src img:nth-child(2){grid-area:2/1;transform:translateX(30%)}.hero-tunnel.is-static .hero-tunnel__src img:nth-child(3){grid-area:3/2}
.hero-tunnel.is-static .hero-tunnel__src img:nth-child(4){grid-area:1/6}.hero-tunnel.is-static .hero-tunnel__src img:nth-child(5){grid-area:2/6;transform:translateX(-30%)}.hero-tunnel.is-static .hero-tunnel__src img:nth-child(6){grid-area:3/5}
.hero-tunnel.is-static .hero-tunnel__src img:nth-child(n+7){display:none}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .hero-tunnel{height:auto;min-height:100svh;place-items:stretch;align-content:center;padding:7rem var(--gutter) 3rem;gap:2.5rem}
  .hero-tunnel canvas{display:none}
  .hero-tunnel__copy{text-align:left;justify-items:start;padding:0}
  .hero-tunnel__copy h1{font-size:clamp(2.6rem,12vw,4.5rem)}
  .hero-tunnel__src,.hero-tunnel.is-static .hero-tunnel__src{position:static;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:none;gap:.5rem;padding:0;opacity:1}
  .hero-tunnel__src img,.hero-tunnel.is-static .hero-tunnel__src img{width:100%;aspect-ratio:3/4;height:auto;max-height:none;object-fit:cover;grid-area:auto!important;transform:none!important}
  .hero-tunnel__src img:nth-child(n+7){display:none}
}`,
  html: (s, { esc, imgUrl, link, arrow }) => {
    const imgs = (s.images || []).filter(im => im && im.url).slice(0, 16);
    return `
<section class="hero-tunnel" id="top" data-fx="hero-tunnel">
  <canvas aria-hidden="true"></canvas>
  <div class="hero-tunnel__copy">
    ${s.eyebrow ? `<div class="mono">${esc(s.eyebrow)}</div>` : ""}
    <h1>${esc(s.headline)}</h1>
    ${s.sub ? `<p>${esc(s.sub)}</p>` : ""}
    ${s.cta ? `<div><a class="btn btn-primary" href="${esc(link(s.cta.href))}">${esc(s.cta.label)}${arrow}</a></div>` : ""}
  </div>
  <div class="hero-tunnel__src">${imgs.map((im, i) => `<img src="${esc(imgUrl(im, 700))}" alt="${esc(im.alt || "")}" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} crossorigin="anonymous">`).join("")}</div>
</section>`;
  },
  js: ({ t }) => `
import * as THREE from "three";
(function(){
  var el = document.querySelector('[data-fx="hero-tunnel"]');
  if (!el) return;
  var canvas = el.querySelector('canvas');
  var urls = [].slice.call(el.querySelectorAll('.hero-tunnel__src img')).map(function(i){ return i.getAttribute('src'); });
  var gl = null;
  if (window.__fx.FX && urls.length) { try { gl = canvas.getContext('webgl2', { antialias: true, alpha: true, powerPreference: 'high-performance' }); } catch (e) { gl = null; } }
  if (!gl) { el.classList.add('is-static'); return; }
  var W = 3.2, H = 2.1, LEN = 42, COUNT = Math.max(30, urls.length * 3);
  var renderer, scene, camera, quads = [], lines, running = false, started = false, raf = 0, last = 0;
  var px = 0, py = 0, cx = 0, cy = 0, lastY = window.scrollY, boost = 0;
  var bg = new THREE.Color('${t.bg}'), ink = new THREE.Color('${t.ink}');
  function rand(a, b){ return a + Math.random() * (b - a); }
  function place(q, z){
    var wall = q.userData.wall, u = rand(-0.78, 0.78);
    q.rotation.set(0, 0, 0);
    if (wall === 0) { q.position.set(-W + 0.03, u * H, z); q.rotation.y = Math.PI / 2; }
    else if (wall === 1) { q.position.set(W - 0.03, u * H, z); q.rotation.y = -Math.PI / 2; }
    else if (wall === 2) { q.position.set(u * W, H - 0.03, z); q.rotation.x = Math.PI / 2; }
    else { q.position.set(u * W, -H + 0.03, z); q.rotation.x = -Math.PI / 2; }
  }
  function build(){
    renderer = new THREE.WebGLRenderer({ canvas: canvas, context: gl, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(bg, 5, LEN * 0.8);
    camera = new THREE.PerspectiveCamera(62, 1, 0.1, 100);
    camera.position.set(0, 0, 0);
    // Wireframe tunnel: a rectangle every 2 units plus corner and mid lines along its length.
    var pts = [];
    for (var z = 0; z >= -LEN; z -= 2) { pts.push(-W, -H, z, W, -H, z, W, -H, z, W, H, z, W, H, z, -W, H, z, -W, H, z, -W, -H, z); }
    [[-W, -H], [W, -H], [W, H], [-W, H], [0, H], [0, -H], [-W, 0], [W, 0]].forEach(function(c){ pts.push(c[0], c[1], 1, c[0], c[1], -LEN); });
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: ink, transparent: true, opacity: ${t.dark ? 0.16 : 0.12}, fog: true }));
    scene.add(lines);
    var loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
    var geo = new THREE.PlaneGeometry(1.3, 1.7), cache = {};
    // One texture per URL, shared by every quad that shows it.
    function getTex(url, cb){
      var e = cache[url];
      if (e) { if (e.tex) cb(e.tex); else e.cbs.push(cb); return; }
      e = cache[url] = { tex: null, cbs: [cb] };
      loader.load(url, function(tex){
        tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
        e.tex = tex; e.cbs.forEach(function(f){ f(tex); }); e.cbs = [];
      });
    }
    for (var i = 0; i < COUNT; i++) {
      (function(i){
        var mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide, fog: true, color: 0xffffff });
        var q = new THREE.Mesh(geo, mat);
        q.userData.wall = i % 4; q.userData.ready = false;
        place(q, -(i / COUNT) * LEN + rand(-0.8, 0.8));
        scene.add(q); quads.push(q);
        getTex(urls[i % urls.length], function(tex){
          var a = tex.image && tex.image.width ? tex.image.width / tex.image.height : 0.77;
          mat.map = tex; mat.needsUpdate = true; q.userData.ready = true;
          q.scale.set(a > 1 ? 1.25 : 1, a > 1 ? 1.25 / a / 1.3 : 1, 1);
        });
      })(i);
    }
    resize();
  }
  function resize(){
    if (!renderer) return;
    var w = el.clientWidth, h = el.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  function frame(now){
    if (!running) return;
    raf = requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    var sy = window.scrollY, dy = sy - lastY; lastY = sy;
    boost += (Math.min(Math.abs(dy) * 0.02, 3) - boost) * 0.1;
    var speed = 1.6 + boost;
    for (var i = 0; i < quads.length; i++) {
      var q = quads[i]; q.position.z += speed * dt;
      if (q.position.z > 1) { place(q, q.position.z - LEN - 1); }
      var near = Math.max(0, Math.min(1, -q.position.z / 1.6));
      q.material.opacity = q.userData.ready ? near : 0;
    }
    cx += (px - cx) * 0.06; cy += (py - cy) * 0.06;
    camera.position.set(cx * 0.35, cy * 0.22, 0);
    camera.lookAt(cx * 0.9, cy * 0.5, -14);
    renderer.render(scene, camera);
  }
  function start(){ if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  function stop(){ running = false; cancelAnimationFrame(raf); }
  el.addEventListener('pointermove', function(e){ var r = el.getBoundingClientRect(); px = ((e.clientX - r.left) / r.width) * 2 - 1; py = -(((e.clientY - r.top) / r.height) * 2 - 1); });
  el.addEventListener('pointerleave', function(){ px = 0; py = 0; });
  var io = new IntersectionObserver(function(es){
    var on = es[0].isIntersecting;
    if (on && !started) { started = true; try { build(); } catch (e) { el.classList.add('is-static'); io.disconnect(); return; } }
    if (on) start(); else stop();
  }, { threshold: 0.05 });
  io.observe(el);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(el); else window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', function(){ if (document.hidden) stop(); else if (started) start(); });
  window.addEventListener('pagehide', function(){ stop(); if (renderer) { quads.forEach(function(q){ if (q.material.map) q.material.map.dispose(); q.material.dispose(); }); lines.material.dispose(); lines.geometry.dispose(); renderer.dispose(); } });
})();`,
};
export default c;
