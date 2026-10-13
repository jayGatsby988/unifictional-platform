import { Matrix3, type Texture } from 'three';
import type { PBRRecipe } from '@/lib/materials/catalog';

type Frame = { origin: number[]; u: number[]; v: number[] };
type FloorFrame = Frame & { spanMeters: [number, number] };
type FinishFrame = Frame & { grainDirectionRadians: number | null };

/** Convert captured floor uv1 to the photo material's meter-based texture
 * coordinates. Clean floor inference reports grain along its U axis; our
 * plank/wood generators draw grain along texture V. A supported grain reading
 * therefore replaces any catalog room-relative rotation with that mapping.
 * Tile/checker/mineral patterns do not acquire a wood-specific quarter-turn.
 * Texture scale remains representative when no physical module was measured.
 * Source texture transforms, captured frames and geometry are never mutated. */
export function photoFloorTextureMatrix(texture: Texture, floor: FloorFrame, finish: FinishFrame | null, recipe?: Pick<PBRRecipe, 'procedural'>): Matrix3 {
  const frame = finish ?? floor;
  const dot = (a: number[], b: number[]) => a.reduce((sum, n, i) => sum + n * b[i], 0);
  const offset = floor.origin.map((n, i) => n - frame.origin[i]);
  const registration = new Matrix3().set(
    dot(floor.u, frame.u) * floor.spanMeters[0], dot(floor.v, frame.u) * floor.spanMeters[1], dot(offset, frame.u),
    dot(floor.u, frame.v) * floor.spanMeters[0], dot(floor.v, frame.v) * floor.spanMeters[1], dot(offset, frame.v),
    0, 0, 1,
  );
  const kind = recipe?.procedural?.kind;
  const verticalGrain = kind === 'plank' || (kind === 'wood' && recipe?.procedural?.options.figure !== 'end-grain');
  const supportedGrain = verticalGrain && finish?.grainDirectionRadians != null && Number.isFinite(finish.grainDirectionRadians);
  const base = supportedGrain
    // Texture V follows -observed U (the same unoriented grain line). Keeping
    // repeat X/Y in texture axes preserves unequal board-width/length scales.
    // The catalog's center/rotate90 described a different room, not this scan.
    ? new Matrix3().setUvTransform(texture.offset.x, texture.offset.y, texture.repeat.x, texture.repeat.y, Math.PI / 2, 0, 0)
    : texture.matrixAutoUpdate
      ? new Matrix3().setUvTransform(texture.offset.x, texture.offset.y, texture.repeat.x, texture.repeat.y, texture.rotation, texture.center.x, texture.center.y)
      : texture.matrix.clone();
  return base.multiply(registration);
}
