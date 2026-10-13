/**
 * Cross-language contract checks against JSON emitted by the actual Swift scan
 * models/extractor. Pass the synthetic emitter output, never a private scan:
 *   npx --yes tsx scripts/check-native-countertop-parity.ts /path/to/emitted.json
 * The fixture may contain one native payload or an array of payloads. This
 * verifies serialization/geometry integration, not physical LiDAR accuracy.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importNativeScan, NativeScanPayloadZ, NativeStudioProjectZ, type NativeRoomFrame, type NativeScanPayload } from '../src/lib/native/scan-import';
import { countertopSignedArea } from '../src/lib/native/countertop-surfaces';
import { scannedObjectLayout } from '../src/components/scene/scanned-object-layout';
import { calculateEstimate } from '../src/lib/estimate/estimator';
import type { Project, ScannedRoomGeometry } from '../src/lib/spec/types';

type Point = { x: number; y: number; z: number };
let checks = 0;
const check = (name: string, run: () => void) => { run(); checks++; console.log(`PASS ${name}`); };
const close = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) <= 1e-8, `${label}: ${actual} != ${expected}`);
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function geometry(project: Project): ScannedRoomGeometry {
  assert.ok(project.spec && 'scanGeometry' in project.spec && project.spec.scanGeometry, 'captured geometry must survive import');
  return project.spec.scanGeometry;
}
function normalized(point: Point, frame: NativeRoomFrame): Point {
  const x = point.x - frame.origin.x, z = point.z - frame.origin.z;
  return { x: x * frame.widthAxis.x + z * frame.widthAxis.z, y: point.y - frame.origin.y, z: x * frame.depthAxis.x + z * frame.depthAxis.z };
}
/** Also exercise a nonzero AR world origin/yaw when the Swift fixture is axis-aligned. */
function movedFixture(source: NativeScanPayload): NativeScanPayload {
  const moved = structuredClone(source), c = Math.cos(0.37), s = Math.sin(0.37);
  const rotate = (p: Point): Point => ({ x: c * p.x + s * p.z, y: p.y, z: -s * p.x + c * p.z });
  const point = (p: Point): Point => { const r = rotate(p); return { x: r.x + 4.3, y: r.y + 1.2, z: r.z - 2.7 }; };
  for (const element of [...moved.room.surfaces, ...moved.room.objects]) {
    element.position = point(element.position);
    for (const offset of [0, 4, 8]) {
      const axis = rotate({ x: element.transform[offset], y: element.transform[offset + 1], z: element.transform[offset + 2] });
      element.transform.splice(offset, 3, axis.x, axis.y, axis.z);
    }
    element.transform.splice(12, 3, element.position.x, element.position.y, element.position.z);
    if (element.polygonCorners) element.polygonCorners = element.polygonCorners.map(point);
    for (const surface of element.countertopSurfaces ?? []) {
      surface.polygonCorners = surface.polygonCorners.map(point);
      if (surface.holes) surface.holes = surface.holes.map(hole => hole.map(point));
    }
  }
  return NativeScanPayloadZ.parse(moved);
}
function ringPreserved(source: Point[], output: Point[], frame: NativeRoomFrame, label: string) {
  assert.equal(output.length, source.length, `${label}: original ring vertices changed`);
  source.forEach((point, i) => {
    const expected = normalized(point, frame);
    for (const axis of ['x', 'y', 'z'] as const) close(output[i][axis], expected[axis], `${label}[${i}].${axis}`);
  });
  close(countertopSignedArea(output), countertopSignedArea(source), `${label}: winding and area`);
}
function assertPreserved(source: NativeScanPayload, project: Project, frame: NativeRoomFrame) {
  const output = geometry(project);
  for (const original of [...source.room.surfaces, ...source.room.objects]) {
    const converted = [...output.surfaces, ...output.objects].find(element => element.id === original.id);
    assert.ok(converted, `missing captured element ${original.id}`);
    assert.deepEqual(converted.dimensions, original.dimensions);
    assert.equal(converted.confidence, original.confidence);
    const expectedPosition = normalized(original.position, frame);
    [expectedPosition.x, expectedPosition.y, expectedPosition.z].forEach((value, i) => close(converted.transform[12 + i], value, `${original.id} position`));
    for (const offset of [0, 4, 8]) {
      const x = original.transform[offset], y = original.transform[offset + 1], z = original.transform[offset + 2];
      close(converted.transform[offset], x * frame.widthAxis.x + z * frame.widthAxis.z, `${original.id} basis X`);
      close(converted.transform[offset + 1], y, `${original.id} basis Y`);
      close(converted.transform[offset + 2], x * frame.depthAxis.x + z * frame.depthAxis.z, `${original.id} basis Z`);
    }
    const before = original.countertopSurfaces ?? [], after = converted.countertopSurfaces ?? [];
    assert.equal(after.length, before.length, `${original.id}: lost observed patches`);
    before.forEach((surface, i) => {
      assert.equal(after[i].source, surface.source);
      assert.equal(after[i].resolutionMeters, surface.resolutionMeters);
      ringPreserved(surface.polygonCorners, after[i].polygonCorners, frame, `${original.id}/${i}`);
      assert.equal(after[i].holes?.length ?? 0, surface.holes?.length ?? 0);
      (surface.holes ?? []).forEach((hole, j) => ringPreserved(hole, after[i].holes![j], frame, `${original.id}/${i}/hole${j}`));
    });
  }
}

assert.equal(process.argv.length, 3, 'Pass exactly one Swift-emitted synthetic fixture JSON path.');
const document: unknown = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const fixtures = (Array.isArray(document) ? document : [document]).map(value => NativeScanPayloadZ.parse(value));
assert.ok(fixtures.length > 0 && fixtures.length <= 24, 'bounded nonempty fixture collection');
const cases = fixtures.flatMap((source, index) => [
  { source, original: true, label: `Swift fixture ${index + 1}` },
  { source: movedFixture(source), original: false, label: `Swift fixture ${index + 1}, rotated and translated` },
]);
let patches = 0, holes = 0, concave = false;
const elevations = new Set<string>();

for (const { source, original, label } of cases) {
  assert.equal(source.isSample, true, 'Use synthetic Swift fixtures, never private captured rooms.');
  const originalJSON = JSON.stringify(source);
  const result = importNativeScan(freeze(source));
  assert.ok(result.frame, 'fresh Swift payload must normalize its room');
  const frame = result.frame, project = result.project;
  const measured = source.room.objects.flatMap(object => object.countertopSurfaces ?? []);
  if (original) patches += measured.length;
  for (const surface of original ? measured : []) {
    holes += surface.holes?.length ?? 0;
    elevations.add(surface.polygonCorners[0].y.toFixed(4));
    const signs = surface.polygonCorners.map((b, i, ring) => {
      const a = ring[(i + ring.length - 1) % ring.length], c = ring[(i + 1) % ring.length];
      return Math.sign((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x));
    });
    if (signs.includes(-1) && signs.includes(1)) concave = true;
  }

  check(`${label}: Codable payload, bends, holes and elevations receive exactly one shared normalization`, () => {
    assertPreserved(source, project, frame);
    assert.equal(JSON.stringify(source), originalJSON, 'import modified source JSON');
    assert.deepEqual(project.baseline?.spec, project.spec, 'original baseline must include identical observed contours');
    NativeStudioProjectZ.parse(project);
  });
  check(`${label}: measured world pose remains locked even for a low-confidence island alignment request`, () => {
    const scan = structuredClone(geometry(project));
    for (const object of scan.objects) if (object.countertopSurfaces?.length) object.confidence = 'low';
    const before = JSON.stringify(scan);
    const layout = scannedObjectLayout(scan, source.roomType, { alignLowConfidenceIslands: true });
    for (const object of layout.objects.filter(object => object.countertopSurfaces?.length)) {
      const captured = scan.objects.find(element => element.id === object.id)!;
      assert.equal(object.alignment.applied, false);
      assert.deepEqual(object.transform, captured.transform);
      assert.deepEqual(object.sourceTransform, captured.transform);
      assert.deepEqual(object.countertopSurfaces, captured.countertopSurfaces);
    }
    assert.equal(JSON.stringify(scan), before, 'presentation changed captured geometry');
  });
  check(`${label}: old payloads omitting optional contours and holes still import`, () => {
    const legacy = structuredClone(source);
    for (const object of [...legacy.room.surfaces, ...legacy.room.objects]) delete object.countertopSurfaces;
    const restored = importNativeScan(legacy);
    assert.ok(restored.frame);
    assertPreserved(legacy, restored.project, restored.frame);
    assert.ok(geometry(restored.project).objects.every(object => object.countertopSurfaces === undefined));
    const withoutHoles = structuredClone(source);
    for (const object of withoutHoles.room.objects) for (const surface of object.countertopSurfaces ?? []) delete surface.holes;
    const omitted = importNativeScan(withoutHoles);
    assert.ok(omitted.frame);
    assertPreserved(withoutHoles, omitted.project, omitted.frame);
  });
  check(`${label}: either ring winding imports without rewriting observed points`, () => {
    const reversed = structuredClone(source);
    for (const object of reversed.room.objects) for (const surface of object.countertopSurfaces ?? []) {
      surface.polygonCorners.reverse();
      surface.holes?.forEach(hole => hole.reverse());
    }
    const imported = importNativeScan(reversed);
    assert.ok(imported.frame);
    assertPreserved(reversed, imported.project, imported.frame);
  });
  check(`${label}: material edit, estimation and saved snapshot preserve source geometry and baseline`, () => {
    const saved = structuredClone(project), baseline = structuredClone(saved.baseline), observed = structuredClone(geometry(saved));
    saved.selections[source.roomType === 'kitchen' ? 'countertop' : 'vanity_top'] = 'ct-black-granite';
    const beforeEstimate = JSON.stringify(saved);
    assert.ok(saved.spec);
    calculateEstimate(saved.spec, saved.selections, saved.estimateSettings, saved.baseline);
    assert.equal(JSON.stringify(saved), beforeEstimate, 'estimate mutated design');
    const restored = importNativeScan({ ...source, studioSnapshot: saved });
    assert.equal(restored.restored, true);
    assert.deepEqual(restored.project, saved);
    assert.deepEqual(restored.project.baseline, baseline);
    assert.deepEqual(geometry(restored.project), observed);
  });
  if (measured.length) check(`${label}: malformed enrichment rejects explicitly without mutating valid legacy source`, () => {
    const invalid = structuredClone(source);
    const object = invalid.room.objects.find(object => object.countertopSurfaces?.length)!;
    const surface = object.countertopSurfaces![0];
    surface.holes = [structuredClone(surface.polygonCorners)]; // Touches the entire outer boundary.
    assert.throws(() => importNativeScan(invalid), /Invalid native scan/);
    const tooMany = structuredClone(source);
    const capped = tooMany.room.objects.find(object => object.countertopSurfaces?.length)!;
    capped.countertopSurfaces = Array.from({ length: 9 }, () => structuredClone(capped.countertopSurfaces![0]));
    assert.throws(() => importNativeScan(tooMany), /Invalid native scan/);
    assert.equal(JSON.stringify(source), originalJSON);
  });
}

assert.ok(patches >= 2, 'Swift extraction fixtures must exercise multiple observed patches');
assert.ok(holes > 0, 'Swift extraction fixtures must include an observed coverage hole');
assert.ok(concave, 'Swift extraction fixtures must include a concave bend');
assert.ok(elevations.size > 1, 'Swift extraction fixtures must include separate observed heights');
console.log(`PASS ${checks} cross-language checks across ${fixtures.length} Swift fixtures and ${patches} observed patches. Physical scan accuracy is a separate device check.`);
