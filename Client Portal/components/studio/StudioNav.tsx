"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Bot, Building2, CreditCard, Inbox, Layers, Plug, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/studio", label: "Inbox", icon: Inbox, exact: true },
  { href: "/studio/companies", label: "Companies", icon: Building2 },
  { href: "/studio/billing", label: "Billing", icon: CreditCard },
  { href: "/studio/plans", label: "Plans", icon: Layers },
  { href: "/studio/autopilot", label: "SEO Autopilot", icon: Bot },
  { href: "/admin", label: "Data connections", icon: Plug },
  { href: "/admin/setup", label: "Setup & keys", icon: Wrench },
  { href: "/guide?studio", label: "Client guides", icon: BookOpen },
];

export function StudioNav({ inboxCount, compact = false }: { inboxCount: number; compact?: boolean }) {
  const path = usePathname();
  const active = (href: string, exact?: boolean) => {
    const h = href.split("?")[0];
    if (exact) return path === h || path.startsWith("/studio/inspection") || path.startsWith("/studio/signup") || path.startsWith("/studio/support");
    return path === h || (h !== "/admin" && path.startsWith(h + "/"));
  };
  if (compact) {
    return (
      <nav className="flex gap-1 overflow-x-auto">
        {ITEMS.slice(0, 2).map((i) => (
          <Link key={i.href} href={i.href} className={cn("rounded-full px-3 py-1.5 text-xs whitespace-nowrap", active(i.href, i.exact) ? "bg-ink text-bone" : "text-ink-soft")}>
            {i.label}{i.href === "/studio" && inboxCount > 0 ? ` · ${inboxCount}` : ""}
          </Link>
        ))}
      </nav>
    );
  }
  return (
    <nav className="flex flex-col gap-1">
      {ITEMS.map((i) => {
        const on = active(i.href, i.exact);
        return (
          <Link key={i.href} href={i.href} className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition", on ? "bg-ink text-bone" : "text-ink-soft hover:bg-paper hover:text-ink")}>
            <i.icon className="h-4 w-4 shrink-0" />
            <span className="flex-1">{i.label}</span>
            {i.href === "/studio" && inboxCount > 0 && <span className={cn("rounded-full px-2 py-0.5 text-xs font-mono", on ? "bg-bone text-ink" : "bg-ink text-bone")}>{inboxCount}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
