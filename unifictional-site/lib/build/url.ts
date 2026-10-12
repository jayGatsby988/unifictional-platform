// @ts-nocheck
/** The URL as a person meant it: the first well-formed http(s) URL in the string (typos like two URLs pasted together, stray text, missing scheme). */
/** Keep a path only when it looks like a real page (one or two clean segments, no dots or junk); otherwise the site root. */
function keepPath(pathname: string): string {
  const segs = pathname.split("/").filter(Boolean);
  if (!segs.length || segs.length > 2 || segs.some(x => /[.:]|^https?$/i.test(x))) return "/";
  return "/" + segs.join("/") + "/";
}

export function cleanWebsite(raw = ""): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m = s.match(/https?:\/\/(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,10}(?=[\/\s"'<>?#]|$)(?:\/[^\s"'<>]*)?/i);
  if (m) { try { const u = new URL(m[0]); return u.origin + keepPath(u.pathname); } catch {} }
  const bare = s.match(/(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,10}(?=[\/\s"'<>?#]|$)(?:\/[^\s"'<>]*)?/i);
  if (bare) { try { const u = new URL("https://" + bare[0]); return u.origin + keepPath(u.pathname); } catch {} }
  return "";
}

