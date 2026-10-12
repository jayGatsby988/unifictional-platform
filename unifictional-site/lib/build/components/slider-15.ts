// @ts-nocheck
// slider-15 · Single-plane WebGL film-strip slider (Awwwards Pack).
// One 16:9 plane; the photos roll through it vertically like a film strip
// while the plane bends with the scroll speed, then it snaps to the nearest
// frame and the title slides back in. The demo hijacked the window wheel on a
// one-screen page; here the section pins (CSS sticky) and the page scroll
// drives the strip, so the wheel still rolls it without trapping the page.
// Arrows, dots and the arrow keys scroll the page to the matching frame.
import type { Component } from "./_types";

function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}

const c: Component = {
  id: "slider-15",
  type: "film-strip-15",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "film-strip-15 (slider-15): a featured-work slider. The section pins for a few screens with one wide 16:9 photo plane in the middle, the section title above and a counter, the slide title and two arrow buttons below. Scrolling rolls the photos through the plane vertically like a strip of film, the plane bows and swells with the scroll speed, then settles and snaps to the nearest frame while the title slides up into place. Arrows, dots and the arrow keys jump to a frame. WebGL (three.js); phones and reduced motion get a plain crossfade slider in normal flow. Needs 4-8 landscape photos with a short title each. Suits builders, architects, landscapers, studios, restaurants and venues that want to feature a handful of projects.",
  fields: `{"type":"film-strip-15","component":"slider-15","eyebrow":"","title":"","items":[{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""}]}`,
  images: { min: 4, max: 8 },
  css: ({ pair, capsRule }) => `
.fs15{position:relative;background:var(--bg)}
.fs15__pin{position:relative;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto 1fr auto;gap:clamp(1rem,3vh,2rem);padding:clamp(4rem,10vh,8rem) var(--gutter) clamp(2rem,5vh,4rem)}
.fs15 .sec-head{margin-bottom:0}
.fs15__stage{position:relative;justify-self:center;align-self:center;width:min(100%,1200px);aspect-ratio:16/9;overflow:visible}
.fs15__img{position:absolute;inset:7%;overflow:hidden;background:var(--bg2);opacity:0;transition:opacity .5s}
.fs15__img.is-on{opacity:1}
.fs15__img img{width:100%;height:100%;object-fit:cover;display:block}
.fs15__gl{position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;transition:opacity .6s}
.fs15.is-gl .fs15__gl{opacity:1}
.fs15.is-gl .fs15__img{opacity:0!important}
.fs15.is-gl .fs15__img.is-on{opacity:1!important}
.fs15.is-gl.is-live .fs15__img{opacity:0!important;visibility:hidden}
.fs15__foot{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:1rem;justify-self:center;width:min(100%,1200px)}
.fs15__count{font-family:var(--mono);font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2)}
.fs15__mid{display:grid;gap:.9rem;justify-items:center;text-align:center}
.fs15__mask{overflow:hidden;line-height:1.1}
.fs15__title{display:block;font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}font-size:clamp(1.3rem,2.6vw,2.4rem);line-height:1.1;will-change:transform}
.fs15__dots{display:flex;gap:.4rem}
.fs15__dot{width:18px;height:14px;position:relative}
.fs15__dot::after{content:"";position:absolute;left:0;right:0;top:6px;height:2px;background:var(--line);transition:background .3s}
.fs15__dot:hover::after{background:var(--ink2)}
.fs15__dot[aria-current="true"]::after{background:var(--ink)}
.fs15__ctl{display:flex;gap:.6rem;justify-self:end}
.fs15__btn{width:48px;height:48px;border:1px solid var(--line);border-radius:999px;display:grid;place-items:center;color:var(--ink);transition:background .25s,color .25s,border-color .25s}
.fs15__btn:hover{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.fs15__btn svg{width:16px;height:16px}
.fs15__btn--prev svg{transform:scaleX(-1)}
.fs15__hint{font-family:var(--mono);font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;color:var(--ink3);display:none}
.fs15.is-gl .fs15__hint{display:block}
.fs15.is-gl{height:calc(100svh + (var(--n,4) - 1) * 60vh)}
.fs15.is-gl .fs15__pin{position:sticky;top:0;height:100svh;box-sizing:border-box;padding-top:clamp(4.5rem,9vh,6rem)}
.fs15.is-gl .fs15__stage{width:min(100%,1200px,calc((100svh - 19rem) * 16 / 9))}
.fs15.is-gl .fs15__foot{width:min(100%,1200px,calc((100svh - 19rem) * 16 / 9))}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .fs15,.fs15.is-gl{height:auto}
  .fs15.is-gl .fs15__pin{position:relative;height:auto;padding-top:clamp(4rem,10vh,8rem)}
  .fs15__gl{display:none}
  .fs15__img{inset:0}
  .fs15.is-gl .fs15__img{visibility:visible}
  .fs15.is-gl .fs15__img.is-on,.fs15.is-gl.is-live .fs15__img.is-on{opacity:1!important;visibility:visible}
  .fs15__foot{grid-template-columns:1fr auto;grid-template-areas:"mid mid" "count ctl"}
  .fs15__mid{grid-area:mid;justify-items:start;text-align:left}
  .fs15__count{grid-area:count}
  .fs15__ctl{grid-area:ctl}
  .fs15__title{transform:none!important}
  .fs15__hint{display:none!important}
}`,
  html: (s, { esc, imgUrl, arrow }) => {
    const items = (s.items || []).filter(Boolean).slice(0, 8);
    const n = items.length;
    return `
<section class="fs15" data-fx="film-strip-15" style="--n:${n}">
  <div class="fs15__pin">
    <div class="sec-head">
      <div>${s.eyebrow ? `<span class="mono reveal">${esc(s.eyebrow)}</span>` : ""}<h2 class="display reveal">${esc(s.title || "")}</h2></div>
      <p class="fs15__hint">Scroll to roll the strip</p>
    </div>
    <div class="fs15__stage">
      ${items.map((it, i) => { const p = pic(it, s, i); return `<div class="fs15__img${i === 0 ? " is-on" : ""}" data-title="${esc(it.title || "")}">${p ? `<img src="${esc(imgUrl(p, 1600))}" alt="${esc(it.alt || p.alt || it.title || "")}" loading="lazy" crossorigin="anonymous">` : ""}</div>`; }).join("")}
      <canvas class="fs15__gl" aria-hidden="true"></canvas>
    </div>
    <div class="fs15__foot">
      <span class="fs15__count"><b>01</b> / ${String(n).padStart(2, "0")}</span>
      <div class="fs15__mid">
        <div class="fs15__mask"><span class="fs15__title">${esc(n ? items[0].title || "" : "")}</span></div>
        <div class="fs15__dots" role="tablist" aria-label="Slides">${items.map((it, i) => `<button class="fs15__dot" type="button" role="tab" aria-label="Slide ${i + 1}: ${esc(it.title || "")}" aria-current="${i === 0 ? "true" : "false"}"></button>`).join("")}</div>
      </div>
      <div class="fs15__ctl">
        <button class="fs15__btn fs15__btn--prev" type="button" aria-label="Previous slide">${arrow}</button>
        <button class="fs15__btn fs15__btn--next" type="button" aria-label="Next slide">${arrow}</button>
      </div>
    </div>
  </div>
</section>`;
  },
  js: () => `
import * as THREE from "three";
(function(){
  var el = document.querySelector('[data-fx="film-strip-15"]');
  if (!el) return;
  var FX = window.__fx.FX, RM = window.__fx.RM;
  var stage = el.querySelector('.fs15__stage'), canvas = el.querySelector('.fs15__gl');
  var layers = [].slice.call(el.querySelectorAll('.fs15__img')), dots = [].slice.call(el.querySelectorAll('.fs15__dot'));
  var count = el.querySelector('.fs15__count b'), title = el.querySelector('.fs15__title');
  var n = layers.length; if (n < 2) return;
  var cur = 0, inView = false;
  function mark(i){ dots.forEach(function(d, k){ d.setAttribute('aria-current', k === i ? 'true' : 'false'); }); if (count) count.textContent = (i + 1 < 10 ? '0' : '') + (i + 1); }
  function setTitle(i){ if (title) title.textContent = layers[i].getAttribute('data-title') || ''; }
  // ---------- static slider (phones, reduced motion, no WebGL)
  function hasGL(){ try { var c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }
  if (!FX || !hasGL()) {
    function show(i){ i = (i + n) % n; if (i === cur) return; layers[cur].classList.remove('is-on'); layers[i].classList.add('is-on'); cur = i; mark(i); setTitle(i); }
    el.querySelector('.fs15__btn--next').addEventListener('click', function(){ show(cur + 1); });
    el.querySelector('.fs15__btn--prev').addEventListener('click', function(){ show(cur - 1); });
    dots.forEach(function(d, k){ d.addEventListener('click', function(){ show(k); }); });
    if (window.IntersectionObserver) new IntersectionObserver(function(es){ inView = es[0].isIntersecting; }, { threshold: 0.3 }).observe(el);
    document.addEventListener('keydown', function(e){ if (!inView || e.altKey || e.ctrlKey || e.metaKey) return; var t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return; if (e.key === 'ArrowRight') show(cur + 1); else if (e.key === 'ArrowLeft') show(cur - 1); });
    return;
  }
  // ---------- WebGL film strip, driven by the page scroll while the section is pinned
  el.classList.add('is-gl');
  var H = n - 1, pos = 0, target = 0, intensity = 0, tIntensity = 0, hidden = false, built = false, running = false, live = false, snapT = null, st = null;
  var renderer, scene, camera, mesh, mat, textures = [], res = [], blank;
  var VERT = [
    'uniform float uIntensity; varying vec2 vUv;',
    'void main(){ vUv = uv; vec3 p = position;',
    '  p.z += sin(uv.y * 3.14159) * uIntensity * 0.5 + sin(uv.x * 3.14159) * uIntensity * 0.2;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }'].join('\\n');
  var FRAG = [
    'uniform sampler2D uA; uniform sampler2D uB; uniform vec2 uResA; uniform vec2 uResB; uniform vec2 uPlane; uniform float uPos; varying vec2 vUv;',
    'vec2 cover(vec2 u, vec2 s, vec2 i){ float rs = s.x / s.y; float ri = i.x / i.y;',
    '  vec2 st = rs < ri ? vec2(i.x * s.y / i.y, s.y) : vec2(s.x, i.y * s.x / i.x);',
    '  vec2 o = (rs < ri ? vec2((st.x - s.x) / 2.0, 0.0) : vec2(0.0, (st.y - s.y) / 2.0)) / st;',
    '  return u * s / st + o; }',
    'void main(){ float p = fract(uPos);',
    '  vec2 a = vec2(vUv.x, mod(vUv.y - p, 1.0)); vec2 b = vec2(vUv.x, mod(vUv.y + 1.0 - p, 1.0));',
    '  gl_FragColor = vUv.y < p ? texture2D(uB, cover(b, uPlane, uResB)) : texture2D(uA, cover(a, uPlane, uResA)); }'].join('\\n');
  function build(){
    built = true;
    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
    camera.position.z = 5;
    blank = new THREE.DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1); blank.needsUpdate = true;
    for (var i = 0; i < n; i++) { textures[i] = blank; res[i] = new THREE.Vector2(16, 9); }
    mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, uniforms: {
      uIntensity: { value: 0 }, uPos: { value: 0 }, uA: { value: blank }, uB: { value: blank }, uResA: { value: res[0] }, uResB: { value: res[1] }, uPlane: { value: new THREE.Vector2(16, 9) } } });
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 32, 32), mat);
    scene.add(mesh);
    size();
    var loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous'); var loaded = 0;
    layers.forEach(function(l, i){ var im = l.querySelector('img'); if (!im) return; loader.load(im.currentSrc || im.src, function(t){
      t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
      textures[i] = t; res[i].set(t.image.width || 16, t.image.height || 9); loaded++;
      if (!live && textures[0] !== blank && (n < 2 || textures[1] !== blank)) { live = true; el.classList.add('is-live'); }
    }); });
    window.addEventListener('resize', size);
    window.addEventListener('pagehide', function(){ stop(); textures.forEach(function(t){ if (t && t !== blank) t.dispose(); }); mat.dispose(); mesh.geometry.dispose(); renderer.dispose(); }, { once: true });
  }
  function size(){
    var w = stage.clientWidth || 16, h = stage.clientHeight || 9;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    var vh = 2 * Math.tan(camera.fov * Math.PI / 360) * camera.position.z, vw = vh * camera.aspect;
    var pw = vw * 0.86, ph = pw * 9 / 16;
    if (mesh.geometry) mesh.geometry.dispose();
    mesh.geometry = new THREE.PlaneGeometry(pw, ph, 32, 32);
  }
  function idx(p){ var i = Math.floor(p); i = ((i % n) + n) % n; return i; }
  function tick(){
    pos += (target - pos) * 0.12;
    if (Math.abs(target - pos) < 0.0005) pos = target;
    intensity += (tIntensity - intensity) * 0.2; tIntensity *= 0.9;
    var i = idx(pos), j = (i + 1) % n;
    mat.uniforms.uA.value = textures[i]; mat.uniforms.uB.value = textures[j];
    mat.uniforms.uResA.value = res[i]; mat.uniforms.uResB.value = res[j];
    mat.uniforms.uPos.value = Math.abs(target - pos) < 0.001 && Math.abs(Math.round(pos) - pos) < 0.001 ? 0 : pos - Math.floor(pos);
    if (Math.abs(Math.round(pos) - pos) < 0.001 && Math.abs(target - pos) < 0.001) { mat.uniforms.uA.value = textures[idx(Math.round(pos))]; mat.uniforms.uResA.value = res[idx(Math.round(pos))]; }
    mat.uniforms.uIntensity.value = intensity;
    var sc = 1 + intensity * 0.08; mesh.scale.set(sc, sc, 1);
    var moving = Math.abs(target - pos) > 0.004;
    if (moving && !hidden) { hidden = true; gsap.to(title, { yPercent: 110, duration: 0.35, ease: 'power2.in', overwrite: true }); }
    else if (!moving && hidden) { hidden = false; var k = Math.round(pos); cur = Math.max(0, Math.min(H, k)); setTitle(cur); gsap.fromTo(title, { yPercent: 110 }, { yPercent: 0, duration: 0.5, ease: 'power3.out', overwrite: true }); }
    renderer.render(scene, camera);
  }
  function start(){ if (!running) { running = true; gsap.ticker.add(tick); } }
  function stop(){ if (running) { running = false; gsap.ticker.remove(tick); } }
  function scrollToIndex(k){
    k = Math.max(0, Math.min(H, k)); if (!st) return;
    var y = st.start + (k / H) * (st.end - st.start);
    var lenis = window.__fx.lenis;
    if (lenis) lenis.scrollTo(y, { duration: 0.8, immediate: RM }); else window.scrollTo({ top: y, behavior: 'smooth' });
  }
  function snap(){
    if (!st) return; var p = st.progress; if (p <= 0 || p >= 1) return;
    var k = Math.round(target); if (Math.abs(target - k) < 0.003) return;
    scrollToIndex(k);
  }
  st = ScrollTrigger.create({ trigger: el, start: 'top top', end: 'bottom bottom',
    onUpdate: function(self){
      target = self.progress * H;
      var v = self.getVelocity(); tIntensity = Math.max(-1, Math.min(1, v / 2600));
      var k = Math.max(0, Math.min(H, Math.round(target))); if (k !== cur || true) mark(k);
      clearTimeout(snapT); snapT = setTimeout(snap, 150);
    },
    onRefresh: function(self){ target = self.progress * H; pos = target; } });
  new IntersectionObserver(function(es){
    inView = es[0].isIntersecting;
    if (inView) { if (!built) build(); start(); } else stop();
  }, { rootMargin: '25% 0px' }).observe(el);
  el.querySelector('.fs15__btn--next').addEventListener('click', function(){ scrollToIndex(Math.round(target) + 1); });
  el.querySelector('.fs15__btn--prev').addEventListener('click', function(){ scrollToIndex(Math.round(target) - 1); });
  dots.forEach(function(d, k){ d.addEventListener('click', function(){ scrollToIndex(k); }); });
  document.addEventListener('keydown', function(e){
    if (!inView || e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); scrollToIndex(Math.round(target) + 1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); scrollToIndex(Math.round(target) - 1); }
  });
})();`,
};
export default c;
