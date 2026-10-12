"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check } from "lucide-react";
import type { AutopilotCadence, AutopilotMode, AutopilotSettings, AutopilotTarget } from "@/lib/data/types";
import { CADENCES } from "@/lib/autopilot/schedule";
import { postsFor } from "@/lib/billing/packages";
import { PLATFORMS, inviteSteps, type SiteAccess } from "@/lib/autopilot/site-access";
import { cn } from "@/lib/utils";

const TARGETS: { key: AutopilotTarget; title: string; detail: string }[] = [
  { key: "hosted", title: "Unifictional built or hosts it", detail: "Nothing to add. We already have what we need to publish." },
  { key: "wordpress", title: "It's on WordPress", detail: "One application password from your WordPress admin. Not your real password, and you can revoke it any time." },
  { key: "manual", title: "Somewhere else", detail: "GoDaddy, Wix, Squarespace… We write each post; invite us to paste it, share a login, or paste it yourself." },
];

const ACCESS: { key: SiteAccess; title: string; detail: (p: string) => string }[] = [
  { key: "invite", title: "Invite us as a collaborator (recommended)", detail: (p) => `No password sharing. A minute in your ${p || "site builder"} account, then we paste every post for you within a business day.` },
  { key: "login", title: "Share a login", detail: (p) => `The username and password for your ${p || "site builder"} account. Stored encrypted, never shown again. We paste every post for you.` },
  { key: "self", title: "I'll paste them myself", detail: () => "Each post arrives here ready to copy as HTML or text. You tap \"It's live\" when it's up." },
];

const MODES: { key: AutopilotMode; title: string; detail: string }[] = [
  { key: "auto", title: "Automatic (recommended)", detail: "Every post is reviewed by the SEO checklist. Posts that pass go live on their own; anything that doesn't waits for you." },
  { key: "approve", title: "I'll review every post", detail: "Nothing goes live until you tap Publish. Good for the first few weeks if you want to see the voice first." },
];

function Choice({ on, title, detail, onPick, name }: { on: boolean; title: string; detail: string; onPick: () => void; name: string }) {
  return (
    <label className={cn("flex gap-3 rounded-xl border p-3 cursor-pointer transition", on ? "border-ink bg-paper" : "border-line hover:border-ink/40")}>
      <input type="radio" name={name} className="sr-only" checked={on} onChange={onPick} />
      <span className={cn("mt-0.5 h-5 w-5 rounded-full border grid place-items-center shrink-0", on ? "bg-ink border-ink text-bone" : "border-line")}>{on && <Check className="h-3 w-3" />}</span>
      <span><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-ink-muted mt-0.5">{detail}</span></span>
    </label>
  );
}

/** The two questions that switch autopilot on; reused inside Settings once it is. `maxPosts` caps the cadence to the package they bought. */
export function AutopilotForm({ settings, demo, maxPosts = null, studioEmail = "unifictional@gmail.com", siteUrl: knownSite = "" }: { settings: AutopilotSettings; demo: boolean; maxPosts?: number | null; studioEmail?: string; siteUrl?: string }) {
  const router = useRouter();
  const cadences = CADENCES.filter((c) => !maxPosts || postsFor(c.key) <= maxPosts);
  const [target, setTarget] = useState<AutopilotTarget>(settings.target);
  const [mode, setMode] = useState<AutopilotMode>(settings.mode);
  const [cadence, setCadence] = useState<AutopilotCadence>(settings.cadence);
  const [notes, setNotes] = useState(settings.notes);
  const [wpUrl, setWpUrl] = useState("");
  const [wpUser, setWpUser] = useState("");
  const [wpPass, setWpPass] = useState("");
  const [platform, setPlatform] = useState(settings.site.platform);
  const [access, setAccess] = useState<SiteAccess>(settings.site.access ?? "invite");
  const [siteUrl, setSiteUrl] = useState(knownSite.replace(/^https?:\/\//, ""));
  const [siteUser, setSiteUser] = useState("");
  const [sitePass, setSitePass] = useState("");
  const [inviteSent, setInviteSent] = useState(Boolean(settings.site.inviteSentAt));
  const [busy, setBusy] = useState<"" | "save" | "pause">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(enabled: boolean) {
    setBusy(enabled ? "save" : "pause");
    setMsg(null);
    const res = await fetch("/api/autopilot/settings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled, target, mode, cadence, notes, wpUrl, wpUser, wpAppPassword: wpPass, platform, access, siteUrl, siteUser, sitePassword: sitePass, inviteSent }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) { setMsg({ ok: false, text: j.error ?? "Couldn't save." }); return; }
    setWpPass(""); setSitePass("");
    setMsg({
      ok: true,
      text: j.demo ? "Demo mode: nothing was saved, but this is where autopilot would switch on."
        : !enabled ? "Paused. Nothing new is written until you switch it back on."
        : settings.enabled ? "Saved."
        : "Autopilot is on. Your first post arrives after the next daily run.",
    });
    router.refresh();
  }

  const needsWp = target === "wordpress" && !settings.wpConnected;
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(true); }} className="panel p-5 sm:p-6 space-y-6">
      <fieldset>
        <legend className="label mb-3">1 · Where does your website live?</legend>
        <div className="grid gap-2">
          {TARGETS.map((t) => <Choice key={t.key} name="target" on={target === t.key} title={t.title} detail={t.detail} onPick={() => setTarget(t.key)} />)}
        </div>
        {target === "wordpress" && (
          <div className="mt-3 rounded-xl border border-line p-4 space-y-3">
            {settings.wpConnected && <p className="text-xs text-good">WordPress is connected. Fill these in only to change the login.</p>}
            <div className="grid sm:grid-cols-3 gap-3">
              <label className="block"><span className="label !text-[9px] block mb-1">Site address</span><input className="input !py-2 text-sm" placeholder="mysite.com" value={wpUrl} onChange={(e) => setWpUrl(e.target.value)} required={needsWp} /></label>
              <label className="block"><span className="label !text-[9px] block mb-1">WordPress username</span><input className="input !py-2 text-sm" value={wpUser} onChange={(e) => setWpUser(e.target.value)} required={needsWp} autoComplete="off" /></label>
              <label className="block"><span className="label !text-[9px] block mb-1">Application password</span><input className="input !py-2 text-sm font-mono" type="password" placeholder="xxxx xxxx xxxx xxxx" value={wpPass} onChange={(e) => setWpPass(e.target.value)} required={needsWp} autoComplete="new-password" /></label>
            </div>
            <p className="text-xs text-ink-muted">Not your login password. <Link className="underline" href="/guide/wordpress-access" target="_blank">How to make one in a minute</Link>. We check it works before saving, and we never show it again.</p>
          </div>
        )}
        {target === "manual" && (
          <div className="mt-3 rounded-xl border border-line p-4 space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="label !text-[9px] block mb-1">Which builder is it on?</span>
                <select className="input !py-2 text-sm" value={platform} onChange={(e) => setPlatform(e.target.value)} required>
                  <option value="">Choose…</option>
                  {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label className="block"><span className="label !text-[9px] block mb-1">Your website address</span><input className="input !py-2 text-sm" placeholder="mysite.com" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} required={!knownSite} /></label>
            </div>
            <fieldset>
              <legend className="label !text-[9px] mb-2">How do we get posts onto it?</legend>
              <div className="grid gap-2">
                {ACCESS.map((a) => <Choice key={a.key} name="access" on={access === a.key} title={a.title} detail={a.detail(platform)} onPick={() => setAccess(a.key)} />)}
              </div>
            </fieldset>
            {access === "invite" && (
              <div className="rounded-xl bg-paper border border-line p-4 space-y-3">
                <p className="text-xs font-medium">Invite <span className="font-mono">{studioEmail}</span>{platform ? ` in ${platform}` : ""}:</p>
                <ol className="space-y-1.5 text-xs text-ink-muted">
                  {inviteSteps(platform, studioEmail).map((s, i) => <li key={s} className="flex gap-2"><span className="font-mono text-ink">{i + 1}.</span>{s}</li>)}
                </ol>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" className="h-4 w-4 accent-ink" checked={inviteSent} onChange={(e) => setInviteSent(e.target.checked)} />
                  Done, I&apos;ve sent the invite{settings.site.inviteSentAt ? " (we have it on file)" : ""}
                </label>
                <p className="text-[11px] text-ink-muted">Not sent yet? You can still switch on; each post waits here until the invite arrives.</p>
              </div>
            )}
            {access === "login" && (
              <div className="rounded-xl bg-paper border border-line p-4 space-y-3">
                {settings.site.loginOnFile && <p className="text-xs text-good">A login is on file. Fill these in only to change it.</p>}
                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="block"><span className="label !text-[9px] block mb-1">{platform || "Account"} username or email</span><input className="input !py-2 text-sm" value={siteUser} onChange={(e) => setSiteUser(e.target.value)} required={!settings.site.loginOnFile} autoComplete="off" /></label>
                  <label className="block"><span className="label !text-[9px] block mb-1">Password</span><input className="input !py-2 text-sm font-mono" type="password" value={sitePass} onChange={(e) => setSitePass(e.target.value)} required={!settings.site.loginOnFile} autoComplete="new-password" /></label>
                </div>
                <p className="text-[11px] text-ink-muted">Stored encrypted, visible only to the studio, never shown here again. Two-step verification on? We&apos;ll text you for the code the first time.</p>
              </div>
            )}
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend className="label mb-3">2 · Who reviews each post?</legend>
        <div className="grid sm:grid-cols-2 gap-2">
          {MODES.map((m) => <Choice key={m.key} name="mode" on={mode === m.key} title={m.title} detail={m.detail} onPick={() => setMode(m.key)} />)}
        </div>
      </fieldset>

      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="label !text-[9px] block mb-1">How often</span>
          <select className="input !py-2 text-sm" value={cadence} onChange={(e) => setCadence(e.target.value as AutopilotCadence)}>
            {cadences.map((c) => <option key={c.key} value={c.key}>{c.label} · {c.perMonth}</option>)}
          </select>
          {maxPosts ? <span className="block text-[11px] text-ink-muted mt-1">Your plan includes {maxPosts} post{maxPosts === 1 ? "" : "s"} a month. <Link href="/plans" className="underline">Change plan</Link></span> : null}
        </label>
        <label className="block">
          <span className="label !text-[9px] block mb-1">Anything to push or avoid? (optional)</span>
          <textarea className="input !py-2 text-sm" rows={2} placeholder="e.g. More ADU jobs in Mill Creek. Don't mention roofing." value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-ink" disabled={busy !== ""}>{busy === "save" ? "Saving…" : settings.enabled ? "Save changes" : "Turn on SEO Autopilot"}</button>
        {settings.enabled && <button type="button" className="btn btn-ghost" disabled={busy !== ""} onClick={() => submit(false)}>{busy === "pause" ? "Pausing…" : "Pause"}</button>}
        {msg && <p className={cn("text-sm", msg.ok ? "text-ink-muted" : "text-bad")}>{msg.text}</p>}
        {demo && !msg && <p className="text-xs text-ink-muted">Demo mode: the form works, nothing is saved.</p>}
      </div>
    </form>
  );
}
