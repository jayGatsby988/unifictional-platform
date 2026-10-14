'use client';
/**
 * Intake screen — room type, photos, description, (exterior) empty-lot
 * template, and the "Build my 3D twin" CTA.
 */
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, Bath, Check, CookingPot, LayoutGrid, Sparkles, TreePine } from 'lucide-react';
import { useProjectStore } from '@/lib/store/project-store';
import { HOUSE_TEMPLATES } from '@/lib/spec/defaults';
import type { ExteriorSpec, RoomType } from '@/lib/spec/types';
import { PhotoUploader, revokeUploadItems, type UploadItem } from './PhotoUploader';
import type { IntakeSubmission } from './useAnalysis';
import { Toggle } from './controls';
import { useToast } from './Toast';
import { cx } from './hooks';
import { HERO_VIDEO } from '@/components/landing/content';
import { useReducedMotion } from '@/components/landing/motion';

const ROOM_CARDS: Array<{ id: RoomType; title: string; blurb: string; icon: ComponentType<{ size?: number; className?: string }> }> = [
  { id: 'kitchen', title: 'Kitchen', blurb: 'Cabinets, counters, island, backsplash, lighting', icon: CookingPot },
  { id: 'bathroom', title: 'Bathroom', blurb: 'Vanity, shower, tub, tile, plumbing finishes', icon: Bath },
  { id: 'exterior', title: 'Lot & Exterior', blurb: 'Siding, roof, windows, porch, driveway, landscape', icon: TreePine },
  { id: 'floorplan', title: 'Floor Plan', blurb: 'Whole house: rooms, walls, doors, windows, stairs', icon: LayoutGrid },
];

const PLACEHOLDER: Record<RoomType, string> = {
  kitchen: 'e.g. 12×14 kitchen, want an island with seating and navy lowers, keep the window over the sink, quartz counters…',
  bathroom: 'e.g. 5×9 hall bath, swap the tub for a walk-in shower, floating oak vanity, large-format tile…',
  exterior: 'e.g. 1960s rambler on a 60×120 lot, add a covered porch, board-and-batten siding, black windows, new driveway…',
  floorplan: 'e.g. two-storey, 2,100 sq ft, four bedrooms up, open kitchen/dining, stair in the entry hall…',
};

const UPLOAD_HINT: Record<RoomType, string> = {
  kitchen: 'Stand in the doorway and shoot wide. Include the sink wall and the range wall if you can.',
  bathroom: 'Shoot from the door toward the vanity, then toward the shower or tub.',
  exterior: 'A straight-on street view plus one corner angle — or a photo of the bare lot.',
  floorplan: 'One clear, straight-on shot of each floor plan sheet — the whole sheet, dimension strings included.',
};

/**
 * A photograph answers its own questions; a plan or a bare lot answers almost
 * none of them. Saying so on the way IN is what turns "why did it guess my
 * cabinets grey" into "of course — it asked me".
 */
const PLAN_HINT: Record<RoomType, string> = {
  kitchen: 'No photos? A picture of the floor plan works too — we read the walls and the sizes off it, then ask you about the colours and materials.',
  bathroom: 'No photos? A picture of the floor plan works too — we read the walls and the sizes off it, then ask you about the tile, the vanity and the fittings.',
  exterior: 'A bare lot, a plat or a page from the plan set all work — we read the site off it, then ask you about the house.',
  floorplan: 'We trace the walls, rooms and stairs off the sheet and build a house you can walk through. The rooms come back EMPTY — a plan shows no finishes — and we ask you about those.',
};

export function Intake({ onSubmit, onDemo, busy }: { onSubmit: (sub: IntakeSubmission) => void; onDemo: (roomType: RoomType) => void; busy: boolean }) {
  const roomType = useProjectStore((s) => s.project.roomType);
  const description = useProjectStore((s) => s.project.description);
  const setRoomType = useProjectStore((s) => s.setRoomType);
  const setDescription = useProjectStore((s) => s.setDescription);
  const { toast } = useToast();
  const reduced = useReducedMotion();

  const [items, setItems] = useState<UploadItem[]>([]);
  const [emptyLot, setEmptyLot] = useState(false);
  const [template, setTemplate] = useState<ExteriorSpec['houseStyle']>('modern-farmhouse');
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => () => revokeUploadItems(itemsRef.current), []);

  const canSubmit = !busy && (items.length > 0 || (roomType === 'exterior' && emptyLot));
  const primaryIndex = useMemo(() => Math.max(0, items.findIndex((i) => i.primary)), [items]);

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      files: items.map((i) => i.file),
      primaryIndex,
      description,
      previewUrl: items[primaryIndex]?.url ?? items[0]?.url ?? null,
      emptyLot: roomType === 'exterior' ? emptyLot : false,
      houseTemplate: roomType === 'exterior' && emptyLot ? template : null,
    });
  };

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-bg">
      {/* The product's own film behind the first screen (the same clip as the
          landing page's hero: a phone scanning a kitchen, the twin rendering
          over it), fixed under the page and darkened so the form stays the
          subject. Reduced motion gets the still. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#0a0a0a]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={HERO_VIDEO.poster} alt="" className="absolute inset-0 h-full w-full object-cover" />
        {!reduced && (
          <video className="absolute inset-0 h-full w-full object-cover" src={HERO_VIDEO.mp4} poster={HERO_VIDEO.poster} autoPlay muted loop playsInline preload="metadata" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/70 to-black/90" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-transparent to-black/35" />
      </div>
      <header className="relative z-10 flex h-16 items-center justify-between border-b border-white/10 bg-black/20 px-5 backdrop-blur-md sm:px-8">
        <div className="flex items-center gap-4">
          <Link href="/" className="font-display text-xl font-medium tracking-tight text-ink" aria-label="Unifictional 3D Studio home">Unifictional 3D Studio<span className="text-muted">.</span></Link>
          <span className="hidden h-4 w-px bg-border md:inline" />
          <a href="https://unifictional.com" className="eyebrow hidden transition-colors hover:text-ink md:inline" title="Back to unifictional.com">← Unifictional</a>
        </div>
        {/* The demo links need the width of a tablet; phones have the "Try a demo" button in the bar below. */}
        <nav className="hidden items-center gap-1 text-[12.5px] text-muted md:flex">
          <span className="mr-1">Try a demo:</span>
          {ROOM_CARDS.map((r) => (
            <button key={r.id} type="button" onClick={() => onDemo(r.id)} className="rounded-full px-2.5 py-1 hover:bg-white/5 hover:text-ink">{r.title}</button>
          ))}
        </nav>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-5xl px-5 pb-32 pt-6 sm:px-8 sm:pt-10">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}>
          <div className="eyebrow mb-3">Step 1 · What are we remodeling?</div>
          <h1 className="font-display text-[40px] leading-[1.02] text-ink [text-shadow:0_2px_24px_rgba(0,0,0,0.6)] sm:text-[56px]">
            Photos in. An explorable, priced 3D twin out.
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink/80 [text-shadow:0_1px_12px_rgba(0,0,0,0.6)]">
            Upload a few photos of the space. In about a minute you get a 3D model you can walk through, re-finish surface by surface, and price line by line — then render it photoreal.
          </p>
        </motion.div>

        <section className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {ROOM_CARDS.map((r, i) => {
            const active = roomType === r.id;
            const Icon = r.icon;
            return (
              <motion.button
                key={r.id}
                type="button"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 + i * 0.05, duration: 0.4 }}
                onClick={() => { if (!active) setRoomType(r.id); }}
                aria-pressed={active}
                className={cx(
                  'group relative overflow-hidden rounded-[var(--radius)] border bg-surface/75 p-5 text-left backdrop-blur-md transition-[border-color,box-shadow,background-color]',
                  active ? 'border-brass bg-surface-2/85 shadow-[0_0_0_3px_var(--brass-soft)]' : 'border-border hover:border-border-strong hover:bg-surface-2/85',
                )}
              >
                <div className="flex items-start justify-between">
                  <span className={cx('grid h-10 w-10 place-items-center rounded-full border', active ? 'border-brass bg-brass text-[#0a0a0a]' : 'border-white/10 bg-black/30 text-ink')}>
                    <Icon size={18} />
                  </span>
                  {active && <span className="grid h-6 w-6 place-items-center rounded-full bg-brass text-[#0a0a0a]"><Check size={13} /></span>}
                </div>
                <div className="mt-8 font-display text-[24px] text-ink">{r.title}</div>
                <div className="mt-1 text-[12.5px] text-muted">{r.blurb}</div>
              </motion.button>
            );
          })}
        </section>

        <section className="panel mt-10 p-5 sm:p-6">
          <div className="eyebrow mb-3">Step 2 · Photos</div>
          <PhotoUploader
            items={items}
            onChange={setItems}
            disabled={busy}
            hint={UPLOAD_HINT[roomType]}
            onReject={(msgs) => toast({ kind: 'error', title: 'Some files were skipped', description: msgs.slice(0, 3).join(' · ') })}
          />
          <div className="mt-2 text-[12px] leading-relaxed text-dim">{PLAN_HINT[roomType]}</div>
          {roomType === 'exterior' && (
            <div className="mt-4 rounded-[var(--radius)] border border-border bg-surface/60 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[14px] text-ink">Empty lot?</div>
                  <div className="text-[12.5px] text-muted">No house yet — pick a starting style, then we will ask you about the siding, the roof, the setbacks and the budget before we build it. Photos are optional in this mode.</div>
                </div>
                <Toggle checked={emptyLot} onChange={setEmptyLot} label="Empty lot" />
              </div>
              {emptyLot && (
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {HOUSE_TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTemplate(t.id)}
                      aria-pressed={template === t.id}
                      className={cx('rounded-[var(--radius-sm)] border p-3 text-left transition-colors', template === t.id ? 'border-brass bg-brass-soft' : 'border-border hover:border-border-strong')}
                    >
                      <div className="text-[13px] text-ink">{t.name}</div>
                      <div className="mt-0.5 text-[11px] leading-snug text-muted">{t.blurb}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="panel mt-6 p-5 sm:p-6">
          <div className="eyebrow mb-3">Step 3 · Tell us what you want <span className="normal-case tracking-normal text-dim">(optional)</span></div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={PLACEHOLDER[roomType]}
            rows={4}
            disabled={busy}
            className="input h-auto w-full resize-y py-3 leading-relaxed placeholder:text-dim"
          />
          <div className="mt-1.5 text-[11.5px] text-dim">Dimensions, must-keeps, and wish-list items all help the analyzer. Plans and surveys can be summarized here.</div>
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-black/60 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="text-[12.5px] text-muted">
            {items.length > 0
              ? <>{items.length} photo{items.length === 1 ? '' : 's'} ready · detailed rooms may take several minutes</>
              : roomType === 'exterior' && emptyLot
                ? <>Template build · then a few questions about the house</>
                : <>Add at least one photo to continue</>}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => onDemo(roomType)} disabled={busy}>
              <Sparkles size={14} /> Try a demo
            </button>
            <button type="button" className={cx('btn btn-primary btn-lg', canSubmit && 'pulse-ring')} disabled={!canSubmit} onClick={submit}>
              Build my 3D twin <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
