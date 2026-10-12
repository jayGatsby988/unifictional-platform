// @ts-nocheck
// hero-type · Typographic hero (generic, lines rise in with GSAP).
import type { Component } from "./_types";

const c: Component = {
  id: "hero-type",
  type: "hero-type",
  kind: "hero",
  weight: "light",
  describe: "hero-type: a typographic hero; the headline is set huge over the page background and its lines rise in one by one; a small portrait photo sits top-right on desktop; eyebrow, sub and button. Put \"/\" inside the headline to break lines. Best for agencies, professional services, software, editorial brands, or any inner page that wants a quiet opening.",
  fields: `{"type":"hero-type","component":"hero-type","eyebrow":"","headline":"line one / line two","sub":"","cta":{"label":"","href":"contact"},"image":{"query":"","alt":""}}`,
  images: { min: 0, max: 1 },
  css: () => `
.hero-type{min-height:100svh;display:grid;align-content:end;gap:2rem;padding:7rem var(--gutter) 3rem;position:relative;overflow:hidden}
.hero-type h1{font-size:clamp(3rem,9vw,9.5rem);max-width:12ch}
.hero-type .hero-type__row{display:grid;gap:1.5rem;align-items:end}
@media(min-width:900px){.hero-type .hero-type__row{grid-template-columns:1fr auto}}
.hero-type p{max-width:44ch;color:var(--ink2);font-size:1.1rem}
.hero-type__media{position:absolute;right:var(--gutter);top:7rem;width:clamp(180px,24vw,360px);aspect-ratio:4/5;overflow:hidden;opacity:.9}
.hero-type__media img{width:100%;height:100%;object-fit:cover}
@media(max-width:899px){.hero-type__media{display:none}}
.hero-type .line{display:block;overflow:hidden}
.hero-type .line span{display:block;transform:translateY(110%)}
.hero-type--inner{min-height:62svh}
.hero-type--inner h1{font-size:clamp(2.6rem,7vw,7rem)}`,
  html: (s, { esc, imgUrl, link, arrow, page }) => {
    const lines = String(s.headline || "").split(/\s*\/\s*|\n/).filter(Boolean);
    const inner = page.slug !== "index";
    return `
<section class="hero-type${inner ? " hero-type--inner" : ""}" id="top" data-fx="hero-type">
  ${s.eyebrow ? `<span class="mono reveal">${esc(s.eyebrow)}</span>` : ""}
  <h1 class="display">${lines.map(l => `<span class="line"><span>${esc(l)}</span></span>`).join("")}</h1>
  <div class="hero-type__row">
    <p class="reveal">${esc(s.sub || "")}</p>
    ${s.cta ? `<a class="btn btn-primary reveal" href="${esc(link(s.cta.href))}">${esc(s.cta.label)}${arrow}</a>` : ""}
  </div>
  ${s.image ? `<div class="hero-type__media reveal"><img src="${esc(imgUrl(s.image, 1000))}" alt="${esc(s.image.alt || "")}"></div>` : ""}
</section>`;
  },
  js: () => `
(function(){
  var ht = document.querySelector('[data-fx="hero-type"]');
  if (ht) gsap.to(ht.querySelectorAll('.line span'), { y: 0, duration: window.__fx.RM ? 0.01 : 1.1, stagger: 0.08, ease: 'power4.out', delay: 0.15 });
})();`,
};
export default c;
