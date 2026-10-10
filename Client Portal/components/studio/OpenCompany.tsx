"use client";

import { useRouter } from "next/navigation";

/** Header dropdown: jump into any company's dashboard. */
export function OpenCompany({ clients }: { clients: { slug: string; name: string }[] }) {
  const router = useRouter();
  if (!clients.length) return null;
  return (
    <select className="input !w-auto !py-1.5 !text-sm" defaultValue="" onChange={(e) => { if (e.target.value) router.push(`/api/client/open?slug=${encodeURIComponent(e.target.value)}`); }} aria-label="Open a company">
      <option value="" disabled>Open a company…</option>
      {clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
    </select>
  );
}
