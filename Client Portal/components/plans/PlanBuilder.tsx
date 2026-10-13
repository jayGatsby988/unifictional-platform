"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import type { AddonKey, Catalog, PostsChoice } from "@/lib/billing/packages";
import { MIN_CHARGE_CENTS, POSTS_CHOICES, addonPriceCents, availablePackages, packageFor, packagePriceCents, perPostCents, postsPriceCents } from "@/lib/billing/packages";
import type { Recommendation } from "@/lib/billing/recommend";
import { money } from "@/lib/billing/types";
import { cn } from "@/lib/utils";

const POSTS_LABEL: Record<PostsChoice, { title: string; detail: string }> = {
  1: { title: "Once a month", detail: "Keeps the lights on." },
  2: { title: "Every two weeks", detail: "Right for an established blog." },
  4: { title: "Every week", detail: "The pace Google rewards." },
  8: { title: "Twice a week", detail: "Builds a base fast in a crowded trade." },
};

const AFTER = [
  ["Two questions", "Where your site lives, and whether posts go live on their own or wait for your OK."],
  ["Your first post, in minutes", "Hit Write a post now and watch it research, write and check itself."],
  ["Then on schedule", "A new post from your content plan, reviewed automatically, plus fixes for your site."],
];

const sameSet = (a: AddonKey[], b: AddonKey[]) => a.length === b.length && a.every((k) => b.includes(k));

type Props = {
  catalog: Catalog;
  rec: Recommendation;
  company: { name: string };
  slug: string;
  demo: boolean;
  admin: boolean;
  /** They already have access: what they're on. The builder then offers a change request instead of a checkout. */
  current: { label: string; comped: boolean } | null;
  mode: "paywall" | "plans";
};

/**
 * Pick how many posts a month, add what you need (or take a package), see what
 * we recommend and why, and start on Square. Prices come from the studio's plan
 * rows; the server recomputes the total before checkout.
 */
export function PlanBuilder({ catalog, rec, company, slug, demo, admin, current, mode }: Props) {
  const router = useRouter();
  const sold = new Set(catalog.addons.map((a) => a.key));
  const recAddons = rec.addons.filter((k) => sold.has(k));
  const [posts, setPosts] = useState<PostsChoice>(rec.posts);
  const [addons, setAddons] = useState<AddonKey[]>(recAddons);
  const [busy, setBusy] = useState<"" | "pay" | "comp" | "ask">("");
  const [msg, setMsg] = useState("");
  const [asked, setAsked] = useState(false);

  const packages = availablePackages(catalog);
  const selected = packageFor(catalog, addons);
  const recommended = packageFor(catalog, recAddons);
  const total = packagePriceCents(catalog, posts, addons);
  const raw = postsPriceCents(catalog, posts) + addons.reduce((n, k) => n + addonPriceCents(catalog, k), 0);
  const onRec = posts === rec.posts && sameSet(addons, recAddons);
  const planLabel = `${posts} post${posts === 1 ? "" : "s"} a month${addons.length ? ` + ${addons.map((k) => catalog.addons.find((a) => a.key === k)?.name.toLowerCase()).join(" + ")}` : ""}`;

  const toggle = (k: AddonKey) => setAddons((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));

  async function pay() {
    if (demo) { setMsg("Demo mode: this is where Square's checkout opens."); return; }
    setBusy("pay"); setMsg("");
    const res = await fetch("/api/autopilot/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ posts, addons }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setBusy(""); setMsg(j.error ?? "Couldn't start the checkout."); return; }
    if (!j.url) { setBusy(""); setMsg("Demo mode: this is where Square's checkout opens."); return; }
    window.location.href = j.url;
  }

  async function ask() {
    if (demo) { setAsked(true); return; }
    setBusy("ask"); setMsg("");
    const res = await fetch("/api/requests", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "billing", title: `Change plan to ${planLabel}`, body: `They built ${planLabel} (${money(total)}/month) on the Plans page and asked to switch to it. Currently: ${current?.label ?? "—"}.` }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) { setMsg(j.error ?? "Couldn't send."); return; }
    setAsked(true);
  }

  async function comp() {
    setBusy("comp"); setMsg("");
    const res = await fetch("/api/studio/autopilot", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, comped: true }) });
    const j = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) { setMsg(j.error ?? "Couldn't save."); return; }
    router.refresh();
  }

  return (
    <div className="grid lg:grid-cols-5 gap-4">
      <div className="lg:col-span-3 space-y-4">
        {/* 1 · posts a month */}
        <section className="panel p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
            <h2 className="label">1 · How many posts a month?</h2>
            <span className="text-xs text-ink-muted">{money(Math.round(perPostCents(catalog)))} a post, written, checked and published</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {POSTS_CHOICES.map((n) => {
              const on = posts === n;
              return (
                <button key={n} type="button" onClick={() => setPosts(n)} aria-pressed={on}
                  className={cn("relative rounded-xl border p-4 text-left transition", on ? "border-ink bg-paper" : "border-line hover:border-ink/40")}>
                  {n === rec.posts && <span className="absolute -top-2.5 right-3 pill bg-ink text-bone">Recommended</span>}
                  <span className="font-display text-3xl leading-none">{n}</span>
                  <span className="block text-sm font-medium mt-1.5">{POSTS_LABEL[n].title}</span>
                  <span className="block text-xs text-ink-muted mt-0.5">{POSTS_LABEL[n].detail}</span>
                  <span className="block text-xs mt-2">{money(postsPriceCents(catalog, n))}<span className="text-ink-muted">/mo</span></span>
                </button>
              );
            })}
          </div>
          <div className="mt-4 rounded-xl border border-line bg-paper p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="text-sm font-medium flex items-center gap-2"><Sparkles className="h-4 w-4" />Recommended for {company.name}: {rec.posts} post{rec.posts === 1 ? "" : "s"} a month{recAddons.length ? ` + ${recAddons.map((k) => catalog.addons.find((a) => a.key === k)?.name.toLowerCase()).join(" + ")}` : ""}</p>
              {!onRec && <button type="button" className="btn btn-ghost !py-1.5 !px-3 text-xs" onClick={() => { setPosts(rec.posts); setAddons(recAddons); }}>Use the recommendation</button>}
            </div>
            <ul className="mt-2 space-y-1.5 text-sm text-ink-muted">
              {rec.reasons.map((r) => <li key={r} className="flex gap-2"><span className="text-ink">—</span>{r}</li>)}
            </ul>
            <p className="mt-2 text-xs text-ink-muted">{rec.basis.readSite ? `Read from your website: ${rec.basis.pages} page${rec.basis.pages === 1 ? "" : "s"}, ${rec.basis.blogPosts} blog post${rec.basis.blogPosts === 1 ? "" : "s"}.` : "We'll refine this once we can read your website."}</p>
          </div>
        </section>

        {/* 2 · add-ons */}
        {catalog.addons.length > 0 && (
          <section className="panel p-5 sm:p-6">
            <h2 className="label mb-4">2 · Add to it</h2>
            <div className="grid gap-2">
              {catalog.addons.map((a) => {
                const on = addons.includes(a.key);
                return (
                  <label key={a.key} className={cn("flex gap-3 rounded-xl border p-4 cursor-pointer transition", on ? "border-ink bg-paper" : "border-line hover:border-ink/40")}>
                    <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(a.key)} />
                    <span className={cn("mt-0.5 h-5 w-5 rounded-md border grid place-items-center shrink-0", on ? "bg-ink border-ink text-bone" : "border-line")}>{on && <Check className="h-3 w-3" />}</span>
                    <span className="flex-1 min-w-0">
                      <span className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{a.name}</span>{recAddons.includes(a.key) && <span className="pill bg-ink text-bone">Recommended</span>}</span>
                      <span className="block text-xs text-ink-muted mt-0.5">{a.tagline}</span>
                      {on && a.features.length > 0 && (
                        <ul className="mt-2 grid sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          {a.features.map((f) => <li key={f} className="flex items-start gap-1.5"><Check className="h-3 w-3 mt-0.5 shrink-0 text-good" />{f}</li>)}
                        </ul>
                      )}
                    </span>
                    <span className="text-sm whitespace-nowrap">+{money(a.priceCents)}<span className="text-ink-muted">/mo</span></span>
                  </label>
                );
              })}
            </div>
          </section>
        )}

        {/* 3 · packages */}
        {packages.length > 1 && (
          <section className="panel p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
              <h2 className="label">3 · Or take a package</h2>
              <span className="text-xs text-ink-muted">Prices shown at {posts} post{posts === 1 ? "" : "s"} a month</span>
            </div>
            <div className={cn("grid gap-3", packages.length >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
              {packages.map((p) => {
                const on = selected?.key === p.key;
                const isRec = recommended?.key === p.key;
                const price = packagePriceCents(catalog, posts, p.addons);
                return (
                  <button key={p.key} type="button" onClick={() => setAddons(p.addons)} aria-pressed={on}
                    className={cn("relative rounded-xl border p-4 text-left transition flex flex-col", on ? "border-ink bg-paper" : "border-line hover:border-ink/40")}>
                    {isRec && <span className="absolute -top-2.5 right-3 pill bg-ink text-bone">Recommended</span>}
                    <span className="font-display text-2xl uppercase leading-none">{p.name}</span>
                    <span className="block text-xs text-ink-muted mt-1.5 flex-1">{p.pitch}</span>
                    <ul className="mt-3 space-y-1 text-xs">
                      <li className="flex items-start gap-1.5"><Check className="h-3 w-3 mt-0.5 shrink-0" />{posts} SEO post{posts === 1 ? "" : "s"} a month</li>
                      {p.addons.map((k) => <li key={k} className="flex items-start gap-1.5"><Check className="h-3 w-3 mt-0.5 shrink-0" />{catalog.addons.find((a) => a.key === k)?.name}</li>)}
                    </ul>
                    <span className="block mt-3 font-display text-2xl leading-none">{money(price)}<span className="text-xs font-sans text-ink-muted"> / month</span></span>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {/* your plan */}
      <aside className="lg:col-span-2 space-y-4">
        <div className="panel p-5 sm:p-6 !bg-ink !text-bone !border-ink lg:sticky lg:top-6">
          <p className="label !text-bone/60 mb-2">Your plan</p>
          <p className="font-display text-3xl leading-none">{selected?.name ?? "Your own mix"}</p>
          <ul className="mt-5 space-y-2 text-sm">
            <li className="flex justify-between gap-3"><span>{posts} post{posts === 1 ? "" : "s"} a month · {POSTS_LABEL[posts].title.toLowerCase()}</span><span className="text-bone/80">{money(postsPriceCents(catalog, posts))}</span></li>
            {addons.map((k) => { const a = catalog.addons.find((x) => x.key === k); return a ? <li key={k} className="flex justify-between gap-3"><span>{a.name}</span><span className="text-bone/80">+{money(a.priceCents)}</span></li> : null; })}
          </ul>
          <div className="mt-5 pt-5 border-t border-bone/15 flex items-end justify-between gap-3">
            <span className="text-sm text-bone/70">Total</span>
            <span className="font-display text-4xl leading-none">{money(total)}<span className="text-base text-bone/70"> / month</span></span>
          </div>
          {raw < MIN_CHARGE_CENTS && <p className="mt-2 text-xs text-bone/60">Rounded up to {money(MIN_CHARGE_CENTS)}, the smallest charge Square allows.</p>}

          <div className="mt-6">
            {current ? (
              asked ? (
                <p className="text-sm flex items-start gap-2"><Check className="h-4 w-4 mt-0.5 shrink-0" />Got it. We&apos;ll switch you over and confirm within a day.</p>
              ) : (
                <>
                  <p className="text-xs text-bone/60 mb-3">You&apos;re on <span className="text-bone">{current.label}</span>.{current.comped ? " It's included in your plan with Unifictional." : ""}</p>
                  <button type="button" className="btn bg-bone text-ink hover:opacity-90 w-full justify-center" disabled={busy !== ""} onClick={ask}>{busy === "ask" ? "Sending…" : "Switch to this plan"}</button>
                </>
              )
            ) : (
              <>
                <button type="button" className="btn bg-bone text-ink hover:opacity-90 w-full justify-center !py-3" disabled={busy !== ""} onClick={pay}>
                  {busy === "pay" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{busy === "pay" ? "Opening Square…" : `Start for ${money(total)}/month`}
                </button>
                <p className="mt-3 text-xs text-bone/60">Secure checkout by Square. Your first post is written minutes after you pay. Cancel any time from your SEO Autopilot settings.</p>
              </>
            )}
            {admin && !current && (
              <div className="mt-4 pt-4 border-t border-bone/15 flex flex-wrap items-center gap-3">
                <p className="text-xs text-bone/60">Studio: include it in their plan instead?</p>
                <button type="button" className="btn btn-ghost !border-bone/30 !text-bone !py-1.5 !px-3 text-xs" disabled={busy !== ""} onClick={comp}>{busy === "comp" ? "Saving…" : "Give access without a subscription"}</button>
              </div>
            )}
            {msg && <p className="mt-3 text-sm text-bone/80">{msg}</p>}
          </div>
        </div>

        {mode === "paywall" && (
          <div className="panel p-5">
            <p className="label mb-3">What happens after you start</p>
            <ol className="space-y-3 text-sm">
              {AFTER.map(([t, d], i) => (
                <li key={t} className="flex gap-3"><span className="font-mono text-xs text-ink-muted mt-0.5">0{i + 1}</span><div><p className="font-medium">{t}</p><p className="text-ink-muted">{d}</p></div></li>
              ))}
            </ol>
          </div>
        )}
      </aside>
    </div>
  );
}
