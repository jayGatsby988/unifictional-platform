import { NextResponse } from "next/server";
import { getSession } from "@/lib/data/repo";
import { signState } from "@/lib/integrations/oauth-state";

const SCOPES = ["pages_show_list", "pages_read_engagement", "read_insights", "instagram_basic", "instagram_manage_insights", "business_management"];

/** Studio-level: the admin logs in with the Facebook account that administers the clients' Pages. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session.isAdmin || session.isDemo) return NextResponse.json({ error: "Admins only (and not in demo mode)." }, { status: 403 });
  const appId = process.env.META_APP_ID;
  if (!appId) return NextResponse.json({ error: "META_APP_ID is not set." }, { status: 503 });
  const url = new URL(request.url);
  const slug = url.searchParams.get("client") ?? "";
  const params = new URLSearchParams({
    client_id: appId, redirect_uri: `${url.origin}/api/integrations/meta/callback`, response_type: "code", scope: SCOPES.join(","), state: signState({ by: session.email, slug }),
  });
  return NextResponse.redirect(`https://www.facebook.com/v21.0/dialog/oauth?${params}`);
}
