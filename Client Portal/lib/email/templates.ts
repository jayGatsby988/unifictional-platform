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

export function welcomeEmail(o: { name: string; email: string; tempPassword: string; loginUrl: string; company?: string ; signOff?: SignOff }): Email {
  const subject = "Welcome to Unifictional: your login is inside";
  const html = shell(`Thanks for choosing Unifictional, ${first(o.name)}.`, [
    p(`Your client portal${o.company ? ` for <b>${esc(o.company)}</b>` : ""} is ready to sign in to. It shows how your website, Google and social media are doing, all in one place.`),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 22px;background:#f4f3f0;border-radius:12px"><tr><td style="padding:18px 20px;font-family:${FONT}">
<div style="font-size:14px;color:#6b6863;letter-spacing:1px">YOUR EMAIL</div><div style="font-size:19px;margin:4px 0 14px">${esc(o.email)}</div>
<div style="font-size:14px;color:#6b6863;letter-spacing:1px">TEMPORARY PASSWORD</div><div style="font-size:26px;font-weight:bold;font-family:Menlo,Consolas,monospace;margin-top:4px">${esc(o.tempPassword)}</div>
</td></tr></table>`,
    button(o.loginUrl, "Sign in to your portal"),
    p("<b>Three easy steps:</b>"),
    steps(["Tap the button above.", "Type your email and the temporary password shown here.", "Pick your own password. We'll ask you right away, and you'll use it from then on."]),
    p("<b>What happens next:</b> we set up your dashboard and connect your website, usually within one business day. We'll email you the moment it's ready, so there's nothing else you need to do."),
  ].join(""), o.signOff);
  const text = `Thanks for choosing Unifictional, ${(o.name || "").split(" ")[0] || "there"}.

Your client portal is ready to sign in to.
Sign in: ${o.loginUrl}
Email: ${o.email}
Temporary password: ${o.tempPassword}

1. Open the link above.
2. Type your email and the temporary password.
3. Pick your own password when we ask.

We'll set up your dashboard within one business day and email you when it's ready.
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
