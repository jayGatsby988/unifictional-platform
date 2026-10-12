// @ts-nocheck
// scroll-9 · Pinned full-screen photos replace each other through opening slats; captions clip in (Awwwards Pack).
import type { Component } from "./_types";

const c: Component = {
  id: "scroll-9",
  type: "story-blinds",
  kind: "section",
  weight: "light",
  describe: "story-blinds (scroll-9): a pinned full-screen stage. The first photo opens over the page background through 24 horizontal slats that part from their centre lines, bottom slat first; a caption (short title, one or two sentences) clips up into view, holds, then clips away, and the next photo opens over it the same way. Three thin segments along the bottom fill with progress. Needs exactly 3 wide photos, each with a title of 2-5 words and 15-35 words of text. A cinematic chapter for 'how we work', three places or three flagship projects; on phones it becomes three stacked image-and-caption blocks.",
  fields: `{"type":"story-blinds","component":"scroll-9","items":[{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""}]}`,
  images: { min: 3, max: 3 },
  css: () => `
.sblinds{height:420svh}
.sblinds__stage{position:sticky;top:0;height:100svh;overflow:hidden;background:var(--bg)}
.sblinds__layer{position:absolute;inset:0;margin:0}
.sblinds__img{position:absolute;inset:0;visibility:hidden;will-change:clip-path}
.sblinds__img img{width:100%;height:100%;object-fit:cover;will-change:transform}
.sblinds__img::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 28%,rgba(0,0,0,.45) 60%,rgba(0,0,0,.8) 100%)}
.sblinds__cap{text-shadow:0 1px 3px rgba(0,0,0,.5);position:absolute;left:var(--gutter);right:var(--gutter);bottom:clamp(5rem,13vh,9rem);z-index:2;color:#fff;max-width:44rem;clip-path:inset(100% 0% 0% 0%);transform:translateY(40px);will-change:clip-path,transform}
.sblinds__cap .mono{color:rgba(255,255,255,.72);margin-bottom:1.1rem}
.sblinds__cap h2{font-size:clamp(2.4rem,6vw,6rem);margin-bottom:1rem;max-width:12ch}
.sblinds__cap p{max-width:40ch;color:rgba(255,255,255,.84);font-size:1.05rem}
.sblinds__bar{position:absolute;left:var(--gutter);right:var(--gutter);bottom:2.2rem;z-index:3;display:flex;gap:.6rem}
.sblinds__bar span{flex:1;height:2px;background:rgba(255,255,255,.28);overflow:hidden}
.sblinds__bar i{display:block;height:100%;background:#fff;transform:scaleX(0);transform-origin:0 50%;will-change:transform}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .sblinds{height:auto}
  .sblinds__stage{position:static;height:auto;overflow:visible;display:grid;gap:3rem;padding:3rem 0}
  .sblinds__layer{position:relative;inset:auto}
  .sblinds__img{position:relative;inset:auto;visibility:visible!important;clip-path:none!important}
  .sblinds__img img{aspect-ratio:4/3;height:auto;transform:none!important}
  .sblinds__img::after{display:none}
  .sblinds__cap{position:static;color:var(--ink);padding:1.2rem var(--gutter) 0;clip-path:none!important;transform:none!important;max-width:none}
  .sblinds__cap .mono{color:var(--ink2)}
  .sblinds__cap p{color:var(--ink2)}
  .sblinds__bar{display:none}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, 3);
    const n = items.length;
    const pic = (it, i) => it.image?.url ? it.image : it.url ? it : (s.images || [])[i];
    return `
<section class="sblinds" data-fx="story-blinds">
  <div class="sblinds__stage">
    ${items.map((it, i) => { const im = pic(it, i); return `<figure class="sblinds__layer"><div class="sblinds__img"><img src="${esc(imgUrl(im, 2000))}" alt="${esc(it.alt || im?.alt || it.title || "")}" loading="lazy"></div><figcaption class="sblinds__cap"><div class="mono">0${i + 1} / 0${n}</div><h2 class="display">${esc(it.title)}</h2><p>${esc(it.text)}</p></figcaption></figure>`; }).join("")}
    <div class="sblinds__bar">${items.map(() => `<span><i></i></span>`).join("")}</div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="story-blinds"]');
  if (!sec || !window.__fx.FX) return;
  var fills = sec.querySelectorAll('.sblinds__bar i');
  var clamp = function(v, a, b){ return v < a ? a : v > b ? b : v; };
  // One clip-path polygon holds every slat: four points per slat, joined along the left edge.
  function slats(el, n){
    var spread = 0.65, h = 100 / n;
    return function(v){
      if (v <= 0) { el.style.visibility = 'hidden'; return; }
      el.style.visibility = 'visible';
      if (v >= 1) { el.style.clipPath = 'none'; return; }
      var pts = [];
      for (var i = 0; i < n; i++) {
        var t = clamp(v * (1 + spread) - ((n - 1 - i) / (n - 1)) * spread, 0, 1);
        var half = (1 - Math.pow(1 - t, 3)) * h / 2, c = (i + 0.5) * h;
        var y0 = (c - half).toFixed(3) + '%', y1 = (c + half).toFixed(3) + '%';
        pts.push('0% ' + y0, '100% ' + y0, '100% ' + y1, '0% ' + y1);
      }
      el.style.clipPath = 'polygon(' + pts.join(',') + ')';
    };
  }
  var layers = Array.prototype.map.call(sec.querySelectorAll('.sblinds__layer'), function(fig){
    var box = fig.querySelector('.sblinds__img');
    var L = { box: box, img: box.querySelector('img'), cap: fig.querySelector('.sblinds__cap'), set: slats(box, 24), o: { v: 0 } };
    L.set(0);
    return L;
  });
  var n = layers.length;
  var tl = gsap.timeline({
    scrollTrigger: { trigger: sec, start: 'top top', end: 'bottom bottom', scrub: 1 },
    onUpdate: function(){
      var p = tl.progress();
      fills.forEach(function(f, i){ f.style.transform = 'scaleX(' + clamp((p - i / n) * n, 0, 1).toFixed(4) + ')'; });
    }
  });
  layers.forEach(function(L, i){
    tl.to(L.o, { v: 1, duration: 1.4, ease: 'none', onUpdate: function(){ L.set(L.o.v); } }, i ? '>' : 0);
    tl.fromTo(L.img, { scale: 1.12 }, { scale: 1, duration: 1.8, ease: 'power2.out' }, '<');
    tl.fromTo(L.cap, { clipPath: 'inset(100% 0% 0% 0%)', y: 40 }, { clipPath: 'inset(0% 0% 0% 0%)', y: 0, duration: 1.5, ease: 'expo.out' }, '-=0.7');
    if (i < n - 1) tl.to(L.cap, { clipPath: 'inset(0% 0% 100% 0%)', y: -30, duration: 1.2, ease: 'power2.inOut' }, '+=0.8');
    else tl.to({}, { duration: 0.8 });
  });
})();`,
};
export default c;
