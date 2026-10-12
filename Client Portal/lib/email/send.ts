import nodemailer, { type Transporter } from "nodemailer";

/**
 * Outgoing mail. Preferred: a Google Workspace mailbox on the studio domain (SMTP_USER /
 * SMTP_PASS app password) sending as friendly aliases — Rebecca for onboarding, Jessica
 * for updates. Fallback: the unifictional@gmail.com account (GMAIL_USER / GMAIL_APP_PASSWORD).
 * Server-only; never throws.
 */
export type Sender = "onboarding" | "updates";

const workspace = Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
const gmail = Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
export const emailConfigured = workspace || gmail;
export const STUDIO_EMAIL = (process.env.STUDIO_NOTIFY_EMAIL || process.env.GMAIL_USER || "unifictional@gmail.com").trim();

/** Display identity per kind of email (used in the From line and the email's sign-off). */
export const SENDERS: Record<Sender, { name: string; title: string; address: string }> = {
  onboarding: {
    name: process.env.MAIL_ONBOARDING_NAME || "Rebecca",
    title: "Client onboarding, Unifictional",
    address: process.env.MAIL_ONBOARDING_ADDRESS || "rebecca@unifictional.com",
  },
  updates: {
    name: process.env.MAIL_UPDATES_NAME || "Jessica",
    title: "Client success, Unifictional",
    address: process.env.MAIL_UPDATES_ADDRESS || "jessica@unifictional.com",
  },
};

let smtp: Transporter | null = null;
function transport(): Transporter {
  const user = (workspace ? process.env.SMTP_USER : process.env.GMAIL_USER)!.trim();
  const pass = (workspace ? process.env.SMTP_PASS : process.env.GMAIL_APP_PASSWORD)!.replace(/\s+/g, "");
  smtp ??= nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
  return smtp;
}

function fromLine(sender: Sender | undefined) {
  if (workspace && sender) {
    const s = SENDERS[sender];
    return { from: `${s.name} at Unifictional <${s.address}>`, replyTo: s.address };
  }
  const user = (workspace ? process.env.SMTP_USER : process.env.GMAIL_USER)!.trim();
  return { from: `Unifictional <${user}>`, replyTo: user };
}

/** True when emails go out from the named aliases (so templates can sign with the name). */
export const personaSending = workspace;

/** Sign-off for an email of this kind: the persona when sending as them, else the team. */
export function signOffFor(sender: Sender): { name: string; title: string } | null {
  return workspace ? { name: SENDERS[sender].name, title: SENDERS[sender].title } : null;
}

export async function sendEmail(opts: { to: string; subject: string; html: string; text: string; replyTo?: string; sender?: Sender }): Promise<{ sent: boolean; error?: string }> {
  if (!emailConfigured) return { sent: false, error: "Email isn't set up." };
  try {
    const { from, replyTo } = fromLine(opts.sender);
    await transport().sendMail({ from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text, replyTo: opts.replyTo ?? replyTo });
    return { sent: true };
  } catch (e) {
    console.error("[email]", e);
    return { sent: false, error: e instanceof Error ? e.message : "Email failed." };
  }
}
