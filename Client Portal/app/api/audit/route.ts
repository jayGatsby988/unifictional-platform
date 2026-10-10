import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { runAudit, normalizeUrl } from "@/lib/audit";
import { pushLeadToGhl } from "@/lib/ghl";
import { supabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

// Best-effort per-instance throttle: PageSpeed is slow and rate-limited.
const recent = new Map<string, number[]>();
function throttled(key: string) {
  const now = Date.now();
  const hits = (recent.get(key) ?? []).filter((t) => now - t < 3600e3);
  recent.set(key, [...hits, now]);
  return hits.length >= 5;
}

/** Public: run the free inspection, store it, and hand the lead to the CRM. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const url = normalizeUrl(String(body.url ?? ""));
  const email = String(body.email ?? "").trim().slice(0, 200);
  const name = String(body.name ?? "").trim().slice(0, 120);
  const phone = String(body.phone ?? "").trim().slice(0, 40);
  const company = String(body.company ?? "").trim().slice(0, 160);
  if (!url) return NextResponse.json({ error: "Enter your website address, like yourcompany.com." }, { status: 400 });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "Enter the email we should send the report to." }, { status: 400 });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const ipHash = createHash("sha256").update(ip).digest("hex").slice(0, 32);
  if (throttled(ipHash)) return NextResponse.json({ error: "That's a lot of inspections. Try again in an hour, or email us." }, { status: 429 });

  let report;
  try { report = await runAudit(url); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Could not inspect that site." }, { status: 422 }); }

  const ghlContactId = await pushLeadToGhl({
    name, email, phone, company, website: url, source: "Free inspection report",
    note: `Free inspection for ${url}: grade ${report.summary.grade}, ${report.summary.failed} failed / ${report.summary.warned} warnings. Fix first: ${report.summary.fixFirst.join("; ")}.`,
  });

  let id: string | null = null;
  if (supabaseConfigured) {
    const db = await createClient(); // anon session: insert-only policy on audit_reports
    // The public role may insert but not read audit_reports, so don't ask for the row back
    // (RETURNING would be rejected and roll the insert back). Generate the id here instead.
    const newId = crypto.randomUUID();
    const { error } = await db.from("audit_reports").insert({ id: newId, url, email, name: name || null, phone: phone || null, company: company || null, report, ghl_contact_id: ghlContactId, ip_hash: ipHash });
    if (error) console.error("[audit] could not store report:", error.message);
    else id = newId;
  }
  return NextResponse.json({ ok: true, id, report });
}
