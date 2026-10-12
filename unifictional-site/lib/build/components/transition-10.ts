// @ts-nocheck
// transition-10 · Rotating giant-type page transition (Awwwards Pack, video only).
// A fixed layer of seven rows of the brand name in huge display type, a shade
// off the background, fades up, darkens to ink, scales about three times and
// rotates to -90 degrees until letters fill the screen; the next page loads
// behind the same state and plays it backwards. No colour panel: the type
// itself covers the swap.
import type { Component } from "./_types";

const c: Component = {
  id: "transition-10",
  type: "transition",
  kind: "transition",
  weight: "light",
  describe: "(recreated from the preview video) transition-10: on every link click the page content fades and a layer of seven rows of the brand name, repeated in huge display type a shade off the page colour, rises into view; the rows darken to the ink colour, drift sideways in alternate directions, scale about three times and rotate counter-clockwise to -90 degrees until vertical columns of letters fill the screen, about 1.1 s. The next page loads behind that same wall of letters, which rotates back, shrinks, fades to a tint and disappears. No colour panel is used; the type itself covers the swap. Typographic, luxurious, slow. Fits fashion, editorial, hospitality, architects, premium brands with a short name.",
  fields: `theme: {"transition":"transition-10"}`,
  css: ({ pair }) => `
.tr10{position:fixed;inset:0;z-index:100;pointer-events:none;visibility:hidden;background:var(--bg);overflow:hidden}
.tr10__type{position:absolute;left:50%;top:50%;width:180vmax;transform:translate(-50%,-50%);display:flex;flex-direction:column;justify-content:center;gap:0;color:var(--ink);opacity:.09;will-change:transform,opacity}
.tr10__row{white-space:nowrap;font-family:var(--display);font-weight:${pair.weight};font-size:15vh;line-height:.95;letter-spacing:${pair.track};text-transform:uppercase;text-align:center;will-change:transform}
.tr10__row:nth-child(even){padding-left:10vw}
.tr10.is-boot{visibility:visible;animation:tr10boot 0s 2.5s forwards}
.tr10.is-boot .tr10__type{opacity:1;transform:translate(-50%,-50%) rotate(-90deg) scale(3)}
@keyframes tr10boot{to{visibility:hidden}}
@media(prefers-reduced-motion:reduce){.tr10.is-boot{visibility:hidden}}
`,
  html: (_s, { spec, esc }) => {
    const name = String((spec.brand || {}).name || "").trim() || "Studio";
    const row = Array.from({ length: 6 }, () => esc(name)).join(" &nbsp; ");
    return `
<div class="tr10 is-boot" id="js-tr10" aria-hidden="true"><div class="tr10__type">${Array.from({ length: 7 }, () => `<div class="tr10__row">${row}</div>`).join("")}</div></div>`;
  },
  js: () => `
(function(){
  var FXS = window.__fx, RM = FXS.RM;
  var ov = document.getElementById('js-tr10');
  if (!ov) return;
  if (!window.gsap) { ov.classList.remove('is-boot'); return; }
  var type = ov.querySelector('.tr10__type'), rows = ov.querySelectorAll('.tr10__row');
  var page = [document.querySelector('main'), document.querySelector('body > footer')].filter(Boolean);
  var leaving = false;
  function drift(i){ return (i % 2 ? 1 : -1) * 8; }
  function idle(){ gsap.set(ov, { autoAlpha: 0 }); gsap.set(type, { xPercent: -50, yPercent: -50, rotation: 0, scale: 1, opacity: 0.09 }); gsap.set(rows, { xPercent: 0 }); }
  function enter(){
    ov.classList.remove('is-boot');
    if (RM) { idle(); return; }
    gsap.set(type, { xPercent: -50, yPercent: -50, rotation: -90, scale: 3, opacity: 1 });
    gsap.set(rows, { xPercent: function(i){ return drift(i); } });
    gsap.set(ov, { autoAlpha: 1 });
    gsap.timeline({ onComplete: idle })
      .to(type, { rotation: 0, scale: 1, opacity: 0.09, duration: 1, ease: 'power3.inOut' }, 0)
      .to(rows, { xPercent: 0, duration: 1, ease: 'power3.inOut' }, 0)
      .to(ov, { autoAlpha: 0, duration: 0.45, ease: 'power2.out' }, 0.6);
  }
  function exit(done){
    gsap.set(type, { xPercent: -50, yPercent: -50, rotation: 0, scale: 1, opacity: 0.09 });
    gsap.set(rows, { xPercent: 0 });
    gsap.timeline({ onComplete: done })
      .to(ov, { autoAlpha: 1, duration: 0.35, ease: 'power2.out' }, 0)
      .to(page, { opacity: 0, duration: 0.3, ease: 'power2.out' }, 0)
      .to(type, { rotation: -90, scale: 3, opacity: 1, duration: 1.1, ease: 'power3.inOut' }, 0)
      .to(rows, { xPercent: function(i){ return drift(i); }, duration: 1.1, ease: 'power3.inOut' }, 0);
  }
  enter();
  window.addEventListener('pageshow', function(e){ if (e.persisted) { leaving = false; gsap.set(page, { clearProps: 'opacity' }); ov.classList.add('is-boot'); enter(); } });
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
