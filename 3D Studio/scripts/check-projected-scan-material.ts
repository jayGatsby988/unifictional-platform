/** Run with tsx, then open the printed local URL in a separate browser session.
 * Synthetic colors only; no project assets, service credentials, or uploads. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import * as THREE from 'three';
import { capturedAppearanceMaterial, projectedScanMaterial, type CapturedFaceAtlas } from '../src/components/scene/projected-scan-material';

const face: CapturedFaceAtlas = { width: 2, height: 2, rgba: new Uint8Array([147, 67, 31, 255, 0, 0, 0, 0, 147, 67, 31, 255, 147, 67, 31, 255]), origin: [-1, -1, 0], u: [1, 0, 0], v: [0, 1, 0], spanMeters: [2, 2], fillColorLinear: new THREE.Color('#93431f').toArray() as [number, number, number], coverageFraction: .75 };
const original = face.rgba.slice(), projected = projectedScanMaterial([face], new THREE.Color('magenta'));
assert.deepEqual(face.rgba, original); assert.equal(projected.material.toneMapped, false);
assert.equal(projected.texture.colorSpace, THREE.NoColorSpace);
assert.equal(projected.texture.flipY, false); assert.equal(projected.texture.generateMipmaps, false);
assert.equal(capturedAppearanceMaterial(new THREE.Color('white')).toneMapped, false);
assert.equal(new THREE.MeshPhysicalMaterial().toneMapped, true);
projected.texture.dispose(); projected.material.dispose();
console.log('PASS synthetic atlas remains immutable; captured and catalog tone-mapping policies are separate');
const broad = new Uint8Array(32 * 32 * 4); for (let i = 0; i < broad.length; i += 4) broad.set([147, 67, 31, 255], i);
for (const evidenceFailure of ['no-face-evidence', 'invalid-input', 'resource-limit'] as const) {
  const result = projectedScanMaterial([
    { ...face, width: 32, height: 32, rgba: broad, coverageFraction: 1, orientation: 'front' },
    { ...face, rgba: new Uint8Array(16), orientation: 'top', evidenceFailure },
  ], new THREE.Color('magenta'), 'cabinets_base', { objectId: 'synthetic-cabinet', role: 'base-cabinet' });
  assert.equal(result.material.userData.completions.length, evidenceFailure === 'no-face-evidence' ? 1 : 0);
  result.texture.dispose(); result.material.dispose();
}
console.log('PASS cabinet continuity cannot convert invalid or resource-limited faces into finish evidence');

const browserChecks = `
import * as THREE from '/three.module.js';
import { capturedAppearanceMaterial, projectedScanMaterial } from '/material.js';
const results = [], errors = [];
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setSize(64, 64); renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
renderer.debug.onShaderError = (gl, program, vs, fs) => { errors.push([gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)].join(' ')); };
const camera = new THREE.OrthographicCamera(-1,1,1,-1,.1,10); camera.position.z = 3;
const scene = new THREE.Scene(), light = new THREE.DirectionalLight(0xffffff, 2);
light.position.set(0,0,3); scene.add(light);
const geometry = new THREE.PlaneGeometry(2,2);
function check(name, fn) { try { fn(); results.push({ name, passed: true }); } catch (error) { results.push({ name, passed: false, error: String(error) }); } }
function assert(test, message) { if (!test) throw new Error(message); }
function read(mesh, x = 32, y = 32) {
  scene.add(mesh); renderer.render(scene,camera);
  const rgba = new Uint8Array(4); renderer.getContext().readPixels(x,y,1,1,renderer.getContext().RGBA,renderer.getContext().UNSIGNED_BYTE,rgba);
  scene.remove(mesh); return [...rgba];
}
function equalRGB(actual, expected, label) { assert(expected.every((n,i) => Math.abs(actual[i]-n) <= 1), label + ': ' + actual + ' expected ' + expected); }
function captureFace(rgb, origin = [-1,-1,0]) {
  const rgba = new Uint8Array(8*8*4); for (let i=0;i<rgba.length;i+=4) rgba.set([...rgb,255],i);
  return { width:8,height:8,rgba,origin,u:[1,0,0],v:[0,1,0],spanMeters:[2,2],fillColorLinear:null,coverageFraction:1 };
}
check('projected original sRGB is invariant under lights and ACES exposure', () => {
  for (const rgb of [[147,67,31],[20,30,40],[236,226,208]]) {
    const {material,texture} = projectedScanMaterial([captureFace(rgb)],new THREE.Color('magenta'));
    const mesh = new THREE.Mesh(geometry,material);
    for (const intensity of [0,1000]) for (const exposure of [.05,8]) {
      light.intensity = intensity; renderer.toneMappingExposure = exposure; equalRGB(read(mesh),rgb,'projected RGB');
    }
    material.dispose(); texture.dispose();
  }
});
check('ordinary captured sRGB texture is decoded exactly once and stays unlit', () => {
  const rgb = [161,104,71], texture = new THREE.DataTexture(new Uint8Array([...rgb,255]),1,1,THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
  const material = capturedAppearanceMaterial(new THREE.Color('white'),texture), mesh = new THREE.Mesh(geometry,material);
  for (const intensity of [0,1000]) for (const exposure of [.05,8]) {
    light.intensity=intensity;renderer.toneMappingExposure=exposure;equalRGB(read(mesh),rgb,'floor RGB');
  }
  texture.dispose(); material.dispose();
});
check('instanced world coordinates and normals select the original camera face', () => {
  const {material,texture} = projectedScanMaterial([captureFace([93,141,180],[.2,-1,0])],new THREE.Color('magenta'));
  const mesh = new THREE.InstancedMesh(geometry,material,1);
  mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(1.2,0,0));mesh.instanceMatrix.needsUpdate=true;
  equalRGB(read(mesh,56,32),[93,141,180],'instanced face');
  const outside = read(mesh,56,32); assert(outside[3]===255,'opaque result');
  material.dispose();texture.dispose();mesh.dispose();
});
check('proposed transforms preserve camera face registration through translation, rotation and nonuniform scale', () => {
  const rgb=[93,141,180], face=captureFace(rgb);
  const {material,texture}=projectedScanMaterial([face],new THREE.Color('magenta'));
  const delta=new THREE.Matrix4().compose(new THREE.Vector3(.35,0,0),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.45),new THREE.Vector3(.75,1.1,1.4));
  const originalHook=material.onBeforeCompile;
  material.onBeforeCompile=(shader,renderer)=>{originalHook(shader,renderer);shader.uniforms.scanDesignInverse={value:delta.clone().invert()};shader.uniforms.scanDesignDelta={value:delta};};
  material.customProgramCacheKey=()=> 'scan-world-face-proposed-test';
  const mesh=new THREE.Mesh(geometry,material);mesh.matrix.copy(delta);mesh.matrixAutoUpdate=false;
  equalRGB(read(mesh,43,32),rgb,'moved/scaled face');
  equalRGB(read(mesh,32,32),rgb,'rotated surface interior');
  material.dispose();texture.dispose();
});
check('catalog finishes still respond to lighting and renderer exposure', () => {
  const material = new THREE.MeshPhysicalMaterial({color:0x888888,roughness:.8}),mesh = new THREE.Mesh(geometry,material);
  light.intensity=0;renderer.toneMappingExposure=1;const dark=read(mesh);
  light.intensity=2;renderer.toneMappingExposure=.4;const lower=read(mesh);
  renderer.toneMappingExposure=1.5;const higher=read(mesh);
  assert(material.toneMapped && higher[0]>lower[0]+20 && lower[0]>dark[0]+20,'catalog shading/tone mapping disabled: '+[dark,lower,higher]);
  material.dispose();
});
check('same shader program can switch different face atlases without stale uniforms', () => {
  const a=projectedScanMaterial([captureFace([180,20,30])],new THREE.Color('magenta'));
  const b=projectedScanMaterial([captureFace([20,180,30])],new THREE.Color('magenta'));
  const meshA=new THREE.Mesh(geometry,a.material),meshB=new THREE.Mesh(geometry,b.material);
  equalRGB(read(meshA),[180,20,30],'first');equalRGB(read(meshB),[20,180,30],'second');equalRGB(read(meshA),[180,20,30],'first reused');
  a.material.dispose();a.texture.dispose();b.material.dispose();b.texture.dispose();
});
check('clean finishes shade geometry without double exposure or altering raw pixels', () => {
  const face=captureFace([147,67,31]), before=face.rgba.slice();
  const clean=projectedScanMaterial([face],new THREE.Color('magenta'),'cabinets_base');
  const mesh=new THREE.Mesh(geometry,clean.material);
  light.intensity=0;renderer.toneMappingExposure=.05;const a=read(mesh);
  light.intensity=1000;renderer.toneMappingExposure=8;const b=read(mesh);
  equalRGB(a,b,'stable clean color');
  assert(a[0]>=125 && a[0]<=147 && a[1]>=55 && a[1]<=67 && a[2]>=24 && a[2]<=31,'bounded neutral clean shading '+a);
  assert(face.rgba.every((n,i)=>n===before[i]),'clean material mutated its camera evidence');
  assert(clean.material.userData.finishProvenance==='same-face-camera-finish-estimate','missing clean provenance');
  const bevel=new THREE.PlaneGeometry(.2,.2);bevel.rotateY(Math.PI/3);
  const bevelPixel=read(new THREE.Mesh(bevel,clean.material));
  assert(bevelPixel[0]>100 && bevelPixel[2]<40,'representative bevel did not retain its nearest face finish '+bevelPixel);bevel.dispose();
  clean.material.dispose();clean.texture.dispose();
  const floor=capturedAppearanceMaterial(new THREE.Color('#a16847'),null,true);
  const pixel=read(new THREE.Mesh(geometry,floor));assert(pixel[0]>130 && pixel[0]<162,'clean floor shading failed');floor.dispose();
});
check('repeated mount/dispose releases atlas textures and shaders', () => {
  const initial=renderer.info.memory.textures;
  for(let i=0;i<12;i++) {
    const {material,texture}=projectedScanMaterial([captureFace([80+i,100,150])],new THREE.Color('magenta'));
    read(new THREE.Mesh(geometry,material));material.dispose();texture.dispose();
  }
  renderer.render(scene,camera);assert(renderer.info.memory.textures===initial,'texture leak: '+renderer.info.memory.textures+' vs '+initial);
  assert(renderer.info.programs.length===0,'disposed shader retained: '+renderer.info.programs.length);
});
check('no GPU compile or WebGL errors',()=>{assert(!errors.length,errors.join(';'));assert(renderer.getContext().getError()===0,'WebGL error');});
geometry.dispose();renderer.dispose();
window.__scanMaterialAudit={results,errors};document.body.appendChild(Object.assign(document.createElement('pre'),{textContent:JSON.stringify(window.__scanMaterialAudit,null,2)}));
fetch('/result',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(window.__scanMaterialAudit)});
`;
function browserModule(path: string) {
  return ts.transpileModule(readFileSync(resolve(path), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
    .replace("from 'three'", "from '/three.module.js'")
    .replace(/from '@\/lib\/native\/([^']+)'/g, "from '/$1.js'");
}
const materialSource = browserModule('src/components/scene/projected-scan-material.ts');
const assets = new Map([
  ['/', '<!doctype html><title>Isolated captured-material GPU check</title><script type="module" src="/test.js"></script>'],
  ['/test.js', browserChecks], ['/material.js', materialSource],
  ['/reconstructed-appearance-fill.js', browserModule('src/lib/native/reconstructed-appearance-fill.ts')],
  ['/clean-face-finish.js', browserModule('src/lib/native/clean-face-finish.ts')],
  ['/complete-cabinet-finishes.js', browserModule('src/lib/native/complete-cabinet-finishes.ts')],
  ['/three.module.js', readFileSync(resolve('node_modules/three/build/three.module.js'), 'utf8')],
  ['/three.core.js', readFileSync(resolve('node_modules/three/build/three.core.js'), 'utf8')],
]);
const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/result') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 100_000) req.destroy(); });
    req.on('end', () => {
      const report = JSON.parse(body) as { results: { name: string; passed: boolean; error?: string }[] };
      for (const result of report.results) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.error ? ': ' + result.error : ''}`);
      process.exitCode = report.results.length === 9 && report.results.every(r => r.passed) ? 0 : 1;
      res.end('ok'); server.close(); clearTimeout(timeout);
    });
    return;
  }
  const content = assets.get(req.url ?? '/');
  if (!content) { res.statusCode = 404; res.end(); return; }
  res.setHeader('content-type', req.url === '/' ? 'text/html' : 'text/javascript'); res.end(content);
});
const timeout = setTimeout(() => { console.error('GPU browser check timed out'); process.exitCode = 1; server.close(); }, 120_000);
server.listen(0, '127.0.0.1', () => { const address = server.address(); if (address && typeof address === 'object') console.log(`GPU_CHECK_URL=http://127.0.0.1:${address.port}`); });
