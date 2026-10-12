// @ts-nocheck
// What an agent can do to the site. Every tool works on the shared workspace
// (the dossier, the hook, the spec) and most of them return what a person
// would see: the page's data, the site's shape, a screenshot after a render.
// The foreman hands each role the subset it may use.
import { byType } from "../build/components";
import { packManifest, offerFor } from "../build/prompts";
import { fitTable, fitErrorsWritten } from "../build/fit";
import { gatePlan, gatePages } from "../build/gates";
import { resolveImages } from "../build/images";
import { renderSite } from "../build/renderer";
import { inspectSite } from "../build/inspect";
import { enforceBrandWord } from "../build/pipeline";
import { minifyAssets, enhanceImages } from "../build/optimize";
import { pagePath, saveHtml } from "../build/storage";
import type { Role } from "./keys";

export interface Workspace {
  job: any; spec: any; board: any; origin: string; previewBase: string; stamp: (s: string) => void; round: number;
  memoryAdds: Record<string, string[]>; cat: any;
}

const TOOL = (name, description, properties = {}, required = []) => ({ name, description, input_schema: { type: "object", properties, required } });

export const TOOLS = {
  read_brief: TOOL("read_brief", "What the owner put on the booking form, and what the agency owner asks of every site."),
  read_dossier: TOOL("read_dossier", "The research dossier: the company's facts, services, people, projects, reviews, photos (with URLs), competitors, keywords. Compact by default; pass full=true for the crawled site text too.", { full: { type: "boolean" } }),
  set_dossier: TOOL("set_dossier", "Replace or merge the research dossier (researcher only). Pass the fields you found; unknown fields are kept from before.", { dossier: { type: "object" }, merge: { type: "boolean" } }, ["dossier"]),
  label_photos: TOOL("label_photos", "Label photos in the dossier in batches (20 at a time): for each url, what it shows (alt) and its use: hero|project|team|detail|logo|skip. Photos not mentioned keep their current labels.", { photos: { type: "array", items: { type: "object", properties: { url: { type: "string" }, alt: { type: "string" }, use: { type: "string" } }, required: ["url"] } } }, ["photos"]),
  set_hook: TOOL("set_hook", "Set the site's hook strategy: the claim the whole site proves, the flagship project, the proofs, the ask.", { hook: { type: "object" } }, ["hook"]),
  list_components: TOOL("list_components", "Every component in the Awwwards pack and the studio: type, id, kind, weight, what it does, its field shape, and where it fits."),
  component_fields: TOOL("component_fields", "The exact field shape (JSON) for one or more section types, straight from the registry. Call this before writing a section type for the first time.", { types: { type: "array", items: { type: "string" } } }, ["types"]),
  read_site: TOOL("read_site", "The site as it stands: brand, theme, menu, nav, and every page with its section types in order."),
  read_page: TOOL("read_page", "One page in full: its sections with every field.", { slug: { type: "string" } }, ["slug"]),
  write_page: TOOL("write_page", "Write or replace a page: its title and the complete ordered section list, each section in its component's field shape with \"type\" set. Creates the page if it is new. Photos: use real photo URLs from the dossier, or a \"query\" for stock when no real photo fits. Returns what the checks say about the page.", { slug: { type: "string" }, title: { type: "string" }, sections: { type: "array", items: { type: "object" } } }, ["slug", "sections"]),
  remove_page: TOOL("remove_page", "Remove a page from the site.", { slug: { type: "string" } }, ["slug"]),
  set_theme: TOOL("set_theme", "Set brand and theme choices: accent colour, type pair, menu component id, preloader/transition/cursor component ids, logo use.", { theme: { type: "object" }, brand: { type: "object" } }),
  set_nav: TOOL("set_nav", "Set the navigation links: [{label, href (page slug)}] and the footer columns.", { links: { type: "array", items: { type: "object" } }, footer: { type: "object" } }, ["links"]),
  set_seo: TOOL("set_seo", "Set a page's SEO: title (≤60), description (≤155), h1 keyword, schema hints.", { slug: { type: "string" }, seo: { type: "object" } }, ["slug", "seo"]),
  set_page_css: TOOL("set_page_css", "Add CSS for one page's layout nudges. Every section root carries data-sec=\"N\" (1-based), so rules look like [data-sec=\"3\"] h2{text-wrap:balance}. Replaces the page's existing layer. Keep under 60 lines; never hide sections or change fonts/colours.", { slug: { type: "string" }, css: { type: "string" } }, ["slug", "css"]),
  look: TOOL("look", "Render the whole site and open ONE page in a real browser: returns the browser's measurements (overflow, clipped text, broken images, blank sections, script errors) and screenshots (desktop top, each section, phone top). Costs about a minute; use it to see your work.", { slug: { type: "string" } }, ["slug"]),
  run_checks: TOOL("run_checks", "The studio's rules run over the whole site: structure, spine, photo coverage, effect fit, repeated effects. Returns notes, not verdicts."),
  read_board: TOOL("read_board", "Read the team board: what the other agents said and asked."),
  post_note: TOOL("post_note", "Leave a note for another agent (or all). Say what you changed, or what you need from them, in one or two lines.", { to: { type: "string", description: "researcher|architect|writer|pack|motion|art|photo|debugger|seo|reviewer|all" }, text: { type: "string" } }, ["to", "text"]),
  remember: TOOL("remember", "Keep a lesson in your own memory for future sites (one sentence, general, not about this company).", { text: { type: "string" } }, ["text"]),
  done: TOOL("done", "You are finished for this round. Summarise what you did and anything the team should know.", { summary: { type: "string" }, verdict: { type: "string", description: "reviewer only: approve | send-back" }, send_back_to: { type: "array", items: { type: "string" }, description: "reviewer only: roles that must act, with your notes on the board" } }, ["summary"]),
};

/** The tools each role may use. */
export const ROLE_TOOLS: Record<Role, string[]> = {
  researcher: ["read_brief", "read_dossier", "set_dossier", "label_photos", "set_hook", "read_board", "post_note", "remember", "done"],
  architect: ["read_brief", "read_dossier", "list_components", "component_fields", "read_site", "read_page", "write_page", "remove_page", "set_theme", "set_nav", "set_hook", "run_checks", "read_board", "post_note", "remember", "done"],
  writer: ["read_brief", "read_dossier", "component_fields", "read_site", "read_page", "write_page", "run_checks", "read_board", "post_note", "remember", "done"],
  pack: ["read_brief", "read_dossier", "list_components", "component_fields", "read_site", "read_page", "write_page", "set_theme", "run_checks", "look", "read_board", "post_note", "remember", "done"],
  motion: ["read_brief", "list_components", "component_fields", "read_site", "read_page", "write_page", "set_theme", "set_page_css", "look", "run_checks", "read_board", "post_note", "remember", "done"],
  art: ["read_brief", "read_dossier", "list_components", "component_fields", "read_site", "read_page", "write_page", "set_theme", "set_page_css", "look", "run_checks", "read_board", "post_note", "remember", "done"],
  photo: ["read_brief", "read_dossier", "component_fields", "read_site", "read_page", "write_page", "look", "read_board", "post_note", "remember", "done"],
  debugger: ["read_site", "read_page", "component_fields", "write_page", "remove_page", "set_page_css", "look", "run_checks", "read_board", "post_note", "remember", "done"],
  seo: ["read_brief", "read_dossier", "component_fields", "read_site", "read_page", "write_page", "set_seo", "set_nav", "read_board", "post_note", "remember", "done"],
  reviewer: ["read_brief", "read_dossier", "read_site", "read_page", "look", "run_checks", "read_board", "post_note", "remember", "done"],
};

const compact = (o) => JSON.stringify(o, null, 1);
const isUrl = (v) => typeof v === "string" && /^https?:\/\//i.test(v.trim());
const toImg = (v) => isUrl(v) ? { url: v.trim(), alt: "" } : (typeof v === "string" && v.trim()) ? { query: v.trim(), alt: v.trim() } : v;
/** Photos written as plain strings (a URL, or a subject for stock) become the image objects the components expect. */
function normalisePhotos(sec) {
  const out = { ...sec };
  for (const k of ["photo", "picture", "img"]) if (out[k] && !out.image) { out.image = out[k]; delete out[k]; }
  if (out.image && (typeof out.image === "string")) out.image = toImg(out.image);
  for (const k of ["photos", "pictures"]) if (Array.isArray(out[k]) && !out.images) { out.images = out[k]; delete out[k]; }
  if (Array.isArray(out.images)) out.images = out.images.map(v => typeof v === "string" ? toImg(v) : v).filter(Boolean);
  for (const k of ["items", "slides", "steps", "cards"]) if (Array.isArray(out[k])) out[k] = out[k].map(it => { if (!it || typeof it !== "object") return it; const o = { ...it }; for (const kk of ["photo", "picture", "img"]) if (o[kk] && !o.image) { o.image = o[kk]; delete o[kk]; } if (typeof o.image === "string") o.image = toImg(o.image); if (!o.image && !o.query && isUrl(o.url) && !o.href) { o.image = { url: o.url, alt: o.alt || "" }; } return o; });
  return out;
}
const noUndef = (o) => JSON.parse(JSON.stringify(o));

/** Merge photo labels by url: existing entries keep their fields unless the batch sets them; new urls are added. */
function mergePhotos(current, batch) {
  const byUrl = new Map(current.filter(p => p && p.url).map(p => [p.url, { ...p }]));
  for (const b of batch) { if (!b || !b.url) continue; const k = byUrl.get(b.url) || byUrl.get(String(b.url).split("?")[0]); if (k) { if (b.alt) k.alt = b.alt; if (b.use) k.use = b.use; } else byUrl.set(b.url, { url: b.url, alt: b.alt || "", use: b.use || "project" }); }
  return [...byUrl.values()];
}

/** Render every page to storage (preview) so `look` sees the current site. */
export async function renderToPreview(ws: Workspace) {
  enforceBrandWord(ws.spec);
  const rendered = renderSite(ws.spec, { base: ws.previewBase });
  for (const r of rendered) r.html = await minifyAssets(enhanceImages(r.html, new Map()));
  await Promise.all(rendered.map(r => saveHtml(pagePath(ws.job.id, r.slug), r.html)));
  return rendered;
}

function ensureSpec(ws: Workspace) {
  const d = ws.job.dossier || {};
  ws.spec = ws.spec || {};
  ws.spec.brand = ws.spec.brand || { name: d.name || ws.job.lead?.businessName || "", tagline: d.tagline || "", phone: d.phone || "", email: d.email || "", city: d.city || "", accent: "", logo: ws.job.analysis?.logo || null };
  ws.spec.theme = ws.spec.theme || {};
  ws.spec.nav = ws.spec.nav || { menu: "", links: [] };
  ws.spec.pages = ws.spec.pages || [];
  return ws.spec;
}

export function makeTools(ws: Workspace, role: Role) {
  const spec = () => ensureSpec(ws);
  const page = (slug) => spec().pages.find(p => p.slug === slug);
  const impl = {
    read_brief: async () => `THE FORM:\n${compact(ws.job.lead)}\n\nVIDEO: ${ws.job.videoRequested ? "a film of their trade's work is being generated for the home hero (hero-video-scrub); keep the home page opening with it" : "no film this time"}`,
    read_dossier: async ({ full = false } = {}) => { const d = { ...(ws.job.dossier || {}), searchesA: undefined, searchesB: undefined, sources: undefined }; if (!full) { d.siteText = d.siteText ? `(${String(d.siteText).length} chars of their site's text; pass full=true to read it)` : undefined; d.photos = (d.photos || []).map(p => ({ url: p.url, alt: p.alt, use: p.use })); } return compact(d); },
    component_fields: async ({ types }) => (Array.isArray(types) ? types : [types]).map(t => { const c = byType[t]; return c ? `${t} (${c.id}, ${c.kind}, ${c.weight}):\n${c.fields || "(no fields)"}${c.images ? `\nphotos: ${c.images.min}-${c.images.max}` : ""}` : `${t}: unknown type`; }).join("\n\n"),
    set_dossier: async ({ dossier, merge = true }) => {
      const incoming = noUndef(dossier || {});
      const current = ws.job.dossier || {};
      // photos are never dropped by a partial list: labels merge by url, unknown urls are added
      if (Array.isArray(incoming.photos)) incoming.photos = mergePhotos(current.photos || [], incoming.photos);
      ws.job.dossier = merge ? { ...current, ...incoming } : { ...incoming, photos: incoming.photos || current.photos || [] };
      return `dossier ${merge ? "merged" : "replaced"}: ${Object.keys(ws.job.dossier).length} fields, ${(ws.job.dossier.photos || []).length} photos, ${(ws.job.dossier.services || []).length} services, ${(ws.job.dossier.proof || []).length} reviews`;
    },
    label_photos: async ({ photos }) => { const cur = ws.job.dossier?.photos || []; ws.job.dossier = { ...(ws.job.dossier || {}), photos: mergePhotos(cur, Array.isArray(photos) ? photos : []) }; const labelled = ws.job.dossier.photos.filter(p => p.alt && p.use).length; return `labelled; ${labelled} of ${ws.job.dossier.photos.length} photos now have a label and a use`; },
    set_hook: async ({ hook }) => { ws.job.hook = noUndef(hook); return "hook set"; },
    list_components: async () => `${packManifest()}\n\nWHERE EACH EFFECT FITS:\n${fitTable()}\n\nOFFER FOR THIS SITE (different from the last builds; pick from these first):\n${compact(offerFor(ws.job.id, 1, ws.job.qa?.avoid || {}))}`,
    read_site: async () => { const s = spec(); return compact({ brand: s.brand, theme: s.theme, nav: s.nav, hook: ws.job.hook, pages: s.pages.map(p => ({ slug: p.slug, title: p.title, sections: p.sections.map((x, i) => `${i + 1}. ${x.type}${x.image?.url || x.images?.length ? " [photo]" : ""}`), css: p.debugCss ? "has css layer" : undefined, seo: p.seo ? "set" : undefined })) }); },
    read_page: async ({ slug }) => { const p = page(slug); if (!p) return `no page "${slug}". Pages: ${spec().pages.map(x => x.slug).join(", ")}`; return compact({ slug: p.slug, title: p.title, sections: p.sections.map(s => { const c = { ...s }; delete c.component; return c; }), css: p.debugCss || "", seo: p.seo || {} }); },
    write_page: async ({ slug, title, sections }) => {
      if (!Array.isArray(sections) || !sections.length) return "error: sections must be a non-empty array";
      const bad = sections.filter(s => !s || !byType[s.type]).map(s => s?.type);
      if (bad.length) return `error: unknown section type(s): ${bad.join(", ")}. Use list_components for the exact types.`;
      const s = spec(); let p = page(slug);
      if (!p) { p = { slug, title: title || slug, sections: [] }; s.pages.push(p); }
      if (title) p.title = title;
      p.sections = sections.map(x => ({ ...normalisePhotos(noUndef(x)), component: byType[x.type].id }));
      resolveImages(p, ws.cat, ws.job.dossier?.photos || []);
      const notes = fitErrorsWritten([p]);
      ws.stamp(`${role}: wrote ${slug}: ${p.sections.length} sections`);
      return `written: ${slug} (${p.sections.length} sections)${notes.length ? "\nchecks: " + notes.join("; ") : "\nchecks: fine"}`;
    },
    remove_page: async ({ slug }) => { const s = spec(); const n = s.pages.length; s.pages = s.pages.filter(p => p.slug !== slug); return s.pages.length < n ? `removed ${slug}` : `no page ${slug}`; },
    set_theme: async ({ theme, brand }) => { const s = spec(); if (theme) s.theme = { ...s.theme, ...noUndef(theme) }; if (brand) s.brand = { ...s.brand, ...noUndef(brand) }; if (theme?.menu) s.nav.menu = theme.menu; return `theme: ${compact(s.theme)}\nbrand: ${compact({ ...s.brand, logo: s.brand.logo ? "set" : null })}`; },
    set_nav: async ({ links, footer }) => { const s = spec(); s.nav.links = noUndef(links); if (footer) s.footer = noUndef(footer); return `nav: ${links.length} links`; },
    set_seo: async ({ slug, seo }) => { const p = page(slug); if (!p) return `no page ${slug}`; p.seo = { ...(p.seo || {}), ...noUndef(seo) }; return `seo set on ${slug}`; },
    set_page_css: async ({ slug, css }) => { const p = page(slug); if (!p) return `no page ${slug}`; const c = String(css || "").trim(); if (c.length > 6000 || /<\/?script|expression\(|@import|url\(/i.test(c)) return "error: css rejected (too long or unsafe)"; p.debugCss = c; return `css set on ${slug} (${c.split("\n").length} lines)`; },
    look: async ({ slug }) => {
      const s = spec(); if (!page(slug)) return `no page "${slug}"`;
      await renderToPreview(ws);
      const rep = await inspectSite({ id: ws.job.id, origin: ws.origin, slugs: [slug], logoExpected: Boolean(s.brand?.logo?.url), round: 200 + ws.round, stamp: () => {}, maxInner: 1, homeOnly: slug === "index" });
      const pages = (rep.pages || []).filter(p => p.slug === slug);
      const facts = pages.map(p => `${p.viewport}: ${p.loadError ? "DID NOT LOAD: " + p.loadError : `overflow ${p.overflowPx || 0}px${p.overflowBy?.length ? " (" + p.overflowBy.slice(0, 3).join(", ") + ")" : ""}, clipped text ${(p.clippedText || []).length}${p.clippedText?.length ? " (" + p.clippedText.slice(0, 2).join(" | ") + ")" : ""}, broken images ${(p.brokenImages || []).length}${p.brokenImages?.length ? " (" + p.brokenImages.slice(0, 3).join(", ") + ")" : ""}, blank sections ${(p.blankSections || []).length}, tiny text ${p.tinyText || 0}, script errors ${(p.consoleErrors || []).length}${p.consoleErrors?.length ? " (" + p.consoleErrors[0].slice(0, 120) + ")" : ""}${typeof p.longFramePct === "number" ? ", long frames " + p.longFramePct + "% (headless CPU; real devices are smoother)" : ""}`}`).join("\n");
      const images = [];
      for (const p of pages) for (const x of (p.shots || []).filter(x => x.data).slice(0, p.viewport === "desktop" ? 10 : 2)) images.push({ label: `${slug} · ${p.viewport} · ${x.name}`, data: x.data });
      return { text: `LOOKED AT ${slug}:\n${facts}\nPreview: ${ws.origin}${ws.previewBase}${slug === "index" ? "" : "/" + slug}`, images };
    },
    run_checks: async () => {
      const s = spec(); const job = { ...ws.job, plan: { pages: s.pages.map(p => ({ slug: p.slug, title: p.title, sections: p.sections.map(x => ({ ...x, photos: x.image?.url ? [x.image.url] : (x.images || []).map(i => i?.url).filter(Boolean) })) })), theme: s.theme, nav: s.nav }, pages: s.pages, dossier: ws.job.dossier };
      let out = [];
      try { const g = gatePlan(job, ws.job.qa?.recent || []); out.push(...g.errors.map(e => "structure: " + e), ...g.warnings.map(w => "structure note: " + w)); } catch (e) { out.push(`structure check failed: ${e?.message}`); }
      try { const g = gatePages(job); out.push(...g.errors.map(e => "pages: " + e), ...g.warnings.map(w => "pages note: " + w)); } catch (e) { out.push(`page check failed: ${e?.message}`); }
      return out.length ? out.join("\n") : "all checks fine";
    },
    read_board: async () => ws.board.render(role),
    post_note: async ({ to, text }) => { ws.board.post(ws.round, role, to, text); return "posted"; },
    remember: async ({ text }) => { (ws.memoryAdds[role] = ws.memoryAdds[role] || []).push(String(text).slice(0, 300)); return "kept"; },
  };
  const allowed = ROLE_TOOLS[role];
  return {
    defs: allowed.map(n => TOOLS[n]).filter(Boolean),
    call: async (name, input) => { if (!allowed.includes(name)) return `error: ${name} is not one of your tools`; const f = impl[name]; if (!f) return `error: unknown tool ${name}`; return f(input || {}); },
  };
}
