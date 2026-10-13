import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { deriveReconstructedFloorFinish } from '../src/lib/native/reconstructed-floor-finish';
import type { ReconstructedFloor } from '../src/lib/native/reconstructed-floor';
type RGB = [number, number, number];
type Floor = Extract<ReconstructedFloor, {status: 'supported'}>;
const color:RGB=[161,104,71];
function fixture(paint:(x:number,y:number)=>RGB=()=>color):Floor{
 const width=256,height=256,pitch=.0075,rgba=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)rgba.set([...paint((x+.5)*pitch,(y+.5)*pitch),255],(y*width+x)*4);
 return {status:'supported',source:'observed-floor-atlas',confidence:'low',layout:'world-registered',wrapping:'clamp-to-edge',width,height,rgba,metersPerTexel:pitch,spanMeters:[width*pitch,height*pitch],origin:[0,0,0],u:[1,0,0],v:[0,0,1],observedTexels:width*height,interiorTexels:width*height,coverageFraction:1,cameraSupportedTexels:width*height,unobservedInteriorTexels:0,excludedCameraTexels:0,cleanCoverageOfCameraEvidence:1,fillColorSRGB:color,observedAreaSquareMeters:width*height*pitch*pitch,estimatedFillRequired:true};
}
const add=(rgb:RGB,n:number)=>rgb.map(c=>Math.round(Math.max(0,Math.min(255,c+n)))) as RGB;
const fingerprint=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
let checks=0;function check(name:string,run:()=>void){run();checks++;console.log(`PASS ${name}`);}
check('uniform evidence cannot invent wood, tiles or joint dimensions',()=>{
 const r=deriveReconstructedFloorFinish(fixture())!;assert.equal(r.appearance,'unknown');assert.equal(r.pattern,'uniform');assert.deepEqual(r.jointSpacingMeters,[null,null]);assert.deepEqual(r.colorSRGB,color);
 for(let i=0;i<r.rgba.length;i+=4)assert.deepEqual([...r.rgba.slice(i,i+4)],[...color,255]);
});
check('consistent directional texture produces restrained inferred grain, not copied shadows',()=>{
 const f=fixture((x,y)=>add(color,8*Math.sin(y*127+x*.8)+3*Math.sin(y*63)+25*x/1.92));
 const r=deriveReconstructedFloorFinish(f)!;assert.equal(r.appearance,'wood-like');assert.equal(r.pattern,'directional-grain');assert.ok(r.evidence.independentCells>=6);assert.ok(r.evidence.directionalSupport>.8);
 assert.ok(Math.abs(r.u[2])<.1,'grain should run in the measured X direction');
 const reds=r.rgba.filter((_,i)=>i%4===0);assert.ok(Math.max(...reds)-Math.min(...reds)<=8,'exposure gradient must not repeat');assert.deepEqual(r.colorSRGB,color);
});
check('rotated directional evidence rotates clean grain without snapping to a room axis',()=>{
 const a=.43,f=fixture((x,y)=>add(color,9*Math.sin((-x*Math.sin(a)+y*Math.cos(a))*127)));
 const r=deriveReconstructedFloorFinish(f)!;assert.equal(r.pattern,'directional-grain');assert.ok(Math.abs(Math.abs(r.u[0]*Math.cos(a)+r.u[2]*Math.sin(a))-1)<.015);
});
check('smooth periodic grain cannot be promoted into a measured joint grid',()=>{
 const r=deriveReconstructedFloorFinish(fixture((_,y)=>add(color,10*Math.sin(y*2*Math.PI/.15))))!;
 assert.equal(r.pattern,'directional-grain');assert.deepEqual(r.jointSpacingMeters,[null,null]);
});
check('joint spacing is retained only for a repeated narrow line with independent spatial support',()=>{
 const f=fixture((_,y)=>add(color,(y%.15)<.012?-30:0));const r=deriveReconstructedFloorFinish(f)!;
 assert.equal(r.pattern,'directional-grain');assert.ok(r.jointSpacingMeters[1]!==null);assert.ok(Math.abs(r.jointSpacingMeters[1]!-.15)<.006);
});
check('grain, mineral and supported joint textures have byte-identical opposing wrap edges',()=>{
 for(const paint of [(_:number,y:number)=>add(color,9*Math.sin(y*127)),(x:number,y:number)=>add(color,9*Math.sin(x*127)*Math.sin(y*111)),(_:number,y:number)=>add(color,(y%.15)<.012?-30:0)]){
  const r=deriveReconstructedFloorFinish(fixture(paint))!;
  for(let y=0;y<r.height;y++)assert.deepEqual(r.rgba.slice(y*r.width*4,y*r.width*4+4),r.rgba.slice((y*r.width+r.width-1)*4,(y*r.width+r.width)*4));
  assert.deepEqual(r.rgba.slice(0,r.width*4),r.rgba.slice((r.height-1)*r.width*4));
 }
});
check('crossed or nondirectional texture cannot invent wood grain',()=>{
 const r=deriveReconstructedFloorFinish(fixture((x,y)=>add(color,9*Math.sin(x*127)*Math.sin(y*127))))!;
 assert.notEqual(r.appearance,'wood-like');assert.notEqual(r.pattern,'directional-grain');assert.equal(r.grainDirectionRadians,null);
});
check('one long shadow edge cannot authorize board spacing',()=>{
 const r=deriveReconstructedFloorFinish(fixture((_,y)=>add(color,y<.8?-35:0)))!;
 assert.deepEqual(r.jointSpacingMeters,[null,null]);assert.notEqual(r.pattern,'directional-grain');
});
check('excluded rug bytes cannot determine the clean material or its direction',()=>{
 const f=fixture((x,y)=>add(color,9*Math.sin(y*131+x)));
 for(let y=60;y<115;y++)for(let x=60;x<115;x++)f.rgba[(y*256+x)*4+3]=0;
 const a=deriveReconstructedFloorFinish(f)!;
 for(let i=0;i<f.rgba.length;i+=4)if(!f.rgba[i+3])f.rgba.set([0,255,0,0],i);
 const b=deriveReconstructedFloorFinish(f)!;assert.deepEqual(a,b);
});
check('world frame changes preserve texture while rotating its original spatial direction',()=>{
 const f=fixture((x,y)=>add(color,9*Math.sin(y*131+x))),a=deriveReconstructedFloorFinish(f)!;
 const angle=.71;f.origin=[3,0,-2];f.u=[Math.cos(angle),0,Math.sin(angle)];f.v=[-Math.sin(angle),0,Math.cos(angle)];
 const b=deriveReconstructedFloorFinish(f)!;assert.deepEqual(a.rgba,b.rgba);assert.deepEqual(b.origin,f.origin);
 assert.ok(Math.abs(b.u[0]-(a.u[0]*Math.cos(angle)-a.u[2]*Math.sin(angle)))<1e-8);
});
check('missing, malformed, oversized and insufficient evidence fails without texture synthesis',()=>{
 assert.equal(deriveReconstructedFloorFinish({status:'unknown',reason:'no-floor-evidence'}),null);
 for(const mutate of [(f:Floor)=>{f.width=1e8},(f:Floor)=>{f.metersPerTexel=0},(f:Floor)=>{f.fillColorSRGB=[NaN,2,3]},(f:Floor)=>{f.u=[2,0,0]},(f:Floor)=>{f.rgba.fill(0)}]){const f=fixture();mutate(f);assert.equal(deriveReconstructedFloorFinish(f),null);}
});
check('deterministic material generation leaves source RGB, masks, metric frame and metadata exact',()=>{
 const f=fixture((x,y)=>add(color,8*Math.sin(y*127+x))),before=fingerprint(f.rgba),metadata=JSON.stringify({...f,rgba:undefined});
 assert.deepEqual(deriveReconstructedFloorFinish(f),deriveReconstructedFloorFinish(f));assert.equal(fingerprint(f.rgba),before);assert.equal(JSON.stringify({...f,rgba:undefined}),metadata);
});
if(process.argv.length>2){
 for(const root of process.argv.slice(2)){
  const f=JSON.parse(readFileSync(`${root}/floor-patch.json`,'utf8')) as Floor;f.rgba=new Uint8Array(readFileSync(`${root}/floor-patch.rgba`));const before=fingerprint(f.rgba),start=performance.now(),result=deriveReconstructedFloorFinish(f);assert.ok(result);assert.equal(fingerprint(f.rgba),before);
  const report={...result,rgba:undefined,elapsedMs:performance.now()-start};writeFileSync(`${root}/clean-floor-finish.json`,JSON.stringify(report,null,2));writeFileSync(`${root}/clean-floor-finish.rgba`,result.rgba);console.log(JSON.stringify(report));checks++;
 }
}
console.log(`${checks} clean floor finish checks passed.`);
