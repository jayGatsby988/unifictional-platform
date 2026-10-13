"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LinkLogin({ slug }: { slug: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={async (e) => {
      e.preventDefault();
      setMsg("…");
      const res = await fetch("/api/studio/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, email }) });
      const j = await res.json().catch(() => ({}));
      setMsg(res.ok ? (j.message ?? "Access granted.") : j.error ?? "Failed.");
      if (res.ok) { setEmail(""); router.refresh(); }
    }}>
      <input className="input !w-56 !py-1.5 text-xs" type="email" placeholder="add login email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <button className="btn btn-ghost !py-1.5 !px-3 text-xs">Give access</button>
      {msg && <span className="text-xs text-ink-muted max-w-xs">{msg}</span>}
    </form>
  );
}
