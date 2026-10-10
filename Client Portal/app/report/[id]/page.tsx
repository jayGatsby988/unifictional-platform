import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/Logo";
import { ReportView } from "@/components/landing/ReportView";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { AuditReport } from "@/lib/audit";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  // Reports are readable by admins (session) or via the service role; the link is unguessable.
  const db = adminConfigured ? createAdminClient() : await createClient();
  const { data } = await db.from("audit_reports").select("report, url, created_at").eq("id", id).maybeSingle();
  if (!data) notFound();
  const report = data.report as AuditReport;
  return (
    <main className="flex-1">
      <header className="border-b border-line">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3"><Logo className="h-8 w-8" /><span className="font-display text-lg tracking-wide">Unifictional</span></Link>
          <Link href="/" className="btn btn-ghost !py-2 !px-4 text-sm">Inspect another site</Link>
        </div>
      </header>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <p className="label mb-2">Free inspection report · {new Date(data.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
        <h1 className="font-display text-3xl sm:text-4xl mb-8">{report.finalUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}</h1>
        <ReportView report={report} permalink={null} />
      </div>
    </main>
  );
}
