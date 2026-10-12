"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowUpRight, Check, Copy, Pencil, X } from "lucide-react";
import type { PostQuality, SeoPost } from "@/lib/data/types";
import { mdToHtml } from "@/lib/autopilot/markdown";
import { cn, fmt } from "@/lib/utils";

const STATUS: Record<SeoPost["status"], { cls: string; text: string }> = {
  awaiting_approval: { cls: "pill-warn", text: "Needs your OK" },
  approved: { cls: "pill-neutral", text: "Publishing" },
  ready: { cls: "pill-neutral", text: "Ready to paste" },
  published: { cls: "pill-good", text: "Live" },
  skipped: { cls: "pill-neutral", text: "Skipped" },
  failed: { cls: "pill-bad", text: "Couldn't publish" },
};

function QualityBadge({ q }: { q: PostQuality }) {
  const tone = q.score >= 90 ? "pill-good" : q.score >= 75 ? "pill-warn" : "pill-bad";
  const missed = q.checks.filter((c) => !c.ok).length;
  return (
    <details className="relative">
      <summary className={cn("pill cursor-pointer select-none list-none inline-flex items-center gap-1", tone)}>SEO check {q.score}/100{missed ? ` · ${missed} to fix` : ""}</summary>
      <ul className="absolute z-10 mt-2 w-72 rounded-xl border border-line bg-bone p-3 shadow-lg space-y-1.5 text-xs">
        {q.checks.map((c) => (
          <li key={c.id} className="flex gap-2">
            <span className={cn("mt-0.5 h-4 w-4 rounded-full grid place-items-center shrink-0", c.ok ? "bg-good-bg text-good" : "bg-bad-bg text-bad")}>{c.ok ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}</span>
            <span><span className={cn(!c.ok && "font-medium")}>{c.label}</span> <span className="text-ink-muted">· {c.detail}</span></span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** One generated post: status, why it was written, its SEO score, the text itself, and what the client can do with it. */
export function PostCard({ post, open = false }: { post: SeoPost; open?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "approve" | "skip" | "save">("");
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState("");
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(post.title);
  const [meta, setMeta] = useState(post.metaDescription);
  const [body, setBody] = useState(post.bodyMd);
  const s = STATUS[post.status];

  async function act(action: "approve" | "skip") {
    setBusy(action); setMsg("");
    const res = await fetch("/api/autopilot/posts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: post.id, action }) });
    const j = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) { setMsg(j.error ?? "Something went wrong."); return; }
    setMsg(
      j.demo ? "Demo mode: nothing changed, but this is where it would publish."
        : action === "skip" ? "Skipped."
        : j.status === "published" ? "Published. It's live on your site."
        : j.status === "ready" ? "Approved. It's ready to paste onto your site."
        : j.queued ? "Approved. It goes live at the next daily run."
        : j.error ? `Approved, but publishing failed: ${j.error}`
        : "Approved.",
    );
    router.refresh();
  }

  async function save() {
    setBusy("save"); setMsg("");
    const res = await fetch("/api/autopilot/posts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: post.id, action: "edit", title, metaDescription: meta, bodyMd: body }) });
    const j = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) { setMsg(j.error ?? "Couldn't save."); return; }
    setEditing(false);
    setMsg(j.demo ? "Demo mode: not saved." : j.quality ? `Saved. SEO check now ${j.quality.score}/100.` : "Saved.");
    router.refresh();
  }

  async function copy(kind: "html" | "md") {
    const text = kind === "html" ? `<h1>${post.title}</h1>\n${mdToHtml(post.bodyMd)}` : `# ${post.title}\n\n${post.bodyMd}`;
    try { await navigator.clipboard.writeText(text); setCopied(kind); setTimeout(() => setCopied(""), 1500); }
    catch { setMsg("Couldn't copy. Open the post and select the text instead."); }
  }

  const canCopy = post.status === "ready" || post.status === "published" || post.status === "failed";
  const canEdit = post.status !== "published" && post.status !== "skipped";
  const perf = post.performance;
  return (
    <article className={cn("panel p-5", post.status === "awaiting_approval" && "border-warn")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className={cn("pill", s.cls)}>{s.text}</span>
            {post.quality && <QualityBadge q={post.quality} />}
            <span className="label !text-[9px]">{fmt.dateLong(post.publishedAt ?? post.createdAt)} · {fmt.int(post.wordCount)} words</span>
          </div>
          <h3 className="font-display text-xl leading-tight">{post.title}</h3>
          <p className="text-xs text-ink-muted mt-1">Written to rank for <span className="text-ink">“{post.targetQuery}”</span></p>
          {post.rationale && <p className="text-xs text-ink-muted mt-1"><span className="text-ink">Why this:</span> {post.rationale}</p>}
          {perf && <p className="text-xs mt-1"><span className="text-ink-muted">On Google:</span> {fmt.int(perf.clicks)} clicks · {fmt.int(perf.impressions)} times shown{perf.position ? ` · position ${perf.position}` : ""} · {perf.keywords} searches</p>}
        </div>
        {post.publishedUrl && <a href={post.publishedUrl} target="_blank" rel="noreferrer" className="btn btn-ghost !py-1.5 !px-3 text-xs">View on your site <ArrowUpRight className="h-3.5 w-3.5" /></a>}
      </div>
      {post.status === "failed" && post.error && <p className="mt-2 text-xs text-bad">{post.error}</p>}
      {post.status === "ready" && post.error && <p className="mt-2 text-xs text-ink-muted">{post.error}</p>}

      {editing ? (
        <div className="mt-3 rounded-xl border border-line p-4 space-y-3">
          <label className="block"><span className="label !text-[9px] block mb-1">Title · {title.trim().length} characters (45–65)</span><input className="input !py-2 text-sm" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></label>
          <label className="block"><span className="label !text-[9px] block mb-1">Meta description · {meta.trim().length} characters (130–160)</span><textarea className="input !py-2 text-sm" rows={2} value={meta} onChange={(e) => setMeta(e.target.value)} maxLength={400} /></label>
          <label className="block"><span className="label !text-[9px] block mb-1">Post (Markdown: ## headings, - lists, [links](/page))</span><textarea className="input !py-2 text-sm font-mono min-h-[18rem]" value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-ink !py-2 !px-4 text-xs" disabled={busy !== ""} onClick={save}>{busy === "save" ? "Saving…" : "Save changes"}</button>
            <button type="button" className="btn btn-ghost !py-2 !px-4 text-xs" disabled={busy !== ""} onClick={() => { setEditing(false); setTitle(post.title); setMeta(post.metaDescription); setBody(post.bodyMd); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <details className="mt-3" open={open}>
          <summary className="text-xs font-medium cursor-pointer select-none">Read the post →</summary>
          <div className="mt-3 rounded-xl border border-line p-4 sm:p-5">
            <p className="text-xs text-ink-muted mb-3"><span className="label !text-[9px] block">Meta description</span>{post.metaDescription}</p>
            <div className="post-body text-sm" dangerouslySetInnerHTML={{ __html: mdToHtml(post.bodyMd) }} />
          </div>
        </details>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {post.status === "awaiting_approval" && (
          <>
            <button type="button" className="btn btn-ink !py-2 !px-4 text-xs" disabled={busy !== "" || editing} onClick={() => act("approve")}><Check className="h-3.5 w-3.5" /> {busy === "approve" ? "Publishing…" : "Publish it"}</button>
            <button type="button" className="btn btn-ghost !py-2 !px-4 text-xs" disabled={busy !== "" || editing} onClick={() => act("skip")}><X className="h-3.5 w-3.5" /> {busy === "skip" ? "Skipping…" : "Skip this one"}</button>
          </>
        )}
        {post.status === "failed" && <button type="button" className="btn btn-ink !py-2 !px-4 text-xs" disabled={busy !== ""} onClick={() => act("approve")}>{busy === "approve" ? "Trying…" : "Try again"}</button>}
        {canEdit && !editing && <button type="button" className="btn btn-ghost !py-2 !px-4 text-xs" disabled={busy !== ""} onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /> Edit</button>}
        {canCopy && (
          <>
            <button type="button" className="btn btn-ghost !py-2 !px-4 text-xs" onClick={() => copy("html")}><Copy className="h-3.5 w-3.5" /> {copied === "html" ? "Copied" : "Copy as HTML"}</button>
            <button type="button" className="btn btn-ghost !py-2 !px-4 text-xs" onClick={() => copy("md")}><Copy className="h-3.5 w-3.5" /> {copied === "md" ? "Copied" : "Copy as text"}</button>
          </>
        )}
        {msg && <span className="text-xs text-ink-muted">{msg}</span>}
      </div>
    </article>
  );
}
