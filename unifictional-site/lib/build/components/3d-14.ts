// @ts-nocheck
// 3d-14 · Drag-to-shatter image with swirl distortion (Awwwards Pack, video only).
// Rebuilt from the storyboard: a rounded portrait card is a non-indexed plane
// whose vertex shader twists the picture into a spiral by radius and breaks it
// into per-triangle shards (rotated about their centroid, pushed out and in z)
// while the pointer drags; releasing eases it whole again.
import type { Component } from "./_types";

const c: Component = {
  id: "3d-14",
  type: "shatter-drag",
  kind: "section",
  weight: "heavy",
  libs: ["three"],
  module: true,
  describe: "(recreated from the preview video) shatter-drag (3d-14): a dark full-height screen with a headline and a short line on the left and one rounded portrait photo card on the right; a small 'DRAG' cursor follows the pointer over the card. Pressing and dragging twists the photo into a spiral and splinters it into dozens of tumbling triangular shards that fly outward, harder the faster you drag; letting go eases it back into a whole picture. On phones and with reduced motion the card is a plain photo. Needs one strong portrait image (3:4) and a 2-8 word headline. Suits creative studios, architecture and interiors, photographers, galleries and any brand with a single hero image to play with. Heavy: one per site.",
  fields: `{"type":"shatter-drag","component":"3d-14","eyebrow":"","headline":"","text":"","image":{"query":"","alt":""}}`,
  images: { min: 1, max: 1 },
  css: ({ pair, capsRule }) => `
.sh{position:relative;min-height:100svh;background:var(--inv-bg);color:var(--inv-ink);display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:center;gap:clamp(2rem,5vw,5rem);padding:7rem var(--gutter) 5rem;overflow:hidden}
.sh__copy{display:grid;gap:1.1rem;max-width:36rem}
.sh__copy .mono{color:var(--inv-ink);opacity:.6}
.sh__copy h2{font-size:clamp(2.2rem,5vw,4.8rem);font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};line-height:.95;${capsRule}}
.sh__copy p{max-width:42ch;opacity:.7;font-size:clamp(1rem,1.3vw,1.15rem)}
.sh__stage{position:relative;justify-self:center;width:min(100%,32rem);aspect-ratio:3/4;touch-action:none}
.sh__card{position:absolute;inset:0;border-radius:18px;overflow:hidden;box-shadow:0 40px 80px rgba(0,0,0,.45)}
.sh__card img{width:100%;height:100%;object-fit:cover;display:block}
.sh__canvas{position:absolute;inset:-35% -40%;width:180%;height:170%;display:block;cursor:none;opacity:0;transition:opacity .6s}
.sh.is-gl .sh__canvas{opacity:1}
.sh.is-gl .sh__card{opacity:0}
.sh__cursor{position:absolute;left:0;top:0;z-index:3;pointer-events:none;display:flex;align-items:center;justify-content:center;width:4.4rem;height:4.4rem;border-radius:50%;background:var(--inv-ink);color:var(--inv-bg);font-family:var(--mono);font-size:.62rem;letter-spacing:.18em;text-transform:uppercase;transform:translate(-50%,-50%) scale(0);transition:transform .35s var(--ease-out)}
.sh.is-gl .sh__stage:hover .sh__cursor{transform:translate(-50%,-50%) scale(1)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .sh{min-height:0;grid-template-columns:1fr;padding:5rem var(--gutter) 3rem;gap:2.5rem}
  .sh__canvas,.sh__cursor{display:none}
  .sh__stage{width:min(100%,22rem)}
  .sh.is-gl .sh__card{opacity:1}
}`,
  html: (s, { esc, imgUrl }) => `
<section class="sh" data-fx="shatter-drag">
  <div class="sh__copy">
    ${s.eyebrow ? `<span class="mono reveal">${esc(s.eyebrow)}</span>` : ""}
    <h2 class="reveal">${esc(s.headline || "")}</h2>
    ${s.text ? `<p class="reveal">${esc(s.text)}</p>` : ""}
  </div>
  <div class="sh__stage">
    <div class="sh__card"><img src="${esc(imgUrl(s.image, 1400))}" alt="${esc(s.image?.alt || "")}" loading="lazy"></div>
    <canvas class="sh__canvas" aria-hidden="true"></canvas>
    <div class="sh__cursor" aria-hidden="true">Drag</div>
  </div>
</section>`,
  js: () => String.raw`
import * as THREE from "three";
(function(){
  var sec = document.querySelector('[data-fx="shatter-drag"]');
  if (!sec) return;
  var stage = sec.querySelector('.sh__stage'), canvas = sec.querySelector('.sh__canvas'), img = sec.querySelector('.sh__card img'), cur = sec.querySelector('.sh__cursor');
  function hasGL(){ try { var c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }
  if (!window.__fx.FX || !hasGL() || !img) return;

  var DPR = Math.min(window.devicePixelRatio || 1, 1.5);
  var renderer, scene, camera, mesh, uni, started = false, running = false, raf = 0;
  var PW = 3, PH = 4;
  var dragging = false, last = null, breakT = 0, twistT = 0, hoverT = 0;

  var VS = [
    'attribute vec3 aCentroid; attribute vec3 aRand; attribute vec3 aAxis;',
    'uniform float uBreak; uniform float uTwist; uniform float uTime; uniform vec2 uSize;',
    'varying vec2 vUv; varying float vShade;',
    'mat3 rotAxis(vec3 a, float t){ float c = cos(t), s = sin(t), o = 1.0 - c;',
    ' return mat3(o*a.x*a.x+c, o*a.x*a.y+a.z*s, o*a.z*a.x-a.y*s, o*a.x*a.y-a.z*s, o*a.y*a.y+c, o*a.y*a.z+a.x*s, o*a.z*a.x+a.y*s, o*a.y*a.z-a.x*s, o*a.z*a.z+c); }',
    'vec2 twist(vec2 p){ float r = length(p) / (0.5 * max(uSize.x, uSize.y)); float a = (uTwist + uBreak * 1.6) * (1.0 - smoothstep(0.0, 1.3, r)); float c = cos(a), s = sin(a); return vec2(c*p.x - s*p.y, s*p.x + c*p.y); }',
    'void main(){',
    ' vUv = uv;',
    ' vec3 whole = vec3(twist(position.xy), 0.0);',
    ' vec3 c = vec3(twist(aCentroid.xy), 0.0);',
    ' vec3 q = position - aCentroid;',
    ' q = rotAxis(aAxis, uBreak * (aRand.x * 2.0 - 1.0) * 2.4 + uTime * uBreak * (aRand.y - 0.5) * 1.2) * q;',
    ' vec2 dir = normalize(c.xy + vec2(0.001, 0.0));',
    ' vec3 shard = c + q;',
    ' shard.xy += dir * uBreak * (0.12 + aRand.y * 0.5) * (0.3 + length(c.xy) * 0.25);',
    ' shard.z += uBreak * (aRand.z * 2.0 - 1.0) * 0.9;',
    ' vec3 p = mix(whole, shard, smoothstep(0.0, 1.0, uBreak));',
    ' vShade = 1.0 - uBreak * (0.08 + aRand.z * 0.28);',
    ' gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
    '}'
  ].join('\n');
  var FS = [
    'precision highp float;',
    'uniform sampler2D uTex; uniform vec2 uCover; uniform vec2 uSize; uniform float uRadius;',
    'varying vec2 vUv; varying float vShade;',
    'void main(){',
    ' vec2 p = abs(vUv - 0.5) * uSize - (uSize * 0.5 - uRadius);',
    ' float d = length(max(p, 0.0)) - uRadius;',
    ' if (d > 0.0) discard;',
    ' vec2 uv = (vUv - 0.5) * uCover + 0.5;',
    ' vec4 c = texture2D(uTex, uv);',
    ' gl_FragColor = vec4(c.rgb * vShade, 1.0);',
    '}'
  ].join('\n');

  function size(){
    var w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    // the card box is 1/1.8 of the canvas width: fit the plane width to it
    var dist = (PW * 1.8 / 2) / (Math.tan(camera.fov * Math.PI / 360) * camera.aspect);
    camera.position.z = dist;
  }

  function init(){
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(DPR);
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(36, 1, 0.1, 40);

    var geo = new THREE.PlaneGeometry(PW, PH, 14, 19).toNonIndexed();
    var pos = geo.attributes.position, n = pos.count;
    var cen = new Float32Array(n * 3), rnd = new Float32Array(n * 3), ax = new Float32Array(n * 3);
    for (var i = 0; i < n; i += 3) {
      var cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      var r1 = Math.random(), r2 = Math.random(), r3 = Math.random();
      var a = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      for (var k = 0; k < 3; k++) { var j = (i + k) * 3; cen[j] = cx; cen[j + 1] = cy; cen[j + 2] = 0; rnd[j] = r1; rnd[j + 1] = r2; rnd[j + 2] = r3; ax[j] = a.x; ax[j + 1] = a.y; ax[j + 2] = a.z; }
    }
    geo.setAttribute('aCentroid', new THREE.BufferAttribute(cen, 3));
    geo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 3));
    geo.setAttribute('aAxis', new THREE.BufferAttribute(ax, 3));

    var tex = new THREE.TextureLoader().setCrossOrigin('anonymous').load(img.currentSrc || img.src, function(tx){
      tx.colorSpace = THREE.SRGBColorSpace;
      var ia = tx.image.width / tx.image.height, pa = PW / PH;
      uni.uCover.value.set(ia > pa ? pa / ia : 1, ia > pa ? 1 : ia / pa);
      sec.classList.add('is-gl');
    });
    uni = { uTex: { value: tex }, uCover: { value: new THREE.Vector2(1, 1) }, uSize: { value: new THREE.Vector2(PW, PH) }, uRadius: { value: 0.18 }, uBreak: { value: 0 }, uTwist: { value: 0 }, uTime: { value: 0 } };
    mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: uni, side: THREE.DoubleSide }));
    scene.add(mesh);

    size();
    if (window.ResizeObserver) new ResizeObserver(size).observe(canvas);

    stage.addEventListener('pointermove', function(e){
      var r = stage.getBoundingClientRect();
      cur.style.left = (e.clientX - r.left) + 'px'; cur.style.top = (e.clientY - r.top) + 'px';
      hoverT = ((e.clientX - r.left) / r.width - 0.5) * 0.35;
      if (dragging && last) {
        var dx = e.clientX - last[0], dy = e.clientY - last[1], v = Math.sqrt(dx * dx + dy * dy);
        twistT += dx * 0.008 - dy * 0.003;
        breakT = Math.min(1, Math.max(0.45, breakT * 0.92 + v * 0.03));
        last = [e.clientX, e.clientY];
      }
    });
    canvas.addEventListener('pointerdown', function(e){ dragging = true; last = [e.clientX, e.clientY]; breakT = 0.45; canvas.setPointerCapture(e.pointerId); });
    function up(){ dragging = false; last = null; breakT = 0; twistT = 0; }
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
  }

  function render(){
    uni.uTime.value += 0.016;
    uni.uBreak.value += (breakT - uni.uBreak.value) * (dragging ? 0.1 : 0.06);
    uni.uTwist.value += ((twistT + hoverT) - uni.uTwist.value) * 0.07;
    mesh.rotation.y = hoverT * 0.4 + uni.uTwist.value * 0.05;
    mesh.rotation.x = -hoverT * 0.1;
    renderer.render(scene, camera);
  }
  function loop(){ if (!running) return; raf = requestAnimationFrame(loop); render(); }

  var io = new IntersectionObserver(function(es){
    es.forEach(function(en){
      if (en.isIntersecting) {
        if (!started) { started = true; try { init(); } catch (e) { sec.classList.remove('is-gl'); io.disconnect(); return; } }
        if (!running) { running = true; loop(); }
      } else { running = false; cancelAnimationFrame(raf); }
    });
  }, { rootMargin: '120px' });
  io.observe(sec);

  window.addEventListener('pagehide', function(){
    running = false; cancelAnimationFrame(raf);
    if (!renderer) return;
    mesh.geometry.dispose(); mesh.material.dispose(); if (uni.uTex.value) uni.uTex.value.dispose(); renderer.dispose();
  }, { once: true });
})();`,
};
export default c;
