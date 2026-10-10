"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { GenerationStatus as Status } from "@/lib/data/types";

const LABEL: Record<Status, string> = { new: "New", contacted: "Contacted", quoted: "Quoted", won: "Won", lost: "Lost" };

export function GenerationStatusSelect({ id, status, compact = false }: { id: string; status: Status; compact?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState<Status>(status);
  const [pending, start] = useTransition();
  return (
    <select
      className={compact ? "input !w-auto !py-1 !px-2 !text-xs !rounded-full" : "input !py-2"}
      value={value}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value as Status;
        setValue(next);
        start(async () => {
          await fetch(`/api/estimator/generations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) });
          router.refresh();
        });
      }}
    >
      {(Object.keys(LABEL) as Status[]).map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
    </select>
  );
}
