/* =====================================================================
   Unifictional Studio · studio.js  (the app)
   Build: read -> research -> plan+write -> assemble -> SEO.
   Claude mode: api/research (web search + crawl) -> api/generate (spec from
   the dossier) -> api/seo. Local mode (no key): the rule engine, clearly
   labelled as a preview. Same spec contract, same renderer.
   ===================================================================== */
import { render } from "./renderer.js";
import { briefFromAnalysis, briefFromPrompt, specFromBrief, resolveImages, packPicks, applyEdit, INDUSTRIES, detectIndustry } from "./engine.js";
import { audit, keywordPlan, fix as seoFix } from "./seo.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const esc = (s = "") => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = { spec: null, html: "", analysis: null, dossier: null, audit: null, plan: [], notes: [], engine: "checking", busy: false, t0: 0, codeView: "html", source: "local" };
const ui = {
  start: $("#start"), steps: $("#steps"), log: $("#log"), agent: $("#agent"), frame: $("#frame"), frameWrap: $("#frameWrap"), empty: $("#empty"), banner: $("#banner"),
  chat: $("#chat"), chatInput: $("#chatInput"), chatSend: $(".chat__send"), engine: $("#engine"), picks: $("#picks"), libgrid: $("#libgrid"), brief: $("#brief"),
  ring: $("#ring"), scoreNum: $("#scoreNum"), scoreLabel: $("#scoreLabel"), scoreSub: $("#scoreSub"), checks: $("#checks"), kws: $("#kws"), notes: $("#seoNotes"), seoPill: $("#seoPill"),
  code: $("#code"), projectName: $("#projectName"), projectKind: $("#projectKind"), previewUrl: $("#previewUrl"), previewMeta: $("#previewMeta"), elapsed: $("#elapsed"),
};

/* ----------------------------------------------------------- engine */
async function detectEngine() {
  try {
    const r = await fetch("/api/health", { cache: "no-store" });
    const j = await r.json();
    state.engine = j.mode === "claude" ? "claude" : "local";
    if (j.model) ui.previewMeta.textContent = j.model;
  } catch { state.engine = "static"; }
  ui.engine.className = "engine " + (state.engine === "claude" ? "is-claude" : "is-local");
  ui.engine.querySelector("span").textContent = state.engine === "claude" ? "Engine: Claude" : state.engine === "local" ? "Engine: preview" : "Engine: preview (static)";
  ui.engine.title = state.engine === "claude" ? "Claude researches the business and writes the site spec; the renderer assembles it from the pack." : "No model key on the server. The preview engine builds a generic spec; add ANTHROPIC_API_KEY for researched, personal sites.";
  ui.banner.classList.toggle("is-hidden", state.engine === "claude");
}

/* --------------------------------------------------------------- ui */
function setStep(id, status, note) {
  const el = $(`[data-step="${id}"]`, ui.steps);
  if (!el) return;
  el.classList.remove("is-active", "is-done", "is-error");
  if (status) el.classList.add("is-" + status);
  if (note !== undefined) el.querySelector("small").textContent = note;
}
function stepLine(id, text) {
  const el = $(`[data-step="${id}"] div`, ui.steps); if (!el) return;
  const s = document.createElement("span"); s.className = "search"; s.textContent = text; el.appendChild(s);
  const lines = $$(".search", el); if (lines.length > 6) lines[0].remove();
}
function msg(html, cls = "is-agent") {
  const d = document.createElement("div");
  d.className = "msg " + cls; d.innerHTML = html;
  ui.log.appendChild(d); ui.agent.scrollTop = ui.agent.scrollHeight; return d;
}
function tick() { if (!state.t0) return; const s = Math.floor((Date.now() - state.t0) / 1000); ui.elapsed.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; }
setInterval(tick, 500);

const STEPS = [
  ["read", "Read", "Fetch the site and extract what matters"],
  ["research", "The Conversation", "Read their pages, search reviews, competitors, local phrasing"],
  ["plan", "The Build", "Choose components and write the copy from the dossier"],
  ["assemble", "Assemble", "Render the page, premium never generic"],
  ["seo", "The System", "SEO agent: audit, keyword plan, fixes"],
];
function showSteps() {
  ui.start.classList.add("is-hidden");
  ui.steps.classList.remove("is-hidden");
  ui.steps.innerHTML = STEPS.map(([id, t, d]) => `<li class="step" data-step="${id}"><i></i><div><b>${t}</b><small>${d}</small></div><span class="mono"></span></li>`).join("");
}

/* ------------------------------------------------------------ build */
async function build({ url, prompt, instruction }) {
  if (state.busy) return;
  state.busy = true; state.t0 = Date.now(); state.spec = null; state.audit = null; state.plan = []; state.notes = []; state.dossier = null; state.analysis = null;
  showSteps(); ui.log.innerHTML = "";
  ui.frameWrap.classList.add("is-building");
  ui.projectKind.textContent = url ? "Rebuild" : "New build";
  ui.projectName.textContent = url ? url.replace(/^https?:\/\//, "").replace(/\/$/, "") : "From a brief";
  msg(`<span class="mono">You</span>${esc(url ? `Rebuild ${url}` : prompt)}${instruction ? `<small>${esc(instruction)}</small>` : ""}`, "is-user");

  try {
    /* 1. read */
    setStep("read", "active");
    let analysis = null;
    if (url) {
      if (state.engine === "static") throw new Error("Analyzing a URL needs the API on the server. Run the dev server or deploy, or start from a brief.");
      const r = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Could not read that site.");
      analysis = j.analysis; state.analysis = analysis;
      setStep("read", "done", `${analysis.domain} · ${analysis.wordCount} words · ${analysis.headings.length} headings · ${analysis.links.length} internal links · ${analysis.images.length} photos`);
      msg(`<b>Read ${esc(analysis.domain)}.</b> ${esc(analysis.title || "")}<ul>${analysis.description ? `<li>${esc(analysis.description.slice(0, 160))}</li>` : ""}<li>${analysis.phone ? "Phone found" : "No phone"} · ${analysis.email ? "email found" : "no email"} · ${analysis.city ? esc(analysis.city) : "no city on the home page"}${analysis.colors.length ? ` · colours ${analysis.colors.slice(0, 3).join(" ")}` : ""}</li><li>Existing page: ${analysis.existingSeo.h1Count} H1, ${analysis.existingSeo.altMissing} images without alt, ${analysis.hasSchema ? "has" : "no"} schema</li></ul>`);
    } else {
      await sleep(250);
      setStep("read", "done", `Brief: ${prompt.length} chars`);
    }

    /* 2. research */
    setStep("research", "active");
    let dossier = null;
    if (state.engine === "claude") {
      dossier = await researchWithClaude({ analysis, prompt });
      state.dossier = dossier;
    }
    if (dossier) {
      setStep("research", "done", `${(dossier.searches || []).length} searches · ${(dossier.pagesRead || []).length} pages read · ${(dossier.proof || []).length} reviews · ${(dossier.competitors || []).length} competitors`);
      renderBrief();
      msg(`<b>Research done.</b> ${esc(dossier.positioning || "")}<ul>${(dossier.differentiators || []).slice(0, 3).map(d => `<li>${esc(d)}</li>`).join("")}${dossier.gaps?.length ? `<li><i>Could not find: ${esc(dossier.gaps.slice(0, 2).join("; "))}</i></li>` : ""}</ul>`);
    } else {
      setStep("research", "done", state.engine === "claude" ? "Skipped (research failed); designing from the page alone" : "Skipped: preview engine (no model key)");
    }

    /* 3. design (plan + write) */
    setStep("plan", "active");
    let spec; state.source = "local";
    if (state.engine === "claude") {
      try { spec = await generateWithClaude({ dossier, analysis, prompt, instruction }); if (spec) state.source = "claude"; }
      catch (e) { msg(`<b>Claude could not design the site:</b> ${esc(e.message)} Falling back to the preview engine so you still get a page.`, "is-agent is-err"); }
    }
    if (!spec) {
      await sleep(300);
      const brief = analysis ? briefFromAnalysis(analysis) : briefFromPrompt(prompt);
      if (analysis?.colors?.length && !instruction?.toLowerCase().includes("color")) { const c = analysis.colors.find(h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); return Math.max(r, g, b) - Math.min(r, g, b) > 60; }); if (c) brief.accent = c; }
      spec = specFromBrief(brief, { accent: brief.accent });
      if (instruction) spec = applyEdit(spec, instruction).spec;
    }
    spec = normalize(spec);
    state.spec = spec;
    const picks = packPicks(spec);
    renderPicks(picks);
    const words = JSON.stringify(spec.sections).split(/\s+/).length;
    setStep("plan", "done", `${picks.length} components · ${spec.sections.length} sections · ~${words} words · ${spec.theme.pair} type · ${spec.theme.mode}, accent ${spec.theme.accent}`);
    msg(`<b>${state.source === "claude" ? "Claude designed the site." : "Preview engine built the site."}</b> ${esc(spec.brand.name)}: ${esc(spec.brand.industry)}${spec.brand.city ? " in " + esc(spec.brand.city) : ""}.${spec.rationale ? `<p>${esc(spec.rationale)}</p>` : `<ul>${picks.slice(0, 4).map(p => `<li><b>${p.id}</b> · ${esc(p.why)}</li>`).join("")}</ul>`}`);
    renderBrief();

    /* 4. assemble */
    setStep("assemble", "active");
    ui.projectName.textContent = spec.brand.name;
    await preview(spec);
    setStep("assemble", "done", `${(state.html.length / 1024).toFixed(0)} KB · GSAP + ScrollTrigger + Lenis · ${countOwnPhotos(spec)} of the company's own photos used`);

    /* 5. seo */
    setStep("seo", "active");
    await runSeo({ withModel: state.source === "claude" });
    setStep("seo", "done", `Score ${state.audit.score}/100 · ${state.plan.length} keywords`);
    msg(`<b>The System (SEO agent):</b> scored <b>${state.audit.score}/100</b> before fixes. ${state.audit.checks.filter(c => c.status !== "pass").length} items flagged, ${state.audit.checks.filter(c => c.fixable && c.status !== "pass").length} auto-fixable. Press <b>Fix everything it can</b> in the SEO tab, or ask me here.`);
    ui.chatInput.disabled = false; ui.chatSend.disabled = false;
    $("#btnExport").disabled = false; $("#btnPublish").disabled = false; $("#btnFixAll").disabled = false; $("#btnReaudit").disabled = false;
  } catch (e) {
    const active = $(".step.is-active", ui.steps);
    if (active) setStep(active.dataset.step, "error", e.message);
    msg(`<b>Stopped.</b> ${esc(e.message)}`, "is-agent is-err");
    ui.start.classList.remove("is-hidden");
  } finally {
    state.busy = false; ui.frameWrap.classList.remove("is-building");
  }
}
const countOwnPhotos = (spec) => { let n = 0; for (const s of spec.sections) { if (s.image?.url && !/unsplash/.test(s.image.url)) n++; (s.images || []).forEach(i => { if (i.url && !/unsplash/.test(i.url)) n++; }); if (s.type === "gallery") (s.items || []).forEach(i => { if (i.image?.url && !/unsplash/.test(i.image.url)) n++; }); } return n; };

async function researchWithClaude({ analysis, prompt }) {
  const r = await fetch("/api/research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ analysis, prompt }) });
  if ((r.headers.get("content-type") || "").includes("json")) { const j = await r.json(); if (j.mode === "local") { state.engine = "local"; detectEngine(); return null; } throw new Error(j.error || "Research failed"); }
  let dossier = null, err = null;
  await readSse(r, (ev, data) => {
    if (ev === "status") setStep("research", "active", data.text);
    if (ev === "page") stepLine("research", `read ${data.url.replace(/^https?:\/\/(www\.)?/, "")} (${data.words} words)`);
    if (ev === "search") stepLine("research", data.query);
    if (ev === "dossier") dossier = data.dossier;
    if (ev === "error") err = data.message;
  });
  if (err) { msg(`<b>Research failed:</b> ${esc(err)}`, "is-agent is-err"); return null; }
  return dossier;
}

async function generateWithClaude({ dossier, analysis, prompt, instruction }) {
  const r = await fetch("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dossier, analysis, prompt, instruction }) });
  if ((r.headers.get("content-type") || "").includes("json")) { const j = await r.json(); if (j.mode === "local") { state.engine = "local"; detectEngine(); return null; } throw new Error(j.error || "Generation failed"); }
  let spec = null, err = null;
  await readSse(r, (ev, data) => {
    if (ev === "status") setStep("plan", "active", data.text);
    if (ev === "token") setStep("plan", "active", `Writing… ${(data.n / 1024).toFixed(1)} KB`);
    if (ev === "spec") { spec = data.spec; if (data.usage) ui.previewMeta.textContent = `${data.model} · ${data.usage.output_tokens} tokens`; }
    if (ev === "error") err = data.message;
  });
  if (err) throw new Error(err);
  if (spec) { const cat = spec.seo?.imageCategory || INDUSTRIES[detectIndustry(spec.brand.industry + " " + (prompt || ""))]?.img || "generic"; spec.brand.industryKey = detectIndustry(spec.brand.industry); resolveImages(spec, cat); }
  return spec;
}

async function readSse(res, on) {
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf("\n\n")) > -1) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = (chunk.match(/^event: (.+)$/m) || [])[1]; const data = (chunk.match(/^data: (.+)$/m) || [])[1];
      if (ev && data) on(ev, JSON.parse(data));
    }
  }
}

/* Drop the empty strings/arrays the strict schema forces the model to emit. */
function normalize(spec) {
  const clean = (o) => {
    if (Array.isArray(o)) return o.map(clean).filter(v => !(v === "" || v == null || (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) || (Array.isArray(v) && v.length === 0)));
    if (o && typeof o === "object") { const out = {}; for (const [k, v] of Object.entries(o)) { const c = clean(v); if (c === "" || c == null) continue; if (Array.isArray(c) && c.length === 0 && k !== "keywords") continue; if (typeof c === "object" && !Array.isArray(c) && Object.keys(c).length === 0) continue; out[k] = c; } return out; }
    return o;
  };
  const s = clean(spec);
  s.brand = s.brand || {}; s.theme = s.theme || { mode: "dark", accent: "#FFFFFF", pair: "oswald" }; s.nav = s.nav || { links: [] }; s.sections = s.sections || []; s.seo = s.seo || {};
  s.sections = s.sections.filter(sec => sec.type);
  return s;
}

async function preview(spec) {
  state.html = render(spec, { libs: location.origin });
  ui.frame.srcdoc = state.html;
  ui.empty.classList.add("is-hidden");
  ui.previewUrl.textContent = `${spec.brand.domain || slugify(spec.brand.name) + ".com"} · preview`;
  renderCode();
  await new Promise(r => { ui.frame.onload = () => r(); setTimeout(r, 2500); });
}
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "site";

function renderPicks(picks) {
  ui.picks.innerHTML = picks.map(p => `<li class="pick"><span class="id">${esc(p.id)}</span><div><b>${esc(LIB[p.id]?.effect || "Pack component")}</b><small>${esc(p.why)}</small></div></li>`).join("");
  const used = new Set(picks.map(p => p.id));
  $$("li", ui.libgrid).forEach(li => li.classList.toggle("is-used", used.has(li.textContent)));
}
let LIB = {};
async function loadLibrary() {
  try { const rows = await (await fetch("/assets/data/pack.json")).json(); rows.forEach(r => LIB[r.id] = r); $("#libCount").textContent = rows.length; ui.libgrid.innerHTML = rows.map(r => `<li title="${esc(r.effect)}">${esc(r.id)}</li>`).join(""); } catch {}
}

/* ------------------------------------------------------------ brief */
function renderBrief() {
  const d = state.dossier, s = state.spec;
  if (!d && !s?.rationale) return;
  const li = (arr, f) => (arr || []).map(x => `<li>${f(x)}</li>`).join("");
  ui.brief.innerHTML = `
    ${s?.rationale ? `<h4 class="mono">Why it was designed this way</h4><div class="rationale">${esc(s.rationale)}</div>` : ""}
    ${d ? `
    <h4 class="mono">Positioning</h4><p class="pos">${esc(d.positioning || "")}</p>
    ${d.audience?.length ? `<h4 class="mono">Who buys</h4><ul>${li(d.audience, a => esc(a))}</ul>` : ""}
    ${d.differentiators?.length ? `<h4 class="mono">Why them</h4><ul>${li(d.differentiators, a => esc(a))}</ul>` : ""}
    ${d.proof?.length ? `<h4 class="mono">Proof found</h4><ul>${li(d.proof, p => `<span class="quote">“${esc(p.quote)}”</span><small>${esc(p.name || "")} · ${esc(p.source || "")}${p.url ? ` · <a href="${esc(p.url)}" target="_blank" rel="noopener">source</a>` : ""}</small>`)}</ul>` : `<h4 class="mono">Proof found</h4><p>None found online; no reviews were invented.</p>`}
    ${d.competitors?.length ? `<h4 class="mono">Competitors read</h4><ul>${li(d.competitors, c => `<b>${esc(c.name)}</b> · ${esc(c.claim || "")}<small>Gap: ${esc(c.weakness || "")}</small>`)}</ul>` : ""}
    ${d.voice ? `<h4 class="mono">Voice</h4><p>${esc(d.voice)}</p>` : ""}
    ${d.sitePhotos?.length ? `<h4 class="mono">Their photos</h4><div class="photos">${d.sitePhotos.slice(0, 8).map(u => `<img src="${esc(u)}" alt="" loading="lazy">`).join("")}</div>` : ""}
    ${d.gaps?.length ? `<h4 class="mono">Could not find</h4><ul>${li(d.gaps, g => esc(g))}</ul>` : ""}
    ${d.searches?.length ? `<h4 class="mono">Searches run</h4><div class="srcs">${d.searches.map(q => `<a>${esc(q)}</a>`).join("")}</div>` : ""}
    ${d.sources?.length ? `<h4 class="mono">Sources</h4><div class="srcs">${d.sources.slice(0, 14).map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`).join("")}</div>` : ""}
    ` : `<p class="hint">Preview engine: no research was run. Connect Claude to get a dossier.</p>`}`;
}

/* -------------------------------------------------------------- seo */
async function runSeo({ withModel } = {}) {
  const spec = state.spec;
  state.audit = audit(state.html, spec);
  state.plan = keywordPlan(spec).map(p => ({ ...p, page: "home" }));
  if (withModel && state.engine === "claude") {
    try {
      const r = await fetch("/api/seo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spec: stripImages(spec), dossier: state.dossier, audit: { score: state.audit.score, checks: state.audit.checks.filter(c => c.status !== "pass").map(c => ({ id: c.id, status: c.status, detail: c.detail })) } }) });
      const j = await r.json();
      if (j.ok && j.seo) {
        state.plan = j.seo.plan?.length ? j.seo.plan : state.plan; state.notes = j.seo.notes || [];
        spec.seo = { ...spec.seo, title: j.seo.title || spec.seo.title, description: j.seo.description || spec.seo.description, keywords: j.seo.keywords?.length ? j.seo.keywords : spec.seo.keywords, alt: Object.fromEntries((j.seo.altText || []).map(a => [a.query, a.alt])) };
        for (const s of spec.sections) { if (s.image && spec.seo.alt[s.image.query]) s.image.alt = spec.seo.alt[s.image.query]; (s.images || []).forEach(im => { if (spec.seo.alt[im.query]) im.alt = spec.seo.alt[im.query]; }); }
        await preview(spec); state.audit = audit(state.html, spec);
      } else if (j.error) msg(`<b>SEO agent (model half) failed:</b> ${esc(j.error)}. Rule audit still ran.`, "is-agent is-err");
    } catch {}
  }
  if (!state.notes.length) state.notes = localNotes(spec);
  renderSeo();
}
function localNotes(spec) {
  const city = spec.brand.city?.split(",")[0];
  const svc = (spec.sections.find(s => s.type === "services")?.items || []).slice(0, 2).map(i => i.title.toLowerCase());
  return [
    city ? `Add one page per core service with the city in the H1: ${svc.map(s => `"${s} ${city}"`).join(", ")}.` : "Add a service area to the copy so local searches can match.",
    "Claim and complete the Google Business Profile with the same name, phone and address as the footer.",
    "Ask the last ten happy clients for a review and quote two of them on the home page.",
    "Link every service card to its own page once those exist; internal links carry the ranking.",
    "Set the canonical and OG tags once the domain is pointed at the new site.",
  ];
}
function renderSeo() {
  const a = state.audit;
  ui.ring.style.setProperty("--p", a.score);
  ui.scoreNum.textContent = a.score;
  ui.scoreLabel.textContent = a.score >= 90 ? "Ready to rank" : a.score >= 70 ? "Good, with fixes to apply" : "Needs work";
  ui.scoreSub.textContent = `${a.checks.filter(c => c.status === "pass").length} of ${a.checks.length} checks pass · ${a.stats.words} words · ${a.stats.images} images`;
  ui.seoPill.textContent = a.score; ui.seoPill.className = "pill " + (a.score >= 90 ? "is-ok" : a.score >= 70 ? "is-warn" : "is-bad");
  ui.checks.innerHTML = a.checks.map(c => `<li class="check ${c.status}"><i></i><div>${esc(c.label)}<small>${esc(c.detail)}</small></div>${c.fixable && c.status !== "pass" ? `<button data-fix="${c.id}">Fix</button>` : ""}</li>`).join("");
  ui.kws.innerHTML = state.plan.map(p => `<li class="kw"><span>${esc(p.kw)}</span><span class="mono ${p.tier === "primary" ? "primary" : ""}">${esc(p.tier)} · ${esc(p.intent)}${p.page && p.page !== "home" ? " · " + esc(p.page) : ""}</span></li>`).join("");
  ui.notes.innerHTML = state.notes.map(n => `<li>${esc(n)}</li>`).join("");
}
async function applyFix(ids) {
  const before = state.audit.score;
  state.spec = seoFix(state.spec, ids);
  await preview(state.spec);
  state.audit = audit(state.html, state.spec);
  renderSeo();
  msg(`<b>SEO agent:</b> applied ${ids.length ? ids.join(", ") : "every fix it can"}. Score ${before} → <b>${state.audit.score}</b>.`);
}

/* ------------------------------------------------------------- edit */
async function edit(instruction) {
  if (!state.spec || state.busy) return;
  state.busy = true;
  msg(esc(instruction), "is-user");
  const thinking = msg(`<span class="mono">Agent</span>Working…`);
  try {
    let next = null, done = [];
    if (/\b(seo|rank|fix)\b/i.test(instruction) && /\b(fix|apply|run|all|everything)\b/i.test(instruction)) { thinking.remove(); state.busy = false; await applyFix([]); return; }
    if (state.engine === "claude") {
      const r = await fetch("/api/edit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spec: stripImages(state.spec), dossier: state.dossier, instruction }) });
      let err = null;
      if ((r.headers.get("content-type") || "").includes("json")) { const j = await r.json(); if (j.error) throw new Error(j.error); }
      else await readSse(r, (ev, data) => { if (ev === "status") thinking.innerHTML = `<span class="mono">Agent</span>${esc(data.text)}`; if (ev === "spec") next = data.spec; if (ev === "error") err = data.message; });
      if (err) throw new Error(err);
      if (next) { next = normalize(next); resolveImages(next, next.seo?.imageCategory || INDUSTRIES[state.spec.brand.industryKey]?.img || "generic"); next.brand.industryKey = state.spec.brand.industryKey; done = [next.rationale || "applied"]; }
    }
    if (!next) { const e = applyEdit(state.spec, instruction); next = e.spec; done = e.done; }
    if (!done.length) { thinking.innerHTML = `<span class="mono">Agent</span>The preview engine could not map that to a change. It understands: <b>make it light</b>, <b>accent teal</b>, <b>serif type</b>, <b>remove the stats</b>, <b>headline to: …</b>, <b>tagline to: …</b>, <b>button to: …</b>, <b>more minimal</b>, <b>typographic hero</b>. With Claude connected, any instruction works.`; return; }
    state.spec = next;
    await preview(state.spec);
    renderPicks(packPicks(state.spec)); renderBrief();
    state.audit = audit(state.html, state.spec); renderSeo();
    thinking.innerHTML = `<span class="mono">Agent</span><b>Done.</b> ${esc(done.join("; "))} SEO score now ${state.audit.score}.`;
  } catch (e) {
    thinking.innerHTML = `<span class="mono">Agent</span><b>Could not apply that.</b> ${esc(e.message)}`; thinking.classList.add("is-err");
  } finally { state.busy = false; }
}
function stripImages(spec) { const s = structuredClone(spec); for (const sec of s.sections) { if (sec.image) delete sec.image.url; (sec.images || []).forEach(i => delete i.url); if (sec.type === "gallery") (sec.items || []).forEach(i => delete i.image); } (s.nav?.links || []).forEach(l => delete l.image); delete s.seo.schema; delete s.seo.alt; return s; }

/* ------------------------------------------------------------- code */
function renderCode() {
  const out = state.codeView === "html" ? state.html : JSON.stringify(stripImages(state.spec), null, 2);
  ui.code.innerHTML = `<code>${esc(out.length > 120000 ? out.slice(0, 120000) + "\n…" : out)}</code>`;
}

/* ---------------------------------------------------------- export */
function exportHtml() {
  const html = render(state.spec, { libs: "cdn" });
  const blob = new Blob([html], { type: "text/html" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${slugify(state.spec.brand.name)}-index.html`; a.click();
  msg(`<b>Exported</b> ${a.download} (${(html.length / 1024).toFixed(0)} KB). Standalone: GSAP and Lenis load from a CDN, fonts from Google. Drop it on any host.`);
}
function publish() {
  const m = $("#modal"); $("#modalTitle").textContent = "Publish";
  $("#modalBody").innerHTML = `<p>Publishing is the next milestone: one click to a <code>${esc(slugify(state.spec.brand.name))}.unifictional.site</code> subdomain, then your own domain. Your domain, your site, your accounts, in your name.</p><p>Today you can ship it yourself in about a minute:</p><ol><li>Press <b>Export HTML</b>.</li><li>Drop the file on Vercel, Netlify or Cloudflare Pages as <code>index.html</code>.</li><li>Point your domain at it and set the canonical in the SEO tab.</li></ol><p>Want the whole system run for you: Google Business Profile, content, short-form video, lead capture, booking, AI lead handling and plain-English reporting? <a href="https://unifictional.com/contact" target="_blank" rel="noopener">Book a short, no-pressure call</a>. You leave with a clear plan either way.</p>`;
  m.hidden = false;
}

/* ------------------------------------------------------------ wire */
$$(".start__tabs button").forEach(b => b.addEventListener("click", () => { $$(".start__tabs button").forEach(x => x.classList.toggle("is-on", x === b)); $("#formUrl").classList.toggle("is-hidden", b.dataset.mode !== "url"); $("#formPrompt").classList.toggle("is-hidden", b.dataset.mode !== "prompt"); }));
$("#formUrl").addEventListener("submit", e => { e.preventDefault(); const f = new FormData(e.target); build({ url: f.get("url").trim(), instruction: f.get("instruction").trim() }); });
$("#formPrompt").addEventListener("submit", e => { e.preventDefault(); const f = new FormData(e.target); build({ prompt: f.get("prompt").trim() }); });
$$(".examples button").forEach(b => b.addEventListener("click", () => { if (b.dataset.ex) $("#formPrompt textarea").value = b.dataset.ex; if (b.dataset.url) $("#formUrl input[name=url]").value = b.dataset.url; }));
ui.chat.addEventListener("submit", e => { e.preventDefault(); const v = ui.chatInput.value.trim(); if (!v) return; ui.chatInput.value = ""; edit(v); });
$$(".seg").forEach(b => b.addEventListener("click", () => { $$(".seg").forEach(x => x.classList.toggle("is-on", x === b)); ui.frameWrap.dataset.vp = b.dataset.vp; }));
$$(".tab").forEach(b => b.addEventListener("click", () => { $$(".tab").forEach(x => x.classList.toggle("is-on", x === b)); $$(".tabpane").forEach(p => p.classList.toggle("is-on", p.dataset.pane === b.dataset.tab)); }));
$$(".code__tabs [data-code]").forEach(b => b.addEventListener("click", () => { $$(".code__tabs [data-code]").forEach(x => x.classList.toggle("is-on", x === b)); state.codeView = b.dataset.code; if (state.spec) renderCode(); }));
$("#btnCopy").addEventListener("click", async () => { if (!state.spec) return; await navigator.clipboard.writeText(state.codeView === "html" ? render(state.spec, { libs: "cdn" }) : JSON.stringify(stripImages(state.spec), null, 2)); $("#btnCopy").textContent = "Copied"; setTimeout(() => $("#btnCopy").textContent = "Copy", 1200); });
$("#btnExport").addEventListener("click", exportHtml);
$("#btnPublish").addEventListener("click", publish);
$("#modalClose").addEventListener("click", () => { $("#modal").hidden = true; });
$("#btnFixAll").addEventListener("click", () => applyFix([]));
$("#btnReaudit").addEventListener("click", async () => { await preview(state.spec); await runSeo({ withModel: false }); msg(`<b>SEO agent:</b> re-audited. Score ${state.audit.score}.`); });
ui.checks.addEventListener("click", e => { const b = e.target.closest("[data-fix]"); if (b) applyFix([b.dataset.fix]); });

/* deep links from the landing page: /studio?url=… or /studio?prompt=… */
(async function init() {
  await Promise.all([detectEngine(), loadLibrary()]);
  const q = new URLSearchParams(location.search);
  if (q.get("url")) { $("#formUrl input[name=url]").value = q.get("url"); build({ url: q.get("url"), instruction: q.get("note") || "" }); }
  else if (q.get("prompt")) { $$(".start__tabs button")[1].click(); $("#formPrompt textarea").value = q.get("prompt"); build({ prompt: q.get("prompt") }); }
})();
