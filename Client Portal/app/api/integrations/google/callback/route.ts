import { NextResponse } from "next/server";
import { createWriterClient } from "@/lib/supabase/admin";
import { verifyState } from "@/lib/integrations/oauth-state";
import { getJson } from "@/lib/integrations/types";

type Tokens = { access_token: string; refresh_token?: string; scope?: string };
type UserInfo = { email?: string };

/** Stores the Google refresh token: for one company when the state carries a slug, else for the studio. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = verifyState(url.searchParams.get("state"));
  const code = url.searchParams.get("code");
  const back = (q: string) => NextResponse.redirect(`${url.origin}/admin?${q}`);
  if (!state || !code) return back("error=google_state");

  const body = new URLSearchParams({
    code, client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
    redirect_uri: `${url.origin}/api/integrations/google/callback`, grant_type: "authorization_code",
  });
  const tokens = await getJson<Tokens>("https://oauth2.googleapis.com/token", { method: "POST", body }).catch(() => null);
  if (!tokens?.refresh_token) return back("error=google_no_refresh_token");
  const who = await getJson<UserInfo>("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } }).catch((): UserInfo => ({}));

  const db = await createWriterClient();
  if (state.slug) {
    const { data: client } = await db.from("clients").select("id").eq("slug", state.slug).maybeSingle();
    if (!client) return back("error=unknown_client");
    await db.from("client_integrations").upsert({ client_id: client.id, google_refresh_token: tokens.refresh_token, google_account_label: who.email ?? null, updated_at: new Date().toISOString() }, { onConflict: "client_id" });
    return back(`connected=google&client=${encodeURIComponent(state.slug)}`);
  }
  await db.from("studio_connections").upsert({
    provider: "google", refresh_token: tokens.refresh_token, account_label: who.email ?? null, scopes: tokens.scope ?? null, connected_at: new Date().toISOString(),
  }, { onConflict: "provider" });
  return back("connected=google");
}
