# Handoff: what you need to sign into

Everything the Unifictional site and its AI build system run on, and what Aavi has to give you for each. `HANDOFF.md` explains how it all works; this is the access list. Secret values are never in this repo: get them from Aavi as the `.env.local` file.

## 1. Code

- GitHub: https://github.com/jayGatsby988/unifictional-platform, folder `unifictional-site/`. Ask for write access or a token.
- Run locally: Node 24, `npm install`, copy `.env.local` from Aavi, `npm run dev` (port 3000). Typecheck with `npx tsc --noEmit -p tsconfig.json` before any deploy.

## 2. Vercel (the site, the previews, the dashboard, the storage)

- Team `jaygatsby988s-projects`, project `unifictional`, production domain `unifictional.com`. Ask Aavi to add you to the team.
- Deploy from the folder: `vercel deploy --yes --prod` (Vercel CLI, logged in as a team member).
- Vercel Blob store: lives in the same project; the token is `BLOB_READ_WRITE_TOKEN`. Everything a build produces is in it under `builds/<id>/`, lead records under `leads/`, agent memories under `team/memory/`.
- The site's environment variables are in the project settings; they mirror `.env.local`.
- Still needed: a Vercel API token (Account → Tokens, scoped to the team) set as `VERCEL_TOKEN` in the Trigger environment, so finished sites publish to their own `site-<name>.vercel.app` project. Nothing publishes until that exists.

## 3. Trigger.dev (the build workers)

- Project `proj_tpvzmoxzvbmnzybvthtb`. Ask Aavi to invite you to the org.
- Deploy workers from the folder: `export TRIGGER_ACCESS_TOKEN=<your personal token>` then `npx trigger.dev deploy`. A deploy never changes a build already running.
- The production environment variables (model keys, Higgsfield, Blob, booking secret, relay origin, build mode) are set in the dashboard or through the API:
  `GET/POST/PUT https://api.trigger.dev/api/v1/projects/proj_tpvzmoxzvbmnzybvthtb/envvars/prod[/NAME]` with your access token.
- `BUILD_MODE=team` is currently set, so every booking runs the ten-agent team. Unset it to go back to the classic pipeline.
- Runs: the dashboard, or `GET /api/v1/runs?filter[taskIdentifier]=build-site` with the project's `TRIGGER_SECRET_KEY`; cancel with `POST /api/v2/runs/<id>/cancel`.

## 4. Anthropic (the models)

- Eleven keys: the studio key (`ANTHROPIC_API_KEY`, also the Researcher's), one per team role (`AGENT_KEY_ARCHITECT` … `AGENT_KEY_REVIEWER`), and the debug stage's (`DEBUG_ANTHROPIC_API_KEY`). They sit on Aavi's organizations at console.anthropic.com; get access there to watch spend and top up.
- When an organization runs out, the model answers "credit balance is too low" and the build stops with that reason. A classic build costs about $30, a team build up to its cap (currently $90).

## 5. Higgsfield (the film in the hero)

- Account on higgsfield.ai; API keys `HF_API_KEY_ID` and `HF_API_KEY_SECRET`. Credits were low on 2026-10-11, so only one film angle generates until topped up.

## 6. Google (booking)

- Gmail `unifictional@gmail.com` with an app password (`GMAIL_USER`, `GMAIL_APP_PASSWORD`) sends the verification codes, confirmations and build emails. The verification code for a test booking lands in its Sent folder.
- Google Calendar through a service account (`GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_CALENDAR_ID`) for availability and the invite. See `BOOKING_SETUP.md`.

## 7. The build dashboard

- https://unifictional.com/builds. Sign in with the `BUILDS_DASHBOARD_KEY` value (it sets a cookie). Shows every build, its stage, which agent has the floor, cost, notes, the preview link and the live link once publishing works.
- APIs: `/api/build/list` (Bearer the dashboard key), `/api/build/status?id=&file=` (Bearer `BOOKING_SECRET`).

## 8. How to test a change

Book like a customer at https://unifictional.com/contact with a real local company, read the code from the Gmail Sent folder, confirm, then watch the dashboard. Never hand-trigger steps. Each booking spends real money, so typecheck and use the free dev routes first (`/api/dev/crawl`, `/api/dev/gate`, `/api/dev/qa`, `/api/dev/render`, `/api/dev/publish`, `/api/dev/team`; all need `next dev` on port 3000).

## 9. Open items

- Set `VERCEL_TOKEN` on Trigger (publishing).
- Top up Higgsfield.
- Raise team budgets before the next team run (about $20 per agent, 35-minute turns, $150 cap); the first full team run hit every cap.
- The team finish has no SEO score yet.
- The about page links to `/portal`, which has no route in this project.
- Keep local and GitHub in sync both ways: pull before you push; an outward-only sync overwrote a commit once.
