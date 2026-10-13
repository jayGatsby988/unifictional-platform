/**
 * Estimator — derives quantities from a RoomSpec, prices them against the
 * current material selections and the price book, and returns a full
 * line-item estimate. Pure + synchronous so it can run on every UI change.
 *
 * Two modes. 'full' prices a complete pull-and-replace of the twin on screen —
 * what this file has always done. 'changes' prices only what differs from the
 * room as found (`project.baseline`), which is why a freshly analysed kitchen
 * opens at $0 instead of quoting a remodel nobody asked for. The room pricing
 * runs twice, current and baseline, and the two are reconciled by line id.
 */
import type {
  BathroomSpec, Estimate, EstimateLine, EstimateSettings, EstimateTotals, ExteriorSpec, FloorPlanSpec, KitchenSpec,
  PlanRoom, ProjectBaseline, RoomSpec, Tier, SingleRoomSpec,
} from '@/lib/spec/types';
import { scanReplacementSlots } from './scan-finish-intent';
import { scannedRoomQuantities } from '@/lib/native/scan-geometry';
import { scannedWorkScope } from './scan-scope';
import { validScanTakeoffs, scanEditIsIdentity, scanObjectEdit, scanObjectIsHidden, scanObjectSizeChanged, validScanWorkAllowances } from '@/lib/native/scan-design';
import { computeKitchenLayout } from '@/components/scene/kitchen/layout';
import { planPolygonArea, stairRiseFt } from '@/lib/spec/floorplan';
import { CATALOG_BY_ID, DEFAULT_SELECTIONS, type MaterialDef, type PriceGroup } from '@/lib/materials/catalog';
import { backsplashHeightFt } from '@/lib/spec/backsplash';
import { hoodCabinetBandIn, resolveCabinetAbove, resolveHoodStyle, rowHeightIn, runForHood } from '@/lib/spec/hood';
import { hasUppers2 } from '@/lib/spec/uppers';
import { ALLOWANCES, PRICE_BOOK, REGION_BY_ID, WASTE_PCT, WINDOW_TREATMENT, type AllowanceKey, type Region, type UnitPrice } from './pricebook';

type Sel = Record<string, string>;

/** The five numbers a line carries; what `reprice` hands back for a delta. */
type LineAmounts = Pick<EstimateLine, 'qty' | 'materialLow' | 'materialHigh' | 'laborLow' | 'laborHigh'>;

/**
 * What the scoping pass needs to know about a line that the line itself does
 * not say: which *thing* it prices (`variant` — two lines with the same id but
 * different variants are a swap, not a quantity change), what drives its size
 * (`basis` — usually the quantity, but the appliance package's driver is its
 * count adjustment), and how to price a fraction of it (`reprice`). The
 * closure captures locals only, so it stays pure.
 */
interface LineMeta {
  variant?: string;
  basis?: number;
  /** the unrounded quantity behind `basis`, for scaling a delta */
  raw?: number;
  reprice?: (qty: number) => LineAmounts;
}

interface Ctx {
  settings: EstimateSettings;
  mult: number;       // material multiplier
  laborMult: number;  // labor multiplier
  lines: EstimateLine[];
  quantities: Record<string, number>;
  meta: Map<string, LineMeta>;
}

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
const midOf = (lo: number, hi: number) => (lo + hi) / 2;

function unitPrice(group: PriceGroup, tier: Tier): UnitPrice {
  return PRICE_BOOK[group][tier];
}

function pushLine(ctx: Ctx, l: Omit<EstimateLine, 'totalLow' | 'totalHigh' | 'scope' | 'baselineQty' | 'fullTotalLow' | 'fullTotalHigh'>, meta?: LineMeta) {
  if (l.qty <= 0) return;
  const totalLow = r0(l.materialLow + l.laborLow);
  const totalHigh = r0(l.materialHigh + l.laborHigh);
  const line: EstimateLine = {
    ...l,
    materialLow: r0(l.materialLow), materialHigh: r0(l.materialHigh), laborLow: r0(l.laborLow), laborHigh: r0(l.laborHigh),
    totalLow, totalHigh,
    // a room line is born fully in scope; `scopeLines` re-tags it against the
    // baseline. Full mode never re-tags, which is why full mode is byte-for-byte
    // what this estimator produced before changes mode existed.
    scope: 'changed', baselineQty: null, fullTotalLow: totalLow, fullTotalHigh: totalHigh,
  };
  ctx.lines.push(line);
  ctx.meta.set(l.id, meta ?? { basis: l.qty, raw: l.qty });
}

/** Price a quantity using the material's group/tier/priceAdj. */
function priced(ctx: Ctx, opts: {
  id: string; category: string; label: string; qty: number; slot?: string; mat?: MaterialDef; group?: PriceGroup; tier?: Tier; note?: string; unitOverride?: UnitPrice['unit']; adj?: number; laborAdj?: number; matAdj?: boolean; variant?: string; basis?: number;
}) {
  const mat = opts.mat;
  const group = opts.group ?? mat?.group;
  const tier = opts.tier ?? mat?.tier ?? ctx.settings.tier;
  if (!group) return;
  const p = unitPrice(group, tier);
  // A material's priceAdj is its own multiplier and belongs on every line that
  // prices that material — swapping marble slab for zellige has to move the
  // number or "swap a material, watch the estimate move" is a lie. Only a
  // caller that has already priced the finish another way opts out with
  // `matAdj: false`; the faucet is the one such line.
  const adj = (opts.adj ?? 1) * (opts.matAdj === false ? 1 : (mat?.priceAdj ?? 1));
  const ladj = opts.laborAdj ?? 1;
  const q = opts.qty;
  const waste = WASTE_PCT[group] ?? 0;
  const amounts = (n: number): LineAmounts => ({
    qty: r1(n),
    materialLow: p.material.low * n * (1 + waste) * adj * ctx.mult,
    materialHigh: p.material.high * n * (1 + waste) * adj * ctx.mult,
    laborLow: p.labor.low * n * ladj * ctx.laborMult,
    laborHigh: p.labor.high * n * ladj * ctx.laborMult,
  });
  pushLine(ctx, {
    id: opts.id, category: opts.category, label: opts.label + (mat ? ` · ${mat.name}` : ''),
    unit: opts.unitOverride ?? p.unit, slot: opts.slot, note: opts.note ?? (waste ? `+${Math.round(waste * 100)}% ordering waste on material` : undefined),
    ...amounts(q),
  }, {
    variant: opts.variant ?? mat?.id ?? group,
    basis: opts.basis ?? q,
    raw: q,
    reprice: (n) => {
      const a = amounts(n);
      return { qty: a.qty, materialLow: r0(a.materialLow), materialHigh: r0(a.materialHigh), laborLow: r0(a.laborLow), laborHigh: r0(a.laborHigh) };
    },
  });
}

export type AllowanceFactors = Record<AllowanceKey, number>;
const FULL_FACTORS: AllowanceFactors = { demo: 1, electrical: 1, plumbing: 1, drywall: 1, design: 1, permits: 1 };

/**
 * The lump-sum trades. In changes mode each one is scaled by how much of the
 * room the change actually opens up (with a floor, because a plumber still
 * shows up for one faucet) and dropped entirely when its trade is untouched.
 * Full mode passes 1 for every key, so the lines are the legacy ones.
 */
function allowanceLines(ctx: Ctx, roomType: RoomSpec['roomType'], factors: AllowanceFactors) {
  // a persisted or shared settings object can carry a scope word this build
  // does not know; an unknown one must price like the middle option, not throw
  // and take the whole estimate panel down with it
  const scope = ALLOWANCES[roomType][ctx.settings.scope] ? ctx.settings.scope : 'pull-and-replace';
  const a = ALLOWANCES[roomType][scope];
  const items: Array<[AllowanceKey, string, string]> = [
    ['demo', 'Demolition & disposal', 'Site Work'],
    ['electrical', 'Electrical (outlets, circuits, lighting rough-in)', 'MEP'],
    ['plumbing', 'Plumbing (rough-in, supply, drain)', 'MEP'],
    ['drywall', 'Drywall patch & paint prep', 'Site Work'],
    ['design', 'Design, drawings & PM', 'Soft Costs'],
  ];
  if (ctx.settings.includePermits) items.push(['permits', 'Permits & inspections', 'Soft Costs']);
  for (const [k, label, category] of items) {
    const [lo, hi] = a[k];
    if (hi <= 0) continue;
    const f = factors[k];
    if (f <= 0) continue;
    const laborLow = r0(lo * ctx.laborMult * f);
    const laborHigh = r0(hi * ctx.laborMult * f);
    ctx.lines.push({
      id: `allow-${k}`, category, label, qty: 1, unit: 'ls',
      materialLow: 0, materialHigh: 0, laborLow, laborHigh, totalLow: laborLow, totalHigh: laborHigh,
      scope: 'changed', baselineQty: null,
      fullTotalLow: r0(lo * ctx.laborMult), fullTotalHigh: r0(hi * ctx.laborMult),
      ...(f < 1 ? { reason: `${Math.round(f * 100)}% of the ${scope.replace(/-/g, ' ')} allowance` } : {}),
    });
  }
}

/**
 * Runtime-registered (photo-matched) materials live in the same map, so they
 * price like any other. A selection that does not resolve (a custom id from
 * an older spec whose definition was never rebuilt) falls back to the room's
 * default for that slot rather than silently dropping the line — a missing
 * countertop line is a worse bid than a default-priced one.
 */
const M = (spec: RoomSpec, sel: Sel, slot: string): MaterialDef | undefined =>
  CATALOG_BY_ID[sel[slot]] ?? CATALOG_BY_ID[DEFAULT_SELECTIONS[spec.roomType]?.[slot]];

/**
 * The décor the analyzer found that a contractor actually builds: open
 * shelving (boards, brackets, blocking) and window treatments. Rugs, plants
 * and art are furnishings the client brings — they are drawn in the twin so
 * it reads as their room, but they never appear on the bid.
 */
function decorLines(spec: KitchenSpec | BathroomSpec, sel: Sel, ctx: Ctx) {
  const decor = spec.decor;
  if (!decor) return;
  const shelves = decor.shelves ?? [];
  const floating = shelves.filter((sh) => !sh.enclosure);
  const boards = floating.reduce((s, sh) => s + sh.count, 0);
  const shelfLF = floating.reduce((s, sh) => s + (sh.widthIn / 12) * sh.count, 0);
  ctx.quantities.shelfLF = shelfLF;
  // a floating board is roughly a third of a base cabinet per linear foot
  priced(ctx, { id: 'open-shelves', category: spec.roomType === 'kitchen' ? 'Cabinetry' : 'Vanity', label: `Open shelving (${boards} board${boards === 1 ? '' : 's'})`, qty: shelfLF, group: 'cabinet-wood', tier: 'standard', adj: 0.35, laborAdj: 0.5, note: 'floating boards, brackets and blocking' });

  // The book has no custom display-case rate. Extend the existing floating
  // shelf allowance by actual panel area: 1 sqft is 1 lf of a 12"-deep panel.
  // At nominal 3/4" thickness use the existing 35% cabinet material / 50%
  // cabinet labor factors. Material scales with panel volume; installation
  // scales with area. Matched slab surfaces use the book's existing sqft rate.
  // This is an explicit allowance, not a fabricated vendor or millwork quote.
  const finite = (value: unknown, fallback: number, min: number, max: number) => Math.max(min, Math.min(max, typeof value === 'number' && Number.isFinite(value) ? value : fallback));
  shelves.forEach((sh, index) => {
    const enc = sh.enclosure;
    if (!enc) return;
    const w = finite(sh.widthIn, 24, spec.roomType === 'kitchen' ? 12 : 8, spec.roomType === 'kitchen' ? 120 : 96) / 12;
    const d = finite(sh.depthIn, 12, spec.roomType === 'kitchen' ? 6 : 4, 16) / 12;
    const h = finite(enc.heightIn, 48, 12, 120) / 12;
    const tIn = finite(enc.panelThicknessIn, 0.75, 0.25, 2), t = tIn / 12;
    const n = Math.round(finite(sh.count, 1, 1, 5));
    const back = enc.backPanel === true;
    const innerWidth = Math.max(0, w - 2 * t), innerDepth = Math.max(0, d - (back ? t : 0));
    const boardArea = n * innerWidth * innerDepth;
    const capArea = innerWidth * innerDepth;
    const sideArea = 2 * h * d;
    const backArea = back ? innerWidth * h : 0;
    const area = boardArea + capArea + sideArea + backArea;
    const thicknessFactor = tIn / 0.75;
    const addQuantity = (key: string, value: number) => { ctx.quantities[key] = (ctx.quantities[key] ?? 0) + value; };
    addQuantity('shelfCaseCount', 1);
    addQuantity('shelfCaseBoards', n);
    addQuantity('shelfCaseBoardSqft', boardArea);
    addQuantity('shelfCaseCapSqft', capArea);
    addQuantity('shelfCaseSideSqft', sideArea);
    addQuantity('shelfCaseBackSqft', backArea);
    addQuantity('shelfCasePanelSqft', area);
    addQuantity('shelfCasePanelCuft', area * t);

    const slot = sh.material === 'match-cabinets' ? (spec.roomType === 'kitchen' ? 'cabinets_upper' : 'vanity_cabinet')
      : sh.material === 'match-countertop' ? (spec.roomType === 'kitchen' ? 'countertop' : 'vanity_top') : undefined;
    const mat = slot ? M(spec, sel, slot) : undefined;
    const group: PriceGroup = sh.material === 'match-countertop' ? 'countertop'
      : sh.material === 'match-cabinets' ? (mat?.group === 'cabinet-wood' ? 'cabinet-wood' : 'cabinet-paint')
        : sh.material === 'wood' ? 'cabinet-wood' : 'cabinet-paint';
    const tier = mat?.tier ?? 'standard';
    const color = !slot && typeof sh.finishColorHex === 'string' && /^#[0-9a-f]{6}$/i.test(sh.finishColorHex) ? sh.finishColorHex.toLowerCase() : null;
    const finish = `${sh.material}:${mat?.id ?? ''}:${color ?? 'default'}`;
    const colorLabel = color ? ` · ${color}` : '';
    const id = `open-shelf-case-${index}`;
    const category = spec.roomType === 'kitchen' ? 'Cabinetry' : 'Vanity';
    const nominal = `Allowance from declared panel dimensions at ${tIn}″ thickness; not a supplier quote.`;
    priced(ctx, {
      id: `${id}-panels`, category, label: `Display case ${index + 1} panels (${n} board${n === 1 ? '' : 's'} + cap, 2 sides${back ? ', back' : ''})${colorLabel}`,
      qty: area, unitOverride: 'sqft', slot, mat, group, tier,
      adj: (group === 'countertop' ? 1 : 0.35) * thicknessFactor, laborAdj: 0,
      variant: `case-panels:${finish}`, basis: area * thicknessFactor,
      note: `${nominal} ${group === 'countertop' ? 'Selected countertop material rate per sqft' : '1 sqft = 1 lf of 12″-deep panel; 35% of the cabinet material rate'}, scaled by thickness ÷ ¾″. Includes base/interior boards, cap, sides${back ? ' and back' : '; no back'}; no doors.`,
    });
    const rotation = enc.rotationDeg === -90 || enc.rotationDeg === 90 || enc.rotationDeg === 180 ? enc.rotationDeg : 0;
    // A turn or move changes mounting work, not the quantity of bought panels.
    // Capture join/finish changes here too so an equal-area rebuild is not $0.
    const assembly = [w, d, h, tIn, n, back, sh.wall, sh.t, sh.bottomFt, rotation];
    priced(ctx, {
      id: `${id}-install`, category, label: `Display case ${index + 1} assembly & mounting${colorLabel}`,
      qty: area, unitOverride: 'sqft', slot, mat, group, tier, adj: 0,
      laborAdj: group === 'countertop' ? 1 : 0.5,
      variant: `case-install:${finish}:${JSON.stringify(assembly)}`,
      note: `${nominal} ${group === 'countertop' ? 'Selected countertop labor rate' : '50% of the cabinet labor rate per equivalent 12″-deep panel foot'} used as an assembly/remount allowance; orientation does not buy replacement panels.`,
    });
  });

  const windows = spec.openings.filter((o) => o.kind === 'window').length;
  const wt = decor.windowTreatment ?? 'none';
  if (wt !== 'none' && windows) {
    const p = WINDOW_TREATMENT[wt];
    pushLine(ctx, {
      id: 'window-treatment', category: 'Finishes', label: `Window treatment · ${wt.replace(/-/g, ' ')} (${windows})`, qty: windows, unit: 'each',
      materialLow: p.material.low * windows * ctx.mult, materialHigh: p.material.high * windows * ctx.mult,
      laborLow: p.labor.low * windows * ctx.laborMult, laborHigh: p.labor.high * windows * ctx.laborMult,
    }, { variant: `wt:${wt}`, basis: windows, raw: windows });
  }
}

// ---------------------------------------------------------------------------
// Kitchen
// ---------------------------------------------------------------------------
function kitchen(spec: KitchenSpec, sel: Sel, ctx: Ctx) {
  const q = ctx.quantities;
  // corners: perpendicular runs both include the corner box — count it once (subtract 2' per extra corner run)
  const cornerRuns = Math.max(0, spec.runs.filter((r) => r.base.some((b) => b.type === 'corner')).length - 1);
  const baseLF = Math.max(0, spec.runs.reduce((s, run) => s + run.base.filter((b) => b.type !== 'appliance-gap').reduce((t, b) => t + b.widthIn, 0) / 12, 0) - cornerRuns * 2);
  // "above the vent, there are always cabinets" — a cabinet on the canopy is
  // real wall cabinetry and gets paid for. Its share of the hood's slot is the
  // fraction of the row's height it fills; a bare hood slot is still not
  // cabinetry. Derived from spec numbers, so it can differ from the drawn box
  // by an inch or two — fine for a bid, never presented as the drawn number.
  const hood = spec.appliances.find((a) => a.kind === 'hood') ?? null;
  const hoodRun = hood ? runForHood(spec, hood) : null;
  const hoodCab = hood && hoodRun ? resolveCabinetAbove(hood, true) : 'none';
  const hoodBandIn = hood && hoodRun && hoodCab !== 'none' ? hoodCabinetBandIn(spec, hoodRun, hood) : 0;
  const upperLF = spec.runs.reduce((s, run) => {
    if (!run.hasUppers || !run.uppers) return s;
    const frac = run === hoodRun && hoodBandIn >= 4 ? Math.min(1, hoodBandIn / rowHeightIn(spec, run)) : 0;
    return s + run.uppers.reduce((t, u) => t + (u.type === 'appliance-gap' ? 0 : u.type === 'hood-gap' ? u.widthIn * frac : u.widthIn), 0) / 12;
  }, 0);
  // THE SECOND TIER is its own quantity, on purpose. `upperLF` is purely
  // linear, so folding the transom into it would double `cab-crown` (there is
  // one crown, on top of tier 2), double `undercab` (the strip is under tier 1
  // only) and subtract the wall twice. A stacked run is more cabinetry at the
  // same linear feet, so it gets its own line at the same unit rate.
  const upperStackLF = spec.runs.reduce((s, run) => {
    if (!run.hasUppers || !run.uppers || !hasUppers2(run)) return s;
    return s + (run.uppers2 ?? []).reduce((t, u) => t + (u.type === 'appliance-gap' || u.type === 'hood-gap' ? 0 : u.widthIn), 0) / 12;
  }, 0);
  const tallLF = spec.runs.reduce((s, run) => s + run.tall.reduce((t, c) => t + c.widthIn, 0) / 12, 0);
  const islandLF = spec.island.present ? spec.island.lengthFt * (spec.island.widthFt > 3.2 ? 1.6 : 1) : 0;
  // 2.15 ft is the legacy counter depth (a 24" box plus its nosing and scribe).
  // The overhang slider moves the drawn front edge, so it moves the slab with it;
  // written as a delta off 2.15 so the default overhang prices exactly as before.
  const counterDepthFt = 2.15 + ((spec.countertop.overhangIn ?? 1.5) - 1.5) / 12;
  const counterSqft = baseLF * counterDepthFt - cornerRuns * 4.4;
  const islandTopSqft = spec.island.present ? (spec.island.lengthFt + spec.island.overhangIn / 12) * spec.island.widthFt * (spec.island.waterfall ? 1.35 : 1) : 0;
  // A measured splash height beats the 3-value category, the same way layout.ts
  // draws it (layout.ts:1558) — otherwise the LayoutPanel slider grows the drawn
  // field and the bid keeps quoting the old word.
  const bsHeight = backsplashHeightFt(spec.backsplash);
  const bsLF = spec.runs.reduce((s, run) => s + run.lengthFt, 0);
  const windowsOnRuns = spec.openings.filter((o) => o.kind === 'window').reduce((s, o) => s + o.widthFt * Math.min(o.heightFt, bsHeight), 0);
  // the wall behind a chimney canopy is not tiled: the splash stops at the hood
  // mouth. Keyed on the RESOLVED style so a hood whose style the photo could not
  // read (null -> chimney, and drawn as a tapered canopy) deducts like the canopy
  // it is drawn as. Deliberately chimney-only: widening it to custom-insert
  // moved a full-remodel total that contract §5 pins, and the drawn splash
  // behind a custom canopy only drops when a cabinet sits on it — see the
  // hoodTop rule in layout.ts. That agreement is a separate, disclosed change.
  const hoodGap = spec.appliances
    .filter((a) => a.kind === 'hood' && resolveHoodStyle(a) === 'chimney')
    .reduce((s, a) => s + (a.widthIn / 12) * Math.max(0, bsHeight - 1.5), 0);
  const backsplashSqft = spec.backsplash.present ? Math.max(0, bsLF * bsHeight - windowsOnRuns - hoodGap) : 0;
  const captured = spec.scanGeometry ? scannedRoomQuantities(spec.scanGeometry) : null;
  const floorSqft = captured ? (captured.floorAreaSquareMeters ?? 0) / 0.09290304 : spec.dims.widthFt * spec.dims.depthFt;
  const perimeter = captured ? captured.perimeterMeters / 0.3048 : 2 * (spec.dims.widthFt + spec.dims.depthFt);
  const openingsArea = captured ? captured.openingAreaSquareMeters / 0.09290304 : spec.openings.reduce((s, o) => s + o.widthFt * o.heightFt, 0);
  // Each run's wall cabinets hide THEIR OWN row height, not the room default:
  // the client's back run is declared 54" in a kitchen whose default is 48", so
  // the room was quoted 0.5 ft² of paint per foot of cabinet that does not
  // exist. Both tiers live inside that one row height, which is why the stack
  // is not subtracted again.
  const upperCoveredSqft = spec.runs.reduce((s, run) => {
    if (!run.hasUppers || !run.uppers) return s;
    const lf = run.uppers.reduce((t, u) => t + (u.type === 'appliance-gap' || u.type === 'hood-gap' ? 0 : u.widthIn), 0) / 12;
    return s + lf * rowHeightIn(spec, run) / 12;
  }, 0);
  const wallSqft = Math.max(0, (captured ? captured.wallAreaSquareMeters / 0.09290304 : perimeter * spec.dims.ceilingFt) - openingsArea - backsplashSqft - upperCoveredSqft - baseLF * spec.cabinets.baseHeightIn / 12);
  const ceilingSqft = floorSqft;
  const hardwareCount = spec.runs.reduce((s, run) => s + run.base.reduce((t, b) => t + (b.type === 'appliance-gap' ? 0 : b.type === 'drawers' ? (b.drawerCount ?? 3) : 1 + (b.drawerCount ?? 0)), 0)
    + (run.uppers?.filter((u) => u.type === 'door' || u.type === 'glass').length ?? 0)
    // …and one pull per transom door: the photo's second tier has its own row of them
    + (hasUppers2(run) ? (run.uppers2 ?? []).filter((u) => u.type === 'door' || u.type === 'glass').length : 0), 0) + (spec.island.present ? Math.round(islandLF * 1.5) : 0)
    // pulls for the cabinet on the hood: one door under 27", two over
    + (hood && hoodRun && (hoodCab === 'doors' || hoodCab === 'glass') && hoodBandIn >= 9 ? (hood.widthIn > 26 ? 2 : 1) : 0);
  const pendantCount = spec.lighting.pendants?.count ?? 0;

  Object.assign(q, { baseLF, upperLF, upperStackLF, tallLF, islandLF, counterSqft, islandTopSqft, backsplashSqft, floorSqft, wallSqft, ceilingSqft, hardwareCount, pendantCount, recessed: spec.lighting.recessedCount, hoodBandIn });

  const cabBase = M(spec, sel, 'cabinets_base'), cabUpper = M(spec, sel, 'cabinets_upper'), cabIsland = M(spec, sel, 'island_cabinets');
  // tall units follow the base cabinets when nothing was chosen for them (a
  // project from before the slot existed) — not the static room default,
  // which would price a white pantry into a navy kitchen
  const cabTall = CATALOG_BY_ID[sel.cabinets_tall] ?? cabBase;
  priced(ctx, { id: 'cab-base', category: 'Cabinetry', label: `Base cabinets (${spec.cabinets.doorStyle})`, qty: baseLF, slot: 'cabinets_base', mat: cabBase, adj: spec.cabinets.doorStyle === 'raised' || spec.cabinets.doorStyle === 'beaded' ? 1.12 : 1 });
  priced(ctx, { id: 'cab-upper', category: 'Cabinetry', label: `Upper cabinets${spec.runs.some((r) => r.uppersToCeiling) ? ' (to ceiling)' : ''}`, qty: upperLF, slot: 'cabinets_upper', mat: cabUpper, adj: (spec.runs.some((r) => r.uppersToCeiling) ? 1.15 : 0.85) });
  if (upperStackLF > 0) {
    priced(ctx, { id: 'cab-upper-stack', category: 'Cabinetry', label: 'Stacked upper cabinets (transom row)', qty: upperStackLF, slot: 'cabinets_upper', mat: cabUpper, adj: (spec.runs.some((r) => r.uppersToCeiling) ? 1.15 : 0.85) });
  }
  priced(ctx, { id: 'cab-tall', category: 'Cabinetry', label: 'Tall pantry / oven towers', qty: tallLF, slot: 'cabinets_tall', mat: cabTall, adj: 2.1 });
  priced(ctx, { id: 'cab-island', category: 'Cabinetry', label: `Island cabinetry${spec.island.seating ? ` · ${spec.island.seating} seats` : ''}`, qty: islandLF, slot: 'island_cabinets', mat: cabIsland });
  if (spec.cabinets.crown) pushLine(ctx, { id: 'cab-crown', category: 'Cabinetry', label: 'Crown moulding & fillers', qty: Math.round(upperLF), unit: 'lf', materialLow: 8 * upperLF * ctx.mult, materialHigh: 18 * upperLF * ctx.mult, laborLow: 6 * upperLF * ctx.laborMult, laborHigh: 12 * upperLF * ctx.laborMult }, { variant: 'crown', basis: upperLF, raw: Math.round(upperLF) });

  priced(ctx, { id: 'counter', category: 'Surfaces', label: 'Countertops (perimeter)', qty: counterSqft, slot: 'countertop', mat: M(spec, sel, 'countertop'), adj: spec.countertop.edge === 'mitered' || spec.countertop.edge === 'ogee' ? 1.15 : 1 });
  priced(ctx, { id: 'island-top', category: 'Surfaces', label: `Island top${spec.island.waterfall ? ' · waterfall' : ''}`, qty: islandTopSqft, slot: 'island_countertop', mat: M(spec, sel, 'island_countertop') });
  priced(ctx, { id: 'backsplash', category: 'Surfaces', label: `Backsplash (${spec.backsplash.height.replace('-', ' ')})`, qty: backsplashSqft, slot: 'backsplash', mat: M(spec, sel, 'backsplash'), adj: spec.backsplash.pattern === 'herringbone' ? 1.2 : 1, laborAdj: spec.backsplash.pattern === 'herringbone' || spec.backsplash.pattern === 'mosaic' ? 1.3 : 1 });
  priced(ctx, { id: 'floor', category: 'Surfaces', label: 'Flooring', qty: floorSqft, slot: 'flooring', mat: M(spec, sel, 'flooring') });
  priced(ctx, { id: 'walls', category: 'Surfaces', label: 'Walls', qty: wallSqft, slot: 'walls', mat: M(spec, sel, 'walls') });
  priced(ctx, { id: 'ceiling', category: 'Surfaces', label: 'Ceiling', qty: ceilingSqft, slot: 'ceiling', mat: M(spec, sel, 'ceiling') });

  priced(ctx, { id: 'hardware', category: 'Finishes', label: `Cabinet hardware (${hardwareCount} pcs)`, qty: hardwareCount, slot: 'hardware', mat: M(spec, sel, 'hardware') });
  // the finish's own per-pull priceAdj is not a faucet multiplier — this line
  // already prices the finish against `fixture-finish` and carries the sink's
  // own adj, and compounding the two inflated the faucet by half again
  priced(ctx, { id: 'faucet', category: 'Finishes', label: 'Kitchen faucet & sink', qty: computeKitchenLayout(spec).sink ? 1 + (spec.island.present && spec.island.hasSink ? 1 : 0) : 0, slot: 'faucet', mat: M(spec, sel, 'faucet'), group: 'fixture-finish', matAdj: false, adj: spec.sink.kind === 'farmhouse' ? 2.2 : 1.6 });
  // the package's driver is how many pieces it contains, not the qty of 1
  const keepAppliances = ctx.settings.keepExistingAppliances === true;
  priced(ctx, { id: 'appliances', category: 'Appliances', label: keepAppliances ? `Existing appliances retained (${spec.appliances.length} pcs)` : `Appliance package (${spec.appliances.length} pcs)`, qty: spec.appliances.length > 0 ? 1 : 0, slot: 'appliances', mat: M(spec, sel, 'appliances'), adj: keepAppliances ? 0 : Math.max(0.6, spec.appliances.length / 4), laborAdj: keepAppliances ? 0 : 1, basis: spec.appliances.length > 0 ? Math.max(0.6, spec.appliances.length / 4) : 0, ...(keepAppliances ? { note: 'Existing appliances stay in place. No new appliance purchase or replacement installation allowance.' } : {}) });
  priced(ctx, { id: 'pendants', category: 'Lighting', label: `Pendant lights (${pendantCount})`, qty: pendantCount, slot: 'lighting_fixture', mat: M(spec, sel, 'lighting_fixture') });
  priced(ctx, { id: 'recessed', category: 'Lighting', label: `Recessed LED cans (${spec.lighting.recessedCount})`, qty: spec.lighting.recessedCount, group: 'lighting', tier: 'budget', adj: 0.5, variant: 'recessed-can' });
  if (spec.lighting.underCabinet) pushLine(ctx, { id: 'undercab', category: 'Lighting', label: 'Under-cabinet LED strip', qty: Math.round(upperLF), unit: 'lf', materialLow: 18 * upperLF * ctx.mult, materialHigh: 35 * upperLF * ctx.mult, laborLow: 12 * upperLF * ctx.laborMult, laborHigh: 22 * upperLF * ctx.laborMult }, { variant: 'undercab', basis: upperLF, raw: Math.round(upperLF) });
  decorLines(spec, sel, ctx);
}

// ---------------------------------------------------------------------------
// Bathroom
// ---------------------------------------------------------------------------
/**
 * Labour multipliers for how the tile is LAID.
 *
 * The material is the same square foot; the setter's day is not. A running
 * bond is the base every unit price in the pricebook was written against, so
 * it and `stacked` are 1 and a spec that never states a pattern is unchanged.
 */
const TILE_PATTERN_LABOR: Record<string, number> = {
  stacked: 1, 'running-bond': 1, 'vertical-stack': 1.1, 'large-format': 1.15,
  herringbone: 1.45, chevron: 1.5, basketweave: 1.4,
  hex: 1.35, penny: 1.4, mosaic: 1.35, slab: 1.6,
};

/** What the tub is made of, against acrylic — the material the price list assumes. */
const TUB_MATERIAL_COST: Record<string, number> = {
  acrylic: 1, fiberglass: 0.8, steel: 0.95, 'solid-surface': 1.6,
  'stone-resin': 2.2, 'cast-iron': 2.0, copper: 3.5, wood: 3.0,
};

/** Tub filler, as [materialLow, materialHigh, laborLow, laborHigh]. */
const TUB_FILLER_COST: Record<string, [number, number, number, number]> = {
  'floor-mount': [800, 2500, 350, 900],
  'wall-mount': [180, 700, 150, 400],
  'deck-mount': [250, 900, 180, 450],
  roman: [400, 1400, 220, 550],
  'tub-shower-diverter': [150, 500, 140, 380],
  none: [0, 0, 0, 0],
};

/** How the basin meets the top, against an undermount. */
const BASIN_COST: Record<string, number> = {
  undermount: 1, 'drop-in': 0.85, 'semi-recessed': 1.2, vessel: 1.5, integrated: 1.8,
};

function bathroom(spec: BathroomSpec, sel: Sel, ctx: Ctx) {
  const q = ctx.quantities;
  const captured = spec.scanGeometry ? scannedRoomQuantities(spec.scanGeometry) : null;
  const floorSqft = captured ? (captured.floorAreaSquareMeters ?? 0) / 0.09290304 : spec.dims.widthFt * spec.dims.depthFt;
  const perimeter = captured ? captured.perimeterMeters / 0.3048 : 2 * (spec.dims.widthFt + spec.dims.depthFt);
  const vanityLF = spec.vanity.present ? spec.vanity.widthIn / 12 : 0;
  // a full-height splash is a second run of slab up the wall; a 4" upstand is
  // already inside the 1.85 factor, which is why only 'full-height' adds area
  const splashSqft = spec.vanity.present && spec.vanity.backsplash === 'full-height' ? vanityLF * 1.6 : 0;
  const vanityTopSqft = vanityLF * 1.85 + splashSqft;
  const showerWallSqft = spec.shower.present ? ((spec.shower.widthIn + 2 * spec.shower.depthIn) / 12) * Math.min(spec.dims.ceilingFt, 8) : 0;
  const showerFloorSqft = spec.shower.present ? (spec.shower.widthIn * spec.shower.depthIn) / 144 : 0;
  const tubSurroundSqft = spec.tub.present && spec.tub.kind === 'alcove' && spec.shower.enclosure === 'tub-shower' ? (spec.tub.lengthIn / 12 + 5) * 6 : 0;
  // A measured stop line overrides the category's own, the same way it does in
  // the scene: 60" of tile is 60" of tile whatever word the category uses.
  const tileStopFt = spec.wallTile.heightIn == null ? null : spec.wallTile.heightIn / 12;
  let wallTileSqft = 0;
  switch (spec.wallTile.height) {
    case 'wainscot': wallTileSqft = perimeter * (tileStopFt ?? 3.5); break;
    case 'full': wallTileSqft = perimeter * (tileStopFt ?? spec.dims.ceilingFt) * 0.8; break;
    case 'accent-wall': wallTileSqft = spec.dims.widthFt * (tileStopFt ?? spec.dims.ceilingFt); break;
    default: wallTileSqft = 0;
  }
  wallTileSqft += tubSurroundSqft;
  const openingsArea = captured ? captured.openingAreaSquareMeters / 0.09290304 : spec.openings.reduce((s, o) => s + o.widthFt * o.heightFt, 0);
  const wallPaintSqft = Math.max(0, (captured ? captured.wallAreaSquareMeters / 0.09290304 : perimeter * spec.dims.ceilingFt) - openingsArea - wallTileSqft - showerWallSqft * 0.5);
  const fixtureCount = (spec.vanity.present ? spec.vanity.sinks : 0) + (spec.shower.present ? 1 : 0) + (spec.tub.present ? 1 : 0);
  Object.assign(q, { floorSqft, vanityLF, vanityTopSqft, showerWallSqft, showerFloorSqft, wallTileSqft, wallPaintSqft, fixtureCount, ceilingSqft: floorSqft });

  priced(ctx, { id: 'vanity', category: 'Vanity', label: `Vanity cabinet (${spec.vanity.widthIn}" · ${spec.vanity.style})`, qty: vanityLF, slot: 'vanity_cabinet', mat: M(spec, sel, 'vanity_cabinet'), adj: spec.vanity.style === 'floating' ? 1.15 : 1 });
  // a thick top is a mitred build-up, not just more stone: every inch past the
  // stock 1 1/4" is another lamination the fabricator charges for
  const thickAdj = 1 + Math.max(0, (spec.vanity.counterThicknessIn ?? 1.25) - 1.25) * 0.12;
  priced(ctx, { id: 'vanity-top', category: 'Vanity', label: `Vanity top · ${spec.vanity.sinks} sink${spec.vanity.sinks > 1 ? 's' : ''}${splashSqft ? ' + full-height splash' : ''}`, qty: vanityTopSqft, slot: 'vanity_top', mat: M(spec, sel, 'vanity_top'), adj: 1.2 * thickAdj });
  const basin = spec.vanity.basin ?? 'undermount';
  priced(ctx, { id: 'sinks', category: 'Vanity', label: `${basin.charAt(0).toUpperCase()}${basin.slice(1).replace('-', ' ')} sinks (${spec.vanity.sinks})`, qty: spec.vanity.present ? spec.vanity.sinks : 0, group: 'fixture-finish', tier: 'standard', adj: 0.8 * (BASIN_COST[basin] ?? 1), variant: `basin:${basin}` });
  priced(ctx, { id: 'mirror', category: 'Vanity', label: 'Mirror', qty: spec.vanity.present ? (spec.vanity.mirror === 'double' ? 2 : 1) : 0, slot: 'mirror', mat: M(spec, sel, 'mirror'), adj: spec.vanity.mirror === 'full-width' ? 1.6 : 1 });
  priced(ctx, { id: 'floor-tile', category: 'Tile', label: 'Floor tile', qty: floorSqft, slot: 'floor_tile', mat: M(spec, sel, 'floor_tile'), group: M(spec, sel, 'floor_tile')?.group === 'flooring' ? 'flooring' : 'wall-tile' });
  // How it is LAID is labour, not material: a setter charges half again to run
  // a herringbone and more still to fit a slab, and the twin now draws the
  // difference — so the estimate has to carry it too.
  const fieldLabor = TILE_PATTERN_LABOR[spec.wallTile.pattern ?? 'running-bond'] ?? 1;
  const showerLabor = TILE_PATTERN_LABOR[spec.wallTile.showerPattern ?? spec.wallTile.pattern ?? 'running-bond'] ?? 1;
  const accent = spec.wallTile.accent;
  // the accent wall's area comes OUT of the field and gets billed on its own,
  // because it is a different tile laid a different way
  const accentSqft = accent
    ? (accent.wall === 'back' || accent.wall === 'front' ? spec.dims.widthFt : spec.dims.depthFt) * ((accent.heightIn ?? spec.dims.ceilingFt * 12) / 12)
    : 0;
  const fieldSqft = Math.max(0, wallTileSqft - (spec.wallTile.height === 'accent-wall' ? wallTileSqft : Math.min(wallTileSqft, accentSqft)));
  priced(ctx, { id: 'wall-tile', category: 'Tile', label: `Wall tile (${spec.wallTile.height.replace('-', ' ')})`, qty: fieldSqft, slot: 'wall_tile', mat: M(spec, sel, 'wall_tile'), group: 'wall-tile', laborAdj: fieldLabor });
  if (accent) {
    priced(ctx, { id: 'accent-tile', category: 'Tile', label: `Feature wall tile (${accent.wall}, ${accent.pattern.replace('-', ' ')})`, qty: accentSqft, slot: 'wall_tile', mat: M(spec, sel, 'wall_tile'), group: 'wall-tile', laborAdj: TILE_PATTERN_LABOR[accent.pattern] ?? 1, variant: `accent:${accent.wall}:${accent.pattern}` });
  }
  priced(ctx, { id: 'shower-wall', category: 'Tile', label: 'Shower wall tile', qty: showerWallSqft, slot: 'shower_wall_tile', mat: M(spec, sel, 'shower_wall_tile'), group: 'wall-tile', laborAdj: (spec.shower.niche ? 1.1 : 1) * showerLabor });
  priced(ctx, { id: 'shower-floor', category: 'Tile', label: 'Shower floor (mosaic)', qty: showerFloorSqft, slot: 'shower_floor_tile', mat: M(spec, sel, 'shower_floor_tile'), group: 'wall-tile', laborAdj: 1.4 });
  if (spec.shower.present) {
    const enc = spec.shower.enclosure;
    const encCost = enc === 'frameless-glass' ? [1800, 3800] : enc === 'framed-glass' ? [700, 1500] : enc === 'curtain' ? [60, 200] : [0, 0];
    // What OPENS is most of the enclosure's price. A barn door is a rail, four
    // rollers and a heavier panel; a walk-in has no door at all; and 1/2" glass
    // is half again the 3/8" the stall is drawn at. `null` on either is the
    // hinged 3/8" door the estimate has always assumed, so nothing moves.
    const door = spec.shower.doorType;
    const doorAdj = door === 'barn' ? 1.45 : door === 'sliding' ? 1.15 : door === 'pivot' ? 1.1
      : door === 'fixed-panel' ? 0.6 : door === 'walk-in' || door === 'none' ? 0.35 : 1;
    const gt = spec.shower.glassThicknessIn;
    const glassAdj = gt == null ? 1 : gt <= 0.1875 ? 0.7 : gt <= 0.28 ? 0.8 : gt <= 0.4 ? 1 : gt <= 0.52 ? 1.3 : 1.5;
    const encAdj = doorAdj * glassAdj;
    pushLine(ctx, { id: 'shower-glass', category: 'Shower', label: `Shower enclosure (${enc.replace('-', ' ')}${door ? `, ${door.replace('-', ' ')}` : ''})`, qty: 1, unit: 'each', materialLow: Math.round(encCost[0] * encAdj) * ctx.mult, materialHigh: Math.round(encCost[1] * encAdj) * ctx.mult, laborLow: Math.round(250 * (doorAdj > 1 ? doorAdj : 1)) * ctx.laborMult, laborHigh: Math.round(600 * (doorAdj > 1 ? doorAdj : 1)) * ctx.laborMult }, { variant: `glass:${enc}:${door ?? 'auto'}:${gt ?? 'auto'}`, basis: 1, raw: 1 });
    pushLine(ctx, { id: 'shower-pan', category: 'Shower', label: `Shower pan & waterproofing${spec.shower.curbless ? ' · curbless' : ''}`, qty: 1, unit: 'each', materialLow: (spec.shower.curbless ? 900 : 450) * ctx.mult, materialHigh: (spec.shower.curbless ? 1800 : 900) * ctx.mult, laborLow: (spec.shower.curbless ? 1200 : 700) * ctx.laborMult, laborHigh: (spec.shower.curbless ? 2400 : 1400) * ctx.laborMult }, { variant: `pan:${spec.shower.curbless}`, basis: 1, raw: 1 });
    if (spec.shower.niche) {
      // a niche is priced by the hole and the shelves in it, not per unit: a
      // 36×36 four-shelf niche is a different job from a 24×14 with one
      const n = spec.shower.nicheAt;
      const area = n ? (n.widthIn * n.heightIn) / (24 * 14) : 1;
      const shelves = n ? 1 + Math.max(0, n.shelves - 1) * 0.35 : 1;
      const nAdj = Math.max(0.5, area) * shelves;
      pushLine(ctx, { id: 'niche', category: 'Shower', label: n ? `Tiled shower niche (${n.widthIn}×${n.heightIn}", ${n.shelves} shelf${n.shelves === 1 ? '' : 'ves'})` : 'Tiled shower niche', qty: 1, unit: 'each', materialLow: Math.round(80 * nAdj) * ctx.mult, materialHigh: Math.round(250 * nAdj) * ctx.mult, laborLow: Math.round(250 * nAdj) * ctx.laborMult, laborHigh: Math.round(500 * nAdj) * ctx.laborMult }, { variant: `niche:${n ? `${n.widthIn}x${n.heightIn}x${n.shelves}` : 'auto'}`, basis: 1, raw: 1 });
    }
    if (spec.shower.bench) {
      // a full-width bench is twice the block and twice the stone; a floating
      // slab is cantilevered, which is its own bit of structure
      const bs = spec.shower.benchStyle;
      const bAdj = bs === 'full-width' ? 1.8 : bs === 'floating' ? 1.3 : 1;
      pushLine(ctx, { id: 'bench', category: 'Shower', label: `Built-in shower bench${bs ? ` (${bs.replace('-', ' ')})` : ''}`, qty: 1, unit: 'each', materialLow: Math.round(200 * bAdj) * ctx.mult, materialHigh: Math.round(600 * bAdj) * ctx.mult, laborLow: Math.round(400 * bAdj) * ctx.laborMult, laborHigh: Math.round(900 * bAdj) * ctx.laborMult }, { variant: `bench:${bs ?? 'auto'}`, basis: 1, raw: 1 });
    }
  }
  // What the tub is MADE OF is most of what it costs: a stone-resin soaker and
  // an acrylic one of the same length are 3× apart, and the twin now draws the
  // difference in the rim. `null` = acrylic = the price it has always been.
  priced(ctx, { id: 'tub', category: 'Fixtures', label: `Tub (${spec.tub.kind}${spec.tub.material ? `, ${spec.tub.material.replace('-', ' ')}` : ''})`, qty: spec.tub.present ? 1 : 0, slot: 'tub', mat: M(spec, sel, 'tub'), adj: TUB_MATERIAL_COST[spec.tub.material ?? 'acrylic'] ?? 1 });
  if (spec.tub.present && spec.tub.fillerType !== 'none') {
    // the filler is its own fitting and its own rough-in — a floor-mounted
    // column needs a floor penetration, a wall trim needs a valve in the wall
    const f = spec.tub.fillerType ?? (spec.tub.kind === 'freestanding' || spec.tub.kind === 'clawfoot' ? 'floor-mount' : spec.tub.kind === 'alcove' ? 'wall-mount' : 'deck-mount');
    const c = TUB_FILLER_COST[f];
    pushLine(ctx, { id: 'tub-filler', category: 'Fixtures', label: `Tub filler (${f.replace('-', ' ')})`, qty: 1, unit: 'each', materialLow: c[0] * ctx.mult, materialHigh: c[1] * ctx.mult, laborLow: c[2] * ctx.laborMult, laborHigh: c[3] * ctx.laborMult }, { variant: `filler:${f}`, basis: 1, raw: 1 });
  }
  {
    const t = spec.toilet.style;
    const cost = t === 'smart' ? [2500, 6000] : t === 'wall-hung' ? [1200, 2600] : t === 'one-piece' ? [450, 1100] : [250, 600];
    if (spec.toilet.present) pushLine(ctx, { id: 'toilet', category: 'Fixtures', label: `Toilet (${t})`, qty: 1, unit: 'each', materialLow: cost[0] * ctx.mult, materialHigh: cost[1] * ctx.mult, laborLow: (t === 'wall-hung' ? 600 : 200) * ctx.laborMult, laborHigh: (t === 'wall-hung' ? 1400 : 450) * ctx.laborMult }, { variant: `toilet:${t}`, basis: 1, raw: 1 });
  }
  // a wall-mounted tap is a valve INSIDE the wall: the plumber is opening and
  // patching, which is where the extra labour goes
  const wallTap = spec.vanity.present && spec.vanity.faucetMount === 'wall';
  priced(ctx, { id: 'fixtures', category: 'Fixtures', label: `Faucets & shower trim (${fixtureCount}${wallTap ? ', wall-mounted' : ''})`, qty: fixtureCount, slot: 'fixtures', mat: M(spec, sel, 'fixtures'), group: 'fixture-finish', adj: (spec.shower.fixtures === 'rain-plus-handheld' ? 1.4 : spec.shower.fixtures === 'body-jets' ? 2.2 : 1) * (wallTap ? 1.25 : 1), laborAdj: wallTap ? 1.6 : 1 });
  // the fittings the spec actually places, when it places more than the five
  // a bathroom is assumed to get
  const accessoryCount = Math.max(5, spec.accessories?.length ?? 0);
  priced(ctx, { id: 'hardware', category: 'Finishes', label: `Towel bars, hooks, paper holder (${accessoryCount})`, qty: accessoryCount, slot: 'hardware', mat: M(spec, sel, 'hardware'), adj: 6 });
  priced(ctx, { id: 'walls', category: 'Surfaces', label: 'Wall paint', qty: wallPaintSqft, slot: 'walls', mat: M(spec, sel, 'walls') });
  priced(ctx, { id: 'ceiling', category: 'Surfaces', label: 'Ceiling', qty: floorSqft, slot: 'ceiling', mat: M(spec, sel, 'ceiling') });
  priced(ctx, { id: 'sconces', category: 'Lighting', label: `Vanity lights / sconces (${spec.lighting.sconces})`, qty: spec.lighting.sconces, slot: 'lighting_fixture', mat: M(spec, sel, 'lighting_fixture') });
  priced(ctx, { id: 'recessed', category: 'Lighting', label: `Recessed LED cans (${spec.lighting.recessedCount})`, qty: spec.lighting.recessedCount, group: 'lighting', tier: 'budget', adj: 0.5, variant: 'recessed-can' });
  pushLine(ctx, { id: 'fan', category: 'MEP', label: 'Exhaust fan (quiet, humidity-sensing)', qty: 1, unit: 'each', materialLow: 180 * ctx.mult, materialHigh: 420 * ctx.mult, laborLow: 200 * ctx.laborMult, laborHigh: 450 * ctx.laborMult }, { variant: 'fan', basis: 1, raw: 1 });
  decorLines(spec, sel, ctx);
}

// ---------------------------------------------------------------------------
// Exterior
// ---------------------------------------------------------------------------
function exterior(spec: ExteriorSpec, sel: Sel, ctx: Ctx) {
  const q = ctx.quantities;
  /*
   * WHAT THE TWIN DRAWS IS WHAT WE PRICE.
   *
   * `house.present` is the client's statement that a house is ALREADY
   * STANDING; it is false for an empty-lot upload. `computeExteriorLayout`
   * stopped treating that as a build gate — an empty lot now gets the proposed
   * house the intake describes — but every quantity below still zeroed itself
   * when it was false, so a lot client watched a whole house appear and got a
   * quote with a $0 roof, $0 siding, $0 trim, $0 gutters, $0 porch, $0 entry
   * door and $0 garage doors in it. Nothing here may read `present` again: a
   * house that has to be BUILT costs more than a re-clad, never nothing, and
   * "is it already there?" is the baseline's question (`estimateSettings.mode`
   * = 'changes'), not this function's.
   */
  const h = spec.house;
  const fp = h.footprint;
  const wallH = h.stories * h.storyHeightFt + h.foundationExposedFt;
  let perimeter = 2 * (fp.widthFt + fp.depthFt);
  let footprintArea = fp.widthFt * fp.depthFt;
  if (h.wing?.present) { perimeter += 2 * h.wing.depthFt; footprintArea += h.wing.widthFt * h.wing.depthFt; }
  const garageArea = h.garage.present && !h.garage.attached ? h.garage.bays * 12 * 22 : 0;
  if (garageArea) perimeter += 2 * (h.garage.bays * 12 + 22);
  const windowCount = spec.elevations.reduce((s, e) => s + e.windows.length, 0);
  const windowArea = spec.elevations.reduce((s, e) => s + e.windows.reduce((t, w) => t + w.widthFt * w.heightFt, 0), 0);
  const doorArea = spec.elevations.reduce((s, e) => s + e.doors.reduce((t, d) => t + d.widthFt * d.heightFt, 0), 0);
  const gableArea = spec.elevations.filter((e) => e.gableEnd).length * (fp.depthFt * (fp.depthFt / 2 * h.roof.pitch / 12) / 2);
  const wallArea = Math.max(0, perimeter * wallH + gableArea - windowArea - doorArea);
  const primary = M(spec, sel, 'siding_primary'), accent = M(spec, sel, 'siding_accent');
  const accentFrac = accent && primary && accent.id !== primary.id ? 0.25 : 0;
  const pitchFactor = Math.sqrt(1 + Math.pow(h.roof.pitch / 12, 2));
  const porchRoof = h.porch.present && h.porch.roofed ? h.porch.widthFt * h.porch.depthFt : 0;
  const roofArea = (footprintArea + garageArea + porchRoof) * (h.roof.type === 'flat' ? 1.05 : pitchFactor) * 1.1;
  const roofSquares = roofArea / 100;
  const trimLF = spec.elevations.reduce((s, e) => s + e.windows.reduce((t, w) => t + 2 * (w.widthFt + w.heightFt), 0) + e.doors.reduce((t, d) => t + 2 * d.heightFt + d.widthFt, 0), 0) + 4 * wallH + perimeter;
  const gutterLF = perimeter * (h.roof.type === 'gable' ? 0.55 : 1.0);
  const drivewaySqft = spec.hardscape.driveway.present ? spec.hardscape.driveway.widthFt * spec.hardscape.driveway.lengthFt : 0;
  const walkwaySqft = spec.hardscape.walkway.present ? spec.hardscape.walkway.widthFt * Math.max(10, spec.lot.setbackFrontFt) : 0;
  const patioSqft = spec.hardscape.patio.present ? spec.hardscape.patio.widthFt * spec.hardscape.patio.depthFt : 0;
  const deckSqft = h.deck.present ? h.deck.widthFt * h.deck.depthFt : 0;
  const railingLF = h.deck.present && h.deck.railing ? h.deck.widthFt + 2 * h.deck.depthFt : 0;
  const lotArea = spec.lot.widthFt * spec.lot.depthFt;
  const lawnSqft = Math.max(0, lotArea - footprintArea - garageArea - drivewaySqft - walkwaySqft - patioSqft - deckSqft);
  const fenceLF = spec.lot.fence.present ? spec.lot.fence.sides.reduce((s, side) => s + (side === 'left' || side === 'right' ? spec.lot.depthFt : spec.lot.widthFt), 0) : 0;
  const garageDoors = h.garage.present ? (h.garage.bays >= 2 ? Math.ceil(h.garage.bays / 2) : h.garage.bays) : 0;
  Object.assign(q, { wallArea, roofSquares, windowCount, trimLF, gutterLF, drivewaySqft, walkwaySqft, patioSqft, deckSqft, railingLF, lawnSqft, fenceLF, garageDoors, footprintArea });

  const sidingLabel = (m?: MaterialDef) => (m?.group === 'exterior-paint' ? 'Exterior repaint' : 'Siding replacement');
  priced(ctx, { id: 'siding-primary', category: 'Envelope', label: sidingLabel(primary), qty: wallArea * (1 - accentFrac), slot: 'siding_primary', mat: primary });
  priced(ctx, { id: 'siding-accent', category: 'Envelope', label: `Accent ${sidingLabel(accent).toLowerCase()}`, qty: wallArea * accentFrac, slot: 'siding_accent', mat: accent });
  if (h.foundationExposedFt > 0) priced(ctx, { id: 'foundation', category: 'Envelope', label: 'Foundation skirt / water table', qty: perimeter * h.foundationExposedFt, slot: 'foundation', mat: M(spec, sel, 'foundation') });
  if (trimLF) pushLine(ctx, { id: 'trim', category: 'Envelope', label: `Trim, corners & fascia (${M(spec, sel, 'trim')?.name ?? 'painted'})`, qty: Math.round(trimLF), unit: 'lf', slot: 'trim', materialLow: 4 * trimLF * ctx.mult, materialHigh: 9 * trimLF * ctx.mult, laborLow: 4 * trimLF * ctx.laborMult, laborHigh: 8 * trimLF * ctx.laborMult }, { variant: `trim:${M(spec, sel, 'trim')?.id ?? 'painted'}`, basis: trimLF, raw: Math.round(trimLF) });
  // the pitch's labour adjustment lives inside the price, so a pitch change
  // re-prices through `reprice` rather than reading as a different product
  priced(ctx, { id: 'roof', category: 'Roof', label: `Roofing (${h.roof.type}, ${h.roof.pitch}/12)`, qty: roofSquares, slot: 'roof', mat: M(spec, sel, 'roof'), laborAdj: h.roof.pitch >= 9 ? 1.2 : 1 });
  priced(ctx, { id: 'gutters', category: 'Roof', label: 'Gutters & downspouts', qty: gutterLF, slot: 'gutters', mat: M(spec, sel, 'gutters') });
  priced(ctx, { id: 'windows', category: 'Openings', label: `Windows (${windowCount})`, qty: windowCount, slot: 'window_frames', mat: M(spec, sel, 'window_frames') });
  priced(ctx, { id: 'front-door', category: 'Openings', label: 'Entry door', qty: 1, slot: 'front_door', mat: M(spec, sel, 'front_door') });
  priced(ctx, { id: 'garage-door', category: 'Openings', label: `Garage door${garageDoors > 1 ? 's' : ''} (${h.garage.bays}-car)`, qty: garageDoors, slot: 'garage_door', mat: M(spec, sel, 'garage_door'), adj: h.garage.bays >= 2 ? 1.4 : 1 });
  priced(ctx, { id: 'columns', category: 'Porch', label: `Porch columns (${h.porch.columns})`, qty: h.porch.present ? h.porch.columns : 0, slot: 'porch_columns', mat: M(spec, sel, 'porch_columns') });
  if (h.porch.present) pushLine(ctx, { id: 'porch', category: 'Porch', label: `Porch deck & roof (${h.porch.widthFt}×${h.porch.depthFt})`, qty: Math.round(h.porch.widthFt * h.porch.depthFt), unit: 'sqft', materialLow: 28 * h.porch.widthFt * h.porch.depthFt * ctx.mult, materialHigh: 55 * h.porch.widthFt * h.porch.depthFt * ctx.mult, laborLow: 25 * h.porch.widthFt * h.porch.depthFt * ctx.laborMult, laborHigh: 45 * h.porch.widthFt * h.porch.depthFt * ctx.laborMult }, { variant: `porch:${h.porch.widthFt}x${h.porch.depthFt}:${h.porch.roofed}`, basis: h.porch.widthFt * h.porch.depthFt, raw: Math.round(h.porch.widthFt * h.porch.depthFt) });
  priced(ctx, { id: 'deck', category: 'Outdoor', label: 'Deck', qty: deckSqft, slot: 'deck', mat: M(spec, sel, 'deck') });
  priced(ctx, { id: 'railing', category: 'Outdoor', label: 'Deck railing', qty: railingLF, slot: 'railing', mat: M(spec, sel, 'railing') });
  priced(ctx, { id: 'driveway', category: 'Hardscape', label: 'Driveway', qty: drivewaySqft, slot: 'driveway', mat: M(spec, sel, 'driveway') });
  priced(ctx, { id: 'walkway', category: 'Hardscape', label: 'Walkway', qty: walkwaySqft, slot: 'walkway', mat: M(spec, sel, 'walkway') });
  priced(ctx, { id: 'patio', category: 'Hardscape', label: 'Patio', qty: patioSqft, slot: 'patio', mat: M(spec, sel, 'patio') });
  priced(ctx, { id: 'lawn', category: 'Landscape', label: 'Lawn & planting beds', qty: lawnSqft * 0.6, slot: 'lawn', mat: M(spec, sel, 'lawn'), note: '60% of open lot area' });
  priced(ctx, { id: 'fence', category: 'Landscape', label: `Fence (${spec.lot.fence.heightFt}')`, qty: fenceLF, slot: 'fence', mat: M(spec, sel, 'fence') });
  if (spec.lot.treesCount) pushLine(ctx, { id: 'trees', category: 'Landscape', label: `Trees & large shrubs (${spec.lot.treesCount})`, qty: spec.lot.treesCount, unit: 'each', materialLow: 180 * spec.lot.treesCount * ctx.mult, materialHigh: 600 * spec.lot.treesCount * ctx.mult, laborLow: 120 * spec.lot.treesCount * ctx.laborMult, laborHigh: 300 * spec.lot.treesCount * ctx.laborMult }, { variant: 'tree', basis: spec.lot.treesCount, raw: spec.lot.treesCount });
  if (spec.lighting.exteriorSconces) priced(ctx, { id: 'sconces', category: 'Lighting', label: `Exterior sconces (${spec.lighting.exteriorSconces})`, qty: spec.lighting.exteriorSconces, group: 'lighting', tier: 'standard', variant: 'ext-sconce' });
  if (spec.lighting.landscape) pushLine(ctx, { id: 'landscape-lighting', category: 'Lighting', label: 'Low-voltage landscape lighting', qty: 1, unit: 'ls', materialLow: 800 * ctx.mult, materialHigh: 2500 * ctx.mult, laborLow: 700 * ctx.laborMult, laborHigh: 1800 * ctx.laborMult }, { variant: 'landscape-lighting', basis: 1, raw: 1 });
  if (spec.hardscape.pool.present) pushLine(ctx, { id: 'pool', category: 'Outdoor', label: `Pool (${spec.hardscape.pool.lengthFt}×${spec.hardscape.pool.widthFt})`, qty: 1, unit: 'ls', materialLow: 45000 * ctx.mult, materialHigh: 90000 * ctx.mult, laborLow: 25000 * ctx.laborMult, laborHigh: 60000 * ctx.laborMult }, { variant: `pool:${spec.hardscape.pool.lengthFt}x${spec.hardscape.pool.widthFt}`, basis: 1, raw: 1 });
}

// ---------------------------------------------------------------------------
// Floor plan — the whole-house interior shell
// ---------------------------------------------------------------------------

/**
 * A plan's rooms are EMPTY by contract, so this prices the shell and nothing
 * else: floor finish by room area, wall and ceiling paint by surface, running
 * trim by room perimeter, door slabs by the count, and each flight of stairs.
 *
 * Trim, doors and stairs are pushed with explicit ranges rather than through
 * `priced`: the price book's groups are all per-room-remodel units (a linear
 * foot of cabinet run, a square foot of counter) and none of them means "hang
 * an interior door". A made-up group would have been the dishonest option.
 */
function floorplan(spec: FloorPlanSpec, sel: Sel, ctx: Ctx) {
  const rooms = spec.levels.flatMap((l) => l.rooms.map((r) => ({ room: r, level: l })));
  const areaOf = (r: PlanRoom) => Math.abs(planPolygonArea(r.polygon));
  const perimeterOf = (r: PlanRoom) => {
    let p = 0;
    for (let i = 0, j = r.polygon.length - 1; i < r.polygon.length; j = i++) p += Math.hypot(r.polygon[i].x - r.polygon[j].x, r.polygon[i].y - r.polygon[j].y);
    return p;
  };

  for (const slot of ['flooring', 'floor_tile'] as const) {
    const sf = rooms.filter(({ room }) => room.floorSlot === slot).reduce((s, { room }) => s + areaOf(room), 0);
    if (sf > 0) priced(ctx, { id: `fp-${slot}`, category: 'Flooring', label: slot === 'flooring' ? 'Flooring — living areas' : 'Floor tile — baths, laundry & entry', qty: sf, slot, mat: M(spec, sel, slot), group: 'flooring' });
  }

  // wall paint: every room's perimeter to its ceiling, both faces of a
  // partition already counted once per room that touches it
  const wallSf = rooms.reduce((s, { room, level }) => s + perimeterOf(room) * level.ceilingFt, 0);
  const ceilingSf = rooms.reduce((s, { room }) => s + areaOf(room), 0);
  priced(ctx, { id: 'fp-walls', category: 'Paint', label: 'Wall paint — whole house', qty: wallSf, slot: 'walls', mat: M(spec, sel, 'walls'), group: 'wall-paint' });
  priced(ctx, { id: 'fp-ceiling', category: 'Paint', label: 'Ceilings — whole house', qty: ceilingSf, slot: 'ceiling', mat: M(spec, sel, 'ceiling'), group: 'ceiling' });

  const trimLF = rooms.reduce((s, { room }) => s + perimeterOf(room), 0);
  ctx.quantities.trimLF = trimLF;
  pushLine(ctx, {
    id: 'fp-trim', category: 'Millwork', label: 'Baseboard & casing', qty: r1(trimLF), unit: 'lf', slot: 'interior_trim',
    materialLow: 2.4 * trimLF * ctx.mult, materialHigh: 6.5 * trimLF * ctx.mult,
    laborLow: 3 * trimLF * ctx.laborMult, laborHigh: 7 * trimLF * ctx.laborMult,
    note: 'supplied, cut, installed and painted',
  }, { variant: sel.interior_trim ?? 'trim', basis: trimLF, raw: trimLF });

  // a cased opening has no leaf to buy or hang
  const doors = spec.levels.reduce((n, l) => n + l.doors.filter((d) => d.kind !== 'cased-opening').length, 0);
  pushLine(ctx, {
    id: 'fp-doors', category: 'Millwork', label: `Interior doors (${doors})`, qty: doors, unit: 'each', slot: 'interior_doors',
    materialLow: 220 * doors * ctx.mult, materialHigh: 700 * doors * ctx.mult,
    laborLow: 150 * doors * ctx.laborMult, laborHigh: 380 * doors * ctx.laborMult,
    note: 'slab, jamb, hardware and hanging',
  }, { variant: sel.interior_doors ?? 'door', basis: doors, raw: doors });

  const stairs = spec.levels.flatMap((l) => l.stairs);
  const treads = stairs.reduce((n, st) => n + st.treads, 0);
  if (treads > 0) {
    pushLine(ctx, {
      id: 'fp-stairs', category: 'Millwork', label: `Stair treads & risers (${treads} treads)`, qty: treads, unit: 'each', slot: 'stair_treads',
      materialLow: 90 * treads * ctx.mult, materialHigh: 260 * treads * ctx.mult,
      laborLow: 70 * treads * ctx.laborMult, laborHigh: 190 * treads * ctx.laborMult,
      note: 'hardwood tread, riser and returns',
    }, { variant: sel.stair_treads ?? 'tread', basis: treads, raw: treads });
  }
  // A handrail follows the flight's HYPOTENUSE, not its run: 13.1 ft of run
  // over a 10 ft rise is 16.5 ft of rail, and the shortfall grows with the
  // storey height — the first number a contractor checks on a stair line.
  const railLF = stairs.filter((st) => st.handrail !== 'none')
    .reduce((s, st) => s + Math.hypot(st.footprint.runFt, stairRiseFt(st, spec.levels)) * (st.handrail === 'both' ? 2 : 1), 0);
  if (railLF > 0) {
    pushLine(ctx, {
      id: 'fp-railing', category: 'Millwork', label: 'Stair handrail & balustrade', qty: r1(railLF), unit: 'lf', slot: 'stair_railing',
      materialLow: 45 * railLF * ctx.mult, materialHigh: 180 * railLF * ctx.mult,
      laborLow: 40 * railLF * ctx.laborMult, laborHigh: 130 * railLF * ctx.laborMult,
    }, { variant: sel.stair_railing ?? 'rail', basis: railLF, raw: railLF });
  }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------
const TIMELINES: Record<RoomSpec['roomType'], Record<EstimateSettings['scope'], [number, number]>> = {
  kitchen: { cosmetic: [1, 3], 'pull-and-replace': [4, 8], 'full-gut': [8, 14] },
  bathroom: { cosmetic: [1, 2], 'pull-and-replace': [3, 5], 'full-gut': [5, 10] },
  exterior: { cosmetic: [1, 3], 'pull-and-replace': [3, 7], 'full-gut': [8, 16] },
  floorplan: { cosmetic: [3, 6], 'pull-and-replace': [8, 16], 'full-gut': [16, 30] },
};

/**
 * Work a change drags in with it whether the client asked for it or not. New
 * base cabinets mean the existing top comes off; new fronts take new pulls.
 * Deliberately NOT here: countertop ⇒ backsplash. A careful top swap usually
 * leaves the slab or tile splash standing, and a contractor who wants it gone
 * swaps the backsplash slot.
 */
export const KNOCK_ONS: Record<RoomSpec['roomType'], Array<{ when: string[]; pull: string; reason: string }>> = {
  kitchen: [
    { when: ['cabinets_base'], pull: 'counter', reason: 'new base cabinets — the existing top comes off' },
    { when: ['cabinets_base', 'cabinets_upper', 'cabinets_tall', 'island_cabinets'], pull: 'hardware', reason: 'new cabinet fronts take new pulls' },
    { when: ['island_cabinets'], pull: 'island-top', reason: 'new island cabinetry — the island top comes off' },
  ],
  bathroom: [
    { when: ['vanity_cabinet'], pull: 'vanity-top', reason: 'new vanity — the top comes with it' },
    { when: ['vanity_cabinet'], pull: 'sinks', reason: 'new vanity top — sinks are re-set' },
  ],
  exterior: [
    { when: ['siding_primary'], pull: 'trim', reason: 'new siding — trim and corners are re-run' },
  ],
  floorplan: [
    // pulling the floor out from under a baseboard takes the baseboard with it
    { when: ['flooring', 'floor_tile'], pull: 'fp-trim', reason: 'new flooring — the baseboard comes off with it' },
    { when: ['interior_doors'], pull: 'fp-trim', reason: 'new door slabs — the casing is re-run' },
    { when: ['stair_treads'], pull: 'fp-stairs', reason: 'new treads — the flight is rebuilt around them' },
  ],
};

/** Which line, in scope, means a given trade shows up on site. */
export const TRADE_LINES: Record<'plumbing' | 'electrical' | 'drywall', string[]> = {
  plumbing: ['faucet', 'sinks', 'tub', 'toilet', 'fixtures', 'shower-pan', 'vanity', 'pool'],
  electrical: ['pendants', 'recessed', 'undercab', 'sconces', 'fan', 'appliances', 'landscape-lighting', 'cab-base', 'cab-upper', 'cab-island', 'cab-tall'],
  drywall: ['backsplash', 'wall-tile', 'shower-wall', 'walls', 'cab-upper', 'cab-tall', 'niche'],
};

/**
 * How much of each lump-sum allowance a partial scope carries. The gate says
 * whether the trade shows up at all; the floor is the minimum call-out once it
 * does — a faucet-only job still buys a plumber's trim-out, not 3% of a
 * rough-in. Tuned here, away from the algorithm, so pricing review can move a
 * number without reading the reconciler.
 */
export const ALLOWANCE_RULES: Record<AllowanceKey, { gate: 'any' | 'plumbing' | 'electrical' | 'drywall' | 'permit'; floor: number }> = {
  demo: { gate: 'any', floor: 0.20 },
  drywall: { gate: 'drywall', floor: 0.20 },
  design: { gate: 'any', floor: 0.10 },
  plumbing: { gate: 'plumbing', floor: 0.15 },
  electrical: { gate: 'electrical', floor: 0.15 },
  permits: { gate: 'permit', floor: 0.25 },
};

interface RoomRun { lines: EstimateLine[]; quantities: Record<string, number>; meta: Map<string, LineMeta> }

const SCAN_LINE: Record<string, [string, string, string, string?]> = {
  cabinets_base: ['cab-base', 'Cabinetry', 'Measured base cabinetry', 'baseLF'], cabinets_upper: ['cab-upper', 'Cabinetry', 'Measured upper cabinetry', 'upperLF'],
  cabinets_tall: ['cab-tall', 'Cabinetry', 'Measured tall cabinetry', 'tallLF'], island_cabinets: ['cab-island', 'Cabinetry', 'Measured island cabinetry', 'islandLF'],
  countertop: ['counter', 'Surfaces', 'Measured perimeter countertops', 'counterSqft'], island_countertop: ['island-top', 'Surfaces', 'Measured island countertops', 'islandTopSqft'],
  flooring: ['floor', 'Surfaces', 'Measured flooring', 'floorSqft'], floor_tile: ['floor-tile', 'Surfaces', 'Measured floor tile', 'floorSqft'],
  walls: ['walls', 'Surfaces', 'Measured net wall area', 'wallSqft'], ceiling: ['ceiling', 'Surfaces', 'Measured ceiling area', 'ceilingSqft'],
  hardware: ['hardware', 'Finishes', 'Counted cabinet hardware', 'hardwareCount'], faucet: ['faucet', 'Finishes', 'Counted sink and faucet assemblies'],
  appliances: ['appliances', 'Appliances', 'Reviewed appliance package'], vanity_cabinet: ['vanity', 'Vanity', 'Measured vanity cabinetry', 'vanityLF'],
  vanity_top: ['vanity-top', 'Vanity', 'Measured vanity top', 'vanityTopSqft'], fixtures: ['scan-fixtures', 'Fixtures', 'Reviewed plumbing fixtures'],
  mirror: ['scan-mirror', 'Fixtures', 'Counted mirrors'], tub: ['tub', 'Fixtures', 'Counted bathtubs'],
};
/** Reviewed quantities use the same catalog and labor pricebook as procedural
 * rooms. Partial object coverage remains unpriced separately in scan-scope. */
function reviewedScanLines(spec: SingleRoomSpec, sel: Sel, ctx: Ctx) {
  if (!spec.scanGeometry) return;
  const groups = new Map<string, ReturnType<typeof validScanTakeoffs>>();
  for (const takeoff of validScanTakeoffs(spec)) {
    if (takeoff.slot === 'appliances' && ctx.settings.keepExistingAppliances) continue;
    const list = groups.get(takeoff.slot) ?? []; list.push(takeoff); groups.set(takeoff.slot, list);
  }
  for (const [slot, takeoffs] of groups) {
    const mat = M(spec, sel, slot);
    if (!mat || unitPrice(mat.group, mat.tier).unit !== takeoffs[0].unit) continue;
    const [id, category, label, quantityKey] = SCAN_LINE[slot] ?? [`scan-${slot}`, 'Surfaces', `Measured ${slot.replaceAll('_', ' ')}`];
    const qty = takeoffs.reduce((sum, item) => sum + item.quantity, 0);
    // Replace captured room totals or other lines for this slot exactly once.
    ctx.lines = ctx.lines.filter(line => line.slot !== slot);
    if (quantityKey) ctx.quantities[quantityKey] = qty;
    priced(ctx, { id, category, label, qty, slot, mat, adj: slot === 'cabinets_tall' ? 2.1 : slot === 'cabinets_upper' ? 0.85 : 1,
      note: `Site-reviewed takeoff: ${takeoffs.length} measurement${takeoffs.length === 1 ? '' : 's'}. Catalog material and installation ranges; demolition, connections and hidden work require separate review. ${takeoffs.map(item => item.note).filter(Boolean).join('; ')}` });
  }
  for (const allowance of validScanWorkAllowances(spec)) {
    const object = spec.scanGeometry.objects.find(item => item.id === allowance.objectId);
    if (!object || scanEditIsIdentity(scanObjectEdit(spec, object.id)) || !Number.isFinite(allowance.low) || !Number.isFinite(allowance.high) || allowance.low < 0 || allowance.high < allowance.low) continue;
    pushLine(ctx, { id: `scan-work-${object.id}`, category: 'Site Work', label: `${scanObjectIsHidden(spec, object.id) ? 'Remove' : 'Modify / relocate'} ${object.kind} · reviewed labor`, qty: 1, unit: 'ls', materialLow: 0, materialHigh: 0, laborLow: allowance.low, laborHigh: allowance.high,
      note: `Contractor-entered allowance, before contingency, markup and tax. ${allowance.note}` }, { variant: 'reviewed-scan-work', basis: 1, raw: 1 });
  }
}

function runRoom(spec: RoomSpec, sel: Sel, settings: EstimateSettings, region: Region): RoomRun {
  const ctx: Ctx = { settings, mult: region.multiplier, laborMult: region.laborMultiplier, lines: [], quantities: {}, meta: new Map() };
  if (spec.roomType === 'kitchen') kitchen(spec, sel, ctx);
  else if (spec.roomType === 'bathroom') bathroom(spec, sel, ctx);
  else if (spec.roomType === 'floorplan') floorplan(spec, sel, ctx);
  else exterior(spec, sel, ctx);
  if (spec.roomType === 'kitchen' || spec.roomType === 'bathroom') reviewedScanLines(spec, sel, ctx);
  return { lines: ctx.lines, quantities: ctx.quantities, meta: ctx.meta };
}

/**
 * The baseline never changes while the user swats through a swatch grid, but
 * MaterialPicker calls this N+1 times per render. Keyed off the baseline spec
 * object so a new baseline gets a new cache; the inner map is capped because a
 * long session with many settings changes would otherwise grow forever.
 */
const BASELINE_RUNS = new WeakMap<RoomSpec, Map<string, RoomRun>>();
const BASELINE_CACHE_MAX = 8;

function baselineRun(spec: RoomSpec, sel: Sel, settings: EstimateSettings, region: Region): RoomRun {
  const key = `${settings.region}|${settings.tier}|${JSON.stringify(Object.entries(sel).sort())}`;
  let byKey = BASELINE_RUNS.get(spec);
  if (!byKey) { byKey = new Map(); BASELINE_RUNS.set(spec, byKey); }
  const hit = byKey.get(key);
  if (hit) return hit;
  const run = runRoom(spec, sel, settings, region);
  if (byKey.size >= BASELINE_CACHE_MAX) byKey.delete(byKey.keys().next().value as string);
  byKey.set(key, run);
  return run;
}

/**
 * A baseline is only usable for the room it was captured in. A stale one
 * (after `setRoomType`, or a share saved before the field existed) degrades to
 * a full remodel rather than throwing — today's behaviour, which is the right
 * answer when there is no record of the room as found.
 */
export function estimateMode(spec: RoomSpec | null, settings: EstimateSettings, baseline?: ProjectBaseline | null): 'changes' | 'full' {
  return baseline?.spec && spec && baseline.spec.roomType === spec.roomType ? (settings.mode ?? 'changes') : 'full';
}

const isAllowance = (l: { id: string }) => l.id.startsWith('allow-');
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function scaleAmounts(l: EstimateLine, f: number): LineAmounts {
  return { qty: r1(l.qty * f), materialLow: r0(l.materialLow * f), materialHigh: r0(l.materialHigh * f), laborLow: r0(l.laborLow * f), laborHigh: r0(l.laborHigh * f) };
}

interface ScopeResult {
  lines: EstimateLine[];
  factors: AllowanceFactors;
  share: number;
  anyIn: boolean;
  trades: { demo: boolean; plumbing: boolean; electrical: boolean; drywall: boolean };
}

/**
 * Reconcile the current room pricing against the baseline's, line by line.
 * Order matters: a material swap on the line's own slot wins over a knock-on,
 * a knock-on over a size change, and a line that has no baseline counterpart
 * is new rather than bigger.
 */
function scopeLines(cur: RoomRun, base: RoomRun, spec: RoomSpec, sel: Sel, baseSpec: RoomSpec, baseSel: Sel, settings: EstimateSettings): ScopeResult {
  const byId = new Map(base.lines.map((l) => [l.id, l]));
  // Resolve through the SAME fallback pricing uses, so two unresolvable ids
  // that both land on the room default are not a change.
  const replacements = scanReplacementSlots(spec, settings, sel);
  const changedSlots = new Set<string>(replacements);
  for (const l of cur.lines) {
    if (!l.slot) continue;
    if (M(spec, sel, l.slot)?.id !== M(baseSpec, baseSel, l.slot)?.id) changedSlots.add(l.slot);
  }
  const pulled = new Map<string, string>();
  if (settings.includeKnockOns !== false) {
    for (const e of KNOCK_ONS[spec.roomType]) if (e.when.some((s) => changedSlots.has(s))) pulled.set(e.pull, e.reason);
  }

  const out: EstimateLine[] = [];
  for (const l of cur.lines) {
    const b = byId.get(l.id);
    const meta = cur.meta.get(l.id) ?? {};
    const bMeta = base.meta.get(l.id) ?? {};
    if (l.slot && changedSlots.has(l.slot)) {
      const from = M(baseSpec, baseSel, l.slot)?.name ?? 'as found';
      const to = M(spec, sel, l.slot)?.name ?? 'unset';
      out.push({ ...l, scope: 'changed', baselineQty: b?.qty ?? 0, reason: replacements.has(l.slot) ? `explicit replacement: ${to}; original scan finish was not verified` : `material changed: ${from} → ${to}` });
    } else if (pulled.has(l.id)) {
      out.push({ ...l, scope: 'changed', baselineQty: b?.qty ?? 0, reason: `knock-on: ${pulled.get(l.id)}` });
    } else if (!b) {
      out.push({ ...l, scope: 'added', baselineQty: 0, reason: 'new' });
    } else if (meta.variant !== bMeta.variant) {
      out.push({ ...l, scope: 'changed', baselineQty: b.qty, reason: `${b.label} → ${l.label}` });
    } else {
      const basis = meta.basis ?? l.qty;
      const baseBasis = bMeta.basis ?? b.qty;
      if (basis > baseBasis + 1e-6) {
        const frac = (basis - baseBasis) / basis;
        const raw = meta.raw ?? l.qty;
        const a = meta.reprice ? meta.reprice(raw * frac) : scaleAmounts(l, frac);
        out.push({
          ...l, ...a, totalLow: a.materialLow + a.laborLow, totalHigh: a.materialHigh + a.laborHigh,
          scope: 'added', baselineQty: b.qty, reason: `+${fmtQty(a.qty)} ${l.unit}`,
        });
      } else {
        // a shrink is never a cost, and the row still says what it would cost
        // in a full remodel so the panel can grey it and still price it
        out.push({ ...l, scope: 'unchanged', baselineQty: b.qty, materialLow: 0, materialHigh: 0, laborLow: 0, laborHigh: 0, totalLow: 0, totalHigh: 0 });
      }
    }
  }

  // Anything the baseline priced that the twin no longer has: demolition, not
  // a credit. Slotted in after the last surviving line of its own category.
  const curIds = new Set(cur.lines.map((l) => l.id));
  const removed = base.lines.filter((b) => !isAllowance(b) && !curIds.has(b.id));
  for (const b of removed) {
    const row: EstimateLine = {
      ...b, scope: 'removed', baselineQty: b.qty,
      materialLow: 0, materialHigh: 0, laborLow: 0, laborHigh: 0, totalLow: 0, totalHigh: 0,
      fullTotalLow: b.totalLow, fullTotalHigh: b.totalHigh,
      note: 'removed — demolition in allowance',
    };
    let at = -1;
    for (let i = 0; i < out.length; i++) if (out[i].category === b.category) at = i;
    if (at >= 0) out.splice(at + 1, 0, row); else out.push(row);
  }

  const inScope = out.filter((l) => l.scope === 'changed' || l.scope === 'added');
  const inScopeMid = inScope.reduce((s, l) => s + midOf(l.totalLow, l.totalHigh), 0);
  const fullMid = cur.lines.reduce((s, l) => s + midOf(l.fullTotalLow, l.fullTotalHigh), 0);
  const share = fullMid > 0 ? clamp01(inScopeMid / fullMid) : 0;
  const removedMid = removed.reduce((s, b) => s + midOf(b.totalLow, b.totalHigh), 0);
  const baseFullMid = base.lines.reduce((s, l) => s + midOf(l.totalLow, l.totalHigh), 0);
  const removedShare = baseFullMid > 0 ? clamp01(removedMid / baseFullMid) : 0;
  const anyIn = inScope.length > 0 || removed.length > 0;

  // Moving a sink is not a fraction of a rough-in, it is the rough-in.
  let layoutPlumbing = false;
  if (spec.roomType === 'kitchen' && baseSpec.roomType === 'kitchen') {
    const wallFt = spec.sink.wall === 'back' || spec.sink.wall === 'front' ? spec.dims.widthFt : spec.dims.depthFt;
    if (spec.sink.wall !== baseSpec.sink.wall || Math.abs(spec.sink.t - baseSpec.sink.t) * wallFt > 2) layoutPlumbing = true;
  }

  const inIds = new Set(inScope.map((l) => l.id));
  const plumbing = layoutPlumbing || TRADE_LINES.plumbing.some((id) => inIds.has(id));
  const electrical = TRADE_LINES.electrical.some((id) => inIds.has(id));
  const drywall = TRADE_LINES.drywall.some((id) => inIds.has(id));
  const permits = plumbing || electrical;
  const open: Record<'any' | 'plumbing' | 'electrical' | 'drywall' | 'permit', boolean> = { any: anyIn, plumbing, electrical, drywall, permit: permits };

  const factors = Object.fromEntries((Object.keys(ALLOWANCE_RULES) as AllowanceKey[]).map((k) => {
    const rule = ALLOWANCE_RULES[k];
    if (!open[rule.gate]) return [k, 0];
    const floor = rule.gate === 'plumbing' && layoutPlumbing ? 1 : rule.floor;
    return [k, clamp01(Math.max(floor, k === 'demo' ? share + removedShare : share))];
  })) as AllowanceFactors;

  return { lines: out, factors, share, anyIn, trades: { demo: anyIn, plumbing, electrical, drywall } };
}

function timelineFor(roomType: RoomSpec['roomType'], settings: EstimateSettings, mode: 'changes' | 'full', share: number, anyIn: boolean, sizeBump: number): [number, number] {
  // same guard as allowanceLines: a persisted or shared settings object can
  // carry a scope word this build does not know, and destructuring undefined
  // here took the whole EstimatePanel down
  const scope = TIMELINES[roomType][settings.scope] ? settings.scope : 'pull-and-replace';
  const [sLo, sHi] = TIMELINES[roomType][scope];
  if (mode === 'full') return [sLo, sHi + sizeBump];
  if (!anyIn) return [0, 0];
  // a small change runs at cosmetic speed and slides toward the chosen scope's
  // band as it grows; a quarter of the room is where a crew stops being in and
  // out in a week
  const [cLo, cHi] = TIMELINES[roomType].cosmetic;
  const t = clamp01((share - 0.25) / 0.75);
  const lo = Math.max(1, Math.round(cLo + (sLo - cLo) * t));
  const hi = Math.max(lo, Math.round(cHi + (sHi - cHi) * t) + (t > 0 ? sizeBump : 0));
  return [lo, hi];
}

function totalsFor(lines: Array<{ totalLow: number; totalHigh: number }>, settings: EstimateSettings, salesTaxPct: number, weeks: [number, number]): EstimateTotals {
  const subtotalLow = lines.reduce((s, l) => s + l.totalLow, 0);
  const subtotalHigh = lines.reduce((s, l) => s + l.totalHigh, 0);
  const contingencyLow = r0(subtotalLow * settings.contingencyPct);
  const contingencyHigh = r0(subtotalHigh * settings.contingencyPct);
  const markupLow = r0((subtotalLow + contingencyLow) * settings.markupPct);
  const markupHigh = r0((subtotalHigh + contingencyHigh) * settings.markupPct);
  const taxLow = r0((subtotalLow + contingencyLow + markupLow) * salesTaxPct);
  const taxHigh = r0((subtotalHigh + contingencyHigh + markupHigh) * salesTaxPct);
  const totalLow = subtotalLow + contingencyLow + markupLow + taxLow;
  const totalHigh = subtotalHigh + contingencyHigh + markupHigh + taxHigh;
  return {
    subtotalLow, subtotalHigh, contingencyLow, contingencyHigh, markupLow, markupHigh, taxLow, taxHigh,
    totalLow, totalHigh, mid: r0((totalLow + totalHigh) / 2),
    timelineWeeksLow: weeks[0], timelineWeeksHigh: weeks[1],
  };
}

export function calculateEstimate(spec: RoomSpec | null, selections: Sel, settings: EstimateSettings, baseline?: ProjectBaseline | null): Estimate {
  const region = REGION_BY_ID[settings.region] ?? REGION_BY_ID.national;
  const mode = estimateMode(spec, settings, baseline);
  if (!spec) {
    const zero = totalsFor([], settings, region.salesTaxPct, [0, 0]);
    return { ...zero, lines: [], mode: 'full', full: zero, scopeShare: 1, changedCount: 0, trades: { demo: false, plumbing: false, electrical: false, drywall: false }, salesTaxPct: region.salesTaxPct, regionMultiplier: region.multiplier, quantities: {}, baselineQuantities: null };
  }

  const cur = runRoom(spec, selections, settings, region);
  const sizeBump = 'dims' in spec && spec.dims.widthFt * spec.dims.depthFt > 220 ? 1 : 0;

  let roomLines: EstimateLine[];
  let factors = FULL_FACTORS;
  let share = 1;
  let anyIn = true;
  let trades = { demo: true, plumbing: true, electrical: true, drywall: true };
  let baselineQuantities: Record<string, number> | null = null;

  if (mode === 'changes' && baseline) {
    // Confirming an existing item's takeoff is evidence, not a renovation.
    // Reuse it in a virtual baseline only while that object's shape is retained;
    // immutable stored baseline JSON is never rewritten.
    let baselineSpec = baseline.spec;
    if ((spec.roomType === 'kitchen' || spec.roomType === 'bathroom') && spec.scanGeometry && baselineSpec.roomType === spec.roomType) {
      const takeoffs = validScanTakeoffs(spec).filter(item => item.objectIds.every(id => !scanObjectSizeChanged(spec, id)));
      baselineSpec = { ...baselineSpec, scanDesign: { version: 1, objects: {}, takeoffs } };
    }
    const base = baselineRun(baselineSpec, baseline.selections, settings, region);
    baselineQuantities = { ...base.quantities };
    const sc = scopeLines(cur, base, spec, selections, baseline.spec, baseline.selections, settings);
    roomLines = sc.lines;
    factors = sc.factors;
    share = sc.share;
    anyIn = sc.anyIn;
    trades = sc.trades;
  } else {
    roomLines = cur.lines.map((l) => ({ ...l }));
  }

  // Allowances are appended after the room lines (legacy order) and scoped by
  // the same factors, so "nothing changed" produces no allowance line at all.
  const allowCtx: Ctx = { settings, mult: region.multiplier, laborMult: region.laborMultiplier, lines: [], quantities: {}, meta: new Map() };
  allowanceLines(allowCtx, spec.roomType, factors);
  const fullCtx: Ctx = { settings, mult: region.multiplier, laborMult: region.laborMultiplier, lines: [], quantities: {}, meta: new Map() };
  allowanceLines(fullCtx, spec.roomType, FULL_FACTORS);

  const lines = [...roomLines, ...allowCtx.lines];
  const weeks = timelineFor(spec.roomType, settings, mode, share, anyIn, sizeBump);
  const totals = totalsFor(lines, settings, region.salesTaxPct, weeks);
  // The full block prices the twin ON SCREEN from scratch; a removed line is
  // no longer in that twin, so it does not belong here.
  const fullSource = [
    ...cur.lines.map((l) => ({ totalLow: l.fullTotalLow, totalHigh: l.fullTotalHigh })),
    ...fullCtx.lines.map((l) => ({ totalLow: l.totalLow, totalHigh: l.totalHigh })),
  ];
  const full = mode === 'full' ? totals : totalsFor(fullSource, settings, region.salesTaxPct, timelineFor(spec.roomType, settings, 'full', 1, true, sizeBump));
  const coverage = scannedWorkScope(spec, selections, settings, baseline);

  return {
    ...totals,
    ...(coverage.fullUnpriced.length ? coverage : {}),
    lines,
    mode,
    full,
    scopeShare: mode === 'full' ? 1 : share,
    changedCount: lines.filter((l) => !isAllowance(l) && l.scope !== 'unchanged').length,
    trades,
    salesTaxPct: region.salesTaxPct,
    regionMultiplier: region.multiplier,
    quantities: cur.quantities,
    baselineQuantities,
  };
}

export interface LineGroup { category: string; lines: EstimateLine[]; low: number; high: number; fullLow: number; fullHigh: number; hidden: number }

/** Group lines by category preserving insertion order. */
export function groupLines(lines: EstimateLine[], opts?: { hideUnchanged?: boolean }): LineGroup[] {
  const map = new Map<string, EstimateLine[]>();
  for (const l of lines) map.set(l.category, [...(map.get(l.category) ?? []), l]);
  const out: LineGroup[] = [];
  for (const [category, ls] of map) {
    const shown = opts?.hideUnchanged ? ls.filter((l) => l.scope !== 'unchanged') : ls;
    if (opts?.hideUnchanged && shown.length === 0) continue;
    out.push({
      category, lines: shown, hidden: ls.length - shown.length,
      low: shown.reduce((s, l) => s + l.totalLow, 0), high: shown.reduce((s, l) => s + l.totalHigh, 0),
      fullLow: ls.reduce((s, l) => s + l.fullTotalLow, 0), fullHigh: ls.reduce((s, l) => s + l.fullTotalHigh, 0),
    });
  }
  return out;
}
