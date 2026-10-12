// @ts-nocheck
// menu-20 · Page-slides-down menu reveal (Awwwards Pack).
// The whole page slides down half a screen, uncovering a tinted panel fixed
// behind it; the burger shrinks away while a circled arrow draws itself as
// the close button.
import type { Component } from "./_types";

const c: Component = {
  id: "menu-20",
  type: "menu",
  kind: "menu",
  weight: "light",
  describe: "menu-20: clicking the burger slides the whole page down by half the screen, uncovering a tinted panel that was fixed behind it; the burger's two bars shrink away while a circled up-arrow draws itself as the close button. The panel holds a 'Menu' column with 3-6 page links and the call to action, and a 'Contact' column with email, phone, address and hours. Nothing inside the panel animates; the page itself is the curtain. Quiet, modern, agency-like. Fits consultancies, agencies, clinics, architects, professional services.",
  fields: `nav: {"links":[{"label":"Services","href":"services"}], "cta":{"label":"Get a quote","href":"contact"}}`,
  css: ({ pair, capsRule }) => `
.nav{position:fixed;inset:0 0 auto 0;z-index:40;display:flex;align-items:center;justify-content:space-between;height:76px;padding:0 var(--gutter)}
.nav__links{display:none;gap:2rem;font-size:.9rem;color:var(--ink2)}
.nav__links a:hover,.nav__links a[aria-current]{color:var(--ink)}
@media(min-width:900px){.nav__links{display:flex}}
.nav__right{display:flex;align-items:center;gap:1rem}
.nav__cta{display:none}
@media(min-width:600px){.nav__cta{display:inline-flex;padding:.7em 1.2em;font-size:.85rem}}
.m20__toggle{position:relative;width:48px;height:48px;display:flex;align-items:center;justify-content:center}
.burger{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}
.burger span{display:block;width:26px;height:1.5px;background:var(--ink);transform-origin:50% 0;transition:transform .3s var(--ease)}
.burger:hover span:first-child{transform:translateX(-3px)}.burger:hover span:last-child{transform:translateX(3px)}
.m20__close{position:absolute;inset:0;display:none;color:var(--ink)}
.m20__close svg{width:48px;height:48px;display:block}
.m20__close path,.m20__close line,.m20__close circle{stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;fill:none;stroke-dasharray:1;stroke-dashoffset:1}
.m20__close circle{stroke-opacity:.35;transition:stroke-opacity .3s}
.m20__close:hover circle{stroke-opacity:1}
.nav__links,.nav__cta{transition:opacity .3s}
.nav.is-open .nav__links,.nav.is-open .nav__cta{opacity:0;pointer-events:none}
.m20{position:fixed;left:0;right:0;top:0;height:50svh;z-index:1;background:var(--bg2);background:color-mix(in srgb,var(--accent) 9%,var(--bg));color:var(--ink);visibility:hidden;overflow:hidden}
.m20__scroll{position:absolute;left:0;right:0;top:76px;bottom:0;overflow:auto;padding:.5rem var(--gutter) 2rem}
.m20-page{position:relative;z-index:2;background:var(--bg)}
.m20__cols{display:grid;grid-template-columns:45fr 55fr;gap:2rem}
.m20__label{font-family:var(--mono);font-size:.66rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2);margin-bottom:1.4rem}
.m20__links li{margin-bottom:.8rem}
.m20__links a,.m20__info a{position:relative;display:inline-block}
.m20__links a{font-family:var(--display);font-weight:${pair.weight};font-size:clamp(1.6rem,3vw,2.8rem);letter-spacing:${pair.track};line-height:1.1;${capsRule}transition:color .3s}
.m20__links a:hover,.m20__links a[aria-current]{color:var(--accent)}
.m20__links a::after,.m20__info a::after{content:"";position:absolute;left:0;bottom:-3px;width:100%;height:2px;background:currentColor;transform:scaleX(0);transform-origin:right;transition:transform .4s var(--ease)}
.m20__links a:hover::after,.m20__info a:hover::after{transform:scaleX(1);transform-origin:left}
.m20__cta{margin-top:1.2rem}
.m20__infos{display:grid;grid-template-columns:1fr 1fr;gap:1.4rem 2rem}
.m20__info li{font-size:1rem;color:var(--ink2);margin-bottom:.35rem;line-height:1.4}
.m20__info li:first-child{color:var(--ink);font-weight:500;margin-bottom:.5rem}
@media(max-width:767px){.m20{height:70svh}.m20__cols{grid-template-columns:1fr;gap:1.6rem}.m20__links a{font-size:clamp(1.5rem,7vw,2.2rem)}.m20__links li{margin-bottom:.6rem}}
`,
  html: (_s, ctx) => {
    const { spec, esc, link } = ctx;
    const n = spec.nav || { links: [], cta: null };
    const b = spec.brand || {};
    const links = (n.links || []).slice(0, 6);
    const cur = (l) => l.href === ctx.page.slug ? ' aria-current="page"' : "";
    const social = Object.entries(b.social || {}).filter(([, v]) => v && /^https?:/i.test(String(v))).slice(0, 4);
    const infos = [];
    if (b.email) infos.push(`<ul class="m20__info"><li>Email</li><li><a href="${esc(link("mailto:" + b.email))}">${esc(b.email)}</a></li></ul>`);
    if (b.phone) infos.push(`<ul class="m20__info"><li>Phone</li><li><a href="${esc(link("tel:" + String(b.phone).replace(/[^+\d]/g, "")))}">${esc(b.phone)}</a></li></ul>`);
    if (b.address || b.city) infos.push(`<ul class="m20__info"><li>Visit</li>${b.address ? `<li>${esc(b.address)}</li>` : ""}${b.city ? `<li>${esc(b.city)}</li>` : ""}</ul>`);
    if (b.hours) infos.push(`<ul class="m20__info"><li>Hours</li><li>${esc(b.hours)}</li></ul>`);
    if (social.length) infos.push(`<ul class="m20__info"><li>Follow</li>${social.map(([k, v]) => `<li><a href="${esc(link(v))}" target="_blank" rel="noopener">${esc(k)}</a></li>`).join("")}</ul>`);
    return `
<header class="nav" id="nav">
  ${ctx.brandMark()}
  <nav class="nav__links">${links.map(l => `<a href="${esc(link(l.href))}"${cur(l)}>${esc(l.label)}</a>`).join("")}</nav>
  <div class="nav__right">${n.cta ? `<a class="btn btn-primary nav__cta" href="${esc(link(n.cta.href))}">${esc(n.cta.label)}</a>` : ""}<span class="m20__toggle"><button class="burger" id="js-toggle" aria-label="Open menu" aria-expanded="false"><span></span><span></span></button><button class="m20__close" id="js-close" aria-label="Close menu"><svg viewBox="0 0 64 64" aria-hidden="true"><line x1="32" y1="24.8" x2="32" y2="39.7" pathLength="1"/><path d="M27 29.5L32 25.3" pathLength="1"/><path d="M32 25.3L37 29.5" pathLength="1"/><circle cx="32" cy="32" r="30" pathLength="1"/></svg></button></span></div>
</header>
<div class="m20" id="js-menu" aria-hidden="true" inert data-lenis-prevent>
  <div class="m20__scroll"><div class="m20__cols">
    <div class="m20__col"><p class="m20__label">Menu</p><ul class="m20__links">${links.map(l => `<li><a href="${esc(link(l.href))}"${cur(l)}>${esc(l.label)}</a></li>`).join("")}</ul>${n.cta ? `<a class="btn btn-primary m20__cta" href="${esc(link(n.cta.href))}">${esc(n.cta.label)}${ctx.arrow}</a>` : ""}</div>
    <div class="m20__col"><p class="m20__label">Contact</p><div class="m20__infos">${infos.join("")}</div></div>
  </div></div>
</div>`;
  },
  js: () => `
(function(){
  var FXS = window.__fx, RM = FXS.RM, lenis = FXS.lenis;
  var menu = document.getElementById('js-menu'), toggle = document.getElementById('js-toggle'), closeBtn = document.getElementById('js-close');
  if (!menu || !toggle || !closeBtn || !window.gsap) return;
  var page = [document.querySelector('main'), document.querySelector('body > footer')].filter(Boolean), nav = document.getElementById('nav');
  page.forEach(function(el){ el.classList.add('m20-page'); });
  var bars = toggle.querySelectorAll('span'), circle = closeBtn.querySelector('circle'), arrows = closeBtn.querySelectorAll('path, line');
  var openState = false;
  function d(n){ return RM ? 0.01 : n; }
  function at(n){ return RM ? 0 : n; }
  var tl = gsap.timeline({ paused: true, onReverseComplete: function(){ if (page.length) gsap.set(page, { clearProps: 'transform,clipPath' }); } })
    .set(menu, { visibility: 'visible' }, 0)
    .to(page, { y: function(){ return menu.offsetHeight; }, duration: d(1), ease: 'expo.inOut' }, 0)
    .to(bars, { scaleX: 0, duration: d(0.6), ease: 'expo.inOut' }, 0)
    .set(closeBtn, { display: 'block' }, at(0.3))
    .to(circle, { strokeDashoffset: 0, duration: d(0.6), ease: 'expo.inOut' }, at(0.3))
    .to(arrows, { strokeDashoffset: 0, duration: d(0.4), stagger: RM ? 0 : 0.05, ease: 'power2.out' }, at(0.55));
  function prepPage(){
    page.forEach(function(el){ var r = el.getBoundingClientRect(), cut = Math.max(0, -r.top); gsap.set(el, { clipPath: cut ? 'inset(' + cut + 'px 0 0 0)' : 'none' }); });
  }
  function openMenu(){
    openState = true; menu.classList.add('is-open'); nav && nav.classList.add('is-open'); menu.setAttribute('aria-hidden', 'false'); menu.removeAttribute('inert'); toggle.setAttribute('aria-expanded', 'true');
    if (lenis) lenis.stop(); document.documentElement.style.overflow = 'hidden';
    if (tl.progress() === 0) { prepPage(); tl.invalidate(); }
    tl.play();
  }
  function closeMenu(){
    if (!openState) return;
    openState = false; menu.classList.remove('is-open'); nav && nav.classList.remove('is-open'); menu.setAttribute('aria-hidden', 'true'); menu.setAttribute('inert', ''); toggle.setAttribute('aria-expanded', 'false');
    if (lenis) lenis.start(); document.documentElement.style.overflow = '';
    tl.reverse();
  }
  FXS.closeMenu = closeMenu;
  toggle.addEventListener('click', function(){ if (!openState) openMenu(); });
  closeBtn.addEventListener('click', closeMenu);
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeMenu(); });
})();`,
};
export default c;
