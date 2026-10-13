/**
 * Emails written for busy owners who aren't on screens all day: big type, one obvious
 * button, plain steps, and a human to reply to. Table layout + inline styles so they
 * render the same in Gmail, Outlook and Apple Mail. Black-and-white Unifictional brand.
 */
type Email = { subject: string; html: string; text: string };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const first = (name: string) => esc((name || "").trim().split(/\s+/)[0] || "there");
const FONT = "Helvetica, Arial, sans-serif";

export type SignOff = { name: string; title: string } | null;

function shell(title: string, body: string, signOff: SignOff = null) {
  const sig = signOff
    ? `<p style="margin:8px 0 0;font-size:18px;line-height:1.5">Talk soon,<br><b>${esc(signOff.name)}</b><br><span style="color:#6b6863;font-size:15px">${esc(signOff.title)}</span></p>`
    : `<p style="margin:8px 0 0;font-size:18px;line-height:1.5">Talk soon,<br><b>The Unifictional team</b></p>`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f3f0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3f0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e3e1dc;border-radius:14px;overflow:hidden">
<tr><td style="background:#111111;padding:22px 28px;font-family:${FONT};color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:2px">UNIFICTIONAL</td></tr>
<tr><td style="padding:30px 28px 8px;font-family:${FONT};color:#111111">
<h1 style="margin:0 0 16px;font-size:28px;line-height:1.2">${title}</h1>
${body}
${sig}
</td></tr>
<tr><td style="padding:8px 28px 28px;font-family:${FONT};color:#6b6863;font-size:15px;line-height:1.5">
Questions? Just reply to this email. We usually answer the same day.<br><br>
Unifictional · Marketing for builders &amp; remodelers · Everett, WA
</td></tr></table></td></tr></table></body></html>`;
}
const p = (t: string) => `<p style="margin:0 0 16px;font-size:18px;line-height:1.55">${t}</p>`;
const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="background:#111111;border-radius:999px">
<a href="${href}" style="display:inline-block;padding:16px 34px;font-family:${FONT};font-size:19px;font-weight:bold;color:#ffffff;text-decoration:none">${label}</a></td></tr></table>`;
const steps = (items: string[]) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px">${items.map((s, i) =>
  `<tr><td valign="top" style="padding:6px 12px 6px 0;font-family:${FONT};font-size:18px;font-weight:bold">${i + 1}.</td><td style="padding:6px 0;font-family:${FONT};font-size:18px;line-height:1.5">${s}</td></tr>`).join("")}</table>`;

/**
 * A password tucked into the email, one tap to select. Email apps strip scripts, so a real
 * "copy" button can't work; `user-select:all` makes a single tap/click select the whole
 * thing in Apple Mail, iOS Mail and Outlook, and the long-press tip covers Gmail.
 */
const copyBox = (label: string, value: string, big = false) =>
  `<div style="font-size:14px;color:#6b6863;letter-spacing:1px;margin-bottom:6px">${label}</div>
<div style="display:inline-block;background:#ffffff;border:2px dashed #b9b5ad;border-radius:10px;padding:10px 16px;font-size:${big ? 26 : 19}px;${big ? "font-weight:bold;font-family:Menlo,Consolas,monospace;letter-spacing:1px;" : ""}color:#111111;-webkit-user-select:all;user-select:all">${esc(value)}</div>`;

export function welcomeEmail(o: { name: string; email: string; tempPassword: string; signInUrl: string; loginUrl: string; company?: string; signOff?: SignOff }): Email {
  const subject = "Welcome to Unifictional: tap to sign in";
  const html = shell(`Thanks for choosing Unifictional, ${first(o.name)}.`, [
    p(`Your client portal${o.company ? ` for <b>${esc(o.company)}</b>` : ""} is ready. It shows how your website, Google and social media are doing, all in one place.`),
    p("<b>Getting in takes one tap.</b> No password to type:"),
    button(o.signInUrl, "Sign me in &rarr;"),
    steps(["Tap <b>Sign me in</b> above. You&rsquo;re in, nothing to type.", "We&rsquo;ll ask you to pick your own password, so next time you can sign in from any device."]),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 22px;background:#f4f3f0;border-radius:12px"><tr><td style="padding:18px 20px;font-family:${FONT};color:#111111">
<div style="font-size:16px;font-weight:bold;margin-bottom:4px">Button not working? Sign in by hand instead.</div>
<div style="font-size:15px;color:#6b6863;line-height:1.5;margin-bottom:14px">Go to <a href="${o.loginUrl}" style="color:#111111">the sign-in page</a> (your email is already filled in), then copy the password below. <b>Tip:</b> tap the password once, or press and hold it, then choose <b>Copy</b>.</div>
${copyBox("YOUR EMAIL", o.email)}
<div style="height:14px;line-height:14px">&nbsp;</div>
${copyBox("TEMPORARY PASSWORD", o.tempPassword, true)}
</td></tr></table>`,
    p("<b>What happens next:</b> we set up your dashboard and connect your website, usually within one business day. We&rsquo;ll email you the moment it&rsquo;s ready, so there&rsquo;s nothing else you need to do."),
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#6b6863">The <b>Sign me in</b> button works for 14 days, or until you pick your own password. Please don&rsquo;t forward this email: anyone with it can open your portal.</p>`,
  ].join(""), o.signOff);
  const text = `Thanks for choosing Unifictional, ${(o.name || "").split(" ")[0] || "there"}.

Your client portal is ready. Getting in takes one tap, no password to type:

SIGN ME IN: ${o.signInUrl}

We'll then ask you to pick your own password.

Link not working? Sign in by hand:
${o.loginUrl}
Email: ${o.email}
Temporary password: ${o.tempPassword}

We'll set up your dashboard within one business day and email you when it's ready.
The sign-in link works for 14 days or until you pick your own password. Please don't forward this email.
Questions? Just reply to this email.`;
  return { subject, html, text };
}

export function signInLinkEmail(o: { name: string; link: string ; signOff?: SignOff }): Email {
  const subject = "Your Unifictional sign-in link";
  const html = shell(`Here's your sign-in link, ${first(o.name)}.`, [
    p("Tap the button to sign in. No password needed. Once you're in, we'll ask you to pick a new password."),
    button(o.link, "Sign me in"),
    p("This link works once and expires in an hour. If you didn't ask for it, you can ignore this email; your account is safe."),
  ].join(""), o.signOff);
  const text = `Sign in to Unifictional (works once, expires in an hour):\n${o.link}\n\nIf you didn't ask for this, ignore this email.`;
  return { subject, html, text };
}

export function dashboardReadyEmail(o: { name: string; company: string; loginUrl: string ; signOff?: SignOff }): Email {
  const subject = `Your ${o.company} dashboard is ready`;
  const html = shell(`Your dashboard is ready, ${first(o.name)}.`, [
    p(`We've connected <b>${esc(o.company)}</b> to your portal. Sign in to see how your website, Google and social media are doing.`),
    button(o.loginUrl, "Open my dashboard"),
    p("Forgot your password? On the sign-in page, tap <b>“Email me a sign-in link”</b> and we'll send you a one-tap link."),
  ].join(""), o.signOff);
  const text = `Your ${o.company} dashboard is ready.\nSign in: ${o.loginUrl}\nForgot your password? Use "Email me a sign-in link" on the sign-in page.`;
  return { subject, html, text };
}

export function studioNewSignupEmail(o: { name: string; company: string; email: string; phone?: string; website?: string; studioUrl: string; reportUrl?: string }): Email {
  const subject = `New portal sign-up: ${o.company}`;
  const rows = [["Name", o.name], ["Company", o.company], ["Email", o.email], ["Phone", o.phone || "—"], ["Website", o.website || "—"]]
    .map(([k, v]) => `<tr><td style="padding:6px 14px 6px 0;font-family:${FONT};font-size:16px;color:#6b6863">${k}</td><td style="padding:6px 0;font-family:${FONT};font-size:16px">${esc(String(v))}</td></tr>`).join("");
  const html = shell("New sign-up", [
    p(`${esc(o.name)} from <b>${esc(o.company)}</b> just created a portal account. Their login and welcome email went out automatically.`),
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px">${rows}</table>`,
    button(o.studioUrl, "Open in Studio"),
    o.reportUrl ? p(`Their free website check: <a href="${o.reportUrl}">${o.reportUrl}</a>`) : "",
  ].join(""));
  const text = `New portal sign-up: ${o.name}, ${o.company}\nEmail: ${o.email}\nPhone: ${o.phone || "-"}\nWebsite: ${o.website || "-"}\nStudio: ${o.studioUrl}${o.reportUrl ? `\nWebsite check: ${o.reportUrl}` : ""}`;
  return { subject, html, text };
}

/** Studio: a post is written for a GoDaddy/Wix/… client and waits for someone to paste it. */
export function studioPastePostEmail(o: { company: string; platform: string; title: string; access: string; portalUrl: string }): Email {
  return {
    subject: `Paste on ${o.platform}: ${o.title} (${o.company})`,
    html: shell(
      `A post is ready to paste for ${esc(o.company)}`,
      p(`<b>${esc(o.title)}</b> passed the SEO check and is waiting on their SEO Autopilot page.`) +
      p(`Site: <b>${esc(o.platform)}</b> · ${esc(o.access)}.`) +
      button(o.portalUrl, "Open their page") +
      p(`Copy it as HTML, paste it on ${esc(o.platform)}, then tap “It’s live” on the post with the URL so the client sees it and the request closes.`),
    ),
    text: `A post is ready to paste for ${o.company}\n\n"${o.title}" passed the SEO check and is waiting on their SEO Autopilot page.\nSite: ${o.platform} · ${o.access}.\n\nOpen their page: ${o.portalUrl}\n\nCopy it as HTML, paste it on ${o.platform}, then tap "It's live" on the post with the URL.`,
  };
}

/** Studio: a client sent a request from the portal. */
export function studioNewRequestEmail(o: { company: string; email: string; type: string; title: string; body: string; studioUrl: string }): Email {
  return {
    subject: `New request from ${o.company}: ${o.title}`,
    html: shell(`New request from ${esc(o.company)}`, [
      p(`<b>${esc(o.title)}</b> <span style="color:#6b6863">(${esc(o.type)})</span>`),
      o.body ? `<div style="margin:0 0 18px;padding:14px 16px;background:#f4f3f0;border-radius:10px;font-family:${FONT};font-size:17px;line-height:1.5;white-space:pre-wrap">${esc(o.body)}</div>` : "",
      p(`From ${esc(o.email || "their portal login")}. Reply in Studio and they get it by email.`),
      button(o.studioUrl, "Open in Studio"),
    ].join("")),
    text: `New request from ${o.company}: ${o.title} (${o.type})\n\n${o.body}\n\nFrom: ${o.email}\nOpen in Studio: ${o.studioUrl}`,
  };
}

/** Client: we answered their request. The answer is in the email itself, so they never have to sign in to read it. */
export function requestReplyEmail(o: { name?: string; title: string; reply: string; done: boolean; portalUrl: string; signOff?: SignOff }): Email {
  const subject = `Re: ${o.title}`;
  const html = shell(`We answered your request${o.name ? `, ${first(o.name)}` : ""}.`, [
    p(`You asked: <b>${esc(o.title)}</b>`),
    `<div style="margin:0 0 20px;padding:16px 18px;background:#f4f3f0;border-left:4px solid #111111;border-radius:8px;font-family:${FONT};font-size:18px;line-height:1.55;white-space:pre-wrap">${esc(o.reply)}</div>`,
    o.done ? p("We've marked this one <b>done</b>. If anything still looks off, just reply to this email.") : p("Want to add something? Just reply to this email."),
    button(o.portalUrl, "See it in my portal"),
  ].join(""), o.signOff);
  const text = `You asked: ${o.title}\n\n${o.reply}\n\n${o.done ? "We've marked this done. " : ""}Reply to this email to add anything.\nYour portal: ${o.portalUrl}`;
  return { subject, html, text };
}

/** Client: a new SEO Autopilot article is waiting for their OK (nothing goes live until they tap approve). */
export function postNeedsOkEmail(o: { name?: string; title: string; excerpt?: string; held: boolean; reviewUrl: string; signOff?: SignOff }): Email {
  const subject = `Ready for your OK: ${o.title}`;
  const html = shell(`A new article is ready for you${o.name ? `, ${first(o.name)}` : ""}.`, [
    p(`We wrote <b>${esc(o.title)}</b> for your website.`),
    o.excerpt ? `<p style="margin:0 0 18px;font-size:17px;line-height:1.55;color:#4a4744;font-style:italic">${esc(o.excerpt)}</p>` : "",
    p(o.held ? "It needs a quick look from you before it goes live. Tap below, read it, and tap <b>Approve</b> or tell us what to change." : "Tap below, give it a read, and tap <b>Approve</b>. We'll publish it for you."),
    button(o.reviewUrl, "Review the article"),
    p("Don't have time? Reply <b>“looks good”</b> to this email and we'll publish it."),
  ].join(""), o.signOff);
  const text = `A new article is ready for your OK: ${o.title}\n\n${o.excerpt ?? ""}\n\nReview it: ${o.reviewUrl}\nOr reply "looks good" and we'll publish it.`;
  return { subject, html, text };
}

export type MonthlyLine = { label: string; now: number; prev: number | null };

/** Client: the monthly summary. Big numbers, a plain arrow against last month, what we did, what's waiting on them. */
export function monthlyReportEmail(o: { name?: string; company: string; month: string; lines: MonthlyLine[]; published: { title: string; url: string | null }[]; did: string[]; waiting: number; portalUrl: string; signOff?: SignOff }): Email {
  const subject = `${o.company}: your ${o.month} update`;
  const trend = (l: MonthlyLine) => {
    if (l.prev === null || l.prev === undefined) return "";
    const d = l.now - l.prev;
    if (d === 0) return `<span style="color:#6b6863">same as last month</span>`;
    return d > 0 ? `<span style="color:#1d7a3e">&#9650; ${d.toLocaleString("en-US")} more than last month</span>` : `<span style="color:#a23b2a">&#9660; ${(-d).toLocaleString("en-US")} fewer than last month</span>`;
  };
  const rows = o.lines.map((l) => `<tr><td style="padding:12px 0;border-bottom:1px solid #e3e1dc;font-family:${FONT}">
<div style="font-size:15px;color:#6b6863">${esc(l.label)}</div>
<div style="font-size:30px;font-weight:bold;line-height:1.2">${l.now.toLocaleString("en-US")}</div>
<div style="font-size:15px">${trend(l)}</div></td></tr>`).join("");
  const list = (items: string[]) => `<ul style="margin:0 0 20px;padding-left:22px;font-family:${FONT};font-size:17px;line-height:1.6">${items.join("")}</ul>`;
  const html = shell(`Here's your ${esc(o.month)} update${o.name ? `, ${first(o.name)}` : ""}.`, [
    p(`How <b>${esc(o.company)}</b> did over the last 30 days.`),
    rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px">${rows}</table>` : "",
    o.published.length ? p("<b>New articles we published for you:</b>") + list(o.published.map((x) => `<li>${x.url ? `<a href="${esc(x.url)}" style="color:#111111">${esc(x.title)}</a>` : esc(x.title)}</li>`)) : "",
    o.did.length ? p("<b>What else we did:</b>") + list(o.did.map((t) => `<li>${esc(t)}</li>`)) : "",
    o.waiting ? `<div style="margin:0 0 20px;padding:14px 16px;background:#fff6e0;border-radius:10px;font-family:${FONT};font-size:17px;line-height:1.5"><b>${o.waiting} article${o.waiting === 1 ? " is" : "s are"} waiting for your OK.</b> Nothing goes live until you approve.</div>` : "",
    button(o.portalUrl, "See my full dashboard"),
    p("Questions about any of this? Just reply. A real person reads every email."),
  ].join(""), o.signOff);
  const text = [`Your ${o.month} update for ${o.company} (last 30 days)`, "",
    ...o.lines.map((l) => `${l.label}: ${l.now}${l.prev === null ? "" : ` (last month ${l.prev})`}`),
    ...(o.published.length ? ["", "New articles:", ...o.published.map((x) => `- ${x.title}${x.url ? ` ${x.url}` : ""}`)] : []),
    ...(o.did.length ? ["", "What else we did:", ...o.did.map((t) => `- ${t}`)] : []),
    ...(o.waiting ? ["", `${o.waiting} article(s) waiting for your OK.`] : []),
    "", `Your dashboard: ${o.portalUrl}`, "Questions? Just reply."].join("\n");
  return { subject, html, text };
}
