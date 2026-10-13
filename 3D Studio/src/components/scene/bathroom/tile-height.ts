import { inch } from '@/lib/units';
import type { Wall } from '@/lib/spec/types';
import type { BathLayout } from './layout';
import { TILE_T } from './envelope';
type TileContext = Pick<BathLayout, 'h' | 'tile' | 'wallTile' | 'vanity'>;
const WAINSCOT_H = inch(42);

/** Which wall (if any) is done differently from the field. */
export function accentWallOf(L: TileContext): Wall | null {
  if (L.tile.accent) return L.tile.accent.wall;
  return L.wallTile === 'accent-wall' ? (L.vanity?.wall ?? 'back') : null;
}

/** Where the FIELD tile stops on a wall that is not the accent. */
function fieldHeight(L: TileContext, cap: number): number {
  switch (L.wallTile) {
    case 'full': return Math.min(L.tile.stopH ?? cap, cap);
    // a measured stop line overrides the category's own 42", which is the
    // difference between a chair-rail wainscot and a 60" tiled wall
    case 'wainscot': return Math.min(L.tile.stopH ?? WAINSCOT_H, L.h - 0.3);
    default: return 0;
  }
}

export function tileHeightFor(L: TileContext, wall: Wall): number {
  const cap = L.h - 0.004;
  // The accent wall is tiled whether or not the field is — that is what makes
  // it a feature wall. `heightIn: null` on the accent means "to the ceiling".
  if (accentWallOf(L) === wall) return Math.min(L.tile.accent?.stopH ?? cap, cap);
  return fieldHeight(L, cap);
}

/**
 * How far a thing mounted at height `y` on `wall` must stand off the substrate.
 *
 * Anything screwed to a wall — a towel bar, a GFCI plate, a switch, a register
 * — sits on the FINISHED surface, so it needs the tile build-up on the wall it
 * is actually on, at the height it is actually at. Asking "is the room tiled?"
 * instead buries a plate 10 mm inside an accent wall's tile, or floats one off
 * an untiled wall, and pushes it in and out as the wall-tile control changes.
 */
export function tileOffsetAt(L: TileContext, wall: Wall, y: number): number {
  const h = tileHeightFor(L, wall);
  return h > 0 && y <= h ? TILE_T : 0;
}

