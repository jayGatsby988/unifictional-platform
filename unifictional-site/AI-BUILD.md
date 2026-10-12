# The AI build behind the lead form

When someone books a call on `/contact`, two things happen the moment they
confirm their email code:

1. **You get the booking email** (as before), now with "The AI is building
   their site now" when the pipeline is on.
2. **The AI builds a complete multi-page site** in the background and emails
   you again, ten to twenty minutes later, with a private preview link for
   every page, the designer's rationale, what the reviewer fixed, the SEO
   score and keyword plan, research gaps to ask about on the call, and the
   whole site attached as a zip.

The lead form asks "Do you have a website?":

- **Yes** → they paste the link. The pipeline crawls their site (home plus up
  to 20 inner pages and stylesheets), pulls the logo, brand colours, fonts,
  social links, address, hours, licence and every real photo with its
  caption, researches the business on the web, and rebuilds the site.
- **Not yet** → they describe the company in a few sentences. The pipeline
  researches from that brief and builds the first site from it.

Nothing is sent to the lead. The preview is for you, to bring to the call.

## The pipeline

```
confirm ─▶ research (pass 1 + pass 2 + hook) ─┬▶ design (plan + coverage) ─▶ write (every page) ─▶ finish (review + SEO + lighter pass + render + email)
                                               └▶ video (Higgsfield hero clip → frames)  …waited for in finish
```

| Phase | What it does | Model calls |
| --- | --- | --- |
| video | runs beside the design when `HF_API_KEY_ID`/`HF_API_KEY_SECRET` are set and the research found a usable photo (`lib/build/video.ts`): a small model call writes the Kling prompt from the hook and flagship, the flagship photo is sent to Higgsfield (Kling 3.0, 4K by default, 8 s), the clip is polled for (up to 10 min), downloaded, cut into 24 fps WebP frames at 1280 / 1920 / 3840 with ffmpeg (Trigger.dev installs it; on the Vercel chain there is no ffmpeg so the mp4 is stored and scrubbed directly) and everything lands in Blob under `builds/<id>/video/` with a `manifest.json`. finish waits up to 7 min for that manifest; without it the hero falls back to the flagship photo (`hero-split`). Never throws: a failure is logged in the build log and the email. | 1 |
| research | crawl the site (`lib/build/analyze.ts`), then pass one: facts and offer (services, team, licence, service area, process, guarantees, projects, photos), up to 12 web searches; then pass two: reviews with verbatim quotes and ratings per platform, competitors, buyer phrasing and keywords, market notes, voice, copy bank, design direction | 2 |
| design | first the marketing strategist: the one hook (a provable claim a competitor could not make, shaped by what the owner wants more of), the flagship project with its photos and story, the ranked proof stack, the main objection and its answer, and the ask; then the site plan (brand treatment, menu and home hero chosen from the components *offered for this build*, 7-14 pages with section briefs), then the coverage map assigning every dossier fact to a section | 2 |
| write | every page written, nine in parallel per batch | one per page |
| finish | a reviewer checks coverage, specificity, truth, structure and brand and returns corrected sections; then every page is rendered with the pack components, audited, the SEO agent writes titles, descriptions, keywords per page, a keyword plan and alt text, schema is added per page, pages and a zip go to Blob, the owner gets the email | 2 |

**Where it runs.** With `TRIGGER_SECRET_KEY` set, the confirm route starts a
Trigger.dev run (`trigger/build-site.ts`): one parent run per lead with the
three phases as child tasks, each retried on its own, no time limit that
matters, and a queue (`BUILD_CONCURRENCY`, default 8) so a burst of sign-ups
waits instead of hitting the Anthropic rate limit. Without it, the three
phases run as Vercel functions (`app/api/build/[step]/route.ts`, `maxDuration`
800 s on the Pro plan) that post the job to each other; every model call has
a time budget below that so a slow call fails with an email instead of a
silent kill. Vercel refuses chains longer than about four self-calls (HTTP
508), which is why there are only three phases.

Every build records its token usage and cost (each call priced at its own
model's list price) in the lead record and the email. On Opus 5.5 the full
Blue Lake build (19 pages) cost $9.81; on Fable 5.1 (the default since
2026-10-10) expect roughly 2.5x that, about $25 for a site that size and
$15 for a 6-8 page business. Check a build with `GET /api/build/status?id=<id>` (bearer = build
secret; `&file=dossier|plan|pages|spec|seo|review` returns the stored JSON).
Start one without a booking with `POST /api/build/trigger` (bearer) and a
`lead` body.

### Trigger.dev (connected 2026-10-10)

Org `unifictional-81ec`, project `unifictional` (ref `proj_tpvzmoxzvbmnzybvthtb`),
Pro plan. Production tasks `build-site` (parent, queue `site-builds`,
`BUILD_CONCURRENCY` = 15) → `build-research` → `build-design` → `build-write`
→ `build-finish`, deployed from this folder with
`TRIGGER_ACCESS_TOKEN=… TRIGGER_PROJECT_REF=… npm run trigger:deploy`
(the token and ref are in `.env.local`; a personal access token named
"claude deploys (unifictional)" exists in the Trigger.dev account). The
production API key named "unifictional.com site (Vercel)" is set as
`TRIGGER_SECRET_KEY` in the Vercel project, so every confirmed booking and
every dashboard Rebuild starts a Trigger.dev run. The pipeline's secrets
(Anthropic, Blob, Gmail, booking secret, site URL, model) live in the
Trigger.dev production environment variables; change them there when they
change on Vercel. Watch runs at
https://cloud.trigger.dev/orgs/unifictional-81ec/projects/unifictional-Hv8C/env/prod/runs.
Redeploy the tasks after any change under `lib/build/` or `trigger/`.

## The lighter pass

Inside `finish`, before the final render (`lib/build/optimize.ts`): every
one of the company's photos (and the logo) is fetched once, resized to the
widths the layouts use (640 / 1280 / 1920 / 2560 / 3840; the default `src`
is the 1920 rendition and 4K screens pick the larger ones from `srcset`), re-encoded as WebP and stored in
Blob next to the build; every `<img>` that uses one gets `srcset`, `sizes`,
`width`/`height` (no layout shift), `decoding="async"` and, below the hero,
`loading="lazy"`; CSS background URLs are swapped the same way; inline
`<style>` and `<script>` blocks are minified (clean-css, terser). The look is
unchanged: same photos, same rules, same scripts. Stock photos from Unsplash
already arrive from an image CDN and are left alone. Best-effort with a 150 s
budget: a photo that cannot be fetched or encoded keeps its original URL.
The savings are recorded in the lead record (`weight`), the email and the
dashboard. First measurement on the Blue Lake build: 45 photos, 42.4 MB →
6.9 MB in 18 s; scripts about a quarter smaller.

## The hero video

`hero-video-scrub` (`lib/build/components/hero-video-scrub.ts`) is the home
hero of any build with a generated clip: a 340 vh section whose sticky
full-screen canvas shows the frame the scroll asks for, forward and back,
with no video element in the way. Frames load coarse-to-fine (every 16th,
8th, 4th, 2nd, then all), a window of decoded bitmaps is kept around the
current frame, the tier is picked from the screen (1280 / 1920, and the
3840 frame is swapped in when the scroll rests on a 4K screen). The company
name and the hook claim sit over the first frames, two short beats pass as
the clip plays, the sub and the ask land on the last frames. Phones and
reduced motion get the poster with the copy. Check it locally with
`/api/dev/port-check?id=hero-video-scrub&video=frames` (sample frames in
`public/dev-hero`, not deployed) or `&video=mp4` for the mp4 fallback.

Premium rules live in `SYSTEM_PLAN` (full-bleed photography, display type at
scale, one accent, dark cinematic home for photo-led trades, at most two
pack effects per screen) and the image tiers now go to 3840 px.

## Variety

The planner only sees a subset of heroes (3 of them) and menus (2) for each
build, chosen deterministically from the build id, plus every section
component. It picks by fit from those, so two builds in a row do not get the
same opening. Across one site each pack effect may appear at most twice.

## Components

Every component in the Awwwards Pack is in the registry: 109 pack ids (all
74 coded ones and the 35 video-only ones rebuilt from their storyboards; the
4 empty pack folders scroll-21/43/54/58 have nothing to port) plus the
generic content blocks. By kind: 13 heroes, 10 menus, 3 page transitions,
3 cursor effects and about 80 sections, 36 of them WebGL or three.js
("heavy": the planner uses at most one per site, on the home page, and
they render a static layout on phones and without WebGL). Regenerate the
list after adding a file with `npm run components`
(`tools/register-components.mjs`), which also reports duplicate type names.

`lib/build/components/` holds one file per renderable component (the
contract is in `_types.ts`, the porting guide in `lib/build/PORTING.md`).
The renderer (`lib/build/renderer.ts`) assembles pages from them and emits a
component's CSS and JS only on pages that use it. Check any component on
the dev server at `/api/dev/port-check?id=<id>`; check the page frame with a
sample multi-page site at `/api/dev/site-check[/<page>]`; check the crawler
at `/api/dev/crawl?url=…`. These dev routes answer 404 in production.

The model never writes HTML. It writes a site specification (the contract is
at the top of the renderer) and the renderer assembles real Awwwards Pack
components with the company's logo, colour, photos and copy.

## Where things live

- Code: `lib/build/{analyze,claude,prompts,renderer,images,seo,pipeline,storage,emails}.ts`,
  `lib/build/components/*`, `lib/build/data/pack.json` (catalogue context).
- Routes: `app/api/build/[step]/route.ts`, `app/preview/[id]/[[...slug]]/route.ts`,
  dev-only `app/api/dev/*`.
- Hook: `app/api/booking/confirm/route.ts` calls `startBuild()` inside
  `after()` once the booking is claimed, so a replayed confirm never builds
  twice.
- Storage: Vercel Blob store `unifictional-builds`:
  `builds/<id>/{dossier-a,dossier,plan,pages,spec,seo,review}.json`,
  `builds/<id>/pages/<slug>.html`, `builds/<id>/site.zip`,
  `leads/<id>.json` with status
  `queued → research → research-b → plan → write → review → finish → done | failed`.
- Preview: `https://unifictional.com/preview/<bookingId>` and
  `/preview/<bookingId>/<page>`, served from Blob, `noindex`, random UUID.

## Env

| Var | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Turns the pipeline on. Without it nothing builds and bookings behave as before. |
| `UNIF_MODEL` | The model for every agent (default `claude-fable-5-1`). Per-phase overrides: `UNIF_MODEL_RESEARCH`, `_PLAN`, `_WRITE`, `_REVIEW`, `_SEO` (e.g. `claude-opus-5-5` to halve a phase's cost). |
| `BLOB_READ_WRITE_TOKEN` | Injected by Vercel from the attached Blob store. |
| `BUILD_SECRET` | Optional; the internal step routes fall back to `BOOKING_SECRET`. |
| `NEXT_PUBLIC_SITE_URL` | Production origin the steps post to (`https://unifictional.com`). |
| `HF_API_KEY_ID`, `HF_API_KEY_SECRET` | Higgsfield API keys (console.higgsfield.ai) for the hero video. Without them the hero is the flagship photo. Set on Vercel and in the Trigger.dev prod env. |
| `HIGGSFIELD_ENDPOINT` | Default `kling-video/v3.0/4k/image-to-video`; `kling-video/v3.0/std/image-to-video` is the cheaper 1080p one. `HIGGSFIELD_DURATION` (3-15 s, default 8), `HIGGSFIELD_WAIT_MS` (default 600000). |

## Costs and limits

One build is roughly 24 web searches and 10 to 20 Opus calls (two research
passes, a hook, a plan, one call per page, a review, an SEO pass, a video prompt). The
hero clip is billed by Higgsfield in credits on top (Kling 3.0 at 4K was 60
credits for 10 s in the console; the API price shows there). Expect ten to
twenty dollars per lead at Opus prices and ten to twenty minutes end to end.
Builds only start for leads who verified their email, which is the abuse
guard. Research pass two and the review are best-effort: if they fail the
build continues and the email says so. If the plan or every page fails you
get a failure email instead.

## Local run

```bash
export PATH="$HOME/.local/node/bin:$PATH"
vercel env pull .env.local --environment=production   # Gmail, Blob, key
# then remove the VERCEL_ENV line from .env.local so steps post to localhost
npm run dev                                            # http://localhost:3000
```

To run a build by hand (no booking):

```bash
curl -X POST http://localhost:3000/api/build/research \
  -H "authorization: Bearer $BOOKING_SECRET" -H "content-type: application/json" \
  -d '{"id":"<uuid>","createdAt":"2026-10-09T00:00:00Z","origin":"http://localhost:3000","log":[],"lead":{"name":"Test","email":"you@example.com","phone":"555","businessName":"Blue Lake Construction","website":"https://www.bluelakewa.com","companyDetails":"","services":[],"message":"more custom home builds"}}'
```

Watch `[build …]` lines in the dev server log or the lead record in Blob.

## Deploy

```bash
npm run deploy   # vercel deploy --prod
```
