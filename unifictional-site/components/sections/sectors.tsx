import { sectorsServed } from "@/lib/site";
import { PauseOffscreen } from "@/components/ui/pause-offscreen";

/** A quiet ticker of the trades we build for (honest — no fabricated logos). */
export function Sectors() {
  const row = [...sectorsServed, ...sectorsServed];
  return (
    <section className="overflow-hidden border-y border-bone/15 bg-ink py-5">
      <PauseOffscreen>
      <div className="flex w-max animate-marquee items-center gap-10 whitespace-nowrap">
        {row.map((s, i) => (
          <span key={i} className="flex items-center gap-10">
            <span className="font-display text-lg italic text-bone/75">{s}</span>
            <span aria-hidden className="h-1 w-1 rounded-full bg-bone/40" />
          </span>
        ))}
      </div>
      </PauseOffscreen>
    </section>
  );
}
