# unifictional-site

The agency site plus the AI build system behind its booking form.

Start with **[HANDOFF.md](HANDOFF.md)** and **[HANDOFF-ACCESS.md](HANDOFF-ACCESS.md)** (what to sign into): what it is, how a build runs, where every secret lives, how to deploy and test, and what is unfinished. Then `AI-BUILD.md` (classic pipeline details), `BOOKING_SETUP.md`, `SEO.md`, `lib/build/PORTING.md` (adding pack components).

```bash
npm install
cp .env.local.example .env.local   # fill in the values (see HANDOFF.md)
npm run dev
```
