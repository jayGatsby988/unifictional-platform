import { test } from "node:test";
import assert from "node:assert/strict";

const md = await import("../lib/autopilot/markdown.ts");
const sched = await import("../lib/autopilot/schedule.ts");
const brief = await import("../lib/autopilot/brief.ts");
const pub = await import("../lib/autopilot/publish.ts");
const site = await import("../lib/autopilot/site.ts");
const run = await import("../lib/autopilot/run.ts");

test("markdown renders the writer's subset and escapes anything else", () => {
  const html = md.mdToHtml("## Costs\n\nMost ADUs land **between $280k and $380k**.\n\n- Design\n- Permits\n\n1. First\n2. Second\n\nSee [our ADU page](/services/adu) or <script>alert(1)</script> [bad](javascript:alert(1)).");
  assert.match(html, /<h2>Costs<\/h2>/);
  assert.match(html, /<strong>between \$280k and \$380k<\/strong>/);
  assert.match(html, /<ul><li>Design<\/li><li>Permits<\/li><\/ul>/);
  assert.match(html, /<ol><li>First<\/li><li>Second<\/li><\/ol>/);
  assert.match(html, /<a href="\/services\/adu">our ADU page<\/a>/);
  assert.ok(html.includes("&lt;script&gt;"), "script tags are escaped");
  assert.ok(!html.includes('href="javascript:'), "javascript: links are not linked");
});

test("slugs drop stop words, stay short and stay unique", () => {
  assert.equal(md.slugFor("How Much Does a Detached ADU Cost in Everett, WA? (2026)"), "much-detached-adu-cost-everett-wa-2026");
  assert.equal(md.slugFor("!!!"), "post");
  assert.equal(md.uniqueSlug("adu-cost", ["adu-cost", "adu-cost-2"]), "adu-cost-3");
  assert.equal(md.uniqueSlug("adu-cost", []), "adu-cost");
});

test("body assembly, word count and the committed file", () => {
  const body = md.assembleBody("Intro.\n\n## Section\n\nText [link](/x).", [{ q: "Do I need a permit?", a: "Usually, yes." }]);
  assert.ok(body.endsWith("## Questions homeowners ask\n\n**Do I need a permit?**\n\nUsually, yes."));
  assert.equal(md.wordCount("Hello **big** world [link](/x)"), 4);
  const file = md.markdownFile({ title: 'Say "hi"', slug: "say-hi", metaDescription: "Desc", excerpt: "Ex", targetQuery: "hi everett" }, "Body", "2026-10-10");
  assert.ok(file.startsWith('---\ntitle: "Say \\"hi\\""\ndescription: "Desc"\nexcerpt: "Ex"\nslug: say-hi\ndate: 2026-10-10\nkeyword: "hi everett"\n---\n\nBody\n'));
});

test("schedule: weekly is seven days, failures retry tomorrow, unknown cadences are rejected", () => {
  const from = new Date("2026-10-10T14:00:00Z");
  assert.equal(sched.nextRunAt("weekly", from), "2026-10-17T14:00:00.000Z");
  assert.equal(sched.nextRunAt("twice_weekly", from), "2026-10-14T02:00:00.000Z");
  assert.equal(sched.retryAt(from), "2026-10-11T14:00:00.000Z");
  assert.equal(sched.isDue(null), true);
  assert.equal(sched.isDue("2026-10-09T00:00:00Z", from), true);
  assert.equal(sched.isDue("2026-10-11T00:00:00Z", from), false);
  assert.equal(sched.isCadence("weekly"), true);
  assert.equal(sched.isCadence("hourly"), false);
  assert.equal(sched.cadenceLabel("weekly"), "Every week · 4 posts a month");
});

test("the brief carries the client, the owner's notes, the site, keywords and what not to repeat", () => {
  const text = brief.buildBrief({
    client: { name: "Northline Builders", industry: "General Contractor", city: "Everett, WA", websiteUrl: "https://northlinebuilders.com", services: ["Website"] },
    notes: "Push ADUs in Mill Creek.",
    site: { title: "Northline Builders | ADU builder in Everett", description: "Remodels and ADUs", text: "We build detached ADUs and remodel kitchens across Everett and Snohomish County.", paths: ["/services/adu-construction", "/contact"] },
    keywords: [{ keyword: "adu cost washington", position: 12, url: "/guides/adu-cost" }],
    existingPosts: [{ title: "Kitchen permits", targetQuery: "kitchen remodel permit snohomish county" }],
    healthIssues: ["Title tag: too long (74 characters)"],
    cadence: "Every week · 4 posts a month",
  });
  for (const needle of ["Company: Northline Builders", "Based in: Everett, WA", "Push ADUs in Mill Creek.", "/services/adu-construction", '"adu cost washington" — position 12', "Kitchen permits", "Title tag: too long", "Every week"]) {
    assert.ok(text.includes(needle), `brief mentions ${needle}`);
  }
  // Without a site or a city the brief still reads sensibly.
  const bare = brief.buildBrief({ client: { name: "X", industry: "", city: "", websiteUrl: "", services: [] }, notes: "", site: null, keywords: [], existingPosts: [], healthIssues: [], cadence: "weekly" });
  assert.ok(bare.includes("Trade: contractor") && bare.includes("Based in: their service area"));
});

test("WordPress URL normalising and the post payload", () => {
  assert.equal(pub.normalizeWpUrl("mysite.com/wp-admin/"), "https://mysite.com");
  assert.equal(pub.normalizeWpUrl("https://blog.mysite.com/wp-json/wp/v2"), "https://blog.mysite.com");
  assert.equal(pub.normalizeWpUrl("http://mysite.com/site/"), "http://mysite.com/site");
  assert.equal(pub.normalizeWpUrl("   "), null);
  const p = pub.wordpressPayload({ title: "T", slug: "t", metaDescription: "Meta", excerpt: "", targetQuery: "q", bodyMd: "## H\n\nBody" });
  assert.deepEqual(p, { title: "T", slug: "t", content: "<h2>H</h2>\n<p>Body</p>", excerpt: "Meta", status: "publish" });
  assert.equal(pub.githubPath("/content/blog/", "my-post"), "content/blog/my-post.md");
  assert.equal(pub.githubPath("", "my-post"), "content/blog/my-post.md");
  assert.equal(pub.publicPostUrl("https://example.com/", "my-post"), "https://example.com/blog/my-post");
});

test("site context: title, description, internal pages only", () => {
  const html = `<html><head><title> Cascade Poolworks | Pool builder </title><meta name="description" content="Pools only."></head>
    <body><nav><a href="/services/">Services</a><a href="https://cascadepoolworks.com/about?x=1">About</a><a href="https://facebook.com/x">FB</a><a href="/logo.png">img</a><a href="/">Home</a></nav>
    <script>var x = 1;</script><p>We design and build pools in Seattle.</p></body></html>`;
  const ctx = site.extractSiteContext(html, "https://cascadepoolworks.com/");
  assert.equal(ctx.title, "Cascade Poolworks | Pool builder");
  assert.equal(ctx.description, "Pools only.");
  assert.deepEqual(ctx.paths, ["/services", "/about"]);
  assert.ok(ctx.text.includes("We design and build pools in Seattle.") && !ctx.text.includes("var x"));
  assert.deepEqual(site.extractSitemapPaths("<urlset><url><loc>https://cascadepoolworks.com/blog/a/</loc></url><url><loc>https://other.com/b</loc></url></urlset>", "https://cascadepoolworks.com"), ["/blog/a"]);
});

test("publishing target follows the client's choice and what the studio has set up", () => {
  const wp = run.resolveTarget({ target: "wordpress" }, { wp_url: "https://m.com", wp_user: "u", wp_app_password: "p" }, "https://m.com", {});
  assert.deepEqual(wp, { kind: "wordpress", url: "https://m.com", user: "u", appPassword: "p" });
  assert.equal(run.resolveTarget({ target: "wordpress" }, null, "https://m.com", {}).kind, "manual");
  const gh = run.resolveTarget({ target: "hosted" }, { site_repo: "unifictional/site", site_blog_dir: null }, "https://m.com", { githubToken: "t" });
  assert.deepEqual(gh, { kind: "github", repo: "unifictional/site", dir: "content/blog", siteUrl: "https://m.com", token: "t" });
  const noToken = run.resolveTarget({ target: "hosted" }, { site_repo: "unifictional/site" }, "https://m.com", {});
  assert.ok(noToken.kind === "manual" && noToken.reason.includes("GITHUB_TOKEN"));
  const noRepo = run.resolveTarget({ target: "hosted" }, null, "https://m.com", { githubToken: "t" });
  assert.ok(noRepo.kind === "manual" && noRepo.reason.includes("GitHub repo"));
  assert.equal(run.resolveTarget({ target: "manual" }, null, "", {}).kind, "manual");
});

test("the feed splits the FAQ back out of the body, and a revalidate URL makes a hosted site publishable", () => {
  const body = md.assembleBody("Intro.\n\n## Costs\n\nSome **bold** text.", [{ q: "Do I need a permit?", a: "Usually, yes." }, { q: "How long?", a: "Two to four weeks.\n\nSometimes longer." }]);
  const { body: back, faq } = md.splitFaq(body);
  assert.equal(back, "Intro.\n\n## Costs\n\nSome **bold** text.");
  assert.deepEqual(faq, [{ q: "Do I need a permit?", a: "Usually, yes." }, { q: "How long?", a: "Two to four weeks.\n\nSometimes longer." }]);
  assert.deepEqual(md.splitFaq("No faq here."), { body: "No faq here.", faq: [] });
  const feed = run.resolveTarget({ target: "hosted" }, { site_revalidate_url: "https://m.com/api/revalidate?secret=x" }, "https://m.com", {});
  assert.deepEqual(feed, { kind: "feed", revalidateUrl: "https://m.com/api/revalidate?secret=x", siteUrl: "https://m.com" });
  const repoWins = run.resolveTarget({ target: "hosted" }, { site_repo: "o/r", site_revalidate_url: "https://m.com/api/revalidate" }, "https://m.com", { githubToken: "t" });
  assert.equal(repoWins.kind, "github");
});

const quality = await import("../lib/autopilot/quality.ts");
const research = await import("../lib/autopilot/research.ts");
const plan = await import("../lib/autopilot/plan.ts");

test("the SEO checklist scores a strong post high and names what a weak one misses", () => {
  const body = ["Intro: a detached ADU in Everett costs real money, and here is what it depends on.", ...Array.from({ length: 6 }, (_, i) => `## Section ${i + 1}\n\n${"Honest detail about building in Everett. ".repeat(28)}See [our ADU page](/services/adu) and [contact](/contact).`)].join("\n\n");
  const good = quality.scorePost({ title: "What a Detached ADU Costs in Everett, WA (2026 Guide)", metaDescription: "Realistic 2026 ranges for a detached ADU in Everett, WA, what pushes the price up or down, and three ways to keep your build in budget this year.", bodyMd: body, targetQuery: "detached adu cost everett", area: "Everett, WA", faqCount: 4 }, ["/services/adu", "/contact", "/projects"]);
  assert.ok(good.score >= 90, `expected a high score, got ${good.score}: ${JSON.stringify(good.checks.filter((c) => !c.ok))}`);
  const weak = quality.scorePost({ title: "ADUs", metaDescription: "Short.", bodyMd: "Just a few words with [a dead link](/nope).", targetQuery: "detached adu cost everett", area: "Everett, WA", faqCount: 0 }, ["/services/adu"]);
  assert.ok(weak.score < 30);
  const failed = quality.failedChecks(weak);
  assert.ok(failed.some((f) => f.startsWith("Title is 45–65")) && failed.some((f) => f.includes("not found: /nope")));
});

test("autocomplete research parses Google's answer and builds sensible seeds", () => {
  assert.deepEqual(research.parseSuggest('["adu builder seattle",["adu builder seattle","how much does it cost to build an adu in seattle"],[],{}]'), ["adu builder seattle", "how much does it cost to build an adu in seattle"]);
  assert.deepEqual(research.parseSuggest("not json"), []);
  const seeds = research.seedQueries("ADU builder", "Everett, WA", ["Website", "Local SEO"]);
  assert.ok(seeds.includes("adu builder everett") && seeds.includes("adu cost everett") && seeds.includes("website everett"));
  assert.equal(new Set(seeds).size, seeds.length);
});

test("the content plan queues topics, skips written ones, and can be reordered", () => {
  const p = plan.toPlanItems([{ title: "A", targetQuery: "adu cost everett", angle: "x" }, { title: "B", targetQuery: "adu permit everett", angle: "y" }, { title: "Dup", targetQuery: "ADU cost Everett", angle: "z" }]);
  assert.equal(p.length, 2);
  assert.equal(plan.nextPlanned(p, [{ title: "Old post", targetQuery: "adu cost everett" }])?.title, "B");
  const skipped = plan.setStatus(p, p[1].id, "skipped");
  assert.equal(plan.nextPlanned(skipped, [{ title: "Old post", targetQuery: "adu cost everett" }]), null);
  const moved = plan.moveToFront(p, p[1].id);
  assert.equal(moved[0].title, "B");
  assert.equal(plan.upcoming(moved).length, 2);
});

test("automatic mode publishes at the bar and holds under it; the calendar projects one post per cadence step", () => {
  assert.deepEqual(quality.autoReview("auto", quality.AUTO_PUBLISH_BAR), { publish: true, held: false });
  assert.deepEqual(quality.autoReview("auto", quality.AUTO_PUBLISH_BAR - 1), { publish: false, held: true });
  assert.deepEqual(quality.autoReview("approve", 100), { publish: false, held: false });
  const items = plan.toPlanItems([{ title: "A", targetQuery: "q1", angle: "" }, { title: "B", targetQuery: "q2", angle: "" }, { title: "C", targetQuery: "q3", angle: "" }]);
  const dates = sched.projectSchedule(plan.setStatus(items, items[1].id, "skipped"), "2026-10-17T14:00:00.000Z", "weekly");
  assert.deepEqual(dates.map((s) => s.date), ["2026-10-17T14:00:00.000Z", "2026-10-24T14:00:00.000Z"]);
});
