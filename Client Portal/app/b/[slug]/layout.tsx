import Link from "next/link";
import { notFound } from "next/navigation";
import { getHostedBlog } from "@/lib/data/hosted-blog";

/**
 * Chrome for a company's hosted blog: their name, a link back to their site,
 * and nothing of the portal's. Public; no sign-in.
 */
export default async function HostedBlogLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const blog = await getHostedBlog(slug);
  if (!blog) notFound();
  const site = blog.company.websiteUrl;
  const host = site.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-line">
        <div className="mx-auto max-w-3xl px-5 h-16 flex items-center justify-between gap-4">
          <Link href={`/b/${slug}`} className="font-display text-xl uppercase tracking-wide truncate">{blog.company.name}</Link>
          <nav className="flex items-center gap-5 text-xs uppercase tracking-[0.18em]">
            <Link href={`/b/${slug}`} className="hover:underline">Blog</Link>
            {site && <a href={site} className="hover:underline" rel="noreferrer">{host}</a>}
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto max-w-3xl px-5 py-8 text-xs text-ink-muted flex flex-wrap justify-between gap-3">
          <span>© {new Date().getFullYear()} {blog.company.name}{blog.company.city ? ` · ${blog.company.city}` : ""}</span>
          <span>Blog by <a className="underline" href="https://unifictional.com" rel="noreferrer">Unifictional</a></span>
        </div>
      </footer>
    </div>
  );
}
