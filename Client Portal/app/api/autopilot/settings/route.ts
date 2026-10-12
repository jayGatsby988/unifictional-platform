import { NextResponse } from "next/server";
import { demoMode } from "@/lib/env";
import { getSession } from "@/lib/data/repo";
import { createClient } from "@/lib/supabase/server";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { isCadence } from "@/lib/autopilot/schedule";
import { accessFrom } from "@/lib/autopilot/access";
import { isPostsChoice, postsFor } from "@/lib/billing/packages";
import { normalizeWpUrl, verifyWordpress } from "@/lib/autopilot/publish";
import { isSiteAccess } from "@/lib/autopilot/site-access";
import { normalizeUrl } from "@/lib/audit";

const MODES = new Set(["auto", "approve"]);
const TARGETS = new Set(["blog", "hosted", "wordpress", "manual"]);

/**
 * The client turns SEO Autopilot on, pauses it, or changes how it runs.
 * Body: { enabled, cadence, mode, target, notes, wpUrl?, wpUser?, wpAppPassword?,
 *         platform?, siteUrl?, access?, siteUser?, sitePassword?, inviteSent? }
 * A WordPress login is verified against the site before it is stored (through a
 * definer function, into the admin-only client_integrations table) and is never
 * returned to the browser. A "somewhere else" site (GoDaddy, Wix…) must say how
 * we get posts onto it: invite the studio, share a login (stored the same way), or
 * paste posts themselves.
 */
export async function POST(request: Request) {
  const b = await request.json().catch(() => ({}));
  const enabled = Boolean(b.enabled);
  const cadence = isCadence(b.cadence) ? b.cadence : "weekly";
  const mode = MODES.has(b.mode) ? b.mode : "auto";
  const target = TARGETS.has(b.target) ? b.target : "blog";
  const notes = String(b.notes ?? "").trim().slice(0, 2000);
  const wpUser = String(b.wpUser ?? "").trim().slice(0, 200);
  const wpPass = String(b.wpAppPassword ?? "").trim().slice(0, 200);
  const wpUrl = normalizeWpUrl(String(b.wpUrl ?? ""));
  // "Somewhere else" sites: which builder, the address, and how we get posts onto it.
  const platform = String(b.platform ?? "").trim().slice(0, 40);
  const access = isSiteAccess(b.access) ? b.access : null;
  const siteUrl = String(b.siteUrl ?? "").trim() ? normalizeUrl(String(b.siteUrl)) : "";
  const siteUser = String(b.siteUser ?? "").trim().slice(0, 200);
  const sitePass = String(b.sitePassword ?? "").slice(0, 200);
  const inviteSent = Boolean(b.inviteSent);

  if (demoMode) return NextResponse.json({ ok: true, demo: true, enabled });

  const session = await getSession();
  if (!session.client) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const cid = session.client.id;
  const db = await createClient();
  const { data: prev } = await db.from("seo_autopilot").select("*").eq("client_id", cid).maybeSingle();
  if (enabled && !session.isAdmin && !accessFrom(prev)) return NextResponse.json({ error: "Start the SEO Autopilot plan first; it unlocks the moment Square confirms your card." }, { status: 402 });
  // A bought package sets the ceiling on how often we post; the studio and comped companies choose freely.
  const planPosts = !session.isAdmin && !prev?.comped && isPostsChoice(prev?.package?.posts) ? prev.package.posts : null;
  if (planPosts && postsFor(cadence) > planPosts) return NextResponse.json({ error: `Your plan includes ${planPosts} post${planPosts === 1 ? "" : "s"} a month. Change your plan on the Plans page to post more often.` }, { status: 402 });

  let wpConnected = Boolean(prev?.wp_connected);
  if (target === "wordpress" && enabled) {
    if (wpPass || wpUser || wpUrl) {
      if (!wpUrl) return NextResponse.json({ error: "Enter your WordPress site address." }, { status: 400 });
      if (!wpUser || !wpPass) return NextResponse.json({ error: "Enter the WordPress username and the application password." }, { status: 400 });
      const check = await verifyWordpress(wpUrl, wpUser, wpPass);
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
      const { error } = await db.rpc("autopilot_set_wordpress", { p_client: cid, p_url: wpUrl, p_user: wpUser, p_password: wpPass });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      wpConnected = true;
    } else if (!wpConnected) {
      return NextResponse.json({ error: "Add your WordPress login so we can publish for you." }, { status: 400 });
    }
  }

  const now = new Date().toISOString();
  let siteFields: Record<string, unknown> = {};
  if (target === "manual" && enabled) {
    if (!platform) return NextResponse.json({ error: "Tell us which site builder your website is on." }, { status: 400 });
    if (!access) return NextResponse.json({ error: "Choose how we get posts onto your site." }, { status: 400 });
    if (!siteUrl && !session.client.websiteUrl) return NextResponse.json({ error: "Enter your website address." }, { status: 400 });
    const loginOnFile = Boolean(prev?.site_login_on_file) || Boolean(siteUser && sitePass);
    if (access === "login" && !loginOnFile) return NextResponse.json({ error: `Enter the username and password for your ${platform} account, or choose "Invite us" instead.` }, { status: 400 });
    if (siteUrl || (siteUser && sitePass)) {
      const { error } = await db.rpc("autopilot_set_site", { p_client: cid, p_url: siteUrl || null, p_user: siteUser || null, p_password: sitePass || null });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    siteFields = {
      site_platform: platform, site_access: access, site_login_on_file: loginOnFile,
      site_invite_sent_at: access === "invite" ? (inviteSent ? prev?.site_invite_sent_at ?? now : null) : prev?.site_invite_sent_at ?? null,
    };
  }
  // Switching on (or back on) makes the first post due at the next daily run.
  const nextRunAt = enabled ? (prev?.enabled && prev?.next_run_at ? prev.next_run_at : now) : prev?.next_run_at ?? null;
  const { error } = await db.from("seo_autopilot").upsert(
    { client_id: cid, enabled, cadence, mode, target, notes: notes || null, wp_connected: wpConnected, next_run_at: nextRunAt, updated_at: now, ...siteFields },
    { onConflict: "client_id" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (adminConfigured && Boolean(prev?.enabled) !== enabled) {
    await createAdminClient().from("activity").insert({ client_id: cid, area: "seo", title: enabled ? "SEO Autopilot switched on" : "SEO Autopilot paused" });
  }
  return NextResponse.json({ ok: true, enabled, wpConnected });
}
