// @ts-nocheck
// scroll-8 · Sticky text-mask zoom: a video (or photo) shows only through a brand word, and scrolling
// zooms the word until one solid glyph fills the screen (Awwwards Pack). The demo masks with a hand-made
// SVG; here the word is drawn to a canvas in the site's display font and used as the CSS mask, and the
// zoom anchors on the thickest part of a glyph found with a distance transform.
import type { Component } from "./_types";

const STATIC = (p) => `
${p} .hmv__media{opacity:1;-webkit-mask-image:none!important;mask-image:none!important}
${p} .hmv__shade{opacity:1}
${p} .hmv__word{opacity:1!important;color:#fff}
${p} .hmv__copy{opacity:1;transform:none}
${p} .hmv__hint{display:none}`;

const c: Component = {
  id: "scroll-8",
  type: "hero-mask-8",
  kind: "hero",
  weight: "light",
  describe: "hero-mask-8 (scroll-8): the page opens on a flat background with one brand word (3-10 letters, no spaces) set huge across it; a looping video, or the poster photo when there is no video, is visible only inside the letters. The screen stays pinned while you scroll and the word zooms up with a slight lag until the thickest stroke of one letter fills the whole screen and the full video shows; headline, sub and button fade in over it, then the page scrolls on. Needs the word, a headline, a sub of 15-30 words, a button, one poster photo and optionally a muted looping video URL. Cinematic opener for builders, venues, studios, anything with footage of the work. Phones and reduced motion show the poster with the word over it.",
  fields: `{"type":"hero-mask-8","component":"scroll-8","word":"","headline":"","sub":"","cta":{"label":"","href":"contact"},"image":{"query":"","alt":""},"video":{"url":""}}`,
  images: { min: 1, max: 1 },
  css: ({ pair, capsRule }) => `
.hmv{height:300svh;position:relative;background:var(--bg)}
.hmv__stage{position:sticky;top:0;height:100svh;overflow:hidden}
.hmv__media{position:absolute;inset:0;opacity:0;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-size:80% auto;mask-size:80% auto;-webkit-mask-position:50% 50%;mask-position:50% 50%}
.hmv.is-masked .hmv__media{opacity:1}
.hmv__media video,.hmv__media img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hmv__shade{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.6),rgba(0,0,0,0) 55%)}
.hmv__word{position:absolute;inset:0;z-index:1;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 var(--gutter);margin:0;font-family:var(--display);font-weight:${pair.weight};font-size:clamp(3rem,13vw,15rem);line-height:1;letter-spacing:${pair.track};text-transform:uppercase;color:var(--ink);pointer-events:none}
.hmv.is-masked .hmv__word{opacity:0}
.hmv__copy{position:absolute;left:var(--gutter);right:var(--gutter);bottom:clamp(2rem,6vh,4rem);z-index:2;display:grid;gap:1.2rem;max-width:42rem;color:#fff;opacity:0;transform:translateY(20px)}
.hmv__copy h2{font-family:var(--display);font-weight:${pair.weight};font-size:clamp(1.8rem,3.6vw,3.2rem);line-height:1.05;letter-spacing:${pair.track};${capsRule}}
.hmv__copy p{max-width:40ch;color:rgba(255,255,255,.78);font-size:1.05rem}
.hmv__hint{position:absolute;right:var(--gutter);bottom:2rem;z-index:2;font-family:var(--mono);font-size:.65rem;letter-spacing:.2em;text-transform:uppercase;color:var(--ink2);display:flex;align-items:center;gap:.8rem}
.hmv__hint i{width:1px;height:48px;background:currentColor;opacity:.5;display:block}
.hmv.is-masked .hmv__hint{color:var(--ink3)}
.hmv.is-static{height:auto}
.hmv.is-static .hmv__stage{position:relative}
${STATIC(".hmv.is-static")}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .hmv{height:auto}
  .hmv__stage{position:relative;min-height:100svh;display:grid;align-content:end;padding:7rem var(--gutter) 3rem}
  .hmv__word{position:relative;inset:auto;padding:0;justify-content:flex-start;text-align:left;font-size:clamp(3rem,16vw,8rem);margin-bottom:1.5rem}
  .hmv__copy{position:relative;inset:auto;max-width:none}
  ${STATIC("")}
}`,
  html: (s, { spec, esc, imgUrl, link, arrow }) => {
    const word = String(s.word || spec.brand.name).toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 12) || "WORK";
    const poster = imgUrl(s.image, 2000);
    const url = s.video && typeof s.video === "object" ? String(s.video.url || "").trim() : "";
    const media = /^https?:\/\//i.test(url)
      ? `<video muted loop playsinline autoplay preload="metadata" poster="${esc(poster)}" aria-label="${esc(s.image?.alt || "")}"><source src="${esc(url)}"></video>`
      : `<img src="${esc(poster)}" alt="${esc(s.image?.alt || "")}" fetchpriority="high">`;
    return `
<section class="hmv" id="top" data-fx="hero-mask-8">
  <div class="hmv__stage">
    <div class="hmv__media">${media}<div class="hmv__shade"></div></div>
    <h1 class="hmv__word">${esc(word)}</h1>
    <div class="hmv__copy">
      ${s.headline ? `<h2>${esc(s.headline)}</h2>` : ""}
      ${s.sub ? `<p>${esc(s.sub)}</p>` : ""}
      ${s.cta ? `<div><a class="btn btn-primary" href="${esc(link(s.cta.href))}">${esc(s.cta.label)}${arrow}</a></div>` : ""}
    </div>
    <div class="hmv__hint"><span>Scroll</span><i></i></div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="hero-mask-8"]');
  if (!sec) return;
  var media = sec.querySelector('.hmv__media'), word = sec.querySelector('.hmv__word'), copy = sec.querySelector('.hmv__copy');
  function stat(){ sec.classList.add('is-static'); }
  if (!window.__fx.FX) { stat(); return; }
  // Draw the word to a canvas in the page's display font and find the thickest point of a glyph.
  function build(){
    var cs = getComputedStyle(word), text = word.textContent.trim();
    if (/upper/.test(cs.textTransform)) text = text.toUpperCase();
    var F = 400, pad = 80, c = document.createElement('canvas'), x = c.getContext('2d');
    var font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + F + 'px ' + cs.fontFamily;
    x.font = font;
    var tw = Math.ceil(x.measureText(text).width);
    c.width = tw + pad * 2; c.height = Math.round(F * 1.2);
    x = c.getContext('2d'); x.font = font; x.fillStyle = '#000'; x.textBaseline = 'middle'; x.textAlign = 'left';
    x.fillText(text, pad, c.height / 2);
    var d = x.getImageData(0, 0, c.width, c.height).data, st = 3, gw = Math.floor(c.width / st), gh = Math.floor(c.height / st);
    var D = new Float32Array(gw * gh), i, j, k, v, BIG = 1e6;
    for (j = 0; j < gh; j++) for (i = 0; i < gw; i++) D[j * gw + i] = d[((j * st) * c.width + i * st) * 4 + 3] > 180 ? BIG : 0;
    for (j = 1; j < gh; j++) for (i = 1; i < gw - 1; i++) { k = j * gw + i; v = D[k]; if (!v) continue;
      v = Math.min(v, D[k - 1] + 1, D[k - gw] + 1, D[k - gw - 1] + 1.414, D[k - gw + 1] + 1.414); D[k] = v; }
    for (j = gh - 2; j >= 0; j--) for (i = gw - 2; i > 0; i--) { k = j * gw + i; v = D[k]; if (!v) continue;
      v = Math.min(v, D[k + 1] + 1, D[k + gw] + 1, D[k + gw - 1] + 1.414, D[k + gw + 1] + 1.414); D[k] = v; }
    var best = -1, bi = 0, bj = 0, cx = gw / 2, cy = gh / 2;
    for (j = 0; j < gh; j++) for (i = 0; i < gw; i++) { v = D[j * gw + i]; if (v >= BIG || v <= 0) continue;
      var score = v - 0.01 * Math.sqrt((i - cx) * (i - cx) + (j - cy) * (j - cy));
      if (score > best) { best = score; bi = i; bj = j; } }
    var r = D[bj * gw + bi];
    if (!(r > 0) || r >= BIG) return null;
    return { url: c.toDataURL(), w: c.width, h: c.height, ax: bi * st, ay: bj * st, r: r * st };
  }
  function init(){
    if (sec.classList.contains('is-static')) return;
    var m = null;
    try { m = build(); } catch (e) { m = null; }
    if (!m || m.r < 6) { stat(); return; }
    media.style.webkitMaskImage = media.style.maskImage = 'url(' + m.url + ')';
    var S0 = 0.8, S1 = 40, W = 0, H = 0, pan = gsap.parseEase('power2.inOut');
    function endScale(){
      W = sec.clientWidth || window.innerWidth; H = window.innerHeight;
      var diag = Math.sqrt(W * W + H * H);
      S1 = Math.max(12, Math.min(90, 0.6 * diag * m.w / (m.r * W)));
    }
    var o = { p: 0 };
    // Word centred at rest; the mask then pans so the thickest glyph point sits at screen centre while it zooms.
    function apply(){
      var s = S0 * Math.pow(S1 / S0, o.p), k = s * W / m.w, iw = m.w * k, ih = m.h * k, t = pan(Math.min(1, o.p / 0.45));
      var left = (W - iw) / 2 + ((W / 2 - m.ax * k) - (W - iw) / 2) * t, top = (H - ih) / 2 + ((H / 2 - m.ay * k) - (H - ih) / 2) * t;
      media.style.webkitMaskSize = media.style.maskSize = iw.toFixed(2) + 'px ' + ih.toFixed(2) + 'px';
      media.style.webkitMaskPosition = media.style.maskPosition = left.toFixed(2) + 'px ' + top.toFixed(2) + 'px';
    }
    endScale(); apply();
    sec.classList.add('is-masked');
    gsap.timeline({ scrollTrigger: { trigger: sec, start: 'top top', end: 'bottom bottom', scrub: 0.6, onRefresh: function(){ endScale(); apply(); } } })
      .to(o, { p: 1, ease: 'none', duration: 1, onUpdate: apply }, 0)
      .to(copy, { opacity: 1, y: 0, duration: 0.25, ease: 'power2.out' }, 0.72);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(init, init); else init();
})();`,
};
export default c;
