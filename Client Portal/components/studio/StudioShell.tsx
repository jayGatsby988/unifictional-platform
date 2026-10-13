import Link from "next/link";
import { LogOut } from "lucide-react";
import type { Session } from "@/lib/data/repo";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { StudioNav } from "./StudioNav";
import { OpenCompany } from "./OpenCompany";

export function StudioShell({ session, inboxCount, children }: { session: Session; inboxCount: number; children: React.ReactNode }) {
  return (
    <div className="flex-1 flex min-h-screen">
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-line p-5 gap-8 sticky top-0 h-screen bg-paper/40">
        <Link href="/studio" className="flex items-center gap-3">
          <Logo className="h-8 w-8" />
          <div className="leading-tight">
            <div className="font-display text-base tracking-wide">Unifictional</div>
            <div className="label !text-xs">Studio</div>
          </div>
        </Link>
        <StudioNav inboxCount={inboxCount} />
        <div className="mt-auto space-y-3">
          <p className="text-xs text-ink-muted truncate">{session.email}</p>
          <form action="/auth/signout" method="post">
            <button className="flex items-center gap-2 text-xs text-ink-muted hover:text-ink transition"><LogOut className="h-3.5 w-3.5" /> Sign out</button>
          </form>
        </div>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-40 bg-bone/80 backdrop-blur border-b border-line">
          <div className="flex items-center gap-3 px-4 sm:px-6 lg:px-8 h-16">
            <Link href="/studio" className="lg:hidden flex items-center gap-2"><Logo className="h-7 w-7" /><span className="font-display">Studio</span></Link>
            <div className="lg:hidden"><StudioNav inboxCount={inboxCount} compact /></div>
            <div className="flex-1" />
            <OpenCompany clients={session.clients} />
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 sm:py-8 max-w-7xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
