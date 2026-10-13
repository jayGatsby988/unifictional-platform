'use client';
/** Renders a catalog material's swatch: a real texture image or a flat colour. Parent must be `position: relative`. */
import Image from 'next/image';
import type { MaterialDef } from '@/lib/materials/catalog';
import { cx } from './cx';
import { swatchColor, useSwatchSrc } from '@/components/scene/swatch';

export function isImageSwatch(m: MaterialDef): boolean {
  return m.swatch.startsWith('/');
}

export function tierLabel(tier: MaterialDef['tier']): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export function categoryLabel(m: MaterialDef): string {
  if (m.subtitle) return m.subtitle;
  return m.category.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function SwatchVisual({ material, sizes = '176px', className }: { material: MaterialDef; sizes?: string; className?: string }) {
  // Procedural materials are drawn client-side from the same generator the 3D
  // view uses; photo textures keep next/image optimisation.
  const src = useSwatchSrc(material);
  if (material.pbr.procedural) {
    return (
      <div
        aria-hidden
        className={cx('absolute inset-0 bg-cover bg-center', className)}
        style={{ backgroundColor: swatchColor(material), backgroundImage: src ? `url("${src}")` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}
      />
    );
  }
  if (isImageSwatch(material)) {
    return <Image src={material.swatch} alt="" fill sizes={sizes} className={cx('object-cover', className)} draggable={false} />;
  }
  return <div aria-hidden className={cx('absolute inset-0', className)} style={{ background: material.swatch }} />;
}
