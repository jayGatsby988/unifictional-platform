import Link from "next/link";
import { Check, Clock, FileSearch, MessageSquare } from "lucide-react";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";

/**
 * What a brand-new client sees before the studio has connected their company:
 * a warm welcome, what happens next, and their free website check if we ran one.
 */
export async function WelcomePending({ email, name }: { email: string; name: string }) {
  let report: { id: string; grade: string | null } | null = null;
  if (adminConfigured && email) {
    const { data } = await createAdminClient().from("audit_reports").select("id, report").eq("email", email.toLowerCase()).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (data) report = { id: data.id, grade: (data.report as { summary?: { grade?: string } })?.summary?.grade ?? null };
  }
  const firstName = name.trim().split(/\s+/)[0];
  const steps = [
    { icon: Check, done: true, title: "Your account is created", body: "You're signed in. Nothing else to set up on your end." },
    { icon: Clock, done: false, title: "We connect your company", body: "We link your website, Google and social media to this dashboard, usually within one business day." },
    { icon: MessageSquare, done: false, title: "We email you when it's ready", body: "You'll get an email that says \"Your dashboard is ready.\" Then this page fills in with your numbers." },
  ];
  return (
    <div className="max-w-2xl space-y-6">
      <div className="panel p-6 sm:p-8">
        <p className="label mb-2">Welcome</p>
        <h1 className="font-display text-4xl uppercase leading-none mb-3">Thanks for choosing Unifictional{firstName ? `, ${firstName}` : ""}.</h1>
        <p className="text-base text-ink-muted">We&apos;re setting up your dashboard now. Here&apos;s exactly what happens next.</p>
        <ol className="mt-6 space-y-5">
          {steps.map((s, i) => (
            <li key={s.title} className="flex gap-4">
              <span className={`grid place-items-center h-10 w-10 rounded-full shrink-0 ${s.done ? "bg-ink text-bone" : "bg-sand"}`}><s.icon className="h-5 w-5" /></span>
              <div>
                <p className="text-lg font-medium leading-tight">{i + 1}. {s.title}</p>
                <p className="text-base text-ink-muted mt-1">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
      {report && (
        <Link href={`/report/${report.id}`} className="panel p-6 flex items-center gap-4 hover:border-ink transition">
          <span className="grid place-items-center h-12 w-12 rounded-full bg-sand shrink-0"><FileSearch className="h-5 w-5" /></span>
          <div className="min-w-0">
            <p className="text-lg font-medium leading-tight">Your free website check is ready{report.grade ? `: grade ${report.grade}` : ""}</p>
            <p className="text-base text-ink-muted">See what&apos;s working and the first things we&apos;ll fix.</p>
          </div>
        </Link>
      )}
      <div className="panel p-6">
        <p className="text-base"><b>Questions?</b> Email <a className="underline" href="mailto:unifictional@gmail.com">unifictional@gmail.com</a> or reply to your welcome email. A real person answers.</p>
      </div>
    </div>
  );
}
