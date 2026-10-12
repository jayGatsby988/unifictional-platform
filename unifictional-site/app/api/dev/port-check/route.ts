// @ts-nocheck
// GET /api/dev/port-check?id=<component id or type>[&mode=dark]
// Development only. Renders a demo page that uses one component (plus the
// default menu) with sample content, so a port can be checked in the browser
// before it is wired into a real build. See lib/build/components/PORTING.md.
import { NextResponse } from "next/server";

import { renderPage } from "@/lib/build/renderer";
import { resolveImages } from "@/lib/build/images";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SAMPLE = {
  headline: "Decks that still look right in year ten",
  sub: "Cedar and composite decks, pergolas and fences for homeowners in Bothell and the Eastside. Two crews, straight lines, done in under two weeks.",
  eyebrow: "Delgado Deck & Fence · Bothell, WA",
  label: "Why people call us",
  text: "We show up when we say we will, and the lines are straight. That is the whole business, and it is why most of our work comes from neighbours of past clients.",
  title: "Work we are proud of",
  intro: "A few of the decks, pergolas and fences we built across the Eastside in the last two years.",
  word: "STRAIGHT",
  quote: "They were on time every single day and the deck is perfect. Already had two neighbours ask who built it.",
  name: "Karen M.", role: "Google review", q: "How long does a deck take?", a: "Most decks are done in under two weeks once permits are in.",
  meta: "Bothell, 2026", value: "12", more: "See the service",
};
const IMG = ["crew framing a cedar deck", "finished composite deck at dusk", "pergola over a patio", "privacy fence along a garden", "deck stairs and railing detail", "lake house deck with a view", "carpenter measuring a board", "family on a new deck", "fence gate close up"];

function fill(v, key, i = 0) {
  if (Array.isArray(v)) {
    if (v.length === 0) return key === "paragraphs" ? [SAMPLE.text, SAMPLE.sub] : [];
    const n = Math.max(v.length, key === "images" ? 4 : key === "items" ? 6 : key === "steps" ? 4 : key === "paragraphs" ? 2 : 1);
    return Array.from({ length: n }, (_, k) => (typeof v[0] === "string" ? `${SAMPLE.title} ${k + 1}` : fill(v[Math.min(k, v.length - 1)], key, k)));
  }
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = fill(val, k, i);
    if ("query" in out && !out.query) out.query = IMG[i % IMG.length];
    if ("alt" in out && !out.alt) out.alt = out.query || "";
    if ("href" in out && !out.href) out.href = "contact";
    if ("label" in out && !out.label) out.label = key === "cta" || key === "button" ? "Get a quote" : SAMPLE.label;
    if ("title" in out && !out.title) out.title = `${["Custom decks", "Pergolas", "Privacy fences", "Deck repair", "Railings", "Outdoor kitchens"][i % 6]}`;
    if ("text" in out && !out.text) out.text = SAMPLE.text;
    if ("quote" in out && !out.quote) out.quote = SAMPLE.quote;
    if ("name" in out && !out.name) out.name = SAMPLE.name;
    if ("role" in out && !out.role) out.role = SAMPLE.role;
    if ("q" in out && !out.q) out.q = SAMPLE.q;
    if ("a" in out && !out.a) out.a = SAMPLE.a;
    if ("meta" in out && !out.meta) out.meta = SAMPLE.meta;
    if ("value" in out && !out.value) out.value = String(12 + i * 37);
    return out;
  }
  if (typeof v === "string" && !v) return SAMPLE[key] ?? `${key} sample`;
  return v;
}

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") return new NextResponse("Not found", { status: 404 });
  const url = new URL(req.url);
  const id = (url.searchParams.get("id") || "").replace(/[^a-z0-9-]/gi, "");
  const dark = url.searchParams.get("mode") === "dark";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // Dynamic import so a component can be checked before it is registered.
  let comp;
  try {
    const mod = await import(`@/lib/build/components/${id}.ts`);
    comp = mod.default || Object.values(mod).find((v: any) => v && v.type && v.html);
  } catch (e) {
    // registered under a type name inside generic.ts?
    try {
      const reg = await import("@/lib/build/components");
      comp = reg.byType[id] || reg.byId[id];
    } catch {}
    if (!comp) return NextResponse.json({ error: `No component file ${id}.ts: ${e?.message || e}` }, { status: 404 });
  }
  if (!comp) return NextResponse.json({ error: "The module did not export a component" }, { status: 500 });
  // An unregistered component is not in the renderer's registry yet: add it for this request.
  try { const reg = await import("@/lib/build/components"); if (!reg.byId[comp.id]) { reg.byId[comp.id] = comp; reg.byType[comp.type] = comp; } } catch {}

  const links = ["services", "work", "about", "reviews", "contact"];
  const spec: any = {
    brand: { name: "Delgado Deck & Fence", tagline: "Decks, pergolas and fences on the Eastside", industry: "Deck builder", city: "Bothell, WA", phone: "(425) 555-0142", email: "hello@delgadodeck.com", domain: "delgadodeck.com", serviceArea: "Bothell, Woodinville, Kirkland" },
    theme: { mode: dark ? "dark" : "light", accent: "#B5522A", pair: "oswald" },
    nav: { menu: comp.kind === "menu" ? comp.id : "menu-8", links: links.map(l => ({ label: l[0].toUpperCase() + l.slice(1), href: l })), cta: { label: "Get a quote", href: "contact" } },
    footer: { blurb: "Family run since 2014. Licensed and bonded in Washington.", columns: [{ title: "Services", links: [{ label: "Custom decks", href: "services/decks" }, { label: "Pergolas", href: "services/pergolas" }] }, { title: "Company", links: [{ label: "About", href: "about" }, { label: "Reviews", href: "reviews" }] }] },
    pages: [],
  };
  const sections = [];
  if (comp.kind === "transition" || comp.kind === "cursor") {
    spec.theme[comp.kind] = comp.id;
    sections.push({ type: "hero-type", component: "hero-type", eyebrow: SAMPLE.eyebrow, headline: `${comp.kind} demo / ${comp.id}`, sub: comp.kind === "transition" ? "Click a nav link or the button: the transition should play, then the next page loads with its entry." : "Move the mouse around: the cursor effect should follow it.", cta: { label: "Go to contact", href: "contact" } }, { type: "services", title: "Hover targets", intro: "", items: [{ title: "Custom decks", text: SAMPLE.text, href: "services/decks" }, { title: "Pergolas", text: SAMPLE.text, href: "services/pergolas" }, { title: "Fences", text: SAMPLE.text, href: "services/fences" }] }, { type: "text", eyebrow: "After", title: "Content below", paragraphs: [SAMPLE.text, SAMPLE.sub] });
  } else if (comp.kind !== "menu") {
    let section;
    try { section = fill(JSON.parse(comp.fields), "section"); } catch (e) { return NextResponse.json({ error: `fields is not valid JSON: ${e.message}` }, { status: 500 }); }
    section.type = comp.type; section.component = comp.id;
    if (comp.kind === "hero") sections.push(section);
    else sections.push({ type: "hero-type", component: "hero-type", eyebrow: SAMPLE.eyebrow, headline: "Demo page / for " + comp.id, sub: "Scroll down to the component under test.", cta: { label: "Get a quote", href: "contact" } }, section);
    sections.push({ type: "text", eyebrow: "After", title: "Content below the component", paragraphs: [SAMPLE.text, SAMPLE.sub] });
  } else {
    sections.push({ type: "hero-type", component: "hero-type", eyebrow: SAMPLE.eyebrow, headline: "Menu demo / open the menu", sub: "Use the burger top right. Esc closes it.", cta: { label: "Get a quote", href: "contact" } }, { type: "text", eyebrow: "After", title: "Content below", paragraphs: [SAMPLE.text, SAMPLE.sub] });
  }
  // &video=frames | mp4 : exercise hero-video-scrub with the local sample clip (public/dev-hero, 150 jpg frames) or the mp4 scrub fallback
  const vmode = url.searchParams.get("video");
  if (vmode === "frames") spec.video = { status: "ready", mode: "frames", base: "/dev-hero", count: 150, tiers: ["1280", "1920"], ext: "jpg", fps: 30, aspect: 16 / 9, poster: "/dev-hero/1920/0001.jpg" };
  else if (vmode === "mp4") spec.video = { status: "ready", mode: "video", mp4: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4", poster: "/dev-hero/1920/0001.jpg", aspect: 16 / 9 };
  spec.pages = [{ slug: "index", title: "Demo", seo: { title: `Port check: ${comp.id}`, description: comp.describe }, sections }];
  resolveImages(spec.pages[0], "construction");
  const html = renderPage(spec, spec.pages[0], { base: `/api/dev/port-check?id=${id}&p=` });
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
