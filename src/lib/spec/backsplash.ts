/**
 * The backsplash's two representations, in one place. `heightIn` is what the
 * photo measured and what the twin draws; `height` is the three-word category
 * the bid label and the render prompt speak. They must never disagree — a
 * slider that grew the drawn field while the estimate kept quoting the old word
 * is exactly the "the price doesn't match the model" complaint.
 *
 * Pure: importable from the reconciler, the estimator and the studio panel.
 */
import type { KitchenSpec } from './types';

export type BacksplashHeightWord = KitchenSpec['backsplash']['height'];

/** the category a measured height belongs to (reconcile.ts's own ladder) */
export function backsplashHeightWord(heightIn: number): BacksplashHeightWord {
  return heightIn <= 8 ? 'ledge' : heightIn <= 22 ? 'standard' : 'full-height';
}

/**
 * The splash height the estimator prices, in feet. A measured height wins
 * everywhere it is set, the same way layout.ts draws it; the category is the
 * fallback for a spec the photo could not measure.
 */
export function backsplashHeightFt(bs: Pick<KitchenSpec['backsplash'], 'height' | 'heightIn'>): number {
  if (typeof bs.heightIn === 'number' && Number.isFinite(bs.heightIn) && bs.heightIn > 0) return bs.heightIn / 12;
  return bs.height === 'full-height' ? 2.5 : bs.height === 'ledge' ? 0.5 : 1.5;
}
