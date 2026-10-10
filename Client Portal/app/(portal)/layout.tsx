import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { SetPassword } from "@/components/SetPassword";
import { getSession } from "@/lib/data/repo";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session.isDemo && !session.email) redirect("/login");
  if (session.isAdmin && !session.isDemo && !(await cookies()).get("portal_client")?.value) redirect("/studio");
  if (!session.client) {
    return (
      <Shell session={session}>
        <div className="panel p-8 max-w-xl">
          <p className="label mb-2">Almost there</p>
          <h1 className="font-display text-3xl mb-3">Your account isn&apos;t linked to a client yet.</h1>
          <p className="text-ink-muted">You&apos;re signed in as <span className="font-mono">{session.email}</span>. Email <a className="underline" href="mailto:unifictional@gmail.com">unifictional@gmail.com</a> and we&apos;ll connect you to your company.</p>
        </div>
      </Shell>
    );
  }
  return <Shell session={session}>{session.mustChangePassword && <SetPassword />}{children}</Shell>;
}
