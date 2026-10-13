import type { Project, RoomDims, RoomMeasurements, RoomSpec, SingleRoomSpec } from './types';

export const DIMENSION_KEYS = ['widthFt', 'depthFt', 'ceilingFt'] as const;
export type DimensionKey = typeof DIMENSION_KEYS[number];
export type MeasurementPatch = Partial<Record<DimensionKey, number | null>>;
export const DIMENSION_BOUNDS: Record<DimensionKey, readonly [number, number]> = {
  widthFt: [4, 80], depthFt: [4, 80], ceilingFt: [7, 20],
};

const single = (spec: RoomSpec): spec is SingleRoomSpec => spec.roomType === 'kitchen' || spec.roomType === 'bathroom';
const valid = (key: DimensionKey, value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
  && value >= DIMENSION_BOUNDS[key][0] && value <= DIMENSION_BOUNDS[key][1];

/** Accept decimal feet, feet/inches, inches, metres, centimetres or millimetres.
 * No parseFloat fallback: a partly readable measurement must not silently scale a room. */
export function parseMeasurement(text: string): number | null {
  const value = text.trim().toLowerCase().replace(/[′’]/g, "'").replace(/[″“”]/g, '"');
  const decimal = '(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
  const combined = value.match(new RegExp(`^(${decimal})\\s*(?:'|ft|feet)\\s*(${decimal})\\s*(?:\"|in|inches)?$`));
  if (combined) {
    const inches = Number(combined[2]);
    return inches < 12 ? Number(combined[1]) + inches / 12 : null;
  }
  const simple = value.match(new RegExp(`^(${decimal})\\s*(ft|feet|'|in|inches|\"|m|cm|mm)?$`));
  if (!simple) return null;
  const scale: Record<string, number> = { ft: 1, feet: 1, "'": 1, in: 1 / 12, inches: 1 / 12, '"': 1 / 12, m: 1 / 0.3048, cm: 1 / 30.48, mm: 1 / 304.8 };
  const feet = Number(simple[1]) * (scale[simple[2] ?? 'ft']);
  return Number.isFinite(feet) && feet > 0 ? feet : null;
}

/** Read valid human confirmations independently of candidate geometry, so an
 * optimizer cannot escape a lock by nudging the dimension before checking it. */
export function confirmedDimensions(spec: RoomSpec): Partial<RoomDims> {
  if (!single(spec)) return {};
  const record = spec.detected.measurements;
  if (!record || !Number.isFinite(Date.parse(record.confirmedAt))) return {};
  const result: Partial<RoomDims> = {};
  for (const key of DIMENSION_KEYS) {
    const value = record[key];
    if (valid(key, value)) result[key] = value;
  }
  return result;
}

export function releaseInconsistentMeasurements<T extends RoomSpec>(spec: T): T {
  if (!single(spec) || !spec.detected.measurements) return spec;
  const known = confirmedDimensions(spec);
  const old = spec.detected.measurements;
  for (const key of DIMENSION_KEYS) if (known[key] !== undefined && Math.abs(spec.dims[key] - known[key]!) >= 1e-6) delete known[key];
  if (DIMENSION_KEYS.every((key) => (known[key] ?? null) === old[key])) return spec;
  const measurements = Object.keys(known).length ? { widthFt: null, depthFt: null, ceilingFt: null, confirmedAt: old.confirmedAt, ...known } : null;
  return { ...spec, detected: { ...spec.detected, measurements } };
}

export function applyMeasurements<T extends SingleRoomSpec>(spec: T, patch: MeasurementPatch, confirmedAt: string): T {
  if (!Number.isFinite(Date.parse(confirmedAt))) throw new Error('A measurement needs a valid confirmation time.');
  const known = confirmedDimensions(spec);
  const measurements: RoomMeasurements = { widthFt: null, depthFt: null, ceilingFt: null, ...known, confirmedAt };
  const dims = { ...spec.dims };
  for (const key of DIMENSION_KEYS) {
    if (patch[key] === undefined) continue;
    const value = patch[key];
    if (value !== null && !valid(key, value)) throw new Error(`${key} must be between ${DIMENSION_BOUNDS[key].join(' and ')} feet.`);
    measurements[key] = value;
    if (value !== null) dims[key] = value;
  }
  const changed = DIMENSION_KEYS.some((key) => dims[key] !== spec.dims[key]);
  return { ...spec, dims, detected: { ...spec.detected,
    measurements: DIMENSION_KEYS.some((key) => measurements[key] !== null) ? measurements : null,
    camera: changed ? { ...spec.detected.camera, solved: null } : spec.detected.camera,
  } };
}

/** Measuring the existing room corrects the as-found quantities too. It must
 * not appear as paid demolition or erase the user's finish/design choices. */
export function measureProject(project: Project, patch: MeasurementPatch, now = new Date().toISOString()): Project {
  if (!project.spec || !single(project.spec)) return project;
  const spec = applyMeasurements(project.spec, patch, now);
  const baseline = project.baseline;
  const baselineSpec = baseline?.spec;
  return { ...project, spec, baseline: baseline && baselineSpec && single(baselineSpec) && baselineSpec.roomType === spec.roomType
    ? { ...baseline, spec: baselineSpec === project.spec ? spec : applyMeasurements(baselineSpec, patch, now) }
    : baseline };
}
