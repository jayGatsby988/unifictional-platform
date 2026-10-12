// @ts-nocheck
// Emails the AI build sends to the owner: the finished site (preview links
// for every page, rationale, SEO summary, review notes, the zip attached) or
// a failure notice.
import { bookingConfig } from "@/lib/booking/config";
import { sendEmail, shell, heading, button, detailCard, esc, escAttr, EMAIL_COLORS } from "@/lib/booking/email";
import type { BuildJob } from "./pipeline";
import { costOf } from "./claude";

const { INK, MUTED, PAPER, ACCENT, LINE } = EMAIL_COLORS;
const slug = (s = "") => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "site";
const label = (s) => `<p style="margin:16px 0 6px 0;color:${MUTED};font-size:12px;letter-spacing:.08em;text-transform:uppercase;">${s}</p>`;
const list = (items) => `<ul style="margin:0;padding-left:18px;color:${INK};">${items.map(n => `<li style="margin:4px 0;">${n}</li>`).join("")}</ul>`;

export async function sendBuildReady(p: { job: BuildJob; spec: any; pages: { slug: string; title?: string }[]; components: string[]; ownPhotos: number; previewUrl: string; zip: Buffer; model: string }) {
  const { job, spec, pages, components, ownPhotos, previewUrl } = p;
  const seo = job.seo || {}, lead = job.lead, review = job.review || {}, d = job.dossier || {};
  const biz = spec?.brand?.name || lead.businessName || lead.name;
  const pageLink = (pg) => previewUrl ? `<a href="${escAttr(previewUrl + (pg.slug === "index" ? "" : "/" + pg.slug))}" style="color:${ACCENT};text-decoration:none;">${esc(pg.title || pg.slug)}</a> <span style="color:${MUTED};font-size:12px;">/${esc(pg.slug === "index" ? "" : pg.slug)}${seo.perPage ? ` · ${seo.perPage.find(x => x.slug === pg.slug)?.score ?? ""}` : ""}</span>` : esc(pg.title || pg.slug);
  const body = `
${heading(`${esc(biz)}: the site is ${job.publishedUrl ? "live" : "built"}${(job.needsLook || []).length ? ", with a few things to look at" : ""}.`)}
${job.publishedUrl ? `<p style="margin:0 0 14px 0;font-size:16px;"><strong>Live:</strong> <a href="${esc(job.publishedUrl)}" style="color:${INK};">${esc(job.publishedUrl)}</a></p>` : job.publishNote ? `<p style="margin:0 0 14px 0;color:${INK};">Not published yet: ${esc(job.publishNote)}</p>` : ""}
${(job.debugNotes || []).length ? `<p style="margin:0 0 14px 0;color:${INK};"><strong>The debugger checked every page and fixed:</strong><br>${job.debugNotes.slice(0, 12).map(esc).join("<br>")}</p>` : ""}
${(job.needsLook || []).length ? `<p style="margin:0 0 14px 0;padding:12px 16px;background:${PAPER};border-left:3px solid ${ACCENT};border-radius:6px;color:${INK};"><strong>Look at these before the call:</strong><br>${job.needsLook.map(esc).join("<br>")}</p>` : ""}
<p style="margin:0 0 18px 0;">The AI researched ${esc(biz)}, planned ${pages.length} pages, wrote them, reviewed them against the research, and ran the SEO agent, all while ${esc(lead.name)} was booking. Open the preview, then bring it to the call.</p>
<div style="margin:18px 0 22px 0;">${previewUrl ? button(previewUrl, "Open the preview") : `<span style="color:${MUTED}">Preview storage is not configured; the zip is attached.</span>`}</div>
${detailCard([
  ["Business", esc(biz)],
  ["Built from", lead.website ? `<a href="${escAttr(lead.website)}" style="color:${ACCENT};text-decoration:none;">${esc(lead.website)}</a> (${(d.photos || []).length} real photos, ${(job.analysis?.pagesRead || []).length + 1} pages read) + ${(d.searchesA?.length || 0) + (d.searchesB?.length || 0)} web searches` : `the company details they typed + ${(d.searchesA?.length || 0) + (d.searchesB?.length || 0)} web searches`],
  ["Industry", esc(spec?.brand?.industry || "—")],
  ["Location", esc([spec?.brand?.city, spec?.brand?.serviceArea].filter(Boolean).join(" · ") || "—")],
  ["Brand", `${spec?.brand?.logo?.url || spec?.brand?.logo?.kind === "svg" ? "their logo" : "wordmark (no logo found)"} · accent ${esc(spec?.theme?.accent || "")} · ${esc(spec?.theme?.pair || "")} type · ${esc(spec?.theme?.mode || "")} mode`],
  ["Photos", `${ownPhotos} of their own photos used${job.weight?.images?.count ? ` · ${job.weight.images.count} re-encoded as WebP: ${(job.weight.images.before / 1048576).toFixed(1)} MB → ${(job.weight.images.after / 1048576).toFixed(1)} MB` : ""}`],
  ["Hero video", spec?.video ? `a generated clip of ${job.hook?.flagship?.title || "their flagship work"} plays as the visitor scrolls (${spec.video.mode === "frames" ? spec.video.count + " frames, up to 4K" : "mp4"}; Higgsfield, ${Math.round((spec.video.seconds || 0) / 60)} min)` : "none (no usable flagship photo, or Higgsfield not configured)"],
  ["Quality gate", job.qa?.passed ? `passed in round ${job.qa.rounds} · ${job.qa.score}/100 · ${esc(job.qa.verdict || "")}${(job.qa.shots || []).length ? ` · ${job.qa.shots.length} screenshots inspected` : ""}` : "—"],
  ["Weight", job.weight ? `pages ${Math.round(job.weight.html.before / 1024)} KB → ${Math.round(job.weight.html.after / 1024)} KB over the wire after minifying; images sized per screen with lazy loading` : "—"],
  ["SEO score", `${seo.score ?? "—"}/100 average over ${pages.length} pages${typeof seo.before === "number" && seo.before !== seo.score ? ` <span style="color:${MUTED}">(${seo.before} before the SEO agent)</span>` : ""}`],
  ["Reviews found", `${(d.proof || []).length}${(d.ratings || []).length ? ` · ${d.ratings.map(r => `${esc(r.platform)} ${esc(r.rating)} (${esc(r.count)})`).join(", ")}` : ""}`],
  ["Components", esc(components.join(", ") || "—")],
  ["Cost of this build", job.usage ? `≈ $${costOf(job.usage).toFixed(2)} <span style="color:${MUTED}">(${job.usage.calls} model calls, ${job.usage.searches} searches, ${Math.round(job.usage.input / 1000)}k in / ${Math.round(job.usage.output / 1000)}k out tokens at Opus 5.5 list prices)</span>` : "—"],
  ["Preview", previewUrl ? `<a href="${escAttr(previewUrl)}" style="color:${ACCENT};text-decoration:none;word-break:break-all;">${esc(previewUrl)}</a>` : "—"],
])}
${label("Pages")}
${list(pages.map(pageLink))}
${job.hook?.hook?.claim ? `<p style="margin:20px 0 6px 0;font-weight:600;color:${INK};">The hook</p>
<p style="margin:0;padding:14px 18px;background:${PAPER};border-left:3px solid ${ACCENT};border-radius:6px;color:${INK};"><strong>${esc(job.hook.hook.claim)}</strong><br>${esc(job.hook.hook.evidence || "")}${job.hook.flagship?.title ? `<br><br><strong>Flagship:</strong> ${esc(job.hook.flagship.title)}${job.hook.flagship.place ? ", " + esc(job.hook.flagship.place) : ""}${job.hook.flagship.fallback ? " (no real project found; the service is the flagship)" : ""}` : ""}${job.hook.objection?.what ? `<br><strong>Objection answered:</strong> ${esc(job.hook.objection.what)} → ${esc(job.hook.objection.answer || "")}` : ""}</p>` : ""}
${spec?.rationale ? `<p style="margin:20px 0 6px 0;font-weight:600;color:${INK};">Why it looks like this</p>
<p style="margin:0;padding:14px 18px;background:${PAPER};border-left:3px solid ${ACCENT};border-radius:6px;color:${INK};white-space:pre-wrap;">${esc(spec.rationale)}</p>` : ""}
${(job.journal || []).length ? label("Why it was built this way") + list(job.journal.slice(0, 14).map(j => `<strong>${esc(j.what)}</strong>${j.why ? ` <span style="color:${MUTED}">— ${esc(j.why)}</span>` : ""}`)) : ""}
${review.notes?.length ? label("What the reviewer fixed") + list(review.notes.map(esc)) : ""}
${review.missing?.length ? label("Facts the reviewer could not place") + list(review.missing.map(esc)) : ""}
${(job.researchNotes || []).length ? label("What research could not find (ask on the call)") + list(job.researchNotes.map(esc)) : ""}
${(job.planNotes || []).length || (job.writeNotes || []).length ? label("What the build adjusted along the way") + list([...(job.planNotes || []), ...(job.writeNotes || [])].slice(0, 12).map(esc)) : ""}
${d.gaps?.length ? label("Research gaps") + list(d.gaps.slice(0, 8).map(esc)) : ""}
${seo.plan?.length ? label("Keyword plan") + `<table role="presentation" width="100%" style="border-collapse:collapse;">${seo.plan.slice(0, 14).map(k => `<tr><td style="padding:5px 0;border-bottom:1px solid ${LINE};color:${INK};">${esc(k.kw)}</td><td style="padding:5px 0;border-bottom:1px solid ${LINE};color:${MUTED};font-size:12px;text-align:right;">${esc(k.tier)} · ${esc(k.intent)}${k.page ? " · " + esc(k.page) : ""}</td></tr>`).join("")}</table>` : ""}
${seo.notes?.length ? label("What else would move rankings") + list(seo.notes.map(esc)) : ""}
${seo.flagged?.length ? label("Still flagged by the audit") + list(seo.flagged.map(esc)) : ""}
<p style="margin:22px 0 0 0;color:${MUTED};font-size:13px;">The whole site is attached as a zip (one folder per page; upload to any static host at the domain root). Build log: ${esc(job.log.join(" · "))}. Model: ${esc(p.model)}.</p>`;
  return sendEmail({
    to: bookingConfig.ownerEmail,
    subject: `${job.publishedUrl ? "Site live" : "Site ready"}${(job.needsLook || []).length ? " (needs a look)" : ""}: ${biz} — ${pages.length} pages, SEO ${seo.score ?? "—"}/100`,
    replyTo: lead.email,
    html: shell({ preheader: `The AI built ${biz}'s ${pages.length}-page site. SEO ${seo.score ?? "—"}/100.`, eyebrow: "AI build", bodyHtml: body }),
    attachments: [{ filename: `${slug(biz)}-site.zip`, content: p.zip.toString("base64"), contentType: "application/zip" }],
  });
}

export async function sendBuildFailed(p: { job: BuildJob; step: string; message: string }) {
  const { job, step, message } = p;
  const biz = job.lead.businessName || job.lead.name;
  const reasons = String(message || "").split("\n").map(r => r.trim()).filter(Boolean);
  const qa = job.qa || {};
  const shots = (qa.shots || []).filter(s => s.url).slice(0, 8);
  const body = `
${heading(`${esc(biz)}: build failed, nothing was sent.`)}
<p style="margin:0 0 18px 0;">The lead came through fine (see the booking email). The automatic build stopped at the <strong>${esc(step)}</strong> step because it did not meet the standard, and a site that does not pass is never sent. The reasons are below; fix the cause and press Rebuild on the dashboard, or build this one by hand.</p>
${detailCard([
  ["Business", esc(biz)],
  ["Website", job.lead.website ? `<a href="${escAttr(job.lead.website)}" style="color:${ACCENT};text-decoration:none;">${esc(job.lead.website)}</a>` : "none (company details on the form)"],
  ["Failed at", esc(step)],
  ["Cost so far", job.usage ? `≈ $${costOf(job.usage).toFixed(2)}` : "—"],
  ...(qa.rounds ? [["Quality gate", `${qa.rounds} round${qa.rounds > 1 ? "s" : ""}${typeof qa.score === "number" ? ` · last score ${qa.score}/100` : ""}${qa.verdict ? ` · ${esc(qa.verdict)}` : ""}`]] : []),
])}
${label(reasons.length > 1 ? "Reasons" : "Reason")}
${list(reasons.length ? reasons.map(esc) : [esc(message)])}
${(job.journal || []).length ? label("What the build decided along the way") + list(job.journal.slice(0, 12).map(j => `<strong>${esc(j.what)}</strong>${j.why ? ` <span style="color:${MUTED}">— ${esc(j.why)}</span>` : ""}`)) : ""}
${(qa.issues || []).length ? label("What the judge saw") + list((qa.issues || []).slice(0, 12).map(i => `<strong>${esc(i.page)}${i.section ? " §" + i.section : ""}</strong> (${esc(i.severity)}): ${esc(i.problem)}${i.instruction ? ` <span style="color:${MUTED}">→ ${esc(i.instruction)}</span>` : ""}`)) : ""}
${shots.length ? label("Screenshots from the last round") + `<p style="margin:0;">${shots.map(s => `<a href="${escAttr(s.url)}" style="display:inline-block;margin:0 6px 6px 0;"><img src="${escAttr(s.url)}" alt="${escAttr(s.name)}" width="160" style="width:160px;height:auto;border:1px solid ${LINE};border-radius:4px;"></a>`).join("")}</p>` : ""}
<p style="margin:18px 0 0 0;color:${MUTED};font-size:13px;">Build log: ${esc(job.log.join(" · "))}</p>`;
  return sendEmail({
    to: bookingConfig.ownerEmail,
    subject: `Build failed: ${biz} (${step}: ${reasons[0] ? reasons[0].slice(0, 70) : "see reasons"})`,
    html: shell({ preheader: `Build failed at ${step}: ${reasons[0] || message}`, eyebrow: "AI build", bodyHtml: body }),
  });
}
