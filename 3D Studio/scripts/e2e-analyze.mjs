#!/usr/bin/env node
/**
 * End-to-end analyzer probe against a RUNNING server.
 *
 *   node scripts/e2e-analyze.mjs [photo-url] [roomType] [out.json] [--base http://localhost:3000]
 *
 * Posts the photo to /api/analyze, follows the NDJSON stream, writes the spec
 * to `out.json` and prints the parts of it a person actually wants to eyeball:
 * dimensions, runs, island, openings, décor, finish observations and which
 * slots ended up on a custom (photo-matched) material.
 *
 * It also writes `<out>.localstorage.json` — the exact zustand-persist payload
 * for the `manhattan-project-v1` key — so the twin can be loaded into the
 * studio without going through the intake:
 *   localStorage.setItem('manhattan-project-v1', <contents>); location.reload()
 */
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--base');
const photo = positional[0] ?? '/demo/kitchen-before.jpg';
const roomType = positional[1] ?? 'kitchen';
const out = positional[2] ?? `spec-${roomType}.json`;
const base = flag('--base', 'http://localhost:3000');

const started = Date.now();
const res = await fetch(`${base}/api/analyze`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
  body: JSON.stringify({ roomType, photos: [{ url: photo, primary: true }], description: '' }),
});
if (!res.ok || !res.body) {
  console.error(`analyze failed: HTTP ${res.status}`, await res.text().catch(() => ''));
  process.exit(1);
}
const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = '';
let spec = null;
let meta = null;
const handle = (line) => {
  if (!line.trim()) return;
  let ev;
  try { ev = JSON.parse(line); } catch { return; }
  if (ev.heartbeat) return;
  process.stderr.write(`  [${((Date.now() - started) / 1000).toFixed(1)}s] ${ev.phase}: ${ev.message ?? ''}\n`);
  if (ev.phase === 'done') { spec = ev.spec; meta = ev.meta; }
  if (ev.phase === 'error') { console.error('error:', ev.message); process.exit(1); }
};
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
}
if (buf.trim()) handle(buf);
if (!spec) { console.error('no spec in stream'); process.exit(1); }

writeFileSync(out, JSON.stringify(spec, null, 2));
const now = new Date().toISOString();
const project = {
  id: 'e2e' + Math.random().toString(36).slice(2, 9),
  name: `E2E ${roomType}`,
  roomType,
  createdAt: now,
  updatedAt: now,
  photos: [{ url: photo, primary: true }],
  description: '',
  spec,
  selections: { ...spec.materials },
  overrides: {},
  // the room as found: a freshly analysed twin opens at "nothing changed yet"
  baseline: { spec, selections: { ...spec.materials }, capturedAt: now, source: 'analysis' },
  estimateSettings: { region: 'seattle', tier: 'standard', contingencyPct: 0.1, markupPct: 0.2, scope: 'pull-and-replace', includePermits: true, mode: 'changes', includeKnockOns: true },
  renders: [],
  scans: [],
};
writeFileSync(`${out}.localstorage.json`, JSON.stringify({ state: { project }, version: 5 }));

const ft1 = (n) => (typeof n === 'number' ? Math.round(n * 10) / 10 : n);
console.log(`\n${roomType} spec in ${((Date.now() - started) / 1000).toFixed(1)}s (model ${meta?.model}, repaired=${meta?.repaired}, fallback=${meta?.usedFallback}, fixes=${meta?.fixes?.length ?? 0})`);
console.log(`summary: ${spec.detected?.summary}`);
console.log(`confidence ${spec.detected?.confidence}  camera ${JSON.stringify(spec.detected?.camera)}`);
if (spec.dims) console.log(`dims ${ft1(spec.dims.widthFt)} × ${ft1(spec.dims.depthFt)} ft, ceiling ${ft1(spec.dims.ceilingFt)}; style ${spec.style}; layout ${spec.layout}`);
if (spec.runs) for (const r of spec.runs) console.log(`run ${r.id}: ${r.wall} wall, ${ft1(r.lengthFt)} ft from ${r.start}, base [${r.base.map((b) => `${b.widthIn}${b.type[0]}`).join(' ')}], uppers ${r.hasUppers ? (r.uppers?.length ?? 0) : 'none'}, splash=${r.backsplash}`);
if (spec.island) console.log(`island: ${spec.island.present ? `${ft1(spec.island.lengthFt)}×${ft1(spec.island.widthFt)} ft at (${spec.island.offset?.x}, ${spec.island.offset?.z}), ${spec.island.seating} stools, rot ${spec.island.rotationDeg}` : 'none'}`);
if (spec.backsplash) console.log(`backsplash: ${JSON.stringify(spec.backsplash)}`);
if (spec.appliances) console.log(`appliances: ${spec.appliances.map((a) => `${a.kind}@${a.wall}:${a.t}(${a.widthIn}")${a.kind === 'hood' ? ` ${a.hoodStyle}/${a.hoodShape} above:${a.cabinetAbove}` : ''}`).join(', ')}`);
if (spec.openings) console.log(`openings: ${spec.openings.map((o) => `${o.kind}@${o.wall}:${o.t} ${ft1(o.widthFt)}×${ft1(o.heightFt)} sill ${ft1(o.sillFt)}`).join(', ')}`);
if (spec.decor) {
  const d = spec.decor;
  console.log(`decor: ${d.shelves?.length ?? 0} shelves ${JSON.stringify(d.shelves)}\n       ${d.plants?.length ?? 0} plants ${JSON.stringify(d.plants)}\n       ${d.art?.length ?? 0} art, rug ${JSON.stringify(d.rug)}, window ${d.windowTreatment}, counters ${d.counterStyling}\n       ${d.items?.length ?? 0} items ${JSON.stringify(d.items)}\n       ${d.cabinetContents?.length ?? 0} cabinet contents ${JSON.stringify(d.cabinetContents)}`);
}
console.log('materials:');
for (const [slot, id] of Object.entries(spec.materials ?? {})) {
  const f = (spec.detected?.finishes ?? []).find((x) => x.slot === slot);
  console.log(`  ${slot.padEnd(18)} ${String(id).padEnd(34)} ${f ? `${f.family} ${f.baseColorHex} ${f.pattern} ${f.sheen}${f.moduleIn ? ` ${f.moduleIn.w}×${f.moduleIn.h}"` : ''} — ${f.description}` : '(no observation)'}`);
}
console.log(`notes: ${JSON.stringify(spec.detected?.notes)}`);
console.log(`assumptions: ${JSON.stringify(spec.detected?.assumptions)}`);
// Photo inventory — the pixel boxes the fitter aligns the twin against.
const elements = spec.detected?.elements ?? [];
const box = (b) => `x ${b.x0.toFixed(2)}–${b.x1.toFixed(2)} y ${b.y0.toFixed(2)}–${b.y1.toFixed(2)}`;
const inv = meta?.inventory;
console.log(`\nelements (${elements.length} boxes on the primary photo${inv ? `; inventory ${inv.ok ? 'ok' : 'FAILED'} in ${((inv.elapsedMs ?? 0) / 1000).toFixed(1)}s, ${inv.samples ?? '?'} pass${inv.samples === 1 ? '' : 'es'}${inv.agreement != null ? `, agreement ${(inv.agreement * 100).toFixed(0)}%` : ''}, aspect ${inv.aspect ?? '?'}, ${inv.inPrompt ? 'fed to the main prompt' : 'NOT in the main prompt'}` : ''}):`);
const frame = inv?.frame ?? spec.detected?.frame ?? null;
console.log(`  frame: ${frame ? `back wall spans x ${frame.backWallSpansX[0].toFixed(2)}–${frame.backWallSpansX[1].toFixed(2)}; left wall ${frame.leftWallVisible ? 'visible' : 'hidden'}, right wall ${frame.rightWallVisible ? 'visible' : 'hidden'}` : 'none'}`);
if (inv?.violations?.length) console.log(`  consistency: ${inv.violations.join('; ')}`);
const wallNotes = (spec.detected?.notes ?? []).filter((n) => /^inventory: .*(wall|turned)/.test(n));
if (wallNotes.length) console.log(`  walls: ${wallNotes.join(' | ')}`);
for (const e of elements) console.log(`  ${e.kind.padEnd(18)} ${String(e.wall ?? '-').padEnd(7)} ${box(e.box)}  ${e.confidence.toFixed(2)}  ${e.label}`);
const counts = {};
for (const e of elements) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
if (elements.length) console.log(`  counts: ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')}`);
console.log(`camera.solved: ${spec.detected?.camera?.solved ? JSON.stringify(spec.detected.camera.solved) : 'null (not fitted yet)'}`);

// --- the fitter: project the twin onto the photo's boxes and solve ----------
if (elements.length && !args.includes('--no-fit')) {
  const t0 = Date.now();
  const aspect = meta?.inventory?.aspect;
  const fr = await fetch(`${base}/api/fit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spec, aspect }) });
  const body = await fr.json().catch(() => null);
  if (!fr.ok || !body) {
    console.log(`fit: HTTP ${fr.status} ${JSON.stringify(body).slice(0, 300)}`);
  } else {
    const f = body;
    const fs = f.spec ?? spec;
    const inv = fs.detected?.inventory;
    console.log(`\nfit in ${((Date.now() - t0) / 1000).toFixed(1)}s: score ${f.score == null ? 'null' : (f.score * 100).toFixed(1) + '%'}, proportions ${f.proportions == null ? 'null' : (f.proportions * 100).toFixed(1) + '%'}, ${f.iterations ?? '?'} iterations, ${f.ms ?? '?'} ms server`);
    console.log(`  detector: ${inv ? `${inv.samples} passes, agreement ${inv.agreement == null ? 'null' : (inv.agreement * 100).toFixed(1) + '%'}` : 'not inventoried'}`);
    console.log(`  camera: ${JSON.stringify(f.camera)}`);
    if (fs.dims) console.log(`  dims ${ft1(spec.dims.widthFt)}×${ft1(spec.dims.depthFt)} → ${ft1(fs.dims.widthFt)}×${ft1(fs.dims.depthFt)} ft, ceiling ${ft1(spec.dims.ceilingFt)} → ${ft1(fs.dims.ceilingFt)}`);
    if (fs.island) console.log(`  island ${ft1(spec.island.lengthFt)}×${ft1(spec.island.widthFt)} @(${spec.island.offset.x},${spec.island.offset.z}) → ${ft1(fs.island.lengthFt)}×${ft1(fs.island.widthFt)} @(${fs.island.offset.x},${fs.island.offset.z})`);
    if (fs.runs) fs.runs.forEach((r, i) => console.log(`  run ${r.id}: ${ft1(spec.runs[i]?.lengthFt)} ft from ${spec.runs[i]?.start} → ${ft1(r.lengthFt)} ft from ${r.start}`));
    if (fs.appliances) fs.appliances.forEach((a, i) => console.log(`  ${a.kind}: t ${spec.appliances[i]?.t?.toFixed(3)} w ${spec.appliances[i]?.widthIn} → t ${a.t?.toFixed(3)} w ${a.widthIn}`));
    for (const m of (f.matched ?? []).slice(0, 40)) console.log(`  ${String(m.kind).padEnd(18)} ${String(m.wall ?? '-').padEnd(7)} IoU ${(m.iou ?? 0).toFixed(2)}`);
    if (f.unmatchedPhoto?.length) console.log(`  unmatched photo: ${f.unmatchedPhoto.map((u) => `${u.kind}${u.reason ? ` (${u.reason})` : ''}`).join(', ')}`);
    if (f.unmatchedTwin?.length) console.log(`  unmatched twin: ${f.unmatchedTwin.map((u) => u.kind ?? u).join(', ')}`);
    // persist the FITTED spec for the studio
    project.spec = fs; project.selections = { ...fs.materials };
    writeFileSync(`${out}.fitted.json`, JSON.stringify(fs, null, 2));
    writeFileSync(`${out}.localstorage.json`, JSON.stringify({ state: { project }, version: 5 }));
    console.log(`  wrote ${out}.fitted.json (localstorage payload now carries the fitted spec)`);
  }
}
console.log(`\nwrote ${out} and ${out}.localstorage.json`);
