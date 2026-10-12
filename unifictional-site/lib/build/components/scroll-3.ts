// @ts-nocheck
// scroll-3 · WebGL DOM-synced text with scroll wave + RGB shift (Awwwards Pack).
// The demo rendered DOM text with troika; here the statement's words are
// measured in the DOM, drawn onto a canvas texture at the same positions and
// shown on one plane whose shader rises the block into view, then ripples and
// splits its colour channels in proportion to scroll speed.
import type { Component } from "./_types";

function rgb(hex, fb) {
  let h = String(hex || "").replace("#", "");
  if (h.length === 3) h = h.split("").map(ch => ch + ch).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return fb;
  return [0, 2, 4].map(i => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(",");
}

const c: Component = {
  id: "scroll-3",
  type: "statement-wave",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "statement-wave (scroll-3): a tall, calm section holding one big centred statement of 14-26 words in display type, with an optional small eyebrow line above it. The statement is real selectable text but is drawn by WebGL: when it scrolls into view the block rises from behind its own bottom edge over about two seconds; while the page is moving the letters ripple in a slow sine wave and their red and blue channels pull apart into coloured fringes, settling sharp as the scroll stops. A manifesto or mission moment between sections for studios, agencies, architects, hospitality and any brand with a point of view; on phones and without WebGL it is plain text that fades in.",
  fields: `{"type":"statement-wave","component":"scroll-3","eyebrow":"","text":""}`,
  css: () => `
.sw{position:relative;padding:clamp(6rem,18vh,12rem) var(--gutter);min-height:80svh;display:flex;align-items:center}
.sw__gl{position:absolute;inset:0;pointer-events:none;z-index:1}
.sw__gl canvas{position:sticky;top:0;display:block;width:100%;height:100vh}
.sw__inner{max-width:62rem;margin:0 auto;text-align:center;position:relative;z-index:2}
.sw__eyebrow{margin-bottom:1.6rem}
.sw__text{font-size:clamp(2rem,5vw,5.2rem);line-height:1.02;text-wrap:balance}
.sw__text.is-gl{color:transparent}
.sw__text.is-gl::selection{color:var(--on-accent)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .sw{min-height:0;padding:4rem var(--gutter)}
  .sw__gl{display:none}
  .sw__text{font-size:clamp(1.7rem,7.5vw,3rem)}
  .sw__text.is-gl{color:inherit}
}`,
  html: (s, { esc }) => {
    const words = String(s.text || "").trim().split(/\s+/).filter(Boolean).slice(0, 40);
    return `
<section class="sw" data-fx="statement-wave">
  <div class="sw__gl"><canvas aria-hidden="true"></canvas></div>
  <div class="sw__inner">
    ${s.eyebrow ? `<div class="mono sw__eyebrow reveal">${esc(s.eyebrow)}</div>` : ""}
    <p class="sw__text display reveal">${words.map(w => `<span class="w">${esc(w)}</span>`).join(" ")}</p>
  </div>
</section>`;
  },
  js: ({ t }) => `
import * as THREE from "three";
(function(){
  var sec = document.querySelector('[data-fx="statement-wave"]');
  if (!sec || !window.__fx.FX) return;
  var gl2 = null; try { gl2 = document.createElement('canvas').getContext('webgl2'); } catch (e) {}
  if (!gl2) return;
  var canvas = sec.querySelector('.sw__gl canvas'), el = sec.querySelector('.sw__text');
  if (!canvas || !el) return;
  var VERT = 'uniform float uProgress; varying vec2 vUv; void main(){ vUv = uv; vec3 p = position; p.y -= (1.0 - uProgress) * 0.7; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }';
  var FRAG = 'uniform sampler2D uMap; uniform float uProgress; uniform float uVel; uniform float uTime; uniform vec3 uColor; varying vec2 vUv;'
    + 'void main(){'
    + 'if (1.0 - vUv.y > uProgress) discard;'
    + 'vec2 uv = vUv; float amp = uVel * 0.0011;'
    + 'uv.x += sin(uv.y * 7.0 + uTime) * amp;'
    + 'uv.y += sin(uv.x * 18.0 + uTime * 0.8) * amp * 0.5;'
    + 'float off = uVel * 0.0007;'
    + 'float aR = texture2D(uMap, uv + vec2(0.0, off)).a;'
    + 'float aG = texture2D(uMap, uv).a;'
    + 'float aB = texture2D(uMap, uv - vec2(0.0, off)).a;'
    + 'vec3 col = uColor * aG + vec3(1.0, 0.12, 0.2) * max(aR - aG, 0.0) + vec3(0.12, 0.45, 1.0) * max(aB - aG, 0.0);'
    + 'float a = max(aG, max(aR, aB));'
    + 'gl_FragColor = vec4(col, a); }';
  var PADX = 40, PADY = 60;
  var renderer, scene, camera, mesh, mat, u, started = false, active = false, raf = 0, W = 0, H = 0, ready = false, box = null;
  var lenis = window.__fx.lenis, lastY = window.scrollY, vel = 0, t0 = 0, rebuildT = 0;
  function size(){ W = window.innerWidth; H = window.innerHeight; renderer.setSize(W, H, true); camera.aspect = W / H; camera.fov = 2 * Math.atan(H / 2 / 1000) * 180 / Math.PI; camera.updateProjectionMatrix(); }
  function texture(){
    el.classList.remove('is-gl');
    var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var w = Math.ceil(r.width + PADX * 2), h = Math.ceil(r.height + PADY * 2);
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
      g.fillText(txt, b.left - r.left + PADX, b.top + off - r.top + PADY);
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
    u = { uMap: { value: null }, uProgress: { value: 0 }, uVel: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Vector3(${rgb(t.ink, "0.95,0.95,0.93")}) } };
    mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, transparent: true, premultipliedAlpha: true, depthTest: false });
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1), mat); mesh.visible = false; scene.add(mesh);
    document.fonts.ready.then(function(){
      box = texture(); if (!box) return; u.uMap.value = box.tex; ready = true;
      ScrollTrigger.create({ trigger: el, start: 'top 92%', end: 'bottom 8%',
        onEnter: function(){ gsap.to(u.uProgress, { value: 1, duration: 1.8, ease: 'power3.out', overwrite: true }); },
        onEnterBack: function(){ gsap.to(u.uProgress, { value: 1, duration: 1.8, ease: 'power3.out', overwrite: true }); },
        onLeave: function(){ gsap.to(u.uProgress, { value: 0, duration: 1.2, ease: 'power2.in', overwrite: true }); },
        onLeaveBack: function(){ gsap.to(u.uProgress, { value: 0, duration: 1.2, ease: 'power2.in', overwrite: true }); } });
    });
    window.addEventListener('resize', function(){ size(); clearTimeout(rebuildT); rebuildT = setTimeout(function(){ if (!ready) return; var nb = texture(); if (!nb) return; var old = box.tex; box = nb; u.uMap.value = box.tex; old.dispose(); }, 200); });
    window.addEventListener('pagehide', dispose, { once: true });
  }
  function frame(now){
    if (!active) return;
    raf = requestAnimationFrame(frame);
    var dt = t0 ? Math.min(0.1, (now - t0) / 1000) : 0; t0 = now;
    var v = lenis ? lenis.velocity : (window.scrollY - lastY); lastY = window.scrollY;
    v = Math.max(-120, Math.min(120, v || 0));
    vel += (v - vel) * 0.15;
    if (!ready) return;
    var r = el.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
    mesh.visible = !(r.bottom < -H || r.top > 2 * H);
    mesh.position.set(r.left - cr.left - W / 2 + r.width / 2, -(r.top - cr.top) + H / 2 - r.height / 2, 0);
    mesh.scale.set(box.w, box.h, 1);
    u.uVel.value = vel; u.uTime.value += dt * 3;
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
