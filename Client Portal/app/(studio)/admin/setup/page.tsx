import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ArrowLeft, Check, X } from "lucide-react";
import { Section } from "@/components/Section";
import { getSession } from "@/lib/data/repo";
import { CopyMessage } from "@/components/landing/CopyMessage";

const KEYS: { key: string; what: string; where: string; needed: string }[] = [
  { key: "NEXT_PUBLIC_SUPABASE_URL", what: "Database URL", where: "Already set.", needed: "always" },
  { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", what: "Database public key", where: "Already set.", needed: "always" },
  { key: "PORTAL_DEMO", what: "Demo switch", where: "Set to false once you've signed in as admin (step 1 below).", needed: "flip to false" },
  { key: "CRON_SECRET", what: "Protects the nightly sync endpoint", where: "Any long random string, e.g. run `openssl rand -hex 24`.", needed: "nightly sync" },
  { key: "SUPABASE_SERVICE_ROLE_KEY", what: "Lets the unattended nightly cron write", where: "Supabase → Project Settings → API keys → service_role. Only the cron needs it; everything else works from your admin login.", needed: "nightly sync" },
  { key: "PSI_API_KEY", what: "Speed scores in the free inspection + client PageSpeed", where: "Google Cloud → APIs & Services → Credentials → Create API key. Enable 'PageSpeed Insights API' and 'Custom Search API' on the project; the same key serves both.", needed: "speed scores" },
  { key: "GOOGLE_CSE_KEY", what: "Live Google rankings in the free inspection", where: "Same API key as PSI_API_KEY.", needed: "rankings" },
  { key: "GOOGLE_CSE_CX", what: "Search engine ID", where: "programmablesearchengine.google.com → Add → 'Search the entire web' → copy the Search engine ID.", needed: "rankings" },
  { key: "GOOGLE_OAUTH_CLIENT_ID", what: "Connect Google button", where: "Google Cloud → Credentials → Create OAuth client ID → Web application → add the redirect URI below. Enable: Google Analytics Admin API, Google Analytics Data API, Google Search Console API, My Business Account Management API, My Business Business Information API, Business Profile Performance API.", needed: "Google connections" },
  { key: "GOOGLE_OAUTH_CLIENT_SECRET", what: "Connect Google button", where: "Shown once when the OAuth client is created.", needed: "Google connections" },
  { key: "META_APP_ID", what: "Connect Meta button", where: "developers.facebook.com → Create app → Business → add 'Facebook Login for Business' → Settings → Valid OAuth Redirect URIs: the Meta URI below. Permissions: pages_show_list, pages_read_engagement, read_insights, instagram_basic, instagram_manage_insights, business_management.", needed: "Meta connections" },
  { key: "META_APP_SECRET", what: "Connect Meta button", where: "App → Settings → Basic → App secret.", needed: "Meta connections" },
  { key: "GHL_TOKEN", what: "Leads from the landing page into GoHighLevel", where: "The same private integration token the main site uses.", needed: "lead capture" },
  { key: "GHL_LOCATION_ID", what: "GoHighLevel sub-account", where: "Same value as the main site.", needed: "lead capture" },
];

export default async function SetupPage() {
  const session = await getSession();
  if (!session.isAdmin) redirect("/overview");
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "unifictional-client-portal.vercel.app"}`;
  const set = (k: string) => Boolean(process.env[k]);

  return (
    <>
      <Link href="/admin" className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink mb-4"><ArrowLeft className="h-3.5 w-3.5" /> Studio admin</Link>
      <Section num="99" label="Studio setup" title="Switch the portal from demo to live."
        intro="Four steps, in order. Each key you add shows green here after the next deploy." />

      <ol className="space-y-6">
        <li className="panel p-6">
          <p className="label mb-2">Step 1 · Make yourself the admin (5 minutes, no keys needed)</p>
          <ol className="list-decimal pl-5 space-y-2 text-sm">
            <li>Supabase → Authentication → URL Configuration: set Site URL to <span className="font-mono">{origin}</span> and add <span className="font-mono">{origin}/auth/callback</span> to Redirect URLs.</li>
            <li>Open <Link className="underline" href="/signup">{origin}/signup</Link> and create an account with your studio email. Click the magic link.</li>
            <li>Tell Claude, or run in the Supabase SQL editor: <span className="font-mono">insert into portal_admins select id from auth.users where email = &apos;you@…&apos;;</span></li>
            <li>In Vercel set <span className="font-mono">PORTAL_DEMO=false</span> and redeploy. The demo client disappears; your eight real clients appear in the admin dropdown.</li>
          </ol>
        </li>
        <li className="panel p-6">
          <p className="label mb-2">Step 2 · Google Cloud (one project, ~15 minutes)</p>
          <p className="text-sm text-ink-muted mb-3">Create one project at console.cloud.google.com, enable the APIs listed under the keys below, then create one API key and one OAuth web client.</p>
          <p className="label !text-[9px] mb-1">Google OAuth redirect URI</p>
          <CopyMessage text={`${origin}/api/integrations/google/callback`} />
        </li>
        <li className="panel p-6">
          <p className="label mb-2">Step 3 · Meta app (~10 minutes)</p>
          <p className="label !text-[9px] mb-1">Meta OAuth redirect URI</p>
          <CopyMessage text={`${origin}/api/integrations/meta/callback`} />
          <p className="mt-3 text-xs text-ink-muted">Meta requires App Review for instagram_manage_insights before non-admin Pages work. Pages you administer yourself work immediately in development mode, which covers client Pages where the studio is an admin.</p>
        </li>
        <li className="panel p-6">
          <p className="label mb-2">Step 4 · Connect and assign</p>
          <p className="text-sm text-ink-muted">Back on <Link className="underline" href="/admin">Studio admin</Link>: press Connect Google and Connect Meta with the studio accounts, pick each company, choose its properties from the dropdowns, Save, Run sync now. Send clients the <Link className="underline" href="/guide?studio">setup guides</Link> when a property is missing from a list.</p>
        </li>
        <li className="panel p-6">
          <p className="label mb-2">Step 5 · Billing with Square (~5 minutes)</p>
          <p className="text-sm text-ink-muted">Create an app at developer.squareup.com, add its production access token in Vercel as <span className="font-mono">SQUARE_ACCESS_TOKEN</span>, then link each company on <Link className="underline" href="/studio/billing">Studio · Billing</Link>. Clients get a Billing page to pay invoices and see receipts.</p>
        </li>
      </ol>

      <h2 className="label !text-ink-soft mt-12 mb-3">Keys, where they come from, what they unlock</h2>
      <div className="panel overflow-x-auto">
        <table className="table w-full min-w-[720px]">
          <thead><tr><th>Key</th><th>Status</th><th>Unlocks</th><th>Where to get it</th></tr></thead>
          <tbody>
            {KEYS.map((k) => (
              <tr key={k.key}>
                <td className="font-mono text-xs whitespace-nowrap">{k.key}</td>
                <td>{set(k.key) ? <span className="pill pill-good inline-flex items-center gap-1"><Check className="h-3 w-3" />set</span> : <span className="pill pill-bad inline-flex items-center gap-1"><X className="h-3 w-3" />missing</span>}</td>
                <td className="text-xs">{k.what}<br /><span className="text-ink-muted">{k.needed}</span></td>
                <td className="text-xs text-ink-muted">{k.where}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-ink-muted">Add keys in Vercel → Project → Settings → Environment Variables (Production), then Deployments → Redeploy. Never paste keys into chat.</p>
    </>
  );
}
