import { NextResponse } from "next/server";

import { COOKIE, dashboardKey } from "@/lib/build/dashboard";

/** POST /api/build/auth {key} — sets the dashboard cookie when the key matches. DELETE clears it. */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { key?: string } = {};
  try { body = await req.json(); } catch {}
  const key = dashboardKey();
  if (!key || !body.key || body.key.trim() !== key) return NextResponse.json({ error: "wrong_key" }, { status: 403 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, key, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 60 });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
