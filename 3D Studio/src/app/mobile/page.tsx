import type { Metadata } from 'next';
import { NativeBridge } from '@/components/native/NativeBridge';

export const metadata: Metadata = { title: 'Native studio', description: 'Design a room scanned with the Unifictional 3D Studio app.', robots: { index: false, follow: false } };
export default function MobilePage() { return <NativeBridge />; }
