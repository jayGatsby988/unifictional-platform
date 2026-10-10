import type { StudioAccount } from "@/lib/data/admin";
import { fmt } from "@/lib/utils";
import { ConnectButton } from "@/components/ConnectButton";

const COPY = {
  google: { title: "Google", what: "Analytics, Search Console and Business Profile", who: "Sign in with the Unifictional Google account that already has access to the clients' properties and listings." },
  meta: { title: "Meta", what: "Facebook Pages and Instagram", who: "Log in with the Facebook account that is an admin of the clients' Pages (the one the Social Planner uses)." },
} as const;

export function StudioAccounts({ accounts, demo }: { accounts: StudioAccount[]; demo: boolean }) {
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {accounts.map((a) => {
        const c = COPY[a.provider];
        const expiring = a.expiring;
        return (
          <div key={a.provider} className="panel p-5">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <p className="font-display text-xl">{c.title}</p>
                <p className="text-xs text-ink-muted">{c.what}</p>
              </div>
              <span className={`pill ${a.connected ? (expiring ? "pill-warn" : "pill-good") : "pill-neutral"}`}>{a.connected ? (expiring ? "expiring" : "connected") : "not connected"}</span>
            </div>
            {a.connected ? (
              <p className="text-sm">{a.label ?? "connected"} <span className="text-ink-muted">· since {a.connectedAt ? fmt.dateLong(a.connectedAt) : "—"}{a.expiresAt ? ` · renews by ${fmt.dateLong(a.expiresAt)}` : ""}</span></p>
            ) : (
              <p className="text-sm text-ink-muted">{c.who}</p>
            )}
            <div className="mt-4">
              <ConnectButton href={`/api/integrations/${a.provider}/connect`} demo={demo} className="btn btn-ink !py-2 !px-4 text-xs">
                {a.connected ? "Reconnect" : "Connect"} {c.title}
              </ConnectButton>
            </div>
          </div>
        );
      })}
    </div>
  );
}
