import { test } from "node:test";
import assert from "node:assert/strict";

const ga4 = await import("../lib/integrations/ga4.ts");
const gsc = await import("../lib/integrations/search-console.ts");
const psi = await import("../lib/integrations/pagespeed.ts");
const gbp = await import("../lib/integrations/gbp.ts");
const meta = await import("../lib/integrations/meta.ts");
const auth = await import("../lib/integrations/google-auth.ts");
const quote = await import("../lib/quote.ts");

test("GA4 daily + lead events map to website_daily rows", () => {
  const daily = { rows: [{ dimensionValues: [{ value: "20261005" }], metricValues: [{ value: "48" }, { value: "40" }, { value: "131" }] }] };
  assert.deepEqual(ga4.mapDaily(daily), [{ date: "2026-10-05", sessions: 48, users: 40, pageviews: 131 }]);
  const leads = ga4.mapLeadEvents({ rows: [
    { dimensionValues: [{ value: "20261005" }], metricValues: [{ value: "2" }] },
    { dimensionValues: [{ value: "20261005" }], metricValues: [{ value: "1" }] },
  ] });
  assert.equal(leads.get("2026-10-05"), 3);
  const src = ga4.mapSources({ rows: [
    { dimensionValues: [{ value: "Organic Search" }], metricValues: [{ value: "60" }] },
    { dimensionValues: [{ value: "Direct" }], metricValues: [{ value: "40" }] },
  ] });
  assert.deepEqual(src, [{ name: "Organic Search", sharePct: 60 }, { name: "Direct", sharePct: 40 }]);
});

test("Search Console rows map to seo_daily and keywords with site-relative urls", () => {
  const d = gsc.mapGscDaily({ rows: [{ keys: ["2026-10-01"], clicks: 12, impressions: 400, ctr: 0.03, position: 8.26 }] });
  assert.deepEqual(d, [{ date: "2026-10-01", clicks: 12, impressions: 400, ctr: 3, position: 8.3 }]);
  const k = gsc.mapGscQueries({ rows: [{ keys: ["adu builder everett", "https://example.com/services/adu"], clicks: 5, impressions: 90, ctr: 0.05, position: 2.4 }] }, "https://example.com/");
  assert.equal(k[0].url, "/services/adu");
  const k2 = gsc.mapGscQueries({ rows: [{ keys: ["x", "https://example.com/"], clicks: 1, impressions: 1, ctr: 1, position: 1 }] }, "sc-domain:example.com");
  assert.equal(k2[0].url, "/");
});

test("PageSpeed scores and vitals map", () => {
  const m = psi.mapPsi({
    lighthouseResult: { categories: { performance: { score: 0.94 }, seo: { score: 0.98 }, accessibility: { score: 0.96 }, "best-practices": { score: 1 } },
      audits: { "largest-contentful-paint": { numericValue: 1380.4 }, "cumulative-layout-shift": { numericValue: 0.0123 } } },
    loadingExperience: { metrics: { INTERACTION_TO_NEXT_PAINT: { percentile: 92 } } },
  });
  assert.deepEqual(m, { perf_score: 94, seo_score: 98, a11y_score: 96, bp_score: 100, lcp_ms: 1380, cls: 0.012, inp_ms: 92 });
});

test("GBP metric series sum into views / calls / directions / clicks", () => {
  const series = (name, vals) => ({ dailyMetric: name, timeSeries: { datedValues: vals.map((v) => ({ value: String(v) })) } });
  const r = gbp.mapGbpPerf({ multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [
    series("BUSINESS_IMPRESSIONS_MOBILE_SEARCH", [10, 20]), series("BUSINESS_IMPRESSIONS_DESKTOP_MAPS", [5]), series("CALL_CLICKS", [1, 2, 3]), series("WEBSITE_CLICKS", [7]),
  ] }] });
  assert.deepEqual(r, { views: 35, searches: 30, calls: 6, directions: 0, website_clicks: 7 });
});

test("Instagram helpers classify media and read insights", () => {
  assert.equal(meta.kindOf({ media_product_type: "REELS", media_type: "VIDEO" }), "reel");
  assert.equal(meta.kindOf({ media_type: "CAROUSEL_ALBUM" }), "carousel");
  assert.equal(meta.kindOf({ media_type: "IMAGE" }), "image");
  const reach = meta.mapReachDaily({ data: [{ name: "reach", values: [{ value: 120, end_time: "2026-10-05T07:00:00+0000" }] }] });
  assert.deepEqual(reach, [{ date: "2026-10-05", reach: 120 }]);
  assert.equal(meta.sumMetric({ data: [{ name: "profile_views", total_value: { value: 44 } }] }, "profile_views"), 44);
  assert.equal(meta.mediaMetric({ data: [{ name: "saved", values: [{ value: 9 }] }] }, "saved"), 9);
});

test("service-account JWT has the right header and claims", () => {
  const { generateKeyPairSync } = await_import_crypto();
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const jwt = auth.serviceAccountAssertion({ client_email: "sa@test.iam.gserviceaccount.com", private_key: privateKey }, [auth.SCOPES.analytics], 1_700_000_000);
  const [h, c, s] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { alg: "RS256", typ: "JWT" });
  const claims = JSON.parse(Buffer.from(c, "base64url"));
  assert.equal(claims.iss, "sa@test.iam.gserviceaccount.com");
  assert.equal(claims.exp - claims.iat, 3600);
  assert.ok(s.length > 100);
});

test("quote math applies options, minimums, markup and range", () => {
  const cfg = { projectTypes: [{ id: "deck", name: "Deck", unit: "sqft", baseRate: 68, minPrice: 12000, enabled: true }],
    options: [{ id: "pergola", name: "Pergola", appliesTo: ["deck"], priceType: "per_unit", amount: 42, enabled: true }, { id: "permits", name: "Permits", appliesTo: [], priceType: "percent", amount: 4, enabled: true }],
    markupPct: 10, rangePct: 8, depositPct: 10, disclaimer: "", updatedAt: "" };
  const q = quote.quote(cfg, "deck", 100, ["pergola", "permits"]);
  // base 6800 + 4200 per-unit + 4% of base 272 = 11272 → floor 12000 → ×1.1 = 13200 → ±8% rounded to $500
  assert.equal(q.total, 13200);
  assert.equal(q.low, 12000);
  assert.equal(q.high, 14500);
  assert.equal(q.deposit, 1320);
});

function await_import_crypto() { return process.getBuiltinModule("node:crypto"); }

test("audit on-page checks read a contractor homepage", async () => {
  const audit = await import("../lib/audit.ts");
  const html = `<html><head><title>Northline Builders | ADU builder Everett WA</title>
    <meta name="description" content="ADUs and remodels in Snohomish County"><meta property="og:title" content="x">
    <script type="application/ld+json">{"@type":"LocalBusiness"}</script><script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234"></script>
    </head><body><h1>We build ADUs in Everett</h1><p>${"Quality work in Everett and Snohomish County. ".repeat(60)}</p>
    <a href="tel:4255550142">(425) 555-0142</a><a href="/contact">Get a free estimate</a><p>Rated 4.9 stars from 47 reviews</p><footer>© ${new Date().getFullYear()} Northline</footer></body></html>`;
  const { checks, meta } = audit.htmlChecks(html, "https://northlinebuilders.com/");
  const by = Object.fromEntries(checks.map((c) => [c.id, c.status]));
  assert.equal(by.h1, "pass"); assert.equal(by.phone, "pass"); assert.equal(by.cta, "pass"); assert.equal(by.schema, "pass");
  assert.equal(by.analytics, "pass"); assert.equal(by.reviews, "pass"); assert.equal(by.local, "pass"); assert.equal(by.words, "pass"); assert.equal(by.fresh, "pass");
  assert.equal(meta.h1, "We build ADUs in Everett");
  const bare = audit.htmlChecks("<html><body><p>hello</p><h1>a</h1><h1>b</h1></body></html>", "https://x.com/");
  const b = Object.fromEntries(bare.checks.map((c) => [c.id, c.status]));
  assert.equal(b.h1, "warn"); assert.equal(b.phone, "fail"); assert.equal(b.cta, "fail"); assert.equal(b.analytics, "fail"); assert.equal(b.words, "fail");
  assert.equal(audit.normalizeUrl("northlinebuilders.com"), "https://northlinebuilders.com/");
  assert.equal(audit.normalizeUrl("not a url"), null);
  const sum = audit.summarize(bare.checks, { performance: 40, seo: 60, accessibility: 80, bestPractices: 90 });
  assert.ok(["D", "F"].includes(sum.grade));
  assert.equal(sum.fixFirst[0], "Phone number visible");
});

test("SEO deep-dive infers trade and city, parses search results, and builds issues", async () => {
  const seo = await import("../lib/seo-check.ts");
  const text = "Northline Builders designs and builds ADUs, detached ADUs and garage conversions in Everett, WA and across Snohomish County. Call us in Everett.";
  const inf = seo.inferTradeAndCity("Northline Builders | ADU builder Everett WA", text);
  assert.equal(inf.trade.key, "adu"); assert.equal(inf.city, "Everett"); assert.equal(inf.inferred, false);
  assert.equal(seo.cityWithState("Everett", text), "Everett WA");
  assert.equal(seo.queriesFor("Northline Builders | ADU builder Everett WA", text)[0], "adu builder everett wa");
  const ddg = `<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.competitor.com%2Fadu&amp;rut=1">x</a>
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnorthlinebuilders.com%2F&amp;rut=2">y</a>`;
  const hosts = seo.parseDdgHosts(ddg);
  assert.deepEqual(hosts, ["competitor.com", "northlinebuilders.com"]);
  assert.equal(seo.positionOf(hosts, "www.northlinebuilders.com"), 2);
  assert.equal(seo.positionOf(hosts, "nobody.com"), null);
  const r = seo.buildSeoReport({
    domain: "northlinebuilders.com", html: "<html><body><h1>Hi</h1><img src=a.jpg><img src=b.jpg alt='deck'></body></html>", text, title: "Home", description: null, wordCount: 120,
    rankings: [{ query: "adu builder everett wa", position: null, checked: true }, { query: "adu contractor everett wa", position: 14, checked: true }], sitemapPages: 3, robots: false,
  });
  assert.equal(r.pageOneCount, 0);
  assert.ok(r.score < 50);
  assert.ok(r.issues.some((i) => i.label.startsWith("Not on page one")));
  assert.ok(r.issues.some((i) => i.label === "No meta description"));
  assert.ok(r.issues.some((i) => i.label.startsWith("Page title doesn't say")));
  assert.match(r.verdict, /Invisible on Google/);
});
