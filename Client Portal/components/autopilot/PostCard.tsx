"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowUpRight, Check, Copy, X } from "lucide-react";
import type { SeoPost } from "@/lib/data/types";
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

/** One generated post: status, the text itself, and what the client can do with it. */
export function PostCard({ post, open = false }: { post: SeoPost; open?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "approve" | "skip">("");
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState("");
  const s = STATUS[post.status];

  async function act(action: "approve" | "skip") {
    setBusy(action);
    setMsg("");
    const res = await fetch("/api/autopilot/posts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: post.id, action }) });
    const j = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) { setMsg(j.error ?? "Something went wrong."); return; }
    setMsg(
      j.demo ? "Demo mode: nothing changed, but this is where it would publish."
        : action === "skip" ? "Skipped."
        : j.status === "published" ? "Published."
        : j.status === "ready" ? "Approved. It's ready to paste onto your site."
        : j.queued ? "Approved. It goes live at the next daily run."
        : j.error ? `Approved, but publishing failed: ${j.error}`
        : "Approved.",
    );
    router.refresh();
  }

  async function copy(kind: "html" | "md") {
    const text = kind === "html" ? `<h1>${post.title}</h1>\n${mdToHtml(post.bodyMd)}` : `# ${post.title}\n\n${post.bodyMd}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setMsg("Couldn't copy. Open the post and select the text instead.");
    }
  }

  const canCopy = post.status === "ready" || post.status === "published" || post.status === "failed";
  return (
    <article className={cn("panel p-5", post.status === "awaiting_approval" && "border-warn")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className={cn("pill", s.cls)}>{s.text}</span>
            <span className="label !text-[9px]">{fmt.dateLong(post.publishedAt ?? post.createdAt)} · {fmt.int(post.wordCount)} words</span>
          </div>
          <h3 className="font-display text-xl leading-tight">{post.title}</h3>
          <p className="text-xs text-ink-muted mt-1">Written to rank for <span className="text-ink">“{post.targetQuery}”</span></p>
        </div>
        {post.publishedUrl && <a href={post.publishedUrl} target="_blank" rel="noreferrer" className="btn btn-ghost !py-1.5 !px-3 text-xs">View on your site <ArrowUpRight className="h-3.5 w-3.5" /></a>}
      </div>
      {post.status === "failed" && post.error && <p className="mt-2 text-xs text-bad">{post.error}</p>}
      {post.status === "ready" && post.error && <p className="mt-2 text-xs text-ink-muted">{post.error}</p>}
      <details className="mt-3" open={open}>
        <summary className="text-xs font-medium cursor-pointer select-none">Read the post →</summary>
        <div className="mt-3 rounded-xl border border-line p-4 sm:p-5">
          <p className="text-xs text-ink-muted mb-3"><span className="label !text-[9px] block">Meta description</span>{post.metaDescription}</p>
          <div className="post-body text-sm" dangerouslySetInnerHTML={{ __html: mdToHtml(post.bodyMd) }} />
        </div>
      </details>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {post.status === "awaiting_approval" && (
          <>
            <button type="button" className="btn btn-ink !py-2 !px-4 text-xs" disabled={busy !== ""} onClick={() => act("approve")}><Check className="h-3.5 w-3.5" /> {busy === "approve" ? "Publishing…" : "Publish it"}</button>
            <button type="button" className="btn btn-ghost !py-2 !px-4 text-xs" disabled={busy !== ""} onClick={() => act("skip")}><X className="h-3.5 w-3.5" /> {busy === "skip" ? "Skipping…" : "Skip this one"}</button>
          </>
        )}
        {post.status === "failed" && <button type="button" className="btn btn-ink !py-2 !px-4 text-xs" disabled={busy !== ""} onClick={() => act("approve")}>{busy === "approve" ? "Trying…" : "Try again"}</button>}
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
