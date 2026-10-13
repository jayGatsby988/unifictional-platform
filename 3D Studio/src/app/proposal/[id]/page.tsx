import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { JarvisProposal } from '@/lib/jarvis/types';
import { getJson } from '@/lib/storage/blob';
import { JarvisProposalView } from '@/components/studio/JarvisProposalView';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Design proposal', robots: { index: false, follow: false } };

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(id)) notFound();
  const proposal = await getJson<JarvisProposal>(`proposals/${id}.json`);
  if (!proposal || proposal.id !== id || !Array.isArray(proposal.options)) notFound();
  return <JarvisProposalView proposal={proposal} />;
}
