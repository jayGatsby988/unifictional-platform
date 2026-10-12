// @ts-nocheck
// The studio's own sections: the patterns from the sites the studio is known
// for (Integrity Garage Floors, Yetch Roofing, Go Far, Squeeze), built as
// components so every site gets a mix of pack effects and these. None of
// these is a pack effect; their ids are their type names.
//   manifesto      big bold paragraph with an accent phrase, revealed word by word, with a stats row
//   service-rail   numbered giant-headline list with one-line descriptions and arrow buttons; a photo follows the cursor
//   proof-feature  the flagship: big headline with an accent word, one photo, a round "as installed" badge
//   texture-loop   full-bleed looping close-up clip (or photo) of the material with a headline and a line
//   process-cards  horizontal scroll of numbered step cards with one live photo card, 01 / 06 counter
//   accent-marquee the accent-coloured band of promises right after the hero
//   areas-list     numbered cities with roles (HEADQUARTERS, ROOFING & EXTERIORS)
//   cta-review     the closing ask with one named review above it
//   split-intro    two-photo split opening for inner pages (Go Far)
//   preloader      a pill with the name that opens on load (site-wide; theme.preloader = "pill")
import type { Component } from "./_types";

/** A title written as "a / b" breaks into lines (the writers use " / " for a line break everywhere). */
const title = (str, esc) => String(str || "").split(/\s*\/\s*|\n/).filter(Boolean).map((l, i, a) => `${esc(l)}${i < a.length - 1 ? "<br>" : ""}`).join("");
const eyebrow = (s, esc, cls = "") => s.eyebrow ? `<div class="st-eyebrow${cls ? " " + cls : ""}"><i></i>${esc(s.eyebrow)}</div>` : "";
const shared = `
.st-eyebrow{display:flex;align-items:center;gap:.8rem;font-family:var(--mono);font-size:.68rem;letter-spacing:.22em;text-transform:uppercase;color:var(--ink2)}
.st-eyebrow i{width:28px;height:2px;background:var(--accent);display:inline-block}
.st-display{font-family:var(--display);font-weight:700;letter-spacing:-.02em;text-transform:uppercase;line-height:.92}
.st-accent{color:var(--accent)}`;

/* ------------------------------------------------------------ manifesto */
export const manifesto: Component = {
  id: "manifesto", type: "manifesto", kind: "section", weight: "light",
  describe: "manifesto (studio): the company's story in one big bold paragraph (40-70 words) that reveals word by word as you scroll, with one phrase in the accent colour and the last sentence left grey, then a row of 3-4 big stats with short labels. Right after the hero or the marquee. Dark or light.",
  fields: `{"type":"manifesto","eyebrow":"Who we are","text":"40-70 words in the company's voice; wrap the one phrase to colour in [[double brackets]]","stats":[{"value":"5","unit":"yr","label":"Limited warranty on every system"},{"value":"1","unit":"day","label":"Most floors done in one day"}]}`,
  css: ({ pair, capsRule }) => `${shared}
.mani{padding:clamp(5rem,12vh,9rem) var(--gutter) clamp(3rem,8vh,5rem)}
.mani__text{font-family:var(--body);font-weight:700;font-size:clamp(1.7rem,3.6vw,3.4rem);line-height:1.18;letter-spacing:-.02em;max-width:24ch;margin:1.6rem 0 0;color:var(--ink)}
.mani__text .w{color:var(--ink3);transition:color .25s}.mani__text .w.on{color:var(--ink)}.mani__text .w.acc.on{color:var(--accent)}
.mani__stats{display:grid;gap:0;margin-top:clamp(3rem,7vh,5rem);border-top:1px solid var(--line)}
@media(min-width:720px){.mani__stats{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}}
.mani__stat{padding:1.6rem 1.6rem 1.6rem 0;border-bottom:1px solid var(--line)}
@media(min-width:720px){.mani__stat{padding:1.8rem 1.4rem;border-bottom:0}.mani__stat+.mani__stat{border-left:1px solid var(--line)}}
.mani__v{font-family:var(--display);font-weight:700;font-size:clamp(2.6rem,5vw,4.4rem);line-height:1;letter-spacing:-.02em;color:var(--ink)}
.mani__v small{font-size:.42em;color:var(--accent);margin-left:.1em;text-transform:uppercase;letter-spacing:.02em}
.mani__l{margin-top:.6rem;font-size:.84rem;color:var(--ink2);max-width:22ch}`,
  html: (s, { esc }) => {
    const words = String(s.text || "").split(/(\[\[.*?\]\])/).flatMap(part => {
      const acc = /^\[\[.*\]\]$/.test(part); const txt = acc ? part.slice(2, -2) : part;
      return txt.split(/\s+/).filter(Boolean).map(w => `<span class="w${acc ? " acc" : ""}">${esc(w)}</span>`);
    }).join(" ");
    return `
<section class="mani" data-fx="manifesto">
  ${eyebrow(s, esc)}
  <p class="mani__text">${words}</p>
  ${(s.stats || []).length ? `<div class="mani__stats">${(s.stats || []).slice(0, 4).map(st => `<div class="mani__stat"><div class="mani__v">${esc(st.value)}${st.unit ? `<small>${esc(st.unit)}</small>` : ""}</div><div class="mani__l">${esc(st.label || "")}</div></div>`).join("")}</div>` : ""}
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="manifesto"]'); if (!sec) return;
  var ws = sec.querySelectorAll('.mani__text .w'); if (!ws.length) return;
  if (!window.__fx.FX) { ws.forEach(function(w){ w.classList.add('on'); }); return; }
  ScrollTrigger.create({ trigger: sec.querySelector('.mani__text'), start: 'top 78%', end: 'bottom 45%', scrub: 0.6, onUpdate: function(self){ var n = Math.round(self.progress * ws.length); ws.forEach(function(w, i){ w.classList.toggle('on', i < n); }); } });
})();`,
};

/* --------------------------------------------------------- service rail */
export const serviceRail: Component = {
  id: "service-rail", type: "service-rail", kind: "section", weight: "light",
  describe: "service-rail (studio): the services as a numbered list of giant headlines, each with a one-line description and a round arrow, a hairline between rows; a photo of that service follows the cursor along the row on hover. Every item links to its page. 4-8 items.",
  fields: `{"type":"service-rail","eyebrow":"What we do","title":"The floor, handled.","intro":"one sentence","items":[{"title":"Metallic epoxy","text":"one line, 8-14 words","href":"services/metallic","query":"real photo of this service"}]}`,
  images: { min: 0, max: 8 },
  css: ({ pair }) => `${shared}
.srail{padding:clamp(4rem,10vh,8rem) var(--gutter)}
.srail__head{display:grid;gap:1rem;margin-bottom:2.5rem;max-width:60rem}
.srail__head h2{font-size:clamp(2.4rem,6vw,6rem);margin:0}
.srail__head p{color:var(--ink2);max-width:52ch;font-size:1.05rem}
.srail__list{border-top:1px solid var(--line);position:relative}
.srail__row{display:grid;grid-template-columns:3rem 1fr auto 3.2rem;align-items:center;gap:1.5rem;padding:1.6rem 0;border-bottom:1px solid var(--line);color:inherit;text-decoration:none;position:relative}
.srail__n{font-family:var(--mono);font-size:.68rem;letter-spacing:.2em;color:var(--ink2)}
.srail__t{font-family:var(--display);font-weight:700;text-transform:uppercase;letter-spacing:-.02em;font-size:clamp(1.8rem,4.6vw,4.6rem);line-height:1;transition:transform .5s var(--ease-out)}
.srail__row:hover .srail__t{transform:translateX(.3em)}
.srail__d{color:var(--ink2);font-size:.9rem;max-width:26ch;text-align:right}
.srail__a{width:3.2rem;height:3.2rem;border:1px solid var(--line);border-radius:999px;display:grid;place-items:center;transition:background .3s,color .3s,border-color .3s}
.srail__a svg{width:16px;height:16px}
.srail__row:hover .srail__a{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.srail__img{position:absolute;width:min(22vw,320px);aspect-ratio:4/3;border-radius:6px;overflow:hidden;pointer-events:none;opacity:0;transform:translate(-50%,-50%) rotate(-3deg);z-index:3;box-shadow:0 30px 60px rgba(0,0,0,.35)}
.srail__img img{width:100%;height:100%;object-fit:cover;display:block}
@media(max-width:767px){.srail__row{grid-template-columns:2.4rem 1fr 2.6rem;row-gap:.4rem}.srail__d{grid-column:2;text-align:left;max-width:none}.srail__a{width:2.6rem;height:2.6rem}.srail__img{display:none}}`,
  html: (s, { esc, link, imgUrl }) => `
<section class="srail" data-fx="service-rail">
  <div class="srail__head">${eyebrow(s, esc)}<h2 class="st-display">${title(s.title, esc)}</h2>${s.intro ? `<p>${esc(s.intro)}</p>` : ""}</div>
  <div class="srail__list">${(s.items || []).slice(0, 8).map((it, i) => `<a class="srail__row" href="${esc(link(it.href || "services"))}" data-img="${esc(it.image?.url || "")}"><span class="srail__n">${String(i + 1).padStart(2, "0")}</span><span class="srail__t">${esc(it.title || "")}</span><span class="srail__d">${esc(it.text || "")}</span><span class="srail__a"><svg viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.4"/></svg></span></a>`).join("")}
    <div class="srail__img" aria-hidden="true"><img alt="" loading="lazy"></div>
  </div>
</section>`,
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="service-rail"]'); if (!sec || !window.__fx.FX || !window.matchMedia('(pointer: fine)').matches) return;
  var box = sec.querySelector('.srail__img'), img = box.querySelector('img'), list = sec.querySelector('.srail__list');
  var qx = gsap.quickTo(box, 'left', { duration: 0.5, ease: 'power3' }), qy = gsap.quickTo(box, 'top', { duration: 0.5, ease: 'power3' });
  list.addEventListener('mousemove', function(e){ var r = list.getBoundingClientRect(); qx(e.clientX - r.left); qy(e.clientY - r.top); });
  sec.querySelectorAll('.srail__row').forEach(function(row){
    row.addEventListener('mouseenter', function(){ var u = row.getAttribute('data-img'); if (!u) { gsap.to(box, { opacity: 0, duration: 0.2 }); return; } if (img.getAttribute('src') !== u) img.setAttribute('src', u); gsap.to(box, { opacity: 1, rotate: -3 + Math.random() * 6, duration: 0.3 }); });
    row.addEventListener('mouseleave', function(){ gsap.to(box, { opacity: 0, duration: 0.25 }); });
  });
})();`,
};

/* -------------------------------------------------------- proof feature */
export const proofFeature: Component = {
  id: "proof-feature", type: "proof-feature", kind: "section", weight: "light",
  describe: "proof-feature (studio): the flagship project as proof. Left: eyebrow 'Proof, not promises', a huge headline with one accent word (WE COATED THE FLOORS AT [[AMERICA'S]] CAR MUSEUM), a paragraph of the story, a link. Right: one real photo with a round badge ('As installed · LeMay Museum · Tacoma') that rotates slowly. Light or dark.",
  fields: `{"type":"proof-feature","eyebrow":"Proof, not promises","headline":"5-9 words with the accent word in [[double brackets]] (one short sentence; the detail goes in text)","text":"60-110 words: what it was, why it was hard, what they did, the result","badge":{"top":"only words that are true of THIS photo: 'Elevated decks' / 'Eastside' or 'Permitted' / 'Built in a week'; never a project, place or year unless the research ties this exact photo to it","mid":"","bottom":""},"cta":{"label":"See the work","href":"work"},"image":{"query":"a real photo; the badge must be true of it","alt":""}}`,
  images: { min: 1, max: 1 },
  css: ({ pair }) => `${shared}
.pf{padding:clamp(4rem,10vh,8rem) var(--gutter);display:grid;gap:3rem;align-items:center}
@media(min-width:900px){.pf{grid-template-columns:1.05fr 1fr;gap:4rem}}
.pf__h{font-size:clamp(2.2rem,5.2vw,5.4rem);margin:1.2rem 0 1.4rem;max-width:14ch}
.pf__p{color:var(--ink2);font-size:1.05rem;line-height:1.6;max-width:52ch}
.pf__cta{display:inline-flex;align-items:center;gap:.6rem;margin-top:1.6rem;font-family:var(--mono);font-size:.7rem;letter-spacing:.2em;text-transform:uppercase;color:var(--ink);text-decoration:none;border-bottom:1px solid var(--accent);padding-bottom:.3rem}
.pf__media{position:relative}
.pf__media img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;display:block}
.pf__badge{position:absolute;top:-2.2rem;right:-1rem;width:120px;height:120px;border-radius:999px;background:var(--ink);color:var(--bg);display:grid;place-items:center;text-align:center;font-family:var(--mono);font-size:.56rem;letter-spacing:.14em;text-transform:uppercase;line-height:1.5;padding:.8rem;box-shadow:0 18px 40px rgba(0,0,0,.25)}
.pf__badge b{color:var(--accent);display:block;font-weight:600}
@media(max-width:767px){.pf__badge{width:96px;height:96px;top:-1.4rem;right:.4rem;font-size:.5rem}}`,
  html: (s, { esc, link, imgUrl }) => {
    const h = String(s.headline || "").split(/(\[\[.*?\]\])/).map(part => /^\[\[.*\]\]$/.test(part) ? `<span class="st-accent">${esc(part.slice(2, -2))}</span>` : esc(part)).join("");
    const b = s.badge || {};
    return `
<section class="pf" data-fx="proof-feature">
  <div class="pf__copy reveal">${eyebrow(s, esc)}<h2 class="st-display pf__h">${h}</h2><p class="pf__p">${esc(s.text || "")}</p>${s.cta?.label ? `<a class="pf__cta" href="${esc(link(s.cta.href || "work"))}">${esc(s.cta.label)} →</a>` : ""}</div>
  <div class="pf__media reveal"><img src="${esc(imgUrl(s.image, 1600))}" alt="${esc(s.image?.alt || "")}" loading="lazy">${b.mid ? `<div class="pf__badge"><div>${esc(b.top || "")}<b>${esc(b.mid)}</b>${esc(b.bottom || "")}</div></div>` : ""}</div>
</section>`;
  },
  js: () => `
(function(){ var b = document.querySelector('[data-fx="proof-feature"] .pf__badge'); if (!b || !window.__fx.FX) return; gsap.to(b, { rotate: 360, duration: 24, repeat: -1, ease: 'none' }); })();`,
};

/* --------------------------------------------------------- texture loop */
export const textureLoop: Component = {
  id: "texture-loop", type: "texture-loop", kind: "section", weight: "medium",
  describe: "texture-loop (studio): a full-bleed looping close-up of the material itself (metallic epoxy moving, cedar grain, shingle texture) with a two-word headline in giant type and one line with a link. Uses the generated texture clip when the build made one, else the close-up photo with a slow drift. The section that makes the craft look expensive.",
  fields: `{"type":"texture-loop","headline":"Liquid / metal.","text":"one or two sentences about the material and why theirs is different","cta":{"label":"Explore metallic floors","href":"services/metallic"},"image":{"query":"close-up of the material","alt":""}}`,
  images: { min: 1, max: 1 },
  css: ({ pair }) => `${shared}
.tex{position:relative;min-height:min(92svh,860px);display:grid;align-items:center;overflow:hidden;background:#0b0b0c;color:#fff}
.tex__media{position:absolute;inset:0}
.tex__media video,.tex__media img{width:100%;height:100%;object-fit:cover;display:block;position:absolute;inset:0}
.tex__media img{transform:scale(1.08)}
.tex__media::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.55),rgba(0,0,0,.15) 55%,rgba(0,0,0,.4))}
.tex__in{position:relative;z-index:1;padding:clamp(4rem,10vh,7rem) var(--gutter);display:grid;gap:2rem;align-items:end}
@media(min-width:900px){.tex__in{grid-template-columns:1.1fr 1fr}}
.tex__h{font-size:clamp(3.2rem,10vw,11rem);line-height:.86;color:#fff;margin:0;text-shadow:0 2px 24px rgba(0,0,0,.4)}
.tex__h .ln{display:block}
.tex__p{font-size:clamp(1.05rem,1.4vw,1.35rem);line-height:1.5;color:rgba(255,255,255,.88);max-width:34rem}
.tex .btn{margin-top:1.4rem;background:#fff;color:#0b0b0c;border-color:#fff}`,
  html: (s, { esc, imgUrl, link, spec, arrow }) => {
    const clip = spec.video?.texture?.mp4 || "";
    const poster = spec.video?.texture?.poster || imgUrl(s.image, 2400);
    const lines = String(s.headline || "").split(/\s*\/\s*|\n/).filter(Boolean).map(l => `<span class="ln">${esc(l)}</span>`).join("");
    return `
<section class="tex" data-fx="texture-loop">
  <div class="tex__media">${clip ? `<video muted autoplay loop playsinline preload="metadata" poster="${esc(poster)}" src="${esc(clip)}"></video>` : `<img src="${esc(poster)}" alt="${esc(s.image?.alt || "")}" loading="lazy" data-drift>`}</div>
  <div class="tex__in"><h2 class="st-display tex__h">${lines}</h2><div><p class="tex__p">${esc(s.text || "")}</p>${s.cta?.label ? `<a class="btn" href="${esc(link(s.cta.href || "services"))}">${esc(s.cta.label)}${arrow}</a>` : ""}</div></div>
</section>`;
  },
  js: () => `
(function(){ var sec = document.querySelector('[data-fx="texture-loop"]'); if (!sec || !window.__fx.FX) return; var img = sec.querySelector('[data-drift]'); if (img) gsap.fromTo(img, { yPercent: -6, scale: 1.12 }, { yPercent: 6, scale: 1.08, ease: 'none', scrollTrigger: { trigger: sec, start: 'top bottom', end: 'bottom top', scrub: true } }); var v = sec.querySelector('video'); if (v) v.play().catch(function(){}); })();`,
};

/* -------------------------------------------------------- process cards */
export const processCards: Component = {
  id: "process-cards", type: "process-cards", kind: "section", weight: "light",
  describe: "process-cards (studio): the method as a horizontal row of numbered cards that scrolls sideways as the page scrolls (pinned), a counter 01 / 06 at the top right, each card with a giant ghost number, a title with the last word in the accent colour, three lines and a mono footnote; one card is a real photo of that step. 4-6 steps.",
  fields: `{"type":"process-cards","eyebrow":"The system","title":"Why our floors stay down.","steps":[{"title":"Diamond grind","text":"two or three sentences","note":"dust-controlled · HEPA extraction","query":"optional real photo of this step"}]}`,
  images: { min: 0, max: 6 },
  css: ({ pair }) => `${shared}
.pc{position:relative}
.pc__pin{padding:clamp(4rem,9vh,6rem) 0 clamp(3rem,7vh,5rem);overflow:hidden}
.pc__head{display:flex;justify-content:space-between;align-items:end;gap:2rem;padding:0 var(--gutter);margin-bottom:2rem}
.pc__head h2{font-size:clamp(2.2rem,5.6vw,5.6rem);margin:.8rem 0 0}
.pc__count{font-family:var(--mono);font-size:.72rem;letter-spacing:.2em;color:var(--ink2);white-space:nowrap}
.pc__track{display:flex;gap:1.4rem;padding:0 var(--gutter);will-change:transform}
.pc__card{flex:0 0 min(78vw,560px);min-height:min(62vh,520px);background:color-mix(in srgb,var(--ink) 4%,var(--bg));border:1px solid var(--line);border-radius:8px;padding:2rem;display:grid;align-content:space-between;position:relative;overflow:hidden}
.pc__ghost{font-family:var(--display);font-weight:800;font-size:clamp(4rem,8vw,7rem);line-height:1;color:transparent;-webkit-text-stroke:1px var(--line)}
.pc__t{font-family:var(--display);font-weight:700;text-transform:uppercase;letter-spacing:-.01em;font-size:clamp(1.5rem,2.6vw,2.4rem);line-height:1.05;margin:0 0 .8rem}
.pc__t b{color:var(--accent);font-weight:inherit}
.pc__card p{color:var(--ink2);line-height:1.55;max-width:44ch;margin:0}
.pc__note{margin-top:1.4rem;padding-top:1rem;border-top:1px solid var(--line);font-family:var(--mono);font-size:.62rem;letter-spacing:.18em;text-transform:uppercase;color:var(--ink3)}
.pc__card.is-photo{padding:0}
.pc__card.is-photo img{width:100%;height:100%;object-fit:cover;position:absolute;inset:0}
.pc__card.is-photo .pc__cap{position:absolute;left:1.2rem;bottom:1.2rem;font-family:var(--mono);font-size:.62rem;letter-spacing:.18em;text-transform:uppercase;color:#fff;text-shadow:0 1px 8px rgba(0,0,0,.6)}
@media(max-width:767px){.pc__track{overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;padding-bottom:1rem}.pc__card{scroll-snap-align:start;flex-basis:84vw;min-height:420px}}`,
  html: (s, { esc, imgUrl }) => {
    const steps = (s.steps || []).slice(0, 6);
    const titleOf = (t) => { const w = String(t || "").trim().split(" "); return w.length > 1 ? `${esc(w.slice(0, -1).join(" "))} <b>${esc(w[w.length - 1])}</b>` : esc(t || ""); };
    const cards = steps.flatMap((st, i) => {
      const card = `<article class="pc__card"><div class="pc__ghost">${String(i + 1).padStart(2, "0")}</div><div><h3 class="pc__t">${titleOf(st.title)}</h3><p>${esc(st.text || "")}</p>${st.note ? `<div class="pc__note">${esc(st.note)}</div>` : ""}</div></article>`;
      const photo = st.image?.url ? `<article class="pc__card is-photo"><img src="${esc(st.image.url)}" alt="${esc(st.image.alt || st.title || "")}" loading="lazy"><div class="pc__cap">${esc(st.title || "")} — live</div></article>` : "";
      return [card, photo].filter(Boolean);
    });
    return `
<section class="pc" data-fx="process-cards" data-n="${steps.length}">
  <div class="pc__pin">
    <div class="pc__head"><div>${eyebrow(s, esc)}<h2 class="st-display">${title(s.title, esc)}</h2></div><div class="pc__count"><span data-pc-i>01</span> / ${String(steps.length).padStart(2, "0")}</div></div>
    <div class="pc__track">${cards.join("")}</div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="process-cards"]'); if (!sec || !window.__fx.FX) return;
  var track = sec.querySelector('.pc__track'), pin = sec.querySelector('.pc__pin'), ci = sec.querySelector('[data-pc-i]'), n = parseInt(sec.getAttribute('data-n'), 10) || 1;
  var dist = function(){ return Math.max(0, track.scrollWidth - window.innerWidth + 40); };
  gsap.to(track, { x: function(){ return -dist(); }, ease: 'none', scrollTrigger: { trigger: sec, start: 'top top', end: function(){ return '+=' + (dist() + window.innerHeight * 0.4); }, pin: pin, scrub: 0.6, invalidateOnRefresh: true, onUpdate: function(self){ if (ci) ci.textContent = ('0' + Math.min(n, Math.max(1, Math.round(self.progress * (n - 1)) + 1))).slice(-2); } } });
})();`,
};

/* ------------------------------------------------------- accent marquee */
export const accentMarquee: Component = {
  id: "accent-marquee", type: "accent-marquee", kind: "section", weight: "light",
  describe: "accent-marquee (studio): a thin band in the accent colour (or ink) right after the hero, with the services and promises scrolling slowly (COMMERCIAL · INDUSTRIAL · 5-YEAR WARRANTY · 1-DAY INSTALL). 5-10 short items.",
  fields: `{"type":"accent-marquee","items":["Commercial","Industrial","5-year warranty","1-day install"],"tone":"ink|accent"}`,
  css: () => `
.amq{overflow:hidden;border-top:3px solid var(--accent);border-bottom:1px solid var(--line);padding:1.1rem 0;background:var(--bg)}
.amq.is-accent{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
.amq__track{display:flex;gap:0;white-space:nowrap;will-change:transform}
.amq__item{display:inline-flex;align-items:center;gap:2.4rem;padding:0 1.2rem;font-family:var(--display);font-weight:700;text-transform:uppercase;letter-spacing:.08em;font-size:clamp(.9rem,1.3vw,1.15rem)}
.amq__item i{width:6px;height:6px;background:var(--accent);transform:rotate(45deg);display:inline-block}
.amq.is-accent .amq__item i{background:var(--on-accent)}`,
  html: (s, { esc }) => {
    const items = (s.items || []).slice(0, 10);
    const unit = items.map(it => `<span class="amq__item"><i></i>${esc(it)}</span>`).join("");
    return `<section class="amq${s.tone === "accent" ? " is-accent" : ""}" data-fx="accent-marquee" aria-hidden="true"><div class="amq__track">${unit}${unit}${unit}</div></section>`;
  },
  js: () => `
(function(){ var t = document.querySelector('[data-fx="accent-marquee"] .amq__track'); if (!t) return; var w = t.scrollWidth / 3; if (!w) return; gsap.to(t, { x: -w, duration: Math.max(18, w / 60), ease: 'none', repeat: -1 }); })();`,
};

/* ----------------------------------------------------------- areas list */
export const areasList: Component = {
  id: "areas-list", type: "areas-list", kind: "section", weight: "light",
  describe: "areas-list (studio): where they work, as a numbered list of cities with a role under each (HEADQUARTERS · ROOFING & EXTERIORS), big type, and the address and hours in a side column. 3-8 places.",
  fields: `{"type":"areas-list","eyebrow":"Where we build","title":"Puget Sound, covered.","items":[{"city":"Mill Creek","role":"Headquarters","href":"areas/mill-creek"}],"aside":{"label":"Headquarters","lines":["1321 Central Ave S","Kent, WA 98032","Mon–Sat 7–6"]}}`,
  css: () => `${shared}
.ar{padding:clamp(4rem,10vh,8rem) var(--gutter);display:grid;gap:2.5rem 4rem;max-width:1720px;margin-inline:auto;box-sizing:border-box}
.ar__list{grid-column:1/-1}
@media(min-width:900px){.ar{grid-template-columns:1.4fr 1fr;align-items:end}}
@media(min-width:1100px){.ar__list{display:grid;grid-template-columns:1fr 1fr;column-gap:4rem;border-top:0}.ar__row{border-top:1px solid var(--line);border-bottom:0}.ar__row:nth-last-child(-n+2){border-bottom:1px solid var(--line)}}
.ar h2{font-size:clamp(2.2rem,5.6vw,5.6rem);margin:.8rem 0 2rem}
.ar__list{border-top:1px solid var(--line)}
.ar__row{display:grid;grid-template-columns:3rem 1fr;align-items:baseline;gap:1rem;padding:1.1rem 0;border-bottom:1px solid var(--line);color:inherit;text-decoration:none}
.ar__n{font-family:var(--mono);font-size:.66rem;letter-spacing:.2em;color:var(--ink2)}
.ar__c{font-family:var(--display);font-weight:700;text-transform:uppercase;letter-spacing:-.01em;font-size:clamp(1.5rem,3.4vw,3.2rem);line-height:1}
.ar__r{display:block;margin-top:.3rem;font-family:var(--mono);font-size:.62rem;letter-spacing:.2em;text-transform:uppercase;color:var(--accent)}
.ar__aside{align-self:end;padding:1.6rem;border:1px solid var(--line);border-radius:8px}
.ar__aside .st-eyebrow{margin-bottom:.8rem}
.ar__aside p{margin:0;color:var(--ink2);line-height:1.6}`,
  html: (s, { esc, link }) => `
<section class="ar" data-fx="areas-list">
  <div class="ar__head">${eyebrow(s, esc)}<h2 class="st-display">${title(s.title, esc)}</h2></div>
  ${s.aside ? `<aside class="ar__aside">${s.aside.label ? `<div class="st-eyebrow"><i></i>${esc(s.aside.label)}</div>` : ""}<p>${(s.aside.lines || []).map(esc).join("<br>")}</p></aside>` : ""}
    <div class="ar__list">${(s.items || []).slice(0, 8).map((it, i) => `<${it.href ? "a" : "div"} class="ar__row"${it.href ? ` href="${esc(link(it.href))}"` : ""}><span class="ar__n">${String(i + 1).padStart(2, "0")}</span><span><span class="ar__c">${esc(it.city || "")}</span>${it.role ? `<span class="ar__r">${esc(it.role)}</span>` : ""}</span></${it.href ? "a" : "div"}>`).join("")}</div>
</section>`,
};

/* ----------------------------------------------------------- cta review */
export const ctaReview: Component = {
  id: "cta-review", type: "cta-review", kind: "section", weight: "light",
  describe: "cta-review (studio): the closing screen: one named review in big quiet type above the ask, then the headline (YOUR FLOOR, DONE IN A DAY.), a line, two buttons and the phone number. Ends the home page.",
  fields: `{"type":"cta-review","review":{"quote":"verbatim, named","name":"Dana R.","role":"Google review"},"headline":"Your floor, done in a day.","text":"one line: the promise","cta":{"label":"Get your free estimate","href":"contact"},"cta2":{"label":"Call (425) 444-0232","href":"tel:4254440232"}}`,
  css: () => `${shared}
.cr{padding:clamp(5rem,12vh,9rem) var(--gutter);text-align:center;display:grid;gap:2.4rem;justify-items:center}
.cr__q{max-width:44ch;font-size:clamp(1.15rem,1.8vw,1.6rem);line-height:1.45;color:var(--ink2);font-style:italic}
.cr__who{display:block;margin-top:1rem;font-family:var(--mono);font-size:.64rem;letter-spacing:.2em;text-transform:uppercase;color:var(--ink3);font-style:normal}
.cr h2{font-size:clamp(2.6rem,7vw,7.2rem);margin:0;max-width:16ch}
.cr p{color:var(--ink2);max-width:40ch;margin:0;font-size:1.05rem}
.cr__btns{display:flex;gap:.8rem;flex-wrap:wrap;justify-content:center}`,
  html: (s, { esc, link, arrow }) => `
<section class="cr" id="contact" data-fx="cta-review">
  ${s.review?.quote ? `<blockquote class="cr__q reveal">“${esc(s.review.quote)}”<cite class="cr__who">${esc(s.review.name || "")}${s.review.role ? " · " + esc(s.review.role) : ""}</cite></blockquote>` : ""}
  <h2 class="st-display reveal">${title(s.headline, esc)}</h2>
  ${s.text ? `<p class="reveal">${esc(s.text)}</p>` : ""}
  <div class="cr__btns reveal">${s.cta?.label ? `<a class="btn btn-primary" href="${esc(link(s.cta.href || "contact"))}">${esc(s.cta.label)}${arrow}</a>` : ""}${s.cta2?.label ? `<a class="btn btn-ghost" href="${esc(link(s.cta2.href || "contact"))}">${esc(s.cta2.label)}</a>` : ""}</div>
</section>`,
};

/* ----------------------------------------------------------- split intro */
export const splitIntro: Component = {
  id: "split-intro", type: "split-intro", kind: "hero", weight: "light",
  describe: "split-intro (studio): an opening for inner pages in the Go Far pattern: two real photos side by side at different heights, the page's eyebrow, headline and one line over the left column, the ask on the right. Calm, photographic, no effect fighting the photos.",
  fields: `{"type":"split-intro","eyebrow":"Kitchen remodeling · Lynnwood","headline":"6-12 words, what the buyer gets","sub":"one sentence","cta":{"label":"Book a consultation","href":"contact"},"images":[{"query":"real photo","alt":""},{"query":"real photo","alt":""}]}`,
  images: { min: 2, max: 2 },
  css: () => `${shared}
.si{display:grid;min-height:100svh;padding-top:76px}
@media(min-width:900px){.si{grid-template-columns:1fr 1fr}}
.si__l{position:relative;display:grid;align-content:end;padding:clamp(3rem,8vh,6rem) var(--gutter);gap:1rem}
.si__l img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;filter:brightness(.72)}
.si__l>*{position:relative;z-index:1;color:#fff}
.si__l .st-eyebrow{color:rgba(255,255,255,.85)}.si__l .st-eyebrow i{background:#fff}
.si__l h1{font-size:clamp(2.4rem,5.4vw,5.4rem);margin:0;text-shadow:0 2px 18px rgba(0,0,0,.4)}
.si__l p{max-width:40ch;color:rgba(255,255,255,.88)}
.si__r{position:relative;display:grid;align-content:end;justify-items:end;padding:clamp(2rem,6vh,4rem) var(--gutter)}
.si__r img{width:100%;height:min(70vh,640px);object-fit:cover;display:block;border-radius:6px;margin-bottom:1.4rem}
@media(max-width:899px){.si__l{min-height:60svh}.si__r img{height:40vh}}`,
  html: (s, { esc, imgUrl, link, arrow }) => {
    const [a, b] = [(s.images || [])[0], (s.images || [])[1]];
    return `
<section class="si" id="top" data-fx="split-intro">
  <div class="si__l">${a ? `<img src="${esc(imgUrl(a, 1600))}" alt="${esc(a.alt || "")}" fetchpriority="high">` : ""}${eyebrow(s, esc)}<h1 class="st-display">${esc(s.headline || "")}</h1>${s.sub ? `<p>${esc(s.sub)}</p>` : ""}</div>
  <div class="si__r">${b ? `<img src="${esc(imgUrl(b, 1600))}" alt="${esc(b.alt || "")}" loading="lazy">` : ""}${s.cta?.label ? `<a class="btn btn-primary" href="${esc(link(s.cta.href || "contact"))}">${esc(s.cta.label)}${arrow}</a>` : ""}</div>
</section>`;
  },
};

/* -------------------------------------------------------------- preloader */
export const preloader: Component = {
  id: "preloader", type: "preloader", kind: "transition", weight: "light",
  describe: "preloader (studio, site-wide; theme.preloader = \"pill\"): on first load a pill with the company's logo or name sits on the page colour while a percentage counts up, the pill's dark half slides away and the name splits open to reveal the page. Go Far's opening. Once per visit (session), never on inner-page navigation.",
  fields: `theme.preloader = "pill" (no section fields)`,
  css: ({ pair }) => `
.pre{position:fixed;inset:0;z-index:100;background:var(--bg);display:grid;place-items:center;transition:opacity .6s var(--ease)}
.pre.is-done{opacity:0;pointer-events:none}
.pre__pill{position:relative;width:min(70vw,980px);height:min(34vw,300px);border-radius:999px;overflow:hidden;background:var(--bg2);border:1px solid var(--line)}
.pre__dark{position:absolute;inset:0;left:50%;background:var(--ink);transform-origin:left;transform:scaleX(1)}
.pre__name{position:absolute;inset:0;display:grid;place-items:center;font-family:var(--display);font-weight:700;letter-spacing:-.02em;text-transform:uppercase;font-size:clamp(1.8rem,4.2vw,4rem);color:var(--ink);z-index:1}
.pre__name img,.pre__name svg{height:clamp(40px,8vw,90px);width:auto;max-width:60%;object-fit:contain}
.pre__tag{position:absolute;left:0;right:0;bottom:3rem;text-align:center;font-family:var(--mono);font-size:.64rem;letter-spacing:.22em;text-transform:uppercase;color:var(--ink2)}
.pre__pct{position:absolute;right:var(--gutter);bottom:3rem;font-family:var(--mono);font-size:.7rem;letter-spacing:.2em;color:var(--ink2)}
@media(max-width:767px){.pre__pill{width:84vw;height:40vw}.pre__tag{bottom:2.2rem;padding:0 var(--gutter)}.pre__pct{bottom:4.4rem;right:auto;left:50%;transform:translateX(-50%)}}
@media(prefers-reduced-motion:reduce){.pre{display:none}}`,
  html: (_, { spec, esc, brandMark }) => `
<div class="pre" data-fx="preloader" aria-hidden="true">
  <div class="pre__pill"><div class="pre__dark"></div><div class="pre__name">${spec.brand?.logo?.url ? `<img src="${esc(spec.brand.logo.url)}" alt="">` : esc(spec.brand?.name || "")}</div></div>
  <div class="pre__tag">${esc([spec.brand?.industry, spec.brand?.city].filter(Boolean).join(" — "))}</div>
  <div class="pre__pct"><span data-pre-pct>0</span>%</div>
</div>`,
  js: () => `
(function(){
  var pre = document.querySelector('[data-fx="preloader"]'); if (!pre) return;
  var seen = false; try { seen = sessionStorage.getItem('pre-seen') === '1'; } catch (e) {}
  if (seen || !window.gsap || window.__fx.RM) { pre.remove(); return; }
  try { sessionStorage.setItem('pre-seen', '1'); } catch (e) {}
  var L = window.__fx.lenis; if (L) L.stop();
  var pct = pre.querySelector('[data-pre-pct]'), o = { v: 0 };
  var tl = gsap.timeline({ onComplete: function(){ pre.classList.add('is-done'); if (L) L.start(); setTimeout(function(){ pre.remove(); if (window.ScrollTrigger) ScrollTrigger.refresh(); }, 700); } });
  tl.to(o, { v: 100, duration: 1.4, ease: 'power2.inOut', onUpdate: function(){ if (pct) pct.textContent = Math.round(o.v); } }, 0)
    .to(pre.querySelector('.pre__dark'), { scaleX: 0, duration: 1.2, ease: 'expo.inOut' }, 0.4)
    .to(pre.querySelector('.pre__name'), { scale: 1.08, opacity: 0, duration: 0.5, ease: 'power2.in' }, 1.5)
    .to(pre.querySelector('.pre__pill'), { scaleY: 0.02, duration: 0.6, ease: 'expo.inOut' }, 1.6);
})();`,
};

export const studio: Component[] = [manifesto, serviceRail, proofFeature, textureLoop, processCards, accentMarquee, areasList, ctaReview, splitIntro, preloader];
