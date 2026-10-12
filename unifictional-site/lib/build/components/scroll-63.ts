// @ts-nocheck
// scroll-63 · Pinned hero slit-and-spin transition (Awwwards Pack).
// The hero photo narrows to a vertical slit over a plain layer, tilts, tints
// with the accent and shrinks away; two half-screen photos then wipe in and
// the sub rises line by line with the button.
import type { Component } from "./_types";

const c: Component = {
  id: "scroll-63",
  type: "hero-slit",
  kind: "hero",
  weight: "light",
  describe: "hero-slit (scroll-63): a pinned hero in three beats. First a full-bleed photo with a big centred headline (3-8 words) and an optional small eyebrow above it. As you scroll the photo squeezes into a thin vertical bar over a plain page-colour layer that shows the brand name and tagline at each side; the bar tilts, flashes the accent colour and shrinks to nothing. Then two tall photos wipe in side by side (left from the top, right from the bottom) and the sub rises over them line by line with the button. Needs exactly 3 photos: the hero shot plus two tall portrait-friendly shots. Dramatic and editorial: studios, photographers, events, fashion, architecture, hospitality.",
  fields: `{"type":"hero-slit","component":"scroll-63","eyebrow":"","headline":"","sub":"","cta":{"label":"","href":"contact"},"images":[{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""}]}`,
  images: { min: 3, max: 3 },
  css: ({ pair, capsRule }) => `
.hero-slit{height:500svh;position:relative}
.hero-slit__pin{position:sticky;top:0;height:100svh;overflow:hidden;background:var(--bg)}
.hero-slit__bg,.hero-slit__outro,.hero-slit__fg{position:absolute;inset:0}
.hero-slit__bg{z-index:0;display:flex;align-items:center;padding:0 var(--gutter);gap:2rem}
.hero-slit__bgcol{flex:1;display:flex}
.hero-slit__bgcol:nth-child(2){justify-content:flex-end;text-align:right}
.hero-slit__bgcopy{display:grid;gap:.7rem;width:min(26rem,50%);will-change:transform}
.hero-slit__bgcopy h3{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}font-size:clamp(1.6rem,3.4vw,3.2rem);line-height:1;color:var(--accent)}
.hero-slit__bgcopy p{font-family:var(--mono);font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink2);line-height:1.5}
.hero-slit__outro{z-index:1;display:flex}
.hero-slit__half{flex:1;position:relative;height:100%;overflow:hidden;will-change:clip-path}
.hero-slit__half:nth-child(1){clip-path:polygon(0% 0%,100% 0%,100% 0%,0% 0%)}
.hero-slit__half:nth-child(2){clip-path:polygon(0% 100%,100% 100%,100% 100%,0% 100%)}
.hero-slit__half img{width:100%;height:100%;object-fit:cover}
.hero-slit__half::after{content:"";position:absolute;inset:0;background:rgba(0,0,0,.4)}
.hero-slit__outrocopy{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(58rem,72%);text-align:center;color:#fff;display:grid;gap:1.8rem;justify-items:center}
.hero-slit__outrocopy p{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}font-size:clamp(1.5rem,3.2vw,3.2rem);line-height:1.1}
.hero-slit__outrocopy .btn{opacity:0;transform:translateY(20px)}
.hero-slit__fg{z-index:2;background:var(--bg);clip-path:polygon(0% 0%,100% 0%,100% 100%,0% 100%);transform-origin:50% 50%;will-change:clip-path,transform}
.hero-slit__fg img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero-slit__fg::before{content:"";position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.6),rgba(0,0,0,0) 60%)}
.hero-slit__ov{position:absolute;inset:0;opacity:0;will-change:opacity}
.hero-slit__ov--dark{background:var(--ink)}
.hero-slit__ov--accent{background:var(--accent)}
.hero-slit__fgcopy{position:absolute;left:var(--gutter);right:var(--gutter);bottom:clamp(2rem,6vh,4rem);display:grid;gap:1.2rem;justify-items:center;text-align:center;color:#fff}
.hero-slit__fgcopy h1{font-size:clamp(2.6rem,7.4vw,8.5rem);line-height:.92;max-width:16ch}
.hero-slit__fgcopy .mono{color:rgba(255,255,255,.75)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .hero-slit{height:auto}
  .hero-slit__pin{position:relative;height:auto;overflow:visible;display:flex;flex-direction:column}
  .hero-slit__bg{display:none}
  .hero-slit__fg,.hero-slit__outro{position:relative;inset:auto;clip-path:none!important;transform:none!important}
  .hero-slit__fg{height:100svh;order:1}
  .hero-slit__outro{order:2}
  .hero-slit__ov{display:none}
  .hero-slit__fg::before{background:linear-gradient(to top,rgba(0,0,0,.75),rgba(0,0,0,.2))}
  .hero-slit__fgcopy{justify-items:start;text-align:left;bottom:3rem}
  .hero-slit__outro{display:grid;grid-template-columns:1fr 1fr;gap:.6rem;padding:3rem var(--gutter);background:var(--bg)}
  .hero-slit__half{height:auto;aspect-ratio:3/4;clip-path:none!important}
  .hero-slit__half::after{display:none}
  .hero-slit__outrocopy{position:relative;left:auto;top:auto;transform:none;width:100%;grid-column:1/-1;color:var(--ink);text-align:left;justify-items:start;padding-top:1rem}
  .hero-slit__outrocopy p{font-family:var(--body);font-weight:400;letter-spacing:0;text-transform:none;font-size:1.05rem;line-height:1.5;color:var(--ink2);max-width:46ch;opacity:1!important;transform:none!important}
  .hero-slit__outrocopy .btn{opacity:1;transform:none}
}`,
  html: (s, { spec, esc, imgUrl, link, arrow }) => {
    const imgs = (s.images || []).slice(0, 3);
    const im = (i, w) => imgs[i] ? `<img src="${esc(imgUrl(imgs[i], w))}" alt="${esc(imgs[i].alt || "")}" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}>` : "";
    const b = spec.brand || {};
    return `
<section class="hero-slit" id="top" data-fx="hero-slit">
  <div class="hero-slit__pin">
    <div class="hero-slit__bg" aria-hidden="true">
      <div class="hero-slit__bgcol"><div class="hero-slit__bgcopy"><h3>${esc(b.name || "")}</h3><p>${esc(b.tagline || b.industry || "")}</p></div></div>
      <div class="hero-slit__bgcol"><div class="hero-slit__bgcopy"><h3>${esc(b.city || b.serviceArea || "")}</h3><p>${esc(b.serviceArea && b.serviceArea !== b.city ? b.serviceArea : (b.phone || ""))}</p></div></div>
    </div>
    <div class="hero-slit__outro">
      <div class="hero-slit__half">${im(1, 1400)}</div>
      <div class="hero-slit__half">${im(2, 1400)}</div>
      <div class="hero-slit__outrocopy">
        <p>${esc(s.sub || "")}</p>
        ${s.cta ? `<a class="btn btn-primary" href="${esc(link(s.cta.href))}">${esc(s.cta.label)}${arrow}</a>` : ""}
      </div>
    </div>
    <div class="hero-slit__fg">
      ${im(0, 2000)}
      <div class="hero-slit__fgcopy">
        ${s.eyebrow ? `<span class="mono">${esc(s.eyebrow)}</span>` : ""}
        <h1 class="display">${esc(s.headline || "")}</h1>
      </div>
      <div class="hero-slit__ov hero-slit__ov--dark"></div>
      <div class="hero-slit__ov hero-slit__ov--accent"></div>
    </div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var el = document.querySelector('[data-fx="hero-slit"]');
  if (!el || !window.__fx.FX) return;
  var fg = el.querySelector('.hero-slit__fg'), ovD = el.querySelector('.hero-slit__ov--dark'), ovA = el.querySelector('.hero-slit__ov--accent');
  var copies = el.querySelectorAll('.hero-slit__bgcopy'), halves = el.querySelectorAll('.hero-slit__half');
  var outroP = el.querySelector('.hero-slit__outrocopy p'), outroBtn = el.querySelector('.hero-slit__outrocopy .btn');
  function build(){
    var lines = [outroP];
    if (window.SplitText) { try { lines = SplitText.create(outroP, { type: 'lines', mask: 'lines', linesClass: 'hero-slit__line' }).lines; } catch (e) {} }
    gsap.set(lines, { yPercent: 100, opacity: 0 });
    var tl = gsap.timeline({ scrollTrigger: { trigger: el, start: 'top top', end: 'bottom bottom', scrub: 1 }, defaults: { ease: 'none' } });
    tl.to(fg, { clipPath: 'polygon(48% 0%, 52% 0%, 52% 100%, 48% 100%)', duration: 0.25 }, 0)
      .to(ovD, { opacity: 1, duration: 0.25 }, 0)
      .to(fg, { rotation: 65, duration: 0.2 }, 0.25)
      .to(fg, { scale: 0, duration: 0.2 }, 0.45)
      .to(ovA, { opacity: 1, duration: 0.05 }, 0.45)
      .to(copies[0], { xPercent: 100, duration: 0.2 }, 0.45)
      .to(copies[1], { xPercent: -100, duration: 0.2 }, 0.45)
      .to(halves[0], { clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)', duration: 0.2 }, 0.65)
      .to(halves[1], { clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)', duration: 0.2 }, 0.65)
      .to(lines, { yPercent: 0, opacity: 1, duration: 0.1, stagger: 0.025, ease: 'power2.out' }, 0.85);
    if (outroBtn) tl.to(outroBtn, { opacity: 1, y: 0, duration: 0.07, ease: 'power2.out' }, 0.93);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(build); else build();
})();`,
};
export default c;
