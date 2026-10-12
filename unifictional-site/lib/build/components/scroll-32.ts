// @ts-nocheck
// scroll-32 · A tilted strip of photos drifts in; its middle photo lifts off, straightens and grows to full screen while the page darkens, then slides left through a pinned horizontal run of text panels (Awwwards Pack).
// Same triggers as the demo (strip scrub, fixed clone at 'top top', pin,
// Flip scrubbed over the first fifth, then the horizontal run); the clone
// lives inside the section and the panel count is read from the spec.
import type { Component } from "./_types";

const c: Component = {
  id: "scroll-32",
  type: "strip-horizontal",
  kind: "section",
  weight: "medium",
  describe: "strip-horizontal (scroll-32): a centred statement, then a strip of landscape photos tilted five degrees drifts sideways as it scrolls in. When the strip reaches the top, its middle photo lifts off, straightens and grows to fill the screen while the page darkens; the screen then pins and the full-screen photo slides out to the left as 2-4 dark panels (a short title, a paragraph and a portrait crop of another photo) pass horizontally, ending on a closing line. Needs 5-9 landscape photos (the first becomes the full-screen one, so make it the best), an opening statement, 2-4 panels of 1-3 sentences and a closing line. A big narrative transition for builders, architects, landscape, interiors, hospitality and travel.",
  fields: `{"type":"strip-horizontal","component":"scroll-32","title":"","text":"","images":[{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""},{"query":"","alt":""}],"items":[{"title":"","text":""},{"title":"","text":""}]}`,
  images: { min: 5, max: 9 },
  css: ({ pair }) => `
.sh{position:relative;background:var(--bg);will-change:background-color}
.sh__intro{min-height:70svh;display:grid;place-content:center;text-align:center;padding:6rem var(--gutter) 4rem}
.sh__intro h2{font-size:clamp(2.2rem,5.5vw,5.5rem);max-width:18ch;margin:0 auto}
.sh__strip{position:relative;width:100%;height:50svh;overflow:hidden}
.sh__wrap{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-5deg);width:150%;height:100%}
.sh__imgs{position:absolute;top:50%;left:50%;transform:translate(-75%,-50%);width:200%;height:100%;display:flex;align-items:center;gap:1rem;will-change:transform}
.sh__tile{flex:1;min-width:0;aspect-ratio:5/3;overflow:hidden;background:var(--bg2)}
.sh__tile img{width:100%;height:100%;object-fit:cover}
.sh__clone{position:fixed;z-index:30;object-fit:cover;pointer-events:none;will-change:transform}
.sh__hs{position:relative;width:100%;height:100svh;overflow:hidden}
.sh__hswrap{position:relative;height:100svh;display:flex;will-change:transform}
.sh__panel{flex:1;min-width:0;height:100%;display:flex;gap:2rem;padding:2rem}
.sh__panel--text{background:var(--inv-bg);color:var(--inv-ink)}
.sh__col{display:flex;flex-direction:column;justify-content:center;align-items:center}
.sh__col--copy{flex:3}
.sh__col--img{flex:2}
.sh__copy{width:75%;display:grid;gap:1.2rem}
.sh__copy h3{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};font-size:clamp(1.6rem,3vw,3rem);line-height:1.05}
.sh__copy p{font-size:clamp(1rem,1.3vw,1.25rem);line-height:1.55;opacity:.75;max-width:44ch}
.sh__portrait{width:75%;height:75%;overflow:hidden;background:rgba(127,127,127,.15)}
.sh__portrait img{width:100%;height:100%;object-fit:cover}
.sh__outro{min-height:70svh;display:grid;place-content:center;text-align:center;padding:6rem var(--gutter);color:var(--inv-ink)}
.sh__outro p{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};font-size:clamp(1.8rem,4vw,4rem);line-height:1.1;max-width:20ch;margin:0 auto}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .sh{background:var(--bg)!important}
  .sh__intro{min-height:0;padding:4rem var(--gutter) 2rem}
  .sh__strip{height:auto;overflow:visible;padding:0 var(--gutter)}
  .sh__wrap{position:static;transform:none;width:auto;height:auto}
  .sh__imgs{position:static;transform:none!important;width:auto;height:auto;display:grid;grid-template-columns:1fr 1fr;gap:.6rem}
  .sh__tile{aspect-ratio:4/3}
  .sh__tile.is-dup{display:none}
  .sh__tile img{opacity:1!important}
  .sh__clone{display:none}
  .sh__hs{height:auto;overflow:visible;margin-top:2rem}
  .sh__hswrap{height:auto;flex-direction:column;transform:none!important;width:auto!important}
  .sh__panel{flex-direction:column;padding:var(--gutter);gap:1.5rem}
  .sh__panel--spacer{display:none}
  .sh__col--img{order:-1}
  .sh__copy,.sh__portrait{width:100%}
  .sh__portrait{height:auto;aspect-ratio:4/5}
  .sh__outro{min-height:0;padding:3rem var(--gutter);background:var(--inv-bg)}
}`,
  html: (s, { esc, imgUrl }) => {
    const imgs = (s.images || []).filter(im => im && (im.url || im.query)).slice(0, 9);
    const n = imgs.length;
    const panels = (s.items || []).filter(it => it && (it.title || it.text)).slice(0, 4);
    const T = Math.max(12, n);
    const mid = Math.floor(T / 2);
    const seen = new Set();
    const tiles = n ? Array.from({ length: T }, (_, i) => {
      const idx = (((i - mid) % n) + n) % n;
      const im = imgs[idx];
      const dup = seen.has(idx); seen.add(idx);
      const pin = i === mid;
      return `<div class="sh__tile${pin ? " is-pin" : ""}${dup ? " is-dup" : ""}"><img src="${esc(imgUrl(im, pin ? 2000 : 1000))}" alt="${dup ? "" : esc(im.alt || "")}" loading="lazy"></div>`;
    }).join("") : "";
    const k = panels.length;
    const panelHtml = panels.map((it, i) => {
      const im = n ? imgs[(i + 1) % n] : null;
      return `<div class="sh__panel sh__panel--text">
        <div class="sh__col sh__col--copy"><div class="sh__copy">${it.title ? `<h3>${esc(it.title)}</h3>` : ""}${it.text ? `<p>${esc(it.text)}</p>` : ""}</div></div>
        ${im ? `<div class="sh__col sh__col--img"><div class="sh__portrait"><img src="${esc(imgUrl(im, 1200))}" alt="${esc(im.alt || "")}" loading="lazy"></div></div>` : ""}
      </div>`;
    }).join("");
    return `
<section class="sh" data-fx="strip-horizontal" data-k="${k}">
  ${s.title ? `<div class="sh__intro"><h2 class="display reveal">${esc(s.title)}</h2></div>` : ""}
  <div class="sh__strip"><div class="sh__wrap"><div class="sh__imgs">${tiles}</div></div></div>
  <div class="sh__hs"><div class="sh__hswrap" style="width:${(k + 1) * 100}%"><div class="sh__panel sh__panel--spacer" aria-hidden="true"></div>${panelHtml}</div></div>
  ${s.text ? `<div class="sh__outro"><p>${esc(s.text)}</p></div>` : ""}
</section>`;
  },
  js: ({ t }) => `
(function(){
  var sec = document.querySelector('[data-fx="strip-horizontal"]');
  if (!sec || !window.__fx.FX || !window.Flip) return;
  var strip = sec.querySelector('.sh__strip'), imgs = sec.querySelector('.sh__imgs'), pinImg = sec.querySelector('.sh__tile.is-pin img');
  var hs = sec.querySelector('.sh__hs'), wrap = sec.querySelector('.sh__hswrap');
  var k = +sec.getAttribute('data-k') || 0;
  if (!strip || !imgs || !pinImg || !hs || !wrap) return;
  var light = getComputedStyle(sec).backgroundColor, dark = '${t.invBg}';
  var vh = function(){ return window.innerHeight; };
  // x/y are pinned to 0 so GSAP does not keep the stylesheet's translate(-75%,-50%) as a pixel offset under the percent values.
  gsap.fromTo(imgs, { x: 0, y: 0, xPercent: -75, yPercent: -50 }, { x: 0, y: 0, xPercent: -50, yPercent: -50, ease: 'none', scrollTrigger: { trigger: strip, start: 'top bottom', end: 'top top', scrub: true } });
  var clone = null, flip = null;
  function makeClone(){
    if (clone) return;
    // Measure the tile where it sits when the strip's top meets the viewport top, so a fast
    // scroll past the trigger still starts the lift-off from the strip, not from off-screen.
    var r = pinImg.getBoundingClientRect(), sTop = strip.getBoundingClientRect().top;
    clone = pinImg.cloneNode(true); clone.className = 'sh__clone'; clone.alt = ''; clone.removeAttribute('loading');
    gsap.set(clone, { left: r.left + r.width / 2 - pinImg.offsetWidth / 2, top: r.top - sTop + r.height / 2 - pinImg.offsetHeight / 2, width: pinImg.offsetWidth, height: pinImg.offsetHeight, rotation: -5, transformOrigin: 'center center' });
    sec.appendChild(clone);
    gsap.set(pinImg, { opacity: 0 });
  }
  function killClone(){
    if (flip) { flip.kill(); flip = null; }
    if (clone) { clone.remove(); clone = null; }
    gsap.set(pinImg, { opacity: 1 });
  }
  ScrollTrigger.create({ trigger: strip, start: 'top top', onEnter: makeClone, onEnterBack: makeClone, onLeaveBack: killClone });
  ScrollTrigger.create({ trigger: hs, start: 'top top', end: function(){ return '+=' + vh() * 5; }, pin: true });
  ScrollTrigger.create({ trigger: hs, start: 'top 50%', end: function(){ return '+=' + vh() * 5.5; },
    onEnter: function(){
      if (clone && !flip) {
        var state = Flip.getState(clone);
        gsap.set(clone, { left: 0, top: 0, width: '100%', height: '100svh', rotation: 0, transformOrigin: 'center center' });
        flip = Flip.from(state, { duration: 1, ease: 'none', paused: true });
      }
    },
    onLeaveBack: function(){
      if (flip) { flip.kill(); flip = null; }
      gsap.set(sec, { backgroundColor: light });
      gsap.set(wrap, { x: '0%' });
      if (clone) gsap.set(clone, { x: '0%' });
    },
    onUpdate: function(self){
      var p = self.progress;
      gsap.set(sec, { backgroundColor: p <= 0.05 ? gsap.utils.interpolate(light, dark, Math.min(p / 0.05, 1)) : dark });
      if (p <= 0.2) { if (flip) flip.progress(p / 0.2); }
      else if (flip) flip.progress(1);
      if (p > 0.2 && p <= 0.95) {
        var h = (p - 0.2) / 0.75;
        gsap.set(wrap, { x: (-(k / (k + 1)) * 100 * h) + '%' });
        if (clone) gsap.set(clone, { x: (-k * 100 * h) + '%' });
      } else if (p > 0.95) {
        gsap.set(wrap, { x: (-(k / (k + 1)) * 100) + '%' });
        if (clone) gsap.set(clone, { x: (-k * 100) + '%' });
      }
    } });
})();`,
};
export default c;
