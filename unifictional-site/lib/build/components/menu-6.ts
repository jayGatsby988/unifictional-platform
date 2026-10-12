// @ts-nocheck
// menu-6 · Slanted clip-path overlay with page tilt (Awwwards Pack).
// A dark overlay wipes down on a slant while the page behind rotates, grows
// and slides away; the menu settles from a tilted state, links rise from
// masks and hovering a link swaps in a rotating preview photo.
import type { Component } from "./_types";

const c: Component = {
  id: "menu-6",
  type: "menu",
  kind: "menu",
  weight: "light",
  describe: "menu-6: a dark full-screen overlay wipes down from the top with a slanted lower edge while the page behind it tilts 10 degrees, grows and slides away; the menu settles in from a tilted, dimmed state, then 3-6 large page links and the social links rise out of masks. Hovering a link swaps in that page's preview photo, which scales and un-rotates onto the last one (one photo per link; thumbnails hidden on phones). A footer line carries the call to action, phone and email. Cinematic and bold. Fits studios, architects, agencies, premium trades.",
  fields: `nav: {"links":[{"label":"Services","href":"services"}], "cta":{"label":"Get a quote","href":"contact"}}`,
  css: ({ pair, capsRule }) => `
.nav{position:fixed;inset:0 0 auto 0;z-index:40;display:flex;align-items:center;justify-content:space-between;height:76px;padding:0 var(--gutter)}
.nav__links{display:none;gap:2rem;font-size:.9rem;color:var(--ink2)}
.nav__links a:hover,.nav__links a[aria-current]{color:var(--ink)}
@media(min-width:900px){.nav__links{display:flex}}
.nav__right{display:flex;align-items:center;gap:1.2rem}
.nav__cta{display:none}
@media(min-width:600px){.nav__cta{display:inline-flex;padding:.7em 1.2em;font-size:.85rem}}
.burger{display:inline-flex;align-items:center;gap:.8rem;padding:10px 0;font-family:var(--mono);font-size:.68rem;letter-spacing:.14em;text-transform:uppercase}
.burger i{display:flex;flex-direction:column;gap:6px}
.burger b{display:block;width:28px;height:1.5px;background:var(--ink);transition:transform .3s var(--ease)}
.burger:hover b:first-child{transform:translateX(-4px)}.burger:hover b:last-child{transform:translateX(4px)}
.m6{position:fixed;inset:0;z-index:50;background:var(--inv-bg);color:var(--inv-ink);clip-path:polygon(0% 0%,100% 0%,100% 0%,0% 0%);pointer-events:none;overflow:hidden}
.m6.is-open{pointer-events:auto}
.m6__content{position:relative;display:grid;grid-template-rows:76px 1fr auto;height:100%;transform-origin:left bottom;opacity:.25;transform:translate(-6.25rem,-6.25rem) scale(1.5) rotate(-15deg);will-change:transform,opacity}
.m6__top{display:flex;justify-content:space-between;align-items:center;padding:0 var(--gutter);opacity:0}
.m6__close{position:relative;width:44px;height:44px;transition:transform .3s var(--ease)}
.m6__close span{position:absolute;top:50%;left:50%;width:28px;height:1.5px;background:currentColor}
.m6__close span:first-child{transform:translate(-50%,-50%) rotate(45deg)}.m6__close span:last-child{transform:translate(-50%,-50%) rotate(-45deg)}
.m6__close:hover{transform:rotate(90deg)}
.m6__items{display:flex;gap:2.5rem;padding:.5rem var(--gutter);min-height:0}
.m6__col-lg{flex:3;display:flex;align-items:center;justify-content:center}
.m6__col-sm{flex:2;display:flex;flex-direction:column;justify-content:center;gap:2.2rem}
.m6__preview{position:relative;overflow:hidden;width:clamp(220px,26vw,420px);height:clamp(280px,58vh,560px)}
.m6__preview:empty{display:none}
.m6__preview img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;will-change:transform,opacity}
.m6__links,.m6__socials{display:flex;flex-direction:column;gap:.35rem}
.m6__link,.m6__social{clip-path:inset(0 0 -3px 0);padding-bottom:.3rem}
.m6__link a,.m6__social a{position:relative;display:inline-block;opacity:.25;transform:translateY(120%);will-change:transform}
.m6__link a{font-family:var(--display);font-weight:${pair.weight};font-size:clamp(2.2rem,5vw,4rem);letter-spacing:${pair.track};line-height:1.05;${capsRule}}
.m6__social a{font-family:var(--mono);font-size:.7rem;letter-spacing:.14em;text-transform:uppercase}
.m6__link a::after,.m6__social a::after,.m6__foot a::after{content:"";position:absolute;left:0;bottom:-2px;width:100%;height:2px;background:currentColor;transform:scaleX(0);transform-origin:right;transition:transform .3s cubic-bezier(.6,0,.4,1)}
@media(any-hover:hover){.m6__link a:hover::after,.m6__social a:hover::after,.m6__foot a:hover::after{transform:scaleX(1);transform-origin:left}}
.m6__foot{display:flex;justify-content:space-between;flex-wrap:wrap;gap:1rem 2rem;padding:1.5rem var(--gutter);border-top:1px solid rgba(128,128,128,.25);font-family:var(--mono);font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;opacity:0}
.m6__foot a{position:relative;display:inline-block}
@media(max-width:899px){.m6__col-lg{display:none}}
@media(max-width:767px),(prefers-reduced-motion:reduce){.m6{overflow:auto}.m6__content{height:auto;min-height:100%}.m6__items{padding:1.5rem var(--gutter) 2.5rem}.m6__link a{font-size:clamp(2rem,9vw,3rem)}}
`,
  html: (_s, ctx) => {
    const { spec, esc, imgUrl, link } = ctx;
    const n = spec.nav || { links: [], cta: null };
    const b = spec.brand || {};
    const links = (n.links || []).slice(0, 6);
    const cur = (l) => l.href === ctx.page.slug ? ' aria-current="page"' : "";
    const social = Object.entries(b.social || {}).filter(([, v]) => v && /^https?:/i.test(String(v))).slice(0, 5);
    const first = links.find(l => imgUrl(l.image, 900));
    const menuLinks = links.map(l => `<div class="m6__link"><a href="${esc(link(l.href))}" data-img="${esc(imgUrl(l.image, 900))}"${cur(l)}>${esc(l.label)}</a></div>`).join("");
    const socials = social.map(([k, v]) => `<div class="m6__social"><a href="${esc(link(v))}" target="_blank" rel="noopener">${esc(k)}</a></div>`).join("");
    const tel = b.phone ? `<a href="${esc(link("tel:" + String(b.phone).replace(/[^+\d]/g, "")))}">${esc(b.phone)}</a>` : "";
    const mail = b.email ? `<a href="${esc(link("mailto:" + b.email))}">${esc(b.email)}</a>` : "";
    return `
<header class="nav" id="nav">
  ${ctx.brandMark()}
  <nav class="nav__links">${links.map(l => `<a href="${esc(link(l.href))}"${cur(l)}>${esc(l.label)}</a>`).join("")}</nav>
  <div class="nav__right">${n.cta ? `<a class="btn btn-primary nav__cta" href="${esc(link(n.cta.href))}">${esc(n.cta.label)}</a>` : ""}<button class="burger" id="js-toggle" aria-label="Open menu" aria-expanded="false"><span>Menu</span><i><b></b><b></b></i></button></div>
</header>
<div class="m6" id="js-menu" aria-hidden="true" inert data-lenis-prevent>
  <div class="m6__content">
    <div class="m6__top"><span class="nav__brand">${esc(b.name || "")}</span><button class="m6__close" id="js-close" aria-label="Close menu"><span></span><span></span></button></div>
    <div class="m6__items">
      <div class="m6__col-lg"><div class="m6__preview" id="js-preview" aria-hidden="true">${first ? `<img src="${esc(imgUrl(first.image, 900))}" alt="" loading="lazy">` : ""}</div></div>
      <div class="m6__col-sm"><nav class="m6__links">${menuLinks}</nav>${socials ? `<div class="m6__socials">${socials}</div>` : ""}</div>
    </div>
    <div class="m6__foot"><span>${n.cta ? `<a href="${esc(link(n.cta.href))}">${esc(n.cta.label)}</a>` : esc(b.city || "")}</span><span>${[tel, mail].filter(Boolean).join(" &middot; ")}</span></div>
  </div>
</div>`;
  },
  js: () => `
(function(){
  var FXS = window.__fx, RM = FXS.RM, SMALL = FXS.SMALL, FX = FXS.FX, lenis = FXS.lenis;
  var menu = document.getElementById('js-menu'), toggle = document.getElementById('js-toggle'), closeBtn = document.getElementById('js-close');
  if (!menu || !toggle || !window.gsap) return;
  var content = menu.querySelector('.m6__content'), top = menu.querySelector('.m6__top'), foot = menu.querySelector('.m6__foot');
  var rises = menu.querySelectorAll('.m6__link a, .m6__social a');
  var preview = document.getElementById('js-preview');
  var page = [document.querySelector('main'), document.querySelector('body > footer')].filter(Boolean);
  var openState = false;
  function d(n){ return RM ? 0.01 : n; }
  function at(n){ return RM ? 0 : n; }
  var firstSrc = preview && preview.querySelector('img') ? preview.querySelector('img').getAttribute('src') : '';
  function resetPreview(){ if (!preview) return; preview.innerHTML = ''; if (firstSrc) { var im = document.createElement('img'); im.src = firstSrc; im.alt = ''; preview.appendChild(im); } }
  function showPreview(src){
    if (!preview || !src || SMALL || !openState) return;
    var imgs = preview.querySelectorAll('img');
    if (imgs.length && imgs[imgs.length - 1].getAttribute('src') === src) return;
    var im = document.createElement('img'); im.src = src; im.alt = '';
    gsap.set(im, { opacity: 0, scale: 1.25, rotation: 10 });
    preview.appendChild(im);
    imgs = preview.querySelectorAll('img');
    for (var i = 0; i < imgs.length - 3; i++) preview.removeChild(imgs[i]);
    gsap.to(im, { opacity: 1, scale: 1, rotation: 0, duration: 0.75, ease: 'power2.out' });
  }
  var tl = gsap.timeline({ paused: true, defaults: { ease: 'power4.inOut' }, onReverseComplete: function(){ if (page.length) gsap.set(page, { clearProps: 'transform,transformOrigin,clipPath' }); resetPreview(); } });
  tl.fromTo(menu, { clipPath: 'polygon(0% 0%, 100% 0%, 100% 0%, 0% 0%)' }, { clipPath: 'polygon(0% 0%, 100% 0%, 100% 175%, 0% 100%)', duration: d(1.25) }, 0)
    .fromTo(content, { x: -100, y: -100, scale: 1.5, rotation: -15, opacity: 0.25, transformOrigin: 'left bottom' }, { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, duration: d(1.25) }, 0)
    .to([top, foot], { opacity: 1, duration: d(0.6), ease: 'power2.out' }, at(0.7))
    .fromTo(rises, { y: 0, yPercent: 120, opacity: 0.25 }, { yPercent: 0, opacity: 1, duration: d(1), stagger: RM ? 0 : 0.1, ease: 'power3.out' }, at(0.75));
  if (FX && page.length) tl.to(page, { rotation: 10, x: function(){ return Math.round(window.innerWidth * 0.15); }, y: function(){ return Math.round(window.innerHeight * 0.4); }, scale: 1.5, duration: 1.25 }, 0);
  function prepPage(){
    if (!FX || !page.length) return;
    var vh = window.innerHeight;
    page.forEach(function(el){
      var r = el.getBoundingClientRect(), topCut = Math.max(0, -r.top), botCut = Math.max(0, r.height - topCut - vh * 2);
      gsap.set(el, { transformOrigin: '100% ' + (-r.top) + 'px', clipPath: 'inset(' + topCut + 'px 0 ' + botCut + 'px 0)' });
    });
  }
  function openMenu(){
    openState = true; menu.classList.add('is-open'); menu.setAttribute('aria-hidden', 'false'); menu.removeAttribute('inert'); toggle.setAttribute('aria-expanded', 'true');
    if (lenis) lenis.stop(); document.documentElement.style.overflow = 'hidden';
    if (tl.progress() === 0) { prepPage(); tl.invalidate(); }
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
  menu.querySelectorAll('.m6__link a').forEach(function(a){ a.addEventListener('mouseenter', function(){ showPreview(a.getAttribute('data-img')); }); });
})();`,
};
export default c;
