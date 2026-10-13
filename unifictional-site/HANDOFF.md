# Handoff: the Unifictional site and its AI build system

Read this first. It explains what this folder is, how a website gets built from a booking with nobody involved, where every secret lives, how to deploy, how to test, and what is unfinished. The older docs (`AI-BUILD.md`, `BOOKING_SETUP.md`, `SEO.md`, `lib/build/PORTING.md`) are still accurate for what they cover; this file is the map on top of them. Last updated 2026-10-12.

## What this is

`unifictional.com` is the agency's own Next.js 16 site. Its booking form (`/contact`) does two things when a contractor books a call: it books the call (Google Calendar + email), and it starts an autonomous build of a complete premium website for that contractor. By the time of the call the owner has a preview link and an email describing the site.

The build runs on Trigger.dev (long-running workers with Chromium and ffmpeg), stores everything in Vercel Blob, and shows progress on a private dashboard at `/builds`.

There are two build modes, switched by one environment variable on Trigger (`BUILD_MODE`):

- **Classic pipeline** (`lib/build/`): a fixed sequence of model calls with hard gates and a look-judge-fix loop. About $30 and 60 to 90 minutes per site. Reliable, well tested.
- **Team mode** (`lib/team/`, `BUILD_MODE=team`): ten agents, each with its own API key, role prompt, memory and tools, working in rounds on one shared site until a Reviewer approves. About $90 to $150 and 100 minutes per site. Built on 2026-10-12 at the owner's request; one complete site produced so far (New Day Construction, build `951516e5`).

Both modes end with the same finish: the film goes into the hero, photos are optimised and self-hosted, pages are rendered to Blob, a zip is made, the owner is emailed, and (when `VERCEL_TOKEN` is set) the site is published to Vercel as its own project.

## How a build runs

1. **Booking** (`app/api/booking/confirm/route.ts`): the form is verified by email code, the lead is saved to Blob at `leads/<id>.json`, and `startBuildAnywhere` triggers the `build-site` task on Trigger with the lead.
2. **Parent task** (`trigger/build-site.ts`): if `BUILD_MODE=team`, it runs `build-team`; otherwise `build-research` → (`build-video` in parallel) → `build-home` → `build-site-rest` → `build-publish`.
3. **Research** (`lib/build/pipeline.ts: researchA/researchB/lookThenHook`): the crawler (`lib/build/analyze.ts`) reads the client's site. Many hosts block datacenter traffic, so it tries a plain fetch, then browser headers, then a real Playwright render, then a relay through `unifictional.com/api/build/fetch` (Vercel's IP pool is usually not blocked). Two model passes with web search build the dossier (facts, services, people, reviews with names, photos, competitors, keywords). The strategist writes the hook: the one claim the site proves, the flagship project, the proofs, the ask.
4. **Film** (`lib/build/video.ts`): Higgsfield Kling 3.0 4K generates a ten-second film of the trade's work happening (a kitchen built from studs, epoxy poured until the floor is covered). It is sampled into frames at three sizes and played by scroll in the `hero-video-scrub` component. Two angles are generated and judged; the better one is used.
5. **Plan, write, review** (classic): the planner picks pages, sections and pack effects from an offer that differs from recent builds; `autoFixPlan` repairs rule shortfalls in code; writers write each page; a reviewer checks facts; SEO sets titles and schema.
6. **Quality loop** (`qaLoop`): render to Blob, open in Chromium at desktop and phone, measure (overflow, clipped text, broken images, blank sections, script errors), show screenshots to a judge, repair what fails, revert a repair that made things worse. The home page first, then the whole site with the home locked.
7. **Debug + publish** (`lib/build/debug.ts`, `lib/build/publish.ts`, `runPublish`): a separate agent (its own key, `DEBUG_ANTHROPIC_API_KEY`) opens every page, fixes layout with a per-page CSS layer (every section root carries `data-sec="N"`), copy and photos through the section data, verifies before/after and reverts regressions. Then the site is deployed to Vercel as project `site-<business-slug>` and the owner's email carries the live URL.

Design rule the owner set and the code follows everywhere: **prefer, note, continue**. A thin client site, few photos, a late film or a rule shortfall is never an immediate failure. The build uses what exists, fixes what it can in code, records the rest as notes for the owner (`researchNotes`, `planNotes`, `writeNotes`, `needsLook`), and delivers the best version. Only truly broken things stop a build: nothing to build from, no pages, a page that does not load, script errors, blank sections, broken links, large overflow, the cost ceiling, an API account with no credits.

## Team mode in one page

- `lib/team/keys.ts`: the ten roles and their keys (`AGENT_KEY_<ROLE>`; the Researcher falls back to the studio key).
- `lib/team/roles.ts`: each role's prompt = the owner's brief + the studio standard (from `lib/build/prompts.ts`) + the role's job.
- `lib/team/memory.ts`: each role's memory at `team/memory/<role>.json` in Blob, read into its prompt, extended by the agent's `remember` tool and by an end-of-build "what did you learn" call.
- `lib/team/board.ts`: the shared notes board for one build (`builds/<id>/team/board.json`).
- `lib/team/tools.ts`: what agents can do: read the brief, dossier and site; write pages; set theme, nav, SEO, a CSS layer; `look` (render + screenshots in Chromium); `run_checks` (the studio's rules as notes); `post_note`; `remember`; `done`. Each role gets a subset (`ROLE_TOOLS`).
- `lib/team/agent.ts`: the loop. Calls the model with tools, answers every tool call, nudges an agent that stops early, handles cut-off answers, stops on budget, time or steps, and stops at once with a plain reason when the account has no credits.
- `lib/team/foreman.ts`: not a brain, a schedule. Research (crawl + photos copied to our storage + Researcher), then rounds: round one is Architect → Writer → Pack designer → Motion engineer → Art director → Photo editor → SEO → Debugger → Reviewer; later rounds run only the roles the Reviewer names, up to `TEAM_ROUNDS`. Then the finish.

Limits (environment or dev-route params): `TEAM_ROUNDS` (3), `TEAM_MAX_STEPS` (40), `TEAM_AGENT_MAX_COST` (10), `TEAM_RESEARCH_MAX_COST` (20), `TEAM_MAX_COST` (90), `TEAM_RESEARCH_SEARCHES` (10), `TEAM_ROLES` (round-one roles, comma separated).

What the first full run taught (New Day Construction, 2026-10-12): every design agent hit its $10 budget around step 12 with work left; the Reviewer spent its whole 25-minute turn looking at pages and gave no verdict. Next changes to make: about $20 per agent, 35-minute turns, a $150 team cap, and a Reviewer that looks at the home plus four pages. The team finish does not yet compute an SEO score.

## Where everything lives

- **Code**: this folder. Build pipeline in `lib/build/`, team in `lib/team/`, Trigger tasks in `trigger/`, dashboard in `components/sections/builds-board.tsx` and `lib/build/dashboard.ts`, booking in `app/api/booking/` and `lib/booking/`.
- **Vercel** project `unifictional` (team `jaygatsby988s-projects`): hosts the site, the preview route (`/preview/<id>/...` serves pages from Blob), the dashboard, the relay fetch route, and the booking APIs.
- **Trigger.dev** project `proj_tpvzmoxzvbmnzybvthtb`: runs the builds. Machines: medium-2x for anything that opens Chromium, with an out-of-memory retry on large-1x.
- **Vercel Blob**: `leads/<id>.json` (the dashboard record), `builds/<id>/` (dossier, hook, plan, pages, spec, pages/*.html, qa screenshots, video frames, photos, site.zip, journal, team board), `studio/lessons.json` (classic pipeline lessons), `team/memory/<role>.json`.
- **Dashboard**: `https://unifictional.com/builds`, cookie `unif_builds` = `BUILDS_DASHBOARD_KEY`. APIs: `/api/build/list` (Bearer `BUILDS_DASHBOARD_KEY`), `/api/build/status?id=&file=` (Bearer `BOOKING_SECRET`), `/api/build/retry`.

## Secrets and environment

Never commit `.env.local`. `.env.local.example` lists the names. The same values must exist in three places: `.env.local` (local dev), Vercel project env (site), Trigger project env (workers). Trigger env can be set through its API with the personal access token (`TRIGGER_ACCESS_TOKEN`):

```
GET/POST/PUT https://api.trigger.dev/api/v1/projects/proj_tpvzmoxzvbmnzybvthtb/envvars/prod[/NAME]
```

| Name | Where | What |
|---|---|---|
| `ANTHROPIC_API_KEY` | Vercel, Trigger | the studio model key (classic pipeline, film prompts, clip judging) |
| `AGENT_KEY_RESEARCHER` … `AGENT_KEY_REVIEWER` | Trigger | one key per team role (ten) |
| `DEBUG_ANTHROPIC_API_KEY` | Trigger | the debug stage's key |
| `HF_API_KEY_ID`, `HF_API_KEY_SECRET` | Trigger | Higgsfield (film) |
| `BLOB_READ_WRITE_TOKEN` | Vercel, Trigger | storage |
| `TRIGGER_SECRET_KEY` | Vercel | lets the site start builds and cancel runs |
| `TRIGGER_ACCESS_TOKEN` | local only | `npx trigger.dev deploy` and the env API |
| `BOOKING_SECRET` | Vercel, Trigger | protects build APIs and the relay route |
| `BUILDS_DASHBOARD_KEY` | Vercel | dashboard login and list API |
| `RELAY_ORIGIN` | Trigger | `https://unifictional.com` (the relay fetch route) |
| `BUILD_MODE` | Trigger | `team` for team mode; unset for the classic pipeline |
| `PUBLISH_STAGE` | Trigger | `0` turns off the debug + publish stage |
| `VERCEL_TOKEN`, `VERCEL_TEAM_ID` | Trigger | publishing sites to Vercel. **`VERCEL_TOKEN` is not set yet**; the team id is `team_rRkfwFMAA8Pv9vAMyV7GDkYP` |
| Google Calendar, Gmail, booking hours | Vercel | see `BOOKING_SETUP.md` |

If an API account runs out of credits, the model answers "credit balance is too low"; builds stop with that reason. Check a key with a one-token request before spending time.

## Deploy

```bash
# site (Vercel). Node 24 + the Vercel CLI live in ~/.local/node on the owner's Mac.
export PATH="$HOME/.local/node/bin:$PATH"
vercel deploy --yes --prod

# workers (Trigger). The CLI is not logged in; export the token from .env.local first.
export TRIGGER_ACCESS_TOKEN="$(grep '^TRIGGER_ACCESS_TOKEN=' .env.local | cut -d= -f2-)"
npx trigger.dev deploy
```

Trigger pins child runs to the parent's version: a deploy never changes a build already running. Typecheck before any deploy: `npx tsc --noEmit -p tsconfig.json`.

## Test it

The only honest test is the live form. Never hand-trigger steps; book like a customer:

1. `https://unifictional.com/contact`: pick a day and time, fill name, business, phone, email, "Yes, here's the link" with the company's real site, "Premium website", a sentence about the business.
2. Continue, read the verification code from the Gmail Sent folder (subject "Your Unifictional code"), Confirm.
3. Watch `https://unifictional.com/builds` or poll `/api/build/list`. Use a different real local company each time; the list of companies already used is in the dashboard.
4. When it finishes, judge the preview against the owner's requirements: opens with the film, Awwwards pack effects in the right places and different from the last build, their real photos, true copy in their voice, nothing resembling unifictional.com, smooth on desktop and phone, and never a bad site delivered without a reason in the email.

Each classic build costs about $30, each team build up to its cap, so think before booking. A run can be cancelled through Trigger's API (`POST /api/v2/runs/<id>/cancel` with `TRIGGER_SECRET_KEY`); runs are listed at `GET /api/v1/runs?filter[taskIdentifier]=build-site` and a run's payload (with the build id) at `GET /api/v3/runs/<id>`.

Free checks before spending, with `next dev` on port 3000 (dev routes return 404 in production):

- `/api/dev/crawl?url=<site>&render=1` runs the crawler (the `render=1` forces the browser path).
- `/api/dev/gate?id=<build>` runs the gates on stored data.
- `/api/dev/qa?id=<build>` inspects a stored build in Chromium.
- `/api/dev/publish?id=<build>` runs the debug + publish stage on a finished build.
- `/api/dev/team?id=<lead>&phase=build&rounds=1&steps=12&cost=3&teamCost=12&roles=architect,debugger,reviewer` runs the team with small limits on an existing lead. Use a cancelled build's id, never a delivered one: the team renders to the same preview path.

## Known issues and what is next

- `VERCEL_TOKEN` is missing, so publishing is skipped and emails say "Not published yet". Create a token at vercel.com (Account → Tokens, scoped to the team) and set it in the Trigger env.
- Higgsfield credits ran low on 2026-10-11; the second film angle fails until topped up.
- Team mode budgets and turn limits are too tight (see the team section). Also the Researcher should set facts and the hook before labelling photos; that order is in the task text now but had not run live at the time of writing.
- The team finish has no SEO audit score; the classic finish does (`lib/build/seo.ts`).
- The crawler's browser session reads the home page of blocked hosts but inner pages often still fail; the relay usually covers them.
- The classic judge is held to "block only for things actually wrong" (pass line 75); the team Reviewer has the same instruction. Both can still be stricter than the owner; when in doubt the owner prefers delivered-with-notes over failed.

## Reference sites the owner wants matched

gofarconstruction.com, caldera-v4.vercel.app, squeeze-rentals.vercel.app, yetch-roofing.vercel.app and above all integrity-garage-floors.vercel.app. Every site must open with the film, mix studio sections with Awwwards pack effects, be different each time, read as the client's own, and never look like unifictional.com.

## Running a stage on an OpenAI model (research branch `research/astra-provider`)

`lib/build/openai.ts` mirrors the two model calls in `lib/build/claude.ts` (`structured`, `research`) on OpenAI's Responses API. Name an OpenAI model in any stage variable and that stage runs there, nothing else changes:

```
OPENAI_API_KEY=...            # Vercel + Trigger
UNIF_MODEL_RESEARCH=gpt-6-astra   # or UNIF_MODEL_PLAN / _WRITE / _REVIEW / _SEO / _DEBUG, or UNIF_MODEL for all
UNIF_PRICES_JSON='{"gpt-6-astra":{"input":2.5,"output":10,"cacheRead":1.25,"cacheWrite":0}}'   # real list prices; the built-in entry is a placeholder
```

What carries over: text and screenshot inputs, JSON-schema output (strict first, then non-strict, then prompt-only), web search in the research passes (`max_tool_calls` caps searches), token usage and cost accounting (cached input tokens count as cache reads).

What does not: **team mode** (`lib/team/agent.ts`) drives Anthropic's tool loop directly and stays on Claude whatever the stage variables say. Prompt caching has no OpenAI equivalent in this layer; the `effort` word maps to `reasoning.effort`.

How to compare: run the same booking twice with `BUILD_MODE` unset, once with `UNIF_MODEL_RESEARCH` (then `_WRITE`) on `gpt-6-astra`, and read `journal.json`, the QA pass rate and the cost line in the build email side by side.

## The lightener and the slogan (added 2026-10-13)

- **Lightener** (`lib/build/lighten.ts`), the last stage before delivery: drops inline CSS rules nothing on the page can use, lazy-loads media below the first section, collapses whitespace between tags; then opens the shipped and the lighter version of each page in Chromium (home on desktop + phone, up to six inner pages on desktop), compares the words, the section count, script errors, page height and greyscale thumbnails at several scroll positions, and keeps the lighter page only when they match. Unsampled pages follow the sample only when every sampled page passed. Stamp: `lightener: N of M pages lighter, … every lightened page photographed the same`. Env: `BUILD_LIGHTEN=0` turns it off, `BUILD_LIGHTEN_MS` (default 240000) is its budget.
- **Their slogan** (`enforceTagline` in `pipeline.ts`): when the research found the company's own tagline it becomes `brand.tagline`, and it must appear on the home page (the accent marquee carries it when no section does) and in the footer. Inline citations research may have pasted after a fact are stripped first. Brand colour, logo, surface mode and type pair are enforced by `lib/build/brand.ts` (`applyBrand` at plan time).
