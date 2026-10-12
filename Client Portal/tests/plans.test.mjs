import { test } from "node:test";
import assert from "node:assert/strict";

const pk = await import("../lib/billing/packages.ts");
const rc = await import("../lib/billing/recommend.ts");

const plan = (over) => ({ id: "x", name: "", tagline: "", priceCents: null, interval: "month", features: [], highlight: false, published: true, sort: 0, role: null, postsPerMonth: null, ...over });
const PLANS = [
  plan({ id: "p", name: "SEO Autopilot", priceCents: 19900, role: "posts", postsPerMonth: 4 }),
  plan({ id: "w", name: "Website care", priceCents: 14900, role: "website" }),
  plan({ id: "s", name: "Social posts", priceCents: 19900, role: "social" }),
  plan({ id: "c", name: "Local SEO", priceCents: null }),
];

test("catalog: per-post rate from the posts row, add-ons from their roles, drafts and unpriced rows ignored", () => {
  const c = pk.catalogFrom([...PLANS, plan({ id: "g", name: "GBP", priceCents: 7900, role: "gbp", published: false })]);
  assert.equal(c.posts.postsPerMonth, 4);
  assert.equal(pk.perPostCents(c), 4975);
  assert.deepEqual(c.addons.map((a) => a.key), ["website", "social"]);
  assert.equal(pk.catalogFrom([plan({ name: "Nope", priceCents: 100 })]), null);
});

test("prices: linear in posts, add-ons flat, never under Square's minimum", () => {
  const c = pk.catalogFrom(PLANS);
  assert.equal(pk.postsPriceCents(c, 1), 4975);
  assert.equal(pk.postsPriceCents(c, 8), 39800);
  assert.equal(pk.packagePriceCents(c, 4, ["website"]), 19900 + 14900);
  const cheap = pk.catalogFrom([plan({ name: "SEO Autopilot", priceCents: 100, role: "posts", postsPerMonth: 4 })]);
  assert.equal(pk.packagePriceCents(cheap, 1, []), pk.MIN_CHARGE_CENTS);
  assert.equal(pk.packagePriceCents(cheap, 8, []), 200);
});

test("packages: drop add-ons the studio doesn't sell and collapse duplicates; names always start with the plan", () => {
  const c = pk.catalogFrom(PLANS); // no gbp
  const pkgs = pk.availablePackages(c);
  assert.deepEqual(pkgs.map((p) => p.addons), [[], ["website"], ["website", "social"]]);
  const only = pk.availablePackages(pk.catalogFrom([PLANS[0]]));
  assert.equal(only.length, 1);
  assert.equal(pk.packageFor(c, ["social", "website"])?.key, "growth");
  assert.equal(pk.packageFor(c, ["social"]), null);
  const chosen = pk.choose(c, 4, ["website", "bogus", "website"]);
  assert.deepEqual(chosen.addons, ["website"]);
  assert.equal(chosen.name, "SEO Autopilot · 4 posts + website");
  assert.equal(chosen.amount, 34800);
  assert.equal(pk.packageName(c, 1, []), "SEO Autopilot · 1 post");
});

test("cadence follows the posts bought, and back", () => {
  for (const n of pk.POSTS_CHOICES) assert.equal(pk.postsFor(pk.cadenceFor(n)), n);
  assert.equal(pk.cadenceFor(4), "weekly");
  assert.equal(pk.isPostsChoice(3), false);
});

test("recommendation: no readable site → weekly + website; big blog → two a month; crowded metro trade with no blog → twice a week", () => {
  const base = { company: "Acme", industry: "roofing", city: "Seattle", website: "https://acme.com" };
  const none = rc.recommendFor({ ...base, site: null });
  assert.equal(none.posts, 4);
  assert.ok(none.addons.includes("website"));
  assert.ok(none.reasons.some((r) => r.includes("couldn't read")));

  const paths = (n, blog) => [...Array(n)].map((_, i) => (i < blog ? `/blog/post-${i}` : `/page-${i}`));
  const big = rc.recommendFor({ ...base, site: { title: "Acme Roofing", description: "", text: "", paths: paths(40, 25) } });
  assert.equal(big.posts, 2);
  assert.ok(!big.addons.includes("website"));
  assert.ok(big.addons.includes("gbp"));

  const crowded = rc.recommendFor({ ...base, site: { title: "Acme Roofing Seattle", description: "", text: "", paths: paths(10, 0) } });
  assert.equal(crowded.posts, 8);
  assert.ok(crowded.reasons.some((r) => r.includes("crowded")));

  const quiet = rc.recommendFor({ company: "B", industry: "accounting", city: "", website: "https://b.com", site: { title: "B", description: "", text: "", paths: paths(12, 2) } });
  assert.equal(quiet.posts, 4);
  assert.deepEqual(quiet.addons, []);
});
