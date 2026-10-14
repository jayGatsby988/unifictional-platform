/**
 * Landing-page copy and configuration. Every figure here is either a product
 * fact or derived from the real catalog / price book at render time.
 */
import { DEFAULT_SELECTIONS } from '@/lib/materials/catalog';

export const STUDIO_HREF = '/studio';
/** The studio always opens in a new tab, so this page stays open behind it. */
export const opensStudio = (href: string) => (href.startsWith('/studio') ? ({ target: '_blank', rel: 'noopener' } as const) : {});
/** Enterprise contact. Confirm this mailbox exists before launch (see integration notes). */
export const CONTACT_EMAIL = 'hello@unifictional.com';
/** The agency that owns the studio: every header and footer links back. */
export const UNIFICTIONAL_HREF = 'https://unifictional.com';
export const BOOK_CALL_HREF = 'https://unifictional.com/contact';
/** The hero section's id; the nav measures it to know when it has scrolled off the black. */
export const HERO_ID = 'lp-hero';

export const NAV_LINKS = [
  { label: 'How it works', href: '#how' },
  { label: 'Materials', href: '#materials' },
  { label: 'Rooms', href: '#rooms' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
] as const;

export const DEMO = {
  before: {
    src: '/demo/kitchen-before.jpg',
    alt: "Client's photo of an L-shaped kitchen with grey shaker cabinets, a slate-blue island, white quartz counters and a marble mosaic backsplash",
  },
  after: {
    src: '/demo/kitchen-after.jpg',
    alt: 'Unifictional 3D Studio photoreal render of the same kitchen from the same camera angle, now with navy shaker cabinets, Calacatta quartz and white subway tile',
  },
} as const;

/** Catalog ids that describe what is visible in the demo photo (rebuild the existing look). */
export const BEFORE_SELECTIONS: Record<string, string> = {
  ...DEFAULT_SELECTIONS.kitchen,
  cabinets_base: 'cab-dorian-gray',
  cabinets_upper: 'cab-dorian-gray',
  cabinets_tall: 'cab-dorian-gray',
  island_cabinets: 'cab-smoky-blue',
  countertop: 'ct-white-quartz',
  island_countertop: 'ct-white-quartz',
  backsplash: 'tile-marble-mosaic',
  hardware: 'fin-matte-black',
  faucet: 'fin-matte-black',
  lighting_fixture: 'light-pendant-glass',
};

/** The three swaps (plus brass pulls) that produced the demo render. */
export const AFTER_SELECTIONS: Record<string, string> = {
  ...BEFORE_SELECTIONS,
  cabinets_base: 'cab-hale-navy',
  cabinets_upper: 'cab-hale-navy',
  cabinets_tall: 'cab-hale-navy',
  island_cabinets: 'cab-hale-navy',
  countertop: 'ct-calacatta-quartz',
  island_countertop: 'ct-calacatta-quartz',
  backsplash: 'tile-subway-white',
  hardware: 'fin-brushed-brass',
};

export const EXAMPLE_REGION = 'seattle';
export const EXAMPLE_REGION_LABEL = 'Seattle';

/** The film behind the first screen. Drop a new export at a NEW path (the
 *  file is cached immutable) and point these at it. The poster is the frame
 *  the page paints before the film arrives, and the whole hero under
 *  reduced motion. */
export const HERO_VIDEO = {
  mp4: '/hero/studio-demo.mp4',
  poster: '/hero/studio-demo-poster.jpg',
} as const;

export const HERO = {
  topLeft: 'Unifictional · 3D Studio',
  topRight: 'Built for contractors',
  eyebrow: 'Photo → 3D twin → priced redesign',
  /** Rendered uppercase by the display face; every line is white, like the site. */
  headline: [{ text: "Your client's kitchen." }, { text: 'Rebuilt in 3D before' }, { text: 'the coffee cools.' }],
  sub: 'Point a phone at a kitchen, bathroom or lot. In about sixty seconds you have an explorable 3D twin with 250+ real materials, live line-item pricing and photoreal renders from the client’s own photo.',
  primary: 'Open the studio',
  secondary: 'See it on a real kitchen',
  scrollHint: 'Scroll to see it work ↓',
  bottomRight: 'Photo → twin → priced',
  facts: ['~60 s photo → twin', '250+ real materials', 'Live line-item pricing', 'Photoreal renders', 'Regional price books', 'Share links'],
  audience: 'Built for contractors, remodelers, designers and DADU/ADU builders.',
};

/** The before/after under the film. */
export const PROOF = {
  eyebrow: 'Before and after',
  title: 'The same kitchen. Redesigned, rendered, priced.',
  intro:
    'The photo on the left is a client’s. Drag the handle and the same kitchen, from the same camera, comes back with navy shaker cabinets, Calacatta quartz and white subway tile, and the estimate moves with it. Every number here is the studio’s own estimator running on the demo kitchen.',
  link: 'Open this kitchen in the studio',
};

export const STEPS = [
  {
    n: '01',
    title: 'Upload',
    body: 'Drop in one to four photos of the room or the lot. Add a sentence about what the client wants, what stays, and a rough budget. Plans and measurements help but are not required.',
    detail: 'Kitchen · bathroom · lot & exterior',
  },
  {
    n: '02',
    title: 'Twin',
    body: 'The vision model reconstructs the space — cabinet runs, island, openings, appliances, lighting — into a 3D twin you can orbit, walk through, or line up with the original camera.',
    detail: 'Detailed room reconstruction',
  },
  {
    n: '03',
    title: 'Redesign & price',
    body: 'Click any surface and swap it for one of 250+ real materials. The line-item estimate updates as you go. Render photoreal images from the client’s exact photo angle and share a link.',
    detail: 'Live estimate · photoreal renders · share link',
  },
] as const;

/** Image-swatch catalog ids for the marquee (falls back to any image swatch if an id is missing). */
export const MARQUEE_IDS = [
  'wood-white-oak', 'ct-calacatta-quartz', 'tile-zellige-white', 'sid-cedar-natural', 'roof-metal-galv', 'floor-herringbone',
  'tile-marble-mosaic', 'ct-terrazzo', 'sid-brick-red', 'tile-hex-white', 'floor-white-oak-plank', 'ct-butcher-block',
  'wood-walnut', 'tile-slate-stacked', 'ct-taj-quartzite', 'sid-stone-veneer', 'tile-floor-checker', 'tile-large-format-white',
  'roof-slate', 'wood-black-oak', 'hs-stone-pavers', 'tile-floor-terracotta', 'ct-carrara-marble', 'sid-cladding-02',
];

export const MARQUEE_COUNT = 24;

/** Catalog ids offered in the live-price demo picker. */
export const DEMO_PICKS = {
  cabinets: ['cab-pure-white', 'cab-hale-navy', 'cab-evergreen-fog', 'cab-iron-ore', 'wood-white-oak', 'wood-walnut'],
  countertop: ['ct-white-quartz', 'ct-calacatta-quartz', 'ct-carrara-marble', 'ct-butcher-block', 'ct-soapstone', 'ct-taj-quartzite'],
  backsplash: ['tile-subway-white', 'tile-zellige-white', 'tile-zellige-green', 'tile-hex-white', 'tile-marble-slab', 'tile-slate-stacked'],
} as const;

export const ROOMS = [
  {
    id: 'kitchen',
    name: 'Kitchen',
    eyebrow: 'Room type 01',
    body: 'Cabinet runs, island, appliances, backsplash height, pendants and recessed cans. Every surface is a slot you can click and swap; counter, backsplash and cabinet quantities are read straight from the twin.',
    href: '/studio?demo=kitchen',
    palette: ['cab-hale-navy', 'ct-calacatta-quartz', 'tile-subway-white', 'floor-white-oak-plank', 'fin-brushed-brass', 'light-pendant-glass'],
  },
  {
    id: 'bathroom',
    name: 'Bathroom',
    eyebrow: 'Room type 02',
    body: 'Vanity, shower enclosure, tub, wall-tile height, niche and bench. Tile is priced by the square foot of the actual walls and shower, with separate lines for the pan, glass and waterproofing.',
    href: '/studio?demo=bathroom',
    palette: ['wood-white-oak', 'ct-white-quartz', 'tile-floor-large-grey', 'tile-subway-white', 'tile-large-format-white', 'tile-hex-white'],
  },
  {
    id: 'exterior',
    name: 'Lot & exterior',
    eyebrow: 'Room type 03',
    body: 'Siding, roof, windows, doors, porch, deck, driveway, lawn and fence. Starting from an empty lot? Pick one of seven house templates — Modern Farmhouse, Craftsman, NW Contemporary, Modern, Ranch, Colonial, Mediterranean — and design from there.',
    href: '/studio?demo=exterior',
    palette: ['sid-hardie-lap-white', 'roof-asphalt-charcoal', 'sid-stone-veneer', 'deck-cedar', 'hs-pavers', 'lawn-lush'],
  },
] as const;

export const VALUES = [
  {
    icon: 'zap',
    title: 'Faster quotes',
    body: 'Walk the site, shoot four photos, and have a priced concept before you are back at the truck. Quantities come from the twin, not from a napkin.',
  },
  {
    icon: 'clipboard',
    title: 'Fewer change orders',
    body: 'Clients see the exact finishes on their exact kitchen before anything is ordered. Fewer “I thought it would look different” conversations.',
  },
  {
    icon: 'share',
    title: 'Share links',
    body: 'Every project gets a link. Clients orbit the twin, flip between before and after, and compare options on their phone. No app to install.',
  },
  {
    icon: 'map',
    title: 'Regional pricing',
    body: 'Seattle, Portland, Bay Area, Denver, national and more — 22 US regions with separate material and labor multipliers, plus tier, contingency and markup you control.',
  },
  {
    icon: 'file',
    title: 'Branded proposals',
    body: 'Put your company, colours and contact on share pages and PDF proposals on the Pro plan. Every line ships with its low–high range for material and labor.',
  },
  {
    icon: 'phone',
    title: 'Works on a phone',
    body: 'The studio runs in the browser. Share pages are built for phones, and the 3D view drops to a lighter render mode automatically on older devices.',
  },
] as const;

export const TIERS = [
  {
    id: 'free',
    name: 'Try it',
    price: 'Free',
    period: '',
    blurb: 'Two scans, no account, no card. See your own kitchen, bath or lot in 3D.',
    features: ['2 photo-to-3D scans', 'Full material catalog with live estimates', 'Photoreal renders of your own photo', 'Share links for clients'],
    cta: 'Open studio',
    href: STUDIO_HREF,
    highlight: false,
  },
  {
    id: 'unlimited',
    name: 'Unlimited',
    price: '$1',
    period: '/30 days',
    blurb: 'Launch price. Scan every job for a month for the cost of a coffee refill.',
    features: ['Unlimited scans for 30 days', 'Everything in Try it', '22 regional price books', 'Pay once on Square; no subscription'],
    cta: 'Open studio',
    href: STUDIO_HREF,
    highlight: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    blurb: 'For franchises, suppliers and software teams.',
    features: ['API access', 'SSO', 'Private material catalogs', 'Everything in Pro'],
    cta: 'Talk to us',
    href: `mailto:${CONTACT_EMAIL}?subject=Unifictional%203D%20Studio%20Enterprise`,
    highlight: false,
  },
] as const;

export const FAQ_ITEMS = [
  {
    q: 'What photos work best?',
    a: 'Stand in a corner or a doorway, hold the phone at chest height, and get as much of the room in frame as you can — floor to ceiling if possible. Two to four photos from different corners give the analyzer more to work with than one wide shot. Avoid ultra-wide lenses, which bend cabinet runs. For a lot or exterior, shoot the front elevation straight on plus one wider shot that shows the whole lot; adding lot dimensions or a site plan in the description improves the layout.',
  },
  {
    q: 'How accurate is the estimate?',
    a: 'Planning-grade, roughly ±15–20%. Quantities (cabinet linear feet, counter and backsplash square footage, flooring, wall area, tile, roof squares, siding) are derived from the reconstructed room, then priced against a 2026 national price book with regional multipliers for 22 US markets. Every line shows a separate low–high range for material and labor, plus contingency and contractor markup you can adjust. It is built for scoping and client conversations, not as a bid — confirm with a site visit and your own subs before you sign anything.',
  },
  {
    q: 'How accurate is the 3D twin?',
    a: 'Dimensions are estimated from what the photo shows and from standard sizes — 24-inch base cabinets, 34.5-inch counter height, 36-inch fridge surrounds and so on. The twin reports its confidence and lists the assumptions it made, and you can correct room dimensions, runs and openings in the studio. Treat it as a very good sketch of the space, not a survey.',
  },
  {
    q: 'Do the renders really keep the camera and layout?',
    a: 'Yes. Photoreal renders are produced by AI image-editing models applied to the original photo (or to a screenshot of the 3D view), so the camera angle, layout, windows and daylight stay where they are — only the finishes you selected change. The demo at the top of this page is an unretouched output.',
  },
  {
    q: 'Where do my photos go?',
    a: 'Photos are uploaded to private storage and sent to the AI vision and render providers only to build your twin and renders. They are kept so your project and share links keep working. We do not sell photos or use them for advertising, and share pages are unlisted links, not public galleries.',
  },
  {
    q: 'Which browsers and devices are supported?',
    a: 'Any current version of Chrome, Edge, Safari or Firefox with WebGL 2. The studio is designed for a laptop or an iPad; share links work on any phone with a modern browser and automatically use a lighter render mode on older hardware. The twin runs locally in the browser — no plugin or app.',
  },
  {
    q: 'Which rooms can it handle?',
    a: 'Kitchens (single-wall through G-shaped, with or without an island), bathrooms (powder rooms through primary suites) and lots or exteriors. If the photo is an empty lot, the studio proposes one of seven house templates — Modern Farmhouse, Craftsman, NW Contemporary, Modern, Ranch, Colonial, Mediterranean — that you can reshape and re-clad.',
  },
  {
    q: 'Can I use my own pricing?',
    a: 'Every project lets you pick the region, the default tier (budget, standard, premium, luxury), contingency and markup, and the scope — cosmetic, pull-and-replace or full-gut — which drives the demolition, electrical, plumbing and permit allowances. Private material catalogs with your own products and prices are part of Enterprise.',
  },
] as const;

/** Section openers (LpHeading), numbered in page order like the site's SectionHeading. */
export const SECTIONS = {
  how: {
    index: '01',
    eyebrow: 'How it works',
    title: ['One photo in.', 'A priced, photoreal design out.'],
    intro: 'No modelling, no measuring, no waiting on a designer. Three steps between the site visit and a proposal the client can spin around.',
  },
  materials: {
    index: '02',
    eyebrow: 'Materials',
    /** `{n}` is the live catalog count. */
    title: ['{n} real materials.', 'One catalog for 3D, renders and pricing.'],
    intro:
      'Quartz, zellige, white oak, board-and-batten, standing-seam metal, cedar, brick, terrazzo. Every swatch is the same object in the 3D twin, in the photoreal render prompt and in the estimate — swap it once and all three follow.',
  },
  livePricing: {
    index: '03',
    eyebrow: 'Live pricing',
    title: ['Change a finish.', 'Watch the number move.'],
  },
  rooms: {
    index: '04',
    eyebrow: 'Room types',
    title: ['Three room types.', 'Every surface is a slot.'],
    intro:
      'Kitchens, bathrooms and lots share one spec, one catalog and one estimator. Whatever the analyzer finds in the photo becomes a clickable, swappable, priced surface.',
  },
  contractors: {
    index: '05',
    eyebrow: 'For contractors, remodelers, designers, DADU/ADU builders',
    title: ['Built for the people', 'who actually build.'],
    intro:
      'The 3D Studio is a scoping and selling tool. It is not trying to replace your drawings or your subs — it gets a client to “yes” with a picture of their own room and a number they can plan around.',
  },
  pricing: {
    index: '06',
    eyebrow: 'Founding pricing',
    title: ['Simple plans.', 'Real output on every one.'],
    intro: 'Prices in USD, billed monthly. Every plan includes the full material catalog, live line-item estimates and share links.',
  },
  faq: {
    index: '07',
    eyebrow: 'FAQ',
    title: ['The questions', 'contractors ask first.'],
    intro: 'Photo tips, how far to trust the numbers, where your photos go, and what runs on what.',
  },
} as const;

/** The closing band above the footer (modelled on the site's final-cta). */
export const FINAL_CTA = {
  eyebrow: 'Start here',
  /** Rendered uppercase by the display face; `em` is the one gold word. */
  title: { lead: 'See the remodel', em: 'before', tail: 'you build it.' },
  body: 'Two free scans, no account, no call. Or book a short call with Unifictional and we’ll show you how the studio, SEO Autopilot and a new website work together.',
  primary: { label: 'Open the studio', href: STUDIO_HREF },
  secondary: { label: 'Book a call', href: BOOK_CALL_HREF },
  link: { label: 'Back to unifictional.com', href: UNIFICTIONAL_HREF },
} as const;

export const FOOTER = {
  description: 'Photo → explorable 3D twin from your photos. 250+ real materials, live line-item pricing, photoreal renders, share links.',
  nav: [
    {
      heading: 'Product',
      links: [
        { label: 'Open studio', href: STUDIO_HREF },
        { label: 'How it works', href: '#how' },
        { label: 'Materials', href: '#materials' },
        { label: 'Rooms', href: '#rooms' },
        { label: 'Pricing', href: '#pricing' },
        { label: 'FAQ', href: '#faq' },
      ],
    },
    {
      heading: 'Rooms',
      links: [
        { label: 'Kitchen', href: '/studio?demo=kitchen' },
        { label: 'Bathroom', href: '/studio?demo=bathroom' },
        { label: 'Lot & exterior', href: '/studio?demo=exterior' },
      ],
    },
    {
      heading: 'Unifictional',
      links: [
        { label: 'unifictional.com', href: UNIFICTIONAL_HREF },
        { label: 'SEO Autopilot', href: 'https://unifictional-client-portal.vercel.app/signup' },
        { label: 'Website builder', href: 'https://unifictional.com/process' },
        { label: 'Book a call', href: BOOK_CALL_HREF },
      ],
    },
  ],
  legal: '© 2026 Unifictional · 3D Studio',
  note: 'Estimates are planning-grade (±15–20%), not bids.',
  signature: '3D STUDIO',
} as const;
