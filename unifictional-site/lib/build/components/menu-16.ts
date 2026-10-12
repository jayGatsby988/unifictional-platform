// @ts-nocheck
// menu-16 · Blur-out dark menu overlay with block-wipe close (Awwwards Pack, video only).
// The page blurs and dims; a panel made of twelve near-opaque blocks appears,
// with a small label, faint column rules and wide heavy caps that rise from
// masks. Closing fades the blocks out in a scattered order, then unblurs.
import type { Component } from "./_types";

const c: Component = {
  id: "menu-16",
  type: "menu",
  kind: "menu",
  weight: "light",
  describe: "(recreated from the preview video) menu-16: clicking the MENU pill blurs and dims the whole page, then an inverse-colour panel assembles over it out of twelve rectangular blocks (4 x 3) that fade in in a scattered order. The panel carries a small 'Selected navigation' label, faint vertical column rules, and 3-6 page links in wide heavy caps at the bottom left that rise out of masks one after another; a footer line holds the call to action, phone and email. The pill becomes CLOSE x. Closing fades the blocks out in random order, uncovering the blurred page, which sharpens again. Moody, cinematic, built for dark palettes. Fits motion studios, music, nightlife, photographers, premium services.",
  fields: `nav: {"links":[{"label":"Services","href":"services"}], "cta":{"label":"Get a quote","href":"contact"}}`,
  css: ({ pair }) => `
.nav{position:fixed;inset:0 0 auto 0;z-index:40;display:flex;align-items:center;justify-content:space-between;height:76px;padding:0 var(--gutter)}
.nav__links{display:none;gap:2rem;font-size:.9rem;color:var(--ink2)}
.nav__links a:hover,.nav__links a[aria-current]{color:var(--ink)}
@media(min-width:900px){.nav__links{display:flex}}
.nav__right{display:flex;align-items:center;gap:1.2rem}
.nav__cta{display:none}
@media(min-width:600px){.nav__cta{display:inline-flex;padding:.7em 1.2em;font-size:.85rem}}
.m16__pill{display:inline-flex;align-items:center;gap:.8rem;padding:.6em .6em .6em 1.1em;border-radius:999px;border:1px solid var(--line);font-family:var(--mono);font-size:.64rem;letter-spacing:.16em;text-transform:uppercase;transition:border-color .3s,background .3s}
.m16__pill:hover{border-color:currentColor}
.m16__ic{position:relative;width:24px;height:24px;border-radius:50%;border:1px solid currentColor;display:block}
.m16__ic b{position:absolute;left:50%;top:50%;width:10px;height:1.5px;background:currentColor;transform:translate(-50%,-50%)}
.m16__pill:not(.m16__close) .m16__ic b:first-child{transform:translate(-50%,calc(-50% - 2px))}.m16__pill:not(.m16__close) .m16__ic b:last-child{transform:translate(-50%,calc(-50% + 2px))}
.m16__close .m16__ic b:first-child{transform:translate(-50%,-50%) rotate(45deg)}.m16__close .m16__ic b:last-child{transform:translate(-50%,-50%) rotate(-45deg)}
.m16{position:fixed;inset:0;z-index:50;color:var(--inv-ink);pointer-events:none}
.m16.is-open{pointer-events:auto}
.m16__blocks{position:absolute;inset:0;display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(3,1fr)}
.m16__blocks i{display:block;background:var(--inv-bg);opacity:0;will-change:opacity;margin:-1px}
.m16__content{position:relative;display:grid;grid-template-rows:76px auto 1fr auto;height:100%;background:linear-gradient(90deg,rgba(128,128,128,.22) 1px,transparent 1px) calc(var(--gutter) - 1px) 0/calc((100% - 2 * var(--gutter)) / 3) 100% no-repeat,linear-gradient(90deg,rgba(128,128,128,.22) 1px,transparent 1px) 0 0/calc((100% - 2 * var(--gutter)) / 3) 100%;background-origin:content-box;padding:0 var(--gutter);opacity:0}
.m16__top{display:flex;justify-content:space-between;align-items:center;margin:0 calc(-1 * var(--gutter));padding:0 var(--gutter)}
.m16__label{font-family:var(--mono);font-size:.62rem;letter-spacing:.2em;text-transform:uppercase;opacity:.55;padding:.5rem 0}
.m16__links{display:flex;flex-direction:column;justify-content:flex-end;padding-bottom:2vh;min-height:0}
.m16__line{overflow:hidden;padding-bottom:.06em}
.m16__line a{display:inline-block;position:relative;font-family:var(--display);font-weight:${pair.weight};font-size:clamp(2.4rem,7vw,6.4rem);line-height:1.02;letter-spacing:.02em;text-transform:uppercase;will-change:transform,opacity;transition:color .3s}
@media(any-hover:hover){.m16__line a:hover{color:var(--accent)}}
.m16__line a[aria-current]{color:var(--accent)}
.m16__foot{display:flex;justify-content:space-between;flex-wrap:wrap;gap:.6rem 2rem;margin:0 calc(-1 * var(--gutter));padding:1.4rem var(--gutter);border-top:1px solid rgba(128,128,128,.25);font-family:var(--mono);font-size:.68rem;letter-spacing:.12em;text-transform:uppercase}
.m16__foot a:hover{color:var(--accent)}
@media(max-width:767px),(prefers-reduced-motion:reduce){.m16{overflow:auto}.m16__blocks{position:fixed}.m16__content{height:auto;min-height:100%}.m16__links{padding:1.5rem 0 2rem;justify-content:flex-start}.m16__line a{font-size:clamp(2.2rem,11vw,3.6rem)}}
`,
  html: (_s, ctx) => {
    const { spec, esc, link } = ctx;
    const n = spec.nav || { links: [], cta: null };
    const b = spec.brand || {};
    const links = (n.links || []).slice(0, 6);
    const cur = (l) => l.href === ctx.page.slug ? ' aria-current="page"' : "";
    const lines = links.map(l => `<div class="m16__line"><a href="${esc(link(l.href))}"${cur(l)}>${esc(l.label)}</a></div>`).join("");
    const tel = b.phone ? `<a href="${esc(link("tel:" + String(b.phone).replace(/[^+\d]/g, "")))}">${esc(b.phone)}</a>` : "";
    const mail = b.email ? `<a href="${esc(link("mailto:" + b.email))}">${esc(b.email)}</a>` : "";
    return `
<header class="nav" id="nav">
  ${ctx.brandMark()}
  <nav class="nav__links">${links.map(l => `<a href="${esc(link(l.href))}"${cur(l)}>${esc(l.label)}</a>`).join("")}</nav>
  <div class="nav__right">${n.cta ? `<a class="btn btn-primary nav__cta" href="${esc(link(n.cta.href))}">${esc(n.cta.label)}</a>` : ""}<button class="m16__pill" id="js-toggle" aria-label="Open menu" aria-expanded="false"><span>Menu</span><i class="m16__ic"><b></b><b></b></i></button></div>
</header>
<div class="m16" id="js-menu" aria-hidden="true" inert data-lenis-prevent>
  <div class="m16__blocks" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
  <div class="m16__content">
    <div class="m16__top"><span class="nav__brand">${esc(b.name || "")}</span><button class="m16__pill m16__close" id="js-close" aria-label="Close menu"><span>Close</span><i class="m16__ic"><b></b><b></b></i></button></div>
    <div class="m16__label">Selected navigation</div>
    <nav class="m16__links">${lines}</nav>
    <div class="m16__foot"><span>${n.cta ? `<a href="${esc(link(n.cta.href))}">${esc(n.cta.label)} &rarr;</a>` : esc(b.city || "")}</span><span>${[tel, mail].filter(Boolean).join(" &middot; ")}</span></div>
  </div>
</div>`;
  },
  js: () => `
(function(){
  var FXS = window.__fx, RM = FXS.RM, FX = FXS.FX, lenis = FXS.lenis;
  var menu = document.getElementById('js-menu'), toggle = document.getElementById('js-toggle'), closeBtn = document.getElementById('js-close');
  if (!menu || !toggle || !window.gsap) return;
  var blocks = menu.querySelectorAll('.m16__blocks i'), content = menu.querySelector('.m16__content'), rises = menu.querySelectorAll('.m16__line a');
  var page = [document.querySelector('main'), document.querySelector('body > footer')].filter(Boolean);
  var openState = false;
  function d(n){ return RM ? 0.01 : n; }
  function at(n){ return RM ? 0 : n; }
  var tl = gsap.timeline({ paused: true, onReverseComplete: function(){ if (page.length) gsap.set(page, { clearProps: 'filter,opacity' }); } });
  if (FX && page.length) tl.to(page, { filter: 'blur(14px)', opacity: 0.35, duration: 0.7, ease: 'power2.out' }, 0);
  tl.to(blocks, { opacity: 1, duration: d(0.3), stagger: RM ? 0 : { each: 0.05, from: 'random' }, ease: 'power1.inOut' }, at(0.25))
    .to(content, { opacity: 1, duration: d(0.4), ease: 'power2.out' }, at(0.6))
    .fromTo(rises, { yPercent: 110, opacity: 0 }, { yPercent: 0, opacity: 1, duration: d(0.8), stagger: RM ? 0 : 0.08, ease: 'power3.out' }, at(0.65));
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
