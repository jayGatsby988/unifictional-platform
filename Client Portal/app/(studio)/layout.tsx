import { redirect } from "next/navigation";
import { StudioShell } from "@/components/studio/StudioShell";
import { getSession } from "@/lib/data/repo";
import { getInbox } from "@/lib/data/studio";

export const dynamic = "force-dynamic";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session.email && !session.isDemo) redirect("/login");
  if (!session.isAdmin) redirect("/overview");
  const inbox = await getInbox(session);
  const fresh = inbox.filter((i) => i.open && (i.status === "new" || i.status === "open")).length;
  return <StudioShell session={session} inboxCount={fresh}>{children}</StudioShell>;
}
