'use client';
/**
 * Picks the room builder for the current spec and derives the camera rig,
 * environment preset and summary chips from it.
 */
import { useMemo } from 'react';
import type { RoomSpec, RoomType } from '@/lib/spec/types';
import { floorPlanSummary } from '@/lib/spec/floorplan';
import { exteriorRig, interiorRig, type CameraRig, type EnvPreset } from '@/components/scene/SceneCanvas';
import { KitchenScene, kitchenRig, kitchenSummary } from '@/components/scene/kitchen/KitchenScene';
import { BathroomScene, bathroomRig, bathroomSummary } from '@/components/scene/bathroom/BathroomScene';
import { ExteriorScene, exteriorRigFor, exteriorSummary } from '@/components/scene/exterior/ExteriorScene';
import { FloorPlanScene } from '@/components/scene/floorplan/FloorPlanScene';
import { fmtFt } from '@/lib/units';
import { floorPlanRig } from '@/components/scene/floorplan/camera';
import { DEFAULT_PHOTO_ASPECT, photoMatchRig, solvedCameraFor, solvedCameraRig } from './photoMatch';
import { useProjectStore } from '@/lib/store/project-store';
import { activeSlotsFor } from './projectUtils';
import { scannedRoomRig } from '@/components/scene/scanned-camera';
import { useScanView } from '@/components/scene/scan-view-store';
import { useNativeMesh } from '@/lib/native/mesh-store';
import { observedMeshRig } from '@/components/scene/observed-mesh-camera';

export { floorPlanRig };

export function envFor(roomType: RoomType): EnvPreset {
  return roomType === 'exterior' ? 'exterior' : 'interior';
}

function fallbackRig(spec: RoomSpec): CameraRig {
  if (spec.roomType === 'floorplan') return floorPlanRig(spec);
  if (spec.roomType === 'exterior') {
    return exteriorRig(spec.lot.widthFt, spec.lot.depthFt, spec.house.footprint.depthFt, spec.house.stories);
  }
  const lookAt = spec.detected?.camera?.lookingAt;
  return interiorRig(spec.dims.widthFt, spec.dims.depthFt, spec.dims.ceilingFt, { lookAt: lookAt === 'left' || lookAt === 'right' ? lookAt : 'back' });
}

/**
 * The scene's own framing: a pulled-back three-quarter view that shows the
 * whole room. This is what the orbit camera opens on.
 */
export function rigFor(spec: RoomSpec): CameraRig {
  let rig: CameraRig | undefined;
  try {
    if (spec.roomType === 'kitchen') rig = kitchenRig(spec);
    else if (spec.roomType === 'bathroom') rig = bathroomRig(spec);
    else if (spec.roomType === 'floorplan') rig = floorPlanRig(spec);
    else rig = exteriorRigFor(spec);
  } catch {
    rig = undefined;
  }
  if (!rig || !Array.isArray(rig.position) || !Array.isArray(rig.target)) return fallbackRig(spec);
  return rig;
}

/**
 * Framing that stands where the client's photo was taken. The fitter's solved
 * camera wins when the spec has one — it is exact (position, bearing, vertical
 * lens), so the photo overlay lines up. Otherwise the analyzer's rough
 * estimate is used; `aspect` is the photo's width ÷ height, which that rig
 * needs to turn the estimate's horizontal field of view into a vertical one.
 * Falls back to the scene's own rig.
 */
export function matchedRigFor(spec: RoomSpec, aspect: number = DEFAULT_PHOTO_ASPECT): CameraRig {
  const usable = (rig: CameraRig | null) => Boolean(rig && Array.isArray(rig.position) && Array.isArray(rig.target) && [...rig.position, ...rig.target].every(Number.isFinite));
  try {
    const solved = solvedCameraFor(spec);
    const exact = solved ? solvedCameraRig(solved, spec) : null;
    if (exact && usable(exact)) return exact;
  } catch {
    /* fall through to the estimate */
  }
  try {
    const matched = photoMatchRig(spec, aspect);
    if (matched && usable(matched)) return matched;
  } catch {
    /* fall through */
  }
  return rigFor(spec);
}

/**
 * Rig with a stable object identity for as long as its values do not change,
 * so SceneCanvas does not reset the camera on every unrelated spec edit.
 */
export function useStableRig(spec: RoomSpec | null, matchPhoto = false, aspect?: number): CameraRig | null {
  const floor = useProjectStore((s) => s.ui.floorPlanLevel);
  const focus = useScanView(s => s.focus);
  const mode = useScanView(s => s.mode);
  const projectId = useProjectStore(s => s.project.id);
  const mesh = useNativeMesh(s => s.projectId === projectId ? s.mesh : null);
  const scan = spec && 'scanGeometry' in spec ? spec.scanGeometry : undefined;
  const scanRig = scan && !matchPhoto ? scannedRoomRig(scan, { focus }) : null;
  const key = spec ? JSON.stringify(scanRig ? mode === 'source' && mesh ? observedMeshRig(mesh.bounds, scanRig) : scanRig : spec.roomType === 'floorplan' ? floorPlanRig(spec, floor) : matchPhoto ? matchedRigFor(spec, aspect) : rigFor(spec)) : '';
  return useMemo(() => (key ? (JSON.parse(key) as CameraRig) : null), [key]);
}

function fallbackSummary(spec: RoomSpec): string[] {
  if (spec.roomType === 'kitchen') {
    return [
      `${fmtFt(spec.dims.widthFt)} × ${fmtFt(spec.dims.depthFt)}`,
      `${spec.layout.replace('-', ' ')} layout`,
      spec.island.present ? `${fmtFt(spec.island.lengthFt)} island` : 'no island',
      `${fmtFt(spec.dims.ceilingFt)} ceilings`,
    ];
  }
  if (spec.roomType === 'bathroom') {
    return [
      `${fmtFt(spec.dims.widthFt)} × ${fmtFt(spec.dims.depthFt)}`,
      `${spec.layout.replace('-', ' ')} bath`,
      spec.vanity.present ? `${spec.vanity.widthIn}" vanity` : 'no vanity',
      spec.shower.present ? `${spec.shower.enclosure.replace('-', ' ')} shower` : spec.tub.present ? `${spec.tub.kind} tub` : 'no shower',
    ];
  }
  if (spec.roomType === 'floorplan') return floorPlanSummary(spec);
  return [
    `${fmtFt(spec.lot.widthFt)} × ${fmtFt(spec.lot.depthFt)} lot`,
    spec.house.present ? `${spec.house.stories}-story ${spec.houseStyle.replace(/-/g, ' ')}` : 'empty lot',
    `${spec.house.roof.type.replace('-', ' ')} roof`,
    spec.house.garage.present ? `${spec.house.garage.bays}-car garage` : 'no garage',
  ];
}

function normalizeSummary(raw: unknown, spec: RoomSpec): string[] {
  if (Array.isArray(raw)) {
    const list = raw
      .map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' && 'label' in x ? String((x as { label: unknown }).label) : ''))
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length) return list;
  } else if (typeof raw === 'string' && raw.trim()) {
    return raw.split(/\s*[·•|]\s*/).map((s) => s.trim()).filter(Boolean);
  } else if (raw && typeof raw === 'object') {
    const list = Object.values(raw as Record<string, unknown>).filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    if (list.length) return list;
  }
  return fallbackSummary(spec);
}

/** Summary chips for the top bar, tolerant of whatever shape the scene module returns. */
export function summaryFor(spec: RoomSpec, selections?: Record<string, string>): string[] {
  if (spec.roomType === 'kitchen' && selections) {
    const cabinetSlots = activeSlotsFor(spec, spec.roomType).filter((slot) => slot.startsWith('cabinets_') || slot === 'island_cabinets');
    const finishes = new Set(cabinetSlots.map((slot) => selections[slot] ?? spec.materials[slot as keyof typeof spec.materials]).filter(Boolean));
    spec = { ...spec, cabinets: { ...spec.cabinets, twoTone: finishes.size > 1 } };
  }
  let raw: unknown = null;
  try {
    if (spec.roomType === 'kitchen') raw = kitchenSummary(spec);
    else if (spec.roomType === 'bathroom') raw = bathroomSummary(spec);
    else if (spec.roomType === 'floorplan') raw = floorPlanSummary(spec);
    else raw = exteriorSummary(spec);
  } catch {
    raw = null;
  }
  return normalizeSummary(raw, spec).slice(0, 6);
}

export function SceneRouter({ spec }: { spec: RoomSpec }) {
  if (spec.roomType === 'kitchen') return <KitchenScene spec={spec} />;
  if (spec.roomType === 'bathroom') return <BathroomScene spec={spec} />;
  // The house: walls on the sheet's centre lines, a floor and a ceiling per
  // room, cased openings, and a stair that connects the storeys it claims to.
  // Everything goes through `planToScene` (@/lib/spec/floorplan) — the rig
  // above is derived from the same mapping, so the camera and the geometry
  // cannot end up in different places.
  if (spec.roomType === 'floorplan') return <FloorPlanScene spec={spec} />;
  return <ExteriorScene spec={spec} />;
}
