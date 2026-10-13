import { buildJarvisProposal } from '@/lib/jarvis/proposal';
import { putJson } from '@/lib/storage/blob';
import { HttpError, guard, json } from '../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  return guard('jarvis.proposal', async () => {
    const reader = req.body?.getReader();
    if (!reader) throw new HttpError(400, 'bad_request', 'A proposal request is required.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new HttpError(413, 'body_too_large', 'The proposal request exceeds 4 MB.'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const { proposal, projects } = buildJarvisProposal(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    // Every option gets an immutable client page. Native scan pages display
    // included images/details, because their original sensor assets stay local.
    // Conversations never enter these shares.
    for (const project of projects) await putJson(`projects/${project.id}.json`, project);
    await putJson(`proposals/${proposal.id}.json`, proposal);
    return json({ id: proposal.id, url: `/proposal/${proposal.id}`, title: proposal.title, createdAt: proposal.createdAt, optionIds: proposal.options.map((o) => o.id) });
  });
}
