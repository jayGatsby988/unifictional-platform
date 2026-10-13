import type { Metadata } from 'next';
import StudioLoader from '@/components/studio/StudioLoader';

export const metadata: Metadata = {
  title: 'Studio',
  description: 'Upload photos of a kitchen, bathroom or lot and get an explorable 3D twin with live pricing.',
};

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ demo?: string | string[] }> }) {
  const sp = await searchParams;
  const raw = sp?.demo;
  const demo = Array.isArray(raw) ? raw[0] : raw;
  return <StudioLoader demo={demo ?? null} />;
}
