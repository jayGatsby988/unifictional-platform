/* eslint-disable @typescript-eslint/no-explicit-any -- rows are untyped until `supabase gen types` runs against the live schema */
import { createAdminClient } from "@/lib/supabase/admin";
import { slugify } from "@/lib/data/studio";
import { normalizeUrl } from "@/lib/audit";

/**
 * Self-serve: the company a person named at sign-up becomes a real client
 * record with them as its owner, so they land in their own portal on first
 * sign-in instead of waiting for the studio to link them. Idempotent: someone
 * who already belongs to a company keeps it.
 */
export async function ensureCompany(input: { userId: string; name: string; company: string; website?: string; email: string }): Promise<{ clientId: string; slug: string; created: boolean } | null> {
  const admin = createAdminClient();
  const { data: member } = await admin.from("client_members").select("client_id, clients(slug)").eq("user_id", input.userId).limit(1).maybeSingle();
  if (member?.client_id) return { clientId: member.client_id, slug: (member as any).clients?.slug ?? "", created: false };

  let slug = slugify(input.company);
  const { data: taken } = await admin.from("clients").select("slug").like("slug", `${slug}%`);
  if (taken?.some((t: { slug: string }) => t.slug === slug)) slug = `${slug}-${(taken?.length ?? 1) + 1}`;
  const site = input.website ? normalizeUrl(input.website) : null;

  const { data: client, error } = await admin.from("clients").insert({ slug, name: input.company, website_url: site, services: ["SEO Autopilot"] }).select("id, slug").single();
  if (error || !client) { console.error("[signup] company", error?.message); return null; }
  await admin.from("client_members").insert({ client_id: client.id, user_id: input.userId, role: "owner" });
  if (site) await admin.from("client_integrations").upsert({ client_id: client.id, site_url: site }, { onConflict: "client_id" });
  await admin.from("activity").insert({ client_id: client.id, area: "account", title: `${input.name || input.email} created this account from the sign-up page` });
  return { clientId: client.id, slug: client.slug, created: true };
}
