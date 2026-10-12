// @ts-nocheck
// Publish a finished site to Vercel as its own project: <slug>.vercel.app.
// The site is static HTML (photos, frames and fonts already live on our
// storage), so the deployment is just the pages, uploaded inline through the
// deployments API. A rebuild of the same company redeploys the same project,
// so its URL stays put. Needs VERCEL_TOKEN (and VERCEL_TEAM_ID for a team).
const API = "https://api.vercel.com";

export const publishConfigured = () => Boolean(process.env.VERCEL_TOKEN);

/** A Vercel project name from the business name: lowercase, hyphens, max 52 chars. */
export function projectNameFor(business = "", id = "") {
  const base = String(business || "").toLowerCase().normalize("NFKD").replace(/[^\x00-\x7F]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return `${process.env.PUBLISH_PREFIX || "site"}-${base || "client"}${process.env.PUBLISH_SUFFIX_ID === "1" && id ? "-" + id.slice(0, 6) : ""}`;
}

async function vercel(path, { method = "GET", body = null, token, teamId }) {
  const url = new URL(API + path); if (teamId) url.searchParams.set("teamId", teamId);
  const r = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  if (!r.ok) throw new Error(`Vercel ${method} ${path}: ${r.status} ${json?.error?.message || text.slice(0, 200)}`);
  return json;
}

/**
 * Deploy `pages` ([{slug, html}]) as a production deployment. Returns the live URL.
 * `extra` are further files ({ "robots.txt": "..." }).
 */
export async function publishSite({ business, id, pages, extra = {}, stamp = () => {} }) {
  const token = process.env.VERCEL_TOKEN; const teamId = process.env.VERCEL_TEAM_ID || undefined;
  if (!token) throw new Error("VERCEL_TOKEN is not set: the site was not published");
  const name = projectNameFor(business, id);
  const files = pages.map(p => ({ file: p.slug === "index" ? "index.html" : `${p.slug}/index.html`, data: p.html }));
  for (const [file, data] of Object.entries(extra)) files.push({ file, data: String(data) });
  // make sure the project exists (the deployment call would create it, but with a name we did not choose when it collides)
  let project = null;
  try { project = await vercel(`/v9/projects/${encodeURIComponent(name)}`, { token, teamId }); }
  catch (e) { if (!/404/.test(String(e?.message))) throw e; }
  if (!project) { project = await vercel(`/v10/projects`, { method: "POST", token, teamId, body: { name, framework: null } }); stamp(`publish: created Vercel project ${name}`); }
  const dep = await vercel(`/v13/deployments`, { method: "POST", token, teamId, body: { name, project: name, target: "production", files, projectSettings: { framework: null, buildCommand: null, installCommand: null, outputDirectory: null } } });
  // wait for READY (static deployments are quick)
  const t0 = Date.now();
  let state = dep.readyState || dep.status || "";
  while (!/READY|ERROR|CANCELED/i.test(state) && Date.now() - t0 < 180_000) {
    await new Promise(r => setTimeout(r, 4000));
    const d = await vercel(`/v13/deployments/${dep.id}`, { token, teamId });
    state = d.readyState || d.status || "";
  }
  if (!/READY/i.test(state)) throw new Error(`Vercel deployment ended ${state || "unknown"}`);
  const alias = (dep.alias || []).find(a => /\.vercel\.app$/.test(a)) || `${name}.vercel.app`;
  const url = `https://${alias}`;
  stamp(`publish: live at ${url} (${files.length} files, ${Math.round((Date.now() - t0) / 1000)} s)`);
  return { url, project: name, deploymentId: dep.id, inspectorUrl: dep.inspectorUrl || "" };
}
