import { NextResponse } from "next/server";
import { alreadyBuilt, clearLimit } from "@/lib/build/limits";

export const runtime = "nodejs";

const authed = (req: Request) => { const key = process.env.BUILDS_DASHBOARD_KEY; const auth = req.headers.get("authorization") || ""; return Boolean(key) && auth === `Bearer ${key}`; };

/** GET /api/build/limits?email=&ip=  → whether a build would be refused for them. DELETE with the same query clears their record. Bearer BUILDS_DASHBOARD_KEY. */
export async function GET(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const u = new URL(req.url); const email = u.searchParams.get("email") || ""; const ip = u.searchParams.get("ip") || "";
  return NextResponse.json({ email: email ? "given" : "", ip: ip ? "given" : "", ...(await alreadyBuilt(email, ip)) });
}
export async function DELETE(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const u = new URL(req.url); const email = u.searchParams.get("email") || ""; const ip = u.searchParams.get("ip") || "";
  return NextResponse.json(await clearLimit(email, ip));
}
