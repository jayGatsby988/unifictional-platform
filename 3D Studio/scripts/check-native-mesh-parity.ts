/** Read-only replay against saved native assets; never uploads their contents.
 * Usage: npx tsx scripts/check-native-mesh-parity.ts <native-payload.json> <mesh.bin>
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Matrix4, Vector3 } from 'three';
import { importNativeScan, nativeRoomFrame, NativeScanPayloadZ } from '../src/lib/native/scan-import';
import { decodeMeshArchive, srgbByteToLinear } from '../src/lib/native/mesh-archive';
import { scannedObjectLayout } from '../src/components/scene/scanned-object-layout';

const [payloadPath, meshPath] = process.argv.slice(2);
if (!payloadPath || !meshPath) throw new Error('Pass a native bridge payload and its saved mesh archive. Both files stay local.');
const payload = NativeScanPayloadZ.parse(JSON.parse(readFileSync(payloadPath, 'utf8')));
const project = importNativeScan(payload).project;
const before = JSON.stringify(project);
const frame = nativeRoomFrame(payload);
const data = readFileSync(meshPath);
const mesh = decodeMeshArchive(data.toString('base64'), frame);
const { widthAxis: u, depthAxis: v, origin: o } = frame;
// Independently reconstruct the inverse of the room's world-space basis.
const roomToWorld = new Matrix4().set(u.x,0,v.x,o.x, 0,1,0,o.y, u.z,0,v.z,o.z, 0,0,0,1);
const worldToRoom = roomToWorld.clone().invert();
const geometry = project.spec && 'scanGeometry' in project.spec ? project.spec.scanGeometry : undefined;
assert.ok(geometry, 'The imported project must retain captured room geometry');
const layout = scannedObjectLayout(geometry, payload.roomType);
let maximumObjectCornerError = 0, checkedObjectCorners = 0;
for (const source of payload.room.objects) {
  const presented = layout.objects.find(object => object.id === source.id);
  assert.ok(presented, `Captured object ${source.id} disappeared from the presentation`);
  assert.deepEqual(presented.dimensions, source.dimensions, 'Presentation cannot resize captured bounds');
  assert.equal(presented.alignment.applied, false, 'Observed object orientation must remain unchanged by default');
  const rawObjectToWorld = new Matrix4().fromArray(source.transform);
  const objectToRoom = new Matrix4().fromArray(presented.transform);
  for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) {
    const corner = new Vector3(x * source.dimensions.x, y * source.dimensions.y, z * source.dimensions.z);
    const expected = corner.clone().applyMatrix4(rawObjectToWorld).applyMatrix4(worldToRoom);
    const actual = corner.clone().applyMatrix4(objectToRoom);
    const error = expected.distanceTo(actual);
    maximumObjectCornerError = Math.max(maximumObjectCornerError, error);
    checkedObjectCorners++;
    assert.ok(error < 1e-8, 'Object normalization changed its position, orientation or aisle relationship');
  }
}
const stride = mesh.version === 2 ? 48 : 36;
let maxError = 0, observed = 0;
for (let t=0; t<mesh.triangleCount; t++) for (let vertex=0; vertex<3; vertex++) {
  const start=13+t*stride+vertex*12, index=t*9+vertex*3;
  const expected = new Vector3(data.readFloatLE(start),data.readFloatLE(start+4),data.readFloatLE(start+8)).applyMatrix4(worldToRoom);
  expected.toArray().forEach((value,axis) => {
    const error = Math.abs(value-mesh.positions[index+axis]);
    maxError = Math.max(maxError,error);
    assert.ok(error <= Math.max(1e-6,Math.abs(value)*1e-7), 'Mesh vertex changed beyond Float32 storage precision');
  });
  if (mesh.version === 2) {
    const colorOffset=13+t*stride+36+vertex*4, captured=data[colorOffset+3]===255;
    assert.equal(mesh.captured[t*3+vertex],captured?1:0);
    if (captured) {
      observed++;
      for (let channel=0;channel<3;channel++) assert.ok(Math.abs(mesh.colors[index+channel]-srgbByteToLinear(data[colorOffset+channel]))<1e-7);
    }
  }
}
assert.equal(mesh.coloredVertexCount,observed);
assert.equal(JSON.stringify(project),before,'Mesh display changed the editable project or measurements');
assert.equal(data.readUInt32LE(8),mesh.triangleCount);
console.log(JSON.stringify({passed:true,triangles:mesh.triangleCount,vertices:mesh.positions.length/3,coloredVertices:observed,maximumCoordinateRoundoffMeters:maxError,
  checkedObjectCorners,maximumObjectCornerErrorMeters:maximumObjectCornerError,projectUnchanged:true,
  limitation:'Object bounds preserve placement but do not establish a curved footprint or a verified physical aisle width.'}));
