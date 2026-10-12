// @ts-nocheck
// Hard gates: deterministic checks at every step of the build. They do not
// involve the model's judgement and they never downgrade: a gate either
// passes, or returns the reasons the step is rejected. The pipeline then
// retries the step once with those reasons as feedback, and fails the build
// (lead status "failed", reasons in the email and the dashboard) if the
// retry does not clear them. Nothing that fails a gate is ever sent.
import { byType, byId } from "./components";
import { fitErrors, fitErrorsWritten, STUDIO_TYPES } from "./fit";

export interface GateResult { errors: string[]; warnings: string[] }
const ok = (): GateResult => ({ errors: [], warnings: [] });

/** The visual components that may carry the flagship showcase (home page, second section). */
export const FLAGSHIP_TYPES = new Set([
  "story-blinds", "story-wipe", "projects-wedge", "photo-wall", "tiles-reveal", "wave-column", "gallery", "pile",
  "one-image", "gallery-bend", "gallery-pixel-wipe", "gallery-edge-blur", "fold-planes", "snap-panels", "strip-horizontal",
  "wall-stages", "portfolio-morph", "cards-flip", "film-strip-15", "strip-preview-1", "grid-zoom-16", "panels-curtain-24", "gallery-collapse-4",
]);
export const PROOF_TYPES = new Set(["stats", "testimonials"]);
/** A section type that can carry a photograph (its field shape has image, images, slides or item queries). */
/** Sections that end a text-only run without carrying a photo (bands and the closing ask). */
export const RUN_BREAKERS = new Set(["cta", "cta-review", "accent-marquee"]);
export const canShowPhoto = (type: string) => { const c = byType[type]; return Boolean(c && c.kind !== "menu" && /"image"|"images"|"slides"|"query"/.test(c.fields || "")); };
/** A written section that actually carries one. */
export const hasPhoto = (s) => Boolean(s && ((s.image && (s.image.query || s.image.url)) || (Array.isArray(s.images) && s.images.length) || (Array.isArray(s.slides) && s.slides.length) || (Array.isArray(s.items) && s.items.some(it => it && (it.query || it.image)))));
const NO_PHOTO_PAGES = new Set(["contact", "faq", "reviews"]); // pages that may open without a photo
export const REQUIRED_PAGES = ["index", "about", "services", "contact"];

const brandWordOf = (name = "") => {
  const clean = String(name).replace(/\b(LLC|L\.L\.C\.|Inc\.?|Co\.?|Corp\.?|Ltd\.?|Company|Construction|Contracting|Services|Group)\b/gi, "").replace(/[^A-Za-z0-9 &'-]/g, " ").replace(/\s+/g, " ").trim();
  const words = clean.split(" ").filter(Boolean);
  const full = words.join(" ").toUpperCase();
  if (full.length >= 3 && full.length <= 12 && words.length <= 2) return full;
  const first = (words.find(w => w.length >= 3) || words[0] || String(name).split(" ")[0] || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return first.slice(0, 12) || "STUDIO";
};

/* ------------------------------------------------------------ research */
export function gateResearch(job): GateResult {
  // Research fails only when there is nothing to build from. A thin site (few
  // photos, no reviews yet, one service) is normal for a small contractor: the
  // build goes ahead with what exists, stock photography fills the gaps, and
  // every gap is reported to the owner in the email.
  const r = ok(), d = job.dossier || {}, a = job.analysis;
  const services = (d.services || []).length, photos = (d.photos || []).length, proof = (d.proof || []).length;
  if (!d.name && !job.lead.businessName) r.errors.push("research found no company name");
  if (!services && !job.lead.companyDetails && !(d.story || d.mission)) r.errors.push("research found no services and the form had no company details; there is nothing to build a site from");
  if (job.lead.website && !a && !services) r.errors.push(`their website ${job.lead.website} could not be read and nothing else was found`);
  if (services === 1) r.warnings.push("one service found; the site is built around it");
  if (job.lead.website && photos < 3) r.warnings.push(`only ${photos} usable photo${photos === 1 ? "" : "s"} found on their site; stock photography fills the rest (ask them for job photos)`);
  if (!job.lead.website) r.warnings.push("no website given; photos are stock until they send their own");
  if (!proof) r.warnings.push("no reviews found online; the site shows licence, years and guarantees as proof instead");
  if (!d.phone && !d.email && !job.lead.phone && !job.lead.email) r.warnings.push("no phone or email found for the company");
  if (a && !a.logo) r.warnings.push("no logo image found on their site; the site uses a wordmark");
  if (!job.hook?.hook?.claim) r.errors.push("no hook strategy: the home page has nothing to lead with");
  else if (!job.hook.flagship?.title) r.warnings.push("hook strategy has no flagship; the strongest service stands in");
  return r;
}

/* ---------------------------------------------------------------- plan */
export function gatePlan(job, recent: { hero?: string; menu?: string }[] = []): GateResult {
  const r = ok(), plan = job.plan;
  if (!plan || !Array.isArray(plan.pages) || !plan.pages.length) { r.errors.push("the planner returned no pages"); return r; }
  const slugs = plan.pages.map(p => p.slug);
  for (const need of REQUIRED_PAGES) if (!slugs.includes(need)) r.warnings.push(`plan had no "${need}" page (added with a default layout)`);
  if (plan.pages.length < 7) r.warnings.push(`plan has ${plan.pages.length} pages; a complete site has 7 to 14`);
  if (plan.pages.length > 20) r.warnings.push(`plan has ${plan.pages.length} pages; too many to build well (at most 20)`);
  const dup = slugs.filter((s, i) => slugs.indexOf(s) !== i);
  if (dup.length) r.warnings.push(`duplicate pages: ${[...new Set(dup)].join(", ")}`);
  for (const p of plan.pages) {
    if (!(p.sections || []).length) r.warnings.push(`page ${p.slug} has no sections`);
    for (const s of p.sections || []) if (!byType[s.type]) r.warnings.push(`page ${p.slug} uses unknown section type "${s.type}"`);
  }
  const home = plan.pages.find(p => p.slug === "index");
  if (home) {
    const secs = home.sections || [];
    if (secs.length < 7) r.warnings.push(`home page has ${secs.length} sections; it needs 8 to 12`);
    const first = secs[0];
    if (!first || byType[first.type]?.kind !== "hero") r.warnings.push("home page does not open with a hero");
    if (job.videoRequested && first && first.type !== "hero-video-scrub") r.warnings.push("a hero video is being generated but the home hero is not hero-video-scrub");
    if (!job.videoRequested && first && first.type === "hero-video-scrub") r.warnings.push("home hero is hero-video-scrub but no hero video was requested");
    // the spine: hero, then within the next five sections the flagship showcase (proof-feature or a pack reveal of the work) and the proof (manifesto with stats, stats, testimonials or proof-feature); an accent marquee and a manifesto may sit right after the hero
    const early = secs.slice(1, 6).map(s => s.type);
    const hasFlagship = early.some(t => FLAGSHIP_TYPES.has(t) || t === "proof-feature");
    const hasProof = early.some(t => PROOF_TYPES.has(t) || t === "manifesto" || t === "proof-feature");
    if (!hasFlagship) r.warnings.push(`home page has no flagship showcase in its first five sections after the hero (proof-feature, or ${[...FLAGSHIP_TYPES].slice(0, 6).join(", ")}…); it has ${early.join(" → ")}`);
    if (!hasProof) r.warnings.push(`home page has no proof in its first five sections after the hero (manifesto with stats, stats, testimonials or proof-feature); it has ${early.join(" → ")}`);
    if (!secs.some(s => s.type === "cta" || s.type === "cta-review")) r.warnings.push("home page has no closing ask (cta or cta-review)");
    const visual = secs.filter(s => canShowPhoto(s.type)).length;
    if (visual < 4) r.warnings.push(`home page has only ${visual} sections that can carry a photograph; it needs at least four (the company has real photos to show)`);
  }
  // no page may run three text-only sections in a row, and every inner page opens with a photo-capable section
  for (const p of plan.pages) {
    const secs = p.sections || [];
    let run = 0;
    for (const s of secs) { run = canShowPhoto(s.type) || s.type === "cta" || s.type === "cta-review" || s.type === "accent-marquee" ? 0 : run + 1; if (run >= 4) { r.warnings.push(`page ${p.slug} runs four text-only sections in a row (${secs.map(x => x.type).join(" → ")}); put a photo-led section (gallery, one-image, story, tiles, services with photos, a text block with its image) between them`); break; } }
    if (p.slug !== "index" && !NO_PHOTO_PAGES.has(p.slug) && !secs.slice(0, 2).some(s => canShowPhoto(s.type))) r.warnings.push(`page ${p.slug} opens with two sections that cannot show a photo (${secs.slice(0, 2).map(x => x.type).join(", ")}); the first or second section must carry one of their real photos`);
  }
  if (home && !(home.sections || []).some(s => s.type === "services")) r.warnings.push("home page has no services section");
  const svcPages = plan.pages.filter(p => /^services\//.test(p.slug));
  const withHero = svcPages.filter(p => byType[p.sections?.[0]?.type]?.kind === "hero").map(p => p.slug);
  if (withHero.length && withHero.length !== svcPages.length) r.warnings.push(`service pages open differently: ${withHero.join(", ")} start with a hero, ${svcPages.filter(p => !withHero.includes(p.slug)).map(p => p.slug).join(", ")} do not; give every service page the same opening`);
  const heavy = plan.pages.flatMap(p => (p.sections || []).filter(s => byType[s.type]?.weight === "heavy").map(s => `${p.slug}:${s.type}`));
  if (heavy.length > 1) r.warnings.push(`more than one heavy (WebGL) section: ${heavy.join(", ")}`);
  if (heavy.some(h => !h.startsWith("index:"))) r.warnings.push(`heavy section outside the home page: ${heavy.join(", ")}`);
  const packUse = {};
  for (const p of plan.pages) for (const s of p.sections || []) { const c = byType[s.type]; if (c && c.id !== c.type) packUse[c.id] = (packUse[c.id] || 0) + 1; }
  // a pack effect may appear twice per site (three times for a light effect on a big site); generic blocks are unlimited
  const limitFor = (id) => (byId[id]?.weight === "light" && plan.pages.length > 12 ? 3 : 2);
  const over = Object.entries(packUse).filter(([id, n]) => n > limitFor(id)).map(([id, n]) => `${id} ×${n} (max ${limitFor(id)})`);
  if (over.length) r.warnings.push(`pack effects used too often: ${over.join(", ")}`);
  for (const e of fitErrors(plan, (job.dossier?.photos || []).length)) r.warnings.push(`fit: ${e}`);
  const hero = home?.sections?.[0]?.component, menu = plan.nav?.menu;
  if (!menu || !byId[menu] || byId[menu].kind !== "menu") r.warnings.push(`nav.menu "${menu}" is not a menu component`);
  const packSet = new Set(Object.keys(packUse));
  const lastSets = recent.map(x => x.effects || []).filter(a => a.length);
  for (const prev of lastSets.slice(0, 1)) { const overlap = prev.filter(id => packSet.has(id)).length; if (packSet.size >= 4 && overlap / Math.max(packSet.size, 1) > 0.6) r.warnings.push(`this plan reuses ${overlap} of its ${packSet.size} pack effects from the previous build (${prev.join(", ")}); choose a different set so the site looks different`); }
  const lastHeroes = recent.map(x => x.hero).filter(Boolean), lastMenus = recent.map(x => x.menu).filter(Boolean);
  if (hero && hero !== "hero-video-scrub" && lastHeroes.includes(hero)) r.warnings.push(`home hero ${hero} was used on a recent build (${lastHeroes.join(", ")}); every build must look different, choose another offered hero`);
  if (menu && lastMenus.includes(menu)) r.warnings.push(`menu ${menu} was used on a recent build (${lastMenus.join(", ")}); choose another offered menu`);
  if (!plan.theme?.accent) r.warnings.push("no accent colour in the theme");
  if (plan.theme?.pair === "oswald") r.warnings.push("theme.pair is oswald, the agency's own type; choose clash, archivo, anton, jost, syne, serif, fraunces, bricolage or grotesk");
  const lastPairs = recent.map(x => x.pair).filter(Boolean);
  if (plan.theme?.pair && lastPairs[0] === plan.theme.pair) r.warnings.push(`theme.pair ${plan.theme.pair} is what the previous build used; choose a different pair`);
  if (home) {
    const types = (home.sections || []).map(s => s.type);
    const studio = types.filter(t => STUDIO_TYPES.has(t)).length;
    const pack = types.filter(t => byType[t] && byType[t].id !== byType[t].type && t !== "hero-video-scrub").length;
    if (studio < 3) r.warnings.push(`home page uses ${studio} studio section${studio === 1 ? "" : "s"} (manifesto, service-rail, proof-feature, texture-loop, process-cards, accent-marquee, areas-list, cta-review); it needs at least three`);
    if (pack < 3) r.warnings.push(`home page uses ${pack} Awwwards Pack effect${pack === 1 ? "" : "s"}; it needs at least three (a work gallery, a story or tiles reveal, a statement or echo…)`);
    if (!types.includes("cta-review") && !types.includes("cta")) r.warnings.push("home page has no closing ask");
  }
  for (const p of plan.pages) {
    if (p.slug === "index") continue;
    const types = (p.sections || []).map(s => s.type);
    if (!types.some(t => byType[t] && byType[t].id !== byType[t].type)) r.warnings.push(`page ${p.slug} uses no pack effect`);
  }
  if (!plan.brand?.name) r.warnings.push("plan has no brand name");
  if (job.analysis?.logo?.url && !plan.brand?.logo?.url) r.warnings.push("their logo was found on their site but the plan does not use it");
  return r;
}

/* --------------------------------------------------------------- pages */
export function gatePages(job): GateResult {
  const r = ok(), plan = job.plan, pages = job.pages || [];
  const want = brandWordOf(plan?.brand?.name);
  for (const pp of plan?.pages || []) {
    const w = pages.find(p => p.slug === pp.slug);
    if (!w) { (pp.slug === "index" ? r.errors : r.warnings).push(`page ${pp.slug} was never written`); continue; }
    if (w.failed || !(w.sections || []).length) { (pp.slug === "index" ? r.errors : r.warnings).push(`page ${pp.slug} could not be written${pp.slug === "index" ? "" : " and is left out"}`); continue; }
    if (w.sections.length < Math.min(3, (pp.sections || []).length)) r.warnings.push(`page ${pp.slug} came back with ${w.sections.length} of ${(pp.sections || []).length} planned sections`);
    for (const s of w.sections) {
      const c = byType[s.type];
      if (!c) { r.warnings.push(`page ${pp.slug} has unknown section "${s.type}"`); continue; }
      if (c.kind === "hero") {
        const word = String(s.word || "").toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim();
        if (typeof s.word === "string" && word && word !== want) r.warnings.push(`page ${pp.slug} hero word is "${s.word}"; it must be the brand word "${want}"`);
        if (!s.headline && !s.title && !s.sub) r.warnings.push(`page ${pp.slug} hero has no headline`);
      }
      if (c.type === "testimonials" && Array.isArray(s.items) && s.items.some(it => !it.quote && !it.text)) r.warnings.push(`page ${pp.slug} has a testimonial item without a quote`);
    }
  }
  for (const e of fitErrorsWritten(pages)) { if (/\bitems?;/.test(e) || /has \d+ items/.test(e)) r.warnings.push(`fit: ${e}`); else r.warnings.push(`fit: ${e}`); }
  // written pages: the photo-capable sections actually got photos
  for (const w of pages) {
    if (w.failed || !(w.sections || []).length || NO_PHOTO_PAGES.has(w.slug)) continue;
    if (w.slug !== "index" && !w.sections.slice(0, 2).some(hasPhoto)) r.warnings.push(`page ${w.slug} opens without a photo in its first two sections`);
    const capable = w.sections.filter(s => canShowPhoto(s.type)), filled = capable.filter(hasPhoto);
    if (capable.length && filled.length < Math.ceil(capable.length / 2)) r.warnings.push(`page ${w.slug}: ${filled.length} of ${capable.length} photo-capable sections carry a photo; at least half must`);
  }
  const home = pages.find(p => p.slug === "index");
  if (home && job.hook?.hook?.claim) {
    const h = home.sections[0] || {};
    const text = [h.headline, h.title, h.sub, h.word].filter(Boolean).join(" ").toLowerCase();
    const name = String(plan?.brand?.name || "").toLowerCase().split(/\s+/)[0] || "";
    if (name && !text.includes(name) && !(home.sections[0]?.type === "hero-video-scrub")) r.warnings.push("home hero copy does not name the company");
  }
  return r;
}

/* ---------------------------------------------------------------- spec */
export function gateSpec(spec, job): GateResult {
  const r = ok();
  if (job.videoRequested && !spec.video) r.warnings.push("the hero film was not delivered in time; the home page opens on their best photo instead");
  if (job.analysis?.logo?.url && !spec.brand?.logo?.url) r.warnings.push("their logo was found but the site does not use it");
  const want = brandWordOf(spec.brand?.name);
  for (const p of spec.pages || []) for (const s of p.sections || []) {
    const c = byType[s.type];
    if (c?.kind === "hero" && typeof s.word === "string") {
      const word = String(s.word).toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim();
      if (word.length > 12 || word !== want) r.warnings.push(`page ${p.slug} hero word "${s.word}" was set to "${want}"`);
    }
  }
  if (!(spec.pages || []).length) r.errors.push("no pages to render");
  return r;
}

/* ---------------------------------------------------------- inspection */
/** Turn the browser inspection report (lib/build/inspect.ts) into gate errors. */
export function gateInspection(report): GateResult {
  // Blocking: the page does not work (did not load, script errors, blank sections, broken links, a layout wider than the screen by a lot).
  // Notes: everything a repair round can polish (small overflow, clipped headline, missing logo image, broken image, no h1).
  const r = ok();
  if (!report) { r.errors.push("the site was not inspected in a browser"); return r; }
  for (const p of report.pages || []) {
    const tag = `${p.slug === "index" ? "home" : p.slug} (${p.viewport})`;
    if (p.loadError) { r.errors.push(`${tag}: did not load: ${p.loadError}`); continue; }
    if (p.consoleErrors?.length) r.errors.push(`${tag}: ${p.consoleErrors.length} script error${p.consoleErrors.length > 1 ? "s" : ""}: ${p.consoleErrors.slice(0, 2).join(" | ").slice(0, 200)}`);
    for (const b of p.blankSections || []) r.errors.push(`${tag}: section ${b.index + 1} (${b.type}) renders blank`);
    if (p.brokenLinks?.length) r.errors.push(`${tag}: ${p.brokenLinks.length} broken link${p.brokenLinks.length > 1 ? "s" : ""}: ${p.brokenLinks.slice(0, 3).join(", ")}`);
    if (p.overflowPx > 120) r.errors.push(`${tag}: page overflows horizontally by ${p.overflowPx}px${p.overflowBy?.length ? " (" + p.overflowBy.slice(0, 2).join(", ") + ")" : ""}`);
    else if (p.overflowPx > 2) r.warnings.push(`${tag}: page overflows horizontally by ${p.overflowPx}px${p.overflowBy?.length ? " (" + p.overflowBy.slice(0, 2).join(", ") + ")" : ""}`);
    if (p.brokenImages?.length) r.warnings.push(`${tag}: ${p.brokenImages.length} broken image${p.brokenImages.length > 1 ? "s" : ""}: ${p.brokenImages.slice(0, 2).join(", ").slice(0, 160)}`);
    for (const c of p.clippedText || []) r.warnings.push(`${tag}: text clipped off screen: "${c.slice(0, 60)}"`);
    if (!p.hasH1) r.warnings.push(`${tag}: no h1`);
    if (p.logoExpected && !p.logoInNav) r.warnings.push(`${tag}: their logo is missing from the navigation`);
    if (typeof p.longFramePct === "number" && p.longFramePct > 10) r.warnings.push(`${tag}: ${p.longFramePct}% long frames while scrolling in the headless browser (CPU rendering; a real device is far smoother)`);
    if (typeof p.weightMB === "number" && p.weightMB > 9) r.warnings.push(`${tag}: ${p.weightMB} MB transferred on load and first scroll`);
    if (p.tinyText > 0) r.warnings.push(`${tag}: ${p.tinyText} text blocks under 12px`);
  }
  return r;
}

export const summarize = (g: GateResult) => g.errors.join("; ");
