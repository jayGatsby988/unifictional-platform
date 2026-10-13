'use client';
/**
 * Rear deck: real 5/4 boards with a 5 mm gap running parallel to the ledger,
 * drawn as ONE instanced call however many boards there are; a rim-joist frame
 * with chamfered arrises; 6×6 posts on concrete pads with post bases; a railing
 * with instanced balusters around the three open sides; and a stair flight with
 * nosed treads and cut stringers.
 *
 * Board direction comes from WHICH WALL the deck is on, never from whichever
 * fitted dimension came out larger — see the note in `layout.ts`.
 */
import { useMemo } from 'react';
import { InstancedSurface, Prop, Surface } from '@/components/scene/Surface';
import { transformed, screwHead } from '@/components/scene/detail';
import { ft } from '@/lib/units';
import { merged } from './helpers';
import { cbox, deckBoards, railingParts, stairUnit } from './detail-ext';
import type { LDeck } from './layout';

export function Deck({ d }: { d: LDeck }) {
  const built = useMemo(() => {
    const railH = ft(3);
    const stairW = Math.min(ft(4.5), Math.max(ft(3), d.w * 0.35));
    const posts: Array<[number, number]> = [];
    const nx = Math.max(2, Math.round(d.w / ft(7)));
    const nz = Math.max(1, Math.round(d.depth / ft(7)));
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= nz; j++) {
        if (j === 0) continue; // the house side is ledger-supported
        posts.push([-d.w / 2 + (d.w * i) / nx, -d.depth / 2 + (d.depth * j) / nz]);
      }
    }
    const frontLen = Math.max(ft(1), (d.w - stairW) / 2 - 0.12);
    return {
      railH, stairW, posts, frontLen,
      field: (() => {
        const f = deckBoards(d.w, d.depth, d.boardsAlong);
        // lift the boards onto the deck surface HERE, inside the memo — doing it
        // inline in JSX would hand <InstancedSurface/> a fresh array on every
        // render and make it rebake every matrix each time.
        return {
          board: f.board,
          rim: f.rim,
          transforms: f.transforms.map((t) => ({
            position: [t.position![0], d.floorY + t.position![1], t.position![2]] as [number, number, number],
          })),
        };
      })(),
      post: cbox(0.14, Math.max(0.2, d.floorY - 0.02), 0.14, 0.004),
      postBase: cbox(0.16, 0.03, 0.16, 0.003),
      pad: cbox(0.34, 0.1, 0.34, 0.006),
      railFront: railingParts(frontLen, railH, 'baluster'),
      railSide: railingParts(d.depth - 0.16, railH, 'baluster'),
      stairs: stairUnit(stairW, d.floorY, d.steps),
      ledger: (() => {
        const board = cbox(d.w, 0.24, 0.05, 0.003);
        const parts = [board];
        // the lag bolts that actually hold a deck onto a house
        const n = Math.max(3, Math.min(24, Math.round(d.w / 0.41)));
        for (let i = 0; i < n; i++) {
          const y = (i % 2 ? 0.06 : -0.06);
          parts.push(transformed(screwHead(14), {
            position: [-d.w / 2 + (d.w * (i + 0.5)) / n, y, 0.028],
            rotation: [Math.PI / 2, 0, 0],
          }));
        }
        return merged(parts);
      })(),
      fascia: cbox(d.w + 0.02, 0.26, 0.02, 0.0025),
    };
  }, [d]);

  const showFrontRail = d.railing && built.frontLen > ft(1.2);

  return (
    <group position={[d.frame.cx, 0, d.frame.cz]} rotation={[0, d.frame.yaw, 0]} name="deck">
      <group position={[d.x, 0, d.depth / 2]}>
        <InstancedSurface slot="deck" geometry={built.field.board} transforms={built.field.transforms} />
        <Surface slot="deck" inert geometry={built.field.rim} position={[0, d.floorY, 0]} castShadow receiveShadow />
        <Surface slot="deck" inert geometry={built.fascia} position={[0, d.floorY - 0.145, d.depth / 2 + 0.02]} castShadow />
        <Surface slot="deck" inert geometry={built.ledger} position={[0, d.floorY - 0.13, -d.depth / 2 + 0.03]} />
        {built.posts.map((p, i) => (
          <group key={`post-${i}`}>
            <Surface slot="deck" inert geometry={built.post} position={[p[0], (d.floorY - 0.02) / 2 + 0.06, p[1]]} castShadow />
            <Prop util="anodized" geometry={built.postBase} position={[p[0], 0.09, p[1]]} castShadow={false} />
            <Surface slot="patio" inert geometry={built.pad} position={[p[0], 0.04, p[1]]} receiveShadow />
          </group>
        ))}
        {showFrontRail && ([-1, 1] as const).map((s) => (
          <group key={`front-${s}`} position={[s * (built.stairW / 2 + built.frontLen / 2 + 0.06), d.floorY, d.depth / 2 - 0.07]}>
            <Surface slot="railing" geometry={built.railFront.frame} castShadow />
            {built.railFront.transforms.length > 0 && (
              <InstancedSurface slot="railing" geometry={built.railFront.baluster} transforms={built.railFront.transforms} inert />
            )}
          </group>
        ))}
        {d.railing && ([-1, 1] as const).map((s) => (
          <group key={`side-${s}`} position={[s * (d.w / 2 - 0.07), d.floorY, 0]} rotation={[0, Math.PI / 2, 0]}>
            <Surface slot="railing" geometry={built.railSide.frame} castShadow />
            {built.railSide.transforms.length > 0 && (
              <InstancedSurface slot="railing" geometry={built.railSide.baluster} transforms={built.railSide.transforms} inert />
            )}
          </group>
        ))}
        <Surface slot="deck" geometry={built.stairs} position={[0, d.floorY, d.depth / 2]} receiveShadow castShadow />
      </group>
    </group>
  );
}
