// @ts-nocheck
// scroll-27 · Sentences set on wavy SVG curves that slide along their path as you scroll, blurring with scroll speed (Awwwards Pack).
// The demo's per-instance rAF loops and IntersectionObserver become one
// ScrollTrigger per line (progress + velocity) and a shared ticker lerp.
import type { Component } from "./_types";

const PATHS = [
  { d: "M 0 100 Q 250 200 500 100 Q 750 0 1000 100", h: 200 },
  { d: "M 0 100 Q 250 0 500 100 Q 750 200 1000 100", h: 200 },
  { d: "M 0 50 Q 100 0 200 100 Q 300 200 650 50 C 750 0 750 150 1000 50", h: 200 },
  { d: "M 0 200 Q 150 300 300 200 Q 700 0 1000 150", h: 300 },
];

const c: Component = {
  id: "scroll-27",
  type: "curve-text",
  kind: "section",
  weight: "light",
  describe: "curve-text (scroll-27): 2-4 short sentences set in display type along gentle wavy curves that span the page wider than the screen. As you scroll, each sentence slides along its curve from right to left, and the faster you scroll the more it blurs, settling sharp again when you stop. An optional small title sits above. Needs 2-4 sentences of 4-12 words (quotes, values, a motto). A typographic divider between two sections for any brand with a voice: studios, cafes, makers, wellness, editorial.",
  fields: `{"type":"curve-text","component":"scroll-27","title":"","items":[{"text":""},{"text":""},{"text":""}]}`,
  css: ({ pair, capsRule }) => `
.curve{padding:clamp(4rem,10vh,8rem) 0;overflow:hidden}
.curve .sec-head{grid-template-columns:1fr;padding:0 var(--gutter);text-align:center;margin-bottom:0}
.curve .sec-head h2{margin:0 auto}
.curve__line{position:relative;margin:clamp(1rem,4vh,3rem) 0}
.curve__svg{display:block;width:120%;margin-left:-10%;height:auto;overflow:visible}
.curve__svg text{fill:var(--ink);font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}}
.curve__plain{display:none}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .curve__svg{display:none}
  .curve__line{margin:1.5rem 0}
  .curve__plain{display:block;font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}font-size:clamp(1.6rem,7vw,2.6rem);line-height:1.1;padding:0 var(--gutter);text-align:center;max-width:22ch;margin:0 auto}
}`,
  html: (s, { esc }) => {
    const items = (s.items || []).map(it => (typeof it === "string" ? { text: it } : it)).filter(it => it && it.text).slice(0, 4);
    const uid = Math.random().toString(36).slice(2, 7);
    return `
<section class="curve" data-fx="curve-text">
  ${s.title ? `<div class="sec-head"><h2 class="display reveal">${esc(s.title)}</h2></div>` : ""}
  ${items.map((it, i) => {
    const p = PATHS[i % PATHS.length];
    const len = String(it.text).length;
    const fs = Math.round(Math.min(48, Math.max(26, 1300 / (len * 0.56))));
    const pid = `cvp-${uid}-${i}`, fid = `cvb-${uid}-${i}`;
    return `<div class="curve__line">
    <svg class="curve__svg" viewBox="0 0 1000 ${p.h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <defs><filter id="${fid}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur in="SourceGraphic" stdDeviation="0"/></filter></defs>
      <path id="${pid}" d="${p.d}" fill="none"/>
      <text filter="url(#${fid})" style="font-size:${fs}px"><textPath href="#${pid}">${esc(it.text)}</textPath></text>
    </svg>
    <p class="curve__plain">${esc(it.text)}</p>
  </div>`;
  }).join("")}
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="curve-text"]');
  if (!sec || !window.__fx.FX) return;
  var lines = [];
  sec.querySelectorAll('.curve__line').forEach(function(line){
    var svg = line.querySelector('svg'), path = svg && svg.querySelector('path'), tp = svg && svg.querySelector('textPath'), blur = svg && svg.querySelector('feGaussianBlur');
    if (!path || !tp) return;
    var L = path.getTotalLength();
    var o = { L: L, cur: L, target: L, speed: 0, blur: 0, active: false, tp: tp, fe: blur };
    tp.setAttribute('startOffset', L);
    ScrollTrigger.create({ trigger: line, start: 'top bottom', end: 'bottom top',
      onUpdate: function(self){ o.target = L - self.progress * 1.5 * L; o.speed = Math.abs(self.getVelocity()); },
      onToggle: function(self){ o.active = self.isActive; if (!o.active) { o.cur = o.target; o.blur = 0; tp.setAttribute('startOffset', o.cur); if (blur) blur.setAttribute('stdDeviation', 0); } } });
    lines.push(o);
  });
  if (!lines.length) return;
  gsap.ticker.add(function(){
    for (var i = 0; i < lines.length; i++) {
      var o = lines[i]; if (!o.active) continue;
      o.cur += (o.target - o.cur) * 0.22;
      var b = Math.min(10, o.speed / 300); o.blur += (b - o.blur) * 0.15; o.speed *= 0.9;
      o.tp.setAttribute('startOffset', o.cur.toFixed(1));
      if (o.fe) o.fe.setAttribute('stdDeviation', o.blur < 0.05 ? 0 : o.blur.toFixed(2));
    }
  });
})();`,
};
export default c;
