// @ts-nocheck
// menu-18 · Layered colour-wipe dropdown menu (Awwwards Pack).
// Four flat colour layers wipe down from the top one after another, then a
// panel is clipped open beneath them; four link groups slide up out of masks
// while the burger bars cross into an X. The header stays above the panel.
import type { Component } from "./_types";

const c: Component = {
  id: "menu-18",
  type: "menu",
  kind: "menu",
  weight: "light",
  describe: "menu-18: clicking the two-bar burger sends four flat colour layers (tints of the accent and the inverse background) wiping down from the top one after another, then a panel in a deep accent tint is clipped open beneath them. Inside, four text groups slide up out of masks in sequence: social links and contact lines on the left, 3-6 large page links and a column of secondary links (taken from the footer columns) on the right. On desktop the panel is only as tall as its content, so the page stays visible, dimmed, below it; under 1000px it fills the screen. The header stays on top, its burger crossing into an X. Text only, no photos. Punchy, graphic. Fits agencies, software, studios, events.",
  fields: `nav: {"links":[{"label":"Services","href":"services"}], "cta":{"label":"Get a quote","href":"contact"}}`,
  css: ({ pair, capsRule }) => `
.nav{position:fixed;inset:0 0 auto 0;z-index:51;display:flex;align-items:center;justify-content:space-between;height:76px;padding:0 var(--gutter);transition:color .4s}
.nav__links{display:none;gap:2rem;font-size:.9rem;color:var(--ink2);transition:opacity .3s}
.nav__links a:hover,.nav__links a[aria-current]{color:var(--ink)}
@media(min-width:900px){.nav__links{display:flex}}
.nav__right{display:flex;align-items:center;gap:1.2rem}
.nav__cta{display:none;transition:opacity .3s}
@media(min-width:600px){.nav__cta{display:inline-flex;padding:.7em 1.2em;font-size:.85rem}}
.nav.is-open{color:var(--inv-ink)}
.nav.is-open .nav__links,.nav.is-open .nav__cta{opacity:0;pointer-events:none}
.m18__toggle{display:flex;flex-direction:column;justify-content:center;align-items:center;gap:6px;padding:10px 0}
.m18__toggle span{display:block;width:34px;height:2px;background:currentColor;transition:transform .4s var(--ease)}
.m18__toggle.is-open span:first-child{transform:translateY(4px) rotate(45deg) scaleX(.75)}
.m18__toggle.is-open span:last-child{transform:translateY(-4px) rotate(-45deg) scaleX(.75)}
.m18{position:fixed;top:0;left:0;width:100%;z-index:50;pointer-events:none;color:var(--inv-ink)}
.m18.is-open{pointer-events:auto}
.m18__bg{position:absolute;inset:0;transform:scaleY(0);transform-origin:top;will-change:transform}
.m18__bg:nth-child(1){background:color-mix(in oklab,var(--accent) 70%,var(--inv-ink))}
.m18__bg:nth-child(2){background:var(--inv-bg)}
.m18__bg:nth-child(3){background:color-mix(in oklab,var(--accent) 45%,var(--inv-bg))}
.m18__bg:nth-child(4){background:var(--accent)}
.m18__items{position:relative;display:flex;gap:2rem;padding:7rem var(--gutter) 4rem;background:color-mix(in oklab,var(--accent) 22%,var(--inv-bg));clip-path:polygon(0% 0%,100% 0%,100% 0%,0% 0%);will-change:clip-path}
.m18__col--a{flex:2;display:flex;flex-direction:column;justify-content:space-between;gap:2rem}
.m18__col--b{flex:4;display:flex;gap:2rem;justify-content:space-between}
.m18__line{overflow:hidden;margin-bottom:.45rem}
.m18__line a,.m18__line span,.m18__line button{display:block;position:relative;transform:translateY(100%);will-change:transform;line-height:1.15;letter-spacing:-.01em}
.m18__line button{font:inherit;text-align:left}
.m18__socials a{font-size:1.15rem}
.m18__contact a,.m18__contact span{font-size:.9rem;color:color-mix(in oklab,var(--inv-ink) 70%,var(--accent))}
.m18__primary a{font-family:var(--display);font-weight:${pair.weight};font-size:clamp(2rem,3.4vw,3rem);letter-spacing:${pair.track};line-height:1.05;${capsRule}}
.m18__secondary a{font-size:1.35rem}
.m18__items a:hover,.m18__close:hover{color:var(--accent)}
.m18__primary a[aria-current]{color:var(--accent)}
.m18__close{font-family:var(--mono);font-size:.68rem;letter-spacing:.14em;text-transform:uppercase}
@media(max-width:999px){
  .m18,.m18__items{height:100svh}
  .m18__items{flex-direction:column;justify-content:center;gap:2.5rem;padding:5rem var(--gutter) 2rem;overflow:auto}
  .m18__col--a,.m18__col--b{flex:none}
  .m18__col--a{order:2;flex-direction:row;flex-wrap:wrap;justify-content:flex-start;gap:1.5rem 3rem}
  .m18__col--b{flex-direction:column;gap:1.5rem}
  .m18__secondary{display:none}
  .m18__primary a{font-size:clamp(2.2rem,9vw,3.4rem)}
}
`,
  html: (_s, ctx) => {
    const { spec, esc, link } = ctx;
    const n = spec.nav || { links: [], cta: null };
    const b = spec.brand || {};
    const links = (n.links || []).slice(0, 6);
    const cur = (l) => l.href === ctx.page.slug ? ' aria-current="page"' : "";
    const navHrefs = new Set(links.map(l => l.href));
    const secondary = ((spec.footer || {}).columns || []).flatMap(c => c.links || []).filter(l => l && l.href && !navHrefs.has(l.href)).slice(0, 6);
    const social = Object.entries(b.social || {}).filter(([, v]) => v && /^https?:/i.test(String(v))).slice(0, 6);
    const line = (inner) => `<div class="m18__line">${inner}</div>`;
    const socials = social.map(([k, v]) => line(`<a href="${esc(link(v))}" target="_blank" rel="noopener">${esc(k)}</a>`)).join("");
    const contact = [
      n.cta ? line(`<a href="${esc(link(n.cta.href))}">${esc(n.cta.label)} &rarr;</a>`) : "",
      b.phone ? line(`<a href="${esc(link("tel:" + String(b.phone).replace(/[^+\d]/g, "")))}">${esc(b.phone)}</a>`) : "",
      b.email ? line(`<a href="${esc(link("mailto:" + b.email))}">${esc(b.email)}</a>`) : "",
      b.city ? line(`<span>${esc(b.city)}</span>`) : "",
      line(`<button class="m18__close" id="js-close" aria-label="Close menu">Close &times;</button>`),
    ].join("");
    const primary = links.map(l => line(`<a href="${esc(link(l.href))}"${cur(l)}>${esc(l.label)}</a>`)).join("");
    const sec = secondary.map(l => line(`<a href="${esc(link(l.href))}">${esc(l.label)}</a>`)).join("");
    return `
<header class="nav" id="nav">
  ${ctx.brandMark()}
  <nav class="nav__links">${links.map(l => `<a href="${esc(link(l.href))}"${cur(l)}>${esc(l.label)}</a>`).join("")}</nav>
  <div class="nav__right">${n.cta ? `<a class="btn btn-primary nav__cta" href="${esc(link(n.cta.href))}">${esc(n.cta.label)}</a>` : ""}<button class="m18__toggle" id="js-toggle" aria-label="Open menu" aria-expanded="false"><span></span><span></span></button></div>
</header>
<div class="m18" id="js-menu" aria-hidden="true" inert data-lenis-prevent>
  <i class="m18__bg"></i><i class="m18__bg"></i><i class="m18__bg"></i><i class="m18__bg"></i>
  <div class="m18__items">
    <div class="m18__col m18__col--a">
      ${socials ? `<div class="m18__socials">${socials}</div>` : ""}
      <div class="m18__contact">${contact}</div>
    </div>
    <div class="m18__col m18__col--b">
      <nav class="m18__primary">${primary}</nav>
      ${sec ? `<div class="m18__secondary">${sec}</div>` : ""}
    </div>
  </div>
</div>`;
  },
  js: () => `
(function(){
  var FXS = window.__fx, RM = FXS.RM, lenis = FXS.lenis;
  var menu = document.getElementById('js-menu'), toggle = document.getElementById('js-toggle'), closeBtn = document.getElementById('js-close'), nav = document.getElementById('nav');
  if (!menu || !toggle || !window.gsap) return;
  var bgs = menu.querySelectorAll('.m18__bg'), items = menu.querySelector('.m18__items');
  var groups = [menu.querySelectorAll('.m18__socials .m18__line > *, .m18__contact .m18__line > *'), menu.querySelectorAll('.m18__primary .m18__line > *'), menu.querySelectorAll('.m18__secondary .m18__line > *')];
  var openState = false;
  function d(n){ return RM ? 0.01 : n; }
  function at(n){ return RM ? 0 : n; }
  var tl = gsap.timeline({ paused: true, onReverseComplete: function(){ nav && nav.classList.remove('is-open'); } });
  tl.to(bgs, { scaleY: 1, duration: d(0.75), stagger: RM ? 0 : 0.1, ease: 'power3.inOut' }, 0)
    .to(items, { clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)', duration: d(0.75), ease: 'power3.inOut' }, at(0.45));
  groups.forEach(function(g){ if (g.length) tl.fromTo(g, { y: '100%' }, { y: '0%', duration: d(0.75), stagger: RM ? 0 : 0.05, ease: 'power3.out' }, at(0.85)); });
  function openMenu(){
    openState = true; menu.classList.add('is-open'); toggle.classList.add('is-open'); nav && nav.classList.add('is-open');
    menu.setAttribute('aria-hidden', 'false'); menu.removeAttribute('inert'); toggle.setAttribute('aria-expanded', 'true');
    if (lenis) lenis.stop(); document.documentElement.style.overflow = 'hidden';
    tl.timeScale(1).play();
  }
  function closeMenu(){
    if (!openState) return;
    openState = false; menu.classList.remove('is-open'); toggle.classList.remove('is-open');
    menu.setAttribute('aria-hidden', 'true'); menu.setAttribute('inert', ''); toggle.setAttribute('aria-expanded', 'false');
    if (lenis) lenis.start(); document.documentElement.style.overflow = '';
    tl.timeScale(1.6).reverse();
  }
  FXS.closeMenu = closeMenu;
  toggle.addEventListener('click', function(){ openState ? closeMenu() : openMenu(); });
  closeBtn && closeBtn.addEventListener('click', closeMenu);
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeMenu(); });
})();`,
};
export default c;
