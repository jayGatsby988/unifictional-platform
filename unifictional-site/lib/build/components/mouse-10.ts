// @ts-nocheck
// mouse-10 · Inertial image follower with tilt and echo (Awwwards Pack, video only: recreated from the preview).
// Site-wide hover effect: a small portrait preview card chases the pointer with inertia while a
// link, service card or grid item is hovered, tilting with the mouse's sideways speed and dragging
// four translucent echo copies behind it. It shows the hovered thing's image, or its title when it has none.
import type { Component } from "./_types";

const c: Component = {
  id: "mouse-10",
  type: "cursor",
  kind: "cursor",
  weight: "light",
  describe: "(recreated from the preview video) hover follower (mouse-10): a site-wide hover effect. While the pointer is over a link, button, service card, gallery item or anything marked data-cursor=\"hover\", a small portrait preview card (about 12% of the screen wide) glides after the cursor with a visible lag, tilting up to ten degrees in the direction of movement, and four translucent copies trail behind it like motion echo; at rest it settles into one clean card. The card shows that element's photo (an image inside it, or the menu's page preview for nav links); service cards and items without a photo show their title on an inverted tile instead, and plain text links without one show nothing. It hides as soon as the pointer leaves the element. Does nothing on touch screens or with reduced motion. Good for portfolios, service menus and any site with one strong photo per link.",
  fields: `theme: {"cursor":"mouse-10"}`,
  css: ({ pair, capsRule }) => `
.cfol{position:fixed;inset:0;z-index:45;pointer-events:none}
.cfol__c{position:absolute;top:0;left:0;width:clamp(120px,12vw,200px);aspect-ratio:3/4;overflow:hidden;opacity:0;will-change:transform,opacity;background:var(--inv-bg);color:var(--inv-ink);display:grid;place-items:center;text-align:center;padding:1rem}
.cfol__c img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none}
.cfol__c.has-img img{display:block}
.cfol__c span{position:relative;z-index:1;font-family:var(--display);font-weight:${pair.weight};font-size:1.15rem;line-height:1.1;letter-spacing:${pair.track};${capsRule}}
.cfol__c.has-img span{display:none}
.cfol__c.is-main{box-shadow:0 24px 60px rgba(0,0,0,.3)}
@media(pointer:coarse),(prefers-reduced-motion:reduce),(max-width:767px){.cfol{display:none}}`,
  html: (_, { spec, esc, imgUrl, link }) => {
    const nav = (spec.nav?.links || []).filter(l => l.image?.url).map(l => ({ href: link(l.href), src: imgUrl(l.image, 700) }));
    return `<div class="cfol" data-fx="cursor-follow-10" aria-hidden="true" data-nav="${esc(JSON.stringify(nav))}"></div>`;
  },
  js: () => `
(function(){
  var root = document.querySelector('[data-fx="cursor-follow-10"]');
  if (!root || window.__fx.RM || window.__fx.SMALL || window.matchMedia('(pointer: coarse)').matches || !window.matchMedia('(pointer: fine)').matches) return;
  var nav = []; try { nav = JSON.parse(root.getAttribute('data-nav') || '[]'); } catch (e) {}
  var TARGETS = 'a, button, .service, .grid__item, .row__title, [data-cursor="hover"]', TEXT_OK = '.service, .grid__item, .row__title, [data-cursor="hover"]';
  var N = 5, items = [], durs = [0.95, 0.78, 0.62, 0.46, 0.3], ops = [0.1, 0.18, 0.26, 0.36, 1], xs = [], ys = [], rs = [];
  for (var i = 0; i < N; i++) {
    var el = document.createElement('div'); el.className = 'cfol__c' + (i === N - 1 ? ' is-main' : '');
    el.innerHTML = '<img alt=""><span></span>'; root.appendChild(el); items.push(el);
    xs.push(gsap.quickTo(el, 'x', { duration: durs[i], ease: 'power3' }));
    ys.push(gsap.quickTo(el, 'y', { duration: durs[i], ease: 'power3' }));
    rs.push(gsap.quickTo(el, 'rotation', { duration: 0.5, ease: 'power2' }));
  }
  var cur = null, shown = false, lastX = 0, lastY = 0, lastT = 0, w = 0, h = 0, settle = null;
  function content(t){
    var im = t.querySelector('img'); var s = im && im.getAttribute('src');
    if (s && !/^data:/.test(s)) return { src: s };
    if (t.getAttribute('data-img')) return { src: t.getAttribute('data-img') };
    var href = t.getAttribute('href');
    if (href) for (var i = 0; i < nav.length; i++) if (nav[i].href === href) return { src: nav[i].src };
    if (t.matches(TEXT_OK)) { var hd = t.querySelector('h1,h2,h3,h4,figcaption,.row__title') || t; var txt = hd.textContent.replace(/\\s+/g, ' ').trim().slice(0, 48); if (txt) return { text: txt }; }
    return null;
  }
  function show(c, x, y){
    items.forEach(function(el){ var im = el.firstChild, sp = el.lastChild; if (c.src) { im.src = c.src; el.classList.add('has-img'); } else { el.classList.remove('has-img'); sp.textContent = c.text; } });
    if (!shown) {
      shown = true; w = items[N - 1].offsetWidth; h = items[N - 1].offsetHeight;
      items.forEach(function(el, i){ gsap.set(el, { x: x + 26, y: y - h / 2, rotation: 0 }); });
      gsap.to(items, { opacity: function(i){ return ops[i]; }, scale: 1, duration: 0.35, ease: 'power3.out', overwrite: true, startAt: { scale: 0.8 } });
    }
  }
  function hide(){
    if (!shown) return; shown = false; cur = null;
    gsap.to(items, { opacity: 0, scale: 0.85, duration: 0.3, ease: 'power2.out', overwrite: true });
  }
  document.addEventListener('mouseover', function(e){
    var t = e.target.closest && e.target.closest(TARGETS);
    if (!t) { if (cur) hide(); return; }
    if (t === cur) return;
    var c = content(t);
    if (!c) { hide(); return; }
    cur = t; show(c, e.clientX, e.clientY);
  });
  document.addEventListener('mousemove', function(e){
    if (!shown) { lastX = e.clientX; lastY = e.clientY; lastT = performance.now(); return; }
    var t = performance.now(), dt = Math.max(1, t - lastT), vx = (e.clientX - lastX) / dt;
    lastX = e.clientX; lastY = e.clientY; lastT = t;
    var rot = Math.max(-10, Math.min(10, vx * 9));
    for (var i = 0; i < N; i++) { xs[i](e.clientX + 26); ys[i](e.clientY - h / 2); rs[i](rot); }
    if (settle) settle.kill();
    settle = gsap.delayedCall(0.14, function(){ for (var i = 0; i < N; i++) rs[i](0); });
  }, { passive: true });
  document.addEventListener('mouseleave', hide);
})();`,
};
export default c;
