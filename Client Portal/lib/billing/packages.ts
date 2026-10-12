import type { Plan, PlanRole } from "@/lib/data/plans";
import type { AutopilotCadence } from "@/lib/data/types";

/**
 * The plan builder's arithmetic. Everything a client can buy is composed from the
 * plan rows the studio publishes: one "posts" row sets the per-post rate (its price
 * divided by the posts it includes) and each add-on row is a flat monthly amount.
 * Packages are named combinations of add-ons at whatever post count is chosen.
 */

/** The Square subscription plan every package is a variation of; also the prefix of every variation name. */
export const PLAN_NAME = "SEO Autopilot";

export const POSTS_CHOICES = [1, 2, 4, 8] as const;
export type PostsChoice = (typeof POSTS_CHOICES)[number];
export type AddonKey = Exclude<PlanRole, "posts">;

export type Catalog = {
  posts: { name: string; priceCents: number; postsPerMonth: number; features: string[]; tagline: string };
  addons: { key: AddonKey; name: string; priceCents: number; tagline: string; features: string[] }[];
};

export type Package = { key: string; name: string; addons: AddonKey[]; pitch: string };

/** The three packages, in the order they're shown. Add-ons a studio hasn't published are dropped. */
export const PACKAGES: Package[] = [
  { key: "autopilot", name: "Autopilot", addons: [], pitch: "The posts, published and checked. For a site that already converts." },
  { key: "website", name: "Autopilot + Website", addons: ["website"], pitch: "The posts plus a site built to turn them into calls." },
  { key: "growth", name: "Growth", addons: ["website", "social", "gbp"], pitch: "Everything: site, posts, social feed and the map pack." },
];

/** Square's smallest card charge. */
export const MIN_CHARGE_CENTS = 100;

const CADENCE_POSTS: { cadence: AutopilotCadence; posts: PostsChoice }[] = [
  { cadence: "monthly", posts: 1 },
  { cadence: "biweekly", posts: 2 },
  { cadence: "weekly", posts: 4 },
  { cadence: "twice_weekly", posts: 8 },
];

export const isPostsChoice = (n: unknown): n is PostsChoice => POSTS_CHOICES.includes(n as PostsChoice);
export const cadenceFor = (posts: PostsChoice): AutopilotCadence => CADENCE_POSTS.find((c) => c.posts === posts)!.cadence;
export const postsFor = (cadence: AutopilotCadence): PostsChoice => CADENCE_POSTS.find((c) => c.cadence === cadence)?.posts ?? 4;

/** The builder's inputs from the published plan rows; null until a "posts" row with a price exists. */
export function catalogFrom(plans: Plan[]): Catalog | null {
  const posts = plans.find((p) => p.role === "posts" && p.published && p.priceCents !== null && p.priceCents > 0);
  if (!posts) return null;
  const addons = plans
    .filter((p) => p.role && p.role !== "posts" && p.published && p.priceCents !== null && p.priceCents > 0)
    .map((p) => ({ key: p.role as AddonKey, name: p.name, priceCents: p.priceCents as number, tagline: p.tagline, features: p.features }));
  return {
    posts: { name: posts.name, priceCents: posts.priceCents as number, postsPerMonth: posts.postsPerMonth ?? 4, features: posts.features, tagline: posts.tagline },
    addons: addons.filter((a, i) => addons.findIndex((b) => b.key === a.key) === i),
  };
}

export const perPostCents = (c: Catalog) => c.posts.priceCents / c.posts.postsPerMonth;

/** Monthly price of N posts: linear in the per-post rate, rounded to the cent. */
export const postsPriceCents = (c: Catalog, posts: PostsChoice) => Math.round(perPostCents(c) * posts);

export const addonPriceCents = (c: Catalog, key: AddonKey) => c.addons.find((a) => a.key === key)?.priceCents ?? 0;

/** The whole package, never below what Square will charge. */
export function packagePriceCents(c: Catalog, posts: PostsChoice, addons: AddonKey[]): number {
  const sum = postsPriceCents(c, posts) + addons.reduce((n, k) => n + addonPriceCents(c, k), 0);
  return Math.max(MIN_CHARGE_CENTS, sum);
}

/** Only the add-ons this catalog actually sells, in catalog order, de-duplicated. */
export function normalizeAddons(c: Catalog, addons: unknown): AddonKey[] {
  const wanted = new Set(Array.isArray(addons) ? addons.map(String) : []);
  return c.addons.filter((a) => wanted.has(a.key)).map((a) => a.key);
}

/** The package whose add-ons match exactly, if any. */
export const packageFor = (c: Catalog, addons: AddonKey[]): Package | null =>
  availablePackages(c).find((p) => p.addons.length === addons.length && p.addons.every((k) => addons.includes(k))) ?? null;

/** PACKAGES with add-ons the studio doesn't sell removed; packages that collapse into an earlier one are dropped. */
export function availablePackages(c: Catalog): Package[] {
  const sold = new Set(c.addons.map((a) => a.key));
  const out: Package[] = [];
  for (const p of PACKAGES) {
    const addons = p.addons.filter((k) => sold.has(k));
    if (out.some((o) => o.addons.length === addons.length && o.addons.every((k) => addons.includes(k)))) continue;
    out.push({ ...p, addons });
  }
  return out;
}

/** Human name, also the Square plan-variation label: "SEO Autopilot · 4 posts + website". Always starts with PLAN_NAME so the subscription can be found again. */
export function packageName(c: Catalog, posts: PostsChoice, addons: AddonKey[]): string {
  const extras = addons.map((k) => c.addons.find((a) => a.key === k)?.name.toLowerCase().replace(/ care$| posts$/, "") ?? k);
  return `${PLAN_NAME} · ${posts} post${posts === 1 ? "" : "s"}${extras.length ? ` + ${extras.join(" + ")}` : ""}`;
}

export type Chosen = { posts: PostsChoice; addons: AddonKey[]; amount: number; name: string };

/** Everything the checkout and the subscription record need for one choice. */
export function choose(c: Catalog, posts: PostsChoice, addons: AddonKey[]): Chosen {
  const clean = normalizeAddons(c, addons);
  return { posts, addons: clean, amount: packagePriceCents(c, posts, clean), name: packageName(c, posts, clean) };
}
