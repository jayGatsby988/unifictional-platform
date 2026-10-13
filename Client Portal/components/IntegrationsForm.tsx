"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { AdminClient } from "@/lib/data/admin";
import type { AdminOptions } from "@/app/api/admin/options/route";
import { ConnectButton } from "@/components/ConnectButton";

type Fields = AdminClient["fields"];

function Pick({ label, hint, value, onChange, options, loading }: {
  label: string; hint: string; value: string; onChange: (v: string) => void; options: { id: string; label: string }[] | null; loading: boolean;
}) {
  const known = options?.some((o) => o.id === value);
  return (
    <label className="block">
      <span className="label !text-xs block mb-1">{label}</span>
      {options && options.length > 0 ? (
        <select className="input !py-2 text-sm" value={known ? value : value ? "__custom" : ""} onChange={(e) => { if (e.target.value !== "__custom") onChange(e.target.value); }}>
          <option value="">— not assigned —</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          {!known && value && <option value="__custom">{value} (typed by hand)</option>}
        </select>
      ) : (
        <input className="input !py-2 font-mono text-xs" value={value} placeholder={loading ? "loading…" : ""} onChange={(e) => onChange(e.target.value)} />
      )}
      <span className="block mt-1 text-xs text-ink-muted">{hint}</span>
    </label>
  );
}

export function IntegrationsForm({ client, demo }: { client: AdminClient; demo: boolean }) {
  const router = useRouter();
  const [f, setF] = useState<Fields>(client.fields);
  const [opts, setOpts] = useState<AdminOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "sync">("");

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/options?client=${encodeURIComponent(client.slug)}`).then((r) => r.json()).then((j: AdminOptions) => { if (alive) setOpts(j); }).catch(() => {}).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [client.slug]);

  const set = (k: keyof Fields) => (v: string) => setF({ ...f, [k]: v });
  const pages = opts?.meta?.pages ?? null;
  const pickPage = (id: string) => {
    const p = pages?.find((x) => x.id === id);
    setF({ ...f, fb_page_id: id, ig_user_id: p?.igUserId ?? (id ? f.ig_user_id : "") });
  };
  const pickGbp = (id: string) => {
    const l = opts?.google?.gbp.find((x) => x.id === id);
    setF({ ...f, gbp_location_id: id, gbp_account_id: l?.accountId ?? (id ? f.gbp_account_id : "") });
  };

  async function save() {
    setBusy("save"); setMsg("");
    const res = await fetch("/api/admin/integrations", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: client.slug, ...f }) });
    const j = await res.json().catch(() => ({}));
    setMsg(res.ok ? (j.demo ? "Demo mode: not saved." : "Saved. The next sync will pull from these.") : j.error ?? "Could not save.");
    setBusy(""); router.refresh();
  }
  async function syncNow() {
    setBusy("sync"); setMsg("");
    const res = await fetch(`/api/sync?client=${encodeURIComponent(client.slug)}`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) setMsg(j.error ?? "Sync failed.");
    else {
      const r = (j.results?.[client.slug] ?? []) as { source: string; ok: boolean; message: string }[];
      setMsg(r.map((x) => `${x.source}: ${x.ok ? x.message : "FAILED " + x.message}`).join(" · ") || "Nothing to sync.");
    }
    setBusy(""); router.refresh();
  }

  const errors = [...(opts?.google?.errors ?? []), ...(opts?.meta?.errors ?? [])];
  const igPick = pages?.find((p) => p.id === f.fb_page_id);

  return (
    <div className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <p className="font-display text-2xl">{client.name}</p>
          <p className="text-xs text-ink-muted font-mono">{client.slug}{client.updatedAt ? ` · updated ${new Date(client.updatedAt).toLocaleDateString()}` : ""}</p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mb-5">
        <div className="rounded-xl border border-line p-4">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="font-medium text-sm">This company&apos;s Google</p>
            <span className={`pill ${client.google.connected ? "pill-good" : "pill-neutral"}`}>{client.google.connected ? "connected" : "using studio account"}</span>
          </div>
          <p className="text-xs text-ink-muted mb-3">{client.google.connected ? `${client.google.label ?? "connected"} · Analytics, Search Console, Business Profile` : "Connect their own Google account if the studio account can't see their properties."}</p>
          <ConnectButton href={`/api/integrations/google/connect?client=${client.slug}`} demo={demo}>{client.google.connected ? "Reconnect" : "Connect"} Google for {client.name}</ConnectButton>
        </div>
        <div className="rounded-xl border border-line p-4">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="font-medium text-sm">This company&apos;s Meta</p>
            <span className={`pill ${client.meta.connected ? (client.meta.expiring ? "pill-warn" : "pill-good") : "pill-neutral"}`}>{client.meta.connected ? (client.meta.expiring ? "expiring" : "connected") : "using studio account"}</span>
          </div>
          <p className="text-xs text-ink-muted mb-3">{client.meta.connected ? `${client.meta.label ?? "connected"} · Facebook Page + Instagram` : "Connect their Facebook login if their Page isn't under the studio account."}</p>
          <ConnectButton href={`/api/integrations/meta/connect?client=${client.slug}`} demo={demo}>{client.meta.connected ? "Reconnect" : "Connect"} Meta for {client.name}</ConnectButton>
        </div>
      </div>
      {errors.length > 0 && <p className="mb-3 text-xs text-warn">{errors.join(" · ")}</p>}
      {!loading && !opts?.google && !opts?.meta && (
        <p className="mb-3 text-xs text-ink-muted">No Google or Meta account is connected yet, so the lists below are empty. Connect the studio accounts (section below) or this company&apos;s own, then the dropdowns fill in. You can also type ids by hand.</p>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="label !text-xs block mb-1">Website URL</span>
          <input className="input !py-2 font-mono text-xs" value={f.site_url} onChange={(e) => set("site_url")(e.target.value)} />
          <span className="block mt-1 text-xs text-ink-muted">Checked for uptime and PageSpeed</span>
        </label>
        <Pick label="Analytics property" hint={client.google.connected ? "GA4 properties this company's Google account can see" : "GA4 properties the studio Google account can see"} value={f.ga4_property_id} onChange={set("ga4_property_id")} options={opts?.google?.ga4 ?? null} loading={loading} />
        <Pick label="Search Console property" hint={client.google.connected ? "Search Console properties this company's account can see" : "Properties the studio Google account can see"} value={f.gsc_site_url} onChange={set("gsc_site_url")} options={opts?.google?.gsc ?? null} loading={loading} />
        <Pick label="Business Profile listing" hint={client.google.connected ? "Listings this company's account manages" : "Listings the studio Google account manages"} value={f.gbp_location_id} onChange={pickGbp} options={opts?.google?.gbp ?? null} loading={loading} />
        <Pick label="Facebook Page" hint={igPick ? `Instagram: @${igPick.igUsername ?? igPick.igUserId}` : "Pages the studio Meta account administers; its Instagram account comes with it"} value={f.fb_page_id} onChange={pickPage} options={pages} loading={loading} />
        <label className="block">
          <span className="label !text-xs block mb-1">GoHighLevel contact ID</span>
          <input className="input !py-2 font-mono text-xs" value={f.ghl_contact_id} onChange={(e) => set("ghl_contact_id")(e.target.value)} />
          <span className="block mt-1 text-xs text-ink-muted">Optional, for the future calls/leads sync</span>
        </label>
        <label className="block">
          <span className="label !text-xs block mb-1">GitHub repo (SEO Autopilot, sites we host)</span>
          <input className="input !py-2 font-mono text-xs" placeholder="unifictional/their-site" value={f.site_repo} onChange={(e) => set("site_repo")(e.target.value)} />
          <span className="block mt-1 text-xs text-ink-muted">Autopilot commits each blog post here; Vercel deploys it. Needs GITHUB_TOKEN.</span>
        </label>
        <label className="block">
          <span className="label !text-xs block mb-1">Blog folder in that repo</span>
          <input className="input !py-2 font-mono text-xs" placeholder="content/blog" value={f.site_blog_dir} onChange={(e) => set("site_blog_dir")(e.target.value)} />
          <span className="block mt-1 text-xs text-ink-muted">Where the post .md files go. Leave blank for content/blog.</span>
        </label>
        <label className="block sm:col-span-2">
          <span className="label !text-xs block mb-1">Revalidate URL (SEO Autopilot, sites that pull posts from the portal)</span>
          <input className="input !py-2 font-mono text-xs" placeholder="https://theirsite.com/api/revalidate?secret=…" value={f.site_revalidate_url} onChange={(e) => set("site_revalidate_url")(e.target.value)} />
          <span className="block mt-1 text-xs text-ink-muted">For sites whose blog reads /api/autopilot/feed. Pinged after each publish so the post appears at once. Used when no GitHub repo is set.</span>
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className="btn btn-ink !py-2 !px-4 text-xs" disabled={busy !== ""} onClick={save}>{busy === "save" ? "Saving…" : "Save"}</button>
        <button className="btn btn-ghost !py-2 !px-4 text-xs" disabled={busy !== "" || demo} onClick={syncNow}>{busy === "sync" ? "Syncing…" : "Run sync now"}</button>
        {msg && <p className="text-xs text-ink-muted">{msg}</p>}
      </div>
    </div>
  );
}
