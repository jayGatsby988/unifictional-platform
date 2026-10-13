/**
 * A faithful, static rendering of the Client Portal's Overview screen for the website.
 * Sample numbers only (labelled as such); no data is fetched.
 */
const NAV = ["Overview", "Website", "Search", "Social", "SEO Autopilot", "Quote tool", "Billing", "Plans"];
const STATS = [
  { label: "Website visits", value: "2,431", delta: "+18%" },
  { label: "New leads", value: "37", delta: "+9" },
  { label: "Phone calls", value: "21", delta: "+6" },
  { label: "Google rank", value: "#3", delta: "↑4" },
];
const POINTS = [22, 26, 24, 31, 29, 35, 33, 41, 38, 46, 44, 52, 49, 58];

export function PortalMock() {
  const max = Math.max(...POINTS), w = 520, h = 120;
  const path = POINTS.map((p, i) => `${(i / (POINTS.length - 1)) * w},${h - (p / max) * (h - 12)}`).join(" ");
  return (
    <div className="relative">
      <div aria-hidden className="absolute -inset-6 rounded-[28px] bg-terracotta/10 blur-2xl" />
      <figure
        className="relative overflow-hidden rounded-2xl border border-line bg-bone shadow-[0_30px_80px_-30px_rgba(10,10,10,0.45)]"
        aria-label="Sample of the Unifictional client portal dashboard"
      >
        {/* browser chrome */}
        <div className="flex items-center gap-2 border-b border-line bg-sand/70 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-ink/20" />
          <span className="h-2.5 w-2.5 rounded-full bg-ink/20" />
          <span className="h-2.5 w-2.5 rounded-full bg-ink/20" />
          <span className="ml-3 truncate rounded-full bg-bone px-3 py-0.5 font-mono text-[10px] text-ink-muted">Unifictional client portal</span>
        </div>
        <div className="grid grid-cols-[150px_1fr] max-sm:grid-cols-1">
          {/* sidebar */}
          <aside className="border-r border-line bg-bone p-3 max-sm:hidden">
            <div className="mb-4 flex items-center gap-2 px-1">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-ink font-display text-[11px] font-semibold text-bone">U</span>
              <span className="font-display text-xs font-medium uppercase tracking-wide text-ink">Unifictional</span>
            </div>
            <ul className="space-y-0.5">
              {NAV.map((n, i) => (
                <li key={n} className={`rounded-md px-2 py-1.5 text-[11px] ${i === 0 ? "bg-ink text-bone" : "text-ink-soft"}`}>{n}</li>
              ))}
            </ul>
          </aside>
          {/* main */}
          <div className="min-w-0 p-4 sm:p-5">
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-ink-muted">00 / Overview</p>
            <p className="mt-1 font-display text-xl font-medium uppercase leading-tight text-ink sm:text-2xl">How Northline Builders is doing.</p>
            <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
              {STATS.map((s) => (
                <div key={s.label} className="rounded-lg border border-line bg-bone p-2.5">
                  <p className="text-[9px] uppercase tracking-wide text-ink-muted">{s.label}</p>
                  <p className="mt-1 font-display text-lg font-medium leading-none text-ink">{s.value}</p>
                  <p className="mt-1 text-[10px] font-medium text-terracotta">{s.delta}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-lg border border-line bg-bone p-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-wide text-ink-muted">Visits, last 14 days</p>
                <p className="text-[10px] text-ink-muted">Updated nightly</p>
              </div>
              <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-24 w-full" preserveAspectRatio="none" role="img" aria-label="Rising visits chart">
                <polyline points={`0,${h} ${path} ${w},${h}`} className="fill-terracotta/10" />
                <polyline points={path} fill="none" className="stroke-terracotta" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="flex items-center gap-3 rounded-lg border border-line bg-bone p-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-ink font-display text-lg font-medium text-bone">A</span>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-ink">Website health</p>
                  <p className="truncate text-[10px] text-ink-muted">100% uptime · loads in 0.4s</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-line bg-bone p-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-terracotta/15 font-display text-sm font-medium text-terracotta">3</span>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-ink">New quote requests</p>
                  <p className="truncate text-[10px] text-ink-muted">From the 3D tool on your site</p>
                </div>
              </div>
            </div>
          </div>
        </div>
        <figcaption className="border-t border-line px-4 py-2 text-[10px] text-ink-muted">Sample dashboard. Yours shows your real numbers.</figcaption>
      </figure>
    </div>
  );
}
