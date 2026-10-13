import type { CleanFaceFinish } from './clean-face-finish';
type RGB = [number, number, number];
export interface CabinetFinishFace {
  id: string; objectId: string; slot: string;
  orientation: 'front' | 'back' | 'side' | 'top' | 'bottom';
  finish: CleanFaceFinish;
}
export interface CabinetFinishCompletionInput {
  objectId: string; role: string; faces: CabinetFinishFace[];
}
export interface CabinetFinishCompletion {
  faceId: string; objectId: string; cleanColorSRGB: RGB; cleanColorLinear: RGB;
  confidence: 'low'; provenance: 'same-object-cabinet-finish-continuity';
  fromFaceIds: string[]; assumed: true; estimated: true; finishKind: 'cabinet';
}
const slots = new Set(['cabinets_base', 'cabinets_upper', 'cabinets_tall', 'vanity_cabinet']);
const roles = new Set(['base-cabinet', 'upper-cabinet', 'tall-cabinet']);
const linear = (byte: number) => { const value = byte / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; };
function feature(rgb: RGB): RGB {
  const c = rgb.map(linear), l = Math.cbrt(.4122214708 * c[0] + .5363325363 * c[1] + .0514459929 * c[2]);
  const m = Math.cbrt(.2119034982 * c[0] + .6806995451 * c[1] + .1073969566 * c[2]);
  const s = Math.cbrt(.0883024619 * c[0] + .2817188376 * c[1] + .6299787005 * c[2]);
  return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s];
}
function agree(a: RGB, b: RGB): boolean {
  const x = feature(a), y = feature(b), ca = Math.hypot(x[1], x[2]), cb = Math.hypot(y[1], y[2]);
  if (Math.abs(x[0] - y[0]) > .18) return false;
  if (ca < .025 || cb < .025) return ca < .025 && cb < .025;
  return Math.min(ca, cb) / Math.max(ca, cb) >= .6 && (x[1] * y[1] + x[2] * y[2]) / (ca * cb) >= .9;
}
type SupportedFace = CabinetFinishFace & { finish: Extract<CleanFaceFinish, { status: 'supported' }> };
function supported(face: CabinetFinishFace): face is SupportedFace {
  const f = face.finish;
  return f.status === 'supported' && f.finishKind === 'cabinet' && f.provenance === 'same-face-camera-finish-estimate'
    && f.cleanColorSRGB.length === 3 && f.cleanColorSRGB.every(n => Number.isFinite(n) && n >= 0 && n <= 255)
    && [f.observedFraction, f.supportFraction].every(n => Number.isFinite(n) && n > 0 && n <= 1)
    && Number.isInteger(f.spatialCellCount) && f.spatialCellCount >= 1 && f.spatialCellCount <= 64;
}

/** An explicitly low-confidence finish-continuity assumption for an ordinary
 * cabinet's unobserved side/top. A broad front must support the finish, and
 * every observed cabinet face must agree before any completion is returned.
 * Island bodies, backs, mixed faces and other material slots are never filled.
 * No colors cross object IDs, and the chosen donor's RGB is copied, not pooled.
 * Returns only display metadata; measured colors, geometry and choices remain
 * authoritative and untouched. At most six faces are compared (36 pairs). */
export function completeSameCabinetFinishes(input: CabinetFinishCompletionInput): CabinetFinishCompletion[] {
  const { objectId, role, faces } = input;
  if (!objectId || !roles.has(role) || !Array.isArray(faces) || !faces.length || faces.length > 6
    || faces.some(face => !face.id || face.objectId !== objectId) || new Set(faces.map(face => face.id)).size !== faces.length) return [];
  const completed: CabinetFinishCompletion[] = [];
  for (const slot of slots) {
    const sameMaterial = faces.filter(face => face.slot === slot);
    if (sameMaterial.some(face => face.finish.status === 'unknown' && face.finish.reason !== 'insufficient-evidence')) continue;
    const donors = sameMaterial.filter(supported);
    if (!donors.length || donors.some((a, i) => donors.slice(i + 1).some(b => !agree(a.finish.cleanColorSRGB, b.finish.cleanColorSRGB)))) continue;
    const fronts = donors.filter(face => face.orientation === 'front' && face.finish.observedFraction >= .12 && face.finish.supportFraction >= .4 && face.finish.spatialCellCount >= 8)
      .sort((a, b) => b.finish.observedFraction * b.finish.supportFraction - a.finish.observedFraction * a.finish.supportFraction);
    if (!fronts.length) continue;
    const source = fronts[0], color = source.finish.cleanColorSRGB;
    for (const face of sameMaterial) {
      if (!['side', 'top'].includes(face.orientation) || face.finish.status !== 'unknown' || face.finish.reason !== 'insufficient-evidence') continue;
      completed.push({ faceId: face.id, objectId, cleanColorSRGB: [...color], cleanColorLinear: color.map(linear) as RGB,
        confidence: 'low', provenance: 'same-object-cabinet-finish-continuity', fromFaceIds: donors.map(donor => donor.id), assumed: true, estimated: true, finishKind: 'cabinet' });
    }
  }
  return completed;
}
