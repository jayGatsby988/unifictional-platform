import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    // Renders and uploaded photos live in Vercel Blob; allow any Blob store host.
    remotePatterns: [
      { protocol: 'https', hostname: '*.public.blob.vercel-storage.com' },
      { protocol: 'https', hostname: '*.blob.vercel-storage.com' },
    ],
    formats: ['image/avif', 'image/webp'],
  },
  // .hdr environment maps are fetched at runtime by three.js, not bundled.
  outputFileTracingIncludes: {
    '/studio': ['./public/hdri/**', './public/textures/**'],
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
};

export default nextConfig;
