/**
 * Appliances.
 *
 * The difference between a box and a fridge is entirely in the details a
 * photograph shows: the soft dark gasket just inside each door, the 3 mm reveal
 * between the doors, the louvred kick grille, the badge, the dispenser recess,
 * the heavy handles on their stand-offs with the set screws visible. Same for
 * the range — cast grates over sealed burners, knobs with pointers, an oven
 * door with a real bezel and a glass panel — and the hood, which is a tapered
 * sheet-metal shell with a rolled lip, baffle filters and a control strip.
 *
 * FINISH. Every body, door and canopy follows the room's `appliances` slot
 * (panel-ready fronts borrow the base cabinet slot) so the estimator's finish
 * word is what the twin shows. A unit whose OWN finish differs from the room's
 * — a matte-black hood over a stainless range, a white fridge — carries
 * `bodyFinish`, and its parts are `finished()`: drawn in that look, still
 * labelled with the slot so a click opens the appliances line (see `Look` in
 * parts.ts). Stainless bodies use the anisotropic `stainless` finish so the
 * highlight stretches the way brushed metal's does.
 *
 * HOOD SHAPE. `hoodShape` decides the canopy: a straight 'box', the 'tapered'
 * pyramid, a 'curved' bell with a concave flare, a 'wood-canopy' box in the
 * uppers' finish, or a 'slim' insert under a cabinet.
 *
 * WHAT IS ABOVE THE CANOPY. The duct cover is drawn from the canopy top up to
 * `hoodExtents(a).top`, and that top is whatever the LAYOUT resolved — so this
 * file needs no rule of its own. With a cabinet on the hood the layout puts
 * `top` at the cabinet's underside, which makes the flue exactly 0 high (no
 * part, no seam) when the cabinet sits straight on the canopy, and exactly the
 * visible gap when `heightIn` lifted it. With nothing above it, the cover
 * telescopes to the ceiling, or to the top of the wall cabinets for a wood
 * canopy's chase. A wood canopy under a cabinet therefore loses its 80 %-wide
 * chase — the cabinet replaces it — and keeps its 1.25" crown band as the seat.
 */
import { chamferBox, filletBox } from '@/components/scene/detail';
import { inch } from '@/lib/units';
import type { Appliance } from '@/lib/spec/types';
import { compact, finished, prop, surface, type Look, type Part, type PartOpts, type UtilKind, type Vec3 } from './parts';
import {
  applianceBadge, applianceHandle, burnerGrates, controlKnobs, cooktopRings,
  doorGasket, hangingTowel, hoodBell, hoodCanopy, hoodInterior, keypad, louvreGrille,
  ovenWindow, pocketHandle, waterDispenser, wireRack,
} from './helpers';
import { REVEAL, hoodExtents, type KAppliance, type KitchenLayoutData } from './layout';

const FRONT_T = inch(1.25);

/**
 * Appliance sheet metal is PRESSED, not machined.
 *
 * The arris down a fridge door or a range front is a real 3.5 mm radius, and it
 * is that radius — not the flat — that carries the long soft specular streak a
 * stainless door reads by. A 1.6–2 mm CHAMFER is what a stone counter's edge is,
 * and using it on every body and door made the appliances look milled out of
 * solid billet. Bodies and doors take the radius; fascias, control strips and
 * panels stay chamfered, because those really are cut sheet.
 */
const SKIN_R = 0.0035;
const skin = (w: number, h: number, d: number) => filletBox(w, h, d, SKIN_R, 2);

type F = Part['frame'];

// ---------------------------------------------------------------------------
// Finish
// ---------------------------------------------------------------------------

/** The finish word this unit is drawn in: its own when it has one, else the room's. */
const finishOf = (a: KAppliance): Appliance['finish'] => a.bodyFinish ?? a.finish;

/**
 * What a fixed body finish is drawn in. Stainless and panel-ready are NOT
 * looks — they are slots (the appliances slot, the cabinets) — so they return
 * null and the part follows the slot like any other.
 */
export function bodyLook(f: Appliance['finish'] | null): Look | null {
  switch (f) {
    case 'matte-black': return { util: 'matte-black' };
    case 'black': return { metal: { hex: '#141416', roughness: 0.35, metalness: 0.6 } };
    case 'black-stainless': return { metal: { hex: '#3a3c3f', roughness: 0.3, metalness: 1 } };
    case 'white': return { util: 'white-plastic' };
    default: return null;
  }
}

/** Material slot for an appliance front (panel-ready doors match the cabinets). */
const frontSlot = (a: KAppliance, cabinetSlot: 'cabinets_base' | 'cabinets_upper' = 'cabinets_base') =>
  (a.panelReady || a.bodyFinish === 'panel-ready' ? cabinetSlot : 'appliances');

/** A body / canopy: the appliances slot, or this unit's own look. */
function body(key: string, frame: F, a: KAppliance, geometry: Part['geometry'], o: PartOpts = {}): Part {
  const look = bodyLook(a.bodyFinish);
  const slot = a.bodyFinish === 'panel-ready' ? 'cabinets_base' : 'appliances';
  return look ? finished(key, frame, slot, look, geometry, o) : surface(key, frame, slot, geometry, o);
}

/** A door / drawer front: the cabinets when panel-ready, else as the body. */
function front(key: string, frame: F, a: KAppliance, geometry: Part['geometry'], o: PartOpts = {}): Part {
  const look = bodyLook(a.bodyFinish);
  const slot = frontSlot(a);
  return look ? finished(key, frame, slot, look, geometry, o) : surface(key, frame, slot, geometry, o);
}

/** A handle or badge-less trim in the body's finish, never pickable. */
function handle(key: string, frame: F, a: KAppliance, geometry: Part['geometry'], o: PartOpts = {}): Part {
  return body(key, frame, a, geometry, { ...o, inert: true, castShadow: false });
}

/** The dark trim colour that reads right against each appliance finish. */
function trimUtil(a: KAppliance): UtilKind {
  switch (finishOf(a)) {
    case 'white': return 'white-plastic';
    case 'black':
    case 'black-stainless':
    case 'matte-black': return 'matte-black';
    default: return 'matte-black';
  }
}

// ---------------------------------------------------------------------------
// Fridge
// ---------------------------------------------------------------------------

function fridgeParts(a: KAppliance, frame: F): Part[] {
  const W = a.width, H = a.height, D = a.depth;
  const grille = inch(3.5);
  const bodyD = Math.max(0.05, D - FRONT_T);
  const out: Part[] = [
    body(`${a.id}-body`, frame, a, skin(W, H, bodyD), { position: [a.x, H / 2, bodyD / 2] }),
    prop(`${a.id}-kick`, frame, trimUtil(a), louvreGrille(W - inch(1), grille, 4), { position: [a.x, grille / 2, D - inch(0.5)], castShadow: false }),
  ];

  const y0 = grille;
  const usable = H - y0;
  const dw = (W - 3 * REVEAL) / 2;
  interface Door { x: number; y: number; w: number; h: number; hinge: 1 | -1; drawer: boolean }
  const doors: Door[] = [];
  switch (a.fridgeStyle) {
    case 'side-by-side': {
      const h = usable - 2 * REVEAL;
      const left = W * 0.42 - REVEAL, right = W * 0.58 - 2 * REVEAL;
      doors.push({ x: -W / 2 + REVEAL + left / 2, y: y0 + REVEAL + h / 2, w: left, h, hinge: -1, drawer: false });
      doors.push({ x: W / 2 - REVEAL - right / 2, y: y0 + REVEAL + h / 2, w: right, h, hinge: 1, drawer: false });
      break;
    }
    case 'top-freezer': {
      const fh = usable * 0.32 - 2 * REVEAL;
      const rh = usable * 0.68 - 2 * REVEAL;
      doors.push({ x: 0, y: y0 + usable - REVEAL - fh / 2, w: W - 2 * REVEAL, h: fh, hinge: 1, drawer: false });
      doors.push({ x: 0, y: y0 + REVEAL + rh / 2, w: W - 2 * REVEAL, h: rh, hinge: 1, drawer: false });
      break;
    }
    default: {
      // french door / counter-depth / built-in: two doors over a freezer drawer
      // (a built-in column just has taller doors and a deeper drawer)
      const fz = Math.min(a.fridgeStyle === 'built-in' ? inch(20) : inch(17), usable * 0.3);
      const top = usable - fz - 3 * REVEAL;
      doors.push({ x: -(dw + REVEAL) / 2, y: y0 + fz + 2 * REVEAL + top / 2, w: dw, h: top, hinge: -1, drawer: false });
      doors.push({ x: (dw + REVEAL) / 2, y: y0 + fz + 2 * REVEAL + top / 2, w: dw, h: top, hinge: 1, drawer: false });
      doors.push({ x: 0, y: y0 + REVEAL + fz / 2, w: W - 2 * REVEAL, h: fz, hinge: 1, drawer: true });
    }
  }

  // A door configuration is not evidence of an external dispenser. Many
  // french-door fridges have plain fronts and an internal water outlet.
  const dispenser = a.hasDispenser && !a.panelReady && a.bodyFinish !== 'panel-ready';
  const dispenserDoor = doors.find((dr) => !dr.drawer && dr.hinge === -1) ?? doors[0];

  doors.forEach((dr, i) => {
    const z = D - FRONT_T / 2;
    const at: Vec3 = [a.x + dr.x, dr.y, z];
    out.push(front(`${a.id}-d${i}`, frame, a, skin(dr.w, dr.h, FRONT_T), { position: at }));
    // gasket just inside the door edge — the soft dark frame every fridge has
    out.push(prop(`${a.id}-g${i}`, frame, 'matte-black', doorGasket(dr.w - inch(0.5), dr.h - inch(0.5), inch(0.8)), {
      position: [at[0], at[1], z - FRONT_T / 2 - 0.003], castShadow: false,
    }));
    if (dr.drawer) {
      out.push(handle(`${a.id}-h${i}`, frame, a, applianceHandle(Math.min(dr.w - inch(6), inch(20)), false, inch(1.6)), {
        position: [at[0], at[1] + dr.h / 2 - inch(2.5), z + FRONT_T / 2],
      }));
    } else {
      out.push(handle(`${a.id}-h${i}`, frame, a, applianceHandle(Math.min(dr.h - inch(8), inch(26)), true, inch(1.6)), {
        position: [at[0] + dr.hinge * (dr.w / 2 - inch(2.2)), at[1] + dr.h * (a.fridgeStyle === 'side-by-side' ? 0.18 : 0), z + FRONT_T / 2],
      }));
    }
    if (dispenser && dr === dispenserDoor) {
      out.push(prop(`${a.id}-disp`, frame, trimUtil(a), waterDispenser(Math.min(inch(8), dr.w * 0.45), Math.min(inch(11), dr.h * 0.28)), {
        position: [at[0] - dr.hinge * (dr.w * 0.08), at[1] + dr.h * 0.26, z + FRONT_T / 2], castShadow: false,
      }));
    }
  });

  // badge, low and central on the tallest door
  const badgeDoor = doors.reduce((m, dr) => (dr.h > m.h ? dr : m), doors[0]);
  if (badgeDoor) {
    out.push(prop(`${a.id}-badge`, frame, 'brushed-nickel', applianceBadge(Math.min(inch(4), W * 0.22)), {
      position: [a.x + badgeDoor.x, badgeDoor.y - badgeDoor.h / 2 + inch(2.2), D + FRONT_T / 2], castShadow: false,
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Range
// ---------------------------------------------------------------------------

function rangeParts(a: KAppliance, frame: F, style: KitchenLayoutData['style']): Part[] {
  const W = a.width, D = a.depth, H = a.height;
  const deck = inch(1.2);
  const ctrl = inch(4.5);
  const doorH = Math.max(inch(12), H - ctrl - inch(4.5));
  const bodyD = Math.max(0.05, D - FRONT_T);
  const burners = W > inch(40) ? 6 : W > inch(32) ? 5 : 4;
  const knobPitch = Math.min(inch(4.5), (W - inch(6)) / Math.max(1, burners));
  const win = ovenWindow(W - inch(6), doorH - inch(5));
  const doorY = inch(4.5) + doorH / 2;
  const z = D - FRONT_T / 2;
  /**
   * The cooking deck is the plate that CAPS the body, and the fascia is the band
   * between that plate and the top of the oven door. Both used to be drawn over
   * the top of parts that reached the same plane: the body's top face and the
   * deck's were both at y = H, and the fascia hung a deck's depth below the door's
   * top edge so their two front faces were coplanar for 30 mm across the whole
   * range. Coplanar faces z-fight — it was hidden only because chamferBox used to
   * draw every box 2–4 mm oversized, which is the defect this session removed.
   */
  const fasciaTop = H - deck - REVEAL;
  const fasciaBot = H - ctrl + REVEAL;
  const fasciaH = Math.max(inch(0.8), fasciaTop - fasciaBot);
  const fasciaY = fasciaTop - fasciaH / 2;

  return compact([
    body(`${a.id}-body`, frame, a, skin(W, H - deck, bodyD), { position: [a.x, (H - deck) / 2, bodyD / 2] }),
    prop(`${a.id}-kick`, frame, trimUtil(a), louvreGrille(W - inch(1), inch(4), 3), { position: [a.x, inch(2), D - inch(0.6)], castShadow: false }),

    // oven door: slab, bezel, glass, handle
    front(`${a.id}-door`, frame, a, skin(W - 2 * REVEAL, doorH, FRONT_T), { position: [a.x, doorY, z] }),
    prop(`${a.id}-bezel`, frame, trimUtil(a), win.bezel, { position: [a.x, doorY, z + FRONT_T / 2], castShadow: false }),
    prop(`${a.id}-glass`, frame, 'glass', win.glass, { position: [a.x, doorY, z + FRONT_T / 2 + inch(0.15)], castShadow: false, receiveShadow: false }),
    handle(`${a.id}-handle`, frame, a, applianceHandle(W - inch(4), false, inch(2.2)), {
      position: [a.x, doorY + doorH / 2 - inch(1.6), z + FRONT_T / 2],
    }),
    prop(`${a.id}-towel`, frame, 'towel', hangingTowel(inch(7.5), inch(11)), {
      position: [a.x + W * 0.28, doorY + doorH / 2 - inch(1.6), z + FRONT_T / 2 + inch(2.2)], castShadow: false,
    }),

    // control fascia + knobs
    prop(`${a.id}-fascia`, frame, trimUtil(a), chamferBox(W - 2 * REVEAL, fasciaH, FRONT_T * 0.8, 0.0014), {
      position: [a.x, fasciaY, D - FRONT_T * 0.4], castShadow: false,
    }),
    handle(`${a.id}-knobs`, frame, a, controlKnobs(burners, knobPitch), {
      position: [a.x, fasciaY, D - FRONT_T * 0.4 + FRONT_T * 0.4],
    }),

    // cooking deck + cast-iron grates + backguard
    // the deck follows the BODY's finish, not the trim's: a stainless range has a
    // stainless cooking surface with black cast-iron grates on it, which is what
    // the client's photos show. It only ever looked stainless before because it
    // was z-fighting the body and losing.
    body(`${a.id}-deck`, frame, a, chamferBox(W, deck, D - inch(1), 0.0012), { position: [a.x, H - deck / 2, (D - inch(1)) / 2], castShadow: false }),
    prop(`${a.id}-grates`, frame, 'rubber', burnerGrates(W - inch(2), D - inch(4), burners), { position: [a.x, H, (D - inch(1)) / 2], castShadow: true }),
    handle(`${a.id}-guard`, frame, a, chamferBox(W, inch(2.5), inch(1), 0.0014), {
      position: [a.x, H + inch(1.25), inch(0.5)],
    }),
    prop(`${a.id}-badge`, frame, style === 'industrial' ? 'brushed-brass' : 'brushed-nickel', applianceBadge(Math.min(inch(4), W * 0.2)), {
      position: [a.x, fasciaY, D + FRONT_T * 0.05], castShadow: false,
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Cook-top (flush in the counter)
// ---------------------------------------------------------------------------

function cooktopParts(L: KitchenLayoutData, a: KAppliance, frame: F, z: number): Part[] {
  const burners = a.width > inch(34) ? 5 : 4;
  return [
    handle(`${a.id}-frame`, frame, a, chamferBox(a.width + inch(0.7), inch(0.2), a.depth + inch(0.7), 0.0010), {
      position: [a.x, L.counterTopY + inch(0.1), z],
    }),
    prop(`${a.id}-glass`, frame, 'matte-black', chamferBox(a.width, inch(0.35), a.depth, 0.0010), {
      position: [a.x, L.counterTopY + inch(0.28), z], castShadow: false,
    }),
    handle(`${a.id}-rings`, frame, a, cooktopRings(a.width - inch(3), a.depth - inch(2), burners), {
      position: [a.x, L.counterTopY + inch(0.46), z],
    }),
    prop(`${a.id}-box`, frame, 'matte-black', chamferBox(a.width - inch(2), inch(4), a.depth - inch(2), 0.0010), {
      position: [a.x, L.counterTopY - inch(2.2), z], castShadow: false, receiveShadow: false,
    }),
  ];
}

// ---------------------------------------------------------------------------
// Wall oven
// ---------------------------------------------------------------------------

function wallOvenParts(a: KAppliance, frame: F): Part[] {
  const W = a.width, H = a.height, D = a.depth;
  const bodyD = Math.max(0.05, D - FRONT_T);
  const doorH = H - inch(5);
  const doorY = a.y + doorH / 2;
  const z = D - FRONT_T / 2;
  const win = ovenWindow(W - inch(5), doorH - inch(6));
  return [
    body(`${a.id}-body`, frame, a, skin(W, H, bodyD), { position: [a.x, a.y + H / 2, bodyD / 2] }),
    front(`${a.id}-door`, frame, a, skin(W - 2 * REVEAL, doorH, FRONT_T), { position: [a.x, doorY, z] }),
    prop(`${a.id}-bezel`, frame, trimUtil(a), win.bezel, { position: [a.x, doorY, z + FRONT_T / 2], castShadow: false }),
    prop(`${a.id}-glass`, frame, 'glass', win.glass, { position: [a.x, doorY, z + FRONT_T / 2 + inch(0.15)], castShadow: false, receiveShadow: false }),
    handle(`${a.id}-handle`, frame, a, applianceHandle(W - inch(4), false, inch(2)), {
      position: [a.x, doorY + doorH / 2 - inch(1.6), z + FRONT_T / 2],
    }),
    prop(`${a.id}-ctrl`, frame, trimUtil(a), chamferBox(W - 2 * REVEAL, inch(4), FRONT_T * 0.8, 0.0014), {
      position: [a.x, a.y + H - inch(2), D - FRONT_T * 0.4], castShadow: false,
    }),
    prop(`${a.id}-pad`, frame, 'matte-black', keypad(W * 0.5, inch(3), 4, 2), {
      position: [a.x, a.y + H - inch(2), D - FRONT_T * 0.4 + FRONT_T * 0.4 + 0.001], castShadow: false,
    }),
  ];
}

// ---------------------------------------------------------------------------
// Dishwasher / wine fridge (undercounter)
// ---------------------------------------------------------------------------

function undercounterParts(L: KitchenLayoutData, a: KAppliance, frame: F): Part[] {
  const W = a.width, D = a.depth;
  const H = Math.max(inch(20), a.height - L.toeKick);
  const wine = a.kind === 'wine-fridge';
  const bodyD = Math.max(0.05, D - FRONT_T);
  const cy = L.toeKick + H / 2;
  const z = D - FRONT_T / 2;
  const out: Part[] = [
    prop(`${a.id}-kick`, frame, 'matte-black', chamferBox(W, Math.max(0.01, L.toeKick), Math.max(0.05, D - inch(3)), 0.0010), {
      position: [a.x, L.toeKick / 2, (D - inch(3)) / 2], castShadow: false,
    }),
    body(`${a.id}-body`, frame, a, skin(W, H, bodyD), { position: [a.x, cy, bodyD / 2] }),
  ];
  if (wine) {
    const rack = wireRack(W - inch(5), D - inch(6), 8);
    for (const [i, f] of [0.24, 0.42, 0.60, 0.78].entries()) {
      out.push(prop(`${a.id}-rack${i}`, frame, 'chrome', rack, { position: [a.x, L.toeKick + H * f, bodyD / 2], castShadow: false }));
    }
    out.push(
      body(`${a.id}-front`, frame, a, chamferBox(W - 2 * REVEAL, H - 2 * REVEAL, inch(0.5), 0.0016), { position: [a.x, cy, z] }),
      prop(`${a.id}-glass`, frame, 'glass', chamferBox(W - inch(4), H - inch(5), 0.006, 0.0010), { position: [a.x, cy, z + inch(0.3)], castShadow: false, receiveShadow: false }),
    );
  } else {
    out.push(front(`${a.id}-front`, frame, a, skin(W - 2 * REVEAL, H - 2 * REVEAL, FRONT_T), { position: [a.x, cy, z] }));
  }
  // integrated panels get a routed pocket handle; exposed ones get the bar
  if (frontSlot(a) !== 'appliances') {
    out.push(surface(`${a.id}-handle`, frame, 'hardware', pocketHandle(W - inch(4)), {
      position: [a.x, cy + H / 2 - inch(1.1), z + FRONT_T / 2], inert: true, castShadow: false,
    }));
  } else {
    out.push(handle(`${a.id}-handle`, frame, a, applianceHandle(W - inch(4), false, inch(1.8)), {
      position: [a.x, cy + H / 2 - inch(2), z + FRONT_T / 2],
    }));
    out.push(prop(`${a.id}-ctrl`, frame, trimUtil(a), chamferBox(W - inch(6), inch(0.8), 0.004, 0.0008), {
      position: [a.x, cy + H / 2 - inch(0.7), z + FRONT_T / 2], castShadow: false,
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Microwave
// ---------------------------------------------------------------------------

function microwaveParts(a: KAppliance, frame: F): Part[] {
  const W = a.width, H = a.height, D = a.depth;
  const doorW = W * 0.68 - REVEAL;
  const bodyD = Math.max(0.05, D - inch(0.9));
  const cy = a.y + H / 2;
  const doorCx = a.x - (W - doorW) / 2;
  return [
    body(`${a.id}-body`, frame, a, skin(W, H, bodyD), { position: [a.x, cy, bodyD / 2] }),
    front(`${a.id}-door`, frame, a, skin(doorW, H - 2 * REVEAL, inch(0.9)), { position: [doorCx, cy, D - inch(0.45)] }),
    prop(`${a.id}-win`, frame, 'matte-black', chamferBox(doorW - inch(2.5), H - inch(3), 0.004, 0.0008), {
      position: [doorCx, cy, D - inch(0.45) + inch(0.5)], castShadow: false, receiveShadow: false,
    }),
    prop(`${a.id}-panel`, frame, 'matte-black', chamferBox(W - doorW - 2 * REVEAL, H - 2 * REVEAL, inch(0.9), 0.0014), {
      position: [a.x + (doorW + 2 * REVEAL) / 2, cy, D - inch(0.45)], castShadow: false,
    }),
    prop(`${a.id}-pad`, frame, 'matte-black', keypad(W - doorW - inch(1.2), H - inch(2), 3, 5), {
      position: [a.x + (doorW + 2 * REVEAL) / 2, cy, D + inch(0.02)], castShadow: false,
    }),
    handle(`${a.id}-handle`, frame, a, applianceHandle(doorW - inch(3), false, inch(1.4)), {
      position: [doorCx, cy + H / 2 - inch(2), D + inch(0.02)],
    }),
    prop(`${a.id}-vent`, frame, 'matte-black', louvreGrille(W - inch(2), inch(1.2), 3), { position: [a.x, a.y + inch(0.7), D - inch(0.2)], castShadow: false }),
  ];
}

// ---------------------------------------------------------------------------
// Hood
// ---------------------------------------------------------------------------

function hoodParts(L: KitchenLayoutData, a: KAppliance, frame: F, islandMode: boolean): Part[] {
  const W = a.width + inch(2);
  const D = a.depth;
  const y = a.y;
  const shape = a.hoodShape;
  const zc = islandMode ? 0 : D / 2;
  const canopyH = a.height;
  const wood = shape === 'wood-canopy';
  // a wood canopy is millwork and follows the uppers; a panel-ready hood too
  const slot = wood || a.bodyFinish === 'panel-ready' ? 'cabinets_upper' : 'appliances';
  const look = bodyLook(a.bodyFinish);
  const shell = (key: string, g: Part['geometry'], o: PartOpts = {}): Part =>
    (look ? finished(key, frame, slot, look, g, o) : surface(key, frame, slot, g, o));

  if (shape === 'slim') {
    // low-profile insert under a wall cabinet: a 6" body, filters, a control strip
    return [
      shell(`${a.id}-body`, chamferBox(W, canopyH, D, 0.0016), { position: [a.x, y + canopyH / 2, zc] }),
      prop(`${a.id}-filter`, frame, 'matte-black', hoodInterior(W - inch(3), D - inch(2), 2), { position: [a.x, y, zc], castShadow: false }),
      prop(`${a.id}-strip`, frame, 'matte-black', chamferBox(W * 0.3, inch(0.7), inch(0.3), 0.0008), { position: [a.x + W * 0.28, y + canopyH - inch(1.4), zc + D / 2 - inch(0.2)], castShadow: false }),
    ];
  }

  // the neck the duct cover stands on
  const neckW = wood ? W * 0.8 : shape === 'box' ? Math.min(W * 0.5, inch(14)) : Math.min(W * 0.44, inch(13));
  const neckD = wood ? D * 0.7 : shape === 'box' ? Math.min(D * 0.5, inch(10)) : Math.min(D * 0.44, inch(9));
  const out: Part[] = [];
  switch (shape) {
    case 'box':
      out.push(shell(`${a.id}-canopy`, chamferBox(W, canopyH, D, 0.0016), { position: [a.x, y + canopyH / 2, zc] }));
      // the folded lip along the bottom edge that every steel box hood has
      out.push(prop(`${a.id}-lip`, frame, trimUtil(a), chamferBox(W + 0.002, inch(0.6), D + 0.002, 0.0008), { position: [a.x, y + inch(0.3), zc], castShadow: false }));
      break;
    case 'curved':
      out.push(shell(`${a.id}-canopy`, hoodBell(W, D, neckW, neckD, canopyH), { position: [a.x, y, zc] }));
      break;
    case 'wood-canopy': {
      // a flat-fronted box with a moulded band at the mouth and a small crown
      const mantle = inch(1.5);
      out.push(shell(`${a.id}-canopy`, chamferBox(W, canopyH - mantle, D, 0.0016), { position: [a.x, y + mantle + (canopyH - mantle) / 2, zc] }));
      out.push(shell(`${a.id}-mantle`, chamferBox(W + inch(1.5), mantle, D + inch(0.75), 0.0016), { position: [a.x, y + mantle / 2, zc + (islandMode ? 0 : inch(0.375))], inert: true, castShadow: false }));
      out.push(shell(`${a.id}-crown`, chamferBox(W + inch(1), inch(1.25), D + inch(0.5), 0.0016), { position: [a.x, y + canopyH - inch(0.625), zc + (islandMode ? 0 : inch(0.25))], inert: true, castShadow: false }));
      break;
    }
    default:
      out.push(shell(`${a.id}-canopy`, hoodCanopy(neckW, neckD, W, D, canopyH), { position: [a.x, y, zc] }));
  }
  out.push(prop(`${a.id}-liner`, frame, 'matte-black', hoodInterior(W - inch(3), D - inch(3), W > inch(34) ? 4 : 3), { position: [a.x, y + inch(0.2), zc], castShadow: false }));

  // duct cover: up to the top the layout resolved (`hoodExtents` — the
  // ceiling for a chimney, the top of the uppers for a wood hood's chase, or
  // the height the photo gave), so the fitter's box and the flue agree
  const flueH = Math.max(0, hoodExtents(a).top - (y + canopyH));
  if (flueH > 0.05) {
    out.push(shell(`${a.id}-flue`, chamferBox(neckW, flueH, neckD, 0.0016), { position: [a.x, y + canopyH + flueH / 2, zc] }));
    if (!wood) {
      // the seam band where the two flue sections telescope
      out.push(prop(`${a.id}-flueseam`, frame, 'matte-black', chamferBox(neckW + 0.002, 0.004, neckD + 0.002, 0.0006), {
        position: [a.x, y + canopyH + flueH * 0.45, zc], castShadow: false,
      }));
    }
  }
  if (!wood) {
    out.push(prop(`${a.id}-badge`, frame, 'brushed-nickel', applianceBadge(inch(3)), {
      position: [a.x, y + Math.min(canopyH * 0.35, inch(4)), zc + D / 2 + 0.001], castShadow: false,
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function applianceOne(L: KitchenLayoutData, a: KAppliance, frame: F, islandMode: boolean): Part[] {
  const run = L.runs.find((r) => r.id === a.runId) ?? null;
  switch (a.kind) {
    case 'fridge': return fridgeParts(a, frame);
    case 'range': return rangeParts(a, frame, L.style);
    case 'cooktop': return cooktopParts(L, a, frame, islandMode ? 0 : (run?.baseDepth ?? L.baseDepth) / 2);
    case 'wall-oven': return wallOvenParts(a, frame);
    case 'dishwasher':
    case 'wine-fridge': return undercounterParts(L, a, frame);
    case 'microwave': return microwaveParts(a, frame);
    case 'hood': return hoodParts(L, a, frame, islandMode);
    default: return [];
  }
}

export function applianceParts(L: KitchenLayoutData): Part[] {
  const out: Part[] = [];
  for (const a of L.appliances) {
    if (a.wall === 'island') {
      if (!L.island) continue;
      const isl = L.island;
      if (a.kind === 'cooktop') {
        out.push(...cooktopParts(L, a, 'island', -isl.seatSide * isl.wide * 0.14));
      } else {
        out.push(...applianceOne(L, a, 'island', true));
      }
      continue;
    }
    out.push(...applianceOne(L, a, a.wall, false));
  }
  // a board leaning by the range makes the counter read as used
  return compact(out);
}

/** Where a cutting board can lean: beside the range, on counter that exists. */
export function boardBesideRange(L: KitchenLayoutData): { wall: Exclude<Part['frame'], 'world' | 'island'>; x: number } | null {
  const range = L.appliances.find((a) => a.kind === 'range' && a.wall !== 'island');
  if (!range || range.wall === 'island') return null;
  const run = L.runs.find((r) => r.id === range.runId);
  if (!run) return null;
  for (const side of [1, -1]) {
    const x = range.x + side * (range.width / 2 + inch(5));
    const seg = run.counters.find(([a0, a1]) => x - inch(3) > a0 && x + inch(3) < a1);
    if (seg) return { wall: range.wall, x };
  }
  return null;
}

/** kept for the styling pass, which wants a soft-edged tray shape */
export const trayGeometry = (w: number, d: number) => filletBox(w, inch(0.6), d, inch(0.4), 2);
