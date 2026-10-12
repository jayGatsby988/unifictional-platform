// @ts-nocheck
// Ported from Unifictional Studio public/assets/js/seo.js (the SEO agent's
// rule layer), rewritten to run on the server: the audit reads the rendered
// HTML with regular expressions instead of DOMParser. Same checks, same
// weights, so the score means the same thing it did in the Studio.

const len = (s) => (s || "").trim().length;
const strip = (s = "") => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const all = (re, s, i = 1) => { const out = []; let m; while ((m = re.exec(s))) out.push(m[i]); return out; };
const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i")) || [])[1];

export function audit(html, spec) {
  const checks = [];
  const add = (id, label, status, detail, fixable = false, weight = 1) => checks.push({ id, label, status, detail, fixable, weight });

  const noScript = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ");
  const title = strip((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  const descTag = (html.match(/<meta[^>]+name=["']description["'][^>]*>/i) || [])[0] || "";
  const desc = descTag ? attr(descTag, "content") || "" : "";
  const h1s = all(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, noScript).map(strip);
  const hs = all(/<h([1-4])\b/gi, noScript).map(Number);
  const imgs = [...all(/(<img\b[^>]*>)/gi, noScript), ...all(/(<(?:div|span|figure|a)\b[^>]*role=["']img["'][^>]*>)/gi, noScript)];
  const noAlt = imgs.filter(t => !((attr(t, "alt") || attr(t, "aria-label") || "").trim())).length;
  const bodyHtml = (noScript.match(/<body[\s\S]*<\/body>/i) || [noScript])[0];
  const text = strip(bodyHtml);
  const words = text ? text.split(" ").length : 0;
  const kw = (spec.seo?.keywords || []).map(k => String(k).toLowerCase());
  const primary = kw[0] || `${spec.brand.industry || ""} ${spec.brand.city || ""}`.toLowerCase().trim();
  const schema = /<script[^>]+application\/ld\+json/i.test(html);
  const og = /<meta[^>]+property=["']og:image["']/i.test(html);
  const canonical = (html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i) || [])[1];
  const links = all(/<a\b[^>]*href=["']([^"']*)["']/gi, noScript);
  const internal = links.filter(h => h.startsWith("#")).length;
  const lazy = imgs.filter(t => attr(t, "loading") === "lazy").length;

  add("title", "Title tag", len(title) >= 30 && len(title) <= 62 ? "pass" : len(title) ? "warn" : "fail", len(title) ? `${len(title)} chars: “${title}”` : "Missing", true, 3);
  add("title-kw", "Primary keyword in title", primary && title.toLowerCase().includes(primary.split(" ")[0]) ? "pass" : "warn", `Primary: “${primary}”`, true, 2);
  add("desc", "Meta description", len(desc) >= 110 && len(desc) <= 158 ? "pass" : len(desc) ? "warn" : "fail", len(desc) ? `${len(desc)} chars` : "Missing", true, 3);
  add("h1", "One H1", h1s.length === 1 ? "pass" : "fail", `${h1s.length} found`, false, 2);
  add("h1-kw", "Keyword or intent in H1", h1s[0] && /\w/.test(h1s[0]) && (h1s[0].toLowerCase().includes(primary.split(" ")[0]) || h1s[0].length > 20) ? "pass" : "warn", h1s[0] || "", false, 1);
  let order = true; for (let i = 1; i < hs.length; i++) if (hs[i] - hs[i - 1] > 1) order = false;
  add("h-order", "Heading hierarchy", order ? "pass" : "warn", order ? "No skipped levels" : "A level is skipped", false, 1);
  add("alt", "Image alt text", noAlt === 0 ? "pass" : noAlt < imgs.length / 2 ? "warn" : "fail", `${imgs.length - noAlt}/${imgs.length} images described`, true, 2);
  add("words", "Content depth", words > 450 ? "pass" : words > 250 ? "warn" : "fail", `${words} words`, false, 2);
  add("schema", "Structured data (JSON-LD)", schema ? "pass" : "fail", schema ? "Present" : "No schema markup", true, 3);
  add("og", "Open Graph image", og ? "pass" : "warn", og ? "Present" : "Missing", true, 1);
  add("canonical", "Canonical URL", canonical ? "pass" : "warn", canonical || "Add once the domain is known", true, 1);
  add("links", "Internal links", internal >= 6 ? "pass" : "warn", `${internal} anchor links`, false, 1);
  add("lazy", "Lazy-loaded media", imgs.length === 0 || lazy >= imgs.length - 3 ? "pass" : "warn", `${lazy}/${imgs.length} lazy`, false, 1);
  add("viewport", "Mobile viewport", /<meta[^>]+name=["']viewport["']/i.test(html) ? "pass" : "fail", "", false, 1);
  add("lang", "Language attribute", /<html[^>]+lang=/i.test(html) ? "pass" : "warn", "", false, 1);
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
  const svcs = (spec.sections?.find(s => s.type === "services")?.items || []).map(i => String(i.title || "").toLowerCase()).slice(0, 4);
  const plan = [];
  const push = (kw, intent, tier) => plan.push({ kw: kw.replace(/\s+/g, " ").trim(), intent, tier, page: "home" });
  if (city) push(`${ind} ${city}`, "commercial", "primary");
  push(`${ind} near me`, "commercial", "primary");
  svcs.forEach((s, i) => push(city ? `${s} ${city}` : `${s} services`, "commercial", i < 2 ? "secondary" : "long-tail"));
  push(`best ${ind}${city ? " in " + city : ""}`, "commercial", "secondary");
  push(`${ind} cost`, "informational", "long-tail");
  push(`how to choose a ${ind.replace(/s$/, "")}`, "informational", "long-tail");
  push(`${(spec.brand.name || "").toLowerCase()} reviews`, "navigational", "brand");
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

// Patch the spec for the given check ids (all fixable ones when empty).
export function fix(spec, ids = []) {
  const out = structuredClone(spec);
  out.seo = out.seo || {};
  const city = out.brand.city ? ` in ${out.brand.city.split(",")[0]}` : "";
  const ind = out.brand.industry || "";
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
      if (s.type === "gallery") (s.items || []).forEach(it => { if (it.image) it.image.alt = it.image.alt || it.title; });
    }
  }
  if (want("keywords") || all) out.seo.keywords = plan.map(p => p.kw);
  return out;
}

function clamp(s, max, min = 0) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), min)).replace(/[,\s]+$/, "");
}

/* ---------------------------------------------------------- per page */
// JSON-LD for one page of a multi-page spec: LocalBusiness + WebSite on the
// home page, Service + breadcrumbs on service pages, FAQPage wherever there
// is a faq section, reviews on the reviews page.
export function schemaForPage(spec, page) {
  const b = spec.brand || {};
  const site = b.domain ? `https://${b.domain}` : "";
  const pageUrl = site ? (page.slug === "index" ? site + "/" : `${site}/${page.slug}/`) : undefined;
  const type = /restaurant/i.test(b.industry) ? "Restaurant" : /dental|clinic|medical/i.test(b.industry) ? "MedicalClinic" : /law/i.test(b.industry) ? "LegalService" : "LocalBusiness";
  const business = {
    "@type": type, "@id": site ? site + "/#business" : "#business", name: b.name, description: b.tagline,
    ...(site ? { url: site } : {}), ...(b.phone ? { telephone: b.phone } : {}), ...(b.email ? { email: b.email } : {}),
    ...(b.logo?.url ? { logo: b.logo.url, image: b.logo.url } : {}),
    ...(b.address ? { address: { "@type": "PostalAddress", streetAddress: b.address } } : b.city ? { address: { "@type": "PostalAddress", addressLocality: b.city.split(",")[0].trim(), ...(b.city.includes(",") ? { addressRegion: b.city.split(",")[1].trim() } : {}) } } : {}),
    ...(b.serviceArea || b.city ? { areaServed: b.serviceArea || b.city } : {}),
    ...(b.hours ? { openingHours: b.hours } : {}),
    ...(Object.values(b.social || {}).some(Boolean) ? { sameAs: Object.values(b.social).filter(Boolean) } : {}),
    priceRange: "$$",
  };
  const graph = [];
  if (page.slug === "index") {
    const services = (spec.pages || []).filter(p => /^services\//.test(p.slug)).map(p => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: p.title, ...(site ? { url: `${site}/${p.slug}/` } : {}) } }));
    graph.push({ ...business, ...(services.length ? { makesOffer: services } : {}) }, { "@type": "WebSite", name: b.name, ...(site ? { url: site } : {}) });
  } else {
    graph.push({ "@type": "WebPage", name: page.seo?.title || page.title, ...(pageUrl ? { url: pageUrl } : {}), isPartOf: { "@type": "WebSite", name: b.name, ...(site ? { url: site } : {}) }, about: { "@id": business["@id"] } });
    const crumbs = page.slug.split("/");
    graph.push({ "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", ...(site ? { item: site + "/" } : {}) }, ...crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 2, name: i === crumbs.length - 1 ? (page.title || c) : c.replace(/-/g, " "), ...(site ? { item: `${site}/${crumbs.slice(0, i + 1).join("/")}/` } : {}) }))] });
    if (/^services\//.test(page.slug)) graph.push({ "@type": "Service", name: page.title, provider: { "@id": business["@id"] }, ...(b.serviceArea || b.city ? { areaServed: b.serviceArea || b.city } : {}), description: page.seo?.description || "" });
    if (page.slug === "contact" || page.slug === "about") graph.push(business);
  }
  const faq = (page.sections || []).find(s => s.type === "faq");
  if (faq?.items?.length) graph.push({ "@type": "FAQPage", mainEntity: faq.items.map(i => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.a } })) });
  const reviews = (page.sections || []).find(s => s.type === "testimonials");
  if (reviews?.items?.length && (page.slug === "index" || page.slug === "reviews")) graph[0].review = reviews.items.map(r => ({ "@type": "Review", reviewBody: r.quote, author: { "@type": "Person", name: r.name } }));
  return { "@context": "https://schema.org", "@graph": graph };
}
