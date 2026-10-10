# Unifictional client portal

Public front door: `/` is a lead magnet. A contractor enters their website and
email, `lib/audit.ts` runs Google's PageSpeed test (needs `PSI_API_KEY`; the
keyless quota is shared and usually exhausted) plus ten contractor-specific
on-page checks, grades the site A–F, shows the report inline, stores it in
`audit_reports`, and pushes the lead into GoHighLevel (`GHL_TOKEN`,
`GHL_LOCATION_ID`, tagged brand-unifictional + src-portal). The report's "Where you show up on Google" block (`lib/seo-check.ts`) infers the
trade and city, then checks five local searches for the domain. Live checks need
`GOOGLE_CSE_KEY` + `GOOGLE_CSE_CX` (real Google results) or `BRAVE_SEARCH_KEY`;
without a key the panel still lists the on-page SEO problems but says rankings
are being set up (DuckDuckGo scraping only works outside datacenters).
`/signup` is the
"create account" request: a CRM lead plus a magic-link sign-up; the studio then
links the company on `/admin`.

What a client sees after they sign in: how their website is doing, their search
visibility, their social accounts, and the admin side of the instant-quote tool
that is embedded on their own website (what homeowners generated, and the prices
and options the tool uses).

Stack: Next.js 16 (App Router), Tailwind 4, Supabase (auth + Postgres + storage),
Recharts.

## Run it

```bash
npm install
npm run dev -- -p 8120
```

With no `.env.local` the portal runs in **demo mode**: no login, and every page
renders the seeded client "Northline Builders" (`lib/data/demo.ts`). That is the
state to review the design in.

## Turn on real accounts

1. Restore the `Unifictional Website` Supabase project (it is paused) or create one.
2. Run `supabase/migrations/0001_portal.sql` in the SQL editor.
3. Copy `.env.example` to `.env.local`, fill in the URL + anon key, set `PORTAL_DEMO=false`.
4. Auth → Providers → Email: enable magic links. Auth → URL config: add
   `http://localhost:8120/auth/callback` and the production callback.
5. Insert a row in `clients`, invite the client's email in Auth → Users, then link
   them: `insert into client_members (client_id, user_id) values (...)`.
6. Put your own user id in `portal_admins` to get the client switcher.

Sign-in is passwordless: the client enters their email and gets a link.
`shouldCreateUser: false` means only emails you have invited can sign in.

## The quote tool

The 3D estimator itself lives on each client's website, not here. The portal is
the contractor's admin for it: `estimator_settings.config` holds project types,
base rates, options, markup, range and deposit; the embed reads that config and
computes the same numbers as `lib/quote.ts`. Every homeowner session writes an
`estimator_generations` row (server-side, service role), which is what the
"Quotes homeowners generated" table lists. The contractor changes a lead's status
from the table; publishing pricing writes the config back and logs an activity.

## Billing

Clients get a **Billing** page (`/billing`): amount due with a Pay button, their
monthly plan and next invoice date, the card Square has on file, and every
invoice with a link to Square's hosted page (pay, or print the receipt once
paid). Payment happens on Square's page, so card numbers never touch the portal.
The studio links each company to a Square customer (matched by email, or
created) and sends invoices or starts a monthly plan from **Studio · Billing**
(`/studio/billing`). Square is read live through its REST API
(`lib/billing/square.ts`, Square-Version 2026-09-16); the portal stores only
`clients.square_customer_id` (migration 0009). Needs `SQUARE_ACCESS_TOKEN` in
Vercel (`SQUARE_ENVIRONMENT=sandbox` to test, `SQUARE_LOCATION_ID` if you have
several locations). `/billing?preview=1` shows sample data in local dev only.

**Automation.** Creating a company in Studio links it to Square by email; tick
"Start billing in Square now" to also email the build invoice and start the
monthly plan (`lib/billing/onboard.ts`). Creating a client login links Square
too. `GET /api/health` (Bearer `CRON_SECRET`) reports whether the Supabase
service key and Square token are accepted; `POST /api/ops/test-invoice` sends a
small test invoice.

## Going live with real data

Nothing in the UI calls a third-party API at request time. A daily sync job
(`/api/sync`, Vercel Cron at 06:00 Pacific) pulls from each source and writes
the tables; the portal only reads. `lib/integrations/README.md` documents every
adapter.

**Works without the service-role key.** Portal admins can write every client
table through their own session (migration 0006), so the admin page, OAuth
callbacks and "Run sync now" need only the anon key plus an admin login. The
service-role key is used solely by the unattended nightly cron. The landing
page stores inspections with an insert-only anon policy. `/admin/setup` is the
in-product version of this checklist with the real callback URLs filled in.

**Before a client connects anything.** Every page is connection-aware: a
source that isn't linked shows a "Connect … to see this" card (walkthrough or
"Have us do it") instead of zeros, and Overview shows a setup checklist. The
nightly `health` sync runs the free inspection against the client's site with
no API keys, so Website (grade, fixes in progress) and Search (local searches
checked) have real content from day one. The quote tool offers a starter
price list per trade when the editor is empty (`lib/pricing-templates.ts`).

**Guides for contractors.** `/guide` (public) holds plain-language, exact-menu-
path walkthroughs for Google Analytics, Search Console, Business Profile,
Facebook/Instagram and installing the GA4 tag (`lib/guides.ts`). Append
`?studio` to see the copy-and-paste message to send a client, `?for=Name` to
personalise. Clients see their own connection status and the matching guide at
`/connect` (booleans only, via the `client_connection_status` view).

**The client does nothing.** All linking is done by the studio on `/admin`.
Two ways, mixable per company: connect the studio's own Google/Meta once as the
default (uses the agency access Unifictional already has), or pick a company in
the dropdown and press "Connect Google/Meta for <company>" to link that
company's own accounts separately. A company's own connection always wins over
the studio one.

One-time setup for the studio:

1. **Supabase**: run the six migrations; set `SUPABASE_SERVICE_ROLE_KEY` and a
   `CRON_SECRET`.
2. **Google Cloud**: one project, enable the APIs listed in `.env.example`,
   create an OAuth web client with the callback URL, set
   `GOOGLE_OAUTH_CLIENT_ID/SECRET` (+ `PSI_API_KEY`). Request Business Profile
   API access once (Google's form) if you want listing stats.
3. **Meta**: one app with Facebook Login for Business and the scopes in
   `.env.example`; set `META_APP_ID/SECRET`.
4. Redeploy, open `/admin`, press **Connect Google** and **Connect Meta** with
   the studio's own accounts.

Per client, on `/admin` (about a minute each): choose the company in the
dropdown, optionally connect its own accounts, then pick their Analytics property,
Search Console property, Business Profile listing and Facebook Page from the
dropdowns (Instagram comes with the Page), type the website URL, Save, then
"Run sync now". If a client's property is missing from a list, add the studio
Google account to it in that product's admin, exactly as you do today.

Meta user tokens last ~60 days; the admin page shows "expiring" ten days before
and Reconnect renews it. Page tokens stored per client don't expire.

Unit tests for every adapter's mapping and the quote math: `npm test`.

## Layout

```
app/page.tsx            public landing: free website + SEO inspection (lead magnet) + create account
app/signup, app/report  account request form; permanent link to a stored inspection
app/api/audit           runs lib/audit.ts (PageSpeed + on-page checks), stores it, pushes the lead to GHL
app/(portal)/overview   headline numbers + activity
app/(portal)/website    uptime, Lighthouse scores, traffic, sources, pages, leads
app/(portal)/seo        Search Console clicks/impressions, tracked keywords, GBP, work log
app/(portal)/social     IG/FB accounts, reach, top posts, scheduled posts
app/(portal)/estimator  quote-tool admin: usage stats, generated quotes/leads, pricing editor
app/(portal)/estimator/[id]  one generated quote: what the homeowner saw, contact, status
lib/quote.ts            the quote math (shared contract with the website embed)
app/(portal)/requests   client → studio request form
app/(studio)/studio     STUDIO CRM (admins land here after login): inbox of inspection leads,
                        account requests, client support requests and clients' quote leads,
                        each with status + notes/reply; /studio/companies = every company with
                        health, connections, logins, "Open dashboard" (switch into the client view)
app/(studio)/admin      per-company data sources, connect buttons, sync runs; /admin/setup keys
app/api/sync            daily cron + "Run sync now"
app/api/integrations    studio-level Google / Meta OAuth connect + callback
app/api/admin/options   what the studio accounts can see (fills the admin dropdowns)
lib/integrations        one adapter per source + sync.ts orchestrator
lib/data/repo.ts        getSession() + getPortal(): Supabase → PortalData, or demo
lib/data/demo.ts        the seeded client
supabase/migrations     schema + RLS
proxy.ts                session refresh + redirect to /login
```

Brand tokens in `app/globals.css` are copied from the live unifictional.com
stylesheet (bone/paper/sand/ink/line, Oswald display, Hanken Grotesk, Space Mono).
