'use client';
/**
 * <ExteriorScene spec={ExteriorSpec}/> — procedural lot + house twin.
 * Renders three.js content only (no Canvas); the Studio wraps it in
 * <SceneCanvas env="exterior" rig={exteriorRigFor(spec)}>.
 *
 * SITE FRAME: the lot is centred at the origin, grade at y = 0, **+z is the
 * street**, and the house sits `setbackFrontFt` back from the front edge.
 * Building walls face OUTWARD (see `helpers.ts`), the opposite of the interior
 * room builders.
 *
 * When `house.present` is false the upload was an EMPTY LOT. We still build a
 * house — the one the intake answers describe (storeys, footprint, roof shape,
 * siding, trim, garage bays, porch) — and ring it with the zoning envelope so
 * it reads as a proposal rather than as a survey of what is standing today.
 */
import { useMemo } from 'react';
import type { ExteriorSpec } from '@/lib/spec/types';
import { exteriorRig, type CameraRig } from '@/components/scene/SceneCanvas';
import { ft } from '@/lib/units';
import { computeExteriorLayout } from './layout';
import { House } from './House';
import { Porch } from './Porch';
import { Deck } from './Deck';
import { Hardscape } from './Hardscape';
import { BuildableOutline, Fencing, Ground, Planting } from './Landscape';
import { ExteriorLighting } from './ExteriorLighting';

export { exteriorSummary } from './summary';
export { computeExteriorLayout } from './layout';
export type { ExteriorLayout } from './layout';

export function ExteriorScene({ spec }: { spec: ExteriorSpec }) {
  const L = useMemo(() => computeExteriorLayout(spec), [spec]);
  return (
    <group name="exterior">
      <Ground L={L} />
      <Hardscape L={L} />
      <House L={L} />
      {L.porch && <Porch p={L.porch} />}
      {L.deck && <Deck d={L.deck} />}
      {L.proposed && <BuildableOutline L={L} />}
      <Fencing L={L} />
      <Planting L={L} />
      <ExteriorLighting L={L} />
    </group>
  );
}

/**
 * Camera rig framing the house from the street side, three-quarter on. Derived
 * from the shared `exteriorRig()` helper and then re-anchored onto the house
 * (which sits well back from the lot centre) so the massing fills the frame.
 * Tolerates a null / half-built spec.
 */
export function exteriorRigFor(spec: ExteriorSpec | null | undefined): CameraRig {
  const L = computeExteriorLayout(spec);
  const base = exteriorRig(
    L.lotWidthFt,
    L.lotDepthFt,
    L.house ? L.house.d / ft(1) : (L.buildable.maxZ - L.buildable.minZ) / ft(1),
    L.house ? (L.house.stories as 1 | 2 | 3) : 2,
  );
  // Frame the whole composition, not just the main box: a garage wing that
  // projects 22 ft toward the street would otherwise fall out of shot.
  const parts = L.blocks.map((bl) => bl.rect);
  if (L.porch) parts.push(L.porch.rect);
  if (L.deck) parts.push(L.deck.rect);
  if (!parts.length) parts.push(L.buildable);
  const bb = parts.reduce((a, r) => ({
    minX: Math.min(a.minX, r.minX), maxX: Math.max(a.maxX, r.maxX),
    minZ: Math.min(a.minZ, r.minZ), maxZ: Math.max(a.maxZ, r.maxZ),
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });

  const cx = (bb.minX + bb.maxX) / 2;
  const cz = (bb.minZ + bb.maxZ) / 2;
  const w = bb.maxX - bb.minX;
  const d = bb.maxZ - bb.minZ;
  const top = L.blocks.length
    ? Math.max(...L.blocks.map((bl) => bl.eaveY + bl.roof.rise))
    : ft(20);

  // Frame the whole property, not just the house. A 48-degree lens needs real
  // distance: at span * 1.0 the camera stood inside the front planting and the
  // street trees filled the shot. The extra reach also keeps the roof ridge and
  // the driveway apron in frame on a two-storey house.
  const span = Math.max(w, d, ft(24));
  const radius = span * 1.55 + ft(30);
  const swing = 0.6; // ~34 degrees off the street axis
  const eye = Math.max(top * 0.78, ft(13));

  const position: [number, number, number] = [
    cx + Math.sin(swing) * radius,
    eye,
    bb.maxZ + Math.cos(swing) * radius,
  ];
  const target: [number, number, number] = [cx, top * 0.45, cz];

  return {
    ...base,
    target,
    position,
    minDistance: Math.max(3, span * 0.35),
    maxDistance: Math.max(base.maxDistance ?? 60, radius * 2.4),
    bounds: {
      minX: -L.lotW / 2 - ft(10), maxX: L.lotW / 2 + ft(10),
      minZ: -L.lotD / 2 - ft(6), maxZ: L.lotD / 2 + ft(30),
    },
    eyeHeight: 1.7,
    fov: 48,
  };
}
