import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mirrorModelPixels,resizeMirrorImageRGB} from '../src/lib/native/mirror-image';
const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
let checks=0;const check=(name:string,test:()=>void)=>{test();console.log(`PASS ${++checks}: ${name}`);};
const rgba=new Uint8Array(9*7*4);
for(let y=0;y<7;y++)for(let x=0;x<9;x++)rgba.set([(x*53+y*17)%256,(x*7+y*91)%256,(x+y)%2?255:0,255],(y*9+x)*4);
const image={width:9,height:7,rgba};
// Independent oracle: Pillow 12.2 RGB rotate(-degrees,expand=True), then
// resize((5,4),Image.Resampling.BILINEAR). Synthetic pixels only.
const reference={0:'5b02653750d75b8da97e3afb91114cc3eb1fc44f01722dbe05e19d38d141ab66',90:'7c590ea94754353b459623778e73569594c5d33fca5c816386c4b59e31b76fb4',180:'5bfaab91d8d4f852cbe8fd2b4c287f6ef65e57a0af01f546d0013b72f5d374b8',270:'67498e1567fffac7d39516cf9f6f5af2dda249cfe3b7d20bb7a963aed62a3486'};
check('antialiased RGB resize matches independent Pillow byte hashes at all quarter-turns',()=>{
 for(const rotation of [0,90,180,270] as const)assert.equal(sha(resizeMirrorImageRGB(image,rotation,5,4)),reference[rotation],String(rotation));
});
check('downsampling integrates the wider triangle footprint instead of aliasing narrow stripes',()=>{
 const rgba=new Uint8Array(12*4);for(let x=0;x<12;x++)rgba.set([x%2?255:0,x%2?255:0,x%2?255:0,255],x*4);
 assert.deepEqual(Array.from(resizeMirrorImageRGB({width:12,height:1,rgba},0,4,1)),[128,128,128,113,113,113,142,142,142,128,128,128]);
});
check('identity and rotations preserve exact RGB samples without editing source RGBA',()=>{
 const before=sha(rgba);const expected=[];for(let p=0;p<9*7;p++)expected.push(...rgba.slice(p*4,p*4+3));
 assert.deepEqual(Array.from(resizeMirrorImageRGB(image,0,9,7)),expected);
 const turned=resizeMirrorImageRGB(image,90,7,9);
 for(let y=0;y<9;y++)for(let x=0;x<7;x++)for(let c=0;c<3;c++)assert.equal(turned[(y*7+x)*3+c],rgba[((6-x)*9+y)*4+c]);
 assert.equal(sha(rgba),before);
});
check('normalization returns finite RGB NCHW with independent channel values',()=>{
 const input={width:1,height:1,rgba:new Uint8Array([255,128,0,255])},pixels=mirrorModelPixels(input,0,2,2);
 assert.equal(pixels.length,12);const expected=[(1-.485)/.229,(128/255-.456)/.224,(0-.406)/.225];
 for(let c=0;c<3;c++)for(let p=0;p<4;p++)assert.ok(Math.abs(pixels[c*4+p]-expected[c])<1e-6);
});
check('invalid dimensions, rotations and source lengths fail before allocation',()=>{
 for(const [w,h]of[[0,2],[2.5,2],[513,2],[2,NaN]])assert.throws(()=>resizeMirrorImageRGB(image,0,w,h));
 assert.throws(()=>resizeMirrorImageRGB({...image,width:385},0,5,4));
 assert.throws(()=>resizeMirrorImageRGB({...image,rgba:rgba.slice(1)},0,5,4));
 assert.throws(()=>resizeMirrorImageRGB(image,45 as 0,5,4));
});
console.log(`${checks} mirror image checks passed.`);
