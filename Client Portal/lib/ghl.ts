/**
 * Minimal GoHighLevel v2 client for leads captured by the portal (free audit,
 * create-account). Mirrors the main site's lib/ghl.ts: every lead is tagged
 * brand-unifictional on first touch, which is the cross-brand suppression key.
 */
const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

export type PortalLead = { name?: string; email?: string; phone?: string; company?: string; website?: string; source: string; note?: string };

function split(full?: string) {
  const parts = (full || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "Website", lastName: "Lead" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export async function pushLeadToGhl(lead: PortalLead): Promise<string | null> {
  const token = process.env.GHL_TOKEN, locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) return null;
  const headers = { Authorization: `Bearer ${token}`, Version: VERSION, Accept: "application/json", "Content-Type": "application/json" };
  try {
    const res = await fetch(`${BASE}/contacts/upsert`, {
      method: "POST", headers,
      body: JSON.stringify({
        locationId, ...split(lead.name), email: lead.email || undefined, phone: lead.phone || undefined, companyName: lead.company || undefined,
        website: lead.website || undefined, source: lead.source, tags: ["brand-unifictional", "src-portal", lead.source.replace(/\s+/g, "-").toLowerCase()],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { contact?: { id?: string } };
    const id = json.contact?.id ?? null;
    if (id && lead.note) {
      await fetch(`${BASE}/contacts/${id}/notes`, { method: "POST", headers, body: JSON.stringify({ body: lead.note }) }).catch(() => undefined);
    }
    return id;
  } catch {
    return null;
  }
}
