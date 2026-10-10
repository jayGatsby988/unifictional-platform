# Unifictional booking system — setup

A self-contained, custom booking flow lives on `/contact`. It:

- shows **real-time open slots** from your Google Calendar, **7 AM–11 PM** (configurable), never offering a time you're already busy;
- makes the client **verify their email** with a 6-digit code before anything is booked;
- requires them to **choose a calendar** (Google / Apple / Outlook / .ics) before finishing;
- on confirm: **adds the event to your Google Calendar**, **emails you** all their details, and **emails them** a confirmation with calendar links + an `.ics` attachment;
- sends **daily reminder emails** on a schedule (see _Reminders_).

It works locally with **zero config** (open slots, on-screen dev code, no real emails) so you can click through it. To make it real, set the env vars below.

---

## 1. Environment

Copy the template and fill it in:

```bash
cp .env.local.example .env.local
```

The most important knobs:

| Var | What it does | Default |
| --- | --- | --- |
| `BOOKING_TIMEZONE` | Timezone the hours are in | `America/New_York` |
| `BOOKING_HOURS_START` / `_END` | Bookable window (24h) | `7` / `23` |
| `BOOKING_DURATION_MIN` | Meeting length (min) | `30` |
| `BOOKING_SLOT_STEP_MIN` | Gap between offered slots | `30` |
| `BOOKING_LEAD_MIN` | Minimum notice before a slot is bookable | `720` (12h) |
| `BOOKING_MAX_DAYS` | How far ahead people can book | `60` |
| `OWNER_EMAIL` | Your inbox + the calendar to use | `Unifictional@gmail.com` |
| `NEXT_PUBLIC_SITE_URL` | Public URL (used in email links) | — |

> Generate the two secrets with:
> `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

---

## 2. Google Calendar (real-time availability + auto-add)

You connect the app with a **service account** — a robot identity you grant access to your calendar. You never give the app your Google password.

1. Go to <https://console.cloud.google.com/> and create (or pick) a project.
2. **APIs & Services → Library →** enable the **Google Calendar API**.
3. **APIs & Services → Credentials → Create credentials → Service account.** Name it (e.g. `unifictional-booking`), create it.
4. Open the service account → **Keys → Add key → Create new key → JSON.** A `.json` file downloads. Inside it are `client_email` and `private_key`.
5. Put those in `.env.local`:
   - `GOOGLE_CLIENT_EMAIL` = the `client_email`
   - `GOOGLE_PRIVATE_KEY` = the `private_key` (keep the quotes and the `\n`s)
   - or just paste the whole file into `GOOGLE_SERVICE_ACCOUNT_JSON` on one line.
6. **Share your calendar with the robot.** In Google Calendar (signed in as `Unifictional@gmail.com`): **Settings → Settings for my calendars → [your calendar] → Share with specific people → Add people →** paste the service account's `client_email` → permission **"Make changes to events"** → Send.
7. Confirm `GOOGLE_CALENDAR_ID=Unifictional@gmail.com`.

That's it — availability now reflects your real calendar and confirmed bookings appear on it automatically.

> **Note on invites (personal Gmail):** a service account on a **personal** Gmail can't add calendar *attendees* / send Google invites — Google rejects it without Workspace domain-wide delegation. So keep `GOOGLE_INVITE_ATTENDEES` **off** (the default). The booking still lands on your calendar, and the client gets their invite through the app's own confirmation email (`.ics` attachment + Google/Outlook add-to-calendar links). Only set `GOOGLE_INVITE_ATTENDEES=true` if you're on Google **Workspace** with delegation configured.

---

## 3. Email — send from Unifictional@gmail.com (Gmail App Password)

The verification code and confirmation emails are sent straight from your Gmail using an **App Password** — a single-purpose password Google gives you for apps. You never put your real Google password anywhere.

1. **Turn on 2-Step Verification** for `Unifictional@gmail.com` (Google Account → **Security** → **2-Step Verification**). Required before App Passwords appear.
2. Go to **Google Account → Security → 2-Step Verification → App passwords** (or <https://myaccount.google.com/apppasswords>). Name it e.g. `Unifictional site` and **Create**.
3. Google shows a **16-character** password like `abcd efgh ijkl mnop`. Copy it.
4. Set the env vars:
   - `GMAIL_USER=Unifictional@gmail.com`
   - `GMAIL_APP_PASSWORD=abcd efgh ijkl mnop` (spaces are fine — they're stripped)

That's it. Mail now sends from `Unifictional@gmail.com` over Gmail's SMTP.

> **Alternative (Resend):** if you'd rather send from your own domain instead of Gmail, leave `GMAIL_*` unset and use `RESEND_API_KEY` + `EMAIL_FROM` (verify a domain you own at resend.com — gmail.com can't be verified). Gmail is used whenever it's set; Resend is the fallback.

Without **either**, the flow still runs — the verification code shows on screen in dev and no emails are sent.

---

## 4. Reminders (daily cron)

`GET /api/cron/reminders` sends the day's reminder emails. Rules:

- Booked **≤ 7 days** out → a reminder **every day** until the meeting.
- Booked **> 7 days** out → daily reminders **start when 5 days remain**.
- At most one reminder per booking per day; the "sent today" marker lives on the calendar event, so no database is needed.

**On Vercel** it's already wired: `vercel.json` runs it daily at 14:00 UTC. Set `CRON_SECRET` in your Vercel project env and Vercel sends it automatically as a Bearer token.

Trigger it manually any time:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain.com/api/cron/reminders
```

On another host, point any scheduler (cron, GitHub Actions, cron-job.org) at that URL once a day with the same header. Adjust the time by editing the `schedule` in `vercel.json` (it's UTC).

---

## 5. Abuse protection

Built in: input is sanitized (URLs are forced to http(s); attribute-safe email encoding), the date window is enforced server-side, the verification code is single-use with a per-booking wrong-code cap, confirmations are de-duplicated so replays can't double-send, and `/start` has best-effort per-IP / per-email rate limits.

Those rate limits and the replay guard are **in-memory**, so on Vercel they only hold within a warm function instance. That's enough to stop accidental double-submits and casual bursts. If you ever see real abuse (someone hammering `/start` to email-bomb an address, or burning the Gmail send quota), add a durable limiter — [Upstash Redis](https://upstash.com) + `@upstash/ratelimit` keyed on IP + email — in `app/api/booking/start/route.ts` and `confirm/route.ts`. Once Google Calendar is connected, bookings are also de-duplicated durably via the calendar event itself.

## 6. Going live checklist

- [ ] Env vars set in your host (Vercel → Settings → Environment Variables)
- [ ] `GMAIL_USER` + `GMAIL_APP_PASSWORD` set (2-Step Verification on, App Password created)
- [ ] Calendar API enabled + calendar shared with the service account ("Make changes to events")
- [ ] `GOOGLE_INVITE_ATTENDEES` left off for personal Gmail
- [ ] `BOOKING_SECRET` and `CRON_SECRET` set to long random strings
- [ ] `NEXT_PUBLIC_SITE_URL` = your real URL (`https://unifictional.com`)
- [ ] Booked a test slot end-to-end and got the code + confirmation email

## API reference

| Route | Purpose |
| --- | --- |
| `GET /api/booking/availability?days=21` | Open slots (real-time, busy-aware) |
| `POST /api/booking/start` | Validate + email a verification code; returns a signed token |
| `POST /api/booking/confirm` | Verify code → create event + send both emails |
| `GET/POST /api/cron/reminders` | Daily reminders (secret-protected) |
