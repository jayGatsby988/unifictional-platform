/* =====================================================================
   Unifictional Studio · engine.js  (the local engine)
   Produces a SITE SPEC (see renderer.js) without a model: from a URL
   analysis or from a short written brief. It is the fallback when no
   ANTHROPIC_API_KEY is configured, and the schema reference the Claude
   pipeline is prompted against. Also: image resolution, pack picks and
   simple chat-edit patches.
   ===================================================================== */

/* ----------------------------------------------------------- images */
const U = (id) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&q=80&w=1600`;
export const IMAGES = {
  construction: ["1564013799919-ab600027ffc6", "1542621334-a254cf47733d", "1503387762-592deb58ef4e", "1521791136064-7986c2920216", "1600585154340-be6161a56a0c", "1600210492486-724fe5c67fb0", "1568605114967-8130f3a36994", "1593696140826-c58b021acf8b", "1486325212027-8081e485255e", "1504384308090-c894fdcc538d"],
  interior: ["1497366216548-37526070297c", "1505691938895-1758d7feb511", "1493809842364-78817add7ffb", "1586023492125-27b2c045efd7", "1600607687939-ce8a6c25118c", "1600566753190-17f0baa2a6c3", "1502672260266-1c1ef2d93688", "1554995207-c18c203602cb", "1505693416388-ac5ce068fe85", "1556228720-195a672e8a03"],
  kitchen: ["1556911220-bff31c812dba", "1556912173-3bb406ef7e77", "1556909114-f6e7ad7d3136", "1600566753190-17f0baa2a6c3"],
  pools: ["1572331165267-854da2b10ccc", "1575429198097-0414ec08e8cd", "1505691938895-1758d7feb511", "1600607687939-ce8a6c25118c"],
  roofing: ["1632759145351-1d592919f522", "1605276374104-dee2a0ed3cd6", "1564013799919-ab600027ffc6", "1568605114967-8130f3a36994"],
  landscaping: ["1558904541-efa843a96f01", "1592150621744-aca64f48394a", "1441974231531-c6227db76b6e", "1506905925346-21bda4d32df4"],
  restaurant: ["1517248135467-4c7edcad34c4", "1414235077428-338989a2e8c0", "1555396273-367ea4eb4db5", "1495474472287-4d71bcdd2085", "1509042239860-f550ce710b93"],
  fitness: ["1534438327276-14e5300c3a48", "1571019613454-1cb2f99b2d8b", "1522071820081-009f0129c71c"],
  tech: ["1497215728101-856f4ea42174", "1486312338219-ce68d2c6f44d", "1551434678-e076c223a692", "1460925895917-afdab827c52f", "1522071820081-009f0129c71c", "1556761175-5973dc0f32e7"],
  beauty: ["1560066984-138dadb4c035", "1522337660859-02fbefca4702", "1583847268964-b28dc8f51f92"],
  realestate: ["1570129477492-45c003edd2be", "1512917774080-9991f1c4c750", "1486406146926-c627a92ad1ab", "1600585154340-be6161a56a0c"],
  medical: ["1629909613654-28e377c37b09", "1588776814546-1ffcf47267a5", "1497366216548-37526070297c"],
  law: ["1589829545856-d10d557cf95f", "1521587760476-6c12a4b040da", "1497366216548-37526070297c"],
  product: ["1523275335684-37898b6baf30", "1505740420928-5e560c06d30e", "1583847268964-b28dc8f51f92"],
  photography: ["1452587925148-ce544e77e70d", "1516035069371-29a1b244cc32", "1565182999561-18d7dc61c393"],
  generic: ["1565182999561-18d7dc61c393", "1571055107559-3e67626fa8be", "1583847268964-b28dc8f51f92", "1497366216548-37526070297c"],
};

/* ------------------------------------------------------- industries */
export const INDUSTRIES = {
  construction: { label: "General contractor", kw: ["contractor", "construction", "builder", "build", "building", "remodel", "renovation", "custom home", "framing", "general contracting"], img: "construction", pair: "oswald", mode: "dark", accent: "#E8C547", word: "BUILT",
    services: [["Custom homes", "Ground-up builds managed from permit to keys, on one schedule you can actually read."], ["Whole-home remodels", "Kitchens, baths and additions that respect the house and the budget."], ["Commercial build-outs", "Tenant improvements delivered on the date the lease says."], ["Design-build", "One contract, one team, one point of contact from sketch to punch list."], ["Additions & ADUs", "More square footage without the chaos. Permits handled."], ["Repairs & maintenance", "Same crew, same standards, for the small jobs too."]] },
  roofing: { label: "Roofing", kw: ["roof", "roofing", "shingle", "gutter", "siding", "exterior"], img: "roofing", pair: "grotesk", mode: "dark", accent: "#FF6A3D", word: "COVERED",
    services: [["Roof replacement", "Full tear-off and replacement, with a warranty you will not need."], ["Storm & leak repair", "Fast diagnosis, honest scope, no upsell."], ["Siding & exteriors", "Fiber cement, cedar and metal, installed to last."], ["Gutters", "Seamless systems sized for real rain."], ["Inspections", "Written reports with photos, before you buy or sell."], ["Commercial roofing", "TPO, metal and flat systems for working buildings."]] },
  pools: { label: "Pool construction", kw: ["pool", "pools", "spa", "swim", "swimming", "hot tub", "poolworks"], img: "pools", pair: "syne", mode: "light", accent: "#0E7C86", word: "POOLS",
    services: [["Custom pool design", "3D plans you can walk through before a shovel moves."], ["Construction", "Gunite, fiberglass and vinyl, built by our own crews."], ["Spas & water features", "Heated, lit and quiet."], ["Outdoor living", "Decks, kitchens and shade that make the pool a place."], ["Renovation", "Resurfacing, tile and equipment that bring old pools back."], ["Service", "Weekly care from people who built it."]] },
  remodel: { label: "Kitchen & bath remodeling", kw: ["kitchen", "bath", "bathroom", "cabinet", "countertop", "tile", "remodeling"], img: "kitchen", pair: "serif", mode: "light", accent: "#B5522A", word: "REMADE",
    services: [["Kitchens", "Layouts that work at 7am and at a dinner for twelve."], ["Bathrooms", "Spa-grade finishes on a real-world timeline."], ["Cabinetry", "Custom and semi-custom, fitted by our own installers."], ["Flooring & tile", "Hardwood, porcelain and stone, laid straight."], ["Lighting", "Layered plans that make the finishes look like the sample."], ["Project management", "One lead, one schedule, daily updates."]] },
  landscaping: { label: "Landscaping & hardscape", kw: ["landscap", "hardscape", "lawn", "garden", "patio", "paver", "irrigation"], img: "landscaping", pair: "fraunces", mode: "light", accent: "#3C6E47", word: "GROUND",
    services: [["Landscape design", "Plans drawn for your light, soil and life."], ["Hardscape", "Patios, walls and walkways that stay level."], ["Planting", "Native-forward palettes that look good in year five."], ["Irrigation & lighting", "Smart systems that water less and show more."], ["Outdoor structures", "Pergolas, fire features and kitchens."], ["Maintenance", "Seasonal care by the crew that planted it."]] },
  restaurant: { label: "Restaurant", kw: ["restaurant", "menu", "dinner", "lunch", "chef", "kitchen", "bistro", "cafe", "coffee", "bar", "eatery", "pizza", "sushi", "taco"], img: "restaurant", pair: "serif", mode: "dark", accent: "#E4B363", word: "TABLE",
    services: [["Dinner", "A short menu that changes with the market, served Tuesday to Sunday."], ["Lunch", "Fast without feeling it. Counter and table."], ["Private dining", "A room for twenty, a menu built with you."], ["Events & catering", "The kitchen comes to you."], ["Bar", "Classics, low-ABV and a cellar we are proud of."], ["Gift cards", "The easiest good decision."]] },
  fitness: { label: "Gym & fitness", kw: ["gym", "fitness", "training", "coach", "crossfit", "yoga", "pilates", "studio", "workout"], img: "fitness", pair: "bricolage", mode: "dark", accent: "#D4FF3F", word: "STRONG",
    services: [["Personal training", "Programs written for your body and calendar."], ["Group classes", "Small, coached, never a free-for-all."], ["Strength", "Barbells, racks and the space to use them."], ["Mobility & recovery", "Sauna, cold and guided sessions."], ["Nutrition", "Plans that fit a life, not a photo shoot."], ["Memberships", "Month to month. No contracts, no fine print."]] },
  tech: { label: "Software & SaaS", kw: ["software", "saas", "platform", "app", "api", "cloud", "startup", "ai", "automation", "analytics", "dashboard", "developer"], img: "tech", pair: "grotesk", mode: "dark", accent: "#7C6CFF", word: "SHIP",
    services: [["The platform", "One workspace for the work that used to live in six tabs."], ["Integrations", "Connects to the tools you already pay for."], ["Automation", "Rules that run while you sleep."], ["Analytics", "Numbers you can act on, not dashboards you admire."], ["Security", "SOC 2, SSO and audit logs by default."], ["Support", "Humans, within the hour, on every plan."]] },
  agency: { label: "Marketing & design agency", kw: ["agency", "studio", "brand", "branding", "design", "marketing", "marketing agency", "creative", "web design", "websites", "website design", "seo", "local seo", "social media", "lead system", "google business", "ads", "campaign"], img: "tech", pair: "syne", mode: "light", accent: "#0E0E0E", word: "MADE",
    services: [["Brand", "Identity systems that survive the second designer."], ["Web", "Sites that are fast, found and finished."], ["Content", "Writing and film in a voice that is yours."], ["Campaigns", "Paid and organic, measured by sales."], ["Product design", "Interfaces people stop noticing."], ["Strategy", "Fewer slides, clearer bets."]] },
  beauty: { label: "Salon & beauty", kw: ["salon", "hair", "beauty", "spa", "nails", "lash", "barber", "skin", "esthetic"], img: "beauty", pair: "fraunces", mode: "light", accent: "#C9637A", word: "GLOW",
    services: [["Cut & style", "Precision cuts by stylists who listen first."], ["Color", "Balayage, gloss and corrections done right the first time."], ["Skin", "Facials and treatments with real results."], ["Nails", "Clean, calm, careful."], ["Bridal", "The day you look most like yourself."], ["Membership", "Monthly maintenance, priority booking."]] },
  realestate: { label: "Real estate", kw: ["real estate", "realtor", "homes for sale", "listing", "property", "brokerage", "agent"], img: "realestate", pair: "serif", mode: "light", accent: "#1F3A5F", word: "HOME",
    services: [["Buying", "Neighborhood knowledge and a calm hand at the offer table."], ["Selling", "Pricing, prep and photography that earns the number."], ["Investment", "Cash-flow math before emotion."], ["Relocation", "A soft landing in a new city."], ["Market reports", "Monthly, plain English, no spin."], ["Property management", "Tenants placed, rents collected, calls answered."]] },
  medical: { label: "Clinic & dental", kw: ["dental", "dentist", "clinic", "doctor", "medical", "physio", "chiropract", "orthodont", "health", "wellness"], img: "medical", pair: "grotesk", mode: "light", accent: "#1B998B", word: "CARE",
    services: [["New patients", "Same-week appointments and an honest first visit."], ["Preventive care", "Cleanings, exams and a plan that keeps you out of the chair."], ["Restorative", "Crowns, implants and fillings that match."], ["Cosmetic", "Whitening and veneers that look like you, rested."], ["Emergencies", "Call. We will see you today."], ["Insurance & financing", "Most plans accepted. Payment plans available."]] },
  law: { label: "Law firm", kw: ["law", "attorney", "legal", "lawyer", "counsel", "litigation", "injury"], img: "law", pair: "serif", mode: "dark", accent: "#C8A24A", word: "COUNSEL",
    services: [["Business law", "Formation, contracts and the disputes that follow."], ["Personal injury", "No fee unless we win. Straight answers first."], ["Estate planning", "Wills, trusts and a plan your family can follow."], ["Real estate", "Closings, leases and title problems, resolved."], ["Litigation", "Prepared for trial so it rarely goes there."], ["Family law", "Steady counsel in unsteady times."]] },
  ecommerce: { label: "Product brand", kw: ["shop", "store", "product", "collection", "buy", "cart", "checkout", "apparel", "goods"], img: "product", pair: "bricolage", mode: "light", accent: "#0E0E0E", word: "MADE",
    services: [["The collection", "Few pieces, made properly, restocked rarely."], ["Materials", "Named mills, traceable fibers, no mystery blends."], ["Fit", "Measured in centimeters, explained in words."], ["Shipping & returns", "Free both ways. Thirty days."], ["Repairs", "Send it back, we fix it, you keep it."], ["Wholesale", "Stockists we would shop at ourselves."]] },
  photography: { label: "Photography", kw: ["photograph", "photo", "wedding", "portrait", "videograph", "film"], img: "photography", pair: "serif", mode: "dark", accent: "#F2F1EC", word: "LIGHT",
    services: [["Weddings", "Documentary coverage from first look to last song."], ["Portraits", "Families, founders and the people in between."], ["Commercial", "Product, food and architecture for brands."], ["Editorial", "Stories on assignment."], ["Film", "Short films that sound as good as they look."], ["Prints", "Archival, signed, framed on request."]] },
};

// `head` (title + description) counts four times as much as body text, so a
// marketing agency that writes about contractors still reads as an agency.
export function detectIndustry(text = "", head = "") {
  const score1 = (t) => {
    const out = {};
    for (const [id, ind] of Object.entries(INDUSTRIES)) {
      let s = 0;
      for (const k of ind.kw) { const m = t.match(new RegExp("\\b" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + (k.length <= 5 ? "\\b" : ""), "g")); if (m) s += m.length * (k.length > 6 ? 2 : 1); }
      out[id] = s;
    }
    return out;
  };
  const body = score1(text.toLowerCase()), top = score1(head.toLowerCase());
  let best = "agency", bestScore = 0;
  for (const id of Object.keys(INDUSTRIES)) { const s = Math.min(body[id], 12) + top[id] * 4; if (s > bestScore) { bestScore = s; best = id; } }
  return bestScore ? best : "agency";
}

const STATES = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
const CITY_RE = new RegExp("\\b([A-Z][a-zA-Z.]+(?:\\s[A-Z][a-zA-Z.]+){0,2}),\\s?(" + STATES.join("|") + ")\\b");
export function detectCity(text = "") {
  const m = text.match(CITY_RE);
  if (m) return `${m[1]}, ${m[2]}`;
  const m2 = text.match(/\b(?:in|serving|based in|located in)\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)/);
  return m2 ? m2[1] : "";
}

const titleCase = (s) => s.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
// Brand name: og:site_name wins; otherwise the title segment that matches the
// domain, else the shortest segment that reads like a name, else the domain.
function cleanName(raw = "", domain = "", siteName = "") {
  if (siteName && siteName.length <= 40) return siteName.trim();
  const dom = domain.replace(/^www\./, "").split(".")[0].replace(/[-_]/g, " ").toLowerCase();
  const segs = String(raw).split(/\s[|–—·]\s|\s\|\s|\s[-:]\s/).map(s => s.replace(/\b(home|welcome to|official site|website)\b/gi, "").trim()).filter(Boolean);
  const byDomain = segs.find(s => dom && s.toLowerCase().replace(/[^a-z0-9]/g, "").includes(dom.replace(/[^a-z0-9]/g, "")));
  if (byDomain && byDomain.length <= 40) return byDomain;
  const short = segs.filter(s => s.split(/\s+/).length <= 4 && s.length <= 32 && !/\b(agency|services|company|contractor|marketing|near me)\b/i.test(s)).sort((a, b) => a.length - b.length)[0];
  if (short) return short;
  const n = segs[0] && segs[0].length <= 40 ? segs[0] : dom;
  return titleCase(n) || "Your Business";
}

function pick(arr, n, seed = 0) { const out = []; for (let i = 0; i < n; i++) out.push(arr[(seed + i) % arr.length]); return out; }
export function resolveImages(spec, imgCat) {
  const ids = IMAGES[imgCat] || IMAGES.generic;
  let k = 0;
  // A query that is already a URL (a real photo from the company's site) passes through.
  const next = (q, alt) => /^https?:\/\//i.test(q || "") ? { query: q, alt: alt || "", url: q } : { query: q, alt: alt || q, url: U(ids[k++ % ids.length]) };
  for (const s of spec.sections || []) {
    if (s.image && !s.image.url) s.image = next(s.image.query || spec.brand.industry, s.image.alt);
    if (s.images) s.images = s.images.map(im => im.url ? im : next(im.query, im.alt));
    if (s.type === "gallery") s.items = (s.items || []).map(it => ({ ...it, image: it.image?.url ? it.image : next(it.query || it.title, it.title) }));
  }
  if (spec.nav?.links) spec.nav.links = spec.nav.links.map((l, i) => ({ ...l, image: l.image || { url: U(ids[(i + 2) % ids.length]) } }));
  return spec;
}

/* ------------------------------------------------------------ brief */
export function briefFromAnalysis(a) {
  const blob = [...(a.headings || []), ...(a.nav || []), a.text].filter(Boolean).join(" \n ");
  const head = [a.title, a.description, a.domain].filter(Boolean).join(" ");
  const industry = detectIndustry(blob, head);
  const name = cleanName(a.title, a.domain || "", a.siteName);
  const city = detectCity(head + " " + blob) || a.city || "";
  // Services: short headings that read like offerings, not nav words and not
  // proper nouns (client names in a portfolio), unless they name a service.
  const SERVICE_WORDS = /\b(design|build|remodel|repair|install|service|seo|marketing|website|social|video|lead|booking|cleaning|roofing|siding|plumbing|electric|landscap|paint|floor|kitchen|bath|pool|deck|fence|concrete|excavat|hvac|photo|training|coaching|classes|dinner|lunch|catering|consult|planning|analytics|automation|integration|support)/i;
  const NAV_WORDS = /^(home|about|about us|contact|contact us|blog|faq|faqs|login|menu|privacy|terms|services|industries|guides|work|our work|process|portfolio|projects|reviews|testimonials|pricing|careers|team|news|resources|get started|book|call)$/i;
  const COMPANY = /\b(construction|poolworks|exteriors|builders|llc|inc|co|corp|homes|studio|group|company|brothers|sons|&)\b\.?$/i;
  const properNoun = (h) => (h.split(/\s+/).filter(w => /^[A-Z&]/.test(w)).length >= 2 && !SERVICE_WORDS.test(h)) || COMPANY.test(h);
  let services = [...new Set((a.headings || []).concat(a.nav || []).map(h => h.replace(/[.!?]+$/, "").trim()))]
    .filter(h => h.length > 3 && h.length < 32 && !NAV_WORDS.test(h) && !properNoun(h) && h.split(/\s+/).length <= 4 && !/^(we|our|your|the|a|how|why|what|let)\b/i.test(h))
    .slice(0, 6);
  if (services.length < 4) services = []; // too thin to trust; the industry profile fills in
  const h1 = (a.h1 || [])[0] || "";
  const tagline = h1 && h1.length >= 18 && h1.length <= 90 ? h1 : (a.description && a.description.length <= 90 ? a.description : "");
  const photos = (a.images || []).filter(u => /\.(jpe?g|png|webp|avif)(\?|$)|unsplash|cloudinary|imgix|squarespace|wixstatic|_next\/image/i.test(u)).slice(0, 10);
  return { name, industry, city, services, tagline, description: a.description || "", phone: a.phone || "", email: a.email || "", domain: a.domain || "", photos, source: "url", voice: "direct, confident, plain English" };
}

export function briefFromPrompt(prompt) {
  const industry = detectIndustry(prompt);
  const nameMatch = prompt.match(/(?:called|named|for)\s+["“]?([A-Z][\w&'’.-]*(?:\s+[A-Z&][\w&'’.-]*){0,3})["”]?/)
    || prompt.match(/^["“]?([A-Z][\w&'’.-]*(?:\s+[A-Z&][\w&'’.-]*){0,3})["”]?\s+(?:is|are|builds|makes|sells|offers|provides|does|runs|serves|in)\b/);
  const city = detectCity(prompt);
  return { name: nameMatch ? nameMatch[1].replace(/[.,]$/, "") : `${INDUSTRIES[industry].label} Co.`, industry, city, services: [], tagline: "", source: "prompt", prompt, voice: "direct, confident, plain English" };
}

/* ------------------------------------------------------------- spec */
export function specFromBrief(b, overrides = {}) {
  const ind = INDUSTRIES[b.industry] || INDUSTRIES.agency;
  const name = b.name;
  const city = b.city;
  const where = city ? ` in ${city}` : "";
  const svc = (b.services?.length >= 3 ? b.services.map(s => [titleCase(s), `${titleCase(s)}, done the way we would want it done for our own place.`]) : ind.services).slice(0, 6);
  const first = svc[0][0].toLowerCase();
  const firstTitle = titleCase(svc[0][0]);
  const pair = overrides.pair || ind.pair, mode = overrides.mode || ind.mode, accent = overrides.accent || ind.accent;

  const heroHeadline = {
    construction: `${firstTitle}${where}, built like we are going to live in it.`,
    roofing: `The roof that answers first${where}.`,
    pools: `Pools designed for the way you actually live${where}.`,
    remodel: `Kitchens and baths${where} that make the whole house better.`,
    landscaping: `Outdoor spaces${where} that still look right in year five.`,
    restaurant: `Good food, no theatre${where}.`,
    fitness: `Get strong${where}. Stay that way.`,
    tech: `The work, without the tabs.`,
    agency: `Work that earns the click, the call and the job.`,
    beauty: `Leave looking like yourself, rested.`,
    realestate: `Homes${where}, handled by people who answer the phone.`,
    medical: `Care that explains itself${where}.`,
    law: `Straight answers${where}. Then a plan.`,
    ecommerce: `Few things. Made properly.`,
    photography: `Pictures that still feel like the day.`,
  }[b.industry] || `${name}: the obvious choice${where}.`;

  const sub = b.description && b.description.length > 60 && b.description.length < 200 ? b.description
    : `${name} is a ${ind.label.toLowerCase()}${where}. One team, one point of contact, and a standard we would put our own name on. Because we do.`;

  const spec = {
    brand: { name, tagline: b.tagline || `${ind.label}${where}`, industry: ind.label, industryKey: b.industry, city, phone: b.phone || "", email: b.email || "", domain: b.domain || "", voice: b.voice },
    theme: { mode, accent, pair },
    nav: { links: [{ label: "Services", href: "#services" }, { label: "Work", href: "#work" }, { label: "Process", href: "#process" }, { label: "Reviews", href: "#reviews" }, { label: "Contact", href: "#contact" }], cta: { label: "Get a quote", href: "#contact" } },
    sections: [
      { type: "hero-split", component: "scroll-41", word: ind.word, headline: heroHeadline, sub, cta: { label: b.industry === "restaurant" ? "Reserve a table" : b.industry === "ecommerce" ? "Shop the collection" : "Start a conversation", href: "#contact" }, image: { query: `${ind.img} hero`, alt: `${name}, ${ind.label.toLowerCase()}${where}` } },
      { type: "marquee", items: svc.map(s => s[0]).concat([city || ind.label]) },
      { type: "statement", component: "scroll-61", label: "Why us", text: `Most ${ind.label.toLowerCase().replace(/&/g, "and")} businesses lose work to the one that answers first, not the one that is best. We are built to be both.` },
      { type: "services", title: "What we do", intro: `Everything under one roof, so you only make one call.`, items: svc.map(s => ({ title: s[0], text: s[1] })) },
      // The company's own photos go into the proof pile and the work grid when the source site has enough of them.
      { type: "pile", component: "scroll-47", headline: `Proof over promises.`, images: [1, 2, 3, 4].map(i => ({ query: b.photos?.length >= 4 ? b.photos[i - 1] : `${ind.img} project ${i}`, alt: `${name} project ${i}` })) },
      { type: "gallery", component: "scroll-19", title: "Selected work", intro: `A few recent projects${where}. Ask us for the ones that match yours.`, items: [1, 2, 3, 4, 5, 6].map(i => ({ title: `${firstTitle} ${String(i).padStart(2, "0")}`, meta: `${city || ind.label} · ${2024 + (i % 3)}`, query: b.photos?.length >= 6 ? b.photos[i - 1] : `${ind.img} ${i}` })) },
      { type: "process", title: "How it goes", steps: [["The conversation", "Thirty minutes, zero pressure. We listen, then tell you exactly what we would do, even if that is not us."], ["The plan", "Scope, schedule and a number that does not move unless you move it."], ["The work", "Our own crew, daily updates, a site you could walk a client through."], ["The follow-through", "Punch list, warranty, and a phone that gets answered after the invoice."]].map(s => ({ title: s[0], text: s[1] })) },
      { type: "stats", items: [{ value: "14+", label: "Years in business" }, { value: "320", label: "Projects completed" }, { value: "4.9", label: "Average review" }, { value: "<1h", label: "Reply time, business hours" }] },
      { type: "sentence", component: "scroll-15", text: "Earn the click. Earn the call. Earn the job." },
      { type: "testimonials", items: [{ quote: `They answered on the first ring and showed up when they said. That alone put them ahead of everyone else we called.`, name: "M. Alvarez", role: `Client${where}` }, { quote: `Clear price, clear timeline, no surprises. The ${first} looks better than the rendering.`, name: "J. Whitfield", role: "Homeowner" }, { quote: `We have hired them three times. That is the review.`, name: "R. Okafor", role: "Property manager" }] },
      { type: "faq", title: "Questions, answered", items: [{ q: "How soon can you start?", a: "Most projects start within two to four weeks of a signed plan. Emergencies are same-week." }, { q: "Do you give free estimates?", a: "Yes. A site visit and a written, itemized number. No pressure and no expiry games." }, { q: "Which areas do you serve?", a: `${city ? city + " and the surrounding area" : "Our home region and the surrounding counties"}. If you are not sure, ask.` }, { q: "Are you licensed and insured?", a: "Fully. Licence and insurance certificates are sent with every proposal." }] },
      { type: "cta", headline: `Let’s talk about the ${first}.`, sub: `Thirty minutes, zero pressure. We reply within one business day, by a person.`, button: { label: "Book a call", href: b.domain ? `https://${b.domain}/contact` : "#contact" } },
    ],
    footer: { blurb: `${name}. ${ind.label}${where}. ${svc.slice(0, 3).map(s => s[0]).join(", ")}.`, columns: [{ title: "Services", links: svc.slice(0, 4).map(s => ({ label: s[0], href: "#services" })) }, { title: "Company", links: [{ label: "Work", href: "#work" }, { label: "Process", href: "#process" }, { label: "Reviews", href: "#reviews" }] }, { title: "Contact", links: [{ label: b.phone || "Call us", href: b.phone ? `tel:${b.phone.replace(/\D/g, "")}` : "#contact" }, { label: b.email || "Email us", href: b.email ? `mailto:${b.email}` : "#contact" }] }] },
    seo: { title: "", description: "", keywords: [] },
  };
  return resolveImages(spec, ind.img);
}

/* ---------------------------------------------------- pack picks */
export function packPicks(spec) {
  const used = new Set((spec.sections || []).map(s => s.component).filter(Boolean));
  used.add("menu-8");
  const why = {
    "scroll-41": "Hero: the brand word splits and the photo window opens to full bleed. Says 'premium' in the first second.",
    "menu-8": "Menu: hairline rows with a floating preview image. Doubles as a work index.",
    "scroll-61": "Statement: the sentence fills from grey to ink as you read it.",
    "scroll-47": "Proof: four project photos pile onto the headline, then part to the corners.",
    "scroll-19": "Work grid: staircase layout, each image grows from the corner nearest the last.",
    "scroll-15": "Closing line: letters tumble onto the baseline as the sentence crosses the screen.",
    "text": "Typographic hero with masked line reveal (no pinning, lighter for content-first pages).",
  };
  return [...used].map(id => ({ id, why: why[id] || "Pack component" }));
}

/* ------------------------------------------------- chat edit patch */
const COLORS = { red: "#E63946", orange: "#FF6A3D", amber: "#E8C547", yellow: "#F2D43D", lime: "#D4FF3F", green: "#2DBE6C", teal: "#1B998B", cyan: "#2EC4F1", blue: "#3A7BFF", navy: "#1F3A5F", indigo: "#5B4BFF", purple: "#7C6CFF", violet: "#8B5CF6", pink: "#F25C8F", magenta: "#E040A0", rose: "#C9637A", gold: "#C8A24A", white: "#F2F1EC", black: "#0E0E0E", terracotta: "#B5522A" };
export function applyEdit(spec, instruction) {
  const t = instruction.toLowerCase();
  const out = structuredClone(spec);
  const done = [];
  if (/\b(dark|darker|night)\b/.test(t) && !/\blight(er)?\b/.test(t)) { out.theme.mode = "dark"; done.push("switched to a dark theme"); }
  if (/\b(light|lighter|bright|white background)\b/.test(t) && !/\bdark(er)?\b/.test(t)) { out.theme.mode = "light"; done.push("switched to a light theme"); }
  const hex = t.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/);
  const named = Object.keys(COLORS).find(c => new RegExp(`\\b${c}\\b`).test(t));
  if (hex) { out.theme.accent = "#" + hex[1]; done.push(`accent set to #${hex[1]}`); }
  else if (named && /accent|color|colour|button|highlight|make it/.test(t)) { out.theme.accent = COLORS[named]; done.push(`accent set to ${named}`); }
  const pairs = { serif: "serif", editorial: "serif", classic: "fraunces", fraunces: "fraunces", geometric: "grotesk", grotesk: "grotesk", bold: "bricolage", bricolage: "bricolage", condensed: "oswald", oswald: "oswald", syne: "syne", modern: "syne" };
  const pk = Object.keys(pairs).find(k => new RegExp(`\\b${k}\\b`).test(t));
  if (pk && /font|type|typeface|look|feel/.test(t)) { out.theme.pair = pairs[pk]; done.push(`type changed to the ${pairs[pk]} pair`); }
  const h = instruction.match(/headline (?:to|:)\s*["“']?(.+?)["”']?$/i);
  if (h) { const hero = out.sections.find(s => s.type.startsWith("hero")); if (hero) { hero.headline = h[1]; done.push("headline rewritten"); } }
  const tg = instruction.match(/tagline (?:to|:)\s*["“']?(.+?)["”']?$/i);
  if (tg) { out.brand.tagline = tg[1]; const hero = out.sections.find(s => s.type.startsWith("hero")); if (hero) hero.sub = tg[1]; done.push("tagline rewritten"); }
  const rm = t.match(/\b(remove|delete|drop|hide|get rid of)\s+(?:the\s+)?(\w+)/);
  if (rm) { const key = { faq: "faq", faqs: "faq", stats: "stats", numbers: "stats", marquee: "marquee", ticker: "marquee", testimonials: "testimonials", reviews: "testimonials", quotes: "testimonials", gallery: "gallery", work: "gallery", pile: "pile", proof: "pile", process: "process", steps: "process", sentence: "sentence", statement: "statement" }[rm[2]]; if (key) { const n = out.sections.length; out.sections = out.sections.filter(s => s.type !== key); if (out.sections.length < n) done.push(`removed the ${key} section`); } }
  if (/\b(minimal|simpler|simplify|less|calmer|quieter)\b/.test(t)) { out.sections = out.sections.filter(s => !["marquee", "pile", "sentence", "stats"].includes(s.type)); done.push("stripped the marquee, pile, stats and closing line for a calmer page"); }
  if (/\b(hero)\b.*\b(simple|type|text|static|no pin)\b|\btypographic hero\b/.test(t)) { const i = out.sections.findIndex(s => s.type === "hero-split"); if (i > -1) { const o = out.sections[i]; out.sections[i] = { type: "hero-type", component: "text", eyebrow: out.brand.industry, headline: o.headline.replace(/,\s/, ", / "), sub: o.sub, cta: o.cta, image: o.image }; done.push("swapped to the typographic hero"); } }
  const cm = instruction.match(/\b(?:city|location|area) (?:to|:)\s*([A-Z][\w\s,]+)/);
  if (cm) { out.brand.city = cm[1].trim(); done.push(`location set to ${cm[1].trim()}`); }
  const bm = instruction.match(/\b(?:cta|button) (?:to|:)\s*["“']?(.+?)["”']?$/i);
  if (bm) { out.sections.forEach(s => { if (s.cta) s.cta.label = bm[1]; if (s.button) s.button.label = bm[1]; }); out.nav.cta.label = bm[1]; done.push("buttons relabelled"); }
  return { spec: out, done };
}
