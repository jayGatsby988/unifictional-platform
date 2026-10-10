# Data sync

`lib/integrations/sync.ts` runs once a day (Vercel Cron → `GET /api/sync`, see
`vercel.json`) and on demand from the Studio admin page ("Run sync now"). For
every client it pulls each configured source and writes the tables the portal
reads. Sources are isolated: a failing API logs a failed `sync_runs` row and the
others still run.

| Source | Adapter | Reads | Writes | Needs |
|---|---|---|---|---|
| Google Analytics 4 | `ga4.ts` | daily sessions/users/pageviews (60d), lead events, channel groups (30d), top pages (30d) | `website_daily`, `website_snapshots.sources/top_pages` | studio Google account (Viewer on the property) via `studio.ts`; `ga4_property_id` |
| Search Console | `search-console.ts` | clicks/impressions/ctr/position by day (182d), top 25 queries + page (30d) | `seo_daily`, `seo_keywords` (keeps `prev_position`), `activity` when a keyword enters the top 10 | studio Google account (user on the property); `gsc_site_url` |
| PageSpeed Insights | `pagespeed.ts` | Lighthouse scores, LCP, CLS, field INP (mobile) | `website_snapshots` scores/vitals | `site_url`; `PSI_API_KEY` optional |
| Uptime | `pagespeed.ts#checkUptime` | one HTTP check per run | `uptime_checks`, `website_snapshots.uptime_pct/status` | `site_url`. Daily on Hobby; move to hourly on Pro (`vercel.json`) |
| Google Business Profile | `gbp.ts` | 30d views/searches/calls/directions/website clicks for the current and previous period; reviews count + rating | `gbp_snapshots` | studio Google account (manager on the listing), `gbp_location_id`, `gbp_account_id`; Cloud project approved for Business Profile APIs |
| Instagram + Facebook | `meta.ts` | followers, daily reach (30d), profile views, last 12 posts with likes/comments/saves/reach; FB page followers + reach | `social_accounts`, `social_daily`, `social_posts` | studio Meta account (Page admin); the Page token is derived and stored when the Page is assigned |

Credentials live in `studio_connections` (one row per provider, admin-only RLS):
`studio.ts` turns them into access tokens and lists what the accounts can see for
the `/admin` dropdowns (`/api/admin/options`). A service account in
`GOOGLE_SERVICE_ACCOUNT_JSON` is an optional fallback for Analytics + Search
Console when no studio Google account is connected.

Not synced yet: tracked phone calls and form leads (`website_daily.calls`,
`leads`). Those live in GoHighLevel; the natural next adapter reads
`/conversations` and website-sourced contacts for `ghl_contact_id`'s location.
Until then `calls` stays 0 and `form_submissions` comes from GA4 lead events
(`generate_lead`, `form_submit`, `submit_form`, `contact`, `estimator_request`,
`quote_generated`), so make sure each site fires one of those.

Lead events on the client sites: the Unifictional-built sites post their forms
to `/api/lead`; add `gtag('event','generate_lead')` on success and the number
shows up here without any other wiring.
