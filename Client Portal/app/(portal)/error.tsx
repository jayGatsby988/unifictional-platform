"use client";

import Link from "next/link";
import { useEffect } from "react";
import { MessageSquare, RotateCw } from "lucide-react";

/** A page that throws lands here, inside the normal portal shell. `retry` re-fetches the page from the server. */
export default function PortalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  const about = `A page didn't load${error.digest ? ` (code ${error.digest})` : ""}`;
  return (
    <div className="panel p-6 sm:p-10 max-w-2xl">
      <p className="label mb-3">Something went wrong</p>
      <h1 className="font-display text-3xl sm:text-4xl leading-tight">This page didn&apos;t load.</h1>
      <p className="mt-3 text-lg text-ink-muted">That&apos;s on our side, not yours. Try again. If it keeps happening, tell us and we&apos;ll fix it.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" onClick={() => retry()} className="btn btn-ink min-h-12 !px-6 text-base"><RotateCw className="h-4 w-4" />Try again</button>
        <Link href={`/requests?type=other&about=${encodeURIComponent(about)}`} className="btn btn-ghost min-h-12 !px-6 text-base"><MessageSquare className="h-4 w-4" />Tell us about it</Link>
      </div>
      {error.digest && <p className="mt-6 text-sm text-ink-muted">Error code <span className="font-mono">{error.digest}</span></p>}
    </div>
  );
}
