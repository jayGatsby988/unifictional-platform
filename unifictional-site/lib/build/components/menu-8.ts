// @ts-nocheck
// menu-8 · Product-row overlay with floating thumbnail (Awwwards Pack).
// White overlay wipes down; hairlines draw, titles rise; hovering a row dims
// the rest and glides a photo into place.
import type { Component } from "./_types";

const c: Component = {
  id: "menu-8",
  type: "menu",
  kind: "menu",
  weight: "light",
  describe: "menu-8: a full-screen overlay wipes down from the top; hairlines draw and 4-6 big page titles rise one by one; hovering a title dims the others and glides a photo of that page into place. Calm, editorial. Fits trades, studios, hospitality.",
  fields: `nav: {"links":[{"label":"Services","href":"services"}], "cta":{"label":"Get a quote","href":"contact"}}`,
  css: ({ t, pair, capsRule }) => `
.nav{position:fixed;inset:0 0 auto 0;z-index:40;display:flex;align-items:center;justify-content:space-between;height:76px;padding:0 var(--gutter)}
.nav__links{display:none;gap:2rem;font-size:.9rem;color:var(--ink2)}
.nav__links a:hover,.nav__links a[aria-current]{color:var(--ink)}
@media(min-width:900px){.nav__links{display:flex}}
.nav__right{display:flex;align-items:center;gap:1rem}
.nav__cta{display:none}
@media(min-width:600px){.nav__cta{display:inline-flex;padding:.7em 1.2em;font-size:.85rem}}
.burger{display:inline-flex;flex-direction:column;gap:6px;padding:10px 0}
.burger span{width:28px;height:1.5px;background:var(--ink);transition:transform .3s var(--ease)}
.burger:hover span:first-child{transform:translateX(-4px)}.burger:hover span:last-child{transform:translateX(4px)}
.menu{position:fixed;inset:0;z-index:50;background:var(--inv-bg);color:var(--inv-ink);display:grid;grid-template-rows:auto 1fr auto;clip-path:inset(0 0 100% 0);pointer-events:none}
.menu.is-open{pointer-events:auto}
.menu__top,.menu__foot{display:flex;justify-content:space-between;align-items:center;padding:0 var(--gutter);height:76px;opacity:0}
.menu__foot{height:auto;padding:1.5rem var(--gutter);border-top:1px solid rgba(128,128,128,.25);font-family:var(--mono);font-size:.7rem;letter-spacing:.12em;text-transform:uppercase}
.menu__close{position:relative;width:44px;height:44px;transition:transform .3s var(--ease)}
.menu__close span{position:absolute;top:50%;left:50%;width:28px;height:1.5px;background:currentColor}
.menu__close span:first-child{transform:translate(-50%,-50%) rotate(45deg)}.menu__close span:last-child{transform:translate(-50%,-50%) rotate(-45deg)}
.menu__close:hover{transform:rotate(90deg)}
.rows{display:flex;flex-direction:column;justify-content:center;padding:0 var(--gutter)}
.row{display:flex;align-items:center;gap:1.5rem;padding:clamp(.6rem,2vh,1.6rem) 0;transition:opacity .3s}
.rows:has(.row:hover) .row:not(:hover){opacity:.25}
.row__line{display:block;height:1px;background:currentColor;opacity:.35;transform:scaleX(0);transform-origin:left center}
.row__title{flex-shrink:0;display:inline-flex;align-items:baseline;gap:1rem;font-family:var(--display);font-weight:${pair.weight};font-size:clamp(2rem,6vw,5.5rem);letter-spacing:${pair.track};${capsRule}white-space:nowrap;opacity:0;transform:translateY(30px)}
.row__index{font-family:var(--mono);font-size:.7rem;letter-spacing:.1em;opacity:.6}
.thumb{position:fixed;top:0;left:0;width:380px;height:250px;z-index:60;pointer-events:none;opacity:0;will-change:transform,opacity;overflow:hidden}
.thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0}
@media(max-width:768px){.thumb{display:none}}
`,
  html: (_s, ctx) => {
    const { spec, esc, imgUrl, link } = ctx;
    const n = spec.nav || { links: [], cta: null };
    const links = (n.links || []).slice(0, 6);
    const menuRows = links.map((l, i) => {
      const flexes = [[0, 1], [3, 1], [1, 3], [3, 2], [2, 2], [1, 2]][i % 6];
      const thumbX = [600, 200, 900, 150, 500, 700][i % 6], off = [200, -500, 300, -600, 0, 400][i % 6];
      return `<li class="row" data-i="${i}" data-thumb-x="${thumbX}" data-offset="${off}"><span class="row__line" style="flex:${flexes[0]}"></span><a class="row__title" href="${esc(link(l.href))}"><span class="row__index">0${i + 1}</span>${esc(l.label)}</a><span class="row__line" style="flex:${flexes[1]}"></span></li>`;
    }).join("");
    const thumbs = links.map((l, i) => `<img src="${esc(imgUrl(l.image, 800))}" alt="" data-i="${i}" loading="lazy">`).join("");
    const cur = (l) => l.href === ctx.page.slug ? ' aria-current="page"' : "";
    return `
<header class="nav" id="nav">
  ${ctx.brandMark()}
  <nav class="nav__links">${links.map(l => `<a href="${esc(link(l.href))}"${cur(l)}>${esc(l.label)}</a>`).join("")}</nav>
  <div class="nav__right">${n.cta ? `<a class="btn btn-primary nav__cta" href="${esc(link(n.cta.href))}">${esc(n.cta.label)}</a>` : ""}<button class="burger" id="js-toggle" aria-label="Open menu" aria-expanded="false"><span></span><span></span></button></div>
</header>
<div class="menu" id="js-menu" aria-hidden="true" inert>
  <div class="menu__top"><span class="nav__brand">${esc(spec.brand.name)}</span><button class="menu__close" id="js-close" aria-label="Close menu"><span></span><span></span></button></div>
  <ul class="rows" id="js-rows">${menuRows}</ul>
  <div class="thumb" id="js-thumb" aria-hidden="true">${thumbs}</div>
  <footer class="menu__foot"><span>${esc(spec.brand.city || spec.brand.industry || "")}</span><span id="js-counter">Menu</span><span>${esc(spec.brand.phone || spec.brand.email || "")}</span></footer>
</div>`;
  },
  js: () => `
(function(){
  var FXS = window.__fx, RM = FXS.RM, SMALL = FXS.SMALL, lenis = FXS.lenis;
  var menu = document.getElementById('js-menu'), toggle = document.getElementById('js-toggle'), closeBtn = document.getElementById('js-close');
  if (!menu || !toggle) return;
  var tl = null, openState = false;
  function hideThumb(){ var t = document.getElementById('js-thumb'); if (t) gsap.to(t, { opacity: 0, duration: 0.25, overwrite: 'auto' }); var c = document.getElementById('js-counter'); if (c) c.textContent = 'Menu'; }
  function closeMenu(){ if (!openState) return; openState = false; menu.classList.remove('is-open'); menu.setAttribute('aria-hidden','true'); menu.setAttribute('inert',''); toggle.setAttribute('aria-expanded','false'); if (lenis) lenis.start(); document.documentElement.style.overflow=''; hideThumb(); tl && tl.reverse(); }
  FXS.closeMenu = closeMenu;
  var rows = menu.querySelectorAll('.row'), lines = menu.querySelectorAll('.row__line'), titles = menu.querySelectorAll('.row__title');
  var top = menu.querySelector('.menu__top'), foot = menu.querySelector('.menu__foot');
  tl = gsap.timeline({ paused: true, defaults: { ease: 'power4.inOut' } })
    .fromTo(menu, { clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)', duration: RM ? 0.01 : 0.9 }, 0)
    .to([top, foot], { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' }, 0.45)
    .to(lines, { scaleX: 1, duration: 0.7, stagger: 0.05, ease: 'power3.out' }, 0.4)
    .to(titles, { opacity: 1, y: 0, duration: 0.6, stagger: 0.06, ease: 'power3.out' }, 0.5);
  gsap.set([top, foot], { opacity: 0, y: 20 });
  function openMenu(){ openState = true; menu.classList.add('is-open'); menu.setAttribute('aria-hidden','false'); menu.removeAttribute('inert'); toggle.setAttribute('aria-expanded','true'); if (lenis) lenis.stop(); document.documentElement.style.overflow='hidden'; tl.play(); }
  toggle.addEventListener('click', function(){ openState ? closeMenu() : openMenu(); });
  closeBtn && closeBtn.addEventListener('click', closeMenu);
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeMenu(); });
  var thumb = document.getElementById('js-thumb'), imgs = thumb ? thumb.querySelectorAll('img') : [], counter = document.getElementById('js-counter');
  var xTo = thumb ? gsap.quickTo(thumb, 'x', { duration: 0.5, ease: 'power3' }) : null, yTo = thumb ? gsap.quickTo(thumb, 'y', { duration: 0.5, ease: 'power3' }) : null;
  rows.forEach(function(row){
    row.addEventListener('mouseenter', function(){
      if (!thumb || SMALL) return;
      var r = menu.getBoundingClientRect();
      xTo(r.width * (+row.dataset.thumbX) / 1000 - thumb.offsetWidth / 2);
      yTo(r.height / 2 + (+row.dataset.offset) / 2.5 - thumb.offsetHeight / 2);
      gsap.to(thumb, { opacity: 1, duration: 0.3, overwrite: 'auto' });
      imgs.forEach(function(im){ gsap.to(im, { opacity: im.dataset.i === row.dataset.i ? 1 : 0, duration: 0.35, overwrite: 'auto' }); });
      if (counter) counter.textContent = '0' + (+row.dataset.i + 1) + ' / 0' + rows.length;
    });
    row.addEventListener('mouseleave', hideThumb);
  });
})();`,
};
export default c;
