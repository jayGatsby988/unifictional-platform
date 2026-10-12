// @ts-nocheck
// menu-4 · Header dropdown panel with image preview (Awwwards Pack).
// The header grows downward into a panel while a half-black backdrop drops
// over the page; big uppercase links rise in letter by letter, then small
// footer lines. Hovering a link blurs the others and fades in its photo.
import type { Component } from "./_types";

const c: Component = {
  id: "menu-4",
  type: "menu",
  kind: "menu",
  weight: "light",
  describe: "menu-4: clicking the burger grows the header downward into a dropdown panel in the page colour while a half-transparent black backdrop drops over the rest of the page (the page stays put, dimmed). 3-6 big uppercase page links rise into view letter by letter in a wave, then small footer lines (phone, email, area, the call to action). Hovering a link blurs and dims the others and fades in that page's photo on the right (one photo per link, desktop only). The burger crosses into an X and its label swaps Menu/Close; clicking the backdrop also closes. Light, editorial, shop-like. Fits boutiques, studios, restaurants, clinics, any site with a photo per page.",
  fields: `nav: {"links":[{"label":"Services","href":"services"}], "cta":{"label":"Get a quote","href":"contact"}}`,
  css: ({ pair, capsRule }) => `
.nav{position:fixed;inset:0 0 auto 0;z-index:50;display:flex;align-items:center;justify-content:space-between;height:76px;padding:0 var(--gutter)}
.nav__links{display:none;gap:2rem;font-size:.9rem;color:var(--ink2);transition:opacity .35s}
.nav__links a:hover,.nav__links a[aria-current]{color:var(--ink)}
@media(min-width:900px){.nav__links{display:flex}}
.nav__right{display:flex;align-items:center;gap:1.2rem}
.nav__cta{display:none}
@media(min-width:600px){.nav__cta{display:inline-flex;padding:.7em 1.2em;font-size:.85rem}}
.nav.is-open .nav__links,.nav.is-open .nav__cta{opacity:0;pointer-events:none}
.m4__toggle{display:inline-flex;align-items:center;gap:.6rem;padding:10px 0;font-family:var(--mono);font-size:.68rem;letter-spacing:.14em;text-transform:uppercase}
.m4__burger{position:relative;display:block;width:24px;height:11px}
.m4__burger b{position:absolute;left:0;width:100%;height:1.5px;background:var(--ink);transition:transform 1s var(--ease),top 1s var(--ease)}
.m4__burger b:first-child{top:0}.m4__burger b:last-child{top:9px}
.m4__toggle.is-open .m4__burger b:first-child{top:4.5px;transform:rotate(45deg)}
.m4__toggle.is-open .m4__burger b:last-child{top:4.5px;transform:rotate(-45deg)}
.m4__label{position:relative;display:inline-grid}
.m4__label em{grid-area:1/1;font-style:normal}
.m4__label em:last-child{opacity:0}
.m4__back{position:fixed;top:0;left:0;width:100%;height:0;background:rgba(0,0,0,.5);z-index:48;pointer-events:none}
.m4__back.is-open{pointer-events:auto;cursor:pointer}
.m4{position:fixed;top:0;left:0;width:100%;height:0;overflow:hidden;z-index:49;background:var(--bg);color:var(--ink);pointer-events:none}
.m4.is-open{pointer-events:auto}
.m4__scroll{padding:76px var(--gutter) 2rem;max-height:100svh;overflow:auto;overscroll-behavior:contain}
.m4__wrap{display:flex;gap:3rem;align-items:stretch}
.m4__col{flex:1;display:flex;flex-direction:column;justify-content:space-between;min-width:0}
.m4__body{display:flex;flex-wrap:wrap;margin-top:1.2rem}
.m4__link{display:flex;overflow:hidden;padding:.4rem 2vw .2rem 0;font-family:var(--display);font-weight:${pair.weight};font-size:clamp(1.9rem,8vw,2.6rem);letter-spacing:${pair.track};line-height:1.05;text-transform:uppercase;filter:blur(0px);opacity:1;will-change:filter,opacity}
.m4__link span{display:inline-block;will-change:transform,opacity}
.m4__foot{display:flex;flex-wrap:wrap;align-items:flex-end;gap:.4rem 2rem;margin-top:2.5rem;font-family:var(--mono);font-size:.66rem;letter-spacing:.14em;text-transform:uppercase}
.m4__foot ul{width:calc(50% - 1rem);overflow:hidden}
.m4__foot li{will-change:transform,opacity;padding:.2rem 0}
.m4__foot li span{color:var(--ink3);margin-right:.4em}
.m4__foot a:hover,.m4__close:hover{color:var(--accent)}
.m4__close{font:inherit;letter-spacing:inherit;text-transform:inherit}
.m4__image{display:none}
@media(min-width:1000px){
  .m4__scroll{padding-bottom:3rem}
  .m4__body{margin-top:2.5rem;max-width:1200px}
  .m4__link{font-size:5vw;padding-right:2vw}
  .m4__foot{justify-content:space-between;margin-top:3rem}
  .m4__foot ul{width:auto}
  .m4__image{display:block;position:relative;flex:0 0 clamp(320px,34vw,500px);aspect-ratio:10/9;opacity:0;overflow:hidden}
  .m4__image img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0}
}
@media(max-width:767px),(prefers-reduced-motion:reduce){.m4__link{font-size:clamp(1.7rem,7.5vw,2.4rem)}.m4__foot ul{width:100%}}
`,
  html: (_s, ctx) => {
    const { spec, esc, imgUrl, link } = ctx;
    const n = spec.nav || { links: [], cta: null };
    const b = spec.brand || {};
    const links = (n.links || []).slice(0, 6);
    const cur = (l) => l.href === ctx.page.slug ? ' aria-current="page"' : "";
    const chars = (s) => String(s).split("").map(ch => `<span>${ch === " " ? "&nbsp;" : esc(ch)}</span>`).join("");
    const menuLinks = links.map((l, i) => `<a class="m4__link" href="${esc(link(l.href))}" data-i="${i}" aria-label="${esc(l.label)}"${cur(l)}>${chars(l.label)}</a>`).join("");
    const imgs = links.map((l, i) => { const u = imgUrl(l.image, 1000); return u ? `<img src="${esc(u)}" alt="" data-i="${i}" loading="lazy">` : ""; }).join("");
    const tel = b.phone ? `<ul><li><span>Call</span><a href="${esc(link("tel:" + String(b.phone).replace(/[^+\d]/g, "")))}">${esc(b.phone)}</a></li></ul>` : "";
    const mail = b.email ? `<ul><li><span>Email</span><a href="${esc(link("mailto:" + b.email))}">${esc(b.email)}</a></li></ul>` : "";
    const area = b.city || b.serviceArea ? `<ul><li><span>Area</span>${esc(b.serviceArea || b.city)}</li></ul>` : "";
    const ctaLi = n.cta ? `<li><a href="${esc(link(n.cta.href))}">${esc(n.cta.label)} &rarr;</a></li>` : "";
    return `
<header class="nav" id="nav">
  ${ctx.brandMark()}
  <nav class="nav__links">${links.map(l => `<a href="${esc(link(l.href))}"${cur(l)}>${esc(l.label)}</a>`).join("")}</nav>
  <div class="nav__right">${n.cta ? `<a class="btn btn-primary nav__cta" href="${esc(link(n.cta.href))}">${esc(n.cta.label)}</a>` : ""}<button class="m4__toggle" id="js-toggle" aria-label="Open menu" aria-expanded="false"><i class="m4__burger"><b></b><b></b></i><span class="m4__label"><em>Menu</em><em>Close</em></span></button></div>
</header>
<div class="m4__back" id="js-m4-back" aria-hidden="true"></div>
<div class="m4" id="js-menu" aria-hidden="true" inert data-lenis-prevent>
  <div class="m4__scroll">
    <div class="m4__wrap">
      <div class="m4__col">
        <nav class="m4__body" id="js-m4-body">${menuLinks}</nav>
        <div class="m4__foot">${tel}${mail}${area}<ul>${ctaLi}<li><button class="m4__close" id="js-close" aria-label="Close menu">Close &times;</button></li></ul></div>
      </div>
      ${imgs ? `<div class="m4__image" id="js-m4-image" aria-hidden="true">${imgs}</div>` : ""}
    </div>
  </div>
</div>`;
  },
  js: () => `
(function(){
  var FXS = window.__fx, RM = FXS.RM, SMALL = FXS.SMALL, lenis = FXS.lenis;
  var menu = document.getElementById('js-menu'), toggle = document.getElementById('js-toggle'), closeBtn = document.getElementById('js-close'), back = document.getElementById('js-m4-back'), nav = document.getElementById('nav');
  if (!menu || !toggle || !window.gsap) return;
  var body = document.getElementById('js-m4-body'), links = menu.querySelectorAll('.m4__link'), chars = menu.querySelectorAll('.m4__link span'), footItems = menu.querySelectorAll('.m4__foot li');
  var labels = toggle.querySelectorAll('.m4__label em'), cta = nav ? nav.querySelector('.nav__cta') : null;
  var imgBox = document.getElementById('js-m4-image'), imgs = imgBox ? imgBox.querySelectorAll('img') : [];
  var openState = false;
  function d(n){ return RM ? 0.01 : n; }
  function at(n){ return RM ? 0 : n; }
  gsap.set(chars, { y: '100%', opacity: 0 });
  gsap.set(footItems, { y: '100%', opacity: 0 });
  var tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.inOut' } })
    .to(menu, { height: 'auto', duration: d(1) }, 0)
    .to(back, { height: '100%', duration: d(1) }, 0)
    .to(labels[0], { opacity: 0, duration: d(0.35) }, 0)
    .to(labels[1], { opacity: 1, duration: d(0.35) }, 0)
    .to(chars, { y: '0%', opacity: 1, duration: d(1), stagger: RM ? 0 : 0.02 }, at(0.2))
    .to(footItems, { y: '0%', opacity: 1, duration: d(1), stagger: RM ? 0 : 0.05 }, at(0.4));
  function resetHover(){
    gsap.to(links, { filter: 'blur(0px)', opacity: 1, duration: 0.3, overwrite: true });
    if (imgBox) gsap.to(imgBox, { opacity: 0, duration: 0.35, overwrite: true });
  }
  function openMenu(){
    openState = true; menu.classList.add('is-open'); back.classList.add('is-open'); nav && nav.classList.add('is-open'); toggle.classList.add('is-open');
    menu.setAttribute('aria-hidden', 'false'); menu.removeAttribute('inert'); toggle.setAttribute('aria-expanded', 'true');
    if (lenis) lenis.stop(); document.documentElement.style.overflow = 'hidden';
    if (tl.progress() === 0) tl.invalidate();
    tl.timeScale(1).play();
  }
  function closeMenu(){
    if (!openState) return;
    openState = false; menu.classList.remove('is-open'); back.classList.remove('is-open'); nav && nav.classList.remove('is-open'); toggle.classList.remove('is-open');
    menu.setAttribute('aria-hidden', 'true'); menu.setAttribute('inert', ''); toggle.setAttribute('aria-expanded', 'false');
    if (lenis) lenis.start(); document.documentElement.style.overflow = '';
    resetHover();
    tl.timeScale(1.6).reverse();
  }
  FXS.closeMenu = closeMenu;
  toggle.addEventListener('click', function(){ openState ? closeMenu() : openMenu(); });
  closeBtn && closeBtn.addEventListener('click', closeMenu);
  back.addEventListener('click', closeMenu);
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeMenu(); });
  if (body) {
    body.addEventListener('mouseover', function(e){
      var a = e.target.closest('.m4__link'); if (!a || SMALL) return;
      var i = a.dataset.i;
      links.forEach(function(o){ var hit = o.dataset.i === i; gsap.to(o, { filter: hit ? 'blur(0px)' : 'blur(4px)', opacity: hit ? 1 : 0.6, duration: 0.3, overwrite: true }); });
      if (imgBox && imgs.length) {
        var has = false;
        imgs.forEach(function(im){ var on = im.dataset.i === i; if (on) has = true; gsap.to(im, { opacity: on ? 1 : 0, duration: 0.35, overwrite: true }); });
        gsap.to(imgBox, { opacity: has ? 1 : 0, duration: 0.35, overwrite: true });
      }
    });
    body.addEventListener('mouseleave', resetHover);
  }
})();`,
};
export default c;
