/**
 * Long-form guides — the organic-search and AI-citation layer of the site.
 *
 * Each guide targets a query cluster harvested from real Google Autocomplete
 * data (Aug 2026). The site previously ranked for ~2 keywords because it had
 * no informational surface at all: nine service pages, all bottom-of-funnel.
 * These pages cover the questions contractors actually type before they ever
 * search for an agency.
 *
 * Rules for anything added here:
 *  • No invented client results, revenue numbers, or testimonials.
 *  • Price ranges are cited as *market* ranges (what the industry charges),
 *    never as Unifictional's own pricing — the studio quotes on a call.
 *  • The target keyword must appear in the H1, the meta title, and early body
 *    copy, because it's what the page is genuinely about — not as stuffing.
 */

export type GuideBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "callout"; title: string; text: string };

export type Guide = {
  slug: string;
  /** H1 — carries the target keyword. */
  title: string;
  /** <title> tag. Kept under ~60 chars where possible. */
  metaTitle: string;
  description: string;
  /** Primary query this page is built to answer. */
  targetKeyword: string;
  secondaryKeywords: string[];
  eyebrow: string;
  /** Deck paragraph under the H1 — also the AI-summary-friendly answer. */
  intro: string;
  /** A direct, quotable answer. Rendered as the first thing on the page and
   *  reused verbatim in llms.txt so assistants have something clean to cite. */
  answer: string;
  updated: string;
  readMinutes: number;
  blocks: GuideBlock[];
  faqs: { q: string; a: string }[];
  related: string[];
};

export const guides: Guide[] = [
  /* ------------------------------------------------------------------ 01 */
  {
    slug: "contractor-website-examples",
    title: "Contractor Website Examples: 8 Real Sites, and What Makes Them Work",
    metaTitle: "Contractor Website Examples (8 Real, Live Sites)",
    description:
      "Real contractor website examples from live general contractor, remodeling, roofing, pool, and excavation sites — plus the design and layout decisions that turn visitors into booked estimates.",
    targetKeyword: "contractor website examples",
    secondaryKeywords: [
      "construction website examples",
      "general contractor website examples",
      "best contractor website design",
      "contractor website design",
    ],
    eyebrow: "Guide",
    intro:
      "Most 'contractor website examples' roundups are screenshots of templates nobody uses. These are eight live sites — real companies, real projects, real phone numbers — with a breakdown of the specific decisions that make a serious buyer feel safe hiring them.",
    answer:
      "The best contractor website examples share five traits: a real photograph or video of the company's own work above the fold, a headline naming the trade and service area, proof (projects, licenses, reviews) before any sales copy, a single obvious next step repeated down the page, and a mobile layout that loads fast on a phone in a driveway. Templates fail because they are built to look finished, not to answer the question a homeowner is actually asking: can I trust this company with a large job?",
    updated: "2026-08-09",
    readMinutes: 9,
    blocks: [
      {
        type: "h2",
        text: "What actually separates a good contractor website from a pretty one",
      },
      {
        type: "p",
        text: "A homeowner about to spend $40,000 on a remodel is not evaluating your typography. They are running one calculation: is this company real, and will they still be around in six months? Every element on a contractor website either supports that judgement or gets in its way.",
      },
      {
        type: "p",
        text: "That's why the examples below are grouped by the decision they solve rather than by how they look. When you review your own site, walk it the same way — as a stranger with money and doubt.",
      },
      { type: "h2", text: "The five decisions every strong contractor site gets right" },
      {
        type: "ol",
        items: [
          "Your own work is above the fold. Not stock photography, not an illustration of a house — a photograph or video of a job your crew finished. Stock imagery reads as 'this company has nothing to show' faster than an empty gallery does.",
          "The headline names the trade and the service area. 'Custom home builders in Snohomish County' beats 'Building dreams since 1998'. The first tells a searcher they're in the right place; the second tells them nothing and matches no search query.",
          "Proof comes before persuasion. Project galleries, license numbers, years in business, and reviews should appear before the paragraph explaining why you care about quality. Everyone claims quality. Only some people can show it.",
          "One next step, repeated. Pick a single primary action — request an estimate, book a call, call now — and repeat it at the top, after the gallery, after the services, and in the footer. Sites that offer five equally weighted options get fewer of all five.",
          "It is fast on a real phone. Most contractor traffic is mobile, often on a bad connection. A hero video that takes eight seconds to load loses more jobs than a plain photograph ever would.",
        ],
      },
      { type: "h2", text: "8 live contractor website examples" },
      {
        type: "p",
        text: "Every site below is one we designed and built, and every one is live — you can open it, scroll it, and see how the decisions above play out in a real market. They span general contracting, remodeling, custom homes, siding and exteriors, excavation, and pool construction.",
      },
      { type: "h3", text: "1. General contractor — full-service, wide service area" },
      {
        type: "p",
        text: "A general contractor sells range, which is also the trap: list every service equally and you look like a handyman. The strongest GC sites lead with the largest, most profitable job type, use full-bleed video of real site work to establish scale, and push a clear estimate request. Service pages then branch out underneath so each trade can rank on its own.",
      },
      { type: "h3", text: "2. Remodeling and custom homes — the gallery is the argument" },
      {
        type: "p",
        text: "Remodeling is bought with the eyes. Before-and-after pairs do more work than any headline, because they prove both the outcome and the starting condition. The layout choice that matters most: let images run large and uncropped rather than boxing them into uniform thumbnails — a kitchen loses its impact at 300 pixels wide.",
      },
      { type: "h3", text: "3. Siding and exteriors — sell the material decision" },
      {
        type: "p",
        text: "Exterior buyers are usually mid-research on materials, not contractors. A site that explains siding options plainly, with photographs of each installed on a real house, captures traffic that competitors' 'about us' pages never see — and arrives at the estimate form with the customer already educated.",
      },
      { type: "h3", text: "4. ADUs and custom builds — answer the process questions" },
      {
        type: "p",
        text: "Custom and ADU projects have long consideration windows and heavy permitting anxiety. Sites that lay out the process step by step — feasibility, design, permits, build — convert better than sites that only show finished houses, because the fear isn't the result, it's the eighteen months in between.",
      },
      { type: "h3", text: "5. Excavation and site work — show scale and equipment" },
      {
        type: "p",
        text: "Site work is bought by other contractors and developers as often as by homeowners, and that audience is scanning for capacity. Equipment, crew size, and completed-project scale belong high on the page. Polish matters less here than evidence you can handle the job.",
      },
      { type: "h3", text: "6 & 7. Pool and spa construction — cinematic, gallery-led" },
      {
        type: "p",
        text: "Pools are the clearest case for treating a website like a portfolio. Water, light, and landscape are the entire product, so full-width imagery and video carry the page while text stays minimal. The functional requirement is that the gallery loads fast — a slow luxury site reads as an unserious one.",
      },
      { type: "h3", text: "8. Remodeling with strong local intent" },
      {
        type: "p",
        text: "For a remodeler working a defined set of towns, the highest-leverage structure is a real service-area layer: a genuine page per city with local projects, local details, and a local estimate path. Thin, duplicated city pages get ignored by Google; substantive ones are frequently the largest source of organic estimate requests.",
      },
      {
        type: "callout",
        title: "See them live",
        text: "All eight sites are on our work page, embedded as live previews you can open in full. We never show a site we didn't build.",
      },
      { type: "h2", text: "Contractor website design ideas worth stealing" },
      {
        type: "ul",
        items: [
          "A sticky call or estimate button on mobile, always visible, never covering content.",
          "Project pages with location, scope, timeline, and materials — these rank for searches your homepage never will.",
          "A short founder or crew photograph. Local trust is personal; anonymous companies feel like lead brokers.",
          "License, bond, and insurance numbers stated plainly in the footer.",
          "Real review text pulled from Google, with the reviewer's name — not anonymous five-star graphics.",
          "A visible service-area list or map, so a searcher two towns over knows immediately whether to call.",
          "Financing or payment information if you offer it. It removes a silent objection you never hear about.",
        ],
      },
      { type: "h2", text: "Mistakes that show up on almost every weak contractor site" },
      {
        type: "table",
        head: ["The mistake", "Why it costs you jobs", "The fix"],
        rows: [
          [
            "Stock photos of houses you didn't build",
            "Buyers recognise stock instantly and assume you have no portfolio",
            "Ten phone photos of real jobs beat one stock hero",
          ],
          [
            "A homepage that never names the city",
            "You can't rank locally for work you never mention",
            "Name the trade and the service area in the H1",
          ],
          [
            "'Contact us' as the only call to action",
            "It asks for effort without offering value",
            "'Request a free estimate' or 'Book a 15-minute call'",
          ],
          [
            "One page listing all services",
            "Nothing can rank for any individual service",
            "One substantive page per service you actually want",
          ],
          [
            "A form with nine required fields",
            "Every extra field drops completion",
            "Name, phone, and job type — qualify on the call",
          ],
          [
            "No pricing signal of any kind",
            "Unqualified leads and wasted estimate visits",
            "State typical project ranges or a minimum job size",
          ],
        ],
      },
      { type: "h2", text: "How to use these examples on your own site" },
      {
        type: "p",
        text: "Open your site on your phone, in daylight, and give yourself five seconds. Can you tell what the company does, where it works, and what to do next? If not, that's the first fix — before colours, before animation, before a redesign. Most contractor sites don't need to be more beautiful. They need to be more obvious.",
      },
    ],
    faqs: [
      {
        q: "What should a contractor website include?",
        a: "At minimum: your trade and service area in the headline, a gallery of your own completed projects, a page for each service you want to sell, license and insurance details, real reviews, and one obvious way to request an estimate that appears on every screen. Everything else is optional.",
      },
      {
        q: "How many pages should a contractor website have?",
        a: "Most contractors need a homepage, an about page, one page per service, a project gallery, a contact or estimate page, and — if you serve multiple towns — one substantive page per service area. That's typically 10 to 25 pages. Fewer pages means fewer things you can rank for.",
      },
      {
        q: "Do contractors really need a website if they have Google and Facebook?",
        a: "Yes, and the reason is order of operations. A Google Business Profile gets you found; the website is what a homeowner checks before they call, and it's the only asset in that chain that you own and control. Profiles and social pages can be suspended, restricted, or algorithmically buried without notice.",
      },
      {
        q: "Should a contractor use a template or a custom website?",
        a: "A template is fine when you need presence quickly and cheaply. A custom build earns its cost when you're competing for larger jobs, when your service areas need real local pages, or when your site is a primary lead source rather than a business card. The deciding question is what a single extra job is worth to you.",
      },
    ],
    related: [
      "contractor-website-cost",
      "construction-website-design-ideas",
      "how-to-get-more-leads-as-a-contractor",
    ],
  },

  /* ------------------------------------------------------------------ 02 */
  {
    slug: "contractor-website-cost",
    title: "How Much Does a Contractor Website Cost in 2026?",
    metaTitle: "How Much Does a Contractor Website Cost? (2026)",
    description:
      "What a contractor website actually costs in 2026 — DIY, freelancer, and custom agency ranges, ongoing monthly costs, what changes the price, and how to tell whether a quote is fair.",
    targetKeyword: "how much does a contractor website cost",
    secondaryKeywords: [
      "custom website design cost",
      "how much does it cost to build a custom website",
      "contractor website cost",
      "website redesign cost",
    ],
    eyebrow: "Guide",
    intro:
      "Website quotes for contractors range from a few hundred dollars to well past thirty thousand, which is useless information unless you know what moves the number. Here's what the market actually charges in 2026, and what you're buying at each level.",
    answer:
      "In 2026, a contractor website typically costs $0–$1,500 to build yourself on a site builder, $1,500–$6,000 from a freelancer or small studio, and $6,000–$25,000+ for a custom agency build with strategy, copywriting, and local SEO structure. Ongoing costs run roughly $25–$50/month for self-managed hosting and $150–$500/month for a managed site. Price is driven mainly by page count, whether copy and photography are included, and whether the build is templated or designed from scratch.",
    updated: "2026-08-09",
    readMinutes: 8,
    blocks: [
      { type: "h2", text: "The short answer" },
      {
        type: "table",
        head: ["Approach", "Typical build cost", "Ongoing", "Best for"],
        rows: [
          [
            "DIY site builder",
            "$0 – $1,500",
            "$25 – $50/mo",
            "A brand-new solo operator who needs to exist online this week",
          ],
          [
            "Freelancer / small studio",
            "$1,500 – $6,000",
            "$50 – $200/mo",
            "An established contractor replacing an outdated site",
          ],
          [
            "Custom agency build",
            "$6,000 – $25,000+",
            "$150 – $500/mo",
            "Companies competing for larger jobs where the site is a primary lead source",
          ],
          [
            "Multi-location / large custom",
            "$25,000 – $50,000+",
            "$500+/mo",
            "Regional builders with many service areas or divisions",
          ],
        ],
      },
      {
        type: "p",
        text: "These are market ranges across the industry, not our prices — every studio scopes differently, and we quote after a call rather than publishing packages. Published figures across 2026 pricing guides cluster tightly around these bands.",
      },
      { type: "h2", text: "What actually drives the price" },
      {
        type: "p",
        text: "Two quotes for 'a contractor website' can differ by a factor of ten and both be honest. The variables below account for nearly all of it.",
      },
      { type: "h3", text: "Page count and service-area structure" },
      {
        type: "p",
        text: "A five-page brochure site and a thirty-page site with a page per service and per city are entirely different builds. The second costs several times more and is also the version that generates organic leads, because there is something for each search to land on. If a quote seems low, check how many pages it includes.",
      },
      { type: "h3", text: "Who writes the copy" },
      {
        type: "p",
        text: "This is the single most common hidden cost. Many quotes assume you supply finished text for every page. Contractors almost never do — the project then stalls for months on the client side. Written copy typically adds $100–$400 per page when it's not bundled, and it's worth confirming before you sign anything.",
      },
      { type: "h3", text: "Photography and video" },
      {
        type: "p",
        text: "Your own project photography is the highest-return line item on a contractor site and the one most often skipped. A half-day photographer runs a few hundred to around $1,500 in most markets. If that's out of scope, a disciplined phone-photo routine on your own jobs is a genuine substitute — far better than stock.",
      },
      { type: "h3", text: "Template versus designed from scratch" },
      {
        type: "p",
        text: "A licensed template with your logo and colours dropped in is fast and cheap, and it looks like the other four contractors in your county using the same one. A custom design costs more because someone is making decisions specific to your trade, your photography, and the job size you're chasing.",
      },
      { type: "h3", text: "Whether SEO is built in or bolted on" },
      {
        type: "p",
        text: "Sites built with search structure from the start — clean URLs, real service pages, local schema, fast mobile performance — cost more up front and less later. Retrofitting search structure onto a finished site frequently costs more than doing it correctly the first time.",
      },
      { type: "h2", text: "The ongoing costs nobody mentions in the quote" },
      {
        type: "ul",
        items: [
          "Domain registration: roughly $12–$25 per year.",
          "Hosting: $10–$50/month self-managed; usually bundled in a managed plan.",
          "SSL certificate: free on modern hosting — you should not be charged for this.",
          "Maintenance, updates, and backups: $50–$200/month, or your problem if self-managed.",
          "Content updates and new project galleries: either your time or an hourly rate.",
          "Form and booking tools, call tracking, and email: often $20–$100/month combined.",
        ],
      },
      {
        type: "callout",
        title: "Ask this before you sign",
        text: "Who owns the site if we part ways? A site you can export and take with you is worth materially more than one that evaporates when the retainer stops. Get the answer in writing.",
      },
      { type: "h2", text: "How to tell whether a quote is fair" },
      {
        type: "ol",
        items: [
          "Count the pages. Divide the quote by the page count. Under about $200 a page usually means a template with filler text.",
          "Ask who writes the copy. If the answer is you, add the cost — or the delay — back into the quote.",
          "Ask what happens after launch. A build with no plan for updates becomes stale within a year.",
          "Ask to see three live sites they built for contractors. Live URLs, not screenshots or mockups.",
          "Ask what the site is structured to rank for. If nobody mentions service or city pages, search wasn't part of the plan.",
          "Confirm ownership, hosting, and domain control in writing before any money moves.",
        ],
      },
      { type: "h2", text: "Is a more expensive site actually worth it?" },
      {
        type: "p",
        text: "It depends entirely on your average job value, which is why blanket advice is useless. Work it out yourself: if your average job nets $8,000 in profit and a better site brings two extra jobs a year, a $10,000 build pays for itself in year one and compounds after. If you're doing $400 service calls, a $10,000 site is very hard to justify and the money is better spent on your Google Business Profile and reviews.",
      },
      {
        type: "p",
        text: "The honest version: spend what one or two won jobs are worth, and insist the site is built to be found — not just to look finished.",
      },
    ],
    faqs: [
      {
        q: "How much does a contractor website cost per month?",
        a: "Self-managed, expect $25–$50 per month for hosting and domain. Fully managed — hosting, backups, security, updates, and content changes handled for you — typically runs $150–$500 per month in 2026, depending on how much ongoing work is included.",
      },
      {
        q: "Why do custom websites cost so much more than templates?",
        a: "You're paying for decisions, not pixels. A custom build includes research into what your buyers search for, a structure designed to rank for it, copy written for your trade, and a layout built around your actual photography. A template gives you a finished-looking shell and leaves every one of those decisions to you.",
      },
      {
        q: "How much does a website redesign cost?",
        a: "Usually 70–100% of a new build, because the design, copy, and structure are being redone regardless. The savings come from already having photography, brand assets, and content — which can cut a few thousand off the total if they're in good shape.",
      },
      {
        q: "Can I build a contractor website myself?",
        a: "Yes, and for a brand-new solo operator that's often the right call. The realistic trade-off is 20 to 40 hours of your time and a site that looks like a site builder made it. If you're bidding against companies with real online presence for large jobs, that gap shows.",
      },
    ],
    related: [
      "contractor-website-examples",
      "seo-cost-for-contractors",
      "how-to-choose-a-marketing-agency",
    ],
  },

  /* ------------------------------------------------------------------ 03 */
  {
    slug: "seo-cost-for-contractors",
    title: "How Much Does SEO Cost for Contractors in 2026?",
    metaTitle: "How Much Does SEO Cost for Contractors? (2026)",
    description:
      "Real 2026 SEO pricing for contractors and construction companies — monthly retainer ranges, what's included at each level, how long results take, and how to spot an SEO company that will waste your money.",
    targetKeyword: "how much does seo cost",
    secondaryKeywords: [
      "how much does seo cost for a small business",
      "seo services cost per month",
      "seo for construction companies cost",
      "local seo pricing",
    ],
    eyebrow: "Guide",
    intro:
      "SEO pricing is deliberately murky, and contractors get quoted everything from $300 to $10,000 a month for what sounds like the same service. Here's what the market actually charges, what you get at each level, and the questions that separate real work from invoiced busywork.",
    answer:
      "In 2026, local SEO for a contractor typically costs $500–$1,500 per month for a single-location business with a narrow service area, and $1,500–$5,000 per month for competitive markets or multi-city coverage. Industry surveys put the most common retainer between roughly $500 and $2,000 per month, with reported averages near $2,900–$3,200. Most retainers assume a 6–12 month commitment because meaningful ranking movement rarely appears before month four.",
    updated: "2026-08-09",
    readMinutes: 8,
    blocks: [
      { type: "h2", text: "What contractors actually pay" },
      {
        type: "table",
        head: ["Tier", "Monthly", "What it typically covers"],
        rows: [
          [
            "Local basics",
            "$500 – $1,500",
            "Google Business Profile management, citations, on-page fixes, a small amount of content, basic reporting",
          ],
          [
            "Competitive local",
            "$1,500 – $3,500",
            "The above plus service and city pages, ongoing content, review generation, link building, call tracking",
          ],
          [
            "Multi-city / competitive metro",
            "$3,500 – $7,500",
            "Multi-location strategy, heavy content production, digital PR and links, CRO, full attribution",
          ],
          [
            "Project / one-off audit",
            "$1,500 – $6,000 once",
            "Technical audit, keyword and competitor research, a prioritised roadmap you or someone else executes",
          ],
        ],
      },
      {
        type: "p",
        text: "Reported industry averages sit around $2,900–$3,200 per month across all business sizes, which is skewed upward by larger companies. A single-location contractor in a mid-sized market is usually at the lower end of the table.",
      },
      { type: "h2", text: "Why the range is so wide" },
      {
        type: "p",
        text: "\"SEO\" covers work that varies by a factor of twenty in effort. Ranking a plumber in a town of 15,000 is a fundamentally different job from ranking a general contractor across metro Seattle, where a dozen well-funded competitors have been publishing for years. Price tracks competition, service-area size, and how much content and link acquisition the market demands.",
      },
      { type: "p", text: "The three variables that move a quote most:" },
      {
        type: "ul",
        items: [
          "Population and competitor count in your service area — the single biggest factor.",
          "How many cities you want to rank in. Each genuine service-area page is real work, not a find-and-replace.",
          "Whether content and link building are included, or whether you're paying for reporting on work nobody is doing.",
        ],
      },
      { type: "h2", text: "What a legitimate contractor SEO retainer includes" },
      {
        type: "ol",
        items: [
          "Keyword and competitor research tied to the jobs you actually want — not vanity terms with no buying intent.",
          "On-page work: titles, headings, internal linking, and page structure across your service and location pages.",
          "Technical health: site speed on mobile, crawlability, indexing, structured data, and fixing what's broken.",
          "Google Business Profile optimisation and ongoing posts, photos, and category management.",
          "Content: new service pages, city pages, and answers to the questions your buyers search before they hire.",
          "Reviews: a system for consistently generating them, because they drive both map rankings and conversion.",
          "Links and citations: consistent NAP data, plus genuine local mentions and links over time.",
          "Reporting that shows calls and form fills, not just impressions and 'keywords improved'.",
        ],
      },
      {
        type: "callout",
        title: "The reporting test",
        text: "Ask what metric the report leads with. If it opens with rankings or traffic rather than calls and estimate requests, you're being sold activity. Rankings are a means; booked jobs are the point.",
      },
      { type: "h2", text: "How long before it works?" },
      {
        type: "p",
        text: "Realistic timelines for a contractor starting from a weak position: technical and profile fixes can move map-pack visibility within 4–8 weeks; new service and city pages typically take 3–6 months to rank; competitive head terms often take 9–12 months or longer. Anyone promising page one in 30 days is either targeting keywords nobody searches or is about to do something that gets you penalised.",
      },
      {
        type: "p",
        text: "This is why 6–12 month commitments are standard. It's also why leaving after three months is the most expensive thing contractors do with SEO — you pay for the setup phase and quit before the compounding starts.",
      },
      { type: "h2", text: "Is SEO worth it for a contractor?" },
      {
        type: "p",
        text: "Do the arithmetic against your own numbers rather than trusting a case study. Take your average job profit, your close rate on inbound leads, and the retainer. If your average job nets $6,000 and you close one in four inbound leads, a $1,500/month retainer needs one extra job per quarter to break even and every job beyond that is margin. For high-ticket trades — remodels, custom homes, roofs, pools — the maths works quickly. For low-ticket service calls, paid ads and your Google Business Profile usually beat content SEO on speed to payback.",
      },
      { type: "h2", text: "Red flags in an SEO proposal" },
      {
        type: "ul",
        items: [
          "Guaranteed rankings or a guaranteed number one position. Nobody controls Google's results.",
          "A long contract with no defined deliverables per month.",
          "Reporting on keywords you've never heard a customer say.",
          "No access to your own Google Business Profile, Analytics, or Search Console accounts. You should own all three.",
          "Content produced at volume with no local specificity — generic articles that could belong to any company in any state.",
          "Refusal to name other contractors they work with, or examples only from unrelated industries.",
          "Pricing that's dramatically below market. At $300/month, roughly two hours of work is being done, and it shows.",
        ],
      },
      { type: "h2", text: "Cheaper alternatives if a retainer isn't realistic yet" },
      {
        type: "p",
        text: "If a monthly retainer isn't affordable, the highest-return unpaid work is well established: fully complete and actively maintain your Google Business Profile, ask every satisfied customer for a review the day the job finishes, add photographs of real projects regularly, and write one genuine page for each service and each town you serve. That sequence outperforms a cheap retainer, and it costs time rather than money.",
      },
    ],
    faqs: [
      {
        q: "How much does local SEO cost for a small contractor?",
        a: "Typically $500–$1,500 per month for a single-location contractor with a defined service area. That should cover Google Business Profile management, on-page optimisation, citation consistency, a modest amount of content, and reporting on calls and form fills.",
      },
      {
        q: "Is SEO a one-time cost or ongoing?",
        a: "Both exist. A one-off audit and technical fix runs $1,500–$6,000 and gives you a roadmap. Ongoing retainers exist because competitors keep publishing and Google keeps changing — rankings decay if nothing maintains them. Many contractors do a project first and decide about a retainer afterwards.",
      },
      {
        q: "Why is SEO so expensive?",
        a: "Because the deliverable is skilled labour over time, not a product. A real retainer covers research, writing, technical work, link acquisition, and review generation every month. Where it feels overpriced, the usual cause is that far less of that work is being done than the invoice implies.",
      },
      {
        q: "Should I do SEO or Google Ads?",
        a: "Ads if you need calls this month and have budget to spend continuously. SEO if you want a lead source that keeps producing after you stop paying. Most contractors doing well run both — ads for immediate work, SEO to lower long-term cost per lead.",
      },
    ],
    related: [
      "how-to-get-more-leads-as-a-contractor",
      "google-business-profile-for-contractors",
      "how-to-choose-a-marketing-agency",
    ],
  },

  /* ------------------------------------------------------------------ 04 */
  {
    slug: "how-to-market-a-construction-company",
    title: "How to Market a Construction Company: A Practical 2026 Playbook",
    metaTitle: "How to Market a Construction Company (2026)",
    description:
      "A step-by-step guide to marketing a construction company in 2026 — the order to do things in, what actually generates leads, what to ignore, and how to measure whether any of it is working.",
    targetKeyword: "how to market a construction company",
    secondaryKeywords: [
      "construction marketing ideas",
      "how to market a construction business",
      "how to advertise a construction company",
      "how to get more leads in construction",
    ],
    eyebrow: "Guide",
    intro:
      "Most construction marketing advice is a list of thirty tactics with no order to them. This is the order — what to fix first, what to add once that's working, and what to leave alone until you're much bigger.",
    answer:
      "Marketing a construction company works best in a fixed order: first make sure you can be found and trusted (Google Business Profile, reviews, a credible website), then capture what you're already getting (fast response, clear estimate path, follow-up), then expand reach (local SEO service and city pages, social proof content, referral systems), and only then buy attention (paid ads, sponsorships). Skipping to paid ads before the first two stages is the most common and most expensive mistake in the trade.",
    updated: "2026-08-09",
    readMinutes: 10,
    blocks: [
      {
        type: "p",
        text: "The reason most construction marketing fails isn't the tactics — it's the sequence. Buying ads that send strangers to an untrustworthy website is paying full price for a leak. Work through the stages below in order and each one makes the next cheaper.",
      },
      { type: "h2", text: "Stage 1 — Be findable and be credible" },
      {
        type: "p",
        text: "Nothing else matters until a homeowner who hears your name can find you and come away reassured. This stage is mostly free and is where the largest gains hide.",
      },
      { type: "h3", text: "Claim and complete your Google Business Profile" },
      {
        type: "p",
        text: "For local construction work, this is the highest-leverage asset you own — usually ahead of the website for immediate calls. Complete every field: primary and secondary categories, service list, service areas, hours, and a genuine description. Add photographs of real jobs regularly. A profile with 100+ photos and steady recent activity outranks a neglected one in the map pack more often than not.",
      },
      { type: "h3", text: "Build a review engine, not a review habit" },
      {
        type: "p",
        text: "Reviews drive both map rankings and the decision to call. The mistake is treating it as something you'll remember to do. Make it a fixed step in closing out a job: the same day the crew finishes, a text goes out with a direct review link. A consistent trickle beats a burst — twenty reviews spread over a year signals an active business; twenty in one week signals something else.",
      },
      { type: "h3", text: "Make the website credible" },
      {
        type: "p",
        text: "It doesn't need to be beautiful. It needs to name your trade and service area, show your own completed work, prove you're licensed and insured, and make the next step obvious. Fix that before spending anything on traffic.",
      },
      { type: "h2", text: "Stage 2 — Stop losing the leads you already have" },
      {
        type: "p",
        text: "Almost every construction company has a larger leak here than they realise, and closing it costs nothing in ad spend.",
      },
      {
        type: "ul",
        items: [
          "Answer the phone, or make sure something does. Missed calls in the trades are frequently lost jobs — most callers move straight to the next result rather than leaving a voicemail.",
          "Set up missed-call text-back. An automatic text within seconds of a missed call recovers a meaningful share of them, and costs very little to run.",
          "Respond to form fills fast. Speed to first contact is one of the strongest predictors of who wins the job — often more than price.",
          "Follow up more than once. Most contractors quote and go quiet. Two or three polite follow-ups over two weeks routinely recovers work competitors have already given up on.",
          "Track where leads come from. Ask every caller, or use call tracking numbers. Without this, every later decision is guesswork.",
        ],
      },
      {
        type: "callout",
        title: "Do this before anything else",
        text: "For most contractors, fixing response time and follow-up produces more additional revenue in 90 days than any new marketing channel — and the only cost is a system.",
      },
      { type: "h2", text: "Stage 3 — Expand reach" },
      { type: "h3", text: "Local SEO: a real page per service and per town" },
      {
        type: "p",
        text: "This is how construction companies get found beyond their home town. One genuine page per service, and one per city you actually work in — with local projects, local specifics, and a local path to an estimate. Thin duplicated city pages don't work and haven't for years; substantive ones become a compounding lead source.",
      },
      { type: "h3", text: "Content that answers real pre-purchase questions" },
      {
        type: "p",
        text: "Homeowners search costs, timelines, permits, and materials long before they search for a contractor. Pages answering those questions catch people early, build trust, and are increasingly what AI assistants quote when someone asks for advice. 'How much does a kitchen remodel cost in [your city]' is worth more traffic than any 'about us' page you'll ever write.",
      },
      { type: "h3", text: "Social proof, posted consistently" },
      {
        type: "p",
        text: "Social media rarely generates cold construction leads directly. What it does is close warm ones — the homeowner who got your name from a neighbour checks your profile before they call, and an active feed of real projects settles the question. Before-and-afters, short site walkthroughs, and finished-job photos are enough. Consistency matters far more than production value.",
      },
      { type: "h3", text: "Systematise referrals" },
      {
        type: "p",
        text: "Referrals are already your best channel and are almost never managed. Ask directly at the point of maximum goodwill — when the job's finished and the customer is pleased. Stay in touch with past customers a couple of times a year. Build genuine relationships with adjacent trades: realtors, designers, plumbers, electricians. That network outperforms most paid channels for large jobs.",
      },
      { type: "h2", text: "Stage 4 — Buy attention (only now)" },
      {
        type: "p",
        text: "With the first three stages working, paid channels become profitable instead of expensive.",
      },
      {
        type: "table",
        head: ["Channel", "Best for", "Watch out for"],
        rows: [
          [
            "Google Local Services Ads",
            "Immediate high-intent local calls; pay per lead",
            "Requires licence and insurance verification; lead quality varies",
          ],
          [
            "Google Search Ads",
            "Capturing people actively searching your service",
            "Competitive keywords are expensive; needs negative keywords and tight geo-targeting",
          ],
          [
            "Meta ads (Facebook / Instagram)",
            "Awareness and retargeting; visual trades like remodels and pools",
            "Colder traffic, longer nurture; poor fit for urgent-need services",
          ],
          [
            "Lead marketplaces",
            "Filling gaps in a slow season",
            "Shared leads, price-driven buyers, thin margins — a supplement, not a strategy",
          ],
          [
            "Local sponsorships and direct mail",
            "Dense neighbourhoods and repeat service areas",
            "Hard to measure without a dedicated phone number or landing page",
          ],
        ],
      },
      { type: "h2", text: "What to measure" },
      {
        type: "p",
        text: "Four numbers tell you almost everything. Track them monthly and ignore the rest until they're solid:",
      },
      {
        type: "ol",
        items: [
          "Leads by source — calls, forms, and where each came from.",
          "Cost per lead by channel.",
          "Close rate from lead to signed job.",
          "Average job value, so you can convert everything above into profit rather than activity.",
        ],
      },
      { type: "h2", text: "What to ignore" },
      {
        type: "ul",
        items: [
          "Follower counts. A contractor with 400 local followers beats one with 40,000 in other states.",
          "Website traffic as a headline metric. Traffic that doesn't call isn't worth anything.",
          "Rebranding, when the real problem is that nobody can find you.",
          "Directory listings beyond the major ones. The long tail of paid directories is mostly a waste.",
          "Any platform your customers don't use. If your buyers aren't there, your competitors' presence there doesn't matter.",
        ],
      },
    ],
    faqs: [
      {
        q: "What's the best way to market a construction company on a small budget?",
        a: "In order: complete your Google Business Profile, get reviews systematically, set up missed-call text-back, and publish one honest page per service and per town you serve. That sequence costs mostly time and outperforms a small ad budget spent on a weak foundation.",
      },
      {
        q: "How much should a construction company spend on marketing?",
        a: "A common benchmark is 3–8% of revenue, at the higher end while growing or entering new markets and the lower end when you're referral-rich and busy. The more useful test is cost per acquired job against your average job profit.",
      },
      {
        q: "How long does construction marketing take to work?",
        a: "Response-time and follow-up fixes show up within weeks. Google Business Profile improvements typically move within 1–2 months. Content and local SEO usually take 3–6 months to produce steady leads, and keep compounding after. Paid ads produce leads immediately but stop the moment you stop paying.",
      },
      {
        q: "Do I need a marketing agency, or can I do this myself?",
        a: "Stages 1 and 2 are entirely doable yourself and you should probably start there regardless. Stage 3 is where most contractors run out of time rather than ability — writing dozens of pages and maintaining them is a real job. Hire when the bottleneck is your hours, not your knowledge.",
      },
    ],
    related: [
      "how-to-get-more-leads-as-a-contractor",
      "google-business-profile-for-contractors",
      "social-media-for-contractors",
    ],
  },

  /* ------------------------------------------------------------------ 05 */
  {
    slug: "construction-website-design-ideas",
    title: "Construction Website Design Ideas That Actually Get You Called",
    metaTitle: "Construction Website Design Ideas (2026)",
    description:
      "Practical construction website design ideas — layout, homepage structure, galleries, service pages, and mobile details that turn a good-looking site into one that generates estimate requests.",
    targetKeyword: "construction website design ideas",
    secondaryKeywords: [
      "website design for construction company",
      "construction website design inspiration",
      "best website design for construction companies",
      "construction website design",
    ],
    eyebrow: "Guide",
    intro:
      "There is no shortage of beautiful construction websites that generate nothing. These are the design ideas that carry their weight — organised by where they go on the site, and why each one changes a visitor's decision.",
    answer:
      "The construction website design ideas that measurably improve results are structural rather than decorative: a hero using your own project footage with a headline naming the trade and service area, proof placed immediately below the fold, one substantive page per service and per city, galleries organised by project rather than by image, a persistent mobile call or estimate button, and page speed treated as a design constraint. Visual polish helps only after those are in place.",
    updated: "2026-08-09",
    readMinutes: 8,
    blocks: [
      { type: "h2", text: "Homepage ideas" },
      { type: "h3", text: "Lead with motion of your own work — carefully" },
      {
        type: "p",
        text: "A short, silent, looping clip of a real job — a crew framing, a drone pass over a finished build — outperforms a static hero for most trades because it proves activity. The constraint is weight: compress hard, cap it at a few seconds, and always render a still image first so the page never appears blank on a slow connection.",
      },
      { type: "h3", text: "Write the headline for a searcher, not a brand deck" },
      {
        type: "p",
        text: "'Kitchen and bath remodeling in Bellevue' does two jobs at once — it confirms the visitor is in the right place and it gives the page something to rank for. 'Crafting spaces since 1998' does neither. Keep the poetry for the subheading if you want it.",
      },
      { type: "h3", text: "Put proof above the fold, or immediately below it" },
      {
        type: "p",
        text: "Years in business, licence number, project count, review rating, and the areas you serve — as a slim strip of facts rather than a paragraph. This is the single cheapest credibility gain available on a construction homepage.",
      },
      { type: "h3", text: "Show the process, briefly" },
      {
        type: "p",
        text: "A three or four step outline — consult, design, permits, build — resolves the anxiety that actually stops people from calling. Homeowners aren't afraid of the finished kitchen; they're afraid of the disruption between now and then.",
      },
      { type: "h2", text: "Gallery and project ideas" },
      {
        type: "ul",
        items: [
          "Organise by project, not by image. A page per project — with location, scope, timeline, and materials — gives each job its own URL that can rank on its own.",
          "Before-and-after pairs with a slider or side-by-side layout. For remodels this is the most persuasive element you can put on a site.",
          "Let images run large. A kitchen at full width sells; the same kitchen in a 300-pixel thumbnail grid does not.",
          "Caption with specifics: 'Full kitchen remodel, Kirkland — 6 weeks, walnut cabinetry, quartz counters.' Specificity reads as real experience.",
          "Filter by service type once you have more than about a dozen projects, so a roofing lead isn't scrolling past bathrooms.",
          "Include one or two in-progress shots. Perfect finished photos everywhere can read as someone else's portfolio.",
        ],
      },
      { type: "h2", text: "Service page ideas" },
      {
        type: "p",
        text: "This is where most construction sites lose the most ground. A single page listing twelve services cannot rank for any of them, and it doesn't answer any specific buyer's question either.",
      },
      {
        type: "ol",
        items: [
          "One page per service you actually want more of. If you don't want small repairs, don't build a page for them.",
          "Open by naming the service and the area in the H1, then answer immediately what it includes.",
          "Include a realistic cost range or a minimum project size. It qualifies leads and removes the biggest unspoken objection.",
          "Show projects from that specific service on that page — not the generic site-wide gallery.",
          "Answer the three or four questions you get on every estimate call for that service. Put them in an FAQ block.",
          "End with the same call to action as everywhere else. Consistency beats creativity here.",
        ],
      },
      { type: "h2", text: "Service-area page ideas" },
      {
        type: "p",
        text: "If you work across several towns, service-area pages are how you get found in the ones you don't live in. The rule that decides whether they work: each page must contain something that could only have been written about that place — projects you've completed there, permitting quirks, neighbourhoods, local specifics. A page that's the home page with the city name swapped in is worse than no page at all.",
      },
      { type: "h2", text: "Mobile and performance ideas" },
      {
        type: "ul",
        items: [
          "A persistent call or estimate button at the bottom of the screen. Tappable with a thumb, always visible.",
          "Tap-to-call the phone number everywhere it appears. It should never be an image or plain text.",
          "Forms with three fields, not nine. Name, phone, job type. Qualify on the call, not on the form.",
          "Compress every image. A 4MB hero photo from a phone camera is the most common cause of a slow contractor site.",
          "Test on a real phone on cellular data, not on your office desktop. That's the actual condition your buyers are in.",
          "Readable type: at least 16px body text and genuine contrast. A large share of high-ticket remodel buyers are over 50.",
        ],
      },
      { type: "h2", text: "Trust ideas that are easy to skip and shouldn't be" },
      {
        type: "ul",
        items: [
          "A photograph of the owner or crew. Local construction is a personal purchase.",
          "Licence, bond, and insurance numbers stated plainly, not hidden in a legal page.",
          "Real review text with names, pulled from Google — not decorative star graphics.",
          "Manufacturer certifications and trade association memberships, where you hold them.",
          "Warranty terms in plain language.",
          "A physical address or at least a named service region. Address-free sites read as lead brokers.",
        ],
      },
      {
        type: "callout",
        title: "The five-second test",
        text: "Open your homepage on a phone and count to five. If a stranger can't tell what you do, where you work, and what to do next, no amount of design refinement fixes it — the structure is the problem.",
      },
    ],
    faqs: [
      {
        q: "What should a construction company website look like?",
        a: "Clean, image-led, and unambiguous. Your own project photography carrying the page, a headline naming your trade and service area, proof of credentials near the top, a page for each service, and one obvious next step repeated throughout. Restraint reads as confidence in this industry.",
      },
      {
        q: "What colours work best for a construction website?",
        a: "Neutral and high-contrast — dark greys or near-blacks with a single strong accent for buttons. The reason is practical rather than aesthetic: your project photography is the visual interest, and a busy palette competes with it. Reserve the accent colour exclusively for calls to action so they never get lost.",
      },
      {
        q: "Should a construction website have video?",
        a: "It helps if the video is your own work and it's compressed properly. A short silent loop in the hero and a few project walkthroughs are plenty. Video that delays the first paint costs you more visitors than it impresses.",
      },
      {
        q: "How do I make my construction website rank on Google?",
        a: "Structure first: one page per service, one genuine page per service area, fast mobile performance, and local business schema. Then a complete Google Business Profile and steady reviews. Then content answering the cost, timeline, and material questions your buyers search before hiring.",
      },
    ],
    related: [
      "contractor-website-examples",
      "contractor-website-cost",
      "how-to-market-a-construction-company",
    ],
  },

  /* ------------------------------------------------------------------ 06 */
  {
    slug: "google-business-profile-for-contractors",
    title: "Google Business Profile for Contractors: How to Optimise It Properly",
    metaTitle: "Google Business Profile for Contractors",
    description:
      "A complete guide to optimising a Google Business Profile for contractors — categories, service areas, photos, reviews, posts, and the ranking factors that decide who shows up in the local map pack.",
    targetKeyword: "google business profile optimization",
    secondaryKeywords: [
      "how to optimize google business page",
      "google business profile for contractors",
      "what is google my business optimization",
      "local seo for home services",
    ],
    eyebrow: "Guide",
    intro:
      "For local contractors, the Google Business Profile is usually a bigger source of calls than the website — and it's the asset most often left half-finished. Here's how to set it up properly and what actually influences whether you appear in the map pack.",
    answer:
      "To optimise a Google Business Profile as a contractor: choose the most specific primary category available, add every relevant secondary category, define service areas by the towns you genuinely work in, complete the full services list, upload real project photographs regularly, and build reviews steadily with keyword-rich customer language. Local map rankings are driven by relevance, distance, and prominence — categories and services drive relevance, review volume and consistency drive prominence, and distance is the one factor you cannot influence.",
    updated: "2026-08-09",
    readMinutes: 8,
    blocks: [
      { type: "h2", text: "Why this matters more than most contractors think" },
      {
        type: "p",
        text: "When someone searches for a contractor near them, the map pack sits above the organic results and takes a large share of the clicks. Ranking there is a different exercise from ranking a website, and it's usually faster — profile changes can show effects in weeks rather than months.",
      },
      { type: "h2", text: "Get the categories right" },
      {
        type: "p",
        text: "Your primary category is the strongest single relevance signal on the profile. Choose the most specific one that describes your main work: 'Bathroom remodeler' rather than 'Contractor', 'Roofing contractor' rather than 'Construction company'. Specificity wins.",
      },
      {
        type: "p",
        text: "Then add secondary categories for everything else you genuinely do. They're weaker signals but they broaden the searches you can appear for. Don't add categories for work you don't do — irrelevant leads waste time and poor engagement doesn't help you.",
      },
      {
        type: "callout",
        title: "Quick competitive check",
        text: "Search your main service in your town and look at the top three map results. Their primary categories are visible on their profiles. If all three use a category you haven't selected, that's usually the fastest fix available to you.",
      },
      { type: "h2", text: "Service areas: be honest and be specific" },
      {
        type: "p",
        text: "As a contractor you'll typically run a service-area business, optionally hiding your address. List the towns and neighbourhoods you actually work in. Two mistakes are common and both hurt: listing an entire state (which dilutes relevance everywhere) and listing only your home town (which makes you invisible in the surrounding towns where you'd happily work).",
      },
      {
        type: "p",
        text: "Distance from the searcher remains one of the three ranking factors, and no amount of optimisation overrides it entirely. Service areas expand where you're eligible to appear — they don't make you rank in a city an hour away.",
      },
      { type: "h2", text: "Fill in every field, including the ones nobody uses" },
      {
        type: "ul",
        items: [
          "Services: add each one individually with its own short description. This is prime, underused space for relevance.",
          "Business description: 750 characters describing what you do, for whom, and where — written for a human, not stuffed.",
          "Hours, including holiday hours. Wrong hours generate one-star reviews from people who drove out.",
          "Attributes: licensed, veteran-owned, free estimates, online appointments — whichever genuinely apply.",
          "Opening date. It quietly signals establishment.",
          "Booking or quote-request link pointing straight to your estimate page.",
          "Products or service items with prices where you can commit to a range.",
        ],
      },
      { type: "h2", text: "Photos: quantity and recency both count" },
      {
        type: "p",
        text: "Profiles with substantial, current photography consistently perform better and convert better — a homeowner comparing three contractors will pick the one whose work they can actually see. Upload from real jobs continuously rather than in one initial batch.",
      },
      {
        type: "ul",
        items: [
          "Before-and-after pairs from completed projects.",
          "Crew and equipment on site — proof there's a real operation behind the listing.",
          "Finished work, shot in daylight, straight-on rather than at an angle.",
          "A clear logo and a strong cover photo.",
          "Take photos with location services on where you're comfortable with it, so the image carries local context.",
          "Aim for a steady cadence — a handful each month beats fifty once and then silence.",
        ],
      },
      { type: "h2", text: "Reviews are the prominence lever" },
      {
        type: "p",
        text: "Review count, rating, recency, and velocity all feed local prominence — and reviews convert as hard as they rank. The practical system:",
      },
      {
        type: "ol",
        items: [
          "Ask the day the job finishes, in person, then send the link by text within the hour.",
          "Use a short direct review link so nobody has to search for you.",
          "Never buy reviews or run incentives. Removal and suspension are real risks and the pattern is detectable.",
          "Reply to every review, positive and negative. Replies are visible to future customers and signal an active business.",
          "Answer negative reviews calmly with specifics. A measured reply to a bad review often reassures more than the five-star ones do.",
          "Aim for steady flow rather than bursts — a sudden spike after months of nothing looks exactly like what it usually is.",
        ],
      },
      { type: "h2", text: "Posts, Q&A, and messaging" },
      {
        type: "p",
        text: "Google Posts are low-effort activity signals — a finished project with two sentences and a photo, weekly or fortnightly, is enough. In the Q&A section you can seed your own genuine frequently asked questions and answer them; if you don't, someone else may answer for you, incorrectly. If you enable messaging, commit to responding fast, because slow replies are worse than not offering it.",
      },
      { type: "h2", text: "What gets profiles suspended" },
      {
        type: "ul",
        items: [
          "Keyword stuffing the business name. 'ABC Roofing' is fine; 'ABC Roofing | Best Roofer Seattle Free Estimates' risks the whole listing.",
          "A fake or virtual office address. Use a service-area business instead.",
          "Multiple listings for the same business at the same address.",
          "Listing an address you don't actually operate from.",
          "Review manipulation — buying, incentivising, or reviewing yourself.",
        ],
      },
      {
        type: "p",
        text: "Reinstating a suspended profile is slow and sometimes unsuccessful. Given how much local traffic runs through it, it's not worth the risk for a short-term ranking bump.",
      },
    ],
    faqs: [
      {
        q: "How long does it take to rank in the Google map pack?",
        a: "For a new profile in a moderately competitive area, expect 1–3 months of consistent work — completing the profile, steady photos, and a growing review base. Competitive metro markets can take longer, and distance from the searcher will always cap how far out you can rank.",
      },
      {
        q: "Should contractors hide their address on Google?",
        a: "If you work at customer locations rather than serving customers at yours, yes — set it up as a service-area business and hide the address. Running from a home address without hiding it is a common cause of suspension.",
      },
      {
        q: "How many photos should I have on my Google Business Profile?",
        a: "There's no magic number, but strong contractor profiles typically carry well over a hundred and keep adding. Recency matters as much as volume: a profile with fresh photos every month signals an active business to both Google and the homeowner comparing you to two competitors.",
      },
      {
        q: "Do Google Posts help rankings?",
        a: "Their direct ranking effect is modest. They help mainly by keeping the profile active and by occupying more space when someone views your listing. They're cheap to do, so the cost-benefit is favourable — just don't expect them to substitute for reviews and categories.",
      },
    ],
    related: [
      "seo-cost-for-contractors",
      "how-to-market-a-construction-company",
      "how-to-get-more-leads-as-a-contractor",
    ],
  },

  /* ------------------------------------------------------------------ 07 */
  {
    slug: "social-media-for-contractors",
    title: "Social Media Marketing for Contractors: What Works and What to Skip",
    metaTitle: "Social Media Marketing for Contractors (2026)",
    description:
      "How social media marketing actually works for contractors and construction companies — which platforms matter, what to post, how often, what it costs to outsource, and how to tell whether it's working.",
    targetKeyword: "social media marketing for contractors",
    secondaryKeywords: [
      "social media marketing for construction companies",
      "best social media platforms for construction companies",
      "social media marketing strategy for construction companies",
      "social media marketing agency cost per month",
    ],
    eyebrow: "Guide",
    intro:
      "Social media rarely generates cold construction leads — and that's fine, because it isn't what it's for. Its real job is closing the warm ones: the homeowner who got your name from a neighbour and is checking whether you look like a real company.",
    answer:
      "For contractors, social media works primarily as a trust check rather than a lead source. The homeowner who hears your name from a neighbour looks you up before calling, and an active feed of real project photos settles the decision. Instagram and Facebook carry the most weight for residential trades; LinkedIn matters for commercial and developer work. Posting two to three times a week with genuine before-and-afters and short site clips outperforms polished, infrequent content. Outsourced management typically runs $500–$2,500 per month for a small contractor.",
    updated: "2026-08-09",
    readMinutes: 7,
    blocks: [
      { type: "h2", text: "Be honest about what social media does for a contractor" },
      {
        type: "p",
        text: "If you're expecting strangers to see a post and book a $50,000 remodel, you will be disappointed and you'll quit in three months. The realistic value is different and still significant:",
      },
      {
        type: "ul",
        items: [
          "It closes referrals. Someone gets your name, looks you up, and decides whether you look legitimate. An empty or abandoned profile costs you jobs you'd already won.",
          "It keeps you present with past customers and their networks, which is where repeat and referral work comes from.",
          "It builds a library of project content you can reuse on your website, in ads, and in estimates.",
          "It recruits. In a tight labour market, crews check whether you look like somewhere worth working.",
          "Occasionally it does generate direct leads — mostly for highly visual trades like remodels, pools, and landscaping.",
        ],
      },
      { type: "h2", text: "Which platforms actually matter" },
      {
        type: "table",
        head: ["Platform", "Worth it for", "What to post"],
        rows: [
          [
            "Instagram",
            "Remodels, kitchens and baths, pools, landscaping, custom homes — anything visual",
            "Before-and-afters, finished project carousels, short site Reels",
          ],
          [
            "Facebook",
            "Nearly every residential trade; strongest for older, higher-budget homeowners",
            "Project posts, local community involvement, reviews shared as posts",
          ],
          [
            "Google Business Profile posts",
            "Every local contractor — technically not social, but the highest return per minute",
            "Finished jobs, offers, seasonal reminders",
          ],
          [
            "LinkedIn",
            "Commercial work, developers, GC-to-sub relationships",
            "Project milestones, team news, capability posts",
          ],
          [
            "TikTok / YouTube Shorts",
            "Optional. Strong for trades with satisfying process footage",
            "Process clips, teardowns, honest explainers",
          ],
          [
            "Nextdoor",
            "Hyper-local residential services",
            "Recommendations and community presence rather than advertising",
          ],
        ],
      },
      {
        type: "p",
        text: "Pick two and do them properly. A contractor posting consistently on Instagram and Facebook beats one with abandoned accounts on six platforms.",
      },
      { type: "h2", text: "What to post" },
      {
        type: "p",
        text: "Your jobs are the content. You don't need a strategy document; you need a habit of pulling out your phone on site.",
      },
      {
        type: "ol",
        items: [
          "Before-and-after pairs. The highest-performing content in every residential trade, without exception.",
          "In-progress shots. Framing, demo, rough-in — these prove the work is real and yours.",
          "Short walkthroughs of a finished job. Thirty to sixty seconds, narrated plainly.",
          "The crew working. People hire people, and this is what separates you from a lead broker.",
          "Answers to questions you get on every estimate. 'How long does a bathroom take?' is a post.",
          "Reviews and thank-you notes, shared with the customer's permission.",
          "The occasional problem you solved — rot behind a wall, a foundation surprise. This content performs unusually well because it's honest.",
        ],
      },
      {
        type: "callout",
        title: "The photo habit",
        text: "Take three photos at every job: before you start, halfway, and when it's finished. Do it on every job for a month and you'll never run out of things to post again.",
      },
      { type: "h2", text: "How often to post" },
      {
        type: "p",
        text: "Two to three times a week is plenty for a contractor and is achievable without hiring anybody. Consistency matters more than frequency: a steady twice a week for a year builds a profile that closes referrals. Daily for three weeks and then nothing for four months is worse than never starting, because an abandoned profile actively signals a business that may have folded.",
      },
      { type: "h2", text: "What social media management costs to outsource" },
      {
        type: "table",
        head: ["Level", "Monthly", "Typically includes"],
        rows: [
          [
            "Basic management",
            "$500 – $1,500",
            "Scheduling and posting content you supply, light engagement, simple reporting",
          ],
          [
            "Managed content",
            "$1,500 – $3,500",
            "Content planning, captions, editing your footage into Reels, community management",
          ],
          [
            "Full programme",
            "$3,500 – $7,500+",
            "Strategy, on-site content capture, creative direction, paid social, full reporting",
          ],
        ],
      },
      {
        type: "p",
        text: "Market ranges for 2026, not our pricing. The important distinction when comparing quotes: is anyone actually creating content, or are you paying someone to schedule photos that you still have to take? The second is common and much cheaper than it's often billed.",
      },
      { type: "h2", text: "How to tell whether it's working" },
      {
        type: "p",
        text: "Don't measure this in followers. The metrics that reflect the real job social media does for a contractor are: profile visits, website clicks from your profiles, direct messages that turn into conversations, and — most usefully — asking new customers whether they looked you up before calling. That last question, asked consistently, tells you more than any dashboard.",
      },
      {
        type: "p",
        text: "One realistic expectation: if referrals are already your main source of work, better social presence raises your close rate on leads you were getting anyway. That gain is real, and it's largely invisible in analytics.",
      },
    ],
    faqs: [
      {
        q: "What's the best social media platform for contractors?",
        a: "Instagram and Facebook for residential work — Instagram for visual trades like remodels and pools, Facebook for reaching older homeowners with larger budgets. LinkedIn if you're chasing commercial or developer work. Pick two and be consistent rather than covering everything badly.",
      },
      {
        q: "How often should a contractor post on social media?",
        a: "Two to three times a week, sustained. Consistency beats volume: a profile that's been steadily active for a year does the trust job you need it to do, while a burst of daily posts followed by silence looks like a business that may no longer exist.",
      },
      {
        q: "Does social media actually generate leads for contractors?",
        a: "Directly and coldly, rarely. Its real contribution is raising your close rate on referrals and repeat business, because most people look you up before they call. Visual trades — remodelling, pools, landscaping — see more direct inquiries than trades like excavation or framing.",
      },
      {
        q: "Should I pay for social media ads as a contractor?",
        a: "Only after your organic profile looks credible, because ads send people to a profile that has to hold up. When you do, retargeting people who already visited your website is usually the most efficient starting point for high-ticket residential work.",
      },
    ],
    related: [
      "how-to-market-a-construction-company",
      "how-to-get-more-leads-as-a-contractor",
      "google-business-profile-for-contractors",
    ],
  },

  /* ------------------------------------------------------------------ 08 */
  {
    slug: "how-to-get-more-leads-as-a-contractor",
    title: "How to Get More Leads as a Contractor (Without Buying Them)",
    metaTitle: "How to Get More Leads as a Contractor (2026)",
    description:
      "A practical guide to contractor lead generation — where leads actually come from, how to stop losing the ones you get, and how the main channels compare on cost, speed, and quality.",
    targetKeyword: "how to get more leads as a contractor",
    secondaryKeywords: [
      "lead generation for contractors",
      "lead generation companies for contractors",
      "lead generation for construction companies",
      "how to get more leads in construction",
    ],
    eyebrow: "Guide",
    intro:
      "Most contractors trying to get more leads have a conversion problem rather than a volume problem. Before you buy traffic, it's worth finding out how many opportunities are already slipping through — the answer is usually uncomfortable.",
    answer:
      "The fastest way for most contractors to get more leads is to stop losing the ones they already have: answer or auto-text every missed call, respond to form fills within minutes, and follow up on quotes at least twice. After that, the reliable sources in order of cost-effectiveness are referrals and past customers, an optimised Google Business Profile with steady reviews, local SEO through service and city pages, then paid channels like Local Services Ads. Purchased marketplace leads are the fastest and lowest-quality option, useful mainly for filling slow seasons.",
    updated: "2026-08-09",
    readMinutes: 9,
    blocks: [
      { type: "h2", text: "First: find your leak" },
      {
        type: "p",
        text: "Before adding any new channel, work out what happens to the opportunities you already get. Most contractors have never measured this, and the numbers are usually worse than expected.",
      },
      {
        type: "ol",
        items: [
          "How many calls did you miss last month? Check your phone log. Missed calls in the trades are usually lost jobs — most callers move straight to the next result rather than leaving a voicemail.",
          "How fast do you respond to form fills? Speed to first contact is one of the strongest predictors of who wins the job, frequently outweighing price.",
          "How many quotes did you send that you never followed up on? For most contractors this is the largest single pool of recoverable revenue in the business.",
          "How many past customers have heard from you in the last year? Repeat and referral work is the cheapest revenue there is, and it decays without contact.",
        ],
      },
      {
        type: "callout",
        title: "The cheapest fix in contracting",
        text: "Missed-call text-back — an automatic text sent within seconds of a missed call — costs very little to run and recovers a meaningful share of calls you'd otherwise never hear about again. Set it up before you spend a dollar on ads.",
      },
      { type: "h2", text: "Then: the channels, ranked by cost-effectiveness" },
      { type: "h3", text: "1. Referrals and past customers — cheapest, best quality" },
      {
        type: "p",
        text: "Almost every contractor says referrals are their best source and almost none actively manage them. Ask directly when the job finishes and the customer is happy. Stay in touch two or three times a year — a seasonal maintenance reminder is enough of a reason. Build genuine relationships with adjacent trades, realtors, and designers who see your customers before you do.",
      },
      { type: "h3", text: "2. Google Business Profile — highest return per hour" },
      {
        type: "p",
        text: "For local work this outperforms nearly everything else on effort-to-lead ratio. Complete the profile fully, add real project photos continuously, and build reviews as a fixed step in closing out every job. Map-pack visibility can improve within weeks, not months.",
      },
      { type: "h3", text: "3. Local SEO — slow to start, compounds forever" },
      {
        type: "p",
        text: "One real page per service and per town you serve. It typically takes three to six months to produce steady leads and then keeps producing without further spend. This is the channel that lowers your long-run cost per lead more than any other, and it's the one most contractors abandon two months before it starts working.",
      },
      { type: "h3", text: "4. Google Local Services Ads — fast, verified, pay per lead" },
      {
        type: "p",
        text: "Requires licence and insurance verification, which is itself a filter that keeps competition down. You pay per lead rather than per click and appear above regular search ads. Lead quality varies by trade and market, but for many residential contractors it's the most efficient paid option available.",
      },
      { type: "h3", text: "5. Google Search Ads — immediate, controllable, expensive" },
      {
        type: "p",
        text: "Works when you need calls this month. Requires tight geographic targeting, a solid negative keyword list, and a landing page that matches the search — sending ad traffic to your homepage wastes a large share of the budget. Costs stop producing the day you stop paying.",
      },
      { type: "h3", text: "6. Meta ads — awareness and retargeting" },
      {
        type: "p",
        text: "Colder traffic with a longer path to a job. Best used for retargeting people who already visited your site, and for visual trades where a before-and-after can stop a scroll. Poor fit for urgent-need services.",
      },
      { type: "h3", text: "7. Lead marketplaces — fastest, weakest" },
      {
        type: "p",
        text: "Leads arrive immediately, which is why contractors reach for them in slow months. The trade-off is real: leads are typically sold to several contractors at once, buyers are usually comparing on price, and margins compress. Reasonable as a gap-filler; a poor foundation for a business.",
      },
      { type: "h2", text: "How the channels compare" },
      {
        type: "table",
        head: ["Channel", "Speed", "Cost per lead", "Quality", "Durability"],
        rows: [
          ["Referrals", "Slow to build", "Near zero", "Highest", "High"],
          ["Google Business Profile", "Weeks", "Low", "High", "High"],
          ["Local SEO", "3–6 months", "Low over time", "High", "Highest"],
          ["Local Services Ads", "Days", "Medium", "Medium–high", "Stops when you stop"],
          ["Search Ads", "Days", "Medium–high", "Medium", "Stops when you stop"],
          ["Meta ads", "Weeks", "Medium", "Lower", "Stops when you stop"],
          ["Lead marketplaces", "Immediate", "Medium", "Low", "None"],
        ],
      },
      { type: "h2", text: "Convert more of what arrives" },
      {
        type: "ul",
        items: [
          "Respond within minutes, not hours. This single change usually outperforms any new channel.",
          "Make the first response a real conversation, not an automated 'we received your request'.",
          "Send quotes fast, while the estimate visit is still fresh in their mind.",
          "Follow up two or three times over two weeks. Most contractors never follow up once.",
          "Ask what else they're considering. It surfaces objections you can actually answer.",
          "Make it easy to say yes: clear scope, clear timeline, clear payment terms, and financing if you offer it.",
        ],
      },
      { type: "h2", text: "Track four numbers and nothing else at first" },
      {
        type: "ol",
        items: [
          "Leads by source — you cannot allocate spend without this.",
          "Cost per lead by channel.",
          "Close rate from lead to signed job.",
          "Average job value, so all of the above converts into profit rather than activity.",
        ],
      },
      {
        type: "p",
        text: "Ask every new caller how they found you and write it down. It's unglamorous, it takes ten seconds, and it beats most attribution software available to a business your size.",
      },
    ],
    faqs: [
      {
        q: "Are paid contractor leads worth it?",
        a: "As a supplement in slow periods, sometimes. As a foundation, rarely — leads are typically sold to multiple contractors simultaneously, so you're competing on price from the first phone call. The margin pressure is why most contractors who rely on marketplaces eventually try to build their own lead sources.",
      },
      {
        q: "How do I get construction leads without paying for them?",
        a: "Complete your Google Business Profile and keep it active, build reviews systematically after every job, publish a genuine page for each service and each town you serve, ask past customers for referrals directly, and follow up on old quotes. That's the whole free playbook, and it works — it just takes months rather than days.",
      },
      {
        q: "How many leads does a contractor need?",
        a: "Work backwards from your target. If you need eight jobs a month and close one in four inbound leads, you need around thirty-two leads a month. Knowing your close rate is what makes every marketing decision after this a calculation instead of a guess.",
      },
      {
        q: "What's the fastest way to get contractor leads right now?",
        a: "Google Local Services Ads if you're verified, or Search Ads if you're not — both can produce calls within days. Alongside that, call every customer from the last two years; it costs nothing and routinely surfaces work that was already waiting to happen.",
      },
    ],
    related: [
      "how-to-market-a-construction-company",
      "missed-call-text-back",
      "google-business-profile-for-contractors",
    ],
  },

  /* ------------------------------------------------------------------ 09 */
  {
    slug: "missed-call-text-back",
    title: "Missed Call Text Back for Contractors: How It Works and What It Recovers",
    metaTitle: "Missed Call Text Back for Contractors: How It Works",
    description:
      "What missed call text back is, how it works, what it costs, and why it's one of the highest-return systems a contractor can set up — plus the compliance rules and mistakes to avoid.",
    targetKeyword: "missed call text back",
    secondaryKeywords: [
      "how does missed call text back work",
      "missed call text back cost",
      "missed call text back software",
      "ai receptionist for contractors",
    ],
    eyebrow: "Guide",
    intro:
      "You're on a roof, on a ladder, or under a sink. The phone rings and you can't reach it. For most contractors that call is simply gone — the caller moves down the search results. Missed call text back is the cheapest fix available for the single most expensive habit in the trades.",
    answer:
      "Missed call text back automatically sends an SMS to anyone whose call you don't answer, usually within seconds — typically along the lines of 'Sorry we missed you, we're on a job. What can we help with?' It converts a lost call into a text conversation you can answer between tasks. Setup takes under an hour, it usually runs $20–$100 per month depending on the platform, and for contractors who miss a lot of calls it's routinely the highest-return system in the business.",
    updated: "2026-08-09",
    readMinutes: 6,
    blocks: [
      { type: "h2", text: "The problem it solves" },
      {
        type: "p",
        text: "Contractors miss calls. It isn't negligence — you're working with both hands, in noise, often somewhere you can't safely stop. The issue is what happens next: someone who needs a job done now and reached voicemail generally doesn't leave one. They call the next result. You never learn the call happened.",
      },
      {
        type: "p",
        text: "Voicemail doesn't fix this because people don't leave them anymore, and calling back two hours later frequently reaches someone who's already booked with a competitor.",
      },
      { type: "h2", text: "How it works" },
      {
        type: "ol",
        items: [
          "Someone calls your business number and you don't pick up.",
          "The system detects the missed call, usually within a few seconds.",
          "An automatic SMS goes to that number: an apology, a reason, and a question.",
          "They reply by text — which most people find easier than a voicemail anyway.",
          "You answer when you can safely stop, or someone in the office does.",
          "The conversation stays in one thread, so nothing gets lost between callbacks.",
        ],
      },
      {
        type: "p",
        text: "The mechanism is simple. Its value comes from the fact that texting suits both sides of this exchange better than calling does: the customer doesn't have to explain themselves to a machine, and you don't have to stop what you're doing.",
      },
      { type: "h2", text: "What the message should say" },
      {
        type: "p",
        text: "Three things: acknowledge the miss, give a human reason, and ask a question that's easy to answer.",
      },
      {
        type: "ul",
        items: [
          "\"Sorry we missed your call — we're on a job site. What can we help you with? We'll reply as soon as we're off the roof. — [Company]\"",
          "Always include the company name. An unexpected text from an unknown number gets ignored or reported.",
          "Ask one specific question. 'What can we help with?' outperforms 'We'll call you back.'",
          "Keep it under about 160 characters so it lands as a single message.",
          "Don't sound automated. 'Your call is important to us' reads as a machine and gets no reply.",
        ],
      },
      {
        type: "callout",
        title: "Set the expectation you can actually meet",
        text: "If you'll reply in an hour, say an hour. Promising an immediate response and then going quiet for four hours is worse than the missed call was.",
      },
      { type: "h2", text: "What it costs" },
      {
        type: "table",
        head: ["Option", "Typical cost", "Notes"],
        rows: [
          [
            "Built into an existing CRM or phone system",
            "Often included",
            "Check what you already pay for before buying anything",
          ],
          [
            "Standalone missed-call text service",
            "$20 – $50/mo",
            "Simple, quick to configure, does one job well",
          ],
          [
            "All-in-one contractor CRM",
            "$100 – $400/mo",
            "Includes pipeline, follow-up automation, review requests",
          ],
          [
            "AI receptionist / answering service",
            "$100 – $500/mo",
            "Handles the conversation, qualifies, and books — the next step up",
          ],
        ],
      },
      {
        type: "p",
        text: "Market ranges, not our pricing. Against an average job value in the thousands, the arithmetic is not close — one recovered job typically pays for years of the service.",
      },
      { type: "h2", text: "Rules to follow" },
      {
        type: "p",
        text: "Automated business texting is regulated in the US. The essentials for a contractor:",
      },
      {
        type: "ul",
        items: [
          "Register your number for A2P 10DLC through your provider. Unregistered business texts increasingly get filtered before delivery.",
          "Identify your business in the first message. Anonymous automated texts get reported as spam.",
          "Honour opt-outs. STOP must work, and your platform should handle it automatically.",
          "Replying to someone who called you is generally the lowest-risk category of business text — they initiated contact. Marketing blasts are a different matter with stricter rules.",
          "Keep messages relevant to the call. Don't append promotions to a service reply.",
        ],
      },
      { type: "h2", text: "The step beyond it" },
      {
        type: "p",
        text: "Missed call text back starts the conversation but still needs you to finish it. If you're missing enough calls that the replies pile up unanswered, the next step is an AI receptionist that answers questions, qualifies the job, captures details, and books the appointment — handing over to you only when there's a real conversation to have.",
      },
      {
        type: "p",
        text: "That's a bigger commitment and worth it at higher call volumes. For most contractors, plain missed-call text-back captures the majority of the available gain for a fraction of the effort. Start there.",
      },
    ],
    faqs: [
      {
        q: "How does missed call text back work?",
        a: "Your phone system detects a call you didn't answer and automatically sends an SMS to that number within seconds, usually apologising and asking what they need. The caller replies by text and you continue the conversation when you're able to stop working.",
      },
      {
        q: "How much does missed call text back cost?",
        a: "Standalone services typically run $20–$50 per month. It's often already included in contractor CRMs and modern business phone systems, so check what you're paying for before adding another subscription.",
      },
      {
        q: "Is missed call text back legal?",
        a: "In the US, replying by text to someone who just called your business is generally permitted, since they initiated contact. You do need to register your number for A2P 10DLC through your provider, identify your business in the message, and honour STOP requests. Unsolicited marketing texts fall under stricter rules.",
      },
      {
        q: "Is it worth it for a small contractor?",
        a: "If you miss even a few calls a month and your average job is worth thousands, yes — the maths works after a single recovered job. It's most valuable for solo operators and small crews with nobody in an office to answer the phone.",
      },
    ],
    related: [
      "how-to-get-more-leads-as-a-contractor",
      "how-to-market-a-construction-company",
      "how-to-choose-a-marketing-agency",
    ],
  },

  /* ------------------------------------------------------------------ 10 */
  {
    slug: "how-to-choose-a-marketing-agency",
    title: "How to Choose a Marketing Agency: 12 Questions That Reveal the Truth",
    metaTitle: "How to Choose a Marketing Agency (12 Questions)",
    description:
      "How to choose a marketing agency or web design company without getting burned — the questions that expose weak proposals, the contract terms that matter, and the warning signs to walk away from.",
    targetKeyword: "how to choose a marketing agency",
    secondaryKeywords: [
      "questions to ask a web design agency",
      "how to choose a digital marketing agency",
      "how to choose the right marketing agency",
      "how do marketing agencies charge",
    ],
    eyebrow: "Guide",
    intro:
      "Every agency's pitch sounds the same, which is exactly why choosing one feels like a coin flip. These twelve questions separate the ones doing real work from the ones with a good deck — and most of them can be answered in a single call.",
    answer:
      "The most revealing questions to ask a marketing agency are: what will you actually do in month one, who specifically does the work, can I see three live examples in my industry, what do you report on, do I own everything, and what happens if I leave. Vague answers on ownership, deliverables, or reporting are the clearest predictor of a poor engagement. Agencies that lead with guaranteed rankings, long lock-in contracts, or reporting built on impressions rather than leads should be avoided.",
    updated: "2026-08-09",
    readMinutes: 7,
    blocks: [
      { type: "h2", text: "Before you talk to anyone: decide what you're buying" },
      {
        type: "p",
        text: "The most common cause of a bad agency relationship isn't a bad agency — it's an undefined goal. 'More leads' isn't a brief. 'Twelve additional bathroom remodel inquiries a month from within thirty minutes of our shop' is one, and it immediately tells you whether a proposal is relevant.",
      },
      {
        type: "p",
        text: "Know three numbers before the first call: your average job value, your close rate on inbound leads, and how many more jobs a month you can actually deliver. Without those you cannot evaluate any proposal, and you'll end up choosing on price.",
      },
      { type: "h2", text: "The twelve questions" },
      { type: "h3", text: "1. What will you do in the first 30 days, specifically?" },
      {
        type: "p",
        text: "You want a list of concrete actions, not 'discovery and strategy'. Vagueness this early rarely improves after the contract is signed.",
      },
      { type: "h3", text: "2. Who does the work, and where are they?" },
      {
        type: "p",
        text: "Ask whether the person you're speaking to will be involved after the sale. Salespeople who vanish at signing are common. Subcontracting isn't automatically bad — undisclosed subcontracting is.",
      },
      { type: "h3", text: "3. Can I see three live sites or campaigns in my industry?" },
      {
        type: "p",
        text: "Live URLs, not screenshots or mockups. Then actually open them on your phone. If a web design agency's own client sites are slow or awkward on mobile, you've learned everything you need.",
      },
      { type: "h3", text: "4. What will you report on, and how often?" },
      {
        type: "p",
        text: "The right answer leads with leads, calls, and cost per lead. Reports that lead with impressions, rankings, or 'engagement' are measuring effort rather than outcome.",
      },
      { type: "h3", text: "5. Do I own the website, the domain, and the accounts?" },
      {
        type: "p",
        text: "Get this in writing. Your domain, hosting, Google Business Profile, Analytics, Search Console, and ad accounts should all be in your name with you as owner. Agencies holding these hostage is a real and recurring problem in this industry.",
      },
      { type: "h3", text: "6. What happens if I leave in six months?" },
      {
        type: "p",
        text: "Can you take the site with you? Do you keep the content? Is there an exit fee? Ask while they're still selling to you, because the answer is much harder to get later.",
      },
      { type: "h3", text: "7. How do you charge, and what's not included?" },
      {
        type: "p",
        text: "Agencies bill by monthly retainer, project fee, hourly, or performance. Retainers dominate. The critical follow-up is what falls outside scope — content, photography, ad spend, and extra pages are the usual surprises.",
      },
      { type: "h3", text: "8. Is ad spend included in that number?" },
      {
        type: "p",
        text: "Often it isn't, and a $2,000 quote quietly becomes $5,000 all-in. Establish management fee versus media spend explicitly, in writing.",
      },
      { type: "h3", text: "9. What do you need from me?" },
      {
        type: "p",
        text: "Honest agencies will tell you: photographs, review requests, quick approvals, availability for a monthly call. Anyone claiming they need nothing from you is either not doing much or about to publish content about your business without your input.",
      },
      { type: "h3", text: "10. What results should I realistically expect, and when?" },
      {
        type: "p",
        text: "Good answers include ranges, caveats, and timelines measured in months. Anyone guaranteeing rankings or a specific lead count is either guessing or lying — nobody controls Google's results.",
      },
      { type: "h3", text: "11. What's the contract length and how do I get out?" },
      {
        type: "p",
        text: "Six to twelve months is normal for SEO because the work takes that long to compound. Twelve months with no performance clause and a punitive exit is not normal. Ask specifically what happens if they simply stop delivering.",
      },
      { type: "h3", text: "12. Can I speak to a current client?" },
      {
        type: "p",
        text: "Not a testimonial — an actual phone call. Reluctance here tells you a great deal. When you get the call, ask what's gone wrong and how it was handled, which is far more informative than asking whether they're happy.",
      },
      {
        type: "callout",
        title: "The single best filter",
        text: "Ask what they'd do first if they were in your position and had a limited budget. Agencies that answer honestly — sometimes 'fix your Google Business Profile and don't hire us yet' — are the ones worth hiring.",
      },
      { type: "h2", text: "Walk away if you see these" },
      {
        type: "ul",
        items: [
          "Guaranteed rankings or a guaranteed number one position.",
          "Pressure to sign today, or a discount that expires this week.",
          "They won't give you owner access to your own accounts.",
          "Portfolio work they can't prove they did.",
          "Reporting that never mentions leads or revenue.",
          "No questions about your business before presenting a proposal.",
          "Pricing far below market — the work simply won't be there.",
          "Cold outreach claiming urgent problems with your site. That's a script, not an audit.",
        ],
      },
      { type: "h2", text: "How agencies charge" },
      {
        type: "table",
        head: ["Model", "Typical range", "Works well when"],
        rows: [
          [
            "Monthly retainer",
            "$1,000 – $7,500/mo",
            "Ongoing SEO, content, and social — the dominant model",
          ],
          [
            "Project fee",
            "$3,000 – $25,000+",
            "A website build, rebrand, or one-off audit",
          ],
          ["Hourly", "$75 – $250/hr", "Small, defined tasks or consulting"],
          [
            "Performance / per lead",
            "Varies widely",
            "Rare and hard to structure fairly; check what counts as a lead",
          ],
        ],
      },
      {
        type: "p",
        text: "Market ranges for 2026. Price alone tells you very little — what matters is what's being done each month for it, and whether anyone can describe that in specific terms.",
      },
    ],
    faqs: [
      {
        q: "How much should I pay a marketing agency?",
        a: "Retainers commonly run $1,000–$7,500 per month for small businesses, and website projects $3,000–$25,000+. The better test than any benchmark: what is one additional job worth to you, and how many extra jobs would this need to produce to pay for itself?",
      },
      {
        q: "What questions should I ask a web design agency?",
        a: "Who writes the copy, how many pages are included, will I own the site, what's the timeline, what happens after launch, and can I see three live sites you've built in my industry. The copy question is the one that most often exposes a hidden cost or a stalled project.",
      },
      {
        q: "Should I hire a local agency or one anywhere?",
        a: "For most digital work, location doesn't matter and remote agencies are perfectly capable. Local helps when someone needs to physically capture photography or video of your work, and when you want in-person accountability. Industry experience matters far more than proximity.",
      },
      {
        q: "How long should I give an agency before judging results?",
        a: "For paid ads, 60–90 days. For SEO and content, six months minimum before assessing outcomes — though you should see clear evidence of work within the first month. If month one is quiet, that's a problem regardless of the channel.",
      },
    ],
    related: [
      "seo-cost-for-contractors",
      "contractor-website-cost",
      "how-to-market-a-construction-company",
    ],
  },
];

export function getGuide(slug: string): Guide | undefined {
  return guides.find((g) => g.slug === slug);
}
