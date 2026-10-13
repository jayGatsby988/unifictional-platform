'use client';
/**
 * Lighting: the shared InteriorRig (window daylight, recessed cans with real
 * trim rings), pendants or a chandelier where the spec calls for them, and the
 * exhaust fan every bathroom has — a louvred grille in a housing, screwed to
 * the ceiling, not a floating grey square.
 */
import { useMemo } from 'react';
import { InteriorRig, PendantLight } from '@/components/scene/Lighting';
import { useSlotMaterial } from '@/components/scene/materials';
import { Prop } from '@/components/scene/Surface';
import { fanGrille } from './helpers';
import { useDetailTier } from './quality';
import { rectCenter, type BathLayout } from './layout';

export function BathLighting({ L, measuredRoom = false }: { L: BathLayout; measuredRoom?: boolean }) {
  const shade = useSlotMaterial('lighting_fixture');
  const tier = useDetailTier();
  const windows = useMemo(
    () => L.openings.filter((o) => o.kind === 'window').map((o) => ({ wall: o.wall, t: o.t, width: o.width, height: o.height, sill: o.sill })),
    [L.openings],
  );
  const pendants = useMemo<[number, number, number][]>(() => {
    const p = L.lighting.pendants;
    if (!p) return [];
    const n = Math.min(3, p.count);
    const out: [number, number, number][] = [];
    if (L.tub) {
      const [cx, cz] = rectCenter(L.tub.rect);
      const along = L.tub.wall === 'back' || L.tub.wall === 'front' ? 'x' : 'z';
      const span = L.tub.length * 0.6;
      for (let i = 0; i < n; i++) {
        const off = n === 1 ? 0 : -span / 2 + (span * i) / (n - 1);
        out.push([along === 'x' ? cx + off : cx, L.h, along === 'z' ? cz + off : cz]);
      }
    } else {
      for (let i = 0; i < n; i++) out.push([n === 1 ? 0 : -0.5 + i * (1 / (n - 1)), L.h, 0]);
    }
    return out;
  }, [L.lighting.pendants, L.tub, L.h]);
  const fanPos = useMemo<[number, number, number]>(() => {
    if (L.shower) { const [cx, cz] = rectCenter(L.shower.rect); return [cx, L.h - 0.006, cz]; }
    return [L.w * 0.25, L.h - 0.006, -L.d * 0.2];
  }, [L.shower, L.w, L.d, L.h]);
  const fan = useMemo(() => fanGrille(0.30), []);
  const drop = Math.max(0.3, L.h - 2.15);

  return (
    <group name="lighting">
      <InteriorRig
        w={L.w} d={L.d} h={L.h}
        windows={windows}
        recessed={L.lighting.recessed}
        colorTempK={L.lighting.colorTempK}
        naturalLight={L.lighting.naturalLight}
        castingCans={2}
        quality={tier}
        contactShadows={!measuredRoom}
      />
      {pendants.map((p, i) => (
        <PendantLight key={i} position={p} dropM={drop} style={L.lighting.pendants?.style ?? 'globe'} shadeMaterial={shade} colorTempK={L.lighting.colorTempK} intensity={3} />
      ))}
      {L.lighting.chandelier && (
        <PendantLight position={[0, L.h, 0]} dropM={Math.max(0.3, L.h - 2.2)} style="drum" shadeMaterial={shade} colorTempK={L.lighting.colorTempK} intensity={6} />
      )}
      {!measuredRoom && <Prop util="white-plastic" geometry={fan} position={fanPos} castShadow={false} />}
    </group>
  );
}
