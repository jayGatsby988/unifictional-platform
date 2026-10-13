/**
 * The hood vocabulary, in one place. The layout, the estimator, the reconciler,
 * the analyzer prompt, the LayoutPanel and the fitter all derive the same
 * answer from it, so "is there a cabinet on the hood" can never mean two
 * things. Pure: no three, no R3F, safe to import from server code.
 *
 * The client's words: "above the vent, there are always cabinets but the 3d
 * model never renders them." A cabinet on the canopy is a real wall cabinet —
 * it is drawn, it is priced, and its height is derived from the row it lives
 * in, never stored as a second number that could contradict the drawing.
 */
import type { Appliance, CabinetRun, KitchenSpec } from './types';

export const HOOD_STYLES = ['chimney', 'under-cabinet', 'custom-insert', 'island', 'none'] as const;
export const HOOD_SHAPES = ['box', 'tapered', 'curved', 'wood-canopy', 'slim'] as const;
export type HoodStyle = (typeof HOOD_STYLES)[number];
export type HoodShape = (typeof HOOD_SHAPES)[number];

export const HOOD_SHAPE_DEFAULT: Record<HoodStyle, HoodShape> = {
  chimney: 'tapered', 'custom-insert': 'wood-canopy', 'under-cabinet': 'slim', island: 'box', none: 'slim',
};

/** canopy height by shape, inches — the numbers layout.ts used to inline */
export const CANOPY_IN: Record<HoodShape, number> = { slim: 6, box: 14, tapered: 14, curved: 16, 'wood-canopy': 18 };

export const CABINET_ABOVE = ['none', 'doors', 'glass', 'panel'] as const;
export type CabinetAbove = (typeof CABINET_ABOVE)[number];

/** what the hood style implies when the photo could not say */
export const CABINET_ABOVE_DEFAULT: Record<HoodStyle, CabinetAbove> = {
  'under-cabinet': 'doors', 'custom-insert': 'doors', chimney: 'none', island: 'none', none: 'none',
};

/** Only the fields the hood vocabulary reads, so scripts can pass a partial appliance. */
export type HoodLike = Pick<Appliance, 'kind' | 'wall' | 't' | 'hoodStyle' | 'hoodShape' | 'cabinetAbove' | 'heightIn' | 'aboveCounterIn' | 'widthIn'>;

export function resolveHoodStyle(a: HoodLike): HoodStyle {
  return (HOOD_STYLES as readonly string[]).includes(a.hoodStyle ?? '') ? (a.hoodStyle as HoodStyle) : 'chimney';
}

export function resolveHoodShape(a: HoodLike): HoodShape {
  return (HOOD_SHAPES as readonly string[]).includes(a.hoodShape ?? '') ? (a.hoodShape as HoodShape) : HOOD_SHAPE_DEFAULT[resolveHoodStyle(a)];
}

/** Shape supplies an unmeasured default, never a minimum larger than the
 * explicitly measured whole unit. A short box hood must not grow a 14in body. */
export function canopyHeightIn(a: HoodLike): number {
  const nominal = CANOPY_IN[resolveHoodShape(a)];
  return typeof a.heightIn === 'number' && Number.isFinite(a.heightIn) && a.heightIn > 0
    ? Math.min(nominal, Math.max(4, a.heightIn)) : nominal;
}

/** what the hood style implies when `cabinetAbove` is null */
export function defaultCabinetAbove(a: HoodLike): CabinetAbove {
  // a slim insert is bolted under a cabinet by definition, whatever style word came with it
  return resolveHoodShape(a) === 'slim' ? 'doors' : CABINET_ABOVE_DEFAULT[resolveHoodStyle(a)];
}

/** the effective word. `hasRow` = a row of uppers actually reaches over this hood. */
export function resolveCabinetAbove(a: HoodLike, hasRow = true): CabinetAbove {
  if (a.wall === 'island' || !hasRow) return 'none';
  return (CABINET_ABOVE as readonly string[]).includes(a.cabinetAbove ?? '') ? (a.cabinetAbove as CabinetAbove) : defaultCabinetAbove(a);
}

/** the run whose wall-cabinet row the hood hangs in, or null */
export function runForHood(spec: KitchenSpec, hood: HoodLike): CabinetRun | null {
  if (hood.wall === 'island') return null;
  const on = spec.runs.filter((r) => r.wall === hood.wall && r.hasUppers !== false);
  const wallFt = hood.wall === 'back' || hood.wall === 'front' ? spec.dims.widthFt : spec.dims.depthFt;
  const inside = on.find((r) => hood.t >= r.start - 0.02 && hood.t <= r.start + r.lengthFt / Math.max(1e-6, wallFt) + 0.02);
  return inside ?? on[0] ?? null;
}

/** Absolute underside from the floor. A measured high row overrides the
 * conventional 18-inch clearance over the actual countertop. */
export function rowBottomIn(spec: KitchenSpec, run: CabinetRun): number {
  const declared = run.upperBottomIn;
  if (typeof declared !== 'number' || !Number.isFinite(declared) || declared <= 0) {
    return spec.cabinets.baseHeightIn + spec.countertop.thicknessIn + 18;
  }
  const ceiling = spec.dims.ceilingFt * 12 - (spec.cabinets.crown ? 3.5 : 0) - 0.004 / 0.0254;
  const floor = spec.cabinets.baseHeightIn + spec.countertop.thicknessIn + 0.5;
  return Math.max(floor, Math.min(declared, Math.max(floor, ceiling - 12)));
}

/** Row height used by the estimator and hood vocabulary. Measured raised
 * rows follow their bounded box height; legacy rows retain their established
 * declared quantity so adding the mounting-height field does not reprice them. */
export function rowHeightIn(spec: KitchenSpec, run: CabinetRun): number {
  const ceiling = spec.dims.ceilingFt * 12 - (spec.cabinets.crown ? 3.5 : 0);
  const measured = typeof run.upperBottomIn === 'number' && Number.isFinite(run.upperBottomIn) && run.upperBottomIn > 0;
  if (!measured) return run.uppersToCeiling ? Math.max(12, ceiling - 54) : run.upperHeightIn ?? spec.cabinets.upperHeightIn;
  const bottom = rowBottomIn(spec, run);
  const height = Math.max(12, Math.min(60, run.upperHeightIn ?? spec.cabinets.upperHeightIn));
  return Math.min(Math.max(12, Math.min(height, ceiling - bottom - 0.01 / 0.0254)), ceiling - bottom - 0.004 / 0.0254);
}

/**
 * How far the TOP of a run's wall cabinets sits below the ceiling, inches,
 * from spec numbers alone. ACCEPTANCE §5 conditions "nothing
 * above a hood may be bare wall" on the row reaching the ceiling: under a row
 * that stops well short, the wall above the row is bare anyway and a hood
 * standing in front of it is an ordinary kitchen, not a defect.
 */
export function rowToCeilingIn(spec: KitchenSpec, run: CabinetRun): number {
  return spec.dims.ceilingFt * 12 - (rowBottomIn(spec, run) + rowHeightIn(spec, run));
}
/** …and how close is close enough. The scene-level net uses the same 12 in. */
export const HOOD_NET_CEILING_IN = 12;

/**
 * Height of the band the cabinet on the hood fills, inches (0 when there is
 * none). Derived from spec numbers alone, so it can differ from the drawn box
 * by an inch or two — good enough for a bid, never to be presented as the
 * drawn number.
 */
export function hoodCabinetBandIn(spec: KitchenSpec, run: CabinetRun, hood: HoodLike): number {
  const canopy = canopyHeightIn(hood);
  const mouth = hood.aboveCounterIn ?? 30;
  const visibleFlue = (hood.heightIn ?? 0) > canopy ? (hood.heightIn as number) - canopy : 0;
  const clearance = rowBottomIn(spec, run) - spec.cabinets.baseHeightIn - spec.countertop.thicknessIn;
  const unitTopAboveRowBottom = Math.max(0, mouth + canopy + visibleFlue - clearance);
  return Math.max(0, rowHeightIn(spec, run) - unitTopAboveRowBottom);
}

/**
 * THE HOOD SAFETY NET — the client's oldest complaint: "the cabinets above the
 * stove vent are still not appearing."
 *
 * A run whose wall cabinets reach the ceiling and whose hood is far shorter
 * than the opening it hangs in has a CABINET over it, not 26 in of bare
 * painted wall framed by cabinetry on both sides. That kitchen does not exist.
 * The analyzer cannot be trusted to say so — on the client's photo it wrote
 * `cabinetAbove: 'none'` EXPLICITLY, which also locks the fitter out
 * (`fit/params.ts` only searches the field when it is null) — so the rule has
 * to fire on the numbers.
 *
 * Deliberately narrow, and every term earns its place:
 *  - `current === 'none'`: an explicit 'doors' / 'glass' / 'panel' is already
 *    right and is never second-guessed;
 *  - `heightIn` finite and positive: a spec that never measured the metal says
 *    nothing about the ratio, so it is left alone. This single term is what
 *    keeps the net off `defaultKitchen()` and off client-marble / client-shelves;
 *  - `bandIn >= HOOD_CAB_DOOR_MIN`: there must be a real box's worth of wall
 *    to fill — nobody hangs a 6 in door;
 *  - `heightIn / openingH <= 0.75`: the hood must be MUCH shorter than the
 *    opening. A canopy that fills its opening has nothing above it.
 *
 * `slim` comes back true for a unit that is plainly an insert (a foot of metal,
 * or under 40% of the opening): those hang off the cabinet they are bolted to
 * rather than standing as a canopy.
 */
export const HOOD_NET_MAX_RATIO = 0.75;
/** under this the metal is an insert bolted to the cabinet, not a canopy */
export const HOOD_NET_SLIM_RATIO = 0.40;
/** …and so is anything this short, whatever the opening */
export const HOOD_NET_SLIM_IN = 12;
/** the band must hold a real door; mirrors `HOOD_CAB_DOOR_MIN` in layout.ts */
export const HOOD_NET_MIN_BAND_IN = 9;

export interface HoodNetInput {
  /** height of the METAL, inches — null / non-finite means "not measured" */
  heightIn: number | null | undefined;
  /** the mouth over the counter, inches; null = the layout's 30 in default */
  aboveCounterIn: number | null | undefined;
  /** the wall-cabinet row this hood hangs in, inches */
  rowIn: number;
  /** row underside over the counter; omitted preserves the legacy 18-inch clearance */
  clearanceIn?: number;
  /** how much of that row the cabinet on the hood would fill, inches */
  bandIn: number;
  /** what the spec / the style says today */
  current: CabinetAbove;
}

export interface HoodNetResult {
  cabinetAbove: Exclude<CabinetAbove, 'none'>;
  /** true → the metal is an insert; the geometry should hang off the uppers */
  slim: boolean;
  /** the numbers the rule fired on, for the note */
  ratio: number;
  openingIn: number;
  bandIn: number;
}

/** The rule above, in numbers. `null` = leave the hood exactly as it is. */
export function hoodCabinetNet(i: HoodNetInput): HoodNetResult | null {
  if (i.current !== 'none') return null;
  const h = i.heightIn;
  if (typeof h !== 'number' || !Number.isFinite(h) || h <= 0) return null;
  if (!Number.isFinite(i.rowIn) || !Number.isFinite(i.bandIn)) return null;
  if (i.bandIn < HOOD_NET_MIN_BAND_IN) return null;
  // the opening the hood hangs in: the row, plus the clear wall the
  // layout keeps under it, less the mouth the hood was hung at
  const clearance = typeof i.clearanceIn === 'number' && Number.isFinite(i.clearanceIn) ? i.clearanceIn : 18;
  const openingIn = i.rowIn + clearance - (typeof i.aboveCounterIn === 'number' && Number.isFinite(i.aboveCounterIn) ? i.aboveCounterIn : 30);
  if (openingIn <= 0) return null;
  const ratio = h / openingIn;
  if (ratio > HOOD_NET_MAX_RATIO) return null;
  return {
    cabinetAbove: i.bandIn >= HOOD_NET_MIN_BAND_IN ? 'doors' : 'panel',
    slim: h <= HOOD_NET_SLIM_IN || ratio <= HOOD_NET_SLIM_RATIO,
    ratio, openingIn, bandIn: i.bandIn,
  };
}
