// @ts-nocheck
// Generic content sections (no pack id): marquee, services, process, stats,
// testimonials, faq, cta, text, contact. Every site needs these between the
// pack effects; they are plain, fast and lazy-revealed.
import type { Component } from "./_types";

const head = (s, esc) => `<div class="sec-head"><h2 class="display reveal">${esc(s.title || "")}</h2>${s.intro ? `<p class="reveal">${esc(s.intro)}</p>` : ""}</div>`;

export const marquee: Component = {
  id: "marquee", type: "marquee", kind: "section", weight: "light",
  describe: "marquee: one thin band of 5-8 short words or service names scrolling sideways forever. A breather between big sections.",
  fields: `{"type":"marquee","items":["Decks","Pergolas","Fences"]}`,
  css: ({ pair, capsRule }) => `
.marquee{overflow:hidden;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:1.1rem 0;white-space:nowrap}
.marquee__track{display:inline-flex;gap:3rem;padding-right:3rem;animation:mq 28s linear infinite;font-family:var(--display);font-weight:${pair.weight};${capsRule}font-size:1.1rem;letter-spacing:.06em;color:var(--ink2)}
.marquee__track i{width:6px;height:6px;border-radius:50%;background:var(--accent);display:inline-block;align-self:center}
@keyframes mq{to{transform:translateX(-50%)}}
@media(prefers-reduced-motion:reduce){.marquee__track{animation:none}}`,
  html: (s, { esc }) => {
    const items = (s.items || []).slice(0, 8);
    const seq = items.map(i => `<span>${esc(typeof i === "string" ? i : i.title || "")}</span><i></i>`).join("");
    return `<section class="marquee" aria-hidden="true"><div class="marquee__track">${seq}${seq}</div></section>`;
  },
};

export const services: Component = {
  id: "services", type: "services", kind: "section", weight: "light",
  describe: "services: title + intro + 3-9 cards {title, text, href?, query} in a hairline grid, each card with a real photo of that service on top; each card links to its service page when href is given. Use on the home page (every service, short) and on the services index page.",
  fields: `{"type":"services","title":"","intro":"","items":[{"title":"","text":"two or three sentences","href":"services/decks","query":"url of a real photo of this service, or a short subject","alt":""}]}`,
  css: ({ pair, capsRule }) => `
.services{padding:clamp(4rem,10vh,8rem) var(--gutter)}
.services__grid{display:grid;gap:0;border-top:1px solid var(--line)}
@media(min-width:720px){.services__grid{grid-template-columns:repeat(2,1fr)}}
@media(min-width:1100px){.services__grid{grid-template-columns:repeat(3,1fr)}}
.service{padding:2rem 1.5rem 2.5rem 0;border-bottom:1px solid var(--line);display:grid;gap:1rem;align-content:start;position:relative;color:inherit}
@media(min-width:720px){.service{padding:2.2rem 2rem 3rem 2rem}.service:nth-child(2n){border-left:1px solid var(--line)}}
@media(min-width:1100px){.service:nth-child(2n){border-left:0}.service:not(:nth-child(3n+1)){border-left:1px solid var(--line)}
.service:last-child:nth-child(3n-1){grid-column:span 2}.service:last-child:nth-child(3n+1):not(:first-child){grid-column:1/-1}}
@media(min-width:720px) and (max-width:1099px){.service:last-child:nth-child(2n+1):not(:first-child){grid-column:1/-1}}
.service__img{aspect-ratio:4/3;overflow:hidden;border-radius:6px;background:var(--bg2);margin-bottom:.4rem}
.service__img img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .8s var(--ease)}
.service:hover .service__img img{transform:scale(1.04)}
.service .mono{color:var(--accent)}
.service h3{font-family:var(--display);font-weight:${pair.weight};font-size:1.6rem;letter-spacing:${pair.track};${capsRule}line-height:1.05}
.service p{color:var(--ink2);max-width:34ch}
.service .more{font-size:.85rem;color:var(--ink);display:inline-flex;gap:.5em;align-items:center}
.service .more svg{width:12px;height:12px}
.service::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:1px;background:var(--accent);transform:scaleX(0);transform-origin:left;transition:transform .6s var(--ease)}
.service:hover::after{transform:scaleX(1)}`,
  html: (s, { esc, link, arrow }) => `
<section class="services" id="services">
  ${head(s, esc)}
  <div class="services__grid">${(s.items || []).map((it, i) => {
    const tag = it.href ? "a" : "article";
    const img = it.image?.url ? `<div class="service__img"><img src="${esc(it.image.url)}" alt="${esc(it.image.alt || it.alt || it.title || "")}" loading="lazy"></div>` : "";
    return `<${tag} class="service reveal"${it.href ? ` href="${esc(link(it.href))}"` : ""}>${img}<span class="mono">${String(i + 1).padStart(2, "0")}</span><h3>${esc(it.title)}</h3><p>${esc(it.text)}</p>${it.href ? `<span class="more">${esc(it.more || "Learn more")}${arrow}</span>` : ""}</${tag}>`;
  }).join("")}</div>
</section>`,
};

export const process: Component = {
  id: "process", type: "process", kind: "section", weight: "light",
  describe: "process: title + intro + 3-6 numbered steps {title, text} in hairline rows. How working with them goes.",
  fields: `{"type":"process","title":"","intro":"","steps":[{"title":"","text":""}]}`,
  css: ({ pair, capsRule }) => `
.process{padding:clamp(4rem,10vh,8rem) var(--gutter)}
.steps{display:grid;gap:0}
.step{display:grid;gap:1rem;padding:2rem 0;border-top:1px solid var(--line)}
@media(min-width:800px){.step{grid-template-columns:8rem 1fr 1.4fr;gap:2rem;align-items:start}}
.step:last-child{border-bottom:1px solid var(--line)}
.step .mono{color:var(--accent)}
.step h3{font-family:var(--display);font-weight:${pair.weight};font-size:clamp(1.4rem,2.6vw,2.2rem);letter-spacing:${pair.track};${capsRule}line-height:1.05}
.step p{color:var(--ink2);max-width:48ch}`,
  html: (s, { esc }) => `
<section class="process" id="process">
  ${head(s, esc)}
  <div class="steps">${(s.steps || []).map((st, i) => `<div class="step reveal"><span class="mono">Step ${String(i + 1).padStart(2, "0")}</span><h3>${esc(st.title)}</h3><p>${esc(st.text)}</p></div>`).join("")}</div>
</section>`,
};

export const stats: Component = {
  id: "stats", type: "stats", kind: "section", weight: "light",
  describe: "stats: 3-4 big numbers {value, label} that count up. Only numbers the dossier supports (years, projects, reviews, rating, crews, response time).",
  fields: `{"type":"stats","items":[{"value":"12","label":"years in business"}]}`,
  css: ({ pair }) => `
.stats{padding:clamp(3rem,8vh,6rem) var(--gutter);display:grid;gap:2rem;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
@media(min-width:720px){.stats{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}}
.stat{min-width:0;padding-right:1rem;display:grid;grid-template-rows:clamp(2.6rem,6vw,5.5rem) auto;align-items:end}
.stat b{display:block;font-family:var(--display);font-weight:${pair.weight};font-size:clamp(2.6rem,6vw,5.5rem);letter-spacing:${pair.track};line-height:1;overflow-wrap:anywhere}
.stat b.word{font-size:clamp(1.7rem,3.2vw,3rem);line-height:1.05}
.stat span{display:block;margin-top:.5rem;color:var(--ink2)}`,
  // a word-length value (Lifetime, A+, 24/7) is set smaller so it never runs into the next column
  html: (s, { esc }) => `<section class="stats">${(s.items || []).map(it => `<div class="stat reveal"><b class="${/[A-Za-z]{3,}/.test(String(it.value || "")) ? "word" : ""}" data-count="${esc(it.value)}">${esc(it.value)}</b><span>${esc(it.label)}</span></div>`).join("")}</section>`,
  js: () => `
(function(){
  if (window.__fx.RM) return;
  document.querySelectorAll('.stat b[data-count]').forEach(function(b){
    var raw = b.dataset.count, m = raw.match(/^([^0-9]*)([0-9][0-9,\\.]*)(.*)$/); if (!m) return;
    if (/^(18|19|20)[0-9][0-9]$/.test(m[2])) return; // a year stays a year: no count-up, no thousands separator
    var target = parseFloat(m[2].replace(/,/g,'')), dec = (m[2].split('.')[1] || '').length, o = { v: 0 };
    ScrollTrigger.create({ trigger: b, start: 'top 85%', once: true, onEnter: function(){ gsap.to(o, { v: target, duration: 1.6, ease: 'power3.out', onUpdate: function(){ b.textContent = m[1] + o.v.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) + m[3]; } }); } });
  });
})();`,
};

export const testimonials: Component = {
  id: "testimonials", type: "testimonials", kind: "section", weight: "light",
  describe: "testimonials: 2-6 real review cards {quote, name, role} (role = source, e.g. \"Google review\"). Verbatim from the dossier's proof; never invent.",
  fields: `{"type":"testimonials","title":"","items":[{"quote":"","name":"","role":"Google review"}]}`,
  css: ({ pair }) => `
.testimonials{padding:clamp(4rem,10vh,8rem) var(--gutter)}
.testimonials__grid{display:grid;gap:2rem}
@media(min-width:900px){.testimonials__grid{grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}}
.quote{display:grid;gap:1.6rem;padding:2rem;border:1px solid var(--line);align-content:space-between}
.quote p{font-family:var(--display);font-weight:${pair.caps ? 400 : pair.weight};font-size:clamp(1.3rem,2vw,1.7rem);line-height:1.2;letter-spacing:${pair.caps ? "0" : pair.track}}
.quote footer{display:grid;font-size:.85rem}.quote footer span{color:var(--ink2)}`,
  html: (s, { esc }) => `
<section class="testimonials" id="reviews">
  ${s.title ? head(s, esc) : ""}
  <div class="testimonials__grid">${(s.items || []).map(q => `<blockquote class="quote reveal"><p>“${esc(q.quote)}”</p><footer><strong>${esc(q.name)}</strong><span>${esc(q.role || "")}</span></footer></blockquote>`).join("")}</div>
</section>`,
};

export const faq: Component = {
  id: "faq", type: "faq", kind: "section", weight: "light",
  describe: "faq: title + 3-8 questions {q, a} this audience actually asks (from dossier.audience and the service). Renders as accordion and as FAQPage schema.",
  fields: `{"type":"faq","title":"","items":[{"q":"","a":""}]}`,
  css: () => `
.faq{padding:clamp(4rem,10vh,8rem) var(--gutter);display:grid;gap:2rem}
@media(min-width:900px){.faq{grid-template-columns:1fr 1.4fr;gap:4rem}}
.faq h2{font-size:clamp(2rem,4.5vw,4rem);max-width:12ch}
.faq details{border-top:1px solid var(--line);padding:1.2rem 0}
.faq details:last-child{border-bottom:1px solid var(--line)}
.faq summary{cursor:pointer;list-style:none;display:flex;justify-content:space-between;gap:1rem;font-size:1.1rem;font-weight:500}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";font-family:var(--mono);color:var(--accent);transition:transform .3s}
.faq details[open] summary::after{transform:rotate(45deg)}
.faq details p{padding-top:1rem;color:var(--ink2);max-width:60ch}`,
  html: (s, { esc }) => `
<section class="faq" id="faq">
  <h2 class="display reveal">${esc(s.title || "Questions")}</h2>
  <div>${(s.items || []).map(it => `<details class="reveal"><summary>${esc(it.q)}</summary><p>${esc(it.a)}</p></details>`).join("")}</div>
</section>`,
};

export const cta: Component = {
  id: "cta", type: "cta", kind: "section", weight: "light",
  describe: "cta: inverted block with a big headline, one line of sub and one button. Closes most pages; the phone number goes in the sub when known.",
  fields: `{"type":"cta","headline":"","sub":"","button":{"label":"","href":"contact"}}`,
  css: () => `
.cta{margin:clamp(2rem,6vh,5rem) var(--gutter);padding:clamp(3rem,10vh,7rem) var(--gutter);background:var(--inv-bg);color:var(--inv-ink);display:grid;gap:2rem;text-align:center;justify-items:center}
.cta h2{font-size:clamp(2.4rem,6.5vw,6.5rem);max-width:14ch}
.cta p{max-width:46ch;opacity:.7;font-size:1.1rem}
.cta .btn-primary{background:var(--accent);color:var(--on-accent)}`,
  html: (s, { esc, link, arrow }) => `<section class="cta" id="contact"><h2 class="display reveal">${esc(s.headline)}</h2><p class="reveal">${esc(s.sub || "")}</p>${s.button ? `<a class="btn btn-primary reveal" href="${esc(link(s.button.href))}">${esc(s.button.label)}${arrow}</a>` : ""}</section>`,
};

export const text: Component = {
  id: "text", type: "text", kind: "section", weight: "light",
  describe: "text: an editorial two-column block: eyebrow + title on the left, 1-4 paragraphs on the right (array of strings), optional bullet list {items:[...]} and optional image. For about pages, service detail, service areas, guarantees, history. Specific prose, 60-180 words per paragraph.",
  fields: `{"type":"text","eyebrow":"","title":"","paragraphs":["",""],"items":["",""],"image":{"query":"","alt":""},"cta":{"label":"","href":""}}`,
  images: { min: 0, max: 1 },
  css: ({ pair, capsRule }) => `
.textblock{padding:clamp(4rem,10vh,8rem) var(--gutter);display:grid;gap:2.5rem}
@media(min-width:900px){.textblock{grid-template-columns:1fr 1.4fr;gap:4rem}}
.textblock h2{font-size:clamp(2rem,4.5vw,4rem);max-width:14ch;margin-top:.6rem}
.textblock__body{display:grid;gap:1.4rem;max-width:62ch;font-size:1.08rem}
.textblock__body p{color:var(--ink2)}
.textblock__body ul{display:grid;gap:.6rem;padding-left:1.2rem;list-style:disc;color:var(--ink2)}
.textblock__body img{width:100%;aspect-ratio:3/2;object-fit:cover;margin-top:1rem}
.textblock h3{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}font-size:1.3rem;margin-top:.5rem}`,
  html: (s, { esc, imgUrl, link, arrow }) => `
<section class="textblock" id="${esc(s.id || "about")}">
  <div>${s.eyebrow ? `<span class="mono reveal">${esc(s.eyebrow)}</span>` : ""}<h2 class="display reveal">${esc(s.title || "")}</h2></div>
  <div class="textblock__body">
    ${(s.paragraphs || []).map(p => `<p class="reveal">${esc(p)}</p>`).join("")}
    ${s.items?.length ? `<ul class="reveal">${s.items.map(i => `<li>${esc(typeof i === "string" ? i : (i.title ? `${i.title}: ${i.text || ""}` : i.text || ""))}</li>`).join("")}</ul>` : ""}
    ${s.cta ? `<div class="reveal"><a class="btn btn-ghost" href="${esc(link(s.cta.href))}">${esc(s.cta.label)}${arrow}</a></div>` : ""}
    ${s.image ? `<img class="reveal" src="${esc(imgUrl(s.image, 1400))}" alt="${esc(s.image.alt || "")}" loading="lazy">` : ""}
  </div>
</section>`,
};

export const contact: Component = {
  id: "contact", type: "contact", kind: "section", weight: "light",
  describe: "contact: the contact page block: headline, sub, then the real phone, email, address, hours and service area as a details list, plus a simple quote form (name, phone, email, message) that posts nowhere yet. Use once, on the contact page.",
  fields: `{"type":"contact","headline":"","sub":"","details":[{"label":"Phone","value":""},{"label":"Email","value":""},{"label":"Address","value":""},{"label":"Hours","value":""},{"label":"Service area","value":""}],"formNote":""}`,
  css: ({ pair, capsRule }) => `
.contactblock{padding:clamp(5rem,12vh,9rem) var(--gutter) clamp(4rem,10vh,8rem);display:grid;gap:3rem}
@media(min-width:900px){.contactblock{grid-template-columns:1fr 1fr;gap:5rem}}
.contactblock h1{font-size:clamp(2.6rem,6vw,6rem);max-width:12ch}
.contactblock .lead{color:var(--ink2);font-size:1.1rem;max-width:44ch;margin-top:1.2rem}
.contactblock dl{display:grid;gap:1rem;margin-top:2.5rem}
.contactblock dt{font-family:var(--mono);font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3)}
.contactblock dd{font-size:1.05rem}
.contactblock dd a{border-bottom:1px solid var(--line)}
.cform{display:grid;gap:1rem;padding:2rem;border:1px solid var(--line);align-content:start}
.cform label{display:grid;gap:.4rem;font-family:var(--mono);font-size:.66rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3)}
.cform input,.cform textarea{font:inherit;color:inherit;background:var(--bg2);border:1px solid var(--line);padding:.8rem 1rem;width:100%}
.cform textarea{min-height:8rem;resize:vertical}
.cform small{color:var(--ink3)}
.cform h2{font-family:var(--display);font-weight:${pair.weight};letter-spacing:${pair.track};${capsRule}font-size:1.4rem}`,
  html: (s, { esc, spec, arrow }) => {
    const b = spec.brand || {};
    const details = (s.details && s.details.length ? s.details : [
      b.phone && { label: "Phone", value: b.phone }, b.email && { label: "Email", value: b.email },
      b.address && { label: "Address", value: b.address }, b.hours && { label: "Hours", value: b.hours },
      (b.serviceArea || b.city) && { label: "Service area", value: b.serviceArea || b.city },
    ].filter(Boolean)).filter(d => d && d.value);
    const val = (d) => /phone/i.test(d.label) ? `<a href="tel:${esc(String(d.value).replace(/[^+\d]/g, ""))}">${esc(d.value)}</a>` : /email/i.test(d.label) ? `<a href="mailto:${esc(d.value)}">${esc(d.value)}</a>` : esc(d.value);
    return `
<section class="contactblock" id="contact">
  <div>
    <h1 class="display reveal">${esc(s.headline || "Get in touch")}</h1>
    ${s.sub ? `<p class="lead reveal">${esc(s.sub)}</p>` : ""}
    <dl class="reveal">${details.map(d => `<div><dt>${esc(d.label)}</dt><dd>${val(d)}</dd></div>`).join("")}</dl>
  </div>
  <form class="cform reveal" onsubmit="event.preventDefault();this.querySelector('small').textContent='Thanks. We will reply by the next business day.'">
    <h2>${esc(s.formTitle || "Request a quote")}</h2>
    <label>Name<input name="name" required></label>
    <label>Phone<input name="phone" type="tel"></label>
    <label>Email<input name="email" type="email" required></label>
    <label>Project<textarea name="message"></textarea></label>
    <button class="btn btn-primary" type="submit">${esc(s.formButton || "Send")}${arrow}</button>
    <small>${esc(s.formNote || "")}</small>
  </form>
</section>`;
  },
};

export const generic = [marquee, services, process, stats, testimonials, faq, cta, text, contact];
