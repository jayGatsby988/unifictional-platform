'use client';
/**
 * Lighting: the shared InteriorRig (daylight through the spec's windows plus
 * the recessed can layout), pendants hung over the island — or the sink when
 * there is no island — an optional chandelier, and LED strips under every wall
 * cabinet that has a bottom.
 */
import { useMemo } from 'react';
import { InteriorRig, PendantLight, UnderCabinetStrip, useLightQuality } from '@/components/scene/Lighting';
import { useSlotMaterial } from '@/components/scene/materials';
import { OnWall } from '@/components/scene/bathroom/OnWall';
import { pendantDrop, pendantPositions, type KitchenLayoutData } from './layout';
import { kitchenDaylightWindows } from './daylight';
import { ScannedRoomLighting } from '../ScannedRoomLighting';
import { useScanView } from '../scan-view-store';


export function KitchenLighting({ L }: { L: KitchenLayoutData }) {
  const source = useScanView(s => s.mode === 'source');
  const shade = useSlotMaterial('lighting_fixture');
  const quality = useLightQuality();

  const windows = useMemo(() => kitchenDaylightWindows(L), [L]);

  // the hook points and the drop come from the layout (spread / offset /
  // height above the counter from the spec), so the photo fitter's boxes and
  // the shades on screen are the same thing
  const pendants = useMemo(() => pendantPositions(L), [L]);
  const drop = pendantDrop(L);

  // What the floor contact pass captured. Everything here is something whose
  // FOOTPRINT is drawn — the room, the base runs, the island body — so moving
  // any of them has to re-render the pass; a material swap or a wall-cabinet
  // change must not, because that pass costs a whole scene traversal.
  const contactKey = useMemo(() => {
    const runs = L.runs.map((r) => `${r.wall}:${r.x0.toFixed(2)}:${r.x1.toFixed(2)}`).join('|');
    const isle = L.island ? `${L.island.cx.toFixed(2)},${L.island.cz.toFixed(2)},${L.island.len.toFixed(2)},${L.island.wide.toFixed(2)},${L.island.yaw.toFixed(2)}` : '-';
    return `${L.w.toFixed(2)}x${L.d.toFixed(2)}|${runs}|${isle}`;
  }, [L]);

  if (L.scanGeometry && source) return <ScannedRoomLighting geometry={L.scanGeometry} quality={quality} naturalLight={L.lighting.naturalLight} />;
  return (
    <group name="lighting">
      {L.scanGeometry ? <ScannedRoomLighting geometry={L.scanGeometry} quality={quality} naturalLight={L.lighting.naturalLight} /> : <InteriorRig
        w={L.w}
        d={L.d}
        h={L.h}
        windows={windows}
        recessed={L.lighting.recessed}
        colorTempK={L.lighting.colorTempK}
        naturalLight={L.lighting.naturalLight}
        castingCans={2}
        quality={quality}
        contactKey={contactKey}
      />}
      {pendants.map((p, i) => (
        <PendantLight
          key={i}
          position={p}
          dropM={drop}
          style={L.lighting.pendants?.style ?? 'globe'}
          finish={L.lighting.pendants?.finish}
          shadeMaterial={shade}
          colorTempK={L.lighting.colorTempK}
          intensity={3.2}
          // one pendant casts, and only on the top tier: the pool it throws on
          // the island is what tells the eye the fixture is above the counter
          // rather than pasted on it, and a second shadow map buys nothing
          castShadow={quality === 'high' && i === 0}
        />
      ))}
      {L.lighting.chandelier && !L.island && (
        <PendantLight
          position={[0, L.h, 0]}
          dropM={Math.max(0.3, L.h - 2.15)}
          style="drum"
          finish={L.lighting.pendants?.finish}
          shadeMaterial={shade}
          colorTempK={L.lighting.colorTempK}
          intensity={5}
        />
      )}
      {L.lighting.underCabinet && L.runs.map((run) => (
        run.underCab.length ? (
          <OnWall key={run.id} wall={run.wall} w={L.w} d={L.d}>
            {run.underCab.map(([x0, x1, y], i) => (
              <UnderCabinetStrip
                key={i}
                position={[(x0 + x1) / 2, y - 0.012, Math.max(0.04, run.upperDepth - 0.06)]}
                length={x1 - x0}
                colorTempK={L.lighting.colorTempK}
              />
            ))}
          </OnWall>
        ) : null
      ))}
    </group>
  );
}
