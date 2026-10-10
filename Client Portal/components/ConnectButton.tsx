"use client";

import { useRef } from "react";
import { X } from "lucide-react";

const NEEDS = [
  { key: "Supabase", why: "stores the connection so the daily sync can use it", how: "restore the Supabase project, run the migrations, set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY" },
  { key: "Google", why: "the Connect Google button opens Google's consent screen", how: "a Google Cloud OAuth client (GOOGLE_OAUTH_CLIENT_ID / SECRET) with the callback URL from .env.example" },
  { key: "Meta", why: "the Connect Meta button opens Facebook Login", how: "a Meta app (META_APP_ID / SECRET) with Facebook Login for Business" },
];

/**
 * A connect link that performs the real OAuth redirect when the portal is
 * configured, and explains what is missing when it is running in demo mode.
 */
export function ConnectButton({ href, demo, className = "btn btn-ghost !py-1.5 !px-3 text-xs", children }: { href: string; demo: boolean; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  if (!demo) return <a href={href} className={className}>{children}</a>;
  return (
    <>
      <button type="button" className={className} onClick={() => ref.current?.showModal()}>{children}</button>
      <dialog ref={ref} className="m-auto w-[min(92vw,34rem)] rounded-2xl border border-line bg-bone text-ink p-0 backdrop:bg-black/40">
        <div className="p-6">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <p className="label mb-1">Demo mode</p>
              <h3 className="font-display text-2xl leading-none">Connections are switched off.</h3>
            </div>
            <button type="button" aria-label="Close" onClick={() => ref.current?.close()} className="h-8 w-8 rounded-full border border-line grid place-items-center"><X className="h-4 w-4" /></button>
          </div>
          <p className="text-sm text-ink-muted mb-4">This button runs a real sign-in with Google or Meta and saves the result. The live portal is still showing demo data, so three things have to exist first:</p>
          <ol className="space-y-3 text-sm">
            {NEEDS.map((n, i) => (
              <li key={n.key} className="flex gap-3">
                <span className="font-mono text-xs text-ink-muted mt-0.5">0{i + 1}</span>
                <div><p className="font-medium">{n.key} <span className="font-normal text-ink-muted">· {n.why}</span></p><p className="text-ink-muted">{n.how}</p></div>
              </li>
            ))}
          </ol>
          <p className="mt-5 text-xs text-ink-muted">Once those keys are set in Vercel and the site is redeployed, this same button opens the consent screen and the status pill turns green.</p>
          <div className="mt-5 flex justify-end"><button type="button" className="btn btn-ink !py-2 !px-4 text-xs" onClick={() => ref.current?.close()}>Got it</button></div>
        </div>
      </dialog>
    </>
  );
}
