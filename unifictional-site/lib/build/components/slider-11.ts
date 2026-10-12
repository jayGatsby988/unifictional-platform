// @ts-nocheck
// slider-11 · Stepped WebGL carousel with fullscreen expand (Awwwards Pack).
// Tall 1:2.5 photo planes in a row that steps down away from the active one.
// Drag, horizontal wheel, arrows, dots or keys slide the row; the whole frame
// refracts and colour-splits with the speed (a post pass replaces the demo's
// drei transmission material); clicking a plane ripples it open to fill the
// stage, clicking again closes it. The demo was React Three Fiber; the idea
// is rebuilt in plain three.js r160. Static row otherwise.
import type { Component } from "./_types";

function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}

const c: Component = {
  id: "slider-11",
  type: "step-carousel-11",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "step-carousel-11 (slider-11): a gallery slider on a quiet tinted stage. Tall portrait photo planes (1:2.5) stand in a row that steps down a little on each side of the active one, like a staircase seen from the front. Dragging, a sideways wheel, the arrows, the dots or the arrow keys glide the row so the next plane takes the centre; while it moves the whole picture refracts and the colours split at the edges, then it settles. Hovering a plane swells it slightly; clicking it ripples it open to fill the stage with that photo, and another click folds it back. Under the stage sit a counter, the active title and a line of text. It also advances every 5 s and pauses on hover. WebGL (three.js); phones and reduced motion get a swipeable row. Needs 4-8 portrait photos with a short title and one line each. Suits photographers, interior and landscape designers, fashion, galleries and portfolios.",
  fields: `{"type":"step-carousel-11","component":"slider-11","eyebrow":"","title":"","items":[{"query":"","alt":"","title":"","text":""},{"query":"","alt":"","title":"","text":""},{"query":"","alt":"","title":"","text":""},{"query":"","alt":"","title":"","text":""}]}`,
  images: { min: 4, max: 8 },
  css: ({ pair, capsRule }) => `
.sc11{position:relative;background:var(--bg2);overflow:hidden;padding:clamp(4rem,10vh,8rem) 0 clamp(2rem,5vh,4rem)}
.sc11 .sec-head{padding:0 var(--gutter)}
.sc11__stage{position:relative;height:clamp(500px,76vh,820px);cursor:grab;touch-action:pan-y;user-select:none;-webkit-user-select:none}
.sc11__stage.is-drag{cursor:grabbing}
.sc11__stage.is-hover{cursor:pointer}
.sc11__stage.is-open{cursor:zoom-out}
.sc11__gl{position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;transition:opacity .8s}
.sc11.is-live .sc11__gl{opacity:1}
.sc11__row{display:none;gap:1rem;overflow-x:auto;scroll-snap-type:x mandatory;scroll-padding:0 var(--gutter);padding:0 var(--gutter);scrollbar-width:none;height:100%;align-items:center}
.sc11__row::-webkit-scrollbar{display:none}
.sc11__row figure{flex:0 0 min(62vw,300px);margin:0;scroll-snap-align:start}
.sc11__row .sc11__img{aspect-ratio:3/5;overflow:hidden;background:var(--line)}
.sc11__row img{width:100%;height:100%;object-fit:cover;display:block}
.sc11.is-static .sc11__row{display:flex}
.sc11.is-static .sc11__gl{display:none}
.sc11.is-static .sc11__stage{height:auto;cursor:default;touch-action:auto}
.sc11__foot{display:grid;grid-template-columns:1fr auto;align-items:end;gap:1rem 2rem;padding:1.5rem var(--gutter) 0}
.sc11__cap{display:grid;gap:.5rem;min-width:0}
.sc11__count{font-family:var(--mono);font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2)}
.sc11__title{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}font-size:clamp(1.4rem,2.6vw,2.4rem);line-height:1.05}
.sc11__text{max-width:46ch;color:var(--ink2);font-size:.95rem}
.sc11__nav{display:flex;align-items:center;gap:1.2rem}
.sc11__hint{font-family:var(--mono);font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;color:var(--ink3)}
.sc11__dots{display:flex;gap:.4rem}
.sc11__dot{width:18px;height:14px;position:relative}
.sc11__dot::after{content:"";position:absolute;left:0;right:0;top:6px;height:2px;background:var(--line);transition:background .3s}
.sc11__dot:hover::after{background:var(--ink2)}
.sc11__dot[aria-current="true"]::after{background:var(--ink)}
.sc11__ctl{display:flex;gap:.5rem}
.sc11__btn{width:48px;height:48px;border:1px solid var(--line);border-radius:999px;display:grid;place-items:center;color:var(--ink);transition:background .25s,color .25s,border-color .25s}
.sc11__btn:hover{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.sc11__btn svg{width:16px;height:16px}
.sc11__btn--prev svg{transform:scaleX(-1)}
.sc11.is-static .sc11__dots,.sc11.is-static .sc11__hint{display:none}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .sc11__row{display:flex}
  .sc11__gl,.sc11__dots,.sc11__hint{display:none}
  .sc11__stage{height:auto;cursor:default;touch-action:auto}
  .sc11__foot{grid-template-columns:1fr}
}`,
  html: (s, { esc, imgUrl, arrow }) => {
    const items = (s.items || []).filter(Boolean).slice(0, 8);
    const n = items.length;
    return `
<section class="sc11" data-fx="step-carousel-11">
  <div class="sec-head">
    <div>${s.eyebrow ? `<span class="mono reveal">${esc(s.eyebrow)}</span>` : ""}<h2 class="display reveal">${esc(s.title || "")}</h2></div>
    <p class="sc11__hint reveal">Drag · click to open</p>
  </div>
  <div class="sc11__stage">
    <canvas class="sc11__gl" aria-hidden="true"></canvas>
    <div class="sc11__row">${items.map((it, i) => { const p = pic(it, s, i); return `<figure><div class="sc11__img">${p ? `<img src="${esc(imgUrl(p, 1000))}" alt="${esc(it.alt || p.alt || it.title || "")}" loading="lazy" crossorigin="anonymous" data-title="${esc(it.title || "")}" data-text="${esc(it.text || "")}">` : ""}</div></figure>`; }).join("")}</div>
  </div>
  <div class="sc11__foot">
    <div class="sc11__cap">
      <span class="sc11__count"><b>01</b> / ${String(n).padStart(2, "0")}</span>
      <h3 class="sc11__title">${esc(n ? items[0].title || "" : "")}</h3>
      <p class="sc11__text">${esc(n ? items[0].text || "" : "")}</p>
    </div>
    <div class="sc11__nav">
      <div class="sc11__dots" role="tablist" aria-label="Photos">${items.map((it, i) => `<button class="sc11__dot" type="button" role="tab" aria-label="Photo ${i + 1}: ${esc(it.title || "")}" aria-current="${i === 0 ? "true" : "false"}"></button>`).join("")}</div>
      <div class="sc11__ctl">
        <button class="sc11__btn sc11__btn--prev" type="button" aria-label="Previous photo">${arrow}</button>
        <button class="sc11__btn sc11__btn--next" type="button" aria-label="Next photo">${arrow}</button>
      </div>
    </div>
  </div>
</section>`;
  },
  js: () => `
import * as THREE from "three";
(function(){
  var el = document.querySelector('[data-fx="step-carousel-11"]');
  if (!el) return;
  var FX = window.__fx.FX, RM = window.__fx.RM;
  var stage = el.querySelector('.sc11__stage'), canvas = el.querySelector('.sc11__gl'), row = el.querySelector('.sc11__row');
  var imgs = [].slice.call(el.querySelectorAll('.sc11__row img')), figs = [].slice.call(el.querySelectorAll('.sc11__row figure'));
  var dots = [].slice.call(el.querySelectorAll('.sc11__dot')), count = el.querySelector('.sc11__count b'), title = el.querySelector('.sc11__title'), text = el.querySelector('.sc11__text');
  var n = figs.length; if (n < 2) return;
  var cur = 0, hover = false, inView = false, timer = null;
  function mark(i){
    if (i === cur) return; cur = i;
    dots.forEach(function(d, k){ d.setAttribute('aria-current', k === i ? 'true' : 'false'); });
    if (count) count.textContent = (i + 1 < 10 ? '0' : '') + (i + 1);
    var im = imgs[i], tt = im ? im.getAttribute('data-title') || '' : '', tx = im ? im.getAttribute('data-text') || '' : '';
    if (RM || !FX) { title.textContent = tt; text.textContent = tx; return; }
    gsap.to([title, text], { opacity: 0, y: -6, duration: 0.25, overwrite: true, onComplete: function(){ title.textContent = tt; text.textContent = tx; gsap.fromTo([title, text], { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.06, ease: 'power3.out' }); } });
  }
  function hasGL(){ try { var c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }
  // ---------- static row
  if (!FX || !hasGL()) {
    el.classList.add('is-static');
    function to(i){ i = (i + n) % n; mark(i); figs[i].scrollIntoView({ block: 'nearest', inline: 'start', behavior: RM ? 'auto' : 'smooth' }); }
    el.querySelector('.sc11__btn--next').addEventListener('click', function(){ to(cur + 1); });
    el.querySelector('.sc11__btn--prev').addEventListener('click', function(){ to(cur - 1); });
    row.addEventListener('scroll', function(){ var x = row.scrollLeft, best = 0, bd = 1e9; figs.forEach(function(f, i){ var d = Math.abs(f.offsetLeft - x - parseFloat(getComputedStyle(row).paddingLeft)); if (d < bd) { bd = d; best = i; } }); mark(best); }, { passive: true });
    return;
  }
  // ---------- WebGL carousel
  el.classList.add('is-gl');
  var PW = 1, PH = 2.5, GAP = 0.12, STEP = PW + GAP, PER = 100 / (n - 1);
  var progress = 0, oldProgress = 0, speed = 0, open = -1, busy = false, built = false, running = false, live = false;
  var dragging = false, px = 0, moved = 0, hovered = -1;
  var renderer, scene, camera, group, planes = [], mats = [], textures = [], blank, rt, post, postScene, postCam, ray, mouse, VW = 1, VH = 1, VWf = 1, VHf = 1;
  var VERT = [
    'varying vec2 vUv; uniform float uProgress; uniform vec2 uZoom;',
    'void main(){ vUv = uv; vec3 pos = position; float angle = uProgress * 3.14159265 / 2.0; float wave = cos(angle);',
    '  float c = sin(length(uv - 0.5) * 15.0 + uProgress * 12.0) * 0.5 + 0.5;',
    '  pos.x *= mix(1.0, uZoom.x + wave * c, uProgress); pos.y *= mix(1.0, uZoom.y + wave * c, uProgress);',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0); }'].join('\\n');
  var FRAG = [
    'uniform sampler2D uTex; uniform vec2 uRes; uniform vec2 uImg; varying vec2 vUv;',
    'vec2 cover(vec2 u, vec2 s, vec2 i){ float rs = s.x / s.y; float ri = i.x / i.y;',
    '  vec2 st = rs < ri ? vec2(i.x * s.y / i.y, s.y) : vec2(s.x, i.y * s.x / i.x);',
    '  vec2 o = (rs < ri ? vec2((st.x - s.x) / 2.0, 0.0) : vec2(0.0, (st.y - s.y) / 2.0)) / st;',
    '  return u * s / st + o; }',
    'void main(){ gl_FragColor = vec4(texture2D(uTex, cover(vUv, uRes, uImg)).rgb, 1.0); }'].join('\\n');
  var POST = [
    'uniform sampler2D uScene; uniform float uSpeed; varying vec2 vUv;',
    'void main(){ vec2 c = vUv - 0.5; float r = dot(c, c);',
    '  vec2 uv = vUv + c * r * uSpeed * 1.2; float ca = uSpeed * 0.018;',
    '  vec4 s = texture2D(uScene, uv);',
    '  vec3 col = vec3(texture2D(uScene, uv + vec2(ca, 0.0)).r, s.g, texture2D(uScene, uv - vec2(ca, 0.0)).b);',
    '  gl_FragColor = vec4(col, s.a); }'].join('\\n');
  function build(){
    built = true;
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100); camera.position.z = 4.7;
    group = new THREE.Group(); scene.add(group);
    ray = new THREE.Raycaster(); mouse = new THREE.Vector2(-2, -2);
    blank = new THREE.DataTexture(new Uint8Array([160, 160, 160, 255]), 1, 1); blank.needsUpdate = true;
    rt = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false, stencilBuffer: false });
    post = new THREE.ShaderMaterial({ vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }', fragmentShader: POST, depthTest: false, depthWrite: false, transparent: true, premultipliedAlpha: true, uniforms: { uScene: { value: rt.texture }, uSpeed: { value: 0 } } });
    postScene = new THREE.Scene(); postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    var quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post); quad.frustumCulled = false; postScene.add(quad);
    var loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous'); var loaded = 0;
    for (var i = 0; i < n; i++) (function(i){
      var mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uProgress: { value: 0 }, uZoom: { value: new THREE.Vector2(1, 1) }, uTex: { value: blank }, uRes: { value: new THREE.Vector2(PW, PH) }, uImg: { value: new THREE.Vector2(2, 5) } } });
      var mesh = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH, 30, 30), mat); mesh.userData.i = i;
      mesh.position.set(i * STEP, 0, 0);
      group.add(mesh); planes.push(mesh); mats.push(mat);
      var im = imgs[i]; if (!im) return;
      loader.load(im.currentSrc || im.src, function(tx){ tx.minFilter = THREE.LinearFilter; tx.magFilter = THREE.LinearFilter; tx.generateMipmaps = false; textures[i] = tx; mat.uniforms.uTex.value = tx; mat.uniforms.uImg.value.set(tx.image.width || 2, tx.image.height || 5); loaded++; if (!live && loaded >= Math.min(3, n)) { live = true; el.classList.add('is-live'); } });
    })(i);
    size();
    place(true);
    window.addEventListener('resize', size);
    window.addEventListener('pagehide', function(){ stop(); textures.forEach(function(t){ if (t) t.dispose(); }); mats.forEach(function(m){ m.dispose(); }); planes.forEach(function(m){ m.geometry.dispose(); }); rt.dispose(); post.dispose(); renderer.dispose(); }, { once: true });
  }
  function size(){
    var w = stage.clientWidth || 1, h = stage.clientHeight || 1, dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setSize(w, h, false); rt.setSize(Math.round(w * dpr), Math.round(h * dpr));
    camera.aspect = w / h; camera.updateProjectionMatrix();
    VH = 2 * Math.tan(camera.fov * Math.PI / 360) * camera.position.z; VW = VH * camera.aspect;
    VHf = 2 * Math.tan(camera.fov * Math.PI / 360) * (camera.position.z - 0.6); VWf = VHf * camera.aspect;
  }
  function active(){ return Math.max(0, Math.min(n - 1, Math.round(progress / PER))); }
  function place(instant){
    var a = active();
    planes.forEach(function(m, i){
      var pyr = i === a ? n : n - Math.abs(a - i);
      var x = (i - a) * STEP + (progress / PER - a) * -STEP, y = n * -0.1 + pyr * 0.1;
      if (open === i) { x = 0; y = 0; }
      if (instant) { m.position.x = x; m.position.y = y; }
      else { m.position.x += (x - m.position.x) * 0.1; m.position.y += (y - m.position.y) * 0.1; }
    });
    mark(a);
  }
  function tick(){
    progress = Math.max(0, Math.min(100, progress));
    speed += (Math.abs(oldProgress - progress) - speed) * 0.1;
    oldProgress += (progress - oldProgress) * 0.1;
    place(false);
    planes.forEach(function(m, i){ var s = (hovered === i && open < 0 && !dragging) ? 1.08 : 1; m.scale.x += (s - m.scale.x) * 0.15; m.scale.y += (s - m.scale.y) * 0.15; });
    post.uniforms.uSpeed.value = Math.min(1, speed * 0.6);
    renderer.setRenderTarget(rt); renderer.render(scene, camera);
    renderer.setRenderTarget(null); renderer.render(postScene, postCam);
  }
  function start(){ if (!running) { running = true; gsap.ticker.add(tick); } }
  function stop(){ if (running) { running = false; gsap.ticker.remove(tick); } }
  var P = { v: 0 };
  function goTo(i){ if (open >= 0) return; i = Math.max(0, Math.min(n - 1, i)); P.v = progress; gsap.to(P, { v: i * PER, duration: 1.1, ease: 'power3.out', overwrite: true, onUpdate: function(){ progress = P.v; } }); }
  function expand(i){
    if (busy || open >= 0) return; busy = true; open = i; progress = i * PER; stage.classList.add('is-open');
    var m = planes[i], u = mats[i].uniforms;
    u.uZoom.value.set(VWf / PW, VHf / PH);
    planes.forEach(function(p){ p.renderOrder = p === m ? 2 : 0; });
    gsap.to(m.position, { z: 0.6, duration: 0.3, ease: 'power3.out' });
    gsap.to(u.uProgress, { value: 1, duration: 1.4, ease: 'power3.out' });
    gsap.to(u.uRes.value, { x: VWf, y: VHf, duration: 1.4, ease: 'power3.out', onComplete: function(){ busy = false; } });
  }
  function collapse(){
    if (busy || open < 0) return; busy = true; var i = open, m = planes[i], u = mats[i].uniforms; stage.classList.remove('is-open');
    gsap.to(u.uProgress, { value: 0, duration: 1.2, ease: 'power3.out' });
    gsap.to(u.uRes.value, { x: PW, y: PH, duration: 1.2, ease: 'power3.out' });
    gsap.to(m.position, { z: 0, duration: 0.3, delay: 1.0, ease: 'power3.out', onComplete: function(){ open = -1; busy = false; m.renderOrder = 0; } });
  }
  function pick(e){
    var r = stage.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    var hit = ray.intersectObjects(planes, false)[0];
    return hit ? hit.object.userData.i : -1;
  }
  stage.addEventListener('pointermove', function(e){ if (!built) return; if (dragging) { var dx = e.clientX - px; px = e.clientX; moved += Math.abs(dx); if (open < 0) progress -= dx * PER / 260; return; } hovered = pick(e); stage.classList.toggle('is-hover', hovered >= 0 && open < 0); });
  stage.addEventListener('pointerleave', function(){ hovered = -1; stage.classList.remove('is-hover'); });
  stage.addEventListener('pointerdown', function(e){ if (e.button || !built) return; dragging = true; moved = 0; px = e.clientX; stage.classList.add('is-drag'); stage.setPointerCapture(e.pointerId); gsap.killTweensOf(P); });
  function endDrag(e){
    if (!dragging) return; dragging = false; stage.classList.remove('is-drag');
    if (moved < 5) { if (open >= 0) collapse(); else { var i = pick(e); if (i >= 0) expand(i); } }
    else if (open < 0) goTo(active());
    restart();
  }
  stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', function(){ dragging = false; stage.classList.remove('is-drag'); });
  stage.addEventListener('wheel', function(e){ if (open >= 0 || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; e.preventDefault(); e.stopPropagation(); progress = Math.max(0, Math.min(100, progress + e.deltaX * PER / 260)); clearTimeout(wT); wT = setTimeout(function(){ goTo(active()); }, 140); restart(); }, { passive: false });
  var wT = null;
  el.querySelector('.sc11__btn--next').addEventListener('click', function(){ if (open >= 0) collapse(); else goTo(active() + 1); restart(); });
  el.querySelector('.sc11__btn--prev').addEventListener('click', function(){ if (open >= 0) collapse(); else goTo(active() - 1); restart(); });
  dots.forEach(function(d, i){ d.addEventListener('click', function(){ if (open >= 0) collapse(); else goTo(i); restart(); }); });
  el.addEventListener('mouseenter', function(){ hover = true; });
  el.addEventListener('mouseleave', function(){ hover = false; });
  el.addEventListener('focusin', function(){ hover = true; });
  el.addEventListener('focusout', function(){ hover = false; });
  function restart(){ if (timer) clearInterval(timer); timer = setInterval(function(){ if (!hover && inView && !dragging && open < 0 && !document.hidden) goTo((active() + 1) % n); }, 5000); }
  new IntersectionObserver(function(es){ inView = es[0].isIntersecting; if (inView) { if (!built) build(); start(); } else stop(); }, { rootMargin: '20% 0px' }).observe(el);
  document.addEventListener('keydown', function(e){
    if (!inView || e.altKey || e.ctrlKey || e.metaKey) return;
    var tg = e.target; if (tg && (/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || tg.isContentEditable)) return;
    if (e.key === 'ArrowRight') { goTo(active() + 1); restart(); } else if (e.key === 'ArrowLeft') { goTo(active() - 1); restart(); } else if (e.key === 'Escape' && open >= 0) collapse();
  });
  restart();
})();`,
};
export default c;
