/**
 * The recurring section opener, reproduced from unifictional.com's
 * SectionHeading + Eyebrow: a mono eyebrow (optional gold index and a short
 * rule), an uppercase Oswald title and an optional intro. Every colour is a
 * token, so it reads the same inside `.lp-light` and `.lp-dark`.
 */
import { Fragment, type ReactNode } from 'react';
import { cx } from './cx';

/** Small mono label, like an annotation on an architectural drawing. */
export function LpEyebrow({ index, children, className }: { index?: string; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.22em] text-dim', className)}>
      {index ? (
        <>
          <span className="text-brass">{index}</span>
          <span aria-hidden className="h-px w-7 shrink-0 bg-current opacity-30" />
        </>
      ) : null}
      <span>{children}</span>
    </span>
  );
}

const TITLE_SIZE = {
  /** The site's heading, held a step smaller on tablets for the pinned stages. */
  sm: 'text-4xl sm:text-5xl md:text-[2.7rem] lg:text-[3.4rem]',
  default: 'text-4xl sm:text-5xl md:text-[3.4rem]',
  /** The closing band. */
  lg: 'text-4xl sm:text-5xl md:text-6xl',
} as const;

function isLines(t: ReactNode | readonly string[]): t is readonly string[] {
  return Array.isArray(t) && t.every((x) => typeof x === 'string');
}

function lines(ls: readonly string[]): ReactNode {
  return ls.map((line, i) => (
    <Fragment key={i}>
      {i > 0 ? <br /> : null}
      {line}
    </Fragment>
  ));
}

export function LpHeading({
  index,
  eyebrow,
  title,
  intro,
  align = 'left',
  size = 'default',
  as: Tag = 'h2',
  className,
}: {
  index?: string;
  eyebrow?: string;
  /** A node, or an array of lines joined with `<br />`. */
  title: ReactNode | readonly string[];
  intro?: ReactNode;
  align?: 'left' | 'center';
  size?: keyof typeof TITLE_SIZE;
  as?: 'h1' | 'h2' | 'h3';
  className?: string;
}) {
  return (
    <div className={cx('flex flex-col gap-6', align === 'center' && 'items-center text-center', className)}>
      {eyebrow ? <LpEyebrow index={index}>{eyebrow}</LpEyebrow> : null}
      <Tag className={cx('font-display lp-h2 max-w-3xl text-ink', TITLE_SIZE[size])}>{isLines(title) ? lines(title) : title}</Tag>
      {intro ? <p className={cx('max-w-[38rem] text-lg leading-relaxed text-muted', align === 'center' && 'mx-auto')}>{intro}</p> : null}
    </div>
  );
}
