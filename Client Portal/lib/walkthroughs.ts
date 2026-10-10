/**
 * Animated walkthrough scripts. Each step names a mock screen, the element the
 * cursor goes to (data-t in components/walkthrough/screens.tsx), what happens
 * there, and the caption read out under it. `ref` ties a step to the written
 * step [track, step] on the guide page so the two stay in sync.
 */
export type DemoStep = {
  screen: string;
  target: string;
  action: "click" | "type" | "look";
  caption: string;
  type?: string;                    // text typed into the target
  fill?: Record<string, string>;    // values already filled in
  on?: string[];                    // toggles shown as on (menus open, radio picked)
  url?: string;
  ref?: [number, number];
  say?: string;                     // spoken wording when it differs from the caption
};
export type Demo = { title: string; steps: DemoStep[] };

const EMAIL = "unifictional@gmail.com";

export const DEMOS: Record<string, Demo> = {
  "create-account": {
    title: "Creating your portal account",
    steps: [
      { screen: "p-landing", target: "url", action: "look", caption: "Open the Unifictional portal in your web browser, on your computer or your phone.", ref: [0, 0] },
      { screen: "p-landing", target: "create", action: "click", caption: "Click the white “Create account” button in the top-right corner.", ref: [0, 1] },
      { screen: "p-signup", target: "name", action: "type", type: "Dana Whitaker", caption: "Type your first and last name.", ref: [0, 2] },
      { screen: "p-signup", target: "company", action: "type", type: "Northline Builders", fill: { name: "Dana Whitaker" }, caption: "Type your company's name.", ref: [0, 2] },
      { screen: "p-signup", target: "email", action: "type", type: "dana@northlinebuilders.com", fill: { name: "Dana Whitaker", company: "Northline Builders" }, caption: "Type the email address you check every day. This is how you'll sign in.", ref: [0, 2] },
      { screen: "p-signup", target: "submit", action: "click", fill: { name: "Dana Whitaker", company: "Northline Builders", email: "dana@northlinebuilders.com" }, caption: "Click the black “Create my account” button.", ref: [0, 3] },
      { screen: "p-sent", target: "card", action: "look", caption: "You'll see “You're on the list.” You can close this page now and open your email.", say: "You'll see a message saying you're on the list. You can close this page now, and open your email.", ref: [0, 4] },
      { screen: "p-email", target: "link", action: "click", caption: "Find the email with your sign-in link. If it isn't there, check the Spam folder. Click the link inside it.", ref: [0, 5] },
      { screen: "p-dash", target: "title", action: "look", caption: "That's it, you're in. Once we connect your company, your numbers appear here every day.", ref: [0, 6] },
    ],
  },
  "google-analytics": {
    title: "Giving us access to Google Analytics",
    steps: [
      { screen: "ga-home", target: "url", action: "look", caption: "Go to analytics.google.com and sign in with the Google account your website uses.", ref: [0, 0] },
      { screen: "ga-home", target: "admin", action: "click", caption: "Click “Admin”. It's the little gear in the bottom-left corner.", ref: [0, 1] },
      { screen: "ga-admin", target: "pam", action: "click", caption: "Under “Property”, click “Property access management”.", ref: [0, 2] },
      { screen: "ga-pam", target: "plus", action: "click", caption: "Click the blue plus button in the top-right corner.", ref: [0, 3] },
      { screen: "ga-pam", target: "addusers", action: "click", on: ["menu"], caption: "Click “Add users”.", ref: [0, 3] },
      { screen: "ga-add", target: "email", action: "type", type: EMAIL, caption: `Type our email address: ${EMAIL}`, ref: [0, 4] },
      { screen: "ga-add", target: "viewer", action: "click", fill: { email: EMAIL }, caption: "Under “Roles”, click “Viewer”. Viewer can only look at numbers. It can't change anything.", ref: [0, 5] },
      { screen: "ga-add", target: "add", action: "click", fill: { email: EMAIL }, on: ["viewer"], caption: "Click the blue “Add” button in the top-right corner.", ref: [0, 6] },
      { screen: "ga-done", target: "row", action: "look", caption: "Done. Our email now shows in the list. You can close the page.", ref: [0, 6] },
    ],
  },
  "search-console": {
    title: "Giving us access to Search Console",
    steps: [
      { screen: "gsc-home", target: "property", action: "click", caption: "Go to search.google.com/search-console and pick your website at the top left.", ref: [0, 1] },
      { screen: "gsc-home", target: "settings", action: "click", caption: "Click “Settings” near the bottom of the menu on the left.", ref: [0, 2] },
      { screen: "gsc-settings", target: "users", action: "click", caption: "Click “Users and permissions”.", ref: [0, 2] },
      { screen: "gsc-users", target: "adduser", action: "click", caption: "Click the “Add user” button at the top right.", ref: [0, 3] },
      { screen: "gsc-dialog", target: "email", action: "type", type: EMAIL, caption: `Type our email address: ${EMAIL}`, ref: [0, 4] },
      { screen: "gsc-dialog", target: "perm", action: "look", fill: { email: EMAIL }, caption: "Make sure “Permission” says “Full”.", ref: [0, 4] },
      { screen: "gsc-dialog", target: "add", action: "click", fill: { email: EMAIL }, caption: "Click “Add”.", ref: [0, 5] },
      { screen: "gsc-done", target: "row", action: "look", caption: "Done. We're on the list and can see your Google search numbers.", ref: [0, 5] },
    ],
  },
  "business-profile": {
    title: "Adding us to your Google Business Profile",
    steps: [
      { screen: "gbp-search", target: "panel", action: "look", caption: "Sign in to Google and search for your business name. Your business shows in a box at the top.", ref: [0, 0] },
      { screen: "gbp-search", target: "dots", action: "click", caption: "Click the three dots in that box.", ref: [0, 1] },
      { screen: "gbp-search", target: "settings", action: "click", on: ["menu"], caption: "Click “Business Profile settings”.", ref: [0, 1] },
      { screen: "gbp-settings", target: "people", action: "click", caption: "Click “People and access”.", ref: [0, 2] },
      { screen: "gbp-people", target: "add", action: "click", caption: "Click “Add”.", ref: [0, 3] },
      { screen: "gbp-invite", target: "email", action: "type", type: EMAIL, caption: `Type our email address: ${EMAIL}`, ref: [0, 3] },
      { screen: "gbp-invite", target: "manager", action: "click", fill: { email: EMAIL }, caption: "Under “Access”, choose “Manager”.", ref: [0, 3] },
      { screen: "gbp-invite", target: "invite", action: "click", fill: { email: EMAIL }, on: ["manager"], caption: "Click “Invite”. We accept the invitation on our side. You're done.", ref: [0, 4] },
    ],
  },
  "facebook-instagram": {
    title: "Giving us access to your Facebook Page",
    steps: [
      { screen: "fb-page", target: "settings", action: "click", caption: "Open your business's Facebook Page and click “Settings” in the menu on the left.", ref: [0, 0] },
      { screen: "fb-settings", target: "access", action: "click", caption: "Click “Page access”.", ref: [0, 1] },
      { screen: "fb-access", target: "addnew", action: "click", caption: "Next to “People with Facebook access”, click “Add new”.", ref: [0, 2] },
      { screen: "fb-invite", target: "search", action: "type", type: "Unifictional", caption: "Type “Unifictional” in the search box.", ref: [0, 3] },
      { screen: "fb-invite", target: "result", action: "click", fill: { search: "Unifictional" }, on: ["results"], caption: "Click our name when it shows up.", ref: [0, 3] },
      { screen: "fb-invite", target: "give", action: "click", fill: { search: "Unifictional" }, on: ["results", "picked"], caption: "Leave “full control” switched off and click “Give access”.", ref: [0, 3] },
      { screen: "fb-confirm", target: "password", action: "look", caption: "Facebook asks for your password to make sure it's you. Type it and you're done.", ref: [0, 4] },
    ],
  },
};
