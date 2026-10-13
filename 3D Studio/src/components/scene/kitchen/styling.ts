/**
 * Styling — a restrained pass so the room reads as lived-in rather than as an
 * empty showroom. Everything here is small, sits ON a surface rather than over
 * it, and is placed by looking at the layout: a board only leans on a stretch
 * of counter that actually exists, the kettle only goes on a range that is
 * really there.
 *
 * How much of it there is comes from the photo: `decor.counterStyling` is
 * 'none' (bare counters — a listing photo), 'minimal' (a bowl and a board) or
 * 'lived-in' (the kettle, the books, the oils by the range). Plants are NOT
 * placed here any more — they are décor the analyzer detects and the Layout
 * tab edits (see decor.ts), so a twin only grows a fig if the photo had one.
 *
 * Nothing in this file may hide a priced surface — the estimator's quantities
 * and the photoreal render both depend on the twin showing what was sold.
 */
import { inch } from '@/lib/units';
import { compact, prop, type Part } from './parts';
import { bookStack, bottle, cuttingBoard, fruit, fruitBowl, kettle, leafCluster, planter } from './helpers';
import { boardBesideRange } from './appliances';
import type { KitchenLayoutData } from './layout';

export function stylingParts(L: KitchenLayoutData): Part[] {
  const level = L.decor.counterStyling;
  if (level === 'none') return [];
  // The photo wins, but only on the surfaces it actually put something on.
  // Suppressing everything the moment ONE item is detected made a photographed
  // kitchen render emptier than an unphotographed one: a single bowl of limes
  // on the island also stripped the board off the splash. So suppression is per
  // HOST surface — the item solver reserved lanes on the hosts it used, so a
  // canned prop on a host it never touched cannot collide with anything, while
  // a host it did touch keeps only the real objects. See items.ts.
  const busy = new Set(L.decor.items.map((i) => i.on));
  const kinds = new Set(L.decor.items.map((i) => i.kind));
  const freeRange = !busy.has('range');
  const freeIsland = !busy.has('island');
  const freeCounter = !busy.has('counter');
  const lived = level === 'lived-in';
  const out: Part[] = [];

  // --- board leaning beside the range --------------------------------------
  const board = freeCounter && !kinds.has('cutting-board') ? boardBesideRange(L) : null;
  if (board) {
    out.push(prop('board', board.wall, 'dark-wood', cuttingBoard(0.30, 0.42, 0.032), {
      position: [board.x, L.counterTopY, inch(3.5)], rotation: [-0.14, 0, 0],
    }));
  }

  // --- kettle on the range (or on the cook-top), oils on the other side ------
  const cooker = L.appliances.find((a) => (a.kind === 'range' || a.kind === 'cooktop') && a.wall !== 'island');
  if (cooker && lived && freeRange) {
    const run = L.runs.find((r) => r.id === cooker.runId);
    const y = cooker.kind === 'range' ? cooker.height + inch(1.4) : L.counterTopY + inch(0.5);
    const z = cooker.kind === 'range' ? cooker.depth * 0.34 : (run?.baseDepth ?? L.baseDepth) * 0.42;
    out.push(prop('kettle', cooker.wall, 'stainless', kettle(), {
      position: [cooker.x - cooker.width * 0.22, y, z],
    }));
    // the oil and vinegar live on whichever side the board is not
    if (run && cooker.wall !== 'island') {
      const side = board && board.x > cooker.x ? -1 : 1;
      const x = cooker.x + side * (cooker.width / 2 + inch(4));
      const seg = freeCounter && !kinds.has('oil-set') && !kinds.has('bottle')
        ? run.counters.find(([a0, a1]) => x - inch(2) > a0 && x + inch(2) < a1)
        : undefined;
      if (seg) {
        out.push(
          prop('oil', cooker.wall, 'glass', bottle(0.034, 0.27), { position: [x, L.counterTopY, run.counterDepth * 0.35], castShadow: false }),
          prop('vinegar', cooker.wall, 'glass', bottle(0.028, 0.22), { position: [x + side * inch(3.2), L.counterTopY, run.counterDepth * 0.48], castShadow: false }),
        );
      }
    }
  }

  // --- island tabletop, or the longest clear counter when there is no island
  const isl = L.island;
  if (isl && freeIsland) {
    const work = -isl.seatSide;
    const bowlX = isl.topLen * (isl.seating > 0 ? -0.22 : 0.22);
    const y = isl.carcassTop + L.counterT;
    const z = isl.topOffset + work * inch(2);
    out.push(prop('isl-bowl', 'island', 'ceramic-matte', fruitBowl(0.13), { position: [bowlX, y, z], castShadow: false }));
    const f = fruit(0.037);
    ([[-0.045, 0.036, 0.010], [0.042, 0.036, -0.028], [0.004, 0.038, 0.038]] as Array<[number, number, number]>).forEach((p, i) => {
      out.push(prop(`isl-fruit${i}`, 'island', i === 1 ? 'plant' : 'leather-tan', f, {
        position: [bowlX + p[0], y + p[1], z + p[2]], castShadow: false,
      }));
    });
    if (lived && isl.topLen > inch(50)) {
      out.push(prop('isl-books', 'island', 'dark-wood', bookStack(), {
        position: [-bowlX * 0.85, y, isl.topOffset + work * inch(1)], castShadow: false,
      }));
    }
  } else if (!isl && freeCounter) {
    let bestLen = 0.9;
    let spot: { wall: Part['frame']; x: number; z: number } | null = null;
    for (const run of L.runs) {
      for (const [x0, x1] of run.counters) {
        const len = x1 - x0;
        if (len <= bestLen) continue;
        const sinkX = L.sink && L.sink.runId === run.id ? L.sink.x : null;
        const mid = (x0 + x1) / 2;
        const cx = sinkX !== null && Math.abs(sinkX - mid) < len / 4
          ? (sinkX > mid ? x0 + len * 0.2 : x1 - len * 0.2)
          : mid;
        bestLen = len;
        spot = { wall: run.wall, x: cx, z: run.counterDepth * 0.45 };
      }
    }
    if (spot) {
      out.push(prop('bowl', spot.wall, 'ceramic-matte', fruitBowl(0.12), { position: [spot.x, L.counterTopY, spot.z], castShadow: false }));
      if (lived) {
        out.push(
          prop('herb-pot', spot.wall, 'ceramic-matte', planter(0.075, 0.13), { position: [spot.x + inch(12), L.counterTopY, spot.z], castShadow: false }),
          prop('herb-leaves', spot.wall, 'plant', leafCluster(0.62), { position: [spot.x + inch(12), L.counterTopY + 0.13, spot.z], castShadow: false }),
          prop('books', spot.wall, 'dark-wood', bookStack(), { position: [spot.x - inch(12), L.counterTopY, spot.z], castShadow: false }),
        );
      }
    }
  }

  return compact(out);
}
