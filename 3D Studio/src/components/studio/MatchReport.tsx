'use client';
/**
 * The match report: how literally the twin lands on the client's photo,
 * element by element. The chips say "Photo match 68%"; this says WHICH
 * element is off and by how much ("the fridge is 9% of the frame further
 * left in the photo"), what the photo has that the twin does not draw, and
 * offers another fit. It reads the last fit's residuals (`useFitReport`) —
 * the same numbers the accuracy pass feeds the model — so what the
 * contractor sees is what the loop is working on.
 *
 * THREE numbers, each with its own one-line definition, and never one shown
 * as another. Overall is the weighted mean OVERLAP of the matched boxes — an
 * IoU, which loses nine points to a 5% size error and so tops out near 85%
 * even for a perfect twin against hand-drawn boxes. Proportions is how close
 * the sizes and positions are, and reads 15–20 points higher for the same
 * twin; shown on its own it would look like a number massage. Coverage is
 * how much of the photo the twin draws at all. Beside them, when the
 * inventory recorded it, the annotator's OWN repeatability — which is what
 * turns "why isn't it 90%" into "here is how precisely the photo was
 * measured, and here is how closely the twin matches that measurement".
 */
import { useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Focus, LoaderCircle, X } from 'lucide-react';
import { offBelowFor, residualName, residualPhrases, PROPORTION_OFF_ABOVE, RESIDUAL_OFF_BELOW, type FitResidual } from '@/lib/api-client';
import { anyOpenEdge } from '@/lib/spec/photo-box';
import { isSingleRoom } from '@/lib/spec/floorplan';
import type { BoxOpenEdges, PhotoElement } from '@/lib/spec/types';
import { useProjectStore } from '@/lib/store/project-store';
import { useAccuracyReport, useFitReport, useFitToPhoto } from './useAnalysis';
import { useToast } from './Toast';
import { cx } from './hooks';

// ---------------------------------------------------------------------------
// Open state — module-level so the TopBar chip and the Viewport's button can
// open the same panel without threading a prop through the studio shell.
// ---------------------------------------------------------------------------

let open = false;
const listeners = new Set<() => void>();
function setOpen(v: boolean) {
  if (open === v) return;
  open = v;
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const openMatchReport = () => setOpen(true);
export const closeMatchReport = () => setOpen(false);
export const toggleMatchReport = () => setOpen(!open);
export function useMatchReportOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => false);
}

const pct = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * "Cut off ←" — the photo's box for this element stops at the picture's edge
 * (or behind something), so it is a LOWER bound and the fit is scored with it
 * repaired out to the twin (`fit/report.ts repairOpen`). Without this the row
 * reads as an unexplained mismatch: the client's island is half out of frame,
 * its residual says nothing, and a contractor is left wondering why a number
 * that looks wrong was forgiven.
 *
 * Read off the STORE's own inventory rather than the residual, because the
 * residual carries no truncation of its own and `detected.elements` is healed
 * on the way in (`migrateProject` v6 / `healContract`), so the edges are there
 * whether or not the last fit ran.
 */
const ARROW: Record<keyof BoxOpenEdges, string> = { left: '←', right: '→', top: '↑', bottom: '↓' };
function openChip(open: BoxOpenEdges, cause: PhotoElement['openCause']): string {
  const arrows = (Object.keys(ARROW) as Array<keyof BoxOpenEdges>).filter((k) => open[k]).map((k) => ARROW[k]).join('');
  return `${cause === 'occluded' ? 'Hidden' : 'Cut off'} ${arrows}`;
}

/** The residual in words for the list: the gap phrases, or "lands on the photo". */
function residualLine(r: FitResidual): string {
  const phrases = residualPhrases(r);
  if (!phrases.length) return r.iou >= RESIDUAL_OFF_BELOW ? 'lands on the photo' : 'same place, different shape';
  return `in the photo: ${phrases.join(', ')}`;
}

function Bar({ value, good }: { value: number; good: number }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-white/10" aria-hidden>
      <div className={cx('h-full rounded-full', v >= good ? 'bg-brass' : v >= good * 0.55 ? 'bg-brass/55' : 'bg-white/35')} style={{ width: `${Math.round(v * 100)}%` }} />
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="num font-display text-[22px] leading-tight text-ink">{value}</div>
      <div className="text-[10.5px] leading-snug text-muted">{note}</div>
    </div>
  );
}

export function MatchReport({ className, readOnly = false }: { className?: string; readOnly?: boolean }) {
  const isOpen = useMatchReportOpen();
  const fit = useFitReport();
  const accuracy = useAccuracyReport();
  const { fit: refit, busy, canFit } = useFitToPhoto();
  const { toast } = useToast();
  // The fit's own weighted Proportions number — the report's fit first, the
  // store's last one otherwise (a page reloaded onto a stored project). Never
  // recomputed here from the residuals: those carry no weights, so it would
  // quietly be a different number under the same label.
  const storedProportions = useProjectStore((s) => s.ui.fitProportions);
  const currentSpec = useProjectStore((s) => s.project.spec);
  const stale = fit.at > 0 && fit.spec !== currentSpec;
  const proportions = stale ? null : fit.proportions ?? storedProportions;
  const detected = useProjectStore((s) => (isSingleRoom(s.project.spec) ? s.project.spec.detected : null));
  const inventory = (isSingleRoom(fit.spec) ? fit.spec.detected?.inventory : null) ?? detected?.inventory ?? null;
  const matching = accuracy.status === 'running' && accuracy.phase === 'geometry';
  const unmatched = fit.unmatchedPhoto.filter((u) => u.reason !== 'kind not scored');
  const residuals = [...fit.residuals].sort((a, b) => a.iou - b.iou);
  // the inventory's own truncation, by the label the residual carries (an item
  // is only recognisable by its label; everything else by its kind)
  const elements: PhotoElement[] = (isSingleRoom(fit.spec) ? fit.spec.detected?.elements : null) ?? detected?.elements ?? [];
  // The residual carries its OWN pair's truncation now. Searching `elements`
  // for "the first one of this kind that is open" gave a closed element its
  // open sibling's chip whenever a kind had several members — client-tan has
  // three base-cabinet-runs, two pendants and 18 open boxes — and the chip's
  // tooltip says the twin was allowed to run past the box, which is a claim
  // about THIS pair. A spec fitted before the field existed falls back to the
  // old lookup, which is still right whenever the kind has one member.
  const cutOf = (r: FitResidual): string | null => {
    if (r.open !== undefined) return anyOpenEdge(r.open) && r.open ? openChip(r.open, r.openCause ?? null) : null;
    const e = elements.find((x) => x.kind === r.kind && (r.label ? x.label === r.label : true) && anyOpenEdge(x.open));
    return e && e.open ? openChip(e.open, e.openCause ?? null) : null;
  };

  const onFit = async () => {
    const r = await refit();
    if (r.ok) toast({ kind: 'success', title: r.score !== null ? `Photo match ${pct(r.score)}` : 'Fitted to your photo', description: 'Camera and layout adjusted so the twin lands on the photo.' });
    else if (!r.cancelled) toast({ kind: 'error', title: 'Could not fit to photo', description: r.error });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.aside
          key="match-report"
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 12 }}
          transition={{ duration: 0.18 }}
          className={cx('panel flex flex-col overflow-hidden', className)}
          aria-label="Photo match report"
        >
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <Focus size={14} className="text-brass" />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] text-ink">Photo match</div>
              <div className="text-[11px] text-muted">
                {matching ? `Matching photo · round ${accuracy.round || 1}` : stale ? 'Layout changed · fit again to update' : fit.source ? 'Where the twin lands on your photo' : 'Not fitted yet'}
              </div>
            </div>
            <button type="button" aria-label="Close match report" className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-white/5 hover:text-ink" onClick={closeMatchReport}><X size={14} /></button>
          </div>

          <div className="border-b border-border px-3 py-2.5">
            <div className="grid grid-cols-3 gap-2">
              <Tile label="Overlap" value={pct(stale ? null : fit.score)} note="mean overlap of matched elements" />
              <Tile
                label="Proportions"
                value={pct(proportions)}
                // Below 90% the tile says so rather than leaving the reader to
                // compare it with a target nobody wrote down. What is left is
                // usually the detector, not the twin: an element the inventory
                // boxed through something standing in front of it reads too
                // tall, and no camera can make that pair agree.
                note={typeof proportions === 'number'
                  ? `weighted size and position agreement in the image${proportions < 0.9 ? ' · below the 90% target' : ''}`
                  : 'sizes and positions vs the photo'}
              />
              <Tile label="Coverage" value={pct(stale ? null : fit.coverage)} note={`${residuals.length} of ${residuals.length + unmatched.length} photo elements matched`} />
            </div>
            <p className="mt-2 text-[10.5px] leading-relaxed text-muted">{stale ? 'The rows below describe the previous layout. ' : ''}Image agreement is not dimensional accuracy. Confirm on-site measurements in Layout.</p>
            {inventory && typeof inventory.agreement === 'number' && (
              // the annotator's own precision, so the score is read against
              // the accuracy of the boxes it is scored on
              <div className="mt-2 text-[10.5px] text-muted">
                detector agreement {Math.round(inventory.agreement * 100)}% over {inventory.samples} pass{inventory.samples === 1 ? '' : 'es'}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            {!residuals.length && !unmatched.length ? (
              <p className="py-3 text-[12px] text-muted">{canFit ? 'Fit the twin to the photo to see how each element lands.' : 'This photo has no inventory to fit against. Re-analyze it to build one.'}</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {residuals.map((r, i) => (
                  <li key={`${r.kind}|${r.wall ?? ''}|${r.index ?? i}`} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-baseline gap-1.5">
                        <span className="min-w-0 truncate text-[12px] text-ink" title={r.label ?? undefined}>{cap(residualName(r).replace(/^the /, ''))}</span>
                        {cutOf(r) && (
                          <span className="chip shrink-0 whitespace-nowrap px-1.5 py-0 text-[9.5px] leading-[15px] text-muted" title="the photo does not show all of this element, so its box is a lower bound — the twin is allowed to run past it">{cutOf(r)}</span>
                        )}
                      </span>
                      <span className="shrink-0 text-[11px]">
                        {typeof r.err === 'number' && (
                          <span className={cx('num mr-2', r.err <= PROPORTION_OFF_ABOVE ? 'text-brass' : 'text-muted')} title="proportions: how close this element's size and position are">{pct(1 - r.err)}</span>
                        )}
                        <span className={cx('num', r.iou >= offBelowFor(r.kind) ? 'text-brass' : 'text-muted')} title="overlap with the photo's box">{pct(r.iou)}</span>
                      </span>
                    </div>
                    <Bar value={r.iou} good={offBelowFor(r.kind)} />
                    <div className="text-[11px] leading-snug text-muted">{residualLine(r)}</div>
                  </li>
                ))}
                {unmatched.length > 0 && (
                  <li className="mt-1 border-t border-border pt-2">
                    <div className="eyebrow mb-1.5">In photo, not in twin</div>
                    <ul className="flex flex-col gap-1">
                      {fit.hints.length
                        ? fit.hints.map((h, i) => <li key={i} className="text-[11.5px] leading-snug text-muted">{cap(h)}</li>)
                        : unmatched.map((u) => <li key={u.id} className="text-[11.5px] leading-snug text-muted">{cap(u.kind.replace(/-/g, ' '))} — {u.reason}</li>)}
                    </ul>
                  </li>
                )}
              </ul>
            )}
          </div>

          {!readOnly && (
            <div className="flex items-center gap-2 border-t border-border px-3 py-2">
              <button type="button" className="btn btn-sm btn-primary" onClick={() => { void onFit(); }} disabled={busy || matching || !canFit} title={canFit ? 'Adjust camera + layout until the twin lands on the photo' : 'Re-analyze the photo to build an inventory first'}>
                {busy || matching ? <LoaderCircle size={13} className="animate-spin" /> : <Focus size={13} />}
                {busy ? 'Fitting…' : matching ? 'Matching…' : 'Fit again'}
              </button>
              {accuracy.stoppedBy && accuracy.status === 'done' && (
                <span className="text-[10.5px] text-muted">
                  {accuracy.stoppedBy === 'target' ? 'Landed on the photo' : accuracy.stoppedBy === 'stalled' ? 'Stopped improving' : accuracy.stoppedBy === 'rounds' ? 'Round limit reached' : accuracy.stoppedBy === 'aborted' ? 'Stopped by an edit' : 'No inventory to measure'}
                  {accuracy.rounds ? ` · ${accuracy.rounds} round${accuracy.rounds === 1 ? '' : 's'}` : ''}
                </span>
              )}
            </div>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
