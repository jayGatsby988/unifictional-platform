/**
 * POST /api/refine — accuracy pass.
 *
 * Body: { spec, photoUrl, viewportUrl, minConfidence?, passes?, aspect?, residuals?, hints?, round? }
 * Returns: { spec, corrections, notes, match, finishes, rejectedFinishes, model, elapsedMs, changed,
 *            fitScore, camera, residuals, hints, unmatchedPhoto, coverage }
 *
 * The client screenshots the twin from the photo-matched camera (at the
 * photo's aspect ratio), uploads it, and posts both URLs here. The model
 * reports what differs; every correction is validated against an allowlist and
 * the full RoomSpec schema before it is applied, so a bad suggestion can never
 * corrupt the project. `passes` lets the client run the geometry comparison on
 * its own (it is iterated) and the finish comparison once at the end.
 * `residuals` + `hints` are the last fit's measured gaps; the prompt is built
 * from them (the server re-fits to get them when the client sends none), and
 * the response carries the post-correction fit's gaps for the next round.
 */
import { z } from 'zod';
import { BoxOpenEdgesZ, RoomSpecZ } from '@/lib/spec/schema';
import { MAX_ELEMENTS } from '@/lib/ai/reconcile';
import { refineSpec } from '@/lib/ai/refine';
import { ensureSpecMaterials } from '@/lib/materials/match';
import { isOpenAIConfigured } from '@/lib/ai/providers/openai';
import { serverLog } from '@/lib/ai/log';
import { HttpError, guard, json, readJson, zodMessage } from '../_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BodyZ = z.object({
  spec: z.unknown(),
  photoUrl: z.string().min(1).max(30_000_000),
  viewportUrl: z.string().min(1).max(30_000_000),
  minConfidence: z.number().min(0).max(1).optional(),
  passes: z.array(z.enum(['geometry', 'finishes'])).min(1).max(2).optional(),
  /** The finishes actually visible in the supplied screenshot. */
  selections: z.record(z.string().min(1).max(64), z.string().min(1).max(200)).refine((s) => Object.keys(s).length <= 32, 'Too many material selections').optional(),
  /** the photo's width ÷ height, so the post-correction fit solves the right lens */
  aspect: z.number().min(0.2).max(5).optional(),
  /** the last fit's per-element gaps (frame fractions) and unmatched-photo hints */
  residuals: z.array(z.object({
    kind: z.string().min(1).max(40),
    wall: z.string().max(16).nullable(),
    index: z.number().int().min(0).max(MAX_ELEMENTS).optional(),
    iou: z.number().min(0).max(1),
    dx: z.number().min(-2).max(2),
    dy: z.number().min(-2).max(2),
    dw: z.number().min(-1).max(20),
    dh: z.number().min(-1).max(20),
    label: z.string().max(200).nullable().optional(),
    err: z.number().min(0).max(1).optional(),
    open: BoxOpenEdgesZ.nullable().optional(),
    openCause: z.enum(['frame', 'occluded', 'both']).nullable().optional(),
  })).max(MAX_ELEMENTS).optional(),
  hints: z.array(z.string().max(300)).max(MAX_ELEMENTS).optional(),
  /** which round of the match loop this is — for the log */
  round: z.number().int().min(0).max(20).optional(),
});

export async function POST(req: Request) {
  return guard('refine', async () => {
    if (!isOpenAIConfigured()) {
      throw new HttpError(503, 'not_configured', 'Set OPENAI_API_KEY to run the accuracy pass.');
    }
    const body = await readJson(req, BodyZ, { maxBytes: 8 * 1024 * 1024 });

    const spec = RoomSpecZ.safeParse(body.spec);
    if (!spec.success) throw new HttpError(400, 'validation_error', `spec: ${zodMessage(spec.error)}`);
    // a spec arriving from the browser may reference custom finishes this
    // process has never seen
    ensureSpecMaterials(spec.data);

    const result = await refineSpec({
      spec: spec.data,
      photoUrl: body.photoUrl,
      viewportUrl: body.viewportUrl,
      minConfidence: body.minConfidence,
      passes: body.passes,
      selections: body.selections,
      aspect: body.aspect,
      residuals: body.residuals,
      hints: body.hints,
      round: body.round,
      signal: req.signal,
    });

    serverLog('refine', 'responded', {
      roomType: spec.data.roomType,
      passes: (body.passes ?? ['geometry', 'finishes']).join('+'),
      round: body.round ?? null,
      residualsIn: body.residuals?.length ?? 0,
      fitScore: result.fitScore,
      coverage: result.coverage,
      applied: result.corrections.filter((c) => c.applied).length,
      proposed: result.corrections.length,
      finishes: result.finishes.length,
      match: result.match,
      ms: result.elapsedMs,
    });

    return json(result);
  });
}
