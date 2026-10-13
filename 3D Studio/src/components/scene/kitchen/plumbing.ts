/**
 * Sink and faucet.
 *
 * The bowl is real fabricated geometry — radiused corners, a 6 mm flat rim, a
 * sloped floor and a drain with its strainer — hanging under the stone so the
 * polished edge of the cut-out reads as a genuine undermount reveal. A
 * farmhouse bowl breaks the cabinet face with an apron; a drop-in keeps its rim
 * on the deck. The faucet is a swept gooseneck with a real escutcheon, a lever
 * on its own hub and an aerator, plus the two things every fitted kitchen
 * actually has beside it: a soap dispenser and a disposal air switch.
 */
import { faucetGooseneck, faucetHandle } from '@/components/scene/detail';
import { inch } from '@/lib/units';
import { compact, prop, surface, type Part, type Vec3 } from './parts';
import { airSwitch, apronFront, drainAssembly, sinkBasin, sinkDivider, soapDispenser } from './helpers';
import type { KitchenLayoutData, KSink } from './layout';

const DIVIDER_T = inch(0.6);
const APRON_H = inch(10);

interface Ctx {
  frame: Part['frame'];
  /** where the sink's centre sits in that frame */
  at: Vec3;
  /** +1 when the faucet should reach toward +z in the frame */
  reach: 1 | -1;
}

function assembly(L: KitchenLayoutData, s: KSink, c: Ctx): Part[] {
  const out: Part[] = [];
  const bowlUtil = s.kind === 'farmhouse' ? 'porcelain' : 'brushed-nickel';
  const rimY = s.kind === 'drop-in' ? L.counterTopY - inch(0.2) : L.carcassTop + inch(0.1);
  const bowls = s.kind === 'double'
    ? (() => { const each = (s.width - DIVIDER_T) / 2; return [{ x: -(each + DIVIDER_T) / 2, w: each }, { x: (each + DIVIDER_T) / 2, w: each }]; })()
    : [{ x: 0, w: s.width }];

  bowls.forEach((b, i) => {
    const g = sinkBasin(b.w, s.depth, s.bowlDepth, s.kind === 'farmhouse' ? inch(1.2) : inch(0.45));
    out.push(prop(`sink-b${i}`, c.frame, bowlUtil, g, { position: [c.at[0] + b.x, rimY, c.at[2]], castShadow: false }));
    out.push(prop(`sink-d${i}`, c.frame, 'chrome', drainAssembly(), {
      position: [c.at[0] + b.x, rimY - s.bowlDepth + inch(0.55), c.at[2] - s.depth * 0.18], castShadow: false, receiveShadow: false,
    }));
  });
  if (s.kind === 'double') {
    out.push(prop('sink-div', c.frame, bowlUtil, sinkDivider(s.depth, s.bowlDepth, DIVIDER_T), {
      position: [c.at[0], rimY - s.bowlDepth / 2, c.at[2]], castShadow: false,
    }));
  }
  if (s.kind === 'drop-in') {
    out.push(prop('sink-rim', c.frame, bowlUtil, sinkBasin(s.width + inch(1.4), s.depth + inch(1.4), inch(0.4), inch(0.6)), {
      position: [c.at[0], L.counterTopY + inch(0.3), c.at[2]], castShadow: false,
    }));
  }

  // deck fittings, set behind the bowl
  const deckZ = c.at[2] - c.reach * (s.depth / 2 + inch(2.2));
  const yaw = c.reach > 0 ? 0 : Math.PI;
  out.push(surface('sink-faucet', c.frame, 'faucet',
    faucetGooseneck({ heightM: inch(17), reachM: inch(9.5), tubeMm: 22, pulldown: true }),
    { position: [c.at[0], L.counterTopY, deckZ], rotation: [0, yaw, 0] }));
  out.push(surface('sink-lever', c.frame, 'faucet', faucetHandle({ kind: 'lever', lengthM: 0.085 }), {
    position: [c.at[0] + inch(4.2), L.counterTopY, deckZ], rotation: [0, yaw, 0], inert: true, castShadow: false,
  }));
  if (s.width > inch(24)) {
    out.push(surface('sink-soap', c.frame, 'faucet', soapDispenser(), {
      position: [c.at[0] - inch(4.6), L.counterTopY, deckZ], rotation: [0, yaw, 0], inert: true, castShadow: false,
    }));
    out.push(surface('sink-air', c.frame, 'faucet', airSwitch(), {
      position: [c.at[0] + inch(7.2), L.counterTopY, deckZ], inert: true, castShadow: false,
    }));
  }
  return out;
}

export function plumbingParts(L: KitchenLayoutData): Part[] {
  const s = L.sink;
  if (!s) return [];

  if (s.where === 'island' && L.island) {
    const isl = L.island;
    const work = -isl.seatSide as 1 | -1;
    return compact(assembly(L, s, { frame: 'island', at: [s.x, 0, work * isl.wide * 0.16], reach: work }));
  }

  if (!s.wall) return [];
  const run = L.runs.find((r) => r.id === s.runId) ?? null;
  const baseDepth = run?.baseDepth ?? L.baseDepth;
  const out = assembly(L, s, { frame: s.wall, at: [s.x, 0, s.z], reach: 1 });
  if (s.kind === 'farmhouse') {
    out.push(prop('sink-apron', s.wall, 'porcelain', apronFront(s.width + inch(1.5), APRON_H, inch(1.25)), {
      position: [s.x, L.carcassTop - APRON_H / 2, baseDepth + inch(0.55)],
    }));
  }
  return compact(out);
}
