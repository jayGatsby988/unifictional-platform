import { NextResponse } from "next/server";

/** Studio: switch into a company and land on one of its pages. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug") ?? "";
  const next = url.searchParams.get("next") ?? "/overview";
  const res = NextResponse.redirect(new URL(next.startsWith("/") && !next.startsWith("//") ? next : "/overview", url.origin));
  res.cookies.set("portal_client", slug, { path: "/", httpOnly: true, sameSite: "lax" });
  return res;
}
