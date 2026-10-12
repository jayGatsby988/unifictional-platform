// @ts-nocheck
// scroll-60 · Two-colour scroll page: liquid mark, pie wipe, converging list
// (Awwwards Pack, recreated from the preview video). One long "brand moment"
// in the accent colour and its contrast colour: the brand mark liquefies under
// the pointer (WebGL plane with a pointer-trail displacement), a contrast panel
// rises with a tilted edge, a dotted disc fills clockwise then swells until the
// screen flips colour and a headline appears word by word, and a mono list
// converges onto a central spine as it rises.
import type { Component } from "./_types";

function rgb(hex, fb) {
  let h = String(hex || "").replace("#", "");
  if (h.length === 3) h = h.split("").map(ch => ch + ch).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return fb;
  return [0, 2, 4].map(i => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(",");
}

const c: Component = {
  id: "scroll-60",
  type: "brand-moment",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "(recreated from the preview video) brand-moment (scroll-60): one long two-colour passage in the accent colour and its contrast colour, in four beats. First a full screen of accent with the brand mark huge in the middle; moving the pointer across it smears the mark like wet ink and it springs back. Then a contrast-coloured panel rises with a slightly tilted top edge and the text (1-3 short paragraphs) unmasks line by line in accent type. Then the screen pins on a disc of accent dots that a solid wedge fills clockwise as you scroll; the disc swells until the whole screen is accent again and the headline (4-10 words) appears word by word. Finally a two-column mono list (brand facts, pages, places, by default) rises with its lowest rows splayed outward and faint, converging onto a central spine. Needs headline and text; optional lines (short strings, paired per row). A studio, lab or agency statement page; on phones it is the same four blocks laid out statically.",
  fields: `{"type":"brand-moment","component":"scroll-60","eyebrow":"","headline":"","text":"","lines":[]}`,
  css: ({ pair, capsRule }) => `
.bm{--A:var(--accent);--B:var(--on-accent);position:relative;color:var(--B)}
.bm__hero{position:relative;height:100svh;background:var(--A);display:flex;align-items:center;justify-content:center;overflow:hidden}
.bm__mark{position:relative;z-index:1;display:flex;align-items:center;justify-content:center}
.bm__mark .nav__brand{font-size:clamp(2.5rem,7.5vw,11rem);max-width:90vw;gap:.25em;color:var(--B);letter-spacing:${pair.track};text-align:center;justify-content:center;flex-wrap:wrap;padding:0 var(--gutter);${capsRule}}
.bm__mark .nav__brand i{width:.32em;height:.32em;background:var(--B)}
.bm__mark .nav__brand img,.bm__mark .nav__brand svg{height:clamp(6rem,26vh,16rem);max-width:70vw}
.bm__mark.is-gl{visibility:hidden}
.bm__gl{position:absolute;inset:0;z-index:2;pointer-events:none}
.bm__gl canvas{display:block;width:100%;height:100%}
.bm__corner{position:absolute;z-index:3;bottom:2rem;color:var(--B);opacity:.85}
.bm__corner--l{left:var(--gutter)}.bm__corner--r{right:var(--gutter);text-align:right}
.bm__panel{position:relative;z-index:2;margin-top:-10svh;background:var(--B);color:var(--A);padding:clamp(8rem,22vh,14rem) var(--gutter) clamp(6rem,16vh,10rem)}
.bm__text{max-width:52ch;font-size:clamp(1.15rem,1.7vw,1.5rem);line-height:1.35;display:grid;gap:1.2em}
.bm__pie-track{position:relative;height:320svh;background:var(--B)}
.bm__pie-stage{position:sticky;top:0;height:100svh;overflow:hidden;background:var(--B);display:flex;align-items:center;justify-content:center}
.bm__disc{--p:0;position:absolute;width:min(34vw,420px);aspect-ratio:1;border-radius:50%;will-change:transform}
.bm__disc i{position:absolute;inset:0;border-radius:50%;display:block}
.bm__dots{background:radial-gradient(circle,var(--A) 1px,transparent 1.6px) 0 0/8px 8px;opacity:.6}
.bm__wedge{background:conic-gradient(var(--A) calc(var(--p) * 1turn),transparent 0)}
.bm__headline{position:relative;z-index:2;text-align:center;max-width:22ch;padding:0 var(--gutter);font-size:clamp(1.6rem,3.4vw,3.4rem);color:var(--B)}
.bm__headline .w{display:inline-block}
.bm__list{position:relative;background:var(--A);color:var(--B);padding:clamp(6rem,16vh,10rem) var(--gutter)}
.bm__list-head{text-align:center;margin-bottom:3rem;color:var(--B);opacity:.8}
.bm__rows{display:grid;gap:.45rem;max-width:60rem;margin:0 auto}
.bm__row{display:grid;grid-template-columns:1fr 1fr;gap:2rem;font-family:var(--mono);font-size:.74rem;letter-spacing:.12em;text-transform:uppercase}
.bm__row span:first-child{text-align:right}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .bm__hero{height:70svh}
  .bm__mark .nav__brand{font-size:clamp(2.2rem,10vw,4rem)}
  .bm__mark .nav__brand i{display:none}
  .bm__corner--r{display:none}
  .bm__gl{display:none}
  .bm__mark.is-gl{visibility:visible}
  .bm__panel{margin-top:0;padding:4rem var(--gutter);clip-path:none!important}
  .bm__pie-track{height:auto}
  .bm__pie-stage{position:static;height:auto;flex-direction:column;gap:2.5rem;padding:4rem var(--gutter)}
  .bm__disc{--p:1;position:relative;width:min(60vw,320px);transform:none!important}
  .bm__headline{color:var(--A);padding:0}
  .bm__headline .w{opacity:1!important;transform:none!important}
  .bm__row{font-size:.66rem;gap:1rem;transform:none!important;opacity:1!important}
  .bm__row span{transform:none!important;opacity:1!important}
}`,
  html: (s, ctx) => {
    const { esc, spec, brandMark } = ctx;
    const b = spec.brand || {};
    const paras = String(s.text || "").split(/\n\s*\n|\n/).map(x => x.trim()).filter(Boolean).slice(0, 3);
    const words = String(s.headline || "").trim().split(/\s+/).filter(Boolean).slice(0, 16);
    let lines = Array.isArray(s.lines) ? s.lines.map(x => String(x || "").trim()).filter(Boolean) : [];
    if (lines.length < 6) {
      const auto = [b.name, b.tagline, b.city, b.serviceArea, b.phone, b.email, b.industry, ...((spec.nav && spec.nav.links) || []).map(l => l.label), ...(((spec.footer && spec.footer.columns) || []).flatMap(col => (col.links || []).map(l => l.label)))].map(x => String(x || "").trim()).filter(Boolean);
      lines = lines.concat(auto.filter(x => !lines.includes(x)));
    }
    lines = lines.slice(0, 24);
    const rows = [];
    for (let i = 0; i < lines.length; i += 2) rows.push([lines[i], lines[i + 1] || ""]);
    return `
<section class="bm" data-fx="brand-moment">
  <div class="bm__hero">
    <div class="bm__mark">${brandMark()}</div>
    <div class="bm__gl"><canvas aria-hidden="true"></canvas></div>
    ${s.eyebrow ? `<div class="bm__corner bm__corner--l mono">${esc(s.eyebrow)}</div>` : ""}
    ${b.city ? `<div class="bm__corner bm__corner--r mono">${esc(b.city)}</div>` : ""}
  </div>
  <div class="bm__panel"><div class="bm__text">${paras.map(p => `<p>${esc(p)}</p>`).join("")}</div></div>
  <div class="bm__pie-track"><div class="bm__pie-stage">
    <div class="bm__disc" aria-hidden="true"><i class="bm__dots"></i><i class="bm__wedge"></i></div>
    <h2 class="bm__headline display">${words.map(w => `<span class="w">${esc(w)}</span>`).join(" ")}</h2>
  </div></div>
  <div class="bm__list">
    <div class="bm__list-head mono">${esc(b.name || "")}</div>
    <div class="bm__rows">${rows.map(r => `<div class="bm__row"><span>${esc(r[0])}</span><span>${esc(r[1])}</span></div>`).join("")}</div>
  </div>
</section>`;
  },
  js: ({ t }) => `
import * as THREE from "three";
(function(){
  var sec = document.querySelector('[data-fx="brand-moment"]');
  if (!sec || !window.__fx.FX) return;
  var hero = sec.querySelector('.bm__hero'), mark = sec.querySelector('.bm__mark'), canvas = sec.querySelector('.bm__gl canvas');
  var panel = sec.querySelector('.bm__panel'), text = sec.querySelector('.bm__text'), pieTrack = sec.querySelector('.bm__pie-track'), disc = sec.querySelector('.bm__disc');
  var words = sec.querySelectorAll('.bm__headline .w'), rows = sec.querySelectorAll('.bm__row');
  // 2. contrast panel rises with a tilted edge; text unmasks line by line
  if (panel) {
    gsap.fromTo(panel, { clipPath: 'polygon(0% 100%, 100% 88%, 100% 100%, 0% 100%)' }, { clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)', ease: 'none', scrollTrigger: { trigger: panel, start: 'top bottom', end: 'top 25%', scrub: 0.5 } });
  }
  if (text) {
    var targets = null;
    if (window.SplitText) { try { targets = SplitText.create(text.querySelectorAll('p'), { type: 'lines', mask: 'lines' }).lines; } catch (e) { targets = null; } }
    if (targets && targets.length) gsap.fromTo(targets, { yPercent: 110 }, { yPercent: 0, ease: 'power3.out', duration: 1, stagger: 0.08, scrollTrigger: { trigger: text, start: 'top 80%', toggleActions: 'play none none reverse' } });
    else gsap.fromTo(text, { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 1, scrollTrigger: { trigger: text, start: 'top 80%', toggleActions: 'play none none reverse' } });
  }
  // 3. pie wipe: fill, swell to cover, then the headline word by word
  if (pieTrack && disc) {
    var cover = function(){ var d = disc.getBoundingClientRect().width || 1; return Math.hypot(window.innerWidth, window.innerHeight) / d + 0.15; };
    gsap.set(words, { opacity: 0, y: 24 });
    var tl = gsap.timeline({ scrollTrigger: { trigger: pieTrack, start: 'top top', end: 'bottom bottom', scrub: 0.6, invalidateOnRefresh: true } });
    tl.fromTo(disc, { '--p': 0 }, { '--p': 1, ease: 'none', duration: 0.42 }, 0)
      .to(disc, { scale: function(){ return cover(); }, ease: 'power2.in', duration: 0.26 }, 0.44)
      .to(words, { opacity: 1, y: 0, ease: 'power2.out', duration: 0.18, stagger: 0.1 / Math.max(1, words.length) * 2 }, 0.7);
  }
  // 4. converging list: rows splay outward low on the screen and meet the spine as they rise
  rows.forEach(function(row, i){
    var cells = row.querySelectorAll('span'), spread = Math.min(window.innerWidth * 0.18, 260) * (0.6 + (i % 5) * 0.12);
    gsap.fromTo(cells[0], { x: -spread, opacity: 0.2 }, { x: 0, opacity: 1, ease: 'none', scrollTrigger: { trigger: row, start: 'top 98%', end: 'top 58%', scrub: true } });
    if (cells[1]) gsap.fromTo(cells[1], { x: spread, opacity: 0.2 }, { x: 0, opacity: 1, ease: 'none', scrollTrigger: { trigger: row, start: 'top 98%', end: 'top 58%', scrub: true } });
  });
  // 1. liquid mark (WebGL)
  var gl2 = null; try { gl2 = document.createElement('canvas').getContext('webgl2'); } catch (e) {}
  if (!gl2 || !hero || !mark || !canvas) return;
  var N = 12;
  var FRAG = 'uniform sampler2D uMap; uniform vec3 uColor; uniform vec4 uTrail[' + N + ']; uniform float uAspect; uniform float uTime; varying vec2 vUv;'
    + 'void main(){ vec2 uv = vUv; vec2 disp = vec2(0.0);'
    + 'for (int i = 0; i < ' + N + '; i++) { vec4 tr = uTrail[i]; vec2 d = uv - tr.xy; d.x *= uAspect; disp += tr.zw * exp(-dot(d, d) * 70.0); }'
    + 'uv -= disp; uv.x += sin(uv.y * 9.0 + uTime) * 0.003; uv.y += sin(uv.x * 7.0 + uTime * 0.8) * 0.003;'
    + 'float a = texture2D(uMap, uv).a; gl_FragColor = vec4(uColor * a, a); }';
  var VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var renderer, scene, cam, mesh, mat, u, trail = [], ti = 0, started = false, active = false, raf = 0, W = 0, H = 0, ready = false, box = null, t0 = 0, last = null, PAD = 0.3;
  function texture(cb){
    var r = mark.getBoundingClientRect(), hr = hero.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var padX = Math.ceil(r.width * PAD), padY = Math.ceil(r.height * PAD);
    var w = Math.ceil(r.width + padX * 2), h = Math.ceil(r.height + padY * 2);
    var cv = document.createElement('canvas'); cv.width = Math.ceil(w * dpr); cv.height = Math.ceil(h * dpr);
    var g = cv.getContext('2d'); g.scale(dpr, dpr);
    var done = function(){ var tex = new THREE.CanvasTexture(cv); tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; cb({ tex: tex, w: w, h: h, x: r.left - hr.left + r.width / 2, y: r.top - hr.top + r.height / 2 }); };
    var drawText = function(){
      var a = mark.querySelector('.nav__brand') || mark, cs = getComputedStyle(a);
      g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.textAlign = 'center';
      g.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      if ('letterSpacing' in g) g.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
      var txt = (a.textContent || '').trim(); if (cs.textTransform === 'uppercase') txt = txt.toUpperCase();
      g.fillText(txt, w / 2, h / 2); done();
    };
    var svg = mark.querySelector('svg'), img = mark.querySelector('img');
    var src = svg ? mark.querySelector('svg') : img;
    if (src) {
      var sr = src.getBoundingClientRect(), im = new Image();
      im.onload = function(){ g.drawImage(im, sr.left - r.left + padX, sr.top - r.top + padY, sr.width, sr.height); done(); };
      im.onerror = drawText;
      if (svg) { var cl = svg.cloneNode(true); cl.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); cl.setAttribute('width', String(sr.width)); cl.setAttribute('height', String(sr.height)); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(cl)); }
      else { im.crossOrigin = 'anonymous'; im.src = img.currentSrc || img.src; }
    } else drawText();
  }
  function size(){ W = hero.clientWidth; H = hero.clientHeight; renderer.setSize(W, H, true); cam.left = -W / 2; cam.right = W / 2; cam.top = H / 2; cam.bottom = -H / 2; cam.updateProjectionMatrix(); }
  function place(){ if (!box) return; mesh.position.set(box.x - W / 2, H / 2 - box.y, 0); mesh.scale.set(box.w, box.h, 1); u.uAspect.value = box.w / box.h; }
  function build(){
    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, premultipliedAlpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    scene = new THREE.Scene();
    cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    for (var i = 0; i < N; i++) trail.push(new THREE.Vector4(-10, -10, 0, 0));
    u = { uMap: { value: null }, uColor: { value: new THREE.Vector3(${rgb(t.onAccent, "1,1,1")}) }, uTrail: { value: trail }, uAspect: { value: 1 }, uTime: { value: 0 } };
    mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, transparent: true, premultipliedAlpha: true, depthTest: false });
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1), mat); mesh.visible = false; scene.add(mesh);
    size();
    document.fonts.ready.then(function(){ texture(function(b){ box = b; u.uMap.value = b.tex; place(); mesh.visible = true; ready = true; mark.classList.add('is-gl'); }); });
    hero.addEventListener('pointermove', function(e){
      if (!ready) return;
      var hr = hero.getBoundingClientRect();
      var x = e.clientX - hr.left, y = e.clientY - hr.top;
      var ux = (x - (box.x - box.w / 2)) / box.w, uy = 1 - (y - (box.y - box.h / 2)) / box.h;
      if (last) {
        var dx = (x - last.x) / box.w, dy = -(y - last.y) / box.h, m = Math.hypot(dx, dy);
        if (m > 0.002) { var k = Math.min(0.12, m * 1.6) / m; var v = trail[ti % N]; v.set(ux, uy, dx * k, dy * k); ti++; }
      }
      last = { x: x, y: y };
    });
    hero.addEventListener('pointerleave', function(){ last = null; });
    var rt = 0;
    window.addEventListener('resize', function(){ size(); clearTimeout(rt); rt = setTimeout(function(){ if (!ready) return; mark.classList.remove('is-gl'); texture(function(b){ var old = box.tex; box = b; u.uMap.value = b.tex; place(); old.dispose(); mark.classList.add('is-gl'); }); }, 200); });
    window.addEventListener('pagehide', dispose, { once: true });
  }
  function frame(now){
    if (!active) return;
    raf = requestAnimationFrame(frame);
    var dt = t0 ? Math.min(0.1, (now - t0) / 1000) : 0; t0 = now;
    if (!ready) return;
    var decay = Math.pow(0.08, dt);
    for (var i = 0; i < N; i++) { trail[i].z *= decay; trail[i].w *= decay; }
    u.uTime.value += dt * 2;
    renderer.render(scene, cam);
  }
  function dispose(){ active = false; cancelAnimationFrame(raf); if (mat) mat.dispose(); if (box) box.tex.dispose(); if (renderer) renderer.dispose(); }
  var io = new IntersectionObserver(function(es){
    es.forEach(function(en){
      if (en.isIntersecting) { if (!started) { started = true; build(); } active = true; t0 = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); }
      else { active = false; cancelAnimationFrame(raf); }
    });
  }, { rootMargin: '20% 0px' });
  io.observe(hero);
})();`,
};
export default c;
