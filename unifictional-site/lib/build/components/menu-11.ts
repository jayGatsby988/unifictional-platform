// @ts-nocheck
// menu-11 · Staggered colour-column curtain menu (Awwwards Pack, video only).
// Six full-height columns in tints of the tokens scale down from the top in a
// left-to-right stagger until they tile the screen; huge heavy caps rise line
// by line on the left. Reversing the timeline lifts the columns right-first.
import type { Component } from "./_types";

const c: Component = {
  id: "menu-11",
  type: "menu",
  kind: "menu",
  weight: "light",
  describe: "(recreated from the preview video) menu-11: clicking the MENU pill makes six full-height colour columns grow down from the top one after another, left to right, until they tile the whole screen; the columns are tints of the accent and the inverse background, not fixed colours. Then 3-6 huge heavy uppercase page links rise line by line on the left, over the columns, with a footer line for the call to action, phone and email. Closing slides the text up and lifts the columns with ragged bottom edges, right-most first, about a second each way. Loud, graphic, poster-like. Fits creative studios, events, streetwear, bars, bold trades.",
  fields: `nav: {"links":[{"label":"Services","href":"services"}], "cta":{"label":"Get a quote","href":"contact"}}`,
  css: ({ pair }) => `
.nav{position:fixed;inset:0 0 auto 0;z-index:40;display:flex;align-items:center;justify-content:space-between;height:76px;padding:0 var(--gutter)}
.nav__links{display:none;gap:2rem;font-size:.9rem;color:var(--ink2)}
.nav__links a:hover,.nav__links a[aria-current]{color:var(--ink)}
@media(min-width:900px){.nav__links{display:flex}}
.nav__right{display:flex;align-items:center;gap:1.2rem}
.nav__cta{display:none}
@media(min-width:600px){.nav__cta{display:inline-flex;padding:.7em 1.2em;font-size:.85rem}}
.m11__pill{display:inline-flex;align-items:center;padding:.6em 1.2em;border-radius:999px;background:var(--ink);color:var(--bg);font-family:var(--mono);font-size:.66rem;letter-spacing:.16em;text-transform:uppercase;transition:background .3s,color .3s,transform .4s var(--ease)}
.m11__pill:hover{background:var(--accent);color:var(--on-accent);transform:scale(1.05)}
.m11{position:fixed;inset:0;z-index:50;color:var(--inv-ink);pointer-events:none;overflow:hidden}
.m11.is-open{pointer-events:auto}
.m11__cols{position:absolute;inset:0;display:flex}
.m11__cols i{flex:1;transform:scaleY(0);transform-origin:top;will-change:transform;margin-right:-1px}
.m11__cols i:nth-child(1){background:color-mix(in oklab,var(--accent) 55%,var(--inv-bg))}
.m11__cols i:nth-child(2){background:var(--accent)}
.m11__cols i:nth-child(3){background:color-mix(in oklab,var(--accent) 30%,var(--inv-bg))}
.m11__cols i:nth-child(4){background:color-mix(in oklab,var(--accent) 45%,var(--ink))}
.m11__cols i:nth-child(5){background:color-mix(in oklab,var(--accent) 80%,var(--inv-ink))}
.m11__cols i:nth-child(6){background:var(--inv-bg)}
.m11__content{position:relative;display:grid;grid-template-rows:76px 1fr auto;height:100%}
.m11__top{display:flex;justify-content:space-between;align-items:center;padding:0 var(--gutter);opacity:0}
.m11__top .m11__pill{background:var(--inv-ink);color:var(--inv-bg)}
.m11__top .m11__pill:hover{background:var(--accent);color:var(--on-accent)}
.m11__links{display:flex;flex-direction:column;justify-content:center;padding:0 var(--gutter);min-height:0}
.m11__line{overflow:hidden;padding-bottom:.04em}
.m11__line a{display:inline-block;position:relative;font-family:var(--display);font-weight:${pair.weight};font-size:clamp(2.6rem,8.6vw,8rem);line-height:.98;letter-spacing:-.02em;text-transform:uppercase;will-change:transform;transition:color .3s;text-shadow:0 1px 0 rgba(0,0,0,.08)}
@media(any-hover:hover){.m11__line a:hover{color:var(--accent)}}
.m11__line a[aria-current]{opacity:.7}
.m11__foot{display:flex;justify-content:space-between;flex-wrap:wrap;gap:.6rem 2rem;padding:1.4rem var(--gutter);font-family:var(--mono);font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;opacity:0}
.m11__foot a:hover{color:var(--accent)}
@media(max-width:767px),(prefers-reduced-motion:reduce){.m11{overflow:auto}.m11__cols{position:fixed}.m11__content{height:auto;min-height:100%}.m11__links{padding:1.5rem var(--gutter) 2rem}.m11__line a{font-size:clamp(2.4rem,12vw,4rem)}}
`,
  html: (_s, ctx) => {
    const { spec, esc, link } = ctx;
    const n = spec.nav || { links: [], cta: null };
    const b = spec.brand || {};
    const links = (n.links || []).slice(0, 6);
    const cur = (l) => l.href === ctx.page.slug ? ' aria-current="page"' : "";
    const lines = links.map(l => `<div class="m11__line"><a href="${esc(link(l.href))}"${cur(l)}>${esc(l.label)}</a></div>`).join("");
    const tel = b.phone ? `<a href="${esc(link("tel:" + String(b.phone).replace(/[^+\d]/g, "")))}">${esc(b.phone)}</a>` : "";
    const mail = b.email ? `<a href="${esc(link("mailto:" + b.email))}">${esc(b.email)}</a>` : "";
    return `
<header class="nav" id="nav">
  ${ctx.brandMark()}
  <nav class="nav__links">${links.map(l => `<a href="${esc(link(l.href))}"${cur(l)}>${esc(l.label)}</a>`).join("")}</nav>
  <div class="nav__right">${n.cta ? `<a class="btn btn-primary nav__cta" href="${esc(link(n.cta.href))}">${esc(n.cta.label)}</a>` : ""}<button class="m11__pill" id="js-toggle" aria-label="Open menu" aria-expanded="false">Menu</button></div>
</header>
<div class="m11" id="js-menu" aria-hidden="true" inert data-lenis-prevent>
  <div class="m11__cols" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
  <div class="m11__content">
    <div class="m11__top"><span class="nav__brand">${esc(b.name || "")}</span><button class="m11__pill" id="js-close" aria-label="Close menu">Close</button></div>
    <nav class="m11__links">${lines}</nav>
    <div class="m11__foot"><span>${n.cta ? `<a href="${esc(link(n.cta.href))}">${esc(n.cta.label)} &rarr;</a>` : esc(b.city || "")}</span><span>${[tel, mail].filter(Boolean).join(" &middot; ")}</span></div>
  </div>
</div>`;
  },
  js: () => `
(function(){
  var FXS = window.__fx, RM = FXS.RM, lenis = FXS.lenis;
  var menu = document.getElementById('js-menu'), toggle = document.getElementById('js-toggle'), closeBtn = document.getElementById('js-close');
  if (!menu || !toggle || !window.gsap) return;
  var cols = menu.querySelectorAll('.m11__cols i'), rises = menu.querySelectorAll('.m11__line a'), top = menu.querySelector('.m11__top'), foot = menu.querySelector('.m11__foot');
  var openState = false;
  function d(n){ return RM ? 0.01 : n; }
  function at(n){ return RM ? 0 : n; }
  var tl = gsap.timeline({ paused: true })
    .to(cols, { scaleY: 1, duration: d(0.8), stagger: RM ? 0 : 0.08, ease: 'power4.inOut' }, 0)
    .fromTo(rises, { yPercent: 110 }, { yPercent: 0, duration: d(0.9), stagger: RM ? 0 : 0.06, ease: 'power3.out' }, at(0.6))
    .to([top, foot], { opacity: 1, duration: d(0.45), ease: 'power2.out' }, at(0.85));
  function openMenu(){
    openState = true; menu.classList.add('is-open'); menu.setAttribute('aria-hidden', 'false'); menu.removeAttribute('inert'); toggle.setAttribute('aria-expanded', 'true');
    if (lenis) lenis.stop(); document.documentElement.style.overflow = 'hidden';
    tl.timeScale(1).play();
  }
  function closeMenu(){
    if (!openState) return;
    openState = false; menu.classList.remove('is-open'); menu.setAttribute('aria-hidden', 'true'); menu.setAttribute('inert', ''); toggle.setAttribute('aria-expanded', 'false');
    if (lenis) lenis.start(); document.documentElement.style.overflow = '';
    tl.timeScale(1.4).reverse();
  }
  FXS.closeMenu = closeMenu;
  toggle.addEventListener('click', function(){ openState ? closeMenu() : openMenu(); });
  closeBtn && closeBtn.addEventListener('click', closeMenu);
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeMenu(); });
})();`,
};
export default c;
