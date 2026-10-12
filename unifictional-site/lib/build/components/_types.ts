// The contract every renderable Awwwards Pack component follows.
// One file per component in this folder; index.ts collects them.
//
// A component owns three things: the CSS it needs (only emitted when a page
// uses it), the HTML for one section (or the nav, for menus; or an overlay,
// for transitions and cursors) and an optional client script that runs after
// the shared runtime prelude. Scripts must be scoped to their own section
// (query by data-fx inside the section) and must respect window.__fx.FX
// (false on phones and with reduced motion): give phones a static layout.
// Nothing global, no resize handlers that kill other ScrollTriggers, no
// selectors that reach outside the section.

export interface Tokens {
  bg: string; bg2: string; ink: string; ink2: string; ink3: string; line: string;
  accent: string; onAccent: string; invBg: string; invInk: string; dark: boolean;
}
export interface Pair {
  display: string; body: string; mono: string; google: string; caps: boolean; weight: number; track: string;
}
export interface Ctx {
  t: Tokens;
  pair: Pair;
  /** "text-transform: uppercase;" when the display face is condensed caps, else "". */
  capsRule: string;
  esc: (s: unknown) => string;
  /** URL for an image object ({url}) or a string, with the Unsplash width rewritten. */
  imgUrl: (img: unknown, w?: number) => string;
  /** Resolves a spec href (page slug, "#anchor", "tel:", "http…") to a real href for this render. */
  link: (href: string) => string;
  /** Inline arrow SVG used in buttons. */
  arrow: string;
  /** The page being rendered. */
  page: { slug: string; title?: string };
  /** The whole site spec (brand, theme, nav, pages…). */
  spec: any;
  /** The logo or wordmark markup (menus and footers). */
  brandMark: () => string;
}

/**
 * hero / section: one block of a page, chosen per page in the spec.
 * menu: the site navigation (spec.nav.menu = id); html(null, ctx) returns header + overlay.
 * transition: a site-wide page-to-page transition (spec.theme.transition = id);
 *   html(null, ctx) returns the overlay markup appended to every page; js runs on every page
 *   and should intercept same-site link clicks, play the exit, navigate, and play the entry on load.
 * cursor: a site-wide cursor or hover effect (spec.theme.cursor = id); html(null, ctx) returns
 *   any markup it needs; js runs on every page; must do nothing on touch screens (pointer: coarse).
 */
export type Kind = "hero" | "menu" | "section" | "transition" | "cursor";

export interface Component {
  /** Awwwards Pack id, e.g. "scroll-34". Generic (non-pack) sections use their type as id. */
  id: string;
  /** The section `type` the spec uses, e.g. "hero-zoom". Must be unique across the registry. Menus use "menu", transitions "transition", cursors "cursor". */
  type: string;
  kind: Kind;
  /** light = DOM + GSAP; medium = canvas 2D, many nodes, Flip, heavy splitting; heavy = WebGL / three.js / shaders. A site gets at most one heavy component, and heavy ones must render a static fallback on phones and when WebGL is unavailable. */
  weight: "light" | "medium" | "heavy";
  /** One paragraph for the design prompt: what it looks like on screen and when to use it. Start with "(recreated from the preview video)" when the pack had no code. */
  describe: string;
  /** The JSON shape of the section the model must write, as a one-line example. For menu/transition/cursor: the nav or theme field it reads. */
  fields: string;
  /** Images this section needs, for the prompt and for image resolution: {min, max}. */
  images?: { min: number; max: number };
  /** Extra libraries the js needs. The renderer loads them from CDN once per page: "three" (three.js r160 as ES modules with an import map: `import * as THREE from "three"`, addons from "three/addons/..."), "lottie" (lottie-web UMD, window.lottie). */
  libs?: ("three" | "lottie")[];
  /** true when `js` must be emitted as <script type="module"> (needed to import three). Module scripts still see window.__fx and window.gsap. */
  module?: boolean;
  css: (ctx: Ctx) => string;
  /** Sections: (section, ctx). Menus/transitions/cursors: (null, ctx). */
  html: (section: any, ctx: Ctx) => string;
  /** Client script body (no <script> tag). May read window.__fx. Emitted once per page when used. */
  js?: (ctx: Ctx) => string;
}
