import type { Metadata } from 'next';
import { Landing } from '@/components/landing/Landing';

export const metadata: Metadata = {
  title: { absolute: 'Unifictional 3D Studio — photo to 3D remodel studio for contractors' },
  description:
    'Upload photos of a kitchen, bathroom or lot and get an explorable 3D twin in about 60 seconds. Swap 250+ real materials with live line-item pricing, render photoreal images from the client’s own photo, and share a link they can spin on their phone.',
  openGraph: {
    title: 'Unifictional 3D Studio — photo to 3D remodel studio',
    description: 'Photo → 3D twin → live-priced, photoreal redesign in about 60 seconds. Built for contractors, remodelers, designers and DADU/ADU builders.',
    type: 'website',
    images: [{ url: '/demo/kitchen-after.jpg', width: 2048, height: 2048, alt: 'Unifictional 3D Studio photoreal render of a kitchen with navy cabinets and Calacatta quartz' }],
  },
};

export default function HomePage() {
  return <Landing />;
}
