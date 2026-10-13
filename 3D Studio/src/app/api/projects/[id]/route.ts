/**
 * /api/projects/:id
 *  PUT → stores the Project JSON at projects/<id>.json (private assistant history omitted; photos/renders are URLs) → { id, url:'/p/<id>' }
 *  GET → the stored Project (404 when missing)
 */
import { z } from 'zod';
import { serverLog } from '@/lib/ai/log';
import { RoomSpecZ } from '@/lib/spec/schema';
import { JarvisStateZ } from '@/lib/jarvis/schemas';
import type { Project } from '@/lib/spec/types';
import { getJson, putJson } from '@/lib/storage/blob';
import { projectForSharing } from '@/lib/sharing/project';
import { HttpError, IdZ, assertId, guard, json, readJson, zodMessage } from '../../_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PhotoZ = z.looseObject({ url: z.string().min(1).max(4000), width: z.number().optional(), height: z.number().optional(), primary: z.boolean().optional() });
const JobZ = z.looseObject({ id: z.string().min(1), status: z.enum(['queued', 'running', 'completed', 'failed']), createdAt: z.string() });

const ProjectZ = z.looseObject({
  id: IdZ,
  name: z.string().max(200),
  roomType: z.enum(['kitchen', 'bathroom', 'exterior', 'floorplan']),
  createdAt: z.string().max(64),
  updatedAt: z.string().max(64),
  photos: z.array(PhotoZ).max(24),
  description: z.string().max(8000),
  spec: z.unknown().nullable(),
  selections: z.record(z.string(), z.string()),
  overrides: z.record(z.string(), z.unknown()).default({}),
  estimateSettings: z.looseObject({
    region: z.string().max(64),
    tier: z.enum(['budget', 'standard', 'premium', 'luxury']),
    contingencyPct: z.number().min(0).max(1),
    markupPct: z.number().min(0).max(1),
    scope: z.enum(['cosmetic', 'pull-and-replace', 'full-gut']),
    includePermits: z.boolean(),
    // optional: a project saved before changes-mode existed still validates,
    // and the loader defaults it to full so the share reads as it always did
    mode: z.enum(['changes', 'full']).optional(),
    includeKnockOns: z.boolean().optional(),
    keepExistingAppliances: z.boolean().optional(),
  }),
  // the room as found. `spec` is validated against RoomSpecZ in PUT, like the
  // live spec — a share whose baseline is junk would price every line as a
  // change and quote the client a remodel they did not ask for
  baseline: z.looseObject({
    spec: z.unknown(),
    selections: z.record(z.string(), z.string()),
    capturedAt: z.string().max(64),
    source: z.enum(['analysis', 'manual', 'demo', 'migrated']),
  }).nullable().optional(),
  renders: z.array(JobZ).max(200).default([]),
  scans: z.array(JobZ).max(50).default([]),
  branding: z.looseObject({ company: z.string().max(200), phone: z.string().max(64).optional(), email: z.string().max(200).optional(), logoUrl: z.string().max(4000).optional(), accent: z.string().max(32).optional() }).optional(),
  client: z.looseObject({ name: z.string().max(200).optional(), address: z.string().max(400).optional() }).optional(),
  jarvis: JarvisStateZ.optional(),
});

const pathFor = (id: string) => `projects/${id}.json`;

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard('projects.put', async () => {
    const { id } = await ctx.params;
    assertId(id, 'project id');
    const body = await readJson(req, ProjectZ, { maxBytes: 6 * 1024 * 1024 });
    if (req.signal.aborted) throw new HttpError(499, 'aborted', 'Sharing was cancelled.');
    if (body.id !== id) throw new HttpError(400, 'bad_request', 'Body id does not match the URL');
    if (body.spec !== null && body.spec !== undefined) {
      const spec = RoomSpecZ.safeParse(body.spec);
      if (!spec.success) throw new HttpError(400, 'validation_error', `spec: ${zodMessage(spec.error)}`);
      if (spec.data.roomType !== body.roomType) throw new HttpError(400, 'validation_error', 'spec.roomType does not match project.roomType');
    }
    if (body.baseline && body.baseline.spec !== null && body.baseline.spec !== undefined) {
      const base = RoomSpecZ.safeParse(body.baseline.spec);
      if (!base.success) throw new HttpError(400, 'validation_error', `baseline.spec: ${zodMessage(base.error)}`);
      if (base.data.roomType !== body.roomType) throw new HttpError(400, 'validation_error', 'baseline.spec: roomType does not match project.roomType');
    }
    let project: Project;
    try { project = projectForSharing({ ...body, updatedAt: new Date().toISOString() } as unknown as Project); }
    catch (error) { throw new HttpError(400, 'share_image_required', error instanceof Error ? error.message : 'A saved scan-view image is required.'); }
    if (req.signal.aborted) throw new HttpError(499, 'aborted', 'Sharing was cancelled.');
    await putJson(pathFor(id), project);
    serverLog('projects', 'saved', { id, photos: project.photos.length, renders: project.renders.length });
    return json({ id, url: `/p/${id}` });
  });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard('projects.get', async () => {
    const { id } = await ctx.params;
    assertId(id, 'project id');
    const project = await getJson<Project>(pathFor(id));
    if (!project || project.id !== id) throw new HttpError(404, 'not_found', 'Project not found');
    return json(project);
  });
}
