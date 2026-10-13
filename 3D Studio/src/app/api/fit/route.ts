/**
 * POST /api/fit — project the twin into the photo and adjust camera + spec
 * until its elements land on the inventory's boxes.
 *
 * Body: { spec, aspect? }   (aspect = photo width ÷ height)
 * Returns: the fitter's result — { spec, camera, score, coverage, matched, unmatchedPhoto, unmatchedTwin, residuals, hints,
 *          iterations, evaluations, ms, originalScore, spec_unchanged, notes, ... }
 * `residuals` (one per matched pair, under the client's FitResidual names) and `hints` (the unmatched photo
 * elements in words) are what the correction loop and the match report read; `spec_unchanged: 'gated'` means
 * the fitter refused its own edits and `spec` is the input spec with the solved camera — adopt the camera alone.
 * `'partial'` means it refused the aggregate but kept a size the photo could not measure (a frame-cut island's
 * length): `spec` differs from the gated one in that size alone and IS adopted, like an ungated fit.
 *
 * No model call: this is pure geometry on the server, bounded to a few
 * seconds (the fitter's own clock is 20 s; the route allows 60 for a slow
 * cold start). A spec without a photo inventory comes back unchanged with a
 * null score, so the client can call it unconditionally.
 */
import { z } from 'zod';
import { RoomSpecZ } from '@/lib/spec/schema';
import { fitToPhoto, healContract } from '@/lib/fit';
import { ensureSpecMaterials } from '@/lib/materials/match';
import { serverLog } from '@/lib/ai/log';
import { HttpError, guard, json, readJson, zodMessage } from '../_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BodyZ = z.object({
  spec: z.unknown(),
  aspect: z.number().min(0.2).max(5).optional(),
});

export async function POST(req: Request) {
  return guard('fit', async () => {
    const body = await readJson(req, BodyZ, { maxBytes: 4 * 1024 * 1024 });
    // a project saved before the per-element contract existed lacks its
    // fields; they mean "auto" and are filled before the strict parse
    if (body.spec && typeof body.spec === 'object') healContract(body.spec as Parameters<typeof healContract>[0]);
    const spec = RoomSpecZ.safeParse(body.spec);
    if (!spec.success) throw new HttpError(400, 'validation_error', `spec: ${zodMessage(spec.error)}`);
    // a spec arriving from the browser may reference custom finishes this
    // process has never seen
    ensureSpecMaterials(spec.data);

    const result = fitToPhoto(spec.data, { aspect: body.aspect });

    serverLog('fit', 'responded', {
      roomType: spec.data.roomType,
      elements: spec.data.detected.elements?.length ?? 0,
      matched: result.matched.length,
      residuals: result.residuals.length,
      hints: result.hints.length,
      score: result.score,
      proportions: result.proportions,
      coverage: result.coverage,
      originalScore: result.originalScore,
      specUnchanged: result.spec_unchanged,
      iterations: result.iterations,
      evaluations: result.evaluations,
      // which limit ended the search — the evaluation cap is the budget; 'time' means the safety net fired on a slow server
      endedBy: result.endedBy,
      ms: result.ms,
      notes: result.notes,
    });
    return json(result);
  });
}
