"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Calculator, CreditCard, Globe, Inbox, Layers, LayoutDashboard, Plug, Search, Settings, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** `needs`: words that must appear in one of the company's services for the page to show; pages without it always show. */
export const NAV: { href: string; label: string; icon: typeof Globe; needs?: string[] }[] = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/website", label: "Website", icon: Globe },
  { href: "/seo", label: "Search", icon: Search },
  { href: "/autopilot", label: "SEO Autopilot", icon: Bot },
  { href: "/social", label: "Social", icon: Share2, needs: ["social"] },
  { href: "/estimator", label: "Quote tool", icon: Calculator, needs: ["quote", "estimat", "3d"] },
  { href: "/requests", label: "Requests", icon: Inbox },
  { href: "/connect", label: "Connections", icon: Plug },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/plans", label: "Plans", icon: Layers },
];

/** A self-serve company only sees what it bought; the studio and companies with no services list see everything. */
export function navFor(services: string[] | undefined, admin: boolean) {
  const have = (services ?? []).map((s) => s.toLowerCase());
  return NAV.filter((item) => admin || !item.needs || have.length === 0 || item.needs.some((n) => have.some((s) => s.includes(n))));
}

export function Sidebar({ onNavigate, admin = false, services }: { onNavigate?: () => void; admin?: boolean; services?: string[] }) {
  const pathname = usePathname();
  const base = navFor(services, admin);
  const items = admin ? [...base, { href: "/studio", label: "← Studio", icon: Settings }] : base;
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
              "flex items-center gap-3 min-h-11 rounded-xl px-3 py-2.5 text-sm transition",
              active ? "bg-ink text-bone" : "text-ink-soft hover:bg-paper hover:text-ink",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="flex-1">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
