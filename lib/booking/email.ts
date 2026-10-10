import nodemailer, { type Transporter } from "nodemailer";
import { Resend } from "resend";

import { bookingConfig, gmailConfigured, resendConfigured } from "./config";
import type { CalendarLinks } from "./ics";
import { formatFullDateTime } from "./time";

const ACCENT = "#b85c38";
const INK = "#1a1714";
const SOFT = "#5c554d";
const MUTED = "#8a8278";
const PAPER = "#f7f3ec";
const CARD = "#ffffff";
const LINE = "#e7e0d4";

function resendClient() {
  return new Resend(process.env.RESEND_API_KEY);
}

/** Reused across invocations within a warm function (saves the TLS handshake). */
let _smtp: Transporter | null = null;
function gmailTransport(): Transporter {
  if (!_smtp) {
    _smtp = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: bookingConfig.gmailUser, pass: bookingConfig.gmailAppPassword },
    });
  }
  return _smtp;
}

/** Gmail must send From its own authenticated account (or an alias of it). */
function gmailFrom(): string {
  return `${bookingConfig.ownerName} <${bookingConfig.gmailUser}>`;
}

interface SendResult {
  sent: boolean;
  skipped?: boolean;
  id?: string;
  error?: string;
}

async function send(opts: {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  attachments?: { filename: string; content: string; contentType?: string }[];
}): Promise<SendResult> {
  // Prefer Gmail SMTP (sends from unifictional@gmail.com); fall back to Resend.
  if (gmailConfigured()) {
    try {
      const info = await gmailTransport().sendMail({
        from: gmailFrom(),
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        replyTo: opts.replyTo,
        attachments: opts.attachments?.map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.content, "base64"),
          contentType: a.contentType,
        })),
      });
      return { sent: true, id: info.messageId };
    } catch (err) {
      return { sent: false, error: err instanceof Error ? err.message : "gmail send failed" };
    }
  }

  if (resendConfigured()) {
    try {
      const res = await resendClient().emails.send({
        from: bookingConfig.emailFrom,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        replyTo: opts.replyTo,
        attachments: opts.attachments,
      });
      if (res.error) return { sent: false, error: res.error.message };
      return { sent: true, id: res.data?.id };
    } catch (err) {
      return { sent: false, error: err instanceof Error ? err.message : "send failed" };
    }
  }

  console.warn(`[booking] no email transport configured — "${opts.subject}" not sent`);
  return { sent: false, skipped: true };
}

function shell(opts: { preheader: string; eyebrow: string; bodyHtml: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting"></head>
<body style="margin:0;padding:0;background:${PAPER};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<span style="display:none!important;opacity:0;color:${PAPER};height:0;width:0;overflow:hidden;">${opts.preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${CARD};border:1px solid ${LINE};border-radius:18px;overflow:hidden;">
<tr><td style="padding:32px 40px 0 40px;">
<table role="presentation" width="100%"><tr>
<td style="font-size:17px;font-weight:600;letter-spacing:-0.01em;color:${INK};">Unifictional</td>
<td align="right" style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${ACCENT};font-weight:600;">${opts.eyebrow}</td>
</tr></table>
<div style="height:1px;background:${LINE};margin-top:20px;"></div>
</td></tr>
<tr><td style="padding:28px 40px 40px 40px;color:${SOFT};font-size:15px;line-height:1.65;">
${opts.bodyHtml}
</td></tr>
<tr><td style="padding:22px 40px;background:${PAPER};border-top:1px solid ${LINE};">
<p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED};">
Unifictional — websites &amp; marketing for builders. <a href="${bookingConfig.siteUrl}" style="color:${ACCENT};text-decoration:none;">${bookingConfig.siteUrl.replace(/^https?:\/\//, "")}</a>
</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 14px 0;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.2;font-weight:500;color:${INK};">${text}</h1>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:${INK};color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:13px 26px;border-radius:999px;">${label}</a>`;
}

function detailCard(rows: [string, string][]): string {
  const body = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:7px 0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};width:120px;vertical-align:top;">${k}</td><td style="padding:7px 0;font-size:15px;color:${INK};">${v}</td></tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" style="background:${PAPER};border:1px solid ${LINE};border-radius:12px;padding:8px 20px;margin:8px 0 4px 0;">${body}</table>`;
}

const esc = (s: string) =>
  (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// For values placed INSIDE an HTML attribute (href="…") — also neutralize the
// quote chars so user input can't break out of the attribute.
const escAttr = (s: string) => esc(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/* ------------------------------- senders -------------------------------- */

export function sendVerificationEmail(p: { to: string; name: string; code: string }) {
  const body = `
${heading("Confirm your email")}
<p style="margin:0 0 18px 0;">Hi ${esc(p.name || "there")}, here's your verification code to lock in your call with Unifictional:</p>
<div style="text-align:center;margin:26px 0;">
<div style="display:inline-block;font-family:Georgia,serif;font-size:38px;letter-spacing:10px;font-weight:600;color:${INK};background:${PAPER};border:1px solid ${LINE};border-radius:12px;padding:18px 30px;">${p.code}</div>
</div>
<p style="margin:0;color:${MUTED};font-size:13px;">Enter this code on the booking page to finish. It expires in 15 minutes. If you didn't request this, you can ignore this email.</p>`;
  return send({
    to: p.to,
    subject: `Your Unifictional code: ${p.code}`,
    html: shell({ preheader: `Your verification code is ${p.code}`, eyebrow: "Verify", bodyHtml: body }),
  });
}

export function sendClientConfirmation(p: {
  to: string;
  name: string;
  startISO: string;
  links: CalendarLinks;
  icsBase64: string;
}) {
  const when = formatFullDateTime(new Date(p.startISO), bookingConfig.timezone);
  const body = `
${heading("You're booked in.")}
<p style="margin:0 0 18px 0;">Hi ${esc(p.name || "there")}, your call with Unifictional is confirmed. We're looking forward to it.</p>
${detailCard([
  ["When", when],
  ["Length", `${bookingConfig.durationMin} minutes`],
  ["With", "Unifictional"],
])}
<p style="margin:22px 0 12px 0;font-weight:600;color:${INK};">Add it to your calendar</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:10px;">${button(p.links.google, "Google")}</td>
<td style="padding-right:10px;">${button(p.links.outlook, "Outlook")}</td>
</tr></table>
<p style="margin:18px 0 0 0;color:${MUTED};font-size:13px;">An <strong>.ics</strong> file is attached for Apple Calendar or any other app. Need to reschedule? Just reply to this email.</p>`;
  return send({
    to: p.to,
    subject: `Confirmed: your call with Unifictional — ${when}`,
    replyTo: bookingConfig.ownerEmail,
    html: shell({
      preheader: `Your call is confirmed for ${when}`,
      eyebrow: "Confirmed",
      bodyHtml: body,
    }),
    attachments: [
      { filename: "unifictional-call.ics", content: p.icsBase64, contentType: "text/calendar" },
    ],
  });
}

export function sendOwnerNotification(p: {
  startISO: string;
  client: {
    name: string;
    email: string;
    phone: string;
    businessName: string;
    website: string;
    services: string[];
    message: string;
  };
  /** When provided, the email offers add-to-calendar buttons + an .ics so the
   *  owner can drop the call onto their own calendar in one tap (no Google
   *  service-account sync required). */
  links?: CalendarLinks;
  icsBase64?: string;
  /** True when bookings already auto-sync to the calendar (service account on). */
  autoSynced?: boolean;
}) {
  const when = formatFullDateTime(new Date(p.startISO), bookingConfig.timezone);
  const c = p.client;
  const intro = p.autoSynced
    ? "A new discovery call just came through the site — it's already on your calendar."
    : "A new discovery call just came through the site. Add it to your calendar with one tap below.";
  const addToCalendar =
    p.links && !p.autoSynced
      ? `<p style="margin:22px 0 12px 0;font-weight:600;color:${INK};">Add it to your calendar</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:10px;">${button(p.links.google, "Google")}</td>
<td style="padding-right:10px;">${button(p.links.outlook, "Outlook")}</td>
</tr></table>
<p style="margin:14px 0 0 0;color:${MUTED};font-size:13px;">Or just open the attached <strong>.ics</strong> — Gmail shows an "Add to calendar" button right on this email.</p>`
      : "";
  const body = `
${heading("New call booked 🎉")}
<p style="margin:0 0 18px 0;">${intro}</p>
${detailCard([
  ["When", when],
  ["Name", esc(c.name)],
  ["Email", `<a href="mailto:${escAttr(c.email)}" style="color:${ACCENT};text-decoration:none;">${esc(c.email)}</a>`],
  ["Phone", c.phone ? `<a href="tel:${escAttr(c.phone)}" style="color:${ACCENT};text-decoration:none;">${esc(c.phone)}</a>` : "—"],
  ["Business", esc(c.businessName) || "—"],
  ["Website", c.website ? `<a href="${escAttr(c.website)}" style="color:${ACCENT};text-decoration:none;">${esc(c.website)}</a>` : "—"],
  ["Interested in", c.services.length ? esc(c.services.join(", ")) : "—"],
])}
<p style="margin:20px 0 6px 0;font-weight:600;color:${INK};">What they want more of</p>
<p style="margin:0;padding:14px 18px;background:${PAPER};border-left:3px solid ${ACCENT};border-radius:6px;color:${INK};white-space:pre-wrap;">${esc(c.message) || "(no message left)"}</p>
${addToCalendar}`;
  return send({
    to: bookingConfig.ownerEmail,
    subject: `New call: ${c.name}${c.businessName ? ` · ${c.businessName}` : ""} — ${when}`,
    replyTo: c.email,
    html: shell({
      preheader: `${c.name} booked a call for ${when}`,
      eyebrow: "New booking",
      bodyHtml: body,
    }),
    attachments: p.icsBase64
      ? [{ filename: "unifictional-call.ics", content: p.icsBase64, contentType: "text/calendar" }]
      : undefined,
  });
}

export function sendReminderEmail(p: {
  to: string;
  name: string;
  startISO: string;
  daysUntil: number;
}) {
  const when = formatFullDateTime(new Date(p.startISO), bookingConfig.timezone);
  const lead =
    p.daysUntil <= 0
      ? "Your call with Unifictional is <strong>today</strong>."
      : p.daysUntil === 1
        ? "Your call with Unifictional is <strong>tomorrow</strong>."
        : `Your call with Unifictional is in <strong>${p.daysUntil} days</strong>.`;
  const body = `
${heading(p.daysUntil <= 0 ? "Today's the day." : "A quick reminder")}
<p style="margin:0 0 18px 0;">Hi ${esc(p.name || "there")}, ${lead} Here are the details so it's easy to keep handy:</p>
${detailCard([
  ["When", when],
  ["Length", `${bookingConfig.durationMin} minutes`],
  ["With", "Unifictional"],
])}
<p style="margin:22px 0 8px 0;">To make it count, jot down the kinds of jobs you want more of and any sites you admire — we'll dig in together.</p>
<div style="margin:18px 0 4px 0;">${button(`${bookingConfig.siteUrl}/contact`, "View booking details")}</div>
<p style="margin:18px 0 0 0;color:${MUTED};font-size:13px;">Need to reschedule? Just reply to this email and we'll sort it out.</p>`;
  return send({
    to: p.to,
    subject:
      p.daysUntil <= 0
        ? `Today: your call with Unifictional`
        : `Reminder: your Unifictional call ${p.daysUntil === 1 ? "tomorrow" : `in ${p.daysUntil} days`}`,
    replyTo: bookingConfig.ownerEmail,
    html: shell({ preheader: when, eyebrow: "Reminder", bodyHtml: body }),
  });
}
