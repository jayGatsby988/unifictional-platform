import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, MapPin, Phone } from "lucide-react";
import { Section, SubHead } from "@/components/Section";
import { GenerationStatusSelect } from "@/components/GenerationStatus";
import { getPortal } from "@/lib/data/repo";
import { quote } from "@/lib/quote";
import { fmt } from "@/lib/utils";

export default async function GenerationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getPortal();
  const g = d.estimator.generations.find((x) => x.id === id);
  if (!g) notFound();
  const optionIds = d.estimator.pricing.options.filter((o) => g.options.includes(o.name)).map((o) => o.id);
  const today = quote(d.estimator.pricing, g.projectTypeId, g.size, optionIds);

  return (
    <>
      <Link href="/estimator" className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink mb-4"><ArrowLeft className="h-3.5 w-3.5" /> All quotes</Link>
      <Section num="05" label={`Quote · ${fmt.dateLong(g.at)}`} title={`${g.projectType}, ${fmt.int(g.size)} ${g.unit === "sqft" ? "sq ft" : g.unit}.`}
        action={g.contact ? <div className="w-44"><GenerationStatusSelect id={g.id} status={g.status} /></div> : <span className="pill pill-neutral">No contact left</span>}
      />

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-2xl bg-ink text-bone p-6">
            <p className="label !text-bone/60 mb-2">Estimate the homeowner saw</p>
            <p className="font-display text-4xl sm:text-5xl leading-none">${fmt.int(g.quoteLow)} – ${fmt.int(g.quoteHigh)}</p>
            <p className="mt-3 text-sm text-bone/70">Generated on <span className="font-mono">{g.sourcePage}</span> · {g.options.length ? g.options.join(" · ") : "no options added"}</p>
          </div>

          <div className="panel p-5">
            <SubHead>With today&apos;s pricing</SubHead>
            {today ? (
              <>
                <ul className="divide-y divide-line text-sm">
                  {today.lines.map((l, i) => <li key={i} className="flex justify-between gap-4 py-2"><span>{l.name}</span><span className="font-mono text-xs">${fmt.int(l.amount)}</span></li>)}
                  <li className="flex justify-between gap-4 py-2 font-medium"><span>Range shown</span><span className="font-mono text-xs">${fmt.int(today.low)} – ${fmt.int(today.high)}</span></li>
                </ul>
                {(today.low !== g.quoteLow || today.high !== g.quoteHigh) && (
                  <p className="mt-3 text-xs text-warn">Pricing has changed since this quote was generated. The homeowner saw the numbers above in black.</p>
                )}
              </>
            ) : (
              <p className="text-sm text-ink-muted">This project type is no longer in your pricing.</p>
            )}
          </div>

          {g.notes && <div className="panel p-5"><SubHead>Notes</SubHead><p className="text-sm">{g.notes}</p></div>}
        </div>

        <div className="panel p-5 h-fit">
          <SubHead>Homeowner</SubHead>
          {g.contact ? (
            <div className="space-y-3 text-sm">
              <p className="font-display text-2xl leading-none">{g.contact.name}</p>
              {g.contact.phone && <a href={`tel:${g.contact.phone}`} className="flex items-center gap-2 hover:underline"><Phone className="h-4 w-4 text-ink-muted" />{g.contact.phone}</a>}
              {g.contact.email && <a href={`mailto:${g.contact.email}`} className="flex items-center gap-2 hover:underline"><Mail className="h-4 w-4 text-ink-muted" />{g.contact.email}</a>}
              {g.contact.address && <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-ink-muted" />{g.contact.address}</p>}
              <p className="pt-2 text-xs text-ink-muted">Also in your CRM as a website lead.</p>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">They sized the project and saw a price but didn&apos;t leave details. Anonymous sessions still tell you what people want priced.</p>
          )}
        </div>
      </div>
    </>
  );
}
