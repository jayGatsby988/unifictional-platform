// @ts-nocheck
// menu-1 · Rotating half-panel overlay menu (Awwwards Pack).
// Two half-screen panels swing 180° around the screen centre to cover the
// page, then two columns of masked lines rise one after another.
import type { Component } from "./_types";

const c: Component = {
  id: "menu-1",
  type: "menu",
  kind: "menu",
  weight: "light",
  describe: "menu-1: a round 'Menu' button opens a full-screen overlay by swinging two half-screen panels 180 degrees around the centre of the screen until the page is covered; then two columns rise line by line out of masks: the page links and call to action on the left, contact details (phone, email, city, address) and social links on the right. Text only, no images; 3-7 short link labels work best. Theatrical, editorial. Fits galleries, studios, boutiques, restaurants, premium services.",
  fields: `nav: {"links":[{"label":"Services","href":"services"}], "cta":{"label":"Get a quote","href":"contact"}}`,
  css: ({ pair, capsRule }) => `
.nav{position:fixed;inset:0 0 auto 0;z-index:40;display:flex;align-items:center;justify-content:space-between;height:76px;padding:0 var(--gutter)}
.nav__links{display:none;gap:2rem;font-size:.9rem;color:var(--ink2)}
.nav__links a:hover,.nav__links a[aria-current]{color:var(--ink)}
@media(min-width:900px){.nav__links{display:flex}}
.nav__right{display:flex;align-items:center;gap:1rem}
.nav__cta{display:none}
@media(min-width:600px){.nav__cta{display:inline-flex;padding:.7em 1.2em;font-size:.85rem}}
.burger,.m1__close{display:inline-flex;align-items:center;justify-content:center;width:58px;height:58px;border:1px solid var(--line);border-radius:50%;background:var(--bg2);color:var(--ink);font-family:var(--mono);font-size:.6rem;letter-spacing:.14em;text-transform:uppercase;transition:transform .5s var(--ease-out),background .3s,color .3s}
.burger:hover,.m1__close:hover{transform:scale(1.08)}
.m1{position:fixed;inset:0;z-index:50;color:var(--inv-ink);pointer-events:none;overflow:hidden}
.m1.is-open{pointer-events:auto}
.m1__bg{position:absolute;inset:0}
.m1__side{position:absolute;top:0;bottom:0;width:50%;overflow:hidden}
.m1__side--l{left:0}.m1__side--r{right:0}
.m1__box{position:absolute;inset:0;background:var(--inv-bg);will-change:transform}
.m1__box--l{transform-origin:100% 50%;transform:rotate(180deg) scale(2)}
.m1__box--r{transform-origin:0% 50%;transform:rotate(180deg) scale(2)}
.m1__content{position:absolute;inset:0;display:grid;grid-template-rows:76px 1fr}
.m1__top{display:flex;justify-content:space-between;align-items:center;padding:0 var(--gutter);opacity:0}
.m1__close{border-color:rgba(128,128,128,.4);background:transparent;color:var(--inv-ink)}
.m1__cols{display:flex;min-height:0}
.m1__col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:clamp(.5rem,1.6vh,1.2rem);padding:1rem var(--gutter) 2rem;text-align:center}
.m1__line{display:block;overflow:hidden;padding:0 .12em .1em}
.m1__line>span{display:block;transform:translateY(110%);will-change:transform}
.m1__link{font-family:var(--display);font-weight:${pair.weight};font-size:clamp(1.7rem,3.4vw,3.4rem);letter-spacing:${pair.track};line-height:1.1;${capsRule}transition:opacity .3s}
.m1__link[aria-current],.m1__col--links:hover .m1__link:hover{opacity:1}
.m1__col--links:hover .m1__link:not(:hover){opacity:.4}
.m1__cta{margin-top:1rem;border-color:rgba(128,128,128,.4)}
.m1__label{font-family:var(--mono);font-size:.66rem;letter-spacing:.14em;text-transform:uppercase;opacity:.6;margin-top:1.2rem}
.m1__label:first-child{margin-top:0}
.m1__info{font-size:clamp(1rem,1.5vw,1.35rem);line-height:1.4}
.m1__info a:hover{text-decoration:underline;text-underline-offset:.2em}
.m1__socials{display:flex;flex-wrap:wrap;justify-content:center;gap:.4rem 1.4rem;font-family:var(--mono);font-size:.7rem;letter-spacing:.14em;text-transform:uppercase}
@media(max-width:767px){.m1{overflow:auto}.m1__bg{position:fixed}.m1__side--r{display:none}.m1__side--l{width:100%}.m1__content{position:relative;height:auto;min-height:100%}.m1__cols{flex-direction:column;padding-bottom:3rem}.m1__col{align-items:flex-start;text-align:left;justify-content:flex-start;padding-top:.5rem}.m1__socials{justify-content:flex-start}.m1__link{font-size:clamp(1.9rem,8vw,2.8rem)}}
`,
  html: (_s, ctx) => {
    const { spec, esc, link } = ctx;
    const n = spec.nav || { links: [], cta: null };
    const b = spec.brand || {};
    const links = (n.links || []).slice(0, 7);
    const cur = (l) => l.href === ctx.page.slug ? ' aria-current="page"' : "";
    const social = Object.entries(b.social || {}).filter(([, v]) => v && /^https?:/i.test(String(v))).slice(0, 6);
    const line = (inner) => `<span class="m1__line"><span>${inner}</span></span>`;
    const menuLinks = links.map(l => `<a class="m1__link" href="${esc(link(l.href))}"${cur(l)}>${line(esc(l.label))}</a>`).join("");
    const cta = n.cta ? `<span class="m1__line"><span><a class="btn btn-ghost m1__cta" href="${esc(link(n.cta.href))}">${esc(n.cta.label)}${ctx.arrow}</a></span></span>` : "";
    const info = [];
    if (b.phone) info.push(`<a class="m1__info" href="${esc(link("tel:" + String(b.phone).replace(/[^+\d]/g, "")))}">${line(esc(b.phone))}</a>`);
    if (b.email) info.push(`<a class="m1__info" href="${esc(link("mailto:" + b.email))}">${line(esc(b.email))}</a>`);
    if (b.address) info.push(`<span class="m1__info">${line(esc(b.address))}</span>`);
    if (b.city) info.push(`<span class="m1__info">${line(esc(b.city))}</span>`);
    if (b.hours) info.push(`<span class="m1__info">${line(esc(b.hours))}</span>`);
    const socials = social.length ? `<p class="m1__label">${line("Follow")}</p><div class="m1__socials">${social.map(([k, v]) => `<a href="${esc(link(v))}" target="_blank" rel="noopener">${line(esc(k))}</a>`).join("")}</div>` : "";
    return `
<header class="nav" id="nav">
  ${ctx.brandMark()}
  <nav class="nav__links">${links.map(l => `<a href="${esc(link(l.href))}"${cur(l)}>${esc(l.label)}</a>`).join("")}</nav>
  <div class="nav__right">${n.cta ? `<a class="btn btn-primary nav__cta" href="${esc(link(n.cta.href))}">${esc(n.cta.label)}</a>` : ""}<button class="burger" id="js-toggle" aria-label="Open menu" aria-expanded="false">Menu</button></div>
</header>
<div class="m1" id="js-menu" aria-hidden="true" inert data-lenis-prevent>
  <div class="m1__bg" aria-hidden="true"><div class="m1__side m1__side--l"><div class="m1__box m1__box--l"></div></div><div class="m1__side m1__side--r"><div class="m1__box m1__box--r"></div></div></div>
  <div class="m1__content">
    <div class="m1__top"><span class="nav__brand">${esc(b.name || "")}</span><button class="m1__close" id="js-close" aria-label="Close menu">Close</button></div>
    <div class="m1__cols">
      <nav class="m1__col m1__col--links">${menuLinks}${cta}</nav>
      <div class="m1__col m1__col--info">${info.length ? `<p class="m1__label">${line("Contact")}</p>${info.join("")}` : ""}${socials}</div>
    </div>
  </div>
</div>`;
  },
  js: () => `
(function(){
  var FXS = window.__fx, RM = FXS.RM, lenis = FXS.lenis;
  var menu = document.getElementById('js-menu'), toggle = document.getElementById('js-toggle'), closeBtn = document.getElementById('js-close');
  if (!menu || !toggle || !window.gsap) return;
  var boxL = menu.querySelector('.m1__box--l'), boxR = menu.querySelector('.m1__box--r'), top = menu.querySelector('.m1__top');
  var lines = menu.querySelectorAll('.m1__line > span');
  var openState = false;
  function d(n){ return RM ? 0.01 : n; }
  function at(n){ return RM ? 0 : n; }
  var swing = 'power4.inOut';
  if (window.CustomEase) { CustomEase.create('m1jump', '0.85, 0, 0.15, 1'); swing = 'm1jump'; }
  var tl = gsap.timeline({ paused: true })
    .fromTo([boxL, boxR], { rotation: 180, scale: 2 }, { rotation: 0, scale: 2, duration: d(1), ease: swing }, 0)
    .to(top, { opacity: 1, duration: d(0.5), ease: 'power2.out' }, at(0.6))
    .fromTo(lines, { y: 0, yPercent: 110 }, { yPercent: 0, duration: d(0.75), stagger: RM ? 0 : 0.08, ease: 'power3.out' }, at(0.6));
  function openMenu(){
    openState = true; menu.classList.add('is-open'); menu.setAttribute('aria-hidden', 'false'); menu.removeAttribute('inert'); toggle.setAttribute('aria-expanded', 'true');
    if (lenis) lenis.stop(); document.documentElement.style.overflow = 'hidden';
    tl.timeScale(1).play();
  }
  function closeMenu(){
    if (!openState) return;
    openState = false; menu.classList.remove('is-open'); menu.setAttribute('aria-hidden', 'true'); menu.setAttribute('inert', ''); toggle.setAttribute('aria-expanded', 'false');
    if (lenis) lenis.start(); document.documentElement.style.overflow = '';
    tl.timeScale(1.8).reverse();
  }
  FXS.closeMenu = closeMenu;
  toggle.addEventListener('click', function(){ openState ? closeMenu() : openMenu(); });
  closeBtn && closeBtn.addEventListener('click', closeMenu);
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeMenu(); });
})();`,
};
export default c;
