/**
 * Sites we can't publish to by API (GoDaddy, Wix, Squarespace…). The client
 * chooses how posts get onto the site; this module is the shared vocabulary for
 * the form, the daily run and the studio page. Client-safe: no server imports.
 */

export const PLATFORMS = ["GoDaddy", "Wix", "Squarespace", "Weebly", "Shopify", "Webflow", "Other"] as const;

export type SiteAccess = "invite" | "login" | "self";
export const isSiteAccess = (v: unknown): v is SiteAccess => v === "invite" || v === "login" || v === "self";

export type SiteSetup = { platform: string; access: SiteAccess | null; loginOnFile: boolean; inviteSentAt: string | null };
export const EMPTY_SITE: SiteSetup = { platform: "", access: null, loginOnFile: false, inviteSentAt: null };

/** Where to click to add the studio as a collaborator, per builder. Short enough to follow on a phone. */
export function inviteSteps(platform: string, email: string): string[] {
  switch (platform) {
    case "GoDaddy": return ["Sign in at godaddy.com and open your name (top right) → Account Settings.", "Choose Delegate Access → Invite to Access.", `Enter ${email}, pick "Products & Domains", and send the invite.`];
    case "Wix": return ["Open your Wix dashboard → Settings → Roles & Permissions.", "Tap Invite People.", `Enter ${email}, choose Blog Editor (or Website Manager), and send.`];
    case "Squarespace": return ["Open your site → Settings → Permissions.", "Tap Invite Contributor.", `Enter ${email}, choose Content Editor, and send.`];
    case "Weebly": return ["Open your site → Settings → Editors.", "Tap Add Editor.", `Enter ${email} and send.`];
    case "Shopify": return ["Shopify admin → Settings → Users and permissions.", "Tap Add staff.", `Enter ${email}, tick Blog posts under permissions, and send.`];
    case "Webflow": return ["Open your site's settings → Collaborators (or Members).", `Invite ${email} as an Editor.`];
    default: return [`In your site builder's settings, invite ${email} as an editor or collaborator.`, "No invite option? Share a login below instead."];
  }
}

/** Does the studio paste the posts (true) or the client (false)? */
export const studioPastes = (site: Pick<SiteSetup, "access">): boolean => site.access === "invite" || site.access === "login";

/** The line under a post that's waiting to be pasted. */
export function pasteNote(site: SiteSetup): string {
  const plat = site.platform ? `your ${site.platform} site` : "your site";
  if (site.access === "login") return site.loginOnFile ? `Unifictional pastes this onto ${plat} within a business day.` : `Add the login for ${plat} in Settings and Unifictional pastes it for you.`;
  if (site.access === "invite") return site.inviteSentAt ? `Unifictional pastes this onto ${plat} within a business day.` : `Send the collaborator invite (Settings) and Unifictional pastes it for you.`;
  return `Copy it below and paste it onto ${plat}. Then tap "It's live".`;
}

/** The studio's one-line view of a "somewhere else" site. */
export function siteStatus(site: SiteSetup): { ready: boolean; note: string } {
  const plat = site.platform || "Other builder";
  if (site.access === "login") return site.loginOnFile ? { ready: true, note: `${plat} · login on file, studio pastes` } : { ready: false, note: `${plat} · login missing` };
  if (site.access === "invite") return site.inviteSentAt ? { ready: true, note: `${plat} · invited, studio pastes` } : { ready: false, note: `${plat} · invite not sent yet` };
  if (site.access === "self") return { ready: false, note: `${plat} · client pastes posts themselves` };
  return { ready: false, note: "Client hasn't said how we get onto their site" };
}
