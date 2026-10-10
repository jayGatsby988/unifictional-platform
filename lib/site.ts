import {
  LayoutTemplate,
  Search,
  MapPin,
  Share2,
  Film,
  Magnet,
  CalendarCheck,
  Bot,
  BarChart3,
  type LucideIcon,
} from "lucide-react";

/** Central, editable site configuration + content (no pricing anywhere). */

export const siteConfig = {
  name: "Unifictional",
  wordmark: "Unifictional",
  /** Small line used under the wordmark / in the hero. */
  discipline: "Growth platform for contractors & remodelers",
  description:
    "Unifictional is the growth platform for contractors: a premium website with a 3D instant-quote tool built in, local search and social run by the studio, and one portal that shows every lead, ranking, post, and quote.",
  url: "https://unifictional.com",
  /** Calendly scheduling link for the /contact embed (set via env once connected). */
  calendlyUrl: process.env.NEXT_PUBLIC_CALENDLY_URL || "",
  /** Inbox shown as a fallback if the scheduler isn't wired up yet. */
  bookingEmail: "Unifictional@gmail.com",
  /**
   * Target keywords, ordered by researched demand (Google Autocomplete,
   * Aug 2026). These map to real pages — head terms to /services/* and
   * /industries/*, question terms to /guides/*. Don't add a keyword here
   * that no page is actually built to answer.
   */
  keywords: [
    "contractor website design",
    "instant quote tool for contractors",
    "contractor client portal",
    "website design for construction companies",
    "contractor marketing agency",
    "construction marketing agency",
    "SEO for contractors",
    "SEO for construction companies",
    "social media marketing for contractors",
    "social media marketing for construction companies",
    "digital marketing for construction companies",
    "lead generation for contractors",
    "Google Business Profile optimization",
    "local SEO for home services",
    "web design for contractors",
    "remodeling marketing",
    "custom home builder marketing",
  ],
} as const;

/** Booking: external URL when set, otherwise route to the on-site form. */
export const BOOKING_URL = (process.env.NEXT_PUBLIC_BOOKING_URL ?? "").trim();
export const CONTACT_PATH = "/contact";

/**
 * Where every "Preview the portal" button goes. Set NEXT_PUBLIC_PORTAL_URL in
 * Vercel to the client-portal UI once it ships; until then it falls back to the
 * public demo (demo mode, no login).
 */
export const PORTAL_PREVIEW_URL =
  (process.env.NEXT_PUBLIC_PORTAL_URL ?? "").trim() ||
  "https://unifictional-client-portal.vercel.app";

export type NavLink = { label: string; href: string };

// Six items is the ceiling before the desktop bar gets cramped — /faq stays
// reachable from the footer, the contact page, and every guide.
export const navLinks: NavLink[] = [
  { label: "Platform", href: "/#platform" },
  { label: "Services", href: "/services" },
  { label: "Work", href: "/work" },
  { label: "Guides", href: "/guides" },
  { label: "Process", href: "/process" },
  { label: "Studio", href: "/about" },
];

// The footer is the site's main internal-linking surface: it's what pushes
// crawl equity down into the guide and industry pages from every URL.
export const footerNav: { heading: string; links: NavLink[] }[] = [
  {
    heading: "Services",
    links: [
      { label: "Contractor websites", href: "/services/website-design" },
      { label: "SEO for contractors", href: "/services/seo" },
      { label: "Google Business Profile", href: "/services/google-business-profile" },
      { label: "Social media marketing", href: "/services/social-media" },
      { label: "Lead systems", href: "/services/lead-capture" },
      { label: "All services", href: "/services" },
    ],
  },
  {
    heading: "Industries",
    links: [
      { label: "Roofing marketing", href: "/industries/roofing-marketing" },
      { label: "Remodeler marketing", href: "/industries/remodeler-marketing" },
      { label: "Home builder marketing", href: "/industries/home-builder-marketing" },
      { label: "General contractors", href: "/industries/general-contractor-marketing" },
      { label: "All industries", href: "/industries" },
    ],
  },
  {
    heading: "Guides",
    links: [
      { label: "Contractor website examples", href: "/guides/contractor-website-examples" },
      { label: "What a website costs", href: "/guides/contractor-website-cost" },
      { label: "What SEO costs", href: "/guides/seo-cost-for-contractors" },
      { label: "Getting more leads", href: "/guides/how-to-get-more-leads-as-a-contractor" },
      { label: "All guides", href: "/guides" },
    ],
  },
  {
    heading: "Studio",
    links: [
      { label: "Preview the portal", href: PORTAL_PREVIEW_URL },
      { label: "Selected work", href: "/work" },
      { label: "Process", href: "/process" },
      { label: "About", href: "/about" },
      { label: "Questions", href: "/faq" },
      { label: "Book a call", href: "/contact" },
    ],
  },
];

/** The four parts of the platform, in the order the homepage introduces them. */
export type PlatformPart = {
  index: string;
  title: string;
  tagline: string;
  body: string;
  href: string;
  /** Opens in a new tab (the portal preview). */
  external?: boolean;
};

export const platformParts: PlatformPart[] = [
  {
    index: "01",
    title: "Instant 3D Quotes",
    tagline: "Homeowners price the job on your site.",
    body: "They pick the project, size it in 3D, and get a real price range built from your rates. You get a lead that already knows the number.",
    href: "/#quote-tool",
  },
  {
    index: "02",
    title: "The Website",
    tagline: "The credible first impression, with the quote tool built in.",
    body: "A fast, premium site that makes a serious buyer feel safe choosing you — and gives them something to do besides fill in a form.",
    href: "/services/website-design",
  },
  {
    index: "03",
    title: "The Portal",
    tagline: "Every lead, ranking, post, and quote in one place.",
    body: "No monthly PDF. Log in any day and see what your website, search, social, and quote tool did — and set your own pricing.",
    href: PORTAL_PREVIEW_URL,
    external: true,
  },
  {
    index: "04",
    title: "The Studio",
    tagline: "The search, content, and lead systems — run for you.",
    body: "Local SEO, Google Business Profile, social, short-form video, booking, and AI lead handling, all wired to the same site and reported in plain English.",
    href: "/services",
  },
];

/** How the instant-quote tool works, from the homeowner's side. */
export const quoteSteps: { index: string; title: string; body: string }[] = [
  {
    index: "01",
    title: "Pick the project",
    body: "Deck, ADU, kitchen, roof, basement — whatever you build, with the add-ons you actually offer.",
  },
  {
    index: "02",
    title: "Size it in 3D",
    body: "They shape it on screen. Square footage and options update the number as they go.",
  },
  {
    index: "03",
    title: "Get a range, leave details",
    body: "A real price range, your deposit terms, and a button to book the site visit. The lead lands in your portal.",
  },
];

export type ServiceItem = {
  icon: LucideIcon;
  slug: string;
  /** Display index, e.g. "01". */
  index: string;
  /** Short label used in nav, lists, and the card grid. */
  title: string;
  /**
   * The page's H1. Longer and more literal than `title` because it has to
   * carry the phrase people actually search — "Website Design & Build" is a
   * good card label and a useless heading for search.
   */
  heading: string;
  /** <title> tag. The " — Unifictional" suffix is appended by the template. */
  metaTitle: string;
  /** Meta description — written to be clicked, not just to describe. */
  metaDescription: string;
  /** Primary query this page is built to win. */
  targetKeyword: string;
  secondaryKeywords: string[];
  tagline: string;
  description: string;
  details: string[];
  outcome: string;
  /** Rendered on the page and mirrored into FAQPage schema. */
  faqs: { q: string; a: string }[];
};

export const services: ServiceItem[] = [
  {
    icon: LayoutTemplate,
    slug: "website-design",
    index: "01",
    title: "Website Design & Build",
    heading: "Contractor Website Design & Development",
    metaTitle: "Contractor Website Design & Development",
    metaDescription:
      "Custom contractor website design for builders, remodelers, and construction companies. Fast, mobile-first sites structured to rank locally and turn visitors into estimate requests.",
    targetKeyword: "contractor website design",
    secondaryKeywords: [
      "website design for construction companies",
      "web design for contractors",
      "construction website design",
      "custom website design",
    ],
    tagline: "The credible first impression that does the selling for you.",
    description:
      "Fast, premium websites built to make your company look credible and convert visitors into calls.",
    details: [
      "Custom design tailored to your trade — no cookie-cutter templates.",
      "Built mobile-first and tuned to load fast on real phones in the field.",
      "Clear service pages, project galleries, and obvious next steps on every screen.",
      "Click-to-call, quote requests, and booking wired in from day one.",
      "Structured so you can be found, trusted, and contacted without friction.",
    ],
    outcome:
      "A site that makes a high-value job feel safe to hand you — before you ever pick up the phone.",
    faqs: [
      {
        q: "How long does a contractor website take to build?",
        a: "Most premium contractor sites launch in a matter of weeks rather than months. The timeline depends far more on how quickly we get your project photography and approvals than on the build itself — we'll give you a realistic date on your call.",
      },
      {
        q: "Do you write the copy, or do I have to?",
        a: "We write it. Supplying finished text for every page is the single most common reason contractor website projects stall for months, so we don't put that on you. We'll interview you about how you actually talk about the work, then write it.",
      },
      {
        q: "Will I own the website?",
        a: "Yes. The domain, the site, and every connected account stay in your name. We'd rather keep clients because the work is good than because leaving is painful.",
      },
      {
        q: "Do you build on WordPress, Webflow, or something else?",
        a: "We pick the platform to fit the job rather than defaulting to one. What stays constant is that the site loads fast on a phone, you can update your own projects and content, and it's structured so search engines can actually rank it.",
      },
    ],
  },
  {
    icon: Search,
    slug: "seo",
    index: "02",
    title: "Search Visibility",
    heading: "SEO for Contractors & Construction Companies",
    metaTitle: "SEO for Contractors & Construction Companies",
    metaDescription:
      "SEO for contractors and construction companies — local keyword research, service and city pages, technical clean-up, and reporting measured in calls and estimate requests, not impressions.",
    targetKeyword: "SEO for contractors",
    secondaryKeywords: [
      "SEO for construction companies",
      "local SEO for home services",
      "contractor SEO services",
      "SEO for home service contractors",
    ],
    tagline: "Show up when your next customer is already searching.",
    description:
      "Show up when local customers search for your services — and give them a reason to choose you.",
    details: [
      "Local keyword and service-area research around the jobs you actually want.",
      "On-page structure, titles, and content built for how people search for trades.",
      "Service-area and city pages that help you rank beyond your home town.",
      "Technical clean-up: speed, mobile, indexing, and crawl health.",
      "Ongoing refinement based on what's earning calls.",
    ],
    outcome: "Steady, compounding visibility for the searches that turn into booked work.",
    faqs: [
      {
        q: "How long does SEO take to work for a contractor?",
        a: "Technical and profile fixes can move map-pack visibility in 4–8 weeks. New service and city pages typically take 3–6 months to rank. Competitive head terms often take 9–12 months. Anyone promising page one in 30 days is targeting keywords nobody searches.",
      },
      {
        q: "How much does SEO cost for contractors?",
        a: "Across the industry, local SEO runs roughly $500–$1,500 a month for a single-location contractor and $1,500–$5,000 in competitive markets. We scope to your service area and goals rather than selling a package — our full breakdown of market pricing is in the SEO cost guide.",
      },
      {
        q: "Can you help me rank in more than one city?",
        a: "Yes, and it's usually where the biggest gains are. It requires a genuine page per service area — local projects, local specifics, a local estimate path. Thin duplicate city pages haven't worked for years and can hurt you.",
      },
      {
        q: "What do you actually report on?",
        a: "Calls and estimate requests first, then the rankings and traffic behind them. If a report opens with impressions, you're being sold activity rather than outcomes.",
      },
    ],
  },
  {
    icon: MapPin,
    slug: "google-business-profile",
    index: "03",
    title: "Google Business Profile",
    heading: "Google Business Profile Optimization for Contractors",
    metaTitle: "Google Business Profile Optimization",
    metaDescription:
      "Google Business Profile optimization for contractors — categories, service areas, photos, posts, and a review system built to win the local map pack and the calls that come with it.",
    targetKeyword: "Google Business Profile optimization",
    secondaryKeywords: [
      "Google Business Profile for contractors",
      "google my business optimization",
      "local map pack ranking",
      "how to optimize google business page",
    ],
    tagline: "Win the map pack in your service area.",
    description:
      "Optimized maps presence with the reviews, photos, and details that win the click in your area.",
    details: [
      "Full profile optimization — categories, services, areas, and hours.",
      "A simple system for collecting and responding to reviews.",
      "Photo and post strategy that keeps your listing looking active.",
      "Consistent name, address, and phone across the web.",
      "Tracking so you can see calls and direction requests from Maps.",
    ],
    outcome: "The trusted, review-backed result locals tap before they tap anyone else.",
    faqs: [
      {
        q: "How long does it take to rank in the Google map pack?",
        a: "For a new profile in a moderately competitive area, expect 1–3 months of consistent work — completing the profile, adding photos steadily, and growing reviews. Distance from the searcher will always cap how far out you can rank, no matter what's optimised.",
      },
      {
        q: "Should contractors hide their address on Google?",
        a: "If you work at customer locations rather than serving customers at yours, yes — set it up as a service-area business and hide the address. Running from a home address without hiding it is a common cause of suspension.",
      },
      {
        q: "Do you write fake reviews?",
        a: "No. Buying or incentivising reviews risks the entire listing, and the pattern is detectable. We build a system that makes asking every satisfied customer a routine step in closing out a job.",
      },
      {
        q: "Can you get a suspended profile reinstated?",
        a: "Sometimes, but it's slow and not guaranteed — which is exactly why we won't do anything that puts the listing at risk for a short-term ranking bump.",
      },
    ],
  },
  {
    icon: Share2,
    slug: "social-media",
    index: "04",
    title: "Social & Content",
    heading: "Social Media Marketing for Contractors",
    metaTitle: "Social Media Marketing for Contractors",
    metaDescription:
      "Social media marketing for contractors and construction companies — a consistent, professional feed built from your real projects, so the homeowner checking you out decides to call.",
    targetKeyword: "social media marketing for contractors",
    secondaryKeywords: [
      "social media marketing for construction companies",
      "social media management services",
      "construction social media agency",
      "social media for construction companies",
    ],
    tagline: "Look active, look professional, stay top of mind.",
    description:
      "A consistent, professional feed that makes your business look active and easy to trust.",
    details: [
      "A branded, consistent feed across the platforms that matter for you.",
      "Content built from your real projects — before/afters, process, finished work.",
      "A simple monthly plan so posting never falls to the bottom of your list.",
      "Captions and hashtags written for local reach, not vanity.",
      "Profiles set up to send people straight to booking.",
    ],
    outcome: "A presence that reassures the person checking you out before they call.",
    faqs: [
      {
        q: "Does social media actually generate leads for contractors?",
        a: "Directly and coldly, rarely — and anyone promising otherwise is overselling. What it reliably does is raise your close rate on referrals, because most people look you up before they call. Visual trades like remodeling and pools see more direct inquiries than excavation or framing.",
      },
      {
        q: "Which platforms should a contractor be on?",
        a: "Instagram and Facebook for residential work, LinkedIn if you're chasing commercial or developer jobs. Two platforms done consistently beats six abandoned ones — and we'd rather run two properly.",
      },
      {
        q: "Do I have to take the photos?",
        a: "You take them — nobody else is on your job sites daily. We make it easy: a short list of what to shoot, and we handle the editing, captions, scheduling, and consistency from there.",
      },
      {
        q: "How often will you post?",
        a: "Two to three times a week is the sweet spot for a contractor. Consistency matters far more than frequency — a steady year of twice-weekly posts builds a profile that closes referrals.",
      },
    ],
  },
  {
    icon: Film,
    slug: "short-form-video",
    index: "05",
    title: "Short-Form Video",
    heading: "Short-Form Video for Contractors",
    metaTitle: "Short-Form Video for Contractors",
    metaDescription:
      "Short-form video for contractors and construction companies — Reels, Shorts, and TikToks edited from your real job sites, built to prove quality and keep you top of mind.",
    targetKeyword: "short-form video for contractors",
    secondaryKeywords: [
      "construction video marketing",
      "contractor reels",
      "before and after construction content",
      "short form video agency",
    ],
    tagline: "Scroll-stopping proof of the quality you deliver.",
    description:
      "Scroll-stopping branded clips of your work that build authority and keep you top of mind.",
    details: [
      "Direction on what to film on-site — we make it easy.",
      "Editing into clean, branded Reels, Shorts, and TikToks.",
      "Hooks and captions designed to hold attention and build authority.",
      "A repeatable format so content keeps coming without the overwhelm.",
      "Clips you can reuse on your site, ads, and profiles.",
    ],
    outcome: "Real work, shown well — the modern version of word of mouth.",
    faqs: [
      {
        q: "Do I need a videographer on site?",
        a: "No. Phone footage shot by your crew is genuinely enough, and it looks more authentic than a production crew anyway. We tell you exactly what to capture and handle everything after that.",
      },
      {
        q: "What kind of clips work best for contractors?",
        a: "Before-and-after reveals, in-progress work, and short honest explainers about problems you solved — rot behind a wall, a foundation surprise. That last category performs unusually well precisely because it isn't polished.",
      },
      {
        q: "Can I use the videos anywhere else?",
        a: "Yes, and you should. Every clip is yours to reuse on your website, in ads, in proposals, and across any platform you're on.",
      },
    ],
  },
  {
    icon: Magnet,
    slug: "lead-capture",
    index: "06",
    title: "Lead Systems",
    heading: "Lead Generation Systems for Contractors",
    metaTitle: "Lead Generation Systems for Contractors",
    metaDescription:
      "Lead generation systems for contractors — quote forms that get filled out, instant notifications, call tracking, and automated follow-up so no inquiry goes cold.",
    targetKeyword: "lead generation for contractors",
    secondaryKeywords: [
      "lead generation for construction companies",
      "contractor lead generation",
      "construction lead capture",
      "contractor CRM",
    ],
    tagline: "Turn traffic into real, contactable leads.",
    description:
      "Smart forms and quote requests that turn website traffic into real, contactable leads.",
    details: [
      "Quote and estimate request forms designed to actually get filled out.",
      "Instant notifications so you can respond while the lead is still warm.",
      "Call tracking to see which efforts are driving the phone to ring.",
      "Automated follow-ups so no inquiry slips through the cracks.",
      "Every lead organized in one place instead of scattered across your phone.",
    ],
    outcome: "Fewer missed inquiries — and a clear picture of where work comes from.",
    faqs: [
      {
        q: "Do you sell contractor leads?",
        a: "No. Purchased leads are typically sold to several contractors at once, which means you're competing on price from the first phone call. We build systems that generate leads only you get.",
      },
      {
        q: "What's the fastest thing I can fix?",
        a: "Response time and missed calls, almost always. For most contractors, fixing those two produces more additional revenue in 90 days than any new marketing channel — and the only cost is setting up the system.",
      },
      {
        q: "Will this work with the CRM I already use?",
        a: "Usually. We'd rather connect what you're already running than migrate you onto something new for its own sake. If what you have is genuinely holding you back, we'll say so.",
      },
    ],
  },
  {
    icon: CalendarCheck,
    slug: "booking-system",
    index: "07",
    title: "Booking Setup",
    heading: "Online Booking & Estimate Scheduling",
    metaTitle: "Online Booking for Contractors & Estimates",
    metaDescription:
      "Online booking setup for contractors — let customers schedule calls, estimates, and site visits in a couple of taps, with reminders that cut no-shows and sync to your calendar.",
    targetKeyword: "online booking for contractors",
    secondaryKeywords: [
      "contractor scheduling software setup",
      "estimate booking system",
      "appointment booking for construction",
    ],
    tagline: "Let customers book in a couple of taps.",
    description:
      "Let customers book a call or estimate in a couple taps — fewer missed jobs, less phone tag.",
    details: [
      "An online calendar for calls, estimates, and site visits.",
      "Automatic reminders that cut down on no-shows.",
      "Booking buttons placed everywhere a customer is ready to act.",
      "Synced to your calendar so you're never double-booked.",
      "Set up to fit how your crew actually schedules the week.",
    ],
    outcome: "Less phone tag, fewer missed jobs, a calendar that fills itself.",
    faqs: [
      {
        q: "Will customers actually book online instead of calling?",
        a: "Many will, particularly younger homeowners and anyone contacting you outside business hours. It doesn't replace the phone — it catches the people who would otherwise have moved on rather than waited for you to open.",
      },
      {
        q: "Does it sync with my existing calendar?",
        a: "Yes. Bookings land in the calendar you already use so you can't be double-booked, and reminders go out automatically before the appointment.",
      },
      {
        q: "Can I control which times are bookable?",
        a: "Entirely. We set it up around how your crew actually schedules the week — buffer time between site visits, blackout days, travel allowances between service areas.",
      },
    ],
  },
  {
    icon: Bot,
    slug: "ai-receptionist",
    index: "08",
    title: "AI Lead Handling",
    heading: "AI Receptionist & Missed Call Text Back",
    metaTitle: "AI Receptionist & Missed Call Text Back",
    metaDescription:
      "AI lead handling for contractors — missed call text back and an AI receptionist that answers questions, qualifies jobs, and captures details 24/7 so no lead goes cold.",
    targetKeyword: "AI receptionist for contractors",
    secondaryKeywords: [
      "missed call text back",
      "AI answering service for contractors",
      "contractor lead follow up automation",
      "24/7 lead response",
    ],
    tagline: "Answer every lead 24/7 — even when you're on a ladder.",
    description:
      "Instant replies that answer questions and capture details 24/7, so no lead goes cold.",
    details: [
      "Instant replies to website chats and missed-call texts, day or night.",
      "Answers common questions and qualifies the lead for you.",
      "Captures name, number, and job details so you can follow up fast.",
      "Hands off to you the moment a real conversation is ready.",
      "Tuned to sound like your business — not a robot.",
    ],
    outcome: "No lead goes cold because you were busy doing the actual work.",
    faqs: [
      {
        q: "How does missed call text back work?",
        a: "When you don't answer, an automatic text goes to that number within seconds — an apology, a reason, and a question. They reply by text, which most people prefer to voicemail, and you answer when you can safely stop working.",
      },
      {
        q: "Will customers know they're talking to an AI?",
        a: "We don't pretend otherwise, and we tune it to sound like your business rather than a call centre script. It handles common questions and captures details, then hands over to you the moment there's a real conversation to have.",
      },
      {
        q: "Is automated business texting legal?",
        a: "In the US, replying by text to someone who just called you is generally permitted since they initiated contact. Your number does need registering for A2P 10DLC, the message must identify your business, and STOP has to work — all of which we handle in setup.",
      },
      {
        q: "Do I need this if I already answer most calls?",
        a: "Probably not urgently. It's most valuable for solo operators and small crews with nobody in an office. Check your phone log for last month's missed calls first — the number is usually higher than people expect.",
      },
    ],
  },
  {
    icon: BarChart3,
    slug: "analytics",
    index: "09",
    title: "Reporting",
    heading: "Marketing Reporting & Call Tracking",
    metaTitle: "Contractor Marketing Reporting & Call Tracking",
    metaDescription:
      "Plain-English marketing reporting for contractors — calls, leads, and traffic by source, so you know which services and pages are actually earning work.",
    targetKeyword: "contractor marketing reporting",
    secondaryKeywords: [
      "call tracking for contractors",
      "construction marketing analytics",
      "marketing ROI for contractors",
    ],
    tagline: "Always know what's actually working.",
    description:
      "Clear reporting on calls, leads, and traffic so you always know what's working.",
    details: [
      "A simple dashboard for calls, leads, and traffic — no spreadsheets.",
      "Plain-English reporting, not a wall of confusing metrics.",
      "See which services and pages are driving real inquiries.",
      "Honest read on what's worth doing more of (and less of).",
      "Regular check-ins so the system keeps improving.",
    ],
    outcome: "Decisions backed by what's earning calls — not guesswork.",
    faqs: [
      {
        q: "What numbers actually matter for a contractor?",
        a: "Four: leads by source, cost per lead by channel, close rate from lead to signed job, and average job value. Those four turn every marketing decision into a calculation instead of a guess. Everything else is secondary until they're solid.",
      },
      {
        q: "Do I get access to my own analytics accounts?",
        a: "Always, as owner. Your Analytics, Search Console, Google Business Profile, and ad accounts are yours — we're never the only ones holding the keys.",
      },
      {
        q: "How often do you report?",
        a: "Monthly, in plain English, leading with calls and estimate requests rather than impressions. Plus a check-in to decide what to do more of and what to stop.",
      },
    ],
  },
];

export function getService(slug: string): ServiceItem | undefined {
  return services.find((s) => s.slug === slug);
}

export type ProcessStep = {
  index: string;
  title: string;
  description: string;
  detail: string;
};

export const processSteps: ProcessStep[] = [
  {
    index: "01",
    title: "The Conversation",
    description: "We learn what you build, where, and the jobs you want more of.",
    detail:
      "A relaxed, no-pressure call. We listen to how your business actually runs, the jobs you want more of, and where customers are slipping away today. You leave with a clear recommendation — whether or not we work together.",
  },
  {
    index: "02",
    title: "The Build",
    description: "A premium site with the instant-quote tool set to your pricing.",
    detail:
      "We design and build a site tailored to your trade — your real projects, your service areas, your voice — and configure the 3D quote tool around your project types, rates, options, and deposit terms. Everything is structured to make a serious buyer feel safe choosing you, on any device.",
  },
  {
    index: "03",
    title: "The System",
    description: "Search, Google Business Profile, social, and lead handling, wired to the site.",
    detail:
      "We connect the visibility and the lead machine: local search, Google Business Profile, content, call tracking, booking, and follow-ups — so the right people find you and every quote turns into a conversation.",
  },
  {
    index: "04",
    title: "The Portal",
    description: "You watch it work. We keep improving what's earning jobs.",
    detail:
      "Every lead, ranking, post, and generated quote shows up in your portal the day it happens. We watch the same numbers, refine what's working, and keep the system compounding — no monthly PDF to decode.",
  },
];

export type Faq = { q: string; a: string };
export const faqs: Faq[] = [
  {
    q: "What is the instant-quote tool?",
    a: "A 3D estimator that lives on your website. A homeowner picks a project type, sizes it on screen, chooses options, and gets a price range built from rates you control. They leave their details to book a site visit, and the quote lands in your portal as a lead.",
  },
  {
    q: "Who sets the prices the tool shows?",
    a: "You do. Project types, rate per unit, minimums, add-ons, markup, the plus-or-minus range, and deposit terms all live in your portal's pricing editor. Change a number and the tool on your site updates instantly.",
  },
  {
    q: "Why don't you show your own pricing on the website?",
    a: "Because no two businesses need the same thing. A solo remodeler and a 30-person GC have completely different goals. We'd rather learn what you actually need on a quick call and recommend the right system — instead of boxing you into a package you'll outgrow or overpay for.",
  },
  {
    q: "Do you only build websites?",
    a: "No. The website is the foundation, but we build the whole system around it — the quote tool, search visibility, Google Business Profile, social content, lead capture, booking, and follow-up automation — and you see all of it in one portal.",
  },
  {
    q: "What do I see in the portal?",
    a: "Leads and calls, website visits and uptime, Google clicks and the keywords you rank for, Instagram and Facebook reach, every quote a homeowner generated with its status, and a request form to reach the studio. It's open to every client from day one.",
  },
  {
    q: "Who do you work with?",
    a: "Contractors, remodelers, custom builders, roofers, and local service businesses that want to look as premium online as the work they do in person.",
  },
  {
    q: "Can I see websites you've already built?",
    a: "Yes — our Work page features real projects, with live links added as they go public. We never point you at a site we didn't build.",
  },
  {
    q: "How do I get started?",
    a: "Book a call. We'll talk through your goals, show you the portal and the quote tool, and give you a clear plan — no pressure, no obligation.",
  },
];

export const serviceOptions: string[] = [
  "Website + instant quote tool",
  "Premium website",
  "Search visibility",
  "Social & content",
  "Short-form video",
  "Lead capture + booking",
  "AI lead handling",
  "The full system",
  "Not sure yet",
];

export const sectorsServed: string[] = [
  "General Contractors",
  "Remodelers",
  "Custom Home Builders",
  "Roofing & Exteriors",
  "Kitchen & Bath",
  "Concrete & Foundations",
  "Landscaping & Hardscape",
  "Local Service Pros",
];

export const principles: { index: string; title: string; body: string }[] = [
  {
    index: "01",
    title: "Premium, never generic",
    body: "Every build is custom to your trade and your market. No recycled templates, no AI-looking filler — work that looks like it was made for you, because it was.",
  },
  {
    index: "02",
    title: "Designed to earn trust",
    body: "We design for the moment a serious buyer is deciding whether to risk a big job on you. Clarity, proof, and an obvious next step beat clever every time.",
  },
  {
    index: "03",
    title: "One platform, one team",
    body: "Website, quote tool, search, content, and lead flow shouldn't live with five different vendors and five different logins. We keep it under one roof — and one portal — so the pieces actually work together.",
  },
  {
    index: "04",
    title: "Honest about results",
    body: "We won't invent numbers or promise overnight miracles. We build systems that compound, show you the real numbers in your portal, and keep improving what's working.",
  },
];
