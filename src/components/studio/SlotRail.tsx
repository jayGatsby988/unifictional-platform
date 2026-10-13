'use client';
/**
 * Slot list: compact rail (desktop left column) or cards (Materials tab when
 * nothing is selected). Clicking selects the slot; hovering outlines it in 3D.
 */
import { useMemo } from 'react';
import { ChevronRight, ScanLine } from 'lucide-react';
import { useProjectStore } from '@/lib/store/project-store';
import { getMaterial } from '@/lib/materials/catalog';
import { useNativeMesh } from '@/lib/native/mesh-store';
import { useScanView } from '@/components/scene/scan-view-store';
import type { MaterialSlotId } from '@/lib/spec/types';
import { activeSlotsFor, groupSlots, scanFinishPresentation, slotLabel } from './projectUtils';
import { Swatch, TierBadge } from './controls';
import { cx } from './hooks';

export function SlotList({ variant = 'rail', onPick, readOnly = false }: {
  variant?: 'rail' | 'cards';
  onPick?: (slot: MaterialSlotId) => void;
  readOnly?: boolean;
}) {
  const spec = useProjectStore((s) => s.project.spec);
  const roomType = useProjectStore((s) => s.project.roomType);
  const selections = useProjectStore((s) => s.project.selections);
  const baseline = useProjectStore((s) => s.project.baseline);
  const overrides = useProjectStore((s) => s.project.overrides);
  const projectId = useProjectStore(s => s.project.id);
  const hasMesh = useNativeMesh(s => s.projectId === projectId && !!s.mesh);
  const scanMode = useScanView((s) => s.mode);
  const selectedSlot = useProjectStore((s) => s.ui.selectedSlot);
  const hoveredSlot = useProjectStore((s) => s.ui.hoveredSlot);
  const selectSlot = useProjectStore((s) => s.selectSlot);
  const setUI = useProjectStore((s) => s.setUI);
  const groups = useMemo(() => groupSlots(activeSlotsFor(spec, roomType, hasMesh)), [spec, roomType, hasMesh]);
  const finishProject = { spec, selections, baseline, overrides };
  const sourceView = scanMode === 'source' && Boolean(spec && 'scanGeometry' in spec && spec.scanGeometry);

  const pick = (slot: MaterialSlotId) => {
    if (sourceView) return;
    selectSlot(slot);
    onPick?.(slot);
  };

  if (variant === 'rail') {
    return (
      <nav aria-label="Surfaces" className="flex h-full flex-col overflow-y-auto px-2 py-3">
        {groups.map((g) => (
          <div key={g.group} className="mb-3">
            <div className="eyebrow px-2 pb-1.5 !text-[10px]">{g.group}</div>
            {g.slots.map((slot) => {
              const finish = scanFinishPresentation(finishProject, slot, scanMode);
              const mat = finish.kind === 'catalog' ? getMaterial(finish.materialId) : undefined;
              const name = finish.name;
              const active = selectedSlot === slot;
              const hovered = hoveredSlot === slot;
              return (
                <button
                  key={slot}
                  type="button"
                  disabled={sourceView}
                  onClick={() => pick(slot)}
                  onMouseEnter={() => { if (!sourceView) setUI({ hoveredSlot: slot }); }}
                  onMouseLeave={() => setUI({ hoveredSlot: null })}
                  className={cx(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                    active ? 'bg-brass-soft text-ink shadow-[inset_0_0_0_1px_rgba(217,179,107,.45)]' : hovered ? 'bg-white/5 text-ink' : 'text-muted hover:bg-white/5 hover:text-ink',
                  )}
                >
                  {finish.kind !== 'catalog' ? <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/15 text-muted"><ScanLine size={16} /></span> : <Swatch material={mat} size={16} rounded="rounded-[4px]" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] leading-tight">{slotLabel(slot)}</span>
                    <span className="block truncate text-[10.5px] leading-tight text-dim">{name}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.group}>
          <div className="eyebrow mb-2">{g.group}</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {g.slots.map((slot) => {
              const finish = scanFinishPresentation(finishProject, slot, scanMode);
              const mat = finish.kind === 'catalog' ? getMaterial(finish.materialId) : undefined;
              const name = finish.name;
              const active = selectedSlot === slot;
              return (
                <button
                  key={slot}
                  type="button"
                  disabled={sourceView}
                  onClick={() => pick(slot)}
                  onMouseEnter={() => { if (!sourceView) setUI({ hoveredSlot: slot }); }}
                  onMouseLeave={() => setUI({ hoveredSlot: null })}
                  className={cx(
                    'flex items-center gap-3 rounded-[var(--radius-sm)] border p-2.5 text-left transition-colors',
                    active ? 'border-brass bg-brass-soft' : 'border-border bg-surface/50 hover:border-border-strong',
                  )}
                >
                  {finish.kind !== 'catalog' ? <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/15 text-muted"><ScanLine size={16} /></span> : <Swatch material={mat} size={40} rounded="rounded-lg" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-ink">{slotLabel(slot)}</span>
                    <span className="block truncate text-[11.5px] text-muted">{name}</span>
                    {mat && <span className="mt-1 block"><TierBadge tier={mat.tier} /></span>}
                  </span>
                  {!readOnly && !sourceView && <ChevronRight size={14} className="shrink-0 text-dim" />}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
