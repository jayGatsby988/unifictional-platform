/** Synthetic geometry always runs. Optional read-only private replay:
 * --payload /path/payload.json --mesh /path/mesh.bin --texture /path/texture.bin
 * --report /ignored/path/report.json
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { capturedCameraUprightRotation, capturedPixelOnWall, projectCapturedPoint, rawToUprightUV, recoverCapturedCameras, uprightToRawUV, type CameraPoint, type CapturedCameraProjection, type CapturedImageRotation } from '../src/lib/native/camera-projection';
import { decodeMeshArchive, type ObservedMesh } from '../src/lib/native/mesh-archive';
import { decodeTextureArchive, type ScanTexture } from '../src/lib/native/texture-archive';
import { importNativeScan, nativeRoomFrame } from '../src/lib/native/scan-import';
import type { ScannedElement } from '../src/lib/spec/types';
let count=0;
const check=(name:string,run:()=>void)=>{run();console.log(`PASS ${++count}: ${name}`);};
const near=(a:number,b:number,tolerance=2e-5)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} differs from ${b}`);
function camera(pose=new THREE.Matrix4(),fx=.8,fy=1,cx=.48,cy=.52):CapturedCameraProjection {
 const m=pose.clone().invert().elements;
 return{frameIndex:0,samples:100,maximumUVError:0,rows:[Array.from({length:4},(_,i)=>fx*m[i*4]-cx*m[i*4+2]),Array.from({length:4},(_,i)=>-fy*m[i*4+1]-cy*m[i*4+2]),Array.from({length:4},(_,i)=>-m[i*4+2])]};
}
function fixture(pose=new THREE.Matrix4(),depthMode:'volume'|'plane'|'near-plane'|'line'='volume',triangles=150) {
 const known=camera(pose), positions=new Float32Array(triangles*9),coordinates=new Float32Array(triangles*9);
 let seed=49317;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 for(let t=0;t<triangles;t++){
  const x=(random()-.5)*.8,y=depthMode==='line'?x:(random()-.5)*.8;
  const z=depthMode==='volume'?-(1+random()*3):depthMode==='near-plane'?-2+(random()-.5)*.0002:-2;
  for(let v=0;v<3;v++){
   const point=new THREE.Vector3(x+(depthMode==='line'?0:v===1?.015:0),y+(depthMode==='line'?0:v===2?.015:0),z).applyMatrix4(pose);
   const offset=t*9+v*3;positions.set(point.toArray(),offset);
   const projected=projectCapturedPoint(known,Array.from(positions.slice(offset,offset+3)) as CameraPoint)!;
   assert.ok(projected);coordinates.set([projected.u,projected.v,projected.q],offset);
  }
 }
 const mesh:ObservedMesh={version:2,triangleCount:triangles,coloredVertexCount:0,wasLimited:false,positions,colors:new Float32Array(triangles*9),captured:new Float32Array(triangles*3),bounds:{min:[-1,-1,-5],max:[1,1,0]}};
 const texture:ScanTexture={geometrySHA256:'0'.repeat(64),triangleCount:triangles,texturedTriangleCount:triangles,images:[{width:384,height:288,rgba:new Uint8Array(384*288*4)}],frameIndices:new Int16Array(triangles),coordinates};
 return{known,mesh,texture};
}
const bytesHash=(array:ArrayBufferView)=>createHash('sha256').update(new Uint8Array(array.buffer,array.byteOffset,array.byteLength)).digest('hex');
check('full-rank nonplanar correspondences recover all held-out vertices and preserve source arrays',()=>{
 for(const pose of [new THREE.Matrix4(),new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(.25,-.6,.8)).setPosition(15,2,-9)]){
  const {known,mesh,texture}=fixture(pose);const before=[bytesHash(mesh.positions),bytesHash(texture.coordinates),bytesHash(texture.frameIndices)];
  const fitted=recoverCapturedCameras(mesh,texture)[0];assert.ok(fitted);assert.equal(fitted.samples,150);
  for(let offset=0;offset<mesh.positions.length;offset+=3){
   const p=Array.from(mesh.positions.slice(offset,offset+3)) as CameraPoint;
   const a=projectCapturedPoint(fitted,p)!,b=projectCapturedPoint(known,p)!;near(a.u,b.u);near(a.v,b.v);near(a.q,b.q);
  }
  assert.deepEqual([bytesHash(mesh.positions),bytesHash(texture.coordinates),bytesHash(texture.frameIndices)],before);
 }
});
check('bounded reservoir spans later room geometry instead of a coplanar prefix',()=>{
 const {known,mesh,texture}=fixture(new THREE.Matrix4(),'volume',1800);
 for(let t=0;t<900;t++)for(let v=0;v<3;v++){
  const offset=t*9+v*3;mesh.positions[offset+2]=-2;
  const projected=projectCapturedPoint(known,Array.from(mesh.positions.slice(offset,offset+3)) as CameraPoint)!;
  texture.coordinates.set([projected.u,projected.v,projected.q],offset);
 }
 const fitted=recoverCapturedCameras(mesh,texture)[0];assert.ok(fitted);assert.equal(fitted.samples,480);
 for(let offset=0;offset<mesh.positions.length;offset+=3){
  const p=Array.from(mesh.positions.slice(offset,offset+3)) as CameraPoint,a=projectCapturedPoint(fitted,p)!,b=projectCapturedPoint(known,p)!;near(a.u,b.u);near(a.v,b.v);near(a.q,b.q);
 }
});
check('coplanar, rank-deficient, near-planar and insufficient correspondence sets fail closed',()=>{
 const pose=new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(.6,.7,.4)).setPosition(1,2,3);
 for(const mode of ['plane','near-plane','line'] as const){const{mesh,texture}=fixture(pose,mode);assert.equal(recoverCapturedCameras(mesh,texture)[0],null,mode);}
 const {mesh,texture}=fixture(new THREE.Matrix4(),'volume',23);assert.equal(recoverCapturedCameras(mesh,texture)[0],null);
});
check('unbound counts and inconsistent camera correspondence data are rejected',()=>{
 const {mesh,texture}=fixture();
 assert.equal(recoverCapturedCameras(mesh,{...texture,triangleCount:texture.triangleCount+1})[0],null);
 const wrong={...texture,coordinates:texture.coordinates.slice()};for(let i=0;i<wrong.coordinates.length;i+=9)wrong.coordinates[i]+=(i%2?.12:-.12);
 assert.equal(recoverCapturedCameras(mesh,wrong)[0],null);
});
check('pixel rays intersect original rotated wall planes without trusting virtual reflection depth',()=>{
 const pose=new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(.1,-.3,.2)).setPosition(2,1,4),known=camera(pose);
 const frame=pose.clone().multiply(new THREE.Matrix4().makeTranslation(0,0,-3));
 const wall:ScannedElement={id:'wall',kind:'wall',confidence:'high',dimensions:{x:3,y:2,z:0},transform:frame.toArray()};
 const original=JSON.stringify(wall);
 for(const p of [[0,0,0],[.5,.3,0],[-.4,-.2,0]]){
  const point=new THREE.Vector3(...p).applyMatrix4(frame).toArray() as CameraPoint;
  const uv=projectCapturedPoint(known,point)!;const recovered=capturedPixelOnWall(known,uv.u,uv.v,wall);assert.ok(recovered);recovered.forEach((n,i)=>near(n,point[i]));
 }
 assert.equal(JSON.stringify(wall),original);
 const behind={...wall,transform:pose.clone().multiply(new THREE.Matrix4().makeTranslation(0,0,2)).toArray()};assert.equal(capturedPixelOnWall(known,.48,.52,behind),null);
 const parallel={...wall,transform:pose.clone().multiply(new THREE.Matrix4().makeRotationY(Math.PI/2)).toArray()};assert.equal(capturedPixelOnWall(known,.48,.52,parallel),null);
 for(const uv of [[NaN,.5],[-.1,.5],[.5,1.01]])assert.equal(capturedPixelOnWall(known,uv[0],uv[1],wall),null);
});
check('gravity upright uses pixel derivatives for all four camera rolls and rejects degenerate gravity',()=>{
 for(const roll of [0,Math.PI/2,Math.PI,3*Math.PI/2]){
  const projection=camera(new THREE.Matrix4().makeRotationZ(roll),.8,384/288*.8,.5,.5);
  const rotation=capturedCameraUprightRotation(projection,{width:384,height:288});assert.notEqual(rotation,null);
  const p=projectCapturedPoint(projection,[0,0,-2])!,up=projectCapturedPoint(projection,[0,.1,-2])!;
  const a=rawToUprightUV(p.u,p.v,rotation!),b=rawToUprightUV(up.u,up.v,rotation!);
  assert.ok(b.v<a.v);near(a.u,b.u);
 }
 const down=camera(new THREE.Matrix4().makeRotationX(Math.PI/2),.8,1,.5,.5);
 assert.equal(capturedCameraUprightRotation(down,{width:384,height:288}),null);
 const offsetDown=camera(new THREE.Matrix4().makeRotationX(Math.PI/2),.8,1,.43,.57);
 assert.equal(capturedCameraUprightRotation(offsetDown,{width:384,height:288}),null,'off-center intrinsics must not invent gravity when looking straight down');
 assert.equal(capturedCameraUprightRotation(camera(),{width:0,height:288}),null);
});
check('upright coordinates invert exactly for asymmetric masks, corners and out-of-frame points',()=>{
 const width=7,height=4,mask=Array.from({length:width*height},(_,i)=>i%3===1?255:0);
 for(const rotation of [0,90,180,270] as CapturedImageRotation[]){
  const swap=rotation===90||rotation===270,outputWidth=swap?height:width,outputHeight=swap?width:height;
  const upright=new Array<number>(outputWidth*outputHeight).fill(-1);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const rotated=rawToUprightUV((x+.5)/width,(y+.5)/height,rotation);
   const xx=Math.floor(rotated.u*outputWidth),yy=Math.floor(rotated.v*outputHeight);upright[yy*outputWidth+xx]=mask[y*width+x];
   const raw=uprightToRawUV((xx+.5)/outputWidth,(yy+.5)/outputHeight,rotation);near(raw.u,(x+.5)/width,1e-14);near(raw.v,(y+.5)/height,1e-14);
  }
  assert.equal(upright.filter(v=>v===255).length,mask.filter(v=>v===255).length);assert.ok(upright.every(v=>v===0||v===255));
  for(const [u,v] of [[0,0],[1,0],[0,1],[1,1],[-.2,1.1],[.37,.62]]){const rotated=rawToUprightUV(u,v,rotation),raw=uprightToRawUV(rotated.u,rotated.v,rotation);near(raw.u,u,1e-14);near(raw.v,v,1e-14);}
 }
});
async function replay(){
 const args=process.argv.slice(2),arg=(name:string)=>args[args.indexOf(name)+1];if(!args.includes('--mesh'))return;
 const payload=JSON.parse(readFileSync(arg('--payload'),'utf8'));const frame=nativeRoomFrame(payload),spec=importNativeScan(payload).project.spec;assert.ok(spec && (spec.roomType==='bathroom'||spec.roomType==='kitchen'));const scan=spec.scanGeometry!;
 const rawMesh=readFileSync(arg('--mesh')),rawTexture=readFileSync(arg('--texture'));const before=[bytesHash(rawMesh),bytesHash(rawTexture),JSON.stringify(scan)];
 const mesh=decodeMeshArchive(rawMesh.toString('base64'),frame),digest=await mesh.geometryDigest;assert.ok(digest);
 const texture=decodeTextureArchive(rawTexture.toString('base64'),digest,mesh.triangleCount);
 const decodedBefore=[bytesHash(mesh.positions),bytesHash(texture.coordinates),bytesHash(texture.frameIndices),...texture.images.map(image=>bytesHash(image.rgba))];
 const start=performance.now(),cameras=recoverCapturedCameras(mesh,texture),recoveryMs=performance.now()-start;
 const stats=cameras.map((camera,index)=>({frame:index,recovered:!!camera,fitSamples:camera?.samples??0,rotation:camera?capturedCameraUprightRotation(camera,texture.images[index]):null,vertices:0,maximumUVError:0,maximumDepthError:0,maximumPixelError:0}));
 for(let t=0;t<mesh.triangleCount;t++){
  const index=texture.frameIndices[t],camera=cameras[index];if(!camera)continue;
  for(let v=0;v<3;v++){
   const offset=t*9+v*3,p=Array.from(mesh.positions.slice(offset,offset+3)) as CameraPoint,projected=projectCapturedPoint(camera,p);assert.ok(projected);
   const du=projected.u-texture.coordinates[offset],dv=projected.v-texture.coordinates[offset+1];const s=stats[index];s.vertices++;
   s.maximumUVError=Math.max(s.maximumUVError,Math.hypot(du,dv));s.maximumDepthError=Math.max(s.maximumDepthError,Math.abs(projected.q-texture.coordinates[offset+2]));s.maximumPixelError=Math.max(s.maximumPixelError,Math.hypot(du*texture.images[index].width,dv*texture.images[index].height));
  }
 }
 for(const s of stats.filter(s=>s.recovered)){assert.ok(s.maximumUVError<.002);assert.ok(s.maximumDepthError<.005);}
 assert.deepEqual([bytesHash(rawMesh),bytesHash(rawTexture),JSON.stringify(scan)],before);
 assert.deepEqual([bytesHash(mesh.positions),bytesHash(texture.coordinates),bytesHash(texture.frameIndices),...texture.images.map(image=>bytesHash(image.rgba))],decodedBefore);
 const report={totalFrames:cameras.length,recoveredFrames:cameras.filter(Boolean).length,recoveryMs,allSourceBytesAndScanGeometryUnchanged:true,frames:stats};
 if(args.includes('--report'))writeFileSync(arg('--report'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
void replay().then(()=>console.log(`${count} captured camera projection checks passed.`));
