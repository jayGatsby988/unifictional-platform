import { cn } from "@/lib/utils";

export function Section({ num, label, title, intro, action, className, children }: {
  num: string; label: string; title: string; intro?: string; action?: React.ReactNode; className?: string; children?: React.ReactNode;
}) {
  return (
    <section className={cn("mb-10 sm:mb-14", className)}>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
        <div>
          <p className="label mb-2">{num} / {label}</p>
          <h1 className="font-display text-3xl sm:text-4xl leading-none">{title}</h1>
          {intro && <p className="mt-3 text-ink-muted max-w-2xl">{intro}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function SubHead({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="label !text-ink-soft">{children}</h2>
      {right}
    </div>
  );
}
