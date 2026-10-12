// @ts-nocheck
// slider-7 · Infinite WebGL strip with bulge and text ring (Awwwards Pack).
// Mixed-size photo planes run in an endless row; the whole picture is drawn
// to a render target and re-projected on a dense plane whose centre bulges
// with the speed, while a tilted ring of text turns through the strip, grey
// behind the photos and inverted in front of them. Clicking a photo bends
// and swells it to fill the stage; another click folds it back. The demo
// (three r122 + virtual-scroll) hijacked the window wheel; here the section
// pins and the page scroll moves the strip, with drag, arrows, dots and keys
// on top. Rewritten against three r160 as ES modules.
import type { Component } from "./_types";

function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}
const SIZES = [[0.345, 0.345, 0], [0.375, 0.585, 0], [0.345, 0.345, -0.1875], [0.225, 0.225, 0], [0.375, 0.585, 0], [0.225, 0.225, 0.225], [0.345, 0.345, -0.1875]];

const c: Component = {
  id: "slider-7",
  type: "strip-bulge-7",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "strip-bulge-7 (slider-7): a full-screen pinned showcase. Photos of mixed sizes (small squares, tall portraits, some raised, some dropped) run in an endless row across the middle of the screen; as you scroll the row slides along and the whole picture bulges out of the centre with the speed, settling flat when you stop. A big tilted ring of text (a 2-4 word phrase, by default the brand name) turns slowly through the row, grey where it passes behind the photos and inverted where it crosses in front of them. Hovering a photo shows a pointer; clicking it bends and swells it to fill the stage, and another click folds it back. You can also drag the row, press the arrows or the arrow keys, or pick a dot; a counter and the centred photo's title sit at the bottom. WebGL (three.js); phones, reduced motion and no-WebGL get a swipeable row. Needs 6-12 photos with a short title each and a short ring phrase. Suits photographers, fashion, creative studios, galleries and makers with a bold, playful brand.",
  fields: `{"type":"strip-bulge-7","component":"slider-7","ring":"","eyebrow":"","title":"","items":[{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""},{"query":"","alt":"","title":""}]}`,
  images: { min: 6, max: 12 },
  css: ({ pair, capsRule }) => `
.sb7{position:relative;background:var(--bg)}
.sb7__pin{position:relative;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto 1fr auto;gap:1rem;padding:clamp(4rem,10vh,8rem) var(--gutter) clamp(2rem,5vh,4rem)}
.sb7 .sec-head{margin-bottom:0;position:relative;z-index:2}
.sb7__hint{font-family:var(--mono);font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;color:var(--ink3);display:none}
.sb7.is-gl .sb7__hint{display:block}
.sb7__stage{position:relative;min-height:0;min-width:0}
.sb7__gl{position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;transition:opacity .8s}
.sb7.is-live .sb7__gl{opacity:1}
.sb7__row{display:flex;gap:1rem;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;align-items:center;padding:1rem 0}
.sb7__row::-webkit-scrollbar{display:none}
.sb7__row figure{flex:0 0 min(70vw,var(--fw,300px));margin:0;scroll-snap-align:start;display:grid;gap:.5rem}
.sb7__row .sb7__img{aspect-ratio:var(--ar,1);overflow:hidden;background:var(--bg2)}
.sb7__row img{width:100%;height:100%;object-fit:cover;display:block}
.sb7__row figcaption{font-family:var(--mono);font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink2)}
.sb7.is-gl .sb7__row{display:none}
.sb7.is-gl .sb7__stage{cursor:grab}
.sb7.is-gl .sb7__stage.is-drag{cursor:grabbing}
.sb7.is-gl .sb7__stage.is-hover{cursor:pointer}
.sb7.is-gl .sb7__stage.is-open{cursor:zoom-out}
.sb7__foot{position:relative;z-index:2;display:grid;grid-template-columns:1fr auto;align-items:center;gap:1rem 2rem;pointer-events:none}
.sb7__foot>*{pointer-events:auto}
.sb7__cap{display:flex;align-items:baseline;gap:1.2rem;min-width:0}
.sb7__count{font-family:var(--mono);font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2)}
.sb7__title{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}font-size:clamp(1.2rem,2.2vw,1.9rem);line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sb7__nav{display:flex;align-items:center;gap:1.2rem}
.sb7__dots{display:flex;gap:.4rem}
.sb7__dot{width:18px;height:14px;position:relative}
.sb7__dot::after{content:"";position:absolute;left:0;right:0;top:6px;height:2px;background:var(--line);transition:background .3s}
.sb7__dot:hover::after{background:var(--ink2)}
.sb7__dot[aria-current="true"]::after{background:var(--ink)}
.sb7__ctl{display:flex;gap:.5rem}
.sb7__btn{width:48px;height:48px;border:1px solid var(--line);border-radius:999px;display:grid;place-items:center;color:var(--ink);background:var(--bg);transition:background .25s,color .25s,border-color .25s}
.sb7__btn:hover{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.sb7__btn svg{width:16px;height:16px}
.sb7__btn--prev svg{transform:scaleX(-1)}
.sb7.is-gl{height:calc(100svh + 180vh)}
.sb7.is-gl .sb7__pin{position:sticky;top:0;height:100svh;box-sizing:border-box;padding-top:clamp(4.5rem,9vh,6rem)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .sb7,.sb7.is-gl{height:auto}
  .sb7.is-gl .sb7__pin{position:relative;height:auto;padding-top:clamp(4rem,10vh,8rem)}
  .sb7__gl,.sb7__hint,.sb7__dots{display:none!important}
  .sb7.is-gl .sb7__row{display:flex}
  .sb7__foot{grid-template-columns:1fr}
  .sb7__cap{flex-direction:column;gap:.4rem}
  .sb7__title{white-space:normal}
}`,
  html: (s, { esc, imgUrl, arrow, spec }) => {
    const items = (s.items || []).filter(Boolean).slice(0, 12);
    const n = items.length;
    const ring = (s.ring || (spec.brand && spec.brand.name) || "").trim();
    return `
<section class="sb7" data-fx="strip-bulge-7" data-ring="${esc(ring)}">
  <div class="sb7__pin">
    <div class="sec-head">
      <div>${s.eyebrow ? `<span class="mono reveal">${esc(s.eyebrow)}</span>` : ""}<h2 class="display reveal">${esc(s.title || "")}</h2></div>
      <p class="sb7__hint">Scroll or drag · click a photo</p>
    </div>
    <div class="sb7__stage">
      <canvas class="sb7__gl" aria-hidden="true"></canvas>
      <div class="sb7__row">${items.map((it, i) => { const p = pic(it, s, i); const sz = SIZES[i % SIZES.length]; return `<figure style="--ar:${sz[0]}/${sz[1]};--fw:${Math.round(sz[0] * 800)}px"><div class="sb7__img">${p ? `<img src="${esc(imgUrl(p, 1200))}" alt="${esc(it.alt || p.alt || it.title || "")}" loading="lazy" crossorigin="anonymous" data-title="${esc(it.title || "")}">` : ""}</div>${it.title ? `<figcaption>${esc(it.title)}</figcaption>` : ""}</figure>`; }).join("")}</div>
    </div>
    <div class="sb7__foot">
      <div class="sb7__cap"><span class="sb7__count"><b>01</b> / ${String(n).padStart(2, "0")}</span><span class="sb7__title">${esc(n ? items[0].title || "" : "")}</span></div>
      <div class="sb7__nav">
        <div class="sb7__dots" role="tablist" aria-label="Photos">${items.map((it, i) => `<button class="sb7__dot" type="button" role="tab" aria-label="Photo ${i + 1}: ${esc(it.title || "")}" aria-current="${i === 0 ? "true" : "false"}"></button>`).join("")}</div>
        <div class="sb7__ctl">
          <button class="sb7__btn sb7__btn--prev" type="button" aria-label="Previous photo">${arrow}</button>
          <button class="sb7__btn sb7__btn--next" type="button" aria-label="Next photo">${arrow}</button>
        </div>
      </div>
    </div>
  </div>
</section>`;
  },
  js: ({ t, pair }) => `
import * as THREE from "three";
(function(){
  var el = document.querySelector('[data-fx="strip-bulge-7"]');
  if (!el) return;
  var FX = window.__fx.FX, RM = window.__fx.RM;
  var stage = el.querySelector('.sb7__stage'), canvas = el.querySelector('.sb7__gl'), row = el.querySelector('.sb7__row');
  var imgs = [].slice.call(el.querySelectorAll('.sb7__row img')), figs = [].slice.call(el.querySelectorAll('.sb7__row figure'));
  var dots = [].slice.call(el.querySelectorAll('.sb7__dot')), count = el.querySelector('.sb7__count b'), title = el.querySelector('.sb7__title');
  var n = figs.length; if (n < 2) return;
  var cur = 0, inView = false;
  function mark(i){ if (i === cur) return; cur = i; dots.forEach(function(d, k){ d.setAttribute('aria-current', k === i ? 'true' : 'false'); }); if (count) count.textContent = (i + 1 < 10 ? '0' : '') + (i + 1); if (title) { var im = imgs[i]; title.textContent = im ? im.getAttribute('data-title') || '' : ''; } }
  function hasGL(){ try { var c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }
  // ---------- static row
  if (!FX || !hasGL()) {
    function to(i){ i = (i + n) % n; mark(i); figs[i].scrollIntoView({ block: 'nearest', inline: 'start', behavior: RM ? 'auto' : 'smooth' }); }
    el.querySelector('.sb7__btn--next').addEventListener('click', function(){ to(cur + 1); });
    el.querySelector('.sb7__btn--prev').addEventListener('click', function(){ to(cur - 1); });
    row.addEventListener('scroll', function(){ var x = row.scrollLeft, best = 0, bd = 1e9; figs.forEach(function(f, i){ var d = Math.abs(f.offsetLeft - x); if (d < bd) { bd = d; best = i; } }); mark(best); }, { passive: true });
    if (window.IntersectionObserver) new IntersectionObserver(function(es){ inView = es[0].isIntersecting; }, { threshold: 0.3 }).observe(el);
    document.addEventListener('keydown', function(e){ if (!inView || e.altKey || e.ctrlKey || e.metaKey) return; var tg = e.target; if (tg && (/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || tg.isContentEditable)) return; if (e.key === 'ArrowRight') to(cur + 1); else if (e.key === 'ArrowLeft') to(cur - 1); });
    return;
  }
  // ---------- WebGL strip
  el.classList.add('is-gl');
  var SIZES = ${JSON.stringify(SIZES)}, SPACING = 0.2;
  var built = false, running = false, live = false, st = null;
  var renderer, camera, VW = 1, VH = 1, ratio = 1, sceneSlides, sceneBlur, sceneMain, rt1, rt2, slides = [], stripW = 0;
  var postMat, outMat, outMesh, ringGroup, ringFront, ringBack, texMap, blank;
  var base = 0, scrollX = 0, dragOff = 0, dist = 0, distT = 0, dir = 1, open = -1, busy = false, hovered = -1, dragging = false, px = 0, moved = 0, lastDx = 0, vel = 0;
  var ray, mouse, P = { v: 0 };
  var COVER = [
    'vec2 cover(vec2 c, vec2 ri, vec2 ro){ vec2 nw = vec2(ri.x * ro.y / ri.y, ro.y); vec2 off = vec2((nw.x - ro.x) / 2.0, 0.0);',
    '  if (ro.x / ro.y >= ri.x / ri.y) { nw = vec2(ro.x, ri.y * ro.x / ri.x); off = vec2(0.0, (nw.y - ro.y) / 2.0); }',
    '  off = off / nw; return c * ro / nw + off; }'].join('\\n');
  var SLIDE_V = 'varying vec2 vUv; uniform float uDist; void main(){ vUv = uv; vec3 p = position; float d = distance(vUv, vec2(0.5)) / 0.5; p.z -= d * uDist; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }';
  var SLIDE_F = ['varying vec2 vUv; uniform sampler2D uTex; uniform vec2 uResIn; uniform vec2 uResOut; uniform float uPar;', COVER,
    'void main(){ vec2 c = vUv - 0.5; c *= vec2(1.0 - 0.3); c += vec2(uPar * 0.15, 0.0); c += 0.5; gl_FragColor = vec4(texture2D(uTex, cover(c, uResIn, uResOut)).rgb, 1.0); }'].join('\\n');
  var POST_V = 'varying vec2 vUv; uniform float uDist; void main(){ vUv = uv; vec3 p = position; float d = 1.0 - distance(vUv, vec2(0.5)) / 0.5; p.z = 1.0 + d * uDist; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }';
  var PASS_F = 'varying vec2 vUv; uniform sampler2D uScene; void main(){ gl_FragColor = texture2D(uScene, vUv); }';
  var PASS_V = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var TEXT_V = 'varying vec2 vUv; varying vec2 vS; void main(){ vec4 v = projectionMatrix * modelViewMatrix * vec4(position, 1.0); vS = v.xy / v.w * 0.5 + 0.5; vUv = uv; gl_Position = v; }';
  var TEXT_F = 'varying vec2 vUv; varying vec2 vS; uniform float uInv; uniform sampler2D uTex; uniform sampler2D uMask; uniform vec3 uColor; void main(){ vec4 t = texture2D(uTex, vUv); float m = texture2D(uMask, vS).a; vec3 c = mix(uColor, 1.0 - uColor, uInv * m); gl_FragColor = vec4(c, t.a); }';
  function rgb(h){ var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(h).trim()); if (!m) { var c = new THREE.Color(h); return new THREE.Vector3(c.r, c.g, c.b); } var x = m[1]; if (x.length === 3) x = x[0] + x[0] + x[1] + x[1] + x[2] + x[2]; var v = parseInt(x, 16); return new THREE.Vector3(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255); }
  function ringTexture(){
    var phrase = (el.getAttribute('data-ring') || '').toUpperCase() || 'STUDIO';
    var cv = document.createElement('canvas'), W = 2048, H = 320; cv.width = W; cv.height = H;
    var g = cv.getContext('2d'); g.clearRect(0, 0, W, H);
    var font = getComputedStyle(el.querySelector('.sb7__title')).fontFamily || 'sans-serif';
    g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.font = '${pair.weight} 230px ' + font;
    var unit = phrase + '   ·   ', uw = g.measureText(unit).width, reps = Math.max(1, Math.round(W / uw)), scale = W / (uw * reps);
    g.save(); g.scale(scale, 1);
    for (var i = 0; i < reps; i++) g.fillText(unit, i * uw, H / 2 + 8);
    g.restore();
    var tx = new THREE.CanvasTexture(cv); tx.wrapS = THREE.RepeatWrapping; tx.anisotropy = 8; return tx;
  }
  function build(){
    built = true;
    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000); camera.position.z = 100;
    ray = new THREE.Raycaster(); mouse = new THREE.Vector2(-2, -2);
    sceneSlides = new THREE.Scene(); sceneBlur = new THREE.Scene(); sceneMain = new THREE.Scene();
    rt1 = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false, stencilBuffer: false }); rt2 = rt1.clone();
    blank = new THREE.DataTexture(new Uint8Array([160, 160, 160, 255]), 1, 1); blank.needsUpdate = true;
    measure();
    // slides
    var loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous'); var loaded = 0;
    for (var i = 0; i < n; i++) (function(i){
      var sz = SIZES[i % SIZES.length];
      var mat = new THREE.ShaderMaterial({ vertexShader: SLIDE_V, fragmentShader: SLIDE_F, depthTest: false, uniforms: { uDist: { value: 0 }, uTex: { value: blank }, uResIn: { value: new THREE.Vector2(1, 1) }, uResOut: { value: new THREE.Vector2(1, 1) }, uPar: { value: 0 } } });
      var mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 25, 25), mat); mesh.userData.i = i;
      var s = { mesh: mesh, mat: mat, w: sz[0], h: sz[1], y: sz[2], W: 0, H: 0 };
      slides.push(s); sceneSlides.add(mesh);
      var im = imgs[i]; if (!im) return;
      loader.load(im.currentSrc || im.src, function(tx){ tx.minFilter = THREE.LinearFilter; tx.magFilter = THREE.LinearFilter; tx.generateMipmaps = false; mat.uniforms.uTex.value = tx; mat.uniforms.uResIn.value.set(tx.image.width || 1, tx.image.height || 1); loaded++; if (!live && loaded >= Math.min(3, n)) { live = true; el.classList.add('is-live'); } });
    })(i);
    // post pass (bulge) and output plane
    postMat = new THREE.ShaderMaterial({ vertexShader: POST_V, fragmentShader: PASS_F, transparent: true, depthTest: false, uniforms: { uScene: { value: rt1.texture }, uDist: { value: 0 } } });
    var postMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 160, 160), postMat); postMesh.frustumCulled = false; sceneBlur.add(postMesh);
    outMat = new THREE.ShaderMaterial({ vertexShader: PASS_V, fragmentShader: PASS_F, transparent: true, depthTest: false, depthWrite: false, uniforms: { uScene: { value: rt2.texture } } });
    outMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1), outMat); outMesh.frustumCulled = false; outMesh.renderOrder = 1;
    // text ring
    texMap = ringTexture();
    var ink = rgb('${t.ink}'), grey = rgb('${t.ink3}');
    var geo = new THREE.CylinderGeometry(1, 1, 1, 64, 1, true);
    ringFront = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: TEXT_V, fragmentShader: TEXT_F, side: THREE.FrontSide, transparent: true, depthTest: false, depthWrite: false, uniforms: { uTex: { value: texMap }, uColor: { value: ink }, uInv: { value: 1 }, uMask: { value: rt2.texture } } }));
    ringBack = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: TEXT_V, fragmentShader: TEXT_F, side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false, uniforms: { uTex: { value: texMap }, uColor: { value: grey }, uInv: { value: 0 }, uMask: { value: blank } } }));
    ringFront.position.z = 0.1; ringFront.renderOrder = 2; ringBack.renderOrder = 0;
    ringFront.rotation.y = ringBack.rotation.y = -Math.PI / 2;
    ringGroup = new THREE.Group(); ringGroup.add(ringBack); ringGroup.add(ringFront); ringGroup.rotation.set(-0.43, 0, 0.35);
    sceneMain.add(ringGroup); sceneMain.add(outMesh);
    size();
    window.addEventListener('resize', size);
    window.addEventListener('pagehide', function(){ stop(); slides.forEach(function(s){ var tx = s.mat.uniforms.uTex.value; if (tx && tx !== blank) tx.dispose(); s.mat.dispose(); s.mesh.geometry.dispose(); }); texMap.dispose(); rt1.dispose(); rt2.dispose(); renderer.dispose(); }, { once: true });
  }
  function measure(){
    var w = stage.clientWidth || 1, h = stage.clientHeight || 1;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    VH = 2 * Math.tan(camera.fov * Math.PI / 360) * camera.position.z; VW = VH * camera.aspect; ratio = Math.min(VW, VH);
  }
  function size(){
    var w = stage.clientWidth || 1, h = stage.clientHeight || 1, dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setSize(w, h, false); rt1.setSize(Math.round(w * dpr), Math.round(h * dpr)); rt2.setSize(Math.round(w * dpr), Math.round(h * dpr));
    measure();
    // lay the strip out again at this size (keeps the relative order, re-centres)
    var x = 0; stripW = 0;
    slides.forEach(function(s, i){ s.W = s.w * ratio; s.H = s.h * ratio; s.mesh.geometry.dispose(); s.mesh.geometry = new THREE.PlaneGeometry(s.W, s.H, 25, 25); s.mesh.scale.set(1, 1, 1); s.mat.uniforms.uResOut.value.set(s.W, s.H); s.mesh.position.set(x, s.y * ratio, 0); if (i < n - 1) x += s.W / 2 + slides[i + 1].w * ratio / 2 + SPACING * ratio; stripW += s.W + SPACING * ratio; });
    base = 0; dragOff = 0; scrollX = st ? st.progress * stripW : 0;
    sceneBlur.children[0].scale.set(VW, VH, 1); outMesh.scale.set(VW, VH, 1);
    var R = 0.25 * ratio, HH = 0.3 * ratio;
    ringFront.scale.set(R, HH, R); ringBack.scale.set(R, HH, R); ringGroup.position.set(0, -0.05 * ratio, 0);
    respawn(1); respawn(-1);
  }
  function respawn(d){
    slides.forEach(function(s){ var m = s.mesh; if (m.position.x + s.W / 2 < -VW / 2) { if (d === -1) m.position.x += stripW; } else if (m.position.x - s.W / 2 > VW / 2) { if (d === 1) m.position.x -= stripW; } });
  }
  function nearest(){ var best = 0, bd = 1e9; slides.forEach(function(s, i){ var d = Math.abs(s.mesh.position.x); if (d < bd) { bd = d; best = i; } }); return best; }
  function tick(){
    if (open < 0) {
      var want = scrollX + dragOff, delta = (want - base) * 0.1;
      if (Math.abs(delta) < 0.001) delta = 0;
      base += delta; dir = delta > 0 ? 1 : delta < 0 ? -1 : dir;
      slides.forEach(function(s){ s.mesh.position.x += delta; s.mat.uniforms.uPar.value = s.mesh.position.x / (VW / 2); });
      respawn(dir);
      distT += (delta * 6 - distT) * 0.2;
    } else distT *= 0.8;
    dist += (distT - dist) * 0.1; distT *= 0.92;
    postMat.uniforms.uDist.value = Math.max(-100, Math.min(50, dist));
    ringFront.rotation.y = ringBack.rotation.y += 0.008;
    slides.forEach(function(s, i){ var k = (hovered === i && open < 0 && !dragging) ? 1.04 : 1; if (open !== i) { s.mesh.scale.x += (k - s.mesh.scale.x) * 0.15; s.mesh.scale.y += (k - s.mesh.scale.y) * 0.15; s.mat.uniforms.uResOut.value.set(s.W * s.mesh.scale.x, s.H * s.mesh.scale.y); } });
    if (open < 0) mark(nearest());
    renderer.setRenderTarget(rt1); renderer.render(sceneSlides, camera);
    renderer.setRenderTarget(rt2); renderer.render(sceneBlur, camera);
    renderer.setRenderTarget(null); renderer.render(sceneMain, camera);
  }
  function start(){ if (!running) { running = true; gsap.ticker.add(tick); } }
  function stop(){ if (running) { running = false; gsap.ticker.remove(tick); } }
  function glide(delta){ P.v = 0; var last = 0; gsap.to(P, { v: delta, duration: 1, ease: 'power3.out', overwrite: true, onUpdate: function(){ dragOff += P.v - last; last = P.v; } }); }
  function goTo(i){
    if (open >= 0) return; i = ((i % n) + n) % n;
    var x = slides[i].mesh.position.x; if (x > stripW / 2) x -= stripW; if (x < -stripW / 2) x += stripW;
    glide(-x);
  }
  function step(d){ if (open >= 0) return; var j = nearest(), k = ((j + d) % n + n) % n, sj = slides[j], sk = slides[k]; var x = sj.mesh.position.x + d * (sj.W / 2 + sk.W / 2 + SPACING * ratio); glide(-x); }
  function expand(i){
    if (busy || open >= 0) return; busy = true; open = i; stage.classList.add('is-open');
    var s = slides[i], m = s.mesh, u = s.mat.uniforms, x0 = m.position.x;
    m.renderOrder = 1;
    slides.forEach(function(o){ gsap.to(o.mesh.position, { x: '-=' + x0, duration: 1, ease: 'power2.out', onUpdate: function(){ o.mat.uniforms.uPar.value = o.mesh.position.x / (VW / 2); } }); });
    base -= x0; dragOff -= x0; scrollX = st ? st.progress * stripW : scrollX;
    var tl = gsap.timeline({ onComplete: function(){ busy = false; } });
    tl.to(u.uDist, { value: 50, duration: 0.5, ease: 'power2.out' }, 0)
      .to(m.scale, { x: VW / s.W, y: VH / s.H, duration: 0.5, ease: 'power2.in', onUpdate: function(){ u.uResOut.value.set(s.W * m.scale.x, s.H * m.scale.y); } }, 0)
      .to(m.position, { y: 0, duration: 0.5 }, 0)
      .to(u.uDist, { value: 0, duration: 0.5, ease: 'back.out(3)' });
  }
  function collapse(){
    if (busy || open < 0) return; busy = true; var i = open, s = slides[i], m = s.mesh, u = s.mat.uniforms; stage.classList.remove('is-open');
    var tl = gsap.timeline({ onComplete: function(){ m.renderOrder = 0; open = -1; busy = false; var want = scrollX + dragOff; dragOff -= (want - base); } });
    tl.to(u.uDist, { value: -50, duration: 0.5, ease: 'power2.out' }, 0)
      .to(m.scale, { x: 1, y: 1, duration: 0.5, ease: 'power2.in', onUpdate: function(){ u.uResOut.value.set(s.W * m.scale.x, s.H * m.scale.y); } }, 0)
      .to(m.position, { y: s.y * ratio, duration: 0.5, ease: 'power2.in' }, 0)
      .to(u.uDist, { value: 0, duration: 0.25, ease: 'back.out(3)' });
  }
  function pick(e){
    var r = stage.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    var hit = ray.intersectObjects(slides.map(function(s){ return s.mesh; }), false)[0];
    return hit ? hit.object.userData.i : -1;
  }
  st = ScrollTrigger.create({ trigger: el, start: 'top top', end: 'bottom bottom',
    onUpdate: function(self){ if (built && open < 0) scrollX = self.progress * stripW; },
    onRefresh: function(self){ if (built) { scrollX = self.progress * stripW; base = scrollX + dragOff; } } });
  stage.addEventListener('pointermove', function(e){ if (!built) return; if (dragging) { var dx = e.clientX - px; px = e.clientX; moved += Math.abs(dx); if (open < 0) { var d = dx * (VW / stage.clientWidth); dragOff += d; lastDx = d; } return; } hovered = pick(e); stage.classList.toggle('is-hover', hovered >= 0 && open < 0); });
  stage.addEventListener('pointerleave', function(){ hovered = -1; stage.classList.remove('is-hover'); });
  stage.addEventListener('pointerdown', function(e){ if (e.button || !built) return; dragging = true; moved = 0; px = e.clientX; lastDx = 0; stage.classList.add('is-drag'); stage.setPointerCapture(e.pointerId); gsap.killTweensOf(P); });
  function endDrag(e){
    if (!dragging) return; dragging = false; stage.classList.remove('is-drag');
    if (moved < 5) { if (open >= 0) collapse(); else { var i = pick(e); if (i >= 0) expand(i); } }
    else if (open < 0) glide(Math.max(-VW, Math.min(VW, lastDx * 14)));
  }
  stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', function(){ dragging = false; stage.classList.remove('is-drag'); });
  el.querySelector('.sb7__btn--next').addEventListener('click', function(){ if (open >= 0) collapse(); else step(1); });
  el.querySelector('.sb7__btn--prev').addEventListener('click', function(){ if (open >= 0) collapse(); else step(-1); });
  dots.forEach(function(d, i){ d.addEventListener('click', function(){ if (open >= 0) collapse(); else goTo(i); }); });
  new IntersectionObserver(function(es){ inView = es[0].isIntersecting; if (inView) { if (!built) build(); start(); } else stop(); }, { rootMargin: '20% 0px' }).observe(el);
  document.addEventListener('keydown', function(e){
    if (!inView || e.altKey || e.ctrlKey || e.metaKey) return;
    var tg = e.target; if (tg && (/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || tg.isContentEditable)) return;
    if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'Escape' && open >= 0) collapse();
  });
})();`,
};
export default c;
