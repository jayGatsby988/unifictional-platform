import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Mail } from "lucide-react";
import { getSupport } from "@/lib/data/studio";
import { ItemControls } from "@/components/studio/ItemControls";
import { ago } from "@/lib/ago";

const TYPE: Record<string, string> = { website: "Website", seo: "Search / SEO", social: "Social", estimator: "Quote tool", billing: "Billing / plans", other: "Other" };

export default async function SupportItem({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await getSupport(id);
  if (!r) notFound();
  return (
    <>
      <Link href="/studio?tab=support" className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink mb-4"><ArrowLeft className="h-3.5 w-3.5" /> Inbox</Link>
      <p className="label mb-2">Support · {TYPE[r.type] ?? r.type} · {ago(r.created_at)}</p>
      <h1 className="font-display text-3xl sm:text-4xl leading-none mb-2">{r.title}</h1>
      <p className="text-sm text-ink-muted">{r.clients?.name}{r.requester_email ? ` · ${r.requester_email}` : ""}</p>
      <div className="mt-8 grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="panel p-6">
            <p className="label mb-2">What they asked</p>
            <p className="whitespace-pre-wrap leading-relaxed">{r.body || <span className="text-ink-muted">No details given.</span>}</p>
          </div>
          {r.clients && (
            <div className="panel p-5 flex flex-wrap gap-2">
              <Link href={`/api/client/open?slug=${r.clients.slug}`} className="btn btn-ink !py-2 !px-4 text-xs">Open {r.clients.name}&apos;s dashboard <ArrowUpRight className="h-3.5 w-3.5" /></Link>
              {r.clients.website_url && <a href={r.clients.website_url} target="_blank" rel="noreferrer" className="btn btn-ghost !py-2 !px-4 text-xs">Their website <ArrowUpRight className="h-3.5 w-3.5" /></a>}
              {r.requester_email && <a href={`mailto:${r.requester_email}?subject=${encodeURIComponent(`Re: ${r.title}`)}`} className="btn btn-ghost !py-2 !px-4 text-xs"><Mail className="h-3.5 w-3.5" /> Email them</a>}
            </div>
          )}
        </div>
        <ItemControls kind="support" id={r.id} status={r.status ?? "open"} text={r.reply ?? ""} />
      </div>
    </>
  );
}
