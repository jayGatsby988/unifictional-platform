import { Section, SubHead } from "@/components/Section";
import { StatusPill } from "@/components/Stat";
import { RequestForm } from "@/components/RequestForm";
import { getPortal } from "@/lib/data/repo";
import { fmt } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = { website: "Website", seo: "Search", social: "Social", estimator: "Quote tool", other: "Other" };

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ type?: string; about?: string }> }) {
  const sp = await searchParams;
  const d = await getPortal();
  return (
    <>
      <Section num="06" label="Requests" title="Ask for anything."
        intro="New photos for the site, a post you want out this week, a change to a model. Send it here and it lands with your studio contact." />

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <SubHead>New request</SubHead>
          <RequestForm initialType={sp.type} initialTitle={sp.about} />
        </div>
        <div>
          <SubHead>Recent</SubHead>
          <div className="panel divide-y divide-line">
            {d.requests.map((r) => (
              <div key={r.id} className="p-4">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="label !text-[9px]">{TYPE_LABEL[r.type]} · {fmt.date(r.createdAt)}</span>
                  <StatusPill status={r.status} />
                </div>
                <p className="text-sm font-medium leading-snug">{r.title}</p>
                {r.body && <p className="text-sm text-ink-muted mt-1 line-clamp-2">{r.body}</p>}
                {r.reply && <p className="text-sm mt-2 border-l-2 border-ink pl-3"><span className="label !text-[9px] block mb-0.5">Unifictional replied</span>{r.reply}</p>}
              </div>
            ))}
            {d.requests.length === 0 && <p className="p-4 text-sm text-ink-muted">No requests yet.</p>}
          </div>
        </div>
      </div>
    </>
  );
}
