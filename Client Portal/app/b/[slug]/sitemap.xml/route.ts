import { getHostedBlog, hostedBlogUrl } from "@/lib/data/hosted-blog";

export const dynamic = "force-dynamic";

/** A sitemap per hosted blog, so the company (or we) can submit it to Search Console. */
export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const blog = await getHostedBlog(slug);
  if (!blog) return new Response("Not found", { status: 404 });
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const urls = [hostedBlogUrl(slug), ...blog.posts.map((p) => hostedBlogUrl(slug, p.slug))];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u, i) => `  <url><loc>${esc(u)}</loc>${i ? `<lastmod>${blog.posts[i - 1].publishedAt}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
