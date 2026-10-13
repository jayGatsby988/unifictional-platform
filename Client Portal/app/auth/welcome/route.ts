import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readWelcomeToken } from "@/lib/accounts/welcome-link";

/**
 * The welcome email's "Sign me in" button. Good token: sign them in on this browser and go
 * straight to their portal (it then asks them to pick a password). Expired or already
 * replaced: the sign-in page with their email filled in and a one-tap "email me a new link".
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const nextParam = searchParams.get("next") ?? "/overview";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/overview";
  const t = await readWelcomeToken(searchParams.get("t") ?? "").catch(() => ({ ok: false as const, email: undefined }));

  if (t.ok) {
    const { data } = await createAdminClient().auth.admin.generateLink({ type: "magiclink", email: t.email });
    const hash = data?.properties?.hashed_token;
    if (hash) {
      const { error } = await (await createClient()).auth.verifyOtp({ type: "magiclink", token_hash: hash });
      if (!error) return NextResponse.redirect(`${origin}${next}`);
    }
  }
  const back = new URL("/login", origin);
  back.searchParams.set("error", "welcome");
  back.searchParams.set("next", next);
  if (t.email) back.searchParams.set("email", t.email);
  return NextResponse.redirect(back);
}
