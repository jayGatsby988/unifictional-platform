import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fmtPostDate, getHostedBlog, hostedBlogUrl } from "@/lib/data/hosted-blog";

export const dynamic = "force-dynamic";

async function load(params: Promise<{ slug: string; post: string }>) {
  const { slug, post } = await params;
  const blog = await getHostedBlog(slug);
  const p = blog?.posts.find((x) => x.slug === post) ?? null;
  return { slug, blog, p };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string; post: string }> }): Promise<Metadata> {
  const { slug, blog, p } = await load(params);
  if (!blog || !p) return { title: "Not found" };
  return {
    title: `${p.title} | ${blog.company.name}`,
    description: p.description,
    alternates: { canonical: hostedBlogUrl(slug, p.slug) },
    openGraph: { title: p.title, description: p.description, type: "article", url: hostedBlogUrl(slug, p.slug), publishedTime: p.publishedAt },
  };
}

export default async function HostedBlogPost({ params }: { params: Promise<{ slug: string; post: string }> }) {
  const { slug, blog, p } = await load(params);
  if (!blog || !p) notFound();
  const jsonLd = {
    "@context": "https://schema.org", "@type": "BlogPosting",
    headline: p.title, description: p.description, datePublished: p.publishedAt, wordCount: p.wordCount,
    author: { "@type": "Organization", name: blog.company.name, url: blog.company.websiteUrl || undefined },
    publisher: { "@type": "Organization", name: blog.company.name },
    mainEntityOfPage: hostedBlogUrl(slug, p.slug),
    ...(p.faq.length ? { hasPart: { "@type": "FAQPage", mainEntity: p.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) } } : {}),
  };
  return (
    <article className="mx-auto max-w-3xl px-5 py-14">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Link href={`/b/${slug}`} className="text-xs uppercase tracking-[0.18em] text-ink-muted hover:underline">← Blog</Link>
      <p className="text-xs text-ink-muted mt-8 mb-3">{fmtPostDate(p.publishedAt)}{p.wordCount ? ` · ${Math.max(1, Math.round(p.wordCount / 200))} min read` : ""}</p>
      <h1 className="font-display text-4xl sm:text-5xl leading-[1.02] mb-8">{p.title}</h1>
      <div className="post-body text-[1.05rem] leading-relaxed" dangerouslySetInnerHTML={{ __html: p.html }} />
      {p.faq.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display text-3xl mb-4">Common questions</h2>
          {p.faq.map((f) => (
            <div key={f.q} className="mt-6">
              <h3 className="font-medium text-lg">{f.q}</h3>
              <p className="text-ink-soft mt-1 leading-relaxed">{f.a}</p>
            </div>
          ))}
        </section>
      )}
      {blog.company.websiteUrl && (
        <p className="mt-12 pt-8 border-t border-line text-sm text-ink-muted">
          Ready to talk? Visit <a className="underline" href={blog.company.websiteUrl} rel="noreferrer">{blog.company.name}</a>{blog.company.city ? ` in ${blog.company.city}` : ""}.
        </p>
      )}
    </article>
  );
}
