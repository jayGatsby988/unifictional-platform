// Applies, in order, claude-fixes.txt (Sep 28 mobile/UI fixes) and
// claude-perf.txt + claude-perf2.txt (Sep 29 performance pass) to the Aug 10 source at build time.
// Every patched file is sha1-verified or the build fails.
import{readFileSync as r,writeFileSync as w,mkdirSync as m,existsSync as x}from"node:fs";import{dirname}from"node:path";import{createHash as h}from"node:crypto";
const NL=String.fromCharCode(10),H=b=>h("sha1").update(b).digest("hex"),die=s=>{console.error("claude-fixes: "+s);process.exit(1)};
// Hero footage frames (static, unchanged) are pulled from the live site instead of re-uploaded.
const D="public/frames/unifictional-v3",N=[...Array(241).keys()].map(i=>"frame-"+String(i).padStart(3,"0")+".webp"),F={};m(D,{recursive:true});
for(let i=0;i<N.length;i+=16)await Promise.all(N.slice(i,i+16).map(async n=>{for(let t=0;t<4;t++){try{const q=await fetch("https://unifictional.com/frames/unifictional-v3/"+n);if(!q.ok)throw 0;const b=Buffer.from(await q.arrayBuffer());w(D+"/"+n,b);F[n]=H(b);return}catch{}}die("frame fetch failed "+n)}));
if(H(N.map(n=>n+F[n]).join(""))!=="d9321723357fb3c06bcc3115c60a4aab17b6e86e")die("frames hash mismatch");
const lines=s=>s.split(NL).map((v,i,a)=>i<a.length-1?v+NL:v);
let total=0;
for(const [patch,count] of [["claude-fixes.txt",25],["claude-perf.txt",16],["claude-perf2.txt",1]]){
const P=[];let cur,ed;
for(const l of lines(r(patch,"utf8"))){if(l.startsWith("@@@FILE ")){const[,s,...f]=l.trim().split(" ");cur={f:f.join(" "),s,e:[]};P.push(cur);ed=null}else if(l.startsWith("@@@EDIT ")){const[,a,b]=l.trim().split(" ");ed=[+a,+b,""];cur.e.push(ed)}else if(ed)ed[2]+=l}
for(const o of P){const L=x(o.f)?lines(r(o.f,"utf8")):[""];for(const[a,b,t]of[...o.e].reverse())L.splice(a,b-a,t);const s=L.join("");if(H(s)!==o.s)die("hash mismatch "+o.f);m(dirname(o.f),{recursive:true});w(o.f,s)}
if(P.length!==count)die(patch+": expected "+count+" files, got "+P.length);total+=P.length}
console.log("claude-fixes: "+total+" file patches applied + verified, frames ok");
