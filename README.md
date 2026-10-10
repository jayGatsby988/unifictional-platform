# Unifictional

Everything that runs Unifictional, the growth platform for contractors.

| Folder | What it is | Live |
|---|---|---|
| `Unifictional Startup Web/` | Marketing site (Next.js) | https://unifictional.com |
| `Client Portal/` | Contractor portal + studio CRM: website health, search, social, quote-tool pricing, billing (Square), plans (Next.js + Supabase) | https://unifictional-client-portal.vercel.app |
| `3D Modeling/` | 3D instant-quote tool that embeds on contractors' sites | in progress |

Each app has its own `README.md`, `package.json` and Vercel project. Secrets live only in
each app's `.env.local` / Vercel environment variables and are never committed.
