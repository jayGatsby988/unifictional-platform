import { NextResponse } from "next/server";
import { getSession } from "@/lib/data/repo";
import { SCOPES } from "@/lib/integrations/google-auth";
import { signState } from "@/lib/integrations/oauth-state";

/**
 * Studio-level: the portal admin connects Unifictional's own Google account once.
 * It must be a Viewer on each client's GA4 property, a user on their Search
 * Console property, and a manager on their Business Profile listing — the
 * agency access the studio already has.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session.isAdmin || session.isDemo) return NextResponse.json({ error: "Admins only (and not in demo mode)." }, { status: 403 });
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: "GOOGLE_OAUTH_CLIENT_ID is not set." }, { status: 503 });
  const url = new URL(request.url);
  const slug = url.searchParams.get("client") ?? "";
  const params = new URLSearchParams({
    client_id: clientId, redirect_uri: `${url.origin}/api/integrations/google/callback`, response_type: "code",
    scope: [SCOPES.analytics, SCOPES.searchConsole, SCOPES.business, "openid", "email"].join(" "),
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state: signState({ by: session.email, slug }),
  });
  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
