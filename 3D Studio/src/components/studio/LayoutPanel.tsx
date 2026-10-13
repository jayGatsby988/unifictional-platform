'use client';
/**
 * Layout tab — structural controls that patch the spec. Every change
 * re-renders the 3D twin and re-prices the estimate immediately.
 *
 * The Décor section is shared by kitchens and bathrooms: shelves, plants, art,
 * the rug and the window treatment are the things a photo shows that make a
 * twin read as THAT room, so the analyzer's guesses have to be correctable
 * here — same list model as the spec, one card per piece.
 */
import { useMemo } from 'react';
import { Plus, RotateCcw, X } from 'lucide-react';
import { useProjectStore } from '@/lib/store/project-store';
import { HOUSE_TEMPLATES, defaultExterior, emptyDecor } from '@/lib/spec/defaults';
import type { Appliance, ApplianceKind, BathAccessory, BathroomSpec, Burner, CabinetContents, CabinetDoorStyle, DecorItem, DecorItemKind, DecorItemMaterial, DecorItemOn, DecorSpec, ExteriorSpec, KitchenSpec, OpenShelf, Plant, RoofType, Wall, WallArt } from '@/lib/spec/types';
import { CABINET_ABOVE, CANOPY_IN, resolveCabinetAbove, resolveHoodShape, rowHeightIn, type CabinetAbove } from '@/lib/spec/hood';
import { backsplashHeightWord } from '@/lib/spec/backsplash';
// one parser for '12x24', shared with the guided intake — two copies would be
// two ways to read a tile size, and the picker writes the same string as the
// interview does
import { parseModule } from '@/lib/spec/intake';
import { BATHROOM_ITEM_KINDS } from '@/lib/spec/decor-items';
import { STACK_MIN_ROW_IN, TIER1_TARGET_IN, TIER2_MAX_IN, TIER2_MIN_IN, deriveUppers2, hasUppers2, resolveUppers2HeightIn } from '@/lib/spec/uppers';
import { frameOpenEdges, resolveOpen } from '@/lib/spec/photo-box';
import { ISLAND_KNEE_IN, ISLAND_KNEE_MIN_IN, islandNeedsKneeRoom } from '@/lib/ai/reconcile';
import { computeKitchenLayout } from '@/components/scene/kitchen/layout';
import { ft, fmtFt, inch } from '@/lib/units';
import { EmptyState, Field, Note, SectionTitle, Segmented, Select, Slider, Stepper, Toggle } from './controls';
import { cx } from './hooks';
import { MeasuredDimensions } from './MeasuredDimensions';
import { FloorPlanControls } from './FloorPlanControls';
import { LayoutAudit } from './LayoutAudit';
import { CapturedLayoutSummary } from './CapturedLayoutSummary';
import { ScanDesignControls } from './ScanDesignControls';

const fmtIn = (n: number) => `${Math.round(n)}"`;
/** inches to the nearest half — overhangs are set in half-inches */
const fmtHalfIn = (n: number) => `${Math.round(n * 2) / 2}"`;
const fmtPitch = (n: number) => `${n}:12`;
const fmtCount = (n: number) => `${n}`;
const fmtPct = (n: number) => `${Math.round(n * 100)}%`;
/** feet with a sign, for an offset from a centre */
const fmtFtSigned = (n: number) => (n > 0 ? `+${fmtFt(n)}` : fmtFt(n));
const fmtInSigned = (n: number) => (n > 0 ? `+${fmtIn(n)}` : fmtIn(n));

const APPLIANCE_LABEL: Record<ApplianceKind, string> = {
  fridge: 'Fridge', range: 'Range', cooktop: 'Cooktop', 'wall-oven': 'Wall oven', hood: 'Hood', dishwasher: 'Dishwasher', microwave: 'Microwave', 'wine-fridge': 'Wine fridge',
};
/** width slider range per appliance kind (inches) — the same bounds the layout accepts */
const APPLIANCE_WIDTH: Record<ApplianceKind, [number, number]> = {
  fridge: [24, 48], range: [20, 60], cooktop: [24, 48], 'wall-oven': [24, 36], hood: [20, 66], dishwasher: [18, 24], microwave: [18, 30], 'wine-fridge': [15, 30],
};
const HOOD_SHAPE_LABEL: Record<NonNullable<Appliance['hoodShape']>, string> = { box: 'box', tapered: 'tapered', curved: 'curved', 'wood-canopy': 'wood canopy', slim: 'slim insert' };
const CABINET_ABOVE_LABEL: Record<CabinetAbove, string> = {
  none: 'None — duct cover to the ceiling', doors: 'Cabinet with doors', glass: 'Glass-door cabinet', panel: 'Plain panel box',
};
const words = (s: string | null | undefined) => (s ? s.replace(/-/g, ' ') : '');

const DOOR_STYLES: Array<{ value: CabinetDoorStyle; label: string }> = [
  { value: 'shaker', label: 'Shaker' }, { value: 'flat', label: 'Flat panel' }, { value: 'slab', label: 'Slab' },
  { value: 'raised', label: 'Raised panel' }, { value: 'beaded', label: 'Beaded' }, { value: 'glass', label: 'Glass front' }, { value: 'open', label: 'Open shelving' },
];

const WALL_LABEL: Record<Wall, string> = { back: 'Back wall', left: 'Left wall', right: 'Right wall', front: 'Front wall' };
const WALL_OPTIONS: Array<{ value: Wall; label: string }> = (['back', 'left', 'right', 'front'] as Wall[]).map((w) => ({ value: w, label: WALL_LABEL[w] }));

// ---------------------------------------------------------------------------
// Décor
// ---------------------------------------------------------------------------

/** The 30 item kinds, in schema order, with the words a contractor would use. */
const ITEM_KIND_OPTIONS: Array<{ value: DecorItemKind; label: string }> = [
  { value: 'pot', label: 'Pot' }, { value: 'pan', label: 'Pan' }, { value: 'kettle', label: 'Kettle' },
  { value: 'dutch-oven', label: 'Dutch oven' }, { value: 'cutting-board', label: 'Cutting board' },
  { value: 'bowl', label: 'Bowl' }, { value: 'fruit-bowl', label: 'Fruit bowl' }, { value: 'bottle', label: 'Bottle' },
  { value: 'oil-set', label: 'Oil & vinegar set' }, { value: 'vase', label: 'Vase' }, { value: 'flowers', label: 'Flowers' },
  { value: 'books', label: 'Books' }, { value: 'utensil-crock', label: 'Utensil crock' }, { value: 'knife-block', label: 'Knife block' },
  { value: 'coffee-maker', label: 'Coffee maker' }, { value: 'stand-mixer', label: 'Stand mixer' }, { value: 'toaster', label: 'Toaster' },
  { value: 'microwave-countertop', label: 'Countertop microwave' }, { value: 'soap-set', label: 'Soap set' },
  { value: 'dish-rack', label: 'Dish rack' }, { value: 'tray', label: 'Tray' }, { value: 'candle', label: 'Candle' },
  { value: 'canister', label: 'Canister' }, { value: 'paper-towel', label: 'Paper towel' }, { value: 'plate-stack', label: 'Stack of plates' },
  { value: 'mugs', label: 'Mugs' }, { value: 'jar', label: 'Jar' }, { value: 'basket', label: 'Basket' },
  { value: 'towel', label: 'Towel' },
  // the bathroom six, in the schema's order
  { value: 'folded-towels', label: 'Folded towels' }, { value: 'soap-pump', label: 'Soap pump' },
  { value: 'toothbrush-cup', label: 'Toothbrush cup' }, { value: 'robe', label: 'Robe' },
  { value: 'bath-mat', label: 'Bath mat' }, { value: 'tissue-box', label: 'Tissue box' },
  { value: 'other', label: 'Something else' },
];

/**
 * What a BATHROOM's picker offers first. Not a restriction — the full list is
 * still there under "Everything else" — but a vanity top with a Dutch oven on
 * it is a mis-click nobody wants to make, and the kinds a bathroom really has
 * are eleven of thirty-six.
 */
const BATH_ITEM_KIND_OPTIONS: Array<{ value: DecorItemKind; label: string }> = (() => {
  const wanted = new Set<DecorItemKind>(BATHROOM_ITEM_KINDS);
  const first = ITEM_KIND_OPTIONS.filter((o) => wanted.has(o.value));
  const rest = ITEM_KIND_OPTIONS.filter((o) => !wanted.has(o.value));
  return [...first, ...rest];
})();

/** what "Add item" seeds, per room — a bathroom's first object is a towel, not a bowl */
const NEW_BATH_ITEM: DecorItem = { kind: 'folded-towels', label: 'folded towels', on: 'counter', wall: 'back', t: 0.5, depthT: null, shelfIndex: null, burner: null, sizeIn: 13, colorHex: '#f2f0ec', material: 'fabric', count: 2 };
const ITEM_MATERIAL_OPTIONS: Array<{ value: DecorItemMaterial; label: string }> = [
  { value: 'stainless', label: 'Stainless' }, { value: 'black-metal', label: 'Black metal' }, { value: 'copper', label: 'Copper' },
  { value: 'brass', label: 'Brass' }, { value: 'enamel', label: 'Enamel' }, { value: 'ceramic', label: 'Ceramic' },
  { value: 'glass', label: 'Glass' }, { value: 'wood', label: 'Wood' }, { value: 'plastic', label: 'Plastic' },
  { value: 'fabric', label: 'Fabric' }, { value: 'paper', label: 'Paper' }, { value: 'marble', label: 'Marble' }, { value: 'wicker', label: 'Wicker' },
];
const BURNER_OPTIONS: Array<{ value: Burner; label: string }> = [
  { value: 'left-back', label: 'Left back' }, { value: 'left-front', label: 'Left front' },
  { value: 'centre-back', label: 'Centre back' }, { value: 'centre-front', label: 'Centre front' },
  { value: 'right-back', label: 'Right back' }, { value: 'right-front', label: 'Right front' },
];
const CONTENT_KIND_OPTIONS: Array<{ value: CabinetContents['kind']; label: string }> = [
  { value: 'plates', label: 'Plates' }, { value: 'bowls', label: 'Bowls' }, { value: 'glasses', label: 'Glasses' },
  { value: 'mugs', label: 'Mugs' }, { value: 'jars', label: 'Jars' }, { value: 'cookbooks', label: 'Cookbooks' },
  { value: 'bottles', label: 'Bottles' }, { value: 'mixed', label: 'A mix' }, { value: 'empty', label: 'Empty' },
];
/** Only these come in a row or a stack; a count on anything else would draw two kettles. */
const STACKABLE = new Set<DecorItemKind>(['canister', 'jar', 'candle', 'bottle', 'mugs', 'plate-stack', 'books']);

const NEW_SHELF: OpenShelf = { wall: 'back', t: 0.5, widthIn: 36, count: 2, bottomFt: 4.6, depthIn: 10, spacingIn: 14, material: 'wood', styled: 'mixed' };
const NEW_ITEM: DecorItem = { kind: 'bowl', label: 'bowl', on: 'counter', wall: 'back', t: 0.5, depthT: null, shelfIndex: null, burner: null, sizeIn: 10, colorHex: '#efece6', material: 'ceramic', count: 1 };
const NEW_CONTENTS: CabinetContents = { wall: 'back', t: 0.5, kind: 'mixed', density: 'sparse' };
const NEW_PLANT: Plant = { kind: 'floor', wall: 'corner', t: 1, sizeFt: 5, form: 'tree' };
const NEW_ART: WallArt = { wall: 'back', t: 0.5, widthIn: 24, heightIn: 30, centerFt: 5.2, frame: 'black' };

/** One piece of décor: a bordered card with a remove button in its corner. */
function Card({ title, onRemove, children }: { title: string; onRemove: () => void; children: React.ReactNode }) {
  return (
    <div className="mb-2 rounded-[var(--radius-sm)] border border-border p-2.5">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-[12px] text-muted">{title}</div>
        <button type="button" onClick={onRemove} aria-label={`Remove ${title}`} className="grid h-6 w-6 place-items-center rounded-full text-dim hover:bg-white/5 hover:text-ink"><X size={13} /></button>
      </div>
      {children}
    </div>
  );
}

function AddRow({ label, onAdd, disabled }: { label: string; onAdd: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onAdd} disabled={disabled} className="btn btn-ghost btn-sm mb-2 w-full justify-center disabled:opacity-40">
      <Plus size={13} /> {label}
    </button>
  );
}

/**
 * A slider for a spec number that may be unset (null, or 0 meaning "auto"):
 * it shows the fallback the layout would use until the user moves it, and a
 * reset button once it is set. The caller says what unset means in the hint.
 */
function OverrideSlider({ value, fallback, min, max, step = 1, format, onChange, ariaLabel }: {
  value: number | null; fallback: number; min: number; max: number; step?: number; format: (v: number) => string; onChange: (v: number | null) => void; ariaLabel: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1">
        <Slider value={value ?? fallback} min={min} max={max} step={step} onChange={(v) => onChange(v)} format={format} ariaLabel={ariaLabel} />
      </div>
      <button
        type="button"
        onClick={() => onChange(null)}
        disabled={value == null}
        aria-label={`Reset ${ariaLabel}`}
        title="Back to the default"
        className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-full text-dim hover:bg-white/5 hover:text-ink', value == null && 'invisible')}
      >
        <RotateCcw size={12} />
      </button>
    </div>
  );
}

type DecorListKey = 'shelves' | 'plants' | 'art' | 'items' | 'cabinetContents';

function DecorControls({ decor, room, spec, onChange }: {
  decor: DecorSpec;
  room: 'kitchen' | 'bathroom';
  /** the kitchen this décor lives in, so an item is only offered a host that exists */
  spec?: KitchenSpec;
  onChange: (fn: (d: DecorSpec) => DecorSpec) => void;
}) {
  const setAt = <K extends DecorListKey>(key: K, i: number, p: Partial<NonNullable<DecorSpec[K]>[number]>) =>
    onChange((d) => ({ ...d, [key]: (d[key] ?? []).map((it, j) => (j === i ? { ...it, ...p } : it)) }));
  const removeAt = (key: DecorListKey, i: number) => onChange((d) => ({ ...d, [key]: (d[key] ?? []).filter((_, j) => j !== i) }));
  const items = decor.items ?? [];
  const contents = decor.cabinetContents ?? [];
  const hasIsland = !!spec?.island.present;
  const hasRange = !!spec?.appliances.some((a) => (a.kind === 'range' || a.kind === 'cooktop') && a.wall !== 'island');
  const hasWindow = !!spec?.openings.some((o) => o.kind === 'window');
  const hostOptions: Array<{ value: DecorItemOn; label: string }> = [
    { value: 'counter', label: 'On a counter' },
    ...(hasRange ? [{ value: 'range' as const, label: 'On the range' }] : []),
    ...(hasIsland ? [{ value: 'island' as const, label: 'On the island' }] : []),
    ...(decor.shelves.length ? [{ value: 'shelf' as const, label: 'On an open shelf' }] : []),
    ...(hasWindow ? [{ value: 'sill' as const, label: 'On a window sill' }] : []),
    { value: 'floor', label: 'On the floor' },
  ];
  const whereOptions: Array<{ value: Plant['wall']; label: string }> = [
    ...WALL_OPTIONS,
    ...(room === 'kitchen' ? [{ value: 'island' as const, label: 'Island' }] : []),
    { value: 'corner', label: 'A corner' },
  ];
  return (
    <>
      <SectionTitle>Décor</SectionTitle>
      <div className="mb-1 text-[11.5px] text-dim">What the photo shows on the walls and floor. Pieces slide to the nearest clear spot when they collide with a window or cabinet.</div>

      <Field label="Open shelves" hint={decor.shelves.length ? undefined : 'None in the photo'}><span /></Field>
      {decor.shelves.map((s, i) => (
        <Card key={`shelf-${i}`} title={`Shelf ${i + 1}`} onRemove={() => removeAt('shelves', i)}>
          <Select<Wall> value={s.wall} options={WALL_OPTIONS} onChange={(v) => setAt('shelves', i, { wall: v })} className="mb-1 w-full" ariaLabel={`Shelf ${i + 1} wall`} />
          <Field label="Construction"><Select value={s.enclosure ? 'enclosed' : 'floating'} options={[{ value: 'floating', label: 'Floating boards' }, { value: 'enclosed', label: 'Open display cabinet' }]} onChange={(v) => setAt('shelves', i, { enclosure: v === 'enclosed' ? { heightIn: Math.min(120, Math.max(12, s.count * s.spacingIn + 0.75)), backPanel: true, panelThicknessIn: 0.75 } : null })} ariaLabel={`Shelf ${i + 1} construction`} className="w-full" /></Field>
          <Field label="Position" hint="Along the wall"><Slider value={s.t} min={0.02} max={0.98} step={0.01} onChange={(v) => setAt('shelves', i, { t: v })} format={fmtPct} ariaLabel={`Shelf ${i + 1} position`} /></Field>
          <Field label="Width"><Slider value={s.widthIn} min={12} max={96} step={2} onChange={(v) => setAt('shelves', i, { widthIn: v })} format={fmtIn} ariaLabel={`Shelf ${i + 1} width`} /></Field>
          <Field label="Depth"><Slider value={s.depthIn} min={6} max={16} step={0.5} onChange={(v) => setAt('shelves', i, { depthIn: v })} format={fmtHalfIn} ariaLabel={`Shelf ${i + 1} depth`} /></Field>
          <Field label="Boards" hint={s.enclosure ? 'Base and interior shelves; top panel is separate' : undefined} inline><Stepper value={s.count} min={1} max={5} onChange={(v) => setAt('shelves', i, { count: v })} ariaLabel={`Shelf ${i + 1} boards`} /></Field>
          <Field label="Shelf spacing"><Slider value={s.spacingIn} min={8} max={24} step={0.5} onChange={(v) => setAt('shelves', i, { spacingIn: v })} format={fmtHalfIn} ariaLabel={`Shelf ${i + 1} spacing`} /></Field>
          <Field label="Lowest board" hint="Height above the floor"><Slider value={s.bottomFt} min={2} max={9} step={0.1} onChange={(v) => setAt('shelves', i, { bottomFt: v })} format={fmtFt} ariaLabel={`Shelf ${i + 1} height`} /></Field>
          {s.enclosure && <>
            <Field label="Cabinet height" hint="Includes the top panel"><Slider value={s.enclosure.heightIn} min={12} max={120} step={0.5} onChange={(v) => setAt('shelves', i, { enclosure: { ...s.enclosure!, heightIn: v } })} format={fmtHalfIn} ariaLabel={`Shelf ${i + 1} cabinet height`} /></Field>
            <Field label="Back panel" inline><Toggle checked={s.enclosure.backPanel} onChange={(v) => setAt('shelves', i, { enclosure: { ...s.enclosure!, backPanel: v } })} label={`Shelf ${i + 1} back panel`} /></Field>
            <Field label="Opening direction" hint="Turn the case on its mounting wall"><Select value={String(s.enclosure.rotationDeg ?? 0)} options={[{ value: '0', label: 'Face into room' }, { value: '90', label: 'Rotate +90°' }, { value: '-90', label: 'Rotate −90°' }, { value: '180', label: 'Rotate 180°' }]} onChange={(v) => setAt('shelves', i, { enclosure: { ...s.enclosure!, rotationDeg: Number(v) as -90 | 0 | 90 | 180 } })} ariaLabel={`Shelf ${i + 1} opening direction`} className="w-full" /></Field>
          </>}
          <div className="grid grid-cols-2 gap-2">
            <Select<OpenShelf['material']> value={s.material} options={[{ value: 'wood', label: 'Wood' }, { value: 'match-cabinets', label: 'Match cabinets' }, { value: 'match-countertop', label: 'Match countertop' }, { value: 'white', label: 'White' }, { value: 'black', label: 'Black' }]} onChange={(v) => setAt('shelves', i, { material: v, finishColorHex: null })} className="w-full" ariaLabel={`Shelf ${i + 1} material`} />
            <Select<OpenShelf['styled']> value={s.styled} options={[{ value: 'mixed', label: 'Styled: mixed' }, { value: 'dishes', label: 'Dishes' }, { value: 'books', label: 'Books' }, { value: 'plants', label: 'Plants' }, { value: 'empty', label: 'Empty' }]} onChange={(v) => setAt('shelves', i, { styled: v })} className="w-full" ariaLabel={`Shelf ${i + 1} styling`} />
          </div>
          {s.material === 'wood' && <Field label="Wood color" hint={s.finishColorHex ? 'Detected or chosen finish' : 'Style default'}>
            <div className="flex items-center gap-2"><input type="color" value={s.finishColorHex ?? '#a07845'} aria-label={`Shelf ${i + 1} wood color`} onChange={(e) => setAt('shelves', i, { finishColorHex: e.target.value })} className="h-7 w-10 cursor-pointer rounded border border-line" />{s.finishColorHex && <button type="button" className="text-xs text-dim" onClick={() => setAt('shelves', i, { finishColorHex: null })}>Reset</button>}</div>
          </Field>}
        </Card>
      ))}
      <AddRow label="Add shelf" disabled={decor.shelves.length >= 6} onAdd={() => onChange((d) => ({ ...d, shelves: [...d.shelves, { ...NEW_SHELF }] }))} />

      <Field label="Plants" hint={decor.plants.length ? undefined : 'None in the photo'}><span /></Field>
      {decor.plants.map((p, i) => (
        <Card key={`plant-${i}`} title={`Plant ${i + 1}`} onRemove={() => removeAt('plants', i)}>
          <div className="mb-1 grid grid-cols-2 gap-2">
            <Select<Plant['kind']> value={p.kind} options={[{ value: 'floor', label: 'On the floor' }, { value: 'counter', label: 'On a counter' }, { value: 'shelf', label: 'On a shelf' }, { value: 'hanging', label: 'Hanging' }]} onChange={(v) => setAt('plants', i, { kind: v })} className="w-full" ariaLabel={`Plant ${i + 1} kind`} />
            <Select<Plant['form']> value={p.form} options={[{ value: 'tree', label: 'Tree' }, { value: 'leafy', label: 'Leafy' }, { value: 'trailing', label: 'Trailing' }, { value: 'herb', label: 'Herb' }, { value: 'succulent', label: 'Succulent' }]} onChange={(v) => setAt('plants', i, { form: v })} className="w-full" ariaLabel={`Plant ${i + 1} form`} />
          </div>
          <Select<Plant['wall']> value={p.wall} options={whereOptions} onChange={(v) => setAt('plants', i, { wall: v })} className="w-full" ariaLabel={`Plant ${i + 1} where`} />
          {p.wall !== 'corner' && <Field label="Position" hint="Along the wall"><Slider value={p.t} min={0.02} max={0.98} step={0.01} onChange={(v) => setAt('plants', i, { t: v })} format={fmtPct} ariaLabel={`Plant ${i + 1} position`} /></Field>}
          <Field label="Size" hint="Overall height"><Slider value={p.sizeFt} min={0.3} max={9} step={0.1} onChange={(v) => setAt('plants', i, { sizeFt: v })} format={fmtFt} ariaLabel={`Plant ${i + 1} size`} /></Field>
        </Card>
      ))}
      <AddRow label="Add plant" disabled={decor.plants.length >= 8} onAdd={() => onChange((d) => ({ ...d, plants: [...d.plants, { ...NEW_PLANT }] }))} />

      <Field label="Wall art" hint={decor.art.length ? undefined : 'None in the photo'}><span /></Field>
      {decor.art.map((a, i) => (
        <Card key={`art-${i}`} title={`Art ${i + 1}`} onRemove={() => removeAt('art', i)}>
          <div className="mb-1 grid grid-cols-2 gap-2">
            <Select<Wall> value={a.wall} options={WALL_OPTIONS} onChange={(v) => setAt('art', i, { wall: v })} className="w-full" ariaLabel={`Art ${i + 1} wall`} />
            <Select<WallArt['frame']> value={a.frame} options={[{ value: 'black', label: 'Black frame' }, { value: 'wood', label: 'Wood frame' }, { value: 'white', label: 'White frame' }, { value: 'none', label: 'Canvas, no frame' }]} onChange={(v) => setAt('art', i, { frame: v })} className="w-full" ariaLabel={`Art ${i + 1} frame`} />
          </div>
          <Field label="Position" hint="Along the wall"><Slider value={a.t} min={0.02} max={0.98} step={0.01} onChange={(v) => setAt('art', i, { t: v })} format={fmtPct} ariaLabel={`Art ${i + 1} position`} /></Field>
          <Field label="Size"><div className="grid grid-cols-2 gap-2">
            <Slider value={a.widthIn} min={6} max={96} step={2} onChange={(v) => setAt('art', i, { widthIn: v })} format={fmtIn} ariaLabel={`Art ${i + 1} width`} />
            <Slider value={a.heightIn} min={6} max={96} step={2} onChange={(v) => setAt('art', i, { heightIn: v })} format={fmtIn} ariaLabel={`Art ${i + 1} height`} />
          </div></Field>
          <Field label="Centre height"><Slider value={a.centerFt} min={2} max={9} step={0.1} onChange={(v) => setAt('art', i, { centerFt: v })} format={fmtFt} ariaLabel={`Art ${i + 1} centre height`} /></Field>
        </Card>
      ))}
      <AddRow label="Add art" disabled={decor.art.length >= 6} onAdd={() => onChange((d) => ({ ...d, art: [...d.art, { ...NEW_ART }] }))} />

      <Field label="Rug" hint={decor.rug?.present ? 'Fitted to the clear floor' : 'Bare floor'} inline>
        <Toggle checked={decor.rug?.present === true} onChange={(v) => onChange((d) => ({ ...d, rug: { present: v, lengthFt: d.rug?.lengthFt ?? 6, widthFt: d.rug?.widthFt ?? 2.5, style: d.rug?.style ?? 'runner' } }))} label="Rug" />
      </Field>
      {decor.rug?.present && (
        <>
          <Field label="Style">
            <Segmented<NonNullable<DecorSpec['rug']>['style']> size="sm" value={decor.rug.style} options={[{ value: 'runner', label: 'Runner' }, { value: 'area', label: 'Area' }, { value: 'round', label: 'Round' }]} onChange={(v) => onChange((d) => ({ ...d, rug: d.rug ? { ...d.rug, style: v } : d.rug }))} />
          </Field>
          <Field label="Length"><Slider value={decor.rug.lengthFt} min={2} max={14} step={0.5} onChange={(v) => onChange((d) => ({ ...d, rug: d.rug ? { ...d.rug, lengthFt: v } : d.rug }))} format={fmtFt} ariaLabel="Rug length" /></Field>
          <Field label="Width"><Slider value={decor.rug.widthFt} min={1.5} max={10} step={0.5} onChange={(v) => onChange((d) => ({ ...d, rug: d.rug ? { ...d.rug, widthFt: v } : d.rug }))} format={fmtFt} ariaLabel="Rug width" /></Field>
        </>
      )}

      <Field label="Window treatment" hint="Applied to every window">
        <Select<DecorSpec['windowTreatment']> value={decor.windowTreatment} options={[{ value: 'none', label: 'None' }, { value: 'roman-shade', label: 'Roman shade' }, { value: 'roller', label: 'Roller shade' }, { value: 'curtains', label: 'Curtains' }, { value: 'blinds', label: 'Blinds' }, { value: 'cafe-curtain', label: 'Cafe curtain' }]} onChange={(v) => onChange((d) => ({ ...d, windowTreatment: v }))} className="w-full" ariaLabel="Window treatment" />
      </Field>
      <Field label={room === 'bathroom' ? 'Items on the vanity' : 'Items on the counters'} hint={items.length ? 'One card per object the photo shows' : room === 'bathroom' ? 'Nothing on the vanity yet' : 'Nothing on the counters yet'}><span /></Field>
      {items.map((it, i) => {
        const boards = (decor.shelves.find((sh) => sh.wall === it.wall) ?? decor.shelves[0])?.count ?? 1;
        return (
          <Card key={`item-${i}`} title={`${it.label || it.kind.replace(/-/g, ' ')} ${i + 1}`} onRemove={() => removeAt('items', i)}>
            <div className="mb-1 grid grid-cols-2 gap-2">
              <Select<DecorItemKind> value={it.kind} options={room === 'bathroom' ? BATH_ITEM_KIND_OPTIONS : ITEM_KIND_OPTIONS} onChange={(v) => setAt('items', i, { kind: v })} className="w-full" ariaLabel={`Item ${i + 1} kind`} />
              <Select<DecorItemOn> value={it.on} options={hostOptions} onChange={(v) => setAt('items', i, {
                on: v,
                // the fields that only mean something on one host follow it, or a
                // stale burner would keep a bowl standing on a hob it left
                burner: v === 'range' ? it.burner ?? 'left-back' : null,
                shelfIndex: v === 'shelf' ? it.shelfIndex : null,
                depthT: v === 'counter' || v === 'island' || v === 'sill' ? it.depthT : null,
                wall: v === 'island' ? 'island' : it.wall === 'island' ? 'back' : it.wall,
              })} className="w-full" ariaLabel={`Item ${i + 1} host`} />
            </div>
            {it.on !== 'range' && it.on !== 'island' && (
              <Select<Wall> value={(it.wall === 'island' || it.wall == null ? 'back' : it.wall)} options={WALL_OPTIONS} onChange={(v) => setAt('items', i, { wall: v })} className="mb-1 w-full" ariaLabel={`Item ${i + 1} wall`} />
            )}
            {it.on !== 'range' && (
              <Field label="Position" hint="Along the wall"><Slider value={it.t} min={0.02} max={0.98} step={0.01} onChange={(v) => setAt('items', i, { t: v })} format={fmtPct} ariaLabel={`Item ${i + 1} position`} /></Field>
            )}
            {(it.on === 'counter' || it.on === 'island' || it.on === 'sill') && (
              <Field label="Depth" hint={it.depthT == null ? 'Auto — from the kind' : '0% against the splash, 100% at the front edge'}>
                <OverrideSlider value={it.depthT} fallback={0.5} min={0} max={1} step={0.05} format={fmtPct} onChange={(v) => setAt('items', i, { depthT: v })} ariaLabel={`Item ${i + 1} depth`} />
              </Field>
            )}
            {it.on === 'range' && (
              <Field label="Burner">
                <Select<Burner | 'auto'> value={it.burner ?? 'auto'} options={[{ value: 'auto', label: 'Auto — the next free one' }, ...BURNER_OPTIONS]} onChange={(v) => setAt('items', i, { burner: v === 'auto' ? null : v })} className="w-full" ariaLabel={`Item ${i + 1} burner`} />
              </Field>
            )}
            {it.on === 'shelf' && (
              <Field label="Shelf board" hint={it.shelfIndex == null ? 'Auto — the top board' : '0 is the lowest'} inline>
                <Stepper value={it.shelfIndex ?? Math.max(0, boards - 1)} min={0} max={Math.max(0, boards - 1)} onChange={(v) => setAt('items', i, { shelfIndex: v })} ariaLabel={`Item ${i + 1} shelf board`} />
              </Field>
            )}
            <Field label="Size" hint="Its longest dimension"><Slider value={it.sizeIn} min={1} max={40} step={0.5} onChange={(v) => setAt('items', i, { sizeIn: v })} format={fmtIn} ariaLabel={`Item ${i + 1} size`} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Select<DecorItemMaterial> value={it.material} options={ITEM_MATERIAL_OPTIONS} onChange={(v) => setAt('items', i, { material: v })} className="w-full" ariaLabel={`Item ${i + 1} material`} />
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(it.colorHex) ? it.colorHex : '#efece6'} onChange={(e) => setAt('items', i, { colorHex: e.target.value })} aria-label={`Item ${i + 1} colour`} className="h-8 w-full cursor-pointer rounded-[var(--radius-sm)] border border-border bg-transparent" />
            </div>
            {STACKABLE.has(it.kind) && (
              <Field label="How many" hint="Identical things in a row or a stack" inline>
                <Stepper value={it.count} min={1} max={12} onChange={(v) => setAt('items', i, { count: v })} ariaLabel={`Item ${i + 1} count`} />
              </Field>
            )}
          </Card>
        );
      })}
      <AddRow label="Add item" disabled={items.length >= 24} onAdd={() => onChange((d) => ({ ...d, items: [...(d.items ?? []), { ...(room === 'bathroom' ? NEW_BATH_ITEM : NEW_ITEM) }] }))} />

      {room === 'kitchen' && (
        <>
          <Field label="Behind glass doors" hint="Only glass-front and open wall cabinets show their contents"><span /></Field>
          {contents.map((c, i) => (
            <Card key={`contents-${i}`} title={`Cabinet ${i + 1}`} onRemove={() => removeAt('cabinetContents', i)}>
              <div className="mb-1 grid grid-cols-2 gap-2">
                <Select<Wall> value={c.wall} options={WALL_OPTIONS} onChange={(v) => setAt('cabinetContents', i, { wall: v })} className="w-full" ariaLabel={`Cabinet contents ${i + 1} wall`} />
                <Select<CabinetContents['kind']> value={c.kind} options={CONTENT_KIND_OPTIONS} onChange={(v) => setAt('cabinetContents', i, { kind: v })} className="w-full" ariaLabel={`Cabinet contents ${i + 1} kind`} />
              </div>
              <Field label="Position" hint="The cabinet's centre along its wall"><Slider value={c.t} min={0.02} max={0.98} step={0.01} onChange={(v) => setAt('cabinetContents', i, { t: v })} format={fmtPct} ariaLabel={`Cabinet contents ${i + 1} position`} /></Field>
              <Field label="How full">
                <Segmented<CabinetContents['density']> size="sm" value={c.density} options={[{ value: 'sparse', label: 'A few pieces' }, { value: 'full', label: 'Crowded' }]} onChange={(v) => setAt('cabinetContents', i, { density: v })} />
              </Field>
            </Card>
          ))}
          <AddRow label="Add cabinet contents" disabled={contents.length >= 10} onAdd={() => onChange((d) => ({ ...d, cabinetContents: [...(d.cabinetContents ?? []), { ...NEW_CONTENTS }] }))} />
        </>
      )}

      {/* The stools' own look. `style` says backless / low-back and `seat` says
          the material, but neither can say the PAD's plan shape or its colour —
          and a square chocolate-leather pad on a black frame is a different
          object from the round tan disc the scene draws by default. */}
      {room === 'kitchen' && decor.stools && (
        <>
          <Field label="Stool seat shape" hint={decor.stools.seatShape == null ? 'Auto — round' : 'The pad seen from above'}>
            <Segmented<'auto' | 'round' | 'square'>
              size="sm"
              value={decor.stools.seatShape ?? 'auto'}
              options={[{ value: 'auto', label: 'Auto' }, { value: 'round', label: 'Round' }, { value: 'square', label: 'Square' }]}
              onChange={(v) => onChange((d) => ({ ...d, stools: d.stools ? { ...d.stools, seatShape: v === 'auto' ? null : v } : d.stools }))}
            />
          </Field>
          <Field label="Stool seat colour" hint={decor.stools.seatColorHex == null ? `Auto — the ${words(decor.stools.seat)} seat's own colour` : 'Measured off the photo'}>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(decor.stools.seatColorHex ?? '') ? (decor.stools.seatColorHex as string) : '#8b5a34'}
                onChange={(e) => onChange((d) => ({ ...d, stools: d.stools ? { ...d.stools, seatColorHex: e.target.value } : d.stools }))}
                aria-label="Stool seat colour"
                className="h-8 w-full cursor-pointer rounded-[var(--radius-sm)] border border-border bg-transparent"
              />
              <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => onChange((d) => ({ ...d, stools: d.stools ? { ...d.stools, seatColorHex: null } : d.stools }))}>Auto</button>
            </div>
          </Field>
        </>
      )}
      <Field label="Counter styling" hint="Used only when no items are listed above">
        <Segmented<DecorSpec['counterStyling']> size="sm" value={decor.counterStyling} options={[{ value: 'none', label: 'Bare' }, { value: 'minimal', label: 'Minimal' }, { value: 'lived-in', label: 'Lived-in' }]} onChange={(v) => onChange((d) => ({ ...d, counterStyling: v }))} />
      </Field>
    </>
  );
}

// ---------------------------------------------------------------------------
// Island
// ---------------------------------------------------------------------------

/** largest value at or below `v` that the slider can actually land on */
const stepFloor = (v: number, step: number) => Math.floor(v / step + 1e-6) * step;

/**
 * What the ROOM will let this island be, in feet, alongside the countertop it
 * actually draws.
 *
 * `buildIsland` clamps the island's SIZE against a 24" aisle about a fixed
 * anchor, so a slider can run out of effect long before it runs out of travel:
 * in the client's kitchen the Length slider goes to 12 ft and the twin stops
 * growing at 6' 6". A control that keeps moving while the twin does not is a
 * control that lies, so the limit is ASKED FOR rather than restated here — a
 * second copy of the clamp would drift from the layout's. Solve the layout
 * once as declared, and once with an island bigger than any room: the second
 * answer IS the cap, because the cap is a function of the anchor, the room and
 * the overhangs and never of the length or width it clamps.
 *
 * `topLenFt × topWideFt` is the slab, not the cabinet body — the seating
 * overhang and a 1.5" scribe are added to the declared width, which is how
 * client-tan's 5.0 × 4.1 ft island gets drawn 5' long and 5' 3" DEEP. That is
 * the client's "js a square small island", and no spec field states it, so the
 * panel has to.
 */
function islandCaps(spec: KitchenSpec) {
  if (!spec.island.present) return null;
  const drawn = computeKitchenLayout(spec).island;
  const roomy = computeKitchenLayout({ ...spec, island: { ...spec.island, lengthFt: 30, widthFt: 12 } }).island;
  if (!drawn || !roomy) return null;
  return {
    lenFt: drawn.len / ft(1),
    wideFt: drawn.wide / ft(1),
    topLenFt: drawn.topLen / ft(1),
    topWideFt: drawn.topWide / ft(1),
    /** the overhang as DRAWN (the layout caps it at 20"), from the slab it produced */
    overhangIn: Math.round(((drawn.topWide - drawn.wide) / inch(1) - 1.5) * 2) / 2,
    maxLenFt: roomy.len / ft(1),
    maxWideFt: roomy.wide / ft(1),
    // The stool row is clamped by the TOP, not by the room, so these three come
    // from the same drawn island rather than a second copy of the rule.
    /** stools actually drawn: the layout caps the row at what the top spans */
    seating: drawn.seating,
    /** of those, the ones round a short end — capped by the floor beyond it and by a 34" top */
    endSeats: drawn.endSeats,
    /** the side row's shift as drawn, clamped so the outermost stool stays on the top */
    stoolOffsetIn: Math.round(drawn.stoolOffset / inch(1)),
  };
}

/**
 * Which END of the island the picture cut off, if either.
 *
 * A frame-cut box is a LOWER BOUND — the analyzer measured the part it could
 * see, and the fitter already knows not to trust that size ("the photo cuts
 * the box that measures island.lengthFt"). Nobody told the person who has to
 * type the real number in, and on the client's photo that is the whole story:
 * the island runs off the left edge, so the length in the spec is "how much of
 * it fitted in the frame", not "how long it is".
 *
 * Only the frame counts. An 'occluded' edge — a stool standing in front of the
 * island — hides none of its length and would make this note cry wolf.
 */
function islandCutEnd(spec: KitchenSpec): 'left' | 'right' | 'both' | null {
  const el = spec.detected.elements?.find((e) => e.kind === 'island');
  if (!el) return null;
  const atFrame = frameOpenEdges(el.box);
  const { open, openCause } = resolveOpen(el.box, el.open, el.openCause);
  const said = openCause === 'frame';
  const left = atFrame.left || (said && open.left);
  const right = atFrame.right || (said && open.right);
  if (left && right) return 'both';
  if (left) return 'left';
  if (right) return 'right';
  return null;
}

// ---------------------------------------------------------------------------
// Kitchen
// ---------------------------------------------------------------------------

function KitchenControls({ spec }: { spec: KitchenSpec }) {
  const patchSpec = useProjectStore((s) => s.patchSpec);
  const patch = (fn: (s: KitchenSpec) => KitchenSpec) => patchSpec((s) => (s.roomType === 'kitchen' ? fn(s) : s));
  const setDims = (p: Partial<KitchenSpec['dims']>) => patch((s) => {
    const dims = { ...s.dims, ...p };
    const runs = s.runs.map((r) => {
      const wallLen = r.wall === 'back' || r.wall === 'front' ? dims.widthFt : dims.depthFt;
      const maxLen = Math.max(2, wallLen * (1 - r.start));
      return r.lengthFt > maxLen ? { ...r, lengthFt: maxLen } : r;
    });
    return { ...s, dims, runs };
  });
  const island = spec.island;
  // Both are pure functions of the spec, and the spec is replaced on every
  // patch, so this recomputes exactly when the twin does.
  const caps = useMemo(() => islandCaps(spec), [spec]);
  const cutEnd = useMemo(() => islandCutEnd(spec), [spec]);
  // the knee-room rule is the reconciler's, read from it rather than restated:
  // a stool along the SIDE tucks under the top, one round an END does not
  const needsKnee = islandNeedsKneeRoom(spec.island);
  const overhangMinIn = needsKnee ? ISLAND_KNEE_MIN_IN : 0;
  const setIsland = (p: Partial<KitchenSpec['island']>) => patch((s) => ({ ...s, island: { ...s.island, ...p } }));
  // The slider stops where the room does, on the slider's own grid, and says
  // why. A declared length the room overrules is reported as both numbers —
  // that value is real, it is in the spec, and the twin is not drawing it.
  const lenLimitFt = caps ? Math.min(12, stepFloor(caps.maxLenFt, 0.5)) : 12;
  const wideLimitFt = caps ? Math.min(5, stepFloor(caps.maxWideFt, 0.25)) : 5;
  const lenHint = !caps ? undefined
    : island.lengthFt > caps.lenFt + 0.01 ? `Set to ${fmtFt(island.lengthFt)}, drawn ${fmtFt(caps.lenFt)} — a 24" aisle stops it there`
    : lenLimitFt < 12 ? `Up to ${fmtFt(lenLimitFt)} in this room — past that the 24" aisle closes up`
    : undefined;
  const wideHint = !caps ? undefined
    : island.widthFt > caps.wideFt + 0.01 ? `Set to ${fmtFt(island.widthFt)}, drawn ${fmtFt(caps.wideFt)} — the aisle past the overhang stops it there`
    : wideLimitFt < 5 ? `Up to ${fmtFt(wideLimitFt)} here — the overhang and a 24" aisle take the rest`
    : undefined;
  const uppersToCeiling = spec.runs.some((r) => r.uppersToCeiling);
  const decor = spec.decor ?? emptyDecor();
  const pendants = spec.lighting.pendants;
  const setPendants = (p: Partial<NonNullable<KitchenSpec['lighting']['pendants']>>) =>
    patch((s) => (s.lighting.pendants ? { ...s, lighting: { ...s.lighting, pendants: { ...s.lighting.pendants, ...p } } } : s));
  return (
    <>
      <SectionTitle>Room</SectionTitle>
      {spec.scanGeometry ? <p className="mb-4 text-xs leading-relaxed text-muted">Scanned walls are fixed to the capture. New fixture layouts need a clearance check against the actual room outline.</p> : <>
      <Field label="Width" hint="Along the back wall"><Slider value={spec.dims.widthFt} min={8} max={30} step={0.5} onChange={(v) => setDims({ widthFt: v })} format={fmtFt} ariaLabel="Room width" /></Field>
      <Field label="Depth"><Slider value={spec.dims.depthFt} min={8} max={30} step={0.5} onChange={(v) => setDims({ depthFt: v })} format={fmtFt} ariaLabel="Room depth" /></Field>
      <Field label="Ceiling height"><Slider value={spec.dims.ceilingFt} min={7.5} max={14} step={0.25} onChange={(v) => setDims({ ceilingFt: v })} format={fmtFt} ariaLabel="Ceiling height" /></Field>

      </>}

      <SectionTitle>Island</SectionTitle>
      <Field label="Island" hint={island.present ? `${island.kind.replace('-', ' ')}` : 'Add a freestanding island'} inline>
        <Toggle checked={island.present} onChange={(v) => patch((s) => ({ ...s, island: { ...s.island, present: v } }))} label="Island" />
      </Field>
      {island.present && (
        <>
          {/* The photo could not measure this island's length, and until now
              nothing said so — the number just sat in a slider like every
              measured one. */}
          {cutEnd && (
            <Note>
              The photo cuts this island off at the {cutEnd === 'both' ? 'left and the right' : cutEnd}, so {fmtFt(island.lengthFt)} is
              only as much of it as the picture could see. If you know the real length, set it here.
            </Note>
          )}
          {!caps && <Note>There is no clear floor left for an island in this room, so the twin draws none. Widen the room, or shorten a cabinet run.</Note>}
          <Field label="Length" hint={lenHint}>
            <Slider value={island.lengthFt} min={4} max={Math.max(island.lengthFt, 4.5, lenLimitFt)} step={0.5} onChange={(v) => setIsland({ lengthFt: v })} format={fmtFt} ariaLabel="Island length" />
          </Field>
          <Field label="Width" hint={wideHint}>
            <Slider value={island.widthFt} min={2} max={Math.max(island.widthFt, 2.25, wideLimitFt)} step={0.25} onChange={(v) => setIsland({ widthFt: v })} format={fmtFt} ariaLabel="Island width" />
          </Field>
          {/* The slab, not the body: the two sliders above set the cabinet, and
              the overhang below is added to the second of them. Reading the
              spec you would never know the top came out square. */}
          {caps && (
            <div className="mb-2 text-[11.5px] text-dim">
              Countertop drawn {fmtFt(caps.topLenFt)} long × {fmtFt(caps.topWideFt)} deep
              {caps.overhangIn > 0 && <> — {fmtHalfIn(caps.overhangIn)} of that depth is the seating overhang</>}.
            </div>
          )}
          {/* The row is capped by the length of the TOP it sits under, so on a
              short island the stepper counts past what the twin will draw. */}
          <Field
            label="Seating"
            hint={caps && caps.seating < island.seating ? `${island.seating} asked for, ${caps.seating} drawn — the top is only long enough for ${caps.seating}` : 'Stools along the overhang'}
            inline
          >
            <Stepper value={island.seating} min={0} max={6} onChange={(v) => setIsland({ seating: v })} ariaLabel="Island seating" />
          </Field>
          {/* Adding a stool used to force overhangIn to 12 from in here, which
              put a foot of counter depth into the spec that nobody typed and no
              control could take out again. But the coupling is REAL and it does
              not live here: `reconcileSpec` raises a side-seated island's
              overhang to 12" on the way out of analyze, refine AND the fit's
              own settle, and `params.ts` floors the fitted value at the same
              number. So the panel does not offer 0–9" and let the next pass
              take it back — it starts where the pipeline starts
              (ISLAND_KNEE_MIN_IN), and says why. A spec that arrived below the
              floor (from a correction, before it is reconciled) is reported
              rather than silently redrawn, since that value is really in the
              spec right now.

              18" is `IslandZ.overhangIn`'s own bound, and it is TIGHTER than
              `buildIsland`'s 20" clamp — so every value this slider can reach
              both validates on the way back through a route and draws in full.
              The readout above is measured off the drawn top, never off this
              number, so a clamp would show up there rather than be believed. */}
          {needsKnee && island.overhangIn < ISLAND_KNEE_MIN_IN && (
            <Note action={{ label: `Use ${fmtIn(ISLAND_KNEE_IN)}`, onClick: () => setIsland({ overhangIn: ISLAND_KNEE_IN }) }}>
              This island overhangs {fmtHalfIn(island.overhangIn)} with a stool along its side, which the twin cannot
              draw — the seat would sit inside the cabinet. The slider below starts at {fmtIn(ISLAND_KNEE_MIN_IN)} for that
              reason, and the next fit or accuracy pass will raise this to {fmtIn(ISLAND_KNEE_IN)} on its own.
            </Note>
          )}
          <Field
            label="Seating overhang"
            hint={needsKnee
              ? `Counter past the cabinet on the stool side — added to the width above. A side stool keeps ${fmtIn(ISLAND_KNEE_MIN_IN)} or more for knee room`
              : 'Counter past the cabinet on the stool side — added to the width above'}
          >
            <Slider value={island.overhangIn} min={overhangMinIn} max={18} step={0.5} onChange={(v) => setIsland({ overhangIn: v })} format={fmtHalfIn} ariaLabel="Island seating overhang" />
          </Field>
          {island.seating > 0 && (
            <>
              <Field label="Stool spacing" hint={island.stoolPitchIn > 0 ? 'Centre to centre' : 'Auto — up to 28" apart, spread under the top'}>
                <OverrideSlider value={island.stoolPitchIn > 0 ? island.stoolPitchIn : null} fallback={24} min={16} max={40} step={1} format={fmtIn} onChange={(v) => setIsland({ stoolPitchIn: v ?? 0 })} ariaLabel="Stool spacing" />
              </Field>
              {/* Two round one end need a top 34" deep, and any at all need clear
                  floor past that end — both are decided in the layout, so the
                  drawn count is asked for rather than re-derived. */}
              <Field
                label="End seats"
                hint={caps && caps.endSeats < Math.min(island.endSeats, island.seating) ? `${island.endSeats} asked for, ${caps.endSeats} drawn — the rest do not fit round the end` : 'Stools round the short end, when the floor is clear'}
                inline
              >
                <Stepper value={Math.min(island.endSeats, island.seating)} min={0} max={Math.min(island.endPlacement === 'both' ? 4 : 2, island.seating)} onChange={(v) => setIsland({ endSeats: v })} ariaLabel="Island end seats" />
              </Field>
              {island.endSeats > 0 && (
                <Field label="End stools" hint='An explicit end only needs 20 in of clear floor; auto wants 30'>
                  <Segmented<KitchenSpec['island']['endPlacement']> size="sm" value={island.endPlacement} options={[{ value: 'auto', label: 'Auto' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }, { value: 'both', label: 'Both' }]} onChange={(v) => setIsland({ endPlacement: v })} />
                </Field>
              )}
              <Field label="End overhang" hint='At 6 in and over the end stools tuck under the top'>
                <OverrideSlider value={island.endOverhangIn ?? null} fallback={1.5} min={0} max={18} step={0.5} format={fmtHalfIn} onChange={(v) => setIsland({ endOverhangIn: v })} ariaLabel="Island end overhang" />
              </Field>
              {island.seating - island.endSeats > 1 && (
                <Field
                  label="Stool offset"
                  hint={caps && Math.abs(caps.stoolOffsetIn) < Math.abs(island.stoolOffsetIn) - 0.5 ? `Set to ${fmtInSigned(island.stoolOffsetIn)}, drawn ${fmtInSigned(caps.stoolOffsetIn)} — past that the end stool leaves the top` : 'Shift of the side row, + toward the right end'}
                >
                  <Slider value={island.stoolOffsetIn} min={-36} max={36} step={1} onChange={(v) => setIsland({ stoolOffsetIn: v })} format={fmtInSigned} ariaLabel="Island stool offset" />
                </Field>
              )}
            </>
          )}
          <Field label="Waterfall edge" hint="Countertop wraps down the ends" inline><Toggle checked={island.waterfall} onChange={(v) => setIsland({ waterfall: v })} label="Waterfall edge" /></Field>
        </>
      )}

      <SectionTitle>Cabinets</SectionTitle>
      <Field label="Door style"><Select<CabinetDoorStyle> value={spec.cabinets.doorStyle} options={DOOR_STYLES} onChange={(v) => patch((s) => ({ ...s, cabinets: { ...s.cabinets, doorStyle: v } }))} className="w-full" ariaLabel="Door style" /></Field>
      <Field label="Uppers to ceiling" hint="Stack or extend uppers to the ceiling" inline><Toggle checked={uppersToCeiling} onChange={(v) => patch((s) => ({ ...s, runs: s.runs.map((r) => ({ ...r, uppersToCeiling: v })) }))} label="Uppers to ceiling" /></Field>
      <Field label="Crown moulding" inline><Toggle checked={spec.cabinets.crown} onChange={(v) => patch((s) => ({ ...s, cabinets: { ...s.cabinets, crown: v } }))} label="Crown moulding" /></Field>
      <Field label="Counter overhang" hint={spec.countertop.overhangIn == null ? 'Auto — 1.5" past the doors' : 'Past the cabinet doors'}>
        <OverrideSlider value={spec.countertop.overhangIn ?? null} fallback={1.5} min={0.5} max={3} step={0.25} format={(v) => `${Math.round(v * 4) / 4}"`} onChange={(v) => patch((s) => ({ ...s, countertop: { ...s.countertop, overhangIn: v } }))} ariaLabel="Counter overhang" />
      </Field>
      {!uppersToCeiling && (
        <>
          <Field label="Upper cabinet height" hint="The room's wall cabinets"><Slider value={spec.cabinets.upperHeightIn} min={12} max={48} step={3} onChange={(v) => patch((s) => ({ ...s, cabinets: { ...s.cabinets, upperHeightIn: v } }))} format={fmtIn} ariaLabel="Upper cabinet height" /></Field>
          {spec.runs.filter((r) => r.hasUppers).map((r) => (
            <Field key={r.id} label={`${WALL_LABEL[r.wall]} uppers`} hint={r.upperHeightIn == null ? `Room default (${fmtIn(spec.cabinets.upperHeightIn)})` : 'This run only'}>
              <OverrideSlider value={r.upperHeightIn} fallback={spec.cabinets.upperHeightIn} min={12} max={60} step={3} format={fmtIn} onChange={(v) => patch((s) => ({ ...s, runs: s.runs.map((q) => (q.id === r.id ? { ...q, upperHeightIn: v } : q)) }))} ariaLabel={`${WALL_LABEL[r.wall]} upper height`} />
            </Field>
          ))}
        </>
      )}
      {spec.runs.filter((r) => r.hasUppers).map((r) => <div key={`${r.id}-elevation`}>
        <Field label={`${WALL_LABEL[r.wall]} upper underside`} hint="Height above the floor; set this for a row above a window">
          <OverrideSlider value={r.upperBottomIn ?? null} fallback={spec.cabinets.baseHeightIn + spec.countertop.thicknessIn + 18} min={spec.cabinets.baseHeightIn + spec.countertop.thicknessIn + 1} max={Math.max(spec.cabinets.baseHeightIn + spec.countertop.thicknessIn + 1, spec.dims.ceilingFt * 12 - 12)} step={0.5} format={fmtHalfIn} onChange={(v) => patch((s) => ({ ...s, runs: s.runs.map((q) => q.id === r.id ? { ...q, upperBottomIn: v } : q) }))} ariaLabel={`${WALL_LABEL[r.wall]} upper underside`} />
        </Field>
        {uppersToCeiling && r.upperBottomIn != null && <Field label={`${WALL_LABEL[r.wall]} upper height`} hint="Height of this raised row">
          <OverrideSlider value={r.upperHeightIn} fallback={spec.cabinets.upperHeightIn} min={12} max={60} step={0.5} format={fmtHalfIn} onChange={(v) => patch((s) => ({ ...s, runs: s.runs.map((q) => q.id === r.id ? { ...q, upperHeightIn: v } : q) }))} ariaLabel={`${WALL_LABEL[r.wall]} upper height`} />
        </Field>}
      </div>)}

      {/* A stacked row is TWO rows of boxes with a rail between them, so it is a
          per-run switch, not a per-cabinet one: the toggle mirrors tier 1's
          widths into tier 2 (deriveUppers2) and the height slider splits the
          row. Off is one tier, which is what every spec drew before uppers2. */}
      {spec.runs.filter((r) => r.hasUppers).map((r) => {
        const rowIn = rowHeightIn(spec, r);
        const stacked = hasUppers2(r);
        return (
          <div key={`stack-${r.id}`}>
            <Field
              label={`${WALL_LABEL[r.wall]} stacked uppers`}
              hint={rowIn < STACK_MIN_ROW_IN ? `A ${fmtIn(rowIn)} row is too short for two tiers` : stacked ? 'A shorter transom tier over the doors' : 'One tier of wall cabinets'}
              inline
            >
              <Toggle
                checked={stacked}
                disabled={rowIn < STACK_MIN_ROW_IN}
                label={`Stacked uppers on the ${r.wall} run`}
                onChange={(v) => patch((s) => ({
                  ...s,
                  runs: s.runs.map((q) => (q.id === r.id ? { ...q, uppers2: v ? deriveUppers2(q.uppers) : null, uppers2HeightIn: v ? q.uppers2HeightIn ?? null : null } : q)),
                }))}
              />
            </Field>
            {stacked && (
              <Field label={`${WALL_LABEL[r.wall]} transom height`} hint={r.uppers2HeightIn == null ? `Auto — ${fmtIn(resolveUppers2HeightIn(rowIn, r))} of a ${fmtIn(rowIn)} row` : 'Top tier, measured down from the crown'}>
                <OverrideSlider
                  value={r.uppers2HeightIn ?? null}
                  fallback={resolveUppers2HeightIn(rowIn, r)}
                  min={TIER2_MIN_IN}
                  max={Math.min(TIER2_MAX_IN, Math.max(TIER2_MIN_IN, Math.round(rowIn - TIER1_TARGET_IN)))}
                  step={1}
                  format={fmtIn}
                  onChange={(v) => patch((s) => ({ ...s, runs: s.runs.map((q) => (q.id === r.id ? { ...q, uppers2HeightIn: v } : q)) }))}
                  ariaLabel={`${WALL_LABEL[r.wall]} transom height`}
                />
              </Field>
            )}
          </div>
        );
      })}

      {/* runs[].uppers[].heightIn and runs[].tall[].toCeiling have no controls on
          purpose: the analyzer and the fitter write them, and a per-cabinet
          editor would be a second, contradictory way to draw the same row. */}
      <SectionTitle>Appliances</SectionTitle>
      {spec.appliances.length === 0 && <div className="mb-1 text-[11.5px] text-dim">None in the spec.</div>}
      {spec.appliances.map((a, i) => {
        const setApp = (p: Partial<Appliance>) => patch((s) => ({ ...s, appliances: s.appliances.map((q, j) => (j === i ? { ...q, ...p } : q)) }));
        const [wLo, wHi] = APPLIANCE_WIDTH[a.kind] ?? [12, 66];
        const detail = [
          a.wall === 'island' ? 'island' : `${a.wall} wall`,
          words(a.bodyFinish ?? a.finish),
          a.kind === 'hood' && a.hoodShape ? HOOD_SHAPE_LABEL[a.hoodShape] : a.kind === 'fridge' && a.fridgeStyle ? words(a.fridgeStyle) : null,
        ].filter(Boolean).join(' · ');
        const fridgeDefault = a.fridgeStyle === 'built-in' ? 84 : 70;
        const mouthDefault = a.wall === 'island' ? 32 : 30;
        // the duct cover runs to the ceiling unless a height is given: ceiling − 36" counter − the mouth
        const hoodDefault = Math.max(12, Math.round(spec.dims.ceilingFt * 12 - 36 - (a.aboveCounterIn ?? mouthDefault)));
        // a hood with a cabinet on it ends at that cabinet's underside, so its
        // height reads as the canopy alone rather than a run to the ceiling
        const cabAbove = a.kind === 'hood' ? resolveCabinetAbove(a, a.wall !== 'island' && spec.runs.some((r) => r.wall === a.wall && r.hasUppers)) : 'none';
        const canopyOnly = cabAbove !== 'none';
        const hoodHeightFallback = canopyOnly ? CANOPY_IN[resolveHoodShape(a)] : hoodDefault;
        return (
          <div key={`${a.kind}-${i}`} className="mb-2 rounded-[var(--radius-sm)] border border-border p-2.5">
            <div className="text-[12px] text-muted">{APPLIANCE_LABEL[a.kind] ?? a.kind}<span className="text-dim"> · {detail}</span></div>
            <Field label="Width"><Slider value={a.widthIn} min={wLo} max={wHi} step={1} onChange={(v) => setApp({ widthIn: v })} format={fmtIn} ariaLabel={`${APPLIANCE_LABEL[a.kind]} width`} /></Field>
            {a.kind === 'fridge' && (
              <Field label="Height" hint={a.heightIn == null ? `Default for a ${words(a.fridgeStyle) || 'french door'} (${fmtIn(fridgeDefault)})` : 'Body, floor to top'}>
                <OverrideSlider value={a.heightIn ?? null} fallback={fridgeDefault} min={60} max={96} step={1} format={fmtIn} onChange={(v) => setApp({ heightIn: v })} ariaLabel="Fridge height" />
              </Field>
            )}
            {a.kind === 'hood' && a.hoodShape !== 'slim' && (
              <>
                <Field label="Mouth above counter" hint={a.aboveCounterIn == null ? `Default ${fmtIn(mouthDefault)}` : 'Underside of the canopy'}>
                  <OverrideSlider value={a.aboveCounterIn ?? null} fallback={mouthDefault} min={20} max={48} step={1} format={fmtIn} onChange={(v) => setApp({ aboveCounterIn: v })} ariaLabel="Hood mouth height" />
                </Field>
                <Field label="Hood height" hint={canopyOnly ? (a.heightIn == null ? 'Canopy only (the cabinet sits on it)' : 'Canopy plus visible duct cover; the cabinet sits on top') : a.heightIn == null ? 'Duct cover runs to the ceiling' : 'Canopy plus duct cover'}>
                  <OverrideSlider value={a.heightIn ?? null} fallback={hoodHeightFallback} min={12} max={96} step={1} format={fmtIn} onChange={(v) => setApp({ heightIn: v })} ariaLabel="Hood height" />
                </Field>
                <Field label="Cabinet above" hint={a.cabinetAbove == null ? `Auto: ${CABINET_ABOVE_LABEL[cabAbove]}` : 'What sits on the canopy up to the crown'}>
                  <Select<CabinetAbove | 'auto'>
                    value={a.cabinetAbove ?? 'auto'}
                    options={[{ value: 'auto', label: 'Auto' }, ...CABINET_ABOVE.map((v) => ({ value: v, label: CABINET_ABOVE_LABEL[v] }))]}
                    onChange={(v) => setApp({ cabinetAbove: v === 'auto' ? null : v })}
                    className="w-full"
                    ariaLabel="Cabinet above hood"
                  />
                </Field>
              </>
            )}
          </div>
        );
      })}

      <SectionTitle>Backsplash</SectionTitle>
      <Field label="Backsplash" inline><Toggle checked={spec.backsplash.present} onChange={(v) => patch((s) => ({ ...s, backsplash: { ...s.backsplash, present: v } }))} label="Backsplash" /></Field>
      {spec.backsplash.present && (
        <>
          <Field label="Height">
            <Segmented<KitchenSpec['backsplash']['height']>
              size="sm"
              value={spec.backsplash.height}
              options={[{ value: 'ledge', label: 'Ledge' }, { value: 'standard', label: 'Standard' }, { value: 'full-height', label: 'Full height' }]}
              // picking a category hands the height back to the category rule.
              // Leaving a measured heightIn behind would draw and price that
              // number while the buttons said something else.
              onChange={(v) => patch((s) => ({ ...s, backsplash: { ...s.backsplash, height: v, heightIn: null } }))}
            />
          </Field>
          <Field label="Height in inches" hint={spec.backsplash.heightIn == null ? 'Auto — from the category above' : 'Measured from the counter'}>
            <OverrideSlider
              value={spec.backsplash.heightIn ?? null}
              fallback={spec.backsplash.height === 'ledge' ? 6 : spec.backsplash.height === 'full-height' ? Math.round(spec.dims.ceilingFt * 12 - 38) : 18}
              min={4}
              max={Math.max(12, Math.round(spec.dims.ceilingFt * 12 - 38))}
              step={1}
              format={fmtIn}
              // patchSpec writes straight to the store with no reconcile, so the
              // category word is derived here by reconcile.ts's own ladder —
              // otherwise the label and the bid quote a height nobody drew.
              onChange={(v) => patch((s) => ({ ...s, backsplash: { ...s.backsplash, heightIn: v, height: v == null ? s.backsplash.height : backsplashHeightWord(v) } }))}
              ariaLabel="Backsplash height"
            />
          </Field>
          {spec.backsplash.height === 'full-height' && spec.backsplash.heightIn == null && <div className="mb-1 text-[11px] text-dim">Full height runs to the underside of the wall cabinets, and to the ceiling where a run has none.</div>}
          {spec.runs.map((r, i) => (
            <Field key={r.id} label={`${WALL_LABEL[r.wall]} run`} hint={i === 0 && spec.runs.length > 1 ? 'Backsplash on this run' : undefined} inline>
              <Toggle checked={r.backsplash !== false} onChange={(v) => patch((s) => ({ ...s, runs: s.runs.map((q) => (q.id === r.id ? { ...q, backsplash: v } : q)) }))} label={`Backsplash on the ${r.wall} run`} />
            </Field>
          ))}
        </>
      )}

      <SectionTitle>Lighting</SectionTitle>
      {/* The one other place a stepper writes a field nobody pointed at: the
          hook list has to hold exactly `count` entries, so changing the count
          throws the hand-placed ones away. That is the right behaviour and it
          is not reversible, so it is said BEFORE the + is pressed rather than
          discovered after — the hint only appears while there is something to
          lose. */}
      <Field label="Pendants" hint={pendants?.positions ? 'Changing the count clears the hooks placed by hand below' : 'Over the island or peninsula'} inline>
        <Stepper value={spec.lighting.pendants?.count ?? 0} min={0} max={6} ariaLabel="Pendant count" onChange={(n) => patch((s) => ({
          ...s,
          // changing the count invalidates an explicit hook list — the two
          // spellings of the row must never disagree (the reconciler nulls it too)
          lighting: { ...s.lighting, pendants: n === 0 ? null : { count: n, style: s.lighting.pendants?.style ?? 'globe', finish: s.lighting.pendants?.finish ?? 'brass', spreadFt: s.lighting.pendants?.spreadFt ?? 0, offsetFt: s.lighting.pendants?.offsetFt ?? 0, aboveCounterIn: s.lighting.pendants?.aboveCounterIn ?? 0, positions: (s.lighting.pendants?.positions?.length ?? n) === n ? s.lighting.pendants?.positions ?? null : null } },
        }))} />
      </Field>
      {pendants && (
        <>
          {pendants.count > 1 && !pendants.positions && (
            <Field label="Pendant spread" hint={pendants.spreadFt > 0 ? 'First to last, centre to centre' : 'Auto — 62% of the island'}>
              <OverrideSlider value={pendants.spreadFt > 0 ? pendants.spreadFt : null} fallback={island.present ? Math.round(island.lengthFt * 0.62 * 2) / 2 : 3} min={1} max={12} step={0.5} format={fmtFt} onChange={(v) => setPendants({ spreadFt: v ?? 0 })} ariaLabel="Pendant spread" />
            </Field>
          )}
          {!pendants.positions && <Field label="Pendant offset" hint="Shift along the island, + toward the right end"><Slider value={pendants.offsetFt} min={-4} max={4} step={0.25} onChange={(v) => setPendants({ offsetFt: v })} format={fmtFtSigned} ariaLabel="Pendant offset" /></Field>}
          <Field label="Place individually" hint={pendants.positions ? 'One hook per pendant, feet from the island centre' : 'An evenly spaced row over the island'} inline>
            <Toggle
              checked={!!pendants.positions}
              label="Place pendants individually"
              onChange={(v) => setPendants({
                positions: v
                  ? Array.from({ length: Math.max(1, pendants.count) }, (_, i) => {
                      const span = pendants.spreadFt || (island.present ? island.lengthFt * 0.62 : 3);
                      const n = Math.max(1, pendants.count);
                      return { alongFt: Math.round((pendants.offsetFt + (n === 1 ? 0 : (i - (n - 1) / 2) * (span / (n - 1)))) * 100) / 100, acrossFt: 0 };
                    })
                  : null,
              })}
            />
          </Field>
          {pendants.positions?.map((q, i) => (
            <Card key={`pendant-${i}`} title={`Pendant ${i + 1}`} onRemove={() => setPendants({ positions: (pendants.positions ?? []).filter((_, j) => j !== i), count: Math.max(0, pendants.count - 1) })}>
              <Field label="Along the island" hint="+ toward the right end">
                <Slider value={q.alongFt} min={-(island.lengthFt / 2 + 2)} max={island.lengthFt / 2 + 2} step={0.25} onChange={(v) => setPendants({ positions: (pendants.positions ?? []).map((r, j) => (j === i ? { ...r, alongFt: v } : r)) })} format={fmtFtSigned} ariaLabel={`Pendant ${i + 1} along`} />
              </Field>
              <Field label="Across the island" hint="+ toward the stool side">
                <Slider value={q.acrossFt} min={-3} max={3} step={0.25} onChange={(v) => setPendants({ positions: (pendants.positions ?? []).map((r, j) => (j === i ? { ...r, acrossFt: v } : r)) })} format={fmtFtSigned} ariaLabel={`Pendant ${i + 1} across`} />
              </Field>
            </Card>
          ))}
          <Field label="Pendant height" hint={pendants.aboveCounterIn > 0 ? 'Shade bottom above the counter' : 'Auto — 32" above the counter'}>
            <OverrideSlider value={pendants.aboveCounterIn > 0 ? pendants.aboveCounterIn : null} fallback={32} min={18} max={48} step={1} format={fmtIn} onChange={(v) => setPendants({ aboveCounterIn: v ?? 0 })} ariaLabel="Pendant height" />
          </Field>
        </>
      )}
      <Field label="Recessed cans" inline><Stepper value={spec.lighting.recessedCount} min={0} max={16} onChange={(n) => patch((s) => ({ ...s, lighting: { ...s.lighting, recessedCount: n } }))} ariaLabel="Recessed count" /></Field>
      <Field label="Under-cabinet lighting" inline><Toggle checked={spec.lighting.underCabinet} onChange={(v) => patch((s) => ({ ...s, lighting: { ...s.lighting, underCabinet: v } }))} label="Under-cabinet lighting" /></Field>

      <DecorControls decor={decor} room="kitchen" spec={spec} onChange={(fn) => patch((s) => ({ ...s, decor: fn(s.decor ?? emptyDecor()) }))} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Bathroom
// ---------------------------------------------------------------------------

/**
 * Most of the bathroom contract's new fields mean "let the scene decide" when
 * they are null, so a control for one of them has to be able to say Auto as
 * well as a value — otherwise opening the Layout tab would silently pin every
 * field the analyzer deliberately left open.
 *
 * `AutoSelect` puts Auto at the top of a normal picker. `AutoSlider` shows the
 * value the scene would use, greyed and labelled Auto, until the user moves
 * it; a Reset link puts it back to null.
 */
const AUTO = '__auto__';

/** the option lists the bathroom controls share, in the schema's own order */
const FIXTURE_FINISH_OPTIONS: Array<{ value: NonNullable<BathroomSpec['shower']['hardwareFinish']>; label: string }> = [
  { value: 'chrome', label: 'Chrome' }, { value: 'brushed-nickel', label: 'Brushed nickel' }, { value: 'polished-nickel', label: 'Polished nickel' },
  { value: 'matte-black', label: 'Matte black' }, { value: 'brushed-gold', label: 'Brushed gold' }, { value: 'polished-brass', label: 'Polished brass' },
  { value: 'oil-rubbed-bronze', label: 'Oil-rubbed bronze' }, { value: 'stainless', label: 'Stainless' }, { value: 'white', label: 'White' }, { value: 'black', label: 'Black' },
];
const TILE_PATTERN_OPTIONS: Array<{ value: NonNullable<BathroomSpec['wallTile']['pattern']>; label: string }> = [
  { value: 'stacked', label: 'Stacked' }, { value: 'running-bond', label: 'Running bond' }, { value: 'vertical-stack', label: 'Vertical stack' },
  { value: 'herringbone', label: 'Herringbone' }, { value: 'chevron', label: 'Chevron' }, { value: 'basketweave', label: 'Basketweave' },
  { value: 'hex', label: 'Hex' }, { value: 'penny', label: 'Penny round' }, { value: 'mosaic', label: 'Mosaic' },
  { value: 'large-format', label: 'Large format' }, { value: 'slab', label: 'Slab (no grout)' },
];
/** the value is `wxh` in inches, so it parses straight back into a module with no table in between */
const TILE_MODULE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '3x6', label: '3 × 6 subway' }, { value: '4x12', label: '4 × 12 subway' }, { value: '2x8', label: '2 × 8 subway' },
  { value: '4x4', label: '4 × 4 square' }, { value: '2x2', label: '2 in hex / mosaic' }, { value: '12x24', label: '12 × 24' },
  { value: '24x24', label: '24 × 24' }, { value: '24x48', label: '24 × 48 panel' },
];
/** the seed an "add one" control writes; the reconciler fits it to the room afterwards */
const DEFAULT_NICHE: NonNullable<BathroomSpec['shower']['nicheAt']> = { face: 'back', t: 0.5, centerIn: 48, widthIn: 24, heightIn: 14, shelves: 1 };
const DEFAULT_ACCENT: NonNullable<BathroomSpec['wallTile']['accent']> = { wall: 'back', pattern: 'herringbone', moduleIn: null, heightIn: null, colorHex: null };

function AutoSelect<T extends string>({ value, options, onChange, autoLabel = 'Auto', ariaLabel }: {
  value: T | null | undefined;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T | null) => void;
  autoLabel?: string;
  ariaLabel: string;
}) {
  return (
    <Select<string>
      value={value ?? AUTO}
      options={[{ value: AUTO, label: autoLabel }, ...options]}
      onChange={(v) => onChange(v === AUTO ? null : (v as T))}
      className="w-full"
      ariaLabel={ariaLabel}
    />
  );
}

function AutoSlider({ value, auto, min, max, step, onChange, format, ariaLabel }: {
  value: number | null | undefined;
  /** what the scene uses when the field is null — shown while it is */
  auto: number;
  min: number; max: number; step: number;
  onChange: (v: number | null) => void;
  format: (v: number) => string;
  ariaLabel: string;
}) {
  const isAuto = typeof value !== 'number';
  return (
    <div className="flex items-center gap-2">
      <div className={cx('min-w-0 flex-1', isAuto && 'opacity-55')}>
        <Slider value={isAuto ? auto : value} min={min} max={max} step={step} onChange={onChange} format={format} ariaLabel={ariaLabel} />
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-sm shrink-0"
        onClick={() => onChange(isAuto ? auto : null)}
        aria-label={`${ariaLabel}: ${isAuto ? 'set a value' : 'back to auto'}`}
      >
        {isAuto ? 'Auto' : 'Reset'}
      </button>
    </div>
  );
}

function BathroomControls({ spec }: { spec: BathroomSpec }) {
  const patchSpec = useProjectStore((s) => s.patchSpec);
  const patch = (fn: (s: BathroomSpec) => BathroomSpec) => patchSpec((s) => (s.roomType === 'bathroom' ? fn(s) : s));
  const decor = spec.decor ?? emptyDecor();
  const accessories = spec.accessories ?? [];
  const setAcc = (i: number, p: Partial<BathAccessory>) => patch((s) => ({
    ...s,
    accessories: (s.accessories ?? []).map((a, j) => (j === i ? { ...a, ...p } : a)),
  }));
  return (
    <>
      <SectionTitle>Room</SectionTitle>
      {spec.scanGeometry ? <p className="mb-4 text-xs leading-relaxed text-muted">Scanned walls are fixed to the capture. New fixture layouts need a clearance check against the actual room outline.</p> : <>
      <Field label="Width"><Slider value={spec.dims.widthFt} min={4} max={18} step={0.5} onChange={(v) => patch((s) => ({ ...s, dims: { ...s.dims, widthFt: v } }))} format={fmtFt} ariaLabel="Room width" /></Field>
      <Field label="Depth"><Slider value={spec.dims.depthFt} min={4} max={18} step={0.5} onChange={(v) => patch((s) => ({ ...s, dims: { ...s.dims, depthFt: v } }))} format={fmtFt} ariaLabel="Room depth" /></Field>
      <Field label="Ceiling height"><Slider value={spec.dims.ceilingFt} min={7.5} max={12} step={0.25} onChange={(v) => patch((s) => ({ ...s, dims: { ...s.dims, ceilingFt: v } }))} format={fmtFt} ariaLabel="Ceiling height" /></Field>

      </>}

      <SectionTitle>Vanity</SectionTitle>
      <Field label="Vanity" inline><Toggle checked={spec.vanity.present} onChange={(v) => patch((s) => ({ ...s, vanity: { ...s.vanity, present: v } }))} label="Vanity" /></Field>
      {spec.vanity.present && (
        <>
          <Field label="Width"><Slider value={spec.vanity.widthIn} min={24} max={96} step={6} onChange={(v) => patch((s) => ({ ...s, vanity: { ...s.vanity, widthIn: v, sinks: v < 48 ? 1 : s.vanity.sinks } }))} format={fmtIn} ariaLabel="Vanity width" /></Field>
          <Field label="Sinks" inline>
            <Segmented<'1' | '2'> size="sm" value={String(spec.vanity.sinks) as '1' | '2'} options={[{ value: '1', label: 'Single' }, { value: '2', label: 'Double' }]} onChange={(v) => patch((s) => ({ ...s, vanity: { ...s.vanity, sinks: v === '2' ? 2 : 1, widthIn: v === '2' ? Math.max(s.vanity.widthIn, 60) : s.vanity.widthIn } }))} ariaLabel="Vanity sinks" />
          </Field>
          <Field label="Style"><Select<BathroomSpec['vanity']['style']> value={spec.vanity.style} options={[{ value: 'floating', label: 'Floating' }, { value: 'freestanding', label: 'Freestanding' }, { value: 'furniture', label: 'Furniture style' }, { value: 'console', label: 'Console' }, { value: 'pedestal', label: 'Pedestal' }]} onChange={(v) => patch((s) => ({ ...s, vanity: { ...s.vanity, style: v } }))} className="w-full" ariaLabel="Vanity style" /></Field>
          <Field label="Mirror"><Select<BathroomSpec['vanity']['mirror']> value={spec.vanity.mirror} options={[{ value: 'single', label: 'Single' }, { value: 'double', label: 'Double' }, { value: 'full-width', label: 'Full width' }, { value: 'medicine-cabinet', label: 'Medicine cabinet' }, { value: 'none', label: 'None' }]} onChange={(v) => patch((s) => ({ ...s, vanity: { ...s.vanity, mirror: v } }))} className="w-full" ariaLabel="Mirror" /></Field>
          <Field label="Drawers" hint="Drawer stacks across the front. Auto works it out from the width and the sink count.">
            <AutoSlider value={spec.vanity.drawers} auto={2} min={0} max={8} step={1} onChange={(v) => patch((s) => ({ ...s, vanity: { ...s.vanity, drawers: v } }))} format={(v) => String(Math.round(v))} ariaLabel="Vanity drawers" />
          </Field>
          <Field label="Doors" hint="Hinged doors across the front.">
            <AutoSlider value={spec.vanity.doors} auto={2} min={0} max={6} step={1} onChange={(v) => patch((s) => ({ ...s, vanity: { ...s.vanity, doors: v } }))} format={(v) => String(Math.round(v))} ariaLabel="Vanity doors" />
          </Field>
          <Field label="Legs">
            <AutoSelect<NonNullable<BathroomSpec['vanity']['legStyle']>>
              value={spec.vanity.style === 'floating' ? 'none' : spec.vanity.legStyle}
              options={[{ value: 'none', label: 'None (toe kick)' }, { value: 'tapered', label: 'Tapered' }, { value: 'turned', label: 'Turned' }, { value: 'square', label: 'Square' }, { value: 'hairpin', label: 'Hairpin' }, { value: 'plinth', label: 'Plinth' }]}
              onChange={(v) => patch((s) => ({ ...s, vanity: { ...s.vanity, legStyle: v } }))}
              ariaLabel="Vanity leg style"
            />
          </Field>
          <Field label="Basin">
            <AutoSelect<NonNullable<BathroomSpec['vanity']['basin']>>
              value={spec.vanity.basin}
              options={[{ value: 'undermount', label: 'Undermount' }, { value: 'integrated', label: 'Integrated' }, { value: 'vessel', label: 'Vessel' }, { value: 'semi-recessed', label: 'Semi-recessed' }, { value: 'drop-in', label: 'Drop-in' }]}
              onChange={(v) => patch((s) => ({ ...s, vanity: { ...s.vanity, basin: v } }))}
              ariaLabel="Basin type"
            />
          </Field>
          <Field label="Tap mount">
            <AutoSelect<NonNullable<BathroomSpec['vanity']['faucetMount']>>
              value={spec.vanity.faucetMount}
              options={[{ value: 'deck', label: 'On the top' }, { value: 'wall', label: 'Wall-mounted' }, { value: 'widespread', label: 'Widespread' }, { value: 'centerset', label: 'Centerset' }, { value: 'single-hole', label: 'Single hole' }]}
              onChange={(v) => patch((s) => ({ ...s, vanity: { ...s.vanity, faucetMount: v } }))}
              ariaLabel="Faucet mount"
            />
          </Field>
          <Field label="Top thickness">
            <AutoSlider value={spec.vanity.counterThicknessIn} auto={1.25} min={0.5} max={4} step={0.25} onChange={(v) => patch((s) => ({ ...s, vanity: { ...s.vanity, counterThicknessIn: v } }))} format={fmtIn} ariaLabel="Vanity top thickness" />
          </Field>
          <Field label="Top height">
            <AutoSlider value={spec.vanity.heightIn} auto={36} min={28} max={40} step={0.5} onChange={(v) => patch((s) => ({ ...s, vanity: { ...s.vanity, heightIn: v } }))} format={fmtIn} ariaLabel="Vanity top height" />
          </Field>
          <Field label="Depth">
            <AutoSlider value={spec.vanity.depthIn} auto={21} min={14} max={26} step={1} onChange={(v) => patch((s) => ({ ...s, vanity: { ...s.vanity, depthIn: v } }))} format={fmtIn} ariaLabel="Vanity depth" />
          </Field>
          <Field label="Splash">
            <AutoSelect<NonNullable<BathroomSpec['vanity']['backsplash']>>
              value={spec.vanity.backsplash}
              options={[{ value: 'none', label: 'None' }, { value: 'standard', label: '4 in upstand' }, { value: 'full-height', label: 'Full height to the mirror' }, { value: 'integrated', label: 'Integrated (one piece)' }]}
              onChange={(v) => patch((s) => ({ ...s, vanity: { ...s.vanity, backsplash: v } }))}
              ariaLabel="Vanity backsplash"
            />
          </Field>
          <Field label="Hardware">
            <AutoSelect<NonNullable<BathroomSpec['vanity']['hardware']>>
              value={spec.vanity.hardware}
              options={[{ value: 'pulls', label: 'Pulls' }, { value: 'knobs', label: 'Knobs' }, { value: 'mixed', label: 'Mixed' }, { value: 'integrated', label: 'Integrated finger pull' }, { value: 'none', label: 'None' }]}
              onChange={(v) => patch((s) => ({ ...s, vanity: { ...s.vanity, hardware: v } }))}
              ariaLabel="Vanity hardware"
            />
          </Field>
          {spec.vanity.style === 'floating' && (
            <Field label="Open shelf under" inline>
              <Toggle checked={Boolean(spec.vanity.openShelf)} onChange={(v) => patch((s) => ({ ...s, vanity: { ...s.vanity, openShelf: v } }))} label="Open shelf" />
            </Field>
          )}
        </>
      )}

      <SectionTitle>Shower</SectionTitle>
      <Field label="Shower" inline><Toggle checked={spec.shower.present} onChange={(v) => patch((s) => ({ ...s, shower: { ...s.shower, present: v } }))} label="Shower" /></Field>
      {spec.shower.present && (
        <>
          <Field label="Enclosure"><Select<BathroomSpec['shower']['enclosure']> value={spec.shower.enclosure} options={[{ value: 'frameless-glass', label: 'Frameless glass' }, { value: 'framed-glass', label: 'Framed glass' }, { value: 'curtain', label: 'Curtain' }, { value: 'open', label: 'Open / wet room' }, { value: 'tub-shower', label: 'Tub + shower' }]} onChange={(v) => patch((s) => ({ ...s, shower: { ...s.shower, enclosure: v } }))} className="w-full" ariaLabel="Shower enclosure" /></Field>
          <Field label="Width"><Slider value={spec.shower.widthIn} min={30} max={84} step={2} onChange={(v) => patch((s) => ({ ...s, shower: { ...s.shower, widthIn: v } }))} format={fmtIn} ariaLabel="Shower width" /></Field>
          <Field label="Depth"><Slider value={spec.shower.depthIn} min={30} max={60} step={2} onChange={(v) => patch((s) => ({ ...s, shower: { ...s.shower, depthIn: v } }))} format={fmtIn} ariaLabel="Shower depth" /></Field>
          <Field label="Niche" inline><Toggle checked={spec.shower.niche} onChange={(v) => patch((s) => ({ ...s, shower: { ...s.shower, niche: v } }))} label="Niche" /></Field>
          <Field label="Bench" inline><Toggle checked={spec.shower.bench} onChange={(v) => patch((s) => ({ ...s, shower: { ...s.shower, bench: v } }))} label="Bench" /></Field>
          <Field label="Curbless entry" inline><Toggle checked={spec.shower.curbless} onChange={(v) => patch((s) => ({ ...s, shower: { ...s.shower, curbless: v } }))} label="Curbless" /></Field>
          <Field label="Door">
            <AutoSelect<NonNullable<BathroomSpec['shower']['doorType']>>
              value={spec.shower.doorType}
              options={[{ value: 'hinged', label: 'Hinged' }, { value: 'sliding', label: 'Sliding' }, { value: 'barn', label: 'Barn / rollers' }, { value: 'pivot', label: 'Pivot' }, { value: 'fixed-panel', label: 'Fixed panel' }, { value: 'walk-in', label: 'Walk-in (no panel)' }, { value: 'none', label: 'None' }]}
              onChange={(v) => patch((s) => ({ ...s, shower: { ...s.shower, doorType: v } }))}
              ariaLabel="Shower door type"
            />
          </Field>
          <Field label="Glass" hint="3/8 in reads as true frameless; 1/4 in is a framed or sliding panel.">
            <AutoSlider value={spec.shower.glassThicknessIn} auto={0.375} min={0.125} max={0.625} step={0.0625} onChange={(v) => patch((s) => ({ ...s, shower: { ...s.shower, glassThicknessIn: v } }))} format={(v) => `${v}"`} ariaLabel="Shower glass thickness" />
          </Field>
          <Field label="Door hardware">
            <AutoSelect<NonNullable<BathroomSpec['shower']['hardwareFinish']>>
              value={spec.shower.hardwareFinish}
              options={FIXTURE_FINISH_OPTIONS}
              onChange={(v) => patch((s) => ({ ...s, shower: { ...s.shower, hardwareFinish: v } }))}
              autoLabel="Match the room"
              ariaLabel="Shower hardware finish"
            />
          </Field>
          {!spec.shower.curbless && (
            <Field label="Curb height">
              <AutoSlider value={spec.shower.curbHeightIn} auto={4} min={0} max={10} step={0.5} onChange={(v) => patch((s) => ({ ...s, shower: { ...s.shower, curbHeightIn: v } }))} format={fmtIn} ariaLabel="Shower curb height" />
            </Field>
          )}
          {spec.shower.bench && (
            <Field label="Bench shape">
              <AutoSelect<NonNullable<BathroomSpec['shower']['benchStyle']>>
                value={spec.shower.benchStyle}
                options={[{ value: 'corner', label: 'Corner' }, { value: 'full-width', label: 'Full width' }, { value: 'floating', label: 'Floating slab' }]}
                onChange={(v) => patch((s) => ({ ...s, shower: { ...s.shower, benchStyle: v } }))}
                ariaLabel="Shower bench style"
              />
            </Field>
          )}
          {spec.shower.niche && (
            <>
              <Field label="Niche wall" hint="Seen standing in the stall: back is the wall opposite the door.">
                <AutoSelect<'back' | 'left' | 'right'>
                  value={spec.shower.nicheAt?.face}
                  options={[{ value: 'back', label: 'Back of the stall' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]}
                  onChange={(v) => patch((s) => ({ ...s, shower: { ...s.shower, nicheAt: v ? { ...(s.shower.nicheAt ?? DEFAULT_NICHE), face: v } : null } }))}
                  ariaLabel="Niche face"
                />
              </Field>
              {spec.shower.nicheAt && (
                <>
                  <Field label="Niche width"><Slider value={spec.shower.nicheAt.widthIn} min={8} max={48} step={2} onChange={(v) => patch((s) => ({ ...s, shower: { ...s.shower, nicheAt: { ...(s.shower.nicheAt ?? DEFAULT_NICHE), widthIn: v } } }))} format={fmtIn} ariaLabel="Niche width" /></Field>
                  <Field label="Niche height"><Slider value={spec.shower.nicheAt.heightIn} min={8} max={48} step={2} onChange={(v) => patch((s) => ({ ...s, shower: { ...s.shower, nicheAt: { ...(s.shower.nicheAt ?? DEFAULT_NICHE), heightIn: v } } }))} format={fmtIn} ariaLabel="Niche height" /></Field>
                  <Field label="Niche height off the floor"><Slider value={spec.shower.nicheAt.centerIn} min={24} max={72} step={2} onChange={(v) => patch((s) => ({ ...s, shower: { ...s.shower, nicheAt: { ...(s.shower.nicheAt ?? DEFAULT_NICHE), centerIn: v } } }))} format={fmtIn} ariaLabel="Niche centre height" /></Field>
                  <Field label="Niche shelves"><Slider value={spec.shower.nicheAt.shelves} min={0} max={4} step={1} onChange={(v) => patch((s) => ({ ...s, shower: { ...s.shower, nicheAt: { ...(s.shower.nicheAt ?? DEFAULT_NICHE), shelves: v } } }))} format={(v) => String(Math.round(v))} ariaLabel="Niche shelves" /></Field>
                </>
              )}
            </>
          )}
        </>
      )}

      <SectionTitle>Tub</SectionTitle>
      <Field label="Tub" inline><Toggle checked={spec.tub.present} onChange={(v) => patch((s) => ({ ...s, tub: { ...s.tub, present: v } }))} label="Tub" /></Field>
      {spec.tub.present && (
        <>
          <Field label="Type"><Select<BathroomSpec['tub']['kind']> value={spec.tub.kind} options={[{ value: 'freestanding', label: 'Freestanding' }, { value: 'alcove', label: 'Alcove' }, { value: 'drop-in', label: 'Drop-in' }, { value: 'clawfoot', label: 'Clawfoot' }, { value: 'corner', label: 'Corner' }]} onChange={(v) => patch((s) => ({ ...s, tub: { ...s.tub, kind: v } }))} className="w-full" ariaLabel="Tub type" /></Field>
          {/* the tub's LENGTH had no control at all: the analyzer measured it,
              the estimator prices it and the scene draws it, and the only way
              to correct a 60" read on a 72" tub was to re-run the analysis */}
          <Field label="Length"><Slider value={spec.tub.lengthIn} min={48} max={84} step={2} onChange={(v) => patch((s) => ({ ...s, tub: { ...s.tub, lengthIn: v } }))} format={fmtIn} ariaLabel="Tub length" /></Field>
          <Field label="Made of">
            <AutoSelect<NonNullable<BathroomSpec['tub']['material']>>
              value={spec.tub.material}
              options={[{ value: 'acrylic', label: 'Acrylic' }, { value: 'cast-iron', label: 'Cast iron' }, { value: 'stone-resin', label: 'Stone resin' }, { value: 'solid-surface', label: 'Solid surface' }, { value: 'copper', label: 'Copper' }, { value: 'fiberglass', label: 'Fibreglass' }, { value: 'steel', label: 'Enamelled steel' }, { value: 'wood', label: 'Wood' }]}
              onChange={(v) => patch((s) => ({ ...s, tub: { ...s.tub, material: v } }))}
              ariaLabel="Tub material"
            />
          </Field>
          <Field label="Filler">
            <AutoSelect<NonNullable<BathroomSpec['tub']['fillerType']>>
              value={spec.tub.fillerType}
              options={[{ value: 'floor-mount', label: 'Floor-mounted column' }, { value: 'wall-mount', label: 'Out of the wall' }, { value: 'deck-mount', label: 'On the rim' }, { value: 'roman', label: 'Roman (wide-spread deck)' }, { value: 'tub-shower-diverter', label: 'Tub / shower diverter' }, { value: 'none', label: 'None' }]}
              onChange={(v) => patch((s) => ({ ...s, tub: { ...s.tub, fillerType: v } }))}
              ariaLabel="Tub filler"
            />
          </Field>
          <Field label="Width">
            <AutoSlider value={spec.tub.widthIn} auto={32} min={24} max={48} step={1} onChange={(v) => patch((s) => ({ ...s, tub: { ...s.tub, widthIn: v } }))} format={fmtIn} ariaLabel="Tub width" />
          </Field>
          <Field label="Rim height">
            <AutoSlider value={spec.tub.heightIn} auto={22} min={14} max={30} step={0.5} onChange={(v) => patch((s) => ({ ...s, tub: { ...s.tub, heightIn: v } }))} format={fmtIn} ariaLabel="Tub rim height" />
          </Field>
        </>
      )}

      <SectionTitle>Walls & fixtures</SectionTitle>
      {/* the spread matters: `{ height: v }` used to DROP every other wallTile
          field, so choosing a height silently erased the pattern, the module
          and the accent wall the analyzer had just read off the photo */}
      <Field label="Wall tile"><Select<BathroomSpec['wallTile']['height']> value={spec.wallTile.height} options={[{ value: 'none', label: 'None (paint only)' }, { value: 'shower-only', label: 'Shower only' }, { value: 'wainscot', label: 'Wainscot' }, { value: 'accent-wall', label: 'Accent wall' }, { value: 'full', label: 'Full height' }]} onChange={(v) => patch((s) => ({ ...s, wallTile: { ...s.wallTile, height: v } }))} className="w-full" ariaLabel="Wall tile height" /></Field>
      {spec.wallTile.height !== 'none' && (
        <>
          <Field label="Tile pattern">
            <AutoSelect<NonNullable<BathroomSpec['wallTile']['pattern']>>
              value={spec.wallTile.pattern}
              options={TILE_PATTERN_OPTIONS}
              onChange={(v) => patch((s) => ({ ...s, wallTile: { ...s.wallTile, pattern: v } }))}
              ariaLabel="Wall tile pattern"
            />
          </Field>
          <Field label="Tile size">
            <AutoSelect<string>
              value={spec.wallTile.moduleIn ? `${spec.wallTile.moduleIn.w}x${spec.wallTile.moduleIn.h}` : null}
              options={TILE_MODULE_OPTIONS}
              onChange={(v) => patch((s) => ({ ...s, wallTile: { ...s.wallTile, moduleIn: parseModule(v ?? '') } }))}
              ariaLabel="Wall tile size"
            />
          </Field>
          <Field label="Tile height" hint="Where the field tile stops above the floor.">
            <AutoSlider value={spec.wallTile.heightIn} auto={spec.wallTile.height === 'wainscot' ? 42 : Math.round(spec.dims.ceilingFt * 12)} min={12} max={Math.round(spec.dims.ceilingFt * 12)} step={2} onChange={(v) => patch((s) => ({ ...s, wallTile: { ...s.wallTile, heightIn: v } }))} format={fmtIn} ariaLabel="Wall tile height in inches" />
          </Field>
          <Field label="Grout joint">
            <AutoSlider value={spec.wallTile.groutWidthIn} auto={0.125} min={0} max={0.5} step={0.0625} onChange={(v) => patch((s) => ({ ...s, wallTile: { ...s.wallTile, groutWidthIn: v } }))} format={(v) => `${v}"`} ariaLabel="Grout joint width" />
          </Field>
          <Field label="Top cap">
            <AutoSelect<NonNullable<BathroomSpec['wallTile']['trim']>>
              value={spec.wallTile.trim}
              options={[{ value: 'none', label: 'None' }, { value: 'bullnose', label: 'Bullnose' }, { value: 'pencil', label: 'Pencil moulding' }, { value: 'chair-rail', label: 'Chair rail' }, { value: 'metal-edge', label: 'Metal edge' }]}
              onChange={(v) => patch((s) => ({ ...s, wallTile: { ...s.wallTile, trim: v } }))}
              ariaLabel="Wall tile trim"
            />
          </Field>
          <Field label="Feature wall" hint="One wall done in a different tile from the rest.">
            <AutoSelect<Wall>
              value={spec.wallTile.accent?.wall}
              options={WALL_OPTIONS}
              onChange={(v) => patch((s) => ({ ...s, wallTile: { ...s.wallTile, accent: v ? { ...(s.wallTile.accent ?? DEFAULT_ACCENT), wall: v } : null } }))}
              autoLabel="None"
              ariaLabel="Feature wall"
            />
          </Field>
          {spec.wallTile.accent && (
            <Field label="Feature pattern">
              <AutoSelect<NonNullable<BathroomSpec['wallTile']['pattern']>>
                value={spec.wallTile.accent.pattern}
                options={TILE_PATTERN_OPTIONS}
                onChange={(v) => patch((s) => ({ ...s, wallTile: { ...s.wallTile, accent: { ...(s.wallTile.accent ?? DEFAULT_ACCENT), pattern: v ?? 'stacked' } } }))}
                ariaLabel="Feature wall pattern"
              />
            </Field>
          )}
        </>
      )}
      <Field label="Toilet"><Select<BathroomSpec['toilet']['style']> value={spec.toilet.style} options={[{ value: 'two-piece', label: 'Two-piece' }, { value: 'one-piece', label: 'One-piece' }, { value: 'wall-hung', label: 'Wall-hung' }, { value: 'smart', label: 'Smart / bidet' }]} onChange={(v) => patch((s) => ({ ...s, toilet: { ...s.toilet, style: v } }))} className="w-full" ariaLabel="Toilet style" /></Field>

      <SectionTitle>Towel bars & hooks</SectionTitle>
      <Field label="On the walls" hint={accessories.length ? 'One card per fitting' : 'Nothing on the walls yet'}><span /></Field>
      {accessories.map((a, i) => (
        <Card key={`acc-${i}`} title={`${ACCESSORY_LABEL[a.kind]} ${i + 1}`} onRemove={() => patch((s) => ({ ...s, accessories: (s.accessories ?? []).filter((_, j) => j !== i) }))}>
          <div className="mb-1.5 grid grid-cols-2 gap-1.5">
            <Select<BathAccessory['kind']> value={a.kind} options={ACCESSORY_OPTIONS} onChange={(v) => setAcc(i, { kind: v })} className="w-full" ariaLabel={`Fitting ${i + 1} kind`} />
            <Select<Wall> value={a.wall} options={WALL_OPTIONS} onChange={(v) => setAcc(i, { wall: v })} className="w-full" ariaLabel={`Fitting ${i + 1} wall`} />
          </div>
          <Field label="Position" hint="Along the wall"><Slider value={a.t} min={0.02} max={0.98} step={0.01} onChange={(v) => setAcc(i, { t: v })} format={fmtPct} ariaLabel={`Fitting ${i + 1} position`} /></Field>
          <Field label="Height off the floor"><Slider value={a.heightFt} min={1} max={6.5} step={0.1} onChange={(v) => setAcc(i, { heightFt: v })} format={fmtFt} ariaLabel={`Fitting ${i + 1} height`} /></Field>
          <Field label="Length"><AutoSlider value={a.widthIn} auto={24} min={4} max={42} step={1} onChange={(v) => setAcc(i, { widthIn: v })} format={fmtIn} ariaLabel={`Fitting ${i + 1} length`} /></Field>
          <Field label="Finish">
            <AutoSelect<NonNullable<BathAccessory['finish']>> value={a.finish} options={FIXTURE_FINISH_OPTIONS} onChange={(v) => setAcc(i, { finish: v })} autoLabel="Match the room" ariaLabel={`Fitting ${i + 1} finish`} />
          </Field>
        </Card>
      ))}
      <AddRow label="Add a bar, ring or hook" disabled={accessories.length >= 10} onAdd={() => patch((s) => ({ ...s, accessories: [...(s.accessories ?? []), { ...NEW_ACCESSORY }] }))} />

      <DecorControls decor={decor} room="bathroom" onChange={(fn) => patch((s) => ({ ...s, decor: fn(s.decor ?? emptyDecor()) }))} />
    </>
  );
}

const ACCESSORY_LABEL: Record<BathAccessory['kind'], string> = {
  'towel-bar': 'Towel bar', 'towel-ring': 'Towel ring', hook: 'Hook', 'robe-hook': 'Robe hook',
  'grab-bar': 'Grab bar', 'toilet-paper-holder': 'Paper holder', 'towel-warmer': 'Towel warmer',
  'shower-caddy': 'Shower caddy', 'corner-shelf': 'Corner shelf',
};
const ACCESSORY_OPTIONS: Array<{ value: BathAccessory['kind']; label: string }> =
  (Object.keys(ACCESSORY_LABEL) as BathAccessory['kind'][]).map((k) => ({ value: k, label: ACCESSORY_LABEL[k] }));
const NEW_ACCESSORY: BathAccessory = { kind: 'towel-bar', wall: 'front', t: 0.5, heightFt: 4, widthIn: 24, finish: null };

// ---------------------------------------------------------------------------
// Exterior
// ---------------------------------------------------------------------------

const ROOF_TYPES: Array<{ value: RoofType; label: string }> = [
  { value: 'gable', label: 'Gable' }, { value: 'hip', label: 'Hip' }, { value: 'cross-gable', label: 'Cross gable' }, { value: 'dutch-gable', label: 'Dutch gable' },
  { value: 'shed', label: 'Shed' }, { value: 'flat', label: 'Flat' }, { value: 'gambrel', label: 'Gambrel' },
];

function ExteriorControls({ spec }: { spec: ExteriorSpec }) {
  const patchSpec = useProjectStore((s) => s.patchSpec);
  const patch = (fn: (s: ExteriorSpec) => ExteriorSpec) => patchSpec((s) => (s.roomType === 'exterior' ? fn(s) : s));
  const applyTemplate = (id: ExteriorSpec['houseStyle']) => patch((s) => {
    const tpl = defaultExterior(id);
    const name = HOUSE_TEMPLATES.find((t) => t.id === id)?.name ?? id;
    return {
      ...tpl,
      lot: s.lot,
      materials: s.materials,
      lighting: { ...tpl.lighting, timeOfDay: s.lighting.timeOfDay },
      detected: { ...s.detected, assumptions: [...s.detected.assumptions.filter((a) => !a.startsWith('House massing')), `House massing, roof and elevations use the ${name} template.`] },
    };
  });
  const bays = spec.house.garage.present ? spec.house.garage.bays : 0;
  return (
    <>
      <SectionTitle>House template</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        {HOUSE_TEMPLATES.map((t) => (
          <button key={t.id} type="button" onClick={() => applyTemplate(t.id)} aria-pressed={spec.houseStyle === t.id} className={cx('rounded-[var(--radius-sm)] border p-2.5 text-left transition-colors', spec.houseStyle === t.id ? 'border-brass bg-brass-soft' : 'border-border hover:border-border-strong')}>
            <div className="text-[12.5px] text-ink">{t.name}</div>
            <div className="mt-0.5 text-[10.5px] leading-snug text-muted">{t.blurb}</div>
          </button>
        ))}
      </div>
      <div className="mt-2 text-[11px] text-dim">Applying a template keeps your lot and material choices.</div>

      <SectionTitle>Massing</SectionTitle>
      <Field label="Stories" inline>
        <Segmented<'1' | '2' | '3'> size="sm" value={String(spec.house.stories) as '1' | '2' | '3'} options={[{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }]} onChange={(v) => patch((s) => {
          const stories = Number(v) as 1 | 2 | 3;
          const elevations = s.elevations.map((e) => ({ ...e, windows: e.windows.filter((w) => w.floor < stories) }));
          return { ...s, house: { ...s.house, stories }, elevations };
        })} />
      </Field>
      <Field label="Roof type"><Select<RoofType> value={spec.house.roof.type} options={ROOF_TYPES} onChange={(v) => patch((s) => ({ ...s, house: { ...s.house, roof: { ...s.house.roof, type: v, pitch: v === 'flat' ? 0 : s.house.roof.pitch === 0 ? 6 : s.house.roof.pitch } } }))} className="w-full" ariaLabel="Roof type" /></Field>
      {spec.house.roof.type !== 'flat' && (
        <Field label="Roof pitch" hint="Rise over 12"><Slider value={spec.house.roof.pitch} min={1} max={14} step={1} onChange={(v) => patch((s) => ({ ...s, house: { ...s.house, roof: { ...s.house.roof, pitch: v } } }))} format={fmtPitch} ariaLabel="Roof pitch" /></Field>
      )}
      <Field label="Garage bays" inline><Stepper value={bays} min={0} max={3} onChange={(n) => patch((s) => ({ ...s, house: { ...s.house, garage: { ...s.house.garage, present: n > 0, bays: n as 0 | 1 | 2 | 3 } } }))} ariaLabel="Garage bays" /></Field>
      <Field label="Covered porch" inline><Toggle checked={spec.house.porch.present} onChange={(v) => patch((s) => ({ ...s, house: { ...s.house, porch: { ...s.house.porch, present: v, widthFt: s.house.porch.widthFt || 16, depthFt: s.house.porch.depthFt || 7, columns: s.house.porch.columns || 3, roofed: true } } }))} label="Porch" /></Field>
      <Field label="Rear deck" inline><Toggle checked={spec.house.deck.present} onChange={(v) => patch((s) => ({ ...s, house: { ...s.house, deck: { ...s.house.deck, present: v, widthFt: s.house.deck.widthFt || 16, depthFt: s.house.deck.depthFt || 12 } } }))} label="Deck" /></Field>

      <SectionTitle>Lot & hardscape</SectionTitle>
      <Field label="Lot width"><Slider value={spec.lot.widthFt} min={30} max={200} step={5} onChange={(v) => patch((s) => ({ ...s, lot: { ...s.lot, widthFt: v } }))} format={fmtFt} ariaLabel="Lot width" /></Field>
      <Field label="Lot depth"><Slider value={spec.lot.depthFt} min={40} max={300} step={5} onChange={(v) => patch((s) => ({ ...s, lot: { ...s.lot, depthFt: v } }))} format={fmtFt} ariaLabel="Lot depth" /></Field>
      <Field label="Driveway" inline><Toggle checked={spec.hardscape.driveway.present} onChange={(v) => patch((s) => ({ ...s, hardscape: { ...s.hardscape, driveway: { ...s.hardscape.driveway, present: v } } }))} label="Driveway" /></Field>
      {spec.hardscape.driveway.present && (
        <Field label="Driveway width"><Slider value={spec.hardscape.driveway.widthFt} min={8} max={30} step={1} onChange={(v) => patch((s) => ({ ...s, hardscape: { ...s.hardscape, driveway: { ...s.hardscape.driveway, widthFt: v } } }))} format={fmtFt} ariaLabel="Driveway width" /></Field>
      )}
      <Field label="Fence" inline><Toggle checked={spec.lot.fence.present} onChange={(v) => patch((s) => ({ ...s, lot: { ...s.lot, fence: { ...s.lot.fence, present: v, sides: s.lot.fence.sides.length ? s.lot.fence.sides : ['left', 'right', 'back'] } } }))} label="Fence" /></Field>
      {spec.lot.fence.present && (
        <Field label="Fence height"><Slider value={spec.lot.fence.heightFt} min={3} max={8} step={0.5} onChange={(v) => patch((s) => ({ ...s, lot: { ...s.lot, fence: { ...s.lot.fence, heightFt: v } } }))} format={fmtFt} ariaLabel="Fence height" /></Field>
      )}
      <Field label="Trees" inline><Stepper value={spec.lot.treesCount} min={0} max={12} onChange={(n) => patch((s) => ({ ...s, lot: { ...s.lot, treesCount: n } }))} ariaLabel="Tree count" /></Field>

      <SectionTitle>Light</SectionTitle>
      <Field label="Time of day">
        <Segmented<ExteriorSpec['lighting']['timeOfDay']>
          size="sm"
          value={spec.lighting.timeOfDay}
          options={[{ value: 'morning', label: 'Morning' }, { value: 'noon', label: 'Noon' }, { value: 'golden-hour', label: 'Golden' }, { value: 'dusk', label: 'Dusk' }]}
          onChange={(v) => patch((s) => ({ ...s, lighting: { ...s.lighting, timeOfDay: v } }))}
        />
      </Field>
      <div className="mt-1 text-[11px] text-dim">{fmtCount(spec.lighting.exteriorSconces)} exterior sconces · landscape lighting {spec.lighting.landscape ? 'on' : 'off'}</div>
    </>
  );
}

export function LayoutPanel() {
  const spec = useProjectStore((s) => s.project.spec);
  if (!spec) return <EmptyState title="No 3D twin yet" body="Build a twin to adjust its layout." />;
  const captured = (spec.roomType === 'kitchen' || spec.roomType === 'bathroom') && spec.scanGeometry;
  return (
    <div className="pb-6">
      <div className="mb-1">
        <div className="font-display text-[19px] leading-tight text-ink">Layout</div>
        <div className="text-[11.5px] text-muted">{captured ? 'Edit the clean model and review measured quantities.' : 'Structural changes update the 3D view and the estimate live.'}</div>
      </div>
      {(spec.roomType === 'kitchen' || spec.roomType === 'bathroom') && <MeasuredDimensions spec={spec} />}
      {!captured && <LayoutAudit spec={spec} />}
      {spec.roomType === 'kitchen' && (spec.scanGeometry ? <><ScanDesignControls spec={spec} /><CapturedLayoutSummary scan={spec.scanGeometry} roomType="kitchen" /></> : <KitchenControls spec={spec} />)}
      {spec.roomType === 'bathroom' && (spec.scanGeometry ? <><ScanDesignControls spec={spec} /><CapturedLayoutSummary scan={spec.scanGeometry} roomType="bathroom" /></> : <BathroomControls spec={spec} />)}
      {spec.roomType === 'exterior' && <ExteriorControls spec={spec} />}
      {spec.roomType === 'floorplan' && <FloorPlanControls spec={spec} />}
    </div>
  );
}
