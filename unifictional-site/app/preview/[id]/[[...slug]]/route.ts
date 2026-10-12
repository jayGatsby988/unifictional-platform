import { NextResponse } from "next/server";

import { buildPath, isBuildId, isPageSlug, pagePath, readText } from "@/lib/build/storage";

/**
 * GET /preview/{buildId}            → the home page the AI built
 * GET /preview/{buildId}/{page…}    → any other page (about, services/decks, …)
 * Served straight from Blob storage. The id is a random UUID, so the link is
 * private to whoever has it. Never indexed.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const notReady = (status = 404) =>
  new NextResponse(
    "<!doctype html><meta charset=utf-8><title>Not ready</title><body style='font:16px/1.5 system-ui;padding:48px;color:#0e0e0e'><h1 style='font-weight:500'>This preview is not ready yet.</h1><p>The build is still running or the link is wrong. Try again in a few minutes.</p>",
    { status, headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex, nofollow" } }
  );

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; slug?: string[] }> }) {
  const { id, slug } = await ctx.params;
  if (!isBuildId(id)) return notReady();
  const page = (slug || []).join("/").replace(/\/$/, "") || "index";
  if (page !== "index" && !isPageSlug(page)) return notReady();
  // multi-page builds store pages/<slug>.html; the first generation stored site.html
  const html = (await readText(pagePath(id, page))) || (page === "index" ? await readText(buildPath(id, "site.html")) : null);
  if (!html) return notReady();
  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow" },
  });
}
