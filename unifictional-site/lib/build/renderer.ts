// @ts-nocheck
/* =====================================================================
   Unifictional · renderer.ts
   Turns a SITE SPEC (JSON) into complete, standalone HTML pages that use
   the Awwwards Pack effects. Components live in ./components, one file
   each; this file owns the page frame (fonts, tokens, base CSS, nav,
   footer, runtime prelude) and the multi-page assembly.

   SPEC CONTRACT (v2, multi-page)
   {
     brand:  { name, tagline, industry, city, serviceArea?, phone?, email?, address?, hours?, domain?, voice?,
               social?: {instagram?, facebook?, google?, yelp?, houzz?, linkedin?, youtube?, tiktok?},
               logo?: {url, kind:"img"|"svg", onDark?: "invert"|"pill"|"none"} }
     theme:  { mode: "dark"|"light", accent: "#hex", pair: "oswald"|"syne"|"serif"|"grotesk"|"fraunces"|"bricolage"|"custom",
               fonts?: {display, body} (only with pair "custom", Google Fonts family names) }
     nav:    { menu: "<menu component id>", links: [{label, href}], cta: {label, href} }
             href is a page slug ("about", "services/decks"), "#anchor", "tel:…", "mailto:…" or an absolute URL.
     pages:  [{ slug: "index"|"about"|"services"|"services/<slug>"|"work"|"reviews"|"contact"|"areas/<slug>"|…,
                title, seo: {title, description, keywords[]}, sections: [ {type, component?, …} ] }]
     footer: { blurb, columns:[{title, links:[{label, href}]}] }
     rationale: string
   }
   Section types and their fields are declared by the components
   (components/index.ts → byType[type].fields). Image fields are
   {query, alt} and are resolved to {query, alt, url} by images.ts before
   rendering (a query that is already a URL passes through).
   ===================================================================== */
import { COMPONENTS, byType, byId } from "./components";

export const FONT_PAIRS = {
  oswald:    { display: "'Oswald', sans-serif", body: "'Hanken Grotesk', system-ui, sans-serif", mono: "'Space Mono', monospace", google: "Oswald:wght@400;500;600&family=Hanken+Grotesk:wght@300;400;500;600&family=Space+Mono:wght@400", caps: true, weight: 500, track: "-0.015em" },
  // the studio's reference pairs (Integrity: Archivo + Satoshi; Yetch / Go Far: Clash Display + Satoshi; Squeeze: Anton + Inter Tight; Caldera: Jost)
  clash:     { display: "'Clash Display', sans-serif", body: "'Satoshi', system-ui, sans-serif", mono: "'JetBrains Mono', monospace", google: "JetBrains+Mono:wght@400", css: ["https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&f[]=satoshi@400,500,700&display=swap"], caps: true, weight: 600, track: "-0.02em" },
  archivo:   { display: "'Archivo', sans-serif", body: "'Satoshi', system-ui, sans-serif", mono: "'Space Mono', monospace", google: "Archivo:wdth,wght@112,600;112,700;112,800&family=Space+Mono:wght@400", css: ["https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap"], caps: true, weight: 800, track: "-0.01em" },
  anton:     { display: "'Anton', sans-serif", body: "'Inter Tight', system-ui, sans-serif", mono: "'IBM Plex Mono', monospace", google: "Anton&family=Inter+Tight:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400", caps: true, weight: 400, track: "0" },
  jost:      { display: "'Jost', sans-serif", body: "'Jost', system-ui, sans-serif", mono: "'DM Mono', monospace", google: "Jost:wght@300;400;500;600;700&family=DM+Mono:wght@400", caps: true, weight: 600, track: "-0.01em" },
  syne:      { display: "'Syne', sans-serif", body: "'Inter', system-ui, sans-serif", mono: "'JetBrains Mono', monospace", google: "Syne:wght@500;600;700;800&family=Inter:wght@300;400;500&family=JetBrains+Mono:wght@400", caps: false, weight: 700, track: "-0.03em" },
  serif:     { display: "'Instrument Serif', serif", body: "'Manrope', system-ui, sans-serif", mono: "'DM Mono', monospace", google: "Instrument+Serif:ital@0;1&family=Manrope:wght@300;400;500;600&family=DM+Mono:wght@400", caps: false, weight: 400, track: "-0.02em" },
  grotesk:   { display: "'Space Grotesk', sans-serif", body: "'Inter', system-ui, sans-serif", mono: "'Space Mono', monospace", google: "Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500&family=Space+Mono:wght@400", caps: false, weight: 600, track: "-0.03em" },
  fraunces:  { display: "'Fraunces', serif", body: "'Inter', system-ui, sans-serif", mono: "'JetBrains Mono', monospace", google: "Fraunces:opsz,wght@9..144,300;9..144,500;9..144,600&family=Inter:wght@300;400;500&family=JetBrains+Mono:wght@400", caps: false, weight: 500, track: "-0.025em" },
  bricolage: { display: "'Bricolage Grotesque', sans-serif", body: "'Inter', system-ui, sans-serif", mono: "'JetBrains Mono', monospace", google: "Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Inter:wght@300;400;500&family=JetBrains+Mono:wght@400", caps: false, weight: 700, track: "-0.03em" },
};
export const FONT_PAIR_IDS = Object.keys(FONT_PAIRS);

export const esc = (s = "") => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const slug = (s = "") => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function themeTokens(theme = {}) {
  const dark = (theme.mode || "dark") === "dark";
  let accent = /^#[0-9a-f]{3,6}$/i.test(theme.accent || "") ? theme.accent : (dark ? "#D4FF3F" : "#0E0E0E");
  const onAccent = luminance(accent) > 0.4 ? "#0b0b0c" : "#ffffff";
  return {
    bg: dark ? (theme.bg || "#0B0B0C") : (theme.bg || "#F4F3EE"),
    bg2: dark ? "#131315" : "#FFFFFF",
    ink: dark ? "#F2F1EC" : "#0E0E0E",
    ink2: dark ? "rgba(242,241,236,.62)" : "rgba(14,14,14,.62)",
    ink3: dark ? "rgba(242,241,236,.34)" : "rgba(14,14,14,.38)",
    line: dark ? "rgba(242,241,236,.12)" : "rgba(14,14,14,.12)",
    accent, onAccent,
    invBg: dark ? "#F4F3EE" : "#0B0B0C",
    invInk: dark ? "#0E0E0E" : "#F2F1EC",
    dark,
  };
}

// A "custom" pair uses the company's own Google Fonts when the analysis found them.
function resolvePair(theme = {}) {
  if (theme.pair === "custom" && theme.fonts?.display) {
    const disp = theme.fonts.display, body = theme.fonts.body || "Inter";
    const g = (f) => f.trim().replace(/\s+/g, "+");
    return { display: `'${disp}', sans-serif`, body: `'${body}', system-ui, sans-serif`, mono: "'Space Mono', monospace", google: `${g(disp)}:wght@400;500;600;700&family=${g(body)}:wght@300;400;500;600&family=Space+Mono:wght@400`, caps: false, weight: 600, track: "-0.02em" };
  }
  return FONT_PAIRS[theme.pair] || FONT_PAIRS.oswald;
}

/* ------------------------------------------------------------- base CSS */
function baseCss(pair, t) {
  const capsRule = pair.caps ? "text-transform: uppercase;" : "";
  return `
:root{--logo-scale:${t.logoScale || 1};--bg:${t.bg};--bg2:${t.bg2};--ink:${t.ink};--ink2:${t.ink2};--ink3:${t.ink3};--line:${t.line};--accent:${t.accent};--on-accent:${t.onAccent};--inv-bg:${t.invBg};--inv-ink:${t.invInk};
--display:${pair.display};--body:${pair.body};--mono:${pair.mono};--gutter:clamp(20px,5vw,88px);--ease:cubic-bezier(.76,0,.24,1);--ease-out:cubic-bezier(.22,1,.36,1)}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:auto;-webkit-text-size-adjust:100%}
html,body{background:var(--bg);color:var(--ink)}
body{font-family:var(--body);font-weight:400;font-size:clamp(15px,1.05vw,17px);line-height:1.55;-webkit-font-smoothing:antialiased;overflow-x:hidden;min-height:100vh}
img{display:block;max-width:100%}
a{color:inherit;text-decoration:none}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
ul{list-style:none}
::selection{background:var(--accent);color:var(--on-accent)}
.wrap{padding-left:var(--gutter);padding-right:var(--gutter)}
.mono{font-family:var(--mono);font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2)}
.display{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};line-height:.95;${capsRule}}
.btn{display:inline-flex;align-items:center;gap:.7em;padding:1em 1.6em;border-radius:999px;font-weight:500;font-size:.95rem;border:1px solid var(--line);transition:transform .5s var(--ease-out),background .3s,color .3s,border-color .3s}
.btn:hover{transform:translateY(-2px)}
.btn-primary{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
.btn-ghost:hover{border-color:var(--ink)}
.btn svg{width:14px;height:14px}
.sec-head{display:grid;grid-template-columns:1fr;gap:1rem;margin-bottom:clamp(2rem,5vw,4rem)}
.sec-head h2{font-size:clamp(2rem,5vw,4.5rem);max-width:14ch}
.sec-head p{max-width:46ch;color:var(--ink2);font-size:1.05rem}
@media(min-width:900px){.sec-head{grid-template-columns:1fr 1fr;align-items:end}.sec-head p{justify-self:end}}
section{position:relative}
.reveal{opacity:0;transform:translateY(24px)}
.reveal.is-in{opacity:1;transform:none;transition:opacity .9s var(--ease-out),transform .9s var(--ease-out)}
/* brand mark (logo or wordmark) shared by nav + footer */
.nav__brand{display:flex;align-items:center;gap:.6rem;font-family:var(--display);font-weight:${pair.weight};font-size:1.15rem;letter-spacing:${pair.caps ? ".02em" : "-.01em"};${capsRule}}
.nav__brand i{width:12px;height:12px;background:var(--accent);display:inline-block;clip-path:polygon(25% 0,75% 0,100% 25%,100% 75%,75% 100%,25% 100%,0 75%,0 25%)}
.nav__brand img,.nav__brand svg{height:calc(34px * var(--logo-scale,1));width:auto;max-width:calc(180px * var(--logo-scale,1));object-fit:contain}
.nav__brand.is-chip img,.nav__brand.is-chip svg{background:var(--ink);padding:6px 10px;border-radius:6px;height:calc(40px * var(--logo-scale,1));box-sizing:border-box}
@media(max-width:640px){.nav__brand img,.nav__brand svg{max-width:calc(140px * var(--logo-scale,1));height:calc(30px * var(--logo-scale,1))}}
.nav.is-scrolled{background:color-mix(in srgb,var(--bg) 88%,transparent);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);transition:background .3s}
.nav.is-on-hero{background:linear-gradient(to bottom,rgba(0,0,0,.45),rgba(0,0,0,0));transition:background .3s}
.nav__brand.is-pill img{background:#fff;padding:5px 8px;border-radius:6px}
.nav__brand.is-invert img{filter:invert(1) hue-rotate(180deg)}
/* page intro (inner pages without a hero component) */
.page-intro{padding:9rem var(--gutter) 3rem;display:grid;gap:1.2rem}
.page-intro h1{font-size:clamp(2.6rem,7vw,7rem);max-width:12ch}
.page-intro p{max-width:48ch;color:var(--ink2);font-size:1.1rem}
.breadcrumb{font-family:var(--mono);font-size:.66rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3);display:flex;gap:.6rem}
/* footer */
.footer{padding:4rem var(--gutter) 2rem;border-top:1px solid var(--line);display:grid;gap:3rem}
.footer__row{display:grid;gap:2.5rem}
@media(min-width:900px){.footer__row{grid-template-columns:1.2fr 2fr}}
.footer__brand p{color:var(--ink2);max-width:36ch;margin-top:1rem}
.footer__contact{display:grid;gap:.3rem;margin-top:1.2rem;color:var(--ink2);font-size:.95rem}
.footer__social{display:flex;flex-wrap:wrap;gap:1rem;margin-top:1rem;font-family:var(--mono);font-size:.66rem;letter-spacing:.14em;text-transform:uppercase}
.footer__cols{display:grid;gap:2rem;grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}
.footer__cols h5{font-family:var(--mono);font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2);margin-bottom:1rem}
.footer__cols a{display:block;padding:.25rem 0;color:var(--ink2)}.footer__cols a:hover{color:var(--ink)}
.footer__bottom{display:flex;flex-wrap:wrap;justify-content:space-between;gap:1rem;font-family:var(--mono);font-size:.66rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3);padding-top:2rem;border-top:1px solid var(--line)}
`;
}

/* ---------------------------------------------------------- helpers */
const arrow = `<svg viewBox="0 0 14 14" fill="none"><path d="M2.5 7H11.5M11.5 7L8 3.5M11.5 7L8 10.5" stroke="currentColor" stroke-width="1.2"/></svg>`;

export function imgUrl(img, w = 1600) {
  if (!img) return "";
  if (typeof img === "string") return img;
  if (img.url) return /images\.unsplash\.com/.test(img.url) ? img.url.replace(/w=\d+/, `w=${w}`) : img.url;
  return "";
}

// href resolution: page slugs become real paths under `base`; anchors, tel:,
// mailto: and absolute URLs pass through. Anchors on another page are written
// as "services#faq".
function makeLink(base, pageSlug) {
  return (href = "") => {
    href = String(href || "").trim();
    if (!href || href === "#") return "#top";
    if (/^(#|https?:|tel:|mailto:|\/\/)/i.test(href)) return href;
    const [p, hash] = href.split("#");
    const s = p.replace(/^\/+|\/+$/g, "").replace(/\.html$/, "");
    if (s === pageSlug && hash) return "#" + hash;
    const path = !s || s === "index" ? `${base}/` : `${base}/${s}/`;
    return path + (hash ? "#" + hash : "");
  };
}

function brandMark(spec, t, ctx) {
  const b = spec.brand || {};
  const l = b.logo;
  // a logo that reads on dark without help is usually light or white: on a light page it sits in an ink chip (Integrity's red tile), never ghosted on bone
  const cls = ["nav__brand", l?.onDark === "pill" && t.dark ? "is-pill" : "", l?.onDark === "invert" && t.dark ? "is-invert" : "", l?.url && !t.dark && (l.onDark === "none" || l.onDark === "invert") ? "is-chip" : ""].filter(Boolean).join(" ");
  const home = ctx.link("index");
  if (l?.kind === "svg" && l.svg) return `<a class="${cls}" href="${home}" aria-label="${esc(b.name)} home">${l.svg}</a>`;
  if (l?.url) return `<a class="${cls}" href="${home}" aria-label="${esc(b.name)} home"><img src="${esc(l.url)}" alt="${esc(b.name)}"></a>`;
  return `<a class="${cls}" href="${home}"><i></i>${esc(b.name)}</a>`;
}

function footer(spec, ctx) {
  const f = spec.footer || {};
  const b = spec.brand || {};
  const year = new Date().getFullYear();
  const social = Object.entries(b.social || {}).filter(([, v]) => v && /^https?:/i.test(v));
  const contact = [b.address, b.phone, b.email, b.hours].filter(Boolean);
  return `
<footer class="footer">
  <div class="footer__row">
    <div class="footer__brand">${brandMark(spec, ctx.t, ctx)}<p>${esc(f.blurb || b.tagline || "")}</p>
      ${contact.length ? `<div class="footer__contact">${contact.map(c => `<span>${esc(c)}</span>`).join("")}</div>` : ""}
      ${social.length ? `<div class="footer__social">${social.map(([k, v]) => `<a href="${esc(v)}" rel="noopener" target="_blank">${esc(k)}</a>`).join("")}</div>` : ""}
    </div>
    <div class="footer__cols">${(f.columns || []).map(c => `<div><h5>${esc(c.title)}</h5>${(c.links || []).map(l => `<a href="${esc(ctx.link(l.href))}">${esc(l.label)}</a>`).join("")}</div>`).join("")}</div>
  </div>
  <div class="footer__bottom"><span>© ${year} ${esc(b.name)}${b.licence ? ` · ${esc(b.licence)}` : ""}</span><span>${esc([b.city, b.serviceArea && b.serviceArea !== b.city ? b.serviceArea : ""].filter(Boolean).join(" · "))}</span></div>
</footer>`;
}

/* --------------------------------------------------------------- runtime */
function prelude() {
  return `
(function(){
  var RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SMALL = window.matchMedia('(max-width: 767px)').matches;
  var FX = !RM && !SMALL;
  window.__fx = { RM: RM, SMALL: SMALL, FX: FX, lenis: null, closeMenu: function(){} };
  if (!window.gsap) return;
  gsap.registerPlugin(ScrollTrigger);
  if (window.SplitText) gsap.registerPlugin(SplitText);
  if (window.Flip) gsap.registerPlugin(Flip);
  if (window.CustomEase) gsap.registerPlugin(CustomEase);
  var lenis = null;
  if (window.Lenis && !RM) {
    lenis = new Lenis({ lerp: 0.12, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function(t){ lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
    window.__fx.lenis = lenis;
  }
  document.querySelectorAll('a[href^="#"]').forEach(function(a){
    a.addEventListener('click', function(e){
      var id = a.getAttribute('href'); if (id.length < 2) return;
      var el = document.querySelector(id); if (!el) return;
      e.preventDefault(); window.__fx.closeMenu();
      if (lenis) lenis.scrollTo(el, { offset: 0, duration: 1.2 }); else el.scrollIntoView({ behavior: 'smooth' });
    });
  });
  // once the page scrolls, every fixed nav gets a translucent backdrop so its links never print over body copy
  var navEl = document.querySelector('.nav');
  if (navEl) { var heroEl = document.querySelector('[data-fx^="hero-"]'); var navState = function(){ var y = (window.__fx.lenis && window.__fx.lenis.scroll) || window.scrollY || 0; var inHero = heroEl ? y < heroEl.offsetTop + heroEl.offsetHeight - window.innerHeight : false; navEl.classList.toggle('is-scrolled', y > 40 && !inHero); navEl.classList.toggle('is-on-hero', inHero && y > 40); }; window.addEventListener('scroll', navState, { passive: true }); if (lenis) lenis.on('scroll', navState); navState(); }
  var io = new IntersectionObserver(function(es){ es.forEach(function(en){ if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } }); }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach(function(el, i){ el.style.transitionDelay = (i % 6) * 60 + 'ms'; io.observe(el); });
})();`;
}
const postlude = `window.addEventListener('load', function(){ if (window.ScrollTrigger) ScrollTrigger.refresh(); });`;

/* ----------------------------------------------------------------- page */
export function schemaFor(spec, page) {
  const s = page.seo?.schema || spec.seo?.schema;
  return s && Object.keys(s).length ? s : null;
}

const LIBS = {
  lottie: "https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js",
};
const THREE_IMPORTMAP = `<script type="importmap">{"imports":{"three":"https://unpkg.com/three@0.160.0/build/three.module.js","three/addons/":"https://unpkg.com/three@0.160.0/examples/jsm/"}}</script>`;
const CDN = {
  gsap: "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.13.0/gsap.min.js",
  st: "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.13.0/ScrollTrigger.min.js",
  split: "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.13.0/SplitText.min.js",
  flip: "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.13.0/Flip.min.js",
  ease: "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.13.0/CustomEase.min.js",
  lenis: "https://unpkg.com/lenis@1.1.9/dist/lenis.min.js",
};

export function pageList(spec) {
  if (Array.isArray(spec.pages) && spec.pages.length) return spec.pages;
  // v1 spec (single page) → one index page
  return [{ slug: "index", title: spec.brand?.name || "Home", seo: spec.seo || {}, sections: spec.sections || [] }];
}

/**
 * Render one page of the spec.
 * opts.base: path prefix for page links ("" for a site at its own root, "/preview/<id>" for the preview).
 */
export function renderPage(spec, page, opts = {}) {
  const base = (opts.base || "").replace(/\/$/, "");
  const pair = resolvePair(spec.theme);
  const t = themeTokens(spec.theme); t.logoScale = logoScale(spec);
  const capsRule = pair.caps ? "text-transform: uppercase;" : "";
  const ctx = { t, pair, capsRule, esc, imgUrl, link: makeLink(base, page.slug), arrow, page, spec, brandMark: () => brandMark(spec, t, ctx) };

  const used = new Set();
  const menu = byId[spec.nav?.menu] && byId[spec.nav.menu].kind === "menu" ? byId[spec.nav.menu] : byId["menu-8"];
  used.add(menu);
  const sections = (page.sections || []).filter(s => s && s.type);
  const hasHero = sections.length && byType[sections[0].type]?.kind === "hero";
  const parts = [];
  if (!hasHero && page.slug !== "index") {
    const crumbs = page.slug.split("/");
    parts.push(`<section class="page-intro" id="top"><div class="breadcrumb"><a href="${ctx.link("index")}">Home</a>${crumbs.length > 1 ? `<span>/</span><a href="${ctx.link(crumbs[0])}">${esc(crumbs[0].replace(/-/g, " "))}</a>` : ""}</div><h1 class="display">${esc(page.title || "")}</h1>${page.intro ? `<p>${esc(page.intro)}</p>` : ""}</section>`);
  }
  let secIndex = 0;
  for (const s of sections) {
    secIndex++;
    const c = byType[s.type];
    if (!c) { parts.push(`<!-- unknown section ${esc(s.type)} -->`); continue; }
    used.add(c);
    parts.push(tagSection(c.html(s, ctx), secIndex));
  }
  const extras = [];
  for (const key of ["transition", "cursor", "preloader"]) {
    const c = byId[spec.theme?.[key]];
    if (c && c.kind === (key === "preloader" ? "transition" : key)) { used.add(c); extras.push(c.html(null, ctx)); }
  }
  const body = [menu.html(null, ctx), `<main>`, ...parts, `</main>`, footer(spec, ctx), ...extras].join("\n");

  const seo = page.seo || {};
  const title = seo.title || `${page.title ? page.title + " | " : ""}${spec.brand.name}`.slice(0, 70);
  const desc = (seo.description || spec.brand.tagline || "").slice(0, 160);
  const firstImg = sections.find(s => s.image)?.image || sections.find(s => s.images?.length)?.images?.[0];
  const ogImage = seo.og?.image || imgUrl(firstImg, 1200) || spec.brand?.logo?.url || "";
  const schema = schemaFor(spec, page);
  const canonical = seo.canonical || (spec.brand.domain ? `https://${spec.brand.domain}${page.slug === "index" ? "/" : "/" + page.slug + "/"}` : "");
  const needsSplit = [...used].some(c => /SplitText/.test(String(c.js?.(ctx) || "")));
  const needsFlip = [...used].some(c => /\bFlip\b/.test(String(c.js?.(ctx) || "")));
  const needsEase = [...used].some(c => /CustomEase/.test(String(c.js?.(ctx) || "")));
  const libs = new Set([...used].flatMap(c => c.libs || []));
  const scripts = [CDN.gsap, CDN.st, needsSplit && CDN.split, needsFlip && CDN.flip, needsEase && CDN.ease, CDN.lenis, libs.has("lottie") && LIBS.lottie].filter(Boolean);
  const css = baseCss(pair, t) + [...used].map(c => c.css(ctx)).join("\n");
  const classic = [...used].filter(c => c.js && !c.module).map(c => c.js(ctx)).filter(Boolean);
  const modules = [...used].filter(c => c.js && c.module).map(c => c.js(ctx)).filter(Boolean);
  const js = [prelude(), ...classic, postlude].join("\n");
  const components = [...used].map(c => c.id).filter((v, i, a) => a.indexOf(v) === i);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${seo.keywords?.length ? `<meta name="keywords" content="${esc(seo.keywords.join(", "))}">` : ""}
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ""}
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(seo.og?.title || title)}">
<meta property="og:description" content="${esc(seo.og?.description || desc)}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ""}
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="${t.bg}">
<link rel="icon" href="${spec.brand?.logo?.icon ? esc(spec.brand.logo.icon) : "data:image/svg+xml," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><path d='M8 0h16l8 8v16l-8 8H8l-8-8V8z' fill='${t.accent}'/></svg>`)}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=${pair.google}&display=swap" rel="stylesheet">${(pair.css || []).map(u => `<link href="${u}" rel="stylesheet">`).join("")}
<style>${css}</style>
${schema ? `<script type="application/ld+json">${JSON.stringify(schema)}</script>` : ""}
<!-- Built by Unifictional · page ${esc(page.slug)} · components: ${esc(components.join(", "))} -->
${debugStyle(spec, page)}</head>
<body>
${body}
${libs.has("three") ? THREE_IMPORTMAP : ""}
${scripts.map(s => `<script src="${s}"></script>`).join("\n")}
<script>${js}</script>
${modules.map(m => `<script type="module">${m}</script>`).join("\n")}
</body>
</html>`;
}

/** Render every page. Returns [{slug, html, components}]. */
/** brand.logoScale: how much bigger than the default the logo sits in the nav (1 = default, 0.6 to 2.5). */
function logoScale(spec) {
  const n = Number(spec?.brand?.logoScale);
  return Number.isFinite(n) && n > 0 ? Math.min(2.5, Math.max(0.6, n)) : 1;
}
/** The section's root element gets data-sec="N" (1-based), so the debugger's CSS can address one section. */
function tagSection(html, n) {
  const h = String(html || "");
  return h.replace(/^(\s*<(?!!--)[a-z][a-z0-9-]*)(\s|>)/i, (m, open, rest) => `${open} data-sec="${n}"${rest === ">" ? ">" : rest}`);
}
/** The debugger's CSS layer: site-wide rules, then this page's. Empty when there are none. */
function debugStyle(spec, page) {
  const css = [spec?.debugCss, page?.debugCss].filter(Boolean).join("\n").replace(/<\/style/gi, "");
  return css ? `<style id="debug-css">${css}</style>` : "";
}

export function renderSite(spec, opts = {}) {
  return pageList(spec).map(page => ({ slug: page.slug, title: page.title, html: renderPage(spec, page, opts) }));
}

/** v1 compatibility: one page. */
export function render(spec, opts = {}) {
  return renderPage(spec, pageList(spec)[0], opts);
}

/** The component ids a spec uses, for logs and the rationale. */
export function componentsUsed(spec) {
  const ids = new Set();
  if (spec.nav?.menu) ids.add(spec.nav.menu);
  for (const key of ["transition", "cursor", "preloader"]) if (spec.theme?.[key] && byId[spec.theme[key]]) ids.add(spec.theme[key]);
  for (const p of pageList(spec)) for (const s of p.sections || []) { const c = byType[s.type]; if (c) ids.add(c.id); }
  return [...ids];
}

export { COMPONENTS, byType, byId };
export default render;
