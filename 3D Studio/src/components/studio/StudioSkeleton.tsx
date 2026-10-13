/**
 * Layout-shaped skeleton shown while the client bundle / store hydrate.
 */
export function StudioSkeleton() {
  return (
    <div className="flex h-dvh flex-col bg-bg text-ink" aria-busy="true" aria-label="Loading studio">
      <div className="flex h-14 items-center gap-3 border-b border-border px-4">
        <div className="shimmer h-4 w-24 rounded" />
        <div className="shimmer h-6 w-40 rounded" />
        <div className="flex-1" />
        <div className="shimmer h-8 w-28 rounded-full" />
        <div className="shimmer h-8 w-32 rounded-full" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-56 shrink-0 space-y-2 border-r border-border p-3 lg:block">
          {Array.from({ length: 9 }).map((_, i) => <div key={i} className="shimmer h-7 rounded-md" />)}
        </div>
        <div className="relative flex-1">
          <div className="absolute inset-0 shimmer opacity-60" />
          <div className="absolute inset-x-0 bottom-4 flex justify-center"><div className="shimmer h-7 w-56 rounded-full" /></div>
        </div>
        <div className="hidden w-[380px] shrink-0 space-y-3 border-l border-border p-4 lg:block">
          <div className="shimmer h-9 rounded-full" />
          <div className="shimmer h-7 w-2/3 rounded" />
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="shimmer h-16 rounded-lg" />)}
          </div>
        </div>
      </div>
    </div>
  );
}
