/* Illustrated, simplified versions of the screens people click through.
   Not pixel copies, and deliberately unbranded: just enough that the same
   buttons are in the same places. Every clickable thing carries data-t. */
import { BarChart3, Bell, Check, ChevronDown, Compass, Gauge, Home, Lock, Megaphone, MoreVertical, Plus, Search, Settings, Star, UserPlus, Users, X, Inbox, Mail, LayoutDashboard, Globe, Share2, Calculator } from "lucide-react";

export type ScreenProps = { v: (k: string) => string; on: (k: string) => boolean; active: string };

export const SCREEN_URL: Record<string, string> = {
  "p-landing": "unifictional-client-portal.vercel.app", "p-signup": "unifictional-client-portal.vercel.app/signup",
  "p-sent": "unifictional-client-portal.vercel.app/signup", "p-email": "mail.google.com", "p-dash": "unifictional-client-portal.vercel.app/overview",
  "ga-home": "analytics.google.com", "ga-admin": "analytics.google.com › Admin", "ga-pam": "analytics.google.com › Admin › Access",
  "ga-add": "analytics.google.com › Admin › Access", "ga-done": "analytics.google.com › Admin › Access",
  "gsc-home": "search.google.com/search-console", "gsc-settings": "search.google.com/search-console/settings",
  "gsc-users": "search.google.com/search-console/users", "gsc-dialog": "search.google.com/search-console/users", "gsc-done": "search.google.com/search-console/users",
  "gbp-search": "google.com/search?q=northline+builders", "gbp-settings": "google.com/search?q=northline+builders",
  "gbp-people": "google.com/search?q=northline+builders", "gbp-invite": "google.com/search?q=northline+builders",
  "fb-page": "facebook.com/northlinebuilders", "fb-settings": "facebook.com/settings", "fb-access": "facebook.com/settings › Page access",
  "fb-invite": "facebook.com/settings › Page access", "fb-confirm": "facebook.com/settings › Page access",
};

const caret = (p: ScreenProps, k: string) => p.active === k ? <span className="wt-caret" /> : null;
const Field = ({ p, k, label, ph, wide }: { p: ScreenProps; k: string; label: string; ph?: string; wide?: boolean }) => (
  <label className={wide ? "block col-span-2" : "block"}>
    <span className="block text-[12px] text-[#5f6368] mb-1">{label}</span>
    <span data-t={k} className={`flex items-center h-10 rounded-md border px-3 text-[15px] ${p.active === k ? "border-[#1a73e8] ring-2 ring-[#1a73e8]/20" : "border-[#dadce0]"}`}>
      {p.v(k) ? <span className="text-[#202124]">{p.v(k)}</span> : <span className="text-[#9aa0a6]">{ph}</span>}{caret(p, k)}
    </span>
  </label>
);
const GBtn = ({ t, children, primary, className = "" }: { t?: string; children: React.ReactNode; primary?: boolean; className?: string }) => (
  <span data-t={t} className={`inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-[14px] font-medium ${primary ? "bg-[#1a73e8] text-white" : "border border-[#dadce0] text-[#1a73e8] bg-white"} ${className}`}>{children}</span>
);
const Dim = () => <div className="absolute inset-0 bg-black/35" />;

/* ---------------- Unifictional portal ---------------- */
function PLanding() {
  return (
    <div className="h-full bg-[#0b0b0b] text-white relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_20%,#3a3a3a,transparent_60%)]" />
      <div className="relative flex items-center justify-between px-8 h-16">
        <span className="font-display text-xl tracking-wide">UNIFICTIONAL</span>
        <div className="flex items-center gap-3 text-[14px]"><span className="text-white/70">Client sign in</span><span data-t="create" className="bg-white text-black rounded-full px-5 py-2 font-medium">Create account →</span></div>
      </div>
      <div className="relative px-8 pt-16">
        <p className="label !text-white/50 mb-4">Free inspection report · for contractors</p>
        <p className="font-display text-[64px] leading-[0.95]">IS YOUR WEBSITE<br />LOSING YOU JOBS?</p>
        <div className="mt-10 w-[520px] border-b-2 border-white/60 pb-3 font-display text-3xl text-white/35">YOURCOMPANY.COM</div>
      </div>
    </div>
  );
}
function PSignup(p: ScreenProps) {
  return (
    <div className="h-full grid grid-cols-2">
      <div className="bg-[#0b0b0b] text-white p-10 flex flex-col justify-end">
        <p className="label !text-white/50 mb-3">Client portal</p>
        <p className="font-display text-[48px] leading-[0.95]">YOUR NUMBERS,<br />IN ONE PLACE.</p>
      </div>
      <div className="bg-white p-10 flex flex-col justify-center">
        <p className="font-display text-3xl mb-1">LET&apos;S GET YOU A DASHBOARD.</p>
        <p className="text-[13px] text-[#6d6d6d] mb-5">Tell us who you are. We do the setup.</p>
        <div className="grid grid-cols-1 gap-3">
          {[["name", "Your name", "First and last"], ["company", "Company", "Your company"], ["email", "Email", "you@yourcompany.com"]].map(([k, l, ph]) => (
            <label key={k} className="block">
              <span className="label !text-[10px] block mb-1">{l}</span>
              <span data-t={k} className={`flex items-center h-11 rounded-xl border px-3 text-[15px] ${p.active === k ? "border-black" : "border-[#e0e0e0]"}`}>
                {p.v(k) || <span className="text-[#aaa]">{ph}</span>}{caret(p, k)}
              </span>
            </label>
          ))}
          <span data-t="submit" className="mt-2 h-12 rounded-full bg-black text-white grid place-items-center text-[15px] font-medium">Create my account</span>
        </div>
      </div>
    </div>
  );
}
function PSent() {
  return (
    <div className="h-full bg-[#f5f5f5] grid place-items-center">
      <div data-t="card" className="bg-white rounded-2xl border border-[#e0e0e0] p-10 w-[460px]">
        <div className="h-12 w-12 rounded-full bg-[#dcfce7] text-[#166534] grid place-items-center mb-5"><Check className="h-6 w-6" /></div>
        <p className="font-display text-3xl mb-2">YOU&apos;RE ON THE LIST.</p>
        <p className="text-[15px] text-[#6d6d6d]">Check your inbox for a sign-in link. We&apos;ll email you when your dashboard is ready.</p>
      </div>
    </div>
  );
}
function PEmail() {
  return (
    <div className="h-full grid grid-cols-[220px_1fr] bg-white">
      <div className="border-r border-[#eee] p-4 space-y-1 text-[14px]">
        <div className="flex items-center gap-2 rounded-full bg-[#d3e3fd] px-4 py-2 font-medium"><Inbox className="h-4 w-4" />Inbox <span className="ml-auto text-[12px]">1</span></div>
        {["Starred", "Sent", "Spam"].map((x) => <div key={x} className="px-4 py-2 text-[#444]">{x}</div>)}
      </div>
      <div className="p-8">
        <p className="text-[22px] mb-1">Your sign-in link</p>
        <p className="text-[13px] text-[#666] mb-6 flex items-center gap-2"><Mail className="h-4 w-4" />Unifictional Portal · to me</p>
        <div className="border border-[#eee] rounded-xl p-8 w-[460px]">
          <p className="text-[15px] mb-5">Click the button below to sign in to your client portal.</p>
          <span data-t="link" className="inline-block bg-black text-white rounded-full px-7 py-3 text-[15px] font-medium">Sign in</span>
          <p className="text-[12px] text-[#888] mt-5">If you didn&apos;t ask for this, you can ignore it.</p>
        </div>
      </div>
    </div>
  );
}
function PDash() {
  const nav = [[LayoutDashboard, "Overview"], [Globe, "Website"], [Search, "Search"], [Share2, "Social"], [Calculator, "Quote tool"]] as const;
  return (
    <div className="h-full grid grid-cols-[200px_1fr] bg-white">
      <div className="border-r border-[#e0e0e0] p-4 space-y-1">
        <p className="font-display text-lg mb-4">UNIFICTIONAL</p>
        {nav.map(([I, l], i) => <div key={l} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] ${i === 0 ? "bg-black text-white" : "text-[#555]"}`}><I className="h-4 w-4" />{l}</div>)}
      </div>
      <div className="p-8">
        <p className="label mb-2">00 / Overview</p>
        <p data-t="title" className="font-display text-4xl mb-6">HOW NORTHLINE BUILDERS IS DOING.</p>
        <div className="grid grid-cols-4 gap-3">
          {[["Leads", "54"], ["Visits", "1,712"], ["Google clicks", "1,335"], ["Followers", "1,284"]].map(([l, n]) => (
            <div key={l} className="rounded-2xl border border-[#e0e0e0] p-4"><p className="label !text-[9px] mb-2">{l}</p><p className="font-display text-3xl">{n}</p></div>
          ))}
        </div>
        <div className="mt-4 rounded-2xl border border-[#e0e0e0] h-40 flex items-end gap-2 p-4">
          {[30, 45, 38, 52, 48, 60, 58, 70, 66, 78, 74, 88].map((h, i) => <div key={i} className="flex-1 bg-black rounded-sm" style={{ height: `${h}%`, opacity: 0.3 + i / 18 }} />)}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Google Analytics (illustration) ---------------- */
function GaFrame({ children, adminOn }: { children: React.ReactNode; adminOn?: boolean }) {
  return (
    <div className="h-full flex flex-col bg-[#f8f9fa] text-[#202124]">
      <div className="h-14 bg-white border-b border-[#dadce0] flex items-center gap-4 px-4">
        <BarChart3 className="h-6 w-6 text-[#e37400]" /><span className="text-[18px] text-[#5f6368]">Analytics</span>
        <span className="text-[13px] text-[#5f6368] flex items-center gap-1">All accounts › <b className="text-[#202124] font-medium">northlinebuilders.com</b><ChevronDown className="h-4 w-4" /></span>
        <span className="ml-auto h-9 w-[320px] rounded-lg bg-[#f1f3f4] flex items-center gap-2 px-3 text-[13px] text-[#80868b]"><Search className="h-4 w-4" />Search</span>
      </div>
      <div className="flex-1 flex min-h-0">
        <div className="w-16 bg-white border-r border-[#dadce0] flex flex-col items-center py-3 gap-5 text-[#5f6368]">
          <Home className="h-5 w-5 text-[#1a73e8]" /><BarChart3 className="h-5 w-5" /><Compass className="h-5 w-5" /><Megaphone className="h-5 w-5" />
          <span data-t="admin" className={`mt-auto mb-1 flex flex-col items-center gap-0.5 text-[10px] rounded-lg px-1.5 py-1 ${adminOn ? "text-[#1a73e8] bg-[#e8f0fe]" : ""}`}><Settings className="h-5 w-5" />Admin</span>
        </div>
        <div className="flex-1 min-w-0 relative">{children}</div>
      </div>
    </div>
  );
}
function GaHome() {
  return (
    <GaFrame>
      <div className="p-6">
        <p className="text-[22px] mb-4">Home</p>
        <div className="bg-white rounded-xl border border-[#dadce0] p-5 grid grid-cols-4 gap-4">
          {[["Users", "1.5K"], ["New users", "1.2K"], ["Average engagement", "1m 12s"], ["Total revenue", "$0.00"]].map(([l, n]) => <div key={l}><p className="text-[12px] text-[#5f6368]">{l}</p><p className="text-[26px]">{n}</p></div>)}
          <div className="col-span-4 h-40 flex items-end gap-1.5">{[40, 50, 46, 60, 55, 70, 64, 72, 68, 80, 76, 84, 70, 88].map((h, i) => <div key={i} className="flex-1 bg-[#1a73e8]/80 rounded-t" style={{ height: `${h}%` }} />)}</div>
        </div>
      </div>
    </GaFrame>
  );
}
function GaAdmin() {
  const col = (title: string, items: [string, string?][]) => (
    <div className="bg-white rounded-xl border border-[#dadce0] p-5 flex-1">
      <p className="text-[13px] text-[#5f6368] mb-1">{title}</p>
      <p className="text-[16px] mb-3">northlinebuilders.com</p>
      {items.map(([l, t]) => <p key={l} data-t={t} className="py-2.5 px-2 -mx-2 rounded text-[14px] text-[#1a73e8]">{l}</p>)}
    </div>
  );
  return (
    <GaFrame adminOn>
      <div className="p-6">
        <p className="text-[22px] mb-4">Admin</p>
        <div className="flex gap-4">
          {col("Account settings", [["Account details"], ["Account access management"], ["All filters"]])}
          {col("Property settings", [["Property details"], ["Property access management", "pam"], ["Data streams"], ["Events"]])}
        </div>
      </div>
    </GaFrame>
  );
}
function GaUsersTable({ extra }: { extra?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-[#dadce0]">
      <div className="grid grid-cols-[1fr_1.4fr_1fr] px-5 py-3 text-[12px] text-[#5f6368] border-b border-[#dadce0]"><span>Name</span><span>Email</span><span>Role</span></div>
      <div className="grid grid-cols-[1fr_1.4fr_1fr] px-5 py-3 text-[14px] border-b border-[#f1f3f4]"><span>Dana Whitaker</span><span>dana@northlinebuilders.com</span><span>Administrator</span></div>
      {extra && <div data-t="row" className="grid grid-cols-[1fr_1.4fr_1fr] px-5 py-3 text-[14px] bg-[#e6f4ea]"><span>—</span><span>unifictional@gmail.com</span><span>Viewer</span></div>}
    </div>
  );
}
function GaPam(p: ScreenProps) {
  return (
    <GaFrame adminOn>
      <div className="p-6">
        <div className="flex items-center mb-4">
          <p className="text-[22px]">Property access management</p>
          <span data-t="plus" className="ml-auto h-11 w-11 rounded-full bg-[#1a73e8] text-white grid place-items-center shadow"><Plus className="h-6 w-6" /></span>
        </div>
        {p.on("menu") && (
          <div className="absolute right-6 top-[76px] z-10 bg-white rounded-lg shadow-lg border border-[#dadce0] py-2 w-52 text-[14px]">
            <p data-t="addusers" className="px-4 py-2.5 bg-[#f1f3f4]">Add users</p><p className="px-4 py-2.5">Add user groups</p>
          </div>
        )}
        <GaUsersTable />
      </div>
    </GaFrame>
  );
}
function GaAdd(p: ScreenProps) {
  return (
    <GaFrame adminOn>
      <div className="p-6"><p className="text-[22px] mb-4">Property access management</p><GaUsersTable /></div>
      <Dim />
      <div className="absolute right-0 top-0 bottom-0 w-[560px] bg-white shadow-2xl">
        <div className="flex items-center gap-3 px-5 h-14 border-b border-[#dadce0]"><X className="h-5 w-5 text-[#5f6368]" /><span className="text-[17px]">Add roles and data restrictions</span><GBtn t="add" primary className="ml-auto">Add</GBtn></div>
        <div className="p-5 space-y-4">
          <div>
            <p className="text-[14px] font-medium mb-2">Email addresses</p>
            <span data-t="email" className={`flex items-center h-11 rounded-md border px-3 text-[15px] ${p.active === "email" ? "border-[#1a73e8] ring-2 ring-[#1a73e8]/20" : "border-[#dadce0]"}`}>{p.v("email") || <span className="text-[#9aa0a6]">Enter email addresses</span>}{caret(p, "email")}</span>
            <p className="mt-2 text-[13px] text-[#5f6368] flex items-center gap-2"><span className="h-4 w-4 rounded-sm bg-[#1a73e8] grid place-items-center"><Check className="h-3 w-3 text-white" /></span>Notify new users by email</p>
          </div>
          <div>
            <p className="text-[14px] font-medium mb-2">Roles</p>
            {["Administrator", "Editor", "Marketer", "Analyst", "Viewer"].map((r) => {
              const picked = r === "Viewer" && p.on("viewer");
              return (
                <p key={r} data-t={r === "Viewer" ? "viewer" : undefined} className="flex items-center gap-3 py-2 text-[14px]">
                  <span className={`h-5 w-5 rounded-full border-2 grid place-items-center ${picked ? "border-[#1a73e8]" : "border-[#5f6368]"}`}>{picked && <span className="h-2.5 w-2.5 rounded-full bg-[#1a73e8]" />}</span>{r}
                </p>
              );
            })}
          </div>
        </div>
      </div>
    </GaFrame>
  );
}
function GaDone() {
  return (
    <GaFrame adminOn>
      <div className="p-6"><p className="text-[22px] mb-4">Property access management</p><GaUsersTable extra /></div>
      <div className="absolute left-6 bottom-6 bg-[#323232] text-white text-[14px] rounded-md px-4 py-3 shadow-lg">1 user added</div>
    </GaFrame>
  );
}

/* ---------------- Search Console (illustration) ---------------- */
function GscFrame({ children, settingsOn }: { children: React.ReactNode; settingsOn?: boolean }) {
  return (
    <div className="h-full flex bg-[#f8f9fa] text-[#202124]">
      <div className="w-[250px] bg-white border-r border-[#dadce0] p-3 flex flex-col gap-0.5 text-[14px]">
        <p className="text-[18px] text-[#5f6368] px-2 py-2 mb-2">Search Console</p>
        <span data-t="property" className="flex items-center gap-2 border border-[#dadce0] rounded-md px-3 h-11 mb-3 text-[13px]"><Globe className="h-4 w-4 text-[#5f6368]" />northlinebuilders.com<ChevronDown className="h-4 w-4 ml-auto" /></span>
        {["Overview", "URL inspection", "Performance", "Pages", "Sitemaps", "Core Web Vitals", "Links"].map((x, i) => <p key={x} className={`px-3 py-2 rounded-r-full ${i === 0 && !settingsOn ? "bg-[#e8f0fe] text-[#1967d2]" : ""}`}>{x}</p>)}
        <p data-t="settings" className={`mt-auto px-3 py-2 rounded-r-full flex items-center gap-2 ${settingsOn ? "bg-[#e8f0fe] text-[#1967d2]" : ""}`}><Settings className="h-4 w-4" />Settings</p>
        <p className="px-3 py-2 text-[#5f6368]">Submit feedback</p>
      </div>
      <div className="flex-1 min-w-0 relative">{children}</div>
    </div>
  );
}
function GscHome() {
  return (
    <GscFrame>
      <div className="p-6"><p className="text-[22px] mb-4">Overview</p>
        <div className="bg-white rounded-xl border border-[#dadce0] p-5"><p className="text-[14px] mb-3">Performance</p><div className="h-48 flex items-end gap-1">{[20, 26, 24, 30, 34, 31, 40, 44, 42, 50, 56, 54, 62, 66].map((h, i) => <div key={i} className="flex-1 bg-[#4285f4]/70 rounded-t" style={{ height: `${h}%` }} />)}</div></div>
      </div>
    </GscFrame>
  );
}
function GscSettings() {
  return (
    <GscFrame settingsOn>
      <div className="p-6"><p className="text-[22px] mb-4">Settings</p>
        <div className="bg-white rounded-xl border border-[#dadce0] p-5 w-[560px]">
          <p className="text-[13px] text-[#5f6368] mb-2">Property settings</p>
          <p data-t="users" className="flex items-center gap-3 py-3 text-[15px] border-b border-[#f1f3f4]"><Users className="h-5 w-5 text-[#5f6368]" />Users and permissions<span className="ml-auto text-[#5f6368]">›</span></p>
          <p className="flex items-center gap-3 py-3 text-[15px] border-b border-[#f1f3f4]"><Lock className="h-5 w-5 text-[#5f6368]" />Ownership verification<span className="ml-auto text-[#5f6368]">›</span></p>
          <p className="flex items-center gap-3 py-3 text-[15px]"><Gauge className="h-5 w-5 text-[#5f6368]" />Crawl stats<span className="ml-auto text-[#5f6368]">›</span></p>
        </div>
      </div>
    </GscFrame>
  );
}
function GscTable({ extra }: { extra?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-[#dadce0]">
      <div className="grid grid-cols-[1.4fr_1fr_1fr] px-5 py-3 text-[12px] text-[#5f6368] border-b border-[#dadce0]"><span>Email</span><span>Name</span><span>Permission</span></div>
      <div className="grid grid-cols-[1.4fr_1fr_1fr] px-5 py-3 text-[14px]"><span>dana@northlinebuilders.com</span><span>Dana Whitaker</span><span>Owner</span></div>
      {extra && <div data-t="row" className="grid grid-cols-[1.4fr_1fr_1fr] px-5 py-3 text-[14px] bg-[#e6f4ea]"><span>unifictional@gmail.com</span><span>—</span><span>Full</span></div>}
    </div>
  );
}
function GscUsers({ dialog, p, extra }: { dialog?: boolean; p?: ScreenProps; extra?: boolean }) {
  return (
    <GscFrame settingsOn>
      <div className="p-6">
        <div className="flex items-center mb-4"><p className="text-[22px]">Users and permissions</p><GBtn t="adduser" primary className="ml-auto"><Plus className="h-4 w-4" />Add user</GBtn></div>
        <GscTable extra={extra} />
      </div>
      {dialog && p && (<>
        <Dim />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[440px] bg-white rounded-xl shadow-2xl p-6 space-y-4">
          <p className="text-[18px]">Add user</p>
          <Field p={p} k="email" label="Email address" ph="name@example.com" />
          <label className="block"><span className="block text-[12px] text-[#5f6368] mb-1">Permission</span><span data-t="perm" className="flex items-center h-10 rounded-md border border-[#dadce0] px-3 text-[15px]">Full<ChevronDown className="h-4 w-4 ml-auto" /></span></label>
          <div className="flex justify-end gap-2 pt-2"><GBtn>Cancel</GBtn><GBtn t="add" primary>Add</GBtn></div>
        </div>
      </>)}
    </GscFrame>
  );
}

/* ---------------- Google Business Profile (illustration) ---------------- */
function GbpSearch({ p, modal }: { p: ScreenProps; modal?: React.ReactNode }) {
  return (
    <div className="h-full bg-white text-[#202124] relative">
      <div className="h-16 flex items-center gap-5 px-8 border-b border-[#ebebeb]">
        <span className="text-[22px] font-medium text-[#4285f4]">Search</span>
        <span className="h-11 w-[520px] rounded-full border border-[#dfe1e5] flex items-center gap-2 px-5 text-[15px]">northline builders<Search className="h-4 w-4 ml-auto text-[#4285f4]" /></span>
      </div>
      <div className="px-8 pt-5">
        <div data-t="panel" className="border border-[#dadce0] rounded-2xl p-5 w-[640px] relative">
          <div className="flex items-start">
            <div>
              <p className="text-[13px] text-[#5f6368] mb-1">Your business on Google</p>
              <p className="text-[24px]">Northline Builders</p>
              <p className="text-[14px] text-[#5f6368] flex items-center gap-1">4.9 <Star className="h-4 w-4 fill-[#fbbc04] text-[#fbbc04]" /> (47) · General contractor in Everett</p>
            </div>
            <span data-t="dots" className="ml-auto h-10 w-10 rounded-full grid place-items-center hover:bg-[#f1f3f4]"><MoreVertical className="h-5 w-5 text-[#5f6368]" /></span>
          </div>
          <div className="flex flex-wrap gap-2 mt-4">{["Edit profile", "Read reviews", "Photos", "Performance", "Advertise"].map((x) => <span key={x} className="rounded-full border border-[#dadce0] px-3.5 py-1.5 text-[13px] text-[#1a73e8]">{x}</span>)}</div>
          {p.on("menu") && (
            <div className="absolute right-4 top-14 z-10 bg-white rounded-lg shadow-lg border border-[#dadce0] py-2 w-64 text-[14px]">
              <p data-t="settings" className="px-4 py-2.5 bg-[#f1f3f4]">Business Profile settings</p><p className="px-4 py-2.5">Notifications</p><p className="px-4 py-2.5">Add another business</p>
            </div>
          )}
        </div>
        <div className="mt-6 space-y-4 w-[640px]">{[1, 2].map((i) => <div key={i}><div className="h-3 w-48 bg-[#e8eaed] rounded mb-2" /><div className="h-4 w-96 bg-[#d2e3fc] rounded mb-2" /><div className="h-3 w-full bg-[#f1f3f4] rounded" /></div>)}</div>
      </div>
      {modal && (<><Dim />{modal}</>)}
    </div>
  );
}
const GbpModal = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] bg-white rounded-xl shadow-2xl">
    <div className="flex items-center px-5 h-14 border-b border-[#ebebeb]"><span className="text-[17px]">{title}</span><X className="h-5 w-5 ml-auto text-[#5f6368]" /></div>
    <div className="p-5">{children}</div>
  </div>
);

/* ---------------- Facebook (illustration) ---------------- */
function FbFrame({ children, side }: { children: React.ReactNode; side: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col bg-[#f0f2f5] text-[#050505] relative">
      <div className="h-14 bg-white shadow-sm flex items-center gap-3 px-4">
        <span className="h-10 w-10 rounded-full bg-[#1877f2] text-white grid place-items-center text-[22px] font-bold">f</span>
        <span className="h-10 w-60 rounded-full bg-[#f0f2f5] flex items-center gap-2 px-4 text-[14px] text-[#65676b]"><Search className="h-4 w-4" />Search</span>
        <Bell className="h-5 w-5 ml-auto text-[#65676b]" />
      </div>
      <div className="flex-1 flex min-h-0">
        <div className="w-[260px] bg-white p-3 space-y-0.5 text-[15px] border-r border-[#e4e6eb]">{side}</div>
        <div className="flex-1 min-w-0 relative p-6">{children}</div>
      </div>
    </div>
  );
}
const FbSideItem = ({ t, children, on }: { t?: string; children: React.ReactNode; on?: boolean }) => (
  <p data-t={t} className={`px-3 py-2.5 rounded-lg flex items-center gap-3 ${on ? "bg-[#e7f3ff] text-[#1877f2] font-medium" : ""}`}>{children}</p>
);
const FbPageSide = ({ settingsOn }: { settingsOn?: boolean }) => (<>
  <p className="px-3 py-2 text-[17px] font-semibold">Northline Builders</p>
  <FbSideItem><Home className="h-5 w-5" />Professional dashboard</FbSideItem>
  <FbSideItem><Inbox className="h-5 w-5" />Inbox</FbSideItem>
  <FbSideItem><BarChart3 className="h-5 w-5" />Insights</FbSideItem>
  <FbSideItem t="settings" on={settingsOn}><Settings className="h-5 w-5" />Settings</FbSideItem>
</>);
const FbSettingsSide = ({ accessOn }: { accessOn?: boolean }) => (<>
  <p className="px-3 py-2 text-[20px] font-bold">Settings</p>
  <p className="px-3 pt-2 text-[13px] text-[#65676b]">Your Page</p>
  <FbSideItem>Page setup</FbSideItem>
  <FbSideItem t="access" on={accessOn}><Users className="h-5 w-5" />Page access</FbSideItem>
  <FbSideItem>Linked accounts</FbSideItem>
  <FbSideItem>Notifications</FbSideItem>
</>);
function FbAccess({ p, dialog, confirm }: { p: ScreenProps; dialog?: boolean; confirm?: boolean }) {
  return (
    <FbFrame side={<FbSettingsSide accessOn />}>
      <div className="bg-white rounded-xl shadow-sm p-5 w-[560px]">
        <p className="text-[20px] font-bold mb-1">Page access</p>
        <div className="flex items-center mt-4 mb-2"><p className="text-[16px] font-semibold">People with Facebook access</p><span data-t="addnew" className="ml-auto bg-[#e7f3ff] text-[#1877f2] rounded-md px-4 py-2 text-[15px] font-semibold">Add new</span></div>
        <div className="flex items-center gap-3 py-2"><span className="h-10 w-10 rounded-full bg-[#ccd0d5]" /><div><p className="text-[15px] font-semibold">Dana Whitaker</p><p className="text-[13px] text-[#65676b]">Full control</p></div></div>
      </div>
      {dialog && (<>
        <Dim />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] bg-white rounded-xl shadow-2xl p-5">
          <p className="text-[19px] font-bold text-center mb-4">Give someone access to your Page</p>
          <span data-t="search" className={`flex items-center gap-2 h-11 rounded-full bg-[#f0f2f5] px-4 text-[15px] ${p.active === "search" ? "ring-2 ring-[#1877f2]" : ""}`}><Search className="h-4 w-4 text-[#65676b]" />{p.v("search") || <span className="text-[#65676b]">Search by name or email</span>}{caret(p, "search")}</span>
          {p.on("results") && (
            <p data-t="result" className={`mt-3 flex items-center gap-3 rounded-lg p-2 ${p.on("picked") ? "bg-[#e7f3ff]" : ""}`}><span className="h-10 w-10 rounded-full bg-black text-white grid place-items-center font-display">U</span><span><b className="text-[15px]">Unifictional</b><br /><span className="text-[13px] text-[#65676b]">Marketing studio</span></span>{p.on("picked") && <Check className="h-5 w-5 ml-auto text-[#1877f2]" />}</p>
          )}
          <p className="mt-4 flex items-center gap-3 text-[14px]"><span className="h-6 w-11 rounded-full bg-[#ccd0d5] relative"><span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white" /></span>Allow this person to have full control</p>
          <span data-t="give" className={`mt-5 block text-center rounded-md py-2.5 text-[15px] font-semibold ${p.on("picked") ? "bg-[#1877f2] text-white" : "bg-[#e4e6eb] text-[#bcc0c4]"}`}>Give access</span>
        </div>
      </>)}
      {confirm && (<>
        <Dim />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[440px] bg-white rounded-xl shadow-2xl p-6">
          <p className="text-[19px] font-bold mb-2">Please re-enter your password</p>
          <p className="text-[14px] text-[#65676b] mb-4">For your security, you must enter your password to continue.</p>
          <span data-t="password" className="flex items-center h-11 rounded-md border border-[#ccd0d5] px-3 text-[18px] tracking-widest">••••••••</span>
          <span className="mt-4 block text-center rounded-md py-2.5 text-[15px] font-semibold bg-[#1877f2] text-white">Submit</span>
        </div>
      </>)}
    </FbFrame>
  );
}

export const SCREENS: Record<string, (p: ScreenProps) => React.ReactElement> = {
  "p-landing": () => <PLanding />, "p-signup": (p) => <PSignup {...p} />, "p-sent": () => <PSent />, "p-email": () => <PEmail />, "p-dash": () => <PDash />,
  "ga-home": () => <GaHome />, "ga-admin": () => <GaAdmin />, "ga-pam": (p) => <GaPam {...p} />, "ga-add": (p) => <GaAdd {...p} />, "ga-done": () => <GaDone />,
  "gsc-home": () => <GscHome />, "gsc-settings": () => <GscSettings />, "gsc-users": () => <GscUsers />, "gsc-dialog": (p) => <GscUsers dialog p={p} />, "gsc-done": () => <GscUsers extra />,
  "gbp-search": (p) => <GbpSearch p={p} />,
  "gbp-settings": (p) => <GbpSearch p={p} modal={<GbpModal title="Business Profile settings">{[["Profile settings"], ["People and access", "people"], ["Advanced settings"], ["Remove Business Profile"]].map(([l, t]) => <p key={l} data-t={t} className="flex items-center py-3 text-[15px] border-b border-[#f1f3f4] last:border-0">{l}<span className="ml-auto text-[#5f6368]">›</span></p>)}</GbpModal>} />,
  "gbp-people": (p) => <GbpSearch p={p} modal={<GbpModal title="People and access"><div className="flex items-center mb-3"><span className="text-[14px] text-[#5f6368]">1 person</span><span data-t="add" className="ml-auto inline-flex items-center gap-2 text-[#1a73e8] text-[14px] font-medium rounded-full border border-[#dadce0] px-4 py-2"><UserPlus className="h-4 w-4" />Add</span></div><p className="flex items-center gap-3 py-2 text-[14px]"><span className="h-9 w-9 rounded-full bg-[#dadce0]" />Dana Whitaker<span className="ml-auto text-[#5f6368]">Primary owner</span></p></GbpModal>} />,
  "gbp-invite": (p) => <GbpSearch p={p} modal={<GbpModal title="Add new user"><div className="space-y-4"><Field p={p} k="email" label="Name or email" ph="Enter name or email" /><div><p className="text-[12px] text-[#5f6368] mb-2">Access</p>{["Owner", "Manager"].map((r) => { const picked = r === "Manager" && p.on("manager"); return <p key={r} data-t={r === "Manager" ? "manager" : undefined} className="flex items-center gap-3 py-1.5 text-[14px]"><span className={`h-5 w-5 rounded-full border-2 grid place-items-center ${picked ? "border-[#1a73e8]" : "border-[#5f6368]"}`}>{picked && <span className="h-2.5 w-2.5 rounded-full bg-[#1a73e8]" />}</span>{r}</p>; })}</div><div className="flex justify-end"><GBtn t="invite" primary>Invite</GBtn></div></div></GbpModal>} />,
  "fb-page": () => <FbFrame side={<FbPageSide />}><div className="bg-white rounded-xl shadow-sm overflow-hidden"><div className="h-36 bg-gradient-to-r from-[#d8dadf] to-[#c4c7cc]" /><div className="p-5"><p className="text-[26px] font-bold">Northline Builders</p><p className="text-[14px] text-[#65676b]">860 followers · General contractor</p></div></div></FbFrame>,
  "fb-settings": () => <FbFrame side={<FbSettingsSide />}><div className="bg-white rounded-xl shadow-sm p-6 w-[520px]"><p className="text-[20px] font-bold mb-2">Page setup</p><div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-10 rounded-lg bg-[#f0f2f5]" />)}</div></div></FbFrame>,
  "fb-access": (p) => <FbAccess p={p} />, "fb-invite": (p) => <FbAccess p={p} dialog />, "fb-confirm": (p) => <FbAccess p={p} confirm />,
};
