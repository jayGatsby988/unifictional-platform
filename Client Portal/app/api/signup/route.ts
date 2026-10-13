import { NextResponse, after } from "next/server";
import { randomUUID, createHash } from "node:crypto";
import { pushLeadToGhl } from "@/lib/ghl";
import { supabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { ensureLogin, signInLink } from "@/lib/accounts/create";
import { welcomeLink } from "@/lib/accounts/welcome-link";
import { ensureCompany } from "@/lib/accounts/company";
import { loadRecommendation } from "@/lib/billing/recommend";
import { emailConfigured, sendEmail, signOffFor, STUDIO_EMAIL } from "@/lib/email/send";
import { signInLinkEmail, studioNewSignupEmail, welcomeEmail } from "@/lib/email/templates";
import { normalizeUrl, runAudit } from "@/lib/audit";

export const maxDuration = 60;
const recent = new Map<string, number>();

/**
 * Public "Create my account". Automation, in order:
 *  1. Save the request (studio inbox) and hand the lead to the CRM.
 *  2. Create their login with a temporary password and email it ("Thanks for choosing Unifictional").
 *     Already have a login? Email a one-tap sign-in link instead (never reset a password from here).
 *  3. After responding: run the free website check on their site and email the studio a summary.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (String(body.fax ?? "")) return NextResponse.json({ ok: true, emailed: true }); // honeypot: bots fill every field
  const email = String(body.email ?? "").trim().toLowerCase().slice(0, 200);
  const name = String(body.name ?? "").trim().slice(0, 120);
  const company = String(body.company ?? "").trim().slice(0, 160);
  const phone = String(body.phone ?? "").trim().slice(0, 40);
  const website = String(body.website ?? "").trim().slice(0, 200);
  if (!name) return NextResponse.json({ error: "Please add your name." }, { status: 400 });
  if (!company) return NextResponse.json({ error: "Please add your company name." }, { status: 400 });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "That email doesn't look right. Please check it." }, { status: 400 });

  const origin = new URL(request.url).origin;
  const ipHash = createHash("sha256").update(request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "").digest("hex").slice(0, 32);
  const now = Date.now();
  if ((recent.get(email) ?? 0) > now - 60_000) return NextResponse.json({ ok: true, emailed: true, email }); // double-click / resubmit
  recent.set(email, now);

  // 1. Request for the studio inbox.
  const requestId = randomUUID();
  if (supabaseConfigured) {
    const db = await createClient(); // anon may insert, not read: no RETURNING
    await db.from("signup_requests").insert({ id: requestId, name, email, phone: phone || null, company, website: website || null });
  }
  const crm = pushLeadToGhl({ name, email, phone, company, website, source: "Portal account request", note: `Created a client portal account for ${company}${website ? ` (${website})` : ""}.` }).catch(() => null);

  // 2. Their login, their company (so they land in their own portal), and the welcome email.
  let emailed = false, existing = false, clientId: string | null = null;
  if (adminConfigured && emailConfigured) {
    const login = await ensureLogin({ email, name, extra: { company, ...(phone ? { phone } : {}) } });
    if (login.kind === "created" || login.kind === "exists") {
      const co = await ensureCompany({ userId: login.userId, name, company, website, email });
      clientId = co?.clientId ?? null;
      if (co && supabaseConfigured) await createAdminClient().from("signup_requests").update({ client_id: co.clientId }).eq("id", requestId);
    }
    if (login.kind === "created") {
      // First stop after signing in: the SEO Autopilot page, where they start their plan.
      const mail = welcomeEmail({ name, email, tempPassword: login.password, signInUrl: welcomeLink({ userId: login.userId, nonce: login.welcomeNonce, origin, next: "/autopilot" }), loginUrl: `${origin}/login?email=${encodeURIComponent(email)}&next=${encodeURIComponent("/autopilot")}`, company, signOff: signOffFor("onboarding") });
      emailed = (await sendEmail({ to: email, sender: "onboarding", ...mail })).sent;
    } else if (login.kind === "exists") {
      existing = true;
      const link = await signInLink(email, origin, "/autopilot");
      if (link) emailed = (await sendEmail({ to: email, sender: "onboarding", ...signInLinkEmail({ name, link, signOff: signOffFor("onboarding") }) })).sent;
    } else {
      console.error("[signup] login", login.error);
    }
  }

  // 3. Website check + studio heads-up, after the response so the page feels instant.
  after(async () => {
    let reportUrl: string | undefined;
    const url = website ? normalizeUrl(website) : null;
    // Read their site now so the plan builder's recommendation is ready when they first sign in.
    if (clientId && adminConfigured) await loadRecommendation(createAdminClient(), { id: clientId, name: company, industry: "", city: "", websiteUrl: url ?? "" }).catch(() => null);
    if (url && adminConfigured) {
      try {
        const report = await runAudit(url);
        const id = randomUUID();
        const { error } = await createAdminClient().from("audit_reports").insert({ id, url, email, name, phone: phone || null, company, report, ip_hash: ipHash, notes: "Run automatically at portal sign-up" });
        if (!error) reportUrl = `${origin}/report/${id}`;
      } catch (e) { console.error("[signup] website check", e); }
    }
    await crm;
    if (emailConfigured) {
      await sendEmail({ to: STUDIO_EMAIL, replyTo: email, ...studioNewSignupEmail({ name, company, email, phone, website, studioUrl: `${origin}/studio/signup/${requestId}`, reportUrl }) });
    }
  });

  return NextResponse.json({ ok: true, emailed, existing, email });
}
