"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function ClientSwitcher({ clients, current }: { clients: { slug: string; name: string }[]; current: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (clients.length < 2) return null;
  return (
    <select
      className="input !w-auto !py-1.5 !text-xs"
      value={current}
      disabled={pending}
      onChange={(e) => {
        const slug = e.target.value;
        start(async () => {
          await fetch("/api/client", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug }) });
          router.refresh();
        });
      }}
    >
      {clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
    </select>
  );
}
