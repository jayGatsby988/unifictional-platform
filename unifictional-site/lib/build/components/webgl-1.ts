// @ts-nocheck
// webgl-1 · Hero word that erodes through noise as you scroll while petals and dust blow away leftwards (Awwwards Pack).
import type { Component } from "./_types";

const rgb = (col: string): number[] => {
  const m = String(col || "").match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) { let h = m[1]; if (h.length === 3) h = h.split("").map(x => x + x).join(""); const n = parseInt(h, 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
  const r = String(col || "").match(/rgba?\(([^)]+)\)/); if (r) { const p = r[1].split(",").map(Number); return [p[0] / 255, p[1] / 255, p[2] / 255]; }
  return [0.5, 0.5, 0.5];
};
const vec = (col: string) => rgb(col).map(v => v.toFixed(4)).join(",");

const c: Component = {
  id: "webgl-1",
  type: "hero-dissolve-1",
  kind: "hero",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "hero-dissolve-1 (webgl-1): a full-screen hero on the page colour with one huge centred WORD (the brand name by default, 3-14 letters, one line), an eyebrow above it and the sub (one sentence) and button below. As you start scrolling the letters grey out and are eaten away in noise-shaped patches, while hundreds of small petals in the accent colour (every third one white) and specks of dust lift off the word, tumble, rise and drift away to the left, fading after a few seconds; the sub and button fade with it and the next section arrives. Scrolling back restores the word. No images. A theatrical opening for fashion, beauty, florists, restaurants, galleries, events and studios; phones and reduced motion get the plain word, sub and button.",
  fields: `{"type":"hero-dissolve-1","component":"webgl-1","eyebrow":"","word":"","sub":"","cta":{"label":"","href":"contact"}}`,
  css: ({ pair, capsRule }) => `
.hd1{position:relative;height:190svh;background:var(--bg);overflow:clip}
.hd1__pin{position:sticky;top:0;height:100svh;overflow:hidden;display:grid;place-items:center}
.hd1__pin canvas{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}
.hd1__inner{position:relative;z-index:1;display:grid;justify-items:center;text-align:center;gap:1.4rem;padding:0 var(--gutter);max-width:100%}
.hd1__eyebrow{font-family:var(--mono);font-size:.68rem;letter-spacing:.18em;text-transform:uppercase;color:var(--ink2)}
.hd1__word{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};line-height:1;text-transform:uppercase;white-space:nowrap;font-size:min(15rem,calc(86vw / (var(--n) * 0.6)));color:var(--ink);margin:.1em 0}
.hd1.is-gl .hd1__word{color:transparent}
.hd1__sub{max-width:44ch;color:var(--ink2);font-size:clamp(1rem,1.3vw,1.2rem);line-height:1.6}
.hd1__fade{transition:none}
.hd1__scroll{position:absolute;right:var(--gutter);bottom:2rem;z-index:2;font-family:var(--mono);font-size:.65rem;letter-spacing:.2em;text-transform:uppercase;color:var(--ink2);display:flex;align-items:center;gap:.8rem}
.hd1__scroll i{width:1px;height:48px;background:currentColor;opacity:.5;display:block}
.hd1.is-static .hd1__pin canvas,.hd1.is-static .hd1__scroll{display:none}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .hd1{height:auto}
  .hd1__pin{position:relative;height:auto;min-height:100svh;padding:7rem 0 4rem}
  .hd1__pin canvas,.hd1__scroll{display:none}
  .hd1__word{font-size:min(6rem,calc(88vw / (var(--n) * 0.6)));color:var(--ink)!important}
  .hd1__fade{opacity:1!important}
}`,
  html: (s, { spec, esc, link, arrow }) => {
    const word = (String(s.word || spec.brand?.name || "Studio").trim().split(/\s+/)[0] || "Studio").replace(/[^A-Za-z0-9&'\-]/g, "").slice(0, 14) || "Studio";
    return `
<section class="hd1" id="top" data-fx="hero-dissolve-1" style="--n:${Math.max(3, word.length)}">
  <div class="hd1__pin">
    <canvas aria-hidden="true"></canvas>
    <div class="hd1__inner">
      ${s.eyebrow ? `<span class="hd1__eyebrow hd1__fade">${esc(s.eyebrow)}</span>` : ""}
      <h1 class="hd1__word">${esc(word)}</h1>
      ${s.sub ? `<p class="hd1__sub hd1__fade">${esc(s.sub)}</p>` : ""}
      ${s.cta && s.cta.label ? `<div class="hd1__fade"><a class="btn btn-primary" href="${esc(link(s.cta.href))}">${esc(s.cta.label)}${arrow}</a></div>` : ""}
    </div>
    <div class="hd1__scroll"><span>Scroll</span><i></i></div>
  </div>
</section>`;
  },
  js: ({ t }) => `
import * as THREE from "three";
(function(){
  var el = document.querySelector('[data-fx="hero-dissolve-1"]'); if (!el) return;
  var fx = window.__fx || {};
  function glOK(){ try { var c = document.createElement('canvas'); var g = c.getContext('webgl2'); if (!g) return false; var x = g.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); return true; } catch (e) { return false; } }
  if (!fx.FX || !glOK()) { el.classList.add('is-static'); return; }
  var pin = el.querySelector('.hd1__pin'), canvas = pin.querySelector('canvas'), word = el.querySelector('.hd1__word'), fades = el.querySelectorAll('.hd1__fade');
  var renderer, scene, camera, textMat, textGeo, textMesh, textTex, textCanvas, textCtx, textData = null, petalGeo, petalMat, petals, dustGeo, dustMat, dust;
  var raf = 0, started = false, visible = false, ro, st, W = 1, H = 1, P = 0, lastP = 0, time = 0, clock = new THREE.Clock(false);
  var MAXP = 420, MAXD = 120, pi = 0, di = 0, pSpawn, pBirth, pSeed, pScale, dSpawn, dBirth, dSeed;
  var wordRect = { x: 0, y: 0, w: 1, h: 1 };
  var TEXT_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var TEXT_FRAG = [
    'precision highp float; uniform sampler2D uText; uniform float uProgress; uniform vec2 uRes; uniform vec3 uInk; uniform vec3 uGrey; varying vec2 vUv;',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }',
    'float noise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }',
    'float fbm(vec2 p){ float v = 0.0; v += noise(p) * 0.5; v += noise(p * 2.1 + 3.7) * 0.25; v += noise(p * 4.3 + 9.1) * 0.125; v += noise(p * 8.9 + 1.3) * 0.0625; return v; }',
    'void main(){',
    '  vec4 tx = texture2D(uText, vUv);',
    '  vec2 p = vUv * vec2(uRes.x / uRes.y, 1.0) * 7.0;',
    '  float n = clamp((fbm(p) - 0.3) / 0.45, 0.0, 1.0);',
    '  float dissolve = step(uProgress, n);',
    '  float desat = smoothstep(0.0, 0.45, uProgress);',
    '  vec3 col = mix(uInk, uGrey, desat);',
    '  float a = tx.a * dissolve;',
    '  if (a < 0.02) discard;',
    '  gl_FragColor = vec4(col, a);',
    '}'
  ].join('\\n');
  var PETAL_VERT = [
    'attribute vec3 aSpawn; attribute float aBirth; attribute float aSeed; attribute float aScale;',
    'uniform float uTime; uniform float uLife; uniform float uUnit;',
    'varying float vFade; varying float vLight; varying float vKind;',
    'float hash(float n){ return fract(sin(n) * 43758.5453); }',
    'mat3 rotX(float a){ float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c); }',
    'mat3 rotY(float a){ float c = cos(a), s = sin(a); return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c); }',
    'mat3 rotZ(float a){ float c = cos(a), s = sin(a); return mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0); }',
    'void main(){',
    '  float age = uTime - aBirth; float life = clamp(age / uLife, 0.0, 1.0);',
    '  float alive = step(0.0, age) * (1.0 - step(1.0, life));',
    '  float tx = sin(age * 1.3 + aSeed * 17.0); float ty = cos(age * 0.9 + aSeed * 31.0);',
    '  vec3 wind = vec3(-1.0, 0.0, 0.0) * (70.0 + 50.0 * hash(aSeed * 9.0)) * age;',
    '  float rise = age * 26.0 * (0.4 + 0.6 * hash(aSeed * 7.0));',
    '  vec3 swirl = vec3(clamp(tx * life, 0.0, 1.0), ty * life, 0.0) * 50.0;',
    '  float bend = pow(uv.y, 3.0) * 2.5 * sin(age * (0.6 + hash(aSeed * 3.0)));',
    '  float spin = age * 0.9;',
    '  float bx = fract(aSeed * 1.13) * 6.2831, by = fract(aSeed * 2.17) * 6.2831, bz = fract(aSeed * 3.31) * 6.2831;',
    '  mat3 R = rotY(by + spin * 1.2 * (ty + 1.5)) * rotX(bx + spin * 0.9 * (tx + 1.5)) * rotZ(bz + spin * 0.7 * (tx + 1.5));',
    '  mat3 B = rotX(bend);',
    '  float grow = smoothstep(0.0, 0.05, life);',
    '  vFade = (1.0 - smoothstep(0.8, 1.0, life)) * alive;',
    '  vec3 local = R * (B * position) * (aScale * grow * uUnit);',
    '  vec3 n = normalize(R * (B * normal));',
    '  vec3 world = aSpawn + wind + vec3(0.0, rise, 0.0) + swirl + local;',
    '  vLight = clamp(abs(n.z), 0.45, 1.0);',
    '  vKind = step(0.66, hash(aSeed * 5.0));',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);',
    '}'
  ].join('\\n');
  var PETAL_FRAG = 'precision highp float; uniform vec3 uAccent; uniform vec3 uWhite; varying float vFade; varying float vLight; varying float vKind; void main(){ if (vFade < 0.01) discard; vec3 col = mix(uAccent, uWhite, vKind) * vLight; gl_FragColor = vec4(col, vFade); }';
  var DUST_VERT = [
    'attribute vec3 aSpawn; attribute float aBirth; attribute float aSeed;',
    'uniform float uTime; uniform float uLife; uniform float uPr; varying float vFade;',
    'float hash(float n){ return fract(sin(n) * 43758.5453); }',
    'void main(){',
    '  float age = uTime - aBirth; float life = clamp(age / uLife, 0.0, 1.0);',
    '  float alive = step(0.0, age) * (1.0 - step(1.0, life));',
    '  vec3 p = aSpawn + vec3(-1.0, 0.0, 0.0) * (40.0 + 60.0 * hash(aSeed * 3.0)) * age + vec3(sin(age * 2.0 + aSeed * 40.0) * 12.0, age * 18.0 + cos(age * 1.7 + aSeed * 20.0) * 10.0, 0.0);',
    '  vFade = smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.7, 1.0, life)) * alive;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
    '  gl_PointSize = (1.5 + 2.0 * hash(aSeed * 11.0)) * uPr;',
    '}'
  ].join('\\n');
  var DUST_FRAG = 'precision highp float; uniform vec3 uInk; varying float vFade; void main(){ if (vFade < 0.01) discard; float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(uInk, vFade * 0.55 * (1.0 - d * 2.0)); }';
  function petalGeometry(){
    var s = new THREE.Shape(); s.moveTo(0, 0); s.quadraticCurveTo(0.55, 0.35, 0, 1); s.quadraticCurveTo(-0.55, 0.35, 0, 0);
    var g = new THREE.ShapeGeometry(s, 6); g.translate(0, -0.5, 0); return g;
  }
  function drawText(){
    var pr = Math.min(window.devicePixelRatio || 1, 2); var cw = Math.min(2048, Math.round(W * pr)), ch = Math.round(cw * H / W);
    textCanvas.width = cw; textCanvas.height = ch; var k = cw / W;
    var r = word.getBoundingClientRect(), pr0 = pin.getBoundingClientRect();
    wordRect = { x: r.left - pr0.left, y: r.top - pr0.top, w: r.width, h: r.height };
    var cs = getComputedStyle(word);
    textCtx.clearRect(0, 0, cw, ch);
    textCtx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + (parseFloat(cs.fontSize) * k) + 'px ' + cs.fontFamily;
    try { textCtx.letterSpacing = (parseFloat(cs.letterSpacing) || 0) * k + 'px'; } catch (e) {}
    textCtx.fillStyle = '#fff'; textCtx.textBaseline = 'middle'; textCtx.textAlign = 'center';
    var text = cs.textTransform === 'uppercase' ? word.textContent.toUpperCase() : word.textContent;
    var ls = (parseFloat(cs.letterSpacing) || 0) * k;
    textCtx.fillText(text, (wordRect.x + wordRect.w / 2) * k + ls / 2, (wordRect.y + wordRect.h / 2) * k);
    try { textData = textCtx.getImageData(0, 0, cw, ch); } catch (e) { textData = null; }
    textTex.needsUpdate = true;
  }
  function randomInk(){
    for (var tries = 0; tries < 10; tries++) {
      var x = wordRect.x + Math.random() * wordRect.w, y = wordRect.y + Math.random() * wordRect.h;
      if (!textData) break;
      var k = textData.width / W, px = Math.min(textData.width - 1, Math.floor(x * k)), py = Math.min(textData.height - 1, Math.floor(y * k));
      if (textData.data[(py * textData.width + px) * 4 + 3] > 80) return [x - W / 2, H / 2 - y];
    }
    return [x - W / 2, H / 2 - y];
  }
  function spawnPetal(){ var p = randomInk(); var i = pi; pi = (pi + 1) % MAXP; pSpawn[i * 3] = p[0]; pSpawn[i * 3 + 1] = p[1]; pSpawn[i * 3 + 2] = Math.random() * 10; pBirth[i] = time; pSeed[i] = Math.random(); pScale[i] = 0.5 + Math.random() * 0.5; }
  function spawnDust(){ var p = randomInk(); var i = di; di = (di + 1) % MAXD; dSpawn[i * 3] = p[0]; dSpawn[i * 3 + 1] = p[1]; dSpawn[i * 3 + 2] = 5; dBirth[i] = time; dSeed[i] = Math.random(); }
  function size(){
    W = pin.clientWidth || 1; H = pin.clientHeight || 1;
    renderer.setSize(W, H, false);
    camera.left = -W / 2; camera.right = W / 2; camera.top = H / 2; camera.bottom = -H / 2; camera.updateProjectionMatrix();
    textMesh.scale.set(W, H, 1); textMat.uniforms.uRes.value.set(W, H);
    drawText();
  }
  function tick(){
    raf = 0; if (!visible) return;
    time += clock.getDelta();
    var prog = Math.min(1.15, P * 1.05);
    textMat.uniforms.uProgress.value = prog;
    petalMat.uniforms.uTime.value = time; dustMat.uniforms.uTime.value = time;
    var dp = prog - lastP;
    if (dp > 0 && prog < 1.05) {
      var np = Math.min(14, Math.round(dp * 520)), nd = Math.min(5, Math.round(dp * 140));
      for (var i = 0; i < np; i++) spawnPetal(); for (var j = 0; j < nd; j++) spawnDust();
      if (np) { petalGeo.attributes.aSpawn.needsUpdate = true; petalGeo.attributes.aBirth.needsUpdate = true; petalGeo.attributes.aSeed.needsUpdate = true; petalGeo.attributes.aScale.needsUpdate = true; }
      if (nd) { dustGeo.attributes.aSpawn.needsUpdate = true; dustGeo.attributes.aBirth.needsUpdate = true; dustGeo.attributes.aSeed.needsUpdate = true; }
    }
    lastP = prog;
    var fo = 1 - Math.min(1, Math.max(0, prog / 0.3));
    for (var f = 0; f < fades.length; f++) fades[f].style.opacity = fo.toFixed(3);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  function play(){ if (!raf && started) { clock.start(); raf = requestAnimationFrame(tick); } }
  function pause(){ if (raf) { cancelAnimationFrame(raf); raf = 0; clock.stop(); } }
  function init(){
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, premultipliedAlpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 500); camera.position.z = 100;
    textCanvas = document.createElement('canvas'); textCtx = textCanvas.getContext('2d', { willReadFrequently: true });
    textTex = new THREE.CanvasTexture(textCanvas); textTex.minFilter = THREE.LinearFilter; textTex.magFilter = THREE.LinearFilter; textTex.generateMipmaps = false;
    textGeo = new THREE.PlaneGeometry(1, 1);
    textMat = new THREE.ShaderMaterial({ vertexShader: TEXT_VERT, fragmentShader: TEXT_FRAG, transparent: true, depthWrite: false, uniforms: {
      uText: { value: textTex }, uProgress: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uInk: { value: new THREE.Vector3(${vec(t.ink)}) }, uGrey: { value: new THREE.Vector3(${vec(t.ink3)}) } } });
    textMesh = new THREE.Mesh(textGeo, textMat); scene.add(textMesh);
    pSpawn = new Float32Array(MAXP * 3); pBirth = new Float32Array(MAXP).fill(-1e5); pSeed = new Float32Array(MAXP); pScale = new Float32Array(MAXP);
    var base = petalGeometry();
    petalGeo = new THREE.InstancedBufferGeometry(); petalGeo.index = base.index; petalGeo.setAttribute('position', base.getAttribute('position')); petalGeo.setAttribute('normal', base.getAttribute('normal')); petalGeo.setAttribute('uv', base.getAttribute('uv'));
    petalGeo.setAttribute('aSpawn', new THREE.InstancedBufferAttribute(pSpawn, 3)); petalGeo.setAttribute('aBirth', new THREE.InstancedBufferAttribute(pBirth, 1)); petalGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(pSeed, 1)); petalGeo.setAttribute('aScale', new THREE.InstancedBufferAttribute(pScale, 1));
    petalGeo.instanceCount = MAXP;
    petalMat = new THREE.ShaderMaterial({ vertexShader: PETAL_VERT, fragmentShader: PETAL_FRAG, transparent: true, side: THREE.DoubleSide, depthWrite: false, uniforms: {
      uTime: { value: 0 }, uLife: { value: 6 }, uUnit: { value: 22 }, uAccent: { value: new THREE.Vector3(${vec(t.accent)}) }, uWhite: { value: new THREE.Vector3(${vec(t.dark ? "#eeeeee" : t.ink)}) } } });
    petals = new THREE.Mesh(petalGeo, petalMat); petals.frustumCulled = false; scene.add(petals);
    dSpawn = new Float32Array(MAXD * 3); dBirth = new Float32Array(MAXD).fill(-1e5); dSeed = new Float32Array(MAXD);
    dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXD * 3), 3));
    dustGeo.setAttribute('aSpawn', new THREE.BufferAttribute(dSpawn, 3)); dustGeo.setAttribute('aBirth', new THREE.BufferAttribute(dBirth, 1)); dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(dSeed, 1));
    dustMat = new THREE.ShaderMaterial({ vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 }, uLife: { value: 4 }, uPr: { value: Math.min(window.devicePixelRatio || 1, 1.5) }, uInk: { value: new THREE.Vector3(${vec(t.ink)}) } } });
    dust = new THREE.Points(dustGeo, dustMat); dust.frustumCulled = false; scene.add(dust);
    var go = function(){ size(); el.classList.add('is-gl'); };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(go); else go();
    ro = new ResizeObserver(function(){ if (el.classList.contains('is-gl')) size(); }); ro.observe(pin);
    st = ScrollTrigger.create({ trigger: el, start: 'top top', end: 'bottom bottom', scrub: true, onUpdate: function(self){ P = self.progress; } });
  }
  var io = new IntersectionObserver(function(es){ es.forEach(function(en){ visible = en.isIntersecting; if (visible) { if (!started) { started = true; init(); } play(); } else pause(); }); }, { rootMargin: '10% 0px' });
  io.observe(el);
  window.addEventListener('pagehide', function(){ pause(); io.disconnect(); if (ro) ro.disconnect(); if (st) st.kill(); if (renderer) { textGeo.dispose(); textMat.dispose(); textTex.dispose(); petalGeo.dispose(); petalMat.dispose(); dustGeo.dispose(); dustMat.dispose(); renderer.dispose(); } });
})();`,
};
export default c;
