import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * fetch() for addresses typed in by the public (the free website check). Refuses anything
 * that resolves to a private, loopback or link-local address, at every redirect hop, so the
 * form can't be used to reach our own infrastructure (e.g. cloud metadata at 169.254.169.254).
 */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(v) === 4) {
    const [a, b] = v.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v);
}

async function assertPublicHost(url: URL) {
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only website addresses (http or https) can be checked.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("That address isn't a public website.");
}

export async function safeFetch(input: string, init: RequestInit = {}, maxRedirects = 5): Promise<Response> {
  let url = new URL(input);
  for (let hop = 0; ; hop++) {
    await assertPublicHost(url);
    const res = await fetch(url, { ...init, redirect: "manual" });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!loc) {
      Object.defineProperty(res, "url", { value: url.toString() }); // final address after our own redirect handling
      return res;
    }
    if (hop >= maxRedirects) throw new Error("Too many redirects.");
    url = new URL(loc, url);
  }
}
