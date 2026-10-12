import Link from "next/link";
import { demoMode } from "@/lib/env";
import { LoginForm } from "@/components/LoginForm";
import { Logo } from "@/components/Logo";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string; email?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="flex-1 grid lg:grid-cols-2">
      <section className="hidden lg:flex flex-col justify-between bg-ink text-bone p-12">
        <div className="flex items-center gap-3">
          <Logo className="h-8 w-8" inverted />
          <span className="font-display text-lg tracking-wide">Unifictional</span>
        </div>
        <div>
          <p className="label !text-bone/60 mb-5">Client portal</p>
          <h1 className="font-display text-5xl xl:text-6xl leading-[0.95] max-w-xl">
            Always know what&apos;s actually working.
          </h1>
          <p className="mt-6 max-w-md text-bone/70 text-lg">
            Your website, search visibility, social, and 3D projects — one place, updated as we work.
          </p>
        </div>
        <p className="label !text-bone/40">unifictional.com</p>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <Logo className="h-8 w-8" />
            <span className="font-display text-lg tracking-wide">Unifictional</span>
          </div>
          <p className="label mb-3">Sign in</p>
          <h2 className="font-display text-3xl mb-2">Welcome back.</h2>
          <p className="text-ink-muted mb-8 text-base">Use the email you signed up with and the password from your welcome email. Forgot it? We&apos;ll email you a one-tap link.</p>

          {sp.error === "link" && (
            <p className="mb-5 rounded-xl bg-bad-bg text-bad px-4 py-3 text-sm">That sign-in link has expired or was already used. Tap &quot;Forgot your password?&quot; below for a fresh one.</p>
          )}

          {demoMode ? (
            <div className="panel p-5">
              <p className="pill pill-warn inline-block mb-3">Demo mode</p>
              <p className="text-sm text-ink-soft mb-4">Supabase isn&apos;t configured yet, so sign-in is skipped and the portal shows a seeded demo client.</p>
              <Link href="/overview" className="btn btn-ink w-full justify-center">Open the demo portal</Link>
            </div>
          ) : (
            <LoginForm next={sp.next} initialEmail={sp.email ?? ""} />
          )}

          <p className="mt-10 text-xs text-ink-muted">
            Need access for someone else on your team? Email{" "}
            <a className="underline" href="mailto:unifictional@gmail.com">unifictional@gmail.com</a>.
          </p>
        </div>
      </section>
    </main>
  );
}
