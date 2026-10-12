# Porting an Awwwards Pack component into the site builder

This folder is the component library the AI site builder renders with. One
file per component, each exporting a `Component` (see `_types.ts`). The
renderer (`../renderer.ts`) emits a component's CSS and JS only on pages that
use it, after a shared prelude that sets up GSAP, ScrollTrigger, SplitText,
Flip, CustomEase (all on CDN) and Lenis, and exposes `window.__fx`:

```js
window.__fx = { RM, SMALL, FX, lenis, closeMenu }
// RM = prefers-reduced-motion, SMALL = width < 768px, FX = !RM && !SMALL
```

Read `scroll-41.ts` (a hero), `menu-8.ts` (a menu) and `scroll-47.ts` (a
pinned section) first; they are the house style. Then read the pack's
catalogue entry and the shipped code for your component:

- Pack: `/Users/aavi/Documents/claude/website/awwwards-pack/`. Ids are
  `<slug>-<n>` for the folder `<Category>/<n>` (hero = Hero Animations, menu =
  Navigation Menus, scroll = Scroll Animation, text = Text Animations,
  slider = Sliders).
- Catalogue: `CATALOG.md`, search `### <id>` for the entry (what you see, key
  files, how it works, how to adapt). Storyboard: `_contact-sheets/<id>.jpg`
  (view it with the Read tool).
- Code: `unzip -l "<Category>/<n>/code.zip"` to list, `unzip -p "<Category>/<n>/code.zip" "<path>"`
  to print one file. Unzip into a scratch folder if easier. Never run its
  npm scripts.

## The contract

```ts
{
  id: "scroll-34",            // pack id
  type: "hero-zoom",          // the section type the model writes in the spec
  kind: "hero" | "menu" | "section",
  weight: "light" | "medium",
  describe: "...",            // 2-4 sentences for the design prompt: what it looks like on
                              // screen, what content it needs, what business it suits
  fields: `{"type":"hero-zoom","component":"scroll-34","headline":"","sub":"", ...}`,
  images: { min: 1, max: 1 }, // image fields this section needs (omit when none)
  css: (ctx) => `...`,        // scoped under one root class, e.g. .hero-zoom …
  html: (section, ctx) => `...`,   // menus: (null, ctx) and read ctx.spec.nav
  js: (ctx) => `(function(){ ... })();`   // optional, scoped, reads window.__fx
}
```

`ctx` gives you: `t` (colour tokens: bg, bg2, ink, ink2, ink3, line, accent,
onAccent, invBg, invInk, dark), `pair` (display/body/mono font families,
weight, track, caps), `capsRule`, `esc(s)`, `imgUrl(img, w)`, `link(href)`
(resolves page slugs and anchors: always wrap hrefs in it), `arrow` (inline
SVG for buttons), `page` ({slug}), `spec` (the whole site) and `brandMark()`
(the logo or wordmark markup for menus).

Section data shapes the model will write (reuse these names):
- headline / sub / eyebrow / label / text / title / intro (strings)
- cta: {label, href} · button: {label, href}
- image: {query, alt, url} · images: [{query, alt, url}] (resolved before render; `url` is set)
- items: [{title, text, meta, quote, name, role, q, a, query, image, href}]
- steps: [{title, text}]

## Kinds beyond sections

- **menu** (`type: "menu"`): the site navigation; see `menu-8.ts`. Reads `ctx.spec.nav`.
- **transition** (`type: "transition"`): a site-wide page-to-page transition, chosen
  by the planner as `spec.theme.transition`. `html(null, ctx)` returns the overlay
  markup (fixed, `pointer-events: none` when idle, `aria-hidden`); `js` runs on
  every page: play an entry animation on load (reveal the page), intercept clicks
  on same-origin links that are not `#anchors`, `tel:`, `mailto:` or `target=_blank`,
  play the exit, then set `location.href`. Always add a 1.5 s `setTimeout` fallback
  so navigation never depends on a tween finishing. Reduced motion: no animation.
- **cursor** (`type: "cursor"`): a site-wide cursor or hover effect, chosen as
  `spec.theme.cursor`. `html(null, ctx)` returns any markup it needs (a cursor
  element, a canvas). Must do nothing when `matchMedia('(pointer: coarse)')`
  matches or `window.__fx.RM` is true, and must not hide the native cursor
  unless it draws a replacement that is always visible. Hover targets are
  `a, button, .service, .grid__item, .row__title` and anything with
  `data-cursor="hover"`; images it reacts to are the page's `img` elements.

## Video-only components (no code.zip)

Rebuild the effect from the catalogue entry and the storyboard
`_contact-sheets/<id>.jpg` (read it with the Read tool; it shows frames in
time order). Begin `describe` with "(recreated from the preview video)". Adapt
the demo's content to a local-business site: a "music player card" field
becomes a project or service card, a wordmark becomes `spec.brand.name`, and
so on. Keep the mechanism (the motion), not the demo's subject.

## Heavy components (WebGL, three.js, shaders)

- Declare `weight: "heavy"`, `libs: ["three"]` and `module: true`, then
  `import * as THREE from "three"` (and addons from `"three/addons/..."`) at the
  top of your `js`. three.js r160 is provided through an import map; do not
  load it any other way, and do not use any other 3D or shader library.
- Everything else (GSAP, ScrollTrigger, Lenis, `window.__fx`) is available to
  module scripts too.
- Initialise lazily: create the renderer when the section first intersects
  the viewport, pause the loop when it leaves, cap `devicePixelRatio` at 1.5,
  and dispose on `pagehide`.
- Fallback: if `window.__fx.FX` is false, or `canvas.getContext('webgl2')`
  fails, render the static layout (images and text) and return before
  touching three. The section must look finished without WebGL.
- Shaders go inline as template strings. Textures come from the section's
  image URLs; set `crossOrigin = "anonymous"` on the loader.
- Lottie (`libs: ["lottie"]`, `window.lottie`) is only for scroll-48; take the
  animation JSON URL from an optional `lottie` field and fall back to the
  brand mark when it is missing.

## Rules

1. **Rebuild, do not paste.** Take the mechanism from the pack code (the
   timeline, the clip-path maths, the layout) and rewrite it as one scoped
   IIFE and one scoped CSS block. No globals, no `document.body` styles, no
   resize handlers that call `ScrollTrigger.getAll().forEach(kill)`.
2. **Query inside the section.** `var el = document.querySelector('[data-fx="hero-zoom"]'); if (!el) return;`
   then query from `el`. Menus use ids `js-toggle`, `js-menu`, `js-close` and
   must set `window.__fx.closeMenu = closeMenu` and stop/start Lenis while
   open, like menu-8.
3. **Phones and reduced motion get a static layout.** Guard the effect with
   `if (!window.__fx.FX) { …static state…; return; }` and add a
   `@media(max-width:767px),(prefers-reduced-motion:reduce)` block that
   unpins and shows everything.
4. **Pin with CSS, scrub with GSAP** when you can: tall section, sticky
   inner box of `100svh`, one scrubbed timeline. ScrollTrigger `pin` is fine
   for simple cases (scroll-41 uses it).
5. **Use the tokens and fonts**: `var(--bg)`, `var(--ink)`, `var(--accent)`,
   `var(--display)`, `${pair.weight}`, `${capsRule}`. No hard-coded brand
   colours from the demo. Images are `<img>` with `loading="lazy"` (except
   a hero's first image: `fetchpriority="high"`) and real `alt`.
6. **Libraries**: GSAP core + ScrollTrigger always; SplitText, Flip and
   CustomEase are loaded automatically when your `js` mentions `SplitText`,
   `Flip` or `CustomEase`; three.js and lottie only through `libs` (see
   "Heavy components"). Nothing else (no Splitting.js, no Barba, no Swiper,
   no npm imports). Rewrite what the demo did with those in plain JS.
6b. **Unique type names**: `type` must be unique across the registry. Before
   choosing one run `grep -h "type: \"" lib/build/components/*.ts` and pick a
   descriptive kebab-case name nobody uses; when in doubt append the pack
   number (`"reveal-pixel-22"`). Menus, transitions and cursors use the fixed
   types `"menu"`, `"transition"`, `"cursor"`.
6c. **Videos**: a section that plays a video (scroll-8) takes an optional
   `video: {url}` field plus a required `image` poster; render the poster alone
   when no url is given. Never autoplay with sound.
7. **Escape everything** the spec supplies with `esc()`. Wrap every href in
   `link()`.
8. **Keep it self-contained**: one file, `// @ts-nocheck` at the top,
   `import type { Component } from "./_types";`, `export default c;`.
9. **Do not register it yourself.** Only create `<id>.ts`. The lead wires
   it into `_ported.ts` afterwards. Do not touch `_ported.ts`, `index.ts`,
   the renderer or any other existing file.
10. **Prove it in the browser.** The Next dev server is already running on
    http://localhost:3000. Open
    `http://localhost:3000/api/dev/port-check?id=<id>` (add `&mode=dark` for
    the dark theme): it renders a demo page with sample content through
    your component. Use the browser tools: create your own tab with
    `tabs_create`, `navigate` it to that URL, take screenshots, scroll,
    and check `read_console_messages` for errors. Then
    `resize_window` that tab to the `mobile` preset, reload, and check the
    static phone layout; reset to `desktop` when done. Fix until it looks
    right, animates on scroll, and the phone layout is readable. Close
    your tab when finished. If the route answers JSON with an error, read
    it: it tells you what is wrong with the module or its `fields`.
    Finally run, from the project root,
    `export PATH="$HOME/.local/node/bin:$PATH" && npx tsc --noEmit -p .`
    and make sure your file adds no errors.

Write the `describe` text for a designer who has not seen the demo: what
happens on screen, in order, what it needs (how many images, how long the
text can be) and which businesses it suits. The design model picks
components from these descriptions alone.
