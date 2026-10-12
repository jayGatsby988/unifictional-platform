# Unifictional platform

One repo, three deployable apps, one placeholder. Each app has its own `package.json`, Vercel project and docs.

| Folder | What it is | Live at | Deploy |
|---|---|---|---|
| `Client Portal/` | The product. Client dashboard + self-serve **SEO Autopilot** (sign up → build a plan → pay on Square → posts researched, written, checked and published automatically) + the studio back office. Next.js 16, Supabase, Square, Anthropic. | https://unifictional-client-portal.vercel.app | `vercel deploy --prod` from the folder (project `unifictional-client-portal`; not GitHub-linked, so pushing to `main` deploys nothing). Migrations in `supabase/migrations/`, applied by hand to the live DB. |
| `unifictional-site/` | The agency marketing site that is live on unifictional.com, with the booking flow and the AI site-build pipeline behind it (Trigger.dev). Start with its `HANDOFF.md`. | https://unifictional.com | Vercel project `unifictional`. |
| `Unifictional Startup Web/` | **Superseded.** An earlier copy of the marketing site with "growth platform" sections (portal preview, quote tool). Not deployed; kept only until its platform sections are ported into `unifictional-site/`. Do not deploy it: it targets the same Vercel project as `unifictional-site/`. | — | — |
| `3D Modeling/` | Placeholder for the embeddable 3D quote tool. No code yet; the portal's "3D Quote Tool" plan is unpublished until this ships. | — | — |

## How the pieces connect

- unifictional.com's "Start SEO Autopilot" / "Preview the portal" buttons send people to the Client Portal's `/signup`.
- Sign-up creates the login and the company; the first sign-in lands on `/autopilot`, where the plan builder (`/plans` shows the same thing) takes them to Square checkout. Access unlocks the moment Square confirms the subscription.
- Posts publish automatically to: the blog the portal hosts for the client (`/b/<company>`, the default and the only option that needs zero access), WordPress (application password), or a site Unifictional hosts (feed/GitHub). Builders with no API (GoDaddy, Squarespace) can instead be pasted into: the studio gets an Inbox request + email, and "It's live" on the post closes it.
- Client sites Unifictional hosts (e.g. DIGS, ENF) render their blog from `/api/autopilot/feed?client=<slug>` and expose `/api/revalidate` for the portal to ping.

## Working on it

- Each app: `npm install`, `npm run dev`. The portal runs in demo mode (seeded "Northline Builders") without a `.env.local`; keys are listed on `/admin/setup`.
- Portal tests: `npm test` in `Client Portal/` (node:test over `tests/*.test.mjs`).
- Secrets never live in the repo. Vercel holds production env vars; sensitive ones are write-only.
