// @ts-nocheck
// slider-9 · Inside-the-cylinder curved image carousel (Awwwards Pack, video only).
// Curved photo panels line the inside of a drum seen from within; a fixed
// wordmark sits over the centre. The drum drifts on its own, spins when
// dragged, coasts with inertia and settles on the nearest panel. three.js
// cylinder-segment meshes with a cover-mapped shader; static row otherwise.
import type { Component } from "./_types";

function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}

const c: Component = {
  id: "slider-9",
  type: "ring-carousel-9",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "(recreated from the preview video) ring-carousel-9 (slider-9): a dark, full-width showcase seen from inside a drum. Curved photo panels line the inside wall; the nearest ones at the left and right loom large and bend, the one straight ahead sits smaller in the middle, and one big WORD (the brand name or a 1-2 word field) stays fixed over the centre in the display face. The drum drifts slowly on its own, spins when you drag it and coasts to a stop on the nearest panel; arrows, dots and the arrow keys turn it one panel at a time, and a counter plus the front panel's title sit under the stage. WebGL (three.js); phones, reduced motion and no-WebGL get a swipeable row of the photos. Needs 6-12 landscape or square photos with a short title each and a 1-2 word wordmark. Suits fashion and editorial brands, photographers, salons, venues and studios with a strong name.",
  fields: `{"type":"ring-carousel-9","component":"slider-9","word":"","eyebrow":"","title":"","items":[{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""}]}`,
  images: { min: 6, max: 12 },
  css: ({ pair, capsRule }) => `
.rc9{position:relative;background:#070708;color:#fff;overflow:hidden;padding:clamp(4rem,10vh,8rem) 0 clamp(2rem,5vh,4rem)}
.rc9 .sec-head{padding:0 var(--gutter)}
.rc9 .sec-head p{color:rgba(255,255,255,.65)}
.rc9__stage{position:relative;height:clamp(460px,70vh,760px);cursor:grab;touch-action:pan-y;user-select:none;-webkit-user-select:none}
.rc9__stage.is-drag{cursor:grabbing}
.rc9__gl{position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;transition:opacity .8s}
.rc9.is-live .rc9__gl{opacity:1}
.rc9__veil{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,.05),rgba(0,0,0,.45) 85%)}
.rc9__word{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}font-size:clamp(3rem,10vw,10rem);line-height:1;text-align:center;text-shadow:0 10px 60px rgba(0,0,0,.6)}
.rc9__row{display:none;gap:1rem;overflow-x:auto;scroll-snap-type:x mandatory;scroll-padding:0 var(--gutter);padding:0 var(--gutter);scrollbar-width:none;height:100%;align-items:center}
.rc9__row::-webkit-scrollbar{display:none}
.rc9__row figure{flex:0 0 min(78vw,420px);margin:0;scroll-snap-align:start;display:grid;gap:.6rem}
.rc9__row .rc9__img{aspect-ratio:4/3;overflow:hidden;background:#1a1a1c;border-radius:2px}
.rc9__row img{width:100%;height:100%;object-fit:cover;display:block}
.rc9__row figcaption{font-family:var(--mono);font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.65)}
.rc9.is-static .rc9__row{display:flex}
.rc9.is-static .rc9__gl,.rc9.is-static .rc9__veil{display:none}
.rc9.is-static .rc9__stage{height:auto;cursor:default;touch-action:auto}
.rc9.is-static .rc9__word{position:relative;inset:auto;margin:1.5rem var(--gutter) 0;font-size:clamp(2.6rem,12vw,5rem);justify-items:start}
.rc9__foot{display:grid;grid-template-columns:1fr auto;align-items:center;gap:1rem 2rem;padding:1.5rem var(--gutter) 0}
.rc9__cap{display:flex;align-items:baseline;gap:1.2rem;min-width:0}
.rc9__count{font-family:var(--mono);font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.6)}
.rc9__title{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}font-size:clamp(1.2rem,2.2vw,1.9rem);line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rc9__nav{display:flex;align-items:center;gap:1.2rem}
.rc9__hint{font-family:var(--mono);font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.4)}
.rc9__dots{display:flex;gap:.4rem}
.rc9__dot{width:18px;height:14px;position:relative}
.rc9__dot::after{content:"";position:absolute;left:0;right:0;top:6px;height:2px;background:rgba(255,255,255,.28);transition:background .3s}
.rc9__dot[aria-current="true"]::after{background:#fff}
.rc9__ctl{display:flex;gap:.5rem}
.rc9__btn{width:48px;height:48px;border:1px solid rgba(255,255,255,.4);border-radius:999px;display:grid;place-items:center;color:#fff;transition:background .25s,color .25s}
.rc9__btn:hover{background:#fff;color:#000}
.rc9__btn svg{width:16px;height:16px}
.rc9__btn--prev svg{transform:scaleX(-1)}
.rc9.is-static .rc9__dots,.rc9.is-static .rc9__hint{display:none}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .rc9__row{display:flex}
  .rc9__gl,.rc9__veil,.rc9__dots,.rc9__hint{display:none}
  .rc9__stage{height:auto;cursor:default;touch-action:auto}
  .rc9__word{position:relative;inset:auto;margin:1.5rem var(--gutter) 0;font-size:clamp(2.6rem,12vw,5rem);justify-items:start}
  .rc9__foot{grid-template-columns:1fr}
  .rc9__cap{flex-direction:column;gap:.4rem}
  .rc9__title{white-space:normal}
}`,
  html: (s, { esc, imgUrl, arrow, spec }) => {
    const items = (s.items || []).filter(Boolean).slice(0, 12);
    const n = items.length;
    const word = (s.word || (spec.brand && spec.brand.name) || "").trim().split(/\s+/).slice(0, 2).join(" ");
    return `
<section class="rc9" data-fx="ring-carousel-9">
  ${s.title || s.eyebrow ? `<div class="sec-head"><div>${s.eyebrow ? `<span class="mono reveal">${esc(s.eyebrow)}</span>` : ""}<h2 class="display reveal">${esc(s.title || "")}</h2></div></div>` : ""}
  <div class="rc9__stage">
    <canvas class="rc9__gl" aria-hidden="true"></canvas>
    <div class="rc9__veil"></div>
    <div class="rc9__row">${items.map((it, i) => { const p = pic(it, s, i); return `<figure><div class="rc9__img">${p ? `<img src="${esc(imgUrl(p, 1200))}" alt="${esc(it.alt || p.alt || it.title || "")}" loading="lazy" crossorigin="anonymous" data-title="${esc(it.title || "")}">` : ""}</div>${it.title ? `<figcaption>${esc(it.title)}</figcaption>` : ""}</figure>`; }).join("")}</div>
    <div class="rc9__word" aria-hidden="true">${esc(word)}</div>
  </div>
  <div class="rc9__foot">
    <div class="rc9__cap"><span class="rc9__count"><b>01</b> / ${String(n).padStart(2, "0")}</span><span class="rc9__title">${esc(n ? items[0].title || "" : "")}</span></div>
    <div class="rc9__nav">
      <span class="rc9__hint">Drag to spin</span>
      <div class="rc9__dots" role="tablist" aria-label="Photos">${items.map((it, i) => `<button class="rc9__dot" type="button" role="tab" aria-label="Photo ${i + 1}: ${esc(it.title || "")}" aria-current="${i === 0 ? "true" : "false"}"></button>`).join("")}</div>
      <div class="rc9__ctl">
        <button class="rc9__btn rc9__btn--prev" type="button" aria-label="Previous photo">${arrow}</button>
        <button class="rc9__btn rc9__btn--next" type="button" aria-label="Next photo">${arrow}</button>
      </div>
    </div>
  </div>
</section>`;
  },
  js: () => `
import * as THREE from "three";
(function(){
  var el = document.querySelector('[data-fx="ring-carousel-9"]');
  if (!el) return;
  var FX = window.__fx.FX, RM = window.__fx.RM;
  var stage = el.querySelector('.rc9__stage'), canvas = el.querySelector('.rc9__gl'), row = el.querySelector('.rc9__row');
  var imgs = [].slice.call(el.querySelectorAll('.rc9__row img')), figs = [].slice.call(el.querySelectorAll('.rc9__row figure'));
  var dots = [].slice.call(el.querySelectorAll('.rc9__dot')), count = el.querySelector('.rc9__count b'), title = el.querySelector('.rc9__title');
  var n = figs.length; if (n < 2) return;
  var cur = 0, hover = false, inView = false;
  function mark(i){ if (i === cur) return; cur = i; dots.forEach(function(d, k){ d.setAttribute('aria-current', k === i ? 'true' : 'false'); }); if (count) count.textContent = (i + 1 < 10 ? '0' : '') + (i + 1); if (title) { var im = imgs[i]; title.textContent = im ? im.getAttribute('data-title') || '' : ''; } }
  function hasGL(){ try { var c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }
  // ---------- static row
  if (!FX || !hasGL()) {
    el.classList.add('is-static');
    function to(i){ i = (i + n) % n; mark(i); figs[i].scrollIntoView({ block: 'nearest', inline: 'start', behavior: RM ? 'auto' : 'smooth' }); }
    el.querySelector('.rc9__btn--next').addEventListener('click', function(){ to(cur + 1); });
    el.querySelector('.rc9__btn--prev').addEventListener('click', function(){ to(cur - 1); });
    row.addEventListener('scroll', function(){ var x = row.scrollLeft, best = 0, bd = 1e9; figs.forEach(function(f, i){ var d = Math.abs(f.offsetLeft - x - parseFloat(getComputedStyle(row).paddingLeft)); if (d < bd) { bd = d; best = i; } }); mark(best); }, { passive: true });
    return;
  }
  // ---------- the drum
  el.classList.add('is-gl');
  var R = 10, step = Math.PI * 2 / n, span = step * 0.82, H = R * 0.95;
  var rot = 0, vel = 0, dragging = false, px = 0, lastDx = 0, moved = 0, tween = null, flung = false, built = false, running = false, live = false;
  var renderer, scene, camera, group, mats = [], textures = [], blank;
  var VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var FRAG = [
    'uniform sampler2D uTex; uniform vec2 uRes; uniform vec2 uPlane; uniform float uDim; varying vec2 vUv;',
    'vec2 cover(vec2 u, vec2 s, vec2 i){ float rs = s.x / s.y; float ri = i.x / i.y;',
    '  vec2 st = rs < ri ? vec2(i.x * s.y / i.y, s.y) : vec2(s.x, i.y * s.x / i.x);',
    '  vec2 o = (rs < ri ? vec2((st.x - s.x) / 2.0, 0.0) : vec2(0.0, (st.y - s.y) / 2.0)) / st;',
    '  return u * s / st + o; }',
    'void main(){ vec2 uv = vec2(1.0 - vUv.x, vUv.y); vec4 c = texture2D(uTex, cover(uv, uPlane, uRes));',
    '  float e = smoothstep(0.0, 0.03, uv.x) * smoothstep(0.0, 0.03, 1.0 - uv.x);',
    '  gl_FragColor = vec4(c.rgb * uDim * e, 1.0); }'].join('\\n');
  function build(){
    built = true;
    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.set(0, 0, R * 0.55); camera.lookAt(0, 0, -1);
    group = new THREE.Group(); scene.add(group);
    blank = new THREE.DataTexture(new Uint8Array([30, 30, 32, 255]), 1, 1); blank.needsUpdate = true;
    var loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous'); var loaded = 0;
    for (var i = 0; i < n; i++) (function(i){
      var start = Math.PI + i * step - span / 2;
      var geo = new THREE.CylinderGeometry(R, R, H, 24, 1, true, start, span);
      var mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, uniforms: { uTex: { value: blank }, uRes: { value: new THREE.Vector2(4, 3) }, uPlane: { value: new THREE.Vector2(R * span, H) }, uDim: { value: 1 } } });
      mats.push(mat); group.add(new THREE.Mesh(geo, mat));
      var im = imgs[i]; if (!im) return;
      loader.load(im.currentSrc || im.src, function(t){ t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; textures[i] = t; mat.uniforms.uTex.value = t; mat.uniforms.uRes.value.set(t.image.width || 4, t.image.height || 3); loaded++; if (!live && loaded >= Math.min(3, n)) { live = true; el.classList.add('is-live'); } });
    })(i);
    size();
    window.addEventListener('resize', size);
    window.addEventListener('pagehide', function(){ stop(); textures.forEach(function(t){ if (t) t.dispose(); }); mats.forEach(function(m){ m.dispose(); }); group.children.forEach(function(m){ m.geometry.dispose(); }); renderer.dispose(); }, { once: true });
  }
  function size(){ var w = stage.clientWidth || 1, h = stage.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  function nearest(){ var k = Math.round(-rot / step); return ((k % n) + n) % n; }
  function tick(){
    if (!dragging && !tween) {
      if (Math.abs(vel) > 0.00005) { rot += vel; vel *= 0.95; if (flung && Math.abs(vel) < 0.0012) { flung = false; goTo(nearest()); } }
      else { vel = 0; if (!hover && inView) rot -= 0.0012; }
    } else if (dragging) { vel += (lastDx - vel) * 0.5; lastDx *= 0.6; }
    group.rotation.y = rot;
    for (var i = 0; i < n; i++) { var a = Math.PI + i * step + rot; var d = Math.cos(a - Math.PI); mats[i].uniforms.uDim.value = 0.45 + 0.55 * (0.5 + 0.5 * d); }
    mark(nearest());
    renderer.render(scene, camera);
  }
  function start(){ if (!running) { running = true; gsap.ticker.add(tick); } }
  function stop(){ if (running) { running = false; gsap.ticker.remove(tick); } }
  function goTo(i){
    var want = -i * step, diff = want - rot; diff = diff - Math.PI * 2 * Math.round(diff / (Math.PI * 2));
    if (tween) tween.kill(); vel = 0; var o = { v: rot };
    tween = gsap.to(o, { v: rot + diff, duration: 1.1, ease: 'power3.out', onUpdate: function(){ rot = o.v; }, onComplete: function(){ tween = null; } });
  }
  stage.addEventListener('pointerdown', function(e){ if (e.button) return; if (tween) { tween.kill(); tween = null; } dragging = true; moved = 0; px = e.clientX; lastDx = 0; vel = 0; stage.classList.add('is-drag'); stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', function(e){ if (!dragging) return; var dx = e.clientX - px; px = e.clientX; moved += Math.abs(dx); var d = -dx * 0.0032; rot += d; lastDx = d; });
  function endDrag(){ if (!dragging) return; dragging = false; stage.classList.remove('is-drag'); vel = Math.max(-0.12, Math.min(0.12, lastDx * 1.2)); flung = moved > 4; if (!flung) goTo(nearest()); }
  stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag); stage.addEventListener('lostpointercapture', endDrag);
  el.querySelector('.rc9__btn--next').addEventListener('click', function(){ goTo(cur + 1); });
  el.querySelector('.rc9__btn--prev').addEventListener('click', function(){ goTo(cur - 1); });
  dots.forEach(function(d, i){ d.addEventListener('click', function(){ goTo(i); }); });
  el.addEventListener('mouseenter', function(){ hover = true; });
  el.addEventListener('mouseleave', function(){ hover = false; });
  el.addEventListener('focusin', function(){ hover = true; });
  el.addEventListener('focusout', function(){ hover = false; });
  new IntersectionObserver(function(es){ inView = es[0].isIntersecting; if (inView) { if (!built) build(); start(); } else stop(); }, { rootMargin: '20% 0px' }).observe(el);
  document.addEventListener('keydown', function(e){
    if (!inView || e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (e.key === 'ArrowRight') goTo(cur + 1); else if (e.key === 'ArrowLeft') goTo(cur - 1);
  });
})();`,
};
export default c;
