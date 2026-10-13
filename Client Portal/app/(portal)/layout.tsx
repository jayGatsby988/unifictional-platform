import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { SetPassword } from "@/components/SetPassword";
import { WelcomePending } from "@/components/welcome/WelcomePending";
import { getSession } from "@/lib/data/repo";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session.isDemo && !session.email) redirect("/login");
  if (session.isAdmin && !session.isDemo && !(await cookies()).get("portal_client")?.value) redirect("/studio");
  if (!session.client) {
    return (
      <Shell session={session} pending>
        {session.mustChangePassword && <SetPassword />}
        <WelcomePending email={session.email} name={session.name ?? ""} />
      </Shell>
    );
  }
  return <Shell session={session}>{session.mustChangePassword && <SetPassword />}{children}</Shell>;
}
