import Link from "next/link";
import { Calculator } from "lucide-react";
import { ChevronRight, Code2, ExternalLink } from "lucide-react";
import { Section, SubHead } from "@/components/Section";
import { Delta, Stat, StatusPill } from "@/components/Stat";
import { PricingEditor } from "@/components/PricingEditor";
import { GenerationStatusSelect } from "@/components/GenerationStatus";
import { getPortal } from "@/lib/data/repo";
import { fmt } from "@/lib/utils";

export default async function EstimatorPage() {
  const d = await getPortal();
  const e = d.estimator;
  const site = d.client.websiteUrl.replace(/\/$/, "");
  const newLeads = e.generations.filter((g) => g.status === "new" && g.contact).length;
  const live = e.embedded || e.generations.length > 0;

  return (
    <>
      <Section num="04" label="Quote tool" title="Your instant-quote tool."
        intro="Homeowners size up their project in 3D on your website and get a price range on the spot. Here is what it produced, and the prices it uses."
        action={e.embedded ? (
          <a href={`${site}${e.embedPath}`} target="_blank" rel="noreferrer" className="btn btn-ghost"><ExternalLink className="h-4 w-4" />See it on your site</a>
        ) : undefined}
      />

      {!live && (
        <div className="panel p-6 sm:p-8 mb-10 flex flex-wrap items-start gap-5">
          <span className="h-12 w-12 rounded-full bg-sand grid place-items-center shrink-0"><Calculator className="h-5 w-5" /></span>
          <div className="flex-1 min-w-[15rem]">
            <p className="font-display text-2xl leading-tight">The quote tool isn&apos;t on your website yet.</p>
            <p className="mt-1 text-ink-muted max-w-2xl">It lets homeowners size up their project in 3D and see a price range on the spot, then leave their details. You can set your prices below now, so it&apos;s ready the day we switch it on.</p>
            <Link href={`/requests?type=estimator&about=${encodeURIComponent("Add the quote tool to my website")}`} className="btn btn-ink !py-2 !px-4 text-sm mt-4">Ask us to add it</Link>
          </div>
        </div>
      )}

      {live && (<>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Stat label="Homeowners used it · 30d" value={e.stats30.sessions} delta={<Delta now={e.stats30.sessions} prev={e.prev30.sessions} />} />
        <Stat label="3D models generated" value={e.stats30.generated} delta={<Delta now={e.stats30.generated} prev={e.prev30.generated} />} sub={`${Math.round((e.stats30.generated / Math.max(e.stats30.sessions, 1)) * 100)}% of visitors finish`} />
        <Stat label="Quotes shown" value={e.stats30.quotesSent} delta={<Delta now={e.stats30.quotesSent} prev={e.prev30.quotesSent} />} />
        <Stat label="Left contact details" value={e.stats30.leads} delta={<Delta now={e.stats30.leads} prev={e.prev30.leads} />} sub={newLeads ? `${newLeads} not contacted yet` : "all followed up"} />
      </div>

      <div className="panel p-4 mb-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="flex items-center gap-2"><Code2 className="h-4 w-4" /><StatusPill status={e.embedded ? "live" : "building"} /></span>
        <span className="text-ink-muted">Embedded at <span className="font-mono text-ink">{site}{e.embedPath}</span></span>
        <span className="text-ink-muted">Pricing last published <span className="font-mono text-ink">{fmt.dateLong(e.pricing.updatedAt)}</span></span>
      </div>

      <div className="mb-10">
        <SubHead right={<span className="label !text-[9px]">Newest first</span>}>Quotes homeowners generated</SubHead>
        <div className="panel overflow-x-auto">
          <table className="table w-full min-w-[760px]">
            <thead><tr><th>When</th><th>Project</th><th className="text-right">Size</th><th>Options</th><th className="text-right">Estimate</th><th>Homeowner</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {e.generations.map((g) => (
                <tr key={g.id}>
                  <td className="font-mono text-xs whitespace-nowrap">{fmt.date(g.at)}</td>
                  <td className="whitespace-nowrap">{g.projectType}</td>
                  <td className="text-right font-mono text-xs whitespace-nowrap">{fmt.int(g.size)} {g.unit === "sqft" ? "sq ft" : g.unit}</td>
                  <td className="text-xs text-ink-muted max-w-[220px] truncate">{g.options.length ? g.options.join(", ") : "—"}</td>
                  <td className="text-right font-mono text-xs whitespace-nowrap">${fmt.compact(g.quoteLow)} – ${fmt.compact(g.quoteHigh)}</td>
                  <td className="whitespace-nowrap">{g.contact ? <span>{g.contact.name}</span> : <span className="text-ink-muted text-xs">anonymous</span>}</td>
                  <td>{g.contact ? <GenerationStatusSelect id={g.id} status={g.status} compact /> : <span className="pill pill-neutral">no contact</span>}</td>
                  <td><Link href={`/estimator/${g.id}`} className="text-ink-muted hover:text-ink"><ChevronRight className="h-4 w-4" /></Link></td>
                </tr>
              ))}
              {e.generations.length === 0 && <tr><td colSpan={8} className="text-sm text-ink-muted">Nothing generated yet. Once the tool is live on your site, every quote shows up here.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      </>)}

      <SubHead>Pricing &amp; options</SubHead>
      <p className="text-sm text-ink-muted mb-4 max-w-2xl">These numbers drive every estimate on your site. Change a rate, check the preview, then publish. We review big changes with you before the next sprint.</p>
      <PricingEditor initial={e.pricing} industry={`${d.client.industry} ${d.client.services.join(" ")}`} />
    </>
  );
}
