/* =====================================================================
   Unifictional Studio · renderer.js
   Turns a SITE SPEC (JSON) into a complete, standalone HTML page that uses
   the Awwwards Pack effects. The spec is produced either by Claude
   (api/generate.js) or by the local engine (engine.js); both speak the
   same contract, documented here.

   SPEC CONTRACT
   {
     brand:  { name, tagline, industry, city, phone?, email?, domain?, voice? }
     theme:  { mode: "dark"|"light", accent: "#hex", pair: "oswald"|"syne"|"serif"|"grotesk"|"fraunces"|"bricolage" }
     nav:    { links: [{label, href}], cta: {label, href} }
     sections: [ one of
       { type:"hero-split",  component:"scroll-41", word, headline, sub, cta:{label,href}, image:{query,alt} }
       { type:"hero-type",   component:"text",      eyebrow, headline, sub, cta:{label,href}, image?:{query,alt} }
       { type:"marquee",     items:[string] }
       { type:"statement",   component:"scroll-61", text, label? }
       { type:"services",    title, intro?, items:[{title, text}] }
       { type:"pile",        component:"scroll-47", headline, images:[{query,alt}] (4) }
       { type:"gallery",     component:"scroll-19", title, items:[{title, meta, query}] (6-9) }
       { type:"sentence",    component:"scroll-15", text }
       { type:"process",     title, steps:[{title, text}] }
       { type:"stats",       items:[{value, label}] }
       { type:"testimonials",items:[{quote, name, role}] }
       { type:"faq",         title, items:[{q, a}] }
       { type:"cta",         headline, sub, button:{label,href} }
     ]
     footer: { blurb, columns:[{title, links:[{label,href}]}] }
     seo:    { title, description, keywords:[], canonical?, og?:{title,description,image}, schema?: {} , alt?: {query: alt} }
   }
   Image queries are resolved by images.js (engine side) into URLs before
   rendering, or passed through if they already are URLs.
   ===================================================================== */

const FONT_PAIRS = {
  oswald:    { display: "'Oswald', sans-serif", body: "'Hanken Grotesk', system-ui, sans-serif", mono: "'Space Mono', monospace", google: "Oswald:wght@400;500;600&family=Hanken+Grotesk:wght@300;400;500;600&family=Space+Mono:wght@400", caps: true, weight: 500, track: "-0.015em" },
  syne:      { display: "'Syne', sans-serif", body: "'Inter', system-ui, sans-serif", mono: "'JetBrains Mono', monospace", google: "Syne:wght@500;600;700;800&family=Inter:wght@300;400;500&family=JetBrains+Mono:wght@400", caps: false, weight: 700, track: "-0.03em" },
  serif:     { display: "'Instrument Serif', serif", body: "'Manrope', system-ui, sans-serif", mono: "'DM Mono', monospace", google: "Instrument+Serif:ital@0;1&family=Manrope:wght@300;400;500;600&family=DM+Mono:wght@400", caps: false, weight: 400, track: "-0.02em" },
  grotesk:   { display: "'Space Grotesk', sans-serif", body: "'Inter', system-ui, sans-serif", mono: "'Space Mono', monospace", google: "Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500&family=Space+Mono:wght@400", caps: false, weight: 600, track: "-0.03em" },
  fraunces:  { display: "'Fraunces', serif", body: "'Inter', system-ui, sans-serif", mono: "'JetBrains Mono', monospace", google: "Fraunces:opsz,wght@9..144,300;9..144,500;9..144,600&family=Inter:wght@300;400;500&family=JetBrains+Mono:wght@400", caps: false, weight: 500, track: "-0.025em" },
  bricolage: { display: "'Bricolage Grotesque', sans-serif", body: "'Inter', system-ui, sans-serif", mono: "'JetBrains Mono', monospace", google: "Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Inter:wght@300;400;500&family=JetBrains+Mono:wght@400", caps: false, weight: 700, track: "-0.03em" },
};

const esc = (s = "") => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slug = (s = "") => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

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
  const accent = theme.accent || (dark ? "#D4FF3F" : "#0E0E0E");
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

/* ------------------------------------------------------------------ CSS */
function css(spec, pair, t) {
  const capsRule = pair.caps ? "text-transform: uppercase;" : "";
  return `
:root{--bg:${t.bg};--bg2:${t.bg2};--ink:${t.ink};--ink2:${t.ink2};--ink3:${t.ink3};--line:${t.line};--accent:${t.accent};--on-accent:${t.onAccent};--inv-bg:${t.invBg};--inv-ink:${t.invInk};
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

/* NAV + MENU (menu-8) */
.nav{position:fixed;inset:0 0 auto 0;z-index:40;display:flex;align-items:center;justify-content:space-between;height:76px;padding:0 var(--gutter);mix-blend-mode:${t.dark ? "normal" : "normal"}}
.nav__brand{display:flex;align-items:center;gap:.6rem;font-family:var(--display);font-weight:${pair.weight};font-size:1.15rem;letter-spacing:${pair.caps ? ".02em" : "-.01em"};${capsRule}}
.nav__brand i{width:12px;height:12px;background:var(--accent);display:inline-block;clip-path:polygon(25% 0,75% 0,100% 25%,100% 75%,75% 100%,25% 100%,0 75%,0 25%)}
.nav__links{display:none;gap:2rem;font-size:.9rem;color:var(--ink2)}
.nav__links a:hover{color:var(--ink)}
@media(min-width:900px){.nav__links{display:flex}}
.nav__right{display:flex;align-items:center;gap:1rem}
.nav__cta{display:none}
@media(min-width:600px){.nav__cta{display:inline-flex;padding:.7em 1.2em;font-size:.85rem}}
.burger{display:inline-flex;flex-direction:column;gap:6px;padding:10px 0}
.burger span{width:28px;height:1.5px;background:var(--ink);transition:transform .3s var(--ease)}
.burger:hover span:first-child{transform:translateX(-4px)}.burger:hover span:last-child{transform:translateX(4px)}
.menu{position:fixed;inset:0;z-index:50;background:var(--inv-bg);color:var(--inv-ink);display:grid;grid-template-rows:auto 1fr auto;clip-path:inset(0 0 100% 0);pointer-events:none}
.menu.is-open{pointer-events:auto}
.menu__top,.menu__foot{display:flex;justify-content:space-between;align-items:center;padding:0 var(--gutter);height:76px;opacity:0}
.menu__foot{height:auto;padding:1.5rem var(--gutter);border-top:1px solid rgba(128,128,128,.25);font-family:var(--mono);font-size:.7rem;letter-spacing:.12em;text-transform:uppercase}
.menu__close{position:relative;width:44px;height:44px;transition:transform .3s var(--ease)}
.menu__close span{position:absolute;top:50%;left:50%;width:28px;height:1.5px;background:currentColor}
.menu__close span:first-child{transform:translate(-50%,-50%) rotate(45deg)}.menu__close span:last-child{transform:translate(-50%,-50%) rotate(-45deg)}
.menu__close:hover{transform:rotate(90deg)}
.rows{display:flex;flex-direction:column;justify-content:center;padding:0 var(--gutter)}
.row{display:flex;align-items:center;gap:1.5rem;padding:clamp(.6rem,2vh,1.6rem) 0;transition:opacity .3s}
.rows:has(.row:hover) .row:not(:hover){opacity:.25}
.row__line{display:block;height:1px;background:currentColor;opacity:.35;transform:scaleX(0);transform-origin:left center}
.row__title{flex-shrink:0;display:inline-flex;align-items:baseline;gap:1rem;font-family:var(--display);font-weight:${pair.weight};font-size:clamp(2rem,6vw,5.5rem);letter-spacing:${pair.track};${capsRule}white-space:nowrap;opacity:0;transform:translateY(30px)}
.row__index{font-family:var(--mono);font-size:.7rem;letter-spacing:.1em;opacity:.6}
.thumb{position:fixed;top:0;left:0;width:380px;height:250px;z-index:60;pointer-events:none;opacity:0;will-change:transform,opacity;overflow:hidden}
.thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0}
@media(max-width:768px){.thumb{display:none}}

/* HERO SPLIT (scroll-41) */
.hero-split{height:100svh;position:relative;overflow:hidden}
.hero-split__pin{position:relative;height:100svh}
.hero-split__word{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:3;pointer-events:none;mix-blend-mode:${t.dark ? "difference" : "normal"}}
.hero-split__word .letters{display:flex;font-family:var(--display);font-weight:${pair.weight};font-size:clamp(4rem,19vw,22rem);line-height:1;letter-spacing:${pair.track};text-transform:uppercase;color:${t.dark ? "#fff" : "var(--ink)"}}
.hero-split__img{position:absolute;inset:0;z-index:1;clip-path:polygon(37.5% 22%,62.5% 22%,62.5% 78%,37.5% 78%);transform:rotate(14deg) scale(.9)}
.hero-split__img img{width:100%;height:100%;object-fit:cover;transform:scale(1.6)}
.hero-split__img::after{content:"";position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.65),rgba(0,0,0,.05) 50%)}
.hero-split__copy{position:absolute;left:var(--gutter);right:var(--gutter);bottom:clamp(2rem,6vh,4rem);z-index:4;display:grid;gap:1.2rem;max-width:42rem;opacity:0;transform:translateY(20px);color:#fff}
.hero-split__copy h1{font-size:clamp(1.8rem,3.6vw,3.2rem);line-height:1.05;font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}}
.hero-split__copy p{max-width:40ch;color:rgba(255,255,255,.75);font-size:1.05rem}
.hero-split__scroll{position:absolute;right:var(--gutter);bottom:2rem;z-index:4;font-family:var(--mono);font-size:.65rem;letter-spacing:.2em;text-transform:uppercase;color:var(--ink2);display:flex;align-items:center;gap:.8rem}
.hero-split__scroll i{width:1px;height:48px;background:currentColor;opacity:.5;display:block}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .hero-split{height:auto;min-height:100svh}
  .hero-split__pin{height:auto;min-height:100svh;display:grid;align-content:end;padding:7rem var(--gutter) 3rem}
  .hero-split__word{position:relative;inset:auto;justify-content:flex-start;mix-blend-mode:normal;margin-bottom:1.5rem}
  .hero-split__word .letters{font-size:clamp(3rem,15vw,8rem);color:var(--ink)}
  .hero-split__img{position:absolute;inset:0;clip-path:none;transform:none;z-index:0;opacity:.55}
  .hero-split__img img{transform:none}
  .hero-split__copy{position:relative;inset:auto;opacity:1;transform:none;color:var(--ink)}
  .hero-split__copy p{color:var(--ink2)}
  .hero-split__scroll{display:none}
}

/* HERO TYPE */
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

/* MARQUEE */
.marquee{overflow:hidden;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:1.1rem 0;white-space:nowrap}
.marquee__track{display:inline-flex;gap:3rem;padding-right:3rem;animation:mq 28s linear infinite;font-family:var(--display);font-weight:${pair.weight};${capsRule}font-size:1.1rem;letter-spacing:.06em;color:var(--ink2)}
.marquee__track i{width:6px;height:6px;border-radius:50%;background:var(--accent);display:inline-block;align-self:center}
@keyframes mq{to{transform:translateX(-50%)}}
@media(prefers-reduced-motion:reduce){.marquee__track{animation:none}}

/* STATEMENT (scroll-61) */
.statement{padding:clamp(6rem,18vh,14rem) var(--gutter);text-align:center}
.statement .label{margin-bottom:2.5rem}
.animate-text{position:relative;max-width:22ch;margin:0 auto;color:var(--ink3);--clip-value:100%;font-size:clamp(1.8rem,4.6vw,4.2rem)}
.animate-text::before{content:attr(data-text);position:absolute;inset:0;color:var(--ink);clip-path:inset(0 0 var(--clip-value) 0);will-change:clip-path}

/* SERVICES */
.services{padding:clamp(4rem,10vh,8rem) var(--gutter)}
.services__grid{display:grid;gap:0;border-top:1px solid var(--line)}
@media(min-width:720px){.services__grid{grid-template-columns:repeat(2,1fr)}}
@media(min-width:1100px){.services__grid{grid-template-columns:repeat(3,1fr)}}
.service{padding:2rem 1.5rem 2.5rem 0;border-bottom:1px solid var(--line);display:grid;gap:1rem;align-content:start;position:relative}
@media(min-width:720px){.service{padding:2.2rem 2rem 3rem 2rem}.service:nth-child(2n){border-left:1px solid var(--line)}}
@media(min-width:1100px){.service:nth-child(2n){border-left:0}.service:not(:nth-child(3n+1)){border-left:1px solid var(--line)}}
.service .mono{color:var(--accent)}
.service h3{font-family:var(--display);font-weight:${pair.weight};font-size:1.6rem;letter-spacing:${pair.track};${capsRule}line-height:1.05}
.service p{color:var(--ink2);max-width:34ch}
.service::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:1px;background:var(--accent);transform:scaleX(0);transform-origin:left;transition:transform .6s var(--ease)}
.service:hover::after{transform:scaleX(1)}

/* PILE (scroll-47) */
.pile{height:100svh;display:flex;align-items:center;justify-content:center;overflow:hidden}
.pile h2{position:relative;z-index:1;text-align:center;font-size:clamp(2rem,5.5vw,5.2rem);max-width:16ch;padding:0 var(--gutter)}
.pile__imgs{position:absolute;inset:0;pointer-events:none}
.pile__img{position:absolute;top:50%;left:50%;width:clamp(14rem,24vw,32rem);aspect-ratio:7/5;overflow:hidden;transform:translate(-50%,200%);will-change:transform;box-shadow:0 30px 60px rgba(0,0,0,.25)}
.pile__img img{width:100%;height:100%;object-fit:cover}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .pile{height:auto;padding:4rem 0;flex-direction:column;gap:2rem}
  .pile__imgs{position:relative;inset:auto;display:grid;grid-template-columns:1fr 1fr;gap:.6rem;padding:0 var(--gutter);width:100%}
  .pile__img{position:static;transform:none!important;width:100%;aspect-ratio:7/5;box-shadow:none}
}

/* GALLERY (scroll-19) */
.gallery{padding:clamp(4rem,10vh,8rem) 0 clamp(4rem,10vh,8rem)}
.gallery .sec-head{padding:0 var(--gutter)}
.grid{display:grid;grid-template-columns:100%;gap:3rem;padding:0 var(--gutter)}
@media(min-width:53em){.grid{grid-template-columns:repeat(8,1fr);gap:1rem 0}}
.grid__item{position:relative;display:grid;gap:.6rem}
@media(min-width:53em){.grid__item{grid-column:var(--c)/span var(--s);grid-row:var(--r)}}
.grid__item-img{overflow:hidden;aspect-ratio:1.5;will-change:transform}
.grid__item-img-inner{width:100%;height:100%;background-size:cover;background-position:50% 50%;will-change:transform}
.grid__item-caption{display:flex;justify-content:space-between;gap:1rem;font-family:var(--mono);font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink2)}

/* SENTENCE (scroll-15) */
.sentence{height:100svh;overflow:hidden;display:flex;align-items:center}
.sentence__text{display:flex;width:max-content;white-space:nowrap;gap:3vw;padding-left:100vw;font-family:var(--display);font-weight:${pair.weight};${capsRule}font-size:clamp(3rem,11vw,13rem);letter-spacing:${pair.track};line-height:1}
.sentence__text .char{display:inline-block}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .sentence{height:auto;padding:4rem var(--gutter)}
  .sentence__text{white-space:normal;width:auto;padding:0;flex-wrap:wrap;font-size:clamp(2.4rem,11vw,6rem)}
}

/* PROCESS */
.process{padding:clamp(4rem,10vh,8rem) var(--gutter)}
.steps{display:grid;gap:0;counter-reset:step}
.step{display:grid;gap:1rem;padding:2rem 0;border-top:1px solid var(--line)}
@media(min-width:800px){.step{grid-template-columns:8rem 1fr 1.4fr;gap:2rem;align-items:start}}
.step:last-child{border-bottom:1px solid var(--line)}
.step .mono{color:var(--accent)}
.step h3{font-family:var(--display);font-weight:${pair.weight};font-size:clamp(1.4rem,2.6vw,2.2rem);letter-spacing:${pair.track};${capsRule}line-height:1.05}
.step p{color:var(--ink2);max-width:48ch}

/* STATS */
.stats{padding:clamp(3rem,8vh,6rem) var(--gutter);display:grid;gap:2rem;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
@media(min-width:720px){.stats{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}}
.stat b{display:block;font-family:var(--display);font-weight:${pair.weight};font-size:clamp(2.6rem,6vw,5.5rem);letter-spacing:${pair.track};line-height:1}
.stat span{color:var(--ink2)}

/* TESTIMONIALS */
.testimonials{padding:clamp(4rem,10vh,8rem) var(--gutter);display:grid;gap:2rem}
@media(min-width:900px){.testimonials{grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}}
.quote{display:grid;gap:1.6rem;padding:2rem;border:1px solid var(--line);align-content:space-between}
.quote p{font-family:var(--display);font-weight:${pair.caps ? 400 : pair.weight};font-size:clamp(1.3rem,2vw,1.7rem);line-height:1.2;letter-spacing:${pair.caps ? "0" : pair.track}}
.quote footer{display:grid;font-size:.85rem}.quote footer span{color:var(--ink2)}

/* FAQ */
.faq{padding:clamp(4rem,10vh,8rem) var(--gutter);display:grid;gap:2rem}
@media(min-width:900px){.faq{grid-template-columns:1fr 1.4fr;gap:4rem}}
.faq h2{font-size:clamp(2rem,4.5vw,4rem);max-width:12ch}
.faq details{border-top:1px solid var(--line);padding:1.2rem 0}
.faq details:last-child{border-bottom:1px solid var(--line)}
.faq summary{cursor:pointer;list-style:none;display:flex;justify-content:space-between;gap:1rem;font-size:1.1rem;font-weight:500}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";font-family:var(--mono);color:var(--accent);transition:transform .3s}
.faq details[open] summary::after{transform:rotate(45deg)}
.faq details p{padding-top:1rem;color:var(--ink2);max-width:60ch}

/* CTA */
.cta{margin:clamp(2rem,6vh,5rem) var(--gutter);padding:clamp(3rem,10vh,7rem) var(--gutter);background:var(--inv-bg);color:var(--inv-ink);display:grid;gap:2rem;text-align:center;justify-items:center}
.cta h2{font-size:clamp(2.4rem,6.5vw,6.5rem);max-width:14ch}
.cta p{max-width:46ch;opacity:.7;font-size:1.1rem}
.cta .btn-primary{background:var(--accent);color:var(--on-accent)}

/* FOOTER */
.footer{padding:4rem var(--gutter) 2rem;border-top:1px solid var(--line);display:grid;gap:3rem}
.footer__row{display:grid;gap:2.5rem}
@media(min-width:900px){.footer__row{grid-template-columns:1.2fr 2fr}}
.footer__brand p{color:var(--ink2);max-width:36ch;margin-top:1rem}
.footer__cols{display:grid;gap:2rem;grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}
.footer__cols h5{font-family:var(--mono);font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2);margin-bottom:1rem}
.footer__cols a{display:block;padding:.25rem 0;color:var(--ink2)}.footer__cols a:hover{color:var(--ink)}
.footer__bottom{display:flex;flex-wrap:wrap;justify-content:space-between;gap:1rem;font-family:var(--mono);font-size:.66rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3);padding-top:2rem;border-top:1px solid var(--line)}
`;
}

/* ------------------------------------------------------------- sections */
const arrow = `<svg viewBox="0 0 14 14" fill="none"><path d="M2.5 7H11.5M11.5 7L8 3.5M11.5 7L8 10.5" stroke="currentColor" stroke-width="1.2"/></svg>`;

function imgUrl(img, w = 1600) {
  if (!img) return "";
  if (typeof img === "string") return img;
  if (img.url) return img.url.replace(/w=\d+/, `w=${w}`);
  return "";
}

const R = {
  nav(spec, t) {
    const n = spec.nav || { links: [], cta: null };
    const links = (n.links || []).slice(0, 5);
    const menuRows = links.map((l, i) => {
      const flexes = [[0, 1], [3, 1], [1, 3], [3, 2], [2, 2]][i % 5];
      const thumbX = [600, 200, 900, 150, 500][i % 5], off = [200, -500, 300, -600, 0][i % 5];
      return `<li class="row" data-i="${i}" data-thumb-x="${thumbX}" data-offset="${off}"><span class="row__line" style="flex:${flexes[0]}"></span><a class="row__title" href="${esc(l.href)}"><span class="row__index">0${i + 1}</span>${esc(l.label)}</a><span class="row__line" style="flex:${flexes[1]}"></span></li>`;
    }).join("");
    const thumbs = links.map((l, i) => `<img src="${esc(imgUrl(l.image, 800))}" alt="" data-i="${i}" loading="lazy">`).join("");
    return `
<header class="nav" id="nav">
  <a class="nav__brand" href="#top"><i></i>${esc(spec.brand.name)}</a>
  <nav class="nav__links">${links.map(l => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join("")}</nav>
  <div class="nav__right">${n.cta ? `<a class="btn btn-primary nav__cta" href="${esc(n.cta.href)}">${esc(n.cta.label)}</a>` : ""}<button class="burger" id="js-toggle" aria-label="Open menu" aria-expanded="false"><span></span><span></span></button></div>
</header>
<div class="menu" id="js-menu" aria-hidden="true" inert>
  <div class="menu__top"><span class="nav__brand">${esc(spec.brand.name)}</span><button class="menu__close" id="js-close" aria-label="Close menu"><span></span><span></span></button></div>
  <ul class="rows" id="js-rows">${menuRows}</ul>
  <div class="thumb" id="js-thumb" aria-hidden="true">${thumbs}</div>
  <footer class="menu__foot"><span>${esc(spec.brand.city || spec.brand.industry || "")}</span><span id="js-counter">Menu</span><span>${esc(spec.brand.phone || spec.brand.email || "")}</span></footer>
</div>`;
  },

  "hero-split"(s, spec) {
    const word = (s.word || spec.brand.name.split(" ")[0]).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "STUDIO";
    const half = Math.ceil(word.length / 2);
    const L = word.slice(0, half).split("").map(c => `<div>${c}</div>`).join("");
    const Rr = word.slice(half).split("").map(c => `<div>${c}</div>`).join("");
    return `
<section class="hero-split" id="top" data-fx="hero-split">
  <div class="hero-split__pin">
    <div class="hero-split__img"><img src="${esc(imgUrl(s.image, 2000))}" alt="${esc(s.image?.alt || "")}" fetchpriority="high"></div>
    <div class="hero-split__word"><div class="letters">${L}</div><div class="letters">${Rr}</div></div>
    <div class="hero-split__copy">
      <h1>${esc(s.headline)}</h1>
      <p>${esc(s.sub)}</p>
      ${s.cta ? `<div><a class="btn btn-primary" href="${esc(s.cta.href)}">${esc(s.cta.label)}${arrow}</a></div>` : ""}
    </div>
    <div class="hero-split__scroll"><span>Scroll</span><i></i></div>
  </div>
</section>`;
  },

  "hero-type"(s, spec) {
    const lines = String(s.headline).split(/\s*\/\s*|\n/).filter(Boolean);
    return `
<section class="hero-type" id="top" data-fx="hero-type">
  ${s.eyebrow ? `<span class="mono reveal">${esc(s.eyebrow)}</span>` : ""}
  <h1 class="display">${lines.map(l => `<span class="line"><span>${esc(l)}</span></span>`).join("")}</h1>
  <div class="hero-type__row">
    <p class="reveal">${esc(s.sub)}</p>
    ${s.cta ? `<a class="btn btn-primary reveal" href="${esc(s.cta.href)}">${esc(s.cta.label)}${arrow}</a>` : ""}
  </div>
  ${s.image ? `<div class="hero-type__media reveal"><img src="${esc(imgUrl(s.image, 1000))}" alt="${esc(s.image.alt || "")}"></div>` : ""}
</section>`;
  },

  marquee(s) {
    const items = (s.items || []).slice(0, 8);
    const seq = items.map(i => `<span>${esc(i)}</span><i></i>`).join("");
    return `<section class="marquee" aria-hidden="true"><div class="marquee__track">${seq}${seq}</div></section>`;
  },

  statement(s) {
    return `<section class="statement" data-fx="statement">${s.label ? `<div class="mono label">${esc(s.label)}</div>` : ""}<h2 class="display animate-text">${esc(s.text)}</h2></section>`;
  },

  services(s) {
    return `
<section class="services" id="services">
  <div class="sec-head"><h2 class="display reveal">${esc(s.title)}</h2>${s.intro ? `<p class="reveal">${esc(s.intro)}</p>` : ""}</div>
  <div class="services__grid">${(s.items || []).map((it, i) => `<article class="service reveal"><span class="mono">${String(i + 1).padStart(2, "0")}</span><h3>${esc(it.title)}</h3><p>${esc(it.text)}</p></article>`).join("")}</div>
</section>`;
  },

  pile(s) {
    const imgs = (s.images || []).slice(0, 4);
    return `
<section class="pile" data-fx="pile">
  <h2 class="display">${esc(s.headline)}</h2>
  <div class="pile__imgs">${imgs.map(im => `<div class="pile__img"><img src="${esc(imgUrl(im, 1200))}" alt="${esc(im.alt || "")}" loading="lazy"></div>`).join("")}</div>
</section>`;
  },

  gallery(s) {
    const layout = [[1, 1, 3], [2, 4, 3], [3, 1, 2], [4, 3, 3], [5, 6, 3], [6, 3, 2], [7, 5, 3], [8, 1, 3], [9, 4, 3]];
    const items = (s.items || []).slice(0, 9);
    return `
<section class="gallery" id="work" data-fx="gallery">
  <div class="sec-head"><h2 class="display reveal">${esc(s.title)}</h2>${s.intro ? `<p class="reveal">${esc(s.intro)}</p>` : ""}</div>
  <div class="grid">${items.map((it, i) => { const [r, c, sp] = layout[i]; return `<figure class="grid__item" style="--r:${r};--c:${c};--s:${sp}"><div class="grid__item-img"><div class="grid__item-img-inner" style="background-image:url('${esc(imgUrl(it.image || it, 1200))}')" role="img" aria-label="${esc(it.title)}"></div></div><figcaption class="grid__item-caption"><span>${esc(it.title)}</span><span>${esc(it.meta || "")}</span></figcaption></figure>`; }).join("")}</div>
</section>`;
  },

  sentence(s) {
    return `<section class="sentence" data-fx="sentence"><h2 class="sentence__text">${esc(s.text)}</h2></section>`;
  },

  process(s) {
    return `
<section class="process" id="process">
  <div class="sec-head"><h2 class="display reveal">${esc(s.title)}</h2>${s.intro ? `<p class="reveal">${esc(s.intro)}</p>` : ""}</div>
  <div class="steps">${(s.steps || []).map((st, i) => `<div class="step reveal"><span class="mono">Step ${String(i + 1).padStart(2, "0")}</span><h3>${esc(st.title)}</h3><p>${esc(st.text)}</p></div>`).join("")}</div>
</section>`;
  },

  stats(s) {
    return `<section class="stats">${(s.items || []).map(it => `<div class="stat reveal"><b data-count="${esc(it.value)}">${esc(it.value)}</b><span>${esc(it.label)}</span></div>`).join("")}</section>`;
  },

  testimonials(s) {
    return `<section class="testimonials" id="reviews">${(s.items || []).map(q => `<blockquote class="quote reveal"><p>“${esc(q.quote)}”</p><footer><strong>${esc(q.name)}</strong><span>${esc(q.role || "")}</span></footer></blockquote>`).join("")}</section>`;
  },

  faq(s) {
    return `
<section class="faq" id="faq">
  <h2 class="display reveal">${esc(s.title)}</h2>
  <div>${(s.items || []).map(it => `<details class="reveal"><summary>${esc(it.q)}</summary><p>${esc(it.a)}</p></details>`).join("")}</div>
</section>`;
  },

  cta(s) {
    return `<section class="cta" id="contact"><h2 class="display reveal">${esc(s.headline)}</h2><p class="reveal">${esc(s.sub)}</p>${s.button ? `<a class="btn btn-primary reveal" href="${esc(s.button.href)}">${esc(s.button.label)}${arrow}</a>` : ""}</section>`;
  },

  footer(spec) {
    const f = spec.footer || {};
    const year = new Date().getFullYear();
    return `
<footer class="footer">
  <div class="footer__row">
    <div class="footer__brand"><span class="nav__brand"><i></i>${esc(spec.brand.name)}</span><p>${esc(f.blurb || spec.brand.tagline || "")}</p></div>
    <div class="footer__cols">${(f.columns || []).map(c => `<div><h5>${esc(c.title)}</h5>${(c.links || []).map(l => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join("")}</div>`).join("")}</div>
  </div>
  <div class="footer__bottom"><span>© ${year} ${esc(spec.brand.name)}</span><span>${esc([spec.brand.city, spec.brand.phone, spec.brand.email].filter(Boolean).join(" · "))}</span></div>
</footer>`;
  },
};

/* ----------------------------------------------------------------- JS */
function js() {
  return `
(function(){
  var RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SMALL = window.matchMedia('(max-width: 767px)').matches;
  var FX = !RM && !SMALL;
  if (!window.gsap) return;
  gsap.registerPlugin(ScrollTrigger);
  if (window.SplitText) gsap.registerPlugin(SplitText);

  /* smooth scroll (Lenis) */
  var lenis = null;
  if (window.Lenis && !RM) {
    lenis = new Lenis({ lerp: 0.12, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function(t){ lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
  }
  document.querySelectorAll('a[href^="#"]').forEach(function(a){
    a.addEventListener('click', function(e){
      var id = a.getAttribute('href'); if (id.length < 2) return;
      var el = document.querySelector(id); if (!el) return;
      e.preventDefault(); closeMenu();
      if (lenis) lenis.scrollTo(el, { offset: 0, duration: 1.2 }); else el.scrollIntoView({ behavior: 'smooth' });
    });
  });

  /* reveal */
  var io = new IntersectionObserver(function(es){ es.forEach(function(en){ if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } }); }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach(function(el, i){ el.style.transitionDelay = (i % 6) * 60 + 'ms'; io.observe(el); });

  /* menu (menu-8) */
  var menu = document.getElementById('js-menu'), toggle = document.getElementById('js-toggle'), closeBtn = document.getElementById('js-close');
  var tl = null, openState = false;
  function closeMenu(){ if (!openState) return; openState = false; menu.classList.remove('is-open'); menu.setAttribute('aria-hidden','true'); menu.setAttribute('inert',''); toggle.setAttribute('aria-expanded','false'); if (lenis) lenis.start(); document.documentElement.style.overflow=''; hideThumb(); tl && tl.reverse(); }
  if (menu && toggle) {
    var rows = menu.querySelectorAll('.row'), lines = menu.querySelectorAll('.row__line'), titles = menu.querySelectorAll('.row__title');
    var top = menu.querySelector('.menu__top'), foot = menu.querySelector('.menu__foot');
    tl = gsap.timeline({ paused: true, defaults: { ease: 'power4.inOut' } })
      .fromTo(menu, { clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)', duration: RM ? 0.01 : 0.9 }, 0)
      .to([top, foot], { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' }, 0.45)
      .to(lines, { scaleX: 1, duration: 0.7, stagger: 0.05, ease: 'power3.out' }, 0.4)
      .to(titles, { opacity: 1, y: 0, duration: 0.6, stagger: 0.06, ease: 'power3.out' }, 0.5);
    gsap.set([top, foot], { opacity: 0, y: 20 });
    function openMenu(){ openState = true; menu.classList.add('is-open'); menu.setAttribute('aria-hidden','false'); menu.removeAttribute('inert'); toggle.setAttribute('aria-expanded','true'); if (lenis) lenis.stop(); document.documentElement.style.overflow='hidden'; tl.play(); }
    toggle.addEventListener('click', function(){ openState ? closeMenu() : openMenu(); });
    closeBtn && closeBtn.addEventListener('click', closeMenu);
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeMenu(); });
    var thumb = document.getElementById('js-thumb'), imgs = thumb ? thumb.querySelectorAll('img') : [], counter = document.getElementById('js-counter');
    var xTo = thumb ? gsap.quickTo(thumb, 'x', { duration: 0.5, ease: 'power3' }) : null, yTo = thumb ? gsap.quickTo(thumb, 'y', { duration: 0.5, ease: 'power3' }) : null;
    rows.forEach(function(row){
      row.addEventListener('mouseenter', function(){
        if (!thumb || SMALL) return;
        var r = menu.getBoundingClientRect();
        xTo(r.width * (+row.dataset.thumbX) / 1000 - thumb.offsetWidth / 2);
        yTo(r.height / 2 + (+row.dataset.offset) / 2.5 - thumb.offsetHeight / 2);
        gsap.to(thumb, { opacity: 1, duration: 0.3, overwrite: 'auto' });
        imgs.forEach(function(im){ gsap.to(im, { opacity: im.dataset.i === row.dataset.i ? 1 : 0, duration: 0.35, overwrite: 'auto' }); });
        if (counter) counter.textContent = '0' + (+row.dataset.i + 1) + ' / 0' + rows.length;
      });
      row.addEventListener('mouseleave', hideThumb);
    });
  }
  function hideThumb(){ var t = document.getElementById('js-thumb'); if (t) gsap.to(t, { opacity: 0, duration: 0.25, overwrite: 'auto' }); var c = document.getElementById('js-counter'); if (c) c.textContent = 'Menu'; }

  /* hero-split (scroll-41, rebuilt as one pinned timeline) */
  var hs = document.querySelector('[data-fx="hero-split"]');
  if (hs) {
    if (FX) {
      var letters = hs.querySelectorAll('.letters'), img = hs.querySelector('.hero-split__img'), copy = hs.querySelector('.hero-split__copy');
      gsap.timeline({ scrollTrigger: { trigger: hs, start: 'top top', end: '+=180%', scrub: 1, pin: hs.querySelector('.hero-split__pin'), pinSpacing: true }, defaults: { ease: 'power2.inOut' } })
        .to(letters[0], { xPercent: -220, scale: 6 }, 0)
        .to(letters[1], { xPercent: 220, scale: 6 }, 0)
        .to(img, { rotation: 0, scale: 1, clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)' }, 0)
        .to(img.querySelector('img'), { scale: 1 }, 0)
        .to(copy, { opacity: 1, y: 0, duration: 0.3 }, 0.55);
      hs.style.height = 'auto';
    } else {
      gsap.set(hs.querySelector('.hero-split__copy'), { opacity: 1, y: 0 });
    }
  }

  /* hero-type lines */
  var ht = document.querySelector('[data-fx="hero-type"]');
  if (ht) gsap.to(ht.querySelectorAll('.line span'), { y: 0, duration: RM ? 0.01 : 1.1, stagger: 0.08, ease: 'power4.out', delay: 0.15 });

  /* statement (scroll-61 fill) */
  document.querySelectorAll('.animate-text').forEach(function(el){
    el.setAttribute('data-text', el.textContent.trim());
    if (RM) { el.style.setProperty('--clip-value', '0%'); return; }
    ScrollTrigger.create({ trigger: el, start: 'top 70%', end: 'bottom 40%', scrub: 1, onUpdate: function(self){ el.style.setProperty('--clip-value', Math.max(0, 100 - self.progress * 100) + '%'); } });
  });

  /* pile (scroll-47) */
  var pile = document.querySelector('[data-fx="pile"]');
  if (pile && FX) {
    var pImgs = pile.querySelectorAll('.pile__img');
    var finals = [[-140,-140],[40,-130],[-160,40],[20,30]], rots = [5,-3,3.5,-1], p1s = [0,0.1,0.2,0.3], p2s = [0.5,0.55,0.6,0.65];
    ScrollTrigger.create({ trigger: pile, start: 'top top', end: '+=' + window.innerHeight * 4, pin: true, pinSpacing: true, scrub: 1, onUpdate: function(self){
      var p = self.progress;
      pImgs.forEach(function(im, i){
        var x = -50, y, r = rots[i];
        var a = p1s[i], b = Math.min(a + (0.45 - a) * 0.9, 0.45);
        if (p < a) y = 200; else if (p <= 0.45) { var lp = p >= b ? 1 : (p - a) / (b - a); var e = 1 - Math.pow(1 - lp, 3); y = 200 - e * 250; } else y = -50;
        var c = p2s[i], d = Math.min(c + (0.95 - c) * 0.9, 0.95);
        if (p >= c && p <= 0.95) { var lp2 = p >= d ? 1 : (p - c) / (d - c); var e2 = 1 - Math.pow(1 - lp2, 3); x = -50 + (finals[i][0] + 50) * e2; y = -50 + (finals[i][1] + 50) * e2; r = rots[i] * (1 - e2); }
        else if (p > 0.95) { x = finals[i][0]; y = finals[i][1]; r = 0; }
        gsap.set(im, { transform: 'translate(' + x + '%, ' + y + '%) rotate(' + r + 'deg)' });
      });
    }});
  }

  /* gallery (scroll-19) */
  var grid = document.querySelector('[data-fx="gallery"] .grid');
  if (grid) {
    var items = grid.querySelectorAll('.grid__item');
    items.forEach(function(item){
      var prev = item.previousElementSibling;
      var left = prev && (item.offsetLeft + item.offsetWidth <= prev.offsetLeft + 1);
      var ox = left ? 100 : 0;
      if (RM) return;
      gsap.timeline({ defaults: { ease: 'power4' }, scrollTrigger: { trigger: item, start: 'top bottom-=10%', end: '+=90%', scrub: true } })
        .fromTo(item.querySelector('.grid__item-img'), { scale: SMALL ? 0.85 : 0, transformOrigin: ox + '% 0%' }, { scale: 1 })
        .fromTo(item.querySelector('.grid__item-img-inner'), { scale: SMALL ? 1.3 : 4, transformOrigin: ox + '% 0%' }, { scale: 1 }, 0)
        .fromTo(item.querySelector('.grid__item-caption'), { xPercent: left ? 60 : -60, opacity: 0 }, { ease: 'power1', xPercent: 0, opacity: 1 }, 0);
    });
  }

  /* sentence (scroll-15) */
  var sen = document.querySelector('[data-fx="sentence"]');
  if (sen && FX && window.SplitText) {
    var text = sen.querySelector('.sentence__text');
    var split = SplitText.create(text, { type: 'chars, words' });
    var dist = text.scrollWidth;
    var tween = gsap.to(text, { xPercent: -100, ease: 'none', scrollTrigger: { trigger: sen, pin: true, end: '+=' + Math.round(dist * 1.1) + 'px', scrub: true } });
    split.chars.forEach(function(ch){ gsap.from(ch, { yPercent: 'random(-160, 160)', rotation: 'random(-18, 18)', ease: 'back.out(1.2)', scrollTrigger: { trigger: ch, containerAnimation: tween, start: 'left 100%', end: 'left 35%', scrub: 1 } }); });
  }

  /* stats counters */
  document.querySelectorAll('.stat b[data-count]').forEach(function(b){
    var raw = b.dataset.count, m = raw.match(/^([^0-9]*)([0-9][0-9,\\.]*)(.*)$/); if (!m || RM) return;
    var target = parseFloat(m[2].replace(/,/g,'')), dec = (m[2].split('.')[1] || '').length, o = { v: 0 };
    ScrollTrigger.create({ trigger: b, start: 'top 85%', once: true, onEnter: function(){ gsap.to(o, { v: target, duration: 1.6, ease: 'power3.out', onUpdate: function(){ b.textContent = m[1] + o.v.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) + m[3]; } }); } });
  });

  window.addEventListener('load', function(){ ScrollTrigger.refresh(); });
})();`;
}

/* --------------------------------------------------------------- page */
export function schemaFor(spec) {
  if (spec.seo?.schema && Object.keys(spec.seo.schema).length) return spec.seo.schema;
  return null;
}

export function render(spec, opts = {}) {
  const pair = FONT_PAIRS[spec.theme?.pair] || FONT_PAIRS.oswald;
  const t = themeTokens(spec.theme);
  const libs = opts.libs || "cdn"; // "cdn" | absolute origin for local vendor files
  const libBase = libs === "cdn" ? null : libs.replace(/\/$/, "") + "/assets/js/vendor";
  const scripts = libs === "cdn"
    ? [
        "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.13.0/gsap.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.13.0/ScrollTrigger.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.13.0/SplitText.min.js",
        "https://unpkg.com/lenis@1.1.9/dist/lenis.min.js",
      ]
    : ["gsap.min.js", "ScrollTrigger.min.js", "SplitText.min.js", "lenis.min.js"].map(f => `${libBase}/${f}`);

  const seo = spec.seo || {};
  const tag = (spec.brand.tagline || "").length <= 70 ? spec.brand.tagline : "";
  const title = seo.title || `${spec.brand.name} — ${tag || spec.brand.industry || ""}`.trim().slice(0, 70);
  const desc = (seo.description || spec.brand.tagline || "").slice(0, 160);
  const ogImage = seo.og?.image || imgUrl(spec.sections?.find(s => s.image)?.image, 1200);
  const schema = schemaFor(spec);
  const body = [
    R.nav(spec, t),
    `<main>`,
    ...(spec.sections || []).map(s => (R[s.type] ? R[s.type](s, spec) : `<!-- unknown section ${esc(s.type)} -->`)),
    `</main>`,
    R.footer(spec),
  ].join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${seo.keywords?.length ? `<meta name="keywords" content="${esc(seo.keywords.join(", "))}">` : ""}
${seo.canonical ? `<link rel="canonical" href="${esc(seo.canonical)}">` : ""}
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(seo.og?.title || title)}">
<meta property="og:description" content="${esc(seo.og?.description || desc)}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ""}
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="${t.bg}">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><path d='M8 0h16l8 8v16l-8 8H8l-8-8V8z' fill='${t.accent}'/></svg>`)}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=${pair.google}&display=swap" rel="stylesheet">
<style>${css(spec, pair, t)}</style>
${schema ? `<script type="application/ld+json">${JSON.stringify(schema)}</script>` : ""}
<!-- Built with Unifictional Studio · components: ${esc((spec.sections || []).map(s => s.component).filter(Boolean).join(", "))} -->
</head>
<body>
${body}
${scripts.map(s => `<script src="${s}"></script>`).join("\n")}
<script>${js()}</script>
</body>
</html>`;
}

export const FONT_PAIR_IDS = Object.keys(FONT_PAIRS);
export default render;
