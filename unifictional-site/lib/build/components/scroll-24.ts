// @ts-nocheck
// scroll-24 · Full-screen panels that wipe up over each other behind a straight edge, with image parallax and
// heading letters rising in random order (Awwwards Pack, video only). The demo locks the page to one gesture
// per panel with GSAP Observer; here the wipes are scrubbed on a pinned stage and ScrollTrigger snaps to each panel.
import type { Component } from "./_types";

const c: Component = {
  id: "scroll-24",
  type: "panels-curtain-24",
  kind: "section",
  weight: "light",
  describe: "(recreated from the preview video) panels-curtain-24 (scroll-24): a pinned stage of 3-5 full-screen panels, each a dimmed full-bleed photo with a short centred title and one or two sentences in white. Scrolling pulls the next panel up over the current one behind a straight horizontal edge, its photo moving a little slower than the edge, and the new title's letters rise into place in random order; the scroll snaps so you always rest on a whole panel. A small counter sits bottom left. Needs 3-5 wide photos, each with a title of 1-4 words and 10-30 words of text. A showcase chapter for three to five flagship projects, locations or services. Phones stack the panels as photo plus caption, no snapping.",
  fields: `{"type":"panels-curtain-24","component":"scroll-24","items":[{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""}]}`,
  images: { min: 3, max: 5 },
  css: () => `
.pcur{height:calc(var(--n) * 100svh)}
.pcur__stage{position:sticky;top:0;height:100svh;overflow:hidden;background:var(--bg)}
.pcur__panel{position:absolute;inset:0;overflow:hidden;will-change:transform}
.pcur__inner{position:absolute;inset:0;overflow:hidden;will-change:transform}
.pcur__bg{position:absolute;inset:-8% 0;will-change:transform}
.pcur__bg img{width:100%;height:100%;object-fit:cover}
.pcur__bg::after{content:"";position:absolute;inset:0;background:rgba(0,0,0,.42)}
.pcur__copy{position:absolute;inset:0;z-index:2;display:grid;align-content:center;justify-items:center;gap:1.2rem;text-align:center;padding:0 var(--gutter);color:#fff}
.pcur__copy h2{font-size:clamp(2.4rem,7vw,7.5rem);max-width:14ch;line-height:1}
.pcur__copy p{max-width:40ch;color:rgba(255,255,255,.82);font-size:1.05rem}
.pcur__count{position:absolute;left:var(--gutter);bottom:2rem;z-index:3;color:rgba(255,255,255,.7)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .pcur{height:auto}
  .pcur__stage{position:static;height:auto;display:grid;gap:2.5rem;padding:2rem 0}
  .pcur__panel{position:relative;inset:auto;transform:none!important;overflow:visible}
  .pcur__inner{position:relative;inset:auto;transform:none!important}
  .pcur__bg{position:relative;inset:auto;aspect-ratio:4/3;transform:none!important}
  .pcur__bg::after{display:none}
  .pcur__copy{position:static;color:var(--ink);text-align:left;justify-items:start;padding:1.2rem var(--gutter) 0;gap:.8rem;opacity:1!important}
  .pcur__copy h2{font-size:clamp(2rem,9vw,4rem);transform:none!important}
  .pcur__copy p{color:var(--ink2)}
  .pcur__count{display:none}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, 5);
    const n = items.length;
    const pic = (it, i) => it.image?.url ? it.image : it.url ? it : (s.images || [])[i];
    return `
<section class="pcur" data-fx="panels-curtain-24" style="--n:${n}">
  <div class="pcur__stage">
    ${items.map((it, i) => { const im = pic(it, i); return `<article class="pcur__panel"><div class="pcur__inner"><div class="pcur__bg"><img src="${esc(imgUrl(im, 2000))}" alt="${esc(it.alt || im?.alt || it.title || "")}" loading="${i ? "lazy" : "eager"}"></div><div class="pcur__copy"><h2 class="display">${esc(it.title)}</h2>${it.text ? `<p>${esc(it.text)}</p>` : ""}</div></div></article>`; }).join("")}
    <div class="pcur__count mono"><span class="pcur__i">01</span> / 0${n}</div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="panels-curtain-24"]');
  if (!sec || !window.__fx.FX) return;
  var panels = Array.prototype.slice.call(sec.querySelectorAll('.pcur__panel')), n = panels.length;
  if (n < 2) return;
  var counter = sec.querySelector('.pcur__i');
  var pad = function(i){ return (i < 9 ? '0' : '') + (i + 1); };
  var parts = panels.map(function(p){
    var h = p.querySelector('h2'), chars = null;
    if (window.SplitText) { try { chars = SplitText.create(h, { type: 'words,chars', mask: 'chars' }).chars; } catch (e) { chars = null; } }
    return { inner: p.querySelector('.pcur__inner'), bg: p.querySelector('.pcur__bg'), copy: p.querySelector('.pcur__copy'), chars: chars || [h] };
  });
  gsap.set(panels.slice(1), { yPercent: 100 });
  parts.slice(1).forEach(function(pt){ gsap.set(pt.inner, { yPercent: -100 }); gsap.set(pt.bg, { yPercent: 15 }); });
  var tl = gsap.timeline({ defaults: { ease: 'power1.inOut' }, scrollTrigger: { trigger: sec, start: 'top top', end: 'bottom bottom', scrub: 0.5,
    snap: { snapTo: 1 / (n - 1), duration: { min: 0.25, max: 0.7 }, delay: 0.05, ease: 'power1.inOut', directional: true },
    onUpdate: function(self){ if (counter) counter.textContent = pad(Math.round(self.progress * (n - 1))); } } });
  for (var i = 1; i < n; i++) {
    var t = i - 1, pt = parts[i];
    tl.to(panels[i], { yPercent: 0, duration: 1 }, t)
      .to(pt.inner, { yPercent: 0, duration: 1 }, t)
      .to(pt.bg, { yPercent: 0, duration: 1 }, t)
      .to(parts[i - 1].copy, { opacity: 0, duration: 0.45 }, t)
      .fromTo(pt.chars, { yPercent: 150 }, { yPercent: 0, duration: 0.6, ease: 'power2.out', stagger: { each: 0.02, from: 'random' } }, t + 0.35);
  }
})();`,
};
export default c;
