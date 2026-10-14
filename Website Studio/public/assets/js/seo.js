/* =====================================================================
   Unifictional Studio · seo.js  (the SEO agent, rule layer)
   Audits a rendered page + its spec, scores it, and can patch the spec.
   In Claude mode api/seo.js adds a keyword plan, rewritten meta and
   schema; this file still does the scoring so the number is honest.
   ===================================================================== */

function parse(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc;
}
const len = (s) => (s || "").trim().length;

export function audit(html, spec) {
  const d = parse(html);
  const checks = [];
  const add = (id, label, status, detail, fixable = false, weight = 1) => checks.push({ id, label, status, detail, fixable, weight });

  const title = d.querySelector("title")?.textContent || "";
  const desc = d.querySelector('meta[name="description"]')?.getAttribute("content") || "";
  const h1s = [...d.querySelectorAll("h1")];
  const hs = [...d.querySelectorAll("h1,h2,h3,h4")].map(h => +h.tagName[1]);
  const imgs = [...d.querySelectorAll("img, [role=img]")];
  const noAlt = imgs.filter(i => !(i.getAttribute("alt") || i.getAttribute("aria-label") || "").trim()).length;
  const text = d.body?.textContent?.replace(/\s+/g, " ").trim() || "";
  const words = text.split(" ").length;
  const kw = (spec.seo?.keywords || []).map(k => k.toLowerCase());
  const primary = kw[0] || `${spec.brand.industry} ${spec.brand.city}`.toLowerCase().trim();
  const schema = d.querySelector('script[type="application/ld+json"]');
  const og = d.querySelector('meta[property="og:image"]');
  const canonical = d.querySelector('link[rel="canonical"]');
  const links = [...d.querySelectorAll("a[href]")];
  const internal = links.filter(a => a.getAttribute("href").startsWith("#")).length;
  const lazy = imgs.filter(i => i.getAttribute("loading") === "lazy").length;

  add("title", "Title tag", len(title) >= 30 && len(title) <= 62 ? "pass" : len(title) ? "warn" : "fail", len(title) ? `${len(title)} chars: “${title}”` : "Missing", true, 3);
  add("title-kw", "Primary keyword in title", title.toLowerCase().includes(primary.split(" ")[0]) ? "pass" : "warn", `Primary: “${primary}”`, true, 2);
  add("desc", "Meta description", len(desc) >= 110 && len(desc) <= 158 ? "pass" : len(desc) ? "warn" : "fail", len(desc) ? `${len(desc)} chars` : "Missing", true, 3);
  add("h1", "One H1", h1s.length === 1 ? "pass" : "fail", `${h1s.length} found`, false, 2);
  add("h1-kw", "Keyword or intent in H1", h1s[0] && /\w/.test(h1s[0].textContent) && (h1s[0].textContent.toLowerCase().includes(primary.split(" ")[0]) || h1s[0].textContent.length > 20) ? "pass" : "warn", h1s[0]?.textContent?.trim() || "", false, 1);
  let order = true; for (let i = 1; i < hs.length; i++) if (hs[i] - hs[i - 1] > 1) order = false;
  add("h-order", "Heading hierarchy", order ? "pass" : "warn", order ? "No skipped levels" : "A level is skipped", false, 1);
  add("alt", "Image alt text", noAlt === 0 ? "pass" : noAlt < imgs.length / 2 ? "warn" : "fail", `${imgs.length - noAlt}/${imgs.length} images described`, true, 2);
  add("words", "Content depth", words > 450 ? "pass" : words > 250 ? "warn" : "fail", `${words} words`, false, 2);
  add("schema", "Structured data (JSON-LD)", schema ? "pass" : "fail", schema ? "Present" : "No schema markup", true, 3);
  add("og", "Open Graph image", og ? "pass" : "warn", og ? "Present" : "Missing", true, 1);
  add("canonical", "Canonical URL", canonical ? "pass" : "warn", canonical ? canonical.getAttribute("href") : "Add once the domain is known", true, 1);
  add("links", "Internal links", internal >= 6 ? "pass" : "warn", `${internal} anchor links`, false, 1);
  add("lazy", "Lazy-loaded media", imgs.length === 0 || lazy >= imgs.length - 3 ? "pass" : "warn", `${lazy}/${imgs.length} lazy`, false, 1);
  add("viewport", "Mobile viewport", d.querySelector('meta[name="viewport"]') ? "pass" : "fail", "", false, 1);
  add("lang", "Language attribute", d.documentElement.getAttribute("lang") ? "pass" : "warn", "", false, 1);
  add("contact", "Contact signals (phone/email/address)", (spec.brand.phone || spec.brand.email) ? "pass" : "warn", spec.brand.phone || spec.brand.email ? "Found" : "No phone or email on the page", false, 1);
  add("local", "Local intent (city in copy)", spec.brand.city && text.toLowerCase().includes(spec.brand.city.split(",")[0].toLowerCase()) ? "pass" : "warn", spec.brand.city ? `City: ${spec.brand.city}` : "No service area detected", false, 2);
  add("faq", "FAQ content", spec.sections?.some(s => s.type === "faq") ? "pass" : "warn", "", false, 1);

  const total = checks.reduce((a, c) => a + c.weight, 0);
  const got = checks.reduce((a, c) => a + c.weight * (c.status === "pass" ? 1 : c.status === "warn" ? 0.45 : 0), 0);
  const score = Math.round((got / total) * 100);
  return { score, checks, stats: { words, images: imgs.length, headings: hs.length, links: links.length } };
}

export function keywordPlan(spec) {
  const ind = (spec.brand.industry || "").toLowerCase().replace(/&/g, "and");
  const city = (spec.brand.city || "").split(",")[0];
  const svcs = (spec.sections?.find(s => s.type === "services")?.items || []).map(i => i.title.toLowerCase()).slice(0, 4);
  const plan = [];
  const push = (kw, intent, tier) => plan.push({ kw: kw.replace(/\s+/g, " ").trim(), intent, tier });
  if (city) push(`${ind} ${city}`, "commercial", "primary");
  push(`${ind} near me`, "commercial", "primary");
  svcs.forEach((s, i) => push(city ? `${s} ${city}` : `${s} services`, "commercial", i < 2 ? "secondary" : "long-tail"));
  push(`best ${ind}${city ? " in " + city : ""}`, "commercial", "secondary");
  push(`${ind} cost`, "informational", "long-tail");
  push(`how to choose a ${ind.replace(/s$/, "")}`, "informational", "long-tail");
  push(`${spec.brand.name.toLowerCase()} reviews`, "navigational", "brand");
  return plan.slice(0, 10);
}

export function buildSchema(spec) {
  const type = /restaurant/i.test(spec.brand.industry) ? "Restaurant" : /dental|clinic|medical/i.test(spec.brand.industry) ? "MedicalClinic" : /law/i.test(spec.brand.industry) ? "LegalService" : /software|saas/i.test(spec.brand.industry) ? "SoftwareApplication" : "LocalBusiness";
  const base = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": type, "@id": "#business", name: spec.brand.name, description: spec.seo?.description || spec.brand.tagline,
        ...(spec.brand.domain ? { url: `https://${spec.brand.domain}` } : {}),
        ...(spec.brand.phone ? { telephone: spec.brand.phone } : {}),
        ...(spec.brand.email ? { email: spec.brand.email } : {}),
        ...(spec.brand.city ? { address: { "@type": "PostalAddress", addressLocality: spec.brand.city.split(",")[0].trim(), ...(spec.brand.city.includes(",") ? { addressRegion: spec.brand.city.split(",")[1].trim() } : {}) }, areaServed: spec.brand.city } : {}),
        ...(type !== "SoftwareApplication" ? { priceRange: "$$" } : {}),
        makesOffer: (spec.sections?.find(s => s.type === "services")?.items || []).map(i => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: i.title, description: i.text } })),
      },
      { "@type": "WebSite", name: spec.brand.name, ...(spec.brand.domain ? { url: `https://${spec.brand.domain}` } : {}) },
    ],
  };
  const faq = spec.sections?.find(s => s.type === "faq");
  if (faq?.items?.length) base["@graph"].push({ "@type": "FAQPage", mainEntity: faq.items.map(i => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.a } })) });
  const reviews = spec.sections?.find(s => s.type === "testimonials");
  if (reviews?.items?.length) base["@graph"][0].review = reviews.items.map(r => ({ "@type": "Review", reviewBody: r.quote, author: { "@type": "Person", name: r.name } }));
  return base;
}

export function fix(spec, ids = []) {
  const out = structuredClone(spec);
  out.seo = out.seo || {};
  const city = out.brand.city ? ` in ${out.brand.city.split(",")[0]}` : "";
  const ind = out.brand.industry;
  const svc = (out.sections?.find(s => s.type === "services")?.items || []).map(i => i.title);
  const plan = keywordPlan(out);
  const all = ids.length === 0;
  const want = (id) => all || ids.includes(id);
  if (want("title") || want("title-kw")) out.seo.title = clamp(`${out.brand.name} | ${ind}${city}`, 62);
  if (want("desc")) out.seo.description = clamp(`${out.brand.name} is a ${ind.toLowerCase()}${city}. ${svc.slice(0, 3).join(", ")} and more. Free estimates, licensed and insured, replies within one business day.`, 158, 110);
  if (want("schema")) out.seo.schema = buildSchema(out);
  if (want("og")) out.seo.og = { title: out.seo.title || `${out.brand.name} | ${ind}`, description: out.seo.description || out.brand.tagline, image: out.sections?.find(s => s.image)?.image?.url || "" };
  if (want("canonical") && out.brand.domain) out.seo.canonical = `https://${out.brand.domain}/`;
  if (want("alt")) {
    for (const s of out.sections || []) {
      if (s.image) s.image.alt = s.image.alt || `${out.brand.name} ${ind.toLowerCase()}${city}`;
      if (s.images) s.images.forEach((im, i) => { im.alt = im.alt || `${out.brand.name} project ${i + 1}${city}`; });
      if (s.type === "gallery") s.items.forEach(it => { it.image.alt = it.title; });
    }
  }
  if (want("keywords") || all) out.seo.keywords = plan.map(p => p.kw);
  return out;
}

function clamp(s, max, min = 0) {
  if (s.length <= max) return s.length >= min ? s : s;
  const cut = s.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), min)).replace(/[,\s]+$/, "");
}
