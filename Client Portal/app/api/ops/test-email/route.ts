import { NextResponse } from "next/server";
import { emailConfigured, sendEmail, signOffFor, STUDIO_EMAIL } from "@/lib/email/send";
import { dashboardReadyEmail, welcomeEmail } from "@/lib/email/templates";

/** Ops-only (Bearer CRON_SECRET): send sample client emails to the studio inbox. Creates no accounts. */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!emailConfigured) return NextResponse.json({ error: "Email isn't configured." }, { status: 503 });
  const origin = new URL(request.url).origin;
  const w = welcomeEmail({ name: "Sample Client", email: "client@example.com", tempPassword: "Cedar-Harbor-4821", loginUrl: `${origin}/login`, company: "Sample Construction", signOff: signOffFor("onboarding") });
  const r = dashboardReadyEmail({ name: "Sample Client", company: "Sample Construction", loginUrl: `${origin}/login`, signOff: signOffFor("updates") });
  const a = await sendEmail({ to: STUDIO_EMAIL, sender: "onboarding", ...w, subject: `[PREVIEW] ${w.subject}` });
  const b = await sendEmail({ to: STUDIO_EMAIL, sender: "updates", ...r, subject: `[PREVIEW] ${r.subject}` });
  return NextResponse.json({ to: STUDIO_EMAIL, welcome: a, ready: b });
}
