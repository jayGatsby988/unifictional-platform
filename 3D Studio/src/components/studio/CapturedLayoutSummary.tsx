'use client';
import { useMemo } from 'react';
import { Ruler, ScanLine } from 'lucide-react';
import type { ScannedRoomGeometry } from '@/lib/spec/types';
import { scannedObjectLayout } from '@/components/scene/scanned-object-layout';
import { useProjectStore } from '@/lib/store/project-store';
import { fmtFt } from '@/lib/units';

/** Original captured inventory, kept separate from proposed design changes. */
export function CapturedLayoutSummary({ scan, roomType }: { scan: ScannedRoomGeometry; roomType: 'kitchen' | 'bathroom' }) {
  const layout = useMemo(() => scannedObjectLayout(scan, roomType), [scan, roomType]);
  const setUI = useProjectStore(s => s.setUI);
  const walls = scan.surfaces.filter(s => s.kind === 'wall');
  return <section className="mt-4 space-y-4" aria-label="Captured layout">
    <div className="rounded-xl border border-border bg-surface/40 p-3">
      <div className="flex items-center gap-2 text-sm font-medium"><ScanLine size={16} />Original layout</div>
      <p className="mt-2 text-xs leading-relaxed text-muted">This inventory describes the original capture. Proposed object changes and reviewed takeoffs are saved separately in the design controls above.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setUI({ panel: 'materials', selectedSlot: null })} className="btn btn-sm !min-h-11">Choose finishes</button>
        <button type="button" onClick={() => setUI({ panel: 'estimate' })} className="btn btn-sm !min-h-11">Review estimate</button>
      </div>
    </div>
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><Ruler size={15} />Captured walls <span className="text-xs text-muted">{walls.length}</span></h3>
      <ul className="divide-y divide-border rounded-xl border border-border px-3">{walls.map((wall, i) => <li key={wall.id} className="flex min-h-11 items-center justify-between gap-3 py-2 text-xs">
        <span>Wall {i + 1}{wall.confidence === 'low' && <span className="ml-2 text-warn">Review scan</span>}</span>
        <span className="num text-muted">{fmtFt(wall.dimensions.x / 0.3048)} long</span>
      </li>)}</ul>
    </div>
    <div>
      <h3 className="text-sm font-medium">Detected objects <span className="text-xs text-muted">{layout.objects.length}</span></h3>
      <p className="mb-2 mt-1 text-xs leading-relaxed text-muted">These dimensions describe detection bounds, including empty space around curved objects. They are not fabrication dimensions or verified aisle clearances.</p>
      <ul className="divide-y divide-border rounded-xl border border-border px-3">{layout.objects.map((object, i) => <li key={object.id} className="py-3 text-xs">
        <div className="flex items-center justify-between gap-2"><span className="capitalize">{object.role === 'other' ? object.kind : object.role.replace(/-/g, ' ')} {i + 1}</span><span className={object.confidence === 'low' ? 'text-warn' : 'text-muted'}>{object.confidence === 'low' ? 'Review scan' : 'Detected bounds'}</span></div>
        <p className="num mt-1 text-muted">{fmtFt(object.dimensions.x / 0.3048)} × {fmtFt(object.dimensions.z / 0.3048)} · {fmtFt(object.dimensions.y / 0.3048)} high</p>
      </li>)}</ul>
    </div>
  </section>;
}
