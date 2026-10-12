/**
 * Website previews shown in the homepage 3D marquee.
 *
 * When a site has a `url`, the marquee embeds it **live** (a scaled-down,
 * display-only iframe — videos autoplay). When there's no `url`, it falls back
 * to the on-brand mockup SVG in /public/showcase.
 */
export type ShowcaseSite = {
  name: string;
  /** Short caption shown in the work carousel. */
  meta: string;
  /** Live site URL. Embedded as a live preview when present. */
  url?: string;
  /** Fallback mockup image. */
  image: string;
};

export const showcaseSites: ShowcaseSite[] = [
  { name: "Blue Lake Construction", meta: "General Contractor · WA", url: "https://www.bluelakewa.com/", image: "/showcase/blue-lake-construction.webp" },
  { name: "Cascade Poolworks", meta: "Luxury Pools · Seattle", url: "https://cascadepoolworks.com/", image: "/showcase/cascade-pool-works.webp" },
  { name: "ENF Siding & Exteriors", meta: "Siding & Exteriors · Everett", url: "https://eduard-enf.vercel.app/", image: "/showcase/enf-siding.webp" },
  { name: "DIGS Construction", meta: "ADU & Custom Homes · Seattle", url: "https://www.digswa.com/", image: "/showcase/diggs-builders.webp" },
  { name: "Tremor Excavation", meta: "Excavation & Site Work · WA", url: "https://tremor-deploy.vercel.app/", image: "/showcase/tremor-excavation.webp" },
  { name: "Fall Line House", meta: "Architecture · Cliffhaven Atelier", url: "https://fall-line-house.vercel.app/", image: "/showcase/fall-line-house.webp" },
  { name: "Neptune Pool & Spa", meta: "Pool & Spa Service · Seattle", url: "https://neptune-one.vercel.app/", image: "/showcase/neptune-pool-spa.webp" },
  { name: "Go Far Construction", meta: "Remodeling & Custom Homes · Lynnwood", url: "https://gofarconstruction.com/", image: "/showcase/go-far-construction-v2.webp" },
];

/**
 * What the marquee renders: each tile carries the live URL (embedded only on
 * desktop) and the static screenshot (used on mobile/tablet for performance).
 */
export const marqueeItems = showcaseSites.map((s) => ({
  name: s.name,
  url: s.url,
  image: s.image,
}));
