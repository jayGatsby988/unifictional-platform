/** Public synthetic geometry, not a camera capture. Used to inspect the exact
 * native archive → Studio path without a phone or any private kitchen data.
 * Usage: npx tsx scripts/create-mesh-review-fixture.ts <output-directory>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ShapeUtils, Vector2 } from 'three';

type Point = [number, number, number];
type Color = [number, number, number, number];
const triangles: { points: [Point, Point, Point]; color: Color }[] = [];
const observed = (r: number, g: number, b: number): Color => [r, g, b, 255];
const wine = observed(104, 47, 43), stone = observed(185, 161, 122);
const pale = observed(213, 213, 200), floor = observed(118, 134, 141);
function triangle(a: Point, b: Point, c: Point, color: Color) { triangles.push({ points: [a, b, c], color }); }
function quad(a: Point, b: Point, c: Point, d: Point, color: Color) { triangle(a, b, c, color); triangle(a, c, d, color); }
function slab(ring: Vector2[], y: number, thickness: number, color: Color) {
  const points = (height: number) => ring.map(p => [p.x, height, p.y] as Point);
  const top = points(y), bottom = points(y - thickness);
  for (const [a, b, c] of ShapeUtils.triangulateShape(ring, [])) triangle(top[a], top[b], top[c], color);
  ring.forEach((_, i) => { const j = (i + 1) % ring.length; quad(bottom[i], bottom[j], top[j], top[i], color); });
}
function box(x: number, y: number, z: number, w: number, h: number, d: number, color: Color) {
  slab([new Vector2(x-w/2, z-d/2), new Vector2(x+w/2, z-d/2), new Vector2(x+w/2, z+d/2), new Vector2(x-w/2, z+d/2)], y+h/2, h, color);
}
// A curved D-shaped end and a real concave bend; all are deliberate synthetic
// source coordinates. The test archive never fits them to a rectangular box.
const outline = [new Vector2(-1.4,-.65), new Vector2(.7,-.65)];
for (let i = 1; i <= 32; i++) {
  const theta = -Math.PI/2 + Math.PI*i/32;
  outline.push(new Vector2(.7+.65*Math.cos(theta), .65*Math.sin(theta)));
}
outline.push(new Vector2(-.25,.65), new Vector2(-.25,1.1), new Vector2(-1.4,1.1));
slab(outline, .89, .78, wine);
slab(outline, .94, .05, stone);
const bar = [new Vector2(-1.4,-.65),new Vector2(.7,-.65)];
for (let i = 1; i <= 32; i++) {
  const theta = -Math.PI/2 + Math.PI*i/32;
  bar.push(new Vector2(.7+.65*Math.cos(theta), .65*Math.sin(theta)));
}
for (let i = 32; i >= 0; i--) {
  const theta = -Math.PI/2 + Math.PI*i/32;
  bar.push(new Vector2(.7+.4*Math.cos(theta), .4*Math.sin(theta)));
}
bar.push(new Vector2(-1.4,-.4));
slab(bar, 1.14, .04, stone);
// Tile variations expose color-space errors; one tile has no color observation.
for (let x = 0; x < 12; x++) for (let z = 0; z < 10; z++) {
  const x0 = -3+x*.5, z0 = -2.5+z*.5;
  const color: Color = x === 10 && z === 7 ? [255,0,0,0] : observed(floor[0]+(x+z)%2*8, floor[1]+(x+z)%2*8, floor[2]+(x+z)%2*8);
  quad([x0,0,z0],[x0+.495,0,z0],[x0+.495,0,z0+.495],[x0,0,z0+.495],color);
}
quad([-3,0,-2.5],[3,0,-2.5],[3,2.7,-2.5],[-3,2.7,-2.5],pale);
quad([3,0,-2.5],[3,0,2.5],[3,2.7,2.5],[3,2.7,-2.5],pale);
box(-1.4,.45,-2.15,2.6,.9,.65,wine);
box(-1.4,.93,-2.15,2.65,.05,.68,stone);
box(-1.4,1.95,-2.3,2.6,.65,.38,wine);
box(2.5,.95,-1.65,.8,1.9,.8,observed(71,77,80));
const archive = Buffer.alloc(13+triangles.length*48);
archive.write('MNHMESH2'); archive.writeUInt32LE(triangles.length,8); archive[12]=0;
triangles.forEach(({points,color}, i) => {
  points.flat().forEach((value,j) => archive.writeFloatLE(value,13+i*48+j*4));
  for (let v=0;v<3;v++) color.forEach((value,j)=>{archive[13+i*48+36+v*4+j]=value;});
});
const transform = (x:number,y:number,z:number, angle=0) => [Math.cos(angle),0,-Math.sin(angle),0,0,1,0,0,Math.sin(angle),0,Math.cos(angle),0,x,y,z,1];
const element = (id:string,kind:string,x:number,y:number,z:number,w:number,h:number,d:number,angle=0) => ({id,kind,position:{x,y,z},dimensions:{x:w,y:h,z:d},transform:transform(x,y,z,angle),confidence:'sample'});
const floorElement = {...element('synthetic-floor','floor',0,0,0,6,5,0),polygonCorners:[{x:-3,y:0,z:-2.5},{x:3,y:0,z:-2.5},{x:3,y:0,z:2.5},{x:-3,y:0,z:2.5}]};
const payload = {version:1,id:'synthetic-colored-curved-island',name:'Synthetic color and curved-island check',roomType:'kitchen',isSample:true,
  room:{capturedAt:'2026-09-12T00:00:00Z',surfaces:[element('synthetic-back','wall',0,1.35,-2.5,6,2.7,0),element('synthetic-right','wall',3,1.35,0,5,2.7,0,Math.PI/2),floorElement],
    objects:[element('synthetic-island','storage',0,.57,.2,2.8,1.14,1.8),element('synthetic-base','storage',-1.4,.45,-2.15,2.6,.9,.65),element('synthetic-upper','storage',-1.4,1.95,-2.3,2.6,.65,.38),element('synthetic-fridge','refrigerator',2.5,.95,-1.65,.8,1.9,.8)]},
  measurements:{widthMeters:6,depthMeters:5,heightMeters:2.7,verified:false}};
const directory = process.argv[2];
if (!directory) throw new Error('Pass an output directory. This script writes synthetic verification assets only.');
mkdirSync(resolve(directory),{recursive:true});
writeFileSync(resolve(directory,'native-payload.json'),JSON.stringify(payload));
writeFileSync(resolve(directory,'lidar-mesh-v2.bin'),archive);
writeFileSync(resolve(directory,'import.js'),`(() => { const p = ${JSON.stringify(payload)}; const r = window.manhattanNativeImport(p); if(!r.ok) return r; return window.manhattanNativeMesh({projectId:p.id,token:r.assetToken,data:${JSON.stringify(archive.toString('base64'))}}); })()`);
console.log(JSON.stringify({synthetic:true,triangles:triangles.length,bytes:archive.length,output:resolve(directory)}));
