import type { AuditReport } from "@/lib/audit";

export type Client = {
  id: string;
  slug: string;
  name: string;
  industry: string;
  city: string;
  websiteUrl: string;
  launchedAt: string | null;
  services: string[];
  accountManager: { name: string; email: string };
  /** Square customer for billing; null until the studio links one. */
  billingCustomerId: string | null;
};

export type DayPoint = { date: string; value: number };
export type SeoDay = { date: string; clicks: number; impressions: number; ctr: number; position: number };

export type Website = {
  status: "live" | "building" | "maintenance";
  uptimePct: number;
  lastCheckedAt: string;
  scores: { performance: number; seo: number; accessibility: number; bestPractices: number };
  vitals: { lcpMs: number; cls: number; inpMs: number };
  last30: { sessions: number; users: number; pageviews: number; formSubmissions: number; calls: number };
  prev30: { sessions: number; users: number; pageviews: number; formSubmissions: number; calls: number };
  sessionsDaily: DayPoint[];
  sources: { name: string; sharePct: number }[];
  topPages: { path: string; views: number; conversions: number }[];
  recentLeads: { at: string; type: "form" | "call"; detail: string }[];
  health: AuditReport | null;
  healthAt: string | null;
  responseMs: number | null;
  checks: { at: string; ok: boolean; ms: number }[];
};

export type Keyword = {
  keyword: string;
  position: number;
  prevPosition: number | null;
  clicks: number;
  impressions: number;
  url: string;
};

export type Seo = {
  daily: SeoDay[];
  totals90: { clicks: number; impressions: number; ctr: number; position: number };
  prev90: { clicks: number; impressions: number; ctr: number; position: number };
  keywords: Keyword[];
  gbp: {
    views: number; searches: number; calls: number; directions: number; websiteClicks: number;
    reviews: number; rating: number; newReviews30: number;
    prev: { views: number; calls: number; directions: number; websiteClicks: number };
  };
  workLog: { at: string; title: string; detail: string }[];
};

export type SocialAccount = {
  platform: "instagram" | "facebook";
  handle: string;
  url: string;
  followers: number;
  followersDelta30: number;
  reach30: number;
  profileVisits30: number;
  posts30: number;
  engagementRatePct: number;
};

export type SocialPost = {
  id: string;
  platform: "instagram" | "facebook";
  kind: "reel" | "carousel" | "image" | "story";
  caption: string;
  at: string;
  status: "published" | "scheduled";
  likes: number;
  comments: number;
  saves: number;
  reach: number;
  tone: string; // placeholder gradient while media urls are wired
  permalink?: string;
};

export type Social = {
  accounts: SocialAccount[];
  reachDaily: DayPoint[];
  posts: SocialPost[];
};

export type Unit = "sqft" | "lf" | "each";

export type ProjectType = {
  id: string;
  name: string;
  unit: Unit;
  baseRate: number;      // $ per unit
  minPrice: number;      // floor for the quote
  enabled: boolean;
};

export type PriceOption = {
  id: string;
  name: string;
  appliesTo: string[];   // project type ids, empty = all
  priceType: "flat" | "per_unit" | "percent";
  amount: number;
  enabled: boolean;
};

export type PricingConfig = {
  projectTypes: ProjectType[];
  options: PriceOption[];
  markupPct: number;     // added on top of base + options
  rangePct: number;      // quote shown as a band, +/- this
  depositPct: number;
  disclaimer: string;
  updatedAt: string;
};

export type GenerationStatus = "new" | "contacted" | "quoted" | "won" | "lost";

export type Generation = {
  id: string;
  at: string;
  projectTypeId: string;
  projectType: string;
  size: number;
  unit: Unit;
  options: string[];     // option names chosen
  quoteLow: number;
  quoteHigh: number;
  contact: { name: string; email: string; phone: string; address?: string } | null;
  status: GenerationStatus;
  sourcePage: string;
  notes?: string;
};

export type Estimator = {
  embedded: boolean;
  embedPath: string;
  stats30: { sessions: number; generated: number; quotesSent: number; leads: number };
  prev30: { sessions: number; generated: number; quotesSent: number; leads: number };
  pricing: PricingConfig;
  generations: Generation[];
};

export type Request = {
  id: string;
  type: "website" | "seo" | "social" | "estimator" | "billing" | "other";
  title: string;
  body: string;
  status: "open" | "in_progress" | "done";
  createdAt: string;
  reply?: string;
};

export type Activity = { at: string; area: "website" | "seo" | "social" | "estimator" | "account"; title: string };

export type SourceKey = "site" | "ga4" | "gsc" | "gbp" | "meta";

export type PortalStatus = {
  connected: Record<SourceKey, boolean>;
  has: { traffic: boolean; seo: boolean; gbp: boolean; social: boolean; scores: boolean; health: boolean };
  lastSyncAt: string | null;
};

export type PortalData = {
  status: PortalStatus;
  client: Client;
  website: Website;
  seo: Seo;
  social: Social;
  estimator: Estimator;
  requests: Request[];
  activity: Activity[];
  generatedAt: string;
  isDemo: boolean;
};

// SEO Autopilot -------------------------------------------------------------
export type AutopilotCadence = "twice_weekly" | "weekly" | "biweekly" | "monthly";
export type AutopilotMode = "auto" | "approve";
export type AutopilotTarget = "hosted" | "wordpress" | "manual";

export type AutopilotSettings = {
  enabled: boolean;
  cadence: AutopilotCadence;
  mode: AutopilotMode;
  target: AutopilotTarget;
  /** The client's WordPress login was verified and stored (never shown back). */
  wpConnected: boolean;
  notes: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  plan: PlanItem[];
};

export type SeoPostStatus = "awaiting_approval" | "approved" | "ready" | "published" | "skipped" | "failed";

/** One line of the SEO checklist every post is scored against (lib/autopilot/quality.ts). */
export type QualityCheck = { id: string; label: string; ok: boolean; detail: string };
export type PostQuality = { score: number; checks: QualityCheck[] };
/** Search Console numbers for the post's URL, once GSC is connected and has data. */
export type PostPerformance = { clicks: number; impressions: number; position: number | null; keywords: number };

export type SeoPost = {
  id: string;
  createdAt: string;
  title: string;
  slug: string;
  targetQuery: string;
  /** One sentence from the writer on why this search, for the owner. */
  rationale: string;
  metaDescription: string;
  excerpt: string;
  bodyMd: string;
  wordCount: number;
  status: SeoPostStatus;
  publishedUrl: string | null;
  publishedAt: string | null;
  error: string | null;
  quality: PostQuality | null;
  performance: PostPerformance | null;
};

export type AutopilotFix = { title: string; where: string; why: string; how: string; impact: "high" | "medium" | "low"; done?: boolean };

/** A post in the content plan queue. */
export type PlanItem = { id: string; title: string; targetQuery: string; angle: string; status: "planned" | "written" | "skipped" };

export type AutopilotRun = { id: string; ranAt: string; ok: boolean; summary: string; postId: string | null; fixes: AutopilotFix[] };

export type Autopilot = { settings: AutopilotSettings; posts: SeoPost[]; runs: AutopilotRun[] };

/** One row on Studio · SEO Autopilot. */
export type StudioAutopilotRow = {
  slug: string;
  name: string;
  website: string;
  settings: AutopilotSettings;
  /** Whether posts can actually go out on their own, and why not when they can't. */
  publishing: { ready: boolean; note: string };
  awaiting: number;
  published: number;
  upcoming: number;
  fixesDone: number;
  fixesTotal: number;
  lastRun: { at: string; ok: boolean; summary: string } | null;
};
