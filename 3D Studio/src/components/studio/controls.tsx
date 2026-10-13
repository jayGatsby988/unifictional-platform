'use client';
/**
 * Small form/UI primitives used across the Studio panels.
 */
import { useId, useMemo, type ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { Tier } from '@/lib/spec/types';
import type { MaterialDef } from '@/lib/materials/catalog';
import { swatchColor, useSwatchSrc } from '@/components/scene/swatch';
import { cx } from './hooks';

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 mt-5 flex items-center justify-between first:mt-0">
      <div className="eyebrow">{children}</div>
      {right}
    </div>
  );
}

export function Field({ label, hint, children, inline = false }: { label: string; hint?: string; children: ReactNode; inline?: boolean }) {
  return (
    <div className={cx('py-2', inline && 'flex items-center justify-between gap-3')}>
      <div className={cx('min-w-0', !inline && 'mb-1.5')}>
        <div className="text-[13px] text-ink">{label}</div>
        {hint && <div className="text-[11.5px] text-dim">{hint}</div>}
      </div>
      <div className={cx(inline && 'shrink-0')}>{children}</div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-40',
        checked ? 'border-brass bg-brass' : 'border-border-strong bg-surface-2',
      )}
    >
      <span className={cx('inline-block h-4 w-4 rounded-full transition-transform', checked ? 'translate-x-6 bg-[#0a0a0a]' : 'translate-x-1 bg-muted')} />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md', className, ariaLabel }: {
  value: T; options: Array<{ value: T; label: ReactNode; title?: string }>; onChange: (v: T) => void; size?: 'sm' | 'md'; className?: string; ariaLabel?: string;
}) {
  return (
    <div className={cx('inline-flex items-center rounded-full border border-border bg-bg-elev p-0.5', className)} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-full font-medium transition-colors whitespace-nowrap',
            size === 'sm' ? 'h-7 px-2.5 text-[11.5px]' : 'h-8 px-3 text-[12.5px]',
            o.value === value ? 'bg-surface-2 text-ink shadow-[inset_0_0_0_1px_var(--border-strong)]' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string>({ value, options, onChange, className, ariaLabel }: {
  value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; className?: string; ariaLabel?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      className={cx('input h-9 min-w-0 cursor-pointer appearance-none bg-bg-elev pr-8 text-[13px]', className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239a978f' stroke-width='2'><path d='m6 9 6 6 6-6'/></svg>\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Slider({ value, min, max, step = 1, onChange, format, ariaLabel }: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string; ariaLabel?: string;
}) {
  const id = useId();
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return (
    <div className="flex items-center gap-3">
      <input
        id={id}
        aria-label={ariaLabel}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brass/40"
        style={{ background: `linear-gradient(90deg, var(--brass) ${pct}%, rgba(255,255,255,0.12) ${pct}%)`, accentColor: 'var(--brass)' }}
      />
      <div className="num w-16 shrink-0 text-right text-[12.5px] text-muted">{format ? format(value) : value}</div>
    </div>
  );
}

export function Stepper({ value, min, max, step = 1, onChange, ariaLabel }: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void; ariaLabel?: string;
}) {
  return (
    <div className="inline-flex items-center rounded-full border border-border bg-bg-elev" aria-label={ariaLabel}>
      <button type="button" className="grid h-8 w-8 place-items-center rounded-l-full text-muted hover:bg-white/5 hover:text-ink disabled:opacity-30" disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))} aria-label="Decrease"><Minus size={13} /></button>
      <div className="num w-8 text-center text-[13px] text-ink">{value}</div>
      <button type="button" className="grid h-8 w-8 place-items-center rounded-r-full text-muted hover:bg-white/5 hover:text-ink disabled:opacity-30" disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))} aria-label="Increase"><Plus size={13} /></button>
    </div>
  );
}

const TIER_LABEL: Record<Tier, string> = { budget: 'Budget', standard: 'Standard', premium: 'Premium', luxury: 'Luxury' };
const TIER_CLASS: Record<Tier, string> = {
  budget: 'text-muted border-border',
  standard: 'text-ink/80 border-border',
  premium: 'text-brass border-brass/40 bg-brass-soft',
  luxury: 'text-[#c9962e] border-[#c9962e]/40 bg-[#c9962e]/10',
};
export function TierBadge({ tier, className }: { tier: Tier; className?: string }) {
  return <span className={cx('inline-flex h-5 items-center rounded-full border px-1.5 text-[10px] font-medium uppercase tracking-wider', TIER_CLASS[tier], className)}>{TIER_LABEL[tier]}</span>;
}
export const tierLabel = (t: Tier) => TIER_LABEL[t];

export function isImageSwatch(swatch: string) {
  return swatch.startsWith('/') || swatch.startsWith('http') || swatch.startsWith('data:');
}

/** Material swatch: image if the catalog swatch is a path, else a flat colour. */
export function Swatch({ material, size = 20, className, rounded = 'rounded-md' }: { material?: MaterialDef | null; size?: number | string; className?: string; rounded?: string }) {
  // Procedural materials have no texture file — the preview is drawn from the
  // same generator the 3D view uses, so the chip matches the surface exactly.
  const src = useSwatchSrc(material ?? undefined);
  const style = useMemo(() => {
    const s: React.CSSProperties = typeof size === 'number' ? { width: size, height: size } : {};
    if (!material) { s.backgroundImage = 'repeating-linear-gradient(45deg, #2a2c30 0 4px, #202020 4px 8px)'; return s; }
    // longhand only: mixing `background` with `backgroundImage` makes React warn
    // and can drop the image on a re-render.
    s.backgroundColor = swatchColor(material);
    if (src) {
      s.backgroundImage = `url("${src}")`;
      s.backgroundSize = 'cover';
      s.backgroundPosition = 'center';
    }
    return s;
  }, [material, size, src]);
  return <span aria-hidden className={cx('block shrink-0 border border-white/10', rounded, className)} style={style} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border-strong bg-surface-2 px-1 font-mono text-[10.5px] text-muted">{children}</kbd>;
}

/**
 * An inline explanation under a control — why a slider stops where it does,
 * what the photo could not measure, what a number is coupled to.
 *
 * The studio's controls are allowed to clamp and to guess; they are not
 * allowed to do it silently. A slider whose travel the room has already used
 * up, or a value the analyzer estimated off a photo that cut the thing in
 * half, says so here, and where there is exactly one right answer it offers it
 * as the action rather than making the user find the control that holds it.
 */
export function Note({ children, action }: { children: ReactNode; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="mb-2 rounded-[var(--radius-sm)] border border-border bg-white/[0.02] px-2.5 py-2 text-[11.5px] leading-[1.5] text-muted">
      {children}
      {action && (
        <button type="button" onClick={action.onClick} className="ml-1.5 whitespace-nowrap font-medium text-brass underline-offset-2 hover:underline">
          {action.label}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed border-border px-6 py-10 text-center">
      {icon && <div className="text-brass">{icon}</div>}
      <div className="text-[14px] text-ink">{title}</div>
      {body && <div className="max-w-xs text-[12.5px] text-muted">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('shimmer rounded-md', className)} />;
}
