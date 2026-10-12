// @ts-nocheck
// The foreman. Not a brain: a schedule. It gives each agent the floor in
// turn, keeps the shared workspace, runs the rounds until the reviewer signs
// off (or the rounds or the money run out), then does the deterministic
// finish: wait for the film, optimise the photos, render, zip, ask each agent
// what it learned, publish, email the owner.
import { crawlSite, fetchBinary } from "../build/analyze";
import { createHash } from "node:crypto";
import { cleanWebsite } from "../build/url";
import { structured, parseJson, addUsage, costOf, describeError, MODEL } from "../build/claude";
import { leadRecord, enforceBrandWord, withTimeout, type BuildJob } from "../build/pipeline";
import { blobConfigured, buildPath, pagePath, saveBinary, saveHtml, saveJson } from "../build/storage";
import { renderSite, componentsUsed } from "../build/renderer";
import { countOwnPhotos } from "../build/images";
import { optimizeImages, enhanceImages, minifyAssets } from "../build/optimize";
import { videoConfigured, chooseSourceImage, findBeforeAfter, waitForVideo } from "../build/video";
import { sendBuildReady, sendBuildFailed } from "../build/emails";
import { publishSite, publishConfigured } from "../build/publish";
import { ROLES, ROLE_TITLE, keyFor, ownKey, teamModel, type Role } from "./keys";
import { loadMemory, saveMemory, mergeMemory, memoryBlock } from "./memory";
import { Board } from "./board";
import { makeTools, renderToPreview, type Workspace } from "./tools";
import { systemFor } from "./roles";
import { runAgent } from "./agent";

const DEFAULT_ROUND_ONE: Role[] = ["architect", "writer", "pack", "motion", "art", "photo", "seo", "debugger", "reviewer"];
/** Limits: from the job's teamOpts (dev tests) or the environment. */
const limits = (job) => { const o = job.teamOpts || {}; return {
  rounds: Number(o.rounds || process.env.TEAM_ROUNDS || 3),
  steps: Number(o.steps || process.env.TEAM_MAX_STEPS || 40),
  agentCost: Number(o.agentCost || process.env.TEAM_AGENT_MAX_COST || 10),
  teamCost: Number(o.teamCost || process.env.TEAM_MAX_COST || 90),
  roundOne: (String(o.roles || process.env.TEAM_ROLES || "").split(",").map(x => x.trim()).filter(x => ROLES.includes(x)) as Role[]),
}; };

function stamp(job: BuildJob, msg: string) {
  const line = `${new Date().toISOString().slice(11, 19)} ${msg}`;
  job.log = job.log || []; job.log.push(line);
  console.log(`[team ${job.id.slice(0, 8)}] ${msg}`);
}

async function agentTurn(job: BuildJob, ws: Workspace, role: Role, task: string) {
  const memory = await loadMemory(role);
  const system = systemFor(role, memory, ws.board.render(role));
  const tools = makeTools(ws, role);
  const serverTools = role === "researcher" ? [{ type: "web_search_20250305", name: "web_search", max_uses: Number(process.env.TEAM_RESEARCH_SEARCHES || 10) }] : [];
  const t0 = Date.now();
  stamp(job, `${ROLE_TITLE[role]} starts (round ${ws.round}${ownKey(role) ? ", own key" : ", studio key"})`);
  await leadRecord(job, "team", { teamRole: role, teamRound: ws.round });
  const L = limits(job);
  const maxCost = role === "researcher" ? Number(process.env.TEAM_RESEARCH_MAX_COST || Math.max(L.agentCost, 20)) : L.agentCost;
  const r = await runAgent({ role, model: teamModel(role), apiKey: keyFor(role), system, task, tools: { ...tools, serverTools }, maxSteps: L.steps, maxCost, stamp: (m) => stamp(job, m) });
  job.teamCost = job.teamCost || {}; job.teamCost[role] = (job.teamCost[role] || 0) + r.cost;
  job.usage = addUsage(job.usage, r.usage ? { input_tokens: 0, output_tokens: 0 } : null);
  job.teamUsage = job.teamUsage || {}; job.teamUsage[role] = addUsage(job.teamUsage[role], null);
  if (r.usage) { job.teamUsage[role] = r.usage; }
  const summary = String(r.done?.summary || "").slice(0, 600);
  stamp(job, `${ROLE_TITLE[role]} done: ${r.steps} steps, ${r.seconds} s, $${r.cost.toFixed(2)} · ${summary}`);
  ws.board.post(ws.round, role, "all", `done: ${summary}`);
  await ws.board.save();
  return r;
}

const totalCost = (job) => Object.values(job.teamCost || {}).reduce((a: number, b: number) => a + b, 0);

/** Phase 1: the crawler reads their site; the researcher builds the dossier and the hook. */
export async function teamResearch(job: BuildJob): Promise<boolean> {
  try {
    await leadRecord(job, "research");
    job.videoRequested = videoConfigured();
    const cleaned = cleanWebsite(job.lead.website); if (cleaned !== (job.lead.website || "")) job.lead.website = cleaned;
    let analysis = null;
    if (job.lead.website) {
      try { analysis = await crawlSite(job.lead.website, { maxPages: 20 }); stamp(job, `read ${analysis.domain}${analysis.rendered ? " in a real browser" : analysis.relayed ? " through the relay" : ""}: ${1 + analysis.pages.length} pages, ${analysis.totalWords} words, ${analysis.images.length} photos, logo ${analysis.logo ? "found" : "none"}`); }
      catch (e) { stamp(job, `could not read ${job.lead.website}: ${describeError(e)}; the researcher works from search and the form`); job.researchNotes = [...(job.researchNotes || []), `Their website could not be read (${describeError(e).slice(0, 120)}).`]; }
    }
    job.analysis = analysis ? { url: analysis.url, domain: analysis.domain, title: analysis.title, logo: analysis.logo, colors: analysis.colors, fonts: analysis.fonts, social: analysis.social, phone: analysis.phone, email: analysis.email, address: analysis.address, nav: analysis.nav, pagesRead: analysis.pages.map(p => p.url) } : null;
    // a seed dossier from the crawl: the researcher enriches it
    job.dossier = { name: analysis?.title?.split(/[|\-–]/)[0]?.trim() || job.lead.businessName || "", phone: analysis?.phone || job.lead.phone || "", email: analysis?.email || "", address: analysis?.address || "", social: analysis?.social || {}, siteText: analysis ? [analysis.description, ...(analysis.headings || []).slice(0, 30), ...analysis.pages.slice(0, 12).map(p => `--- ${p.title} (${p.url})\n${(p.text || "").slice(0, 2500)}`)].filter(Boolean).join("\n") : "", photos: (analysis?.images || []).map(i => ({ url: i.url, alt: i.alt || i.page || "", use: "project" })).slice(0, 120), services: [], projects: [], proof: [] };
    await rehostPhotos(job);
    const ws = await workspace(job);
    const task = `Build the dossier and the hook for ${job.lead.businessName || job.dossier.name}. In this order, because your budget is limited:
1. read_brief, then read_dossier (the crawl already put their site's text, contact details and ${job.dossier.photos.length} photo URLs in it).
2. Search the web (at most ${Number(process.env.TEAM_RESEARCH_SEARCHES || 10)} searches): reviews with real names, licence, years in business, the people, named projects, the competitors, the keywords buyers use.
3. set_dossier (merge) with the facts: name, industry, city, services[{name,slug,detail}], team, projects, proof[{quote,name,source}], serviceArea, licence, credentials, differentiators, faq, competitors, keywords.
4. set_hook: the claim, the flagship project, five proofs, the ask.
5. Only then label photos with label_photos in batches of 20 (what each shows, use hero|project|team|detail|skip); if the budget runs low, label the first 40 and stop.
Finish with done.`;
    const rr = await agentTurn(job, ws, "researcher", task);
    if (rr.noCredits) throw new Error("the Researcher's API account (the studio key) has no credits; top it up and book again");
    if (!job.dossier?.name) job.dossier.name = job.lead.businessName;
    if (!job.hook?.hook?.claim && !job.hook?.claim) stamp(job, "researcher left no hook; the architect will set one");
    job.videoSource = chooseSourceImage(job);
    job.videoKind = findBeforeAfter(job) ? "transformation" : "film";
    await Promise.all([saveJson(buildPath(job.id, "dossier.json"), job.dossier), saveJson(buildPath(job.id, "hook.json"), job.hook || {})]);
    await leadRecord(job, "plan");
    return true;
  } catch (e) {
    stamp(job, `research failed: ${describeError(e)}`);
    await leadRecord(job, "failed", { error: `research: ${describeError(e)}` });
    try { await sendBuildFailed({ job, step: "research", message: describeError(e) }); } catch {}
    return false;
  }
}

/** Copies of their photos on our storage, so every later look, the optimiser and the film generator can reach them even when their host blocks the build servers. */
async function rehostPhotos(job: BuildJob, { max = 90, concurrency = 4, budgetMs = 150_000 } = {}) {
  const photos = (job.dossier?.photos || []).slice(0, max);
  if (!photos.length) return;
  const t0 = Date.now(); let i = 0, ok = 0, failed = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, photos.length) }, async () => {
    while (i < photos.length) {
      const p = photos[i++];
      if (Date.now() - t0 > budgetMs || !p?.url || /blob\.vercel-storage\.com/.test(p.url)) continue;
      try {
        const got = await fetchBinary(p.url, { timeout: 15000 });
        if (!got || !/^image\//i.test(got.type)) { failed++; continue; }
        const ext = /png/i.test(got.type) ? "png" : /webp/i.test(got.type) ? "webp" : "jpg";
        const url = await saveBinary(buildPath(job.id, `photos/${createHash("sha1").update(p.url).digest("hex").slice(0, 12)}.${ext}`), got.buf, got.type);
        if (url) { p.original = p.url; p.url = url; ok++; } else failed++;
      } catch { failed++; }
    }
  }));
  stamp(job, `their photos copied to our storage: ${ok} of ${photos.length}${failed ? `, ${failed} could not be fetched` : ""} (${Math.round((Date.now() - t0) / 1000)} s)`);
}

async function workspace(job: BuildJob): Promise<Workspace> {
  const board = new Board(job.id);
  const previewBase = `/preview/${job.id}`;
  return { job, spec: job.spec || null, board, origin: job.origin, previewBase, stamp: (m) => stamp(job, m), round: 0, memoryAdds: {}, cat: "generic" };
}

/** Phase 2: the rounds. */
export async function teamBuild(job: BuildJob): Promise<boolean> {
  const ws = await workspace(job);
  try {
    const biz = job.lead.businessName || job.dossier?.name;
    const L = limits(job);
    let approved = false;
    let next: Role[] = L.roundOne.length ? L.roundOne : DEFAULT_ROUND_ONE;
    for (let round = 1; round <= L.rounds && !approved; round++) {
      ws.round = round;
      stamp(job, `round ${round}: ${next.map(r => ROLE_TITLE[r]).join(" → ")}`);
      for (const role of next) {
        if (totalCost(job) > L.teamCost) { stamp(job, `team budget reached ($${totalCost(job).toFixed(2)}); finishing with the site as it stands`); break; }
        const task = round === 1
          ? `Round 1 for ${biz}. ${role === "architect" ? "There is no site yet: create it page by page with write_page (drafts with real facts), set the theme and the nav, then run_checks." : role === "reviewer" ? "Judge the site as it stands; approve or send back with names and notes." : "Do your part on the site as it stands; read the board first."}`
          : `Round ${round} for ${biz}. The reviewer sent the site back. Read the board for the notes addressed to you, act on each (and only those), look at what you changed, then done.`;
        const r = await agentTurn(job, ws, role, task);
        if (r.noCredits) { job.noCredits = [...(job.noCredits || []), role]; if (role === "architect" && !ws.spec?.pages?.length) throw new Error(`the Architect's API account has no credits, so no site could be started; top up the accounts (${job.noCredits.join(", ")})`); continue; }
        if (role === "reviewer") {
          const verdict = String(r.done?.verdict || "").toLowerCase();
          if (verdict.startsWith("approve")) { approved = true; stamp(job, `reviewer approved in round ${round}`); }
          else {
            const back = (Array.isArray(r.done?.send_back_to) ? r.done.send_back_to : []).map(x => String(x).toLowerCase()).filter(x => ROLES.includes(x) && x !== "reviewer");
            next = back.length ? [...new Set([...back, "debugger", "reviewer"])] : ["debugger", "reviewer"];
            stamp(job, `reviewer sent it back to ${next.slice(0, -1).map(x => ROLE_TITLE[x]).join(", ")}`);
          }
        }
        job.spec = ws.spec;
        await saveJson(buildPath(job.id, "spec.json"), ws.spec || {}).catch(() => {});
      }
      if (totalCost(job) > L.teamCost) break;
    }
    if (!ws.spec?.pages?.length) throw new Error("the team produced no pages");
    job.spec = ws.spec; job.teamApproved = approved; job.memoryAdds = ws.memoryAdds; job.boardNotes = ws.board.notes;
    stamp(job, `rounds finished: ${approved ? "approved" : "not approved; delivering the best version with the reviewer's notes"} · team cost $${totalCost(job).toFixed(2)}`);
    await leadRecord(job, "review", { teamApproved: approved });
    return true;
  } catch (e) {
    stamp(job, `team build failed: ${describeError(e)}`);
    await leadRecord(job, "failed", { error: `team: ${describeError(e)}` });
    try { await sendBuildFailed({ job, step: "design", message: describeError(e) }); } catch {}
    return false;
  }
}

/** Phase 3: the film, the photos, the render, the memories, the publish, the email. */
export async function teamFinish(job: BuildJob): Promise<boolean> {
  const previewBase = `/preview/${job.id}`;
  const previewUrl = blobConfigured() ? `${job.origin}${previewBase}` : "";
  try {
    await leadRecord(job, "finish");
    const spec = job.spec;
    if (!spec?.pages?.length) throw new Error("no site to finish");
    if (job.videoRequested) {
      const vm = await waitForVideo(job.id, Number(process.env.VIDEO_WAIT_MS || 20 * 60_000));
      if (vm && vm.status === "ready") { spec.video = vm; stamp(job, `hero film ready: ${vm.mode}, ${vm.count || 0} frames`); }
      else stamp(job, `hero film ${vm ? vm.status + (vm.error ? ": " + vm.error : "") : "not ready in time"}; the home page opens on their best photo`);
    }
    if (!spec.video) for (const p of spec.pages) for (const s of p.sections) if (s.type === "hero-video-scrub") { s.type = "hero-split"; s.component = "scroll-41"; }
    enforceBrandWord(spec);
    const { map: imgMap, report } = await optimizeImages(spec, job.id, { budgetMs: 150_000 });
    stamp(job, `photos optimised: ${report.count} re-encoded, ${report.skipped} skipped`);
    const rendered = renderSite(spec, { base: previewBase });
    const exported = renderSite(spec, { base: "" });
    for (const set of [rendered, exported]) for (const r of set) r.html = await minifyAssets(enhanceImages(r.html, imgMap));
    await Promise.all(rendered.map(r => saveHtml(pagePath(job.id, r.slug), r.html)));
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    for (const x of exported) zip.file(x.slug === "index" ? "index.html" : `${x.slug}/index.html`, x.html);
    const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    await Promise.all([saveJson(buildPath(job.id, "spec.json"), spec), saveBinary(buildPath(job.id, "site.zip"), zipBuf, "application/zip"), saveJson(buildPath(job.id, "team/board.json"), { notes: job.boardNotes || [] })]);
    // each agent keeps what it learned
    await updateMemories(job);
    // publish
    if (publishConfigured()) {
      try { const pub = await withTimeout(publishSite({ business: job.lead.businessName || spec.brand.name, id: job.id, pages: exported, extra: { "robots.txt": "User-agent: *\nAllow: /\n" }, stamp: (m) => stamp(job, m) }), 6 * 60_000, "publishing to Vercel"); job.publishedUrl = pub.url; }
      catch (e) { job.publishNote = describeError(e); stamp(job, `publish: ${job.publishNote}; the preview stands`); }
    } else { job.publishNote = "VERCEL_TOKEN is not set on the build servers"; stamp(job, "publish skipped: VERCEL_TOKEN is not set"); }
    const reviewerNotes = (job.boardNotes || []).filter(n => n.from === "reviewer" && n.to !== "all").map(n => `${n.to}: ${n.text}`).slice(-8);
    job.needsLook = job.teamApproved ? [] : reviewerNotes;
    job.debugNotes = (job.boardNotes || []).filter(n => n.from === "debugger" && n.to === "all").map(n => n.text.replace(/^done:\s*/, "")).slice(-4);
    const cost = Object.values(job.teamCost || {}).reduce((a: number, b: number) => a + b, 0);
    stamp(job, `team cost: ${Object.entries(job.teamCost || {}).map(([r, c]) => `${ROLE_TITLE[r]} $${Number(c).toFixed(2)}`).join(", ")} · total $${cost.toFixed(2)}`);
    const pages = exported.map(x => ({ slug: x.slug, title: x.title }));
    await leadRecord(job, "done", { previewUrl, publishedUrl: job.publishedUrl, publishNote: job.publishNote, debugNotes: job.debugNotes, needsLook: job.needsLook, pages: pages.map(p => p.slug), cost, hero: spec.pages[0]?.sections?.[0]?.component, menu: spec.nav?.menu, mode: "team", teamCost: job.teamCost });
    try { await sendBuildReady({ job, spec, pages, components: componentsUsed(spec), ownPhotos: countOwnPhotos(spec), previewUrl, zip: zipBuf, model: MODEL }); stamp(job, "owner emailed"); } catch (e) { stamp(job, `ready email: ${describeError(e)}`); }
    await saveJson(buildPath(job.id, "journal.json"), job.log || []).catch(() => {});
    return true;
  } catch (e) {
    stamp(job, `finish failed: ${describeError(e)}`);
    await leadRecord(job, "failed", { error: `finish: ${describeError(e)}` });
    try { await sendBuildFailed({ job, step: "finish", message: describeError(e) }); } catch {}
    return false;
  }
}

/** Ask each agent that worked for the lessons worth keeping; merge into its memory. */
async function updateMemories(job: BuildJob) {
  const worked = Object.keys(job.teamCost || {}) as Role[];
  const board = (job.boardNotes || []).map(n => `r${n.round} · ${n.from} → ${n.to}: ${n.text}`).join("\n").slice(0, 12000);
  const date = new Date().toISOString().slice(0, 10);
  const from = `${job.lead.businessName || job.dossier?.name || "a site"}, ${date}`;
  await Promise.all(worked.map(async (role) => {
    try {
      const old = await loadMemory(role);
      const adds = (job.memoryAdds?.[role] || []).map(text => ({ text, from, date }));
      const { text } = await structured({ system: `You are the ${ROLE_TITLE[role]} on a web studio team, writing your own memory file at the end of a build. From the board (what everyone said and what the reviewer sent back) and your current memory, write at most 3 new lessons that will make YOUR next site better: general, one sentence each, no company names. Also list the numbers of current entries that are now wrong or redundant. Return ONLY JSON: {"lessons":["..."],"drop":[1,2]}`, user: `${memoryBlock(old)}\n\nTHE BOARD:\n${board || "(empty)"}\n\nAPPROVED: ${Boolean(job.teamApproved)}`, schema: null, effort: "low", maxTokens: 3000, model: teamModel(role), apiKey: keyFor(role) });
      const out = parseJson(text) || {};
      const drop = new Set((Array.isArray(out.drop) ? out.drop : []).map(Number));
      const kept = old.filter((_, i) => !drop.has(i + 1));
      const merged = mergeMemory(kept, [...adds, ...(Array.isArray(out.lessons) ? out.lessons.filter(Boolean).map(t => ({ text: String(t).slice(0, 300), from, date })) : [])]);
      await saveMemory(role, merged);
      stamp(job, `${ROLE_TITLE[role]} remembers ${merged.length} lesson${merged.length === 1 ? "" : "s"}`);
    } catch (e) { stamp(job, `${ROLE_TITLE[role]}: memory not updated (${describeError(e)})`); }
  }));
}
