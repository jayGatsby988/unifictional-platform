import { NextResponse } from "next/server";
import { getSession } from "@/lib/data/repo";
import { demoMode } from "@/lib/env";
import { createWriterClient } from "@/lib/supabase/admin";
import { getStudioConnection, listGoogleOptions, listMetaPages, googleToken, metaUserToken, type GoogleOptions, type MetaOptions } from "@/lib/integrations/studio";

export type AdminOptions = { google: GoogleOptions | null; meta: MetaOptions | null };

const DEMO: AdminOptions = {
  google: {
    ga4: [{ id: "412345678", label: "Northline Builders · northlinebuilders.com" }, { id: "498877123", label: "Cascade Poolworks · GA4" }],
    gsc: [{ id: "sc-domain:northlinebuilders.com", label: "sc-domain:northlinebuilders.com" }, { id: "https://cascadepoolworks.com/", label: "https://cascadepoolworks.com/" }],
    gbp: [{ id: "1234567890", accountId: "1098765", label: "Northline Builders · Everett, WA" }],
    errors: [],
  },
  meta: { pages: [{ id: "1029384756", label: "Northline Builders", igUserId: "17841400000000000", igUsername: "northlinebuilders" }], errors: [] },
};

/** Everything the studio's connected accounts can see, for the admin dropdowns. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session.isAdmin) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  if (demoMode) return NextResponse.json(DEMO);
  const slug = new URL(request.url).searchParams.get("client");
  const clientId = session.clients.find((c) => c.slug === slug)?.id;
  const db = await createWriterClient();
  const out: AdminOptions = { google: null, meta: null };
  const { data: own } = clientId ? await db.from("client_integrations").select("google_refresh_token").eq("client_id", clientId).maybeSingle() : { data: null };
  const studio = await getStudioConnection(db, "google");
  if (own?.google_refresh_token || studio?.refresh_token || process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try { out.google = await listGoogleOptions(await googleToken(db, "analytics", clientId)); }
    catch (e) { out.google = { ga4: [], gsc: [], gbp: [], errors: [(e as Error).message.slice(0, 200)] }; }
  }
  const m = await metaUserToken(db, clientId);
  if (m) out.meta = await listMetaPages(m);
  return NextResponse.json(out);
}
