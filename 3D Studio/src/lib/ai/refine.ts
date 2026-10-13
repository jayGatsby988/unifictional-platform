/**
 * Accuracy pass: compare the 3D twin against the client's photo and correct it.
 *
 * A single vision call reading a photograph gets the layout roughly right and
 * the details often wrong — a run one cabinet too long, an island a foot too
 * big, a missing window, the fridge on the wrong side. Asking the same model to
 * "try harder" does not fix that, because it has nothing to check its answer
 * against.
 *
 * So we close the loop. Once the twin is built we screenshot it from the same
 * viewpoint the photo was taken from, hand the model BOTH images side by side,
 * and ask a much easier question: what is different? Differences are far easier
 * to see than absolute measurements, and the answer comes back as a list of
 * typed edits rather than a whole new spec.
 *
 * The pass is split in two so each half can be tested without the other:
 *   - `refineSpec()` measures the supplied viewport, calls vision, then fits
 *     the accepted corrections back to the original photo inventory
 *   - `applyCorrections()` is a pure function of (spec, model output) — no
 *     network, no clock, no randomness — so a headless script can drive it
 *     with hand-written outputs and assert exactly what gets through.
 *
 * Every edit is checked before it is applied:
 *   - the field must be one of a fixed allowlist (the model cannot invent paths)
 *   - the value must be the right primitive type and inside the field's range;
 *     an added array element must satisfy that element's zod schema
 *   - the patched spec must still satisfy the full RoomSpec schema
 * A correction that fails any of those is dropped and reported, never applied.
 */
import { z } from 'zod';
import type { FinishObservation, RoomSpec, RoomType, SolvedCamera, Wall } from '@/lib/spec/types';
import { ApplianceZ, BathAccessoryZ, CabinetContentsZ, CabinetRunZ, DecorItemZ, FinishObservationZ, OpenShelfZ, OpeningZ, PendantPositionZ, PlantZ, RoomSpecZ, WallArtZ } from '@/lib/spec/schema';
import { applyFinishObservations, ensureSpecMaterials, isCustomMaterialId } from '@/lib/materials/match';
import { getMaterial } from '@/lib/materials/catalog';
import { parseHex } from '@/lib/materials/color';
import { openaiClient, openaiVisionModel } from './providers/openai';
import { ProviderError } from './providers/types';
import { errorMessage, serverLog, serverWarn, startTimer } from './log';
import { parseModelJson } from './sanitize';
import { ISLAND_KNEE_IN, inventoryWallConflicts, islandNeedsKneeRoom, reconcileSpec } from './reconcile';
import { describeSpec, FINISH_COLOR_DISCIPLINE, slotsForRoom } from './prompt';
import { fitToPhoto, measureAt, type FitResult } from '@/lib/fit/fit';
import { islandTopFt } from '@/components/scene/kitchen/layout';
import { coverageOf, hintSentence, residualName, residualSentence, residualsOf as deriveResiduals, RESIDUAL_OFF_BELOW, type FitHint, type FitResidual } from '@/lib/api-client';
import { isSingleRoom, planPolygonArea } from '@/lib/spec/floorplan';
import { confirmedDimensions } from '@/lib/spec/measurements';

// ---------------------------------------------------------------------------
// The allowlist — every scalar field the accuracy pass is permitted to touch.
// ---------------------------------------------------------------------------

/**
 * `hex` is a string field whose values list would be 16.7 million long: it is
 * checked by `parseHex` instead, so the model may annotate its answer
 * ('#5A3B2A (chocolate)') the way it does everywhere else and still get a
 * canonical '#RRGGBB' into the spec — a colour NAME is rejected, not stored.
 */
type Kind = 'number' | 'integer' | 'string' | 'boolean' | 'hex';

interface FieldDef {
  /** dotted path; `[]` marks the one array index supplied via `index` */
  path: string;
  kind: Kind;
  min?: number;
  max?: number;
  /** allowed values for a string field */
  values?: readonly string[];
  /** allowed values for a number field that is really an enum (island rotation) */
  numberValues?: readonly number[];
  rooms: readonly RoomType[];
  /** human wording used in the prompt */
  help: string;
}

const WALLS = ['back', 'left', 'right', 'front'] as const;
const INTERIOR = ['kitchen', 'bathroom'] as const;
/** The wall each standpoint has its back to (same table as photoMatch.ts / the fitter's standpoints). */
const STAND_WALL: Record<RoomSpec['detected']['camera']['position'], (typeof WALLS)[number] | null> = {
  front: 'front', 'corner-left': 'front', 'corner-right': 'front', 'side-left': 'left', 'side-right': 'right', top: null,
};
const ALL_ROOMS = ['kitchen', 'bathroom', 'exterior'] as const;
/** Duplicated by hand from schema.ts, in the same order — check-refine asserts every range sits inside the schema's. */
const ITEM_KINDS = [
  'pot', 'pan', 'kettle', 'dutch-oven', 'cutting-board', 'bowl', 'fruit-bowl',
  'bottle', 'oil-set', 'vase', 'flowers', 'books', 'utensil-crock', 'knife-block',
  'coffee-maker', 'stand-mixer', 'toaster', 'microwave-countertop', 'soap-set',
  'dish-rack', 'tray', 'candle', 'canister', 'paper-towel', 'plate-stack',
  'mugs', 'jar', 'basket', 'towel',
  'folded-towels', 'soap-pump', 'toothbrush-cup', 'robe', 'bath-mat', 'tissue-box',
  'other',
] as const;
const ITEM_HOSTS = ['counter', 'range', 'island', 'shelf', 'sill', 'floor'] as const;
const ITEM_MATERIALS = ['stainless', 'black-metal', 'copper', 'brass', 'enamel', 'ceramic', 'glass', 'wood', 'plastic', 'fabric', 'paper', 'marble', 'wicker'] as const;
const BURNERS = ['left-back', 'left-front', 'centre-back', 'centre-front', 'right-back', 'right-front'] as const;
const CONTENT_KINDS = ['plates', 'bowls', 'glasses', 'mugs', 'jars', 'cookbooks', 'bottles', 'mixed', 'empty'] as const;
/** the bathroom's own vocabulary — same hand-duplication rule as ITEM_KINDS above, and check-refine asserts each sits inside the schema's */
const FIXTURE_FINISHES = ['chrome', 'brushed-nickel', 'polished-nickel', 'matte-black', 'brushed-gold', 'polished-brass', 'oil-rubbed-bronze', 'stainless', 'white', 'black'] as const;
const TILE_PATTERNS = ['stacked', 'running-bond', 'vertical-stack', 'herringbone', 'chevron', 'basketweave', 'hex', 'penny', 'mosaic', 'large-format', 'slab'] as const;
const ACCESSORY_KINDS = ['towel-bar', 'towel-ring', 'hook', 'robe-hook', 'grab-bar', 'toilet-paper-holder', 'towel-warmer', 'shower-caddy', 'corner-shelf'] as const;

export const REFINABLE: readonly FieldDef[] = [
  // ---- shared shell
  { path: 'dims.widthFt', kind: 'number', min: 4, max: 80, rooms: INTERIOR, help: 'room width in feet (along the wall the camera faces)' },
  { path: 'dims.depthFt', kind: 'number', min: 4, max: 80, rooms: INTERIOR, help: 'room depth in feet (toward the camera)' },
  { path: 'dims.ceilingFt', kind: 'number', min: 7, max: 20, rooms: INTERIOR, help: 'ceiling height in feet' },
  { path: 'style', kind: 'string', values: ['modern', 'contemporary', 'transitional', 'traditional', 'farmhouse', 'scandinavian', 'industrial', 'coastal', 'mid-century', 'craftsman', 'mediterranean'], rooms: ALL_ROOMS, help: 'overall design style' },

  // ---- the photographer. A wrong camera makes every other comparison wrong,
  // so the model may move it before it judges anything else.
  { path: 'detected.camera.fovDeg', kind: 'number', min: 20, max: 120, rooms: ALL_ROOMS, help: 'HORIZONTAL field of view of the photo in degrees (phone wide ≈ 65–75, standard ≈ 50–60)' },
  { path: 'detected.camera.heightFt', kind: 'number', min: 2, max: 12, rooms: ALL_ROOMS, help: 'camera height above the floor in feet' },
  { path: 'detected.camera.position', kind: 'string', values: ['front', 'corner-left', 'corner-right', 'side-left', 'side-right', 'top'], rooms: ALL_ROOMS, help: 'where the photographer stood, relative to the wall they faced' },
  { path: 'detected.camera.lookingAt', kind: 'string', values: WALLS, rooms: ALL_ROOMS, help: 'which wall the camera faces' },

  // ---- kitchen
  { path: 'layout', kind: 'string', values: ['single-wall', 'galley', 'l-shaped', 'u-shaped', 'peninsula', 'g-shaped'], rooms: ['kitchen'], help: 'cabinet layout' },
  { path: 'runs[].wall', kind: 'string', values: WALLS, rooms: ['kitchen'], help: 'which wall cabinet run N is on' },
  { path: 'runs[].lengthFt', kind: 'number', min: 1, max: 40, rooms: ['kitchen'], help: 'length of cabinet run N in feet' },
  { path: 'runs[].start', kind: 'number', min: 0, max: 1, rooms: ['kitchen'], help: 'where run N starts along its wall (0 = left end)' },
  { path: 'runs[].hasUppers', kind: 'boolean', rooms: ['kitchen'], help: 'whether run N has wall cabinets above the counter' },
  { path: 'runs[].uppersToCeiling', kind: 'boolean', rooms: ['kitchen'], help: 'whether run N wall cabinets reach the ceiling' },
  { path: 'runs[].backsplash', kind: 'boolean', rooms: ['kitchen'], help: 'whether the backsplash tile covers run N (a photo often shows tile behind the range wall only)' },
  { path: 'runs[].upperHeightIn', kind: 'number', min: 12, max: 60, rooms: ['kitchen'], help: 'whole wall-cabinet row height in inches, including a short row above a window; with upperBottomIn this fixes the observed bottom and top independently' },
  { path: 'runs[].upperBottomIn', kind: 'number', min: 24, max: 228, rooms: ['kitchen'], help: 'absolute underside of wall-cabinet row N above the floor, inches; read the actual bottom edge independently of the standard counter gap, especially above a window' },
  // the one number that describes a stacked row and is reachable through the
  // path grammar: `runs[].uppers2[].heightIn` would need two indices and the
  // reader substitutes ONE, so it could only ever address runs[i].uppers2[i]
  { path: 'runs[].uppers2HeightIn', kind: 'number', min: 9, max: 36, rooms: ['kitchen'], help: 'height of the SECOND, shorter tier of wall cabinets on run N in inches, measured down from the top of the row (a 54in stacked row is usually 36in of door with an 18in transom over it). Only meaningful when run N already has a second tier' },
  { path: 'island.present', kind: 'boolean', rooms: ['kitchen'], help: 'whether there is an island' },
  { path: 'island.kind', kind: 'string', values: ['island', 'peninsula', 'breakfast-bar'], rooms: ['kitchen'], help: 'free-standing island, or a peninsula attached to a run' },
  { path: 'island.lengthFt', kind: 'number', min: 2, max: 16, rooms: ['kitchen'], help: 'island length in feet' },
  { path: 'island.widthFt', kind: 'number', min: 1.5, max: 8, rooms: ['kitchen'], help: 'island depth in feet' },
  { path: 'island.offset.x', kind: 'number', min: -20, max: 20, rooms: ['kitchen'], help: 'island centre offset from room centre, feet, + toward the right wall' },
  { path: 'island.offset.z', kind: 'number', min: -20, max: 20, rooms: ['kitchen'], help: 'island centre offset from room centre, feet, + toward the camera / front wall' },
  { path: 'island.rotationDeg', kind: 'integer', numberValues: [0, 90], rooms: ['kitchen'], help: '0 = island runs parallel to the back wall, 90 = parallel to the side walls' },
  { path: 'island.seating', kind: 'integer', min: 0, max: 8, rooms: ['kitchen'], help: 'number of stools at the island' },
  { path: 'island.overhangIn', kind: 'number', min: 0, max: 18, rooms: ['kitchen'], help: 'counter overhang on the seating side, inches' },
  { path: 'island.waterfall', kind: 'boolean', rooms: ['kitchen'], help: 'whether the island top wraps down the ends' },
  { path: 'island.stoolPitchIn', kind: 'number', min: 0, max: 40, rooms: ['kitchen'], help: 'centre-to-centre spacing of the stools in inches (0 = automatic)' },
  { path: 'island.endSeats', kind: 'integer', min: 0, max: 4, rooms: ['kitchen'], help: 'how many of the stools sit round the short end of the island' },
  { path: 'island.endPlacement', kind: 'string', values: ['auto', 'left', 'right', 'both'], rooms: ['kitchen'], help: 'which short end the end stools sit at, seen facing the back wall (both = one at each end)' },
  { path: 'island.endOverhangIn', kind: 'number', min: 0, max: 18, rooms: ['kitchen'], help: 'how far the island top overhangs the cabinet body at each SHORT end, inches (1–2 flush, 10–15 when stools tuck under it)' },
  { path: 'island.stoolOffsetIn', kind: 'number', min: -60, max: 60, rooms: ['kitchen'], help: 'shift of the long-side stool row from the island centre, inches, + toward the right end' },
  { path: 'cabinets.doorStyle', kind: 'string', values: ['shaker', 'flat', 'raised', 'slab', 'beaded', 'glass', 'open'], rooms: ['kitchen'], help: 'cabinet door style' },
  { path: 'cabinets.hardware', kind: 'string', values: ['pulls', 'knobs', 'mixed', 'integrated', 'none'], rooms: ['kitchen'], help: 'cabinet hardware type' },
  { path: 'cabinets.crown', kind: 'boolean', rooms: ['kitchen'], help: 'crown moulding on the wall cabinets' },
  { path: 'cabinets.upperHeightIn', kind: 'number', min: 12, max: 48, rooms: ['kitchen'], help: 'default wall cabinet height in inches, including a short high row' },
  { path: 'cabinets.baseDepthIn', kind: 'number', min: 18, max: 30, rooms: ['kitchen'], help: 'base cabinet depth in inches (24 is standard)' },
  { path: 'backsplash.present', kind: 'boolean', rooms: ['kitchen'], help: 'whether there is a backsplash' },
  { path: 'backsplash.height', kind: 'string', values: ['standard', 'full-height', 'ledge'], rooms: ['kitchen'], help: 'how far the backsplash reaches' },
  { path: 'backsplash.pattern', kind: 'string', values: ['running-bond', 'stacked', 'herringbone', 'slab', 'mosaic', 'hex'], rooms: ['kitchen'], help: 'backsplash tile pattern' },
  { path: 'backsplash.heightIn', kind: 'number', min: 4, max: 120, rooms: ['kitchen'], help: 'how far the splash goes up the wall above the counter, inches (18 under wall cabinets, 4–6 for a ledge, to the sills or the hood mouth where it stops there)' },
  { path: 'countertop.overhangIn', kind: 'number', min: 0.5, max: 3, rooms: ['kitchen'], help: 'how far the perimeter countertop projects past the cabinet doors, inches (1–1.5 standard)' },
  { path: 'appliances[].kind', kind: 'string', values: ['fridge', 'range', 'cooktop', 'wall-oven', 'hood', 'dishwasher', 'microwave', 'wine-fridge'], rooms: ['kitchen'], help: 'what appliance N is' },
  { path: 'appliances[].wall', kind: 'string', values: [...WALLS, 'island'], rooms: ['kitchen'], help: 'which wall appliance N sits on' },
  { path: 'appliances[].t', kind: 'number', min: 0, max: 1, rooms: ['kitchen'], help: 'appliance N position along its wall (0 = left end seen from inside)' },
  { path: 'appliances[].widthIn', kind: 'number', min: 12, max: 60, rooms: ['kitchen'], help: 'appliance N width in inches' },
  { path: 'appliances[].finish', kind: 'string', values: ['stainless', 'black-stainless', 'panel-ready', 'white', 'black', 'matte-black'], rooms: ['kitchen'], help: 'appliance N finish' },
  { path: 'appliances[].hoodStyle', kind: 'string', values: ['chimney', 'under-cabinet', 'custom-insert', 'island', 'none'], rooms: ['kitchen'], help: 'hood style, when appliance N is a hood' },
  { path: 'appliances[].fridgeStyle', kind: 'string', values: ['french-door', 'side-by-side', 'counter-depth', 'built-in', 'top-freezer'], rooms: ['kitchen'], help: 'fridge style, when appliance N is a fridge' },
  { path: 'appliances[].hasDispenser', kind: 'boolean', rooms: ['kitchen'], help: 'true only for a visible fridge-door water/ice dispenser; false when the visible door is plain; leave unknown or hidden doors unchanged' },
  { path: 'appliances[].hoodShape', kind: 'string', values: ['box', 'tapered', 'curved', 'wood-canopy', 'slim'], rooms: ['kitchen'], help: 'hood canopy shape, when appliance N is a hood' },
  { path: 'appliances[].cabinetAbove', kind: 'string', values: ['none', 'doors', 'glass', 'panel'], rooms: ['kitchen'], help: 'what sits on hood N\'s canopy up to the crown: none (bare wall or a narrow duct cover), doors, glass doors, or a plain panel box' },
  { path: 'appliances[].heightIn', kind: 'number', min: 6, max: 120, rooms: ['kitchen'], help: 'body height of appliance N in inches (a fridge; for a hood, its canopy plus its VISIBLE duct cover — to the ceiling, or to the cabinet above it)' },
  { path: 'appliances[].aboveCounterIn', kind: 'number', min: 18, max: 48, rooms: ['kitchen'], help: 'underside of hood N above the counter, inches' },
  { path: 'sink.wall', kind: 'string', values: [...WALLS, 'island'], rooms: ['kitchen'], help: 'which wall the sink is on' },
  { path: 'sink.t', kind: 'number', min: 0, max: 1, rooms: ['kitchen'], help: 'sink position along its wall' },
  { path: 'sink.kind', kind: 'string', values: ['undermount', 'farmhouse', 'drop-in', 'double'], rooms: ['kitchen'], help: 'sink type' },
  { path: 'sink.widthIn', kind: 'number', min: 15, max: 48, rooms: ['kitchen'], help: 'sink width in inches' },
  { path: 'lighting.pendants.count', kind: 'integer', min: 0, max: 12, rooms: ['kitchen'], help: 'number of pendant lights' },
  { path: 'lighting.pendants.style', kind: 'string', values: ['globe', 'cone', 'dome', 'drum', 'lantern', 'linear', 'cage', 'glass'], rooms: ['kitchen'], help: 'pendant shade shape' },
  { path: 'lighting.pendants.spreadFt', kind: 'number', min: 0, max: 16, rooms: ['kitchen'], help: 'span of the pendant row in feet, first to last (0 = automatic)' },
  { path: 'lighting.pendants.offsetFt', kind: 'number', min: -8, max: 8, rooms: ['kitchen'], help: 'shift of the pendant row along the island in feet (+ toward the right end)' },
  { path: 'lighting.pendants.aboveCounterIn', kind: 'number', min: 0, max: 60, rooms: ['kitchen'], help: 'bottom of the pendant shades above the counter, inches (0 = automatic)' },

  // ---- bathroom
  { path: 'vanity.present', kind: 'boolean', rooms: ['bathroom'], help: 'whether there is a vanity' },
  { path: 'vanity.wall', kind: 'string', values: WALLS, rooms: ['bathroom'], help: 'which wall the vanity is on' },
  { path: 'vanity.t', kind: 'number', min: 0, max: 1, rooms: ['bathroom'], help: 'vanity position along its wall' },
  { path: 'vanity.widthIn', kind: 'number', min: 18, max: 120, rooms: ['bathroom'], help: 'vanity width in inches' },
  { path: 'vanity.sinks', kind: 'integer', min: 1, max: 2, rooms: ['bathroom'], help: 'number of basins' },
  { path: 'vanity.style', kind: 'string', values: ['floating', 'freestanding', 'furniture', 'pedestal', 'console'], rooms: ['bathroom'], help: 'vanity style' },
  { path: 'vanity.mirror', kind: 'string', values: ['single', 'double', 'full-width', 'medicine-cabinet', 'none'], rooms: ['bathroom'], help: 'mirror type' },
  { path: 'vanity.doorStyle', kind: 'string', values: ['shaker', 'flat', 'raised', 'slab', 'beaded', 'glass', 'open'], rooms: ['bathroom'], help: 'vanity door style' },
  { path: 'shower.present', kind: 'boolean', rooms: ['bathroom'], help: 'whether there is a shower' },
  { path: 'shower.wall', kind: 'string', values: WALLS, rooms: ['bathroom'], help: 'which wall the shower is on' },
  { path: 'shower.t', kind: 'number', min: 0, max: 1, rooms: ['bathroom'], help: 'shower position along its wall' },
  { path: 'shower.widthIn', kind: 'number', min: 30, max: 120, rooms: ['bathroom'], help: 'shower width in inches' },
  { path: 'shower.depthIn', kind: 'number', min: 30, max: 96, rooms: ['bathroom'], help: 'shower depth in inches' },
  { path: 'shower.enclosure', kind: 'string', values: ['frameless-glass', 'framed-glass', 'curtain', 'open', 'tub-shower'], rooms: ['bathroom'], help: 'shower enclosure type' },
  { path: 'shower.niche', kind: 'boolean', rooms: ['bathroom'], help: 'recessed niche in the shower wall' },
  { path: 'shower.bench', kind: 'boolean', rooms: ['bathroom'], help: 'built-in bench in the shower' },
  { path: 'tub.present', kind: 'boolean', rooms: ['bathroom'], help: 'whether there is a tub' },
  { path: 'tub.wall', kind: 'string', values: WALLS, rooms: ['bathroom'], help: 'which wall the tub is on' },
  { path: 'tub.t', kind: 'number', min: 0, max: 1, rooms: ['bathroom'], help: 'tub position along its wall' },
  { path: 'tub.kind', kind: 'string', values: ['alcove', 'freestanding', 'drop-in', 'clawfoot', 'corner'], rooms: ['bathroom'], help: 'tub type' },
  { path: 'tub.lengthIn', kind: 'number', min: 48, max: 84, rooms: ['bathroom'], help: 'tub length in inches' },
  { path: 'toilet.present', kind: 'boolean', rooms: ['bathroom'], help: 'whether a toilet is visible' },
  { path: 'toilet.wall', kind: 'string', values: WALLS, rooms: ['bathroom'], help: 'which wall the toilet is on' },
  { path: 'toilet.t', kind: 'number', min: 0, max: 1, rooms: ['bathroom'], help: 'toilet position along its wall' },
  { path: 'wallTile.height', kind: 'string', values: ['none', 'wainscot', 'shower-only', 'full', 'accent-wall'], rooms: ['bathroom'], help: 'how far wall tile reaches' },
  // ---- the bathroom's own detail. Every one of these is a thing a bathroom
  // PHOTOGRAPH plainly shows and the spec could not hold until now, which is
  // why the accuracy pass could never fix a bathroom: there was nothing to
  // move. `null` on any of them still means "let the scene decide".
  { path: 'wallTile.heightIn', kind: 'number', min: 6, max: 240, rooms: ['bathroom'], help: 'where the field tile STOPS above the floor, inches (a wainscot 42, a half wall 48, a tub surround 60). Read it against the 36in vanity top and the 80in door' },
  { path: 'wallTile.pattern', kind: 'string', values: TILE_PATTERNS, rooms: ['bathroom'], help: 'how the wall tile is laid — stacked (joints line up), running-bond (offset like brick), vertical-stack (tiles on end), herringbone, chevron, basketweave, hex, penny, mosaic, large-format, slab (no joints at all)' },
  { path: 'wallTile.groutWidthIn', kind: 'number', min: 0, max: 0.75, rooms: ['bathroom'], help: 'grout joint width in inches (1/16 = 0.0625 is a tight modern joint, 1/8 = 0.125 standard, 1/4 = 0.25 a handmade zellige)' },
  { path: 'wallTile.trim', kind: 'string', values: ['none', 'bullnose', 'pencil', 'chair-rail', 'metal-edge'], rooms: ['bathroom'], help: 'the cap at the TOP of a wainscot run: bullnose (a rounded tile edge), pencil (a slim round moulding), chair-rail (a wide profile), metal-edge (a Schluter strip), none (a raw edge or a full-height wall)' },
  { path: 'wallTile.showerPattern', kind: 'string', values: TILE_PATTERNS, rooms: ['bathroom'], help: 'the SHOWER\'s own tile layout when it differs from the rest of the room; leave it alone when the shower is tiled like the walls' },
  { path: 'wallTile.accent.wall', kind: 'string', values: WALLS, rooms: ['bathroom'], help: 'which single wall carries a different tile from the rest (the wall behind a freestanding tub, the vanity wall)' },
  { path: 'wallTile.accent.pattern', kind: 'string', values: TILE_PATTERNS, rooms: ['bathroom'], help: 'how that accent wall is laid' },
  { path: 'wallTile.accent.heightIn', kind: 'number', min: 12, max: 240, rooms: ['bathroom'], help: 'where the accent wall\'s tile stops above the floor, inches' },
  { path: 'wallTile.accent.colorHex', kind: 'hex', rooms: ['bathroom'], help: 'the accent tile\'s own colour in NEUTRAL daylight, #RRGGBB' },
  { path: 'vanity.drawers', kind: 'integer', min: 0, max: 12, rooms: ['bathroom'], help: 'drawer stacks across the vanity front — COUNT THE HANDLES: a 60in double vanity is usually two doors flanking three drawers, or four drawers' },
  { path: 'vanity.doors', kind: 'integer', min: 0, max: 8, rooms: ['bathroom'], help: 'hinged doors across the vanity front (count them the same way)' },
  { path: 'vanity.legStyle', kind: 'string', values: ['none', 'tapered', 'turned', 'square', 'hairpin', 'plinth'], rooms: ['bathroom'], help: 'how the vanity meets the floor: none (a toe kick), tapered / turned / square / hairpin legs with floor showing under them, plinth (a solid base to the floor). A FLOATING vanity has none' },
  { path: 'vanity.counterThicknessIn', kind: 'number', min: 0.5, max: 6, rooms: ['bathroom'], help: 'vanity-top thickness in inches — read it against the 3/4in door reveal (a 1.25in quartz slab, a 3in mitred waterfall edge)' },
  { path: 'vanity.backsplash', kind: 'string', values: ['none', 'standard', 'full-height', 'integrated'], rooms: ['bathroom'], help: 'the splash at the back of the vanity top: none (the wall meets the top), standard (a 4in upstand), full-height (a slab to the mirror), integrated (the top curves up in one piece)' },
  { path: 'vanity.heightIn', kind: 'number', min: 24, max: 42, rooms: ['bathroom'], help: 'the vanity TOP above the finished floor, inches — 30–32 is a vintage height, 34–36 comfort height. Read it against the 80in door' },
  { path: 'vanity.depthIn', kind: 'number', min: 12, max: 30, rooms: ['bathroom'], help: 'vanity cabinet depth in inches (18 shallow, 21 standard, 24 kitchen-depth)' },
  { path: 'vanity.basin', kind: 'string', values: ['undermount', 'integrated', 'vessel', 'semi-recessed', 'drop-in'], rooms: ['bathroom'], help: 'how the basin meets the top: undermount (no rim showing), integrated (one piece with the top), vessel (a bowl STANDING on the top), semi-recessed (half proud of the front), drop-in (a rim sitting on the top)' },
  { path: 'vanity.faucetMount', kind: 'string', values: ['deck', 'wall', 'widespread', 'centerset', 'single-hole'], rooms: ['bathroom'], help: 'where the tap comes from: wall (out of the wall or the mirror), widespread (three separate pieces), centerset (one plate, 4in), single-hole (one body), deck (on the top, unspecified)' },
  { path: 'vanity.hardware', kind: 'string', values: ['pulls', 'knobs', 'mixed', 'integrated', 'none'], rooms: ['bathroom'], help: 'the vanity fronts\' hardware — integrated means a routed finger pull with nothing to see' },
  { path: 'vanity.openShelf', kind: 'boolean', rooms: ['bathroom'], help: 'whether a FLOATING vanity has an open shelf or towel bar under the cabinet' },
  { path: 'shower.glassThicknessIn', kind: 'number', min: 0.12, max: 0.75, rooms: ['bathroom'], help: 'shower glass thickness in inches — 0.375 (3/8) is heavy true frameless, 0.5 (1/2) a thick slab panel, 0.25 (1/4) a framed or sliding panel. Read it off the exposed edge at the door' },
  { path: 'shower.doorType', kind: 'string', values: ['hinged', 'sliding', 'barn', 'pivot', 'fixed-panel', 'walk-in', 'none'], rooms: ['bathroom'], help: 'what opens: hinged (a door on hinges), sliding (runs on a bottom track), barn (a top rail and rollers), pivot, fixed-panel (one panel, no door), walk-in (an open return, nothing to open), none (a curtain or an open wet room)' },
  { path: 'shower.hardwareFinish', kind: 'string', values: FIXTURE_FINISHES, rooms: ['bathroom'], help: 'the metal on the shower door and the shower trim, when it differs from the rest of the room\'s fixtures' },
  { path: 'shower.benchStyle', kind: 'string', values: ['corner', 'full-width', 'floating'], rooms: ['bathroom'], help: 'the built-in bench\'s shape: corner (a triangle in one corner), full-width (a bench across the end), floating (a slab cantilevered off the wall)' },
  { path: 'shower.curbHeightIn', kind: 'number', min: 0, max: 12, rooms: ['bathroom'], help: 'the shower curb above the finished floor, inches — 0 for a curbless entry, 4 for a standard tiled curb' },
  { path: 'shower.nicheAt.face', kind: 'string', values: ['back', 'left', 'right'], rooms: ['bathroom'], help: 'which wall of the STALL the niche is cut in: back = the wall opposite the door, left / right as seen standing in the stall facing that back wall' },
  { path: 'shower.nicheAt.t', kind: 'number', min: 0, max: 1, rooms: ['bathroom'], help: 'the niche\'s centre along that face, 0 = left as seen facing it' },
  { path: 'shower.nicheAt.centerIn', kind: 'number', min: 12, max: 96, rooms: ['bathroom'], help: 'the niche\'s centre above the finished floor, inches — a shampoo niche sits 44–52' },
  { path: 'shower.nicheAt.widthIn', kind: 'number', min: 6, max: 60, rooms: ['bathroom'], help: 'niche width in inches (a single 12–14, a shelf-width one 24–36)' },
  { path: 'shower.nicheAt.heightIn', kind: 'number', min: 6, max: 60, rooms: ['bathroom'], help: 'niche height in inches' },
  { path: 'shower.nicheAt.shelves', kind: 'integer', min: 0, max: 4, rooms: ['bathroom'], help: 'shelves inside the niche; 0 = one open box' },
  { path: 'tub.material', kind: 'string', values: ['acrylic', 'cast-iron', 'stone-resin', 'solid-surface', 'copper', 'fiberglass', 'steel', 'wood'], rooms: ['bathroom'], help: 'what the tub is made of — a cast-iron roll-top has a thick rolled rim and a visible foot, an acrylic soaker a thin even wall, stone-resin a matte thick edge' },
  { path: 'tub.fillerType', kind: 'string', values: ['deck-mount', 'wall-mount', 'floor-mount', 'roman', 'tub-shower-diverter'], rooms: ['bathroom'], help: 'how the tub is filled: floor-mount (a freestanding column rising from the floor), wall-mount (a spout out of the wall), deck-mount (on the tub rim or a deck), roman (a wide-spread deck set), tub-shower-diverter (a spout under the shower valve)' },
  { path: 'tub.fillerFinish', kind: 'string', values: FIXTURE_FINISHES, rooms: ['bathroom'], help: 'the tub filler\'s own metal, when it differs from the rest of the fixtures' },
  { path: 'tub.apron', kind: 'string', values: ['integral', 'tiled', 'panel', 'skirted', 'none'], rooms: ['bathroom'], help: 'the tub\'s visible face: integral (the tub\'s own moulded side), tiled (a tiled deck around a drop-in), panel (a removable timber or stone panel), skirted (a factory apron front), none (a clawfoot, nothing to see)' },
  { path: 'tub.widthIn', kind: 'number', min: 24, max: 60, rooms: ['bathroom'], help: 'the tub ACROSS, inches — an alcove tub is 30–32, a freestanding soaker 30–36' },
  { path: 'tub.heightIn', kind: 'number', min: 12, max: 36, rooms: ['bathroom'], help: 'the tub rim above the finished floor, inches — an alcove tub 20–22, a freestanding soaker 23–26' },
  { path: 'toilet.trimFinish', kind: 'string', values: FIXTURE_FINISHES, rooms: ['bathroom'], help: 'the toilet\'s trip lever / seat hinge metal, when it is plainly a different metal from the rest' },
  { path: 'accessories[].kind', kind: 'string', values: ACCESSORY_KINDS, rooms: ['bathroom'], help: 'what wall-mounted accessory N is' },
  { path: 'accessories[].wall', kind: 'string', values: WALLS, rooms: ['bathroom'], help: 'which wall accessory N is screwed to' },
  { path: 'accessories[].t', kind: 'number', min: 0, max: 1, rooms: ['bathroom'], help: 'accessory N\'s centre along its wall, 0 = left as seen facing it' },
  { path: 'accessories[].heightFt', kind: 'number', min: 0.5, max: 8, rooms: ['bathroom'], help: 'accessory N\'s centre above the floor, feet — a towel bar 4.0, a hook 5.4, a paper holder 2.1, a grab bar 3.0' },
  { path: 'accessories[].widthIn', kind: 'number', min: 3, max: 48, rooms: ['bathroom'], help: 'accessory N\'s length in inches (a towel bar 18/24/30, a grab bar 24/36)' },
  { path: 'accessories[].finish', kind: 'string', values: FIXTURE_FINISHES, rooms: ['bathroom'], help: 'accessory N\'s metal, when it differs from the room\'s hardware' },

  // ---- exterior
  { path: 'houseStyle', kind: 'string', values: ['craftsman', 'modern-farmhouse', 'modern', 'colonial', 'ranch', 'cape-cod', 'contemporary', 'mediterranean', 'tudor', 'victorian', 'northwest-contemporary'], rooms: ['exterior'], help: 'architectural style' },
  { path: 'house.footprint.widthFt', kind: 'number', min: 12, max: 150, rooms: ['exterior'], help: 'house width in feet' },
  { path: 'house.footprint.depthFt', kind: 'number', min: 12, max: 150, rooms: ['exterior'], help: 'house depth in feet' },
  { path: 'house.stories', kind: 'integer', min: 1, max: 3, rooms: ['exterior'], help: 'number of storeys' },
  { path: 'house.roof.type', kind: 'string', values: ['gable', 'hip', 'flat', 'shed', 'gambrel', 'dutch-gable', 'cross-gable'], rooms: ['exterior'], help: 'roof type' },
  { path: 'house.roof.pitch', kind: 'number', min: 0, max: 14, rooms: ['exterior'], help: 'roof pitch in /12' },
  { path: 'house.garage.present', kind: 'boolean', rooms: ['exterior'], help: 'whether there is a garage' },
  { path: 'house.garage.bays', kind: 'integer', min: 0, max: 3, rooms: ['exterior'], help: 'garage bays' },
  { path: 'house.porch.present', kind: 'boolean', rooms: ['exterior'], help: 'whether there is a covered porch' },
  { path: 'house.porch.widthFt', kind: 'number', min: 3, max: 60, rooms: ['exterior'], help: 'porch width in feet' },
  { path: 'house.porch.depthFt', kind: 'number', min: 3, max: 20, rooms: ['exterior'], help: 'porch depth in feet' },
  { path: 'house.porch.columns', kind: 'integer', min: 0, max: 12, rooms: ['exterior'], help: 'number of porch columns' },
  { path: 'house.shutters', kind: 'boolean', rooms: ['exterior'], help: 'shutters beside the windows' },
  { path: 'house.chimney', kind: 'boolean', rooms: ['exterior'], help: 'whether there is a chimney' },
  { path: 'lot.widthFt', kind: 'number', min: 20, max: 600, rooms: ['exterior'], help: 'lot width in feet' },
  { path: 'lot.depthFt', kind: 'number', min: 20, max: 600, rooms: ['exterior'], help: 'lot depth in feet' },

  // ---- openings (interiors)
  { path: 'openings[].kind', kind: 'string', values: ['window', 'door', 'passage'], rooms: INTERIOR, help: 'what opening N is' },
  { path: 'openings[].style', kind: 'string', values: ['standard', 'picture', 'bay', 'slider', 'french', 'pocket', 'barn', 'casement', 'double-hung'], rooms: INTERIOR, help: 'window / door style of opening N' },
  { path: 'openings[].wall', kind: 'string', values: WALLS, rooms: INTERIOR, help: 'which wall opening N is on' },
  { path: 'openings[].t', kind: 'number', min: 0, max: 1, rooms: INTERIOR, help: 'opening N position along its wall' },
  { path: 'openings[].widthFt', kind: 'number', min: 0.5, max: 40, rooms: INTERIOR, help: 'opening N width in feet' },
  { path: 'openings[].heightFt', kind: 'number', min: 0.5, max: 20, rooms: INTERIOR, help: 'opening N height in feet' },
  { path: 'openings[].sillFt', kind: 'number', min: 0, max: 12, rooms: INTERIOR, help: 'opening N sill height above the floor in feet' },

  // ---- décor (interiors). Whole elements are added / removed with array
  // operations (below); these tune an element that already exists.
  { path: 'decor.shelves[].wall', kind: 'string', values: WALLS, rooms: INTERIOR, help: 'which wall shelf run N hangs on' },
  { path: 'decor.shelves[].t', kind: 'number', min: 0, max: 1, rooms: INTERIOR, help: 'shelf run N centre along its wall' },
  { path: 'decor.shelves[].widthIn', kind: 'number', min: 12, max: 120, rooms: INTERIOR, help: 'shelf run N width in inches' },
  { path: 'decor.shelves[].count', kind: 'integer', min: 1, max: 5, rooms: INTERIOR, help: 'boards stacked in shelf run N' },
  { path: 'decor.shelves[].bottomFt', kind: 'number', min: 2, max: 9, rooms: INTERIOR, help: 'height of the lowest board of shelf run N, feet' },
  { path: 'decor.shelves[].spacingIn', kind: 'number', min: 8, max: 24, rooms: INTERIOR, help: 'vertical pitch between boards in shelf run N, inches' },
  { path: 'decor.shelves[].depthIn', kind: 'number', min: 6, max: 16, rooms: INTERIOR, help: 'front-to-back depth of shelf run N, inches' },
  { path: 'decor.shelves[].finishColorHex', kind: 'hex', rooms: INTERIOR, help: 'shelf unit N own observed neutral-daylight color, including the mid-tone of its wood' },
  { path: 'decor.shelves[].enclosure.heightIn', kind: 'number', min: 12, max: 120, rooms: INTERIOR, help: 'overall outside height of an OBSERVED open shelf carcass N from its lowest board underside to its top cap; setting this first creates the enclosing sides and top' },
  { path: 'decor.shelves[].enclosure.backPanel', kind: 'boolean', rooms: INTERIOR, help: 'whether shelf carcass N has an observed continuous backing panel; false when the wall is visible through an open back' },
  { path: 'decor.shelves[].enclosure.panelThicknessIn', kind: 'number', min: 0.25, max: 2, rooms: INTERIOR, help: 'visible thickness of shelf carcass N side/top/back panels in inches' },
  { path: 'decor.shelves[].enclosure.rotationDeg', kind: 'integer', numberValues: [-90, 0, 90, 180], rooms: INTERIOR, help: 'quarter-turn of an observed case relative to its mounting wall; 0 faces into the room; +90 turns toward wall-local right, -90 toward wall-local left (left-wall -90 faces room-front); never change the mounting wall merely to turn the opening' },
  { path: 'decor.shelves[].material', kind: 'string', values: ['match-cabinets', 'wood', 'white', 'black', 'match-countertop'], rooms: INTERIOR, help: 'what shelf run N is made of' },
  { path: 'decor.shelves[].styled', kind: 'string', values: ['empty', 'dishes', 'books', 'plants', 'mixed'], rooms: INTERIOR, help: 'what sits on shelf run N' },
  { path: 'decor.plants[].kind', kind: 'string', values: ['floor', 'counter', 'shelf', 'hanging'], rooms: INTERIOR, help: 'where plant N sits' },
  { path: 'decor.plants[].wall', kind: 'string', values: [...WALLS, 'island', 'corner'], rooms: INTERIOR, help: 'which wall / island / corner plant N is at' },
  { path: 'decor.plants[].t', kind: 'number', min: 0, max: 1, rooms: INTERIOR, help: 'plant N position along its wall' },
  { path: 'decor.plants[].sizeFt', kind: 'number', min: 0.3, max: 9, rooms: INTERIOR, help: 'overall height of plant N in feet' },
  { path: 'decor.plants[].form', kind: 'string', values: ['leafy', 'tree', 'trailing', 'herb', 'succulent'], rooms: INTERIOR, help: 'shape of plant N' },
  { path: 'decor.art[].wall', kind: 'string', values: WALLS, rooms: INTERIOR, help: 'which wall art piece N hangs on' },
  { path: 'decor.art[].t', kind: 'number', min: 0, max: 1, rooms: INTERIOR, help: 'art piece N centre along its wall' },
  { path: 'decor.art[].widthIn', kind: 'number', min: 6, max: 96, rooms: INTERIOR, help: 'art piece N width in inches' },
  { path: 'decor.art[].heightIn', kind: 'number', min: 6, max: 96, rooms: INTERIOR, help: 'art piece N height in inches' },
  { path: 'decor.art[].centerFt', kind: 'number', min: 2, max: 9, rooms: INTERIOR, help: 'art piece N centre height above the floor, feet' },
  { path: 'decor.art[].frame', kind: 'string', values: ['black', 'wood', 'white', 'none'], rooms: INTERIOR, help: 'frame of art piece N' },
  // The stools are the whole route a photo's leather has into the twin —
  // there is no FinishObservation slot for them — so the accuracy pass has to
  // be able to correct them; without these two the first analysis was the only
  // chance. Both paths are index-free, so the one-index path grammar reaches
  // them. `decor.stools` itself is null when the photo has no stools, and a
  // write under a null parent is dropped and reported: an accuracy pass can
  // recolour the stools it was given, never invent a set.
  { path: 'decor.stools.seatShape', kind: 'string', values: ['round', 'square'], rooms: ['kitchen'], help: 'plan shape of the stool SEAT PAD: square for a straight-sided cushion, round for a disc or saddle' },
  { path: 'decor.stools.seatColorHex', kind: 'hex', rooms: ['kitchen'], help: 'the stool seat\'s own colour in neutral daylight as #RRGGBB (dark chocolate leather is #5A3B2A, not tan)' },
  { path: 'decor.rug.present', kind: 'boolean', rooms: INTERIOR, help: 'whether there is a rug on the floor' },
  { path: 'decor.rug.lengthFt', kind: 'number', min: 2, max: 14, rooms: INTERIOR, help: 'rug length in feet' },
  { path: 'decor.rug.widthFt', kind: 'number', min: 1.5, max: 10, rooms: INTERIOR, help: 'rug width in feet' },
  { path: 'decor.rug.style', kind: 'string', values: ['runner', 'area', 'round'], rooms: INTERIOR, help: 'rug shape' },
  { path: 'decor.windowTreatment', kind: 'string', values: ['none', 'roman-shade', 'roller', 'curtains', 'blinds', 'cafe-curtain'], rooms: INTERIOR, help: 'what covers the windows' },
  { path: 'decor.counterStyling', kind: 'string', values: ['none', 'minimal', 'lived-in'], rooms: INTERIOR, help: 'how much everyday clutter the counters carry' },

  // ---- the detail layer. `label` and `colorHex` are free strings with no
  // values list, so they are not tunable here — they change by remove + add.
  { path: 'decor.items[].kind', kind: 'string', values: ITEM_KINDS, rooms: INTERIOR, help: 'what counter item N is' },
  { path: 'decor.items[].on', kind: 'string', values: ITEM_HOSTS, rooms: INTERIOR, help: 'what item N stands on' },
  { path: 'decor.items[].wall', kind: 'string', values: [...WALLS, 'island'], rooms: INTERIOR, help: 'the wall of the surface item N stands on' },
  { path: 'decor.items[].t', kind: 'number', min: 0, max: 1, rooms: INTERIOR, help: 'item N centre along its wall (0 = left end seen facing it)' },
  { path: 'decor.items[].depthT', kind: 'number', min: 0, max: 1, rooms: INTERIOR, help: 'item N across the counter: 0 = against the splash, 1 = at the front edge' },
  { path: 'decor.items[].shelfIndex', kind: 'integer', min: 0, max: 4, rooms: INTERIOR, help: 'which shelf board item N stands on, 0 = the lowest' },
  { path: 'decor.items[].burner', kind: 'string', values: BURNERS, rooms: ['kitchen'], help: 'which burner item N stands on' },
  { path: 'decor.items[].sizeIn', kind: 'number', min: 1, max: 40, rooms: INTERIOR, help: 'item N\'s longest dimension in inches' },
  { path: 'decor.items[].material', kind: 'string', values: ITEM_MATERIALS, rooms: INTERIOR, help: 'what item N is made of' },
  { path: 'decor.items[].count', kind: 'integer', min: 1, max: 12, rooms: INTERIOR, help: 'identical things in item N\'s row or stack' },
  { path: 'decor.cabinetContents[].wall', kind: 'string', values: WALLS, rooms: ['kitchen'], help: 'which wall the glass cabinet in entry N is on' },
  { path: 'decor.cabinetContents[].t', kind: 'number', min: 0, max: 1, rooms: ['kitchen'], help: 'that cabinet\'s centre along its wall' },
  { path: 'decor.cabinetContents[].kind', kind: 'string', values: CONTENT_KINDS, rooms: ['kitchen'], help: 'what shows behind the glass in entry N' },
  { path: 'decor.cabinetContents[].density', kind: 'string', values: ['sparse', 'full'], rooms: ['kitchen'], help: 'how crowded those shelves are' },
] as const;

export const refinableFor = (roomType: RoomType) => REFINABLE.filter((f) => f.rooms.includes(roomType));

/**
 * Objects that are `null` when absent. A "set decor.rug.present = true" on a
 * spec with no rug has nowhere to land, so the parent is seeded with an
 * "absent" default first and the edit then applies on top of it (the seed
 * must not already satisfy the edit, or it would be dropped as a no-op).
 */
const NULLABLE_PARENTS: Record<string, () => Record<string, unknown>> = {
  'decor.rug': () => ({ present: false, lengthFt: 5, widthFt: 3, style: 'area' }),
  'lighting.pendants': () => ({ count: 0, style: 'globe', finish: 'black', spreadFt: 0, offsetFt: 0, aboveCounterIn: 0, positions: null }),
  // The two bathroom objects that are null when nobody has said where the
  // thing is. Seeded so a "the niche is on the left wall" correction has
  // somewhere to land; the seed must not already satisfy the edit, which is
  // why the niche seeds on the BACK face and the accent on the BACK wall.
  'shower.nicheAt': () => ({ face: 'back', t: 0.5, centerIn: 48, widthIn: 24, heightIn: 14, shelves: 0 }),
  'wallTile.accent': () => ({ wall: 'back', pattern: 'stacked', moduleIn: null, heightIn: null, colorHex: null }),
};

// ---------------------------------------------------------------------------
// Array operations — whole elements the model may add or remove.
// ---------------------------------------------------------------------------

interface ArrayDef {
  path: string;
  schema: z.ZodType;
  /** hard cap on the array after an add; mirrors the DecorZ / room limits */
  max: number;
  rooms: readonly RoomType[];
  help: string;
}

/** An interior room has windows, doors and passages — a garage door is an exterior thing and must not be addable here. */
const InteriorOpeningZ = OpeningZ.extend({ kind: z.enum(['window', 'door', 'passage']) });

export const REFINABLE_ARRAYS: readonly ArrayDef[] = [
  { path: 'decor.shelves', schema: OpenShelfZ, max: 6, rooms: INTERIOR, help: 'floating boards or an observed open display shelf carcass; enclosure null means floating, enclosure.heightIn/backPanel describes visible sides/top/back; lowest board is the base, count excludes the top cap' },
  { path: 'decor.plants', schema: PlantZ, max: 8, rooms: INTERIOR, help: 'a plant (floor, counter, shelf or hanging)' },
  { path: 'decor.art', schema: WallArtZ, max: 6, rooms: INTERIOR, help: 'a framed picture on a wall' },
  { path: 'openings', schema: InteriorOpeningZ, max: 12, rooms: INTERIOR, help: 'a window, door or passage' },
  { path: 'appliances', schema: ApplianceZ, max: 12, rooms: ['kitchen'], help: 'an appliance' },
  // a run per wall: the way to put a corner fridge on a side wall that has no cabinets yet (the wall must be free — extend an existing run instead of adding a second one)
  { path: 'runs', schema: CabinetRunZ, max: 4, rooms: ['kitchen'], help: 'a cabinet run on a wall that has none yet: start / lengthFt along that wall, base and upper cabinets LEFT→RIGHT (appliance-gap only for full-height appliances; preserve drawers/doors below a drop-in cooktop), tall units (fridge-surround / pantry / oven-tower) as [start fraction of the run, widthIn]' },
  { path: 'decor.items', schema: DecorItemZ, max: 24, rooms: INTERIOR, help: 'a small object standing on a counter, the range, the island, a shelf, a window sill or the floor — in a bathroom the vanity top is the "counter"' },
  { path: 'accessories', schema: BathAccessoryZ, max: 10, rooms: ['bathroom'], help: 'a wall-mounted accessory: a towel bar, a towel ring, a hook, a grab bar, the paper holder' },
  { path: 'decor.cabinetContents', schema: CabinetContentsZ, max: 10, rooms: ['kitchen'], help: 'what shows behind one glass-front or open wall cabinet' },
  { path: 'lighting.pendants.positions', schema: PendantPositionZ, max: 6, rooms: ['kitchen'], help: 'one pendant hook: feet from island centre; without island, from wall sink (along faces right, across toward room); without either, from room centre' },
] as const;

export const refinableArraysFor = (roomType: RoomType) => REFINABLE_ARRAYS.filter((a) => a.rooms.includes(roomType));

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type RefineOp = 'set' | 'add' | 'remove';
export type RefinePass = 'geometry' | 'finishes';

export interface Correction {
  op: RefineOp;
  field: string;
  index: number | null;
  from: unknown;
  to: unknown;
  reason: string;
  confidence: number;
  applied: boolean;
  rejected?: string;
}

export interface ApplyResult {
  spec: RoomSpec;
  corrections: Correction[];
  /** things the model saw that it could not express as an edit */
  notes: string[];
  /** 0..1 — how well the model thinks the twin now matches the photo */
  match: number;
  /** finish observations that were accepted and applied to `materials` */
  finishes: FinishObservation[];
  /** finish observations that were dropped, and why */
  rejectedFinishes: Array<{ slot: string; reason: string }>;
  changed: boolean;
}

export interface RefineResult extends ApplyResult {
  model: string;
  elapsedMs: number;
  /** mean IoU the photo fitter reached after the corrections (null when the spec has no photo inventory) */
  fitScore: number | null;
  /** the camera the fitter solved (also on `spec.detected.camera.solved`); null when no fit ran */
  camera: SolvedCamera | null;
  /** the re-fit's per-element gaps — what the next round is asked to close, and what the match report shows */
  residuals: FitResidual[];
  /** photo elements the twin does not draw, in words */
  hints: string[];
  unmatchedPhoto: FitResult['unmatchedPhoto'];
  /** matched photo elements ÷ scored photo elements after the re-fit; null when no fit ran */
  coverage: number | null;
}

interface RawEdit {
  op?: unknown;
  field?: unknown;
  index?: unknown;
  value_number?: unknown;
  value_string?: unknown;
  value_boolean?: unknown;
  value_element?: unknown;
  reason?: unknown;
  confidence?: unknown;
}

/** What the model returns, before any of it is trusted. */
export interface ModelOutput {
  corrections?: unknown;
  notes?: unknown;
  match?: unknown;
  finishes?: unknown;
}

export interface ApplyOptions {
  /** edits below this confidence are reported but not applied; NaN / out of range fall back to the default */
  minConfidence?: number;
  /** most edits considered from one response */
  maxEdits?: number;
  /** which comparisons this response came from: geometry edits are refused in a finishes-only pass and vice versa */
  passes?: readonly RefinePass[];
}

const DEFAULT_MIN_CONFIDENCE = 0.45;
/** the server never applies an edit the model itself rated below this, whatever the client asked for */
export const SERVER_MIN_CONFIDENCE = 0.2;

/** A usable confidence floor from whatever the caller passed. */
export function sanitizeMinConfidence(raw: unknown, floor = 0): number {
  const v = typeof raw === 'number' && Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : DEFAULT_MIN_CONFIDENCE;
  return Math.max(floor, v);
}

// ---------------------------------------------------------------------------
// Path handling
// ---------------------------------------------------------------------------

function readPath(obj: unknown, path: string, index: number | null): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    if (part.endsWith('[]')) {
      const arr = (cur as Record<string, unknown>)[part.slice(0, -2)];
      if (!Array.isArray(arr) || index === null || index < 0 || index >= arr.length) return undefined;
      cur = arr[index];
    } else {
      cur = (cur as Record<string, unknown>)[part];
    }
  }
  return cur;
}

/** Immutably set a value at an allowlisted path. Returns null when the path does not exist. */
function writePath<T>(obj: T, path: string, index: number | null, value: unknown): T | null {
  const parts = path.split('.');
  const clone = (node: unknown, depth: number): unknown => {
    if (depth === parts.length) return value;
    const part = parts[depth];
    if (node === null || typeof node !== 'object') return undefined;
    if (part.endsWith('[]')) {
      const key = part.slice(0, -2);
      const arr = (node as Record<string, unknown>)[key];
      if (!Array.isArray(arr) || index === null || index < 0 || index >= arr.length) return undefined;
      const next = clone(arr[index], depth + 1);
      if (next === undefined) return undefined;
      const copy = arr.slice();
      copy[index] = next;
      return { ...(node as Record<string, unknown>), [key]: copy };
    }
    if (!(part in (node as Record<string, unknown>))) return undefined;
    const next = clone((node as Record<string, unknown>)[part], depth + 1);
    if (next === undefined) return undefined;
    return { ...(node as Record<string, unknown>), [part]: next };
  };
  const out = clone(obj, 0);
  return out === undefined ? null : (out as T);
}

/** If `path` sits under a nullable parent that is currently null, return the spec with that parent seeded. */
function seedNullableParent<T>(obj: T, path: string): T | null {
  const parent = Object.keys(NULLABLE_PARENTS).find((p) => path.startsWith(`${p}.`));
  if (!parent) return null;
  if (readPath(obj, parent, null) !== null) return null;
  return writePath(obj, parent, null, NULLABLE_PARENTS[parent]());
}

/** Coerce and range-check a proposed scalar against its field definition. */
function coerce(def: FieldDef, edit: RawEdit): { ok: true; value: unknown } | { ok: false; why: string } {
  if (def.kind === 'boolean') {
    const v = edit.value_boolean;
    if (typeof v !== 'boolean') return { ok: false, why: 'expected a boolean' };
    return { ok: true, value: v };
  }
  if (def.kind === 'string') {
    const v = edit.value_string;
    if (typeof v !== 'string') return { ok: false, why: 'expected a string' };
    if (def.values && !def.values.includes(v)) return { ok: false, why: `"${v}" is not one of ${def.values.join(', ')}` };
    return { ok: true, value: v };
  }
  if (def.kind === 'hex') {
    const v = parseHex(edit.value_string);
    if (v === null) return { ok: false, why: 'expected a colour as #RRGGBB' };
    return { ok: true, value: v };
  }
  const raw = edit.value_number;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return { ok: false, why: 'expected a number' };
  let v = raw;
  if (def.kind === 'integer') v = Math.round(v);
  if (def.numberValues && !def.numberValues.includes(v)) return { ok: false, why: `${v} is not one of ${def.numberValues.join(', ')}` };
  if (def.min !== undefined && v < def.min) return { ok: false, why: `below the minimum ${def.min}` };
  if (def.max !== undefined && v > def.max) return { ok: false, why: `above the maximum ${def.max}` };
  return { ok: true, value: v };
}

const same = (a: unknown, b: unknown) =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : a === b;

/**
 * A missing nullable field on an added element means "none", not "invalid":
 * the strict schema makes the model spell out every key, but a non-strict
 * retry or an older client may leave `hoodShape` off a wine fridge, and
 * dropping the whole appliance for that would be perverse. Fills every
 * key the element schema accepts as null that the element does not carry.
 */
function fillNullable(schema: z.ZodType, element: unknown): unknown {
  if (!element || typeof element !== 'object' || Array.isArray(element)) return element;
  if (!(schema instanceof z.ZodObject)) return element;
  const out: Record<string, unknown> = { ...(element as Record<string, unknown>) };
  for (const [key, sub] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
    if (key in out) continue;
    if (sub.safeParse(null).success) out[key] = null;
  }
  return out;
}

/** Deterministic id for an added opening: `window-3` when two windows already exist, skipping any clash. */
function nextOpeningId(kind: string, existing: Array<{ id?: unknown }>): string {
  const taken = new Set(existing.map((o) => String(o.id ?? '')));
  let n = existing.length + 1;
  while (taken.has(`${kind}-${n}`)) n++;
  return `${kind}-${n}`;
}

/** Deterministic id for an added run: the model's own when it is new, else `run-<wall>`, `run-<wall>-2`, … */
function nextRunId(wall: string, given: string, existing: Array<{ id?: unknown }>): string {
  const taken = new Set(existing.map((r) => String(r.id ?? '')));
  const want = given.trim();
  if (want && !taken.has(want)) return want;
  let id = `run-${wall || 'wall'}`;
  for (let n = 2; taken.has(id); n++) id = `run-${wall || 'wall'}-${n}`;
  return id;
}

/**
 * Whether an added element makes sense in THIS room, beyond its own schema:
 * a shelf whose top board would be in the ceiling, a counter plant on a wall
 * with no counter, a shelf plant with no shelf to sit on. Returns the reason
 * it does not, or null.
 */
function roomRejects(spec: RoomSpec, path: string, element: Record<string, unknown>): string | null {
  if (!isSingleRoom(spec)) return null;
  const ceilingFt = spec.dims.ceilingFt;
  if (path === 'decor.shelves') {
    const enclosure = element.enclosure as { heightIn?: number; panelThicknessIn?: number | null } | null | undefined;
    if (enclosure) {
      const caseTop = Number(element.bottomFt ?? 0) + Number(enclosure.heightIn ?? 0) / 12;
      if (!Number.isFinite(caseTop) || caseTop > ceilingFt) return 'the shelf enclosure would extend above the ceiling';
    }
    const count = Number(element.count ?? 1);
    const top = Number(element.bottomFt ?? 0) + (Math.max(1, count) - 1) * Number(element.spacingIn ?? 12) / 12 + 0.75 / 12;
    if (!Number.isFinite(top) || top > ceilingFt - 0.25) return `the top board would be at ${Math.round(top * 10) / 10} ft, above the ${ceilingFt} ft ceiling`;
    return null;
  }
  if (path === 'decor.plants') {
    const wall = String(element.wall ?? '');
    if (element.kind === 'counter') {
      const hasCounter = spec.roomType === 'kitchen'
        ? wall === 'island' ? spec.island.present : spec.runs.some((r) => r.wall === wall)
        : spec.vanity.present && spec.vanity.wall === wall;
      if (!hasCounter) return `no counter on the ${wall} for a counter plant`;
    }
    if (element.kind === 'shelf' && !spec.decor.shelves.length) return 'no open shelf for a shelf plant to sit on';
    return null;
  }
  if (path === 'decor.items') {
    const on = String(element.on ?? 'counter');
    const wall = String(element.wall ?? '');
    if (on === 'range') {
      const cooker = spec.roomType === 'kitchen' && spec.appliances.some((a) => (a.kind === 'range' || a.kind === 'cooktop') && a.wall !== 'island');
      if (!cooker) return 'no range or cooktop for an item to stand on';
    }
    if (on === 'island' && !(spec.roomType === 'kitchen' && spec.island.present)) return 'no island for an island item';
    if (on === 'shelf' && !spec.decor.shelves.length) return 'no open shelf for a shelf item';
    if (on === 'sill' && !spec.openings.some((o) => o.kind === 'window')) return 'no window sill for a sill item';
    if (on === 'counter' && wall && wall !== 'island') {
      const hasRun = spec.roomType === 'kitchen' ? spec.runs.some((r) => r.wall === wall) : spec.vanity.present && spec.vanity.wall === wall;
      if (!hasRun) return `no counter on the ${wall} wall for a counter item`;
    }
    return null;
  }
  if (path === 'decor.cabinetContents') {
    const wall = String(element.wall ?? '');
    const hasUppers = spec.roomType === 'kitchen' && spec.runs.some((r) => r.wall === wall && r.hasUppers);
    if (!hasUppers) return `no wall cabinets on the ${wall} wall`;
    return null;
  }
  return null;
}

/** Does a value read back from the reconciled spec still honour an applied edit? Numbers may be clamped by the reconciler; an edit "holds" as long as the spec ended closer to the request than it started. */
function stillHolds(from: unknown, to: unknown, after: unknown): boolean {
  if (typeof to === 'number') {
    if (typeof after !== 'number' || !Number.isFinite(after)) return false;
    if (Math.abs(after - to) <= 1e-6 + 0.01 * Math.abs(to)) return true;
    return typeof from === 'number' && Math.abs(after - to) < Math.abs(from - to) - 1e-9;
  }
  return after === to;
}

// ---------------------------------------------------------------------------
// applyCorrections — pure. (spec, model output) → corrected spec + audit trail.
// ---------------------------------------------------------------------------

export function applyCorrections(spec: RoomSpec, output: ModelOutput | null | undefined, opts: ApplyOptions = {}): ApplyResult {
  const roomType = spec.roomType;
  const locked = confirmedDimensions(spec);
  const minConfidence = sanitizeMinConfidence(opts.minConfidence);
  const maxEdits = opts.maxEdits ?? 60;
  const passes: readonly RefinePass[] = opts.passes?.length ? opts.passes : ['geometry', 'finishes'];
  const geometryPass = passes.includes('geometry');
  const finishesPass = passes.includes('finishes');
  /** how long each editable array should be once every applied add / remove is honoured */
  const expectedLength = new Map<string, number>();
  const byPath = new Map(refinableFor(roomType).map((f) => [f.path, f]));
  const arrays = new Map(refinableArraysFor(roomType).map((a) => [a.path, a]));

  const rawEdits = Array.isArray(output?.corrections) ? (output!.corrections as RawEdit[]) : [];
  const notes = Array.isArray(output?.notes) ? (output!.notes as unknown[]).filter((n): n is string => typeof n === 'string').slice(0, 12) : [];
  const match = typeof output?.match === 'number' && Number.isFinite(output.match) ? Math.min(1, Math.max(0, output.match)) : 0.5;
  const rawFinishes = Array.isArray(output?.finishes) ? (output!.finishes as unknown[]) : [];

  const corrections: Correction[] = [];
  let working = spec;

  for (const edit of rawEdits.slice(0, maxEdits)) {
    if (!edit || typeof edit !== 'object') continue;
    const field = typeof edit.field === 'string' ? edit.field.trim() : '';
    const op: RefineOp = edit.op === 'add' || edit.op === 'remove' ? edit.op : 'set';
    const confidence = typeof edit.confidence === 'number' && Number.isFinite(edit.confidence) ? Math.min(1, Math.max(0, edit.confidence)) : 0;
    const reason = typeof edit.reason === 'string' ? edit.reason.slice(0, 240) : '';
    const index = typeof edit.index === 'number' && Number.isInteger(edit.index) ? edit.index : null;

    const record = (to: unknown, from: unknown, applied: boolean, rejected?: string) =>
      corrections.push({ op, field, index, from, to, reason, confidence, applied, rejected });

    // Every op shares the same gate: allowlisted target, confident enough, and
    // the patched spec still parses. Only the middle differs per op.
    let next: RoomSpec | null = null;
    let from: unknown;
    let to: unknown;

    // a finishes-only pass was told to return no corrections; anything it sends anyway is not trusted
    if (!geometryPass) { record(undefined, undefined, false, 'not part of this pass'); continue; }

    if (op === 'set') {
      const def = byPath.get(field);
      if (!def) { record(undefined, undefined, false, 'field is not editable'); continue; }
      if (field.startsWith('dims.') && locked[field.slice(5) as keyof typeof locked] !== undefined) {
        record(undefined, readPath(working, field, index), false, 'confirmed measurement is locked');
        continue;
      }
      if (field.includes('[]') && index === null) { record(undefined, undefined, false, 'array field needs an index'); continue; }

      const checked = coerce(def, edit);
      if (!checked.ok) { record(undefined, undefined, false, checked.why); continue; }
      to = checked.value;

      if (def.path === 'appliances[].hasDispenser' && (working.roomType !== 'kitchen' || index === null || working.appliances[index]?.kind !== 'fridge')) {
        record(to, readPath(working, def.path, index), false, 'only a fridge can have a door dispenser');
        continue;
      }

      // two runs on one wall would be drawn through each other; a run moves to a wall only when that wall is free
      if (def.path === 'runs[].wall' && working.roomType === 'kitchen' && working.runs.some((r, i) => i !== index && r.wall === to)) {
        record(to, readPath(working, def.path, index), false, `a run already sits on the ${String(to)} wall`);
        continue;
      }
      // a photographer cannot face the wall at their back: "standing front,
      // looking at the front wall" puts the whole room behind the lens
      if (def.path === 'detected.camera.lookingAt') {
        const position = working.detected.camera.position;
        const behind = STAND_WALL[position];
        if (behind && behind === to) {
          record(to, working.detected.camera.lookingAt, false, `a camera standing ${position} has the ${behind} wall at its back`);
          continue;
        }
      }

      let base: RoomSpec = working;
      from = readPath(base, def.path, index);
      if (from === undefined && def.path === 'appliances[].hasDispenser' && base.roomType === 'kitchen') {
        // Older saved specs have no field; an observed correction can add it.
        base = { ...base, appliances: base.appliances.map((a, i) => i === index ? { ...a, hasDispenser: null } : a) };
        from = null;
      }
      if (from === undefined && def.path === 'runs[].upperBottomIn' && base.roomType === 'kitchen') {
        base = { ...base, runs: base.runs.map((r, i) => i === index ? { ...r, upperBottomIn: null } : r) };
        from = null;
      }
      if (from === undefined && def.path === 'decor.shelves[].finishColorHex' && isSingleRoom(base)) {
        base = { ...base, decor: { ...base.decor, shelves: base.decor.shelves.map((s, i) => i === index ? { ...s, finishColorHex: null } : s) } };
        from = null;
      }
      if (from === undefined && def.path === 'decor.shelves[].enclosure.heightIn' && isSingleRoom(base)) {
        // Height is the evidence that establishes a case. A backing-only edit
        // cannot invent enclosing sides/top around unobserved floating boards.
        base = { ...base, decor: { ...base.decor, shelves: base.decor.shelves.map((s, i) => i === index ? { ...s, enclosure: { heightIn: 0, backPanel: false, panelThicknessIn: null, rotationDeg: null } } : s) } };
        from = 0;
      }
      if (from === undefined && def.path === 'decor.shelves[].enclosure.panelThicknessIn' && isSingleRoom(base) && index !== null && base.decor.shelves[index]?.enclosure) {
        base = { ...base, decor: { ...base.decor, shelves: base.decor.shelves.map((s, i) => i === index && s.enclosure ? { ...s, enclosure: { ...s.enclosure, panelThicknessIn: null } } : s) } };
        from = null;
      }
      if (from === undefined && def.path === 'decor.shelves[].enclosure.rotationDeg' && isSingleRoom(base) && index !== null && base.decor.shelves[index]?.enclosure) {
        base = { ...base, decor: { ...base.decor, shelves: base.decor.shelves.map((s, i) => i === index && s.enclosure ? { ...s, enclosure: { ...s.enclosure, rotationDeg: null } } : s) } };
        from = null;
      }
      if (from === undefined) {
        const seeded = seedNullableParent(base, def.path);
        if (seeded) { base = seeded; from = readPath(base, def.path, index); }
      }
      if (from === undefined) { record(to, undefined, false, 'path does not exist on this spec'); continue; }
      if (same(from, to)) { record(to, from, false, 'already matches'); continue; }
      if (confidence < minConfidence) { record(to, from, false, `confidence ${confidence.toFixed(2)} below ${minConfidence}`); continue; }

      next = writePath(base, def.path, index, to);
      if (!next) { record(to, from, false, 'could not write the value'); continue; }
    } else {
      const def = arrays.get(field);
      if (!def) { record(undefined, undefined, false, 'array is not editable'); continue; }
      let base: RoomSpec = working;
      let arr = readPath(base, def.path, null);
      // `lighting.pendants.positions` is null until someone places the hooks by
      // hand, and an add is the only edit that can create the list — refusing it
      // for "path does not exist" made the whole entry dead. Seed the nullable
      // parent, then the empty list, exactly as the scalar branch seeds a parent.
      if (!Array.isArray(arr)) {
        const seeded = seedNullableParent(base, def.path);
        if (seeded) { base = seeded; arr = readPath(base, def.path, null); }
        if (arr === null && op === 'add') {
          const withList = writePath(base, def.path, null, []);
          if (withList) { base = withList; arr = []; }
        }
      }
      if (!Array.isArray(arr)) { record(undefined, undefined, false, 'path does not exist on this spec'); continue; }

      if (op === 'add') {
        // The element must be a complete, valid instance of its type before it
        // goes anywhere near the spec; zod also strips any keys the model
        // invented.
        const parsed = def.schema.safeParse(fillNullable(def.schema, edit.value_element));
        if (!parsed.success) { record(edit.value_element, undefined, false, `element is not a valid ${def.path} entry: ${parsed.error.issues[0]?.message ?? 'invalid'}`); continue; }
        if (arr.length >= def.max) { record(parsed.data, undefined, false, `${def.path} is full (max ${def.max})`); continue; }
        if (confidence < minConfidence) { record(parsed.data, undefined, false, `confidence ${confidence.toFixed(2)} below ${minConfidence}`); continue; }
        let element = parsed.data as Record<string, unknown>;
        const why = roomRejects(base, def.path, element);
        if (why) { record(element, undefined, false, why); continue; }
        if (def.path === 'openings') element = { ...element, id: nextOpeningId(String(element.kind ?? 'opening'), arr as Array<{ id?: unknown }>) };
        if (def.path === 'runs' && base.roomType === 'kitchen') {
          // two runs on one wall would be drawn through each other (same rule as runs[].wall)
          const wall = String(element.wall ?? '');
          if (base.runs.some((r) => r.wall === wall)) { record(element, undefined, false, `a run already sits on the ${wall} wall`); continue; }
          element = { ...element, id: nextRunId(wall, String(element.id ?? ''), base.runs) };
        }
        to = element;
        from = undefined;
        next = writePath(base, def.path, null, [...arr, element]);
      } else {
        if (index === null || index < 0 || index >= arr.length) { record(undefined, undefined, false, `no ${def.path} element at index ${index ?? 'null'}`); continue; }
        // a kitchen without a run has nothing to draw (KitchenSpecZ wants at least one)
        if (def.path === 'runs' && arr.length <= 1) { record(undefined, arr[index], false, 'the last cabinet run cannot be removed'); continue; }
        if (confidence < minConfidence) { record(undefined, arr[index], false, `confidence ${confidence.toFixed(2)} below ${minConfidence}`); continue; }
        from = arr[index];
        to = undefined;
        next = writePath(base, def.path, null, arr.filter((_, i) => i !== index));
      }
      // count and the hook list are two spellings of one row of pendants, and
      // the reconciler nulls a list whose length no longer matches count — so an
      // add or remove carries the count with it, or the edit would be undone the
      // moment it landed.
      if (next && def.path === 'lighting.pendants.positions') {
        const list = readPath(next, def.path, null);
        if (Array.isArray(list)) next = writePath(next, 'lighting.pendants.count', null, list.length) ?? next;
      }
      if (!next) { record(to, from, false, 'could not write the value'); continue; }
    }

    // The patched spec must still be a valid RoomSpec. One bad edit must not
    // take the whole pass down, so each is validated on its own and dropped if
    // it breaks the schema.
    const ok = RoomSpecZ.safeParse(next);
    if (!ok.success) { record(to, from, false, 'would make the spec invalid'); continue; }

    working = ok.data as RoomSpec;
    if (op !== 'set') {
      const arr = readPath(working, field, null);
      if (Array.isArray(arr)) expectedLength.set(field, arr.length);
    }
    record(to, from, true);
  }

  // Re-run the geometry reconciler so counts, widths and material ids stay
  // consistent with whatever the corrections changed. The reconciler snaps
  // material ids to the catalog, which would throw away a custom finish the
  // analyzer synthesised, so those are put back afterwards.
  let applied = corrections.filter((c) => c.applied);
  if (applied.length) {
    try {
      const before = working.materials as unknown as Record<string, string>;
      const reconciled = reconcileSpec(working, { photoCount: Math.max(1, working.detected.primaryPhotoIndex + 1), fixes: [] });
      const materials = { ...(reconciled.materials as unknown as Record<string, string>) };
      for (const [slot, id] of Object.entries(before)) if (isCustomMaterialId(id)) materials[slot] = id;
      working = { ...reconciled, materials } as unknown as RoomSpec;
    } catch (err) {
      serverWarn('refine', 'reconcile after corrections failed; keeping the patched spec', { error: errorMessage(err) });
    }

    // The reconciler has the last word on geometry, and it can undo an edit —
    // clamp a run back to its cabinets, drop a plant that has nowhere to
    // stand. An edit is only reported as applied when it still holds
    // afterwards, so the audit trail never claims a change the twin does not
    // show.
    for (const c of applied) {
      if (c.op !== 'set') continue;
      const def = byPath.get(c.field);
      if (!def) continue;
      const after = readPath(working, def.path, c.index);
      if (!stillHolds(c.from, c.to, after)) { c.applied = false; c.rejected = 'undone by reconcile'; }
    }
    for (const [path, expected] of expectedLength) {
      const arr = readPath(working, path, null);
      const actual = Array.isArray(arr) ? arr.length : 0;
      if (actual >= expected) continue;
      // the reconciler truncates from the end, so the last adds are the ones it threw away
      let missing = expected - actual;
      for (let i = corrections.length - 1; i >= 0 && missing > 0; i--) {
        const c = corrections[i];
        if (c.applied && c.op === 'add' && c.field === path) { c.applied = false; c.rejected = 'undone by reconcile'; missing--; }
      }
    }
    applied = corrections.filter((c) => c.applied);
  }

  // Finishes: each observation is validated on its own, must name a slot this
  // room actually has, and the batch is applied through the matcher so the
  // material id and the observation can never disagree.
  const finishes: FinishObservation[] = [];
  const rejectedFinishes: ApplyResult['rejectedFinishes'] = [];
  const validSlots = new Set<string>(slotsForRoom(roomType));
  for (const raw of rawFinishes.slice(0, 24)) {
    const parsed = FinishObservationZ.safeParse(raw);
    const slot = raw && typeof raw === 'object' && typeof (raw as { slot?: unknown }).slot === 'string' ? (raw as { slot: string }).slot : '?';
    if (!finishesPass) { rejectedFinishes.push({ slot, reason: 'not part of this pass' }); continue; }
    if (!parsed.success) { rejectedFinishes.push({ slot, reason: parsed.error.issues[0]?.message ?? 'invalid observation' }); continue; }
    if (!validSlots.has(parsed.data.slot)) { rejectedFinishes.push({ slot, reason: `not a ${roomType} slot` }); continue; }
    if (!/^#[0-9a-f]{6}$/i.test(parsed.data.baseColorHex)) { rejectedFinishes.push({ slot, reason: 'baseColorHex is not #RRGGBB' }); continue; }
    if (finishes.some((f) => f.slot === parsed.data.slot)) { rejectedFinishes.push({ slot, reason: 'duplicate slot' }); continue; }
    finishes.push(parsed.data as FinishObservation);
  }
  if (finishes.length) {
    const patched = applyFinishObservations(working, finishes);
    const ok = RoomSpecZ.safeParse(patched);
    if (ok.success) working = ok.data as RoomSpec;
    else {
      for (const f of finishes) rejectedFinishes.push({ slot: f.slot, reason: 'would make the spec invalid' });
      finishes.length = 0;
    }
  }
  ensureSpecMaterials(working);

  // Record what changed on the spec itself, so the studio's existing
  // "what the analyzer assumed" list also tells the contractor what the
  // accuracy pass corrected. Trust comes from showing the work.
  if (applied.length || finishes.length) {
    const lines = summarizeCorrections(corrections);
    if (finishes.length) lines.push(`matched ${finishes.length} finish${finishes.length === 1 ? '' : 'es'} (${finishes.map((f) => f.slot.replace(/_/g, ' ')).join(', ')})`);
    const detected = {
      ...working.detected,
      // The model's predicted post-edit match is not a new measurement of
      // hidden geometry or absolute scale. Keep original evidence confidence;
      // actual image alignment is reported separately by the fitted boxes.
      notes: [...working.detected.notes, `Checked against your photo and corrected ${lines.length} detail${lines.length === 1 ? '' : 's'}: ${lines.join('; ')}`].slice(-24),
    };
    working = { ...working, detected } as RoomSpec;
  }
  if (notes.length) {
    const detected = { ...working.detected, notes: [...working.detected.notes, ...notes.map((n) => `Photo check: ${n}`)].slice(-24) };
    working = { ...working, detected } as RoomSpec;
  }

  return { spec: working, corrections, notes, match, finishes, rejectedFinishes, changed: applied.length > 0 || finishes.length > 0 };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const r2 = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN);
const ratio = (a: number, b: number) => (b > 0 && Number.isFinite(a) && Number.isFinite(b) ? r2(a / b).toFixed(2) : '?');

/**
 * The ratios the model is asked to MEASURE in the photo, computed here from the
 * claims so it can compare like with like. Ratios beat absolute sizes because
 * a photo has no scale bar, but "the island is 40% of the run behind it" can be
 * read straight off the picture.
 */
function proportionFacts(spec: RoomSpec): string[] {
  const out: string[] = [];
  // ratios are read off a photograph; a plan is dimensioned, not proportioned
  if (spec.roomType === 'floorplan') return out;
  if (spec.roomType === 'exterior') {
    out.push(`house width ÷ lot width = ${ratio(spec.house.footprint.widthFt, spec.lot.widthFt)}`);
    out.push(`house depth ÷ house width = ${ratio(spec.house.footprint.depthFt, spec.house.footprint.widthFt)}`);
    if (spec.house.porch.present) out.push(`porch width ÷ house width = ${ratio(spec.house.porch.widthFt, spec.house.footprint.widthFt)}`);
    return out;
  }
  const wallLen = (wall: string) => (wall === 'back' || wall === 'front' ? spec.dims.widthFt : spec.dims.depthFt);
  if (spec.roomType === 'kitchen') {
    spec.runs.forEach((r, i) => out.push(`runs[${i}] length ÷ ${r.wall} wall = ${ratio(r.lengthFt, wallLen(r.wall))}`));
    if (spec.island.present) {
      // the run the island sits parallel to is the one it is judged against
      const facingWall = spec.island.rotationDeg === 90 ? 'left' : 'back';
      const facingIdx = spec.runs.findIndex((r) => r.wall === facingWall);
      const facing = facingIdx >= 0 ? facingIdx : spec.runs.reduce((best, r, i, all) => (r.lengthFt > all[best].lengthFt ? i : best), 0);
      // MEASURE THE SLAB, NOT THE BODY. Looking at a photo you can only see the
      // countertop — the cabinet body under it is hidden behind its own
      // overhang. Handing the pass a ratio of the BODY and asking it to compare
      // that with what it measures is asking it to compare two different
      // things, and on client-tan they can never agree: it was shown
      // 4.1 ÷ 5.0 = 0.82 while its own photo note read 0.57, so the correction
      // never fired and the island stayed a square block. `islandTopFt` is the
      // same formula the layout draws the top with (check-kitchen §7c pins the
      // two together), so both sides of the comparison are now one measurement.
      const top = islandTopFt(spec.island) ?? { len: spec.island.lengthFt, wide: spec.island.widthFt };
      out.push(`island countertop length ÷ runs[${facing}] length = ${ratio(top.len, spec.runs[facing]?.lengthFt ?? 0)}`);
      // …and the knobs have to be named with their ARITHMETIC, because the
      // field the model can edit is not the number it just measured, and
      // because one of the two cannot give what the difference is worth. The
      // slab is body + a fixed 1.5" scribe + the overhang: `island.widthFt`
      // can buy the whole difference, but `island.overhangIn` can only ever
      // give back the overhang itself — offering the full difference there
      // (as this did) invites `island.overhangIn: 0` on an island that is
      // already flush, which is a no-op the pass will believe fixed the depth.
      const slabPad = top.wide - spec.island.widthFt;
      const overhangFt = spec.island.overhangIn / 12;
      const scribeFt = Math.max(0, slabPad - overhangFt);
      const knee = islandNeedsKneeRoom(spec.island);
      const overhangClause = knee
        // the reconciler floors a side-seated island's overhang at 12" for knee
        // room (reconcileKitchen, --- island), so pointing the pass at that
        // knob here would be pointing it at an edit that gets undone
        ? `, and leave island.overhangIn alone: with a stool along the side a ${ISLAND_KNEE_IN}" seating overhang is held for knee room whatever this pass says`
        : overhangFt > 0.01
          ? `, or, if the photo's counter is flush with the cabinet face, cut island.overhangIn to 0 — that gives back ${r2(overhangFt)} ft of those ${r2(slabPad)}, and the remaining ${r2(scribeFt)} ft is a fixed 1.5" scribe no field controls`
          : `; island.overhangIn is already 0, and the ${r2(slabPad)} ft left is a fixed 1.5" scribe no field controls`;
      out.push(`island countertop width ÷ island countertop length = ${ratio(top.wide, top.len)} — this is the visible SLAB, overhang included: ${r2(top.wide)} ft deep by ${r2(top.len)} ft long, over a cabinet body ${spec.island.widthFt} ft deep by ${spec.island.lengthFt} ft long plus a ${spec.island.overhangIn}" seating overhang${spec.island.endOverhangIn != null ? ` and ${spec.island.endOverhangIn}" at each end` : ''}. Measure the counter you can see in IMAGE 1, edge to edge — the front lip to the far edge, ignoring anything standing on it. To draw a slab D ft deep set island.widthFt = D − ${r2(slabPad)}${overhangClause}`);
      out.push(`island countertop length ÷ ${spec.island.rotationDeg === 90 ? 'room depth' : 'room width'} = ${ratio(top.len, spec.island.rotationDeg === 90 ? spec.dims.depthFt : spec.dims.widthFt)}`);
    }
    const counterTopIn = spec.cabinets.baseHeightIn + spec.countertop.thicknessIn;
    out.push(`upper cabinet height ÷ (ceiling − counter) = ${ratio(spec.cabinets.upperHeightIn, spec.dims.ceilingFt * 12 - counterTopIn)}`);
    const splashIn = spec.backsplash.heightIn ?? (spec.backsplash.height === 'ledge' ? 6 : spec.backsplash.height === 'full-height' ? spec.dims.ceilingFt * 12 - counterTopIn : 18);
    out.push(`backsplash height ÷ (ceiling − counter) = ${ratio(splashIn, spec.dims.ceilingFt * 12 - counterTopIn)}`);
    if (spec.island.present && spec.island.endSeats > 0) out.push(`end stools: ${spec.island.endSeats} at ${spec.island.endPlacement}`);
  } else {
    if (spec.vanity.present) out.push(`vanity width ÷ ${spec.vanity.wall} wall = ${ratio(spec.vanity.widthIn / 12, wallLen(spec.vanity.wall))}`);
    if (spec.shower.present) out.push(`shower width ÷ ${spec.shower.wall} wall = ${ratio(spec.shower.widthIn / 12, wallLen(spec.shower.wall))}`);
    if (spec.tub.present) out.push(`tub length ÷ ${spec.tub.wall} wall = ${ratio(spec.tub.lengthIn / 12, wallLen(spec.tub.wall))}`);
  }
  spec.openings.forEach((o, i) => {
    if (o.kind === 'window') out.push(`openings[${i}] (window) width ÷ ${o.wall} wall = ${ratio(o.widthFt, wallLen(o.wall))}, height ÷ ceiling = ${ratio(o.heightFt, spec.dims.ceilingFt)}`);
  });
  out.push(`room depth ÷ room width = ${ratio(spec.dims.depthFt, spec.dims.widthFt)}`);
  return out;
}

/**
 * The ratios the ANALYSIS pass measured off the photo itself and wrote into
 * `detected.notes` in the format prompt.ts asks it for ("ratio: island length
 * ÷ back run = 0.52"). Nothing has ever read them back — and on client-tan
 * that is exactly where the client's complaint hides: the note says the island
 * is 0.52 of a 13.6 ft back run (7.1 ft) while the claims say 5.0 ft, and the
 * same pass's assumptions admit the island width was "set to a standard 48 in"
 * instead of measured. Quoting them beside the computed ratios puts the
 * contradiction in front of the one reader that can settle it, holding the
 * photo. Quoted, never parsed: a number a model wrote in prose is evidence for
 * a model to weigh, not a value to assign to a spec field behind its back —
 * see the report for why the length is not rewritten from it automatically.
 */
function recordedRatioFacts(spec: RoomSpec): string[] {
  const recorded = (spec.detected.notes ?? []).filter((n) => /^\s*ratio\s*:/i.test(n)).map((n) => n.trim()).slice(0, 12);
  const cut = spec.roomType === 'kitchen' && spec.island.present ? frameCutIsland(spec) : null;
  if (!recorded.length && !cut) return [];
  return [
    '',
    'Ratios the first pass MEASURED on IMAGE 1 and wrote down. A measurement beats a claim, so where one of these disagrees with the list above it is usually the claim above that is wrong — but read them against EACH OTHER first: two of these that cannot both be true of one island mean one of them was misread, and you are the only reader holding the photograph that settles it. Re-measure before you trust either.',
    ...recorded.map((n) => `  ${n}`),
    ...(cut ? [`  the photo's box around the island runs off the ${cut} of the picture, so nothing in IMAGE 1 measures the island's full LENGTH — what you can see of it is a LOWER BOUND, and the ratios above, the pendant spacing and the stool pitch are the only evidence for the rest of it.`] : []),
  ];
}

/** Which frame edge cuts the island's photo box, when one does — the case where the length cannot be measured directly. */
function frameCutIsland(spec: RoomSpec): string | null {
  const isl = (spec.detected.elements ?? []).find((e) => e.kind === 'island');
  if (!isl || !isl.open || (isl.openCause !== 'frame' && isl.openCause !== 'both')) return null;
  const sides = [isl.open.left ? 'left' : null, isl.open.right ? 'right' : null].filter(Boolean) as string[];
  return sides.length ? sides.join(' and ') : null;
}

function decorFacts(spec: RoomSpec): string[] {
  if (!isSingleRoom(spec)) return [];
  const d = spec.decor;
  const out: string[] = [];
  if (!d) return ['decor: none recorded'];
  d.shelves.forEach((s, i) => out.push(`decor.shelves[${i}]: ${s.count} × ${s.widthIn}" ${s.material} boards on ${s.wall} wall at t=${s.t}, lowest underside ${s.bottomFt} ft, ${s.depthIn}" deep, pitch ${s.spacingIn}", ${s.enclosure ? `enclosed case ${s.enclosure.heightIn}" overall with sides/top and ${s.enclosure.backPanel ? 'a backing panel' : 'open back'}, opening rotation ${s.enclosure.rotationDeg ?? 0} degrees relative to the mounting wall` : 'floating boards without a case'}, finish ${s.finishColorHex ?? 'not independently observed'}, ${s.styled}`));
  d.plants.forEach((p, i) => out.push(`decor.plants[${i}]: ${p.sizeFt} ft ${p.form} ${p.kind} plant at ${p.wall}${p.wall === 'corner' ? '' : ` t=${p.t}`}`));
  d.art.forEach((a, i) => out.push(`decor.art[${i}]: ${a.widthIn}×${a.heightIn}" ${a.frame}-framed picture on ${a.wall} wall at t=${a.t}, centre ${a.centerFt} ft`));
  out.push(d.rug?.present ? `decor.rug: ${d.rug.lengthFt}×${d.rug.widthFt} ft ${d.rug.style}` : 'decor.rug: none');
  (d.items ?? []).forEach((it, i) => out.push(`decor.items[${i}]: ${it.count > 1 ? `${it.count} × ` : ''}${Math.round(it.sizeIn)}" ${it.material.replace(/-/g, ' ')} ${it.label || it.kind.replace(/-/g, ' ')} on ${it.on === 'island' ? 'the island' : it.on === 'range' ? `the range (${it.burner ?? 'auto'})` : `the ${it.wall ?? '?'} ${it.on}`}${it.wall === 'island' || it.on === 'range' ? '' : ` at t=${it.t}`}`));
  (d.cabinetContents ?? []).forEach((c, i) => out.push(`decor.cabinetContents[${i}]: ${c.density} ${c.kind} behind the cabinet on the ${c.wall} wall at t=${c.t}`));
  out.push(`decor.windowTreatment: ${d.windowTreatment}`, `decor.counterStyling: ${d.counterStyling}`);
  if (!d.shelves.length) out.push('decor.shelves: none');
  if (!(d.items ?? []).length) out.push('decor.items: none');
  if (!(d.cabinetContents ?? []).length) out.push('decor.cabinetContents: none');
  if (!d.plants.length) out.push('decor.plants: none');
  if (!d.art.length) out.push('decor.art: none');
  return out;
}

function finishFacts(spec: RoomSpec): string[] {
  const obs = new Map((spec.detected.finishes ?? []).map((f) => [f.slot, f]));
  const materials = spec.materials as unknown as Record<string, string>;
  return slotsForRoom(spec.roomType).map((slot) => {
    const id = materials[slot];
    const mat = getMaterial(id);
    const seen = obs.get(slot);
    const what = mat ? `${mat.name}` : id ?? 'unset';
    const detail = seen ? ` — seen as ${seen.family}, ${seen.pattern}, base ${seen.baseColorHex}${seen.accentColorHex ? `, accent ${seen.accentColorHex}` : ''}, ${seen.sheen}` : '';
    return `${slot}: ${what}${detail}`;
  });
}

/** Human-readable template for an array element, generated from its zod schema so it can never drift from validation. */
function elementTemplate(schema: z.ZodType): string {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any' }) as { properties?: Record<string, Record<string, unknown>> };
  const props = json.properties ?? {};
  return `{ ${Object.entries(props).map(([k, v]) => {
    const anyOf = Array.isArray(v.anyOf) ? (v.anyOf as Array<Record<string, unknown>>) : null;
    const base = anyOf ? anyOf.find((o) => o.type !== 'null') ?? v : v;
    const nullable = anyOf ? anyOf.some((o) => o.type === 'null') : false;
    let t: string;
    if (Array.isArray(base.enum)) t = (base.enum as unknown[]).join('|');
    else if (base.type === 'object') t = `{ ${Object.keys((base.properties as Record<string, unknown>) ?? {}).join(', ')} }`;
    else t = String(base.type ?? 'any');
    return `${k}: ${t}${nullable ? '|null' : ''}`;
  }).join(', ')} }`;
}

// ---------------------------------------------------------------------------
// Measured gaps. The fitter projects the twin's elements onto the photo's
// boxes; the difference between each pair is a number the model can act on
// ("the range is 9% of the frame further left in the photo") instead of a
// difference it has to find for itself in two pictures.
// ---------------------------------------------------------------------------

/** What the fitter reports beside its result once it measures the gaps itself; read defensively, an older fitter has neither. */
type FitExtras = { residuals?: unknown; hints?: unknown };

const photoLabels = (spec: RoomSpec) => new Map((spec.detected.elements ?? []).map((e) => [e.id, e.label]));

/** Per-element gaps of a fit: the fitter's own when it reports them, else derived from the matched box pairs. */
export function residualsOf(fit: FitResult, spec: RoomSpec): FitResidual[] {
  const given = (fit as FitResult & FitExtras).residuals;
  return deriveResiduals({ residuals: given, matched: fit.matched }, spec.detected.elements ?? []);
}

/** Photo elements the twin does not draw, in words: the fitter's own hints when it has them, else built from its unmatched list. */
export function hintsOf(fit: FitResult, spec: RoomSpec): string[] {
  const given = (fit as FitResult & FitExtras).hints;
  if (Array.isArray(given) && given.length && given.every((h) => typeof h === 'string')) return given as string[];
  const labels = photoLabels(spec);
  return fit.unmatchedPhoto
    .filter((u) => u.reason !== 'kind not scored')
    .map((u): FitHint => ({ kind: u.kind, wall: u.wall, reason: u.reason, label: labels.get(u.id) ?? null }))
    .map(hintSentence);
}

const APPLIANCE_KINDS = new Set(['fridge', 'range', 'cooktop', 'hood', 'dishwasher', 'wall-oven', 'microwave', 'wine-fridge']);
const sameApplianceFamily = (a: string, b: string) => a === b || (a === 'range' && b === 'cooktop') || (a === 'cooktop' && b === 'range');

/**
 * The spec fields that move this element, so the model spends its edit on
 * the right knob. `index` is the element's position among the twin's
 * elements of its kind on its wall, which is how the arrays are walked here.
 */
function fieldsFor(spec: RoomSpec, r: FitResidual): string {
  if (spec.roomType === 'floorplan') return 'levels[].ceilingFt, levels[].elevationFt';
  if (spec.roomType === 'exterior') return 'house.footprint.widthFt, house.footprint.depthFt, house.stories';
  const wall = r.wall ?? null;
  const n = r.index ?? 0;
  const nth = <T,>(arr: readonly T[], pred: (x: T) => boolean): number => {
    let k = -1;
    for (let i = 0; i < arr.length; i++) if (pred(arr[i]) && ++k === n) return i;
    return -1;
  };
  const runIdx = spec.roomType === 'kitchen' ? spec.runs.findIndex((x) => x.wall === wall) : -1;
  const run = (fields: string, fallback: string) => (runIdx >= 0 ? fields.replace(/\[i\]/g, `[${runIdx}]`) : fallback);
  switch (r.kind) {
    case 'base-cabinet-run': return run('runs[i].lengthFt, runs[i].start, countertop.overhangIn (dims.widthFt / dims.depthFt only when the whole wall is the wrong length)', 'dims.widthFt, dims.depthFt, countertop.overhangIn');
    case 'upper-cabinet-run': return run('runs[i].upperBottomIn (absolute underside above floor), runs[i].upperHeightIn, runs[i].uppers2HeightIn (the transom tier, when the row is stacked), runs[i].uppersToCeiling, runs[i].lengthFt, runs[i].start, and for the hood on this run appliances[i].cabinetAbove', 'cabinets.upperHeightIn');
    // a tall unit's own toCeiling is two indices deep, outside the path grammar
    case 'tall-cabinet': return run('runs[i].lengthFt, runs[i].start, and the tall appliance on it: appliances[].widthIn, appliances[].heightIn (runs[i].tall[j] — the fitter and the Layout panel own this one)', 'appliances[].widthIn, appliances[].heightIn');
    case 'backsplash': return run('runs[i].backsplash, backsplash.height, backsplash.heightIn', 'backsplash.height, backsplash.heightIn');
    case 'island': return 'island.lengthFt, island.widthFt, island.offset.x, island.offset.z, island.rotationDeg';
    case 'stool': return 'island.seating, island.stoolPitchIn, island.endSeats, island.overhangIn, island.endPlacement, island.endOverhangIn, island.stoolOffsetIn, and for the seats themselves decor.stools.seatShape, decor.stools.seatColorHex';
    case 'pendant': return 'lighting.pendants.count, lighting.pendants.spreadFt, lighting.pendants.offsetFt, lighting.pendants.aboveCounterIn, lighting.pendants.positions';
    case 'sink':
    case 'faucet': return spec.roomType === 'kitchen' ? 'sink.t, sink.widthIn, sink.wall' : 'vanity.t, vanity.widthIn, vanity.sinks';
    case 'window':
    case 'door': {
      const i = nth(spec.openings, (o) => o.kind === r.kind && o.wall === wall);
      return i >= 0 ? `openings[${i}].t, openings[${i}].widthFt, openings[${i}].heightFt, openings[${i}].sillFt` : `add the ${r.kind} (op "add" on openings)`;
    }
    case 'shelf': {
      const i = nth(spec.decor?.shelves ?? [], (x) => x.wall === wall);
      return i >= 0 ? `decor.shelves[${i}].t, decor.shelves[${i}].widthIn, decor.shelves[${i}].bottomFt, decor.shelves[${i}].spacingIn, decor.shelves[${i}].count, decor.shelves[${i}].enclosure.heightIn, decor.shelves[${i}].enclosure.backPanel, decor.shelves[${i}].enclosure.rotationDeg, decor.shelves[${i}].finishColorHex` : 'add the shelf (op "add" on decor.shelves)';
    }
    case 'plant': {
      const i = nth(spec.decor?.plants ?? [], (x) => (x.wall === wall || (!wall && x.wall === 'corner')));
      return i >= 0 ? `decor.plants[${i}].t, decor.plants[${i}].sizeFt, decor.plants[${i}].wall` : 'add the plant (op "add" on decor.plants)';
    }
    case 'art': {
      const i = nth(spec.decor?.art ?? [], (x) => x.wall === wall);
      return i >= 0 ? `decor.art[${i}].t, decor.art[${i}].widthIn, decor.art[${i}].heightIn, decor.art[${i}].centerFt` : 'add the picture (op "add" on decor.art)';
    }
    case 'item': {
      const items = spec.roomType === 'kitchen' ? spec.decor?.items ?? [] : [];
      const i = nth(items, (x) => (wall === 'island' ? x.on === 'island' : x.wall === wall && x.on !== 'island'));
      return i >= 0
        ? `decor.items[${i}].t, decor.items[${i}].sizeIn, decor.items[${i}].on, decor.items[${i}].depthT`
        : 'add the item (op "add" on decor.items)';
    }
    case 'rug': return 'decor.rug.lengthFt, decor.rug.widthFt, decor.rug.style';
    case 'vanity': return 'vanity.t, vanity.widthIn, vanity.wall, vanity.style';
    case 'mirror': return 'vanity.mirror, vanity.widthIn';
    case 'shower': return 'shower.t, shower.widthIn, shower.depthIn, shower.wall';
    case 'tub': return 'tub.t, tub.lengthIn, tub.wall';
    case 'toilet': return 'toilet.t, toilet.wall';
    case 'wall':
    case 'floor':
    case 'ceiling': return 'dims.widthFt, dims.depthFt, dims.ceilingFt, detected.camera.*';
    default:
      if (spec.roomType === 'kitchen' && APPLIANCE_KINDS.has(r.kind)) {
        const i = nth(spec.appliances, (a) => sameApplianceFamily(a.kind, r.kind) && a.wall === wall);
        if (i < 0) return `add the ${r.kind} (op "add" on appliances)`;
        const extra = r.kind === 'hood' ? `, appliances[${i}].aboveCounterIn, appliances[${i}].heightIn, appliances[${i}].cabinetAbove, appliances[${i}].hoodShape` : r.kind === 'fridge' ? `, appliances[${i}].heightIn, appliances[${i}].fridgeStyle` : '';
        return `appliances[${i}].t, appliances[${i}].widthIn, appliances[${i}].wall${extra}`;
      }
      return '';
  }
}

/** Most gaps listed in one prompt; the worst come first, and a long tail of set dressing would only dilute them. */
const MAX_GAPS_IN_PROMPT = 14;
/** an item's box is loose by nature; below this it is genuinely misplaced */
const ITEM_OFF_BELOW = 0.2;
/** how many item gaps may take gap lines away from the cabinetry */
const MAX_ITEM_GAPS = 4;

/**
 * The "measured gaps" block of the prompt: every element whose overlap is
 * below the threshold, worst first, each with its gap in words and the
 * fields that move it; then what already lands (so the model leaves it
 * alone) and what the photo has that the twin does not draw at all.
 */
export function residualFacts(spec: RoomSpec, residuals: readonly FitResidual[], hints: readonly string[]): string[] {
  const out: string[] = [];
  // A kettle is small and a box round it is loose; judged at the cabinet
  // threshold, a lived-in kitchen's items would fill all 14 gap lines and push
  // the cabinet runs out of the prompt. So items get their own threshold, sort
  // AFTER every other kind, and at most four are listed.
  const threshold = (r: FitResidual) => (r.kind === 'item' ? ITEM_OFF_BELOW : RESIDUAL_OFF_BELOW);
  const isItem = (r: FitResidual) => r.kind === 'item';
  const off = residuals.filter((r) => r.iou < threshold(r)).sort((a, b) => (Number(isItem(a)) - Number(isItem(b))) || a.iou - b.iou);
  const fine = residuals.filter((r) => r.iou >= threshold(r));
  let itemsListed = 0;
  let itemsSkipped = 0;
  for (const r of off.slice(0, MAX_GAPS_IN_PROMPT)) {
    if (isItem(r) && itemsListed >= MAX_ITEM_GAPS) { itemsSkipped++; continue; }
    if (isItem(r)) itemsListed++;
    const fields = fieldsFor(spec, r);
    out.push(`  - ${residualSentence(r)} Overlap ${Math.round(r.iou * 100)}%.${r.label ? ` Photo shows: ${r.label}.` : ''}${fields ? ` Fields: ${fields}.` : ''}`);
  }
  itemsSkipped += off.slice(MAX_GAPS_IN_PROMPT).filter(isItem).length;
  if (itemsSkipped) out.push(`  - …and ${itemsSkipped} more counter items.`);
  const otherSkipped = off.slice(MAX_GAPS_IN_PROMPT).filter((r) => !isItem(r)).length;
  if (otherSkipped) out.push(`  - …and ${otherSkipped} smaller gaps not listed.`);
  if (!off.length) out.push('  - every matched element already lands on its photo box');
  if (fine.length) out.push(`  Already landing on the photo — leave these alone: ${fine.map((r) => `${residualName(r).replace(/^the /, '')} (${Math.round(r.iou * 100)}%)`).join('; ')}.`);
  if (hints.length) {
    out.push('  In the photo but not in the twin (add it, or move an existing one onto it):');
    for (const h of hints.slice(0, 10)) out.push(`  - ${h}`);
  }
  // which wall a corner element stands on is not a gap the boxes can express — say it outright
  out.push(...wallFactsBlock(spec));
  return out;
}


// ---------------------------------------------------------------------------
// Walls. How an element FACES in the photo settles which wall it stands on —
// the cue the client's fridge-in-the-corner complaint turned on — and the
// twin's placement is compared against it here so the model gets the
// conclusion in words, not two pictures to squint at. Reconcile already acts
// on the corner cases (applyInventoryWalls); what is listed here is what is
// still open when the prompt is built.
// ---------------------------------------------------------------------------

const r2t = (n: number) => Math.round(n * 100) / 100;

/** Where a unit of `widthIn` (plus its surround) sits along `wall` when it stands in the corner that wall shares with `from`; null when the walls do not meet. */
function cornerT(spec: RoomSpec, wall: Wall, from: Wall, widthIn: number): number | null {
  if (!isSingleRoom(spec)) return null;
  const len = wall === 'back' || wall === 'front' ? spec.dims.widthFt : spec.dims.depthFt;
  const half = (widthIn / 2 + 3) / 12 / Math.max(1, len);
  const lo = (wall === 'right' && from === 'back') || (wall === 'back' && from === 'left') || (wall === 'left' && from === 'front') || (wall === 'front' && from === 'right');
  const hi = (wall === 'left' && from === 'back') || (wall === 'back' && from === 'right') || (wall === 'right' && from === 'front') || (wall === 'front' && from === 'left');
  return lo ? r2t(half) : hi ? r2t(1 - half) : null;
}

/**
 * One line per element the photo puts on another wall than the twin, saying
 * which wall, why (how it faces), and exactly which edits move it there —
 * plus the layout rule, because a fridge that moves to the right wall turns
 * an L into a U.
 */
export function wallFacts(spec: RoomSpec): string[] {
  if (spec.roomType !== 'kitchen') return [];
  const conflicts = inventoryWallConflicts(spec);
  if (!conflicts.length) return [];
  const out: string[] = [];
  for (const c of conflicts.slice(0, 6)) {
    const seen = c.read.by === 'label'
      ? `stands on the ${c.photoWall.toUpperCase()} wall (${c.read.cue})`
      : c.element.facing === 'front'
        ? `is seen FACE-ON, so it stands on the ${c.photoWall.toUpperCase()} wall`
        : `faces INTO the room from the ${c.photoWall.toUpperCase()} wall (${c.read.cue})`;
    const t = c.corner ? cornerT(spec, c.photoWall, c.specWall, c.widthIn) : null;
    const target = 'appliance' in c.target
      ? `appliances[${c.target.appliance}].wall = "${c.photoWall}"${t !== null ? `, appliances[${c.target.appliance}].t ≈ ${t}` : ''}`
      : `take the pantry out of run ${c.target.run} and put it on that wall's run as a tall unit`;
    const hasRun = spec.runs.some((r) => r.wall === c.photoWall);
    const piece = c.kind === 'fridge' ? 'an appliance-gap of the fridge width with a fridge-surround tall unit' : c.kind === 'tall-cabinet' ? 'the pantry as a tall unit' : `an appliance-gap of the ${c.what}'s width`;
    const give = hasRun ? '' : ` and give that wall a run (op "add" on runs: ${piece}, ${Math.round(((c.widthIn + 6) / 12) * 10) / 10} ft long, starting at the ${c.specWall} corner)`;
    const shorten = c.corner ? `, then shorten the ${c.specWall} run by its width so those cabinets stop at the corner` : '';
    out.push(`  - ${c.what}: the photo's ${c.what} ${seen}; the twin has it on the ${c.specWall} wall${c.corner ? ` at its ${c.photoWall} corner` : ` at t=${r2t(c.specT)}`} — move it to the ${c.photoWall} wall (${target})${give}${shorten}.`);
  }
  out.push('  - layout follows the walls that carry runs: 1 wall = single-wall, 2 opposite walls = galley, 2 adjacent = l-shaped, 3 = u-shaped — set `layout` when the runs change.');
  return out;
}

/** The walls block for the prompt, or nothing when the photo and the twin agree. */
function wallFactsBlock(spec: RoomSpec): string[] {
  const lines = wallFacts(spec);
  return lines.length ? ['  Walls the photo disagrees on (how an element FACES settles which wall it stands on):', ...lines] : [];
}

/** The measured state of the twin against the photo, when there is one. */
interface MeasuredGaps { residuals: readonly FitResidual[]; hints: readonly string[]; score: number | null }

/** Measure the uploaded viewport's actual spec and camera; never optimize it first. */
export function measureRefineViewport(spec: RoomSpec): MeasuredGaps | null {
  const camera = spec.detected.camera.solved;
  if (!camera) return null;
  const measured = measureAt(spec, camera);
  return measured ? { residuals: measured.residuals, hints: measured.hints, score: measured.score } : null;
}

export function buildRefinePrompt(spec: RoomSpec, passes: readonly RefinePass[], measured?: MeasuredGaps | null, selections?: Record<string, string>): string {
  const roomType = spec.roomType;
  const geometry = passes.includes('geometry');
  const finishes = passes.includes('finishes');
  // These choices describe pixels already rendered in IMAGE 2. They must
  // not overwrite the as-found spec that correction edits apply to.
  const selectedMaterials = Object.fromEntries(slotsForRoom(roomType)
    .filter((slot) => selections?.[slot])
    .map((slot) => [slot, selections![slot]]));
  const renderedSpec = { ...spec, materials: { ...spec.materials, ...selectedMaterials } } as RoomSpec;
  const locked = confirmedDimensions(spec);
  const fields = refinableFor(roomType).filter((f) => !f.path.startsWith('dims.') || locked[f.path.slice(5) as keyof typeof locked] === undefined);
  const list = fields.map((f) => `  ${f.path}${f.values ? ` (one of: ${f.values.join(' | ')})` : f.numberValues ? ` (one of: ${f.numberValues.join(' | ')})` : f.kind === 'boolean' ? ' (true/false)' : f.kind === 'hex' ? ' (a colour, #RRGGBB)' : ` (number${f.min !== undefined ? `, ${f.min}–${f.max}` : ''})`} — ${f.help}`).join('\n');
  const arrayList = refinableArraysFor(roomType).map((a) => `  ${a.path} — ${a.help}; element = ${elementTemplate(a.schema)}`).join('\n');

  const facts: string[] = Object.keys(locked).length ? [`CONFIRMED MEASUREMENTS — locked: ${Object.entries(locked).map(([axis, value]) => `${axis} = ${value} ft`).join(', ')}. These are supplied measurements. Correct the camera or other estimated geometry to match them; never replace them with a photo estimate.`] : [];
  if (spec.roomType === 'kitchen') {
    facts.push(`layout: ${spec.layout}`, `room: ${spec.dims.widthFt}×${spec.dims.depthFt} ft, ${spec.dims.ceilingFt} ft ceiling`);
    spec.runs.forEach((r, i) => facts.push(`runs[${i}]: ${r.wall} wall, ${r.lengthFt} ft, starts ${r.start}, ${r.base.length} base cabinets, uppers ${r.hasUppers ? `${r.uppers?.length ?? 0}` : 'none'}, underside ${r.upperBottomIn === null || r.upperBottomIn === undefined ? 'standard counter gap' : `${r.upperBottomIn} in above floor`}, row height ${r.upperHeightIn ?? spec.cabinets.upperHeightIn} in, backsplash ${r.backsplash ? 'yes' : 'no'}`));
    facts.push(spec.island.present ? `island: ${spec.island.kind}, ${spec.island.lengthFt} ft long × ${spec.island.widthFt} ft deep, rotation ${spec.island.rotationDeg}°, offset x=${spec.island.offset.x} z=${spec.island.offset.z} ft, ${spec.island.seating} stools, ${spec.island.overhangIn}" overhang` : 'island: none');
    facts.push(`cabinets: ${spec.cabinets.doorStyle} doors, ${spec.cabinets.baseDepthIn}" deep bases, ${spec.cabinets.upperHeightIn}" tall uppers, ${spec.cabinets.hardware}`);
    facts.push(`backsplash: ${spec.backsplash.present ? `${spec.backsplash.height}, ${spec.backsplash.pattern}${spec.backsplash.heightIn != null ? `, ${spec.backsplash.heightIn}" above the counter` : ''}` : 'none'}`);
    facts.push(`countertop: ${spec.countertop.thicknessIn}" ${spec.countertop.edge} edge, ${spec.countertop.overhangIn != null ? `${spec.countertop.overhangIn}"` : 'default 1.5"'} front overhang`);
    if (spec.island.present) facts.push(`island stools: ${spec.island.endSeats} at the ${spec.island.endPlacement} end, end overhang ${spec.island.endOverhangIn != null ? `${spec.island.endOverhangIn}"` : 'default 1.5"'}, row offset ${spec.island.stoolOffsetIn}"`);
    // the seats' own description, so the pass can see what it would be changing
    // — a shape and a colour nothing else in this list carries
    const st = spec.decor.stools;
    facts.push(st ? `stools: ${st.style}, ${st.frame} frame, ${st.seat} seat, ${st.seatShape ?? 'round (not read)'} pad, ${st.seatColorHex ?? 'seat-material colour (not read)'}` : 'stools: none');
    spec.appliances.forEach((a, i) => facts.push(`appliances[${i}]: ${a.kind} on ${a.wall} at t=${a.t}, ${a.widthIn}", ${a.finish}${a.hoodStyle ? `, ${a.hoodStyle}` : ''}${a.fridgeStyle ? `, ${a.fridgeStyle}` : ''}${a.kind === 'fridge' ? `, dispenser ${a.hasDispenser === true ? 'visible' : a.hasDispenser === false ? 'absent' : 'unknown (not drawn)'}` : ''}${a.kind === 'hood' ? `, ${a.hoodShape ?? 'shape ?'}, ${a.cabinetAbove ?? 'cabinet above: auto'}` : ''}`));
    facts.push(`sink: ${spec.sink.kind} ${spec.sink.widthIn}" on ${spec.sink.wall} at t=${spec.sink.t}`);
    facts.push(`lighting: ${spec.lighting.pendants ? `${spec.lighting.pendants.count} ${spec.lighting.pendants.style} pendants${spec.lighting.pendants.positions ? ` at ${spec.lighting.pendants.positions.map((q) => `(${q.alongFt}, ${q.acrossFt})`).join(' ')} ft from ${spec.island.present ? 'the island centre' : spec.sink.wall !== 'island' ? 'the wall sink, along right facing its wall and across toward the room' : 'the room centre'}` : ''}` : 'no pendants'}, ${spec.lighting.recessedCount} recessed`);
    spec.openings.forEach((o, i) => facts.push(`openings[${i}]: ${o.kind} on ${o.wall} at t=${o.t}, ${o.widthFt}×${o.heightFt} ft, sill ${o.sillFt} ft${o.style ? `, ${o.style}` : ''}`));
  } else if (spec.roomType === 'bathroom') {
    facts.push(`room: ${spec.dims.widthFt}×${spec.dims.depthFt} ft, ${spec.dims.ceilingFt} ft ceiling`, `layout: ${spec.layout}`);
    facts.push(spec.vanity.present ? `vanity: ${spec.vanity.widthIn}" ${spec.vanity.style}, ${spec.vanity.sinks} basin(s), ${spec.vanity.doorStyle} doors, ${spec.vanity.wall} wall at t=${spec.vanity.t}` : 'vanity: none');
    facts.push(spec.shower.present ? `shower: ${spec.shower.widthIn}×${spec.shower.depthIn}", ${spec.shower.enclosure}, ${spec.shower.wall} wall at t=${spec.shower.t}` : 'shower: none');
    facts.push(spec.tub.present ? `tub: ${spec.tub.kind}, ${spec.tub.lengthIn}", ${spec.tub.wall} wall at t=${spec.tub.t}` : 'tub: none');
    facts.push(spec.toilet.present ? `toilet: ${spec.toilet.style}, ${spec.toilet.wall} wall at t=${spec.toilet.t}` : 'toilet: none');
    spec.openings.forEach((o, i) => facts.push(`openings[${i}]: ${o.kind} on ${o.wall} at t=${o.t}, ${o.widthFt}×${o.heightFt} ft${o.style ? `, ${o.style}` : ''}`));
  } else if (spec.roomType === 'floorplan') {
    for (const level of spec.levels) {
      facts.push(`levels[${level.index}] (${level.name}): ${level.ceilingFt} ft ceiling at ${level.elevationFt} ft above grade, ${level.rooms.length} rooms, ${level.walls.length} wall segments, ${level.doors.length} doors, ${level.windows.length} windows, ${level.stairs.length} stairs`);
      for (const r of level.rooms) facts.push(`  ${r.name} (${r.kind}): ${Math.round(Math.abs(planPolygonArea(r.polygon)))} sq ft${r.areaSqft ? `, sheet says ${r.areaSqft}` : ''}`);
      for (const st of level.stairs) facts.push(`  stair ${st.id}: ${st.kind}, ${st.treads} treads, ${st.direction} to level ${st.connects.toLevel}`);
    }
  } else {
    facts.push(`lot: ${spec.lot.widthFt}×${spec.lot.depthFt} ft`, `house: ${spec.house.footprint.widthFt}×${spec.house.footprint.depthFt} ft, ${spec.house.stories} storey, ${spec.house.roof.type} roof at ${spec.house.roof.pitch}/12`);
    facts.push(spec.house.garage.present ? `garage: ${spec.house.garage.bays} bays` : 'garage: none');
    facts.push(spec.house.porch.present ? `porch: ${spec.house.porch.widthFt}×${spec.house.porch.depthFt} ft, ${spec.house.porch.columns} columns` : 'porch: none');
  }
  const cam = spec.detected.camera;
  facts.push(`camera: ${cam.fovDeg}° horizontal field of view, ${cam.heightFt} ft high, standing ${cam.position}, facing the ${cam.lookingAt} wall`);

  const passText: string[] = [];
  if (geometry) {
    passText.push(
      '  PASS 0 — Check the camera. IMAGE 2 was rendered from the camera listed under "camera" below. If IMAGE 2 is clearly seen from a different place, height or lens than IMAGE 1 (walls converge differently, a different wall fills the frame, far more or far less of the room is visible), correct detected.camera.* FIRST — every other comparison depends on it.',
      '  PASS 1 — Audit the numbers. For each claim listed below, judge it against IMAGE 1 on its own merits. Does a room like this really have that ceiling height? Are there really that many pendants, stools, windows, cabinets? A claim can be wrong even when the two images look similar, because both were produced from the same mistaken numbers. Use known real-world sizes as your ruler: a base cabinet is 24 in deep and 36 in to the counter, a standard door is 80 in tall, a dishwasher is 24 in wide, a range is 30 or 36 in, a residential ceiling is almost always 8, 9 or 10 ft.',
      measured
        ? '  PASS 2 — Close the measured gaps. The twin\'s elements were projected through the solved camera onto the boxes a detector drew on IMAGE 1, and the list under "measured gaps" says, element by element, where the photo has each one relative to the twin. For EVERY listed gap emit the spec edit that closes it — the fields named beside it are the knobs that move that element. A shift LEFT / RIGHT along a wall is that element\'s `t` (or a run\'s `start`); wider / narrower is its width or length; taller / shorter is its height, sill or upper-cabinet height; the same shift on everything along one wall is the camera or the room size, not the elements. Convert the percentages: an element 10% of the frame further left on a wall that fills 60% of the frame moves about one sixth of that wall (Δt ≈ −0.17). Then diff the images for what the boxes cannot say: an appliance on the wrong wall, the wrong door / enclosure / fixture style, backsplash tile where the photo has painted drywall (runs[].backsplash) or the reverse.'
        : '  PASS 2 — Diff the images. Compare IMAGE 2 against IMAGE 1 and report anything positioned, counted or shaped differently: an appliance on the wrong wall or the wrong end of a wall, the wrong door / enclosure / roof / fixture style, backsplash tile on a wall that has painted drywall in the photo (runs[].backsplash) or the reverse.',
      '  PASS 3 — Proportions. In IMAGE 1, MEASURE each ratio listed under "ratios the claims imply" by eye — e.g. how long the island is compared with the run behind it, how wide a window is compared with its wall. When your measurement differs from the claimed ratio by more than 10%, emit the numeric edit that fixes the thing that is actually wrong (usually the island, run, window or upper-cabinet size; move the room dimensions only when the whole room is the wrong shape). Keep every other ratio intact when you change one number.',
      '  PASS 4 — Décor and detail. List what is in IMAGE 1 that is not cabinetry or a fixture: open shelves (how many boards, how wide, how high), plants, framed art, a rug, window treatment, every small object standing on the counters, the range, the island, a shelf or a sill (a pot on a burner, a kettle, a knife block, canisters, a vase — `decor.items`, with its kind, host, wall, t, size in inches and colour), and what shows behind glass-front or open wall cabinets (`decor.cabinetContents`). Compare with the "decor" claims. Add what is missing with op "add", remove what is not in the photo with op "remove", and fix wrong sizes / positions with op "set".',
      '  Check upper rows by their actual bottom and top edges. A short closed row may continue ABOVE a window and hood; set runs[].upperBottomIn and upperHeightIn from those edges, including 12–24 inch rows, rather than stretching it down to a standard counter gap or leaving a window-wide hole. A single high row is not a stacked second tier unless another row of doors is visible beneath it.',
      '  Cross-check an upper row visibly above a window numerically: its underside must clear 12 × (sillFt + heightFt), and its top must fit below the ceiling. Verify each wall in perspective before matching the row around a corner. Above a hood, visible vertical door divisions establish cabinetAbove doors even without handles; a featureless soffit or chase is panel. Count visible pendants without requiring an island; explicit hooks then use the wall sink origin, along right facing its wall and across toward the room (room centre only when neither island nor wall sink exists). A drop-in cooktop preserves the visible base drawers or doors underneath; it does not replace them with an appliance gap.',
      '  Check shelf construction separately from board count. Visible joined sides and a top cap establish an open shelf carcass; a visible backing establishes enclosure.backPanel. Set decor.shelves[].enclosure.heightIn FIRST to create that observed case, then backPanel and panelThicknessIn as supported. enclosure.rotationDeg independently turns the open face:0/default faces inward from its mounting wall, +90 turns toward wall-local right, -90 toward wall-local left,180 reverses it; a LEFT-wall case facing the room FRONT uses -90. Keep its mounting wall and t unless the actual location is wrong. Never relocate it to the back wall merely to make it face forward. bottomFt is the lowest/base board underside; count includes the base and interior boards, excluding the top cap. finishColorHex is its own observed wood/paint color. Do not enclose floating boards without visible evidence. To replace a wrongly enclosed unit with floating boards, remove it and add the same observed boards with enclosure null. An open white display box beneath a separate high closed row is its own enclosed shelf unit and may touch that row at its top; it does not justify stretching the whole closed row downward.',
    );
  }
  if (finishes) {
    passText.push(
      `  PASS ${geometry ? 5 : 1} — Finishes. For every material slot listed under "finishes", compare the SURFACE in IMAGE 2 with the same surface in IMAGE 1: colour (judge it under neutral daylight, discounting the photo's warm or cool cast), pattern (veined / speckled / wood grain / subway / herringbone…), material family, sheen, tile or plank module size, grout colour. Wherever IMAGE 2 visibly differs — the floor is grey plank in IMAGE 2 but honey oak in IMAGE 1, the counter is white in IMAGE 2 but veined grey in IMAGE 1 — return a complete observation for that slot in \`finishes\`. Return nothing for slots that already match or that you cannot see in IMAGE 1.`,
      FINISH_COLOR_DISCIPLINE,
      'The earlier photo observations and hex values below are fallible hypotheses, not calibration targets. Re-read IMAGE 1 independently and replace them when its visible evidence contradicts them. If all surfaces in IMAGE 2 are brighter or warmer together, describe a rendering-light/exposure mismatch in notes; do not darken or recolour every material to compensate. Correct a material when its relative contrast, hue, pattern or sheen differs after accounting for those shared lighting effects.',
    );
  }

  return [
    `IMAGE 1 is a photograph of a real ${roomType === 'exterior' ? 'house' : roomType}.`,
    `IMAGE 2 is a 3D reconstruction of that same space, rendered from the same viewpoint and cropped to the same aspect ratio. It was generated from IMAGE 1 and it is not yet accurate.`,
    '',
    'Your job is to make the reconstruction match the photograph: the same proportions, the same things in the same places, the same colours and patterns. The contractor\'s client must recognise their own room.',
    '',
    `Work in ${passText.length === 1 ? 'one pass' : 'these passes, in order'}:`,
    ...passText,
    '',
    'Report every difference the passes find.',
    '',
    'What the reconstruction currently claims:',
    ...facts.map((f) => `  ${f}`),
    ...(geometry && measured ? ['', `Measured gaps (mean overlap ${measured.score !== null ? `${Math.round(measured.score * 100)}%` : 'unknown'}; the twin and the photo agree when every element lands on its box):`, ...residualFacts(spec, measured.residuals, measured.hints)] : []),
    ...(geometry && !measured && wallFacts(spec).length ? ['', ...wallFactsBlock(spec)] : []),
    ...(geometry ? ['', 'Ratios the claims imply (measure the same ratios in IMAGE 1):', ...proportionFacts(spec).map((f) => `  ${f}`), ...recordedRatioFacts(spec)] : []),
    ...(geometry && isSingleRoom(spec) ? ['', 'Décor the reconstruction currently has:', ...decorFacts(spec).map((f) => `  ${f}`)] : []),
    ...(finishes ? ['', 'Finishes actually rendered in IMAGE 2 (slot: studio material choice — separate original photo observation):', ...finishFacts(renderedSpec).map((f) => `  ${f}`)] : []),
    '',
    'IMPORTANT ORIENTATION RULE: `t` runs 0 to 1 from LEFT to RIGHT as seen by someone standing inside the room looking at that wall. Check left/right carefully against the photo before moving anything.',
    '',
    ...(geometry ? [
      'You may only edit these fields (op "set"):',
      list,
      '',
      'You may add or remove whole elements of these arrays (op "add" with `value_element`, op "remove" with `index`):',
      arrayList,
      '',
    ] : []),
    'Rules:',
    '  - Emit an edit when EITHER the claim is implausible for the room in IMAGE 1, or the two images visibly differ. Do not invent detail you cannot support from IMAGE 1.',
    ...(geometry && measured ? ['  - Every measured gap gets an edit, or a note saying why it should not (the photo box is wrong, the element is not in the twin).'] : []),
    '  - If the two images look identical, that does NOT mean the numbers are right — IMAGE 2 was built from those numbers. Still audit them against IMAGE 1.',
    '  - op is "set" (change one field: give exactly one of value_number, value_string or value_boolean, matching the field type, and value_element null), "add" (append one complete element: fill value_element, leave the value_* fields null) or "remove" (delete element `index` from the array named in `field`).',
    '  - For a field written like `runs[].lengthFt`, set `index` to which run you mean (0-based). Otherwise set index to null.',
    ...(geometry && roomType === 'kitchen' ? ['  - An appliance whose doors are seen turned into the room stands on a SIDE wall, even in the corner beside the back run. To put it there when that wall has no cabinets: add a run on that wall (op "add" on runs — its appliance gap plus a fridge-surround / oven-tower tall unit, starting at the corner), set appliances[].wall and appliances[].t, and shorten the run it left. runs[].wall moves a whole run only onto a wall that has none. Layout follows the walls that carry runs: 1 = single-wall, 2 opposite = galley, 2 adjacent = l-shaped, 3 = u-shaped.'] : []),
    '  - Prefer a few high-confidence edits over many speculative ones.',
    '  - confidence is 0 to 1. Use below 0.5 only when you are genuinely unsure.',
    '  - Put anything you noticed but cannot express as one of the allowed edits into `notes`.',
    '  - `match` is your estimate, 0 to 1, of how well the reconstruction matches the photo AFTER your edits are applied.',
    ...(finishes ? ['  - Every `finishes` entry must be complete: hex colours as #RRGGBB, moduleIn as inches or null, description as one phrase a contractor would write on a spec sheet ("honey oak 5-in plank, satin"). `plankRun` is which way the boards run in IMAGE 1, read off the JOINT LINES, not the grain: "toward" when they recede toward the wall the camera faces (converging on the vanishing point), "across" when they run parallel to it, "diagonal" at 45°; null for tile, slab, paint and metal, and whenever IMAGE 1 does not show the joints.'] : ['  - `finishes` must be an empty array in this pass.']),
    ...(geometry ? [] : ['  - `corrections` must be an empty array in this pass.']),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Output schema (OpenAI strict mode: every key required, nullable not optional)
// ---------------------------------------------------------------------------

/** Mirror of schema.ts's strict-mode strip, for the element / observation sub-schemas embedded here. */
function strictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const strip = (node: unknown, isPropertiesMap = false): unknown => {
    if (Array.isArray(node)) return node.map((n) => strip(n));
    if (node && typeof node === 'object') {
      const o = { ...(node as Record<string, unknown>) };
      if (isPropertiesMap) {
        for (const k of Object.keys(o)) o[k] = strip(o[k]);
        return o;
      }
      for (const k of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'format', '$schema', 'default']) delete o[k];
      if (o.type === 'object' && o.properties && typeof o.properties === 'object') {
        o.additionalProperties = false;
        o.required = Object.keys(o.properties as Record<string, unknown>);
      }
      for (const k of Object.keys(o)) o[k] = k === 'properties' ? strip(o[k], true) : strip(o[k]);
      return o;
    }
    return node;
  };
  return strip(z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any' })) as Record<string, unknown>;
}

/** exported for scripts/check-refine.ts, which asserts the strict-mode shape rules */
export function editSchema(roomType: RoomType): Record<string, unknown> {
  const elements = refinableArraysFor(roomType).map((a) => strictJsonSchema(a.schema));
  return {
    type: 'object',
    additionalProperties: false,
    required: ['corrections', 'notes', 'match', 'finishes'],
    properties: {
      corrections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['op', 'field', 'index', 'value_number', 'value_string', 'value_boolean', 'value_element', 'reason', 'confidence'],
          properties: {
            op: { type: 'string', enum: ['set', 'add', 'remove'] },
            field: { type: 'string' },
            index: { type: ['integer', 'null'] },
            value_number: { type: ['number', 'null'] },
            value_string: { type: ['string', 'null'] },
            value_boolean: { type: ['boolean', 'null'] },
            value_element: { anyOf: [...elements, { type: 'null' }] },
            reason: { type: 'string' },
            confidence: { type: 'number' },
          },
        },
      },
      notes: { type: 'array', items: { type: 'string' } },
      match: { type: 'number' },
      finishes: { type: 'array', items: strictJsonSchema(FinishObservationZ) },
    },
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface RefineInput {
  spec: RoomSpec;
  /** Material choices actually used by the supplied viewport; prompt context only. */
  selections?: Record<string, string>;
  /** the client's original photograph */
  photoUrl: string;
  /** a screenshot of the twin from the photo-matched camera, at the photo's aspect */
  viewportUrl: string;
  /** edits below this confidence are reported but not applied */
  minConfidence?: number;
  /** which comparisons to run; default both */
  passes?: readonly RefinePass[];
  /** the photo's width ÷ height, for the fitter's camera; defaults to the previous solve's aspect, else 4:3 */
  aspect?: number;
  /**
   * The last fit's per-element gaps and hints, from the client. When absent
   * the server measures the supplied spec at its solved camera without moving
   * it. An existing screenshot cannot describe a newly optimized spec.
   */
  residuals?: FitResidual[];
  hints?: string[];
  /** which round of the match loop this is — logging only */
  round?: number;
  signal?: AbortSignal;
}

/** Shared hosting budget, including the provider and the post-correction fit. */
export const REFINEMENT_DEADLINE_MS = 270_000;
/** Normal call ceiling; reserve at least 20 seconds after preparation for fitting. */
export const REFINEMENT_PROVIDER_TIMEOUT_MS = 240_000;

function refinementTimeout(cause: unknown): ProviderError {
  return new ProviderError('openai', 'The accuracy pass reached its time limit. Please retry the photo check.', { code: 'timeout', status: 504, retryable: true, cause });
}

/**
 * The model's raw answer → a ModelOutput, or a retryable ProviderError. A
 * truncated response (max tokens, a refusal, a content filter) or one that is
 * not the JSON object the schema promised is the provider failing us, not the
 * caller's spec being wrong — so it must surface as a provider error the
 * client can retry, never as a 500.
 */
export function parseRefineOutput(text: string, status?: string | null): ModelOutput {
  if (status && status !== 'completed') {
    throw new ProviderError('openai', `Accuracy pass returned an ${status} response`, { code: 'refine_failed', retryable: true });
  }
  let parsed: unknown;
  try {
    parsed = parseModelJson(text);
  } catch (err) {
    throw new ProviderError('openai', `Accuracy pass returned no usable answer: ${errorMessage(err)}`, { code: 'refine_failed', retryable: true });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ProviderError('openai', 'Accuracy pass returned no usable answer', { code: 'refine_failed', retryable: true });
  }
  const out = parsed as ModelOutput;
  if (!Array.isArray(out.corrections) || !Array.isArray(out.finishes)) {
    throw new ProviderError('openai', 'Accuracy pass returned an incomplete answer', { code: 'refine_failed', retryable: true });
  }
  return out;
}

/**
 * One accuracy pass. Returns the corrected spec plus a full audit trail: every
 * proposed edit, whether it was applied, and why it was not.
 */
export async function refineSpec(input: RefineInput): Promise<RefineResult> {
  input.signal?.throwIfAborted();
  const deadlineAt = Date.now() + REFINEMENT_DEADLINE_MS;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new DOMException('Accuracy pass deadline exceeded', 'TimeoutError')), REFINEMENT_DEADLINE_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, deadline.signal]) : deadline.signal;
  try {
    return await refineWithinDeadline({ ...input, signal }, deadlineAt);
  } catch (error) {
    // A client cancellation remains a cancellation. The SDK may wrap our
    // deadline as APIUserAbortError, so inspect the signal's original reason.
    input.signal?.throwIfAborted();
    if (deadline.signal.aborted || (error as Error)?.name === 'TimeoutError') throw refinementTimeout(error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function refineWithinDeadline(input: RefineInput, deadlineAt: number): Promise<RefineResult> {
  const checkBudget = () => {
    input.signal?.throwIfAborted();
    // A synchronous fit can finish before the timer's callback can run.
    if (Date.now() >= deadlineAt) throw new DOMException('Accuracy pass deadline exceeded', 'TimeoutError');
  };
  checkBudget();
  const elapsed = startTimer();
  const spec = input.spec;
  const roomType = spec.roomType;
  const model = openaiVisionModel();
  const passes: readonly RefinePass[] = input.passes?.length ? input.passes : ['geometry', 'finishes'];

  // The screenshot was already captured. Moving its spec or camera here
  // would make the image and the numerical claims describe different twins.
  // Re-measure that exact viewport; optimization happens after corrections.
  const canFit = passes.includes('geometry') && isSingleRoom(spec) && Boolean(spec.detected.elements?.length);
  const base = spec;
  let measured: MeasuredGaps | null = null;
  if (canFit) {
    measured = measureRefineViewport(spec);
    if (!measured && (input.residuals?.length || input.hints?.length)) {
      measured = { residuals: input.residuals ?? [], hints: input.hints ?? [], score: spec.detected.camera.solved?.score ?? null };
    }
  }

  const client = openaiClient();
  let text: string;
  let status: string | null = null;
  try {
    checkBudget();
    const providerBudgetMs = Math.min(REFINEMENT_PROVIDER_TIMEOUT_MS, deadlineAt - Date.now() - 20_000);
    if (providerBudgetMs <= 0) throw new DOMException('Accuracy pass preparation exhausted its budget', 'TimeoutError');
    const res = await client.responses.create(
      {
        model,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: buildRefinePrompt(base, passes, measured, input.selections) },
            { type: 'input_image', image_url: input.photoUrl, detail: 'high' },
            { type: 'input_image', image_url: input.viewportUrl, detail: 'high' },
          ],
        }],
        text: { format: { type: 'json_schema', name: 'twin_corrections', strict: true, schema: editSchema(roomType) } },
        reasoning: { effort: passes.includes('geometry') ? 'medium' : 'low' },
        max_output_tokens: 10000,
        store: false,
      } as never,
      { signal: input.signal, timeout: providerBudgetMs, maxRetries: 0 },
    );
    text = (res as { output_text?: string }).output_text ?? '';
    status = (res as { status?: string }).status ?? null;
  } catch (err) {
    input.signal?.throwIfAborted();
    if ((err as Error)?.name === 'TimeoutError' || /timed? ?out/i.test(errorMessage(err))) throw refinementTimeout(err);
    throw new ProviderError('openai', `Accuracy pass failed: ${errorMessage(err)}`, { code: 'refine_failed', retryable: true });
  }

  checkBudget();
  const parsed = parseRefineOutput(text, status);
  const result = applyCorrections(base, parsed, { minConfidence: sanitizeMinConfidence(input.minConfidence, SERVER_MIN_CONFIDENCE), passes });

  // The measurable half. With a photo inventory on the spec, project the
  // corrected twin into the photo and move camera + spec until its elements
  // land on the inventory's boxes. Pure geometry, bounded, never fatal: a
  // fitter problem costs the fit, not the pass.
  let fitScore: number | null = null;
  let camera: SolvedCamera | null = null;
  let fitted = result.spec;
  let residuals: FitResidual[] = measured ? [...measured.residuals] : [];
  let hints: string[] = measured ? [...measured.hints] : [];
  let unmatchedPhoto: FitResult['unmatchedPhoto'] = [];
  let coverage: number | null = null;
  if (canFit) {
    try {
      checkBudget();
      const fit = fitToPhoto(fitted, { aspect: input.aspect, maxMs: Math.min(20_000, Math.max(50, deadlineAt - Date.now() - 1000)) });
      fitScore = fit.score;
      if (fit.score !== null) {
        // the fitted spec carries the camera on detected.camera.solved; it is
        // returned beside it too, so a client can adopt the solve even when
        // the model applied no corrections
        fitted = fit.spec;
        camera = fit.camera;
        residuals = residualsOf(fit, fitted);
        hints = hintsOf(fit, fitted);
        unmatchedPhoto = fit.unmatchedPhoto;
        coverage = coverageOf(fit.matched.length, fit.unmatchedPhoto.filter((u) => u.reason !== 'kind not scored').length);
        serverLog('refine', 'photo fit', { round: input.round ?? null, score: fit.score, before: measured?.score ?? null, originalScore: fit.originalScore, specUnchanged: fit.spec_unchanged, endedBy: fit.endedBy, matched: fit.matched.length, unmatchedPhoto: fit.unmatchedPhoto.length, coverage, iterations: fit.iterations, evaluations: fit.evaluations, ms: fit.ms, notes: fit.notes });
      }
    } catch (err) {
      checkBudget();
      serverWarn('refine', 'photo fit failed; keeping the corrected spec', { error: errorMessage(err) });
    }
  }
  checkBudget();

  const ms = elapsed();
  const applied = result.corrections.filter((c) => c.applied).length;
  serverLog('refine', 'accuracy pass complete', {
    roomType, model, ms, passes: passes.join('+'), round: input.round ?? null, measuredGaps: measured?.residuals.length ?? 0,
    proposed: result.corrections.length, applied, rejected: result.corrections.length - applied,
    finishes: result.finishes.length, rejectedFinishes: result.rejectedFinishes.length, match: result.match, fitScore,
  });

  return { ...result, spec: fitted, changed: result.changed || fitted !== result.spec || base !== spec, model, elapsedMs: ms, fitScore, camera, residuals, hints, unmatchedPhoto, coverage };
}

const SINGULAR: Record<string, string> = { 'decor.shelves': 'shelf', 'decor.plants': 'plant', 'decor.art': 'picture', openings: 'opening', appliances: 'appliance', runs: 'cabinet run', 'decor.items': 'item', 'decor.cabinetContents': 'cabinet contents' };

/** Short human summary for the UI, e.g. "island lengthFt: 7 → 6", "added shelf: 3 wood boards on left wall". */
export function summarizeCorrections(corrections: Correction[]): string[] {
  const fmt = (v: unknown) => (typeof v === 'number' ? String(Math.round(v * 100) / 100) : typeof v === 'object' && v !== null ? describeElement(v as Record<string, unknown>) : String(v));
  return corrections
    .filter((c) => c.applied)
    .slice(0, 8)
    .map((c) => {
      const label = c.field.replace('[]', c.index !== null ? ` ${c.index + 1}` : '').replace(/\./g, ' ');
      const one = SINGULAR[c.field] ?? label;
      if (c.op === 'add') return `added ${one}: ${fmt(c.to)}`;
      if (c.op === 'remove') return `removed ${one} ${c.index !== null ? c.index + 1 : ''}`.trim();
      return `${label}: ${fmt(c.from)} → ${fmt(c.to)}`;
    });
}

/** "2 wood boards on right wall", "5.5 ft tree plant", "window on back wall" */
function describeElement(e: Record<string, unknown>): string {
  if ('base' in e && 'lengthFt' in e) return `${e.lengthFt} ft run on ${e.wall} wall${Array.isArray(e.tall) && e.tall.length ? ` with ${(e.tall as Array<{ kind?: unknown }>).map((t) => String(t.kind ?? 'tall unit').replace(/-/g, ' ')).join(', ')}` : ''}`;
  // a DecorItem also carries `count` and `material`, so it must be recognised
  // BEFORE the shelf test or every added pot reads as "1 stainless board"
  if ('sizeIn' in e && 'on' in e) return `${Math.round(Number(e.sizeIn))}" ${String(e.label || e.kind).replace(/-/g, ' ')} on the ${e.on === 'island' ? 'island' : e.on === 'range' ? 'range' : `${e.wall ?? ''} ${e.on}`.trim()}`;
  if ('density' in e && 'kind' in e) return `${e.density} ${e.kind} behind the glass on the ${e.wall} wall`;
  if ('alongFt' in e && 'acrossFt' in e) return `pendant at ${e.alongFt} ft along, ${e.acrossFt} ft across the island`;
  if ('count' in e && 'material' in e) return `${e.count} ${e.material} board${e.count === 1 ? '' : 's'} on ${e.wall} wall`;
  if ('form' in e) return `${e.sizeFt} ft ${e.form} plant`;
  if ('frame' in e) return `${e.widthIn}×${e.heightIn}" picture on ${e.wall} wall`;
  if ('sillFt' in e) return `${e.kind} on ${e.wall} wall`;
  if ('finish' in e) return `${e.kind} on ${e.wall}`;
  return JSON.stringify(e).slice(0, 60);
}

export { describeSpec };
