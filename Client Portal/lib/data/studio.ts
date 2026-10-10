/* eslint-disable @typescript-eslint/no-explicit-any -- rows are untyped until `supabase gen types` runs */
import { createClient } from "@/lib/supabase/server";
import type { Session } from "./repo";

export type ItemKind = "inspection" | "signup" | "support" | "quote";
export type LeadStatus = "new" | "contacted" | "qualified" | "won" | "lost";
export type SupportStatus = "open" | "in_progress" | "done";

export type InboxItem = {
  kind: ItemKind;
  id: string;
  at: string;
  title: string;
  subtitle: string;
  who: string;
  status: string;
  open: boolean;
  company: { name: string; slug: string } | null;
  href: string;
  badge?: string;
};

const OPEN_LEAD = new Set(["new", "contacted", "qualified"]);
const days = (n: number) => new Date(Date.now() - n * 864e5).toISOString();

export function slugify(s: string) {
  return s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || `company-${Date.now()}`;
}

export function hostOf(url: string | null | undefined) {
  if (!url) return "";
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

/** Everything coming in, newest first. */
export async function getInbox(session: Session): Promise<InboxItem[]> {
  if (session.isDemo) return [];
  const db = await createClient();
  const [audits, signups, support, quotes] = await Promise.all([
    db.from("audit_reports").select("id, created_at, url, email, name, phone, company, status, grade:report->summary->>grade, failed:report->summary->>failed, seo_score:report->seo->>score").order("created_at", { ascending: false }).limit(200),
    db.from("signup_requests").select("*").order("created_at", { ascending: false }).limit(200),
    db.from("requests").select("*, clients(name, slug)").order("created_at", { ascending: false }).limit(200),
    db.from("estimator_generations").select("id, at, project_type, size, unit, quote_low, quote_high, contact_name, contact_email, contact_phone, status, clients(name, slug)").gte("at", days(60)).or("contact_email.not.is.null,contact_phone.not.is.null").order("at", { ascending: false }).limit(200),
  ]);

  const items: InboxItem[] = [];
  for (const a of (audits.data ?? []) as any[]) {
    const site = hostOf(a.url);
    items.push({
      kind: "inspection", id: a.id, at: a.created_at,
      title: a.company || site, subtitle: `Free inspection · grade ${a.grade ?? "?"}${a.seo_score ? ` · SEO ${a.seo_score}/100` : ""}${a.failed && +a.failed > 0 ? ` · ${a.failed} failing` : ""}`,
      who: [a.name, a.email].filter(Boolean).join(" · "), status: a.status ?? "new", open: OPEN_LEAD.has(a.status ?? "new"),
      company: null, href: `/studio/inspection/${a.id}`, badge: a.grade ?? undefined,
    });
  }
  for (const s of (signups.data ?? []) as any[]) {
    items.push({
      kind: "signup", id: s.id, at: s.created_at,
      title: s.company || s.email, subtitle: `Account request${s.website ? ` · ${hostOf(s.website)}` : ""}`,
      who: [s.name, s.email].filter(Boolean).join(" · "), status: s.status ?? "new", open: OPEN_LEAD.has(s.status ?? "new") && !s.client_id,
      company: null, href: `/studio/signup/${s.id}`,
    });
  }
  for (const r of (support.data ?? []) as any[]) {
    items.push({
      kind: "support", id: r.id, at: r.created_at,
      title: r.title, subtitle: `${String(r.title).startsWith("Interested in") ? "Plan upgrade interest" : r.type === "billing" ? "Billing" : `Support · ${r.type}`}${r.body ? ` · ${String(r.body).slice(0, 80)}` : ""}`,
      who: r.requester_email ?? "", status: r.status ?? "open", open: r.status !== "done",
      company: r.clients ? { name: r.clients.name, slug: r.clients.slug } : null, href: `/studio/support/${r.id}`,
    });
  }
  for (const q of (quotes.data ?? []) as any[]) {
    const slug = q.clients?.slug ?? "";
    items.push({
      kind: "quote", id: q.id, at: q.at,
      title: `${q.project_type ?? "Project"}${q.size ? `, ${Number(q.size).toLocaleString()} ${q.unit === "sqft" ? "sq ft" : q.unit}` : ""}`,
      subtitle: `Homeowner quote · $${Math.round((q.quote_low ?? 0) / 1000)}K–$${Math.round((q.quote_high ?? 0) / 1000)}K`,
      who: [q.contact_name, q.contact_email ?? q.contact_phone].filter(Boolean).join(" · "), status: q.status ?? "new", open: q.status === "new",
      company: q.clients ? { name: q.clients.name, slug } : null, href: `/api/client/open?slug=${encodeURIComponent(slug)}&next=${encodeURIComponent(`/estimator/${q.id}`)}`,
    });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

export async function getInspection(id: string) {
  const db = await createClient();
  const { data } = await db.from("audit_reports").select("*").eq("id", id).maybeSingle();
  return data as any;
}

export async function getSignup(id: string) {
  const db = await createClient();
  const { data } = await db.from("signup_requests").select("*, clients(name, slug)").eq("id", id).maybeSingle();
  return data as any;
}

export async function getSupport(id: string) {
  const db = await createClient();
  const { data } = await db.from("requests").select("*, clients(id, name, slug, website_url)").eq("id", id).maybeSingle();
  return data as any;
}

export type CompanyRow = {
  id: string; slug: string; name: string; industry: string; city: string; website: string;
  logins: string[];
  connections: { site: boolean; ga4: boolean; gsc: boolean; gbp: boolean; meta: boolean };
  visits30: number; visitsPrev30: number; leads30: number;
  openSupport: number; newQuoteLeads: number;
  lastSync: { at: string; ok: boolean } | null;
  status: "healthy" | "needs-setup" | "attention";
};

export async function getCompanies(session: Session): Promise<CompanyRow[]> {
  if (session.isDemo) return [];
  const db = await createClient();
  const [clients, integ, daily, reqs, gens, runs, logins] = await Promise.all([
    db.from("clients").select("*").order("name"),
    db.from("client_integrations").select("client_id, site_url, ga4_property_id, gsc_site_url, gbp_location_id, fb_page_id, ig_user_id"),
    db.from("website_daily").select("client_id, date, sessions, form_submissions, calls").gte("date", days(60).slice(0, 10)),
    db.from("requests").select("client_id, status").neq("status", "done"),
    db.from("estimator_generations").select("client_id, status, contact_email, contact_phone").eq("status", "new"),
    db.from("sync_runs").select("client_id, ok, ran_at").order("ran_at", { ascending: false }).limit(500),
    db.rpc("admin_client_logins"),
  ]);
  const cut = days(30).slice(0, 10);
  return ((clients.data ?? []) as any[]).map((c) => {
    const i = ((integ.data ?? []) as any[]).find((x) => x.client_id === c.id) ?? {};
    const d = ((daily.data ?? []) as any[]).filter((x) => x.client_id === c.id);
    const cur = d.filter((x) => x.date >= cut), prev = d.filter((x) => x.date < cut);
    const sum = (rows: any[], k: string) => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
    const myRuns = ((runs.data ?? []) as any[]).filter((r) => r.client_id === c.id);
    const lastAt = myRuns[0]?.ran_at;
    const lastBatch = myRuns.filter((r) => r.ran_at === lastAt);
    const connections = { site: Boolean(i.site_url ?? c.website_url), ga4: Boolean(i.ga4_property_id), gsc: Boolean(i.gsc_site_url), gbp: Boolean(i.gbp_location_id), meta: Boolean(i.fb_page_id || i.ig_user_id) };
    const connected = Object.values(connections).filter(Boolean).length;
    const openSupport = ((reqs.data ?? []) as any[]).filter((r) => r.client_id === c.id).length;
    const newQuoteLeads = ((gens.data ?? []) as any[]).filter((g) => g.client_id === c.id && (g.contact_email || g.contact_phone)).length;
    const lastSync = lastAt ? { at: lastAt, ok: lastBatch.every((r) => r.ok) } : null;
    const status: CompanyRow["status"] = connected < 3 ? "needs-setup" : openSupport > 0 || (lastSync && !lastSync.ok) ? "attention" : "healthy";
    return {
      id: c.id, slug: c.slug, name: c.name, industry: c.industry ?? "", city: c.city ?? "", website: c.website_url ?? i.site_url ?? "",
      logins: ((logins.data ?? []) as any[]).filter((l) => l.client_id === c.id).map((l) => l.email),
      connections, visits30: sum(cur, "sessions"), visitsPrev30: sum(prev, "sessions"), leads30: sum(cur, "form_submissions") + sum(cur, "calls"),
      openSupport, newQuoteLeads, lastSync, status,
    };
  });
}

/** Leads (inspections + account requests) that arrived in the last `n` days. */
export function newLeadsSince(items: InboxItem[], n: number) {
  const cut = Date.now() - n * 864e5;
  return items.filter((i) => (i.kind === "inspection" || i.kind === "signup") && new Date(i.at).getTime() > cut).length;
}
