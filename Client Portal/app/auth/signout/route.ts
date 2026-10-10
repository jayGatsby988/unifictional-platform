import { NextResponse } from "next/server";
import { demoMode } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/** Sign out and forget which company was being viewed, so the next sign-in starts fresh (admins land in Studio). */
async function signOut(request: Request) {
  if (!demoMode) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  const res = NextResponse.redirect(new URL("/login", request.url), { status: 303 });
  res.cookies.set("portal_client", "", { path: "/", maxAge: 0 });
  return res;
}

export const POST = signOut;
export const GET = signOut;
