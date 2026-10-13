'use client';
/**
 * The guided interview — what the app asks when the upload could not answer
 * its own questions.
 *
 * A photograph of a kitchen tells us the cabinet colour, the counter, the
 * tile and the floor. An empty lot and a floor plan tell us none of that, and
 * the app used to guess anyway. So when the analyzer says it was not looking
 * at a room (`detected.inputKind`), we stop and ASK — in the order and the
 * words a contractor standing on the site would use, one group of questions
 * per screen, with the answer we would have guessed already selected so a
 * client can simply agree and get on with it.
 *
 * Three rules this screen keeps:
 *
 *  1. **Nothing is a bare dropdown of names.** A colour question shows
 *     colours; a material question shows the same swatch the 3D view will
 *     paint the surface with (`Swatch` renders the catalog texture, or draws
 *     the procedural recipe). Nobody can pick "Calacatta Gold" off a list;
 *     everybody can pick it out of a grid.
 *  2. **Every question is already answered.** The default is preselected and
 *     the client can leave at any point — `completeAnswers` fills the rest
 *     with exactly what is on screen, so what gets built is what they saw.
 *  3. **The answers belong to the project, not to this screen.** Every change
 *     lands on `project.intake` immediately, so closing the interview keeps
 *     the draft, a reload keeps it, and reopening it later to change one
 *     answer never means redoing the analysis.
 *
 * The wiring — which questions, and what happens on Build — lives in
 * `interviewFlow.ts` so it can be verified headlessly.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, ClipboardList, Hammer, PencilLine, X } from 'lucide-react';
import { getMaterial } from '@/lib/materials/catalog';
import { preloadSelections } from '@/components/scene/materials';
import {
  GROUP_LABEL, answerMap, questionGroups, setAnswer, titleCase,
  type IntakeGroup, type IntakeOption, type IntakeQuestion,
} from '@/lib/spec/intake';
import { useProjectStore } from '@/lib/store/project-store';
import type { IntakeAnswer } from '@/lib/spec/types';
import { INPUT_BLURB, INPUT_LABEL, answeredCount, buildFromInterview, interviewQuestions } from './interviewFlow';
import { requestResetView } from './photoMatch';
import { Slider, Stepper, Swatch } from './controls';
import { useToast } from './Toast';
import { cx } from './hooks';

// ---------------------------------------------------------------------------
// Open state — module-level, exactly like the match report, so the analysis
// hook can open the interview when a plan lands and the top bar can reopen it
// an hour later without a prop threaded through the whole studio.
// ---------------------------------------------------------------------------

let open = false;
const listeners = new Set<() => void>();
function setOpen(v: boolean) {
  if (open === v) return;
  open = v;
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const openInterview = () => setOpen(true);
export const closeInterview = () => setOpen(false);
export function useInterviewOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => false);
}

/**
 * What the top bar needs to offer the interview: how many questions there
 * are, how many the client has answered, and whether they have ever finished
 * it. `total === 0` means there is nothing to ask and no chip to show.
 */
export function useInterviewStatus(): { total: number; answered: number; done: boolean } {
  const spec = useProjectStore((s) => s.project.spec);
  const intake = useProjectStore((s) => s.project.intake);
  return useMemo(() => {
    const questions = interviewQuestions(spec, intake);
    return {
      total: questions.length,
      answered: answeredCount(questions, intake?.answers ?? []),
      done: Boolean(intake?.capturedAt),
    };
  }, [spec, intake]);
}

// ---------------------------------------------------------------------------
// Colour palettes
// ---------------------------------------------------------------------------

/**
 * A colour question writes a free hex, so unlike every other list on this
 * screen there is no enum and no catalog to derive the choices from. These
 * are presentation only — a starting board of the colours contractors
 * actually order, so nobody has to know what `#8E9187` looks like — and the
 * colour picker beside them takes anything at all.
 *
 * Keyed by the SLOT the question writes to, so a new colour question about a
 * slot already listed here gets the right board for free.
 */
type Palette = Array<{ hex: string; label: string }>;

const CABINET_PALETTE: Palette = [
  { hex: '#F2F0EC', label: 'Alabaster' }, { hex: '#E6E1D6', label: 'Warm white' },
  { hex: '#CFCBC3', label: 'Dove grey' }, { hex: '#A79E92', label: 'Mushroom' },
  { hex: '#8E9187', label: 'Sage' }, { hex: '#4F5A52', label: 'Forest' },
  { hex: '#3C4A5A', label: 'Slate blue' }, { hex: '#22303F', label: 'Navy' },
  { hex: '#2B2B2B', label: 'Soft black' }, { hex: '#8A6A4B', label: 'Walnut' },
  { hex: '#C9AE86', label: 'White oak' }, { hex: '#6B4A34', label: 'Cherry' },
];
const WALL_PALETTE: Palette = [
  { hex: '#F1EFEA', label: 'Off white' }, { hex: '#EDE7DC', label: 'Linen' },
  { hex: '#E2E4E1', label: 'Cool white' }, { hex: '#D6D2C8', label: 'Greige' },
  { hex: '#BFC5C2', label: 'Pale sage' }, { hex: '#9FA8A5', label: 'Sea grey' },
  { hex: '#7C8A8C', label: 'Deep teal' }, { hex: '#3A3F44', label: 'Charcoal' },
];
const SIDING_PALETTE: Palette = [
  { hex: '#E8E6E0', label: 'Chalk white' }, { hex: '#D9D5CB', label: 'Greige' },
  { hex: '#B8B4A9', label: 'Clay' }, { hex: '#8E9187', label: 'Sage' },
  { hex: '#5C6A63', label: 'Hunter' }, { hex: '#46505A', label: 'Slate blue' },
  { hex: '#2E3438', label: 'Charcoal' }, { hex: '#1E2022', label: 'Black' },
  { hex: '#8A6A4B', label: 'Cedar stain' }, { hex: '#7A3B2E', label: 'Barn red' },
];
const TRIM_PALETTE: Palette = [
  { hex: '#FAF8F4', label: 'Bright white' }, { hex: '#F2EFE8', label: 'Soft white' },
  { hex: '#E4E0D6', label: 'Cream' }, { hex: '#B8B4A9', label: 'Clay' },
  { hex: '#3A3F44', label: 'Charcoal' }, { hex: '#1E2022', label: 'Black' },
];
const ROOF_PALETTE: Palette = [
  { hex: '#3A3B3D', label: 'Charcoal' }, { hex: '#4A4E52', label: 'Slate' },
  { hex: '#6E7377', label: 'Silver metal' }, { hex: '#5B554D', label: 'Weathered wood' },
  { hex: '#2A2C2E', label: 'Onyx' }, { hex: '#8B5E3C', label: 'Terracotta' },
];
const DOOR_PALETTE: Palette = [
  { hex: '#22364F', label: 'Navy' }, { hex: '#1F3D2F', label: 'Forest' },
  { hex: '#7A2E2A', label: 'Oxblood' }, { hex: '#B9762F', label: 'Amber' },
  { hex: '#3E5C63', label: 'Teal' }, { hex: '#2B2B2B', label: 'Black' },
  { hex: '#F2F0EC', label: 'White' }, { hex: '#C9AE86', label: 'Stained oak' },
];

const PALETTE_FOR_SLOT: Record<string, Palette> = {
  cabinets_base: CABINET_PALETTE, cabinets_upper: CABINET_PALETTE, cabinets_tall: CABINET_PALETTE,
  island_cabinets: CABINET_PALETTE, vanity_cabinet: CABINET_PALETTE,
  walls: WALL_PALETTE, ceiling: WALL_PALETTE,
  siding_primary: SIDING_PALETTE, siding_accent: SIDING_PALETTE,
  trim: TRIM_PALETTE, roof: ROOF_PALETTE, front_door: DOOR_PALETTE,
};

function paletteFor(q: IntakeQuestion): Palette {
  const slot = q.writes.kind === 'finish' || q.writes.kind === 'material' ? q.writes.slot : '';
  const board = PALETTE_FOR_SLOT[slot] ?? WALL_PALETTE;
  // the question's own default always leads the board, so "the one we picked
  // for you" is the first thing under the cursor
  return board.some((c) => c.hex.toLowerCase() === q.default.toLowerCase())
    ? board
    : [{ hex: q.default, label: 'Our pick' }, ...board];
}

const HEX = /^#?([0-9a-fA-F]{6})$/;
const normalizeHex = (v: string): string | null => {
  const m = HEX.exec(v.trim());
  return m ? `#${m[1].toUpperCase()}` : null;
};

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function OptionCard({ option, selected, onSelect }: { option: IntakeOption; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cx(
        'rounded-[var(--radius-sm)] border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass/50',
        selected ? 'border-brass bg-brass-soft' : 'border-border bg-surface/50 hover:border-border-strong',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={cx('text-[13.5px] leading-tight', selected ? 'text-ink' : 'text-ink/85')}>{option.label}</span>
        {selected && <Check size={13} className="mt-0.5 shrink-0 text-brass" />}
      </div>
      {option.hint && <div className="mt-1 text-[11.5px] leading-snug text-muted">{option.hint}</div>}
    </button>
  );
}

/**
 * A material question, shown the way the studio's own picker shows it: the
 * real swatch (a catalog texture, or the procedural recipe drawn by the same
 * generator the 3D view uses), the product name, and its grade.
 */
function MaterialCard({ option, selected, onSelect }: { option: IntakeOption; selected: boolean; onSelect: () => void }) {
  const def = getMaterial(option.value);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={option.label}
      className={cx(
        'group overflow-hidden rounded-[var(--radius-sm)] border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass/50',
        selected ? 'border-brass bg-brass-soft' : 'border-border bg-surface/50 hover:border-border-strong',
      )}
    >
      <div className="relative">
        <Swatch material={def} size="fill" className="h-16 w-full" rounded="rounded-none" />
        {selected && (
          <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-brass text-[#0a0a0a]"><Check size={12} /></span>
        )}
      </div>
      <div className="px-2 py-1.5">
        <div className="truncate text-[12.5px] leading-tight text-ink">{option.label}</div>
        {option.hint && <div className="truncate text-[11px] text-muted">{option.hint}</div>}
      </div>
    </button>
  );
}

function ColourControl({ q, value, onChange }: { q: IntakeQuestion; value: string; onChange: (v: string) => void }) {
  const palette = useMemo(() => paletteFor(q), [q]);
  // The hex box is a DRAFT: half-typed text ('#3A4') is not a colour and must
  // not be written to the spec, but it must still be visible while it is
  // being typed. Re-synced during render (not in an effect) whenever the
  // answer changes underneath — clicking a swatch has to move the box too.
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (value !== synced) { setSynced(value); setDraft(value); }
  const commit = (raw: string) => {
    setDraft(raw);
    const hex = normalizeHex(raw);
    if (hex) onChange(hex);
  };
  return (
    <div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
        {palette.map((c) => {
          const selected = c.hex.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={c.hex + c.label}
              type="button"
              onClick={() => onChange(c.hex.toUpperCase())}
              aria-pressed={selected}
              aria-label={`${c.label} ${c.hex}`}
              title={`${c.label} · ${c.hex}`}
              className={cx(
                'rounded-[var(--radius-sm)] border p-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass/50',
                selected ? 'border-brass bg-brass-soft' : 'border-border hover:border-border-strong',
              )}
            >
              <span className="relative block h-10 w-full rounded-[6px] border border-white/10" style={{ backgroundColor: c.hex }}>
                {selected && <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-brass text-[#0a0a0a]"><Check size={10} /></span>}
              </span>
              <span className="mt-1 block truncate text-[10.5px] text-muted">{c.label}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <label className="flex items-center gap-2 text-[12px] text-muted">
          <span>Or pick your own</span>
          <input
            type="color"
            value={normalizeHex(value) ?? '#FFFFFF'}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            aria-label={`${q.prompt} — colour picker`}
            className="h-8 w-10 cursor-pointer rounded-md border border-border-strong bg-bg-elev p-0.5"
          />
        </label>
        <input
          value={draft}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => setDraft(value)}
          spellCheck={false}
          aria-label={`${q.prompt} — hex value`}
          className="input h-8 w-28 font-mono text-[12px] uppercase"
          placeholder="#RRGGBB"
        />
      </div>
    </div>
  );
}

function NumberControl({ q, value, onChange }: { q: IntakeQuestion; value: string; onChange: (v: string) => void }) {
  const min = q.min ?? 0;
  const max = q.max ?? 100;
  const step = q.step ?? 1;
  const n = Number(value);
  const current = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : Number(q.default);
  // A handful of whole numbers (storeys, garage bays) is a stepper; a range
  // you sweep (a lot's frontage, how high the tile runs) is a slider.
  const small = step === 1 && max - min <= 8;
  return (
    <div className="flex items-center gap-3">
      {small ? (
        <Stepper value={current} min={min} max={max} step={step} onChange={(v) => onChange(String(v))} ariaLabel={q.prompt} />
      ) : (
        <div className="min-w-0 flex-1">
          <Slider value={current} min={min} max={max} step={step} onChange={(v) => onChange(String(v))} format={(v) => `${v} ${q.unit ?? ''}`.trim()} ariaLabel={q.prompt} />
        </div>
      )}
      {!small && (
        <div className="flex shrink-0 items-center gap-1.5">
          <input
            type="number"
            value={current}
            min={min}
            max={max}
            step={step}
            onChange={(e) => onChange(e.target.value)}
            aria-label={`${q.prompt} — exact value`}
            className="input h-8 w-20 text-[13px]"
          />
          <span className="text-[12px] text-muted">{q.unit}</span>
        </div>
      )}
      {small && <span className="text-[12px] text-muted">{q.unit}</span>}
    </div>
  );
}

/**
 * Free text. Kept local and committed on a short delay: every commit writes
 * the whole project to localStorage, and doing that per keystroke in a
 * notes field is a stutter nobody should have to feel.
 */
function TextControl({ q, value, onChange }: { q: IntakeQuestion; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (value !== synced) { setSynced(value); setDraft(value); }
  useEffect(() => {
    if (draft === value) return;
    const id = window.setTimeout(() => onChange(draft), 400);
    return () => window.clearTimeout(id);
  }, [draft, value, onChange]);
  return (
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onChange(draft); }}
      rows={3}
      aria-label={q.prompt}
      placeholder="Optional — anything the questions above did not cover."
      className="input h-auto w-full resize-y py-2.5 text-[13.5px] leading-relaxed placeholder:text-dim"
    />
  );
}

function QuestionCard({ q, answer, answered, onChange }: {
  q: IntakeQuestion;
  answer: IntakeAnswer | undefined;
  answered: boolean;
  onChange: (value: string, values?: string[]) => void;
}) {
  const value = answer && answer.value !== '' ? answer.value : q.default;
  const values = answer?.values ?? [];
  const isMaterial = q.type === 'choice' && q.options.some((o) => o.swatch);
  return (
    <section id={`q-${q.id}`} role="group" aria-labelledby={`label-${q.id}`} className="panel scroll-mt-24 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`label-${q.id}`} className="font-display text-[19px] leading-tight text-ink">{q.prompt}</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{q.help}</p>
        </div>
        <span className={cx('chip shrink-0', answered && 'chip-brass')}>
          {answered ? <><Check size={11} /> Yours</> : 'Our pick'}
        </span>
      </div>

      <div className="mt-3.5">
        {q.type === 'colour' && <ColourControl q={q} value={value} onChange={(v) => onChange(v)} />}
        {q.type === 'number' && <NumberControl q={q} value={value} onChange={(v) => onChange(v)} />}
        {q.type === 'text' && <TextControl q={q} value={answer?.value ?? ''} onChange={(v) => onChange(v)} />}
        {q.type === 'choice' && (
          isMaterial ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {q.options.map((o) => <MaterialCard key={o.value} option={o} selected={o.value === value} onSelect={() => onChange(o.value)} />)}
            </div>
          ) : (
            <div className={cx('grid gap-2', q.options.length > 6 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2')}>
              {q.options.map((o) => <OptionCard key={o.value} option={o} selected={o.value === value} onSelect={() => onChange(o.value)} />)}
            </div>
          )
        )}
        {q.type === 'multi' && (
          <div className="flex flex-wrap gap-1.5">
            {q.options.map((o) => {
              const on = values.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange(value, on ? values.filter((v) => v !== o.value) : [...values, o.value])}
                  className={cx('chip cursor-pointer', on && 'chip-brass')}
                >
                  {on && <Check size={11} />}{o.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The interview
// ---------------------------------------------------------------------------

/** What one answer reads as on the review page. */
function answerLabel(q: IntakeQuestion, answer: IntakeAnswer | undefined): string {
  const value = answer && answer.value !== '' ? answer.value : q.default;
  if (q.type === 'text') return value.trim() ? value.trim() : '—';
  if (q.type === 'number') return `${value} ${q.unit ?? ''}`.trim();
  if (q.type === 'multi') return (answer?.values ?? []).map((v) => q.options.find((o) => o.value === v)?.label ?? v).join(', ') || '—';
  const hit = q.options.find((o) => o.value === value);
  return hit ? hit.label : titleCase(value);
}

type Page = { kind: 'group'; group: IntakeGroup; questions: IntakeQuestion[] } | { kind: 'review' };

export function Interview() {
  const isOpen = useInterviewOpen();
  const spec = useProjectStore((s) => s.project.spec);
  const intake = useProjectStore((s) => s.project.intake);
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const questions = useMemo(() => interviewQuestions(spec, intake), [spec, intake]);
  const answers = useMemo(() => intake?.answers ?? [], [intake]);
  const given = useMemo(() => answerMap(answers), [answers]);
  const pages = useMemo<Page[]>(
    () => [...questionGroups(questions).map(([group, qs]) => ({ kind: 'group' as const, group, questions: qs })), { kind: 'review' as const }],
    [questions],
  );
  const answered = useMemo(() => answeredCount(questions, answers), [questions, answers]);
  const clamped = Math.min(step, Math.max(0, pages.length - 1));
  const page = pages[clamped];

  const set = useCallback((id: string, value: string, values: string[] = []) => {
    const st = useProjectStore.getState();
    const current = st.project.intake;
    if (!current) return;
    st.setIntake({ ...current, answers: setAnswer(current.answers, id, value, values) });
  }, []);

  // A fresh interview opens at question one; one the client has already
  // finished opens at the review, because they came back to change ONE thing.
  const openedAt = useRef<boolean>(false);
  useEffect(() => {
    if (!isOpen) { openedAt.current = false; return; }
    if (openedAt.current) return;
    openedAt.current = true;
    setStep(intake?.capturedAt ? Math.max(0, pages.length - 1) : 0);
  }, [isOpen, intake?.capturedAt, pages.length]);

  // Moving between pages is a change of context: put the focus on the new
  // heading (so a keyboard user is not left at the bottom of the last page)
  // and start the panel at the top.
  useEffect(() => {
    if (!isOpen) return;
    scrollRef.current?.scrollTo({ top: 0 });
    headingRef.current?.focus();
  }, [clamped, isOpen]);

  // Escape leaves (the answers are already on the project), and Tab stays
  // inside: the studio behind this is still focusable, and a keyboard user
  // who tabs off the end of the interview into a viewport they cannot see is
  // simply lost.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeInterview(); return; }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = [...root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !root.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !root.contains(active))) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  const build = useCallback(() => {
    const res = buildFromInterview(useProjectStore.getState().project.intake?.answers ?? []);
    if (!res.ok) {
      toast({ kind: 'error', title: 'Could not build from your answers', description: res.reason });
      return;
    }
    try { preloadSelections(useProjectStore.getState().project.selections); } catch { /* textures stream in later */ }
    requestResetView();
    closeInterview();
    toast({
      kind: 'success',
      title: 'Built from your answers',
      description: `${res.wrote.length} choice${res.wrote.length === 1 ? '' : 's'} applied${res.skipped.length ? ` · ${res.skipped.length} could not be used` : ''}. Every surface is still swappable.`,
    });
  }, [toast]);

  // Not an early return: AnimatePresence has to OUTLIVE the panel it animates
  // out, so the gate goes inside it. There is always a review page, so `page`
  // is always defined even when there is nothing to ask.
  const showing = isOpen && Boolean(spec) && Boolean(intake) && questions.length > 0;
  const kind = intake?.inputKind ?? 'room-photo';
  const title = page.kind === 'review' ? 'Does this look right?' : GROUP_LABEL[page.group];
  const progress = questions.length ? answered / questions.length : 0;

  return (
    <AnimatePresence>
      {showing && (
      <motion.div
        ref={dialogRef}
        key="interview"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
        role="dialog"
        aria-modal="true"
        aria-label="Guided intake"
        className="grain fixed inset-0 z-50 flex flex-col bg-bg/95 backdrop-blur-xl"
      >
        <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(60% 40% at 50% -10%, rgba(201,150,46,.10), transparent 70%)' }} />

        {/* ---- header ---------------------------------------------------- */}
        <header className="relative z-10 shrink-0 border-b border-border px-5 pb-3 pt-4 sm:px-8">
          <div className="mx-auto w-full max-w-3xl">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="eyebrow flex items-center gap-2"><ClipboardList size={12} /> A few questions · {INPUT_LABEL[kind]}</div>
                <h2 ref={headingRef} tabIndex={-1} className="mt-1.5 font-display text-[28px] leading-tight text-ink outline-none sm:text-[34px]">{title}</h2>
              </div>
              <button type="button" onClick={closeInterview} aria-label="Close — your answers are saved" title="Close — your answers are saved" className="btn btn-ghost btn-sm w-9 shrink-0 px-0"><X size={16} /></button>
            </div>
            {clamped === 0 && page.kind !== 'review' && (
              <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-muted">{INPUT_BLURB[kind]} Everything below is already answered with what we would have picked — change what you care about and leave the rest.</p>
            )}

            <div className="mt-3 flex items-center gap-3">
              <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
                <motion.div className="h-full rounded-full bg-brass" animate={{ width: `${Math.round(progress * 100)}%` }} transition={{ duration: 0.3 }} />
              </div>
              <div className="shrink-0 font-mono text-[11px] text-muted">{answered}/{questions.length} answered</div>
            </div>

            <nav aria-label="Interview sections" className="mt-2.5 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
              {pages.map((p, i) => (
                <button
                  key={p.kind === 'review' ? 'review' : p.group}
                  type="button"
                  onClick={() => setStep(i)}
                  aria-current={i === clamped ? 'step' : undefined}
                  className={cx('chip shrink-0 cursor-pointer', i === clamped && 'chip-brass')}
                >
                  {p.kind === 'review' ? 'Review' : GROUP_LABEL[p.group]}
                </button>
              ))}
            </nav>
          </div>
        </header>

        {/* ---- questions -------------------------------------------------- */}
        <div ref={scrollRef} className="relative z-10 min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8">
          <div className="mx-auto w-full max-w-3xl">
            <AnimatePresence mode="wait">
              <motion.div
                key={page.kind === 'review' ? 'review' : page.group}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
                className="flex flex-col gap-3"
              >
                {page.kind === 'group'
                  ? page.questions.map((q) => (
                    <QuestionCard
                      key={q.id}
                      q={q}
                      answer={given.get(q.id)}
                      answered={Boolean(given.get(q.id) && (given.get(q.id)!.value.trim() !== '' || (given.get(q.id)!.values?.length ?? 0) > 0))}
                      onChange={(value, values) => set(q.id, value, values ?? [])}
                    />
                  ))
                  : (
                    <div className="panel overflow-hidden">
                      <div className="border-b border-border px-4 py-3 text-[12.5px] text-muted sm:px-5">
                        This is what we will build. Click any line to change it — you can come back and change it again afterwards without re-analyzing anything.
                      </div>
                      {questionGroups(questions).map(([group, qs], gi) => (
                        <div key={group}>
                          <div className={cx('bg-white/[0.02] px-4 py-1.5 sm:px-5', gi > 0 && 'border-t border-border')}>
                            <span className="eyebrow">{GROUP_LABEL[group]}</span>
                          </div>
                          {qs.map((q) => {
                            const mine = Boolean(given.get(q.id) && (given.get(q.id)!.value.trim() !== '' || (given.get(q.id)!.values?.length ?? 0) > 0));
                            const target = pages.findIndex((p) => p.kind === 'group' && p.group === group);
                            return (
                              <button
                                key={q.id}
                                type="button"
                                onClick={() => {
                                  setStep(target < 0 ? 0 : target);
                                  // after the page transition, not during it:
                                  // AnimatePresence mode="wait" holds the new
                                  // page back until the old one has left.
                                  window.setTimeout(() => document.getElementById(`q-${q.id}`)?.scrollIntoView({ block: 'center' }), 320);
                                }}
                                className="group flex w-full items-center gap-3 border-t border-border/60 px-4 py-2.5 text-left hover:bg-white/[0.03] sm:px-5"
                              >
                                <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{q.prompt}</span>
                                {q.type === 'colour' && <span className="h-4 w-4 shrink-0 rounded-full border border-white/15" style={{ backgroundColor: given.get(q.id)?.value || q.default }} />}
                                {q.writes.kind === 'material' && <Swatch material={getMaterial(given.get(q.id)?.value || q.default)} size={16} />}
                                <span className={cx('max-w-[45%] truncate text-[13px]', mine ? 'text-ink' : 'text-ink/70')}>{answerLabel(q, given.get(q.id))}</span>
                                <PencilLine size={12} className="shrink-0 text-dim opacity-0 transition-opacity group-hover:opacity-100" />
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* ---- footer ----------------------------------------------------- */}
        <footer className="relative z-10 shrink-0 border-t border-border bg-bg/80 px-5 py-3 backdrop-blur-xl sm:px-8">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep(Math.max(0, clamped - 1))} disabled={clamped === 0}>
              <ArrowLeft size={14} /> Back
            </button>
            <div className="flex-1" />
            {page.kind !== 'review' && (
              <button
                type="button"
                className="btn btn-ghost btn-sm hidden sm:inline-flex"
                onClick={() => setStep(pages.length - 1)}
                title="Keep our picks for everything you have not changed"
              >
                Use our picks for the rest
              </button>
            )}
            {page.kind === 'review' ? (
              <button type="button" className="btn btn-primary" onClick={build}>
                <Hammer size={15} /> Build it
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => setStep(Math.min(pages.length - 1, clamped + 1))}>
                Next <ArrowRight size={15} />
              </button>
            )}
          </div>
        </footer>
      </motion.div>
      )}
    </AnimatePresence>
  );
}
