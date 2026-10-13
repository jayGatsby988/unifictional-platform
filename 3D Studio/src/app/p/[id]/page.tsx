import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { Project } from '@/lib/spec/types';
import { getJson } from '@/lib/storage/blob';
import SharedProjectLoader from '@/components/studio/SharedProjectLoader';
import { isScannedProject, sharedScanPresentation } from '@/lib/sharing/project';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function fetchProject(id: string): Promise<Project | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  try {
    return await getJson<Project>(`projects/${id}.json`);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const project = await fetchProject(id);
  if (!project) return { title: 'Project not found' };
  const company = project.branding?.company;
  const scanView = isScannedProject(project) ? sharedScanPresentation(project) : null;
  return {
    title: project.name,
    description: scanView ? `${project.name} — ${scanView.caption.toLowerCase()} with project details${company ? ` from ${company}` : ''}.` : company
      ? `${project.name} — a 3D remodel concept from ${company}.`
      : `${project.name} — an explorable 3D remodel concept with a line-item estimate.`,
    openGraph: { title: project.name, images: scanView ? scanView.imageUrl ? [scanView.imageUrl] : undefined : project.photos[0]?.url ? [project.photos[0].url] : undefined },
    robots: { index: false, follow: false },
  };
}

export default async function SharedProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await fetchProject(id);
  if (!project) notFound();
  return <SharedProjectLoader project={project} />;
}
