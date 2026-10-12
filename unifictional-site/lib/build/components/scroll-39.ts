// @ts-nocheck
// scroll-39 · Scattered tag pills gather into one dot that stretches into a search bar under a new headline (Awwwards Pack).
import type { Component } from "./_types";

// Scattered start positions (% of the stage), used in order.
const POS = [[25, 15], [12, 50], [22, 76], [32, 86], [50, 18], [80, 20], [75, 76], [68, 10], [14, 30], [86, 46], [60, 90], [40, 8], [88, 70], [8, 68], [70, 36], [30, 60]];

const c: Component = {
  id: "scroll-39",
  type: "tags-merge",
  kind: "section",
  weight: "light",
  describe: "tags-merge (scroll-39): a pinned screen opens with a 5-9 word statement in the middle and 8-16 small outlined tags (services, areas, keywords, 1-3 words each) scattered around it. As you scroll the statement slides up and out, the tag labels fade, and the pills drift to the centre while shrinking into round dots that pile into one. The dot drops a little and stretches sideways into a wide rounded bar, a short line of placeholder text (3-8 words) fades into it, and a new 4-8 word headline with one sentence settles in above it. Needs: `title` (the opening statement), `items` (the tags), `headline` + `sub` (the pitch), `text` (the bar's line, e.g. 'Decks, fences, pergolas: ask us'), optional `cta`. For an 'everything we do' or 'all of it, one call' moment; on phones the statement, the tags as a wrapped list, then the headline and bar.",
  fields: `{"type":"tags-merge","component":"scroll-39","title":"","headline":"","sub":"","text":"","cta":{"label":"","href":"contact"},"items":[{"title":""},{"title":""},{"title":""},{"title":""},{"title":""},{"title":""},{"title":""},{"title":""}]}`,
  css: ({ pair, capsRule }) => `
.tags{height:400svh}
.tags__stage{position:sticky;top:0;height:100svh;overflow:hidden}
.tags__open,.tags__head{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:0 var(--gutter);text-align:center;will-change:transform,opacity}
.tags__open h2{font-size:clamp(2rem,4.6vw,4.6rem);max-width:18ch}
.tags__head{opacity:0;transform:translateY(-50px)}
.tags__head div{display:grid;gap:1.2rem;justify-items:center;max-width:46rem;transform:translateY(-18vh)}
.tags__head h2{font-size:clamp(2rem,4.4vw,4.2rem);max-width:18ch}
.tags__head p{color:var(--ink2);font-size:1.05rem;max-width:44ch}
.tags__pills{position:absolute;inset:0}
.tags__pill{position:absolute;top:var(--t);left:var(--l);transform:translate(-50%,-50%);height:2.6rem;padding:0 1.2rem;display:flex;align-items:center;justify-content:center;white-space:nowrap;border:2px solid var(--line);border-radius:999px;background:var(--bg2);font-family:var(--mono);font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink2);will-change:transform,width,height;overflow:hidden}
.tags__pill span{display:block}
.tags__bar{position:absolute;top:50%;left:50%;width:3rem;height:3rem;transform:translate(-50%,-50%);border:4px solid var(--line);border-radius:999px;background:var(--bg2);opacity:0;display:flex;align-items:center;gap:1rem;padding:0 1.4rem;overflow:hidden;white-space:nowrap;will-change:width,height,transform,opacity}
.tags__bar p{opacity:0;color:var(--ink2);font-size:.95rem;flex:1;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tags__bar .btn{opacity:0;flex-shrink:0;padding:.55em 1em;font-size:.8rem}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .tags{height:auto}
  .tags__stage{position:static;height:auto;overflow:visible;padding:4rem var(--gutter);display:grid;gap:2.5rem}
  .tags__open,.tags__head{position:static;inset:auto;opacity:1;transform:none!important;padding:0}
  .tags__head div{transform:none}
  .tags__pills{position:static;display:flex;flex-wrap:wrap;gap:.6rem;justify-content:center}
  .tags__pill{position:static;transform:none!important;width:auto!important;height:2.4rem!important;padding:0 1rem}
  .tags__head{order:3}
  .tags__bar{position:static;order:4;transform:none!important;width:100%!important;height:auto!important;min-height:3.4rem;opacity:1!important;padding:.6rem .6rem .6rem 1.2rem;white-space:normal;border-radius:1.6rem;border-width:2px;flex-wrap:wrap;gap:.8rem}
  .tags__bar p{white-space:normal;overflow:visible;text-overflow:clip;flex:1 1 12rem}
  .tags__bar p,.tags__bar .btn{opacity:1!important}
}`,
  html: (s, { esc, link, arrow }) => {
    const items = (s.items || []).slice(0, 16);
    return `
<section class="tags" data-fx="tags-merge">
  <div class="tags__stage">
    <div class="tags__open"><h2 class="display">${esc(s.title || "")}</h2></div>
    <div class="tags__pills">${items.map((it, i) => `<div class="tags__pill" style="--t:${POS[i % POS.length][0]}%;--l:${POS[i % POS.length][1]}%"><span>${esc(it.title || it.label || "")}</span></div>`).join("")}</div>
    <div class="tags__bar"><p>${esc(s.text || "")}</p>${s.cta && s.cta.label ? `<a class="btn btn-primary" href="${esc(link(s.cta.href))}">${esc(s.cta.label)}${arrow}</a>` : ""}</div>
    <div class="tags__head"><div><h2 class="display">${esc(s.headline || "")}</h2>${s.sub ? `<p>${esc(s.sub)}</p>` : ""}</div></div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="tags-merge"]');
  if (!sec || !window.__fx.FX) return;
  var stage = sec.querySelector('.tags__stage'), open = sec.querySelector('.tags__open'), head = sec.querySelector('.tags__head'), bar = sec.querySelector('.tags__bar');
  var pills = Array.prototype.slice.call(sec.querySelectorAll('.tags__pill')), labels = sec.querySelectorAll('.tags__pill span');
  var barW = function(){ return Math.min(stage.clientWidth * 0.8, 30 * 16); };
  var tl = gsap.timeline({ scrollTrigger: { trigger: sec, start: 'top top', end: 'bottom bottom', scrub: 0.8, invalidateOnRefresh: true } });
  tl.to(open, { yPercent: -100, duration: 0.3, ease: 'none' }, 0)
    .to(labels, { opacity: 0, duration: 0.08, ease: 'none' }, 0)
    .to(pills, { duration: 0.45, ease: 'power1.inOut', width: '2.6rem', height: '2.6rem', padding: 0, borderWidth: '5px',
      x: function(i, el){ var r = stage.getBoundingClientRect(), p = el.getBoundingClientRect(); return r.left + r.width / 2 - (p.left + p.width / 2) + (gsap.getProperty(el, 'x') || 0); },
      y: function(i, el){ var r = stage.getBoundingClientRect(), p = el.getBoundingClientRect(); return r.top + r.height / 2 - (p.top + p.height / 2) + (gsap.getProperty(el, 'y') || 0); } }, 0.05)
    .set(pills, { opacity: 0 }, 0.5)
    .set(bar, { opacity: 1 }, 0.5)
    .to(bar, { duration: 0.22, ease: 'power2.inOut', width: barW, height: '4.6rem', yPercent: 120 }, 0.5)
    .to(bar.querySelectorAll('p, .btn'), { opacity: 1, duration: 0.15, ease: 'none' }, 0.74)
    .to(head, { opacity: 1, y: 0, duration: 0.2, ease: 'power2.out' }, 0.74)
    .set({}, {}, 1);
})();`,
};
export default c;
