import { NextResponse } from "next/server";
import { createWriterClient } from "@/lib/supabase/admin";
import { verifyState } from "@/lib/integrations/oauth-state";
import { getJson } from "@/lib/integrations/types";

const G = "https://graph.facebook.com/v21.0";
type Token = { access_token: string; expires_in?: number };
type Me = { name?: string };

/** Stores the studio's long-lived Meta user token (~60 days; reconnect to renew). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = verifyState(url.searchParams.get("state"));
  const code = url.searchParams.get("code");
  const back = (q: string) => NextResponse.redirect(`${url.origin}/admin?${q}`);
  if (!state || !code) return back("error=meta_state");

  const appId = process.env.META_APP_ID!, secret = process.env.META_APP_SECRET!;
  const redirect = `${url.origin}/api/integrations/meta/callback`;
  try {
    const short = await getJson<Token>(`${G}/oauth/access_token?client_id=${appId}&client_secret=${secret}&redirect_uri=${encodeURIComponent(redirect)}&code=${code}`);
    const long = await getJson<Token>(`${G}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${secret}&fb_exchange_token=${short.access_token}`);
    const me = await getJson<Me>(`${G}/me?fields=name&access_token=${long.access_token}`).catch((): Me => ({}));
    const db = await createWriterClient();
    const expires = new Date(Date.now() + (long.expires_in ?? 60 * 86400) * 1000).toISOString();
    if (state.slug) {
      const { data: client } = await db.from("clients").select("id").eq("slug", state.slug).maybeSingle();
      if (!client) return back("error=unknown_client");
      await db.from("client_integrations").upsert({ client_id: client.id, meta_user_token: long.access_token, meta_account_label: me.name ?? null, meta_expires_at: expires, updated_at: new Date().toISOString() }, { onConflict: "client_id" });
      return back(`connected=meta&client=${encodeURIComponent(state.slug)}`);
    }
    await db.from("studio_connections").upsert({
      provider: "meta", access_token: long.access_token, account_label: me.name ?? null,
      expires_at: expires, connected_at: new Date().toISOString(),
    }, { onConflict: "provider" });
    return back("connected=meta");
  } catch (e) {
    return back(`error=meta_exchange&detail=${encodeURIComponent(e instanceof Error ? e.message.slice(0, 120) : "")}`);
  }
}
