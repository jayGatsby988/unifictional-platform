import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function GuideLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1 bg-bone text-ink">
      <header className="border-b border-line">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3"><Logo className="h-7 w-7" /><span className="font-display text-lg tracking-wide">Unifictional</span><span className="hidden sm:inline label !text-[9px] ml-2">Setup guides</span></Link>
          <nav className="flex items-center gap-2">
            <Link href="/guide" className="btn btn-ghost !py-2 !px-4 text-sm">All guides</Link>
            <Link href="/login" className="btn btn-ink !py-2 !px-4 text-sm">Client sign in</Link>
          </nav>
        </div>
      </header>
      {children}
      <footer className="px-5 sm:px-8 py-8 text-xs text-ink-muted border-t border-line text-center">
        Stuck on any step? Email <a className="underline" href="mailto:unifictional@gmail.com">unifictional@gmail.com</a> or reply to the message we sent you, and we&apos;ll do it with you on a call.
      </footer>
    </main>
  );
}
