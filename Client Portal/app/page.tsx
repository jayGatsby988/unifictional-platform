import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Logo } from "@/components/Logo";
import { AuditForm } from "@/components/landing/AuditForm";
import { PortalMock } from "@/components/landing/PortalMock";
import { Reveal } from "@/components/landing/Reveal";

export const metadata = {
  title: "Free Website & SEO Inspection for Contractors — Unifictional",
  description: "Enter your website and get a graded report in 30 seconds: mobile speed, Google visibility, and whether a homeowner can call you in one tap.",
};

const CHECKS = [
  { n: "01", t: "Speed on a phone", d: "Google's own Lighthouse test. Slow sites lose the homeowner before they see your work." },
  { n: "02", t: "Found on Google", d: "Indexable, titled, described, and naming the towns you actually work in." },
  { n: "03", t: "One tap to call", d: "A visible phone number and a clear estimate button, on mobile, above the fold." },
  { n: "04", t: "Proof you're real", d: "Reviews, ratings, a current year, business schema, a preview when the link is shared." },
  { n: "05", t: "Leads measured", d: "Analytics installed, so you know which pages produce calls, not guesses." },
  { n: "06", t: "What to fix first", d: "Three things, in order, written for a builder, not a developer." },
];

const MARQUEE = ["General contractors", "Remodelers", "Custom home builders", "Roofing & exteriors", "Kitchen & bath", "Concrete & foundations", "Landscaping & hardscape", "Pool builders"];
const CLIENTS = ["Blue Lake Construction", "Cascade Poolworks", "Go Far Construction", "DIGS Construction", "ENF Siding & Exteriors", "Tremor Excavation"];

export default function Landing() {
  return (
    <main className="flex-1 bg-bone text-ink">
      <Reveal />

      {/* Hero */}
      <section id="top" className="relative min-h-[100svh] bg-[#0a0a0a] text-bone overflow-hidden hero-grain">
        <Image src="/hero/groundwork.jpg" alt="" fill loading="eager" fetchPriority="low" sizes="100vw" className="object-cover opacity-50" aria-hidden />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/55 to-black/90" aria-hidden />
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-transparent to-transparent" aria-hidden />

        <header className="relative z-10 max-w-7xl mx-auto px-5 sm:px-8 h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3"><Logo className="h-8 w-8" inverted /><span className="font-display text-lg tracking-wide">Unifictional</span></Link>
          <nav className="flex items-center gap-2">
            <div className="hidden sm:block"><Link href="/login" className="btn text-bone/80 hover:text-bone !px-4 !py-2 text-sm">Client sign in</Link></div>
            <Link href="/signup" className="btn bg-bone text-ink !py-2.5 !px-5 text-sm whitespace-nowrap">Create account <ArrowRight className="h-4 w-4" /></Link>
          </nav>
        </header>

        <div className="relative z-10 max-w-7xl mx-auto px-5 sm:px-8 pt-10 sm:pt-16 pb-24">
          <div className="flex items-center justify-between label !text-bone/50 mb-10 sm:mb-16">
            <span>Unifictional · Studio</span><span className="hidden sm:inline">Free inspection report</span>
          </div>
          <p className="label !text-bone/60 mb-5">Marketing for local businesses</p>
          <h1 className="font-display text-[3.2rem] leading-[0.92] sm:text-7xl lg:text-[6.5rem] max-w-5xl">
            Is your website<br />losing you jobs?
          </h1>
          <p className="mt-7 text-lg sm:text-xl text-bone/75 max-w-xl leading-relaxed">
            Find out in 30 seconds. We run Google&apos;s speed test and ten contractor-specific checks, grade your site, and tell you the three things to fix first.
          </p>
          <div className="mt-10 sm:mt-14">
            <AuditForm />
          </div>
        </div>

        <div className="absolute bottom-6 left-0 right-0 z-10 max-w-7xl mx-auto px-5 sm:px-8 flex items-center justify-between label !text-bone/45">
          <span>Scroll to see what we check ↓</span><span className="hidden sm:inline">Groundwork → Booked out</span>
        </div>
      </section>

      {/* Marquee */}
      <div className="bg-ink text-bone border-y border-bone/10 overflow-hidden py-4">
        <div className="marquee">
          {[...MARQUEE, ...MARQUEE].map((m, i) => (
            <span key={i} className="font-display text-lg sm:text-xl px-6 whitespace-nowrap flex items-center gap-6">{m}<span className="h-1 w-1 rounded-full bg-bone/40" /></span>
          ))}
        </div>
      </div>

      {/* Manifesto */}
      <section className="cv-auto max-w-7xl mx-auto px-5 sm:px-8 py-20 sm:py-28 grid lg:grid-cols-12 gap-10">
        <div className="lg:col-span-4 reveal">
          <p className="label mb-4">00 / Why this exists</p>
          <p className="text-sm text-ink-muted max-w-xs">Most local businesses lose their best jobs before the first call. Not to better work, but to competitors who simply look more trustworthy online.</p>
        </div>
        <div className="lg:col-span-8 reveal">
          <h2 className="font-display text-4xl sm:text-5xl lg:text-6xl leading-[0.95]">Your craftsmanship is premium. Your website should say so, before you ever pick up the phone.</h2>
          <p className="mt-6 text-lg text-ink-muted max-w-2xl">The inspection is the first thing we do for every client. Now it&apos;s free for anyone who builds.</p>
        </div>
      </section>

      {/* Checks */}
      <section className="cv-auto border-t border-line">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-20 sm:py-28">
          <div className="flex flex-wrap items-end justify-between gap-6 mb-12 reveal">
            <div>
              <p className="label mb-3">01 / What we check</p>
              <h2 className="font-display text-4xl sm:text-5xl leading-none">Six things a homeowner notices in ten seconds.</h2>
            </div>
            <a href="#top" className="btn btn-ink">Inspect my site <ArrowRight className="h-4 w-4" /></a>
          </div>
          <ol className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-line border border-line">
            {CHECKS.map((c) => (
              <li key={c.n} className="bg-bone p-7 sm:p-8 reveal">
                <p className="font-mono text-xs text-ink-muted mb-6">{c.n}</p>
                <p className="font-display text-2xl mb-2">{c.t}</p>
                <p className="text-sm text-ink-muted leading-relaxed">{c.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Portal */}
      <section className="cv-auto bg-paper border-t border-line">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-20 sm:py-28 grid lg:grid-cols-2 gap-12 items-center">
          <div className="reveal">
            <p className="label mb-3">02 / After the report</p>
            <h2 className="font-display text-4xl sm:text-5xl leading-[0.95]">Clients don&apos;t get a PDF. They get a dashboard.</h2>
            <p className="mt-6 text-lg text-ink-muted max-w-lg">Every Unifictional client logs in to one page: website leads and speed, Google rankings and Business Profile calls, Instagram reach, and the instant-quote tool on their own site. Updated every day, no setup on their end.</p>
            <ul className="mt-8 space-y-3 text-sm">
              {["Leads, visits and calls, with last month beside them", "Keywords moving up, and the work we did that moved them", "Reviews, reach and the posts that performed", "Your pricing, your options, your quotes, all editable"].map((t) => (
                <li key={t} className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 rounded-full bg-ink shrink-0" />{t}</li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap gap-2">
              <Link href="/signup" className="btn btn-ink">Create an account <ArrowRight className="h-4 w-4" /></Link>
              <Link href="/signup" className="btn btn-ghost">Start SEO Autopilot <ArrowUpRight className="h-4 w-4" /></Link>
            </div>
          </div>
          <div className="reveal"><PortalMock /></div>
        </div>
      </section>

      {/* Clients */}
      <section className="cv-auto border-t border-line">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-14 sm:py-16 reveal">
          <p className="label mb-6">03 / Built for</p>
          <ul className="flex flex-wrap gap-x-10 gap-y-3">
            {CLIENTS.map((c) => <li key={c} className="font-display text-2xl sm:text-3xl text-ink/80">{c}</li>)}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-ink text-bone">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-24 sm:py-32 reveal">
          <p className="label !text-bone/50 mb-4">04 / Start here</p>
          <h2 className="font-display text-5xl sm:text-6xl lg:text-7xl leading-[0.92] max-w-4xl">Thirty seconds now. Fewer lost jobs all year.</h2>
          <div className="mt-10 flex flex-wrap gap-3">
            <a href="#top" className="btn bg-bone text-ink !py-3.5 !px-6 text-base">Get my free inspection <ArrowRight className="h-4 w-4" /></a>
            <a href="https://unifictional.com/contact" className="btn border border-bone/30 text-bone !py-3.5 !px-6 text-base hover:bg-bone/10">Book a call</a>
          </div>
        </div>
        <footer className="border-t border-bone/10">
          <div className="max-w-7xl mx-auto px-5 sm:px-8 py-6 flex flex-wrap items-center justify-between gap-3 text-xs text-bone/50">
            <span className="flex items-center gap-2"><Logo className="h-5 w-5" inverted /> Unifictional · Marketing for local businesses</span>
            <span className="flex gap-5"><a className="hover:text-bone" href="https://unifictional.com">unifictional.com</a><Link className="hover:text-bone" href="/guide">Setup guides</Link><Link className="hover:text-bone" href="/login">Client sign in</Link></span>
          </div>
        </footer>
      </section>
    </main>
  );
}
