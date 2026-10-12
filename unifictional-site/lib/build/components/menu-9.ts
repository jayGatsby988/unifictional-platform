// @ts-nocheck
// menu-9 · Jelly sheet menu with accent-hover links (Awwwards Pack, video only).
// A rounded inverse-colour sheet drops from the top with an elastic settle,
// stopping just inside the viewport; numbered rows with hairlines and a small
// icon stagger in. Hovering a row turns it accent and swells its icon.
import type { Component } from "./_types";

const ICONS = [
  `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="4"/><circle cx="12" cy="19" r="4"/><circle cx="5" cy="12" r="4"/><circle cx="19" cy="12" r="4"/><circle cx="12" cy="12" r="3" fill="var(--inv-bg)"/></svg>`,
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="8"/></svg>`,
  `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="7"/></svg>`,
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/></svg>`,
  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.6 6.4L21 11l-6.4 2.6L12 20l-2.6-6.4L3 11l6.4-2.6z"/></svg>`,
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><rect x="5" y="5" width="14" height="14" rx="3"/></svg>`,
];

const c: Component = {
  id: "menu-9",
  type: "menu",
  kind: "menu",
  weight: "light",
  describe: "(recreated from the preview video) menu-9: a pill button top right (a coloured dot plus the word Menu) drops a big rounded inverse-colour sheet from the top of the screen; it lands with a soft jelly overshoot and stops about 10px inside the viewport on every side. 3-6 page rows stagger in: a small index number, the page name in large display type, a hairline rule, and a small icon at the right (flower, ring, dot, asterisk). Hovering a row turns its text the accent colour and swells its icon. The call to action and phone sit in the sheet's footer. Closing slides the rows away and lifts the sheet. Playful, bouncy, friendly. Fits creative studios, cafes, kids' brands, fitness, anything cheerful.",
  fields: `nav: {"links":[{"label":"Services","href":"services"}], "cta":{"label":"Get a quote","href":"contact"}}`,
  css: ({ pair, capsRule }) => `
.nav{position:fixed;inset:0 0 auto 0;z-index:40;display:flex;align-items:center;justify-content:space-between;height:76px;padding:0 var(--gutter)}
.nav__links{display:none;gap:2rem;font-size:.9rem;color:var(--ink2)}
.nav__links a:hover,.nav__links a[aria-current]{color:var(--ink)}
@media(min-width:900px){.nav__links{display:flex}}
.nav__right{display:flex;align-items:center;gap:1.2rem}
.nav__cta{display:none}
@media(min-width:600px){.nav__cta{display:inline-flex;padding:.7em 1.2em;font-size:.85rem}}
.m9__pill{display:inline-flex;align-items:center;gap:.6rem;padding:.55em 1.1em .55em .7em;border-radius:999px;border:1px solid var(--line);font-family:var(--mono);font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;transition:border-color .3s,transform .4s var(--ease)}
.m9__pill:hover{border-color:currentColor;transform:scale(1.04)}
.m9__dot{width:14px;height:14px;border-radius:50%;background:var(--accent);transition:background .3s,transform .4s var(--ease)}
.m9__pill:hover .m9__dot{background:currentColor;transform:scale(1.2)}
.m9{position:fixed;inset:0;z-index:50;pointer-events:none}
.m9.is-open{pointer-events:auto}
.m9__sheet{position:absolute;inset:10px;border-radius:clamp(18px,2.5vw,32px);background:var(--inv-bg);color:var(--inv-ink);display:grid;grid-template-rows:66px 1fr auto;transform:translateY(-110%);will-change:transform;overflow:hidden}
.m9__sheet .m9__pill{border-color:rgba(128,128,128,.4)}
.m9__top{display:flex;justify-content:space-between;align-items:center;padding:0 calc(var(--gutter) - 10px);opacity:0}
.m9__rows{display:flex;flex-direction:column;justify-content:center;padding:0 clamp(1rem,8vw,8rem);min-height:0}
.m9__row{opacity:0;border-bottom:1px solid rgba(128,128,128,.3)}
.m9__row a{display:grid;grid-template-columns:2.5rem 1fr auto;align-items:center;gap:1rem;padding:clamp(.4rem,1.6vh,1rem) 0;transition:color .25s}
.m9__num{font-family:var(--mono);font-size:.62rem;letter-spacing:.12em;opacity:.45}
.m9__label{font-family:var(--display);font-weight:${pair.weight};font-size:clamp(2rem,6vw,4.6rem);line-height:1.05;letter-spacing:${pair.track};${capsRule}}
.m9__icon{display:block;width:clamp(16px,1.5vw,22px);height:clamp(16px,1.5vw,22px);transition:transform .45s cubic-bezier(.34,1.56,.64,1),color .25s;opacity:.85}
.m9__icon svg{width:100%;height:100%;display:block}
@media(any-hover:hover){.m9__row a:hover{color:var(--accent)}.m9__row a:hover .m9__icon{transform:scale(1.5) rotate(20deg);opacity:1}}
.m9__row a[aria-current]{color:var(--accent)}
.m9__foot{display:flex;justify-content:space-between;flex-wrap:wrap;gap:.6rem 2rem;padding:1.2rem calc(var(--gutter) - 10px);font-family:var(--mono);font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;opacity:0}
.m9__foot a:hover{color:var(--accent)}
@media(max-width:767px),(prefers-reduced-motion:reduce){.m9__sheet{inset:8px;overflow:auto;grid-template-rows:60px auto auto;align-content:start}.m9__rows{padding:1rem 1.2rem}.m9__label{font-size:clamp(1.8rem,8vw,2.6rem)}.m9__row a{grid-template-columns:2rem 1fr auto}}
`,
  html: (_s, ctx) => {
    const { spec, esc, link } = ctx;
    const n = spec.nav || { links: [], cta: null };
    const b = spec.brand || {};
    const links = (n.links || []).slice(0, 6);
    const cur = (l) => l.href === ctx.page.slug ? ' aria-current="page"' : "";
    const rows = links.map((l, i) => `<li class="m9__row"><a href="${esc(link(l.href))}"${cur(l)}><span class="m9__num">0${i + 1}</span><span class="m9__label">${esc(l.label)}</span><i class="m9__icon" aria-hidden="true">${ICONS[i % ICONS.length]}</i></a></li>`).join("");
    const tel = b.phone ? `<a href="${esc(link("tel:" + String(b.phone).replace(/[^+\d]/g, "")))}">${esc(b.phone)}</a>` : "";
    const mail = b.email ? `<a href="${esc(link("mailto:" + b.email))}">${esc(b.email)}</a>` : "";
    return `
<header class="nav" id="nav">
  ${ctx.brandMark()}
  <nav class="nav__links">${links.map(l => `<a href="${esc(link(l.href))}"${cur(l)}>${esc(l.label)}</a>`).join("")}</nav>
  <div class="nav__right">${n.cta ? `<a class="btn btn-primary nav__cta" href="${esc(link(n.cta.href))}">${esc(n.cta.label)}</a>` : ""}<button class="m9__pill" id="js-toggle" aria-label="Open menu" aria-expanded="false"><i class="m9__dot"></i><span>Menu</span></button></div>
</header>
<div class="m9" id="js-menu" aria-hidden="true" inert data-lenis-prevent>
  <div class="m9__sheet">
    <div class="m9__top"><span class="nav__brand">${esc(b.name || "")}</span><button class="m9__pill" id="js-close" aria-label="Close menu"><i class="m9__dot"></i><span>Close</span></button></div>
    <ul class="m9__rows">${rows}</ul>
    <div class="m9__foot"><span>${n.cta ? `<a href="${esc(link(n.cta.href))}">${esc(n.cta.label)} &rarr;</a>` : esc(b.city || "")}</span><span>${[tel, mail].filter(Boolean).join(" &middot; ")}</span></div>
  </div>
</div>`;
  },
  js: () => `
(function(){
  var FXS = window.__fx, RM = FXS.RM, lenis = FXS.lenis;
  var menu = document.getElementById('js-menu'), toggle = document.getElementById('js-toggle'), closeBtn = document.getElementById('js-close');
  if (!menu || !toggle || !window.gsap) return;
  var sheet = menu.querySelector('.m9__sheet'), rows = menu.querySelectorAll('.m9__row'), top = menu.querySelector('.m9__top'), foot = menu.querySelector('.m9__foot');
  var all = [sheet, top, foot].concat(Array.prototype.slice.call(rows));
  var openState = false;
  function d(n){ return RM ? 0.01 : n; }
  function at(n){ return RM ? 0 : n; }
  gsap.set(sheet, { y: 0, yPercent: -110 });
  function openMenu(){
    openState = true; menu.classList.add('is-open'); menu.setAttribute('aria-hidden', 'false'); menu.removeAttribute('inert'); toggle.setAttribute('aria-expanded', 'true');
    if (lenis) lenis.stop(); document.documentElement.style.overflow = 'hidden';
    gsap.killTweensOf(all);
    gsap.timeline()
      .to(sheet, { yPercent: 0, duration: d(1.1), ease: RM ? 'none' : 'elastic.out(1, 0.7)' }, 0)
      .fromTo(rows, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: d(0.6), stagger: RM ? 0 : 0.07, ease: 'power3.out' }, at(0.3))
      .fromTo([top, foot], { opacity: 0 }, { opacity: 1, duration: d(0.45), ease: 'power2.out' }, at(0.35));
  }
  function closeMenu(){
    if (!openState) return;
    openState = false; menu.classList.remove('is-open'); menu.setAttribute('aria-hidden', 'true'); menu.setAttribute('inert', ''); toggle.setAttribute('aria-expanded', 'false');
    if (lenis) lenis.start(); document.documentElement.style.overflow = '';
    gsap.killTweensOf(all);
    gsap.timeline()
      .to(rows, { y: -30, opacity: 0, duration: d(0.3), stagger: RM ? 0 : 0.04, ease: 'power2.in' }, 0)
      .to([top, foot], { opacity: 0, duration: d(0.25) }, 0)
      .to(sheet, { yPercent: -110, duration: d(0.55), ease: 'power3.in' }, at(0.15));
  }
  FXS.closeMenu = closeMenu;
  toggle.addEventListener('click', function(){ openState ? closeMenu() : openMenu(); });
  closeBtn && closeBtn.addEventListener('click', closeMenu);
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeMenu(); });
})();`,
};
export default c;
