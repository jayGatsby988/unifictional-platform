// @ts-nocheck
// transition-4 · Pixel-grid cover page transition (Awwwards Pack, video only).
// A fixed CSS grid of accent-coloured squares scales up cell by cell from the
// screen centre outward until the screen is solid; the next page loads solid
// and the squares vanish centre-first.
import type { Component } from "./_types";

const c: Component = {
  id: "transition-4",
  type: "transition",
  kind: "transition",
  weight: "light",
  describe: "(recreated from the preview video) transition-4: on every link click a grid of about 17 x 10 accent-coloured squares (10 across on phones) scales up in its cells from the screen centre outward until the screen is a solid block of the accent colour, about 0.65 s; the next page loads behind that solid block and the squares shrink away centre-first, revealing it. Pixel-like, crisp, quick. Needs only the accent colour. Fits tech, games, software, design studios, youthful brands.",
  fields: `theme: {"transition":"transition-4"}`,
  css: () => `
.tr4{position:fixed;inset:0;z-index:100;pointer-events:none;display:grid;overflow:hidden;visibility:hidden}
.tr4 i{display:block;background:var(--accent);transform:scale(0);will-change:transform}
.tr4.is-boot{visibility:visible;background:var(--accent);animation:tr4boot 0s 2.5s forwards}
@keyframes tr4boot{to{visibility:hidden}}
@media(prefers-reduced-motion:reduce){.tr4.is-boot{visibility:hidden}}
`,
  html: () => `
<div class="tr4 is-boot" id="js-tr4" aria-hidden="true"></div>`,
  js: () => `
(function(){
  var FXS = window.__fx, RM = FXS.RM;
  var ov = document.getElementById('js-tr4');
  if (!ov) return;
  if (!window.gsap) { ov.classList.remove('is-boot'); return; }
  var cells = [], rows = 0, cols = 0, busy = false, leaving = false;
  function build(){
    var w = window.innerWidth, h = window.innerHeight, cell = w < 768 ? w / 10 : Math.max(w / 17, 48);
    cols = Math.ceil(w / cell); rows = Math.ceil(h / cell);
    ov.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
    ov.style.gridTemplateRows = 'repeat(' + rows + ', 1fr)';
    ov.innerHTML = '';
    cells = [];
    for (var i = 0; i < rows * cols; i++) { var c = document.createElement('i'); ov.appendChild(c); cells.push(c); }
  }
  function idle(){ busy = false; gsap.set(ov, { autoAlpha: 0 }); gsap.set(cells, { scale: 0 }); }
  function enter(){
    build();
    ov.classList.remove('is-boot');
    if (RM) { idle(); return; }
    busy = true;
    gsap.set(cells, { scale: 1.02 }); gsap.set(ov, { autoAlpha: 1 });
    gsap.to(cells, { scale: 0, duration: 0.3, ease: 'power2.in', stagger: { grid: [rows, cols], from: 'center', amount: 0.4 }, onComplete: idle });
  }
  function exit(done){
    busy = true;
    gsap.set(cells, { scale: 0 }); gsap.set(ov, { autoAlpha: 1 });
    gsap.to(cells, { scale: 1.02, duration: 0.3, ease: 'power2.out', stagger: { grid: [rows, cols], from: 'center', amount: 0.35 }, onComplete: done });
  }
  enter();
  var rt; window.addEventListener('resize', function(){ clearTimeout(rt); rt = setTimeout(function(){ if (!busy) { build(); gsap.set(cells, { scale: 0 }); } }, 200); });
  window.addEventListener('pageshow', function(e){ if (e.persisted) { leaving = false; ov.classList.add('is-boot'); enter(); } });
  document.addEventListener('click', function(e){
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a'); if (!a) return;
    var href = a.getAttribute('href'); if (!href || a.target === '_blank' || a.hasAttribute('download')) return;
    if (/^(#|tel:|mailto:|javascript:)/i.test(href)) return;
    var url; try { url = new URL(a.href, location.href); } catch (_) { return; }
    if (url.origin !== location.origin) return;
    if (url.hash && url.pathname === location.pathname && url.search === location.search) return;
    e.preventDefault();
    if (leaving) return; leaving = true;
    FXS.closeMenu();
    var done = false; function nav(){ if (done) return; done = true; location.href = url.href; }
    setTimeout(nav, 1500);
    if (RM) nav(); else exit(nav);
  });
})();`,
};
export default c;
