/**
 * The small subset of Markdown the writer produces (headings, paragraphs, lists,
 * bold/italic, links) rendered to HTML, plus the helpers that turn a generated
 * post into a slug, a word count and a front-matter file. All pure.
 */

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Inline marks on an already-escaped line. Links only to http(s), site-relative or anchor URLs. */
function inline(s: string) {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/|#)[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

export function mdToHtml(md: string): string {
  const out: string[] = [];
  let para: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(esc(para.join(" ")))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join("")}</${list.tag}>`); list = null; } };
  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flushPara(); flushList(); out.push(`<h${h[1].length}>${inline(esc(h[2].trim()))}</h${h[1].length}>`); continue; }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const tag = ul ? "ul" : "ol";
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push(inline(esc((ul ?? ol)![1].trim())));
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return out.join("\n");
}

const STOP = new Set(["a", "an", "the", "and", "or", "of", "to", "in", "for", "on", "with", "your", "our", "is", "at", "by", "vs", "what", "how", "do", "does"]);

/** URL slug from a title: lowercase, hyphens, stop words dropped, at most `max` words. */
export function slugFor(title: string, max = 7): string {
  const words = title.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((w) => w && !STOP.has(w));
  return (words.length ? words : ["post"]).slice(0, max).join("-");
}

export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; i < 100; i++) if (!set.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now()}`;
}

export function wordCount(md: string): number {
  const text = md.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#*_`>]+/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.split(" ").length : 0;
}

/** Body + the FAQ as a closing section (each answer is a short paragraph under a bold question). */
export function assembleBody(body: string, faq: { q: string; a: string }[]): string {
  const b = body.trim();
  if (!faq.length) return b;
  return `${b}\n\n## Questions homeowners ask\n\n${faq.map((f) => `**${f.q.trim()}**\n\n${f.a.trim()}`).join("\n\n")}`;
}

const yaml = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** The .md file committed to a hosted site's repo: front matter the site's blog loader reads, then the body. */
export function markdownFile(p: { title: string; slug: string; metaDescription: string; excerpt: string; targetQuery: string }, body: string, date: string): string {
  return `---\ntitle: ${yaml(p.title)}\ndescription: ${yaml(p.metaDescription)}\nexcerpt: ${yaml(p.excerpt)}\nslug: ${p.slug}\ndate: ${date}\nkeyword: ${yaml(p.targetQuery)}\n---\n\n${body.trim()}\n`;
}

const FAQ_HEADING = "## Questions homeowners ask";

/** The inverse of assembleBody: the post body and the FAQ pairs as data, so a site can style the FAQ itself. */
export function splitFaq(md: string): { body: string; faq: { q: string; a: string }[] } {
  const at = md.startsWith(FAQ_HEADING) ? 0 : md.indexOf(`\n${FAQ_HEADING}`) === -1 ? -1 : md.indexOf(`\n${FAQ_HEADING}`) + 1;
  if (at === -1) return { body: md.trim(), faq: [] };
  const faq: { q: string; a: string }[] = [];
  for (const m of md.slice(at + FAQ_HEADING.length).matchAll(/\*\*([^*\n]+)\*\*\s*\n+([\s\S]*?)(?=\n+\*\*[^*\n]+\*\*\s*\n|\s*$)/g)) faq.push({ q: m[1].trim(), a: m[2].trim() });
  return { body: md.slice(0, at).trim(), faq };
}
