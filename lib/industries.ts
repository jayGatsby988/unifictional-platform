/**
 * Trade-specific landing pages — the commercial layer.
 *
 * Google Autocomplete (Aug 2026) shows real, separate demand for each trade
 * as its own phrase: "roofing marketing agency", "remodeler marketing",
 * "home builder marketing", "landscaping marketing", "concrete contractor
 * marketing", "kitchen and bath marketing". A single /services page cannot
 * rank for any of them; one substantive page each can.
 *
 * These must stay honest: no invented client counts, no fabricated results.
 * The differentiation is real — each trade genuinely sells differently.
 */

export type Industry = {
  slug: string;
  /** H1 — carries the target phrase. */
  title: string;
  metaTitle: string;
  description: string;
  targetKeyword: string;
  secondaryKeywords: string[];
  /** Short label used in nav and lists. */
  label: string;
  index: string;
  /** Deck under the H1. */
  intro: string;
  /** Quotable summary — reused in llms.txt. */
  answer: string;
  /** What's different about marketing this specific trade. */
  whatMakesItDifferent: { title: string; body: string }[];
  /** The searches this trade's buyers actually run. */
  buyerSearches: string[];
  /** Which of our services matter most here, by service slug. */
  priorityServices: string[];
  related: string[];
};

export const industries: Industry[] = [
  {
    slug: "roofing-marketing",
    label: "Roofing",
    index: "01",
    title: "Roofing Marketing: How Roofers Get Found and Booked",
    metaTitle: "Roofing Marketing Agency — Websites, SEO & Leads",
    description:
      "Roofing marketing that produces booked inspections — websites, local SEO, Google Business Profile, storm-season content, and lead systems built for roofing contractors.",
    targetKeyword: "roofing marketing",
    secondaryKeywords: [
      "roofing marketing agency",
      "roofing marketing ideas",
      "best roofing marketing companies",
      "roofing advertising ideas",
    ],
    intro:
      "Roofing is the most urgency-driven trade in residential construction. Someone with a leak isn't researching for three weeks — they're calling the first credible roofer who answers. Everything in roofing marketing follows from that.",
    answer:
      "Roofing marketing is driven by urgency and speed of response rather than long consideration. The highest-return work is a Google Business Profile that ranks in the map pack, a website that loads fast on a phone and makes the phone number unmissable, and a system that never lets a call go unanswered. Storm and seasonal demand spikes reward roofers who already rank before the weather arrives — visibility built in the quiet months is what captures the busy ones.",
    whatMakesItDifferent: [
      {
        title: "Urgency compresses everything",
        body: "An active leak is an emergency purchase. The roofer who answers first frequently wins regardless of price, which makes missed-call recovery and response time more valuable in roofing than in almost any other trade.",
      },
      {
        title: "Demand is seasonal and weather-driven",
        body: "Storm seasons create sharp spikes. You can't build rankings during a spike — you build them in the slow months so you're already visible when the phones start. Roofers who market only when it's quiet get this backwards.",
      },
      {
        title: "Insurance work needs its own explanation",
        body: "A large share of roof replacements run through insurance claims, and homeowners are confused about the process. Content that explains claims, adjusters, and what's covered captures people at the exact moment they're looking for someone to guide them.",
      },
      {
        title: "Trust is unusually fragile",
        body: "Roofing has a reputation problem created by storm-chasers. Local proof — licence numbers, manufacturer certifications, years in the area, and real reviews with names — does more work here than in any other trade.",
      },
    ],
    buyerSearches: [
      "roof repair near me",
      "roof replacement cost",
      "emergency roof repair [city]",
      "roofing contractors [city]",
      "does insurance cover roof replacement",
      "how long does a roof last",
      "metal vs asphalt shingle roof",
    ],
    priorityServices: ["google-business-profile", "seo", "website-design", "ai-receptionist"],
    related: ["general-contractor-marketing", "remodeler-marketing"],
  },

  {
    slug: "remodeler-marketing",
    label: "Remodeling",
    index: "02",
    title: "Remodeler Marketing: Winning High-Ticket Renovation Work",
    metaTitle: "Remodeler Marketing — Websites, SEO & Lead Systems",
    description:
      "Marketing for remodeling contractors — portfolio-led websites, local SEO for the towns you work in, before-and-after content, and lead systems built for long consideration cycles.",
    targetKeyword: "remodeler marketing",
    secondaryKeywords: [
      "remodeling marketing",
      "remodeling marketing agency",
      "how to grow a remodeling business",
      "kitchen remodel marketing",
    ],
    intro:
      "Remodeling is bought with the eyes and decided slowly. A homeowner spending $60,000 on a kitchen researches for weeks and shortlists on visual proof long before they contact anybody. Your portfolio is your sales team.",
    answer:
      "Remodeler marketing is portfolio-driven and operates on a long consideration cycle — often weeks or months between first search and first call. The work that matters most is high-quality project photography presented at full width, individual project pages that can rank on their own, service-area pages for each town you work in, and content answering the cost and timeline questions homeowners research before they ever contact a remodeler. Follow-up matters more here than in urgent trades, because the buying decision outlasts the first conversation.",
    whatMakesItDifferent: [
      {
        title: "The gallery is the argument",
        body: "Before-and-after pairs outperform every other content type in remodeling because they prove both the outcome and the starting condition. Images need to run large — a kitchen loses its persuasive power in a small thumbnail grid.",
      },
      {
        title: "Long consideration cycles reward follow-up",
        body: "Buyers research for weeks and often talk to three contractors. The remodeler who follows up two or three times after the quote regularly wins work the others have already written off.",
      },
      {
        title: "Cost anxiety is the real objection",
        body: "Homeowners genuinely don't know what a remodel costs and are afraid of being taken advantage of. Publishing honest ranges filters out unqualified leads and builds trust with the ones you want.",
      },
      {
        title: "Disruption fear stops more jobs than price",
        body: "Living through a renovation frightens people. Content explaining the process, the timeline, and what daily life looks like during the work removes an objection most remodelers never hear spoken aloud.",
      },
    ],
    buyerSearches: [
      "kitchen remodel cost [city]",
      "bathroom remodel contractors near me",
      "home remodeling companies [city]",
      "how long does a kitchen remodel take",
      "whole house renovation cost",
      "before and after kitchen remodel",
      "remodeling contractor reviews [city]",
    ],
    priorityServices: ["website-design", "seo", "social-media", "short-form-video"],
    related: ["kitchen-and-bath-marketing", "home-builder-marketing"],
  },

  {
    slug: "home-builder-marketing",
    label: "Custom Homes",
    index: "03",
    title: "Home Builder Marketing: Selling Custom Builds Online",
    metaTitle: "Home Builder Marketing — Websites & SEO",
    description:
      "Marketing for custom home builders — websites that carry a long sales cycle, process content that answers permitting and timeline fears, and search visibility for high-value build searches.",
    targetKeyword: "home builder marketing",
    secondaryKeywords: [
      "home builder marketing agency",
      "home builder marketing ideas",
      "custom home builder marketing",
      "home builder marketing strategies",
    ],
    intro:
      "A custom home is the largest purchase most of your clients will ever make, and the decision takes months. Marketing a custom building company is less about generating volume and more about being credible enough to survive a very long shortlist.",
    answer:
      "Home builder marketing supports an exceptionally long sales cycle — often six to eighteen months from first research to signed contract — and a small number of very high-value clients. The priorities are a website that demonstrates completed builds in depth, detailed process content covering feasibility, design, permitting, and timeline, and search visibility for the specific searches serious buyers run. Volume matters far less than credibility: a handful of qualified inquiries a year can fill a custom builder's schedule.",
    whatMakesItDifferent: [
      {
        title: "Very few clients, very high value",
        body: "A custom builder might need eight to twelve clients a year. That changes everything: a marketing programme that produces a small number of genuinely qualified conversations beats one producing a hundred unqualified ones.",
      },
      {
        title: "The fear is the eighteen months, not the house",
        body: "Buyers aren't uncertain about wanting a custom home. They're frightened of permitting, cost overruns, and delays. Process content that addresses those directly is the highest-converting material on a builder's site.",
      },
      {
        title: "Land and feasibility searches come first",
        body: "Serious buyers search about lots, zoning, and feasibility long before they search for a builder. Answering those questions is how you enter the conversation early rather than competing at the end.",
      },
      {
        title: "Architects and designers are a channel",
        body: "A significant share of custom work arrives through design professionals. Your website is often the thing an architect sends a client to — it needs to hold up under professional scrutiny, not just homeowner interest.",
      },
    ],
    buyerSearches: [
      "custom home builders [city]",
      "cost to build a house [city]",
      "how long does it take to build a custom home",
      "ADU builders near me",
      "custom home building process",
      "how to find land to build on",
      "semi custom vs custom home",
    ],
    priorityServices: ["website-design", "seo", "short-form-video", "lead-capture"],
    related: ["remodeler-marketing", "general-contractor-marketing"],
  },

  {
    slug: "general-contractor-marketing",
    label: "General Contracting",
    index: "04",
    title: "Contractor Marketing: A Complete System for General Contractors",
    metaTitle: "Contractor Marketing Agency — Websites, SEO & Leads",
    description:
      "Marketing for general contractors — websites, local SEO across every service and service area, Google Business Profile, lead capture, and reporting, built as one system rather than four vendors.",
    targetKeyword: "contractor marketing agency",
    secondaryKeywords: [
      "contractor marketing",
      "construction marketing agency",
      "digital marketing for construction companies",
      "best construction marketing agency",
    ],
    intro:
      "General contractors sell range, which is also the problem: list twelve services equally and you look like a handyman rather than a company that can run a large project. The structure of your marketing has to solve that before anything else.",
    answer:
      "Contractor marketing works best as a single connected system rather than separate vendors for website, SEO, and social. For general contractors specifically, the structural priority is a page for each service you genuinely want and a page for each town you serve — a single combined services page cannot rank for anything. Lead the site with your largest and most profitable job type rather than treating every service equally, and measure everything in booked jobs rather than traffic.",
    whatMakesItDifferent: [
      {
        title: "Range dilutes positioning",
        body: "Listing everything equally signals a handyman. Lead with the largest, most profitable work you want more of, and let the rest live on their own service pages underneath.",
      },
      {
        title: "One page per service, or nothing ranks",
        body: "A combined services page cannot compete for any individual search. Each service you want more of needs its own substantive page with its own projects and its own estimate path.",
      },
      {
        title: "Service areas are where the growth is",
        body: "Most general contractors are invisible one town over. Genuine service-area pages — with local projects and local specifics, not a find-and-replace of the city name — are usually the largest untapped source of organic leads.",
      },
      {
        title: "Commercial and residential need separating",
        body: "If you do both, they're different buyers with different searches and different proof requirements. Mixing them on the same pages weakens both.",
      },
    ],
    buyerSearches: [
      "general contractors near me",
      "general contractor [city]",
      "home addition contractors [city]",
      "commercial contractors [city]",
      "how much do general contractors charge",
      "licensed and bonded contractor [city]",
      "contractor for home renovation",
    ],
    priorityServices: ["website-design", "seo", "google-business-profile", "analytics"],
    related: ["remodeler-marketing", "roofing-marketing"],
  },

  {
    slug: "kitchen-and-bath-marketing",
    label: "Kitchen & Bath",
    index: "05",
    title: "Kitchen and Bath Marketing: Design-Led Demand",
    metaTitle: "Kitchen & Bath Marketing — Websites, SEO & Content",
    description:
      "Marketing for kitchen and bath remodelers — design-led websites, visual content, cost-question SEO, and lead systems built around how homeowners actually research renovations.",
    targetKeyword: "kitchen and bath marketing",
    secondaryKeywords: [
      "kitchen and bath marketing solutions",
      "bathroom remodel marketing",
      "kitchen remodeling leads",
      "kitchen and bath showroom marketing",
    ],
    intro:
      "Kitchen and bath is the most design-driven, most researched, and most visually competitive corner of residential remodeling. Homeowners arrive with saved images and a strong aesthetic point of view — the job is to show you can execute it.",
    answer:
      "Kitchen and bath marketing is design-led and heavily research-driven: homeowners spend weeks collecting inspiration images before contacting anyone, and they shortlist on visual style before they ever evaluate price. The priorities are a portfolio organised by style and room type rather than chronologically, genuinely useful cost and timeline content for the two rooms specifically, and a strong visual presence where inspiration searches happen. Showroom operators should treat visit-booking as the primary conversion, not the estimate form.",
    whatMakesItDifferent: [
      {
        title: "Buyers arrive with a style already in mind",
        body: "They've been collecting images for months. Organising your portfolio by style and room type — rather than by date — lets someone immediately find work that looks like what they want.",
      },
      {
        title: "Two rooms, two very different buyers",
        body: "Kitchen and bathroom projects differ in budget, timeline, and motivation. Separate pages for each convert better and rank for entirely different searches.",
      },
      {
        title: "Cost content is unusually high-value",
        body: "'Kitchen remodel cost' searches are enormous and largely answered by national sites with irrelevant national averages. Local, honest cost ranges are a genuine opening.",
      },
      {
        title: "Showrooms convert on the visit",
        body: "If you have a showroom, the goal of the website is a booked visit, not a submitted form. Structure the whole site around that single action.",
      },
    ],
    buyerSearches: [
      "kitchen remodel cost [city]",
      "bathroom remodel contractors near me",
      "small bathroom remodel ideas",
      "kitchen cabinet refacing vs replacing",
      "how long does a bathroom remodel take",
      "kitchen designers [city]",
      "walk in shower conversion cost",
    ],
    priorityServices: ["website-design", "social-media", "seo", "short-form-video"],
    related: ["remodeler-marketing", "general-contractor-marketing"],
  },

  {
    slug: "landscaping-marketing",
    label: "Landscaping",
    index: "06",
    title: "Landscaping Marketing: Seasonal Demand, Visual Proof",
    metaTitle: "Landscaping Marketing — Websites, SEO & Social",
    description:
      "Marketing for landscaping and hardscape companies — seasonal search strategy, transformation content, local SEO, and lead systems built for design-build and maintenance work.",
    targetKeyword: "landscaping marketing",
    secondaryKeywords: [
      "landscaping marketing ideas",
      "landscaping marketing agency",
      "landscaping marketing strategies",
      "hardscape marketing",
    ],
    intro:
      "Landscaping demand arrives in waves and the transformations are dramatic enough to sell themselves — provided anyone can find you when the season turns. Timing and visual proof carry this trade.",
    answer:
      "Landscaping marketing is defined by seasonality and by unusually strong visual before-and-afters. Search demand spikes in spring and again in early autumn, so visibility has to be built in the off-season to capture it. Design-build and maintenance are effectively two different businesses with different buyers and should be marketed separately. Transformation content performs better here than in almost any other trade because the change is immediate and obvious.",
    whatMakesItDifferent: [
      {
        title: "Demand is sharply seasonal",
        body: "Searches spike in spring and again before autumn. Rankings take months to build, so the work that captures the spring rush happens in winter. Marketing only during the busy season is the most common mistake in the trade.",
      },
      {
        title: "Design-build and maintenance are separate businesses",
        body: "A $40,000 patio installation and a recurring mowing contract have nothing in common — different buyers, different searches, different proof. Mixing them on one site weakens both.",
      },
      {
        title: "Transformations are exceptionally persuasive",
        body: "Few trades produce such immediate visual change. Before-and-after content performs well organically and is the strongest social material in residential construction.",
      },
      {
        title: "Neighbourhood clustering is real",
        body: "One visible project generates neighbour interest. Yard signs, local social targeting, and service-area pages built around actual neighbourhoods compound this effect.",
      },
    ],
    buyerSearches: [
      "landscaping companies near me",
      "backyard landscaping cost",
      "paver patio cost [city]",
      "landscape design [city]",
      "retaining wall contractors near me",
      "front yard landscaping ideas",
      "lawn care services [city]",
    ],
    priorityServices: ["social-media", "seo", "website-design", "google-business-profile"],
    related: ["concrete-contractor-marketing", "general-contractor-marketing"],
  },

  {
    slug: "concrete-contractor-marketing",
    label: "Concrete",
    index: "07",
    title: "Concrete Contractor Marketing: Local, Practical, Competitive",
    metaTitle: "Concrete Contractor Marketing & SEO",
    description:
      "Marketing for concrete and foundation contractors — local SEO for driveways, patios, and flatwork, plus websites and lead systems built for a competitive, price-sensitive trade.",
    targetKeyword: "concrete contractor marketing",
    secondaryKeywords: [
      "concrete company marketing",
      "concrete business marketing",
      "concrete contractor leads",
      "concrete marketing ideas",
    ],
    intro:
      "Concrete is a practical purchase in a crowded local market. Buyers compare quickly, price matters, and the winner is usually whoever looks most established and responds fastest.",
    answer:
      "Concrete contractor marketing is dominated by local search and speed of response, in a market where buyers gather several quotes and compare quickly. The priorities are map-pack visibility through a well-maintained Google Business Profile, individual pages for each concrete service — driveways, patios, foundations, decorative work — and photography that demonstrates finish quality. Decorative and stamped work commands higher margins and deserves separate, more visual treatment than standard flatwork.",
    whatMakesItDifferent: [
      {
        title: "Buyers gather multiple quotes fast",
        body: "Most concrete buyers contact three or four contractors in a single afternoon. Response speed is frequently the deciding factor, which makes missed-call recovery unusually valuable.",
      },
      {
        title: "Each service is its own search",
        body: "Driveways, patios, foundations, stamped concrete, and repair are distinct searches with distinct intent. One combined 'concrete services' page competes for none of them.",
      },
      {
        title: "Decorative work deserves separate treatment",
        body: "Stamped and decorative concrete carries better margins and is bought visually rather than practically. It warrants its own pages and its own photography, closer to how remodeling is sold.",
      },
      {
        title: "Finish quality is invisible in a quote",
        body: "Buyers can't judge concrete quality from a price. Close-up photography of edges, joints, and finishes is one of the few ways to demonstrate craft before the pour.",
      },
    ],
    buyerSearches: [
      "concrete contractors near me",
      "driveway replacement cost",
      "stamped concrete patio cost",
      "concrete foundation repair [city]",
      "how much does a concrete patio cost",
      "concrete driveway vs asphalt",
      "concrete company [city]",
    ],
    priorityServices: ["google-business-profile", "seo", "website-design", "lead-capture"],
    related: ["landscaping-marketing", "general-contractor-marketing"],
  },

  {
    slug: "pool-builder-marketing",
    label: "Pools & Spas",
    index: "08",
    title: "Pool Builder Marketing: Selling the Backyard, Not the Pool",
    metaTitle: "Pool Builder Marketing — Websites, SEO & Content",
    description:
      "Marketing for pool builders and spa contractors — cinematic portfolio websites, seasonal search timing, cost-question content, and lead systems for a long, high-value sales cycle.",
    targetKeyword: "pool builder marketing",
    secondaryKeywords: [
      "pool company marketing",
      "swimming pool marketing",
      "pool builder leads",
      "pool construction marketing",
    ],
    intro:
      "Pools are an aspirational purchase with a construction company's risk profile. Buyers fall in love visually, then spend months worrying about cost, permits, and whether the company will finish the job.",
    answer:
      "Pool builder marketing combines an aspirational, visual sell with a long and anxious decision cycle. The website functions as a portfolio — full-width imagery and video of finished pools carry the page — while the content has to resolve the practical fears: total cost including decking and landscaping, permitting, timeline, and ongoing maintenance. Search demand runs strongly seasonal, with research beginning months before build season, so visibility must be established well ahead of the spike.",
    whatMakesItDifferent: [
      {
        title: "The product is the photograph",
        body: "Water, light, and landscape are the entire sell. Full-width imagery and video carry a pool builder's site while text stays minimal — with the hard requirement that the gallery loads fast, because a slow luxury site reads as an unserious one.",
      },
      {
        title: "The real cost question is the whole backyard",
        body: "Buyers search 'pool cost' but they're buying decking, landscaping, lighting, and fencing too. Content that prices the complete project honestly prevents the sticker shock that kills deals at proposal stage.",
      },
      {
        title: "Research starts a season early",
        body: "People plan pools in winter for summer. Rankings and content need to be in place months before build season, not when the enquiries start arriving.",
      },
      {
        title: "Abandonment fear is acute",
        body: "Half-finished pool horror stories circulate widely. Process transparency, timeline commitments, and visible proof of completed builds do more to close a pool sale than any design feature.",
      },
    ],
    buyerSearches: [
      "pool builders near me",
      "how much does a pool cost [city]",
      "inground pool cost",
      "pool construction timeline",
      "fiberglass vs gunite pool",
      "backyard pool design ideas",
      "pool and spa contractors [city]",
    ],
    priorityServices: ["website-design", "short-form-video", "seo", "social-media"],
    related: ["landscaping-marketing", "remodeler-marketing"],
  },
];

export function getIndustry(slug: string): Industry | undefined {
  return industries.find((i) => i.slug === slug);
}
