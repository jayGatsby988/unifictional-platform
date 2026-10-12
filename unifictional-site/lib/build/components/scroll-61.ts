// @ts-nocheck
// scroll-61 · Statement text that fills from grey to ink while read (Awwwards Pack).
import type { Component } from "./_types";

const c: Component = {
  id: "scroll-61",
  type: "statement",
  kind: "section",
  weight: "light",
  describe: "statement (scroll-61): one centred sentence of 14-26 words, set large, that fills from grey to ink as it passes the middle of the screen. Put the sharpest, truest claim here. Optional small label above.",
  fields: `{"type":"statement","component":"scroll-61","label":"","text":""}`,
  css: () => `
.statement{padding:clamp(6rem,18vh,14rem) var(--gutter);text-align:center}
.statement .label{margin-bottom:2.5rem}
.animate-text{position:relative;max-width:22ch;margin:0 auto;color:var(--ink3);--clip-value:100%;font-size:clamp(1.8rem,4.6vw,4.2rem)}
.animate-text::before{content:attr(data-text);position:absolute;inset:0;color:var(--ink);clip-path:inset(0 0 var(--clip-value) 0);will-change:clip-path}`,
  html: (s, { esc }) => `<section class="statement" data-fx="statement">${s.label ? `<div class="mono label">${esc(s.label)}</div>` : ""}<h2 class="display animate-text">${esc(s.text)}</h2></section>`,
  js: () => `
(function(){
  var RM = window.__fx.RM;
  document.querySelectorAll('.animate-text').forEach(function(el){
    el.setAttribute('data-text', el.textContent.trim());
    if (RM) { el.style.setProperty('--clip-value', '0%'); return; }
    ScrollTrigger.create({ trigger: el, start: 'top 70%', end: 'bottom 40%', scrub: 1, onUpdate: function(self){ el.style.setProperty('--clip-value', Math.max(0, 100 - self.progress * 100) + '%'); } });
  });
})();`,
};
export default c;
