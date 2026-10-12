// @ts-nocheck
// transition-3 · Diagonal polygon-wipe image stack transition (Awwwards Pack, video only).
// Five fixed layers (four colour shards in tints of the tokens, then the
// page's own hero photo inside a thin margin) open from the bottom-right
// corner, each a polygon whose free corner travels to the top-left; on the
// next page they peel off toward the bottom-left in reverse order.
import type { Component } from "./_types";

const c: Component = {
  id: "transition-3",
  type: "transition",
  kind: "transition",
  weight: "light",
  describe: "(recreated from the preview video) transition-3: on every link click, five full-screen layers open in quick succession from the bottom-right corner, each a polygon whose free corner travels to the top-left so skewed shards overlap: four flat shards in tints of the accent and the inverse background, then the page's own hero photo held inside a thin margin. The next page loads already covered and the shards peel off toward the bottom-left in reverse order, uncovering it; about a second each way. Needs no extra content: the photo is whatever the page's first image is (a colour shard when there is none). Energetic, editorial. Fits studios, agencies, portfolios, events.",
  fields: `theme: {"transition":"transition-3"}`,
  css: () => `
.tr3{position:fixed;inset:0;z-index:100;pointer-events:none;visibility:hidden}
.tr3__l{position:absolute;inset:0;clip-path:polygon(100% 0,100% 100%,0 100%,100% 100%);will-change:clip-path}
.tr3__l:nth-child(1){background:color-mix(in oklab,var(--accent) 30%,var(--bg))}
.tr3__l:nth-child(2){background:color-mix(in oklab,var(--accent) 65%,var(--bg))}
.tr3__l:nth-child(3){background:var(--accent)}
.tr3__l:nth-child(4){background:color-mix(in oklab,var(--accent) 45%,var(--inv-bg))}
.tr3__l--img{inset:clamp(8px,1.2vw,16px);background:var(--inv-bg);overflow:hidden}
.tr3__l--img img{width:100%;height:100%;object-fit:cover}
.tr3.is-boot{visibility:visible;animation:tr3boot 0s 2.5s forwards}
.tr3.is-boot .tr3__l{clip-path:polygon(0 0,100% 0,100% 100%,0 100%)}
@keyframes tr3boot{to{visibility:hidden}}
@media(prefers-reduced-motion:reduce){.tr3.is-boot{visibility:hidden}}
`,
  html: () => `
<div class="tr3 is-boot" id="js-tr3" aria-hidden="true"><i class="tr3__l"></i><i class="tr3__l"></i><i class="tr3__l"></i><i class="tr3__l"></i><div class="tr3__l tr3__l--img"></div></div>`,
  js: () => `
(function(){
  var FXS = window.__fx, RM = FXS.RM;
  var ov = document.getElementById('js-tr3');
  if (!ov) return;
  if (!window.gsap) { ov.classList.remove('is-boot'); return; }
  var layers = Array.prototype.slice.call(ov.querySelectorAll('.tr3__l')), imgL = ov.querySelector('.tr3__l--img');
  var CLOSED = 'polygon(100% 0, 100% 100%, 0 100%, 100% 100%)', FULL = 'polygon(0 0, 100% 0, 100% 100%, 0 100%)', GONE = 'polygon(0 100%, 0 100%, 100% 100%, 0 100%)';
  var leaving = false;
  function setImg(){
    var im = document.querySelector('main img'), src = im && (im.currentSrc || im.src);
    imgL.innerHTML = '';
    if (src) { var cp = document.createElement('img'); cp.src = src; cp.alt = ''; imgL.appendChild(cp); }
  }
  function idle(){ gsap.set(ov, { autoAlpha: 0 }); gsap.set(layers, { clipPath: CLOSED }); }
  function enter(){
    ov.classList.remove('is-boot');
    if (RM) { idle(); return; }
    setImg();
    gsap.set(layers, { clipPath: FULL }); gsap.set(ov, { autoAlpha: 1 });
    gsap.to(layers.slice().reverse(), { clipPath: GONE, duration: 0.7, stagger: 0.1, ease: 'power3.inOut', onComplete: idle });
  }
  function exit(done){
    setImg();
    gsap.set(layers, { clipPath: CLOSED }); gsap.set(ov, { autoAlpha: 1 });
    gsap.to(layers, { clipPath: FULL, duration: 0.7, stagger: 0.1, ease: 'power3.inOut', onComplete: done });
  }
  enter();
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
