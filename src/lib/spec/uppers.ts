/**
 * The two-tier wall-cabinet vocabulary, in one place — the same role
 * `hood.ts` plays for the hood.
 *
 * The client's words: "there are so many more cabinets … i feel as tho there
 * is a problem with the small top cabinets not being registered/created."
 * Their back wall carries a lower tier of ~36" glass doors and a SECOND,
 * shorter tier of ~18" boxes above it with a rail between, and the analyzer
 * saw it — `detected.notes` on the fixture reads "stacked/transom cabinet
 * configuration is visible, so upper height is modeled as an extended 54 in
 * equivalent" — but had nowhere to put it, so both tiers collapsed into one
 * tall door.
 *
 * `CabinetRun.uppers2` is that second tier and `uppers2HeightIn` is its box
 * height, measured DOWN from the top of the row. Everything derived from them
 * lives here so the layout, the reconciler, the estimator, the Layout panel
 * and the fitter cannot disagree about how tall each tier is.
 *
 * Pure: no three, no R3F, safe to import from server code.
 */
import type { CabinetRun, UpperCabinet } from './types';

/** A tier-2 box shorter than this is a reveal, not a cabinet. Mirrors the zod min. */
export const TIER2_MIN_IN = 9;
/** …and taller than this it is the row, not a transom over it. Mirrors the zod max. */
export const TIER2_MAX_IN = 36;
/** Most boxes a second tier may carry. Mirrors the zod `.max(16)` on `uppers2`. */
export const TIER2_MAX_BOXES = 16;
/**
 * The tier-1 height a stacked row is derived AROUND: a 36" door is the box a
 * stacked kitchen puts on the bottom, so a 54" row leaves an 18" transom —
 * which is what the client's photo measures (380 px : 215 px = 1.77 : 1, and
 * 54 / 2.77 = 19.5).
 */
export const TIER1_TARGET_IN = 36;
/** A row shorter than tier-1 target + tier-2 minimum cannot hold two tiers at all. */
export const STACK_MIN_ROW_IN = TIER1_TARGET_IN + TIER2_MIN_IN;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Only the fields this vocabulary reads, so scripts can pass a partial run. */
export type StackedRunLike = Pick<CabinetRun, 'hasUppers' | 'uppers' | 'uppers2' | 'uppers2HeightIn'>;

/**
 * Whether this run actually draws a second tier. A run with no uppers, or an
 * empty / absent `uppers2`, is the single-tier row the scene has always drawn.
 */
export function hasUppers2(run: StackedRunLike | null | undefined): boolean {
  if (!run || run.hasUppers === false) return false;
  return Array.isArray(run.uppers2) && run.uppers2.length > 0 && Array.isArray(run.uppers) && run.uppers.length > 0;
}

/**
 * Height of a tier-2 box in inches for a row `rowIn` inches tall.
 *
 * A declared number wins, clamped so the tier can never eat the row: at most
 * `rowIn - TIER1_TARGET_IN` when the row can afford a 36" bottom tier, and
 * never more than half the row otherwise. When nothing is declared the tier is
 * whatever is left over a 36" bottom door — 18" on a 54" row.
 *
 * Returns 0 when the row cannot hold two tiers, which is the caller's cue to
 * draw one.
 */
export function resolveUppers2HeightIn(rowIn: number, run?: StackedRunLike | null): number {
  const row = isNum(rowIn) ? rowIn : 0;
  if (row < STACK_MIN_ROW_IN) return 0;
  const hi = Math.min(TIER2_MAX_IN, Math.max(TIER2_MIN_IN, row - TIER1_TARGET_IN));
  const declared = run && isNum(run.uppers2HeightIn) ? run.uppers2HeightIn : null;
  if (declared === null) return clamp(row - TIER1_TARGET_IN, TIER2_MIN_IN, hi);
  return clamp(declared, TIER2_MIN_IN, hi);
}

/** Height of a tier-1 box, i.e. the rest of the row. Equals `rowIn` when there is no second tier. */
export function resolveUppers1HeightIn(rowIn: number, run?: StackedRunLike | null): number {
  const row = isNum(rowIn) ? rowIn : 0;
  if (!hasUppers2(run ?? null)) return row;
  return Math.max(TIER2_MIN_IN, row - resolveUppers2HeightIn(row, run));
}

/**
 * A second tier for a run that has none, mirroring tier 1's widths so the
 * boxes line up vertically the way a real stacked run does. A gap in tier 1
 * (over the hood, over the fridge) stays a gap in tier 2 ONLY where the thing
 * below reaches into the row — a hood-gap does not, since the whole point of
 * the client's photo is a cabinet sitting on the hood — so only
 * 'appliance-gap' and 'corner' are carried up. Used by the Layout panel's
 * "Stacked uppers" toggle; the analyzer writes its own list.
 */
export function deriveUppers2(uppers: readonly UpperCabinet[] | null | undefined): UpperCabinet[] {
  if (!Array.isArray(uppers)) return [];
  return uppers
    .filter((u) => u && isNum(u.widthIn) && u.widthIn > 0)
    .map((u) => ({
      widthIn: u.widthIn,
      type: u.type === 'appliance-gap' || u.type === 'corner' ? u.type : 'door',
      heightIn: null,
    }));
}
