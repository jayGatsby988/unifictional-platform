import Link from "next/link";
import { Logo } from "@/components/Logo";

/** Unknown links: one plain message and one way back. */
export default function NotFound() {
  return (
    <main className="flex-1 grid place-items-center px-4 py-16">
      <div className="max-w-xl text-center">
        <Logo className="h-10 w-10 mx-auto mb-6" />
        <p className="label mb-3">Page not found</p>
        <h1 className="font-display text-4xl sm:text-5xl leading-none">We couldn&apos;t find that page.</h1>
        <p className="mt-4 text-lg text-ink-muted">The link may be old or mistyped. Your dashboard has everything in one place.</p>
        <Link href="/overview" className="btn btn-ink min-h-12 !px-6 text-base mt-8">Back to my dashboard</Link>
      </div>
    </main>
  );
}
