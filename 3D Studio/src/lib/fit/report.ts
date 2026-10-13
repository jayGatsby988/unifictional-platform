/**
 * What the fit tells the correction loop: per matched element the residual
 * (where the photo's box is relative to the twin's, and how much bigger),
 * and per unmatched photo element a plain-English hint the vision model can
 * act on ("photo shows a 3rd stool at the island's right end; twin has 2").
 */
import { NO_OPEN_EDGES, anyOpenEdge } from '@/lib/spec/photo-box';
import type { BoxOpenEdges, PhotoElement, PhotoElementKind, Wall } from '@/lib/spec/types';
import type { Box4 } from './camera';

/**
 * The photo's box repaired against the twin's along the edges the photo box
 * is a CUT rather than the element's own boundary (`PhotoElement.open`).
 *
 * An open edge makes the box a LOWER bound: the island runs off the left of
 * the picture, so "the visible part is 0.48 of the frame wide" says the island
 * is at least that wide and nothing about how much wider. Every number below
 * — IoU, centre distance, `proportionError` — is symmetric, so without this a
 * twin that is correctly LONGER than a cropped box is punished exactly as hard
 * as one that is too short, and the fit settles on the stub. Repairing means
 * pushing the open edge out to the twin's own: overshoot past a cut is free,
 * stopping short still pays in full.
 *
 * One helper, called by the loss, the PAIRING cost and the residuals alike —
 * the fitter's rule is that the pairing cost IS the loss term, so a repair in
 * one and not the other would make the matching and the loss disagree.
 */
export function repairOpen(photo: Box4, twin: Box4, open: BoxOpenEdges | null | undefined): Box4 {
  if (!anyOpenEdge(open)) return photo;
  const o = open ?? NO_OPEN_EDGES;
  return [
    o.left ? Math.min(photo[0], twin[0]) : photo[0],
    o.top ? Math.min(photo[1], twin[1]) : photo[1],
    o.right ? Math.max(photo[2], twin[2]) : photo[2],
    o.bottom ? Math.max(photo[3], twin[3]) : photo[3],
  ];
}

export interface Residual {
  /** photo centre − twin centre, as a fraction of the frame (+x right, +y down) */
  dx: number;
  dy: number;
  /**
   * photo size ÷ twin size − 1 (+0.18 = the photo's is 18% wider / taller
   * than the twin's) — a DIFFERENCE, the same number under the same name as
   * the client's `FitResidual.dw/dh` (`residualFromBoxes` in api-client.ts),
   * so a residual read off the fit and one derived from the matched boxes
   * agree. A twin box too thin to measure against reads as 0, as there.
   */
  dw: number;
  dh: number;
  /** the proportion error of this pair, 0 = the same size in the same place (see `proportionError`) */
  err: number;
}

/**
 * How wrong this pair's SIZE and POSITION are, as one number in 0..1 — the
 * question the client actually asked ("i need proportions to be exact"),
 * which an IoU answers only indirectly. Two halves:
 *
 *   eSize  the mean |log size ratio| over the two axes, so 2× and ½× cost
 *          the same and a small error degrades to the plain fraction
 *          (|ln 1.05| = 0.049 ≈ 5%);
 *   ePos   the same dx / dy `residual()` reports, but each as a fraction of
 *          the PHOTO's own size on that axis — a shelf board shifted by its
 *          own thickness is badly placed, the same shift on a wall is not.
 *
 * Clamped at 1 so one hopeless pair cannot swamp the mean. The photo's
 * sizes are floored at 1e-4 (a sliver box would otherwise divide by zero).
 */
export function proportionError(photo: Box4, twin: Box4): { err: number; eSize: number; ePos: number } {
  const pw = Math.max(1e-4, photo[2] - photo[0]);
  const ph = Math.max(1e-4, photo[3] - photo[1]);
  const tw = Math.max(1e-4, twin[2] - twin[0]);
  const th = Math.max(1e-4, twin[3] - twin[1]);
  const eSize = 0.5 * (Math.abs(Math.log(tw / pw)) + Math.abs(Math.log(th / ph)));
  const dx = (photo[0] + photo[2]) / 2 - (twin[0] + twin[2]) / 2;
  const dy = (photo[1] + photo[3]) / 2 - (twin[1] + twin[3]) / 2;
  const ePos = 0.5 * (Math.abs(dx) / pw + Math.abs(dy) / ph);
  return { err: Math.min(1, 0.5 * eSize + 0.5 * ePos), eSize, ePos };
}

/**
 * `open` repairs the photo box first (`repairOpen`), so a residual never tells
 * the correction loop to shrink something the picture cut off — otherwise
 * `runMatchLoop`'s hints keep asking the model for a shorter island and the
 * accuracy pass undoes the fit.
 */
export function residual(photo: Box4, twin: Box4, open?: BoxOpenEdges | null): Residual {
  const p = repairOpen(photo, twin, open);
  const tw = twin[2] - twin[0];
  const th = twin[3] - twin[1];
  return {
    dx: (p[0] + p[2]) / 2 - (twin[0] + twin[2]) / 2,
    dy: (p[1] + p[3]) / 2 - (twin[1] + twin[3]) / 2,
    dw: tw > 1e-4 ? (p[2] - p[0]) / tw - 1 : 0,
    dh: th > 1e-4 ? (p[3] - p[1]) / th - 1 : 0,
    err: proportionError(p, twin).err,
  };
}

export const kindName = (kind: PhotoElementKind): string => kind.replace(/-/g, ' ');

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Where in the frame a box sits, in words a model can relate to the picture. */
export function placeInFrame(box: PhotoElement['box']): string {
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const h = cx < 0.33 ? 'left' : cx > 0.67 ? 'right' : 'centre';
  const v = cy < 0.33 ? 'top' : cy > 0.67 ? 'bottom' : 'middle';
  return `${v}-${h} of the frame (x ${Math.round(box.x0 * 100)}–${Math.round(box.x1 * 100)}%, y ${Math.round(box.y0 * 100)}–${Math.round(box.y1 * 100)}%)`;
}

const wallPhrase = (wall: Wall | 'island' | null): string => (wall === 'island' ? 'at the island' : wall ? `on the ${wall} wall` : '');

export interface HintContext {
  /** every photo element of this kind family, in the inventory's order */
  siblings: PhotoElement[];
  /** how many of the kind family the twin draws */
  twinCount: number;
  reason: 'no twin counterpart' | 'twin has fewer of this kind' | 'not in frame' | 'kind not scored';
}

/** The plain-English hint for one unmatched photo element. */
export function hintFor(p: PhotoElement, ctx: HintContext): string {
  const name = kindName(p.kind);
  const where = [wallPhrase(p.wall), placeInFrame(p.box)].filter(Boolean).join(', ');
  const n = ctx.siblings.length;
  const i = Math.max(0, ctx.siblings.findIndex((s) => s.id === p.id));
  // "an item", "an upper cabinet run" — the model reads these back to itself
  const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');
  // A counter item is only recognisable by what it IS: "3rd of 7 items" tells
  // the model nothing it can act on, so an item always carries its label.
  const which = p.kind === 'item' && p.label
    ? `${article(p.label)} ${p.label} (${name})`
    : n > 1 ? `${ordinal(i + 1)} of ${n} ${name}s` : `${article(name)} ${name}`;
  switch (ctx.reason) {
    case 'kind not scored':
      return `photo shows ${p.label || 'something'} ${where}; the twin has no element kind for it`;
    case 'no twin counterpart':
      return `photo shows ${which} ${where}; the twin draws no ${name} at all`;
    case 'twin has fewer of this kind':
      return `photo shows ${which} ${where}; the twin has ${ctx.twinCount}`;
    case 'not in frame':
      return `photo shows ${which} ${where}; the twin's ${name}${ctx.twinCount > 1 ? 's project' : ' projects'} outside the frame — it stands elsewhere in the room`;
    default:
      return `photo shows ${which} ${where}`;
  }
}
