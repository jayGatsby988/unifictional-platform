import { createSign } from "node:crypto";
import { getJson } from "./types";

/**
 * Two ways in to Google APIs:
 *  - a service account (GOOGLE_SERVICE_ACCOUNT_JSON, base64 or raw JSON) for
 *    Analytics and Search Console, after the SA email is added to each property;
 *  - an OAuth refresh token per client for Business Profile, which does not
 *    accept service accounts for third-party locations.
 */

type ServiceAccount = { client_email: string; private_key: string };
type TokenResponse = { access_token: string; expires_in: number };

const cache = new Map<string, { token: string; exp: number }>();

function b64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const json = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  const sa = JSON.parse(json) as Partial<ServiceAccount>;
  if (!sa.client_email || !sa.private_key) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email/private_key");
  return { client_email: sa.client_email, private_key: sa.private_key };
}

/** Build and sign the JWT a service account trades for an access token. */
export function serviceAccountAssertion(sa: ServiceAccount, scopes: string[], now = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email, scope: scopes.join(" "), aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const sig = b64url(signer.sign(sa.private_key));
  return `${header}.${claims}.${sig}`;
}

export async function serviceAccountToken(scopes: string[]): Promise<string> {
  const key = `sa:${scopes.join(" ")}`;
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const sa = loadServiceAccount();
  if (!sa) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: serviceAccountAssertion(sa, scopes) });
  const t = await getJson<TokenResponse>("https://oauth2.googleapis.com/token", { method: "POST", body });
  cache.set(key, { token: t.access_token, exp: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID, secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!id || !secret) throw new Error("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not set");
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: id, client_secret: secret });
  const t = await getJson<TokenResponse>("https://oauth2.googleapis.com/token", { method: "POST", body });
  return t.access_token;
}

export const SCOPES = {
  analytics: "https://www.googleapis.com/auth/analytics.readonly",
  searchConsole: "https://www.googleapis.com/auth/webmasters.readonly",
  business: "https://www.googleapis.com/auth/business.manage",
};

export const bearer = (token: string): HeadersInit => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
