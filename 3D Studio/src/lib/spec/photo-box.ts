/**
 * Truncation on a photo box — the one fact that turns "the element is exactly
 * this big" into "the element is AT LEAST this big".
 *
 * The client's island runs off the left edge of their photo. The inventory
 * prompt has always said "an element that runs out of frame stops at the frame
 * edge", so the box is a lie by construction, and nothing downstream knew:
 * the fitter's proportion term charges |log(twin/photo)| symmetrically, so a
 * twin that is correctly LONGER than a cropped box is punished exactly as hard
 * as one that is too short, and the island settled at 5 ft against a real
 * length nearer 9. `PhotoElement.open` / `openCause` record the cut.
 *
 * The annotator is asked for both fields, but a box that touches the frame
 * edge is cut whether or not it said so, so the frame case is INFERRED here as
 * well as read — which is also how an inventory drawn before the fields
 * existed (a persisted project, a share link, a regression fixture) gets its
 * truncation back. Occlusion cannot be inferred from a box: only the annotator
 * can see that something stands in front.
 *
 * Pure and dependency-free: `reconcile.ts` (server) and `fit/contract.ts`
 * (client + server) both call it, and they must never disagree.
 */
import type { BoxOpenCause, BoxOpenEdges, ImageBox } from './types';

/**
 * How close to 0 or 1 an edge has to land before the picture is treated as
 * having cut it. Boxes are stored rounded to three decimals, so this is "on
 * the edge, or one rounding step inside it" — tight enough that a cabinet run
 * ending a whisker short of the frame is not called open.
 */
export const FRAME_EDGE_EPS = 0.002;

export const NO_OPEN_EDGES: Readonly<BoxOpenEdges> = { left: false, right: false, top: false, bottom: false };

/** Which edges of `box` sit on the picture's own border. */
export function frameOpenEdges(box: ImageBox): BoxOpenEdges {
  return {
    left: box.x0 <= FRAME_EDGE_EPS,
    right: box.x1 >= 1 - FRAME_EDGE_EPS,
    top: box.y0 <= FRAME_EDGE_EPS,
    bottom: box.y1 >= 1 - FRAME_EDGE_EPS,
  };
}

export const anyOpenEdge = (o: BoxOpenEdges | null | undefined): boolean =>
  !!o && (o.left || o.right || o.top || o.bottom);

const CAUSES: readonly string[] = ['frame', 'occluded', 'both'];

/**
 * The `open` / `openCause` pair for one box: whatever the annotator said,
 * unioned with the edges the frame demonstrably cut.
 *
 * The cause becomes 'both' the moment the frame cuts a box the annotator
 * called occluded — the two carry different facts (a frame-open edge also says
 * the twin must run off the picture there; an occluded one says nothing about
 * the twin's extent) and the fitter needs whichever applies. null cause when
 * no edge is open at all, so "nothing is cut" has exactly one spelling.
 */
export function resolveOpen(
  box: ImageBox,
  rawOpen: Partial<BoxOpenEdges> | null | undefined,
  rawCause: unknown,
): { open: BoxOpenEdges; openCause: BoxOpenCause | null } {
  const atFrame = frameOpenEdges(box);
  const open: BoxOpenEdges = {
    left: rawOpen?.left === true || atFrame.left,
    right: rawOpen?.right === true || atFrame.right,
    top: rawOpen?.top === true || atFrame.top,
    bottom: rawOpen?.bottom === true || atFrame.bottom,
  };
  if (!anyOpenEdge(open)) return { open, openCause: null };
  const inferredFrame = anyOpenEdge(atFrame);
  const said = typeof rawCause === 'string' && CAUSES.includes(rawCause) ? (rawCause as BoxOpenCause) : null;
  if (said === 'occluded' && inferredFrame) return { open, openCause: 'both' };
  return { open, openCause: said ?? (inferredFrame ? 'frame' : 'occluded') };
}
