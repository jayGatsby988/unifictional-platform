/* eslint-disable @typescript-eslint/no-explicit-any -- rows are untyped until `supabase gen types` runs against the live schema */
import { NextResponse } from "next/server";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { mdToHtml, splitFaq } from "@/lib/autopilot/markdown";

const CACHE = { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" };

/**
 * Public, read-only. The published posts for one company, for websites that
 * render their blog from the portal instead of from a repo. Only posts the
 * client has published are returned, already rendered to HTML, with the FAQ
 * split out so the site can style it. Needs the service-role key (the anon
 * client can't read seo_posts); without it the feed is empty.
 */
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("client") ?? "";
  if (!slug) return NextResponse.json({ error: "client is required" }, { status: 400 });
  const db = adminConfigured ? createAdminClient() : await createClient();
  const { data: client } = await db.from("clients").select("id, name").eq("slug", slug).maybeSingle();
  if (!client) return NextResponse.json({ company: null, posts: [] }, { headers: CACHE });
  const { data } = await db.from("seo_posts")
    .select("slug, title, meta_description, excerpt, target_query, body_md, word_count, published_at")
    .eq("client_id", client.id).eq("status", "published").order("published_at", { ascending: false }).limit(200);
  const posts = ((data ?? []) as any[]).map((p) => {
    const { body, faq } = splitFaq(p.body_md ?? "");
    return {
      slug: p.slug, title: p.title, description: p.meta_description ?? "", excerpt: p.excerpt ?? "", keyword: p.target_query ?? "",
      publishedAt: p.published_at, wordCount: p.word_count ?? 0, html: mdToHtml(body), markdown: body, faq,
    };
  });
  return NextResponse.json({ company: client.name, posts }, { headers: CACHE });
}
