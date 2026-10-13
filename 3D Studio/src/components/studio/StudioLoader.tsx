'use client';
import dynamic from 'next/dynamic';
import { StudioSkeleton } from './StudioSkeleton';

const Studio = dynamic(() => import('./Studio'), { ssr: false, loading: () => <StudioSkeleton /> });

export default function StudioLoader({ demo, embedded = false }: { demo?: string | null; embedded?: boolean }) {
  return <Studio demo={demo} embedded={embedded} />;
}
