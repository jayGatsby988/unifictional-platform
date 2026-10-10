export type Project = {
  id: number;
  title: string;
  category: string;
  location: string;
  year: string;
  blurb: string;
  /** Live URL, or "" to show a "Live soon" note instead of a link. */
  liveUrl: string;
  /** Real screenshot of the live site (public/showcase/*.webp). */
  image: string;
};

export const projects: Project[] = [
  {
    id: 1,
    title: "Blue Lake Construction",
    category: "General Contractor",
    location: "Washington",
    year: "2025",
    blurb:
      "A premium site for home remodeling and custom builds — full-bleed video and a clear path to an estimate.",
    liveUrl: "https://www.bluelakewa.com/",
    image: "/showcase/blue-lake-construction-v3.webp",
  },
  {
    id: 2,
    title: "Cascade Poolworks",
    category: "Luxury Pool Design & Construction",
    location: "Seattle, WA",
    year: "2025",
    blurb:
      "A cinematic, gallery-led site that lets finished pools and water features sell the craftsmanship.",
    liveUrl: "https://cascadepoolworks.com/",
    image: "/showcase/cascade-pool-works-v3.webp",
  },
  {
    id: 3,
    title: "ENF Siding & Exteriors",
    category: "Siding · Soffit · Trim",
    location: "Everett & Snohomish County, WA",
    year: "2025",
    blurb:
      "A trust-first exteriors site built to turn siding, replacement, and repair searches into booked quotes.",
    liveUrl: "https://eduard-enf.vercel.app/",
    image: "/showcase/enf-siding-v3.webp",
  },
  {
    id: 4,
    title: "DIGS Construction",
    category: "ADU & DADU Builders",
    location: "Seattle, WA",
    year: "2025",
    blurb:
      "A clean, modern site that makes a high-value ADU build feel simple to understand and easy to start.",
    liveUrl: "https://www.digswa.com/",
    image: "/showcase/diggs-builders-v3.webp",
  },
  {
    id: 5,
    title: "Tremor Excavation",
    category: "Excavation & Site Work",
    location: "Washington",
    year: "2025",
    blurb:
      "Ground moved with precision — a bold, video-led site built to win site-prep and grading work.",
    liveUrl: "https://tremor-deploy.vercel.app/",
    image: "/showcase/tremor-excavation-v3.webp",
  },
  {
    id: 6,
    title: "Fall Line House",
    category: "Architecture · Cliffhaven Atelier",
    location: "Mountain West",
    year: "2025",
    blurb:
      "An editorial, video-led site for a custom architectural home — atmosphere first, with the build details a scroll away.",
    liveUrl: "https://fall-line-house.vercel.app/",
    image: "/showcase/fall-line-house-v3.webp",
  },
  {
    id: 7,
    title: "Neptune Pool & Spa",
    category: "Pool & Spa Service · Repair · Supplies",
    location: "Seattle, Snohomish & King County, WA",
    year: "2025",
    blurb:
      "A clean service-business site that makes booking pool and spa work obvious and turns searches into calls.",
    liveUrl: "https://neptune-one.vercel.app/",
    image: "/showcase/neptune-pool-spa-v3.webp",
  },
  {
    id: 8,
    title: "Go Far Construction",
    category: "High-End Remodeling · ADUs · Custom Homes",
    location: "Lynnwood, WA",
    year: "2025",
    blurb:
      "A bold, video-led brand for high-end remodels and custom homes — built to look bigger and earn bigger jobs.",
    liveUrl: "https://gofarconstruction.com/",
    image: "/showcase/go-far-construction-v3.webp",
  },
];
