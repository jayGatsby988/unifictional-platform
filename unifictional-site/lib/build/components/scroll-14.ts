// @ts-nocheck
// scroll-14 · Scroll-velocity RGB streak distortion on text (Awwwards Pack,
// recreated from the preview video). The headline is measured in the DOM,
// drawn onto a canvas texture and shown on a WebGL plane whose shader slices
// it into thin vertical columns that slide by scroll speed, each colour
// channel offset separately.
import type { Component } from "./_types";

function rgb(hex, fb) {
  let h = String(hex || "").replace("#", "");
  if (h.length === 3) h = h.split("").map(ch => ch + ch).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return fb;
  return [0, 2, 4].map(i => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(",");
}

const c: Component = {
  id: "scroll-14",
  type: "headline-streak",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "(recreated from the preview video) headline-streak (scroll-14): a full-screen dark panel, a photo darkened almost to black behind it, with one huge white headline of 2-6 words centred on it and an optional one-line sub beneath. At rest the headline is sharp with a hair-thin red and blue fringe; whenever the page moves it tears into thin vertical slices that slide up or down by different amounts, red, green and blue offset separately, so a nudge gives a jagged wobble and a fast scroll stretches the letters into tall streaks that snap back sharp within half a second of stopping. Needs one dark-friendly photo and a short headline. A statement or manifesto moment for studios, music, nightlife, fashion, gyms and bold trades; on phones and without WebGL it is plain white text over the photo.",
  fields: `{"type":"headline-streak","component":"scroll-14","headline":"","sub":"","image":{"query":"","alt":""}}`,
  images: { min: 1, max: 1 },
  css: ({ capsRule }) => `
.hs{position:relative;min-height:100svh;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#07070a;color:#fff}
.hs__bg{position:absolute;inset:0;z-index:0}
.hs__bg img{width:100%;height:100%;object-fit:cover;opacity:.32}
.hs__bg::after{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,.1),rgba(0,0,0,.75))}
.hs__gl{position:absolute;inset:0;pointer-events:none;z-index:2}
.hs__gl canvas{position:sticky;top:0;display:block;width:100%;height:100vh}
.hs__inner{position:relative;z-index:1;text-align:center;padding:6rem var(--gutter);max-width:70rem}
.hs__h{font-size:clamp(3rem,11vw,11rem);line-height:.95;color:#fff;text-wrap:balance;${capsRule}}
.hs__h.is-gl{color:transparent}
.hs__sub{margin:2rem auto 0;max-width:40ch;color:rgba(255,255,255,.72);font-size:1.05rem}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .hs{min-height:80svh}
  .hs__gl{display:none}
  .hs__h{font-size:clamp(2.4rem,13vw,4.5rem)}
  .hs__h.is-gl{color:#fff}
}`,
  html: (s, { esc, imgUrl }) => {
    const words = String(s.headline || "").trim().split(/\s+/).filter(Boolean).slice(0, 12);
    const u = s.image ? imgUrl(s.image, 2000) : "";
    return `
<section class="hs" data-fx="headline-streak">
  <div class="hs__bg">${u ? `<img src="${esc(u)}" alt="${esc(s.image?.alt || "")}" loading="lazy">` : ""}</div>
  <div class="hs__gl"><canvas aria-hidden="true"></canvas></div>
  <div class="hs__inner">
    <h2 class="hs__h display">${words.map(w => `<span class="w">${esc(w)}</span>`).join(" ")}</h2>
    ${s.sub ? `<p class="hs__sub reveal">${esc(s.sub)}</p>` : ""}
  </div>
</section>`;
  },
  js: () => `
import * as THREE from "three";
(function(){
  var sec = document.querySelector('[data-fx="headline-streak"]');
  if (!sec || !window.__fx.FX) return;
  var gl2 = null; try { gl2 = document.createElement('canvas').getContext('webgl2'); } catch (e) {}
  if (!gl2) return;
  var canvas = sec.querySelector('.hs__gl canvas'), el = sec.querySelector('.hs__h');
  if (!canvas || !el) return;
  var VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var FRAG = 'uniform sampler2D uMap; uniform float uVel; uniform float uTime; uniform vec3 uColor; varying vec2 vUv;'
    + 'float hash(float n){ return fract(sin(n * 127.1) * 43758.5453); }'
    + 'void main(){'
    + 'float col = floor(vUv.x * 150.0);'
    + 'float h = hash(col + floor(uTime * 18.0) * 0.37);'
    + 'float h2 = hash(col * 3.1 + floor(uTime * 11.0));'
    + 'float d = uVel * 0.0024 * (0.25 + h) * (h2 > 0.5 ? 1.0 : -0.6);'
    + 'float rest = 0.0025 * (h2 - 0.5);'
    + 'float aR = texture2D(uMap, vUv + vec2(0.0, d * 1.25 + rest)).a;'
    + 'float aG = texture2D(uMap, vUv + vec2(0.0, d)).a;'
    + 'float aB = texture2D(uMap, vUv + vec2(0.0, d * 0.75 - rest)).a;'
    + 'vec3 col3 = uColor * aG + vec3(1.0, 0.1, 0.15) * max(aR - aG, 0.0) + vec3(0.1, 0.4, 1.0) * max(aB - aG, 0.0) + vec3(0.1, 1.0, 0.3) * max(aG - max(aR, aB), 0.0) * 0.6;'
    + 'float a = max(aG, max(aR, aB));'
    + 'gl_FragColor = vec4(col3, a); }';
  var renderer, scene, camera, mesh, mat, u, started = false, active = false, raf = 0, W = 0, H = 0, ready = false, box = null;
  var lenis = window.__fx.lenis, lastY = window.scrollY, vel = 0, t0 = 0, rebuildT = 0;
  function size(){ W = window.innerWidth; H = window.innerHeight; renderer.setSize(W, H, true); camera.aspect = W / H; camera.fov = 2 * Math.atan(H / 2 / 1000) * 180 / Math.PI; camera.updateProjectionMatrix(); }
  function texture(){
    el.classList.remove('is-gl');
    var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var padX = 20, padY = Math.ceil(r.height);
    var w = Math.ceil(r.width + padX * 2), h = Math.ceil(r.height + padY * 2);
    var cv = document.createElement('canvas'); cv.width = Math.ceil(w * dpr); cv.height = Math.ceil(h * dpr);
    var g = cv.getContext('2d'); g.scale(dpr, dpr);
    g.fillStyle = '#fff'; g.textBaseline = 'middle';
    g.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    if ('letterSpacing' in g) g.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
    var upper = cs.textTransform === 'uppercase';
    // A zero-size inline-block sits on the baseline: measure its offset once on the first word (adding it to a
    // line-ending word could re-wrap the line) and reuse it, so the canvas text lands exactly on the real glyphs.
    var spans = el.querySelectorAll('.w'); if (!spans.length) return null;
    var probe = document.createElement('i'); probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    spans[0].appendChild(probe); var off = probe.getBoundingClientRect().top - spans[0].getBoundingClientRect().top; probe.remove();
    g.textBaseline = 'alphabetic';
    spans.forEach(function(sp){
      var b = sp.getBoundingClientRect(); var txt = sp.textContent; if (upper) txt = txt.toUpperCase();
      g.fillText(txt, b.left - r.left + padX, b.top + off - r.top + padY);
    });
    var tex = new THREE.CanvasTexture(cv); tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    el.classList.add('is-gl');
    return { tex: tex, w: w, h: h };
  }
  function build(){
    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, premultipliedAlpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, 10, 2000); camera.position.z = 1000;
    size();
    u = { uMap: { value: null }, uVel: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Vector3(1, 1, 1) } };
    mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, transparent: true, premultipliedAlpha: true, depthTest: false });
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1), mat); mesh.visible = false; scene.add(mesh);
    document.fonts.ready.then(function(){ box = texture(); if (!box) return; u.uMap.value = box.tex; ready = true; });
    window.addEventListener('resize', function(){ size(); clearTimeout(rebuildT); rebuildT = setTimeout(function(){ if (!ready) return; var nb = texture(); if (!nb) return; var old = box.tex; box = nb; u.uMap.value = box.tex; old.dispose(); }, 200); });
    window.addEventListener('pagehide', dispose, { once: true });
  }
  function frame(now){
    if (!active) return;
    raf = requestAnimationFrame(frame);
    var dt = t0 ? Math.min(0.1, (now - t0) / 1000) : 0; t0 = now;
    var v = lenis ? lenis.velocity : (window.scrollY - lastY); lastY = window.scrollY;
    v = Math.max(-150, Math.min(150, v || 0));
    vel += (v - vel) * 0.2;
    if (!ready) return;
    var r = el.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
    mesh.visible = !(r.bottom < -H || r.top > 2 * H);
    mesh.position.set(r.left - cr.left - W / 2 + r.width / 2, -(r.top - cr.top) + H / 2 - r.height / 2, 0);
    mesh.scale.set(box.w, box.h, 1);
    u.uVel.value = vel; u.uTime.value += dt;
    renderer.render(scene, camera);
  }
  function dispose(){ active = false; cancelAnimationFrame(raf); if (mat) mat.dispose(); if (box) box.tex.dispose(); if (renderer) renderer.dispose(); }
  var io = new IntersectionObserver(function(es){
    es.forEach(function(en){
      if (en.isIntersecting) { if (!started) { started = true; build(); } active = true; t0 = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); }
      else { active = false; cancelAnimationFrame(raf); }
    });
  }, { rootMargin: '25% 0px' });
  io.observe(sec);
})();`,
};
export default c;
