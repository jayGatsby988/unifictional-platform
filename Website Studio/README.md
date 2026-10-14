# Website Studio

The interactive site builder: paste a client's current site (or describe the one they want) and watch the studio research the business, choose components from the Awwwards pack, write the copy and render the site live, then run its SEO agent and export the HTML.

- **Live:** https://unifictional-studio.vercel.app/studio (Vercel project `unifictional-studio`, linked in `.vercel/`).
- **Shape:** a static front end in `public/` (`studio.html` is the app, `index.html` its landing) and Node functions in `api/` (`research`, `analyze`, `generate`, `edit`, `seo`, `health`), all calling Claude through `api/_lib/http.js`. No build step.
- **Env:** `ANTHROPIC_API_KEY` (set on Vercel; for local runs put it in `.env.local`, which is gitignored). `UNIF_MODEL` overrides the model (default `claude-opus-5-5`). Without a key the API answers `{mode:"local"}` and the studio runs its local fallback.
- **Run:** `npm install`, then `npm run dev` (http://localhost:3300/studio). From the repo root: `npm run dev:web`.
- **Deploy:** `npm run deploy:web` from the repo root (deploys from a git-free copy; see the root README).

## How it relates to the other builder

`unifictional-site/lib/build/` is the automated pipeline that runs when a lead books a call (researched, planned, written, gated in a real browser, published) on Trigger.dev. Its model layer was ported from this studio's `api/_lib/http.js`. This studio is the hands-on version: a person drives it, sees every step and edits in plain English.

This source was recovered on 2026-10-13 from the production deployment (it had been deployed from a laptop and was not in any repo). `tools/dev.mjs` and this README were added then; everything else is exactly what was live.
