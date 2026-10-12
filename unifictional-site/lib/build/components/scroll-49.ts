// @ts-nocheck
// scroll-49 · Full-screen photo panels that snap into place, each photo moving at half speed so the next is uncovered from behind, with a curved title band that shrinks as it passes (Awwwards Pack).
import type { Component } from "./_types";

function pic(it, s, i) {
  if (it.image && it.image.url) return it.image;
  if (it.url) return it;
  if (s.images && s.images[i] && s.images[i].url) return s.images[i];
  if (/^https?:\/\//i.test(it.query || "")) return { url: it.query, alt: it.alt || "" };
  return null;
}

const c: Component = {
  id: "scroll-49",
  type: "snap-panels",
  kind: "section",
  weight: "light",
  describe: "snap-panels (scroll-49): 3-6 full-screen photo panels stacked one per screen. Each photo moves at half the speed of its frame, so the incoming picture is uncovered from behind the outgoing one rather than sliding in, and when scrolling stops the page eases to the nearest panel. Across each panel runs a gently curved band of its title repeated (1-3 words, e.g. a service, a role, a place) in huge display type that shrinks as the panel passes, with a short line of text (6-16 words) bottom-left. Set `loop: true` to append a copy of the first panel and jump back seamlessly (at most twice, then it releases so the page below is reachable); off by default and never on phones. Needs one landscape photo per panel. A lookbook, 'what we do' tour or venue walk-through for restaurants, photographers, gyms, venues and portfolios; on phones the panels are shorter, static and un-snapped.",
  fields: `{"type":"snap-panels","component":"scroll-49","loop":false,"items":[{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""},{"title":"","text":"","query":"","alt":""}]}`,
  images: { min: 3, max: 6 },
  css: ({ pair, capsRule }) => `
.snapp{background:var(--inv-bg);color:#fff}
.snapp__panel{position:relative;height:100svh;overflow:clip;display:grid;place-items:center}
.snapp__pic{position:absolute;inset:0;z-index:0;background:var(--inv-bg);will-change:transform}
.snapp__pic img{width:100%;height:100%;object-fit:cover}
.snapp__pic::after{content:"";position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.55),rgba(0,0,0,0) 45%)}
.snapp__band{position:relative;z-index:1;width:140vw;max-width:none;overflow:visible;will-change:transform;pointer-events:none}
.snapp__band text{font-family:var(--display);font-weight:${pair.weight};font-size:150px;letter-spacing:${pair.track};text-transform:uppercase;fill:#fff;paint-order:stroke;stroke:rgba(0,0,0,.25);stroke-width:2px}
.snapp__band tspan.dot{fill:var(--accent)}
.snapp__cap{position:absolute;left:var(--gutter);right:var(--gutter);bottom:clamp(2rem,6vh,4rem);z-index:2;display:flex;justify-content:space-between;align-items:flex-end;gap:2rem}
.snapp__cap p{max-width:38ch;font-size:1.05rem;color:rgba(255,255,255,.85)}
.snapp__cap .mono{color:rgba(255,255,255,.6);flex-shrink:0}
.snapp__dup{display:none}
.snapp.is-loop .snapp__dup{display:grid}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .snapp__panel{height:72svh}
  .snapp__pic{transform:none!important}
  .snapp__band{width:120vw;transform:none!important}
  .snapp__band text{font-size:170px}
  .snapp__cap{flex-direction:column;align-items:flex-start;gap:.6rem}
  .snapp.is-loop .snapp__dup{display:none}
}`,
  html: (s, { esc, imgUrl }) => {
    const items = (s.items || []).slice(0, 6);
    const panel = (it, i, dup) => {
      const p = pic(it, s, i);
      const title = esc(it.title || "");
      const reps = Array.from({ length: 6 }, () => `${title}<tspan class="dot"> . </tspan>`).join("");
      return `
  <section class="snapp__panel${dup ? " snapp__dup" : ""}" ${dup ? 'aria-hidden="true"' : ""}>
    <div class="snapp__pic">${p ? `<img src="${esc(imgUrl(p, 1800))}" alt="${dup ? "" : esc(it.alt || p.alt || it.title || "")}" loading="${i === 0 ? "eager" : "lazy"}">` : ""}</div>
    <svg class="snapp__band" viewBox="0 0 2400 300" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><defs><path id="snapp-p${i}${dup ? "d" : ""}" d="M -200 ${i % 2 ? 90 : 230} Q 1200 ${i % 2 ? 330 : -40} 2600 ${i % 2 ? 90 : 230}"/></defs><text><textPath href="#snapp-p${i}${dup ? "d" : ""}" startOffset="${(i * 13) % 40}%">${reps}</textPath></text></svg>
    <div class="snapp__cap"><p>${esc(it.text || "")}</p><span class="mono">${String(i + 1).padStart(2, "0")} / ${String(items.length).padStart(2, "0")}</span></div>
  </section>`;
    };
    return `
<div class="snapp${s.loop && items.length > 1 ? " is-loop" : ""}" data-fx="snap-panels">${items.map((it, i) => panel(it, i, false)).join("")}${s.loop && items.length > 1 ? panel(items[0], 0, true) : ""}</div>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="snap-panels"]');
  if (!sec || !window.__fx.FX) return;
  var panels = Array.prototype.slice.call(sec.querySelectorAll('.snapp__panel')).filter(function(p){ return getComputedStyle(p).display !== 'none'; });
  var n = panels.length; if (!n) return;
  panels.forEach(function(panel){
    var st = { trigger: panel, start: 'top bottom', end: 'bottom top', scrub: true };
    gsap.fromTo(panel.querySelector('.snapp__pic'), { yPercent: -50 }, { yPercent: 50, ease: 'none', scrollTrigger: st });
    gsap.fromTo(panel.querySelector('.snapp__band'), { scale: 1.5 }, { scale: 0.5, ease: 'none', scrollTrigger: st });
  });
  ScrollTrigger.create({ trigger: sec, start: 'top top', end: 'bottom bottom',
    snap: { snapTo: n > 1 ? 1 / (n - 1) : 1, duration: { min: 0.3, max: 0.8 }, delay: 0.25, ease: 'power3.out', directional: true } });
  if (sec.classList.contains('is-loop') && n > 2) {
    var wraps = 0, dup = panels[n - 1], first = panels[0], lenis = window.__fx.lenis;
    ScrollTrigger.create({ trigger: dup, start: 'top top+=2', onEnter: function(){
      if (wraps >= 2) return; wraps++;
      var y = first.getBoundingClientRect().top + window.pageYOffset;
      if (lenis) lenis.scrollTo(y, { immediate: true, force: true }); else window.scrollTo(0, y);
    } });
  }
})();`,
};
export default c;
