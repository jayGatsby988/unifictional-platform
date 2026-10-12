// @ts-nocheck
// slider-5 · Wavy chromatic wipe slider with inset card (Awwwards Pack, video only).
// Full-bleed photo behind a dark veil; a crisp 16:9 card of the same photo
// sits in the middle, the slide title at the left, a short line at the right.
// Changing slide sweeps a wobbling, rainbow-fringed edge across the backdrop
// (GLSL on one fullscreen quad), wipes the card top-down and scrambles the
// title into the new one. Static crossfade without WebGL, on phones and with
// reduced motion.
import type { Component } from "./_types";

const c: Component = {
  id: "slider-5",
  type: "wipe-chroma-5",
  kind: "hero",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "(recreated from the preview video) wipe-chroma-5 (slider-5): a cinematic full-screen hero slider. A full-bleed photo sits behind a dark veil; in the middle floats a crisp 16:9 card of the same photo like a screen, with a two-line slide title in caps and a small index at the left, a one-line description at the right, the button and slide dots along the bottom. Pressing an arrow, a key or a dot (or waiting 6 s) sweeps a wobbling, rainbow-fringed edge across the backdrop to reveal the next photo while the card wipes down to the new image and the title scrambles letter by letter into the new words. Needs 3-6 strong photos, each with a 2-4 word title and a line of text. Suits film and video studios, event and music venues, gaming and tech brands, agencies and anything that wants a dark, screen-like opener.",
  fields: `{"type":"wipe-chroma-5","component":"slider-5","slides":[{"query":"","alt":"","title":"","text":""},{"query":"","alt":"","title":"","text":""},{"query":"","alt":"","title":"","text":""}],"cta":{"label":"","href":"contact"}}`,
  images: { min: 3, max: 6 },
  css: ({ pair, capsRule }) => `
.wc5{position:relative;height:100svh;min-height:620px;overflow:hidden;background:#0b0c0e;color:#fff;user-select:none;-webkit-user-select:none}
.wc5__bg{position:absolute;inset:0;z-index:0}
.wc5__bg img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .9s;filter:saturate(.85)}
.wc5__bg img.is-on{opacity:1}
.wc5__gl{position:absolute;inset:0;z-index:1;width:100%;height:100%;display:block;opacity:0;transition:opacity .6s}
.wc5.is-live .wc5__gl{opacity:1}
.wc5.is-live .wc5__bg img{opacity:0!important}
.wc5__shade{position:absolute;inset:0;z-index:2;background:radial-gradient(ellipse at 50% 55%,rgba(0,0,0,.25),rgba(0,0,0,.62) 70%),linear-gradient(to top,rgba(0,0,0,.55),transparent 35%);pointer-events:none}
.wc5__grain{position:absolute;inset:0;z-index:2;pointer-events:none;opacity:.35;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.5'/%3E%3C/svg%3E")}
.wc5__card{position:absolute;z-index:3;left:50%;top:50%;transform:translate(-50%,-50%);width:min(46vw,760px);aspect-ratio:16/9;overflow:hidden;background:#000;box-shadow:0 40px 90px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.12)}
.wc5__card img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;visibility:hidden}
.wc5__card img.is-on{visibility:visible}
.wc5__card img.is-in{visibility:visible;z-index:2}
.wc5__copy{position:absolute;z-index:4;left:var(--gutter);top:50%;transform:translateY(-50%);width:min(24vw,340px);display:grid;gap:.9rem}
.wc5__idx{font-family:var(--mono);font-size:.65rem;letter-spacing:.2em;color:rgba(255,255,255,.6)}
.wc5__title{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}font-size:clamp(1.5rem,2.6vw,2.6rem);line-height:1.02;text-transform:uppercase;min-height:2em}
.wc5__text{position:absolute;z-index:4;right:var(--gutter);top:50%;transform:translateY(-50%);width:min(20vw,300px);text-align:right;font-size:.82rem;line-height:1.5;color:rgba(255,255,255,.72)}
.wc5__foot{position:absolute;z-index:5;left:var(--gutter);right:var(--gutter);bottom:2rem;display:flex;justify-content:space-between;align-items:center;gap:1.5rem}
.wc5__nav{display:flex;align-items:center;gap:1.2rem}
.wc5__dots{display:flex;gap:.5rem;align-items:center}
.wc5__dot{width:26px;height:14px;position:relative}
.wc5__dot::after{content:"";position:absolute;left:0;right:0;top:6px;height:2px;background:rgba(255,255,255,.3);transition:background .3s}
.wc5__dot[aria-current="true"]::after{background:#fff}
.wc5__ctl{display:flex;gap:.5rem}
.wc5__btn{width:48px;height:48px;border:1px solid rgba(255,255,255,.4);border-radius:999px;display:grid;place-items:center;color:#fff;transition:background .25s,color .25s}
.wc5__btn:hover{background:#fff;color:#000}
.wc5__btn svg{width:16px;height:16px}
.wc5__btn--prev svg{transform:scaleX(-1)}
.wc5__count{font-family:var(--mono);font-size:.65rem;letter-spacing:.16em;color:rgba(255,255,255,.6)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .wc5{height:auto;min-height:100svh;display:grid;align-content:end;gap:1.4rem;padding:6.5rem var(--gutter) 2rem}
  .wc5__gl{display:none}
  .wc5__card{position:relative;left:auto;top:auto;transform:none;width:100%;order:1}
  .wc5__copy{position:relative;left:auto;top:auto;transform:none;width:100%;order:2}
  .wc5__title{font-size:clamp(2rem,9vw,3rem);min-height:0}
  .wc5__text{position:relative;right:auto;top:auto;transform:none;width:100%;text-align:left;order:3}
  .wc5__foot{position:relative;left:auto;right:auto;bottom:auto;order:4;flex-wrap:wrap;margin-top:.5rem}
  .wc5__dots{display:none}
}`,
  html: (s, { esc, imgUrl, link, arrow }) => {
    const slides = (s.slides || []).filter(Boolean).slice(0, 6);
    const n = slides.length;
    const src = (sl, w) => esc(imgUrl(sl.image || sl, w));
    const alt = (sl) => esc(sl.alt || (sl.image && sl.image.alt) || sl.title || "");
    return `
<section class="wc5" id="top" data-fx="wipe-chroma-5">
  <div class="wc5__bg">${slides.map((sl, i) => `<img src="${src(sl, 2000)}" alt="" ${i === 0 ? 'class="is-on" fetchpriority="high"' : 'loading="lazy"'} crossorigin="anonymous" data-title="${esc(sl.title || "")}" data-text="${esc(sl.text || "")}">`).join("")}</div>
  <canvas class="wc5__gl" aria-hidden="true"></canvas>
  <div class="wc5__shade"></div><div class="wc5__grain"></div>
  <div class="wc5__card">${slides.map((sl, i) => `<img src="${src(sl, 1400)}" alt="${alt(sl)}" ${i === 0 ? 'class="is-on" fetchpriority="high"' : 'loading="lazy"'}>`).join("")}</div>
  <div class="wc5__copy">
    <span class="wc5__idx">№ <b>01</b></span>
    <h1 class="wc5__title">${esc(n ? slides[0].title || "" : "")}</h1>
  </div>
  <p class="wc5__text">${esc(n ? slides[0].text || "" : "")}</p>
  <div class="wc5__foot">
    ${s.cta ? `<a class="btn btn-primary" href="${esc(link(s.cta.href))}">${esc(s.cta.label)}${arrow}</a>` : "<span></span>"}
    <div class="wc5__nav">
      <span class="wc5__count"><b>01</b> / ${String(n).padStart(2, "0")}</span>
      <div class="wc5__dots" role="tablist" aria-label="Slides">${slides.map((sl, i) => `<button class="wc5__dot" type="button" role="tab" aria-label="Slide ${i + 1}: ${esc(sl.title || "")}" aria-current="${i === 0 ? "true" : "false"}"></button>`).join("")}</div>
      <div class="wc5__ctl">
        <button class="wc5__btn wc5__btn--prev" type="button" aria-label="Previous slide">${arrow}</button>
        <button class="wc5__btn wc5__btn--next" type="button" aria-label="Next slide">${arrow}</button>
      </div>
    </div>
  </div>
</section>`;
  },
  js: () => `
import * as THREE from "three";
(function(){
  var el = document.querySelector('[data-fx="wipe-chroma-5"]');
  if (!el) return;
  var FX = window.__fx.FX, RM = window.__fx.RM;
  var bgs = [].slice.call(el.querySelectorAll('.wc5__bg img')), cards = [].slice.call(el.querySelectorAll('.wc5__card img'));
  var dots = [].slice.call(el.querySelectorAll('.wc5__dot')), canvas = el.querySelector('.wc5__gl');
  var title = el.querySelector('.wc5__title'), text = el.querySelector('.wc5__text'), idx = el.querySelector('.wc5__idx b'), count = el.querySelector('.wc5__count b');
  var n = bgs.length; if (n < 2) return;
  var cur = 0, busy = false, hover = false, inView = true, timer = null, live = false;
  var GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#+[]/\\\\';
  function pad(i){ return (i + 1 < 10 ? '0' : '') + (i + 1); }
  function mark(i){ dots.forEach(function(d, k){ d.setAttribute('aria-current', k === i ? 'true' : 'false'); }); if (idx) idx.textContent = pad(i); if (count) count.textContent = pad(i); }
  function scramble(to){
    if (RM || !FX) { title.textContent = to; return; }
    var from = title.textContent || '', len = Math.max(from.length, to.length), t0 = performance.now(), D = 900;
    function frame(now){
      var p = Math.min(1, (now - t0) / D), out = '';
      for (var i = 0; i < len; i++) {
        var settle = (i / len) * 0.6 + 0.3;
        var ch = to[i] || '';
        if (p >= settle || ch === ' ') out += ch;
        else out += (from[i] && p < settle * 0.4) ? from[i] : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      }
      title.textContent = out;
      if (p < 1) requestAnimationFrame(frame); else title.textContent = to;
    }
    requestAnimationFrame(frame);
  }
  function swapCard(to){
    var from = cards[cur], next = cards[to];
    if (RM || !FX) { from.classList.remove('is-on'); next.classList.add('is-on'); return; }
    gsap.killTweensOf([from, next]);
    next.classList.add('is-in');
    gsap.fromTo(next, { clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)', duration: 1.1, ease: 'power3.inOut', onComplete: function(){ from.classList.remove('is-on'); next.classList.remove('is-in'); next.classList.add('is-on'); gsap.set(next, { clearProps: 'clipPath' }); } });
  }
  function swapText(to){
    var tx = bgs[to].getAttribute('data-text') || '';
    if (RM || !FX) { text.textContent = tx; return; }
    gsap.to(text, { opacity: 0, y: -8, duration: 0.3, overwrite: true, onComplete: function(){ text.textContent = tx; gsap.fromTo(text, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.6, delay: 0.3, ease: 'power3.out' }); } });
  }
  // ---------- WebGL wipe on a fullscreen quad
  var renderer, scene, camera, mat, textures = [], res = [], blank, built = false;
  var FRAG = [
    'precision highp float; uniform sampler2D uA; uniform sampler2D uB; uniform vec2 uResA; uniform vec2 uResB; uniform vec2 uRes; uniform float uProgress; uniform float uTime; uniform float uDir; varying vec2 vUv;',
    'vec2 cover(vec2 u, vec2 s, vec2 i){ float rs = s.x / s.y; float ri = i.x / i.y;',
    '  vec2 st = rs < ri ? vec2(i.x * s.y / i.y, s.y) : vec2(s.x, i.y * s.x / i.x);',
    '  vec2 o = (rs < ri ? vec2((st.x - s.x) / 2.0, 0.0) : vec2(0.0, (st.y - s.y) / 2.0)) / st;',
    '  return u * s / st + o; }',
    'vec3 rainbow(float h){ return 0.5 + 0.5 * cos(6.28318 * (h + vec3(0.0, 0.33, 0.67))); }',
    'void main(){',
    '  float x = uDir > 0.0 ? vUv.x : 1.0 - vUv.x;',
    '  float wave = sin(vUv.y * 5.0 + uTime * 2.2) * 0.045 + sin(vUv.y * 12.0 - uTime * 3.4) * 0.022 + sin(vUv.y * 23.0 + uTime * 5.0) * 0.008;',
    '  float edge = uProgress * 1.5 - 0.25 + wave;',
    '  float d = x - edge; float band = 0.085;',
    '  float m = smoothstep(-0.012, 0.012, d);',
    '  float prox = 1.0 - smoothstep(0.0, band, abs(d));',
    '  float zoomB = 1.0 + 0.06 * (1.0 - uProgress); float zoomA = 1.0 + 0.06 * uProgress;',
    '  vec2 ca = (vUv - 0.5) / zoomA + 0.5; vec2 cb = (vUv - 0.5) / zoomB + 0.5;',
    '  vec2 ua = cover(ca, uRes, uResA); vec2 ub = cover(cb, uRes, uResB);',
    '  vec2 off = vec2(prox * prox * 0.03 * uDir, prox * 0.004);',
    '  vec3 a = vec3(texture2D(uA, ua + off).r, texture2D(uA, ua).g, texture2D(uA, ua - off).b);',
    '  vec3 b = vec3(texture2D(uB, ub + off).r, texture2D(uB, ub).g, texture2D(uB, ub - off).b);',
    '  vec3 col = mix(b, a, m);',
    '  float h = fract(vUv.y * 1.6 + uTime * 0.25 + d * 6.0);',
    '  float glow = pow(prox, 2.5) * (uProgress > 0.0 && uProgress < 1.0 ? 1.0 : 0.0);',
    '  col = mix(col, rainbow(h), glow * 0.6) + rainbow(h) * glow * 0.25;',
    '  gl_FragColor = vec4(col, 1.0); }'].join('\\n');
  var VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }';
  function hasGL(){ try { var c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }
  function size(){ if (!renderer) return; var w = el.clientWidth || 1, h = el.clientHeight || 1; renderer.setSize(w, h, false); mat.uniforms.uRes.value.set(w, h); render(); }
  function render(){ if (renderer && live) renderer.render(scene, camera); }
  function build(){
    built = true;
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    blank = new THREE.DataTexture(new Uint8Array([12, 13, 15, 255]), 1, 1); blank.needsUpdate = true;
    for (var i = 0; i < n; i++) { textures[i] = blank; res[i] = new THREE.Vector2(16, 9); }
    mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false, uniforms: {
      uA: { value: blank }, uB: { value: blank }, uResA: { value: res[0] }, uResB: { value: res[1] }, uRes: { value: new THREE.Vector2(16, 9) }, uProgress: { value: 0 }, uTime: { value: 0 }, uDir: { value: 1 } } });
    var quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false; scene.add(quad);
    var loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
    bgs.forEach(function(im, i){ loader.load(im.currentSrc || im.src, function(t){
      t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
      textures[i] = t; res[i].set(t.image.width || 16, t.image.height || 9);
      if (!live && textures[0] !== blank && textures[1] !== blank) { live = true; mat.uniforms.uA.value = textures[cur]; mat.uniforms.uResA.value = res[cur]; size(); el.classList.add('is-live'); }
    }); });
    size();
    window.addEventListener('resize', size);
    window.addEventListener('pagehide', function(){ textures.forEach(function(t){ if (t && t !== blank) t.dispose(); }); mat.dispose(); quad.geometry.dispose(); renderer.dispose(); }, { once: true });
  }
  function go(to, dir){
    if (busy || to === cur) return;
    busy = true;
    var from = cur; cur = to; mark(to);
    scramble(bgs[to].getAttribute('data-title') || ''); swapText(to); swapCard(to);
    if (live) {
      mat.uniforms.uA.value = textures[from]; mat.uniforms.uResA.value = res[from];
      mat.uniforms.uB.value = textures[to]; mat.uniforms.uResB.value = res[to];
      mat.uniforms.uDir.value = dir; mat.uniforms.uProgress.value = 0;
      var t0 = performance.now();
      gsap.to(mat.uniforms.uProgress, { value: 1, duration: 1.6, ease: 'power2.inOut', onUpdate: function(){ mat.uniforms.uTime.value = (performance.now() - t0) / 1000; render(); }, onComplete: function(){ mat.uniforms.uA.value = textures[to]; mat.uniforms.uResA.value = res[to]; mat.uniforms.uProgress.value = 0; render(); busy = false; } });
    } else {
      bgs[from].classList.remove('is-on'); bgs[to].classList.add('is-on');
      setTimeout(function(){ busy = false; }, RM ? 50 : 900);
    }
  }
  function nextSlide(){ go((cur + 1) % n, 1); }
  function prevSlide(){ go((cur - 1 + n) % n, -1); }
  function restart(){ if (timer) clearInterval(timer); timer = null; if (RM) return; timer = setInterval(function(){ if (!hover && inView && !document.hidden && !busy) nextSlide(); }, 6000); }
  el.querySelector('.wc5__btn--next').addEventListener('click', function(){ nextSlide(); restart(); });
  el.querySelector('.wc5__btn--prev').addEventListener('click', function(){ prevSlide(); restart(); });
  dots.forEach(function(d, k){ d.addEventListener('click', function(){ go(k, k > cur ? 1 : -1); restart(); }); });
  el.addEventListener('mouseenter', function(){ hover = true; });
  el.addEventListener('mouseleave', function(){ hover = false; });
  el.addEventListener('focusin', function(){ hover = true; });
  el.addEventListener('focusout', function(){ hover = false; });
  // swipe / drag
  var sx = null;
  el.addEventListener('pointerdown', function(e){ if (e.button || e.target.closest('a,button')) return; sx = e.clientX; });
  el.addEventListener('pointerup', function(e){ if (sx === null) return; var dx = e.clientX - sx; sx = null; if (Math.abs(dx) > 50) { if (dx < 0) nextSlide(); else prevSlide(); restart(); } });
  el.addEventListener('pointercancel', function(){ sx = null; });
  if (window.IntersectionObserver) new IntersectionObserver(function(es){ inView = es[0].isIntersecting; if (inView && FX && !built && hasGL()) build(); }, { threshold: 0.2 }).observe(el);
  else if (FX && hasGL()) build();
  document.addEventListener('keydown', function(e){
    if (!inView || e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (e.key === 'ArrowRight') { nextSlide(); restart(); } else if (e.key === 'ArrowLeft') { prevSlide(); restart(); }
  });
  setTimeout(function(){ bgs.concat(cards).forEach(function(im){ im.loading = 'eager'; }); }, 1200);
  if (FX) { gsap.from(el.querySelector('.wc5__card'), { opacity: 0, y: 30, duration: 1.2, ease: 'power3.out', delay: 0.2 }); gsap.from([el.querySelector('.wc5__copy'), text, el.querySelector('.wc5__foot')], { opacity: 0, y: 16, duration: 1, stagger: 0.12, ease: 'power3.out', delay: 0.5 }); }
  restart();
})();`,
};
export default c;
