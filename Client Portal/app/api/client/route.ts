import { NextResponse } from "next/server";

/** Admin client switcher: stores the chosen client slug in a cookie. */
export async function POST(request: Request) {
  const { slug } = await request.json();
  const res = NextResponse.json({ ok: true });
  res.cookies.set("portal_client", String(slug ?? ""), { path: "/", httpOnly: true, sameSite: "lax" });
  return res;
}

/** Leave company view (back to the studio). */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("portal_client");
  return res;
}
