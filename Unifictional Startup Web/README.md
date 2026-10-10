# unifictional.com — source

The live site (Vercel project `unifictional`, team jaygatsby988s-projects). This folder
is the deployed source pulled back from production on 2026-10-06, with the old
build-time patch step (`claude-fixes.mjs` + patch files) already applied and removed,
so what is here is exactly what runs.

## Run

```bash
npm install
npm run dev -- -p 8125
```

Or use the `unifictional-site` launch config in the repo's `.claude/launch.json`.

## Deploy

```bash
npx vercel deploy --prod --yes
```

`public/frames/unifictional-v3/` (241 webp frames, ~17 MB) must stay in the folder:
the About page and the archived scrub hero still read from it, and the old build
used to download them from the live site at build time.

## The portal preview button

Every "Preview the portal" link reads `PORTAL_PREVIEW_URL` in `lib/site.ts`. Set
`NEXT_PUBLIC_PORTAL_URL` in Vercel (or `.env.local`) to point it at the real client
portal UI; until then it falls back to the public demo.

## Landing page (2026-10 remodel)

`app/page.tsx` → platform-hero → manifesto → sectors ticker → platform index
(`#platform`) → quote flow (`#quote-tool`) → portal preview (`#portal`) → selected
work → process → final CTA. The portal / quote-tool pictures are hand-built markup in
`components/ui/portal-mock.tsx` (demo numbers, labelled "Demo account").
Shared copy (nav, footer, platform parts, quote steps, process, FAQs) lives in
`lib/site.ts`. Booking system notes: `BOOKING_SETUP.md`. Keyword map: `SEO.md`.
