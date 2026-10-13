'use client';
/**
 * The built volumes: main mass, optional wing (accent siding on its outward
 * face so both siding slots always read), detached garage — each with its own
 * elevations, corner trim, roof and the wall-mounted fittings that a real house
 * carries (hose bib, meter, dryer vent, house numbers, doorbell, condenser).
 */
import { useMemo } from 'react';
import { Prop, Surface } from '@/components/scene/Surface';
import { CornerTrim, Elevation, SillShadow } from './Elevations';
import { Chimney, RoofMass, type BracketStyle } from './Roof';
import { solid } from './helpers';
import {
  acCondenser, doorbellButton, extOutlet, hoseBib, houseNumbers, louverVent, meterBox, ventHood,
} from './detail-ext';
import type { ExteriorLayout, LBlock, LUtility } from './layout';

/**
 * Which knee bracket a style hangs under its eaves. Deriving it from the
 * DECLARED house style (never from the fitted geometry) keeps it stable when a
 * dimension slider moves.
 */
const BRACKETS: Partial<Record<string, BracketStyle>> = {
  craftsman: 'craftsman',
  'modern-farmhouse': 'craftsman',
  victorian: 'scroll',
  tudor: 'timber',
  'northwest-contemporary': 'timber',
  'cape-cod': 'scroll',
};

function Block({ block, trimW, accent, brackets }: { block: LBlock; trimW: number; accent: boolean; brackets: BracketStyle | null }) {
  const skirt = useMemo(() => (block.foundation > 0.02 ? null : solid(block.w + 0.04, 0.06, block.d + 0.04)), [block.w, block.d, block.foundation]);
  return (
    <group name={`mass-${block.key}`}>
      {block.elevations.map((e) => (
        <Elevation
          key={`${block.key}-${e.wall}`}
          block={block}
          elev={e}
          trimW={trimW}
          accentFace={accent && block.accentWall === e.wall}
        />
      ))}
      {skirt && <Surface slot="foundation" inert geometry={skirt} position={[block.cx, 0.03, block.cz]} receiveShadow />}
      <SillShadow block={block} />
      <CornerTrim block={block} trimW={trimW} />
      <RoofMass shape={block.roof} cx={block.cx} cz={block.cz} eaveY={block.eaveY} brackets={brackets} />
    </group>
  );
}

/**
 * Everything screwed to the outside of a house. Individually trivial; together
 * they are most of the difference between a rendering and a photograph, because
 * the eye reads them as evidence that the building is in service.
 */
function Utility({ u }: { u: LUtility }) {
  const geo = useMemo(() => {
    switch (u.kind) {
      case 'hose-bib': return hoseBib();
      case 'meter': return meterBox();
      case 'dryer-vent': return ventHood();
      case 'outlet': return extOutlet();
      case 'doorbell': return doorbellButton();
      case 'numbers': return houseNumbers();
      case 'vent-louver': return louverVent(0.3, 0.24);
      default: return acCondenser();
    }
  }, [u.kind]);
  const util = u.kind === 'hose-bib' ? 'brushed-brass'
    : u.kind === 'meter' ? 'anodized'
      : u.kind === 'ac-condenser' ? 'anodized'
        : u.kind === 'numbers' ? 'matte-black'
          : u.kind === 'doorbell' ? 'oil-rubbed-bronze'
            : 'white-plastic';
  return (
    <Prop
      util={util}
      geometry={geo}
      position={u.position}
      rotation={[0, u.yaw, 0]}
      castShadow={u.kind === 'ac-condenser'}
      receiveShadow={false}
    />
  );
}

export function House({ L }: { L: ExteriorLayout }) {
  if (!L.house) return null;
  const brackets = BRACKETS[L.houseStyle] ?? null;
  return (
    <group name="house">
      <Block block={L.house} trimW={L.trimW} accent={false} brackets={brackets} />
      {L.wing && <Block block={L.wing} trimW={L.trimW} accent brackets={brackets} />}
      {L.garage && <Block block={L.garage} trimW={L.trimW} accent={false} brackets={brackets} />}
      {L.chimney && <Chimney x={L.chimney.x} z={L.chimney.z} base={L.chimney.base} height={L.chimney.height} />}
      <group name="fittings">
        {L.utilities.map((u, i) => <Utility key={`util-${i}`} u={u} />)}
      </group>
    </group>
  );
}
