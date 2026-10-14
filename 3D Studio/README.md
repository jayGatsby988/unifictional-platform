# MANHATTAN

Photo → explorable 3D twin → live-priced redesign, for contractors.

A client sends photos of a kitchen, a bathroom, or a lot. MANHATTAN reconstructs
the space as a 3D twin in about a minute, lets you swap any surface for a real
material, re-prices the job line by line as you go, renders a photoreal image
from the client's own camera angle, and gives you a link the client can spin
around on their phone.

## What it actually does

| Step | What happens | Typical time |
|---|---|---|
| Upload | 1–4 photos, downscaled in the browser, stored in Vercel Blob | 2–5 s |
| Analyze | A vision model reads the room into a strict `RoomSpec`: dimensions, cabinet runs, island, appliances, openings, lighting, and a material per surface | 15–40 s |
| Twin | The spec drives a parametric three.js scene with physically-based materials, HDRI lighting, ambient occlusion and click-to-select surfaces | < 1 s |
| Redesign | Swap any of 276 materials; the 3D view and the estimate update immediately | instant |
| Render | The chosen materials are applied to the original photograph, geometry and light untouched | 45–60 s |
| Jarvis | Astra uses validated tools to edit the design, price options, explain changes, and prepare renders and proposals | varies with tool rounds |
| Share | The project is written to Blob and served read-only at `/p/<id>` | instant |

Estimates are planning-grade, not bids. The UI says so, and the assumptions the
model made are listed next to the number.

## Running it

```bash
npm install
cp .env.example .env.local   # add OPENAI_API_KEY
npm run dev
```

Only `OPENAI_API_KEY` is required — analysis and photoreal rendering both run on
it. Without `BLOB_READ_WRITE_TOKEN` uploads fall back to `public/uploads/` so
the whole flow works locally. `/api/health` reports which providers are live.

Try it without uploading anything: `/studio?demo=kitchen` (also `bathroom`,
`exterior`).

## The landing page's film

The first screen of the landing page (`src/components/landing/Hero.tsx`) plays
`public/hero/studio-demo.mp4` under the site's scrims, with
`studio-demo-poster.jpg` as the first paint and the reduced-motion still. The
film is a generated demo of the product (a phone scanning a kitchen, the twin
rendering over it). To replace it, run `tools/hero-video.sh <clip.mp4> <name>`
(1080p H.264 + poster, macOS tools only) and point `HERO_VIDEO` in
`src/components/landing/content.ts` at the new name: the files are cached
immutable, so a re-export always gets a new name. Without the mp4 the poster
shows with a slow drift, so the page never breaks.

## Layout

```
src/lib/spec/          RoomSpec contracts, zod schemas, default/template specs
src/lib/materials/     276-material catalog: PBR recipe + render phrase + price group
src/lib/estimate/      price book (2026 US, regional) and the estimator
src/lib/jarvis/        Astra orchestration, deterministic tools, design options and proposals
src/lib/ai/            vision analysis, render + scan providers, prompts, sanitizer
src/lib/storage/       Vercel Blob with a local-filesystem fallback
src/components/scene/  the 3D engine and the kitchen/bathroom/exterior builders
src/components/studio/ the studio app
src/components/landing/ the marketing site
docs/RESEARCH.md       provider, pricing and competitor research behind the build
```

One `RoomSpec` feeds the 3D twin, the render prompt and the estimator, so a
material swap moves all three together and they cannot drift apart.

### Materials

Each catalog entry carries three things: a PBR recipe for the 3D view, a
plain-language phrase for the render prompt, and a price group plus tier for the
estimator. Photographic surfaces use CC0 textures from Poly Haven (101 texture
sets and 13 HDRIs, fetched by `scripts/fetch-textures.mjs`). Hero surfaces —
stone slabs, tile, wood floors, siding — are drawn procedurally at their real
module sizes, so a 3×6 inch subway tile really is 152 × 76 mm on the wall and a
Calacatta slab is veined rather than being a photo of the wrong stone.

### Estimating

`calculateEstimate(spec, selections, settings)` derives quantities from the
geometry (cabinet linear feet, counter and backsplash square feet, roof squares,
wall area net of openings), prices them against the tiered price book, then adds
ordering waste, contingency, overhead and profit, and sales tax where the state
taxes construction. Regional multipliers cover 22 metros. It is pure and
synchronous, so it re-runs on every click.

## Deploying

Push to a Vercel project with `OPENAI_API_KEY` set and a Blob store attached.
`vercel --prod` works from the repo root. Rendering runs to 300 s, so use a plan
whose function duration allows it; analysis and Jarvis also allow 300 s.

### Jarvis

Open the **Jarvis** studio tab (shortcut **6**). It uses `gpt-6-astra` through
the server-side `OPENAI_API_KEY`; the account must have access to that model.
There is no silent model fallback. See [docs/JARVIS.md](docs/JARVIS.md) for
the supported actions, validation boundaries and verification commands.

## Limits worth knowing

- Reconstruction is layout-accurate and dimension-approximate. Confirm one real
  measurement before quoting from it.
- The 60-second promise is a median. A slow vision response or a cold render can
  push a first result past it; the UI shows elapsed time rather than hiding it.
- Photoreal renders are generated images. They are a design aid, not a
  photograph of work performed.
- The seeded price book is a starting point. Contractors should overwrite it
  with their own numbers before sending anything to a client.
