import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Mail, Phone } from "lucide-react";
import { getInspection, hostOf } from "@/lib/data/studio";
import { ItemControls } from "@/components/studio/ItemControls";
import { CreateCompany } from "@/components/studio/CreateCompany";
import { ago } from "@/lib/ago";

export default async function InspectionLead({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await getInspection(id);
  if (!a) notFound();
  const r = a.report ?? {};
  const seo = r.seo ?? null;
  const fails = (r.checks ?? []).filter((c: { status: string }) => c.status === "fail");
  return (
    <>
      <Link href="/studio?tab=leads" className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink mb-4"><ArrowLeft className="h-3.5 w-3.5" /> Inbox</Link>
      <p className="label mb-2">Inspection lead · {ago(a.created_at)}</p>
      <h1 className="font-display text-3xl sm:text-4xl leading-none mb-1">{a.company || hostOf(a.url)}</h1>
      <a href={a.url} target="_blank" rel="noreferrer" className="text-sm text-ink-muted underline inline-flex items-center gap-1">{hostOf(a.url)} <ArrowUpRight className="h-3.5 w-3.5" /></a>

      <div className="mt-8 grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-2xl bg-ink text-bone p-6 flex flex-wrap items-end gap-6">
            <div><p className="font-display text-7xl leading-none">{r.summary?.grade ?? "?"}</p><p className="label !text-bone/50 mt-1">overall</p></div>
            {seo && <div><p className="font-display text-5xl leading-none">{seo.score}<span className="text-xl">/100</span></p><p className="label !text-bone/50 mt-1">SEO</p></div>}
            <div className="flex-1 min-w-[14rem]">
              <p className="font-display text-xl leading-tight">{seo?.verdict ?? r.summary?.headline}</p>
              {r.summary?.fixFirst?.length > 0 && <p className="text-sm text-bone/70 mt-2">Fix first: {r.summary.fixFirst.join(" · ")}</p>}
            </div>
          </div>
          <div className="panel p-5">
            <p className="label mb-3">Talking points for the call</p>
            <ul className="space-y-2 text-sm">
              {seo?.trade && <li>They read as a <b>{seo.trade}</b>{seo.city ? <> in <b>{seo.city}</b></> : null}. {seo.rankingsChecked ? `On page one for ${seo.pageOneCount} of ${seo.rankings.filter((x: { checked: boolean }) => x.checked).length} local searches.` : "Rankings weren't checked (no search key yet)."}</li>}
              {fails.slice(0, 5).map((c: { label: string; detail: string }) => <li key={c.label}><b>{c.label}.</b> <span className="text-ink-muted">{c.detail}</span></li>)}
              {(seo?.issues ?? []).filter((x: { severity: string }) => x.severity === "fail").slice(0, 3).map((x: { label: string; detail: string }) => <li key={x.label}><b>{x.label}.</b> <span className="text-ink-muted">{x.detail}</span></li>)}
              {fails.length === 0 && !seo?.issues?.length && <li className="text-ink-muted">Clean site. Lead with content, reviews and the portal.</li>}
            </ul>
            <Link href={`/report/${a.id}`} target="_blank" className="mt-4 inline-flex items-center gap-1 text-xs underline">The report they saw <ArrowUpRight className="h-3.5 w-3.5" /></Link>
          </div>
          <CreateCompany initial={{ name: a.company ?? "", website: a.url, email: a.email, industry: seo?.trade ?? "", city: seo?.city ?? "" }} from={{ kind: "inspection", id: a.id }} />
        </div>
        <div className="space-y-4">
          <div className="panel p-5 space-y-2 text-sm">
            <p className="label mb-1">Contact</p>
            <p className="font-medium">{a.name || "—"}</p>
            {a.email && <a className="flex items-center gap-2 hover:underline" href={`mailto:${a.email}?subject=${encodeURIComponent(`Your website inspection — ${hostOf(a.url)}`)}`}><Mail className="h-4 w-4 text-ink-muted" />{a.email}</a>}
            {a.phone && <a className="flex items-center gap-2 hover:underline" href={`tel:${a.phone}`}><Phone className="h-4 w-4 text-ink-muted" />{a.phone}</a>}
          </div>
          <ItemControls kind="inspection" id={a.id} status={a.status ?? "new"} text={a.notes ?? ""} />
        </div>
      </div>
    </>
  );
}
