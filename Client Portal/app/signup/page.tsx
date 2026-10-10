import Link from "next/link";
import { Logo } from "@/components/Logo";
import { SignupForm } from "@/components/landing/SignupForm";

export const metadata = { title: "Create an account — Unifictional Client Portal" };

export default function SignupPage() {
  return (
    <main className="flex-1 grid lg:grid-cols-2">
      <section className="hidden lg:flex flex-col justify-between bg-ink text-bone p-12">
        <Link href="/" className="flex items-center gap-3"><Logo className="h-8 w-8" inverted /><span className="font-display text-lg tracking-wide">Unifictional</span></Link>
        <div>
          <p className="label !text-bone/60 mb-5">Client portal</p>
          <h1 className="font-display text-5xl xl:text-6xl leading-[0.95] max-w-xl">Your numbers, in one place.</h1>
          <p className="mt-6 max-w-md text-bone/70 text-lg">Tell us who you are. We set up your company, connect the data on our side, and email you a sign-in link. You don&apos;t have to configure anything.</p>
        </div>
        <p className="label !text-bone/40">unifictional.com</p>
      </section>
      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-10"><Logo className="h-8 w-8" /><span className="font-display text-lg tracking-wide">Unifictional</span></div>
          <p className="label mb-3">Create account</p>
          <h2 className="font-display text-3xl mb-2">Let&apos;s get you a dashboard.</h2>
          <p className="text-ink-muted mb-8">Free for Unifictional clients. Not a client yet? Start with the <Link href="/" className="underline">free inspection</Link>.</p>
          <SignupForm />
          <Link href="/guide/create-account" className="mt-6 flex items-center gap-3 rounded-2xl border border-line p-4 hover:border-ink transition">
            <span className="h-10 w-10 rounded-full bg-ink text-bone grid place-items-center shrink-0">▶</span>
            <span className="text-sm"><span className="font-medium block">First time? Watch how it works</span><span className="text-ink-muted">A one-minute walkthrough, step by step.</span></span>
          </Link>
          <p className="mt-6 text-xs text-ink-muted">Already have access? <Link href="/login" className="underline">Sign in</Link>.</p>
        </div>
      </section>
    </main>
  );
}
