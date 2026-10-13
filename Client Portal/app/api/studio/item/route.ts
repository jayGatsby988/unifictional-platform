import { NextResponse } from "next/server";
import { getSession } from "@/lib/data/repo";
import { createClient } from "@/lib/supabase/server";
import { emailConfigured, sendEmail, signOffFor, STUDIO_EMAIL } from "@/lib/email/send";
import { requestReplyEmail } from "@/lib/email/templates";

const TABLE = { inspection: "audit_reports", signup: "signup_requests", support: "requests" } as const;
const LEAD = new Set(["new", "contacted", "qualified", "won", "lost"]);
const SUPPORT = new Set(["open", "in_progress", "done"]);

/** Update status / notes / reply on any inbox item. Admins only (RLS enforces it too). */
export async function PATCH(request: Request) {
  const session = await getSession();
  if (session.isDemo) return NextResponse.json({ error: "Demo mode: connect Supabase to save changes (Setup & keys)." }, { status: 403 });
  if (!session.isAdmin) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const kind = body.kind as keyof typeof TABLE;
  if (!TABLE[kind] || typeof body.id !== "string") return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const patch: Record<string, string> = { updated_at: new Date().toISOString() };
  if (typeof body.status === "string") {
    if (!(kind === "support" ? SUPPORT : LEAD).has(body.status)) return NextResponse.json({ error: "Unknown status." }, { status: 400 });
    patch.status = body.status;
  }
  if (typeof body.notes === "string" && kind !== "support") patch.notes = body.notes.slice(0, 5000);
  if (typeof body.reply === "string" && kind === "support") patch.reply = body.reply.slice(0, 5000);
  const db = await createClient();
  const before = kind === "support" && patch.reply ? (await db.from("requests").select("reply, title, requester_email").eq("id", body.id).maybeSingle()).data : null;
  const { error } = await db.from(TABLE[kind]).update(patch).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // A new or changed reply goes to the client by email, so the portal's "we'll reply by email" is true.
  let emailed = false;
  const reply = patch.reply?.trim();
  if (before && reply && reply !== (before.reply ?? "").trim() && before.requester_email && emailConfigured) {
    const portalUrl = `${new URL(request.url).origin}/login?email=${encodeURIComponent(before.requester_email)}&next=${encodeURIComponent("/requests")}`;
    const mail = requestReplyEmail({ title: before.title ?? "Your request", reply, done: patch.status === "done", portalUrl, signOff: signOffFor("updates") });
    emailed = (await sendEmail({ to: before.requester_email, sender: "updates", replyTo: STUDIO_EMAIL, ...mail })).sent;
  }
  return NextResponse.json({ ok: true, emailed });
}
