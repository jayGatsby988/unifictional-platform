// @ts-nocheck
// menu-7 · Curved-edge curtain menu from a round toggle (Awwwards Pack, video only).
// A full-screen SVG sheet drops from the top with a convex curved bottom
// edge (one path, its d tweened between same-structure strings), then big
// condensed links and small italic links rise out of masked lines.
import type { Component } from "./_types";

const c: Component = {
  id: "menu-7",
  type: "menu",
  kind: "menu",
  weight: "light",
  describe: "(recreated from the preview video) menu-7: a thin round button top right (a dash inside a circle) drops an inverse-colour sheet from the top of the screen; its bottom edge bulges into a convex curve as it falls and flattens as it lands, about a second. Then the first three page links rise out of masked lines as very large display caps on the left, and the remaining links plus the call to action rise as small italic lines on the right; a footer line carries phone and email. The round button becomes an X; closing lifts the sheet with the curve trailing while the text clips away. Calm, typographic, gallery-like. Fits photographers, authors, architects, boutiques, restaurants.",
  fields: `nav: {"links":[{"label":"Services","href":"services"}], "cta":{"label":"Get a quote","href":"contact"}}`,
  css: ({ pair, capsRule }) => `
.nav{position:fixed;inset:0 0 auto 0;z-index:40;display:flex;align-items:center;justify-content:space-between;height:76px;padding:0 var(--gutter)}
.nav__links{display:none;gap:2rem;font-size:.9rem;color:var(--ink2)}
.nav__links a:hover,.nav__links a[aria-current]{color:var(--ink)}
@media(min-width:900px){.nav__links{display:flex}}
.nav__right{display:flex;align-items:center;gap:1.2rem}
.nav__cta{display:none}
@media(min-width:600px){.nav__cta{display:inline-flex;padding:.7em 1.2em;font-size:.85rem}}
.m7__round{position:relative;width:44px;height:44px;border-radius:50%;border:1px solid var(--ink3);transition:border-color .3s,transform .4s var(--ease)}
.m7__round:hover{border-color:currentColor;transform:scale(1.06)}
.m7__round span{position:absolute;top:50%;left:50%;width:14px;height:1.5px;background:currentColor;transform:translate(-50%,-50%)}
.m7__close span:first-child{transform:translate(-50%,-50%) rotate(45deg)}.m7__close span:last-child{transform:translate(-50%,-50%) rotate(-45deg)}
.m7{position:fixed;inset:0;z-index:50;color:var(--inv-ink);pointer-events:none}
.m7.is-open{pointer-events:auto}
.m7__sheet{position:fixed;inset:0;width:100%;height:100%;display:block}
.m7__sheet path{fill:var(--inv-bg)}
.m7__content{position:relative;display:grid;grid-template-rows:76px 1fr auto;height:100%}
.m7__top{display:flex;justify-content:space-between;align-items:center;padding:0 var(--gutter);opacity:0}
.m7__cols{display:grid;grid-template-columns:3fr 2fr;gap:2rem;padding:1rem var(--gutter);align-items:center}
.m7__primary,.m7__secondary{display:flex;flex-direction:column}
.m7__secondary{gap:.5rem;align-items:flex-start;padding-left:10%}
.m7__line{overflow:hidden;padding-bottom:.08em}
.m7__line a{display:inline-block;position:relative;will-change:transform}
.m7__primary a{font-family:var(--display);font-weight:${pair.weight};font-size:clamp(2.8rem,8.5vw,8rem);line-height:1;letter-spacing:${pair.track};text-transform:uppercase;transition:color .3s}
.m7__secondary a{font-family:var(--body);font-style:italic;font-size:clamp(1rem,1.4vw,1.3rem);transition:color .3s}
.m7__secondary .m7__line--cta{margin-top:1.6rem}
.m7 a:hover,.m7 a[aria-current]{color:var(--accent)}
.m7__foot{display:flex;justify-content:space-between;flex-wrap:wrap;gap:.6rem 2rem;padding:1.4rem var(--gutter);font-family:var(--mono);font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;opacity:0}
@media(max-width:899px){.m7__cols{grid-template-columns:1fr;align-content:center;gap:2.5rem}.m7__secondary{padding-left:0}}
@media(max-width:767px),(prefers-reduced-motion:reduce){.m7{overflow:auto}.m7__content{height:auto;min-height:100%}.m7__cols{padding:1.5rem var(--gutter) 2rem}.m7__primary a{font-size:clamp(2.6rem,13vw,4rem)}}
`,
  html: (_s, ctx) => {
    const { spec, esc, link } = ctx;
    const n = spec.nav || { links: [], cta: null };
    const b = spec.brand || {};
    const links = (n.links || []).slice(0, 7);
    const cur = (l) => l.href === ctx.page.slug ? ' aria-current="page"' : "";
    const big = links.slice(0, 3), small = links.slice(3);
    const primary = big.map(l => `<div class="m7__line"><a href="${esc(link(l.href))}"${cur(l)}>${esc(l.label)}</a></div>`).join("");
    const secondary = small.map(l => `<div class="m7__line"><a href="${esc(link(l.href))}"${cur(l)}>${esc(l.label)}</a></div>`).join("") + (n.cta ? `<div class="m7__line m7__line--cta"><a href="${esc(link(n.cta.href))}">${esc(n.cta.label)} &rarr;</a></div>` : "");
    const tel = b.phone ? `<a href="${esc(link("tel:" + String(b.phone).replace(/[^+\d]/g, "")))}">${esc(b.phone)}</a>` : "";
    const mail = b.email ? `<a href="${esc(link("mailto:" + b.email))}">${esc(b.email)}</a>` : "";
    return `
<header class="nav" id="nav">
  ${ctx.brandMark()}
  <nav class="nav__links">${links.map(l => `<a href="${esc(link(l.href))}"${cur(l)}>${esc(l.label)}</a>`).join("")}</nav>
  <div class="nav__right">${n.cta ? `<a class="btn btn-primary nav__cta" href="${esc(link(n.cta.href))}">${esc(n.cta.label)}</a>` : ""}<button class="m7__round" id="js-toggle" aria-label="Open menu" aria-expanded="false"><span></span></button></div>
</header>
<div class="m7" id="js-menu" aria-hidden="true" inert data-lenis-prevent>
  <svg class="m7__sheet" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path id="js-m7-path" d="M0 0 V0 Q50 0 100 0 V0 Z"/></svg>
  <div class="m7__content">
    <div class="m7__top"><span class="nav__brand">${esc(b.name || "")}</span><button class="m7__round m7__close" id="js-close" aria-label="Close menu"><span></span><span></span></button></div>
    <div class="m7__cols">
      <nav class="m7__primary">${primary}</nav>
      <nav class="m7__secondary">${secondary}</nav>
    </div>
    <div class="m7__foot"><span>${esc(b.tagline || b.city || "")}</span><span>${[tel, mail].filter(Boolean).join(" &middot; ")}</span></div>
  </div>
</div>`;
  },
  js: () => `
(function(){
  var FXS = window.__fx, RM = FXS.RM, lenis = FXS.lenis;
  var menu = document.getElementById('js-menu'), toggle = document.getElementById('js-toggle'), closeBtn = document.getElementById('js-close'), path = document.getElementById('js-m7-path');
  if (!menu || !toggle || !path || !window.gsap) return;
  var top = menu.querySelector('.m7__top'), foot = menu.querySelector('.m7__foot'), rises = menu.querySelectorAll('.m7__line a');
  var CLOSED = 'M0 0 V0 Q50 0 100 0 V0 Z', MID = 'M0 0 V58 Q50 112 100 58 V0 Z', OPEN = 'M0 0 V100 Q50 100 100 100 V0 Z';
  var openState = false;
  function d(n){ return RM ? 0.01 : n; }
  function at(n){ return RM ? 0 : n; }
  var tl = gsap.timeline({ paused: true })
    .to(path, { attr: { d: MID }, duration: d(0.5), ease: 'power2.in' }, 0)
    .to(path, { attr: { d: OPEN }, duration: d(0.5), ease: 'power2.out' }, at(0.5))
    .to([top, foot], { opacity: 1, duration: d(0.5), ease: 'power2.out' }, at(0.7))
    .fromTo(rises, { yPercent: 110 }, { yPercent: 0, duration: d(0.9), stagger: RM ? 0 : 0.08, ease: 'power3.out' }, at(0.6));
  function openMenu(){
    openState = true; menu.classList.add('is-open'); menu.setAttribute('aria-hidden', 'false'); menu.removeAttribute('inert'); toggle.setAttribute('aria-expanded', 'true');
    if (lenis) lenis.stop(); document.documentElement.style.overflow = 'hidden';
    tl.timeScale(1).play();
  }
  function closeMenu(){
    if (!openState) return;
    openState = false; menu.classList.remove('is-open'); menu.setAttribute('aria-hidden', 'true'); menu.setAttribute('inert', ''); toggle.setAttribute('aria-expanded', 'false');
    if (lenis) lenis.start(); document.documentElement.style.overflow = '';
    tl.timeScale(1.5).reverse();
  }
  FXS.closeMenu = closeMenu;
  toggle.addEventListener('click', function(){ openState ? closeMenu() : openMenu(); });
  closeBtn && closeBtn.addEventListener('click', closeMenu);
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeMenu(); });
})();`,
};
export default c;
