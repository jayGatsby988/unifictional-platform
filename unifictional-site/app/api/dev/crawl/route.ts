// @ts-nocheck
// GET /api/dev/crawl?url=https://example.com[&max=20]
// Development only: runs the site crawler and returns a summary, so the
// extraction (logo, colours, fonts, socials, address, hours, photos) can be
// checked against a real site without a model call.
import { NextResponse } from "next/server";

import { crawlSite } from "@/lib/build/analyze";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") return new NextResponse("Not found", { status: 404 });
  const url = new URL(req.url).searchParams.get("url");
  const max = Number(new URL(req.url).searchParams.get("max") || 20);
  if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 });
  const t0 = Date.now();
  try {
    const a = await crawlSite(/^https?:/.test(url) ? url : "https://" + url, { maxPages: max, forceRender: new URL(req.url).searchParams.get("render") === "1" });
    return NextResponse.json({
      ms: Date.now() - t0, url: a.url, domain: a.domain, title: a.title, description: a.description,
      logo: a.logo, icon: a.icon, colors: a.colors, fonts: a.fonts, social: a.social,
      phone: a.phone, email: a.email, address: a.address, hours: a.hours, licence: a.licence, city: a.city,
      nav: a.nav, pagesRead: a.pages.map(p => ({ url: p.url, title: p.title, words: p.words, images: p.images.length })),
      totalWords: a.totalWords, rendered: Boolean(a.rendered), images: a.images.slice(0, 80),
    });
  } catch (e) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 });
  }
}
