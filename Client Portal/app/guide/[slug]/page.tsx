import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, UserRound, ListChecks, CheckCircle2, Mail } from "lucide-react";
import { GUIDES, getGuide, STUDIO_EMAIL } from "@/lib/guides";
import { DEMOS } from "@/lib/walkthroughs";
import { CopyMessage } from "@/components/landing/CopyMessage";
import { GuideInteractive } from "@/components/landing/GuideInteractive";

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const g = getGuide((await params).slug);
  return { title: g ? `${g.title} — Unifictional setup guide` : "Guide", description: g?.short };
}

export default async function GuidePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ for?: string; studio?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const g = getGuide(slug);
  if (!g) notFound();
  const n = GUIDES.findIndex((x) => x.slug === slug);
  const demo = DEMOS[slug] ?? null;

  const info = (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="panel p-5"><p className="label mb-2 flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />How long</p><p className="font-display text-3xl">{g.minutes} minutes</p></div>
      <div className="panel p-5 lg:col-span-2"><p className="label mb-2 flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" />Who does this</p><p className="gbody">{g.who}</p></div>
      <div className="panel p-5 lg:col-span-2"><p className="label mb-2">Why we ask</p><p className="gbody leading-relaxed">{g.why}</p></div>
      <div className="panel p-5"><p className="label mb-2 flex items-center gap-1.5"><ListChecks className="h-3.5 w-3.5" />Have ready</p><ul className="gbody space-y-1.5">{g.needs.map((x) => <li key={x} className="flex gap-2"><span className="mt-2.5 h-1 w-1 rounded-full bg-ink shrink-0" />{x}</li>)}</ul></div>
    </div>
  );

  return (
    <article className="max-w-5xl mx-auto px-5 sm:px-8 py-10 sm:py-14">
      <Link href="/guide" className="no-print inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink mb-6"><ArrowLeft className="h-4 w-4" /> All guides</Link>
      <p className="label mb-3">{String(n + 1).padStart(2, "0")} / Setup guide{sp.for ? ` · for ${sp.for}` : ""}</p>
      <h1 className="font-display text-4xl sm:text-6xl leading-[0.95] max-w-3xl">{g.title}.</h1>
      <p className="mt-4 text-lg sm:text-xl text-ink-muted max-w-2xl">{g.short}</p>

      <div className="mt-8">
        <GuideInteractive guide={g} demo={demo} info={info} />
      </div>

      <section className="mt-14 rounded-2xl bg-ink text-bone p-6 sm:p-8">
        <p className="label !text-bone/60 mb-2 flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" />How you&apos;ll know it worked</p>
        <p className="text-lg sm:text-xl leading-relaxed max-w-3xl">{g.verify}</p>
      </section>

      <section className="mt-14">
        <h2 className="font-display text-3xl mb-4">Questions people ask</h2>
        <dl className="grid md:grid-cols-2 gap-4">
          {g.faq.map((f) => <div key={f.q} className="panel p-5"><dt className="font-medium text-lg mb-1">{f.q}</dt><dd className="gbody text-ink-muted">{f.a}</dd></div>)}
        </dl>
      </section>

      <section className="no-print mt-14 panel p-6 sm:p-8 flex flex-wrap items-center justify-between gap-5">
        <div className="max-w-xl">
          <p className="font-display text-2xl sm:text-3xl leading-tight">Rather not do it yourself?</p>
          <p className="mt-2 text-ink-muted gbody">Send us a note and we&apos;ll do it together over the phone. It takes five minutes and you won&apos;t have to find a single button.</p>
        </div>
        <a href={`mailto:${STUDIO_EMAIL}?subject=${encodeURIComponent(`Help with: ${g.title}`)}`} className="wt-btn wt-btn-primary"><Mail className="h-5 w-5" /> Do it with me</a>
      </section>

      {sp.studio !== undefined && (
        <section className="no-print mt-14">
          <h2 className="font-display text-3xl mb-1">Send this to the client</h2>
          <p className="text-sm text-ink-muted mb-4">Studio-only view. Copy and paste into a text or email.</p>
          <CopyMessage text={g.message} />
        </section>
      )}
    </article>
  );
}
