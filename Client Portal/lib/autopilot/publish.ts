import { markdownFile, mdToHtml } from "./markdown";

export type PostForPublish = { title: string; slug: string; metaDescription: string; excerpt: string; targetQuery: string; bodyMd: string };

/** Where a post goes. "manual" means it waits in the portal with the reason shown. */
export type Target =
  | { kind: "wordpress"; url: string; user: string; appPassword: string }
  | { kind: "github"; repo: string; dir: string; siteUrl: string; token: string }
  | { kind: "manual"; reason: string };

/** "mysite.com/wp-admin" → "https://mysite.com". null when it isn't a URL at all. */
export function normalizeWpUrl(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    const path = u.pathname.replace(/\/(wp-json|wp-admin|wp-login\.php)[^]*$/i, "").replace(/\/+$/, "");
    return `${u.origin}${path}`;
  } catch {
    return null;
  }
}

const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

/** Checks the login against /wp-json before it is stored, so a typo is caught on the form. */
export async function verifyWordpress(url: string, user: string, appPassword: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(`${url}/wp-json/wp/v2/users/me?context=edit`, { headers: { Authorization: basic(user, appPassword), Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    return { ok: false, error: `Couldn't reach ${url} (${e instanceof Error ? e.message : "network error"}).` };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, error: "WordPress didn't accept that username and application password." };
  if (res.status === 404) return { ok: false, error: "That address doesn't look like a WordPress site (no /wp-json)." };
  if (!res.ok) return { ok: false, error: `WordPress answered ${res.status}.` };
  const me = (await res.json().catch(() => ({}))) as { name?: string; capabilities?: Record<string, boolean> };
  if (me.capabilities && !me.capabilities.publish_posts) return { ok: false, error: `${me.name ?? "That user"} can't publish posts. Use an Editor or Administrator login.` };
  return { ok: true, name: me.name ?? user };
}

export function wordpressPayload(p: PostForPublish) {
  return { title: p.title, slug: p.slug, content: mdToHtml(p.bodyMd), excerpt: p.excerpt || p.metaDescription, status: "publish" as const };
}

export async function publishToWordpress(t: Extract<Target, { kind: "wordpress" }>, p: PostForPublish): Promise<{ url: string }> {
  const res = await fetch(`${t.url}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: { Authorization: basic(t.user, t.appPassword), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(wordpressPayload(p)),
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await res.json().catch(() => ({}))) as { link?: string; message?: string };
  if (!res.ok) throw new Error(`WordPress ${res.status}: ${j.message ?? "could not create the post"}`);
  return { url: j.link ?? `${t.url}/${p.slug}/` };
}

export function githubPath(dir: string, slug: string): string {
  return `${(dir || "content/blog").replace(/^\/+|\/+$/g, "")}/${slug}.md`;
}

export function publicPostUrl(siteUrl: string, slug: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/blog/${slug}`;
}

/** Commits the post as a Markdown file; Vercel deploys the site from the commit. */
export async function publishToGithub(t: Extract<Target, { kind: "github" }>, p: PostForPublish, date: string): Promise<{ url: string }> {
  const path = githubPath(t.dir, p.slug);
  const api = `https://api.github.com/repos/${t.repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  const headers = { Authorization: `Bearer ${t.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" };
  const existing = (await fetch(api, { headers, signal: AbortSignal.timeout(15_000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as { sha?: string } | null;
  const content = Buffer.from(markdownFile(p, p.bodyMd, date)).toString("base64");
  const res = await fetch(api, { method: "PUT", headers, body: JSON.stringify({ message: `Blog: ${p.title}`, content, ...(existing?.sha ? { sha: existing.sha } : {}) }), signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(`GitHub ${res.status}: ${j.message ?? "could not commit the post"}`);
  }
  return { url: publicPostUrl(t.siteUrl, p.slug) };
}

export async function publish(t: Target, p: PostForPublish, date: string): Promise<{ url: string }> {
  if (t.kind === "wordpress") return publishToWordpress(t, p);
  if (t.kind === "github") return publishToGithub(t, p, date);
  throw new Error(t.reason);
}
