import { processSteps } from "@/lib/site";
import { Reveal } from "@/components/ui/reveal";

/** The four steps. Compact grid by default; full timeline when `detailed`. */
export function ProcessList({ detailed = false }: { detailed?: boolean }) {
  if (detailed) {
    return (
      <div className="mt-16 border-t border-line">
        {processSteps.map((s, i) => (
          <Reveal key={s.index} delay={i * 60}>
            <div className="grid grid-cols-1 gap-6 border-b border-line py-12 sm:py-16 md:grid-cols-12">
              <div className="md:col-span-3">
                <span className="font-display text-6xl font-medium text-terracotta/90 sm:text-7xl">
                  {s.index}
                </span>
              </div>
              <div className="md:col-span-9">
                <h3 className="font-display text-3xl font-medium text-ink sm:text-4xl">
                  {s.title}
                </h3>
                <p className="mt-4 max-w-prose text-lg leading-relaxed text-ink-soft">
                  {s.detail}
                </p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
      {processSteps.map((s) => (
        <div key={s.index} className="bg-bone p-7">
          <span className="font-mono text-xs text-terracotta">{s.index}</span>
          <h3 className="mt-4 font-display text-xl font-medium text-ink">{s.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">{s.description}</p>
        </div>
      ))}
    </div>
  );
}
