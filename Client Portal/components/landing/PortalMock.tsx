/** A static, CSS-only preview of the client dashboard. */
export function PortalMock() {
  const bars = [38, 52, 44, 61, 58, 70, 66, 74, 71, 83, 79, 92];
  return (
    <div className="rounded-2xl border border-line bg-bone shadow-[0_44px_90px_-50px_rgba(26,23,20,.55)] overflow-hidden">
      <div className="flex items-center gap-2 px-4 h-10 border-b border-line">
        <span className="h-2.5 w-2.5 rounded-full bg-sand" /><span className="h-2.5 w-2.5 rounded-full bg-sand" /><span className="h-2.5 w-2.5 rounded-full bg-sand" />
        <span className="ml-3 font-mono text-[10px] text-ink-muted">portal.unifictional.com · overview</span>
      </div>
      <div className="grid grid-cols-[120px_1fr]">
        <div className="border-r border-line p-3 space-y-1.5 hidden sm:block">
          {["Overview", "Website", "Search", "Social", "Quote tool", "Requests"].map((n, i) => (
            <div key={n} className={`rounded-lg px-2.5 py-1.5 text-[11px] ${i === 0 ? "bg-ink text-bone" : "text-ink-muted"}`}>{n}</div>
          ))}
        </div>
        <div className="p-4 sm:p-5">
          <p className="label !text-[9px] mb-1">00 / Overview</p>
          <p className="font-display text-xl sm:text-2xl leading-none mb-4">How your company is doing.</p>
          <div className="grid grid-cols-4 gap-2 mb-4">
            {[["Leads", "54", "+35%"], ["Visits", "1,712", "+25%"], ["Google clicks", "1,335", "+117%"], ["Followers", "1,284", "+8%"]].map(([l, v, d]) => (
              <div key={l} className="rounded-xl border border-line p-2.5">
                <p className="label !text-[8px] mb-1.5">{l}</p>
                <p className="font-display text-lg sm:text-xl leading-none">{v}</p>
                <p className="text-[10px] text-good mt-1">{d}</p>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-line p-3">
            <p className="label !text-[8px] mb-2">Website visits, daily</p>
            <div className="flex items-end gap-1 h-20">
              {bars.map((b, i) => <div key={i} className="flex-1 rounded-sm bg-ink" style={{ height: `${b}%`, opacity: 0.35 + (i / bars.length) * 0.65 }} />)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
