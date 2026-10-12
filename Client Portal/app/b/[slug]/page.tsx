import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fmtPostDate, getHostedBlog, hostedBlogUrl } from "@/lib/data/hosted-blog";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const blog = await getHostedBlog(slug);
  if (!blog) return { title: "Not found" };
  const what = blog.company.industry ? `${blog.company.industry}${blog.company.city ? ` in ${blog.company.city}` : ""}` : blog.company.city || "";
  return {
    title: `${blog.company.name} — Blog`,
    description: `Guides, answers and news from ${blog.company.name}${what ? `, ${what}` : ""}.`,
    alternates: { canonical: hostedBlogUrl(slug) },
    openGraph: { title: `${blog.company.name} — Blog`, type: "website", url: hostedBlogUrl(slug) },
  };
}

export default async function HostedBlogIndex({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const blog = await getHostedBlog(slug);
  if (!blog) notFound();
  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <p className="label mb-3">Blog</p>
      <h1 className="font-display text-4xl sm:text-5xl leading-none mb-10">From {blog.company.name}.</h1>
      <div className="divide-y divide-line">
        {blog.posts.map((p) => (
          <article key={p.slug} className="py-7">
            <p className="text-xs text-ink-muted mb-2">{fmtPostDate(p.publishedAt)}{p.wordCount ? ` · ${Math.max(1, Math.round(p.wordCount / 200))} min read` : ""}</p>
            <h2 className="font-display text-2xl sm:text-3xl leading-tight"><Link href={`/b/${slug}/${p.slug}`} className="hover:underline">{p.title}</Link></h2>
            <p className="text-ink-muted mt-2 max-w-2xl">{p.excerpt || p.description}</p>
            <Link href={`/b/${slug}/${p.slug}`} className="inline-block mt-3 text-xs uppercase tracking-[0.18em] hover:underline">Read →</Link>
          </article>
        ))}
        {blog.posts.length === 0 && <p className="py-7 text-ink-muted">The first post is on its way.</p>}
      </div>
    </div>
  );
}
