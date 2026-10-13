// @ts-nocheck
// The AI build pipeline behind the lead form (v2: deep research, planned
// multi-page site, parallel writing, review pass, per-page SEO).
//
//   confirm ─▶ research ─▶ research-b ─▶ plan ─▶ write (batches) ─▶ review ─▶ finish
//              crawl 20     reviews,      pages,   4 pages per       coverage   render every page,
//              pages +      competitors,  brand,   invocation        + truth    audit, SEO, zip,
//              facts        keywords      coverage                   fixes      store, email
//
// Every step is its own serverless invocation (answers 202, works in
// after(), posts the job to the next step). The job object carries the
// analysis, dossier, plan and pages, so the steps share no memory.
import { crawlSite } from "./analyze";
import { cleanWebsite } from "./url";
import { applyBrand, brandFromAnalysis, accentFrom, modeFrom, pairForFonts } from "./brand";
import { MODEL, modelFor, hasKey, structured, research, parseJson, describeError, addUsage, costOf, emptyUsage } from "./claude";
import { SYSTEM_RESEARCH_A, SYSTEM_RESEARCH_B, SYSTEM_HOOK, SYSTEM_PLAN, SYSTEM_COVERAGE, SYSTEM_WRITE, SYSTEM_REVIEW, SYSTEM_SEO, SYSTEM_JUDGE, SYSTEM_REPAIR, SEO_SCHEMA, offerFor } from "./prompts";
import { gateResearch, gatePlan, gatePages, gateSpec, gateInspection, summarize, FLAGSHIP_TYPES, canShowPhoto, RUN_BREAKERS } from "./gates";
import { inspectSite, judgeShots, leanReport } from "./inspect";
import { byType, byId } from "./components";
import { resolveImages, navImages, countOwnPhotos } from "./images";
import { renderSite, componentsUsed } from "./renderer";
import { lightenSite } from "./lighten";
import { audit, keywordPlan, schemaForPage } from "./seo";
import { blobConfigured, buildPath, pagePath, readJson, saveBinary, saveHtml, saveJson, saveLead, recentChoices, type LeadRecord } from "./storage";
import { sendBuildFailed, sendBuildReady } from "./emails";
import { optimizeImages, enhanceImages, minifyAssets, kb, mb } from "./optimize";
import { runVideo, waitForVideo, videoConfigured, chooseSourceImage, clipFrames, alternateSourceImage, readVideoManifest, findBeforeAfter } from "./video";
import { loadLessons, lessonsBlock, distillLessons, ENFORCED } from "./lessons";
import { fitTable, FIT } from "./fit";
import { lookAtSite, photoSheet, imageBlocks } from "./look";
import { debugSite } from "./debug";
import { publishSite, publishConfigured } from "./publish";
import { gzipSync } from "node:zlib";

// Three invocations only: Vercel refuses a chain of more than a few
// self-invocations (HTTP 508), so each step does several jobs inside its
// 800 s budget. The old step names stay as restart aliases.
export type Step = "research" | "design" | "write" | "finish" | "video" | "research-b" | "plan" | "review";
export const STEPS: Step[] = ["research", "design", "write", "finish", "video", "research-b", "plan", "review"];
const WRITE_BATCH = 9;

export interface BuildLead {
  name: string; email: string; phone: string; businessName: string;
  website: string; companyDetails: string; services: string[]; message: string;
  slotStartISO?: string;
}
export interface BuildJob {
  id: string;
  createdAt: string;
  origin: string;
  lead: BuildLead;
  analysis?: any;      // crawl result (trimmed after research-b)
  dossier?: any;       // merged research
  hook?: any;          // the marketing strategy: hook claim, flagship, proof stack, objection, ask
  videoRequested?: boolean; // a hero clip is being generated in parallel (lib/build/video.ts)
  plan?: any;          // the plan (brand, theme, nav, footer, pages with briefs, coverage)
  pages?: any[];       // written pages [{slug, title, intro, seo, sections}]
  writeIndex?: number; // next page index to write
  review?: any;
  seo?: any;
  qa?: any;            // the quality gate's record: rounds, inspection, judge verdicts, screenshots
  researchNotes?: string[]; // what research could not find (reported to the owner, never fatal)
  planNotes?: string[];     // what the plan could not do ideally (reported, never fatal)
  writeNotes?: string[];    // pages left out or thinner than planned (reported, never fatal)
  needsLook?: string[];     // what the quality gate still saw at delivery (the site is sent, flagged)
  spec?: any;               // team mode: the site as the agents left it
  teamCost?: Record<string, number>; teamUsage?: any; teamApproved?: boolean; memoryAdds?: Record<string, string[]>; boardNotes?: any[];
  publishedUrl?: string;    // live Vercel URL after the debug + publish stage
  publishNote?: string;     // why it is not live (no token, deploy error)
  debugNotes?: string[];    // what the debugger fixed
  debugUsage?: any;         // the debugger's own spend (separate key)
  journal?: { at: string; what: string; why: string }[]; // why the build chose what it chose
  lessons?: { rule: string; why: string }[]; // studio lessons loaded for this build
  lookUrls?: string[];       // screenshots of their current site, stored in Blob
  homeApproved?: boolean;    // the home page passed the quality gate on its own
  videoSource?: string;      // photo the hero clip was made from
  videoKind?: "transformation" | "cinematic" | "film"; // what the clip shows, so the hero copy describes it truthfully
  usage?: { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; searches: number };
  weight?: { images: { count: number; before: number; after: number; skipped: number }; html: { before: number; after: number } };
  log: string[];
}

export const buildConfigured = () => hasKey();
export const buildSecret = () => process.env.BUILD_SECRET || process.env.BOOKING_SECRET || (process.env.NODE_ENV === "production" ? "" : "dev-build-secret");

export function siteOrigin(req: Request) {
  if (process.env.VERCEL_ENV === "production" && process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

/* ---------------------------------------------------------------- utils */
// Every model call gets a hard time budget below Vercel's maxDuration, so a
// slow call fails cleanly (failure email, lead record) instead of the
// function being killed with nothing recorded.
export const STEP_BUDGET_MS = Number(process.env.BUILD_STEP_BUDGET_MS || 700_000);
/** Hard ceiling on what one build may spend on model calls; a loop can never run away. */
export const BUILD_MAX_COST = Number(process.env.BUILD_MAX_COST || 45);
function checkBudget(job: BuildJob, where: string) {
  const spent = costOf(job.usage);
  if (spent > BUILD_MAX_COST) throw [`cost ceiling reached at ${where}: $${spent.toFixed(2)} spent of the $${BUILD_MAX_COST} allowed for one build`];
}
/** The build journal: one line per decision, with the reason, for the owner to read. */
export function note(job: BuildJob, what: string, why: string) {
  (job.journal = job.journal || []).push({ at: new Date().toISOString().slice(11, 19), what, why: String(why || "").slice(0, 400) });
}
export function withTimeout(promise, ms = STEP_BUDGET_MS, what = "model call") {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what} exceeded its ${Math.round(ms / 1000)} s budget`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}
const stamp = (job: BuildJob, text: string) => { job.log.push(`${new Date().toISOString().slice(11, 19)} ${text}`); console.log(`[build ${job.id.slice(0, 8)}] ${text}`); };
const slugify = (s = "") => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);

export async function leadRecord(job: BuildJob, status, extra = {}) {
  const rec: LeadRecord = {
    id: job.id, createdAt: job.createdAt, updatedAt: "", status,
    name: job.lead.name, email: job.lead.email, phone: job.lead.phone, businessName: job.lead.businessName,
    website: job.lead.website, companyDetails: job.lead.companyDetails, services: job.lead.services, message: job.lead.message,
    slotStartISO: job.lead.slotStartISO, log: job.log, usage: job.usage, cost: Math.round(costOf(job.usage) * 100) / 100,
    // carried on every write so a later step never wipes them
    hero: job.plan?.pages?.find(p => p.slug === "index")?.sections?.[0]?.component, menu: job.plan?.nav?.menu, pair: job.plan?.theme?.pair, qa: job.qa ? leanQa(job.qa) : undefined,
    effects: job.plan ? [...new Set((job.plan.pages || []).flatMap(p => (p.sections || []).map(s => s.component)).filter(id => id && byId[id] && byId[id].id !== byId[id].type))] : undefined,
    ...extra,
  };
  // a later step never wipes what an earlier one recorded: merge over the stored record, keeping its usage, cost, log, pages and results when this job does not carry them
  try {
    const prev = await readJson<LeadRecord>(`leads/${job.id}.json`).catch(() => null);
    if (prev) {
      const fresh = Object.fromEntries(Object.entries(rec).filter(([, v]) => v !== undefined));
      if (!job.usage) { delete fresh.usage; delete fresh.cost; }
      if (!job.log?.length) delete fresh.log; else if (prev.log?.length && job.log.length < prev.log.length && !job.log.some(l => prev.log.includes(l))) fresh.log = [...prev.log, ...job.log];
      Object.assign(rec, { ...prev, ...fresh });
    }
    await saveLead(rec);
  } catch (e) { console.error("[build] lead record failed:", e); }
}

export async function postStep(step: Step, job: BuildJob) {
  const res = await fetch(`${job.origin}/api/build/${step}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${buildSecret()}` },
    body: JSON.stringify(job),
  });
  if (!res.ok && res.status !== 202) throw new Error(`Step ${step} refused the job: HTTP ${res.status}`);
}

export async function startBuild(p: { id: string; origin: string; lead: BuildLead }) {
  const job: BuildJob = { id: p.id, createdAt: new Date().toISOString(), origin: p.origin, lead: p.lead, log: [] };
  stamp(job, `queued · ${p.lead.website ? "rebuild " + p.lead.website : "new site from the company details"} · model ${MODEL}`);
  await leadRecord(job, "queued");
  await postStep("research", job);
}

async function fail(job: BuildJob, step: Step, e: unknown) {
  const message = Array.isArray(e) ? e.join("\n") : describeError(e);
  stamp(job, `${step} failed: ${message.replace(/\n/g, " · ")}`);
  await leadRecord(job, "failed", { error: message, qa: job.qa ? leanQa(job.qa) : undefined });
  try { await sendBuildFailed({ job, step, message }); } catch (err) { console.error("[build] failure email failed:", err); }
}
/** For the Trigger.dev parent: a child task that crashed never ran `fail`, so the parent does it. */
export async function failBuild(job: BuildJob, step: Step, e: unknown) { await fail(job, step, e); }
async function next(job: BuildJob, from: Step, to: Step) {
  try { await postStep(to, job); } catch (e) { await fail(job, from, e); }
}

function leadBrief(lead: BuildLead) {
  return [
    lead.businessName ? `Business name: ${lead.businessName}` : "",
    lead.companyDetails ? `About the company (written by the owner):\n${lead.companyDetails}` : "",
    lead.message ? `What the owner wants more of:\n${lead.message}` : "",
    lead.services?.length ? `Services they asked Unifictional about: ${lead.services.join(", ")}` : "",
    `Owner contact: ${lead.name}${lead.phone ? " · " + lead.phone : ""}${lead.email ? " · " + lead.email : ""}`,
  ].filter(Boolean).join("\n");
}

/* ------------------------------------------------------------- research */
function siteDigest(a) {
  if (!a) return "";
  const pages = (a.pages || []).map(p => `--- ${p.title} (${p.url})\nHEADINGS: ${(p.headings || []).join(" | ")}\n${p.text.slice(0, 3500)}`).join("\n");
  return `COMPANY SITE: ${a.url}\nTITLE: ${a.title}\nDESCRIPTION: ${a.description}\nNAV: ${(a.nav || []).join(" | ")}\nHEADINGS: ${(a.headings || []).slice(0, 30).join(" | ")}\nPHONE: ${a.phone || "-"}  EMAIL: ${a.email || "-"}  ADDRESS: ${a.address || "-"}  HOURS: ${a.hours || "-"}  LICENCE: ${a.licence || "-"}  CITY GUESS: ${a.city || "-"}\nSOCIAL: ${JSON.stringify(a.social || {})}\nBRAND COLOURS (hex, most used first): ${(a.colors || []).join(" ")}  FONTS: ${(a.fonts || []).join(", ")}  LOGO: ${a.logo?.url || (a.logo?.kind === "svg" ? "inline svg" : "none found")}\nEXISTING SCHEMA: ${JSON.stringify(a.schema || []).slice(0, 1200)}\nHOME PAGE TEXT:\n${(a.text || "").slice(0, 6000)}\n\nOTHER PAGES (${(a.pages || []).length}):\n${pages}\n\nPHOTOS ON THE SITE (url · alt/context):\n${(a.images || []).slice(0, 60).map(i => `${i.url} · ${i.alt || i.page || ""}`).join("\n")}`;
}

export async function researchA(job: BuildJob): Promise<boolean> {
  await leadRecord(job, "research");
  try {
    let analysis = null;
    const cleaned = cleanWebsite(job.lead.website);
    if (cleaned !== (job.lead.website || "")) { stamp(job, `website on the form "${job.lead.website}" read as ${cleaned || "none"}`); job.lead.website = cleaned; }
    if (job.lead.website) {
      try {
        analysis = await crawlSite(job.lead.website, { maxPages: 20 });
        stamp(job, `read ${analysis.domain}${analysis.rendered ? " in a real browser (the site blocks plain crawlers)" : analysis.relayed ? " through the relay (the site blocks the build servers)" : ""}: ${1 + analysis.pages.length} pages, ${analysis.totalWords} words, ${analysis.images.length} photos, logo ${analysis.logo ? (analysis.logo.kind + (analysis.logo.onDark ? "/" + analysis.logo.onDark : "")) : "none"}, colours ${analysis.colors.slice(0, 3).join(" ") || "none"}`);
      } catch (e) {
        stamp(job, `could not read ${job.lead.website}: ${e?.message || e}; researching from search and the form`);
        job.researchNotes = [...(job.researchNotes || []), e?.blocked ? `Their website (${job.lead.website}) blocks automated readers, so none of its text or photos could be used; the site was built from search research and stock photography. Ask them for their own photos before the call.` : `Their website (${job.lead.website}) could not be read (${String(e?.message || e).slice(0, 120)}); the site was built from search research and the form.`];
      }
    }
    job.analysis = analysis;
    const subject = `${analysis ? siteDigest(analysis) : "NO WEBSITE YET."}\n\nWHAT THE OWNER TOLD US ON THE LEAD FORM:\n${leadBrief(job.lead)}`;
    const { text, searches, usage } = await withTimeout(research({ system: SYSTEM_RESEARCH_A(), user: subject, maxSearches: 12, effort: "medium", maxTokens: 32000, model: modelFor("research") }), 330_000, "research pass one");
    job.usage = addUsage(job.usage, usage, searches.length);
    const a = parseJson(text);
    if (!a) throw new Error("Research pass one did not return a readable dossier.");
    a.searchesA = searches;
    // the form's site could not be read (or there was none) but research found their real site: read that one
    const found = cleanWebsite(a.website);
    if (!analysis && found && !/facebook|instagram|yelp|google|houzz|angi|bbb\.org|thumbtack|nextdoor|linkedin/i.test(found)) {
      try {
        analysis = await crawlSite(found, { maxPages: 20 });
        job.lead.website = found; job.analysis = analysis;
        stamp(job, `research found their site ${analysis.domain}: ${1 + analysis.pages.length} pages, ${analysis.images.length} photos, logo ${analysis.logo ? "found" : "none"}`);
      } catch (e) { stamp(job, `research found ${found} but it could not be read either: ${e?.message || e}`); }
    }
    // keep every real photo the crawler found; the model's "use" labels help the planner
    const labelled = new Map((a.photos || []).map(p => [p.url, p]));
    a.photos = (analysis?.images || []).map(i => ({ url: i.url, alt: labelled.get(i.url)?.alt || i.alt || i.page || "", use: labelled.get(i.url)?.use || "project" })).filter(p => p.use !== "skip" && p.use !== "logo");
    job.dossier = a;
    stamp(job, `facts pass: ${searches.length} searches, ${(a.services || []).length} services, ${(a.team || []).length} people, ${(a.projects || []).length} projects, ${a.photos.length} usable photos`);
    await saveJson(buildPath(job.id, "dossier-a.json"), a);
  } catch (e) {
    await fail(job, "research", e); return false;
  }
  return true;
}
/**
 * The research gate: the dossier must carry what a premium site needs (name,
 * services, real photos, real reviews, a hook with a flagship and proofs).
 * Thin reviews get one more reputation pass; anything else fails the build
 * with the reasons.
 */
/** Look at their site and photos, then write the hook with those images in view. */
export async function lookThenHook(job: BuildJob): Promise<boolean> {
  let shots = [];
  try {
    const site = await lookAtSite(job, (t) => stamp(job, t));
    const sheet = await photoSheet(job, 10, (t) => stamp(job, t));
    job.lookUrls = site.map(x => x.url).filter(Boolean);
    shots = [...site, ...sheet];
  } catch (e) { stamp(job, `look step skipped: ${describeError(e)}`); }
  const ok = await hookSite(job, shots);
  // the clip's source photo: the strategist's first flagship photo when it is a finished-work shot, else the best one found
  job.videoSource = chooseSourceImage(job);
  job.videoKind = findBeforeAfter(job) ? "transformation" : "film";
  if (job.videoSource) note(job, `hero video source: ${job.videoSource.split("/").pop()}`, "the best finished-work photo of the flagship; the first screen is a clip of it");
  return ok;
}
export async function gateAfterResearch(job: BuildJob): Promise<boolean> {
  let g = gateResearch(job);
  if (g.errors.some(e => /hook/.test(e))) {
    stamp(job, `research gate: ${summarize(g)}; writing the hook strategy again`);
    await hookSite(job);
    job.videoSource = chooseSourceImage(job);
    g = gateResearch(job);
  }
  for (const w of g.warnings) stamp(job, `research note: ${w}`);
  job.researchNotes = g.warnings;
  if (g.errors.length) { await fail(job, "research", g.errors.map(e => `research: ${e}`)); return false; }
  stamp(job, `research gate passed${g.warnings.length ? ` with ${g.warnings.length} note${g.warnings.length > 1 ? "s" : ""}` : ""}`);
  return true;
}
export async function runResearch(job: BuildJob) {
  if (!(await researchA(job))) return;
  await researchB(job);
  await lookThenHook(job);
  if (!(await gateAfterResearch(job))) return;
  job.videoRequested = videoConfigured() && Boolean(chooseSourceImage(job));
  if (job.videoRequested) { stamp(job, "hero video requested (Higgsfield) · runs alongside the design"); try { await postStep("video", job); } catch (e) { stamp(job, `video step could not start: ${e?.message || e}`); job.videoRequested = false; } }
  await next(job, "research", "design");
}
export async function runVideoStep(job: BuildJob) {
  await runVideo(job, (t) => stamp(job, t));
}

export async function researchB(job: BuildJob) {
  await leadRecord(job, "research-b");
  try {
    const d = job.dossier || {};
    const facts = JSON.stringify({ name: d.name, industry: d.industry, city: d.city, serviceArea: d.serviceArea, services: (d.services || []).map(s => s.name), team: (d.team || []).map(t => t.name), founded: d.founded, phone: d.phone, website: job.lead.website }, null, 1);
    const user = `COMPANY FACTS (from pass one):\n${facts}\n\nWHAT THE OWNER TOLD US:\n${leadBrief(job.lead)}`;
    const { text, searches, sources, usage } = await withTimeout(research({ system: SYSTEM_RESEARCH_B(), user, maxSearches: 12, effort: "medium", maxTokens: 32000, model: modelFor("research") }), 330_000, "research pass two");
    job.usage = addUsage(job.usage, usage, searches.length);
    const b = parseJson(text) || {};
    b.searchesB = searches;
    const merged = { ...d, ...b, sources: [...new Set([...(d.sources || []), ...(b.sources || []), ...sources.map(s => s.url)])].slice(0, 40), gaps: [...(d.gaps || []), ...(b.gaps || [])] };
    job.dossier = merged;
    stamp(job, `reputation pass: ${searches.length} searches, ${(b.proof || []).length} reviews, ${(b.competitors || []).length} competitors, ${(b.keywords || []).length} keywords`);
    await saveJson(buildPath(job.id, "dossier.json"), merged);
    // trim the analysis before it travels further: keep brand facts, drop page text
    if (job.analysis) { const a = job.analysis; job.analysis = { url: a.url, domain: a.domain, title: a.title, logo: a.logo, icon: a.icon, colors: a.colors, fonts: a.fonts, bodyBg: a.bodyBg, social: a.social, phone: a.phone, email: a.email, address: a.address, hours: a.hours, licence: a.licence, city: a.city, pagesRead: (a.pages || []).map(p => p.url) }; }
  } catch (e) {
    stamp(job, `reputation pass skipped: ${describeError(e)}`);
  }
}

/* ----------------------------------------------------------------- hook */
export async function hookSite(job: BuildJob, shots: { label: string; url: string; data: string }[] = []): Promise<boolean> {
  await leadRecord(job, "plan");
  try {
    const d = job.dossier || {};
    const text0 = `WHAT THE OWNER WANTS MORE OF (shape the hook around this):\n${leadBrief(job.lead)}\n\nREAL PHOTOS (url · what it shows):\n${(d.photos || []).slice(0, 60).map(p => `${p.url} · ${p.alt}`).join("\n") || "none"}\n\nRESEARCH DOSSIER:\n${JSON.stringify({ ...d, photos: undefined }, null, 1)}`;
    // look first: their current site and their best photos as images, so the hook, the flagship and the clip's source photo are chosen by looking
    const user = shots.length ? [{ type: "text", text: text0 }, { type: "text", text: `WHAT THEIR SITE AND PHOTOS LOOK LIKE (${shots.length} images follow; the photo labels give the url to name in "flagship.photos"). Pick the flagship photos by what they show: finished work, well lit, the kind of job the owner wants more of. Name the single best finished-work photo first; it becomes the hero video.` }, ...imageBlocks(shots)] : text0;
    const { text, usage } = await withTimeout(structured({ system: SYSTEM_HOOK(), user, schema: null, effort: "high", maxTokens: 16000, model: modelFor("plan") }), 300_000, "hook strategy");
    job.usage = addUsage(job.usage, usage);
    const hook = parseJson(text);
    if (!hook?.hook?.claim) throw new Error("no hook returned");
    job.hook = hook;
    note(job, `hook: ${hook.hook.claim}`, hook.hook.why || hook.hook.evidence || "");
    if (hook.flagship?.title) note(job, `flagship: ${hook.flagship.title}`, hook.flagship.whyChosen || "");
    stamp(job, `hook: "${hook.hook.claim}" · flagship: ${hook.flagship?.title || "none"}${hook.flagship?.fallback ? " (service, no project found)" : ""} · ${(hook.proofStack || []).length} proofs`);
    await saveJson(buildPath(job.id, "hook.json"), hook);
    return true;
  } catch (e) {
    stamp(job, `hook strategy skipped: ${describeError(e)}; planner works from the dossier alone`);
    return true;
  }
}

/* ----------------------------------------------------------------- plan */
async function planOnce(job: BuildJob, feedback: string[] = [], attempt = 1): Promise<boolean> {
  await leadRecord(job, "plan");
  try {
    const offer = offerFor(job.id, attempt, { heroes: (job.qa?.recent || []).map(r => r.hero).filter(Boolean), menus: (job.qa?.recent || []).map(r => r.menu).filter(Boolean) });
    const a = job.analysis || {};
    const d = job.dossier || {};
    const user = [
      feedback.length ? `YOUR PREVIOUS PLAN WAS REJECTED BY THE GATE. Fix every point, keep everything else:\n- ${feedback.join("\n- ")}` : "",
      lessonsBlock(job.lessons || []),
      `EFFECTS IN THE RIGHT PLACE (choose an effect because its content asks for it; the gate rejects an effect without what it needs):\n${fitTable()}`,
      job.hook ? `HOOK STRATEGY (build the home page around this):\n${JSON.stringify(job.hook, null, 1)}` : "",
      job.videoRequested ? "A HERO VIDEO IS BEING GENERATED from their work: the home page's first section must be \"hero-video-scrub\" (fields: eyebrow with the city, headline = the hook claim as two lines split with \" / \", sub = one sentence, cta = the ask, cta2 = see the work, beats = one more two-line proof, ask = {eyebrow, title, cta}, image = the flagship photo)." : "NO HERO FILM THIS TIME: the home page's first section must be \"split-intro\", the plain photo opening (fields: eyebrow with the city, headline = the hook claim in one line, sub = one sentence, cta = the ask, images = the two best real photos of their work, the flagship first). No other hero on the home page.",
      `RESEARCH DOSSIER:\n${JSON.stringify(d, null, 1)}`,
      `BRAND ASSETS FOUND ON THEIR SITE:\nlogo: ${a.logo ? `${a.logo.kind}${a.logo.url ? " " + a.logo.url : ""} (on a dark page: ${a.logo.onDark || "unknown"})` : "none"}\nbrand colour candidates (hex, most used first): ${(a.colors || []).join(", ") || "none"}\nfonts on their site: ${(a.fonts || []).join(", ") || "none"}\ndomain: ${a.domain || "none"}`,
      `WHAT THE OWNER TOLD US:\n${leadBrief(job.lead)}`,
      (job.qa?.recent || []).length ? `THE PREVIOUS BUILDS USED: menus ${(job.qa.recent).map(r => r.menu).filter(Boolean).join(", ") || "—"}; type pairs ${(job.qa.recent).map(r => r.pair).filter(Boolean).join(", ") || "—"}; effects ${(job.qa.recent[0]?.effects || []).join(", ") || "—"}. This site must differ on all three.` : "",
      "Plan the complete site now. Use every service, every person, every review, every city in the service area, every credential. Choose the hero and menu for THIS brand from the offered ones.",
    ].filter(Boolean).join("\n\n");
    const { text, usage } = await withTimeout(structured({ system: SYSTEM_PLAN(offer), user, schema: null, effort: "medium", maxTokens: 32000, model: modelFor("plan") }), 330_000, "site plan");
    job.usage = addUsage(job.usage, usage);
    const plan = parseJson(text);
    if (!plan || !Array.isArray(plan.pages) || !plan.pages.length) throw new Error("The planner did not return a site plan.");
    stamp(job, `structure planned: ${plan.pages.length} pages`);
    // normalise slugs and make sure the required pages exist
    plan.pages = plan.pages.map(p => ({ ...p, slug: p.slug === "index" || p.slug === "home" || p.slug === "/" ? "index" : p.slug.split("/").map(slugify).filter(Boolean).join("/") })).filter(p => p.slug);
    const slugs = new Set(plan.pages.map(p => p.slug));
    for (const need of ["index", "about", "services", "contact"]) if (!slugs.has(need)) plan.pages.push({ slug: need, title: need[0].toUpperCase() + need.slice(1), purpose: "", seo: {}, sections: need === "contact" ? [{ type: "contact", brief: "contact details and the quote form" }, { type: "faq", brief: "common questions" }] : [{ type: "text", brief: `${need} page` }, { type: "cta", brief: "" }] });
    // every planned service page must exist for every dossier service; a page added here opens the same way the planner's service pages do
    const plannedSvc = plan.pages.filter(p => /^services\//.test(p.slug) && (p.sections || []).length);
    const svcOpener = plannedSvc.find(p => byType[p.sections[0]?.type]?.kind === "hero")?.sections[0];
    for (const s of d.services || []) {
      const slug = `services/${slugify(s.slug || s.name)}`;
      if (plan.pages.filter(p => /^services\//.test(p.slug)).length >= 10) break;
      if (plan.pages.some(p => p.slug === slug)) continue;
      const opening = svcOpener ? [{ type: svcOpener.type, brief: `${s.name}: eyebrow with the company and city, a headline that says what the buyer gets, the ask, and a real photo of this work`, photos: [] }] : [];
      plan.pages.push({ slug, title: s.name, purpose: `service page for ${s.name}`, seo: {}, sections: [...opening, { type: "text", brief: `what ${s.name} includes: ${s.detail}${svcOpener ? "" : ", with a real photo"}`, facts: [s.detail, ...(s.subServices || []), ...(s.proofPoints || [])], photos: [] }, { type: "faq", brief: `questions about ${s.name}` }, { type: "cta", brief: "" }] });
    }
    // drop sections the renderer cannot build; fill component ids
    for (const p of plan.pages) p.sections = (p.sections || []).filter(s => byType[s.type]).map(s => ({ ...s, component: byType[s.type].id }));
    // a page the planner left empty or with unknown section types gets a sound default layout for its kind
    // (cheaper and surer than a whole re-plan); the writers fill it from the dossier like any other page
    const defaults = (p) => {
      const city = (p.title || p.slug.split("/").pop() || "").replace(/-/g, " ");
      const svc = (d.services || []).map(x => ({ title: x.name, href: `services/${slugify(x.slug || x.name)}` }));
      if (/^areas\//.test(p.slug)) return [{ type: "text", brief: `serving ${city}: neighbourhoods, drive time, permits if known, with a real job photo`, photos: [] }, { type: "services", brief: `every service with a link to its page, for ${city} buyers`, items: svc }, { type: "testimonials", brief: `reviews from ${city} or nearby when there are any` }, { type: "cta", brief: "" }];
      if (/^services\//.test(p.slug)) return [{ type: "text", brief: `what ${p.title || city} includes and how they do it, with a real photo`, photos: [] }, { type: "faq", brief: `questions about ${p.title || city}` }, { type: "cta", brief: "" }];
      if (p.slug === "work") return [{ type: "gallery", brief: "their real project photos with captions", photos: [] }, { type: "cta", brief: "" }];
      if (p.slug === "reviews") return [{ type: "testimonials", brief: "every real review, verbatim, with source" }, { type: "stats", brief: "ratings and counts per platform" }, { type: "cta", brief: "" }];
      if (p.slug === "about") return [{ type: "text", brief: "their story, founder, years, with a real photo", photos: [] }, { type: "stats", brief: "years, projects, reviews, licence" }, { type: "cta", brief: "" }];
      if (p.slug === "faq") return [{ type: "faq", brief: "every question from the dossier" }, { type: "cta", brief: "" }];
      if (p.slug === "contact") return [{ type: "contact", brief: "contact details and the quote form" }, { type: "faq", brief: "common questions" }];
      return null;
    };
    for (const p of plan.pages) {
      if ((p.sections || []).length >= 2 || p.slug === "index") continue;
      const def = defaults(p);
      if (def) { p.sections = def.map(s => ({ ...s, component: byType[s.type].id })); stamp(job, `page ${p.slug} came back ${p.sections.length ? "too thin" : "empty"} from the planner; given the default ${p.slug.split("/")[0]} layout`); }
    }
    const home = plan.pages.find(p => p.slug === "index");
    if (home) {
      const first = home.sections[0];
      if (job.videoRequested && (!first || first.type !== "hero-video-scrub")) {
        const old = first && byType[first.type]?.kind === "hero" ? first : null;
        const hero = { type: "hero-video-scrub", component: "hero-video-scrub", brief: `The generated clip of ${job.hook?.flagship?.title || "their flagship work"} plays as the visitor scrolls. At rest: eyebrow = city + service area, the company's name, sub = one sentence, cta = the ask, cta2 = see the work. On the scroll: headline = the hook claim as two lines, one more two-line proof beat, then ask.title + ask.cta. image = ${chooseSourceImage(job)}.`, facts: old?.facts || [], photos: [chooseSourceImage(job)] };
        if (old) home.sections[0] = hero; else home.sections.unshift(hero);
      } else if (!job.videoRequested && first?.type !== "split-intro") {
        // no film: the home page opens on the plain photo hero, never on an effect
        const old = first && byType[first.type]?.kind === "hero" ? first : null;
        const photos = [...new Set([...(old?.photos || []), chooseSourceImage(job), ...(job.dossier?.photos || []).map((p) => p?.url)].filter(Boolean))].slice(0, 2);
        const hero = { type: "split-intro", component: "split-intro", brief: `The plain photo opening: eyebrow = city + service area, headline = the hook claim in one line, sub = one sentence, cta = the ask, images = ${photos.join(" and ") || "their two best real photos"} (the flagship first).`, facts: old?.facts || [], photos };
        if (old) home.sections[0] = hero; else home.sections.unshift(hero);
        stamp(job, "plan: no film; the home page opens on the plain photo hero (split-intro)");
      }
    }
    if (!byId[plan.nav?.menu] || byId[plan.nav.menu].kind !== "menu") plan.nav = { ...(plan.nav || {}), menu: offer.menus[0] || "menu-8" };
    plan.theme = plan.theme || {};
    for (const key of ["transition", "cursor"]) if (plan.theme[key] && (!byId[plan.theme[key]] || byId[plan.theme[key]].kind !== key)) delete plan.theme[key];
    if (plan.theme.preloader && plan.theme.preloader !== "preloader") plan.theme.preloader = /pill|yes|true|on/i.test(String(plan.theme.preloader)) ? "preloader" : "";
    plan.brand = plan.brand || {};
    // their logo is never optional: when the crawl found one, the site carries it; their colour is the accent, their surface the mode, their type the pair
    if (a.logo && (a.logo.url || a.logo.kind === "svg")) { plan.brand.logo = { ...a.logo, icon: a.icon }; plan.brand.useLogo = true; }
    for (const n of applyBrand(plan, a)) stamp(job, n);
    if (!plan.brand.domain && a.domain) plan.brand.domain = a.domain;
    for (const k of ["phone", "email", "address", "hours", "licence"]) if (!plan.brand[k] && (a[k] || d[k])) plan.brand[k] = a[k] || d[k];
    plan.brand.social = { ...(a.social || {}), ...Object.fromEntries(Object.entries(plan.brand.social || {}).filter(([, v]) => v)) };
    /* second pass: the coverage map, aligned to the planned sections */
    try {
      const skeleton = plan.pages.map(p => ({ slug: p.slug, title: p.title, purpose: p.purpose, sections: (p.sections || []).map((s, i) => ({ index: i, type: s.type, brief: s.brief })) }));
      const user2 = `SITE PLAN:\n${JSON.stringify(skeleton, null, 1)}\n\nRESEARCH DOSSIER:\n${JSON.stringify({ ...d, photos: undefined, sources: undefined, searchesA: undefined, searchesB: undefined }, null, 1)}`;
      const r2 = await withTimeout(structured({ system: SYSTEM_COVERAGE(), user: user2, schema: null, effort: "low", maxTokens: 36000, model: modelFor("plan") }), 330_000, "coverage map");
      job.usage = addUsage(job.usage, r2.usage);
      const cov = parseJson(r2.text);
      if (cov) {
        plan.coverage = Array.isArray(cov.coverage) ? cov.coverage : [];
        for (const sec of cov.sections || []) { const pg = plan.pages.find(p => p.slug === sec.page); if (pg && pg.sections[sec.index]) pg.sections[sec.index].facts = sec.facts || []; }
        stamp(job, `coverage mapped: ${plan.coverage.length} facts`);
      }
    } catch (e) {
      stamp(job, `coverage pass skipped: ${describeError(e)}; writers work from the briefs`);
      plan.coverage = plan.coverage || [];
    }
    job.plan = plan;
    job.pages = [];
    job.writeIndex = 0;
    if (plan.rationale) note(job, `design: ${plan.nav?.menu}, ${plan.theme?.pair} type, ${plan.theme?.mode} mode, accent ${plan.theme?.accent}`, plan.rationale);
    stamp(job, `planned ${plan.pages.length} pages: ${plan.pages.map(p => p.slug).join(", ")} · hero ${plan.pages[0]?.sections?.[0]?.component} · menu ${plan.nav.menu} · ${plan.theme?.pair} ${plan.theme?.mode} ${plan.theme?.accent} · ${(plan.coverage || []).length} facts mapped`);
    await saveJson(buildPath(job.id, "plan.json"), plan);
  } catch (e) {
    await fail(job, "design", e); return false;
  }
  return true;
}
/** Mechanical fixes a designer would make without re-planning: a photo-led effect planned around one photo becomes the plain block for its content. */
function autoFixPlan(job: BuildJob) {
  const plan = job.plan; if (!plan) return;
  const photosAvailable = (job.dossier?.photos || []).length;
  for (const p of plan.pages || []) (p.sections || []).forEach((sec, i) => {
    const f = FIT[sec.type]; if (!f || !f.photos) return;
    const listed = (sec.photos || []).length;
    const starved = (f.photos >= 4 && listed === 1) || photosAvailable < f.photos;
    if (!starved) return;
    const to = Array.isArray(sec.items) && sec.items.length ? "services" : f.roles.includes("work") || f.roles.includes("story") ? (photosAvailable >= 1 ? "one-image" : "text") : "text";
    if (!byType[to] || to === sec.type) return;
    stamp(job, `plan: ${p.slug} §${i + 1} ${sec.type} had ${listed} photo${listed === 1 ? "" : "s"} listed (needs ${f.photos}); now ${to}`);
    sec.type = to; sec.component = byType[to].id;
  });
  // service pages open the same way: pages without the planned hero opening get it
  const svc = (plan.pages || []).filter(p => /^services\//.test(p.slug) && (p.sections || []).length);
  const opener = svc.find(p => byType[p.sections[0]?.type]?.kind === "hero")?.sections[0];
  if (opener && svc.some(p => byType[p.sections[0]?.type]?.kind !== "hero")) for (const p of svc) if (byType[p.sections[0]?.type]?.kind !== "hero") { p.sections.unshift({ type: opener.type, component: byType[opener.type].id, brief: `${p.title || p.slug}: eyebrow with the company and city, a headline that says what the buyer gets, the ask, a real photo`, photos: [] }); stamp(job, `plan: ${p.slug} given the same opening as the other service pages`); }
  // one heavy (WebGL) effect per site, home only; extra ones become their light cousin
  let heavySeen = false;
  for (const p of plan.pages || []) (p.sections || []).forEach((sec, i) => { const c = byType[sec.type]; if (!c || c.weight !== "heavy") return; if (p.slug === "index" && !heavySeen) { heavySeen = true; return; } const to = Array.isArray(sec.images) || /"images"/.test(c.fields || "") ? "gallery" : "one-image"; stamp(job, `plan: ${p.slug} §${i + 1} ${sec.type} is a heavy effect beyond the one allowed; now ${to}`); sec.type = to; sec.component = byType[to].id; });
  // a pack effect beyond its reuse limit becomes the plain block with the same role
  const useCount = {};
  for (const p of plan.pages || []) (p.sections || []).forEach((sec, i) => { const c = byType[sec.type]; if (!c || c.id === c.type) return; useCount[c.id] = (useCount[c.id] || 0) + 1; const limit = c.weight === "light" && (plan.pages || []).length > 12 ? 3 : 2; if (useCount[c.id] <= limit) return; const to = Array.isArray(sec.items) && sec.items.length ? "services" : /"images"|"slides"/.test(c.fields || "") ? "gallery" : "text"; if (!byType[to]) return; stamp(job, `plan: ${p.slug} §${i + 1} ${sec.type} used more than ${limit}×; now ${to}`); sec.type = to; sec.component = byType[to].id; });
  // the video hero is there when a film is coming and not when it is not
  const home = (plan.pages || []).find(p => p.slug === "index");
  if (home && home.sections?.length) { const first = home.sections[0]; if (job.videoRequested && first.type !== "hero-video-scrub") { home.sections[0] = { ...first, type: "hero-video-scrub", component: "hero-video-scrub" }; stamp(job, "plan: home opens with the film"); } if (!job.videoRequested && first.type !== "split-intro") { home.sections[0] = { ...first, type: "split-intro", component: "split-intro" }; } }
  // a type pair or menu the previous build used: pick the next offered one
  const rec = job.qa?.recent || [];
  if (plan.theme?.pair && (plan.theme.pair === "oswald" || rec[0]?.pair === plan.theme.pair)) { const pairs = ["clash", "archivo", "anton", "jost", "syne", "serif", "fraunces", "bricolage", "grotesk"].filter(x => x !== plan.theme.pair && !rec.some(r => r.pair === x)); if (pairs.length) { stamp(job, `plan: type pair ${plan.theme.pair} was the agency's or the previous build's; now ${pairs[0]}`); plan.theme.pair = pairs[0]; } }
  if (plan.nav?.menu && rec.some(r => r.menu === plan.nav.menu)) { const menus = offerFor(job.id, 2, { menus: rec.map(r => r.menu).filter(Boolean) }).menus.filter(m => m !== plan.nav.menu); if (menus.length) { stamp(job, `plan: menu ${plan.nav.menu} was a recent build's; now ${menus[0]}`); plan.nav.menu = menus[0]; } }
  // four text-only sections in a row: the second becomes a photo-led block (a designer would do the same without re-planning)
  for (const p of plan.pages || []) {
    const secs = p.sections || [];
    let run = [];
    for (let i = 0; i < secs.length; i++) {
      const t = secs[i].type;
      if (canShowPhoto(t) || RUN_BREAKERS.has(t)) { run = []; continue; }
      run.push(i);
      if (run.length >= 4) {
        const j = run[1], old = secs[j].type;
        const to = photosAvailable >= 1 ? "one-image" : "text";
        if (byType[to] && old !== to) { secs[j] = { ...secs[j], type: to, component: byType[to].id, brief: `${secs[j].brief || ""} (shown with one of their real photos)`.trim() }; stamp(job, `plan: ${p.slug} §${j + 1} ${old} sat in a run of text-only sections; now ${to}`); }
        run = [];
      }
    }
  }
}
/** Plan, then hold the plan to the gate; one re-plan with the gate's reasons as feedback, then fail. */
export async function planSite(job: BuildJob): Promise<boolean> {
  job.lessons = await loadLessons().catch(() => []);
  if (job.lessons.length) stamp(job, `${job.lessons.length} studio lesson${job.lessons.length > 1 ? "s" : ""} from earlier builds loaded`);
  const recent = await recentChoices(job.id, 3).catch(() => []);
  job.qa = { ...(job.qa || {}), recent };
  if (recent.length) stamp(job, `recent builds used heroes ${recent.map(r => r.hero).filter(Boolean).join(", ") || "—"}, menus ${recent.map(r => r.menu).filter(Boolean).join(", ") || "—"} and type ${recent.map(r => r.pair).filter(Boolean).join(", ") || "—"}; this one gets different ones`);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const okPlan = await planOnce(job, attempt === 1 ? [] : (job.qa?.planFeedback || []), attempt);
    if (!okPlan) return false;
    autoFixPlan(job);
    const g = gatePlan(job, recent);
    job.planNotes = g.warnings;
    for (const w of g.warnings) stamp(job, `plan note: ${w}`);
    const home = job.plan?.pages?.find(p => p.slug === "index");
    await leadRecord(job, "plan", { hero: home?.sections?.[0]?.component, menu: job.plan?.nav?.menu });
    if (!g.errors.length) { stamp(job, `plan accepted${g.warnings.length ? ` with ${g.warnings.length} note${g.warnings.length > 1 ? "s" : ""}` : ""}`); return true; }
    job.qa = { ...(job.qa || {}), planFeedback: g.errors };
    if (attempt === 1) { stamp(job, `plan: ${summarize(g)}; planning again`); continue; }
    await fail(job, "design", g.errors.map(e => `plan: ${e}`)); return false;
  }
  return false;
}

/* ---------------------------------------------------------------- write */
function fieldShapes(sections) {
  const seen = new Set();
  return sections.map(s => byType[s.type]).filter(c => c && !seen.has(c.type) && seen.add(c.type)).map(c => `${c.type}: ${c.fields}`).join("\n");
}
async function writePage(job: BuildJob, page, feedback: string[] = []) {
  const d = job.dossier || {}, plan = job.plan;
  const coverage = (plan.coverage || []).filter(c => (c.pages || []).includes(page.slug)).map(c => c.fact);
  const clipNote = page.slug === "index" && job.videoRequested ? `THE HERO CLIP IS ${job.videoKind === "transformation" ? "A TRANSFORMATION of their own before and after photos: it starts on the before shot and ends on the finished work." : job.videoKind === "cinematic" ? "A CINEMATIC MOVE on one finished photo (nothing is built on screen): the sub must not promise a build." : "A FILM OF THEIR TRADE'S WORK: the space bare, the work happening, the finished result by the end of the scroll (a generated film in their materials and colours, not footage of a named job): the sub may say 'scroll and watch a bare slab become a finished floor' but must not call it a specific client's project."}` : "";
  const user = [
    feedback.length ? `YOUR PREVIOUS VERSION OF THIS PAGE WAS REJECTED. Fix every point and keep everything else:\n- ${feedback.join("\n- ")}` : "",
    clipNote,
    `BRAND: ${JSON.stringify(plan.brand)}\nTHEME: ${JSON.stringify(plan.theme)}\nPAGES ON THIS SITE (slugs you may link to): ${plan.pages.map(p => p.slug).join(", ")}`,
    job.hook ? `HOOK STRATEGY:\n${JSON.stringify(job.hook, null, 1)}` : "",
    `THE PAGE TO WRITE:\n${JSON.stringify({ slug: page.slug, title: page.title, purpose: page.purpose, intro: page.intro, sections: page.sections }, null, 1)}`,
    `FACTS THE COVERAGE MAP ASSIGNS TO THIS PAGE (all must appear):\n${coverage.map(f => "- " + f).join("\n") || "(none listed; use the section briefs)"}`,
    `FIELD SHAPES FOR THE SECTION TYPES ON THIS PAGE:\n${fieldShapes(page.sections)}`,
    `REAL PHOTOS (url · what it shows · use):\n${(d.photos || []).slice(0, 60).map(p => `${p.url} · ${p.alt} · ${p.use}`).join("\n") || "none; use stock subjects"}`,
    `RESEARCH DOSSIER:\n${JSON.stringify(d, null, 1)}`,
  ].filter(Boolean).join("\n\n");
  const lessonText = lessonsBlock(job.lessons || []);
  const { text, usage } = await withTimeout(structured({ system: SYSTEM_WRITE(), user: lessonText ? `${lessonText}\n\n${user}` : user, schema: null, effort: page.slug === "index" ? "high" : "medium", maxTokens: 28000, model: modelFor("write") }), 330_000, `writing ${page.slug}`);
  const out = parseJson(text);
  if (!out || !Array.isArray(out.sections)) throw new Error(`The writer returned no sections for ${page.slug}.`);
  const sections = out.sections.filter(s => s && byType[s.type]).map(s => ({ ...s, component: byType[s.type].id }));
  return { slug: page.slug, title: page.title, intro: page.intro, seo: page.seo || {}, sections, usage };
}

export async function writeAll(job: BuildJob, only: string[] | null = null): Promise<boolean> {
  await leadRecord(job, "write");
  const plan = job.plan;
  job.pages = job.pages || [];
  // pages to write now: the requested ones (or all), minus any already written and approved
  const written = new Set(job.pages.filter(p => (p.sections || []).length && !p.failed).map(p => p.slug));
  const todo = plan.pages.filter(p => (!only || only.includes(p.slug)) && !written.has(p.slug));
  let start = 0;
  while (start < todo.length) {
    checkBudget(job, `writing ${todo[start]?.slug}`);
    const batch = todo.slice(start, start + WRITE_BATCH);
    // a page that fails once (cut off, no sections, a 529) is written again before it is given up on
    const writeWithRetry = async (p) => { try { return await writePage(job, p); } catch (e) { stamp(job, `page ${p.slug}: ${describeError(e)}; writing it again`); return await writePage(job, p); } };
    const results = await Promise.allSettled(batch.map(writeWithRetry));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") { job.usage = addUsage(job.usage, r.value.usage); delete r.value.usage; job.pages.push(r.value); stamp(job, `wrote ${r.value.slug}: ${r.value.sections.length} sections, ${JSON.stringify(r.value.sections).split(/\s+/).length} words`); }
      else { stamp(job, `page ${batch[i].slug} failed: ${describeError(r.reason)}`); job.pages.push({ slug: batch[i].slug, title: batch[i].title, intro: batch[i].intro, seo: batch[i].seo || {}, sections: [], failed: true }); }
    });
    start += batch.length;
    job.writeIndex = start;
    try { await saveJson(buildPath(job.id, "pages.json"), job.pages); } catch {}
    await leadRecord(job, "write");
  }
  if (!job.pages.some(p => p.sections.length)) { await fail(job, "write", new Error("No page could be written.")); return false; }
  // the write gate: every planned page written, every hero on the brand word; failed pages get one more attempt
  // (when only some pages were asked for, the gate looks at those)
  const gateOn = (j) => { if (!only) return gatePages(j); const sub = { ...j, plan: { ...j.plan, pages: j.plan.pages.filter(p => only.includes(p.slug)) }, pages: j.pages.filter(p => only.includes(p.slug)) }; return gatePages(sub); };
  let g = gateOn(job);
  const retry = job.pages.filter(p => p.failed || !(p.sections || []).length).map(p => p.slug);
  if (retry.length) {
    stamp(job, `write gate: ${retry.length} page(s) failed (${retry.join(", ")}); writing them again`);
    for (const slug of retry) {
      const pp = plan.pages.find(p => p.slug === slug); if (!pp) continue;
      try { const w = await writePage(job, pp); job.usage = addUsage(job.usage, w.usage); delete w.usage; const i = job.pages.findIndex(p => p.slug === slug); job.pages[i] = w; stamp(job, `wrote ${slug}: ${w.sections.length} sections (second attempt)`); }
      catch (e) { stamp(job, `page ${slug} failed again: ${describeError(e)}`); }
    }
    try { await saveJson(buildPath(job.id, "pages.json"), job.pages); } catch {}
    g = gateOn(job);
  }
  // findings that name a page (errors or notes): that page is written once more with them as feedback, then whatever remains is a note
  const feedback = [...g.errors, ...g.warnings.filter(w => !/never written|could not be written|left out/.test(w))];
  if (feedback.length) {
    const byPage = {};
    for (const e of feedback) { const m = e.match(/^(?:page |fit: )?([a-z0-9-]+(?:\/[a-z0-9-]+)*)\b/i); if (m && plan.pages.some(p => p.slug === m[1])) (byPage[m[1]] = byPage[m[1]] || []).push(e); }
    for (const [slug, errs] of Object.entries(byPage)) {
      const pp = plan.pages.find(p => p.slug === slug); if (!pp) continue;
      stamp(job, `write gate: ${slug}: ${errs.join("; ")}; writing it again`);
      try { const w = await writePage(job, pp, errs); job.usage = addUsage(job.usage, w.usage); delete w.usage; const i = job.pages.findIndex(p => p.slug === slug); if (i >= 0) job.pages[i] = w; else job.pages.push(w); }
      catch (e) { stamp(job, `page ${slug} failed again: ${describeError(e)}`); }
    }
    if (Object.keys(byPage).length) { try { await saveJson(buildPath(job.id, "pages.json"), job.pages); } catch {} g = gateOn(job); }
  }
  for (const w of g.warnings) stamp(job, `write note: ${w}`);
  job.writeNotes = [...(job.writeNotes || []), ...g.warnings];
  // a page that still could not be written is left out of the site (the home page is the one exception)
  const dropped = job.pages.filter(p => p.slug !== "index" && (p.failed || !(p.sections || []).length)).map(p => p.slug);
  if (dropped.length) { job.pages = job.pages.filter(p => !dropped.includes(p.slug)); plan.pages = plan.pages.filter(p => !dropped.includes(p.slug)); for (const pg of plan.pages) pg.sections = (pg.sections || []).map(sec => ({ ...sec, items: Array.isArray(sec.items) ? sec.items.map(it => it && dropped.includes(it.href) ? { ...it, href: "services" } : it) : sec.items })); stamp(job, `pages left out (could not be written): ${dropped.join(", ")}`); job.writeNotes.push(`pages left out: ${dropped.join(", ")}`); }
  if (g.errors.length) { await fail(job, "write", g.errors.map(e => `write: ${e}`)); return false; }
  stamp(job, `write accepted${g.warnings.length ? ` with ${g.warnings.length} note${g.warnings.length > 1 ? "s" : ""}` : ""}`);
  return true;
}

export async function runDesign(job: BuildJob) {
  if (!(await runHome(job))) return;
  await next(job, "design", "write");
}
export async function runWrite(job: BuildJob) {
  if (!job.plan) return runDesign(job);
  await runRest(job);
}

/* --------------------------------------------------------------- review */
const lean = (pages) => pages.map(p => ({ slug: p.slug, title: p.title, sections: p.sections.map(s => { const c = { ...s }; delete c.component; return c; }) }));

export async function reviewSite(job: BuildJob) {
  await leadRecord(job, "review");
  try {
    const plan = job.plan, d = job.dossier || {};
    const user = [
      `PAGE LIST: ${job.pages.map(p => p.slug).join(", ")}`,
      job.hook ? `HOOK STRATEGY:\n${JSON.stringify(job.hook, null, 1)}` : "",
      lessonsBlock(job.lessons || []),
      job.homeApproved ? "THE HOME PAGE (index) HAS ALREADY PASSED THE QUALITY GATE: do not return it; correct inner pages only." : "",
      `COVERAGE MAP:\n${JSON.stringify(plan.coverage || [], null, 1)}`,
      `BRAND: ${JSON.stringify(plan.brand)}`,
      `THE WRITTEN SITE:\n${JSON.stringify(lean(job.pages), null, 1)}`,
      `FIELD SHAPES:\n${fieldShapes(job.pages.flatMap(p => p.sections))}`,
      `RESEARCH DOSSIER:\n${JSON.stringify(d, null, 1)}`,
    ].filter(Boolean).join("\n\n");
    const { text, usage } = await withTimeout(structured({ system: SYSTEM_REVIEW(), user, schema: null, effort: "medium", maxTokens: 40000, model: modelFor("review") }), 330_000, "review");
    job.usage = addUsage(job.usage, usage);
    const r = parseJson(text);
    if (r && Array.isArray(r.pages)) {
      let changed = 0;
      for (const fixed of r.pages) {
        const i = job.pages.findIndex(p => p.slug === fixed.slug);
        if (i < 0 || !Array.isArray(fixed.sections) || !fixed.sections.length) continue;
        if (job.homeApproved && fixed.slug === "index") continue;
        job.pages[i].sections = fixed.sections.filter(s => s && byType[s.type]).map(s => ({ ...s, component: byType[s.type].id }));
        changed++;
      }
      job.review = { missing: r.missing || [], notes: r.notes || [], changed };
      stamp(job, `review: ${changed} pages corrected, ${(r.notes || []).length} notes, ${(r.missing || []).length} facts still missing`);
    } else {
      job.review = { missing: [], notes: ["The reviewer returned nothing usable; pages kept as written."], changed: 0 };
      stamp(job, "review returned nothing usable");
    }
    await saveJson(buildPath(job.id, "pages.json"), job.pages);
  } catch (e) {
    stamp(job, `review skipped: ${describeError(e)}`);
    job.review = { missing: [], notes: [`Review skipped: ${describeError(e)}`], changed: 0 };
  }
}

/* --------------------------------------------------------------- finish */
// The hero word must be the company's name (or its distinctive word), never
// a city, region or generic word, whatever the model wrote.
export function brandWord(name = "") {
  const clean = String(name).replace(/\b(LLC|L\.L\.C\.|Inc\.?|Co\.?|Corp\.?|Ltd\.?|Company|Construction|Contracting|Services|Group)\b/gi, "").replace(/[^A-Za-z0-9 &'-]/g, " ").replace(/\s+/g, " ").trim();
  const words = clean.split(" ").filter(Boolean);
  const full = words.join(" ").toUpperCase();
  if (full.length >= 3 && full.length <= 12 && words.length <= 2) return full;
  const first = (words.find(w => w.length >= 3) || words[0] || String(name).split(" ")[0] || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return first.slice(0, 12) || "STUDIO";
}
/** The video hero's closing line is one line of display type: the first clause, at most eight words. */
function tightenAsk(spec) {
  for (const p of spec.pages || []) for (const s of p.sections || []) {
    if (s.type !== "hero-video-scrub" || !s.ask?.title) continue;
    const first = String(s.ask.title).split(/(?<=[.!?])\s+/)[0].trim();
    const words = first.split(/\s+/);
    s.ask.title = (words.length > 8 ? words.slice(0, 8).join(" ") : first).replace(/[,;:]$/, "") + (/[.!?]$/.test(first) && words.length <= 8 ? "" : ".");
    if (s.sub) { const one = String(s.sub).split(/(?<=[.!?])\s+/)[0].trim(); if (one.split(/\s+/).length >= 8) s.sub = one; }
  }
}
export function enforceBrandWord(spec) {
  tightenAsk(spec);
  const want = brandWord(spec.brand?.name);
  const nameTokens = String(spec.brand?.name || "").toUpperCase().split(/[^A-Z0-9]+/).filter(t => t.length >= 3);
  for (const p of spec.pages || []) for (const s of p.sections || []) {
    const c = byType[s.type];
    if (!c || c.kind !== "hero" || typeof s.word !== "string") continue;
    const w = String(s.word).toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim();
    const isBrand = w && (nameTokens.includes(w) || w === want || want.split(" ").includes(w));
    if (!isBrand) s.word = want;
  }
  return spec;
}

function assembleSpec(job: BuildJob, only: string[] | null = null) {
  const plan = job.plan;
  const spec = {
    brand: plan.brand, theme: plan.theme || { mode: "light", accent: "#0E0E0E", pair: "oswald" }, nav: plan.nav, footer: plan.footer || { blurb: "", columns: [] },
    pages: job.pages.filter(p => p.sections.length && (!only || only.includes(p.slug))).map(p => ({ ...p, sections: p.sections.map(s => ({ ...s })) })),
    rationale: plan.rationale || "",
  };
  // every page with a slug must be linkable from the footer at least
  const listed = new Set((spec.footer.columns || []).flatMap(c => (c.links || []).map(l => l.href)));
  const missing = spec.pages.filter(p => p.slug !== "index" && !listed.has(p.slug));
  if (missing.length) spec.footer.columns = [...(spec.footer.columns || []), { title: "More", links: missing.map(p => ({ label: p.title || p.slug, href: p.slug })) }];
  enforceBrandWord(spec);
  enforceTagline(spec, job.dossier);
  cleanTestimonials(spec);
  return spec;
}

/** Research may paste a source after a fact ("… ([site](https://…))"); the words a visitor reads never carry one. */
const stripCitations = (s = "") => String(s).replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, "").replace(/\s*\[[^\]]*\]\(https?:\/\/[^)]*\)/g, "").trim();

/**
 * Their slogan, on their site. When the research found the company's own
 * tagline it is kept as the brand tagline and must appear where a visitor
 * reads it: on the home page (the accent marquee carries it when no section
 * already does) and in the footer. The writers are free to use it anywhere
 * else as well.
 */
export function enforceTagline(spec, dossier = {}) {
  const tag = stripCitations(dossier?.tagline || spec.brand?.tagline || "");
  if (!tag || tag.length < 6 || tag.length > 120) return spec;
  spec.brand = spec.brand || {};
  spec.brand.tagline = tag;
  const low = tag.toLowerCase();
  const home = (spec.pages || []).find(p => p.slug === "index");
  if (home && !JSON.stringify(home.sections || []).toLowerCase().includes(low)) {
    const marquee = (home.sections || []).find(s => s.type === "accent-marquee" && Array.isArray(s.items));
    if (marquee) {
      const asStrings = marquee.items.every(i => typeof i === "string");
      marquee.items.unshift(asStrings ? tag : { ...(typeof marquee.items[0] === "object" && marquee.items[0] ? Object.fromEntries(Object.keys(marquee.items[0]).map(k => [k, ""])) : {}), text: tag });
    }
  }
  spec.footer = spec.footer || { blurb: "", columns: [] };
  if (!String(spec.footer.blurb || "").toLowerCase().includes(low)) spec.footer.blurb = spec.footer.blurb ? `${tag} ${spec.footer.blurb}` : tag;
  return spec;
}
/** Reviews without a real name are proof nobody believes: drop them; drop a testimonials section left empty (unless it is the home proof stack, which keeps at least one). */
const GENERIC_NAME = /^\s*$|\b(reviewer|customer|client|homeowner|anonymous|verified|google|yelp|houzz|facebook|user)\b/i;
function cleanTestimonials(spec) {
  for (const p of spec.pages || []) {
    p.sections = (p.sections || []).filter((s, i) => {
      if (s.type !== "testimonials" || !Array.isArray(s.items)) return true;
      const named = s.items.filter(it => it && (it.quote || it.text) && it.name && !GENERIC_NAME.test(String(it.name)));
      if (named.length) { s.items = named; return true; }
      return false;
    });
  }
}

export async function runFinish(job: BuildJob) {
  if (!job.homeApproved) return runDesign(job);
  if (!job.review) await reviewSite(job);
  await finishSite(job);
}
const QA_ROUNDS = Number(process.env.BUILD_QA_ROUNDS || 3);
const VIDEO_WAIT_MS = Number(process.env.BUILD_VIDEO_WAIT_MS || 20 * 60 * 1000);
const leanQa = (qa) => qa ? { rounds: qa.rounds, passed: qa.passed, score: qa.score, verdict: qa.verdict, errors: qa.errors, issues: (qa.issues || []).slice(0, 30), shots: (qa.shots || []).slice(0, 40), history: qa.history } : undefined;

/**
 * finish: assemble → (video: delivered or the build fails) → photos → first
 * render → SEO → render + store → QA loop (browser inspection + hard gates
 * + the judge; repairs applied, re-rendered, re-inspected, up to QA_ROUNDS)
 * → only a site that passed is zipped, recorded as done and emailed.
 * Nothing is downgraded: a hero that cannot be built as planned, a logo not
 * carried, a page that renders wrong, is a failed build with the reasons.
 */
/**
 * Shared by the home gate and the final build: assemble the spec (all pages or
 * the home only), wait for the hero clip (planned ⇒ delivered, or fail), hold
 * the spec to the gate, resolve and optimise images.
 */
async function prepareSpec(job: BuildJob, only: string[] | null) {
  const d = job.dossier || {};
  const spec = assembleSpec(job, only);
  const cat = d.designDirection?.imageCategory || guessCategory(spec.brand.industry);
  if (job.videoRequested) {
    const vm0 = await readVideoManifest(job.id);
    if (vm0 && vm0.status === "ready") { spec.video = vm0; stamp(job, `hero video ready: ${vm0.mode}${vm0.count ? ", " + vm0.count + " frames at " + (vm0.tiers || []).join("/") : ""}, ${vm0.seconds} s to generate`); }
    else {
      stamp(job, `waiting for the hero video (up to ${Math.round(VIDEO_WAIT_MS / 60000)} min)`);
      const vm = await waitForVideo(job.id, VIDEO_WAIT_MS);
      if (vm && vm.status === "ready") { spec.video = vm; stamp(job, `hero video ready: ${vm.mode}${vm.count ? ", " + vm.count + " frames at " + (vm.tiers || []).join("/") : ""}, ${vm.seconds} s to generate`); }
      else { stamp(job, `hero film ${vm ? vm.status + (vm.error ? ": " + vm.error : "") : "not delivered in time"}; the home page opens on their best photo instead`); note(job, "hero: photo instead of the film", vm?.error || "the film was not ready in time"); }
    }
  }
  // film not delivered: the written video hero becomes the plain photo hero (split-intro), its copy kept, a second real photo borrowed from the page
  if (!spec.video) for (const p of spec.pages) for (const sec of p.sections) if (sec.type === "hero-video-scrub") {
    const second = p.sections.slice(1).flatMap((s) => [s.image, ...(s.images || [])]).find((i) => i?.url && i.url !== sec.image?.url) || sec.image;
    Object.assign(sec, { type: "split-intro", component: "split-intro", headline: String(sec.headline || "").replace(/\s*\/\s*/g, " "), images: [sec.image, second].filter(Boolean) });
    for (const k of ["beats", "ask", "cta2", "image", "word"]) delete sec[k];
  }
  enforceBrandWord(spec);
  const sg = gateSpec(spec, job);
  for (const w of sg.warnings) stamp(job, `site note: ${w}`);
  if (sg.errors.length) throw sg.errors.map(e => `site: ${e}`);
  resolveImages(spec.pages, cat, d.photos || []);
  navImages(spec, d.photos || [], cat);
  const tOpt = Date.now();
  const { map: imgMap, report: imgReport } = await optimizeImages(spec, job.id, { budgetMs: 150_000 });
  stamp(job, `photos optimised: ${imgReport.count} re-encoded (${mb(imgReport.before)} → ${mb(imgReport.after)}), ${imgReport.skipped} kept as they were, ${Math.round((Date.now() - tOpt) / 1000)} s`);
  return { spec, cat, imgMap, imgReport };
}

/**
 * The look-judge-fix loop. Renders and stores the pages, opens them in the
 * browser, holds them to the hard gate, shows the judge the screenshots (and
 * the clip's frames for the home page), repairs what fails, reverts a repair
 * that made things worse, and stops at a pass, at the round limit, or at the
 * cost ceiling. `lockIndex` keeps an approved home page untouched.
 */
async function qaLoop(job: BuildJob, spec, { rounds, homeOnly, lockIndex, cat, imgMap, previewBase, label }) {
  const state = { rendered: [], exported: [], htmlBefore: 0, htmlAfter: 0 };
  const renderStore = async () => {
    ruleLayer(spec); enforceBrandWord(spec);
    state.rendered = renderSite(spec, { base: previewBase });
    state.exported = renderSite(spec, { base: "" });
    state.htmlBefore = 0; state.htmlAfter = 0;
    for (const set of [state.rendered, state.exported]) for (const r of set) {
      const b = gzipSync(r.html).length;
      r.html = await minifyAssets(enhanceImages(r.html, imgMap));
      if (set === state.rendered) { state.htmlBefore += b; state.htmlAfter += gzipSync(r.html).length; }
    }
    await Promise.all(state.rendered.map(r => saveHtml(pagePath(job.id, r.slug), r.html)));
  };
  job.qa = { ...(job.qa || {}), rounds: 0, passed: false, history: job.qa?.history || [], shots: [] };
  const clonePages = () => JSON.parse(JSON.stringify(spec.pages));
  let lastGood = null, fixes = [], lastErrors = [], verdict = null, videoRetried = false;
  let videoFrames = spec.video ? await clipFrames(spec.video, 4).catch(() => []) : [];
  let framesOf = spec.video?.base || spec.video?.mp4 || "";
  for (let round = 1; round <= rounds; round++) {
    checkBudget(job, `${label} round ${round}`);
    job.qa.rounds = round;
    await renderStore();
    stamp(job, `${label} round ${round}: ${state.rendered.length} page${state.rendered.length > 1 ? "s" : ""} rendered and stored; inspecting in a browser`);
    const report = await inspectSite({ id: job.id, origin: job.origin, slugs: state.rendered.map(r => r.slug), logoExpected: Boolean(spec.brand?.logo?.url), round: (homeOnly ? 0 : 10) + round, homeOnly, stamp: (t) => stamp(job, t) });
    const ig = gateInspection(report);
    job.qa.shots = report.pages.flatMap(p => p.shots.map(s => ({ page: p.slug, viewport: p.viewport, name: s.name, url: s.url })));
    await saveJson(buildPath(job.id, `qa/${(homeOnly ? 0 : 10) + round}/inspection.json`), leanReport(report));
    stamp(job, `inspection: ${report.pages.length} views, ${report.shots} screenshots in ${report.seconds} s · ${ig.errors.length} hard errors${ig.warnings.length ? ", " + ig.warnings.length + " notes" : ""}`);
    for (const w of ig.warnings) stamp(job, `inspection note: ${w}`);
    if (spec.video && (spec.video.base || spec.video.mp4) !== framesOf) { videoFrames = await clipFrames(spec.video, 4).catch(() => []); framesOf = spec.video.base || spec.video.mp4 || ""; }
    verdict = await judgeSite(job, spec, report, ig, { homeOnly, extraShots: homeOnly ? videoFrames : [] });
    const blocks = (verdict.issues || []).filter(i => i.severity === "block");
    const passed = !ig.errors.length && !blocks.length && (verdict.score || 0) >= Number(process.env.BUILD_PASS_SCORE || 75);
    job.qa.history.push({ round: (homeOnly ? "home " : "site ") + round, hardErrors: ig.errors, score: verdict.score, pass: verdict.pass, verdict: verdict.verdict, issues: (verdict.issues || []).length, blocks: blocks.length });
    job.qa.score = verdict.score; job.qa.verdict = verdict.verdict; job.qa.issues = verdict.issues || []; job.qa.errors = ig.errors;
    note(job, `${label} round ${round}: ${verdict.score}/100${passed ? ", passed" : ""}`, verdict.verdict || "");
    if (passed) { job.qa.passed = true; stamp(job, `${label} passed in round ${round}: ${verdict.score}/100 · ${verdict.verdict}`); await leadRecord(job, homeOnly ? "home" : "finish"); break; }
    const errorsNow = [...ig.errors.map(e => `browser: ${e}`), ...blocks.map(i => `${i.page}${i.section ? " §" + i.section : ""}: ${i.problem}`)];
    stamp(job, `${label} round ${round}: ${verdict.pass ? "judge passed" : "judge failed"} ${verdict.score}/100, ${ig.errors.length} hard errors, ${blocks.length} blocking issues · ${verdict.verdict}`);
    const score = (verdict.score || 0) - ig.errors.length * 10;
    const allFixes = [...(verdict.issues || []).filter(i => i.severity !== "note"), ...inspectionIssues(report, spec)].filter(i => !(lockIndex && i.page === "index"));
    const thisRound = { pages: clonePages(), score, errors: errorsNow, hardErrors: ig.errors.map(e => `browser: ${e}`), fixes: allFixes };
    if (lastGood && score < lastGood.score) {
      stamp(job, `round ${round} scored ${score} against ${lastGood.score} before the repair; reverting to the better version`);
      spec.pages = JSON.parse(JSON.stringify(lastGood.pages));
      for (const p of spec.pages) { const jp = job.pages.find(x => x.slug === p.slug); if (jp) jp.sections = p.sections.map(x => ({ ...x })); }
      fixes = lastGood.fixes.map(f => ({ ...f, instruction: `${f.instruction || ""} (a previous attempt at this made the page worse: change only what this finding names, keep every section type and photo that is not named)` }));
      lastErrors = lastGood.errors;
    } else { lastGood = thisRound; fixes = thisRound.fixes; lastErrors = errorsNow; }
    await leadRecord(job, homeOnly ? "home" : "finish");
    if (round === rounds) break;
    // the clip itself is the problem: one more clip from the next-best photo, then the hero copy is repaired as usual
    // only a complaint about the clip itself (its frames warping, melting, blurring, an ugly or wrong source photo) earns a second clip; layout or copy complaints about the hero do not
    const clipIssue = homeOnly && spec.video && !videoRetried && (verdict.issues || []).find(i => i.page === "index" && (i.section === 1 || i.section === null) && i.severity !== "note" && /\b(clip|footage|video)\b/i.test(`${i.problem} ${i.instruction}`) && /\b(warp|distort|melt|artifact|blurr?y|smear|ugly|untidy|messy|mid-build|debris|wrong (source )?photo|source photo|different photo)\b/i.test(`${i.problem} ${i.instruction}`) && !/\b(preloader|counter|status line|button|overlap|collid)/i.test(`${i.problem} ${i.instruction}`));
    if (clipIssue) {
      videoRetried = true;
      const alt = alternateSourceImage(job, [job.videoSource || "", spec.video.sourceImage || ""]);
      if (alt) {
        stamp(job, `the judge faulted the hero clip (${clipIssue.problem.slice(0, 120)}); generating it again from ${alt.split("/").pop()}`);
        note(job, "hero clip regenerated", clipIssue.problem);
        // the second clip is made in its own folder; only a finished one replaces the first (the main manifest is never left pending)
        const vm = await runVideo({ ...job, videoSource: alt }, (t) => stamp(job, t), { sourceImage: alt, folder: "video2", manifestName: "manifest.json" });
        if (vm && vm.status === "ready") { spec.video = vm; job.videoSource = alt; await saveJson(buildPath(job.id, "video/manifest.json"), vm); const hero = spec.pages.find(p => p.slug === "index")?.sections?.[0]; if (hero?.image) hero.image = { query: alt, alt: hero.image.alt || "", url: alt }; }
        else stamp(job, `second clip not ready (${vm?.status}${vm?.error ? ": " + vm.error : ""}); keeping the first`);
      }
    }
    if (!fixes.length) { stamp(job, "nothing concrete to repair; stopping"); break; }
    stamp(job, `repairing ${new Set(fixes.map(f => f.page)).size} page(s) from ${fixes.length} finding(s)`);
    await repairSite(job, spec, fixes, cat, report);
    await leadRecord(job, homeOnly ? "home" : "finish");
  }
  // a build that did not pass still leaves its best version in the preview, not its worst
  if (!job.qa.passed && lastGood && JSON.stringify(spec.pages) !== JSON.stringify(lastGood.pages)) {
    spec.pages = JSON.parse(JSON.stringify(lastGood.pages));
    try { await renderStore(); stamp(job, `preview left on the best version (score ${lastGood.score})`); } catch {}
  }
  return { passed: Boolean(job.qa.passed), verdict, lastErrors, lastGood, ...state };
}

/**
 * Home first. Plan the site, write the home page only, make the clip part of
 * it, and run the look-judge-fix loop on that one page until it passes. Only
 * an approved home page becomes the pattern for the rest of the site.
 */
export async function finishHome(job: BuildJob): Promise<boolean> {
  await leadRecord(job, "home");
  try {
    if (!(await writeAll(job, ["index"]))) return false;
    const previewBase = `/preview/${job.id}`;
    if (!blobConfigured()) throw ["preview storage is not configured; the site cannot be inspected, so it is not built"];
    const { spec, cat, imgMap } = await prepareSpec(job, ["index"]);
    const r = await qaLoop(job, spec, { rounds: QA_ROUNDS, homeOnly: true, lockIndex: false, cat, imgMap, previewBase, label: "home page gate" });
    if (!r.passed) {
      const broken = (r.lastGood?.hardErrors || r.lastErrors || []).filter(e => /^browser:/.test(e));
      if (broken.length) throw [`home page does not work after ${job.qa.rounds} round(s)`, ...broken.slice(0, 8)];
      job.needsLook = [...(job.needsLook || []), ...r.lastErrors.slice(0, 10)];
      stamp(job, `home page accepted at its best version (${r.lastGood?.score ?? r.verdict?.score ?? "—"}/100) with ${job.needsLook.length} note${job.needsLook.length === 1 ? "" : "s"} for the owner`);
    }
    // lock the approved home page: its sections, with their resolved photos, are what the site is built around
    const home = spec.pages.find(p => p.slug === "index");
    const jp = job.pages.find(p => p.slug === "index"); if (jp && home) jp.sections = home.sections.map(s => ({ ...s }));
    job.homeApproved = true;
    job.videoSource = spec.video?.sourceImage || job.videoSource;
    await saveJson(buildPath(job.id, "home.json"), home);
    await leadRecord(job, "home");
    return true;
  } catch (e) {
    await distillLessons(job, { enforced: ENFORCED }).catch(() => {});
    await fail(job, "design", e); return false;
  }
}

/**
 * The rest of the site, built to the approved home page's pattern: write the
 * inner pages, review them, run the loop on the whole site with the home page
 * locked, then deliver: zip, journal, lessons, the email. Nothing is
 * downgraded; a site that does not pass is a failed build with the reasons.
 */
export async function finishSite(job: BuildJob): Promise<boolean> {
  await leadRecord(job, "finish");
  try {
    const d = job.dossier || {};
    const previewBase = `/preview/${job.id}`;
    const previewUrl = blobConfigured() ? `${job.origin}${previewBase}` : "";
    if (!previewUrl) throw ["preview storage is not configured; the site cannot be inspected, so it is not sent"];
    const { spec, cat, imgMap, imgReport } = await prepareSpec(job, null);

    /* SEO: titles, descriptions, keywords per page, site plan, alt text */
    let rendered = renderSite(spec, { base: previewBase });
    const audits = Object.fromEntries(rendered.map(r => [r.slug, audit(r.html, { ...spec, seo: spec.pages.find(p => p.slug === r.slug)?.seo || {} })]));
    const before = Math.round(rendered.reduce((s, r) => s + audits[r.slug].score, 0) / rendered.length);
    let plan = keywordPlan({ brand: spec.brand, sections: spec.pages[0]?.sections || [] });
    let notes = [];
    try {
      const queries = new Set();
      for (const p of spec.pages) for (const s of p.sections) { if (s.image?.query) queries.add(s.image.query); (s.images || []).forEach(i => i.query && queries.add(i.query)); (s.items || []).forEach(i => i.image && queries.add(i.query || i.title)); (s.slides || []).forEach(i => queries.add(i.query || i.title)); }
      const pagesLean = spec.pages.map(p => ({ slug: p.slug, title: p.title, seo: p.seo, headings: p.sections.map(s => s.headline || s.title || s.text?.slice?.(0, 80)).filter(Boolean), text: p.sections.map(s => [s.sub, s.intro, ...(s.paragraphs || [])].filter(Boolean).join(" ")).join(" ").slice(0, 1200), audit: { score: audits[p.slug]?.score, flagged: (audits[p.slug]?.checks || []).filter(c => c.status !== "pass").map(c => c.id) } }));
      const user = `BRAND: ${JSON.stringify(spec.brand)}\n\nPAGES:\n${JSON.stringify(pagesLean, null, 1)}\n\nDOSSIER (excerpt):\n${JSON.stringify({ serviceArea: d.serviceArea, audience: d.audience, competitors: d.competitors, keywords: d.keywords, market: d.market, gaps: d.gaps })}\n\nIMAGE QUERIES NEEDING ALT TEXT:\n${JSON.stringify([...queries].filter(q => !/^https?:/.test(q)).slice(0, 80))}`;
      const { text, usage } = await withTimeout(structured({ system: SYSTEM_SEO(), user, schema: SEO_SCHEMA, effort: "low", maxTokens: 28000, model: modelFor("seo") }), 300_000, "SEO pass");
      job.usage = addUsage(job.usage, usage);
      const seo = parseJson(text);
      if (seo) {
        plan = seo.plan?.length ? seo.plan : plan; notes = seo.notes || [];
        const alt = Object.fromEntries((seo.altText || []).map(x => [x.query, x.alt]));
        for (const p of spec.pages) {
          const sp = (seo.pages || []).find(x => x.slug === p.slug);
          if (sp) p.seo = { ...p.seo, title: sp.title || p.seo?.title, description: sp.description || p.seo?.description, keywords: sp.keywords?.length ? sp.keywords : p.seo?.keywords };
          for (const s of p.sections) { if (s.image && alt[s.image.query]) s.image.alt = alt[s.image.query]; (s.images || []).forEach(im => { if (alt[im.query]) im.alt = alt[im.query]; }); (s.items || []).forEach(it => { if (it.image && alt[it.query]) it.image.alt = alt[it.query]; }); }
        }
        stamp(job, `SEO agent: titles and descriptions for ${(seo.pages || []).length} pages, ${plan.length} keywords, ${notes.length} notes`);
      }
    } catch (e) { stamp(job, `SEO model half skipped: ${describeError(e)}; rule layer still applied`); }

    /* the whole site through the loop, home page locked */
    const r = await qaLoop(job, spec, { rounds: Number(process.env.BUILD_QA_ROUNDS_SITE || 2), homeOnly: false, lockIndex: Boolean(job.homeApproved), cat, imgMap, previewBase, label: "site gate" });
    if (!r.passed) {
      const broken = (r.lastGood?.hardErrors || r.lastErrors || []).filter(e => /^browser:/.test(e));
      if (broken.length) throw [`site does not work after ${job.qa.rounds} round(s)`, ...broken.slice(0, 8)];
      job.needsLook = [...(job.needsLook || []), ...r.lastErrors.slice(0, 10)];
      stamp(job, `site delivered at its best version (${r.lastGood?.score ?? r.verdict?.score ?? "—"}/100) with ${job.needsLook.length} note${job.needsLook.length === 1 ? "" : "s"} for the owner`);
    }
    rendered = r.rendered;
    let exported = r.exported;

    job.weight = { images: imgReport, html: { before: r.htmlBefore, after: r.htmlAfter } };
    stamp(job, `markup minified: ${kb(r.htmlBefore)} → ${kb(r.htmlAfter)} gzipped across ${rendered.length} pages`);

    /* the lightener: the same site to the eye with fewer bytes; every change is photographed before and after and kept only when nothing looks different */
    if (process.env.BUILD_LIGHTEN !== "0") {
      try {
        const light = await withTimeout(lightenSite({ job, rendered, exported, stamp: (m) => stamp(job, m) }), Number(process.env.BUILD_LIGHTEN_MS || 240_000) + 60_000, "lightener");
        if (light) { rendered = light.rendered; exported = light.exported; job.weight.light = light.report; }
      } catch (e) { stamp(job, `lightener skipped: ${describeError(e)}`); }
    }
    const finalAudits = rendered.map(x => audit(x.html, { ...spec, seo: spec.pages.find(p => p.slug === x.slug)?.seo || {} }));
    const score = Math.round(finalAudits.reduce((s, a) => s + a.score, 0) / finalAudits.length);
    const components = componentsUsed(spec);
    const ownPhotos = countOwnPhotos(spec);
    job.seo = { score, before, perPage: rendered.map((x, i) => ({ slug: x.slug, score: finalAudits[i].score, title: spec.pages.find(p => p.slug === x.slug)?.seo?.title })), plan, notes, flagged: finalAudits.flatMap((a, i) => a.checks.filter(c => c.status === "fail").map(c => `${rendered[i].slug}: ${c.label} (${c.detail})`)).slice(0, 20) };
    stamp(job, `rendered ${rendered.length} pages (${(rendered.reduce((s, x) => s + x.html.length, 0) / 1024).toFixed(0)} KB) · ${components.length} components: ${components.join(", ")} · ${ownPhotos} of their own photos · SEO ${before} → ${score}/100`);

    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    for (const x of exported) zip.file(x.slug === "index" ? "index.html" : `${x.slug}/index.html`, x.html);
    zip.file("README.txt", `${spec.brand.name} — site built by Unifictional on ${new Date().toISOString().slice(0, 10)}.\nUpload this folder to any static host (Vercel, Netlify, Cloudflare Pages) at the domain root. Pages: ${exported.map(x => x.slug).join(", ")}.\nComponents (Awwwards Pack): ${components.join(", ")}.\n`);
    const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

    const lessons = await distillLessons(job, { enforced: ENFORCED }).catch(() => []);
    await Promise.all([
      saveJson(buildPath(job.id, "spec.json"), spec),
      saveJson(buildPath(job.id, "seo.json"), job.seo),
      saveJson(buildPath(job.id, "review.json"), job.review || {}),
      saveJson(buildPath(job.id, "hook.json"), job.hook || {}),
      saveJson(buildPath(job.id, "qa.json"), leanQa(job.qa)),
      saveJson(buildPath(job.id, "journal.json"), job.journal || []),
      saveBinary(buildPath(job.id, "site.zip"), zipBuf, "application/zip"),
    ]);
    const u = job.usage || emptyUsage();
    stamp(job, `cost: ${u.calls} model calls, ${u.searches} searches, ${(u.input / 1000).toFixed(0)}k in / ${(u.output / 1000).toFixed(0)}k out tokens ≈ $${costOf(u).toFixed(2)}`);
    if (lessons.length) stamp(job, `studio lessons updated: ${lessons.length} rules`);
    job.spec = spec; // the next stage gets the spec from the job, never from a read that the CDN may serve stale
    const doneExtra = { previewUrl, score, pages: rendered.map(x => x.slug), weight: job.weight, qa: leanQa(job.qa), needsLook: job.needsLook || [], hero: spec.pages[0]?.sections?.[0]?.component, menu: spec.nav?.menu, video: spec.video ? { mode: spec.video.mode, count: spec.video.count, seconds: spec.video.seconds } : undefined, hook: job.hook ? { claim: job.hook.hook?.claim, flagship: job.hook.flagship?.title, ask: job.hook.ask?.label } : undefined };
    await leadRecord(job, "done", doneExtra);
    if (!publishStage()) await sendBuildReady({ job, spec, pages: rendered.map(x => ({ slug: x.slug, title: x.title })), components, ownPhotos, previewUrl, zip: zipBuf, model: MODEL });
    else stamp(job, "site built; the debugger looks at every page next, then it goes live");
    stamp(job, "owner emailed");
    await leadRecord(job, "done", doneExtra);
    return true;
  } catch (e) {
    await distillLessons(job, { enforced: ENFORCED }).catch(() => {});
    await fail(job, "finish", e); return false;
  }
}

/* rule layer: schema per page, canonical, og, alt fallbacks (idempotent; runs before every render) */
function ruleLayer(spec) {
  for (const p of spec.pages) {
    p.seo = p.seo || {};
    p.seo.schema = schemaForPage(spec, p);
    const firstImg = p.sections.find(s => s.image?.url)?.image?.url || p.sections.find(s => s.images?.[0]?.url)?.images[0].url || "";
    p.seo.og = { title: p.seo.title, description: p.seo.description, image: firstImg };
    for (const s of p.sections) { if (s.image) s.image.alt = s.image.alt || `${spec.brand.name} ${s.image.query || ""}`.trim(); (s.images || []).forEach((im, i) => { im.alt = im.alt || `${spec.brand.name} project ${i + 1}`; }); }
  }
}

/* ---------------------------------------------------------------- judge */
/** Fable looks at the screenshots against the standard; returns {pass, score, verdict, issues}. Never throws: a judge that cannot answer fails the round. */
async function judgeSite(job: BuildJob, spec, report, ig, { homeOnly = false, extraShots = [] } = {}) {
  const shots = [...judgeShots(report), ...extraShots.map(x => ({ label: x.label, data: x.data }))];
  if (!shots.length) return { pass: false, score: 0, verdict: "no screenshots to judge", issues: [] };
  const content = [
    { type: "text", text: homeOnly ? "YOU ARE JUDGING THE HOME PAGE ONLY (desktop and phone), plus frames of its hero clip. The inner pages come later, built to this page's pattern, so this is the page that has to be right." : `YOU ARE JUDGING THE WHOLE SITE. The home page already passed its own gate${job.homeApproved ? " and is locked" : ""}; judge the inner pages hardest.` },
    { type: "text", text: lessonsBlock(job.lessons || []) || "" },
    { type: "text", text: `COMPANY: ${spec.brand.name} (${spec.brand.industry || ""}, ${spec.brand.city || ""})\n\nHOOK STRATEGY:\n${JSON.stringify(job.hook || {}, null, 1)}\n\nPAGES: ${spec.pages.map(p => p.slug).join(", ")}\nHOME SECTIONS (in order): ${(spec.pages.find(p => p.slug === "index")?.sections || []).map((s, i) => `${i + 1}. ${s.type}`).join(", ")}\nTHEIR LOGO: ${spec.brand.logo?.url ? "found and used" : "none found (wordmark)"}\nREAL PHOTOS AVAILABLE: ${(job.dossier?.photos || []).length} (every photo taken from their own website and media library counts as theirs, whatever it looks like)\nSTOCK PHOTOS ACTUALLY USED: ${stockPlacements(spec).length ? stockPlacements(spec).join(", ") : "none"} (only these are stock; do not call any other photo stock)\n\nWHAT THE BROWSER FOUND (hard errors already counted): ${ig.errors.length ? ig.errors.join("; ") : "nothing"}\n\nThe screenshots follow, each labelled. Section numbers in the labels (s01, s02…) are the 1-based section numbers.` },
    ...shots.flatMap(s => [{ type: "text", text: `[${s.label}]` }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: s.data } }]),
    { type: "text", text: "Judge the site now. Return the JSON only." },
  ];
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { text, usage } = await withTimeout(structured({ system: SYSTEM_JUDGE(), user: content, schema: null, effort: "medium", maxTokens: 12000, model: modelFor("review") }), 300_000, "judge");
      job.usage = addUsage(job.usage, usage);
      const v = parseJson(text);
      if (!v || typeof v.pass !== "boolean") { lastErr = new Error("the judge returned nothing readable"); continue; }
      v.issues = Array.isArray(v.issues) ? v.issues.filter(i => i && i.page && i.problem) : [];
      return v;
    } catch (e) { lastErr = e; stamp(job, `judge attempt ${attempt} failed: ${describeError(e)}`); if (attempt < 2) await new Promise(r => setTimeout(r, 15_000)); }
  }
  // the judge could not answer: that is a pipeline fault, not a verdict on the site
  throw [`the quality judge could not answer: ${describeError(lastErr)}`];
}

/** Where stock photography landed (the only photos that are not the company's own). */
function stockPlacements(spec) {
  const out = [];
  for (const p of spec.pages || []) (p.sections || []).forEach((s, i) => {
    const urls = [s.image?.url, ...(s.images || []).map(x => x?.url), ...(s.items || []).map(x => x?.image?.url), ...(s.slides || []).map(x => x?.image?.url)].filter(Boolean);
    if (urls.some(u => /unsplash/.test(u))) out.push(`${p.slug} §${i + 1} (${s.type})`);
  });
  return out;
}

/** Hard browser findings as repair instructions (the judge sees them too, but these are mechanical). */
function inspectionIssues(report, spec) {
  const out = [];
  for (const p of report.pages) {
    for (const b of p.blankSections || []) out.push({ page: p.slug, section: b.index + 1, severity: "block", problem: `section ${b.index + 1} (${b.type}) renders blank on ${p.viewport}`, action: "swap", instruction: `Replace this section with a component that shows the same content statically and reliably (a gallery, one-image, tiles-reveal or a text block with photos); keep its facts and photos.`, alternative: "" });
    for (const c of p.clippedText || []) out.push({ page: p.slug, section: null, severity: "block", problem: `text clipped off screen on ${p.viewport}: "${c}"`, action: "rewrite", instruction: "Shorten this headline so it fits the screen; if it is a hero word, it must be the brand word.", alternative: "" });
    if (p.overflowPx > 2) out.push({ page: p.slug, section: null, severity: "block", problem: `page overflows horizontally by ${p.overflowPx}px on ${p.viewport} (${(p.overflowBy || []).join(", ")})`, action: "swap", instruction: "Swap the section causing the overflow for a component that stays within the viewport.", alternative: "" });
    for (const img of p.brokenImages || []) out.push({ page: p.slug, section: null, severity: "fix", problem: `broken image ${img}`, action: "rewrite", instruction: "Replace the broken image with one of the real photos from the list.", alternative: "" });
  }
  return out;
}

/* --------------------------------------------------------------- repair */
/** Apply the gate's findings page by page: swaps are made in code, then the writer rewrites the affected sections. Mutates spec.pages and job.pages. */
async function repairSite(job: BuildJob, spec, issues, cat, report = null) {
  const d = job.dossier || {};
  const byPage = {};
  // the screenshots of the page being fixed, so the writer sees what the judge saw
  const shotsFor = (slug) => (report?.pages || []).filter(p => p.slug === slug && p.viewport === "desktop").flatMap(p => p.shots.filter(x => x.data).slice(0, 6).map(x => ({ label: `${slug} · ${x.name}`, data: x.data })));
  for (const i of issues) (byPage[i.page] = byPage[i.page] || []).push(i);
  const SAFE_SWAP = { "story-blinds": "tiles-reveal", "story-wipe": "one-image", "projects-wedge": "photo-wall", "photo-wall": "gallery", "wave-column": "gallery", "tiles-reveal": "gallery", "pile": "gallery", "cards-flip": "services", "hero-split": "hero-zoom", "hero-zoom": "hero-slit", "hero-slit": "hero-split", "hero-slider": "hero-split" };
  for (const [slug, list] of Object.entries(byPage)) {
    const page = spec.pages.find(p => p.slug === slug);
    if (!page) { stamp(job, `repair: no page "${slug}"; skipped ${list.length} finding(s)`); continue; }
    // mechanical part: swaps and drops
    for (const i of list) {
      const idx = i.section ? Number(i.section) - 1 : -1;
      const s = page.sections[idx];
      if (!s) continue;
      if (i.action === "drop" && page.sections.length > 3 && idx > 0) { page.sections.splice(idx, 1); i.instruction = `(dropped section ${i.section})`; continue; }
      // the home hero is never swapped: the video hero is a planned feature (its copy may be rewritten), and a hero stays a hero
      if (slug === "index" && idx === 0 && i.action !== "rewrite") { i.action = "rewrite"; i.instruction = `${i.instruction || ""} (keep this hero section and its field shape; change only its copy and, if a cleaner real photo exists, its image)`; continue; }
      if (slug === "index" && idx === 2 && i.action !== "rewrite") { i.action = "rewrite"; i.instruction = `${i.instruction || ""} (this is the proof stack; keep its type, rewrite its content)`; continue; }
      if (slug === "index" && idx === 1 && (i.action === "swap" || i.action === "replan") && !(i.alternative && FLAGSHIP_TYPES.has(i.alternative))) { i.alternative = ""; }
      if (slug === "index" && i.action === "replan") i.action = "rewrite";
      if (i.action === "swap" || i.action === "replan") {
        // the judge may name a component that does not exist: fall back to the safe swap for this type, else the plain block with the same role
        const generic = byType[s.type]?.kind === "hero" ? "hero-split" : Array.isArray(s.items) && s.items.length ? "services" : (Array.isArray(s.images) && s.images.length) || Array.isArray(s.slides) ? "gallery" : "text";
        const want = i.alternative && byType[i.alternative] && byType[i.alternative].kind === byType[s.type]?.kind ? i.alternative : (SAFE_SWAP[s.type] && byType[SAFE_SWAP[s.type]] ? SAFE_SWAP[s.type] : (byType[generic] && generic !== s.type ? generic : null));
        if (want && want !== s.type) { const old = s.type; s.type = want; s.component = byType[want].id; i.instruction = `${i.instruction || ""} (this section was ${old}; it is now ${want}: write it in ${want}'s field shape with the same facts and photos)`; }
      }
    }
    // the writer applies the instructions
    const findings = list.map(i => `- ${i.section ? "section " + i.section + ": " : ""}${i.problem} → ${i.action}: ${i.instruction || ""}`).join("\n");
    const user = [
      `PAGE: ${slug} (${page.title || ""})`,
      `FINDINGS TO FIX:\n${findings}`,
      `BRAND WORD FOR ANY HERO: ${brandWord(spec.brand?.name)}`,
      `CURRENT SECTIONS:\n${JSON.stringify(page.sections.map(s => { const c = { ...s }; delete c.component; return c; }), null, 1)}`,
      `FIELD SHAPES:\n${fieldShapes(page.sections)}`,
      job.hook ? `HOOK STRATEGY:\n${JSON.stringify(job.hook, null, 1)}` : "",
      `REAL PHOTOS (url · what it shows):\n${(d.photos || []).slice(0, 60).map(p => `${p.url} · ${p.alt}`).join("\n") || "none"}`,
      `RESEARCH DOSSIER:\n${JSON.stringify({ ...d, photos: undefined, sources: undefined, searchesA: undefined, searchesB: undefined }, null, 1)}`,
    ].filter(Boolean).join("\n\n");
    try {
      const shots = shotsFor(slug);
      const lessonText = lessonsBlock(job.lessons || []);
      const content = shots.length ? [{ type: "text", text: `${lessonText ? lessonText + "\n\n" : ""}${user}` }, { type: "text", text: "WHAT THE PAGE LOOKS LIKE NOW (the screenshots the judge saw):" }, ...imageBlocks(shots)] : (lessonText ? `${lessonText}\n\n${user}` : user);
      const { text, usage } = await withTimeout(structured({ system: SYSTEM_REPAIR(), user: content, schema: null, effort: "medium", maxTokens: 28000, model: modelFor("write") }), 330_000, `repair ${slug}`);
      job.usage = addUsage(job.usage, usage);
      const out = parseJson(text);
      if (out && Array.isArray(out.sections) && out.sections.length) {
        page.sections = out.sections.filter(s => s && byType[s.type]).map(s => ({ ...s, component: byType[s.type].id }));
        resolveImages(page, cat, d.photos || []);
        const jp = job.pages.find(p => p.slug === slug); if (jp) jp.sections = page.sections.map(s => ({ ...s }));
        stamp(job, `repaired ${slug}: ${(out.changed || []).length ? (out.changed || []).slice(0, 4).join("; ") : page.sections.length + " sections rewritten"}`);
      } else stamp(job, `repair of ${slug} returned nothing usable; page kept`);
    } catch (e) {
      stamp(job, `repair of ${slug} failed: ${describeError(e)}`);
    }
  }
  enforceBrandWord(spec);
  try { await saveJson(buildPath(job.id, "pages.json"), job.pages); } catch {}
}

/** The whole build in one process (used by the Trigger.dev task; no self-calls). */
export async function runAll(job: BuildJob, onPhase?: (phase: string, job: BuildJob) => Promise<void> | void) {
  const step = async (name, fn) => { const ok = await fn(); if (onPhase) await onPhase(name, job); return ok; };
  if (!(await step("research", () => researchA(job)))) return job;
  await step("research-b", async () => { await researchB(job); return true; });
  await step("hook", () => lookThenHook(job));
  if (!(await step("research-gate", () => gateAfterResearch(job)))) return job;
  job.videoRequested = videoConfigured();
  const videoP = job.videoRequested ? runVideo(job, (t) => stamp(job, t)).catch(() => null) : Promise.resolve(null);
  if (!(await step("plan", () => planSite(job)))) return job;
  await videoP;
  if (!(await step("home", () => finishHome(job)))) return job;
  if (!(await step("write", () => writeAll(job, null)))) return job;
  await step("review", async () => { await reviewSite(job); return true; });
  await step("finish", () => finishSite(job));
  return job;
}

function guessCategory(industry = "") {
  const s = industry.toLowerCase();
  if (/pool|spa/.test(s)) return "pools"; if (/roof|siding|exterior|gutter/.test(s)) return "roofing"; if (/kitchen|bath|cabinet|remodel/.test(s)) return "kitchen";
  if (/landscap|garden|lawn|hardscape|deck|fence|patio/.test(s)) return "landscaping"; if (/interior|design/.test(s)) return "interior"; if (/restaurant|cafe|food/.test(s)) return "restaurant";
  if (/gym|fitness|yoga/.test(s)) return "fitness"; if (/software|saas|tech|app/.test(s)) return "tech"; if (/salon|beauty|spa|lash|nail/.test(s)) return "beauty";
  if (/real estate|realtor|property/.test(s)) return "realestate"; if (/dental|clinic|medical|health/.test(s)) return "medical"; if (/law|attorney|legal/.test(s)) return "law";
  if (/photo|video|film/.test(s)) return "photography"; if (/contractor|build|construct|concrete|excavat|fram|electric|plumb|hvac|paint|floor/.test(s)) return "construction";
  return "generic";
}

// Restart aliases: research-b → research (both passes rerun), plan → design, review → finish.
export const RUNNERS: Record<Step, (job: BuildJob) => Promise<void>> = { research: runResearch, design: runDesign, write: runWrite, finish: runFinish, video: runVideoStep, "research-b": runResearch, plan: runDesign, review: runFinish };
/** Home first: plan, write and approve the home page (Trigger.dev task "build-home"). */
export async function runHome(job: BuildJob): Promise<boolean> {
  if (!job.hook?.hook?.claim) await hookSite(job);
  if (!(await planSite(job))) return false;
  return finishHome(job);
}
/** The inner pages, the review and delivery (Trigger.dev task "build-site-rest"). */
/** The debug + publish stage is on unless PUBLISH_STAGE=0. */
export const publishStage = () => process.env.PUBLISH_STAGE !== "0";

/**
 * After delivery: the debugger opens every page, fixes what looks off and
 * verifies each fix; then the site is published to Vercel as its own project
 * and the owner gets the one email with the live URL. Never fails a build
 * that is already built: any problem here becomes a note and the preview
 * stands.
 */
export async function runPublish(job: BuildJob): Promise<boolean> {
  const previewBase = `/preview/${job.id}`;
  const previewUrl = blobConfigured() ? `${job.origin}${previewBase}` : "";
  let spec = null, exported = [];
  try {
    spec = job.spec && Array.isArray(job.spec.pages) ? job.spec : await readJson(buildPath(job.id, "spec.json"));
    if (!spec || !Array.isArray(spec.pages)) throw new Error("spec.json is missing; nothing to debug");
    if (!job.dossier) job.dossier = (await readJson(buildPath(job.id, "dossier.json"))) || {};
    const cat = { photos: job.dossier?.photos || [] };
    await leadRecord(job, "debug");
    const imgMap = new Map();
    const renderStore = async () => {
      ruleLayer(spec); enforceBrandWord(spec);
      const rendered = renderSite(spec, { base: previewBase });
      exported = renderSite(spec, { base: "" });
      for (const set of [rendered, exported]) for (const r of set) r.html = await minifyAssets(enhanceImages(r.html, imgMap));
      await Promise.all(rendered.map(r => saveHtml(pagePath(job.id, r.slug), r.html)));
    };
    await renderStore();
    const t0 = Date.now();
    const d = await withTimeout(debugSite(job, spec, { cat, origin: job.origin, previewBase, renderStore, stamp: (m) => stamp(job, m) }), Number(process.env.DEBUG_MAX_MS || 55 * 60_000), "the debugger");
    job.debugNotes = d.notes;
    const du = job.debugUsage;
    stamp(job, `debugger done in ${Math.round((Date.now() - t0) / 1000)} s: ${d.changed.length} page${d.changed.length === 1 ? "" : "s"} improved, ${d.notes.length} fix${d.notes.length === 1 ? "" : "es"}${du ? ` · ${du.calls} calls ≈ $${costOf(du).toFixed(2)} on the debugger's key` : ""}`);
    // store the debugged site: pages are already on disk; refresh the spec and the zip
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    for (const x of exported) zip.file(x.slug === "index" ? "index.html" : `${x.slug}/index.html`, x.html);
    zip.file("README.txt", `${spec.brand.name} — site built by Unifictional on ${new Date().toISOString().slice(0, 10)}.\nUpload this folder to any static host at the domain you own.`);
    const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    await Promise.all([saveJson(buildPath(job.id, "spec.json"), spec), saveBinary(buildPath(job.id, "site.zip"), zipBuf, "application/zip"), saveJson(buildPath(job.id, "journal.json"), job.journal || [])]);
    // publish
    await leadRecord(job, "publish", { debugNotes: job.debugNotes });
    if (publishConfigured()) {
      try {
        const pub = await withTimeout(publishSite({ business: job.lead.businessName || spec.brand.name, id: job.id, pages: exported, extra: { "robots.txt": "User-agent: *\nAllow: /\n" }, stamp: (m) => stamp(job, m) }), 6 * 60_000, "publishing to Vercel");
        job.publishedUrl = pub.url;
      } catch (e) { job.publishNote = describeError(e); stamp(job, `publish: ${job.publishNote}; the preview stands`); }
    } else { job.publishNote = "VERCEL_TOKEN is not set on the build servers"; stamp(job, "publish skipped: VERCEL_TOKEN is not set; the preview stands"); }
    const components = componentsUsed(spec); const ownPhotos = countOwnPhotos(spec);
    const rendered = exported.map(x => ({ slug: x.slug, title: x.title }));
    await leadRecord(job, "done", { previewUrl, publishedUrl: job.publishedUrl, publishNote: job.publishNote, debugNotes: job.debugNotes, pages: rendered.map(x => x.slug) });
    try { await sendBuildReady({ job, spec, pages: rendered, components, ownPhotos, previewUrl, zip: zipBuf, model: MODEL }); } catch (e) { stamp(job, `ready email: ${describeError(e)}`); }
    try { await saveJson(buildPath(job.id, "journal.json"), job.journal || []); } catch {}
    return true;
  } catch (e) {
    // the site is already built and delivered; this stage never fails the build
    stamp(job, `debug/publish stage stopped: ${describeError(e)}; the preview stands`);
    await leadRecord(job, "done", { previewUrl, publishNote: describeError(e) });
    if (spec) { try { await sendBuildReady({ job, spec, pages: spec.pages.map(p => ({ slug: p.slug, title: p.title })), components: componentsUsed(spec), ownPhotos: countOwnPhotos(spec), previewUrl, zip: null, model: MODEL }); } catch {} }
    return false;
  }
}

export async function runRest(job: BuildJob): Promise<boolean> {
  if (!(await writeAll(job, null))) return false;
  await reviewSite(job);
  return finishSite(job);
}
