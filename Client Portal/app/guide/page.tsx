import Link from "next/link";
import { ArrowRight, Clock, PlayCircle } from "lucide-react";
import { GUIDES } from "@/lib/guides";
import { DEMOS } from "@/lib/walkthroughs";

export const metadata = { title: "Setup guides — Unifictional Client Portal" };

export default function GuideIndex() {
  return (
    <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-20">
      <p className="label mb-3">Setup guides</p>
      <h1 className="font-display text-4xl sm:text-6xl leading-[0.95] max-w-3xl">Give us access in a few clicks. We do the rest.</h1>
      <p className="mt-5 text-lg text-ink-muted max-w-2xl">Each guide starts with a short animation that shows exactly where to click, then the same steps written out in big type. Nothing here changes your accounts, and you can remove us any time.</p>
      <ol className="mt-12 grid sm:grid-cols-2 gap-4">
        {GUIDES.map((g, i) => (
          <li key={g.slug}>
            <Link href={`/guide/${g.slug}`} className="panel p-6 h-full flex flex-col hover:border-ink transition">
              <div className="flex items-center justify-between mb-5"><p className="font-mono text-xs text-ink-muted">{String(i + 1).padStart(2, "0")}</p>{DEMOS[g.slug] && <span className="inline-flex items-center gap-1 rounded-full bg-ink text-bone px-2.5 py-1 text-[11px]"><PlayCircle className="h-3.5 w-3.5" />Animated walkthrough</span>}</div>
              <p className="font-display text-2xl mb-1">{g.title}</p>
              <p className="text-sm text-ink-muted flex-1">{g.short}</p>
              <p className="mt-5 flex items-center justify-between text-xs text-ink-muted"><span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{g.minutes} min</span><ArrowRight className="h-4 w-4" /></p>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
