import { LogOut } from "lucide-react";

/** Studio contact card and sign-out, shared by the desktop sidebar and the phone menu. */
export function StudioContact({ name, email }: { name: string; email: string }) {
  return (
    <div className="panel p-4">
      <p className="label mb-1">Your studio contact</p>
      <p className="text-sm font-medium">{name}</p>
      <a className="text-sm text-ink-muted underline break-all" href={`mailto:${email}`}>{email}</a>
    </div>
  );
}

export function SignOut() {
  return (
    <form action="/auth/signout" method="post">
      <button className="flex items-center gap-2 min-h-11 text-sm text-ink-muted hover:text-ink transition">
        <LogOut className="h-4 w-4" /> Sign out
      </button>
    </form>
  );
}
