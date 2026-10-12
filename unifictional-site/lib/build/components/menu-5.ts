// @ts-nocheck
// menu-5 · Stair-bar wipe overlay with marquee hover (Awwwards Pack).
// Five columns drop in from the right, huge links flip down, and hovering a
// link wipes in an inverted strip carrying an endless marquee of image pills.
import type { Component } from "./_types";

const c: Component = {
  id: "menu-5",
  type: "menu",
  kind: "menu",
  weight: "light",
  describe: "menu-5: a block-shaped 'Menu' button makes five full-height columns drop from the top, rightmost first, until the screen is covered in the inverse colour; a close cross slides in and 3-6 huge one-or-two-word page links flip down into place between hairlines, with the call to action and social links as pills at the bottom. Hovering a link wipes an inverted strip over it from the side the cursor came from, carrying an endless marquee of that page's photo as a pill and the link's name (one photo per link; no hover strips on phones). Loud, graphic, poster-like. Fits agencies, event spaces, gyms, bars, streetwear and bold trades.",
  fields: `nav: {"links":[{"label":"Services","href":"services"}], "cta":{"label":"Get a quote","href":"contact"}}`,
  css: ({ pair, capsRule }) => `
.nav{position:fixed;inset:0 0 auto 0;z-index:40;display:flex;align-items:center;justify-content:space-between;height:76px;padding:0 var(--gutter)}
.nav__links{display:none;gap:2rem;font-size:.9rem;color:var(--ink2)}
.nav__links a:hover,.nav__links a[aria-current]{color:var(--ink)}
@media(min-width:900px){.nav__links{display:flex}}
.nav__right{display:flex;align-items:center;gap:1rem}
.nav__cta{display:none}
@media(min-width:600px){.nav__cta{display:inline-flex;padding:.7em 1.2em;font-size:.85rem}}
.burger{position:relative;display:inline-flex;flex-direction:column;justify-content:center;gap:8px;min-width:112px;height:54px;padding:0 1rem;background:var(--inv-bg);color:var(--inv-ink);overflow:hidden;font-family:var(--mono);font-size:.66rem;letter-spacing:.14em;text-transform:uppercase;transition:color .4s}
.burger::before{content:"";position:absolute;left:0;right:0;top:0;height:0;background:var(--accent);transition:height .3s var(--ease)}
.burger>*{position:relative;z-index:1}
.burger i{display:flex;flex-direction:column;gap:5px}
.burger b{display:block;height:1.5px;width:32px;background:currentColor}
.burger b:last-child{width:16px}
.burger:hover{color:var(--on-accent)}.burger:hover::before{height:100%}
@media(max-width:599px){.burger{min-width:0;padding:0 .8rem}.burger span{display:none}}
.m5{position:fixed;inset:0;z-index:50;color:var(--inv-ink);pointer-events:none}
.m5.is-open{pointer-events:auto}
.m5__stairs{position:absolute;inset:0;display:flex;pointer-events:none}
.m5__bar{width:20.5%;height:0;background:var(--inv-bg)}
.m5__bar:last-child{width:18%}
.m5__bg{position:absolute;inset:0;background:var(--inv-bg);opacity:0}
.m5__panel{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:space-between;opacity:0}
.m5__top{display:flex;justify-content:space-between;align-items:center;height:76px;padding:0 var(--gutter);flex-shrink:0}
.m5__close{width:48px;height:48px;display:inline-flex;align-items:center;justify-content:center;transition:color .3s}
.m5__close svg{width:30px;height:30px;display:block}
.m5__close:hover{color:var(--accent)}
.m5__body{width:100%}
.m5__item{position:relative;display:flex;justify-content:center;border-top:1px solid rgba(128,128,128,.4);perspective:80vw;overflow:hidden}
.m5__item:last-child{border-bottom:1px solid rgba(128,128,128,.4)}
.m5__link{display:block;font-family:var(--display);font-weight:${pair.weight};font-size:clamp(2.4rem,7.4vw,8rem);line-height:1.08;letter-spacing:${pair.track};${capsRule}padding:.03em .2em;transform-origin:top;white-space:nowrap}
.m5__link[aria-current]{text-decoration:underline;text-decoration-thickness:.04em;text-underline-offset:.08em}
.m5__outer{position:absolute;inset:0;overflow:hidden;pointer-events:none}
.m5__inner{position:absolute;inset:0;display:flex;align-items:center;background:var(--inv-ink);color:var(--inv-bg);white-space:nowrap;font-family:var(--display);font-weight:${pair.weight};font-size:clamp(2.4rem,7.4vw,8rem);line-height:1.08;letter-spacing:${pair.track};${capsRule}}
.m5__track{display:flex;align-items:center;flex-shrink:0;animation:m5-marquee 14s linear infinite;animation-play-state:paused}
.m5__item:hover .m5__track{animation-play-state:running}
.m5__track span{padding:0 .2em}
.m5__pill{height:.72em;width:1.9em;border-radius:999px;overflow:hidden;flex-shrink:0;margin:0 .1em}
.m5__pill img{width:100%;height:100%;object-fit:cover}
.m5__foot{display:flex;justify-content:center;align-items:center;flex-wrap:wrap;gap:.6rem;padding:1.4rem var(--gutter);opacity:0;flex-shrink:0}
.m5__foot a{font-family:var(--mono);font-size:.66rem;letter-spacing:.14em;text-transform:uppercase;border:1px solid currentColor;border-radius:999px;padding:.7em 1.2em;transition:background .3s,color .3s}
.m5__foot a:hover,.m5__foot a.is-cta{background:var(--inv-ink);color:var(--inv-bg)}
.m5__foot a.is-cta:hover{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
@keyframes m5-marquee{from{transform:translate3d(0,0,0)}to{transform:translate3d(-100%,0,0)}}
@media(max-width:767px),(prefers-reduced-motion:reduce){.m5__outer{display:none}.m5__panel{overflow:auto}.m5__body{padding:1rem 0}.m5__link{font-size:clamp(2rem,10vw,3.4rem);white-space:normal;text-align:center}}
`,
  html: (_s, ctx) => {
    const { spec, esc, imgUrl, link } = ctx;
    const n = spec.nav || { links: [], cta: null };
    const b = spec.brand || {};
    const links = (n.links || []).slice(0, 6);
    const cur = (l) => l.href === ctx.page.slug ? ' aria-current="page"' : "";
    const social = Object.entries(b.social || {}).filter(([, v]) => v && /^https?:/i.test(String(v))).slice(0, 5);
    const track = (l) => {
      const src = imgUrl(l.image, 600);
      const unit = `${src ? `<span class="m5__pill"><img src="${esc(src)}" alt="" loading="lazy"></span>` : `<span>&middot;</span>`}<span>${esc(l.label)}</span>`;
      return `<div class="m5__track">${unit}${unit}${unit}</div>`;
    };
    const items = links.map(l => `<div class="m5__item"><a class="m5__link" href="${esc(link(l.href))}"${cur(l)}>${esc(l.label)}</a><div class="m5__outer" aria-hidden="true"><div class="m5__inner">${track(l)}${track(l)}</div></div></div>`).join("");
    const foot = [n.cta ? `<a class="is-cta" href="${esc(link(n.cta.href))}">${esc(n.cta.label)}</a>` : "", ...social.map(([k, v]) => `<a href="${esc(link(v))}" target="_blank" rel="noopener">${esc(k)}</a>`)].filter(Boolean).join("");
    return `
<header class="nav" id="nav">
  ${ctx.brandMark()}
  <nav class="nav__links">${links.map(l => `<a href="${esc(link(l.href))}"${cur(l)}>${esc(l.label)}</a>`).join("")}</nav>
  <div class="nav__right">${n.cta ? `<a class="btn btn-primary nav__cta" href="${esc(link(n.cta.href))}">${esc(n.cta.label)}</a>` : ""}<button class="burger" id="js-toggle" aria-label="Open menu" aria-expanded="false"><i><b></b><b></b></i><span>Menu</span></button></div>
</header>
<div class="m5" id="js-menu" aria-hidden="true" inert data-lenis-prevent>
  <div class="m5__stairs" aria-hidden="true"><div class="m5__bar"></div><div class="m5__bar"></div><div class="m5__bar"></div><div class="m5__bar"></div><div class="m5__bar"></div><div class="m5__bg"></div></div>
  <div class="m5__panel">
    <div class="m5__top"><span class="nav__brand">${esc(b.name || "")}</span><button class="m5__close" id="js-close" aria-label="Close menu"><svg viewBox="0 0 68 68" fill="none" aria-hidden="true"><path d="M1.5 1.5L67 67M66.5 1L1 66.5" stroke="currentColor" stroke-width="2"/></svg></button></div>
    <div class="m5__body">${items}</div>
    <div class="m5__foot">${foot}</div>
  </div>
</div>`;
  },
  js: () => `
(function(){
  var FXS = window.__fx, RM = FXS.RM, SMALL = FXS.SMALL, lenis = FXS.lenis;
  var menu = document.getElementById('js-menu'), toggle = document.getElementById('js-toggle'), closeBtn = document.getElementById('js-close');
  if (!menu || !toggle || !window.gsap) return;
  var bars = menu.querySelectorAll('.m5__bar'), bg = menu.querySelector('.m5__bg'), panel = menu.querySelector('.m5__panel');
  var links = menu.querySelectorAll('.m5__link'), foot = menu.querySelector('.m5__foot');
  var openState = false;
  function d(n){ return RM ? 0.01 : n; }
  function at(n){ return RM ? 0 : n; }
  var tl = gsap.timeline({ paused: true, defaults: { ease: 'power2.out' } })
    .fromTo(bars, { height: '0%' }, { height: '100%', duration: d(0.5), stagger: RM ? 0 : { each: 0.05, from: 'end' } }, 0)
    .to(bg, { opacity: 1, duration: d(0.4) }, at(0.35))
    .to(panel, { opacity: 1, duration: d(0.5) }, at(0.4))
    .fromTo(closeBtn, { x: 150 }, { x: 0, duration: d(0.5) }, at(0.4))
    .fromTo(links, { rotationX: 90, opacity: 0 }, { rotationX: 0, opacity: 1, duration: d(0.5), stagger: RM ? 0 : 0.05 }, at(0.6))
    .to(foot, { opacity: 1, duration: d(0.5) }, at(0.9));
  function openMenu(){
    openState = true; menu.classList.add('is-open'); menu.setAttribute('aria-hidden', 'false'); menu.removeAttribute('inert'); toggle.setAttribute('aria-expanded', 'true');
    if (lenis) lenis.stop(); document.documentElement.style.overflow = 'hidden';
    tl.play();
  }
  function closeMenu(){
    if (!openState) return;
    openState = false; menu.classList.remove('is-open'); menu.setAttribute('aria-hidden', 'true'); menu.setAttribute('inert', ''); toggle.setAttribute('aria-expanded', 'false');
    if (lenis) lenis.start(); document.documentElement.style.overflow = '';
    tl.reverse();
  }
  FXS.closeMenu = closeMenu;
  toggle.addEventListener('click', function(){ openState ? closeMenu() : openMenu(); });
  closeBtn && closeBtn.addEventListener('click', closeMenu);
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeMenu(); });
  menu.querySelectorAll('.m5__item').forEach(function(item){
    var outer = item.querySelector('.m5__outer'), inner = item.querySelector('.m5__inner');
    if (!outer || !inner) return;
    gsap.set(outer, { yPercent: 100 }); gsap.set(inner, { yPercent: -100 });
    function side(e){ var r = item.getBoundingClientRect(); return e.clientY < r.top + r.height / 2 ? -100 : 100; }
    item.addEventListener('mouseenter', function(e){
      if (SMALL || !openState) return;
      var s = side(e);
      gsap.set(outer, { yPercent: s }); gsap.set(inner, { yPercent: -s });
      gsap.to([outer, inner], { yPercent: 0, duration: 0.3, overwrite: true });
    });
    item.addEventListener('mouseleave', function(e){
      if (SMALL) return;
      var s = side(e);
      gsap.to(outer, { yPercent: s, duration: 0.3, overwrite: true });
      gsap.to(inner, { yPercent: -s, duration: 0.3, overwrite: true });
    });
  });
})();`,
};
export default c;
