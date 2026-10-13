type Vec = [number, number, number];
export interface CleanFaceFinishInput {
  rgba: Uint8Array; width: number; height: number; slot: string;
  /** Opt-in for depth-checked measured surface grids, not arbitrary photos. */
  preserveSurfaceDetail?: boolean;
}
export type CleanFaceFinish = {
  status: 'unknown'; reason: 'invalid-input' | 'insufficient-evidence' | 'mixed-appearance';
  confidence: 'low'; provenance: 'same-face-camera-finish-estimate'; estimated: true;
} | {
  status: 'supported'; rgba: Uint8Array; cleanColorSRGB: Vec; cleanColorLinear: Vec;
  finishKind: 'cabinet' | 'stone' | 'surface' | 'steel-appliance' | 'white-appliance' | 'black-appliance';
  confidence: 'low' | 'medium'; provenance: 'same-face-camera-finish-estimate'; estimated: true;
  observedFraction: number; supportFraction: number; spatialCellCount: number;
  textureTreatment: 'smooth' | 'observed-fine-detail';
};
interface Sample { rgb: Vec; lab: Vec; cell: number }
interface Group { samples: Sample[]; rgb: Vec; lab: Vec; cells: Set<number>; share: number }
const MAX_SAMPLES = 4096, MAX_PIXELS = 1_048_576;
const linear = (byte: number) => { const x = byte / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; };
const srgb = (x: number) => Math.round(255 * Math.max(0, Math.min(1, x <= .0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - .055)));
function feature(rgb: Vec): Vec {
  const c = rgb.map(linear), l = Math.cbrt(.4122214708 * c[0] + .5363325363 * c[1] + .0514459929 * c[2]);
  const m = Math.cbrt(.2119034982 * c[0] + .6806995451 * c[1] + .1073969566 * c[2]);
  const s = Math.cbrt(.0883024619 * c[0] + .2817188376 * c[1] + .6299787005 * c[2]);
  return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s];
}
const chroma = (f: Vec) => Math.hypot(f[1], f[2]);
const distance = (a: Vec, b: Vec) => ((a[0] - b[0]) * .7) ** 2 + ((a[1] - b[1]) * 2) ** 2 + ((a[2] - b[2]) * 2) ** 2;
const median = (values: number[]) => { const ordered = values.sort((a, b) => a - b); return ordered[Math.floor(ordered.length / 2)]; };
function compatible(a: Vec, b: Vec, lightnessTolerance: number, chromaRatio = .60): boolean {
  if (Math.abs(a[0] - b[0]) > lightnessTolerance) return false;
  const ca = chroma(a), cb = chroma(b);
  if (ca < .025 || cb < .025) return ca < .025 && cb < .025;
  return Math.min(ca, cb) / Math.max(ca, cb) >= chromaRatio && (a[1] * b[1] + a[2] * b[2]) / (ca * cb) >= .9;
}
function cluster(samples: Sample[]): Group[] {
  const centers: Vec[] = [[0, 1, 2].map(c => median(samples.map(s => s.lab[c]))) as Vec];
  while (centers.length < 5) {
    let farthest: Sample | null = null, best = .025 ** 2;
    for (const sample of samples) {
      const d = Math.min(...centers.map(center => distance(sample.lab, center)));
      if (d > best) { best = d; farthest = sample; }
    }
    if (!farthest) break; centers.push([...farthest.lab]);
  }
  let groups: Sample[][] = [];
  for (let iteration = 0; iteration < 12; iteration++) {
    groups = centers.map(() => []);
    for (const sample of samples) {
      let selected = 0;
      for (let i = 1; i < centers.length; i++) if (distance(sample.lab, centers[i]) < distance(sample.lab, centers[selected])) selected = i;
      groups[selected].push(sample);
    }
    groups.forEach((group, i) => { if (group.length) centers[i] = [0, 1, 2].map(c => group.reduce((sum, s) => sum + s.lab[c], 0) / group.length) as Vec; });
  }
  return groups.filter(g => g.length).map(group => {
    const rgb = [0, 1, 2].map(c => median(group.map(s => s.rgb[c]))) as Vec;
    return { samples: group, rgb, lab: feature(rgb), cells: new Set(group.map(s => s.cell)), share: group.length / samples.length };
  });
}
const unknown = (reason: Extract<CleanFaceFinish, { status: 'unknown' }>['reason']): CleanFaceFinish => ({ status: 'unknown', reason, confidence: 'low', provenance: 'same-face-camera-finish-estimate', estimated: true });

/** Interpret one clean face's finish instead of baking camera fragments,
 * handles, seams or clutter into its material. At most4096 spatially sampled
 * observed pixels enter five bounded Oklab clusters. Distributed dominant hue
 * families survive; compact outliers, pale overlapping glare and minority
 * hardware do not. Independent substantial color families fail explicitly.
 *
 * The base finish is an estimate, not calibrated reflectance. Opted-in
 * measured stone grids can retain restrained, spatially observed fine detail. No source pixel, support mask, geometry, selection,
 * catalog ID or estimate is mutated. Never pool multiple faces in one call. */
export function deriveCleanFaceFinish(input: CleanFaceFinishInput): CleanFaceFinish {
  const { rgba, width, height, slot } = input, count = width * height;
  if (!(rgba instanceof Uint8Array) || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 1024 || height > 1024 || count > MAX_PIXELS
    || rgba.length !== count * 4 || typeof slot !== 'string' || !slot.length || slot.length > 100) return unknown('invalid-input');
  let observed = 0;
  for (let i = 3; i < rgba.length; i += 4) { if (rgba[i] !== 0 && rgba[i] !== 255) return unknown('invalid-input'); if (rgba[i]) observed++; }
  if (observed < 48 || observed / count < .01) return unknown('insufficient-evidence');
  const samples: Sample[] = [], allCells = new Set<number>(); let seen = 0, lastBucket = -1;
  for (let i = 0; i < count; i++) {
    if (!rgba[i * 4 + 3]) continue;
    const bucket = Math.floor(seen++ * Math.min(observed, MAX_SAMPLES) / observed); if (bucket === lastBucket) continue; lastBucket = bucket;
    const rgb: Vec = [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]], x = i % width, y = Math.floor(i / width), cell = Math.min(7, Math.floor(y * 8 / height)) * 8 + Math.min(7, Math.floor(x * 8 / width));
    samples.push({ rgb, lab: feature(rgb), cell }); allCells.add(cell);
  }
  if (allCells.size < 4) return unknown('insufficient-evidence');
  const appliance = slot === 'appliances', stone = /countertop|_top$/.test(slot), cabinet = /cabinet/.test(slot);
  // Reflected cabinetry, stickers and food are not an appliance's metal/paint.
  // A colored appliance without distributed neutral evidence stays unknown.
  const candidates = appliance ? samples.filter(s => chroma(s.lab) < .035) : samples;
  if (candidates.length < 48 || candidates.length / samples.length < (appliance ? .35 : .04) || new Set(candidates.map(s => s.cell)).size < 4) return unknown('insufficient-evidence');
  const groups = cluster(candidates).sort((a, b) => b.share * (.8 + .2 * Math.sqrt(b.cells.size / allCells.size)) - a.share * (.8 + .2 * Math.sqrt(a.cells.size / allCells.size)));
  const selected = groups[0], tolerance = stone ? .22 : appliance ? .15 : .20;
  const family = groups.filter(group => compatible(selected.lab, group.lab, tolerance, stone ? .5 : .60));
  const selectedCells = new Set(family.flatMap(group => [...group.cells])), support = family.reduce((sum, g) => sum + g.share, 0);
  if (selected.share < .25 || support < .38 || selectedCells.size < 4) return unknown('mixed-appearance');
  for (const other of groups) {
    if (family.includes(other) || other.share < .23) continue;
    const overlap = [...other.cells].filter(cell => selectedCells.has(cell)).length / other.cells.size;
    const ca = chroma(selected.lab), cb = chroma(other.lab);
    const paleGlare = ca >= .025 && cb < ca * .65 && other.lab[0] >= selected.lab[0] - .025 && overlap >= .60;
    const sameHue = cb < .025 || (selected.lab[1] * other.lab[1] + selected.lab[2] * other.lab[2]) / (ca * cb) >= .9;
    const overlappingShadow = support >= .55 && other.share < .4 && ca >= .025 && cb < ca * .65
      && other.lab[0] >= selected.lab[0] - .18 && sameHue && overlap >= .65;
    if (!paleGlare && !overlappingShadow) return unknown('mixed-appearance');
  }
  if (observed / count < .04 && (observed < 128 || selectedCells.size < 6 || support < .8)) return unknown('insufficient-evidence');
  // Small countertop fragments often belong to a cloth, plant or appliance
  // resting on the slab. A scattered minority of its image domain must not
  // paint an entire clean slab unless one broadly distributed family agrees.
  // This is independent of hue: a broadly observed dark/green stone is valid.
  if (stone && observed / count < .12 && (support < .8 || selectedCells.size < 12)) return unknown('insufficient-evidence');
  const accepted = family.flatMap(group => group.samples);
  let color = [0, 1, 2].map(c => median(accepted.map(s => s.rgb[c]))) as Vec;
  let finishKind: Extract<CleanFaceFinish, { status: 'supported' }>['finishKind'] = cabinet ? 'cabinet' : stone ? 'stone' : 'surface';
  if (appliance) {
    const neutral = srgb(accepted.map(s => s.rgb.map(linear) as Vec).map(c => c[0] * .2126 + c[1] * .7152 + c[2] * .0722).sort((a, b) => a - b)[Math.floor(accepted.length / 2)]);
    color = [neutral, neutral, neutral]; const lightness = feature(color)[0];
    finishKind = lightness < .36 ? 'black-appliance' : lightness > .76 ? 'white-appliance' : 'steel-appliance';
  }
  const output = new Uint8Array(rgba.length);
  for (let i = 0; i < output.length; i += 4) { output[i] = color[0]; output[i + 1] = color[1]; output[i + 2] = color[2]; output[i + 3] = 255; }
  const detailPixels = stone && input.preserveSurfaceDetail === true ? retainFineSurfaceDetail(input, output, color) : 0;
  return { status: 'supported', rgba: output, cleanColorSRGB: color, cleanColorLinear: color.map(linear) as Vec, finishKind,
    confidence: observed / count >= .45 && support >= .55 && selectedCells.size >= 12 ? 'medium' : 'low', provenance: 'same-face-camera-finish-estimate', estimated: true,
    observedFraction: observed / count, supportFraction: support * candidates.length / samples.length, spatialCellCount: selectedCells.size, textureTreatment: detailPixels > 0 ? 'observed-fine-detail' : 'smooth' };
}

/** Keep restrained same-surface detail at its recorded location. A local mean
 * removes broad exposure/shadow changes; colored clutter, unsupported pixels
 * and mask edges contribute nothing. No vein is synthesized or repeated into
 * an unobserved region, and the camera buffer is never changed. */
function retainFineSurfaceDetail(input: CleanFaceFinishInput, output: Uint8Array, color: Vec): number {
  const { width, height, rgba } = input, count = width * height;
  if (count > 256 * 256) return 0;
  const eligible = new Uint8Array(count), base = feature(color);
  for (let i = 0; i < count; i++) {
    if (rgba[i * 4 + 3] !== 255) continue;
    const f = feature([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
    if (Math.abs(f[0] - base[0]) <= .18 && Math.hypot(f[1] - base[1], f[2] - base[2]) <= .035) eligible[i] = 1;
  }
  let details = 0;
  for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
    const index = y * width + x; if (!eligible[index]) continue;
    let support = 0; const sum = [0, 0, 0];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const neighbor = (y + dy) * width + x + dx; if (!eligible[neighbor]) continue;
      support++; for (let c = 0; c < 3; c++) sum[c] += rgba[neighbor * 4 + c];
    }
    if (support < 23) continue;
    const residual = [0, 1, 2].map(c => rgba[index * 4 + c] - sum[c] / support);
    // Reject isolated high-contrast marks instead of copying utensils/cloth.
    if (Math.max(...residual.map(Math.abs)) > 28 || Math.max(...residual.map(Math.abs)) < 1) continue;
    for (let c = 0; c < 3; c++) output[index * 4 + c] = Math.round(Math.max(0, Math.min(255, color[c] + Math.max(-12, Math.min(12, residual[c])))));
    details++;
  }
  return details;
}
