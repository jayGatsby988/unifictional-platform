// @ts-nocheck
// scroll-35 · Pinned hero: five big tiles rise from the bottom, shrink to the centre as the background flips,
// then drop into slots inside a sentence whose fragments fade in around them (Awwwards Pack).
// Positions are computed from untransformed geometry once per refresh instead of read back every frame.
import type { Component } from "./_types";

const c: Component = {
  id: "scroll-35",
  type: "hero-slots-35",
  kind: "hero",
  weight: "light",
  describe: "hero-slots-35 (scroll-35): the page opens with the headline and sub in the upper middle and a row of five big rounded tiles along the bottom edge, one per service or feature, each showing the first letter of its name in the display face on alternating accent and card backgrounds (or a small photo when one is given). The screen stays pinned as you scroll: the headline fades, the tiles rise one after another, then the whole row shrinks into the centre while the background snaps to the opposite colour; the five small tiles then travel down and sideways into gaps inside a big centred sentence whose fragments fade in around them in random order, and a button appears. Needs a headline, a sub, exactly 5 items with a 1-3 word title (optionally a photo), a sentence of 12-25 words containing five '__' slots where the tiles land, and a button. A playful opener that names five services or tools: agencies, studios, trades with clear service lines. Phones show headline, sub, the five tiles in a row, the sentence and the button.",
  fields: `{"type":"hero-slots-35","component":"scroll-35","headline":"","sub":"","sentence":"Decks __ pergolas __ fences __ and railings __ built straight, backed by repairs __ for life.","items":[{"title":"Decks"},{"title":"Pergolas"},{"title":"Fences"},{"title":"Railings"},{"title":"Repairs"}],"cta":{"label":"","href":"contact"}}`,
  images: { min: 0, max: 5 },
  css: ({ pair, capsRule }) => `
.hsl{height:100svh;overflow:hidden}
.hsl__pin{position:relative;height:100svh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--ink);transition:background-color .35s ease,color .35s ease;overflow:hidden}
.hsl__pin.is-flip{background:var(--inv-bg);color:var(--inv-ink)}
.hsl__head{position:absolute;top:38%;left:50%;transform:translate(-50%,-50%);width:min(62rem,90vw);text-align:center;display:grid;gap:1.4rem;justify-items:center;z-index:1}
.hsl__head h1{font-size:clamp(2.6rem,7vw,7.5rem);line-height:.95;max-width:14ch}
.hsl__head p{max-width:44ch;color:var(--ink2);font-size:1.1rem}
.hsl__row{position:absolute;left:1.25rem;right:1.25rem;bottom:1.25rem;display:flex;gap:1rem;z-index:2}
.hsl__tile{flex:1;aspect-ratio:1;border-radius:18%;overflow:hidden;display:grid;place-items:center;font-family:var(--display);font-weight:${pair.weight};font-size:9vw;line-height:1;will-change:transform;transform-origin:50% 50%;user-select:none}
.hsl__tile:nth-child(odd){background:var(--accent);color:var(--on-accent)}
.hsl__tile:nth-child(even){background:var(--bg2);color:var(--ink);box-shadow:inset 0 0 0 1px var(--line)}
.hsl__tile img{width:100%;height:100%;object-fit:cover}
.hsl__sent{position:relative;width:min(62rem,100%);text-align:center;padding:0 var(--gutter);display:grid;gap:2rem;justify-items:center;z-index:1}
.hsl__text{font-size:clamp(1.8rem,4.2vw,3.8rem);line-height:1.15;${capsRule}}
.hsl__seg{opacity:0}
.hsl__slot{display:inline-block;width:1em;height:1em;vertical-align:-.12em;margin:0 .08em;visibility:hidden}
.hsl__cta{opacity:0;transform:translateY(12px)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .hsl{height:auto}
  .hsl__pin{height:auto;display:grid;gap:2.5rem;padding:7rem var(--gutter) 3rem;align-content:start;justify-items:start;transition:none}
  .hsl__head{position:static;transform:none!important;opacity:1!important;width:auto;text-align:left;justify-items:start}
  .hsl__row{position:static;display:grid;grid-template-columns:repeat(5,1fr);gap:.5rem;width:100%;max-width:26rem}
  .hsl__tile{transform:none!important;font-size:1.6rem}
  .hsl__sent{padding:0;text-align:left;justify-items:start;width:auto}
  .hsl__text{font-size:clamp(1.5rem,6vw,2.4rem)}
  .hsl__seg{opacity:1!important}
  .hsl__slot{display:none}
  .hsl__cta{opacity:1!important;transform:none!important}
}`,
  html: (s, { esc, imgUrl, link, arrow }) => {
    const items = (s.items || []).slice(0, 5);
    while (items.length < 5) items.push({ title: "" });
    const tile = (it, i) => {
      const t = String(it.title || "").trim();
      const letter = (t.match(/[A-Za-z0-9]/) || ["•"])[0].toUpperCase();
      const im = it.image?.url ? it.image : null;
      return `<div class="hsl__tile" title="${esc(t)}">${im ? `<img src="${esc(imgUrl(im, 600))}" alt="${esc(it.alt || im.alt || t)}" loading="lazy">` : `<span aria-label="${esc(t)}">${esc(letter)}</span>`}</div>`;
    };
    const parts = String(s.sentence || "").split(/_{2,}/);
    let html = "", slots = 0;
    parts.forEach((p, i) => {
      if (p.trim()) html += `<span class="hsl__seg">${esc(p.trim())}</span> `;
      if (i < parts.length - 1 && slots < 5) { html += `<i class="hsl__slot"></i> `; slots++; }
    });
    while (slots < 5) { html += `<i class="hsl__slot"></i> `; slots++; }
    return `
<section class="hsl" id="top" data-fx="hero-slots-35">
  <div class="hsl__pin">
    <header class="hsl__head">
      <h1 class="display">${esc(s.headline)}</h1>
      ${s.sub ? `<p>${esc(s.sub)}</p>` : ""}
    </header>
    <div class="hsl__row">${items.map(tile).join("")}</div>
    <div class="hsl__sent">
      <p class="hsl__text display">${html.trim()}</p>
      ${s.cta ? `<div class="hsl__cta"><a class="btn btn-primary" href="${esc(link(s.cta.href))}">${esc(s.cta.label)}${arrow}</a></div>` : ""}
    </div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="hero-slots-35"]');
  if (!sec || !window.__fx.FX) return;
  var pin = sec.querySelector('.hsl__pin'), head = sec.querySelector('.hsl__head'), cta = sec.querySelector('.hsl__cta');
  var tiles = Array.prototype.slice.call(sec.querySelectorAll('.hsl__tile'));
  var slots = Array.prototype.slice.call(sec.querySelectorAll('.hsl__slot'));
  var segs = Array.prototype.slice.call(sec.querySelectorAll('.hsl__seg'));
  var order = segs.map(function(_, i){ return i; });
  for (var i = order.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = order[i]; order[i] = order[j]; order[j] = t; }
  var clamp = function(v){ return v < 0 ? 0 : v > 1 ? 1 : v; }, lerp = function(a, b, t){ return a + (b - a) * t; };
  var easeIO = gsap.parseEase('power2.inOut');
  var G = { W: 0, H: 0, tiles: [], slots: [], rowCx: 0, rowCy: 0, S: 0.2 };
  function measure(){
    gsap.set(tiles, { x: 0, y: 0, scale: 1 });
    var pr = pin.getBoundingClientRect();
    G.W = pr.width; G.H = pr.height;
    var sx = 0, sy = 0;
    G.tiles = tiles.map(function(el){ var b = el.getBoundingClientRect(); var c = { cx: b.left - pr.left + b.width / 2, cy: b.top - pr.top + b.height / 2, w: b.width }; sx += c.cx; sy += c.cy; return c; });
    G.rowCx = sx / tiles.length; G.rowCy = sy / tiles.length;
    G.slots = slots.map(function(el){ var b = el.getBoundingClientRect(); return { cx: b.left - pr.left + b.width / 2, cy: b.top - pr.top + b.height / 2, w: b.width }; });
    G.S = G.slots.length && G.tiles[0].w ? G.slots[0].w / G.tiles[0].w : 0.2;
  }
  function update(p){
    var H = G.H, W = G.W;
    var hp = clamp(p / 0.12);
    gsap.set(head, { xPercent: -50, yPercent: -50, y: -50 * hp, opacity: 1 - hp });
    pin.classList.toggle('is-flip', p >= 0.375);
    tiles.forEach(function(el, i){
      var t = G.tiles[i], sl = G.slots[i] || G.slots[G.slots.length - 1], x, y, s;
      var ex = W / 2 + (t.cx - G.rowCx) * G.S, ey = H / 2 + (t.cy - G.rowCy) * G.S;
      if (p < 0.25) { var m = p / 0.25, ip = clamp((m - i * 0.1) / 0.5); x = t.cx; y = t.cy - 0.3 * H * m * ip; s = 1; }
      else if (p < 0.5) { var q = easeIO(clamp((p - 0.25) / 0.25)); x = lerp(t.cx, ex, q); y = lerp(t.cy - 0.3 * H, ey, q); s = lerp(1, G.S, q); }
      else { var r = clamp((p - 0.5) / 0.15); if (r < 0.5) { x = ex; y = lerp(ey, sl.cy, r / 0.5); } else { x = lerp(ex, sl.cx, (r - 0.5) / 0.5); y = sl.cy; } s = G.S; }
      gsap.set(el, { x: x - t.cx, y: y - t.cy, scale: s });
    });
    segs.forEach(function(el, i){ var k = order.indexOf(i); el.style.opacity = clamp((p - (0.66 + k * 0.03)) / 0.02).toFixed(3); });
    if (cta) { var cp = clamp((p - 0.84) / 0.08); gsap.set(cta, { opacity: cp, y: 12 * (1 - cp) }); }
  }
  measure(); update(0);
  var st = ScrollTrigger.create({ trigger: sec, start: 'top top', end: '+=400%', pin: pin, pinSpacing: true, scrub: 0.6,
    onRefresh: function(self){ measure(); update(self.progress); }, onUpdate: function(self){ update(self.progress); } });
  sec.style.height = 'auto';
})();`,
};
export default c;
