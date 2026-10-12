import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[::1\])/;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** GET /api/build/fetch?url= — a second IP pool for the crawler (Bearer BOOKING_SECRET). Returns the page body as the site served it. */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!process.env.BOOKING_SECRET || auth !== `Bearer ${process.env.BOOKING_SECRET}`) return new NextResponse("Forbidden", { status: 403 });
  const raw = new URL(req.url).searchParams.get("url") || "";
  let target: URL;
  try { target = new URL(raw); } catch { return new NextResponse("Bad url", { status: 400 }); }
  if (!/^https?:$/.test(target.protocol) || PRIVATE.test(target.hostname)) return new NextResponse("Bad url", { status: 400 });
  try {
    const r = await fetch(target.href, { redirect: "follow", signal: AbortSignal.timeout(20_000), headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7", "accept-language": "en-US,en;q=0.9", "upgrade-insecure-requests": "1" } });
    const type = r.headers.get("content-type") || "application/octet-stream";
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 25 * 1024 * 1024) return new NextResponse("Too large", { status: 413 });
    return new NextResponse(buf, { status: 200, headers: { "content-type": /^(text|application\/json|application\/xml|image|font)/i.test(type) ? type : "application/octet-stream", "x-upstream-status": String(r.status), "x-upstream-type": type, "x-final-url": r.url || target.href, "cache-control": "no-store" } });
  } catch (e) {
    return new NextResponse(String((e as Error)?.message || e), { status: 502 });
  }
}
