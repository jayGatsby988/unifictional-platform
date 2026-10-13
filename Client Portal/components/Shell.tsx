import Link from "next/link";
import type { Session } from "@/lib/data/repo";
import { Logo } from "./Logo";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { ThemeToggle } from "./ThemeToggle";
import { ClientSwitcher } from "./ClientSwitcher";
import { SignOut, StudioContact } from "./AccountLinks";

/** `pending`: the login has no company yet, so the page links are hidden (they'd all loop back to the welcome screen). */
export function Shell({ session, pending = false, children }: { session: Session; pending?: boolean; children: React.ReactNode }) {
  const client = session.client;
  const showNav = !pending || session.isAdmin;
  const contact = client ? { name: client.accountManager.name, email: client.accountManager.email } : undefined;
  return (
    <div className="flex-1 flex min-h-screen">
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-line p-5 gap-8 sticky top-0 h-screen">
        <Link href="/overview" className="flex items-center gap-3">
          <Logo className="h-8 w-8" />
          <div className="leading-tight">
            <div className="font-display text-base tracking-wide">Unifictional</div>
            <div className="label !text-xs">Client portal</div>
          </div>
        </Link>
        {showNav && <Sidebar admin={session.isAdmin} services={client?.services} />}
        <div className="mt-auto space-y-4">
          {contact && <StudioContact {...contact} />}
          <SignOut />
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {session.isAdmin && !session.isDemo && client && (
          <div className="bg-ink text-bone text-xs">
            <div className="px-4 sm:px-6 lg:px-8 h-9 flex items-center gap-3">
              <span className="label !text-bone/60 !text-xs">Studio view</span>
              <span className="truncate">You&apos;re seeing exactly what {client.name} sees.</span>
              <Link href="/studio" className="ml-auto underline whitespace-nowrap">← Back to studio</Link>
            </div>
          </div>
        )}
        <header className="sticky top-0 z-40 bg-bone/80 backdrop-blur border-b border-line">
          <div className="flex items-center gap-3 px-4 sm:px-6 lg:px-8 h-16">
            <MobileNav admin={session.isAdmin} services={client?.services} showNav={showNav} contact={contact} />
            <Link href="/overview" className="lg:hidden flex items-center gap-2">
              <Logo className="h-7 w-7" />
            </Link>
            <div className="min-w-0 flex-1 flex items-center gap-3">
              {client ? (
                <>
                  <div className="min-w-0">
                    <p className="font-display text-base sm:text-lg truncate">{client.name}</p>
                    {(client.industry || client.city) && <p className="text-xs text-ink-muted truncate hidden sm:block">{[client.industry, client.city].filter(Boolean).join(" · ")}</p>}
                  </div>
                  {session.isAdmin && <ClientSwitcher clients={session.clients} current={client.slug} />}
                </>
              ) : (
                <p className="font-display text-base">Client portal</p>
              )}
            </div>
            {session.isDemo && <span className="pill pill-warn hidden sm:inline-block">Demo data</span>}
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 sm:py-8 max-w-7xl w-full mx-auto">{children}</main>
        <footer className="px-4 sm:px-6 lg:px-8 py-6 text-xs text-ink-muted border-t border-line">
          Unifictional · Marketing for local businesses · <a className="underline" href="https://unifictional.com">unifictional.com</a>
        </footer>
      </div>
    </div>
  );
}
