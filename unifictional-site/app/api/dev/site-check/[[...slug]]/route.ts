// @ts-nocheck
// GET /api/dev/site-check[/<page slug>][?menu=menu-6&hero=hero-zoom&mode=dark&logo=1]
// Development only. Renders a sample multi-page spec (home, about, services,
// services/decks, work, reviews, contact) through the real renderer so the
// page frame, links between pages, logo handling, footer, contact block and
// schema can be checked without a model call.
import { NextResponse } from "next/server";

import { renderPage, pageList } from "@/lib/build/renderer";
import { resolveImages, navImages } from "@/lib/build/images";
import { byType } from "@/lib/build/components";
import { schemaForPage } from "@/lib/build/seo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ slug?: string[] }> }) {
  if (process.env.NODE_ENV === "production") return new NextResponse("Not found", { status: 404 });
  const { slug } = await ctx.params;
  const page = (slug || []).join("/") || "index";
  const url = new URL(req.url);
  const menu = url.searchParams.get("menu") || "menu-8";
  const heroType = url.searchParams.get("hero") || "hero-split";
  const dark = url.searchParams.get("mode") === "dark";
  const withLogo = url.searchParams.get("logo") !== "0";

  const heroComp = byType[heroType];
  const hero = heroComp ? { ...JSON.parse(heroComp.fields), type: heroType, headline: "Decks that still look right in year ten", sub: "Cedar and composite decks, pergolas and fences for homeowners in Bothell and the Eastside.", cta: { label: "Get a deck quote", href: "contact" }, word: "STRAIGHT" } : null;
  if (hero && Array.isArray(hero.images)) hero.images = hero.images.map((im, i) => ({ query: ["finished composite deck at dusk", "cedar deck detail", "pergola over patio"][i % 3], alt: "" }));
  if (hero && Array.isArray(hero.slides)) hero.slides = ["Decks", "Pergolas", "Fences"].map((t, i) => ({ query: ["finished composite deck at dusk", "pergola over patio", "privacy fence along a garden"][i], alt: "", title: t, text: "Built on the Eastside since 2014." }));
  if (hero && hero.image) hero.image = { query: "finished composite deck at dusk", alt: "" };

  const spec: any = {
    brand: { name: "Delgado Deck & Fence", tagline: "Decks, pergolas and fences on the Eastside", industry: "Deck builder", city: "Bothell, WA", serviceArea: "Bothell, Woodinville, Kirkland, Redmond", phone: "(425) 555-0142", email: "hello@delgadodeck.com", address: "18301 Bothell Way NE, Bothell, WA 98011", hours: "Mon–Fri 7am–5pm", licence: "WA Lic DELGADF123AB", domain: "delgadodeck.com", social: { instagram: "https://instagram.com/delgadodeck", google: "https://g.page/delgadodeck" },
      logo: withLogo ? { url: "https://unifictional.com/showcase/blue-lake-construction.svg", kind: "img", onDark: "pill", icon: "https://unifictional.com/icon.svg" } : undefined },
    theme: { mode: dark ? "dark" : "light", accent: "#B5522A", pair: "oswald" },
    nav: { menu, links: [{ label: "Services", href: "services" }, { label: "Work", href: "work" }, { label: "About", href: "about" }, { label: "Reviews", href: "reviews" }, { label: "Contact", href: "contact" }], cta: { label: "Get a quote", href: "contact" } },
    footer: { blurb: "Family run since 2014. Licensed and bonded in Washington.", columns: [{ title: "Services", links: [{ label: "Custom decks", href: "services/decks" }, { label: "Pergolas", href: "services/pergolas" }] }, { title: "Company", links: [{ label: "About", href: "about" }, { label: "Reviews", href: "reviews" }, { label: "Contact", href: "contact" }] }] },
    pages: [
      { slug: "index", title: "Home", seo: { title: "Deck Builder in Bothell, WA | Delgado Deck & Fence", description: "Custom cedar and composite decks, pergolas and fences across the Eastside since 2014. Licensed, bonded, two crews, most decks done in under two weeks." }, sections: [
        hero,
        { type: "marquee", items: ["Composite decks", "Cedar decks", "Pergolas", "Privacy fences", "Railings"] },
        { type: "statement", label: "Why people call us", text: "We show up when we say we will, and the lines are straight. That is the whole business, and it is why most of our work comes from neighbours." },
        { type: "services", title: "What we build", intro: "Four things, done properly.", items: [{ title: "Custom decks", text: "Cedar and composite, engineered for Washington rain.", href: "services/decks" }, { title: "Pergolas", text: "Shade structures sized to the deck.", href: "services/pergolas" }, { title: "Privacy fences", text: "Cedar and composite fences that stay straight.", href: "services/fences" }] },
        { type: "testimonials", title: "What clients say", items: [{ quote: "On time every single day and the deck is perfect.", name: "Karen M.", role: "Google review" }, { quote: "Second deck they have built for us.", name: "Tom R.", role: "Google review" }] },
        { type: "faq", title: "Questions", items: [{ q: "How long does a deck take?", a: "Most decks are done in under two weeks once permits are in." }] },
        { type: "cta", headline: "Let's talk about your deck", sub: "Call (425) 555-0142 or send the details below.", button: { label: "Get a quote", href: "contact" } },
      ].filter(Boolean) },
      { slug: "about", title: "About Delgado Deck & Fence", intro: "Family run since 2014, two crews, licensed and bonded in Washington.", seo: {}, sections: [
        { type: "text", eyebrow: "The company", title: "Started with one truck in 2014", paragraphs: ["Marco Delgado started the company after ten years framing houses on the Eastside.", "Today two crews build decks, pergolas and fences from Bothell to Redmond."], items: ["WA Lic DELGADF123AB", "Bonded and insured", "Two full-time crews"], image: { query: "crew framing a cedar deck", alt: "" } },
        { type: "stats", items: [{ value: "12", label: "years in business" }, { value: "340+", label: "decks built" }, { value: "4.9", label: "Google rating" }] },
        { type: "cta", headline: "Meet the crew on site", sub: "", button: { label: "Book a visit", href: "contact" } },
      ] },
      { slug: "services", title: "Services", intro: "Everything we build, with a page for each.", seo: {}, sections: [
        { type: "services", title: "Services", items: [{ title: "Custom decks", text: "Cedar and composite.", href: "services/decks" }, { title: "Pergolas", text: "Shade that matches the deck.", href: "services/pergolas" }, { title: "Privacy fences", text: "Straight, level, lasting.", href: "services/fences" }] },
        { type: "cta", headline: "Not sure what you need?", sub: "", button: { label: "Ask us", href: "contact" } },
      ] },
      { slug: "services/decks", title: "Custom decks", intro: "Cedar and composite decks built for Washington weather.", seo: {}, sections: [
        { type: "text", eyebrow: "Custom decks", title: "Built for rain, sized for the house", paragraphs: ["We build in cedar and in Trex and TimberTech composite.", "Most decks take 8 to 12 working days once the permit is in."], items: ["Trex and TimberTech certified", "Permits handled", "Ten-year workmanship warranty"], cta: { label: "See the work", href: "work" } },
        { type: "gallery", title: "Recent decks", intro: "", items: Array.from({ length: 6 }, (_, i) => ({ title: `Deck ${i + 1}`, meta: "Bothell", query: "finished composite deck" })) },
        { type: "faq", title: "Deck questions", items: [{ q: "Cedar or composite?", a: "Cedar is cheaper up front; composite costs more and needs no staining." }] },
        { type: "cta", headline: "Get a deck quote", sub: "", button: { label: "Get a quote", href: "contact" } },
      ] },
      { slug: "work", title: "Work", intro: "Decks, pergolas and fences across the Eastside.", seo: {}, sections: [
        { type: "pile", headline: "Straight lines, every time", images: Array.from({ length: 4 }, () => ({ query: "deck", alt: "" })) },
        { type: "gallery", title: "Selected work", items: Array.from({ length: 8 }, (_, i) => ({ title: `Project ${i + 1}`, meta: "Eastside", query: "deck" })) },
      ] },
      { slug: "reviews", title: "Reviews", intro: "What clients say about working with us.", seo: {}, sections: [
        { type: "testimonials", items: [{ quote: "On time every day.", name: "Karen M.", role: "Google review" }, { quote: "Second deck they built for us.", name: "Tom R.", role: "Google review" }, { quote: "Straight fence, fair price.", name: "Ana P.", role: "Yelp review" }] },
        { type: "cta", headline: "Join them", sub: "", button: { label: "Get a quote", href: "contact" } },
      ] },
      { slug: "contact", title: "Contact", intro: "Call, email or send the details below.", seo: {}, sections: [
        { type: "contact", headline: "Let's talk about your project", sub: "We reply by the next business day and come out to measure within the week.", formNote: "No spam. We call once." },
        { type: "faq", title: "Before you call", items: [{ q: "Do you charge for estimates?", a: "No. Estimates are free within our service area." }] },
      ] },
    ],
    rationale: "Sample site.",
  };
  resolveImages(spec.pages, "landscaping", []);
  navImages(spec, [], "landscaping");
  for (const p of spec.pages) { p.seo = p.seo || {}; p.seo.schema = schemaForPage(spec, p); }
  const pg = pageList(spec).find(p => p.slug === page);
  if (!pg) return NextResponse.json({ error: `no page ${page}`, pages: spec.pages.map(p => p.slug) }, { status: 404 });
  const html = renderPage(spec, pg, { base: "/api/dev/site-check" });
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
