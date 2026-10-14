# Unifictional platform

Everything Unifictional ships, in one repo. Three apps, each with its own `package.json`, Vercel project and docs; the root `package.json` only holds shortcuts that reach into them.

| What | Folder | Live | Docs to read first |
|---|---|---|---|
| **Marketing site + AI website builder** — unifictional.com, the booking flow, and the pipeline that researches, designs, writes, checks and publishes a client site on Trigger.dev | [`unifictional-site/`](unifictional-site/) | https://unifictional.com | [`HANDOFF.md`](unifictional-site/HANDOFF.md) · [`AI-BUILD.md`](unifictional-site/AI-BUILD.md) · [`SEO.md`](unifictional-site/SEO.md) · [`BOOKING_SETUP.md`](unifictional-site/BOOKING_SETUP.md) |
| **Client Portal / SEO Autopilot** — the product: sign up → build a plan → pay on Square → posts researched, written, checked and published automatically; an AI strategist the client talks to; the studio back office | [`Client Portal/`](Client%20Portal/) | https://unifictional-portal.com (the old unifictional-client-portal.vercel.app redirects) | [`README.md`](Client%20Portal/README.md) · [`AGENTS.md`](Client%20Portal/AGENTS.md) |
| **3D Remodel Studio (MANHATTAN)** — photo → 3D twin → live-priced redesign → photoreal render; 2 free scans per IP, then a $1 unlock billed through the portal | [`3D Studio/`](3D%20Studio/) | https://3d.unifictional.com | [`README.md`](3D%20Studio/README.md) · [`AGENTS.md`](3D%20Studio/AGENTS.md) |
| Superseded marketing site (kept for reference only, never deploy it) | [`archive/startup-web/`](archive/startup-web/) | — | — |

## Run it

From the repo root (each script just calls the app's own one):

```bash
npm run install:all     # npm install in all three apps
npm run dev:site        # unifictional.com on http://localhost:3010
npm run dev:portal      # Client Portal on http://localhost:8120 (demo mode without a .env.local)
npm run dev:3d          # 3D Studio on http://localhost:3200
npm test                # the portal's 44 node:test cases
npm run deploy:site     # production deploy (same for :portal and :3d) — see the note below
```

**Deploys go through `scripts/deploy.sh`, not a bare `vercel deploy`.** The Vercel team is a Hobby team, which blocks any deployment whose commit author is not the team owner; the CLI attaches the repo's HEAD author, so a deploy from inside the repo by anyone else sits in BLOCKED (shown as UNKNOWN in `vercel ls`). The script deploys from a copy outside the repo, which carries no author and builds normally.

Secrets never live in the repo. Vercel holds every production env var (sensitive ones are write-only); local dev reads `.env.local` in each app. The portal lists the keys it needs on `/admin/setup`.

## How the pieces connect

- **unifictional.com** presents the platform as one thing: the "Platform" section under the hero (`components/sections/platform.tsx`) shows the website builder (→ book a call), SEO Autopilot (→ the portal's `/signup`) and the 3D Studio (→ 3d.unifictional.com/studio) side by side; the gold "Try the 3D studio" pill in the header and the closing CTA repeat the ways in.
- **Sign-up** creates the login and the company; the first sign-in lands on `/autopilot`, where the plan builder takes them to Square checkout. Access unlocks the moment Square confirms the subscription; the client can cancel from the same page.
- **Posts publish** to the blog the portal hosts for the client (`/b/<company>`, the zero-access default), to WordPress (application password), or to a site Unifictional hosts (feed + revalidate ping). Builders with no API (GoDaddy, Squarespace) get a paste-in Inbox request instead.
- **The 3D Studio** calls the portal's `/api/public/3d/*` (shared `PLATFORM_KEY`) to count free scans and sell the $1 unlock; the portal's Plans page lists the studio next to everything else you can buy.
- **The site builder** runs as Trigger.dev tasks (project `proj_tpvzmoxzvbmnzybvthtb`, org `unifictional-81ec`); without `TRIGGER_SECRET_KEY` it falls back to an HTTP step chain, which is how a build can be run locally. Finished sites preview at `unifictional.com/preview/<build id>`; the builds dashboard is `/builds`.

## Where things are

| Thing | Where |
|---|---|
| Vercel team | `jaygatsby988s-projects`: projects `unifictional`, `unifictional-client-portal`, `manhattan` (+ client sites) |
| Database | Supabase (Postgres). Migrations in `Client Portal/supabase/migrations/`, applied by hand to the live DB |
| Payments | Square: subscription plans for Autopilot, Quick Pay links for the $1 studio unlock |
| Models | Anthropic (writer, strategist, builder); OpenAI only on the `research/astra-provider` branch of the site builder |
| Build assets | Vercel Blob (previews, lead records, hero films) |
| Source of truth for the 3D Studio | this repo. `github.com/jayGatsby988/manhattan` is the old standalone repo, left as it was when it moved in |

## Working on it

- One app at a time: `cd` into it, `npm install`, `npm run dev`. Node 24 on Vercel.
- Portal tests: `npm test` at the root. The site builder has no test suite; `npx tsc --noEmit` in `unifictional-site/` and a local build (see `HANDOFF.md`) are the checks.
- Commit messages say what changed for the person reading the log, not which files moved.
