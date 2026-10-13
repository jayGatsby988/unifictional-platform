"use client";

import Link from "next/link";
import { useEffect } from "react";
import { RotateCw } from "lucide-react";

/** Studio pages that throw land here, inside the studio shell. */
export default function StudioError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="panel p-6 sm:p-10 max-w-2xl">
      <p className="label mb-3">Something went wrong</p>
      <h1 className="font-display text-3xl sm:text-4xl leading-tight">This page didn&apos;t load.</h1>
      <p className="mt-3 text-lg text-ink-muted">Try again. If it keeps failing, check the server logs{error.digest ? <> for <span className="font-mono">{error.digest}</span></> : null}.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" onClick={() => retry()} className="btn btn-ink min-h-12 !px-6 text-base"><RotateCw className="h-4 w-4" />Try again</button>
        <Link href="/studio" className="btn btn-ghost min-h-12 !px-6 text-base">Back to the studio</Link>
      </div>
    </div>
  );
}
