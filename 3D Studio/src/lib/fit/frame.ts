/**
 * Frame hypotheses: what the inventory says about how the photo is framed,
 * and the two ways it can disagree with the spec.
 *
 * `detected.frame` (written by the inventory pass) says whether the back
 * wall spans the frame and which side walls are visible. The element wall
 * labels say which wall each thing is on — in the PHOTO's terms, which is
 * not always the spec's: a model that calls the wall at the right edge of
 * the frame "right" while the analyzer put that fridge on the back wall has
 * simply turned the room a quarter. The fit tries the labels as they are
 * and turned one wall either way, and keeps whichever lands best.
 *
 * The hints also seed the camera: a back wall whose centre sits right of
 * the frame's centre means the photographer turned left, and a visible
 * left wall with no right wall means they stood on the right.
 *
 * An element's `facing` cue is the strong version of its wall label: it
 * says which way the thing's FRONT points in the picture, which is the
 * one thing a model reads reliably off a fridge that fills the right edge
 * of the frame. A front turned to the left of the frame stands on the right
 * wall (and the right wall is therefore in the picture); a face seen square
 * on stands on the wall the camera faces. The cues fill in the frame's
 * side-wall flags when the inventory left them out, and the hypothesis a
 * cue supports is tried first.
 */
import type { PhotoElement, PhotoElementKind, RoomSpec, SolvedCamera, Wall } from '@/lib/spec/types';
import { clamp } from '@/lib/units';
import { fromEstimate, lookAngles, roomSize, type CameraEstimate } from './camera';
import type { TwinElement } from './boxes';

export interface FrameHints {
  /** the back wall's horizontal extent in the frame (normalised), when the inventory measured it */
  backWallSpan: [number, number] | null;
  /** the back wall runs the full width of the frame (a one-wall shot) */
  backWallSpansX: boolean | null;
  leftWallVisible: boolean | null;
  rightWallVisible: boolean | null;
}

const DEG = Math.PI / 180;
const WALL_RING: readonly Wall[] = ['back', 'right', 'front', 'left'];

/**
 * `detected.frame`, read defensively (the field is optional and its shape is
 * the inventory's). Given the cleaned elements, their `facing` cues fill in
 * whichever side-wall flags the frame block left unsaid: a front turned to
 * the left of the frame stands on the right wall, so that wall is in the
 * picture (and the other way round). A cue only ever says a wall IS
 * visible — nothing facing a side says nothing about it.
 */
export function readFrame(spec: RoomSpec | null | undefined, photos?: readonly PhotoElement[]): FrameHints {
  const out: FrameHints = { backWallSpan: null, backWallSpansX: null, leftWallVisible: null, rightWallVisible: null };
  const det = spec && typeof spec === 'object' ? (spec.detected as unknown as { frame?: unknown } | undefined) : undefined;
  const raw = det && typeof det === 'object' ? det.frame : undefined;
  if (raw && typeof raw === 'object') {
    const f = raw as Record<string, unknown>;
    const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
    const span = f.backWallSpansX;
    if (typeof span === 'boolean') out.backWallSpansX = span;
    else if (Array.isArray(span) && span.length >= 2 && span.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      const a = clamp(span[0] as number, 0, 1), b = clamp(span[1] as number, 0, 1);
      if (b - a > 0.02) { out.backWallSpan = [a, b]; out.backWallSpansX = a <= 0.02 && b >= 0.98; }
    } else if (span && typeof span === 'object') {
      const o = span as Record<string, unknown>;
      const a = o.x0, b = o.x1;
      if (typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b) && b - a > 0.02) {
        out.backWallSpan = [clamp(a, 0, 1), clamp(b, 0, 1)];
        out.backWallSpansX = a <= 0.02 && b >= 0.98;
      }
    }
    out.leftWallVisible = bool(f.leftWallVisible);
    out.rightWallVisible = bool(f.rightWallVisible);
  }
  if (photos) {
    const seen = facingWallsSeen(photos);
    if (out.rightWallVisible === null && seen.has('right')) out.rightWallVisible = true;
    if (out.leftWallVisible === null && seen.has('left')) out.leftWallVisible = true;
  }
  return out;
}

/** The side walls the facing cues put something on (in the photo's terms): a front turned left is on the right wall. */
export function facingWallsSeen(photos: readonly PhotoElement[]): Set<Wall> {
  const out = new Set<Wall>();
  for (const p of photos) {
    if (p.kind === 'wall' || p.kind === 'floor' || p.kind === 'ceiling') continue;
    const w = wallFromFacing(p.facing);
    if (w === 'left' || w === 'right') out.add(w);
  }
  return out;
}

/** The wall `turns` quarter-turns clockwise (seen from above) from `wall`: back → right → front → left. */
export function turnWall(wall: Wall, turns: number): Wall {
  const i = WALL_RING.indexOf(wall);
  return WALL_RING[(((i + turns) % 4) + 4) % 4];
}

/** The inventory with every wall label turned `turns` quarter-turns (island / null labels stay). */
export function turnLabels(photos: PhotoElement[], turns: number): PhotoElement[] {
  if (!turns) return photos;
  return photos.map((p) => (p.wall && p.wall !== 'island' ? { ...p, wall: turnWall(p.wall, turns) } : p));
}

/**
 * The wall an element's `facing` cue puts it on, in the photo's terms: seen
 * face-on it is on the wall the camera faces (called 'back' here), with its
 * front turned to the left of the frame it stands on the right wall, and
 * the other way round. Edge-on says nothing. Under a turned labelling
 * (`turns`, as in `turnLabels`) the cue turns with the labels: the wall the
 * camera faces is then the twin's `turnWall('back', turns)`.
 */
export function wallFromFacing(facing: PhotoElement['facing'], turns = 0): Wall | null {
  const wall = facing === 'front' ? 'back' : facing === 'left' ? 'right' : facing === 'right' ? 'left' : null;
  return wall && turns ? turnWall(wall, turns) : wall;
}

const cooktopOrRange = (k: PhotoElementKind): PhotoElementKind => (k === 'cooktop' ? 'range' : k);
const SHELL = new Set<PhotoElementKind>(['wall', 'floor', 'ceiling', 'other']);

/** The wall an element says it is on, the facing cue first (it is the stronger read), else the label; null when neither says. */
export function saidWall(p: PhotoElement, turns = 0): Wall | null {
  return wallFromFacing(p.facing, turns) ?? (p.wall && p.wall !== 'island' ? (turns ? turnWall(p.wall, turns) : p.wall) : null);
}

/**
 * Whether the inventory and the twin disagree about where something stands:
 * a scored element whose `facing` cue — or, failing one, whose wall label —
 * puts it on a wall where the twin draws nothing of its kind. The walls
 * themselves are left out (the twin has all four), and so is anything the
 * twin does not draw at all.
 */
export function labelsDisagree(photos: PhotoElement[], twin: TwinElement[]): boolean {
  const onWall = new Set(twin.map((t) => `${t.kind}|${t.wall ?? ''}`));
  const drawn = new Set(twin.map((t) => t.kind));
  return photos.some((p) => {
    if (SHELL.has(p.kind)) return false;
    const kind = cooktopOrRange(p.kind);
    if (!drawn.has(kind)) return false;
    const said = saidWall(p);
    return said !== null && !onWall.has(`${kind}|${said}`);
  });
}

export interface LabelHypothesis {
  name: string;
  turns: number;
  photos: PhotoElement[];
  /** the facing cues point to this turn: it displaces the model's own labels without the usual handicap */
  seeded: boolean;
}

/**
 * The quarter-turn the facing cues vote for, when the labels disagree with
 * the twin: for every scored element whose cue puts it on a wall where the
 * twin draws nothing of its kind, each wall the twin DOES draw that kind on
 * is one turn away or the other (or opposite, which no single turn makes);
 * the turn with the most votes wins, ties and no votes give 0.
 */
export function facingTurn(photos: PhotoElement[], twin: TwinElement[]): number {
  const votes = new Map<number, number>([[1, 0], [-1, 0]]);
  const wallsOf = new Map<PhotoElementKind, Set<Wall>>();
  for (const t of twin) {
    if (!t.wall || t.wall === 'island') continue;
    const set = wallsOf.get(t.kind) ?? new Set<Wall>();
    set.add(t.wall);
    wallsOf.set(t.kind, set);
  }
  for (const p of photos) {
    if (SHELL.has(p.kind)) continue;
    const said = wallFromFacing(p.facing);
    if (!said) continue;
    const walls = wallsOf.get(cooktopOrRange(p.kind));
    if (!walls || walls.has(said)) continue;
    for (const k of [1, -1]) if (walls.has(turnWall(said, k))) votes.set(k, (votes.get(k) ?? 0) + (p.confidence || 0.5));
  }
  const cw = votes.get(1) ?? 0, acw = votes.get(-1) ?? 0;
  return cw > acw ? 1 : acw > cw ? -1 : 0;
}

/**
 * The labellings worth trying: as given, and when the labels disagree with
 * the twin, turned a wall either way — the turn the facing cues point to
 * first, and marked so the fit need not handicap it against the model's own
 * words.
 */
export function labelHypotheses(photos: PhotoElement[], twin: TwinElement[]): LabelHypothesis[] {
  const out: LabelHypothesis[] = [{ name: 'as labelled', turns: 0, photos, seeded: false }];
  if (labelsDisagree(photos, twin)) {
    const seed = facingTurn(photos, twin);
    const turned = (turns: number): LabelHypothesis => ({
      name: `labels turned one wall ${turns > 0 ? 'clockwise' : 'anticlockwise'}`, turns, photos: turnLabels(photos, turns), seeded: turns === seed,
    });
    out.push(turned(seed === -1 ? -1 : 1), turned(seed === -1 ? 1 : -1));
  }
  return out;
}

/**
 * Extra starting cameras from the frame hints. A measured back-wall span
 * puts the wall's centre at a known frame x, which fixes the yaw for any
 * standpoint (the camera turns so that the wall's centre lands there);
 * visible-side-wall flags say which side the photographer stood on.
 */
export function frameStarts(frame: FrameHints, spec: RoomSpec, aspect: number, heightFt: number): SolvedCamera[] {
  const out: SolvedCamera[] = [];
  const { w, d } = roomSize(spec);
  const fovs = [48, 65, 82];
  const stands: Array<CameraEstimate['position']> = frame.leftWallVisible && frame.rightWallVisible === false ? ['corner-right', 'side-right', 'front']
    : frame.rightWallVisible && frame.leftWallVisible === false ? ['corner-left', 'side-left', 'front']
      : frame.leftWallVisible && frame.rightWallVisible ? ['front']
        : ['front', 'corner-left', 'corner-right'];
  const span = frame.backWallSpan;
  for (const position of stands) {
    for (const fovDeg of fovs) {
      const cam = fromEstimate(spec, aspect, { position, lookingAt: 'back', fovDeg, heightFt });
      if (span) {
        // the wall's centre must land at the span's centre: turn the camera
        // from "aimed at the wall's centre" by the angle that frame offset is
        const cx = (span[0] + span[1]) / 2;
        const aimed = lookAngles([cam.x, cam.y, cam.z], [0, cam.y, -d / 2]);
        const tanH = Math.tan((cam.fovDeg * DEG) / 2) * aspect;
        const turn = Math.atan((cx - 0.5) * 2 * tanH) / DEG;
        out.push({ ...cam, yawDeg: aimed.yawDeg - turn });
      } else if (frame.leftWallVisible && frame.rightWallVisible === false) {
        out.push({ ...cam, yawDeg: cam.yawDeg - 12 });
      } else if (frame.rightWallVisible && frame.leftWallVisible === false) {
        out.push({ ...cam, yawDeg: cam.yawDeg + 12 });
      } else if (frame.backWallSpansX) {
        out.push({ ...cam, yawDeg: 0, x: clamp(cam.x, -w / 4, w / 4) });
      }
    }
  }
  return out;
}
