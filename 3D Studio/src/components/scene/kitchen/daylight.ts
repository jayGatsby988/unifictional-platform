import { inch } from '@/lib/units';
import type { KitchenLayoutData } from './layout';

/** Uncovered window area, using the dimensions drawn by decor.ts. Rect-area
 * lights do not cast shadows, so leaving the full emitter behind an opaque
 * shade produces a reflection of daylight through solid fabric. Diffuse sky
 * and room bounce still light the covered area. No extra area lights needed. */
export function kitchenDaylightWindows(L: KitchenLayoutData) {
  return L.openings.filter((o) => o.kind === 'window').map((o) => {
    const t = L.decor.treatments.find((v) => v.openingId === o.id);
    let bottom = o.sill, top = o.sill + o.height, width = o.width, transmission = 1;
    switch (t?.kind) {
      case 'roman-shade':
        top = Math.min(top, t.head - 0.05 - 4 * Math.max(0.04, Math.min(0.08, t.height * 0.07)) - 0.017);
        break;
      case 'roller':
        top = Math.min(top, t.head - 0.02 - Math.max(0.05, t.height * 0.25) - 0.006);
        break;
      case 'cafe-curtain':
        bottom = Math.max(bottom, t.head + 0.006);
        break;
      case 'curtains':
        // Gathered side panels each overlap the glazing by 60 mm.
        width = Math.max(0, width - 0.12);
        break;
      case 'blinds': {
        // Project the modeled 2" slats (tilted 0.5 rad) onto the window.
        // Keep one rect within the tier's budget, attenuated by its open area.
        const n = Math.min(80, Math.max(2, Math.floor((t.height - inch(2.5)) / inch(1.75))));
        const covered = n * (inch(2) * Math.sin(0.5) + 0.0015 * Math.cos(0.5)) + inch(1.2);
        transmission = Math.max(0, 1 - covered / t.height);
        break;
      }
    }
    bottom = Math.min(o.sill + o.height, Math.max(o.sill, bottom));
    top = Math.max(bottom, Math.min(o.sill + o.height, top));
    return { wall: o.wall, t: o.t, width, height: top - bottom, sill: bottom, transmission };
  }).filter((o) => o.width > 0.05 && o.height > 0.05 && o.transmission > 0);
}
