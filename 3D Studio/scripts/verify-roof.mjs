/** Numeric check that roofGeometry produces solids with eaves at y=0, ridge at
 *  the right height, and outward-facing (up) normals. */

import { roofGeometry } from '../src/components/scene/geometry.ts';

let fail = 0;
for (const type of ['flat', 'shed', 'gable', 'hip']) {
  for (const ridge of ['x', 'z']) {
    for (const [w, d, pitch] of [[12, 9, 9], [9, 12, 6], [20, 20, 4]]) {
      const g = roofGeometry({ w, d, pitch, type, overhang: 0.5, ridge, thickness: 0.18 });
      g.computeBoundingBox();
      const bb = g.boundingBox;
      const pos = g.getAttribute('position');
      const nor = g.getAttribute('normal');
      let up = 0, total = 0, nan = 0;
      for (let i = 0; i < pos.count; i++) {
        if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) nan++;
        total++;
        if (nor.getY(i) > 0.2) up++;
      }
      const rise = type === 'flat' ? 0 : (pitch / 12) * ((ridge === 'x' ? d + 1 : w + 1) / 2);
      const upPct = Math.round((100 * up) / total);
      const eaveOk = bb.min.y > -0.35 && bb.min.y < 0.35;
      const ridgeOk = type === 'flat' ? true : Math.abs(bb.max.y - rise) < Math.max(0.6, rise * 0.25);
      // flat/shed are single boxes: exactly one of six faces points up (~17%).
      // gable/hip are folded slabs and must show far more up-facing area — that
      // is the check that catches an inside-out roof.
      const minUp = type === 'flat' || type === 'shed' ? 15 : 25;
      const ok = nan === 0 && eaveOk && ridgeOk && upPct >= minUp;
      if (!ok) fail++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${type.padEnd(6)} ridge=${ridge} ${w}x${d} pitch=${pitch} | y=[${bb.min.y.toFixed(2)}, ${bb.max.y.toFixed(2)}] expect ridge≈${rise.toFixed(2)} | up-facing ${upPct}% | nan ${nan}`);
    }
  }
}
console.log(fail ? `\n${fail} FAILURES` : '\nall roof cases pass');
process.exit(fail ? 1 : 0);
