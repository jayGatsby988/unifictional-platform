/**
 * Plain-language setup guides for contractors (and for the studio when it
 * walks a client through the phone). Every step names the exact menu path,
 * because that is the part people get stuck on.
 */

export const STUDIO_EMAIL = "unifictional@gmail.com";

export type Guide = {
  slug: string;
  title: string;
  short: string;
  minutes: number;
  who: string;
  why: string;
  needs: string[];
  tracks: { title: string; intro?: string; steps: { do: string; where?: string; note?: string }[] }[];
  verify: string;
  faq: { q: string; a: string }[];
  message: string; // what the studio pastes to the client
};

export const GUIDES: Guide[] = [
  {
    slug: "create-account",
    title: "Create your portal account",
    short: "Sign up once, then sign in any time with a link we email you. No password to remember.",
    minutes: 2,
    who: "The owner, or whoever at the company wants to see the numbers. Each person can have their own login.",
    why: "Your portal shows how your website, Google listing and social accounts are doing, in one place. Creating the account lets us connect your company to it.",
    needs: ["An email address you check", "A computer, tablet or phone"],
    tracks: [
      {
        title: "Sign up",
        steps: [
          { do: "Open the Unifictional portal in your web browser.", where: "unifictional-client-portal.vercel.app" },
          { do: "Click “Create account” in the top-right corner." },
          { do: "Type your name, your company name and your email address.", note: "Use the email you read every day. That's where your sign-in links go." },
          { do: "Click the black “Create my account” button." },
          { do: "You'll see “You're on the list.” Now open your email." },
          { do: "Open the email with your sign-in link and click it.", note: "Can't find it after a couple of minutes? Look in the Spam or Promotions folder." },
          { do: "You're in. We'll email you when your company's numbers are connected, usually within one business day." },
        ],
      },
      {
        title: "Signing in next time",
        steps: [
          { do: "Go to the portal and click “Client sign in”." },
          { do: "Type your email and click “Email me a sign-in link”." },
          { do: "Open the email and click the link. That's it, every time." },
        ],
      },
    ],
    verify: "After clicking the link in your email you land on your company's Overview page. If it says your account isn't linked yet, that's normal for the first day; we'll connect it and email you.",
    faq: [
      { q: "Do I need a password?", a: "No. Every time you want to sign in, we email you a fresh link. Click it and you're in." },
      { q: "The email never came.", a: "Check Spam and Promotions, then wait two minutes. Still nothing? Email unifictional@gmail.com and we'll get you in." },
      { q: "Can my office manager have a login too?", a: "Yes. They create their own account the same way, and we add them to your company." },
    ],
    message: "Hi — your client portal is ready to sign up for. It takes two minutes and there's no password:\n\n1. Go to unifictional-client-portal.vercel.app\n2. Click Create account, type your name, company and email\n3. Open the email we send and click the link\n\nThere's a short animated walkthrough here if it helps: unifictional-client-portal.vercel.app/guide/create-account",
  },
  {
    slug: "google-analytics",
    title: "Connect Google Analytics",
    short: "So your portal shows visits, people and leads from your website.",
    minutes: 3,
    who: "The owner of the Google account your website's Analytics lives in. If you don't know, it is usually whoever set up the website or the person who owns the company Gmail.",
    why: "Google Analytics counts every visit to your website and every form that gets submitted. The portal reads those numbers daily and shows them next to last month's, so you can see whether the marketing is working. We only need to read; we can't change anything.",
    needs: ["A Google account that already has access to your Analytics (or the company Gmail)", "Two minutes at a computer; the phone app hides the admin menu"],
    tracks: [
      {
        title: "If your website already has Google Analytics",
        intro: "You're giving our studio account read-only access. We do the rest.",
        steps: [
          { do: "Open Google Analytics and sign in.", where: "analytics.google.com" },
          { do: "Click the gear icon, Admin, in the bottom-left corner.", note: "If you see several properties, pick the one named after your website." },
          { do: "Under the Property column, click Property access management." },
          { do: "Click the blue plus button, top right, then Add users." },
          { do: `Type ${STUDIO_EMAIL} in the email box.` },
          { do: "Set the role to Viewer. Leave the other boxes unchecked.", note: "Viewer can read numbers. It cannot edit, delete, or spend anything." },
          { do: "Click Add, top right. That's it." },
          { do: "Tell us the Property ID (optional, it saves us a minute).", where: "Admin → Property → Property details → the number at the top right, like 412345678" },
        ],
      },
      {
        title: "If your website has no Google Analytics yet",
        intro: "Most contractor sites don't. We'll create it for you; you only need to create the Google account it lives in, so the data is yours forever.",
        steps: [
          { do: "If the company already has a Gmail or Google Workspace account, skip to step 3." },
          { do: "Create a Google account with the company email.", where: "accounts.google.com → Create account → For work or my business" },
          { do: "Go to analytics.google.com, sign in with that account, and click Start measuring.", note: "Account name: your company. Property name: your website address. Business size and goals: anything." },
          { do: "When it asks where you want to collect data, choose Web, enter your website address, and click Create stream." },
          { do: "You'll see a Measurement ID like G-ABC12345. Send it to us, or just stop here.", note: "We install the tag on your site. If we built your site, it's already wired to accept it." },
          { do: `Finally add ${STUDIO_EMAIL} as a Viewer, exactly as in the first track above (Admin → Property access management → Add users).` },
        ],
      },
    ],
    verify: "Within one business day your portal's Website page switches from 'not connected' to real visit numbers. The first chart fills in over 60 days as data accrues; leads show as soon as the site's forms fire the lead event.",
    faq: [
      { q: "Can you see my passwords or change my site?", a: "No. Viewer access shows us counts. It cannot log in anywhere, edit your site, or touch billing." },
      { q: "I have Universal Analytics (UA-…) not GA4.", a: "That's the old version Google shut down in 2023; it has stopped collecting. Follow the second track and we'll set up GA4." },
      { q: "My web designer owns the account and I can't reach them.", a: "Follow the second track with your own Google account. We'll install the new tag so your data belongs to you from now on." },
    ],
    message: `Hi — to show your website numbers in your portal I need read-only access to your Google Analytics. It's two minutes:\n\n1. analytics.google.com → Admin (gear, bottom-left)\n2. Property access management → + → Add users\n3. Add ${STUDIO_EMAIL} as Viewer → Add\n\nIf your site has no Analytics yet, tell me and I'll set it up for you.\n\nFull walkthrough with pictures: unifictional-client-portal.vercel.app/guide/google-analytics`,
  },
  {
    slug: "search-console",
    title: "Connect Google Search Console",
    short: "So your portal shows Google clicks, impressions and keyword positions.",
    minutes: 2,
    who: "Whoever owns the Google account that verified your website with Google, often the same person as Analytics.",
    why: "Search Console is Google's own report of which searches showed your site, how often it was clicked, and where it ranked. It's the only place those numbers exist.",
    needs: ["A Google account that is already an Owner of the property in Search Console", "Or: ability to add a DNS record / upload a file to the site, if it was never verified (we can do that part)"],
    tracks: [
      {
        title: "If your site is already in Search Console",
        steps: [
          { do: "Open Search Console and sign in.", where: "search.google.com/search-console" },
          { do: "Pick your website in the property dropdown, top left." },
          { do: "Click Settings in the left menu, then Users and permissions." },
          { do: "Click Add user, top right." },
          { do: `Enter ${STUDIO_EMAIL} and set permission to Full.`, note: "Full lets us see every report and fix indexing problems. Restricted works too, but we can't request re-indexing after fixes." },
          { do: "Click Add." },
        ],
      },
      {
        title: "If your site was never verified",
        intro: "Nothing for you to do. If we built or host your website we verify it ourselves. If someone else hosts it, we'll send you one DNS record to add, or add it for you if you share the domain login.",
        steps: [
          { do: "Reply to us with who hosts your website (GoDaddy, Squarespace, Wix, a developer...)." },
          { do: "We verify the domain and the data starts collecting. Search Console only reports from the day it's verified, so sooner is better." },
        ],
      },
    ],
    verify: "Your Search page in the portal shows clicks and impressions by day and your top keywords. Search Console lags by about two days, so the latest two days are always blank.",
    faq: [
      { q: "Is this the same as Google Analytics?", a: "No. Analytics counts what happens on your site; Search Console reports what happened on Google before the click. The portal uses both." },
      { q: "I see two properties, a URL one and a domain one.", a: "Add us on the Domain property (sc-domain:) if it exists; it covers www, non-www, http and https at once." },
    ],
    message: `Hi — one more two-minute access grant so your portal can show Google search numbers:\n\n1. search.google.com/search-console → pick your site\n2. Settings → Users and permissions → Add user\n3. ${STUDIO_EMAIL}, permission Full → Add\n\nIf your site isn't in Search Console, no action needed — tell me who hosts it and I'll verify it.\n\nWalkthrough: unifictional-client-portal.vercel.app/guide/search-console`,
  },
  {
    slug: "business-profile",
    title: "Connect Google Business Profile",
    short: "So your portal shows map views, calls, direction requests and reviews.",
    minutes: 3,
    who: "The person who manages your Google Business Profile, the listing that appears on Google Maps. Usually the owner.",
    why: "For local trades, the map listing drives more calls than the website. The portal tracks how often it was seen, how many people called or asked for directions from it, and your reviews.",
    needs: ["Access to the Google account that owns or manages the listing", "The listing must be verified (it is, if it already shows your reviews on Maps)"],
    tracks: [
      {
        title: "Add our studio as a manager",
        steps: [
          { do: "Search Google for your business name while signed in to the owner's Google account.", note: "You'll see a panel 'Your business on Google' above the results. If you don't, sign in with a different account or open business.google.com." },
          { do: "Click the three-dot menu in that panel, then Business Profile settings." },
          { do: "Click People and access." },
          { do: "Click Add, enter " + STUDIO_EMAIL + ", choose Manager, and click Invite.", note: "Manager can post updates and reply to reviews on your behalf, which is part of what we do. Owner is not needed." },
          { do: "We accept the invitation on our side. Done." },
        ],
      },
      {
        title: "If you don't have a Business Profile yet",
        intro: "We'll create and verify one with you; Google usually mails a postcard or asks for a short video of the shop or truck.",
        steps: [
          { do: "Tell us the exact business name, address (or service area if you work from home), phone and hours." },
          { do: "We create the listing under your Google account with you on a 10-minute call, then handle the verification steps." },
        ],
      },
    ],
    verify: "The Search page in the portal gains a Google Business Profile card: profile views, calls, direction requests, website clicks, review count and rating, with last month beside them.",
    faq: [
      { q: "Will you change my listing?", a: "Only what we agree on: photos, posts, hours, replies to reviews. Everything shows in the portal's work log." },
      { q: "Someone else claimed my listing.", a: "Google has a request-ownership flow that takes about a week. Tell us and we'll start it." },
    ],
    message: `Hi — to track your Google Maps listing in the portal (calls, direction requests, reviews) please add us as a manager:\n\n1. Google your business name while signed in as the owner\n2. In 'Your business on Google' → three dots → Business Profile settings → People and access\n3. Add → ${STUDIO_EMAIL} → Manager → Invite\n\nWalkthrough: unifictional-client-portal.vercel.app/guide/business-profile`,
  },
  {
    slug: "facebook-instagram",
    title: "Connect Facebook & Instagram",
    short: "So your portal shows followers, reach and how each post performed.",
    minutes: 4,
    who: "An admin of your Facebook Page. Instagram comes along automatically once it's linked to the Page.",
    why: "We post for you and need to show you what it reached. Meta only releases those numbers to apps that a Page admin has approved.",
    needs: ["Admin access to the company Facebook Page", "Instagram switched to a Professional (Business or Creator) account and linked to that Page"],
    tracks: [
      {
        title: "Give our studio access to the Page",
        steps: [
          { do: "Open your Facebook Page and click Settings (left menu, or Professional dashboard → Settings).", where: "facebook.com/<your page>" },
          { do: "Click Page access (sometimes called New Pages experience → Page access)." },
          { do: "Under People with Facebook access, click Add new, then Next." },
          { do: "Search for the Unifictional Facebook profile we'll give you, tick 'Allow this person to have full control' only if we're also running ads; otherwise leave it off, and click Give access.", note: "Content, messages and insights access is enough for the portal." },
          { do: "Enter your password to confirm." },
        ],
      },
      {
        title: "Link Instagram to the Page (if it isn't)",
        steps: [
          { do: "On your phone, Instagram → profile → menu → Settings → Account type and tools → Switch to professional account, if you haven't." },
          { do: "Page Settings on Facebook → Linked accounts → Instagram → Connect account, and sign in to Instagram." },
          { do: "That's it. When we connect the Page, Instagram's numbers come with it." },
        ],
      },
    ],
    verify: "Your Social page shows follower counts, 30-day reach, profile visits, your recent posts with likes, comments and saves, and what's scheduled next.",
    faq: [
      { q: "Do you get my Facebook password?", a: "No. Page access is role-based; you can remove us any time from the same screen." },
      { q: "I only use Instagram, no Facebook Page.", a: "Instagram's numbers are only available through a linked Facebook Page. Creating a Page takes five minutes; we'll do it with you." },
    ],
    message: `Hi — to show your social numbers in the portal I need access to the Facebook Page (Instagram comes with it):\n\n1. Your Page → Settings → Page access\n2. People with Facebook access → Add new → search 'Unifictional' → Give access\n\nIf Instagram isn't linked to the Page yet: Page Settings → Linked accounts → Instagram → Connect.\n\nWalkthrough: unifictional-client-portal.vercel.app/guide/facebook-instagram`,
  },
  {
    slug: "website-tag",
    title: "Install the Google Analytics tag",
    short: "For sites we didn't build: where the G- tag goes on common platforms.",
    minutes: 5,
    who: "Whoever can edit your website. If Unifictional built it, skip this; it's done.",
    why: "Analytics can only count visits if its tag loads on every page. One paste, once.",
    needs: ["Your Measurement ID, which looks like G-ABC12345 (Analytics → Admin → Data streams → your site)"],
    tracks: [
      {
        title: "By platform",
        steps: [
          { do: "Squarespace: Settings → Developer tools → External API keys → Google Analytics account number → paste the G- ID → Save." },
          { do: "Wix: Settings → Marketing integrations → Google Analytics → Connect → paste the G- ID." },
          { do: "WordPress: install the 'Site Kit by Google' plugin → Connect → it finds the property itself. No code." },
          { do: "Shopify: Online store → Preferences → Google Analytics → paste the G- ID." },
          { do: "GoDaddy Website Builder: Settings → Analytics and tracking → Google Analytics → paste the G- ID." },
          { do: "Custom / developer-built site: ask them to add the gtag.js snippet from Analytics → Admin → Data streams → View tag instructions, inside <head> on every page." },
        ],
      },
      {
        title: "Make form submissions count as leads",
        intro: "Visits are nice; leads are the point. The portal counts a lead when the site fires one of these events: generate_lead, form_submit, submit_form, contact.",
        steps: [
          { do: "Wix, Squarespace, WordPress Site Kit: form submissions already send form_submit when 'enhanced measurement' is on (Analytics → Admin → Data streams → your site → Enhanced measurement → Form interactions). Turn it on." },
          { do: "Custom site: after a successful submit, run gtag('event', 'generate_lead'). We'll send the one-line snippet." },
        ],
      },
    ],
    verify: "In Analytics, open Reports → Realtime, then load your site in another tab. You should see 1 active user within 30 seconds. Submit a test form and watch form_submit or generate_lead appear under Event count.",
    faq: [
      { q: "There's already a UA- code on the site.", a: "Leave it or remove it; it does nothing since 2023. Add the G- tag as well." },
      { q: "Do I need Google Tag Manager?", a: "No. The direct G- tag is simpler and enough for the portal." },
    ],
    message: `Hi — your site needs the Google Analytics tag so visits get counted. Your Measurement ID is G-XXXXXXX. Where to paste it depends on the platform; the guide lists Squarespace, Wix, WordPress, Shopify and GoDaddy: unifictional-client-portal.vercel.app/guide/website-tag — or send me a login and I'll do it.`,
  },
];

export function getGuide(slug: string) {
  return GUIDES.find((g) => g.slug === slug) ?? null;
}
