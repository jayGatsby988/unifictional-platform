import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Mail, Phone } from "lucide-react";
import { getSignup, hostOf } from "@/lib/data/studio";
import { ItemControls } from "@/components/studio/ItemControls";
import { CreateCompany } from "@/components/studio/CreateCompany";
import { CreateLogin } from "@/components/studio/CreateLogin";
import { ago } from "@/lib/ago";

export default async function SignupLead({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSignup(id);
  if (!s) notFound();
  return (
    <>
      <Link href="/studio?tab=leads" className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink mb-4"><ArrowLeft className="h-3.5 w-3.5" /> Inbox</Link>
      <p className="label mb-2">Account request · {ago(s.created_at)}</p>
      <h1 className="font-display text-3xl sm:text-4xl leading-none mb-1">{s.company || s.email}</h1>
      {s.website && <a href={/^https?:/.test(s.website) ? s.website : `https://${s.website}`} target="_blank" rel="noreferrer" className="text-sm text-ink-muted underline inline-flex items-center gap-1">{hostOf(s.website)} <ArrowUpRight className="h-3.5 w-3.5" /></a>}
      <div className="mt-8 grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {s.clients ? (
            <div className="panel p-5 flex flex-wrap items-center justify-between gap-3">
              <div><p className="label mb-1">Linked company</p><p className="font-display text-2xl">{s.clients.name}</p></div>
              <Link href={`/api/client/open?slug=${s.clients.slug}`} className="btn btn-ink !py-2 !px-4 text-xs">Open their dashboard <ArrowUpRight className="h-3.5 w-3.5" /></Link>
            </div>
          ) : null}
          {s.clients ? (
            <CreateLogin slug={s.clients.slug} email={s.email} name={s.name ?? ""} phone={s.phone ?? ""} />
          ) : (
            <CreateCompany title="Create their company and give them access" initial={{ name: s.company ?? "", website: s.website ?? "", email: s.email }} from={{ kind: "signup", id: s.id }} />
          )}
          <div className="panel p-5 text-sm text-ink-muted">
            They asked for a portal account from the sign-up page. Create their company, then create their login and text it to them. After that, assign their data sources under Data connections.
          </div>
        </div>
        <div className="space-y-4">
          <div className="panel p-5 space-y-2 text-sm">
            <p className="label mb-1">Contact</p>
            <p className="font-medium">{s.name || "—"}</p>
            <a className="flex items-center gap-2 hover:underline" href={`mailto:${s.email}`}><Mail className="h-4 w-4 text-ink-muted" />{s.email}</a>
            {s.phone && <a className="flex items-center gap-2 hover:underline" href={`tel:${s.phone}`}><Phone className="h-4 w-4 text-ink-muted" />{s.phone}</a>}
          </div>
          <ItemControls kind="signup" id={s.id} status={s.status ?? "new"} text={s.notes ?? ""} />
        </div>
      </div>
    </>
  );
}
