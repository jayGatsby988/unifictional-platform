"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calculator, CreditCard, Globe, Inbox, Layers, LayoutDashboard, Plug, Search, Settings, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const NAV = [
  { href: "/overview", label: "Overview", num: "00", icon: LayoutDashboard },
  { href: "/website", label: "Website", num: "01", icon: Globe },
  { href: "/seo", label: "Search", num: "02", icon: Search },
  { href: "/social", label: "Social", num: "03", icon: Share2 },
  { href: "/estimator", label: "Quote tool", num: "04", icon: Calculator },
  { href: "/requests", label: "Requests", num: "05", icon: Inbox },
  { href: "/connect", label: "Connections", num: "06", icon: Plug },
  { href: "/billing", label: "Billing", num: "07", icon: CreditCard },
  { href: "/plans", label: "Plans", num: "08", icon: Layers },
];

export function Sidebar({ onNavigate, admin = false }: { onNavigate?: () => void; admin?: boolean }) {
  const pathname = usePathname();
  const items = admin ? [...NAV, { href: "/studio", label: "← Studio", num: "99", icon: Settings }] : NAV;
  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
              active ? "bg-ink text-bone" : "text-ink-soft hover:bg-paper hover:text-ink",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="flex-1">{item.label}</span>
            <span className={cn("font-mono text-[10px] tracking-[0.2em]", active ? "text-bone/60" : "text-ink-muted")}>{item.num}</span>
          </Link>
        );
      })}
    </nav>
  );
}
