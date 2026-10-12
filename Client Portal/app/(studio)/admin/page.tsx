import Link from "next/link";
import { redirect } from "next/navigation";
import { Section, SubHead } from "@/components/Section";
import { IntegrationsForm } from "@/components/IntegrationsForm";
import { StudioAccounts } from "@/components/StudioAccounts";
import { ClientPicker } from "@/components/ClientPicker";
import { getSession } from "@/lib/data/repo";
import { getAdminData } from "@/lib/data/admin";
import { fmt } from "@/lib/utils";

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await getSession();
  if (!session.isAdmin) redirect("/overview");
  const sp = await searchParams;
  const data = await getAdminData(session);
  const selected = data.clients.find((c) => c.slug === sp.client) ?? data.clients[0];
  if (!selected) return <div className="panel p-6 text-sm text-ink-muted">No companies yet. They appear here as soon as someone signs up, or add one from <Link className="underline" href="/studio/companies">Companies</Link>.</div>;

  return (
    <>
      <Section num="99" label="Studio admin" title="Connect a company's data."
        intro="Pick a company, connect its Google and Meta (or use the studio accounts), then assign its properties. Clients never have to do anything."
        action={
          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-2"><Link href={`/api/client/open?slug=${selected.slug}`} className="btn btn-ghost !py-1.5 !px-3 text-xs">Open {selected.name}&apos;s dashboard →</Link></div>
            <span className="label !text-[9px]">Company</span>
            <ClientPicker clients={data.clients.map((c) => ({ slug: c.slug, name: c.name }))} current={selected.slug} />
          </div>
        }
      />

      {session.isDemo && (
        <div className="mb-6 rounded-xl bg-warn-bg text-warn px-4 py-3 text-sm">
          <span className="font-medium">Demo mode.</span> Everything here is sample data and the Connect buttons explain what&apos;s missing instead of signing in. Set the Supabase, Google and Meta keys in Vercel to switch it on.
        </div>
      )}
      {sp.connected && <p className="mb-6 rounded-xl bg-good-bg text-good px-4 py-3 text-sm">{sp.connected === "google" ? "Google" : "Meta"} connected{sp.client ? ` for ${data.clients.find((c) => c.slug === sp.client)?.name ?? sp.client}` : " for the studio"}. Pick the properties below.</p>}
      {sp.error && <p className="mb-6 rounded-xl bg-bad-bg text-bad px-4 py-3 text-sm">Could not connect ({sp.error}{sp.detail ? `: ${sp.detail}` : ""}).</p>}

      <div className="mb-10">
        <IntegrationsForm key={selected.slug} client={selected} demo={session.isDemo} />
      </div>

      <SubHead>Studio accounts · default for every company without its own</SubHead>
      <div className="mb-10"><StudioAccounts accounts={data.studio} demo={session.isDemo} /></div>

      <SubHead>Keys &amp; sync health</SubHead>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="panel p-5">
          <SubHead>Environment keys</SubHead>
          <ul className="space-y-2 text-sm">
            {data.env.map((e) => (
              <li key={e.key} className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs">{e.key}</span>
                <span className={`pill ${e.set ? "pill-good" : "pill-bad"}`}>{e.set ? "set" : "missing"}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-ink-muted">Set these in Vercel → Project → Environment Variables, then redeploy. The README lists where each one comes from.</p>
        </div>
        <div className="panel p-5 lg:col-span-2">
          <SubHead>Last sync runs</SubHead>
          {data.runs.length === 0 ? (
            <p className="text-sm text-ink-muted">No runs yet. The cron runs daily at 06:00 Pacific; use “Run sync now” on a company above to test.</p>
          ) : (
            <table className="table w-full">
              <thead><tr><th>When</th><th>Client</th><th>Source</th><th>Result</th><th className="text-right">Rows</th></tr></thead>
              <tbody>
                {data.runs.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono text-xs whitespace-nowrap">{fmt.date(r.ranAt)} {new Date(r.ranAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</td>
                    <td className="text-xs">{r.client}</td>
                    <td className="font-mono text-xs">{r.source}</td>
                    <td className="text-xs"><span className={`pill ${r.ok ? "pill-good" : "pill-bad"} mr-2`}>{r.ok ? "ok" : "failed"}</span><span className="text-ink-muted">{r.message}</span></td>
                    <td className="text-right font-mono text-xs">{r.rows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
