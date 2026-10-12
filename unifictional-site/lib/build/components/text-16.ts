// @ts-nocheck
// text-16 · Headline letters and paragraph words scatter away from the cursor, then ease back (Awwwards Pack).
import type { Component } from "./_types";

const c: Component = {
  id: "text-16",
  type: "repel-text",
  kind: "section",
  weight: "medium",
  describe: "repel-text (text-16): a centred band with a 3-8 word headline in large display type and one or two short paragraphs (30-70 words each) beneath it. When the cursor moves over the text, the headline's letters and the paragraph's words are pushed straight away from the pointer within a small radius, then drift back into place once it has moved on. A playful intro or manifesto block for studios, agencies and makers; plain static text on phones, touch screens and with reduced motion.",
  fields: `{"type":"repel-text","component":"text-16","headline":"","paragraphs":["",""]}`,
  css: () => `
.repel{padding:clamp(5rem,14vh,10rem) var(--gutter);display:grid;gap:clamp(2rem,5vh,3.5rem);justify-items:center;text-align:center;overflow:hidden}
.repel__head{font-size:clamp(2.6rem,7.5vw,8.5rem);max-width:14ch}
.repel__p{max-width:58ch;font-size:clamp(1.05rem,1.4vw,1.3rem);line-height:1.6;color:var(--ink2)}
.repel__word{display:inline-block;white-space:nowrap}
.repel .ch,.repel .w{display:inline-block;will-change:transform}`,
  html: (s, { esc }) => `
<section class="repel" data-fx="repel-text">
  <h2 class="repel__head display">${esc(s.headline)}</h2>
  ${(s.paragraphs || []).slice(0, 2).map(p => `<p class="repel__p">${esc(p)}</p>`).join("")}
</section>`,
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="repel-text"]');
  if (!sec || !window.__fx.FX || !window.matchMedia('(pointer: fine)').matches) return;
  var nodes = [];
  function split(el, letters){
    if (!el) return;
    var words = el.textContent.trim().split(/\\s+/);
    el.textContent = '';
    words.forEach(function(w, wi){
      if (letters) {
        var wrap = document.createElement('span'); wrap.className = 'repel__word';
        for (var i = 0; i < w.length; i++) { var ch = document.createElement('span'); ch.className = 'ch'; ch.textContent = w[i]; wrap.appendChild(ch); nodes.push({ el: ch, max: 90 }); }
        el.appendChild(wrap);
      } else {
        var sp = document.createElement('span'); sp.className = 'w'; sp.textContent = w; el.appendChild(sp); nodes.push({ el: sp, max: 55 });
      }
      if (wi < words.length - 1) el.appendChild(document.createTextNode(' '));
    });
  }
  split(sec.querySelector('.repel__head'), true);
  sec.querySelectorAll('.repel__p').forEach(function(p){ split(p, false); });
  nodes.forEach(function(n){ n.ox = 0; n.oy = 0; n.cx = 0; n.cy = 0; n.tx = 0; n.ty = 0; });
  var RADIUS = 150, measured = false, running = false, inView = false;
  function measure(){
    var sx = window.scrollX, sy = window.scrollY;
    nodes.forEach(function(n){ var r = n.el.getBoundingClientRect(); n.ox = r.left + r.width / 2 - n.cx + sx; n.oy = r.top + r.height / 2 - n.cy + sy; });
    measured = true;
  }
  function tick(){
    var settled = true;
    nodes.forEach(function(n){
      if (Math.abs(n.tx - n.cx) + Math.abs(n.ty - n.cy) < 0.05) {
        if (n.cx !== n.tx || n.cy !== n.ty) { n.cx = n.tx; n.cy = n.ty; n.el.style.transform = n.cx || n.cy ? 'translate(' + n.cx.toFixed(2) + 'px,' + n.cy.toFixed(2) + 'px)' : ''; }
        return;
      }
      settled = false;
      n.cx += (n.tx - n.cx) * 0.1; n.cy += (n.ty - n.cy) * 0.1;
      n.el.style.transform = 'translate(' + n.cx.toFixed(2) + 'px,' + n.cy.toFixed(2) + 'px)';
    });
    if (settled) { gsap.ticker.remove(tick); running = false; }
  }
  function run(){ if (!running) { running = true; gsap.ticker.add(tick); } }
  function release(){ nodes.forEach(function(n){ n.tx = 0; n.ty = 0; }); run(); }
  function onMove(e){
    if (!inView) return;
    if (!measured) measure();
    var mx = e.clientX + window.scrollX, my = e.clientY + window.scrollY;
    nodes.forEach(function(n){
      var dx = n.ox - mx, dy = n.oy - my, d = Math.sqrt(dx * dx + dy * dy);
      if (d < RADIUS) { if (d < 1) { d = 1; dx = 1; dy = 0; } var f = (1 - d / RADIUS) * n.max; n.tx = dx / d * f; n.ty = dy / d * f; }
      else { n.tx = 0; n.ty = 0; }
    });
    run();
  }
  new IntersectionObserver(function(es){ es.forEach(function(en){ inView = en.isIntersecting; if (!inView) release(); }); }, { rootMargin: '100px 0px' }).observe(sec);
  document.addEventListener('mousemove', onMove, { passive: true });
  document.addEventListener('mouseleave', release);
  var stale = function(){ measured = false; };
  if (window.ScrollTrigger) ScrollTrigger.addEventListener('refresh', stale);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(stale);
})();`,
};
export default c;
