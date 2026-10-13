import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { ScannedElement, ScannedRoomGeometry } from '../src/lib/spec/types';
import { measuredFrameVisible, scannedOpeningCutawaySign } from '../src/components/scene/scanned-frame-visibility';
import { openingOnScannedWall, scannedWallGeometry } from '../src/components/scene/scanned-geometry';

let count=0;
const check=(name:string,run:()=>void)=>{run();console.log(`PASS ${++count}: ${name}`);};
function element(id:string,kind:string,w:number,h:number,frame:THREE.Matrix4):ScannedElement {
 return {id,kind,confidence:'high',dimensions:{x:w,y:h,z:0},transform:frame.toArray()};
}
function fixture(yaw=0,position:[number,number,number]=[0,0,0],reverseWindow=false) {
 const world=new THREE.Matrix4().makeRotationY(yaw).setPosition(...position);
 const wall=element('wall','wall',3,2.6,world.clone().multiply(new THREE.Matrix4().makeTranslation(0,1.3,0)));
 const opening=element('window','window',0.6,0.9,world.clone().multiply(new THREE.Matrix4().makeTranslation(0.4,1.7,0.025)).multiply(new THREE.Matrix4().makeRotationY(reverseWindow?Math.PI:0)));
 const floor=element('floor','floor',3,3,world.clone());
 floor.polygonCorners=[[-1.5,0],[1.5,0],[1.5,3],[-1.5,3]].map(([x,z])=>{const p=new THREE.Vector3(x,0,z).applyMatrix4(world);return{x:p.x,y:p.y,z:p.z};});
 const scan:ScannedRoomGeometry={version:1,surfaces:[wall,floor,opening],objects:[]};
 const eye=(z:number)=>new THREE.Vector3(0,2,z).applyMatrix4(world).applyMatrix4(new THREE.Matrix4().fromArray(opening.transform).invert()).z;
 return{wall,opening,scan,eye};
}
check('the one measured window remains visible from both sides of a clean wall cutaway',()=>{
 const {wall,opening,scan,eye}=fixture();const before=JSON.stringify(scan);
 assert.ok(openingOnScannedWall(wall,opening));
 const sourceSign=scannedOpeningCutawaySign(opening,[wall],scan,true);
 assert.equal(measuredFrameVisible(eye(-4),sourceSign),false,'exterior camera reproduces the missing-window bug');
 const cleanSign=scannedOpeningCutawaySign(opening,[wall],scan,false);
 assert.equal(measuredFrameVisible(eye(-4),cleanSign),true);
 assert.equal(measuredFrameVisible(eye(2),cleanSign),true);
 assert.equal(JSON.stringify(scan),before,'visibility must not create, move, resize or rotate an opening');
});
check('rotated and translated rooms and reversed opening normals keep the same cutaway behavior',()=>{
 for(const yaw of [0.4,-0.8,Math.PI/2]) for(const reversed of [false,true]){
  const {wall,opening,scan,eye}=fixture(yaw,[3,0.2,-2],reversed);
  const before=JSON.stringify(scan);const sourceSign=scannedOpeningCutawaySign(opening,[wall],scan,true);
  assert.equal(measuredFrameVisible(eye(-3),sourceSign),false);
  assert.equal(measuredFrameVisible(eye(3),sourceSign),true);
  assert.equal(measuredFrameVisible(eye(-3),scannedOpeningCutawaySign(opening,[wall],scan,false)),true);
  assert.equal(JSON.stringify(scan),before);
 }
});
check('switching a previously hidden Source group to clean restores its visibility immediately',()=>{
 const {wall,opening,scan,eye}=fixture();
 const group=new THREE.Group();group.matrix.fromArray(opening.transform);group.matrixAutoUpdate=false;
 group.visible=measuredFrameVisible(eye(-4),scannedOpeningCutawaySign(opening,[wall],scan,true));
 assert.equal(group.visible,false);
 group.visible=measuredFrameVisible(eye(-4),scannedOpeningCutawaySign(opening,[wall],scan,false));
 assert.equal(group.visible,true);
 assert.deepEqual(group.matrix.toArray(),opening.transform);
});
check('doors and generic openings retain wall cutaway while unmatched measured windows remain visible',()=>{
 const {wall,opening,scan,eye}=fixture();
 for(const kind of ['door','opening']){
  const other={...opening,kind};const sign=scannedOpeningCutawaySign(other,[wall],scan,false);
  assert.notEqual(sign,undefined);assert.equal(measuredFrameVisible(eye(-3),sign),false);
 }
 const unrelated={...wall,transform:new THREE.Matrix4().makeTranslation(20,1.3,0).toArray()};
 assert.equal(scannedOpeningCutawaySign(opening,[unrelated],scan,false),undefined);
 assert.equal(scannedOpeningCutawaySign(opening,[unrelated],scan,true),undefined);
});
check('visible window retains a real wall aperture instead of being obscured by a filled wall',()=>{
 const {wall,opening,scan}=fixture(0.63,[5,0,-4]);const before=JSON.stringify(scan);
 const geometry=scannedWallGeometry(wall,[opening]);const frame=new THREE.Matrix4().fromArray(wall.transform);
 const centre=new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(opening.transform));
 const normal=new THREE.Vector3(0,0,1).transformDirection(frame);
 const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});const mesh=new THREE.Mesh(geometry,material);
 mesh.matrix.copy(frame);mesh.matrixAutoUpdate=false;mesh.updateMatrixWorld(true);
 const ray=new THREE.Raycaster(centre.clone().addScaledVector(normal,1),normal.clone().negate());
 assert.equal(ray.intersectObject(mesh).length,0,'window center must remain an actual hole in the captured wall');
 geometry.dispose();material.dispose();assert.equal(JSON.stringify(scan),before);
});
console.log(`${count} scanned opening visibility checks passed.`);
