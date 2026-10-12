/* eslint-disable @typescript-eslint/no-explicit-any -- rows are untyped until `supabase gen types` runs against the live schema */
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { mdToHtml, splitFaq } from "@/lib/autopilot/markdown";
import { demoMode } from "@/lib/env";
import { demoAutopilot } from "./demo";

/**
 * The blog we host for companies whose site builder can't be published to
 * (GoDaddy, Wix, Squarespace…): public pages at /b/<company>. Posts come
 * straight from seo_posts, so publishing is instant and needs no access to
 * the client's site. Needs the service-role key (the anon client can't read
 * seo_posts); without it the blog is empty.
 */
export type HostedPost = { slug: string; title: string; description: string; excerpt: string; html: string; faq: { q: string; a: string }[]; publishedAt: string; wordCount: number };
export type HostedBlog = { company: { slug: string; name: string; websiteUrl: string; industry: string; city: string }; posts: HostedPost[] };

/** Where the hosted blog lives. The cron has no request to read it from, so it's an env var with a Vercel fallback. */
export const portalOrigin = () => process.env.NEXT_PUBLIC_PORTAL_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:8120");
export const hostedBlogUrl = (companySlug: string, postSlug?: string) => `${portalOrigin()}/b/${companySlug}${postSlug ? `/${postSlug}` : ""}`;

function shape(p: any): HostedPost {
  const { body, faq } = splitFaq(p.body_md ?? "");
  return { slug: p.slug, title: p.title, description: p.meta_description ?? "", excerpt: p.excerpt ?? p.meta_description ?? "", html: mdToHtml(body), faq, publishedAt: (p.published_at ?? p.created_at ?? "").slice(0, 10), wordCount: p.word_count ?? 0 };
}

export async function getHostedBlog(companySlug: string): Promise<HostedBlog | null> {
  if (demoMode) {
    if (companySlug !== "northline-builders") return null;
    const posts = demoAutopilot.posts.filter((p) => p.status === "published").map((p) => shape({ slug: p.slug, title: p.title, meta_description: p.metaDescription, excerpt: p.excerpt, body_md: p.bodyMd, published_at: p.publishedAt, word_count: p.wordCount }));
    return { company: { slug: companySlug, name: "Northline Builders", websiteUrl: "https://northlinebuilders.com", industry: "General contractor", city: "Everett, WA" }, posts };
  }
  if (!adminConfigured) return null;
  const db = createAdminClient();
  const { data: client } = await db.from("clients").select("id, slug, name, website_url, industry, city").eq("slug", companySlug).maybeSingle();
  if (!client) return null;
  const { data } = await db.from("seo_posts").select("slug, title, meta_description, excerpt, body_md, word_count, published_at, created_at")
    .eq("client_id", client.id).eq("status", "published").order("published_at", { ascending: false }).limit(500);
  return {
    company: { slug: client.slug, name: client.name, websiteUrl: client.website_url ?? "", industry: client.industry ?? "", city: client.city ?? "" },
    posts: ((data ?? []) as any[]).map(shape),
  };
}

export const fmtPostDate = (iso: string) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : "");
