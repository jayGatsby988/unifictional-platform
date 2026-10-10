"use client";

import { useRouter } from "next/navigation";

export function ClientPicker({ clients, current }: { clients: { slug: string; name: string }[]; current: string }) {
  const router = useRouter();
  return (
    <select className="input !w-auto !py-2.5 !px-4 text-base font-medium min-w-72" value={current} onChange={(e) => router.push(`/admin?client=${encodeURIComponent(e.target.value)}`)}>
      {clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
    </select>
  );
}
